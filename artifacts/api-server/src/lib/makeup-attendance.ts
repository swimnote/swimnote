import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { writeCanonicalAttendance, AttendanceConflict } from "./canonical-attendance.js";

/** Completion and its canonical attendance reference commit or roll back together. */
export async function completeMakeupAttendance(input: {
  makeupId: string; poolId: string; studentId: string; classId: string;
  date: string; actorId: string; actorName: string; className?: string; isSubstitute?: boolean;
}) {
  return db.transaction(async tx => {
    const locked = await tx.execute(sql`SELECT status FROM makeup_sessions
      WHERE id = ${input.makeupId} AND swimming_pool_id = ${input.poolId}
        AND student_id = ${input.studentId} FOR UPDATE`);
    const row = locked.rows[0] as { status: string } | undefined;
    if (!row || !["waiting", "assigned", "expired"].includes(row.status)) {
      throw new AttendanceConflict("이미 처리되었거나 접근할 수 없는 보강입니다.");
    }
    const attendance = await writeCanonicalAttendance({
      poolId: input.poolId, studentId: input.studentId, classId: input.classId,
      date: input.date, kind: "makeup", status: "present",
      actorId: input.actorId, actorName: input.actorName,
    }, tx);
    await tx.execute(sql`UPDATE makeup_sessions SET status = 'completed',
      is_substitute = COALESCE(${input.isSubstitute ?? null}::boolean, is_substitute),
      substitute_teacher_id = CASE WHEN ${input.isSubstitute ?? false} THEN ${input.actorId} ELSE substitute_teacher_id END,
      substitute_teacher_name = CASE WHEN ${input.isSubstitute ?? false} THEN ${input.actorName} ELSE substitute_teacher_name END,
      assigned_date = ${input.date}, assigned_class_group_id = ${input.classId},
      assigned_class_group_name = COALESCE(${input.className ?? null}, assigned_class_group_name),
      completed_attendance_id = ${attendance.id}, completed_at = now(), updated_at = now()
      WHERE id = ${input.makeupId} AND swimming_pool_id = ${input.poolId}`);
    return attendance;
  });
}
