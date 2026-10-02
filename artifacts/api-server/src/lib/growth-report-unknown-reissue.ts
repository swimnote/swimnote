import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Request } from "express";
import {
  type GrowthReportAnalysisRequest,
  type GrowthReportAnalysisResponse,
  GROUNDING_PASS_VALUES,
  getEngineTimeoutMs,
  getEngineUrl,
} from "./growth-report-engine-client.js";
import { getGrowthReportAnalysisIdentityHash } from "./growth-report-analysis-identity.js";
import {
  buildInsufficientEvidenceNotice,
  INSUFFICIENT_EVIDENCE_DISPOSITION,
  INSUFFICIENT_EVIDENCE_VERSION,
  prepareMonthlyInsufficientEvidence,
} from "./growth-report-monthly-disposition.js";
import { transitionReportStatus } from "./growth-report-service.js";
import { isGrowthReportParentInputWindowOpen, persistAnalysisResponse,
  persistEngineResult, validateEngineResponse } from "./growth-report-result-handler.js";
import { reconcileMonthlyCycle } from "../jobs/growth-report-monthly-readiness.js";
import { freeReportIssueWindow } from "../jobs/growth-report-auto-publisher.js";
import { insertGrowthReportAdminReadyIntents } from "../utils/growth-report-notification-outbox.js";
import { hasUnknownRecoveryApprovalBoundary } from "./growth-report-monthly-run.js";

const APPROVAL_REASON = "OPERATOR_APPROVED_UNKNOWN_REISSUE";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_ID = /^[^\u0000-\u001f\u007f]{1,200}$/u;
type Db = {
  execute(query: unknown): Promise<{ rows: any[] }>;
  transaction<T>(callback: (tx: Db) => Promise<T>): Promise<T>;
};

