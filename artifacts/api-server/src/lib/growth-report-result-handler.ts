/**
 * growth-report-result-handler.ts
 *
 * ENGINE response validation, Product status mapping, and DB persistence.
 *
 * RESPONSIBILITY BOUNDARY (GR3 spec §1):
 *   - Validate ENGINE response shape, IDs, hashes
 *   - Map ENGINE analysis_status → APP product_status (central — not spread in routes)
 *   - Persist structured results to growth_reports
 *   - Persist questions to growth_report_questions (upsert)
 *   - Reject grounding/framing FAIL responses before DB write
 *   - Stale response CAS (compare-and-set on analysis_request_id)
 *   - Audit writes
 *
 * APP does NOT:
 *   - Rewrite report_content text
 *   - Change sns_summary.share_safe false → true
 *   - Interpret metric meaning
 *   - Create questions
 */

import { sql } from "drizzle-orm";
import {
  GR_SNAPSHOT_VERSION_DB,
  type GrowthReportAnalysisResponse,
  type EngineAnalysisStatus,
  isValidEngineAnalysisStatus,
  GROUNDING_PASS_VALUES,
} from "./growth-report-engine-client.js";
import { transitionReportStatus } from "./growth-report-service.js";
import { retryDisposition } from "./growth-report-analysis-identity.js";
import {
  isMonthlyDispositionRun,
  prepareMonthlyInsufficientEvidence,
} from "./growth-report-monthly-disposition.js";

// ─── APP product status set (must not appear in ENGINE response) ──────────────

const APP_PRODUCT_STATUSES = new Set([
  "NOT_OPEN", "OPEN", "PREANALYZING", "QUESTION_AVAILABLE",
  "READY_FOR_ANALYSIS", "ANALYZING", "REVIEW_REQUIRED",
  "PARTIAL", "FAILED", "APPROVED", "PUBLISHED",
]);

// ─── Error types ──────────────────────────────────────────────────────────────

export class EngineResponseValidationError extends Error {
  constructor(
    public readonly reason: string,
    public readonly field?: string,
  ) {
    super(
      `ENGINE response validation failed: ${reason}` +
      (field ? ` [field: ${field}]` : ""),
    );
    this.name = "EngineResponseValidationError";
  }
}

export class StaleEngineResponseError extends Error {
  constructor(
    public readonly reportId: string,
    public readonly requestId: string,
  ) {
    super(
      `Stale ENGINE response rejected — report=${reportId} request=${requestId}`,
    );
    this.name = "StaleEngineResponseError";
  }
}

export class GroundingFailError extends Error {
  constructor(
    public readonly field: "grounding" | "growth_framing",
    public readonly value: string,
  ) {
    super(
      `ENGINE response ${field}=${value} is not PASS/REVISED_PASS — content rejected`,
    );
    this.name = "GroundingFailError";
  }
}

// ─── Response validator ───────────────────────────────────────────────────────

/**
 * validateEngineResponse — asserts the response has the correct shape.
 * Throws EngineResponseValidationError on any mismatch.
 *
 * Does NOT check grounding/framing gate (that is done in persistEngineResult
 * so the error type distinguishes gate failure from shape failure).
 */
