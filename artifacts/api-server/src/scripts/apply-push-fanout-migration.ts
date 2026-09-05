/**
 * apply-push-fanout-migration.ts
 * Staging-only migration script for push_fanout_jobs + push_fanout_deliveries
 *
 * Usage:
 *   ALLOW_TEST_DB_MUTATIONS=true pnpm --filter @workspace/api-server exec \
 *     tsx src/scripts/apply-push-fanout-migration.ts
 */
import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { sql as drizzleSql } from "drizzle-orm";
import { getMigrationDb } from "../lib/migration-db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SQL_FILE = path.resolve(
  __dirname,
  "../../migrations/2026-09-05-push-fanout-queue.sql",
);

async function main(): Promise<void> {
  console.log("=== Push Fan-out Migration (Staging only) ===");
  console.log(`SQL file: ${SQL_FILE}`);

  if (!fs.existsSync(SQL_FILE)) {
    throw new Error(`Migration SQL file not found: ${SQL_FILE}`);
  }
  const sql = fs.readFileSync(SQL_FILE, "utf8");

  const { db, close } = await getMigrationDb("push-fanout-migration");
  try {
    // ── Apply migration ────────────────────────────────────────────────────
    console.log("\n[1/4] Applying migration SQL ...");
    await db.execute(drizzleSql.raw(sql));
    console.log("  → Done");

    // ── Verify tables ──────────────────────────────────────────────────────
    console.log("\n[2/4] Verifying push_fanout_jobs table ...");
    const jobs = await db.execute(drizzleSql.raw(`SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'push_fanout_jobs'
            ORDER BY ordinal_position`));
    if (!jobs.rows.length) throw new Error("push_fanout_jobs table missing");
    console.log(`  → ${jobs.rows.length} columns: ${(jobs.rows as any[]).map((r: any) => r.column_name).join(", ")}`);

    console.log("\n[3/4] Verifying push_fanout_deliveries table ...");
    const deliveries = await db.execute(drizzleSql.raw(`SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'push_fanout_deliveries'
            ORDER BY ordinal_position`));
    if (!deliveries.rows.length) throw new Error("push_fanout_deliveries table missing");
    console.log(`  → ${deliveries.rows.length} columns: ${(deliveries.rows as any[]).map((r: any) => r.column_name).join(", ")}`);

    // Verify UNIQUE constraint
    console.log("\n[3b] Verifying UNIQUE constraints ...");
    const constraints = await db.execute(drizzleSql.raw(`SELECT conname, contype, conrelid::regclass AS table_name
            FROM pg_constraint
            WHERE conrelid::regclass::text IN ('push_fanout_jobs','push_fanout_deliveries')`));
    for (const c of constraints.rows as any[]) {
      console.log(`  constraint: ${c.conname} (${c.contype}) on ${c.table_name}`);
    }
    const hasJobPk       = (constraints.rows as any[]).some((c: any) => c.conname === "push_fanout_jobs_pkey");
    const hasDeliveryUniq = (constraints.rows as any[]).some((c: any) => c.conname === "push_fanout_delivery_uniq");
    if (!hasJobPk)        throw new Error("push_fanout_jobs PRIMARY KEY missing");
    if (!hasDeliveryUniq) throw new Error("push_fanout_deliveries UNIQUE (job_ref, push_token_id) missing");
    console.log("  → PRIMARY KEY on push_fanout_jobs: OK");
    console.log("  → UNIQUE on push_fanout_deliveries: OK");

    // ── Second-run idempotency ─────────────────────────────────────────────
    console.log("\n[4/4] Second-run idempotency (re-run migration SQL) ...");
    await db.execute(drizzleSql.raw(sql));
    console.log("  → Second run: OK (IF NOT EXISTS clauses are idempotent)");

    // Verify existing data preserved (tables should still be empty since staging)
    const jobCount = await db.execute(drizzleSql.raw("SELECT COUNT(*) AS n FROM push_fanout_jobs"));
    console.log(`  → push_fanout_jobs rows: ${(jobCount.rows[0] as any).n} (should be 0 on fresh staging)`);

    console.log("\n✅ Migration PASS — Staging (lspmacdbyvpzysnrjsww) only. Production NOT touched.\n");
  } finally {
    await close();
  }
}

main().catch(e => {
  console.error("\n❌ Migration FAILED:", e.message ?? e);
  process.exit(1);
});
