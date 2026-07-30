async function main() {
  const { superAdminDb } = await import("../../lib/db/src/index.js");
  const { sql } = await import("drizzle-orm");

  const poolId = "pool_1780849364252_l9k44rbk3";

  // pool_change_logs 컬럼 확인
  const cols = (await superAdminDb.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'pool_change_logs' ORDER BY ordinal_position
  `)).rows;
  console.log("pool_change_logs columns:", JSON.stringify(cols.map((c:any)=>c.column_name)));

  // 오늘 변경 이력
  const changes = (await superAdminDb.execute(sql`
    SELECT * FROM pool_change_logs
    WHERE pool_id = ${poolId}
      AND created_at > NOW() - INTERVAL '24 hours'
    ORDER BY created_at DESC
    LIMIT 20
  `)).rows;
  console.log("=== pool_change_logs (24h) ===");
  console.log(JSON.stringify(changes, null, 2));

  // data_change_logs 컬럼 확인
  const dcols = (await superAdminDb.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'data_change_logs' ORDER BY ordinal_position
  `)).rows;
  console.log("data_change_logs columns:", JSON.stringify(dcols.map((c:any)=>c.column_name)));

  // data_change_logs 오늘 변경 (수영장 관련)
  const dc = (await superAdminDb.execute(sql`
    SELECT * FROM data_change_logs
    WHERE (table_name = 'swimming_pools' OR table_name = 'pool_subscriptions')
      AND created_at > NOW() - INTERVAL '24 hours'
    ORDER BY created_at DESC
    LIMIT 20
  `)).rows;
  console.log("=== data_change_logs (24h, swimming_pools/pool_subscriptions) ===");
  console.log(JSON.stringify(dc, null, 2));

  // ops_alerts 확인
  const alerts = (await superAdminDb.execute(sql`
    SELECT * FROM ops_alerts
    WHERE related_pool_id = ${poolId}
      AND created_at > NOW() - INTERVAL '24 hours'
    ORDER BY created_at DESC
    LIMIT 20
  `)).rows.catch ? [] : (await superAdminDb.execute(sql`
    SELECT table_name FROM information_schema.tables WHERE table_name ILIKE '%ops%' OR table_name ILIKE '%alert%'
  `)).rows;

  process.exit(0);
}
main().catch(e => { console.error(e.message ?? e); process.exit(1); });
