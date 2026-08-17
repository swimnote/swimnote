/**
 * support-cases.ts — CS-01R User-facing Support Case APIs
 *
 * Routes:
 *   POST /support/cases                    — AI-only case 생성
 *   GET  /support/cases/:id                — case 상세 (messages 포함)
 *   POST /support/cases/:id/messages       — 메시지 추가 (user/ai/agent/system)
 *   POST /support/cases/:id/request-human  — 상담사 요청 (ticket 생성 + 1:1 연결)
 *   POST /support/cases/:id/reopen         — 해결 케이스 재오픈
 *
 * 보안:
 *   - Pool isolation: 다른 pool의 case 조회/수정 금지
 *   - Role isolation: 자기 케이스만 접근 (super_admin은 전체)
 *   - ai/agent 메시지는 super_admin만 생성 가능
 *   - 중복 ticket 생성 방지 (idempotent request-human)
 */

import { Router } from "express";
import { superAdminDb, db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";
import {
  ensureCs01rSchema,
  VALID_TRANSITIONS,
  getMasterState,
  logSupportEvent,
  transitionSupportCase,
  messageThreadId,
} from "../lib/support-case-service.js";
import { SUPPORT_CASE_STATE, SUPPORT_EVENT_TYPE } from "../lib/ai-feature-enum.js";

const router = Router();

// Startup schema migration
ensureCs01rSchema().catch(console.error);

// ── Helpers ────────────────────────────────────────────────────────────────────

function isSuperAdmin(role: string | undefined) {
  return role === "super_admin" || role === "platform_admin";
}

const VALID_AUTHOR_ROLES = ["user", "ai", "agent", "system"] as const;

// ── POST /support/cases ───────────────────────────────────────────────────────
// AI-only case 생성. ticket 없음, ticket_id = null.

router.post("/support/cases", requireAuth, async (req: AuthRequest, res) => {
  const user     = req.user!;
  const poolId   = user.poolId  ?? null;
  const actorId  = user.userId  ?? "";
  const actorRole= user.role    ?? "unknown";
  const { mode, context = {} } = req.body as any;

  try {
    const caseId = `sc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // AVAILABLE context only — no PII, no raw text
    const contextJson = {
      user_role:         actorRole,
      service_mode:      mode         ?? null,
      xmode_enabled:     mode === "x",
      subscription_plan: (context as any).subscription_plan ?? null,
      app_version:       (context as any).app_version       ?? null,
      feature_id:        (context as any).feature_id        ?? null,
    };

    await (superAdminDb as any).execute(sql`
      INSERT INTO support_cases
        (id, pool_id, actor_id, ticket_id, actor_role, mode, state, context_json)
      VALUES
        (${caseId}, ${poolId}, ${actorId}, ${null}, ${actorRole}, ${mode ?? null},
         ${SUPPORT_CASE_STATE.NEW}, ${JSON.stringify(contextJson)}::jsonb)
    `);

    // Best-effort support event
    void logSupportEvent({
      eventType: SUPPORT_EVENT_TYPE.CASE_CREATED,
      caseId,
      ticketId:  null,
      fromState: "",
      toState:   SUPPORT_CASE_STATE.NEW,
      actorRole,
      poolId,
    }).catch(() => {});

    res.json({ ok: true, id: caseId });
  } catch (err) {
    console.error("[POST /support/cases]", err);
    res.status(500).json({ error: "서버 오류" });
  }
});

// ── GET /support/cases/:id ────────────────────────────────────────────────────
// case 상세 + messages + ticket (§21 conversation history 구조)

router.get("/support/cases/:id", requireAuth, async (req: AuthRequest, res) => {
  const user    = req.user!;
  const caseId  = req.params.id;
  const actorId = user.userId;
  const isSuper = isSuperAdmin(user.role);

  try {
    const caseRows = (await (superAdminDb as any).execute(sql`
      SELECT id, pool_id, actor_id, ticket_id, actor_role, mode, state,
             escalation_reason, resolution_source, llm_used, turn_count,
             waiting_for, context_json,
             resolved_at::text, created_at::text, updated_at::text
      FROM support_cases
      WHERE id = ${caseId}
      LIMIT 1
    `)) as any;

    const sc = caseRows?.rows?.[0];
    if (!sc) return res.status(404).json({ error: "케이스를 찾을 수 없습니다." });

    // §15 Tenant isolation + §16 Role isolation
    if (!isSuper) {
      const ownerMismatch = sc.actor_id && sc.actor_id !== actorId;
      const poolMismatch  = sc.pool_id  && sc.pool_id  !== (user.poolId ?? "");
      if (ownerMismatch || poolMismatch) {
        return res.status(403).json({ error: "접근 권한이 없습니다." });
      }
    }

    const threadId = messageThreadId(caseId, sc.ticket_id);

    // Load messages from pool db (keyed by threadId)
    let messages: any[] = [];
    try {
      const msgRows = (await (db as any).execute(sql`
        SELECT id, ticket_id, author_user_id, author_name,
               author_role, message_type, content, image_urls, created_at::text
        FROM support_ticket_replies
        WHERE ticket_id = ${threadId}
        ORDER BY created_at ASC
      `)) as any;
      messages = msgRows?.rows ?? [];
    } catch {
      // pool db 조회 실패 — case는 반환, messages 빈 배열
    }

    // Load linked ticket
    let ticket: any = null;
    if (sc.ticket_id) {
      try {
        const tRows = (await (db as any).execute(sql`
          SELECT id, subject, status, ticket_type, consultation_requested, created_at::text
          FROM support_tickets WHERE id = ${sc.ticket_id} LIMIT 1
        `)) as any;
        ticket = tRows?.rows?.[0] ?? null;
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
    console.error("[GET /support/cases/:id]", err);
    res.status(500).json({ error: "서버 오류" });
  }
});

// ── POST /support/cases/:id/messages ─────────────────────────────────────────
// 메시지 추가. ai/agent 작성은 super_admin만 가능.

router.post("/support/cases/:id/messages", requireAuth, async (req: AuthRequest, res) => {
  const user    = req.user!;
  const caseId  = req.params.id;
  const actorId = user.userId;
  const isSuper = isSuperAdmin(user.role);

  const { content, author_role, message_type, image_urls } = req.body as any;
  if (!content) return res.status(400).json({ error: "content 필수" });

  const role: string = author_role ?? "user";
  if (!VALID_AUTHOR_ROLES.includes(role as any)) {
    return res.status(400).json({ error: "author_role: user/ai/agent/system" });
  }

  // ai/agent 메시지는 super_admin만
  if ((role === "ai" || role === "agent") && !isSuper) {
    return res.status(403).json({ error: "ai/agent 메시지는 관리자만 작성 가능합니다." });
  }

  try {
    // Fetch case for ownership check + thread key
    const caseRows = (await (superAdminDb as any).execute(sql`
      SELECT actor_id, pool_id, ticket_id, state
      FROM support_cases WHERE id = ${caseId} LIMIT 1
    `)) as any;
    const sc = caseRows?.rows?.[0];
    if (!sc) return res.status(404).json({ error: "케이스를 찾을 수 없습니다." });

    // §15 + §16 isolation
    if (!isSuper) {
      const ownerMismatch = sc.actor_id && sc.actor_id !== actorId;
      const poolMismatch  = sc.pool_id  && sc.pool_id  !== (user.poolId ?? "");
      if (ownerMismatch || poolMismatch) {
        return res.status(403).json({ error: "접근 권한이 없습니다." });
      }
    }

    const threadId = messageThreadId(caseId, sc.ticket_id);
    const msgId    = `rep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const images   = Array.isArray(image_urls) ? image_urls.slice(0, 3) : [];
    const imgsLit  = `{${images
      .map((u: string) => `"${String(u).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
      .join(",")}}`;

    await (db as any).execute(sql.raw(`
      INSERT INTO support_ticket_replies
        (id, ticket_id, author_user_id, author_name, author_role, message_type, content, image_urls)
      VALUES ($1, $2, $3, $4, $5, $6, $7, '${imgsLit}'::text[])
    `, [
      msgId,
      threadId,
      actorId,
      user.name ?? "",
      role,
      message_type ?? role,
      content,
    ]));

    // Increment turn_count (best-effort)
    await (superAdminDb as any).execute(sql`
      UPDATE support_cases
      SET turn_count = turn_count + 1, updated_at = NOW()
      WHERE id = ${caseId}
    `).catch(() => {});

    // Support event — best-effort, no content in analytics
    const evtType = role === "ai"     ? SUPPORT_EVENT_TYPE.AI_RESPONDED
                  : role === "agent"  ? SUPPORT_EVENT_TYPE.AGENT_RESPONDED
                  : SUPPORT_EVENT_TYPE.USER_RESPONDED;

    void logSupportEvent({
      eventType: evtType,
      caseId,
      ticketId:  sc.ticket_id ?? null,
      fromState: sc.state,
      toState:   sc.state,
      actorRole: role,
      poolId:    sc.pool_id ?? null,
    }).catch(() => {});

    res.json({ ok: true, id: msgId });
  } catch (err) {
    console.error("[POST /support/cases/:id/messages]", err);
    res.status(500).json({ error: "서버 오류" });
  }
});

// ── POST /support/cases/:id/request-human ────────────────────────────────────
// 상담사 요청 — support_ticket 생성 후 case에 1:1 연결.
// 이미 ticket이 있으면 중복 생성 금지 (idempotent).

router.post("/support/cases/:id/request-human", requireAuth, async (req: AuthRequest, res) => {
  const user    = req.user!;
  const caseId  = req.params.id;
  const actorId = user.userId;
  const isSuper = isSuperAdmin(user.role);

  const { reason, subject, description } = req.body as any;

  try {
    const caseRows = (await (superAdminDb as any).execute(sql`
      SELECT actor_id, pool_id, ticket_id, actor_role, state
      FROM support_cases WHERE id = ${caseId} LIMIT 1
    `)) as any;
    const sc = caseRows?.rows?.[0];
    if (!sc) return res.status(404).json({ error: "케이스를 찾을 수 없습니다." });

    // §15 + §16 isolation
    if (!isSuper) {
      const ownerMismatch = sc.actor_id && sc.actor_id !== actorId;
      const poolMismatch  = sc.pool_id  && sc.pool_id  !== (user.poolId ?? "");
      if (ownerMismatch || poolMismatch) {
        return res.status(403).json({ error: "접근 권한이 없습니다." });
      }
    }

    // §20 Idempotent: 이미 ticket 연결됐으면 중복 생성 금지
    if (sc.ticket_id) {
      return res.json({ ok: true, ticket_id: sc.ticket_id, created: false });
    }

    // Valid transition 확인
    const allowed = VALID_TRANSITIONS[sc.state] ?? [];
    if (!allowed.includes(SUPPORT_CASE_STATE.HUMAN_REQUIRED)) {
      return res.status(422).json({
        error: `${sc.state} 상태에서 상담사 요청 전환 불가`,
      });
    }

    // Create support_ticket (pool db) — §20 기존 ticket creation code 재사용 패턴
    const ticketId = `tkt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await (db as any).execute(sql`
      INSERT INTO support_tickets
        (id, ticket_type, requester_type, requester_name, pool_id,
         subject, description, sla_hours, submitter_user_id, consultation_requested, status)
      VALUES
        (${ticketId}, ${"support_case"}, ${sc.actor_role}, ${user.name ?? ""},
         ${user.poolId ?? null},
         ${subject ?? "AI 문의 상담 요청"}, ${description ?? null},
         ${24}, ${actorId}, ${true}, ${"open"})
    `);

    // Link case → ticket + transition state (single UPDATE)
    await (superAdminDb as any).execute(sql`
      UPDATE support_cases
      SET ticket_id         = ${ticketId},
          state             = ${SUPPORT_CASE_STATE.HUMAN_REQUIRED},
          escalation_reason = ${reason ?? "USER_REQUESTED_HUMAN"},
          updated_at        = NOW()
      WHERE id = ${caseId}
    `);

    // Support event — best-effort
    void logSupportEvent({
      eventType: SUPPORT_EVENT_TYPE.HUMAN_REQUESTED,
      caseId,
      ticketId,
      fromState: sc.state,
      toState:   SUPPORT_CASE_STATE.HUMAN_REQUIRED,
      actorRole: user.role ?? "unknown",
      poolId:    user.poolId ?? null,
      reason:    reason ?? "USER_REQUESTED_HUMAN",
    }).catch(() => {});

    res.json({ ok: true, ticket_id: ticketId, created: true });
  } catch (err) {
    console.error("[POST /support/cases/:id/request-human]", err);
    res.status(500).json({ error: "서버 오류" });
  }
});

