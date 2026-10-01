import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

export const DEFAULT_ANALYSIS_LEASE_MS = 180_000;

export function getAnalysisLeaseMs(): number {
  const configured = Number(process.env["GROWTH_REPORT_ANALYSIS_LEASE_MS"]);
  return Number.isFinite(configured) && configured >= 15_000
    ? Math.floor(configured)
    : DEFAULT_ANALYSIS_LEASE_MS;
}

/**
 * Atomically takes ownership of one persistent report. The sealed-target
 * predicate is repeated here (not only in candidate selection) so manual
 * triggers and concurrent queue readers share the same eligibility boundary.
 */
export async function claimGrowthReportAnalysis(
  db: any,
  params: {
    reportId: string;
    expectedStatus: string;
    leaseMs?: number;
    requireSealedMonthlyTarget?: boolean;
  },
): Promise<string | null> {
  const token = randomUUID();
  const leaseMs = params.leaseMs ?? getAnalysisLeaseMs();
  const claimed = await db.execute(sql`
    UPDATE growth_reports AS gr
    SET analysis_claim_token = ${token},
        analysis_lease_until = now() + (${leaseMs} * interval '1 millisecond'),
        updated_at = now()
    WHERE gr.id = ${params.reportId}
      AND gr.product_status = ${params.expectedStatus}::gr_product_status_enum
      AND gr.product_status NOT IN (
        'PUBLISHED'::gr_product_status_enum,
        'EXCLUDED'::gr_product_status_enum,
        'FAILED'::gr_product_status_enum
      )
      AND gr.deleted_at IS NULL
      AND gr.analysis_uncertain_at IS NULL
      AND (gr.analysis_next_attempt_at IS NULL OR gr.analysis_next_attempt_at <= now())
      AND (
        gr.analysis_claim_token IS NULL
        OR gr.analysis_lease_until IS NULL
        OR gr.analysis_lease_until <= now()
      )
      AND (
        NOT ${params.requireSealedMonthlyTarget === true}
        OR (
          (gr.report_type = 'monthly' OR gr.report_type IS NULL)
          AND EXISTS (
            SELECT 1
            FROM growth_report_cycles sealed_cycle
            INNER JOIN growth_report_eligible_targets target
              ON target.cycle_id = sealed_cycle.id
             AND target.student_id = gr.student_id
            WHERE sealed_cycle.id = gr.cycle_id
              AND sealed_cycle.swimming_pool_id = gr.swimming_pool_id
              AND sealed_cycle.report_period = gr.report_period
              AND sealed_cycle.eligibility_sealed_at IS NOT NULL
              AND target.policy_excluded_at IS NULL
          )
        )
      )
    RETURNING gr.analysis_claim_token
  `);
  const row = (claimed.rows as Array<{ analysis_claim_token?: string }> | undefined)?.[0];
  return row?.analysis_claim_token ?? null;
}

/** Extends a live lease. An expired owner cannot revive its own lease. */
export async function renewGrowthReportAnalysisClaim(
  db: any,
  params: {
    reportId: string;
    claimToken: string;
    leaseMs?: number;
  },
): Promise<boolean> {
  const leaseMs = params.leaseMs ?? getAnalysisLeaseMs();
  const renewed = await db.execute(sql`
    UPDATE growth_reports
    SET analysis_lease_until = now() + (${leaseMs} * interval '1 millisecond'),
        updated_at = now()
    WHERE id = ${params.reportId}
      AND analysis_claim_token = ${params.claimToken}
      AND analysis_lease_until > now()
      AND product_status IN (
        'OPEN', 'PREANALYZING', 'READY_FOR_ANALYSIS', 'ANALYZING', 'REGENERATING'
      )
      AND deleted_at IS NULL
    RETURNING id
  `);
  return Boolean((renewed.rows as any[] | undefined)?.length);
}