export function validateEngineResponse(
  response: unknown,
  requestId: string,
  reportId: string,
  sentPayloadHash: string,
  allowMonthlyInsufficientEvidence = false,
): asserts response is GrowthReportAnalysisResponse {
  const r = response as Record<string, unknown>;
  if (!r || typeof r !== "object" || Array.isArray(r)) {
    throw new EngineResponseValidationError("response is not an object");
  }

  // request_id match
  if (r["request_id"] !== requestId) {
    throw new EngineResponseValidationError(
      `request_id mismatch: got "${String(r["request_id"])}" expected "${requestId}"`,
      "request_id",
    );
  }

  // report_id match
  if (r["report_id"] !== reportId) {
    throw new EngineResponseValidationError(
      `report_id mismatch: got "${String(r["report_id"])}" expected "${reportId}"`,
      "report_id",
    );
  }

  // analysis_status must be a valid ENGINE status
  if (!isValidEngineAnalysisStatus(r["analysis_status"])) {
    throw new EngineResponseValidationError(
      `invalid analysis_status: "${String(r["analysis_status"])}"`,
      "analysis_status",
    );
  }

  // APP lifecycle status must NOT appear in ENGINE response
  if (APP_PRODUCT_STATUSES.has(String(r["analysis_status"]))) {
    throw new EngineResponseValidationError(
      `APP product_status "${String(r["analysis_status"])}" found in ENGINE response`,
      "analysis_status",
    );
  }

  // questions must be an array
  if (!Array.isArray(r["questions"])) {
    throw new EngineResponseValidationError(
      "questions is not an array",
      "questions",
    );
  }

  // report_content must be a plain object
  if (
    typeof r["report_content"] !== "object" ||
    r["report_content"] === null ||
    Array.isArray(r["report_content"])
  ) {
    throw new EngineResponseValidationError(
      "report_content must be a plain object",
      "report_content",
    );
  }

  // sns_summary must be a plain object
  if (!(allowMonthlyInsufficientEvidence && r["analysis_status"] === "DATA_ACCUMULATING" &&
      r["sns_summary"] === null) && (
    typeof r["sns_summary"] !== "object" ||
    r["sns_summary"] === null ||
    Array.isArray(r["sns_summary"])
  )) {
    throw new EngineResponseValidationError(
      "sns_summary must be a plain object",
      "sns_summary",
    );
  }

  // fact_package must be a plain object
  if (
    typeof r["fact_package"] !== "object" ||
    r["fact_package"] === null ||
    Array.isArray(r["fact_package"])
  ) {
    throw new EngineResponseValidationError(
      "fact_package must be a plain object",
      "fact_package",
    );
  }

  // validation object
  const validation = r["validation"];
  if (!validation || typeof validation !== "object" || Array.isArray(validation)) {
    throw new EngineResponseValidationError(
      "validation is missing or not an object",
      "validation",
    );
  }

  // trace.payload_hash must match what we sent
  const trace = r["trace"];
  if (!trace || typeof trace !== "object" || Array.isArray(trace)) {
    throw new EngineResponseValidationError("trace is missing or not an object", "trace");
  }
  const traceHash = (trace as Record<string, unknown>)["payload_hash"];
  if (traceHash !== sentPayloadHash) {
    throw new EngineResponseValidationError(
      `trace.payload_hash mismatch: got "${String(traceHash)}" expected "${sentPayloadHash}"`,
      "trace.payload_hash",
    );
  }
}

// ─── Status mapping ───────────────────────────────────────────────────────────

export type AnalysisStage = "PREANALYSIS" | "FINAL_ANALYSIS";

export interface StatusMappingContext {
  questionsCount: number;
  parentInputWindowOpen: boolean;  // now < cycle.parent_input_close_at
}

/**
 * Free monthly reports do not offer parent input (the parent route explicitly
 * rejects `monthly` report_type). Preserve ENGINE questions as optional data,
 * but do not hold a complete PREANALYSIS result in QUESTION_AVAILABLE.
 */
export function isGrowthReportParentInputWindowOpen(
  reportType: string | null,
  parentInputCloseAt: string,
  now = new Date(),
): boolean {
  if (reportType === null || reportType === "" || reportType === "monthly") return false;
  return now < new Date(parentInputCloseAt);
}

/**
 * mapEngineStatusToProductStatus — central mapping function.
 * Mapping logic is NOT spread across routes.
 *
 * PREANALYSIS (Pass 1, started from OPEN):
 *   COMPLETE_WITH_QUESTIONS_AVAILABLE + window open + questions > 0  → QUESTION_AVAILABLE
 *   COMPLETE + no questions                                           → READY_FOR_ANALYSIS
 *   COMPLETE + questions + window open                                → QUESTION_AVAILABLE
 *   COMPLETE + questions + window closed                              → READY_FOR_ANALYSIS
 *   PARTIAL                                                           → PARTIAL
 *   COMPLETE_WITH_PARENT_EVIDENCE (unusual in Pass 1)                → READY_FOR_ANALYSIS
 *
 * FINAL_ANALYSIS (Pass 2, started from READY_FOR_ANALYSIS):
 *   COMPLETE / COMPLETE_WITH_QUESTIONS_AVAILABLE /
 *   COMPLETE_WITH_PARENT_EVIDENCE / PARTIAL                          → REVIEW_REQUIRED
 *   (PARTIAL is reviewable by teacher — spec §6)
 *
 * DATA_ACCUMULATING (any stage):
 *   Insufficient data signal — handled before this function in persistEngineResult.
 *   This function is never called with DATA_ACCUMULATING; callers must guard.
 */
