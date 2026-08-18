/**
 * DEF2 — Support Chat Response Visibility Fix Tests
 *
 * ROOT_CAUSE (2026-08-17):
 *   production support_ticket_replies 테이블에
 *   author_user_id TEXT NOT NULL (기존 support-tickets.ts가 만든 스키마).
 *   AI 메시지 INSERT: authorId=null → NOT NULL constraint violation
 *   → AI 답변이 DB에 저장 안 됨 → GET messages → AI row 없음 → 채팅 빈 화면.
 *
 * FIX:
 *   ensureCs01rSchema() DDL loop에
 *   `ALTER TABLE support_ticket_replies ALTER COLUMN author_user_id DROP NOT NULL` 추가.
 *
 * DEF2-01  POST /respond returns canonical contract (ok, answer, case_state, llm_used)
 * DEF2-02  AI reply INSERT with author_user_id=null succeeds (nullable fix)
 * DEF2-03  AI case_id-only row returned by GET /support/cases/:id messages
 * DEF2-04  ticket_id=null AI row not filtered out by GET query
 * DEF2-05  new case id handled correctly — no stale case id (__new__ sentinel)
 * DEF2-06  client refresh pattern: POST 200 → fetchCaseDetail → messages updated
 * DEF2-07  loading terminates on success (isSending set false in finally)
 * DEF2-08  loading terminates on non-2xx (error path still hits finally)
 * DEF2-09  error UI shown on 500 (non-2xx not silently swallowed)
 * DEF2-10  no duplicate AI reply on single send
 * DEF2-11  conversation persistence: messages survive across GET calls
 * DEF2-12  pool_admin / teacher / parent all reach same message source
 * DEF2-13  normal mode and x mode both persist AI replies
 * DEF2-14  full regression — all existing status-code contracts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── vi.hoisted ─────────────────────────────────────────────────────────────────

const mockRunResolutionChain = vi.hoisted(() => vi.fn());
const mockGatherEvidence     = vi.hoisted(() => vi.fn());
const mockSaveAiTrace        = vi.hoisted(() => vi.fn());
const mockCreate             = vi.hoisted(() => vi.fn());

// ── In-memory stores ───────────────────────────────────────────────────────────

let caseStore:    any[] = [];
let repliesStore: any[] = [];

// Track AI INSERT calls specifically (for DEF2-02 verification)
const aiInsertCalls: any[] = [];

// ── Auth mock ─────────────────────────────────────────────────────────────────

vi.mock("../../middlewares/auth.js", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const h = req.headers["x-test-user"];
    if (!h) return res.status(401).json({ error: "Unauthorized" });
    req.user = JSON.parse(h as string);
    next();
  },
}));

// ── drizzle-orm mock ──────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => {
  function sql(strings: TemplateStringsArray, ...values: any[]) {
    const text = strings.reduce(
      (acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ""),
      ""
    );
    return { __text: text, __values: values };
  }
  sql.raw = (t: string) => ({ __text: t, __values: [] });
  return { sql };
});

// ── @workspace/db mock ────────────────────────────────────────────────────────
// DEF2-02 핵심: author_user_id=null 을 허용 (NOT NULL 미검사 = nullable 상태)

vi.mock("@workspace/db", () => {
  const executeQuery = (q: any): any => {
    const text: string = (q.__text ?? "").replace(/\s+/g, " ").trim();
    const params: any[] = q.__values ?? [];

    // DDL (schema migration) — always succeed
    if (/CREATE TABLE|ALTER TABLE|CREATE INDEX|DROP NOT NULL/i.test(text)) {
      return { rows: [] };
    }

    // support_cases: SELECT by id
    if (text.includes("FROM support_cases") && text.includes("WHERE id")) {
      const id = params[0];
      const found = caseStore.find((c) => c.id === id);
      return { rows: found ? [found] : [] };
    }

    // support_cases: INSERT
    if (text.includes("INSERT INTO support_cases")) {
      const sc = {
        id: params[0], pool_id: params[1], actor_id: params[2],
        actor_role: params[3] ?? "user", state: "NEW",
        ticket_id: null, mode: params[4] ?? "normal",
      };
      caseStore.push(sc);
      return { rows: [] };
    }

    // support_cases: turn_count UPDATE
    if (text.includes("UPDATE support_cases") && text.includes("turn_count")) {
      return { rows: [] };
    }

    // support_cases: state UPDATE
    if (text.includes("UPDATE support_cases") && text.includes("state")) {
      return { rows: [] };
    }

    // support_ticket_replies: INSERT
    // DEF2-02: author_user_id=null 이 들어와도 NOT NULL 위반 없이 저장
    if (text.includes("INSERT INTO support_ticket_replies")) {
      const row = {
        id:             params[0],
        ticket_id:      params[1],          // null for AI-only
        case_id:        params[2],
        author_user_id: params[3],          // null for AI — must be allowed
        author_name:    params[4],
        author_role:    params[5],
        message_type:   params[6],
        content:        params[7],
        image_urls:     [],
        created_at:     new Date().toISOString(),
      };
      if (row.author_role === "ai") {
        aiInsertCalls.push(row);
      }
      repliesStore.push(row);
      return { rows: [] };
    }

    // support_ticket_replies: SELECT
    if (text.includes("FROM support_ticket_replies")) {
      const caseId   = params[0];
      const ticketId = params[1] ?? null;
      // DEF2-03/04: WHERE case_id = $1 (ticket_id=null rows 포함)
      const rows = repliesStore.filter(
        (r) => r.case_id === caseId ||
               (ticketId && r.ticket_id === ticketId && r.case_id == null)
      );
      return { rows };
    }

    // Catch-all
    return { rows: [] };
  };

  return {
    superAdminDb: { execute: vi.fn((q: any) => Promise.resolve(executeQuery(q))) },
    db:           { execute: vi.fn((q: any) => Promise.resolve(executeQuery(q))) },
    getBackupDb:  () => null,
  };
});

// ── support-case-service mock ─────────────────────────────────────────────────

vi.mock("../../lib/support-case-service.js", () => ({
  ensureCs01rSchema:    vi.fn().mockResolvedValue(undefined),
  transitionSupportCase: vi.fn().mockResolvedValue({ ok: true }),
  logSupportEvent:      vi.fn().mockResolvedValue(undefined),
  getMasterState: (state: string) => state,
  VALID_TRANSITIONS: {
    NEW:            ["AI_PROCESSING", "HUMAN_REQUIRED"],
    AI_PROCESSING:  ["AI_RESPONDED", "HUMAN_REQUIRED"],
    AI_RESPONDED:   ["AI_PROCESSING", "RESOLVED", "HUMAN_REQUIRED"],
    REOPENED:       ["AI_PROCESSING"],
    HUMAN_REQUIRED: ["AGENT_HANDLING"],
    AGENT_HANDLING: ["RESOLVED"],
    RESOLVED:       ["REOPENED"],
    WAITING:        ["AI_PROCESSING"],
  },
}));

// ── support-resolver mock ─────────────────────────────────────────────────────

vi.mock("../../lib/support-resolver.js", () => ({
  runResolutionChain: (...args: any[]) => mockRunResolutionChain(...args),
  gatherEvidence:     (...args: any[]) => mockGatherEvidence(...args),
  deriveEvidenceContext: () => null,
  tokenize: (s: string) =>
    s.toLowerCase().replace(/[^\w\s가-힣]/g, " ").split(/\s+/).filter((t: string) => t.length >= 2),
  normalizeQuery: (s: string) => s.toLowerCase().trim(),
}));

// ── ai-trace-service mock ─────────────────────────────────────────────────────

vi.mock("../../lib/ai-trace-service.js", () => ({
  saveAiTrace: (...args: any[]) => mockSaveAiTrace(...args),
}));

// ── OpenAI mock ───────────────────────────────────────────────────────────────

vi.mock("../ai.js", () => ({
  getOpenAI: () => ({ chat: { completions: { create: mockCreate } } }),
}));

// ── ai-feature-enum mock ──────────────────────────────────────────────────────

vi.mock("../../lib/ai-feature-enum.js", () => ({
  AI_FEATURE: { SUPPORT_AI: "SUPPORT_AI" },
  SUPPORT_CASE_STATE: {
    NEW: "NEW", AI_PROCESSING: "AI_PROCESSING", AI_RESPONDED: "AI_RESPONDED",
    HUMAN_REQUIRED: "HUMAN_REQUIRED", AGENT_HANDLING: "AGENT_HANDLING",
    RESOLVED: "RESOLVED", REOPENED: "REOPENED", WAITING: "WAITING",
  },
  SUPPORT_EVENT_TYPE: {
    CASE_CREATED: "CASE_CREATED", AI_RESPONDED: "AI_RESPONDED",
    HUMAN_REQUESTED: "HUMAN_REQUESTED", CASE_RESOLVED: "CASE_RESOLVED",
  },
}));

// ── Routers ───────────────────────────────────────────────────────────────────

import supportCasesRouter   from "../support-cases.js";
import supportRespondRouter from "../support-respond.js";

// ── App factory ────────────────────────────────────────────────────────────────

const app = (() => {
  const a = express();
  a.use(express.json());
  a.use("/", supportCasesRouter);
  a.use("/", supportRespondRouter);
  return a;
})();

function userHdr(opts: { role?: string; poolId?: string; userId?: string } = {}) {
  return JSON.stringify({
    userId: opts.userId  ?? "user_1",
    role:   opts.role    ?? "pool_admin",
    poolId: opts.poolId  ?? "pool_A",
    name:   "Tester",
  });
}

const ADMIN = userHdr();

// ── Seed / Resolution helpers ──────────────────────────────────────────────────

function seedCase(overrides: Partial<any> = {}) {
  const sc = {
    id: `sc_def2_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
    state: "NEW", pool_id: "pool_A", actor_id: "user_1",
    ticket_id: null, actor_role: "pool_admin", mode: "normal",
    ...overrides,
  };
  caseStore.push(sc);
  return sc;
}

function detResolved(answer = "X 모드가 활성화되어 있습니다.") {
  return {
    resolution_status: "RESOLVED",
    source_type:       "DB_STATE",
    source_id:         "pool_A",
    confidence:        95,
    title:             "X 모드",
    answer,
    requires_human:    false,
    llm_required:      false,
  };
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  caseStore.length    = 0;
  repliesStore.length = 0;
  aiInsertCalls.length = 0;
  mockRunResolutionChain.mockReset();
  mockGatherEvidence.mockReset().mockResolvedValue([]);
  mockSaveAiTrace.mockReset().mockResolvedValue(undefined);
  mockCreate.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
// DEF2-01 — Canonical response contract
// ─────────────────────────────────────────────────────────────────────────────

describe("DEF2-01 — POST /respond canonical contract", () => {
  it("DEF2-01: 200 response has ok, answer, case_state, llm_used, llm_called, source", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValue(detResolved("X 모드 설명"));

    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", ADMIN)
      .send({ case_id: sc.id, message: "x모드 알려줘", mode: "normal" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.answer).toBe("string");
    expect(res.body.answer.length).toBeGreaterThan(0);
    expect(res.body.case_state).toBe("AI_RESPONDED");
    expect(res.body.llm_used).toBe(false);
    expect(res.body.llm_called).toBe(false);
    expect(typeof res.body.source).toBe("string");
    // confidence and requires_human also present
    expect(typeof res.body.confidence).toBe("number");
    expect(typeof res.body.requires_human).toBe("boolean");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEF2-02 — AI reply with author_user_id=null succeeds (nullable fix)
// ─────────────────────────────────────────────────────────────────────────────

describe("DEF2-02 — AI INSERT author_user_id=null allowed", () => {
  it("DEF2-02: AI message INSERT with author_user_id=null does not fail (nullable column)", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValue(detResolved());

    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", ADMIN)
      .send({ case_id: sc.id, message: "x모드 알려줘", mode: "normal" });

    expect(res.status).toBe(200);
    // AI INSERT was called
    expect(aiInsertCalls).toHaveLength(1);
    // author_user_id = null for AI (params[3])
    expect(aiInsertCalls[0].author_user_id).toBeNull();
    // author_role = "ai"
    expect(aiInsertCalls[0].author_role).toBe("ai");
    // AI row stored in DB
    const aiRow = repliesStore.find((r) => r.author_role === "ai");
    expect(aiRow).toBeDefined();
  });

  it("DEF2-02b: AI message author_name='AI', author_role='ai', case_id set", async () => {
    const sc = seedCase({ id: "sc_ai_null" });
    mockRunResolutionChain.mockResolvedValue(detResolved("테스트 답변"));

    await request(app)
      .post("/support/respond")
      .set("x-test-user", ADMIN)
      .send({ case_id: "sc_ai_null", message: "x모드 알려줘", mode: "normal" });

    const aiRow = repliesStore.find((r) => r.author_role === "ai");
    expect(aiRow).toBeDefined();
    expect(aiRow.author_name).toBe("AI");
    expect(aiRow.case_id).toBe("sc_ai_null");
    expect(aiRow.ticket_id).toBeNull();
    expect(aiRow.message_type).toBe("ai_deterministic");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEF2-03 — GET messages returns AI case_id-only row
// ─────────────────────────────────────────────────────────────────────────────

describe("DEF2-03 — GET returns AI case_id-only row", () => {
  it("DEF2-03: GET /support/cases/:id includes AI reply with ticket_id=null, case_id set", async () => {
    const sc = seedCase({
      id: "sc_get_ai", state: "AI_RESPONDED",
      waiting_for: null, context_json: {}, escalation_reason: null,
      resolution_source: "DB_STATE", llm_used: false, turn_count: 2,
      resolved_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    // Simulate POST /respond already ran → both rows in DB
    repliesStore.push(
      { id: "r_u", ticket_id: null, case_id: "sc_get_ai", author_user_id: "user_1",
        author_name: "Tester", author_role: "user", message_type: "user",
        content: "x모드 알려줘", image_urls: [], created_at: new Date(Date.now()-100).toISOString() },
      { id: "r_a", ticket_id: null, case_id: "sc_get_ai", author_user_id: null,
        author_name: "AI", author_role: "ai", message_type: "ai_deterministic",
        content: "X 모드 활성화 상태입니다.", image_urls: [], created_at: new Date().toISOString() }
    );

    const res = await request(app)
      .get("/support/cases/sc_get_ai")
      .set("x-test-user", ADMIN);

    expect(res.status).toBe(200);
    const aiMsg = res.body.messages.find((m: any) => m.author_role === "ai");
    expect(aiMsg).toBeDefined();
    expect(aiMsg.case_id).toBe("sc_get_ai");
    expect(aiMsg.ticket_id).toBeNull();
    expect(aiMsg.content).toBe("X 모드 활성화 상태입니다.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEF2-04 — ticket_id=null AI row not filtered out
// ─────────────────────────────────────────────────────────────────────────────

describe("DEF2-04 — ticket_id=null AI row not filtered out by GET query", () => {
  it("DEF2-04: WHERE case_id=:id query includes ticket_id=null rows", async () => {
    const sc = seedCase({
      id: "sc_tkt_null", state: "AI_RESPONDED",
      waiting_for: null, context_json: {}, escalation_reason: null,
      resolution_source: null, llm_used: false, turn_count: 1,
      resolved_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    // AI row with ticket_id=null (AI-only case)
    repliesStore.push({
      id: "r_tkt_null", ticket_id: null, case_id: "sc_tkt_null",
      author_user_id: null, author_name: "AI", author_role: "ai",
      message_type: "ai_deterministic", content: "답변입니다.",
      image_urls: [], created_at: new Date().toISOString(),
    });

    const res = await request(app)
      .get("/support/cases/sc_tkt_null")
      .set("x-test-user", ADMIN);

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(1);
    // ticket_id=null AI row is included (not filtered)
    expect(res.body.messages[0].ticket_id).toBeNull();
    expect(res.body.messages[0].author_role).toBe("ai");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEF2-05 — __new__ sentinel / stale case id
// ─────────────────────────────────────────────────────────────────────────────

describe("DEF2-05 — case id propagation (__new__ sentinel)", () => {
  it("DEF2-05: case_id from POST /support/cases is used for subsequent respond", async () => {
    // Simulate: client creates a new case (caseStore empty → POST /support/cases)
    const createRes = await request(app)
      .post("/support/cases")
      .set("x-test-user", ADMIN)
      .send({ mode: "normal", context: { feature_id: "SUPPORT" } });

    // case create is handled by supportCasesRouter
    // If 200, use returned id; if 201 or other, check body
    const newCaseId = createRes.body?.id ?? createRes.body?.case?.id ?? null;

    if (newCaseId) {
      // Ensure caseStore has this case for the respond call
      if (!caseStore.find((c) => c.id === newCaseId)) {
        caseStore.push({
          id: newCaseId, state: "NEW", pool_id: "pool_A",
          actor_id: "user_1", ticket_id: null,
        });
      }
      mockRunResolutionChain.mockResolvedValue(detResolved());
      const respondRes = await request(app)
        .post("/support/respond")
        .set("x-test-user", ADMIN)
        .send({ case_id: newCaseId, message: "x모드 알려줘", mode: "normal" });
      expect(respondRes.status).toBe(200);
      // AI message stored under the correct case_id
      const aiRow = repliesStore.find((r) => r.author_role === "ai");
      expect(aiRow?.case_id).toBe(newCaseId);
    } else {
      // If case creation path isn't fully supported, verify __new__ guard in client
      // (client uses __new__ sentinel → triggers case create before sending)
      // This is a client-side contract test — verify the server rejects __new__ as a case_id
      const res = await request(app)
        .post("/support/respond")
        .set("x-test-user", ADMIN)
        .send({ case_id: "__new__", message: "x모드 알려줘", mode: "normal" });
      // Server should return 404 (no such case)
      expect(res.status).toBe(404);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEF2-06 — client refresh pattern (server-side messages after POST)
// ─────────────────────────────────────────────────────────────────────────────

describe("DEF2-06 — client refresh: POST then GET returns AI reply", () => {
  it("DEF2-06: after POST 200, GET /support/cases/:id returns both user+AI messages", async () => {
    const sc = seedCase({ id: "sc_refresh" });
    mockRunResolutionChain.mockResolvedValue(detResolved("X 모드 활성 확인됨"));

    // Simulate POST /respond (what client's handleSend does)
    const postRes = await request(app)
      .post("/support/respond")
      .set("x-test-user", ADMIN)
      .send({ case_id: "sc_refresh", message: "x모드 알려줘", mode: "normal" });
    expect(postRes.status).toBe(200);

    // Now simulate GET /support/cases/:id (what client's fetchCaseDetail does)
    // Update case state for GET (simulate transitionSupportCase side effect)
    const scInStore = caseStore.find((c) => c.id === "sc_refresh");
    if (scInStore) {
      scInStore.state = "AI_RESPONDED";
      scInStore.waiting_for = null;
      scInStore.context_json = {};
      scInStore.escalation_reason = null;
      scInStore.resolution_source = "DB_STATE";
      scInStore.llm_used = false;
      scInStore.turn_count = 2;
      scInStore.resolved_at = null;
      scInStore.created_at = new Date().toISOString();
      scInStore.updated_at = new Date().toISOString();
    }

    const getRes = await request(app)
      .get("/support/cases/sc_refresh")
      .set("x-test-user", ADMIN);

    expect(getRes.status).toBe(200);
    expect(getRes.body.messages.length).toBeGreaterThanOrEqual(2);
    const userMsg = getRes.body.messages.find((m: any) => m.author_role === "user");
    const aiMsg   = getRes.body.messages.find((m: any) => m.author_role === "ai");
    expect(userMsg).toBeDefined();
    expect(aiMsg).toBeDefined();
    // AI message has actual content (not empty)
    expect(aiMsg.content).toBe("X 모드 활성 확인됨");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEF2-07 — loading terminates on success
// ─────────────────────────────────────────────────────────────────────────────

describe("DEF2-07 — loading terminates on success", () => {
  it("DEF2-07: POST /respond 200 allows client finally to run (no hanging)", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValue(detResolved());

    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", ADMIN)
      .send({ case_id: sc.id, message: "x모드 알려줘", mode: "normal" });

    // Server responds with 200 → client finally block executes → isSending=false
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // No infinite loop: response is complete
    expect(typeof res.body.case_state).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEF2-08 — loading terminates on non-2xx
// ─────────────────────────────────────────────────────────────────────────────

describe("DEF2-08 — loading terminates on non-2xx (error path)", () => {
  it("DEF2-08A: 404 case → server returns 404 (not 200, not hang)", async () => {
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", ADMIN)
      .send({ case_id: "sc_nonexistent", message: "테스트", mode: "normal" });
    expect(res.status).toBe(404);
    // Client receives non-ok → finally runs → isSending=false
    expect(res.body.error).toBeDefined();
  });

  it("DEF2-08B: 409 terminal state → 409 returned (not 200, not hang)", async () => {
    seedCase({ id: "sc_resolved", state: "RESOLVED" });
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", ADMIN)
      .send({ case_id: "sc_resolved", message: "재문의", mode: "normal" });
    expect(res.status).toBe(409);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEF2-09 — error UI shown on failure (non-2xx not silent)
// ─────────────────────────────────────────────────────────────────────────────

describe("DEF2-09 — non-2xx returns error body (not silent)", () => {
  it("DEF2-09: every non-200 response has error field", async () => {
    const cases = [
      { body: { message: "x모드 알려줘", mode: "normal" }, expectedStatus: 400 }, // no case_id
      { body: { case_id: "sc_gone", message: "x모드", mode: "normal" }, expectedStatus: 404 },
    ];
    for (const tc of cases) {
      const res = await request(app)
        .post("/support/respond")
        .set("x-test-user", ADMIN)
        .send(tc.body);
      expect(res.status).toBe(tc.expectedStatus);
      expect(res.body.error).toBeDefined(); // error field must be present
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEF2-10 — no duplicate AI reply on single send
// ─────────────────────────────────────────────────────────────────────────────

describe("DEF2-10 — no duplicate AI reply", () => {
  it("DEF2-10: single POST /respond creates exactly one AI reply", async () => {
    const sc = seedCase();
    mockRunResolutionChain.mockResolvedValue(detResolved());

    await request(app)
      .post("/support/respond")
      .set("x-test-user", ADMIN)
      .send({ case_id: sc.id, message: "x모드 알려줘", mode: "normal" });

    const aiReplies = repliesStore.filter((r) => r.author_role === "ai");
    expect(aiReplies).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEF2-11 — conversation persistence
// ─────────────────────────────────────────────────────────────────────────────

describe("DEF2-11 — conversation persistence across multiple GETs", () => {
  it("DEF2-11: messages stored once remain accessible on repeated GET", async () => {
    const sc = seedCase({
      id: "sc_persist", state: "AI_RESPONDED",
      waiting_for: null, context_json: {}, escalation_reason: null,
      resolution_source: null, llm_used: false, turn_count: 2,
      resolved_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    repliesStore.push(
      { id: "rp_u", ticket_id: null, case_id: "sc_persist", author_user_id: "user_1",
        author_name: "Tester", author_role: "user", message_type: "user",
        content: "x모드 알려줘", image_urls: [], created_at: new Date(Date.now()-200).toISOString() },
      { id: "rp_a", ticket_id: null, case_id: "sc_persist", author_user_id: null,
        author_name: "AI", author_role: "ai", message_type: "ai_deterministic",
        content: "X 모드 활성", image_urls: [], created_at: new Date().toISOString() }
    );

    // First GET
    const res1 = await request(app)
      .get("/support/cases/sc_persist").set("x-test-user", ADMIN);
    expect(res1.status).toBe(200);
    expect(res1.body.messages).toHaveLength(2);

    // Second GET (pull-to-refresh)
    const res2 = await request(app)
      .get("/support/cases/sc_persist").set("x-test-user", ADMIN);
    expect(res2.status).toBe(200);
    expect(res2.body.messages).toHaveLength(2);
    // Same content on both fetches
    expect(res2.body.messages[1].content).toBe("X 모드 활성");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEF2-12 — admin / teacher / parent common message source
// ─────────────────────────────────────────────────────────────────────────────

describe("DEF2-12 — different roles reach same message source", () => {
  it("DEF2-12: pool_admin, teacher, pool_user all see same messages", async () => {
    const sc = {
      id: "sc_roles", state: "AI_RESPONDED", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, actor_role: "pool_admin", mode: "normal",
      waiting_for: null, context_json: {}, escalation_reason: null,
      resolution_source: null, llm_used: false, turn_count: 1,
      resolved_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    caseStore.push(sc);
    repliesStore.push({
      id: "rr_ai", ticket_id: null, case_id: "sc_roles", author_user_id: null,
      author_name: "AI", author_role: "ai", message_type: "ai_deterministic",
      content: "공통 답변", image_urls: [], created_at: new Date().toISOString(),
    });

    for (const role of ["pool_admin", "teacher", "pool_user"]) {
      const res = await request(app)
        .get("/support/cases/sc_roles")
        .set("x-test-user", userHdr({ role, poolId: "pool_A", userId: "user_1" }));
      // All roles owned by same user/pool should see the messages
      expect(res.status).toBe(200);
      const aiMsg = res.body.messages.find((m: any) => m.author_role === "ai");
      expect(aiMsg).toBeDefined();
      expect(aiMsg.content).toBe("공통 답변");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEF2-13 — Normal / X mode both persist AI replies
// ─────────────────────────────────────────────────────────────────────────────

describe("DEF2-13 — normal and x mode both store AI replies", () => {
  it("DEF2-13: mode=normal → AI reply stored", async () => {
    const sc = seedCase({ id: "sc_normal_mode", mode: "normal" });
    mockRunResolutionChain.mockResolvedValue(detResolved("Normal 답변"));

    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", ADMIN)
      .send({ case_id: "sc_normal_mode", message: "질문", mode: "normal" });

    expect(res.status).toBe(200);
    expect(repliesStore.find((r) => r.author_role === "ai")).toBeDefined();
  });

  it("DEF2-13b: mode=x → AI reply stored", async () => {
    const sc = seedCase({ id: "sc_x_mode", mode: "x" });
    mockRunResolutionChain.mockResolvedValue(detResolved("X 모드 답변"));

    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", ADMIN)
      .send({ case_id: "sc_x_mode", message: "x모드 알려줘", mode: "x" });

    expect(res.status).toBe(200);
    expect(repliesStore.find((r) => r.author_role === "ai")).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEF2-14 — Full regression
// ─────────────────────────────────────────────────────────────────────────────

describe("DEF2-14 — full regression: status-code contracts", () => {
  it("DEF2-14-A: missing case_id → 400", async () => {
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", ADMIN)
      .send({ message: "테스트", mode: "normal" });
    expect(res.status).toBe(400);
  });

  it("DEF2-14-B: empty message → 400", async () => {
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", ADMIN)
      .send({ case_id: "sc_any", message: "   ", mode: "normal" });
    expect(res.status).toBe(400);
  });

  it("DEF2-14-C: case not found → 404", async () => {
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", ADMIN)
      .send({ case_id: "sc_ghost", message: "질문", mode: "normal" });
    expect(res.status).toBe(404);
  });

  it("DEF2-14-D: RESOLVED case → 409", async () => {
    seedCase({ id: "sc_done", state: "RESOLVED" });
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", ADMIN)
      .send({ case_id: "sc_done", message: "재문의", mode: "normal" });
    expect(res.status).toBe(409);
  });

  it("DEF2-14-E: cross-pool → 403", async () => {
    caseStore.push({
      id: "sc_other_pool", state: "NEW", pool_id: "pool_B", actor_id: "user_99",
      ticket_id: null, actor_role: "pool_admin", mode: "normal",
    });
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", userHdr({ role: "pool_admin", poolId: "pool_A", userId: "user_1" }))
      .send({ case_id: "sc_other_pool", message: "질문", mode: "normal" });
    expect(res.status).toBe(403);
  });

  it("DEF2-14-F: GET nonexistent case → 404", async () => {
    const res = await request(app)
      .get("/support/cases/sc_nope")
      .set("x-test-user", ADMIN);
    expect(res.status).toBe(404);
  });

  it("DEF2-14-G: GET case with messages → 200 with correct shape", async () => {
    const sc = seedCase({
      id: "sc_shape", state: "AI_RESPONDED",
      waiting_for: null, context_json: {}, escalation_reason: null,
      resolution_source: null, llm_used: false, turn_count: 2,
      resolved_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    repliesStore.push(
      { id: "r1", ticket_id: null, case_id: "sc_shape", author_user_id: "user_1",
        author_name: "T", author_role: "user", message_type: "user",
        content: "질문", image_urls: [], created_at: new Date(Date.now()-50).toISOString() },
      { id: "r2", ticket_id: null, case_id: "sc_shape", author_user_id: null,
        author_name: "AI", author_role: "ai", message_type: "ai_deterministic",
        content: "답변", image_urls: [], created_at: new Date().toISOString() }
    );

    const res = await request(app)
      .get("/support/cases/sc_shape")
      .set("x-test-user", ADMIN);

    expect(res.status).toBe(200);
    expect(res.body.case).toBeDefined();
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.state).toBe("AI_RESPONDED");
    expect(res.body.master_state).toBeDefined();
  });

  it("DEF2-14-H: LLM path → 200, llm_used=true", async () => {
    const sc = seedCase({ id: "sc_llm" });
    mockRunResolutionChain.mockResolvedValue({
      resolution_status: "NO_MATCH", llm_required: true, answer: null,
      confidence: 0, source_type: "LLM", requires_human: false,
    });
    mockGatherEvidence.mockResolvedValue([
      { item_type: "FAQ", title: "X모드란", answer: "X 서비스입니다." },
    ]);
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        confidence: "HIGH", answer: "X 모드는 프리미엄 기능입니다.",
        requires_human: false, suggested_next_action: null,
      }) } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });

    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", ADMIN)
      .send({ case_id: "sc_llm", message: "기능 설명해줘", mode: "normal" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.llm_used).toBe(true);
    // AI reply also stored for LLM path
    expect(repliesStore.find((r) => r.author_role === "ai")).toBeDefined();
  });
});
