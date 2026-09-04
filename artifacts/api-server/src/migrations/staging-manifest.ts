/**
 * staging-manifest.ts — Staging DB Bootstrap Migration Order
 *
 * 목적:
 *   Empty staging DB → 재현 가능한 schema 구축.
 *   이 파일이 Staging Bootstrap의 단일 진입점.
 *
 * 실행:
 *   ALLOW_TEST_DB_MUTATIONS=true pnpm tsx src/migrations/staging-manifest.ts
 *   또는 src/scripts/staging-bootstrap.ts 경유
 *
 * 제약:
 *   - TEST_DATABASE_URL만 사용 (Production fallback 없음)
 *   - ALLOW_TEST_DB_MUTATIONS=true 필수
 *   - DROP 없음 (additive only)
 *   - 각 migration은 멱등 (재실행 안전)
 *
 * Migration 실행 순서:
 *   §0  base tables (pool-db-base-manual-init.ts)
 *   §1  pool-db-init (base schema: swimming_pools, users, students, etc.)
 *   §2  runtime-ddl-consolidated (members, inquiries, billing, super tables, etc.)
 *   §3  feature migrations (X-mode, growth, WP8 support CRM, etc.)
 *   §4  verification
 */

import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;

// ── Require TEST_DATABASE_URL explicitly ───────────────────────────────────
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  console.error(
    "\n🚫 REFUSING TO MUTATE: TEST_DATABASE_URL NOT CONFIGURED\n" +
    "   Set TEST_DATABASE_URL to the staging Supabase project connection string.\n" +
    "   DO NOT use SUPABASE_DATABASE_URL for staging bootstrap.\n"
  );
  process.exit(1);
}

if (process.env.ALLOW_TEST_DB_MUTATIONS !== "true") {
  console.error(
    "\n🚫 REFUSING TO MUTATE: ALLOW_TEST_DB_MUTATIONS not set to 'true'\n" +
    "   Set ALLOW_TEST_DB_MUTATIONS=true to confirm this is a test database.\n"
  );
  process.exit(1);
}

// ── Connectivity check ─────────────────────────────────────────────────────
async function verifyConnectivity(pool: pg.Pool): Promise<{ host: string; dbName: string; version: string }> {
  const res = await pool.query(
    "SELECT current_database() db, inet_server_addr()::text host, version() ver"
  );
  const row = res.rows[0] as any;
  return { host: row.host, dbName: row.db, version: row.ver.split(" ")[1] };
}

