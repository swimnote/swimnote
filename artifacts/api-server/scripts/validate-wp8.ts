/**
 * validate-wp8.ts — WP8: Production Workflow 검증 (Development DB 전용)
 *
 * 테스트 범위:
 *   §1  Migration schema 검증 (컬럼/인덱스/enum 값 존재)
 *   §2  autoValidateForReadyToSend 유닛 테스트
 *   §3  ALLOWED_TRANSITIONS 신규 상태 확인
 *   §4  DB 픽스처 취득
 *   §5  transitionToReadyToSend REVIEW_REQUIRED → READY_TO_SEND
 *   §6  discardReportVersion READY_TO_SEND → DISCARDED
 *   §7  regenerateReport DISCARDED → new REGENERATING
 *   §8  sendIndividualReport READY_TO_SEND → PUBLISHED
 *   §9  getMonthlyReportSummary KPI 집계
 *   §10 batch_job UPSERT idempotency
 *
 * 실행: tsx scripts/validate-wp8.ts
 * 전제: step-wp8-a-lifecycle + step-wp8-b-batch-jobs 완료
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

const db = superAdminDb;

// ── Test state ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
let skipped = 0;

function ok(name: string, cond: boolean, msg?: string) {
  if (cond) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.error(`  ❌ ${name}${msg ? `: ${msg}` : ""}`);
    failed++;
  }
}

function skip(name: string, reason: string) {
  console.log(`  ⏭️  ${name} — SKIP: ${reason}`);
  skipped++;
}

// ── DB 조회 헬퍼 ──────────────────────────────────────────────────────────────

async function queryRows<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  if (params.length === 0) {
    const r = await db.execute(sql.raw(query));
    return r.rows as T[];
  }
  // 파라미터 바인딩: $1 → 값 인라인
  let q = query;
  for (let i = 0; i < params.length; i++) {
    const v = params[i];
    const placeholder = `$${i + 1}`;
    const safe = v === null ? "NULL"
      : typeof v === "number" ? String(v)
      : typeof v === "boolean" ? String(v)
      : `'${String(v).replace(/'/g, "''")}'`;
    q = q.replace(placeholder, safe);
  }
  const r = await db.execute(sql.raw(q));
  return r.rows as T[];
}

async function queryOne<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T | null> {
  const rows = await queryRows<T>(query, params);
  return rows.length > 0 ? rows[0] : null;
}

// ── 리포트 생성 헬퍼 ─────────────────────────────────────────────────────────

interface CreateReportOpts {
  studentId:    string;
  poolId:       string;
  cycleId:      string;
  status:       string;
  period:       string;
  periodStart:  string;
  periodEnd:    string;
  versionNumber?: number;
}

async function createTestReport(opts: CreateReportOpts): Promise<string> {
  const { studentId, poolId, cycleId, status, period, periodStart, periodEnd, versionNumber = 1 } = opts;
  const hasContent = ["REVIEW_REQUIRED","READY_TO_SEND","PUBLISHED"].includes(status);
  const content  = hasContent ? '{"student_name":"테스트학생","summary":"테스트 요약"}' : 'null';
  const factPkg  = hasContent ? '{"facts":[]}' : 'null';
  const sns      = hasContent ? '{"text":"테스트 SNS 요약"}' : 'null';
  const analysis = hasContent ? "'COMPLETE'" : "null";

  const rows = await queryRows<{id: string}>(`
    INSERT INTO growth_reports (
      student_id, swimming_pool_id, cycle_id,
      report_period, period_start, period_end,
      product_status, version_number,
      report_content, report_fact_package, sns_summary, analysis_status
    )
    VALUES (
      '${studentId}', '${poolId}', '${cycleId}',
      '${period}', '${periodStart}', '${periodEnd}',
      '${status}'::gr_product_status_enum, ${versionNumber},
      ${hasContent ? `'${content}'::jsonb` : "null"},
      ${hasContent ? `'${factPkg}'::jsonb` : "null"},
      ${hasContent ? `'${sns}'::jsonb` : "null"},
      ${analysis}
    )
    RETURNING id
  `);
  return rows[0].id;
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────────────────────────────────────

async function run() {
  const now       = new Date();
  const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const prevYear  = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const period    = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
  const periodStart = `${prevYear}-${String(prevMonth).padStart(2, "0")}-01`;
  const nextM     = prevMonth === 12 ? 1 : prevMonth + 1;
  const nextY     = prevMonth === 12 ? prevYear + 1 : prevYear;
  const periodEnd = new Date(nextY, nextM - 1, 0).toISOString().slice(0, 10);

  // ── §1 Migration schema ───────────────────────────────────────────────────
  console.log("\n§1 Migration schema 검증");

  const enumRows = await queryRows<{enumlabel: string}>(`
    SELECT enumlabel FROM pg_enum
    JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
    WHERE pg_type.typname = 'gr_product_status_enum'
  `);
  const enumValues = enumRows.map(r => r.enumlabel);
  ok("READY_TO_SEND enum",   enumValues.includes("READY_TO_SEND"));
  ok("DISCARDED enum",       enumValues.includes("DISCARDED"));
  ok("REGENERATING enum",    enumValues.includes("REGENERATING"));

  const colRows = await queryRows<{column_name: string}>(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'growth_reports'
      AND column_name IN ('version_number','discarded_at','discarded_by','discard_reason','batch_job_id')
  `);
  const cols = colRows.map(r => r.column_name);
  ok("version_number column",  cols.includes("version_number"));
  ok("discarded_at column",    cols.includes("discarded_at"));
  ok("discarded_by column",    cols.includes("discarded_by"));
  ok("discard_reason column",  cols.includes("discard_reason"));
  ok("batch_job_id column",    cols.includes("batch_job_id"));

  const idxRows = await queryRows<{indexname: string}>(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'growth_reports'
      AND indexname IN (
        'uq_growth_reports_student_cycle_v2',
        'idx_growth_reports_batch_job_id',
        'idx_growth_reports_ready_to_send'
      )
  `);
  const idxNames = idxRows.map(r => r.indexname);
  ok("uq_growth_reports_student_cycle_v2",  idxNames.includes("uq_growth_reports_student_cycle_v2"));
  ok("idx_growth_reports_batch_job_id",     idxNames.includes("idx_growth_reports_batch_job_id"));
  ok("idx_growth_reports_ready_to_send",    idxNames.includes("idx_growth_reports_ready_to_send"));

  const tblRows = await queryRows(`
    SELECT table_name FROM information_schema.tables WHERE table_name = 'growth_report_batch_jobs'
  `);
  ok("growth_report_batch_jobs table", tblRows.length > 0);

  const batchIdxRows = await queryRows<{indexname: string}>(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'growth_report_batch_jobs'
      AND indexname IN ('uq_growth_report_batch_jobs_pool_period','idx_growth_report_batch_jobs_pending')
  `);
  const batchIdxNames = batchIdxRows.map(r => r.indexname);
  ok("uq_growth_report_batch_jobs_pool_period", batchIdxNames.includes("uq_growth_report_batch_jobs_pool_period"));
  ok("idx_growth_report_batch_jobs_pending",    batchIdxNames.includes("idx_growth_report_batch_jobs_pending"));

  // ── §2 autoValidateForReadyToSend 유닛 테스트 ────────────────────────────
  console.log("\n§2 autoValidateForReadyToSend 유닛 테스트");

  const { autoValidateForReadyToSend } = await import("../src/lib/growth-report-production-service.js");

  const validRow = {
    report_content:      { student_name: "테스트", summary: "요약" },
    report_fact_package: { facts: [] },
    sns_summary:         { text: "요약" },
    student_id:          "abc",
    swimming_pool_id:    "xyz",
    analysis_status:     "COMPLETE",
  };
  const validResult = autoValidateForReadyToSend(validRow);
  ok("valid row → ok=true",  validResult.ok);
  ok("valid row → no issues", validResult.issues.length === 0);

  const nullContentRow = { ...validRow, report_content: null };
  ok("null content → ok=false", !autoValidateForReadyToSend(nullContentRow as any).ok);

  const phRow = { ...validRow, report_content: { student_name: "[학생명]", summary: "요약" } };
  ok("placeholder → ok=false", !autoValidateForReadyToSend(phRow).ok);

  const missingSnsRow = { ...validRow, sns_summary: null };
  ok("null sns → ok=false", !autoValidateForReadyToSend(missingSnsRow as any).ok);

  // ── §3 ALLOWED_TRANSITIONS 신규 상태 확인 ────────────────────────────────
  console.log("\n§3 ALLOWED_TRANSITIONS 신규 상태 확인");
  const { ALLOWED_TRANSITIONS, ALL_PRODUCT_STATUSES } = await import("../src/lib/growth-report-service.js");

  ok("READY_TO_SEND in ALL", ALL_PRODUCT_STATUSES.has("READY_TO_SEND" as any));
  ok("DISCARDED in ALL",     ALL_PRODUCT_STATUSES.has("DISCARDED" as any));
  ok("REGENERATING in ALL",  ALL_PRODUCT_STATUSES.has("REGENERATING" as any));

  ok("REVIEW_REQUIRED → READY_TO_SEND", (ALLOWED_TRANSITIONS["REVIEW_REQUIRED"] as string[]).includes("READY_TO_SEND"));
  ok("REVIEW_REQUIRED → APPROVED still", (ALLOWED_TRANSITIONS["REVIEW_REQUIRED"] as string[]).includes("APPROVED"));
  ok("READY_TO_SEND → PUBLISHED",       (ALLOWED_TRANSITIONS["READY_TO_SEND"] as string[]).includes("PUBLISHED"));
  ok("READY_TO_SEND → DISCARDED",       (ALLOWED_TRANSITIONS["READY_TO_SEND"] as string[]).includes("DISCARDED"));
  ok("DISCARDED terminal (empty)",      (ALLOWED_TRANSITIONS["DISCARDED"] as string[]).length === 0);
  ok("PUBLISHED terminal (empty)",      (ALLOWED_TRANSITIONS["PUBLISHED"] as string[]).length === 0);
  ok("REGENERATING → PREANALYZING",     (ALLOWED_TRANSITIONS["REGENERATING"] as string[]).includes("PREANALYZING"));

  // ── §4 DB 픽스처 ─────────────────────────────────────────────────────────
  console.log("\n§4 DB 픽스처 취득");

  // Pre-cleanup: 이전 실패 실행의 잔여 데이터 제거
  await queryRows(`
    DELETE FROM growth_reports
    WHERE report_period = '${period}'
      AND swimming_pool_id IN (SELECT id FROM swimming_pools LIMIT 2)
      AND (
        (report_content::text LIKE '%테스트학생%')
        OR version_number >= 99
        OR product_status::text = 'REGENERATING'
      )
  `);

  const poolRows = await queryRows<{id: string}>(`SELECT id FROM swimming_pools LIMIT 2`);
  if (!poolRows.length) {
    skip("DB 통합 테스트 §5-§10", "수영장 없음 — 개발 DB 필요");
    return;
  }
  const pool1_id = poolRows[0].id;
  const pool2_id = poolRows.length > 1 ? poolRows[1].id : pool1_id;
  ok("pool 픽스처 취득", true);

  const stuRows = await queryRows<{id: string}>(`
    SELECT id FROM students WHERE swimming_pool_id = '${pool1_id}' AND status = 'active' LIMIT 2
  `);
  if (!stuRows.length) {
    skip("DB 통합 테스트 §5-§10", "학생 없음");
    return;
  }
  const student1_id = stuRows[0].id;
  const student2_id = stuRows.length > 1 ? stuRows[1].id : stuRows[0].id;
  ok("student 픽스처 취득", true);

  // cycle 생성/취득 (growth_report_cycles 실제 컬럼 기준)
  const periodStart2 = `${prevYear}-${String(prevMonth).padStart(2,"0")}-01`;
  await queryRows(`
    INSERT INTO growth_report_cycles (
      swimming_pool_id, report_period,
      analysis_cutoff_at, parent_input_open_at, parent_input_close_at
    )
    VALUES (
      '${pool1_id}', '${period}',
      NOW() + interval '7 days', NOW(), NOW() + interval '30 days'
    )
    ON CONFLICT (swimming_pool_id, report_period) DO NOTHING
  `);
  const cycleRow = await queryOne<{id: string}>(`
    SELECT id FROM growth_report_cycles
    WHERE swimming_pool_id = '${pool1_id}' AND report_period = '${period}' LIMIT 1
  `);
  if (!cycleRow) {
    skip("DB 통합 테스트 §5-§10", "cycle 생성 실패");
    return;
  }
  const cycle1_id = cycleRow.id;
  ok("cycle 픽스처 취득", true);

  const createdReports: string[] = [];

  // ── §5 transitionToReadyToSend ────────────────────────────────────────────
  console.log("\n§5 transitionToReadyToSend");
  const { transitionToReadyToSend: transToRts } = await import("../src/lib/growth-report-production-service.js");

  const r5_id = await createTestReport({
    studentId: student1_id, poolId: pool1_id, cycleId: cycle1_id,
    status: "REVIEW_REQUIRED", period, periodStart: periodStart2, periodEnd,
  });
  createdReports.push(r5_id);

  const r5a = await transToRts(db, r5_id);
  ok("§5a REVIEW_REQUIRED → READY_TO_SEND", r5a.success, r5a.reason);

  const r5_row = await queryOne(`SELECT product_status FROM growth_reports WHERE id = '${r5_id}'`);
  ok("§5a DB status = READY_TO_SEND", (r5_row as any)?.product_status === "READY_TO_SEND");

  // null content → validation fail → stays (update to test)
  await db.execute(sql.raw(
    `UPDATE growth_reports SET product_status = 'REVIEW_REQUIRED'::gr_product_status_enum, report_content = NULL WHERE id = '${r5_id}'`
  ));
  const r5b = await transToRts(db, r5_id);
  ok("§5b null content → not transitioned", !r5b.success);

  // Restore to READY_TO_SEND for discard test
  await db.execute(sql.raw(`
    UPDATE growth_reports
    SET product_status = 'READY_TO_SEND'::gr_product_status_enum,
        report_content = '{"student_name":"테스트","summary":"요약"}'::jsonb,
        report_fact_package = '{"facts":[]}'::jsonb,
        sns_summary = '{"text":"요약"}'::jsonb
    WHERE id = '${r5_id}'
  `));

  // ── §6 discardReportVersion ───────────────────────────────────────────────
  console.log("\n§6 discardReportVersion");
  const { discardReportVersion: discardFn } = await import("../src/lib/growth-report-production-service.js");

  await discardFn(db, {
    reportId: r5_id, poolId: pool1_id, actorId: "test-actor", reason: "데이터 누락",
  });
  const r6_row = await queryOne(`SELECT product_status, discarded_at FROM growth_reports WHERE id = '${r5_id}'`);
  ok("§6 DISCARDED", (r6_row as any)?.product_status === "DISCARDED");
  ok("§6 discarded_at set", (r6_row as any)?.discarded_at !== null);

  // idempotent
  await discardFn(db, { reportId: r5_id, poolId: pool1_id, actorId: "actor2", reason: "기타" });
  ok("§6 idempotent (no throw)", true);

  // ── §7 regenerateReport ───────────────────────────────────────────────────
  console.log("\n§7 regenerateReport");
  const { regenerateReport: regenFn } = await import("../src/lib/growth-report-production-service.js");

  const regenResult = await regenFn(db, {
    discardedReportId: r5_id, poolId: pool1_id, actorId: "test-actor",
  });
  createdReports.push(regenResult.newReportId);
  ok("§7 new report id",          !!regenResult.newReportId);
  ok("§7 version_number = 2",     regenResult.versionNumber === 2);

  const r7_row = await queryOne(`SELECT product_status, version_number FROM growth_reports WHERE id = '${regenResult.newReportId}'`);
  ok("§7 REGENERATING",           (r7_row as any)?.product_status === "REGENERATING");
  ok("§7 version_number=2 in DB", Number((r7_row as any)?.version_number) === 2);

  // duplicate regen attempt
  try {
    await regenFn(db, { discardedReportId: r5_id, poolId: pool1_id, actorId: "test-actor" });
    ok("§7 duplicate regen blocked", false, "should have thrown REGEN_DUPLICATE");
  } catch (e: any) {
    ok("§7 duplicate regen blocked", e.code === "REGEN_DUPLICATE", e.message);
  }

  // ── §8 sendIndividualReport ───────────────────────────────────────────────
  console.log("\n§8 sendIndividualReport");
  const { sendIndividualReport: sendFn } = await import("../src/lib/growth-report-production-service.js");

  // student2를 사용해서 uniqueness conflict 방지
  const r8_id = await createTestReport({
    studentId: student2_id, poolId: pool1_id, cycleId: cycle1_id,
    status: "READY_TO_SEND", period, periodStart: periodStart2, periodEnd,
  });
  createdReports.push(r8_id);

  await sendFn(db, { reportId: r8_id, poolId: pool1_id, actorId: "test-actor" });
  const r8_row = await queryOne(`SELECT product_status, published_at FROM growth_reports WHERE id = '${r8_id}'`);
  ok("§8 PUBLISHED",        (r8_row as any)?.product_status === "PUBLISHED");
  ok("§8 published_at set", (r8_row as any)?.published_at !== null);

  // idempotent
  const r8b = await sendFn(db, { reportId: r8_id, poolId: pool1_id, actorId: "actor2" });
  ok("§8 idempotent already_published", r8b.alreadyPublished);

  // SEND_NOT_ALLOWED — reuse already-DISCARDED r5_id (which is DISCARDED)
  // The r5_id is DISCARDED. sendIndividualReport should throw SEND_NOT_ALLOWED.

  // ── §9 getMonthlyReportSummary ────────────────────────────────────────────
  console.log("\n§9 getMonthlyReportSummary KPI");
  const { getMonthlyReportSummary: getSummary } = await import("../src/lib/growth-report-production-service.js");

  const summary = await getSummary(db, {
    poolId: pool1_id, year: now.getFullYear(), month: now.getMonth() + 1,
  });
  ok("§9 summary returned",         !!summary);
  ok("§9 published_count >= 1",     summary.published_count >= 1);
  ok("§9 ready_count is number",    typeof summary.ready_count === "number");
  ok("§9 period format YYYY-MM",    /^\d{4}-\d{2}$/.test(summary.period));
  ok("§9 discarded_count >= 1",     summary.discarded_count >= 1);

  // ── §10 batch_job UPSERT idempotency ─────────────────────────────────────
  console.log("\n§10 batch_job UPSERT idempotency");

  for (let i = 0; i < 3; i++) {
    await db.execute(sql.raw(`
      INSERT INTO growth_report_batch_jobs (swimming_pool_id, year, month, job_type)
      VALUES ('${pool1_id}', ${now.getFullYear()}, ${now.getMonth() + 1}, 'MONTHLY_AUTO')
      ON CONFLICT (swimming_pool_id, year, month, job_type) DO NOTHING
    `));
  }

  const batchCount = await queryOne<{"cnt": string}>(`
    SELECT COUNT(*) AS cnt FROM growth_report_batch_jobs
    WHERE swimming_pool_id = '${pool1_id}'
      AND year = ${now.getFullYear()} AND month = ${now.getMonth() + 1}
      AND job_type = 'MONTHLY_AUTO'
  `);
  ok("§10 only 1 batch job per pool/month", Number(batchCount?.cnt) === 1);

  // Batch job status claim round-trip
  const batchRow = await queryOne<{id: string}>(`
    SELECT id FROM growth_report_batch_jobs
    WHERE swimming_pool_id = '${pool1_id}'
      AND year = ${now.getFullYear()} AND month = ${now.getMonth() + 1}
      AND job_type = 'MONTHLY_AUTO'
  `);
  if (batchRow) {
    await db.execute(sql.raw(`
      UPDATE growth_report_batch_jobs SET status = 'COMPLETED', completed_at = NOW()
      WHERE id = '${batchRow.id}'
    `));
    const batchFinal = await queryOne(`SELECT status FROM growth_report_batch_jobs WHERE id = '${batchRow.id}'`);
    ok("§10 batch job COMPLETED", (batchFinal as any)?.status === "COMPLETED");

    // cleanup
    await db.execute(sql.raw(`DELETE FROM growth_report_batch_jobs WHERE id = '${batchRow.id}'`));
  } else {
    skip("§10 batch job status round-trip", "row not found after insert");
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  if (createdReports.length > 0) {
    const ids = createdReports.map(id => `'${id}'`).join(",");
    await db.execute(sql.raw(`DELETE FROM growth_reports WHERE id IN (${ids})`));
  }

  // ── 결과 ─────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`WP8 VALIDATION: PASSED=${passed} FAILED=${failed} SKIPPED=${skipped}`);
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error("[WP8] Fatal:", e); process.exit(1); });
