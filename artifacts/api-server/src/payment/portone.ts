/**
 * payment/portone.ts
 * 포트원(PortOne, 구 아임포트) REST API v2 연동
 *
 * 연동 방법:
 * 1. 환경변수 설정:
 *    PORTONE_API_SECRET=...     (포트원 V2 API 시크릿)
 *    PORTONE_CHANNEL_KEY=...    (채널 키 — 포트원 콘솔에서 확인)
 * 2. 포트원 콘솔에서 빌링키 결제 채널 활성화 필요
 *
 * 참고: https://developers.portone.io/docs/ko/v2-payment/billing-key
 */
import type { PaymentProvider, CardInfo, BillingKeyResult, ChargeParams, ChargeResult } from "./types.js";

const PORTONE_API_BASE = "https://api.portone.io";

export class PortOnePaymentProvider implements PaymentProvider {
  readonly name = "portone";
  private apiSecret: string;
  private channelKey: string;

  constructor(apiSecret: string, channelKey: string) {
    this.apiSecret = apiSecret;
    this.channelKey = channelKey;
  }

  private async getAccessToken(): Promise<string> {
    const res = await fetch(`${PORTONE_API_BASE}/login/api-secret`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiSecret: this.apiSecret }),
    });
    const data = await res.json() as any;
    if (!res.ok) throw new Error(data.message ?? "포트원 인증 실패");
    return data.accessToken;
  }

  async issueBillingKey(cardInfo: CardInfo): Promise<BillingKeyResult> {
    const token = await this.getAccessToken();
    const digits = cardInfo.cardNumber.replace(/\s|-/g, "");

    const res = await fetch(`${PORTONE_API_BASE}/billing-keys`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channelKey: this.channelKey,
        method: {
          card: {
            credential: {
              number: digits,
              expiryYear: cardInfo.expiry.split("/")[1],
              expiryMonth: cardInfo.expiry.split("/")[0],
              birthOrBusinessRegistrationNumber: cardInfo.birthOrBiz ?? "",
              passwordTwoDigits: cardInfo.password ?? "",
            },
          },
        },
      }),
    });

    const data = await res.json() as any;
    if (!res.ok) throw new Error(data.message ?? "포트원 빌링키 발급 실패");

    const cardLast4  = data.methods?.[0]?.card?.number?.slice(-4) ?? "****";
    const cardBrand  = data.methods?.[0]?.card?.brand ?? "카드";

    return { billingKey: data.billingKey, cardLast4, cardBrand };
  }

  async charge(params: ChargeParams): Promise<ChargeResult> {
    const token = await this.getAccessToken();
    const paymentId = params.orderId;

    const res = await fetch(`${PORTONE_API_BASE}/payments/${paymentId}/billing-key`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        billingKey: params.billingKey,
        orderName: params.orderName,
        amount: { total: params.amount },
        currency: "KRW",
        customer: { id: params.poolId },
      }),
    });

    const data = await res.json() as any;
    if (!res.ok || data.status === "FAILED") {
      return { success: false, pgTransactionId: paymentId, errorMessage: data.message ?? "결제 실패" };
    }
    return { success: true, pgTransactionId: paymentId };
  }

  async deleteBillingKey(billingKey: string): Promise<void> {
    const token = await this.getAccessToken();
    await fetch(`${PORTONE_API_BASE}/billing-keys/${billingKey}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  }
}