export async function isUnknownReissueSchemaReady(db: Pick<Db, "execute">): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT to_regclass('public.growth_report_unknown_reissue_operations') IS NOT NULL AS ready
  `);
  return result.rows[0]?.ready === true || result.rows[0]?.ready === "t";
}

type Operation = {
  id: string;
  report_id: string;
  student_id: string;
  swimming_pool_id: string;
  report_period: string;
  original_request_id: string;
  new_request_id: string;
  recovery_generation: number;
  expected_payload_hash: string;
  original_payload: GrowthReportAnalysisRequest;
  original_report_snapshot: unknown;
  state: string;
  engine_response: GrowthReportAnalysisResponse | null;
  error_code: string | null;
  detail: string | null;
  retryable: boolean;
  lease_until: Date | string | null;
  dispatch_token: string | null;
  engine_confirmed_unknown: boolean;
  operator_subject: string;
};

function decodeJson<T>(value: unknown): T | null {
  if (typeof value === "string") {
    try { return JSON.parse(value) as T; } catch { return null; }
  }
  return value && typeof value === "object" ? value as T : null;
}

function publicResult(op: Operation, extra: Record<string, unknown> = {}) {
  return {
    report_id: op.report_id,
    recovery_operation_id: op.id,
    new_request_id: op.new_request_id,
    recovery_generation: Number(op.recovery_generation),
    state: op.state === "COMPLETE" &&
      op.engine_response?.analysis_status === "DATA_ACCUMULATING"
      ? "INSUFFICIENT_EVIDENCE" : op.state,
    terminal_outcome: op.engine_response?.analysis_status === "DATA_ACCUMULATING"
      ? "INSUFFICIENT_EVIDENCE" : op.state,
    retryable: op.retryable === true,
    ...(op.error_code ? { error_code: op.error_code } : {}),
    ...(op.detail ? { detail: op.detail } : {}),
    ...extra,
  };
}

function holdResult(reportId: string, reason: string) {
  return {
    report_id: reportId,
    recovery_operation_id: null,
    new_request_id: null,
    recovery_generation: null,
    state: "HOLD",
    error_code: reason,
    detail: "The stored UNKNOWN request cannot be safely reissued.",
  };
}

function operatorIdentityHold(op: Operation) {
  return publicResult(op, {
    state: "HOLD",
    error_code: "OPERATOR_IDENTITY_MISMATCH",
    detail: "Replay must use the identity that originally approved this ENGINE operation.",
  });
}

async function createOrFindOperation(
  db: Db,
  reportId: string,
  actorId: string,
  actorRole: string,
  reason: string,
  approval: { nextGeneration: boolean; expectedOperationId?: string },
): Promise<Operation | { hold: string }> {
  return db.transaction(async tx => {
    const existing = await tx.execute(sql`
      SELECT * FROM growth_report_unknown_reissue_operations
      WHERE report_id = ${reportId}
      ORDER BY recovery_generation DESC, created_at DESC
      LIMIT 1
    `);
    const priorBeforeLock = existing.rows[0] as Operation | undefined;
    if (priorBeforeLock && !approval.nextGeneration) return priorBeforeLock;

    const selected = await tx.execute(sql`
      SELECT report.id AS report_id, report.student_id, report.swimming_pool_id,
             report.report_period, report.analysis_request_id,
             report.analysis_request_payload, report.analysis_identity_hash,
             report.snapshot_hash, report.product_status, report.analysis_status,
             report.analysis_uncertain_at, report.analysis_response_payload,
             report.analysis_claim_token, report.analysis_lease_until,
             report.analysis_call_started_at, report.report_type,
             report.monthly_final_disposition, report.report_content,
             report.report_fact_package, report.sns_summary,
             report.updated_at, report.created_at,
              target.first_pass_outcome, target.first_pass_completed_at,
              target.recovery_epoch, target.recovery_approved_by,
              target.recovery_approval_reason,
             target.policy_excluded_at, target.policy_exclusion_reason,
             cycle.eligibility_sealed_at, cycle.eligible_total,
             cycle.parent_input_close_at,
             (SELECT COUNT(*)::int FROM growth_report_eligible_targets sealed_target
              WHERE sealed_target.cycle_id = cycle.id) AS actual_eligible_total
      FROM growth_reports report
      JOIN growth_report_cycles cycle
        ON cycle.id = report.cycle_id
       AND cycle.swimming_pool_id = report.swimming_pool_id
       AND cycle.report_period = report.report_period
       AND cycle.eligibility_sealed_at IS NOT NULL
       AND cycle.eligible_total IS NOT NULL
      JOIN growth_report_eligible_targets target
        ON target.cycle_id = report.cycle_id
       AND target.student_id = report.student_id
       AND target.policy_excluded_at IS NULL
      WHERE report.id = ${reportId}
        AND report.analysis_uncertain_at IS NOT NULL
        AND report.exclusion_code IS NULL
        AND report.monthly_final_disposition IS NULL
        AND cycle.eligible_total = (
          SELECT COUNT(*) FROM growth_report_eligible_targets all_target
          WHERE all_target.cycle_id = cycle.id
        )
        AND report.deleted_at IS NULL
       FOR UPDATE OF report, target
    `);
    const row = selected.rows[0];
    if (!row) return { hold: "REPORT_NOT_FOUND" };
    if (!hasUnknownRecoveryApprovalBoundary(row)) {
      return { hold: "UNKNOWN_RECOVERY_APPROVAL_REQUIRED" };
    }
    const lockedOperation = await tx.execute(sql`
      SELECT * FROM growth_report_unknown_reissue_operations
      WHERE report_id = ${reportId}
      ORDER BY recovery_generation DESC, created_at DESC
      LIMIT 1
    `);
    const previous = lockedOperation.rows[0] as Operation | undefined;
    if (previous && !approval.nextGeneration) return previous;
    if (approval.nextGeneration &&
        (!previous || previous.state !== "UNKNOWN" ||
          previous.engine_confirmed_unknown !== true ||
          approval.expectedOperationId !== previous.id ||
          row.analysis_request_id !== previous.new_request_id)) {
      return { hold: "EXPLICIT_NEXT_GENERATION_APPROVAL_REQUIRED" };
    }
    if (!APP_ID.test(String(row.student_id)) || !APP_ID.test(String(row.swimming_pool_id)) ||
        !APP_ID.test(String(row.report_id))) {
      return { hold: "REPORT_IDENTITY_INVALID" };
    }
    if (!["ANALYZING", "PREANALYZING"].includes(String(row.product_status)) ||
        row.monthly_final_disposition || row.exclusion_code ||
        row.policy_excluded_at != null || Number(row.eligible_total) !== Number(row.actual_eligible_total)) {
      return { hold: "REPORT_ALREADY_RESOLVED_OR_NOT_REISSUEABLE" };
    }

    const payload = decodeJson<GrowthReportAnalysisRequest>(row.analysis_request_payload);
    const validPayload = payload &&
      UUID.test(String(payload.request_id)) &&
      payload.request_id === row.analysis_request_id &&
      payload.report_id === reportId &&
      payload.context?.student_id === row.student_id &&
      payload.context?.pool_id === row.swimming_pool_id &&
      payload.context?.report_period === row.report_period &&
      typeof payload.snapshot?.payload_hash === "string" &&
      payload.snapshot.payload_hash === row.snapshot_hash &&
      UUID.test(String(row.analysis_request_id)) &&
      APP_ID.test(String(row.student_id)) &&
      APP_ID.test(String(row.swimming_pool_id)) &&
      APP_ID.test(String(reportId)) &&
      /^\d{4}-(0[1-9]|1[0-2])$/.test(String(row.report_period)) &&
      typeof row.snapshot_hash === "string" && row.snapshot_hash.length > 0;
    if (!validPayload) return { hold: "ORIGINAL_PAYLOAD_IDENTITY_INVALID" };

    const stage: "PREANALYSIS" | "FINAL_ANALYSIS" | null =
      row.analysis_identity_hash === getGrowthReportAnalysisIdentityHash(payload, "PREANALYSIS")
        ? "PREANALYSIS"
        : row.analysis_identity_hash === getGrowthReportAnalysisIdentityHash(payload, "FINAL_ANALYSIS")
          ? "FINAL_ANALYSIS"
          : null;
    if (!stage) return { hold: "ORIGINAL_ANALYSIS_IDENTITY_INVALID" };
    const priorResponse = decodeJson<Record<string, unknown>>(row.analysis_response_payload);
    const uncertainty = {
      analysis_uncertain_at: row.analysis_uncertain_at,
      analysis_response_payload: priorResponse,
      analysis_status: row.analysis_status,
      product_status: row.product_status,
      first_pass_outcome: row.first_pass_outcome ?? null,
      first_pass_completed_at: row.first_pass_completed_at ?? null,
    };
    const operationId = randomUUID();
    const newRequestId = randomUUID();
    const generation = Number(previous?.recovery_generation ?? 0) + 1;
    const inserted = await tx.execute(sql`
      INSERT INTO growth_report_unknown_reissue_operations
        (id, report_id, student_id, swimming_pool_id, report_period,
         original_request_id, new_request_id, recovery_generation,
         expected_payload_hash, original_payload, original_report_snapshot,
         original_uncertainty_snapshot, operator_subject, operator_role,
         approval_reason, operator_reason, approved_at, state)
      VALUES (${operationId}, ${reportId}, ${row.student_id}, ${row.swimming_pool_id},
        ${row.report_period}, ${row.analysis_request_id}, ${newRequestId}, ${generation},
        ${row.snapshot_hash}, ${JSON.stringify(payload)}::jsonb,
        ${JSON.stringify({
          ...row,
          analysis_request_payload: payload,
          analysis_response_payload: priorResponse,
        })}::jsonb,
        ${JSON.stringify(uncertainty)}::jsonb, ${actorId}, ${actorRole},
        ${APPROVAL_REASON}, ${reason}, now(), 'CREATED')
      RETURNING *
    `);
    return inserted.rows[0] as Operation;
  });
}

function toResult(op: Operation) {
  return publicResult(op);
}

async function terminalReplayResult(db: Db, op: Operation) {
  const detail = await reconcileTerminalOperation(db, op);
  return publicResult(op, detail ? { detail } : {});
}

function responseEnvelopeMatches(body: any, op: Operation): boolean {
  return body && body.recovery_operation_id === op.id &&
    body.original_request_id === op.original_request_id &&
    body.new_request_id === op.new_request_id &&
    Number(body.recovery_generation) === Number(op.recovery_generation);
}

function resultIdentityMatches(response: GrowthReportAnalysisResponse, op: Operation): boolean {
  const context = (response.fact_package as Record<string, any> | null)?.report_context;
  return response.request_id === op.new_request_id &&
    response.report_id === op.report_id &&
    response.trace?.payload_hash === op.expected_payload_hash &&
    context?.request_id === op.new_request_id &&
    context?.report_id === op.report_id &&
    context?.pool_id === op.swimming_pool_id &&
    context?.student_id === op.student_id &&
    (context?.report_period == null || context.report_period === op.report_period);
}

async function reconcileTerminalOperation(db: Db, op: Operation): Promise<string | null> {
  try {
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
      WHERE cycle.swimming_pool_id = ${op.swimming_pool_id}
        AND cycle.report_period = ${op.report_period}
      LIMIT 1
    `);
    const scope = cycleScope.rows[0];
    const currentPeriodEligible = scope &&
      op.report_period === issueWindow.reportPeriod &&
      (scope.x_paid_entitlement === true || scope.x_manual_entitlement === true) &&
      scope.x_force_disabled !== true && scope.approval_status === "approved";
    const priorPeriodEligible = scope &&
      op.report_period < issueWindow.reportPeriod && scope.ready_at == null;
    const recordReady = afterIssueWindow && Boolean(currentPeriodEligible || priorPeriodEligible);
    await reconcileMonthlyCycle(db as any, {
      poolId: op.swimming_pool_id,
      reportPeriod: op.report_period,
    }, recordReady ? async (tx, readiness) => {
      await insertGrowthReportAdminReadyIntents(tx, {
        poolId: op.swimming_pool_id,
        reportPeriod: op.report_period,
        message: "이번 달 AI 성장리포트 발행이 완료되었습니다.\nSWIMNOTE에서 확인해 주세요.",
        readiness,
      });
    } : undefined, { recordReady });
    return null;
  } catch (error: any) {
    const detail = `MONTHLY_RECONCILIATION_FAILED: ${String(error?.message ?? "unknown").slice(0, 300)}`;
    await db.execute(sql`
      UPDATE growth_report_unknown_reissue_operations
      SET detail = ${detail}, updated_at = now()
      WHERE id = ${op.id} AND state IN ('COMPLETE', 'UNKNOWN', 'FAILED')
    `);
    return detail;
  }
}

