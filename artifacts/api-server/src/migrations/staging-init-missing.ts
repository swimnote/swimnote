/**
 * staging-init-missing.ts — Staging 누락 테이블 보완 스크립트
 *
 * 목적:
 *   staging-manifest 1차 실행 후 생성되지 않은 테이블들을
 *   fresh process에서 TEST_DATABASE_URL 기반으로 생성.
 *
 * 실행:
 *   ALLOW_TEST_DB_MUTATIONS=true npx tsx src/migrations/staging-init-missing.ts
 *
 * 제약:
 *   - getMigrationDb()를 통해 TEST_DATABASE_URL만 사용
 *   - SUPABASE_DATABASE_URL 덮어쓰기 금지
 *   - ALLOW_TEST_DB_MUTATIONS=true 필수
 *   - Production ref 자동 BLOCK
 */

import { getMigrationDb } from "../lib/migration-db.js";

import { initPoolDb }           from "./pool-db-init.js";
import { runCsPa0Migration }    from "./pool-db-cs-pa0.js";
import { initXModeSchema }      from "./pool-db-x-init.js";
import { runXSetupMigration }   from "./pool-db-x-setup.js";
import { initXPaymentSchema }   from "./pool-db-x-payment-init.js";
import { runBaseManualMigration } from "./pool-db-base-manual-init.js";

import type { MigrationDb } from "../lib/migration-db.js";

async function runStep(label: string, fn: (db: MigrationDb) => Promise<void>, db: MigrationDb) {
  console.log(`\n[step] ${label}...`);
  try {
    await fn(db);
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

  const { db, close } = await getMigrationDb("staging-init-missing");

  try {
    // pool-db-base-manual-init: push_logs, notifications, etc.
    await runStep("pool-db-base-manual-init", runBaseManualMigration, db);

    // pool-db-init: swimming_pools, users, diary_entries, etc.
    await runStep("pool-db-init (swimming_pools / users / diary_entries)", initPoolDb, db);

    // pool-db-x-init: audit_logs, ai_traces, curriculum_items, growth_events
    await runStep("pool-db-x-init (audit_logs / curriculum_items / ai_traces)", initXModeSchema, db);

    // pool-db-cs-pa0: support_cases, support_knowledge_items
    await runStep("pool-db-cs-pa0 (support_cases)", runCsPa0Migration, db);

    // wp8-support-case-crm: support_case_notes + WP8 columns (inline pg)
    await runStep("wp8-support-case-crm (support_case_notes)", async (db_: MigrationDb) => {
      const { sql } = await import("drizzle-orm");
      const alters = [
        `ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS title TEXT`,
        `ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS category TEXT`,
        `ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS subject_type TEXT`,
        `ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS subject_id TEXT`,
        `ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS assigned_operator TEXT`,
        `ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS resolution TEXT`,
        `ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS ops_status TEXT DEFAULT 'OPEN'`,
        `ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS created_by_admin TEXT`,
        `ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ`,
        `CREATE TABLE IF NOT EXISTS support_case_notes (
          id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          case_id      TEXT NOT NULL REFERENCES support_cases(id),
          note         TEXT NOT NULL,
          event_type   TEXT NOT NULL DEFAULT 'NOTE_ADDED',
          operator_id  TEXT,
          metadata     JSONB,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS sc_pool_status_idx  ON support_cases(pool_id, ops_status)`,
        `CREATE INDEX IF NOT EXISTS sc_pool_created_idx ON support_cases(pool_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS sc_ticket_idx       ON support_cases(ticket_id)`,
        `CREATE INDEX IF NOT EXISTS scn_case_idx        ON support_case_notes(case_id, created_at)`,
      ];
      for (const ddl of alters) {
        await db_.execute(sql.raw(ddl)).catch(() => { /* IF NOT EXISTS — non-fatal */ });
      }
    }, db);

    // pool-db-x-setup: x_setup_submissions, x_setup_files
    await runStep("pool-db-x-setup (x_setup_submissions / x_setup_files)", runXSetupMigration, db);

    // pool-db-x-payment: growth_report_cycles, batch_jobs, x_monthly_snapshots
    await runStep("pool-db-x-payment (growth_report_cycles / batch_jobs / x_monthly_snapshots)", initXPaymentSchema, db);

  } finally {
    await close();
  }

  console.log("\n[staging-init-missing] Complete. Run table check next.");
}

main().catch(e => {
  console.error("[staging-init-missing] FATAL:", e.message);
  process.exit(1);
});
