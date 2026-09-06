/**
 * backup-manifest.ts — Backup DB Bootstrap (WP18-C Phase A)
 *
 * 목적:
 *   SUPABASE_BACKUP_DATABASE_URL → Production-compatible schema 구축.
 *   staging-manifest.ts와 동일한 migration 순서를 따름.
 *
 * 실행:
 *   ALLOW_BACKUP_DB_MUTATIONS=true tsx src/migrations/backup-manifest.ts
 *
 * 보안:
 *   - SUPABASE_BACKUP_DATABASE_URL만 허용
 *   - Production ref (mrgkiussgbbmxfnkjgqy) 자동 BLOCK
 *   - Staging ref (cbpaxrvrqczqefjoykge) BLOCK (staging≠backup)
 *   - ALLOW_BACKUP_DB_MUTATIONS=true 필수
 *   - 연결 문자열/비밀번호 로그 출력 금지
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db/schema";

const PRODUCTION_REF = "mrgkiussgbbmxfnkjgqy";
const STAGING_REF    = "cbpaxrvrqczqefjoykge"; // swimnote-staging-free
const BACKUP_REF     = "uznwvkuqmvuahpsltqrr";

// ── Migration imports (same as staging-manifest) ───────────────────────────
import { initCoreTablesSchema }          from "./pool-db-core-tables.js";
import { runBaseManualMigration }        from "./pool-db-base-manual-init.js";
import { initPoolDb }                    from "./pool-db-init.js";
import { run as runRuntimeDdlConsolidated } from "./runtime-ddl-consolidated.js";
import { initMembershipSchema }          from "./pool-db-membership.js";
import { initXModeSchema, initXModePart2Schema } from "./pool-db-x-init.js";
import { initXPaymentSchema }            from "./pool-db-x-payment-init.js";
import { runXBillingContractMigration }  from "./pool-db-x-billing-contract.js";
import { runXLifecycleMigration }        from "./pool-db-x-lifecycle.js";
import { runXSetupMigration }            from "./pool-db-x-setup.js";
import { runGrInteractionsMigration }    from "./pool-db-x-gr-interactions-init.js";
import { runX04Migration }               from "./pool-db-x04.js";
import { runCs05rMigration }             from "./pool-db-cs-05r.js";
import { runCs12Migration }              from "./pool-db-cs-12.js";
import { runCs15Migration }              from "./pool-db-cs-15.js";
import { runCs16Migration }              from "./pool-db-cs-16.js";
import { runCs23aMigration }             from "./pool-db-cs-23a.js";
import { runCs24aMigration }             from "./pool-db-cs-24a.js";
import { runCs24bMigration }             from "./pool-db-cs-24b.js";
import { runCs26Migration }              from "./pool-db-cs-26.js";
import { runCsPa0Migration }             from "./pool-db-cs-pa0.js";
import { initSuperDb }                   from "./super-db-init.js";
import { initGrowthReportGR1Schema }     from "./growth-report-gr1-init.js";
import { runGr1bMigration }              from "./growth-report-gr1b-data-accumulating.js";
import { initGrowthReportGR3Schema }     from "./growth-report-gr3-engine-init.js";
import { initGrowthReportGR5Schema }     from "./growth-report-gr5-review-init.js";
import { runMigration as runWp8Crm }     from "./wp8-support-case-crm.js";
import { up as runWp8aLifecycle }        from "./step-wp8-a-lifecycle.js";
import { up as runWp8bBatchJobs }        from "./step-wp8-b-batch-jobs.js";
import { up as runStep0Kpi }             from "./step0-monthly-kpi-foundation.js";
import { runWp6Wp7AdditiveSchema }       from "./wp6-wp7-additive-schema.js";
import { backfillPoolAdminRoles }        from "./roles-backfill.js";

type MigrationDb = ReturnType<typeof drizzle<typeof schema>>;
type MigrationFn = (db: MigrationDb) => Promise<void>;

async function runStep(label: string, fn: MigrationFn, db: MigrationDb): Promise<void> {
  console.log(`\n[backup-manifest] ▶ ${label}...`);
  try {
    await fn(db);
    console.log(`[backup-manifest] ✅ ${label} complete`);
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (
      msg.includes("already exists") ||
      msg.includes("duplicate_object") ||
      msg.includes("42P07") ||
      msg.includes("42710")
    ) {
      console.log(`[backup-manifest] ⏩ ${label} skipped (already exists)`);
    } else {
      console.error(`[backup-manifest] ⚠ ${label} error: ${msg.slice(0, 200)}`);
    }
  }
}

async function main() {
  // Gate 1: mutation flag
  if (process.env.ALLOW_BACKUP_DB_MUTATIONS !== "true") {
    console.error("🚫 BLOCKED: ALLOW_BACKUP_DB_MUTATIONS is not 'true'.");
    process.exit(1);
  }

  // Gate 2: URL presence
  const backupUrl = process.env.SUPABASE_BACKUP_DATABASE_URL;
  if (!backupUrl) {
    console.error("🚫 BLOCKED: SUPABASE_BACKUP_DATABASE_URL is not set.");
    process.exit(1);
  }

  // Gate 3: ref validation
  let ref: string | null = null;
  try {
    const username = new URL(backupUrl).username;
    const m = username.match(/^postgres\.([a-z0-9]+)$/);
    ref = m ? m[1] : null;
  } catch {}
  if (!ref) { console.error("🚫 BLOCKED: Cannot extract ref from SUPABASE_BACKUP_DATABASE_URL."); process.exit(1); }
  if (ref === PRODUCTION_REF) { console.error("🚫 BLOCKED: URL points to PRODUCTION — abort."); process.exit(1); }
  if (ref === STAGING_REF)    { console.error("🚫 BLOCKED: URL points to STAGING — use staging-manifest for staging."); process.exit(1); }
  if (ref !== BACKUP_REF)     { console.error(`🚫 BLOCKED: Unknown ref '${ref}'. Expected backup ref.`); process.exit(1); }

  console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║      SWIMNOTE BACKUP DB BOOTSTRAP (backup-manifest)          ║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝`);
  console.log(`[backup-manifest] Backup ref confirmed: ${ref}`);

  // Connect
  const pool = new pg.Pool({
    connectionString: backupUrl,
    ssl: { rejectUnauthorized: false },
    max: 3,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000,
  });

  try {
    const r = await pool.query("SELECT current_database() AS db, version()");
    console.log(`[backup-manifest] Connected: ${r.rows[0].db} — ${r.rows[0].version.split(" ").slice(0, 2).join(" ")}`);
  } catch (e: any) {
    console.error("[backup-manifest] ❌ Connection failed:", e.message);
    await pool.end();
    process.exit(1);
  }

  const db = drizzle(pool, { schema }) as MigrationDb;

  try {
    const { sql } = await import("drizzle-orm");
    const countBefore = (await db.execute(sql.raw(
      "SELECT COUNT(*) cnt FROM information_schema.tables WHERE table_schema='public'"
    ))).rows[0]?.cnt;
    console.log(`[backup-manifest] Tables before: ${countBefore}`);

    await runStep("§-1 pool-db-core-tables",           initCoreTablesSchema,          db);
    await runStep("§0  pool-db-base-manual-init",      runBaseManualMigration,        db);
    await runStep("§1  pool-db-init",                  initPoolDb,                    db);
    await runStep("§2  runtime-ddl-consolidated",      runRuntimeDdlConsolidated,     db);
    await runStep("§2b pool-db-membership",            initMembershipSchema,          db);
    await runStep("§3a  pool-db-x-init Part1",         initXModeSchema,               db);
    await runStep("§3a2 pool-db-x-init Part2",         initXModePart2Schema,          db);
    await runStep("§3b pool-db-x-payment-init",        initXPaymentSchema,            db);
    await runStep("§3c pool-db-x-billing-contract",    runXBillingContractMigration,  db);
    await runStep("§3d pool-db-x-lifecycle",           runXLifecycleMigration,        db);
    await runStep("§3e pool-db-x-setup",               runXSetupMigration,            db);
    await runStep("§3f pool-db-x-gr-interactions",     runGrInteractionsMigration,    db);
    await runStep("§3g pool-db-x04",                   runX04Migration,               db);
    await runStep("§4a pool-db-cs-pa0",                runCsPa0Migration,             db);
    await runStep("§4b pool-db-cs-05r",                runCs05rMigration,             db);
    await runStep("§4c pool-db-cs-12",                 runCs12Migration,              db);
    await runStep("§4d pool-db-cs-15",                 runCs15Migration,              db);
    await runStep("§4e pool-db-cs-16",                 runCs16Migration,              db);
    await runStep("§4f pool-db-cs-23a",                runCs23aMigration,             db);
    await runStep("§4g pool-db-cs-24a",                runCs24aMigration,             db);
    await runStep("§4h pool-db-cs-24b",                runCs24bMigration,             db);
    await runStep("§4i pool-db-cs-26",                 runCs26Migration,              db);
    await runStep("§5a super-db-init",                 initSuperDb,                   db);
    await runStep("§5b growth-report-gr1-init",        initGrowthReportGR1Schema,     db);
    await runStep("§5c growth-report-gr1b",            runGr1bMigration,              db);
    await runStep("§5d growth-report-gr3-engine",      initGrowthReportGR3Schema,     db);
    await runStep("§5e growth-report-gr5-review",      initGrowthReportGR5Schema,     db);
    await runStep("§6a wp8-support-case-crm",          runWp8Crm,                     db);
    await runStep("§6b step-wp8-a-lifecycle",          runWp8aLifecycle,              db);
    await runStep("§6c step-wp8-b-batch-jobs",         runWp8bBatchJobs,              db);
    await runStep("§6d step0-monthly-kpi-foundation",  runStep0Kpi,                   db);
    await runStep("§7  wp6-wp7-additive-schema",       runWp6Wp7AdditiveSchema,       db);
    await runStep("§8  roles-backfill",                backfillPoolAdminRoles,        db);

    // Create backup_runs metadata table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS backup_runs (
        id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        completed_at     TIMESTAMPTZ,
        source_project   TEXT NOT NULL,
        snapshot_id      TEXT NOT NULL,
        status           TEXT NOT NULL DEFAULT 'RUNNING',
        table_count      INTEGER,
        row_count_summary JSONB,
        verification_status TEXT,
        error_summary    TEXT
      )
    `);
    console.log("[backup-manifest] ✅ backup_runs metadata table ready");

    const countAfter = (await db.execute((await import("drizzle-orm")).sql.raw(
      "SELECT COUNT(*) cnt FROM information_schema.tables WHERE table_schema='public'"
    ))).rows[0]?.cnt;
    console.log(`[backup-manifest] Tables after: ${countAfter}`);

  } finally {
    await pool.end();
    console.log("[backup-manifest] Connection closed");
  }

  console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║              BACKUP DB BOOTSTRAP COMPLETE                    ║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝`);
}

main().catch((e) => {
  console.error("[backup-manifest] FATAL:", e.message);
  process.exit(1);
});
