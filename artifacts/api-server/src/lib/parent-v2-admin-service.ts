import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { isParentPhoneVerified } from "./parent-phone-proof.js";

const PHONE_MISMATCH_MESSAGE =
  "학부모 인증 전화번호와 등록된 보호자 전화번호가 일치하지 않습니다. 학부모에게 전화번호를 확인해 주세요.";
const NO_STUDENT_MESSAGE =
  "등록된 학생 정보를 확인할 수 없습니다. 신규 회원 등록 또는 회원정보 확인이 필요합니다.";
const ADMIN_REQUEST_COOLDOWN_SECONDS = 10 * 60;

type SqlExecutor = {
  execute(query: SQL): Promise<any>;
};

type PendingRow = {
  id: string;
  parent_id: string;
  pool_id: string;
  child_name_raw: string;
  child_name_normalized: string;
  parent_phone_normalized: string;
  matched_student_id: string | null;
  status?: string;
  pending_reason?: string | null;
  parent_name?: string;
  parent_phone?: string;
  parent_pool_id?: string;
};

type StudentRow = {
  id: string;
  swimming_pool_id: string;
  name: string;
  parent_name: string | null;
  parent_phone: string | null;
  parent_phone2: string | null;
  parent_phone3: string | null;
  parent_phone4: string | null;
  status: string;
  deleted_at: Date | string | null;
  withdrawn_at: Date | string | null;
  parent_user_id?: string | null;
};

export type ApprovalResolution =
  | "stored_student_id"
  | "phone_match"
  | "unique_name_candidate"
  | "unresolved";

type TargetResolution = {
  student: StudentRow | null;
  resolution: ApprovalResolution;
  reason: string | null;
};

export type AllowedStudentEdits = {
  student_id?: string;
  name?: string;
  parent_name?: string | null;
  parent_phone?: string | null;
  parent_phone2?: string | null;
  parent_phone3?: string | null;
  parent_phone4?: string | null;
};

export type ConfirmParentV2Result = {
  success: boolean;
  message: string;
  linkedCount?: number;
  newRelationCount?: number;
  newStudentIds?: string[];
  students?: Array<{ id: string; name: string }>;
  alreadyMatched?: boolean;
  code?: string;
};

export type AdminRequestResult = {
  success: boolean;
  message: string;
  cooldown_seconds?: number;
  push_delivery_status?: "delivered" | "partial" | "failed" | "not_retried";
  recipients?: string[];
  code?: string;
};

type AdminRequestTransactionResult =
  | { success: false; message: string; code: string }
  | {
      success: true;
      recipients: string[];
      pool_id: string;
      pending_id: string;
      cooldown_seconds?: number;
      duplicate?: boolean;
    };

function rowsOf(result: any): any[] {
  return Array.isArray(result?.rows) ? result.rows : [];
}

export function normalizeV2Phone(value: unknown): string {
  return typeof value === "string" ? value.replace(/[^0-9]/g, "") : "";
}

function isSingleName(value: string): boolean {
  return !!value.trim() && !/[,，/&+·、]/.test(value);
}

function normalizeV2Name(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, "").toLowerCase() : "";
}

function phoneIsValid(phone: string): boolean {
  return /^01[016789]\d{7,8}$/.test(phone);
}

function eligibleStudentPredicate(alias = "s"): SQL {
  return sql`${sql.raw(alias)}.status IN ('active', 'pending_parent_link')
    AND ${sql.raw(alias)}.deleted_at IS NULL
    AND ${sql.raw(alias)}.withdrawn_at IS NULL`;
}

function liveStudentPredicate(alias = "s"): SQL {
  return sql`${sql.raw(alias)}.status NOT IN ('withdrawn', 'archived', 'deleted')
    AND ${sql.raw(alias)}.deleted_at IS NULL
    AND ${sql.raw(alias)}.withdrawn_at IS NULL`;
}

