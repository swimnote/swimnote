/**
 * backup-batch.ts — 자동 백업 + 증분 동기화 배치 잡
 *
 * 스케줄:
 *   - 매일 새벽 03:00 → 증분 동기화 (data_change_logs: pending → synced)
 *   - 매 시간 정각 체크 → backup_settings 기반 실제 DB 전체 자동 백업
 *
 * 동작:
 *   1. data_change_logs에서 sync_status=pending 건 수집 및 동기화
 *   2. backup_settings에 따라 자동 백업 실행 (runRealBackup)
 *   3. retention_days 초과 자동 백업 정리 (cleanupOldAutoBackups)
 */
import cron from "node-cron";
import { db, superAdminDb, getBackupDb, backupProtectDb, isDbSeparated, isProtectDbConfigured } from "@workspace/db";
import { dataChangeLogsTable, backupSnapshotsTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { runRealBackup, cleanupOldAutoBackups } from "../lib/backup.js";
import { runBackupToTarget } from "../lib/backup-target.js";
import { acquireLock, releaseLock, refreshLock, recordHeartbeat } from "../lib/schedulerLock.js";

// ─── 증분 동기화 ───────────────────────────────────────────────────────────
export async function runIncrementalSync(): Promise<{
  total: number;
  synced: number;
  errors: number;
  tenants: string[];
}> {
  const locked = await acquireLock("backup-incremental", 1800);
  if (!locked) {
    console.log("[backup-batch] 증분 동기화: 다른 서버가 실행 중 — 스킵");
    return { total: 0, synced: 0, errors: 0, tenants: [] };
  }
  console.log("[backup-batch] 증분 동기화 시작 →", new Date().toISOString());
  const now = new Date();
  let synced = 0, errors = 0;
  const tenants = new Set<string>();

  try {
    const pending = await db
      .select({ id: dataChangeLogsTable.id, tenant_id: dataChangeLogsTable.tenant_id })
      .from(dataChangeLogsTable)
      .where(eq(dataChangeLogsTable.sync_status, "pending"));

    if (pending.length === 0) {
      console.log("[backup-batch] 동기화할 변경분 없음");
      return { total: 0, synced: 0, errors: 0, tenants: [] };
    }

    for (const row of pending) tenants.add(row.tenant_id);

    const ids = pending.map(r => r.id);
    const BATCH = 100;
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      try {
        await db
          .update(dataChangeLogsTable)
          .set({ sync_status: "synced", synced_at: now })
          .where(sql`id = ANY(ARRAY[${sql.raw(chunk.map(id => `'${id}'`).join(","))}]::text[])`);
        synced += chunk.length;
      } catch (e) {
        console.error("[backup-batch] 배치 업데이트 오류:", e);
        errors += chunk.length;
      }
    }

    await db.insert(backupSnapshotsTable).values({
      id:              crypto.randomUUID(),
      tenant_id:       null,
      snapshot_type:   "incremental",
      tables_included: "data_change_logs",
      record_count:    synced,
    });

    console.log(`[backup-batch] 증분 동기화 완료 — 수집: ${synced}, 오류: ${errors}`);
    await recordHeartbeat("backup-incremental", { total: pending.length, synced, errors });
    return { total: pending.length, synced, errors, tenants: [...tenants] };
  } catch (err) {
    console.error("[backup-batch] 증분 동기화 치명적 오류:", err);
    return { total: 0, synced: 0, errors: 1, tenants: [] };
  } finally {
    await releaseLock("backup-incremental");
  }
}

// ─── 전체 스냅샷 (레거시 호환 — super-sync.ts에서 사용) ──────────────────────
const SNAPSHOT_TABLES = [
  "students", "parent_accounts", "users", "class_groups",
  "makeup_sessions", "monthly_settlements", "attendance",
];

export async function runFullSnapshot(): Promise<{
  total_records: number;
  tables: Record<string, number>;
}> {
  console.log("[backup-batch] 전체 스냅샷 시작 →", new Date().toISOString());
  const counts: Record<string, number> = {};
  let total = 0;
  for (const tbl of SNAPSHOT_TABLES) {
    try {
      const r = (await db.execute(sql.raw(`SELECT COUNT(*) AS cnt FROM ${tbl}`))).rows[0];
      const cnt = Number((r as any)?.cnt ?? 0);
      counts[tbl] = cnt; total += cnt;
    } catch { counts[tbl] = -1; }
  }
  await db.insert(backupSnapshotsTable).values({
    id: crypto.randomUUID(), tenant_id: null, snapshot_type: "full",
    tables_included: SNAPSHOT_TABLES.join(","), record_count: total,
  });
  console.log("[backup-batch] 전체 스냅샷 완료 — 총", total, "건");
  return { total_records: total, tables: counts };
}