type DispatchClaim = { status: "CLAIMED"; token: string } |
  { status: "BUSY" | "COMPLETE"; token?: undefined };

export async function claimDispatch(db: Db, op: Operation): Promise<DispatchClaim> {
  const token = randomUUID();
  const result = await db.execute(sql`
    UPDATE growth_report_unknown_reissue_operations
    SET state = 'PROCESSING', lease_until = now() + interval '3 minutes',
        dispatch_token = ${token},
        updated_at = now(), error_code = NULL, detail = NULL
    WHERE id = ${op.id}
      AND (
        state IN ('CREATED', 'PROCESSING', 'UNKNOWN')
      )
      AND (lease_until IS NULL OR lease_until <= now())
    RETURNING id, dispatch_token
  `);
  if (result.rows.length) return { status: "CLAIMED", token };
  const status = await db.execute(sql`
    SELECT state FROM growth_report_unknown_reissue_operations WHERE id = ${op.id}
  `);
  return { status: status.rows[0]?.state === "COMPLETE" ? "COMPLETE" : "BUSY" };
}

async function recordEngineState(db: Db, op: Operation, token: string, state: string, fields: {
  response?: unknown; errorCode?: string; detail?: string; retryable?: boolean;
  engineConfirmedUnknown?: boolean;
} = {}) {
  const persistedState = state === "UNKNOWN" ? "UNKNOWN"
    : state === "CONFLICT" ? "CONFLICT"
      : state === "FAILED" ? "FAILED"
        : "PROCESSING";
  await db.transaction(async tx => {
    const locked = await tx.execute(sql`
      SELECT id FROM growth_report_unknown_reissue_operations
      WHERE id = ${op.id} AND state = 'PROCESSING' AND dispatch_token = ${token}
      FOR UPDATE
    `);
    if (!locked.rows.length) throw new Error("UNKNOWN_REISSUE_DISPATCH_OWNERSHIP_LOST");
    if (persistedState === "UNKNOWN" && fields.engineConfirmedUnknown) {
      const replacement = { ...op.original_payload, request_id: op.new_request_id };
      const updated = await tx.execute(sql`
        UPDATE growth_reports
        SET analysis_request_id = ${op.new_request_id},
            analysis_request_payload = ${JSON.stringify(replacement)}::jsonb,
            analysis_identity_hash = ${getGrowthReportAnalysisIdentityHash(
              replacement,
              decodeJson<Record<string, any>>(op.original_report_snapshot)
                ?.analysis_identity_hash === getGrowthReportAnalysisIdentityHash(op.original_payload, "PREANALYSIS")
                ? "PREANALYSIS" : "FINAL_ANALYSIS",
            )},
            analysis_claim_token = NULL, analysis_lease_until = NULL,
            analysis_next_attempt_at = NULL, updated_at = now()
        WHERE id = ${op.report_id}
          AND analysis_request_id IN (${op.original_request_id}, ${op.new_request_id})
          AND analysis_request_payload->>'request_id' = analysis_request_id::text
          AND analysis_uncertain_at IS NOT NULL
          AND product_status IN ('ANALYZING', 'PREANALYZING')
          AND deleted_at IS NULL
        RETURNING id
      `);
      if (!updated.rows.length) throw new Error("UNKNOWN_REISSUE_UNKNOWN_FENCE_LOST");
    }
    await tx.execute(sql`
      UPDATE growth_report_unknown_reissue_operations
      SET state = ${persistedState},
          engine_response = ${fields.response ? JSON.stringify(fields.response) : null}::jsonb,
          error_code = ${fields.errorCode ?? null},
          detail = ${fields.detail?.slice(0, 1000) ?? null},
          retryable = ${fields.retryable === true},
          engine_confirmed_unknown = CASE
            WHEN ${fields.engineConfirmedUnknown === true} THEN true
            WHEN ${persistedState} IN ('UNKNOWN', 'PROCESSING')
              THEN engine_confirmed_unknown
            ELSE false
          END,
          dispatch_token = NULL,
          lease_until = CASE WHEN ${persistedState} = 'PROCESSING'
            THEN now() + interval '3 minutes' ELSE NULL END,
          updated_at = now()
      WHERE id = ${op.id} AND state = 'PROCESSING' AND dispatch_token = ${token}
    `);
  });
}

