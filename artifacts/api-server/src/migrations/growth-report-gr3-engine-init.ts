/**
 * growth-report-gr3-engine-init.ts
 *
 * GR3 additive migration — ENGINE integration foundation.
 *
 * Production run: PENDING (run only after GR1 migration is applied).
 *
 * Groups:
 *   GR3-A: growth_reports.analysis_retry_count column
 *
 * Safety:
 *   All statements are additive (IF NOT EXISTS / DO NOTHING).
 *   No data is deleted.
 *   No PUBLISHED reports are affected.
 */

import { sql } from "drizzle-orm";
import { superAdminDb as db } from "@workspace/db";

// ─── Group GR3-A: analysis_retry_count column ─────────────────────────────────

async function runGroupA_RetryCount(): Promise<void> {
  // analysis_retry_count — tracks how many retryable ENGINE failures occurred
  // for this report. When it reaches GROWTH_REPORT_MAX_RETRY_COUNT the worker
  // stops retrying (prevents infinite loop on persistent retryable errors).
  await db.execute(sql.raw(`
    ALTER TABLE growth_reports
      ADD COLUMN IF NOT EXISTS analysis_retry_count integer NOT NULL DEFAULT 0
  `));
  console.log("[GR3-init] GR3-A-1: analysis_retry_count OK");
}

// ─── Runner ───────────────────────────────────────────────────────────────────

export async function initGrowthReportGR3Schema(): Promise<void> {
  console.log("[GR3-init] Starting GR3 ENGINE integration schema migration…");
  const groups: { name: string; fn: () => Promise<void> }[] = [
    { name: "GR3-A: analysis_retry_count", fn: runGroupA_RetryCount },
  ];

  for (const g of groups) {
    try {
      await g.fn();
    } catch (err: any) {
      console.error(`[GR3-init] FAILED: ${g.name}:`, err.message);
      throw err;
    }
  }
  console.log("[GR3-init] GR3 migration complete.");
}

// Allow direct execution: `pnpm tsx src/migrations/growth-report-gr3-engine-init.ts`
if (process.argv[1]?.endsWith("growth-report-gr3-engine-init.ts")) {
  initGrowthReportGR3Schema()
    .then(() => process.exit(0))
    .catch((e) => { console.error(e); process.exit(1); });
}
