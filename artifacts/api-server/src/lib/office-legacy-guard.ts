import { sql } from "drizzle-orm";
import { OfficeError } from "./office-command.js";

/** Opt-in compatibility boundary. No legacy behavior changes while Stage 3 is OFF. */
export const officeLegacyGuardEnabled = () => process.env.OFFICE_STAGE3_ENABLED === "true";
export async function guardLegacyMembership(
  tx: { execute: (query: any) => Promise<any> },
  student: { id: string; swimming_pool_id: string; office_revision: string },
  desired: string[], effectiveDate: string,
) {
  if (!officeLegacyGuardEnabled()) return;
  const locked = (await tx.execute(sql`SELECT s.*, md5(row_to_json(s)::text) AS office_revision
    FROM students s WHERE id=${student.id} FOR UPDATE`)).rows[0];
  if (!locked || locked.office_revision !== student.office_revision)
    throw new OfficeError(409, "CONFLICT", "다른 변경이 있습니다. 최신 회원 정보를 조회하세요.");
  const previous: string[] = Array.isArray(locked.assigned_class_ids) && locked.assigned_class_ids.length
    ? locked.assigned_class_ids : locked.class_group_id ? [locked.class_group_id] : [];
  const ids = [...new Set([...previous, ...desired])].sort();
  if (!ids.length) return;
  const groups = (await tx.execute(sql`SELECT * FROM class_groups
    WHERE id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)}) ORDER BY id FOR UPDATE`)).rows;
  if (groups.length !== ids.length || groups.some((g: any) => g.swimming_pool_id !== student.swimming_pool_id || g.is_deleted))
    throw new OfficeError(409, "CLASS", "현재 수영장의 활성 반을 확인하세요.");
  for (const id of desired.filter(id => !previous.includes(id))) {
    const target = groups.find((g: any) => g.id === id);
    const count = (await tx.execute(sql`SELECT count(DISTINCT s.id)::int AS count
      FROM students s JOIN student_class_history h ON h.student_id=s.id
      WHERE s.swimming_pool_id=${student.swimming_pool_id} AND s.status='active'
        AND h.class_group_id=${id} AND h.enrolled_at<=${effectiveDate}::date
        AND (h.left_at IS NULL OR h.left_at>${effectiveDate}::date)`)).rows[0].count;
    if (target.capacity != null && +count >= target.capacity)
      throw new OfficeError(409, "CAPACITY", "목적 반 정원이 찼습니다.");
  }
}
