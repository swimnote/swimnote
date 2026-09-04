/**
 * admin-growth-report-production.ts — WP8: Admin Production Routes
 *
 * 보안:
 *   - 모든 엔드포인트: requireAuth + requireRole('pool_admin')
 *   - poolId: JWT에서 파싱 (pool_admin token scope)
 *   - cross-pool 접근: 서비스 함수 내부에서 swimming_pool_id = poolId 검증
 *
 * 엔드포인트:
 *   GET  /admin/growth-reports/batch-status          — batch job 현황
 *   GET  /admin/growth-reports/monthly-summary       — pool 월별 요약 (KPI bar)
 *   GET  /admin/growth-reports/monthly-list          — 학생별 목록 (최신 version)
 *   PUT  /admin/growth-reports/:id/discard           — 폐기 (READY_TO_SEND → DISCARDED)
 *   POST /admin/growth-reports/:id/regenerate        — 재발급 (DISCARDED → new REGENERATING)
 *   POST /admin/growth-reports/:id/send              — 개별 발송 (READY_TO_SEND → PUBLISHED)
 *   POST /admin/growth-reports/bulk-send             — 일괄 발송 (pool year/month)
 *   POST /admin/growth-reports/trigger-batch         — 수동 배치 트리거 (super_admin only)
 */

import { Router }               from "express";
import { superAdminDb }         from "@workspace/db";
import { sql }                  from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import {
  discardReportVersion,
  regenerateReport,
  sendIndividualReport,
  bulkSendReports,
  getMonthlyReportSummary,
  refreshWp8Snapshot,
  DISCARD_REASONS,
}                               from "../lib/growth-report-production-service.js";
import { runMonthlyBatchCron }  from "../jobs/growth-report-batch-worker.js";

const db = superAdminDb;

const router = Router();

// ─── helper ──────────────────────────────────────────────────────────────────

function parsePoolAdmin(req: AuthRequest): string | null {
  // pool_admin 역할 보유 + poolId 파악
  const user = req.user;
  if (!user) return null;
  return user.poolId ?? null;
}

function parseSuperAdmin(req: AuthRequest): boolean {
  return req.user?.role === "super_admin";
}

// ─── GET /admin/growth-reports/batch-status ──────────────────────────────────

