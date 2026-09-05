/**
 * rate-limit.ts — Auth-sensitive endpoint rate limiters (WP1)
 *
 * 사용 기술: express-rate-limit (^8.x, 이미 설치됨)
 *
 * 정책:
 *  - loginLimiter:    로그인 계열 — 15분 창에 IP당 10회
 *  - signupLimiter:   회원가입 계열 — 1시간에 IP당 5회
 *  - passwordLimiter: 비밀번호/SMS 발송 계열 — 1시간에 IP당 5회
 *  - verifyLimiter:   코드/OTP 검증 계열 — 15분에 IP당 10회
 *
 * 정상 사용자를 차단하지 않는 보수적 값입니다.
 * brute-force / credential stuffing 방어가 목적이며
 * 전체 API에 적용하는 global limiter가 아닙니다.
 */

import rateLimit from "express-rate-limit";

const RATE_LIMIT_MESSAGE = {
  success: false,
  error: "TOO_MANY_REQUESTS",
  message: "요청이 너무 많습니다. 잠시 후 다시 시도하십시오.",
};

/** 로그인 계열: 15분에 IP당 10회 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: RATE_LIMIT_MESSAGE,
  skipSuccessfulRequests: false,
});

/** 회원가입 계열: 1시간에 IP당 5회 */
export const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: RATE_LIMIT_MESSAGE,
  skipSuccessfulRequests: false,
});

/** 비밀번호·SMS 발송 계열: 1시간에 IP당 5회 */
export const passwordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: RATE_LIMIT_MESSAGE,
  skipSuccessfulRequests: false,
});

/** 코드·OTP 검증 계열: 15분에 IP당 10회 */
export const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: RATE_LIMIT_MESSAGE,
  skipSuccessfulRequests: false,
});
