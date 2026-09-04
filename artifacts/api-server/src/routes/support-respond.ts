/**
 * WP-CS-08R — Support AI Engine / LLM Last Fallback
 * P0-OBSERVABILITY — Stage-level production trace instrumentation
 *
 * POST /support/respond
 *
 * 처리 흐름:
 *   1. user 메시지 저장 → support_ticket_replies (author_role=user)
 *   2. case NEW/REOPENED → AI_PROCESSING 전환
 *   3. runResolutionChain(ctx) — 7-layer deterministic
 *      → RESOLVED / NEEDS_DIAGNOSTIC:
 *           AI 답변 저장, AI_PROCESSING → AI_RESPONDED, llm_used=false
 *      → NO_MATCH (llm_required=true):
 *           gatherEvidence → OpenAI gpt-4o-mini → AI 답변 저장
 *           HIGH/MEDIUM → AI_RESPONDED, LOW → HUMAN_REQUIRED
 *   4. saveAiTrace (AI_FEATURE.SUPPORT_AI)
 *   5. Response: { answer, confidence, source, llm_used, llm_called, case_state }
 *
 * Observability (P0-OBSERVABILITY):
 *   - createSupportTrace() → stage-by-stage trace in memory
 *   - addStage() at each gate — PII 저장 금지
 *   - flushSupportTrace() at HTTP_RESPONSE — event_logs에 단일 레코드
 *   - flushInsertFailStage() on AI INSERT failure — pg error code 즉시 캡처
 *   - HTTP_RESPONSE stage = actual http_status source of truth
 *
 * 개인정보 보호:
 *   - user_message 본문은 OpenAI에만 전달, DB에 저장 금지
 *   - saveAiTrace에 메시지 본문 저장 금지, token count만
 *   - author_role=ai 직접 DB 삽입 (requireAuth 외부 엔드포인트 우회 불필요)
 *   - trace: raw message/AI output/prompt/이름/전화/JWT 저장 금지
 *
 * 상태 머신 참고:
 *   NEW/REOPENED → AI_PROCESSING → AI_RESPONDED | HUMAN_REQUIRED
 */

import { Router }   from "express";
import { sql }       from "drizzle-orm";
import { db, superAdminDb } from "@workspace/db";

import { requireAuth, type AuthRequest }   from "../middlewares/auth.js";
import { resolvePoolMode }                 from "../lib/xmode.js";
import { getOpenAI }                        from "./ai.js";
import { saveAiTrace }                      from "../lib/ai-trace-service.js";
import { AI_FEATURE, SUPPORT_EVENT_TYPE }   from "../lib/ai-feature-enum.js";
import { AI_MODEL }                          from "../config/ai-model-config.js";
import { calculateAiCost }                   from "../config/ai-pricing.js";
import {
  transitionSupportCase,
  logSupportEvent,
} from "../lib/support-case-service.js";
import {
  runResolutionChain,
  gatherEvidence,
  deriveEvidenceContext,
  tokenize,
  normalizeQuery,
  type RouterContext,
  type EvidenceItem,
} from "../lib/support-resolver.js";
import {
  createSupportTrace,
  addStage,
  flushSupportTrace,
  flushInsertFailStage,
  classifyPgError,
  type MessageContract,
} from "../lib/support-trace.js";
// CS24: Learning Loop — Query Log + Candidate Engine (fire-and-forget)
import {
  logSupportQuery,
  evaluateForCandidacy,
} from "../lib/support-candidate-engine.js";
import {
  buildSupportTopicKey,
  nextSupportSequence,
  saveSupportSequence,
} from "../lib/support-escalation.js";
import {
  nanoResolve,
  buildRecentContext,
  validateNanoOutput,
} from "../lib/support-nano-resolver.js";

const router = Router();

// ── Constants ─────────────────────────────────────────────────────────────────

const LLM_MODEL       = AI_MODEL.SUPPORT;
const LLM_TIMEOUT_MS  = 28_000;
const MAX_ANSWER_TOKENS = 512;

