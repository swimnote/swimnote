/**
 * lib/subscriptionResolver.ts
 * 구독 상태 단일 기준값(Effective Subscription) 계산기
 *
 * 우선순위:
 *  1) swimming_pools.subscription_source = 'manual' → 슈퍼관리자 수동 override
 *  2) pool_subscriptions.status = 'active' (RevenueCat/결제 연동)
 *  3) swimming_pools.subscription_tier (이전 수동 변경 등 남아있는 값)
 *  4) free_default (아무것도 없으면 무료)
 *
 * 반환:
 *  source, planCode, planName, memberLimit, storageGb,
 *  videoEnabled, whiteLabelEnabled, status, startsAt, endsAt,
 *  trialEndsAt, overrideActive, effectiveReason, pricePerMonth, nextBillingAt
 */

import { superAdminDb } from "@workspace/db";
const db = superAdminDb;
import { sql } from "drizzle-orm";

// ── 티어 정규화 매핑 ──────────────────────────────────────────────────────
export const TIER_NORMALIZE: Record<string, string> = {
  growth:      "center_200",
  premium:     "pro",
  enterprise:  "max",
  center_300:  "advance",
  center_500:  "pro",
  center_1000: "max",
};

export function normalizeTier(raw: string | null | undefined): string {
  if (!raw) return "free";
  return TIER_NORMALIZE[raw] ?? raw;
}

// ── 영상·화이트라벨 허용 티어 ─────────────────────────────────────────────
const VIDEO_TIERS       = new Set(["center_200", "advance", "pro", "max"]);
const WHITELABEL_TIERS  = new Set(["center_200", "advance", "pro", "max"]);

// ── 구독 상태 정규화 ──────────────────────────────────────────────────────
export type SubscriptionSource = "manual" | "revenuecat" | "free_default";
export type SubscriptionStatus =
  | "trial" | "active" | "expired" | "suspended"
  | "payment_failed" | "pending_deletion" | "deleted" | "cancelled";

export interface ResolvedSubscription {
  source:           SubscriptionSource;
  planCode:         string;        // tier (e.g. "max", "starter")
  planName:         string;        // "Premier 1000"
  memberLimit:      number;
  storageGb:        number;
  videoEnabled:     boolean;
  whiteLabelEnabled: boolean;
  status:           SubscriptionStatus;
  startsAt:         string | null; // ISO
  endsAt:           string | null; // ISO
  trialEndsAt:      string | null; // ISO
  overrideActive:   boolean;       // 슈퍼관리자 member_limit 개별 override 여부
  effectiveReason:  string;
  pricePerMonth:    number;
  nextBillingAt:    string | null;
}

/**
 * poolId를 받아 완전 계산된 구독 상태를 반환한다.
 * 내부에서 superAdminDb(swimming_pools), db(pool_subscriptions, subscription_plans) 조회.
 */
export async function resolveSubscription(poolId: string): Promise<ResolvedSubscription> {

  // 1. swimming_pools 조회
  const [pool] = (await superAdminDb.execute(sql`
    SELECT
      subscription_tier,
      subscription_status,
      subscription_source,
      subscription_start_at,
      subscription_end_at,
      trial_end_at,
      white_label_enabled,
      video_storage_limit_mb,
      member_limit
    FROM swimming_pools
    WHERE id = ${poolId}
    LIMIT 1
  `)).rows as any[];

  // 2. pool_subscriptions 조회 (RC/결제 레코드)
  const [rcSub] = (await db.execute(sql`
    SELECT tier, status, current_period_start, next_billing_at
    FROM pool_subscriptions
    WHERE swimming_pool_id = ${poolId}
    LIMIT 1
  `)).rows as any[];

  // 3. 유효 tier 결정
  const rawTier      = pool?.subscription_tier ?? "free";
  const effectiveTier = normalizeTier(rawTier);

  // 4. subscription_plans 조회
  const [plan] = (await db.execute(sql`
    SELECT name, member_limit, storage_gb, price_per_month
    FROM subscription_plans
    WHERE tier = ${effectiveTier}
    LIMIT 1
  `)).rows as any[];

  // 5. source 결정
  const sourceCol = pool?.subscription_source as string | null | undefined;
  let source: SubscriptionSource = "free_default";
  let effectiveReason = "no_subscription";

  if (sourceCol === "manual") {
    source = "manual";
    effectiveReason = "super_admin_override";
  } else if (rcSub && rcSub.status === "active") {
    source = "revenuecat";
    effectiveReason = "revenuecat_active";
  } else if (effectiveTier !== "free") {
    // tier가 설정돼 있지만 source 컬럼이 아직 없는 경우 (마이그레이션 전 데이터)
    source = "revenuecat";
    effectiveReason = "tier_set_source_unknown";
  } else {
    source = "free_default";
    effectiveReason = "no_paid_subscription";
  }

  // 6. 유효 status 결정 (만료/체험 자동 판정)
  const now = Date.now();
  const trialEndsDate = pool?.trial_end_at ? new Date(pool.trial_end_at) : null;
  const endsDate      = pool?.subscription_end_at ? new Date(pool.subscription_end_at) : null;

  let rawStatus = (pool?.subscription_status as string) ?? "trial";
  let effectiveStatus: SubscriptionStatus = rawStatus as SubscriptionStatus;

  if (endsDate && endsDate.getTime() < now && rawStatus === "active") {
    effectiveStatus  = "expired";
    effectiveReason += "+past_end_date";
  } else if (trialEndsDate && trialEndsDate.getTime() < now && rawStatus === "trial") {
    effectiveStatus  = "expired";
    effectiveReason += "+trial_expired";
  }

  // 7. member_limit (pool 개별 override > plan 기본값)
  const overrideActive = pool?.member_limit != null;
  const memberLimit    = overrideActive
    ? Number(pool.member_limit)
    : Number(plan?.member_limit ?? 10);

  // 8. storage_gb — 항상 플랜 기준 (수동 변경 즉시 반영)
  const storageGb = Number(plan?.storage_gb ?? 0.49);

  // 9. video / whitelabel — tier 기준
  const videoEnabled      = VIDEO_TIERS.has(effectiveTier);
  const whiteLabelEnabled = WHITELABEL_TIERS.has(effectiveTier);

  return {
    source,
    planCode:          effectiveTier,
    planName:          plan?.name ?? effectiveTier,
    memberLimit,
    storageGb,
    videoEnabled,
    whiteLabelEnabled,
    status:            effectiveStatus,
    startsAt:          pool?.subscription_start_at
                         ? new Date(pool.subscription_start_at).toISOString() : null,
    endsAt:            pool?.subscription_end_at
                         ? new Date(pool.subscription_end_at).toISOString()   : null,
    trialEndsAt:       pool?.trial_end_at
                         ? new Date(pool.trial_end_at).toISOString()          : null,
    overrideActive,
    effectiveReason,
    pricePerMonth:     Number(plan?.price_per_month ?? 0),
    nextBillingAt:     rcSub?.next_billing_at ?? null,
  };
}

