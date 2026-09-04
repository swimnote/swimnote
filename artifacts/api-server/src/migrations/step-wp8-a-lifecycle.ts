/**
 * step-wp8-a-lifecycle.ts — WP8: growth_reports lifecycle 확장
 *
 * 변경:
 *   A. gr_product_status_enum: READY_TO_SEND, DISCARDED, REGENERATING 추가
 *   B. growth_reports 컬럼 추가:
 *      - version_number INT NOT NULL DEFAULT 1
 *      - discarded_at TIMESTAMPTZ
 *      - discarded_by TEXT
 *      - discard_reason TEXT
 *      - batch_job_id UUID (batch jobs FK — step-wp8-b에서 FK 추가)
 *   C. 기존 unique constraint 교체:
 *      uq_growth_reports_student_cycle (WHERE deleted_at IS NULL)
 *      → uq_growth_reports_student_cycle_v2
 *        (WHERE deleted_at IS NULL AND product_status::text != 'DISCARDED')
 *
 * 실행 방법: tsx src/migrations/step-wp8-a-lifecycle.ts
 * PRODUCTION DB: NO (개발 DB 전용)
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function up(): Promise<void> {
  // ── A. gr_product_status_enum: 신규 값 추가 ──────────────────────────────
  // ALTER TYPE ADD VALUE는 트랜잭션 없이 auto-commit 필요
  // drizzle execute는 각 호출이 독립 auto-commit
  await superAdminDb.execute(sql.raw(`
    DO $$ BEGIN
      ALTER TYPE gr_product_status_enum ADD VALUE 'READY_TO_SEND';
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `));
  console.log("[WP8-A] READY_TO_SEND added");

  await superAdminDb.execute(sql.raw(`
    DO $$ BEGIN
      ALTER TYPE gr_product_status_enum ADD VALUE 'DISCARDED';
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `));
  console.log("[WP8-A] DISCARDED added");

  await superAdminDb.execute(sql.raw(`
    DO $$ BEGIN
      ALTER TYPE gr_product_status_enum ADD VALUE 'REGENERATING';
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `));
  console.log("[WP8-A] REGENERATING added");

  // ── B. growth_reports 컬럼 추가 ──────────────────────────────────────────
  await superAdminDb.execute(sql.raw(`
    ALTER TABLE growth_reports
      ADD COLUMN IF NOT EXISTS version_number   INT          NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS discarded_at     TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS discarded_by     TEXT,
      ADD COLUMN IF NOT EXISTS discard_reason   TEXT,
      ADD COLUMN IF NOT EXISTS batch_job_id     TEXT;
  `));
  console.log("[WP8-A] growth_reports columns added");

  // ── C. Unique constraint 교체 ─────────────────────────────────────────────
  // 기존 uq_growth_reports_student_cycle 제거
  await superAdminDb.execute(sql.raw(`
    DROP INDEX IF EXISTS uq_growth_reports_student_cycle;
  `));
  console.log("[WP8-A] old unique index dropped");

  // 신규: DISCARDED 제외한 partial unique
  // NOTE: ALTER TYPE ADD VALUE 후 새 enum 값이 반영되려면 이전 execute가 commit된 후여야 함
  //       drizzle execute auto-commit이므로 순차 execute OK
  await superAdminDb.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_growth_reports_student_cycle_v2
      ON growth_reports (student_id, cycle_id)
      WHERE cycle_id IS NOT NULL
        AND deleted_at IS NULL
        AND product_status <> 'DISCARDED'::gr_product_status_enum;
  `));
  console.log("[WP8-A] uq_growth_reports_student_cycle_v2 created");

  // 추가 인덱스
  await superAdminDb.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_growth_reports_batch_job_id
      ON growth_reports (batch_job_id)
      WHERE batch_job_id IS NOT NULL AND deleted_at IS NULL;
  `));

  await superAdminDb.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_growth_reports_ready_to_send
      ON growth_reports (swimming_pool_id, product_status)
      WHERE product_status = 'READY_TO_SEND'::gr_product_status_enum AND deleted_at IS NULL;
  `));
  console.log("[WP8-A] indexes created");

  console.log("[WP8-A] ✅ ALL COMPLETE");
}

export async function down(): Promise<void> {
  await superAdminDb.execute(sql.raw(`
    DROP INDEX IF EXISTS idx_growth_reports_ready_to_send;
    DROP INDEX IF EXISTS idx_growth_reports_batch_job_id;
    DROP INDEX IF EXISTS uq_growth_reports_student_cycle_v2;
  `));
  await superAdminDb.execute(sql.raw(`
    ALTER TABLE growth_reports
      DROP COLUMN IF EXISTS batch_job_id,
      DROP COLUMN IF EXISTS discard_reason,
      DROP COLUMN IF EXISTS discarded_by,
      DROP COLUMN IF EXISTS discarded_at,
      DROP COLUMN IF EXISTS version_number;
  `));
  // Note: enum value removal not supported in PostgreSQL — must recreate enum
  console.log("[WP8-A] DOWN complete (enum values not removed — PG limitation)");
}

// ── standalone 실행 ──────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  up().catch(e => { console.error(e); process.exit(1); });
}
