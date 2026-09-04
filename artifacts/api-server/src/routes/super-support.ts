/**
 * super-support.ts — WP-CS-03R Super Admin Support Inbox (Human E2E)
 *
 * 모든 엔드포인트 super_admin 전용.
 * DB: superAdminDb (Supabase) — support_cases, swimming_pools
 *     db (pool / same Supabase) — support_tickets, support_ticket_replies
 *
 * Routes:
 *   GET  /super/support/cases            — inbox list (filters)
 *   GET  /super/support/cases/:id        — case detail + messages
 *   GET  /super/support/stats            — badge counts
 *   POST /super/support/cases/:id/agent-reply    — agent sends message
 *   POST /super/support/cases/:id/resolve        — resolve case
 *   POST /super/support/cases/:id/phone-required — phone escalation
 *   POST /super/support/cases/:id/reopen         — reopen case
 *
 * Privacy:
 *   event_logs에 raw 상담 본문 저장 금지 (case_id/state/role만).
 *   analytics에 raw message text 저장 금지.
 */

import { Router }       from "express";
import { superAdminDb, db } from "@workspace/db";
import { sql }          from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import {
  transitionSupportCase,
  logSupportEvent,
  getMasterState,
  ensureCs01rSchema,
} from "../lib/support-case-service.js";
import { SUPPORT_CASE_STATE, SUPPORT_EVENT_TYPE } from "../lib/ai-feature-enum.js";

const router = Router();

// Startup idempotent migration
// Schema guaranteed by explicit migration (WP8-P2). See src/migrations/runtime-ddl-consolidated.ts §5

const SUPER = requireRole("super_admin");

// ── Helpers ───────────────────────────────────────────────────────────────────

/** status_group → internal DB states */
function stateGroupToStates(group: string): string[] | null {
  switch (group) {
    case "new":             return ["NEW"];
    case "ai":              return ["AI_PROCESSING", "AI_RESPONDED", "WAITING"];
    case "agent_requested": return ["HUMAN_REQUIRED"];
    case "agent_active":    return ["HUMAN_RESPONDED", "ESCALATED"];
    case "phone":           return ["PHONE_REQUIRED"];
    case "resolved":        return ["AI_RESOLVED", "RESOLVED", "CLOSED"];
    case "reopened":        return ["REOPENED"];
    default:                return null; // all
  }
}

function maskPool(poolId: string | null): string {
  return poolId ? `[pool:${poolId.slice(-4)}]` : "—";
}

// ── GET /super/support/cases ─────────────────────────────────────────────────

router.get("/super/support/cases", requireAuth, SUPER, async (req: AuthRequest, res) => {
  const { status_group, role, mode, pool_id, limit = "100", offset = "0" } = req.query as Record<string, string>;

  try {
    const states = stateGroupToStates(status_group);

    // Build WHERE clauses dynamically using conditional SQL
    // We'll use a safe approach: fetch all and filter in JS for small datasets
    // (support cases will be low volume for now)
    const rows = (await (superAdminDb as any).execute(sql`
      SELECT
        sc.id,
        sc.pool_id,
        sc.actor_id,
        sc.ticket_id,
        sc.actor_role,
        sc.mode,
        sc.state,
        sc.escalation_reason,
        sc.context_json,
        sc.turn_count,
        sc.waiting_for,
        sc.resolved_at::text    AS resolved_at,
        sc.created_at::text     AS created_at,
        sc.updated_at::text     AS updated_at,
        sp.name                 AS pool_name
      FROM support_cases sc
      LEFT JOIN swimming_pools sp ON sp.id = sc.pool_id
      ORDER BY
        CASE WHEN sc.state = 'HUMAN_REQUIRED' THEN 0 ELSE 1 END ASC,
        sc.updated_at DESC
      LIMIT ${parseInt(limit) || 100}
      OFFSET ${parseInt(offset) || 0}
    `)) as any;

    let cases: any[] = rows?.rows ?? [];

    // In-process filter (volumes expected <500)
    if (states) {
      cases = cases.filter((c: any) => states.includes(c.state));
    }
    if (role && role !== "all") {
      cases = cases.filter((c: any) => c.actor_role === role);
    }
    if (mode && mode !== "all") {
      cases = cases.filter((c: any) => c.mode === mode);
    }
    if (pool_id) {
      cases = cases.filter((c: any) => c.pool_id === pool_id);
    }

    // Enrich: last_message_at from support_ticket_replies
    // Batch query for all case ids
    const caseIds = cases.map((c: any) => c.id as string);

    let lastMsgMap: Record<string, string> = {};
    if (caseIds.length > 0) {
      try {
        const idList = caseIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
        const msgRows = (await (db as any).execute(sql.raw(`
          SELECT case_id, MAX(created_at)::text AS last_msg_at
          FROM support_ticket_replies
          WHERE case_id IN (${idList})
          GROUP BY case_id
        `))) as any;
        for (const r of (msgRows?.rows ?? [])) {
          lastMsgMap[r.case_id] = r.last_msg_at;
        }
      } catch { /* best-effort */ }
    }

    const enriched = cases.map((c: any) => ({
      ...c,
      master_state:    getMasterState(c.state, c.escalation_reason),
      last_message_at: lastMsgMap[c.id] ?? c.updated_at,
      wait_since:      c.state === "HUMAN_REQUIRED" ? c.updated_at : null,
    }));

    res.json({ cases: enriched, total: enriched.length });
  } catch (err) {
    console.error("[GET /super/support/cases]", err);
    res.status(500).json({ error: "서버 오류" });
  }
});

