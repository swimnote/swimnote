import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("=== eligible-occurrences 진단 ===");

  // 1. pool_holidays 테이블 존재 확인
  try {
    const r = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM pool_holidays LIMIT 1`);
    console.log("pool_holidays 테이블 OK, 건수:", (r.rows[0] as any)?.cnt);
  } catch (e: any) {
    console.error("pool_holidays 오류:", e.message);
  }

  // 2. waiting/expired 보강 세션 조회
  let makeupId = "", poolId = "";
  try {
    const r = await db.execute(sql`
      SELECT id, absence_date, expire_at, swimming_pool_id, status
      FROM makeup_sessions
      WHERE status IN ('waiting','expired')
      LIMIT 3
    `);
    console.log("보강 세션:", JSON.stringify(r.rows));
    if (r.rows.length > 0) {
      makeupId = (r.rows[0] as any).id;
      poolId = (r.rows[0] as any).swimming_pool_id;
    }
  } catch (e: any) {
    console.error("makeup_sessions 오류:", e.message);
    process.exit(1);
  }

  if (!makeupId) { console.log("waiting/expired 보강 건 없음"); process.exit(0); }

  // 3. 해당 풀의 반 목록
  let classId = "";
  try {
    const r = await db.execute(sql`
      SELECT id, name, schedule_days, is_deleted, is_one_time
      FROM class_groups
      WHERE swimming_pool_id = ${poolId}
        AND is_deleted = false
        AND (is_one_time = false OR is_one_time IS NULL)
      LIMIT 5
    `);
    console.log("반 목록:", JSON.stringify(r.rows));
    if (r.rows.length > 0) classId = (r.rows[0] as any).id;
  } catch (e: any) {
    console.error("class_groups 오류:", e.message);
  }

  if (!classId) { console.log("반 없음"); process.exit(0); }

  // 4. eligible-occurrences의 class 조회 (실제 쿼리 그대로)
  try {
    const userId = "test_user";
    const r = await db.execute(sql`
      SELECT cg.id, cg.name, cg.schedule_days, cg.schedule_time, cg.capacity,
        cg.teacher_user_id, u.name AS instructor,
        (cg.teacher_user_id = ${userId} OR cg.co_teacher_ids @> to_jsonb(${userId}::text)) AS is_mine
      FROM class_groups cg
      LEFT JOIN users u ON cg.teacher_user_id = u.id
      WHERE cg.id = ${classId}
        AND cg.swimming_pool_id = ${poolId}
        AND cg.is_deleted = false
        AND (cg.is_one_time = false OR cg.is_one_time IS NULL)
      LIMIT 1
    `);
    console.log("eligible-occurrences class 조회:", JSON.stringify(r.rows));
  } catch (e: any) {
    console.error("eligible-occurrences class 쿼리 오류:", e.message);
  }

  // 5. pool_holidays 조회
  try {
    const absenceDate = "2026-07-01";
    const endDate = "2026-08-31";
    const r = await db.execute(sql`
      SELECT TO_CHAR(holiday_date, 'YYYY-MM-DD') AS hd
      FROM pool_holidays
      WHERE pool_id = ${poolId}
        AND holiday_date >= ${absenceDate}::date
        AND holiday_date <= ${endDate}::date
    `);
    console.log("pool_holidays 조회 OK:", r.rows.length, "건");
  } catch (e: any) {
    console.error("pool_holidays 조회 오류:", e.message);
  }

  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
