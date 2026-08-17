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

// ── 식별자 검증 정규식 ───────────────────────────────────────────────────────
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Production에서 아직 생성되지 않은 lazy-init 테이블 — relation missing 시 graceful skip */
const LAZY_SYNC_TABLES = new Set(["pool_credits"]);

/**
 * Drizzle/pg 에러에서 "relation does not exist"(PG 42P01) 여부 확인.
 * DrizzleQueryError는 원래 PG 에러를 e.cause에 래핑하므로 두 레이어 모두 검사.
 */
function isPgRelationMissing(e: any): boolean {
  const check = (msg: string) => (msg ?? "").toLowerCase().includes("does not exist");
  if (e.code === "42P01" || check(e.message)) return true;
  const cause = e.cause;
  if (!cause) return false;
  return cause.code === "42P01" || check(cause.message);
}

/**
 * JavaScript 값을 drizzle/pg가 안전하게 파라미터화할 수 있는 형태로 변환.
 *
 * 근본 원인 (42804):
 *   sql`${['a','b']}` → drizzle이 배열을 ($1,$2) "record" 문법으로 전개 →
 *   text[] 컬럼과 타입 불일치
 *
 * 근본 원인 (22P02 — jsonb 배열 버그):
 *   jsonb 컬럼의 JS 배열을 PG 배열 리터럴 {a,b}로 변환하면
 *   invalid input syntax for type json 오류 발생.
 *   students.assigned_class_ids / students.class_schedule 등이 해당.
 *
 * 해결:
 *   pgType="jsonb"|"json"  → JSON.stringify (pg가 jsonb input function으로 파싱)
 *   pgType=text[]|기타     → PostgreSQL 배열 리터럴 {a,b}
 *   pgType 없이 Array      → PG 배열 리터럴 (text[] 가정, fallback)
 *   Date                   → ISO 8601 문자열
 *   non-Array Object       → JSON 문자열 (jsonb로 암묵 변환)
 *   나머지                  → 그대로 전달 (null/boolean/number/string은 pg 네이티브)
 */
function serializeForPg(v: unknown, pgType?: string): unknown {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) {
    // jsonb / json 컬럼: JSON 배열 문자열로 전달 (PG jsonb input이 파싱)
    if (pgType === "jsonb" || pgType === "json") return JSON.stringify(v);
    // text[], int4[] 등 PG 네이티브 배열: 배열 리터럴 {a,b}
    const elems = v.map(e => {
      if (e === null || e === undefined) return "NULL";
      if (typeof e === "number" || typeof e === "boolean") return String(e);
      const s = String(e);
      return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    });
    return `{${elems.join(",")}}`;
  }
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

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

// ── DB Ping (3초 타임아웃) ────────────────────────────────────────────────────
async function pingDb(db: any, name: string): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
  const t0 = Date.now();
  try {
    await Promise.race([
      db.execute(sql`SELECT 1`),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("ping timeout 3000ms")), 3000)
      ),
    ]);
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
    if (!isDbSeparated) return;

    // 서킷브레이커 오픈 상태면 스킵 (연속 느림으로 30분 대기 중)
    if (!checkStandbyCircuit()) return;

    const backupDb = getBackupDb();
    if (!backupDb) return;

    const standbyPing = await pingDb(backupDb, "standby");
    recordStandbyPingResult(standbyPing.latency_ms, standbyPing.ok);

    await writeHealthLog(
      "standby_db",
      standbyPing.ok ? (standbyPing.latency_ms > 800 ? "slow" : "ok") : "failed",
      standbyPing.latency_ms,
      standbyPing.error,
    );

    if (!standbyPing.ok) {
      const fails = await getConsecutiveFailures("standby_db");
      if (fails >= 3) {
        await fireAlert(
          "warning",
          "🟡 스탠바이 DB 응답 없음",
          `pool backup DB 연결 불가 — 연속 ${fails}회 실패. 장애 시 자동 복구 불가 상태.`,
        );
      }
    }

  } catch (e: any) {
    console.error("[standby-sync] 헬스 체크 오류:", e.message);
  }
}

