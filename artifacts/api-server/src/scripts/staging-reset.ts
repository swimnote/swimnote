/**
 * staging-reset.ts — Staging Public Schema Reset
 *
 * 사용:
 *   ALLOW_TEST_DB_MUTATIONS=true npx tsx src/scripts/staging-reset.ts
 *
 * 안전:
 *   - TEST_DATABASE_URL만 사용 (SUPABASE_DATABASE_URL 무시)
 *   - Production ref(mrgkiussgbbmxfnkjgqy) → BLOCK
 *   - ALLOW_TEST_DB_MUTATIONS≠true → BLOCK
 */

import pg from "pg";

const PROD_REF    = "mrgkiussgbbmxfnkjgqy";
const STAGING_REFS = new Set(["lspmacdbyvpzysnrjsww"]);

// ── Safety gates ────────────────────────────────────────────────────────────
if (process.env.ALLOW_TEST_DB_MUTATIONS !== "true") {
  console.error("🚫 BLOCK: ALLOW_TEST_DB_MUTATIONS must be 'true'"); process.exit(1);
}
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) { console.error("🚫 BLOCK: TEST_DATABASE_URL not set"); process.exit(1); }

function extractRef(url: string): string | null {
  try { return new URL(url).username.match(/^postgres\.([a-z0-9]+)$/)?.[1] ?? null; }
  catch { return null; }
}
const ref = extractRef(testUrl);
if (!ref)                  { console.error("🚫 BLOCK: cannot parse project ref from TEST_DATABASE_URL"); process.exit(1); }
if (ref === PROD_REF)      { console.error(`🚫 BLOCK: TEST_DATABASE_URL points to PRODUCTION ref (${ref}). ABORT.`); process.exit(1); }
if (!STAGING_REFS.has(ref)){ console.error(`🚫 BLOCK: ref '${ref}' not in staging allowlist. ABORT.`); process.exit(1); }

console.log(`\n✅ STAGING GATE PASSED — ref: ${ref}`);

const pool = new pg.Pool({ connectionString: testUrl, ssl: { rejectUnauthorized: false }, max: 1 });

async function query(sql: string, params: any[] = []) {
  const r = await pool.query(sql, params);
  return r.rows;
}

// ── §5 Pre-reset inventory ──────────────────────────────────────────────────
console.log("\n═══ §5 PRE-RESET INVENTORY ═══");
const tablesBefore = await query(`SELECT COUNT(*) cnt FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`);
const viewsBefore  = await query(`SELECT COUNT(*) cnt FROM information_schema.views WHERE table_schema='public'`);
const seqsBefore   = await query(`SELECT COUNT(*) cnt FROM information_schema.sequences WHERE sequence_schema='public'`);
const enumsBefore  = await query(`SELECT COUNT(*) cnt FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e'`);
const idxBefore    = await query(`SELECT COUNT(*) cnt FROM pg_indexes WHERE schemaname='public'`);

console.log(`Tables:    ${tablesBefore[0].cnt}`);
console.log(`Views:     ${viewsBefore[0].cnt}`);
console.log(`Sequences: ${seqsBefore[0].cnt}`);
console.log(`Enums:     ${enumsBefore[0].cnt}`);
console.log(`Indexes:   ${idxBefore[0].cnt}`);

const tableNames = await query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
console.log(`\nAll tables (${tableNames.length}):`);
tableNames.forEach((r:any) => console.log(`  ${r.tablename}`));

// ── §6 RESET ─────────────────────────────────────────────────────────────────
console.log("\n═══ §6 STAGING PUBLIC SCHEMA RESET ═══");
console.log(`Target: staging ref=${ref} — public schema only`);
console.log("Executing DROP SCHEMA public CASCADE; CREATE SCHEMA public; ...");

await pool.query("DROP SCHEMA public CASCADE");
await pool.query("CREATE SCHEMA public");
await pool.query("GRANT ALL ON SCHEMA public TO postgres");
await pool.query("GRANT ALL ON SCHEMA public TO public");

// Restore uuid-ossp extension (needed for gen_random_uuid fallback)
await pool.query("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"").catch(() => {});
await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto").catch(() => {});

// Post-reset check
const tablesAfter = await query(`SELECT COUNT(*) cnt FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`);
const enumsAfter  = await query(`SELECT COUNT(*) cnt FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e'`);

console.log(`\n✅ RESET COMPLETE`);
console.log(`Tables after reset: ${tablesAfter[0].cnt} (expected 0)`);
console.log(`Enums  after reset: ${enumsAfter[0].cnt} (expected 0)`);

if (Number(tablesAfter[0].cnt) !== 0) {
  console.error("⚠ WARNING: tables remain after reset. Manual check required.");
}

await pool.end();
console.log("\n[staging-reset] Done. Proceed with staging-manifest.");
process.exit(0);