/**
 * 슈퍼관리자 수동 변경 시 swimming_pools에 구독 관련 컬럼 전체를 동기화한다.
 * tier 변경 시 subscription_plans에서 파생값(storage, video, whitelabel)을 자동 계산해 함께 저장.
 */
export async function syncPoolSubscriptionFields(params: {
  poolId:          string;
  tier?:           string | null;
  status?:         string | null;
  memberLimitOverride?: number | null;  // null이면 override 제거
  trialEndsAt?:    string | null;
  startsAt?:       string | null;
  endsAt?:         string | null;
  source?:         SubscriptionSource;
}): Promise<void> {
  const { poolId, tier, status, memberLimitOverride, trialEndsAt, startsAt, endsAt, source } = params;

  if (tier) {
    const effectiveTier = normalizeTier(tier);

    // 플랜 기준값 조회
    const [plan] = (await db.execute(sql`
      SELECT storage_gb, member_limit FROM subscription_plans
      WHERE tier = ${effectiveTier} LIMIT 1
    `)).rows as any[];

    const storageGb       = Number(plan?.storage_gb ?? 0.49);
    const videoEnabled    = VIDEO_TIERS.has(effectiveTier);
    const whiteLabelEnabled = WHITELABEL_TIERS.has(effectiveTier);
    const videoLimitMb    = videoEnabled ? 1024 * 1024 : 0; // 영상 허용: 무제한(1TB 세팅), 불가: 0

    await superAdminDb.execute(sql`
      UPDATE swimming_pools SET
        subscription_tier          = ${effectiveTier},
        base_storage_gb            = ${Math.round(storageGb)},
        video_storage_limit_mb     = ${videoLimitMb},
        white_label_enabled        = ${whiteLabelEnabled},
        subscription_source        = ${source ?? "manual"},
        updated_at                 = now()
      WHERE id = ${poolId}
    `);
  }

  if (status) {
    await superAdminDb.execute(sql`
      UPDATE swimming_pools SET subscription_status = ${status}, updated_at = now()
      WHERE id = ${poolId}
    `);
  }

  if (memberLimitOverride !== undefined) {
    if (memberLimitOverride === null) {
      await superAdminDb.execute(sql`
        UPDATE swimming_pools SET member_limit = NULL, updated_at = now() WHERE id = ${poolId}
      `);
    } else {
      await superAdminDb.execute(sql`
        UPDATE swimming_pools SET member_limit = ${memberLimitOverride}, updated_at = now()
        WHERE id = ${poolId}
      `);
    }
  }

  if (trialEndsAt !== undefined) {
    if (trialEndsAt === null) {
      await superAdminDb.execute(sql`UPDATE swimming_pools SET trial_end_at = NULL, updated_at = now() WHERE id = ${poolId}`);
    } else {
      await superAdminDb.execute(sql`UPDATE swimming_pools SET trial_end_at = ${trialEndsAt}::timestamptz, updated_at = now() WHERE id = ${poolId}`);
    }
  }

  if (startsAt !== undefined) {
    if (startsAt === null) {
      await superAdminDb.execute(sql`UPDATE swimming_pools SET subscription_start_at = NULL, updated_at = now() WHERE id = ${poolId}`);
    } else {
      await superAdminDb.execute(sql`UPDATE swimming_pools SET subscription_start_at = ${startsAt}::timestamptz, updated_at = now() WHERE id = ${poolId}`);
    }
  }

  if (endsAt !== undefined) {
    if (endsAt === null) {
      await superAdminDb.execute(sql`UPDATE swimming_pools SET subscription_end_at = NULL, updated_at = now() WHERE id = ${poolId}`);
    } else {
      await superAdminDb.execute(sql`UPDATE swimming_pools SET subscription_end_at = ${endsAt}::timestamptz, updated_at = now() WHERE id = ${poolId}`);
    }
  }
}
