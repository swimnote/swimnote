/**
 * step-wp8-b-batch-jobs.ts — WP8: growth_report_batch_jobs 테이블 생성
 *
 * 목적:
 *   - 매월 자동 생성 배치 작업의 durable state 관리
 *   - server restart/multi-instance 환경에서 작업 유실 방지
 *   - FOR UPDATE SKIP LOCKED 기반 atomic claim
 *
 * 실행 방법: tsx src/migrations/step-wp8-b-batch-jobs.ts
 * PRODUCTION DB: NO
 */

import { sql } from "drizzle-orm";
import type { MigrationDb } from "../lib/migration-db.js";

export async function up(db: MigrationDb): Promise<void> {
  // ── growth_report_batch_jobs 테이블 ────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS growth_report_batch_jobs (
      id                TEXT          PRIMARY KEY
                          DEFAULT ('grb_' || replace(gen_random_uuid()::text,'-','')),
      swimming_pool_id  TEXT          NOT NULL,
      year              SMALLINT      NOT NULL,
      month             SMALLINT      NOT NULL,
      job_type          TEXT          NOT NULL DEFAULT 'MONTHLY_AUTO',
      status            TEXT          NOT NULL DEFAULT 'PENDING',
      target_count      INT           NOT NULL DEFAULT 0,
      completed_count   INT           NOT NULL DEFAULT 0,
      failed_count      INT           NOT NULL DEFAULT 0,
      attempts          INT           NOT NULL DEFAULT 0,
      worker_id         TEXT,
      locked_at         TIMESTAMPTZ,
      next_attempt_at   TIMESTAMPTZ,
      started_at        TIMESTAMPTZ,
      completed_at      TIMESTAMPTZ,
      admin_push_sent_at TIMESTAMPTZ,
      created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      CONSTRAINT growth_report_batch_jobs_status_chk
        CHECK (status IN ('PENDING','RUNNING','COMPLETED','PARTIAL','FAILED')),
      CONSTRAINT growth_report_batch_jobs_year_chk
        CHECK (year >= 2024 AND year <= 2100),
      CONSTRAINT growth_report_batch_jobs_month_chk
        CHECK (month >= 1 AND month <= 12)
    );
  `));
  console.log("[WP8-B] growth_report_batch_jobs table OK");

  // UNIQUE: (pool, year, month, type)
  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_growth_report_batch_jobs_pool_period
      ON growth_report_batch_jobs (swimming_pool_id, year, month, job_type);
  `));
  console.log("[WP8-B] uq_growth_report_batch_jobs_pool_period OK");

  // 인덱스: worker claim
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_growth_report_batch_jobs_pending
      ON growth_report_batch_jobs (status, next_attempt_at)
      WHERE status IN ('PENDING','RUNNING');
  `));
  console.log("[WP8-B] idx_growth_report_batch_jobs_pending OK");

  // batch_job_id 컬럼이 UUID로 추가됐을 경우 TEXT로 변환
  await db.execute(sql.raw(`
    DO $$ BEGIN
      ALTER TABLE growth_reports ALTER COLUMN batch_job_id TYPE TEXT USING batch_job_id::TEXT;
    EXCEPTION WHEN others THEN NULL;
    END $$;
  `));
  console.log("[WP8-B] batch_job_id column type → TEXT OK");

  // FK: growth_reports.batch_job_id → growth_report_batch_jobs.id
  await db.execute(sql.raw(`
    DO $$ BEGIN
      ALTER TABLE growth_reports
        ADD CONSTRAINT fk_growth_reports_batch_job_id
        FOREIGN KEY (batch_job_id) REFERENCES growth_report_batch_jobs(id)
        ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `));
  console.log("[WP8-B] FK fk_growth_reports_batch_job_id OK");

  console.log("[WP8-B] ✅ ALL COMPLETE");
}

export async function down(db: MigrationDb): Promise<void> {
  await db.execute(sql.raw(`
    ALTER TABLE growth_reports
      DROP CONSTRAINT IF EXISTS fk_growth_reports_batch_job_id;
  `));
  await db.execute(sql.raw(`
    DROP INDEX IF EXISTS idx_growth_report_batch_jobs_pending;
    DROP INDEX IF EXISTS uq_growth_report_batch_jobs_pool_period;
    DROP TABLE IF EXISTS growth_report_batch_jobs;
  `));
  console.log("[WP8-B] DOWN complete");
}

// ── standalone 실행 ──────────────────────────────────────────────────────────
if (import.meta.url === String(new URL(process.argv[1], "file:"))) {
  const { runWithMigrationDb } = await import("../lib/migration-db.js");
  runWithMigrationDb("step-wp8-b-batch-jobs", up).catch(e => { console.error(e); process.exit(1); });
}
