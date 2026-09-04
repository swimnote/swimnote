/**
 * match-token.ts — Curriculum Match Token 생성 및 검증
 *
 * 설계 결정:
 *   - HMAC-SHA256, MATCH_TOKEN_SECRET 전용 (JWT_SECRET fallback 절대 금지)
 *   - 형식: Base64URL(header).Base64URL(payload).Base64URL(sig)
 *   - 만료: 24시간 (EXPIRES_IN_SEC = 86400)
 *   - token_id: "tid_" + randomBytes(16).toString("hex") (36자)
 *   - MATCH_TOKEN_SECRET 미설정 시 lazy fail (서버 기동 중단 없음)
 *     → createMatchToken/verifyMatchToken 호출 시점에 X_MODE_TOKEN_NOT_CONFIGURED 에러
 *   - timingSafeEqual 사용 (signature 검증)
 *   - 최대 길이 MAX_TOKEN_LEN = 2048 (malformed 조기 탐지)
 *   - token 원문·payload 로그 절대 금지
 *   - JWT_SECRET를 이 파일에서 참조하지 않음
 *
 * WP7 참고:
 *   - DB token_id 저장 시 payload.token_id만 저장 (전체 token 저장 금지)
 *   - growth_events.growth_match_status: DB 기본값 AUTO_ACCEPTED 위험
 *     → INSERT 시 반드시 명시적 'PENDING_REVIEW' 지정 필요
 */

import crypto from "crypto";

// ── 상수 ─────────────────────────────────────────────────────────────────────

const TOKEN_VERSION  = "1" as const;
const TOKEN_TYPE     = "MTC" as const; // Match Token Curriculum
const ALGORITHM      = "HS256" as const;
const EXPIRES_IN_SEC = 86400;          // 24시간
const MAX_TOKEN_LEN  = 2048;           // malformed 조기 탐지

// ── 공개 타입 ─────────────────────────────────────────────────────────────────

export interface MatchTokenPayload {
  token_version:               string;   // "1"
  key_id:                      string;   // MATCH_TOKEN_KEY_ID 값
  token_id:                    string;   // "tid_" + 32자 hex (DB 저장용)
  issued_at:                   number;   // unix seconds
  expires_at:                  number;   // issued_at + EXPIRES_IN_SEC
  pool_id:                     string;
  student_id:                  string;   // students.id (DB 검증 완료)
  curriculum_version_id:       string;
  curriculum_item_id:          string;   // 실제 DB PK (앱 응답 미포함, 여기만)
  candidate_id:                string;   // opaque ID (앱 노출용)
  confidence:                  number;
  matching_algorithm_version:  string;
  confidence_config_version:   string;
  request_id:                  string;
  contract_version:            string;
}

export interface VerifyOptions {
  expectedPoolId:           string;
  expectedStudentId:        string;
  expectedCandidateId:      string;
  /** WP7: match 수락 시 DB curriculum_item_id 추가 검증용 (optional) */
  expectedCurriculumItemId?: string;
}

// ── 오류 클래스 ───────────────────────────────────────────────────────────────

export class MatchTokenError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MatchTokenError";
  }
}

// ── 내부 헬퍼 ─────────────────────────────────────────────────────────────────

/** MATCH_TOKEN_SECRET lazy fail — 미설정 시 기동 중단 없이 호출 시점에 throw */
function getSecret(): string {
  // JWT_SECRET fallback 절대 금지
  const s = process.env.MATCH_TOKEN_SECRET;
  if (!s || s.trim() === "") {
    throw new MatchTokenError(
      "X_MODE_TOKEN_NOT_CONFIGURED",
      "MATCH_TOKEN_SECRET is not configured.",
    );
  }
  return s;
}

function getKeyId(): string {
  return (process.env.MATCH_TOKEN_KEY_ID ?? "default").trim();
}

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function b64urlDecode(s: string): Buffer {
  const rem = s.length % 4;
  const padded = rem ? s + "=".repeat(4 - rem) : s;
  return Buffer.from(
    padded.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  );
}

function buildHeader(keyId: string): string {
  return b64urlEncode(
    Buffer.from(
      JSON.stringify({ alg: ALGORITHM, kid: keyId, typ: TOKEN_TYPE }),
      "utf8",
    ),
  );
}

