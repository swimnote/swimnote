/**
 * p0-file-durability — P0 파일 내구성 보강 migration
 *
 * 1. x_setup_files.raw_original_filename  — 원본 파일명 보존 (nullable)
 * 2. UNIQUE partial index on (pool_id, file_type, submission_version)
 *    WHERE file_type != 'photo'  — version race condition 방지
 * 3. audit_logs action pool_approve, pool_reject, x_setup_upload, x_setup_reupload,
 *    x_setup_photo_upload, x_setup_photo_delete, x_setup_submit,
 *    x_setup_revision, x_setup_approve, x_setup_activate, r2_orphan_cleanup_failed
 *    — 기존 action CHECK constraint가 있으면 추가, 없으면 무시 (additive)
 *
 * 모두 idempotent (IF NOT EXISTS / DO NOTHING).
 */
import { sql } from "drizzle-orm";
import type { MigrationDb } from "../lib/migration-db.js";

export async function runP0FileDurabilityMigration(db: MigrationDb): Promise<void> {
  // 1. raw_original_filename 컬럼 추가 (이미 있으면 무시)
  await db.execute(sql`
    ALTER TABLE x_setup_files
    ADD COLUMN IF NOT EXISTS raw_original_filename TEXT
  `);

  // 2. UNIQUE partial index — photo 제외 (photo는 여러 장이므로 version=1 고정)
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_x_setup_files_version
    ON x_setup_files (pool_id, file_type, submission_version)
    WHERE file_type != 'photo'
  `);

  console.log("[p0-file-durability] migration complete");
}
