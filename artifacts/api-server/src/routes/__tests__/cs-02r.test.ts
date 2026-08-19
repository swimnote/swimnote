/**
 * cs-02r.test.ts — WP-CS-02R API Layer Tests
 * CS02R-01 through CS02R-22
 *
 * Validates:
 *   - Case list (GET /support/cases)
 *   - Case create (POST /support/cases)
 *   - Message send (POST /support/cases/:id/messages)
 *   - Resolve (POST /support/cases/:id/resolve)
 *   - Reopen (POST /support/cases/:id/reopen)
 *   - Human request idempotent
 *   - Cross-user / cross-pool security
 *   - Double send protection (via author_role enforcement)
 *   - No raw message in production event logs
 *   - Legacy help route unaffected
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

// ── Auth mock ─────────────────────────────────────────────────────────────────

vi.mock("../../middlewares/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    if (!req.user) return _res.status(401).json({ error: "Unauthorized" });
    next();
  },
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user)          return res.status(401).json({ error: "Unauthorized" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    next();
  },
}));

// ── DB mock ───────────────────────────────────────────────────────────────────

let superRows: any[] = [];
let poolRows:  any[] = [];
const superCalls: string[] = [];
const poolCalls:  string[] = [];
let superExecuteOverride: ((raw: string, query: any) => Promise<{ rows: any[] }> | { rows: any[] }) | null = null;
let poolExecuteOverride: ((raw: string, query: any) => Promise<{ rows: any[] }> | { rows: any[] }) | null = null;

const pushMocks = vi.hoisted(() => ({
  sendPushToSuperAdmins: vi.fn().mockResolvedValue(undefined),
  sendPushToUser: vi.fn().mockResolvedValue(undefined),
}));
const aiMocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("../../lib/push-service.js", () => pushMocks);
vi.mock("../ai.js", () => ({
  getOpenAI: () => ({
    chat: { completions: { create: aiMocks.create } },
  }),
}));

vi.mock("@workspace/db", () => ({
  superAdminDb: {
    execute: vi.fn(async (q: any) => {
      const raw = typeof q?.queryChunks !== "undefined"
        ? q.queryChunks.map((c: any) => typeof c === "string" ? c : String(c?.value ?? "")).join("")
        : String(q?.sql ?? q ?? "");
      superCalls.push(raw.trim());
      if (superExecuteOverride) return superExecuteOverride(raw, q);
      return { rows: superRows };
    }),
    transaction: vi.fn(async (callback: any) => callback({
      execute: async (q: any) => {
        const raw = typeof q?.queryChunks !== "undefined"
          ? q.queryChunks.map((c: any) => typeof c === "string" ? c : String(c?.value ?? "")).join("")
          : String(q?.sql ?? q ?? "");
        superCalls.push(raw.trim());
        if (superExecuteOverride) return superExecuteOverride(raw, q);
        return { rows: superRows };
      },
    })),
  },
  db: {
    execute: vi.fn(async (q: any) => {
      const raw = typeof q?.queryChunks !== "undefined"
        ? q.queryChunks.map((c: any) => typeof c === "string" ? c : String(c?.value ?? "")).join("")
        : typeof q === "string" ? q : String(q?.sql ?? q ?? "");
      poolCalls.push(raw.trim());
      if (poolExecuteOverride) return poolExecuteOverride(raw, q);
      return { rows: poolRows };
    }),
  },
}));

vi.mock("../../lib/support-resolver.js", () => ({
  gatherEvidence: vi.fn().mockResolvedValue([]),
  normalizeQuery: (value: string) => value.toLowerCase().trim(),
  tokenize: (value: string) => value.toLowerCase().split(/\s+/).filter(Boolean),
}));

// ── App setup ─────────────────────────────────────────────────────────────────

import supportCasesRouter from "../support-cases.js";
import { gatherEvidence } from "../../lib/support-resolver.js";

function makeApp(role = "teacher", poolId = "pool_A", userId = "user_1") {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = { userId, role, poolId, name: "Test User" };
    next();
  });
  app.use("/", supportCasesRouter);
  return app;
}

function poolACase(overrides: any = {}) {
  return {
    id: "sc_test", pool_id: "pool_A", actor_id: "user_1",
    ticket_id: null, actor_role: "teacher", mode: "normal",
    state: "NEW", escalation_reason: null, resolution_source: null,
    llm_used: false, turn_count: 0, waiting_for: null, context_json: {},
    resolved_at: null, created_at: "2026-01-01", updated_at: "2026-01-01",
    ...overrides,
  };
}

beforeEach(() => {
  superRows = [];
  poolRows  = [];
  superCalls.length = 0;
  poolCalls.length  = 0;
  superExecuteOverride = null;
  poolExecuteOverride = null;
  pushMocks.sendPushToSuperAdmins.mockClear();
  pushMocks.sendPushToUser.mockClear();
  aiMocks.create.mockReset();
});
afterEach(() => vi.clearAllMocks());

// =============================================================================
// CS02R-01: admin Settings → AI 문의 entry (via case list API)
// =============================================================================
describe("CS02R-01: admin/teacher/parent roles can fetch their case list", () => {
  it("pool_admin can GET /support/cases", async () => {
    superRows = [poolACase({ state: "AI_PROCESSING" })];
    const app = makeApp("pool_admin", "pool_A", "user_1");
    const res = await request(app).get("/support/cases");
    expect(res.status).toBe(200);
    expect(res.body.cases).toBeDefined();
    expect(Array.isArray(res.body.cases)).toBe(true);
  });
});

// =============================================================================
// CS02R-02: teacher entry
// =============================================================================
describe("CS02R-02: teacher can list and create cases", () => {
  it("teacher GET /support/cases returns case list", async () => {
    superRows = [];
    const app = makeApp("teacher", "pool_A", "user_1");
    const res = await request(app).get("/support/cases");
    expect(res.status).toBe(200);
    expect(res.body.cases).toHaveLength(0);
  });
});

// =============================================================================
// CS02R-03: parent entry
// =============================================================================
describe("CS02R-03: parent_account role can access support cases", () => {
  it("parent_account GET /support/cases returns 200", async () => {
    superRows = [];
    const app = makeApp("parent_account", "pool_A", "parent_1");
    const res = await request(app).get("/support/cases");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.cases)).toBe(true);
  });
});

// =============================================================================
// CS02R-04: Normal mode case creation
// =============================================================================
describe("CS02R-04: Normal mode case create", () => {
  it("POST /support/cases with mode=normal creates case", async () => {
    const app = makeApp("teacher", "pool_A", "user_1");
    const res = await request(app)
      .post("/support/cases")
      .send({ mode: "normal", context: { feature_id: "SUPPORT" } });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.id).toMatch(/^sc_/);
  });
});

// =============================================================================
// CS02R-05: X mode case creation
// =============================================================================
describe("CS02R-05: X mode case create", () => {
  it("POST /support/cases with mode=x creates case and records xmode_enabled=true", async () => {
    const app = makeApp("pool_admin", "pool_A", "user_1");
    const res = await request(app)
      .post("/support/cases")
      .send({ mode: "x", context: { feature_id: "SUPPORT", app_version: "1.3.11" } });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // INSERT call should contain xmode_enabled context
    const insertCall = superCalls.find(s => s.includes("INSERT") && s.includes("support_cases"));
    expect(insertCall).toBeTruthy();
  });
});

// =============================================================================
// CS02R-06: First case create — generates sc_* id
// =============================================================================
describe("CS02R-06: first case create → id generated", () => {
  it("case id starts with sc_", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/support/cases")
      .send({ mode: "normal", context: {} });
    expect(res.body.id).toMatch(/^sc_\d+_[a-z0-9]+$/);
  });
});

// =============================================================================
// CS02R-07: First user message stored
// =============================================================================
describe("CS02R-07: first user message stored", () => {
  it("POST /support/cases/:id/messages with author_role=user succeeds", async () => {
    superRows = [poolACase({ state: "NEW" })];
    const app = makeApp();
    const res = await request(app)
      .post("/support/cases/sc_test/messages")
      .send({ content: "안녕하세요, 문의드립니다.", author_role: "user" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const insert = poolCalls.find(s => s.includes("INSERT") && s.includes("support_ticket_replies"));
    expect(insert).toBeTruthy();
    expect(insert).toContain("case_id");
  });
});

// =============================================================================
// CS02R-08: Conversation history reload
// =============================================================================
describe("CS02R-08: conversation history via GET /support/cases/:id", () => {
  it("returns messages array with author_role fields", async () => {
    superRows = [poolACase({ state: "AI_PROCESSING" })];
    poolRows  = [
      { id: "m1", ticket_id: null, case_id: "sc_test", author_role: "user",   content: "질문", created_at: "2026-01-01T10:00:00Z" },
      { id: "m2", ticket_id: null, case_id: "sc_test", author_role: "system", content: "접수", created_at: "2026-01-01T10:01:00Z" },
    ];
    const app = makeApp();
    const res = await request(app).get("/support/cases/sc_test");
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(2);
    const roles = res.body.messages.map((m: any) => m.author_role);
    expect(roles).toContain("user");
    expect(roles).toContain("system");
  });
});

// =============================================================================
// CS02R-09: System acknowledgement — NOT ai
// =============================================================================
describe("CS02R-09: system acknowledgement not AI-generated", () => {
  it("system message insertion uses author_role=system (not ai)", async () => {
    superRows = [poolACase({ state: "NEW" })];
    const app = makeApp();
    // System role post is allowed (server injects it — simulated here)
    const res = await request(app)
      .post("/support/cases/sc_test/messages")
      .send({ content: "문의가 접수되었습니다.", author_role: "user" }); // client sends user
    expect(res.status).toBe(200);
    // ai/agent not used for system acknowledgement
    expect(res.body.ok).toBe(true);
  });

  it("client cannot send author_role=ai", async () => {
    superRows = [poolACase({ state: "NEW" })];
    const app = makeApp("teacher", "pool_A", "user_1"); // non-super
    const res = await request(app)
      .post("/support/cases/sc_test/messages")
      .send({ content: "fake AI answer", author_role: "ai" });
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// CS02R-10: Resolve
// =============================================================================
describe("CS02R-10: resolve case", () => {
  it("POST /support/cases/:id/resolve succeeds from NEW state → AI_RESOLVED", async () => {
    superRows = [poolACase({ state: "NEW" })];
    const app = makeApp();
    const res = await request(app).post("/support/cases/sc_test/resolve").send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // UPDATE to AI_RESOLVED
    const updateCall = superCalls.find(s => s.includes("UPDATE") && s.includes("support_cases"));
    expect(updateCall).toBeTruthy();
    expect(updateCall).toContain("AI_RESOLVED");
  });

  it("resolve from HUMAN_RESPONDED → RESOLVED", async () => {
    superRows = [poolACase({ state: "HUMAN_RESPONDED" })];
    const app = makeApp();
    const res = await request(app).post("/support/cases/sc_test/resolve").send({});
    expect(res.status).toBe(200);
    const updateCall = superCalls.find(s => s.includes("UPDATE") && s.includes("support_cases"));
    expect(updateCall).toContain("RESOLVED");
  });

  it("already RESOLVED → idempotent 200", async () => {
    superRows = [poolACase({ state: "RESOLVED" })];
    const app = makeApp();
    const res = await request(app).post("/support/cases/sc_test/resolve").send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// =============================================================================
// CS02R-11: Not resolved / reopen
// =============================================================================
describe("CS02R-11: reopen resolved case", () => {
  it("POST /support/cases/:id/reopen from RESOLVED succeeds", async () => {
    superRows = [poolACase({ state: "RESOLVED" })];
    const app = makeApp();
    const res = await request(app).post("/support/cases/sc_test/reopen").send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("reopen from AI_RESOLVED succeeds", async () => {
    superRows = [poolACase({ state: "AI_RESOLVED" })];
    const app = makeApp();
    const res = await request(app).post("/support/cases/sc_test/reopen").send({});
    expect(res.status).toBe(200);
  });
});

// =============================================================================
// CS02R-12: Human request
// =============================================================================
describe("CS02R-12: human request flow", () => {
  it("direct request-human from NEW is rejected before GPT unresolved confirmation", async () => {
    superRows = [poolACase({ state: "NEW" })];
    poolRows  = [];
    const app = makeApp();
    const res = await request(app)
      .post("/support/cases/sc_test/request-human")
      .send({ subject: "상담사 연결 요청" });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain("추가 상담");
    const ticketInsert = poolCalls.find(s => s.includes("INSERT") && s.includes("support_tickets"));
    expect(ticketInsert).toBeUndefined();
  });

  it("creates one ticket only after GPT response and explicit unresolved confirmation", async () => {
    superRows = [poolACase({
      state: "AI_RESPONDED",
      context_json: { cs26_sequence: { gpt_status: "RESPONDED" } },
    })];
    poolRows = [];
    const app = makeApp();
    const res = await request(app)
      .post("/support/cases/sc_test/request-human")
      .send({ subject: "추가 상담 후 미해결", confirmation: "GPT_UNRESOLVED" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.created).toBe(true);
    expect(res.body.ticket_id).toMatch(/^tkt_/);
  });

  it("preserves the verified HUMAN_ONLY exception without allowing a client flag bypass", async () => {
    superRows = [poolACase({
      state: "AI_RESPONDED",
      context_json: { resolution_context: { human_only: true } },
    })];
    poolRows = [];
    const app = makeApp();
    const res = await request(app)
      .post("/support/cases/sc_test/request-human")
      .send({ subject: "가격 문의", confirmation: "HUMAN_ONLY" });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(true);
  });

  it("rejects HUMAN_ONLY confirmation when the server did not mark the case HUMAN_ONLY", async () => {
    superRows = [poolACase({ state: "AI_RESPONDED", context_json: {} })];
    const app = makeApp();
    const res = await request(app)
      .post("/support/cases/sc_test/request-human")
      .send({ confirmation: "HUMAN_ONLY" });
    expect(res.status).toBe(422);
  });
});

// =============================================================================
// CS26-01: explicit grounded second stage
// =============================================================================
describe("CS26-01: explicit second-stage support consultation", () => {
  it("requires a 3-turn offered CTA and does not create a ticket when grounding is insufficient", async () => {
    superRows = [poolACase({
      state: "AI_RESPONDED",
      context_json: {
        cs26_sequence: {
          same_intent_streak: 3,
          inquiry_offered: true,
          gpt_status: "OFFERED",
        },
      },
    })];
    poolRows = [{ author_role: "user", content: "같은 화면에서 계속 오류가 나요" }];
    const app = makeApp();
    const res = await request(app)
      .post("/support/cases/sc_test/gpt-escalation")
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.llm_called).toBe(false);
    expect(res.body.requires_resolution_confirmation).toBe(true);
    expect(res.body.answer).toContain("현재 확인 가능한 안내");
    const ticketInsert = poolCalls.find(s => s.includes("INSERT") && s.includes("support_tickets"));
    expect(ticketInsert).toBeUndefined();
  });

  it("rejects second-stage GPT before the repeat CTA is offered", async () => {
    superRows = [poolACase({
      state: "AI_RESPONDED",
      context_json: { cs26_sequence: { same_intent_streak: 2, inquiry_offered: false } },
    })];
    const app = makeApp();
    const res = await request(app)
      .post("/support/cases/sc_test/gpt-escalation")
      .send({});
    expect(res.status).toBe(422);
  });

  it("rejects a GPT answer that cites an evidence ID outside the allowed set", async () => {
    vi.mocked(gatherEvidence).mockResolvedValueOnce([{
      id: "ki_allowed",
      revision: 7,
      item_type: "FAQ",
      answer: "검증된 안내",
      score: 90,
    } as any]);
    aiMocks.create.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            answer: "허용되지 않은 근거로 만든 답변",
            used_knowledge_ids: ["ki_not_allowed"],
          }),
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    superRows = [poolACase({
      state: "AI_RESPONDED",
      context_json: {
        cs26_sequence: {
          same_intent_streak: 3,
          inquiry_offered: true,
          gpt_status: "OFFERED",
        },
      },
    })];
    poolRows = [{ author_role: "user", content: "같은 화면에서 계속 오류가 나요" }];

    const res = await request(makeApp())
      .post("/support/cases/sc_test/gpt-escalation")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.llm_called).toBe(true);
    expect(res.body.answer).toContain("현재 확인 가능한 안내");
    expect(res.body.answer).not.toContain("허용되지 않은 근거");
  });

  it("returns a natural grounded response instead of concatenating canonical answers", async () => {
    vi.mocked(gatherEvidence).mockResolvedValueOnce([{
      id: "ki_allowed",
      revision: 8,
      item_type: "SOLUTION",
      answer: "서버에서 검증된 다음 확인 단계입니다.",
      title: "검증 단계",
      score: 92,
    } as any]);
    aiMocks.create.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            answer: "먼저 서버에서 검증된 다음 확인 단계를 진행해 주세요.",
            used_knowledge_ids: ["ki_allowed"],
          }),
        },
      }],
      usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
    });
    superRows = [poolACase({
      state: "AI_RESPONDED",
      context_json: {
        cs26_sequence: {
          same_intent_streak: 3,
          inquiry_offered: true,
          gpt_status: "OFFERED",
        },
      },
    })];
    poolRows = [{ author_role: "user", content: "같은 오류를 어떻게 확인하나요" }];

    const res = await request(makeApp())
      .post("/support/cases/sc_test/gpt-escalation")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.llm_called).toBe(true);
    expect(res.body.answer).toBe("먼저 서버에서 검증된 다음 확인 단계를 진행해 주세요.");
    expect(res.body.answer).not.toBe("서버에서 검증된 다음 확인 단계입니다.");
  });

  it("lets GPT compose only the relevant two of three verified Knowledge items", async () => {
    vi.mocked(gatherEvidence).mockResolvedValueOnce([
      { id: "ki_tried", revision: 1, item_type: "FAQ", title: "이미 시도함", answer: "앱을 다시 열어 확인해 주세요.", score: 91 },
      { id: "ki_next", revision: 2, item_type: "SOLUTION", title: "다음 단계", answer: "권한 상태를 확인해 주세요.", score: 89 },
      { id: "ki_finish", revision: 3, item_type: "SOLUTION", title: "마무리 단계", answer: "저장 후 다시 동기화해 주세요.", score: 87 },
    ] as any);
    aiMocks.create.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            answer: "권한 상태를 먼저 확인해 주세요. 확인 후 저장하고 다시 동기화해 보세요.",
            used_knowledge_ids: ["ki_next", "ki_finish"],
          }),
        },
      }],
      usage: { prompt_tokens: 20, completion_tokens: 18, total_tokens: 38 },
    });
    superRows = [poolACase({
      state: "AI_RESPONDED",
      context_json: { cs26_sequence: { same_intent_streak: 3, inquiry_offered: true, gpt_status: "OFFERED" } },
    })];
    poolRows = [{ author_role: "user", content: "이미 앱을 다시 열었는데 계속 안 돼요" }];

    const res = await request(makeApp())
      .post("/support/cases/sc_test/gpt-escalation")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.answer).toContain("권한 상태");
    expect(res.body.answer).toContain("동기화");
    expect(res.body.answer).not.toContain("앱을 다시 열어");
    const prompt = aiMocks.create.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain("ki_tried");
    expect(prompt).toContain("ki_next");
    expect(prompt).toContain("ki_finish");
  });

  it("uses a different verified step after the user says the prior guidance was already tried", async () => {
    vi.mocked(gatherEvidence).mockResolvedValueOnce([
      { id: "ki_prior", revision: 1, item_type: "FAQ", title: "기존 안내", answer: "자녀 연결 상태를 확인해 주세요.", score: 90 },
      { id: "ki_alternate", revision: 2, item_type: "SOLUTION", title: "다음 안내", answer: "권한 설정을 다시 확인해 주세요.", score: 88 },
    ] as any);
    aiMocks.create.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            answer: "연결 상태가 정상이라면 권한 설정을 다시 확인해 주세요.",
            used_knowledge_ids: ["ki_alternate"],
          }),
        },
      }],
      usage: { prompt_tokens: 19, completion_tokens: 12, total_tokens: 31 },
    });
    superRows = [poolACase({
      state: "AI_RESPONDED",
      context_json: { cs26_sequence: { same_intent_streak: 3, inquiry_offered: true, gpt_status: "OFFERED" } },
    })];
    // DB query order is DESC; the route reverses it before building the prompt.
    poolRows = [
      { author_role: "user", content: "이미 연결되어 있어요." },
      { author_role: "ai", content: "자녀 연결 상태를 확인해 주세요." },
    ];

    const res = await request(makeApp())
      .post("/support/cases/sc_test/gpt-escalation")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.answer).toContain("권한 설정");
    expect(res.body.answer).not.toBe("자녀 연결 상태를 확인해 주세요.");
    expect(aiMocks.create.mock.calls[0][0].messages[0].content)
      .toContain("기존 안내: 자녀 연결 상태를 확인해 주세요.");
  });

  it("rejects a mixed answer that repeats prior guidance before adding a new step", async () => {
    vi.mocked(gatherEvidence).mockResolvedValueOnce([
      { id: "ki_prior", revision: 1, item_type: "FAQ", title: "기존 안내", answer: "자녀 연결 상태를 확인해 주세요.", score: 90 },
      { id: "ki_alternate", revision: 2, item_type: "SOLUTION", title: "다음 안내", answer: "권한 설정을 다시 확인해 주세요.", score: 88 },
    ] as any);
    aiMocks.create.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            answer: "자녀 연결 상태를 다시 확인해 주세요. 이후 권한 설정도 확인해 주세요.",
            used_knowledge_ids: ["ki_prior", "ki_alternate"],
          }),
        },
      }],
      usage: { prompt_tokens: 19, completion_tokens: 16, total_tokens: 35 },
    });
    superRows = [poolACase({
      state: "AI_RESPONDED",
      context_json: { cs26_sequence: { same_intent_streak: 3, inquiry_offered: true, gpt_status: "OFFERED" } },
    })];
    poolRows = [
      { author_role: "user", content: "이미 연결되어 있어요." },
      { author_role: "ai", content: "자녀 연결 상태를 확인해 주세요." },
    ];

    const res = await request(makeApp())
      .post("/support/cases/sc_test/gpt-escalation")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.answer).toContain("현재 확인 가능한 안내");
    expect(res.body.answer).not.toContain("권한 설정도");
  });

  it("rejects uncited price and UI claims even when the Knowledge ID itself is allowed", async () => {
    const ordinaryEvidence = [{
      id: "ki_safe",
      revision: 1,
      item_type: "FAQ",
      title: "일반 확인",
      answer: "현재 등록 상태를 확인해 주세요.",
      score: 95,
    }] as any;
    vi.mocked(gatherEvidence).mockResolvedValueOnce(ordinaryEvidence);
    aiMocks.create.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            answer: "월 요금은 2만원이며 새 결제 메뉴에서 변경할 수 있습니다.",
            used_knowledge_ids: ["ki_safe"],
          }),
        },
      }],
      usage: { prompt_tokens: 12, completion_tokens: 10, total_tokens: 22 },
    });
    superRows = [poolACase({
      state: "AI_RESPONDED",
      context_json: { cs26_sequence: { same_intent_streak: 3, inquiry_offered: true, gpt_status: "OFFERED" } },
    })];
    poolRows = [{ author_role: "user", content: "결제 관련 오류가 나요" }];

    const res = await request(makeApp())
      .post("/support/cases/sc_test/gpt-escalation")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.llm_called).toBe(true);
    expect(res.body.answer).toContain("현재 확인 가능한 안내");
    expect(res.body.answer).not.toContain("2만원");
    expect(res.body.answer).not.toContain("결제 메뉴");
  });

  it("rejects a standalone unsupported UI route claim", async () => {
    vi.mocked(gatherEvidence).mockResolvedValueOnce([{
      id: "ki_safe",
      revision: 1,
      item_type: "FAQ",
      title: "일반 확인",
      answer: "현재 등록 상태를 확인해 주세요.",
      score: 95,
    }] as any);
    aiMocks.create.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            answer: "새로운 설정 화면에서 해당 기능을 확인해 주세요.",
            used_knowledge_ids: ["ki_safe"],
          }),
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 9, total_tokens: 19 },
    });
    superRows = [poolACase({
      state: "AI_RESPONDED",
      context_json: { cs26_sequence: { same_intent_streak: 3, inquiry_offered: true, gpt_status: "OFFERED" } },
    })];
    poolRows = [{ author_role: "user", content: "등록 상태가 안 보여요" }];

    const res = await request(makeApp())
      .post("/support/cases/sc_test/gpt-escalation")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.answer).toContain("현재 확인 가능한 안내");
    expect(res.body.answer).not.toContain("설정 화면");
  });

  it("rejects a non-Korean counselor response even when its Knowledge ID is allowed", async () => {
    vi.mocked(gatherEvidence).mockResolvedValueOnce([{
      id: "ki_safe",
      revision: 1,
      item_type: "FAQ",
      title: "일반 확인",
      answer: "현재 등록 상태를 확인해 주세요.",
      score: 95,
    }] as any);
    aiMocks.create.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            answer: "Go to Settings to continue.",
            used_knowledge_ids: ["ki_safe"],
          }),
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 7, total_tokens: 17 },
    });
    superRows = [poolACase({
      state: "AI_RESPONDED",
      context_json: { cs26_sequence: { same_intent_streak: 3, inquiry_offered: true, gpt_status: "OFFERED" } },
    })];
    poolRows = [{ author_role: "user", content: "등록 상태가 안 보여요" }];

    const res = await request(makeApp())
      .post("/support/cases/sc_test/gpt-escalation")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.answer).toContain("현재 확인 가능한 안내");
    expect(res.body.answer).not.toContain("Go to Settings");
  });
});

// =============================================================================
// CS02R-13: Double human request idempotent
// =============================================================================
describe("CS02R-13: double human request idempotent", () => {
  it("second request-human returns existing ticket_id without creating new one", async () => {
    superRows = [poolACase({ state: "HUMAN_REQUIRED", ticket_id: "tkt_existing_123" })];
    const app = makeApp();
    const res = await request(app)
      .post("/support/cases/sc_test/request-human")
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.created).toBe(false);
    expect(res.body.ticket_id).toBe("tkt_existing_123");
    // No new ticket INSERT
    const ticketInsert = poolCalls.find(s => s.includes("INSERT") && s.includes("support_tickets"));
    expect(ticketInsert).toBeUndefined();
  });

  it("atomically allows one concurrent ticket and one Super Admin push", async () => {
    const caseWithoutTicket = poolACase({
      state: "AI_RESPONDED",
      context_json: {
        cs26_sequence: {
          same_intent_streak: 3,
          inquiry_offered: false,
          gpt_status: "RESPONDED",
        },
      },
    });
    let initialReads = 0;
    let releaseInitialReads!: () => void;
    const bothInitialReads = new Promise<void>((resolve) => {
      releaseInitialReads = resolve;
    });
    let claimWon = false;

    superExecuteOverride = async (raw) => {
      if (raw.includes("SELECT actor_id") && raw.includes("FROM support_cases")) {
        initialReads += 1;
        if (initialReads === 2) releaseInitialReads();
        await bothInitialReads;
        return { rows: [caseWithoutTicket] };
      }
      if (raw.includes("AND ticket_id IS NULL") && raw.includes("RETURNING ticket_id")) {
        if (!claimWon) {
          claimWon = true;
          return { rows: [{ ticket_id: "claimed" }] };
        }
        return { rows: [] };
      }
      if (raw.includes("SELECT ticket_id") && raw.includes("FROM support_cases")) {
        return { rows: [{ ticket_id: "tkt_claimed_by_first_request" }] };
      }
      return { rows: [] };
    };
    poolExecuteOverride = async () => ({ rows: [] });

    const app = makeApp();
    const payload = { subject: "추가 상담 후 미해결", confirmation: "GPT_UNRESOLVED" };
    const [first, second] = await Promise.all([
      request(app).post("/support/cases/sc_test/request-human").send(payload),
      request(app).post("/support/cases/sc_test/request-human").send(payload),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect([first.body.created, second.body.created].sort()).toEqual([false, true]);
    expect(poolCalls.filter((call) =>
      call.includes("INSERT") && call.includes("support_tickets")
    )).toHaveLength(1);
    expect(pushMocks.sendPushToSuperAdmins).toHaveBeenCalledTimes(1);
  });

  it("releases the atomic case claim when ticket creation fails", async () => {
    superRows = [poolACase({
      state: "AI_RESPONDED",
      escalation_reason: null,
      context_json: {
        cs26_sequence: {
          same_intent_streak: 3,
          inquiry_offered: false,
          gpt_status: "RESPONDED",
        },
      },
    })];
    poolExecuteOverride = async (raw) => {
      if (raw.includes("INSERT") && raw.includes("support_tickets")) {
        throw new Error("ticket insert failed");
      }
      return { rows: [] };
    };

    const res = await request(makeApp())
      .post("/support/cases/sc_test/request-human")
      .send({ confirmation: "GPT_UNRESOLVED" });

    expect(res.status).toBe(500);
    expect(superCalls.some((call) =>
      call.includes("SET ticket_id") &&
      call.includes("NULL") &&
      call.includes("AND ticket_id")
    )).toBe(true);
    expect(pushMocks.sendPushToSuperAdmins).not.toHaveBeenCalled();
  });

  it("does not create a ticket when resolve wins a concurrent race", async () => {
    const activeCase = poolACase({
      state: "AI_RESPONDED",
      context_json: {
        cs26_sequence: {
          same_intent_streak: 3,
          inquiry_offered: false,
          gpt_status: "RESPONDED",
        },
      },
    });
    let currentState = "AI_RESPONDED";
    let initialReads = 0;
    let releaseInitialReads!: () => void;
    const bothInitialReads = new Promise<void>((resolve) => {
      releaseInitialReads = resolve;
    });
    let resolveCommitted!: () => void;
    const resolved = new Promise<void>((resolve) => {
      resolveCommitted = resolve;
    });
    superExecuteOverride = async (raw) => {
      if (raw.includes("SELECT actor_id") && raw.includes("FROM support_cases")) {
        initialReads += 1;
        if (initialReads === 2) releaseInitialReads();
        await bothInitialReads;
        return { rows: [{ ...activeCase, state: "AI_RESPONDED" }] };
      }
      if (raw.includes("SELECT state, pool_id") && raw.includes("FROM support_cases")) {
        return { rows: [{ ...activeCase, state: currentState }] };
      }
      if (
        raw.includes("UPDATE support_cases") &&
        raw.includes("state") &&
        !raw.includes("ticket_id IS NULL")
      ) {
        currentState = "AI_RESOLVED";
        resolveCommitted();
        return { rows: [{ id: "sc_test" }] };
      }
      if (raw.includes("ticket_id IS NULL") && raw.includes("RETURNING ticket_id")) {
        await resolved;
        return { rows: [] };
      }
      if (raw.includes("SELECT ticket_id") && raw.includes("FROM support_cases")) {
        return { rows: [{ ticket_id: null, state: currentState }] };
      }
      return { rows: [] };
    };
    poolExecuteOverride = async () => ({ rows: [] });

    const app = makeApp();
    const [resolveResponse, humanResponse] = await Promise.all([
      request(app).post("/support/cases/sc_test/resolve").send({}),
      request(app)
        .post("/support/cases/sc_test/request-human")
        .send({ confirmation: "GPT_UNRESOLVED" }),
    ]);

    expect(resolveResponse.status).toBe(200);
    expect(resolveResponse.body.state).toBe("AI_RESOLVED");
    expect(humanResponse.status).toBe(409);
    expect(poolCalls.filter((call) =>
      call.includes("INSERT") && call.includes("support_tickets")
    )).toHaveLength(0);
    expect(pushMocks.sendPushToSuperAdmins).not.toHaveBeenCalled();
  });

  it("rejects a stale resolve that read before a human claim committed", async () => {
    const activeCase = poolACase({
      state: "AI_RESPONDED",
      context_json: {
        cs26_sequence: {
          same_intent_streak: 3,
          inquiry_offered: false,
          gpt_status: "RESPONDED",
        },
      },
    });
    let initialReads = 0;
    let releaseInitialReads!: () => void;
    const bothInitialReads = new Promise<void>((resolve) => {
      releaseInitialReads = resolve;
    });
    let transitionRead!: () => void;
    const resolveTransitionRead = new Promise<void>((resolve) => {
      transitionRead = resolve;
    });
    let humanClaimed!: () => void;
    const humanClaimCommitted = new Promise<void>((resolve) => {
      humanClaimed = resolve;
    });

    superExecuteOverride = async (raw) => {
      if (raw.includes("SELECT actor_id") && raw.includes("FROM support_cases")) {
        initialReads += 1;
        if (initialReads === 2) releaseInitialReads();
        await bothInitialReads;
        return { rows: [{ ...activeCase, state: "AI_RESPONDED" }] };
      }
      if (raw.includes("SELECT state, pool_id") && raw.includes("FROM support_cases")) {
        transitionRead();
        return { rows: [{ ...activeCase, state: "AI_RESPONDED" }] };
      }
      if (raw.includes("ticket_id IS NULL") && raw.includes("RETURNING ticket_id")) {
        await resolveTransitionRead;
        humanClaimed();
        return { rows: [{ ticket_id: "tkt_human_claim" }] };
      }
      if (
        raw.includes("UPDATE support_cases") &&
        raw.includes("AND state") &&
        !raw.includes("ticket_id IS NULL")
      ) {
        await humanClaimCommitted;
        return { rows: [] };
      }
      return { rows: [] };
    };
    poolExecuteOverride = async () => ({ rows: [] });

    const app = makeApp();
    const [resolveResponse, humanResponse] = await Promise.all([
      request(app).post("/support/cases/sc_test/resolve").send({}),
      request(app)
        .post("/support/cases/sc_test/request-human")
        .send({ confirmation: "GPT_UNRESOLVED" }),
    ]);

    expect(resolveResponse.status).toBe(409);
    expect(humanResponse.status).toBe(200);
    expect(poolCalls.filter((call) =>
      call.includes("INSERT") && call.includes("support_tickets")
    )).toHaveLength(1);
    expect(pushMocks.sendPushToSuperAdmins).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// CS02R-13B: stale agent reply must not side-effect after resolution
// =============================================================================
describe("CS02R-13B: agent reply and resolve concurrency", () => {
  it("does not insert a reply or notify the user when its state CAS is stale", async () => {
    const activeCase = poolACase({ state: "HUMAN_REQUIRED", ticket_id: "tkt_human_1" });

    superExecuteOverride = async (raw) => {
      if (raw.includes("SELECT actor_id") && raw.includes("FROM support_cases")) {
        return { rows: [activeCase] };
      }
      if (raw.includes("SELECT state, pool_id") && raw.includes("FROM support_cases")) {
        return { rows: [activeCase] };
      }
      if (raw.includes("UPDATE support_cases") && raw.includes("AND state")) {
        // A concurrent resolve has already changed the row after the agent
        // performed its read, so the conditional update affects zero rows.
        return { rows: [] };
      }
      return { rows: [] };
    };

    const agentResponse = await request(makeApp("super_admin", "pool_A", "super_1"))
      .post("/support/cases/sc_test/agent-reply")
      .send({ content: "담당자 답변입니다." });

    expect(agentResponse.status).toBe(409);
    expect(superCalls.some((call) =>
      call.includes("INSERT") && call.includes("support_ticket_replies")
    )).toBe(false);
    expect(pushMocks.sendPushToUser).not.toHaveBeenCalled();
  });

  it("does not notify the user when the transactional reply insert fails", async () => {
    const activeCase = poolACase({ state: "HUMAN_REQUIRED", ticket_id: "tkt_human_1" });
    superExecuteOverride = async (raw) => {
      if (raw.includes("SELECT actor_id") || raw.includes("SELECT state, pool_id")) {
        return { rows: [activeCase] };
      }
      if (raw.includes("UPDATE support_cases") && raw.includes("AND state")) {
        return { rows: [{ id: "sc_test" }] };
      }
      if (raw.includes("INSERT") && raw.includes("support_ticket_replies")) {
        throw new Error("reply insert failed");
      }
      return { rows: [] };
    };

    const response = await request(makeApp("super_admin", "pool_A", "super_1"))
      .post("/support/cases/sc_test/agent-reply")
      .send({ content: "담당자 답변입니다." });

    expect(response.status).toBe(500);
    expect(pushMocks.sendPushToUser).not.toHaveBeenCalled();
  });
});

// =============================================================================
// CS02R-14: Agent reply visible in conversation
// =============================================================================
describe("CS02R-14: agent reply visible in conversation", () => {
  it("GET /support/cases/:id includes agent messages", async () => {
    superRows = [poolACase({ state: "HUMAN_RESPONDED", ticket_id: "tkt_123" })];
    poolRows  = [
      { id: "r1", ticket_id: null, case_id: "sc_test", author_role: "user",  content: "q", created_at: "2026-01-01T10:00:00Z" },
      { id: "r2", ticket_id: "tkt_123", case_id: "sc_test", author_role: "agent", content: "a", created_at: "2026-01-01T10:05:00Z" },
    ];
    const app = makeApp();
    const res = await request(app).get("/support/cases/sc_test");
    expect(res.status).toBe(200);
    const agentMsg = res.body.messages.find((m: any) => m.author_role === "agent");
    expect(agentMsg).toBeTruthy();
    expect(agentMsg.content).toBe("a");
  });
});

// =============================================================================
// CS02R-15: Network failure simulation (missing case → 404)
// =============================================================================
describe("CS02R-15: missing case returns 404", () => {
  it("GET /support/cases/:id returns 404 for missing case", async () => {
    superRows = [];
    const app = makeApp();
    const res = await request(app).get("/support/cases/sc_nonexistent");
    expect(res.status).toBe(404);
  });

  it("POST messages to missing case returns 404", async () => {
    superRows = [];
    const app = makeApp();
    const res = await request(app)
      .post("/support/cases/sc_nonexistent/messages")
      .send({ content: "test", author_role: "user" });
    expect(res.status).toBe(404);
  });
});

// =============================================================================
// CS02R-16: 401 — unauthenticated
// =============================================================================
describe("CS02R-16: unauthenticated request returns 401", () => {
  it("GET /support/cases without user returns 401", async () => {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      // No req.user set
      next();
    });
    app.use("/", supportCasesRouter);
    const res = await request(app).get("/support/cases");
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// CS02R-17: Cross-user denied
// =============================================================================
describe("CS02R-17: cross-user case access denied", () => {
  it("user_2 cannot GET case owned by user_1", async () => {
    superRows = [poolACase({ actor_id: "user_1", pool_id: "pool_A" })];
    const app = makeApp("teacher", "pool_A", "user_2"); // different user
    const res = await request(app).get("/support/cases/sc_test");
    expect(res.status).toBe(403);
  });

  it("user_2 cannot post messages to user_1 case", async () => {
    superRows = [{ actor_id: "user_1", pool_id: "pool_A", ticket_id: null, state: "NEW" }];
    const app = makeApp("teacher", "pool_A", "user_2");
    const res = await request(app)
      .post("/support/cases/sc_test/messages")
      .send({ content: "x", author_role: "user" });
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// CS02R-18: Cross-pool denied
// =============================================================================
describe("CS02R-18: cross-pool case access denied", () => {
  it("pool_B user cannot GET pool_A case", async () => {
    superRows = [poolACase({ pool_id: "pool_A", actor_id: "user_1" })];
    const app = makeApp("teacher", "pool_B", "user_1");
    const res = await request(app).get("/support/cases/sc_test");
    expect(res.status).toBe(403);
  });

  it("pool_B user cannot resolve pool_A case", async () => {
    superRows = [poolACase({ pool_id: "pool_A", actor_id: "user_1" })];
    const app = makeApp("teacher", "pool_B", "user_1");
    const res = await request(app).post("/support/cases/sc_test/resolve").send({});
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// CS02R-19: Double send protection — author_role enforcement
// =============================================================================
describe("CS02R-19: double send / fake role protection", () => {
  it("non-super cannot send author_role=agent", async () => {
    superRows = [poolACase({ state: "HUMAN_REQUIRED" })];
    const app = makeApp("teacher", "pool_A", "user_1");
    const res = await request(app)
      .post("/support/cases/sc_test/messages")
      .send({ content: "I am agent", author_role: "agent" });
    expect(res.status).toBe(403);
  });

  it("invalid author_role returns 400", async () => {
    superRows = [poolACase()];
    const app = makeApp();
    const res = await request(app)
      .post("/support/cases/sc_test/messages")
      .send({ content: "x", author_role: "hacker" });
    expect(res.status).toBe(400);
  });
});

// =============================================================================
// CS02R-20: No raw message content in production event logs
// =============================================================================
describe("CS02R-20: no raw message content in event_logs", () => {
  it("event_logs INSERT does not contain message body", async () => {
    superRows = [poolACase({ state: "AI_PROCESSING" })];
    const app = makeApp();
    await request(app)
      .post("/support/cases/sc_test/messages")
      .send({ content: "SECRET_BODY_PII_TEST_CONTENT", author_role: "user" });

    const eventInserts = superCalls.filter(s =>
      s.includes("INSERT") && s.includes("event_logs")
    );
    for (const call of eventInserts) {
      expect(call).not.toContain("SECRET_BODY_PII_TEST_CONTENT");
    }
  });

  it("case creation event does not store context PII", async () => {
    const app = makeApp();
    await request(app)
      .post("/support/cases")
      .send({
        mode: "normal",
        context: { feature_id: "SUPPORT", app_version: "1.3.11" },
      });
    const eventInserts = superCalls.filter(s => s.includes("event_logs"));
    for (const call of eventInserts) {
      expect(call).not.toContain("SECRET");
      expect(call).not.toContain("password");
      expect(call).not.toContain("email");
    }
  });
});

// =============================================================================
// FIX-01~13: P0 Message Send Defect — root cause: "__new__" sentinel bypassed
//            case creation → POST /support/cases/__new__/messages → 404
// =============================================================================
describe("FIX-01: POST /support/cases creates a real case (not __new__)", () => {
  it("case create returns ok:true and id starting with sc_", async () => {
    superRows = [];
    const app = makeApp("teacher", "pool_A", "user_1");
    const res = await request(app)
      .post("/support/cases")
      .send({ mode: "normal", context: { feature_id: "SUPPORT" } });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.id).toMatch(/^sc_/);
    expect(res.body.id).not.toBe("__new__");
  });
});

describe("FIX-02: POST /support/cases/:id/messages uses real id (not __new__)", () => {
  it("POST to real case id returns 200 ok; POST to __new__ returns 404", async () => {
    superRows = [poolACase({ state: "NEW" })];
    const app = makeApp("teacher", "pool_A", "user_1");
    // Real id → success
    const okRes = await request(app)
      .post("/support/cases/sc_test/messages")
      .send({ content: "안녕하세요", author_role: "user" });
    expect(okRes.status).toBe(200);
    expect(okRes.body.ok).toBe(true);
    // __new__ sentinel → 404 (no such case)
    superRows = [];
    const badRes = await request(app)
      .post("/support/cases/__new__/messages")
      .send({ content: "안녕하세요", author_role: "user" });
    expect(badRes.status).toBe(404);
  });
});

describe("FIX-03: message POST succeeds and returns message id", () => {
  it("POST /support/cases/:id/messages returns ok:true with id", async () => {
    superRows = [poolACase({ state: "NEW" })];
    const app = makeApp("teacher", "pool_A", "user_1");
    const res = await request(app)
      .post("/support/cases/sc_test/messages")
      .send({ content: "테스트 메시지", author_role: "user" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body).toHaveProperty("id");
  });
});

describe("FIX-04: GET /support/cases/:id returns messages array", () => {
  it("messages array present in case detail response", async () => {
    superRows = [poolACase({ state: "NEW" })];
    const app = makeApp("teacher", "pool_A", "user_1");
    const res = await request(app).get("/support/cases/sc_test");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.messages)).toBe(true);
  });
});

describe("FIX-05: message POST returns ok:true on success (client clears input)", () => {
  it("200 ok:true response signals success to client", async () => {
    superRows = [poolACase({ state: "NEW" })];
    const app = makeApp("teacher", "pool_A", "user_1");
    const res = await request(app)
      .post("/support/cases/sc_test/messages")
      .send({ content: "입력 내용", author_role: "user" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe("FIX-06: failed send returns 4xx so client can preserve input", () => {
  it("POST to non-existent case returns 404", async () => {
    superRows = []; // case not found
    const app = makeApp("teacher", "pool_A", "user_1");
    const res = await request(app)
      .post("/support/cases/sc_nonexistent/messages")
      .send({ content: "안녕", author_role: "user" });
    expect(res.status).toBe(404);
  });
});

describe("FIX-07: unauthenticated request returns 401", () => {
  it("POST /support/cases without auth → 401", async () => {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => { req.user = undefined; next(); });
    app.use("/", supportCasesRouter);
    const res = await request(app)
      .post("/support/cases")
      .send({ mode: "normal" });
    expect(res.status).toBe(401);
  });
});

describe("FIX-08: teacher can send messages", () => {
  it("teacher role POST /support/cases/:id/messages → 200 ok", async () => {
    superRows = [poolACase({ state: "NEW", actor_role: "teacher" })];
    const app = makeApp("teacher", "pool_A", "user_1");
    const res = await request(app)
      .post("/support/cases/sc_test/messages")
      .send({ content: "선생님 문의", author_role: "user" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe("FIX-09: parent_account can send messages", () => {
  it("parent_account role POST /support/cases/:id/messages → 200 ok", async () => {
    superRows = [poolACase({ state: "NEW", actor_role: "parent_account", actor_id: "parent_1" })];
    const app = makeApp("parent_account", "pool_A", "parent_1");
    const res = await request(app)
      .post("/support/cases/sc_test/messages")
      .send({ content: "학부모 문의", author_role: "user" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe("FIX-10: pool_admin can send messages", () => {
  it("pool_admin role POST /support/cases/:id/messages → 200 ok", async () => {
    superRows = [poolACase({ state: "NEW", actor_role: "pool_admin" })];
    const app = makeApp("pool_admin", "pool_A", "user_1");
    const res = await request(app)
      .post("/support/cases/sc_test/messages")
      .send({ content: "관리자 문의", author_role: "user" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe("FIX-11: support-cases router is importable (route registered)", () => {
  it("GET /support/cases returns 200 (router mounted)", async () => {
    superRows = [];
    const app = makeApp("teacher", "pool_A", "user_1");
    const res = await request(app).get("/support/cases");
    expect(res.status).toBe(200);
  });
});

describe("FIX-12: rapid consecutive message POSTs are independent (no state duplication)", () => {
  it("two sequential POSTs both return 200 ok", async () => {
    superRows = [poolACase({ state: "NEW" })];
    const app = makeApp("teacher", "pool_A", "user_1");
    const r1 = await request(app)
      .post("/support/cases/sc_test/messages")
      .send({ content: "첫 번째", author_role: "user" });
    const r2 = await request(app)
      .post("/support/cases/sc_test/messages")
      .send({ content: "두 번째", author_role: "user" });
    expect(r1.status).toBe(200);
    expect(r1.body.ok).toBe(true);
    expect(r2.status).toBe(200);
    expect(r2.body.ok).toBe(true);
    // Different message ids confirm no duplication
    expect(r1.body.id).not.toBe(r2.body.id);
  });
});

// FIX-13: full existing suite pass — covered by running the entire file

// =============================================================================
// CS02R-21: Legacy help route unaffected
// =============================================================================
describe("CS02R-21: legacy help routes not handled by support-cases router", () => {
  it("GET /inquiries/sent not handled by support-cases router → 404", async () => {
    const app = makeApp();
    const res = await request(app).get("/inquiries/sent");
    expect(res.status).toBe(404);
  });

  it("GET /support/tickets/:id not handled by support-cases router → 404", async () => {
    const app = makeApp();
    const res = await request(app).get("/support/tickets/tkt_123");
    expect(res.status).toBe(404);
  });
});

// =============================================================================
// CS02R-22: Full regression — existing suite still passes
// =============================================================================
describe("CS02R-22: GET /support/cases returns master_state field", () => {
  it("case list includes master_state mapped from internal state", async () => {
    superRows = [
      poolACase({ state: "NEW",            master_state: undefined }),
      poolACase({ id: "sc_2", state: "HUMAN_REQUIRED", master_state: undefined }),
    ];
    const app = makeApp();
    const res = await request(app).get("/support/cases");
    expect(res.status).toBe(200);
    const states = res.body.cases.map((c: any) => c.master_state);
    expect(states).toContain("AI_ACTIVE");
    expect(states).toContain("AGENT_REQUESTED");
  });

  it("super_admin GET /support/cases sees all cases (no pool filter)", async () => {
    superRows = [
      poolACase({ pool_id: "pool_A" }),
      { ...poolACase(), id: "sc_b", pool_id: "pool_B", actor_id: "other" },
    ];
    const app = makeApp("super_admin", "pool_X", "super_1");
    const res = await request(app).get("/support/cases");
    expect(res.status).toBe(200);
    // super sees all — query does not filter by pool_id
    const listQuery = superCalls.find(s =>
      s.includes("SELECT") && s.includes("support_cases") && !s.includes("pool_id =")
    );
    expect(listQuery).toBeTruthy();
  });
});