export function mapEngineStatusToProductStatus(
  engineStatus: EngineAnalysisStatus,
  stage: AnalysisStage,
  ctx: StatusMappingContext,
): "QUESTION_AVAILABLE" | "READY_FOR_ANALYSIS" | "REVIEW_REQUIRED" | "PARTIAL" {
  // DATA_ACCUMULATING must be intercepted before calling this function.
  // If it reaches here, treat as PARTIAL (defensive fallback — should not occur).
  if (engineStatus === "DATA_ACCUMULATING") {
    return "PARTIAL";
  }

  if (stage === "PREANALYSIS") {
    switch (engineStatus) {
      case "COMPLETE_WITH_QUESTIONS_AVAILABLE":
        return ctx.questionsCount > 0 && ctx.parentInputWindowOpen
          ? "QUESTION_AVAILABLE"
          : "READY_FOR_ANALYSIS";

      case "COMPLETE":
        if (ctx.questionsCount > 0 && ctx.parentInputWindowOpen) return "QUESTION_AVAILABLE";
        return "READY_FOR_ANALYSIS";

      case "PARTIAL":
        return "PARTIAL";

      case "COMPLETE_WITH_PARENT_EVIDENCE":
        // Unusual in Pass 1 (no parent answers yet) — treat as COMPLETE
        return "READY_FOR_ANALYSIS";
    }
  }

  // FINAL_ANALYSIS — all complete/partial states map to REVIEW_REQUIRED
  return "REVIEW_REQUIRED";
}

// ─── Question persistence ─────────────────────────────────────────────────────

/**
 * persistEngineQuestions — upserts ENGINE questions into growth_report_questions.
 * APP does NOT modify question_text or options.
 * 0 questions is valid (no DB writes).
 */
export async function persistEngineQuestions(
  db: any,
  reportId: string,
  questions: GrowthReportAnalysisResponse["questions"],
): Promise<void> {
  if (questions.length === 0) return;

  for (const q of questions) {
    const optionsJson    = JSON.stringify(q.options ?? []);
    const reasonJson     = q.reason_codes != null ? JSON.stringify(q.reason_codes) : null;
    const answerType     = q.answer_type as string;

    await db.execute(sql`
      INSERT INTO growth_report_questions (
        id, report_id, engine_question_id, metric_id,
        question_text, answer_type,
        options, parent_confirmable_behavior, question_stage, reason_codes,
        sequence, is_required,
        metric_definition_version, question_policy_version,
        created_at
      ) VALUES (
        gen_random_uuid(), ${reportId}, ${(q as any).engine_question_id ?? (q as any).question_id ?? null}, ${q.metric_id},
        ${q.question_text}, ${answerType},
        ${optionsJson}::jsonb,
        ${q.parent_confirmable_behavior ?? null},
        ${q.question_stage ?? null},
        ${reasonJson}::jsonb,
        ${q.sequence}, ${q.is_required},
        ${q.metric_definition_version ?? null}, ${q.question_policy_version ?? null},
        now()
      )
      ON CONFLICT (report_id, engine_question_id) DO UPDATE SET
        question_text               = EXCLUDED.question_text,
        answer_type                 = EXCLUDED.answer_type,
        options                     = EXCLUDED.options,
        parent_confirmable_behavior = EXCLUDED.parent_confirmable_behavior,
        question_stage              = EXCLUDED.question_stage,
        reason_codes                = EXCLUDED.reason_codes,
        sequence                    = EXCLUDED.sequence,
        is_required                 = EXCLUDED.is_required,
        metric_definition_version   = EXCLUDED.metric_definition_version,
        question_policy_version     = EXCLUDED.question_policy_version
    `);
  }
}

// ─── Audit helpers ────────────────────────────────────────────────────────────

type AnalysisAuditEvent =
  | "ENGINE_ANALYSIS_STARTED"
  | "ENGINE_ANALYSIS_SUCCEEDED"
  | "ENGINE_ANALYSIS_FAILED"
  | "ENGINE_ANALYSIS_STALE_RESPONSE_REJECTED";

