/**
 * WP8 Pagination Indexes
 *
 * Adds indexes required for cursor-based keyset pagination.
 * All indexes use IF NOT EXISTS — safe to run multiple times.
 *
 * Target tables:
 *   class_diaries      → (swimming_pool_id, created_at DESC, id DESC)
 *   notifications      → (recipient_id, created_at DESC, id DESC)
 *   diary_messages     → (diary_id, created_at DESC, id DESC)
 *   members            → (swimming_pool_id, status, created_at DESC)
 *
 * Existing indexes (no duplication):
 *   idx_students_pool_status (swimming_pool_id, status) — students
 *   idx_students_pool_created (swimming_pool_id, created_at DESC) — students
 *   idx_class_diaries_active_lookup (class_group_id, lesson_date, is_deleted) — diaries (by class)
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export async function runWp8PaginationIndexes(): Promise<void> {
  console.log("[wp8-indexes] starting...");

  // ── class_diaries: pool-scoped cursor pagination ──────────────────────────
  // Used by: GET /diary, GET /diaries (pool-scoped ordering)
  await db.execute(sql.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_class_diaries_pool_cursor
    ON class_diaries (swimming_pool_id, created_at DESC, id DESC)
  `)).catch(e => console.warn("[wp8-indexes] idx_class_diaries_pool_cursor:", e.message));

  // ── notifications: per-user cursor pagination ─────────────────────────────
  // Used by: GET /notifications, GET /teacher/news (recipient_id scoped)
  await db.execute(sql.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_cursor
    ON notifications (recipient_id, created_at DESC, id DESC)
  `)).catch(e => console.warn("[wp8-indexes] idx_notifications_user_cursor:", e.message));

  // ── diary_messages: per-diary cursor pagination ───────────────────────────
  // Used by: GET /teacher/messages (diary_id scoped)
  await db.execute(sql.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_diary_messages_diary_cursor
    ON diary_messages (diary_id, created_at DESC, id DESC)
  `)).catch(e => console.warn("[wp8-indexes] idx_diary_messages_diary_cursor:", e.message));

  // ── members: pool-scoped list with status filter ──────────────────────────
  // Used by: GET /members (with status filter + ORDER BY created_at DESC)
  await db.execute(sql.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_members_pool_status_cursor
    ON members (swimming_pool_id, status, created_at DESC)
  `)).catch(e => console.warn("[wp8-indexes] idx_members_pool_status_cursor:", e.message));

  console.log("[wp8-indexes] done.");
}

/**
 * Staging verification: check that all 4 indexes exist.
 */
export async function verifyWp8PaginationIndexes(): Promise<{
  ok: boolean;
  found: string[];
  missing: string[];
}> {
  const expected = [
    "idx_class_diaries_pool_cursor",
    "idx_notifications_user_cursor",
    "idx_diary_messages_diary_cursor",
    "idx_members_pool_status_cursor",
  ];

  const res = await db.execute(sql.raw(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = ANY(ARRAY[
        'idx_class_diaries_pool_cursor',
        'idx_notifications_user_cursor',
        'idx_diary_messages_diary_cursor',
        'idx_members_pool_status_cursor'
      ])
    ORDER BY indexname
  `));

  const found = (res.rows as any[]).map(r => r.indexname as string);
  const missing = expected.filter(e => !found.includes(e));

  return { ok: missing.length === 0, found, missing };
}
