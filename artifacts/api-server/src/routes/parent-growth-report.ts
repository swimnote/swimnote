/**
 * parent-growth-report.ts — GR4: Parent Question & Answer API
 *
 * Routes:
 *   GET  /parent/growth-reports/:reportId/questions — 질문 목록 조회
 *   PUT  /parent/growth-reports/:reportId/answers   — 답변 저장 (upsert, partial save)
 *   POST /parent/growth-reports/:reportId/complete  — 완료 (QUESTION_AVAILABLE → READY_FOR_ANALYSIS)
 *
 * 원칙:
 *   - APP은 질문을 만들지 않는다 (ENGINE 질문만 반환)
 *   - APP은 answer 의미를 해석하지 않는다 (raw selected_values 저장)
 *   - ownership: parent_students(status=approved) 검증 필수
 *   - X access: requireReportXAccess 재사용
 *   - ANALYZING/REVIEW_REQUIRED/APPROVED/PUBLISHED 상태에서 answer 수정 금지
 *   - SINGLE_CHOICE: 정확히 1개, MULTI_CHOICE: allowed options 내 값만, 중복 금지
 *   - complete는 background worker(GR3)가 처리 — route에서 ENGINE 직접 호출 금지
 */

import { Router } from "express";
import { sql } from "drizzle-orm";
import { superAdminDb } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";
import {
  requireReportXAccess,
  type ReportAuthRequest,
} from "../lib/xmode-report-guard.js";
import {
  transitionReportStatus,
  updateParentInputStatus,
  InvalidTransitionError,
} from "../lib/growth-report-service.js";

const router = Router();

// ── 공통 미들웨어 ──────────────────────────────────────────────────────────────

function requireParent(req: AuthRequest, res: any, next: any) {
  if (!req.user || req.user.role !== "parent_account") {
    res.status(403).json({ error: "학부모 계정만 접근 가능합니다." });
    return;
  }
  next();
}

// ── 편의 함수 ─────────────────────────────────────────────────────────────────

function genId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

type AnswerType = "SINGLE_CHOICE" | "MULTI_CHOICE";

// 수정을 금지하는 product_status 목록 (GR4 spec §18)
const EDIT_LOCKED_STATUSES = new Set([
  "ANALYZING",
  "REVIEW_REQUIRED",
  "APPROVED",
  "PUBLISHED",
]);

// audit helper
async function writeParentAnswerAudit(params: {
  reportId: string;
  poolId: string;
  parentAccountId: string;
  eventType: "PARENT_GROWTH_ANSWER_SAVED" | "PARENT_GROWTH_INPUT_COMPLETED";
  answerCount: number;
}) {
  const { reportId, poolId, parentAccountId, eventType, answerCount } = params;
  try {
    const vRes = await superAdminDb.execute(sql`
      SELECT next_audit_version('growth_report', ${reportId}) AS v
    `);
    const version = (vRes.rows[0] as any)?.v ?? 1;

    await superAdminDb.execute(sql`
      INSERT INTO audit_logs (
        entity_type, entity_id, entity_version,
        action, actor_type, actor_id, pool_id,
        before_data, after_data, reason,
        request_id, correlation_id, ip_hash
      ) VALUES (
        'growth_report', ${reportId}, ${version},
        'update',
        'parent', ${parentAccountId}, ${poolId},
        NULL::jsonb,
        ${JSON.stringify({ event: eventType, answer_count: answerCount })}::jsonb,
        ${eventType},
        NULL, NULL, NULL
      )
    `);
  } catch (e: any) {
    console.warn(`[parent-growth-report] audit fail: ${e.message}`);
  }
}

// ── GET /parent/growth-reports/:reportId/questions ────────────────────────────

