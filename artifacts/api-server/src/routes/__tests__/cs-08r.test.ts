/**
 * CS-08R — Support AI Engine / LLM Last Fallback Tests
 *
 * CS08R-01  deterministic (RULE hit) → llm_used=false, llm_called=false
 * CS08R-02  deterministic (DB_STATE hit) → llm_used=false, no OpenAI call
 * CS08R-03  deterministic (SOLUTION hit) → AI message stored
 * CS08R-04  deterministic (FRONTEND_MAP hit) → llm_used=false
 * CS08R-05  deterministic (FAQ hit) → case_state=AI_RESPONDED
 * CS08R-06  NO_MATCH + evidence → OpenAI called, llm_used=true
 * CS08R-07  NO_MATCH + no evidence → OpenAI NOT called, LOW confidence, requires_human=true
 * CS08R-08  OpenAI HIGH confidence → case_state=AI_RESPONDED
 * CS08R-09  OpenAI MEDIUM confidence → case_state=AI_RESPONDED
 * CS08R-10  OpenAI LOW confidence → case_state=HUMAN_REQUIRED, requires_human=true
 * CS08R-11  OpenAI timeout → LOW confidence + HUMAN_REQUIRED (non-fatal)
 * CS08R-12  OpenAI LLM_ERROR → graceful fallback, not 500
 * CS08R-13  user message always stored (author_role=user) regardless of LLM result
 * CS08R-14  AI message stored (author_role=ai) after deterministic
 * CS08R-15  AI message stored (author_role=ai) after LLM
 * CS08R-16  AI_PROCESSING transition from NEW
 * CS08R-17  AI_PROCESSING from AI_RESPONDED allowed
 * CS08R-18  saveAiTrace called with AI_FEATURE.SUPPORT_AI (deterministic path)
 * CS08R-19  saveAiTrace sub_feature=SUPPORT_RESPONSE
 * CS08R-20  no raw message content in saveAiTrace (privacy)
 * CS08R-21  case not found → 404
 * CS08R-22  tenant isolation — wrong actor_id → 403
 * CS08R-23  terminal state (RESOLVED) → 409
 * CS08R-24  missing case_id → 400
 * CS08R-25  missing message → 400
 * CS08R-26  401 without auth
 * CS08R-27  pool isolation across different pool
 * CS08R-28  event log written with correct caseId
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── vi.hoisted — variables referenced in vi.mock factory functions ─────────────
// (vi.mock is hoisted before imports; vi.hoisted ensures these are available)

const mockCreate          = vi.hoisted(() => vi.fn());
const traceCalls          = vi.hoisted(() => [] as any[]);
const mockRunResolutionChain = vi.hoisted(() => vi.fn());
const mockGatherEvidence  = vi.hoisted(() => vi.fn());

// ── In-memory stores (NOT in factories; ok to declare here) ──────────────────

let knowledgeStore: any[] = [];
let poolStore:      any[] = [];
let reportStore:    any[] = [];
let caseStore:      any[] = [];
let repliesStore:   any[] = [];
let eventLogs:      any[] = [];
let incidentStore:  any[] = [];

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../../middlewares/auth.js", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.headers["x-test-user"]) return res.status(401).json({ error: "Unauthorized" });
    req.user = JSON.parse(req.headers["x-test-user"] as string);
    next();
  },
}));

vi.mock("drizzle-orm", () => {
  function sql(strings: TemplateStringsArray, ...values: any[]) {
    const text = strings.reduce(
      (acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ""),
      ""
    );
    return { __raw: false, __text: text, __values: values };
  }
  sql.raw = (t: string, p?: any[]) => ({ __raw: true, __text: t, __values: p ?? [] });
  return { sql };
});

vi.mock("@workspace/db", () => {
  const executeQuery = (q: any): any => {
    const text: string = (q.__text ?? "").replace(/\s+/g, " ");
    const params: any[] = q.__values ?? [];

    if (text.includes("INSERT INTO event_logs")) {
      eventLogs.push({ params });
      return { rows: [] };
    }
    if (text.includes("FROM support_cases")) {
      const id = params[0];
      const found = caseStore.find((c) => c.id === id);
      return { rows: found ? [found] : [] };
    }
    if (text.includes("UPDATE support_cases") && text.includes("turn_count")) {
      return { rows: [] };
    }
    if (text.includes("UPDATE support_cases") && text.includes("state")) {
      const newState = params[0];
      const id       = params.at(-1);
      const sc = caseStore.find((c) => c.id === id);
      if (sc && newState) sc.state = newState;
      return { rows: [] };
    }
    if (text.includes("INSERT INTO support_ticket_replies")) {
      const reply: any = {
        id:           params[0],
        ticket_id:    params[1],
        case_id:      params[2],
        author_user_id: params[3],
        author_name:  params[4],
        author_role:  params[5],
        message_type: params[6],
        content:      params[7],
      };
      repliesStore.push(reply);
      return { rows: [{ id: reply.id }] };
    }
    if (text.includes("FROM swimming_pools")) {
      const found = poolStore.find((p) => p.id === params[0]);
      return { rows: found ? [found] : [] };
    }
    if (text.includes("FROM growth_reports")) {
      return { rows: reportStore.filter((r) => r.pool_id === params[0] && r.status === "PENDING") };
    }
    if (text.includes("FROM super_incidents")) {
      const idsParam = params.find((p: any) => typeof p === "string" && p.startsWith("["));
      let filterIds: string[] | null = null;
      if (idsParam) { try { filterIds = JSON.parse(idsParam); } catch {} }
      return {
        rows: incidentStore.filter((i) =>
          ["OPEN", "INVESTIGATING", "MITIGATED"].includes(i.status) &&
          (!filterIds || filterIds.includes(i.id))
        ),
      };
    }
    if (text.includes("FROM support_knowledge_items")) {
      return { rows: [] };
    }
    return { rows: [] };
  };

  return {
    superAdminDb: { execute: vi.fn((q: any) => Promise.resolve(executeQuery(q))) },
    db:           { execute: vi.fn((q: any) => Promise.resolve(executeQuery(q))) },
  };
});

// Mock ai.ts's getOpenAI directly — bypasses OPENAI_API_KEY guard
vi.mock("../ai.js", () => ({
  getOpenAI: () => ({ chat: { completions: { create: mockCreate } } }),
}));

vi.mock("../../lib/ai-trace-service.js", () => ({
  saveAiTrace: vi.fn((p: any) => {
    traceCalls.push(p);
    return Promise.resolve();
  }),
}));

vi.mock("../../lib/support-resolver.js", () => ({
  runResolutionChain: (...args: any[]) => mockRunResolutionChain(...args),
  gatherEvidence:     (...args: any[]) => mockGatherEvidence(...args),
  tokenize:           (s: string) =>
    s.toLowerCase().replace(/[^\w\s가-힣]/g, " ").split(/\s+/).filter((t: string) => t.length >= 2),
  normalizeQuery:     (s: string) => s.toLowerCase().trim(),
}));

// support-case-service uses superAdminDb — already mocked via @workspace/db
vi.mock("../../lib/support-case-service.js", () => ({
  transitionSupportCase: vi.fn().mockResolvedValue({ ok: true }),
  logSupportEvent:       vi.fn().mockResolvedValue(undefined),
  VALID_TRANSITIONS: {},
}));

// ── Router under test (imported after mocks) ──────────────────────────────────

import supportRespondRouter from "../support-respond.js";

// ── App factory ───────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(supportRespondRouter);
  return app;
}

// ── Seed helpers ──────────────────────────────────────────────────────────────

function seedCase(overrides: Partial<any> = {}): any {
  const sc = {
    id:                `sc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    state:             "NEW",
    pool_id:           "pool_01",
    ticket_id:         null,
    actor_id:          "user_01",
    escalation_reason: null,
    ...overrides,
  };
  caseStore.push(sc);
  return sc;
}

const DEFAULT_USER = {
  userId: "user_01",
  role:   "pool_admin",
  poolId: "pool_01",
  name:   "Test Admin",
};

const DET_RESOLVED = {
  resolution_status: "RESOLVED",
  source_type:       "RULE",
  source_id:         "rule_01",
  confidence:        90,
  title:             "테스트 규칙",
  answer:            "규칙 답변입니다.",
  requires_human:    false,
  llm_required:      false,
};

const NO_MATCH = {
  resolution_status: "NO_MATCH",
  source_type:       "NONE",
  source_id:         null,
  confidence:        0,
  title:             null,
  answer:            null,
  requires_human:    true,
  llm_required:      true,
};

function makeEvidence(n = 1) {
  return Array.from({ length: n }, (_, i) => ({
    id:        `ki_${i + 1}`,
    item_type: "FAQ",
    title:     `FAQ 항목 ${i + 1}`,
    answer:    `FAQ 답변 ${i + 1}`,
    score:     70,
  }));
}

function openAiResponse(confidence: "HIGH" | "MEDIUM" | "LOW", answer = "AI 답변입니다.") {
  return {
    choices: [{
      message: {
        content: JSON.stringify({
          confidence,
          answer,
          requires_human:       confidence === "LOW",
          suggested_next_action: confidence === "LOW" ? "REQUIRES_HUMAN" : null,
        }),
      },
    }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  };
}

// ── beforeEach ────────────────────────────────────────────────────────────────

beforeEach(() => {
  knowledgeStore.length = 0;
  poolStore.length      = 0;
  reportStore.length    = 0;
  caseStore.length      = 0;
  repliesStore.length   = 0;
  eventLogs.length      = 0;
  incidentStore.length  = 0;
  traceCalls.length     = 0;

  mockCreate.mockReset();
  mockRunResolutionChain.mockReset();
  mockGatherEvidence.mockReset();
  mockGatherEvidence.mockResolvedValue([]);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CS-08R — Support AI Engine / LLM Last Fallback", () => {

  // CS08R-01: RULE hit → deterministic, no LLM
  it("CS08R-01 deterministic RULE → llm_used=false, llm_called=false", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(DET_RESOLVED);

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc.id, message: "X 모드 규칙이 뭔가요?" });

    expect(res.status).toBe(200);
    expect(res.body.llm_used).toBe(false);
    expect(res.body.llm_called).toBe(false);
    expect(res.body.source).toBe("RULE");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // CS08R-02: DB_STATE hit → llm_used=false
  it("CS08R-02 deterministic DB_STATE hit → llm_used=false, no OpenAI", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce({
      ...DET_RESOLVED, source_type: "DB_STATE", source_id: "pool_01",
    });

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc.id, message: "구독 상태를 확인하고 싶어요" });

    expect(res.status).toBe(200);
    expect(res.body.llm_used).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // CS08R-03: SOLUTION hit → AI message stored
  it("CS08R-03 deterministic SOLUTION hit → AI message stored in DB", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce({
      ...DET_RESOLVED, source_type: "SOLUTION", source_id: "sol_01",
      answer: "결제 오류 해결 방법입니다.",
    });

    await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc.id, message: "결제가 안 돼요" });

    const aiMsg = repliesStore.find((r) => r.author_role === "ai");
    expect(aiMsg).toBeDefined();
    expect(aiMsg.content).toBe("결제 오류 해결 방법입니다.");
    expect(aiMsg.case_id).toBe(sc.id);
  });

  // CS08R-04: FRONTEND_MAP hit → llm_used=false
  it("CS08R-04 deterministic FRONTEND_MAP hit → llm_used=false", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce({
      ...DET_RESOLVED, source_type: "FRONTEND_MAP",
      answer: "설정 화면으로 이동하세요.",
    });

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc.id, message: "설정 메뉴 어디 있나요?" });

    expect(res.status).toBe(200);
    expect(res.body.llm_used).toBe(false);
    expect(res.body.source).toBe("FRONTEND_MAP");
  });

  // CS08R-05: FAQ hit → case_state=AI_RESPONDED
  it("CS08R-05 deterministic FAQ hit → case_state=AI_RESPONDED", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce({
      ...DET_RESOLVED, source_type: "FAQ",
      answer: "자주 묻는 질문 답변입니다.",
    });

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc.id, message: "공지 알림이 안와요" });

    expect(res.status).toBe(200);
    expect(res.body.case_state).toBe("AI_RESPONDED");
  });

  // CS08R-06: NO_MATCH + evidence → OpenAI called
  it("CS08R-06 NO_MATCH + evidence → OpenAI called, llm_used=true", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(NO_MATCH);
    mockGatherEvidence.mockResolvedValueOnce(makeEvidence(1));
    mockCreate.mockResolvedValueOnce(openAiResponse("HIGH"));

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc.id, message: "수영 연습 횟수에 대해 알고 싶어요" });

    expect(res.status).toBe(200);
    expect(res.body.llm_used).toBe(true);
    expect(res.body.llm_called).toBe(true);
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  // CS08R-07: NO_MATCH + no evidence → OpenAI NOT called
  it("CS08R-07 NO_MATCH + no evidence → OpenAI NOT called, LOW confidence", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(NO_MATCH);
    mockGatherEvidence.mockResolvedValueOnce([]);

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc.id, message: "완전히 알 수 없는 주제" });

    expect(res.status).toBe(200);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(res.body.confidence).toBe("LOW");
    expect(res.body.requires_human).toBe(true);
    expect(res.body.llm_called).toBe(false);
  });

  // CS08R-08: OpenAI HIGH → AI_RESPONDED
  it("CS08R-08 OpenAI HIGH → case_state=AI_RESPONDED", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(NO_MATCH);
    mockGatherEvidence.mockResolvedValueOnce(makeEvidence(2));
    mockCreate.mockResolvedValueOnce(openAiResponse("HIGH", "발차기 자세 교정 답변"));

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc.id, message: "수영 발차기 자세 교정은 어떻게 하나요?" });

    expect(res.body.case_state).toBe("AI_RESPONDED");
    expect(res.body.confidence).toBe("HIGH");
  });

  // CS08R-09: OpenAI MEDIUM → AI_RESPONDED
  it("CS08R-09 OpenAI MEDIUM → case_state=AI_RESPONDED", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(NO_MATCH);
    mockGatherEvidence.mockResolvedValueOnce(makeEvidence(1));
    mockCreate.mockResolvedValueOnce(openAiResponse("MEDIUM", "중간 신뢰도 답변"));

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc.id, message: "레인 예약 방법" });

    expect(res.body.case_state).toBe("AI_RESPONDED");
    expect(res.body.confidence).toBe("MEDIUM");
  });

  // CS08R-10: OpenAI LOW → HUMAN_REQUIRED
  it("CS08R-10 OpenAI LOW → case_state=HUMAN_REQUIRED, requires_human=true", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(NO_MATCH);
    mockGatherEvidence.mockResolvedValueOnce(makeEvidence(1));
    mockCreate.mockResolvedValueOnce(openAiResponse("LOW", "잘 모르겠습니다. 상담사에게 문의하세요."));

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc.id, message: "저수심 수영 방법" });

    expect(res.body.case_state).toBe("HUMAN_REQUIRED");
    expect(res.body.requires_human).toBe(true);
  });

  // CS08R-11: OpenAI timeout → graceful fallback, HUMAN_REQUIRED
  it("CS08R-11 OpenAI timeout → graceful fallback, HUMAN_REQUIRED", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(NO_MATCH);
    mockGatherEvidence.mockResolvedValueOnce(makeEvidence(1));
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    mockCreate.mockRejectedValueOnce(abortErr);

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc.id, message: "숨 쉬는 타이밍" });

    expect(res.status).toBe(200);
    expect(res.body.confidence).toBe("LOW");
    expect(res.body.case_state).toBe("HUMAN_REQUIRED");
  });

  // CS08R-12: LLM error → graceful fallback, not 500
  it("CS08R-12 LLM error → graceful fallback, not 500", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(NO_MATCH);
    mockGatherEvidence.mockResolvedValueOnce(makeEvidence(1));
    mockCreate.mockRejectedValueOnce(new Error("network failure"));

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc.id, message: "입수 자세 교정" });

    expect(res.status).toBe(200);
    expect(res.body.confidence).toBe("LOW");
    expect(res.body.requires_human).toBe(true);
  });

  // CS08R-13: user message always stored
  it("CS08R-13 user message always stored (author_role=user)", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(DET_RESOLVED);

    await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc.id, message: "테스트 사용자 메시지" });

    const userMsg = repliesStore.find((r) => r.author_role === "user");
    expect(userMsg).toBeDefined();
    expect(userMsg.content).toBe("테스트 사용자 메시지");
    expect(userMsg.case_id).toBe(sc.id);
  });

  // CS08R-14: AI message stored after deterministic
  it("CS08R-14 AI message stored (author_role=ai) after deterministic", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce({
      ...DET_RESOLVED, answer: "확인된 AI 답변",
    });

    await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc.id, message: "X 모드 활성화 방법은?" });

    const aiMsg = repliesStore.find((r) => r.author_role === "ai");
    expect(aiMsg).toBeDefined();
    expect(aiMsg.content).toBe("확인된 AI 답변");
  });

  // CS08R-15: AI message stored after LLM
  it("CS08R-15 AI message stored (author_role=ai) after LLM", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(NO_MATCH);
    mockGatherEvidence.mockResolvedValueOnce(makeEvidence(1));
    mockCreate.mockResolvedValueOnce(openAiResponse("HIGH", "LLM이 생성한 답변입니다."));

    await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc.id, message: "수업 일정 조회" });

    const aiMsg = repliesStore.find((r) => r.author_role === "ai");
    expect(aiMsg).toBeDefined();
    expect(aiMsg.content).toBe("LLM이 생성한 답변입니다.");
  });

  // CS08R-16: AI_PROCESSING transition from NEW
  it("CS08R-16 NEW → AI_PROCESSING transition triggered", async () => {
    const sc = seedCase({ state: "NEW" });
    mockRunResolutionChain.mockResolvedValueOnce(DET_RESOLVED);

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc.id, message: "새 문의 메시지" });

    // transitionSupportCase is mocked and called
    const { transitionSupportCase } = await import("../../lib/support-case-service.js");
    expect(transitionSupportCase).toHaveBeenCalledWith(
      expect.objectContaining({ toState: "AI_PROCESSING" })
    );
    expect(res.status).toBe(200);
  });

  // CS08R-17: AI_PROCESSING from AI_RESPONDED
  it("CS08R-17 AI_RESPONDED → AI_PROCESSING allowed", async () => {
    const sc = seedCase({ state: "AI_RESPONDED" });
    mockRunResolutionChain.mockResolvedValueOnce(DET_RESOLVED);

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc.id, message: "추가 질문입니다" });

    expect(res.status).toBe(200);
  });

  // CS08R-18: saveAiTrace called in deterministic path
  it("CS08R-18 saveAiTrace called with feature=support_ai (deterministic path)", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(DET_RESOLVED);

    await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc.id, message: "트레이스 테스트" });

    expect(traceCalls.length).toBeGreaterThanOrEqual(1);
    expect(traceCalls[0].feature).toBe("support_ai");
  });

  // CS08R-19: saveAiTrace sub_feature=SUPPORT_RESPONSE
  it("CS08R-19 saveAiTrace sub_feature=SUPPORT_RESPONSE", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(DET_RESOLVED);

    await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc.id, message: "sub feature 테스트" });

    expect(traceCalls.length).toBeGreaterThanOrEqual(1);
    expect(traceCalls[0].sub_feature).toBe("SUPPORT_RESPONSE");
  });

  // CS08R-20: no raw message in saveAiTrace (privacy)
  it("CS08R-20 saveAiTrace does NOT contain raw user message (privacy)", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(DET_RESOLVED);

    const SECRET_MSG = "나의개인정보비밀메시지테스트내용XYZABC";
    await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc.id, message: SECRET_MSG });

    const traceStr = JSON.stringify(traceCalls);
    expect(traceStr).not.toContain(SECRET_MSG);
  });

  // CS08R-21: case not found → 404
  it("CS08R-21 case not found → 404", async () => {
    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: "nonexistent_case_id", message: "메시지" });

    expect(res.status).toBe(404);
  });

  // CS08R-22: wrong actor_id → 403
  it("CS08R-22 tenant isolation wrong actor_id → 403", async () => {
    const sc = seedCase({ actor_id: "other_user_999", pool_id: "pool_01" });

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify({ ...DEFAULT_USER, userId: "user_01" }))
      .send({ case_id: sc.id, message: "남의 케이스에 메시지" });

    expect(res.status).toBe(403);
  });

  // CS08R-23: terminal state RESOLVED → 409
  it("CS08R-23 RESOLVED state → 409", async () => {
    const sc = seedCase({ state: "RESOLVED" });

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc.id, message: "해결된 케이스에 메시지" });

    expect(res.status).toBe(409);
  });

  // CS08R-24: missing case_id → 400
  it("CS08R-24 missing case_id → 400", async () => {
    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ message: "case_id 없음" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/case_id/);
  });

  // CS08R-25: missing message → 400
  it("CS08R-25 missing message → 400", async () => {
    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: "sc_test" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/message/);
  });

  // CS08R-26: no auth → 401
  it("CS08R-26 no auth → 401", async () => {
    const res = await request(buildApp())
      .post("/support/respond")
      .send({ case_id: "sc_test", message: "인증 없음" });

    expect(res.status).toBe(401);
  });

  // CS08R-27: pool isolation — different pool_id
  it("CS08R-27 pool isolation different pool_id → 403", async () => {
    const sc = seedCase({ pool_id: "pool_other", actor_id: "user_01" });

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify({ ...DEFAULT_USER, poolId: "pool_01" }))
      .send({ case_id: sc.id, message: "다른 수영장 케이스" });

    expect(res.status).toBe(403);
  });

  // CS08R-28: event log written after AI response
  it("CS08R-28 event log written after AI response", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(DET_RESOLVED);

    await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc.id, message: "이벤트 로그 확인" });

    // logSupportEvent is mocked — verify it was called with the caseId
    const { logSupportEvent } = await import("../../lib/support-case-service.js");
    expect(logSupportEvent).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: sc.id })
    );
  });
});
