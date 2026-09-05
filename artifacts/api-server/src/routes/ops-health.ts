/**
 * routes/ops-health.ts — WP9 Operational Health Endpoints
 *
 * GET /api/ops-health/detail — Super Admin 전용 상세 health state
 *   (5xx count, worker status, queue counts, RC failures 등)
 * GET /api/health 또는 /api/healthz — 기존 public endpoint (변경 없음, 재노출만)
 *
 * 민감한 운영 정보는 Super Admin auth 보호.
 * Public health는 기존 routes/health.ts 그대로.
 */
import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import {
  getSystemHealth,
  checkDb,
  check5xxSpike,
  checkPushFanout,
  checkRevenueCat,
  checkGrowthWorkers,
  checkWorkers,
  THRESHOLDS,
} from "../lib/monitoring.js";
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

// ── GET /super/ops-health/detail — Super Admin 전용 ──────────────────────────

router.get(
  "/super/ops-health/detail",
  requireAuth,
  requireRole("super_admin"),
  async (_req: AuthRequest, res) => {
    try {
      // 모든 체크 병렬
      const [db, fiveXx, push, rc, growth, workers] = await Promise.all([
        checkDb(),
        check5xxSpike(),
        checkPushFanout(),
        checkRevenueCat(),
        checkGrowthWorkers(),
        checkWorkers(),
      ]);

      // 최근 ops_alerts (최근 20건)
      let recentAlerts: any[] = [];
      try {
        const ar = await superAdminDb.execute(sql`
          SELECT id, type, title, message, severity, created_at::text
          FROM ops_alerts
          ORDER BY created_at DESC
          LIMIT 20
        `);
        recentAlerts = ar.rows as any[];
      } catch { /* 무시 */ }

      const checkedAt = new Date().toISOString();

      // overall: RED if any FAIL, YELLOW if any DEGRADED
      const statuses = [db.status, push.status, rc.status, growth.status, workers.status];
      const overallStatus =
        fiveXx.spikeDetected || statuses.includes("FAIL") ? "RED" :
        statuses.includes("DEGRADED") ? "YELLOW" : "GREEN";

      res.json({
        overallStatus,
        api: {
          status: db.status === "FAIL" ? "FAIL" : fiveXx.spikeDetected ? "DEGRADED" : "OK",
          fiveXxCount5min:  fiveXx.count5min,
          fiveXxCount15min: fiveXx.count15min,
          threshold5min:    THRESHOLDS.fiveXxSpike5min,
          threshold15min:   THRESHOLDS.fiveXxSpike15min,
          spikeDetected:    fiveXx.spikeDetected,
          checkedAt,
        },
        db: {
          ...db,
          query: "SELECT 1",
        },
        push: {
          ...push,
          staleThresholdMs: THRESHOLDS.pushStaleMs,
        },
        revenuecat: rc,
        growth: {
          ...growth,
          batchStaleThresholdMs:    THRESHOLDS.growthBatchStaleMs,
          analysisStaleThresholdMs: THRESHOLDS.growthAnalysisStaleMs,
        },
        workers,
        recentAlerts,
        checkedAt,
        monitorIntervalMs: THRESHOLDS.pollIntervalMs,
        alertCooldownMs:   THRESHOLDS.alertCooldownMs,
      });
    } catch (e: any) {
      res.status(500).json({
        overallStatus: "RED",
        error: "health 체크 실패",
        checkedAt: new Date().toISOString(),
      });
    }
  }
);

// ── GET /super/ops-health/incidents — 최근 incidents (Super Admin) ────────────

router.get(
  "/super/ops-health/incidents",
  requireAuth,
  requireRole("super_admin"),
  async (_req: AuthRequest, res) => {
    try {
      const r = await superAdminDb.execute(sql`
        SELECT id, type, title, message, severity, created_at::text, dedupe_key
        FROM ops_alerts
        WHERE type LIKE 'incident:%' OR type LIKE 'resolved:%'
        ORDER BY created_at DESC
        LIMIT 50
      `);
      res.json({ incidents: r.rows });
    } catch (e: any) {
      res.status(500).json({ error: "incidents 조회 실패" });
    }
  }
);

// ── GET /super/ops-health (요약) ──────────────────────────────────────────────

router.get(
  "/super/ops-health",
  requireAuth,
  requireRole("super_admin"),
  async (_req: AuthRequest, res) => {
    try {
      const snapshot = await getSystemHealth();
      res.json({
        overallStatus: snapshot.overallStatus,
        api:        { status: snapshot.api.status,        checkedAt: snapshot.api.checkedAt },
        db:         { status: snapshot.db.status,         detail: snapshot.db.detail,     checkedAt: snapshot.db.checkedAt },
        push:       { status: snapshot.push.status,       checkedAt: snapshot.push.checkedAt },
        revenuecat: { status: snapshot.revenuecat.status, checkedAt: snapshot.revenuecat.checkedAt },
        growth:     { status: snapshot.growth.status,     checkedAt: snapshot.growth.checkedAt },
        workers:    { status: snapshot.workers.status,    checkedAt: snapshot.workers.checkedAt },
        checkedAt:  snapshot.checkedAt,
      });
    } catch {
      res.status(500).json({ overallStatus: "RED", checkedAt: new Date().toISOString() });
    }
  }
);

export default router;