// ── GET /super/support/stats ─────────────────────────────────────────────────

router.get("/super/support/stats", requireAuth, SUPER, async (_req: AuthRequest, res) => {
  try {
    const rows = (await (superAdminDb as any).execute(sql`
      SELECT state, COUNT(*) AS cnt
      FROM support_cases
      GROUP BY state
    `)) as any;

    const counts: Record<string, number> = {};
    for (const r of (rows?.rows ?? [])) {
      counts[r.state] = parseInt(r.cnt, 10) || 0;
    }

    const agentRequested = counts["HUMAN_REQUIRED"] ?? 0;
    const agentActive    = (counts["HUMAN_RESPONDED"] ?? 0) + (counts["ESCALATED"] ?? 0);
    const phoneRequired  = counts["PHONE_REQUIRED"] ?? 0;
    const totalOpen      = agentRequested + agentActive + phoneRequired +
                           (counts["NEW"] ?? 0) + (counts["AI_PROCESSING"] ?? 0) +
                           (counts["AI_RESPONDED"] ?? 0) + (counts["WAITING"] ?? 0) +
                           (counts["REOPENED"] ?? 0);

    res.json({
      by_state:       counts,
      agent_requested: agentRequested,
      agent_active:    agentActive,
      phone_required:  phoneRequired,
      total_open:      totalOpen,
    });
  } catch (err) {
    console.error("[GET /super/support/stats]", err);
    res.status(500).json({ error: "서버 오류" });
  }
});

// ── GET /super/support/cases/:id ─────────────────────────────────────────────

router.get("/super/support/cases/:id", requireAuth, SUPER, async (req: AuthRequest, res) => {
  const caseId = req.params.id;

  try {
    const caseRows = (await (superAdminDb as any).execute(sql`
      SELECT
        sc.id, sc.pool_id, sc.actor_id, sc.ticket_id, sc.actor_role, sc.mode, sc.state,
        sc.escalation_reason, sc.resolution_source, sc.llm_used, sc.turn_count,
        sc.waiting_for, sc.context_json,
        sc.resolved_at::text AS resolved_at,
        sc.created_at::text  AS created_at,
        sc.updated_at::text  AS updated_at,
        sp.name              AS pool_name
      FROM support_cases sc
      LEFT JOIN swimming_pools sp ON sp.id = sc.pool_id
      WHERE sc.id = ${caseId}
      LIMIT 1
    `)) as any;

    const sc = caseRows?.rows?.[0];
    if (!sc) return res.status(404).json({ error: "케이스를 찾을 수 없습니다." });

    // Messages — thread continuity (same as support-cases.ts)
    let messages: any[] = [];
    try {
      const ticketId = sc.ticket_id ?? null;
      let msgRows: any;
      if (ticketId) {
        msgRows = (await (db as any).execute(sql`
          SELECT id, ticket_id, case_id, author_user_id, author_name,
                 author_role, message_type, content, image_urls, created_at::text
          FROM support_ticket_replies
          WHERE case_id = ${caseId}
             OR (ticket_id = ${ticketId} AND case_id IS NULL)
          ORDER BY created_at ASC
        `)) as any;
      } else {
        msgRows = (await (db as any).execute(sql`
          SELECT id, ticket_id, case_id, author_user_id, author_name,
                 author_role, message_type, content, image_urls, created_at::text
          FROM support_ticket_replies
          WHERE case_id = ${caseId}
          ORDER BY created_at ASC
        `)) as any;
      }
      messages = msgRows?.rows ?? [];
    } catch { /* best-effort */ }

    // Linked ticket
    let ticket: any = null;
    if (sc.ticket_id) {
      try {
        const tRows = (await (db as any).execute(sql`
          SELECT id, subject, status, ticket_type, consultation_requested, created_at::text
          FROM support_tickets WHERE id = ${sc.ticket_id} LIMIT 1
        `)) as any;
        ticket = tRows?.rows?.[0] ?? null;
      } catch { /* best-effort */ }
    }

    res.json({
      case:        sc,
      ticket,
      messages,
      state:        sc.state,
      master_state: getMasterState(sc.state, sc.escalation_reason),
      context:      sc.context_json ?? {},
      pool_name:    sc.pool_name ?? null,
      created_at:   sc.created_at,
      updated_at:   sc.updated_at,
    });
  } catch (err) {
    console.error("[GET /super/support/cases/:id]", err);
    res.status(500).json({ error: "서버 오류" });
  }
});