async function writeAnalysisAudit(
  db: any,
  reportId: string,
  poolId: string,
  event: AnalysisAuditEvent,
  requestId: string,
  analysisStatus?: string | null,
  errorCode?: string | null,
  required = false,
): Promise<void> {
  try {
    const vRes = await db.execute(sql`
      SELECT next_audit_version('growth_report', ${reportId}) AS v
    `);
    const version = (vRes.rows as any[])[0]?.v ?? 1;

    await db.execute(sql`
      INSERT INTO audit_logs (
        entity_type, entity_id, entity_version,
        action, actor_type, actor_id, pool_id,
        before_data, after_data, reason, request_id,
        correlation_id, ip_hash
      ) VALUES (
        'growth_report', ${reportId}, ${version},
        'update', 'system', NULL, ${poolId},
        NULL,
        ${JSON.stringify({
          analysis_event:  event,
          analysis_status: analysisStatus ?? null,
          error_code:      errorCode      ?? null,
          // raw report text intentionally excluded (privacy §41)
        })}::jsonb,
        ${event}, ${requestId}, NULL, NULL
      )
    `);
  } catch (auditErr: any) {
    if (required) throw auditErr;
    // Non-transactional lifecycle diagnostics must not block their caller.
    console.warn(`[gr3-result] audit write failed for event=${event}:`, auditErr.message);
  }
}

async function inDbTransaction<T>(
  db: any,
  operation: (tx: any) => Promise<T>,
): Promise<T> {
  if (typeof db?.transaction !== "function") {
    throw new Error("Growth report analysis requires a transactional database adapter.");
  }
  return db.transaction(operation);
}

/**
 * Durably claim the exact request and audit it before any HTTP call is made.
 * The compare-and-set protects against a stale worker after a status change.
 */
export async function persistAnalysisRequest(params: {
  db: any;
  reportId: string;
  poolId: string;
  requestId: string;
  payloadHash: string;
  identityHash: string;
  request: object;
  stage: AnalysisStage;
  claimToken: string;
  preserveResponse?: boolean;
  replacePreviousStageRequest?: boolean;
  previousStageIdentityHash?: string | null;
}): Promise<boolean> {
  return inDbTransaction(params.db, async (tx) => {
    const expectedStatus = params.stage === "PREANALYSIS" ? "PREANALYZING" : "ANALYZING";
    const saved = await tx.execute(sql`
      UPDATE growth_reports
      SET analysis_request_id      = ${params.requestId},
          snapshot_hash            = ${params.payloadHash},
          analysis_request_payload = ${JSON.stringify(params.request)}::jsonb,
          analysis_identity_hash   = ${params.identityHash},
          analysis_response_payload = CASE
            WHEN ${params.preserveResponse === true} THEN analysis_response_payload
            ELSE NULL
          END,
          analysis_next_attempt_at  = NULL,
          updated_at               = now()
      WHERE id                     = ${params.reportId}
        AND product_status         = ${expectedStatus}::gr_product_status_enum
        AND analysis_claim_token   = ${params.claimToken}
        AND analysis_lease_until   > now()
        AND (
          analysis_request_id IS NULL
          OR analysis_request_id = ${params.requestId}
          OR (
            ${params.replacePreviousStageRequest === true}
            AND analysis_identity_hash = ${params.previousStageIdentityHash ?? null}
          )
        )
        AND deleted_at IS NULL
      RETURNING id
    `);
    if (!(saved.rows as any[] | undefined)?.length) return false;

    await writeAnalysisAudit(
      tx,
      params.reportId,
      params.poolId,
      "ENGINE_ANALYSIS_STARTED",
      params.requestId,
      null,
      null,
      true,
    );
    return true;
  });
}

/**
 * Persist a validated-identity ENGINE response before attempting the larger
 * result transaction. If that transaction crashes, the next worker can commit
 * this exact response without another ENGINE invocation.
 */
export async function persistAnalysisResponse(params: {
  db: any;
  reportId: string;
  requestId: string;
  response: GrowthReportAnalysisResponse;
  stage: AnalysisStage;
  claimToken: string;
}): Promise<boolean> {
  return inDbTransaction(params.db, async (tx) => {
    const expectedStatus = params.stage === "PREANALYSIS" ? "PREANALYZING" : "ANALYZING";
    const saved = await tx.execute(sql`
      UPDATE growth_reports
      SET analysis_response_payload = ${JSON.stringify(params.response)}::jsonb,
          updated_at = now()
      WHERE id = ${params.reportId}
        AND analysis_request_id = ${params.requestId}
        AND product_status = ${expectedStatus}::gr_product_status_enum
        AND analysis_claim_token = ${params.claimToken}
        AND analysis_lease_until > now()
        AND deleted_at IS NULL
      RETURNING id
    `);
    return Boolean((saved.rows as any[] | undefined)?.length);
  });
}

