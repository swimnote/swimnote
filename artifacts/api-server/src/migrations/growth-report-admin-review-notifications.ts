import { sql } from "drizzle-orm";
import type { MigrationDb } from "../lib/migration-db.js";

/** Additive, restart-safe notification delivery outbox. Not executed here. */
export async function up(db: MigrationDb): Promise<void> {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS growth_report_notification_outbox (
      id                  TEXT PRIMARY KEY,
      notification_type   TEXT NOT NULL,
      swimming_pool_id    TEXT NOT NULL,
      report_period       TEXT NOT NULL,
      report_id           TEXT,
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
        CHECK (status IN ('PENDING', 'CLAIMED', 'DISPATCHING', 'DELIVERED', 'UNCERTAIN'))
    );
  `));
  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_growth_report_outbox_admin_period_recipient
      ON growth_report_notification_outbox
        (notification_type, swimming_pool_id, report_period, recipient_id)
      WHERE notification_type = 'GROWTH_REPORT_BATCH_READY' AND report_id IS NULL;
  `));
  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_growth_report_outbox_parent_report_recipient
      ON growth_report_notification_outbox
        (notification_type, report_id, recipient_id)
      WHERE notification_type = 'GROWTH_REPORT_PUBLISHED' AND report_id IS NOT NULL;
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_growth_report_outbox_retry
      ON growth_report_notification_outbox (status, next_attempt_at, lease_until)
      WHERE status <> 'DELIVERED';
  `));
}

export async function down(db: MigrationDb): Promise<void> {
  // Preserve durable delivery/reconciliation history on rollback. This
  // additive table is intentionally left in place for a data-preserving down.
  void db;
}