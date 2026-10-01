/**
 * Additive durable monthly Growth Report target and analysis-lease schema.
 *
 * This migration does not backfill historical cycles. The explicit
 * backfillLegacyMonthlyTargets operation is separate and is never run here.
 */
import { sql } from "drizzle-orm";
import type { MigrationDb } from "../lib/migration-db.js";

export async function initGrowthReportMonthlyIntegritySchema(
  db: MigrationDb,
): Promise<void> {
  await db.execute(sql.raw(`
    ALTER TABLE growth_report_cycles
      ADD COLUMN IF NOT EXISTS eligible_total integer,
      ADD COLUMN IF NOT EXISTS eligibility_sealed_at timestamptz,
      ADD COLUMN IF NOT EXISTS ready_at timestamptz
  `));

  await db.execute(sql.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_growth_report_cycles_eligible_total_nonnegative'
          AND conrelid = 'growth_report_cycles'::regclass
      ) THEN
        ALTER TABLE growth_report_cycles
          ADD CONSTRAINT chk_growth_report_cycles_eligible_total_nonnegative
          CHECK (eligible_total IS NULL OR eligible_total >= 0);
      END IF;
    END $$;
  `));

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS growth_report_eligible_targets (
      cycle_id text NOT NULL
        REFERENCES growth_report_cycles(id) ON DELETE RESTRICT,
      student_id text NOT NULL,
      confirmed_at timestamptz NOT NULL DEFAULT now(),
      eligibility_version integer NOT NULL,
      eligibility_evidence jsonb NOT NULL,
      source_provenance text NOT NULL,
      policy_excluded_at timestamptz,
      policy_exclusion_reason text,
      policy_evidence_ref text,
      PRIMARY KEY (cycle_id, student_id),
      CONSTRAINT chk_growth_report_target_version_positive
        CHECK (eligibility_version > 0),
      CONSTRAINT chk_growth_report_target_evidence_object
        CHECK (jsonb_typeof(eligibility_evidence) = 'object'),
      CONSTRAINT chk_growth_report_target_source_provenance
        CHECK (source_provenance IN ('LIVE_SEAL', 'LEGACY_STORED_EVIDENCE')),
      CONSTRAINT chk_growth_report_target_policy_exclusion_complete
        CHECK (
          (policy_excluded_at IS NULL
            AND policy_exclusion_reason IS NULL
            AND policy_evidence_ref IS NULL)
          OR
          (policy_excluded_at IS NOT NULL
            AND NULLIF(TRIM(policy_exclusion_reason), '') IS NOT NULL
            AND NULLIF(TRIM(policy_evidence_ref), '') IS NOT NULL)
        )
    )
  `));

  await db.execute(sql.raw(`
    ALTER TABLE growth_reports
      ADD COLUMN IF NOT EXISTS analysis_claim_token text,
      ADD COLUMN IF NOT EXISTS analysis_lease_until timestamptz,
      ADD COLUMN IF NOT EXISTS analysis_next_attempt_at timestamptz,
      ADD COLUMN IF NOT EXISTS analysis_call_started_at timestamptz,
      ADD COLUMN IF NOT EXISTS analysis_uncertain_at timestamptz
  `));

  await db.execute(sql.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_growth_report_analysis_lease_has_owner'
          AND conrelid = 'growth_reports'::regclass
      ) THEN
        ALTER TABLE growth_reports
          ADD CONSTRAINT chk_growth_report_analysis_lease_has_owner
          CHECK (analysis_lease_until IS NULL OR analysis_claim_token IS NOT NULL);
      END IF;
    END $$;
  `));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_gr_monthly_analysis_next_attempt
      ON growth_reports (analysis_next_attempt_at)
      WHERE analysis_next_attempt_at IS NOT NULL
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_gr_monthly_analysis_lease_until
      ON growth_reports (analysis_lease_until)
      WHERE analysis_lease_until IS NOT NULL
  `));
}