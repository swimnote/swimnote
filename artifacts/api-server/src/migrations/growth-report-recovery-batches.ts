import { sql } from "drizzle-orm";

/** Explicit additive migration only. Never imported by server startup. */
export async function up(db: { execute(query: any): Promise<any> }): Promise<void> {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS growth_report_recovery_batches (
      id text PRIMARY KEY,
      report_month text NOT NULL CHECK (report_month ~ '^\\d{4}-(0[1-9]|1[0-2])$'),
      pool_id text,
      recovery_round integer NOT NULL CHECK (recovery_round > 0),
      approval_id text NOT NULL UNIQUE,
      approval_aliases jsonb NOT NULL DEFAULT '{}'::jsonb,
      actor_id text NOT NULL,
      actor_role text NOT NULL CHECK (actor_role IN ('super_admin','platform_admin')),
      reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
      state text NOT NULL DEFAULT 'PENDING'
        CHECK (state IN ('PENDING','RUNNING','PAUSED','COMPLETED')),
      total integer NOT NULL DEFAULT 0,
      completed integer NOT NULL DEFAULT 0,
      success integer NOT NULL DEFAULT 0,
      insufficient_evidence integer NOT NULL DEFAULT 0,
      failed integer NOT NULL DEFAULT 0,
      unknown integer NOT NULL DEFAULT 0,
      conflict integer NOT NULL DEFAULT 0,
      remaining integer NOT NULL DEFAULT 0,
      pause_reason text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      UNIQUE(report_month, recovery_round)
    );
    ALTER TABLE growth_report_recovery_batches
      ADD COLUMN IF NOT EXISTS approval_aliases jsonb NOT NULL DEFAULT '{}'::jsonb;
    CREATE TABLE IF NOT EXISTS growth_report_recovery_batch_targets (
      id text PRIMARY KEY,
      batch_id text NOT NULL REFERENCES growth_report_recovery_batches(id),
      report_id text NOT NULL,
      pool_id text NOT NULL,
      cycle_id text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('FAILED','UNKNOWN')),
      original_request_id text NOT NULL,
      original_recovery_epoch integer NOT NULL DEFAULT 0 CHECK (original_recovery_epoch >= 0),
      expected_operation_id text,
      recovery_operation_id text,
      new_request_id text,
      state text NOT NULL DEFAULT 'PENDING'
        CHECK (state IN ('PENDING','PROCESSING','WAITING','SUCCESS',
          'INSUFFICIENT_EVIDENCE','FAILED','UNKNOWN','CONFLICT','SKIPPED')),
      claim_token text,
      lease_until timestamptz,
      detail text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(batch_id, report_id)
    );
    ALTER TABLE growth_report_recovery_batch_targets
      ADD COLUMN IF NOT EXISTS original_recovery_epoch integer NOT NULL DEFAULT 0 CHECK (original_recovery_epoch >= 0);
    CREATE UNIQUE INDEX IF NOT EXISTS gr_recovery_target_active_report
      ON growth_report_recovery_batch_targets(report_id)
      WHERE state IN ('PENDING','PROCESSING','WAITING');
    CREATE INDEX IF NOT EXISTS gr_recovery_batch_scope
      ON growth_report_recovery_batches(report_month, pool_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS gr_recovery_target_claim
      ON growth_report_recovery_batch_targets(state, lease_until, batch_id);
  `));
}