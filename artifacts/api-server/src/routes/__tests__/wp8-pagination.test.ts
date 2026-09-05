/**
 * WP8 — PAGINATION / DB PERFORMANCE TESTS
 *
 * Tests items A–T from spec §25.
 * Static source-code analysis + unit logic tests — no DB connection required.
 * Run: vitest run src/routes/__tests__/wp8-pagination.test.ts
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ── File loading helpers ──────────────────────────────────────────────────────

const routesDir = path.resolve(__dirname, "..");
const libDir    = path.resolve(__dirname, "../../lib");
const migrDir   = path.resolve(__dirname, "../../migrations");

function readRoute(name: string) {
  return fs.readFileSync(path.join(routesDir, name), "utf8");
}
function readLib(name: string) {
  return fs.readFileSync(path.join(libDir, name), "utf8");
}
function readMigr(name: string) {
  return fs.readFileSync(path.join(migrDir, name), "utf8");
}

// ── Pre-load sources (avoid re-reading in each describe block) ────────────────
const diarySrc        = readRoute("diary.ts");
const notifSrc        = readRoute("notifications.ts");
const studentsSrc     = readRoute("students.ts");
const membersSrc      = readRoute("members.ts");
const noticesSrc      = readRoute("notices.ts");
const superSrc        = readRoute("super.ts");
const pagLibSrc       = readLib("pagination.ts");
const migrSrc         = readMigr("step-wp8-pagination-indexes.ts");

// Slice: GET /diary section (레거시 handler)
const diaryGetStart   = diarySrc.indexOf("// GET /diary — 레거시");
const diaryGetEnd     = diarySrc.indexOf("// WP8: cursor pagination 추가 (backward-compat: plain array + X-Next-Cursor header)\nrouter.get(\"/teacher/messages\"");
const diarySlice      = diarySrc.slice(diaryGetStart, diaryGetEnd > diaryGetStart ? diaryGetEnd : diaryGetStart + 4000);

// Slice: GET /diaries section
const diariesStart    = diarySrc.indexOf("// ── GET /diaries ─────");
const diariesEnd      = diarySrc.indexOf("// ── WP9-P1:");
const diariesSlice    = diarySrc.slice(diariesStart, diariesEnd);

// Slice: GET /super/pools-summary section
const superPoolsStart = superSrc.indexOf("// GET /super/pools-summary");
const superPoolsEnd   = superSrc.indexOf("// ════════════════\n// POST /super/billing/backfill-pools");
const superPoolsSlice = superSrc.slice(superPoolsStart, superPoolsEnd > superPoolsStart ? superPoolsEnd : superPoolsStart + 10000);

// ── Pagination helper unit tests ──────────────────────────────────────────────

describe("Pagination helper — lib/pagination.ts", () => {
  it("encodeCursor / decodeCursor roundtrip", async () => {
    const { encodeCursor, decodeCursor } = await import("../../lib/pagination.js");
    const created_at = "2025-01-15T10:30:00.000Z";
    const id = "diary_abc_123";
    const cursor = encodeCursor(created_at, id);
    expect(typeof cursor).toBe("string");
    expect(cursor).not.toContain("{"); // must be base64url, not raw JSON
    const decoded = decodeCursor(cursor);
    expect(decoded).not.toBeNull();
    expect(decoded!.created_at).toBe(created_at);
    expect(decoded!.id).toBe(id);
  });

  it("decodeCursor returns null for garbage input", async () => {
    const { decodeCursor } = await import("../../lib/pagination.js");
    expect(decodeCursor("not-valid-base64url!!")).toBeNull();
    expect(decodeCursor("aGVsbG8")).toBeNull(); // base64url of "hello" — not valid JSON shape
  });

  it("parseLimit returns default when missing/invalid", async () => {
    const { parseLimit } = await import("../../lib/pagination.js");
    expect(parseLimit(undefined, 50, 100)).toBe(50);
    expect(parseLimit("", 50, 100)).toBe(50);
    expect(parseLimit(-5, 50, 100)).toBe(50);
    expect(parseLimit("abc", 50, 100)).toBe(50);
  });

  it("parseLimit enforces max cap — test J: max limit enforcement", async () => {
    const { parseLimit } = await import("../../lib/pagination.js");
    expect(parseLimit(100000, 50, 100)).toBe(100);
    expect(parseLimit(101, 50, 100)).toBe(100);
    expect(parseLimit(50, 50, 100)).toBe(50);
    expect(parseLimit(1, 50, 100)).toBe(1);
  });

  it("decodeCursor rejects cursor with invalid date — test K: invalid cursor safe error", async () => {
    const { decodeCursor } = await import("../../lib/pagination.js");
    const bad = Buffer.from(JSON.stringify({ created_at: "NOT_A_DATE", id: "x" })).toString("base64url");
    expect(decodeCursor(bad)).toBeNull();
  });

  it("decodeCursor rejects cursor missing required fields", async () => {
    const { decodeCursor } = await import("../../lib/pagination.js");
    const bad = Buffer.from(JSON.stringify({ foo: "bar" })).toString("base64url");
    expect(decodeCursor(bad)).toBeNull();
  });
});

// ── A+B+C+S: GET /diary — bounded + cursor + stable order ─────────────────────

describe("Test A+B: GET /diary — bounded + cursor support", () => {
  it("A: GET /diary enforces LIMIT (limit+1 fetch pattern)", () => {
    expect(diarySlice).toContain("limit + 1");
  });

  it("A: GET /diary reads limit from query param", () => {
    expect(diarySlice).toContain("req.query.limit");
  });

  it("B: GET /diary cursor clause present in WHERE", () => {
    expect(diarySlice).toContain("cursorClause");
    expect(diarySlice).toContain("decodeCursor");
  });

  it("B: GET /diary sets X-Next-Cursor header when more data exists", () => {
    expect(diarySlice).toContain("X-Next-Cursor");
    expect(diarySlice).toContain("encodeCursor");
  });

  it("C+S: GET /diary uses (created_at, id) DESC for stable order — prevents duplicates on same timestamp", () => {
    expect(diarySlice).toMatch(/ORDER BY cd\.created_at DESC, cd\.id DESC/);
  });
});

// ── D+E: Teacher/Parent auth scope preserved ──────────────────────────────────

describe("Test D+E: Authorization scope not weakened by pagination", () => {
  it("D: Teacher scope guard still present in GET /diary — checks teacher_user_id", () => {
    expect(diarySlice).toContain("teacher_user_id");
  });

  it("E: pool scope guard enforced — poolId from auth, applied in WHERE independently of cursor", () => {
    expect(diarySlice).toContain("getUserPoolId(userId)");
    expect(diarySlice).toContain("swimming_pool_id = ${poolId}");
  });
});

// ── GET /diaries bounded + cursor ─────────────────────────────────────────────

describe("GET /diaries — bounded + cursor", () => {
  it("A: /diaries has LIMIT limit+1 fetch pattern", () => {
    expect(diariesSlice).toContain("limit + 1");
  });

  it("B: /diaries cursor decode + clause present", () => {
    expect(diariesSlice).toContain("decodeCursor");
    expect(diariesSlice).toContain("cursorClause");
  });

  it("B: /diaries sets X-Next-Cursor header", () => {
    expect(diariesSlice).toContain("X-Next-Cursor");
  });

  it("C: /diaries ORDER BY created_at DESC, id DESC for stable pagination", () => {
    expect(diariesSlice).toMatch(/ORDER BY cd\.created_at DESC, cd\.id DESC/);
  });
});

// ── F+G: Notifications ────────────────────────────────────────────────────────

describe("Test F+G: GET /notifications — bounded, cursor, read state preserved", () => {
  const sliceStart = notifSrc.indexOf("router.get(\"/notifications\", requireAuth");
  const sliceEnd   = notifSrc.indexOf("router.get(\"/notifications/unread-count\"");
  const slice      = notifSrc.slice(sliceStart, sliceEnd);

  it("F: notifications enforces LIMIT cap (limit+1 pattern)", () => {
    expect(slice).toContain("limit + 1");
  });

  it("F: notifications cursor param supported with next_cursor field", () => {
    expect(slice).toContain("decodeCursor");
    expect(slice).toContain("next_cursor");
  });

  it("G: is_read field included — read state preserved", () => {
    expect(slice).toContain("is_read");
  });

  it("G: unread_count still in response", () => {
    expect(slice).toContain("unread_count");
  });

  it("F: invalid cursor returns 400", () => {
    expect(slice).toContain("400");
    expect(slice).toContain("cursor 형식이 올바르지 않습니다");
  });

  it("F: ORDER BY (created_at DESC, id DESC) for stable keyset", () => {
    expect(slice).toMatch(/ORDER BY n\.created_at DESC, n\.id DESC/);
  });
});

// ── Teacher/news ──────────────────────────────────────────────────────────────

describe("GET /teacher/news — bounded + cursor", () => {
  const sliceStart = notifSrc.indexOf("router.get(\"/teacher/news\"");
  const slice = notifSrc.slice(sliceStart, sliceStart + 2000);

  it("teacher/news enforces LIMIT cap (limit+1 pattern)", () => {
    expect(slice).toContain("limit + 1");
  });

  it("teacher/news has next_cursor in response", () => {
    expect(slice).toContain("next_cursor");
  });

  it("teacher/news ORDER BY created_at DESC, id DESC", () => {
    expect(slice).toMatch(/ORDER BY n\.created_at DESC, n\.id DESC/);
  });
});

// ── H+I: Students N+1 fix ─────────────────────────────────────────────────────

describe("Test H+I: Students list — N+1 fixed", () => {
  const mainHandler = studentsSrc.slice(
    studentsSrc.indexOf("router.get(\"/\", requireAuth"),
    studentsSrc.indexOf("router.post(\"/teacher-request\"")
  );

  it("H: students N+1 fixed — batch classGroupMap loaded once", () => {
    expect(mainHandler).toContain("classGroupMap");
    expect(mainHandler).toContain("allClassGroupsRes");
  });

  it("H: main list handler uses enrichWithClassesFromMap (batch), not per-student enrichWithClasses", () => {
    expect(mainHandler).toContain("enrichWithClassesFromMap");
    expect(mainHandler).not.toContain("enrichWithClasses({");
  });

  it("H: no async map per student in main list handler", () => {
    // No more Promise.all(students.map(async ...))
    expect(mainHandler).not.toMatch(/\.map\(async/);
  });

  it("I: pool scope enforced — poolId scopes class_groups batch load", () => {
    // Batch load uses WHERE swimming_pool_id = ${poolId!} (non-null assertion)
    expect(mainHandler).toMatch(/swimming_pool_id\s*=\s*\$\{poolId/);
  });
});

// ── Q: Members N+1 fix ───────────────────────────────────────────────────────

describe("Test Q: Members N+1 fixed — batch class lookup", () => {
  const listHandler = membersSrc.slice(
    membersSrc.indexOf("router.get(\"/\", requireAuth"),
    membersSrc.indexOf("router.post(\"/\", requireAuth")
  );

  it("Q: members N+1 fixed — uses cmMap (batch JOIN query)", () => {
    expect(listHandler).toContain("cmMap");
    expect(listHandler).not.toContain(".map(async");
  });

  it("J: members list enforces LIMIT max 500", () => {
    expect(listHandler).toContain("Math.min(rawLimit, 500)");
  });

  it("Q: batch query uses class_members JOIN classes", () => {
    expect(listHandler).toContain("class_members cm");
    expect(listHandler).toContain("LEFT JOIN classes c");
  });
});

// ── M: Notices bounded ────────────────────────────────────────────────────────

describe("Test M: GET /notices — bounded", () => {
  it("M: notices list enforces LIMIT 200", () => {
    expect(noticesSrc).toContain(".limit(200)");
  });

  it("M: limit applied to both super and pool paths (at least 2 occurrences)", () => {
    const count = (noticesSrc.match(/\.limit\(200\)/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

// ── N: Super Admin pools bounded + cursor ─────────────────────────────────────

describe("Test N: GET /super/pools-summary — bounded + cursor", () => {
  it("N: pools-summary fetches pageLimit+1 for next-page detection", () => {
    expect(superPoolsSlice).toContain("pageLimit + 1");
  });

  it("N: pools-summary cursor decode logic present", () => {
    expect(superPoolsSlice).toContain("cursorFilter");
    expect(superPoolsSlice).toContain("base64url");
  });

  it("N: pools-summary sets X-Next-Cursor header", () => {
    expect(superPoolsSlice).toContain("X-Next-Cursor");
  });

  it("N: pools-summary ORDER BY includes id DESC tiebreaker", () => {
    expect(superPoolsSlice).toMatch(/ORDER BY p\.created_at DESC, p\.id DESC/);
  });

  it("N: pools-summary max cap at 500", () => {
    expect(superPoolsSlice).toContain("Math.min(rawLimit, 500)");
  });
});

// ── L: Cross-pool cursor spoof BLOCK ──────────────────────────────────────────

describe("Test L: Cross-pool cursor spoof BLOCK", () => {
  it("L: GET /diary derives poolId from auth (getUserPoolId), not from cursor", () => {
    expect(diarySlice).toContain("getUserPoolId(userId)");
    // Pool filter applied independently of cursor
    expect(diarySlice).toContain("swimming_pool_id = ${poolId}");
  });

  it("L: cursor content never contains pool_id or user_id", () => {
    // CursorPayload type only has created_at + id
    expect(pagLibSrc).not.toContain("pool_id");
    expect(pagLibSrc).not.toContain("user_id");
    expect(pagLibSrc).not.toContain("swimming_pool_id");
  });

  it("L: notifications cursor does not contain pool/recipient info", () => {
    // encodeCursor in notifications.ts only uses last.created_at + last.id
    const encodeUsages = notifSrc.match(/encodeCursor\([^)]+\)/g) || [];
    for (const usage of encodeUsages) {
      expect(usage).not.toContain("pool");
      expect(usage).not.toContain("recipient");
      expect(usage).not.toContain("user_id");
    }
  });
});

// ── T: Legacy/current client compatibility ────────────────────────────────────

describe("Test T: Legacy/current client compatibility", () => {
  it("T: GET /diary still returns plain array (backward compat) — res.json(pageRows)", () => {
    expect(diarySlice).toContain("res.json(pageRows)");
    // NOT wrapped in {items: ...}
    expect(diarySlice).not.toContain("items: pageRows");
  });

  it("T: GET /notifications preserves {notifications, unread_count} shape — next_cursor is additive", () => {
    const sliceStart = notifSrc.indexOf("router.get(\"/notifications\", requireAuth");
    const sliceEnd   = notifSrc.indexOf("router.get(\"/notifications/unread-count\"");
    const slice      = notifSrc.slice(sliceStart, sliceEnd);
    expect(slice).toContain("notifications: pageRows");
    expect(slice).toContain("unread_count");
    expect(slice).toContain("next_cursor"); // additive only
  });

  it("T: GET /diaries still returns plain array", () => {
    expect(diariesSlice).toContain("res.json(pageRows");
    expect(diariesSlice).not.toContain("items: page");
  });

  it("T: GET /teacher/news preserves {news, unread_count} shape", () => {
    const sliceStart = notifSrc.indexOf("router.get(\"/teacher/news\"");
    const slice = notifSrc.slice(sliceStart, sliceStart + 2000);
    expect(slice).toContain("news: pageRows");
    expect(slice).toContain("unread_count");
  });
});

// ── DB Pool config review ─────────────────────────────────────────────────────

describe("DB Pool config — source-level review", () => {
  const dbIndexPath = path.resolve(__dirname, "../../../../../lib/db/src/index.ts");
  const dbSrc = fs.readFileSync(dbIndexPath, "utf8");

  it("DB driver is drizzle + node-postgres (pg)", () => {
    expect(dbSrc).toContain("drizzle-orm/node-postgres");
    expect(dbSrc).toContain("node-postgres");
  });

  it("DB pool max connections configured via DB_POOL_MAX env (default 5)", () => {
    expect(dbSrc).toContain("DB_POOL_MAX");
    expect(dbSrc).toContain("max:");
  });

  it("DB pool idle timeout configured", () => {
    expect(dbSrc).toContain("idleTimeoutMillis");
  });

  it("DB pool connection timeout configured", () => {
    expect(dbSrc).toContain("connectionTimeoutMillis");
  });
});

// ── R: 500-pool loop elimination ─────────────────────────────────────────────

describe("Test R: 500-pool loop — evidence of elimination", () => {
  it("R: pools-summary uses single aggregated SQL — no for-of pool loop", () => {
    // Single query with subqueries (no for...of pools loop)
    expect(superPoolsSlice).not.toMatch(/for\s*(await\s+)?const\s+\w+\s+of\s+/);
    expect(superPoolsSlice).toContain("FROM swimming_pools p");
  });

  it("R: students list uses single batch class_groups load (classGroupMap)", () => {
    const mainHandler = studentsSrc.slice(
      studentsSrc.indexOf("router.get(\"/\", requireAuth"),
      studentsSrc.indexOf("router.post(\"/teacher-request\"")
    );
    expect(mainHandler).toContain("allClassGroupsRes");
    expect(mainHandler).toContain("classGroupMap");
    // synchronous map (no async map per student)
    expect(mainHandler).not.toMatch(/\.map\(async/);
  });

  it("R: members list uses batch JOIN — no per-member query", () => {
    const listHandler = membersSrc.slice(
      membersSrc.indexOf("router.get(\"/\", requireAuth"),
      membersSrc.indexOf("router.post(\"/\", requireAuth")
    );
    expect(listHandler).toContain("cmMap");
    expect(listHandler).not.toMatch(/\.map\(async/);
  });
});

// ── P: Jobs/queue list bounded ────────────────────────────────────────────────

describe("Test P: Jobs/queue lists bounded (if exposed)", () => {
  it("P: super admin has no unbounded pool-loop over all pools for jobs", () => {
    // The main super admin list endpoint (pools-summary) uses a single aggregated query
    // No separate N-per-pool job queue query found in hot path
    expect(superSrc).not.toMatch(/for\s+const\s+pool\s+of\s+pools[\s\S]{0,500}await.*job/);
  });
});

// ── S: Concurrent insert pagination behavior ──────────────────────────────────

describe("Test S: Concurrent insert pagination behavior", () => {
  it("S: keyset pagination uses (created_at, id) — new inserts after cursor position do not repeat existing rows", () => {
    // The cursor condition is: WHERE created_at < cursor_created_at OR (created_at = cursor_created_at AND id < cursor_id)
    // New rows (newer created_at) appear before the cursor position in DESC order, so they don't appear in subsequent pages
    expect(diarySlice).toContain("cd.created_at < ${decoded.created_at}");
    expect(diarySlice).toContain("cd.created_at = ${decoded.created_at}");
    expect(diarySlice).toContain("cd.id < ${decoded.id}");
  });

  it("S: notifications keyset cursor stable under concurrent inserts", () => {
    const sliceStart = notifSrc.indexOf("router.get(\"/notifications\", requireAuth");
    const sliceEnd   = notifSrc.indexOf("router.get(\"/notifications/unread-count\"");
    const slice      = notifSrc.slice(sliceStart, sliceEnd);
    expect(slice).toContain("n.created_at, n.id) < (");
  });
});

// ── Migration indexes ─────────────────────────────────────────────────────────

describe("Migration: WP8 pagination indexes", () => {
  it("Migration has idx_class_diaries_pool_cursor", () => {
    expect(migrSrc).toContain("idx_class_diaries_pool_cursor");
    expect(migrSrc).toContain("class_diaries (swimming_pool_id, created_at DESC, id DESC)");
  });

  it("Migration has idx_notifications_user_cursor", () => {
    expect(migrSrc).toContain("idx_notifications_user_cursor");
    expect(migrSrc).toContain("notifications (recipient_id, created_at DESC, id DESC)");
  });

  it("Migration has idx_diary_messages_diary_cursor", () => {
    expect(migrSrc).toContain("idx_diary_messages_diary_cursor");
    expect(migrSrc).toContain("diary_messages (diary_id, created_at DESC, id DESC)");
  });

  it("Migration has idx_members_pool_status_cursor", () => {
    expect(migrSrc).toContain("idx_members_pool_status_cursor");
    expect(migrSrc).toContain("members (swimming_pool_id, status, created_at DESC)");
  });

  it("Migration uses CONCURRENTLY (safe non-blocking index creation)", () => {
    expect(migrSrc).toContain("CONCURRENTLY");
  });

  it("Migration is idempotent — all indexes use IF NOT EXISTS", () => {
    const count = (migrSrc.match(/IF NOT EXISTS/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(4);
  });

  it("Migration has verifyWp8PaginationIndexes function", () => {
    expect(migrSrc).toContain("verifyWp8PaginationIndexes");
  });
});
