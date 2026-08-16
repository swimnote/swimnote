// wp3-x-request.test.ts -- WP3 X Curriculum Setup Request
//
// 검증 대상:
//   A. POST /pools/x-request — 커리큘럼 요청 제출
//   B. GET  /pools/x-request — 요청 상태 조회
//
// 보장:
//   - unauthenticated/teacher/parent → 401/403
//   - entitlement=false → 403
//   - NOT_CONFIGURED → request 생성 + CURRICULUM_PENDING + audit log
//   - 원자성: INSERT + UPDATE + audit 3개 모두 실행
//   - duplicate 방지 (pending/reviewing)
//   - READY pool → 새 request 금지
//   - GET: 자기 pool 요청만 반환
//   - GET: pending/reviewing 우선, 없으면 최신
//   - GET /pools/x-mode regression
//   - WP2 tests regression (import만 확인)

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── @workspace/db mock ──────────────────────────────────────────────────────
vi.mock("@workspace/db", () => {
  const mockExecute = vi.fn();
  const mockTransaction = vi.fn();
  return {
    superAdminDb: { execute: mockExecute, transaction: mockTransaction },
    db:           { execute: mockExecute, transaction: mockTransaction },
  };
});

// ── auth middleware mock ────────────────────────────────────────────────────
vi.mock("../../middlewares/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    if (!req._mockUser) {
      _res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.user = req._mockUser;
    next();
  },
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => {
    if (!req._mockUser || !roles.includes(req._mockUser.role)) {
      res.status(403).json({ error: "권한이 없습니다." });
      return;
    }
    next();
  },
}));

// ── 기타 의존성 mock ────────────────────────────────────────────────────────
vi.mock("../../lib/xmode.js", () => ({
  resolvePoolMode: vi.fn().mockResolvedValue(null),
  computeMode: vi.fn().mockReturnValue("normal"),
}));
vi.mock("../../lib/auth.js", () => ({ signToken: vi.fn().mockReturnValue("tok") }));
vi.mock("../../lib/subscriptionService.js", () => ({ resolveSubscription: vi.fn() }));
vi.mock("../../lib/defaultTemplates.js", () => ({ insertDefaultTemplates: vi.fn() }));
vi.mock("../../utils/filename.js", () => ({ sanitizePoolName: (s: string) => s }));
vi.mock("@replit/object-storage", () => ({ Client: vi.fn().mockImplementation(() => ({})) }));
vi.mock("@workspace/db/schema", () => ({
  swimmingPoolsTable: {}, usersTable: {}, parentAccountsTable: {},
}));
vi.mock("drizzle-orm", () => ({
  sql: new Proxy((() => ({})) as any, {
    get: (_t, k) => k === "raw" ? () => ({}) : () => ({}),
    apply: () => ({}),
  }),
  eq: () => ({}),
}));

import { superAdminDb } from "@workspace/db";
import express from "express";
import request from "supertest";
import poolsRouter from "../pools.js";

const mockExecute   = superAdminDb.execute   as ReturnType<typeof vi.fn>;
const mockTransaction = (superAdminDb as any).transaction as ReturnType<typeof vi.fn>;

function makeApp(user?: { userId: string; role: string }) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req._mockUser = user ?? null; next(); });
  app.use("/pools", poolsRouter);
  return app;
}

const POOL_ADMIN_USER = { userId: "user_admin_1", role: "pool_admin" };
const TEACHER_USER    = { userId: "user_teacher_1", role: "teacher" };
const PARENT_USER     = { userId: "user_parent_1", role: "parent_account" };

const POOL_ID = "pool_test_wp3";
const REQUEST_ID = "cr_test001";

// ── Transaction 시뮬레이션 헬퍼 ────────────────────────────────────────────
// 실제 transaction 콜백을 즉시 실행하는 mock
function setupTransactionMock(executeResponses: Array<{ rows: unknown[] }>) {
  let call = 0;
  const txExecute = vi.fn().mockImplementation(() =>
    Promise.resolve(executeResponses[call++] ?? { rows: [] })
  );
  mockTransaction.mockImplementation(async (fn: any) => {
    await fn({ execute: txExecute });
  });
  return txExecute;
}

