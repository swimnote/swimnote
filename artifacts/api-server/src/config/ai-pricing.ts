/**
 * ai-pricing.ts — AI 비용 설정 (WP6: skeleton only)
 *
 * WP10에서 실제 비용 계산·저장·응답을 구현합니다.
 *
 * WP6 금지:
 *   - 비용 DB 저장
 *   - 응답 cost 필드
 *   - billing 연결
 *   - audit 생성
 *   - 관리자 UI
 *
 * WP6에서는 ai-v1.ts가 이 파일을 import하지 않습니다.
 */

/** WP10에서 실제 필드를 정의합니다. */
export type AiPricingConfig = {
  _placeholder?: never; // 빈 타입 lint 회피용. WP10에서 제거.
};

/** WP10 구현 전 자리 표시자. */
export const AI_PRICING_VERSION = "wp10_pending" as const;
