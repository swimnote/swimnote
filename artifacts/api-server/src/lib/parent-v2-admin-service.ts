import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { isParentPhoneVerified } from "./parent-phone-proof.js";

const ADMIN_REQUEST_COOLDOWN_SECONDS = 10 * 60;

type SqlExecutor = {
  execute(query: SQL): Promise<any>;
};

type PendingRow = {
  id: string;
  parent_id: string;
  pool_id: string;
  child_name_raw: string;
  parent_phone_normalized: string;
  matched_student_id: string | null;
  status: string;
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
};

export type ApprovalCandidate = Pick<
  StudentRow,
  "id" | "name" | "parent_name" | "parent_phone" | "parent_phone2" | "parent_phone3" | "parent_phone4"
>;

export type ConfirmParentV2Result = {
  success: boolean;
  message: string;
  code?: string;
  linkedCount?: number;
  newRelationCount?: number;
  relationCreated?: boolean;
  alreadyMatched?: boolean;
  students?: Array<{ id: string; name: string }>;
};

export type AdminRequestResult = {
  success: boolean;
  message: string;
  cooldown_seconds?: number;
  push_delivery_status?: "delivered" | "partial" | "failed" | "not_retried" | "suppressed_already_linked";
  already_linked?: boolean;
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
      alreadyLinked?: boolean;
    };

function rowsOf(result: any): any[] {
  return Array.isArray(result?.rows) ? result.rows : [];
}

function phoneIsValid(phone: string): boolean {
  return /^01[016789]\d{7,8}$/.test(phone);
}

export function normalizeV2Phone(value: unknown): string {
  return typeof value === "string" ? value.replace(/[^0-9]/g, "") : "";
}

function eligibleStudentPredicate(alias = "s"): SQL {
  return sql`${sql.raw(alias)}.status IN ('active', 'pending_parent_link')
    AND ${sql.raw(alias)}.deleted_at IS NULL
    AND ${sql.raw(alias)}.withdrawn_at IS NULL`;
}

async function durableParentProofExists(
  executor: SqlExecutor,
  parentId: string,
  phone: string,
): Promise<boolean> {
  if (!phoneIsValid(phone)) return false;
  return isParentPhoneVerified(parentId, phone, executor);
}

