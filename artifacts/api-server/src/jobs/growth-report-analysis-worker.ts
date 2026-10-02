/**
 * growth-report-analysis-worker.ts
 *
 * Background worker that drives ENGINE analysis flow:
 *
 *   Pass 1 — OPEN → PREANALYZING → ENGINE → QUESTION_AVAILABLE | READY_FOR_ANALYSIS | PARTIAL | FAILED
 *   Pass 2 — READY_FOR_ANALYSIS → ANALYZING → ENGINE → REVIEW_REQUIRED | FAILED
 *
 * Concurrency protection:
 *   - A conditional growth_reports update grants one token-fenced lease per report.
 *   - Lease renewal keeps slow ENGINE calls owned; every persistence CAS is fenced.
 *
 * Stale response protection:
 *   - analysis_request_id is written to DB before the ENGINE call.
 *   - persistEngineResult uses request_id + analysis_claim_token (CAS).
 *   - A response that loses the race is rejected as StaleEngineResponseError.
 *
 * Retry policy:
 *   - Retryable ENGINE errors → rollback product_status → retried on next worker run.
 *   - Non-retryable errors    → transition to FAILED (no infinite retry).
 *   - analysis_retry_count guards against repeated retries beyond the configured max.
 *
 * Audit (§40):
 *   ENGINE_ANALYSIS_STARTED / ENGINE_ANALYSIS_SUCCEEDED / ENGINE_ANALYSIS_FAILED /
 *   ENGINE_ANALYSIS_STALE_RESPONSE_REJECTED
 *
 * Privacy (§41):
 *   Audit metadata contains only request_id, analysis_status, error_code.
 *   Raw report text is never logged.
 */

import cron from "node-cron";
import { sql } from "drizzle-orm";
import { superAdminDb } from "@workspace/db";
import { acquireLock, releaseLock, recordHeartbeat, refreshLock } from "../lib/schedulerLock.js";
import { sendOperatorAlert } from "../lib/sendOperatorAlert.js";
import { transitionReportStatus, InvalidTransitionError } from "../lib/growth-report-service.js";
import { notifyPoolEvent } from "../lib/pg-realtime.js";
import {
  buildAnalysisSnapshot,
  queryDiariesForEligibility,
  queryAttendanceForEligibility,
} from "../lib/growth-report-snapshot-builder.js";
import {
  evaluateStudentGrowthReportEligibility,
  getGrowthReportAnalysisPeriod,
} from "../lib/growth-report-eligibility.js";
import {
  analyzeGrowthReport,
  isRetryableEngineError,
  EngineCallError,
  type GrowthReportAnalysisResponse,
  type GrowthReportAnalysisRequest,
} from "../lib/growth-report-engine-client.js";
import {
  persistEngineResult,
  auditStaleRejected,
  StaleEngineResponseError,
  GroundingFailError,
  EngineResponseValidationError,
  persistAnalysisRequest,
  persistAnalysisResponse,
  markAnalysisCallStarted,
  recordAnalysisUncertain,
  recordAnalysisAttemptFailure,
  isGrowthReportParentInputWindowOpen,
  type AnalysisStage,
} from "../lib/growth-report-result-handler.js";
import {
  getGrowthReportRetryDelayMs,
  isGrowthReportRequestIdentityForStage,
  resolveGrowthReportAnalysisIdentity,
} from "../lib/growth-report-analysis-identity.js";
import {
  claimGrowthReportAnalysis,
  getAnalysisLeaseMs,
  renewGrowthReportAnalysisClaim,
} from "../lib/growth-report-analysis-claim.js";
import { saveAiTrace }  from "../lib/ai-trace-service.js";
import { AI_FEATURE }   from "../lib/ai-feature-enum.js";
import {
  getMonthlyAutomationRunForCycle,
  canDispatchMonthlyAnalysis,
  recordMonthlyFirstPassOutcome,
  recordMonthlyServiceOutcome,
  recordMonthlyHttpAttempt,
  finishMonthlyFirstPass,
  isMonthlyAutomationSchemaReady,
  type MonthlyFirstPassOutcome,
} from "../lib/growth-report-monthly-run.js";
import { notifyMonthlySuperAdminEvent } from "../utils/notify.js";

// ─── Configuration ────────────────────────────────────────────────────────────

const ANALYSIS_LOCK    = "growth-report-analysis";
const LOCK_TTL_SECONDS = 600;  // 10 min (generous for slow GPT)

async function notifyMonthlyCircuitPause(
  db: any,
  cycleId: string,
  errorCode: string,
): Promise<void> {
  const paused = await db.execute(sql`
    SELECT cycle.report_period, run.pause_epoch
    FROM growth_report_cycles cycle
    JOIN growth_report_monthly_runs run ON run.report_period = cycle.report_period
    WHERE cycle.id = ${cycleId}
      AND run.paused_at IS NOT NULL
  `);
  const row = paused.rows[0] as any;
  if (!row || Number(row.pause_epoch) < 1) return;
  await notifyMonthlySuperAdminEvent({
    reportPeriod: row.report_period,
    eventType: "PAUSED",
    pauseEpoch: Number(row.pause_epoch),
    summary: { error_code: errorCode },
  });
}

export async function restoreUndispatchedMonthlyClaim(
  db: any,
  params: {
    reportId: string;
    cycleId: string;
    studentId: string;
    originalStatus: string;
    requestId: string;
    claimToken: string;
    stage: AnalysisStage;
    monthlyTracked: boolean;
    monthlyPhase: "FIRST_PASS" | "RECOVERY";
    admissionRecorded: boolean;
  },
): Promise<boolean> {
  const activeStatus = params.stage === "PREANALYSIS" ? "PREANALYZING" : "ANALYZING";
  return db.transaction(async (tx: any) => {
    const owned = await tx.execute(sql`
      SELECT id
      FROM growth_reports
      WHERE id = ${params.reportId}
        AND cycle_id = ${params.cycleId}
        AND product_status = ${activeStatus}::gr_product_status_enum
        AND analysis_request_id = ${params.requestId}
        AND analysis_claim_token = ${params.claimToken}
        AND analysis_lease_until > now()
        AND analysis_response_payload IS NULL
        AND analysis_uncertain_at IS NULL
        AND deleted_at IS NULL
      FOR UPDATE
    `);
    if (!owned.rows.length) return false;

    if (params.monthlyTracked && params.admissionRecorded) {
      const target = await tx.execute(sql`
        SELECT first_pass_completed_at, first_pass_engine_requests,
               recovery_engine_requests, recovery_approved_at,
               recovery_approved_by, recovery_approval_reason, recovery_epoch,
               recovery_attempt_limit
        FROM growth_report_eligible_targets
        WHERE cycle_id = ${params.cycleId}
          AND student_id = ${params.studentId}
        FOR UPDATE
      `);
      const state = target.rows[0] as any;
      if (!state) return false;
      if (params.monthlyPhase === "RECOVERY") {
        const epoch = Number(state.recovery_epoch ?? 0);
        const count = Number(state.recovery_engine_requests ?? 0);
        if (
          state.recovery_approved_at != null ||
          state.recovery_approved_by == null ||
          !String(state.recovery_approval_reason ?? "").trim() ||
          epoch < 1 ||
          epoch > Number(state.recovery_attempt_limit ?? 0) ||
          count < 1
        ) return false;
        const refunded = await tx.execute(sql`
          UPDATE growth_report_eligible_targets
          SET recovery_engine_requests = recovery_engine_requests - 1,
              recovery_approved_at = NOW()
          WHERE cycle_id = ${params.cycleId}
            AND student_id = ${params.studentId}
            AND recovery_epoch = ${epoch}
            AND recovery_engine_requests = ${count}
            AND recovery_approved_at IS NULL
          RETURNING student_id
        `);
        if (!refunded.rows.length) return false;
      } else {
        const count = Number(state.first_pass_engine_requests ?? 0);
        if (state.first_pass_completed_at != null || count < 1) return false;
        const refunded = await tx.execute(sql`
          UPDATE growth_report_eligible_targets
          SET first_pass_engine_requests = first_pass_engine_requests - 1
          WHERE cycle_id = ${params.cycleId}
            AND student_id = ${params.studentId}
            AND first_pass_completed_at IS NULL
            AND first_pass_engine_requests = ${count}
          RETURNING student_id
        `);
        if (!refunded.rows.length) return false;
      }
    }

    const restored = await tx.execute(sql`
      UPDATE growth_reports
      SET product_status = ${params.originalStatus}::gr_product_status_enum,
          analysis_call_started_at = NULL,
          analysis_claim_token = NULL,
          analysis_lease_until = NULL,
          updated_at = now()
      WHERE id = ${params.reportId}
        AND cycle_id = ${params.cycleId}
        AND product_status = ${activeStatus}::gr_product_status_enum
        AND analysis_request_id = ${params.requestId}
        AND analysis_claim_token = ${params.claimToken}
        AND analysis_lease_until > now()
        AND analysis_response_payload IS NULL
        AND analysis_uncertain_at IS NULL
        AND deleted_at IS NULL
      RETURNING id
    `);
    if (!restored.rows.length) throw new Error("MONTHLY_UNDISPATCHED_RESTORE_FENCE_LOST");
    return true;
  }).catch((error: any) => {
    if (error?.message === "MONTHLY_UNDISPATCHED_RESTORE_FENCE_LOST") return false;
    throw error;
  });
}

/**
 * GROWTH_REPORT_ANALYSIS_BATCH_SIZE — cron 실행당 최대 처리 report 수 (default 10).
 * 대량 report가 있는 경우 환경변수로 제어:
 *   GROWTH_REPORT_ANALYSIS_BATCH_SIZE=1  → 1건씩 처리 (최대 안전)
 *   GROWTH_REPORT_ANALYSIS_BATCH_SIZE=0  → 비활성화 (auto analysis 없음)
 */
function getBatchSize(): number {
  const raw = process.env["GROWTH_REPORT_ANALYSIS_BATCH_SIZE"];
  if (raw === undefined) return 200;         // default: 200 (Standard 인스턴스 기준)
  const n = Number(raw);
  return isNaN(n) ? 200 : Math.max(0, n);  // 0 = disabled
}

/**
 * GROWTH_REPORT_ANALYSIS_CONCURRENCY — 1회 배치 내 동시 처리 report 수.
 * 기본값 5. 엔진 부하에 따라 환경변수로 조절.
 *   1  → 기존 sequential (안전 모드)
 *   5  → 5개 동시 (기본 권장)
 *   10 → 10개 동시 (엔진 여유 있을 때)
 */
function getConcurrency(): number {
  const raw = process.env["GROWTH_REPORT_ANALYSIS_CONCURRENCY"];
  if (raw === undefined) return 20;
  const n = Number(raw);
  return isNaN(n) || n < 1 ? 20 : Math.min(n, 40); // 최대 40
}

