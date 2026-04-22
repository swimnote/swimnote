import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

const phone = "01072121507";

const users = await superAdminDb.execute(sql`
  SELECT id, name, phone, role, swimming_pool_id, created_at FROM users WHERE phone = ${phone} ORDER BY created_at
`);
console.log("=== users (관리자/선생님) ===");
console.log(JSON.stringify(users.rows, null, 2));

const parents = await superAdminDb.execute(sql`
  SELECT id, name, phone, swimming_pool_id, created_at FROM parent_accounts WHERE phone = ${phone} ORDER BY created_at
`);
console.log("=== parent_accounts (학부모) ===");
console.log(JSON.stringify(parents.rows, null, 2));

process.exit(0);
