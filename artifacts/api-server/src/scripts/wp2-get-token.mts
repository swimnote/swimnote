import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { signToken } from "../lib/auth.js";

const r = await superAdminDb.execute(sql`
  SELECT id, email, role, swimming_pool_id FROM users WHERE role = 'super_admin' LIMIT 1
`);
if (!r.rows.length) { console.log("super_admin 없음"); process.exit(1); }
const user = r.rows[0] as any;
console.log("super_admin_id=" + user.id);
console.log("super_admin_email=" + user.email);

const token = signToken({
  userId: user.id,
  role: user.role,
  poolId: user.swimming_pool_id ?? null,
});
console.log("TOKEN=" + token);
process.exit(0);
