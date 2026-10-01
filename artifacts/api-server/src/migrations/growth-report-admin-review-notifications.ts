import { sql } from "drizzle-orm";
import type { MigrationDb } from "../lib/migration-db.js";

/** Additive, restart-safe outbox for monthly admin-ready notices only. */
export async function up(db: MigrationDb): Promise<void> {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS growth_report_notification_outbox (
      id                  TEXT PRIMARY KEY,
      notification_type   TEXT NOT NULL,
      swimming_pool_id    TEXT NOT NULL,
      report_period       TEXT NOT NULL,
      recipient_id        TEXT NOT NULL,
      recipient_type      TEXT NOT NULL,
      title               TEXT NOT NULL,
      body                TEXT NOT NULL,
      deep_link           TEXT,
      payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
      status              TEXT NOT NULL DEFAULT 'PENDING',
      attempt_count       INTEGER NOT NULL DEFAULT 0,
      next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      lease_until         TIMESTAMPTZ,
      lease_token         TEXT,
      dispatch_started_at TIMESTAMPTZ,
      provider_receipt_id TEXT,
      delivered_at        TIMESTAMPTZ,
      last_error          TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT growth_report_notification_outbox_status_chk
        CHECK (status IN ('PENDING', 'CLAIMED', 'DISPATCHING', 'DELIVERED', 'UNCERTAIN')),
      CONSTRAINT growth_report_notification_outbox_admin_only_chk
        CHECK (notification_type = 'GROWTH_REPORT_BATCH_READY' AND recipient_type = 'user')
    );
  `));
  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_growth_report_outbox_admin_pool_period_recipient
      ON growth_report_notification_outbox
        (swimming_pool_id, report_period, recipient_id);
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_growth_report_outbox_retry
      ON growth_report_notification_outbox (status, next_attempt_at, lease_until)
      WHERE status <> 'DELIVERED';
  `));
}

export async function down(db: MigrationDb): Promise<void> {
  // Preserve durable admin-notification delivery history on rollback.
  void db;
}