const AI_PROCESSING_FROM = new Set(["NEW", "REOPENED", "AI_RESPONDED", "WAITING"]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** support_ticket_replies에 메시지 직접 삽입 (권한 우회 없음 — 서버 내부 처리) */
async function insertSupportMessage(params: {
  msgId:      string;
  caseId:     string;
  ticketId:   string | null;
  authorId:   string | null;
  authorName: string;
  role:       "user" | "ai" | "system";
  msgType:    string;
  content:    string;
}): Promise<void> {
  await (db as any).execute(sql`
    INSERT INTO support_ticket_replies
      (id, ticket_id, case_id, author_user_id, author_name, author_role, message_type, content, image_urls)
    VALUES (
      ${params.msgId},
      ${params.ticketId},
      ${params.caseId},
      ${params.authorId},
      ${params.authorName},
      ${params.role},
      ${params.msgType},
      ${params.content},
      '{}'::text[]
    )
  `);
}

/** support_cases turn_count++, updated_at=NOW() (best-effort) */
async function bumpTurnCount(caseId: string): Promise<void> {
  await (superAdminDb as any).execute(sql`
    UPDATE support_cases
    SET turn_count = turn_count + 1, updated_at = NOW()
    WHERE id = ${caseId}
  `).catch(() => {});
}

// ── POST /support/respond ─────────────────────────────────────────────────────

router.post("/support/respond", requireAuth, async (req: AuthRequest, res) => {
  const user      = req.user!;
  const actorId   = user.userId;
  const role      = user.role ?? "unknown";
  const poolId    = user.poolId ?? null;
  const actorName = user.name ?? "";

  const body       = req.body as any;
  const caseId     = (body.case_id   as string) ?? null;
  const rawMessage = (body.message   as string) ?? "";
  const mode       = ((body.mode      as string) || "normal").toLowerCase();
  const screenId   = (body.screen_id as string) ?? null;
  const appVersion = (body.app_version as string) ?? null;
  const requestId  = (body.request_id as string) || genId("req_sup");

  if (!caseId) {
    return res.status(400).json({ error: "case_id 필수" });
  }
  if (!rawMessage.trim()) {
    return res.status(400).json({ error: "message 필수" });
  }

  // ── Trace init ─────────────────────────────────────────────────────────────

  const trace = createSupportTrace({
    request_id:   requestId,
    case_id:      caseId,
    pool_id:      poolId,
    user_role:    role,
    service_mode: mode,
  });

  addStage(trace, "REQUEST_RECEIVED", {
    screen_id:   screenId    ?? null,
    app_version: appVersion  ?? null,
  });

  // ── 케이스 조회 + isolation ────────────────────────────────────────────────

  let sc: any;
  try {
    const r = (await (superAdminDb as any).execute(sql`
      SELECT id, state, pool_id, ticket_id, actor_id, escalation_reason, context_json
      FROM support_cases
      WHERE id = ${caseId}
      LIMIT 1
    `)) as any;
    sc = r.rows?.[0];
    if (!sc) {
      addStage(trace, "HTTP_RESPONSE", { http_status: 404, success: false, safe_error_code: "CASE_NOT_FOUND" });
      void flushSupportTrace(trace, { http_status: 404, success: false, safe_error_code: "CASE_NOT_FOUND" });
      return res.status(404).json({ error: "케이스를 찾을 수 없습니다." });
    }
  } catch {
    addStage(trace, "HTTP_RESPONSE", { http_status: 500, success: false, safe_error_code: "CASE_FETCH_ERROR" });
    void flushSupportTrace(trace, { http_status: 500, success: false, safe_error_code: "CASE_FETCH_ERROR" });
    return res.status(500).json({ error: "케이스 조회 오류" });
  }

  // Tenant isolation (super_admin / platform_admin 제외)
  const isSuperAdmin = role === "super_admin" || role === "platform_admin";
  if (!isSuperAdmin) {
    if (sc.actor_id && sc.actor_id !== actorId) {
      addStage(trace, "HTTP_RESPONSE", { http_status: 403, success: false, safe_error_code: "ACTOR_MISMATCH" });
      void flushSupportTrace(trace, { http_status: 403, success: false, safe_error_code: "ACTOR_MISMATCH" });
      return res.status(403).json({ error: "접근 권한이 없습니다." });
    }
    if (sc.pool_id && sc.pool_id !== poolId) {
      addStage(trace, "HTTP_RESPONSE", { http_status: 403, success: false, safe_error_code: "POOL_MISMATCH" });
      void flushSupportTrace(trace, { http_status: 403, success: false, safe_error_code: "POOL_MISMATCH" });
      return res.status(403).json({ error: "접근 권한이 없습니다." });
    }
  }

  // 종료 상태 케이스 거부
  const terminalStates = new Set(["RESOLVED", "CLOSED"]);
  if (terminalStates.has(sc.state)) {
    addStage(trace, "CASE_RESOLVED", { case_state: sc.state });
    addStage(trace, "HTTP_RESPONSE", { http_status: 409, success: false, safe_error_code: "TERMINAL_STATE" });
    void flushSupportTrace(trace, { http_status: 409, success: false, safe_error_code: "TERMINAL_STATE" });
    return res.status(409).json({ error: "종료된 케이스에는 메시지를 보낼 수 없습니다." });
  }

  // ── 사용자 메시지 저장 ─────────────────────────────────────────────────────

  const userMsgId = genId("rep");

  // §5 Contract trace — content value excluded
  const userContract: MessageContract = {
    author_role:            "user",
    author_user_id_is_null: !actorId,
    case_id_present:        !!caseId,
    ticket_id_present:      !!sc.ticket_id,
    message_type:           "user",
    content_present:        !!rawMessage.trim(),
  };

  addStage(trace, "USER_MESSAGE_INSERT_START", { contract: userContract });

  try {
    await insertSupportMessage({
      msgId:      userMsgId,
      caseId,
      ticketId:   sc.ticket_id ?? null,
      authorId:   actorId,
      authorName: actorName,
      role:       "user",
      msgType:    "user",
      content:    rawMessage,
    });
    await bumpTurnCount(caseId);
    addStage(trace, "USER_MESSAGE_INSERT_OK", { msg_id: userMsgId });
  } catch (err) {
    console.error("[support/respond] user message insert failed:", err);
    const pgCode   = (err as any)?.code        ?? null;
    const category = classifyPgError(err);
    addStage(trace, "USER_MESSAGE_INSERT_FAIL", {
      pg_code:        pgCode,
      error_category: category,
    });
    addStage(trace, "HTTP_RESPONSE", { http_status: 500, success: false, safe_error_code: "USER_MSG_INSERT_FAILED" });
    void flushSupportTrace(trace, { http_status: 500, success: false, safe_error_code: "USER_MSG_INSERT_FAILED" });
    return res.status(500).json({ error: "메시지 저장 실패" });
  }

  // ── AI_PROCESSING 전환 ─────────────────────────────────────────────────────

  // STALE-02 fix: auto HUMAN_REQUIRED(no ticket, not user-requested) → AI_PROCESSING 허용.
  // 사용자가 명시적으로 상담사를 요청한 케이스(ticket_id || escalation_reason="USER_REQUESTED_HUMAN")는
  // 절대 AI 처리로 자동 복귀하지 않는다.
  const isAutoHumanRequired =
    sc.state === "HUMAN_REQUIRED" &&
    !sc.ticket_id &&
    sc.escalation_reason !== "USER_REQUESTED_HUMAN";

  if (AI_PROCESSING_FROM.has(sc.state) || isAutoHumanRequired) {
    addStage(trace, "AI_PROCESSING_START", { from_state: sc.state });
    const txResult = await transitionSupportCase({
      caseId,
      toState:   "AI_PROCESSING",
      actorRole: "system",
      poolId:    sc.pool_id ?? poolId,
    });
    if (txResult.ok) {
      addStage(trace, "AI_PROCESSING_OK");
    } else {
      console.warn("[support/respond] AI_PROCESSING transition failed:", txResult.error);
      addStage(trace, "AI_PROCESSING_FAIL", { reason: "TRANSITION_REJECTED" });
      // non-fatal: continue anyway, transition from intermediate states is best-effort
    }
  }

  // ── CS13-P1: Server-authoritative mode resolution ─────────────────────────
  // client-sent mode는 참고값. pool이 있는 일반 사용자는 DB에서 실제 mode를 결정.
  // super_admin/platform_admin은 poolId가 없으므로 client mode를 신뢰.
  // non-fatal: DB 조회 실패 시 client mode fallback (서비스 중단 방지).
  let resolvedMode = mode; // already normalized to lowercase (line 131)
  if (poolId && !isSuperAdmin) {
    try {
      const poolModeResult = await resolvePoolMode(poolId);
      if (poolModeResult) resolvedMode = poolModeResult.mode;
    } catch {
      // non-fatal: pool mode DB 조회 실패 시 client mode fallback
    }
  }

  // ── Resolution Chain ──────────────────────────────────────────────────────

  // KNORM fix: normalizeQuery로 한글↔ASCII 경계 공백 삽입 + 조사 변형 처리.
  // 원본 rawMessage는 사용자 메시지 저장/LLM 프롬프트에만 사용.
  const qLower  = normalizeQuery(rawMessage);
  const tokens  = tokenize(qLower);

  // WP-CS09: extract previous resolution context from case (same-case boundary enforced here).
  // context_json holds multiple sub-keys (session metadata + resolution_context).
  // WP-CS09 reads from the 'resolution_context' sub-key to avoid collision with session data.
  // raw query / answer is never stored — metadata only (§2, §6).
  const previousContext: import("../lib/support-resolver.js").PreviousResolutionContext | null =
    (sc.context_json as any)?.resolution_context ?? null;

  const ctx: RouterContext = {
    query:      rawMessage,
    role,
    mode:       resolvedMode,   // CS13-P1: DB-authoritative (not raw client value)
    poolId,
    screenId,
    appVersion,
    qLower,
    tokens,
    previousContext,
  };

  addStage(trace, "RESOLUTION_START");

  let resolution: Awaited<ReturnType<typeof runResolutionChain>>;
  try {
    resolution = await runResolutionChain(ctx);
    addStage(trace, "RESOLUTION_DONE", {
      llm_required:    resolution.llm_required,
      resolution_source: (resolution as any).source_type ?? null,
      confidence:      (resolution as any).confidence    ?? null,
    });
  } catch (err) {
    console.error("[support/respond] resolution chain failed:", err);
    addStage(trace, "RESOLUTION_FAIL");
    addStage(trace, "HTTP_RESPONSE", { http_status: 500, success: false, safe_error_code: "RESOLUTION_CHAIN_ERROR" });
    void flushSupportTrace(trace, { http_status: 500, success: false, safe_error_code: "RESOLUTION_CHAIN_ERROR" });
    return res.status(500).json({ error: "해결 처리 오류" });
  }

  const traceStartMs = Date.now();
  const internalId   = genId("trace_sup");

  // ── Deterministic answer (no LLM) ────────────────────────────────────────

  if (!resolution.llm_required && resolution.answer) {
    // §5 AI message contract
    const aiContractDet: MessageContract = {
      author_role:            "ai",
      author_user_id_is_null: true,
      case_id_present:        !!caseId,
      ticket_id_present:      !!sc.ticket_id,
      message_type:           "ai_deterministic",
      content_present:        true,
    };
    addStage(trace, "AI_MESSAGE_INSERT_START", { contract: aiContractDet, which: "DETERMINISTIC" });

    const aiMsgId = genId("rep");
    try {
      await insertSupportMessage({
        msgId:      aiMsgId,
        caseId,
        ticketId:   sc.ticket_id ?? null,
        authorId:   null,
        authorName: "AI",
        role:       "ai",
        msgType:    "ai_deterministic",
        content:    resolution.answer,
      });
      await bumpTurnCount(caseId);
      addStage(trace, "AI_MESSAGE_INSERT_OK", { msg_id: aiMsgId, which: "DETERMINISTIC" });
    } catch (err) {
      console.error("[support/respond] AI message insert failed:", err);
      const pgCode      = (err as any)?.code        ?? null;
      const pgConstraint= (err as any)?.constraint  ?? null;
      const pgColumn    = (err as any)?.column      ?? null;
      const pgTable     = (err as any)?.table       ?? null;
      const category    = classifyPgError(err);
      addStage(trace, "AI_MESSAGE_INSERT_FAIL", {
        which:          "DETERMINISTIC",
        pg_code:        pgCode,
        constraint:     pgConstraint,
        column:         pgColumn,
        table:          pgTable,
        error_category: category,
      });
      // Immediate flush so pg error is captured even before HTTP_RESPONSE
      await flushInsertFailStage(trace, err, "DETERMINISTIC");
      addStage(trace, "HTTP_RESPONSE", { http_status: 500, success: false, safe_error_code: "AI_MSG_INSERT_FAILED" });
      void flushSupportTrace(trace, { http_status: 500, success: false, safe_error_code: "AI_MSG_INSERT_FAILED" });
      return res.status(500).json({
        error: "AI 메시지 저장 실패",
        code:  "AI_MSG_INSERT_FAILED",
      });
    }

    // state transition
    addStage(trace, "FINAL_STATE_START", { to_state: "AI_RESPONDED" });
    await transitionSupportCase({
      caseId,
      toState:          "AI_RESPONDED",
      actorRole:        "system",
      poolId:           sc.pool_id ?? poolId,
      resolutionSource: resolution.source_type,
    }).catch(() => {});
    addStage(trace, "FINAL_STATE_OK", { to_state: "AI_RESPONDED" });

    // WP-CS09: persist resolution context for follow-up queries (§6 source-of-truth rule).
    // JSONB merge (||) into 'resolution_context' sub-key preserves existing session metadata.
    // Only metadata stored — raw query/answer forbidden (§2 no-raw-analytics rule).
    // WP-CS15: origin_request_id 추가 (§19 support case trace).
    // Fire-and-forget; never blocks HTTP response.
    void (superAdminDb as any).execute(sql`
      UPDATE support_cases
      SET context_json = COALESCE(context_json, '{}'::jsonb) || jsonb_build_object(
        'origin_request_id', ${requestId},
        'resolution_context', ${JSON.stringify({
          source_type:  resolution.source_type,
          source_id:    resolution.source_id  ?? null,
          feature:      resolution.feature    ?? null,
          category:     resolution.category   ?? null,
          entity_key:   resolution.entity_key ?? null,
          screen_id:    resolution.screen_id  ?? null,
          // HUMAN_ONLY is set only by the verified deterministic resolver.
          // It preserves the pre-existing direct-human exception without
          // trusting a client-provided escalation flag.
          human_only:   resolution.requires_human === true && resolution.llm_required === false,
          resolved_at:  new Date().toISOString(),
        })}::jsonb
      )
      WHERE id = ${caseId}
    `).catch(() => {});

    // event log
    void logSupportEvent({
      eventType: SUPPORT_EVENT_TYPE.AI_RESPONDED,
      caseId,
      ticketId:  sc.ticket_id ?? null,
      fromState: sc.state,
      toState:   "AI_RESPONDED",
      actorRole: "system",
      poolId:    sc.pool_id ?? poolId,
    }).catch(() => {});

    // WP-CS26: repeated issues are counted within this case only. The stable
    // matched source is preferred; unmatched questions only match themselves.
    const sequence = nextSupportSequence(
      sc.context_json,
      buildSupportTopicKey({
        sourceType: resolution.source_type,
        sourceId: resolution.source_id,
        normalizedQuery: qLower,
      }),
      Boolean(sc.ticket_id)
    );
    await saveSupportSequence(caseId, sequence).catch(() => {});
    if (sequence.inquiry_offered) {
      void logSupportEvent({
        eventType: "REPEAT_STREAK_3",
        caseId,
        ticketId: sc.ticket_id ?? null,
        fromState: "AI_RESPONDED",
        toState: "AI_RESPONDED",
        actorRole: "system",
        poolId: sc.pool_id ?? poolId,
      }).catch(() => {});
    }

    // trace (deterministic — no model cost)
    // provider=null: 실제 LLM 호출 없음 (deterministic only)
    await saveAiTrace({
      request_id:           requestId,
      internal_id:          internalId,
      pool_id:              poolId ?? "",
      actor_id:             actorId,
      contract_version:     "CS08R-v1",
      feature:              AI_FEATURE.SUPPORT_AI,
      sub_feature:          "SUPPORT_RESPONSE",
      pool_mode:            mode,
      user_role:            role,
      provider:             undefined,
      source_app:           "app",
      trigger_type:         "USER_ACTION",
      service:              "internal",
      status:               "SUCCESS",
      generation_mode:      "deterministic",
      model:                null,
      latency_ms:           Date.now() - traceStartMs,
      input_tokens:         null,
      output_tokens:        null,
      total_tokens:         null,
      result_generated:     true,
      logical_request_count: 0,
      actual_call_count:     0,
      retry_count:           0,
    }).catch(() => {});

    // §6 HTTP_RESPONSE — actual status source of truth
    addStage(trace, "HTTP_RESPONSE", {
      http_status:    200,
      success:        true,
      answer_present: true,
      case_id_present: !!caseId,
      resolution_status: "AI_RESPONDED",
      resolution_source: resolution.source_type,
      llm_called:    false,
    });
    void flushSupportTrace(trace, {
      http_status:    200,
      success:        true,
      answer_present: true,
      case_id_present: !!caseId,
    });

    // WP-CS15 §3: meta.trace — opaque reference only; no answer/title/PII exposed.
    const deterministicRef = resolution.source_id
      ? [{ ref: resolution.source_id, item_type: resolution.source_type ?? "UNKNOWN" }]
      : [];

    // CS24: Query Log + Candidate Engine (fire-and-forget — HTTP response 불지연)
    // normalized_query만 저장 (raw message/PII 금지)
    void logSupportQuery({
      caseId,
      normalizedQuery:     qLower,
      representativeQuery: qLower.substring(0, 200),
      resolutionSource:    resolution.source_type ?? "DETERMINISTIC",
      matchedKnowledgeId:  resolution.source_id ?? null,
      matchConfidence:     typeof resolution.confidence === "number" ? resolution.confidence : null,
      llmCalled:           false,
      humanRequested:      false,
      finalCaseState:      "AI_RESPONDED",
      role,
      mode:                resolvedMode,
      poolId:              poolId ?? null,
    }).catch(() => {});

    return res.json({
      ok: true,
      llm_used:   false,
      llm_called: false,
      source:     resolution.source_type,
      confidence: resolution.confidence,
      answer:     resolution.answer,
      case_state: "AI_RESPONDED",
      requires_human: resolution.requires_human,
      autonomous_support: {
        same_intent_streak: sequence.same_intent_streak,
        inquiry_offered: sequence.inquiry_offered,
        gpt_status: sequence.gpt_status,
      },
      meta: { trace: { request_id: requestId, evidence_refs: deterministicRef } },
    });
  }

  // ── WP-SUPPORT-NANO-01: broad retrieval → Nano AI (or no-evidence fallback) ──
  // CS26 removed: NO_MATCH now proceeds to broad evidence gathering + single Nano call.
  // If candidates are empty → deterministic no-evidence reply (no LLM, AI_RESPONDED).
  // If candidates exist  → Nano resolves in 1 call → grounded answer.

  addStage(trace, "EVIDENCE_START");

  let evidence: EvidenceItem[];
  try {
    // WP-NANO-03: fallbackMax=20 — lexical miss 시 broad fallback 최대 20개
    evidence = await gatherEvidence(ctx, 5, 20);
    addStage(trace, "EVIDENCE_DONE", { evidence_count: evidence.length });
  } catch (err) {
    console.error("[support/respond] gatherEvidence failed:", err);
    addStage(trace, "EVIDENCE_FAIL");
    // fallback to empty evidence — non-fatal, continue to LLM_SKIPPED / no_evidence
    evidence = [];
    addStage(trace, "EVIDENCE_DONE", { evidence_count: 0, fallback: true });
  }

  // ── WP-SUPPORT-NANO-01: No-evidence deterministic fallback ──────────────────
  // No candidates → return AI_RESPONDED with no-match message (no LLM call).
  // This preserves the core safety property: no fabrication when no grounding exists.

  if (evidence.length === 0) {
    addStage(trace, "LLM_SKIPPED", { reason: "NO_EVIDENCE" });

    const noEvAnswer =
      "현재 확인 가능한 안내만으로는 이 문의를 정확히 해결하기 어렵습니다. " +
      "같은 문제가 계속되면 안내된 내용이 해결에 도움이 되었는지 알려주세요.";
    const noEvSequence = nextSupportSequence(
      sc.context_json,
      buildSupportTopicKey({ normalizedQuery: qLower }),
      Boolean(sc.ticket_id)
    );

    const noEvMsgId = genId("rep");
    try {
      await insertSupportMessage({
        msgId:      noEvMsgId,
        caseId,
        ticketId:   sc.ticket_id ?? null,
        authorId:   null,
        authorName: "AI",
        role:       "ai",
        msgType:    "ai_no_match",
        content:    noEvAnswer,
      });
      await bumpTurnCount(caseId);
    } catch (err) {
      console.error("[support/respond] no-evidence message insert failed:", err);
      addStage(trace, "HTTP_RESPONSE", { http_status: 500, success: false, safe_error_code: "AI_MSG_INSERT_FAILED" });
      void flushSupportTrace(trace, { http_status: 500, success: false, safe_error_code: "AI_MSG_INSERT_FAILED" });
      return res.status(500).json({ error: "AI 메시지 저장 실패", code: "AI_MSG_INSERT_FAILED" });
    }

    await transitionSupportCase({
      caseId,
      toState: "AI_RESPONDED",
      actorRole: "system",
      poolId: sc.pool_id ?? poolId,
      resolutionSource: "NO_MATCH",
    }).catch(() => {});
    await saveSupportSequence(caseId, noEvSequence).catch(() => {});

    if (noEvSequence.inquiry_offered) {
      void logSupportEvent({
        eventType: "REPEAT_STREAK_3",
        caseId,
        ticketId: sc.ticket_id ?? null,
        fromState: "AI_RESPONDED",
        toState: "AI_RESPONDED",
        actorRole: "system",
        poolId: sc.pool_id ?? poolId,
      }).catch(() => {});
    }

    void logSupportQuery({
      caseId,
      normalizedQuery:     qLower,
      representativeQuery: qLower.substring(0, 200),
      resolutionSource:    "NO_MATCH",
      matchedKnowledgeId:  null,
      matchConfidence:     null,
      llmCalled:           false,
      humanRequested:      false,
      finalCaseState:      "AI_RESPONDED",
      role,
      mode:                resolvedMode,
      poolId:              poolId ?? null,
    }).catch(() => {});

    // provider=undefined: 실제 LLM 호출 없음 (no-evidence deterministic fallback)
    await saveAiTrace({
      request_id:           requestId,
      internal_id:          internalId,
      pool_id:              poolId ?? "",
      actor_id:             actorId,
      contract_version:     "CS08R-v1",
      feature:              AI_FEATURE.SUPPORT_AI,
      sub_feature:          "SUPPORT_RESPONSE",
      pool_mode:            mode,
      user_role:            role,
      provider:             undefined,
      source_app:           "app",
      trigger_type:         "USER_ACTION" as const,
      service:              "internal",
      status:               "SUCCESS",
      generation_mode:      "no_evidence",
      model:                null,
      latency_ms:           Date.now() - traceStartMs,
      input_tokens:         null,
      output_tokens:        null,
      total_tokens:         null,
      result_generated:     false,
      logical_request_count: 0,
      actual_call_count:     0,
      retry_count:           0,
    }).catch(() => {});

    addStage(trace, "HTTP_RESPONSE", {
      http_status: 200, success: true, answer_present: true,
      case_id_present: true, resolution_status: "AI_RESPONDED",
      resolution_source: "NO_MATCH", llm_called: false,
    });
    void flushSupportTrace(trace, { http_status: 200, success: true, answer_present: true, case_id_present: true });

    return res.json({
      ok: true, llm_used: false, llm_called: false,
      source: "NO_MATCH", confidence: 0, answer: noEvAnswer,
      case_state: "AI_RESPONDED", requires_human: false,
      autonomous_support: {
        same_intent_streak: noEvSequence.same_intent_streak,
        inquiry_offered:    noEvSequence.inquiry_offered,
        gpt_status:         noEvSequence.gpt_status,
      },
      meta: { trace: { request_id: requestId, evidence_refs: [] } },
    });
  }

  // ── WP-SUPPORT-NANO-01: Single Nano call for evidence-grounded answer ────────
  // §3: 1 logical request → 1 AI call.
  // §7: 최근 2~3턴 context 사용 (전체 dump 금지).

  const recentMsgs = await buildRecentContext(caseId, 3);

  addStage(trace, "LLM_START", { model: LLM_MODEL, evidence_count: evidence.length });

  const nanoResult = await nanoResolve({
    openai:     getOpenAI(),
    query:      rawMessage,
    role,
    mode:       resolvedMode,
    candidates: evidence,
    recentMsgs,
    model:      LLM_MODEL,
    timeoutMs:  LLM_TIMEOUT_MS,
  });

  // §10 server validator: strip fabricated IDs, handle contradiction
  const candidateIds = new Set(evidence.map((e) => e.id));
  const validation   = validateNanoOutput(nanoResult.output, candidateIds);

  const llmError      = nanoResult.error;
  const inputTokens   = nanoResult.inputTokens;
  const outputTokens  = nanoResult.outputTokens;
  const totalTokens   = nanoResult.totalTokens;
  const nanoOut       = nanoResult.output;

  if (llmError) {
    addStage(trace, "LLM_FAIL", { error_code: llmError });
  } else {
    addStage(trace, "LLM_DONE", {
      model:                   LLM_MODEL,
      input_tokens:            inputTokens,
      output_tokens:           outputTokens,
      total_tokens:            totalTokens,
      confidence:              nanoOut.confidence,
      insufficient_knowledge:  nanoOut.insufficient_knowledge,
      selected_ki_count:       nanoOut.selected_knowledge_ids.length,
      validator_ok:            validation.ok,
      validator_reason:        validation.reason ?? null,
    });
  }

  // Derive requires_human from Nano output
  const llmActuallyCalled = true;
  const requiresHuman = nanoOut.confidence === "LOW" || nanoOut.insufficient_knowledge;

  const latencyMs = Date.now() - traceStartMs;

  // ── saveAiTrace ──────────────────────────────────────────────────────────

  const traceBase = {
    request_id:       requestId,
    internal_id:      internalId,
    pool_id:          poolId ?? "",
    actor_id:         actorId,
    contract_version: "CS08R-v1",
    feature:          AI_FEATURE.SUPPORT_AI,
    sub_feature:      "SUPPORT_RESPONSE",
    pool_mode:        mode,
    user_role:        role,
    provider:         "openai",
    source_app:       "app",
    trigger_type:     "USER_ACTION" as const,
    service:          "gpt",
  };

  // WP-NANO-04: 비용 계산 (TOKEN_PRICING — gpt-4o-mini 단가)
  const nanoCostResult = !llmError && inputTokens != null && outputTokens != null
    ? calculateAiCost(inputTokens, outputTokens, LLM_MODEL)
    : null;

  if (llmError) {
    await saveAiTrace({
      ...traceBase,
      status:      "FAILED",
      error_stage: "LLM_GENERATION",
      error_code:  llmError,
      latency_ms:  latencyMs,
      model:       LLM_MODEL,
    }).catch(() => {});
  } else {
    await saveAiTrace({
      ...traceBase,
      status:                    "SUCCESS",
      generation_mode:           "llm_grounded",
      model:                     LLM_MODEL,
      latency_ms:                latencyMs,
      input_tokens:              inputTokens,
      output_tokens:             outputTokens,
      total_tokens:              totalTokens,
      // candidate pool vs Nano-selected 구분 (WP-NANO-04)
      knowledge_hit_count:       evidence.length,        // backward-compat
      candidate_knowledge_count: evidence.length,        // candidate pool 크기
      selected_knowledge_count:  nanoOut.selected_knowledge_ids.length,
      retrieved_knowledge_ids:   nanoOut.selected_knowledge_ids, // Nano 실제 선택 KI만
      result_generated:          nanoOut.confidence !== "LOW",
      // usage counts (1회 동기 호출, retry 없음)
      logical_request_count:     1,
      actual_call_count:         1,
      retry_count:               0,
      // cost
      estimated_cost_usd:        nanoCostResult?.total_cost_usd ?? null,
      cost_source:               nanoCostResult ? "TOKEN_PRICING" : "UNKNOWN",
    }).catch(() => {});
  }

  // ── AI message store + state transition ──────────────────────────────────

  const toState: string = requiresHuman ? "HUMAN_REQUIRED" : "AI_RESPONDED";

  // §5 AI message contract
  const aiContractLlm: MessageContract = {
    author_role:            "ai",
    author_user_id_is_null: true,
    case_id_present:        !!caseId,
    ticket_id_present:      !!sc.ticket_id,
    message_type:           toState === "HUMAN_REQUIRED" ? "ai_low_confidence" : "ai_llm",
    content_present:        true,
  };
  addStage(trace, "AI_MESSAGE_INSERT_START", { contract: aiContractLlm, which: "LLM" });

  const aiMsgId = genId("rep");
  try {
    await insertSupportMessage({
      msgId:      aiMsgId,
      caseId,
      ticketId:   sc.ticket_id ?? null,
      authorId:   null,
      authorName: "AI",
      role:       "ai",
      msgType:    toState === "HUMAN_REQUIRED" ? "ai_low_confidence" : "ai_llm",
      content:    nanoOut.answer,
    });
    await bumpTurnCount(caseId);
    addStage(trace, "AI_MESSAGE_INSERT_OK", { msg_id: aiMsgId, which: "LLM" });
  } catch (err) {
    console.error("[support/respond] AI message insert failed (LLM path):", err);
    const pgCode      = (err as any)?.code        ?? null;
    const pgConstraint= (err as any)?.constraint  ?? null;
    const pgColumn    = (err as any)?.column      ?? null;
    const pgTable     = (err as any)?.table       ?? null;
    const category    = classifyPgError(err);
    addStage(trace, "AI_MESSAGE_INSERT_FAIL", {
      which:          "LLM",
      pg_code:        pgCode,
      constraint:     pgConstraint,
      column:         pgColumn,
      table:          pgTable,
      error_category: category,
    });
    await flushInsertFailStage(trace, err, "LLM");
    addStage(trace, "HTTP_RESPONSE", { http_status: 500, success: false, safe_error_code: "AI_MSG_INSERT_FAILED" });
    void flushSupportTrace(trace, { http_status: 500, success: false, safe_error_code: "AI_MSG_INSERT_FAILED" });
    return res.status(500).json({
      error: "AI 메시지 저장 실패",
      code:  "AI_MSG_INSERT_FAILED",
    });
  }

  // Transition: AI_PROCESSING → AI_RESPONDED | HUMAN_REQUIRED
  addStage(trace, "FINAL_STATE_START", { to_state: toState });
  await transitionSupportCase({
    caseId,
    toState,
    actorRole: "system",
    poolId:    sc.pool_id ?? poolId,
    reason:    toState === "HUMAN_REQUIRED" ? "LOW_CONFIDENCE" : null,
  }).catch(() => {});
  addStage(trace, "FINAL_STATE_OK", { to_state: toState });

  // WP-CS09 §5/6: persist evidence-derived context (no LLM output mining).
  {
    const evidenceCtx = (!llmError && nanoOut.confidence !== "LOW")
      ? deriveEvidenceContext(evidence)
      : null;
    void (superAdminDb as any).execute(sql`
      UPDATE support_cases
      SET context_json = COALESCE(context_json, '{}'::jsonb)
        || jsonb_build_object('origin_request_id', ${requestId})
        ${evidenceCtx && (evidenceCtx.entity_key || evidenceCtx.source_id) ? sql`
        || jsonb_build_object('resolution_context', ${JSON.stringify({
            source_type:    evidenceCtx.source_type,
            source_id:      evidenceCtx.source_id  ?? null,
            entity_key:     evidenceCtx.entity_key ?? null,
            feature:        evidenceCtx.feature    ?? null,
            category:       evidenceCtx.category   ?? null,
            evidence_count: evidence.length,
            resolved_at:    new Date().toISOString(),
          })}::jsonb)
        ` : sql``}
      WHERE id = ${caseId}
    `).catch(() => {});
  }

  // Event log
  void logSupportEvent({
    eventType: toState === "HUMAN_REQUIRED"
      ? SUPPORT_EVENT_TYPE.HUMAN_REQUESTED
      : SUPPORT_EVENT_TYPE.AI_RESPONDED,
    caseId,
    ticketId:  sc.ticket_id ?? null,
    fromState: "AI_PROCESSING",
    toState,
    actorRole: "system",
    poolId:    sc.pool_id ?? poolId,
    reason:    toState === "HUMAN_REQUIRED" ? "LOW_CONFIDENCE" : null,
  }).catch(() => {});

  // §6 HTTP_RESPONSE — actual status source of truth
  addStage(trace, "HTTP_RESPONSE", {
    http_status:    200,
    success:        true,
    answer_present: true,
    case_id_present: !!caseId,
    resolution_status: toState,
    resolution_source: "LLM",
    llm_called:    llmActuallyCalled,
    llm_used:      llmActuallyCalled,
    model:         LLM_MODEL,
    evidence_count: evidence.length,
    selected_ki_count: nanoOut.selected_knowledge_ids.length,
  });
  void flushSupportTrace(trace, {
    http_status:    200,
    success:        true,
    answer_present: true,
    case_id_present: !!caseId,
  });

  // WP-CS15 §3: meta.trace — safe evidence refs only; no answer/title/PII.
  const { buildSafeTraceRef } = await import("../lib/knowledge-governance.js");
  const llmEvidenceRefs = evidence.map(buildSafeTraceRef);

  // CS24: Query Log + Candidate Engine (fire-and-forget)
  const cs24Entry = {
    caseId,
    normalizedQuery:     qLower,
    representativeQuery: qLower.substring(0, 200),
    resolutionSource:    "LLM",
    matchedKnowledgeId:  nanoOut.selected_knowledge_ids[0] ?? null,
    matchConfidence:     null,
    llmCalled:           true,
    humanRequested:      toState === "HUMAN_REQUIRED",
    finalCaseState:      toState,
    role,
    mode:                resolvedMode,
    poolId:              poolId ?? null,
  };
  void logSupportQuery(cs24Entry).catch(() => {});
  void evaluateForCandidacy(cs24Entry).catch(() => {});

  return res.json({
    ok:         true,
    llm_used:   true,
    llm_called: !llmError,
    source:     "LLM",
    confidence: nanoOut.confidence,
    answer:     nanoOut.answer,
    case_state: toState,
    requires_human: requiresHuman,
    insufficient_knowledge: nanoOut.insufficient_knowledge,
    selected_knowledge_ids: nanoOut.selected_knowledge_ids,
    meta: { trace: { request_id: requestId, evidence_refs: llmEvidenceRefs } },
  });
});

export default router;