function signParts(headerB64: string, payloadB64: string, secret: string): string {
  return b64urlEncode(
    crypto
      .createHmac("sha256", secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest(),
  );
}

// ── 공개 헬퍼 ─────────────────────────────────────────────────────────────────

/** token_id 생성 ("tid_" + 32자 hex = 36자). WP7 DB 저장용. */
export function newTokenId(): string {
  return "tid_" + crypto.randomBytes(16).toString("hex");
}

// ── createMatchToken ──────────────────────────────────────────────────────────

/**
 * MatchTokenPayload를 받아 서명된 match token 문자열을 생성합니다.
 *
 * 주의:
 *   - token 원문을 로그에 출력하지 않습니다.
 *   - MATCH_TOKEN_SECRET 미설정 시 MatchTokenError("X_MODE_TOKEN_NOT_CONFIGURED") throw.
 */
export function createMatchToken(payload: MatchTokenPayload): string {
  const secret     = getSecret(); // lazy fail
  const keyId      = getKeyId();
  const headerB64  = buildHeader(keyId);
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sigB64     = signParts(headerB64, payloadB64, secret);

  const token = `${headerB64}.${payloadB64}.${sigB64}`;

  // 길이 안전성 검사 (자체 생성 토큰이 MAX_TOKEN_LEN 초과하면 내부 오류)
  if (token.length > MAX_TOKEN_LEN) {
    throw new MatchTokenError(
      "TOKEN_TOO_LONG",
      `Generated token exceeds MAX_TOKEN_LEN=${MAX_TOKEN_LEN}.`,
    );
  }

  // token 원문 로그 금지
  return token;
}

// ── verifyMatchToken ──────────────────────────────────────────────────────────

/**
 * match token을 검증하고 payload를 반환합니다.
 *
 * 실패 시 MatchTokenError throw (code 포함).
 * payload 내용 로그 금지.
 */
export function verifyMatchToken(
  token: string,
  opts: VerifyOptions,
): MatchTokenPayload {
  // 1. 타입·길이 검사
  if (typeof token !== "string" || token.length === 0) {
    throw new MatchTokenError("MALFORMED_TOKEN", "Token is empty.");
  }
  if (token.length > MAX_TOKEN_LEN) {
    throw new MatchTokenError("MALFORMED_TOKEN", "Token exceeds maximum length.");
  }

  // 2. 3부분 구조 검사
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new MatchTokenError("MALFORMED_TOKEN", "Token must have exactly 3 parts.");
  }
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  // 3. header 파싱
  let header: Record<string, unknown>;
  try {
    header = JSON.parse(b64urlDecode(headerB64).toString("utf8"));
  } catch {
    throw new MatchTokenError("MALFORMED_TOKEN", "Token header is not valid JSON.");
  }

  // 4. token type 검증
  if (header["typ"] !== TOKEN_TYPE) {
    throw new MatchTokenError(
      "UNSUPPORTED_TOKEN_VERSION",
      `Unsupported token type: ${String(header["typ"])}`,
    );
  }

  // 5. key_id 검증 (현재 활성 key_id만 허용)
  const currentKeyId = getKeyId();
  if (header["kid"] !== currentKeyId) {
    throw new MatchTokenError(
      "UNKNOWN_KEY_ID",
      `Unknown key_id: ${String(header["kid"])}`,
    );
  }

  // 6. signature 검증 (timingSafeEqual — timing attack 방지)
  const secret = getSecret(); // lazy fail
  const expectedSig = signParts(headerB64, payloadB64, secret);

  const expectedBuf = Buffer.from(expectedSig, "utf8");
  const actualBuf   = Buffer.from(sigB64, "utf8");

  if (expectedBuf.length !== actualBuf.length) {
    throw new MatchTokenError("INVALID_MATCH_TOKEN", "Signature verification failed.");
  }
  if (!crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    throw new MatchTokenError("INVALID_MATCH_TOKEN", "Signature verification failed.");
  }

  // 7. payload 파싱
  let payload: MatchTokenPayload;
  try {
    payload = JSON.parse(
      b64urlDecode(payloadB64).toString("utf8"),
    ) as MatchTokenPayload;
  } catch {
    throw new MatchTokenError("MALFORMED_TOKEN", "Token payload is not valid JSON.");
  }

  // 8. token_version 검증
  if (payload.token_version !== TOKEN_VERSION) {
    throw new MatchTokenError(
      "UNSUPPORTED_TOKEN_VERSION",
      `Unsupported token_version: ${payload.token_version}`,
    );
  }

  // 9. 만료 검증
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec > payload.expires_at) {
    throw new MatchTokenError("EXPIRED_MATCH_TOKEN", "Token has expired.");
  }

  // 10. pool_id 검증
  if (payload.pool_id !== opts.expectedPoolId) {
    throw new MatchTokenError("TENANT_MISMATCH", "Token pool_id mismatch.");
  }

  // 11. student_id 검증
  if (payload.student_id !== opts.expectedStudentId) {
    throw new MatchTokenError("STUDENT_MISMATCH", "Token student_id mismatch.");
  }

  // 12. candidate_id 검증
  if (payload.candidate_id !== opts.expectedCandidateId) {
    throw new MatchTokenError("CANDIDATE_ID_MISMATCH", "Token candidate_id mismatch.");
  }

  // 13. curriculum_item_id 검증 (WP7 optional)
  if (
    opts.expectedCurriculumItemId !== undefined &&
    payload.curriculum_item_id !== opts.expectedCurriculumItemId
  ) {
    throw new MatchTokenError(
      "CURRICULUM_ITEM_MISMATCH",
      "Token curriculum_item_id mismatch.",
    );
  }

  // payload 로그 금지
  return payload;
}
