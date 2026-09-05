/**
 * wp11-admin-member-notes.ts — WP11 Admin Notes MVP schema migration
 *
 * 목적:
 *   수영장 운영자가 회원별 운영 메모를 기록할 수 있는 admin_member_notes 테이블을 생성한다.
 *
 * 실행 방법 (Staging):
 *   pnpm --filter @workspace/api-server exec tsx src/migrations/wp11-admin-member-notes.ts
 *
 * 자동 startup 실행 금지:
 *   server boot 시 이 파일을 import하거나 호출하지 않는다.
 *
 * Idempotent:
 *   CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS 사용 — 재실행 안전.
 *
 * Production: 사용자 승인 전 실행 금지.
 */

import { sql } from "drizzle-orm";
import type { MigrationDb } from "../lib/migration-db.js";

export async function runMigration(db: MigrationDb): Promise<void> {
  console.log("[wp11-migration] 시작");

  // ── 1. admin_member_notes 테이블 생성 ─────────────────────────────────────
  await (db as any).execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS admin_member_notes (
      id              TEXT PRIMARY KEY DEFAULT 'amn_' || gen_random_uuid()::text,
      swimming_pool_id TEXT NOT NULL,
      student_id       TEXT NOT NULL,
      author_user_id   TEXT,
      category         TEXT NOT NULL
                         CHECK (category IN ('general','consultation','payment','class','vehicle','caution')),
      content          TEXT NOT NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at       TIMESTAMPTZ
    )
  `));
  console.log("[wp11-migration] ✅ admin_member_notes 테이블 생성 완료");

  // ── 2. Index: 회원별 최신순 조회 (primary query pattern) ──────────────────
  await (db as any).execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_amn_student_created
      ON admin_member_notes (student_id, created_at DESC, id DESC)
      WHERE deleted_at IS NULL
  `));
  console.log("[wp11-migration] ✅ idx_amn_student_created 생성 완료");

  // ── 3. Index: pool + student (cross-pool 방어 쿼리용) ─────────────────────
  await (db as any).execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_amn_pool_student_created
      ON admin_member_notes (swimming_pool_id, student_id, created_at DESC)
      WHERE deleted_at IS NULL
  `));
  console.log("[wp11-migration] ✅ idx_amn_pool_student_created 생성 완료");

  console.log("[wp11-migration] 완료 ✅");
}

// ── standalone 실행 (tsx src/migrations/wp11-admin-member-notes.ts) ─────────
if (process.argv[1]?.endsWith("wp11-admin-member-notes.ts") ||
    process.argv[1]?.endsWith("wp11-admin-member-notes.js")) {
  import("../lib/migration-db.js").then(async ({ getMigrationDb }) => {
    const { db, close } = await getMigrationDb("wp11-admin-member-notes");
    try {
      await runMigration(db);
      console.log("[wp11-migration] standalone 완료");
    } finally {
      await close();
    }
    process.exit(0);
  }).catch(e => {
    console.error("[wp11-migration] 실패:", e);
    process.exit(1);
  });
}
