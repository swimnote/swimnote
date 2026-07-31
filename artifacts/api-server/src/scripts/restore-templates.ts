import { superAdminDb, backupProtectDb } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  if (!backupProtectDb) {
    console.error("❌ backupProtectDb 없음 (SUPER_PROTECT_DATABASE_URL 미설정)");
    process.exit(1);
  }

  const res = await (backupProtectDb as any).execute(sql`
    SELECT id, swimming_pool_id, template_text, is_active, created_at
    FROM diary_templates
    WHERE template_text LIKE '오늘은%'
      AND swimming_pool_id = 'pool_1780849364252_l9k44rbk3'
    LIMIT 5
  `);
  console.log("보호 DB에서 발견:", res.rows.length, "개 (샘플)");
  if (res.rows.length > 0) {
    console.log("샘플:", (res.rows[0] as any).template_text?.slice(0, 50));
  }
  process.exit(0);
}

main().catch(e => { console.error(e?.message ?? e); process.exit(1); });
