/**
 * gr-correction-2026-09.ts
 *
 * § 8 One-time Correction Script — 9월 리포트 status 일괄 보정
 *
 * 목적:
 *   현재 pool_1780849364252_l9k44rbk3 의 2026-08 report_period에
 *   168건이 REVIEW_REQUIRED 상태로 존재.
 *   실제 ELIGIBLE 16건 → REVIEW_REQUIRED 유지
 *   나머지 152건 → EXCLUDED로 변경 + counts 저장
 *
 * 보안 원칙:
 *   - transaction-safe: 단일 트랜잭션 내에서 실행 (BEGIN/COMMIT)
 *   - repeat-safe (idempotent): 이미 EXCLUDED인 row는 재변경 금지 (DRY_RUN / 재실행 안전)
 *   - 절대 변경 금지: content, fact_package, questions, sns_summary, PUBLISHED row, 다른 pool
 *   - 대상: 주 pool + report_period='2026-08' + REVIEW_REQUIRED + deleted_at IS NULL 만
 *   - DRY_RUN 모드(기본): 실제 UPDATE 없이 영향 행 수만 출력
 *
 * 실행:
 *   # dry-run (기본)
 *   SUPABASE_DATABASE_URL=... tsx src/scripts/gr-correction-2026-09.ts
 *
 *   # 실제 실행 (별도 승인 필요)
 *   SUPABASE_DATABASE_URL=... APPLY=true tsx src/scripts/gr-correction-2026-09.ts
 */

import { Pool } from "pg";
import { evaluateStudentGrowthReportEligibility } from "../lib/growth-report-eligibility.js";

const POOL_ID      = "pool_1780849364252_l9k44rbk3";
const PERIOD       = "2026-08";
const P_START      = "2026-08-01";
const P_END_EX     = "2026-09-01";  // analysis_period_end_exclusive
const RM_START     = "2026-09-01";  // report_month start (재원 기준: nextMonth)
const DRY_RUN      = process.env.APPLY !== "true";
const MIN          = 3;             // GROWTH_REPORT_MIN_ATTENDANCE_COUNT / MIN_SOURCE_RECORDS

