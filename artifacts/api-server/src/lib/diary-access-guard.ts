/**
 * diary-access-guard.ts
 *
 * Canonical helper for "학생이 이 diary를 조회할 수 있는가" 판단.
 *
 * GET /students/:id/diary 와 Reaction POST 양쪽에서 동일 의미를 사용해야 하므로
 * 이 함수를 단일 소스로 관리한다.
 *
 * 접근 허용 조건 (canonical logic):
 *
 *   lesson_date >= student.created_at  (KST 기준)
 *   AND (
 *     (
 *       (valid student_class_history  OR  student.class_group_id = diary.class_group_id)
 *       AND NOT EXISTS (attendance.status = 'absent')
 *     )
 *     OR completed_makeup           ← absent 여부와 무관하게 허용
 *   )
 *
 * ⚠️  completed_makeup 학생은 정규수업 attendance absent 기록이 있어도 반드시 허용.
 *     NOT EXISTS(absent) 를 전체 OR에 적용하지 말 것.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * @returns true  — student가 해당 diary를 조회할 수 있음
 * @returns false — 접근 불가 (403 반환용)
 */
export async function canStudentAccessDiary(
  studentId: string,
  diaryId: string,
): Promise<boolean> {
  const sid = studentId.replace(/'/g, "''");
  const did = diaryId.replace(/'/g, "''");

  const [row] = (await db.execute(sql.raw(`
    SELECT 1
    FROM class_diaries cd
    LEFT JOIN student_class_history sch
      ON sch.class_group_id = cd.class_group_id
      AND sch.student_id = '${sid}'
      AND sch.enrolled_at <= cd.lesson_date::date
      AND (sch.left_at IS NULL OR sch.left_at > cd.lesson_date::date)
    LEFT JOIN makeup_sessions ms
      ON ms.assigned_class_group_id = cd.class_group_id
      AND ms.student_id = '${sid}'
      AND ms.assigned_date = cd.lesson_date
      AND ms.status = 'completed'
    LEFT JOIN students s ON s.id = '${sid}'
    WHERE cd.id = '${did}'
      -- 학생 등록일 이전 diary 차단
      AND cd.lesson_date::date >= (
        SELECT (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date
        FROM students WHERE id = '${sid}' LIMIT 1
      )
      AND (
        -- CASE 정규수업: (재원 이력 OR 현재 class_group_id 직접 일치) AND 결석 아님
        (
          (
            sch.id IS NOT NULL
            OR s.class_group_id = cd.class_group_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM attendance a
            WHERE a.student_id = '${sid}'
              AND a.class_group_id = cd.class_group_id
              AND a.date = cd.lesson_date
              AND a.status = 'absent'
          )
        )
        -- CASE 보강 완료: absent 여부와 무관하게 허용
        OR ms.id IS NOT NULL
      )
    LIMIT 1
  `))).rows as any[];

  return !!row;
}
