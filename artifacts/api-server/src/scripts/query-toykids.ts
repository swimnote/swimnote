import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  const rows = await superAdminDb.execute(sql`
    SELECT sp.name_en, sp.approval_status, sp.deactivated_at,
           sp.deletion_scheduled_at, sp.updated_at
    FROM swimming_pools sp
    WHERE sp.name_en ILIKE 'toykids'
    LIMIT 1
  `);
  console.log("POOL:", JSON.stringify(rows.rows));

  const pa = await superAdminDb.execute(sql`
    SELECT pa.login_id, pa.is_active, pa.withdrawal_requested_at,
           sp.name_en, sp.deactivated_at
    FROM parent_accounts pa
    JOIN swimming_pools sp ON pa.swimming_pool_id = sp.id
    WHERE pa.login_id ILIKE 'toykids'
    LIMIT 1
  `);
  console.log("PARENT:", JSON.stringify(pa.rows));

  const usr = await superAdminDb.execute(sql`
    SELECT u.email, u.role, u.is_activated, u.swimming_pool_id
    FROM users u
    JOIN swimming_pools sp ON u.swimming_pool_id = sp.id
    WHERE sp.name_en ILIKE 'toykids' AND u.role = 'pool_admin'
    LIMIT 1
  `);
  console.log("USER:", JSON.stringify(usr.rows));
}
main().then(() => process.exit(0)).catch(e => { console.error("ERR:", e.message); process.exit(1); });
