/**
 * growth-confidence-config.ts — Curriculum Match Confidence 설정
 *
 * WP6 EXPERIMENTAL_V1: reviewThreshold=0.50
 *
 * 주의:
 *   - 이 값은 검증 완료된 인간 평가 기준이 아닌 초기 검색 후보 필터 기준입니다.
 *   - 실제 운영 표본 축적 후 별도 WP에서 threshold를 재조정합니다.
 *   - 환경변수 override 금지 — 값 변경은 코드 버전 변경으로만 수행합니다.
 *   - AUTO_ACCEPTED 사용 금지. 모든 match는 PENDING_REVIEW.
 */

export interface GrowthConfidenceConfigV1 {
  version: "growth_conf_v1";
  /**
   * 이 값 이상인 후보만 PENDING_REVIEW로 응답에 포함.
   * EXPERIMENTAL_V1 — NEEDS_VERIFICATION: 표본 검증 전 초기 보수 기준 (키워드 절반 이상 일치).
   */
  reviewThreshold: number;
}

export const DEFAULT_CONFIDENCE_CONFIG_V1: GrowthConfidenceConfigV1 = {
  version:         "growth_conf_v1",
  reviewThreshold: 0.50, // EXPERIMENTAL_V1 — NEEDS_VERIFICATION
};

/**
 * config 유효성 검증.
 * 잘못된 값(0 미만, 1 초과, NaN, 비숫자)은 즉시 throw.
 */
export function validateConfidenceConfig(cfg: GrowthConfidenceConfigV1): void {
  const t = cfg.reviewThreshold;
  if (typeof t !== "number" || isNaN(t) || t < 0 || t > 1) {
    throw new Error(
      `[GrowthConfidenceConfig] reviewThreshold must be a finite number in [0, 1], got: ${t}`,
    );
  }
}