async function settleKnownFailure(
  db: Db,
  op: Operation,
  token: string,
  fields: { errorCode: string; detail?: string; response?: unknown },
): Promise<void> {
  await db.transaction(async tx => {
    const ownership = await tx.execute(sql`
      SELECT id FROM growth_report_unknown_reissue_operations
      WHERE id = ${op.id} AND state = 'PROCESSING' AND dispatch_token = ${token}
      FOR UPDATE
    `);
    if (!ownership.rows.length) throw new Error("UNKNOWN_REISSUE_DISPATCH_OWNERSHIP_LOST");
    const stage: "PREANALYSIS" | "FINAL_ANALYSIS" =
      decodeJson<Record<string, any>>(op.original_report_snapshot)
        ?.analysis_identity_hash === getGrowthReportAnalysisIdentityHash(
          op.original_payload, "PREANALYSIS",
        ) ? "PREANALYSIS" : "FINAL_ANALYSIS";
    const replacement = { ...op.original_payload, request_id: op.new_request_id };
    const claimToken = randomUUID();
    const failed = await tx.execute(sql`
      UPDATE growth_reports
      SET analysis_request_id = ${op.new_request_id},
          analysis_request_payload = ${JSON.stringify(replacement)}::jsonb,
          analysis_identity_hash = ${getGrowthReportAnalysisIdentityHash(replacement, stage)},
          analysis_uncertain_at = NULL,
          analysis_claim_token = ${claimToken},
          analysis_lease_until = now() + interval '2 minutes',
          analysis_next_attempt_at = NULL,
          analysis_status = 'FAILED'::gr_analysis_status_enum,
          analysis_retry_count = COALESCE(analysis_retry_count, 0) + 1,
          updated_at = now()
      WHERE id = ${op.report_id}
        AND analysis_request_id IN (${op.original_request_id}, ${op.new_request_id})
        AND analysis_request_payload->>'request_id' = analysis_request_id::text
        AND analysis_uncertain_at IS NOT NULL
        AND (analysis_claim_token IS NULL OR analysis_lease_until <= now())
        AND product_status IN ('ANALYZING', 'PREANALYZING')
        AND deleted_at IS NULL
      RETURNING swimming_pool_id, product_status
    `);
    if (!failed.rows.length) throw new Error("UNKNOWN_REISSUE_FAILURE_FENCE_LOST");
    await transitionReportStatus({
      db: tx, reportId: op.report_id, toStatus: "FAILED",
      actorType: "system", actorId: null,
      reason: `UNKNOWN_REISSUE_ENGINE_${fields.errorCode}`,
      requestId: op.new_request_id,
    });
    await tx.execute(sql`
      UPDATE growth_reports
      SET analysis_claim_token = NULL, analysis_lease_until = NULL,
          analysis_next_attempt_at = NULL, updated_at = now()
      WHERE id = ${op.report_id} AND analysis_request_id = ${op.new_request_id}
        AND analysis_claim_token = ${claimToken}
        AND product_status = 'FAILED'::gr_product_status_enum
    `);
    const target = await tx.execute(sql`
      UPDATE growth_report_eligible_targets
      SET first_pass_completed_at = COALESCE(first_pass_completed_at, now()),
          first_pass_outcome = 'failed',
          first_pass_error_code = ${fields.errorCode},
          first_pass_error_category = 'ENGINE'
      WHERE cycle_id = (
        SELECT cycle_id FROM growth_reports
        WHERE id = ${op.report_id} AND analysis_request_id = ${op.new_request_id}
      )
        AND student_id = ${op.student_id}
        AND (first_pass_outcome IS NULL OR first_pass_outcome = 'unknown')
      RETURNING student_id
    `);
    if (!target.rows.length) throw new Error("UNKNOWN_REISSUE_TARGET_OUTCOME_FENCE_LOST");
    await tx.execute(sql`
      UPDATE growth_report_unknown_reissue_operations
      SET state = 'FAILED', engine_response = ${fields.response
        ? JSON.stringify(fields.response) : null}::jsonb,
          error_code = ${fields.errorCode},
          detail = ${fields.detail?.slice(0, 1000) ?? null},
          retryable = true, engine_confirmed_unknown = false,
          dispatch_token = NULL, lease_until = NULL, updated_at = now()
      WHERE id = ${op.id} AND state = 'PROCESSING' AND dispatch_token = ${token}
    `);
  });
}

