/**
 * standby-sync.ts — 핫 스탠바이 동기화 + DB 헬스 모니터
 *
 * 역할:
 *   - 5분마다  : 운영 DB + 스탠바이 DB 헬스 체크 → db_health_logs 기록 + 연속 실패 시 ops_alerts
 *   - 30분마다 : Critical 테이블을 스탠바이 DB로 UPSERT 복제 → backup_logs 갱신
 *   - 6시간마다: 전체 테이블 목록 풀 싱크 → backup_logs 갱신
 *
 * 스탠바이 DB = POOL_DATABASE_URL (pool backup DB)
 * 미설정이면 모든 작업 스킵 (안전하게 무시)
 */

import cron from "node-cron";
import { superAdminDb, getBackupDb, isDbSeparated } from "@workspace/db";
import { sql } from "drizzle-orm";
import crypto from "crypto";

// ── 핫 스탠바이 복제 대상 (30분 주기) ───────────────────────────────────────
// 비교적 행 수가 적고 구독·결제·인증에 핵심인 테이블
const HOT_SYNC_TABLES = [
  "swimming_pools",
  "users",
  "subscription_plans",
  "backup_settings",
  "platform_banners",
  "feature_flag_overrides",
  "pool_credits",
];

// ── 전체 싱크 대상 추가 테이블 (6시간 주기) ─────────────────────────────────
const FULL_SYNC_EXTRA = [
  "students",
  "event_logs",
  "payment_logs",
  "backup_logs",
  "platform_backups",
  "ops_alerts",
];