/**
 * GROWTH_REPORT_ANALYSIS_AUTO_ENABLED — auto cron 실행 허용 여부.
 * Fail-closed: 명시적으로 "true"일 때만 활성화.
 * env missing / "false" / 기타 값 → disabled.
 * Super Admin의 수동 trigger(POST /super/growth-reports/:id/analyze)는 영향 없음.
 */
function isAutoAnalysisEnabled(): boolean {
  return process.env["GROWTH_REPORT_ANALYSIS_AUTO_ENABLED"] === "true";
}

function getMaxRetryCount(): number {
  const raw = Number(process.env["GROWTH_REPORT_MAX_RETRY_COUNT"]);
  return raw > 0 ? raw : 3;
}

// ─── Report fetch ─────────────────────────────────────────────────────────────

interface PendingReport {
  report: {
    id: string;
    student_id: string;
    swimming_pool_id: string;
    cycle_id: string;
    report_period: string;
    report_type: string | null;
    product_status: string;
    analysis_request_id: string | null;
    analysis_request_payload: unknown;
    analysis_response_payload: unknown;
    analysis_identity_hash: string | null;
    snapshot_hash: string | null;
    analysis_retry_count: number;
    analysis_call_started_at: string | null;
    analysis_uncertain_at: string | null;
    teacher_reviewed_by: string | null;
    teacher_reviewed_at: string | null;
  };
  cycle: {
    id: string;
    analysis_from: string | null;
    analysis_cutoff_at: string;
    parent_input_open_at: string;
    parent_input_close_at: string;
    report_period: string;
    timezone: string;
  };
  stage: AnalysisStage;
  monthlyPhase: "FIRST_PASS" | "RECOVERY";
}

async function fetchPendingReports(db: any, limit?: number): Promise<PendingReport[]> {
  const batchLimit = limit !== undefined ? limit : getBatchSize();
  if (batchLimit === 0) return [];  // 0 = disabled

  const rows = await db.execute(sql`
    SELECT
      gr.id,
      gr.student_id,
      gr.swimming_pool_id,
      gr.cycle_id,
      gr.report_period,
      gr.report_type,
      gr.product_status,
      gr.analysis_request_id,
      gr.analysis_request_payload,
      gr.analysis_response_payload,
      gr.analysis_identity_hash,
      gr.snapshot_hash,
      COALESCE(gr.analysis_retry_count, 0)  AS analysis_retry_count,
      gr.analysis_call_started_at,
      gr.analysis_uncertain_at,
      gr.teacher_reviewed_by,
      gr.teacher_reviewed_at,
      grc.id                                AS cycle_db_id,
      grc.analysis_from,
      grc.analysis_cutoff_at,
      grc.parent_input_open_at,
      grc.parent_input_close_at,
      grc.report_period                     AS cycle_report_period,
      grc.timezone
    FROM growth_reports gr
    INNER JOIN growth_report_cycles grc ON grc.id = gr.cycle_id
    WHERE gr.product_status IN (
        'OPEN', 'READY_FOR_ANALYSIS', 'REGENERATING', 'PREANALYZING', 'ANALYZING'
      )
      AND gr.deleted_at IS NULL
      AND gr.analysis_uncertain_at IS NULL
      AND (gr.analysis_next_attempt_at IS NULL OR gr.analysis_next_attempt_at <= now())
      AND (
        gr.analysis_claim_token IS NULL
        OR gr.analysis_lease_until IS NULL
        OR gr.analysis_lease_until <= now()
      )
      AND (
        (gr.report_type IS NOT NULL AND gr.report_type <> 'monthly')
        OR EXISTS (
          SELECT 1
          FROM growth_report_cycles sealed_cycle
          INNER JOIN growth_report_eligible_targets target
            ON target.cycle_id = sealed_cycle.id
           AND target.student_id = gr.student_id
          WHERE sealed_cycle.id = gr.cycle_id
            AND sealed_cycle.swimming_pool_id = gr.swimming_pool_id
            AND sealed_cycle.report_period = gr.report_period
            AND sealed_cycle.eligibility_sealed_at IS NOT NULL
            AND target.policy_excluded_at IS NULL
        )
      )
    ORDER BY gr.updated_at ASC
    LIMIT ${batchLimit}
  `);

  return (rows.rows as any[]).map((r): PendingReport => {
    const toIso = (v: unknown) =>
      v instanceof Date ? v.toISOString() : String(v ?? "");
    return {
      report: {
        id:                   r.id as string,
        student_id:           r.student_id as string,
        swimming_pool_id:     r.swimming_pool_id as string,
        cycle_id:             r.cycle_id as string,
        report_period:        r.report_period as string,
        report_type:          (r.report_type ?? null) as string | null,
        product_status:       r.product_status as string,
        analysis_request_id:  (r.analysis_request_id ?? null) as string | null,
        analysis_request_payload: r.analysis_request_payload ?? null,
        analysis_response_payload: r.analysis_response_payload ?? null,
        analysis_identity_hash: (r.analysis_identity_hash ?? null) as string | null,
        snapshot_hash:        (r.snapshot_hash ?? null) as string | null,
        analysis_retry_count: Number(r.analysis_retry_count ?? 0),
        analysis_call_started_at: r.analysis_call_started_at
          ? toIso(r.analysis_call_started_at) : null,
        analysis_uncertain_at: r.analysis_uncertain_at
          ? toIso(r.analysis_uncertain_at) : null,
        teacher_reviewed_by:  (r.teacher_reviewed_by ?? null) as string | null,
        teacher_reviewed_at:  (r.teacher_reviewed_at ?? null) as string | null,
      },
      cycle: {
        id:                    (r.cycle_db_id ?? r.cycle_id) as string,
        analysis_from:         (r.analysis_from ?? null)      as string | null,
        analysis_cutoff_at:    toIso(r.analysis_cutoff_at),
        parent_input_open_at:  toIso(r.parent_input_open_at),
        parent_input_close_at: toIso(r.parent_input_close_at),
        report_period:         r.cycle_report_period          as string,
        timezone:              (r.timezone ?? "Asia/Seoul")   as string,
      },
      stage: (r.product_status === "OPEN" || r.product_status === "REGENERATING" ||
        r.product_status === "PREANALYZING") ? "PREANALYSIS" : "FINAL_ANALYSIS",
      monthlyPhase: "FIRST_PASS",
    };
  });
}

// ─── Single report analysis ───────────────────────────────────────────────────

type OneReportResult =
  | { ok: true }
  | { ok: false; errorCode: string; httpStatus: number; engineDetails?: unknown; skipped?: boolean };