async function importCompleteResult(
  db: Db,
  op: Operation,
  dispatchToken: string,
  response: GrowthReportAnalysisResponse,
): Promise<void> {
  validateEngineResponse(
    response, op.new_request_id, op.report_id, op.expected_payload_hash, true,
  );
  if (response.analysis_status !== "DATA_ACCUMULATING") {
    const grounding = typeof response.validation?.grounding === "string"
      ? response.validation.grounding : (response.validation?.grounding as any)?.status;
    const framing = typeof response.validation?.growth_framing === "string"
      ? response.validation.growth_framing : (response.validation?.growth_framing as any)?.status;
    if (!GROUNDING_PASS_VALUES.has(String(grounding)) ||
        !GROUNDING_PASS_VALUES.has(String(framing))) {
      throw new Error("UNKNOWN_REISSUE_RESULT_GROUNDING_REJECTED");
    }
  }
  const originalIdentityHash = decodeJson<Record<string, any>>(op.original_report_snapshot)
    ?.analysis_identity_hash;
  const stage: "PREANALYSIS" | "FINAL_ANALYSIS" | null =
    originalIdentityHash === getGrowthReportAnalysisIdentityHash(op.original_payload, "PREANALYSIS")
      ? "PREANALYSIS"
      : originalIdentityHash === getGrowthReportAnalysisIdentityHash(op.original_payload, "FINAL_ANALYSIS")
        ? "FINAL_ANALYSIS" : null;
  if (!stage) throw new Error("UNKNOWN_REISSUE_ORIGINAL_STAGE_INVALID");
  await db.transaction(async tx => {
    const ownership = await tx.execute(sql`
      SELECT id FROM growth_report_unknown_reissue_operations
      WHERE id = ${op.id} AND state = 'PROCESSING' AND dispatch_token = ${dispatchToken}
      FOR UPDATE
    `);
    if (!ownership.rows.length) throw new Error("UNKNOWN_REISSUE_DISPATCH_OWNERSHIP_LOST");
    const claimToken = randomUUID();
    const cloned = { ...op.original_payload, request_id: op.new_request_id };
    const acquired = await tx.execute(sql`
    UPDATE growth_reports report
    SET analysis_request_id = ${op.new_request_id},
        analysis_request_payload = ${JSON.stringify(cloned)}::jsonb,
        analysis_identity_hash = ${getGrowthReportAnalysisIdentityHash(cloned, stage)},
        analysis_status = NULL,
        analysis_uncertain_at = NULL,
        analysis_claim_token = ${claimToken},
        analysis_lease_until = now() + interval '5 minutes',
        analysis_call_started_at = now(),
        report_content = NULL, report_fact_package = NULL, sns_summary = NULL,
        updated_at = now()
    FROM growth_report_cycles cycle
    WHERE report.id = ${op.report_id}
      AND report.cycle_id = cycle.id
      AND report.analysis_request_id IN (${op.original_request_id}, ${op.new_request_id})
      AND report.analysis_request_payload->>'request_id' = report.analysis_request_id::text
      AND report.analysis_uncertain_at IS NOT NULL
      AND (report.analysis_claim_token IS NULL OR report.analysis_lease_until <= now())
      AND report.product_status = ${stage === "PREANALYSIS" ? "PREANALYZING" : "ANALYZING"}::gr_product_status_enum
      AND report.deleted_at IS NULL
    RETURNING report.id, report.swimming_pool_id, report.product_status,
              report.report_type, cycle.parent_input_close_at
  `);
  if (!acquired.rows.length) throw new Error("UNKNOWN_REISSUE_IMPORT_FENCE_LOST");
  const report = acquired.rows[0];
  const expectedStatus = stage === "PREANALYSIS" ? "PREANALYZING" : "ANALYZING";
  if (report.product_status !== expectedStatus) throw new Error("UNKNOWN_REISSUE_STAGE_MISMATCH");
  if (!await persistAnalysisResponse({
    db: tx, reportId: op.report_id, requestId: op.new_request_id,
    response, stage, claimToken,
  })) throw new Error("UNKNOWN_REISSUE_RESPONSE_CLAIM_LOST");
  if (response.analysis_status === "DATA_ACCUMULATING") {
    const prepared = await prepareMonthlyInsufficientEvidence(tx, {
      reportId: op.report_id, requestId: op.new_request_id,
      payloadHash: op.expected_payload_hash, claimToken,
    });
    if (!prepared) await normalizeLegacyInsufficientEvidence(tx, op, claimToken);
  } else {
    const parentInputWindowOpen = isGrowthReportParentInputWindowOpen(
      report.report_type ?? null,
      report.parent_input_close_at instanceof Date
        ? report.parent_input_close_at.toISOString()
        : String(report.parent_input_close_at),
    );
    const persisted = await persistEngineResult({
      db: tx, report: { id: op.report_id, swimming_pool_id: op.swimming_pool_id },
      requestId: op.new_request_id, payloadHash: op.expected_payload_hash,
      response, stage, parentInputWindowOpen, claimToken,
    });
    if (persisted.productStatus === "REVIEW_REQUIRED") {
      const target = await tx.execute(sql`
        UPDATE growth_report_eligible_targets
        SET first_pass_completed_at = COALESCE(first_pass_completed_at, now()),
            first_pass_outcome = 'generated',
            first_pass_error_code = NULL, first_pass_error_category = NULL
        WHERE cycle_id = (
          SELECT cycle_id FROM growth_reports
          WHERE id = ${op.report_id} AND analysis_request_id = ${op.new_request_id}
        )
          AND student_id = ${op.student_id}
          AND (first_pass_outcome IS NULL OR first_pass_outcome = 'unknown')
        RETURNING student_id
      `);
      if (!target.rows.length) throw new Error("UNKNOWN_REISSUE_GENERATED_OUTCOME_NOT_RECORDED");
    }
  }
  const finalized = await tx.execute(sql`
    UPDATE growth_report_unknown_reissue_operations
    SET state = 'COMPLETE', engine_response = ${JSON.stringify(response)}::jsonb,
        dispatch_token = NULL, lease_until = NULL, engine_confirmed_unknown = false,
        updated_at = now()
    WHERE id = ${op.id} AND state = 'PROCESSING' AND dispatch_token = ${dispatchToken}
    RETURNING id
  `);
  if (!finalized.rows.length) throw new Error("UNKNOWN_REISSUE_DISPATCH_OWNERSHIP_LOST");
  });
}

