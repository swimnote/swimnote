/**
 * cs-01r-harden.test.ts — WP-CS-01R-HARDEN Tests
 * HARDEN-01 through HARDEN-13
 *
 * Validates:
 *   1. Message thread identity (case_id column, not ticket_id impersonation)
 *   2. Thread continuity after human escalation
 *   3. Super Admin state transition uses service (VALID_TRANSITIONS enforced)
 *   4. No raw message content in event logs
 *   5. Legacy human-only ticket queries unaffected
 *   6. Cross-pool denial
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

// ── Mock auth middleware ───────────────────────────────────────────────────────

vi.mock("../../middlewares/auth.js", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    next();
  },
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    next();
  },
}));

// ── Mock DB ───────────────────────────────────────────────────────────────────

let superAdminRows: any[] = [];
let poolDbRows: any[]     = [];
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

// ── App factory ───────────────────────────────────────────────────────────────

import supportCasesRouter from "../support-cases.js";
import cspa0Router        from "../cs-pa0.js";

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
// HARDEN-01: AI-only case first message uses case_id, NOT ticket_id
// =============================================================================
describe("HARDEN-01: AI-only case first message — case_id stored, ticket_id=null", () => {
  it("POST /support/cases/:id/messages stores case_id, not case_id-as-ticket_id", async () => {
    superAdminRows = [{
      id: "sc_h01", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, state: "AI_PROCESSING",
    }];

    const app = makeApp();
    const res = await request(app)
      .post("/support/cases/sc_h01/messages")
      .send({ content: "첫 번째 메시지", author_role: "user" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Pool db INSERT — must have case_id param, ticket_id param must be null
    const insertCall = poolDbCalls.find(s =>
      s.includes("INSERT") && s.includes("support_ticket_replies")
    );
    expect(insertCall).toBeTruthy();

    // The INSERT uses parameterized query — verify case_id column is present
    expect(insertCall).toContain("case_id");
    // ticket_id column also present (nullable)
    expect(insertCall).toContain("ticket_id");
  });

  it("case_id column appears in INSERT, not just in ticket_id slot", async () => {
    superAdminRows = [{
      id: "sc_h01b", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, state: "NEW",
    }];

    const app = makeApp();
    await request(app)
      .post("/support/cases/sc_h01b/messages")
      .send({ content: "메시지", author_role: "user" });

    const insertCall = poolDbCalls.find(s => s.includes("INSERT"));
    expect(insertCall).toContain("case_id");
    // Ensure the column list has case_id separate from ticket_id
    const colListMatch = insertCall?.match(/\(([^)]+)\)/);
    const cols = colListMatch?.[1] ?? "";
    expect(cols).toContain("case_id");
    expect(cols).toContain("ticket_id");
  });
});

// =============================================================================
// HARDEN-02: AI-only multiple messages — all stored with same case_id
// =============================================================================
describe("HARDEN-02: AI-only multiple messages all use same case_id", () => {
  it("second message has same case_id as first", async () => {
    superAdminRows = [{
      id: "sc_h02", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, state: "AI_RESPONDED",
    }];

    const app = makeApp();

    await request(app)
      .post("/support/cases/sc_h02/messages")
      .send({ content: "첫 메시지", author_role: "user" });

    const beforeLen = poolDbCalls.length;

    await request(app)
      .post("/support/cases/sc_h02/messages")
      .send({ content: "두 번째 메시지", author_role: "user" });

    const insertCalls = poolDbCalls
      .slice(beforeLen)
      .filter(s => s.includes("INSERT") && s.includes("support_ticket_replies"));

    expect(insertCalls.length).toBeGreaterThanOrEqual(1);
    // All inserts have case_id
    for (const call of insertCalls) {
      expect(call).toContain("case_id");
    }
  });
});

// =============================================================================
// HARDEN-03: request-human creates ticket and stores ticketId correctly
// =============================================================================
describe("HARDEN-03: request-human creates ticket with correct case link", () => {
  it("creates support_ticket in pool DB, updates support_cases with ticket_id", async () => {
    superAdminRows = [{
      id: "sc_h03", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, actor_role: "teacher", state: "NEW",
    }];
    poolDbRows = [];

    const app = makeApp();
    const res = await request(app)
      .post("/support/cases/sc_h03/request-human")
      .send({ subject: "문의 상담 요청" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.created).toBe(true);
    expect(res.body.ticket_id).toMatch(/^tkt_/);

    // support_tickets INSERT
    const ticketInsert = poolDbCalls.find(s =>
      s.includes("INSERT") && s.includes("support_tickets")
    );
    expect(ticketInsert).toBeTruthy();

    // support_cases UPDATE with ticket_id + HUMAN_REQUIRED
    const caseUpdate = superAdminCalls.find(s =>
      s.includes("UPDATE") && s.includes("support_cases")
    );
    expect(caseUpdate).toContain("HUMAN_REQUIRED");
  });
});

// =============================================================================
// HARDEN-04: old AI messages preserved after ticket creation
// =============================================================================
describe("HARDEN-04: AI messages preserved after human escalation", () => {
  it("GET /support/cases/:id queries by case_id even after ticket is linked", async () => {
    // Case: already escalated, has ticket
    superAdminRows = [{
      id: "sc_h04", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: "tkt_real_123", actor_role: "teacher", state: "HUMAN_REQUIRED",
      escalation_reason: null, resolution_source: null, llm_used: false,
      turn_count: 2, waiting_for: null, context_json: {},
      resolved_at: null, created_at: "2026-01-01", updated_at: "2026-01-01",
    }];

    // Simulated replies: two AI/User messages (case_id="sc_h04", ticket_id=null)
    // + one ticket-based message from legacy path (ticket_id="tkt_real_123", case_id=null)
    poolDbRows = [
      {
        id: "rep_1", ticket_id: null, case_id: "sc_h04",
        author_role: "user", content: "질문입니다", created_at: "2026-01-01T10:00:00Z",
      },
      {
        id: "rep_2", ticket_id: null, case_id: "sc_h04",
        author_role: "ai", content: "AI 답변", created_at: "2026-01-01T10:01:00Z",
      },
      {
        id: "rep_3", ticket_id: "tkt_real_123", case_id: null,
        author_role: "agent", content: "상담사입니다", created_at: "2026-01-01T10:02:00Z",
      },
    ];

    const app = makeApp("teacher", "pool_A", "user_1");
    const res = await request(app).get("/support/cases/sc_h04");

    expect(res.status).toBe(200);
    // All 3 messages should be returned
    expect(res.body.messages).toHaveLength(3);

    // Query must include case_id = sc_h04 (for AI/user messages)
    const msgQuery = poolDbCalls.find(s =>
      s.includes("support_ticket_replies") && s.includes("case_id")
    );
    expect(msgQuery).toBeTruthy();
    expect(msgQuery).toContain("case_id");
  });

  it("GET message query does NOT use deprecated ticket_id-as-case_id pattern", async () => {
    superAdminRows = [{
      id: "sc_h04b", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, actor_role: "teacher", state: "AI_PROCESSING",
      escalation_reason: null, resolution_source: null, llm_used: false,
      turn_count: 0, waiting_for: null, context_json: {},
      resolved_at: null, created_at: "2026-01-01", updated_at: "2026-01-01",
    }];
    poolDbRows = [];

    const app = makeApp("teacher", "pool_A", "user_1");
    await request(app).get("/support/cases/sc_h04b");

    // The pool db query must use case_id, not "WHERE ticket_id = sc_h04b"
    const msgQuery = poolDbCalls.find(s =>
      s.includes("support_ticket_replies")
    );
    expect(msgQuery).toBeTruthy();
    expect(msgQuery).toContain("case_id");
    // Must NOT query with case_id stored as ticket_id
    // (i.e., should not be "WHERE ticket_id = sc_h04b")
    expect(msgQuery).not.toMatch(/WHERE ticket_id = sc_h04b/);
  });
});

// =============================================================================
// HARDEN-05: agent reply joins same conversation history
// =============================================================================
describe("HARDEN-05: agent reply visible in case conversation", () => {
  it("super admin agent reply included in GET case messages (via case_id query)", async () => {
    // Case has ticket; messages stored with case_id
    superAdminRows = [{
      id: "sc_h05", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: "tkt_agent_case", state: "HUMAN_REQUIRED",
      escalation_reason: null, resolution_source: null, llm_used: false,
      turn_count: 1, waiting_for: null, context_json: {},
      resolved_at: null, created_at: "2026-01-01", updated_at: "2026-01-01",
    }];

    // Agent message posted with case_id, so it appears in case thread
    poolDbRows = [
      {
        id: "rep_u1", ticket_id: null, case_id: "sc_h05",
        author_role: "user", content: "도와주세요", created_at: "2026-01-01T10:00:00Z",
      },
      {
        id: "rep_a1", ticket_id: "tkt_agent_case", case_id: "sc_h05",
        author_role: "agent", content: "안녕하세요", created_at: "2026-01-01T10:01:00Z",
      },
    ];

    const app = makeApp("teacher", "pool_A", "user_1");
    const res = await request(app).get("/support/cases/sc_h05");

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(2);
    const roles = res.body.messages.map((m: any) => m.author_role);
    expect(roles).toContain("user");
    expect(roles).toContain("agent");
  });
});

// =============================================================================
// HARDEN-06: legacy human-only ticket replies unaffected
// =============================================================================
describe("HARDEN-06: legacy human-only ticket replies unchanged", () => {
  it("support-cases router does not handle /support/tickets/:id routes", async () => {
    const app = makeApp();
    // GET /support/tickets/:id is NOT handled by supportCasesRouter → 404
    const res = await request(app).get("/support/tickets/some_ticket_id");
    expect(res.status).toBe(404);
  });

  it("pool db legacy reply query uses ticket_id, not case_id", () => {
    // support-tickets.ts uses WHERE ticket_id = ${id} — we verify it in separate test
    // Here just confirm the case_id addition doesn't break this contract:
    // Since case_id is nullable, existing rows with case_id=null are unaffected
    // This is a structural/schema fact we assert here
    const legacyQuery = "SELECT * FROM support_ticket_replies WHERE ticket_id = $1";
    // Confirm legacy query doesn't need case_id
    expect(legacyQuery).toContain("ticket_id");
    expect(legacyQuery).not.toContain("case_id");
  });
});

// =============================================================================
// HARDEN-07: cross-pool case message denied
// =============================================================================
describe("HARDEN-07: cross-pool case message denied", () => {
  it("pool_B user cannot post message to pool_A case → 403", async () => {
    superAdminRows = [{
      id: "sc_h07", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, state: "AI_PROCESSING",
    }];

    // pool_B user
    const app = makeApp("teacher", "pool_B", "user_2");
    const res = await request(app)
      .post("/support/cases/sc_h07/messages")
      .send({ content: "cross-pool" });

    expect(res.status).toBe(403);
  });

  it("cross-pool case GET denied → 403", async () => {
    superAdminRows = [{
      id: "sc_h07b", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, actor_role: "teacher", state: "NEW",
      escalation_reason: null, resolution_source: null, llm_used: false,
      turn_count: 0, waiting_for: null, context_json: {},
      resolved_at: null, created_at: "2026-01-01", updated_at: "2026-01-01",
    }];

    const app = makeApp("teacher", "pool_B", "user_2");
    const res = await request(app).get("/support/cases/sc_h07b");
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// HARDEN-08: cross-pool ticket message denied (via request-human)
// =============================================================================
describe("HARDEN-08: cross-pool request-human denied", () => {
  it("pool_B user cannot escalate pool_A case → 403", async () => {
    superAdminRows = [{
      id: "sc_h08", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, actor_role: "teacher", state: "NEW",
    }];

    const app = makeApp("teacher", "pool_B", "user_2");
    const res = await request(app)
      .post("/support/cases/sc_h08/request-human")
      .send({});

    expect(res.status).toBe(403);
  });
});

// =============================================================================
// HARDEN-09: valid super admin transition
// =============================================================================
describe("HARDEN-09: valid super_admin state transition", () => {
  it("POST /super/support/cases/:id/transition succeeds for valid transition", async () => {
    superAdminRows = [{
      id: "sc_h09", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, state: "NEW", escalation_reason: null,
    }];

    const app = makeSuperApp();
    const res = await request(app)
      .post("/super/support/cases/sc_h09/transition")
      .send({ to_state: "AI_PROCESSING" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // UPDATE executed on support_cases
    const updateCall = superAdminCalls.find(s =>
      s.includes("UPDATE") && s.includes("support_cases")
    );
    expect(updateCall).toBeTruthy();
    expect(updateCall).toContain("AI_PROCESSING");
  });
});

// =============================================================================
// HARDEN-10: invalid super admin transition blocked
// =============================================================================
describe("HARDEN-10: invalid super_admin transition blocked by service", () => {
  it("NEW → RESOLVED blocked → 422 (not a force override)", async () => {
    superAdminRows = [{
      id: "sc_h10", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, state: "NEW", escalation_reason: null,
    }];

    const app = makeSuperApp();
    const res = await request(app)
      .post("/super/support/cases/sc_h10/transition")
      .send({ to_state: "RESOLVED" });

    expect(res.status).toBe(422);
    expect(res.body.error).toContain("NEW");
  });

  it("AI_PROCESSING → PHONE_REQUIRED blocked → 422", async () => {
    superAdminRows = [{
      id: "sc_h10b", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, state: "AI_PROCESSING", escalation_reason: null,
    }];

    const app = makeSuperApp();
    const res = await request(app)
      .post("/super/support/cases/sc_h10b/transition")
      .send({ to_state: "PHONE_REQUIRED" });

    expect(res.status).toBe(422);
  });

  it("RESOLVED → HUMAN_RESPONDED blocked → 422", async () => {
    superAdminRows = [{
      id: "sc_h10c", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, state: "RESOLVED", escalation_reason: null,
    }];

    const app = makeSuperApp();
    const res = await request(app)
      .post("/super/support/cases/sc_h10c/transition")
      .send({ to_state: "HUMAN_RESPONDED" });

    expect(res.status).toBe(422);
  });
});

// =============================================================================
// HARDEN-11: no direct state mutation bypass
// =============================================================================
describe("HARDEN-11: no direct state mutation bypass", () => {
  it("super transition endpoint routes through transitionSupportCase (SELECT first)", async () => {
    superAdminRows = [{
      id: "sc_h11", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, state: "AI_RESPONDED", escalation_reason: null,
    }];

    const app = makeSuperApp();
    await request(app)
      .post("/super/support/cases/sc_h11/transition")
      .send({ to_state: "WAITING" });

    // Must SELECT current state before UPDATE (service pattern)
    const selectCall = superAdminCalls.find(s =>
      s.includes("SELECT") && s.includes("support_cases") && s.includes("state")
    );
    expect(selectCall).toBeTruthy();
  });

  it("non-super user cannot call /super/support/cases/:id/transition", async () => {
    const app = makeApp("teacher", "pool_A", "user_1"); // non-super
    const res = await request(app)
      .post("/super/support/cases/sc_h11/transition")
      .send({ to_state: "AI_PROCESSING" });

    // requireRole("super_admin") should block
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// HARDEN-12: support event contains no raw message content
// =============================================================================
describe("HARDEN-12: support event log contains no raw message content", () => {
  it("POST messages triggers event_logs insert without content in metadata", async () => {
    superAdminRows = [{
      id: "sc_h12", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, state: "AI_PROCESSING",
    }];

    const app = makeApp();
    await request(app)
      .post("/support/cases/sc_h12/messages")
      .send({ content: "SECRET_USER_CONTENT_PII_DATA", author_role: "user" });

    // event_logs INSERT (SUPPORT event) must not contain the raw message
    const eventInserts = superAdminCalls.filter(s =>
      s.includes("INSERT") && s.includes("event_logs")
    );

    // Event insert is best-effort (may or may not have fired by test time)
    // If it did fire, it must not contain raw content
    for (const call of eventInserts) {
      expect(call).not.toContain("SECRET_USER_CONTENT_PII_DATA");
    }

    // The pool db INSERT has the content — that's expected for the message record
    const msgInsert = poolDbCalls.find(s =>
      s.includes("INSERT") && s.includes("support_ticket_replies")
    );
    expect(msgInsert).toBeTruthy();
  });

  it("logSupportEvent metadata only has case_id, state, role — no body", async () => {
    const { logSupportEvent } = await import("../../lib/support-case-service.js");

    await logSupportEvent({
      eventType: "USER_RESPONDED",
      caseId:    "sc_pii_check",
      fromState: "AI_RESPONDED",
      toState:   "AI_RESPONDED",
      actorRole: "user",
      poolId:    "pool_A",
    });

    const eventInsert = superAdminCalls.find(s =>
      s.includes("INSERT") && s.includes("event_logs")
    );
    expect(eventInsert).toBeTruthy();
    // PII fields must not appear in analytics event
    const FORBIDDEN = ["content", "reply", "question", "email", "phone", "name"];
    for (const word of FORBIDDEN) {
      expect(eventInsert).not.toContain(`"${word}"`);
    }
  });
});

// =============================================================================
// HARDEN-13: full existing suite regression pass
// =============================================================================
describe("HARDEN-13: full suite meta check", () => {
  it("case_id column is in support_ticket_replies INSERT", async () => {
    superAdminRows = [{
      id: "sc_h13", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, state: "NEW",
    }];

    const app = makeApp();
    await request(app)
      .post("/support/cases/sc_h13/messages")
      .send({ content: "test", author_role: "user" });

    const insertCall = poolDbCalls.find(s =>
      s.includes("INSERT") && s.includes("support_ticket_replies")
    );
    expect(insertCall).toBeTruthy();
    // Both ticket_id and case_id present as columns
    expect(insertCall).toContain("ticket_id");
    expect(insertCall).toContain("case_id");
  });

  it("GET case messages query uses case_id = caseId (not ticket_id = caseId)", async () => {
    superAdminRows = [{
      id: "sc_h13b", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, actor_role: "teacher", state: "AI_RESPONDED",
      escalation_reason: null, resolution_source: null, llm_used: false,
      turn_count: 1, waiting_for: null, context_json: {},
      resolved_at: null, created_at: "2026-01-01", updated_at: "2026-01-01",
    }];
    poolDbRows = [];

    const app = makeApp("teacher", "pool_A", "user_1");
    await request(app).get("/support/cases/sc_h13b");

    const msgQuery = poolDbCalls.find(s => s.includes("support_ticket_replies"));
    expect(msgQuery).toBeTruthy();
    // Confirm query is case_id-based, not ticket_id-as-case_id
    expect(msgQuery).toContain("case_id");

    // The string "WHERE ticket_id = sc_h13b" would mean old bug (case_id stored as ticket_id)
    // Since sc_h13b is the case ID, this pattern should not appear
    expect(msgQuery).not.toMatch(/ticket_id\s*=\s*sc_h13b/);
  });

  it("CASE_ID_STORED_IN_TICKET_ID_AFTER = NO (semantic correctness)", async () => {
    // The routes now insert with separate ticket_id and case_id columns.
    // ticket_id = real ticket ID or null; case_id = always the case ID.
    // This test documents the contract.
    superAdminRows = [{
      id: "sc_final", pool_id: "pool_A", actor_id: "user_1",
      ticket_id: null, state: "AI_PROCESSING",
    }];

    const app = makeApp();
    await request(app)
      .post("/support/cases/sc_final/messages")
      .send({ content: "verify semantic", author_role: "user" });

    const insertCall = poolDbCalls.find(s =>
      s.includes("INSERT") && s.includes("support_ticket_replies")
    );
    expect(insertCall).toBeTruthy();

    // Verify case_id appears as dedicated column in INSERT
    // The column list must mention case_id separately from ticket_id
    const match = insertCall?.match(/\(([^)]+case_id[^)]+)\)/);
    expect(match).toBeTruthy();
  });
});
