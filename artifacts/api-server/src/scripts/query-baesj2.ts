import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  // 1. 배서준 makeup_sessions 전체
  const rows = (await db.execute(sql`
    SELECT 
      ms.id, ms.student_id, ms.student_name,
      TO_CHAR(ms.absence_date, 'YYYY-MM-DD') AS absence_date,
      TO_CHAR(ms.expire_at, 'YYYY-MM-DD') AS expire_at,
      ms.status, ms.source_type,
      ms.original_teacher_id,
      ms.handed_to_teacher_id,
      ms.original_class_group_id,
      ms.assigned_class_group_id,
      TO_CHAR(ms.assigned_date, 'YYYY-MM-DD') AS assigned_date,
      TO_CHAR(ms.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS created_at,
      TO_CHAR(ms.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS updated_at,
      ms.swimming_pool_id,
      ms.can_expire
    FROM makeup_sessions ms
    WHERE ms.student_name LIKE '%배서준%'
    ORDER BY ms.created_at DESC
    LIMIT 10
  `)).rows;
  console.log("=== 배서준 makeup_sessions ===");
  console.log(JSON.stringify(rows, null, 2));

  // 2. waiting 상태 row의 class_group_id 확인
  for (const r of rows as any[]) {
    if (r.status === 'waiting' || r.status === 'expired') {
      const cgRows = (await db.execute(sql`
        SELECT id, name, is_one_time, is_deleted, swimming_pool_id, schedule_days, schedule_time, capacity, teacher_user_id, co_teacher_ids
        FROM class_groups
        WHERE id = ${r.original_class_group_id}
        LIMIT 1
      `)).rows;
      console.log(`\n=== original class_group (${r.original_class_group_id}) ===`);
      console.log(JSON.stringify(cgRows[0] ?? null, null, 2));
    }
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
