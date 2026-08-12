/**
 * ai-pricing.ts — AI 비용 설정 (WP10: 실제 구현)
 *
 * Source: OpenAI 공식 가격표 (2024-11 기준)
 *   https://openai.com/api/pricing/
 *
 * 모델별 가격:
 *   gpt-4o-mini — input $0.150/1M tokens, output $0.600/1M tokens
 *
 * 주의:
 *   - 가격이 변경된 경우 PRICING_SOURCE_DATE 를 업데이트하고 단가를 수정.
 *   - 임의 추정치로 교체 금지.
 */

export const AI_PRICING_VERSION = "wp10" as const;

/** 비용 계산 근거 명시 */
export const PRICING_SOURCE    = "openai_official" as const;
export const PRICING_SOURCE_DATE = "2024-11" as const;

/** 지원 모델 식별자 */
export type SupportedAiModel = "gpt-4o-mini";

interface ModelPricing {
  /** 입력 토큰당 USD (1 token 단위) */
  input_per_token_usd:  number;
  /** 출력 토큰당 USD (1 token 단위) */
  output_per_token_usd: number;
}

/**
 * 모델별 토큰 단가 (1 token 단위 USD)
 * gpt-4o-mini: input $0.15/1M → $0.00000015/token
 *              output $0.60/1M → $0.00000060/token
 */
const MODEL_PRICING: Record<SupportedAiModel, ModelPricing> = {
  "gpt-4o-mini": {
    input_per_token_usd:  0.00000015, // $0.150 / 1,000,000
    output_per_token_usd: 0.00000060, // $0.600 / 1,000,000
  },
};

export interface AiCostResult {
  model:             SupportedAiModel;
  input_tokens:      number;
  output_tokens:     number;
  total_tokens:      number;
  input_cost_usd:   number;
  output_cost_usd:  number;
  total_cost_usd:   number;
  /** 가격 근거 버전 (감사용) */
  pricing_source:   typeof PRICING_SOURCE;
  pricing_version:  typeof PRICING_SOURCE_DATE;
}

/**
 * AI 호출 비용 계산.
 *
 * - 모델 미지원 시 `null` 반환 (임의 추정 금지).
 * - token 수가 0이면 $0.0 정확히 반환.
 */
export function calculateAiCost(
  input_tokens:  number,
  output_tokens: number,
  model:         string,
): AiCostResult | null {
  if (!(model in MODEL_PRICING)) return null;

  const pricing = MODEL_PRICING[model as SupportedAiModel];
  const inp  = Math.max(0, input_tokens);
  const out  = Math.max(0, output_tokens);

  // USD, 소수점 8자리 반올림 (sub-cent 정밀도 유지)
  const input_cost_usd  = Math.round(inp * pricing.input_per_token_usd  * 1e8) / 1e8;
  const output_cost_usd = Math.round(out * pricing.output_per_token_usd * 1e8) / 1e8;

  return {
    model:            model as SupportedAiModel,
    input_tokens:     inp,
    output_tokens:    out,
    total_tokens:     inp + out,
    input_cost_usd,
    output_cost_usd,
    total_cost_usd:   Math.round((input_cost_usd + output_cost_usd) * 1e8) / 1e8,
    pricing_source:   PRICING_SOURCE,
    pricing_version:  PRICING_SOURCE_DATE,
  };
}
