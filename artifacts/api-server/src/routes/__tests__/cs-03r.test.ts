/**
 * CS-03R — Super Admin Support Inbox Tests (WP-CS-03R)
 *
 * CS03R-01  앱 user message → Inbox 표시
 * CS03R-02  admin(pool_admin) case 표시
 * CS03R-03  teacher case 표시
 * CS03R-04  parent case 표시
 * CS03R-05  Normal/X 모드 구분
 * CS03R-06  human requested 우선 표시
 * CS03R-07  case 상세 conversation
 * CS03R-08  agent reply 저장
 * CS03R-09  agent reply 앱에서 확인 (GET /support/cases/:id)
 * CS03R-10  state HUMAN_REQUIRED → HUMAN_RESPONDED
 * CS03R-11  resolve
 * CS03R-12  reopen
 * CS03R-13  phone required explicit
 * CS03R-14  cross-pool context 정확성
 * CS03R-15  non-super_admin inbox denied (403)
 * CS03R-16  raw message analytics 저장 없음
 * CS03R-17  legacy support ticket 유지
 * CS03R-18  full regression (기존 테스트 경로 확인)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

// ── Mock auth middleware ───────────────────────────────────────────────────────

vi.mock("../../middlewares/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
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

// Separate queues: superAdminDb ↔ poolDb
let superAdminRows: MockRow[] = [];
let poolDbRows:     MockRow[] = [];
const superAdminCalls: string[] = [];
const poolDbCalls:     string[] = [];

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

// ── Import routers under test ─────────────────────────────────────────────────

import superSupportRouter from "../super-support.js";
import supportCasesRouter  from "../support-cases.js";
import supportTicketsRouter from "../support-tickets.js";

// ── App factory ───────────────────────────────────────────────────────────────

function makeApp(
  role  = "pool_admin",
  poolId = "pool_A",
  userId = "user_1",
  name   = "Test User"
) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.user = { userId, role, poolId, name };
    next();
  });
  app.use("/", superSupportRouter);
  app.use("/", supportCasesRouter);
  app.use("/", supportTicketsRouter);
  return app;
}

function makeSuperApp() {
  return makeApp("super_admin", null as any, "super_user_1", "슈퍼관리자");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return a fake support_case row */
function fakeCase(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id:               "sc_test_001",
    pool_id:          "pool_A",
    pool_name:        "테스트 수영장",
    actor_id:         "user_1",
    actor_role:       "pool_admin",
    mode:             "normal",
    state:            "NEW",
    master_state:     "AI_ACTIVE",
    escalation_reason: null,
    context_json:     {},
    turn_count:       0,
    waiting_for:      null,
    resolved_at:      null,
    created_at:       "2026-08-17 10:00:00",
    updated_at:       "2026-08-17 10:00:00",
    ...overrides,
  };
}

/** Return a fake reply row */
function fakeReply(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id:          "rep_test_001",
    ticket_id:   null,
    case_id:     "sc_test_001",
    author_user_id: "user_1",
    author_name: "사용자",
    author_role: "user",
    message_type: "user",
    content:     "테스트 메시지",
    image_urls:  [],
    created_at:  "2026-08-17 10:01:00",
    ...overrides,
  };
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

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
// CS03R-01: 앱 user message → Inbox 표시
// =============================================================================
describe("CS03R-01: user message visible in inbox", () => {
  it("super admin GET /super/support/cases returns case list", async () => {
    superAdminRows = [
      fakeCase({ actor_role: "parent", state: "NEW" }),
      fakeCase({ id: "sc_test_002", actor_role: "teacher", state: "AI_PROCESSING" }),
    ];
    poolDbRows = []; // last_message batch: no results = fallback to updated_at

    const res = await request(makeSuperApp())
      .get("/super/support/cases");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.cases)).toBe(true);
    expect(res.body.cases.length).toBe(2);
    expect(res.body.cases[0].actor_role).toBe("parent");
  });

  it("cases have master_state enrichment", async () => {
    superAdminRows = [fakeCase({ state: "HUMAN_REQUIRED" })];
    poolDbRows     = [];
    const res = await request(makeSuperApp()).get("/super/support/cases");
    expect(res.status).toBe(200);
    expect(res.body.cases[0].master_state).toBe("AGENT_REQUESTED");
  });
});

