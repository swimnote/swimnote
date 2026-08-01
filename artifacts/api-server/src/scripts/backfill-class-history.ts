/**
 * backfill-class-history.ts
 *
 * 기존 학생 데이터의 student_class_history 백필.
 * 우선 순위:
 *   1) 이미 history 있는 학생 → skip
 *   2) 해당 반 첫 attendance.date
 *   3) 해당 반 첫 class_diaries.lesson_date
 *   4) students.created_at
 *
 * 실행: pnpm --filter @workspace/api-server tsx src/scripts/backfill-class-history.ts
 * 옵션: --dry-run  → SQL만 출력, 실제 INSERT 안 함
 *       --pool-id=xxx  → 특정 풀만 처리
 */

import { db, superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

const isDryRun = process.argv.includes("--dry-run");
const poolArg  = process.argv.find(a => a.startsWith("--pool-id="))?.split("=")[1] || null;

function genId() {
  return `sch_bf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function main() {
  console.log(`[backfill-class-history] 시작 | dry-run=${isDryRun} | pool-id=${poolArg ?? "ALL"}`);

  // 1) 처리 대상: assigned_class_ids 비어있지 않은 active 학생
  const poolFilter = poolArg ? ` AND s.swimming_pool_id = '${poolArg}'` : "";
  const studentsRes = await db.execute(sql.raw(`
    SELECT s.id          AS student_id,
           s.swimming_pool_id,
           s.class_group_id,
           s.assigned_class_ids,
           s.created_at
    FROM students s
    WHERE s.assigned_class_ids IS NOT NULL
      AND s.assigned_class_ids != '[]'::jsonb
      AND s.deleted_at IS NULL
      ${poolFilter}
    ORDER BY s.id
  `));

  const students = studentsRes.rows as any[];
  console.log(`[backfill] 대상 학생 수: ${students.length}`);

  let inserted = 0;
  let skipped  = 0;
  let errors   = 0;

  for (const st of students) {
    const studentId: string = st.student_id;
    const poolId: string    = st.swimming_pool_id || "";

    // assigned_class_ids 파싱
    let classIds: string[] = [];
    try {
      classIds = Array.isArray(st.assigned_class_ids)
        ? st.assigned_class_ids
        : JSON.parse(st.assigned_class_ids || "[]");
    } catch {
      classIds = st.class_group_id ? [st.class_group_id] : [];
    }

    if (classIds.length === 0) { skipped++; continue; }

    for (const classId of classIds) {
      try {
        // 이미 history 있는지 확인
        const existCheck = await db.execute(sql.raw(`
          SELECT id FROM student_class_history
          WHERE student_id = '${studentId}' AND class_group_id = '${classId}'
          LIMIT 1
        `));
        if ((existCheck.rows as any[]).length > 0) {
          skipped++;
          continue;
        }

        // enrolled_at 결정 (우선순위 순)
        let enrolledAt: string | null = null;

        // 2) 첫 attendance.date
        const attRes = await db.execute(sql.raw(`
          SELECT MIN(date) AS earliest
          FROM attendance
          WHERE student_id = '${studentId}' AND class_group_id = '${classId}'
        `));
        enrolledAt = (attRes.rows[0] as any)?.earliest?.toString?.() ?? null;

        // 3) 첫 class_diaries.lesson_date
        if (!enrolledAt) {
          const diaryRes = await db.execute(sql.raw(`
            SELECT MIN(cd.lesson_date) AS earliest
            FROM class_diaries cd
            JOIN student_notes sn ON sn.diary_id = cd.id AND sn.student_id = '${studentId}'
            WHERE cd.class_group_id = '${classId}'
          `));
          enrolledAt = (diaryRes.rows[0] as any)?.earliest?.toString?.() ?? null;
        }

        // 4) student.created_at
        if (!enrolledAt) {
          enrolledAt = st.created_at
            ? new Date(st.created_at).toISOString().slice(0, 10)
            : new Date().toISOString().slice(0, 10);
        }

        const histId = genId();
        const insertSql = `
          INSERT INTO student_class_history
            (id, student_id, class_group_id, swimming_pool_id, enrolled_at, created_at)
          VALUES
            ('${histId}', '${studentId}', '${classId}', '${poolId}', '${enrolledAt}'::date, NOW())
          ON CONFLICT DO NOTHING
        `;

        if (isDryRun) {
          console.log(`[DRY-RUN] ${insertSql.trim()}`);
        } else {
          await db.execute(sql.raw(insertSql));
          inserted++;
          console.log(`[OK] student=${studentId} class=${classId} enrolled_at=${enrolledAt}`);
        }
      } catch (e: any) {
        errors++;
        console.error(`[ERROR] student=${studentId} class=${classId}:`, e.message);
      }
    }
  }

  console.log(`[backfill-class-history] 완료 | inserted=${inserted} | skipped=${skipped} | errors=${errors}`);
}

main().catch(e => { console.error("[FATAL]", e); process.exit(1); });
