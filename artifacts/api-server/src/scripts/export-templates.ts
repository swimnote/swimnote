import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  const r = await db.execute(sql`
    SELECT id, category, level, template_text
    FROM diary_templates
    ORDER BY category, level, template_text
  `);
  console.log(JSON.stringify(r.rows, null, 2));
  console.log("\n총 " + r.rows.length + "개");
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