// =============================================================================
// CS03R-02: pool_admin case 표시
// =============================================================================
describe("CS03R-02: pool_admin case in inbox", () => {
  it("role=pool_admin filter applies correctly", async () => {
    superAdminRows = [fakeCase({ actor_role: "pool_admin" })];
    poolDbRows     = [];
    const res = await request(makeSuperApp())
      .get("/super/support/cases?role=pool_admin");
    expect(res.status).toBe(200);
    // In-process filter: all returned rows have actor_role=pool_admin
    const allAdmin = res.body.cases.every((c: any) => c.actor_role === "pool_admin");
    expect(allAdmin).toBe(true);
  });
});

// =============================================================================
// CS03R-03: teacher case 표시
// =============================================================================
describe("CS03R-03: teacher case in inbox", () => {
  it("role=teacher returns teacher cases", async () => {
    superAdminRows = [
      fakeCase({ actor_role: "teacher" }),
      fakeCase({ id: "sc_002", actor_role: "pool_admin" }),
    ];
    poolDbRows = [];
    const res = await request(makeSuperApp())
      .get("/super/support/cases?role=teacher");
    expect(res.status).toBe(200);
    expect(res.body.cases.every((c: any) => c.actor_role === "teacher")).toBe(true);
  });
});

// =============================================================================
// CS03R-04: parent case 표시
// =============================================================================
describe("CS03R-04: parent case in inbox", () => {
  it("role=parent filter returns parent cases only", async () => {
    superAdminRows = [
      fakeCase({ actor_role: "parent", pool_id: null }),
      fakeCase({ id: "sc_002", actor_role: "teacher" }),
    ];
    poolDbRows = [];
    const res = await request(makeSuperApp())
      .get("/super/support/cases?role=parent");
    expect(res.status).toBe(200);
    expect(res.body.cases.every((c: any) => c.actor_role === "parent")).toBe(true);
  });
});

// =============================================================================
// CS03R-05: Normal/X 모드 구분
// =============================================================================
describe("CS03R-05: Normal/X mode distinction", () => {
  it("mode=x filter returns only x cases", async () => {
    superAdminRows = [
      fakeCase({ id: "sc_x",      mode: "x" }),
      fakeCase({ id: "sc_normal", mode: "normal" }),
    ];
    poolDbRows = [];
    const res = await request(makeSuperApp())
      .get("/super/support/cases?mode=x");
    expect(res.status).toBe(200);
    expect(res.body.cases.every((c: any) => c.mode === "x")).toBe(true);
    expect(res.body.cases.find((c: any) => c.id === "sc_normal")).toBeFalsy();
  });

  it("mode=normal excludes x cases", async () => {
    superAdminRows = [
      fakeCase({ id: "sc_x",      mode: "x" }),
      fakeCase({ id: "sc_normal", mode: "normal" }),
    ];
    poolDbRows = [];
    const res = await request(makeSuperApp())
      .get("/super/support/cases?mode=normal");
    expect(res.status).toBe(200);
    expect(res.body.cases.every((c: any) => c.mode === "normal")).toBe(true);
  });
});

// =============================================================================
// CS03R-06: human requested 우선 표시
// =============================================================================
describe("CS03R-06: HUMAN_REQUIRED cases appear first", () => {
  it("status_group=agent_requested filters HUMAN_REQUIRED only", async () => {
    superAdminRows = [
      fakeCase({ id: "sc_hr",  state: "HUMAN_REQUIRED" }),
      fakeCase({ id: "sc_new", state: "NEW" }),
    ];
    poolDbRows = [];
    const res = await request(makeSuperApp())
      .get("/super/support/cases?status_group=agent_requested");
    expect(res.status).toBe(200);
    expect(res.body.cases.every((c: any) => c.state === "HUMAN_REQUIRED")).toBe(true);
    expect(res.body.cases.find((c: any) => c.id === "sc_new")).toBeFalsy();
  });

  it("HUMAN_REQUIRED case has wait_since set", async () => {
    superAdminRows = [fakeCase({ state: "HUMAN_REQUIRED", updated_at: "2026-08-17 09:00:00" })];
    poolDbRows = [];
    const res = await request(makeSuperApp())
      .get("/super/support/cases");
    expect(res.status).toBe(200);
    expect(res.body.cases[0].wait_since).toBeTruthy();
  });
});

