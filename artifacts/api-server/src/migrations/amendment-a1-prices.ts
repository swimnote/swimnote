/**
 * Amendment A1: X 플랜 가격 수정 + SWIMNOTE 기본플랜 포함 명시
 *
 * 변경:
 *   x300:  119,000 → 129,000
 *   x500:  189,000 → 199,000
 *   x1000: 349,000 → 359,000
 *
 * 보존:
 *   SWIMNOTE: 9,900 (변경 없음)
 *   DATA100:  7,900 (변경 없음)
 *   DATA300: 22,900 (변경 없음)
 *
 * PRODUCTION 금지 — 이 파일은 코드 기록용 미래 실행 예정 마이그레이션.
 * 실제 실행은 WP5-PRE + WP5 + WP7 승인 이후.
 */
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function runAmendmentA1Prices() {
  console.log("[Amendment A1] X 플랜 가격 수정 시작...");

  const PRICE_UPDATES: Array<{ tier: string; old_price: number; new_price: number }> = [
    { tier: "x300",  old_price: 119000, new_price: 129000 },
    { tier: "x500",  old_price: 189000, new_price: 199000 },
    { tier: "x1000", old_price: 349000, new_price: 359000 },
  ];

  for (const { tier, old_price, new_price } of PRICE_UPDATES) {
    // 검증: 현재 값이 예상값인지 확인 후 업데이트
    const [row] = (await superAdminDb.execute(sql`
      SELECT tier, price_per_month FROM subscription_plans
      WHERE tier = ${tier}
      LIMIT 1
    `)).rows as any[];

    if (!row) {
      console.warn(`[Amendment A1] ${tier} 플랜 없음 — 스킵`);
      continue;
    }

    const currentPrice = Number(row.price_per_month);
    if (currentPrice === new_price) {
      console.log(`[Amendment A1] ${tier}: 이미 ${new_price} — 스킵`);
      continue;
    }

    if (currentPrice !== old_price) {
      console.warn(`[Amendment A1] ${tier}: 예상가 ${old_price} 불일치 (현재: ${currentPrice}) — 강제 적용`);
    }

    await superAdminDb.execute(sql`
      UPDATE subscription_plans
      SET price_per_month = ${new_price},
          updated_at = now()
      WHERE tier = ${tier}
    `);

    console.log(`[Amendment A1] ${tier}: ${old_price.toLocaleString()} → ${new_price.toLocaleString()} ✓`);
  }

  console.log("[Amendment A1] X 플랜 가격 수정 완료.");
}
