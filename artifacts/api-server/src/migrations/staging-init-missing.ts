/**
 * staging-init-missing.ts — Staging 누락 테이블 보완 스크립트
 *
 * 목적:
 *   staging-manifest 1차 실행 후 superAdminDb 캐싱 문제로
 *   생성되지 않은 테이블들을 fresh process에서 생성.
 *
 * 실행:
 *   SUPABASE_DATABASE_URL="$TEST_DATABASE_URL" ALLOW_TEST_DB_MUTATIONS=true \
 *   npx tsx src/migrations/staging-init-missing.ts
 *
 * 제약:
 *   - SUPABASE_DATABASE_URL 반드시 staging URL로 설정 후 실행
 *   - 이 스크립트 실행 시 @workspace/db가 staging DB를 가리킴
 */

// NOTE: 이 파일은 반드시 SUPABASE_DATABASE_URL=staging 설정 후 실행할 것.
// top-level import 이전에 env를 확인한다.
const stagingUrl = process.env.SUPABASE_DATABASE_URL;
const allowMutations = process.env.ALLOW_TEST_DB_MUTATIONS;

if (!stagingUrl) {
  console.error("🚫 SUPABASE_DATABASE_URL not set. Run with SUPABASE_DATABASE_URL=$TEST_DATABASE_URL");
  process.exit(1);
}
if (allowMutations !== "true") {
  console.error("🚫 ALLOW_TEST_DB_MUTATIONS must be 'true'");
  process.exit(1);
}

// Verify it's staging (not production) by project ref
const refMatch = new URL(stagingUrl).username.match(/^postgres\.([a-z0-9]+)$/);
const ref = refMatch?.[1];
const KNOWN_STAGING_REFS = new Set(["lspmacdbyvpzysnrjsww"]);
if (!ref || !KNOWN_STAGING_REFS.has(ref)) {
  console.error(`🚫 SUPABASE_DATABASE_URL does not point to a known staging project (ref=${ref})`);
  process.exit(1);
}

console.log(`\n[staging-init-missing] Staging ref: ${ref} ✅`);
console.log(`[staging-init-missing] Importing migrations...\n`);

// ── imports after env check ───────────────────────────────────────────────────
import { initPoolDb } from "./pool-db-init.js";
import { runCsPa0Migration } from "./pool-db-cs-pa0.js";
import { initXModeSchema } from "./pool-db-x-init.js";
import { runXSetupMigration } from "./pool-db-x-setup.js";
import { initXPaymentSchema } from "./pool-db-x-payment-init.js";
import { runBaseManualMigration } from "./pool-db-base-manual-init.js";
// wp8-support-case-crm is self-executing — handled via inline pg below

async function runStep(label: string, fn: () => Promise<void>) {
  console.log(`\n[step] ${label}...`);
  try {
    await fn();
    console.log(`[step] ✅ ${label} done`);
  } catch (e: any) {
    console.error(`[step] ❌ ${label} error: ${e.message}`);
    // non-fatal: continue
  }
}

async function main() {
  console.log("═".repeat(60));
  console.log("STAGING INIT MISSING — Supplementary migration");
  console.log("═".repeat(60));

  // pool-db-base-manual-init: push_logs, notifications, etc.
  await runStep("pool-db-base-manual-init", runBaseManualMigration);

  // pool-db-init: swimming_pools, users, diary_entries, etc.
  await runStep("pool-db-init (swimming_pools / users / diary_entries)", initPoolDb);

  // pool-db-x-init: audit_logs, ai_traces, curriculum_items, growth_events
  await runStep("pool-db-x-init (audit_logs / curriculum_items / ai_traces)", initXModeSchema);

  // pool-db-cs-pa0: support_cases, support_knowledge_items
  await runStep("pool-db-cs-pa0 (support_cases)", runCsPa0Migration);

  // wp8-support-case-crm: support_case_notes + WP8 columns (inline pg)
  await runStep("wp8-support-case-crm (support_case_notes)", async () => {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: stagingUrl!, ssl: { rejectUnauthorized: false }, max: 1 });
    const exec = async (sql: string) => { try { await pool.query(sql); } catch (e: any) { /* IF NOT EXISTS — non-fatal */ } };
    await exec(`ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS title TEXT`);
    await exec(`ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS category TEXT`);
    await exec(`ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS subject_type TEXT`);
    await exec(`ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS subject_id TEXT`);
    await exec(`ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS assigned_operator TEXT`);
    await exec(`ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS resolution TEXT`);
    await exec(`ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS ops_status TEXT DEFAULT 'OPEN'`);
    await exec(`ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS created_by_admin TEXT`);
    await exec(`ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ`);
    await exec(`ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS ticket_id TEXT`);
    await exec(`CREATE TABLE IF NOT EXISTS support_case_notes (
      id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      case_id      TEXT NOT NULL REFERENCES support_cases(id),
      note         TEXT NOT NULL,
      event_type   TEXT NOT NULL DEFAULT 'NOTE_ADDED',
      operator_id  TEXT,
      metadata     JSONB,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await exec(`CREATE INDEX IF NOT EXISTS sc_pool_status_idx  ON support_cases(pool_id, ops_status)`);
    await exec(`CREATE INDEX IF NOT EXISTS sc_pool_created_idx ON support_cases(pool_id, created_at DESC)`);
    await exec(`CREATE INDEX IF NOT EXISTS sc_ticket_idx       ON support_cases(ticket_id)`);
    await exec(`CREATE INDEX IF NOT EXISTS scn_case_idx        ON support_case_notes(case_id, created_at)`);
    await pool.end();
  });

  // pool-db-x-setup: x_setup_submissions, x_setup_files
  await runStep("pool-db-x-setup (x_setup_submissions / x_setup_files)", runXSetupMigration);

  // pool-db-x-payment: growth_report_cycles, growth_report_batch_jobs, x_monthly_operational_snapshots
  await runStep("pool-db-x-payment (growth_report_cycles / batch_jobs / x_monthly_snapshots)", initXPaymentSchema);

  console.log("\n[staging-init-missing] Complete. Run table check next.");
}

main().catch(e => {
  console.error("[staging-init-missing] FATAL:", e.message);
  process.exit(1);
});
