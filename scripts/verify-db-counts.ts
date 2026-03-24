import { db, superAdminDb } from "../lib/db/src/index.js";
import { sql } from "drizzle-orm";

async function count(dbConn: typeof db, table: string, label: string) {
  try {
    const r = await dbConn.execute(sql`SELECT COUNT(*)::int cnt FROM ${sql.raw(table)}`);
    console.log(`  ${label} ${table}: ${(r.rows[0] as any).cnt}건`);
  } catch (e: any) {
    console.log(`  ${label} ${table}: ERROR - ${e.message.split('\n')[0]}`);
  }
}

console.log("=== pool DB 운영 테이블 ===");
await count(db, "students", "pool DB");
await count(db, "class_groups", "pool DB");
await count(db, "attendance", "pool DB");
await count(db, "photo_assets_meta", "pool DB");
await count(db, "video_assets_meta", "pool DB");
await count(db, "pool_change_logs", "pool DB");

console.log("\n=== super DB 플랫폼 테이블 ===");
await count(superAdminDb, "users", "super DB");
await count(superAdminDb, "swimming_pools", "super DB");
await count(superAdminDb, "user_pools", "super DB");
await count(superAdminDb, "data_change_logs", "super DB");
await count(superAdminDb, "pool_event_logs", "super DB");
await count(superAdminDb, "subscriptions", "super DB");

process.exit(0);
