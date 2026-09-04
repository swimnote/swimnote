import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  // users 테이블에서 toykids 검색 (name_en 제거)
  const us = await superAdminDb.execute(sql`
    SELECT email, name, role, swimming_pool_id, is_activated
    FROM users
    WHERE email ILIKE '%toykids%' OR name ILIKE '%toykids%'
    LIMIT 5
  `);
  console.log("USERS:", JSON.stringify(us.rows));

  // parent_accounts
  const pa = await superAdminDb.execute(sql`
    SELECT login_id, name, is_active, withdrawal_requested_at, swimming_pool_id
    FROM parent_accounts
    WHERE login_id ILIKE '%toykids%' OR name ILIKE '%toykids%'
    LIMIT 5
  `);
  console.log("PARENTS:", JSON.stringify(pa.rows));

  // swimming_pools name 컬럼 확인
  const sp = await superAdminDb.execute(sql`
    SELECT name, name_en, approval_status, deactivated_at
    FROM swimming_pools
    WHERE name ILIKE '%toy%' OR name_en ILIKE '%toy%'
    LIMIT 5
  `);
  console.log("POOLS:", JSON.stringify(sp.rows));
}
main().then(() => process.exit(0)).catch(e => { console.error("ERR:", e.message); process.exit(1); });
