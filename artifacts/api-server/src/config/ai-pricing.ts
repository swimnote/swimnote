/**
 * ai-pricing.ts — AI 비용 설정 (AI01-02 확장)
 *
 * Source: OpenAI 공식 가격표 (2024-11 기준)
 *   https://openai.com/api/pricing/
 *
 * 모델별 가격:
 *   gpt-4o-mini — input $0.150/1M, cached_input $0.075/1M, output $0.600/1M
 *   whisper-1   — $0.006 / minute (= $0.0001/second)
 *
 * 주의:
 *   - 가격이 변경된 경우 PRICING_SOURCE_DATE 를 업데이트하고 단가를 수정.
 *   - 임의 추정치로 교체 금지.
 */

export const AI_PRICING_VERSION = "ai01-02" as const;

/** 비용 계산 근거 명시 */
export const PRICING_SOURCE    = "openai_official" as const;
export const PRICING_SOURCE_DATE = "2024-11" as const;

/** 지원 LLM 모델 식별자 */
export type SupportedAiModel = "gpt-4o-mini";

/** 지원 STT 모델 식별자 */
export type SupportedSttModel = "whisper-1";

interface ModelPricing {
  /** 입력 토큰당 USD (1 token 단위) */
  input_per_token_usd:         number;
  /** 캐시된 입력 토큰당 USD (1 token 단위). 일반 input과 중복 계산하지 않음. */
  cached_input_per_token_usd?: number;
  /** 출력 토큰당 USD (1 token 단위) */
  output_per_token_usd:        number;
}

interface SttPricing {
  /** 오디오 1초당 USD */
  per_second_usd: number;
}

/**
 * LLM 모델별 토큰 단가 (1 token 단위 USD)
 * gpt-4o-mini: input  $0.150/1M → $0.00000015/token
 *              cached $0.075/1M → $0.000000075/token
 *              output $0.600/1M → $0.00000060/token
 */
const MODEL_PRICING: Record<SupportedAiModel, ModelPricing> = {
  "gpt-4o-mini": {
    input_per_token_usd:         0.00000015,   // $0.150 / 1,000,000
    cached_input_per_token_usd:  0.000000075,  // $0.075 / 1,000,000
    output_per_token_usd:        0.00000060,   // $0.600 / 1,000,000
  },
};

/**
 * STT 모델별 오디오 단가
 * whisper-1: $0.006/min = $0.0001/second
 */
const STT_PRICING: Record<SupportedSttModel, SttPricing> = {
  "whisper-1": {
    per_second_usd: 0.0001, // $0.006 / 60
  },
};

export interface AiCostResult {
  model:                  SupportedAiModel;
  input_tokens:           number;
  cached_input_tokens:    number;
  output_tokens:          number;
  total_tokens:           number;
  input_cost_usd:         number;
  cached_input_cost_usd:  number;
  output_cost_usd:        number;
  total_cost_usd:         number;
  /** 가격 근거 버전 (감사용) */
  pricing_source:         typeof PRICING_SOURCE;
  pricing_version:        typeof PRICING_SOURCE_DATE;
}

export interface SttCostResult {
  model:            SupportedSttModel;
  audio_seconds:    number;
  total_cost_usd:   number;
  pricing_source:   typeof PRICING_SOURCE;
  pricing_version:  typeof PRICING_SOURCE_DATE;
}

/**
 * LLM 호출 비용 계산.
 *
 * - cached_input_tokens: 일반 input과 중복 계산하지 않음.
 *   (input_tokens는 non-cached portion으로 전달할 것)
 * - 모델 미지원 시 `null` 반환 (임의 추정 금지).
 * - token 수가 0이면 $0.0 정확히 반환.
 */
export function calculateAiCost(
  input_tokens:         number,
  output_tokens:        number,
  model:                string,
  cached_input_tokens?: number,
): AiCostResult | null {
  if (!(model in MODEL_PRICING)) return null;

  const pricing = MODEL_PRICING[model as SupportedAiModel];
  const inp     = Math.max(0, input_tokens);
  const out     = Math.max(0, output_tokens);
  const cached  = Math.max(0, cached_input_tokens ?? 0);

  // USD, 소수점 8자리 반올림 (sub-cent 정밀도 유지)
  const input_cost_usd        = Math.round(inp    * pricing.input_per_token_usd                         * 1e8) / 1e8;
  const cached_input_cost_usd = Math.round(cached * (pricing.cached_input_per_token_usd ?? pricing.input_per_token_usd) * 1e8) / 1e8;
  const output_cost_usd       = Math.round(out    * pricing.output_per_token_usd                        * 1e8) / 1e8;

  return {
    model:                  model as SupportedAiModel,
    input_tokens:           inp,
    cached_input_tokens:    cached,
    output_tokens:          out,
    total_tokens:           inp + out + cached,
    input_cost_usd,
    cached_input_cost_usd,
    output_cost_usd,
    total_cost_usd: Math.round((input_cost_usd + cached_input_cost_usd + output_cost_usd) * 1e8) / 1e8,
    pricing_source:  PRICING_SOURCE,
    pricing_version: PRICING_SOURCE_DATE,
  };
}

/**
 * Whisper STT 비용 계산.
 *
 * - audio_seconds: 클라이언트 미전송 시 null → null 반환 (추정 금지).
 * - 모델 미지원 시 null 반환.
 */
export function calculateSttCost(
  audio_seconds: number | null | undefined,
  model:         string,
): SttCostResult | null {
  if (audio_seconds == null || !(model in STT_PRICING)) return null;
  const pricing  = STT_PRICING[model as SupportedSttModel];
  const secs     = Math.max(0, audio_seconds);
  return {
    model:           model as SupportedSttModel,
    audio_seconds:   secs,
    total_cost_usd:  Math.round(secs * pricing.per_second_usd * 1e8) / 1e8,
    pricing_source:  PRICING_SOURCE,
    pricing_version: PRICING_SOURCE_DATE,
  };
}
