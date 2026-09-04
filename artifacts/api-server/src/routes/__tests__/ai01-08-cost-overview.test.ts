/**
 * AI01-08 — GET /super/ai-cost-overview
 *
 * TC1:  Super Admin 아닌 사용자 → 403
 * TC2:  AI + EXTERNAL_USAGE 혼합 → summary 정상 집계
 * TC3:  known cost + UNKNOWN cost → known_cost_usd / unknown_cost_calls 분리
 * TC4:  actual_call_count absent event → actual_calls_known 에 0 합산 안 함, unknown event 별도 집계
 * TC5:  SYSTEM_MAINTENANCE → USER_ACTION 과 별도 group
 * TC6:  provider/service/model grouping 정상
 * TC7:  pool_id grouping 정상
 * TC8:  legacy metadata 일부 누락 → endpoint crash 없음
 * TC9:  외부 provider/API 호출 없음
 * TC10: today/month 기간 각각 독립 집계
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─────────────────────────────────────────────────────────────────────────────
// Auth middleware mock — inject req.user per test
// ─────────────────────────────────────────────────────────────────────────────
let _mockUser: Record<string, unknown> | null = null;

vi.mock("../../middlewares/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    if (!_mockUser) return _res.status(401).json({ error: "unauthorized" });
    req.user = _mockUser;
    next();
  },
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user || !roles.includes(req.user.role as string)) {
      return res.status(403).json({ error: "forbidden" });
    }
    next();
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// superAdminDb mock — we control what each execute() call returns
// ─────────────────────────────────────────────────────────────────────────────

/** Each element is the mocked return value for successive execute() calls. */
let _executeQueue: Array<{ rows: Record<string, unknown>[] }> = [];

