/**
 * data-addon-migration.ts — DATA add-on state columns + purge job table
 *
 * UP:
 *   1. swimming_pools에 data_addon_* 컬럼 4개 추가
 *   2. pool_data_purge_jobs 테이블 생성
 *
 * DOWN:
 *   컬럼/테이블 DROP (data loss 주의)
 *
 * Idempotency: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS
 */

import { sql } from "drizzle-orm";
import type { MigrationDb } from "../lib/migration-db.js";

export async function up(db: MigrationDb): Promise<void> {
  console.log("[data-addon-migration] Starting UP...");

  // ── 1. swimming_pools에 DATA add-on 상태 컬럼 추가 ───────────────────────
  // data_addon_tier: 현재 활성(또는 최근 만료된) DATA 상품 종류
  // data_addon_status: active | cancelled | billing_issue | expired | NULL
  // data_addon_started_at: INITIAL_PURCHASE 시점
  // data_addon_expires_at: RevenueCat expiration_at 기준 (TIMESTAMPTZ — 정확한 만료시점 필요)
  await db.execute(sql.raw(`
    ALTER TABLE swimming_pools
      ADD COLUMN IF NOT EXISTS data_addon_tier        TEXT,
      ADD COLUMN IF NOT EXISTS data_addon_status      TEXT,
      ADD COLUMN IF NOT EXISTS data_addon_started_at  TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS data_addon_expires_at  TIMESTAMPTZ
  `));
  console.log("[data-addon-migration] Added data_addon_* columns to swimming_pools");

  // ── 2. pool_data_purge_jobs 테이블 생성 ──────────────────────────────────
  // purge job tracker: EXPIRATION 시 생성, worker가 오래된 media부터 삭제
  // trigger_rc_event_id: RC event idempotency key (중복 job 방지)
  // target_quota_bytes: 이 값 이하로 사용량이 줄어들면 종료
  // status: pending → running → completed | failed
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS pool_data_purge_jobs (
      id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      pool_id              TEXT NOT NULL,
      target_quota_bytes   BIGINT NOT NULL,
      status               TEXT NOT NULL DEFAULT 'pending',
      trigger_rc_event_id  TEXT,
      attempts             INT NOT NULL DEFAULT 0,
      last_error           TEXT,
      bytes_freed          BIGINT NOT NULL DEFAULT 0,
      items_deleted        INT NOT NULL DEFAULT 0,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at           TIMESTAMPTZ,
      completed_at         TIMESTAMPTZ,
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `));
  console.log("[data-addon-migration] Created pool_data_purge_jobs table");

  // ── 3. 인덱스 ──────────────────────────────────────────────────────────────
  // status+pool_id 검색 (worker가 pending 조회)
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_pool_data_purge_jobs_status
      ON pool_data_purge_jobs (status, created_at)
  `));
  // pool_id별 진행 중 job 단건 확인 (idempotency)
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_pool_data_purge_jobs_pool_active
      ON pool_data_purge_jobs (pool_id, status)
      WHERE status IN ('pending', 'running')
  `));
  // RC event dedup
  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pool_data_purge_jobs_rc_event
      ON pool_data_purge_jobs (trigger_rc_event_id)
      WHERE trigger_rc_event_id IS NOT NULL
  `));
  console.log("[data-addon-migration] Created indexes on pool_data_purge_jobs");

  console.log("[data-addon-migration] UP complete.");
}

export async function down(db: MigrationDb): Promise<void> {
  console.log("[data-addon-migration] Starting DOWN (rollback)...");

  await db.execute(sql.raw(`DROP TABLE IF EXISTS pool_data_purge_jobs`));
  console.log("[data-addon-migration] Dropped pool_data_purge_jobs");

  await db.execute(sql.raw(`
    ALTER TABLE swimming_pools
      DROP COLUMN IF EXISTS data_addon_tier,
      DROP COLUMN IF EXISTS data_addon_status,
      DROP COLUMN IF EXISTS data_addon_started_at,
      DROP COLUMN IF EXISTS data_addon_expires_at
  `));
  console.log("[data-addon-migration] Removed data_addon_* columns from swimming_pools");

  console.log("[data-addon-migration] DOWN complete.");
}
