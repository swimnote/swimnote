/**
 * auto-link-v2.ts — V2 학부모↔학생 자동연결 핵심 모듈
 *
 * 매칭 조건: pool_id (exact) + normalizePhone + normalizeName 모두 일치
 * 로그 5종: [v2-match] [v2-link] [v2-home] [v2-admin-trigger] [v2-register]
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

// ── 정규화 함수 ──────────────────────────────────────────────────────
export function normalizePhone(phone: string): string {
  return (phone || "").replace(/[^0-9]/g, "");
}

export function normalizeName(name: string): string {
  return (name || "").replace(/\s+/g, "").toLowerCase().trim();
}

// ── parent_v2_pending 테이블 초기화 (서버 시작 시 1회) ──────────────
export async function initV2PendingTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS parent_v2_pending (
      id                     text PRIMARY KEY,
      parent_id              text NOT NULL,
      pool_id                text NOT NULL,
      child_name_raw         text NOT NULL,
      child_name_normalized  text NOT NULL,
      parent_phone_normalized text NOT NULL,
      retry_count            int NOT NULL DEFAULT 0,
      last_retry_at          timestamp,
      created_at             timestamp NOT NULL DEFAULT NOW()
    )
  `);
}

// ── V2 매칭 시도 ─────────────────────────────────────────────────────
// 조건: pool_id + phone + student_name 3개 모두 일치
export async function tryMatchStudentV2(
  parentId: string,
  poolId: string,
  phoneNorm: string,
  childNameNorm: string
): Promise<{ matched: boolean; studentId?: string; studentName?: string }> {
  const mask = phoneNorm.length > 6 ? phoneNorm.slice(0, 3) + "****" + phoneNorm.slice(-4) : "****";
  console.log(`[v2-match] START parent=${parentId} pool=${poolId} phone=${mask} child="${childNameNorm}"`);

  const rows = await db.execute(sql`
    SELECT id, name FROM students
    WHERE swimming_pool_id = ${poolId}
      AND REGEXP_REPLACE(COALESCE(parent_phone,''),'[^0-9]','','g') = ${phoneNorm}
      AND REPLACE(LOWER(TRIM(COALESCE(name,''))), ' ', '') = ${childNameNorm}
      AND status NOT IN ('withdrawn','archived','deleted')
    LIMIT 1
  `);

  const student = (rows.rows as any[])[0];
  if (!student) {
    console.log(`[v2-match] FAIL — 매칭 없음 (pool=${poolId} phone=${mask} child="${childNameNorm}")`);
    return { matched: false };
  }

  console.log(`[v2-match] ✓ 매칭 성공 studentId=${student.id} name="${student.name}"`);
  return { matched: true, studentId: student.id, studentName: student.name };
}

// ── V2 학부모↔학생 연결 저장 ─────────────────────────────────────────
export async function linkParentToStudentV2(
  parentId: string,
  studentId: string,
  poolId: string
): Promise<{ success: boolean }> {
  try {
    const psId = `ps_v2_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    await db.execute(sql`DELETE FROM parent_students WHERE parent_id=${parentId} AND student_id=${studentId}`);
    await db.execute(sql`
      INSERT INTO parent_students (id, parent_id, student_id, swimming_pool_id, status, approved_at, created_at)
      VALUES (${psId}, ${parentId}, ${studentId}, ${poolId}, 'approved', NOW(), NOW())
    `);
    console.log(`[v2-link] ✓ parent_students 저장 성공: parent=${parentId} student=${studentId} pool=${poolId}`);

    await db.execute(sql`
      UPDATE students SET
        parent_user_id = ${parentId},
        status = CASE WHEN status IN ('unregistered','pending_approval') THEN 'active' ELSE status END,
        updated_at = NOW()
      WHERE id = ${studentId}
    `);

    return { success: true };
  } catch (e: any) {
    console.error(`[v2-link] ✗ parent_students 저장 실패: parent=${parentId} student=${studentId}`, e?.message);
    return { success: false };
  }
}

// ── 홈 연결 학생 조회 ────────────────────────────────────────────────
export async function getLinkedStudentsV2(parentId: string): Promise<any[]> {
  const rows = await db.execute(sql`
    SELECT s.id, s.name, s.birth_year, s.swimming_pool_id,
           s.class_group_id, s.status
    FROM parent_students ps
    JOIN students s ON s.id = ps.student_id
    WHERE ps.parent_id = ${parentId}
      AND ps.status = 'approved'
      AND s.status NOT IN ('withdrawn','archived','deleted')
  `);
  const students = rows.rows as any[];
  const ids = students.map((s: any) => s.id).join(",") || "없음";
  console.log(`[v2-home] linked student 조회: parent=${parentId} count=${students.length} ids=[${ids}]`);
  return students;
}

// ── 학부모 V2 상태 조회 + 재매칭 시도 ──────────────────────────────
export type ParentStatusV2 = "no_pool" | "waiting" | "linked";

export async function getParentStatusV2(parentId: string): Promise<{
  status: ParentStatusV2;
  poolId: string | null;
  students: any[];
  pendingChildName: string | null;
}> {
  // 1. 연결된 학생 확인
  const students = await getLinkedStudentsV2(parentId);
  if (students.length > 0) {
    return { status: "linked", poolId: null, students, pendingChildName: null };
  }

  // 2. 수영장 설정 확인
  const [pa] = (await db.execute(sql`
    SELECT swimming_pool_id, phone, name FROM parent_accounts WHERE id=${parentId} LIMIT 1
  `)).rows as any[];

  if (!pa?.swimming_pool_id) {
    return { status: "no_pool", poolId: null, students: [], pendingChildName: null };
  }

  // 3. 대기 데이터 확인 + 재매칭 시도
  const [pending] = (await db.execute(sql`
    SELECT id, pool_id, child_name_raw, child_name_normalized, parent_phone_normalized, retry_count
    FROM parent_v2_pending WHERE parent_id=${parentId} LIMIT 1
  `)).rows as any[];

  if (pending) {
    // 재매칭 시도
    const { matched, studentId } = await tryMatchStudentV2(
      parentId, pending.pool_id,
      pending.parent_phone_normalized,
      pending.child_name_normalized
    );

    if (matched && studentId) {
      const { success } = await linkParentToStudentV2(parentId, studentId, pending.pool_id);
      if (success) {
        await db.execute(sql`DELETE FROM parent_v2_pending WHERE id=${pending.id}`);
        const freshStudents = await getLinkedStudentsV2(parentId);
        return { status: "linked", poolId: pending.pool_id, students: freshStudents, pendingChildName: null };
      }
    }

    // 재매칭 실패 → retry_count 증가
    await db.execute(sql`
      UPDATE parent_v2_pending
      SET retry_count = retry_count + 1, last_retry_at = NOW()
      WHERE id=${pending.id}
    `);

    return {
      status: "waiting",
      poolId: pa.swimming_pool_id,
      students: [],
      pendingChildName: pending.child_name_raw,
    };
  }

  // pending 데이터 없고 pool만 설정된 경우 → waiting으로 처리
  return { status: "waiting", poolId: pa.swimming_pool_id, students: [], pendingChildName: null };
}

// ── 관리자 학생 등록/수정 시 대기 학부모 자동 연결 ────────────────────
export async function triggerAutoLinkOnStudentV2(studentId: string): Promise<void> {
  const [student] = (await db.execute(sql`
    SELECT id, name, swimming_pool_id, parent_phone FROM students WHERE id=${studentId} LIMIT 1
  `)).rows as any[];

  if (!student?.swimming_pool_id || !student?.parent_phone) {
    console.log(`[v2-admin-trigger] SKIP student=${studentId} — pool 또는 phone 미설정`);
    return;
  }

  const phoneNorm = normalizePhone(student.parent_phone);
  const nameNorm  = normalizeName(student.name);

  console.log(`[v2-admin-trigger] 검색 시작 student=${studentId} pool=${student.swimming_pool_id} name="${nameNorm}" phone=***${phoneNorm.slice(-4)}`);

  const pendingRows = (await db.execute(sql`
    SELECT id, parent_id FROM parent_v2_pending
    WHERE pool_id = ${student.swimming_pool_id}
      AND parent_phone_normalized = ${phoneNorm}
      AND child_name_normalized = ${nameNorm}
  `)).rows as any[];

  console.log(`[v2-admin-trigger] 대기 학부모 ${pendingRows.length}명 검색됨`);

  for (const pending of pendingRows) {
    const { success } = await linkParentToStudentV2(pending.parent_id, studentId, student.swimming_pool_id);
    if (success) {
      await db.execute(sql`DELETE FROM parent_v2_pending WHERE id=${pending.id}`);
      console.log(`[v2-admin-trigger] ✓ 자동 연결 완료: parent=${pending.parent_id} → student=${studentId}`);
    } else {
      console.error(`[v2-admin-trigger] ✗ 연결 실패: parent=${pending.parent_id}`);
    }
  }
}
