/**
 * AI01-08 — Super Admin AI Cost Overview API (read-only)
 *
 * GET /super/ai-cost-overview
 *
 * 데이터 원천: event_logs (category='AI' | 'EXTERNAL_USAGE')
 * 외부 provider API 호출 없음. local DB SQL aggregate 전용.
 *
 * 응답 구조:
 *   generated_at
 *   today   { period_start, period_end, summary, by_trigger_type, by_feature, by_provider_service_model, by_pool }
 *   month   { ... }
 */

import { Router }                    from "express";
import { sql }                        from "drizzle-orm";
import { superAdminDb }               from "@workspace/db";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";

const router = Router();

// ── Period helpers (UTC+9 / Asia/Seoul) ──────────────────────────────────────

/**
 * Returns period start/end ISO strings using PostgreSQL AT TIME ZONE
 * so the DB handles DST correctly without a Node.js timezone library.
 *
 * today_start : midnight today  KST expressed as UTC
 * month_start : first day of this month 00:00 KST as UTC
 * now         : current UTC timestamp
 */
async function fetchPeriodBounds(): Promise<{
  todayStart:  string;
  monthStart:  string;
  now:         string;
}> {
  const res = await superAdminDb.execute(sql`
    SELECT
      (date_trunc('day',  NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')::timestamptz AS today_start,
      (date_trunc('month', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')::timestamptz AS month_start,
      NOW() AS now
  `);
  const row = (res as any).rows?.[0] ?? (res as any)[0];
  return {
    todayStart: new Date(row.today_start).toISOString(),
    monthStart: new Date(row.month_start).toISOString(),
    now:        new Date(row.now).toISOString(),
  };
}

// ── SQL aggregate helpers ────────────────────────────────────────────────────

/**
 * Summary aggregate for a given time window.
 * All heavy lifting done in DB with COUNT/SUM + FILTER + JSONB operators.
 */
async function querySummary(start: string, end: string) {
  const res = await superAdminDb.execute(sql`
    SELECT
      COUNT(*)::int                                                                                AS total_events,
      COALESCE(SUM((metadata->>'logical_request_count')::numeric), 0)::numeric                   AS logical_requests,
      COALESCE(SUM(
        CASE WHEN metadata ? 'actual_call_count'
             THEN (metadata->>'actual_call_count')::numeric ELSE NULL END
      ), 0)::numeric                                                                              AS actual_calls_known,
      COUNT(*) FILTER (WHERE NOT (metadata ? 'actual_call_count'))::int                          AS actual_calls_unknown_events,
      COALESCE(SUM((metadata->>'retry_count')::numeric), 0)::numeric                             AS retries,
      COALESCE(SUM(
        CASE WHEN metadata ? 'estimated_cost_usd'
              AND (metadata->>'cost_source') IS DISTINCT FROM 'UNKNOWN'
             THEN (metadata->>'estimated_cost_usd')::numeric ELSE NULL END
      ), 0)::numeric                                                                              AS known_cost_usd,
      COUNT(*) FILTER (
        WHERE NOT (metadata ? 'estimated_cost_usd')
           OR (metadata->>'estimated_cost_usd') IS NULL
           OR (metadata->>'cost_source') = 'UNKNOWN'
      )::int                                                                                       AS unknown_cost_calls,
      COUNT(*) FILTER (WHERE (metadata->>'success')::boolean = TRUE)::int                        AS success_count,
      COUNT(*) FILTER (WHERE (metadata->>'success')::boolean = FALSE)::int                       AS failure_count
    FROM event_logs
    WHERE category IN ('AI', 'EXTERNAL_USAGE')
      AND created_at >= ${start}::timestamptz
      AND created_at <  ${end}::timestamptz
  `);
  const row = (res as any).rows?.[0] ?? (res as any)[0] ?? {};
  return {
    total_events:               toInt(row.total_events),
    logical_requests:           toNum(row.logical_requests),
    actual_calls_known:         toNum(row.actual_calls_known),
    actual_calls_unknown_events:toInt(row.actual_calls_unknown_events),
    retries:                    toNum(row.retries),
    known_cost_usd:             toNum(row.known_cost_usd),
    unknown_cost_calls:         toInt(row.unknown_cost_calls),
    success_count:              toInt(row.success_count),
    failure_count:              toInt(row.failure_count),
  };
}

