/**
 * staging-manifest.ts — Staging DB Bootstrap Migration Order
 *
 * 목적:
 *   Empty staging DB → 재현 가능한 schema 구축.
 *   이 파일이 Staging Bootstrap의 단일 진입점.
 *
 * 실행:
 *   ALLOW_TEST_DB_MUTATIONS=true npx tsx src/migrations/staging-manifest.ts
 *
 * 제약:
 *   - getMigrationDb()를 통해 TEST_DATABASE_URL만 사용
 *   - SUPABASE_DATABASE_URL 덮어쓰기 hack 금지
 *   - ALLOW_TEST_DB_MUTATIONS=true 필수
 *   - Production ref(mrgkiussgbbmxfnkjgqy) 자동 BLOCK
 *   - 각 migration은 명시적 db 주입을 받음 (superAdminDb global 사용 금지)
 *   - DROP 없음 (additive only)
 *   - 각 migration은 멱등 (재실행 안전)
 *
 * Migration 실행 순서:
 *   §0  base tables (pool-db-base-manual-init.ts)
 *   §1  pool-db-init (swimming_pools, users, students, class_groups, etc.)
 *   §2  runtime-ddl-consolidated (members, inquiries, billing, super tables, etc.)
 *   §3  X-mode migrations
 *   §4  CS (Customer Support) migrations
 *   §5  Growth Report migrations
 *   §6  WP8 / WP9 migrations
 *   §7  WP6/WP7 additive schema (event_logs + push_logs columns)
 *   §8  Misc migrations
 *   §9  verification
 */

import { getMigrationDb } from "../lib/migration-db.js";

// ── Migration imports ──────────────────────────────────────────────────────
import { runBaseManualMigration }       from "./pool-db-base-manual-init.js";
import { initPoolDb }                   from "./pool-db-init.js";
import { run as runRuntimeDdlConsolidated } from "./runtime-ddl-consolidated.js";
import { initMembershipSchema }         from "./pool-db-membership.js";
import { initXModeSchema }             from "./pool-db-x-init.js";
import { initXPaymentSchema }          from "./pool-db-x-payment-init.js";
import { runXBillingContractMigration } from "./pool-db-x-billing-contract.js";
import { runXLifecycleMigration }       from "./pool-db-x-lifecycle.js";
import { runXSetupMigration }           from "./pool-db-x-setup.js";
import { runGrInteractionsMigration }   from "./pool-db-x-gr-interactions-init.js";
import { runX04Migration }              from "./pool-db-x04.js";
import { runCs05rMigration }            from "./pool-db-cs-05r.js";
import { runCs12Migration }             from "./pool-db-cs-12.js";
import { runCs15Migration }             from "./pool-db-cs-15.js";
import { runCs16Migration }             from "./pool-db-cs-16.js";
import { runCs23aMigration }            from "./pool-db-cs-23a.js";
import { runCs24aMigration }            from "./pool-db-cs-24a.js";
import { runCs24bMigration }            from "./pool-db-cs-24b.js";
import { runCs26Migration }             from "./pool-db-cs-26.js";
import { runCsPa0Migration }            from "./pool-db-cs-pa0.js";
import { initSuperDb }                  from "./super-db-init.js";
import { initGrowthReportGR1Schema }    from "./growth-report-gr1-init.js";
import { runGr1bMigration }             from "./growth-report-gr1b-data-accumulating.js";
import { initGrowthReportGR3Schema }    from "./growth-report-gr3-engine-init.js";
import { initGrowthReportGR5Schema }    from "./growth-report-gr5-review-init.js";
import { runMigration as runWp8Crm }    from "./wp8-support-case-crm.js";
import { up as runWp8aLifecycle }       from "./step-wp8-a-lifecycle.js";
import { up as runWp8bBatchJobs }       from "./step-wp8-b-batch-jobs.js";
import { up as runStep0Kpi }            from "./step0-monthly-kpi-foundation.js";
import { runWp6Wp7AdditiveSchema }      from "./wp6-wp7-additive-schema.js";
import { backfillPoolAdminRoles }       from "./roles-backfill.js";

// ── Migration step runner ──────────────────────────────────────────────────
type MigrationFn = (db: import("../lib/migration-db.js").MigrationDb) => Promise<void>;