/** Persist the at-risk boundary immediately before invoking ENGINE. */
export async function markAnalysisCallStarted(params: {
  db: any;
  reportId: string;
  requestId: string;
  stage: AnalysisStage;
  claimToken: string;
}): Promise<boolean> {
  const expectedStatus = params.stage === "PREANALYSIS" ? "PREANALYZING" : "ANALYZING";
  const started = await params.db.execute(sql`
    UPDATE growth_reports
    SET analysis_call_started_at = now(),
        updated_at = now()
    WHERE id = ${params.reportId}
      AND analysis_request_id = ${params.requestId}
      AND product_status = ${expectedStatus}::gr_product_status_enum
      AND analysis_claim_token = ${params.claimToken}
      AND analysis_lease_until > now()
      AND analysis_uncertain_at IS NULL
      AND deleted_at IS NULL
    RETURNING id
  `);
  return Boolean((started.rows as any[] | undefined)?.length);
}

/** UNKNOWN is durably distinct from retryable provider/transport failure. */
export async function recordAnalysisUncertain(params: {
  db: any;
  reportId: string;
  requestId: string;
  stage: AnalysisStage;
  claimToken: string;
}): Promise<boolean> {
  const expectedStatus = params.stage === "PREANALYSIS" ? "PREANALYZING" : "ANALYZING";
  const uncertain = await params.db.execute(sql`
    UPDATE growth_reports
    SET analysis_uncertain_at = COALESCE(analysis_uncertain_at, now()),
        analysis_next_attempt_at = NULL,
        analysis_claim_token = NULL,
        analysis_lease_until = NULL,
        updated_at = now()
    WHERE id = ${params.reportId}
      AND analysis_request_id = ${params.requestId}
      AND product_status = ${expectedStatus}::gr_product_status_enum
      AND analysis_claim_token = ${params.claimToken}
      AND analysis_lease_until > now()
      AND deleted_at IS NULL
    RETURNING id
  `);
  return Boolean((uncertain.rows as any[] | undefined)?.length);
}

/**
 * Record an ENGINE failure without allowing a stale timeout/error handler to
 * roll a completed report back to OPEN/READY_FOR_ANALYSIS.
 */
