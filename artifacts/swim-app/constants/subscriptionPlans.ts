/**
 * constants/subscriptionPlans.ts
 * 구독 플랜 단일 진실 원본 (Single Source of Truth)
 *
 * Coach (개인 선생님, 사진만): Free / Coach 30 / Coach 50 / Coach 100
 * Premier (수영장/센터, 사진+영상): Premier 200 / Premier 300 / Premier 500 / Premier 1000
 *
 * 이 파일의 값을 기준으로 모든 화면·로직·DB 시드가 동작한다.
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
  {
    tier: "free",
    plan_id: "free_10",
    name: "Free",
    max_members: 10,
    storage_limit_mb: 512,
    display_storage: "500MB",
    price_monthly_krw: 0,
    sort_order: 0,
    is_enterprise: false,
    tier_group: "free",
    color: "#6B7280",
    includes_video: false,
  },
  {
    tier: "starter",
    plan_id: "solo_30",
    name: "Coach 30",
    max_members: 30,
    storage_limit_mb: 3072,
    display_storage: "3GB",
    price_monthly_krw: 3900,
    sort_order: 1,
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
    storage_limit_mb: 5120,
    display_storage: "5GB",
    price_monthly_krw: 6900,
    sort_order: 2,
    is_enterprise: false,
    tier_group: "coach",
    color: "#0EA5E9",
    includes_video: false,
  },
  {
    tier: "standard",
    plan_id: "solo_100",
    name: "Coach 100",
    max_members: 100,
    storage_limit_mb: 10240,
    display_storage: "10GB",
    price_monthly_krw: 9900,
    sort_order: 3,
    is_enterprise: false,
    tier_group: "coach",
    color: "#6366F1",
    includes_video: false,
  },
  {
    tier: "center_200",
    plan_id: "center_200",
    name: "Premier 200",
    max_members: 200,
    storage_limit_mb: 51200,
    display_storage: "50GB",
    price_monthly_krw: 69000,
    sort_order: 4,
    is_enterprise: false,
    tier_group: "premier",
    color: "#F59E0B",
    includes_video: true,
  },
  {
    tier: "advance",
    plan_id: "center_300",
    name: "Premier 300",
    max_members: 300,
    storage_limit_mb: 81920,
    display_storage: "80GB",
    price_monthly_krw: 99000,
    sort_order: 5,
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
    storage_limit_mb: 133120,
    display_storage: "130GB",
    price_monthly_krw: 149000,
    sort_order: 6,
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
    storage_limit_mb: 512000,
    display_storage: "500GB",
    price_monthly_krw: 249000,
    sort_order: 7,
    is_enterprise: false,
    tier_group: "premier",
    color: "#7C3AED",
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