function studentColumns(): SQL {
  return sql`id, swimming_pool_id, name, parent_name, parent_phone, parent_phone2,
    parent_phone3, parent_phone4, status, deleted_at, withdrawn_at, parent_user_id`;
}

async function durableParentProofExists(
  executor: SqlExecutor,
  parentId: string,
  phone: string,
): Promise<boolean> {
  if (!phoneIsValid(phone)) return false;
  return isParentPhoneVerified(parentId, phone, executor);
}

async function resolveTarget(
  executor: SqlExecutor,
  pending: PendingRow,
  parentPhone: string,
  lockRows = false,
): Promise<TargetResolution> {
  const lock = lockRows ? sql`FOR UPDATE` : sql``;
  if (pending.matched_student_id) {
    const stored = rowsOf(await executor.execute(sql`
      SELECT ${studentColumns()}
      FROM students s
      WHERE s.id = ${pending.matched_student_id}
        AND s.swimming_pool_id = ${pending.pool_id}
        AND ${eligibleStudentPredicate("s")}
      LIMIT 1
      ${lock}
    `)) as StudentRow[];
    if (stored[0]) {
      return { student: stored[0], resolution: "stored_student_id", reason: null };
    }
  }

  const phone = normalizeV2Phone(parentPhone);
  if (phone) {
    const phoneCandidates = rowsOf(await executor.execute(sql`
      SELECT ${studentColumns()}
      FROM students s
      WHERE s.swimming_pool_id = ${pending.pool_id}
        AND ${liveStudentPredicate("s")}
        AND (
          REGEXP_REPLACE(COALESCE(s.parent_phone,''),  '[^0-9]', '', 'g') = ${phone}
          OR REGEXP_REPLACE(COALESCE(s.parent_phone2,''), '[^0-9]', '', 'g') = ${phone}
          OR REGEXP_REPLACE(COALESCE(s.parent_phone3,''), '[^0-9]', '', 'g') = ${phone}
          OR REGEXP_REPLACE(COALESCE(s.parent_phone4,''), '[^0-9]', '', 'g') = ${phone}
        )
      ORDER BY s.id
      ${lock}
    `)) as StudentRow[];
    if (phoneCandidates.length === 1) {
      if (!["active", "pending_parent_link"].includes(phoneCandidates[0].status)) {
        return { student: null, resolution: "unresolved", reason: "student_not_eligible" };
      }
      return { student: phoneCandidates[0], resolution: "phone_match", reason: null };
    }
    if (phoneCandidates.length > 1) {
      const nameCandidate = await resolveUniqueNameCandidate(
        executor,
        pending,
        lock,
        new Set(phoneCandidates.map(candidate => candidate.id)),
      );
      if (nameCandidate.student) return nameCandidate;
      return { student: null, resolution: "unresolved", reason: "ambiguous_phone_match" };
    }
  }

  return resolveUniqueNameCandidate(executor, pending, lock);
}

async function resolveUniqueNameCandidate(
  executor: SqlExecutor,
  pending: PendingRow,
  lock: SQL,
  allowedStudentIds?: Set<string>,
): Promise<TargetResolution> {
  const normalizedName = normalizeV2Name(pending.child_name_raw);
  if (!isSingleName(pending.child_name_raw) || !normalizedName) {
    return { student: null, resolution: "unresolved", reason: "student_not_found" };
  }
  const nameCandidates = rowsOf(await executor.execute(sql`
    SELECT ${studentColumns()}
    FROM students s
    WHERE s.swimming_pool_id = ${pending.pool_id}
      AND ${liveStudentPredicate("s")}
      AND REPLACE(LOWER(TRIM(COALESCE(s.name,''))), ' ', '') = ${normalizedName}
    ORDER BY s.id
    ${lock}
  `)) as StudentRow[];
  if (nameCandidates.length === 1) {
    if (allowedStudentIds && !allowedStudentIds.has(nameCandidates[0].id)) {
      return { student: null, resolution: "unresolved", reason: "ambiguous_phone_match" };
    }
    if (!["active", "pending_parent_link"].includes(nameCandidates[0].status)) {
      return { student: null, resolution: "unresolved", reason: "student_not_eligible" };
    }
    return { student: nameCandidates[0], resolution: "unique_name_candidate", reason: null };
  }
  return {
    student: null,
    resolution: "unresolved",
    reason: nameCandidates.length > 1 ? "ambiguous_name_match" : "student_not_found",
  };
}

