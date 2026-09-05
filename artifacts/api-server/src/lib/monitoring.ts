/**
 * lib/monitoring.ts — WP9 Operational Health Checks
 *
 * 모든 함수는 pure health-check (side-effect 없음).
 * 각 쿼리는 LIMIT / time-bounded — health endpoint 자체가 부하 원인이 되지 않음.
 * DB failure가 health endpoint crash로 이어지지 않음.
 */
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

// ── Types ────────────────────────────────────────────────────────────────────

export type HealthStatus = "GREEN" | "YELLOW" | "RED";
export type ComponentStatus = "OK" | "DEGRADED" | "FAIL";

export interface ComponentHealth {
  status: ComponentStatus;
  detail: string;
  checkedAt: string;
}

export interface SystemHealthSnapshot {
  overallStatus: HealthStatus;
  api:        ComponentHealth;
  db:         ComponentHealth;
  push:       ComponentHealth;
  revenuecat: ComponentHealth;
  growth:     ComponentHealth;
  workers:    ComponentHealth;
  checkedAt:  string;
}

// ── Thresholds (env-configurable with conservative defaults) ─────────────────

export const THRESHOLDS = {
  /** 5분 내 5xx 건수 초과 시 API_5XX_SPIKE */
  fiveXxSpike5min:   Number(process.env.MONITOR_5XX_SPIKE_5MIN  ?? 3),
  /** 15분 내 5xx 건수 초과 시 API_5XX_SPIKE (확장 window) */
  fiveXxSpike15min:  Number(process.env.MONITOR_5XX_SPIKE_15MIN ?? 8),
  /** push_fanout_jobs PROCESSING stale timeout (ms) */
  pushStaleMs:       Number(process.env.MONITOR_PUSH_STALE_MS   ?? 10 * 60 * 1000),
  /** growth_report_batch_jobs RUNNING stale timeout (ms) */
  growthBatchStaleMs: Number(process.env.MONITOR_GROWTH_BATCH_STALE_MS ?? 30 * 60 * 1000),
  /** growth_reports IN_PROGRESS stale timeout (ms) */
  growthAnalysisStaleMs: Number(process.env.MONITOR_GROWTH_ANALYSIS_STALE_MS ?? 20 * 60 * 1000),
  /** alert cooldown window (ms) — 같은 incident key 재알림 간격 */
  alertCooldownMs:   Number(process.env.MONITOR_ALERT_COOLDOWN_MS ?? 30 * 60 * 1000),
  /** ops-monitor poll interval (ms) */
  pollIntervalMs:    Number(process.env.MONITOR_POLL_INTERVAL_MS  ?? 2 * 60 * 1000),
} as const;

// ── Helper ────────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function ok(detail: string): ComponentHealth {
  return { status: "OK", detail, checkedAt: now() };
}
function degraded(detail: string): ComponentHealth {
  return { status: "DEGRADED", detail, checkedAt: now() };
}
function fail(detail: string): ComponentHealth {
  return { status: "FAIL", detail, checkedAt: now() };
}

// ── DB Health ─────────────────────────────────────────────────────────────────

/** DB URL, credential 정보를 제거한 safe error snippet */
function safeDbError(e: unknown): string {
  const raw = String((e as any)?.message ?? "unknown");
  // URL 전체 제거 (postgresql://... 등 credential 포함 가능)
  const stripped = raw
    .replace(/[a-z]+:\/\/[^\s]+/gi, "[URL_REDACTED]")
    .replace(/password=[^\s&]+/gi, "password=[REDACTED]")
    .slice(0, 100);
  return stripped;
}

export async function checkDb(): Promise<ComponentHealth> {
  const t = Date.now();
  try {
    await superAdminDb.execute(sql`SELECT 1 AS ping`);
    const ms = Date.now() - t;
    if (ms > 1000) return degraded(`SELECT 1 응답 ${ms}ms (경고 임계값 초과)`);
    return ok(`응답 ${ms}ms`);
  } catch (e: any) {
    return fail(`연결 실패: ${safeDbError(e)}`);
  }
}

// ── 5xx Spike ────────────────────────────────────────────────────────────────

export interface FiveXxResult extends ComponentHealth {
  count5min: number;
  count15min: number;
  spikeDetected: boolean;
}

