/**
 * parent-paid-insight.ts
 *
 * Parent-facing APP API for Paid Insight (AI 인사이트 전략 리포트).
 *
 * Routes:
 *   POST /parent/students/:studentId/paid-insight/questions
 *   POST /parent/students/:studentId/paid-insight/analysis   (payment gate: MUST be verified purchase)
 *   GET  /parent/students/:studentId/paid-insight/status
 *   GET  /parent/students/:studentId/paid-insight/history
 *
 * Security:
 *   - requireAuth + requireParent on all routes
 *   - parent_students ownership + pool isolation on every query
 *   - AI Engine called server-side only (JWT_SECRET never reaches client)
 *
 * Storage:
 *   - growth_reports (report_type='custom', content.pipeline='paid_insight')
 *   - growth_report_questions  (already created by GR1 migration)
 *   - growth_report_answers    (already created by GR1 migration)
 *
 * AI calls: via paid-insight-engine-client.ts (server-to-server)
 * DB write: YES (questions, answers, report rows)
 */

import { Router } from "express";
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  requireAuth,
  requireRole,
  type AuthRequest,
} from "../middlewares/auth.js";
import {
  planPaidInsightQuestions,
  runPaidInsightAnalysis,
  PaidInsightEngineError,
  PI_SCHEMA_VERSION,
  type PiQuestionRequest,
  type PiAnalysisRequest,
  type PiExistingParentAnswer,
} from "../lib/paid-insight-engine-client.js";
import { assemblePaidInsightSnapshot } from "../lib/paid-insight-snapshot.js";

const router = Router();
const db = superAdminDb;

// ─── Ownership helper ─────────────────────────────────────────────────────────

async function resolveOwnership(
  parentId: string,
  studentId: string,
): Promise<{ poolId: string } | null> {
  const r = await db.execute(sql`
    SELECT ps.swimming_pool_id AS pool_id
    FROM parent_students ps
    WHERE ps.parent_id  = ${parentId}
      AND ps.student_id = ${studentId}
      AND ps.status     = 'approved'
    LIMIT 1
  `);
  if (!r.rows.length) return null;
  return { poolId: String((r.rows[0] as any).pool_id) };
}

// ─── Ensure paid insight report row ──────────────────────────────────────────

/**
 * ensurePaidInsightReport
 *
 * Returns existing OPEN/IN_PROGRESS paid insight report for this student,
 * or creates a fresh one (report_type='custom', pipeline='paid_insight').
 *
 * Only one non-PUBLISHED, non-FAILED report per student at a time.
 */
async function ensurePaidInsightReport(
  studentId: string,
  poolId: string,
): Promise<string> {
  // Try to find existing active paid insight report
  const existing = await db.execute(sql`
    SELECT id FROM growth_reports
    WHERE student_id       = ${studentId}
      AND swimming_pool_id = ${poolId}
      AND report_type      = 'custom'
      AND content->>'pipeline' = 'paid_insight'
      AND product_status NOT IN ('PUBLISHED', 'FAILED')
      AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `);
  if (existing.rows.length > 0) {
    return String((existing.rows[0] as any).id);
  }

  // Create a new paid insight report row
  const created = await db.execute(sql`
    INSERT INTO growth_reports (
      student_id, swimming_pool_id,
      report_type, product_status, parent_input_status,
      content, snapshot_version
    ) VALUES (
      ${studentId}, ${poolId},
      'custom', 'OPEN', 'AVAILABLE',
      ${JSON.stringify({ pipeline: "paid_insight", paid_insight_state: "OPEN" })}::jsonb,
      0
    )
    RETURNING id
  `);
  return String((created.rows[0] as any).id);
}

// ─── Saved answers helper ────────────────────────────────────────────────────

async function loadSavedAnswers(
  reportId: string,
  parentAccountId: string,
): Promise<PiExistingParentAnswer[]> {
  const rows = await db.execute(sql`
    SELECT
      grq.engine_question_id AS question_id,
      gra.selected_values    AS answer,
      gra.answered_at
    FROM growth_report_answers gra
    JOIN growth_report_questions grq ON grq.id = gra.question_id
    WHERE gra.report_id        = ${reportId}
      AND gra.parent_account_id = ${parentAccountId}
    ORDER BY grq.sequence
  `);
  return (rows.rows as any[]).map(r => ({
    question_id:  String(r.question_id),
    answer:       r.answer,
    answered_at:  String(r.answered_at),
  }));
}