export async function getParentV2ApprovalInfo(pendingId: string, poolId: string): Promise<{
  pending_id: string;
  parent_name: string;
  parent_phone: string;
  phone_verified: boolean;
  student: Pick<StudentRow, "id" | "name" | "parent_name" | "parent_phone" | "parent_phone2" | "parent_phone3" | "parent_phone4"> | null;
  resolution: ApprovalResolution;
  reason: string | null;
} | null> {
  const pending = rowsOf(await db.execute(sql`
    SELECT pvp.id, pvp.parent_id, pvp.pool_id, pvp.child_name_raw,
      pvp.child_name_normalized, pvp.parent_phone_normalized,
      pvp.matched_student_id, pvp.status, pvp.pending_reason,
      pa.name AS parent_name, pa.phone AS parent_phone,
      pa.swimming_pool_id AS parent_pool_id
    FROM parent_v2_pending pvp
    JOIN parent_accounts pa ON pa.id = pvp.parent_id
    WHERE pvp.id = ${pendingId}
      AND pvp.pool_id = ${poolId}
      AND pvp.status IN ('pending', 'rejected')
      AND pa.swimming_pool_id = pvp.pool_id
      AND pa.is_active = true
      AND pa.withdrawal_requested_at IS NULL
    LIMIT 1
  `))[0] as PendingRow | undefined;
  if (!pending) return null;

  const parentPhone = normalizeV2Phone(pending.parent_phone);
  const pendingPhone = normalizeV2Phone(pending.parent_phone_normalized);
  const samePhone = !!parentPhone && parentPhone === pendingPhone;
  const phoneVerified = pending.parent_pool_id === pending.pool_id
    && samePhone
    && await durableParentProofExists(db, pending.parent_id, parentPhone);
  const target = await resolveTarget(db, pending, pending.parent_phone || "");
  const student = target.student
    ? {
        id: target.student.id,
        name: target.student.name,
        parent_name: target.student.parent_name,
        parent_phone: target.student.parent_phone,
        parent_phone2: target.student.parent_phone2,
        parent_phone3: target.student.parent_phone3,
        parent_phone4: target.student.parent_phone4,
      }
    : null;

  return {
    pending_id: pending.id,
    parent_name: pending.parent_name || "",
    parent_phone: pending.parent_phone || "",
    phone_verified: phoneVerified,
    student,
    resolution: target.resolution,
    reason: pending.pending_reason || target.reason,
  };
}

class ConfirmAbort extends Error {
  constructor(readonly result: ConfirmParentV2Result, readonly rollback = false) {
    super(result.message);
  }
}

function failure(code: string, message: string): ConfirmAbort {
  return new ConfirmAbort({ success: false, code, message });
}

function normalizeEditInput(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null && (field === "parent_name" || field.startsWith("parent_phone"))) return null;
  if (typeof value !== "string") {
    throw failure("invalid_student_fields", "학생 정보 입력값이 올바르지 않습니다.");
  }
  return value.trim();
}

function studentPhoneMatches(student: StudentRow, phone: string): boolean {
  return [
    student.parent_phone,
    student.parent_phone2,
    student.parent_phone3,
    student.parent_phone4,
  ].some(value => normalizeV2Phone(value) === phone && !!normalizeV2Phone(value));
}

function adminHasPoolRole(row: any): boolean {
  const role = String(row?.role || "");
  const roles = Array.isArray(row?.roles) ? row.roles : [];
  return ["pool_admin", "sub_admin", "super_admin"].includes(role)
    || roles.some((value: unknown) => ["pool_admin", "sub_admin"].includes(String(value)));
}