async function normalizeLegacyInsufficientEvidence(
  tx: Db, op: Operation, claimToken: string,
): Promise<void> {
    const legacy = await tx.execute(sql`
      SELECT report.product_status, report.monthly_final_disposition,
             report.analysis_status, report.analysis_uncertain_at,
             report.analysis_request_id, report.analysis_claim_token,
             target.first_pass_outcome, target.first_pass_completed_at,
             cycle.id AS cycle_id, cycle.eligible_total,
             cycle.parent_input_close_at, student.name AS student_name
      FROM growth_reports report
      JOIN growth_report_cycles cycle
        ON cycle.id = report.cycle_id
       AND cycle.swimming_pool_id = report.swimming_pool_id
       AND cycle.report_period = report.report_period
       AND cycle.eligibility_sealed_at IS NOT NULL
       AND cycle.eligible_total IS NOT NULL
       AND cycle.eligible_total = (
         SELECT COUNT(*) FROM growth_report_eligible_targets all_target
         WHERE all_target.cycle_id = cycle.id
       )
      JOIN growth_report_eligible_targets target
        ON target.cycle_id = cycle.id AND target.student_id = report.student_id
       AND target.policy_excluded_at IS NULL
      JOIN students student
        ON student.id = report.student_id
       AND student.swimming_pool_id = report.swimming_pool_id
       AND student.deleted_at IS NULL
      WHERE report.id = ${op.report_id}
        AND report.analysis_request_id = ${op.new_request_id}
        AND report.analysis_uncertain_at IS NULL
        AND report.analysis_status IS NULL
        AND report.product_status IN ('ANALYZING', 'PREANALYZING')
        AND report.analysis_claim_token = ${claimToken}
        AND report.analysis_lease_until > now()
        AND report.monthly_final_disposition IS NULL
        AND (target.first_pass_outcome IS NULL
          OR target.first_pass_outcome IN ('unknown', 'failed'))
      FOR UPDATE OF report, target
    `);
    const row = legacy.rows[0];
    if (!row || !String(row.student_name ?? "").trim()) {
      throw new Error("UNKNOWN_REISSUE_INSUFFICIENT_TARGET_NOT_ELIGIBLE");
    }
    const content = buildInsufficientEvidenceNotice(String(row.student_name));
    const normalized = await tx.execute(sql`
      UPDATE growth_reports
      SET analysis_status = 'DATA_ACCUMULATING'::gr_analysis_status_enum,
          report_content = ${JSON.stringify(content)}::jsonb,
          report_fact_package = NULL,
          sns_summary = NULL,
          monthly_final_disposition = ${INSUFFICIENT_EVIDENCE_DISPOSITION},
          monthly_disposition_version = ${INSUFFICIENT_EVIDENCE_VERSION},
          updated_at = now()
      WHERE id = ${op.report_id}
        AND analysis_request_id = ${op.new_request_id}
        AND analysis_status IS NULL
        AND product_status IN ('ANALYZING', 'PREANALYZING')
        AND analysis_uncertain_at IS NULL
        AND analysis_claim_token = ${claimToken}
        AND analysis_lease_until > now()
        AND monthly_final_disposition IS NULL
      RETURNING id
    `);
    if (!normalized.rows.length) throw new Error("UNKNOWN_REISSUE_INSUFFICIENT_REPORT_FENCE_LOST");
    await transitionReportStatus({
      db: tx, reportId: op.report_id, toStatus: "PARTIAL",
      actorType: "system", actorId: null,
      reason: "ENGINE_DATA_ACCUMULATING",
    });
    await transitionReportStatus({
      db: tx, reportId: op.report_id, toStatus: "REVIEW_REQUIRED",
      actorType: "system", actorId: null,
      reason: "OPERATOR_UNKNOWN_REISSUE_INSUFFICIENT_EVIDENCE",
    });
    const recorded = await tx.execute(sql`
      UPDATE growth_report_eligible_targets target
      SET first_pass_completed_at = COALESCE(first_pass_completed_at, now()),
          first_pass_outcome = 'insufficient_evidence',
          first_pass_error_code = NULL,
          first_pass_error_category = NULL
      WHERE target.cycle_id = (
        SELECT cycle_id FROM growth_reports
        WHERE id = ${op.report_id} AND analysis_request_id = ${op.new_request_id}
      )
        AND target.student_id = ${op.student_id}
        AND target.policy_excluded_at IS NULL
        AND (target.first_pass_outcome IS NULL
          OR target.first_pass_outcome IN ('unknown', 'failed'))
      RETURNING target.student_id
    `);
    if (!recorded.rows.length) throw new Error("UNKNOWN_REISSUE_INSUFFICIENT_OUTCOME_NOT_RECORDED");
    await tx.execute(sql`
      UPDATE growth_reports
      SET analysis_claim_token = NULL, analysis_lease_until = NULL,
          analysis_next_attempt_at = NULL, updated_at = now()
      WHERE id = ${op.report_id}
        AND analysis_request_id = ${op.new_request_id}
        AND product_status = 'REVIEW_REQUIRED'
    `);
}

