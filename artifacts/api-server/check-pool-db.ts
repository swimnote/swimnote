import { poolDb, superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

async function cnt(db: any, tbl: string): Promise<number> {
  try {
    const r = await db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${tbl}`));
    return Number((r.rows[0] as any).n ?? 0);
  } catch { return -1; }
}

async function main() {
  console.log("── superAdminDb (Supabase) ──");
  console.log("swimming_pools:", await cnt(superAdminDb, "swimming_pools"));
  console.log("users:",         await cnt(superAdminDb, "users"));
  console.log("students:",      await cnt(superAdminDb, "students"));

  console.log("\n── poolDb (POOL_DATABASE_URL) ──");
  const r = await poolDb.execute(sql`SELECT id, name, approval_status FROM swimming_pools`);
  console.log("swimming_pools:", r.rows.length);
  for (const row of r.rows as any[]) console.log("  -", row.name, row.approval_status, row.id);

  const u = await poolDb.execute(sql`SELECT id, email, role FROM users`);
  console.log("users:", u.rows.length);
  for (const row of u.rows as any[]) console.log("  -", row.email, row.role);
}

main().then(() => process.exit(0)).catch(e => { console.error(e?.message); process.exit(1); });
