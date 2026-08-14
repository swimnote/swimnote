/**
 * teacher-growth-report-review.ts — GR5: Teacher Review + Approval Workflow
 *
 * Routes:
 *   GET  /teacher/growth-reports/:reportId/review  — review read
 *   POST /teacher/growth-reports/:reportId/review  — APPROVE | REQUEST_REANALYSIS
 *
 * Auth:
 *   requireAuth + requireRole("teacher", "pool_admin", "super_admin")
 *   X Mode guard (requireReportXAccess)
 *   Parent role forbidden (spec §3)
 *
 * Teacher ownership (spec §3):
 *   teacher:    must teach a class that contains the report's student (same pool)
 *   pool_admin: same pool as report
 *   super_admin: always allowed
 *
 * Review eligibility (spec §2):
 *   Only REVIEW_REQUIRED may be reviewed.
 *   All other statuses are rejected with 409 REVIEW_NOT_ELIGIBLE.
 *
 * Actions (spec §6):
 *   APPROVE            → REVIEW_REQUIRED → APPROVED  (via transitionReportStatus)
 *   REQUEST_REANALYSIS → REVIEW_REQUIRED → ANALYZING (new request_id, GR3 worker)
 *
 * Loop protection (spec §15):
 *   teacher_reanalysis_count >= GROWTH_REPORT_MAX_TEACHER_REANALYSIS (default 3)
 *   → 429 REANALYSIS_LIMIT_EXCEEDED
 *
 * Audit events:
 *   TEACHER_REVIEW_APPROVED / TEACHER_REVIEW_REANALYSIS_REQUESTED
 *
 * No content editing (spec §10):
 *   Teacher may APPROVE or REQUEST_REANALYSIS only.
 *   summary_text / section text modification forbidden.
 */

import { Router, type Response } from "express";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { superAdminDb } from "@workspace/db";
import {
  requireAuth,
  requireRole,
  type AuthRequest,
} from "../middlewares/auth.js";
import { requireReportXAccess } from "../lib/xmode-report-guard.js";
import {
  transitionReportStatus,
  InvalidTransitionError,
  ReportNotFoundError,
} from "../lib/growth-report-service.js";
import { runGrowthReportAnalysisWorker } from "../jobs/growth-report-analysis-worker.js";

export const teacherGrowthReportReviewRouter = Router();
export default teacherGrowthReportReviewRouter;

// ── Configuration ─────────────────────────────────────────────────────────────

function getMaxTeacherReanalysis(): number {
  const raw = Number(process.env["GROWTH_REPORT_MAX_TEACHER_REANALYSIS"]);
  return raw > 0 ? raw : 3;
}

// ── Valid reason codes (spec §7) ──────────────────────────────────────────────

const VALID_REASON_CODES = new Set([
  "WRONG_CONTEXT",
  "STUDENT_ATTRIBUTION_CONCERN",
  "INSUFFICIENT_CONTEXT",
  "PARENT_VISIBILITY_CONCERN",
  "TECHNICAL_FACT_CONCERN",
  "OTHER",
]);

// ── Audit helper ─────────────────────────────────────────────────────────────