export async function recordAnalysisAttemptFailure(params: {
  db: any;
  reportId: string;
  poolId: string;
  requestId: string;
  stage: AnalysisStage;
  retryable: boolean;
  maxRetryCount: number;
  errorCode: string;
  claimToken: string;
  retryDelayMs?: number;
}): Promise<{ updated: boolean; terminal: boolean; retryCount: number }> {
  return inDbTransaction(params.db, async (tx) => {
    const current = await tx.execute(sql`
      SELECT product_status, COALESCE(analysis_retry_count, 0) AS retry_count
      FROM growth_reports
      WHERE id = ${params.reportId}
        AND analysis_request_id = ${params.requestId}
        AND analysis_claim_token = ${params.claimToken}
        AND analysis_lease_until > now()
        AND product_status IN ('PREANALYZING', 'ANALYZING')
        AND deleted_at IS NULL
      FOR UPDATE
    `);
    const row = (current.rows as any[] | undefined)?.[0];
    if (!row) return { updated: false, terminal: false, retryCount: 0 };

    let retryCount = Number(row.retry_count ?? 0);
    let terminal = false;
    if (params.retryable) {
      const incremented = await tx.execute(sql`
        UPDATE growth_reports
        SET analysis_retry_count = COALESCE(analysis_retry_count, 0) + 1,
            updated_at = now()
        WHERE id = ${params.reportId}
          AND analysis_request_id = ${params.requestId}
            AND analysis_claim_token = ${params.claimToken}
            AND analysis_lease_until > now()
          AND product_status = ${row.product_status}::gr_product_status_enum
          AND deleted_at IS NULL
        RETURNING COALESCE(analysis_retry_count, 0) AS retry_count
      `);
      const incrementedRow = (incremented.rows as any[] | undefined)?.[0];
      if (!incrementedRow) return { updated: false, terminal: false, retryCount };
      retryCount = Number(incrementedRow.retry_count);
      terminal = retryDisposition(retryCount - 1, params.maxRetryCount).terminal;
    } else {
      terminal = true;
    }

    if (terminal) {
      await transitionReportStatus({
        db: tx,
        reportId: params.reportId,
        toStatus: "FAILED",
        actorType: "system",
        actorId: null,
        reason: params.retryable
          ? `MAX_RETRY_EXCEEDED_${params.errorCode}`
          : `ENGINE_NON_RETRYABLE_${params.errorCode}`,
        requestId: params.requestId,
      });
      await tx.execute(sql`
        UPDATE growth_reports
        SET analysis_claim_token = NULL,
            analysis_lease_until = NULL,
            analysis_next_attempt_at = NULL,
            updated_at = now()
        WHERE id = ${params.reportId}
          AND analysis_request_id = ${params.requestId}
          AND analysis_claim_token = ${params.claimToken}
          AND product_status = 'FAILED'::gr_product_status_enum
          AND deleted_at IS NULL
      `);
    } else {
      const rollbackStatus = params.stage === "PREANALYSIS" ? "OPEN" : "READY_FOR_ANALYSIS";
      const rolledBack = await tx.execute(sql`
        UPDATE growth_reports
        SET product_status = ${rollbackStatus}::gr_product_status_enum,
            analysis_next_attempt_at = now() +
              (${Math.max(0, params.retryDelayMs ?? 0)} * interval '1 millisecond'),
            analysis_claim_token = NULL,
            analysis_lease_until = NULL,
            updated_at = now()
        WHERE id = ${params.reportId}
          AND analysis_request_id = ${params.requestId}
          AND analysis_claim_token = ${params.claimToken}
          AND analysis_lease_until > now()
          AND product_status = ${row.product_status}::gr_product_status_enum
          AND deleted_at IS NULL
        RETURNING id
      `);
      if (!(rolledBack.rows as any[] | undefined)?.length) {
        return { updated: false, terminal: false, retryCount };
      }
    }

    await writeAnalysisAudit(
      tx,
      params.reportId,
      params.poolId,
      "ENGINE_ANALYSIS_FAILED",
      params.requestId,
      null,
      params.errorCode,
      true,
    );
    return { updated: true, terminal, retryCount };
  });
}

// ─── Exported audit helpers ───────────────────────────────────────────────────

export async function auditAnalysisStarted(
  db: any, reportId: string, poolId: string, requestId: string,
): Promise<void> {
  await writeAnalysisAudit(db, reportId, poolId, "ENGINE_ANALYSIS_STARTED", requestId);
}

export async function auditAnalysisFailed(
  db: any, reportId: string, poolId: string, requestId: string, errorCode?: string,
): Promise<void> {
  await writeAnalysisAudit(db, reportId, poolId, "ENGINE_ANALYSIS_FAILED", requestId, null, errorCode);
}

export async function auditStaleRejected(
  db: any, reportId: string, poolId: string, requestId: string,
): Promise<void> {
  await writeAnalysisAudit(db, reportId, poolId, "ENGINE_ANALYSIS_STALE_RESPONSE_REJECTED", requestId);
}

// ─── Main persistence ─────────────────────────────────────────────────────────

export interface PersistEngineResultInput {
  db: any;
  report: {
    id: string;
    swimming_pool_id: string;
  };
  requestId: string;
  payloadHash: string;
  response: GrowthReportAnalysisResponse;
  stage: AnalysisStage;
  parentInputWindowOpen: boolean;
  claimToken?: string;
}

export interface PersistResult {
  productStatus: string;
  questionsCount: number;
}

/**
 * persistEngineResult — full result persistence pipeline:
 *
 *  1. Validate response shape
 *  2. Grounding / framing gate (reject FAIL)
 *  3. Map ENGINE status → product status
 *  4. Stale CAS update (WHERE analysis_request_id = requestId)
 *  5. Persist questions (upsert)
 *  6. Transition product_status via central lifecycle service
 *  7. Audit
 *
 * Throws:
 *   EngineResponseValidationError — shape invalid
 *   GroundingFailError            — grounding/framing gate failed
 *   StaleEngineResponseError      — a newer result already written
 */
