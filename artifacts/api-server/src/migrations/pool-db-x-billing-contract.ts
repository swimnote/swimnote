/**
 * pool-db-x-billing-contract.ts — X02-C 전용 additive migration
 *
 * §20: revenuecat_webhook_events 테이블 생성
 *   - event_id UNIQUE → webhook dedup
 *   - raw payload 저장 금지
 *   - PII/secret 저장 금지
 *
 * 멱등성: CREATE TABLE IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS
 * 파괴적 변경 금지: DROP / TRUNCATE / ALTER ... DROP COLUMN 없음
 */

import { sql } from "drizzle-orm";
import type { MigrationDb } from "../lib/migration-db.js";

export async function runXBillingContractMigration(db: MigrationDb): Promise<void> {
  // revenuecat_webhook_events — X webhook event dedup 테이블
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS revenuecat_webhook_events (
      id           bigserial    PRIMARY KEY,
      event_id     text         NOT NULL,
      event_type   text         NOT NULL,
      app_user_id  text         NOT NULL,
      product_id   text         NOT NULL DEFAULT '',
      environment  text         NOT NULL DEFAULT 'PRODUCTION',
      processed_at timestamptz  NOT NULL DEFAULT now(),
      created_at   timestamptz  NOT NULL DEFAULT now()
    );
  `));

  // event_id UNIQUE — dedup의 핵심
  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_rc_webhook_events_event_id
      ON revenuecat_webhook_events(event_id);
  `));

  // 조회 최적화: app_user_id + event_type
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_rc_webhook_events_user_type
      ON revenuecat_webhook_events(app_user_id, event_type);
  `));

  console.log("[x-billing-contract-migration] revenuecat_webhook_events OK");
}
