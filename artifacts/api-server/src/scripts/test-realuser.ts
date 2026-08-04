import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import jwt from "jsonwebtoken";

async function main() {
  // pool_admin 계정 찾기 (실제 앱 사용자)
  const admins = await db.execute(sql`
    SELECT id, name, role, swimming_pool_id FROM users
    WHERE swimming_pool_id = 'pool_1780849364252_l9k44rbk3'
      AND role IN ('pool_admin', 'teacher')
    ORDER BY role
  `);
  console.log("계정 목록:");
  (admins.rows as any[]).forEach(u => console.log(`  id=${u.id} name=${u.name} role=${u.role}`));

  // 모든 waiting 보강 세션 확인
  const mks = await db.execute(sql`
    SELECT ms.id, ms.absence_date, ms.expire_at, ms.status, s.name AS student_name
    FROM makeup_sessions ms
    LEFT JOIN students s ON ms.student_id = s.id
    WHERE ms.swimming_pool_id = 'pool_1780849364252_l9k44rbk3'
      AND ms.status = 'waiting'
    ORDER BY ms.absence_date DESC
    LIMIT 10
  `);
  console.log("\n현재 waiting 보강 세션:");
  (mks.rows as any[]).forEach(m => console.log(`  id=${m.id} student=${m.student_name} 결석=${m.absence_date}`));

  // 금 19:00반 현재 정원 상태 재확인
  const classes = await db.execute(sql`
    SELECT cg.id, cg.name, cg.capacity,
      COUNT(s.id) FILTER (WHERE s.status IN ('active','pending_parent_link','unregistered') AND s.deleted_at IS NULL) AS current_members
    FROM class_groups cg
    LEFT JOIN students s ON s.class_group_id = cg.id OR s.assigned_class_ids @> to_jsonb(cg.id::text)
    WHERE cg.swimming_pool_id = 'pool_1780849364252_l9k44rbk3'
      AND cg.schedule_time = '19:00' AND cg.schedule_days LIKE '%금%'
      AND cg.is_deleted = false
    GROUP BY cg.id, cg.name, cg.capacity
  `);
  console.log("\n금 19:00반 정원 상태:");
  (classes.rows as any[]).forEach(c => console.log(`  id=${c.id} name=${c.name} capacity=${c.capacity} members=${c.current_members} available=${Number(c.capacity)-Number(c.current_members)}`));

  // 각 계정으로 eligible-occurrences 테스트 (서똥깨 makeupId)
  const makeupId = "mk_1784236093093_nmld20r5";
  const classIds = ["cg_1783347645613_2d91i5pg1", "cg_1784008818870_23undl2w7"];

  for (const user of admins.rows as any[]) {
    const token = jwt.sign(
      { userId: user.id, role: user.role, poolId: user.swimming_pool_id, tv: 1 },
      process.env.JWT_SECRET!,
      { expiresIn: "1h" }
    );
    for (const classId of classIds) {
      const url = `https://swimnote-api.onrender.com/api/teacher/makeups/${makeupId}/eligible-occurrences?class_group_id=${classId}`;
      const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
      const body = await res.text();
      const short = body.substring(0, 150);
      console.log(`  [${user.name}/${user.role}] mkId=${makeupId} classId=${classId.slice(-10)} → ${res.status}: ${short}`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