async function analyzeOneReport(
  db: any,
  pending: PendingReport,
  options: { monthlyPhase?: "FIRST_PASS" | "RECOVERY" } = {},
): Promise<OneReportResult> {
  const isMonthly = pending.report.report_type === "monthly" || pending.report.report_type === null;
  const monthlyRun = isMonthly
    ? await getMonthlyAutomationRunForCycle(db, pending.report.cycle_id)
    : null;
  const monthlyState = monthlyRun
    ? await db.execute(sql`
        SELECT first_pass_completed_at
        FROM growth_report_eligible_targets
        WHERE cycle_id = ${pending.report.cycle_id}
          AND student_id = ${pending.report.student_id}
        LIMIT 1
      `)
    : null;
  const monthlyPhase = options.monthlyPhase ??
    (monthlyState?.rows[0]?.first_pass_completed_at ? "RECOVERY" : "FIRST_PASS");
  const hasCachedResponse = pending.report.analysis_response_payload !== null &&
    pending.report.analysis_response_payload !== undefined;
  if (monthlyRun && !hasCachedResponse && !(await canDispatchMonthlyAnalysis(db, {
    cycleId: pending.report.cycle_id,
    studentId: pending.report.student_id,
    phase: monthlyPhase,
  }))) {
    return { ok: false, errorCode: "MONTHLY_AUTOMATION_PAUSED", httpStatus: 0, skipped: true };
  }
  const leaseMs = getAnalysisLeaseMs();
  const claimToken = await claimGrowthReportAnalysis(db, {
    reportId: pending.report.id,
    expectedStatus: pending.report.product_status,
    leaseMs,
    requireSealedMonthlyTarget:
      pending.report.report_type === "monthly" || pending.report.report_type === null,
  });
  if (!claimToken) {
    return { ok: false, errorCode: "STALE_ANALYSIS_CLAIM", httpStatus: 0 };
  }

  let leaseLost = false;
  let renewalInFlight = false;
  const renewalTimer = setInterval(() => {
    if (renewalInFlight || leaseLost) return;
    renewalInFlight = true;
    void renewGrowthReportAnalysisClaim(db, {
      reportId: pending.report.id,
      claimToken,
      leaseMs,
    }).then((renewed) => {
      if (!renewed) leaseLost = true;
    }).catch(() => {
      leaseLost = true;
    }).finally(() => {
      renewalInFlight = false;
    });
  }, Math.max(5_000, Math.floor(leaseMs / 3)));
  renewalTimer.unref?.();
  try {
    let result: OneReportResult;
    try {
      result = await analyzeClaimedReport(
        db, pending, claimToken, () => leaseLost, Boolean(monthlyRun), monthlyPhase,
      );
    } catch (analysisErr) {
      if (!monthlyRun) throw analysisErr;
      const failureCode = "ANALYSIS_WORKER_EXCEPTION";
      const recovered = await db.transaction(async (tx: any) => {
        const owned = await tx.execute(sql`
          SELECT product_status, analysis_request_id, analysis_response_payload,
                 analysis_uncertain_at
          FROM growth_reports
          WHERE id = ${pending.report.id}
            AND cycle_id = ${pending.report.cycle_id}
            AND analysis_claim_token = ${claimToken}
            AND analysis_lease_until > now()
            AND deleted_at IS NULL
          FOR UPDATE
        `);
        const row = owned.rows[0] as any;
        if (!row || row.analysis_uncertain_at != null ||
            !["OPEN", "READY_FOR_ANALYSIS", "REGENERATING", "PREANALYZING", "ANALYZING"].includes(
              String(row.product_status),
            )) return "stale";
        let cached: any = row.analysis_response_payload;
        if (typeof cached === "string") {
          try { cached = JSON.parse(cached); } catch { cached = null; }
        }
        const hasMatchingResponse = cached?.request_id === row.analysis_request_id &&
          cached?.report_id === pending.report.id;
        if (hasMatchingResponse) {
          if (monthlyRun && monthlyPhase === "FIRST_PASS") {
            await tx.execute(sql`
              UPDATE growth_report_eligible_targets target
              SET first_pass_error_code = 'RESULT_PERSISTENCE_RETRY',
                  first_pass_error_category = 'DATA'
              FROM growth_report_monthly_run_pools member
              WHERE target.cycle_id = ${pending.report.cycle_id}
                AND target.student_id = ${pending.report.student_id}
                AND target.first_pass_completed_at IS NULL
                AND member.cycle_id = target.cycle_id
                AND member.swimming_pool_id = ${pending.report.swimming_pool_id}
                AND member.preparation_status = 'sealed'
            `);
          }
          const released = await tx.execute(sql`
            UPDATE growth_reports
            SET analysis_claim_token = NULL, analysis_lease_until = NULL,
                updated_at = now()
            WHERE id = ${pending.report.id}
              AND analysis_claim_token = ${claimToken}
              AND analysis_lease_until > now()
              AND product_status IN (
                'OPEN', 'READY_FOR_ANALYSIS', 'REGENERATING', 'PREANALYZING', 'ANALYZING'
              )
              AND analysis_response_payload IS NOT NULL
              AND analysis_uncertain_at IS NULL
            RETURNING id
          `);
          return released.rows.length ? "cached" : "stale";
        }

        const failed = await tx.execute(sql`
          UPDATE growth_reports
          SET product_status = 'FAILED'::gr_product_status_enum,
              analysis_claim_token = NULL, analysis_lease_until = NULL,
              analysis_next_attempt_at = NULL, updated_at = now()
          WHERE id = ${pending.report.id}
            AND cycle_id = ${pending.report.cycle_id}
            AND analysis_claim_token = ${claimToken}
            AND analysis_lease_until > now()
            AND product_status IN (
              'OPEN', 'READY_FOR_ANALYSIS', 'REGENERATING', 'PREANALYZING', 'ANALYZING'
            )
            AND analysis_response_payload IS NULL
            AND analysis_uncertain_at IS NULL
            AND deleted_at IS NULL
          RETURNING id
        `);
        if (!failed.rows.length) return "stale";
        if (monthlyRun && monthlyPhase === "FIRST_PASS") {
          const outcome = await recordMonthlyFirstPassOutcome(tx, {
            cycleId: pending.report.cycle_id,
            studentId: pending.report.student_id,
            outcome: "failed",
            errorCode: failureCode,
            errorCategory: "OTHER",
          });
          if (outcome !== "recorded" && outcome !== "already_recorded") {
            throw new Error("MONTHLY_EXCEPTION_ACCOUNTING_FAILED");
          }
        }
        return "failed";
      });
      if (recovered === "stale") {
        return { ok: false, errorCode: "STALE_ANALYSIS_CLAIM", httpStatus: 0 };
      }
      console.error(
        `[gr3-worker] report=${pending.report.id} ${failureCode}` +
        (recovered === "cached" ? " response retained for cached reconciliation" : " terminal FAILED"),
      );
      result = recovered === "cached"
        ? { ok: false, errorCode: "RESULT_PERSISTENCE_RETRY", httpStatus: 0, skipped: true }
        : { ok: false, errorCode: failureCode, httpStatus: 0 };
    }
    const resultErrorCode = result.ok ? null : result.errorCode;
    if (monthlyRun && monthlyPhase === "FIRST_PASS" &&
        resultErrorCode !== "STALE_ANALYSIS_CLAIM" &&
        resultErrorCode !== "STALE_RESPONSE" &&
        resultErrorCode !== "MONTHLY_AUTOMATION_PAUSED" &&
        resultErrorCode !== "MONTHLY_ATTEMPT_ACCOUNTING_FAILED" &&
        !("skipped" in result && result.skipped)) {
      let outcome: MonthlyFirstPassOutcome = result.ok ? "unknown" : (
        result.errorCode === "ENGINE_REQUEST_UNKNOWN" ? "unknown" : "failed"
      );
      if (result.ok) {
        const persisted = await db.execute(sql`
          SELECT product_status, monthly_final_disposition,
            monthly_disposition_version, analysis_status
          FROM growth_reports
          WHERE id = ${pending.report.id}
            AND cycle_id = ${pending.report.cycle_id}
          LIMIT 1
        `);
        const saved = persisted.rows[0] as any;
        if (saved?.analysis_status === "DATA_ACCUMULATING") {
          outcome = saved.monthly_final_disposition === "INSUFFICIENT_EVIDENCE" &&
              saved.monthly_disposition_version != null &&
              saved.product_status === "REVIEW_REQUIRED"
            ? "insufficient_evidence"
            : "identity_error";
        } else if (
          ["REVIEW_REQUIRED", "APPROVED", "READY_TO_SEND", "PUBLISHED"].includes(saved?.product_status) &&
          ["COMPLETE", "COMPLETE_WITH_QUESTIONS_AVAILABLE", "COMPLETE_WITH_PARENT_EVIDENCE"].includes(saved?.analysis_status) &&
          saved?.monthly_final_disposition == null
        ) {
          outcome = "generated";
        }
      }
      await recordMonthlyFirstPassOutcome(db, {
        cycleId: pending.report.cycle_id,
        studentId: pending.report.student_id,
        outcome,
        errorCode: result.ok
          ? outcome === "identity_error" ? "MONTHLY_NOTICE_UNRESOLVED" : undefined
          : result.errorCode,
        errorCategory: outcome === "identity_error" ? "DATA" : undefined,
      });
    }
    return result;
  } finally {
    clearInterval(renewalTimer);
  }
}

