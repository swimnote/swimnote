async function main() {
  const { superAdminDb } = await import("../../lib/db/src/index.js");
  const { sql } = await import("drizzle-orm");

  const poolId = "pool_1780849364252_l9k44rbk3";

  // 이벤트 로그 컬럼명 확인
  const cols = (await superAdminDb.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'pool_event_logs' ORDER BY ordinal_position
  `)).rows;
  console.log("=== pool_event_logs columns ===", JSON.stringify(cols));

  // 오늘 이후 전체 이벤트
  const events = (await superAdminDb.execute(sql`
    SELECT * FROM pool_event_logs
    WHERE pool_id = ${poolId}
    ORDER BY created_at DESC
    LIMIT 30
  `)).rows;
  console.log("=== pool_event_logs (최근 30건) ===");
  console.log(JSON.stringify(events, null, 2));

  // swimming_pools 이력 (audit log 테이블이 있다면)
  const auditTables = (await superAdminDb.execute(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_name ILIKE '%audit%' OR table_name ILIKE '%log%' OR table_name ILIKE '%history%'
    ORDER BY table_name
  `)).rows;
  console.log("=== audit/log tables ===", JSON.stringify(auditTables));

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
