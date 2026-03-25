import { superAdminDb } from "@workspace/db";
import { sql } from 'drizzle-orm';
async function main() {
  const r = await superAdminDb.execute(sql.raw(`SELECT id, email, role, name FROM users WHERE role IN ('super_admin','platform_admin') LIMIT 5`));
  r.rows.forEach((u:any) => console.log(u.email, u.role, u.name));
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