async function analyzeClaimedReport(
  db: any,
  { report, cycle, stage }: PendingReport,
  claimToken: string,
  hasLostLease: () => boolean,
  monthlyTracked: boolean,
  monthlyPhase: "FIRST_PASS" | "RECOVERY",
): Promise<OneReportResult> {
  const maxRetry = getMaxRetryCount();
  const attemptRetryLimit = monthlyTracked
    ? Math.min(maxRetry, report.analysis_retry_count + 1)
    : maxRetry;

  // Guard: too many retries → skip this report
  if (report.analysis_retry_count >= attemptRetryLimit) {
    await db.execute(sql`
      UPDATE growth_reports
      SET product_status = 'FAILED'::gr_product_status_enum,
          analysis_claim_token = NULL,
          analysis_lease_until = NULL,
          analysis_next_attempt_at = NULL,
          updated_at = now()
      WHERE id = ${report.id}
        AND product_status = ${report.product_status}::gr_product_status_enum
        AND COALESCE(analysis_retry_count, 0) >= ${attemptRetryLimit}
        AND analysis_claim_token = ${claimToken}
        AND analysis_lease_until > now()
        AND deleted_at IS NULL
    `);
    console.warn(
      `[gr3-worker] report=${report.id} exceeded max retries (${attemptRetryLimit}), terminal FAILED`,
    );
    return { ok: false, errorCode: "MAX_RETRY_EXCEEDED", httpStatus: 0 };
  }

  // ─── ELIGIBILITY GATE (상태전환 전) ───────────────────────────────────────
  // 순서: claim → 재원 판정 → attendance → source → eligibility → (EXCLUDED return | 계속)
  //       → transitionReportStatus(PREANALYZING) → snapshot → ENGINE
  //
  // EXCLUDED 학생은 PREANALYZING / ANALYZING 상태를 절대 거치지 않음:
  //   - 관리자 화면 "분석 중" 오표시 방지
  //   - eligibility 판정 중 crash → report가 OPEN 상태 유지 → 재실행 시 재판정 (안전)
  //   - AI lifecycle 완전 분리
  //
  // report_month_start = nextMonthStr (= analysis_period_end_exclusive):
  //   enrolled_at <= report_month_start AND (left_at IS NULL OR left_at >= report_month_start)
  //   예) report_month=2026-09 → report_month_start=2026-09-01
  //       8월 15일 입회 학생: enrolled_at(2026-08-15) <= 2026-09-01 → 재원O
  const isSealedMonthlyTarget =
    report.report_type === "monthly" || report.report_type === null;
  if (!isSealedMonthlyTarget) {
    const analysisPeriod   = getGrowthReportAnalysisPeriod(cycle.report_period);
    const periodFrom       = analysisPeriod.startDate;          // report_period is analysis month M-1
    const analysisFrom     = cycle.analysis_from
      ? (cycle.analysis_from > periodFrom ? cycle.analysis_from : periodFrom)
      : periodFrom;
    const cutoffDate       = analysisPeriod.endDateExclusive;

    // report_month_start = next month after analysis month; require both
    // history overlap with the analysis month and continued membership on day 1.
    const reportMonthStart = cutoffDate;

    // (A) 재원 판정 — report_month_start 기준
    //     enrolled_at <= report_month_start : report_month_start 이전 입회
    //     left_at IS NULL OR left_at >= report_month_start : report_month 시작일 기준 재원
    const reregRows = await db.execute(sql`
      SELECT 1
      FROM students s
      JOIN student_class_history sch ON sch.student_id = s.id
      JOIN class_groups cg ON cg.id = sch.class_group_id
      WHERE s.id                = ${report.student_id}
        AND s.status            = 'active'
        AND s.deleted_at        IS NULL
        AND cg.swimming_pool_id = ${report.swimming_pool_id}
        AND sch.enrolled_at     <  ${cutoffDate}::date
        AND (sch.left_at IS NULL OR sch.left_at >= ${periodFrom}::date)
        AND sch.enrolled_at     <= ${reportMonthStart}::date
        AND (sch.left_at IS NULL OR sch.left_at >= ${reportMonthStart}::date)
      LIMIT 1
    `);
    const reregistered = reregRows.rows.length > 0;

    // (B) 인정수업 — scheduled non-absent classes + completed makeups;
    //     explicit scheduled attendance is counted once, linked makeup rows are deduped.
    const attendanceCount = await queryAttendanceForEligibility(
      db,
      report.student_id,
      report.swimming_pool_id,
      periodFrom,
      cutoffDate,
    );

    // (C) source_event_count — queryDiariesForEligibility로 snapshot predicate와 완전 일치 보장
    const sourceEventCount = await queryDiariesForEligibility(
      db,
      report.student_id,
      report.swimming_pool_id,
      cutoffDate,
      analysisFrom,
    );

    // (D) eligibility 판정
    const eligResult = evaluateStudentGrowthReportEligibility({
      attendanceCount,
      sourceEventCount,
      reregistered,
    });

    const eligVersionNum = eligResult.eligibility_version;
    if (!eligResult.eligible) {
      // EXCLUDED — CAS against the exact pending status/request we selected;
      // never overwrite a concurrently published or otherwise terminal report.
      const excluded = await db.execute(sql`
        UPDATE growth_reports
        SET product_status      = 'EXCLUDED'::gr_product_status_enum,
            exclusion_code      = ${eligResult.exclusion_code},
            attendance_count    = ${attendanceCount},
            source_event_count  = ${sourceEventCount},
            eligibility_version = ${eligVersionNum},
            analysis_claim_token = NULL,
            analysis_lease_until = NULL,
            analysis_next_attempt_at = NULL,
            updated_at          = now()
        WHERE id                = ${report.id}
          AND product_status   = ${report.product_status}::gr_product_status_enum
          AND analysis_request_id IS NOT DISTINCT FROM ${report.analysis_request_id}
          AND analysis_claim_token = ${claimToken}
          AND analysis_lease_until > now()
          AND deleted_at IS NULL
        RETURNING id
      `);
      if (!(excluded.rows as any[] | undefined)?.length) {
        return { ok: false, errorCode: "STALE_ELIGIBILITY_CLAIM", httpStatus: 0 };
      }
      console.log(
        `[gr3-worker] report=${report.id} EXCLUDED` +
        ` code=${eligResult.exclusion_code}` +
        ` attend=${attendanceCount} source=${sourceEventCount}`,
      );
      return { ok: true };
    }

    // (E) ELIGIBLE: counts 저장 후 PREANALYZING/ANALYZING 전환으로 진행
    const eligibilitySaved = await db.execute(sql`
      UPDATE growth_reports
      SET attendance_count    = ${attendanceCount},
          source_event_count  = ${sourceEventCount},
          eligibility_version = ${eligVersionNum},
          exclusion_code      = NULL,
          updated_at          = now()
      WHERE id = ${report.id}
        AND product_status = ${report.product_status}::gr_product_status_enum
        AND analysis_request_id IS NOT DISTINCT FROM ${report.analysis_request_id}
        AND analysis_claim_token = ${claimToken}
        AND analysis_lease_until > now()
        AND deleted_at IS NULL
      RETURNING id
    `);
    if (!(eligibilitySaved.rows as any[] | undefined)?.length) {
      return { ok: false, errorCode: "STALE_ELIGIBILITY_CLAIM", httpStatus: 0 };
    }
    console.log(
      `[gr3-worker] report=${report.id} ELIGIBLE` +
      ` attend=${attendanceCount} source=${sourceEventCount} → PREANALYZING`,
    );
  }
  // ─── END ELIGIBILITY GATE ──────────────────────────────────────────────────

  // 1) Transition to IN_PROGRESS status (FOR UPDATE prevents concurrent)
  //    ELIGIBLE 학생만 이 단계에 도달 — PREANALYZING / ANALYZING 상태는 ELIGIBLE만 가짐.
  const toInProgress = stage === "PREANALYSIS" ? "PREANALYZING" : "ANALYZING";
  try {
    if (report.product_status !== toInProgress) {
      const transitioned = await db.transaction(async (tx: any) => {
        const owned = await tx.execute(sql`
          UPDATE growth_reports
          SET analysis_lease_until = now() +
                (${getAnalysisLeaseMs()} * interval '1 millisecond'),
              updated_at = now()
          WHERE id = ${report.id}
            AND product_status = ${report.product_status}::gr_product_status_enum
            AND analysis_claim_token = ${claimToken}
            AND analysis_lease_until > now()
            AND deleted_at IS NULL
          RETURNING id
        `);
        if (!(owned.rows as any[] | undefined)?.length) return false;
        await transitionReportStatus({
          db: tx,
          reportId:  report.id,
          toStatus:  toInProgress,
          actorType: "system",
          actorId:   null,
          reason:    `ANALYSIS_WORKER_${stage}`,
        });
        return true;
      });
      if (!transitioned) {
        return { ok: false, errorCode: "STALE_ANALYSIS_CLAIM", httpStatus: 0 };
      }
    }
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      // Another worker instance already transitioned this report
      console.log(`[gr3-worker] report=${report.id} already transitioned (concurrent), skip`);
      return { ok: false, errorCode: "CONCURRENT_TRANSITION", httpStatus: 0 };
    }
    throw err;
  }

  // Free monthly reports explicitly disable parent input; ENGINE questions are
  // retained as optional context but cannot block the completed PRE result.
  const parentInputWindowOpen = isGrowthReportParentInputWindowOpen(
    report.report_type,
    cycle.parent_input_close_at,
  );

  // 2) Build a candidate immutable snapshot. If the same logical input was
  // already claimed, the persisted full request (including created_at/hash)
  // wins so crash/watchdog recovery replays the exact ENGINE request.
  let freshRequest: Record<string, any>;
  let freshPayloadHash: string;
  if (report.analysis_request_id && isGrowthReportRequestIdentityForStage(
    report.analysis_request_payload,
    report.analysis_identity_hash,
    stage,
  )) {
    // A persisted request is immutable across every unfinished retry. Do not
    // rebuild from changed live inputs or mint a replacement identity.
    freshRequest = report.analysis_request_payload as Record<string, any>;
    freshPayloadHash = report.snapshot_hash ?? "";
  } else {
    if (hasLostLease()) {
      return { ok: false, errorCode: "STALE_ANALYSIS_CLAIM", httpStatus: 0 };
    }
    const freshSnapshot = await buildAnalysisSnapshot(db, { report, cycle });
    freshRequest = freshSnapshot.request as unknown as Record<string, any>;
    freshPayloadHash = freshSnapshot.payloadHash;
  }
  const identity = resolveGrowthReportAnalysisIdentity({
    freshRequest,
    freshPayloadHash,
    stage,
    persistedRequest: report.analysis_request_payload,
    persistedRequestId: report.analysis_request_id,
    persistedPayloadHash: report.snapshot_hash,
    persistedIdentityHash: report.analysis_identity_hash,
  });
  const request = identity.request as unknown as GrowthReportAnalysisRequest;
  const { requestId, payloadHash, identityHash } = identity;

  // 3) Persist the complete request and hash atomically before HTTP. A stale
  // worker must not call ENGINE if it lost the status CAS.
  const requestClaimed = await persistAnalysisRequest({
    db,
    reportId: report.id,
    poolId: report.swimming_pool_id,
    requestId,
    payloadHash,
    identityHash,
    request,
    stage,
    claimToken,
    preserveResponse: identity.reused,
    replacePreviousStageRequest: identity.replacePreviousStageRequest,
    previousStageIdentityHash: report.analysis_identity_hash,
  });
  if (!requestClaimed) {
    return { ok: false, errorCode: "STALE_ANALYSIS_CLAIM", httpStatus: 0 };
  }

  // 4) Persisted ENGINE request and its started audit are now durable.
  console.log(
    `[gr3-worker] report=${report.id} stage=${stage} requestId=${requestId} ` +
    `replayed=${identity.reused} ENGINE call starting`,
  );

  // 5) Prefer a durably stored response from the same logical request. This
  // closes the ENGINE-success / APP-result-transaction-failure cost window.
  const grEngineStartMs = Date.now();  // CS-PA1: latency 측정
  let response: GrowthReportAnalysisResponse;
  let grActualCallCount = 0;
  let grRetryCount      = 0;
  const cachedResponse = identity.reused ? report.analysis_response_payload : null;
  const hasCachedResponse = cachedResponse !== null && cachedResponse !== undefined;

  if (hasCachedResponse) {
    const cached = cachedResponse as Record<string, unknown>;
    if (
      typeof cached !== "object" ||
      Array.isArray(cached) ||
      cached.request_id !== requestId ||
      cached.report_id !== report.id
    ) {
      await recordAnalysisAttemptFailure({
        db,
        reportId: report.id,
        poolId: report.swimming_pool_id,
        requestId,
        stage,
        retryable: false,
        maxRetryCount: attemptRetryLimit,
        errorCode: "PERSISTED_RESPONSE_IDENTITY_MISMATCH",
        claimToken,
      });
      return { ok: false, errorCode: "PERSISTED_RESPONSE_IDENTITY_MISMATCH", httpStatus: 0 };
    }
    response = cached as unknown as GrowthReportAnalysisResponse;
    console.log(`[gr3-worker] report=${report.id} replaying saved ENGINE response; no ENGINE call`);
  } else {
    if (hasLostLease()) {
      return { ok: false, errorCode: "STALE_ANALYSIS_CLAIM", httpStatus: 0 };
    }
    let monthlyAttemptAdmitted = false;
    try {
      const callResult  = await analyzeGrowthReport(request, {
        onHttpAttempt: async () => {
          if (monthlyTracked) {
            const allowed = await canDispatchMonthlyAnalysis(db, {
              cycleId: report.cycle_id,
              studentId: report.student_id,
              phase: monthlyPhase,
            });
            if (!allowed) {
              throw new EngineCallError(
                "MONTHLY_AUTOMATION_PAUSED", 0, false,
                "Monthly dispatch authorization is no longer available.",
              );
            }
            const attemptRecorded = await recordMonthlyHttpAttempt(db, {
              cycleId: report.cycle_id,
              studentId: report.student_id,
              phase: monthlyPhase,
            });
            if (!attemptRecorded) {
              throw new EngineCallError(
                "MONTHLY_AUTOMATION_PAUSED", 0, false,
                "Monthly ENGINE attempt was not authorized or could not be durably counted.",
              );
            }
            monthlyAttemptAdmitted = true;
          }
          const callStarted = await markAnalysisCallStarted({
            db,
            reportId: report.id,
            requestId,
            stage,
            claimToken,
          });
          if (!callStarted) {
            throw new EngineCallError(
              "MONTHLY_ATTEMPT_ACCOUNTING_FAILED", 0, false,
              "Analysis claim expired before the ENGINE request was sent.",
            );
          }
        },
      });
      response          = callResult.response;
      grActualCallCount = callResult.actualCallCount;
      grRetryCount      = callResult.retryCount;
    } catch (engineErr) {
      // AI01-05: count as 1 attempt if URL was configured (i.e. HTTP was sent).
      // analysis_retry_count is cross-invocation; actual_call_count is per call.
      const noHttpAdmissionFailure = engineErr instanceof EngineCallError &&
        engineErr.statusCode === 0 &&
        ["ENGINE_URL_NOT_CONFIGURED", "MONTHLY_AUTOMATION_PAUSED",
          "MONTHLY_ATTEMPT_ACCOUNTING_FAILED"].includes(engineErr.errorCode);
      const httpWasSent = !noHttpAdmissionFailure;
      grActualCallCount = httpWasSent ? 1 : 0;
      grRetryCount      = 0;

      const retryable = isRetryableEngineError(engineErr);
      const errorCode = engineErr instanceof EngineCallError
        ? engineErr.errorCode
        : "UNKNOWN_ERROR";

      if (noHttpAdmissionFailure && errorCode === "MONTHLY_AUTOMATION_PAUSED") {
        let restored: boolean;
        try {
          restored = await restoreUndispatchedMonthlyClaim(db, {
            reportId: report.id,
            cycleId: report.cycle_id,
            studentId: report.student_id,
            originalStatus: report.product_status,
            requestId,
            claimToken,
            stage,
            monthlyTracked,
            monthlyPhase,
            admissionRecorded: monthlyAttemptAdmitted,
          });
        } catch {
          return { ok: false, errorCode, httpStatus: 0, skipped: true };
        }
        if (!restored) {
          return { ok: false, errorCode: "STALE_ANALYSIS_CLAIM", httpStatus: 0 };
        }
        return { ok: false, errorCode, httpStatus: 0, skipped: true };
      }
      if (noHttpAdmissionFailure && errorCode === "MONTHLY_ATTEMPT_ACCOUNTING_FAILED") {
        console.error(`[gr3-worker] monthly ENGINE attempt accounting failed report=${report.id}`);
        if (monthlyTracked && !monthlyAttemptAdmitted) {
          // The admission transaction may have committed despite a lost acknowledgement.
          // Keep the claim/start evidence for the watchdog rather than reopening a
          // target whose approval or request counter cannot be proven.
          return { ok: false, errorCode, httpStatus: 0, skipped: true };
        }
        let restored: boolean;
        try {
          restored = await restoreUndispatchedMonthlyClaim(db, {
            reportId: report.id,
            cycleId: report.cycle_id,
            studentId: report.student_id,
            originalStatus: report.product_status,
            requestId,
            claimToken,
            stage,
            monthlyTracked,
            monthlyPhase,
            admissionRecorded: monthlyAttemptAdmitted,
          });
        } catch {
          return { ok: false, errorCode, httpStatus: 0, skipped: true };
        }
        if (!restored) {
          return { ok: false, errorCode: "STALE_ANALYSIS_CLAIM", httpStatus: 0 };
        }
        return { ok: false, errorCode, httpStatus: 0, skipped: true };
      }
      if (monthlyTracked && httpWasSent) {
        const circuitErrorCode = engineErr instanceof EngineCallError
          ? engineErr.statusCode === 429
            ? "ENGINE_RATE_LIMITED"
            : engineErr.statusCode >= 500
              ? `ENGINE_HTTP_${engineErr.statusCode}`
              : errorCode
          : errorCode;
        const serviceOutcome = await recordMonthlyServiceOutcome(db, {
          cycleId: report.cycle_id,
          success: false,
          errorCode: circuitErrorCode,
        });
        if (serviceOutcome.paused) {
          await notifyMonthlyCircuitPause(db, report.cycle_id, circuitErrorCode);
        }
      }
      if (
        engineErr instanceof EngineCallError &&
        engineErr.requestState === "UNKNOWN"
      ) {
        await recordAnalysisUncertain({
          db,
          reportId: report.id,
          requestId,
          stage,
          claimToken,
        });
        return { ok: false, errorCode: "ENGINE_REQUEST_UNKNOWN", httpStatus: engineErr.statusCode };
      }

      void saveAiTrace({
        status: 'FAILED', request_id: requestId, internal_id: requestId,
        pool_id: report.swimming_pool_id, contract_version: '1.0',
        feature: AI_FEATURE.GROWTH_REPORT_AI, pool_mode: null,
        sub_feature: stage, result_generated: false,
        ...(monthlyTracked ? {
          monthly_cycle_id: report.cycle_id,
          monthly_report_period: report.report_period,
          monthly_phase: monthlyPhase,
        } : {}),
        trigger_type: 'SYSTEM_MAINTENANCE', service: 'analysis',
        error_stage: 'UNKNOWN' as const, error_code: errorCode,
        latency_ms:  Date.now() - grEngineStartMs,
      }).catch(() => {});

      const failure = await recordAnalysisAttemptFailure({
        db,
        reportId: report.id,
        poolId: report.swimming_pool_id,
        requestId,
        stage,
        retryable,
        maxRetryCount: attemptRetryLimit,
        errorCode,
        claimToken,
        retryDelayMs: retryable
          ? getGrowthReportRetryDelayMs(report.analysis_retry_count + 1)
          : undefined,
      });
      if (retryable) {
        console.warn(
          `[gr3-worker] retryable ENGINE error report=${report.id} code=${errorCode} ` +
          `retry=${failure.retryCount}/${attemptRetryLimit} terminal=${failure.terminal}`,
        );
      } else {
        const httpStatus     = (engineErr instanceof EngineCallError) ? (engineErr as EngineCallError).statusCode   : 0;
        const engineDetails  = (engineErr instanceof EngineCallError) ? (engineErr as EngineCallError).engineDetails : undefined;
        console.error(
          `[gr3-worker] non-retryable ENGINE error report=${report.id} code=${errorCode} http=${httpStatus} msg=${(engineErr as Error).message}`,
        );
        return { ok: false, errorCode, httpStatus, engineDetails };
      }
      return { ok: false, errorCode, httpStatus: 0 };
    }

    const responseSaved = await persistAnalysisResponse({
      db,
      reportId: report.id,
      requestId,
      response,
      stage,
      claimToken,
    });
    if (!responseSaved) {
      await auditStaleRejected(db, report.id, report.swimming_pool_id, requestId);
      return { ok: false, errorCode: "STALE_RESPONSE", httpStatus: 0 };
    }
    if (monthlyTracked) {
      const serviceOutcome = await recordMonthlyServiceOutcome(db, {
        cycleId: report.cycle_id,
        success: true,
      });
      if (serviceOutcome.paused) {
        await notifyMonthlyCircuitPause(db, report.cycle_id, "ENGINE_CALL_COMPLETED_WHILE_PAUSED");
      }
    }
  }

  // 6) Persist result
  try {
    const persist = await persistEngineResult({
      db,
      report,
      requestId,
      payloadHash,
      response,
      stage,
      parentInputWindowOpen,
      claimToken,
    });
    console.log(
      `[gr3-worker] report=${report.id} → ${persist.productStatus} ` +
      `questions=${persist.questionsCount}`,
    );
    // Engine transport success is not equivalent to generated content. In
    // particular DATA_ACCUMULATING is a successful response but never counts
    // as a generated report; only a qualified final result does.
    if (!hasCachedResponse) void saveAiTrace({
      status:                'SUCCESS',
      request_id:            requestId,
      internal_id:           requestId,
      pool_id:               report.swimming_pool_id,
      contract_version:      '1.0',
      feature:               AI_FEATURE.GROWTH_REPORT_AI,
      pool_mode:             null,
      sub_feature:           stage,
      ...(monthlyTracked ? {
        monthly_cycle_id: report.cycle_id,
        monthly_report_period: report.report_period,
        monthly_phase: monthlyPhase,
      } : {}),
      result_generated:      response.analysis_status !== "DATA_ACCUMULATING" &&
        persist.productStatus === "REVIEW_REQUIRED",
      trigger_type:          'SYSTEM_MAINTENANCE',
      service:               'analysis',
      generation_mode:       'engine_call',
      model:                 null,           // 외부 엔진 — model 정보 미노출
      latency_ms:            Date.now() - grEngineStartMs,
      input_tokens:          null,           // 외부 엔진 — token 정보 미노출
      output_tokens:         null,
      total_tokens:          null,
      logical_request_count: 1,
      actual_call_count:     grActualCallCount,
      retry_count:           grRetryCount,
    }).catch(() => {});
    // Notify Dashboard SSE (fire-and-forget)
    notifyPoolEvent({ type: "growth_report.changed", pool_id: report.swimming_pool_id, entity_id: report.id }).catch(() => {});
  } catch (persistErr) {
    if (persistErr instanceof StaleEngineResponseError) {
      await auditStaleRejected(db, report.id, report.swimming_pool_id, requestId);
      console.warn(`[gr3-worker] stale response rejected report=${report.id}`);
      return { ok: false, errorCode: "STALE_RESPONSE", httpStatus: 0 };
    }
    if (
      persistErr instanceof GroundingFailError ||
      persistErr instanceof EngineResponseValidationError
    ) {
      const code = persistErr.name;
      await recordAnalysisAttemptFailure({
        db,
        reportId:  report.id,
        poolId: report.swimming_pool_id,
        requestId,
        stage,
        retryable: false,
        maxRetryCount: attemptRetryLimit,
        errorCode: code,
        claimToken,
      });
      const groundingDetails = persistErr instanceof GroundingFailError
        ? { field: persistErr.field, value: persistErr.value, message: persistErr.message }
        : undefined;
      console.warn(`[gr3-worker] ${code} report=${report.id} → FAILED field=${(persistErr as any).field} value=${(persistErr as any).value}`);
      return { ok: false, errorCode: code, httpStatus: 0, engineDetails: groundingDetails };
    }
    throw persistErr;
  }
  return { ok: true };
}

