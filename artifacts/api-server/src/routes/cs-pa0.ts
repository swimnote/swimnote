/**
 * CS-PA0 — AI Customer Support + Partner Analytics Foundation Routes
 *
 * All routes: super_admin only
 * Data source: event_logs (category='AI') — reuses existing ai-trace-service
 * No duplicate AI trace system.
 *
 * Routes:
 *   GET  /super/ai/metrics              — AI 사용량 집계 (feature/기간별)
 *   GET  /super/partner/metrics         — Partner Analytics KPI
 *   POST /super/partner/snapshots       — 스냅샷 생성
 *   GET  /super/partner/snapshots       — 스냅샷 목록
 *   GET  /super/support/cases           — 고객센터 케이스 목록
 *   POST /super/support/cases           — 케이스 생성
 *   GET  /super/support/knowledge       — Knowledge 아이템 목록
 *   POST /super/support/knowledge       — Knowledge 아이템 생성 (super_admin 검토 필수)
 *   PATCH /super/support/knowledge/:id  — Knowledge 아이템 활성화/수정
 */
import { Router, type Request, type Response } from "express";
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth.js";
import { AI_FEATURE_LABEL, SUPPORT_CASE_STATE } from "../lib/ai-feature-enum.js";

const router = Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseDateRange(req: Request): { from: string | null; to: string | null; days: number } {
  const { from, to, period } = req.query as Record<string, string>;
  if (from && to) return { from, to, days: 0 };
  const days = parseInt(period ?? "30", 10) || 30;
  const toDate = new Date();
  const fromDate = new Date(Date.now() - days * 24 * 3600 * 1000);
  return {
    from: fromDate.toISOString().slice(0, 10),
    to: toDate.toISOString().slice(0, 10),
    days,
  };
}

/** NOT_AVAILABLE sentinel — source 없는 지표에 0 대신 사용 */
const NA = null;

// ── GET /super/ai/metrics ─────────────────────────────────────────────────────
// event_logs(category=AI) 집계. 기간·feature·pool 필터.
// SA0-B의 /super/ai-traces와 중복 없이 집계 전용으로만 사용.

