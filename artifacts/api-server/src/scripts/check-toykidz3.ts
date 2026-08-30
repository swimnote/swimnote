import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  // curriculum_versions 컬럼 확인
  const cols = await superAdminDb.execute(sql`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name IN ('curriculum_versions', 'curriculum_items')
    ORDER BY table_name, ordinal_position
  `);
  console.log("COLUMNS:", JSON.stringify(cols.rows, null, 2));

  // 전체 행 수
  const cvCount = await superAdminDb.execute(sql`SELECT COUNT(*) as c FROM curriculum_versions`);
  console.log("curriculum_versions total:", cvCount.rows[0]);

  const ciCount = await superAdminDb.execute(sql`SELECT COUNT(*) as c FROM curriculum_items`);
  console.log("curriculum_items total:", ciCount.rows[0]);

  // sample rows
  const cvSample = await superAdminDb.execute(sql`SELECT * FROM curriculum_versions LIMIT 2`);
  console.log("curriculum_versions sample:", JSON.stringify(cvSample.rows, null, 2));

  process.exit(0);
}
main().catch(e => { console.error("ERR:", e.message); process.exit(1); });
