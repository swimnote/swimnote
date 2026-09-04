import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
const r = (await superAdminDb.execute(sql`
  SELECT current_database() AS db,
         version() AS ver,
         COALESCE(inet_server_addr()::text,'unknown') AS host,
         current_setting('server_version') AS pg_ver
`)).rows[0] as any;
console.log("DB_NAME:", r.db);
console.log("HOST:", r.host);
console.log("PG_VERSION:", r.pg_ver);
// Supabase ref lives in the host: db.<ref>.supabase.co
const hostStr: string = r.host ?? '';
const ipv6Prefix = hostStr.startsWith('2406:da1a') ? hostStr.split(':').slice(0,4).join(':') : hostStr;
console.log("HOST_PREFIX:", ipv6Prefix);
