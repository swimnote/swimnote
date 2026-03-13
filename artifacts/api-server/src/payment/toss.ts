/**
 * payment/toss.ts
 * 토스페이먼츠 빌링키 자동결제 연동
 *
 * 연동 방법:
 * 1. 환경변수 설정:
 *    TOSS_SECRET_KEY=test_sk_... (테스트키) 또는 live_sk_... (실서버키)
 * 2. 토스페이먼츠 대시보드에서 자동결제(빌링) 기능 활성화 필요
 *
 * 참고: https://docs.tosspayments.com/reference/using-api/billing
 */
import type { PaymentProvider, CardInfo, BillingKeyResult, ChargeParams, ChargeResult } from "./types.js";

const TOSS_API_BASE = "https://api.tosspayments.com/v1";

function authHeader(secretKey: string) {
  return "Basic " + Buffer.from(secretKey + ":").toString("base64");
}

export class TossPaymentProvider implements PaymentProvider {
  readonly name = "toss";
  private secretKey: string;

  constructor(secretKey: string) {
    this.secretKey = secretKey;
  }

  async issueBillingKey(cardInfo: CardInfo): Promise<BillingKeyResult> {
    const customerKey = `customer_${Date.now()}`;
    const body = {
      cardNumber:     cardInfo.cardNumber.replace(/\s/g, ""),
      cardExpirationYear:  cardInfo.expiry.split("/")[1],
      cardExpirationMonth: cardInfo.expiry.split("/")[0],
      customerIdentityNumber: cardInfo.birthOrBiz ?? "",
      cardPassword: cardInfo.password ?? "",
      customerKey,
    };

    const res = await fetch(`${TOSS_API_BASE}/billing/authorizations/card`, {
      method: "POST",
      headers: {
        Authorization: authHeader(this.secretKey),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any).message ?? "토스페이먼츠 빌링키 발급 실패");
    }

    const data = await res.json() as any;
    return {
      billingKey: data.billingKey,
      cardLast4:  data.card?.number?.slice(-4) ?? "****",
      cardBrand:  data.card?.company ?? "카드",
    };
  }

  async charge(params: ChargeParams): Promise<ChargeResult> {
    const body = {
      billingKey: params.billingKey,
      customerKey: params.poolId,
      amount: params.amount,
      orderId: params.orderId,
      orderName: params.orderName,
      customerName: params.poolId,
    };

    const res = await fetch(`${TOSS_API_BASE}/billing/${params.billingKey}`, {
      method: "POST",
      headers: {
        Authorization: authHeader(this.secretKey),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await res.json() as any;
    if (!res.ok) {
      return { success: false, pgTransactionId: "", errorMessage: data.message ?? "결제 실패" };
    }
    return { success: true, pgTransactionId: data.paymentKey };
  }

  async deleteBillingKey(billingKey: string): Promise<void> {
    // 토스페이먼츠는 빌링키 명시적 삭제 API 없음 (만료 처리로 대체)
    console.log(`[toss] 빌링키 비활성화 처리 — ${billingKey}`);
  }
}