// ─── Stuck report watchdog ────────────────────────────────────────────────────

/**
 * resetStuckReports — 만료된 lease token만 해제한다.
 * Status/request/retry evidence stay intact so the next owner resumes the same request.
 */
export async function resetStuckReports(db: any): Promise<number> {
  try {
    const expired = await db.transaction(async (tx: any) => {
      const monthlySchemaReady = await isMonthlyAutomationSchemaReady(tx);
      const candidates = await tx.execute(sql`
        SELECT id, cycle_id, student_id, swimming_pool_id, report_period,
               product_status, analysis_request_id, analysis_response_payload,
               analysis_request_payload, analysis_identity_hash, snapshot_hash,
               analysis_call_started_at, analysis_claim_token
        FROM growth_reports
        WHERE product_status IN ('PREANALYZING', 'ANALYZING')
          AND deleted_at IS NULL
          AND analysis_claim_token IS NOT NULL
          AND analysis_lease_until <= now()
          AND analysis_uncertain_at IS NULL
        ORDER BY analysis_lease_until ASC, id ASC
        LIMIT 500
        FOR UPDATE SKIP LOCKED
      `);
      const recovered: Array<{ id: string; cycle_id: string; call_started: boolean }> = [];
      for (const row of candidates.rows as any[]) {
        let cached: any = row.analysis_response_payload;
        if (typeof cached === "string") {
          try { cached = JSON.parse(cached); } catch { cached = null; }
        }
        const hasMatchingResponse = cached?.request_id === row.analysis_request_id &&
          cached?.report_id === row.id;
        let consumedRecoveryAttempt = false;
        let requestIdentityMatches = false;
        const persistedRequest = typeof row.analysis_request_payload === "string"
          ? (() => { try { return JSON.parse(row.analysis_request_payload); } catch { return null; } })()
          : row.analysis_request_payload;
        requestIdentityMatches = !!row.analysis_request_id &&
          persistedRequest?.request_id === row.analysis_request_id &&
          persistedRequest?.report_id === row.id &&
          persistedRequest?.context?.student_id === row.student_id &&
          persistedRequest?.context?.pool_id === row.swimming_pool_id &&
          persistedRequest?.context?.report_period === row.report_period &&
          persistedRequest?.snapshot?.payload_hash === row.snapshot_hash;
        if (monthlySchemaReady && row.analysis_response_payload == null &&
            requestIdentityMatches) {
          const target = await tx.execute(sql`
            SELECT target.first_pass_completed_at,
                   target.recovery_approved_at,
                   target.recovery_engine_requests
            FROM growth_report_eligible_targets target
            JOIN growth_report_cycles cycle ON cycle.id = target.cycle_id
            JOIN growth_report_monthly_runs run ON run.report_period = cycle.report_period
            JOIN growth_report_monthly_run_pools member
              ON member.report_period = run.report_period
             AND member.swimming_pool_id = cycle.swimming_pool_id
             AND member.cycle_id = cycle.id
             AND member.preparation_status = 'sealed'
            WHERE target.cycle_id = ${row.cycle_id}
              AND target.student_id = ${row.student_id}
            LIMIT 1
            FOR UPDATE OF target
          `);
          const recovery = target.rows[0] as any;
          consumedRecoveryAttempt = recovery?.first_pass_completed_at != null &&
            recovery.recovery_approved_at == null &&
            Number(recovery.recovery_engine_requests ?? 0) > 0;
        }

        const reset = consumedRecoveryAttempt
          ? await tx.execute(sql`
              UPDATE growth_reports
              SET analysis_uncertain_at = COALESCE(analysis_uncertain_at, now()),
                  analysis_next_attempt_at = NULL,
                  analysis_claim_token = NULL,
                  analysis_lease_until = NULL,
                  updated_at = now()
              WHERE id = ${row.id}
                AND cycle_id = ${row.cycle_id}
                AND analysis_request_id = ${row.analysis_request_id}
                AND analysis_claim_token = ${row.analysis_claim_token}
                AND product_status = ${row.product_status}::gr_product_status_enum
                AND analysis_response_payload IS NULL
                AND analysis_uncertain_at IS NULL
                AND analysis_lease_until <= now()
                AND deleted_at IS NULL
              RETURNING id
            `)
          : await tx.execute(sql`
              UPDATE growth_reports
              SET analysis_claim_token = NULL,
                  analysis_lease_until = NULL,
                  analysis_call_started_at = CASE
                    WHEN ${hasMatchingResponse} THEN NULL
                    ELSE analysis_call_started_at
                  END,
                  updated_at = now()
              WHERE id = ${row.id}
                AND cycle_id = ${row.cycle_id}
                AND analysis_request_id IS NOT DISTINCT FROM ${row.analysis_request_id}
                AND analysis_claim_token = ${row.analysis_claim_token}
                AND product_status = ${row.product_status}::gr_product_status_enum
                AND analysis_uncertain_at IS NULL
                AND analysis_lease_until <= now()
                AND deleted_at IS NULL
              RETURNING id
            `);
        if (reset.rows.length) {
          recovered.push({
            id: row.id,
            cycle_id: row.cycle_id,
            call_started: Boolean(row.analysis_call_started_at),
          });
        }
      }
      return recovered;
    });
    const count = expired.length;
    for (const row of expired) {
      if (!row.call_started) continue;
      const monthlyRun = await getMonthlyAutomationRunForCycle(db, row.cycle_id);
      if (monthlyRun?.paused_at) {
        await notifyMonthlyCircuitPause(db, row.cycle_id, "ENGINE_REQUEST_UNKNOWN");
      }
    }
    if (count > 0) {
      console.warn(
        `[gr3-watchdog] ${count}개 expired analysis lease 해제 ` +
        `(status/request/retry count 보존, 동일 request 복구)`,
      );
    }
    return count;
  } catch (err: any) {
    console.warn("[gr3-watchdog] stuck 리셋 실패 (무시):", err.message);
    return 0;
  }
}

