/**
 * parent-curriculum-engine-jwt.test.ts
 *
 * Unit tests for JWT-based auth in parent-curriculum-engine-client.ts
 *
 * TC-JWT-01  JWT generated successfully with required claims
 * TC-JWT-02  exp claim exists (short-lived)
 * TC-JWT-03  Authorization Bearer header is set with JWT (not static secret)
 * TC-JWT-04  Missing JWT_SECRET → fail-closed (throws JWT_SECRET_NOT_CONFIGURED)
 * TC-JWT-05  Static PARENT_CURRICULUM_ENGINE_SECRET not used
 * TC-JWT-06  JWT role is pool_admin
 * TC-JWT-07  JWT algorithm is HS256
 * TC-JWT-08  JWT poolId claim matches input
 *
 * TC-EP-01   nested body.error.code (engine v1 format) — 401 → UNAUTHORIZED
 * TC-EP-02   nested body.error.code — 422 → CURRICULUM_SCOPE_UNAVAILABLE
 * TC-EP-03   legacy flat body.error_code — backwards compatible
 * TC-EP-04   unknown body → ENGINE_HTTP_ERROR fallback
 * TC-EP-05   nested error.retryable=false honoured over status-derived value
 * TC-EP-06   HTTP status preserved on thrown error
 *
 * TC-DG-01   engine 401 → engineStatus=401 preserved on error
 * TC-DG-02   engine 403 → engineStatus=403 preserved on error
 * TC-DG-03   engine 404 HTML → engineStatus=404 preserved (JSON parse fails)
 * TC-DG-04   engine 422 nested error.code → engineStatus=422 + code preserved
 * TC-DG-05   engine 200 success → no error, existing behaviour unchanged
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import {
  generateEngineJwt,
  ParentCurriculumEngineError,
  searchParentCurriculum,
  type ParentCurriculumEngineRequest,
} from "../parent-curriculum-engine-client.js";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const TEST_POOL_ID = "pool_test_jwt_01";
const TEST_SECRET  = "test-jwt-secret-at-least-32-chars-long-abc123";

function makeRequest(overrides: Partial<ParentCurriculumEngineRequest> = {}): ParentCurriculumEngineRequest {
  return {
    request_id:     "req_jwt_test_001",
    schema_version: "1.0",
    feature:        "parent_curriculum_search",
    query:          "자유형킥",
    context: {
      pool_id:          TEST_POOL_ID,
      pool_name:        "테스트수영장",
      student_id:       "stu_jwt_test",
      mode:             "X",
      curriculum_scope: {
        source:           "X_GLOBAL",
        curriculum_items: [
          { id: "ci_01", title: "자유형킥", content: "킥 설명", order: 1 },
        ],
      },
      student_progress: undefined,
    },
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("generateEngineJwt", () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv, JWT_SECRET: TEST_SECRET };
    // Ensure static secret env is absent
    delete process.env["PARENT_CURRICULUM_ENGINE_SECRET"];
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it("TC-JWT-01: generates a valid JWT with required claims", () => {
    const token = generateEngineJwt(TEST_POOL_ID);
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3); // header.payload.sig

    const decoded = jwt.verify(token, TEST_SECRET) as Record<string, unknown>;
    expect(decoded["userId"]).toBe(TEST_POOL_ID);
    expect(decoded["role"]).toBe("pool_admin");
    expect(decoded["poolId"]).toBe(TEST_POOL_ID);
    expect(decoded["tv"]).toBe(1);
  });

  it("TC-JWT-02: exp claim exists (short-lived ≤ 5 min)", () => {
    const token   = generateEngineJwt(TEST_POOL_ID);
    const decoded = jwt.verify(token, TEST_SECRET) as Record<string, unknown>;
    const now     = Math.floor(Date.now() / 1000);
    expect(typeof decoded["exp"]).toBe("number");
    // exp should be within 5 minutes from now
    expect((decoded["exp"] as number) - now).toBeGreaterThan(0);
    expect((decoded["exp"] as number) - now).toBeLessThanOrEqual(300);
  });

  it("TC-JWT-06: JWT role is pool_admin", () => {
    const token   = generateEngineJwt(TEST_POOL_ID);
    const decoded = jwt.decode(token) as Record<string, unknown>;
    expect(decoded["role"]).toBe("pool_admin");
  });

  it("TC-JWT-07: JWT algorithm is HS256", () => {
    const token   = generateEngineJwt(TEST_POOL_ID);
    const header  = JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString()) as Record<string, unknown>;
    expect(header["alg"]).toBe("HS256");
  });

  it("TC-JWT-08: JWT poolId claim matches input", () => {
    const OTHER = "pool_other_xyz";
    const token  = generateEngineJwt(OTHER);
    const decoded = jwt.decode(token) as Record<string, unknown>;
    expect(decoded["poolId"]).toBe(OTHER);
    expect(decoded["userId"]).toBe(OTHER);
  });

  it("TC-JWT-04: missing JWT_SECRET → fail-closed with JWT_SECRET_NOT_CONFIGURED", () => {
    delete process.env["JWT_SECRET"];
    expect(() => generateEngineJwt(TEST_POOL_ID)).toThrow(ParentCurriculumEngineError);
    try {
      generateEngineJwt(TEST_POOL_ID);
    } catch (err) {
      expect((err as ParentCurriculumEngineError).errorCode).toBe("JWT_SECRET_NOT_CONFIGURED");
      expect((err as ParentCurriculumEngineError).retryable).toBe(false);
    }
  });
});

describe("searchParentCurriculum — JWT auth", () => {
  const origEnv  = process.env;
  const origFetch = global.fetch;

  beforeEach(() => {
    process.env = {
      ...origEnv,
      JWT_SECRET:                     TEST_SECRET,
      PARENT_CURRICULUM_ENGINE_URL:   "https://engine.test",
      PARENT_CURRICULUM_ENGINE_TIMEOUT_MS: "5000",
    };
    delete process.env["PARENT_CURRICULUM_ENGINE_SECRET"];
  });

  afterEach(() => {
    process.env  = origEnv;
    global.fetch = origFetch;
  });

  it("TC-JWT-03: Authorization header uses Bearer JWT (not static secret)", async () => {
    let capturedAuth: string | undefined;

    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedAuth = (init?.headers as Record<string, string>)["Authorization"];
      const body: unknown = {
        request_id:     "req_jwt_test_001",
        schema_version: "1.0",
        feature:        "parent_curriculum_search",
        result: {
          answer:           "테스트 답변",
          current_progress: null,
          next_step:        null,
        },
        grounding: { curriculum_ids: ["ci_01"], validation: "PASS" },
      };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;

    await searchParentCurriculum(makeRequest());

    expect(capturedAuth).toBeDefined();
    expect(capturedAuth!.startsWith("Bearer ")).toBe(true);

    // Must be a valid JWT (3 parts), not a static secret
    const token = capturedAuth!.slice("Bearer ".length);
    expect(token.split(".")).toHaveLength(3);

    // Verify it decodes correctly with our secret
    const decoded = jwt.verify(token, TEST_SECRET) as Record<string, unknown>;
    expect(decoded["role"]).toBe("pool_admin");
    expect(decoded["poolId"]).toBe(TEST_POOL_ID);
  });

  it("TC-JWT-05: static PARENT_CURRICULUM_ENGINE_SECRET is NOT used in Authorization", async () => {
    const STATIC_SECRET = "static-secret-that-must-not-appear";
    process.env["PARENT_CURRICULUM_ENGINE_SECRET"] = STATIC_SECRET;

    let capturedAuth: string | undefined;
    global.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedAuth = (init?.headers as Record<string, string>)["Authorization"];
      const body: unknown = {
        request_id:     "req_jwt_test_001",
        schema_version: "1.0",
        feature:        "parent_curriculum_search",
        result: { answer: "ok", current_progress: null, next_step: null },
        grounding: { curriculum_ids: ["ci_01"], validation: "PASS" },
      };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;

    await searchParentCurriculum(makeRequest());

    expect(capturedAuth).not.toContain(STATIC_SECRET);
    // Must still be a JWT
    const token = capturedAuth!.slice("Bearer ".length);
    expect(token.split(".")).toHaveLength(3);
  });
});

// ─── Error Parser Tests ────────────────────────────────────────────────────────

describe("searchParentCurriculum — error parser (TC-EP)", () => {
  const origEnv   = process.env;
  const origFetch = global.fetch;

  beforeEach(() => {
    process.env = {
      ...origEnv,
      JWT_SECRET:                          TEST_SECRET,
      PARENT_CURRICULUM_ENGINE_URL:        "https://engine.test",
      PARENT_CURRICULUM_ENGINE_TIMEOUT_MS: "5000",
    };
    delete process.env["PARENT_CURRICULUM_ENGINE_SECRET"];
  });

  afterEach(() => {
    process.env  = origEnv;
    global.fetch = origFetch;
  });

  function mockEngineError(status: number, body: unknown): void {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    ) as typeof fetch;
  }

  it("TC-EP-01: nested body.error.code on 401 → UNAUTHORIZED preserved", async () => {
    mockEngineError(401, {
      request_id:     "req_ep_01",
      schema_version: "1.0",
      feature:        "parent_curriculum_search",
      error: { code: "UNAUTHORIZED", message: "인증이 필요합니다.", retryable: false },
    });

    await expect(searchParentCurriculum(makeRequest())).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ParentCurriculumEngineError &&
        err.errorCode    === "UNAUTHORIZED" &&
        err.statusCode   === 401            &&
        err.retryable    === false,
    );
  });

  it("TC-EP-02: nested body.error.code on 422 → CURRICULUM_SCOPE_UNAVAILABLE preserved", async () => {
    mockEngineError(422, {
      request_id:     "req_ep_02",
      schema_version: "1.0",
      feature:        "parent_curriculum_search",
      error: { code: "CURRICULUM_SCOPE_UNAVAILABLE", message: "유효하지 않은 curriculum source입니다.", retryable: false },
    });

    await expect(searchParentCurriculum(makeRequest())).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ParentCurriculumEngineError &&
        err.errorCode    === "CURRICULUM_SCOPE_UNAVAILABLE" &&
        err.statusCode   === 422                             &&
        err.retryable    === false,
    );
  });

  it("TC-EP-03: legacy flat body.error_code → backwards compatible", async () => {
    mockEngineError(503, {
      error_code: "SERVICE_UNAVAILABLE",
      message:    "engine overloaded",
    });

    await expect(searchParentCurriculum(makeRequest())).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ParentCurriculumEngineError &&
        err.errorCode  === "SERVICE_UNAVAILABLE" &&
        err.statusCode === 503                   &&
        err.retryable  === true, // in PC_RETRYABLE_ERROR_CODES
    );
  });

  it("TC-EP-04: unknown body → ENGINE_HTTP_ERROR fallback", async () => {
    mockEngineError(500, { unexpected: "field" });

    await expect(searchParentCurriculum(makeRequest())).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ParentCurriculumEngineError &&
        err.errorCode  === "ENGINE_HTTP_ERROR" &&
        err.statusCode === 500                 &&
        err.retryable  === true, // 500 >= 500
    );
  });

  it("TC-EP-05: nested error.retryable=false honoured over status-derived value", async () => {
    // 503 would normally be retryable=true by status, but engine says false
    mockEngineError(503, {
      error: { code: "GENERATION_FAILED", message: "permanent failure", retryable: false },
    });

    await expect(searchParentCurriculum(makeRequest())).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ParentCurriculumEngineError &&
        err.errorCode === "GENERATION_FAILED"      &&
        err.retryable === false,
    );
  });

  it("TC-EP-06: HTTP status is preserved on thrown error", async () => {
    mockEngineError(403, {
      error: { code: "FORBIDDEN", message: "pool not authorised", retryable: false },
    });

    await expect(searchParentCurriculum(makeRequest())).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ParentCurriculumEngineError &&
        err.errorCode  === "FORBIDDEN" &&
        err.statusCode === 403,
    );
  });
});

// ─── Diagnostic Transparency Tests (TC-DG) ────────────────────────────────────

describe("searchParentCurriculum — diagnostic transparency (TC-DG)", () => {
  const origEnv   = process.env;
  const origFetch = global.fetch;

  beforeEach(() => {
    process.env = {
      ...origEnv,
      JWT_SECRET:                          TEST_SECRET,
      PARENT_CURRICULUM_ENGINE_URL:        "https://engine.test",
      PARENT_CURRICULUM_ENGINE_TIMEOUT_MS: "5000",
    };
    delete process.env["PARENT_CURRICULUM_ENGINE_SECRET"];
  });

  afterEach(() => {
    process.env  = origEnv;
    global.fetch = origFetch;
  });

  function mockEngineError(status: number, body: unknown, contentType = "application/json"): void {
    global.fetch = vi.fn(async () =>
      new Response(
        typeof body === "string" ? body : JSON.stringify(body),
        { status, headers: { "Content-Type": contentType } },
      ),
    ) as typeof fetch;
  }

  it("TC-DG-01: engine 401 → engineStatus=401 preserved", async () => {
    mockEngineError(401, {
      error: { code: "UNAUTHORIZED", message: "인증 실패", retryable: false },
    });

    await expect(searchParentCurriculum(makeRequest())).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ParentCurriculumEngineError &&
        err.engineStatus    === 401            &&
        err.engineErrorCode === "UNAUTHORIZED",
    );
  });

  it("TC-DG-02: engine 403 → engineStatus=403 preserved", async () => {
    mockEngineError(403, {
      error: { code: "FORBIDDEN", message: "pool not registered", retryable: false },
    });

    await expect(searchParentCurriculum(makeRequest())).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ParentCurriculumEngineError &&
        err.engineStatus    === 403         &&
        err.engineErrorCode === "FORBIDDEN",
    );
  });

  it("TC-DG-03: engine 404 HTML → engineStatus=404 preserved despite JSON parse failure", async () => {
    mockEngineError(
      404,
      "<!DOCTYPE html><html><body><pre>Cannot POST /wrong</pre></body></html>",
      "text/html",
    );

    await expect(searchParentCurriculum(makeRequest())).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ParentCurriculumEngineError &&
        err.engineStatus    === 404                &&
        err.engineErrorCode === "ENGINE_HTTP_ERROR" && // fallback (JSON parse failed)
        err.engineContentType?.includes("text/html"),
    );
  });

  it("TC-DG-04: engine 422 nested error.code → engineStatus=422 + real code preserved", async () => {
    mockEngineError(422, {
      request_id:     null,
      schema_version: "1.0",
      feature:        "parent_curriculum_search",
      error: {
        code:      "CURRICULUM_SCOPE_UNAVAILABLE",
        message:   "유효하지 않은 curriculum source입니다.",
        retryable: false,
      },
    });

    await expect(searchParentCurriculum(makeRequest())).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ParentCurriculumEngineError &&
        err.engineStatus    === 422                          &&
        err.engineErrorCode === "CURRICULUM_SCOPE_UNAVAILABLE",
    );
  });

  it("TC-DG-05: engine 200 success → no error thrown, existing behaviour unchanged", async () => {
    const successBody = {
      request_id:     "req_jwt_test_001",
      schema_version: "1.0",
      feature:        "parent_curriculum_search",
      result: { answer: "자유형 킥 설명입니다.", current_progress: null, next_step: null },
      grounding: { curriculum_ids: ["ci_01"], validation: "PASS" },
    };
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify(successBody), {
        status:  200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as typeof fetch;

    const result = await searchParentCurriculum(makeRequest());
    expect(result.response.result.answer).toBe("자유형 킥 설명입니다.");
    expect(result.actualCallCount).toBe(1);
    expect(result.retryCount).toBe(0);
  });
});
