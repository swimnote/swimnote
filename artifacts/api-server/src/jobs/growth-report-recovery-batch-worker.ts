import cron from "node-cron";
import { sql } from "drizzle-orm";
import { superAdminDb } from "@workspace/db";
import {
  claimRecoveryBatchTargets,
  listWaitingRecoveryBatchTargets,
  pauseRecoveryBatch,
  recoveryBatchSchemaReady,
  refreshRecoveryBatchProgress,
  renewRecoveryBatchTarget,
  settleRecoveryBatchTarget,
  type RecoveryBatchTarget,
} from "../lib/growth-report-recovery-batch.js";
import { signRecoveryBatchOperatorToken } from "../lib/auth.js";
import { recoverMonthlyTargets } from "../lib/growth-report-monthly-recovery.js";
import { analyzeApprovedMonthlyRecoveryReport } from "./growth-report-analysis-worker.js";
import {
  isUnknownReissueSchemaReady,
  reissueUnknownGrowthReports,
} from "../lib/growth-report-unknown-reissue.js";
import {
  isMonthlyAutomationSchemaReady,
  recordMonthlyServiceOutcome,
  reserveMonthlyUnknownRecoveryAdmission,
} from "../lib/growth-report-monthly-run.js";
import { getGrowthReportAnalysisIdentityHash } from "../lib/growth-report-analysis-identity.js";
import { reconcileMonthlyCycle } from "./growth-report-monthly-readiness.js";
import { freeReportIssueWindow } from "./growth-report-auto-publisher.js";
import { insertGrowthReportAdminReadyIntents } from "../utils/growth-report-notification-outbox.js";
import { logOperationalError } from "../lib/event-logger.js";

const LEASE_SECONDS = 180;
const HEARTBEAT_MS = 45_000;

function positiveInteger(value: string | undefined): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function getRecoveryConcurrency(env: NodeJS.ProcessEnv = process.env): number {
  return positiveInteger(env["GROWTH_REPORT_RECOVERY_CONCURRENCY"])
    ?? positiveInteger(env["GROWTH_REPORT_ANALYSIS_CONCURRENCY"])
    ?? positiveInteger(env["GROWTH_REPORT_BATCH_CONCURRENCY"])
    ?? 1;
}

export function isRecoveryBatchWorkerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env["NODE_ENV"] === "production") {
    return env["GROWTH_REPORT_RECOVERY_BATCH_ENABLED"] !== "false";
  }
  return env["GROWTH_REPORT_RECOVERY_BATCH_ENABLED"] === "true" ||
    env["GROWTH_REPORT_RECOVERY_BATCH_ALLOW_NONPRODUCTION"] === "true";
}

type ReportState = {
  id: string;
  cycle_id: string;
  swimming_pool_id: string;
  report_period: string;
  student_id: string;
  product_status: string;
  analysis_status: string | null;
  analysis_request_id: string;
  analysis_request_payload: any;
  analysis_identity_hash: string;
  snapshot_hash: string;
  analysis_uncertain_at: unknown;
  monthly_final_disposition: string | null;
  deleted_at: unknown;
  exclusion_code: string | null;
  policy_excluded_at?: unknown;
  paused_at: unknown;
  circuit_state: unknown;
  current_recovery_epoch?: unknown;
  latest_recovery_original_request_id?: string | null;
  latest_recovery_new_request_id?: string | null;
};

function capturedRecoveryEpoch(target: RecoveryBatchTarget): number | null {
  const value = (target as RecoveryBatchTarget & { original_recovery_epoch?: unknown })
    .original_recovery_epoch ?? 0;
  const epoch = Number(value);
  return Number.isSafeInteger(epoch) && epoch >= 0 ? epoch : null;
}

function currentRecoveryEpoch(report: ReportState): number | null {
  const epoch = Number(report.current_recovery_epoch ?? 0);
  return Number.isSafeInteger(epoch) && epoch >= 0 ? epoch : null;
}