vi.mock("@workspace/db", () => ({
  superAdminDb: {
    execute: vi.fn(async () => {
      const result = _executeQueue.shift();
      return result ?? { rows: [] };
    }),
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Build test app
// ─────────────────────────────────────────────────────────────────────────────

async function buildApp() {
  const { default: superAiCostRouter } = await import("../super-ai-cost.js");
  const app = express();
  app.use(express.json());
  app.use("/api", superAiCostRouter);
  return app;
}

// ── Period bounds mock row ────────────────────────────────────────────────────
const NOW_ISO        = "2026-08-21T08:00:00.000Z";
const TODAY_START    = "2026-08-21T00:00:00.000Z"; // midnight KST as UTC (UTC+9 → subtract 9h)
const MONTH_START    = "2026-08-01T00:00:00.000Z";

const PERIOD_BOUNDS_ROW = {
  today_start: TODAY_START,
  month_start: MONTH_START,
  now:         NOW_ISO,
};

/** Standard empty aggregate rows for all 8 data queries. */
const EMPTY_SUMMARY = {
  total_events: 0, logical_requests: 0, actual_calls_known: 0,
  actual_calls_unknown_events: 0, retries: 0, known_cost_usd: 0,
  unknown_cost_calls: 0, success_count: 0, failure_count: 0,
};

/** Helper: queue period-bounds + 10 data queries (all empty). */
function queueEmptyRun() {
  _executeQueue = [
    { rows: [PERIOD_BOUNDS_ROW] },                                        // fetchPeriodBounds
    { rows: [{ ...EMPTY_SUMMARY }] },                                     // today summary
    { rows: [{ ...EMPTY_SUMMARY }] },                                     // month summary
    { rows: [] }, { rows: [] },                                           // trigger
    { rows: [] }, { rows: [] },                                           // feature
    { rows: [] }, { rows: [] },                                           // psm
    { rows: [] }, { rows: [] },                                           // pool
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// TC1 — 권한 없는 사용자 → 403
// ─────────────────────────────────────────────────────────────────────────────

describe("TC1. 권한 없는 사용자 → 403", () => {
  it("role=teacher → 403", async () => {
    _mockUser = { id: "u1", role: "teacher" };
    const app = await buildApp();
    const res = await request(app).get("/api/super/ai-cost-overview");
    expect(res.status).toBe(403);
  });

  it("미인증 → 401", async () => {
    _mockUser = null;
    const app = await buildApp();
    const res = await request(app).get("/api/super/ai-cost-overview");
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC2 — AI + EXTERNAL_USAGE 혼합 → summary 정상 집계
// ─────────────────────────────────────────────────────────────────────────────

describe("TC2. AI + EXTERNAL_USAGE 혼합 → summary 집계", () => {
  it("total_events=5, success=4, failure=1 집계", async () => {
    _mockUser = { id: "sa1", role: "super_admin" };
    _executeQueue = [
      { rows: [PERIOD_BOUNDS_ROW] },
      // today summary
      { rows: [{
        total_events: 5, logical_requests: 5, actual_calls_known: 4,
        actual_calls_unknown_events: 1, retries: 0,
        known_cost_usd: 0.005, unknown_cost_calls: 2,
        success_count: 4, failure_count: 1,
      }]},
      { rows: [{ ...EMPTY_SUMMARY }] }, // month summary
      { rows: [] }, { rows: [] },
      { rows: [] }, { rows: [] },
      { rows: [] }, { rows: [] },
      { rows: [] }, { rows: [] },
    ];

    const app = await buildApp();
    const res = await request(app).get("/api/super/ai-cost-overview");

    expect(res.status).toBe(200);
    expect(res.body.today.summary.total_events).toBe(5);
    expect(res.body.today.summary.success_count).toBe(4);
    expect(res.body.today.summary.failure_count).toBe(1);
    expect(res.body.today.summary.known_cost_usd).toBeCloseTo(0.005);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC3 — known / unknown cost 분리
// ─────────────────────────────────────────────────────────────────────────────

describe("TC3. known cost + UNKNOWN cost 분리", () => {
  it("known_cost_usd, unknown_cost_calls 각각 독립 집계", async () => {
    _mockUser = { id: "sa1", role: "super_admin" };
    _executeQueue = [
      { rows: [PERIOD_BOUNDS_ROW] },
      { rows: [{
        ...EMPTY_SUMMARY,
        known_cost_usd: 0.018,
        unknown_cost_calls: 34,
      }]},
      { rows: [{ ...EMPTY_SUMMARY }] },
      { rows: [] }, { rows: [] },
      { rows: [] }, { rows: [] },
      { rows: [] }, { rows: [] },
      { rows: [] }, { rows: [] },
    ];

    const app = await buildApp();
    const res = await request(app).get("/api/super/ai-cost-overview");

    expect(res.status).toBe(200);
    const s = res.body.today.summary;
    expect(s.known_cost_usd).toBeCloseTo(0.018);
    expect(s.unknown_cost_calls).toBe(34);
    // unknown cost must NOT be folded into known
    expect(s.known_cost_usd).not.toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC4 — actual_call_count absent → unknown event 별도 집계, known에 0 합산 안 함
// ─────────────────────────────────────────────────────────────────────────────

describe("TC4. actual_call_count absent event 처리", () => {
  it("actual_calls_unknown_events 별도 필드; actual_calls_known 에 0 합산 없음", async () => {
    _mockUser = { id: "sa1", role: "super_admin" };
    _executeQueue = [
      { rows: [PERIOD_BOUNDS_ROW] },
      { rows: [{
        ...EMPTY_SUMMARY,
        actual_calls_known:         3,
        actual_calls_unknown_events: 2,
      }]},
      { rows: [{ ...EMPTY_SUMMARY }] },
      { rows: [] }, { rows: [] },
      { rows: [] }, { rows: [] },
      { rows: [] }, { rows: [] },
      { rows: [] }, { rows: [] },
    ];

    const app = await buildApp();
    const res = await request(app).get("/api/super/ai-cost-overview");

    expect(res.status).toBe(200);
    const s = res.body.today.summary;
    // known must not absorb unknown events as 0-count
    expect(s.actual_calls_known).toBe(3);
    expect(s.actual_calls_unknown_events).toBe(2);
    // total known must NOT be 3+0+0 = 3 from absent events folded in
    // (actual_calls_known_events is a separate count, not added to actual_calls_known)
    expect(s.actual_calls_known + s.actual_calls_unknown_events).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC5 — SYSTEM_MAINTENANCE / USER_ACTION 별도 group
// ─────────────────────────────────────────────────────────────────────────────

describe("TC5. SYSTEM_MAINTENANCE vs USER_ACTION 별도 group", () => {
  it("by_trigger_type 에 두 group 모두 포함", async () => {
    _mockUser = { id: "sa1", role: "super_admin" };
    _executeQueue = [
      { rows: [PERIOD_BOUNDS_ROW] },
      { rows: [{ ...EMPTY_SUMMARY }] },
      { rows: [{ ...EMPTY_SUMMARY }] },
      // today trigger
      { rows: [
        { trigger_type: "USER_ACTION",        logical_requests: 10, actual_calls_known: 10, known_cost_usd: 0.01, unknown_cost_calls: 0 },
        { trigger_type: "SYSTEM_MAINTENANCE", logical_requests:  5, actual_calls_known:  5, known_cost_usd: 0.005, unknown_cost_calls: 0 },
      ]},
      { rows: [] }, // month trigger
      { rows: [] }, { rows: [] },
      { rows: [] }, { rows: [] },
      { rows: [] }, { rows: [] },
    ];

    const app = await buildApp();
    const res = await request(app).get("/api/super/ai-cost-overview");

    expect(res.status).toBe(200);
    const triggers = res.body.today.by_trigger_type as any[];
    const sys = triggers.find((t: any) => t.trigger_type === "SYSTEM_MAINTENANCE");
    const usr = triggers.find((t: any) => t.trigger_type === "USER_ACTION");

    expect(sys).toBeDefined();
    expect(usr).toBeDefined();
    expect(sys.logical_requests).toBe(5);
    expect(usr.logical_requests).toBe(10);
    // must be separate, not merged
    expect(sys.logical_requests + usr.logical_requests).toBe(15);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC6 — provider/service/model grouping
// ─────────────────────────────────────────────────────────────────────────────

describe("TC6. provider/service/model grouping 정상", () => {
  it("openai/gpt/gpt-4o-mini 와 cloudflare_r2/r2_put/null 분리", async () => {
    _mockUser = { id: "sa1", role: "super_admin" };
    _executeQueue = [
      { rows: [PERIOD_BOUNDS_ROW] },
      { rows: [{ ...EMPTY_SUMMARY }] },
      { rows: [{ ...EMPTY_SUMMARY }] },
      { rows: [] }, { rows: [] },
      { rows: [] }, { rows: [] },
      // today PSM
      { rows: [
        { provider: "openai",        service: "gpt",    model: "gpt-4o-mini", total_events: 8, logical_requests: 8, actual_calls_known: 8, known_cost_usd: 0.012, unknown_cost_calls: 0 },
        { provider: "cloudflare_r2", service: "r2_put", model: null,          total_events: 5, logical_requests: 5, actual_calls_known: 5, known_cost_usd: 0,     unknown_cost_calls: 5 },
      ]},
      { rows: [] }, // month PSM
      { rows: [] }, { rows: [] },
    ];

    const app = await buildApp();
    const res = await request(app).get("/api/super/ai-cost-overview");

    expect(res.status).toBe(200);
    const psm = res.body.today.by_provider_service_model as any[];
    const gpt = psm.find((r: any) => r.provider === "openai" && r.service === "gpt");
    const r2  = psm.find((r: any) => r.provider === "cloudflare_r2");

    expect(gpt).toBeDefined();
    expect(gpt.model).toBe("gpt-4o-mini");
    expect(r2).toBeDefined();
    expect(r2.model).toBeNull();
    expect(r2.unknown_cost_calls).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC7 — pool_id grouping 정상
// ─────────────────────────────────────────────────────────────────────────────

describe("TC7. pool_id grouping 정상", () => {
  it("pool별 known_cost_usd 개별 집계", async () => {
    _mockUser = { id: "sa1", role: "super_admin" };
    _executeQueue = [
      { rows: [PERIOD_BOUNDS_ROW] },
      { rows: [{ ...EMPTY_SUMMARY }] },
      { rows: [{ ...EMPTY_SUMMARY }] },
      { rows: [] }, { rows: [] },
      { rows: [] }, { rows: [] },
      { rows: [] }, { rows: [] },
      // today pool
      { rows: [
        { pool_id: "pool_A", logical_requests: 3, actual_calls_known: 3, known_cost_usd: 0.003, unknown_cost_calls: 0 },
        { pool_id: "pool_B", logical_requests: 7, actual_calls_known: 7, known_cost_usd: 0.007, unknown_cost_calls: 0 },
      ]},
      { rows: [] }, // month pool
    ];

    const app = await buildApp();
    const res = await request(app).get("/api/super/ai-cost-overview");

    expect(res.status).toBe(200);
    const pools = res.body.today.by_pool as any[];
    const pA    = pools.find((p: any) => p.pool_id === "pool_A");
    const pB    = pools.find((p: any) => p.pool_id === "pool_B");

    expect(pA).toBeDefined();
    expect(pB).toBeDefined();
    expect(pA.known_cost_usd).toBeCloseTo(0.003);
    expect(pB.known_cost_usd).toBeCloseTo(0.007);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC8 — legacy metadata 일부 누락 → crash 없음
// ─────────────────────────────────────────────────────────────────────────────

describe("TC8. legacy metadata 일부 누락 → endpoint crash 없음", () => {
  it("null/undefined 값 포함한 feature row → 200 응답", async () => {
    _mockUser = { id: "sa1", role: "super_admin" };
    _executeQueue = [
      { rows: [PERIOD_BOUNDS_ROW] },
      { rows: [{ ...EMPTY_SUMMARY }] },
      { rows: [{ ...EMPTY_SUMMARY }] },
      { rows: [] }, { rows: [] },
      // today feature — row with legacy nulls
      { rows: [
        { feature: null, total_events: 3, logical_requests: null, actual_calls_known: null,
          actual_calls_unknown_events: 3, retries: null, known_cost_usd: null,
          unknown_cost_calls: 3, success_count: 0, failure_count: 3 },
      ]},
      { rows: [] }, // month feature
      { rows: [] }, { rows: [] },
      { rows: [] }, { rows: [] },
    ];

    const app = await buildApp();
    const res = await request(app).get("/api/super/ai-cost-overview");

    expect(res.status).toBe(200);
    const features = res.body.today.by_feature as any[];
    // Endpoint must not crash; feature with null name is preserved
    expect(Array.isArray(features)).toBe(true);
    expect(features.length).toBeGreaterThan(0);
    // unit economics with null denominator → null
    const f = features[0];
    if (f.logical_requests === 0) {
      expect(f.known_cost_per_logical_request_usd).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC9 — 외부 provider/API 호출 없음
// ─────────────────────────────────────────────────────────────────────────────

describe("TC9. 조회 과정에서 외부 provider API 호출 없음", () => {
  it("fetch / http / axios 호출 없음 (superAdminDb.execute 만 사용)", async () => {
    _mockUser = { id: "sa1", role: "super_admin" };
    queueEmptyRun();

    const fetchSpy = vi.spyOn(globalThis, "fetch" as any).mockResolvedValue({} as any);

    const app = await buildApp();
    await request(app).get("/api/super/ai-cost-overview");

    // No outbound HTTP to external providers
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC10 — today / month 기간 각각 독립 집계
// ─────────────────────────────────────────────────────────────────────────────

describe("TC10. today / month 기간 독립 집계", () => {
  it("today와 month summary 값 각각 독립적으로 반환", async () => {
    _mockUser = { id: "sa1", role: "super_admin" };
    _executeQueue = [
      { rows: [PERIOD_BOUNDS_ROW] },
      // today summary — 2 events
      { rows: [{ ...EMPTY_SUMMARY, total_events: 2, success_count: 2 }]},
      // month summary — 20 events
      { rows: [{ ...EMPTY_SUMMARY, total_events: 20, success_count: 18 }]},
      { rows: [] }, { rows: [] },
      { rows: [] }, { rows: [] },
      { rows: [] }, { rows: [] },
      { rows: [] }, { rows: [] },
    ];

    const app = await buildApp();
    const res = await request(app).get("/api/super/ai-cost-overview");

    expect(res.status).toBe(200);
    // today and month must be independent
    expect(res.body.today.summary.total_events).toBe(2);
    expect(res.body.month.summary.total_events).toBe(20);
    // period_start must differ
    expect(res.body.today.period_start).toBe(TODAY_START);
    expect(res.body.month.period_start).toBe(MONTH_START);
    expect(res.body.today.period_start).not.toBe(res.body.month.period_start);
  });
});