async function main() {
  const pg = new Pool({
    connectionString: process.env.SUPABASE_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pg.connect();

  try {
    console.log(`\n=== GR Correction 2026-09 [${DRY_RUN ? "DRY_RUN" : "APPLY"}] ===`);
    console.log(`POOL: ${POOL_ID} | PERIOD: ${PERIOD} | TARGET_STATUS: REVIEW_REQUIRED\n`);

    // ── 1. 대상 row 조회 ─────────────────────────────────────────────────────
    const targetRows = await client.query<{
      id: string;
      student_id: string;
      product_status: string;
    }>(`
      SELECT id, student_id, product_status
      FROM growth_reports
      WHERE swimming_pool_id = $1
        AND report_period    = $2
        AND product_status   = 'REVIEW_REQUIRED'
        AND deleted_at       IS NULL
    `, [POOL_ID, PERIOD]);

    console.log(`대상 행: ${targetRows.rows.length}건 (REVIEW_REQUIRED, deleted_at IS NULL)\n`);

    // ── 2. 각 학생 eligibility 계산 ──────────────────────────────────────────
    const results: Array<{
      reportId: string;
      studentId: string;
      attendanceCount: number;
      sourceEventCount: number;
      reregistered: boolean;
      eligible: boolean;
      exclusionCode: string | null;
    }> = [];

    for (const row of targetRows.rows) {
      // (A) attendance_count
      const attendRes = await client.query<{ cnt: string }>(`
        SELECT COUNT(DISTINCT a.id)::int AS cnt
        FROM attendance a
        WHERE a.student_id       = $1
          AND a.swimming_pool_id = $2
          AND a.date             >= $3
          AND a.date             <  $4
          AND a.status           IN ('present', 'late')
      `, [row.student_id, POOL_ID, P_START, P_END_EX]);
      const attendanceCount = Number(attendRes.rows[0]?.cnt ?? 0);

      // (B) source_event_count (동일 predicate: GREATEST + NULLIF)
      const sourceRes = await client.query<{ cnt: string }>(`
        SELECT COUNT(DISTINCT cd.id)::int AS cnt
        FROM class_diary_student_notes csn
        JOIN class_diaries cd ON cd.id = csn.diary_id
        WHERE csn.student_id       = $1
          AND cd.swimming_pool_id  = $2
          AND cd.is_deleted        = false
          AND csn.is_deleted       = false
          AND NULLIF(TRIM(csn.note_content), '') IS NOT NULL
          AND cd.lesson_date >= GREATEST(
            $3,
            (SELECT ((created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date)::text
             FROM students WHERE id = $1 LIMIT 1)
          )
          AND cd.lesson_date < $4
      `, [row.student_id, POOL_ID, P_START, P_END_EX]);
      const sourceEventCount = Number(sourceRes.rows[0]?.cnt ?? 0);

      // (C) reregistered (report_month 기준: enrolled_at <= P_START AND left_at >= RM_START)
      const reregRes = await client.query(`
        SELECT 1
        FROM student_class_history sch
        JOIN class_groups cg ON cg.id = sch.class_group_id
        WHERE sch.student_id      = $1
          AND cg.swimming_pool_id = $2
          AND sch.enrolled_at     <= $3::date
          AND (sch.left_at IS NULL OR sch.left_at >= $4::date)
        LIMIT 1
      `, [row.student_id, POOL_ID, P_START, RM_START]);
      const reregistered = reregRes.rows.length > 0;

      const elig = evaluateStudentGrowthReportEligibility({
        attendanceCount,
        sourceEventCount,
        reregistered,
      });

      results.push({
        reportId:       row.id,
        studentId:      row.student_id,
        attendanceCount,
        sourceEventCount,
        reregistered,
        eligible:       elig.eligible,
        exclusionCode:  elig.exclusion_code,
      });
    }

    // ── 3. 결과 요약 ──────────────────────────────────────────────────────────
    const eligible  = results.filter(r => r.eligible);
    const excluded  = results.filter(r => !r.eligible);

    console.log(`분석 결과:`);
    console.log(`  ELIGIBLE  (REVIEW_REQUIRED 유지): ${eligible.length}`);
    console.log(`  EXCLUDED  (상태 변경 예정):        ${excluded.length}`);
    console.log();

    const codeMap: Record<string, number> = {};
    for (const r of excluded) {
      const c = r.exclusionCode ?? "UNKNOWN";
      codeMap[c] = (codeMap[c] ?? 0) + 1;
    }
    console.log("exclusion_code 분포:", codeMap);
    console.log();

    // ELIGIBLE assertion: 모두 attend>=3 AND source>=3 AND reregistered
    let eligAssertion = true;
    for (const r of eligible) {
      if (r.attendanceCount < MIN || r.sourceEventCount < MIN || !r.reregistered) {
        console.error(`❌ ELIGIBLE assertion 실패: report=${r.reportId} attend=${r.attendanceCount} source=${r.sourceEventCount} rereg=${r.reregistered}`);
        eligAssertion = false;
      }
    }
    // EXCLUDED assertion: 단 하나도 ENGINE 대상(ELIGIBLE)이 아님
    let exclAssertion = true;
    for (const r of excluded) {
      if (r.eligible) {
        console.error(`❌ EXCLUDED assertion 실패: report=${r.reportId} eligible=true`);
        exclAssertion = false;
      }
    }
    if (eligAssertion)  console.log("✅ ELIGIBLE assertion PASS: 모두 attend>=3 AND source>=3 AND reregistered");
    if (exclAssertion)  console.log("✅ EXCLUDED assertion PASS: 단 하나도 ENGINE 대상 없음");

    if (DRY_RUN) {
      console.log("\n[DRY_RUN] 실제 변경 없음. APPLY=true로 재실행 시 적용됩니다.");
      return;
    }

    // ── 4. 실제 UPDATE (APPLY=true) ──────────────────────────────────────────
    await client.query("BEGIN");
    try {
      let updated = 0;
      for (const r of excluded) {
        // repeat-safe: 이미 EXCLUDED이면 skip (REVIEW_REQUIRED → EXCLUDED만)
        const res = await client.query(`
          UPDATE growth_reports
          SET product_status      = 'EXCLUDED'::gr_product_status_enum,
              exclusion_code      = $1,
              attendance_count    = $2,
              source_event_count  = $3,
              eligibility_version = 1,
              updated_at          = now()
          WHERE id = $4
            AND product_status = 'REVIEW_REQUIRED'  -- repeat-safe: 이미 EXCLUDED면 no-op
            AND deleted_at IS NULL
            AND swimming_pool_id = $5             -- 다른 pool 절대 변경 금지
        `, [r.exclusionCode, r.attendanceCount, r.sourceEventCount, r.reportId, POOL_ID]);
        updated += res.rowCount ?? 0;
      }

      // ELIGIBLE: counts만 업데이트, product_status 유지
      let countUpdated = 0;
      for (const r of eligible) {
        const res = await client.query(`
          UPDATE growth_reports
          SET attendance_count    = $1,
              source_event_count  = $2,
              eligibility_version = 1,
              exclusion_code      = NULL,
              updated_at          = now()
          WHERE id = $3
            AND product_status = 'REVIEW_REQUIRED'  -- PUBLISHED 등 절대 변경 금지
            AND deleted_at IS NULL
            AND swimming_pool_id = $4
        `, [r.attendanceCount, r.sourceEventCount, r.reportId, POOL_ID]);
        countUpdated += res.rowCount ?? 0;
      }

      await client.query("COMMIT");
      console.log(`\n✅ APPLY 완료:`);
      console.log(`   EXCLUDED 상태 변경: ${updated}건`);
      console.log(`   ELIGIBLE counts 업데이트: ${countUpdated}건`);

    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }

    // ── 5. 재실행 안전성 검증 ───────────────────────────────────────────────
    const remainReview = await client.query<{ cnt: string }>(`
      SELECT COUNT(*)::int AS cnt
      FROM growth_reports
      WHERE swimming_pool_id = $1
        AND report_period    = $2
        AND product_status   = 'REVIEW_REQUIRED'
        AND deleted_at       IS NULL
    `, [POOL_ID, PERIOD]);
    console.log(`   REVIEW_REQUIRED 잔여: ${remainReview.rows[0].cnt}건 (= ELIGIBLE ${eligible.length}건 예상)`);

    const remainExcluded = await client.query<{ cnt: string }>(`
      SELECT COUNT(*)::int AS cnt
      FROM growth_reports
      WHERE swimming_pool_id = $1
        AND report_period    = $2
        AND product_status   = 'EXCLUDED'
        AND deleted_at       IS NULL
    `, [POOL_ID, PERIOD]);
    console.log(`   EXCLUDED: ${remainExcluded.rows[0].cnt}건 (= 제외 ${excluded.length}건 예상)`);

  } finally {
    client.release();
    await pg.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
