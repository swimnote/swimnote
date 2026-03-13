/**
 * payment/index.ts
 * 결제 프로바이더 팩토리
 *
 * 환경변수 PAYMENT_PROVIDER 에 따라 프로바이더 자동 선택:
 *   mock    → 개발용 모의 결제 (기본값)
 *   toss    → 토스페이먼츠 (TOSS_SECRET_KEY 필요)
 *   portone → 포트원/아임포트 (PORTONE_API_SECRET + PORTONE_CHANNEL_KEY 필요)
 *
 * 향후 AppStore / GooglePlay 인앱 결제 프로바이더 추가 시
 * 이 파일만 수정하면 됩니다.
 */
import type { PaymentProvider } from "./types.js";
import { MockPaymentProvider } from "./mock.js";
import { TossPaymentProvider } from "./toss.js";
import { PortOnePaymentProvider } from "./portone.js";

let _provider: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (_provider) return _provider;

  const providerName = process.env.PAYMENT_PROVIDER ?? "mock";

  switch (providerName) {
    case "toss": {
      const key = process.env.TOSS_SECRET_KEY;
      if (!key) throw new Error("TOSS_SECRET_KEY 환경변수가 필요합니다.");
      _provider = new TossPaymentProvider(key);
      break;
    }
    case "portone": {
      const secret = process.env.PORTONE_API_SECRET;
      const channel = process.env.PORTONE_CHANNEL_KEY;
      if (!secret || !channel) throw new Error("PORTONE_API_SECRET, PORTONE_CHANNEL_KEY 환경변수가 필요합니다.");
      _provider = new PortOnePaymentProvider(secret, channel);
      break;
    }
    default:
      // 개발 환경 or PAYMENT_PROVIDER=mock
      _provider = new MockPaymentProvider();
  }

  console.log(`[payment] 프로바이더 초기화 — ${_provider.name}`);
  return _provider;
}

export type { PaymentProvider, CardInfo, BillingKeyResult, ChargeParams, ChargeResult } from "./types.js";