function expectedRecoveryEpoch(target: RecoveryBatchTarget): number | null {
  const frozen = capturedRecoveryEpoch(target);
  if (frozen === null || frozen >= Number.MAX_SAFE_INTEGER) return null;
  return frozen + 1;
}

async function loadAndValidateTarget(db: any, target: RecoveryBatchTarget): Promise<ReportState | null> {
  const result = await db.execute(sql`
    SELECT report.id, report.cycle_id, report.swimming_pool_id, report.report_period,
      report.student_id, report.product_status, report.analysis_status,
      report.analysis_request_id, report.analysis_request_payload,
      report.analysis_identity_hash, report.snapshot_hash,
      report.analysis_uncertain_at, report.monthly_final_disposition,
      report.deleted_at, report.exclusion_code, target.policy_excluded_at,
       target.recovery_epoch AS current_recovery_epoch,
      run.paused_at, run.circuit_state,
      (SELECT operation.original_request_id
       FROM growth_report_unknown_reissue_operations operation
       WHERE operation.report_id = report.id
       ORDER BY operation.recovery_generation DESC, operation.created_at DESC
       LIMIT 1) AS latest_recovery_original_request_id,
      (SELECT operation.new_request_id
       FROM growth_report_unknown_reissue_operations operation
       WHERE operation.report_id = report.id
       ORDER BY operation.recovery_generation DESC, operation.created_at DESC
       LIMIT 1) AS latest_recovery_new_request_id
    FROM growth_reports report
    JOIN growth_report_cycles cycle ON cycle.id = report.cycle_id
      AND cycle.swimming_pool_id = report.swimming_pool_id
      AND cycle.report_period = report.report_period
    LEFT JOIN growth_report_monthly_runs run
      ON run.report_period = cycle.report_period
    LEFT JOIN growth_report_eligible_targets target
      ON target.cycle_id=report.cycle_id AND target.student_id=report.student_id
    WHERE report.id = ${target.report_id}
      AND report.cycle_id = ${target.cycle_id}
      AND report.swimming_pool_id = ${target.pool_id}
      AND report.report_period = ${target.batch.report_month}
      AND report.deleted_at IS NULL
      AND report.product_status <> 'DISCARDED'
    LIMIT 1
  `);
  const report = result.rows[0] as ReportState | undefined;
  if (!report) return null;
  const payload = typeof report.analysis_request_payload === "string"
    ? JSON.parse(report.analysis_request_payload)
    : report.analysis_request_payload;
  const frozenEpoch = capturedRecoveryEpoch(target);
  const observedEpoch = currentRecoveryEpoch(report);
  const failedRecoveryAdvanced = target.kind === "FAILED" &&
    frozenEpoch !== null && observedEpoch !== null && observedEpoch > frozenEpoch;
  const requestIdAllowed = report.analysis_request_id === target.original_request_id ||
    (target.kind === "UNKNOWN" && !!target.new_request_id &&
      report.analysis_request_id === target.new_request_id) ||
    failedRecoveryAdvanced ||
    (target.kind === "UNKNOWN" &&
      (report.analysis_request_id === report.latest_recovery_original_request_id ||
        report.analysis_request_id === report.latest_recovery_new_request_id));
  const identityMatches = requestIdAllowed && payload &&
    payload.request_id === report.analysis_request_id &&
    payload.report_id === target.report_id &&
    payload.context?.student_id === report.student_id &&
    payload.context?.pool_id === target.pool_id &&
    payload.context?.report_period === target.batch.report_month &&
    payload.snapshot?.payload_hash === report.snapshot_hash &&
    (getGrowthReportAnalysisIdentityHash(payload, "PREANALYSIS") === report.analysis_identity_hash ||
      getGrowthReportAnalysisIdentityHash(payload, "FINAL_ANALYSIS") === report.analysis_identity_hash);
  if (!identityMatches || report.id !== target.report_id ||
      report.cycle_id !== target.cycle_id || report.swimming_pool_id !== target.pool_id) {
    return null;
  }
  return report;
}