// ── 서킷브레이커: 스탠바이 DB 연속 느림 → 30분 스킵 ────────────────────────
let standbyCircuitOpenUntil = 0; // 0 = 닫힘(정상), >0 = 열림(스킵 중)
let standbySlowStreak = 0;       // 연속 느린 핑 횟수
const CIRCUIT_SLOW_THRESHOLD_MS = 2000; // 2초 초과 = 느림
const CIRCUIT_OPEN_STREAK = 3;          // 3회 연속 느리면 서킷 오픈
const CIRCUIT_OPEN_DURATION_MS = 30 * 60 * 1000; // 30분

function checkStandbyCircuit(): boolean {
  if (standbyCircuitOpenUntil > 0 && Date.now() < standbyCircuitOpenUntil) return false; // 스킵
  if (standbyCircuitOpenUntil > 0) {
    standbyCircuitOpenUntil = 0; standbySlowStreak = 0;
    console.log("[standby-sync] 서킷브레이커 복구 — 스탠바이 체크 재개");
  }
  return true;
}

function recordStandbyPingResult(latency_ms: number, ok: boolean) {
  if (!ok || latency_ms >= CIRCUIT_SLOW_THRESHOLD_MS) {
    standbySlowStreak++;
    if (standbySlowStreak >= CIRCUIT_OPEN_STREAK && standbyCircuitOpenUntil === 0) {
      standbyCircuitOpenUntil = Date.now() + CIRCUIT_OPEN_DURATION_MS;
      console.warn(`[standby-sync] 서킷브레이커 오픈 — 스탠바이 DB 연속 ${standbySlowStreak}회 느림 (${latency_ms}ms). 30분간 스킵.`);
    }
  } else {
    standbySlowStreak = 0;
  }
}

// ════════════════════════════════════════════════════════════════
// Standby swimming_pools 스키마 보수
// ════════════════════════════════════════════════════════════════
/**
 * Production에만 추가된 swimming_pools 컬럼을 standby(backupDb)에 멱등 추가.
 *
 * 근본 원인 (SCHEMA_MISMATCH):
 *   pool-db-x-init / pool-db-x-payment-init / pool-db-x-lifecycle / super-db-init 마이그레이션은
 *   superAdminDb(SUPABASE_DATABASE_URL)에만 실행됨.
 *   backupDb(POOL_DATABASE_URL)는 동일 마이그레이션을 받지 못해
 *   72컬럼 INSERT 시 "column does not exist" 오류 발생.
 *
 * 대원칙:
 *   - ADD COLUMN IF NOT EXISTS → 완전 멱등
 *   - x_slot_id: standby에 x_subscription_slots가 없으므로 FK 없이 bigint만
 *   - xmode_config_status: ENUM 타입 먼저 생성 후 컬럼 추가
 *   - 실패해도 throw하지 않음 — 개별 오류만 warn; 복제 시도는 계속됨
 */
