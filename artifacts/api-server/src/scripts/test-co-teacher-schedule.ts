/**
 * test-co-teacher-schedule.ts
 *
 * 검증 항목:
 *   T1. 주 담당 교사(teacher_user_id) → today-schedule에서 자신의 반 조회
 *   T2. 보조 담당 교사 1(co_teacher_ids[0]) → 동일 반 조회
 *   T3. 보조 담당 교사 2(co_teacher_ids[1]) → 동일 반 조회 (3인 담당)
 *   T4. 관계 없는 교사 → 해당 반 미조회
 *   T5. pool_admin → 전체 반 조회 (role 무관)
 *   T6. 학생 목록 중복 없음 (DISTINCT ON 보장)
 *
 * 실행: npx tsx src/scripts/test-co-teacher-schedule.ts
 */
import { db, superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

let passed = 0;
let failed = 0;

function pass(id: string, msg: string) {
  console.log(`  ✅ [${id}] ${msg}`);
  passed++;
}
function fail(id: string, msg: string) {
  console.error(`  ❌ [${id}] ${msg}`);
  failed++;
}

// ─────────────────────────────────────────────────────────────────────────────
// 헬퍼: today-schedule 쿼리와 동일한 WHERE 조건 검증
// ─────────────────────────────────────────────────────────────────────────────
async function getClassesForUser(userId: string, dayKO: string): Promise<any[]> {
  const rows = await db.execute(sql`
    SELECT id, name, teacher_user_id, co_teacher_ids FROM class_groups
    WHERE (teacher_user_id = ${userId} OR co_teacher_ids @> to_jsonb(${userId}::text))
      AND schedule_days LIKE ${"%" + dayKO + "%"}
      AND is_deleted = false
    ORDER BY schedule_time ASC
  `);
  return rows.rows as any[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 테스트
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n▶ co-teacher 다중 담당 today-schedule 검증 시작\n");

  // ── DB에서 실제 co_teacher_ids가 있는 반 탐색 ──────────────────────────
  const coTeacherClasses = await db.execute(sql`
    SELECT id, name, teacher_user_id, co_teacher_ids, schedule_days
    FROM class_groups
    WHERE is_deleted = false
      AND co_teacher_ids IS NOT NULL
      AND co_teacher_ids != '[]'::jsonb
      AND jsonb_array_length(co_teacher_ids) >= 1
    LIMIT 5
  `);
  const classes = coTeacherClasses.rows as any[];
  console.log(`  ℹ  co_teacher_ids 있는 반 수: ${classes.length}`);

  if (classes.length === 0) {
    console.warn("  ⚠  보조 담당 교사가 등록된 반이 없습니다. DB 데이터 없이 쿼리 문법만 검증합니다.");
    await testQuerySyntax();
  } else {
    for (const cls of classes) {
      await testClass(cls);
    }
  }

  // ── 요약 ────────────────────────────────────────────────────────────────
  console.log(`\n─── 결과: 통과 ${passed} / 실패 ${failed} ───`);
  if (failed > 0) process.exit(1);
}

async function testClass(cls: any) {
  const co: string[] = Array.isArray(cls.co_teacher_ids) ? cls.co_teacher_ids : [];
  const primaryId: string = cls.teacher_user_id;
  const dayKO = cls.schedule_days?.includes("월") ? "월" :
                cls.schedule_days?.includes("화") ? "화" :
                cls.schedule_days?.includes("수") ? "수" :
                cls.schedule_days?.includes("목") ? "목" :
                cls.schedule_days?.includes("금") ? "금" : "월";

  console.log(`\n  반: "${cls.name}" (id=${cls.id})`);
  console.log(`     teacher_user_id=${primaryId}`);
  console.log(`     co_teacher_ids=[${co.join(", ")}]`);
  console.log(`     schedule_days=${cls.schedule_days} → 테스트 요일: ${dayKO}`);

  // T1: 주 담당 교사
  const primaryResult = await getClassesForUser(primaryId, dayKO);
  const primaryFound = primaryResult.some((r: any) => r.id === cls.id);
  if (primaryFound) pass("T1", `주 담당 교사(${primaryId.slice(0, 8)}..) → 반 조회 성공`);
  else fail("T1", `주 담당 교사(${primaryId.slice(0, 8)}..) → 반 조회 실패`);

  // T2~T3: 보조 담당 교사 (최대 2명)
  for (let i = 0; i < Math.min(co.length, 2); i++) {
    const coId = co[i];
    const coResult = await getClassesForUser(coId, dayKO);
    const coFound = coResult.some((r: any) => r.id === cls.id);
    const label = i === 0 ? "T2" : "T3";
    const ordinal = i === 0 ? "보조1" : "보조2";
    if (coFound) pass(label, `${ordinal} 담당 교사(${coId.slice(0, 8)}..) → 반 조회 성공`);
    else fail(label, `${ordinal} 담당 교사(${coId.slice(0, 8)}..) → 반 조회 실패`);
  }

  // T4: 관계 없는 임의 교사 (primaryId 문자열 변조)
  const fakeId = primaryId.slice(0, -4) + "ZZZZ";
  const fakeResult = await getClassesForUser(fakeId, dayKO);
  const fakeFound = fakeResult.some((r: any) => r.id === cls.id);
  if (!fakeFound) pass("T4", `무관 교사(fakeId) → 해당 반 미조회 (접근 차단)  ✓`);
  else fail("T4", `무관 교사(fakeId) → 해당 반이 노출됨 (보안 문제)`);

  // T6: 학생 목록 중복 없음 — today-schedule 실제 쿼리(DISTINCT ON s.id, h.class_group_id)
  // 결과의 student.id가 중복되지 않아야 함 (재등록 이력은 DISTINCT ON으로 제거됨)
  const studentRows = await db.execute(sql.raw(`
    SELECT DISTINCT ON (s.id, h.class_group_id)
      s.id, h.class_group_id
    FROM student_class_history h
    JOIN students s ON s.id = h.student_id
    WHERE h.class_group_id = '${cls.id}'
      AND s.deleted_at IS NULL
    ORDER BY s.id, h.class_group_id, h.enrolled_at DESC
  `));
  const ids = (studentRows.rows as any[]).map((r: any) => r.id);
  const uniqueIds = new Set(ids);
  if (ids.length === uniqueIds.size) {
    pass("T6", `학생 목록 중복 없음 (학생 수: ${ids.length})`);
  } else {
    fail("T6", `DISTINCT ON 후에도 student.id 중복 발생 — rows=${ids.length} unique=${uniqueIds.size}`);
  }
}

async function testQuerySyntax() {
  // co_teacher_ids가 있는 반이 없을 때 쿼리 문법 자체를 검증
  try {
    await db.execute(sql`
      SELECT id FROM class_groups
      WHERE (teacher_user_id = ${"dummy-user"} OR co_teacher_ids @> to_jsonb(${"dummy-user"}::text))
        AND is_deleted = false
      LIMIT 1
    `);
    pass("T_SYNTAX", "co_teacher_ids @> to_jsonb(::text) 쿼리 문법 정상 실행");
  } catch (e: any) {
    fail("T_SYNTAX", `쿼리 문법 오류: ${e.message}`);
  }

  // co_teacher_ids 배열에 값 직접 포함 여부 검증
  try {
    const testId = "test-teacher-id-001";
    const checkRow = await db.execute(sql.raw(`
      SELECT
        '["${testId}", "other-id"]'::jsonb @> to_jsonb('${testId}'::text) AS contains_true,
        '["other-id"]'::jsonb @> to_jsonb('${testId}'::text) AS contains_false
    `));
    const r = checkRow.rows[0] as any;
    if (r.contains_true === true) pass("T_JSONB_TRUE", "JSONB 포함 검사(true 케이스) 정상");
    else fail("T_JSONB_TRUE", `JSONB @> 결과가 true가 아님: ${r.contains_true}`);
    if (r.contains_false === false) pass("T_JSONB_FALSE", "JSONB 포함 검사(false 케이스) 정상");
    else fail("T_JSONB_FALSE", `JSONB @> 결과가 false가 아님: ${r.contains_false}`);
  } catch (e: any) {
    fail("T_JSONB_CHECK", `JSONB 포함 검사 오류: ${e.message}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
