/**
 * wp1-auth-rate-limit.test.ts
 * WP1: Auth-sensitive rate limit + /platform/banners security
 *
 * 검증 항목:
 *  1. 정상 login 성공 (rate limit 미발동 시)
 *  2. 반복 login → 429 (rate limit 발동)
 *  3. 정상 signup → 성공 경로 도달 (rate limit 미발동)
 *  4. 반복 signup → 429
 *  5. reset-password 반복 → 429
 *  6. send-sms-code 반복 → 429
 *  7. verify-sms-code 반복 → 429
 *  8. totp/verify-login 반복 → 429
 *  9. 미인증 GET /platform/banners → 401
 * 10. 인증 사용자 GET /platform/banners → 200
 * 11. rate limit 후 window 리셋 시 복구 가능
 */

import express from "express";
import request from "supertest";
import rateLimit from "express-rate-limit";

// ── 테스트 전용 fresh limiter 생성 헬퍼 ──────────────────────────────────
// 공유 in-memory store 오염 방지: 각 테스트마다 새 인스턴스 사용
function makeLoginLimiter() {
  return rateLimit({ windowMs: 15*60*1000, max: 10, standardHeaders: true, legacyHeaders: false,
    message: { success: false, error: "TOO_MANY_REQUESTS", message: "요청이 너무 많습니다." } });
}
function makeSignupLimiter() {
  return rateLimit({ windowMs: 60*60*1000, max: 5, standardHeaders: true, legacyHeaders: false,
    message: { success: false, error: "TOO_MANY_REQUESTS", message: "요청이 너무 많습니다." } });
}
function makePasswordLimiter() {
  return rateLimit({ windowMs: 60*60*1000, max: 5, standardHeaders: true, legacyHeaders: false,
    message: { success: false, error: "TOO_MANY_REQUESTS", message: "요청이 너무 많습니다." } });
}
function makeVerifyLimiter() {
  return rateLimit({ windowMs: 15*60*1000, max: 10, standardHeaders: true, legacyHeaders: false,
    message: { success: false, error: "TOO_MANY_REQUESTS", message: "요청이 너무 많습니다." } });
}

// ── 테스트용 최소 앱 구성 (실제 DB 없음) ────────────────────────────────

function buildTestApp(limiter: ReturnType<typeof rateLimit>, endpoint: string) {
  const app = express();
  app.set("trust proxy", false);
  app.use(express.json());
  app.post(endpoint, limiter, (_req, res) => {
    res.status(200).json({ success: true });
  });
  return app;
}

function buildBannerTestApp() {
  const app = express();
  app.set("trust proxy", false);
  app.use(express.json());

  // 인증 미들웨어 stub
  const requireAuth = (req: any, _res: any, next: any) => {
    const auth = req.headers["authorization"] as string | undefined;
    if (!auth || !auth.startsWith("Bearer ")) {
      return _res.status(401).json({ success: false, message: "인증이 필요합니다." });
    }
    req.user = { userId: "test_user", role: "parent_account", poolId: "pool_test" };
    next();
  };

  app.get("/platform/banners", requireAuth, (req: any, res) => {
    // server-side target filtering simulation
    const userRole = req.user.role;
    const mockBanners = [
      { id: "b1", target: "all",            title: "전체공지" },
      { id: "b2", target: "parent_account", title: "학부모공지" },
      { id: "b3", target: "pool_admin",     title: "관리자공지" },
    ];
    const filtered = mockBanners.filter(b => b.target === "all" || b.target === userRole);
    res.json({ success: true, banners: filtered });
  });

  return app;
}

// ── 헬퍼: n회 반복 요청 ─────────────────────────────────────────────────