/**
 * Breakdown by trigger_type.
 */
async function queryByTrigger(start: string, end: string) {
  const res = await superAdminDb.execute(sql`
    SELECT
      COALESCE(metadata->>'trigger_type', 'UNKNOWN')                                             AS trigger_type,
      COALESCE(SUM((metadata->>'logical_request_count')::numeric), 0)::numeric                   AS logical_requests,
      COALESCE(SUM(
        CASE WHEN metadata ? 'actual_call_count'
             THEN (metadata->>'actual_call_count')::numeric ELSE NULL END
      ), 0)::numeric                                                                              AS actual_calls_known,
      COALESCE(SUM(
        CASE WHEN metadata ? 'estimated_cost_usd'
              AND (metadata->>'cost_source') IS DISTINCT FROM 'UNKNOWN'
             THEN (metadata->>'estimated_cost_usd')::numeric ELSE NULL END
      ), 0)::numeric                                                                              AS known_cost_usd,
      COUNT(*) FILTER (
        WHERE NOT (metadata ? 'estimated_cost_usd')
           OR (metadata->>'estimated_cost_usd') IS NULL
           OR (metadata->>'cost_source') = 'UNKNOWN'
      )::int                                                                                       AS unknown_cost_calls
    FROM event_logs
    WHERE category IN ('AI', 'EXTERNAL_USAGE')
      AND created_at >= ${start}::timestamptz
      AND created_at <  ${end}::timestamptz
    GROUP BY 1
    ORDER BY known_cost_usd DESC
  `);
  const rows = (res as any).rows ?? (res as any) ?? [];
  return rows.map((r: any) => ({
    trigger_type:       r.trigger_type,
    logical_requests:   toNum(r.logical_requests),
    actual_calls_known: toNum(r.actual_calls_known),
    known_cost_usd:     toNum(r.known_cost_usd),
    unknown_cost_calls: toInt(r.unknown_cost_calls),
  }));
}

/**
 * Breakdown by feature — with unit economics computed in DB for accuracy.
 */
