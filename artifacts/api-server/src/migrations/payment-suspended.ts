/**
 * payment-suspended.ts — payment_suspended_at 컬럼 추가
 *
 * swimming_pools 테이블에 서비스 정지 시각 추적용 컬럼 추가.
 * GRACE(유예) → PAYMENT_SUSPENDED(서비스 정지) 상태 전환 시 설정.
 * RENEWAL(복구) 시 NULL 초기화.
 */
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function runPaymentSuspendedMigration(): Promise<void> {
  await superAdminDb.execute(sql`
    ALTER TABLE swimming_pools
    ADD COLUMN IF NOT EXISTS payment_suspended_at TIMESTAMPTZ
  `);
  console.log("[migration] payment_suspended_at OK");
}
