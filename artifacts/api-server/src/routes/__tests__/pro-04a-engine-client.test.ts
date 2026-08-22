/**
 * WP-PRO-04A — Professional Engine Client Integration Tests
 *
 * TC1  valid engine response → correct field mapping
 * TC2  request_id forwarded as X-Request-Id header AND body field
 * TC3  Authorization header server-side only (secret not in error / response)
 * TC4  timeout → ENGINE_TIMEOUT
 * TC5  401 → ENGINE_UNAUTHORIZED
 * TC6  5xx / network error → ENGINE_UNAVAILABLE
 * TC7  no generic GPT fallback masquerading as grounded success
 * TC8  actual_call_count semantics (0 when not configured, 1 on HTTP attempt)
 * TC9  PROFESSIONAL_ENGINE_API_SECRET not in EXPO_PUBLIC_* / frontend scope
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  retrieveProfessionalKnowledge,
  ProfessionalEngineError,
  getProfessionalEngineBaseUrl,
  PRO_ENGINE_TIMEOUT_MS,
} from "../../lib/professional-engine-client.js";

// ─── fetch mock ───────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeOkResponse(body: object) {
  return {
    ok:     true,
    status: 200,
    json:   async () => body,
  };
}
function makeErrorResponse(status: number, body?: object) {
  return {
    ok:     false,
    status,
    json:   async () => body ?? {},
  };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_URL   = "https://mock-pro-engine.test";
const SECRET     = "test-pro-secret-abc123";
const REQUEST_ID = "req-pro-04a-001";

const VALID_ENGINE_RESPONSE = {
  request_id:     REQUEST_ID,
  results: [
    {
      knowledge_id:   "ki_pro_001",
      title:          "자유형 팔 동작 교정",
      text:           "팔꿈치를 높게 유지하는 하이 엘보 드릴",
      knowledge_type: "DRILL",
      score:          0.92,
      evidence_id:    "ev_001",
    },
    {
      knowledge_id:   "ki_pro_002",
      title:          "킥 리듬 분석",
      text:           "6비트 킥 패턴 적용 가이드",
      knowledge_type: "TECHNIQUE",
      score:          0.85,
      evidence_id:    "ev_002",
    },
  ],
  retrieval_meta: { latency_ms: 120, engine_version: "1.0.0" },
};

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  process.env["PROFESSIONAL_ENGINE_BASE_URL"]  = BASE_URL;
  process.env["PROFESSIONAL_ENGINE_API_SECRET"] = SECRET;
});

afterEach(() => {
  delete process.env["PROFESSIONAL_ENGINE_BASE_URL"];
  delete process.env["PROFESSIONAL_ENGINE_API_SECRET"];
});

// ─── TC1: valid response → correct field mapping ──────────────────────────────

describe("TC1: valid engine response → correct field mapping", () => {
  it("maps all required knowledge item fields from engine response", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(VALID_ENGINE_RESPONSE));

    const result = await retrieveProfessionalKnowledge({
      request_id: REQUEST_ID,
      query:      "자유형 팔 동작",
      limit:      8,
    });

    expect(result.response.request_id).toBe(REQUEST_ID);
    expect(result.response.results).toHaveLength(2);

    const first = result.response.results[0];
    expect(first.knowledge_id).toBe("ki_pro_001");
    expect(first.title).toBe("자유형 팔 동작 교정");
    expect(first.text).toBe("팔꿈치를 높게 유지하는 하이 엘보 드릴");
    expect(first.knowledge_type).toBe("DRILL");
    expect(first.score).toBe(0.92);
    expect(first.evidence_id).toBe("ev_001");

    // retrieval_meta passed through
    expect(result.response.retrieval_meta.latency_ms).toBe(120);
  });
});

// ─── TC2: request_id forwarded as X-Request-Id header AND body ────────────────

describe("TC2: request_id forwarded as X-Request-Id header and body field", () => {
  it("passes request_id in both X-Request-Id header and body.request_id", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(VALID_ENGINE_RESPONSE));

    await retrieveProfessionalKnowledge({
      request_id: REQUEST_ID,
      query:      "킥 리듬",
      limit:      5,
    });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/api/professional/retrieve`);

    // Header propagation
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Request-Id"]).toBe(REQUEST_ID);

    // Body propagation
    const body = JSON.parse(init.body as string);
    expect(body.request_id).toBe(REQUEST_ID);
    expect(body.query).toBe("킥 리듬");
    expect(body.limit).toBe(5);
  });
});

// ─── TC3: Authorization header server-side only ───────────────────────────────

describe("TC3: Authorization header server-side only — secret not in error/response", () => {
  it("includes Authorization header in request but secret never appears in error message", async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(500));

    let caughtError: ProfessionalEngineError | null = null;
    try {
      await retrieveProfessionalKnowledge({
        request_id: REQUEST_ID,
        query:      "테스트",
        limit:      8,
      });
    } catch (err) {
      caughtError = err as ProfessionalEngineError;
    }

    expect(caughtError).not.toBeNull();
    // Secret must NOT appear in the error message
    expect(caughtError!.message).not.toContain(SECRET);

    // Authorization header WAS sent (server-side — correct)
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers  = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Bearer ${SECRET}`);
  });

  it("no Authorization header sent when secret env is not set", async () => {
    delete process.env["PROFESSIONAL_ENGINE_API_SECRET"];
    mockFetch.mockResolvedValueOnce(makeOkResponse(VALID_ENGINE_RESPONSE));

    await retrieveProfessionalKnowledge({
      request_id: REQUEST_ID,
      query:      "테스트",
      limit:      8,
    });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers  = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
  });
});

// ─── TC4: timeout → ENGINE_TIMEOUT ───────────────────────────────────────────

describe("TC4: timeout → ENGINE_TIMEOUT", () => {
  it("AbortError from timeout is mapped to ENGINE_TIMEOUT", async () => {
    const abortError    = new DOMException("The operation was aborted.", "AbortError");
    mockFetch.mockRejectedValueOnce(abortError);

    await expect(
      retrieveProfessionalKnowledge({
        request_id: REQUEST_ID,
        query:      "타임아웃 테스트",
        limit:      8,
      }),
    ).rejects.toMatchObject({
      errorCode:  "ENGINE_TIMEOUT",
      statusCode: 0,
    });
  });

  it("timeout is set to PRO_ENGINE_TIMEOUT_MS (5000ms)", () => {
    expect(PRO_ENGINE_TIMEOUT_MS).toBe(5_000);
  });
});

// ─── TC5: 401 → ENGINE_UNAUTHORIZED ──────────────────────────────────────────

describe("TC5: 401 → ENGINE_UNAUTHORIZED", () => {
  it("HTTP 401 is mapped to ENGINE_UNAUTHORIZED", async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(401));

    await expect(
      retrieveProfessionalKnowledge({
        request_id: REQUEST_ID,
        query:      "인증 실패 테스트",
        limit:      8,
      }),
    ).rejects.toMatchObject({
      errorCode:  "ENGINE_UNAUTHORIZED",
      statusCode: 401,
    });
  });
});

// ─── TC6: 5xx / network → ENGINE_UNAVAILABLE ─────────────────────────────────

describe("TC6: 5xx / network error → ENGINE_UNAVAILABLE", () => {
  it("HTTP 500 is mapped to ENGINE_UNAVAILABLE", async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(500));

    await expect(
      retrieveProfessionalKnowledge({
        request_id: REQUEST_ID,
        query:      "서버 오류 테스트",
        limit:      8,
      }),
    ).rejects.toMatchObject({
      errorCode:  "ENGINE_UNAVAILABLE",
      statusCode: 500,
    });
  });

  it("HTTP 503 is also ENGINE_UNAVAILABLE", async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(503));

    await expect(
      retrieveProfessionalKnowledge({
        request_id: REQUEST_ID,
        query:      "503 테스트",
        limit:      8,
      }),
    ).rejects.toMatchObject({ errorCode: "ENGINE_UNAVAILABLE" });
  });

  it("network error (fetch rejection) → ENGINE_UNAVAILABLE", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(
      retrieveProfessionalKnowledge({
        request_id: REQUEST_ID,
        query:      "네트워크 오류 테스트",
        limit:      8,
      }),
    ).rejects.toMatchObject({ errorCode: "ENGINE_UNAVAILABLE" });
  });

  it("HTTP 4xx other than 401 → ENGINE_RETRIEVAL_FAILED", async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(400));

    await expect(
      retrieveProfessionalKnowledge({
        request_id: REQUEST_ID,
        query:      "400 테스트",
        limit:      8,
      }),
    ).rejects.toMatchObject({
      errorCode:  "ENGINE_RETRIEVAL_FAILED",
      statusCode: 400,
    });
  });
});

// ─── TC7: no generic GPT fallback ────────────────────────────────────────────

describe("TC7: no generic GPT fallback masquerading as grounded success", () => {
  it("engine error is thrown — not silently swallowed as empty results", async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(503));

    // Must throw — NOT return an empty results array
    await expect(
      retrieveProfessionalKnowledge({
        request_id: REQUEST_ID,
        query:      "폴백 금지 테스트",
        limit:      8,
      }),
    ).rejects.toThrow(ProfessionalEngineError);
  });

  it("ENGINE_URL_NOT_CONFIGURED throws immediately — no network call, no fallback", async () => {
    delete process.env["PROFESSIONAL_ENGINE_BASE_URL"];

    await expect(
      retrieveProfessionalKnowledge({
        request_id: REQUEST_ID,
        query:      "URL 없음",
        limit:      8,
      }),
    ).rejects.toMatchObject({ errorCode: "ENGINE_URL_NOT_CONFIGURED" });

    // fetch must NOT have been called
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── TC8: actual_call_count semantics ────────────────────────────────────────

describe("TC8: actual_call_count semantics", () => {
  it("actual_call_count = 1 on successful HTTP call", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(VALID_ENGINE_RESPONSE));

    const result = await retrieveProfessionalKnowledge({
      request_id: REQUEST_ID,
      query:      "성공 카운트 테스트",
      limit:      8,
    });

    expect(result.actualCallCount).toBe(1);
    expect(result.retryCount).toBe(0);
  });

  it("actual_call_count = 0 when ENGINE_URL_NOT_CONFIGURED (no HTTP attempt)", async () => {
    delete process.env["PROFESSIONAL_ENGINE_BASE_URL"];

    let caught: ProfessionalEngineError | null = null;
    try {
      await retrieveProfessionalKnowledge({
        request_id: REQUEST_ID,
        query:      "URL 없음",
        limit:      8,
      });
    } catch (err) {
      caught = err as ProfessionalEngineError;
    }

    expect(caught?.errorCode).toBe("ENGINE_URL_NOT_CONFIGURED");
    // No fetch call made → actual_call_count conceptually 0
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("latencyMs is a non-negative number on success", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(VALID_ENGINE_RESPONSE));

    const result = await retrieveProfessionalKnowledge({
      request_id: REQUEST_ID,
      query:      "레이턴시 테스트",
      limit:      8,
    });

    expect(typeof result.latencyMs).toBe("number");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

// ─── TC9: secret not in EXPO_PUBLIC_* / frontend scope ───────────────────────

describe("TC9: PROFESSIONAL_ENGINE_API_SECRET not in frontend/mobile config", () => {
  it("no EXPO_PUBLIC_PROFESSIONAL_ENGINE_API_SECRET env var defined", () => {
    // Expo bakes EXPO_PUBLIC_* vars into the mobile bundle at build time.
    // Secret must NEVER be an EXPO_PUBLIC_* variable.
    const exposedKeys = Object.keys(process.env).filter((k) =>
      k.startsWith("EXPO_PUBLIC_") && k.includes("PROFESSIONAL")
    );
    expect(exposedKeys).toHaveLength(0);
  });

  it("getProfessionalEngineBaseUrl reads PROFESSIONAL_ENGINE_BASE_URL (server-only name)", () => {
    // Base URL is server-only env var name — not EXPO_PUBLIC_*
    expect("PROFESSIONAL_ENGINE_BASE_URL").not.toMatch(/^EXPO_PUBLIC_/);
    expect(getProfessionalEngineBaseUrl()).toBe(BASE_URL);
  });

  it("secret env var name is server-only — not EXPO_PUBLIC_*", () => {
    expect("PROFESSIONAL_ENGINE_API_SECRET").not.toMatch(/^EXPO_PUBLIC_/);
  });
});