export function buildEngineReissuePayload(op: Operation) {
  return {
    original_request_id: op.original_request_id,
    new_request_id: op.new_request_id,
    recovery_operation_id: op.id,
    expected_payload_hash: op.expected_payload_hash,
    original_payload: op.original_payload,
    operator_approval: { approved: true, reason: APPROVAL_REASON },
  };
}

export function buildEngineReissueHeaders(serviceSecret: string, operatorAuthorization: string) {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${serviceSecret}`,
    "X-Operator-Authorization": operatorAuthorization,
  };
}

export async function callReissue(
  op: Operation,
  operatorAuthorization: string,
): Promise<{ status: number; body: any }> {
  const baseUrl = getEngineUrl().replace(/\/+$/, "");
  const secret = (process.env["PROFESSIONAL_ENGINE_API_SECRET"] ?? "").trim();
  if (!baseUrl || !secret) throw new Error(!baseUrl
    ? "ENGINE_URL_NOT_CONFIGURED" : "ENGINE_SERVICE_SECRET_NOT_CONFIGURED");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getEngineTimeoutMs());
  const body = buildEngineReissuePayload(op);
  try {
    const response = await fetch(`${baseUrl}/api/v1/growth-report/recovery/reissue`, {
      method: "POST",
      headers: buildEngineReissueHeaders(secret, operatorAuthorization),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    return { status: response.status, body: data };
  } finally {
    clearTimeout(timer);
  }
}

export async function reissueUnknownGrowthReports(
  db: Db,
  params: {
    reportIds: string[];
    actorId: string;
    actorRole: string;
    reason: string;
    nextGeneration?: boolean;
    expectedOperationIds?: Record<string, string>;
    operatorAuthorization: string;
  },
): Promise<Array<Record<string, unknown>>> {
  const results: Array<Record<string, unknown>> = [];
  for (const reportId of [...new Set(params.reportIds)]) {
    if (!APP_ID.test(reportId)) {
      results.push(holdResult(reportId, "INVALID_REPORT_ID"));
      continue;
    }
    const found = await createOrFindOperation(
      db, reportId, params.actorId, params.actorRole, params.reason, {
        nextGeneration: params.nextGeneration === true,
        expectedOperationId: params.expectedOperationIds?.[reportId],
      },
    );
    if ("hold" in found) {
      results.push(holdResult(reportId, found.hold));
      continue;
    }
    const op = found as Operation;
    if (op.operator_subject !== params.actorId) {
      results.push(operatorIdentityHold(op));
      continue;
    }
    if (op.state === "COMPLETE" && op.engine_response) {
      results.push(await terminalReplayResult(db, op));
      continue;
    }
    if (op.state === "CONFLICT") {
      results.push(publicResult(op));
      continue;
    }
    if (op.state === "FAILED") {
      results.push(await terminalReplayResult(db, op));
      continue;
    }
    const claimed = await claimDispatch(db, op);
    if (claimed.status === "COMPLETE") {
      const current = await db.execute(sql`
        SELECT * FROM growth_report_unknown_reissue_operations WHERE id = ${op.id}
      `);
      const latest = current.rows[0] as Operation;
      results.push(await terminalReplayResult(db, latest));
      continue;
    }
    if (claimed.status === "BUSY") {
      results.push(publicResult({ ...op, state: "PROCESSING" }));
      continue;
    }
    const dispatchToken = claimed.token;
    try {
      const engine = await callReissue(op, params.operatorAuthorization);
      const data = engine.body;
      if (engine.status === 409) {
        const errorCode = String(data?.error_code ?? "ENGINE_REISSUE_CONFLICT");
        await recordEngineState(db, op, dispatchToken, "CONFLICT", {
          errorCode,
          detail: typeof data?.detail === "string" ? data.detail : undefined,
          response: data,
        });
        results.push(publicResult({ ...op, state: "CONFLICT", error_code: errorCode }));
        continue;
      }
      if (engine.status >= 500 && !responseEnvelopeMatches(data, op)) {
        const errorCode = `ENGINE_HTTP_${engine.status}_AMBIGUOUS`;
        await recordEngineState(db, op, dispatchToken, "UNKNOWN", {
          errorCode,
          detail: "ENGINE server error lacked recovery lineage; same-operation replay is required.",
          response: data,
        });
        results.push(publicResult({ ...op, state: "UNKNOWN", error_code: errorCode }));
        continue;
      }
      if (!responseEnvelopeMatches(data, op)) {
        await recordEngineState(db, op, dispatchToken, "CONFLICT", {
          errorCode: "ENGINE_RECOVERY_ENVELOPE_MISMATCH",
          detail: "ENGINE recovery operation/request identity envelope did not match.",
          response: data,
        });
        results.push(publicResult({ ...op, state: "CONFLICT",
          error_code: "ENGINE_RECOVERY_ENVELOPE_MISMATCH" }));
        continue;
      }
      if (typeof data.status !== "string") {
        await recordEngineState(db, op, dispatchToken, "CONFLICT", {
          errorCode: "ENGINE_RECOVERY_RESPONSE_INVALID",
          detail: "ENGINE response did not include an operation state.",
          response: data,
        });
        results.push(publicResult({ ...op, state: "CONFLICT",
          error_code: "ENGINE_RECOVERY_RESPONSE_INVALID" }));
        continue;
      }
      if (String(data.status).toUpperCase() === "CONFLICT") {
        await recordEngineState(db, op, dispatchToken, "CONFLICT", {
          errorCode: String(data.error_code ?? "ENGINE_RECOVERY_CONFLICT"),
          detail: typeof data.detail === "string" ? data.detail : undefined,
          response: data,
        });
        results.push(publicResult({ ...op, state: "CONFLICT",
          error_code: String(data.error_code ?? "ENGINE_RECOVERY_CONFLICT") }));
        continue;
      }
      const state = String(data.status).toUpperCase();
      if (state === "COMPLETE") {
        if (engine.status < 200 || engine.status >= 300) {
          await recordEngineState(db, op, dispatchToken, "CONFLICT", {
            errorCode: "ENGINE_HTTP_COMPLETE_STATUS_MISMATCH",
            detail: `ENGINE returned COMPLETE with HTTP ${engine.status}.`,
            response: data,
          });
          results.push(publicResult({ ...op, state: "CONFLICT",
            error_code: "ENGINE_HTTP_COMPLETE_STATUS_MISMATCH" }));
          continue;
        }
        const response = decodeJson<GrowthReportAnalysisResponse>(data.result);
        if (!response || !resultIdentityMatches(response, op)) {
          await recordEngineState(db, op, dispatchToken, "CONFLICT", {
            errorCode: "ENGINE_RESULT_IDENTITY_MISMATCH",
            detail: "Completed result report context did not match the persisted request.",
            response: data,
          });
          results.push(publicResult({ ...op, state: "CONFLICT",
            error_code: "ENGINE_RESULT_IDENTITY_MISMATCH" }));
          continue;
        }
        try {
          await importCompleteResult(db, op, dispatchToken, response);
        } catch (error: any) {
          await recordEngineState(db, op, dispatchToken, "CONFLICT", {
            errorCode: "ENGINE_COMPLETE_RESULT_IMPORT_REJECTED",
            detail: String(error?.message ?? "Validated result could not be imported."),
            response: data,
          });
          results.push(publicResult({ ...op, state: "CONFLICT",
            error_code: "ENGINE_COMPLETE_RESULT_IMPORT_REJECTED" }));
          continue;
        }
        const reconcileDetail = await reconcileTerminalOperation(db, op);
        results.push(publicResult({ ...op, state: "COMPLETE", engine_response: response,
          detail: reconcileDetail ?? undefined }));
        continue;
      }
      if (state === "PROCESSING") {
        await recordEngineState(db, op, dispatchToken, state, { response: data });
        results.push(publicResult({ ...op, state }));
        continue;
      }
      if (state === "UNKNOWN") {
        await recordEngineState(db, op, dispatchToken, "UNKNOWN", {
          errorCode: String(data.error_code ?? "ENGINE_OUTCOME_UNKNOWN"),
          detail: typeof data.detail === "string" ? data.detail : undefined,
          response: data,
          engineConfirmedUnknown: true,
        });
        const reconcileDetail = await reconcileTerminalOperation(db, op);
        results.push(publicResult({ ...op, state: "UNKNOWN",
          engine_confirmed_unknown: true, detail: reconcileDetail ?? undefined }));
        continue;
      }
      const retryable = data.retryable === true || data.registry_retryable === true;
      const errorCode = String(data.error_code ?? "ENGINE_REISSUE_FAILED");
      await settleKnownFailure(db, op, dispatchToken, {
        errorCode,
        detail: typeof data.detail === "string" ? data.detail : `ENGINE_HTTP_${engine.status}`,
        response: data,
        retryable,
      });
      const reconcileDetail = await reconcileTerminalOperation(db, op);
      results.push(publicResult({ ...op, state: "FAILED", error_code: errorCode,
        retryable, detail: reconcileDetail ?? undefined }));
    } catch (error: any) {
      // An APP timeout is ambiguous: retain a durable UNKNOWN and allow only
      // an explicit same-operation replay through this endpoint.
      const code = String(error?.message ?? "");
      await recordEngineState(db, op, dispatchToken, "UNKNOWN", {
        errorCode: "ENGINE_REISSUE_OUTCOME_UNKNOWN",
        detail: code === "ENGINE_URL_NOT_CONFIGURED" ||
          code === "ENGINE_SERVICE_SECRET_NOT_CONFIGURED"
          ? "ENGINE reissue was not sent; same-operation replay is required after server configuration."
          : error?.message ?? "ENGINE request outcome is unknown",
      });
      results.push(publicResult({ ...op, state: "UNKNOWN",
        error_code: "ENGINE_REISSUE_OUTCOME_UNKNOWN" }));
    }
  }
  return results;
}

export function operatorBearerFromRequest(req: Request): string | null {
  const authorization = req.header("authorization");
  return authorization && /^Bearer\s+\S+$/i.test(authorization) ? authorization : null;
}