export async function getParentV2ApprovalInfo(pendingId: string, poolId: string): Promise<{
  pending_id: string;
  child_name_raw: string;
  parent_name: string;
  parent_phone: string;
  phone_verified: boolean;
  candidates: ApprovalCandidate[];
  reason: string | null;
} | null> {
  const pending = rowsOf(await db.execute(sql`
    SELECT pvp.id, pvp.parent_id, pvp.pool_id, pvp.child_name_raw,
      pvp.parent_phone_normalized, pvp.pending_reason,
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
  const phoneVerified = pending.parent_pool_id === pending.pool_id
    && !!parentPhone
    && parentPhone === pendingPhone
    && await durableParentProofExists(db, pending.parent_id, parentPhone);
  const candidates = rowsOf(await db.execute(sql`
    SELECT s.id, s.name, s.parent_name, s.parent_phone, s.parent_phone2,
      s.parent_phone3, s.parent_phone4
    FROM students s
    WHERE s.swimming_pool_id = ${poolId}
      AND ${eligibleStudentPredicate("s")}
    ORDER BY LOWER(TRIM(COALESCE(s.name, ''))), s.id
  `)) as ApprovalCandidate[];

  return {
    pending_id: pending.id,
    child_name_raw: pending.child_name_raw,
    parent_name: pending.parent_name || "",
    parent_phone: pending.parent_phone || "",
    phone_verified: phoneVerified,
    candidates,
    reason: pending.pending_reason || null,
  };
}

class ConfirmAbort extends Error {
  constructor(readonly result: ConfirmParentV2Result) {
    super(result.message);
  }
}

function failure(code: string, message: string): ConfirmAbort {
  return new ConfirmAbort({ success: false, code, message });
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
  studentId: string,
): Promise<ConfirmParentV2Result> {
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
    throw failure("admin_pool_mismatch", "관리자와 요청 수영장 정보가 일치하지 않습니다.");
  }

  const [pendingSnapshot] = rowsOf(await tx.execute(sql`
    SELECT id, parent_id, pool_id
    FROM parent_v2_pending
    WHERE id = ${pendingId}
      AND pool_id = ${poolId}
    LIMIT 1
  `)) as PendingRow[];
  if (!pendingSnapshot) {
    throw failure("pending_not_found", "요청을 찾을 수 없습니다.");
  }

  const [parent] = rowsOf(await tx.execute(sql`
    SELECT id, swimming_pool_id, is_active, withdrawal_requested_at
    FROM parent_accounts
    WHERE id = ${pendingSnapshot.parent_id}
    FOR SHARE
  `));
  if (
    !parent
    || parent.swimming_pool_id !== poolId
    || parent.is_active !== true
    || parent.withdrawal_requested_at
  ) {
    throw failure("parent_account_invalid", "학부모 계정이 활성 상태가 아니거나 수영장 정보가 일치하지 않습니다.");
  }

  const [pending] = rowsOf(await tx.execute(sql`
    SELECT id, parent_id, pool_id, matched_student_id, status
    FROM parent_v2_pending
    WHERE id = ${pendingId}
      AND pool_id = ${poolId}
    FOR UPDATE
  `)) as PendingRow[];
  if (!pending || pending.parent_id !== pendingSnapshot.parent_id) {
    throw failure("pending_not_found", "요청을 찾을 수 없습니다.");
  }

  const [student] = rowsOf(await tx.execute(sql`
    SELECT id, swimming_pool_id, name, status, deleted_at, withdrawn_at
    FROM students s
    WHERE s.id = ${studentId}
      AND s.swimming_pool_id = ${poolId}
      AND ${eligibleStudentPredicate("s")}
    FOR UPDATE
  `)) as Array<Pick<StudentRow, "id" | "swimming_pool_id" | "name" | "status" | "deleted_at" | "withdrawn_at">>;
  if (!student) {
    throw failure("student_not_eligible", "선택한 학생이 이 수영장에 속하지 않거나 유효하지 않습니다.");
  }

  const [existing] = rowsOf(await tx.execute(sql`
    SELECT student_id, swimming_pool_id, status
    FROM parent_students
    WHERE parent_id = ${pending.parent_id}
      AND student_id = ${student.id}
    FOR UPDATE
  `)) as Array<{ student_id: string; swimming_pool_id: string; status: string }>;

  if (pending.status === "matched") {
    if (
      pending.matched_student_id === student.id
      && existing?.status === "approved"
      && existing.swimming_pool_id === poolId
    ) {
      return {
        success: true,
        alreadyMatched: true,
        linkedCount: 1,
        newRelationCount: 0,
        relationCreated: false,
        students: [{ id: student.id, name: student.name }],
        message: "이미 승인된 요청입니다.",
      };
    }
    throw failure("pending_not_approvable", "현재 승인할 수 없는 요청입니다.");
  }
  if (pending.status !== "pending") {
    throw failure("pending_not_approvable", "현재 승인할 수 없는 요청입니다.");
  }
  if (existing && existing.swimming_pool_id !== poolId) {
    throw failure("relation_pool_mismatch", "기존 관계의 수영장 정보가 일치하지 않습니다.");
  }

  const relationAlreadyApproved = existing?.status === "approved";
  if (!relationAlreadyApproved) {
    const relationId = `ps_admin_v2_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const created = rowsOf(await tx.execute(sql`
      INSERT INTO parent_students
        (id, parent_id, student_id, swimming_pool_id, status, approved_at, approved_by, created_at)
      VALUES
        (${relationId}, ${pending.parent_id}, ${student.id}, ${poolId}, 'approved', NOW(), ${adminId}, NOW())
      ON CONFLICT (parent_id, student_id) DO UPDATE SET
        swimming_pool_id = EXCLUDED.swimming_pool_id,
        status = 'approved',
        approved_at = NOW(),
        approved_by = EXCLUDED.approved_by,
        rejection_reason = NULL
      WHERE parent_students.status <> 'approved'
      RETURNING student_id
    `));
    if (created.length !== 1) {
      throw failure("relation_conflict", "학생 연결 관계를 저장하지 못했습니다.");
    }
  }

  const marked = rowsOf(await tx.execute(sql`
    UPDATE parent_v2_pending
    SET status = 'matched', matched_student_id = ${student.id}, matched_at = NOW()
    WHERE id = ${pendingId}
      AND parent_id = ${pending.parent_id}
      AND pool_id = ${poolId}
      AND status = 'pending'
    RETURNING id
  `));
  if (!marked.length) {
    throw failure("pending_state_changed", "요청 상태가 변경되었습니다. 새로고침 후 다시 확인해 주세요.");
  }

  return {
    success: true,
    message: "승인 완료",
    linkedCount: 1,
    newRelationCount: relationAlreadyApproved ? 0 : 1,
    relationCreated: !relationAlreadyApproved,
    students: [{ id: student.id, name: student.name }],
  };
}

export async function confirmParentV2Pending(
  pendingId: string,
  poolId: string,
  adminId: string,
  studentId: string,
): Promise<ConfirmParentV2Result> {
  try {
    return await db.transaction(tx => confirmInTransaction(tx, pendingId, poolId, adminId, studentId));
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
        SELECT id, parent_id, pool_id, matched_student_id, status
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

      if (pending.matched_student_id) {
        const [linked] = rowsOf(await tx.execute(sql`
          SELECT ps.student_id
          FROM parent_students ps
          JOIN students s ON s.id = ps.student_id
          WHERE ps.parent_id = ${pending.parent_id}
            AND ps.student_id = ${pending.matched_student_id}
            AND ps.swimming_pool_id = ${pending.pool_id}
            AND ps.status = 'approved'
            AND s.id = ${pending.matched_student_id}
            AND s.swimming_pool_id = ${pending.pool_id}
            AND ${eligibleStudentPredicate("s")}
          LIMIT 1
        `));
        if (linked) {
          return {
            success: true,
            recipients: [],
            pool_id: pending.pool_id,
            pending_id: pending.id,
            alreadyLinked: true,
          };
        }
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
          recipients: [],
          pool_id: pending.pool_id,
          pending_id: pending.id,
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
        pool_id: pending.pool_id,
        pending_id: pending.id,
      };
    },
  );

  if (!outcome.success) return outcome;
  if (outcome.alreadyLinked) {
    return {
      success: true,
      message: "이미 승인된 학생 연결이 확인되어 관리자에게 새 요청을 보내지 않았습니다.",
      already_linked: true,
      push_delivery_status: "suppressed_already_linked",
    };
  }
  if (outcome.duplicate) {
    return {
      success: true,
      message: "수영장에 승인 요청을 보냈습니다.",
      cooldown_seconds: outcome.cooldown_seconds,
      push_delivery_status: "not_retried",
    };
  }

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