import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
async function main() {
  const res = await db.execute(sql.raw(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='photo_assets_meta' ORDER BY ordinal_position"
  ));
  console.log("photo_assets_meta columns:");
  for (const r of res.rows as any[]) {
    console.log(`  ${r.column_name}  (${r.data_type})`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