// ── db_health_logs 테이블 보장 ───────────────────────────────────────────────
async function ensureHealthLogTable() {
  await superAdminDb.execute(sql`
    CREATE TABLE IF NOT EXISTS db_health_logs (
      id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      target       text NOT NULL,
      status       text NOT NULL,
      latency_ms   integer,
      error_msg    text,
      checked_at   timestamptz NOT NULL DEFAULT now()
    )
  `).catch(() => {});

  // 인덱스 (target, checked_at 기반 최근 조회 최적화)
  await superAdminDb.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_db_health_logs_target_at ON db_health_logs (target, checked_at DESC)
  `).catch(() => {});

  // 30일 초과 로그 자동 정리
  await superAdminDb.execute(sql`
    DELETE FROM db_health_logs WHERE checked_at < NOW() - INTERVAL '30 days'
  `).catch(() => {});
}

// ── DB Ping ──────────────────────────────────────────────────────────────────
async function pingDb(db: any, name: string): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
  const t0 = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    return { ok: true, latency_ms: Date.now() - t0 };
  } catch (e: any) {
    return { ok: false, latency_ms: Date.now() - t0, error: String(e.message ?? e) };
  }
}

// ── 헬스 로그 기록 ───────────────────────────────────────────────────────────
async function writeHealthLog(target: string, status: string, latency_ms: number, error?: string) {
  try {
    await superAdminDb.execute(sql`
      INSERT INTO db_health_logs (id, target, status, latency_ms, error_msg)
      VALUES (
        ${`hl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`},
        ${target},
        ${status},
        ${latency_ms},
        ${error ?? null}
      )
    `);
  } catch { /* 메인 DB가 다운이면 로그 자체 실패 — 무시 */ }
}

// ── 연속 실패 횟수 조회 ──────────────────────────────────────────────────────
async function getConsecutiveFailures(target: string): Promise<number> {
  try {
    const rows = (await superAdminDb.execute(sql`
      SELECT status FROM db_health_logs
      WHERE target = ${target}
      ORDER BY checked_at DESC
      LIMIT 5
    `)).rows as { status: string }[];
    let count = 0;
    for (const r of rows) {
      if (r.status === "failed") count++;
      else break;
    }
    return count;
  } catch { return 0; }
}

// ── ops_alerts 알림 발행 ─────────────────────────────────────────────────────
async function fireAlert(level: "critical" | "warning", title: string, message: string) {
  try {
    await superAdminDb.execute(sql`
      INSERT INTO ops_alerts (id, level, title, message, is_resolved)
      VALUES (
        ${`alert_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`},
        ${level},
        ${title},
        ${message},
        false
      )
      ON CONFLICT DO NOTHING
    `).catch(() => {});
    console.warn(`[standby-sync] 🚨 OPS ALERT (${level}): ${title} — ${message}`);
  } catch { /* 무시 */ }
}

// ════════════════════════════════════════════════════════════════
// 5분마다: DB 헬스 체크
// ════════════════════════════════════════════════════════════════
export async function runDbHealthCheck(): Promise<void> {
  try {
    await ensureHealthLogTable();

    // ── 운영 DB 체크 ─────────────────────────────────────────
    const mainPing = await pingDb(superAdminDb, "main");
    await writeHealthLog(
      "main_db",
      mainPing.ok ? (mainPing.latency_ms > 500 ? "slow" : "ok") : "failed",
      mainPing.latency_ms,
      mainPing.error,
    );

    if (!mainPing.ok) {
      const fails = await getConsecutiveFailures("main_db");
      if (fails >= 2) { // 2회 연속 = 10분 이상 다운
        await fireAlert(
          "critical",
          "🔴 운영 DB 연결 불가",
          `superAdminDb 응답 없음 — 연속 ${fails}회 실패 (${new Date().toLocaleString("ko-KR")})`,
        );
      }
    }

    // ── 스탠바이 DB 체크 ─────────────────────────────────────
    if (!isDbSeparated) {
      console.log("[standby-sync] 스탠바이 DB 미설정 — 헬스 체크 스킵");
      return;
    }

    const backupDb = getBackupDb();
    if (!backupDb) return;

    const standbyPing = await pingDb(backupDb, "standby");
    await writeHealthLog(
      "standby_db",
      standbyPing.ok ? (standbyPing.latency_ms > 800 ? "slow" : "ok") : "failed",
      standbyPing.latency_ms,
      standbyPing.error,
    );

    if (!standbyPing.ok) {
      const fails = await getConsecutiveFailures("standby_db");
      if (fails >= 3) { // 3회 연속 = 15분 이상 다운
        await fireAlert(
          "warning",
          "🟡 스탠바이 DB 응답 없음",
          `pool backup DB 연결 불가 — 연속 ${fails}회 실패. 장애 시 자동 복구 불가 상태.`,
        );
      }
    } else if (standbyPing.latency_ms > 800) {
      console.warn(`[standby-sync] 스탠바이 DB 응답 지연: ${standbyPing.latency_ms}ms`);
    }

  } catch (e: any) {
    console.error("[standby-sync] 헬스 체크 오류:", e.message);
  }
}

// ════════════════════════════════════════════════════════════════
// 테이블 단위 복제 (TRUNCATE + INSERT 방식)
// ════════════════════════════════════════════════════════════════
async function replicateTable(
  backupDb: any,
  tableName: string,
): Promise<{ rows: number; error?: string }> {
  try {
    // 소스에서 전체 읽기
    const rows = (await superAdminDb.execute(
      sql.raw(`SELECT * FROM "${tableName}"`)
    )).rows as Record<string, unknown>[];

    if (rows.length === 0) {
      // 빈 테이블은 스킵 (TRUNCATE 하지 않음 — 데이터 없으면 그대로 유지)
      return { rows: 0 };
    }

    // 컬럼 목록 추출
    const cols = Object.keys(rows[0]).map(c => `"${c}"`);
    const colList = cols.join(", ");

    // 대상 테이블에 스키마 복사 시도 (없으면 생성)
    await backupDb.execute(
      sql.raw(`CREATE TABLE IF NOT EXISTS "${tableName}" AS SELECT * FROM (VALUES (NULL::text)) t WHERE false`)
    ).catch(() => { /* 이미 있으면 무시 */ });

    // TRUNCATE → INSERT (배치 100행)
    await backupDb.execute(sql.raw(`TRUNCATE TABLE "${tableName}" CASCADE`)).catch(() => {
      // TRUNCATE 실패 시 DELETE fallback
      return backupDb.execute(sql.raw(`DELETE FROM "${tableName}"`)).catch(() => {});
    });

    const BATCH = 100;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const valuesClause = chunk.map(row => {
        const vals = Object.values(row).map(v => {
          if (v === null || v === undefined) return "NULL";
          if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
          if (typeof v === "number" || typeof v === "bigint") return String(v);
          // Dates and strings: escape single quotes
          return `'${String(v).replace(/'/g, "''")}'`;
        });
        return `(${vals.join(", ")})`;
      }).join(", ");

      await backupDb.execute(
        sql.raw(`INSERT INTO "${tableName}" (${colList}) VALUES ${valuesClause} ON CONFLICT DO NOTHING`)
      );
    }

    return { rows: rows.length };
  } catch (e: any) {
    return { rows: 0, error: e.message ?? String(e) };
  }
}

