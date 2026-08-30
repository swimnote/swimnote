import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  const poolId = "pool_1780849364252_l9k44rbk3"; // 토이키즈스윔클럽

  // 올바른 컬럼명으로 curriculum_versions 조회
  const cv = await superAdminDb.execute(sql`
    SELECT id, swimming_pool_id, version_name, is_active, created_at
    FROM curriculum_versions
    WHERE swimming_pool_id = ${poolId}
    ORDER BY created_at DESC LIMIT 5
  `);
  console.log("토이키즈 VERSIONS:", JSON.stringify(cv.rows, null, 2));

  // 올바른 컬럼명으로 curriculum_items count
  const ci = await superAdminDb.execute(sql`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN ci.is_active THEN 1 ELSE 0 END) as active_count
    FROM curriculum_items ci
    JOIN curriculum_versions cv ON ci.curriculum_version_id = cv.id
    WHERE cv.swimming_pool_id = ${poolId}
  `);
  console.log("토이키즈 ITEMS:", JSON.stringify(ci.rows, null, 2));

  // 전체 curriculum_versions 요약
  const allCv = await superAdminDb.execute(sql`
    SELECT swimming_pool_id, COUNT(*) as versions, MAX(is_active::int) as has_active
    FROM curriculum_versions
    GROUP BY swimming_pool_id
  `);
  console.log("ALL POOL curriculum_versions:", JSON.stringify(allCv.rows, null, 2));

  process.exit(0);
}
main().catch(e => { console.error("ERR:", e.message); process.exit(1); });
