import { db, superAdminDb } from "../lib/db/src/index.js";
import { sql } from "drizzle-orm";

async function cols(dbConn: typeof db, table: string, label: string) {
  const r = await dbConn.execute(sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = ${table}
    ORDER BY ordinal_position
  `);
  console.log(`\n=== ${label} ${table} ===`);
  r.rows.forEach((c: any) => console.log(`  ${c.column_name}: ${c.data_type}`));
}

await cols(db, "photo_assets_meta", "pool DB");
await cols(db, "video_assets_meta", "pool DB");
await cols(superAdminDb, "data_change_logs", "super DB");
process.exit(0);
