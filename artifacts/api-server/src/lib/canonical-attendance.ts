import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

export type AttendanceKind = "regular" | "makeup" | "extra";
export type AttendanceStatus = "present" | "absent" | "late";

export class AttendanceConflict extends Error {
  readonly code = "LEGACY_ATTENDANCE_IDENTITY_CONFLICT";
}

/**
 * Never upgrade or pick a legacy row. The partial index arbitrates concurrent
 * canonical writers; an explicit legacy collision needs row-id/operator review.
 */
export async function writeCanonicalAttendance(input: {
  poolId: string; studentId: string; classId: string; date: string;
  kind: AttendanceKind; status: AttendanceStatus; actorId?: string; actorName?: string;
  preserveExisting?: boolean;
}, executor: Pick<typeof db, "execute"> = db) {
  if (!input.classId || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    throw new AttendanceConflict("명확한 반과 날짜가 필요합니다.");
  }
  const { poolId, studentId, classId, date, kind, status } = input;
  const context = await executor.execute(sql`SELECT 1 FROM students s JOIN class_groups cg
    ON cg.swimming_pool_id = s.swimming_pool_id
    WHERE s.id = ${studentId} AND cg.id = ${classId}
      AND s.swimming_pool_id = ${poolId} AND cg.is_deleted = false LIMIT 1`);
  if (!context.rows.length) throw new AttendanceConflict("학생과 반의 수영장이 일치하지 않습니다.");
  const legacy = await executor.execute(sql`SELECT 1 FROM attendance
    WHERE swimming_pool_id = ${poolId} AND student_id = ${studentId} AND date = ${date}
      AND (class_group_id IS NULL OR (class_group_id = ${classId} AND session_type IS NULL))
    LIMIT 1`);
  if (legacy.rows.length) throw new AttendanceConflict("미확정 과거 출석이 있습니다. 기존 행을 자동 변경하지 않습니다.");
  const result = await executor.execute(sql`
    INSERT INTO attendance (id, swimming_pool_id, student_id, class_group_id,
      date, session_type, status, created_by, created_by_name, teacher_user_id, teacher_name)
    VALUES (${`att_${randomUUID()}`}, ${poolId}, ${studentId}, ${classId},
      ${date}, ${kind}, ${status}, ${input.actorId ?? null}, ${input.actorName ?? null},
      ${kind === "makeup" ? input.actorId ?? null : null},
      ${kind === "makeup" ? input.actorName ?? null : null})
    ON CONFLICT (student_id, class_group_id, date, session_type)
      WHERE class_group_id IS NOT NULL AND session_type IS NOT NULL
    DO UPDATE SET status = CASE WHEN ${input.preserveExisting ?? false} THEN attendance.status ELSE EXCLUDED.status END,
      updated_at = CASE WHEN ${input.preserveExisting ?? false} THEN attendance.updated_at ELSE now() END,
      modified_by = CASE WHEN ${input.preserveExisting ?? false} THEN attendance.modified_by ELSE EXCLUDED.created_by END,
      modified_by_name = CASE WHEN ${input.preserveExisting ?? false} THEN attendance.modified_by_name ELSE EXCLUDED.created_by_name END,
      teacher_user_id = COALESCE(EXCLUDED.teacher_user_id, attendance.teacher_user_id),
      teacher_name = COALESCE(EXCLUDED.teacher_name, attendance.teacher_name)
    WHERE attendance.swimming_pool_id = EXCLUDED.swimming_pool_id
    RETURNING *
  `);
  if (!result.rows.length) throw new AttendanceConflict("출석 소속 수영장이 일치하지 않습니다.");
  return result.rows[0] as {
    id: string; student_id: string; class_group_id: string;
    swimming_pool_id: string; date: string; session_type: string; status: AttendanceStatus;
  };
}
