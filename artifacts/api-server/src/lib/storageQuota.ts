/**
 * lib/storageQuota.ts
 * WP2A: Unified storage quota helper
 *
 * Source of Truth:
 *  - base storage: subscription_plans.storage_gb (via swimming_pools.subscription_tier)
 *  - extra storage: swimming_pools.extra_storage_gb (LOCKED SoT — not pool_subscriptions)
 *  - photo bytes:   photo_assets_meta.file_size (is_clone=false) + student_photos.file_size_bytes
 *  - video bytes:   video_assets_meta.file_size (status='active', 14-day retention)
 *  - thumbnail bytes: NOT included (policy: thumbnail quota excluded)
 */

import { db, superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

export type StorageWarningLevel = "ok" | "warning" | "data_pack" | "blocked";

export interface PoolStorageUsage {
  /** album photos (photo_assets_meta, non-clone) + notice/upload photos (student_photos) */
  photoBytes:    number;
  /** active videos only (video_assets_meta status='active') */
  videoBytes:    number;
  /** photoBytes + videoBytes */
  usedBytes:     number;
  /** base_plan_storage_gb + swimming_pools.extra_storage_gb */
  quotaGb:       number;
  quotaBytes:    number;
  /** 0–100+ rounded */
  pct:           number;
  /** ok | warning (≥80%) | data_pack (≥90%) | blocked (≥100%) */
  warningLevel:  StorageWarningLevel;
}

/**
 * Get effective quota in GB for a pool.
 * SoT: base from subscription_plans joined via swimming_pools.subscription_tier
 *       extra from swimming_pools.extra_storage_gb
 */
export async function getPoolQuotaGb(poolId: string): Promise<{
  baseGb:   number;
  extraGb:  number;
  quotaGb:  number;
}> {
  const [row] = (await superAdminDb.execute(sql`
    SELECT
      COALESCE(sp.storage_gb, 0.1) AS base_gb,
      COALESCE(p.extra_storage_gb, 0)  AS extra_gb
    FROM swimming_pools p
    LEFT JOIN subscription_plans sp
           ON sp.tier = COALESCE(p.subscription_tier, 'free')
    WHERE p.id = ${poolId}
    LIMIT 1
  `)).rows as any[];

  const baseGb  = Number(row?.base_gb  ?? 0.1);
  const extraGb = Number(row?.extra_gb ?? 0);
  return { baseGb, extraGb, quotaGb: baseGb + extraGb };
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
  const { baseGb, extraGb, quotaGb } = await getPoolQuotaGb(poolId);

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
    // Set blocked
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
