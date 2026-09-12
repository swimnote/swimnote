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
import { acquireLock, releaseLock, recordHeartbeat, refreshLock } from "../lib/schedulerLock.js";
import { sendOperatorAlert } from "../lib/sendOperatorAlert.js";
import { transitionReportStatus, InvalidTransitionError } from "../lib/growth-report-service.js";
import {
  buildAnalysisSnapshot,
  queryDiariesForEligibility,
  queryAttendanceForEligibility,
} from "../lib/growth-report-snapshot-builder.js";
import {
  evaluateStudentGrowthReportEligibility,
} from "../lib/growth-report-eligibility.js";
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
    WHERE gr.product_status IN ('OPEN', 'READY_FOR_ANALYSIS', 'REGENERATING')
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
      stage: (r.product_status === "OPEN" || r.product_status === "REGENERATING") ? "PREANALYSIS" : "FINAL_ANALYSIS",
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
  {
    const periodFrom       = `${cycle.report_period}-01`;      // analysis_period_start
    const analysisFrom     = cycle.analysis_from
      ? (cycle.analysis_from > periodFrom ? cycle.analysis_from : periodFrom)
      : periodFrom;
    const cutoffDate       = cycle.analysis_cutoff_at.slice(0, 10);

    // report_month_start = nextMonth of periodFrom (= analysis_period_end_exclusive)
    const rmsDate = new Date(periodFrom);
    rmsDate.setMonth(rmsDate.getMonth() + 1);
    const reportMonthStart = rmsDate.toISOString().slice(0, 10);  // e.g. "2026-09-01"

    // (A) 재원 판정 — report_month_start 기준
    //     enrolled_at <= report_month_start : report_month_start 이전 입회
    //     left_at IS NULL OR left_at >= report_month_start : report_month 시작일 기준 재원
    const reregRows = await db.execute(sql`
      SELECT 1
      FROM student_class_history sch
      JOIN class_groups cg ON cg.id = sch.class_group_id
      WHERE sch.student_id      = ${report.student_id}
        AND cg.swimming_pool_id = ${report.swimming_pool_id}
        AND sch.enrolled_at     <= ${reportMonthStart}::date
        AND (sch.left_at IS NULL OR sch.left_at >= ${reportMonthStart}::date)
      LIMIT 1
    `);
    const reregistered = reregRows.rows.length > 0;

    // (B) attendance_count — v2 semantics (queryAttendanceForEligibility):
    //   Branch 1: explicit present/late rows (auto-save + makeup completion 포함)
    //   Branch 2: class_diary 확인 + 재원 + 명시적 결석 없음 (출결화면 미열기 보완)
    //   두 branch UNION → date 기준 중복 제거
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
      cycle.analysis_cutoff_at,
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
      // EXCLUDED — PREANALYZING 전환 없이 직접 EXCLUDED 저장, 즉시 return
      await db.execute(sql`
        UPDATE growth_reports
        SET product_status      = 'EXCLUDED'::gr_product_status_enum,
            exclusion_code      = ${eligResult.exclusion_code},
            attendance_count    = ${attendanceCount},
            source_event_count  = ${sourceEventCount},
            eligibility_version = ${eligVersionNum},
            updated_at          = now()
        WHERE id                = ${report.id}
          AND product_status   != 'EXCLUDED'   -- idempotent (crash 후 재실행 안전)
      `);
      console.log(
        `[gr3-worker] report=${report.id} EXCLUDED` +
        ` code=${eligResult.exclusion_code}` +
        ` attend=${attendanceCount} source=${sourceEventCount}`,
      );
      return { ok: true };
    }

    // (E) ELIGIBLE: counts 저장 후 PREANALYZING/ANALYZING 전환으로 진행
    await db.execute(sql`
      UPDATE growth_reports
      SET attendance_count    = ${attendanceCount},
          source_event_count  = ${sourceEventCount},
          eligibility_version = ${eligVersionNum},
          exclusion_code      = NULL,
          updated_at          = now()
      WHERE id = ${report.id}
    `);
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
 * resetStuckReports — PREANALYZING/ANALYZING 상태로 멈춘 리포트를 자동 복구.
 *
 * ENGINE timeout = 120초. 여유 포함 180초(3분) 이상 같은 상태면 stuck으로 판단.
 * PREANALYZING → OPEN, ANALYZING → READY_FOR_ANALYSIS 으로 리셋 후 재시도.
 * analysis_retry_count 는 유지 (무한 리셋 방지 — max retry 초과 시 다음 배치에서 FAILED).
 */
async function resetStuckReports(db: any): Promise<number> {
  const STUCK_THRESHOLD_SECONDS = 180; // 3분
  try {
    const res = await db.execute(sql`
      UPDATE growth_reports
      SET
        product_status = CASE
          WHEN product_status = 'PREANALYZING' THEN 'OPEN'
          WHEN product_status = 'ANALYZING'    THEN 'READY_FOR_ANALYSIS'
          ELSE product_status
        END,
        analysis_request_id = NULL,
        updated_at          = NOW()
      WHERE product_status IN ('PREANALYZING', 'ANALYZING')
        AND deleted_at IS NULL
        AND updated_at < NOW() - (${String(STUCK_THRESHOLD_SECONDS)} || ' seconds')::interval
      RETURNING id, product_status
    `);
    const count = (res.rows as any[]).length;
    if (count > 0) {
      console.warn(`[gr3-watchdog] ${count}개 stuck 리포트 리셋 (PREANALYZING/ANALYZING → OPEN/READY_FOR_ANALYSIS)`);
    }
    return count;
  } catch (err: any) {
    console.warn("[gr3-watchdog] stuck 리셋 실패 (무시):", err.message);
    return 0;
  }
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
        await analyzeOneReport(db, item);
        mutex.analyzed++;
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
    stage: (r.product_status === "OPEN" || r.product_status === "REGENERATING") ? "PREANALYSIS" : "FINAL_ANALYSIS",
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
// ─── 연속 큐 드레인 ───────────────────────────────────────────────────────────
// MAX_RUN_MS: 크론 주기(5분) 안에서 최대 실행 시간. 초과 시 루프 종료 후 다음 크론이 이어받음.
const MAX_RUN_MS = 4.5 * 60 * 1000; // 4분 30초
// 락 갱신 주기: 배치 하나 완료마다 갱신 (TTL 만료 방지)
const LOCK_REFRESH_INTERVAL_MS = 60 * 1000; // 1분마다 갱신

/**
 * drainAnalysisQueue — pending 리포트가 없어질 때까지 또는 MAX_RUN_MS 초과까지
 * 배치를 연속 실행한다. 배치 사이에 락을 갱신해 TTL 만료를 방지한다.
 *
 * 워치독: 각 드레인 루프 시작 전 stuck 리포트(PREANALYZING/ANALYZING 3분 초과)를 리셋.
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
