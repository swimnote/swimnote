async function main() {
  const { superAdminDb } = await import("../../lib/db/src/index.js");
  const { sql } = await import("drizzle-orm");
  const poolId = "pool_1780849364252_l9k44rbk3";

  // ops_alerts 테이블 유무 확인
  const tables = (await superAdminDb.execute(sql`
    SELECT table_name FROM information_schema.tables WHERE table_name ILIKE '%ops%' OR table_name ILIKE '%alert%'
  `)).rows as any[];
  console.log("ops/alert tables:", JSON.stringify(tables));

  // ops_alerts 가 있으면 오늘 것 조회
  try {
    const cols = (await superAdminDb.execute(sql`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'ops_alerts' ORDER BY ordinal_position
    `)).rows as any[];
    console.log("ops_alerts columns:", cols.map((c:any)=>c.column_name).join(", "));

    const alerts = (await superAdminDb.execute(sql`
      SELECT * FROM ops_alerts 
      WHERE created_at > NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC LIMIT 20
    `)).rows;
    console.log("=== ops_alerts (7일) ===");
    console.log(JSON.stringify(alerts, null, 2));
  } catch(e:any) { console.log("ops_alerts 없음:", e.message); }

  // payment_logs 오늘치
  try {
    const pl = (await superAdminDb.execute(sql`
      SELECT * FROM payment_logs
      WHERE pool_id = ${poolId}
      ORDER BY created_at DESC LIMIT 10
    `)).rows;
    console.log("=== payment_logs ===", JSON.stringify(pl, null, 2));
  } catch(e:any) { console.log("payment_logs 없음:", e.message); }

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