// ════════════════════════════════════════════════════════════════
// 30분마다: Critical 테이블 핫 스탠바이 복제
// ════════════════════════════════════════════════════════════════
export async function runHotStandbySync(tables: string[] = HOT_SYNC_TABLES): Promise<void> {
  if (!isDbSeparated) {
    console.log("[standby-sync] 스탠바이 DB 미설정 — 핫 싱크 스킵");
    return;
  }

  const backupDb = getBackupDb();
  if (!backupDb) return;

  const logId = `bl_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const t0 = Date.now();
  const label = tables.length <= HOT_SYNC_TABLES.length ? "hot_sync" : "full_sync";

  console.log(`[standby-sync] ${label} 시작 — 테이블: ${tables.join(", ")}`);

  // backup_logs 시작 기록
  try {
    await superAdminDb.execute(sql`
      INSERT INTO backup_logs (id, target, status, backup_type, started_at, created_by, note)
      VALUES (${logId}, 'pool', 'running', 'auto', NOW(), 'system', ${`스탠바이 ${label}`})
    `).catch(() => {});
  } catch { /* 무시 */ }

  let totalRows = 0;
  const errors: string[] = [];

  for (const table of tables) {
    const result = await replicateTable(backupDb, table);
    if (result.error) {
      console.warn(`[standby-sync] ${table} 복제 실패: ${result.error}`);
      errors.push(`${table}: ${result.error}`);
    } else {
      console.log(`[standby-sync] ${table} → ${result.rows}행 복제`);
      totalRows += result.rows;
    }
  }

  const duration = Date.now() - t0;
  const success = errors.length === 0;

  // backup_logs 완료 기록
  try {
    if (success) {
      await superAdminDb.execute(sql`
        UPDATE backup_logs
        SET status = 'success', finished_at = NOW(), last_success_at = NOW(),
            row_count = ${totalRows}, tables_count = ${tables.length}
        WHERE id = ${logId}
      `).catch(() => {});
    } else {
      await superAdminDb.execute(sql`
        UPDATE backup_logs
        SET status = 'failed', finished_at = NOW(),
            error_message = ${errors.slice(0, 3).join("; ")}
        WHERE id = ${logId}
      `).catch(() => {});

      // 연속 실패 → 알림
      const failCount = await getRecentStandbySyncFailures();
      if (failCount >= 3) {
        await fireAlert(
          "warning",
          "🟡 스탠바이 동기화 반복 실패",
          `최근 ${failCount}회 연속 스탠바이 싱크 실패. 장애 시 데이터 복구 불완전.`,
        );
      }
    }
  } catch { /* 무시 */ }

  console.log(
    `[standby-sync] ${label} 완료 — ${totalRows}행 / ${tables.length}테이블 / ${duration}ms` +
    (errors.length > 0 ? ` / 오류 ${errors.length}개` : ""),
  );
}

// ── 최근 스탠바이 싱크 실패 횟수 ────────────────────────────────────────────
async function getRecentStandbySyncFailures(): Promise<number> {
  try {
    const rows = (await superAdminDb.execute(sql`
      SELECT status FROM backup_logs
      WHERE target = 'pool' AND note LIKE '%스탠바이%'
      ORDER BY started_at DESC
      LIMIT 5
    `)).rows as { status: string }[];
    let count = 0;
    for (const r of rows) {
      if (r.status === "failed") count++;
      else break;
    }
    return count;
  } catch { return 0; }
}

// ════════════════════════════════════════════════════════════════
// 최신 스탠바이 상태 조회 (backup-status API용)
// ════════════════════════════════════════════════════════════════
export async function getStandbyStatus(): Promise<{
  configured: boolean;
  connected: boolean;
  latency_ms: number | null;
  last_sync_at: string | null;
  last_sync_status: string | null;
  lag_minutes: number | null;
  error: string | null;
}> {
  if (!isDbSeparated) {
    return {
      configured: false, connected: false, latency_ms: null,
      last_sync_at: null, last_sync_status: null, lag_minutes: null, error: null,
    };
  }

  // 스탠바이 ping
  const backupDb = getBackupDb();
  const ping = backupDb ? await pingDb(backupDb, "standby") : { ok: false, latency_ms: 0, error: "getBackupDb() null" };

  // 마지막 스탠바이 싱크 로그
  let lastSync: any = null;
  try {
    const rows = (await superAdminDb.execute(sql`
      SELECT status, last_success_at, finished_at, error_message
      FROM backup_logs
      WHERE target = 'pool'
      ORDER BY started_at DESC
      LIMIT 1
    `)).rows as any[];
    lastSync = rows[0] ?? null;
  } catch { /* 무시 */ }

  const lastSuccessAt = lastSync?.last_success_at ?? null;
  const lagMinutes = lastSuccessAt
    ? Math.round((Date.now() - new Date(lastSuccessAt).getTime()) / 60000)
    : null;

  return {
    configured:       true,
    connected:        ping.ok,
    latency_ms:       ping.latency_ms,
    last_sync_at:     lastSync?.finished_at ?? null,
    last_sync_status: lastSync?.status ?? null,
    lag_minutes:      lagMinutes,
    error:            ping.error ?? null,
  };
}

// ════════════════════════════════════════════════════════════════
// Cron 등록
// ════════════════════════════════════════════════════════════════
export function startStandbySyncJobs() {
  // 5분마다: DB 헬스 체크
  cron.schedule("*/5 * * * *", async () => {
    try { await runDbHealthCheck(); }
    catch (e) { console.error("[cron] DB 헬스 체크 오류:", e); }
  });

  // 30분마다: Critical 테이블 핫 스탠바이 복제
  cron.schedule("*/30 * * * *", async () => {
    try { await runHotStandbySync(HOT_SYNC_TABLES); }
    catch (e) { console.error("[cron] 핫 스탠바이 싱크 오류:", e); }
  });

  // 6시간마다: 전체 테이블 풀 싱크 (hot + extra)
  cron.schedule("0 */6 * * *", async () => {
    try { await runHotStandbySync([...HOT_SYNC_TABLES, ...FULL_SYNC_EXTRA]); }
    catch (e) { console.error("[cron] 풀 싱크 오류:", e); }
  });

  console.log("[standby-sync] 스케줄러 시작 (헬스: 5분 / 핫싱크: 30분 / 풀싱크: 6시간)");
}
