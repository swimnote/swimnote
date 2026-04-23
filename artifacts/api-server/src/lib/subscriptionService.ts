/**
 * lib/subscriptionService.ts
 * 구독 모듈 단일 소스 — 계산기 + 변경 경로
 *
 * ═══════════════════════════════════════════════════════
 * 원칙
 *  1. subscription_plans  = 플랜 원천 테이블 (DB)
 *  2. swimming_pools      = 현재 적용 상태만 저장
 *  3. resolveSubscription = 유일한 계산기
 *  4. applySubscriptionState = 유일한 변경 경로
 *  5. 화면에서 tier(planCode) 직접 노출 금지 → planName 사용
 * ═══════════════════════════════════════════════════════
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

const db = superAdminDb;

// ── 티어 우선순위 (숫자가 클수록 상위 플랜) ──────────────────────────
export const TIER_ORDER: Record<string, number> = {
  free: 0, starter: 1, basic: 2, standard: 3,
  center_200: 4, advance: 5, pro: 6, max: 7,
};
export function getTierRank(tier: string): number {
  return TIER_ORDER[normalizeTier(tier)] ?? -1;
}
export function isUpgradeTier(currentTier: string, newTier: string): boolean {
  return getTierRank(newTier) > getTierRank(currentTier);
}
export function isDowngradeTier(currentTier: string, newTier: string): boolean {
  return getTierRank(newTier) < getTierRank(currentTier);
}

// ── RC 제품 ID → tier 매핑 (billing.ts에서 이관) ─────────────────────
export const RC_PRODUCT_TIER_MAP: Record<string, string> = {
  // ── 기본 (앱 rcPackageId와 동일) ─────────────────────────────────────
  "solo_30":  "starter", "solo_50":  "basic", "solo_100": "standard",
  "center_200": "center_200", "center_300": "advance", "center_500": "pro", "center_1000": "max",

  // ── Android Google Play base plan 변형 (:monthly 접미사) ──────────────
  "solo_30:monthly":    "starter",   "solo_50:monthly":    "basic",
  "solo_100:monthly":   "standard",
  "center_200:monthly": "center_200", "center_300:monthly": "advance",
  "center_500:monthly": "pro",        "center_1000:monthly":"max",

  // ── swimnote_ 접두사 변형 (App Store Connect 제품 ID) ─────────────────
  "swimnote_solo_30": "starter",  "swimnote_solo_50": "basic",  "swimnote_solo_100": "standard",
  "swimnote_solo_30:monthly": "starter", "swimnote_solo_50:monthly": "basic", "swimnote_solo_100:monthly": "standard",
  "swimnote_solo_monthly": "basic",  "swimnote_solo_monthly:monthly": "basic",
  "swimnote_center_200": "center_200", "swimnote_center_300": "advance",
  "swimnote_center_500": "pro",        "swimnote_center_1000": "max",
  "swimnote_center_200:monthly": "center_200", "swimnote_center_300:monthly": "advance",
  "swimnote_center_500:monthly": "pro",        "swimnote_center_1000:monthly": "max",
  "swimnote_center_monthly": "center_200", "swimnote_center_monthly:monthly": "center_200",
  "center_monthly": "center_200",

  // ── coach_ 변형 ────────────────────────────────────────────────────────
  "coach_30": "starter", "coach_50": "basic", "coach_100": "standard",
  "swimnote_coach_30": "starter", "swimnote_coach_50": "basic", "swimnote_coach_100": "standard",
  "coach_30:monthly": "starter", "coach_50:monthly": "basic", "coach_100:monthly": "standard",
};

// ── 티어 정규화 (레거시 코드명 → 현행 코드명) ──────────────────────────
export const TIER_NORMALIZE: Record<string, string> = {
  growth: "center_200", premium: "pro", enterprise: "max",
  center_300: "advance", center_500: "pro", center_1000: "max",
};
export function normalizeTier(raw: string | null | undefined): string {
  if (!raw) return "free";
  return TIER_NORMALIZE[raw] ?? raw;
}

// ── 타입 ─────────────────────────────────────────────────────────────
export type SubscriptionSource = "manual" | "revenuecat" | "free_default";
export type SubscriptionStatus =
  | "trial" | "active" | "expired" | "suspended"
  | "payment_failed" | "pending_deletion" | "deleted" | "cancelled";

export interface ResolvedSubscription {
  planCode:            string;   // internal tier code (DO NOT display in UI)
  planName:            string;   // display name e.g. "Premier 500"
  status:              SubscriptionStatus;
  source:              SubscriptionSource;
  memberLimit:         number;
  storageMb:           number;
  storageGb:           number;   // decimal e.g. 0.5, 80, 500
  displayStorage:      string;   // "500MB", "80GB", "500GB"
  videoEnabled:        boolean;
  whiteLabelEnabled:   boolean;
  videoStorageLimitMb: number;   // 1048576 or 0
  startsAt:            string | null;
  endsAt:              string | null;
  trialEndsAt:         string | null;
  overrideActive:      boolean;  // pool-level member_limit override is active
  effectiveReason:     string;
  pricePerMonth:       number;
  nextBillingAt:       string | null;
  // 다운그레이드 예약
  pendingTier:         string | null;   // 예약된 다운그레이드 tier
  pendingPlanName:     string | null;   // 예약된 플랜 표시명
  downgradeAt:         string | null;   // 다운그레이드 적용 예정일
}

export interface ApplyOptions {
  startsAt?:            string | null;
  endsAt?:              string | null;
  trialEndsAt?:         string | null;
  memberLimitOverride?: number | null;  // undefined=don't touch, null=clear, number=set
  nextBillingAt?:       string | null;
  resetReadonly?:       boolean;        // clear is_readonly/upload_blocked flags
}

// ── 플랜 조회 헬퍼 ───────────────────────────────────────────────────
async function fetchPlan(tier: string) {
  const [plan] = (await db.execute(sql`
    SELECT name, member_limit, price_per_month, storage_mb, display_storage,
           storage_mb::numeric / 1024.0 AS storage_gb
    FROM subscription_plans WHERE tier = ${tier} LIMIT 1
  `)).rows as any[];
  return plan ?? null;
}

// ════════════════════════════════════════════════════════════════════
// resolveSubscription — 유일한 계산기 (모든 API가 이것만 사용)
// ════════════════════════════════════════════════════════════════════
export async function resolveSubscription(poolId: string): Promise<ResolvedSubscription> {
  const [pool] = (await db.execute(sql`
    SELECT subscription_tier, subscription_status, subscription_source,
           subscription_start_at, subscription_end_at, trial_end_at,
           white_label_enabled, video_storage_limit_mb, member_limit
    FROM swimming_pools WHERE id = ${poolId} LIMIT 1
  `)).rows as any[];

  const [rcSub] = (await db.execute(sql`
    SELECT tier, status, current_period_start, next_billing_at, pending_tier, downgrade_at
    FROM pool_subscriptions WHERE swimming_pool_id = ${poolId} LIMIT 1
  `)).rows as any[];

  const effectiveTier = normalizeTier(pool?.subscription_tier ?? "free");
  const plan = await fetchPlan(effectiveTier);

  // ── source ──
  const sourceCol = pool?.subscription_source as string | null | undefined;
  let source: SubscriptionSource = "free_default";
  let effectiveReason = "no_subscription";
  if (sourceCol === "manual") {
    source = "manual"; effectiveReason = "super_admin_override";
  } else if (rcSub?.status === "active" || sourceCol === "revenuecat") {
    source = "revenuecat"; effectiveReason = "revenuecat_active";
  } else {
    source = "free_default"; effectiveReason = "no_paid_subscription";
  }

  // ── status (만료 자동 판정 포함) ──
  const now = Date.now();
  const endsDate  = pool?.subscription_end_at ? new Date(pool.subscription_end_at) : null;
  const trialDate = pool?.trial_end_at         ? new Date(pool.trial_end_at)        : null;
  let rawStatus = (pool?.subscription_status as string) ?? "trial";
  let effectiveStatus = rawStatus as SubscriptionStatus;
  if (endsDate && endsDate.getTime() < now && rawStatus === "active") {
    effectiveStatus = "expired"; effectiveReason += "+past_end_date";
  } else if (trialDate && trialDate.getTime() < now && rawStatus === "trial") {
    effectiveStatus = "expired"; effectiveReason += "+trial_expired";
  }

  // ── member_limit (pool override > plan default; 9999 = legacy unlimited → use plan) ──
  const rawMemberLimit = pool?.member_limit != null ? Number(pool.member_limit) : null;
  const overrideActive = rawMemberLimit != null && rawMemberLimit < 9999;
  const memberLimit    = overrideActive ? rawMemberLimit! : Number(plan?.member_limit ?? 10);

  // ── storage (항상 플랜 기준) ──
  const storageMb      = Number(plan?.storage_mb    ?? 102);
  const storageGb      = Number(plan?.storage_gb    ?? 0.1);
  const displayStorage = String(plan?.display_storage ?? "100MB");

  // ── video / whitelabel (플랜 storage_mb 기준: Premier200 = 5120MB 이상) ──
  const videoEnabled        = storageMb >= 5120;
  const whiteLabelEnabled   = storageMb >= 5120;
  const videoStorageLimitMb = videoEnabled ? 1024 * 1024 : 0;

  // ── 다운그레이드 예약 정보 ──
  const rawPendingTier = rcSub?.pending_tier ? normalizeTier(rcSub.pending_tier) : null;
  let pendingPlanName: string | null = null;
  if (rawPendingTier) {
    const pendingPlan = await fetchPlan(rawPendingTier);
    pendingPlanName = pendingPlan?.name ?? rawPendingTier;
  }

  return {
    planCode:            effectiveTier,
    planName:            plan?.name ?? effectiveTier,
    status:              effectiveStatus,
    source,
    memberLimit,
    storageMb,
    storageGb,
    displayStorage,
    videoEnabled,
    whiteLabelEnabled,
    videoStorageLimitMb,
    startsAt:    pool?.subscription_start_at ? new Date(pool.subscription_start_at).toISOString() : null,
    endsAt:      pool?.subscription_end_at   ? new Date(pool.subscription_end_at).toISOString()   : null,
    trialEndsAt: pool?.trial_end_at          ? new Date(pool.trial_end_at).toISOString()          : null,
    overrideActive,
    effectiveReason,
    pricePerMonth: Number(plan?.price_per_month ?? 0),
    nextBillingAt: rcSub?.next_billing_at ?? null,
    pendingTier:     rawPendingTier,
    pendingPlanName,
    downgradeAt:     rcSub?.downgrade_at ? String(rcSub.downgrade_at).slice(0, 10) : null,
  };
}

// ════════════════════════════════════════════════════════════════════
// applySubscriptionState — 유일한 변경 경로
//   슈퍼관리자 수동 / RC 구매 / RC 갱신 / RC 만료 / RC 취소 → 전부 여기로
// ════════════════════════════════════════════════════════════════════
export async function applySubscriptionState(
  poolId:  string,
  tier:    string,
  source:  SubscriptionSource,
  status:  SubscriptionStatus,
  options: ApplyOptions = {}
): Promise<ResolvedSubscription> {
  const effectiveTier = normalizeTier(tier);
  const { startsAt, endsAt, trialEndsAt, memberLimitOverride, nextBillingAt, resetReadonly } = options;

  const plan = await fetchPlan(effectiveTier);
  const storageMb         = Number(plan?.storage_mb ?? 102);
  const storageGb         = Number(plan?.storage_gb ?? 0.1);
  const videoEnabled      = storageMb >= 5120;
  const whiteLabelEnabled = storageMb >= 5120;
  const videoLimitMb      = videoEnabled ? 1024 * 1024 : 0;

  // ── swimming_pools 주 상태 업데이트 (플랜 표시명/용량/회원한도 포함) ──
  const planName        = plan?.name ?? effectiveTier;
  const displayStorage  = String(plan?.display_storage ?? "500MB");
  // memberLimitOverride 미지정 시 plan 기본값으로 기록 (swimming_pools가 항상 현재 상태 저장)
  const effectiveMemberLimit =
    memberLimitOverride !== undefined
      ? memberLimitOverride        // 수동 override 우선
      : Number(plan?.member_limit ?? 10); // plan 기본값

  await db.execute(sql`
    UPDATE swimming_pools SET
      subscription_tier          = ${effectiveTier},
      subscription_plan_name     = ${planName},
      subscription_status        = ${status},
      subscription_source        = ${source},
      storage_mb                 = ${storageMb},
      display_storage            = ${displayStorage},
      base_storage_gb            = ${storageGb},
      video_storage_limit_mb     = ${videoLimitMb},
      white_label_enabled        = ${whiteLabelEnabled},
      member_limit               = ${effectiveMemberLimit},
      updated_at                 = now()
    WHERE id = ${poolId}
  `);

  // ── 선택적 타임스탬프 ──
  if (startsAt !== undefined) {
    startsAt === null
      ? await db.execute(sql`UPDATE swimming_pools SET subscription_start_at = NULL, updated_at = now() WHERE id = ${poolId}`)
      : await db.execute(sql`UPDATE swimming_pools SET subscription_start_at = ${startsAt}::timestamptz, updated_at = now() WHERE id = ${poolId}`);
  }
  if (endsAt !== undefined) {
    endsAt === null
      ? await db.execute(sql`UPDATE swimming_pools SET subscription_end_at = NULL, updated_at = now() WHERE id = ${poolId}`)
      : await db.execute(sql`UPDATE swimming_pools SET subscription_end_at = ${endsAt}::timestamptz, updated_at = now() WHERE id = ${poolId}`);
  }
  if (trialEndsAt !== undefined) {
    trialEndsAt === null
      ? await db.execute(sql`UPDATE swimming_pools SET trial_end_at = NULL, updated_at = now() WHERE id = ${poolId}`)
      : await db.execute(sql`UPDATE swimming_pools SET trial_end_at = ${trialEndsAt}::timestamptz, updated_at = now() WHERE id = ${poolId}`);
  }

  // ── 읽기전용 해제 (구매/갱신 시) ──
  if (resetReadonly) {
    await db.execute(sql`
      UPDATE swimming_pools
      SET is_readonly = false, upload_blocked = false, readonly_reason = NULL, payment_failed_at = NULL, updated_at = now()
      WHERE id = ${poolId}
    `);
  }

  // ── pool_subscriptions upsert (RC 연동 시) ──
  if (source === "revenuecat") {
    const todayStr = new Date().toISOString().split("T")[0];
    const ps_status = ["active", "trial"].includes(status) ? "active" : "inactive";
    await db.execute(sql`
      INSERT INTO pool_subscriptions (swimming_pool_id, tier, status, current_period_start, next_billing_at)
      VALUES (${poolId}, ${effectiveTier}, ${ps_status}, ${todayStr}, ${nextBillingAt ?? null})
      ON CONFLICT (swimming_pool_id) DO UPDATE
        SET tier = ${effectiveTier}, status = ${ps_status},
            current_period_start = ${todayStr},
            next_billing_at = ${nextBillingAt ?? null},
            pending_tier = NULL, downgrade_at = NULL,
            updated_at = now()
    `).catch(() => {});
  }
  if (source === "manual") {
    // 수동 변경도 pool_subscriptions 동기화
    const ps_status = ["active", "trial"].includes(status) ? "active" : "inactive";
    await db.execute(sql`
      INSERT INTO pool_subscriptions (swimming_pool_id, tier, status, current_period_start)
      VALUES (${poolId}, ${effectiveTier}, ${ps_status}, now())
      ON CONFLICT (swimming_pool_id) DO UPDATE
        SET tier = ${effectiveTier}, status = ${ps_status}, updated_at = now()
    `).catch(() => {});
  }

  // resolver 결과 반환 (DB 반영 완료 후)
  return resolveSubscription(poolId);
}

// ════════════════════════════════════════════════════════════════════
// backfillPoolSubscriptionFields
//   기존 pools에 subscription_plan_name/storage_mb/display_storage 채우기
//   서버 기동 시 한 번 실행하거나 /super/billing/backfill-pools 호출
// ════════════════════════════════════════════════════════════════════
export async function backfillPoolSubscriptionFields(): Promise<{ updated: number; errors: number }> {
  const rows = (await db.execute(sql`
    SELECT id, subscription_tier, subscription_status, subscription_source
    FROM swimming_pools
    WHERE subscription_plan_name IS NULL
       OR storage_mb = 0
       OR storage_mb IS NULL
    LIMIT 500
  `)).rows as any[];

  let updated = 0, errors = 0;
  for (const row of rows) {
    try {
      const tier = normalizeTier(row.subscription_tier ?? "free");
      const plan = await fetchPlan(tier);
      const storageMb     = Number(plan?.storage_mb ?? 102);
      const storageGb     = Number(plan?.storage_gb ?? 0.1);
      const displayStorage = String(plan?.display_storage ?? "100MB");
      const planName      = String(plan?.name ?? tier);
      const videoLimitMb  = storageMb >= 5120 ? 1024 * 1024 : 0;
      const whiteLabelEn  = storageMb >= 5120;
      await db.execute(sql`
        UPDATE swimming_pools SET
          subscription_plan_name = ${planName},
          storage_mb             = ${storageMb},
          display_storage        = ${displayStorage},
          base_storage_gb        = ${storageGb},
          video_storage_limit_mb = ${videoLimitMb},
          white_label_enabled    = ${whiteLabelEn},
          updated_at             = now()
        WHERE id = ${row.id}
      `);
      updated++;
    } catch {
      errors++;
    }
  }
  console.log(`[backfill] swimming_pools 구독 필드 보완: updated=${updated}, errors=${errors}`);
  return { updated, errors };
}
