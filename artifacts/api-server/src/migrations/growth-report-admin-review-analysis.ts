/**
 * Additive schema for durable growth-report ENGINE request replay.
 *
 * This migration is intentionally not registered or executed here. The
 * application migration registry will include it separately.
 */
import { sql } from "drizzle-orm";
import type { MigrationDb } from "../lib/migration-db.js";

export async function initGrowthReportAdminReviewAnalysisSchema(
  db: MigrationDb,
): Promise<void> {
  await db.execute(sql.raw(`
    ALTER TABLE growth_reports
      ADD COLUMN IF NOT EXISTS analysis_request_payload jsonb,
      ADD COLUMN IF NOT EXISTS analysis_identity_hash text,
      ADD COLUMN IF NOT EXISTS analysis_response_payload jsonb
  `));
}