// pool_admin userId→poolId 조회 응답 (transaction 바깥)
function setupUserRow() {
  mockExecute.mockResolvedValueOnce({ rows: [{ swimming_pool_id: POOL_ID }] });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// A. POST /pools/x-request
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("POST /pools/x-request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. unauthenticated → 401
  it("1. unauthenticated → 401", async () => {
    const res = await request(makeApp()).post("/pools/x-request").send({});
    expect(res.status).toBe(401);
  });

  // 2. teacher → 403
  it("2. teacher role → 403", async () => {
    const res = await request(makeApp(TEACHER_USER)).post("/pools/x-request").send({});
    expect(res.status).toBe(403);
  });

  // 3. parent_account → 403
  it("3. parent_account role → 403", async () => {
    const res = await request(makeApp(PARENT_USER)).post("/pools/x-request").send({});
    expect(res.status).toBe(403);
  });

  // 4. pool_admin entitlement=false → 403
  it("4. pool_admin entitlement=false → 403", async () => {
    setupUserRow();
    setupTransactionMock([
      // X02-B2: x_paid/x_manual/x_force 구조
      { rows: [{ id: POOL_ID, x_paid_entitlement: false, x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "NOT_CONFIGURED" }] },
    ]);
    const res = await request(makeApp(POOL_ADMIN_USER)).post("/pools/x-request").send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NO_ENTITLEMENT");
  });

  // 5. NOT_CONFIGURED → request 생성 성공 (201)
  it("5. NOT_CONFIGURED → 201, request 생성", async () => {
    setupUserRow();
    setupTransactionMock([
      { rows: [{ id: POOL_ID, x_paid_entitlement: true, x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "NOT_CONFIGURED" }] }, // pool FOR UPDATE
      { rows: [] },                                                                                   // dup check (없음)
      { rows: [{ id: REQUEST_ID, request_status: "pending", title: "SWIMNOTE X 커리큘럼 설정 요청", created_at: new Date().toISOString() }] }, // INSERT
      { rows: [] },                                                                                   // UPDATE swimming_pools
      { rows: [{ v: 2 }] },                                                                          // next_audit_version
      { rows: [] },                                                                                   // INSERT audit_logs
    ]);
    const res = await request(makeApp(POOL_ADMIN_USER)).post("/pools/x-request").send({});
    expect(res.status).toBe(201);
    expect(res.body.request).toBeDefined();
    expect(res.body.pool_mode).toBeDefined();
  });

  // 6. response: request_status = 'pending'
  it("6. response request_status = pending", async () => {
    setupUserRow();
    setupTransactionMock([
      { rows: [{ id: POOL_ID, x_paid_entitlement: true, x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "NOT_CONFIGURED" }] },
      { rows: [] },
      { rows: [{ id: REQUEST_ID, request_status: "pending", title: "SWIMNOTE X 커리큘럼 설정 요청", created_at: new Date().toISOString() }] },
      { rows: [] },
      { rows: [{ v: 1 }] },
      { rows: [] },
    ]);
    const res = await request(makeApp(POOL_ADMIN_USER)).post("/pools/x-request").send({});
    expect(res.body.request.request_status).toBe("pending");
  });

  // 7. response: pool_mode.xmode_config_status = CURRICULUM_PENDING
  it("7. response pool_mode.xmode_config_status = CURRICULUM_PENDING", async () => {
    setupUserRow();
    setupTransactionMock([
      { rows: [{ id: POOL_ID, x_paid_entitlement: true, x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "NOT_CONFIGURED" }] },
      { rows: [] },
      { rows: [{ id: REQUEST_ID, request_status: "pending", title: "t", created_at: new Date().toISOString() }] },
      { rows: [] },
      { rows: [{ v: 1 }] },
      { rows: [] },
    ]);
    const res = await request(makeApp(POOL_ADMIN_USER)).post("/pools/x-request").send({});
    expect(res.body.pool_mode.xmode_config_status).toBe("CURRICULUM_PENDING");
  });

  // 8. response: pool_mode.mode = x_pending
  it("8. response pool_mode.mode = x_pending", async () => {
    setupUserRow();
    setupTransactionMock([
      { rows: [{ id: POOL_ID, x_paid_entitlement: true, x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "NOT_CONFIGURED" }] },
      { rows: [] },
      { rows: [{ id: REQUEST_ID, request_status: "pending", title: "t", created_at: new Date().toISOString() }] },
      { rows: [] },
      { rows: [{ v: 1 }] },
      { rows: [] },
    ]);
    const res = await request(makeApp(POOL_ADMIN_USER)).post("/pools/x-request").send({});
    expect(res.body.pool_mode.mode).toBe("x_pending");
  });

  // 9. audit log 생성: transaction에서 next_audit_version + INSERT 호출
  it("9. audit log: next_audit_version + INSERT audit_logs 호출", async () => {
    setupUserRow();
    const txExecute = setupTransactionMock([
      { rows: [{ id: POOL_ID, x_paid_entitlement: true, x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "NOT_CONFIGURED" }] },
      { rows: [] },
      { rows: [{ id: REQUEST_ID, request_status: "pending", title: "t", created_at: new Date().toISOString() }] },
      { rows: [] },
      { rows: [{ v: 3 }] },
      { rows: [] },
    ]);
    await request(makeApp(POOL_ADMIN_USER)).post("/pools/x-request").send({});
    // tx.execute 6번 호출: pool, dup, INSERT cr, UPDATE pool, audit_version, INSERT audit
    expect(txExecute).toHaveBeenCalledTimes(6);
  });

  // 10. 원자성: transaction 내 모든 DB 변경
  it("10. transaction callback 호출됨 (원자성 보장)", async () => {
    setupUserRow();
    setupTransactionMock([
      { rows: [{ id: POOL_ID, x_paid_entitlement: true, x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "NOT_CONFIGURED" }] },
      { rows: [] },
      { rows: [{ id: REQUEST_ID, request_status: "pending", title: "t", created_at: new Date().toISOString() }] },
      { rows: [] },
      { rows: [{ v: 1 }] },
      { rows: [] },
    ]);
    await request(makeApp(POOL_ADMIN_USER)).post("/pools/x-request").send({});
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  // 11. pending 요청 존재 시 duplicate 방지 → 409
  it("11. pending 요청 있을 때 ALREADY_PENDING (CURRICULUM_PENDING config_status) → 409", async () => {
    setupUserRow();
    setupTransactionMock([
      { rows: [{ id: POOL_ID, x_paid_entitlement: true, x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "CURRICULUM_PENDING" }] },
      { rows: [{ id: REQUEST_ID, request_status: "pending", title: "t", created_at: new Date().toISOString() }] }, // active request
    ]);
    const res = await request(makeApp(POOL_ADMIN_USER)).post("/pools/x-request").send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ALREADY_PENDING");
  });

  // 12. reviewing 요청 존재 시 duplicate 방지 → 409
  it("12. config_status=CURRICULUM_PENDING + reviewing 요청 → 409", async () => {
    setupUserRow();
    setupTransactionMock([
      { rows: [{ id: POOL_ID, x_paid_entitlement: true, x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "CURRICULUM_PENDING" }] },
      { rows: [{ id: REQUEST_ID, request_status: "reviewing", title: "t", created_at: new Date().toISOString() }] },
    ]);
    const res = await request(makeApp(POOL_ADMIN_USER)).post("/pools/x-request").send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ALREADY_PENDING");
  });

  // 13. READY pool → 새 request 금지 → 409
  it("13. READY pool → 새 request 금지 → 409 ALREADY_READY", async () => {
    setupUserRow();
    setupTransactionMock([
      { rows: [{ id: POOL_ID, x_paid_entitlement: true, x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "READY" }] },
    ]);
    const res = await request(makeApp(POOL_ADMIN_USER)).post("/pools/x-request").send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ALREADY_READY");
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// B. GET /pools/x-request
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("GET /pools/x-request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 14. 자기 pool 요청만 반환 (poolId DB 결정)
  it("14. 자기 pool 요청 반환 (poolId JWT 아닌 DB)", async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ swimming_pool_id: POOL_ID }] }) // user row
      .mockResolvedValueOnce({ rows: [{ id: REQUEST_ID, request_status: "pending", title: "t", review_note: null, result_version_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), reviewed_at: null }] }) // active
    const res = await request(makeApp(POOL_ADMIN_USER)).get("/pools/x-request");
    expect(res.status).toBe(200);
    expect(res.body.request.id).toBe(REQUEST_ID);
  });

  // 15. 다른 pool 요청 노출 없음 — poolId가 DB 기반이면 구조상 보장됨
  it("15. 다른 pool 요청 노출 없음 (userId→poolId DB 결정)", async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ swimming_pool_id: "pool_other_123" }] }) // 다른 pool
      .mockResolvedValueOnce({ rows: [] })  // active 없음
      .mockResolvedValueOnce({ rows: [] }); // latest 없음
    const res = await request(makeApp(POOL_ADMIN_USER)).get("/pools/x-request");
    expect(res.status).toBe(200);
    expect(res.body.request).toBeNull();
  });

  // 16. GET: pending/reviewing 우선, 없으면 최신 반환
  it("16. active 없으면 최신 요청 반환", async () => {
    const LATEST_ID = "cr_latest_001";
    mockExecute
      .mockResolvedValueOnce({ rows: [{ swimming_pool_id: POOL_ID }] }) // user row
      .mockResolvedValueOnce({ rows: [] }) // active 없음
      .mockResolvedValueOnce({ rows: [{ id: LATEST_ID, request_status: "approved", title: "t", review_note: null, result_version_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), reviewed_at: new Date().toISOString() }] }); // latest
    const res = await request(makeApp(POOL_ADMIN_USER)).get("/pools/x-request");
    expect(res.body.request.id).toBe(LATEST_ID);
    expect(res.body.request.request_status).toBe("approved");
  });

  // 16b. 요청 없으면 null
  it("16b. 요청 없으면 { request: null }", async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ swimming_pool_id: POOL_ID }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(makeApp(POOL_ADMIN_USER)).get("/pools/x-request");
    expect(res.status).toBe(200);
    expect(res.body.request).toBeNull();
  });

  // unauthenticated
  it("GET unauthenticated → 401", async () => {
    const res = await request(makeApp()).get("/pools/x-request");
    expect(res.status).toBe(401);
  });

  // teacher → 403
  it("GET teacher → 403", async () => {
    const res = await request(makeApp(TEACHER_USER)).get("/pools/x-request");
    expect(res.status).toBe(403);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 17. GET /pools/x-mode regression
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("GET /pools/x-mode regression", () => {
  beforeEach(() => vi.clearAllMocks());

  it("17. unauthenticated → 401", async () => {
    const res = await request(makeApp()).get("/pools/x-mode");
    expect(res.status).toBe(401);
  });

  it("17b. pool_admin 정상 경로 → resolvePoolMode 호출", async () => {
    const { resolvePoolMode } = await import("../../lib/xmode.js");
    (resolvePoolMode as any).mockResolvedValueOnce({
      pool_id: POOL_ID, mode: "normal",
      xmode_entitlement: false, xmode_config_status: "NOT_CONFIGURED",
    });
    mockExecute.mockResolvedValueOnce({ rows: [{ swimming_pool_id: POOL_ID }] });
    const res = await request(makeApp(POOL_ADMIN_USER)).get("/pools/x-mode");
    expect(res.status).toBe(200);
    expect(res.body.pool_id).toBe(POOL_ID);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 18. WP2 tests import regression (모듈 로드 확인)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("WP2 regression: x-entitlement module import", () => {
  it("18. isXProduct / handleXEntitlementEvent import 가능", async () => {
    const mod = await import("../../lib/x-entitlement.js");
    expect(typeof mod.isXProduct).toBe("function");
    expect(typeof mod.handleXEntitlementEvent).toBe("function");
  });
});