async function queryByFeature(start: string, end: string) {
  const res = await superAdminDb.execute(sql`
    SELECT
      COALESCE(metadata->>'feature', 'UNKNOWN')                                                  AS feature,
      COUNT(*)::int                                                                               AS total_events,
      COALESCE(SUM((metadata->>'logical_request_count')::numeric), 0)::numeric                   AS logical_requests,
      COALESCE(SUM(
        CASE WHEN metadata ? 'actual_call_count'
             THEN (metadata->>'actual_call_count')::numeric ELSE NULL END
      ), 0)::numeric                                                                              AS actual_calls_known,
      COUNT(*) FILTER (WHERE NOT (metadata ? 'actual_call_count'))::int                          AS actual_calls_unknown_events,
      COALESCE(SUM((metadata->>'retry_count')::numeric), 0)::numeric                             AS retries,
      COALESCE(SUM(
        CASE WHEN metadata ? 'estimated_cost_usd'
              AND (metadata->>'cost_source') IS DISTINCT FROM 'UNKNOWN'
             THEN (metadata->>'estimated_cost_usd')::numeric ELSE NULL END
      ), 0)::numeric                                                                              AS known_cost_usd,
      COUNT(*) FILTER (
        WHERE NOT (metadata ? 'estimated_cost_usd')
           OR (metadata->>'estimated_cost_usd') IS NULL
           OR (metadata->>'cost_source') = 'UNKNOWN'
      )::int                                                                                       AS unknown_cost_calls,
      COUNT(*) FILTER (WHERE (metadata->>'success')::boolean = TRUE)::int                        AS success_count,
      COUNT(*) FILTER (WHERE (metadata->>'success')::boolean = FALSE)::int                       AS failure_count
    FROM event_logs
    WHERE category IN ('AI', 'EXTERNAL_USAGE')
      AND created_at >= ${start}::timestamptz
      AND created_at <  ${end}::timestamptz
    GROUP BY 1
    ORDER BY known_cost_usd DESC
  `);
  const rows = (res as any).rows ?? (res as any) ?? [];
  return rows.map((r: any) => {
    const knownCost    = toNum(r.known_cost_usd);
    const logicalReqs  = toNum(r.logical_requests);
    const actualCalls  = toNum(r.actual_calls_known);
    const unknownCalls = toInt(r.actual_calls_unknown_events);
    return {
      feature:                           r.feature,
      total_events:                      toInt(r.total_events),
      logical_requests:                  logicalReqs,
      actual_calls_known:                actualCalls,
      actual_calls_unknown_events:       unknownCalls,
      retries:                           toNum(r.retries),
      known_cost_usd:                    knownCost,
      unknown_cost_calls:                toInt(r.unknown_cost_calls),
      success_count:                     toInt(r.success_count),
      failure_count:                     toInt(r.failure_count),
      // Unit economics — only from known cost; UNKNOWN cost excluded
      known_cost_per_logical_request_usd:
        logicalReqs > 0 ? round6(knownCost / logicalReqs) : null,
      known_cost_per_actual_call_usd:
        actualCalls > 0 && unknownCalls === 0 ? round6(knownCost / actualCalls) : null,
    };
  });
}

/**
 * Breakdown by provider / service / model.
 * model may be null for external (SMS, R2) events.
 */
async function queryByProviderServiceModel(start: string, end: string) {
  const res = await superAdminDb.execute(sql`
    SELECT
      COALESCE(metadata->>'provider', 'UNKNOWN')                                                 AS provider,
      COALESCE(metadata->>'service',  'UNKNOWN')                                                 AS service,
      metadata->>'model'                                                                          AS model,
      COUNT(*)::int                                                                               AS total_events,
      COALESCE(SUM((metadata->>'logical_request_count')::numeric), 0)::numeric                   AS logical_requests,
      COALESCE(SUM(
        CASE WHEN metadata ? 'actual_call_count'
             THEN (metadata->>'actual_call_count')::numeric ELSE NULL END
      ), 0)::numeric                                                                              AS actual_calls_known,
      COALESCE(SUM(
        CASE WHEN metadata ? 'estimated_cost_usd'
              AND (metadata->>'cost_source') IS DISTINCT FROM 'UNKNOWN'
             THEN (metadata->>'estimated_cost_usd')::numeric ELSE NULL END
      ), 0)::numeric                                                                              AS known_cost_usd,
      COUNT(*) FILTER (
        WHERE NOT (metadata ? 'estimated_cost_usd')
           OR (metadata->>'estimated_cost_usd') IS NULL
           OR (metadata->>'cost_source') = 'UNKNOWN'
      )::int                                                                                       AS unknown_cost_calls
    FROM event_logs
    WHERE category IN ('AI', 'EXTERNAL_USAGE')
      AND created_at >= ${start}::timestamptz
      AND created_at <  ${end}::timestamptz
    GROUP BY 1, 2, 3
    ORDER BY known_cost_usd DESC
  `);
  const rows = (res as any).rows ?? (res as any) ?? [];
  return rows.map((r: any) => ({
    provider:           r.provider,
    service:            r.service,
    model:              r.model ?? null,
    total_events:       toInt(r.total_events),
    logical_requests:   toNum(r.logical_requests),
    actual_calls_known: toNum(r.actual_calls_known),
    known_cost_usd:     toNum(r.known_cost_usd),
    unknown_cost_calls: toInt(r.unknown_cost_calls),
  }));
}