async function repairStandbySwimmingPoolsSchema(backupDb: any): Promise<void> {
  const exec = async (stmt: string, label: string) => {
    try {
      await backupDb.execute(sql.raw(stmt));
    } catch (e: any) {
      const cause = e?.cause?.message ?? e?.message ?? String(e);
      console.warn(`[standby-sync] repairStandby warn (${label}): ${cause}`);
    }
  };

  // ── 1. ENUM 타입 (xmode_config_status_enum) ──────────────────────────────
  // PG 14 이전은 CREATE TYPE IF NOT EXISTS 미지원 → DO $$ 패턴 사용
  await exec(`
    DO $$ BEGIN
      CREATE TYPE xmode_config_status_enum AS ENUM
        ('NOT_CONFIGURED', 'CURRICULUM_PENDING', 'READY');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `, "xmode_config_status_enum");

  // ── 2. xmode 컬럼 5개 (pool-db-x-init.ts) ────────────────────────────────
  await exec(
    `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS xmode_entitlement boolean NOT NULL DEFAULT false;`,
    "xmode_entitlement",
  );
  await exec(
    `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS xmode_config_status xmode_config_status_enum NOT NULL DEFAULT 'NOT_CONFIGURED';`,
    "xmode_config_status",
  );
  await exec(
    `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS xmode_purchased_at timestamptz;`,
    "xmode_purchased_at",
  );
  await exec(
    `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS xmode_subscription_end_at timestamptz;`,
    "xmode_subscription_end_at",
  );
  await exec(
    `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS xmode_payment_failed_at timestamptz;`,
    "xmode_payment_failed_at",
  );

  // ── 3. X 결제 컬럼 4개 (pool-db-x-payment-init.ts) ───────────────────────
  // x_slot_id: FK 없이 bigint만 (standby에 x_subscription_slots 테이블 없을 수 있음)
  await exec(
    `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS x_slot_id bigint;`,
    "x_slot_id",
  );
  await exec(
    `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS x_paid_entitlement boolean NOT NULL DEFAULT false;`,
    "x_paid_entitlement",
  );
  await exec(
    `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS x_manual_entitlement boolean NOT NULL DEFAULT false;`,
    "x_manual_entitlement",
  );
  await exec(
    `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS x_force_disabled boolean NOT NULL DEFAULT false;`,
    "x_force_disabled",
  );

  // ── 4. x_auto_renew_cancelled (pool-db-x-lifecycle.ts) ───────────────────
  await exec(
    `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS x_auto_renew_cancelled boolean NOT NULL DEFAULT false;`,
    "x_auto_renew_cancelled",
  );

  // ── 5. homepage 컬럼 (super-db-init.ts) ──────────────────────────────────
  await exec(
    `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS homepage_slug text;`,
    "homepage_slug",
  );
  await exec(
    `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS homepage_enabled boolean NOT NULL DEFAULT false;`,
    "homepage_enabled",
  );

  console.log("[standby-sync] repairStandbySwimmingPoolsSchema 완료");
}