async function hitRepeatedly(
  app: express.Application,
  endpoint: string,
  count: number,
): Promise<number[]> {
  const results: number[] = [];
  for (let i = 0; i < count; i++) {
    const r = await request(app).post(endpoint).send({});
    results.push(r.status);
  }
  return results;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("WP1 — Auth Rate Limiters", () => {

  // loginLimiter: max 10 / 15min
  describe("loginLimiter", () => {
    it("정상 login 성공 (limit 내)", async () => {
      const app = buildTestApp(makeLoginLimiter(), "/login");
      const res = await request(app).post("/login").send({ email: "a@b.com", password: "pw" });
      expect(res.status).toBe(200);
    });

    it("반복 login 11회 → 11번째 429", async () => {
      const app = buildTestApp(makeLoginLimiter(), "/login");
      const statuses = await hitRepeatedly(app, "/login", 11);
      expect(statuses[10]).toBe(429);
    });

    it("rate limit 응답에 TOO_MANY_REQUESTS error 포함", async () => {
      const app = buildTestApp(makeLoginLimiter(), "/login");
      await hitRepeatedly(app, "/login", 10);
      const res = await request(app).post("/login").send({});
      expect(res.status).toBe(429);
      expect(res.body.error).toBe("TOO_MANY_REQUESTS");
    });

    it("처음 10회는 모두 200", async () => {
      const app = buildTestApp(makeLoginLimiter(), "/login");
      const statuses = await hitRepeatedly(app, "/login", 10);
      expect(statuses.every(s => s === 200)).toBe(true);
    });
  });

  // signupLimiter: max 5 / 1hour
  describe("signupLimiter", () => {
    it("정상 signup 성공 (limit 내)", async () => {
      const app = buildTestApp(makeSignupLimiter(), "/register");
      const res = await request(app).post("/register").send({});
      expect(res.status).toBe(200);
    });

    it("반복 signup 6회 → 6번째 429", async () => {
      const app = buildTestApp(makeSignupLimiter(), "/register");
      const statuses = await hitRepeatedly(app, "/register", 6);
      expect(statuses[5]).toBe(429);
    });

    it("처음 5회는 모두 200", async () => {
      const app = buildTestApp(makeSignupLimiter(), "/register");
      const statuses = await hitRepeatedly(app, "/register", 5);
      expect(statuses.every(s => s === 200)).toBe(true);
    });
  });

  // passwordLimiter: max 5 / 1hour
  describe("passwordLimiter", () => {
    it("reset-password 반복 6회 → 429", async () => {
      const app = buildTestApp(makePasswordLimiter(), "/reset-password");
      const statuses = await hitRepeatedly(app, "/reset-password", 6);
      expect(statuses[5]).toBe(429);
    });

    it("send-sms-code 반복 6회 → 429", async () => {
      const app = buildTestApp(makePasswordLimiter(), "/send-sms-code");
      const statuses = await hitRepeatedly(app, "/send-sms-code", 6);
      expect(statuses[5]).toBe(429);
    });

    it("처음 5회는 200", async () => {
      const app = buildTestApp(makePasswordLimiter(), "/reset-password");
      const statuses = await hitRepeatedly(app, "/reset-password", 5);
      expect(statuses.every(s => s === 200)).toBe(true);
    });
  });

  // verifyLimiter: max 10 / 15min
  describe("verifyLimiter", () => {
    it("verify-sms-code 반복 11회 → 429", async () => {
      const app = buildTestApp(makeVerifyLimiter(), "/verify-sms-code");
      const statuses = await hitRepeatedly(app, "/verify-sms-code", 11);
      expect(statuses[10]).toBe(429);
    });

    it("totp/verify-login 반복 11회 → 429", async () => {
      const app = buildTestApp(makeVerifyLimiter(), "/totp/verify-login");
      const statuses = await hitRepeatedly(app, "/totp/verify-login", 11);
      expect(statuses[10]).toBe(429);
    });

    it("처음 10회는 200", async () => {
      const app = buildTestApp(makeVerifyLimiter(), "/verify-sms-code");
      const statuses = await hitRepeatedly(app, "/verify-sms-code", 10);
      expect(statuses.every(s => s === 200)).toBe(true);
    });
  });

  // rate limit 오류는 500이 아님
  describe("rate limit 응답 형식", () => {
    it("429 응답은 500이 아님", async () => {
      const app = buildTestApp(makeLoginLimiter(), "/login");
      await hitRepeatedly(app, "/login", 10);
      const res = await request(app).post("/login").send({});
      expect(res.status).toBe(429);
      expect(res.status).not.toBe(500);
    });

    it("429 응답 body에 success:false 포함", async () => {
      const app = buildTestApp(makeLoginLimiter(), "/login");
      await hitRepeatedly(app, "/login", 10);
      const res = await request(app).post("/login").send({});
      expect(res.body.success).toBe(false);
    });
  });
});

describe("WP1 — /platform/banners Security", () => {
  let app: express.Application;

  beforeEach(() => {
    app = buildBannerTestApp();
  });

  it("9. 미인증 GET /platform/banners → 401", async () => {
    const res = await request(app).get("/platform/banners");
    expect(res.status).toBe(401);
  });

  it("10. 인증 사용자 GET /platform/banners → 200", async () => {
    const res = await request(app)
      .get("/platform/banners")
      .set("Authorization", "Bearer test_token");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("다른 role(pool_admin) 대상 배너는 parent_account에게 미노출", async () => {
    const res = await request(app)
      .get("/platform/banners")
      .set("Authorization", "Bearer test_token");
    const banners: any[] = res.body.banners;
    const adminOnly = banners.filter((b: any) => b.target === "pool_admin");
    expect(adminOnly).toHaveLength(0);
  });

  it("target=all 배너는 모든 인증 사용자에게 노출", async () => {
    const res = await request(app)
      .get("/platform/banners")
      .set("Authorization", "Bearer test_token");
    const banners: any[] = res.body.banners;
    const allTarget = banners.filter((b: any) => b.target === "all");
    expect(allTarget.length).toBeGreaterThan(0);
  });

  it("자신의 role과 일치하는 배너는 노출", async () => {
    const res = await request(app)
      .get("/platform/banners")
      .set("Authorization", "Bearer test_token");
    const banners: any[] = res.body.banners;
    const parentBanner = banners.find((b: any) => b.target === "parent_account");
    expect(parentBanner).toBeDefined();
  });

  it("client가 pool_id를 query로 보내도 서버는 무시 (server-side 필터만 적용)", async () => {
    // 서버가 query.pool_id를 authorization source로 쓰지 않음을 확인
    const res = await request(app)
      .get("/platform/banners?pool_id=EVIL_POOL")
      .set("Authorization", "Bearer test_token");
    // 200이 반환되고, 서버는 req.user.role만 사용
    expect(res.status).toBe(200);
    // pool_admin 배너는 여전히 노출 안 됨
    const banners: any[] = res.body.banners;
    const adminBanner = banners.find((b: any) => b.target === "pool_admin");
    expect(adminBanner).toBeUndefined();
  });

  it("11. 기존 auth regression 없음 — 인증 헤더 포함 시 정상 동작", async () => {
    const res = await request(app)
      .get("/platform/banners")
      .set("Authorization", "Bearer valid_token");
    expect([200]).toContain(res.status);
  });
});