router.get(
  "/parent/growth-reports/:reportId/questions",
  requireAuth,
  requireReportXAccess as any,
  async (req: ReportAuthRequest, res) => {
    const parentId = req.user!.userId;
    const { reportId } = req.params as { reportId: string };
    const poolId = req.resolvedReportPoolId!;

    try {
      // 1. report 조회 + ownership 검증
      const reportRes = await superAdminDb.execute(sql`
        SELECT
          gr.id,
          gr.student_id,
          gr.swimming_pool_id,
          gr.product_status,
          gr.parent_input_status,
          gr.cycle_id,
          grc.parent_input_open_at,
          grc.parent_input_close_at
        FROM growth_reports gr
        LEFT JOIN growth_report_cycles grc ON grc.id = gr.cycle_id
        WHERE gr.id = ${reportId}
          AND gr.swimming_pool_id = ${poolId}
          AND gr.deleted_at IS NULL
        LIMIT 1
      `);

      const report = reportRes.rows[0] as any;
      if (!report) {
        res.status(404).json({ success: false, error: "REPORT_NOT_FOUND", message: "리포트를 찾을 수 없습니다." });
        return;
      }

      // 2. parent → student ownership (parent_students approved)
      const linkRes = await superAdminDb.execute(sql`
        SELECT 1 FROM parent_students
        WHERE parent_id = ${parentId}
          AND student_id = ${report.student_id}
          AND status = 'approved'
        LIMIT 1
      `);
      if (linkRes.rows.length === 0) {
        res.status(403).json({ success: false, error: "OWNERSHIP_DENIED", message: "접근 권한이 없습니다." });
        return;
      }

      // 3. 질문 목록 + 기존 답변 join
      const questionsRes = await superAdminDb.execute(sql`
        SELECT
          q.id            AS question_id,
          q.engine_question_id,
          q.metric_id,
          q.question_text,
          q.answer_type,
          q.options,
          q.parent_confirmable_behavior,
          q.question_stage,
          q.sequence,
          q.is_required,
          q.metric_definition_version,
          q.question_policy_version,
          a.selected_values AS existing_answer,
          a.answered_at
        FROM growth_report_questions q
        LEFT JOIN growth_report_answers a
          ON a.question_id = q.id
          AND a.report_id = q.report_id
          AND a.parent_account_id = ${parentId}
        WHERE q.report_id = ${reportId}
        ORDER BY q.sequence ASC
      `);

      const questions = questionsRes.rows as any[];
      const answeredCount = questions.filter(
        (q) => q.existing_answer !== null && (q.existing_answer as any[]).length > 0,
      ).length;

      res.json({
        success: true,
        report_id:           reportId,
        product_status:      report.product_status,
        parent_input_status: report.parent_input_status,
        parent_input_open_at:  report.parent_input_open_at,
        parent_input_close_at: report.parent_input_close_at,
        total_questions:   questions.length,
        answered_questions: answeredCount,
        questions: questions.map((q) => ({
          question_id:                 q.question_id,
          engine_question_id:          q.engine_question_id,
          metric_id:                   q.metric_id,
          question_text:               q.question_text,
          answer_type:                 q.answer_type,
          options:                     q.options ?? [],
          parent_confirmable_behavior: q.parent_confirmable_behavior ?? null,
          question_stage:              q.question_stage ?? null,
          sequence:                    q.sequence,
          is_required:                 q.is_required ?? false,
          existing_answer:             q.existing_answer ?? [],
          answered_at:                 q.answered_at ?? null,
        })),
      });
    } catch (e: any) {
      console.error("[parent-growth-report] GET questions error:", e);
      res.status(500).json({ success: false, error: "SERVER_ERROR", message: "서버 오류가 발생했습니다." });
    }
  },
);

// ── PUT /parent/growth-reports/:reportId/answers ──────────────────────────────

