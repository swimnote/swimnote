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
