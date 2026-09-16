/**
 * settlement-v2-columns.ts
 *
 * monthly_settlements 테이블에 정산 V2 필요 컬럼 추가:
 *   - auto_amount_snapshot INTEGER  (저장 시점 자동매출 스냅샷)
 *   - is_finalized         BOOLEAN  (확정 여부)
 *   - finalized_at         TIMESTAMPTZ (확정 시각)
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

async function run() {
  console.log("[settlement-v2-columns] migration 시작");

  await db.execute(sql`
    ALTER TABLE monthly_settlements
      ADD COLUMN IF NOT EXISTS auto_amount_snapshot INTEGER,
      ADD COLUMN IF NOT EXISTS is_finalized BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ
  `);

  console.log("[settlement-v2-columns] 완료: auto_amount_snapshot, is_finalized, finalized_at 추가");
}

run().catch(e => {
  console.error("[settlement-v2-columns] 실패:", e.message);
  process.exit(1);
});