router.put(
  "/parent/growth-reports/:reportId/answers",
  requireAuth,
  requireReportXAccess as any,
  async (req: ReportAuthRequest, res) => {
    const parentId = req.user!.userId;
    const { reportId } = req.params as { reportId: string };
    const poolId = req.resolvedReportPoolId!;

    const { answers } = req.body as {
      answers?: Array<{ question_id: string; selected_values: string[] }>;
    };

    if (!Array.isArray(answers) || answers.length === 0) {
      res.status(400).json({ success: false, error: "INVALID_PAYLOAD", message: "answers 배열이 필요합니다." });
      return;
    }

    try {
      // 1. report 조회 + ownership
      const reportRes = await superAdminDb.execute(sql`
        SELECT
          gr.id,
          gr.student_id,
          gr.swimming_pool_id,
          gr.product_status,
          gr.parent_input_status,
          gr.cycle_id,
          grc.parent_input_open_at,
          grc.parent_input_close_at
        FROM growth_reports gr
        LEFT JOIN growth_report_cycles grc ON grc.id = gr.cycle_id
        WHERE gr.id = ${reportId}
          AND gr.swimming_pool_id = ${poolId}
          AND gr.deleted_at IS NULL
        LIMIT 1
      `);

      const report = reportRes.rows[0] as any;
      if (!report) {
        res.status(404).json({ success: false, error: "REPORT_NOT_FOUND", message: "리포트를 찾을 수 없습니다." });
        return;
      }

      // 2. parent → student ownership
      const linkRes = await superAdminDb.execute(sql`
        SELECT 1 FROM parent_students
        WHERE parent_id = ${parentId}
          AND student_id = ${report.student_id}
          AND status = 'approved'
        LIMIT 1
      `);
      if (linkRes.rows.length === 0) {
        res.status(403).json({ success: false, error: "OWNERSHIP_DENIED", message: "접근 권한이 없습니다." });
        return;
      }

      // 3. parent_input_status CLOSED → 차단 (GR4 spec §11)
      if (report.parent_input_status === "CLOSED") {
        res.status(423).json({
          success: false,
          error: "PARENT_INPUT_CLOSED",
          message: "답변 기간이 종료되었습니다.",
        });
        return;
      }

      // 4. edit lock — ANALYZING/REVIEW_REQUIRED/APPROVED/PUBLISHED (spec §18)
      if (EDIT_LOCKED_STATUSES.has(report.product_status)) {
        res.status(423).json({
          success: false,
          error: "EDIT_LOCKED",
          message: "분석이 시작된 이후에는 답변을 수정할 수 없습니다.",
        });
        return;
      }

      // 5. 해당 report의 활성 질문 목록 조회
      const questionsRes = await superAdminDb.execute(sql`
        SELECT id, answer_type, options
        FROM growth_report_questions
        WHERE report_id = ${reportId}
      `);
      const questionMap = new Map(
        (questionsRes.rows as any[]).map((q) => [q.id, q]),
      );

      // 6. 각 answer 검증
      for (const ans of answers) {
        if (!ans.question_id || !Array.isArray(ans.selected_values)) {
          res.status(400).json({
            success: false,
            error: "INVALID_ANSWER_FORMAT",
            message: `answer 형식이 올바르지 않습니다: question_id=${ans.question_id}`,
          });
          return;
        }

        const question = questionMap.get(ans.question_id);
        if (!question) {
          res.status(400).json({
            success: false,
            error: "UNKNOWN_QUESTION",
            message: `해당 report의 질문이 아닙니다: question_id=${ans.question_id}`,
          });
          return;
        }

        const answerType = question.answer_type as AnswerType;
        const allowedOptions = new Set(
          ((question.options as any[]) ?? []).map((o: any) =>
            typeof o === "string" ? o : o?.value,
          ),
        );

        // 중복 value 금지
        const uniqueValues = new Set(ans.selected_values);
        if (uniqueValues.size !== ans.selected_values.length) {
          res.status(400).json({
            success: false,
            error: "DUPLICATE_SELECTED_VALUE",
            message: `중복된 선택값이 있습니다: question_id=${ans.question_id}`,
          });
          return;
        }

        // SINGLE_CHOICE: 정확히 1개 (빈 배열은 partial-delete용으로 허용)
        if (answerType === "SINGLE_CHOICE" && ans.selected_values.length > 1) {
          res.status(400).json({
            success: false,
            error: "SINGLE_CHOICE_MULTIPLE_VALUES",
            message: `SINGLE_CHOICE는 최대 1개 선택만 가능합니다: question_id=${ans.question_id}`,
          });
          return;
        }

        // allowed options 검사 (비어있지 않은 경우)
        if (allowedOptions.size > 0) {
          for (const val of ans.selected_values) {
            if (!allowedOptions.has(val)) {
              res.status(400).json({
                success: false,
                error: "INVALID_OPTION_VALUE",
                message: `허용되지 않은 선택값입니다: question_id=${ans.question_id} value=${val}`,
              });
              return;
            }
          }
        }
      }

      // 7. answer upsert — (report_id, question_id, parent_account_id)
      let savedCount = 0;
      for (const ans of answers) {
        const answerId = genId("gra");
        await superAdminDb.execute(sql`
          INSERT INTO growth_report_answers (
            id, report_id, question_id, parent_account_id,
            selected_values, answered_at, created_at, updated_at
          ) VALUES (
            ${answerId},
            ${reportId},
            ${ans.question_id},
            ${parentId},
            ${JSON.stringify(ans.selected_values)}::jsonb,
            now(), now(), now()
          )
          ON CONFLICT (report_id, question_id, parent_account_id)
          DO UPDATE SET
            selected_values = EXCLUDED.selected_values,
            answered_at     = now(),
            updated_at      = now()
        `);
        savedCount++;
      }

      // 8. parent_input_status 갱신: NONE/AVAILABLE → ANSWERED (first answer)
      if (
        report.parent_input_status === "NONE" ||
        report.parent_input_status === "AVAILABLE"
      ) {
        await updateParentInputStatus({
          db: superAdminDb,
          reportId,
          toStatus: "ANSWERED",
        });
      }

      // 9. audit
      await writeParentAnswerAudit({
        reportId,
        poolId,
        parentAccountId: parentId,
        eventType: "PARENT_GROWTH_ANSWER_SAVED",
        answerCount: savedCount,
      });

      res.json({
        success: true,
        saved_count: savedCount,
        parent_input_status: "ANSWERED",
      });
    } catch (e: any) {
      console.error("[parent-growth-report] PUT answers error:", e);
      res.status(500).json({ success: false, error: "SERVER_ERROR", message: "서버 오류가 발생했습니다." });
    }
  },
);

