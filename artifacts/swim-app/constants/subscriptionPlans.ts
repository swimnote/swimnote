/**
 * constants/subscriptionPlans.ts
 * 구독 플랜 단일 진실 원본 (Single Source of Truth)
 *
 * 2026-08-28 가격 재설계:
 *   Free / SOLO(100명, ₩4,900) / Premier 300(₩11,900) / 500(₩19,900) / 1000(₩29,900)
 *   Coach 30 / Coach 50 / Premier 200 → deprecated (기존 구독자 보호, 신규가입 불가)
 *
 * DB(subscription_plans) 실제값과 반드시 일치해야 함
 */

export interface SubscriptionPlanDef {
  tier: string;
  plan_id: string;
  name: string;
  max_members: number;
  storage_limit_mb: number;
  display_storage: string;
  price_monthly_krw: number;
  sort_order: number;
  is_enterprise: boolean;
  tier_group: "free" | "coach" | "premier";
  color: string;
  includes_video: boolean;
}

export const SUBSCRIPTION_PLANS_DEF: SubscriptionPlanDef[] = [
  // ── Active Plans (신규가입 가능) ───────────────────────────────────────────
  {
    tier: "free",
    plan_id: "free_10",
    name: "Free",
    max_members: 10,
    storage_limit_mb: 102,
    display_storage: "100MB",
    price_monthly_krw: 0,
    sort_order: 0,
    is_enterprise: false,
    tier_group: "free",
    color: "#6B7280",
    includes_video: false,
  },
  {
    tier: "standard",
    plan_id: "solo_100",
    name: "SOLO",
    max_members: 100,
    storage_limit_mb: 1024,
    display_storage: "1GB",
    price_monthly_krw: 4900,   // 2026-08-28: ₩5,900 → ₩4,900
    sort_order: 1,
    is_enterprise: false,
    tier_group: "coach",
    color: "#6366F1",
    includes_video: false,
  },
  {
    tier: "advance",
    plan_id: "center_300",
    name: "Premier 300",
    max_members: 300,
    storage_limit_mb: 10240,
    display_storage: "10GB",
    price_monthly_krw: 11900,  // 2026-08-28: ₩27,000 → ₩11,900
    sort_order: 2,
    is_enterprise: false,
    tier_group: "premier",
    color: "#F97316",
    includes_video: true,
  },
  {
    tier: "pro",
    plan_id: "center_500",
    name: "Premier 500",
    max_members: 500,
    storage_limit_mb: 20480,
    display_storage: "20GB",
    price_monthly_krw: 19900,  // 2026-08-28: ₩43,000 → ₩19,900
    sort_order: 3,
    is_enterprise: false,
    tier_group: "premier",
    color: "#EF4444",
    includes_video: true,
  },
  {
    tier: "max",
    plan_id: "center_1000",
    name: "Premier 1000",
    max_members: 1000,
    storage_limit_mb: 51200,
    display_storage: "50GB",
    price_monthly_krw: 29900,  // 2026-08-28: ₩79,000 → ₩29,900
    sort_order: 4,
    is_enterprise: false,
    tier_group: "premier",
    color: "#7C3AED",
    includes_video: true,
  },
  // ── Deprecated Plans (기존 구독자 보호, 신규가입 불가) ─────────────────────
  {
    tier: "starter",
    plan_id: "solo_30",
    name: "Coach 30",
    max_members: 30,
    storage_limit_mb: 307,
    display_storage: "300MB",
    price_monthly_krw: 1900,
    sort_order: 90,
    is_enterprise: false,
    tier_group: "coach",
    color: "#10B981",
    includes_video: false,
  },
  {
    tier: "basic",
    plan_id: "solo_50",
    name: "Coach 50",
    max_members: 50,
    storage_limit_mb: 512,
    display_storage: "500MB",
    price_monthly_krw: 2900,
    sort_order: 91,
    is_enterprise: false,
    tier_group: "coach",
    color: "#0EA5E9",
    includes_video: false,
  },
  {
    tier: "center_200",
    plan_id: "center_200",
    name: "Premier 200",
    max_members: 200,
    storage_limit_mb: 5120,
    display_storage: "5GB",
    price_monthly_krw: 19000,
    sort_order: 92,
    is_enterprise: false,
    tier_group: "premier",
    color: "#F59E0B",
    includes_video: true,
  },
];

export function getPlanByTier(tier: string): SubscriptionPlanDef | undefined {
  return SUBSCRIPTION_PLANS_DEF.find(p => p.tier === tier);
}

export function getPlanByPlanId(planId: string): SubscriptionPlanDef | undefined {
  return SUBSCRIPTION_PLANS_DEF.find(p => p.plan_id === planId);
}

export function getDisplayStorage(tier: string): string {
  return getPlanByTier(tier)?.display_storage ?? "";
}