// ─── 자동 백업 설정 조회 ───────────────────────────────────────────────────
async function getBackupSettings(): Promise<{
  auto_enabled: boolean;
  schedule_type: string;
  run_hour: number;
  run_minute: number;
  retention_days: number;
}> {
  try {
    const row = (await superAdminDb.execute(sql`SELECT * FROM backup_settings WHERE id = 'default'`)).rows[0] as any;
    return row ?? { auto_enabled: true, schedule_type: "daily", run_hour: 3, run_minute: 0, retention_days: 7 };
  } catch {
    return { auto_enabled: true, schedule_type: "daily", run_hour: 3, run_minute: 0, retention_days: 7 };
  }
}

// ─── 자동 백업 실행 ───────────────────────────────────────────────────────
export async function runAutoBackup(): Promise<void> {
  const locked = await acquireLock("backup-auto", 7200); // 2시간 TTL
  if (!locked) {
    console.log("[auto-backup] 다른 서버가 백업 실행 중 — 스킵");
    return;
  }

  const settings = await getBackupSettings();
  if (!settings.auto_enabled) {
    console.log("[auto-backup] 자동 백업 비활성화됨 — 건너뜀");
    await releaseLock("backup-auto");
    return;
  }

  // 장시간 백업 중 TTL 만료 방지: 10분마다 락 갱신
  const refreshInterval = setInterval(() => {
    refreshLock("backup-auto", 7200).catch(() => {});
  }, 10 * 60 * 1000);

  console.log("[auto-backup] 자동 백업 시작 →", new Date().toISOString());
  try {
    // 기존 Object Storage 백업 실행
    const result = await runRealBackup({
      type:      "auto",
      createdBy: "system",
      note:      `자동 백업 (${settings.schedule_type})`,
    });
    console.log(`[auto-backup] Object Storage 완료 — id: ${result.backupId}, size: ${(result.sizeBytes / 1024 / 1024).toFixed(2)}MB`);

    // pool 백업 DB로 백업 기록 (설정된 경우)
    if (isDbSeparated) {
      const backupDb = getBackupDb();
      runBackupToTarget({
        target: "pool",
        targetDb: backupDb!,
        createdBy: "system",
        note: `자동 백업 (${settings.schedule_type})`,
        backupType: "auto",
      }).catch(e => console.error("[auto-backup] pool 백업 실패:", e.message));
    }

    // super 보호백업 DB로 백업 기록 (설정된 경우)
    if (backupProtectDb) {
      runBackupToTarget({
        target: "super_protect",
        targetDb: backupProtectDb,
        createdBy: "system",
        note: `자동 보호백업 (${settings.schedule_type})`,
        backupType: "auto",
      }).catch(e => console.error("[auto-backup] 보호백업 실패:", e.message));
    }

    await cleanupOldAutoBackups(settings.retention_days);
    await recordHeartbeat("backup-auto", { schedule_type: settings.schedule_type, status: "success" });
  } catch (err) {
    console.error("[auto-backup] 실패:", err);
    await recordHeartbeat("backup-auto", { status: "error", error: String(err) }).catch(() => {});
  } finally {
    clearInterval(refreshInterval);
    await releaseLock("backup-auto");
  }
}

// ─── Cron 스케줄 등록 ────────────────────────────────────────────────────
export function startBackupJobs() {
  // 매일 새벽 03:00 — 증분 동기화
  cron.schedule("0 3 * * *", async () => {
    try { await runIncrementalSync(); } catch (e) { console.error("[cron] 증분 동기화 오류:", e); }
  }, { timezone: "Asia/Seoul" });

  // 매 시간 정각 — backup_settings 기반 자동 백업 체크 (최대 1시간 내 반영)
  cron.schedule("0 * * * *", async () => {
    try {
      const settings = await getBackupSettings();
      if (!settings.auto_enabled) return;

      const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
      const h = now.getHours();

      const shouldRun = (() => {
        switch (settings.schedule_type) {
          case "every_6h":  return h % 6 === settings.run_hour % 6;
          case "every_12h": return h % 12 === settings.run_hour % 12;
          case "weekly":    return now.getDay() === 0 && h === settings.run_hour;
          case "daily":
          default:          return h === settings.run_hour;
        }
      })();

      if (shouldRun) {
        console.log(`[cron] 자동 백업 실행 (${settings.schedule_type}, ${h}:00)`);
        await runAutoBackup();
      }
    } catch (e) { console.error("[cron] 자동 백업 체크 오류:", e); }
  }, { timezone: "Asia/Seoul" });

  console.log("[backup-batch] 배치 잡 등록 완료 (증분: 매일 03:00 / 자동백업: 설정 기반)");
}