// ── POST /support/cases/:id/reopen ────────────────────────────────────────────
// 해결/종료된 케이스 재오픈. RESOLVED → REOPENED.

router.post("/support/cases/:id/reopen", requireAuth, async (req: AuthRequest, res) => {
  const user    = req.user!;
  const caseId  = req.params.id;
  const actorId = user.userId;
  const isSuper = isSuperAdmin(user.role);

  try {
    const caseRows = (await (superAdminDb as any).execute(sql`
      SELECT actor_id, pool_id, ticket_id, state
      FROM support_cases WHERE id = ${caseId} LIMIT 1
    `)) as any;
    const sc = caseRows?.rows?.[0];
    if (!sc) return res.status(404).json({ error: "케이스를 찾을 수 없습니다." });

    // §16 Role isolation (super_admin은 전체 가능)
    if (!isSuper) {
      const ownerMismatch = sc.actor_id && sc.actor_id !== actorId;
      const poolMismatch  = sc.pool_id  && sc.pool_id  !== (user.poolId ?? "");
      if (ownerMismatch || poolMismatch) {
        return res.status(403).json({ error: "접근 권한이 없습니다." });
      }
    }

    const result = await transitionSupportCase({
      caseId,
      toState:   SUPPORT_CASE_STATE.REOPENED,
      actorRole: user.role ?? "unknown",
      poolId:    sc.pool_id ?? null,
      reason:    "USER_REOPENED",
    });

    if (!result.ok) return res.status(result.status).json({ error: result.error });

    void logSupportEvent({
      eventType: SUPPORT_EVENT_TYPE.CASE_REOPENED,
      caseId,
      ticketId:  sc.ticket_id ?? null,
      fromState: sc.state,
      toState:   SUPPORT_CASE_STATE.REOPENED,
      actorRole: user.role ?? "unknown",
      poolId:    sc.pool_id ?? null,
    }).catch(() => {});

    res.json({ ok: true });
  } catch (err) {
    console.error("[POST /support/cases/:id/reopen]", err);
    res.status(500).json({ error: "서버 오류" });
  }
});

export default router;
