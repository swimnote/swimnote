import { sql } from "drizzle-orm";
import { getGrowthReportAnalysisIdentityHash } from "./growth-report-analysis-identity.js";

export type MonthlyFirstPassOutcome =
  | "generated"
  | "insufficient_evidence"
  | "failed"
  | "unknown"
  | "policy_excluded"
  | "missing"
  | "identity_error";

export type MonthlyAnalysisPhase = "FIRST_PASS" | "RECOVERY";
export type MonthlyHttpPhase = MonthlyAnalysisPhase | "LOOKUP";
export type MonthlyCircuitStatus = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface MonthlyAutomationRun {
  report_period: string;
  paused_at: string | null;
  first_pass_completed_at?: string | null;
  summary_payload?: MonthlyAutomationSummary | null;
  is_manifested_pool?: boolean;
}

export interface MonthlyAutomationSummary {
  report_period: string;
  pool_total: number;
  processed_pool_total: number;
  eligible_total: number;
  generated_total: number;
  insufficient_evidence_total: number;
  policy_excluded_total: number;
  unresolved_pool_total: number;
  unresolved_member_total: number;
  pending_pool_total: number;
  error_categories: Record<string, number>;
  completed_at?: string | null;
}

type Db = {
  execute(query: unknown): Promise<{ rows: any[] }>;
  transaction?<T>(callback: (tx: Db) => Promise<T>): Promise<T>;
};

type CircuitConfig = {
  failureThreshold: number;
  windowMs: number;
  probeCount: number;
  cooldownMs: number;
  probeLeaseMs: number;
};

type ProbeReservation = { key: string; at: number };
type CircuitState = {
  status: MonthlyCircuitStatus;
  recentFailures: number[];
  probeReservations: ProbeReservation[];
  probeSuccesses: number;
  openedAt?: number;
  resumeHistory: Array<{ at: number; actorId: string; reason: string }>;
  config: CircuitConfig;
};

// These defaults are operational guardrails; each is configurable before the
// monthly run is created. The immutable snapshot is retained in circuit_state.
const DEFAULT_CIRCUIT_CONFIG: CircuitConfig = {
  failureThreshold: 10,
  windowMs: 5 * 60_000,
  probeCount: 1,
  cooldownMs: 2 * 60_000,
  probeLeaseMs: 15 * 60_000,
};

const ERROR_CATEGORIES = new Set([
  "PROVIDER", "API", "ENGINE", "NETWORK", "TIMEOUT", "UNKNOWN",
  "DATA", "IDENTITY", "MISSING", "PREPARATION", "CIRCUIT", "OTHER",
]);

function safeCode(code?: string | null): string | null {
  return code && /^[A-Z0-9_]{1,64}$/.test(code) ? code : code ? "UNCLASSIFIED" : null;
}

function safeCategory(category?: string): string | null {
  const normalized = category?.trim().toUpperCase();
  return normalized && ERROR_CATEGORIES.has(normalized) ? normalized : category ? "OTHER" : null;
}

function outcomeCategory(
  outcome: MonthlyFirstPassOutcome,
  errorCode: string | null,
  requested?: string | null,
): string | null {
  const explicit = safeCategory(requested ?? undefined);
  if (explicit) return explicit;
  if (outcome === "unknown") return "UNKNOWN";
  if (outcome === "missing") return "MISSING";
  if (outcome === "identity_error") return "IDENTITY";
  if (outcome === "insufficient_evidence") return "DATA";
  if (outcome === "policy_excluded") return "DATA";
  if (errorCode && commonServiceFailure(errorCode)) return "PROVIDER";
  if (errorCode?.includes("TIMEOUT")) return "TIMEOUT";
  if (errorCode?.includes("IDENTITY")) return "IDENTITY";
  if (errorCode?.includes("MISSING")) return "MISSING";
  if (errorCode?.includes("DATA")) return "DATA";
  return errorCode ? "OTHER" : null;
}

function configFromEnvironment(): CircuitConfig {
  const read = (name: string, fallback: number, min: number, max: number) => {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === "") return fallback;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(`${name} must be an integer in [${min}, ${max}].`);
    }
    return value;
  };
  return {
    failureThreshold: read("GROWTH_REPORT_CIRCUIT_FAILURE_THRESHOLD", DEFAULT_CIRCUIT_CONFIG.failureThreshold, 1, 100_000),
    windowMs: read("GROWTH_REPORT_CIRCUIT_WINDOW_MS", DEFAULT_CIRCUIT_CONFIG.windowMs, 1_000, 86_400_000),
    probeCount: read("GROWTH_REPORT_CIRCUIT_PROBE_COUNT", DEFAULT_CIRCUIT_CONFIG.probeCount, 1, 100),
    cooldownMs: read("GROWTH_REPORT_CIRCUIT_COOLDOWN_MS", DEFAULT_CIRCUIT_CONFIG.cooldownMs, 1_000, 86_400_000),
    probeLeaseMs: read("GROWTH_REPORT_CIRCUIT_PROBE_LEASE_MS", DEFAULT_CIRCUIT_CONFIG.probeLeaseMs, 1_000, 86_400_000),
  };
}

function isPeriod(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function kstDay(now: Date): number {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCDate();
}

function jsonObject<T>(value: unknown, fallback: T): T {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as T : fallback;
    } catch {
      return fallback;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as T : fallback;
}

function asCircuitState(value: unknown, config = configFromEnvironment()): CircuitState {
  const raw = jsonObject<Partial<CircuitState>>(value, {});
  const status = raw.status === "OPEN" || raw.status === "HALF_OPEN" ? raw.status : "CLOSED";
  return {
    status,
    recentFailures: Array.isArray(raw.recentFailures)
      ? raw.recentFailures.filter(Number.isFinite)
      : [],
    probeReservations: Array.isArray(raw.probeReservations)
      ? raw.probeReservations.filter((item): item is ProbeReservation =>
        !!item && typeof item.key === "string" && Number.isFinite(item.at))
      : [],
    probeSuccesses: Number.isSafeInteger(raw.probeSuccesses) && Number(raw.probeSuccesses) >= 0
      ? Number(raw.probeSuccesses) : 0,
    openedAt: Number.isFinite(raw.openedAt) ? Number(raw.openedAt) : undefined,
    resumeHistory: Array.isArray(raw.resumeHistory) ? raw.resumeHistory.slice(-19) : [],
    config: raw.config && Number.isSafeInteger(raw.config.failureThreshold)
      ? raw.config : config,
  };
}

function toIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : null;
}

async function inTransaction<T>(db: Db, callback: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction ? db.transaction(callback) : callback(db);
}

