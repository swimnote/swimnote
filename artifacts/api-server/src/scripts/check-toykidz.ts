import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  const r = await superAdminDb.execute(sql`
    SELECT id, name, x_paid_entitlement, x_manual_entitlement, x_force_disabled,
           xmode_config_status, subscription_tier
    FROM swimming_pools WHERE name ILIKE '%토이키즈%' LIMIT 5
  `);
  console.log("POOL:", JSON.stringify(r.rows, null, 2));

  for (const row of r.rows as any[]) {
    const cv = await superAdminDb.execute(sql`
      SELECT id, version_name, is_active, created_at
      FROM curriculum_versions WHERE pool_id=${row.id}
      ORDER BY created_at DESC LIMIT 5
    `);
    console.log("VERSIONS for", row.name, ":", JSON.stringify(cv.rows, null, 2));

    const ci = await superAdminDb.execute(sql`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN ci.is_active THEN 1 ELSE 0 END) as active_count
      FROM curriculum_items ci
      JOIN curriculum_versions cv ON ci.version_id=cv.id
      WHERE cv.pool_id=${row.id}
    `);
    console.log("ITEMS for", row.name, ":", JSON.stringify(ci.rows, null, 2));
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
