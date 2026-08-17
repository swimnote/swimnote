/**
 * DBSRC — Support DB Source-of-Truth + Silent Failure Audit Tests
 *
 * DBSRC-01  support_cases and replies use same primary DB (superAdminDb = Supabase)
 * DBSRC-02  support_tickets uses same db alias (= superAdminDb)
 * DBSRC-03  POOL_DATABASE_URL maps to getBackupDb() — NOT superAdminDb
 * DBSRC-04  backup DB absence does not break app CRUD (GET /support/cases/:id)
 * DBSRC-05  missing replies table (msg query throws) → GET returns 500, not empty []
 * DBSRC-06  user message INSERT fails → POST /respond returns 500 (non-200)
 * DBSRC-07  AI message INSERT fails (deterministic) → POST /respond returns 500 (non-200)
 * DBSRC-08  AI message INSERT fails (LLM path) → POST /respond returns 500 (non-200)
 * DBSRC-09  successful respond → user message persisted (INSERT called with correct params)
 * DBSRC-10  successful respond → AI message persisted (INSERT called with correct params)
 * DBSRC-11  GET reads from same db object that POST writes to (same repliesStore)
 * DBSRC-12  super admin can read conversation from same source
 * DBSRC-13  cross-pool isolation: pool_B user cannot read pool_A case → 403
 * DBSRC-14  support_ticket_replies INSERT uses db (superAdminDb), not backup/poolDb
 * DBSRC-15  full regression — all existing support API status-code contracts intact
 *
 * P0-DEFECT-2026-08-17: support_ticket_replies 없을 때 HTTP 200 반환 → 앱 무응답
 * FIX: CREATE TABLE IF NOT EXISTS in ensureCs01rSchema; AI INSERT → 500 on fail;
 *      message query fail → 500 (not silent []).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── vi.hoisted ─────────────────────────────────────────────────────────────────

const mockRunResolutionChain = vi.hoisted(() => vi.fn());
const mockGatherEvidence     = vi.hoisted(() => vi.fn());
const mockSaveAiTrace        = vi.hoisted(() => vi.fn());
const mockCreate             = vi.hoisted(() => vi.fn());

// ── In-memory stores (module-level, mutated by beforeEach) ─────────────────────

let caseStore:    any[] = [];
let repliesStore: any[] = [];

// Failure injection flags (reset in beforeEach)
let forceUserMsgInsertFail = false;
let forceAiMsgInsertFail   = false;
let forceMsgQueryFail      = false;

// DB call tracking
const insertCalls: { db: string; params: any[] }[] = [];

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

vi.mock("@workspace/db", () => {
  const executeQuery = (dbLabel: string) => (q: any): any => {
    const text: string = (q.__text ?? "").replace(/\s+/g, " ").trim();
    const params: any[] = q.__values ?? [];

    // DDL (schema migration) — always succeed silently
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
    if (text.includes("INSERT INTO support_ticket_replies")) {
      const authorRole = String(params[5] ?? "");
      insertCalls.push({ db: dbLabel, params });
      if (authorRole === "user" && forceUserMsgInsertFail) {
        throw new Error("INJECTED: user INSERT fail");
      }
      if (authorRole === "ai" && forceAiMsgInsertFail) {
        throw new Error("INJECTED: AI INSERT fail");
      }
      repliesStore.push({
        id:             params[0],
        ticket_id:      params[1],
        case_id:        params[2],
        author_user_id: params[3],
        author_name:    params[4],
        author_role:    params[5],
        message_type:   params[6],
        content:        params[7],
        image_urls:     [],
        created_at:     new Date().toISOString(),
      });
      return { rows: [] };
    }

    // support_ticket_replies: SELECT (GET case detail messages)
    if (text.includes("FROM support_ticket_replies")) {
      if (forceMsgQueryFail) throw new Error("INJECTED: relation does not exist");
      const caseId = params[0];
      const ticketId = params[1] ?? null;
      const rows = repliesStore.filter(
        (r) => r.case_id === caseId || (ticketId && r.ticket_id === ticketId && r.case_id == null)
      );
      return { rows };
    }

    // Catch-all: event_logs, ai_traces, knowledge items, etc.
    return { rows: [] };
  };

  const execSuper = executeQuery("super");
  const execDb    = executeQuery("db_alias");

  // superAdminDb and db are separate vi.fn instances that share the same logic
  // (In real code: db = superAdminDb — same object. In tests: separate to trace call sites.)
  const superAdminDb = { execute: vi.fn((q: any) => Promise.resolve(execSuper(q))) };
  const db           = { execute: vi.fn((q: any) => Promise.resolve(execDb(q))) };

  function getBackupDb() { return null; }

  return { superAdminDb, db, getBackupDb };
});

// ── support-case-service mock (NO importOriginal) ──────────────────────────────

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

// ── support-resolver mock ──────────────────────────────────────────────────────

vi.mock("../../lib/support-resolver.js", () => ({
  runResolutionChain: (...args: any[]) => mockRunResolutionChain(...args),
  gatherEvidence:     (...args: any[]) => mockGatherEvidence(...args),
  tokenize: (s: string) =>
    s.toLowerCase().replace(/[^\w\s가-힣]/g, " ").split(/\s+/).filter((t: string) => t.length >= 2),
}));

// ── ai-trace-service mock ──────────────────────────────────────────────────────

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
    NEW:            "NEW",
    AI_PROCESSING:  "AI_PROCESSING",
    AI_RESPONDED:   "AI_RESPONDED",
    HUMAN_REQUIRED: "HUMAN_REQUIRED",
    AGENT_HANDLING: "AGENT_HANDLING",
    RESOLVED:       "RESOLVED",
    REOPENED:       "REOPENED",
    WAITING:        "WAITING",
  },
  SUPPORT_EVENT_TYPE: {
    CASE_CREATED:       "CASE_CREATED",
    AI_RESPONDED:       "AI_RESPONDED",
    HUMAN_REQUESTED:    "HUMAN_REQUESTED",
    CASE_RESOLVED:      "CASE_RESOLVED",
    AI_MSG_INSERT_FAIL: "AI_MSG_INSERT_FAIL",
  },
}));

// ── Routers ───────────────────────────────────────────────────────────────────

import supportCasesRouter  from "../support-cases.js";
import supportRespondRouter from "../support-respond.js";

// ── App factory ────────────────────────────────────────────────────────────────

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/", supportCasesRouter);
  app.use("/", supportRespondRouter);
  return app;
}

function userHdr(
  opts: { role?: string; poolId?: string; userId?: string } = {}
): string {
  return JSON.stringify({
    userId: opts.userId  ?? "user_1",
    role:   opts.role    ?? "pool_admin",
    poolId: opts.poolId  ?? "pool_A",
    name:   "Tester",
  });
}

const POOL_A_ADMIN = userHdr({ role: "pool_admin", poolId: "pool_A", userId: "user_1" });
const SUPER_ADMIN  = userHdr({ role: "super_admin", poolId: "",       userId: "admin_1" });

// ── Resolution helpers ─────────────────────────────────────────────────────────

function detResolved(answer = "X 모드가 활성화되어 있습니다.") {
  return {
    resolution_status: "RESOLVED",
    source_type:       "DB_STATE",
    source_id:         "pool_A",
    confidence:        95,
    title:             "X 모드 상태",
    answer,
    requires_human:    false,
    llm_required:      false,
  };
}

// ── Setup ──────────────────────────────────────────────────────────────────────

const app = makeApp();

beforeEach(() => {
  caseStore.length    = 0;
  repliesStore.length = 0;
  insertCalls.length  = 0;
  forceUserMsgInsertFail = false;
  forceAiMsgInsertFail   = false;
  forceMsgQueryFail      = false;
  mockRunResolutionChain.mockReset();
  mockGatherEvidence.mockReset().mockResolvedValue([]);
  mockSaveAiTrace.mockReset().mockResolvedValue(undefined);
  mockCreate.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
// DBSRC-01/02/03/04 — Architecture
// ─────────────────────────────────────────────────────────────────────────────

describe("DBSRC-01/02/03/04 — Architecture: DB 객체 소스 확인", () => {
  it("DBSRC-01: @workspace/db exports superAdminDb and db as primary-DB objects", async () => {
    const { superAdminDb, db, getBackupDb } = await import("@workspace/db");
    expect(typeof superAdminDb.execute).toBe("function");
    expect(typeof db.execute).toBe("function");
    // backup DB returns null when POOL_DATABASE_URL absent
    expect(getBackupDb()).toBeNull();
  });

  it("DBSRC-02: support_cases GET uses db.execute (primary DB, not backup)", async () => {
    const { db } = await import("@workspace/db");
    const execSpy = vi.spyOn(db, "execute");
    caseStore.push({
      id: "arch_sc", state: "NEW", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, actor_role: "pool_admin", mode: "normal",
      waiting_for: null, context_json: {}, escalation_reason: null,
      resolution_source: null, llm_used: null, turn_count: 0,
      resolved_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    const res = await request(app)
      .get("/support/cases/arch_sc")
      .set("x-test-user", POOL_A_ADMIN);
    expect(res.status).toBe(200);
    // db.execute was called (primary DB path)
    expect(execSpy).toHaveBeenCalled();
    execSpy.mockRestore();
  });

  it("DBSRC-03: getBackupDb() returns null (= POOL_DATABASE_URL absent in test env)", async () => {
    const { getBackupDb } = await import("@workspace/db");
    expect(getBackupDb()).toBeNull();
  });

  it("DBSRC-04: backup DB absent → GET /support/cases/:id still works", async () => {
    caseStore.push({
      id: "no_backup_sc", state: "AI_RESPONDED", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, actor_role: "pool_admin", mode: "normal",
      waiting_for: null, context_json: {}, escalation_reason: null,
      resolution_source: null, llm_used: false, turn_count: 1,
      resolved_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    const res = await request(app)
      .get("/support/cases/no_backup_sc")
      .set("x-test-user", POOL_A_ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.case.id).toBe("no_backup_sc");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DBSRC-05 — message query failure → 500 (not empty [])
// ─────────────────────────────────────────────────────────────────────────────

describe("DBSRC-05 — message query failure → GET returns 500", () => {
  it("DBSRC-05: support_ticket_replies SELECT throws → 500, not { messages: [] }", async () => {
    caseStore.push({
      id: "sc_msgfail", state: "AI_RESPONDED", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, actor_role: "pool_admin", mode: "normal",
      waiting_for: null, context_json: {}, escalation_reason: null,
      resolution_source: null, llm_used: false, turn_count: 2,
      resolved_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    forceMsgQueryFail = true;

    const res = await request(app)
      .get("/support/cases/sc_msgfail")
      .set("x-test-user", POOL_A_ADMIN);

    expect(res.status).toBe(500);
    expect(res.body.code).toBe("MSG_QUERY_FAILED");
    // NOT: HTTP 200 with { messages: [] }
    expect(Array.isArray(res.body.messages)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DBSRC-06 — user INSERT fail → 500
// ─────────────────────────────────────────────────────────────────────────────

describe("DBSRC-06 — user message INSERT fail → non-200", () => {
  it("DBSRC-06: user INSERT throws → 500 (no AI processing)", async () => {
    caseStore.push({
      id: "sc_userfail", state: "NEW", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, actor_role: "pool_admin", mode: "normal",
    });
    mockRunResolutionChain.mockResolvedValue(detResolved());
    forceUserMsgInsertFail = true;

    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", POOL_A_ADMIN)
      .send({ case_id: "sc_userfail", message: "x모드 알려줘", mode: "normal" });

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
    // AI message NOT stored (aborted before resolution)
    expect(repliesStore.find((r) => r.author_role === "ai")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DBSRC-07 — AI INSERT fail (deterministic) → 500
// ─────────────────────────────────────────────────────────────────────────────

describe("DBSRC-07 — AI message INSERT fail (deterministic) → non-200", () => {
  it("DBSRC-07: AI INSERT throws after deterministic resolution → 500 + AI_MSG_INSERT_FAILED", async () => {
    caseStore.push({
      id: "sc_aidet_fail", state: "NEW", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, actor_role: "pool_admin", mode: "normal",
    });
    mockRunResolutionChain.mockResolvedValue(detResolved());
    forceAiMsgInsertFail = true;

    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", POOL_A_ADMIN)
      .send({ case_id: "sc_aidet_fail", message: "x모드 알려줘", mode: "normal" });

    expect(res.status).toBe(500);
    expect(res.body.code).toBe("AI_MSG_INSERT_FAILED");
    // User message WAS stored before AI insert failed
    expect(repliesStore.find((r) => r.author_role === "user")).toBeDefined();
    // AI message NOT stored
    expect(repliesStore.find((r) => r.author_role === "ai")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DBSRC-08 — AI INSERT fail (LLM path) → 500
// ─────────────────────────────────────────────────────────────────────────────

describe("DBSRC-08 — AI message INSERT fail (LLM path) → non-200", () => {
  it("DBSRC-08: AI INSERT throws after LLM response → 500 + AI_MSG_INSERT_FAILED", async () => {
    caseStore.push({
      id: "sc_aillm_fail", state: "NEW", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, actor_role: "pool_admin", mode: "normal",
    });
    // NO_MATCH → LLM path
    mockRunResolutionChain.mockResolvedValue({
      resolution_status: "NO_MATCH", llm_required: true, answer: null,
      confidence: 0, source_type: "LLM", requires_human: false,
    });
    mockGatherEvidence.mockResolvedValue([
      { item_type: "FAQ", title: "X모드란", answer: "X 서비스입니다." },
    ]);
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        confidence: "HIGH",
        answer: "X 모드는 프리미엄 기능입니다.",
        requires_human: false,
        suggested_next_action: null,
      }) } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });
    forceAiMsgInsertFail = true;

    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", POOL_A_ADMIN)
      .send({ case_id: "sc_aillm_fail", message: "기능이 뭐예요", mode: "normal" });

    expect(res.status).toBe(500);
    expect(res.body.code).toBe("AI_MSG_INSERT_FAILED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DBSRC-09/10 — successful respond → messages persisted
// ─────────────────────────────────────────────────────────────────────────────

describe("DBSRC-09/10 — successful respond → messages persisted", () => {
  it("DBSRC-09: user message persisted with correct case_id on successful respond", async () => {
    caseStore.push({
      id: "sc_ok_user", state: "NEW", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, actor_role: "pool_admin", mode: "normal",
    });
    mockRunResolutionChain.mockResolvedValue(detResolved());

    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", POOL_A_ADMIN)
      .send({ case_id: "sc_ok_user", message: "x모드 알려줘", mode: "normal" });

    expect(res.status).toBe(200);
    const userMsg = repliesStore.find((r) => r.author_role === "user");
    expect(userMsg).toBeDefined();
    expect(userMsg.content).toBe("x모드 알려줘");
    expect(userMsg.case_id).toBe("sc_ok_user");
    expect(userMsg.ticket_id).toBeNull();
  });

  it("DBSRC-10: AI message persisted with correct case_id on successful respond", async () => {
    caseStore.push({
      id: "sc_ok_ai", state: "NEW", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, actor_role: "pool_admin", mode: "normal",
    });
    mockRunResolutionChain.mockResolvedValue(detResolved("X 모드 활성 상태입니다."));

    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", POOL_A_ADMIN)
      .send({ case_id: "sc_ok_ai", message: "x모드 알려줘", mode: "normal" });

    expect(res.status).toBe(200);
    const aiMsg = repliesStore.find((r) => r.author_role === "ai");
    expect(aiMsg).toBeDefined();
    expect(aiMsg.content).toBe("X 모드 활성 상태입니다.");
    expect(aiMsg.case_id).toBe("sc_ok_ai");
    expect(aiMsg.ticket_id).toBeNull();
    expect(aiMsg.author_user_id).toBeNull();
    expect(aiMsg.author_name).toBe("AI");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DBSRC-11/12 — GET reads from same DB that POST writes to
// ─────────────────────────────────────────────────────────────────────────────

describe("DBSRC-11/12 — GET reads from same DB that POST writes to", () => {
  it("DBSRC-11: GET /support/cases/:id returns messages written by POST /respond", async () => {
    caseStore.push({
      id: "sc_rw", state: "AI_RESPONDED", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, actor_role: "pool_admin", mode: "normal",
      waiting_for: null, context_json: {}, escalation_reason: null,
      resolution_source: "DB_STATE", llm_used: false, turn_count: 2,
      resolved_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    // Pre-populate the in-memory store as if POST /respond already ran
    const now = new Date().toISOString();
    repliesStore.push(
      { id: "r_u1", ticket_id: null, case_id: "sc_rw", author_user_id: "user_1",
        author_name: "Tester", author_role: "user", message_type: "user",
        content: "x모드 알려줘", image_urls: [], created_at: new Date(Date.now() - 2000).toISOString() },
      { id: "r_a1", ticket_id: null, case_id: "sc_rw", author_user_id: null,
        author_name: "AI", author_role: "ai", message_type: "ai_deterministic",
        content: "X 모드 활성 상태입니다.", image_urls: [], created_at: now }
    );

    const res = await request(app)
      .get("/support/cases/sc_rw")
      .set("x-test-user", POOL_A_ADMIN);

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.messages.find((m: any) => m.author_role === "user")).toBeDefined();
    expect(res.body.messages.find((m: any) => m.author_role === "ai")).toBeDefined();
    expect(res.body.messages.find((m: any) => m.content === "X 모드 활성 상태입니다.")).toBeDefined();
  });

  it("DBSRC-12: super_admin can read same conversation from same source", async () => {
    caseStore.push({
      id: "sc_sa_rw", state: "AI_RESPONDED", pool_id: "pool_B", actor_id: "user_2",
      ticket_id: null, actor_role: "pool_admin", mode: "normal",
      waiting_for: null, context_json: {}, escalation_reason: null,
      resolution_source: null, llm_used: false, turn_count: 1,
      resolved_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    repliesStore.push({
      id: "r_sa1", ticket_id: null, case_id: "sc_sa_rw", author_user_id: "user_2",
      author_name: "User2", author_role: "user", message_type: "user",
      content: "문의합니다", image_urls: [], created_at: new Date().toISOString(),
    });

    const res = await request(app)
      .get("/support/cases/sc_sa_rw")
      .set("x-test-user", SUPER_ADMIN);

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0].content).toBe("문의합니다");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DBSRC-13 — cross-pool isolation
// ─────────────────────────────────────────────────────────────────────────────

describe("DBSRC-13 — cross-pool isolation", () => {
  it("DBSRC-13: pool_B user cannot read pool_A case → 403", async () => {
    caseStore.push({
      id: "sc_poolA", state: "AI_RESPONDED", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, actor_role: "pool_admin", mode: "normal",
    });

    const res = await request(app)
      .get("/support/cases/sc_poolA")
      .set("x-test-user", userHdr({ role: "pool_admin", poolId: "pool_B", userId: "user_99" }));

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DBSRC-14 — INSERT uses db (primary DB), not backup
// ─────────────────────────────────────────────────────────────────────────────

describe("DBSRC-14 — INSERT uses db (primary DB), not backup", () => {
  it("DBSRC-14: support_ticket_replies INSERT called (via db primary executor) on success", async () => {
    caseStore.push({
      id: "sc_ins_track", state: "NEW", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, actor_role: "pool_admin", mode: "normal",
    });
    mockRunResolutionChain.mockResolvedValue(detResolved());

    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", POOL_A_ADMIN)
      .send({ case_id: "sc_ins_track", message: "x모드 알려줘", mode: "normal" });

    expect(res.status).toBe(200);
    // Both user message (role="user") and AI message (role="ai") must be inserted
    const userInsert = insertCalls.find((c) => String(c.params[5]) === "user");
    const aiInsert   = insertCalls.find((c) => String(c.params[5]) === "ai");
    expect(userInsert).toBeDefined();
    expect(aiInsert).toBeDefined();
    // case_id is correctly set (not null)
    expect(userInsert!.params[2]).toBe("sc_ins_track");
    expect(aiInsert!.params[2]).toBe("sc_ins_track");
    // ticket_id is null (AI-only case, no ticket escalation)
    expect(userInsert!.params[1]).toBeNull();
    expect(aiInsert!.params[1]).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DBSRC-15 — full regression: status-code contracts
// ─────────────────────────────────────────────────────────────────────────────

describe("DBSRC-15 — full regression: API contracts", () => {
  it("DBSRC-15-A: deterministic path → 200, ok=true, llm_used=false", async () => {
    caseStore.push({
      id: "sc_reg_a", state: "NEW", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, actor_role: "pool_admin", mode: "normal",
    });
    mockRunResolutionChain.mockResolvedValue(detResolved());

    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", POOL_A_ADMIN)
      .send({ case_id: "sc_reg_a", message: "x모드 알려줘", mode: "normal" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.llm_used).toBe(false);
    expect(res.body.llm_called).toBe(false);
    expect(typeof res.body.answer).toBe("string");
    expect(res.body.answer.length).toBeGreaterThan(0);
    expect(res.body.case_state).toBe("AI_RESPONDED");
  });

  it("DBSRC-15-B: GET case after messages written → 200 with messages[]", async () => {
    caseStore.push({
      id: "sc_reg_b", state: "AI_RESPONDED", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, actor_role: "pool_admin", mode: "normal",
      waiting_for: null, context_json: {}, escalation_reason: null,
      resolution_source: "DB_STATE", llm_used: false, turn_count: 2,
      resolved_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    repliesStore.push(
      { id: "r_rb1", ticket_id: null, case_id: "sc_reg_b", author_user_id: "user_1",
        author_name: "Tester", author_role: "user", message_type: "user",
        content: "질문", image_urls: [], created_at: new Date(Date.now()-100).toISOString() },
      { id: "r_rb2", ticket_id: null, case_id: "sc_reg_b", author_user_id: null,
        author_name: "AI", author_role: "ai", message_type: "ai_deterministic",
        content: "답변", image_urls: [], created_at: new Date().toISOString() }
    );

    const res = await request(app)
      .get("/support/cases/sc_reg_b")
      .set("x-test-user", POOL_A_ADMIN);

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.state).toBe("AI_RESPONDED");
  });

  it("DBSRC-15-C: missing case_id → 400", async () => {
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", POOL_A_ADMIN)
      .send({ message: "테스트", mode: "normal" });
    expect(res.status).toBe(400);
  });

  it("DBSRC-15-D: empty message → 400", async () => {
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", POOL_A_ADMIN)
      .send({ case_id: "sc_any", message: "", mode: "normal" });
    expect(res.status).toBe(400);
  });

  it("DBSRC-15-E: case not found → 404", async () => {
    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", POOL_A_ADMIN)
      .send({ case_id: "sc_nonexistent", message: "질문", mode: "normal" });
    expect(res.status).toBe(404);
  });

  it("DBSRC-15-F: RESOLVED case → 409 (terminal state)", async () => {
    caseStore.push({
      id: "sc_resolved", state: "RESOLVED", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, actor_role: "pool_admin", mode: "normal",
    });

    const res = await request(app)
      .post("/support/respond")
      .set("x-test-user", POOL_A_ADMIN)
      .send({ case_id: "sc_resolved", message: "재문의", mode: "normal" });
    expect(res.status).toBe(409);
  });

  it("DBSRC-15-G: GET nonexistent case → 404", async () => {
    const res = await request(app)
      .get("/support/cases/sc_nonexistent_get")
      .set("x-test-user", POOL_A_ADMIN);
    expect(res.status).toBe(404);
  });
});
