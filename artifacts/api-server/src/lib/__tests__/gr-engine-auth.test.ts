/**
 * gr-engine-auth.test.ts
 *
 * TC1  signed JWT 생성 확인
 * TC2  algorithm HS256
 * TC3  userId 존재
 * TC4  allowed role (platform_admin)
 * TC5  tv = 1
 * TC6  iat 존재
 * TC7  exp 존재
 * TC8  short expiry (≤ 5 minutes from iat)
 * TC9  raw secret이 Authorization 헤더에 직접 사용되지 않음
 * TC10 missing secret → ENGINE_SECRET_NOT_CONFIGURED config error (non-retryable)
 * TC11 secret/token 값이 로그에 출력되지 않음
 */

import jwt from "jsonwebtoken";
import { vi } from "vitest";
import { createServiceJwt, EngineCallError } from "../growth-report-engine-client.js";

const TEST_SECRET = "test-engine-secret-abc123";

// ─── helpers ─────────────────────────────────────────────────────────────────

function withSecret(secret: string | undefined, fn: () => void) {
  const orig = process.env["GROWTH_REPORT_ENGINE_SECRET"];
  if (secret === undefined) {
    delete process.env["GROWTH_REPORT_ENGINE_SECRET"];
  } else {
    process.env["GROWTH_REPORT_ENGINE_SECRET"] = secret;
  }
  try {
    fn();
  } finally {
    if (orig === undefined) {
      delete process.env["GROWTH_REPORT_ENGINE_SECRET"];
    } else {
      process.env["GROWTH_REPORT_ENGINE_SECRET"] = orig;
    }
  }
}

// ─── TC1: signed JWT 생성 확인 ────────────────────────────────────────────────

test("TC1 createServiceJwt returns a non-empty string", () => {
  withSecret(TEST_SECRET, () => {
    const token = createServiceJwt(null);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });
});

// ─── TC2: algorithm HS256 ────────────────────────────────────────────────────

test("TC2 token uses HS256 algorithm", () => {
  withSecret(TEST_SECRET, () => {
    const token = createServiceJwt(null);
    const decoded = jwt.verify(token, TEST_SECRET, { algorithms: ["HS256"] }) as jwt.JwtPayload;
    expect(decoded).toBeTruthy();
  });
});

// ─── TC3: userId 존재 ─────────────────────────────────────────────────────────

test("TC3 token payload contains non-empty userId", () => {
  withSecret(TEST_SECRET, () => {
    const token = createServiceJwt(null);
    const { userId } = jwt.decode(token) as jwt.JwtPayload & { userId: string };
    expect(typeof userId).toBe("string");
    expect(userId.length).toBeGreaterThan(0);
  });
});

// ─── TC4: allowed role ────────────────────────────────────────────────────────

test("TC4 token role is platform_admin", () => {
  withSecret(TEST_SECRET, () => {
    const token = createServiceJwt(null);
    const { role } = jwt.decode(token) as jwt.JwtPayload & { role: string };
    expect(role).toBe("platform_admin");
  });
});

// ─── TC5: tv = 1 ──────────────────────────────────────────────────────────────

test("TC5 token tv claim equals 1", () => {
  withSecret(TEST_SECRET, () => {
    const token = createServiceJwt(null);
    const { tv } = jwt.decode(token) as jwt.JwtPayload & { tv: number };
    expect(tv).toBe(1);
  });
});

// ─── TC6: iat 존재 ────────────────────────────────────────────────────────────

test("TC6 token iat is present and a positive integer", () => {
  withSecret(TEST_SECRET, () => {
    const token = createServiceJwt(null);
    const { iat } = jwt.decode(token) as jwt.JwtPayload;
    expect(typeof iat).toBe("number");
    expect(iat!).toBeGreaterThan(0);
  });
});

// ─── TC7: exp 존재 ────────────────────────────────────────────────────────────

test("TC7 token exp is present and greater than iat", () => {
  withSecret(TEST_SECRET, () => {
    const token = createServiceJwt(null);
    const { iat, exp } = jwt.decode(token) as jwt.JwtPayload;
    expect(typeof exp).toBe("number");
    expect(exp!).toBeGreaterThan(iat!);
  });
});

// ─── TC8: short expiry ────────────────────────────────────────────────────────

test("TC8 token expiry is at most 5 minutes from iat", () => {
  withSecret(TEST_SECRET, () => {
    const token = createServiceJwt(null);
    const { iat, exp } = jwt.decode(token) as jwt.JwtPayload;
    const ttlSeconds = exp! - iat!;
    expect(ttlSeconds).toBeLessThanOrEqual(5 * 60);
  });
});

// ─── TC9: raw secret이 Authorization에 직접 사용되지 않음 ─────────────────────

test("TC9 raw secret is NOT the token itself", () => {
  withSecret(TEST_SECRET, () => {
    const token = createServiceJwt(null);
    // A raw secret would not be a valid JWT (no dots / base64url structure)
    expect(token).not.toBe(TEST_SECRET);
    // A proper JWT has exactly 3 dot-separated parts
    expect(token.split(".")).toHaveLength(3);
  });
});

// ─── TC10: missing secret → ENGINE_SECRET_NOT_CONFIGURED ─────────────────────

test("TC10 missing secret throws non-retryable EngineCallError", () => {
  withSecret(undefined, () => {
    let caught: unknown;
    try {
      createServiceJwt(null);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(EngineCallError);
    const err = caught as EngineCallError;
    expect(err.errorCode).toBe("ENGINE_SECRET_NOT_CONFIGURED");
    expect(err.retryable).toBe(false);
    expect(err.statusCode).toBe(0);
  });
});

// ─── TC11: secret/token 값이 로그에 출력되지 않음 ────────────────────────────

test("TC11 createServiceJwt does not log secret or full token", () => {
  withSecret(TEST_SECRET, () => {
    const logSpy   = vi.spyOn(console, "log").mockImplementation(() => {});
    const infoSpy  = vi.spyOn(console, "info").mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    try {
      const token = createServiceJwt("pool_abc");

      const allCalls = [
        ...logSpy.mock.calls,
        ...infoSpy.mock.calls,
        ...debugSpy.mock.calls,
      ].map((args) => args.join(" "));

      for (const line of allCalls) {
        expect(line).not.toContain(TEST_SECRET);
        expect(line).not.toContain(token);
      }
    } finally {
      logSpy.mockRestore();
      infoSpy.mockRestore();
      debugSpy.mockRestore();
    }
  });
});

// ─── poolId binding ───────────────────────────────────────────────────────────

test("TC_POOL poolId is correctly bound to token payload", () => {
  withSecret(TEST_SECRET, () => {
    const token = createServiceJwt("pool_xyz");
    const { poolId } = jwt.decode(token) as jwt.JwtPayload & { poolId: string };
    expect(poolId).toBe("pool_xyz");
  });
});

test("TC_POOL_NULL null poolId is preserved", () => {
  withSecret(TEST_SECRET, () => {
    const token = createServiceJwt(null);
    const { poolId } = jwt.decode(token) as jwt.JwtPayload & { poolId: null };
    expect(poolId).toBeNull();
  });
});