async function writeReviewAudit(params: {
  reportId: string;
  poolId: string;
  actorType: "teacher" | "pool_admin" | "super_admin";
  actorId: string;
  action: string;
  reason?: string;
}): Promise<void> {
  const { reportId, poolId, actorType, actorId, action, reason } = params;
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
        'update', ${actorType}, ${actorId}, ${poolId},
        NULL,
        ${JSON.stringify({ review_action: action })}::jsonb,
        ${reason ?? action},
        NULL, NULL, NULL
      )
    `);
  } catch (auditErr: any) {
    console.warn("[gr5-review] audit_log 기록 실패:", auditErr.message);
  }
}

// ── Teacher ownership check ────────────────────────────────────────────────────

/**
 * teacherOwnsStudent — 담당 teacher가 해당 학생을 담당하는지 확인
 *
 * 판정: class_groups WHERE teacher_user_id = $teacherId
 *        AND student current_class_id = class_group.id
 *        AND same pool
 */
async function teacherOwnsStudent(params: {
  teacherId: string;
  studentId: string;
  poolId: string;
}): Promise<boolean> {
  const { teacherId, studentId, poolId } = params;
  const res = await superAdminDb.execute(sql`
    SELECT 1
    FROM class_groups cg
    JOIN students s ON s.current_class_id = cg.id
    WHERE cg.teacher_user_id = ${teacherId}
      AND cg.swimming_pool_id = ${poolId}
      AND s.id = ${studentId}
    LIMIT 1
  `);
  if (res.rows.length > 0) return true;

  // Fallback: student_class_history 현재 수강 확인 (current_class_id 미설정 케이스)
  const histRes = await superAdminDb.execute(sql`
    SELECT 1
    FROM class_groups cg
    JOIN student_class_history sch
      ON sch.class_id = cg.id
      AND sch.student_id = ${studentId}
      AND sch.left_at IS NULL
    WHERE cg.teacher_user_id = ${teacherId}
      AND cg.swimming_pool_id = ${poolId}
    LIMIT 1
  `);
  return histRes.rows.length > 0;
}

// ── GET /teacher/growth-reports/:reportId/review ─────────────────────────────

teacherGrowthReportReviewRouter.get(
  "/teacher/growth-reports/:reportId/review",
  requireAuth,
  requireRole("super_admin", "pool_admin", "teacher"),
  requireReportXAccess,
  async (req: AuthRequest, res: Response) => {
    try {
      const reportId   = req.params["reportId"] as string;
      const role       = req.user!.role as string;
      const userId     = (req.user!.userId ?? req.user!.id) as string;
      const callerPool = (req as any).resolvedReportPoolId as string | undefined;

      // 1. Fetch report
      const rRows = await superAdminDb.execute(sql`
        SELECT
          gr.id,
          gr.student_id,
          gr.swimming_pool_id,
          gr.product_status,
          gr.analysis_status,
          gr.report_period,
          gr.report_content,
          gr.sns_summary,
          gr.selected_metrics,
          gr.positive_growth_signals,
          gr.success_conditions,
          gr.support_levers,
          gr.next_growth_targets,
          gr.next_observation_targets,
          gr.report_fact_package,
          gr.teacher_reviewed_by,
          gr.teacher_reviewed_at,
          gr.teacher_review_action,
          gr.teacher_review_reason_code,
          gr.teacher_review_note,
          COALESCE(gr.teacher_reanalysis_count, 0) AS teacher_reanalysis_count,
          gr.cycle_id,
          grc.parent_input_open_at,
          grc.parent_input_close_at
        FROM growth_reports gr
        LEFT JOIN growth_report_cycles grc ON grc.id = gr.cycle_id
        WHERE gr.id = ${reportId}
          AND gr.deleted_at IS NULL
        LIMIT 1
      `);

      if (!rRows.rows.length) {
        res.status(404).json({ success: false, error: "REPORT_NOT_FOUND" });
        return;
      }
      const report = rRows.rows[0] as any;

      // 2. Ownership check
      const reportPool = report.swimming_pool_id as string;

      if (role === "teacher") {
        // Same pool first
        if (callerPool && callerPool !== reportPool) {
          res.status(403).json({ success: false, error: "POOL_MISMATCH" });
          return;
        }
        const owns = await teacherOwnsStudent({
          teacherId: userId,
          studentId: report.student_id,
          poolId: reportPool,
        });
        if (!owns) {
          res.status(403).json({ success: false, error: "TEACHER_NOT_ASSIGNED" });
          return;
        }
      } else if (role === "pool_admin") {
        if (callerPool && callerPool !== reportPool) {
          res.status(403).json({ success: false, error: "POOL_MISMATCH" });
          return;
        }
      }
      // super_admin: always allowed

      // 3. Fetch student info
      const stuRows = await superAdminDb.execute(sql`
        SELECT id, name FROM students WHERE id = ${report.student_id} LIMIT 1
      `);
      const student = stuRows.rows[0] as any ?? { id: report.student_id, name: null };

      // 4. Response — raw ENGINE content, no re-interpretation
      res.status(200).json({
        success: true,
        report_id:    reportId,
        product_status: report.product_status,
        analysis_status: report.analysis_status,
        report_period: report.report_period,
        teacher_reviewed_by:     report.teacher_reviewed_by,
        teacher_reviewed_at:     report.teacher_reviewed_at,
        teacher_review_action:   report.teacher_review_action,
        teacher_review_reason_code: report.teacher_review_reason_code,
        teacher_review_note:     report.teacher_review_note,
        teacher_reanalysis_count: Number(report.teacher_reanalysis_count ?? 0),
        max_reanalysis:           getMaxTeacherReanalysis(),
        student: {
          id:   student.id,
          name: student.name,
        },
        report_period_open:  report.parent_input_open_at,
        report_period_close: report.parent_input_close_at,
        // ENGINE content (opaque — APP does not re-interpret)
        report_content:             report.report_content,
        sns_summary:                report.sns_summary,
        selected_metrics:           report.selected_metrics,
        positive_growth_signals:    report.positive_growth_signals,
        success_conditions:         report.success_conditions,
        support_levers:             report.support_levers,
        next_growth_targets:        report.next_growth_targets,
        next_observation_targets:   report.next_observation_targets,
        // Fact package for traceability — not fully exposed to parent
        grounding_result:   (report.report_fact_package as any)?.grounding_result ?? null,
        limitations:        (report.report_fact_package as any)?.limitations ?? null,
      });
    } catch (err: any) {
      console.error("[gr5-review-get] error:", err.message);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
      }
    }
  },
);

// ── POST /teacher/growth-reports/:reportId/review ────────────────────────────

teacherGrowthReportReviewRouter.post(
  "/teacher/growth-reports/:reportId/review",
  requireAuth,
  requireRole("super_admin", "pool_admin", "teacher"),
  requireReportXAccess,
  async (req: AuthRequest, res: Response) => {
    try {
      const reportId   = req.params["reportId"] as string;
      const role       = req.user!.role as string;
      const userId     = (req.user!.userId ?? req.user!.id) as string;
      const callerPool = (req as any).resolvedReportPoolId as string | undefined;

      const { action, reason_code, note } = req.body as {
        action?:      string;
        reason_code?: string;
        note?:        string;
      };

      // 1. Validate action
      if (!action || !["APPROVE", "REQUEST_REANALYSIS"].includes(action)) {
        res.status(400).json({
          success: false,
          error: "INVALID_ACTION",
          allowed: ["APPROVE", "REQUEST_REANALYSIS"],
        });
        return;
      }

      // 2. Validate reason_code for REQUEST_REANALYSIS
      if (action === "REQUEST_REANALYSIS") {
        if (reason_code && !VALID_REASON_CODES.has(reason_code)) {
          res.status(400).json({
            success: false,
            error: "INVALID_REASON_CODE",
            allowed: [...VALID_REASON_CODES],
          });
          return;
        }
      }

      // 3. Fetch report
      const rRows = await superAdminDb.execute(sql`
        SELECT
          id, student_id, swimming_pool_id, product_status, deleted_at,
          COALESCE(teacher_reanalysis_count, 0) AS teacher_reanalysis_count
        FROM growth_reports
        WHERE id = ${reportId}
          AND deleted_at IS NULL
        LIMIT 1
      `);

      if (!rRows.rows.length) {
        res.status(404).json({ success: false, error: "REPORT_NOT_FOUND" });
        return;
      }
      const report = rRows.rows[0] as any;
      const reportPool = report.swimming_pool_id as string;

      // 4. Ownership check
      if (role === "teacher") {
        if (callerPool && callerPool !== reportPool) {
          res.status(403).json({ success: false, error: "POOL_MISMATCH" });
          return;
        }
        const owns = await teacherOwnsStudent({
          teacherId: userId,
          studentId: report.student_id,
          poolId: reportPool,
        });
        if (!owns) {
          res.status(403).json({ success: false, error: "TEACHER_NOT_ASSIGNED" });
          return;
        }
      } else if (role === "pool_admin") {
        if (callerPool && callerPool !== reportPool) {
          res.status(403).json({ success: false, error: "POOL_MISMATCH" });
          return;
        }
      }

      // 5. Review eligibility — only REVIEW_REQUIRED
      if (report.product_status !== "REVIEW_REQUIRED") {
        res.status(409).json({
          success: false,
          error: "REVIEW_NOT_ELIGIBLE",
          product_status: report.product_status,
          message: "Review action is only allowed when product_status is REVIEW_REQUIRED",
        });
        return;
      }

      // 6. Loop protection for REQUEST_REANALYSIS
      const reanalysisCount = Number(report.teacher_reanalysis_count ?? 0);
      const maxReanalysis   = getMaxTeacherReanalysis();

      if (action === "REQUEST_REANALYSIS" && reanalysisCount >= maxReanalysis) {
        res.status(429).json({
          success: false,
          error: "REANALYSIS_LIMIT_EXCEEDED",
          teacher_reanalysis_count: reanalysisCount,
          max_reanalysis: maxReanalysis,
        });
        return;
      }

      // ── APPROVE ──────────────────────────────────────────────────────────────
      if (action === "APPROVE") {
        // Save review metadata
        await superAdminDb.execute(sql`
          UPDATE growth_reports
          SET
            teacher_reviewed_by       = ${userId},
            teacher_reviewed_at       = now(),
            teacher_review_action     = 'APPROVE',
            teacher_review_reason_code = ${reason_code ?? null},
            teacher_review_note       = ${note ?? null},
            updated_at                = now()
          WHERE id = ${reportId}
            AND deleted_at IS NULL
        `);

        // Transition: REVIEW_REQUIRED → APPROVED
        await transitionReportStatus({
          db:        superAdminDb,
          reportId,
          toStatus:  "APPROVED",
          actorType: role as "teacher" | "pool_admin" | "super_admin",
          actorId:   userId,
          reason:    "TEACHER_REVIEW_APPROVED",
        });

        await writeReviewAudit({
          reportId,
          poolId:    reportPool,
          actorType: role as "teacher" | "pool_admin" | "super_admin",
          actorId:   userId,
          action:    "TEACHER_REVIEW_APPROVED",
        });

        console.log(`[gr5-review] APPROVED: report=${reportId} by=${userId}`);
        res.status(200).json({
          success:        true,
          product_status: "APPROVED",
          review_action:  "APPROVE",
          teacher_reviewed_by: userId,
          teacher_reviewed_at: new Date().toISOString(),
        });
        return;
      }

      // ── REQUEST_REANALYSIS ────────────────────────────────────────────────────
      if (action === "REQUEST_REANALYSIS") {
        const newRequestId = `grre_${randomUUID().replace(/-/g, "")}`;

        // Serialize teacher_review for ENGINE snapshot (backward-compatible string field)
        const teacherReviewPayload = JSON.stringify({
          reason_code: reason_code ?? "OTHER",
          note:        note ?? null,
        });

        // Save review metadata + new request_id + reset retry count
        await superAdminDb.execute(sql`
          UPDATE growth_reports
          SET
            teacher_reviewed_by         = ${userId},
            teacher_reviewed_at         = now(),
            teacher_review_action       = 'REQUEST_REANALYSIS',
            teacher_review_reason_code  = ${reason_code ?? null},
            teacher_review_note         = ${note ?? null},
            teacher_reanalysis_count    = COALESCE(teacher_reanalysis_count, 0) + 1,
            analysis_request_id         = ${newRequestId},
            analysis_retry_count        = 0,
            updated_at                  = now()
          WHERE id = ${reportId}
            AND deleted_at IS NULL
        `);

        // Transition: REVIEW_REQUIRED → ANALYZING
        // (GR3 worker will pick this up if it polls ANALYZING — or fire directly)
        await transitionReportStatus({
          db:        superAdminDb,
          reportId,
          toStatus:  "ANALYZING",
          actorType: role as "teacher" | "pool_admin" | "super_admin",
          actorId:   userId,
          reason:    `TEACHER_REVIEW_REANALYSIS_REQUESTED:${reason_code ?? "OTHER"}`,
          requestId: newRequestId,
        });

        await writeReviewAudit({
          reportId,
          poolId:    reportPool,
          actorType: role as "teacher" | "pool_admin" | "super_admin",
          actorId:   userId,
          action:    "TEACHER_REVIEW_REANALYSIS_REQUESTED",
          reason:    `reason_code=${reason_code ?? "OTHER"}`,
        });

        console.log(
          `[gr5-review] REANALYSIS_REQUESTED: report=${reportId}` +
          ` by=${userId} reason=${reason_code} new_request_id=${newRequestId}`,
        );

        // Fire GR3 worker asynchronously (new ANALYZING report will be picked up)
        setImmediate(async () => {
          try {
            await runGrowthReportAnalysisWorker(superAdminDb);
          } catch (workerErr: any) {
            console.error("[gr5-review] async worker error:", workerErr.message);
          }
        });

        res.status(200).json({
          success:                    true,
          product_status:             "ANALYZING",
          review_action:              "REQUEST_REANALYSIS",
          teacher_review_reason_code: reason_code ?? null,
          teacher_reanalysis_count:   reanalysisCount + 1,
          analysis_request_id:        newRequestId,
          message:                    "재분석이 요청되었습니다. GR3 분석 워커가 처리합니다.",
        });
        return;
      }
    } catch (err: any) {
      if (err.name === "InvalidTransitionError") {
        res.status(409).json({ success: false, error: "REVIEW_NOT_ELIGIBLE", message: err.message });
        return;
      }
      if (err.name === "ReportNotFoundError") {
        res.status(404).json({ success: false, error: "REPORT_NOT_FOUND" });
        return;
      }
      console.error("[gr5-review-post] error:", err.message);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
      }
    }
  },
);
