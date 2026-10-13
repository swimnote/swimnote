import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";

/** Pool, lead/co-teacher and active-class checks share one server-side contract. */
export function classAccessPredicate(userId: string, classId: SQL): SQL {
  return sql`EXISTS (
    SELECT 1 FROM class_groups access_cg JOIN users access_u
      ON access_u.swimming_pool_id = access_cg.swimming_pool_id
    WHERE access_u.id = ${userId} AND access_cg.id = ${classId}
      AND access_cg.is_deleted = false
      AND (access_u.role::text IN ('pool_admin','super_admin')
        OR access_cg.teacher_user_id = ${userId}
        OR access_cg.co_teacher_ids @> to_jsonb(${userId}::text))
  )`;
}

/** Historical membership is date-scoped; the assignment cache is current only. */
export function membershipPredicate(studentId: SQL, classId: SQL, poolId: SQL, date?: string): SQL {
  const day = date ? sql`${date}::date` : sql`(now() AT TIME ZONE 'Asia/Seoul')::date`;
  return sql`(
    EXISTS (SELECT 1 FROM student_class_history membership_h
      WHERE membership_h.student_id = ${studentId}
        AND membership_h.class_group_id = ${classId}
        AND membership_h.swimming_pool_id = ${poolId}
        AND membership_h.enrolled_at <= ${day}
        AND (membership_h.left_at IS NULL OR membership_h.left_at > ${day}))
    OR (${day} = (now() AT TIME ZONE 'Asia/Seoul')::date AND EXISTS (
      SELECT 1 FROM students membership_s
      WHERE membership_s.id = ${studentId}
        AND membership_s.swimming_pool_id = ${poolId}
        AND membership_s.assigned_class_ids @> to_jsonb(${classId}::text)))
  )`;
}

export function studentAccessPredicate(userId: string, studentId: SQL, date?: string): SQL {
  return sql`(EXISTS (SELECT 1 FROM users admin_u JOIN students admin_s
    ON admin_s.swimming_pool_id = admin_u.swimming_pool_id
    WHERE admin_u.id = ${userId} AND admin_s.id = ${studentId}
      AND admin_u.role::text IN ('pool_admin','super_admin'))
    OR EXISTS (SELECT 1 FROM students access_s JOIN class_groups member_cg
    ON member_cg.swimming_pool_id = access_s.swimming_pool_id
    WHERE access_s.id = ${studentId} AND access_s.deleted_at IS NULL
      AND access_s.status IN ('active','pending_parent_link','unregistered')
      AND ${membershipPredicate(sql`access_s.id`, sql`member_cg.id`, sql`access_s.swimming_pool_id`, date)}
      AND ${classAccessPredicate(userId, sql`member_cg.id`)}))`;
}

export async function getCurrentStudentClassIds(studentId: string, date?: string): Promise<string[]> {
  const result = await db.execute(sql`SELECT cg.id FROM students s JOIN class_groups cg
    ON cg.swimming_pool_id = s.swimming_pool_id
    WHERE s.id = ${studentId} AND s.deleted_at IS NULL AND cg.is_deleted = false
      AND ${membershipPredicate(sql`s.id`, sql`cg.id`, sql`s.swimming_pool_id`, date)}
    ORDER BY cg.id`);
  return (result.rows as { id: string }[]).map(row => row.id);
}

export async function teacherCanAccessClass(userId: string, classId: string): Promise<boolean> {
  const result = await db.execute(sql`SELECT 1 WHERE ${classAccessPredicate(userId, sql`${classId}`)}`);
  return result.rows.length > 0;
}

export async function teacherCanAccessStudent(userId: string, studentId: string, date?: string): Promise<boolean> {
  const result = await db.execute(sql`SELECT 1 WHERE ${studentAccessPredicate(userId, sql`${studentId}`, date)}`);
  return result.rows.length > 0;
}

export async function getAccessibleClassIds(userId: string): Promise<string[]> {
  const result = await db.execute(sql`SELECT cg.id FROM class_groups cg
    WHERE ${classAccessPredicate(userId, sql`cg.id`)} ORDER BY cg.id`);
  return (result.rows as { id: string }[]).map(row => row.id);
}
