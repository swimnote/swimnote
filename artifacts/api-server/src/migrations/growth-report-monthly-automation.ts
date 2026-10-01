import { sql } from "drizzle-orm";
import type { MigrationDb } from "../lib/migration-db.js";

/**
 * Approved, additive monthly automation migration.
 *
 * This function is intentionally NOT called by server startup. The external
 * production database is migrated explicitly after the reviewed commit is
 * pushed. No historical target/report is backfilled or modified here.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS growth_report_monthly_runs (
      report_period TEXT PRIMARY KEY,
      manifest_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      first_pass_completed_at TIMESTAMPTZ,
      summary_payload JSONB,
      paused_at TIMESTAMPTZ,
      pause_reason TEXT,
      pause_epoch INTEGER NOT NULL DEFAULT 0,
      circuit_state JSONB NOT NULL DEFAULT '{"status":"CLOSED","recentFailures":[],"probeReservations":[],"probeSuccesses":0,"resumeHistory":[]}'::jsonb,
      CONSTRAINT chk_gr_monthly_runs_report_period
        CHECK (report_period ~ '^\\d{4}-(0[1-9]|1[0-2])$'),
      CONSTRAINT chk_gr_monthly_runs_pause_epoch CHECK (pause_epoch >= 0),
      CONSTRAINT chk_gr_monthly_runs_circuit_state
        CHECK (jsonb_typeof(circuit_state) = 'object')
    );
  `));
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS growth_report_monthly_run_pools (
      report_period TEXT NOT NULL
        REFERENCES growth_report_monthly_runs(report_period) ON DELETE RESTRICT,
      swimming_pool_id TEXT NOT NULL,
      cycle_id TEXT,
      preparation_status TEXT NOT NULL DEFAULT 'pending',
      preparation_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (report_period, swimming_pool_id),
      CONSTRAINT chk_gr_monthly_run_pool_preparation
        CHECK (preparation_status IN ('pending', 'sealed', 'failed')),
      CONSTRAINT chk_gr_monthly_run_pool_sealed_cycle
        CHECK (preparation_status <> 'sealed' OR cycle_id IS NOT NULL)
    );
  `));

  await db.execute(sql.raw(`
    ALTER TABLE growth_report_monthly_run_pools
      ADD COLUMN IF NOT EXISTS cycle_id TEXT,
      ADD COLUMN IF NOT EXISTS preparation_status TEXT NOT NULL DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS preparation_error TEXT,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `));
  await db.execute(sql.raw(`
    ALTER TABLE growth_report_monthly_runs
      ADD COLUMN IF NOT EXISTS manifest_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS first_pass_completed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS summary_payload JSONB,
      ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS pause_reason TEXT,
      ADD COLUMN IF NOT EXISTS pause_epoch INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS circuit_state JSONB NOT NULL DEFAULT '{"status":"CLOSED","recentFailures":[],"probeReservations":[],"probeSuccesses":0,"resumeHistory":[]}'::jsonb
  `));

  await db.execute(sql.raw(`
    ALTER TABLE growth_report_eligible_targets
      ADD COLUMN IF NOT EXISTS first_pass_completed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS first_pass_outcome TEXT,
      ADD COLUMN IF NOT EXISTS first_pass_error_code TEXT,
      ADD COLUMN IF NOT EXISTS first_pass_error_category TEXT,
      ADD COLUMN IF NOT EXISTS recovery_epoch INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS recovery_approved_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS recovery_approved_by TEXT,
      ADD COLUMN IF NOT EXISTS recovery_approval_reason TEXT,
      ADD COLUMN IF NOT EXISTS recovery_attempt_limit INTEGER,
      ADD COLUMN IF NOT EXISTS first_pass_engine_requests INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS recovery_engine_requests INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS lookup_requests INTEGER NOT NULL DEFAULT 0
  `));
  await db.execute(sql.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_gr_monthly_target_first_pass_outcome'
          AND conrelid = 'growth_report_eligible_targets'::regclass) THEN
        ALTER TABLE growth_report_eligible_targets
          ADD CONSTRAINT chk_gr_monthly_target_first_pass_outcome
          CHECK (first_pass_outcome IS NULL OR first_pass_outcome IN
            ('generated','insufficient_evidence','failed','unknown',
             'policy_excluded','missing','identity_error'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_gr_monthly_target_first_pass_pair'
          AND conrelid = 'growth_report_eligible_targets'::regclass) THEN
        ALTER TABLE growth_report_eligible_targets
          ADD CONSTRAINT chk_gr_monthly_target_first_pass_pair
          CHECK ((first_pass_completed_at IS NULL) = (first_pass_outcome IS NULL));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_gr_monthly_target_recovery_budget'
          AND conrelid = 'growth_report_eligible_targets'::regclass) THEN
        ALTER TABLE growth_report_eligible_targets
          ADD CONSTRAINT chk_gr_monthly_target_recovery_budget
          CHECK (recovery_epoch >= 0 AND
            (recovery_attempt_limit IS NULL OR
              (recovery_attempt_limit >= 0 AND recovery_epoch <= recovery_attempt_limit)));
      END IF;
      ALTER TABLE growth_report_eligible_targets
        DROP CONSTRAINT IF EXISTS chk_gr_monthly_target_recovery_approval;
      ALTER TABLE growth_report_eligible_targets
        ADD CONSTRAINT chk_gr_monthly_target_recovery_approval
        CHECK (recovery_approved_at IS NULL
          OR (NULLIF(TRIM(recovery_approved_by), '') IS NOT NULL
            AND NULLIF(TRIM(recovery_approval_reason), '') IS NOT NULL));
    END $$;
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_gr_monthly_first_pass_pending
      ON growth_report_eligible_targets (cycle_id, first_pass_completed_at)
  `));
  await db.execute(sql.raw(`
    ALTER TABLE growth_reports
      ADD COLUMN IF NOT EXISTS monthly_final_disposition TEXT,
      ADD COLUMN IF NOT EXISTS monthly_disposition_version INTEGER
  `));
  await db.execute(sql.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_gr_monthly_final_disposition'
          AND conrelid = 'growth_reports'::regclass) THEN
        ALTER TABLE growth_reports
          ADD CONSTRAINT chk_gr_monthly_final_disposition
          CHECK (monthly_final_disposition IS NULL
            OR monthly_final_disposition = 'INSUFFICIENT_EVIDENCE');
      END IF;
    END $$;
  `));

  // Keep every existing outbox row, delivery state, and receipt. The old
  // global unique index is replaced with a READY-only partial equivalent so
  // that historical READY idempotency is unchanged while scoped monthly
  // events gain their own durable event key.
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS growth_report_notification_outbox (
      id TEXT PRIMARY KEY,
      notification_type TEXT NOT NULL,
      swimming_pool_id TEXT,
      report_period TEXT NOT NULL,
      recipient_id TEXT NOT NULL,
      recipient_type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      deep_link TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'PENDING',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      lease_until TIMESTAMPTZ,
      lease_token TEXT,
      dispatch_started_at TIMESTAMPTZ,
      provider_receipt_id TEXT,
      delivered_at TIMESTAMPTZ,
      last_error TEXT,
      event_scope TEXT NOT NULL DEFAULT 'pool',
      event_key TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT growth_report_notification_outbox_status_chk
        CHECK (status IN ('PENDING','CLAIMED','DISPATCHING','DELIVERED','UNCERTAIN')),
      CONSTRAINT growth_report_notification_outbox_scope_chk
        CHECK (
          (notification_type = 'GROWTH_REPORT_BATCH_READY'
            AND swimming_pool_id IS NOT NULL AND recipient_type = 'user'
            AND event_scope = 'pool')
          OR
          (notification_type IN ('GROWTH_REPORT_FIRST_PASS_FINISHED','GROWTH_REPORT_MONTHLY_PAUSED')
            AND swimming_pool_id IS NULL AND recipient_type = 'user'
            AND event_scope = 'report_month' AND event_key IS NOT NULL)
        )
    )
  `));
  await db.execute(sql.raw(`
    ALTER TABLE growth_report_notification_outbox
      ALTER COLUMN swimming_pool_id DROP NOT NULL,
      ADD COLUMN IF NOT EXISTS event_scope TEXT NOT NULL DEFAULT 'pool',
      ADD COLUMN IF NOT EXISTS event_key TEXT
  `));
  await db.execute(sql.raw(`
    ALTER TABLE growth_report_notification_outbox
      DROP CONSTRAINT IF EXISTS growth_report_notification_outbox_admin_only_chk,
      DROP CONSTRAINT IF EXISTS growth_report_notification_outbox_scope_chk,
      ADD CONSTRAINT growth_report_notification_outbox_scope_chk CHECK (
        (notification_type = 'GROWTH_REPORT_BATCH_READY'
          AND swimming_pool_id IS NOT NULL AND recipient_type = 'user'
          AND event_scope = 'pool')
        OR
        (notification_type IN ('GROWTH_REPORT_FIRST_PASS_FINISHED','GROWTH_REPORT_MONTHLY_PAUSED')
          AND swimming_pool_id IS NULL AND recipient_type = 'user'
          AND event_scope = 'report_month' AND event_key IS NOT NULL)
      )
  `));
  await db.execute(sql.raw(`
    DROP INDEX IF EXISTS uq_growth_report_outbox_admin_pool_period_recipient
  `));
  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_growth_report_outbox_admin_pool_period_recipient
      ON growth_report_notification_outbox (swimming_pool_id, report_period, recipient_id)
      WHERE notification_type = 'GROWTH_REPORT_BATCH_READY'
  `));
  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_growth_report_outbox_event_recipient
      ON growth_report_notification_outbox (event_key, recipient_id)
      WHERE event_key IS NOT NULL
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_growth_report_outbox_retry
      ON growth_report_notification_outbox (status, next_attempt_at, lease_until)
      WHERE status <> 'DELIVERED'
  `));
}

/** A descriptive alias for callers that prefer the migration's domain name. */
export const initGrowthReportMonthlyAutomationSchema = up;