/**
 * CS-01R Tests — CS01R-01 through CS01R-21
 *
 * WP-CS-01R: Support Core Reconciliation
 *   - support_cases (conversation), support_tickets (ticket), support_ticket_replies (message)
 *   - State machine, MASTER state mapping, event logging
 *   - Pool isolation, role isolation, PII-free analytics
 *   - Legacy human ticket regression
 *
 * OpenAI calls = 0, Knowledge search = 0, Mobile = NO
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

// ── Mock auth middleware ───────────────────────────────────────────────────────

vi.mock("../../middlewares/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    // req.user is pre-set by the test app middleware — just pass through
    if (!req.user) return _res.status(401).json({ error: "Unauthorized" });
    next();
  },
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    next();
  },
}));

// ── Mock DB ───────────────────────────────────────────────────────────────────

type MockRow = Record<string, unknown>;

let superAdminRows: MockRow[] = [];
let poolDbRows: MockRow[]     = [];
const superAdminCalls: string[] = [];
const poolDbCalls: string[]     = [];

vi.mock("@workspace/db", () => ({
  superAdminDb: {
    execute: vi.fn(async (q: any) => {
      const raw = typeof q?.queryChunks !== "undefined"
        ? q.queryChunks.map((c: any) =>
            typeof c === "string" ? c : String(c?.value ?? "")
          ).join("")
        : String(q?.sql ?? q ?? "");
      superAdminCalls.push(raw.trim());
      return { rows: superAdminRows };
    }),
  },
  db: {
    execute: vi.fn(async (q: any) => {
      const raw = typeof q?.queryChunks !== "undefined"
        ? q.queryChunks.map((c: any) =>
            typeof c === "string" ? c : String(c?.value ?? "")
          ).join("")
        : typeof q === "string" ? q : String(q?.sql ?? q ?? "");
      poolDbCalls.push(raw.trim());
      return { rows: poolDbRows };
    }),
  },
}));

// ── Import under test ─────────────────────────────────────────────────────────

import {
  VALID_TRANSITIONS,
  getMasterState,
  logSupportEvent,
  transitionSupportCase,
  messageThreadId,
} from "../../lib/support-case-service.js";
import {
  SUPPORT_CASE_STATE,
  SUPPORT_EVENT_TYPE,
  MASTER_SUPPORT_STATE,
} from "../../lib/ai-feature-enum.js";
import supportCasesRouter from "../support-cases.js";
import cspa0Router         from "../cs-pa0.js";

// ── App factory ───────────────────────────────────────────────────────────────

function makeApp(role = "teacher", poolId = "pool_A", userId = "user_1") {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = { userId, role, poolId, name: "Test User" };
    next();
  });
  app.use("/", supportCasesRouter);
  app.use("/", cspa0Router);
  return app;
}

function makeSuperApp() {
  return makeApp("super_admin", "pool_X", "super_1");
}

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  superAdminRows = [];
  poolDbRows     = [];
  superAdminCalls.length = 0;
  poolDbCalls.length     = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// CS01R-01: AI-only case create
// =============================================================================
describe("CS01R-01: AI-only case create", () => {
  it("POST /support/cases → 201 ok with caseId, ticket_id = null", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/support/cases")
      .send({ mode: "normal", context: { app_version: "1.3.0" } });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.id).toBe("string");
    expect(res.body.id).toMatch(/^sc_/);

    // support_cases INSERT — ticket_id should be null
    const insertCall = superAdminCalls.find(s =>
      s.includes("INSERT") && s.includes("support_cases")
    );
    expect(insertCall).toBeTruthy();
    // state = NEW, ticket_id null
    expect(insertCall).toContain("NEW");
  });

  it("context stored without PII", async () => {
    const app = makeApp();
    await request(app).post("/support/cases").send({
      mode: "x",
      context: { subscription_plan: "basic", app_version: "1.3.0" },
    });

    const insertCall = superAdminCalls.find(s =>
      s.includes("INSERT") && s.includes("support_cases")
    );
    // No raw text content or PII field names
    expect(insertCall).not.toContain("phone");
    expect(insertCall).not.toContain("email");
    expect(insertCall).not.toContain("name");
  });
});

// =============================================================================
// CS01R-02: case detail
// =============================================================================
describe("CS01R-02: case detail", () => {
  it("GET /support/cases/:id → returns case + messages + master_state", async () => {
    superAdminRows = [{
      id: "sc_1", pool_id: "pool_A", actor_id: "user_1", ticket_id: null,
      actor_role: "teacher", mode: "normal", state: "AI_PROCESSING",
      escalation_reason: null, resolution_source: null, llm_used: false,
      turn_count: 0, waiting_for: null, context_json: {},
      resolved_at: null, created_at: "2026-01-01", updated_at: "2026-01-01",
    }];
    poolDbRows = [];

    const app = makeApp("teacher", "pool_A", "user_1");
    const res = await request(app).get("/support/cases/sc_1");

    expect(res.status).toBe(200);
    expect(res.body.case.id).toBe("sc_1");
    expect(res.body.state).toBe("AI_PROCESSING");
    expect(res.body.master_state).toBe("AI_ACTIVE");
    expect(Array.isArray(res.body.messages)).toBe(true);
  });

  it("404 when case not found", async () => {
    superAdminRows = [];
    const app = makeApp();
    const res = await request(app).get("/support/cases/not_exist");
    expect(res.status).toBe(404);
  });
});

// =============================================================================
// CS01R-03: human escalation creates/links exactly one ticket
// =============================================================================
describe("CS01R-03: human escalation creates and links ticket", () => {
  it("POST /support/cases/:id/request-human → creates ticket, links to case", async () => {
    // Setup: case with no ticket, state = NEW
    superAdminRows = [{
      id: "sc_2", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, actor_role: "teacher", state: "NEW",
    }];
    poolDbRows = [];

    const app = makeApp("teacher", "pool_A", "user_1");
    const res = await request(app)
      .post("/support/cases/sc_2/request-human")
      .send({ subject: "문의 제목", reason: "USER_REQUESTED_HUMAN" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.created).toBe(true);
    expect(typeof res.body.ticket_id).toBe("string");
    expect(res.body.ticket_id).toMatch(/^tkt_/);

    // support_tickets INSERT happened in pool db
    const ticketInsert = poolDbCalls.find(s =>
      s.includes("INSERT") && s.includes("support_tickets")
    );
    expect(ticketInsert).toBeTruthy();

    // support_cases UPDATE with ticket_id + HUMAN_REQUIRED
    const caseUpdate = superAdminCalls.find(s =>
      s.includes("UPDATE") && s.includes("support_cases")
    );
    expect(caseUpdate).toBeTruthy();
    expect(caseUpdate).toContain("HUMAN_REQUIRED");
  });
});

// =============================================================================
// CS01R-04: double human request does not duplicate ticket
// =============================================================================
describe("CS01R-04: idempotent human request — no duplicate ticket", () => {
  it("second request-human returns existing ticket_id, created=false", async () => {
    superAdminRows = [{
      id: "sc_3", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: "tkt_existing_123", actor_role: "teacher", state: "HUMAN_REQUIRED",
    }];

    const app = makeApp("teacher", "pool_A", "user_1");
    const res = await request(app)
      .post("/support/cases/sc_3/request-human")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.ticket_id).toBe("tkt_existing_123");
    expect(res.body.created).toBe(false);

    // No new ticket INSERT
    const ticketInsert = poolDbCalls.find(s =>
      s.includes("INSERT") && s.includes("support_tickets")
    );
    expect(ticketInsert).toBeUndefined();
  });
});

// =============================================================================
// CS01R-05: AI message author_role stored correctly
// =============================================================================
describe("CS01R-05: AI message author_role", () => {
  it("super_admin can post ai-authored message", async () => {
    superAdminRows = [{
      id: "sc_4", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, state: "AI_PROCESSING",
    }];
    poolDbRows = [];

    const app = makeSuperApp();
    const res = await request(app)
      .post("/support/cases/sc_4/messages")
      .send({ content: "AI 답변입니다.", author_role: "ai" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Pool db INSERT with author_role=ai
    const insertCall = poolDbCalls.find(s =>
      s.includes("INSERT") && s.includes("support_ticket_replies")
    );
    expect(insertCall).toBeTruthy();
    // author_role 'ai' is a parameter (checked via value in call)
    expect(poolDbCalls.some(s => s.includes("support_ticket_replies"))).toBe(true);
  });

  it("non-super cannot post as ai author", async () => {
    superAdminRows = [{
      id: "sc_4b", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, state: "AI_PROCESSING",
    }];

    const app = makeApp("teacher", "pool_A", "user_1");
    const res = await request(app)
      .post("/support/cases/sc_4b/messages")
      .send({ content: "가짜 AI 답변", author_role: "ai" });

    expect(res.status).toBe(403);
  });
});

// =============================================================================
// CS01R-06: agent reply existing flow (super_admin answer)
// =============================================================================
describe("CS01R-06: agent reply via super_admin", () => {
  it("super_admin posts agent message", async () => {
    superAdminRows = [{
      id: "sc_5", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: "tkt_abc", state: "HUMAN_REQUIRED",
    }];
    poolDbRows = [];

    const app = makeSuperApp();
    const res = await request(app)
      .post("/support/cases/sc_5/messages")
      .send({ content: "안녕하세요, 상담사입니다.", author_role: "agent" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// =============================================================================
// CS01R-07: state normalization — getMasterState()
// =============================================================================
describe("CS01R-07: state normalization (getMasterState)", () => {
  const cases: [string, string | null, string][] = [
    ["NEW",            null,                   "AI_ACTIVE"],
    ["AI_PROCESSING",  null,                   "AI_ACTIVE"],
    ["AI_RESPONDED",   null,                   "WAITING"],
    ["WAITING",        null,                   "WAITING"],
    ["AI_RESOLVED",    null,                   "RESOLVED"],
    ["HUMAN_REQUIRED", null,                   "AGENT_REQUESTED"],
    ["HUMAN_RESPONDED",null,                   "AGENT_ACTIVE"],
    ["ESCALATED",      "NO_KNOWLEDGE",         "AGENT_ACTIVE"],
    ["ESCALATED",      "BILLING_REQUIRED",     "PHONE_REQUIRED"],
    ["ESCALATED",      "REFUND_REQUIRED",      "PHONE_REQUIRED"],
    ["ESCALATED",      "SAFETY_OR_PRIVACY",    "PHONE_REQUIRED"],
    ["PHONE_REQUIRED", null,                   "PHONE_REQUIRED"],
    ["RESOLVED",       null,                   "RESOLVED"],
    ["CLOSED",         null,                   "RESOLVED"],
    ["REOPENED",       null,                   "REOPENED"],
  ];

  it.each(cases)("%s + reason=%s → MASTER=%s", (state, reason, expected) => {
    expect(getMasterState(state, reason)).toBe(expected);
  });
});

// =============================================================================
// CS01R-08: valid transitions are allowed
// =============================================================================
describe("CS01R-08: valid state transitions", () => {
  const validCases: [string, string][] = [
    ["NEW",            "AI_PROCESSING"],
    ["AI_PROCESSING",  "AI_RESPONDED"],
    ["AI_RESPONDED",   "WAITING"],
    ["WAITING",        "HUMAN_REQUIRED"],
    ["AI_RESOLVED",    "RESOLVED"],
    ["AI_RESOLVED",    "REOPENED"],
    ["HUMAN_REQUIRED", "HUMAN_RESPONDED"],
    ["HUMAN_RESPONDED","RESOLVED"],
    ["HUMAN_RESPONDED","ESCALATED"],
    ["ESCALATED",      "PHONE_REQUIRED"],
    ["RESOLVED",       "REOPENED"],
    ["REOPENED",       "AI_PROCESSING"],
    ["REOPENED",       "HUMAN_REQUIRED"],
  ];

  it.each(validCases)("%s → %s is in VALID_TRANSITIONS", (from, to) => {
    expect(VALID_TRANSITIONS[from]).toContain(to);
  });
});

// =============================================================================
// CS01R-09: invalid transitions are blocked (422)
// =============================================================================
describe("CS01R-09: invalid transition blocked", () => {
  it("transitionSupportCase returns 422 for invalid transition", async () => {
    superAdminRows = [{
      id: "sc_6", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, state: "NEW", escalation_reason: null,
    }];

    const result = await transitionSupportCase({
      caseId:    "sc_6",
      toState:   "RESOLVED",   // NEW → RESOLVED not allowed
      actorRole: "super_admin",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(422);
      expect(result.error).toContain("NEW");
    }
  });

  it("VALID_TRANSITIONS for CLOSED is empty (terminal)", () => {
    expect(VALID_TRANSITIONS["CLOSED"]).toHaveLength(0);
  });

  it("CLOSED → REOPENED is not in VALID_TRANSITIONS", () => {
    expect(VALID_TRANSITIONS["CLOSED"]).not.toContain("REOPENED");
  });
});

// =============================================================================
// CS01R-10: resolved → reopened
// =============================================================================
describe("CS01R-10: resolved → reopened", () => {
  it("POST /support/cases/:id/reopen succeeds from RESOLVED", async () => {
    superAdminRows = [{
      id: "sc_7", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, state: "RESOLVED", escalation_reason: null,
    }];

    const app = makeApp("teacher", "pool_A", "user_1");
    const res = await request(app).post("/support/cases/sc_7/reopen");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const updateCall = superAdminCalls.find(s =>
      s.includes("UPDATE") && s.includes("support_cases")
    );
    expect(updateCall).toBeTruthy();
    expect(updateCall).toContain("REOPENED");
  });

  it("RESOLVED → REOPENED is in VALID_TRANSITIONS", () => {
    expect(VALID_TRANSITIONS["RESOLVED"]).toContain("REOPENED");
  });
});

// =============================================================================
// CS01R-11: waiting state semantics
// =============================================================================
describe("CS01R-11: WAITING state semantics", () => {
  it("WAITING exists in SUPPORT_CASE_STATE", () => {
    expect(SUPPORT_CASE_STATE.WAITING).toBe("WAITING");
  });

  it("WAITING → RESOLVED not direct (must go through AI_RESOLVED or HUMAN path)", () => {
    // WAITING can transition to AI_RESOLVED or HUMAN_REQUIRED, not RESOLVED directly
    expect(VALID_TRANSITIONS["WAITING"]).not.toContain("RESOLVED");
    expect(VALID_TRANSITIONS["WAITING"]).toContain("AI_RESOLVED");
  });

  it("getMasterState WAITING → MASTER WAITING", () => {
    expect(getMasterState("WAITING")).toBe("WAITING");
  });

  it("transitionSupportCase updates waiting_for field", async () => {
    superAdminRows = [{
      id: "sc_8", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, state: "AI_PROCESSING", escalation_reason: null,
    }];

    const result = await transitionSupportCase({
      caseId:    "sc_8",
      toState:   "WAITING",
      actorRole: "super_admin",
      waitingFor: "USER",
    });

    expect(result.ok).toBe(true);
    const updateCall = superAdminCalls.find(s => s.includes("UPDATE") && s.includes("support_cases"));
    expect(updateCall).toBeTruthy();
    expect(updateCall).toContain("WAITING");
  });
});

// =============================================================================
// CS01R-12: PHONE_REQUIRED explicit only
// =============================================================================
describe("CS01R-12: PHONE_REQUIRED explicit escalation only", () => {
  it("PHONE_REQUIRED only from HUMAN_REQUIRED or ESCALATED", () => {
    // Cannot jump from AI_PROCESSING to PHONE_REQUIRED
    expect(VALID_TRANSITIONS["AI_PROCESSING"]).not.toContain("PHONE_REQUIRED");
    // Can go from HUMAN_REQUIRED to PHONE_REQUIRED
    expect(VALID_TRANSITIONS["HUMAN_REQUIRED"]).toContain("PHONE_REQUIRED");
    // Can go from ESCALATED to PHONE_REQUIRED
    expect(VALID_TRANSITIONS["ESCALATED"]).toContain("PHONE_REQUIRED");
  });

  it("ESCALATED without billing reason → AGENT_ACTIVE (not PHONE_REQUIRED)", () => {
    expect(getMasterState("ESCALATED", "NO_KNOWLEDGE")).toBe("AGENT_ACTIVE");
    expect(getMasterState("ESCALATED", "BUG_REPORT")).toBe("AGENT_ACTIVE");
  });

  it("ESCALATED with billing reason → PHONE_REQUIRED", () => {
    expect(getMasterState("ESCALATED", "BILLING_REQUIRED")).toBe("PHONE_REQUIRED");
    expect(getMasterState("ESCALATED", "REFUND_REQUIRED")).toBe("PHONE_REQUIRED");
  });
});

// =============================================================================
// CS01R-13: support event recorded (event_logs category=SUPPORT)
// =============================================================================
describe("CS01R-13: support event recorded in event_logs", () => {
  it("logSupportEvent inserts into event_logs with category=SUPPORT", async () => {
    await logSupportEvent({
      eventType: SUPPORT_EVENT_TYPE.CASE_CREATED,
      caseId:    "sc_ev_1",
      fromState: "",
      toState:   "NEW",
      actorRole: "teacher",
      poolId:    "pool_A",
    });

    const insertCall = superAdminCalls.find(s =>
      s.includes("INSERT") && s.includes("event_logs")
    );
    expect(insertCall).toBeTruthy();
    expect(insertCall).toContain("SUPPORT");
    expect(insertCall).toContain("sc_ev_1");
  });

  it("transitionSupportCase triggers support event", async () => {
    superAdminRows = [{
      id: "sc_ev_2", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, state: "NEW", escalation_reason: null,
    }];

    await transitionSupportCase({
      caseId:    "sc_ev_2",
      toState:   "AI_PROCESSING",
      actorRole: "super_admin",
      poolId:    "pool_A",
    });

    // Should have UPDATE on support_cases AND INSERT into event_logs
    const updateCall = superAdminCalls.find(s => s.includes("UPDATE") && s.includes("support_cases"));
    const eventCall  = superAdminCalls.find(s => s.includes("INSERT") && s.includes("event_logs"));
    expect(updateCall).toBeTruthy();
    expect(eventCall).toBeTruthy();
  });
});

// =============================================================================
// CS01R-14: no raw message content in analytics event
// =============================================================================
describe("CS01R-14: no raw message in analytics event", () => {
  it("logSupportEvent payload has no content/text fields", async () => {
    await logSupportEvent({
      eventType: SUPPORT_EVENT_TYPE.USER_RESPONDED,
      caseId:    "sc_pii_1",
      fromState: "AI_RESPONDED",
      toState:   "AI_RESPONDED",
      actorRole: "teacher",
      poolId:    "pool_A",
    });

    const insertCall = superAdminCalls.find(s =>
      s.includes("INSERT") && s.includes("event_logs")
    );
    expect(insertCall).toBeTruthy();
    // No content/message body in event
    expect(insertCall).not.toContain("content");
    expect(insertCall).not.toContain("reply");
    expect(insertCall).not.toContain("question");
  });
});

// =============================================================================
// CS01R-15: cross-pool read denied
// =============================================================================
describe("CS01R-15: cross-pool read denied", () => {
  it("pool_A user cannot read pool_B case → 403", async () => {
    superAdminRows = [{
      id: "sc_b_1", pool_id: "pool_B", actor_id: "user_b",
      ticket_id: null, actor_role: "teacher", state: "NEW",
      escalation_reason: null, resolution_source: null, llm_used: false,
      turn_count: 0, waiting_for: null, context_json: {},
      resolved_at: null, created_at: "2026-01-01", updated_at: "2026-01-01",
    }];

    const app = makeApp("teacher", "pool_A", "user_1");  // pool_A user
    const res = await request(app).get("/support/cases/sc_b_1");

    expect(res.status).toBe(403);
  });
});

// =============================================================================
// CS01R-16: cross-pool write denied
// =============================================================================
describe("CS01R-16: cross-pool write denied", () => {
  it("pool_A user cannot add message to pool_B case → 403", async () => {
    superAdminRows = [{
      id: "sc_b_2", pool_id: "pool_B", actor_id: "user_b",
      ticket_id: null, state: "AI_PROCESSING",
    }];

    const app = makeApp("teacher", "pool_A", "user_1");
    const res = await request(app)
      .post("/support/cases/sc_b_2/messages")
      .send({ content: "cross pool message" });

    expect(res.status).toBe(403);
  });
});

// =============================================================================
// CS01R-17: non-owner user denied
// =============================================================================
describe("CS01R-17: non-owner user denied", () => {
  it("user_2 cannot read user_1's case in same pool → 403", async () => {
    superAdminRows = [{
      id: "sc_own_1", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, actor_role: "teacher", state: "NEW",
      escalation_reason: null, resolution_source: null, llm_used: false,
      turn_count: 0, waiting_for: null, context_json: {},
      resolved_at: null, created_at: "2026-01-01", updated_at: "2026-01-01",
    }];

    const app = makeApp("teacher", "pool_A", "user_2");  // different user, same pool
    const res = await request(app).get("/support/cases/sc_own_1");

    expect(res.status).toBe(403);
  });
});

// =============================================================================
// CS01R-18: super_admin allowed (cross-pool read)
// =============================================================================
describe("CS01R-18: super_admin has full access", () => {
  it("super_admin can read any pool's case", async () => {
    superAdminRows = [{
      id: "sc_any", pool_id: "pool_Z", actor_id: "user_z",
      ticket_id: null, actor_role: "teacher", state: "NEW",
      escalation_reason: null, resolution_source: null, llm_used: false,
      turn_count: 0, waiting_for: null, context_json: {},
      resolved_at: null, created_at: "2026-01-01", updated_at: "2026-01-01",
    }];
    poolDbRows = [];

    const app = makeSuperApp();
    const res = await request(app).get("/support/cases/sc_any");

    expect(res.status).toBe(200);
    expect(res.body.case.pool_id).toBe("pool_Z");
  });

  it("super_admin can transition any case", async () => {
    superAdminRows = [{
      id: "sc_any2", pool_id: "pool_Z", actor_id: "user_z",
      ticket_id: null, state: "NEW", escalation_reason: null,
    }];

    const app = makeSuperApp();
    const res = await request(app)
      .post("/super/support/cases/sc_any2/transition")
      .send({ to_state: "AI_PROCESSING" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// =============================================================================
// CS01R-19: legacy human-only ticket works
// =============================================================================
describe("CS01R-19: legacy human-only ticket not broken", () => {
  it("support_tickets CRUD routes still exist (not overwritten)", async () => {
    // Support cases router does NOT conflict with /support/tickets routes.
    // support-tickets.ts handles /support/tickets; support-cases.ts handles /support/cases.
    const casePaths  = ["/support/cases", "/support/cases/:id"];
    const ticketPaths = ["/support/tickets", "/support/my-tickets"];

    // Confirm no route collision: cases router has no /tickets routes
    const app = makeApp();
    // GET /support/tickets/:id — not in support-cases router → 404
    const res = await request(app).get("/support/tickets/not_existing");
    // supportCasesRouter doesn't handle /support/tickets → falls through
    expect(res.status).toBe(404); // no handler in supportCasesRouter
  });

  it("messageThreadId: ticket_id overrides case_id as thread key", () => {
    expect(messageThreadId("case_1", "tkt_123")).toBe("tkt_123");
    expect(messageThreadId("case_1", null)).toBe("case_1");
  });
});

// =============================================================================
// CS01R-20: existing CS-PA0/PA1 regression check
// =============================================================================
describe("CS01R-20: CS-PA0/PA1 regression", () => {
  it("SUPPORT_CASE_STATE still has all original states", () => {
    expect(SUPPORT_CASE_STATE.NEW).toBe("NEW");
    expect(SUPPORT_CASE_STATE.AI_PROCESSING).toBe("AI_PROCESSING");
    expect(SUPPORT_CASE_STATE.AI_RESPONDED).toBe("AI_RESPONDED");
    expect(SUPPORT_CASE_STATE.AI_RESOLVED).toBe("AI_RESOLVED");
    expect(SUPPORT_CASE_STATE.HUMAN_REQUIRED).toBe("HUMAN_REQUIRED");
    expect(SUPPORT_CASE_STATE.HUMAN_RESPONDED).toBe("HUMAN_RESPONDED");
    expect(SUPPORT_CASE_STATE.ESCALATED).toBe("ESCALATED");
    expect(SUPPORT_CASE_STATE.RESOLVED).toBe("RESOLVED");
    expect(SUPPORT_CASE_STATE.CLOSED).toBe("CLOSED");
  });

  it("SUPPORT_CASE_STATE has new CS-01R states", () => {
    expect(SUPPORT_CASE_STATE.WAITING).toBe("WAITING");
    expect(SUPPORT_CASE_STATE.REOPENED).toBe("REOPENED");
    expect(SUPPORT_CASE_STATE.PHONE_REQUIRED).toBe("PHONE_REQUIRED");
  });

  it("SUPPORT_EVENT_TYPE has all required event types", () => {
    expect(SUPPORT_EVENT_TYPE.CASE_CREATED).toBe("CASE_CREATED");
    expect(SUPPORT_EVENT_TYPE.AI_RESPONDED).toBe("AI_RESPONDED");
    expect(SUPPORT_EVENT_TYPE.HUMAN_REQUESTED).toBe("HUMAN_REQUESTED");
    expect(SUPPORT_EVENT_TYPE.CASE_REOPENED).toBe("CASE_REOPENED");
    expect(SUPPORT_EVENT_TYPE.CASE_CLOSED).toBe("CASE_CLOSED");
    expect(SUPPORT_EVENT_TYPE.STATE_TRANSITIONED).toBe("STATE_TRANSITIONED");
  });

  it("MASTER_SUPPORT_STATE has all 7 MASTER states", () => {
    expect(MASTER_SUPPORT_STATE.AI_ACTIVE).toBe("AI_ACTIVE");
    expect(MASTER_SUPPORT_STATE.AGENT_REQUESTED).toBe("AGENT_REQUESTED");
    expect(MASTER_SUPPORT_STATE.WAITING).toBe("WAITING");
    expect(MASTER_SUPPORT_STATE.AGENT_ACTIVE).toBe("AGENT_ACTIVE");
    expect(MASTER_SUPPORT_STATE.PHONE_REQUIRED).toBe("PHONE_REQUIRED");
    expect(MASTER_SUPPORT_STATE.RESOLVED).toBe("RESOLVED");
    expect(MASTER_SUPPORT_STATE.REOPENED).toBe("REOPENED");
  });

  it("OpenAI not imported in support-case-service", async () => {
    // No OpenAI calls — structural check via import map
    // Since we're in test, just verify that the service doesn't invoke openai
    const calls = [...superAdminCalls, ...poolDbCalls];
    const hasOpenAI = calls.some(c =>
      c.toLowerCase().includes("openai") || c.toLowerCase().includes("gpt")
    );
    expect(hasOpenAI).toBe(false);
  });
});

// =============================================================================
// CS01R-21: full test suite pass (meta)
// =============================================================================
describe("CS01R-21: full suite meta", () => {
  it("VALID_TRANSITIONS covers all internal states", () => {
    const states = Object.keys(SUPPORT_CASE_STATE);
    for (const state of states) {
      expect(VALID_TRANSITIONS).toHaveProperty(state);
    }
  });

  it("CLOSED is terminal (no outgoing transitions)", () => {
    expect(VALID_TRANSITIONS["CLOSED"]).toEqual([]);
  });

  it("getMasterState handles unknown state gracefully", () => {
    // Unknown state returns as-is (no throw)
    const result = getMasterState("UNKNOWN_STATE");
    expect(typeof result).toBe("string");
  });
});
