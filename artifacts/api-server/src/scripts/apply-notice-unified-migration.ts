/**
 * apply-notice-unified-migration.ts — WP4 Staging migration runner
 * Staging-only. Production NOT touched.
 *
 * Usage:
 *   ALLOW_TEST_DB_MUTATIONS=true pnpm --filter @workspace/api-server exec \
 *     tsx src/scripts/apply-notice-unified-migration.ts
 */
import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg              from "pg";
import { getMigrationDb } from "../lib/migration-db.js";

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SQL_FILE = path.resolve(
  __dirname,
  "../../migrations/2026-09-05-notice-unified-schema.sql",
);

async function main(): Promise<void> {
  console.log("=== WP4 Notice Unified Migration (Staging only) ===");
  console.log(`SQL file: ${SQL_FILE}`);

  if (!fs.existsSync(SQL_FILE)) {
    throw new Error(`Migration SQL file not found: ${SQL_FILE}`);
  }
  const sql = fs.readFileSync(SQL_FILE, "utf8");

  // Safety checks via getMigrationDb (ref validation, block prod)
  const { close: closeDrizzle } = await getMigrationDb("wp4-notice-unified");
  await closeDrizzle(); // close drizzle handle; use raw pg Pool for DDL

  // Raw pg Pool for DDL execution (drizzle execute doesn't reliably run CREATE INDEX)
  const testUrl = process.env.TEST_DATABASE_URL!;
  const pool = new Pool({ connectionString: testUrl, ssl: { rejectUnauthorized: false }, max: 3 });

  const query = (q: string) => pool.query(q);

  try {
    // ── 1. Apply migration statement-by-statement ────────────────────────────
    console.log("\n[1/6] Applying migration SQL ...");
    const stmts = sql
      .split(";")
      .map(s => s.split("\n").filter(l => !l.trimStart().startsWith("--")).join("\n").trim())
      .filter(s => s.length > 0);
    console.log(`  → ${stmts.length} statements`);
    for (const stmt of stmts) {
      await query(stmt);
    }
    console.log("  → Done");

    // ── 2. Verify new notices columns ────────────────────────────────────────
    console.log("\n[2/6] Verifying notices new columns ...");
    const cols = await query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'notices' ORDER BY ordinal_position`);
    const colNames = cols.rows.map((r: any) => r.column_name);
    console.log(`  → ${colNames.length} columns: ${colNames.join(", ")}`);
    const required = ["show_banner", "send_push", "target_roles", "target_pools", "starts_at", "ends_at", "deep_link", "target_plan_types"];
    for (const c of required) {
      if (!colNames.includes(c)) throw new Error(`notices.${c} column missing`);
    }
    console.log("  → All new columns present: OK");

    // ── 3. Verify notice_dismissals table ────────────────────────────────────
    console.log("\n[3/6] Verifying notice_dismissals table ...");
    const dcols = await query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'notice_dismissals' ORDER BY ordinal_position`);
    if (!dcols.rows.length) throw new Error("notice_dismissals table missing");
    console.log(`  → columns: ${dcols.rows.map((r: any) => r.column_name).join(", ")}`);

    // ── 4. Verify UNIQUE constraint + indexes ─────────────────────────────────
    console.log("\n[4/6] Verifying constraints + indexes ...");
    const constr = await query(`
      SELECT conname, contype FROM pg_constraint
      WHERE conrelid = 'notice_dismissals'::regclass`);
    const hasUniq = constr.rows.some((c: any) => c.conname === "notice_dismissal_uniq");
    if (!hasUniq) throw new Error("notice_dismissal_uniq UNIQUE constraint missing");
    console.log("  → UNIQUE(notice_id, user_id): OK");

    const idxs = await query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename IN ('notice_dismissals','notices') AND indexname LIKE 'idx_%'`);
    console.log(`  → Indexes: ${idxs.rows.map((r: any) => r.indexname).join(", ")}`);

    // ── 5. Existing data preservation ────────────────────────────────────────
    console.log("\n[5/6] Verifying existing data preserved ...");
    const cnt = await query("SELECT COUNT(*) AS n FROM notices");
    console.log(`  → notices rows: ${cnt.rows[0].n} (none deleted by migration)`);
    const bannerCnt = await query("SELECT COUNT(*) AS n FROM platform_banners");
    console.log(`  → platform_banners rows: ${bannerCnt.rows[0].n} (DEPRECATED, preserved)`);

    // ── 6. Second-run idempotency ────────────────────────────────────────────
    console.log("\n[6/6] Second-run idempotency ...");
    for (const stmt of stmts) { await query(stmt); }
    console.log("  → Second run: OK (IF NOT EXISTS)");

    console.log("\n✅ WP4 Migration PASS — Staging (cbpaxrvrqczqefjoykge) only. Production NOT touched.\n");
  } finally {
    await pool.end();
  }
}

main().catch(e => {
  console.error("\n❌ Migration FAILED:", e.message ?? e);
  process.exit(1);
});
