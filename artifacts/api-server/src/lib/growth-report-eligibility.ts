/**
 * growth-report-eligibility.ts
 *
 * SINGLE SOURCE-OF-TRUTH for Growth Report pool eligibility.
 *
 * Used by:
 *   - growth-report-scheduler.ts  (getXEligiblePools → isGrowthReportEligiblePool)
 *   - parent-growth-report.ts     (status API X check)
 *   - Any future generator/worker
 *
 * Rule (matches Scheduler gate X02-B2):
 *   (x_paid_entitlement OR x_manual_entitlement)
 *   AND NOT x_force_disabled
 *   AND xmode_config_status = 'READY'
 *
 * NOTE: Legacy xmode_entitlement column alone does NOT grant eligibility.
 *       It may be truthy on old records that were never migrated to paid/manual split.
 *       Only use it as a fallback if the pool pre-dates X02-B2 (both paid and manual are null).
 *
 * AI calls:  0
 * DB write:  NO
 */

export interface PoolEligibilityFields {
  x_paid_entitlement:   boolean | null;
  x_manual_entitlement: boolean | null;
  x_force_disabled:     boolean | null;
  xmode_config_status:  string  | null;
  /** Legacy column — kept for backward compatibility diagnostics only */
  xmode_entitlement?:   boolean | null;
}

/**
 * isGrowthReportEligiblePool
 *
 * Returns true if the pool should participate in Growth Report generation.
 *
 * Conditions (all must hold):
 *   1. Effective entitlement: (paid OR manual) — same gate as X02-B2 scheduler
 *   2. NOT force-disabled
 *   3. xmode_config_status = 'READY' — curriculum configured and approved
 */
export function isGrowthReportEligiblePool(pool: PoolEligibilityFields): boolean {
  const paid    = pool.x_paid_entitlement   === true;
  const manual  = pool.x_manual_entitlement === true;
  const force   = pool.x_force_disabled     === true;
  const ready   = pool.xmode_config_status  === "READY";

  return (paid || manual) && !force && ready;
}

/**
 * SQL fragment for use in WHERE clauses.
 * Must mirror isGrowthReportEligiblePool exactly.
 */
export const GROWTH_REPORT_ELIGIBLE_SQL = `
  (COALESCE(x_paid_entitlement, false) OR COALESCE(x_manual_entitlement, false))
  AND NOT COALESCE(x_force_disabled, false)
  AND xmode_config_status = 'READY'
  AND approval_status = 'approved'
`.trim();

// ── Product-Level Eligibility Separation ───────────────────────────────────
//
// Base X Eligibility (= isGrowthReportEligiblePool above):
//   entitled + not force disabled + READY
//
// FREE Monthly Report eligibility:
//   base eligible (no additional paid-product constraint)
//
// Future PAID Report eligibility (NOT IMPLEMENTED HERE):
//   base eligible + paid product/order/license check
//   → Extend this file with `isPaidReportEligible(pool, order)` when ready.
//   → Do NOT add paid_report conditions to FREE report logic.
//
// ── Consumers (must all use isGrowthReportEligiblePool or GROWTH_REPORT_ELIGIBLE_SQL) ──
//   • parent-growth-report.ts   status API
//   • growth-report-scheduler.ts  getXEligiblePools / ensureCurrentMonthGrowthReportCycle
//   • super.ts growth-report-scheduler/run endpoint
//   • growth-report-analysis-worker.ts (inherits through cycle selection)

/**
 * isFreeMonthlyReportEligible
 * Alias for isGrowthReportEligiblePool — semantically marks "FREE monthly" tier.
 * Paid-report extensions should NOT reuse this function.
 */
export const isFreeMonthlyReportEligible = isGrowthReportEligiblePool;