/**
 * Recover legacy free-monthly rows that were left waiting for disabled parent
 * questions. Only a complete, structurally valid PRE result can advance, and
 * the row lock plus lifecycle CAS prevents stale/terminal status overwrites.
 */
export async function recoverLegacyFreeMonthlyQuestionWaiters(db: any): Promise<number> {
  if (typeof db?.transaction !== "function") {
    throw new Error("Free monthly question recovery requires a transactional database adapter.");
  }

  return db.transaction(async (tx: any) => {
    const candidates = await tx.execute(sql`
      SELECT gr.id
      FROM growth_reports gr
      WHERE gr.product_status = 'QUESTION_AVAILABLE'::gr_product_status_enum
        AND (gr.report_type = 'monthly' OR gr.report_type IS NULL)
        AND gr.deleted_at IS NULL
        AND gr.analysis_status IN (
          'COMPLETE',
          'COMPLETE_WITH_QUESTIONS_AVAILABLE',
          'COMPLETE_WITH_PARENT_EVIDENCE'
        )
        AND gr.analysis_request_id IS NOT NULL
        AND gr.snapshot_hash IS NOT NULL
        AND jsonb_typeof(gr.report_content) = 'object'
        AND jsonb_typeof(gr.report_fact_package) = 'object'
        AND jsonb_typeof(gr.sns_summary) = 'object'
        AND (
          gr.analysis_response_payload IS NULL
          OR (
            gr.analysis_response_payload->>'request_id' = gr.analysis_request_id
            AND gr.analysis_response_payload->>'report_id' = gr.id
            AND gr.analysis_response_payload->'trace'->>'payload_hash' = gr.snapshot_hash
          )
        )
      ORDER BY gr.updated_at ASC, gr.id ASC
      LIMIT 500
      FOR UPDATE SKIP LOCKED
    `);

    let recovered = 0;
    for (const row of candidates.rows as Array<{ id: string }>) {
      await transitionReportStatus({
        db: tx,
        reportId: row.id,
        toStatus: "READY_FOR_ANALYSIS",
        actorType: "system",
        actorId: null,
        reason: "FREE_MONTHLY_QUESTION_RECOVERY",
      });
      recovered++;
    }

    if (recovered > 0) {
      console.log(`[gr3-worker] recovered ${recovered} complete free-monthly question waiters`);
    }
    return recovered;
  });
}

// ─── Worker run ───────────────────────────────────────────────────────────────

export interface GrowthReportAnalysisWorkerResult {
  analyzed: number;
  skipped:  number;
  failed:   number;
  errors:   string[];
}

/**
 * runGrowthReportAnalysisWorker — processes one batch of pending reports.
 *
 * 동시 처리: GROWTH_REPORT_ANALYSIS_CONCURRENCY 환경변수로 제어 (기본 5).
 * DB row lock(FOR UPDATE)과 CAS(analysis_request_id)가 각 건을 독립적으로
 * 보호하므로 concurrent 실행이 안전함.
 *
 * Clock-injectable `db` parameter for testing.
 */
