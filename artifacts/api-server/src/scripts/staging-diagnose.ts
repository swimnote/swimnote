/**
 * staging-diagnose.ts — Staging DB 현황 진단 (read-only)
 *
 * 실행:
 *   ALLOW_TEST_DB_MUTATIONS=true npx tsx src/scripts/staging-diagnose.ts
 */
import pg from "pg";

const PROD_REF     = "mrgkiussgbbmxfnkjgqy";
const STAGING_REFS = new Set(["lspmacdbyvpzysnrjsww"]);

const testUrl = process.env.TEST_DATABASE_URL!;
const ref = new URL(testUrl).username.match(/^postgres\.([a-z0-9]+)$/)?.[1];
if (!ref || ref === PROD_REF || !STAGING_REFS.has(ref)) {
  console.error("🚫 BLOCK: Production or unknown ref. Abort."); process.exit(1);
}

const pool = new pg.Pool({ connectionString: testUrl, ssl: { rejectUnauthorized: false }, max: 1 });
const q = async (sql: string, params: any[] = []) => (await pool.query(sql, params)).rows;

console.log(`\n[staging-diagnose] ref: ${ref}`);

// Table count
const tables = await q(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
console.log(`\n=== Tables (${tables.length}) ===`);
tables.forEach((r: any) => console.log(`  ${r.tablename}`));

// Enums
const enums = await q(`SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e' ORDER BY t.typname`);
console.log(`\n=== Enums (${enums.length}) ===`);
enums.forEach((r: any) => console.log(`  ${r.typname}`));

// Check specific tables from expected list
const EXPECTED = [
  "swimming_pools","users","students","members","class_groups","notifications","push_logs",
  "support_cases","support_case_notes","audit_logs","event_logs","ai_traces","growth_reports",
  "growth_report_cycles","growth_report_batch_jobs","x_monthly_operational_snapshots",
  "x_setup_submissions","x_setup_files","x_curriculum_class_assignments","revenue_logs",
  "diary_entries","parent_accounts","curriculum_items","class_diaries","inquiries",
  "inquiry_replies","parent_request_messages","support_ticket_replies","subscription_plans",
  "pool_subscriptions","system_policies","pool_credits","parent_v2_pending",
  "support_knowledge_items","support_tickets",
];
const tableSet = new Set(tables.map((r: any) => r.tablename));

console.log(`\n=== Missing expected tables ===`);
const missing = EXPECTED.filter(t => !tableSet.has(t));
missing.forEach(t => console.log(`  MISSING: ${t}`));
if (missing.length === 0) console.log("  (none)");

// Check expected columns
console.log(`\n=== swimming_pools X columns ===`);
const spCols = await q(`SELECT column_name FROM information_schema.columns WHERE table_name='swimming_pools' AND column_name LIKE 'x_%' ORDER BY column_name`);
spCols.forEach((r: any) => console.log(`  ${r.column_name}`));

if (tableSet.has("event_logs")) {
  console.log(`\n=== event_logs extra columns ===`);
  const elCols = await q(`SELECT column_name FROM information_schema.columns WHERE table_name='event_logs' AND column_name IN ('feature','level','error_code','safe_message','request_id') ORDER BY column_name`);
  elCols.forEach((r: any) => console.log(`  ${r.column_name}`));
}

if (tableSet.has("push_logs")) {
  console.log(`\n=== push_logs extra columns ===`);
  const plCols = await q(`SELECT column_name FROM information_schema.columns WHERE table_name='push_logs' AND column_name IN ('pool_id','error_message','recipient_count','notification_id') ORDER BY column_name`);
  plCols.forEach((r: any) => console.log(`  ${r.column_name}`));
}

// Check indexes
console.log(`\n=== Expected indexes ===`);
for (const idx of ["idx_event_logs_pool_level","idx_push_logs_pool_status","idx_push_logs_notification_id"]) {
  const found = await q(`SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=$1`, [idx]);
  console.log(`  ${idx}: ${found.length > 0 ? 'EXISTS' : 'MISSING'}`);
}

// Try the failing queries
console.log(`\n=== Probing failing queries ===`);

// cs-pa0: support_cases
try {
  await pool.query(`CREATE TABLE IF NOT EXISTS support_cases (id TEXT PRIMARY KEY, pool_id TEXT REFERENCES swimming_pools(id), actor_role TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'NEW', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  console.log("  support_cases CREATE: OK");
  await pool.query(`DROP TABLE IF EXISTS support_cases`);
} catch (e: any) { console.log(`  support_cases CREATE: FAIL — ${e.message}`); }

// x_monthly_operational_snapshots (without swimming_pools FK if table exists)
if (tableSet.has("swimming_pools")) {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS _diag_x_monthly_test (id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, swimming_pool_id TEXT NOT NULL REFERENCES swimming_pools(id), year SMALLINT NOT NULL, month SMALLINT NOT NULL, UNIQUE (swimming_pool_id, year, month))`);
    console.log("  x_monthly_operational_snapshots CREATE: OK");
    await pool.query(`DROP TABLE IF EXISTS _diag_x_monthly_test`);
  } catch (e: any) { console.log(`  x_monthly_operational_snapshots CREATE: FAIL — ${e.message}`); }
}

// push_logs (from push-service.ts schema)
try {
  await pool.query(`CREATE TABLE IF NOT EXISTS push_logs (id TEXT PRIMARY KEY, target_user_id TEXT, role TEXT, type TEXT, status TEXT, message TEXT, triggered_by TEXT, created_at TIMESTAMPTZ DEFAULT now())`);
  console.log("  push_logs CREATE: OK");
  await pool.query(`DROP TABLE IF EXISTS push_logs`);
} catch (e: any) { console.log(`  push_logs CREATE: FAIL — ${e.message}`); }

await pool.end();
console.log("\n[staging-diagnose] Done.");