// ── POST /parent/growth-reports/:reportId/complete ────────────────────────────

router.post(
  "/parent/growth-reports/:reportId/complete",
  requireAuth,
  requireReportXAccess as any,
  async (req: ReportAuthRequest, res) => {
    const parentId = req.user!.userId;
    const { reportId } = req.params as { reportId: string };
    const poolId = req.resolvedReportPoolId!;

    try {
      // 1. report 조회 + ownership
      const reportRes = await superAdminDb.execute(sql`
        SELECT
          gr.id,
          gr.student_id,
          gr.swimming_pool_id,
          gr.product_status,
          gr.parent_input_status,
          gr.cycle_id
        FROM growth_reports gr
        WHERE gr.id = ${reportId}
          AND gr.swimming_pool_id = ${poolId}
          AND gr.deleted_at IS NULL
        LIMIT 1
      `);

      const report = reportRes.rows[0] as any;
      if (!report) {
        res.status(404).json({ success: false, error: "REPORT_NOT_FOUND", message: "리포트를 찾을 수 없습니다." });
        return;
      }

      // 2. parent → student ownership
      const linkRes = await superAdminDb.execute(sql`
        SELECT 1 FROM parent_students
        WHERE parent_id = ${parentId}
          AND student_id = ${report.student_id}
          AND status = 'approved'
        LIMIT 1
      `);
      if (linkRes.rows.length === 0) {
        res.status(403).json({ success: false, error: "OWNERSHIP_DENIED", message: "접근 권한이 없습니다." });
        return;
      }

      // 3. idempotent: 이미 READY_FOR_ANALYSIS 이상이면 200 반환
      const alreadyComplete = new Set([
        "READY_FOR_ANALYSIS", "ANALYZING", "REVIEW_REQUIRED",
        "APPROVED", "PUBLISHED",
      ]);
      if (alreadyComplete.has(report.product_status)) {
        res.json({
          success: true,
          already_complete: true,
          product_status: report.product_status,
          message: "이미 분석 대기 상태입니다.",
        });
        return;
      }

      // 4. QUESTION_AVAILABLE → READY_FOR_ANALYSIS (GR4 spec §13)
      // 질문 일부만 답했어도 모두 optional이므로 complete 가능
      if (report.product_status !== "QUESTION_AVAILABLE") {
        res.status(422).json({
          success: false,
          error: "INVALID_STATUS_FOR_COMPLETE",
          message: `현재 상태(${report.product_status})에서는 완료할 수 없습니다.`,
        });
        return;
      }

      // 5. answer 개수 집계 (audit용)
      const countRes = await superAdminDb.execute(sql`
        SELECT COUNT(*) AS cnt FROM growth_report_answers
        WHERE report_id = ${reportId}
          AND parent_account_id = ${parentId}
      `);
      const answerCount = Number((countRes.rows[0] as any)?.cnt ?? 0);

      // 6. 상태 전환 — GR3 worker가 second-pass ENGINE call을 처리
      await transitionReportStatus({
        db:        superAdminDb,
        reportId,
        toStatus:  "READY_FOR_ANALYSIS",
        actorType: "parent",
        actorId:   parentId,
        reason:    "PARENT_GROWTH_INPUT_COMPLETED",
      });

      // 7. audit
      await writeParentAnswerAudit({
        reportId,
        poolId,
        parentAccountId: parentId,
        eventType: "PARENT_GROWTH_INPUT_COMPLETED",
        answerCount,
      });

      res.json({
        success: true,
        already_complete: false,
        product_status: "READY_FOR_ANALYSIS",
        message: "답변이 완료되었습니다. 성장 리포트 분석이 시작됩니다.",
      });
    } catch (e: any) {
      if (e instanceof InvalidTransitionError) {
        // 동시 요청으로 이미 전환된 경우 idempotent 처리
        res.json({
          success: true,
          already_complete: true,
          product_status:   "READY_FOR_ANALYSIS",
          message:          "이미 분석 대기 상태입니다.",
        });
        return;
      }
      console.error("[parent-growth-report] POST complete error:", e);
      res.status(500).json({ success: false, error: "SERVER_ERROR", message: "서버 오류가 발생했습니다." });
    }
  },
);

