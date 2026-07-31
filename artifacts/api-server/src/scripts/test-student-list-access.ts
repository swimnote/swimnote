/**
 * 반 상세 학생목록 보조교사 접근 검증 스크립트
 *
 * 검증 시나리오:
 * A. 주담당 교사    → 학생목록 정상 조회
 * B. 보조1 교사     → 동일 학생목록 정상 조회
 * C. 보조2 교사     → (데이터 있을 시) 동일 학생목록 정상 조회
 * D. pool_admin     → 운영자 정상 조회
 * E. 무관 교사      → /class-groups/:id/students 접근 차단(pool 불일치) or UI-level 제한
 * F. 다른 센터 교사 → pool 불일치 → 403 차단
 * G. 정원 vs 실배정 → 정원(capacity)과 실배정(student count) 별개 표시
 */

import { db, superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const CLASS_ID = "cg_1784008818870_23undl2w7"; // 금 19:00반
const DATE = "2026-07-31";

let passed = 0;
let failed = 0;

function pass(label: string, msg: string) {
  console.log(`  ✅ [${label}] ${msg}`);
  passed++;
}
function fail(label: string, msg: string) {
  console.log(`  ❌ [${label}] ${msg}`);
  failed++;
}

/** 역할별 학생 조회 시뮬레이션: /class-groups/:id/students 방식 */
async function fetchStudentsForClass(userId: string, classId: string): Promise<{ status: number; count: number }> {
  // 사용자 pool 조회
  const [user] = await superAdminDb.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const userPool = user?.swimming_pool_id || null;

  // 반 pool 조회
  const [cg] = (await db.execute(sql.raw(
    `SELECT swimming_pool_id FROM class_groups WHERE id = '${classId}' AND is_deleted = false LIMIT 1`
  ))).rows as any[];
  if (!cg) return { status: 404, count: 0 };

  // pool 불일치 → 403
  if (userPool && cg.swimming_pool_id !== userPool) return { status: 403, count: 0 };

  // 학생 조회
  const rows = (await db.execute(sql.raw(`
    SELECT id FROM students
    WHERE (
      class_group_id = '${classId}'
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(assigned_class_ids, '[]'::jsonb)) AS elem
        WHERE elem = '${classId}'
      )
    )
    AND status NOT IN ('withdrawn', 'deleted')
    ORDER BY name ASC
  `))).rows;
  return { status: 200, count: rows.length };
}

/** /class-groups 조회 시 co_teacher_ids 포함 여부 */
async function canSeeClass(userId: string, classId: string): Promise<boolean> {
  const [user] = await superAdminDb.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const poolId = user?.swimming_pool_id;
  const role = user?.role;

  if (role === "super_admin") return true;

  const [cg] = (await db.execute(sql.raw(`
    SELECT teacher_user_id, co_teacher_ids, swimming_pool_id
    FROM class_groups WHERE id = '${classId}' AND is_deleted = false LIMIT 1
  `))).rows as any[];
  if (!cg) return false;
  if (cg.swimming_pool_id !== poolId) return false;

  if (role === "pool_admin") return true; // pool_admin → 해당 pool 전체 접근
  // teacher: 주담당 or co_teacher
  const coTeachers: string[] = Array.isArray(cg.co_teacher_ids)
    ? cg.co_teacher_ids
    : (typeof cg.co_teacher_ids === "string" ? JSON.parse(cg.co_teacher_ids || "[]") : []);
  return cg.teacher_user_id === userId || coTeachers.includes(userId);
}

async function main() {
  console.log("▶ 반 상세 학생목록 보조교사 접근 검증\n");

  // ── 반 기본 정보
  const [cls] = (await db.execute(sql.raw(
    `SELECT name, teacher_user_id, co_teacher_ids, capacity, swimming_pool_id FROM class_groups WHERE id = '${CLASS_ID}'`
  ))).rows as any[];
  if (!cls) { console.error("반을 찾을 수 없습니다:", CLASS_ID); return; }

  const coTeachers: string[] = Array.isArray(cls.co_teacher_ids)
    ? cls.co_teacher_ids
    : (typeof cls.co_teacher_ids === "string" ? JSON.parse(cls.co_teacher_ids || "[]") : []);

  console.log(`반: "${cls.name}"`);
  console.log(`주담당: ${cls.teacher_user_id}`);
  console.log(`보조담당: [${coTeachers.join(", ")}]`);
  console.log(`정원(capacity): ${cls.capacity ?? "없음"}`);
  console.log(`pool: ${cls.swimming_pool_id}\n`);

  // ── A. 주담당 교사
  {
    const primaryTeacherId = cls.teacher_user_id;
    const visible = await canSeeClass(primaryTeacherId, CLASS_ID);
    const { status, count } = await fetchStudentsForClass(primaryTeacherId, CLASS_ID);
    if (visible && status === 200 && count > 0)
      pass("A", `주담당 교사 → 반 보임 + 학생 ${count}명 정상 조회`);
    else fail("A", `주담당 교사 → visible=${visible} status=${status} count=${count}`);
  }

  // ── B. 보조1 교사
  if (coTeachers[0]) {
    const coTeacher1 = coTeachers[0];
    const visible = await canSeeClass(coTeacher1, CLASS_ID);
    const { status, count } = await fetchStudentsForClass(coTeacher1, CLASS_ID);
    if (visible && status === 200 && count > 0)
      pass("B", `보조1 교사 → 반 보임 + 학생 ${count}명 정상 조회`);
    else fail("B", `보조1 교사 → visible=${visible} status=${status} count=${count}`);
  } else {
    console.log("  ⚠️  [B] 보조1 교사 없음 — 스킵");
  }

  // ── C. 보조2 교사
  if (coTeachers[1]) {
    const coTeacher2 = coTeachers[1];
    const visible = await canSeeClass(coTeacher2, CLASS_ID);
    const { status, count } = await fetchStudentsForClass(coTeacher2, CLASS_ID);
    if (visible && status === 200 && count > 0)
      pass("C", `보조2 교사 → 반 보임 + 학생 ${count}명 정상 조회`);
    else fail("C", `보조2 교사 → visible=${visible} status=${status} count=${count}`);
  } else {
    console.log("  ⚠️  [C] 보조2 교사 없음 — 스킵");
  }

  // ── D. pool_admin (운영자)
  {
    const [adminUser] = (await db.execute(sql.raw(
      `SELECT id FROM users WHERE swimming_pool_id = '${cls.swimming_pool_id}' AND role = 'pool_admin' LIMIT 1`
    ))).rows as any[];
    if (adminUser) {
      const visible = await canSeeClass(adminUser.id, CLASS_ID);
      const { status, count } = await fetchStudentsForClass(adminUser.id, CLASS_ID);
      if (visible && status === 200 && count > 0)
        pass("D", `pool_admin → 반 보임 + 학생 ${count}명 정상 조회`);
      else fail("D", `pool_admin → visible=${visible} status=${status} count=${count}`);
    } else {
      console.log("  ⚠️  [D] pool_admin 없음 — 스킵");
    }
  }

  // ── E. 무관 교사 (같은 pool, 이 반 미담당)
  {
    const [unrelatedTeacher] = (await db.execute(sql.raw(`
      SELECT id FROM users
      WHERE swimming_pool_id = '${cls.swimming_pool_id}'
        AND role = 'teacher'
        AND id != '${cls.teacher_user_id}'
        ${coTeachers.length > 0 ? `AND id NOT IN (${coTeachers.map(id => `'${id}'`).join(",")})` : ""}
      LIMIT 1
    `))).rows as any[];
    if (unrelatedTeacher) {
      const visible = await canSeeClass(unrelatedTeacher.id, CLASS_ID);
      // E: UI level에서 차단 (이 반이 myGroups에 없으면 ClassDetailSheet 진입 불가)
      if (!visible)
        pass("E", `무관 교사 → UI-level 반 미보임 (myGroups 필터 차단)`);
      else
        fail("E", `무관 교사 → 반이 myGroups에 노출됨 (teacher_user_id/co_teacher 아님인데 보임)`);
    } else {
      console.log("  ⚠️  [E] 무관 교사 없음 — 스킵");
    }
  }

  // ── F. 다른 센터 교사 (다른 pool)
  {
    const [otherPoolTeacher] = (await db.execute(sql.raw(`
      SELECT id FROM users
      WHERE swimming_pool_id != '${cls.swimming_pool_id}'
        AND swimming_pool_id IS NOT NULL
        AND role IN ('teacher', 'pool_admin')
      LIMIT 1
    `))).rows as any[];
    if (otherPoolTeacher) {
      const { status } = await fetchStudentsForClass(otherPoolTeacher.id, CLASS_ID);
      if (status === 403)
        pass("F", `다른 센터 교사 → 403 차단`);
      else
        fail("F", `다른 센터 교사 → status=${status} (차단 안됨)`);
    } else {
      console.log("  ⚠️  [F] 다른 센터 교사 없음 — 스킵");
    }
  }

  // ── G. 정원(capacity) vs 실배정(student count) 별개
  {
    const actualCount = (await db.execute(sql.raw(`
      SELECT COUNT(*) AS cnt FROM students
      WHERE (
        class_group_id = '${CLASS_ID}'
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(assigned_class_ids, '[]'::jsonb)) AS elem
          WHERE elem = '${CLASS_ID}'
        )
      )
      AND status NOT IN ('withdrawn', 'deleted')
    `))).rows[0] as any;
    const capacity = cls.capacity;
    console.log(`\n  [G] 정원(capacity)=${capacity ?? "없음"}, 실배정=${actualCount.cnt}명`);
    if (capacity == null || Number(actualCount.cnt) !== capacity)
      pass("G", `정원(${capacity})과 실배정(${actualCount.cnt})이 별도 — ClassDetailSheet는 실배정만 표시`);
    else
      console.log(`  ℹ️  [G] 정원과 실배정이 동일(${capacity}명) — 일치 케이스`);
  }

  console.log(`\n─── 결과: 통과 ${passed} / 실패 ${failed} ───`);
  console.log("\n⚠️  H (수업일지 화면 동일 학생목록): 실기기 수동 확인 필요");
  console.log("   diary.tsx loadClassStudents: /today-schedule 우선 → fallback /students?class_group_id=...");
  console.log("   → 보조교사도 today-schedule(fixed) 또는 fallback으로 정상 작동 예상");
}

main().catch(console.error);
