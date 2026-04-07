import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

const POOL_ID = "pool_1775118427405_xs80lcdmo";

async function main() {
  // 풀 상태
  const pool = (await superAdminDb.execute(sql.raw(`
    SELECT subscription_tier, subscription_status, subscription_source,
           member_limit, next_billing_at::text,
           video_storage_limit_mb, white_label_enabled
    FROM swimming_pools WHERE id = '${POOL_ID}'
  `))).rows[0] as any;
  
  console.log("=== DB swimming_pools ===");
  console.log(JSON.stringify(pool, null, 2));
  
  // 구독 플랜 테이블
  const plans = (await superAdminDb.execute(sql.raw(`
    SELECT tier_code, name, member_limit, storage_mb, price_per_month,
           video_storage_limit_mb, base_storage_gb, display_storage
    FROM subscription_plans ORDER BY member_limit ASC
  `))).rows;
  
  console.log("\n=== subscription_plans (DB) ===");
  console.log(JSON.stringify(plans, null, 2));
}
main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