// ── GET /parent/growth-reports/:reportId — GR8 Detail ─────────────────────────
//
// access: requireAuth only (X 만료 후에도 PUBLISHED 조회 가능, spec §4, §23)
// ownership: parent_students(status='approved') DB 검증 (spec §3)
// gate: product_status = PUBLISHED only (spec §2)
// projection: safe subset only — internal trace 제외 (spec §6)
// error: typed errors, 5xx≠"리포트 없음" (spec §7, §10)

router.get(
  "/parent/growth-reports/:reportId",
  requireAuth,
  async (req: AuthRequest, res) => {
    const parentId = req.user!.userId;
    const { reportId } = req.params as { reportId: string };

    // 기본 유효성 — 완전히 비어있는 reportId 차단
    if (!reportId || reportId.trim().length === 0) {
      res.status(400).json({ success: false, error: "INVALID_REPORT_ID", message: "reportId가 필요합니다." });
      return;
    }

    try {
      // 1. report 조회 — safe columns only (internal trace 제외)
      const reportRes = await superAdminDb.execute(sql`
        SELECT
          gr.id,
          gr.student_id,
          gr.swimming_pool_id,
          gr.report_period,
          gr.published_at,
          gr.product_status,
          gr.report_content,
          gr.sns_summary
        FROM growth_reports gr
        WHERE gr.id = ${reportId}
          AND gr.deleted_at IS NULL
        LIMIT 1
      `);

      const report = reportRes.rows[0] as any;
      if (!report) {
        res.status(404).json({ success: false, error: "NOT_FOUND", message: "리포트를 찾을 수 없습니다." });
        return;
      }

      // 2. product_status = PUBLISHED only (spec §2)
      if (report.product_status !== "PUBLISHED") {
        // status별로 클라이언트에게 구분 가능한 error code 반환 (spec §10)
        const errorCode =
          report.product_status === "APPROVED"           ? "UNPUBLISHED" :
          report.product_status === "REVIEW_REQUIRED"    ? "UNPUBLISHED" :
          report.product_status === "ANALYZING"          ? "UNPUBLISHED" :
          report.product_status === "QUESTION_AVAILABLE" ? "UNPUBLISHED" :
          report.product_status === "FAILED"             ? "UNPUBLISHED" :
                                                           "UNPUBLISHED";
        res.status(403).json({ success: false, error: errorCode, message: "공개된 리포트가 아닙니다." });
        return;
      }

      // 3. parent → student ownership (parent_students approved, spec §3)
      const linkRes = await superAdminDb.execute(sql`
        SELECT 1 FROM parent_students
        WHERE parent_id = ${parentId}
          AND student_id = ${report.student_id}
          AND status = 'approved'
        LIMIT 1
      `);
      if (linkRes.rows.length === 0) {
        res.status(403).json({ success: false, error: "FORBIDDEN", message: "접근 권한이 없습니다." });
        return;
      }

      // 4. report_content 유효성 (spec §7) — null/string/배열 모두 reject
      const rc = report.report_content;
      if (
        rc === null ||
        rc === undefined ||
        typeof rc !== "object" ||
        Array.isArray(rc)
      ) {
        res.status(500).json({ success: false, error: "INVALID_REPORT_CONTENT", message: "리포트 데이터가 유효하지 않습니다." });
        return;
      }

      // 5. sns_summary — null 허용 (nullable 설계), 있으면 object 검증
      const sns = report.sns_summary;
      const snsSafe =
        sns && typeof sns === "object" && !Array.isArray(sns)
          ? {
              headline:             sns.headline ?? "",
              key_points:           Array.isArray(sns.key_points) ? sns.key_points : [],
              share_safe:           sns.share_safe === true,
              supporting_claim_ids: Array.isArray(sns.supporting_claim_ids)
                ? sns.supporting_claim_ids
                : undefined,
            }
          : null;

      // 6. safe report_content projection (spec §5, §6)
      //    sections만 전달, internal claim_ids 포함한 전체 구조는 그대로(클라이언트가 text만 표시)
      //    Fact Package / evidence trace / engine debug 제외는 SELECT에서 이미 처리됨
      const rcSafe: Record<string, any> = {
        summary_text:         rc.summary_text ?? "",
        composition_version:  rc.composition_version,
        sections:             {} as Record<string, any>,
      };

      const KNOWN_SECTIONS = [
        "core_growth",
        "swimming_progress",
        "behavioral_strengths",
        "longitudinal_comparison",
        "success_conditions",
        "parent_support",
        "teacher_guidance",
        "next_growth_direction",
      ] as const;

      if (rc.sections && typeof rc.sections === "object" && !Array.isArray(rc.sections)) {
        for (const key of KNOWN_SECTIONS) {
          const sec = (rc.sections as any)[key];
          if (sec && typeof sec === "object") {
            // text 중심 전달, claim_ids는 클라이언트 debug용이 아니므로 제거
            rcSafe.sections[key] = {
              text: sec.text ?? "",
              // internal fields 제외: supporting_evidence, confidence, debug_trace
            };
          }
        }
      }

      // 7. 응답 (spec §5)
      res.json({
        success:       true,
        report_id:     report.id,
        student_id:    report.student_id,
        report_period: report.report_period,
        published_at:  report.published_at,
        report_content: rcSafe,
        sns_summary:   snsSafe,
      });
    } catch (e: any) {
      console.error("[parent-growth-report] GET detail error:", e);
      res.status(500).json({ success: false, error: "SERVER_ERROR", message: "서버 오류가 발생했습니다." });
    }
  },
);

