/**
 * payment/mock.ts
 * 개발 환경용 모의 결제 프로바이더
 * 실제 PG 연동 없이 모든 결제를 성공으로 처리
 */
import type { PaymentProvider, CardInfo, BillingKeyResult, ChargeParams, ChargeResult } from "./types.js";

export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";

  async issueBillingKey(cardInfo: CardInfo): Promise<BillingKeyResult> {
    // 카드번호 마지막 4자리
    const digits = cardInfo.cardNumber.replace(/\s|-/g, "");
    const last4 = digits.slice(-4);

    // 브랜드 추정
    const first = digits[0];
    const brand =
      first === "4" ? "Visa" :
      first === "5" ? "Mastercard" :
      first === "3" ? "Amex" :
      "국내카드";

    // 모의 빌링키 생성
    const billingKey = `mock_bk_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    console.log(`[mock-pg] 빌링키 발급 성공 — **** **** **** ${last4} (${brand})`);
    return { billingKey, cardLast4: last4, cardBrand: brand };
  }

  async charge(params: ChargeParams): Promise<ChargeResult> {
    // 모의 결제 — 항상 성공
    const pgTransactionId = `mock_tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    console.log(
      `[mock-pg] 결제 성공 — ${params.orderName} | ₩${params.amount.toLocaleString()} | txId=${pgTransactionId}`
    );
    return { success: true, pgTransactionId };
  }

  async deleteBillingKey(billingKey: string): Promise<void> {
    console.log(`[mock-pg] 빌링키 삭제 — ${billingKey}`);
  }
}
