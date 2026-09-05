/**
 * officialPlanCatalog.ts — SWIMNOTE 공식 구독 플랜 Catalog (SERVER-SIDE CANONICAL SOURCE)
 *
 * ■ 이 파일이 유일한 source of truth.
 * ■ 신규 가입/변경은 반드시 이 catalog 기준으로 처리.
 * ■ Legacy Coach/Premier 플랜은 INACTIVE → 신규 선택 불가.
 * ■ 가격 변경 시 이 파일만 수정 후 Migration 파일도 동기화할 것.
 *
 * 확정 가격표 (2026-09-05):
 *   SWIMNOTE  : ₩9,900/월  (BASE PLAN)
 *   X300      : ₩119,000/월, 300명  (X PLAN)
 *   X500      : ₩189,000/월, 500명  (X PLAN)
 *   X1000     : ₩349,000/월, 1000명 (X PLAN)
 *   DATA100   : ₩7,900/월  (DATA ADD-ON)
 *   DATA300   : ₩22,900/월 (DATA ADD-ON)
 */

export type PlanType = "base" | "x" | "data_addon";

export interface OfficialPlanDef {
  /** DB key — swimming_pools.x_plan_key (for X plans) or subscription_plans.tier */
  plan_key: string;
  /** Human-readable name */
  display_name: string;
  /** Plan category */
  plan_type: PlanType;
  /** Monthly price in KRW */
  monthly_price_krw: number;
  /** Formatted price label */
  price_label: string;
  /** Member limit — null for base/data plans with no hard cap */
  member_limit: number | null;
  /**
   * Additive storage quota in GB added to swimming_pools.extra_storage_gb
   * when this data_addon plan is activated.
   * null for base/x plans (those carry their own storage_gb in subscription_plans).
   *
   * Quota formula: total_gb = base_plan_storage_gb + extra_storage_gb (accumulated add-ons)
   */
  storage_add_gb: number | null;
  /** Whether this plan is selectable for new grants */
  active: boolean;
  /** Display sort order */
  sort_order: number;
  /** RevenueCat product ID — null until confirmed */
  revenuecat_product_id: string | null;
}

// ── 공식 신규 플랜 (active = true) ──────────────────────────────────────────

export const OFFICIAL_PLAN_CATALOG: readonly OfficialPlanDef[] = [
  // ─ BASE ──────────────────────────────────────────────────────────────────
  {
    plan_key:              "swimnote",
    display_name:          "SWIMNOTE",
    plan_type:             "base",
    monthly_price_krw:     9900,
    price_label:           "₩9,900/월",
    member_limit:          null,
    storage_add_gb:        null,
    active:                true,
    sort_order:            10,
    // [WP3] 확정 RC product ID (App Store/Google Play canonical format)
    // RC_PRODUCT_TIER_MAP 동일 패턴: subscriptionService.ts 기준
    revenuecat_product_id: "com.swimnote.swimnote.monthly",
  },

  // ─ X PLAN ────────────────────────────────────────────────────────────────
  {
    plan_key:              "x300",
    display_name:          "SWIMNOTE X300",
    plan_type:             "x",
    monthly_price_krw:     119000,
    price_label:           "₩119,000/월",
    member_limit:          300,
    storage_add_gb:        null,
    active:                true,
    sort_order:            20,
    // [WP3] X 상품: REVENUECAT_X_PRODUCT_IDS env var로 라우팅
    revenuecat_product_id: "com.swimnote.x300.monthly",
  },
  {
    plan_key:              "x500",
    display_name:          "SWIMNOTE X500",
    plan_type:             "x",
    monthly_price_krw:     189000,
    price_label:           "₩189,000/월",
    member_limit:          500,
    storage_add_gb:        null,
    active:                true,
    sort_order:            21,
    revenuecat_product_id: "com.swimnote.x500.monthly",
  },
  {
    plan_key:              "x1000",
    display_name:          "SWIMNOTE X1000",
    plan_type:             "x",
    monthly_price_krw:     349000,
    price_label:           "₩349,000/월",
    member_limit:          1000,
    storage_add_gb:        null,
    active:                true,
    sort_order:            22,
    revenuecat_product_id: "com.swimnote.x1000.monthly",
  },

  // ─ DATA ADD-ON ───────────────────────────────────────────────────────────
  // storage_add_gb: 확정 (2026-09-05) — additive, BASE/X plan quota에 가산
  // RevenueCat 경로: INITIAL_PURCHASE 1회 grant (extra_storage_gb += N)
  //                  RENEWAL: grant 없음 (구독 유지)
  //                  CANCEL/EXPIRY: USER DECISION REQUIRED (quota 정책 미확정)
  {
    plan_key:              "data100",
    display_name:          "DATA100",
    plan_type:             "data_addon",
    monthly_price_krw:     7900,
    price_label:           "₩7,900/월",
    member_limit:          null,
    storage_add_gb:        100,
    active:                true,
    sort_order:            30,
    revenuecat_product_id: "com.swimnote.data100.monthly",
  },
  {
    plan_key:              "data300",
    display_name:          "DATA300",
    plan_type:             "data_addon",
    monthly_price_krw:     22900,
    price_label:           "₩22,900/월",
    member_limit:          null,
    storage_add_gb:        300,
    active:                true,
    sort_order:            31,
    revenuecat_product_id: "com.swimnote.data300.monthly",
  },
] as const;

// ── 조회 헬퍼 ────────────────────────────────────────────────────────────────

/** 전체 카탈로그 */
export function getOfficialCatalog(): readonly OfficialPlanDef[] {
  return OFFICIAL_PLAN_CATALOG;
}

/** 활성 플랜만 */
export function getActivePlans(): OfficialPlanDef[] {
  return OFFICIAL_PLAN_CATALOG.filter((p) => p.active);
}

/** type 기준 필터 */
export function getPlansByType(type: PlanType): OfficialPlanDef[] {
  return OFFICIAL_PLAN_CATALOG.filter((p) => p.active && p.plan_type === type);
}

/** plan_key로 조회 */
export function getOfficialPlan(key: string): OfficialPlanDef | undefined {
  return OFFICIAL_PLAN_CATALOG.find((p) => p.plan_key === key);
}

/** X plan member_limit (서버 권위값 — 클라이언트 제공값 절대 신뢰 금지) */
export function getXPlanMemberLimit(key: string): number | null {
  const plan = getOfficialPlan(key);
  if (!plan || plan.plan_type !== "x") return null;
  return plan.member_limit;
}

/**
 * DATA add-on 플랜의 additive storage quota (GB).
 * 이 값이 pool의 extra_storage_gb에 가산됨.
 * BASE/X 플랜 key 입력 시 null 반환.
 */
export function getDataAddonStorageGb(key: string): number | null {
  const plan = getOfficialPlan(key);
  if (!plan || plan.plan_type !== "data_addon") return null;
  return plan.storage_add_gb;
}

/** 유효한 X plan key 집합 */
export const VALID_X_PLAN_KEYS = new Set(
  OFFICIAL_PLAN_CATALOG.filter((p) => p.plan_type === "x" && p.active).map((p) => p.plan_key),
);