router.get(
  "/super/ai/metrics",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const { from, to } = parseDateRange(req);
    const { pool_id, feature } = req.query as Record<string, string>;

    try {
      const conditions: string[] = ["category = 'AI'"];
      const params: any[] = [];

      if (from) { params.push(from + "T00:00:00Z"); conditions.push(`created_at >= $${params.length}::timestamptz`); }
      if (to)   { params.push(to   + "T23:59:59Z"); conditions.push(`created_at <= $${params.length}::timestamptz`); }
      if (pool_id) { params.push(pool_id); conditions.push(`pool_id = $${params.length}`); }
      if (feature) { params.push(feature); conditions.push(`metadata->>'feature' = $${params.length}`); }

      const where = conditions.join(" AND ");

      // Overall totals
      const totalsRes = await superAdminDb.execute(sql.raw(`
        SELECT
          COUNT(*) AS total_requests,
          COUNT(*) FILTER (WHERE metadata->>'status' = 'SUCCESS') AS success_count,
          COUNT(*) FILTER (WHERE metadata->>'status' = 'FAILED')  AS error_count,
          COUNT(DISTINCT pool_id)  AS active_pools,
          COUNT(DISTINCT actor_id) AS active_actors,
          SUM((metadata->>'total_tokens')::int)             AS total_tokens,
          SUM((metadata->'cost'->>'total_cost_usd')::float) AS total_cost_usd,
          AVG((metadata->>'latency_ms')::int)               AS avg_latency_ms,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (metadata->>'latency_ms')::int) AS p50_latency_ms,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY (metadata->>'latency_ms')::int) AS p95_latency_ms
        FROM event_logs
        WHERE ${where}
      `, params));

      const totals = (totalsRes as any).rows?.[0] ?? {};
      const totalReq = Number(totals.total_requests ?? 0);

      // Per-feature breakdown
      const featureRes = await superAdminDb.execute(sql.raw(`
        SELECT
          metadata->>'feature' AS feature,
          COUNT(*) AS requests,
          COUNT(*) FILTER (WHERE metadata->>'status' = 'SUCCESS') AS success_count,
          COUNT(*) FILTER (WHERE metadata->>'status' = 'FAILED')  AS error_count,
          COUNT(DISTINCT pool_id)  AS active_pools,
          COUNT(DISTINCT actor_id) AS active_actors,
          SUM((metadata->>'total_tokens')::int)             AS total_tokens,
          SUM((metadata->'cost'->>'total_cost_usd')::float) AS total_cost_usd,
          AVG((metadata->>'latency_ms')::int)               AS avg_latency_ms
        FROM event_logs
        WHERE ${where}
        GROUP BY metadata->>'feature'
        ORDER BY requests DESC
      `, params));

      const featureRows = ((featureRes as any).rows ?? []).map((r: any) => ({
        feature:      r.feature ?? "unknown",
        label:        AI_FEATURE_LABEL[r.feature as keyof typeof AI_FEATURE_LABEL] ?? r.feature ?? "기타",
        requests:     Number(r.requests ?? 0),
        success_count: Number(r.success_count ?? 0),
        error_count:  Number(r.error_count ?? 0),
        success_rate: Number(r.requests ?? 0) > 0
          ? Math.round((Number(r.success_count ?? 0) / Number(r.requests)) * 100 * 10) / 10
          : NA,
        active_pools:  Number(r.active_pools  ?? 0),
        active_actors: Number(r.active_actors ?? 0),
        total_tokens:  r.total_tokens  != null ? Number(r.total_tokens)  : NA,
        total_cost_usd: r.total_cost_usd != null ? Number(r.total_cost_usd) : NA,
        avg_latency_ms: r.avg_latency_ms != null ? Math.round(Number(r.avg_latency_ms)) : NA,
      }));

      // Per-model breakdown
      const modelRes = await superAdminDb.execute(sql.raw(`
        SELECT
          metadata->>'model' AS model,
          COUNT(*) AS requests,
          SUM((metadata->>'total_tokens')::int)             AS total_tokens,
          SUM((metadata->'cost'->>'total_cost_usd')::float) AS total_cost_usd,
          AVG((metadata->>'latency_ms')::int)               AS avg_latency_ms
        FROM event_logs
        WHERE ${where}
          AND metadata->>'model' IS NOT NULL
        GROUP BY metadata->>'model'
        ORDER BY requests DESC
      `, params));

      const modelRows = ((modelRes as any).rows ?? []).map((r: any) => ({
        model:         r.model ?? "unknown",
        requests:      Number(r.requests ?? 0),
        total_tokens:  r.total_tokens  != null ? Number(r.total_tokens)  : NA,
        total_cost_usd: r.total_cost_usd != null ? Number(r.total_cost_usd) : NA,
        avg_latency_ms: r.avg_latency_ms != null ? Math.round(Number(r.avg_latency_ms)) : NA,
      }));

      res.json({
        period: { from, to },
        totals: {
          total_requests:  totalReq,
          success_count:   Number(totals.success_count  ?? 0),
          error_count:     Number(totals.error_count    ?? 0),
          success_rate:    totalReq > 0
            ? Math.round((Number(totals.success_count ?? 0) / totalReq) * 100 * 10) / 10
            : NA,
          active_pools:    Number(totals.active_pools  ?? 0),
          active_actors:   Number(totals.active_actors ?? 0),
          total_tokens:    totals.total_tokens   != null ? Number(totals.total_tokens)   : NA,
          total_cost_usd:  totals.total_cost_usd != null ? Number(totals.total_cost_usd) : NA,
          avg_latency_ms:  totals.avg_latency_ms != null ? Math.round(Number(totals.avg_latency_ms)) : NA,
          p50_latency_ms:  totals.p50_latency_ms != null ? Math.round(Number(totals.p50_latency_ms)) : NA,
          p95_latency_ms:  totals.p95_latency_ms != null ? Math.round(Number(totals.p95_latency_ms)) : NA,
        },
        by_feature: featureRows,
        by_model:   modelRows,
      });
    } catch (err) {
      console.error("[super/ai/metrics]", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── GET /super/partner/metrics ────────────────────────────────────────────────
// Partner Analytics KPI — event_logs 집계 + pool 현황.
// missing metric은 null (NOT_AVAILABLE), 절대 fake 0 사용 안 함.

router.get(
  "/super/partner/metrics",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const { from, to, days } = parseDateRange(req);

    try {
      const params = [from + "T00:00:00Z", to + "T23:59:59Z"];
      const where = `category = 'AI' AND created_at BETWEEN $1::timestamptz AND $2::timestamptz`;

      const [aiRes, poolsRes] = await Promise.allSettled([
        superAdminDb.execute(sql.raw(`
          SELECT
            COUNT(*) AS total_requests,
            COUNT(*) FILTER (WHERE metadata->>'status' = 'SUCCESS') AS success_count,
            COUNT(*) FILTER (WHERE metadata->>'status' = 'FAILED')  AS error_count,
            COUNT(DISTINCT pool_id)  AS active_ai_pools,
            COUNT(DISTINCT actor_id) AS active_ai_actors,
            SUM((metadata->>'total_tokens')::int)             AS total_tokens,
            SUM((metadata->'cost'->>'total_cost_usd')::float) AS total_cost_usd,
            AVG((metadata->>'latency_ms')::int)               AS avg_latency_ms,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (metadata->>'latency_ms')::int) AS p50_ms,
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY (metadata->>'latency_ms')::int) AS p95_ms
          FROM event_logs
          WHERE ${where}
        `, params)),
        superAdminDb.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE approval_status = 'approved') AS total_pools,
            COUNT(*) FILTER (WHERE approval_status = 'approved' AND (x_paid_entitlement = true OR x_manual_entitlement = true)) AS x_pools
          FROM swimming_pools
        `),
      ]);

      const ai = aiRes.status === "fulfilled" ? (aiRes.value as any).rows?.[0] ?? {} : {};
      const pools = poolsRes.status === "fulfilled" ? (poolsRes.value as any).rows?.[0] ?? {} : {};

      const totalReq = Number(ai.total_requests ?? 0);
      const successCnt = Number(ai.success_count ?? 0);

      res.json({
        period:         { from, to, days },
        total_pools:    pools.total_pools  != null ? Number(pools.total_pools) : NA,
        x_pools:        pools.x_pools      != null ? Number(pools.x_pools)     : NA,
        active_ai_pools: aiRes.status === "fulfilled" ? Number(ai.active_ai_pools ?? 0) : NA,
        active_ai_actors: aiRes.status === "fulfilled" ? Number(ai.active_ai_actors ?? 0) : NA,
        ai_requests:    totalReq,
        ai_success:     successCnt,
        ai_errors:      Number(ai.error_count ?? 0),
        success_rate:   totalReq > 0 ? Math.round((successCnt / totalReq) * 100 * 10) / 10 : NA,
        error_rate:     totalReq > 0 ? Math.round(((totalReq - successCnt) / totalReq) * 100 * 10) / 10 : NA,
        total_tokens:   ai.total_tokens   != null ? Number(ai.total_tokens)   : NA,
        // estimated_cost: 실제 비용이 아닌 추정치임을 명시
        estimated_cost_usd: ai.total_cost_usd != null ? Number(ai.total_cost_usd) : NA,
        avg_latency_ms: ai.avg_latency_ms != null ? Math.round(Number(ai.avg_latency_ms)) : NA,
        p50_latency_ms: ai.p50_ms        != null ? Math.round(Number(ai.p50_ms))        : NA,
        p95_latency_ms: ai.p95_ms        != null ? Math.round(Number(ai.p95_ms))        : NA,
        // Adoption: active_ai_pools / total_pools
        ai_pool_adoption_pct: (ai.active_ai_pools != null && pools.total_pools != null && Number(pools.total_pools) > 0)
          ? Math.round((Number(ai.active_ai_pools) / Number(pools.total_pools)) * 100 * 10) / 10
          : NA,
        // Result adoption은 현재 source 없음 → null
        result_adoption: NA,
        support_resolution: NA,
      });
    } catch (err) {
      console.error("[super/partner/metrics]", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── POST /super/partner/snapshots ─────────────────────────────────────────────

router.post(
  "/super/partner/snapshots",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const actorId = (req as any).user?.id;
    const { period_start, period_end, label } = req.body;
    if (!period_start || !period_end) {
      return res.status(400).json({ error: "period_start, period_end 필수" });
    }

    try {
      // Compute current metrics for the period and embed as snapshot
      const params = [period_start + "T00:00:00Z", period_end + "T23:59:59Z"];
      const aiRes = await superAdminDb.execute(sql.raw(`
        SELECT
          COUNT(*) AS total_requests,
          COUNT(*) FILTER (WHERE metadata->>'status' = 'SUCCESS') AS success_count,
          COUNT(DISTINCT pool_id)  AS active_ai_pools,
          COUNT(DISTINCT actor_id) AS active_ai_actors,
          SUM((metadata->>'total_tokens')::int)             AS total_tokens,
          SUM((metadata->'cost'->>'total_cost_usd')::float) AS total_cost_usd,
          AVG((metadata->>'latency_ms')::int)               AS avg_latency_ms
        FROM event_logs
        WHERE category = 'AI' AND created_at BETWEEN $1::timestamptz AND $2::timestamptz
      `, params));

      const ai = (aiRes as any).rows?.[0] ?? {};
      const poolsRes = await superAdminDb.execute(sql`
        SELECT COUNT(*) AS total_pools FROM swimming_pools WHERE approval_status = 'approved'
      `);
      const totalPools = Number((poolsRes as any).rows?.[0]?.total_pools ?? 0);

      const metricsJson = {
        schema_version: "1.0",
        period_start, period_end,
        captured_at: new Date().toISOString(),
        total_pools: totalPools,
        active_ai_pools: Number(ai.active_ai_pools ?? 0),
        ai_requests: Number(ai.total_requests ?? 0),
        ai_success: Number(ai.success_count ?? 0),
        active_ai_actors: Number(ai.active_ai_actors ?? 0),
        total_tokens: ai.total_tokens != null ? Number(ai.total_tokens) : null,
        estimated_cost_usd: ai.total_cost_usd != null ? Number(ai.total_cost_usd) : null,
        avg_latency_ms: ai.avg_latency_ms != null ? Math.round(Number(ai.avg_latency_ms)) : null,
      };

      const id = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await superAdminDb.execute(sql`
        INSERT INTO partner_analytics_snapshots (id, period_start, period_end, metrics_json, label, created_by)
        VALUES (${id}, ${period_start}::date, ${period_end}::date, ${JSON.stringify(metricsJson)}::jsonb,
                ${label ?? null}, ${String(actorId)})
      `);

      res.json({ ok: true, id, metrics: metricsJson });
    } catch (err) {
      console.error("[super/partner/snapshots POST]", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── GET /super/partner/snapshots ──────────────────────────────────────────────

router.get(
  "/super/partner/snapshots",
  requireAuth,
  requireRole("super_admin"),
  async (_req: Request, res: Response) => {
    try {
      const r = await superAdminDb.execute(sql`
        SELECT id, period_start::text, period_end::text, label, metrics_json,
               created_at::text AS created_at, created_by
        FROM partner_analytics_snapshots
        ORDER BY created_at DESC
        LIMIT 50
      `);
      res.json({ snapshots: (r as any).rows ?? [] });
    } catch (err) {
      console.error("[super/partner/snapshots GET]", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── GET /super/support/cases/:id — case 상세 (super_admin) ───────────────────

router.get(
  "/super/support/cases/:caseId",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const { caseId } = req.params;
    const { getMasterState, messageThreadId } = await import("../lib/support-case-service.js");
    const { db } = await import("@workspace/db");
    const { sql: dbSql } = await import("drizzle-orm");

    try {
      const caseRows = await superAdminDb.execute(sql`
        SELECT id, pool_id, actor_id, ticket_id, actor_role, mode, state,
               escalation_reason, resolution_source, llm_used, turn_count,
               waiting_for, context_json,
               resolved_at::text, created_at::text, updated_at::text
        FROM support_cases WHERE id = ${caseId} LIMIT 1
      `);
      const sc = (caseRows as any)?.rows?.[0];
      if (!sc) return res.status(404).json({ error: "케이스를 찾을 수 없습니다." });

      const threadId = messageThreadId(caseId, sc.ticket_id);

      let messages: any[] = [];
      try {
        const msgRows = await (db as any).execute(dbSql`
          SELECT id, ticket_id, author_user_id, author_name,
                 author_role, message_type, content, image_urls, created_at::text
          FROM support_ticket_replies
          WHERE ticket_id = ${threadId}
          ORDER BY created_at ASC
        `);
        messages = (msgRows as any)?.rows ?? [];
      } catch { /* pool db unavailable */ }

      let ticket: any = null;
      if (sc.ticket_id) {
        try {
          const tRows = await (db as any).execute(dbSql`
            SELECT id, subject, status, ticket_type, consultation_requested, created_at::text
            FROM support_tickets WHERE id = ${sc.ticket_id} LIMIT 1
          `);
          ticket = (tRows as any)?.rows?.[0] ?? null;
        } catch { /* ignore */ }
      }

      res.json({
        case:         sc,
        ticket,
        messages,
        state:        sc.state,
        master_state: getMasterState(sc.state, sc.escalation_reason),
        context:      sc.context_json ?? {},
        created_at:   sc.created_at,
        updated_at:   sc.updated_at,
      });
    } catch (err) {
      console.error("[super/support/cases/:id GET]", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── POST /super/support/cases/:id/transition — super_admin state override ─────

router.post(
  "/super/support/cases/:caseId/transition",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const { caseId } = req.params;
    const { to_state, reason, waiting_for, resolution_source } = req.body;
    if (!to_state) return res.status(400).json({ error: "to_state 필수" });

    const { transitionSupportCase } = await import("../lib/support-case-service.js");

    try {
      const result = await transitionSupportCase({
        caseId,
        toState:          to_state,
        actorRole:        "super_admin",
        reason:           reason ?? null,
        waitingFor:       waiting_for ?? null,
        resolutionSource: resolution_source ?? null,
      });

      if (!result.ok) return res.status(result.status).json({ error: result.error });
      res.json({ ok: true, to_state });
    } catch (err) {
      console.error("[super/support/cases/:id/transition POST]", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── GET /super/support/cases ──────────────────────────────────────────────────

router.get(
  "/super/support/cases",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const { state, pool_id, limit: lim, offset: off } = req.query as Record<string, string>;
    const limit  = Math.min(parseInt(lim  ?? "50", 10) || 50, 200);
    const offset = parseInt(off ?? "0", 10) || 0;

    try {
      const conditions: string[] = ["1=1"];
      const params: any[] = [];
      if (state)   { params.push(state);   conditions.push(`state = $${params.length}`); }
      if (pool_id) { params.push(pool_id); conditions.push(`pool_id = $${params.length}`); }
      params.push(limit); params.push(offset);

      const where = conditions.join(" AND ");
      const r = await superAdminDb.execute(sql.raw(`
        SELECT id, pool_id, ticket_id, actor_role, mode, state, escalation_reason,
               resolution_source, llm_used, turn_count, resolved_at::text,
               created_at::text, updated_at::text
        FROM support_cases
        WHERE ${where}
        ORDER BY created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `, params));

      res.json({ cases: (r as any).rows ?? [] });
    } catch (err) {
      console.error("[super/support/cases GET]", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── POST /super/support/cases ─────────────────────────────────────────────────

router.post(
  "/super/support/cases",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const { pool_id, ticket_id, actor_role, mode } = req.body;
    if (!actor_role) return res.status(400).json({ error: "actor_role 필수" });

    try {
      const id = `sc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await superAdminDb.execute(sql`
        INSERT INTO support_cases (id, pool_id, ticket_id, actor_role, mode, state)
        VALUES (${id}, ${pool_id ?? null}, ${ticket_id ?? null}, ${actor_role}, ${mode ?? null},
                ${SUPPORT_CASE_STATE.NEW})
      `);
      res.json({ ok: true, id });
    } catch (err) {
      console.error("[super/support/cases POST]", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── GET /super/support/knowledge ──────────────────────────────────────────────

router.get(
  "/super/support/knowledge",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const { item_type, status, feature, scope } = req.query as Record<string, string>;

    try {
      const conditions: string[] = ["1=1"];
      const params: any[] = [];
      if (item_type) { params.push(item_type); conditions.push(`item_type = $${params.length}`); }
      if (status)    { params.push(status);    conditions.push(`status = $${params.length}`);    }
      if (feature)   { params.push(feature);   conditions.push(`feature = $${params.length}`);   }
      if (scope)     { params.push(scope);     conditions.push(`scope = $${params.length}`);     }

      const where = conditions.join(" AND ");
      const r = await superAdminDb.execute(sql.raw(`
        SELECT id, item_type, scope, pool_id, category, feature, affected_role, affected_mode,
               title, content, status, reviewed_by, reviewed_at::text,
               usage_count, success_count, created_at::text
        FROM support_knowledge_items
        WHERE ${where}
        ORDER BY item_type, usage_count DESC
        LIMIT 200
      `, params));

      res.json({ items: (r as any).rows ?? [] });
    } catch (err) {
      console.error("[super/support/knowledge GET]", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── POST /super/support/knowledge ────────────────────────────────────────────
// AI가 자동 production 승인 금지 — Super Admin 검토 후 PATCH로 활성화

router.post(
  "/super/support/knowledge",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const { item_type, title, content, category, feature, affected_role, affected_mode, scope, pool_id } = req.body;
    if (!item_type || !title || !content) {
      return res.status(400).json({ error: "item_type, title, content 필수" });
    }
    const VALID_TYPES = ["FAQ", "RULE", "KNOWN_ISSUE", "SOLUTION"];
    if (!VALID_TYPES.includes(item_type)) {
      return res.status(400).json({ error: "item_type: FAQ/RULE/KNOWN_ISSUE/SOLUTION" });
    }

    try {
      const id = `ki_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      // status = 'pending' (Super Admin 검토 전까지 비활성)
      await superAdminDb.execute(sql`
        INSERT INTO support_knowledge_items
          (id, item_type, scope, pool_id, category, feature, affected_role, affected_mode, title, content, status)
        VALUES (${id}, ${item_type}, ${scope ?? "global"}, ${pool_id ?? null},
                ${category ?? null}, ${feature ?? null}, ${affected_role ?? null},
                ${affected_mode ?? null}, ${title}, ${content}, ${"pending"})
      `);
      res.json({ ok: true, id, status: "pending" });
    } catch (err) {
      console.error("[super/support/knowledge POST]", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── PATCH /super/support/knowledge/:id ───────────────────────────────────────
// Super Admin 검토 후 활성화 또는 수정

router.patch(
  "/super/support/knowledge/:itemId",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const { itemId } = req.params;
    const actorId = (req as any).user?.id;
    const { status, title, content, conditions, solution_steps, deep_link } = req.body;

    try {
      const existing = await superAdminDb.execute(sql`
        SELECT id FROM support_knowledge_items WHERE id = ${itemId} LIMIT 1
      `);
      if (!(existing as any).rows?.[0]) return res.status(404).json({ error: "항목을 찾을 수 없습니다." });

      const updates: string[] = ["updated_at = NOW()"];
      if (status)         updates.push(`status = '${status.replace(/'/g, "''")}'`);
      if (title)          updates.push(`title = '${title.replace(/'/g, "''")}'`);
      if (content)        updates.push(`content = '${content.replace(/'/g, "''")}'`);
      if (conditions)     updates.push(`conditions = '${JSON.stringify(conditions).replace(/'/g, "''")}'::jsonb`);
      if (solution_steps) updates.push(`solution_steps = '${JSON.stringify(solution_steps).replace(/'/g, "''")}'::jsonb`);
      if (deep_link)      updates.push(`deep_link = '${deep_link.replace(/'/g, "''")}'`);

      if (status === "active") {
        updates.push(`reviewed_by = '${String(actorId).replace(/'/g, "''")}'`);
        updates.push(`reviewed_at = NOW()`);
      }

      await superAdminDb.execute(sql.raw(
        `UPDATE support_knowledge_items SET ${updates.join(", ")} WHERE id = $1`,
        [itemId]
      ));

      res.json({ ok: true, updated: updates.length - 1 });
    } catch (err) {
      console.error("[super/support/knowledge PATCH]", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── Startup migration ─────────────────────────────────────────────────────────
import("../migrations/pool-db-cs-pa0.js")
  .then(({ runCsPa0Migration }) => runCsPa0Migration())
  .catch((e: any) => console.error("[cs-pa0-init] migration failed:", e?.message));

export default router;
