import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  const POOL_ID = "pool_1780849364252_l9k44rbk3";

  const sp = await superAdminDb.execute(sql`
    SELECT id, name, name_en, approval_status, deactivated_at,
           deletion_scheduled_at, subscription_status, updated_at
    FROM swimming_pools
    WHERE id = ${POOL_ID}
    LIMIT 1
  `);
  console.log("POOL STATUS:", JSON.stringify(sp.rows, null, 2));
}
main().then(() => process.exit(0)).catch(e => { console.error("ERR:", e.message); process.exit(1); });
