import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

async function verify() {
  const poolRow = await superAdminDb.execute(sql`SELECT id FROM swimming_pools LIMIT 2`);
  if (poolRow.rows.length < 2) { console.log("SKIP: need 2 pool rows"); process.exit(0); }

  const pid1 = poolRow.rows[0].id as string;
  const pid2 = poolRow.rows[1].id as string;

  // cleanup before test
  await superAdminDb.execute(sql`
    DELETE FROM x_monthly_operational_snapshots
    WHERE year = 2099 AND month = 1
  `);

  // 6. duplicate insert blocked
  await superAdminDb.execute(sql`
    INSERT INTO x_monthly_operational_snapshots (swimming_pool_id, year, month)
    VALUES (${pid1}, 2099, 1)
  `);
  let blocked = false;
  try {
    await superAdminDb.execute(sql`
      INSERT INTO x_monthly_operational_snapshots (swimming_pool_id, year, month)
      VALUES (${pid1}, 2099, 1)
    `);
  } catch { blocked = true; }
  console.log("6. same pool/year/month duplicate blocked:", blocked ? "PASS" : "FAIL");

  // 7. different pool same year/month allowed
  let allowed7 = false;
  try {
    await superAdminDb.execute(sql`
      INSERT INTO x_monthly_operational_snapshots (swimming_pool_id, year, month)
      VALUES (${pid2}, 2099, 1)
    `);
    allowed7 = true;
  } catch(e: any) { console.log("7 error:", e.message); }
  console.log("7. different pool same month allowed:", allowed7 ? "PASS" : "FAIL");

  // 8. same pool different month allowed
  let allowed8 = false;
  try {
    await superAdminDb.execute(sql`
      INSERT INTO x_monthly_operational_snapshots (swimming_pool_id, year, month)
      VALUES (${pid1}, 2099, 2)
    `);
    allowed8 = true;
  } catch(e: any) { console.log("8 error:", e.message); }
  console.log("8. same pool different month allowed:", allowed8 ? "PASS" : "FAIL");

  // 9. super_admin aggregate
  const agg = await superAdminDb.execute(sql`
    SELECT
      year, month,
      SUM(ai_diary_count)                 AS total_ai_diary,
      SUM(growth_report_sent_count)       AS total_sent,
      SUM(parent_curriculum_search_count) AS total_searches,
      COUNT(DISTINCT swimming_pool_id)    AS pool_count
    FROM x_monthly_operational_snapshots
    WHERE year = 2099 AND month = 1
    GROUP BY year, month
  `);
  const row = agg.rows[0];
  const ok9 = row && Number(row.pool_count) === 2;
  console.log("9. super_admin aggregate PASS:", ok9 ? "PASS" : "FAIL", JSON.stringify(row));

  // Pool scoped: pid1 조회 시 pid2 row 보이지 않아야
  const scoped = await superAdminDb.execute(sql`
    SELECT COUNT(*) AS cnt FROM x_monthly_operational_snapshots
    WHERE swimming_pool_id = ${pid1} AND year = 2099 AND month = 1
  `);
  console.log("9b. pool scoped isolation:", Number(scoped.rows[0].cnt) === 1 ? "PASS" : "FAIL");

  // cleanup
  await superAdminDb.execute(sql`
    DELETE FROM x_monthly_operational_snapshots WHERE year = 2099
  `);
  console.log("cleanup done");
}

verify().then(() => process.exit(0)).catch(e => {
  console.error("error:", e.message);
  process.exit(1);
});
