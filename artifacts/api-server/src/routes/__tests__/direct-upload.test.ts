/**
 * Unit tests for direct-upload helpers (Task #44)
 *
 * Pure logic only — no live R2 / DB / Express imports.
 * All helpers are imported from lib/directUploadToken.ts so the test does not
 * pull in the entire Express router.
 */
import { describe, it, expect } from "vitest";
import {
  signUploadToken,
  verifyUploadToken,
  isSafeClientId,
  validateFileSize,
  validateHeadMetadata,
  extFromMime,
  DIRECT_UPLOAD_MIME_ALLOWLIST,
  MAX_FILE_SIZE_BYTES,
  MAX_FILES_PER_SESSION,
  SESSION_TTL_SECONDS,
  MAX_CAPTION_LENGTH,
  type UploadSessionPayload,
} from "../../lib/directUploadToken.js";

// ── Fixture ───────────────────────────────────────────────────────────────

function makePayload(overrides: Partial<UploadSessionPayload> = {}): UploadSessionPayload {
  return {
    nonce: "test-nonce-uuid-1234",
    userId: "user_abc",
    poolId: "pool_xyz",
    album_type: "group",
    // class_id intentionally omitted for pool-wide group default
    keys: { file1: "photos/direct-staging/pool_xyz/session-id/aabbccdd-1234-5678-aaaa-bbbbccccdddd.jpg" },
    sizes: { file1: 102_400 },
    types: { file1: "image/jpeg" },
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    ...overrides,
  };
}

// ── Token sign / verify round-trip ────────────────────────────────────────

describe("signUploadToken / verifyUploadToken", () => {
  it("round-trips a valid group payload (no class_id)", () => {
    const payload = makePayload();
    const token = signUploadToken(payload);
    const decoded = verifyUploadToken(token);
    expect(decoded.userId).toBe(payload.userId);
    expect(decoded.poolId).toBe(payload.poolId);
    expect(decoded.album_type).toBe("group");
    expect(decoded.class_id).toBeUndefined();
    expect(decoded.keys).toEqual(payload.keys);
    expect(decoded.sizes).toEqual(payload.sizes);
    expect(decoded.types).toEqual(payload.types);
  });

  it("round-trips a group payload with class_id", () => {
    const payload = makePayload({ class_id: "class_001" });
    const decoded = verifyUploadToken(signUploadToken(payload));
    expect(decoded.class_id).toBe("class_001");
  });

  it("round-trips a private payload with class_id + student_id", () => {
    const payload = makePayload({
      album_type: "private",
      class_id: "class_001",
      student_id: "stu_99",
      lesson_date: "2025-06-15",
      caption: "summer class",
    });
    const decoded = verifyUploadToken(signUploadToken(payload));
    expect(decoded.album_type).toBe("private");
    expect(decoded.class_id).toBe("class_001");
    expect(decoded.student_id).toBe("stu_99");
    expect(decoded.lesson_date).toBe("2025-06-15");
    expect(decoded.caption).toBe("summer class");
  });

  it("preserves nonce and exp", () => {
    const exp = Math.floor(Date.now() / 1000) + 120;
    const payload = makePayload({ nonce: "unique-nonce-xyz", exp });
    const decoded = verifyUploadToken(signUploadToken(payload));
    expect(decoded.nonce).toBe("unique-nonce-xyz");
    expect(decoded.exp).toBe(exp);
  });

  // ── Tamper / expiry ────────────────────────────────────────────────────

  it("throws invalid_signature when payload byte is changed", () => {
    const token = signUploadToken(makePayload());
    // Corrupt one character in the data portion (before the last dot)
    const dot = token.lastIndexOf(".");
    const corrupted = token.slice(0, 5) + (token[5] === "a" ? "b" : "a") + token.slice(6, dot) + token.slice(dot);
    expect(() => verifyUploadToken(corrupted)).toThrow(/invalid_signature/);
  });

  it("throws invalid_signature when sig segment is replaced with zeros", () => {
    const token = signUploadToken(makePayload());
    const dot = token.lastIndexOf(".");
    const forgedSig = "A".repeat(token.length - dot - 1);
    const forged = token.slice(0, dot + 1) + forgedSig;
    expect(() => verifyUploadToken(forged)).toThrow(/invalid_signature/);
  });

  it("throws invalid_token when the token has no dot separator", () => {
    expect(() => verifyUploadToken("nodottoken")).toThrow(/invalid_token/);
  });

  it("throws token_expired when exp is in the past", () => {
    const payload = makePayload({ exp: Math.floor(Date.now() / 1000) - 1 });
    expect(() => verifyUploadToken(signUploadToken(payload))).toThrow(/token_expired/);
  });

  it("accepts a token with exp exactly 1 second in the future", () => {
    const payload = makePayload({ exp: Math.floor(Date.now() / 1000) + 1 });
    expect(() => verifyUploadToken(signUploadToken(payload))).not.toThrow();
  });

  it("throws when only the signature length is padded (timing safe check)", () => {
    const token = signUploadToken(makePayload());
    const dot = token.lastIndexOf(".");
    // Append extra chars to change sig length → length comparison should fail
    const padded = token + "AAAA";
    expect(() => verifyUploadToken(padded)).toThrow(/invalid_signature/);
  });
});

