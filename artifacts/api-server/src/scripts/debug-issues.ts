import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import jwt from "jsonwebtoken";

async function main() {
  // 1. 서똥깨 학생 및 makeup 확인
  const seottong = await db.execute(sql`
    SELECT s.id, s.name, s.status, s.deleted_at, s.class_group_id,
      ms.id AS makeup_id, ms.status AS mk_status, ms.absence_date
    FROM makeup_sessions ms
    LEFT JOIN students s ON ms.student_id = s.id
    WHERE ms.id = 'mk_1784236093093_nmld20r5'
  `);
  console.log("서똥깨 makeup:", JSON.stringify(seottong.rows[0], null, 2));

  // 2. 서태웅 학생 찾기
  const taewung = await db.execute(sql`
    SELECT s.id, s.name, s.class_group_id, s.status, s.deleted_at,
      cg.name AS class_name
    FROM students s
    LEFT JOIN class_groups cg ON s.class_group_id = cg.id
    WHERE s.name LIKE '%서태웅%' OR s.name LIKE '%태웅%'
    LIMIT 5
  `);
  console.log("\n서태웅:", JSON.stringify(taewung.rows));

  // 3. 서태웅 makeup_sessions
  for (const st of taewung.rows as any[]) {
    const mks = await db.execute(sql`
      SELECT id, absence_date, expire_at, status, student_id
      FROM makeup_sessions
      WHERE student_id = ${st.id} AND status = 'waiting'
    `);
    console.log(`${st.name} 보강:`, JSON.stringify(mks.rows));

    // 4. 서태웅 목 19:00반 eligible-occurrences 테스트
    for (const mk of mks.rows as any[]) {
      const token = jwt.sign(
        { userId: "user_1780849364252_dpsmr50cf", role: "pool_admin", poolId: "pool_1780849364252_l9k44rbk3", tv: 1 },
        process.env.JWT_SECRET!,
        { expiresIn: "1h" }
      );
      // 목 19:00반 찾기
      const thuClasses = await db.execute(sql`
        SELECT id, name FROM class_groups
        WHERE swimming_pool_id = 'pool_1780849364252_l9k44rbk3'
          AND schedule_days LIKE '%목%' AND schedule_time = '19:00'
          AND is_deleted = false
      `);
      console.log("목 19:00반:", JSON.stringify(thuClasses.rows));
      for (const cg of thuClasses.rows as any[]) {
        const url = `https://swimnote-api.onrender.com/api/teacher/makeups/${mk.id}/eligible-occurrences?class_group_id=${cg.id}`;
        const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
        console.log(`  mkId=${mk.id} cgId=${cg.id} → ${res.status}: ${(await res.text()).substring(0, 200)}`);
      }
    }
  }

  // 5. 소멸(extinguish) API 확인
  const extinguishRes = await fetch(
    `https://swimnote-api.onrender.com/api/teacher/makeups/mk_1784236093093_nmld20r5/extinguish`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt.sign({ userId: "user_1780849364252_dpsmr50cf", role: "pool_admin", poolId: "pool_1780849364252_l9k44rbk3", tv: 1 }, process.env.JWT_SECRET!, { expiresIn: "1h" })}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason: "test" }),
    }
  );
  console.log("\n소멸 API:", extinguishRes.status, await extinguishRes.text());

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
