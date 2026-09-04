/**
 * pool-db-x-setup — WP-X03 X Setup 제출자료 테이블 생성
 *
 * Tables:
 *   x_setup_submissions   — pool별 전체 설정 상태 (1:1)
 *   x_setup_files         — 제출 파일 버전 이력
 *   x_setup_revision_requests — super_admin 수정요청
 *
 * All migrations are idempotent (IF NOT EXISTS / IF NOT EXISTS column).
 * X 구독 해지/만료 시 데이터 삭제 금지 — soft-delete 전용.
 */
import { sql } from "drizzle-orm";
import type { MigrationDb } from "../lib/migration-db.js";

const SETUP_STATUSES = [
  "NOT_STARTED", "IN_PROGRESS", "SUBMITTED", "UNDER_REVIEW",
  "REVISION_REQUESTED", "APPROVED", "PROCESSING", "READY",
] as const;

const SECTION_STATUSES = [
  "NOT_SUBMITTED", "SUBMITTED", "REVISION_REQUESTED", "APPROVED",
] as const;

const FILE_TYPES = ["curriculum", "website", "logo", "photo"] as const;

export async function runXSetupMigration(db: MigrationDb): Promise<void> {
  // ── x_setup_submissions — pool별 전체 + 섹션별 상태 ─────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS x_setup_submissions (
      id                          TEXT PRIMARY KEY,
      pool_id                     TEXT NOT NULL UNIQUE REFERENCES swimming_pools(id),
      setup_status                TEXT NOT NULL DEFAULT 'NOT_STARTED',
      curriculum_status           TEXT NOT NULL DEFAULT 'NOT_SUBMITTED',
      website_status              TEXT NOT NULL DEFAULT 'NOT_SUBMITTED',
      logo_status                 TEXT NOT NULL DEFAULT 'NOT_SUBMITTED',
      photos_status               TEXT NOT NULL DEFAULT 'NOT_SUBMITTED',
      curriculum_template_version TEXT,
      website_template_version    TEXT,
      submitted_at                TIMESTAMPTZ,
      submitted_by                TEXT,
      created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // ── x_setup_files — 파일 버전 이력 ────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS x_setup_files (
      id                    TEXT PRIMARY KEY,
      pool_id               TEXT NOT NULL REFERENCES swimming_pools(id),
      file_type             TEXT NOT NULL,
      r2_key                TEXT NOT NULL,
      original_filename     TEXT NOT NULL,
      mime_type             TEXT NOT NULL,
      file_size_bytes       BIGINT,
      submission_version    INT NOT NULL DEFAULT 1,
      is_current            BOOLEAN NOT NULL DEFAULT true,
      photo_order           INT,
      photo_title           TEXT,
      photo_category        TEXT,
      template_version      TEXT,
      uploaded_by           TEXT NOT NULL,
      uploaded_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at            TIMESTAMPTZ
    )
  `);

  // ── x_setup_revision_requests — 수정요청 ──────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS x_setup_revision_requests (
      id            TEXT PRIMARY KEY,
      pool_id       TEXT NOT NULL REFERENCES swimming_pools(id),
      section       TEXT NOT NULL,
      message       TEXT NOT NULL,
      requested_by  TEXT NOT NULL,
      requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at   TIMESTAMPTZ,
      status        TEXT NOT NULL DEFAULT 'PENDING'
    )
  `);

  // ── indexes ───────────────────────────────────────────────────────────────
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_x_setup_files_pool_type
      ON x_setup_files(pool_id, file_type)
      WHERE deleted_at IS NULL
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_x_setup_revision_pool
      ON x_setup_revision_requests(pool_id, status)
  `);

  console.log("[x-setup-migration] x_setup tables OK");
}