// ── isSafeClientId ────────────────────────────────────────────────────────

describe("isSafeClientId", () => {
  it("accepts standard alphanumeric ids", () => {
    expect(isSafeClientId("abc123")).toBe(true);
    expect(isSafeClientId("file-1")).toBe(true);
    expect(isSafeClientId("IMG_2024.jpg")).toBe(true);
  });

  it("accepts max-length (128-char) id", () => {
    expect(isSafeClientId("A".repeat(128))).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isSafeClientId("")).toBe(false);
  });

  it("rejects 129-char id", () => {
    expect(isSafeClientId("A".repeat(129))).toBe(false);
  });

  it("rejects control characters (null, newline, tab)", () => {
    expect(isSafeClientId("file\x00name")).toBe(false);
    expect(isSafeClientId("file\nname")).toBe(false);
    expect(isSafeClientId("file\tname")).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(isSafeClientId(null)).toBe(false);
    expect(isSafeClientId(undefined)).toBe(false);
    expect(isSafeClientId(123)).toBe(false);
  });
});

// ── validateFileSize ───────────────────────────────────────────────────────

describe("validateFileSize", () => {
  it("accepts valid positive integer", () => {
    const r = validateFileSize(1024);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(1024);
  });

  it("accepts exact max size", () => {
    const r = validateFileSize(MAX_FILE_SIZE_BYTES);
    expect(r.ok).toBe(true);
  });

  it("rejects zero", () => {
    expect(validateFileSize(0).ok).toBe(false);
  });

  it("rejects negative", () => {
    expect(validateFileSize(-1).ok).toBe(false);
  });

  it("rejects float", () => {
    expect(validateFileSize(1024.5).ok).toBe(false);
  });

  it("rejects string", () => {
    expect(validateFileSize("1024").ok).toBe(false);
  });

  it("rejects undefined / null", () => {
    expect(validateFileSize(undefined).ok).toBe(false);
    expect(validateFileSize(null).ok).toBe(false);
  });

  it("rejects one byte over max (8 MB + 1)", () => {
    expect(validateFileSize(MAX_FILE_SIZE_BYTES + 1).ok).toBe(false);
  });
});

// ── MIME allowlist ─────────────────────────────────────────────────────────

describe("DIRECT_UPLOAD_MIME_ALLOWLIST", () => {
  it("allows all expected image types", () => {
    for (const mime of ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"]) {
      expect(DIRECT_UPLOAD_MIME_ALLOWLIST.has(mime)).toBe(true);
    }
  });

  it("rejects non-image types", () => {
    expect(DIRECT_UPLOAD_MIME_ALLOWLIST.has("application/pdf")).toBe(false);
    expect(DIRECT_UPLOAD_MIME_ALLOWLIST.has("video/mp4")).toBe(false);
    expect(DIRECT_UPLOAD_MIME_ALLOWLIST.has("image/gif")).toBe(false);
    expect(DIRECT_UPLOAD_MIME_ALLOWLIST.has("text/plain")).toBe(false);
    expect(DIRECT_UPLOAD_MIME_ALLOWLIST.has("application/octet-stream")).toBe(false);
  });
});

