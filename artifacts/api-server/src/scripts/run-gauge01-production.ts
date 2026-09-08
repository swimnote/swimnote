/**
 * run-gauge01-production.ts
 *
 * Production DB에 gauge-01-progress-tables.ts 실행.
 *
 * 실행:
 *   SUPABASE_DATABASE_URL=... pnpm --filter @workspace/api-server exec \
 *     tsx src/scripts/run-gauge01-production.ts
 *
 * 주의:
 *   - SUPABASE_DATABASE_URL 환경변수 필요
 *   - 멱등성: IF NOT EXISTS / DO $$ EXCEPTION WHEN duplicate_object $$
 *   - backfill 별도 스크립트
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db/schema";
import { initGauge01Schema } from "../migrations/gauge-01-progress-tables.js";

const { Pool } = pg;

async function main(): Promise<void> {
  const url = process.env.SUPABASE_DATABASE_URL;
  if (!url) {
    throw new Error("SUPABASE_DATABASE_URL is not set");
  }

  console.log("=== GAUGE-01 Production Migration ===");
  console.log("DB: SUPABASE_DATABASE_URL (redacted)");

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool, { schema });

  try {
    // ── 사전 확인: CPO / SCP 테이블 존재 여부 ─────────────────────────────────
    const beforeCPO = await pool.query(`
      SELECT to_regclass('curriculum_progress_observations') AS tbl
    `);
    const beforeSCP = await pool.query(`
      SELECT to_regclass('student_curriculum_progress') AS tbl
    `);
    console.log("\n[PRE-CHECK]");
    console.log("  curriculum_progress_observations exists:", beforeCPO.rows[0]?.tbl != null);
    console.log("  student_curriculum_progress exists:     ", beforeSCP.rows[0]?.tbl != null);

    // ── Migration 실행 ────────────────────────────────────────────────────────
    console.log("\n[MIGRATE] Running initGauge01Schema ...");
    await initGauge01Schema(db as any);
    console.log("[MIGRATE] Done.");

    // ── 사후 확인: 테이블/컬럼/제약 ─────────────────────────────────────────
    console.log("\n[POST-CHECK] Verifying tables ...");

    const cpoColumns = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'curriculum_progress_observations'
      ORDER BY ordinal_position
    `);
    console.log(`  CPO columns (${cpoColumns.rows.length}):`,
      cpoColumns.rows.map((r: any) => r.column_name).join(", "));

    const scpColumns = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'student_curriculum_progress'
      ORDER BY ordinal_position
    `);
    console.log(`  SCP columns (${scpColumns.rows.length}):`,
      scpColumns.rows.map((r: any) => r.column_name).join(", "));

    // UNIQUE 제약 확인
    const constraints = await pool.query(`
      SELECT conname, contype
      FROM pg_constraint
      WHERE conrelid IN (
        'curriculum_progress_observations'::regclass,
        'student_curriculum_progress'::regclass
      )
      ORDER BY conrelid, conname
    `);
    console.log(`\n  Constraints (${constraints.rows.length}):`);
    for (const r of constraints.rows as any[]) {
      const type = { u: "UNIQUE", c: "CHECK", f: "FK", p: "PK" }[r.contype as string] ?? r.contype;
      console.log(`    ${r.conname} (${type})`);
    }

    // 인덱스 확인
    const indexes = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename IN ('curriculum_progress_observations','student_curriculum_progress')
      ORDER BY tablename, indexname
    `);
    console.log(`\n  Indexes (${indexes.rows.length}):`);
    for (const r of indexes.rows as any[]) {
      console.log(`    ${r.indexname}`);
    }

    // ── 멱등성 검증: 재실행 ───────────────────────────────────────────────────
    console.log("\n[IDEMPOTENCY] Re-running migration (must be no-op) ...");
    await initGauge01Schema(db as any);
    console.log("[IDEMPOTENCY] ✅ No error on re-run.");

    console.log("\n✅ GAUGE-01 Production Migration 완료.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("GAUGE-01 migration FAILED:", err);
  process.exit(1);
});