export async function check5xxSpike(): Promise<FiveXxResult> {
  try {
    const r = await superAdminDb.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '5 minutes')::int  AS cnt5,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '15 minutes')::int AS cnt15
      FROM event_logs
      WHERE feature = 'API'
        AND level IN ('ERROR', 'CRITICAL')
        AND created_at > NOW() - INTERVAL '15 minutes'
      LIMIT 1
    `);
    const row = (r.rows as any[])[0] ?? { cnt5: 0, cnt15: 0 };
    const count5min  = Number(row.cnt5  ?? 0);
    const count15min = Number(row.cnt15 ?? 0);
    const spikeDetected =
      count5min  >= THRESHOLDS.fiveXxSpike5min  ||
      count15min >= THRESHOLDS.fiveXxSpike15min;

    if (spikeDetected) {
      return {
        ...degraded(`5xx spike: ${count5min}건/5분, ${count15min}건/15분`),
        count5min, count15min, spikeDetected: true,
      };
    }
    return {
      ...ok(`${count5min}건/5분, ${count15min}건/15분`),
      count5min, count15min, spikeDetected: false,
    };
  } catch {
    return { ...ok("event_logs 쿼리 불가 (무시)"), count5min: 0, count15min: 0, spikeDetected: false };
  }
}

// ── Push Fanout ───────────────────────────────────────────────────────────────

export interface PushResult extends ComponentHealth {
  failedCount: number;
  stuckCount: number;
  pendingCount: number;
}

export async function checkPushFanout(): Promise<PushResult> {
  const staleTs = new Date(Date.now() - THRESHOLDS.pushStaleMs).toISOString();
  try {
    const r = await superAdminDb.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'FAILED')::int                                                     AS failed,
        COUNT(*) FILTER (WHERE status = 'PROCESSING' AND locked_at < ${staleTs}::timestamptz)::int        AS stuck,
        COUNT(*) FILTER (WHERE status = 'PENDING')::int                                                    AS pending
      FROM push_fanout_jobs
      WHERE created_at > NOW() - INTERVAL '24 hours'
      LIMIT 1
    `);
    const row = (r.rows as any[])[0] ?? { failed: 0, stuck: 0, pending: 0 };
    const failedCount  = Number(row.failed  ?? 0);
    const stuckCount   = Number(row.stuck   ?? 0);
    const pendingCount = Number(row.pending ?? 0);

    if (failedCount > 0 || stuckCount > 0) {
      return {
        ...degraded(`FAILED=${failedCount}, STUCK=${stuckCount}, PENDING=${pendingCount}`),
        failedCount, stuckCount, pendingCount,
      };
    }
    return { ...ok(`PENDING=${pendingCount}`), failedCount, stuckCount, pendingCount };
  } catch (e: any) {
    return { ...fail(`쿼리 실패: ${String(e?.message ?? "unknown").slice(0, 80)}`), failedCount: 0, stuckCount: 0, pendingCount: 0 };
  }
}

// ── RevenueCat Webhook ────────────────────────────────────────────────────────

export interface RcResult extends ComponentHealth {
  recentFailures: number;
}

export async function checkRevenueCat(): Promise<RcResult> {
  try {
    const r = await superAdminDb.execute(sql`
      SELECT COUNT(*)::int AS cnt
      FROM event_logs
      WHERE error_code = 'RC_WEBHOOK_PROCESSING_FAILED'
        AND created_at > NOW() - INTERVAL '30 minutes'
      LIMIT 1
    `);
    const recentFailures = Number((r.rows as any[])[0]?.cnt ?? 0);
    if (recentFailures > 0) {
      return { ...degraded(`최근 30분 처리 실패 ${recentFailures}건`), recentFailures };
    }
    return { ...ok("최근 30분 실패 없음"), recentFailures: 0 };
  } catch {
    return { ...ok("event_logs 쿼리 불가 (무시)"), recentFailures: 0 };
  }
}

// ── Growth Workers ────────────────────────────────────────────────────────────

export interface GrowthResult extends ComponentHealth {
  batchFailed: number;
  batchStuck: number;
  analysisFailed: number;
  analysisStuck: number;
}

