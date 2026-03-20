/**
 * backup-batch.ts
 *
 * 서버 기반 새벽 배치 수집 잡.
 *
 * 스케줄:
 *   - 매일 새벽 3:00 → incremental sync (pending → synced)
 *   - 매주 일요일 02:00 → full snapshot 생성
 *
 * 동작:
 *   1. data_change_logs에서 sync_status=pending 건 수집
 *   2. 각 테넌트별 집계 후 synced_at, sync_status 업데이트
 *   3. (주간) 전체 스냅샷: 주요 테이블 레코드 수 집계 → backup_snapshots 기록
 *
 * 앱이 꺼져 있어도 API 서버가 살아있으면 자동 실행.
 */
import cron from "node-cron";
import { db } from "@workspace/db";
import { dataChangeLogsTable, backupSnapshotsTable } from "@workspace/db/schema";
import { eq, sql, and } from "drizzle-orm";

// ─── 증분 동기화 ───────────────────────────────────────────────────────────
export async function runIncrementalSync(): Promise<{
  total: number;
  synced: number;
  errors: number;
  tenants: string[];
}> {
  console.log("[backup-batch] 증분 동기화 시작 →", new Date().toISOString());
  const now = new Date();
  let synced = 0, errors = 0;
  const tenants = new Set<string>();

  try {
    // pending 건 수집
    const pending = await db
      .select({
        id:        dataChangeLogsTable.id,
        tenant_id: dataChangeLogsTable.tenant_id,
      })
      .from(dataChangeLogsTable)
      .where(eq(dataChangeLogsTable.sync_status, "pending"));

    if (pending.length === 0) {
      console.log("[backup-batch] 동기화할 변경분 없음");
      return { total: 0, synced: 0, errors: 0, tenants: [] };
    }

    for (const row of pending) {
      tenants.add(row.tenant_id);
    }

    const ids = pending.map(r => r.id);

    // 배치 업데이트 (100건씩)
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

    // incremental 스냅샷 기록
    await db.insert(backupSnapshotsTable).values({
      id:              crypto.randomUUID(),
      tenant_id:       null,
      snapshot_type:   "incremental",
      tables_included: "data_change_logs",
      record_count:    synced,
    });

    console.log(`[backup-batch] 증분 동기화 완료 — 수집: ${synced}, 오류: ${errors}, 테넌트: ${tenants.size}개`);
    return { total: pending.length, synced, errors, tenants: [...tenants] };
  } catch (err) {
    console.error("[backup-batch] 증분 동기화 치명적 오류:", err);
    return { total: 0, synced: 0, errors: 1, tenants: [] };
  }
}

// ─── 전체 스냅샷 ──────────────────────────────────────────────────────────
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
      const [r] = await db.execute(sql.raw(`SELECT COUNT(*) AS cnt FROM ${tbl}`));
      const cnt = Number((r as any).cnt ?? 0);
      counts[tbl] = cnt;
      total += cnt;
    } catch {
      counts[tbl] = -1;
    }
  }

  await db.insert(backupSnapshotsTable).values({
    id:              crypto.randomUUID(),
    tenant_id:       null,
    snapshot_type:   "full",
    tables_included: SNAPSHOT_TABLES.join(","),
    record_count:    total,
  });

  console.log("[backup-batch] 전체 스냅샷 완료 — 총", total, "건");
  return { total_records: total, tables: counts };
}

// ─── Cron 스케줄 등록 ────────────────────────────────────────────────────
export function startBackupJobs() {
  // 매일 새벽 03:00 — 증분 동기화
  cron.schedule("0 3 * * *", async () => {
    try { await runIncrementalSync(); } catch (e) { console.error("[cron] 증분 동기화 오류:", e); }
  }, { timezone: "Asia/Seoul" });

  // 매주 일요일 02:00 — 전체 스냅샷
  cron.schedule("0 2 * * 0", async () => {
    try { await runFullSnapshot(); } catch (e) { console.error("[cron] 전체 스냅샷 오류:", e); }
  }, { timezone: "Asia/Seoul" });

  console.log("[backup-batch] 배치 잡 등록 완료 (증분: 매일 03:00 / 전체스냅샷: 매주 일 02:00)");
}
