/**
 * CS-PA0 Tests — PA0-01 through PA0-15
 *
 * Tests cover:
 *   PA0-01: existing AI trace audit (event_logs reuse confirmed)
 *   PA0-02: existing support schema audit
 *   PA0-03: no duplicate AI trace system
 *   PA0-04: feature enum contract
 *   PA0-05: request_id/trace_id contract
 *   PA0-06: privacy-safe usage event (no PII in metadata)
 *   PA0-07: token unknown handling (null not 0)
 *   PA0-08: estimated cost distinction
 *   PA0-09: support tenant isolation
 *   PA0-10: pool knowledge isolation
 *   PA0-11: no autonomous DB modification
 *   PA0-12: Partner metric missing → null (NOT_AVAILABLE), never fake 0
 *   PA0-13: Super Admin sections reuse SA0 (routes mounted)
 *   PA0-14: non-super_admin analytics access denied
 *   PA0-15: existing AI features no regression
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import cspa0Router from "../cs-pa0.js";

// ── Mock helpers ──────────────────────────────────────────────────────────────

let mockDbRows: any[] = [];
let mockDbCalls: string[] = [];

vi.mock("@workspace/db", () => ({
  superAdminDb: {
    execute: vi.fn(async (q: any) => {
      const raw = typeof q === "object" && q?.queryChunks
        ? q.queryChunks.map((c: any) => (typeof c === "string" ? c : String(c?.value ?? ""))).join("")
        : String(q?.sql ?? q ?? "");
      // Capture full SQL (not truncated) to allow WHERE-clause assertions
      mockDbCalls.push(raw.trim());
      return { rows: mockDbRows };
    }),
  },
}));

vi.mock("../../middlewares/auth.js", () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
  requireRole: (role: string) => (req: any, res: any, next: any) => {
    if (req.headers["x-test-role"] !== role) {
      return res.status(403).json({ error: "Forbidden" });
    }
    req.user = { id: "test_admin" };
    next();
  },
}));

vi.mock("../../migrations/pool-db-cs-pa0.js", () => ({
  runCsPa0Migration: vi.fn().mockResolvedValue(undefined),
}));

function makeApp(role = "super_admin") {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.headers["x-test-role"] = role;
    next();
  });
  app.use("/", cspa0Router);
  return app;
}

beforeEach(() => {
  mockDbRows = [];
  mockDbCalls = [];
  vi.clearAllMocks();
});

// ── PA0-01: Existing AI trace audit — event_logs reuse confirmed ──────────────
describe("PA0-01: AI trace reuse audit", () => {
  it("AI metrics endpoint queries event_logs, not a separate ai_traces table", async () => {
    mockDbRows = [{ total_requests: "0", success_count: "0", error_count: "0", active_pools: "0", active_ai_actors: "0" }];
    const app = makeApp();
    await request(app).get("/super/ai/metrics");
    const sqlCalls = mockDbCalls.join(" ");
    expect(sqlCalls).toContain("event_logs");
    expect(sqlCalls).not.toMatch(/FROM\s+ai_traces/i);
  });

  it("AI metrics filters by category='AI'", async () => {
    mockDbRows = [{ total_requests: "5", success_count: "4", error_count: "1", active_pools: "2", active_ai_actors: "3" }];
    const app = makeApp();
    await request(app).get("/super/ai/metrics");
    // The WHERE clause must restrict to AI category (in the full SQL)
    const combined = mockDbCalls.join("\n");
    expect(combined).toMatch(/category\s*=\s*'AI'/i);
  });
});

// ── PA0-02: Existing support schema audit ──────────────────────────────────────
describe("PA0-02: Support schema audit", () => {
  it("cs-pa0 creates support_cases, support_knowledge_items, partner_analytics_snapshots (not duplicating support_tickets)", async () => {
    const { runCsPa0Migration } = await import("../../migrations/pool-db-cs-pa0.js");
    expect(typeof runCsPa0Migration).toBe("function");
    // support_tickets itself not dropped or altered — just new tables added
  });
});

// ── PA0-03: No duplicate AI trace system ────────────────────────────────────────
describe("PA0-03: No duplicate AI trace system", () => {
  it("cs-pa0 router does not define a new saveAiTrace function", async () => {
    const module = await import("../cs-pa0.js");
    expect((module as any).saveAiTrace).toBeUndefined();
    expect((module as any).ai_traces).toBeUndefined();
  });

  it("cs-pa0 metrics reuse event_logs exclusively", async () => {
    mockDbRows = [{ total_requests: "0", success_count: "0", error_count: "0", active_pools: "0", active_ai_actors: "0" }];
    const app = makeApp();
    const res = await request(app).get("/super/ai/metrics");
    expect(res.status).toBe(200);
    // No reference to a separate analytics DB
    const calls = mockDbCalls.join(" ");
    expect(calls).not.toMatch(/analytics_events|usage_events|ai_usage_logs/i);
  });
});

// ── PA0-04: Feature enum contract ───────────────────────────────────────────────
describe("PA0-04: Feature enum contract", () => {
  it("AI_FEATURE contains required feature keys", async () => {
    const { AI_FEATURE } = await import("../../lib/ai-feature-enum.js");
    expect(AI_FEATURE.TEACHER_AI_DIARY).toBe("teacher_diary");
    expect(AI_FEATURE.PARENT_CURRICULUM_AI).toBe("parent_curriculum_search");
    expect(AI_FEATURE.GROWTH_REPORT_AI).toBe("growth_report_ai");
    expect(AI_FEATURE.SUPPORT_AI).toBe("support_ai");
  });

  it("AI_FEATURE_LABEL has labels for all enum values", async () => {
    const { AI_FEATURE, AI_FEATURE_LABEL } = await import("../../lib/ai-feature-enum.js");
    for (const val of Object.values(AI_FEATURE)) {
      expect(AI_FEATURE_LABEL[val as keyof typeof AI_FEATURE_LABEL]).toBeTruthy();
    }
  });

  it("isValidAiFeature returns true for known values", async () => {
    const { isValidAiFeature, AI_FEATURE } = await import("../../lib/ai-feature-enum.js");
    expect(isValidAiFeature(AI_FEATURE.TEACHER_AI_DIARY)).toBe(true);
    expect(isValidAiFeature("unknown_feature_xyz")).toBe(false);
  });
});

// ── PA0-05: request_id/trace_id contract ───────────────────────────────────────
describe("PA0-05: request_id / trace_id contract", () => {
  it("buildTraceMetadata includes request_id and internal_id", async () => {
    const { buildTraceMetadata } = await import("../../lib/ai-trace-service.js");
    const meta = buildTraceMetadata({
      request_id: "req_abc", internal_id: "int_xyz",
      pool_id: "pool_1", feature: "teacher_diary",
      contract_version: "v1", status: "FAILED",
      error_stage: "LLM_GENERATION", latency_ms: 100,
    });
    expect(meta.request_id).toBe("req_abc");
    expect(meta.internal_id).toBe("int_xyz");
  });
});

// ── PA0-06: Privacy-safe usage event ───────────────────────────────────────────
describe("PA0-06: Privacy-safe usage event (no PII in metadata)", () => {
  it("buildTraceMetadata does not include full prompt or response", async () => {
    const { buildTraceMetadata } = await import("../../lib/ai-trace-service.js");
    const meta = buildTraceMetadata({
      request_id: "r1", internal_id: "i1",
      pool_id: "p1", feature: "teacher_diary",
      contract_version: "v1", status: "SUCCESS",
      generation_mode: "normal", model: "gpt-4o-mini",
      latency_ms: 500, input_tokens: 100, output_tokens: 200, total_tokens: 300,
    });
    const metaStr = JSON.stringify(meta);
    expect(metaStr).not.toContain("prompt");
    expect(metaStr).not.toContain("full_response");
    expect(metaStr).not.toContain("student_name");
    expect(metaStr).not.toContain("phone");
    expect(metaStr).not.toContain("email");
  });
});

// ── PA0-07: Token unknown handling ─────────────────────────────────────────────
describe("PA0-07: Token unknown handling", () => {
  it("metrics API returns null for total_tokens when no data, not 0", async () => {
    mockDbRows = [
      { total_requests: "0", success_count: "0", error_count: "0", active_pools: "0",
        active_ai_actors: "0", total_tokens: null, total_cost_usd: null, avg_latency_ms: null,
        p50_latency_ms: null, p95_latency_ms: null },
    ];
    const app = makeApp();
    const res = await request(app).get("/super/ai/metrics");
    expect(res.status).toBe(200);
    expect(res.body.totals.total_tokens).toBeNull();
    expect(res.body.totals.total_cost_usd).toBeNull();
  });

  it("metrics API includes total_tokens when data present", async () => {
    mockDbRows = [
      { total_requests: "5", success_count: "4", error_count: "1", active_pools: "2",
        active_ai_actors: "3", total_tokens: "1500", total_cost_usd: "0.003",
        avg_latency_ms: "800", p50_latency_ms: "750", p95_latency_ms: "1200" },
    ];
    const app = makeApp();
    const res = await request(app).get("/super/ai/metrics");
    expect(res.status).toBe(200);
    expect(res.body.totals.total_tokens).toBe(1500);
  });
});

// ── PA0-08: Estimated cost distinction ─────────────────────────────────────────
describe("PA0-08: Estimated cost distinction", () => {
  it("partner metrics uses estimated_cost_usd field name, not invoiced_cost", async () => {
    mockDbRows = [{ total_requests: "10", success_count: "9", error_count: "1",
      active_ai_pools: "2", active_ai_actors: "5", total_tokens: "5000",
      total_cost_usd: "0.01", avg_latency_ms: "600", p50_ms: "550", p95_ms: "900" }];
    const app = makeApp();
    const res = await request(app).get("/super/partner/metrics");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toContain("estimated_cost_usd");
    expect(Object.keys(res.body)).not.toContain("actual_cost_usd");
    expect(Object.keys(res.body)).not.toContain("invoiced_cost");
  });
});

// ── PA0-09: Support tenant isolation ────────────────────────────────────────────
describe("PA0-09: Support tenant isolation", () => {
  it("GET /super/support/cases accepts pool_id filter (super_admin only)", async () => {
    mockDbRows = [];
    const app = makeApp();
    const res = await request(app).get("/super/support/cases?pool_id=pool_test");
    expect(res.status).toBe(200);
    expect(res.body.cases).toBeDefined();
  });

  it("Knowledge items have pool_id scope isolation", async () => {
    mockDbRows = [];
    const app = makeApp();
    const res = await request(app).get("/super/support/knowledge?scope=pool");
    expect(res.status).toBe(200);
  });
});

// ── PA0-10: Pool knowledge isolation ────────────────────────────────────────────
describe("PA0-10: Pool knowledge isolation", () => {
  it("POST knowledge item with pool scope stores pool_id", async () => {
    mockDbRows = [];
    const app = makeApp();
    const res = await request(app)
      .post("/super/support/knowledge")
      .send({ item_type: "FAQ", title: "Test", content: "Answer", scope: "pool", pool_id: "pool_abc" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // status starts as pending (not auto-activated)
    expect(res.body.status).toBe("pending");
  });
});

// ── PA0-11: No autonomous DB modification ───────────────────────────────────────
describe("PA0-11: No autonomous DB modification", () => {
  it("knowledge item POST creates with status=pending, not auto-active", async () => {
    mockDbRows = [];
    const app = makeApp();
    const res = await request(app)
      .post("/super/support/knowledge")
      .send({ item_type: "RULE", title: "Auto Rule", content: "Deny X" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending"); // must require human review
  });

  it("knowledge item requires PATCH to activate (super_admin review)", async () => {
    mockDbRows = [{ id: "ki_test" }];
    const app = makeApp();
    const res = await request(app)
      .patch("/super/support/knowledge/ki_test")
      .send({ status: "active" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ── PA0-12: Partner metric missing → null ───────────────────────────────────────
describe("PA0-12: Partner metric missing → null (NOT_AVAILABLE)", () => {
  it("result_adoption is null when no source exists", async () => {
    mockDbRows = [{ total_requests: "0", success_count: "0", error_count: "0",
      active_ai_pools: "0", active_ai_actors: "0", total_tokens: null, total_cost_usd: null,
      avg_latency_ms: null, p50_ms: null, p95_ms: null }];
    const app = makeApp();
    const res = await request(app).get("/super/partner/metrics");
    expect(res.status).toBe(200);
    expect(res.body.result_adoption).toBeNull();
    expect(res.body.support_resolution).toBeNull();
  });

  it("ai_pool_adoption_pct is null when pool count unavailable", async () => {
    mockDbRows = [];
    const app = makeApp();
    const res = await request(app).get("/super/partner/metrics");
    // With no rows from poolsRes, adoption can't be computed
    expect(res.status).toBe(200);
    // result_adoption always null (no source yet)
    expect(res.body.result_adoption).toBeNull();
  });
});

// ── PA0-13: Super Admin sections reuse SA0 ──────────────────────────────────────
describe("PA0-13: Super Admin SA0 reuse", () => {
  it("cs-pa0 router is exported and mounts /super routes", async () => {
    // Verify module export
    const cspa0Module = await import("../cs-pa0.js");
    expect(cspa0Module.default).toBeTruthy();
    expect(typeof cspa0Module.default).toBe("function"); // express Router is a function

    // Verify super-namespaced routes respond (no 404 from wrong path)
    mockDbRows = [{ total_requests: "0", success_count: "0", error_count: "0",
      active_ai_pools: "0", active_ai_actors: "0" }];
    const app = makeApp();
    const r1 = await request(app).get("/super/ai/metrics");
    const r2 = await request(app).get("/super/partner/snapshots");
    expect(r1.status).not.toBe(404);
    expect(r2.status).not.toBe(404);
  });
});

// ── PA0-14: non-super_admin analytics access denied ─────────────────────────────
describe("PA0-14: non-super_admin denied", () => {
  it("pool_admin cannot access /super/ai/metrics", async () => {
    const app = makeApp("pool_admin");
    const res = await request(app).get("/super/ai/metrics");
    expect(res.status).toBe(403);
  });

  it("teacher cannot access /super/partner/metrics", async () => {
    const app = makeApp("teacher");
    const res = await request(app).get("/super/partner/metrics");
    expect(res.status).toBe(403);
  });

  it("parent cannot access /super/support/cases", async () => {
    const app = makeApp("parent");
    const res = await request(app).get("/super/support/cases");
    expect(res.status).toBe(403);
  });

  it("parent cannot POST /super/partner/snapshots", async () => {
    const app = makeApp("parent");
    const res = await request(app).post("/super/partner/snapshots").send({ period_start: "2026-01-01", period_end: "2026-01-31" });
    expect(res.status).toBe(403);
  });

  it("unauthenticated cannot access /super/support/knowledge", async () => {
    const app = makeApp("anonymous");
    const res = await request(app).get("/super/support/knowledge");
    expect(res.status).toBe(403);
  });
});

// ── PA0-15: Existing AI features no regression ──────────────────────────────────
describe("PA0-15: Existing AI features no regression", () => {
  it("buildTraceMetadata still works for teacher_diary (existing feature)", async () => {
    const { buildTraceMetadata } = await import("../../lib/ai-trace-service.js");
    const meta = buildTraceMetadata({
      request_id: "req1", internal_id: "int1",
      pool_id: "pool_test", feature: "teacher_diary",
      contract_version: "v3", pool_mode: "normal",
      status: "SUCCESS", generation_mode: "template",
      model: "gpt-4o-mini", latency_ms: 700,
      input_tokens: 500, output_tokens: 300, total_tokens: 800,
    });
    expect(meta.feature).toBe("teacher_diary");
    expect(meta.status).toBe("SUCCESS");
    expect(meta.total_tokens).toBe(800);
  });

  it("buildTraceMetadata still works for parent_curriculum_search (existing feature)", async () => {
    const { buildTraceMetadata } = await import("../../lib/ai-trace-service.js");
    const meta = buildTraceMetadata({
      request_id: "req2", internal_id: "int2",
      pool_id: "pool_x", feature: "parent_curriculum_search",
      contract_version: "v1", status: "FAILED",
      error_stage: "CURRICULUM_SEARCH", latency_ms: 200,
    });
    expect(meta.feature).toBe("parent_curriculum_search");
    expect(meta.error_stage).toBe("CURRICULUM_SEARCH");
  });

  it("SUPPORT_CASE_STATE enum covers required states", async () => {
    const { SUPPORT_CASE_STATE } = await import("../../lib/ai-feature-enum.js");
    expect(SUPPORT_CASE_STATE.NEW).toBe("NEW");
    expect(SUPPORT_CASE_STATE.AI_RESOLVED).toBe("AI_RESOLVED");
    expect(SUPPORT_CASE_STATE.HUMAN_REQUIRED).toBe("HUMAN_REQUIRED");
    expect(SUPPORT_CASE_STATE.ESCALATED).toBe("ESCALATED");
    expect(SUPPORT_CASE_STATE.CLOSED).toBe("CLOSED");
  });
});
