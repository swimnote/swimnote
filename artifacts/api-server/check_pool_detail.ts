async function main() {
  const { superAdminDb } = await import("../../lib/db/src/index.js");
  const { sql } = await import("drizzle-orm");

  // "토이키즈스윔클럽" (Premier 1000 / 2035-12-31) - 메인 운영자 후보
  const poolId = "pool_1780849364252_l9k44rbk3";

  // 1. pool_subscriptions 조회
  const subs = (await superAdminDb.execute(sql`
    SELECT * FROM pool_subscriptions WHERE swimming_pool_id = ${poolId} LIMIT 5
  `)).rows;
  console.log("=== pool_subscriptions ===");
  console.log(JSON.stringify(subs, null, 2));

  // 2. 이벤트 로그 (최근 20건)
  const events = (await superAdminDb.execute(sql`
    SELECT id, pool_id, category, actor_name, description, created_at
    FROM pool_event_logs
    WHERE pool_id = ${poolId}
    ORDER BY created_at DESC
    LIMIT 20
  `)).rows;
  console.log("=== pool_event_logs (최근 20건) ===");
  console.log(JSON.stringify(events, null, 2));

  // 3. 전체 풀 수 확인
  const cnt = (await superAdminDb.execute(sql`SELECT COUNT(*) FROM swimming_pools`)).rows;
  console.log("=== total pools ===", cnt);

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
