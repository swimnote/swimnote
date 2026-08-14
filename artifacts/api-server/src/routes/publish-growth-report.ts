/**
 * publish-growth-report.ts — GR6: APPROVED → PUBLISHED Publication Route
 *
 * Route:
 *   POST /teacher/growth-reports/:reportId/publish
 *
 * Auth:
 *   requireAuth + requireRole("pool_admin", "super_admin")
 *   teacher: APPROVE only, not PUBLISH (spec §3)
 *   parent: forbidden (spec §3)
 *
 * Pool ownership:
 *   pool_admin: must own the same pool as the report
 *   super_admin: always allowed
 *
 * Idempotency (spec §20):
 *   already PUBLISHED → 200 { success: true, alreadyPublished: true }
 *
 * Concurrency (spec §21):
 *   transitionReportStatus uses SELECT FOR UPDATE → one published_at, one transition
 *
 * Audit (spec §19):
 *   GROWTH_REPORT_PUBLISHED via transitionReportStatus → writeReportAudit
 *
 * No ENGINE call (spec §31).
 * No push (spec §18) — GR7.
 * No SNS share (spec §16) — GR9.
 */

import { Router, type Response } from "express";
import { sql } from "drizzle-orm";
import { superAdminDb } from "@workspace/db";
import {
  requireAuth,
  requireRole,
  type AuthRequest,
} from "../middlewares/auth.js";
import {
  publishGrowthReport,
  ReportNotFoundError,
  PublishNotAllowedError,
  PublishPreconditionError,
  InvalidTransitionError,
} from "../lib/growth-report-service.js";

export const publishGrowthReportRouter = Router();
export default publishGrowthReportRouter;

// ─────────────────────────────────────────────────────────────────────────────
// POST /teacher/growth-reports/:reportId/publish
// ─────────────────────────────────────────────────────────────────────────────

publishGrowthReportRouter.post(
  "/teacher/growth-reports/:reportId/publish",
  requireAuth,
  requireRole("pool_admin", "super_admin"), // teacher = APPROVE only (spec §3)
  async (req: AuthRequest, res: Response) => {
    const { reportId } = req.params;
    const { role, userId } = req.user!;

    try {
      // ── Pool ownership check (pool_admin) ─────────────────────────────────
      if (role === "pool_admin") {
        // caller's pool from token (poolId is on the JWT for pool_admin)
        const callerPool = (req.user as any).poolId as string | undefined;

        if (callerPool) {
          // Verify report belongs to caller's pool
          const reportCheck = await superAdminDb.execute(sql`
            SELECT swimming_pool_id
            FROM growth_reports
            WHERE id = ${reportId} AND deleted_at IS NULL
            LIMIT 1
          `);

          if (!reportCheck.rows.length) {
            res.status(404).json({ success: false, error: "REPORT_NOT_FOUND" });
            return;
          }

          const reportPool = (reportCheck.rows[0] as any).swimming_pool_id as string;
          if (reportPool !== callerPool) {
            res.status(403).json({ success: false, error: "POOL_MISMATCH" });
            return;
          }
        }
      }

      // ── Publish ───────────────────────────────────────────────────────────
      const result = await publishGrowthReport({
        db: superAdminDb,
        reportId,
        actorId: userId,
        actorType: role as "pool_admin" | "super_admin",
      });

      res.status(200).json({
        success: true,
        alreadyPublished: result.alreadyPublished,
        publishedAt: result.publishedAt ?? null,
      });
    } catch (err: unknown) {
      if (err instanceof ReportNotFoundError) {
        res.status(404).json({ success: false, error: "REPORT_NOT_FOUND" });
        return;
      }
      if (err instanceof PublishNotAllowedError) {
        res.status(409).json({
          success: false,
          error: "PUBLISH_NOT_ALLOWED",
          detail: (err as PublishNotAllowedError).currentStatus,
        });
        return;
      }
      if (err instanceof PublishPreconditionError) {
        res.status(422).json({
          success: false,
          error: "PRECONDITION_FAILED",
          detail: (err as PublishPreconditionError).detail,
        });
        return;
      }
      if (err instanceof InvalidTransitionError) {
        res.status(409).json({
          success: false,
          error: "INVALID_TRANSITION",
        });
        return;
      }
      console.error("[publish-growth-report] error:", err);
      res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
    }
  },
);