/** Read-only feature gate. Startup and ordinary requests never create schema. */
export async function isMonthlyAutomationSchemaReady(db: Db): Promise<boolean> {
  try {
    const result = await db.execute(sql`
      SELECT
        to_regclass('public.growth_report_monthly_runs') IS NOT NULL
          AND to_regclass('public.growth_report_monthly_run_pools') IS NOT NULL
          AND to_regclass('public.growth_report_notification_outbox') IS NOT NULL
          AND NOT EXISTS (
            SELECT required.table_name
            FROM (VALUES
              ('growth_report_monthly_runs','manifest_created_at'),
              ('growth_report_monthly_runs','first_pass_completed_at'),
              ('growth_report_monthly_runs','summary_payload'),
              ('growth_report_monthly_runs','paused_at'),
              ('growth_report_monthly_runs','pause_reason'),
              ('growth_report_monthly_runs','pause_epoch'),
              ('growth_report_monthly_runs','circuit_state'),
              ('growth_report_monthly_run_pools','cycle_id'),
              ('growth_report_monthly_run_pools','preparation_status'),
              ('growth_report_monthly_run_pools','preparation_error'),
              ('growth_report_eligible_targets','first_pass_completed_at'),
              ('growth_report_eligible_targets','first_pass_outcome'),
              ('growth_report_eligible_targets','first_pass_error_code'),
              ('growth_report_eligible_targets','first_pass_error_category'),
              ('growth_report_eligible_targets','recovery_epoch'),
              ('growth_report_eligible_targets','recovery_approved_at'),
              ('growth_report_eligible_targets','recovery_approved_by'),
              ('growth_report_eligible_targets','recovery_approval_reason'),
              ('growth_report_eligible_targets','recovery_attempt_limit'),
              ('growth_report_eligible_targets','first_pass_engine_requests'),
              ('growth_report_eligible_targets','recovery_engine_requests'),
              ('growth_report_eligible_targets','lookup_requests'),
              ('growth_reports','monthly_final_disposition'),
              ('growth_reports','monthly_disposition_version'),
              ('growth_report_notification_outbox','event_scope'),
              ('growth_report_notification_outbox','event_key')
            ) AS required(table_name, column_name)
            LEFT JOIN information_schema.columns column_info
              ON column_info.table_schema = 'public'
             AND column_info.table_name = required.table_name
             AND column_info.column_name = required.column_name
            WHERE column_info.column_name IS NULL
          )
        AS schema_ready
    `);
    const ready = result.rows[0]?.schema_ready;
    return ready === true || ready === "t";
  } catch {
    return false;
  }
}

export async function getMonthlyAutomationRunForCycle(
  db: Db,
  cycleId: string,
): Promise<MonthlyAutomationRun | null> {
  if (!await isMonthlyAutomationSchemaReady(db)) return null;
  const result = await db.execute(sql`
    SELECT
      run.report_period,
      run.paused_at,
      run.first_pass_completed_at,
      run.summary_payload,
      EXISTS (
        SELECT 1 FROM growth_report_monthly_run_pools member
        WHERE member.report_period = run.report_period
          AND member.swimming_pool_id = cycle.swimming_pool_id
      ) AS is_manifested_pool
    FROM growth_report_cycles cycle
    JOIN growth_report_monthly_runs run
      ON run.report_period = cycle.report_period
    WHERE cycle.id = ${cycleId}
    LIMIT 1
  `);
  if (!result.rows.length) return null; // Legacy cycle: retain its old behavior.
  const row = result.rows[0];
  return {
    report_period: String(row.report_period),
    paused_at: toIso(row.paused_at),
    first_pass_completed_at: toIso(row.first_pass_completed_at),
    summary_payload: row.summary_payload
      ? jsonObject<MonthlyAutomationSummary>(row.summary_payload, {} as MonthlyAutomationSummary)
      : null,
    is_manifested_pool: row.is_manifested_pool === true || row.is_manifested_pool === "t",
  };
}

/**
 * Freeze the eligible pool cohort only on KST day one. Existing manifests can
 * be read/resumed on any day; a missing historical month is never backfilled.
 */
export async function registerMonthlyAutomationRun(
  db: Db,
  params: { reportPeriod: string; poolIds: string[]; now?: Date },
): Promise<MonthlyAutomationRun | null> {
  if (!await isMonthlyAutomationSchemaReady(db) || !isPeriod(params.reportPeriod)) return null;
  const existing = await db.execute(sql`
    SELECT report_period, paused_at, first_pass_completed_at, summary_payload
    FROM growth_report_monthly_runs
    WHERE report_period = ${params.reportPeriod}
    LIMIT 1
  `);
  if (existing.rows.length) {
    const row = existing.rows[0];
    return {
      report_period: String(row.report_period),
      paused_at: toIso(row.paused_at),
      first_pass_completed_at: toIso(row.first_pass_completed_at),
      summary_payload: row.summary_payload
        ? jsonObject<MonthlyAutomationSummary>(row.summary_payload, {} as MonthlyAutomationSummary)
        : null,
    };
  }
  const now = params.now ?? new Date();
  if (kstDay(now) !== 1) return null;
  const poolIds = [...new Set(params.poolIds)];
  if (poolIds.some(id => !id.trim() || id.length > 255)) {
    throw new Error("Monthly manifest contains an invalid pool identifier.");
  }
  if (poolIds.length === 0) return null;

  const config = configFromEnvironment();
  return inTransaction(db, async tx => {
    const lock = await tx.execute(sql`
      SELECT report_period, paused_at, first_pass_completed_at, summary_payload
      FROM growth_report_monthly_runs
      WHERE report_period = ${params.reportPeriod}
      FOR UPDATE
    `);
    if (lock.rows.length) {
      const row = lock.rows[0];
      return {
        report_period: String(row.report_period),
        paused_at: toIso(row.paused_at),
        first_pass_completed_at: toIso(row.first_pass_completed_at),
        summary_payload: row.summary_payload
          ? jsonObject<MonthlyAutomationSummary>(row.summary_payload, {} as MonthlyAutomationSummary)
          : null,
      };
    }
    const inserted = await tx.execute(sql`
      INSERT INTO growth_report_monthly_runs
        (report_period, manifest_created_at, circuit_state)
      VALUES (
        ${params.reportPeriod},
        ${now.toISOString()},
        ${JSON.stringify({
          status: "CLOSED", recentFailures: [], probeReservations: [],
          probeSuccesses: 0, resumeHistory: [], config,
        })}::jsonb
      )
      ON CONFLICT (report_period) DO NOTHING
      RETURNING report_period
    `);
    if (!inserted.rows.length) {
      const raced = await tx.execute(sql`
        SELECT report_period, paused_at, first_pass_completed_at, summary_payload
        FROM growth_report_monthly_runs WHERE report_period = ${params.reportPeriod}
      `);
      const row = raced.rows[0];
      return row ? {
        report_period: String(row.report_period),
        paused_at: toIso(row.paused_at),
        first_pass_completed_at: toIso(row.first_pass_completed_at),
        summary_payload: row.summary_payload
          ? jsonObject<MonthlyAutomationSummary>(row.summary_payload, {} as MonthlyAutomationSummary)
          : null,
      } : null;
    }
    await tx.execute(sql`
      INSERT INTO growth_report_monthly_run_pools
        (report_period, swimming_pool_id, preparation_status)
      SELECT ${params.reportPeriod}, pool_id, 'pending'
      FROM unnest(${sql.param(poolIds)}::text[]) AS manifest(pool_id)
      ON CONFLICT (report_period, swimming_pool_id) DO NOTHING
    `);
    return {
      report_period: params.reportPeriod,
      paused_at: null,
      first_pass_completed_at: null,
      summary_payload: null,
    };
  });
}