// ── POST /super/support/cases/:id/agent-reply ─────────────────────────────────
// Super admin이 사용자에게 답변.
// 1. support_ticket_replies INSERT (author_role='agent')
// 2. HUMAN_REQUIRED → HUMAN_RESPONDED 자동 전환

router.post("/super/support/cases/:id/agent-reply", requireAuth, SUPER, async (req: AuthRequest, res) => {
  const user   = req.user!;
  const caseId = req.params.id;
  const { content } = req.body as any;

  if (!content || !content.trim()) {
    return res.status(400).json({ error: "content 필수" });
  }

  try {
    const caseRows = (await (superAdminDb as any).execute(sql`
      SELECT id, pool_id, ticket_id, state, actor_id
      FROM support_cases WHERE id = ${caseId} LIMIT 1
    `)) as any;
    const sc = caseRows?.rows?.[0];
    if (!sc) return res.status(404).json({ error: "케이스를 찾을 수 없습니다." });

    // Insert message
    const msgId        = `rep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const insertTicketId: string | null = sc.ticket_id ?? null;

    await (db as any).execute(sql`
      INSERT INTO support_ticket_replies
        (id, ticket_id, case_id, author_user_id, author_name, author_role, message_type, content, image_urls)
      VALUES (
        ${msgId},
        ${insertTicketId},
        ${caseId},
        ${user.userId},
        ${user.name ?? "관리자"},
        ${"agent"},
        ${"agent"},
        ${content.trim()},
        ${sql.raw("'{}'::text[]")}
      )
    `);

    // turn_count 증가 (best-effort)
    await (superAdminDb as any).execute(sql`
      UPDATE support_cases
      SET turn_count = turn_count + 1, updated_at = NOW()
      WHERE id = ${caseId}
    `).catch(() => {});

    // State transition: HUMAN_REQUIRED → HUMAN_RESPONDED
    let newState = sc.state;
    if (sc.state === SUPPORT_CASE_STATE.HUMAN_REQUIRED) {
      const result = await transitionSupportCase({
        caseId,
        toState:   SUPPORT_CASE_STATE.HUMAN_RESPONDED,
        actorRole: "super_admin",
        poolId:    sc.pool_id ?? null,
        reason:    "AGENT_REPLIED",
      });
      if (result.ok) {
        newState = SUPPORT_CASE_STATE.HUMAN_RESPONDED;
      }
    }

    void logSupportEvent({
      eventType: SUPPORT_EVENT_TYPE.AGENT_RESPONDED,
      caseId,
      ticketId:  sc.ticket_id ?? null,
      fromState: sc.state,
      toState:   newState,
      actorRole: "super_admin",
      poolId:    sc.pool_id ?? null,
    }).catch(() => {});

    res.json({ ok: true, id: msgId, state: newState });
  } catch (err) {
    console.error("[POST /super/support/cases/:id/agent-reply]", err);
    res.status(500).json({ error: "서버 오류" });
  }
});

// ── POST /super/support/cases/:id/resolve ────────────────────────────────────

router.post("/super/support/cases/:id/resolve", requireAuth, SUPER, async (req: AuthRequest, res) => {
  const caseId = req.params.id;

  try {
    const caseRows = (await (superAdminDb as any).execute(sql`
      SELECT id, pool_id, ticket_id, state, escalation_reason
      FROM support_cases WHERE id = ${caseId} LIMIT 1
    `)) as any;
    const sc = caseRows?.rows?.[0];
    if (!sc) return res.status(404).json({ error: "케이스를 찾을 수 없습니다." });

    const alreadyResolved = ["AI_RESOLVED", "RESOLVED", "CLOSED"].includes(sc.state);
    if (alreadyResolved) {
      return res.json({ ok: true, state: sc.state });
    }

    const toState = SUPPORT_CASE_STATE.RESOLVED;
    const result = await transitionSupportCase({
      caseId,
      toState,
      actorRole:        "super_admin",
      poolId:           sc.pool_id ?? null,
      reason:           "AGENT_RESOLVED",
      resolutionSource: "AGENT_CONFIRMED",
    });

    if (!result.ok) return res.status(result.status).json({ error: result.error });

    void logSupportEvent({
      eventType: SUPPORT_EVENT_TYPE.CASE_RESOLVED,
      caseId,
      ticketId:  sc.ticket_id ?? null,
      fromState: sc.state,
      toState,
      actorRole: "super_admin",
      poolId:    sc.pool_id ?? null,
    }).catch(() => {});

    res.json({ ok: true, state: toState });
  } catch (err) {
    console.error("[POST /super/support/cases/:id/resolve]", err);
    res.status(500).json({ error: "서버 오류" });
  }
});

// ── POST /super/support/cases/:id/phone-required ─────────────────────────────

const PHONE_REASONS = ["billing", "refund", "privacy_safety", "complex_case", "other"] as const;

router.post("/super/support/cases/:id/phone-required", requireAuth, SUPER, async (req: AuthRequest, res) => {
  const caseId = req.params.id;
  const { reason = "other" } = req.body as any;

  if (!PHONE_REASONS.includes(reason)) {
    return res.status(400).json({ error: `reason: ${PHONE_REASONS.join(" | ")}` });
  }

  try {
    const caseRows = (await (superAdminDb as any).execute(sql`
      SELECT id, pool_id, ticket_id, state
      FROM support_cases WHERE id = ${caseId} LIMIT 1
    `)) as any;
    const sc = caseRows?.rows?.[0];
    if (!sc) return res.status(404).json({ error: "케이스를 찾을 수 없습니다." });

    const result = await transitionSupportCase({
      caseId,
      toState:   SUPPORT_CASE_STATE.PHONE_REQUIRED,
      actorRole: "super_admin",
      poolId:    sc.pool_id ?? null,
      reason,
    });

    if (!result.ok) return res.status(result.status).json({ error: result.error });

    void logSupportEvent({
      eventType: SUPPORT_EVENT_TYPE.PHONE_REQUIRED,
      caseId,
      ticketId:  sc.ticket_id ?? null,
      fromState: sc.state,
      toState:   SUPPORT_CASE_STATE.PHONE_REQUIRED,
      actorRole: "super_admin",
      poolId:    sc.pool_id ?? null,
      reason,
    }).catch(() => {});

    res.json({ ok: true, state: SUPPORT_CASE_STATE.PHONE_REQUIRED, reason });
  } catch (err) {
    console.error("[POST /super/support/cases/:id/phone-required]", err);
    res.status(500).json({ error: "서버 오류" });
  }
});

// ── POST /super/support/cases/:id/reopen ─────────────────────────────────────

router.post("/super/support/cases/:id/reopen", requireAuth, SUPER, async (req: AuthRequest, res) => {
  const caseId = req.params.id;

  try {
    const caseRows = (await (superAdminDb as any).execute(sql`
      SELECT id, pool_id, ticket_id, state
      FROM support_cases WHERE id = ${caseId} LIMIT 1
    `)) as any;
    const sc = caseRows?.rows?.[0];
    if (!sc) return res.status(404).json({ error: "케이스를 찾을 수 없습니다." });

    const result = await transitionSupportCase({
      caseId,
      toState:   SUPPORT_CASE_STATE.REOPENED,
      actorRole: "super_admin",
      poolId:    sc.pool_id ?? null,
      reason:    "AGENT_REOPENED",
    });

    if (!result.ok) return res.status(result.status).json({ error: result.error });

    void logSupportEvent({
      eventType: SUPPORT_EVENT_TYPE.CASE_REOPENED,
      caseId,
      ticketId:  sc.ticket_id ?? null,
      fromState: sc.state,
      toState:   SUPPORT_CASE_STATE.REOPENED,
      actorRole: "super_admin",
      poolId:    sc.pool_id ?? null,
    }).catch(() => {});

    res.json({ ok: true, state: SUPPORT_CASE_STATE.REOPENED });
  } catch (err) {
    console.error("[POST /super/support/cases/:id/reopen]", err);
    res.status(500).json({ error: "서버 오류" });
  }
});

export default router;
