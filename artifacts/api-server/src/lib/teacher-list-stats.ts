import { sql, type SQL } from "drizzle-orm";

type StatsDb = { execute(query: SQL): Promise<{ rows: unknown[] }> };

/**
 * Keep each one-to-many source separate until it has one row per teacher.
 * Invite rows remain the driver, preserving the existing no-invite fallback.
 */
export function teacherListStatsQuery(poolId: string, teacherIds: string[], today: string): SQL {
  return sql`
    WITH teacher_base AS (
      SELECT id FROM users
      WHERE swimming_pool_id = ${poolId} AND role = 'teacher'
        AND id = ANY(${sql.param(teacherIds)}::text[])
    ), classes AS (
      SELECT cg.id, cg.teacher_user_id AS user_id
      FROM class_groups cg JOIN teacher_base t ON t.id = cg.teacher_user_id
      WHERE cg.swimming_pool_id = ${poolId} AND cg.is_deleted = false
    ), class_stats AS (
      SELECT user_id, COUNT(DISTINCT id)::int AS class_count FROM classes GROUP BY user_id
    ), student_stats AS (
      SELECT c.user_id, COUNT(DISTINCT s.id)::int AS student_count
      FROM classes c JOIN students s ON s.class_group_id = c.id
      WHERE s.status NOT IN ('withdrawn','deleted') GROUP BY c.user_id
    ), attendance_stats AS (
      SELECT c.user_id, COUNT(DISTINCT a.id)::int AS today_att
      FROM classes c JOIN attendance a ON a.class_group_id = c.id
      WHERE a.date = ${today} GROUP BY c.user_id
    ), diary_stats AS (
      SELECT c.user_id, COUNT(DISTINCT cd.id)::int AS today_diary
      FROM classes c JOIN class_diaries cd ON cd.class_group_id = c.id
      WHERE cd.swimming_pool_id = ${poolId}
        AND cd.lesson_date = ${today} AND cd.is_deleted = false
      GROUP BY c.user_id
    ), makeup_teachers AS (
      SELECT mk.id, t.id AS user_id
      FROM makeup_sessions mk JOIN teacher_base t ON t.id = mk.original_teacher_id
      WHERE mk.swimming_pool_id = ${poolId} AND mk.status IN ('waiting','transferred')
      UNION
      SELECT mk.id, t.id AS user_id
      FROM makeup_sessions mk JOIN teacher_base t ON t.id = mk.assigned_teacher_id
      WHERE mk.swimming_pool_id = ${poolId} AND mk.status IN ('waiting','transferred')
      UNION
      SELECT mk.id, t.id AS user_id
      FROM makeup_sessions mk JOIN teacher_base t ON t.id = mk.transferred_to_teacher_id
      WHERE mk.swimming_pool_id = ${poolId} AND mk.status IN ('waiting','transferred')
    ), makeup_stats AS (
      SELECT user_id, COUNT(*)::int AS makeup_waiting FROM makeup_teachers GROUP BY user_id
    )
    SELECT ti.user_id, ti.id AS invite_id, ti.invite_status, ti.rejection_reason,
      ti.approved_at, ti.created_at AS joined_at,
      COALESCE(cs.class_count,0) AS class_count,
      COALESCE(ss.student_count,0) AS student_count,
      COALESCE(a.today_att,0) AS today_att,
      COALESCE(d.today_diary,0) AS today_diary,
      COALESCE(m.makeup_waiting,0) AS makeup_waiting
    FROM teacher_invites ti JOIN teacher_base t ON t.id = ti.user_id
    LEFT JOIN class_stats cs ON cs.user_id = t.id
    LEFT JOIN student_stats ss ON ss.user_id = t.id
    LEFT JOIN attendance_stats a ON a.user_id = t.id
    LEFT JOIN diary_stats d ON d.user_id = t.id
    LEFT JOIN makeup_stats m ON m.user_id = t.id
    WHERE ti.swimming_pool_id = ${poolId}
    ORDER BY ti.user_id, ti.id
  `;
}

export async function loadTeacherListStats(
  db: StatsDb, poolId: string, teacherIds: string[], today: string,
): Promise<Record<string, any>[]> {
  return (await db.execute(teacherListStatsQuery(poolId, teacherIds, today))).rows as Record<string, any>[];
}