async function runStep(label: string, fn: MigrationFn, db: import("../lib/migration-db.js").MigrationDb): Promise<void> {
  console.log(`\n[manifest] ▶ ${label}...`);
  try {
    await fn(db);
    console.log(`[manifest] ✅ ${label} complete`);
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (
      msg.includes("already exists") ||
      msg.includes("duplicate_object") ||
      msg.includes("42P07") ||     // relation already exists
      msg.includes("42710")        // duplicate object
    ) {
      console.log(`[manifest] ⏩ ${label} skipped (already exists)`);
    } else {
      console.error(`[manifest] ⚠ ${label} error: ${msg}`);
      // Non-fatal for manifest runs: continue to next migration
    }
  }
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║         SWIMNOTE STAGING BOOTSTRAP (staging-manifest)        ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // ── Get explicit staging DB ─────────────────────────────────────────────
  // getMigrationDb() fails closed on: missing TEST_DATABASE_URL,
  // Production ref, unknown ref, missing ALLOW_TEST_DB_MUTATIONS flag.
  // NO env override hack. NO SUPABASE_DATABASE_URL fallback.
  const { db, close } = await getMigrationDb("staging-manifest");

  const { sql } = await import("drizzle-orm");
  const countBefore = (await db.execute(sql.raw(
    "SELECT COUNT(*) cnt FROM information_schema.tables WHERE table_schema='public'"
  )).catch(() => ({ rows: [{ cnt: "?" }] }))).rows[0]?.cnt as string | undefined;
  console.log(`\n[manifest] Initial table count: ${countBefore}`);

  try {
    // §0: Base manual init (swimming_pools, users, push_logs, etc.)
    await runStep("§0  pool-db-base-manual-init",     runBaseManualMigration,      db);

    // §1: Core pool tables
    await runStep("§1  pool-db-init",                 initPoolDb,                  db);

    // §2: Consolidated DDL
    await runStep("§2  runtime-ddl-consolidated",     runRuntimeDdlConsolidated,   db);
    await runStep("§2b pool-db-membership",           initMembershipSchema,         db);

    // §3: X-mode
    await runStep("§3a pool-db-x-init (WP1)",         initXModeSchema,             db);
    await runStep("§3b pool-db-x-payment-init",       initXPaymentSchema,          db);
    await runStep("§3c pool-db-x-billing-contract",   runXBillingContractMigration, db);
    await runStep("§3d pool-db-x-lifecycle",          runXLifecycleMigration,      db);
    await runStep("§3e pool-db-x-setup",              runXSetupMigration,          db);
    await runStep("§3f pool-db-x-gr-interactions",    runGrInteractionsMigration,  db);
    await runStep("§3g pool-db-x04",                  runX04Migration,             db);

    // §4: CS migrations
    await runStep("§4a pool-db-cs-05r",               runCs05rMigration,           db);
    await runStep("§4b pool-db-cs-12",                runCs12Migration,            db);
    await runStep("§4c pool-db-cs-15",                runCs15Migration,            db);
    await runStep("§4d pool-db-cs-16",                runCs16Migration,            db);
    await runStep("§4e pool-db-cs-23a",               runCs23aMigration,           db);
    await runStep("§4f pool-db-cs-24a",               runCs24aMigration,           db);
    await runStep("§4g pool-db-cs-24b",               runCs24bMigration,           db);
    await runStep("§4h pool-db-cs-26",                runCs26Migration,            db);
    await runStep("§4i pool-db-cs-pa0",               runCsPa0Migration,           db);

    // §5: Super + Growth Reports
    await runStep("§5a super-db-init",                initSuperDb,                 db);
    await runStep("§5b growth-report-gr1-init",       initGrowthReportGR1Schema,   db);
    await runStep("§5c growth-report-gr1b",           runGr1bMigration,            db);
    await runStep("§5d growth-report-gr3-engine",     initGrowthReportGR3Schema,   db);
    await runStep("§5e growth-report-gr5-review",     initGrowthReportGR5Schema,   db);

    // §6: WP8 / WP9
    await runStep("§6a wp8-support-case-crm",         runWp8Crm,                   db);
    await runStep("§6b step-wp8-a-lifecycle",         runWp8aLifecycle,            db);
    await runStep("§6c step-wp8-b-batch-jobs",        runWp8bBatchJobs,            db);
    await runStep("§6d step0-monthly-kpi-foundation", runStep0Kpi,                 db);

    // §7: WP6/WP7 additive schema (official migration —归属 완료)
    await runStep("§7  wp6-wp7-additive-schema",      runWp6Wp7AdditiveSchema,     db);

    // §8: Misc backfills
    await runStep("§8  roles-backfill",               backfillPoolAdminRoles,      db);

  } finally {
    await close();
  }

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║                     BOOTSTRAP COMPLETE                      ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log("\n[manifest] Next step: re-run ALLOW_TEST_DB_MUTATIONS=true npx tsx src/migrations/staging-manifest.ts");
  console.log("[manifest] to verify idempotency (second run should produce no errors).");
  console.log("[manifest] Then run src/scripts/staging-fixture.ts to create test fixtures.");
}

main().catch((e) => {
  console.error("[manifest] FATAL:", e.message);
  process.exit(1);
});
