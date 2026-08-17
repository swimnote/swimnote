/**
 * obs-support-trace.test.ts — P0-OBSERVABILITY trace instrumentation tests
 *
 * OBS-01: trace contains request_id/case_id
 * OBS-02: raw user message absent from trace stages
 * OBS-03: raw AI answer absent from trace stages
 * OBS-04: successful deterministic stage sequence
 * OBS-05: no_evidence stage sequence (LLM_SKIPPED)
 * OBS-06: LLM stage sequence (LLM_START/DONE)
 * OBS-07: AI insert DB failure records actual pg error code
 * OBS-08: AI insert failure produces HTTP 500
 * OBS-09: HTTP_RESPONSE stage records actual status
 * OBS-10: telemetry failure does not break support response
 * OBS-11: cross-pool data absent from trace
 * OBS-12: full regression (existing CS-08R behaviour)
 *
 * ─── NOTE — Mock vs Production gap ──────────────────────────────────────────
 * All tests use vi.mock("@workspace/db") — an in-memory store.
 * pg NOT_NULL, FK, ENUM, and schema constraints are NOT enforced here.
 * Production evidence requires real Postgres observed via event_logs query
 * after user reproduction on device.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── vi.hoisted ─────────────────────────────────────────────────────────────────

const mockRunResolutionChain = vi.hoisted(() => vi.fn());
const mockGatherEvidence     = vi.hoisted(() => vi.fn());
const mockCreate             = vi.hoisted(() => vi.fn());
const traceCalls             = vi.hoisted(() => [] as any[]);   // saveAiTrace calls
const flushCalls             = vi.hoisted(() => [] as any[]);   // flushSupportTrace calls
const insertFailCalls        = vi.hoisted(() => [] as any[]);   // flushInsertFailStage calls

// ── In-memory stores ──────────────────────────────────────────────────────────

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
  // Simulate an injectable DB error for AI INSERT
  let _aiInsertShouldFail: (() => Error) | null = null;
  const setAiInsertFail  = (fn: (() => Error) | null) => { _aiInsertShouldFail = fn; };
  const clearAiInsertFail= () => { _aiInsertShouldFail = null; };

  const executeQuery = (q: any): any => {
    const text: string = (q.__text ?? q ?? "").replace(/\s+/g, " ");
    const params: any[] = q.__values ?? [];

    if (text.includes("INSERT INTO event_logs")) {
      const metaRaw = params.find(
        (p: any) => typeof p === "string" && p.includes("SUPPORT")
      ) ?? params[4] ?? null;
      eventLogs.push({ text, params, meta: metaRaw });
      return { rows: [] };
    }
    if (text.includes("FROM support_cases")) {
      const id = params[0];
      const found = caseStore.find((c: any) => c.id === id);
      return { rows: found ? [found] : [] };
    }
    if (text.includes("UPDATE support_cases") && text.includes("turn_count")) {
      return { rows: [] };
    }
    if (text.includes("UPDATE support_cases") && text.includes("state")) {
      return { rows: [] };
    }
    if (text.includes("INSERT INTO support_ticket_replies")) {
      const role = params[5];
      if (role === "ai" && _aiInsertShouldFail) {
        throw _aiInsertShouldFail();
      }
      const reply: any = {
        id: params[0], ticket_id: params[1], case_id: params[2],
        author_user_id: params[3], author_name: params[4],
        author_role: params[5], message_type: params[6], content: params[7],
      };
      repliesStore.push(reply);
      return { rows: [{ id: reply.id }] };
    }
    // ALTER TABLE, CREATE INDEX, etc.
    return { rows: [] };
  };

  const db = { execute: vi.fn((q: any) => Promise.resolve(executeQuery(q))) };
  const superAdminDb = { execute: vi.fn((q: any) => Promise.resolve(executeQuery(q))) };

  // Expose helpers through the module for test setup
  (db as any).__setAiInsertFail   = setAiInsertFail;
  (db as any).__clearAiInsertFail = clearAiInsertFail;
  (superAdminDb as any).__setAiInsertFail   = setAiInsertFail;
  (superAdminDb as any).__clearAiInsertFail = clearAiInsertFail;

  return { db, superAdminDb };
});

vi.mock("../../lib/support-case-service.js", () => ({
  transitionSupportCase: vi.fn().mockResolvedValue({ ok: true }),
  logSupportEvent:       vi.fn().mockResolvedValue(undefined),
  ensureCs01rSchema:     vi.fn().mockResolvedValue(undefined),
  SUPPORT_EVENT_TYPE: {
    AI_RESPONDED:    "AI_RESPONDED",
    HUMAN_REQUESTED: "HUMAN_REQUESTED",
    CASE_OPENED:     "CASE_OPENED",
  },
}));

vi.mock("../../lib/support-resolver.js", () => ({
  runResolutionChain: mockRunResolutionChain,
  gatherEvidence:     mockGatherEvidence,
  tokenize:           vi.fn((s: string) => s.split(/\s+/)),
}));

vi.mock("../../lib/ai-trace-service.js", () => ({
  saveAiTrace: vi.fn().mockImplementation(async (t: any) => { traceCalls.push(t); }),
}));

vi.mock("../../lib/ai-feature-enum.js", () => ({
  AI_FEATURE:         { SUPPORT_AI: "SUPPORT_AI" },
  SUPPORT_EVENT_TYPE: {
    AI_RESPONDED:    "AI_RESPONDED",
    HUMAN_REQUESTED: "HUMAN_REQUESTED",
    CASE_OPENED:     "CASE_OPENED",
  },
}));

vi.mock("../ai.js", () => ({
  getOpenAI: () => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  }),
}));

// Partially mock support-trace: real createSupportTrace/addStage/classifyPgError,
// but intercept flush calls so we can inspect what would be written.
vi.mock("../../lib/support-trace.js", async (importOriginal) => {
  const real = await importOriginal() as any;
  return {
    ...real,
    flushSupportTrace: vi.fn().mockImplementation(async (ctx: any, params: any) => {
      flushCalls.push({ ctx: JSON.parse(JSON.stringify(ctx)), params });
    }),
    flushInsertFailStage: vi.fn().mockImplementation(
      async (ctx: any, err: any, which: string) => {
        insertFailCalls.push({ ctx: JSON.parse(JSON.stringify(ctx)), err, which });
      }
    ),
  };
});

// ── Standard test user + case ─────────────────────────────────────────────────

const TEST_USER = {
  userId: "user_001",
  role:   "parent",
  poolId: "pool_aaa",
  name:   "TestUser",
};

const X_TEST_USER = JSON.stringify(TEST_USER);

const BASE_BODY = {
  case_id:    "sc_obs_001",
  message:    "x모드 알려줘",
  mode:       "x",
  request_id: "req_obs_001",
};

function defCase(overrides: Partial<any> = {}) {
  return {
    id:                "sc_obs_001",
    state:             "NEW",
    pool_id:           "pool_aaa",
    ticket_id:         null,
    actor_id:          "user_001",
    escalation_reason: null,
    ...overrides,
  };
}

// ── App factory ───────────────────────────────────────────────────────────────

async function makeApp() {
  const { default: router } = await import("../support-respond.js");
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

// ── LLM mock helpers ──────────────────────────────────────────────────────────

function mockLlmResponse(confidence: "HIGH" | "MEDIUM" | "LOW") {
  mockCreate.mockResolvedValueOnce({
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    choices: [{
      message: {
        content: JSON.stringify({
          confidence,
          answer:         "AI generated answer",
          requires_human: confidence === "LOW",
        }),
      },
    }],
  });
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(async () => {
  caseStore    = [defCase()];
  repliesStore = [];
  eventLogs    = [];
  flushCalls.length      = 0;
  insertFailCalls.length = 0;
  traceCalls.length      = 0;
  vi.clearAllMocks();

  // Clear AI insert failure injection
  const { db } = await import("@workspace/db");
  (db as any).__clearAiInsertFail?.();
});

// ═════════════════════════════════════════════════════════════════════════════
// OBS-01  trace contains request_id / case_id
// ═════════════════════════════════════════════════════════════════════════════

describe("OBS-01: trace contains request_id / case_id", () => {
  it("flushSupportTrace ctx has matching request_id and case_id", async () => {
    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: false, answer: "답변", source_type: "RULE", confidence: "HIGH", requires_human: false,
    });

    const app = await makeApp();
    await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    expect(flushCalls.length).toBeGreaterThan(0);
    const flushed = flushCalls[0];
    expect(flushed.ctx.request_id).toBe("req_obs_001");
    expect(flushed.ctx.case_id).toBe("sc_obs_001");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// OBS-02  raw user message absent from trace stages
// ═════════════════════════════════════════════════════════════════════════════

describe("OBS-02: raw user message absent from trace stages", () => {
  it("the user's literal message text is NOT present in any stage entry", async () => {
    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: false, answer: "답변", source_type: "RULE", confidence: "HIGH", requires_human: false,
    });

    const app = await makeApp();
    const SECRET = "ULTRA_SECRET_MSG_DO_NOT_LOG_XYZ";
    await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send({ ...BASE_BODY, message: SECRET });

    const flushed = flushCalls[0];
    expect(flushed).toBeDefined();
    const serialized = JSON.stringify(flushed.ctx.stages);
    expect(serialized).not.toContain(SECRET);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// OBS-03  raw AI answer absent from trace stages
// ═════════════════════════════════════════════════════════════════════════════

describe("OBS-03: raw AI answer absent from trace stages", () => {
  it("the AI answer text is NOT present in any stage entry (deterministic)", async () => {
    const SECRET_ANSWER = "SECRET_AI_ANSWER_CONTENT_NEVER_LOG_ABC";
    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: false,
      answer:       SECRET_ANSWER,
      source_type:  "RULE",
      confidence:   "HIGH",
      requires_human: false,
    });

    const app = await makeApp();
    await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    const flushed = flushCalls[0];
    const serialized = JSON.stringify(flushed.ctx.stages);
    expect(serialized).not.toContain(SECRET_ANSWER);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// OBS-04  deterministic stage sequence
// ═════════════════════════════════════════════════════════════════════════════

describe("OBS-04: successful deterministic stage sequence", () => {
  it("stages: REQUEST_RECEIVED → USER_INSERT_OK → RESOLUTION_DONE → AI_INSERT_OK → FINAL_OK → HTTP_RESPONSE", async () => {
    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: false, answer: "답변", source_type: "RULE", confidence: "HIGH", requires_human: false,
    });

    const app = await makeApp();
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    expect(res.status).toBe(200);

    const stages = flushCalls[0].ctx.stages.map((s: any) => s.s) as string[];
    const idx    = (name: string) => stages.indexOf(name);

    expect(idx("REQUEST_RECEIVED")).toBeGreaterThanOrEqual(0);
    expect(idx("USER_MESSAGE_INSERT_START")).toBeGreaterThan(idx("REQUEST_RECEIVED"));
    expect(idx("USER_MESSAGE_INSERT_OK")).toBeGreaterThan(idx("USER_MESSAGE_INSERT_START"));
    expect(idx("RESOLUTION_START")).toBeGreaterThan(idx("USER_MESSAGE_INSERT_OK"));
    expect(idx("RESOLUTION_DONE")).toBeGreaterThan(idx("RESOLUTION_START"));
    expect(idx("AI_MESSAGE_INSERT_START")).toBeGreaterThan(idx("RESOLUTION_DONE"));
    expect(idx("AI_MESSAGE_INSERT_OK")).toBeGreaterThan(idx("AI_MESSAGE_INSERT_START"));
    expect(idx("FINAL_STATE_OK")).toBeGreaterThan(idx("AI_MESSAGE_INSERT_OK"));
    expect(idx("HTTP_RESPONSE")).toBeGreaterThan(idx("FINAL_STATE_OK"));
  });

  it("USER_MESSAGE_INSERT_START contract: author_role=user, content_present=true, user_id_not_null", async () => {
    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: false, answer: "답변", source_type: "RULE", confidence: "HIGH", requires_human: false,
    });

    const app = await makeApp();
    await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    const stages = flushCalls[0].ctx.stages;
    const insertStart = stages.find((s: any) => s.s === "USER_MESSAGE_INSERT_START");
    expect(insertStart).toBeDefined();
    expect(insertStart.contract.author_role).toBe("user");
    expect(insertStart.contract.content_present).toBe(true);
    expect(insertStart.contract.author_user_id_is_null).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// OBS-05  no_evidence stage sequence (LLM_SKIPPED)
// ═════════════════════════════════════════════════════════════════════════════

describe("OBS-05: no_evidence stage sequence", () => {
  it("stages contain EVIDENCE_START → EVIDENCE_DONE → LLM_SKIPPED (no LLM_START)", async () => {
    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: true, answer: null, source_type: "NO_MATCH", confidence: null, requires_human: true,
    });
    mockGatherEvidence.mockResolvedValueOnce([]);

    const app = await makeApp();
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    expect(res.status).toBe(200);
    expect(res.body.requires_human).toBe(true);

    const stages = flushCalls[0].ctx.stages.map((s: any) => s.s) as string[];
    expect(stages).toContain("EVIDENCE_START");
    expect(stages).toContain("EVIDENCE_DONE");
    expect(stages).toContain("LLM_SKIPPED");
    expect(stages).not.toContain("LLM_START");
    expect(stages).not.toContain("LLM_DONE");

    const skipped = flushCalls[0].ctx.stages.find((s: any) => s.s === "LLM_SKIPPED");
    expect(skipped?.reason).toBe("NO_EVIDENCE");
  });

  it("AI_MESSAGE_INSERT_START contract: author_user_id_is_null=true (AI has no userId)", async () => {
    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: true, answer: null, source_type: "NO_MATCH", confidence: null, requires_human: true,
    });
    mockGatherEvidence.mockResolvedValueOnce([]);

    const app = await makeApp();
    await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    const stages = flushCalls[0].ctx.stages;
    const aiInsert = stages.find((s: any) => s.s === "AI_MESSAGE_INSERT_START");
    expect(aiInsert).toBeDefined();
    expect(aiInsert.contract.author_role).toBe("ai");
    expect(aiInsert.contract.author_user_id_is_null).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// OBS-06  LLM stage sequence
// ═════════════════════════════════════════════════════════════════════════════

describe("OBS-06: LLM stage sequence", () => {
  it("stages: EVIDENCE_START → EVIDENCE_DONE → LLM_START → LLM_DONE → AI_INSERT_OK → HTTP_RESPONSE", async () => {
    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: true, answer: null, source_type: "NO_MATCH", confidence: null, requires_human: false,
    });
    mockGatherEvidence.mockResolvedValueOnce([
      { item_type: "FAQ", title: "X모드란", answer: "설명" },
    ]);
    mockLlmResponse("HIGH");

    const app = await makeApp();
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    expect(res.status).toBe(200);
    expect(res.body.llm_used).toBe(true);

    const stages = flushCalls[0].ctx.stages.map((s: any) => s.s) as string[];
    const idx    = (name: string) => stages.indexOf(name);

    expect(idx("EVIDENCE_START")).toBeGreaterThanOrEqual(0);
    expect(idx("EVIDENCE_DONE")).toBeGreaterThan(idx("EVIDENCE_START"));
    expect(idx("LLM_START")).toBeGreaterThan(idx("EVIDENCE_DONE"));
    expect(idx("LLM_DONE")).toBeGreaterThan(idx("LLM_START"));
    expect(idx("AI_MESSAGE_INSERT_OK")).toBeGreaterThan(idx("LLM_DONE"));
    expect(idx("HTTP_RESPONSE")).toBeGreaterThan(idx("AI_MESSAGE_INSERT_OK"));
    expect(stages).not.toContain("LLM_SKIPPED");

    const llmStart = flushCalls[0].ctx.stages.find((s: any) => s.s === "LLM_START");
    expect(llmStart?.model).toBe("gpt-4o-mini");
    expect(llmStart?.evidence_count).toBe(1);
  });

  it("LLM_FAIL stage recorded on timeout, response still 200", async () => {
    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: true, answer: null, source_type: "NO_MATCH", confidence: null, requires_human: false,
    });
    mockGatherEvidence.mockResolvedValueOnce([
      { item_type: "FAQ", title: "X모드란", answer: "설명" },
    ]);
    // Simulate timeout
    mockCreate.mockRejectedValueOnce(Object.assign(new Error("Request aborted"), { name: "AbortError" }));

    const app = await makeApp();
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    expect(res.status).toBe(200);
    const stages = flushCalls[0].ctx.stages.map((s: any) => s.s) as string[];
    expect(stages).toContain("LLM_FAIL");
    const fail = flushCalls[0].ctx.stages.find((s: any) => s.s === "LLM_FAIL");
    expect(fail?.error_code).toBe("TIMEOUT");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// OBS-07  AI insert DB failure records actual pg error code
// ═════════════════════════════════════════════════════════════════════════════

describe("OBS-07: AI insert DB failure records actual pg error code", () => {
  it("AI_MESSAGE_INSERT_FAIL stage captures actual pg_code, constraint, column", async () => {
    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: false, answer: "답변", source_type: "RULE", confidence: "HIGH", requires_human: false,
    });

    const { db } = await import("@workspace/db");
    (db as any).__setAiInsertFail(() => {
      const err = new Error("null value in column violates not-null constraint");
      Object.assign(err, {
        code:       "23502",
        constraint: "support_ticket_replies_author_user_id_not_null",
        column:     "author_user_id",
        table:      "support_ticket_replies",
      });
      return err;
    });

    const app = await makeApp();
    await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    // flushInsertFailStage called
    expect(insertFailCalls.length).toBeGreaterThan(0);

    // AI_MESSAGE_INSERT_FAIL in stages
    const allStages = flushCalls.flatMap((f: any) => f.ctx.stages ?? []);
    const failStage = allStages.find((s: any) => s.s === "AI_MESSAGE_INSERT_FAIL");
    expect(failStage).toBeDefined();
    expect(failStage.pg_code).toBe("23502");
    expect(failStage.error_category).toBe("NOT_NULL");
    expect(failStage.column).toBe("author_user_id");
    expect(failStage.constraint).toContain("author_user_id");
  });

  it("classifyPgError: 23502 → NOT_NULL, 23503 → FK, 42P01 → MISSING_TABLE, OTHER", async () => {
    const { classifyPgError } = await import("../../lib/support-trace.js");
    expect(classifyPgError({ code: "23502" })).toBe("NOT_NULL");
    expect(classifyPgError({ code: "23503" })).toBe("FK");
    expect(classifyPgError({ code: "42P01" })).toBe("MISSING_TABLE");
    expect(classifyPgError({ code: "99999" })).toBe("OTHER");
    expect(classifyPgError({})).toBe("OTHER");
    expect(classifyPgError(null)).toBe("OTHER");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// OBS-08  AI insert failure produces HTTP non-2xx
// ═════════════════════════════════════════════════════════════════════════════

describe("OBS-08: AI insert failure produces HTTP 500", () => {
  it("deterministic path AI INSERT failure → 500 with AI_MSG_INSERT_FAILED code", async () => {
    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: false, answer: "답변", source_type: "RULE", confidence: "HIGH", requires_human: false,
    });

    const { db } = await import("@workspace/db");
    (db as any).__setAiInsertFail(() =>
      Object.assign(new Error("constraint violation"), { code: "23502" })
    );

    const app = await makeApp();
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    expect(res.status).toBe(500);
    expect(res.body.code).toBe("AI_MSG_INSERT_FAILED");
  });

  it("LLM path AI INSERT failure → 500 with AI_MSG_INSERT_FAILED code", async () => {
    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: true, answer: null, source_type: "NO_MATCH", confidence: null, requires_human: false,
    });
    mockGatherEvidence.mockResolvedValueOnce([
      { item_type: "FAQ", title: "X모드", answer: "설명" },
    ]);
    mockLlmResponse("HIGH");

    const { db } = await import("@workspace/db");
    (db as any).__setAiInsertFail(() =>
      Object.assign(new Error("constraint violation"), { code: "23502" })
    );

    const app = await makeApp();
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    expect(res.status).toBe(500);
    expect(res.body.code).toBe("AI_MSG_INSERT_FAILED");
  });

  it("user INSERT failure → 500 (not 200)", async () => {
    // The mock db throws on the first INSERT (user message)
    const { db } = await import("@workspace/db");
    const orig = (db as any).execute;
    let insertCount = 0;
    (db as any).execute = vi.fn().mockImplementation((q: any) => {
      const text = (q.__text ?? "").replace(/\s+/g, " ");
      if (text.includes("INSERT INTO support_ticket_replies")) {
        insertCount++;
        if (insertCount === 1) {
          throw Object.assign(new Error("user insert fail"), { code: "23502" });
        }
      }
      return orig(q);
    });

    const app = await makeApp();
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    expect(res.status).toBe(500);
    (db as any).execute = orig; // restore
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// OBS-09  HTTP_RESPONSE stage records actual status
// ═════════════════════════════════════════════════════════════════════════════

describe("OBS-09: HTTP_RESPONSE stage records actual status", () => {
  it("200 on success — flushSupportTrace params.http_status = 200", async () => {
    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: false, answer: "답변", source_type: "RULE", confidence: "HIGH", requires_human: false,
    });

    const app = await makeApp();
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    expect(res.status).toBe(200);
    expect(flushCalls[0].params.http_status).toBe(200);
    expect(flushCalls[0].params.success).toBe(true);
    // HTTP_RESPONSE stage in ctx.stages
    const httpStage = flushCalls[0].ctx.stages.find((s: any) => s.s === "HTTP_RESPONSE");
    expect(httpStage?.http_status).toBe(200);
  });

  it("500 on AI insert failure — flushSupportTrace params.http_status = 500", async () => {
    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: false, answer: "답변", source_type: "RULE", confidence: "HIGH", requires_human: false,
    });
    const { db } = await import("@workspace/db");
    (db as any).__setAiInsertFail(() =>
      Object.assign(new Error("constraint violation"), { code: "23502" })
    );

    const app = await makeApp();
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    expect(res.status).toBe(500);
    const any500 = flushCalls.some((f: any) => f.params.http_status === 500);
    expect(any500).toBe(true);
  });

  it("409 terminal state — flushSupportTrace params.http_status = 409", async () => {
    caseStore = [defCase({ state: "RESOLVED" })];

    const app = await makeApp();
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    expect(res.status).toBe(409);
    expect(flushCalls[0].params.http_status).toBe(409);
    expect(flushCalls[0].params.success).toBe(false);
  });

  it("404 case not found — flushSupportTrace params.http_status = 404", async () => {
    caseStore = []; // no cases

    const app = await makeApp();
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    expect(res.status).toBe(404);
    expect(flushCalls[0].params.http_status).toBe(404);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// OBS-10  telemetry failure does not break support response
// ═════════════════════════════════════════════════════════════════════════════

describe("OBS-10: telemetry failure does not break support response", () => {
  it("flushSupportTrace rejection does not affect 200 response", async () => {
    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: false, answer: "답변", source_type: "RULE", confidence: "HIGH", requires_human: false,
    });

    // Make the mocked flush throw
    const { flushSupportTrace } = await import("../../lib/support-trace.js");
    (flushSupportTrace as any).mockImplementationOnce(() =>
      Promise.reject(new Error("event_logs DB unavailable"))
    );

    const app = await makeApp();
    // Response must still be 200 — flush is void, rejection not awaited in critical path
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    expect(res.status).toBe(200);
  });

  it("saveAiTrace rejection does not affect 200 response", async () => {
    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: false, answer: "답변", source_type: "RULE", confidence: "HIGH", requires_human: false,
    });
    const { saveAiTrace } = await import("../../lib/ai-trace-service.js");
    (saveAiTrace as any).mockRejectedValueOnce(new Error("AI trace DB down"));

    const app = await makeApp();
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    expect(res.status).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// OBS-11  cross-pool data absent from trace
// ═════════════════════════════════════════════════════════════════════════════

describe("OBS-11: cross-pool data absent from trace", () => {
  it("trace ctx.pool_id is the authenticated user's pool, not another pool's id", async () => {
    // Case pool matches user's pool
    caseStore = [defCase({ pool_id: "pool_aaa" })];
    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: false, answer: "답변", source_type: "RULE", confidence: "HIGH", requires_human: false,
    });

    const app = await makeApp();
    await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    const flushed = flushCalls[0];
    expect(flushed.ctx.pool_id).toBe("pool_aaa");
    const stagesStr = JSON.stringify(flushed.ctx.stages);
    expect(stagesStr).not.toContain("pool_bbb");
    expect(stagesStr).not.toContain("pool_zzz");
  });

  it("super_admin with no poolId: trace ctx.pool_id = null, case pool not leaked", async () => {
    // Case belongs to pool_bbb
    caseStore = [defCase({ pool_id: "pool_bbb", actor_id: null })];
    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: false, answer: "답변", source_type: "RULE", confidence: "HIGH", requires_human: false,
    });

    const superUser = JSON.stringify({ userId: "sadmin_001", role: "super_admin", poolId: null, name: "SA" });
    const app = await makeApp();
    await request(app)
      .post("/support/respond")
      .set("x-test-user", superUser)
      .send(BASE_BODY);

    const flushed = flushCalls[0];
    // ctx.pool_id is the requesting user's pool (null for super_admin)
    expect(flushed.ctx.pool_id).toBeNull();
    // pool_bbb (case's pool) must NOT appear in ctx-level fields
    expect(flushed.ctx.pool_id).not.toBe("pool_bbb");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// OBS-12  full regression (existing CS-08R behaviour preserved)
// ═════════════════════════════════════════════════════════════════════════════

describe("OBS-12: full regression", () => {
  it("200 + llm_used=false on deterministic hit", async () => {
    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: false, answer: "X모드는 특별 기능입니다.", source_type: "RULE", confidence: "HIGH", requires_human: false,
    });

    const app = await makeApp();
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.llm_used).toBe(false);
    expect(res.body.answer).toBeTruthy();
    expect(res.body.case_state).toBe("AI_RESPONDED");
  });

  it("200 + llm_used=true on LLM HIGH confidence → AI_RESPONDED", async () => {
    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: true, answer: null, source_type: "NO_MATCH", confidence: null, requires_human: false,
    });
    mockGatherEvidence.mockResolvedValueOnce([
      { item_type: "FAQ", title: "X모드", answer: "설명" },
    ]);
    mockLlmResponse("HIGH");

    const app = await makeApp();
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    expect(res.status).toBe(200);
    expect(res.body.llm_used).toBe(true);
    expect(res.body.case_state).toBe("AI_RESPONDED");
  });

  it("200 + requires_human=true on no_evidence → HUMAN_REQUIRED", async () => {
    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: true, answer: null, source_type: "NO_MATCH", confidence: null, requires_human: true,
    });
    mockGatherEvidence.mockResolvedValueOnce([]);

    const app = await makeApp();
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    expect(res.status).toBe(200);
    expect(res.body.requires_human).toBe(true);
    expect(res.body.case_state).toBe("HUMAN_REQUIRED");
  });

  it("400 missing case_id", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send({ message: "hello" });
    expect(res.status).toBe(400);
  });

  it("400 empty message", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send({ case_id: "sc_obs_001", message: "   " });
    expect(res.status).toBe(400);
  });

  it("401 without auth header", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post("/support/respond")
      .send(BASE_BODY);
    expect(res.status).toBe(401);
  });

  it("409 terminal state (RESOLVED)", async () => {
    caseStore = [defCase({ state: "RESOLVED" })];

    const app = await makeApp();
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);
    expect(res.status).toBe(409);
  });

  it("403 actor mismatch", async () => {
    caseStore = [defCase({ actor_id: "other_user_999" })];

    const app = await makeApp();
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);
    expect(res.status).toBe(403);
  });

  it("404 case not found", async () => {
    caseStore = [];

    const app = await makeApp();
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);
    expect(res.status).toBe(404);
  });

  it("user message stored in repliesStore (role=user)", async () => {
    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: false, answer: "답변", source_type: "RULE", confidence: "HIGH", requires_human: false,
    });

    const app = await makeApp();
    await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    const userMsg = repliesStore.find((r: any) => r.author_role === "user");
    expect(userMsg).toBeDefined();
    expect(userMsg.case_id).toBe("sc_obs_001");
    expect(userMsg.content).toBe("x모드 알려줘");
  });

  it("AI message stored in repliesStore (role=ai)", async () => {
    mockRunResolutionChain.mockResolvedValueOnce({
      llm_required: false, answer: "AI answer text", source_type: "RULE", confidence: "HIGH", requires_human: false,
    });

    const app = await makeApp();
    await request(app)
      .post("/support/respond")
      .set("x-test-user", X_TEST_USER)
      .send(BASE_BODY);

    const aiMsg = repliesStore.find((r: any) => r.author_role === "ai");
    expect(aiMsg).toBeDefined();
    expect(aiMsg.case_id).toBe("sc_obs_001");
    expect(aiMsg.author_user_id).toBeNull();
    expect(aiMsg.content).toBe("AI answer text");
  });
});