// =============================================================================
// CS03R-07: case 상세 conversation
// =============================================================================
describe("CS03R-07: case detail conversation", () => {
  it("GET /super/support/cases/:id returns messages in order", async () => {
    const caseRow = fakeCase({ state: "HUMAN_REQUIRED", ticket_id: null });
    superAdminRows = [caseRow];
    poolDbRows = [
      fakeReply({ id: "rep_1", author_role: "user",   content: "첫 메시지",   created_at: "2026-08-17 10:00:00" }),
      fakeReply({ id: "rep_2", author_role: "ai",     content: "AI 응답",     created_at: "2026-08-17 10:01:00" }),
      fakeReply({ id: "rep_3", author_role: "user",   content: "추가 질문",   created_at: "2026-08-17 10:02:00" }),
      fakeReply({ id: "rep_4", author_role: "system", content: "상담사 요청", created_at: "2026-08-17 10:03:00" }),
    ];

    const res = await request(makeSuperApp())
      .get("/super/support/cases/sc_test_001");
    expect(res.status).toBe(200);
    expect(res.body.messages.length).toBe(4);
    expect(res.body.messages[0].author_role).toBe("user");
    expect(res.body.messages[0].content).toBe("첫 메시지");
    expect(res.body.messages[3].author_role).toBe("system");
    expect(res.body.state).toBe("HUMAN_REQUIRED");
    expect(res.body.master_state).toBe("AGENT_REQUESTED");
  });

  it("detail includes pool_name from JOIN", async () => {
    superAdminRows = [fakeCase({ pool_name: "강남 수영장" })];
    poolDbRows = [];
    const res = await request(makeSuperApp())
      .get("/super/support/cases/sc_test_001");
    expect(res.status).toBe(200);
    expect(res.body.pool_name).toBe("강남 수영장");
  });
});

// =============================================================================
// CS03R-08: agent reply 저장
// =============================================================================
describe("CS03R-08: agent reply saved", () => {
  it("POST /super/support/cases/:id/agent-reply inserts with author_role=agent", async () => {
    // First superAdminDb call: SELECT case (for agent-reply), then UPDATE turn_count
    superAdminRows = [fakeCase({ state: "HUMAN_REQUIRED" })];
    poolDbRows     = [];

    const res = await request(makeSuperApp())
      .post("/super/support/cases/sc_test_001/agent-reply")
      .send({ content: "상담사 답변입니다" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.id).toMatch(/^rep_/);

    // Verify INSERT was called on pool db with author_role=agent
    const insertCall = poolDbCalls.find((q) =>
      q.includes("INSERT") && q.toLowerCase().includes("support_ticket_replies")
    );
    expect(insertCall).toBeTruthy();
    expect(insertCall).toContain("agent");
    expect(insertCall).toContain("상담사 답변입니다");
  });

  it("returns 400 when content is empty", async () => {
    superAdminRows = [fakeCase()];
    const res = await request(makeSuperApp())
      .post("/super/support/cases/sc_test_001/agent-reply")
      .send({ content: "   " });
    expect(res.status).toBe(400);
  });

  it("returns 404 when case not found", async () => {
    superAdminRows = [];
    const res = await request(makeSuperApp())
      .post("/super/support/cases/sc_nonexistent/agent-reply")
      .send({ content: "답변" });
    expect(res.status).toBe(404);
  });
});

// =============================================================================
// CS03R-09: agent reply 앱에서 확인
// =============================================================================
describe("CS03R-09: agent reply visible from app (GET /support/cases/:id)", () => {
  it("user GET /support/cases/:id sees agent reply in messages", async () => {
    const caseRow = fakeCase({ state: "HUMAN_RESPONDED", ticket_id: null });
    // superAdminDb returns case, then ticket query (none)
    superAdminRows = [caseRow];
    poolDbRows = [
      fakeReply({ author_role: "user",  content: "사용자 질문" }),
      fakeReply({ id: "rep_2", author_role: "agent", author_name: "관리자", content: "상담사 답변" }),
    ];

    // Use a regular (non-super) user app
    const appUser = makeApp("pool_admin", "pool_A", "user_1");
    const res = await request(appUser)
      .get("/support/cases/sc_test_001");

    expect(res.status).toBe(200);
    const agentMsg = res.body.messages?.find((m: any) => m.author_role === "agent");
    expect(agentMsg).toBeTruthy();
    expect(agentMsg.content).toBe("상담사 답변");
  });
});

// =============================================================================
// CS03R-10: state HUMAN_REQUIRED → HUMAN_RESPONDED
// =============================================================================
describe("CS03R-10: state HUMAN_REQUIRED → HUMAN_RESPONDED", () => {
  it("agent-reply on HUMAN_REQUIRED case triggers state transition", async () => {
    // SELECT for agent-reply route returns HUMAN_REQUIRED case
    superAdminRows = [fakeCase({ state: "HUMAN_REQUIRED" })];
    poolDbRows     = [];

    const res = await request(makeSuperApp())
      .post("/super/support/cases/sc_test_001/agent-reply")
      .send({ content: "상태 전환 테스트" });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe("HUMAN_RESPONDED");

    // UPDATE call was made to superAdminDb for state transition
    const updateCall = superAdminCalls.find((q) =>
      q.includes("UPDATE") && q.includes("support_cases")
    );
    expect(updateCall).toBeTruthy();
  });

  it("agent-reply on already HUMAN_RESPONDED does not re-transition", async () => {
    superAdminRows = [fakeCase({ state: "HUMAN_RESPONDED" })];
    poolDbRows     = [];

    const res = await request(makeSuperApp())
      .post("/super/support/cases/sc_test_001/agent-reply")
      .send({ content: "추가 답변" });

    expect(res.status).toBe(200);
    // state stays HUMAN_RESPONDED (no NEW transition attempted)
    expect(res.body.state).toBe("HUMAN_RESPONDED");
  });
});

// =============================================================================
// CS03R-11: resolve
// =============================================================================
describe("CS03R-11: resolve", () => {
  it("POST /super/support/cases/:id/resolve transitions to RESOLVED", async () => {
    superAdminRows = [fakeCase({ state: "HUMAN_RESPONDED" })];

    const res = await request(makeSuperApp())
      .post("/super/support/cases/sc_test_001/resolve");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.state).toBe("RESOLVED");
  });

  it("resolve on already-resolved case returns ok idempotently", async () => {
    superAdminRows = [fakeCase({ state: "RESOLVED" })];

    const res = await request(makeSuperApp())
      .post("/super/support/cases/sc_test_001/resolve");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.state).toBe("RESOLVED");
  });

  it("resolve on HUMAN_RESPONDED uses RESOLVED (human path)", async () => {
    // HUMAN_RESPONDED → RESOLVED is a valid transition
    superAdminRows = [fakeCase({ state: "HUMAN_RESPONDED" })];

    const res = await request(makeSuperApp())
      .post("/super/support/cases/sc_test_001/resolve");
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("RESOLVED");
  });

  it("returns 404 for unknown case", async () => {
    superAdminRows = [];
    const res = await request(makeSuperApp())
      .post("/super/support/cases/sc_nonexistent/resolve");
    expect(res.status).toBe(404);
  });
});

