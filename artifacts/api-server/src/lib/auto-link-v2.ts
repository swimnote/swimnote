/**
 * auto-link-v2.ts — V2 학부모↔학생 자동연결 핵심 모듈
 *
 * 자동 승인 조건 (2개 모두 일치):
 *   normalizeName(student.name) = normalizeName(입력 이름)
 *   AND student.parent_phone1~4 normalized 중 하나 = parent.phone normalized
 *
 * pending_reason 값:
 *   "name_mismatch"   — 해당 이름의 학생 없음
 *   "phone_mismatch"  — 이름은 일치하나 전화번호 불일치
 *   "duplicate_name"  — 동명이인이고 전화번호 불일치
 *
 * 수동승인 / sibling 연결:
 *   자동승인 실패 = 관리자 승인 금지가 아님.
 *   관리자가 student_id를 직접 지정하여 승인 가능.
 *   승인 후 동일 보호자 전화번호로 등록된 형제자매를 동일 pool에서 자동 연결.
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

// ── parent_v2_pending 테이블 초기화 (no-op) ────────────────────────────
// WP8-P3: DDL moved to src/migrations/runtime-ddl-consolidated.ts §11
// schema must be pre-applied via staging-manifest / production migration
export async function initV2PendingTable(): Promise<void> {
  // no-op: schema is applied via explicit migration (runtime-ddl-consolidated §11)
  console.log("[v2-init] parent_v2_pending schema pre-applied via migration");
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
async function markPendingMatched(pendingId: string, studentId: string): Promise<void> {
  await db.execute(sql`
    UPDATE parent_v2_pending SET
      status             = 'matched',
      matched_student_id = ${studentId},
      matched_at         = NOW()
    WHERE id = ${pendingId}
  `);
}

// ── pending 레코드 matched 처리 (parent_id 기준) ────────────────────────
async function markPendingMatchedByParent(parentId: string, studentId: string): Promise<void> {
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
    SELECT id, name, parent_phone, parent_phone2, parent_phone3, parent_phone4
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

  // 2단계: 전화번호 비교 (phone1/phone2/phone3/phone4 모두 확인)
  const phoneMatch = nameRows.find(r => {
    const p1 = normalizePhone(r.parent_phone || "");
    const p2 = normalizePhone(r.parent_phone2 || "");
    const p3 = normalizePhone(r.parent_phone3 || "");
    const p4 = normalizePhone(r.parent_phone4 || "");
    return (p1 && p1 === phoneNorm) || (p2 && p2 === phoneNorm) || (p3 && p3 === phoneNorm) || (p4 && p4 === phoneNorm);
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

    return { success: true };
  } catch (e: any) {
    console.error(`[v2-link] ✗ 저장 실패: parent=${parentId} student=${studentId}`, e?.message);
    return { success: false };
  }
}

// ── 형제자매 자동연결 — 승인된 보호자 전화번호로 같은 pool의 전체 학생 연결 ──
// 자동승인 / 수동승인 / rejected→approved 세 경로에서 공통 사용
export async function linkApprovedParentToRegisteredChildren(
  parentId: string,
  poolId: string,
  phoneNorm: string
): Promise<{ linkedCount: number; newCount: number; studentIds: string[] }> {
  if (!phoneNorm) return { linkedCount: 0, newCount: 0, studentIds: [] };

  // 동일 pool에서 phone1~4에 phoneNorm이 등록된 active 학생 전부 조회
  const students = (await db.execute(sql`
    SELECT id, name
    FROM students
    WHERE swimming_pool_id = ${poolId}
      AND status NOT IN ('withdrawn', 'archived', 'deleted')
      AND deleted_at IS NULL
      AND (
        REGEXP_REPLACE(COALESCE(parent_phone,''),  '[^0-9]', '', 'g') = ${phoneNorm}
        OR REGEXP_REPLACE(COALESCE(parent_phone2,''), '[^0-9]', '', 'g') = ${phoneNorm}
        OR REGEXP_REPLACE(COALESCE(parent_phone3,''), '[^0-9]', '', 'g') = ${phoneNorm}
        OR REGEXP_REPLACE(COALESCE(parent_phone4,''), '[^0-9]', '', 'g') = ${phoneNorm}
      )
  `)).rows as any[];

  let newCount = 0;
  const studentIds: string[] = [];

  for (const s of students) {
    const { success, alreadyLinked } = await linkParentToStudentV2(parentId, s.id, poolId);
    if (success) {
      studentIds.push(s.id);
      if (!alreadyLinked) {
        newCount++;
        console.log(`[sibling-link] ✓ 형제자매 연결: parent=${parentId} student=${s.id} name="${s.name}"`);
      }
    }
  }

  // 연결된 학생에 대한 sibling pending 정리 (이름 기반 매칭이 성공한 경우만)
  for (const sid of studentIds) {
    await db.execute(sql`
      UPDATE parent_v2_pending SET
        status             = 'matched',
        matched_student_id = ${sid},
        matched_at         = NOW()
      WHERE parent_id = ${parentId}
        AND pool_id   = ${poolId}
        AND status    = 'pending'
        AND (matched_student_id IS NULL OR matched_student_id = ${sid})
        AND child_name_normalized = (
          SELECT REPLACE(LOWER(TRIM(COALESCE(name,''))), ' ', '')
          FROM students WHERE id = ${sid} LIMIT 1
        )
    `).catch(() => {});
  }

  console.log(`[sibling-link] 결과: parent=${parentId} pool=${poolId} total=${studentIds.length} new=${newCount}`);
  return { linkedCount: studentIds.length, newCount, studentIds };
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
      // sibling 연결
      const phoneNorm = normalizePhone(pa.phone || "");
      if (phoneNorm) {
        await linkApprovedParentToRegisteredChildren(parentId, pending.pool_id, phoneNorm);
      }
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
  const relevantFields = ["name", "parent_phone", "parent_phone2", "parent_phone3", "parent_phone4", "swimming_pool_id", "status"];
  if (changedFields && changedFields.length > 0) {
    const hasRelevant = changedFields.some(f => relevantFields.includes(f));
    if (!hasRelevant) {
      console.log(`[v2-admin-trigger] SKIP student=${studentId} — 매칭 관련 필드 변경 없음`);
      return;
    }
  }

  const [student] = (await db.execute(sql`
    SELECT id, name, swimming_pool_id, parent_phone, parent_phone2, parent_phone3, parent_phone4 FROM students WHERE id = ${studentId} LIMIT 1
  `)).rows as any[];

  if (!student?.swimming_pool_id) {
    console.log(`[v2-admin-trigger] SKIP student=${studentId} — pool 미설정`);
    return;
  }

  const allPhones = [student.parent_phone, student.parent_phone2, student.parent_phone3, student.parent_phone4]
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
      // sibling 연결
      const [pa] = (await db.execute(sql`SELECT phone FROM parent_accounts WHERE id = ${pending.parent_id} LIMIT 1`)).rows as any[];
      const phoneNorm = normalizePhone(pa?.phone || "");
      if (phoneNorm) {
        await linkApprovedParentToRegisteredChildren(pending.parent_id, student.swimming_pool_id, phoneNorm);
      }
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
// overrideStudentId: 관리자가 직접 선택한 학생 ID (name_mismatch 등 자동 매칭 불가 시)
// 허용 status: pending, rejected (matched = 이미 처리됨 → idempotent 반환)
export async function approveParentV2Pending(
  pendingId: string,
  poolId: string,
  overrideStudentId?: string
): Promise<{ success: boolean; message: string; linkedCount?: number }> {
  const [pending] = (await db.execute(sql`
    SELECT * FROM parent_v2_pending WHERE id = ${pendingId} AND pool_id = ${poolId} LIMIT 1
  `)).rows as any[];

  if (!pending) return { success: false, message: "요청을 찾을 수 없습니다." };

  // matched = 이미 성공적으로 연결됨 → idempotent 반환
  if (pending.status === "matched") {
    console.log(`[v2-approve] 이미 처리된 요청: pendingId=${pendingId}`);
    return { success: true, message: "이미 승인된 요청입니다.", linkedCount: 0 };
  }
  // pending / rejected → 승인 허용

  let studentId: string | undefined = overrideStudentId || pending.matched_student_id || undefined;

  if (studentId) {
    // student_id가 있으면 pool 소속 검증
    const [student] = (await db.execute(sql`
      SELECT id FROM students
      WHERE id = ${studentId}
        AND swimming_pool_id = ${poolId}
        AND status NOT IN ('withdrawn','archived','deleted')
      LIMIT 1
    `)).rows as any[];
    if (!student) return { success: false, message: "선택한 학생이 이 수영장에 속하지 않거나 유효하지 않습니다." };
  } else {
    // student_id 없으면 이름으로 재검색 (단 1건 일치해야 함)
    const [student] = (await db.execute(sql`
      SELECT id FROM students
      WHERE swimming_pool_id = ${poolId}
        AND REPLACE(LOWER(TRIM(COALESCE(name,''))), ' ', '') = ${pending.child_name_normalized}
        AND status NOT IN ('withdrawn','archived','deleted')
      LIMIT 1
    `)).rows as any[];
    if (!student) {
      return { success: false, message: "연결할 학생을 찾을 수 없습니다. 학생을 직접 선택해주세요." };
    }
    studentId = student.id;
  }

  // parent 존재 + phone 조회 (sibling 연결용)
  const [pa] = (await db.execute(sql`
    SELECT id, phone FROM parent_accounts WHERE id = ${pending.parent_id} LIMIT 1
  `)).rows as any[];
  if (!pa) return { success: false, message: "학부모 계정을 찾을 수 없습니다." };

  // 직접 연결
  const { success } = await linkParentToStudentV2(pending.parent_id, studentId!, poolId);
  if (!success) return { success: false, message: "연결 저장에 실패했습니다." };

  // pending 상태 → matched 처리
  await markPendingMatched(pendingId, studentId!);

  // 형제자매 자동연결 (3개 경로 공통 helper)
  const phoneNorm = normalizePhone(pa.phone || "");
  let linkedCount = 1;
  if (phoneNorm) {
    const sibling = await linkApprovedParentToRegisteredChildren(pending.parent_id, poolId, phoneNorm);
    linkedCount = sibling.studentIds.length;
  }

  console.log(`[v2-approve] ✓ 승인 완료: pendingId=${pendingId} studentId=${studentId} sibling=${linkedCount}`);
  return { success: true, message: "승인 완료", linkedCount };
}

// ── 관리자: 수동 거절 ────────────────────────────────────────────────────
// pending → rejected 허용
// rejected → rejected: idempotent (오류 없음)
// matched → reject 불가 (이미 승인됨, 연결 해제는 별도 기능)
export async function rejectParentV2Pending(
  pendingId: string,
  poolId: string,
  reason?: string
): Promise<{ success: boolean; message: string }> {
  const [pending] = (await db.execute(sql`
    SELECT id, status FROM parent_v2_pending WHERE id = ${pendingId} AND pool_id = ${poolId} LIMIT 1
  `)).rows as any[];

  if (!pending) return { success: false, message: "요청을 찾을 수 없습니다." };

  if (pending.status === "rejected") {
    // 이미 거절됨 — idempotent
    return { success: true, message: "이미 거절된 요청입니다." };
  }
  if (pending.status === "matched") {
    return { success: false, message: "이미 승인된 요청입니다. 학부모 연결 해제는 별도 기능을 이용해주세요." };
  }

  await db.execute(sql`
    UPDATE parent_v2_pending SET
      status           = 'rejected',
      rejection_reason = ${reason ?? null},
      matched_at       = NOW()
    WHERE id = ${pendingId}
  `);

  return { success: true, message: "거절 완료" };
}

// ── 관리자: pool의 pending_reason=NULL 건 일괄 재시도 ──────────────────
// 기존 NULL pending을 안전한 자동매칭 규칙으로 재시도하고 pending_reason 업데이트
export async function retryNullPendingByPool(
  poolId: string
): Promise<{ retried: number; linked: number; reasonUpdated: number }> {
  const rows = (await db.execute(sql`
    SELECT id, parent_id, child_name_normalized, parent_phone_normalized
    FROM parent_v2_pending
    WHERE pool_id = ${poolId}
      AND status = 'pending'
      AND pending_reason IS NULL
  `)).rows as any[];

  let retried = 0, linked = 0, reasonUpdated = 0;

  for (const r of rows) {
    retried++;
    const { matched, studentId, reason } = await tryMatchStudentV2(
      r.parent_id, poolId, r.parent_phone_normalized, r.child_name_normalized
    );

    if (matched && studentId) {
      const { success } = await linkParentToStudentV2(r.parent_id, studentId, poolId);
      if (success) {
        linked++;
        await markPendingMatchedByParent(r.parent_id, studentId);
        // sibling 연결
        const [pa] = (await db.execute(sql`SELECT phone FROM parent_accounts WHERE id = ${r.parent_id} LIMIT 1`)).rows as any[];
        const phoneNorm = normalizePhone(pa?.phone || "");
        if (phoneNorm) {
          await linkApprovedParentToRegisteredChildren(r.parent_id, poolId, phoneNorm);
        }
      }
    } else {
      // 매칭 실패 → pending_reason 기록 (향후 관리자가 명확히 인지)
      await db.execute(sql`
        UPDATE parent_v2_pending SET pending_reason = ${reason ?? "name_mismatch"}
        WHERE id = ${r.id}
      `);
      reasonUpdated++;
    }
  }

  console.log(`[v2-retry-null] pool=${poolId} retried=${retried} linked=${linked} reasonUpdated=${reasonUpdated}`);
  return { retried, linked, reasonUpdated };
}
