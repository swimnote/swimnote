/**
 * growth-report-analyze.ts
 *
 * POST /growth-reports/:id/analyze
 *
 * Triggers ENGINE analysis for a single report.
 * The actual analysis runs asynchronously (fire-and-forget after validation).
 *
 * Auth:
 *   requireAuth + requireRole("pool_admin", "teacher", "super_admin")
 *   X Mode guard (requireReportXAccess from GR1)
 *   Ownership: report must belong to the caller's pool
 *
 * Role policy:
 *   pool_admin, teacher, super_admin may trigger analysis.
 *   parent_account may NOT call this endpoint directly (§36).
 *   The background worker is the primary driver; this endpoint is for
 *   manual re-trigger (e.g. after a parent submits answers).
 *
 * Concurrency:
 *   transitionReportStatus uses FOR UPDATE internally — duplicate triggers
 *   on the same report result in InvalidTransitionError (second trigger skipped).
 *
 * Response:
 *   202 Accepted — analysis started asynchronously
 *   409 Conflict — report not in analysable status
 *   403 Forbidden — X mode not active / wrong pool
 */

import { Router, type Response } from "express";
import { sql } from "drizzle-orm";
import { db, superAdminDb } from "@workspace/db";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { requireReportXAccess } from "../lib/xmode-report-guard.js";
import { runGrowthReportAnalysisWorker } from "../jobs/growth-report-analysis-worker.js";

export const growthReportAnalyzeRouter = Router();

// ─── POST /growth-reports/:id/analyze ────────────────────────────────────────

growthReportAnalyzeRouter.post(
  "/growth-reports/:id/analyze",
  requireAuth,
  requireRole("super_admin", "pool_admin", "teacher"),
  requireReportXAccess,
  async (req: AuthRequest, res: Response) => {
    try {
      const reportId = req.params["id"] as string;
      const role     = req.user?.role as string;
      const userId   = req.user?.id   as string;

      // Resolve caller's pool (super_admin uses report's pool)
      let callerPoolId: string | null = null;
      if (role !== "super_admin") {
        const poolRows = await db.execute(sql`
          SELECT swimming_pool_id FROM users WHERE id = ${userId} LIMIT 1
        `);
        callerPoolId = (poolRows.rows as any[])[0]?.swimming_pool_id as string ?? null;
        if (!callerPoolId) {
          res.status(403).json({ error: "POOL_NOT_FOUND" });
          return;
        }
      }

      // Fetch report
      const reportRows = await superAdminDb.execute(sql`
        SELECT id, product_status, swimming_pool_id, deleted_at
        FROM growth_reports
        WHERE id = ${reportId}
          AND deleted_at IS NULL
        LIMIT 1
      `);
      const report = (reportRows.rows as any[])[0];
      if (!report) {
        res.status(404).json({ error: "REPORT_NOT_FOUND" });
        return;
      }

      // Ownership check for non-super_admin
      if (callerPoolId && report.swimming_pool_id !== callerPoolId) {
        res.status(403).json({ error: "POOL_MISMATCH" });
        return;
      }

      // Status check — must be OPEN or READY_FOR_ANALYSIS to trigger analysis
      const analysableStatuses = new Set(["OPEN", "READY_FOR_ANALYSIS", "FAILED"]);
      if (!analysableStatuses.has(report.product_status as string)) {
        res.status(409).json({
          error:          "REPORT_NOT_ANALYSABLE",
          product_status: report.product_status,
        });
        return;
      }

      // Accept immediately — analysis runs asynchronously
      res.status(202).json({
        message:    "Analysis started",
        report_id:  reportId,
        product_status: report.product_status,
      });

      // Fire-and-forget — worker handles concurrency + error handling
      setImmediate(async () => {
        try {
          await runGrowthReportAnalysisWorker(superAdminDb);
        } catch (workerErr: any) {
          console.error("[gr3-analyze] async worker error:", workerErr.message);
        }
      });
    } catch (err: any) {
      console.error("[gr3-analyze] route error:", err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: "INTERNAL_ERROR" });
      }
    }
  },
);
