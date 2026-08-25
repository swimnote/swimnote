/**
 * growth-report-analysis-worker.ts
 *
 * Background worker that drives ENGINE analysis flow:
 *
 *   Pass 1 — OPEN → PREANALYZING → ENGINE → QUESTION_AVAILABLE | READY_FOR_ANALYSIS | PARTIAL | FAILED
 *   Pass 2 — READY_FOR_ANALYSIS → ANALYZING → ENGINE → REVIEW_REQUIRED | FAILED
 *
 * Concurrency protection:
 *   - Distributed lock (acquireLock) prevents duplicate worker runs across instances.
 *   - transitionReportStatus uses FOR UPDATE row lock, so concurrent workers
 *     transitioning the same report serialize; the second sees InvalidTransitionError
 *     and skips that report cleanly.
 *
 * Stale response protection:
 *   - analysis_request_id is written to DB before the ENGINE call.
 *   - persistEngineResult uses WHERE analysis_request_id = requestId (CAS).
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
import { acquireLock, releaseLock, recordHeartbeat } from "../lib/schedulerLock.js";
import { transitionReportStatus, InvalidTransitionError } from "../lib/growth-report-service.js";
import { buildAnalysisSnapshot } from "../lib/growth-report-snapshot-builder.js";
import {
  analyzeGrowthReport,
  isRetryableEngineError,
  EngineCallError,
  type GrowthReportAnalysisResponse,
} from "../lib/growth-report-engine-client.js";
import {
  persistEngineResult,
  auditAnalysisStarted,
  auditAnalysisFailed,
  auditStaleRejected,
  StaleEngineResponseError,
  GroundingFailError,
  EngineResponseValidationError,
  type AnalysisStage,
} from "../lib/growth-report-result-handler.js";
import { saveAiTrace }  from "../lib/ai-trace-service.js";
import { AI_FEATURE }   from "../lib/ai-feature-enum.js";

// ─── Configuration ────────────────────────────────────────────────────────────

const ANALYSIS_LOCK    = "growth-report-analysis";
const LOCK_TTL_SECONDS = 600;  // 10 min (generous for slow GPT)

/**
 * GROWTH_REPORT_ANALYSIS_BATCH_SIZE — cron 실행당 최대 처리 report 수 (default 10).
 * 대량 report가 있는 경우 환경변수로 제어:
 *   GROWTH_REPORT_ANALYSIS_BATCH_SIZE=1  → 1건씩 처리 (최대 안전)
 *   GROWTH_REPORT_ANALYSIS_BATCH_SIZE=0  → 비활성화 (auto analysis 없음)
 */
function getBatchSize(): number {
  const raw = process.env["GROWTH_REPORT_ANALYSIS_BATCH_SIZE"];
  if (raw === undefined) return 10;          // default: 10
  const n = Number(raw);
  return isNaN(n) ? 10 : Math.max(0, n);   // 0 = disabled
}

/**
 * GROWTH_REPORT_ANALYSIS_AUTO_ENABLED — auto cron 실행 허용 여부 (default true).
 * "false"로 설정하면 cron/startup auto run을 완전히 차단.
 * Super Admin의 수동 trigger(POST /super/growth-reports/:id/analyze)는 영향 없음.
 */
function isAutoAnalysisEnabled(): boolean {
  return process.env["GROWTH_REPORT_ANALYSIS_AUTO_ENABLED"] !== "false";
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
    product_status: string;
    analysis_request_id: string | null;
    analysis_retry_count: number;
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
      gr.product_status,
      gr.analysis_request_id,
      COALESCE(gr.analysis_retry_count, 0)  AS analysis_retry_count,
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
    WHERE gr.product_status IN ('OPEN', 'READY_FOR_ANALYSIS')
      AND gr.deleted_at IS NULL
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
        product_status:       r.product_status as string,
        analysis_request_id:  (r.analysis_request_id ?? null) as string | null,
        analysis_retry_count: Number(r.analysis_retry_count ?? 0),
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
      stage: r.product_status === "OPEN" ? "PREANALYSIS" : "FINAL_ANALYSIS",
    };
  });
}

// ─── Single report analysis ───────────────────────────────────────────────────

type OneReportResult =
  | { ok: true }
  | { ok: false; errorCode: string; httpStatus: number; engineDetails?: unknown };

