/**
 * payment/types.ts
 * 결제 프로바이더 인터페이스 — Toss, PortOne, 앱스토어 등 교체 가능 구조
 */

export interface CardInfo {
  /** 카드 전체 번호 (등록 시에만 사용, 이후 보관 금지) */
  cardNumber: string;
  /** 유효기간 MM/YY */
  expiry: string;
  /** 생년월일 6자리 or 사업자번호 10자리 (인증용) */
  birthOrBiz?: string;
  /** 비밀번호 앞 2자리 */
  password?: string;
}

export interface BillingKeyResult {
  /** PG사 발급 빌링키 (카드 재입력 없이 자동결제에 사용) */
  billingKey: string;
  /** 카드 마지막 4자리 */
  cardLast4: string;
  /** 카드 브랜드 (Visa / Mastercard / 국내카드 등) */
  cardBrand: string;
}

export interface ChargeParams {
  /** PG 빌링키 */
  billingKey: string;
  /** 결제 금액 (원) */
  amount: number;
  /** 주문명 */
  orderName: string;
  /** 내부 주문 ID (멱등성 키) */
  orderId: string;
  /** 수영장 ID (메타) */
  poolId: string;
}

export interface ChargeResult {
  success: boolean;
  /** PG 거래 키 */
  pgTransactionId: string;
  /** 실패 시 오류 메시지 */
  errorMessage?: string;
}

/**
 * 결제 프로바이더 인터페이스
 * - Mock: 개발/테스트 환경
 * - Toss: 토스페이먼츠
 * - PortOne: 포트원(아임포트)
 * - AppStore/GooglePlay: 인앱 결제 (향후 확장)
 */
export interface PaymentProvider {
  readonly name: string;
  /** 빌링키 발급 (최초 카드 등록 시) */
  issueBillingKey(cardInfo: CardInfo): Promise<BillingKeyResult>;
  /** 빌링키로 즉시 결제 */
  charge(params: ChargeParams): Promise<ChargeResult>;
  /** 빌링키 삭제 (카드 해지 시) */
  deleteBillingKey(billingKey: string): Promise<void>;
}
