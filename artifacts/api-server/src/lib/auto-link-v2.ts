/**
 * auto-link-v2.ts — V2 학부모↔학생 자동연결 핵심 모듈
 *
 * 매칭 조건 (3개 모두 일치):
 *   pool_id (exact) + normalizePhone(parent_phone) + normalizeName(student_name)
 *
 * 로그 5종:
 *   [v2-match]         학생 매칭 성공/실패
 *   [v2-link]          parent_students 저장 성공/실패
 *   [v2-home]          홈 linked student 조회 결과
 *   [v2-admin-trigger] 관리자 등록/수정 후 자동연결
 *   [v2-register]      회원가입 입력값 + 처리 결과
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

// ── 정규화 함수 (학부모 입력 / 관리자 입력 완전 동일 적용) ────────────
export function normalizePhone(phone: string): string {
  return (phone || "").replace(/[^0-9]/g, "");
}

// 공백 제거 + 소문자 (과도한 변환 없음 — 공백 정리 수준만)
export function normalizeName(name: string): string {
  return (name || "").trim().replace(/\s+/g, "").toLowerCase();
}

function phoneMask(p: string): string {
  return p.length > 6 ? p.slice(0, 3) + "****" + p.slice(-4) : "****";
}

// ── parent_v2_pending 테이블 초기화 (서버 시작 시 1회, 멱등) ──────────
export async function initV2PendingTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS parent_v2_pending (
      id                      text PRIMARY KEY,
      parent_id               text NOT NULL,
      pool_id                 text NOT NULL,
      child_name_raw          text NOT NULL,
      child_name_normalized   text NOT NULL,
      parent_phone_normalized text NOT NULL,
      status                  text NOT NULL DEFAULT 'pending',
      matched_student_id      text,
      matched_at              timestamp,
      retry_count             int NOT NULL DEFAULT 0,
      last_retry_at           timestamp,
      created_at              timestamp NOT NULL DEFAULT NOW()
    )
  `);
  // 기존 테이블에 컬럼 없으면 추가 (멱등)
  await db.execute(sql`ALTER TABLE parent_v2_pending ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'`);
  await db.execute(sql`ALTER TABLE parent_v2_pending ADD COLUMN IF NOT EXISTS matched_student_id text`);
  await db.execute(sql`ALTER TABLE parent_v2_pending ADD COLUMN IF NOT EXISTS matched_at timestamp`);
  console.log("[v2-init] parent_v2_pending 테이블 준비 완료");
}

// ── pending 레코드 UPSERT (1 학부모 = 1 활성 pending, 중복 방지) ──────
export async function upsertParentV2Pending(
  parentId: string,
  poolId: string,
  childNameRaw: string,
  childNameNorm: string,
  phoneNorm: string
): Promise<void> {
  // 기존 pending 레코드 조회
  const [existing] = (await db.execute(sql`
    SELECT id FROM parent_v2_pending
    WHERE parent_id = ${parentId} AND status = 'pending'
    LIMIT 1
  `)).rows as any[];

  if (existing) {
    // 기존 레코드 갱신 (재가입/정보 수정 대응)
    await db.execute(sql`
      UPDATE parent_v2_pending SET
        pool_id                 = ${poolId},
        child_name_raw          = ${childNameRaw},
        child_name_normalized   = ${childNameNorm},
        parent_phone_normalized = ${phoneNorm},
        retry_count             = 0,
        last_retry_at           = NULL
      WHERE id = ${existing.id}
    `);
  } else {
    const id = `v2p_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await db.execute(sql`
      INSERT INTO parent_v2_pending
        (id, parent_id, pool_id, child_name_raw, child_name_normalized, parent_phone_normalized, status, created_at)
      VALUES
        (${id}, ${parentId}, ${poolId}, ${childNameRaw}, ${childNameNorm}, ${phoneNorm}, 'pending', NOW())
    `);
  }
}

// ── pending 레코드 matched 처리 ─────────────────────────────────────────
async function markPendingMatched(parentId: string, studentId: string): Promise<void> {
  await db.execute(sql`
    UPDATE parent_v2_pending SET
      status             = 'matched',
      matched_student_id = ${studentId},
      matched_at         = NOW()
    WHERE parent_id = ${parentId} AND status = 'pending'
  `);
}

// ── V2 매칭 시도 ─────────────────────────────────────────────────────────
// 3개 모두 일치: pool_id + normalizePhone + normalizeName
export async function tryMatchStudentV2(
  parentId: string,
  poolId: string,
  phoneNorm: string,
  childNameNorm: string
): Promise<{ matched: boolean; studentId?: string; studentName?: string }> {
  console.log(`[v2-match] START parent=${parentId} pool=${poolId} phone=${phoneMask(phoneNorm)} child="${childNameNorm}"`);

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
    console.log(`[v2-match] FAIL — 조건 불일치 pool=${poolId} phone=${phoneMask(phoneNorm)} child="${childNameNorm}"`);
    return { matched: false };
  }

  console.log(`[v2-match] ✓ 매칭 성공 studentId=${student.id} name="${student.name}"`);
  return { matched: true, studentId: student.id, studentName: student.name };
}

// ── V2 연결 저장 (중복 방지 + matched 처리) ──────────────────────────────
export async function linkParentToStudentV2(
  parentId: string,
  studentId: string,
  poolId: string
): Promise<{ success: boolean; alreadyLinked?: boolean }> {
  // 중복 연결 확인
  const [existing] = (await db.execute(sql`
    SELECT id FROM parent_students
    WHERE parent_id = ${parentId} AND student_id = ${studentId} AND status = 'approved'
    LIMIT 1
  `)).rows as any[];

  if (existing) {
    console.log(`[v2-link] SKIP 이미 연결됨: parent=${parentId} student=${studentId}`);
    return { success: true, alreadyLinked: true };
  }

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

    // pending → matched 처리
    await markPendingMatched(parentId, studentId);

    return { success: true };
  } catch (e: any) {
    console.error(`[v2-link] ✗ 저장 실패: parent=${parentId} student=${studentId}`, e?.message);
    return { success: false };
  }
}

// ── 홈 연결 학생 조회 (pool_id 일치 확인 포함) ───────────────────────────
export async function getLinkedStudentsV2(parentId: string): Promise<any[]> {
  const rows = await db.execute(sql`
    SELECT s.id, s.name, s.birth_year, s.swimming_pool_id, s.class_group_id, s.status
    FROM parent_students ps
    JOIN students s ON s.id = ps.student_id
    JOIN parent_accounts pa ON pa.id = ps.parent_id
    WHERE ps.parent_id = ${parentId}
      AND ps.status = 'approved'
      AND ps.swimming_pool_id = pa.swimming_pool_id
      AND s.status NOT IN ('withdrawn','archived','deleted')
  `);
  const students = rows.rows as any[];
  const ids = students.map((s: any) => s.id).join(",") || "없음";
  console.log(`[v2-home] linked student 조회: parent=${parentId} count=${students.length} ids=[${ids}]`);
  return students;
}

// ── V2 상태 조회 + 재매칭 시도 (로그 분리) ───────────────────────────────
export type ParentStatusV2 = "no_pool" | "waiting" | "linked";

export async function getParentStatusV2(parentId: string): Promise<{
  status: ParentStatusV2;
  poolId: string | null;
  students: any[];
  pendingChildName: string | null;
}> {
  // 1. 연결된 학생 확인 (pool_id 일치 강화)
  const students = await getLinkedStudentsV2(parentId);
  if (students.length > 0) {
    console.log(`[v2-status] 최종 상태: linked (student=${students.map((s:any)=>s.id).join(",")})`);
    return { status: "linked", poolId: null, students, pendingChildName: null };
  }

  // 2. 수영장 확인
  const [pa] = (await db.execute(sql`
    SELECT id, swimming_pool_id, phone, name FROM parent_accounts WHERE id=${parentId} LIMIT 1
  `)).rows as any[];

  if (!pa?.swimming_pool_id) {
    console.log(`[v2-status] 최종 상태: no_pool`);
    return { status: "no_pool", poolId: null, students: [], pendingChildName: null };
  }

  // 3. pending 레코드 확인
  const [pending] = (await db.execute(sql`
    SELECT id, pool_id, child_name_raw, child_name_normalized, parent_phone_normalized, retry_count
    FROM parent_v2_pending
    WHERE parent_id = ${parentId} AND status = 'pending'
    LIMIT 1
  `)).rows as any[];

  if (!pending) {
    console.log(`[v2-status] 최종 상태: waiting (pending 레코드 없음)`);
    return { status: "waiting", poolId: pa.swimming_pool_id, students: [], pendingChildName: null };
  }

  // 4. 재매칭 시도 (로그 분리)
  console.log(`[v2-status] 재매칭 시도 시작: parent=${parentId} retry=${pending.retry_count}`);
  const { matched, studentId } = await tryMatchStudentV2(
    parentId, pending.pool_id,
    pending.parent_phone_normalized,
    pending.child_name_normalized
  );

  if (matched && studentId) {
    const { success } = await linkParentToStudentV2(parentId, studentId, pending.pool_id);
    if (success) {
      const freshStudents = await getLinkedStudentsV2(parentId);
      console.log(`[v2-status] 재매칭 성공 → 최종 상태: linked`);
      return { status: "linked", poolId: pending.pool_id, students: freshStudents, pendingChildName: null };
    }
  }

  // 재매칭 실패
  await db.execute(sql`
    UPDATE parent_v2_pending SET
      retry_count = retry_count + 1,
      last_retry_at = NOW()
    WHERE id = ${pending.id}
  `);
  console.log(`[v2-status] 재매칭 실패 → 최종 상태: waiting (retry=${pending.retry_count + 1})`);

  return {
    status: "waiting",
    poolId: pa.swimming_pool_id,
    students: [],
    pendingChildName: pending.child_name_raw,
  };
}

// ── 관리자 학생 등록/수정 시 V2 자동연결 트리거 ──────────────────────────
// 호출 조건: name / parent_phone / pool_id 변경 또는 신규 등록 / 승인 완료 시만
export async function triggerAutoLinkOnStudentV2(studentId: string, changedFields?: string[]): Promise<void> {
  const relevantFields = ["name", "parent_phone", "swimming_pool_id", "status"];
  if (changedFields && changedFields.length > 0) {
    const hasRelevant = changedFields.some(f => relevantFields.includes(f));
    if (!hasRelevant) {
      console.log(`[v2-admin-trigger] SKIP student=${studentId} — 매칭 관련 필드 변경 없음`);
      return;
    }
  }

  const [student] = (await db.execute(sql`
    SELECT id, name, swimming_pool_id, parent_phone FROM students WHERE id = ${studentId} LIMIT 1
  `)).rows as any[];

  if (!student?.swimming_pool_id || !student?.parent_phone) {
    console.log(`[v2-admin-trigger] SKIP student=${studentId} — pool 또는 phone 미설정`);
    return;
  }

  const phoneNorm = normalizePhone(student.parent_phone);
  const nameNorm  = normalizeName(student.name);

  console.log(`[v2-admin-trigger] 검색 시작 student=${studentId} pool=${student.swimming_pool_id} phone=${phoneMask(phoneNorm)} name="${nameNorm}"`);

  const pendingRows = (await db.execute(sql`
    SELECT id, parent_id FROM parent_v2_pending
    WHERE pool_id = ${student.swimming_pool_id}
      AND parent_phone_normalized = ${phoneNorm}
      AND child_name_normalized = ${nameNorm}
      AND status = 'pending'
  `)).rows as any[];

  console.log(`[v2-admin-trigger] 대기 학부모 ${pendingRows.length}명 검색됨`);

  for (const pending of pendingRows) {
    const { success, alreadyLinked } = await linkParentToStudentV2(
      pending.parent_id, studentId, student.swimming_pool_id
    );
    if (success) {
      if (!alreadyLinked) {
        console.log(`[v2-admin-trigger] ✓ 자동 연결 완료: parent=${pending.parent_id} → student=${studentId}`);
      }
    } else {
      console.error(`[v2-admin-trigger] ✗ 연결 실패: parent=${pending.parent_id}`);
    }
  }
}