// ── GET /parent/students/:studentId/growth-report-status ─────────────────────
//
// 학부모에게 현재 월 성장리포트 상태를 반환한다.
// product_status → DisplayStatus 매핑:
//   PUBLISHED                                             → PUBLISHED
//   APPROVED                                              → READY
//   FAILED                                                → FAILED
//   OPEN/PREANALYZING/QUESTION_AVAILABLE/READY_FOR_ANALYSIS/
//     ANALYZING/REVIEW_REQUIRED/PARTIAL                   → GENERATING
//   X pool이 없거나 report 없음                            → NOT_AVAILABLE
//   ENGINE이 DATA_ACCUMULATING 반환한 경우 (미래)          → DATA_ACCUMULATING
//
// 원칙:
//   - report_content/fact_package 비노출 (PUBLISHED 전 열람 금지)
//   - 실패해도 crash 금지 (NOT_AVAILABLE fallback)

type DisplayStatus =
  | "NOT_AVAILABLE"
  | "DATA_ACCUMULATING"
  | "GENERATING"
  | "READY"
  | "PUBLISHED"
  | "FAILED";

function mapProductStatusToDisplay(productStatus: string): DisplayStatus {
  switch (productStatus) {
    case "PUBLISHED": return "PUBLISHED";
    case "APPROVED":  return "READY";
    case "FAILED":    return "FAILED";
    case "OPEN":
    case "PREANALYZING":
    case "QUESTION_AVAILABLE":
    case "READY_FOR_ANALYSIS":
    case "ANALYZING":
    case "REVIEW_REQUIRED":
    case "PARTIAL":
      return "GENERATING";
    default:
      return "NOT_AVAILABLE";
  }
}