export async function recordMonthlyPoolPreparation(
  db: Db,
  params: { reportPeriod: string; poolId: string; cycleId?: string | null; errorCode?: string },
): Promise<boolean> {
  if (!await isMonthlyAutomationSchemaReady(db) || !isPeriod(params.reportPeriod)) return false;
  const errorCode = safeCode(params.errorCode);
  if (!errorCode && !params.cycleId) return false;
  const result = errorCode
    ? await db.execute(sql`
        UPDATE growth_report_monthly_run_pools member
        SET preparation_status = 'failed',
            preparation_error = ${errorCode},
            cycle_id = ${params.cycleId ?? null},
            updated_at = NOW()
        WHERE member.report_period = ${params.reportPeriod}
          AND member.swimming_pool_id = ${params.poolId}
          AND member.preparation_status <> 'sealed'
          AND EXISTS (
            SELECT 1 FROM growth_report_monthly_runs run
            WHERE run.report_period = member.report_period
              AND run.first_pass_completed_at IS NULL
          )
        RETURNING member.swimming_pool_id
      `)
    : await db.execute(sql`
        UPDATE growth_report_monthly_run_pools member
        SET cycle_id = cycle.id,
            preparation_status = 'sealed',
            preparation_error = NULL,
            updated_at = NOW()
        FROM growth_report_cycles cycle
        WHERE member.report_period = ${params.reportPeriod}
          AND member.swimming_pool_id = ${params.poolId}
          AND member.preparation_status <> 'sealed'
          AND cycle.id = ${params.cycleId!}
          AND cycle.swimming_pool_id = member.swimming_pool_id
          AND cycle.report_period = member.report_period
          AND cycle.eligibility_sealed_at IS NOT NULL
          AND cycle.eligible_total IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM growth_report_monthly_runs run
            WHERE run.report_period = member.report_period
              AND run.first_pass_completed_at IS NULL
          )
        RETURNING member.swimming_pool_id
      `);
  if (result.rows.length) return true;
  if (!errorCode) {
    const existing = await db.execute(sql`
      SELECT 1 FROM growth_report_monthly_run_pools
      WHERE report_period = ${params.reportPeriod}
        AND swimming_pool_id = ${params.poolId}
        AND cycle_id = ${params.cycleId!}
        AND preparation_status = 'sealed'
      LIMIT 1
    `);
    return existing.rows.length > 0;
  }
  return false;
}

export async function recordMonthlyFirstPassOutcome(
  db: Db,
  params: {
    cycleId: string;
    studentId: string;
    outcome: MonthlyFirstPassOutcome;
    errorCode?: string | null;
    errorCategory?: string;
  },
): Promise<"recorded" | "already_recorded" | "conflict" | "not_found"> {
  if (!await isMonthlyAutomationSchemaReady(db)) return "not_found";
  const errorCode = safeCode(params.errorCode);
  const category = outcomeCategory(params.outcome, errorCode, params.errorCategory);
  const monthlyNoticeUnresolved = params.outcome === "identity_error" &&
    errorCode === "MONTHLY_NOTICE_UNRESOLVED" && category === "DATA";
  return inTransaction(db, async tx => {
    const existing = await tx.execute(sql`
      SELECT target.first_pass_outcome
      FROM growth_report_eligible_targets target
      JOIN growth_report_cycles cycle ON cycle.id = target.cycle_id
      JOIN growth_report_monthly_runs run ON run.report_period = cycle.report_period
      JOIN growth_report_monthly_run_pools member
        ON member.report_period = run.report_period
       AND member.swimming_pool_id = cycle.swimming_pool_id
       AND member.cycle_id = cycle.id
       AND member.preparation_status = 'sealed'
      WHERE target.cycle_id = ${params.cycleId}
        AND target.student_id = ${params.studentId}
        AND run.first_pass_completed_at IS NULL
      FOR UPDATE OF target
    `);
    if (!existing.rows.length) return "not_found";
    const prior = existing.rows[0].first_pass_outcome as MonthlyFirstPassOutcome | null;
    if (prior !== null) return prior === params.outcome ? "already_recorded" : "conflict";

    const result = await tx.execute(sql`
      UPDATE growth_report_eligible_targets target
      SET first_pass_completed_at = NOW(),
          first_pass_outcome = ${params.outcome},
          first_pass_error_code = ${errorCode},
          first_pass_error_category = ${category}
      FROM growth_report_cycles cycle
      WHERE target.cycle_id = ${params.cycleId}
        AND target.student_id = ${params.studentId}
        AND cycle.id = target.cycle_id
        AND target.first_pass_completed_at IS NULL
        AND (
          (${params.outcome} = 'generated' AND EXISTS (
            SELECT 1 FROM growth_reports report
            WHERE report.cycle_id = cycle.id
              AND report.student_id = target.student_id
              AND report.swimming_pool_id = cycle.swimming_pool_id
              AND report.report_period = cycle.report_period
              AND report.deleted_at IS NULL
              AND report.analysis_status IN
                ('COMPLETE','COMPLETE_WITH_QUESTIONS_AVAILABLE','COMPLETE_WITH_PARENT_EVIDENCE')
              AND report.monthly_final_disposition IS NULL
              AND report.analysis_uncertain_at IS NULL
              AND report.product_status IN ('REVIEW_REQUIRED','APPROVED','READY_TO_SEND','PUBLISHED')
          ))
          OR
          (${params.outcome} = 'insufficient_evidence' AND EXISTS (
            SELECT 1 FROM growth_reports report
            WHERE report.cycle_id = cycle.id
              AND report.student_id = target.student_id
              AND report.swimming_pool_id = cycle.swimming_pool_id
              AND report.report_period = cycle.report_period
              AND report.deleted_at IS NULL
              AND report.analysis_status = 'DATA_ACCUMULATING'
              AND report.monthly_final_disposition = 'INSUFFICIENT_EVIDENCE'
              AND report.monthly_disposition_version IS NOT NULL
              AND report.analysis_uncertain_at IS NULL
          ))
          OR
          (${params.outcome} = 'failed' AND EXISTS (
            SELECT 1 FROM growth_reports report
            WHERE report.cycle_id = cycle.id
              AND report.student_id = target.student_id
              AND report.deleted_at IS NULL
              AND report.product_status = 'FAILED'
              AND report.analysis_uncertain_at IS NULL
          ))
          OR
          (${params.outcome} = 'unknown' AND EXISTS (
            SELECT 1 FROM growth_reports report
            WHERE report.cycle_id = cycle.id
              AND report.student_id = target.student_id
              AND report.deleted_at IS NULL
              AND report.analysis_uncertain_at IS NOT NULL
          ))
          OR
          (${params.outcome} = 'policy_excluded' AND target.policy_excluded_at IS NOT NULL)
          OR
          (${params.outcome} = 'missing' AND NOT EXISTS (
            SELECT 1 FROM growth_reports report
            WHERE report.cycle_id = cycle.id
              AND report.student_id = target.student_id
              AND report.deleted_at IS NULL
          ))
          OR
          (${params.outcome} = 'identity_error' AND EXISTS (
            SELECT 1 FROM growth_reports report
            WHERE report.cycle_id = cycle.id
              AND report.student_id = target.student_id
              AND report.deleted_at IS NULL
              AND (
                (report.swimming_pool_id IS DISTINCT FROM cycle.swimming_pool_id
                  OR report.report_period IS DISTINCT FROM cycle.report_period)
                OR (
                  ${monthlyNoticeUnresolved}
                  AND report.swimming_pool_id = cycle.swimming_pool_id
                  AND report.report_period = cycle.report_period
                  AND report.analysis_status = 'DATA_ACCUMULATING'
                  AND report.analysis_response_payload->>'analysis_status' = 'DATA_ACCUMULATING'
                  AND report.analysis_response_payload->>'request_id' = report.analysis_request_id
                  AND report.analysis_uncertain_at IS NULL
                  AND report.exclusion_code IS NULL
                  AND target.policy_excluded_at IS NULL
                  AND report.product_status NOT IN (
                    'APPROVED','READY_TO_SEND','PUBLISHED','EXCLUDED','DISCARDED'
                  )
                  AND NOT COALESCE((${insufficientStoredReport()}), FALSE)
                )
              )
          ))
        )
      RETURNING target.student_id
    `);
    return result.rows.length ? "recorded" : "not_found";
  });
}