// ════════════════════════════════════════════════════════════════
// 테이블 단위 복제 (TRUNCATE + INSERT 방식, 30초 타임아웃)
// ════════════════════════════════════════════════════════════════
async function replicateTable(
  backupDb: any,
  tableName: string,
): Promise<{ rows: number; error?: string; lazy_skip?: boolean }> {
  const TABLE_TIMEOUT_MS = 30_000;
  const tableTimer = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`replicateTable timeout 30s: ${tableName}`)), TABLE_TIMEOUT_MS)
  );

  // 식별자 검증: 허용된 패턴만 통과
  if (!IDENT_RE.test(tableName)) {
    return { rows: 0, error: `Invalid table identifier: ${tableName}` };
  }

  try {
    // ── 1. Production SELECT (타임아웃 경쟁) ─────────────────────────────
    let rows: Record<string, unknown>[];
    try {
      rows = (await Promise.race([
        superAdminDb.execute(sql.raw(`SELECT * FROM "${tableName}"`)),
        tableTimer,
      ]) as any).rows as Record<string, unknown>[];
    } catch (e: any) {
      // Lazy-init 테이블(pool_credits 등)은 Production에서 아직 없을 수 있음 → graceful skip
      if (LAZY_SYNC_TABLES.has(tableName) && isPgRelationMissing(e)) {
        return { rows: 0, lazy_skip: true };
      }
      throw e;
    }

    if (rows.length === 0) {
      // 빈 테이블은 스킵 (TRUNCATE 하지 않음 — 데이터 없으면 그대로 유지)
      return { rows: 0 };
    }

    // ── 2. 컬럼 식별자 검증 ──────────────────────────────────────────────
    const cols = Object.keys(rows[0]);
    for (const c of cols) {
      if (!IDENT_RE.test(c)) {
        return { rows: 0, error: `Invalid column identifier: ${c}` };
      }
    }
    const colIdents = cols.map(c => `"${c}"`).join(", ");

    // ── 2.5 컬럼 타입 조회 (jsonb vs text[] 구분용) ──────────────────────
    // Production information_schema에서 각 컬럼의 udt_name을 가져옴.
    // Array.isArray() 만으로는 jsonb 배열과 text[] 배열을 구분 불가 (22P02 버그).
    const colTypeRows = (await superAdminDb.execute(
      sql.raw(
        `SELECT column_name, udt_name FROM information_schema.columns ` +
        `WHERE table_schema='public' AND table_name='${tableName}'`
      )
    )).rows as { column_name: string; udt_name: string }[];
    const colTypes = new Map(colTypeRows.map(r => [r.column_name, r.udt_name]));

    // ── 3. TRUNCATE (stub 자동 생성 금지) ────────────────────────────────
    // Backup 테이블이 없고 Production에 행이 있으면:
    //   AUTO_CREATE_STUB 금지 — BACKUP_SCHEMA_MISSING 오류 + 알림
    // (이전 코드의 CREATE TABLE IF NOT EXISTS column1 stub 방식 제거)
    try {
      await backupDb.execute(sql.raw(`TRUNCATE TABLE "${tableName}" CASCADE`));
    } catch (truncErr: any) {
      if (isPgRelationMissing(truncErr)) {
        // Backup 스키마 미준비 → 알림 후 실패 반환
        await fireAlert(
          "critical",
          "🔴 Backup 테이블 스키마 없음",
          `${tableName}: Backup DB에 테이블 없음. Pool DB 수동 수리 필요 (BACKUP_SCHEMA_MISSING).`,
        ).catch(() => {});
        return { rows: 0, error: `BACKUP_SCHEMA_MISSING: ${tableName}` };
      }
      // 기타 TRUNCATE 오류 → DELETE fallback
      await backupDb.execute(sql.raw(`DELETE FROM "${tableName}"`)).catch(() => {});
    }

    // ── 4. 파라미터화된 배치 INSERT ──────────────────────────────────────
    // serializeForPg(v, pgType)로 값을 사전 변환 후 drizzle sql 파라미터로 전달.
    // colTypes Map을 통해 jsonb/json vs text[] 등을 구분해 올바른 형식으로 직렬화.
    // pg 드라이버가 모든 타입 직렬화를 처리하므로 SQL 인젝션 위험 없음.
    const BATCH = 100;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const rowSqls = chunk.map(row => {
        const vals = cols.map(col => serializeForPg(row[col], colTypes.get(col)));
        return sql`(${sql.join(vals.map(v => sql`${v}`), sql.raw(", "))})`;
      });
      const valuesSql = sql.join(rowSqls, sql.raw(", "));
      await backupDb.execute(
        sql`INSERT INTO ${sql.raw(`"${tableName}"`)} (${sql.raw(colIdents)}) VALUES ${valuesSql} ON CONFLICT DO NOTHING`
      );
    }

    return { rows: rows.length };
  } catch (e: any) {
    // e.message는 drizzle 래핑 메시지 ("Failed query: INSERT INTO...")
    // e.cause?.message가 실제 PG 오류 메시지 (예: "column 'x_paid_entitlement' does not exist")
    const pgMsg = e?.cause?.message ?? "";
    const errMsg = pgMsg ? `${e.message ?? ""} | PG: ${pgMsg}` : (e.message ?? String(e));
    return { rows: 0, error: errMsg };
  }
}

// ════════════════════════════════════════════════════════════════
// 30분마다: Critical 테이블 핫 스탠바이 복제
// ════════════════════════════════════════════════════════════════
export async function runHotStandbySync(tables: string[] = HOT_SYNC_TABLES): Promise<void> {
  if (!isDbSeparated) return;

  // 서킷브레이커 오픈 상태면 싱크도 스킵
  if (!checkStandbyCircuit()) {
    console.log("[standby-sync] 서킷브레이커 오픈 중 — 핫 싱크 스킵");
    return;
  }

  const backupDb = getBackupDb();
  if (!backupDb) return;

  // ── 스키마 보수: swimming_pools가 대상에 포함되면 standby 컬럼 불일치 먼저 수정 ──
  // Root-cause fix: production-only migrations (x-init, x-payment-init, x-lifecycle,
  // super-db-init)이 standby에 실행되지 않아 누적된 컬럼 불일치를 멱등 보정.
  if (tables.includes("swimming_pools")) {
    await repairStandbySwimmingPoolsSchema(backupDb);
  }

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
    if (result.lazy_skip) {
      // Lazy-init 테이블(Production에 아직 없음) — 오류로 계산하지 않음
      console.log(`[standby-sync] ${table} → LAZY_TABLE_NOT_CREATED (graceful skip)`);
    } else if (result.error) {
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
