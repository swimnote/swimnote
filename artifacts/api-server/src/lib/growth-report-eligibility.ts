/**
 * growth-report-eligibility.ts
 *
 * 3-WAY ELIGIBILITY SPLIT:
 *
 * A. isXModeConfigReady(pool)
 *    → 신규 X 가맹점 정식 Setup 완료 여부 (validateXModeReadiness 와 쌍)
 *    → x_paid/manual + NOT force + xmode_config_status='READY'
 *    → getXEligiblePools, ensureCurrentMonthGrowthReportCycle 에서 READY 여부 판단 시 사용
 *
 * B. isFreeGrowthReportEligiblePool(pool)
 *    → FREE 월간 성장리포트 생성 자격
 *    → x_paid/manual + NOT force (xmode_config_status='READY' 불필요)
 *    → Scheduler, Status API, Generator 모두 이 함수를 authority로 사용
 *    → TOYKIDS 등 legacy paid X pool도 포함
 *    → approval_status 는 SQL 단에서 별도 조건으로 처리
 *
 * C. isPaidGrowthReportEligiblePool (FUTURE — NOT IMPLEMENTED)
 *    → 향후 유료 리포트 상품 전용 extension point
 *    → Extend this file with isPaidGrowthReportEligiblePool(pool, order) when ready
 *    → FREE 조건에 유료 gate를 섞지 말 것
 *
 * CONTRACTS:
 *   - FREE report eligibility ≠ X onboarding READY
 *   - validateXModeReadiness (xmode-readiness.ts) 는 신규 READY 전환 guard 전용
 *   - 기존 READY pool은 소급 무효화 없음 (forward-only guard)
 *   - curriculum DOCX 없음 = FREE report 차단 사유 아님 (enrichment source 없음일 뿐)
 *
 * AI calls:  0
 * DB write:  NO
 */

// ── A. Pool 필드 타입 ──────────────────────────────────────────────────────────

export interface PoolEligibilityFields {
  x_paid_entitlement:   boolean | null;
  x_manual_entitlement: boolean | null;
  x_force_disabled:     boolean | null;
  xmode_config_status:  string  | null;
  /** Optional — for X READY checks only */
  approval_status?:     string  | null;
}

// ── A. X CONFIG READY ─────────────────────────────────────────────────────────

/**
 * isXModeConfigReady
 *
 * Pool이 신규 X 가맹점 정식 Setup을 완료했는가.
 * validateXModeReadiness (setup submission + curriculum) 와 쌍으로 사용.
 *
 * Conditions:
 *   1. Effective entitlement: (paid OR manual)
 *   2. NOT force-disabled
 *   3. xmode_config_status = 'READY' — X Setup 완료
 */
export function isXModeConfigReady(pool: PoolEligibilityFields): boolean {
  const paid   = pool.x_paid_entitlement   === true;
  const manual = pool.x_manual_entitlement === true;
  const force  = pool.x_force_disabled     === true;
  const ready  = pool.xmode_config_status  === "READY";

  return (paid || manual) && !force && ready;
}

// ── B. FREE GROWTH REPORT ELIGIBILITY ────────────────────────────────────────

/**
 * isFreeGrowthReportEligiblePool
 *
 * Pool이 FREE 월간 성장리포트 대상인가.
 *
 * 중요:
 *   - xmode_config_status='READY' 불필요 (legacy paid X pool 포함)
 *   - curriculum DOCX 없어도 eligible (enrichment 없음일 뿐, 차단 아님)
 *   - approval_status 는 SQL 단에서 처리 (FREE_GROWTH_REPORT_ELIGIBLE_SQL 참조)
 *
 * Conditions:
 *   1. Effective entitlement: (paid OR manual)
 *   2. NOT force-disabled
 */
export function isFreeGrowthReportEligiblePool(pool: PoolEligibilityFields): boolean {
  const paid   = pool.x_paid_entitlement   === true;
  const manual = pool.x_manual_entitlement === true;
  const force  = pool.x_force_disabled     === true;

  return (paid || manual) && !force;
}

/**
 * SQL fragment for WHERE clauses — must mirror isFreeGrowthReportEligiblePool.
 * Adds approval_status = 'approved' (DB-enforced, not in TS interface).
 *
 * Used by:
 *   - getXEligiblePools (scheduler)
 *   - ensureCurrentMonthGrowthReportCycle (READY auto-recovery)
 *   - super.ts growth-report-scheduler/run (SA trigger)
 */
export const FREE_GROWTH_REPORT_ELIGIBLE_SQL = `
  (COALESCE(x_paid_entitlement, false) OR COALESCE(x_manual_entitlement, false))
  AND NOT COALESCE(x_force_disabled, false)
  AND approval_status = 'approved'
`.trim();

// ── C. FUTURE PAID EXTENSION POINT ───────────────────────────────────────────

/**
 * isPaidGrowthReportEligiblePool — NOT IMPLEMENTED
 *
 * Extend this file when a paid Growth Report product is launched:
 *   1. isFreeGrowthReportEligiblePool must pass (base commercial eligibility)
 *   2. Check paid product/order/license on pool or user
 *   3. May require stricter config (e.g. xmode_config_status='READY')
 *
 * Do NOT merge paid-product logic into isFreeGrowthReportEligiblePool.
 */
export function isPaidGrowthReportEligiblePool(
  pool: PoolEligibilityFields,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _productContext?: unknown,
): boolean {
  throw new Error("isPaidGrowthReportEligiblePool: NOT IMPLEMENTED — see growth-report-eligibility.ts for extension guide");
}

// ── Backward-compat aliases ───────────────────────────────────────────────────

/**
 * isGrowthReportEligiblePool
 * @deprecated — Use isFreeGrowthReportEligiblePool explicitly.
 *   Kept as alias so existing callers don't break without a migration step.
 */
export const isGrowthReportEligiblePool = isFreeGrowthReportEligiblePool;

/**
 * GROWTH_REPORT_ELIGIBLE_SQL
 * @deprecated — Use FREE_GROWTH_REPORT_ELIGIBLE_SQL explicitly.
 */
export const GROWTH_REPORT_ELIGIBLE_SQL = FREE_GROWTH_REPORT_ELIGIBLE_SQL;

/**
 * isFreeMonthlyReportEligible — explicit FREE alias (semantics marker only).
 */
export const isFreeMonthlyReportEligible = isFreeGrowthReportEligiblePool;