function requestPhaseColumn(phase: MonthlyHttpPhase): "first_pass_engine_requests" | "recovery_engine_requests" | "lookup_requests" {
  switch (phase) {
    case "FIRST_PASS": return "first_pass_engine_requests";
    case "RECOVERY": return "recovery_engine_requests";
    case "LOOKUP": return "lookup_requests";
  }
}

function targetKey(cycleId: string, studentId: string): string {
  return `${cycleId}:${studentId}`;
}

function commonServiceFailure(code?: string): boolean {
  return !!code && (
    ["NETWORK_ERROR", "COMPOSITION_TIMEOUT", "ENGINE_URL_NOT_CONFIGURED",
      "ENGINE_SECRET_NOT_CONFIGURED", "ENGINE_TIMEOUT", "ENGINE_SERVICE_UNAVAILABLE",
      "ENGINE_CONNECTION_ERROR", "ENGINE_RATE_LIMITED", "ENGINE_OVERLOADED"].includes(code) ||
    /^ENGINE_HTTP_5\d\d$/.test(code)
  );
}

async function loadRunForCycle(db: Db, cycleId: string, lock = false) {
  return db.execute(sql`
    SELECT run.report_period, run.paused_at, run.pause_reason, run.pause_epoch,
           run.circuit_state, member.swimming_pool_id,
           member.cycle_id AS manifest_cycle_id,
           member.preparation_status,
           cycle.id AS actual_cycle_id,
           cycle.report_period AS cycle_report_period
    FROM growth_report_cycles cycle
    JOIN growth_report_monthly_runs run ON run.report_period = cycle.report_period
    LEFT JOIN growth_report_monthly_run_pools member
      ON member.report_period = run.report_period
     AND member.swimming_pool_id = cycle.swimming_pool_id
    WHERE cycle.id = ${cycleId}
    LIMIT 1
    ${lock ? sql.raw("FOR UPDATE OF run") : sql``}
  `);
}

async function pauseExpiredProbe(db: Db, reportPeriod: string): Promise<void> {
  await inTransaction(db, async tx => {
    const result = await tx.execute(sql`
      SELECT circuit_state
      FROM growth_report_monthly_runs
      WHERE report_period = ${reportPeriod}
      FOR UPDATE
    `);
    if (!result.rows.length) return;
    const state = asCircuitState(result.rows[0].circuit_state);
    const now = Date.now();
    if (state.status !== "HALF_OPEN" ||
        !state.probeReservations.some(item => item.at + state.config.probeLeaseMs <= now)) return;
    state.status = "OPEN";
    state.openedAt = now;
    state.probeReservations = [];
    await tx.execute(sql`
      UPDATE growth_report_monthly_runs
      SET paused_at = NOW(),
          pause_reason = 'PROBE_TIMEOUT',
          pause_epoch = pause_epoch + 1,
          circuit_state = ${JSON.stringify(state)}::jsonb
      WHERE report_period = ${reportPeriod}
    `);
  });
}

