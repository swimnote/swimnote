/**
 * lib/storageQuota.ts
 * Canonical storage quota resolver — ONE source of truth for ALL quota consumers.
 *
 * Priority (high → low):
 *  1. X active (management_override | paid_entitlement | manual_entitlement)
 *     + canonical x_plan_key (x300 | x500 | x1000) → X plan storage
 *  2. BASE subscription_tier
 *
 * NEVER use:
 *  - swimming_pools.storage_mb / base_storage_gb (stale denormalized copies)
 *  - pool_subscriptions.tier alone (billing tier ≠ effective plan for Management/Manual X)
 *
 * Consumers:
 *  - storage.ts  → /admin/storage  (저장공간 현황 화면)
 *  - billing.ts  → /features       (billing quota display)
 *  - photos.ts   → presigned URL   (direct upload quota gate)
 *  - uploads.ts  → POST /uploads   (multipart upload quota gate)
 *  - videos.ts   → upload check    (video upload quota gate)
 */

import { db, superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

export type StorageWarningLevel = "ok" | "warning" | "data_pack" | "blocked";

/** X plan source for auditing/debugging */
export type PlanSource = "BASE" | "PAID_X" | "MANUAL_X" | "MANAGEMENT_X";

export interface PoolStorageUsage {
  /** album photos (photo_assets_meta, non-clone) + notice/upload photos (student_photos) */
  photoBytes:    number;
  /** active videos only (video_assets_meta status='active') */
  videoBytes:    number;
  /** photoBytes + videoBytes */
  usedBytes:     number;
  /** base plan storage + swimming_pools.extra_storage_gb */
  quotaGb:       number;
  quotaBytes:    number;
  /** 0–100+ rounded */
  pct:           number;
  /** ok | warning (≥80%) | data_pack (≥90%) | blocked (≥100%) */
  warningLevel:  StorageWarningLevel;
}

/** Full resolution result for auditing and downstream consumers */
export interface EffectiveStorageQuota {
  /** The canonical plan key that drives storage (e.g. "x1000", "swimnote", "free") */
  effectivePlanKey:  string;
  /** How the plan was resolved */
  planSource:        PlanSource;
  /** Base storage from subscription_plans (excludes DATA add-on) */
  baseStorageGb:     number;
  /** Extra storage from swimming_pools.extra_storage_gb (DATA add-ons) */
  extraStorageGb:    number;
  /** baseStorageGb + extraStorageGb */
  totalStorageGb:    number;
  /** totalStorageGb in bytes */
  totalQuotaBytes:   number;
}

const CANONICAL_X_KEYS = new Set(["x300", "x500", "x1000"]);

/**
 * Resolve the full effective storage quota for a pool.
 * Single authoritative function — all other helpers delegate here.
 *
 * Uses a two-step JS resolution pattern (mirrors subscriptionService.resolveSubscription)
 * to avoid sql.raw() which is unreliable in esbuild production bundles.
 *
 * X source priority:
 *   x_management_override  → MANAGEMENT_X
 *   x_paid_entitlement     → PAID_X
 *   x_manual_entitlement   → MANUAL_X
 *   (none)                 → BASE
 */
export async function resolveEffectiveStorageQuota(poolId: string): Promise<EffectiveStorageQuota> {
  // Step 1: read pool X flags + tier + extra storage (no sql.raw needed)
  const [pool] = (await superAdminDb.execute(sql`
    SELECT
      COALESCE(x_management_override, false) AS mgmt,
      COALESCE(x_paid_entitlement,    false) AS paid,
      COALESCE(x_manual_entitlement,  false) AS manual,
      x_plan_key,
      COALESCE(subscription_tier, 'free')    AS subscription_tier,
      COALESCE(extra_storage_gb, 0)          AS extra_gb
    FROM swimming_pools
    WHERE id = ${poolId}
    LIMIT 1
  `)).rows as any[];

  // Step 2: JS-level plan resolution — identical logic to subscriptionService
  const xActive = Boolean(pool?.mgmt) || Boolean(pool?.paid) || Boolean(pool?.manual);
  const xPlanKey = pool?.x_plan_key as string | null | undefined;
  const effectiveTier = (xActive && xPlanKey && CANONICAL_X_KEYS.has(xPlanKey))
    ? xPlanKey
    : String(pool?.subscription_tier ?? "free");

  const planSource: PlanSource =
    Boolean(pool?.mgmt)   ? "MANAGEMENT_X" :
    Boolean(pool?.paid)   ? "PAID_X"       :
    Boolean(pool?.manual) ? "MANUAL_X"     :
                            "BASE";

  // Step 3: fetch base storage from subscription_plans by the resolved tier
  const [plan] = (await superAdminDb.execute(sql`
    SELECT storage_gb
    FROM subscription_plans
    WHERE tier = ${effectiveTier}
    LIMIT 1
  `)).rows as any[];

  const baseGb  = Number(plan?.storage_gb ?? 0.1);
  const extraGb = Number(pool?.extra_gb   ?? 0);
  const totalGb = baseGb + extraGb;

  return {
    effectivePlanKey:  effectiveTier,
    planSource,
    baseStorageGb:     baseGb,
    extraStorageGb:    extraGb,
    totalStorageGb:    totalGb,
    totalQuotaBytes:   totalGb * 1024 ** 3,
  };
}

/**
 * Get effective quota in GB for a pool.
 * Thin wrapper over resolveEffectiveStorageQuota for backward compatibility.
 */
export async function getPoolQuotaGb(poolId: string): Promise<{
  baseGb:       number;
  extraGb:      number;
  quotaGb:      number;
  planSource:   PlanSource;
  effectivePlanKey: string;
}> {
  const q = await resolveEffectiveStorageQuota(poolId);
  return {
    baseGb:           q.baseStorageGb,
    extraGb:          q.extraStorageGb,
    quotaGb:          q.totalStorageGb,
    planSource:       q.planSource,
    effectivePlanKey: q.effectivePlanKey,
  };
}

/**
 * Compute unified storage usage for a pool.
 * Counts photo bytes from BOTH storage tables to avoid undercounting:
 *   - photo_assets_meta  → album photos uploaded via photos.ts
 *   - student_photos     → notice/announcement images uploaded via uploads.ts
 * These are distinct asset types in separate tables and must not be double-counted.
 *
 * Video bytes from video_assets_meta WHERE status='active' only.
 */
export async function getPoolStorageUsage(poolId: string): Promise<PoolStorageUsage> {
  const { totalStorageGb: quotaGb } = await resolveEffectiveStorageQuota(poolId);

  // Album photos (photos.ts path) — canonical photo table; is_clone=false to exclude clones
  const [albumRow] = (await db.execute(sql`
    SELECT COALESCE(SUM(file_size), 0) AS bytes
    FROM photo_assets_meta
    WHERE pool_id = ${poolId}
      AND is_clone = false
  `)).rows as any[];

  // Notice/upload photos (uploads.ts path) — separate table, different asset type
  const [noticeRow] = (await db.execute(sql`
    SELECT COALESCE(SUM(file_size_bytes), 0) AS bytes
    FROM student_photos
    WHERE swimming_pool_id = ${poolId}
  `)).rows as any[];

  // Active videos only — expired/deleted excluded per 14-day retention policy
  const [videoRow] = (await db.execute(sql`
    SELECT COALESCE(SUM(file_size), 0) AS bytes
    FROM video_assets_meta
    WHERE pool_id = ${poolId}
      AND status = 'active'
  `)).rows as any[];

  const photoBytes = Number(albumRow?.bytes ?? 0) + Number(noticeRow?.bytes ?? 0);
  const videoBytes = Number(videoRow?.bytes ?? 0);
  const usedBytes  = photoBytes + videoBytes;
  const quotaBytes = quotaGb * 1024 ** 3;
  const pct        = quotaBytes > 0 ? Math.round((usedBytes / quotaBytes) * 100) : 0;

  const warningLevel: StorageWarningLevel =
    pct >= 100 ? "blocked"   :
    pct >= 90  ? "data_pack" :
    pct >= 80  ? "warning"   : "ok";

  return { photoBytes, videoBytes, usedBytes, quotaBytes, quotaGb, pct, warningLevel };
}

/**
 * Convenience: set upload_blocked flag based on unified quota.
 * Returns current usage after optional flag update.
 */
export async function checkAndUpdateUploadBlocked(poolId: string): Promise<{
  blocked:      boolean;
  pct:          number;
  warningLevel: StorageWarningLevel;
}> {
  const usage = await getPoolStorageUsage(poolId);

  if (usage.pct >= 100) {
    await superAdminDb.execute(sql`
      UPDATE swimming_pools SET upload_blocked = true WHERE id = ${poolId}
    `).catch(() => {});
    return { blocked: true, pct: usage.pct, warningLevel: "blocked" };
  }

  // Auto-clear if under quota (only if not is_readonly)
  const [pool] = (await superAdminDb.execute(sql`
    SELECT upload_blocked, is_readonly FROM swimming_pools WHERE id = ${poolId} LIMIT 1
  `)).rows as any[];
  if (pool?.upload_blocked && !pool?.is_readonly) {
    await superAdminDb.execute(sql`
      UPDATE swimming_pools SET upload_blocked = false WHERE id = ${poolId}
    `).catch(() => {});
  }

  return { blocked: false, pct: usage.pct, warningLevel: usage.warningLevel };
}
