async function main() {
  const { superAdminDb } = await import("../../lib/db/src/index.js");
  const { sql } = await import("drizzle-orm");
  const poolId = "pool_1780849364252_l9k44rbk3";

  // event_logs 테이블 컬럼 확인
  const cols = (await superAdminDb.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'event_logs' ORDER BY ordinal_position
  `)).rows as any[];
  console.log("event_logs columns:", cols.map((c:any)=>c.column_name).join(", "));

  // 오늘 event_logs
  const evts = (await superAdminDb.execute(sql`
    SELECT * FROM event_logs
    WHERE pool_id = ${poolId}
    ORDER BY created_at DESC
    LIMIT 20
  `)).rows;
  console.log("=== event_logs (최근 20건) ===");
  console.log(JSON.stringify(evts, null, 2));

  process.exit(0);
}
main().catch(e => { console.error(e.message ?? e); process.exit(1); });