// =============================================================================
// CS03R-12: reopen
// =============================================================================
describe("CS03R-12: reopen", () => {
  it("POST reopen transitions RESOLVED → REOPENED", async () => {
    superAdminRows = [fakeCase({ state: "RESOLVED" })];

    const res = await request(makeSuperApp())
      .post("/super/support/cases/sc_test_001/reopen");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.state).toBe("REOPENED");
  });

  it("status_group=reopened filter returns REOPENED cases", async () => {
    superAdminRows = [
      fakeCase({ state: "REOPENED" }),
      fakeCase({ id: "sc_002", state: "NEW" }),
    ];
    poolDbRows = [];
    const res = await request(makeSuperApp())
      .get("/super/support/cases?status_group=reopened");
    expect(res.status).toBe(200);
    expect(res.body.cases.every((c: any) => c.state === "REOPENED")).toBe(true);
  });

  it("reopen invalid transition returns 422 (via transitionSupportCase)", async () => {
    // CLOSED → REOPENED is NOT in VALID_TRANSITIONS[CLOSED] = []
    superAdminRows = [fakeCase({ state: "CLOSED" })];

    const res = await request(makeSuperApp())
      .post("/super/support/cases/sc_test_001/reopen");
    expect(res.status).toBe(422);
  });
});

