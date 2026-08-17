/**
 * CS-08H — Support AI Engine Resolver Harden Tests
 *
 * Response contract + saveAiTrace telemetry consistency.
 *
 * CS08H-06  frontend map exact → response llm_used=false, OpenAI=0
 * CS08H-07  no evidence → OpenAI call count=0
 * CS08H-08  no evidence → response llm_used=false
 * CS08H-09  no evidence → response model=null / trace model=null
 * CS08H-10  deterministic → llm_used=false
 * CS08H-11  grounded actual call → llm_used=true
 * CS08H-12  grounded → tokens only when actual call (evidence>0)
 * CS08H-13  generation_mode: deterministic / no_evidence / llm_grounded consistency
 * CS08H-14  saveAiTrace no_evidence: model=null, generation_mode=no_evidence
 * CS08H-15  partner analytics: no_evidence llm_used=false (call-count semantics)
 * CS08H-18  Support Inbox no regression (existing 28 TCs still pass via cs-08r)
 * CS08H-19  support/respond route no regression — all status codes intact
 * CS08H-20  full llm_used contract across all 3 generation modes
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── vi.hoisted ─────────────────────────────────────────────────────────────────

const mockCreate              = vi.hoisted(() => vi.fn());
const traceCalls              = vi.hoisted(() => [] as any[]);
const mockRunResolutionChain  = vi.hoisted(() => vi.fn());
const mockGatherEvidence      = vi.hoisted(() => vi.fn());

// ── In-memory stores ───────────────────────────────────────────────────────────

let caseStore:    any[] = [];
let repliesStore: any[] = [];
let eventLogs:    any[] = [];

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
    return { rows: [] };
  };

  return {
    superAdminDb: { execute: vi.fn((q: any) => Promise.resolve(executeQuery(q))) },
    db:           { execute: vi.fn((q: any) => Promise.resolve(executeQuery(q))) },
  };
});

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
}));

vi.mock("../../lib/support-case-service.js", () => ({
  transitionSupportCase: vi.fn().mockResolvedValue({ ok: true }),
  logSupportEvent:       vi.fn().mockResolvedValue(undefined),
  VALID_TRANSITIONS: {},
}));

// ── Router ─────────────────────────────────────────────────────────────────────

import supportRespondRouter from "../support-respond.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(supportRespondRouter);
  return app;
}

// ── Seed helpers ───────────────────────────────────────────────────────────────

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

const FM_RESOLVED = {
  resolution_status: "RESOLVED",
  source_type:       "FRONTEND_MAP",
  source_id:         "ADMIN_ATTENDANCE",
  confidence:        85,
  title:             "출결",
  answer:            "출결 화면으로 이동하세요.",
  requires_human:    false,
  llm_required:      false,
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

function makeEvidence(n = 1, type = "FAQ") {
  return Array.from({ length: n }, (_, i) => ({
    id:        type === "FRONTEND_MAP" ? `fm_SCREEN_${i}` : `ki_${i + 1}`,
    item_type: type,
    title:     `항목 ${i + 1}`,
    answer:    `답변 ${i + 1}`,
    score:     70,
  }));
}

function openAiResponse(confidence: "HIGH" | "MEDIUM" | "LOW", answer = "AI 답변") {
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
    usage: { prompt_tokens: 120, completion_tokens: 60, total_tokens: 180 },
  };
}

// ── beforeEach ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  caseStore.length    = 0;
  repliesStore.length = 0;
  eventLogs.length    = 0;
  traceCalls.length   = 0;

  mockCreate.mockReset();
  mockRunResolutionChain.mockReset();
  mockGatherEvidence.mockReset();
  mockGatherEvidence.mockResolvedValue([]);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("CS-08H — Response Contract + Telemetry Harden", () => {

  // CS08H-06: FRONTEND_MAP exact hit → OpenAI NOT called, llm_used=false
  it("CS08H-06 FRONTEND_MAP deterministic → response llm_used=false, OpenAI=0", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(FM_RESOLVED);

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc.id, message: "출결 기록 어디서 하나요?" });

    expect(res.status).toBe(200);
    expect(res.body.llm_used).toBe(false);
    expect(res.body.llm_called).toBe(false);
    expect(res.body.source).toBe("FRONTEND_MAP");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // CS08H-07: no evidence → OpenAI NOT called
  it("CS08H-07 no evidence → OpenAI call count=0", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(NO_MATCH);
    mockGatherEvidence.mockResolvedValueOnce([]); // explicitly empty

    await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc.id, message: "스마트폰 구매 방법은?" });

    expect(mockCreate).not.toHaveBeenCalled();
  });

  // CS08H-08: no evidence → response llm_used=false (FIXED — was true before)
  it("CS08H-08 no evidence → response llm_used=false", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(NO_MATCH);
    mockGatherEvidence.mockResolvedValueOnce([]);

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc.id, message: "완전히 다른 주제 질문" });

    expect(res.status).toBe(200);
    expect(res.body.llm_used).toBe(false);
    expect(res.body.llm_called).toBe(false);
  });

  // CS08H-09: no evidence → trace model=null (FIXED — was LLM_MODEL before)
  it("CS08H-09 no evidence → saveAiTrace model=null", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(NO_MATCH);
    mockGatherEvidence.mockResolvedValueOnce([]);

    await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc.id, message: "전혀 관계없는 질문" });

    const noEvidenceTrace = traceCalls.find((t) => t.generation_mode === "no_evidence");
    expect(noEvidenceTrace).toBeDefined();
    expect(noEvidenceTrace.model).toBeNull();
  });

  // CS08H-10: deterministic → llm_used=false
  it("CS08H-10 deterministic (RULE) → llm_used=false", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(DET_RESOLVED);

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc.id, message: "규칙 질문" });

    expect(res.body.llm_used).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // CS08H-11: grounded actual call → llm_used=true
  it("CS08H-11 grounded (evidence>0, OpenAI called) → llm_used=true", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(NO_MATCH);
    mockGatherEvidence.mockResolvedValueOnce(makeEvidence(2, "FRONTEND_MAP"));
    mockCreate.mockResolvedValueOnce(openAiResponse("HIGH"));

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc.id, message: "출결 기록이 가끔 저장 안 돼요" });

    expect(res.status).toBe(200);
    expect(res.body.llm_used).toBe(true);
    expect(res.body.llm_called).toBe(true);
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  // CS08H-12: tokens only stored when actual LLM call happened
  it("CS08H-12 tokens in trace only when evidence>0 (actual call)", async () => {
    // Case A: no evidence → tokens should be null
    const sc1 = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(NO_MATCH);
    mockGatherEvidence.mockResolvedValueOnce([]);

    await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc1.id, message: "관계없는 주제 A" });

    const noEvidenceTrace = traceCalls.find((t) => t.generation_mode === "no_evidence");
    expect(noEvidenceTrace?.input_tokens).toBeNull();
    expect(noEvidenceTrace?.output_tokens).toBeNull();
    expect(noEvidenceTrace?.total_tokens).toBeNull();

    // Case B: with evidence → tokens from OpenAI
    const sc2 = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(NO_MATCH);
    mockGatherEvidence.mockResolvedValueOnce(makeEvidence(1));
    mockCreate.mockResolvedValueOnce(openAiResponse("HIGH"));

    await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc2.id, message: "관계없는 주제 B" });

    const groundedTrace = traceCalls.find((t) => t.generation_mode === "llm_grounded");
    expect(groundedTrace?.input_tokens).toBe(120);
    expect(groundedTrace?.output_tokens).toBe(60);
    expect(groundedTrace?.total_tokens).toBe(180);
  });

  // CS08H-13: generation_mode consistency across 3 paths
  it("CS08H-13 generation_mode: deterministic / no_evidence / llm_grounded all distinct", async () => {
    // Path 1: deterministic
    const sc1 = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(DET_RESOLVED);
    await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc1.id, message: "결정론 경로" });

    expect(traceCalls.find((t) => t.generation_mode === "deterministic")).toBeDefined();

    // Path 2: no_evidence
    const sc2 = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(NO_MATCH);
    mockGatherEvidence.mockResolvedValueOnce([]);
    await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc2.id, message: "증거 없음 경로" });

    expect(traceCalls.find((t) => t.generation_mode === "no_evidence")).toBeDefined();

    // Path 3: llm_grounded
    const sc3 = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(NO_MATCH);
    mockGatherEvidence.mockResolvedValueOnce(makeEvidence(1));
    mockCreate.mockResolvedValueOnce(openAiResponse("MEDIUM"));
    await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc3.id, message: "LLM 근거 경로" });

    expect(traceCalls.find((t) => t.generation_mode === "llm_grounded")).toBeDefined();
  });

  // CS08H-14: saveAiTrace no_evidence fields correct
  it("CS08H-14 saveAiTrace no_evidence: model=null, generation_mode=no_evidence, status=SUCCESS", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(NO_MATCH);
    mockGatherEvidence.mockResolvedValueOnce([]);

    await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc.id, message: "근거 없는 질문" });

    const trace = traceCalls.find((t) => t.generation_mode === "no_evidence");
    expect(trace).toBeDefined();
    expect(trace.model).toBeNull();
    expect(trace.status).toBe("SUCCESS");
    expect(trace.result_generated).toBe(false);
    expect(trace.feature).toBe("support_ai");
    expect(trace.sub_feature).toBe("SUPPORT_RESPONSE");
  });

  // CS08H-15: partner analytics — no_evidence llm_used=false (call-count semantics)
  it("CS08H-15 partner analytics: no_evidence → llm_used=false in response (call-count semantics)", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(NO_MATCH);
    mockGatherEvidence.mockResolvedValueOnce([]);

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc.id, message: "비용 집계 확인용 쿼리" });

    // llm_used drives partner cost analytics — must be false when no actual API call
    expect(res.body.llm_used).toBe(false);
    expect(res.body.llm_called).toBe(false);
    expect(res.body.confidence).toBe("LOW");
    expect(res.body.requires_human).toBe(true);
  });

  // CS08H-19: basic route regression — 400/401/404 still work
  it("CS08H-19 route regression — 400/401/404 intact", async () => {
    // 401 no auth
    const r401 = await request(buildApp())
      .post("/support/respond")
      .send({ case_id: "x", message: "y" });
    expect(r401.status).toBe(401);

    // 400 missing case_id
    const r400 = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ message: "no case_id" });
    expect(r400.status).toBe(400);

    // 404 nonexistent case
    const r404 = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: "nonexistent_xyz", message: "테스트" });
    expect(r404.status).toBe(404);
  });

  // CS08H-20: full llm_used contract across all 3 generation modes
  it("CS08H-20 full llm_used contract: deterministic=false, no_evidence=false, grounded=true", async () => {
    // Deterministic
    const sc1 = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(DET_RESOLVED);
    const r1 = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc1.id, message: "결정론" });
    expect(r1.body.llm_used).toBe(false);

    // No evidence
    const sc2 = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(NO_MATCH);
    mockGatherEvidence.mockResolvedValueOnce([]);
    const r2 = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc2.id, message: "증거없음" });
    expect(r2.body.llm_used).toBe(false);

    // LLM grounded
    const sc3 = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(NO_MATCH);
    mockGatherEvidence.mockResolvedValueOnce(makeEvidence(1));
    mockCreate.mockResolvedValueOnce(openAiResponse("HIGH"));
    const r3 = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(DEFAULT_USER))
      .send({ case_id: sc3.id, message: "LLM경로" });
    expect(r3.body.llm_used).toBe(true);

    // All 3 in sequence — no cross-contamination
    expect([r1.body.llm_used, r2.body.llm_used, r3.body.llm_used]).toEqual([false, false, true]);
  });
});
