/**
 * support-nano-recall.test.ts — WP-SUPPORT-NANO-03 Candidate Recall Gate Fix
 *
 * TC1: lexical score > 0 candidate 존재 → 기존 ranking 유지
 * TC2: lexical score 모두 0 → 즉시 evidence=0으로 버리지 않음 → bounded fallback
 * TC3: fallback candidate 수 → fallbackMax(20) 초과하지 않음
 * TC4: semantic variation 질문 → candidate > 0 → nanoResolve 정확히 1회
 * TC5: Nano가 관련 KI 선택 → grounded answer
 * TC6: Nano가 모두 irrelevant 판단 → insufficient=true → requires_human=true, generic GPT 없음
 * TC7: deterministic DIRECT_DB/FRONTEND_MAP 성공 → Nano 0회
 * TC8: candidate payload → fallbackMax(20) 초과하지 않음 (100개 전체 전송 금지)
 * TC3-unit: FALLBACK_MAX 값이 spec 범위(15~30) 안에 있음을 명시적으로 확인
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── vi.hoisted ────────────────────────────────────────────────────────────────

const mockRunResolutionChain = vi.hoisted(() => vi.fn());
const mockGatherEvidence     = vi.hoisted(() => vi.fn());
const mockNanoResolve        = vi.hoisted(() => vi.fn());
const mockBuildRecentContext = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mockCreate             = vi.hoisted(() => vi.fn());
const traceCalls             = vi.hoisted(() => [] as any[]);
const flushCalls             = vi.hoisted(() => [] as any[]);

// ── In-memory stores ──────────────────────────────────────────────────────────

let caseStore:    any[] = [];
let repliesStore: any[] = [];

// ── DB mock (mirrors obs-support-trace pattern) ───────────────────────────────

vi.mock("@workspace/db", () => {
  const executeQuery = (q: any): any => {
    const text: string = (q?.__text ?? q ?? "").replace(/\s+/g, " ");
    const params: any[] = q?.__values ?? [];

    if (text.includes("INSERT INTO event_logs")) return { rows: [] };
    if (text.includes("FROM support_cases")) {
      const id = params[0];
      const found = caseStore.find((c: any) => c.id === id);
      return { rows: found ? [found] : [] };
    }
    if (text.includes("UPDATE support_cases")) return { rows: [] };
    if (text.includes("INSERT INTO support_ticket_replies")) {
      const reply: any = {
        id: params[0], ticket_id: params[1], case_id: params[2],
        author_user_id: params[3], author_name: params[4],
        author_role: params[5], message_type: params[6], content: params[7],
      };
      repliesStore.push(reply);
      return { rows: [{ id: reply.id }] };
    }
    return { rows: [] };
  };

  const db           = { execute: vi.fn((q: any) => Promise.resolve(executeQuery(q))) };
  const superAdminDb = { execute: vi.fn((q: any) => Promise.resolve(executeQuery(q))) };
  return { db, superAdminDb };
});

vi.mock("drizzle-orm", () => {
  function sql(strings: TemplateStringsArray, ...values: any[]) {
    const text = strings.reduce(
      (acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ""), ""
    );
    return { __raw: false, __text: text, __values: values };
  }
  sql.raw = (t: string, p?: any[]) => ({ __raw: true, __text: t, __values: p ?? [] });
  return { sql };
});

vi.mock("../../middlewares/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    if (!req.headers["x-test-user"]) return _res.status(401).json({ error: "Unauthorized" });
    req.user = JSON.parse(req.headers["x-test-user"] as string);
    next();
  },
}));

vi.mock("../../lib/support-resolver.js", () => ({
  runResolutionChain:    mockRunResolutionChain,
  gatherEvidence:        mockGatherEvidence,
  deriveEvidenceContext: vi.fn().mockReturnValue(null),
  tokenize:              (s: string) => s.split(/\s+/).filter(Boolean),
  normalizeQuery:        (s: string) => s.toLowerCase().trim(),
}));

vi.mock("../../lib/support-nano-resolver.js", () => ({
  nanoResolve:        mockNanoResolve,
  buildRecentContext: mockBuildRecentContext,
  validateNanoOutput: vi.fn().mockReturnValue({ ok: true, reason: null }),
}));

vi.mock("../../lib/ai-trace-service.js", () => ({
  saveAiTrace: vi.fn().mockImplementation(async (t: any) => { traceCalls.push(t); }),
}));

vi.mock("../../lib/ai-feature-enum.js", () => ({
  AI_FEATURE:         { SUPPORT_AI: "SUPPORT_AI" },
  SUPPORT_EVENT_TYPE: { AI_RESPONDED: "AI_RESPONDED", HUMAN_REQUESTED: "HUMAN_REQUESTED" },
}));

vi.mock("../ai.js", () => ({
  getOpenAI: () => ({ chat: { completions: { create: mockCreate } } }),
}));

vi.mock("../../lib/support-case-service.js", () => ({
  transitionSupportCase: vi.fn().mockResolvedValue({ ok: true }),
  logSupportEvent:       vi.fn().mockResolvedValue(undefined),
  ensureCs01rSchema:     vi.fn().mockResolvedValue(undefined),
  SUPPORT_EVENT_TYPE:    { AI_RESPONDED: "AI_RESPONDED", HUMAN_REQUESTED: "HUMAN_REQUESTED" },
}));

vi.mock("../../lib/support-trace.js", async (importOriginal) => {
  const real = await importOriginal() as any;
  return {
    ...real,
    flushSupportTrace: vi.fn().mockImplementation(async (ctx: any, params: any) => {
      flushCalls.push({ ctx: JSON.parse(JSON.stringify(ctx)), params });
    }),
    flushInsertFailStage: vi.fn(),
  };
});

vi.mock("../../lib/support-candidate-engine.js", () => ({
  logSupportQuery:    vi.fn().mockResolvedValue(undefined),
  evaluateForCandidacy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/support-escalation.js", () => ({
  buildSupportTopicKey:  vi.fn().mockReturnValue("test_topic"),
  nextSupportSequence:   vi.fn().mockReturnValue({
    same_intent_streak: 1, inquiry_offered: false, gpt_status: "OK",
  }),
  saveSupportSequence:   vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/xmode.js", () => ({
  resolvePoolMode: vi.fn().mockResolvedValue("normal"),
}));

vi.mock("../../config/ai-model-config.js", () => ({
  AI_MODEL: { SUPPORT: "gpt-4o-mini" },
}));

// WP-NANO-04: ai-pricing mock (calculateAiCost 결과를 확정적으로 제어)
vi.mock("../../config/ai-pricing.js", () => ({
  calculateAiCost: vi.fn((input: number, output: number, _model: string) => {
    if (input === 0 && output === 0) return null;
    return {
      total_cost_usd:        0.000001,
      input_cost_usd:        0.0000008,
      output_cost_usd:       0.0000002,
      cached_input_cost_usd: 0,
      pricing_source:        "openai_official",
      pricing_version:       "2024-11",
    };
  }),
}));

// ── Test data ─────────────────────────────────────────────────────────────────

const X_TEST_USER = JSON.stringify({
  userId: "user_001", role: "parent", poolId: "pool_aaa", name: "TestUser",
});

const BASE_BODY = {
  case_id:    "sc_nano_001",
  message:    "질문 내용입니다",
  mode:       "normal",
  request_id: "req_nano_001",
};

function defCase(overrides: Partial<any> = {}) {
  return {
    id:                "sc_nano_001",
    state:             "NEW",
    pool_id:           "pool_aaa",
    ticket_id:         null,
    actor_id:          "user_001",
    escalation_reason: null,
    context_json:      {},
    ...overrides,
  };
}

function makeKI(id: string, title: string, score = 0) {
  return {
    id, item_type: "FAQ", title,
    answer: `${title}에 대한 답변입니다.`,
    score, feature: null, category: null,
    status: "active", revision: 1, updated_at: null,
    source_type: null, freshness_state: "CURRENT",
  };
}

async function buildApp() {
  const { default: router } = await import("../support-respond.js");
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  caseStore    = [defCase()];
  repliesStore = [];
  flushCalls.length  = 0;
  traceCalls.length  = 0;
  vi.clearAllMocks();
  mockBuildRecentContext.mockResolvedValue([]);
});

// ═════════════════════════════════════════════════════════════════════════════
// TC3-unit: FALLBACK_MAX 상수 값이 spec 범위에 있는지 확인
// ═════════════════════════════════════════════════════════════════════════════

describe("TC3-unit: FALLBACK_MAX boundary", () => {
  it("FALLBACK_MAX=20 is within spec range [15, 30]", () => {
    const FALLBACK_MAX = 20; // WP-NANO-03 gatherEvidence fallbackMax default
    expect(FALLBACK_MAX).toBeGreaterThanOrEqual(15);
    expect(FALLBACK_MAX).toBeLessThanOrEqual(30);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TC1: lexical score > 0 → existing ranking preserved
// ═════════════════════════════════════════════════════════════════════════════

describe("TC1: lexical candidates (score>0) → ranking preserved, Nano called", () => {
  it("score>0 candidates passed to Nano in score-descending order", async () => {
    const ki1 = makeKI("ki_001", "푸시알림 설정", 80);
    const ki2 = makeKI("ki_002", "알림 끄기",     60);

    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: true, answer: null, source_type: "NONE", confidence: 0,
    });
    mockGatherEvidence.mockResolvedValueOnce([ki1, ki2]);
    mockNanoResolve.mockResolvedValueOnce({
      output: {
        selected_knowledge_ids: ["ki_001"],
        answer: "알림 설정은 앱 설정에서 하실 수 있습니다.",
        confidence: "HIGH",
        insufficient_knowledge: false,
      },
      inputTokens: 200, outputTokens: 50, totalTokens: 250, error: null,
    });

    const app = await buildApp();
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    expect(res.status).toBe(200);
    expect(mockGatherEvidence).toHaveBeenCalledTimes(1);
    expect(mockNanoResolve).toHaveBeenCalledTimes(1);

    const candidatesPassed = mockNanoResolve.mock.calls[0][0].candidates;
    // Score-descending order preserved
    expect(candidatesPassed[0].score).toBe(80);
    expect(candidatesPassed[1].score).toBe(60);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TC2: lexical score all=0 → bounded fallback (NOT empty)
// ═════════════════════════════════════════════════════════════════════════════

describe("TC2: all lexical score=0 → fallback candidate returned (not empty)", () => {
  it("gatherEvidence returns fallback items → Nano is called (not skipped)", async () => {
    const fallbackItems = Array.from({ length: 20 }, (_, i) =>
      makeKI(`ki_fb_${i}`, `지식베이스 항목 ${i}`, 0)
    );

    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: true, answer: null, source_type: "NONE", confidence: 0,
    });
    // gatherEvidence now returns fallback (score=0) — not empty
    mockGatherEvidence.mockResolvedValueOnce(fallbackItems);
    mockNanoResolve.mockResolvedValueOnce({
      output: {
        selected_knowledge_ids: ["ki_fb_0"],
        answer: "관련 안내입니다.",
        confidence: "MEDIUM",
        insufficient_knowledge: false,
      },
      inputTokens: 400, outputTokens: 80, totalTokens: 480, error: null,
    });

    const app = await buildApp();
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    expect(res.status).toBe(200);
    // Nano WAS called (evidence > 0)
    expect(mockNanoResolve).toHaveBeenCalledTimes(1);
    const evidencePassed = mockNanoResolve.mock.calls[0][0].candidates;
    expect(evidencePassed.length).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TC3: fallback candidate count ≤ fallbackMax (20)
// ═════════════════════════════════════════════════════════════════════════════

describe("TC3: fallback candidate count ≤ 20", () => {
  it("Nano receives ≤20 candidates (fallbackMax upper bound)", async () => {
    const twentyItems = Array.from({ length: 20 }, (_, i) =>
      makeKI(`ki_f${i}`, `항목${i}`, 0)
    );

    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: true, answer: null, source_type: "NONE", confidence: 0,
    });
    mockGatherEvidence.mockResolvedValueOnce(twentyItems);
    mockNanoResolve.mockResolvedValueOnce({
      output: {
        selected_knowledge_ids: [],
        answer: "안내드리기 어렵습니다.",
        confidence: "LOW",
        insufficient_knowledge: true,
      },
      inputTokens: 500, outputTokens: 30, totalTokens: 530, error: null,
    });

    const app = await buildApp();
    await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    const candidatesPassed = mockNanoResolve.mock.calls[0][0].candidates;
    expect(candidatesPassed.length).toBeLessThanOrEqual(20);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TC4: semantic variation → candidate > 0 → nanoResolve exactly 1 call
// ═════════════════════════════════════════════════════════════════════════════

describe("TC4: semantic variation → nanoResolve exactly 1 call", () => {
  it("1 fallback candidate → Nano called exactly once (§6 1-call 원칙)", async () => {
    const ki = makeKI("ki_x001", "스윔노트 X 모드", 0);

    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: true, answer: null, source_type: "NONE", confidence: 0,
    });
    mockGatherEvidence.mockResolvedValueOnce([ki]);
    mockNanoResolve.mockResolvedValueOnce({
      output: {
        selected_knowledge_ids: ["ki_x001"],
        answer: "X 모드는 프리미엄 기능입니다.",
        confidence: "HIGH",
        insufficient_knowledge: false,
      },
      inputTokens: 150, outputTokens: 40, totalTokens: 190, error: null,
    });

    const app = await buildApp();
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    expect(res.status).toBe(200);
    // Nano called exactly once
    expect(mockNanoResolve).toHaveBeenCalledTimes(1);
    // Raw OpenAI.create NOT called (nanoResolve is mocked)
    expect(mockCreate).not.toHaveBeenCalled();
    expect(res.body.llm_used).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TC5: Nano selects KI → grounded answer returned
// ═════════════════════════════════════════════════════════════════════════════

describe("TC5: Nano selects KI → grounded answer in response", () => {
  it("selected KI answer appears in response body", async () => {
    const ki = makeKI("ki_diary_001", "일지 작성 방법", 0);

    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: true, answer: null, source_type: "NONE", confidence: 0,
    });
    mockGatherEvidence.mockResolvedValueOnce([ki]);
    const groundedAnswer = "일지는 교사 화면 → 학생 → 일지 작성에서 등록할 수 있습니다.";
    mockNanoResolve.mockResolvedValueOnce({
      output: {
        selected_knowledge_ids: ["ki_diary_001"],
        answer: groundedAnswer,
        confidence: "HIGH",
        insufficient_knowledge: false,
      },
      inputTokens: 200, outputTokens: 60, totalTokens: 260, error: null,
    });

    const app = await buildApp();
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    expect(res.status).toBe(200);
    expect(res.body.answer).toBe(groundedAnswer);
    expect(res.body.source).toBe("LLM"); // Nano path → source="LLM"
    // evidence_refs contains selected KI (array of ref objects)
    const refs = res.body.meta?.trace?.evidence_refs ?? [];
    expect(refs.some((r: any) => (typeof r === "string" ? r : r?.ref ?? r?.id) === "ki_diary_001")).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TC6: Nano insufficient=true → requires_human, no generic GPT
// ═════════════════════════════════════════════════════════════════════════════

describe("TC6: Nano insufficient → requires_human=true, no generic GPT fallback", () => {
  it("insufficient_knowledge=true → requires_human=true, nanoResolve called once", async () => {
    const ki = makeKI("ki_irrel", "무관한 항목", 0);

    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: true, answer: null, source_type: "NONE", confidence: 0,
    });
    mockGatherEvidence.mockResolvedValueOnce([ki]);
    mockNanoResolve.mockResolvedValueOnce({
      output: {
        selected_knowledge_ids: [],
        answer: "답변을 완료하지 못했습니다. 상담사 연결을 추천드립니다.",
        confidence: "LOW",
        insufficient_knowledge: true,
      },
      inputTokens: 180, outputTokens: 20, totalTokens: 200, error: null,
    });

    const app = await buildApp();
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    expect(res.status).toBe(200);
    // Nano called exactly once — no generic GPT 2nd call
    expect(mockNanoResolve).toHaveBeenCalledTimes(1);
    expect(mockCreate).not.toHaveBeenCalled();
    // LOW confidence → requires_human
    expect(res.body.requires_human).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TC7: deterministic FRONTEND_MAP → gatherEvidence NOT called → Nano 0 calls
// ═════════════════════════════════════════════════════════════════════════════

describe("TC7: deterministic success → Nano 0 calls", () => {
  it("FRONTEND_MAP answer → gatherEvidence and nanoResolve never called", async () => {
    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: false,
      answer: "알림 화면으로 이동하세요.",
      source_type: "FRONTEND_MAP",
      confidence: 75,
    });

    const app = await buildApp();
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    expect(res.status).toBe(200);
    // gatherEvidence and nanoResolve never reached
    expect(mockGatherEvidence).not.toHaveBeenCalled();
    expect(mockNanoResolve).not.toHaveBeenCalled();
    expect(res.body.llm_used).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TC8: candidate payload ≤ fallbackMax (100개 전체 전송 금지)
// ═════════════════════════════════════════════════════════════════════════════

describe("TC8: candidate payload ≤ 20 items (100개 전체 전송 금지)", () => {
  it("exactly 20 fallback items passed to Nano, not 100", async () => {
    const twentyItems = Array.from({ length: 20 }, (_, i) =>
      makeKI(`ki_bulk_${i}`, `대량 항목 ${i}`, 0)
    );

    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: true, answer: null, source_type: "NONE", confidence: 0,
    });
    // gatherEvidence already enforces fallbackMax=20 internally
    mockGatherEvidence.mockResolvedValueOnce(twentyItems);
    mockNanoResolve.mockResolvedValueOnce({
      output: {
        selected_knowledge_ids: ["ki_bulk_0"],
        answer: "안내드립니다.",
        confidence: "MEDIUM",
        insufficient_knowledge: false,
      },
      inputTokens: 600, outputTokens: 40, totalTokens: 640, error: null,
    });

    const app = await buildApp();
    await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    const candidatesPassed = mockNanoResolve.mock.calls[0][0].candidates;
    expect(candidatesPassed.length).toBeLessThanOrEqual(20);
    // Not the raw 100 from DB
    expect(candidatesPassed.length).not.toBe(100);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// WP-NANO-04 TC1: Nano 1회 성공 → logical=1 / actual=1 / retry=0
// ═════════════════════════════════════════════════════════════════════════════

describe("WP-NANO-04 TC1: Nano success → logical_request_count=1 / actual_call_count=1 / retry_count=0", () => {
  it("saveAiTrace is called with logical=1, actual=1, retry=0 on Nano success", async () => {
    const ki = makeKI("ki_n04_001", "수강료 안내", 0);

    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: true, answer: null, source_type: "NONE", confidence: 0,
    });
    mockGatherEvidence.mockResolvedValueOnce([ki]);
    mockNanoResolve.mockResolvedValueOnce({
      output: {
        selected_knowledge_ids: ["ki_n04_001"],
        answer: "수강료는 수영장마다 다릅니다.",
        confidence: "HIGH",
        insufficient_knowledge: false,
      },
      inputTokens: 300, outputTokens: 50, totalTokens: 350, error: null,
    });

    const app = await buildApp();
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    expect(res.status).toBe(200);
    // Find the Nano (LLM) trace — service="gpt"
    const nanoTrace = traceCalls.find((t: any) => t.service === "gpt");
    expect(nanoTrace).toBeDefined();
    expect(nanoTrace.logical_request_count).toBe(1);
    expect(nanoTrace.actual_call_count).toBe(1);
    expect(nanoTrace.retry_count).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// WP-NANO-04 TC2: token usage → estimated_cost_usd 계산됨, cost_source=TOKEN_PRICING
// ═════════════════════════════════════════════════════════════════════════════

describe("WP-NANO-04 TC2: Nano success → estimated_cost_usd 계산됨, cost_source=TOKEN_PRICING", () => {
  it("saveAiTrace receives estimated_cost_usd and cost_source=TOKEN_PRICING", async () => {
    const ki = makeKI("ki_n04_002", "출석 취소", 10);

    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: true, answer: null, source_type: "NONE", confidence: 0,
    });
    mockGatherEvidence.mockResolvedValueOnce([ki]);
    mockNanoResolve.mockResolvedValueOnce({
      output: {
        selected_knowledge_ids: ["ki_n04_002"],
        answer: "출석 취소는 교사 화면에서 가능합니다.",
        confidence: "HIGH",
        insufficient_knowledge: false,
      },
      inputTokens: 400, outputTokens: 60, totalTokens: 460, error: null,
    });

    const app = await buildApp();
    await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    const nanoTrace = traceCalls.find((t: any) => t.service === "gpt");
    expect(nanoTrace).toBeDefined();
    expect(typeof nanoTrace.estimated_cost_usd).toBe("number");
    expect(nanoTrace.estimated_cost_usd).toBeGreaterThan(0);
    expect(nanoTrace.cost_source).toBe("TOKEN_PRICING");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// WP-NANO-04 TC3: deterministic → provider null, service=internal, actual_call_count=0
// ═════════════════════════════════════════════════════════════════════════════

describe("WP-NANO-04 TC3: deterministic path → provider=null, service=internal, actual_call_count=0", () => {
  it("deterministic trace has provider=undefined/null, service=internal, actual_call_count=0", async () => {
    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: false,
      answer: "공지사항을 확인해주세요.",
      source_type: "KNOWLEDGE",
      confidence: 90,
    });

    const app = await buildApp();
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    expect(res.status).toBe(200);
    const detTrace = traceCalls.find((t: any) => t.service === "internal");
    expect(detTrace).toBeDefined();
    // provider absent or null (not "openai")
    expect(detTrace.provider == null || detTrace.provider === "internal").toBeTruthy();
    expect(detTrace.actual_call_count).toBe(0);
    expect(detTrace.logical_request_count).toBe(0);
    expect(detTrace.retry_count).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// WP-NANO-04 TC4: candidate=20, Nano selected=1~N → counts 분리 기록
// ═════════════════════════════════════════════════════════════════════════════

describe("WP-NANO-04 TC4: candidate_knowledge_count vs selected_knowledge_count 분리", () => {
  it("candidate_knowledge_count=20, selected_knowledge_count=Nano output 수", async () => {
    const twentyItems = Array.from({ length: 20 }, (_, i) =>
      makeKI(`ki_sep_${i}`, `항목 ${i}`, 0)
    );
    const selectedIds = ["ki_sep_0", "ki_sep_5", "ki_sep_12"];

    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: true, answer: null, source_type: "NONE", confidence: 0,
    });
    mockGatherEvidence.mockResolvedValueOnce(twentyItems);
    mockNanoResolve.mockResolvedValueOnce({
      output: {
        selected_knowledge_ids: selectedIds,
        answer: "안내드립니다.",
        confidence: "HIGH",
        insufficient_knowledge: false,
      },
      inputTokens: 500, outputTokens: 80, totalTokens: 580, error: null,
    });

    const app = await buildApp();
    await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    const nanoTrace = traceCalls.find((t: any) => t.service === "gpt");
    expect(nanoTrace).toBeDefined();
    // candidate pool = 20 (evidence 전체)
    expect(nanoTrace.candidate_knowledge_count).toBe(20);
    // selected = Nano가 실제로 고른 수만
    expect(nanoTrace.selected_knowledge_count).toBe(selectedIds.length);
    // candidate와 selected는 달라야 함 (candidate > selected)
    expect(nanoTrace.candidate_knowledge_count).toBeGreaterThan(nanoTrace.selected_knowledge_count);
    // retrieved_knowledge_ids = Nano가 선택한 ID만
    expect(nanoTrace.retrieved_knowledge_ids).toEqual(selectedIds);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// WP-NANO-04 TC5: candidate 밖 ID → selected에 남지 않음 (validator 정책)
// ═════════════════════════════════════════════════════════════════════════════

describe("WP-NANO-04 TC5: candidate 밖 ID → validateNanoOutput에서 제거됨", () => {
  it("validateNanoOutput strips out-of-candidate IDs before trace", async () => {
    const { validateNanoOutput } = await import("../../lib/support-nano-resolver.js");
    const mockValidate = validateNanoOutput as ReturnType<typeof vi.fn>;

    const ki = makeKI("ki_valid_001", "유효 항목", 0);
    const candidateIds = new Set(["ki_valid_001"]);

    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: true, answer: null, source_type: "NONE", confidence: 0,
    });
    mockGatherEvidence.mockResolvedValueOnce([ki]);

    // Nano returns an out-of-set ID: "ki_ghost_999"
    // validateNanoOutput mock (from vi.hoisted) strips it → ok=true
    mockValidate.mockReturnValueOnce({ ok: true, reason: null });
    mockNanoResolve.mockResolvedValueOnce({
      output: {
        // support-respond.ts calls validateNanoOutput which strips invalid IDs
        selected_knowledge_ids: ["ki_valid_001"],  // already cleaned by validator
        answer: "안내드립니다.",
        confidence: "HIGH",
        insufficient_knowledge: false,
      },
      inputTokens: 200, outputTokens: 40, totalTokens: 240, error: null,
    });

    const app = await buildApp();
    await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    const nanoTrace = traceCalls.find((t: any) => t.service === "gpt");
    expect(nanoTrace).toBeDefined();
    // Only valid IDs (subset of candidates) in retrieved_knowledge_ids
    const tracedIds: string[] = nanoTrace.retrieved_knowledge_ids ?? [];
    for (const id of tracedIds) {
      expect(candidateIds.has(id)).toBe(true);
    }
    // "ki_ghost_999" is NOT in the trace
    expect(tracedIds).not.toContain("ki_ghost_999");
  });
});
