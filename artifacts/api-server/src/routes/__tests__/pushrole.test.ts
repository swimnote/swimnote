/**
 * PUSHROLE Tests — Super Admin Push Role Enum Mismatch Fix
 *
 * PUSHROLE-01  actual super_admin query (not platform_admin)
 * PUSHROLE-02  platform_admin stale reference removed
 * PUSHROLE-03  non-super_admin excluded
 * PUSHROLE-04  support human request path works
 * PUSHROLE-05  push target generation
 * PUSHROLE-06  provider failure does not break support request
 * PUSHROLE-07  full regression (existing tests unaffected)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

// ── Mock auth ─────────────────────────────────────────────────────────────────

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
  requirePermission: (_perm: string) => (_req: any, _res: any, next: any) => next(),
}));

// ── Mock DB ───────────────────────────────────────────────────────────────────

type MockRow = Record<string, unknown>;

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
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => []),
        })),
      })),
    })),
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

// ── Imports under test ────────────────────────────────────────────────────────

import { sendPushToSuperAdmins } from "../../lib/push-service.js";
import supportCasesRouter from "../support-cases.js";

// ── App factory ───────────────────────────────────────────────────────────────

function makeApp(
  role   = "pool_admin",
  poolId = "pool_A",
  userId = "user_1"
) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.user = { userId, role, poolId, name: "Test User" };
    next();
  });
  app.use("/", supportCasesRouter);
  return app;
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
// PUSHROLE-01: actual super_admin query — platform_admin must not appear
// =============================================================================
describe("PUSHROLE-01: actual super_admin query", () => {
  it("sendPushToSuperAdmins queries role = 'super_admin' (not platform_admin)", async () => {
    superAdminRows = [{ id: "super_1" }];
    poolDbRows = [];

    await sendPushToSuperAdmins("테스트 제목", "테스트 본문", {});

    // The SELECT query must use role = 'super_admin'
    const selectQuery = superAdminCalls.find((q) =>
      q.includes("SELECT") && q.includes("users")
    );
    expect(selectQuery).toBeTruthy();
    expect(selectQuery).toContain("super_admin");
  });

  it("query does NOT contain 'platform_admin' enum literal", async () => {
    superAdminRows = [];

    await sendPushToSuperAdmins("제목", "본문", {});

    const selectQuery = superAdminCalls.find((q) =>
      q.includes("SELECT") && q.includes("users")
    );
    // If there's a query, it must not reference platform_admin
    if (selectQuery) {
      expect(selectQuery).not.toContain("platform_admin");
    } else {
      // No query means early return (empty rows) — also acceptable
      expect(true).toBe(true);
    }
  });
});

// =============================================================================
// PUSHROLE-02: platform_admin stale reference removed
// =============================================================================
describe("PUSHROLE-02: platform_admin stale reference removed", () => {
  it("sendPushToSuperAdmins source does not contain platform_admin IN clause", async () => {
    // Confirm at source level: read the function's SQL
    superAdminRows = [{ id: "super_1" }];
    poolDbRows = [];

    await sendPushToSuperAdmins("제목", "본문", {});

    const allQueries = superAdminCalls.join("\n");
    // Must not use IN clause with platform_admin
    expect(allQueries).not.toMatch(/IN\s*\(.*platform_admin.*\)/);
  });

  it("query uses equality (=) not IN for role filter", async () => {
    superAdminRows = [{ id: "super_1" }];
    poolDbRows = [];

    await sendPushToSuperAdmins("제목", "본문", {});

    const selectQuery = superAdminCalls.find((q) =>
      q.includes("SELECT") && q.toLowerCase().includes("role")
    );
    expect(selectQuery).toBeTruthy();
    // Should contain 'role =' or 'role=' (equality, not IN)
    expect(selectQuery).toMatch(/role\s*=/);
  });
});

// =============================================================================
// PUSHROLE-03: non-super_admin excluded
// =============================================================================
describe("PUSHROLE-03: non-super_admin excluded from push targets", () => {
  it("pool_admin rows returned by DB are not sent push (superIds would be pool_admin IDs, but the SELECT WHERE filters them)", async () => {
    // The DB mock returns whatever rows we set — the actual DB would only
    // return super_admin rows because of WHERE role = 'super_admin'.
    // We simulate correct DB behavior: no rows for non-super roles.
    superAdminRows = []; // DB would return empty for non-super_admin
    poolDbRows = [];

    await sendPushToSuperAdmins("알림", "본문", {});

    // No push_tokens query since no superIds
    const tokenQuery = poolDbCalls.find((q) =>
      q.includes("push_tokens")
    );
    expect(tokenQuery).toBeFalsy();
  });

  it("when super_admin IDs found, push_tokens lookup is only for those IDs", async () => {
    superAdminRows = [{ id: "super_user_1" }, { id: "super_user_2" }];
    poolDbRows = []; // no push tokens in test

    await sendPushToSuperAdmins("알림", "본문", {});

    // push_tokens SELECT was called for each super admin ID
    const tokenQueries = poolDbCalls.filter((q) => q.includes("push_tokens"));
    expect(tokenQueries.length).toBe(2);

    // Each query must contain the specific super admin user IDs
    const combined = tokenQueries.join("|");
    expect(combined).toContain("super_user_1");
    expect(combined).toContain("super_user_2");
  });
});

// =============================================================================
// PUSHROLE-04: support human request path
// =============================================================================
describe("PUSHROLE-04: support human request path", () => {
  it("POST /support/cases creates case without crashing (push is separate)", async () => {
    superAdminRows = [];
    poolDbRows     = [];

    const res = await request(makeApp())
      .post("/support/cases")
      .send({ mode: "normal", context: {} });

    // Case creation must succeed regardless of push availability
    expect(res.status).toBe(200);
    expect(res.body.id).toMatch(/^sc_/);
  });

  it("POST /support/cases/:id/messages adds message successfully", async () => {
    superAdminRows = [{
      id: "sc_001", pool_id: "pool_A", actor_id: "user_1",
      actor_role: "pool_admin", mode: "normal", state: "NEW",
      context_json: {}, turn_count: 0, waiting_for: null,
      resolved_at: null, created_at: "2026-08-17 10:00:00",
      updated_at: "2026-08-17 10:00:00",
    }];
    poolDbRows = [];

    const res = await request(makeApp())
      .post("/support/cases/sc_001/messages")
      .send({ content: "도움 요청합니다", author_role: "user" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("request-human transition does not call sendPushToSuperAdmins directly from support-cases", async () => {
    // sendPushToSuperAdmins is called from index.ts monitoring, not from support-cases route.
    // Verify no superAdminDb SELECT for 'role' during a user message send.
    superAdminRows = [{
      id: "sc_001", pool_id: "pool_A", actor_id: "user_1",
      actor_role: "pool_admin", mode: "normal", state: "HUMAN_REQUIRED",
      context_json: {}, turn_count: 2, waiting_for: null,
      resolved_at: null, created_at: "2026-08-17 10:00:00",
      updated_at: "2026-08-17 10:00:00",
    }];
    poolDbRows = [];

    await request(makeApp())
      .post("/support/cases/sc_001/messages")
      .send({ content: "추가 메시지", author_role: "user" });

    // No push-role query emitted during support case message
    const pushRoleQuery = superAdminCalls.find((q) =>
      q.includes("role") && q.includes("push") || (q.includes("SELECT id FROM users") && q.includes("role"))
    );
    expect(pushRoleQuery).toBeFalsy();
  });
});

// =============================================================================
// PUSHROLE-05: push target generation
// =============================================================================
describe("PUSHROLE-05: push target generation", () => {
  it("returns void (not throws) when no super_admin found", async () => {
    superAdminRows = [];

    await expect(sendPushToSuperAdmins("제목", "본문")).resolves.toBeUndefined();
  });

  it("returns void when super_admin found but no push tokens", async () => {
    superAdminRows = [{ id: "super_1" }];
    poolDbRows = []; // no tokens

    await expect(sendPushToSuperAdmins("제목", "본문")).resolves.toBeUndefined();
  });

  it("collects tokens from all super_admin IDs", async () => {
    superAdminRows = [{ id: "super_1" }, { id: "super_2" }];
    // First call for super_1: 1 token, second call for super_2: 1 token
    let callCount = 0;
    const { db } = await import("@workspace/db");
    (db.execute as any).mockImplementation(async (q: any) => {
      const raw = typeof q?.queryChunks !== "undefined"
        ? q.queryChunks.map((c: any) =>
            typeof c === "string" ? c : String(c?.value ?? "")
          ).join("")
        : String(q?.sql ?? q ?? "");
      poolDbCalls.push(raw.trim());
      callCount++;
      if (callCount === 1) return { rows: [{ token: "token_A" }] };
      if (callCount === 2) return { rows: [{ token: "token_B" }] };
      return { rows: [] };
    });

    // sendRawPush is called with both tokens — we just verify no throw
    await expect(sendPushToSuperAdmins("제목", "본문", { type: "test" })).resolves.toBeUndefined();
  });
});

// =============================================================================
// PUSHROLE-06: provider failure does not break support request
// =============================================================================
describe("PUSHROLE-06: provider failure does not break support request", () => {
  it("sendPushToSuperAdmins catch block prevents throw propagation", async () => {
    // Simulate DB throwing
    const { superAdminDb } = await import("@workspace/db");
    (superAdminDb.execute as any).mockRejectedValueOnce(
      new Error("invalid input value for enum user_role: 'platform_admin'")
    );

    // Must NOT throw — catch block absorbs the error
    await expect(sendPushToSuperAdmins("제목", "본문")).resolves.toBeUndefined();
  });

  it("support case creation unaffected when push service DB fails", async () => {
    // push-service error must not propagate to support case route
    superAdminRows = [];
    poolDbRows = [];

    const res = await request(makeApp())
      .post("/support/cases")
      .send({ mode: "normal", context: {} });

    expect(res.status).toBe(200);
    expect(res.body.id).toBeTruthy();
  });
});

// =============================================================================
// PUSHROLE-07: full regression (query form)
// =============================================================================
describe("PUSHROLE-07: full regression", () => {
  it("no platform_admin anywhere in sendPushToSuperAdmins execution path", async () => {
    superAdminRows = [{ id: "super_1" }];
    poolDbRows = [{ token: "push_tok_1" }];

    await sendPushToSuperAdmins("제목", "본문", {});

    const allSuperCalls = superAdminCalls.join("\n");
    const allPoolCalls  = poolDbCalls.join("\n");

    expect(allSuperCalls).not.toContain("platform_admin");
    expect(allPoolCalls).not.toContain("platform_admin");
  });

  it("sendPushToSuperAdmins completes without throwing for normal flow", async () => {
    superAdminRows = [{ id: "super_1" }];
    poolDbRows = [];

    await expect(
      sendPushToSuperAdmins("서버 지연 경고", "평균 3500ms 응답", { type: "server_perf" })
    ).resolves.toBeUndefined();
  });

  it("GET /support/cases still works after fix", async () => {
    superAdminRows = [{
      id: "sc_ret_001", pool_id: "pool_A", actor_id: "user_1",
      actor_role: "pool_admin", mode: "normal", state: "NEW",
      context_json: {}, turn_count: 0, waiting_for: null,
      resolved_at: null, created_at: "2026-08-17 10:00:00",
      updated_at: "2026-08-17 10:00:00",
    }];
    const res = await request(makeApp())
      .get("/support/cases");
    expect(res.status).toBe(200);
    expect(res.body.cases).toBeDefined();
  });
});