function runCircuitState(value: unknown): string | undefined {
  let state = value;
  if (typeof state === "string") {
    try { state = JSON.parse(state); } catch { return undefined; }
  }
  return state && typeof state === "object" &&
    typeof (state as Record<string, unknown>).status === "string"
    ? String((state as Record<string, unknown>).status) : undefined;
}

function circuitPaused(report: ReportState): boolean {
  return report.paused_at != null || runCircuitState(report.circuit_state) === "OPEN";
}

async function pauseBatchForCircuit(db: any, target: RecoveryBatchTarget, reason: string) {
  await pauseRecoveryBatch(db, target.batch_id, reason);
  await settleRecoveryBatchTarget(db, target, "PENDING", reason);
}

async function isMonthlyCircuitPaused(db: any, target: RecoveryBatchTarget): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT run.paused_at, run.circuit_state
    FROM growth_report_monthly_runs run
    JOIN growth_report_cycles cycle ON cycle.report_period = run.report_period
    WHERE cycle.id = ${target.cycle_id}
    LIMIT 1
  `);
  const row = result.rows[0];
  return !!row && (row.paused_at != null || runCircuitState(row.circuit_state) === "OPEN");
}

function monthlyCircuitFailureCode(code?: string): string | undefined {
  if (!code) return undefined;
  const http5xx = code.match(/^ENGINE_HTTP_(5\d\d)(?:_|$)/);
  if (http5xx) return `ENGINE_HTTP_${http5xx[1]}`;
  return [
    "NETWORK_ERROR", "COMPOSITION_TIMEOUT", "ENGINE_URL_NOT_CONFIGURED",
    "ENGINE_SECRET_NOT_CONFIGURED", "ENGINE_SERVICE_SECRET_NOT_CONFIGURED",
    "ENGINE_TIMEOUT", "ENGINE_SERVICE_UNAVAILABLE", "ENGINE_CONNECTION_ERROR",
    "ENGINE_RATE_LIMITED", "ENGINE_OVERLOADED", "ENGINE_REISSUE_OUTCOME_UNKNOWN",
  ].includes(code) ? code : undefined;
}

function terminalTargetState(report: ReportState): "SUCCESS" | "INSUFFICIENT_EVIDENCE" |
  "FAILED" | "UNKNOWN" | "SKIPPED" | "WAITING" {
  if (report.policy_excluded_at || report.exclusion_code ||
      ["EXCLUDED", "DISCARDED"].includes(report.product_status)) return "SKIPPED";
  if (report.analysis_uncertain_at) return "UNKNOWN";
  if (report.monthly_final_disposition === "INSUFFICIENT_EVIDENCE" ||
      report.analysis_status === "DATA_ACCUMULATING") return "INSUFFICIENT_EVIDENCE";
  if (["REVIEW_REQUIRED", "READY_TO_SEND", "APPROVED", "PUBLISHED"].includes(report.product_status)) {
    return "SUCCESS";
  }
  if (["EXCLUDED", "DISCARDED"].includes(report.product_status) || report.exclusion_code) {
    return "SKIPPED";
  }
  if (report.product_status === "FAILED") return "FAILED";
  return "WAITING";
}

async function reconcileTarget(db: any, report: ReportState): Promise<void> {
  const issueWindow = freeReportIssueWindow(new Date());
  const afterIssueWindow = issueWindow.issueDay > 5 ||
    (issueWindow.issueDay === 5 && issueWindow.issueHour >= 2);
  const cycleScope = await db.execute(sql`
    SELECT cycle.ready_at, cycle.report_period,
      COALESCE(pool.x_paid_entitlement, false) AS x_paid_entitlement,
      COALESCE(pool.x_manual_entitlement, false) AS x_manual_entitlement,
      COALESCE(pool.x_force_disabled, false) AS x_force_disabled,
      pool.approval_status
    FROM growth_report_cycles cycle
    JOIN swimming_pools pool ON pool.id = cycle.swimming_pool_id
    WHERE cycle.swimming_pool_id = ${report.swimming_pool_id}
      AND cycle.report_period = ${report.report_period}
    LIMIT 1
  `);
  const scope = cycleScope.rows[0];
  const currentPeriodEligible = scope &&
    report.report_period === issueWindow.reportPeriod &&
    (scope.x_paid_entitlement === true || scope.x_manual_entitlement === true) &&
    scope.x_force_disabled !== true && scope.approval_status === "approved";
  const priorPeriodEligible = scope &&
    report.report_period < issueWindow.reportPeriod && scope.ready_at == null;
  const recordReady = afterIssueWindow && Boolean(currentPeriodEligible || priorPeriodEligible);
  await reconcileMonthlyCycle(db, {
    poolId: report.swimming_pool_id,
    reportPeriod: report.report_period,
  }, recordReady ? async (tx, readiness) => {
    await insertGrowthReportAdminReadyIntents(tx, {
      poolId: report.swimming_pool_id,
      reportPeriod: report.report_period,
      message: "이번 달 AI 성장리포트 발행이 완료되었습니다.\nSWIMNOTE에서 확인해 주세요.",
      readiness,
    });
  } : undefined, { recordReady });
}

function resultState(result: Record<string, unknown> | undefined):
  "WAITING" | "SUCCESS" | "INSUFFICIENT_EVIDENCE" | "FAILED" | "UNKNOWN" | "CONFLICT" | "SKIPPED" {
  const state = String(result?.state ?? "").toUpperCase();
  if (state === "COMPLETE") {
    return result?.terminal_outcome === "INSUFFICIENT_EVIDENCE"
      ? "INSUFFICIENT_EVIDENCE" : "WAITING";
  }
  if (state === "PROCESSING" || state === "CREATED" || state === "BUSY") return "WAITING";
  if (state === "INSUFFICIENT_EVIDENCE") return "INSUFFICIENT_EVIDENCE";
  if (["FAILED", "UNKNOWN", "CONFLICT"].includes(state)) return state as any;
  if (state === "HOLD") return "CONFLICT";
  return "SKIPPED";
}

async function processFailedTarget(db: any, target: RecoveryBatchTarget): Promise<void> {
  if (target.kind !== "FAILED") {
    await settleRecoveryBatchTarget(db, target, "SKIPPED", "TARGET_KIND_NOT_FAILED");
    return;
  }
  const report = await loadAndValidateTarget(db, target);
  if (!report) {
    await settleRecoveryBatchTarget(db, target, "CONFLICT", "REPORT_IDENTITY_REVALIDATION_FAILED");
    return;
  }
  const currentState = terminalTargetState(report);
  const frozenEpoch = capturedRecoveryEpoch(target);
  const observedEpoch = currentRecoveryEpoch(report);
  if (frozenEpoch === null || observedEpoch === null || observedEpoch < frozenEpoch) {
    await settleRecoveryBatchTarget(db, target, "CONFLICT", "RECOVERY_EPOCH_INVALID_OR_REGRESSED");
    return;
  }
  if (observedEpoch > frozenEpoch) {
    const approvedEpoch = expectedRecoveryEpoch(target);
    if (approvedEpoch === null || observedEpoch !== approvedEpoch) {
      await settleRecoveryBatchTarget(db, target, "CONFLICT",
        "RECOVERY_EPOCH_ADVANCED_BEYOND_APPROVED_ROUND");
      return;
    }
    if (currentState === "WAITING" && circuitPaused(report)) {
      await pauseBatchForCircuit(db, target, "MONTHLY_CIRCUIT_PAUSED");
      return;
    }
    if (currentState === "WAITING") {
      const consumed = await analyzeApprovedMonthlyRecoveryReport(db, target.report_id, {
        cycleId: target.cycle_id,
        expectedRecoveryEpoch: approvedEpoch,
        batchTargetId: target.id,
        batchClaimToken: target.claim_token,
      });
      const refreshed = await loadAndValidateTarget(db, target);
      if (!refreshed) {
        await settleRecoveryBatchTarget(db, target, "CONFLICT",
          "REPORT_IDENTITY_REVALIDATION_FAILED_AFTER_ANALYSIS");
        return;
      }
      if (currentRecoveryEpoch(refreshed) !== approvedEpoch) {
        await settleRecoveryBatchTarget(db, target, "CONFLICT",
          "RECOVERY_EPOCH_ADVANCED_BEYOND_APPROVED_ROUND");
        return;
      }
      const refreshedState = terminalTargetState(refreshed);
      if (consumed.error_code === "APPROVED_RECOVERY_TARGET_NOT_DISPATCHABLE" &&
          refreshedState === "WAITING") {
        await settleRecoveryBatchTarget(db, target, "CONFLICT",
          "APPROVED_RECOVERY_MEMBERSHIP_NOT_DISPATCHABLE");
        return;
      }
      await settleRecoveryBatchTarget(db, target, refreshedState,
        "APPROVED_RECOVERY_ATTEMPT_OBSERVED");
      if (refreshedState === "SUCCESS" || refreshedState === "INSUFFICIENT_EVIDENCE") {
        await reconcileTarget(db, refreshed);
      }
      return;
    }
    await settleRecoveryBatchTarget(db, target, currentState, "RECOVERY_EPOCH_ALREADY_ADVANCED");
    if (currentState === "SUCCESS" || currentState === "INSUFFICIENT_EVIDENCE") {
      await reconcileTarget(db, report);
    }
    return;
  }
  if (currentState === "WAITING" && circuitPaused(report)) {
    await pauseBatchForCircuit(db, target, "MONTHLY_CIRCUIT_PAUSED");
    return;
  }
  if (currentState !== "FAILED") {
    await settleRecoveryBatchTarget(db, target, currentState, "REPORT_NO_LONGER_FAILED");
    if (currentState === "SUCCESS" || currentState === "INSUFFICIENT_EVIDENCE") {
      await reconcileTarget(db, report);
    }
    return;
  }
  if (report.analysis_request_id !== target.original_request_id || circuitPaused(report)) {
    if (circuitPaused(report)) {
      await pauseBatchForCircuit(db, target, "MONTHLY_CIRCUIT_PAUSED");
      return;
    }
    await settleRecoveryBatchTarget(db, target, "CONFLICT", "ORIGINAL_REQUEST_CHANGED");
    return;
  }
  const recovery = await recoverMonthlyTargets(db, {
    poolId: target.pool_id,
    reportPeriod: target.batch.report_month,
    actorId: target.batch.actor_id,
    reason: target.batch.reason,
    reportIds: [target.report_id],
  });
  if (recovery.reactivated) {
    const approvedEpoch = expectedRecoveryEpoch(target);
    const refreshed = await loadAndValidateTarget(db, target);
    if (!refreshed) {
      await settleRecoveryBatchTarget(db, target, "CONFLICT", "REPORT_DISAPPEARED_AFTER_RECOVERY");
      return;
    }
    const refreshedEpoch = currentRecoveryEpoch(refreshed);
    if (approvedEpoch === null || refreshedEpoch !== approvedEpoch) {
      await settleRecoveryBatchTarget(db, target, "CONFLICT",
        "RECOVERY_EPOCH_ADVANCED_BEYOND_APPROVED_ROUND");
      return;
    }
    const refreshedState = terminalTargetState(refreshed);
    if (refreshedState === "WAITING" && !circuitPaused(refreshed)) {
      const consumed = await analyzeApprovedMonthlyRecoveryReport(db, target.report_id, {
        cycleId: target.cycle_id,
        expectedRecoveryEpoch: approvedEpoch,
        batchTargetId: target.id,
        batchClaimToken: target.claim_token,
      });
      const afterAnalysis = await loadAndValidateTarget(db, target);
      if (!afterAnalysis) {
        await settleRecoveryBatchTarget(db, target, "CONFLICT",
          "REPORT_IDENTITY_REVALIDATION_FAILED_AFTER_ANALYSIS");
        return;
      }
      if (currentRecoveryEpoch(afterAnalysis) !== approvedEpoch) {
        await settleRecoveryBatchTarget(db, target, "CONFLICT",
          "RECOVERY_EPOCH_ADVANCED_BEYOND_APPROVED_ROUND");
        return;
      }
      const afterState = terminalTargetState(afterAnalysis);
      if (consumed.error_code === "APPROVED_RECOVERY_TARGET_NOT_DISPATCHABLE" &&
          afterState === "WAITING") {
        await settleRecoveryBatchTarget(db, target, "CONFLICT",
          "APPROVED_RECOVERY_MEMBERSHIP_NOT_DISPATCHABLE");
        return;
      }
      await settleRecoveryBatchTarget(db, target, afterState,
        "APPROVED_RECOVERY_ATTEMPT_STARTED");
      if (afterState === "SUCCESS" || afterState === "INSUFFICIENT_EVIDENCE") {
        await reconcileTarget(db, afterAnalysis);
      }
      return;
    }
    if (refreshedState === "WAITING" && circuitPaused(refreshed)) {
      await pauseBatchForCircuit(db, target, "MONTHLY_CIRCUIT_PAUSED");
      return;
    }
    await settleRecoveryBatchTarget(db, target, refreshedState, "FAILED_REPORT_REACTIVATED");
  } else {
    const refreshed = await loadAndValidateTarget(db, target);
    if (!refreshed) {
      await settleRecoveryBatchTarget(db, target, "CONFLICT", "REPORT_DISAPPEARED_AFTER_RECOVERY");
      return;
    }
    const state = terminalTargetState(refreshed);
    await settleRecoveryBatchTarget(db, target, state,
      state === "FAILED" ? "FAILED_RECOVERY_NOT_REACTIVATED" : "REPORT_STATE_CHANGED");
  }
}

async function processUnknownTarget(db: any, target: RecoveryBatchTarget): Promise<void> {
  if (target.kind !== "UNKNOWN") {
    await settleRecoveryBatchTarget(db, target, "SKIPPED", "TARGET_KIND_NOT_UNKNOWN");
    return;
  }
  const report = await loadAndValidateTarget(db, target);
  if (!report) {
    await settleRecoveryBatchTarget(db, target, "CONFLICT", "REPORT_IDENTITY_REVALIDATION_FAILED");
    return;
  }
  const currentState = terminalTargetState(report);
  if (currentState !== "UNKNOWN") {
    await settleRecoveryBatchTarget(db, target, currentState, "UNKNOWN_TARGET_ALREADY_RESOLVED");
    if (currentState === "SUCCESS" || currentState === "INSUFFICIENT_EVIDENCE") {
      await reconcileTarget(db, report);
    }
    return;
  }
  if (circuitPaused(report)) {
    await pauseBatchForCircuit(db, target, "MONTHLY_CIRCUIT_PAUSED");
    return;
  }
  const priorResult = await db.execute(sql`
    SELECT id, state, engine_confirmed_unknown, original_request_id,
      new_request_id, operator_subject, lease_until
    FROM growth_report_unknown_reissue_operations
    WHERE report_id = ${target.report_id}
    ORDER BY recovery_generation DESC, created_at DESC
    LIMIT 1
  `);
  const latest = priorResult.rows[0];
  if (latest && ["COMPLETE", "FAILED", "CONFLICT"].includes(String(latest.state))) {
    await settleRecoveryBatchTarget(db, target, "CONFLICT", "PERSISTED_OPERATION_ALREADY_TERMINAL");
    return;
  }
  if (latest?.state === "PROCESSING" && latest.lease_until &&
      new Date(latest.lease_until).getTime() > Date.now()) {
    await settleRecoveryBatchTarget(db, target, "WAITING", "PERSISTED_OPERATION_STILL_PROCESSING");
    return;
  }
  const admitted = await reserveMonthlyUnknownRecoveryAdmission(db, {
    cycleId: target.cycle_id,
    studentId: report.student_id,
  });
  if (!admitted) {
    const circuit = await db.execute(sql`
      SELECT run.paused_at, run.circuit_state
      FROM growth_report_monthly_runs run
      JOIN growth_report_cycles cycle ON cycle.report_period = run.report_period
      WHERE cycle.id = ${target.cycle_id}
      LIMIT 1
    `);
    const circuitRow = circuit.rows[0];
    if (circuitRow &&
        (circuitRow.paused_at != null || runCircuitState(circuitRow.circuit_state) === "OPEN")) {
      await pauseBatchForCircuit(db, target, "MONTHLY_CIRCUIT_PAUSED");
      return;
    }
    await settleRecoveryBatchTarget(db, target, "PENDING", "MONTHLY_CIRCUIT_ADMISSION_DENIED");
    return;
  }

  const expectedOperationId = target.expected_operation_id ?? undefined;
  let advanceGeneration = false;
  if (expectedOperationId && latest) {
    // Once an operation is recorded on an earlier attempt, replay it. Only
    // advance while the exact operator-captured operation remains latest.
    advanceGeneration = latest?.id === expectedOperationId &&
      latest.state === "UNKNOWN" && latest.engine_confirmed_unknown === true &&
      latest.new_request_id === report.analysis_request_id;
  }
  const delegatedAuthorization = signRecoveryBatchOperatorToken({
    userId: target.batch.actor_id,
    role: target.batch.actor_role,
    batchId: target.batch.id,
  });
  let result: Record<string, unknown> | undefined;
  try {
    [result] = await reissueUnknownGrowthReports(db, {
      reportIds: [target.report_id],
      actorId: target.batch.actor_id,
      actorRole: target.batch.actor_role,
      reason: target.batch.reason,
      ...(advanceGeneration && expectedOperationId ? {
        nextGeneration: true,
        expectedOperationIds: { [target.report_id]: expectedOperationId },
      } : {}),
      operatorAuthorization: `Bearer ${delegatedAuthorization}`,
    });
  } catch (error) {
    const outcome = await recordMonthlyServiceOutcome(db, {
      cycleId: target.cycle_id,
      success: false,
      errorCode: "ENGINE_REISSUE_OUTCOME_UNKNOWN",
    });
    if (outcome.paused || await isMonthlyCircuitPaused(db, target)) {
      await pauseRecoveryBatch(db, target.batch_id, "MONTHLY_CIRCUIT_PAUSED");
    }
    throw error;
  }
  let observedError = typeof result?.error_code === "string" ? result.error_code : undefined;
  if (!observedError && String(result?.state).toUpperCase() === "UNKNOWN") {
    const operationId = typeof result?.recovery_operation_id === "string"
      ? result.recovery_operation_id : undefined;
    if (operationId) {
      const operation = await db.execute(sql`
        SELECT error_code FROM growth_report_unknown_reissue_operations
        WHERE id = ${operationId}
        LIMIT 1
      `);
      observedError = typeof operation.rows[0]?.error_code === "string"
        ? operation.rows[0].error_code : undefined;
    }
  }
  const circuitErrorCode = monthlyCircuitFailureCode(observedError);
  const outcome = await recordMonthlyServiceOutcome(db, {
    cycleId: target.cycle_id,
    success: !circuitErrorCode,
    errorCode: circuitErrorCode,
  });
  let state = resultState(result);
  const circuitPausedAfterOutcome = outcome.paused || await isMonthlyCircuitPaused(db, target);
  if (circuitPausedAfterOutcome) {
    await pauseRecoveryBatch(db, target.batch_id, "MONTHLY_CIRCUIT_PAUSED");
  }
  if (String(result?.state).toUpperCase() === "COMPLETE") {
    const refreshed = await loadAndValidateTarget(db, target);
    if (!refreshed) {
      state = "CONFLICT";
    } else {
      const reportState = terminalTargetState(refreshed);
      if (reportState !== "WAITING") {
        state = reportState;
        if (reportState === "SUCCESS" || reportState === "INSUFFICIENT_EVIDENCE") {
          await reconcileTarget(db, refreshed);
        }
      }
    }
  }
  await settleRecoveryBatchTarget(db, target, state,
    observedError,
    {
      recovery_operation_id: typeof result?.recovery_operation_id === "string"
        ? result.recovery_operation_id : undefined,
      new_request_id: typeof result?.new_request_id === "string"
        ? result.new_request_id : undefined,
    });
}

export async function processRecoveryBatchTarget(
  db: any,
  target: RecoveryBatchTarget,
): Promise<void> {
  try {
    if (target.kind === "FAILED") await processFailedTarget(db, target);
    else if (target.kind === "UNKNOWN") await processUnknownTarget(db, target);
    else await settleRecoveryBatchTarget(db, target, "SKIPPED", "UNSUPPORTED_TARGET_KIND");
  } catch (error) {
    const state = target.kind === "UNKNOWN" ? "UNKNOWN" : "FAILED";
    const detail = target.kind === "UNKNOWN"
      ? "UNEXPECTED_UNKNOWN_REISSUE_ERROR"
      : "RECOVERY_TARGET_PROCESSING_FAILED";
    await settleRecoveryBatchTarget(db, target, state, detail).catch(() => false);
    await logOperationalError({
      pool_id: target.pool_id || "global",
      feature: "GROWTH",
      level: "ERROR",
      error_code: target.kind === "UNKNOWN"
        ? "GROWTH_REPORT_UNKNOWN_RECOVERY_UNEXPECTED_ERROR"
        : "GROWTH_REPORT_FAILED_RECOVERY_UNEXPECTED_ERROR",
      safe_message: "A growth report recovery target could not be processed.",
      entity_type: "growth_report_recovery_batch",
      entity_id: target.batch_id,
    }).catch(() => undefined);
  } finally {
    await refreshRecoveryBatchProgress(db, target.batch_id).catch(() => undefined);
  }
}

async function withLeaseHeartbeat(db: any, target: RecoveryBatchTarget): Promise<void> {
  let running = true;
  const heartbeat = setInterval(() => {
    if (!running) return;
    void renewRecoveryBatchTarget(db, target, LEASE_SECONDS).catch(() => false);
  }, HEARTBEAT_MS);
  try {
    await processRecoveryBatchTarget(db, target);
  } finally {
    running = false;
    clearInterval(heartbeat);
  }
}

export async function runRecoveryBatchWorkerOnce(db: any = superAdminDb): Promise<number> {
  if (!isRecoveryBatchWorkerEnabled()) return 0;
  if (!await recoveryBatchSchemaReady(db) ||
      !await isMonthlyAutomationSchemaReady(db) ||
      !await isUnknownReissueSchemaReady(db)) return 0;
  const waiting = await listWaitingRecoveryBatchTargets(db, getRecoveryConcurrency());
  await Promise.all(waiting.map(target => withLeaseHeartbeat(db, target)));
  const claimed = await claimRecoveryBatchTargets(db, getRecoveryConcurrency(), LEASE_SECONDS);
  await Promise.all(claimed.map(target => withLeaseHeartbeat(db, target)));
  return waiting.length + claimed.length;
}

let started = false;
let tickRunning = false;
export function startGrowthReportRecoveryBatchWorker(): void {
  if (started || !isRecoveryBatchWorkerEnabled()) return;
  started = true;
  cron.schedule("*/15 * * * * *", () => {
    if (tickRunning) return;
    tickRunning = true;
    void runRecoveryBatchWorkerOnce()
      .catch(() => logOperationalError({
        pool_id: "global",
        feature: "GROWTH",
        level: "ERROR",
        error_code: "GROWTH_REPORT_RECOVERY_BATCH_WORKER_ITERATION_FAILED",
        safe_message: "A growth report recovery worker iteration failed.",
        entity_type: "growth_report_recovery_batch",
      }))
      .finally(() => { tickRunning = false; });
  });
}