async function analyzeOneReport(
  db: any,
  { report, cycle, stage }: PendingReport,
): Promise<OneReportResult> {
  const maxRetry = getMaxRetryCount();

  // Guard: too many retries → skip this report
  if (report.analysis_retry_count >= maxRetry) {
    console.warn(
      `[gr3-worker] report=${report.id} exceeded max retries (${maxRetry}), skipping`,
    );
    return { ok: false, errorCode: "MAX_RETRY_EXCEEDED", httpStatus: 0 };
  }

  // 1) Transition to IN_PROGRESS status (FOR UPDATE prevents concurrent)
  const toInProgress = stage === "PREANALYSIS" ? "PREANALYZING" : "ANALYZING";
  try {
    await transitionReportStatus({
      db,
      reportId:  report.id,
      toStatus:  toInProgress,
      actorType: "system",
      actorId:   null,
      reason:    `ANALYSIS_WORKER_${stage}`,
    });
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      // Another worker instance already transitioned this report
      console.log(`[gr3-worker] report=${report.id} already transitioned (concurrent), skip`);
      return { ok: false, errorCode: "CONCURRENT_TRANSITION", httpStatus: 0 };
    }
    throw err;
  }

  const parentInputWindowOpen = new Date() < new Date(cycle.parent_input_close_at);

  // 2) Build immutable snapshot (new requestId = new analysis attempt)
  const { request, requestId, payloadHash } = await buildAnalysisSnapshot(db, {
    report, cycle,
    // no requestId supplied → fresh UUID generated inside
  });

  // 3) Write analysis_request_id to DB before ENGINE call (enables stale CAS)
  await db.execute(sql`
    UPDATE growth_reports
    SET analysis_request_id = ${requestId}, updated_at = now()
    WHERE id = ${report.id}
  `);

  // 4) Audit: started
  await auditAnalysisStarted(db, report.id, report.swimming_pool_id, requestId);
  console.log(
    `[gr3-worker] report=${report.id} stage=${stage} requestId=${requestId} ENGINE call starting`,
  );

  // 5) ENGINE call
  const grEngineStartMs = Date.now();  // CS-PA1: latency 측정
  let response: GrowthReportAnalysisResponse;
  // AI01-05: actual HTTP call counts returned from engine client
  let grActualCallCount = 0;
  let grRetryCount      = 0;
  try {
    const callResult  = await analyzeGrowthReport(request);
    response          = callResult.response;
    grActualCallCount = callResult.actualCallCount;
    grRetryCount      = callResult.retryCount;
  } catch (engineErr) {
    // AI01-05: count as 1 attempt if URL was configured (i.e. HTTP was sent).
    // NOTE: analysis_retry_count in DB is cross-invocation retry count — do NOT
    // use it as actual_call_count. Use grActualCallCount from the client.
    const httpWasSent = !(engineErr instanceof EngineCallError &&
                          (engineErr as EngineCallError).errorCode === "ENGINE_URL_NOT_CONFIGURED");
    grActualCallCount = httpWasSent ? 1 : 0;
    grRetryCount      = 0;

    const retryable = isRetryableEngineError(engineErr);
    const errorCode = engineErr instanceof EngineCallError
      ? engineErr.errorCode
      : "UNKNOWN_ERROR";

    await auditAnalysisFailed(db, report.id, report.swimming_pool_id, requestId, errorCode);

    // CS-PA1: engine 실패 trace
    void saveAiTrace({
      status: 'FAILED', request_id: requestId, internal_id: requestId,
      pool_id: report.swimming_pool_id, contract_version: '1.0',
      feature: AI_FEATURE.GROWTH_REPORT_AI, pool_mode: null,
      sub_feature: stage, result_generated: false,
      trigger_type: 'SYSTEM_MAINTENANCE', service: 'analysis',
      error_stage: 'UNKNOWN' as const, error_code: errorCode,
      latency_ms:  Date.now() - grEngineStartMs,
    }).catch(() => {});

    if (retryable) {
      // Roll back to previous status so next worker run can retry
      const rollbackStatus = stage === "PREANALYSIS" ? "OPEN" : "READY_FOR_ANALYSIS";
      try {
        await db.execute(sql`
          UPDATE growth_reports
          SET product_status        = ${rollbackStatus}::gr_product_status_enum,
              analysis_retry_count  = COALESCE(analysis_retry_count, 0) + 1,
              updated_at            = now()
          WHERE id = ${report.id}
        `);
      } catch (rbErr: any) {
        console.error(`[gr3-worker] rollback failed report=${report.id}:`, rbErr.message);
      }
      console.warn(
        `[gr3-worker] retryable ENGINE error report=${report.id} code=${errorCode}`,
      );
    } else {
      // Non-retryable → FAILED (no infinite retry)
      try {
        await transitionReportStatus({
          db,
          reportId:  report.id,
          toStatus:  "FAILED",
          actorType: "system",
          actorId:   null,
          reason:    `ENGINE_NON_RETRYABLE_${errorCode}`,
        });
      } catch (transErr: any) {
        console.error(`[gr3-worker] FAILED transition error report=${report.id}:`, transErr.message);
      }
      const httpStatus     = (engineErr instanceof EngineCallError) ? (engineErr as EngineCallError).statusCode   : 0;
      const engineDetails  = (engineErr instanceof EngineCallError) ? (engineErr as EngineCallError).engineDetails : undefined;
      console.error(
        `[gr3-worker] non-retryable ENGINE error report=${report.id} code=${errorCode} http=${httpStatus} msg=${(engineErr as Error).message}`,
      );
      return { ok: false, errorCode, httpStatus, engineDetails };
    }
    return { ok: false, errorCode, httpStatus: 0 };
  }

  // CS-PA1 / AI01-05: engine 성공 trace (persist 전)
  void saveAiTrace({
    status:                'SUCCESS',
    request_id:            requestId,
    internal_id:           requestId,
    pool_id:               report.swimming_pool_id,
    contract_version:      '1.0',
    feature:               AI_FEATURE.GROWTH_REPORT_AI,
    pool_mode:             null,
    sub_feature:           stage,
    result_generated:      true,
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
    });
    console.log(
      `[gr3-worker] report=${report.id} → ${persist.productStatus} ` +
      `questions=${persist.questionsCount}`,
    );
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
      await auditAnalysisFailed(db, report.id, report.swimming_pool_id, requestId, code);
      await transitionReportStatus({
        db,
        reportId:  report.id,
        toStatus:  "FAILED",
        actorType: "system",
        actorId:   null,
        reason:    code,
      }).catch(() => {});
      console.warn(`[gr3-worker] ${code} report=${report.id} → FAILED`);
      return { ok: false, errorCode: code, httpStatus: 0 };
    }
    throw persistErr;
  }
  return { ok: true };
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
 * Clock-injectable `db` parameter for testing.
 */
