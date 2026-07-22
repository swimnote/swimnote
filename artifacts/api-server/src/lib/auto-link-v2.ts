/**
 * auto-link-v2.ts — V2 학부모↔학생 자동연결 핵심 모듈
 *
 * 자동 승인 조건 (2개 모두 일치):
 *   normalizeName(student.name) = normalizeName(입력 이름)
 *   AND student.parent_phone2 (또는 phone1/phone3) normalized = parent.phone normalized
 *
 * pending_reason 값:
 *   "name_mismatch"   — 해당 이름의 학생 없음
 *   "phone_mismatch"  — 이름은 일치하나 전화번호 불일치
 *   "duplicate_name"  — 동명이인이고 전화번호 불일치
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export function normalizePhone(phone: string): string {
  return (phone || "").replace(/[^0-9]/g, "");
}

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
  await db.execute(sql`ALTER TABLE parent_v2_pending ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'`);
  await db.execute(sql`ALTER TABLE parent_v2_pending ADD COLUMN IF NOT EXISTS matched_student_id text`);
  await db.execute(sql`ALTER TABLE parent_v2_pending ADD COLUMN IF NOT EXISTS matched_at timestamp`);
  await db.execute(sql`ALTER TABLE parent_v2_pending ADD COLUMN IF NOT EXISTS pending_reason text`);
  await db.execute(sql`ALTER TABLE parent_v2_pending ADD COLUMN IF NOT EXISTS rejection_reason text`);
  console.log("[v2-init] parent_v2_pending 테이블 준비 완료");
}

// ── pending 레코드 UPSERT (1 학부모 = 1 활성 pending, 중복 방지) ──────
export async function upsertParentV2Pending(
  parentId: string,
  poolId: string,
  childNameRaw: string,
  childNameNorm: string,
  phoneNorm: string,
  pendingReason?: string,
  matchedStudentId?: string
): Promise<void> {
  const [existing] = (await db.execute(sql`
    SELECT id FROM parent_v2_pending
    WHERE parent_id = ${parentId} AND status = 'pending'
    LIMIT 1
  `)).rows as any[];

  if (existing) {
    await db.execute(sql`
      UPDATE parent_v2_pending SET
        pool_id                 = ${poolId},
        child_name_raw          = ${childNameRaw},
        child_name_normalized   = ${childNameNorm},
        parent_phone_normalized = ${phoneNorm},
        pending_reason          = ${pendingReason ?? null},
        matched_student_id      = ${matchedStudentId ?? null},
        retry_count             = 0,
        last_retry_at           = NULL
      WHERE id = ${existing.id}
    `);
  } else {
    const id = `v2p_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await db.execute(sql`
      INSERT INTO parent_v2_pending
        (id, parent_id, pool_id, child_name_raw, child_name_normalized, parent_phone_normalized,
         status, pending_reason, matched_student_id, created_at)
      VALUES
        (${id}, ${parentId}, ${poolId}, ${childNameRaw}, ${childNameNorm}, ${phoneNorm},
         'pending', ${pendingReason ?? null}, ${matchedStudentId ?? null}, NOW())
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

// ── V2 매칭 시도 — 이름·전화번호 두 단계로 검사하고 reason 반환 ─────────
export async function tryMatchStudentV2(
  parentId: string,
  poolId: string,
  phoneNorm: string,
  childNameNorm: string
): Promise<{
  matched: boolean;
  studentId?: string;
  studentName?: string;
  reason?: "name_mismatch" | "phone_mismatch" | "duplicate_name";
}> {
  console.log(`[v2-match] START parent=${parentId} pool=${poolId} phone=${phoneMask(phoneNorm)} child="${childNameNorm}"`);

  // 1단계: 이름으로 먼저 검색
  const nameRows = (await db.execute(sql`
    SELECT id, name, parent_phone, parent_phone2, parent_phone3
    FROM students
    WHERE swimming_pool_id = ${poolId}
      AND REPLACE(LOWER(TRIM(COALESCE(name,''))), ' ', '') = ${childNameNorm}
      AND status NOT IN ('withdrawn','archived','deleted')
    LIMIT 10
  `)).rows as any[];

  if (nameRows.length === 0) {
    console.log(`[v2-match] FAIL name — pool=${poolId} child="${childNameNorm}"`);
    return { matched: false, reason: "name_mismatch" };
  }

  // 2단계: 전화번호 비교 (phone2 우선, phone1/phone3 포함)
  const phoneMatch = nameRows.find(r => {
    const p1 = normalizePhone(r.parent_phone || "");
    const p2 = normalizePhone(r.parent_phone2 || "");
    const p3 = normalizePhone(r.parent_phone3 || "");
    return (p1 && p1 === phoneNorm) || (p2 && p2 === phoneNorm) || (p3 && p3 === phoneNorm);
  });

  if (!phoneMatch) {
    const reason = nameRows.length >= 2 ? "duplicate_name" : "phone_mismatch";
    console.log(`[v2-match] FAIL phone — pool=${poolId} name="${childNameNorm}" reason=${reason}`);
    return { matched: false, reason };
  }

  console.log(`[v2-match] ✓ 매칭 성공 studentId=${phoneMatch.id} name="${phoneMatch.name}"`);
  return { matched: true, studentId: phoneMatch.id, studentName: phoneMatch.name };
}

// ── V2 연결 저장 (중복 방지 + matched 처리) ──────────────────────────────
export async function linkParentToStudentV2(
  parentId: string,
  studentId: string,
  poolId: string
): Promise<{ success: boolean; alreadyLinked?: boolean }> {
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

    // parent_user_id: 이미 설정되어 있으면 덮어쓰지 않음 (보호자2 연결 시 보호자1 보호)
    await db.execute(sql`
      UPDATE students SET
        parent_user_id = COALESCE(parent_user_id, ${parentId}),
        status = CASE WHEN status IN ('unregistered','pending_approval') THEN 'active' ELSE status END,
        updated_at = NOW()
      WHERE id = ${studentId}
    `);

    await markPendingMatched(parentId, studentId);

    return { success: true };
  } catch (e: any) {
    console.error(`[v2-link] ✗ 저장 실패: parent=${parentId} student=${studentId}`, e?.message);
    return { success: false };
  }
}

// ── 홈 연결 학생 조회 ──────────────────────────────────────────────────
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

// ── V2 상태 조회 + 재매칭 시도 ────────────────────────────────────────
export type ParentStatusV2 = "no_pool" | "waiting" | "linked";

export async function getParentStatusV2(parentId: string): Promise<{
  status: ParentStatusV2;
  poolId: string | null;
  students: any[];
  pendingChildName: string | null;
  pendingReason: string | null;
}> {
  const students = await getLinkedStudentsV2(parentId);
  if (students.length > 0) {
    console.log(`[v2-status] 최종 상태: linked (student=${students.map((s:any)=>s.id).join(",")})`);
    return { status: "linked", poolId: null, students, pendingChildName: null, pendingReason: null };
  }

  const [pa] = (await db.execute(sql`
    SELECT id, swimming_pool_id, phone, name FROM parent_accounts WHERE id=${parentId} LIMIT 1
  `)).rows as any[];

  if (!pa?.swimming_pool_id) {
    console.log(`[v2-status] 최종 상태: no_pool`);
    return { status: "no_pool", poolId: null, students: [], pendingChildName: null, pendingReason: null };
  }

  const [pending] = (await db.execute(sql`
    SELECT id, pool_id, child_name_raw, child_name_normalized, parent_phone_normalized, retry_count, pending_reason
    FROM parent_v2_pending
    WHERE parent_id = ${parentId} AND status = 'pending'
    LIMIT 1
  `)).rows as any[];

  if (!pending) {
    console.log(`[v2-status] 최종 상태: waiting (pending 레코드 없음)`);
    return { status: "waiting", poolId: pa.swimming_pool_id, students: [], pendingChildName: null, pendingReason: null };
  }

  console.log(`[v2-status] 재매칭 시도: parent=${parentId} retry=${pending.retry_count}`);
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
      return { status: "linked", poolId: pending.pool_id, students: freshStudents, pendingChildName: null, pendingReason: null };
    }
  }

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
    pendingReason: pending.pending_reason ?? null,
  };
}

// ── 관리자 학생 등록/수정 시 V2 자동연결 트리거 ────────────────────────
export async function triggerAutoLinkOnStudentV2(studentId: string, changedFields?: string[]): Promise<void> {
  const relevantFields = ["name", "parent_phone", "parent_phone2", "parent_phone3", "swimming_pool_id", "status"];
  if (changedFields && changedFields.length > 0) {
    const hasRelevant = changedFields.some(f => relevantFields.includes(f));
    if (!hasRelevant) {
      console.log(`[v2-admin-trigger] SKIP student=${studentId} — 매칭 관련 필드 변경 없음`);
      return;
    }
  }

  const [student] = (await db.execute(sql`
    SELECT id, name, swimming_pool_id, parent_phone, parent_phone2, parent_phone3 FROM students WHERE id = ${studentId} LIMIT 1
  `)).rows as any[];

  if (!student?.swimming_pool_id) {
    console.log(`[v2-admin-trigger] SKIP student=${studentId} — pool 미설정`);
    return;
  }

  const allPhones = [student.parent_phone, student.parent_phone2, student.parent_phone3]
    .map((p: string | null) => normalizePhone(p || ""))
    .filter((p: string) => p.length > 0);

  if (allPhones.length === 0) {
    console.log(`[v2-admin-trigger] SKIP student=${studentId} — phone 미설정`);
    return;
  }

  const nameNorm = normalizeName(student.name);

  console.log(`[v2-admin-trigger] 검색 시작 student=${studentId} pool=${student.swimming_pool_id} phones=[${allPhones.map(phoneMask).join(",")}] name="${nameNorm}"`);

  const pendingRows = (await db.execute(sql`
    SELECT id, parent_id FROM parent_v2_pending
    WHERE pool_id = ${student.swimming_pool_id}
      AND parent_phone_normalized = ANY(${allPhones}::text[])
      AND child_name_normalized = ${nameNorm}
      AND status = 'pending'
  `)).rows as any[];

  console.log(`[v2-admin-trigger] 대기 학부모 ${pendingRows.length}명 검색됨`);

  for (const pending of pendingRows) {
    const { success, alreadyLinked } = await linkParentToStudentV2(
      pending.parent_id, studentId, student.swimming_pool_id
    );
    if (success && !alreadyLinked) {
      console.log(`[v2-admin-trigger] ✓ 자동 연결 완료: parent=${pending.parent_id} → student=${studentId}`);
    } else if (!success) {
      console.error(`[v2-admin-trigger] ✗ 연결 실패: parent=${pending.parent_id}`);
    }
  }
}

// ── 관리자: 풀의 pending 목록 조회 ──────────────────────────────────────
export async function getParentV2PendingByPool(poolId: string, statusFilter: string = "pending"): Promise<any[]> {
  const rows = (await db.execute(sql`
    SELECT
      pvp.id,
      pvp.parent_id,
      pvp.pool_id,
      pvp.child_name_raw,
      pvp.child_name_normalized,
      pvp.matched_student_id,
      pvp.pending_reason,
      pvp.rejection_reason,
      pvp.status,
      pvp.retry_count,
      pvp.created_at,
      pvp.matched_at,
      pa.name   AS parent_name,
      pa.phone  AS parent_phone
    FROM parent_v2_pending pvp
    JOIN parent_accounts pa ON pa.id = pvp.parent_id
    WHERE pvp.pool_id = ${poolId}
      AND pvp.status = ${statusFilter}
    ORDER BY pvp.created_at DESC
    LIMIT 100
  `)).rows as any[];
  return rows;
}

// ── 관리자: 수동 승인 ────────────────────────────────────────────────────
export async function approveParentV2Pending(
  pendingId: string,
  poolId: string
): Promise<{ success: boolean; message: string }> {
  const [pending] = (await db.execute(sql`
    SELECT * FROM parent_v2_pending WHERE id = ${pendingId} AND pool_id = ${poolId} LIMIT 1
  `)).rows as any[];

  if (!pending) return { success: false, message: "요청을 찾을 수 없습니다." };
  if (pending.status !== "pending") return { success: false, message: "이미 처리된 요청입니다." };

  let studentId = pending.matched_student_id;

  // matched_student_id 없으면 이름으로 검색
  if (!studentId) {
    const [student] = (await db.execute(sql`
      SELECT id FROM students
      WHERE swimming_pool_id = ${poolId}
        AND REPLACE(LOWER(TRIM(COALESCE(name,''))), ' ', '') = ${pending.child_name_normalized}
        AND status NOT IN ('withdrawn','archived','deleted')
      LIMIT 1
    `)).rows as any[];
    if (!student) return { success: false, message: "연결할 학생을 찾을 수 없습니다." };
    studentId = student.id;
  }

  const { success } = await linkParentToStudentV2(pending.parent_id, studentId, poolId);
  if (!success) return { success: false, message: "연결 저장에 실패했습니다." };

  return { success: true, message: "승인 완료" };
}

// ── 관리자: 수동 거절 ────────────────────────────────────────────────────
export async function rejectParentV2Pending(
  pendingId: string,
  poolId: string,
  reason?: string
): Promise<{ success: boolean; message: string }> {
  const [pending] = (await db.execute(sql`
    SELECT id, status FROM parent_v2_pending WHERE id = ${pendingId} AND pool_id = ${poolId} LIMIT 1
  `)).rows as any[];

  if (!pending) return { success: false, message: "요청을 찾을 수 없습니다." };
  if (pending.status !== "pending") return { success: false, message: "이미 처리된 요청입니다." };

  await db.execute(sql`
    UPDATE parent_v2_pending SET
      status           = 'rejected',
      rejection_reason = ${reason ?? null},
      matched_at       = NOW()
    WHERE id = ${pendingId}
  `);

  return { success: true, message: "거절 완료" };
}
