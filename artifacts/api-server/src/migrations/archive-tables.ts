/**
 * archive-tables.ts — 퇴원생 Archive 3 tables migration
 *
 * 대상:
 *   withdrawn_member_archives  — 퇴원 시점 회원 snapshot (immutable)
 *   withdrawn_diary_archives   — 퇴원 시점 수업일지 snapshot (immutable)
 *   withdrawn_archive_links    — 관리자 수동 연결 (Archive ↔ 현재 학생)
 *
 * 특징:
 *   - 모든 DDL은 IF NOT EXISTS (멱등)
 *   - class_diaries FK 없음 (immutable copy)
 *   - 원본 전화번호 저장 없음 → parent_phone_hash (HMAC-SHA256)
 *
 * 실행:
 *   pnpm tsx src/migrations/archive-tables.ts
 */

import { Pool } from "pg";

const connStr = process.env.SUPABASE_DATABASE_URL;
if (!connStr) { console.error("SUPABASE_DATABASE_URL not set"); process.exit(1); }
const pool = new Pool({ connectionString: connStr, ssl: { rejectUnauthorized: false } });

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── 1. withdrawn_member_archives ─────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS withdrawn_member_archives (
        id                  TEXT PRIMARY KEY,
        pool_id             TEXT NOT NULL,
        original_student_id TEXT NOT NULL,
        student_name        TEXT NOT NULL,
        birth_year          TEXT,
        last_class_name     TEXT,
        last_level_order    INT,
        withdrawn_at        TIMESTAMPTZ NOT NULL,
        withdrawn_by_id     TEXT,
        withdrawn_by_name   TEXT,
        parent_phone_hash   TEXT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log("✓ withdrawn_member_archives created");

    // UNIQUE: 동일 original_student_id는 퇴원 Archive 하나만 (재가입은 새 student_id)
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_wma_student_unique
        ON withdrawn_member_archives (original_student_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_wma_pool_id
        ON withdrawn_member_archives (pool_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_wma_student_name
        ON withdrawn_member_archives (pool_id, student_name)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_wma_withdrawn_at
        ON withdrawn_member_archives (pool_id, withdrawn_at DESC)
    `);
    console.log("✓ withdrawn_member_archives indexes");

    // ── 2. withdrawn_diary_archives ──────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS withdrawn_diary_archives (
        id                  TEXT PRIMARY KEY,
        archive_member_id   TEXT NOT NULL,
        original_diary_id   TEXT NOT NULL,
        lesson_date         TEXT NOT NULL,
        former_class_name   TEXT,
        former_teacher_name TEXT,
        common_content      TEXT,
        student_note        TEXT,
        is_makeup_diary     BOOLEAN NOT NULL DEFAULT FALSE,
        original_created_at TIMESTAMPTZ,
        source_type         TEXT NOT NULL DEFAULT 'class_diary',
        archived_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log("✓ withdrawn_diary_archives created");

    // UNIQUE: (archive_member_id, original_diary_id, source_type) — 중복 방지
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_wda_unique_diary
        ON withdrawn_diary_archives (archive_member_id, original_diary_id, source_type)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_wda_archive_member
        ON withdrawn_diary_archives (archive_member_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_wda_lesson_date
        ON withdrawn_diary_archives (archive_member_id, lesson_date DESC)
    `);
    console.log("✓ withdrawn_diary_archives indexes");

    // ── 3. withdrawn_archive_links ───────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS withdrawn_archive_links (
        id                 TEXT PRIMARY KEY,
        archive_member_id  TEXT NOT NULL,
        current_student_id TEXT NOT NULL,
        linked_by          TEXT NOT NULL,
        linked_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        unlinked_at        TIMESTAMPTZ
      )
    `);
    console.log("✓ withdrawn_archive_links created");

    // PARTIAL UNIQUE: 동일 Archive에 active link 하나만 (unlinked_at IS NULL)
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_wal_archive_active
        ON withdrawn_archive_links (archive_member_id)
        WHERE unlinked_at IS NULL
    `);
    // 현재 student → Archive 역방향 조회 (여러 Archive 허용)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_wal_current_student
        ON withdrawn_archive_links (current_student_id)
        WHERE unlinked_at IS NULL
    `);
    console.log("✓ withdrawn_archive_links indexes");

    await client.query("COMMIT");
    console.log("\n✅ archive-tables migration DONE");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("❌ ROLLBACK:", e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
