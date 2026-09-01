/**
 * WP2A Migration: New 2.0 Subscription Plans + extra_storage_gb Source of Truth consolidation
 *
 * UP:
 *   1. INSERT new subscription_plans rows (swimnote, x300, x500, x1000) — idempotent ON CONFLICT DO UPDATE
 *   2. Backfill swimming_pools.extra_storage_gb from pool_subscriptions.extra_storage_gb
 *      using MAX() to preserve value; idempotent (only updates when pool_subscriptions has higher value)
 *
 * DOWN (rollback strategy):
 *   1. DELETE new plan rows WHERE tier IN ('swimnote','x300','x500','x1000')
 *   2. extra_storage_gb backfill: no rollback needed (additive, no decrease)
 *
 * Idempotency: ON CONFLICT (tier) DO UPDATE for plan rows; MAX() for backfill — safe to re-run.
 *
 * BACKFILL STRATEGY:
 *   effective_extra = MAX(swimming_pools.extra_storage_gb, pool_subscriptions.extra_storage_gb)
 *   Only increases — never decreases existing buyer extra storage.
 *
 * NOTE: Do NOT execute this against production without approval.
 *       pool-db-init.ts already handles plan UPSERT at server startup.
 *       This standalone migration file is for auditable tracking and manual execution.
 */

import { sql } from "drizzle-orm";
import { superAdminDb } from "@workspace/db";

const db = superAdminDb;

export async function up(): Promise<void> {
  console.log("[wp2a-migration] Starting UP...");

  // ── 1. Insert new 2.0 subscription plans ──────────────────────────────
  const NEW_PLANS = [
    { tier: "swimnote", plan_id: "swimnote",  name: "SWIMNOTE",      price: 9900,   members: 999999, mb: 10240,   gb: 10,   display: "10GB"  },
    { tier: "x300",     plan_id: "x300",      name: "SWIMNOTE X300", price: 119000, members: 300,    mb: 307200,  gb: 300,  display: "300GB" },
    { tier: "x500",     plan_id: "x500",      name: "SWIMNOTE X500", price: 189000, members: 500,    mb: 512000,  gb: 500,  display: "500GB" },
    { tier: "x1000",    plan_id: "x1000",     name: "SWIMNOTE X1000",price: 349000, members: 1000,   mb: 1024000, gb: 1000, display: "1TB"   },
  ] as const;

  for (const p of NEW_PLANS) {
    await db.execute(sql.raw(`
      INSERT INTO subscription_plans
        (tier, plan_id, name, price_per_month, member_limit, storage_mb, storage_gb, display_storage)
      VALUES
        ('${p.tier}','${p.plan_id}','${p.name}',${p.price},${p.members},${p.mb},${p.gb},'${p.display}')
      ON CONFLICT (tier) DO UPDATE SET
        plan_id         = EXCLUDED.plan_id,
        name            = EXCLUDED.name,
        price_per_month = EXCLUDED.price_per_month,
        member_limit    = EXCLUDED.member_limit,
        storage_mb      = EXCLUDED.storage_mb,
        storage_gb      = EXCLUDED.storage_gb,
        display_storage = EXCLUDED.display_storage
    `));
    console.log(`[wp2a-migration] Upserted plan: ${p.tier}`);
  }

  // ── 2. Backfill swimming_pools.extra_storage_gb from pool_subscriptions ─
  // SoT confirmed as swimming_pools.extra_storage_gb (WP2A LOCKED).
  // If pool_subscriptions.extra_storage_gb has a higher value for a pool, copy it over.
  // This is a one-time consolidation — never decreases existing pool value.
  await db.execute(sql.raw(`
    UPDATE swimming_pools p
    SET extra_storage_gb = GREATEST(
      COALESCE(p.extra_storage_gb, 0),
      COALESCE((
        SELECT MAX(ps.extra_storage_gb)
        FROM pool_subscriptions ps
        WHERE ps.swimming_pool_id = p.id
      ), 0)
    )
    WHERE EXISTS (
      SELECT 1 FROM pool_subscriptions ps
      WHERE ps.swimming_pool_id = p.id
        AND COALESCE(ps.extra_storage_gb, 0) > COALESCE(p.extra_storage_gb, 0)
    )
  `));
  console.log("[wp2a-migration] Backfilled extra_storage_gb from pool_subscriptions");

  console.log("[wp2a-migration] UP complete.");
}

export async function down(): Promise<void> {
  console.log("[wp2a-migration] Starting DOWN (rollback)...");

  // Remove new plan rows only — legacy rows untouched
  await db.execute(sql.raw(`
    DELETE FROM subscription_plans
    WHERE tier IN ('swimnote', 'x300', 'x500', 'x1000')
  `));
  console.log("[wp2a-migration] Removed new plan rows: swimnote, x300, x500, x1000");

  // extra_storage_gb backfill: no rollback (additive, no data loss possible)
  console.log("[wp2a-migration] extra_storage_gb backfill: no rollback needed (additive only)");

  console.log("[wp2a-migration] DOWN complete.");
}
