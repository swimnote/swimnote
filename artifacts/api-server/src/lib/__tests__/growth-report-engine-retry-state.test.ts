import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analyzeGrowthReport,
  EngineCallError,
  isRetryableEngineError,
} from "../growth-report-engine-client.js";

const request: any = {
  request_id: "stable-request-id",
  context: { pool_id: "pool-1" },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("ENGINE request state recovery classification", () => {
  it("preserves explicit UNKNOWN as fail-closed, non-retryable state", async () => {
    vi.stubEnv("GROWTH_REPORT_ENGINE_URL", "https://engine.invalid");
    vi.stubEnv("GROWTH_REPORT_ENGINE_SECRET", "test-only-secret");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error_code: "REQUEST_STATE",
      state: "UNKNOWN",
    }), { status: 409 })));

    const error = await analyzeGrowthReport(request).catch((caught) => caught);
    expect(error).toBeInstanceOf(EngineCallError);
    expect(error).toMatchObject({
      errorCode: "ENGINE_REQUEST_UNKNOWN",
      requestState: "UNKNOWN",
      retryable: false,
    });
    expect(isRetryableEngineError(error)).toBe(false);
  });

  it("retries only an explicitly RELEASED 429 and not an ambiguous 429", async () => {
    vi.stubEnv("GROWTH_REPORT_ENGINE_URL", "https://engine.invalid");
    vi.stubEnv("GROWTH_REPORT_ENGINE_SECRET", "test-only-secret");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error_code: "RATE_LIMITED",
        state: "RELEASED",
      }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error_code: "RATE_LIMITED",
      }), { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    const released = await analyzeGrowthReport(request).catch((error) => error);
    expect(released).toMatchObject({
      requestState: "RELEASED",
      statusCode: 429,
      retryable: true,
    });
    const ambiguous = await analyzeGrowthReport(request).catch((error) => error);
    expect(ambiguous).toMatchObject({
      requestState: "UNKNOWN",
      retryable: false,
    });
  });

  it("recognizes nested PROCESSING and IN_PROGRESS states for same-request polling", async () => {
    vi.stubEnv("GROWTH_REPORT_ENGINE_URL", "https://engine.invalid");
    vi.stubEnv("GROWTH_REPORT_ENGINE_SECRET", "test-only-secret");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { registry_state: "PROCESSING" },
      }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        details: { request_state: "IN_PROGRESS" },
      }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);

    for (const state of ["PROCESSING", "IN_PROGRESS"]) {
      const error = await analyzeGrowthReport(request).catch((caught) => caught);
      expect(error).toMatchObject({ requestState: state, retryable: true });
    }
  });

  it("does not issue an HTTP request when monthly attempt admission is denied", async () => {
    vi.stubEnv("GROWTH_REPORT_ENGINE_URL", "https://engine.invalid");
    vi.stubEnv("GROWTH_REPORT_ENGINE_SECRET", "test-only-secret");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const denial of ["MONTHLY_AUTOMATION_PAUSED", "MONTHLY_ATTEMPT_ACCOUNTING_FAILED"]) {
      const error = await analyzeGrowthReport(request, {
        onHttpAttempt: async () => { throw new Error(denial); },
      }).catch(caught => caught);
      expect(error).toBeInstanceOf(EngineCallError);
      expect(error).toMatchObject({ errorCode: denial, statusCode: 0, retryable: false });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
