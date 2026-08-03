import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

const r1 = await superAdminDb.execute(
  sql`SELECT COUNT(*) AS cnt FROM audit_logs WHERE entity_type = 'swimming_pool_xmode'`
);
const r2 = await superAdminDb.execute(
  sql`SELECT COUNT(*) AS cnt FROM swimming_pools WHERE xmode_entitlement = true OR xmode_config_status <> 'NOT_CONFIGURED'`
);

console.log("audit_logs[swimming_pool_xmode] 건수:", r1.rows[0].cnt);
console.log("swimming_pools[xmode 활성] 건수:", r2.rows[0].cnt);
process.exit(0);