export async function runGrowthReportAnalysisWorker(
  db: any = superAdminDb,
): Promise<GrowthReportAnalysisWorkerResult> {
  const result: GrowthReportAnalysisWorkerResult = {
    analyzed: 0, skipped: 0, failed: 0, errors: [],
  };

  // Only due, unowned rows at the retry ceiling become terminal. An active or
  // uncertain in-flight request is never rewritten by this maintenance query.
  const maxRetry = getMaxRetryCount();
  await db.execute(sql`
    UPDATE growth_reports
    SET product_status = 'FAILED'::gr_product_status_enum,
        analysis_claim_token = NULL,
        analysis_lease_until = NULL,
        analysis_next_attempt_at = NULL,
        updated_at = now()
    WHERE product_status IN ('OPEN', 'READY_FOR_ANALYSIS', 'REGENERATING')
      AND COALESCE(analysis_retry_count, 0) >= ${maxRetry}
      AND analysis_uncertain_at IS NULL
      AND (analysis_next_attempt_at IS NULL OR analysis_next_attempt_at <= now())
      AND (
        analysis_claim_token IS NULL
        OR analysis_lease_until IS NULL
        OR analysis_lease_until <= now()
      )
      AND (
        (report_type IS NOT NULL AND report_type <> 'monthly')
        OR EXISTS (
          SELECT 1
          FROM growth_report_cycles sealed_cycle
          INNER JOIN growth_report_eligible_targets target
            ON target.cycle_id = sealed_cycle.id
           AND target.student_id = growth_reports.student_id
          WHERE sealed_cycle.id = growth_reports.cycle_id
            AND sealed_cycle.eligibility_sealed_at IS NOT NULL
            AND target.policy_excluded_at IS NULL
        )
      )
      AND deleted_at IS NULL
  `);

  // Also invoked on startup and every 5-minute drain through this shared queue
  // entrypoint, before READY_FOR_ANALYSIS rows are selected.
  await recoverLegacyFreeMonthlyQuestionWaiters(db);

  const pending = await fetchPendingReports(db);
  if (pending.length === 0) return result;

  const concurrency = getConcurrency();
  console.log(`[gr3-worker] processing ${pending.length} reports (concurrency=${concurrency})`);

  // concurrency 제한 병렬 처리 — p-limit 없이 직접 구현
  let idx = 0;
  const mutex = { analyzed: 0, failed: 0, errors: [] as string[] };

  async function worker(): Promise<void> {
    while (true) {
      const i = idx++;
      if (i >= pending.length) break;
      const item = pending[i];
      try {
        const oneResult = await analyzeOneReport(db, item);
        if (oneResult.ok) {
          mutex.analyzed++;
        } else if (oneResult.skipped) {
          result.skipped++;
        } else if (
          oneResult.errorCode === "CONCURRENT_TRANSITION" ||
          oneResult.errorCode === "STALE_ANALYSIS_CLAIM" ||
          oneResult.errorCode === "STALE_ELIGIBILITY_CLAIM"
        ) {
          result.skipped++;
        } else {
          mutex.failed++;
          mutex.errors.push(`report=${item.report.id}: ${oneResult.errorCode}`);
        }
      } catch (err: any) {
        mutex.failed++;
        mutex.errors.push(`report=${item.report.id}: ${err.message}`);
        console.error(`[gr3-worker] unexpected error report=${item.report.id}:`, err.message);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));

  result.analyzed = mutex.analyzed;
  result.failed   = mutex.failed;
  result.errors   = mutex.errors;

  return result;
}

// ─── Worker registration ──────────────────────────────────────────────────────

// ─── Single report trigger (super_admin) ─────────────────────────────────────

/**
 * fetchSingleReport — reportId로 단일 report+cycle row를 가져온다.
 * super_admin trigger (POST /super/growth-reports/:id/analyze) 전용.
 */
export async function fetchSingleReport(db: any, reportId: string): Promise<PendingReport | null> {
  const rows = await db.execute(sql`
    SELECT
      gr.id,
      gr.student_id,
      gr.swimming_pool_id,
      gr.cycle_id,
      gr.report_period,
      gr.report_type,
      gr.product_status,
      gr.analysis_request_id,
      gr.analysis_request_payload,
      gr.analysis_response_payload,
      gr.analysis_identity_hash,
      gr.snapshot_hash,
      COALESCE(gr.analysis_retry_count, 0)  AS analysis_retry_count,
      gr.analysis_call_started_at,
      gr.analysis_uncertain_at,
      gr.teacher_reviewed_by,
      gr.teacher_reviewed_at,
      grc.id                                AS cycle_db_id,
      grc.analysis_from,
      grc.analysis_cutoff_at,
      grc.parent_input_open_at,
      grc.parent_input_close_at,
      grc.report_period                     AS cycle_report_period,
      grc.timezone
    FROM growth_reports gr
    INNER JOIN growth_report_cycles grc ON grc.id = gr.cycle_id
    WHERE gr.id = ${reportId}
      AND gr.deleted_at IS NULL
    LIMIT 1
  `);

  if (!rows.rows.length) return null;

  const r = rows.rows[0] as any;
  const toIso = (v: unknown) =>
    v instanceof Date ? v.toISOString() : String(v ?? "");

  return {
    report: {
      id:                   r.id as string,
      student_id:           r.student_id as string,
      swimming_pool_id:     r.swimming_pool_id as string,
      cycle_id:             r.cycle_id as string,
      report_period:        r.report_period as string,
        report_type:          (r.report_type ?? null) as string | null,
      product_status:       r.product_status as string,
      analysis_request_id:  (r.analysis_request_id ?? null) as string | null,
      analysis_request_payload: r.analysis_request_payload ?? null,
      analysis_response_payload: r.analysis_response_payload ?? null,
      analysis_identity_hash: (r.analysis_identity_hash ?? null) as string | null,
      snapshot_hash:        (r.snapshot_hash ?? null) as string | null,
      analysis_retry_count: Number(r.analysis_retry_count ?? 0),
      analysis_call_started_at: r.analysis_call_started_at
        ? toIso(r.analysis_call_started_at) : null,
      analysis_uncertain_at: r.analysis_uncertain_at
        ? toIso(r.analysis_uncertain_at) : null,
      teacher_reviewed_by:  (r.teacher_reviewed_by ?? null) as string | null,
      teacher_reviewed_at:  (r.teacher_reviewed_at ?? null) as string | null,
    },
    cycle: {
      id:                    (r.cycle_db_id ?? r.cycle_id) as string,
      analysis_from:         (r.analysis_from ?? null)      as string | null,
      analysis_cutoff_at:    toIso(r.analysis_cutoff_at),
      parent_input_open_at:  toIso(r.parent_input_open_at),
      parent_input_close_at: toIso(r.parent_input_close_at),
      report_period:         r.cycle_report_period          as string,
      timezone:              (r.timezone ?? "Asia/Seoul")   as string,
    },
      stage: (r.product_status === "OPEN" || r.product_status === "REGENERATING" ||
        r.product_status === "PREANALYZING") ? "PREANALYSIS" : "FINAL_ANALYSIS",
      monthlyPhase: "FIRST_PASS",
  };
}

export type { PendingReport };

/**
 * analyzeSingleReport — super_admin 전용 단일 report 분석 trigger.
 *
 * 기존 analyzeOneReport 파이프라인을 그대로 통과하며,
 * auto worker와 달리 batch/cron 제어와 무관하게 동작.
 *
 * 조건:
 *   - report OPEN or READY_FOR_ANALYSIS (그 외 → "NOT_ANALYZABLE" 에러)
 *   - duplicate-safe (FOR UPDATE in transitionReportStatus)
 *   - retry-safe (analysis_retry_count 체크)
 *   - 직접 SQL status 변경 금지 — 기존 service 함수만 사용
 */
export async function analyzeSingleReport(
  db: any,
  reportId: string,
): Promise<{
  report_id:       string;
  product_status:  string;
  already_done:    boolean;
  error_code?:     string;
  http_status?:    number;
  engine_details?: unknown;
}> {
  const pending = await fetchSingleReport(db, reportId);

  if (!pending) {
    throw Object.assign(new Error(`REPORT_NOT_FOUND: ${reportId}`), { code: "REPORT_NOT_FOUND" });
  }

  const { product_status } = pending.report;
  if (pending.report.analysis_uncertain_at) {
    return {
      report_id: reportId,
      product_status,
      already_done: true,
      error_code: "ENGINE_REQUEST_UNKNOWN",
    };
  }
  if (![
    "OPEN",
    "READY_FOR_ANALYSIS",
    "REGENERATING",
    "PREANALYZING",
    "ANALYZING",
  ].includes(product_status)) {
    return {
      report_id:      reportId,
      product_status,
      already_done:   true,
    };
  }

  const oneResult = await analyzeOneReport(db, pending);

  // Fetch final status
  const afterRows = await db.execute(sql`
    SELECT product_status FROM growth_reports WHERE id = ${reportId} LIMIT 1
  `);
  const finalStatus = (afterRows.rows[0] as any)?.product_status ?? product_status;

  return {
    report_id:      reportId,
    product_status: finalStatus,
    already_done:   false,
    ...(oneResult && !oneResult.ok ? {
      error_code:     oneResult.errorCode,
      http_status:    oneResult.httpStatus,
      engine_details: oneResult.engineDetails,
    } : {}),
  };
}

/**
 * Narrow recovery-batch consumer. It only enters the ordinary single-report
 * pipeline after proving the live claim on one frozen FAILED batch member and
 * the exact first recovery epoch authorized by that member.
 */
export async function analyzeApprovedMonthlyRecoveryReport(
  db: any,
  reportId: string,
  context: {
    cycleId: string;
    expectedRecoveryEpoch: number;
    batchTargetId: string;
    batchClaimToken: string;
  },
): Promise<{
  report_id: string;
  product_status: string;
  already_done: boolean;
  error_code?: string;
  http_status?: number;
  engine_details?: unknown;
}> {
  const failClosed = (status = "UNKNOWN") => ({
    report_id: reportId,
    product_status: status,
    already_done: true,
    error_code: "APPROVED_RECOVERY_TARGET_NOT_DISPATCHABLE",
  });
  if (!Number.isSafeInteger(context.expectedRecoveryEpoch) ||
      context.expectedRecoveryEpoch < 1 ||
      !context.batchTargetId || !context.batchClaimToken) return failClosed();

  const selected = await db.execute(sql`
    SELECT batch_target.report_id, batch_target.cycle_id, batch_target.pool_id,
      batch_target.original_recovery_epoch, batch_target.kind,
      report.student_id, report.report_period, report.report_type,
      report.product_status, report.analysis_request_id,
      report.analysis_request_payload, report.analysis_identity_hash,
      report.snapshot_hash, report.analysis_uncertain_at,
      report.monthly_final_disposition, report.exclusion_code, report.deleted_at,
      target.first_pass_outcome, target.recovery_epoch,
      target.recovery_approved_by, target.recovery_approval_reason,
      target.policy_excluded_at,
      cycle.eligibility_sealed_at, cycle.eligible_total,
      (SELECT COUNT(*)::int FROM growth_report_eligible_targets sealed_target
       WHERE sealed_target.cycle_id = cycle.id) AS actual_eligible_total,
      member.preparation_status
    FROM growth_report_recovery_batch_targets batch_target
    JOIN growth_report_recovery_batches batch ON batch.id = batch_target.batch_id
    JOIN growth_reports report ON report.id = batch_target.report_id
    JOIN growth_report_cycles cycle
      ON cycle.id = report.cycle_id
     AND cycle.swimming_pool_id = report.swimming_pool_id
     AND cycle.report_period = report.report_period
    JOIN growth_report_monthly_runs run ON run.report_period = cycle.report_period
    JOIN growth_report_monthly_run_pools member
      ON member.report_period = run.report_period
     AND member.swimming_pool_id = cycle.swimming_pool_id
     AND member.cycle_id = cycle.id
    JOIN growth_report_eligible_targets target
      ON target.cycle_id = cycle.id AND target.student_id = report.student_id
    WHERE batch_target.id = ${context.batchTargetId}
      AND batch_target.claim_token = ${context.batchClaimToken}
      AND batch_target.state = 'PROCESSING'
      AND batch_target.lease_until > now()
      AND batch_target.kind = 'FAILED'
      AND batch_target.report_id = ${reportId}
      AND batch_target.cycle_id = ${context.cycleId}
      AND batch_target.original_recovery_epoch + 1 = ${context.expectedRecoveryEpoch}
      AND target.first_pass_outcome = 'failed'
      AND target.recovery_epoch = ${context.expectedRecoveryEpoch}
      AND target.recovery_epoch > 0
      AND NULLIF(BTRIM(target.recovery_approved_by), '') IS NOT NULL
      AND NULLIF(BTRIM(target.recovery_approval_reason), '') IS NOT NULL
      AND target.policy_excluded_at IS NULL
      AND report.analysis_uncertain_at IS NULL
      AND report.monthly_final_disposition IS NULL
      AND report.exclusion_code IS NULL
      AND report.deleted_at IS NULL
      AND report.product_status IN (
        'OPEN', 'READY_FOR_ANALYSIS', 'PREANALYZING', 'ANALYZING'
      )
      AND (report.report_type = 'monthly' OR report.report_type IS NULL)
      AND cycle.eligibility_sealed_at IS NOT NULL
      AND cycle.eligible_total = (
        SELECT COUNT(*) FROM growth_report_eligible_targets all_target
        WHERE all_target.cycle_id = cycle.id
      )
      AND member.preparation_status = 'sealed'
    FOR UPDATE OF batch_target, report, target
  `);
  const row = selected.rows[0] as any;
  if (!row) return failClosed();
  const currentStatus = String(row.product_status ?? "UNKNOWN");
  if (row.kind !== "FAILED" || row.report_id !== reportId ||
      row.cycle_id !== context.cycleId ||
      Number(row.original_recovery_epoch) + 1 !== context.expectedRecoveryEpoch ||
      Number(row.recovery_epoch) !== context.expectedRecoveryEpoch ||
      row.first_pass_outcome !== "failed" || row.policy_excluded_at != null ||
      row.analysis_uncertain_at != null || row.monthly_final_disposition != null ||
      row.exclusion_code != null || row.deleted_at != null ||
      row.eligibility_sealed_at == null ||
      Number(row.eligible_total) !== Number(row.actual_eligible_total) ||
      row.preparation_status !== "sealed" ||
      !["OPEN", "READY_FOR_ANALYSIS", "PREANALYZING", "ANALYZING"].includes(currentStatus) ||
      (row.report_type != null && row.report_type !== "monthly") ||
      typeof row.recovery_approved_by !== "string" ||
      !row.recovery_approved_by.trim() ||
      typeof row.recovery_approval_reason !== "string" ||
      !row.recovery_approval_reason.trim()) return failClosed(currentStatus);

  const payload = typeof row.analysis_request_payload === "string"
    ? (() => {
        try { return JSON.parse(row.analysis_request_payload); } catch { return null; }
      })()
    : row.analysis_request_payload;
  const storedIdentityValid = isGrowthReportRequestIdentityForStage(
    payload, row.analysis_identity_hash, "PREANALYSIS",
  ) || isGrowthReportRequestIdentityForStage(
    payload, row.analysis_identity_hash, "FINAL_ANALYSIS",
  );
  if (!payload || payload.request_id !== row.analysis_request_id ||
      payload.report_id !== reportId ||
      payload.context?.student_id !== row.student_id ||
      payload.context?.pool_id !== row.pool_id ||
      payload.context?.report_period !== row.report_period ||
      payload.snapshot?.payload_hash !== row.snapshot_hash ||
      !storedIdentityValid) {
    return failClosed(currentStatus);
  }

  const pending = await fetchSingleReport(db, reportId);
  if (!pending) return failClosed(currentStatus);
  const pendingStatus = pending.report.product_status;
  if (!["OPEN", "READY_FOR_ANALYSIS", "PREANALYZING", "ANALYZING"].includes(pendingStatus)) {
    // The automatic queue may have won the shared claim between proof lookup
    // and this read. Observe its resulting state; do not convert that race into
    // another recovery or an unnecessary provider call.
    return {
      report_id: reportId,
      product_status: pendingStatus,
      already_done: true,
    };
  }
  if (pending.report.cycle_id !== context.cycleId ||
      pending.report.student_id !== row.student_id ||
      pending.report.swimming_pool_id !== row.pool_id ||
      pending.report.report_period !== row.report_period ||
      (pending.report.report_type != null && pending.report.report_type !== "monthly") ||
      pending.report.analysis_request_id !== row.analysis_request_id ||
      pending.report.analysis_identity_hash !== row.analysis_identity_hash ||
      pending.report.analysis_uncertain_at != null ||
      !(isGrowthReportRequestIdentityForStage(
        pending.report.analysis_request_payload,
        pending.report.analysis_identity_hash,
        "PREANALYSIS",
      ) || isGrowthReportRequestIdentityForStage(
        pending.report.analysis_request_payload,
        pending.report.analysis_identity_hash,
        "FINAL_ANALYSIS",
      ))) return failClosed(pendingStatus);

  const oneResult = await analyzeOneReport(db, pending, { monthlyPhase: "RECOVERY" });
  const afterRows = await db.execute(sql`
    SELECT product_status FROM growth_reports WHERE id = ${reportId} LIMIT 1
  `);
  return {
    report_id: reportId,
    product_status: String((afterRows.rows[0] as any)?.product_status ?? currentStatus),
    already_done: false,
    ...(oneResult && !oneResult.ok ? {
      error_code: oneResult.errorCode,
      http_status: oneResult.httpStatus,
      engine_details: oneResult.engineDetails,
    } : {}),
  };
}

// ─── Worker registration ──────────────────────────────────────────────────────

/**
 * startGrowthReportAnalysisWorker — registers cron for ENGINE analysis.
 *
 * Runs every 5 minutes (separate from the date-driven scheduler).
 * Distributed lock prevents duplicate runs across instances.
 * Startup run after 45 s (after scheduler 30 s startup run).
 *
 * 제어 환경변수:
 *   GROWTH_REPORT_ANALYSIS_AUTO_ENABLED=false → cron/startup 완전 차단
 *   GROWTH_REPORT_ANALYSIS_BATCH_SIZE=N       → 1회 실행당 N건 처리 (0=차단)
 */
// ─── 연속 큐 드레인 ───────────────────────────────────────────────────────────
// MAX_RUN_MS: 크론 주기(5분) 안에서 최대 실행 시간. 초과 시 루프 종료 후 다음 크론이 이어받음.
const MAX_RUN_MS = 4.5 * 60 * 1000; // 4분 30초
// 락 갱신 주기: 배치 하나 완료마다 갱신 (TTL 만료 방지)
const LOCK_REFRESH_INTERVAL_MS = 60 * 1000; // 1분마다 갱신

async function finishMonthlyRunsWithCompleteAccounting(db: any): Promise<void> {
  if (!await isMonthlyAutomationSchemaReady(db)) return;
  const runs = await db.execute(sql`
    SELECT report_period
    FROM growth_report_monthly_runs
    WHERE first_pass_completed_at IS NOT NULL
       OR paused_at IS NULL
    ORDER BY report_period
  `);
  for (const row of runs.rows as Array<{ report_period: string }>) {
    const summary = await finishMonthlyFirstPass(db, row.report_period);
    if (!summary?.completed_at) continue;
    await notifyMonthlySuperAdminEvent({
      reportPeriod: row.report_period,
      eventType: "FIRST_PASS_FINISHED",
      summary,
    });
  }
}

/**
 * drainAnalysisQueue — pending 리포트가 없어질 때까지 또는 MAX_RUN_MS 초과까지
 * 배치를 연속 실행한다. 배치 사이에 락을 갱신해 TTL 만료를 방지한다.
 *
 * 워치독: expired lease를 해제한다. Request/status are never reset by age alone.
 */
async function drainAnalysisQueue(db: any): Promise<{
  totalAnalyzed: number;
  totalFailed:   number;
  batches:       number;
  errors:        string[];
}> {
  const runStart      = Date.now();
  let totalAnalyzed   = 0;
  let totalFailed     = 0;
  let batches         = 0;
  const errors: string[] = [];
  let lastLockRefresh = Date.now();

  while (true) {
    // 최대 실행 시간 초과 → 다음 크론에서 이어받음
    if (Date.now() - runStart > MAX_RUN_MS) {
      console.log(`[gr3-worker] MAX_RUN_MS 초과 (${Math.round((Date.now() - runStart) / 1000)}s) — 다음 크론에서 재개`);
      break;
    }

    // 락 갱신 (1분 간격)
    if (Date.now() - lastLockRefresh > LOCK_REFRESH_INTERVAL_MS) {
      await refreshLock(ANALYSIS_LOCK, LOCK_TTL_SECONDS);
      lastLockRefresh = Date.now();
    }

    // 워치독: stuck 리포트 복구
    await resetStuckReports(db);

    // 배치 실행
    let result: GrowthReportAnalysisWorkerResult;
    try {
      result = await runGrowthReportAnalysisWorker(db);
    } catch (err: any) {
      console.error("[gr3-worker] drain batch error:", err.message);
      errors.push(err.message);
      break; // 예상치 못한 오류는 드레인 종료 (다음 크론에서 재시도)
    }

    batches++;
    totalAnalyzed += result.analyzed;
    totalFailed   += result.failed;
    errors.push(...result.errors);

    // pending 없음 → 큐 소진 완료
    if (result.analyzed === 0 && result.failed === 0) {
      console.log(`[gr3-worker] 큐 소진 완료 (batches=${batches} total=${totalAnalyzed})`);
      break;
    }

    // 전체 실패 배치 → 엔진 다운 가능성. 루프 중단하고 알림
    if (result.failed > 0 && result.analyzed === 0) {
      const firstErr = result.errors[0] ?? "unknown";
      await sendOperatorAlert(
        `성장리포트 AI분석 전체 실패\n배치 ${result.failed}건 모두 실패\n오류: ${firstErr.slice(0, 100)}`,
      ).catch(() => {});
      break;
    }
  }

  try {
    await finishMonthlyRunsWithCompleteAccounting(db);
  } catch (err: any) {
    errors.push(`monthly accounting finalization: ${err.message}`);
    console.error("[gr3-worker] monthly accounting finalization failed:", err.message);
  }

  return { totalAnalyzed, totalFailed, batches, errors };
}

export function startGrowthReportAnalysisWorker(): void {
  // 크론: 5분마다 실행. 큐에 pending이 있으면 MAX_RUN_MS(4.5분) 동안 연속 처리.
  cron.schedule("*/5 * * * *", async () => {
    if (!isAutoAnalysisEnabled()) {
      console.log("[gr3-worker] auto analysis disabled (GROWTH_REPORT_ANALYSIS_AUTO_ENABLED=false)");
      return;
    }
    if (getBatchSize() === 0) {
      console.log("[gr3-worker] auto analysis disabled (GROWTH_REPORT_ANALYSIS_BATCH_SIZE=0)");
      return;
    }
    const locked = await acquireLock(ANALYSIS_LOCK, LOCK_TTL_SECONDS);
    if (!locked) {
      console.log("[gr3-worker] lock not acquired — other instance running");
      return;
    }
    try {
      const { totalAnalyzed, totalFailed, batches, errors } = await drainAnalysisQueue(superAdminDb);
      if (totalAnalyzed > 0 || totalFailed > 0) {
        await recordHeartbeat(ANALYSIS_LOCK, {
          at:       new Date().toISOString(),
          analyzed: totalAnalyzed,
          failed:   totalFailed,
          batches,
        }).catch(() => {});
      }
      if (totalAnalyzed > 0 || totalFailed > 0) {
        console.log(`[gr3-worker] 드레인 완료: analyzed=${totalAnalyzed} failed=${totalFailed} batches=${batches}`);
      }
      void errors; // 개별 에러는 드레인 루프 안에서 이미 로깅됨
    } catch (err: any) {
      console.error("[gr3-worker] cron error:", err.message);
      await sendOperatorAlert(`성장리포트 분석 워커 오류\n${(err as Error).message.slice(0, 120)}`).catch(() => {});
    } finally {
      await releaseLock(ANALYSIS_LOCK);
    }
  });

  // Startup run — 45 s after server start
  setTimeout(async () => {
    if (!isAutoAnalysisEnabled() || getBatchSize() === 0) return;
    const locked = await acquireLock(ANALYSIS_LOCK, LOCK_TTL_SECONDS);
    if (!locked) return;
    try {
      console.log("[gr3-worker] startup drain run");
      await drainAnalysisQueue(superAdminDb);
    } catch (err: any) {
      console.error("[gr3-worker] startup error:", err.message);
    } finally {
      await releaseLock(ANALYSIS_LOCK);
    }
  }, 45_000);

  const autoEnabled = isAutoAnalysisEnabled();
  const batchSize   = getBatchSize();
  const concurrency = getConcurrency();
  console.log(
    `[gr3-worker] Growth Report Analysis Worker 시작 ` +
    `(auto=${autoEnabled ? "ON" : "OFF"} batch=${batchSize} concurrency=${concurrency} ` +
    `drain=${MAX_RUN_MS / 1000}s every 5min + 45s startup)`,
  );
}