export async function canDispatchMonthlyAnalysis(
  db: Db,
  params: { cycleId: string; studentId: string; phase: MonthlyAnalysisPhase },
): Promise<boolean> {
  if (!await isMonthlyAutomationSchemaReady(db)) return false;
  const result = await db.execute(sql`
    SELECT
      run.paused_at,
      run.report_period,
      run.circuit_state,
      member.swimming_pool_id AS manifest_pool_id,
      member.cycle_id AS manifest_cycle_id,
      member.preparation_status,
      target.student_id AS target_student_id,
      target.first_pass_completed_at,
      target.first_pass_outcome,
      target.recovery_epoch,
      target.recovery_attempt_limit,
      target.recovery_approved_at,
      report.product_status,
      report.analysis_uncertain_at,
      report.analysis_request_id,
      report.analysis_response_payload
    FROM growth_report_cycles cycle
    JOIN growth_report_monthly_runs run ON run.report_period = cycle.report_period
    LEFT JOIN growth_report_monthly_run_pools member
      ON member.report_period = run.report_period
     AND member.swimming_pool_id = cycle.swimming_pool_id
    LEFT JOIN growth_report_eligible_targets target
      ON target.cycle_id = cycle.id AND target.student_id = ${params.studentId}
    LEFT JOIN growth_reports report
      ON report.cycle_id = cycle.id
     AND report.student_id = ${params.studentId}
     AND report.deleted_at IS NULL
    WHERE cycle.id = ${params.cycleId}
    LIMIT 1
  `);
  if (!result.rows.length) {
    const cycleCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM growth_report_cycles WHERE id = ${params.cycleId}
      ) AS cycle_exists,
      EXISTS (
        SELECT 1 FROM growth_report_cycles cycle
        JOIN growth_report_monthly_runs run ON run.report_period = cycle.report_period
        WHERE cycle.id = ${params.cycleId}
      ) AS has_run
    `);
    const cycleExists = cycleCheck.rows[0]?.cycle_exists === true ||
      cycleCheck.rows[0]?.cycle_exists === "t";
    const hasRun = cycleCheck.rows[0]?.has_run === true || cycleCheck.rows[0]?.has_run === "t";
    return cycleExists && !hasRun;
  }
  const row = result.rows[0];
  if (row.preparation_status !== "sealed" || row.manifest_cycle_id !== params.cycleId ||
      !row.manifest_pool_id || !row.target_student_id ||
      (row.first_pass_completed_at != null && params.phase === "FIRST_PASS")) {
    return false;
  }
  if (params.phase === "RECOVERY") {
    const configuredLimit = Number(process.env["GROWTH_REPORT_MONTHLY_RECOVERY_MAX_EPOCHS"] ?? 3);
    if (!Number.isSafeInteger(configuredLimit) || configuredLimit < 1) return false;
    const attemptLimit = Number(row.recovery_attempt_limit ?? configuredLimit);
    if (row.first_pass_outcome !== "failed" ||
        row.recovery_approved_at == null ||
        Number(row.recovery_epoch ?? 0) < 1 ||
        Number(row.recovery_epoch ?? 0) > attemptLimit ||
        !["OPEN", "READY_FOR_ANALYSIS", "PREANALYZING", "ANALYZING"].includes(String(row.product_status ?? "")) ||
        row.analysis_uncertain_at != null) return false;
  } else if (row.first_pass_completed_at != null) {
    return false;
  }
  const state = asCircuitState(row.circuit_state);
  const rawResponse = jsonObject<Record<string, unknown> | null>(row.analysis_response_payload, null);
  const hasCachedResponse = !!rawResponse &&
    typeof rawResponse.request_id === "string" &&
    rawResponse.request_id === row.analysis_request_id;
  if (row.paused_at != null || state.status === "OPEN") return hasCachedResponse;
  if (state.status === "HALF_OPEN") {
    const now = Date.now();
    const reservations = state.probeReservations.filter(item => item.at + state.config.probeLeaseMs > now);
    if (reservations.length !== state.probeReservations.length) {
      await pauseExpiredProbe(db, row.report_period);
      return false;
    }
    return hasCachedResponse ||
      (reservations.length < state.config.probeCount &&
        !reservations.some(item => item.key === targetKey(params.cycleId, params.studentId)));
  }
  return true;
}

export async function recordMonthlyHttpAttempt(
  db: Db,
  params: { cycleId: string; studentId: string; phase: MonthlyHttpPhase },
): Promise<boolean> {
  if (!await isMonthlyAutomationSchemaReady(db)) return false;
  const column = requestPhaseColumn(params.phase);
  return inTransaction(db, async tx => {
    const runResult = await loadRunForCycle(tx, params.cycleId, true);
    if (!runResult.rows.length) return true; // Legacy cycle, no monthly counter.
    const run = runResult.rows[0];
    if (run.preparation_status !== "sealed" || run.manifest_cycle_id !== params.cycleId ||
        run.actual_cycle_id !== params.cycleId) return false;
    if (params.phase === "LOOKUP") {
      const count = await tx.execute(sql`
        UPDATE growth_report_eligible_targets
        SET lookup_requests = lookup_requests + 1
        WHERE cycle_id = ${params.cycleId} AND student_id = ${params.studentId}
        RETURNING student_id
      `);
      return count.rows.length > 0;
    }
    const rowResult = await tx.execute(sql`
      SELECT first_pass_completed_at, first_pass_outcome, recovery_epoch,
             recovery_attempt_limit, recovery_approved_at, analysis_uncertain_at,
             report.product_status
      FROM growth_report_eligible_targets target
      LEFT JOIN growth_reports report
        ON report.cycle_id = target.cycle_id
       AND report.student_id = target.student_id
       AND report.deleted_at IS NULL
      WHERE target.cycle_id = ${params.cycleId}
        AND target.student_id = ${params.studentId}
      FOR UPDATE OF target
    `);
    const target = rowResult.rows[0];
    if (!target) return false;
    if (params.phase === "FIRST_PASS" && target.first_pass_completed_at != null) return false;
    const configuredLimit = Number(process.env["GROWTH_REPORT_MONTHLY_RECOVERY_MAX_EPOCHS"] ?? 3);
    if (params.phase === "RECOVERY" &&
        (target.first_pass_outcome !== "failed" || target.recovery_approved_at == null ||
          target.analysis_uncertain_at != null ||
          Number(target.recovery_epoch ?? 0) < 1 ||
          !["OPEN", "READY_FOR_ANALYSIS", "PREANALYZING", "ANALYZING"].includes(String(target.product_status ?? "")) ||
          !Number.isSafeInteger(configuredLimit) || configuredLimit < 1 ||
          Number(target.recovery_epoch ?? 0) > Number(target.recovery_attempt_limit ?? configuredLimit))) {
      return false;
    }

    const state = asCircuitState(run.circuit_state);
    if (run.paused_at != null || state.status === "OPEN") return false;
    if (state.status === "HALF_OPEN") {
      const now = Date.now();
      const key = targetKey(params.cycleId, params.studentId);
      const reservations = state.probeReservations.filter(item => item.at + state.config.probeLeaseMs > now);
      if (reservations.length !== state.probeReservations.length ||
          reservations.length >= state.config.probeCount ||
          reservations.some(item => item.key === key)) return false;
      state.probeReservations = [...reservations, { key, at: now }];
    }
    const updated = params.phase === "RECOVERY"
      ? await tx.execute(sql`
          UPDATE growth_report_eligible_targets
          SET recovery_engine_requests = recovery_engine_requests + 1,
              recovery_approved_at = NULL
          WHERE cycle_id = ${params.cycleId}
            AND student_id = ${params.studentId}
            AND recovery_approved_at = ${target.recovery_approved_at}
            AND recovery_epoch = ${target.recovery_epoch}
            AND recovery_epoch >= 1
            AND recovery_epoch <= COALESCE(recovery_attempt_limit, ${configuredLimit})
          RETURNING student_id
        `)
      : await tx.execute(sql`
          UPDATE growth_report_eligible_targets
          SET ${sql.raw(column)} = ${sql.raw(column)} + 1
          WHERE cycle_id = ${params.cycleId} AND student_id = ${params.studentId}
          RETURNING student_id
        `);
    if (!updated.rows.length) return false;
    if (state.status === "HALF_OPEN") {
      await tx.execute(sql`
        UPDATE growth_report_monthly_runs
        SET circuit_state = ${JSON.stringify(state)}::jsonb
        WHERE report_period = ${run.report_period}
      `);
    }
    return true;
  });
}

export async function recordMonthlyServiceOutcome(
  db: Db,
  params: { cycleId: string; errorCode?: string; success: boolean },
): Promise<{ paused: boolean }> {
  if (!await isMonthlyAutomationSchemaReady(db)) return { paused: false };
  const code = safeCode(params.errorCode);
  return inTransaction(db, async tx => {
    const result = await loadRunForCycle(tx, params.cycleId, true);
    if (!result.rows.length || result.rows[0].preparation_status !== "sealed" ||
        result.rows[0].manifest_cycle_id !== params.cycleId) return { paused: false };
    const run = result.rows[0];
    const state = asCircuitState(run.circuit_state);
    if (state.status === "OPEN" || run.paused_at != null) return { paused: true };
    const now = Date.now();
    const probeIndex = state.status === "HALF_OPEN"
      ? state.probeReservations.findIndex(item => item.key.startsWith(`${params.cycleId}:`))
      : -1;
    if (params.success) {
      state.recentFailures = [];
      if (state.status === "HALF_OPEN" && probeIndex >= 0) {
        state.probeReservations.splice(probeIndex, 1);
        state.probeSuccesses += 1;
        if (state.probeSuccesses >= state.config.probeCount &&
            state.probeReservations.length === 0) {
          state.status = "CLOSED";
          state.probeSuccesses = 0;
          state.openedAt = undefined;
        }
      }
    } else if (commonServiceFailure(code)) {
      state.recentFailures = state.recentFailures
        .filter(at => at > now - state.config.windowMs);
      state.recentFailures.push(now);
      if (state.status === "HALF_OPEN" ||
          state.recentFailures.length >= state.config.failureThreshold) {
        state.status = "OPEN";
        state.openedAt = now;
        state.probeReservations = [];
        await tx.execute(sql`
          UPDATE growth_report_monthly_runs
          SET paused_at = NOW(),
              pause_reason = ${code},
              pause_epoch = pause_epoch + 1,
              circuit_state = ${JSON.stringify(state)}::jsonb
          WHERE report_period = ${run.report_period}
        `);
        return { paused: true };
      }
    } else {
      // A definitive provider response other than a shared-service failure is
      // a liveness probe success, but is not retained as a breaker failure.
      if (state.status !== "HALF_OPEN" || probeIndex < 0) return { paused: false };
      state.probeReservations.splice(probeIndex, 1);
      state.probeSuccesses += 1;
      if (state.probeSuccesses >= state.config.probeCount &&
          state.probeReservations.length === 0) {
        state.status = "CLOSED";
        state.probeSuccesses = 0;
        state.openedAt = undefined;
      }
    }
    await tx.execute(sql`
      UPDATE growth_report_monthly_runs
      SET circuit_state = ${JSON.stringify(state)}::jsonb
      WHERE report_period = ${run.report_period}
    `);
    return { paused: false };
  });
}

function qualifiedStoredReport() {
  return sql`
    report.product_status = 'PUBLISHED'
    OR (
      report.product_status IN ('REVIEW_REQUIRED','READY_TO_SEND','APPROVED')
      AND report.analysis_status IN
        ('COMPLETE','COMPLETE_WITH_QUESTIONS_AVAILABLE','COMPLETE_WITH_PARENT_EVIDENCE')
      AND report.analysis_uncertain_at IS NULL
      AND report.eligibility_version >= 4
      AND report.attendance_count >= 3
      AND report.source_event_count >= 1
      AND report.exclusion_code IS NULL
      AND jsonb_typeof(report.report_content) = 'object'
      AND report.report_content <> '{}'::jsonb
      AND jsonb_typeof(report.report_fact_package) = 'object'
      AND report.report_fact_package <> '{}'::jsonb
      AND jsonb_typeof(report.sns_summary) = 'object'
      AND report.sns_summary <> '{}'::jsonb
      AND report.report_fact_package->>'grounding_result' IN ('PASS','REVISED_PASS')
      AND report.report_fact_package->>'growth_framing_result' IN ('PASS','REVISED_PASS')
    )
  `;
}

function insufficientStoredReport() {
  return sql`
    report.monthly_final_disposition = 'INSUFFICIENT_EVIDENCE'
    AND report.monthly_disposition_version = 1
    AND report.analysis_status = 'DATA_ACCUMULATING'
    AND report.analysis_uncertain_at IS NULL
    AND report.exclusion_code IS NULL
    AND report.product_status IN ('REVIEW_REQUIRED','READY_TO_SEND','APPROVED','PUBLISHED')
    AND report.report_content->>'summary_text' =
      '이번 달은 성장 판단에 필요한 충분한 변화 근거가 아직 축적되지 않았습니다.'
  `;
}

async function buildSummary(
  tx: Db,
  reportPeriod: string,
  live = false,
): Promise<MonthlyAutomationSummary | null> {
  const result = await tx.execute(sql`
    SELECT
      COUNT(DISTINCT member.swimming_pool_id)::int AS pool_total,
      COUNT(DISTINCT member.swimming_pool_id)
        FILTER (WHERE member.preparation_status IN ('sealed','failed'))::int AS processed_pool_total,
      COUNT(DISTINCT member.swimming_pool_id)
        FILTER (WHERE member.preparation_status = 'pending')::int AS pending_pool_total,
      COUNT(target.student_id)
        FILTER (WHERE target.first_pass_outcome = 'generated')::int AS generated_total,
      COUNT(target.student_id)
        FILTER (WHERE target.first_pass_outcome = 'insufficient_evidence')::int AS insufficient_evidence_total,
      COUNT(target.student_id)
        FILTER (WHERE target.first_pass_outcome = 'policy_excluded')::int AS policy_excluded_total,
      COUNT(target.student_id)
        FILTER (WHERE target.first_pass_outcome IN ('failed','unknown','missing','identity_error')
          OR target.first_pass_completed_at IS NULL)::int AS unresolved_member_total,
      COUNT(DISTINCT member.swimming_pool_id)
        FILTER (WHERE member.preparation_status = 'failed')::int AS preparation_failed_pool_total,
      COUNT(DISTINCT member.swimming_pool_id)
        FILTER (WHERE member.preparation_status = 'sealed'
          AND target.first_pass_outcome IN ('failed','unknown','missing','identity_error')
              OR member.preparation_status = 'sealed'
                AND target.first_pass_completed_at IS NULL)::int AS target_blocked_pool_total
    FROM growth_report_monthly_run_pools member
    LEFT JOIN growth_report_cycles cycle
      ON cycle.id = member.cycle_id AND cycle.report_period = member.report_period
    LEFT JOIN growth_report_eligible_targets target
      ON target.cycle_id = cycle.id
    WHERE member.report_period = ${reportPeriod}
  `);
  const row = result.rows[0];
  if (!row) return null;
  const categoriesResult = await tx.execute(sql`
    SELECT category, SUM(amount)::int AS total
    FROM (
      SELECT COALESCE(target.first_pass_error_category, 'OTHER') AS category, COUNT(*) AS amount
      FROM growth_report_monthly_run_pools member
      JOIN growth_report_cycles cycle ON cycle.id = member.cycle_id
      JOIN growth_report_eligible_targets target ON target.cycle_id = cycle.id
      WHERE member.report_period = ${reportPeriod}
        AND target.first_pass_outcome IN ('failed','unknown','missing','identity_error')
      GROUP BY COALESCE(target.first_pass_error_category, 'OTHER')
      UNION ALL
      SELECT 'PREPARATION' AS category, COUNT(*) AS amount
      FROM growth_report_monthly_run_pools
      WHERE report_period = ${reportPeriod} AND preparation_status = 'failed'
    ) grouped
    GROUP BY category
  `);
  const categories: Record<string, number> = {};
  for (const item of categoriesResult.rows) {
    const category = safeCategory(String(item.category)) ?? "OTHER";
    categories[category] = Number(item.total ?? 0);
  }
  // Denominators are aggregated once per manifest pool, independently of the
  // target join above. Summing after joining n targets multiplies each cycle's
  // eligible_total by n; SUM(DISTINCT) is also invalid for equal-sized pools.
  const eligibleResult = await tx.execute(sql`
    SELECT COALESCE(SUM(cycle.eligible_total), 0)::int AS eligible_total
    FROM growth_report_monthly_run_pools member
    JOIN growth_report_cycles cycle
      ON cycle.id = member.cycle_id
     AND cycle.report_period = member.report_period
     AND cycle.swimming_pool_id = member.swimming_pool_id
    WHERE member.report_period = ${reportPeriod}
      AND member.preparation_status = 'sealed'
      AND cycle.eligibility_sealed_at IS NOT NULL
      AND cycle.eligible_total IS NOT NULL
  `);
  const summary: MonthlyAutomationSummary = {
    report_period: reportPeriod,
    pool_total: Number(row.pool_total ?? 0),
    processed_pool_total: Number(row.processed_pool_total ?? 0),
    eligible_total: Number(eligibleResult.rows[0]?.eligible_total ?? 0),
    generated_total: Number(row.generated_total ?? 0),
    insufficient_evidence_total: Number(row.insufficient_evidence_total ?? 0),
    policy_excluded_total: Number(row.policy_excluded_total ?? 0),
    unresolved_pool_total: Number(row.preparation_failed_pool_total ?? 0) +
      Number(row.target_blocked_pool_total ?? 0),
    unresolved_member_total: Number(row.unresolved_member_total ?? 0),
    pending_pool_total: Number(row.pending_pool_total ?? 0),
    error_categories: categories,
  };
  if (!live) return summary;

  const qualified = qualifiedStoredReport();
  const insufficient = insufficientStoredReport();
  const targetResolved = sql`
    (target.policy_excluded_at IS NOT NULL
      OR COALESCE((${qualified}), FALSE)
      OR COALESCE((${insufficient}), FALSE))
  `;
  const liveResult = await tx.execute(sql`
    SELECT
      COUNT(target.student_id)
        FILTER (WHERE target.policy_excluded_at IS NOT NULL)::int AS policy_excluded_total,
      COUNT(target.student_id)
        FILTER (WHERE target.policy_excluded_at IS NULL AND ${qualified})::int AS generated_total,
      COUNT(target.student_id)
        FILTER (WHERE target.policy_excluded_at IS NULL AND ${insufficient})::int
        AS insufficient_evidence_total,
      COUNT(target.student_id)
        FILTER (WHERE target.student_id IS NOT NULL AND NOT ${targetResolved})::int
        AS unresolved_member_total,
      COUNT(DISTINCT member.swimming_pool_id)
        FILTER (WHERE member.preparation_status = 'sealed'
          AND target.student_id IS NOT NULL AND NOT ${targetResolved})::int
        AS target_blocked_pool_total
    FROM growth_report_monthly_run_pools member
    LEFT JOIN growth_report_cycles cycle ON cycle.id = member.cycle_id
    LEFT JOIN growth_report_eligible_targets target ON target.cycle_id = cycle.id
    LEFT JOIN growth_reports report
      ON report.cycle_id = cycle.id AND report.student_id = target.student_id
     AND report.swimming_pool_id = cycle.swimming_pool_id
     AND report.report_period = cycle.report_period AND report.deleted_at IS NULL
    WHERE member.report_period = ${reportPeriod}
  `);
  const liveRow = liveResult.rows[0] ?? {};
  summary.policy_excluded_total = Number(liveRow.policy_excluded_total ?? 0);
  summary.generated_total = Number(liveRow.generated_total ?? 0);
  summary.insufficient_evidence_total = Number(liveRow.insufficient_evidence_total ?? 0);
  summary.unresolved_member_total = Number(liveRow.unresolved_member_total ?? 0);
  summary.unresolved_pool_total =
    Number(row.preparation_failed_pool_total ?? 0) +
    Number(liveRow.target_blocked_pool_total ?? 0);
  const liveCategories = await tx.execute(sql`
    SELECT category, SUM(amount)::int AS total
    FROM (
      SELECT COALESCE(target.first_pass_error_category, 'OTHER') AS category, COUNT(*) AS amount
      FROM growth_report_monthly_run_pools member
      JOIN growth_report_cycles cycle ON cycle.id = member.cycle_id
      JOIN growth_report_eligible_targets target ON target.cycle_id = cycle.id
      LEFT JOIN growth_reports report
        ON report.cycle_id = cycle.id AND report.student_id = target.student_id
       AND report.swimming_pool_id = cycle.swimming_pool_id
       AND report.report_period = cycle.report_period AND report.deleted_at IS NULL
      WHERE member.report_period = ${reportPeriod}
        AND target.first_pass_outcome IN ('failed','unknown','missing','identity_error')
        AND target.policy_excluded_at IS NULL
        AND NOT ${targetResolved}
      GROUP BY COALESCE(target.first_pass_error_category, 'OTHER')
      UNION ALL
      SELECT 'PREPARATION', COUNT(*)
      FROM growth_report_monthly_run_pools
      WHERE report_period = ${reportPeriod} AND preparation_status = 'failed'
    ) grouped
    GROUP BY category
  `);
  summary.error_categories = {};
  for (const item of liveCategories.rows) {
    const category = safeCategory(String(item.category)) ?? "OTHER";
    summary.error_categories[category] = Number(item.total ?? 0);
  }
  return summary;
}

async function canFinishFirstPass(tx: Db, reportPeriod: string): Promise<boolean> {
  const result = await tx.execute(sql`
    SELECT NOT EXISTS (
      SELECT 1
      FROM growth_report_monthly_run_pools member
      LEFT JOIN growth_report_cycles cycle ON cycle.id = member.cycle_id
      WHERE member.report_period = ${reportPeriod}
        AND (
          member.preparation_status = 'pending'
          OR (member.preparation_status = 'sealed' AND (
            cycle.id IS NULL
            OR cycle.report_period IS DISTINCT FROM member.report_period
            OR cycle.swimming_pool_id IS DISTINCT FROM member.swimming_pool_id
            OR cycle.eligibility_sealed_at IS NULL
            OR cycle.eligible_total IS NULL
            OR cycle.eligible_total <> (
              SELECT COUNT(*) FROM growth_report_eligible_targets target
              WHERE target.cycle_id = cycle.id
            )
            OR EXISTS (
              SELECT 1 FROM growth_report_eligible_targets target
              WHERE target.cycle_id = cycle.id
                AND target.first_pass_completed_at IS NULL
            )
          ))
        )
    ) AS can_finish,
    EXISTS (
      SELECT 1 FROM growth_report_monthly_run_pools member
      WHERE member.report_period = ${reportPeriod}
    ) AS has_manifest
  `);
  return (result.rows[0]?.can_finish === true || result.rows[0]?.can_finish === "t") &&
    (result.rows[0]?.has_manifest === true || result.rows[0]?.has_manifest === "t");
}

export async function finishMonthlyFirstPass(
  db: Db,
  reportPeriod: string,
): Promise<MonthlyAutomationSummary | null> {
  if (!await isMonthlyAutomationSchemaReady(db) || !isPeriod(reportPeriod)) return null;
  return inTransaction(db, async tx => {
    const runResult = await tx.execute(sql`
      SELECT first_pass_completed_at, summary_payload, paused_at
      FROM growth_report_monthly_runs
      WHERE report_period = ${reportPeriod}
      FOR UPDATE
    `);
    if (!runResult.rows.length) return null;
    const run = runResult.rows[0];
    if (run.first_pass_completed_at) {
      return jsonObject<MonthlyAutomationSummary | null>(run.summary_payload, null);
    }
    if (run.paused_at != null || !await canFinishFirstPass(tx, reportPeriod)) return null;
    const summary = await buildSummary(tx, reportPeriod);
    if (!summary) return null;
    summary.completed_at = new Date().toISOString();
    await tx.execute(sql`
      UPDATE growth_report_monthly_runs
      SET first_pass_completed_at = NOW(),
          summary_payload = ${JSON.stringify(summary)}::jsonb
      WHERE report_period = ${reportPeriod}
        AND first_pass_completed_at IS NULL
        AND paused_at IS NULL
    `);
    return summary;
  });
}

export async function getMonthlyAutomationSummary(
  db: Db,
  reportPeriod: string,
  options: { live?: boolean } = {},
): Promise<MonthlyAutomationSummary | null> {
  if (!await isMonthlyAutomationSchemaReady(db) || !isPeriod(reportPeriod)) return null;
  const run = await db.execute(sql`
    SELECT first_pass_completed_at, summary_payload
    FROM growth_report_monthly_runs
    WHERE report_period = ${reportPeriod}
  `);
  if (!run.rows.length) return null;
  if (!options.live && run.rows[0].first_pass_completed_at && run.rows[0].summary_payload) {
    return jsonObject<MonthlyAutomationSummary>(run.rows[0].summary_payload, {} as MonthlyAutomationSummary);
  }
  return buildSummary(db, reportPeriod, options.live === true);
}

export async function listMonthlyAutomationExceptions(
  db: Db,
  params: { reportPeriod: string; poolId?: string; category?: string; limit?: number; offset?: number },
): Promise<{ rows: any[]; total: number }> {
  if (!await isMonthlyAutomationSchemaReady(db) || !isPeriod(params.reportPeriod)) {
    return { rows: [], total: 0 };
  }
  const limit = Number.isSafeInteger(params.limit) ? Math.max(1, Math.min(200, params.limit!)) : 50;
  const offset = Number.isSafeInteger(params.offset) ? Math.max(0, params.offset!) : 0;
  const category = safeCategory(params.category);
  const qualified = qualifiedStoredReport();
  const insufficient = insufficientStoredReport();
  const where = sql`
    member.report_period = ${params.reportPeriod}
    AND (
      member.preparation_status = 'failed'
      OR (
        target.first_pass_outcome IN ('failed','unknown','missing','identity_error')
        AND target.policy_excluded_at IS NULL
        AND NOT (
          COALESCE((${qualified}), FALSE)
          OR COALESCE((${insufficient}), FALSE)
        )
      )
    )
    ${params.poolId ? sql`AND member.swimming_pool_id = ${params.poolId}` : sql``}
    ${category ? sql`AND (
      (member.preparation_status = 'failed' AND ${category} = 'PREPARATION')
      OR target.first_pass_error_category = ${category}
    )` : sql``}
  `;
  const [rows, totals] = await Promise.all([
    db.execute(sql`
      SELECT member.report_period, member.swimming_pool_id,
             member.preparation_status, member.preparation_error,
             cycle.id AS cycle_id, target.student_id,
             target.policy_excluded_at,
             target.first_pass_outcome, target.first_pass_error_code,
             target.first_pass_error_category, target.recovery_epoch,
             target.recovery_attempt_limit, target.recovery_approved_at,
             target.first_pass_engine_requests, target.recovery_engine_requests,
             target.lookup_requests,
             report.id AS report_id, report.analysis_request_id,
             report.product_status, report.analysis_status,
             report.analysis_retry_count, report.analysis_uncertain_at,
             report.monthly_final_disposition, report.report_period,
             report.analysis_request_payload, report.analysis_identity_hash,
             report.snapshot_hash, report.exclusion_code,
             report.eligibility_version, report.attendance_count,
             report.source_event_count
      FROM growth_report_monthly_run_pools member
      LEFT JOIN growth_report_cycles cycle ON cycle.id = member.cycle_id
      LEFT JOIN growth_report_eligible_targets target ON target.cycle_id = cycle.id
      LEFT JOIN growth_reports report
        ON report.cycle_id = target.cycle_id
       AND report.student_id = target.student_id
        AND report.swimming_pool_id = member.swimming_pool_id
        AND report.report_period = member.report_period
       AND report.deleted_at IS NULL
      WHERE ${where}
      ORDER BY member.swimming_pool_id, target.first_pass_error_category,
               target.student_id
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM growth_report_monthly_run_pools member
      LEFT JOIN growth_report_cycles cycle ON cycle.id = member.cycle_id
      LEFT JOIN growth_report_eligible_targets target ON target.cycle_id = cycle.id
      LEFT JOIN growth_reports report
        ON report.cycle_id = cycle.id AND report.student_id = target.student_id
       AND report.swimming_pool_id = cycle.swimming_pool_id
       AND report.report_period = cycle.report_period AND report.deleted_at IS NULL
      WHERE ${where}
    `),
  ]);
  const enrichedRows = rows.rows.map((row: any) => {
    const {
      analysis_request_payload: requestPayload,
      ...publicFields
    } = row;
    const configuredLimit = Number(process.env["GROWTH_REPORT_MONTHLY_RECOVERY_MAX_EPOCHS"] ?? 3);
    const attemptLimit = Number(row.recovery_attempt_limit ?? configuredLimit);
    let identitySafe = false;
    try {
      const request = jsonObject<Record<string, any>>(requestPayload, {});
      identitySafe = typeof row.report_id === "string" &&
        row.first_pass_outcome === "failed" &&
        row.policy_excluded_at == null &&
        row.product_status === "FAILED" &&
        row.analysis_uncertain_at == null &&
        (row.monthly_final_disposition == null || row.monthly_final_disposition === "FAILED") &&
        row.exclusion_code == null &&
        Number.isSafeInteger(configuredLimit) && configuredLimit > 0 &&
        Number(row.recovery_epoch ?? 0) < attemptLimit &&
        request.request_id === row.analysis_request_id &&
        request.report_id === row.report_id &&
        request.context?.student_id === row.student_id &&
        request.context?.pool_id === row.swimming_pool_id &&
        request.context?.report_period === row.report_period &&
        request.snapshot?.payload_hash === row.snapshot_hash &&
        (["PREANALYSIS", "FINAL_ANALYSIS"] as const).some(stage =>
          getGrowthReportAnalysisIdentityHash(request, stage) === row.analysis_identity_hash);
    } catch {
      identitySafe = false;
    }
    return {
      ...publicFields,
      first_pass_engine_requests: Number(row.first_pass_engine_requests ?? 0),
      recovery_engine_requests: Number(row.recovery_engine_requests ?? 0),
      lookup_requests: Number(row.lookup_requests ?? 0),
      recovery_allowed: identitySafe,
    };
  });
  return { rows: enrichedRows, total: Number(totals.rows[0]?.total ?? 0) };
}

export async function resumeMonthlyAutomationRun(
  db: Db,
  params: { reportPeriod: string; actorId: string; reason: string },
): Promise<boolean> {
  if (!await isMonthlyAutomationSchemaReady(db) || !isPeriod(params.reportPeriod) ||
      !params.actorId.trim() || !params.reason.trim()) return false;
  const now = Date.now();
  return inTransaction(db, async tx => {
    const result = await tx.execute(sql`
      SELECT paused_at, pause_epoch, circuit_state
      FROM growth_report_monthly_runs
      WHERE report_period = ${params.reportPeriod}
      FOR UPDATE
    `);
    if (!result.rows.length || result.rows[0].paused_at == null) return false;
    const state = asCircuitState(result.rows[0].circuit_state);
    const pausedAt = new Date(result.rows[0].paused_at).getTime();
    if (!Number.isFinite(pausedAt) || now - pausedAt < state.config.cooldownMs) return false;
    state.status = "HALF_OPEN";
    state.probeReservations = [];
    state.probeSuccesses = 0;
    state.resumeHistory = [
      ...state.resumeHistory,
      { at: now, actorId: params.actorId.slice(0, 128), reason: params.reason.trim().slice(0, 500) },
    ].slice(-20);
    await tx.execute(sql`
      UPDATE growth_report_monthly_runs
      SET paused_at = NULL,
          pause_reason = NULL,
          circuit_state = ${JSON.stringify(state)}::jsonb
      WHERE report_period = ${params.reportPeriod}
    `);
    return true;
  });
}