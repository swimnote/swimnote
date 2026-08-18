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
import { getOpenAI }                        from "./ai.js";
import { saveAiTrace }                      from "../lib/ai-trace-service.js";
import { AI_FEATURE, SUPPORT_EVENT_TYPE }   from "../lib/ai-feature-enum.js";
import {
  transitionSupportCase,
  logSupportEvent,
} from "../lib/support-case-service.js";
import {
  runResolutionChain,
  gatherEvidence,
  tokenize,
  normalizeQuery,
  type RouterContext,
} from "../lib/support-resolver.js";
import {
  createSupportTrace,
  addStage,
  flushSupportTrace,
  flushInsertFailStage,
  classifyPgError,
  type MessageContract,
} from "../lib/support-trace.js";

const router = Router();

// ── Constants ─────────────────────────────────────────────────────────────────

const LLM_MODEL       = "gpt-4o-mini";
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
      SELECT id, state, pool_id, ticket_id, actor_id, escalation_reason
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

  // Tenant isolation (super_admin 제외)
  const isSuperAdmin = role === "super_admin";
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

  // ── Resolution Chain ──────────────────────────────────────────────────────

  // KNORM fix: normalizeQuery로 한글↔ASCII 경계 공백 삽입 + 조사 변형 처리.
  // 원본 rawMessage는 사용자 메시지 저장/LLM 프롬프트에만 사용.
  const qLower  = normalizeQuery(rawMessage);
  const tokens  = tokenize(qLower);
  const ctx: RouterContext = {
    query:      rawMessage,
    role,
    mode,
    poolId,
    screenId,
    appVersion,
    qLower,
    tokens,
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

    // trace (deterministic — no model cost)
    await saveAiTrace({
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
      status:           "SUCCESS",
      generation_mode:  "deterministic",
      model:            null,
      latency_ms:       Date.now() - traceStartMs,
      input_tokens:     null,
      output_tokens:    null,
      total_tokens:     null,
      result_generated: true,
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

    return res.json({
      ok: true,
      llm_used:   false,
      llm_called: false,
      source:     resolution.source_type,
      confidence: resolution.confidence,
      answer:     resolution.answer,
      case_state: "AI_RESPONDED",
      requires_human: resolution.requires_human,
    });
  }

  // ── LLM Fallback ──────────────────────────────────────────────────────────

  addStage(trace, "EVIDENCE_START");

  let evidence: Awaited<ReturnType<typeof gatherEvidence>>;
  try {
    evidence = await gatherEvidence(ctx, 5);
    addStage(trace, "EVIDENCE_DONE", { evidence_count: evidence.length });
  } catch (err) {
    console.error("[support/respond] gatherEvidence failed:", err);
    addStage(trace, "EVIDENCE_FAIL");
    // fallback to empty evidence — non-fatal, continue to LLM_SKIPPED / no_evidence
    evidence = [];
    addStage(trace, "EVIDENCE_DONE", { evidence_count: 0, fallback: true });
  }

  // llm_used = "실제 provider LLM API를 호출했는가"
  const llmActuallyCalled = evidence.length > 0;

  const evidenceBlock = evidence.length > 0
    ? evidence
        .map((e, i) => `[${i + 1}] ${e.item_type} — ${e.title}\n${e.answer}`)
        .join("\n\n")
    : "(사용 가능한 SwimNote 근거 자료 없음)";

  const systemPrompt = `당신은 SwimNote 앱의 AI 고객지원 도우미입니다.

[필수 규칙]
- 아래 제공된 SwimNote 근거 자료 범위 안에서만 답변합니다.
- 근거에 없는 메뉴, 정책, 기능, 가격을 창작하거나 추측하지 않습니다.
- 환불 실행, 계정 변경, 구독 변경 등의 직접 실행은 하지 않습니다.
- 개인정보(이름, 전화, 이메일)를 수집하거나 언급하지 않습니다.
- 근거 자료가 없거나 부족하면 requires_human=true, confidence=LOW로 응답합니다.
- 답변은 한국어로 작성합니다.

[사용자 역할] ${role}
[앱 모드] ${mode}

[SwimNote 근거 자료]
${evidenceBlock}

[응답 JSON 형식]
{
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "answer": "사용자에게 전달할 한국어 답변",
  "requires_human": true | false,
  "suggested_next_action": null | "ASK_CLARIFYING" | "REQUEST_SCREENSHOT" | "REQUIRES_HUMAN"
}`;

  const userPrompt = rawMessage;

  let llmOutput: {
    confidence: "HIGH" | "MEDIUM" | "LOW";
    answer: string;
    requires_human: boolean;
    suggested_next_action: string | null;
  } | null = null;

  let inputTokens:  number | null = null;
  let outputTokens: number | null = null;
  let totalTokens:  number | null = null;
  let llmError: string | null = null;

  if (evidence.length === 0) {
    // No evidence → cannot ground → immediate LOW + human CTA
    addStage(trace, "LLM_SKIPPED", { reason: "NO_EVIDENCE" });
    llmOutput = {
      confidence: "LOW",
      answer:
        "죄송합니다. 현재 이 질문에 대한 정확한 정보를 찾지 못했습니다. 더 빠른 도움을 위해 상담사 연결을 추천드립니다.",
      requires_human: true,
      suggested_next_action: "REQUIRES_HUMAN",
    };
  } else {
    // Call OpenAI
    addStage(trace, "LLM_START", { model: LLM_MODEL, evidence_count: evidence.length });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    try {
      const openai     = getOpenAI();
      const completion = await openai.chat.completions.create(
        {
          model:           LLM_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user",   content: userPrompt   },
          ],
          response_format: { type: "json_object" },
          temperature:     0.3,
          max_tokens:      MAX_ANSWER_TOKENS,
        },
        { signal: controller.signal }
      );
      clearTimeout(timer);

      inputTokens  = completion.usage?.prompt_tokens     ?? null;
      outputTokens = completion.usage?.completion_tokens ?? null;
      totalTokens  = completion.usage?.total_tokens      ?? null;

      const raw = completion.choices[0]?.message?.content ?? "{}";
      let parsed: any;
      try { parsed = JSON.parse(raw); } catch { parsed = {}; }

      llmOutput = {
        confidence:           (["HIGH", "MEDIUM", "LOW"].includes(parsed.confidence ?? ""))
                                ? parsed.confidence as "HIGH" | "MEDIUM" | "LOW"
                                : "LOW",
        answer:               typeof parsed.answer === "string" && parsed.answer.trim()
                                ? parsed.answer.trim()
                                : "답변을 완료하지 못했습니다. 상담사 연결을 추천드립니다.",
        requires_human:       parsed.requires_human === true,
        suggested_next_action: parsed.suggested_next_action ?? null,
      };

      addStage(trace, "LLM_DONE", {
        model:         LLM_MODEL,
        input_tokens:  inputTokens,
        output_tokens: outputTokens,
        total_tokens:  totalTokens,
        confidence:    llmOutput.confidence,
        requires_human: llmOutput.requires_human,
      });
    } catch (e: any) {
      clearTimeout(timer);
      const isTimeout =
        controller.signal.aborted ||
        e?.name === "AbortError" ||
        String(e?.message ?? "").toLowerCase().includes("aborted");
      llmError = isTimeout ? "TIMEOUT" : "LLM_ERROR";
      console.error("[support/respond] LLM error:", llmError, e?.message);

      addStage(trace, "LLM_FAIL", { error_code: llmError });

      llmOutput = {
        confidence:           "LOW",
        answer:               "일시적인 오류로 자동 답변을 완료하지 못했습니다. 상담사에게 문의해주세요.",
        requires_human:       true,
        suggested_next_action: "REQUIRES_HUMAN",
      };
    }
  }

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
  };

  if (llmError) {
    await saveAiTrace({
      ...traceBase,
      status:      "FAILED",
      error_stage: "LLM_GENERATION",
      error_code:  llmError,
      latency_ms:  latencyMs,
      model:       LLM_MODEL,
    }).catch(() => {});
  } else if (evidence.length === 0) {
    // No evidence branch — no OpenAI call; model=null (API was never invoked)
    await saveAiTrace({
      ...traceBase,
      status:          "SUCCESS",
      generation_mode: "no_evidence",
      model:           null,
      latency_ms:      latencyMs,
      input_tokens:    null,
      output_tokens:   null,
      total_tokens:    null,
      result_generated: false,
    }).catch(() => {});
  } else {
    await saveAiTrace({
      ...traceBase,
      status:           "SUCCESS",
      generation_mode:  "llm_grounded",
      model:            LLM_MODEL,
      latency_ms:       latencyMs,
      input_tokens:     inputTokens,
      output_tokens:    outputTokens,
      total_tokens:     totalTokens,
      knowledge_hit_count: evidence.length,
      result_generated:    llmOutput!.confidence !== "LOW",
    }).catch(() => {});
  }

  // ── AI message store + state transition ──────────────────────────────────

  const toState: string = llmOutput!.confidence === "LOW" || llmOutput!.requires_human
    ? "HUMAN_REQUIRED"
    : "AI_RESPONDED";

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
      content:    llmOutput!.answer,
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
    // Immediate flush to capture pg error code in DB before HTTP_RESPONSE
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
    model:         llmActuallyCalled ? LLM_MODEL : null,
    evidence_count: evidence.length,
  });
  void flushSupportTrace(trace, {
    http_status:    200,
    success:        true,
    answer_present: true,
    case_id_present: !!caseId,
  });

  return res.json({
    ok:         true,
    llm_used:   llmActuallyCalled,
    llm_called: llmActuallyCalled && !llmError,
    source:     "LLM",
    confidence: llmOutput!.confidence,
    answer:     llmOutput!.answer,
    case_state: toState,
    requires_human: llmOutput!.requires_human,
    suggested_next_action: llmOutput!.suggested_next_action ?? null,
  });
});

export default router;
