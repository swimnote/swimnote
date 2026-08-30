import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  // curriculum_versions 테이블 존재 여부
  const tableCheck = await superAdminDb.execute(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name IN ('curriculum_versions', 'curriculum_items')
    ORDER BY table_name
  `);
  console.log("TABLE EXISTS:", JSON.stringify(tableCheck.rows, null, 2));

  // 토이키즈 pool_id
  const poolId = "pool_1780849364252_l9k44rbk3";

  // curriculum_versions 직접 조회
  try {
    const cv = await superAdminDb.execute(sql`
      SELECT id, pool_id, version_name, is_active, created_at
      FROM curriculum_versions
      WHERE pool_id = ${poolId}
      ORDER BY created_at DESC LIMIT 5
    `);
    console.log("VERSIONS:", JSON.stringify(cv.rows, null, 2));
  } catch (e: any) {
    console.log("VERSIONS ERROR:", e.message);
  }

  // curriculum_items count (전체)
  try {
    const ci = await superAdminDb.execute(sql`
      SELECT COUNT(*) as total
      FROM curriculum_items ci
      JOIN curriculum_versions cv ON ci.version_id = cv.id
      WHERE cv.pool_id = ${poolId}
    `);
    console.log("ITEMS COUNT:", JSON.stringify(ci.rows, null, 2));
  } catch (e: any) {
    console.log("ITEMS ERROR:", e.message);
  }

  // x_global curriculum_items (pool_id=null or global) count
  try {
    const xg = await superAdminDb.execute(sql`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN is_active THEN 1 ELSE 0 END) as active_count
      FROM curriculum_items
      WHERE pool_id IS NULL
    `);
    console.log("X_GLOBAL ITEMS:", JSON.stringify(xg.rows, null, 2));
  } catch (e: any) {
    console.log("X_GLOBAL ERROR:", e.message);
  }

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
