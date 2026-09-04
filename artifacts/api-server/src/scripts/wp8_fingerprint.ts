import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
// Get DB host fingerprint without revealing connection string
const res = (await superAdminDb.execute(sql`
  SELECT current_database() AS dbname,
         inet_server_addr() AS host,
         md5(current_setting('listen_addresses')) AS host_hash
`)).rows[0] as any;
console.log("DB_NAME:", res.dbname);
console.log("DB_HOST:", res.host);
// Also identify Supabase project from db name pattern
const poolRes = await superAdminDb.execute(sql`SELECT current_database()`);
const dbRow = poolRes.rows[0] as any;
// Check if it's pool_database (Replit Neon) or supabase
const isPool = String(dbRow.current_database ?? '').includes('pool') || String(dbRow.current_database ?? '').includes('neon');
console.log("IS_POOL_DB:", isPool);
// Check support_cases to identify which DB
const scCount = (await superAdminDb.execute(sql`SELECT COUNT(*) AS c FROM support_cases`)).rows[0] as any;
console.log("SUPPORT_CASES_COUNT:", scCount.c);
