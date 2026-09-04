import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  // 와일드카드로 재검색
  const sp = await superAdminDb.execute(sql`
    SELECT name_en, approval_status, deactivated_at FROM swimming_pools
    WHERE name_en ILIKE '%toykids%' OR name ILIKE '%toykids%'
    LIMIT 5
  `);
  console.log("POOLS:", JSON.stringify(sp.rows));

  // users 테이블에서 email/name 검색
  const us = await superAdminDb.execute(sql`
    SELECT email, name, role, swimming_pool_id FROM users
    WHERE email ILIKE '%toykids%' OR name ILIKE '%toykids%' OR name_en ILIKE '%toykids%'
    LIMIT 5
  `);
  console.log("USERS:", JSON.stringify(us.rows));

  // parent_accounts
  const pa = await superAdminDb.execute(sql`
    SELECT login_id, name, swimming_pool_id FROM parent_accounts
    WHERE login_id ILIKE '%toykids%' OR name ILIKE '%toykids%'
    LIMIT 5
  `);
  console.log("PARENTS:", JSON.stringify(pa.rows));
}
main().then(() => process.exit(0)).catch(e => { console.error("ERR:", e.message); process.exit(1); });
