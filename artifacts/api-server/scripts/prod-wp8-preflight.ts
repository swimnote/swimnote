/**
 * prod-wp8-preflight.ts — WP8 Production DB Migration Preflight (READ ONLY)
 * 절대 실행 금지: ALTER, CREATE, DROP, INSERT, UPDATE, DELETE
 */
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

async function q(sqlStr: string) {
  const r = await superAdminDb.execute(sql.raw(sqlStr));
  return r.rows as any[];
}

async function run() {
  console.log("=== 1. GROWTH_REPORTS COLUMNS ===");
  const grCols = await q(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'growth_reports' ORDER BY ordinal_position
  `);
  grCols.forEach(r =>
    console.log(`  ${r.column_name} | ${r.data_type} | null=${r.is_nullable} | default=${r.column_default ?? "NULL"}`)
  );

  console.log("\n=== 2. GR_PRODUCT_STATUS_ENUM VALUES ===");
  const enumVals = await q(`
    SELECT e.enumlabel FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'gr_product_status_enum'
    ORDER BY e.enumsortorder
  `);
  console.log("  values:", enumVals.map(r => r.enumlabel).join(", "));

  console.log("\n=== 3. GROWTH_REPORTS INDEXES ===");
  const grIdx = await q(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename='growth_reports' ORDER BY indexname`);
  grIdx.forEach(r => console.log(`  [${r.indexname}]`));

  console.log("\n=== 4. GROWTH_REPORT_CYCLES ===");
  const grcCols = await q(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='growth_report_cycles' ORDER BY ordinal_position`);
  grcCols.forEach(r => console.log(`  col: ${r.column_name} | ${r.data_type}`));
  const grcIdx = await q(`SELECT indexname FROM pg_indexes WHERE tablename='growth_report_cycles' ORDER BY indexname`);
  grcIdx.forEach(r => console.log(`  idx: ${r.indexname}`));

  console.log("\n=== 5. GROWTH_REPORT_BATCH_JOBS ===");
  const batchExists = await q(`SELECT to_regclass('public.growth_report_batch_jobs') as r`);
  console.log("  exists:", batchExists[0].r ? "YES — ALREADY EXISTS" : "NO — ABSENT");

  console.log("\n=== 6. NOTIFICATIONS GR IDEMPOTENCY INDEX ===");
  const notifIdx = await q(`SELECT indexname FROM pg_indexes WHERE tablename='notifications' AND indexname='uq_notifications_gr_published'`);
  console.log("  uq_notifications_gr_published:", notifIdx.length > 0 ? "EXISTS" : "ABSENT");

  console.log("\n=== 7. X_MONTHLY_OPERATIONAL_SNAPSHOTS ===");
  const xExists = await q(`SELECT to_regclass('public.x_monthly_operational_snapshots') as r`);
  console.log("  table:", xExists[0].r ? "EXISTS" : "ABSENT");
  if (xExists[0].r) {
    const xCols = await q(`SELECT column_name FROM information_schema.columns WHERE table_name='x_monthly_operational_snapshots' ORDER BY ordinal_position`);
    const names = xCols.map((r: any) => r.column_name as string);
    const targets = ["growth_report_target_count","growth_report_generated_count","growth_report_failed_count","growth_report_sent_count"];
    targets.forEach(c => console.log(`  ${c}: ${names.includes(c) ? "PRESENT" : "ABSENT"}`));
  }

  console.log("\n=== 8. STATUS COUNTS (READ ONLY) ===");
  const counts = await q(`
    SELECT product_status, COUNT(*) as cnt
    FROM growth_reports WHERE deleted_at IS NULL
    GROUP BY product_status ORDER BY product_status
  `);
  counts.forEach(r => console.log(`  ${r.product_status}: ${r.cnt}`));
  const total = await q(`SELECT COUNT(*) as cnt FROM growth_reports`);
  const totalActive = await q(`SELECT COUNT(*) as cnt FROM growth_reports WHERE deleted_at IS NULL`);
  console.log(`  TOTAL (inc soft-deleted): ${total[0].cnt}`);
  console.log(`  TOTAL active: ${totalActive[0].cnt}`);

  console.log("\n=== 9. WP8 COLUMN PRESENCE CHECK ===");
  const wp8cols = ["version_number","discarded_at","discarded_by","discard_reason","batch_job_id"];
  const allCols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_name='growth_reports'`)).map((r: any) => r.column_name as string);
  wp8cols.forEach(c => console.log(`  ${c}: ${allCols.includes(c) ? "ALREADY EXISTS" : "ABSENT"}`));

  console.log("\n=== 10. WP8 INDEX PRESENCE CHECK ===");
  const allIdx = (await q(`SELECT indexname FROM pg_indexes WHERE tablename='growth_reports'`)).map((r: any) => r.indexname as string);
  const wp8idx = [
    "uq_growth_reports_student_cycle_v2",
    "uq_growth_reports_student_cycle",
    "idx_growth_reports_batch_job_id",
    "idx_growth_reports_ready_to_send",
  ];
  wp8idx.forEach(i => console.log(`  ${i}: ${allIdx.includes(i) ? "ALREADY EXISTS" : "ABSENT"}`));

  console.log("\n=== 11. GROWTH_REPORTS CONSTRAINTS ===");
  const grConst = await q(`
    SELECT conname, pg_get_constraintdef(oid) as def
    FROM pg_constraint WHERE conrelid = 'growth_reports'::regclass ORDER BY conname
  `);
  grConst.forEach(r => console.log(`  [${r.conname}] ${(r.def as string).substring(0,120)}`));

  console.log("\n✅ PREFLIGHT READ-ONLY COMPLETE — NO WRITES PERFORMED");
}

run().catch(e => { console.error("[PREFLIGHT FATAL]", e); process.exit(1); });