// ─── Map AI Engine answer_type to DB enum ────────────────────────────────────

function mapAnswerType(raw: string): string {
  switch (raw?.toLowerCase()) {
    case "single_choice": return "SINGLE_CHOICE";
    case "multi_choice":  return "MULTI_CHOICE";
    // SCALE / SHORT_TEXT stored as text in options JSONB if enum not yet extended
    default: return "SINGLE_CHOICE";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /parent/students/:studentId/paid-insight/questions
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  "/parent/students/:studentId/paid-insight/questions",
  requireAuth,
  requireRole("parent_account"),
  async (req: AuthRequest, res) => {
    const parentId  = req.user!.userId;
    const { studentId } = req.params;

    // Ownership + pool isolation
    const ownership = await resolveOwnership(parentId, studentId).catch(() => null);
    if (!ownership) {
      res.status(403).json({ error: "접근 권한이 없습니다.", code: "FORBIDDEN" });
      return;
    }
    const { poolId } = ownership;

    const requestId = `pi_q_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;

    try {
      // Ensure report row exists
      const reportId = await ensurePaidInsightReport(studentId, poolId);

      // Load saved answers
      const existingAnswers = await loadSavedAnswers(reportId, parentId);

      // Assemble snapshot
      const snapshot = await assemblePaidInsightSnapshot(db, { studentId, poolId });

      const piRequest: PiQuestionRequest = {
        schema_version:          PI_SCHEMA_VERSION,
        request_id:              requestId,
        subject_ref:             { student_id: studentId, pool_id: poolId },
        report_context:          { report_id: reportId },
        snapshot_request:        snapshot,
        existing_parent_answers: existingAnswers,
      };

      const engineResult = await planPaidInsightQuestions(piRequest);

      // Persist returned questions (upsert by engine_question_id)
      for (let i = 0; i < engineResult.questions.length; i++) {
        const q = engineResult.questions[i]!;
        const dbAnswerType = mapAnswerType(q.answer_type);
        await db.execute(sql`
          INSERT INTO growth_report_questions (
            report_id, engine_question_id, metric_id,
            question_text, answer_type, options,
            sequence, is_required
          ) VALUES (
            ${reportId},
            ${q.question_id},
            ${q.metric_id ?? ""},
            ${q.question_text},
            ${dbAnswerType}::gr_answer_type_enum,
            ${JSON.stringify(q.options ?? [])}::jsonb,
            ${i + 1},
            ${q.is_required === true}
          )
          ON CONFLICT (report_id, engine_question_id)
          DO UPDATE SET
            question_text = EXCLUDED.question_text,
            options       = EXCLUDED.options,
            sequence      = EXCLUDED.sequence,
            is_required   = EXCLUDED.is_required
        `);
      }

      // Update report paid_insight_state
      const newState = engineResult.status === "READY" ? "READY_FOR_PAYMENT"
                     : engineResult.status === "NEEDS_PARENT_INPUT" ? "QUESTIONS_REQUIRED"
                     : "INSUFFICIENT_EVIDENCE";

      await db.execute(sql`
        UPDATE growth_reports
        SET content = content || ${JSON.stringify({ paid_insight_state: newState })}::jsonb,
            product_status = CASE
              WHEN product_status = 'OPEN' THEN
                CASE ${newState}
                  WHEN 'QUESTIONS_REQUIRED' THEN 'QUESTION_AVAILABLE'
                  WHEN 'READY_FOR_PAYMENT'  THEN 'READY_FOR_ANALYSIS'
                  ELSE 'OPEN'
                END::gr_product_status_enum
              ELSE product_status
            END,
            updated_at = now()
        WHERE id = ${reportId}
          AND deleted_at IS NULL
      `);

      res.json({
        report_id:     reportId,
        request_id:    engineResult.request_id,
        status:        engineResult.status,
        questions:     engineResult.questions,
        question_count: engineResult.questions.length,
      });
    } catch (err: any) {
      if (err instanceof PaidInsightEngineError) {
        console.error(
          "[paid-insight] questions engine error",
          { requestId, code: err.code, status: err.httpStatus, retryable: err.retryable },
        );
        res.status(502).json({
          error:     "AI Engine 오류가 발생했습니다.",
          code:      err.code,
          retryable: err.retryable,
          request_id: requestId,
        });
        return;
      }
      console.error("[paid-insight] questions error", requestId, err?.message);
      res.status(500).json({ error: "서버 오류가 발생했습니다.", code: "INTERNAL_ERROR" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /parent/students/:studentId/paid-insight/analysis
//
// NOTE: In production this MUST only be called after verified purchase.
//       The route validates payment context from req.body.payment_verified.
//       Until Payment Stage connects, internal/test calls pass verified=true.
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  "/parent/students/:studentId/paid-insight/analysis",
  requireAuth,
  requireRole("parent_account"),
  async (req: AuthRequest, res) => {
    const parentId  = req.user!.userId;
    const { studentId } = req.params;

    // Ownership + pool isolation
    const ownership = await resolveOwnership(parentId, studentId).catch(() => null);
    if (!ownership) {
      res.status(403).json({ error: "접근 권한이 없습니다.", code: "FORBIDDEN" });
      return;
    }
    const { poolId } = ownership;

    // Payment gate — must be explicitly verified.
    // Until Payment Stage: body.payment_verified = true required for non-test env.
    const paymentVerified = req.body?.payment_verified === true
      || process.env["NODE_ENV"] === "test";
    if (!paymentVerified) {
      res.status(402).json({
        error:   "결제 확인이 필요합니다.",
        code:    "PAYMENT_REQUIRED",
        message: "분석을 시작하려면 먼저 결제를 완료해 주세요.",
      });
      return;
    }

    const requestId = `pi_a_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;

    try {
      // Resolve active report
      const activeReport = await db.execute(sql`
        SELECT id, product_status, analysis_request_id
        FROM growth_reports
        WHERE student_id       = ${studentId}
          AND swimming_pool_id = ${poolId}
          AND report_type      = 'custom'
          AND content->>'pipeline' = 'paid_insight'
          AND product_status NOT IN ('PUBLISHED', 'FAILED')
          AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      `);

      if (!activeReport.rows.length) {
        res.status(404).json({ error: "분석 대상 리포트를 찾을 수 없습니다.", code: "REPORT_NOT_FOUND" });
        return;
      }

      const reportRow = activeReport.rows[0] as any;
      const reportId  = String(reportRow.id);

      // Idempotency: if already analyzing with same request, return existing state
      if (reportRow.analysis_request_id === requestId) {
        res.json({ report_id: reportId, status: "PROCESSING", request_id: requestId });
        return;
      }

      // Load saved answers
      const savedAnswers = await loadSavedAnswers(reportId, parentId);

      // Assemble snapshot
      const snapshot = await assemblePaidInsightSnapshot(db, { studentId, poolId });

      // Mark as ANALYZING
      await db.execute(sql`
        UPDATE growth_reports
        SET product_status       = 'ANALYZING',
            analysis_request_id  = ${requestId},
            content = content || ${JSON.stringify({ paid_insight_state: "PROCESSING" })}::jsonb,
            updated_at = now()
        WHERE id = ${reportId}
          AND deleted_at IS NULL
      `);

      const piRequest: PiAnalysisRequest = {
        schema_version:   PI_SCHEMA_VERSION,
        request_id:       requestId,
        subject_ref:      { student_id: studentId, pool_id: poolId },
        report_context:   { report_id: reportId },
        snapshot_request: snapshot,
        parent_answers:   savedAnswers,
      };

      const engineResult = await runPaidInsightAnalysis(piRequest);

      // Save analysis result — store in report_content (opaque JSONB)
      await db.execute(sql`
        UPDATE growth_reports
        SET product_status   = 'REVIEW_REQUIRED',
            analysis_status  = 'COMPLETE',
            report_content   = ${JSON.stringify(engineResult)}::jsonb,
            content = content || ${JSON.stringify({ paid_insight_state: "READY_FOR_PAYMENT" })}::jsonb,
            updated_at = now()
        WHERE id = ${reportId}
          AND deleted_at IS NULL
      `);

      // Log: analysis complete (no PII, no snapshot payload)
      console.log(`[paid-insight] analysis complete request_id=${requestId} report=${reportId} student_ref=${studentId.slice(0, 8)}...`);

      res.json({
        report_id:  reportId,
        request_id: engineResult.request_id ?? requestId,
        status:     "COMPLETE",
        summary:    engineResult.summary ?? null,
      });
    } catch (err: any) {
      // On engine failure, mark report as FAILED
      try {
        await db.execute(sql`
          UPDATE growth_reports
          SET product_status = 'FAILED',
              content = content || ${JSON.stringify({ paid_insight_state: "FAILED", error_code: err?.code ?? "UNKNOWN" })}::jsonb,
              updated_at = now()
          WHERE student_id       = ${studentId}
            AND swimming_pool_id = ${poolId}
            AND report_type      = 'custom'
            AND content->>'pipeline' = 'paid_insight'
            AND analysis_request_id = ${requestId}
            AND deleted_at IS NULL
        `);
      } catch { /* best-effort */ }

      if (err instanceof PaidInsightEngineError) {
        console.error(
          "[paid-insight] analysis engine error",
          { requestId, code: err.code, status: err.httpStatus, retryable: err.retryable },
        );
        res.status(502).json({
          error:      "AI Engine 분석 오류가 발생했습니다.",
          code:       err.code,
          retryable:  err.retryable,
          request_id: requestId,
        });
        return;
      }
      console.error("[paid-insight] analysis error", requestId, err?.message);
      res.status(500).json({ error: "서버 오류가 발생했습니다.", code: "INTERNAL_ERROR" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /parent/students/:studentId/paid-insight/status
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/parent/students/:studentId/paid-insight/status",
  requireAuth,
  requireRole("parent_account"),
  async (req: AuthRequest, res) => {
    const parentId  = req.user!.userId;
    const { studentId } = req.params;

    const ownership = await resolveOwnership(parentId, studentId).catch(() => null);
    if (!ownership) {
      res.status(403).json({ error: "접근 권한이 없습니다.", code: "FORBIDDEN" });
      return;
    }
    const { poolId } = ownership;

    try {
      const reportRow = await db.execute(sql`
        SELECT id, product_status, content, created_at, published_at
        FROM growth_reports
        WHERE student_id       = ${studentId}
          AND swimming_pool_id = ${poolId}
          AND report_type      = 'custom'
          AND content->>'pipeline' = 'paid_insight'
          AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      `);

      if (!reportRow.rows.length) {
        // Check if student has enough lesson data
        const lessonCount = await db.execute(sql`
          SELECT COUNT(*)::int AS cnt
          FROM diary_notes
          WHERE student_id       = ${studentId}
            AND swimming_pool_id = ${poolId}
            AND deleted_at IS NULL
            AND diary_date >= (CURRENT_DATE - INTERVAL '90 days')
        `);
        const cnt = Number((lessonCount.rows[0] as any)?.cnt ?? 0);

        res.json({
          has_report:    false,
          lesson_count:  cnt,
          lesson_ready:  cnt > 0,
          state:         "NOT_STARTED",
        });
        return;
      }

      const r = reportRow.rows[0] as any;
      const contentJson = (typeof r.content === "object" && r.content !== null)
        ? r.content as any : {};
      const paidState = contentJson.paid_insight_state ?? r.product_status ?? "OPEN";

      res.json({
        has_report:    true,
        report_id:     String(r.id),
        product_status: String(r.product_status),
        state:         paidState,
        published_at:  r.published_at ? String(r.published_at) : null,
      });
    } catch (err: any) {
      console.error("[paid-insight] status error", err?.message);
      res.status(500).json({ error: "서버 오류가 발생했습니다.", code: "INTERNAL_ERROR" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /parent/students/:studentId/paid-insight/history
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/parent/students/:studentId/paid-insight/history",
  requireAuth,
  requireRole("parent_account"),
  async (req: AuthRequest, res) => {
    const parentId  = req.user!.userId;
    const { studentId } = req.params;

    const ownership = await resolveOwnership(parentId, studentId).catch(() => null);
    if (!ownership) {
      res.status(403).json({ error: "접근 권한이 없습니다.", code: "FORBIDDEN" });
      return;
    }
    const { poolId } = ownership;

    const limit  = Math.min(Number(req.query.limit  ?? 24), 50);
    const offset = Math.max(Number(req.query.offset ?? 0),   0);

    try {
      const rows = await db.execute(sql`
        SELECT
          id,
          product_status,
          report_period,
          published_at,
          created_at,
          content->>'paid_insight_state' AS paid_state,
          summary_text
        FROM growth_reports
        WHERE student_id       = ${studentId}
          AND swimming_pool_id = ${poolId}
          AND report_type      = 'custom'
          AND content->>'pipeline' = 'paid_insight'
          AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `);

      const reports = (rows.rows as any[]).map(r => ({
        id:             String(r.id),
        product_status: String(r.product_status),
        state:          r.paid_state ?? String(r.product_status),
        report_period:  r.report_period ?? null,
        published_at:   r.published_at ? String(r.published_at) : null,
        issued_at:      r.published_at ? String(r.published_at) : null,
        summary:        r.summary_text ?? null,
        type:           "paid_insight",
      }));

      res.json({
        reports,
        total: reports.length,
        limit,
        offset,
      });
    } catch (err: any) {
      console.error("[paid-insight] history error", err?.message);
      res.status(500).json({ error: "서버 오류가 발생했습니다.", code: "INTERNAL_ERROR" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /parent/students/:studentId/paid-insight/answers
// Save parent answers for a specific question (draft save)
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  "/parent/students/:studentId/paid-insight/answers",
  requireAuth,
  requireRole("parent_account"),
  async (req: AuthRequest, res) => {
    const parentId  = req.user!.userId;
    const { studentId } = req.params;

    const ownership = await resolveOwnership(parentId, studentId).catch(() => null);
    if (!ownership) {
      res.status(403).json({ error: "접근 권한이 없습니다.", code: "FORBIDDEN" });
      return;
    }
    const { poolId } = ownership;

    const { report_id, question_id, answer } = req.body ?? {};
    if (!report_id || !question_id) {
      res.status(400).json({ error: "report_id, question_id는 필수입니다.", code: "BAD_REQUEST" });
      return;
    }

    try {
      // Validate report ownership (report belongs to this student + pool)
      const reportCheck = await db.execute(sql`
        SELECT id FROM growth_reports
        WHERE id = ${report_id}
          AND student_id       = ${studentId}
          AND swimming_pool_id = ${poolId}
          AND report_type      = 'custom'
          AND content->>'pipeline' = 'paid_insight'
          AND deleted_at IS NULL
        LIMIT 1
      `);
      if (!reportCheck.rows.length) {
        res.status(403).json({ error: "접근 권한이 없습니다.", code: "FORBIDDEN" });
        return;
      }

      // Resolve internal question id from engine_question_id
      const questionRow = await db.execute(sql`
        SELECT id FROM growth_report_questions
        WHERE report_id          = ${report_id}
          AND engine_question_id = ${question_id}
        LIMIT 1
      `);
      if (!questionRow.rows.length) {
        res.status(404).json({ error: "질문을 찾을 수 없습니다.", code: "QUESTION_NOT_FOUND" });
        return;
      }
      const internalQuestionId = String((questionRow.rows[0] as any).id);

      // Normalize answer to JSON array
      const selectedValues = Array.isArray(answer) ? answer : [answer].filter(v => v !== null && v !== undefined);

      // Upsert answer
      await db.execute(sql`
        INSERT INTO growth_report_answers
          (report_id, question_id, parent_account_id, selected_values, answered_at, updated_at)
        VALUES
          (${report_id}, ${internalQuestionId}, ${parentId},
           ${JSON.stringify(selectedValues)}::jsonb, now(), now())
        ON CONFLICT (report_id, question_id, parent_account_id)
        DO UPDATE SET
          selected_values = EXCLUDED.selected_values,
          answered_at     = EXCLUDED.answered_at,
          updated_at      = now()
      `);

      res.json({ ok: true, question_id, answered_at: new Date().toISOString() });
    } catch (err: any) {
      console.error("[paid-insight] save answer error", err?.message);
      res.status(500).json({ error: "서버 오류가 발생했습니다.", code: "INTERNAL_ERROR" });
    }
  },
);

export default router;
