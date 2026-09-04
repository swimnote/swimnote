import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  // swimming_pools xmode 관련 컬럼 목록 확인
  const cols = await superAdminDb.execute(sql.raw(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name='swimming_pools' AND column_name ILIKE '%xmode%'
    ORDER BY column_name
  `));
  console.log("=== swimming_pools xmode columns ===");
  for (const r of cols.rows as any[]) console.log(`  ${r.column_name}: ${r.data_type}`);

  if ((cols.rows as any[]).length > 0) {
    const colList = (cols.rows as any[]).map((r:any) => r.column_name).join(', ');
    const pool = await superAdminDb.execute(sql.raw(`SELECT id, ${colList} FROM swimming_pools WHERE id='pool_1784310621737_qryl1x79s'`));
    console.log("\n=== POOL_B STATUS ===");
    if (pool.rows.length > 0) console.log(JSON.stringify(pool.rows[0]));
    else console.log("NOT_FOUND");

    const others = await superAdminDb.execute(sql.raw(`
      SELECT COUNT(*) FILTER(WHERE xmode_entitlement=true) as ent_true,
             COUNT(*) FILTER(WHERE xmode_config_status='READY') as ready,
             COUNT(*) as total
      FROM swimming_pools WHERE id != 'pool_1784310621737_qryl1x79s'
    `));
    console.log("Other pools xmode:", JSON.stringify(others.rows[0]));
  } else {
    console.log("xmode columns NOT FOUND in swimming_pools");
  }

  const audit_x = await superAdminDb.execute(sql.raw(`
    SELECT COUNT(*) as cnt FROM audit_logs WHERE entity_type='swimming_pool_xmode' AND entity_id='pool_1784310621737_qryl1x79s'
  `));
  console.log("X Audit count:", (audit_x.rows[0] as any).cnt);
}
main().catch(e => { console.error("FAIL:", e.message.split('\n')[0]); process.exit(1); });
