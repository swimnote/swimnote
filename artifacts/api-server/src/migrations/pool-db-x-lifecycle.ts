/**
 * pool-db-x-lifecycle — X 구독 생명주기 컬럼 추가
 *
 * WP-X02-D2: CANCELLED_BUT_ACTIVE 판단을 위한 x_auto_renew_cancelled 컬럼
 *
 * x_auto_renew_cancelled:
 *   - CANCELLATION webhook → true  (자동갱신 취소됨, 만료일까지 X 유지)
 *   - RENEWAL / UNCANCELLATION → false  (갱신 또는 재구독)
 *   - EXPIRATION → 무관 (x_paid_entitlement=false로 전환)
 *   - 구독 없는 pool: DEFAULT false
 *
 * idempotent: IF NOT EXISTS
 */
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function runXLifecycleMigration(): Promise<void> {
  await superAdminDb.execute(sql`
    ALTER TABLE swimming_pools
      ADD COLUMN IF NOT EXISTS x_auto_renew_cancelled boolean NOT NULL DEFAULT false;
  `);
  console.log("[x-lifecycle-migration] x_auto_renew_cancelled 컬럼 OK");
}