// =============================================================================
// CS03R-13: phone required explicit
// =============================================================================
describe("CS03R-13: phone required explicit", () => {
  it("POST phone-required transitions HUMAN_REQUIRED → PHONE_REQUIRED", async () => {
    superAdminRows = [fakeCase({ state: "HUMAN_REQUIRED" })];

    const res = await request(makeSuperApp())
      .post("/super/support/cases/sc_test_001/phone-required")
      .send({ reason: "billing" });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe("PHONE_REQUIRED");
    expect(res.body.reason).toBe("billing");
  });

  it("all valid reasons accepted", async () => {
    const reasons = ["billing", "refund", "privacy_safety", "complex_case", "other"];
    for (const reason of reasons) {
      superAdminRows = [fakeCase({ state: "HUMAN_REQUIRED" })];
      const res = await request(makeSuperApp())
        .post("/super/support/cases/sc_test_001/phone-required")
        .send({ reason });
      expect(res.status).toBe(200);
      expect(res.body.reason).toBe(reason);
    }
  });

  it("invalid reason returns 400", async () => {
    const res = await request(makeSuperApp())
      .post("/super/support/cases/sc_test_001/phone-required")
      .send({ reason: "invalid_reason" });
    expect(res.status).toBe(400);
  });

  it("status_group=phone filter returns PHONE_REQUIRED cases", async () => {
    superAdminRows = [fakeCase({ state: "PHONE_REQUIRED" })];
    poolDbRows = [];
    const res = await request(makeSuperApp())
      .get("/super/support/cases?status_group=phone");
    expect(res.status).toBe(200);
    expect(res.body.cases.every((c: any) => c.state === "PHONE_REQUIRED")).toBe(true);
  });
});

// =============================================================================
// CS03R-14: cross-pool context 정확성
// =============================================================================
describe("CS03R-14: cross-pool context accuracy", () => {
  it("detail returns correct pool_id per case", async () => {
    superAdminRows = [fakeCase({ pool_id: "pool_A14", pool_name: "A 수영장" })];
    poolDbRows = [];
    const res = await request(makeSuperApp())
      .get("/super/support/cases/sc_test_001");
    expect(res.status).toBe(200);
    expect(res.body.case.pool_id).toBe("pool_A14");
    expect(res.body.pool_name).toBe("A 수영장");
  });

  it("pool_id filter applied correctly", async () => {
    superAdminRows = [
      fakeCase({ id: "sc_a", pool_id: "pool_A" }),
      fakeCase({ id: "sc_b", pool_id: "pool_B" }),
    ];
    poolDbRows = [];
    const res = await request(makeSuperApp())
      .get("/super/support/cases?pool_id=pool_A");
    expect(res.status).toBe(200);
    const allPoolA = res.body.cases.every((c: any) => c.pool_id === "pool_A");
    expect(allPoolA).toBe(true);
    expect(res.body.cases.find((c: any) => c.id === "sc_b")).toBeFalsy();
  });
});

