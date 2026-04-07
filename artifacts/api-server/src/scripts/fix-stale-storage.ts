/**
 * fix-stale-storage.ts — base_storage_gb 정합성 복구
 * subscription_plans 테이블의 storage_mb 기준으로 수영장의 base_storage_gb를 재계산
 *
 * 실행: pnpm --filter @workspace/api-server exec tsx src/scripts/fix-stale-storage.ts
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  // 현재 stale 값 확인
  const before = await superAdminDb.execute(sql`
    SELECT sp.id, sp.name, sp.subscription_tier, sp.base_storage_gb,
           ROUND((p.storage_mb::numeric / 1024)::numeric, 3)::float8 AS expected_gb
    FROM swimming_pools sp
    JOIN subscription_plans p ON sp.subscription_tier = p.tier
    WHERE ABS(sp.base_storage_gb::numeric - ROUND((p.storage_mb::numeric / 1024)::numeric, 3)) > 0.1
    ORDER BY sp.base_storage_gb DESC
  `);
  console.log("수정 대상 풀:", JSON.stringify(before.rows, null, 2));

  if (before.rows.length === 0) {
    console.log("✅ 이미 모두 정합합니다.");
    return;
  }

  // 수정
  const fixed = await superAdminDb.execute(sql`
    UPDATE swimming_pools sp
    SET base_storage_gb = ROUND((p.storage_mb::numeric / 1024)::numeric, 3)::float8,
        updated_at = now()
    FROM subscription_plans p
    WHERE sp.subscription_tier = p.tier
      AND ABS(sp.base_storage_gb::numeric - ROUND((p.storage_mb::numeric / 1024)::numeric, 3)) > 0.1
    RETURNING sp.id, sp.name, sp.subscription_tier, sp.base_storage_gb
  `);
  console.log("✅ 수정 완료:", JSON.stringify(fixed.rows, null, 2));
}

main().then(() => process.exit(0)).catch(e => { console.error("❌ 오류:", e); process.exit(1); });
