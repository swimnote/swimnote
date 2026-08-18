/**
 * NEVID — No-Evidence LLM Call Contract Tests
 *
 * Confirms that when gatherEvidence() returns [],
 * the support/respond endpoint NEVER invokes the OpenAI provider.
 *
 * Contract (immutable):
 *   evidence = 0  →  llm_used=false, llm_called=false, model=null
 *                     OpenAI invocation = 0
 *   evidence > 0  →  llm_used=true, llm_called=true
 *                     OpenAI invocation = 1
 *   deterministic →  llm_used=false, OpenAI invocation = 0
 *
 * NEVID-01  evidence=0 → OpenAI mock invocation = 0
 * NEVID-02  evidence=0 → response body llm_used = false
 * NEVID-03  evidence=0 → response body llm_called = false
 * NEVID-04  evidence=0 → response body model field absent / null
 * NEVID-05  evidence>0 grounded → provider invocation = 1
 * NEVID-06  deterministic (RULE/FAQ/FM) → provider invocation = 0
 * NEVID-07  saveAiTrace fields equal actual invocation (no phantom calls)
 * NEVID-08  full regression — parent role, normal mode, knowledge=0 active
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── vi.hoisted ──────────────────────────────────────────────────────────────────

const mockCreate             = vi.hoisted(() => vi.fn());
const traceCalls             = vi.hoisted(() => [] as any[]);
const mockRunResolutionChain = vi.hoisted(() => vi.fn());
const mockGatherEvidence     = vi.hoisted(() => vi.fn());

// ── In-memory stores ────────────────────────────────────────────────────────────

let caseStore:    any[] = [];
let repliesStore: any[] = [];

// ── Mocks ───────────────────────────────────────────────────────────────────────

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

    if (text.includes("INSERT INTO event_logs")) return { rows: [] };
    if (text.includes("FROM support_cases")) {
      const id = params[0];
      const found = caseStore.find((c) => c.id === id);
      return { rows: found ? [found] : [] };
    }
    if (text.includes("UPDATE support_cases") && text.includes("turn_count")) return { rows: [] };
    if (text.includes("UPDATE support_cases") && text.includes("state")) {
      const newState = params[0];
      const id       = params.at(-1);
      const sc = caseStore.find((c) => c.id === id);
      if (sc && newState) sc.state = newState;
      return { rows: [] };
    }
    if (text.includes("INSERT INTO support_ticket_replies")) {
      const reply: any = {
        id: params[0], ticket_id: params[1], case_id: params[2],
        author_user_id: params[3], author_name: params[4],
        author_role: params[5], message_type: params[6], content: params[7],
      };
      repliesStore.push(reply);
      return { rows: [{ id: reply.id }] };
    }
    if (text.includes("INSERT INTO ai_traces")) return { rows: [] };
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

// ── Router ──────────────────────────────────────────────────────────────────────

import supportRespondRouter from "../support-respond.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(supportRespondRouter);
  return app;
}

// ── Seed helpers ────────────────────────────────────────────────────────────────

function seedCase(overrides: Partial<any> = {}): any {
  const sc = {
    id:                `sc_nevid_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
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

// actor_id must match seedCase default ("user_01") or be set explicitly
const PARENT_USER = {
  userId: "user_01",          // matches seedCase default actor_id
  role:   "parent_account",
  poolId: "pool_01",
  name:   "Test Parent",
};

const ADMIN_USER = {
  userId: "user_01",          // matches seedCase default actor_id
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

const DET_RESOLVED = {
  resolution_status: "RESOLVED",
  source_type:       "RULE",
  source_id:         "rule_01",
  confidence:        90,
  title:             "규칙 답변",
  answer:            "규칙 기반 답변입니다.",
  requires_human:    false,
  llm_required:      false,
};

const FM_RESOLVED = {
  resolution_status: "RESOLVED",
  source_type:       "FRONTEND_MAP",
  source_id:         "PARENT_HOME",
  confidence:        85,
  title:             "홈 화면",
  answer:            "홈 화면 안내입니다.",
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
          requires_human: confidence === "LOW",
          suggested_next_action: confidence === "LOW" ? "REQUIRES_HUMAN" : null,
        }),
      },
    }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  };
}

// ── beforeEach ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  caseStore.length    = 0;
  repliesStore.length = 0;
  traceCalls.length   = 0;

  mockCreate.mockReset();
  mockRunResolutionChain.mockReset();
  mockGatherEvidence.mockReset();
  mockGatherEvidence.mockResolvedValue([]);
});

// ── NEVID Tests ─────────────────────────────────────────────────────────────────

describe("NEVID — No-Evidence LLM Call Contract", () => {

  // ── NEVID-01 ─────────────────────────────────────────────────────────────────

  it("NEVID-01 evidence=0 → OpenAI provider mock invocation = 0", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(NO_MATCH);
    mockGatherEvidence.mockResolvedValueOnce([]);

    await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(ADMIN_USER))
      .send({ case_id: sc.id, message: "스윔노트X에 대해 알려줘" });

    expect(mockCreate).not.toHaveBeenCalled();
  });

  // ── NEVID-02 ─────────────────────────────────────────────────────────────────

  it("NEVID-02 evidence=0 → response body llm_used = false", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(NO_MATCH);
    mockGatherEvidence.mockResolvedValueOnce([]);

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(ADMIN_USER))
      .send({ case_id: sc.id, message: "스윔노트X에 대해 알려줘" });

    expect(res.status).toBe(200);
    expect(res.body.llm_used).toBe(false);
  });

  // ── NEVID-03 ─────────────────────────────────────────────────────────────────

  it("NEVID-03 evidence=0 → response body llm_called = false", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(NO_MATCH);
    mockGatherEvidence.mockResolvedValueOnce([]);

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(ADMIN_USER))
      .send({ case_id: sc.id, message: "스윔노트X에 대해 알려줘" });

    expect(res.status).toBe(200);
    expect(res.body.llm_called).toBe(false);
  });

  // ── NEVID-04 ─────────────────────────────────────────────────────────────────

  it("NEVID-04 evidence=0 → saveAiTrace model = null (no phantom model)", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(NO_MATCH);
    mockGatherEvidence.mockResolvedValueOnce([]);

    await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(ADMIN_USER))
      .send({ case_id: sc.id, message: "스윔노트X에 대해 알려줘" });

    const trace = traceCalls.find((t) => t.generation_mode === "no_evidence");
    expect(trace).toBeDefined();
    expect(trace.model).toBeNull();
    expect(trace.generation_mode).toBe("no_evidence");
    expect(trace.result_generated).toBe(false);
  });

  // ── NEVID-05 ─────────────────────────────────────────────────────────────────

  it("NEVID-05 evidence>0 grounded → provider invocation = 1", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(NO_MATCH);
    mockGatherEvidence.mockResolvedValueOnce(makeEvidence(2, "FAQ"));
    mockCreate.mockResolvedValueOnce(openAiResponse("HIGH"));

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(ADMIN_USER))
      .send({ case_id: sc.id, message: "출결 기록이 안 돼요" });

    expect(res.status).toBe(200);
    expect(res.body.llm_used).toBe(true);
    expect(res.body.llm_called).toBe(true);
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  // ── NEVID-06 ─────────────────────────────────────────────────────────────────

  it("NEVID-06 deterministic resolution → provider invocation = 0", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(DET_RESOLVED);

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(ADMIN_USER))
      .send({ case_id: sc.id, message: "규칙 기반 질문" });

    expect(res.status).toBe(200);
    expect(res.body.llm_used).toBe(false);
    expect(res.body.llm_called).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // ── NEVID-07 ─────────────────────────────────────────────────────────────────

  it("NEVID-07 saveAiTrace generation_mode exactly mirrors actual call (no phantom)", async () => {
    // Scenario 1: no_evidence → trace generation_mode=no_evidence, model=null
    const sc1 = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(NO_MATCH);
    mockGatherEvidence.mockResolvedValueOnce([]);
    await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(ADMIN_USER))
      .send({ case_id: sc1.id, message: "무관한 질문 A" });

    const traceNoEvidence = traceCalls.find((t) => t.generation_mode === "no_evidence");
    expect(traceNoEvidence).toBeDefined();
    expect(traceNoEvidence.model).toBeNull();
    // OpenAI was NOT called → mockCreate call count = 0
    expect(mockCreate).not.toHaveBeenCalled();

    mockCreate.mockReset();

    // Scenario 2: llm_grounded → trace generation_mode=llm_grounded, model=non-null
    const sc2 = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(NO_MATCH);
    mockGatherEvidence.mockResolvedValueOnce(makeEvidence(1));
    mockCreate.mockResolvedValueOnce(openAiResponse("MEDIUM"));
    await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(ADMIN_USER))
      .send({ case_id: sc2.id, message: "근거 있는 질문 B" });

    const traceGrounded = traceCalls.find((t) => t.generation_mode === "llm_grounded");
    expect(traceGrounded).toBeDefined();
    expect(traceGrounded.model).not.toBeNull();
    // OpenAI WAS called exactly once
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  // ── NEVID-08 ─────────────────────────────────────────────────────────────────
  // Full regression: parent_account role, normal mode, knowledge_active=0
  // Mirrors the actual production request: "스윔노트X에 대해 알려줘"

  it("NEVID-08 full regression — parent_account, normal mode, evidence=0 (knowledge_active=0 scenario)", async () => {
    // actor_id must match PARENT_USER.userId ("user_01") for isolation check
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValueOnce(NO_MATCH); // no active knowledge
    mockGatherEvidence.mockResolvedValueOnce([]);           // 0 active items

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(PARENT_USER))
      .send({
        case_id: sc.id,
        message: "스윔노트X에 대해 알려줘",
        mode:    "normal",
      });

    // HTTP contract
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.llm_used).toBe(false);
    expect(res.body.llm_called).toBe(false);
    expect(res.body.requires_human).toBe(true);

    // OpenAI NOT invoked
    expect(mockCreate).not.toHaveBeenCalled();

    // saveAiTrace: no_evidence path
    const trace = traceCalls.find((t) => t.generation_mode === "no_evidence");
    expect(trace).toBeDefined();
    expect(trace.model).toBeNull();
    expect(trace.result_generated).toBe(false);

    // Case transitions to HUMAN_REQUIRED
    expect(res.body.case_state).toBe("HUMAN_REQUIRED");
  });

});
