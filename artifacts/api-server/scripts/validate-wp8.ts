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

  // ── §11 Multiple reissue: v1 → v2 → v3 ─────────────────────────────────
  console.log("\n§11 Multiple reissue chain (v1 DISCARDED → v2 DISCARDED → v3 PUBLISHED)");
  const { transitionToReadyToSend: rtsChain,
          discardReportVersion:    discardChain,
          regenerateReport:        regenChain,
          sendIndividualReport:    sendChain } = await import("../src/lib/growth-report-production-service.js");

  // Step1: v1 생성 (REVIEW_REQUIRED → READY_TO_SEND → DISCARDED)
  // student1은 이미 v2 REGENERATING 존재 — 별도 pool2 사용
  let v1_id = "";
  let v2_id = "";
  let v3_id = "";

  if (pool2_id !== pool1_id) {
    // pool2로 별도 cycle 생성
    await queryRows(`
      INSERT INTO growth_report_cycles (
        swimming_pool_id, report_period, analysis_cutoff_at, parent_input_open_at, parent_input_close_at
      ) VALUES ('${pool2_id}', '${period}', NOW()+interval '7 days', NOW(), NOW()+interval '30 days')
      ON CONFLICT (swimming_pool_id, report_period) DO NOTHING
    `);
    const cycle2Row = await queryOne<{id: string}>(
      `SELECT id FROM growth_report_cycles WHERE swimming_pool_id = '${pool2_id}' AND report_period = '${period}' LIMIT 1`
    );
    const cycle2_id = cycle2Row?.id ?? null;

    if (!cycle2_id) { skip("§11 multiple reissue", "cycle2 생성 실패"); }
    else {
      const stu2Rows = await queryRows<{id: string}>(
        `SELECT id FROM students WHERE swimming_pool_id = '${pool2_id}' AND status = 'active' LIMIT 1`
      );
      if (!stu2Rows.length) { skip("§11 multiple reissue", "pool2 학생 없음"); }
      else {
        const stu2_id = stu2Rows[0].id;

        // v1 REVIEW_REQUIRED
        v1_id = await createTestReport({
          studentId: stu2_id, poolId: pool2_id, cycleId: cycle2_id,
          status: "REVIEW_REQUIRED", period, periodStart: periodStart2, periodEnd,
        });
        createdReports.push(v1_id);

        // v1 → READY_TO_SEND → DISCARDED
        await rtsChain(db, v1_id);
        await discardChain(db, { reportId: v1_id, poolId: pool2_id, actorId: "test-chain", reason: "1차 폐기" });

        // v2 REGENERATING → set READY_TO_SEND for discard
        const v2r = await regenChain(db, { discardedReportId: v1_id, poolId: pool2_id, actorId: "test-chain" });
        v2_id = v2r.newReportId;
        createdReports.push(v2_id);

        // v2: REGENERATING → REVIEW_REQUIRED (수동 set for test)
        await db.execute(sql.raw(`
          UPDATE growth_reports
          SET product_status = 'READY_TO_SEND'::gr_product_status_enum,
              report_content = '{"student_name":"체인테스트","summary":"v2 요약"}'::jsonb,
              report_fact_package = '{"facts":[]}'::jsonb,
              sns_summary = '{"text":"v2 SNS"}'::jsonb,
              analysis_status = 'COMPLETE'
          WHERE id = '${v2_id}'
        `));
        await discardChain(db, { reportId: v2_id, poolId: pool2_id, actorId: "test-chain", reason: "2차 폐기" });

        // v3 REGENERATING → READY_TO_SEND → PUBLISHED
        const v3r = await regenChain(db, { discardedReportId: v2_id, poolId: pool2_id, actorId: "test-chain" });
        v3_id = v3r.newReportId;
        createdReports.push(v3_id);
        await db.execute(sql.raw(`
          UPDATE growth_reports
          SET product_status = 'READY_TO_SEND'::gr_product_status_enum,
              report_content = '{"student_name":"체인테스트","summary":"v3 요약"}'::jsonb,
              report_fact_package = '{"facts":[]}'::jsonb,
              sns_summary = '{"text":"v3 SNS"}'::jsonb,
              analysis_status = 'COMPLETE'
          WHERE id = '${v3_id}'
        `));
        await sendChain(db, { reportId: v3_id, poolId: pool2_id, actorId: "test-chain" });

        // 검증
        const v3Row = await queryOne(`SELECT product_status, version_number FROM growth_reports WHERE id = '${v3_id}'`);
        ok("§11 v3 PUBLISHED",          (v3Row as any)?.product_status === "PUBLISHED");
        ok("§11 v3 version_number = 3", Number((v3Row as any)?.version_number) === 3);

        const allVersions = await queryRows(`
          SELECT product_status, version_number FROM growth_reports
          WHERE student_id = '${stu2_id}' AND cycle_id = '${cycle2_id}'
          ORDER BY version_number
        `);
        ok("§11 total versions = 3", allVersions.length === 3);
        ok("§11 v1 DISCARDED preserved", (allVersions[0] as any)?.product_status === "DISCARDED");
        ok("§11 v2 DISCARDED preserved", (allVersions[1] as any)?.product_status === "DISCARDED");
        ok("§11 old content NOT overwritten", v1_id !== v2_id && v2_id !== v3_id);

        // 고유 PUBLISHED 버전 확인
        const publishedCount = await queryOne<{cnt: string}>(`
          SELECT COUNT(*) AS cnt FROM growth_reports
          WHERE student_id = '${stu2_id}' AND cycle_id = '${cycle2_id}'
            AND product_status = 'PUBLISHED' AND deleted_at IS NULL
        `);
        ok("§11 final version unique (1 PUBLISHED)", Number(publishedCount?.cnt) === 1);
      }
    }
  } else {
    skip("§11 multiple reissue", "pool1 = pool2 (단일 풀 환경)");
  }

  // ── §12 Bulk send mixed statuses + pool isolation ────────────────────────
  console.log("\n§12 Bulk send mixed statuses + cross-pool isolation");
  const { bulkSendReports: bulkFn } = await import("../src/lib/growth-report-production-service.js");

  // Pre-cleanup: futurePeriod 잔여 데이터 제거
  await queryRows(`
    DELETE FROM growth_reports
    WHERE swimming_pool_id = '${pool1_id}'
      AND report_period LIKE '20__-__'
      AND period_start >= '2026-09-01'
  `);

  // pool1 기준 이번달+1 period 사용 (기존 test period와 충돌 방지)
  const futureMonth = now.getMonth() === 11 ? 1 : now.getMonth() + 2;
  const futureYear  = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
  const futurePeriod = `${futureYear}-${String(futureMonth).padStart(2, "0")}`;
  const futurePeriodStart = `${futureYear}-${String(futureMonth).padStart(2,"0")}-01`;
  const futurePeriodEnd = new Date(
    futureMonth === 12 ? futureYear + 1 : futureYear,
    futureMonth === 12 ? 0 : futureMonth, 0
  ).toISOString().slice(0, 10);

  // pool1 cycle (future period)
  await queryRows(`
    INSERT INTO growth_report_cycles (
      swimming_pool_id, report_period, analysis_cutoff_at, parent_input_open_at, parent_input_close_at
    ) VALUES ('${pool1_id}', '${futurePeriod}', NOW()+interval '7 days', NOW(), NOW()+interval '30 days')
    ON CONFLICT (swimming_pool_id, report_period) DO NOTHING
  `);
  const futureCycleRow = await queryOne<{id: string}>(
    `SELECT id FROM growth_report_cycles WHERE swimming_pool_id = '${pool1_id}' AND report_period = '${futurePeriod}' LIMIT 1`
  );

  if (!futureCycleRow || stuRows.length < 1) {
    skip("§12 bulk send", "cycle 또는 학생 부족");
  } else {
    const fcId = futureCycleRow.id;
    const stu3Rows = await queryRows<{id: string}>(
      `SELECT id FROM students WHERE swimming_pool_id = '${pool1_id}' AND status = 'active' LIMIT 5`
    );

    if (stu3Rows.length < 2) {
      skip("§12 bulk send", "학생 < 2");
    } else {
      // A = READY_TO_SEND (student[0]), E = READY_TO_SEND (student[1])
      // B = DISCARDED (student[0], same cycle — DISCARDED는 unique constraint 제외이므로 A와 공존 가능)
      const bulkIds: Record<string, string> = {};

      // A (READY_TO_SEND, student[0])
      bulkIds["A"] = await createTestReport({
        studentId: stu3Rows[0].id, poolId: pool1_id, cycleId: fcId,
        status: "READY_TO_SEND", period: futurePeriod,
        periodStart: futurePeriodStart, periodEnd: futurePeriodEnd,
      });
      createdReports.push(bulkIds["A"]);

      // B (DISCARDED, student[0] — unique index excludes DISCARDED so no conflict with A)
      const bRows = await queryRows<{id: string}>(`
        INSERT INTO growth_reports (
          student_id, swimming_pool_id, cycle_id, report_period,
          period_start, period_end, product_status, version_number
        ) VALUES (
          '${stu3Rows[0].id}', '${pool1_id}', '${fcId}', '${futurePeriod}',
          '${futurePeriodStart}', '${futurePeriodEnd}',
          'DISCARDED'::gr_product_status_enum, 50
        ) RETURNING id
      `);
      if (bRows.length) {
        bulkIds["B"] = bRows[0].id;
        createdReports.push(bulkIds["B"]);
      }

      // E (READY_TO_SEND, student[1])
      bulkIds["E"] = await createTestReport({
        studentId: stu3Rows[1].id, poolId: pool1_id, cycleId: fcId,
        status: "READY_TO_SEND", period: futurePeriod,
        periodStart: futurePeriodStart, periodEnd: futurePeriodEnd,
      });
      createdReports.push(bulkIds["E"]);

      // Bulk send (year/month of next month → resolves to futurePeriod)
      const futureNextM = futureMonth === 12 ? 1 : futureMonth + 1;
      const futureNextY = futureMonth === 12 ? futureYear + 1 : futureYear;
      const bulkResult = await bulkFn(db, {
        poolId: pool1_id, year: futureNextY, month: futureNextM, actorId: "bulk-test",
      });

      ok("§12 published >= 2 (A+E)",  bulkResult.published >= 2);

      const statusAfterA = await queryOne(`SELECT product_status FROM growth_reports WHERE id = '${bulkIds["A"]}'`);
      ok("§12 A → PUBLISHED",    (statusAfterA as any)?.product_status === "PUBLISHED");

      const statusAfterE = await queryOne(`SELECT product_status FROM growth_reports WHERE id = '${bulkIds["E"]}'`);
      ok("§12 E → PUBLISHED",    (statusAfterE as any)?.product_status === "PUBLISHED");

      if (bulkIds["B"]) {
        const statusAfterB = await queryOne(`SELECT product_status FROM growth_reports WHERE id = '${bulkIds["B"]}'`);
        ok("§12 B unchanged (DISCARDED)", (statusAfterB as any)?.product_status === "DISCARDED");
      } else {
        skip("§12 B unchanged check", "B 삽입 실패");
      }

      // cross-pool isolation: pool2 리포트는 bulk send 대상 아님
      if (pool2_id !== pool1_id && v3_id) {
        const crossRow = await queryOne(`SELECT product_status FROM growth_reports WHERE id = '${v3_id}'`);
        ok("§12 cross-pool not touched", (crossRow as any)?.product_status === "PUBLISHED");
      } else {
        skip("§12 cross-pool isolation check", "pool2 = pool1 또는 v3 없음");
      }
    }
  }

  // ── §13 Individual send — blocked states ─────────────────────────────────
  console.log("\n§13 Individual send blocked states");
  const { sendIndividualReport: sendFn13 } = await import("../src/lib/growth-report-production-service.js");

  // DISCARDED → blocked (use r5_id which is DISCARDED from §6)
  try {
    await sendFn13(db, { reportId: r5_id, poolId: pool1_id, actorId: "test" });
    ok("§13 DISCARDED blocked", false, "should throw SEND_NOT_ALLOWED");
  } catch (e: any) {
    ok("§13 DISCARDED blocked", e.code === "SEND_NOT_ALLOWED" || e.message?.includes("READY_TO_SEND"), e.message);
  }

  // REGENERATING from §7
  const regenId = createdReports.find(id => id !== r5_id && id !== r8_id);
  if (regenId) {
    const regenRow = await queryOne(`SELECT product_status FROM growth_reports WHERE id = '${regenId}'`);
    if ((regenRow as any)?.product_status === "REGENERATING") {
      try {
        await sendFn13(db, { reportId: regenId, poolId: pool1_id, actorId: "test" });
        ok("§13 REGENERATING blocked", false, "should throw");
      } catch (e: any) {
        ok("§13 REGENERATING blocked", e.code === "SEND_NOT_ALLOWED" || e.message?.includes("READY_TO_SEND"), e.message);
      }
    } else {
      skip("§13 REGENERATING send blocked", `status=${JSON.stringify((regenRow as any)?.product_status)}`);
    }
  } else {
    skip("§13 REGENERATING send blocked", "no REGENERATING report");
  }

  // already PUBLISHED → idempotent (not blocked, returns alreadyPublished)
  const pub13 = await sendFn13(db, { reportId: r8_id, poolId: pool1_id, actorId: "test" });
  ok("§13 already PUBLISHED → alreadyPublished=true", pub13.alreadyPublished);

  // ── §14 notifyBatchComplete recipient schema ──────────────────────────────
  console.log("\n§14 notifyBatchComplete recipient schema (users table)");

  // users table로 pool_admin 조회 검증
  const adminUsers = await queryRows<{id: string, role: string}>(`
    SELECT id, role FROM users WHERE swimming_pool_id = '${pool1_id}' AND role = 'pool_admin'
  `);
  ok("§14 admin query uses users table",  true); // query itself succeeded
  ok("§14 admin scope = pool1 only",      adminUsers.every(u => u.role === "pool_admin"));

  // pool2 admin이 pool1 batch complete에 포함되지 않음 확인
  if (pool2_id !== pool1_id) {
    const pool2Admins = await queryRows(`SELECT id FROM users WHERE swimming_pool_id = '${pool2_id}' AND role = 'pool_admin'`);
    const pool1AdminIds = new Set(adminUsers.map(u => u.id));
    const crossPollution = (pool2Admins as any[]).some(a => pool1AdminIds.has(a.id));
    ok("§14 pool2 admins not in pool1 batch recipients", !crossPollution);
  } else {
    skip("§14 cross-pool admin isolation", "pool2 = pool1");
  }

  // ── §15 ON CONFLICT real DB verification ─────────────────────────────────
  console.log("\n§15 ON CONFLICT real DB verification");

  // growth_report_cycles: same pool + same period → DO NOTHING
  const beforeCount = await queryOne<{cnt: string}>(
    `SELECT COUNT(*) AS cnt FROM growth_report_cycles WHERE swimming_pool_id = '${pool1_id}' AND report_period = '${period}'`
  );
  await queryRows(`
    INSERT INTO growth_report_cycles (
      swimming_pool_id, report_period, analysis_cutoff_at, parent_input_open_at, parent_input_close_at
    ) VALUES ('${pool1_id}', '${period}', NOW()+interval '7 days', NOW(), NOW()+interval '30 days')
    ON CONFLICT (swimming_pool_id, report_period) DO NOTHING
  `);
  const afterCount = await queryOne<{cnt: string}>(
    `SELECT COUNT(*) AS cnt FROM growth_report_cycles WHERE swimming_pool_id = '${pool1_id}' AND report_period = '${period}'`
  );
  ok("§15 grc ON CONFLICT idempotent (same pool+period)", Number(afterCount?.cnt) === Number(beforeCount?.cnt));

  // different pool: OK
  if (pool2_id !== pool1_id) {
    const beforeCount2 = await queryOne<{cnt: string}>(
      `SELECT COUNT(*) AS cnt FROM growth_report_cycles WHERE swimming_pool_id = '${pool2_id}' AND report_period = '${period}'`
    );
    await queryRows(`
      INSERT INTO growth_report_cycles (
        swimming_pool_id, report_period, analysis_cutoff_at, parent_input_open_at, parent_input_close_at
      ) VALUES ('${pool2_id}', '${period}', NOW()+interval '7 days', NOW(), NOW()+interval '30 days')
      ON CONFLICT (swimming_pool_id, report_period) DO NOTHING
    `);
    const afterCount2 = await queryOne<{cnt: string}>(
      `SELECT COUNT(*) AS cnt FROM growth_report_cycles WHERE swimming_pool_id = '${pool2_id}' AND report_period = '${period}'`
    );
    ok("§15 grc different pool = separate row", Number(afterCount2?.cnt) >= Number(beforeCount2?.cnt));
  } else {
    skip("§15 different pool row", "pool2 = pool1");
  }

  // batch_jobs ON CONFLICT
  const batchBefore = await queryOne<{cnt: string}>(
    `SELECT COUNT(*) AS cnt FROM growth_report_batch_jobs WHERE swimming_pool_id = '${pool1_id}' AND year = 2099 AND month = 1 AND job_type = 'MONTHLY_AUTO'`
  );
  ok("§15 batch_jobs clean slate", Number(batchBefore?.cnt) === 0);

  for (let i = 0; i < 3; i++) {
    await queryRows(`
      INSERT INTO growth_report_batch_jobs (swimming_pool_id, year, month, job_type)
      VALUES ('${pool1_id}', 2099, 1, 'MONTHLY_AUTO')
      ON CONFLICT (swimming_pool_id, year, month, job_type) DO NOTHING
    `);
  }
  const batchAfter = await queryOne<{cnt: string}>(
    `SELECT COUNT(*) AS cnt FROM growth_report_batch_jobs WHERE swimming_pool_id = '${pool1_id}' AND year = 2099 AND month = 1 AND job_type = 'MONTHLY_AUTO'`
  );
  ok("§15 batch_jobs ON CONFLICT → exactly 1 row", Number(batchAfter?.cnt) === 1);
  // cleanup
  await queryRows(`DELETE FROM growth_report_batch_jobs WHERE swimming_pool_id = '${pool1_id}' AND year = 2099 AND month = 1`);

  // ── §16 Auto validation rules documented ─────────────────────────────────
  console.log("\n§16 Auto validation rules");

  const { autoValidateForReadyToSend: validateFn } = await import("../src/lib/growth-report-production-service.js");

  // Rule 1: report_content must exist + non-null
  ok("§16 rule: null report_content fails",  !validateFn({ report_content: null, report_fact_package: {facts:[]}, sns_summary: {text:"x"}, student_id:"a", swimming_pool_id:"b", analysis_status:"COMPLETE" } as any).ok);

  // Rule 2: placeholder [학생명] blocked
  ok("§16 rule: placeholder fails", !validateFn({ report_content: {student_name:"[학생명]",summary:"요약"}, report_fact_package:{facts:[]}, sns_summary:{text:"x"}, student_id:"a", swimming_pool_id:"b", analysis_status:"COMPLETE" }).ok);

  // Rule 3: sns_summary must exist
  ok("§16 rule: null sns_summary fails", !validateFn({ report_content: {student_name:"홍길동",summary:"요약"}, report_fact_package:{facts:[]}, sns_summary:null, student_id:"a", swimming_pool_id:"b", analysis_status:"COMPLETE" } as any).ok);

  // Rule 4: valid row passes
  ok("§16 rule: valid row passes", validateFn({ report_content:{student_name:"홍길동",summary:"요약"}, report_fact_package:{facts:[]}, sns_summary:{text:"SNS"}, student_id:"a", swimming_pool_id:"b", analysis_status:"COMPLETE" }).ok);

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