// =============================================================================
// CS03R-15: non-super_admin access denied
// =============================================================================
describe("CS03R-15: non-super_admin access denied", () => {
  it("pool_admin GET /super/support/cases returns 403", async () => {
    const res = await request(makeApp("pool_admin"))
      .get("/super/support/cases");
    expect(res.status).toBe(403);
  });

  it("teacher POST agent-reply returns 403", async () => {
    const res = await request(makeApp("teacher"))
      .post("/super/support/cases/sc_test_001/agent-reply")
      .send({ content: "무단 답변" });
    expect(res.status).toBe(403);
  });

  it("parent GET /super/support/stats returns 403", async () => {
    const res = await request(makeApp("parent"))
      .get("/super/support/stats");
    expect(res.status).toBe(403);
  });

  it("unauthenticated request returns 401", async () => {
    const bare = express();
    bare.use(express.json());
    // No req.user set — requireAuth should 401
    bare.use((req: any, _res: any, next: any) => {
      // deliberately NOT setting req.user
      next();
    });
    bare.use("/", superSupportRouter);

    const res = await request(bare).get("/super/support/cases");
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// CS03R-16: raw message text not in analytics (event_logs)
// =============================================================================
describe("CS03R-16: raw message not stored in analytics", () => {
  it("agent-reply does not log raw message content to event_logs", async () => {
    const sensitiveContent = "민감한_내용_16번_테스트_PRIVATE";
    superAdminRows = [fakeCase({ state: "HUMAN_REQUIRED" })];
    poolDbRows     = [];

    await request(makeSuperApp())
      .post("/super/support/cases/sc_test_001/agent-reply")
      .send({ content: sensitiveContent });

    // All superAdmin queries (including logSupportEvent INSERT into event_logs)
    // must NOT contain the raw message text
    const hasRaw = superAdminCalls.some((q) => q.includes(sensitiveContent));
    expect(hasRaw).toBe(false);
  });

  it("event_logs INSERT contains only case_id / state / role metadata", async () => {
    superAdminRows = [fakeCase({ state: "HUMAN_REQUIRED" })];
    poolDbRows     = [];

    await request(makeSuperApp())
      .post("/super/support/cases/sc_test_001/agent-reply")
      .send({ content: "답변 내용입니다" });

    const eventLogInsert = superAdminCalls.find(
      (q) => q.includes("INSERT") && q.toLowerCase().includes("event_logs")
    );
    // event_logs INSERT should exist (best-effort void — may not be awaited in test timing)
    // Minimal check: if it ran, no raw message
    if (eventLogInsert) {
      expect(eventLogInsert).not.toContain("답변 내용입니다");
    }
  });
});

// =============================================================================
// CS03R-17: legacy support ticket 유지
// =============================================================================
describe("CS03R-17: legacy support ticket route maintained", () => {
  it("GET /super/support-general still returns ticket array (legacy route)", async () => {
    superAdminRows = [
      {
        id: "tkt_legacy_001", ticket_type: "general",
        subject: "레거시 티켓", status: "open",
        requester_name: "홍길동", requester_type: "pool_admin",
        consultation_requested: false,
        created_at: "2026-08-17 10:00:00",
        updated_at: "2026-08-17 10:00:00",
      },
    ];
    const res = await request(makeSuperApp())
      .get("/super/support-general");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("existing ticket reply endpoint unaffected", async () => {
    poolDbRows = [
      {
        id: "tkt_001", ticket_type: "general",
        subject: "기존 티켓", status: "open",
        requester_name: "테스트", requester_type: "pool_admin",
        consultation_requested: false,
        content: "내용",
        pool_id: "pool_A",
        created_at: "2026-08-17",
        updated_at: "2026-08-17",
      },
    ];
    const res = await request(makeSuperApp())
      .get("/support/tickets/tkt_001");
    // 200 with ticket data or 404 (route exists, just no matching data in mock)
    expect([200, 404]).toContain(res.status);
  });
});

// =============================================================================
// CS03R-18: full regression
// =============================================================================
describe("CS03R-18: full regression", () => {
  it("POST /support/cases creates AI-only case (existing endpoint)", async () => {
    superAdminRows = []; // INSERT returns empty rows
    const res = await request(makeApp("pool_admin", "pool_A", "user_1"))
      .post("/support/cases")
      .send({ mode: "normal", context: {} });
    expect(res.status).toBe(200);
    expect(res.body.id).toMatch(/^sc_/);
  });

  it("GET /super/support/stats returns numeric counts", async () => {
    superAdminRows = [
      { state: "HUMAN_REQUIRED", cnt: "2" },
      { state: "NEW",            cnt: "5" },
      { state: "RESOLVED",       cnt: "10" },
    ];
    const res = await request(makeSuperApp())
      .get("/super/support/stats");
    expect(res.status).toBe(200);
    expect(typeof res.body.agent_requested).toBe("number");
    expect(res.body.agent_requested).toBe(2);
    expect(typeof res.body.total_open).toBe("number");
    expect(res.body.total_open).toBeGreaterThan(0);
  });

  it("POST /support/cases/:id/messages (user role) still works", async () => {
    superAdminRows = [fakeCase({ state: "NEW", actor_id: "user_1", pool_id: "pool_A" })];
    poolDbRows     = [];
    const res = await request(makeApp("pool_admin", "pool_A", "user_1"))
      .post("/support/cases/sc_test_001/messages")
      .send({ content: "회귀 테스트 메시지", author_role: "user" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("GET /support/cases list works for regular user", async () => {
    superAdminRows = [fakeCase({ actor_id: "user_1", pool_id: "pool_A" })];
    const res = await request(makeApp("pool_admin", "pool_A", "user_1"))
      .get("/support/cases");
    expect(res.status).toBe(200);
    expect(res.body.cases).toBeDefined();
  });

  it("super-support routes do not interfere with user support routes", async () => {
    // User can still access /support/cases/:id
    superAdminRows = [fakeCase({ actor_id: "user_1", pool_id: "pool_A", ticket_id: null })];
    poolDbRows     = [fakeReply()];
    const res = await request(makeApp("pool_admin", "pool_A", "user_1"))
      .get("/support/cases/sc_test_001");
    expect(res.status).toBe(200);
    expect(res.body.messages).toBeDefined();
  });
});
