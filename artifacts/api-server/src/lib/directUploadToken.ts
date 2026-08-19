/**
 * directUploadToken.ts — Pure helpers for direct-upload session tokens (Task #44)
 *
 * Token format: `<payload_base64url>.<hmac_sha256_base64url>`
 * Secret:       JWT_SECRET env var (required in production, dev-only fallback otherwise).
 *
 * These helpers have zero side effects and no Express/DB imports so they can be
 * imported directly in unit tests without touching the router.
 */
import crypto from "crypto";

// ── Secret resolution ───────────────────────────────────────────────────────
// In production, JWT_SECRET MUST be set via environment variable.
// In non-production environments a dev-only fallback is allowed.
const _rawSecret = process.env.JWT_SECRET;

function resolveSecret(): string {
  if (_rawSecret) return _rawSecret;
  if (process.env.NODE_ENV === "production") {
    // Do not expose a weak default in production; callers must check.
    throw new Error("DIRECT_UPLOAD_SECRET_MISSING: JWT_SECRET is required in production");
  }
  return "swim-platform-secret-key-dev-only";
}

// Resolve once at module load so tests can override via env before import.
// (In production the throw surfaces at server start, not at request time.)
let _secret: string;
function getSecret(): string {
  if (!_secret) _secret = resolveSecret();
  return _secret;
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface UploadSessionPayload {
  /** Random UUID — ties token to one server-generated session */
  nonce: string;
  userId: string;
  poolId: string;
  album_type: "group" | "private";
  /** For group: may be undefined when pool-wide upload (no class selected) */
  class_id?: string;
  student_id?: string;
  lesson_date?: string;
  caption?: string;
  /** client_id → server-generated object_key */
  keys: Record<string, string>;
  /** client_id → declared file_size (bytes) */
  sizes: Record<string, number>;
  /** client_id → declared file_type (MIME) */
  types: Record<string, string>;
  /** Unix epoch seconds when the session expires */
  exp: number;
}

// ── Signing / verification ──────────────────────────────────────────────────

/**
 * Sign a session payload with HMAC-SHA256.
 * Returns `<payload_base64url>.<hmac_base64url>`.
 * Never logs the returned string.
 */
export function signUploadToken(payload: UploadSessionPayload): string {
  const secret = getSecret();
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

/**
 * Verify and decode an upload token.
 * Throws descriptive errors consumed by the route handler:
 *   "invalid_token"     — malformed (no separator)
 *   "invalid_signature" — tampered payload
 *   "token_expired"     — past exp timestamp
 */
export function verifyUploadToken(token: string): UploadSessionPayload {
  const secret = getSecret();
  const dot = token.lastIndexOf(".");
  if (dot < 0) throw new Error("invalid_token");

  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = crypto.createHmac("sha256", secret).update(data).digest("base64url");

  // Pad both to same buffer length for timingSafeEqual
  const expBuf = Buffer.from(expected, "ascii");
  const actBuf = Buffer.from(sig, "ascii");
  let valid = expBuf.length === actBuf.length;
  if (valid) {
    valid = crypto.timingSafeEqual(expBuf, actBuf);
  }
  if (!valid) throw new Error("invalid_signature");

  const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as UploadSessionPayload;
  if (Math.floor(Date.now() / 1000) > payload.exp) throw new Error("token_expired");
  return payload;
}

// ── Validation helpers (pure, no I/O) ───────────────────────────────────────

/** Allowed MIME types for direct upload */
export const DIRECT_UPLOAD_MIME_ALLOWLIST = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

/** JPEG alias pair — image/jpg and image/jpeg are interchangeable */
const JPEG_ALIASES = new Set(["image/jpeg", "image/jpg"]);

export const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB
export const MAX_FILES_PER_SESSION = 10;
export const SESSION_TTL_SECONDS = 5 * 60; // 5 minutes
export const MAX_CAPTION_LENGTH = 500;

/** Safe client_id: printable ASCII only, 1–128 chars */
export function isSafeClientId(id: unknown): boolean {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    id.length <= 128 &&
    /^[\x20-\x7E]+$/.test(id)
  );
}

/** Validate file_size is a positive integer ≤ MAX_FILE_SIZE_BYTES */
export function validateFileSize(size: unknown): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) {
    return { ok: false, error: "file_size는 양의 정수이어야 합니다." };
  }
  if (size > MAX_FILE_SIZE_BYTES) {
    return { ok: false, error: `파일 크기 초과: 최대 8MB까지 업로드할 수 있습니다.` };
  }
  return { ok: true, value: size };
}

/** Derive extension from MIME type */
export function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
  };
  return map[mime] ?? "jpg";
}

/**
 * Verify R2 HEAD metadata against session-declared values.
 * Strict: exact byte count, exact content-type (with jpeg/jpg alias only).
 *
 * Returns null on success, or a string error message.
 */
export function validateHeadMetadata(
  clientId: string,
  declaredSize: number,
  declaredType: string,
  actualContentLength: number,
  actualContentType: string,
): string | null {
  // Exact byte count required
  if (actualContentLength !== declaredSize) {
    return `파일 크기 불일치: ${clientId} (declared ${declaredSize}, actual ${actualContentLength})`;
  }

  // Normalize content-type (strip charset/params)
  const normalizedActual = actualContentType.split(";")[0].trim().toLowerCase();
  const normalizedDeclared = declaredType.split(";")[0].trim().toLowerCase();

  if (normalizedActual === normalizedDeclared) return null;

  // Only allow jpeg ↔ jpg alias
  if (JPEG_ALIASES.has(normalizedActual) && JPEG_ALIASES.has(normalizedDeclared)) return null;

  return `파일 형식 불일치: ${clientId} (declared ${declaredType}, actual ${actualContentType})`;
}