router.get(
  "/batch-status",
  requireAuth,
  requireRole("pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = parsePoolAdmin(req);
      if (!poolId) return res.status(403).json({ error: "pool_admin 전용" });

      const year  = req.query["year"]  ? parseInt(String(req.query["year"]),  10) : new Date().getFullYear();
      const month = req.query["month"] ? parseInt(String(req.query["month"]), 10) : new Date().getMonth() + 1;

      const r = await db.execute(sql`
        SELECT
          id, swimming_pool_id, year, month, job_type,
          status, target_count, completed_count, failed_count, attempts,
          started_at, completed_at, admin_push_sent_at,
          created_at, updated_at
        FROM growth_report_batch_jobs
        WHERE swimming_pool_id = ${poolId}
          AND year  = ${year}
          AND month = ${month}
          AND job_type = 'MONTHLY_AUTO'
        LIMIT 1
      `);

      if (!r.rows.length) {
        return res.json({ exists: false, year, month, pool_id: poolId });
      }

      return res.json({ exists: true, job: r.rows[0] });
    } catch (err: any) {
      console.error("[WP8] batch-status error:", err.message);
      return res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ─── GET /admin/growth-reports/monthly-summary ───────────────────────────────

router.get(
  "/monthly-summary",
  requireAuth,
  requireRole("pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = parsePoolAdmin(req);
      if (!poolId) return res.status(403).json({ error: "pool_admin 전용" });

      const year  = req.query["year"]  ? parseInt(String(req.query["year"]),  10) : new Date().getFullYear();
      const month = req.query["month"] ? parseInt(String(req.query["month"]), 10) : new Date().getMonth() + 1;

      const summary = await getMonthlyReportSummary(db, { poolId, year, month });
      return res.json(summary);
    } catch (err: any) {
      console.error("[WP8] monthly-summary error:", err.message);
      return res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ─── GET /admin/growth-reports/monthly-list ──────────────────────────────────

router.get(
  "/monthly-list",
  requireAuth,
  requireRole("pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = parsePoolAdmin(req);
      if (!poolId) return res.status(403).json({ error: "pool_admin 전용" });

      const year  = req.query["year"]  ? parseInt(String(req.query["year"]),  10) : new Date().getFullYear();
      const month = req.query["month"] ? parseInt(String(req.query["month"]), 10) : new Date().getMonth() + 1;
      const limit  = Math.min(parseInt(String(req.query["limit"]  ?? "100"), 10), 200);
      const offset = parseInt(String(req.query["offset"] ?? "0"), 10);
      const q      = req.query["q"] ? String(req.query["q"]).trim() : null;

      const prevMonth = month === 1 ? 12 : month - 1;
      const prevYear  = month === 1 ? year - 1 : year;
      const period    = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;

      // 최신 version 기준 학생별 1개 리포트 조회
      const rows = await db.execute(sql`
        WITH latest AS (
          SELECT DISTINCT ON (gr.student_id, gr.cycle_id)
            gr.id, gr.student_id, gr.cycle_id,
            gr.product_status, gr.version_number,
            gr.discarded_at, gr.discard_reason, gr.discarded_by,
            gr.created_at, gr.updated_at, gr.published_at,
            gr.period_start, gr.period_end,
            gr.report_period, gr.report_content
          FROM growth_reports gr
          WHERE gr.swimming_pool_id = ${poolId}
            AND gr.report_period    = ${period}
            AND gr.deleted_at IS NULL
            AND gr.cycle_id IS NOT NULL
          ORDER BY gr.student_id, gr.cycle_id, gr.version_number DESC NULLS LAST, gr.created_at DESC
        )
        SELECT
          l.id                AS report_id,
          l.student_id,
          s.name              AS student_name,
          l.product_status,
          l.version_number,
          l.discard_reason,
          l.discarded_at,
          l.period_start,
          l.period_end,
          l.report_period,
          l.published_at,
          l.updated_at,
          -- snippet for preview
          SUBSTRING(l.report_content::text, 1, 100) AS content_snippet
        FROM latest l
        JOIN students s ON s.id = l.student_id
        WHERE l.product_status != 'NOT_OPEN'
          ${q ? sql`AND s.name ILIKE ${'%' + q + '%'}` : sql``}
        ORDER BY s.name ASC
        LIMIT ${limit} OFFSET ${offset}
      `);

      const total = await db.execute(sql`
        WITH latest AS (
          SELECT DISTINCT ON (gr.student_id, gr.cycle_id)
            gr.student_id, gr.product_status
          FROM growth_reports gr
          WHERE gr.swimming_pool_id = ${poolId}
            AND gr.report_period    = ${period}
            AND gr.deleted_at IS NULL
            AND gr.cycle_id IS NOT NULL
          ORDER BY gr.student_id, gr.cycle_id, gr.version_number DESC NULLS LAST, gr.created_at DESC
        )
        SELECT COUNT(*) AS cnt FROM latest
        WHERE product_status != 'NOT_OPEN'
      `);

      return res.json({
        year, month, period,
        total: Number((total.rows[0] as any)?.cnt ?? 0),
        limit, offset,
        items: rows.rows,
      });
    } catch (err: any) {
      console.error("[WP8] monthly-list error:", err.message);
      return res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ─── PUT /admin/growth-reports/:id/discard ───────────────────────────────────

router.put(
  "/:id/discard",
  requireAuth,
  requireRole("pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = parsePoolAdmin(req);
      if (!poolId) return res.status(403).json({ error: "pool_admin 전용" });

      const reportId = req.params["id"];
      const { reason, memo } = req.body as { reason?: string; memo?: string };

      if (!reason || !DISCARD_REASONS.includes(reason as any)) {
        return res.status(400).json({
          error: `reason 필수. 허용값: ${DISCARD_REASONS.join(", ")}`,
        });
      }

      await discardReportVersion(db, {
        reportId,
        poolId,
        actorId: req.user!.id ?? "unknown",
        reason,
        memo,
      });

      // KPI refresh (background)
      const kstNow   = new Date(Date.now() + 9 * 3600 * 1000);
      const kstYear  = kstNow.getUTCFullYear();
      const kstMonth = kstNow.getUTCMonth() + 1;
      void refreshWp8Snapshot(db, { poolId, year: kstYear, month: kstMonth }).catch(() => {});

      return res.json({ ok: true });
    } catch (err: any) {
      if (err?.code === "DISCARD_NOT_ALLOWED") return res.status(409).json({ error: err.message });
      if (err?.name === "ReportNotFoundError") return res.status(404).json({ error: err.message });
      console.error("[WP8] discard error:", err.message);
      return res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ─── POST /admin/growth-reports/:id/regenerate ───────────────────────────────

router.post(
  "/:id/regenerate",
  requireAuth,
  requireRole("pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = parsePoolAdmin(req);
      if (!poolId) return res.status(403).json({ error: "pool_admin 전용" });

      const reportId = req.params["id"];

      const result = await regenerateReport(db, {
        discardedReportId: reportId,
        poolId,
        actorId: req.user!.id ?? "unknown",
      });

      return res.status(201).json({
        ok: true,
        new_report_id:  result.newReportId,
        version_number: result.versionNumber,
      });
    } catch (err: any) {
      if (err?.code === "REGEN_NOT_ALLOWED")  return res.status(409).json({ error: err.message });
      if (err?.code === "REGEN_DUPLICATE")    return res.status(409).json({ error: err.message });
      if (err?.name === "ReportNotFoundError") return res.status(404).json({ error: err.message });
      console.error("[WP8] regenerate error:", err.message);
      return res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ─── POST /admin/growth-reports/:id/send ─────────────────────────────────────

router.post(
  "/:id/send",
  requireAuth,
  requireRole("pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = parsePoolAdmin(req);
      if (!poolId) return res.status(403).json({ error: "pool_admin 전용" });

      const reportId = req.params["id"];

      const result = await sendIndividualReport(db, {
        reportId,
        poolId,
        actorId: req.user!.id ?? "unknown",
      });

      // KPI refresh (background)
      const kstNow   = new Date(Date.now() + 9 * 3600 * 1000);
      const kstYear  = kstNow.getUTCFullYear();
      const kstMonth = kstNow.getUTCMonth() + 1;
      void refreshWp8Snapshot(db, { poolId, year: kstYear, month: kstMonth }).catch(() => {});

      return res.json({ ok: true, already_published: result.alreadyPublished });
    } catch (err: any) {
      if (err?.code === "SEND_NOT_ALLOWED")   return res.status(409).json({ error: err.message });
      if (err?.name === "ReportNotFoundError") return res.status(404).json({ error: err.message });
      console.error("[WP8] send error:", err.message);
      return res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ─── POST /admin/growth-reports/bulk-send ────────────────────────────────────

router.post(
  "/bulk-send",
  requireAuth,
  requireRole("pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = parsePoolAdmin(req);
      if (!poolId) return res.status(403).json({ error: "pool_admin 전용" });

      const { year, month } = req.body as { year?: number; month?: number };

      const kstNow   = new Date(Date.now() + 9 * 3600 * 1000);
      const targetYear  = year  ?? kstNow.getUTCFullYear();
      const targetMonth = month ?? (kstNow.getUTCMonth() + 1);

      const result = await bulkSendReports(db, {
        poolId,
        year:    targetYear,
        month:   targetMonth,
        actorId: req.user!.id ?? "unknown",
      });

      // KPI refresh (background)
      void refreshWp8Snapshot(db, { poolId, year: targetYear, month: targetMonth }).catch(() => {});

      return res.json({ ok: true, ...result });
    } catch (err: any) {
      console.error("[WP8] bulk-send error:", err.message);
      return res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ─── POST /admin/growth-reports/trigger-batch  (super_admin only) ────────────

router.post(
  "/trigger-batch",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      // 즉시 월별 배치 cron 수동 실행
      void runMonthlyBatchCron(db).catch((e: unknown) => {
        console.error("[WP8] trigger-batch error:", e);
      });
      return res.json({ ok: true, message: "배치 트리거됨 (백그라운드 실행)" });
    } catch (err: any) {
      console.error("[WP8] trigger-batch error:", err.message);
      return res.status(500).json({ error: "서버 오류" });
    }
  }
);

export default router;
