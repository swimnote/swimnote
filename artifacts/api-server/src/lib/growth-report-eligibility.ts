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

// ── D. 학생 단위 ELIGIBILITY 판정 ─────────────────────────────────────────────

/**
 * 정책 상수
 *   GROWTH_REPORT_MIN_ATTENDANCE_COUNT — 분석월 기준 최소 출석 횟수
 *   GROWTH_REPORT_MIN_SOURCE_RECORDS   — 분석월 기준 최소 유효 일지 건수
 *
 * 출석 인정 semantics (v2 이후):
 *   출석 = explicit present/late row 존재
 *         OR class_diary 확인 + 재원 + 명시적 결석 없음
 *   (queryAttendanceForEligibility 참조)
 *
 * source_event_count 정책 변경 이력:
 *   v1: GROWTH_REPORT_MIN_SOURCE_RECORDS = 3  (3/3 정책)
 *   v2: GROWTH_REPORT_MIN_SOURCE_RECORDS = 2  (3/2 정책, 2026-09-12 확정)
 *       source=1 → INSUFFICIENT_SOURCE_DATA
 *       source=0 → NO_SOURCE_DATA
 *       source>=2 → source 조건 PASS
 */
export const GROWTH_REPORT_MIN_ATTENDANCE_COUNT = 3;
export const GROWTH_REPORT_MIN_SOURCE_RECORDS   = 2;

/**
 * eligibility_version — 정책 변경 시 버전을 올려 기존 판정과 구분.
 *   1 = 3/3 정책 (MIN_SOURCE_RECORDS=3)
 *   2 = 3/2 정책 (MIN_SOURCE_RECORDS=2) + diary 기반 attendance 보완
 */
export const GROWTH_REPORT_ELIGIBILITY_VERSION = 2;

export interface StudentEligibilityResult {
  eligible:           boolean;
  exclusion_code:     string | null;   // null = ELIGIBLE
  attendance_count:   number;
  source_event_count: number;
  reregistered:       boolean;         // report_month 시작 시점 재원 여부
  eligibility_version: number;
}

/**
 * evaluateStudentGrowthReportEligibility
 *
 * 3중 조건으로 학생 단위 발급 자격을 판정합니다.
 *
 * 판정 순서:
 *   1. 재원 조건 (report_month 재원 중)
 *   2. 출석 조건 (>= GROWTH_REPORT_MIN_ATTENDANCE_COUNT, present+late)
 *   3. 일지 조건 (>= GROWTH_REPORT_MIN_SOURCE_RECORDS, 유효 note 포함 diary)
 *
 * exclusion_code 규칙:
 *   NOT_REREGISTERED         — report_month 기준 재원 이력 없음
 *   INSUFFICIENT_ATTENDANCE  — 출석 기준 미달
 *   NO_SOURCE_DATA           — 유효 일지 0건
 *   INSUFFICIENT_SOURCE_DATA — 유효 일지 1~(MIN-1)건
 *   null                     — ELIGIBLE
 *
 * @param params.attendanceCount   출석 횟수 (COUNT(DISTINCT a.id) WHERE status IN ('present','late'))
 * @param params.sourceEventCount  유효 일지 건수 (snapshot builder와 동일 predicate)
 * @param params.reregistered      report_month 시작일 기준 재원 중 여부
 */
export function evaluateStudentGrowthReportEligibility(params: {
  attendanceCount:   number;
  sourceEventCount:  number;
  reregistered:      boolean;
}): StudentEligibilityResult {
  const { attendanceCount, sourceEventCount, reregistered } = params;

  let exclusion_code: string | null = null;

  if (!reregistered) {
    exclusion_code = "NOT_REREGISTERED";
  } else if (attendanceCount < GROWTH_REPORT_MIN_ATTENDANCE_COUNT) {
    exclusion_code = "INSUFFICIENT_ATTENDANCE";
  } else if (sourceEventCount === 0) {
    exclusion_code = "NO_SOURCE_DATA";
  } else if (sourceEventCount < GROWTH_REPORT_MIN_SOURCE_RECORDS) {
    exclusion_code = "INSUFFICIENT_SOURCE_DATA";
  }

  return {
    eligible:            exclusion_code === null,
    exclusion_code,
    attendance_count:    attendanceCount,
    source_event_count:  sourceEventCount,
    reregistered,
    eligibility_version: GROWTH_REPORT_ELIGIBILITY_VERSION,
  };
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
