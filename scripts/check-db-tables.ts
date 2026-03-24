import { db, superAdminDb } from "../lib/db/src/index.js";
import { sql } from "drizzle-orm";

async function main() {
  console.log("=== super DB 테이블 목록 ===");
  const superTables = await superAdminDb.execute(
    sql`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`
  );
  console.log(superTables.rows.map((r: any) => r.tablename).join(", "));

  console.log("\n=== pool DB 테이블 목록 ===");
  const poolTables = await db.execute(
    sql`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`
  );
  console.log(poolTables.rows.map((r: any) => r.tablename).join(", "));

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