export async function checkGrowthWorkers(): Promise<GrowthResult> {
  const batchStaleTs    = new Date(Date.now() - THRESHOLDS.growthBatchStaleMs).toISOString();
  const analysisStaleTs = new Date(Date.now() - THRESHOLDS.growthAnalysisStaleMs).toISOString();

  let batchFailed = 0, batchStuck = 0, analysisFailed = 0, analysisStuck = 0;

  try {
    // growth_report_batch_jobs
    const br = await superAdminDb.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'FAILED')::int                                                  AS bfailed,
        COUNT(*) FILTER (WHERE status = 'RUNNING' AND locked_at < ${batchStaleTs}::timestamptz)::int   AS bstuck
      FROM growth_report_batch_jobs
      WHERE created_at > NOW() - INTERVAL '4 hours'
      LIMIT 1
    `);
    const brow = (br.rows as any[])[0] ?? { bfailed: 0, bstuck: 0 };
    batchFailed = Number(brow.bfailed ?? 0);
    batchStuck  = Number(brow.bstuck  ?? 0);
  } catch { /* 테이블 없으면 무시 */ }

  try {
    // growth_reports (analysis worker)
    const ar = await superAdminDb.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE product_status = 'FAILED')::int                                                           AS afailed,
        COUNT(*) FILTER (WHERE product_status IN ('PREANALYZING','ANALYZING') AND updated_at < ${analysisStaleTs}::timestamptz)::int    AS astuck
      FROM growth_reports
      WHERE updated_at > NOW() - INTERVAL '4 hours'
      LIMIT 1
    `);
    const arow = (ar.rows as any[])[0] ?? { afailed: 0, astuck: 0 };
    analysisFailed = Number(arow.afailed ?? 0);
    analysisStuck  = Number(arow.astuck  ?? 0);
  } catch { /* 테이블 없으면 무시 */ }

  const hasProblem = batchFailed > 0 || batchStuck > 0 || analysisFailed > 0 || analysisStuck > 0;
  if (hasProblem) {
    return {
      ...degraded(
        `batch FAILED=${batchFailed} STUCK=${batchStuck}; analysis FAILED=${analysisFailed} STUCK=${analysisStuck}`
      ),
      batchFailed, batchStuck, analysisFailed, analysisStuck,
    };
  }
  return { ...ok("정상"), batchFailed, batchStuck, analysisFailed, analysisStuck };
}

// ── Worker Heartbeat ──────────────────────────────────────────────────────────

export interface WorkerResult extends ComponentHealth {
  lastHeartbeats: Array<{ job_name: string; last_run_at: string; result: string }>;
}

const KEY_WORKERS = [
  "push-fanout-worker",
  "growth-report-batch-worker",
  "growth-report-analysis-worker",
  "growth-report-scheduler",
  "push-scheduler",
];

export async function checkWorkers(): Promise<WorkerResult> {
  try {
    const r = await superAdminDb.execute(sql`
      SELECT job_name, last_run_at::text, result::text
      FROM scheduler_heartbeat
      WHERE job_name = ANY(${KEY_WORKERS}::text[])
      ORDER BY last_run_at DESC
      LIMIT 10
    `);
    const rows = (r.rows as any[]).map(row => ({
      job_name:   String(row.job_name ?? ""),
      last_run_at: String(row.last_run_at ?? ""),
      result:     String(row.result ?? "{}").slice(0, 200),
    }));

    // workers silent for > 10 minutes → DEGRADED
    const staleMs = 10 * 60 * 1000;
    const silentWorkers = KEY_WORKERS.filter(w => {
      const row = rows.find(r => r.job_name === w);
      if (!row) return true;
      const age = Date.now() - new Date(row.last_run_at).getTime();
      return age > staleMs;
    });

    if (silentWorkers.length > 0) {
      return {
        ...degraded(`응답 없는 worker: ${silentWorkers.join(", ")}`),
        lastHeartbeats: rows,
      };
    }
    return { ...ok(`${rows.length}개 worker 정상`), lastHeartbeats: rows };
  } catch (e: any) {
    return {
      ...fail(`heartbeat 조회 실패: ${String(e?.message ?? "unknown").slice(0, 80)}`),
      lastHeartbeats: [],
    };
  }
}

// ── Overall Aggregation ───────────────────────────────────────────────────────

function toOverall(statuses: ComponentStatus[]): HealthStatus {
  if (statuses.includes("FAIL")) return "RED";
  if (statuses.includes("DEGRADED")) return "YELLOW";
  return "GREEN";
}

export async function getSystemHealth(): Promise<SystemHealthSnapshot> {
  // Run all checks in parallel (bounded, independent)
  const [db, fiveXx, push, rc, growth, workers] = await Promise.all([
    checkDb(),
    check5xxSpike(),
    checkPushFanout(),
    checkRevenueCat(),
    checkGrowthWorkers(),
    checkWorkers(),
  ]);

  // API status: UP unless DB is down + 5xx spike both
  const apiStatus: ComponentStatus =
    db.status === "FAIL" ? "FAIL" :
    fiveXx.spikeDetected ? "DEGRADED" :
    "OK";
  const api: ComponentHealth = { status: apiStatus, detail: fiveXx.detail, checkedAt: now() };

  const overallStatus = toOverall([api.status, db.status, push.status, rc.status, growth.status, workers.status]);

  return {
    overallStatus,
    api,
    db,
    push,
    revenuecat: rc,
    growth,
    workers,
    checkedAt: now(),
  };
}
