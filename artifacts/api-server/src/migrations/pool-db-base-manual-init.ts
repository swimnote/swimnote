/**
 * pool-db-base-manual-init.ts — BASE SWIMNOTE manual entitlement
 *
 * Group BM-1: base_manual_entitlement
 *   ADD COLUMN IF NOT EXISTS — idempotent startup migration
 *
 * Super Admin can grant BASE SWIMNOTE access without payment.
 * RevenueCat webhook NEVER touches this column.
 *
 * Effective BASE access = valid_paid_base OR base_manual_entitlement
 */

import { sql } from "drizzle-orm";
import { superAdminDb as db } from "@workspace/db";

export async function runBaseManualMigration() {
  // Group BM-1: base_manual_entitlement column
  await db.execute(sql`
    ALTER TABLE swimming_pools
    ADD COLUMN IF NOT EXISTS base_manual_entitlement BOOLEAN NOT NULL DEFAULT false
  `);
  console.log("[migration] pool-db-base-manual-init: base_manual_entitlement added");
}