/**
 * Breakdown by pool_id.
 */
async function queryByPool(start: string, end: string) {
  const res = await superAdminDb.execute(sql`
    SELECT
      COALESCE(pool_id, '')                                                                       AS pool_id,
      COALESCE(SUM((metadata->>'logical_request_count')::numeric), 0)::numeric                   AS logical_requests,
      COALESCE(SUM(
        CASE WHEN metadata ? 'actual_call_count'
             THEN (metadata->>'actual_call_count')::numeric ELSE NULL END
      ), 0)::numeric                                                                              AS actual_calls_known,
      COALESCE(SUM(
        CASE WHEN metadata ? 'estimated_cost_usd'
              AND (metadata->>'cost_source') IS DISTINCT FROM 'UNKNOWN'
             THEN (metadata->>'estimated_cost_usd')::numeric ELSE NULL END
      ), 0)::numeric                                                                              AS known_cost_usd,
      COUNT(*) FILTER (
        WHERE NOT (metadata ? 'estimated_cost_usd')
           OR (metadata->>'estimated_cost_usd') IS NULL
           OR (metadata->>'cost_source') = 'UNKNOWN'
      )::int                                                                                       AS unknown_cost_calls
    FROM event_logs
    WHERE category IN ('AI', 'EXTERNAL_USAGE')
      AND created_at >= ${start}::timestamptz
      AND created_at <  ${end}::timestamptz
    GROUP BY 1
    ORDER BY known_cost_usd DESC
  `);
  const rows = (res as any).rows ?? (res as any) ?? [];
  return rows.map((r: any) => ({
    pool_id:            r.pool_id,
    logical_requests:   toNum(r.logical_requests),
    actual_calls_known: toNum(r.actual_calls_known),
    known_cost_usd:     toNum(r.known_cost_usd),
    unknown_cost_calls: toInt(r.unknown_cost_calls),
  }));
}

// ── Numeric helpers (safe coerce from DB strings) ────────────────────────────

function toNum(v: unknown): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}
function toInt(v: unknown): number {
  return Math.round(toNum(v));
}
function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

// ── Endpoint ─────────────────────────────────────────────────────────────────

router.get(
  "/super/ai-cost-overview",
  requireAuth,
  requireRole("super_admin"),
  async (_req: AuthRequest, res) => {
    try {
      const { todayStart, monthStart, now } = await fetchPeriodBounds();

      // All 8 DB aggregate queries run in parallel (2 periods × 4 breakdown types)
      const [
        todaySummary,   monthSummary,
        todayTrigger,   monthTrigger,
        todayFeature,   monthFeature,
        todayPSM,       monthPSM,
        todayPool,      monthPool,
      ] = await Promise.all([
        querySummary(todayStart, now),
        querySummary(monthStart, now),
        queryByTrigger(todayStart, now),
        queryByTrigger(monthStart, now),
        queryByFeature(todayStart, now),
        queryByFeature(monthStart, now),
        queryByProviderServiceModel(todayStart, now),
        queryByProviderServiceModel(monthStart, now),
        queryByPool(todayStart, now),
        queryByPool(monthStart, now),
      ]);

      res.json({
        generated_at: now,
        today: {
          period_start:               todayStart,
          period_end:                 now,
          summary:                    todaySummary,
          by_trigger_type:            todayTrigger,
          by_feature:                 todayFeature,
          by_provider_service_model:  todayPSM,
          by_pool:                    todayPool,
        },
        month: {
          period_start:               monthStart,
          period_end:                 now,
          summary:                    monthSummary,
          by_trigger_type:            monthTrigger,
          by_feature:                 monthFeature,
          by_provider_service_model:  monthPSM,
          by_pool:                    monthPool,
        },
      });
    } catch (err: any) {
      console.error("[ai-cost-overview]", err?.message);
      res.status(500).json({ error: "AI cost overview query failed" });
    }
  },
);

export default router;
