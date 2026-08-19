/**
 * support-cases.ts — CS-01R (HARDEN) User-facing Support Case APIs
 *
 * HARDEN 핵심 변경:
 *   - case_id 컬럼 도입: support_ticket_replies.case_id = 케이스 기준 스레드 식별자
 *   - ticket_id는 실제 ticket이 있을 때만 저장 (nullable)
 *   - AI-only 메시지: ticket_id=null, case_id=<caseId>
 *   - 에스컬레이션 후 메시지: ticket_id=<ticketId>, case_id=<caseId>
 *   - GET 케이스 상세 메시지 조회: WHERE case_id=<caseId> OR (ticket_id=<ticketId> AND case_id IS NULL)
 *     → 케이스 메시지 + 레거시 경로 agent reply 모두 포함, 중복 없음
 *
 * Routes:
 *   POST /support/cases                    — AI-only case 생성
 *   GET  /support/cases/:id                — case 상세 (messages 포함)
 *   POST /support/cases/:id/messages       — 메시지 추가 (user/ai/agent/system)
 *   POST /support/cases/:id/request-human  — 상담사 요청 (ticket 생성 + case 연결)
 *   POST /support/cases/:id/reopen         — 해결 케이스 재오픈
 *
 * 보안:
 *   - Pool isolation: 다른 pool의 case 접근 금지
 *   - Owner isolation: 자기 케이스만 접근 (super_admin은 전체)
 *   - ai/agent 메시지는 super_admin만 작성 가능
 *   - request-human idempotent: 이미 ticket 있으면 중복 생성 금지
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
} from "../lib/support-case-service.js";
import { SUPPORT_CASE_STATE, SUPPORT_EVENT_TYPE } from "../lib/ai-feature-enum.js";
import { resolvePoolMode } from "../lib/xmode.js";
import { sendPushToSuperAdmins, sendPushToUser } from "../lib/push-service.js";
import { getOpenAI } from "./ai.js";
import { gatherEvidence, normalizeQuery, tokenize, type RouterContext } from "../lib/support-resolver.js";
import {
  getSupportSequence,
  redactConversationForGrounding,
  saveSupportSequence,
  type SupportSequence,
} from "../lib/support-escalation.js";
import { saveAiTrace } from "../lib/ai-trace-service.js";
import { AI_FEATURE } from "../lib/ai-feature-enum.js";
import { logSupportOutcome, logSupportQuery } from "../lib/support-candidate-engine.js";

const router = Router();

// Startup schema migration (idempotent)
ensureCs01rSchema().catch(console.error);

// ── Helpers ────────────────────────────────────────────────────────────────────

function isSuperAdmin(role: string | undefined) {
  return role === "super_admin" || role === "platform_admin";
}

const VALID_AUTHOR_ROLES = ["user", "ai", "agent", "system"] as const;
const SUPPORT_GPT_MODEL = "gpt-4o-mini";

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function isValidCallbackNumber(value: unknown): value is string {
  return typeof value === "string" && /^[0-9+\-\s()]{8,24}$/.test(value);
}

async function insertInternalCaseMessage(params: {
  caseId: string;
  ticketId: string | null;
  content: string;
  messageType: string;
}): Promise<void> {
  await (db as any).execute(sql`
    INSERT INTO support_ticket_replies
      (id, ticket_id, case_id, author_user_id, author_name, author_role, message_type, content, image_urls)
    VALUES (
      ${makeId("rep")}, ${params.ticketId}, ${params.caseId}, ${null}, ${"AI"},
      ${"ai"}, ${params.messageType}, ${params.content}, '{}'::text[]
    )
  `);
}

function parseGptAnswer(raw: string, allowedEvidenceIds: Set<string>): string | null {
  try {
    const parsed = JSON.parse(raw);
    const answer = typeof parsed.answer === "string" ? parsed.answer.trim() : "";
    const refs = Array.isArray(parsed.used_evidence_ids) ? parsed.used_evidence_ids : [];
    const onlyKnownRefs = refs.length > 0 && refs.every((id: unknown) =>
      typeof id === "string" && allowedEvidenceIds.has(id)
    );
    return answer && onlyKnownRefs ? answer : null;
  } catch {
    return null;
  }
}

// ── POST /support/cases ───────────────────────────────────────────────────────
// AI-only case 생성. ticket 없음, ticket_id = null.

router.post("/support/cases", requireAuth, async (req: AuthRequest, res) => {
  const user      = req.user!;
  const poolId    = user.poolId  ?? null;
  const actorId   = user.userId  ?? "";
  const actorRole = user.role    ?? "unknown";
  const { mode: clientMode, context = {} } = req.body as any;

  // CS13-P1: Server-authoritative mode — client-sent mode는 참고값. pool이 있으면 DB에서 실제 mode를 결정.
  // super_admin/platform_admin은 poolId가 없으므로 client mode를 신뢰.
  let resolvedMode: string = ((clientMode ?? "normal") as string).toLowerCase();
  if (poolId && !isSuperAdmin(actorRole)) {
    try {
      const poolModeResult = await resolvePoolMode(poolId);
      if (poolModeResult) resolvedMode = poolModeResult.mode;
    } catch {
      // non-fatal: pool mode DB 조회 실패 시 client mode fallback
    }
  }

  try {
    const caseId = `sc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // context: PII 제외 (본문·이름·전화·이메일 저장 금지)
    const contextJson = {
      user_role:         actorRole,
      service_mode:      resolvedMode,
      xmode_enabled:     resolvedMode === "x",
      subscription_plan: (context as any).subscription_plan ?? null,
      app_version:       (context as any).app_version       ?? null,
      feature_id:        (context as any).feature_id        ?? null,
    };

    await (superAdminDb as any).execute(sql`
      INSERT INTO support_cases
        (id, pool_id, actor_id, ticket_id, actor_role, mode, state, context_json)
      VALUES
        (${caseId}, ${poolId}, ${actorId}, ${null}, ${actorRole}, ${resolvedMode},
         ${SUPPORT_CASE_STATE.NEW}, ${JSON.stringify(contextJson)}::jsonb)
    `);

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
// case 상세 + messages (thread continuity 보장)
//
// 메시지 조회 전략:
//   1. case_id = caseId → AI/User 메시지 + support-cases.ts 경유 에스컬레이션 메시지
//   2. ticket_id = ticketId AND case_id IS NULL → 레거시 support-tickets.ts 경유 agent reply
//   UNION 후 created_at ASC 정렬 → 중복 없는 단일 시간순 대화 이력

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

    // Tenant + owner isolation
    if (!isSuper) {
      const ownerMismatch = sc.actor_id && sc.actor_id !== actorId;
      const poolMismatch  = sc.pool_id  && sc.pool_id  !== (user.poolId ?? "");
      if (ownerMismatch || poolMismatch) {
        return res.status(403).json({ error: "접근 권한이 없습니다." });
      }
    }

    // ── Thread continuity query ──────────────────────────────────────────────
    // HARDEN: case_id 기준 조회 (ticket_id 위장 저장 금지)
    // 레거시 support-tickets.ts 경로로 들어온 agent reply (case_id=null)도 포함
    let messages: any[] = [];
    try {
      const ticketId = sc.ticket_id ?? null;

      let msgRows: any;
      if (ticketId) {
        // 에스컬레이션 케이스: case_id 메시지 + 레거시 ticket 경로 메시지 통합
        msgRows = (await (db as any).execute(sql`
          SELECT id, ticket_id, case_id, author_user_id, author_name,
                 author_role, message_type, content, image_urls, created_at::text
          FROM support_ticket_replies
          WHERE case_id = ${caseId}
             OR (ticket_id = ${ticketId} AND case_id IS NULL)
          ORDER BY created_at ASC
        `)) as any;
      } else {
        // AI-only case: case_id 기준
        msgRows = (await (db as any).execute(sql`
          SELECT id, ticket_id, case_id, author_user_id, author_name,
                 author_role, message_type, content, image_urls, created_at::text
          FROM support_ticket_replies
          WHERE case_id = ${caseId}
          ORDER BY created_at ASC
        `)) as any;
      }
      messages = msgRows?.rows ?? [];
    } catch (msgErr) {
      // support_ticket_replies 조회 실패 — messages 없이 200은 금지
      // (DBSRC §7/§9: 필수 DB read 실패 시 silent empty 금지)
      console.error("[GET /support/cases/:id] message query failed:", msgErr);
      return res.status(500).json({ error: "메시지 조회 실패", code: "MSG_QUERY_FAILED" });
    }

    // Linked ticket
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
// 메시지 추가.
// HARDEN: ticket_id 컬럼에 case_id를 저장하지 않는다.
//   - AI-only case: ticket_id=null, case_id=caseId
//   - 에스컬레이션 케이스: ticket_id=sc.ticket_id, case_id=caseId

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
    const caseRows = (await (superAdminDb as any).execute(sql`
      SELECT actor_id, pool_id, ticket_id, state
      FROM support_cases WHERE id = ${caseId} LIMIT 1
    `)) as any;
    const sc = caseRows?.rows?.[0];
    if (!sc) return res.status(404).json({ error: "케이스를 찾을 수 없습니다." });

    // Tenant + owner isolation
    if (!isSuper) {
      const ownerMismatch = sc.actor_id && sc.actor_id !== actorId;
      const poolMismatch  = sc.pool_id  && sc.pool_id  !== (user.poolId ?? "");
      if (ownerMismatch || poolMismatch) {
        return res.status(403).json({ error: "접근 권한이 없습니다." });
      }
    }

    const msgId = `rep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const images = Array.isArray(image_urls) ? image_urls.slice(0, 3) : [];
    const imgsLit = `{${images
      .map((u: string) => `"${String(u).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
      .join(",")}}`;

    // HARDEN: case_id 컬럼 사용, ticket_id는 실제 ticket ID만 저장
    const insertTicketId: string | null = sc.ticket_id ?? null;

    // FIXED: sql.raw(template, params) — drizzle ignores second arg → $1 unbound → 42P02
    // Use sql template literal so drizzle binds each ${value} as a proper $N parameter.
    await (db as any).execute(sql`
      INSERT INTO support_ticket_replies
        (id, ticket_id, case_id, author_user_id, author_name, author_role, message_type, content, image_urls)
      VALUES (
        ${msgId},
        ${insertTicketId},
        ${caseId},
        ${actorId},
        ${user.name ?? ""},
        ${role},
        ${message_type ?? role},
        ${content},
        ${sql.raw(`'${imgsLit}'::text[]`)}
      )
    `);

    // turn_count 증가 (best-effort)
    await (superAdminDb as any).execute(sql`
      UPDATE support_cases
      SET turn_count = turn_count + 1, updated_at = NOW()
      WHERE id = ${caseId}
    `).catch(() => {});

    const evtType = role === "ai"    ? SUPPORT_EVENT_TYPE.AI_RESPONDED
                  : role === "agent" ? SUPPORT_EVENT_TYPE.AGENT_RESPONDED
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

// ── POST /support/cases/:id/gpt-escalation ───────────────────────────────────
// WP-CS26: explicit, second-stage grounded consultation. This route is the only
// support route allowed to call GPT. It neither creates a human ticket nor sends
// a Super Admin notification.

router.post("/support/cases/:id/gpt-escalation", requireAuth, async (req: AuthRequest, res) => {
  const user = req.user!;
  const caseId = req.params.id;
  const isSuper = isSuperAdmin(user.role);

  try {
    const caseRows = (await (superAdminDb as any).execute(sql`
      SELECT id, actor_id, pool_id, ticket_id, actor_role, mode, state, context_json
      FROM support_cases WHERE id = ${caseId} LIMIT 1
    `)) as any;
    const sc = caseRows?.rows?.[0];
    if (!sc) return res.status(404).json({ error: "케이스를 찾을 수 없습니다." });

    if (!isSuper) {
      const ownerMismatch = sc.actor_id && sc.actor_id !== user.userId;
      const poolMismatch = sc.pool_id && sc.pool_id !== (user.poolId ?? "");
      if (ownerMismatch || poolMismatch) {
        return res.status(403).json({ error: "접근 권한이 없습니다." });
      }
    }
    if (sc.ticket_id) {
      return res.status(409).json({ error: "담당자가 확인 중인 문의입니다." });
    }

    const sequence = getSupportSequence(sc.context_json);
    if (!sequence.inquiry_offered || sequence.same_intent_streak < 3) {
      return res.status(422).json({ error: "동일 문제가 3회 연속 확인된 후에만 추가 상담을 시작할 수 있습니다." });
    }

    const messageRows = (await (db as any).execute(sql`
      SELECT author_role, content
      FROM support_ticket_replies
      WHERE case_id = ${caseId}
      ORDER BY created_at DESC
      LIMIT 8
    `)) as any;
    const recentMessages = [...(messageRows?.rows ?? [])].reverse();
    const latestUserMessage = [...recentMessages].reverse().find((m: any) => m.author_role === "user");
    if (!latestUserMessage?.content?.trim()) {
      return res.status(422).json({ error: "추가 상담에 사용할 현재 문의를 찾을 수 없습니다." });
    }

    const normalized = normalizeQuery(String(latestUserMessage.content));
    const ctx: RouterContext = {
      query: String(latestUserMessage.content),
      role: sc.actor_role ?? user.role ?? "unknown",
      mode: String(sc.mode ?? "normal").toLowerCase(),
      poolId: sc.pool_id ?? user.poolId ?? null,
      screenId: null,
      appVersion: null,
      qLower: normalized,
      tokens: tokenize(normalized),
      previousContext: (sc.context_json as any)?.resolution_context ?? null,
    };

    const processing: SupportSequence = {
      ...sequence,
      inquiry_offered: false,
      gpt_status: "PROCESSING",
      updated_at: new Date().toISOString(),
    };
    await saveSupportSequence(caseId, processing);
    await transitionSupportCase({
      caseId,
      toState: SUPPORT_CASE_STATE.AI_PROCESSING,
      actorRole: "system",
      poolId: sc.pool_id ?? user.poolId ?? null,
    }).catch(() => {});
    void logSupportEvent({
      eventType: "GPT_ESCALATION_REQUESTED",
      caseId,
      ticketId: null,
      fromState: sc.state,
      toState: SUPPORT_CASE_STATE.AI_PROCESSING,
      actorRole: "system",
      poolId: sc.pool_id ?? user.poolId ?? null,
    }).catch(() => {});

    const evidence = await gatherEvidence(ctx, 5);
    const evidenceIds = new Set(evidence.map((item) => item.id));
    const previousConversation = recentMessages
      .slice(-6)
      .map((m: any) => `${m.author_role === "user" ? "사용자" : "기존 안내"}: ${redactConversationForGrounding(String(m.content ?? ""))}`)
      .join("\n");

    let answer = "현재 확인 가능한 안내만으로는 이 문제를 정확히 해결하기 어렵습니다.";
    let llmCalled = false;
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    let totalTokens: number | null = null;

    if (evidence.length > 0) {
      const evidenceBlock = evidence.map((item) =>
        `[${item.id}] rev ${item.revision} / ${item.item_type}\n${item.answer}`
      ).join("\n\n");
      const systemPrompt = `당신은 SWIMNOTE의 2차 고객지원 상담사입니다.
반드시 아래 검증 근거만 이용해 사용자의 현재 상황에 맞는 다음 해결 단계를 한국어 존댓말로 안내하세요.
근거에 없는 기능, 정책, 가격, 환불 규칙, UI 경로, 권한, 장애 원인, 처리 시간을 만들지 마세요.
이전에 안내된 내용은 그대로 반복하지 말고, 검증 근거에서 가능한 다음 확인 순서를 구성하세요.
근거가 충분하지 않다면 answer에 정확히 "현재 확인 가능한 안내만으로는 이 문제를 정확히 해결하기 어렵습니다."라고 쓰세요.
반드시 JSON만 반환하세요: {"answer":"...", "used_evidence_ids":["검증 근거 ID"]}.

[검증 근거]
${evidenceBlock}

[같은 문의의 최근 대화]
${previousConversation}`;

      try {
        const completion = await getOpenAI().chat.completions.create({
          model: SUPPORT_GPT_MODEL,
          messages: [{ role: "system", content: systemPrompt }],
          response_format: { type: "json_object" },
          temperature: 0.2,
          max_tokens: 420,
        });
        inputTokens = completion.usage?.prompt_tokens ?? null;
        outputTokens = completion.usage?.completion_tokens ?? null;
        totalTokens = completion.usage?.total_tokens ?? null;
        const parsedAnswer = parseGptAnswer(
          completion.choices[0]?.message?.content ?? "{}",
          evidenceIds
        );
        if (parsedAnswer) {
          answer = parsedAnswer;
          llmCalled = true;
        }
      } catch {
        // No provider error detail or prompts are logged. The user receives the
        // same evidence-insufficient path and can decide whether it is unresolved.
      }
    }

    await insertInternalCaseMessage({
      caseId,
      ticketId: null,
      content: answer,
      messageType: "ai_gpt_grounded",
    });

    const responded: SupportSequence = {
      ...processing,
      gpt_status: "RESPONDED",
      gpt_request_id: makeId("gpt"),
      retrieved_knowledge_ids: evidence.map((item) => item.id),
      knowledge_revisions: Object.fromEntries(evidence.map((item) => [item.id, item.revision])),
      previous_answers_used: recentMessages.filter((m: any) => m.author_role !== "user").length,
      updated_at: new Date().toISOString(),
    };
    await saveSupportSequence(caseId, responded);
    await transitionSupportCase({
      caseId,
      toState: SUPPORT_CASE_STATE.AI_RESPONDED,
      actorRole: "system",
      poolId: sc.pool_id ?? user.poolId ?? null,
      resolutionSource: "GPT_GROUNDED",
    }).catch(() => {});

    await saveAiTrace({
      request_id: makeId("req_sup_gpt"),
      internal_id: makeId("trace_sup_gpt"),
      pool_id: sc.pool_id ?? "",
      actor_id: user.userId,
      contract_version: "CS26-v1",
      feature: AI_FEATURE.SUPPORT_AI,
      sub_feature: "SUPPORT_GPT_SECOND_STAGE",
      pool_mode: ctx.mode,
      user_role: ctx.role,
      provider: "openai",
      source_app: "app",
      status: "SUCCESS",
      generation_mode: llmCalled ? "llm_grounded_second_stage" : "insufficient_grounding",
      model: llmCalled ? SUPPORT_GPT_MODEL : null,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      knowledge_hit_count: evidence.length,
      result_generated: llmCalled,
      latency_ms: 0,
    }).catch(() => {});

    void logSupportQuery({
      caseId,
      normalizedQuery: normalized,
      representativeQuery: normalized.substring(0, 200),
      resolutionSource: "GPT_SECOND_STAGE",
      matchedKnowledgeId: evidence[0]?.id ?? null,
      matchConfidence: evidence[0]?.score ?? null,
      llmCalled,
      humanRequested: false,
      finalCaseState: SUPPORT_CASE_STATE.AI_RESPONDED,
      role: ctx.role,
      mode: ctx.mode,
      poolId: ctx.poolId,
    }).catch(() => {});
    void logSupportOutcome(caseId, "GPT_ESCALATION_ACCEPTED").catch(() => {});

    return res.json({
      ok: true,
      answer,
      llm_called: llmCalled,
      evidence_count: evidence.length,
      case_state: SUPPORT_CASE_STATE.AI_RESPONDED,
      requires_resolution_confirmation: true,
      meta: {
        trace: {
          retrieved_knowledge_ids: evidence.map((item) => item.id),
          knowledge_revisions: Object.fromEntries(evidence.map((item) => [item.id, item.revision])),
        },
      },
    });
  } catch (err) {
    console.error("[POST /support/cases/:id/gpt-escalation]", err);
    return res.status(500).json({ error: "추가 상담 처리 중 오류가 발생했습니다." });
  }
});

// ── POST /support/cases/:id/request-human ────────────────────────────────────
// 상담사 요청 — support_ticket 생성 + case에 1:1 연결.
// 기존 AI/User 메시지 (case_id 기준)는 이후에도 GET에서 그대로 보임 (continuity 보장).

router.post("/support/cases/:id/request-human", requireAuth, async (req: AuthRequest, res) => {
  const user    = req.user!;
  const caseId  = req.params.id;
  const actorId = user.userId;
  const isSuper = isSuperAdmin(user.role);

  const {
    reason,
    subject,
    description,
    confirmation,
    callback_requested,
    callback_phone,
    callback_consent,
  } = req.body as any;

  try {
    const caseRows = (await (superAdminDb as any).execute(sql`
      SELECT actor_id, pool_id, ticket_id, actor_role, state, context_json
      FROM support_cases WHERE id = ${caseId} LIMIT 1
    `)) as any;
    const sc = caseRows?.rows?.[0];
    if (!sc) return res.status(404).json({ error: "케이스를 찾을 수 없습니다." });

    if (!isSuper) {
      const ownerMismatch = sc.actor_id && sc.actor_id !== actorId;
      const poolMismatch  = sc.pool_id  && sc.pool_id  !== (user.poolId ?? "");
      if (ownerMismatch || poolMismatch) {
        return res.status(403).json({ error: "접근 권한이 없습니다." });
      }
    }

    // Idempotent: 이미 ticket 있으면 중복 생성 금지
    if (sc.ticket_id) {
      return res.json({ ok: true, ticket_id: sc.ticket_id, created: false });
    }

    // WP-CS26: no direct client-side bypass. A human case may be opened only
    // after the separate grounded GPT response and the user's explicit
    // unresolved confirmation.
    const sequence = getSupportSequence(sc.context_json);
    if (confirmation !== "GPT_UNRESOLVED" || sequence.gpt_status !== "RESPONDED") {
      return res.status(422).json({
        error: "추가 상담 답변 후 '아직 해결되지 않았어요'를 선택한 경우에만 담당자에게 전달됩니다.",
      });
    }
    if (callback_requested && (!callback_consent || !isValidCallbackNumber(callback_phone))) {
      return res.status(400).json({
        error: "전화 상담을 원하시면 연락처를 직접 입력하고 연락 동의가 필요합니다.",
      });
    }

    const allowed = VALID_TRANSITIONS[sc.state] ?? [];
    if (!allowed.includes(SUPPORT_CASE_STATE.HUMAN_REQUIRED)) {
      return res.status(422).json({
        error: `${sc.state} 상태에서 상담사 요청 전환 불가`,
      });
    }

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

    // The optional callback number remains on this case only. It is never
    // copied into event logs, push previews, query learning, or knowledge.
    const callbackContext = callback_requested
      ? {
          requested: true,
          phone: String(callback_phone),
          consented_at: new Date().toISOString(),
        }
      : { requested: false };
    await (superAdminDb as any).execute(sql`
      UPDATE support_cases
      SET ticket_id         = ${ticketId},
          state             = ${SUPPORT_CASE_STATE.HUMAN_REQUIRED},
          escalation_reason = ${reason ?? "USER_REQUESTED_HUMAN"},
          context_json      = COALESCE(context_json, '{}'::jsonb)
            || jsonb_build_object('cs26_callback', ${JSON.stringify(callbackContext)}::jsonb),
          updated_at        = NOW()
      WHERE id = ${caseId}
    `);

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

    // CS23A: Super Admin Push — HUMAN_CASE_WITHOUT_ADMIN_NOTIFICATION = 0
    void sendPushToSuperAdmins(
      "새 직접 문의",
      "새 고객 문의가 접수되었습니다.",
      { case_id: caseId, ticket_id: ticketId, actor_role: sc.actor_role ?? "unknown" }
    ).catch(() => {});
    void logSupportOutcome(caseId, "HUMAN_ESCALATED_AFTER_GPT").catch(() => {});

    res.json({ ok: true, ticket_id: ticketId, created: true });
  } catch (err) {
    console.error("[POST /support/cases/:id/request-human]", err);
    res.status(500).json({ error: "서버 오류" });
  }
});

// ── POST /support/cases/:id/agent-reply ──────────────────────────────────────
// Super Admin이 직접 문의 케이스에 답변. 동일 conversation 유지.
// 답변 후 actor에게 Push 전송 — AGENT_REPLY_WITHOUT_USER_NOTIFICATION = 0.

router.post("/support/cases/:id/agent-reply", requireAuth, async (req: AuthRequest, res) => {
  const user    = req.user!;
  const caseId  = req.params.id;
  const isSuper = isSuperAdmin(user.role);

  if (!isSuper) {
    return res.status(403).json({ error: "슈퍼관리자만 답변할 수 있습니다." });
  }

  const { content } = req.body as any;
  if (!content?.trim()) {
    return res.status(400).json({ error: "답변 내용 필수" });
  }

  try {
    const caseRows = (await (superAdminDb as any).execute(sql`
      SELECT actor_id, pool_id, ticket_id, actor_role, state
      FROM support_cases WHERE id = ${caseId} LIMIT 1
    `)) as any;
    const sc = caseRows?.rows?.[0];
    if (!sc) return res.status(404).json({ error: "케이스를 찾을 수 없습니다." });

    const terminal = ["RESOLVED", "CLOSED"];
    if (terminal.includes(sc.state)) {
      return res.status(422).json({ error: "종료된 케이스에는 답변할 수 없습니다." });
    }

    // 메시지 저장 (기존 case 스레드에 append — same conversation)
    const msgId = `rep_ag_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await (superAdminDb as any).execute(sql`
      INSERT INTO support_ticket_replies
        (id, ticket_id, case_id, author_user_id, author_name, author_role, message_type, content, image_urls)
      VALUES
        (${msgId}, ${sc.ticket_id ?? null}, ${caseId},
         ${user.userId}, ${user.name ?? "담당자"}, ${"agent"}, ${"agent"},
         ${content.trim()}, '{}'::text[])
    `);

    // 케이스 상태 → HUMAN_RESPONDED
    await transitionSupportCase({
      caseId,
      toState:   SUPPORT_CASE_STATE.HUMAN_RESPONDED ?? "HUMAN_RESPONDED",
      actorRole: "agent",
      poolId:    sc.pool_id ?? null,
      reason:    "AGENT_REPLIED",
    }).catch(() => {});

    void logSupportEvent({
      eventType: SUPPORT_EVENT_TYPE.AI_RESPONDED ?? ("HUMAN_RESPONDED" as any),
      caseId,
      ticketId:  sc.ticket_id ?? null,
      fromState: sc.state,
      toState:   "HUMAN_RESPONDED",
      actorRole: "agent",
      poolId:    sc.pool_id ?? null,
    }).catch(() => {});

    // CS23A: User Push — AGENT_REPLY_WITHOUT_USER_NOTIFICATION = 0
    if (sc.actor_id) {
      const isParentActor = sc.actor_role === "parent_account";
      void sendPushToUser(
        sc.actor_id,
        isParentActor,
        "SUPPORT_REPLY",
        "문의 답변 도착",
        "문의에 답변이 도착했습니다. 확인해 보세요.",
        { case_id: caseId },
        "support-agent-reply"
      ).catch(() => {});
    }

    res.json({ ok: true, msg_id: msgId });
  } catch (err) {
    console.error("[POST /support/cases/:id/agent-reply]", err);
    res.status(500).json({ error: "서버 오류" });
  }
});

// ── GET /support/cases (list) ─────────────────────────────────────────────────
// 현재 사용자의 support case 목록 (최근 10개, active 우선)

router.get("/support/cases", requireAuth, async (req: AuthRequest, res) => {
  const user    = req.user!;
  const actorId = user.userId;
  const poolId  = user.poolId ?? null;
  const isSuper = isSuperAdmin(user.role);

  try {
    let rows: any;
    if (isSuper) {
      rows = (await (superAdminDb as any).execute(sql`
        SELECT id, pool_id, actor_id, ticket_id, actor_role, mode, state,
               escalation_reason, context_json, resolved_at::text,
               created_at::text, updated_at::text
        FROM support_cases
        ORDER BY updated_at DESC
        LIMIT 20
      `)) as any;
    } else {
      rows = (await (superAdminDb as any).execute(sql`
        SELECT id, pool_id, actor_id, ticket_id, actor_role, mode, state,
               escalation_reason, context_json, resolved_at::text,
               created_at::text, updated_at::text
        FROM support_cases
        WHERE actor_id = ${actorId}
          AND pool_id  = ${poolId}
        ORDER BY updated_at DESC
        LIMIT 10
      `)) as any;
    }

    const cases = (rows?.rows ?? []).map((sc: any) => ({
      ...sc,
      master_state: getMasterState(sc.state, sc.escalation_reason),
    }));

    res.json({ cases });
  } catch (err) {
    console.error("[GET /support/cases]", err);
    res.status(500).json({ error: "서버 오류" });
  }
});

// ── POST /support/cases/:id/resolve ──────────────────────────────────────────
// "해결됐어요" — 현재 state에 따라 AI_RESOLVED 또는 RESOLVED로 전환.

router.post("/support/cases/:id/resolve", requireAuth, async (req: AuthRequest, res) => {
  const user    = req.user!;
  const caseId  = req.params.id;
  const actorId = user.userId;
  const isSuper = isSuperAdmin(user.role);

  try {
    const caseRows = (await (superAdminDb as any).execute(sql`
      SELECT actor_id, pool_id, ticket_id, state, escalation_reason, context_json
      FROM support_cases WHERE id = ${caseId} LIMIT 1
    `)) as any;
    const sc = caseRows?.rows?.[0];
    if (!sc) return res.status(404).json({ error: "케이스를 찾을 수 없습니다." });

    if (!isSuper) {
      const ownerMismatch = sc.actor_id && sc.actor_id !== actorId;
      const poolMismatch  = sc.pool_id  && sc.pool_id  !== (user.poolId ?? "");
      if (ownerMismatch || poolMismatch) {
        return res.status(403).json({ error: "접근 권한이 없습니다." });
      }
    }

    const alreadyResolved = ["AI_RESOLVED", "RESOLVED", "CLOSED"].includes(sc.state);
    if (alreadyResolved) {
      return res.json({ ok: true, state: sc.state });
    }

    // 전환 대상 결정: AI 단계 → AI_RESOLVED, human 단계 → RESOLVED
    const humanStates = ["HUMAN_REQUIRED", "HUMAN_RESPONDED", "ESCALATED", "PHONE_REQUIRED"];
    const toState     = humanStates.includes(sc.state)
      ? SUPPORT_CASE_STATE.RESOLVED
      : SUPPORT_CASE_STATE.AI_RESOLVED;

    const result = await transitionSupportCase({
      caseId,
      toState,
      actorRole:       user.role ?? "unknown",
      poolId:          sc.pool_id ?? null,
      reason:          "USER_RESOLVED",
      resolutionSource: "USER_CONFIRMED",
    });

    if (!result.ok) return res.status(result.status).json({ error: result.error });

    void logSupportEvent({
      eventType: SUPPORT_EVENT_TYPE.RESOLUTION_CONFIRMED,
      caseId,
      ticketId:  sc.ticket_id ?? null,
      fromState: sc.state,
      toState,
      actorRole: user.role ?? "unknown",
      poolId:    user.poolId ?? null,
    }).catch(() => {});
    if (getSupportSequence(sc.context_json).gpt_status === "RESPONDED") {
      void logSupportOutcome(caseId, "GPT_RESOLVED").catch(() => {});
    }

    res.json({ ok: true, state: toState });
  } catch (err) {
    console.error("[POST /support/cases/:id/resolve]", err);
    res.status(500).json({ error: "서버 오류" });
  }
});

// ── POST /support/cases/:id/reopen ────────────────────────────────────────────

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