export async function runGrowthReportAnalysisWorker(
  db: any = superAdminDb,
): Promise<GrowthReportAnalysisWorkerResult> {
  const result: GrowthReportAnalysisWorkerResult = {
    analyzed: 0, skipped: 0, failed: 0, errors: [],
  };

  const pending = await fetchPendingReports(db);
  if (pending.length === 0) return result;

  for (const item of pending) {
    try {
      await analyzeOneReport(db, item);
      result.analyzed++;
    } catch (err: any) {
      result.failed++;
      result.errors.push(`report=${item.report.id}: ${err.message}`);
      console.error(`[gr3-worker] unexpected error report=${item.report.id}:`, err.message);
    }
  }

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
      gr.product_status,
      gr.analysis_request_id,
      COALESCE(gr.analysis_retry_count, 0)  AS analysis_retry_count,
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
      product_status:       r.product_status as string,
      analysis_request_id:  (r.analysis_request_id ?? null) as string | null,
      analysis_retry_count: Number(r.analysis_retry_count ?? 0),
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
    stage: r.product_status === "OPEN" ? "PREANALYSIS" : "FINAL_ANALYSIS",
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
  if (product_status !== "OPEN" && product_status !== "READY_FOR_ANALYSIS") {
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
export function startGrowthReportAnalysisWorker(): void {
  cron.schedule("*/5 * * * *", async () => {
    if (!isAutoAnalysisEnabled()) {
      console.log("[gr3-worker] auto analysis disabled (GROWTH_REPORT_ANALYSIS_AUTO_ENABLED=false)");
      return;
    }
    const batchSize = getBatchSize();
    if (batchSize === 0) {
      console.log("[gr3-worker] auto analysis disabled (GROWTH_REPORT_ANALYSIS_BATCH_SIZE=0)");
      return;
    }
    const locked = await acquireLock(ANALYSIS_LOCK, LOCK_TTL_SECONDS);
    if (!locked) {
      console.log("[gr3-worker] lock not acquired — other instance running");
      return;
    }
    try {
      const result = await runGrowthReportAnalysisWorker();
      if (result.analyzed > 0 || result.failed > 0) {
        await recordHeartbeat(ANALYSIS_LOCK, {
          at:       new Date().toISOString(),
          analyzed: result.analyzed,
          failed:   result.failed,
        });
      }
    } catch (err: any) {
      console.error("[gr3-worker] cron error:", err.message);
    } finally {
      await releaseLock(ANALYSIS_LOCK);
    }
  });

  // Startup run — 45 s after server start (after scheduler 30 s run)
  setTimeout(async () => {
    if (!isAutoAnalysisEnabled()) {
      console.log("[gr3-worker] auto analysis disabled — skipping startup run");
      return;
    }
    if (getBatchSize() === 0) {
      console.log("[gr3-worker] batch size 0 — skipping startup run");
      return;
    }
    const locked = await acquireLock(ANALYSIS_LOCK, LOCK_TTL_SECONDS);
    if (!locked) return;
    try {
      console.log("[gr3-worker] startup analysis run");
      await runGrowthReportAnalysisWorker();
    } catch (err: any) {
      console.error("[gr3-worker] startup error:", err.message);
    } finally {
      await releaseLock(ANALYSIS_LOCK);
    }
  }, 45_000);

  const autoEnabled = isAutoAnalysisEnabled();
  const batchSize   = getBatchSize();
  console.log(
    `[gr3-worker] Growth Report Analysis Worker 시작 ` +
    `(auto=${autoEnabled ? "ON" : "OFF"} batch=${batchSize} every 5min + 45s startup)`,
  );
}
