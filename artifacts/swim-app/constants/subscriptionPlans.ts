/**
 * constants/subscriptionPlans.ts
 * 구독 플랜 단일 진실 원본 (Single Source of Truth)
 *
 * 이 파일의 값을 기준으로 모든 화면·로직·DB 시드가 동작한다.
 * 화면 표시명 / 내부 tier / 앱스토어 plan_id / 용량 표시를 모두 여기서 관리한다.
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
  tier_group: "free" | "basic" | "enterprise";
  color: string;
}

export const SUBSCRIPTION_PLANS_DEF: SubscriptionPlanDef[] = [
  {
    tier: "free",
    plan_id: "free_5",
    name: "무료",
    max_members: 5,
    storage_limit_mb: 100,
    display_storage: "100MB",
    price_monthly_krw: 0,
    sort_order: 0,
    is_enterprise: false,
    tier_group: "free",
    color: "#6B7280",
  },
  {
    tier: "starter",
    plan_id: "swimnote_30",
    name: "스타터",
    max_members: 30,
    storage_limit_mb: 600,
    display_storage: "600MB",
    price_monthly_krw: 3500,
    sort_order: 1,
    is_enterprise: false,
    tier_group: "basic",
    color: "#10B981",
  },
  {
    tier: "basic",
    plan_id: "swimnote_50",
    name: "베이직",
    max_members: 50,
    storage_limit_mb: 1024,
    display_storage: "1GB",
    price_monthly_krw: 6500,
    sort_order: 2,
    is_enterprise: false,
    tier_group: "basic",
    color: "#0EA5E9",
  },
  {
    tier: "standard",
    plan_id: "swimnote_100",
    name: "스탠다드",
    max_members: 100,
    storage_limit_mb: 5120,
    display_storage: "5GB",
    price_monthly_krw: 9500,
    sort_order: 3,
    is_enterprise: false,
    tier_group: "basic",
    color: "#6366F1",
  },
  {
    tier: "advance",
    plan_id: "swimnote_300",
    name: "어드밴스",
    max_members: 300,
    storage_limit_mb: 20480,
    display_storage: "20GB",
    price_monthly_krw: 29000,
    sort_order: 4,
    is_enterprise: false,
    tier_group: "basic",
    color: "#8B5CF6",
  },
  {
    tier: "pro",
    plan_id: "swimnote_500",
    name: "프로",
    max_members: 500,
    storage_limit_mb: 40960,
    display_storage: "40GB",
    price_monthly_krw: 59000,
    sort_order: 5,
    is_enterprise: false,
    tier_group: "basic",
    color: "#7C3AED",
  },
  {
    tier: "max",
    plan_id: "swimnote_1000",
    name: "맥스",
    max_members: 1000,
    storage_limit_mb: 102400,
    display_storage: "100GB",
    price_monthly_krw: 99000,
    sort_order: 6,
    is_enterprise: false,
    tier_group: "basic",
    color: "#EC4899",
  },
  {
    tier: "enterprise_2000",
    plan_id: "swimnote_2000",
    name: "엔터프라이즈 2000",
    max_members: 2000,
    storage_limit_mb: 256000,
    display_storage: "250GB",
    price_monthly_krw: 179000,
    sort_order: 7,
    is_enterprise: true,
    tier_group: "enterprise",
    color: "#B45309",
  },
  {
    tier: "enterprise_3000",
    plan_id: "swimnote_3000",
    name: "엔터프라이즈 3000",
    max_members: 3000,
    storage_limit_mb: 409600,
    display_storage: "400GB",
    price_monthly_krw: 249000,
    sort_order: 8,
    is_enterprise: true,
    tier_group: "enterprise",
    color: "#92400E",
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