async function persistEngineResultInTransaction(
  input: PersistEngineResultInput,
): Promise<PersistResult> {
  const {
    db,
    report,
    requestId,
    payloadHash,
    response,
    stage,
    parentInputWindowOpen,
    // Legacy internal callers without a claim fail the SQL CAS closed; queue
    // and manual worker entrypoints always provide a real lease token.
    claimToken = "",
  } = input;

  const monthlyDispositionEnabled = response.analysis_status === "DATA_ACCUMULATING" &&
    await isMonthlyDispositionRun(db, report.id, requestId, payloadHash);

  // 1) Shape validation. Nullable SNS is accepted only for an exact response
  // associated with an active run's sealed monthly target.
  validateEngineResponse(
    response,
    requestId,
    report.id,
    payloadHash,
    monthlyDispositionEnabled,
  );

  if (response.analysis_status === "DATA_ACCUMULATING" && monthlyDispositionEnabled) {
    const prepared = await prepareMonthlyInsufficientEvidence(db, {
      reportId: report.id,
      requestId,
      payloadHash,
      claimToken,
    });
    if (prepared) return { productStatus: "REVIEW_REQUIRED", questionsCount: 0 };
  }

  // 2) Grounding / framing gate
  // Engine may return a string ("PASS") or a detail object ({ status: "PASS", ... })
  const { grounding, growth_framing } = response.validation;
  const normalizeGating = (v: unknown): string =>
    typeof v === "string" ? v : ((v as any)?.status ?? "FAIL");
  const groundingStatus      = normalizeGating(grounding);
  const growthFramingStatus  = normalizeGating(growth_framing);
  if (!GROUNDING_PASS_VALUES.has(groundingStatus)) {
    throw new GroundingFailError("grounding", groundingStatus);
  }
  if (!GROUNDING_PASS_VALUES.has(growthFramingStatus)) {
    throw new GroundingFailError("growth_framing", growthFramingStatus);
  }

  // 2.5) DATA_ACCUMULATING — early-exit path
  //   데이터 축적 중인 정상 상태. FAILED가 아님.
  //   analysis_status = DATA_ACCUMULATING, product_status = PARTIAL 저장.
  //   PARTIAL → ["ANALYZING", "REVIEW_REQUIRED"] 전환 가능이므로 재시도 안전.
  //   parent status endpoint가 analysis_status를 먼저 확인하므로
  //   부모 앱에는 DATA_ACCUMULATING UX(친절한 안내 메시지)가 표시된다.
  if (response.analysis_status === "DATA_ACCUMULATING") {
    const expectedStatus = stage === "PREANALYSIS" ? "PREANALYZING" : "ANALYZING";
    const updateRes = await db.execute(sql`
      UPDATE growth_reports
      SET
        analysis_status     = ${"DATA_ACCUMULATING"}::gr_analysis_status_enum,
        analysis_request_id = ${requestId},
        snapshot_version    = ${GR_SNAPSHOT_VERSION_DB},
        snapshot_hash       = ${payloadHash},
        updated_at          = now()
      WHERE id                  = ${report.id}
        AND analysis_request_id = ${requestId}
        AND product_status      = ${expectedStatus}::gr_product_status_enum
        AND analysis_claim_token = ${claimToken}
        AND analysis_lease_until > now()
        AND deleted_at IS NULL
      RETURNING id
    `);
    if (!(updateRes.rows as any[] | undefined)?.length) {
      throw new StaleEngineResponseError(report.id, requestId);
    }
    await transitionReportStatus({
      db,
      reportId:  report.id,
      toStatus:  "PARTIAL",
      actorType: "system",
      actorId:   null,
      reason:    "ENGINE_DATA_ACCUMULATING",
    });
    await db.execute(sql`
      UPDATE growth_reports
      SET analysis_claim_token = NULL,
          analysis_lease_until = NULL,
          analysis_next_attempt_at = NULL,
          updated_at = now()
      WHERE id = ${report.id}
        AND analysis_request_id = ${requestId}
        AND analysis_claim_token = ${claimToken}
        AND product_status = 'PARTIAL'::gr_product_status_enum
        AND deleted_at IS NULL
    `);
    await writeAnalysisAudit(
      db,
      report.id,
      report.swimming_pool_id,
      "ENGINE_ANALYSIS_SUCCEEDED",
      requestId,
      "DATA_ACCUMULATING",
      null,
      true,
    );
    return { productStatus: "PARTIAL", questionsCount: 0 };
  }

  // 3) Status mapping
  const questionsCount = response.questions.length;
  const productStatus  = mapEngineStatusToProductStatus(
    response.analysis_status,
    stage,
    { questionsCount, parentInputWindowOpen },
  );

  // 4) Stale CAS: UPDATE only if analysis_request_id still matches our requestId
  //    (prevents a slow older response from overwriting a newer one)
  const metricJson    = JSON.stringify(response.metric_evidence   ?? {});
  const signalsJson   = JSON.stringify(response.positive_signals  ?? []);
  const synth         = response.synthesis as Record<string, unknown> | null;
  const successJson   = JSON.stringify(synth?.["success_conditions"]    ?? []);
  const leversJson    = JSON.stringify(synth?.["support_levers"]         ?? []);
  const growthJson    = JSON.stringify(synth?.["next_growth_targets"]    ?? []);
  const observJson    = JSON.stringify(synth?.["next_observation_targets"] ?? []);
  // E fix: publish gate가 fp.grounding_result / fp.growth_framing_result 문자열을 요구.
  // Engine은 이를 response.validation에만 저장하고 fact_package에는 포함하지 않음.
  // 저장/매핑 계약 수정: fact_package에 두 필드를 병합하여 저장.
  const factWithValidation = {
    ...(response.fact_package as Record<string, unknown>),
    grounding_result:      groundingStatus,
    growth_framing_result: growthFramingStatus,
  };
  const factJson      = JSON.stringify(factWithValidation);
  const contentJson   = JSON.stringify(response.report_content);
  const snsJson       = JSON.stringify(response.sns_summary);
  const expectedStatus = stage === "PREANALYSIS" ? "PREANALYZING" : "ANALYZING";

  const updateRes = await db.execute(sql`
    UPDATE growth_reports
    SET
      analysis_status         = ${response.analysis_status}::gr_analysis_status_enum,
      analysis_request_id     = ${requestId},
      snapshot_version        = ${GR_SNAPSHOT_VERSION_DB},
      snapshot_hash           = ${payloadHash},
      metric_states           = ${metricJson}::jsonb,
      metric_confidences      = NULL,
      positive_growth_signals = ${signalsJson}::jsonb,
      success_conditions      = ${successJson}::jsonb,
      support_levers          = ${leversJson}::jsonb,
      next_growth_targets     = ${growthJson}::jsonb,
      next_observation_targets = ${observJson}::jsonb,
      report_fact_package     = ${factJson}::jsonb,
      report_content          = ${contentJson}::jsonb,
      sns_summary             = ${snsJson}::jsonb,
      updated_at              = now()
    WHERE id                  = ${report.id}
      AND analysis_request_id = ${requestId}
      AND product_status      = ${expectedStatus}::gr_product_status_enum
      AND analysis_claim_token = ${claimToken}
      AND analysis_lease_until > now()
      AND deleted_at IS NULL
    RETURNING id
  `);

  if ((updateRes.rows as any[]).length === 0) {
    throw new StaleEngineResponseError(report.id, requestId);
  }

  // 5) Question persistence (upsert)
  await persistEngineQuestions(db, report.id, response.questions);

  // 6) Product status transition (validates allowed transition, writes audit)
  await transitionReportStatus({
    db,
    reportId:  report.id,
    toStatus:  productStatus,
    actorType: "system",
    actorId:   null,
    reason:    `ENGINE_${stage}_${response.analysis_status}`,
  });
  await db.execute(sql`
    UPDATE growth_reports
    SET analysis_claim_token = NULL,
        analysis_lease_until = NULL,
        analysis_next_attempt_at = NULL,
        updated_at = now()
    WHERE id = ${report.id}
      AND analysis_request_id = ${requestId}
      AND analysis_claim_token = ${claimToken}
      AND product_status = ${productStatus}::gr_product_status_enum
      AND deleted_at IS NULL
  `);

  // 7) Audit
  await writeAnalysisAudit(
    db,
    report.id,
    report.swimming_pool_id,
    "ENGINE_ANALYSIS_SUCCEEDED",
    requestId,
    response.analysis_status,
    null,
    true,
  );

  return { productStatus, questionsCount };
}

export async function persistEngineResult(
  input: PersistEngineResultInput,
): Promise<PersistResult> {
  return inDbTransaction(input.db, (tx) =>
    persistEngineResultInTransaction({ ...input, db: tx }),
  );
}