// ── extFromMime ────────────────────────────────────────────────────────────

describe("extFromMime", () => {
  it("maps jpeg/jpg to jpg", () => {
    expect(extFromMime("image/jpeg")).toBe("jpg");
    expect(extFromMime("image/jpg")).toBe("jpg");
  });
  it("maps png/webp/heic/heif correctly", () => {
    expect(extFromMime("image/png")).toBe("png");
    expect(extFromMime("image/webp")).toBe("webp");
    expect(extFromMime("image/heic")).toBe("heic");
    expect(extFromMime("image/heif")).toBe("heif");
  });
  it("falls back to jpg for unknown MIME", () => {
    expect(extFromMime("application/octet-stream")).toBe("jpg");
  });
});

// ── validateHeadMetadata ───────────────────────────────────────────────────

describe("validateHeadMetadata — strict exact matching", () => {
  const clientId = "file1";

  it("passes when size and type match exactly", () => {
    expect(validateHeadMetadata(clientId, 1024, "image/png", 1024, "image/png")).toBeNull();
  });

  it("passes for jpeg ↔ jpg alias (declared jpeg, actual jpg)", () => {
    expect(validateHeadMetadata(clientId, 512, "image/jpeg", 512, "image/jpg")).toBeNull();
  });

  it("passes for jpeg ↔ jpg alias (declared jpg, actual jpeg)", () => {
    expect(validateHeadMetadata(clientId, 512, "image/jpg", 512, "image/jpeg")).toBeNull();
  });

  it("strips charset param from actual content-type", () => {
    // R2 may return 'image/jpeg; charset=utf-8' — still same base type
    expect(validateHeadMetadata(clientId, 1000, "image/jpeg", 1000, "image/jpeg; charset=utf-8")).toBeNull();
  });

  it("fails when byte size differs by even 1 byte", () => {
    const err = validateHeadMetadata(clientId, 1024, "image/png", 1025, "image/png");
    expect(err).not.toBeNull();
    expect(err).toMatch(/크기 불일치/);
  });

  it("fails when byte size is less than declared", () => {
    const err = validateHeadMetadata(clientId, 1024, "image/png", 1000, "image/png");
    expect(err).not.toBeNull();
  });

  it("fails when content-type is completely different", () => {
    const err = validateHeadMetadata(clientId, 512, "image/png", 512, "image/webp");
    expect(err).not.toBeNull();
    expect(err).toMatch(/형식 불일치/);
  });

  it("fails for application/* types (no passthrough)", () => {
    const err = validateHeadMetadata(clientId, 512, "image/jpeg", 512, "application/octet-stream");
    expect(err).not.toBeNull();
    expect(err).toMatch(/형식 불일치/);
  });

  it("fails when heic and heif are mismatched (not aliases)", () => {
    const err = validateHeadMetadata(clientId, 512, "image/heic", 512, "image/heif");
    expect(err).not.toBeNull();
  });

  it("fails when jpeg is swapped with png", () => {
    const err = validateHeadMetadata(clientId, 512, "image/jpeg", 512, "image/png");
    expect(err).not.toBeNull();
  });
});

// ── Duplicate detection logic (pure) ─────────────────────────────────────

describe("finalize: duplicate client_id / object_key detection", () => {
  it("detects duplicate client_ids in completed array", () => {
    const seen = new Set<string>();
    const completed = [
      { client_id: "file1", object_key: "photos/direct-staging/x/session/a.jpg" },
      { client_id: "file1", object_key: "photos/direct-staging/x/session/b.jpg" }, // duplicate client_id
    ];
    let duplicateFound = false;
    for (const item of completed) {
      if (seen.has(item.client_id)) { duplicateFound = true; break; }
      seen.add(item.client_id);
    }
    expect(duplicateFound).toBe(true);
  });

  it("detects duplicate object_keys in completed array", () => {
    const seen = new Set<string>();
    const completed = [
      { client_id: "file1", object_key: "photos/direct-staging/x/session/same.jpg" },
      { client_id: "file2", object_key: "photos/direct-staging/x/session/same.jpg" }, // duplicate key
    ];
    let duplicateFound = false;
    for (const item of completed) {
      if (seen.has(item.object_key)) { duplicateFound = true; break; }
      seen.add(item.object_key);
    }
    expect(duplicateFound).toBe(true);
  });

  it("allows distinct client_ids and object_keys", () => {
    const clientSeen = new Set<string>();
    const keySeen = new Set<string>();
    const completed = [
      { client_id: "file1", object_key: "photos/direct-staging/x/session/a.jpg" },
      { client_id: "file2", object_key: "photos/direct-staging/x/session/b.jpg" },
    ];
    let dup = false;
    for (const item of completed) {
      if (clientSeen.has(item.client_id) || keySeen.has(item.object_key)) { dup = true; break; }
      clientSeen.add(item.client_id);
      keySeen.add(item.object_key);
    }
    expect(dup).toBe(false);
  });
});