// ── Migration step runner ──────────────────────────────────────────────────
async function runMigrationFile(label: string, filePath: string): Promise<void> {
  console.log(`\n[manifest] Running §${label}...`);
  // Override SUPABASE_DATABASE_URL to point at TEST_DATABASE_URL for migration scripts
  const originalSupabase = process.env.SUPABASE_DATABASE_URL;
  process.env.SUPABASE_DATABASE_URL = testUrl;
  try {
    const mod = await import(filePath);
    const fnName = Object.keys(mod).find(k => typeof mod[k] === "function");
    if (fnName) {
      await mod[fnName]();
    }
    console.log(`[manifest] ✅ ${label} complete`);
  } catch (e: any) {
    console.error(`[manifest] ⚠ ${label} error: ${e.message}`);
    // Non-fatal: continue to next migration
  } finally {
    if (originalSupabase !== undefined) {
      process.env.SUPABASE_DATABASE_URL = originalSupabase;
    } else {
      delete process.env.SUPABASE_DATABASE_URL;
    }
  }
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║         SWIMNOTE STAGING BOOTSTRAP (staging-manifest)        ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // Override env so @workspace/db uses TEST_DATABASE_URL
  const originalSupabase = process.env.SUPABASE_DATABASE_URL;
  process.env.SUPABASE_DATABASE_URL = testUrl!;

  const pool = new Pool({
    connectionString: testUrl,
    ssl: { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 15000,
  });

  // ── Step 0: Connectivity ──────────────────────────────────────────────────
  console.log("[manifest] §0 Connectivity check...");
  const { host, dbName, version } = await verifyConnectivity(pool);
  console.log(`  DB:      ${dbName}`);
  console.log(`  Host:    ${host}`);
  console.log(`  Version: ${version}`);

  // Production host guard (belt-and-suspenders)
  if (/^2406:da1a:/.test(host)) {
    console.error("\n🚫 ABORT: Host matches Production IPv6 prefix. Cannot bootstrap production DB.\n");
    await pool.end();
    process.exit(1);
  }

  // ── Step 1: Count initial tables ────────────────────────────────────────
  const beforeTables = await pool.query(
    "SELECT COUNT(*) cnt FROM information_schema.tables WHERE table_schema = 'public'"
  );
  const tablesBefore = parseInt((beforeTables.rows[0] as any).cnt);
  console.log(`\n[manifest] Initial table count: ${tablesBefore}`);

  await pool.end();

  // ── Step 2: Run migrations in order ─────────────────────────────────────
  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  const migrations: Array<{ label: string; path: string }> = [
    { label: "pool-db-base-manual-init",       path: path.join(__dirname, "pool-db-base-manual-init.js") },
    { label: "pool-db-init (base schema)",     path: path.join(__dirname, "pool-db-init.js") },
    { label: "runtime-ddl-consolidated",       path: path.join(__dirname, "runtime-ddl-consolidated.js") },
    { label: "pool-db-membership",             path: path.join(__dirname, "pool-db-membership.js") },
    { label: "pool-db-x-init",                path: path.join(__dirname, "pool-db-x-init.js") },
    { label: "pool-db-x-billing-contract",    path: path.join(__dirname, "pool-db-x-billing-contract.js") },
    { label: "pool-db-x-lifecycle",           path: path.join(__dirname, "pool-db-x-lifecycle.js") },
    { label: "pool-db-x-setup",               path: path.join(__dirname, "pool-db-x-setup.js") },
    { label: "pool-db-x-gr-interactions",     path: path.join(__dirname, "pool-db-x-gr-interactions-init.js") },
    { label: "pool-db-x04",                   path: path.join(__dirname, "pool-db-x04.js") },
    { label: "pool-db-cs-05r",                path: path.join(__dirname, "pool-db-cs-05r.js") },
    { label: "pool-db-cs-12",                 path: path.join(__dirname, "pool-db-cs-12.js") },
    { label: "pool-db-cs-15",                 path: path.join(__dirname, "pool-db-cs-15.js") },
    { label: "pool-db-cs-16",                 path: path.join(__dirname, "pool-db-cs-16.js") },
    { label: "pool-db-cs-23a",                path: path.join(__dirname, "pool-db-cs-23a.js") },
    { label: "pool-db-cs-24a",                path: path.join(__dirname, "pool-db-cs-24a.js") },
    { label: "pool-db-cs-24b",                path: path.join(__dirname, "pool-db-cs-24b.js") },
    { label: "pool-db-cs-26",                 path: path.join(__dirname, "pool-db-cs-26.js") },
    { label: "pool-db-cs-pa0",               path: path.join(__dirname, "pool-db-cs-pa0.js") },
    { label: "super-db-init",                 path: path.join(__dirname, "super-db-init.js") },
    { label: "growth-report migrations",       path: path.join(__dirname, "pool-db-x-payment-init.js") },
    { label: "wp8-support-case-crm",          path: path.join(__dirname, "wp8-support-case-crm.js") },
  ];

  for (const m of migrations) {
    await runMigrationFile(m.label, m.path);
  }

  // ── Step 3: Verify final table count ────────────────────────────────────
  const verifyPool = new Pool({
    connectionString: testUrl,
    ssl: { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 15000,
  });

  const afterTables = await verifyPool.query(
    "SELECT COUNT(*) cnt FROM information_schema.tables WHERE table_schema = 'public'"
  );
  const tablesAfter = parseInt((afterTables.rows[0] as any).cnt);

  const keyTables = await verifyPool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  const tableList = (keyTables.rows as any[]).map(r => r.table_name);

  await verifyPool.end();

  // Restore env
  if (originalSupabase !== undefined) {
    process.env.SUPABASE_DATABASE_URL = originalSupabase;
  } else {
    delete process.env.SUPABASE_DATABASE_URL;
  }

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║                     BOOTSTRAP COMPLETE                      ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`\n  Tables before: ${tablesBefore}`);
  console.log(`  Tables after:  ${tablesAfter}`);
  console.log(`  New tables:    ${tablesAfter - tablesBefore}`);
  console.log(`\n  All tables (${tableList.length}):`);
  tableList.forEach(t => console.log(`    - ${t}`));

  const REQUIRED = [
    "swimming_pools", "users", "students", "class_groups",
    "notifications", "push_logs", "support_cases", "audit_logs",
    "revenue_logs", "subscription_plans", "feature_flags",
    "event_logs", "inquiries", "parent_request_messages",
    "support_ticket_replies", "system_policies", "pool_credits",
  ];
  const missing = REQUIRED.filter(t => !tableList.includes(t));
  if (missing.length > 0) {
    console.error(`\n⚠ Missing expected tables: ${missing.join(", ")}`);
  } else {
    console.log("\n  ✅ All required tables present");
  }
}

main().catch((e) => {
  console.error("[manifest] FATAL:", e.message);
  process.exit(1);
});