router.get(
  "/parent/students/:studentId/growth-report-status",
  requireAuth,
  requireParent,
  async (req: AuthRequest, res) => {
    const parentId  = req.user!.userId;
    const studentId = req.params.studentId;

    try {
      // 1. parent ↔ student ownership
      const ownerResult = await superAdminDb.execute(sql`
        SELECT ps.swimming_pool_id
        FROM parent_students ps
        WHERE ps.parent_id  = ${parentId}
          AND ps.student_id = ${studentId}
          AND ps.status     = 'approved'
        LIMIT 1
      `);

      if (!ownerResult.rows.length) {
        res.status(403).json({ error: "접근 권한이 없습니다.", code: "FORBIDDEN" });
        return;
      }

      const poolId = (ownerResult.rows[0] as any).swimming_pool_id as string;

      // 2. X mode check — growth reports are X-pool-only
      // NOTE: Use effective entitlement (paid OR manual) to match scheduler gate.
      // Legacy xmode_entitlement column is no longer authoritative (X02-B2).
      const poolRow = await superAdminDb.execute(sql`
        SELECT xmode_entitlement,
               x_paid_entitlement,
               x_manual_entitlement,
               x_force_disabled,
               xmode_config_status
        FROM swimming_pools WHERE id = ${poolId} LIMIT 1
      `);

      const pr = poolRow.rows[0] as any;
      const effectiveEntitlement =
        (pr?.x_paid_entitlement === true || pr?.x_manual_entitlement === true) &&
        pr?.x_force_disabled !== true &&
        pr?.xmode_config_status === "READY";

      // Fallback: legacy flag for pools not yet migrated to paid/manual split
      const legacyEntitlement = pr?.xmode_entitlement === true;

      if (!effectiveEntitlement && !legacyEntitlement) {
        res.json({ status: "NOT_AVAILABLE" as DisplayStatus });
        return;
      }

      // 3. Current calendar period (Asia/Seoul, YYYY-MM)
      const nowSeoul  = new Date(
        new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }),
      );
      const period    = `${nowSeoul.getFullYear()}-${
        String(nowSeoul.getMonth() + 1).padStart(2, "0")}`;

      // 4. Fetch report for current period
      const reportRow = await superAdminDb.execute(sql`
        SELECT id, product_status, report_period, published_at, analysis_status
        FROM growth_reports
        WHERE student_id    = ${studentId}
          AND report_period = ${period}
          AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      `);

      if (!reportRow.rows.length) {
        res.json({ status: "NOT_AVAILABLE" as DisplayStatus });
        return;
      }

      const report        = reportRow.rows[0] as any;
      const productStatus = String(report.product_status ?? "");

      // DATA_ACCUMULATING — ENGINE이 이 analysis_status를 반환하면 서버가
      // product_status를 FAILED로 전환하고 analysis_status 컬럼에 보존한다.
      // (현재 DB enum 미지원 → FAILED + analysis_status NULL로 저장될 수 있음)
      // 향후 DB enum 확장 시 이 분기가 실제로 동작한다.
      const analysisStatus = String(report.analysis_status ?? "");
      if (analysisStatus === "DATA_ACCUMULATING") {
        res.json({
          status:        "DATA_ACCUMULATING" as DisplayStatus,
          report_id:     report.id,
          report_period: report.report_period,
          published_at:  null,
        });
        return;
      }

      const displayStatus = mapProductStatusToDisplay(productStatus);

      res.json({
        status:        displayStatus,
        report_id:     report.id,
        report_period: report.report_period,
        published_at:  displayStatus === "PUBLISHED" ? (report.published_at ?? null) : null,
      });
    } catch (e: any) {
      // 진짜 서버/DB 오류 — NOT_AVAILABLE로 숨기지 않음.
      // 정상적인 NOT_AVAILABLE 분기(비X pool, 리포트 없음)는 이미 위에서 return.
      console.error(
        "[parent-growth-report] GET /parent/students/:studentId/growth-report-status error",
        { errorType: e?.constructor?.name, message: e?.message },
      );
      res
        .status(500)
        .json({ error: "서버 오류가 발생했습니다.", code: "INTERNAL_ERROR" });
    }
  },
);

export default router;