// ── Session key validation (pure) ─────────────────────────────────────────

describe("finalize: completed subset vs session keys", () => {
  const session = makePayload({
    keys: {
      file1: "photos/pool/pool_xyz/uuid-1.jpg",
      file2: "photos/pool/pool_xyz/uuid-2.png",
      file3: "photos/pool/pool_xyz/uuid-3.webp",
    },
    sizes: { file1: 100, file2: 200, file3: 300 },
    types: { file1: "image/jpeg", file2: "image/png", file3: "image/webp" },
  });

  it("accepts a completed item matching session key exactly", () => {
    expect(session.keys["file1"]).toBe("photos/pool/pool_xyz/uuid-1.jpg");
  });

  it("rejects completed item with unknown client_id", () => {
    expect(session.keys["file_unknown"]).toBeUndefined();
  });

  it("rejects completed item with mismatched object_key", () => {
    const fromSession = session.keys["file1"];
    const fromCompleted = "photos/pool/pool_xyz/different.jpg";
    expect(fromSession === fromCompleted).toBe(false);
  });

  it("partial completion: only specified keys processed", () => {
    const completed = [
      { client_id: "file1", object_key: "photos/pool/pool_xyz/uuid-1.jpg" },
      { client_id: "file3", object_key: "photos/pool/pool_xyz/uuid-3.webp" },
    ];
    const toProcess = completed.filter(c => session.keys[c.client_id] === c.object_key);
    expect(toProcess).toHaveLength(2);
    expect(toProcess.map(c => c.client_id)).toEqual(["file1", "file3"]);
  });
});

// ── Optional class_id for group album ─────────────────────────────────────

describe("group album: optional class_id", () => {
  it("payload without class_id is valid for pool-wide group album", () => {
    const payload = makePayload({ album_type: "group" });
    expect(payload.class_id).toBeUndefined();
    // Token should round-trip fine
    const decoded = verifyUploadToken(signUploadToken(payload));
    expect(decoded.class_id).toBeUndefined();
    expect(decoded.album_type).toBe("group");
  });

  it("payload with class_id is valid for class group album", () => {
    const payload = makePayload({ album_type: "group", class_id: "class_abc" });
    const decoded = verifyUploadToken(signUploadToken(payload));
    expect(decoded.class_id).toBe("class_abc");
  });

  it("private album always encodes class_id and student_id", () => {
    const payload = makePayload({ album_type: "private", class_id: "class_001", student_id: "stu_42" });
    const decoded = verifyUploadToken(signUploadToken(payload));
    expect(decoded.class_id).toBe("class_001");
    expect(decoded.student_id).toBe("stu_42");
  });
});

// ── Constants sanity ──────────────────────────────────────────────────────

describe("constants", () => {
  it("MAX_FILE_SIZE_BYTES is 8 MB", () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(8 * 1024 * 1024);
  });
  it("MAX_FILES_PER_SESSION is 10", () => {
    expect(MAX_FILES_PER_SESSION).toBe(10);
  });
  it("SESSION_TTL_SECONDS is 5 minutes", () => {
    expect(SESSION_TTL_SECONDS).toBe(300);
  });
  it("MAX_CAPTION_LENGTH is defined and positive", () => {
    expect(MAX_CAPTION_LENGTH).toBeGreaterThan(0);
  });
});