async function confirmInTransaction(
  tx: SqlExecutor,
  pendingId: string,
  poolId: string,
  adminId: string,
  edits: AllowedStudentEdits,
): Promise<ConfirmParentV2Result> {
  const [pendingSnapshot] = rowsOf(await tx.execute(sql`
    SELECT id, parent_id, pool_id, child_name_raw, child_name_normalized,
      parent_phone_normalized, matched_student_id, status, pending_reason
    FROM parent_v2_pending
    WHERE id = ${pendingId}
  `)) as PendingRow[];
  if (!pendingSnapshot || pendingSnapshot.pool_id !== poolId) {
    return { success: false, code: "pending_not_found", message: "요청을 찾을 수 없습니다." };
  }

  const [parent] = rowsOf(await tx.execute(sql`
    SELECT id, swimming_pool_id, phone, name, is_active, withdrawal_requested_at
    FROM parent_accounts
    WHERE id = ${pendingSnapshot.parent_id}
    FOR UPDATE
  `));
  if (
    !parent
    || parent.swimming_pool_id !== poolId
    || parent.is_active !== true
    || parent.withdrawal_requested_at
  ) {
    return { success: false, code: "parent_account_invalid", message: "학부모 계정이 활성 상태가 아니거나 수영장 정보가 일치하지 않습니다." };
  }

  // Keep account → pending lock order consistent with the existing verified
  // phone linker, then re-read the pending binding under its row lock.
  const [pending] = rowsOf(await tx.execute(sql`
    SELECT id, parent_id, pool_id, child_name_raw, child_name_normalized,
      parent_phone_normalized, matched_student_id, status, pending_reason
    FROM parent_v2_pending
    WHERE id = ${pendingId}
    FOR UPDATE
  `)) as PendingRow[];
  if (
    !pending
    || pending.parent_id !== pendingSnapshot.parent_id
    || pending.pool_id !== poolId
  ) {
    return { success: false, code: "pending_not_found", message: "요청을 찾을 수 없습니다." };
  }
  if (pending.status === "matched") {
    const linkedStudents = rowsOf(await tx.execute(sql`
      SELECT s.id, s.name
      FROM parent_students ps
      JOIN students s ON s.id = ps.student_id
      WHERE ps.parent_id = ${pending.parent_id}
        AND ps.swimming_pool_id = ${poolId}
        AND ps.status = 'approved'
        AND s.swimming_pool_id = ${poolId}
        AND s.status IN ('active', 'pending_parent_link')
        AND s.deleted_at IS NULL
        AND s.withdrawn_at IS NULL
      ORDER BY s.id
    `)) as Array<{ id: string; name: string }>;
    return {
      success: true,
      alreadyMatched: true,
      linkedCount: linkedStudents.length,
      newRelationCount: 0,
      newStudentIds: [],
      students: linkedStudents,
      message: "이미 승인된 요청입니다.",
    };
  }
  if (!["pending", "rejected"].includes(pending.status || "")) {
    return { success: false, code: "pending_not_approvable", message: "현재 승인할 수 없는 요청입니다." };
  }

  const [admin] = rowsOf(await tx.execute(sql`
    SELECT swimming_pool_id, role::text AS role, roles, is_activated
    FROM users
    WHERE id = ${adminId}
    FOR SHARE
  `));
  if (
    !admin
    || admin.swimming_pool_id !== poolId
    || admin.is_activated !== true
    || !adminHasPoolRole(admin)
  ) {
    return { success: false, code: "admin_pool_mismatch", message: "관리자와 요청 수영장 정보가 일치하지 않습니다." };
  }

  const parentPhone = normalizeV2Phone(parent.phone);
  const pendingPhone = normalizeV2Phone(pending.parent_phone_normalized);
  if (!parentPhone || parentPhone !== pendingPhone) {
    return { success: false, code: "parent_phone_mismatch", message: PHONE_MISMATCH_MESSAGE };
  }
  if (!(await durableParentProofExists(tx, pending.parent_id, parentPhone))) {
    return { success: false, code: "phone_proof_missing", message: "학부모 SMS 인증 정보를 확인할 수 없습니다." };
  }

  const target = await resolveTarget(tx, pending, parentPhone, true);
  if (!target.student) {
    return { success: false, code: target.reason || "student_not_found", message: NO_STUDENT_MESSAGE };
  }
  if (edits.student_id && edits.student_id !== target.student.id) {
    return { success: false, code: "student_id_not_resolved", message: "요청에서 확인된 학생 정보와 일치하지 않습니다." };
  }

  const [lockedTarget] = rowsOf(await tx.execute(sql`
    SELECT ${studentColumns()}
    FROM students s
    WHERE s.id = ${target.student.id}
      AND s.swimming_pool_id = ${poolId}
      AND ${eligibleStudentPredicate("s")}
    ORDER BY s.id
    FOR UPDATE
  `)) as StudentRow[];
  if (!lockedTarget) {
    return { success: false, code: "student_not_eligible", message: NO_STUDENT_MESSAGE };
  }

  const assignments: SQL[] = [];
  const editableFields = ["name", "parent_name", "parent_phone", "parent_phone2", "parent_phone3", "parent_phone4"] as const;
  for (const field of editableFields) {
    const value = normalizeEditInput(edits[field], field);
    if (value === undefined) continue;
    if (field === "name" && !value) {
      return { success: false, code: "invalid_student_fields", message: "학생 이름을 입력해 주세요." };
    }
    assignments.push(sql`${sql.raw(field)} = ${value}`);
  }

  let savedTarget = lockedTarget;
  if (assignments.length) {
    const [saved] = rowsOf(await tx.execute(sql`
      UPDATE students
      SET ${sql.join(assignments, sql`, `)}, updated_at = NOW()
      WHERE id = ${target.student.id}
        AND swimming_pool_id = ${poolId}
        AND status IN ('active', 'pending_parent_link')
        AND deleted_at IS NULL
        AND withdrawn_at IS NULL
      RETURNING ${studentColumns()}
    `)) as StudentRow[];
    if (!saved) {
      return { success: false, code: "student_not_eligible", message: NO_STUDENT_MESSAGE };
    }
    savedTarget = saved;
  }

  if (!studentPhoneMatches(savedTarget, parentPhone)) {
    throw new ConfirmAbort({ success: false, code: "phone_mismatch", message: PHONE_MISMATCH_MESSAGE }, true);
  }

  const siblings = rowsOf(await tx.execute(sql`
    SELECT ${studentColumns()}
    FROM students s
    WHERE s.swimming_pool_id = ${poolId}
      AND ${eligibleStudentPredicate("s")}
      AND (
        s.id = ${target.student.id}
        OR REGEXP_REPLACE(COALESCE(s.parent_phone,''),  '[^0-9]', '', 'g') = ${parentPhone}
        OR REGEXP_REPLACE(COALESCE(s.parent_phone2,''), '[^0-9]', '', 'g') = ${parentPhone}
        OR REGEXP_REPLACE(COALESCE(s.parent_phone3,''), '[^0-9]', '', 'g') = ${parentPhone}
        OR REGEXP_REPLACE(COALESCE(s.parent_phone4,''), '[^0-9]', '', 'g') = ${parentPhone}
      )
    ORDER BY s.id
    FOR UPDATE
  `)) as StudentRow[];

  const existingLinks = rowsOf(await tx.execute(sql`
    SELECT student_id, swimming_pool_id, status, approved_at, approved_by
    FROM parent_students
    WHERE parent_id = ${pending.parent_id}
      AND student_id IN (${sql.join(
        siblings.map(sibling => sql`${sibling.id}`),
        sql`, `,
      )})
    ORDER BY student_id
    FOR UPDATE
  `)) as Array<{
    student_id: string;
    swimming_pool_id: string;
    status: string;
    approved_at: Date | string | null;
    approved_by: string | null;
  }>;
  const existingByStudent = new Map(existingLinks.map(link => [link.student_id, link]));
  if (existingLinks.some(link => link.status === "approved" && link.swimming_pool_id !== poolId)) {
    throw new ConfirmAbort({
      success: false,
      code: "approved_relation_pool_mismatch",
      message: "기존 승인 관계의 수영장 정보가 일치하지 않습니다. 관리자에게 문의해 주세요.",
    }, true);
  }

  const newStudentIds: string[] = [];
  for (const sibling of siblings) {
    if (sibling.id !== target.student.id && !studentPhoneMatches(sibling, parentPhone)) continue;
    const existing = existingByStudent.get(sibling.id);
    if (existing?.status === "approved") continue;
    const relationId = `ps_admin_v2_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const inserted = rowsOf(await tx.execute(sql`
      INSERT INTO parent_students
        (id, parent_id, student_id, swimming_pool_id, status, approved_at, approved_by, created_at)
      VALUES
        (${relationId}, ${pending.parent_id}, ${sibling.id}, ${poolId}, 'approved', NOW(), ${adminId}, NOW())
      ON CONFLICT (parent_id, student_id) DO UPDATE SET
        swimming_pool_id = EXCLUDED.swimming_pool_id,
        status = 'approved',
        approved_at = NOW(),
        approved_by = EXCLUDED.approved_by,
        rejection_reason = NULL
      WHERE parent_students.status <> 'approved'
      RETURNING student_id
    `));
    if (inserted.length > 0) {
      newStudentIds.push(String(inserted[0].student_id));
    } else {
      const [current] = rowsOf(await tx.execute(sql`
        SELECT student_id, swimming_pool_id, status
        FROM parent_students
        WHERE parent_id = ${pending.parent_id}
          AND student_id = ${sibling.id}
        FOR UPDATE
      `));
      if (current?.status === "approved" && current.swimming_pool_id !== poolId) {
        throw new ConfirmAbort({
          success: false,
          code: "approved_relation_pool_mismatch",
          message: "기존 승인 관계의 수영장 정보가 일치하지 않습니다. 관리자에게 문의해 주세요.",
        }, true);
      }
    }
  }

  const marked = rowsOf(await tx.execute(sql`
    UPDATE parent_v2_pending
    SET status = 'matched', matched_student_id = ${target.student.id}, matched_at = NOW()
    WHERE id = ${pendingId}
      AND pool_id = ${poolId}
      AND status IN ('pending', 'rejected')
    RETURNING id
  `));
  if (!marked.length) {
    throw new ConfirmAbort({
      success: false,
      code: "pending_state_changed",
      message: "요청 상태가 변경되었습니다. 새로고침 후 다시 확인해 주세요.",
    }, true);
  }
  return {
    success: true,
    message: "승인 완료",
    linkedCount: siblings.length,
    newRelationCount: newStudentIds.length,
    newStudentIds,
    students: siblings.map(({ id, name }) => ({ id, name })),
  };
}

export async function confirmParentV2Pending(
  pendingId: string,
  poolId: string,
  adminId: string,
  edits: AllowedStudentEdits,
): Promise<ConfirmParentV2Result> {
  try {
    return await db.transaction(tx => confirmInTransaction(tx, pendingId, poolId, adminId, edits));
  } catch (error) {
    if (error instanceof ConfirmAbort) return error.result;
    throw error;
  }
}

export async function requestParentV2AdminHelp(
  pendingId: string | undefined,
  parentId: string,
  sendToAdmin: (userId: string, poolId: string, pendingId: string) => Promise<boolean>,
): Promise<AdminRequestResult> {
  const outcome: AdminRequestTransactionResult = await db.transaction(
    async (tx): Promise<AdminRequestTransactionResult> => {
      const [parent] = rowsOf(await tx.execute(sql`
        SELECT id, swimming_pool_id, is_active, withdrawal_requested_at
        FROM parent_accounts
        WHERE id = ${parentId}
        FOR UPDATE
      `));
      if (
        !parent
        || !parent.swimming_pool_id
        || parent.is_active !== true
        || parent.withdrawal_requested_at
      ) {
        return { success: false, code: "parent_account_invalid", message: "학부모 계정이 활성 상태가 아니거나 수영장 정보가 일치하지 않습니다." };
      }

      const [pending] = rowsOf(await tx.execute(sql`
        SELECT id, parent_id, pool_id, status
        FROM parent_v2_pending
        WHERE (${pendingId ?? null}::text IS NULL OR id = ${pendingId ?? null})
          AND parent_id = ${parentId}
          AND pool_id = ${parent.swimming_pool_id}
          AND status = 'pending'
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        FOR UPDATE
      `));
      if (!pending) {
        return { success: false, code: "pending_not_found", message: "승인 대기 요청을 찾을 수 없습니다." };
      }

      const [recent] = rowsOf(await tx.execute(sql`
        SELECT GREATEST(0, EXTRACT(EPOCH FROM (
          created_at + INTERVAL '10 minutes' - NOW()
        ))::int) AS cooldown_seconds
        FROM notifications
        WHERE type = 'parent_link_admin_request'
          AND ref_id = ${pending.id}
          AND pool_id = ${pending.pool_id}
          AND created_at > NOW() - INTERVAL '10 minutes'
        ORDER BY created_at DESC
        LIMIT 1
      `));
      if (recent) {
        return {
          success: true,
          cooldown_seconds: Math.max(0, Number(recent.cooldown_seconds) || 0),
          recipients: [] as string[],
          pool_id: pending.pool_id as string,
          pending_id: pending.id as string,
          duplicate: true,
        };
      }

      const recipients = rowsOf(await tx.execute(sql`
        INSERT INTO notifications
          (id, recipient_id, recipient_type, type, title, body, ref_id, ref_type, pool_id, is_read)
        SELECT
          gen_random_uuid()::text,
          u.id,
          'user',
          'parent_link_admin_request',
          '학부모 연결 승인 요청',
          '학부모 연결 승인을 기다리는 요청이 있습니다.',
          ${pending.id},
          'parent_v2_pending',
          ${pending.pool_id},
          false
        FROM users u
        WHERE u.swimming_pool_id = ${pending.pool_id}
          AND u.role::text = 'pool_admin'
          AND u.is_activated = true
        RETURNING recipient_id
      `)).map((row: any) => String(row.recipient_id));

      if (recipients.length === 0) {
        return {
          success: false,
          code: "no_active_admins",
          message: "수영장에 활성화된 관리자가 없습니다. 수영장에 문의해 주세요.",
        };
      }

      return {
        success: true,
        recipients,
        pool_id: pending.pool_id as string,
        pending_id: pending.id as string,
      };
    },
  );

  if (!outcome.success) return outcome;
  if (outcome.duplicate) {
    return {
      success: true,
      message: "수영장에 승인 요청을 보냈습니다.",
      cooldown_seconds: outcome.cooldown_seconds,
      push_delivery_status: "not_retried",
    };
  }

  // Dispatch only after the notification transaction is committed, and only to
  // the pool_admin IDs that received the durable notification rows.
  let deliveredCount = 0;
  let failedCount = 0;
  for (const recipientId of outcome.recipients) {
    try {
      if (await sendToAdmin(recipientId, outcome.pool_id, outcome.pending_id)) {
        deliveredCount++;
      } else {
        failedCount++;
      }
    } catch {
      failedCount++;
    }
  }
  const pushDeliveryStatus = failedCount === 0
    ? "delivered"
    : deliveredCount === 0
      ? "failed"
      : "partial";
  return {
    success: true,
    message: "수영장에 승인 요청을 보냈습니다.",
    cooldown_seconds: ADMIN_REQUEST_COOLDOWN_SECONDS,
    push_delivery_status: pushDeliveryStatus,
  };
}