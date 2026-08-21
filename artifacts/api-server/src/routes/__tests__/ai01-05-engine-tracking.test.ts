/**
 * AI01-05 — External Engine Request Tracking
 *
 * Tests verify:
 *  - request_id propagated to both engines via X-Request-Id header and body
 *  - actualCallCount / retryCount returned correctly by clients
 *  - validation failure (ENGINE_URL_NOT_CONFIGURED) → actual_call_count=0
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  ParentCurriculumEngineRequest,
} from "../../lib/parent-curriculum-engine-client.js";
import type {
  GrowthReportAnalysisRequest,
} from "../../lib/growth-report-engine-client.js";

// ── Helpers to build minimal request fixtures ─────────────────────────────────

function makePcRequest(requestId: string): ParentCurriculumEngineRequest {
  return {
    request_id:     requestId,
    schema_version: "1.0",
    feature:        "parent_curriculum_search",
    query:          "다음 단계가 궁금합니다",
    context: {
      pool_id:          "pool_test_001",
      pool_name:        "테스트 수영장",
      student_id:       "student_001",
      mode:             "NORMAL",
      curriculum_scope: {
        source:           "POOL",
        curriculum_items: [],
      },
    },
  };
}

function makeGrRequest(requestId: string): GrowthReportAnalysisRequest {
  // Minimal — only request_id is needed for header propagation tests
  return {
    request_id:       requestId,
    contract_version: "GR-1.0",
    pool_id:          "pool_test_001",
    report_id:        "report_001",
    stage:            "PREANALYSIS",
    payload_hash:     "aabbcc",
    snapshot_version: 1,
    diaries:          [],
    growth_events:    [],
    attendance:       [],
    curriculum_state: null,
  } as unknown as GrowthReportAnalysisRequest;
}

// ── Curriculum Engine tests ───────────────────────────────────────────────────

describe("AI01-05 — Curriculum Engine request tracking", () => {
  // TC1: request_id forwarded as X-Request-Id header + body field
  it("TC1. request_id forwarded as X-Request-Id header to Curriculum Engine", async () => {
    const requestId = "req-ai01-05-tc1";
    const pcReq     = makePcRequest(requestId);

    // Capture what fetch receives
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: any = null;

    // Dynamic import so we can mock the env first
    const origEnv = process.env["PARENT_CURRICULUM_ENGINE_URL"];
    process.env["PARENT_CURRICULUM_ENGINE_URL"] = "https://mock-pc-engine.test";

    const mockResponse = {
      ok:   true,
      json: async () => ({
        request_id: requestId,
        schema_version: "1.0",
        feature: "parent_curriculum_search",
        result: { answer: "test answer" },
        grounding: { curriculum_ids: [], validation: "PASS" },
      }),
    };

    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      capturedBody    = JSON.parse(init.body as string);
      return mockResponse as any;
    });

    const { searchParentCurriculum } = await import(
      "../../lib/parent-curriculum-engine-client.js"
    );
    const result = await searchParentCurriculum(pcReq);

    expect(capturedHeaders["X-Request-Id"]).toBe(requestId);
    expect(capturedBody.request_id).toBe(requestId);

    vi.unstubAllGlobals();
    process.env["PARENT_CURRICULUM_ENGINE_URL"] = origEnv;
  });

  // TC3: retry-free Curriculum call → actualCallCount=1, retryCount=0
  it("TC3. Retry-free Curriculum call: actualCallCount=1, retryCount=0", async () => {
    const requestId = "req-ai01-05-tc3";
    const pcReq     = makePcRequest(requestId);

    const origEnv = process.env["PARENT_CURRICULUM_ENGINE_URL"];
    process.env["PARENT_CURRICULUM_ENGINE_URL"] = "https://mock-pc-engine.test";

    vi.stubGlobal("fetch", async () => ({
      ok:   true,
      json: async () => ({
        request_id: requestId,
        schema_version: "1.0",
        feature: "parent_curriculum_search",
        result: { answer: "ok" },
        grounding: { curriculum_ids: [], validation: "PASS" },
      }),
    }));

    const { searchParentCurriculum } = await import(
      "../../lib/parent-curriculum-engine-client.js"
    );
    const result = await searchParentCurriculum(pcReq);

    expect(result.actualCallCount).toBe(1);
    expect(result.retryCount).toBe(0);

    vi.unstubAllGlobals();
    process.env["PARENT_CURRICULUM_ENGINE_URL"] = origEnv;
  });

  // TC6: ENGINE_URL_NOT_CONFIGURED → no HTTP request → throws before fetch
  it("TC6. Curriculum ENGINE_URL_NOT_CONFIGURED: no actual provider call (throws pre-fetch)", async () => {
    const requestId = "req-ai01-05-tc6-pc";
    const pcReq     = makePcRequest(requestId);

    const origEnv = process.env["PARENT_CURRICULUM_ENGINE_URL"];
    process.env["PARENT_CURRICULUM_ENGINE_URL"] = "";

    let fetchCalled = false;
    vi.stubGlobal("fetch", async () => { fetchCalled = true; return {} as any; });

    const { searchParentCurriculum, ParentCurriculumEngineError } = await import(
      "../../lib/parent-curriculum-engine-client.js"
    );

    await expect(searchParentCurriculum(pcReq)).rejects.toMatchObject({
      errorCode: "ENGINE_URL_NOT_CONFIGURED",
    });
    expect(fetchCalled).toBe(false); // no HTTP sent

    vi.unstubAllGlobals();
    process.env["PARENT_CURRICULUM_ENGINE_URL"] = origEnv;
  });
});

// ── Growth Engine tests ───────────────────────────────────────────────────────

describe("AI01-05 — Growth Engine request tracking", () => {
  // TC2: request_id forwarded as X-Request-Id header + body field
  it("TC2. request_id forwarded as X-Request-Id header to Growth Engine", async () => {
    const requestId = "req-ai01-05-tc2";
    const grReq     = makeGrRequest(requestId);

    let capturedHeaders: Record<string, string> = {};
    let capturedBody: any = null;

    const origEnv = process.env["GROWTH_REPORT_ENGINE_URL"];
    process.env["GROWTH_REPORT_ENGINE_URL"] = "https://mock-gr-engine.test";

    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      capturedBody    = JSON.parse(init.body as string);
      return {
        ok:   true,
        json: async () => ({
          request_id:   requestId,
          analysis_id:  "analysis_001",
          status:       "QUESTION_AVAILABLE",
          grounding:    { validation: "PASS" },
          output:       {},
        }),
      } as any;
    });

    const { analyzeGrowthReport } = await import(
      "../../lib/growth-report-engine-client.js"
    );
    await analyzeGrowthReport(grReq);

    expect(capturedHeaders["X-Request-Id"]).toBe(requestId);
    expect(capturedBody.request_id).toBe(requestId);

    vi.unstubAllGlobals();
    process.env["GROWTH_REPORT_ENGINE_URL"] = origEnv;
  });

  // TC3 (Growth): retry-free Growth call → actualCallCount=1, retryCount=0
  it("TC3. Retry-free Growth call: actualCallCount=1, retryCount=0", async () => {
    const requestId = "req-ai01-05-tc3-gr";
    const grReq     = makeGrRequest(requestId);

    const origEnv = process.env["GROWTH_REPORT_ENGINE_URL"];
    process.env["GROWTH_REPORT_ENGINE_URL"] = "https://mock-gr-engine.test";

    vi.stubGlobal("fetch", async () => ({
      ok:   true,
      json: async () => ({
        request_id:  requestId,
        analysis_id: "analysis_002",
        status:      "QUESTION_AVAILABLE",
        grounding:   { validation: "PASS" },
        output:      {},
      }),
    }));

    const { analyzeGrowthReport } = await import(
      "../../lib/growth-report-engine-client.js"
    );
    const result = await analyzeGrowthReport(grReq);

    expect(result.actualCallCount).toBe(1);
    expect(result.retryCount).toBe(0);

    vi.unstubAllGlobals();
    process.env["GROWTH_REPORT_ENGINE_URL"] = origEnv;
  });

  // TC4: network error after HTTP sent → still counted as 1 attempt
  it("TC4. Growth Engine network error after HTTP sent: actualCallCount handled by caller (1 attempt)", async () => {
    const requestId = "req-ai01-05-tc4";
    const grReq     = makeGrRequest(requestId);

    const origEnv = process.env["GROWTH_REPORT_ENGINE_URL"];
    process.env["GROWTH_REPORT_ENGINE_URL"] = "https://mock-gr-engine.test";

    vi.stubGlobal("fetch", async () => {
      throw Object.assign(new Error("network failure"), { name: "Error" });
    });

    const { analyzeGrowthReport, EngineCallError } = await import(
      "../../lib/growth-report-engine-client.js"
    );

    await expect(analyzeGrowthReport(grReq)).rejects.toThrow(EngineCallError);

    vi.unstubAllGlobals();
    process.env["GROWTH_REPORT_ENGINE_URL"] = origEnv;
  });

  // TC5: analysis_retry_count is cross-invocation — NOT same as actual_call_count per invocation
  it("TC5. analysis_retry_count (DB) is cross-invocation; per-invocation actual_call_count=1 from client", async () => {
    // This test validates the conceptual separation:
    // analysis_retry_count can be 3 (retried 3 times across worker runs)
    // but in THIS invocation only 1 HTTP call is made
    const requestId = "req-ai01-05-tc5";
    const grReq     = makeGrRequest(requestId);

    const origEnv = process.env["GROWTH_REPORT_ENGINE_URL"];
    process.env["GROWTH_REPORT_ENGINE_URL"] = "https://mock-gr-engine.test";

    vi.stubGlobal("fetch", async () => ({
      ok:   true,
      json: async () => ({
        request_id:  requestId,
        analysis_id: "analysis_005",
        status:      "QUESTION_AVAILABLE",
        grounding:   { validation: "PASS" },
        output:      {},
      }),
    }));

    const { analyzeGrowthReport } = await import(
      "../../lib/growth-report-engine-client.js"
    );
    const result = await analyzeGrowthReport(grReq);

    // Regardless of DB analysis_retry_count=3, client reports 1 HTTP call this invocation
    expect(result.actualCallCount).toBe(1);
    expect(result.retryCount).toBe(0);
    // Caller must NOT use analysis_retry_count as actual_call_count
    const dbAnalysisRetryCount = 3; // hypothetical
    expect(result.actualCallCount).not.toBe(dbAnalysisRetryCount + 1);

    vi.unstubAllGlobals();
    process.env["GROWTH_REPORT_ENGINE_URL"] = origEnv;
  });

  // TC6: ENGINE_URL_NOT_CONFIGURED → no HTTP request → throws pre-fetch
  it("TC6. Growth ENGINE_URL_NOT_CONFIGURED: no actual provider call (throws pre-fetch)", async () => {
    const requestId = "req-ai01-05-tc6-gr";
    const grReq     = makeGrRequest(requestId);

    const origEnv = process.env["GROWTH_REPORT_ENGINE_URL"];
    process.env["GROWTH_REPORT_ENGINE_URL"] = "";

    let fetchCalled = false;
    vi.stubGlobal("fetch", async () => { fetchCalled = true; return {} as any; });

    const { analyzeGrowthReport, EngineCallError } = await import(
      "../../lib/growth-report-engine-client.js"
    );

    await expect(analyzeGrowthReport(grReq)).rejects.toMatchObject({
      errorCode: "ENGINE_URL_NOT_CONFIGURED",
    });
    expect(fetchCalled).toBe(false); // no HTTP sent

    vi.unstubAllGlobals();
    process.env["GROWTH_REPORT_ENGINE_URL"] = origEnv;
  });
});
