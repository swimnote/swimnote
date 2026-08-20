/**
 * ai-gateway.ts — AI Data Runtime 공통 AiGateway (RT1)
 *
 * Production behavior 변경 없음.
 * 기존 route에서 import 금지 (RT2 이후 단계적 연결).
 *
 * 역할:
 *   - 공통 OpenAI client (singleton)
 *   - timeout (AbortController)
 *   - transient retry (429, 503, 504, timeout)
 *   - structured output (json_schema mode) 지원
 *   - token usage / latency 반환
 *   - error classification
 *   - request_id pass-through
 *
 * 정책:
 *   retry_attempts = 총 시도 횟수 (default 1 = 재시도 없음)
 *   Retry 가능: 429 / 503 / 504 / timeout
 *   Retry 금지: 400 / 401 / 403 / validation/grounding/business error
 *   total latency budget 초과 시 즉시 실패
 *
 * 보안:
 *   - domain prompt / evidence policy는 Gateway 밖에서 결정
 *   - 임의 fallback으로 unstructured text 사용 금지
 *   - 지원하지 않는 response format → GatewayUnsupportedFormatError
 */

import OpenAI from "openai";
import {
  GatewayTimeoutError,
  GatewayRateLimitedError,
  GatewayUpstreamError,
  GatewayInvalidResponseError,
  GatewayUnsupportedFormatError,
} from "./runtime-errors.js";

// ── Model types ───────────────────────────────────────────────────────────────

export type GatewayModel =
  | "gpt-4o"
  | "gpt-4o-mini";

// ── Response format ───────────────────────────────────────────────────────────

export type GatewayResponseFormat =
  | { type: "json_object" }
  | { type: "json_schema"; schema: Record<string, unknown>; schema_name: string; strict?: boolean };

// ── Request ───────────────────────────────────────────────────────────────────

export interface GatewayRequest {
  /** route에서 검증된 요청 식별자. 로그/trace에 사용. */
  request_id:      string;

  /** 기능명 (trace 기록용). */
  feature:         string;

  model:           GatewayModel;
  system_prompt:   string;
  user_prompt:     string;
  max_tokens:      number;
  timeout_ms:      number;

  /** json_object (기존 호환) 또는 json_schema (신규). */
  response_format: GatewayResponseFormat;

  /**
   * 총 시도 횟수.
   * 1 = 재시도 없음 (기본값)
   * 2 = 1회 재시도
   */
  retry_attempts?: number;

  /**
   * 총 latency 예산 (ms).
   * 정의된 경우 모든 retry를 포함한 총 시간이 이 값을 초과하면 즉시 실패.
   * 미정의 시 timeout_ms * retry_attempts로 계산.
   */
  total_latency_budget_ms?: number;

  temperature?: number;
}

// ── Response ──────────────────────────────────────────────────────────────────

export interface GatewayTokenUsage {
  input_tokens:  number;
  output_tokens: number;
  total_tokens:  number;
  cached_tokens?: number;
}

export interface GatewayResponse {
  /** JSON.parse된 결과. validate 이전 raw object. */
  content:     unknown;
  usage:       GatewayTokenUsage;
  model_used:  string;
  latency_ms:  number;
  attempts:    number;
}

// ── Error classification ──────────────────────────────────────────────────────

export type GatewayErrorKind =
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "INVALID_RESPONSE"
  | "UNSUPPORTED_FORMAT"
  | "NON_RETRYABLE_CLIENT";

const RETRYABLE_STATUS_CODES = new Set([429, 503, 504]);
const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403]);

function classifyOpenAIError(err: unknown): GatewayErrorKind {
  if (err instanceof Error && err.name === "AbortError") return "TIMEOUT";
  if (err instanceof GatewayTimeoutError)     return "TIMEOUT";
  if (err instanceof GatewayRateLimitedError) return "RATE_LIMITED";

  const asAny = err as Record<string, unknown>;
  const status = typeof asAny["status"] === "number" ? asAny["status"] : null;

  if (status === 429)                            return "RATE_LIMITED";
  if (status !== null && status >= 500)          return "UPSTREAM_ERROR";
  if (status !== null && NON_RETRYABLE_STATUS_CODES.has(status)) return "NON_RETRYABLE_CLIENT";

  return "INVALID_RESPONSE";
}

function isRetryableError(err: unknown): boolean {
  const kind = classifyOpenAIError(err);
  return kind === "TIMEOUT" || kind === "RATE_LIMITED" || kind === "UPSTREAM_ERROR";
}

// ── Singleton client ──────────────────────────────────────────────────────────

let _gateway_openai: OpenAI | null = null;

function getGatewayClient(): OpenAI {
  if (!_gateway_openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("AiGateway: OPENAI_API_KEY not set.");
    _gateway_openai = new OpenAI({ apiKey });
  }
  return _gateway_openai;
}

/** テスト用: client を差し替える (production では使用禁止). */
export function _setGatewayClientForTest(client: OpenAI | null): void {
  _gateway_openai = client;
}

// ── Core call ─────────────────────────────────────────────────────────────────

async function callOnce(
  client: OpenAI,
  req: GatewayRequest,
  signal: AbortSignal,
): Promise<GatewayResponse> {
  const started = Date.now();

  let openaiFormat: OpenAI.ChatCompletionCreateParamsNonStreaming["response_format"];

  if (req.response_format.type === "json_object") {
    openaiFormat = { type: "json_object" };
  } else if (req.response_format.type === "json_schema") {
    const fmt = req.response_format;
    openaiFormat = {
      type: "json_schema",
      json_schema: {
        name:   fmt.schema_name,
        schema: fmt.schema,
        strict: fmt.strict ?? false,
      },
    };
  } else {
    throw new GatewayUnsupportedFormatError(
      `Unsupported response format type: ${(req.response_format as GatewayResponseFormat).type}`,
    );
  }

  let completion: OpenAI.ChatCompletion;
  try {
    completion = await client.chat.completions.create(
      {
        model:           req.model,
        messages:        [
          { role: "system", content: req.system_prompt },
          { role: "user",   content: req.user_prompt   },
        ],
        max_tokens:      req.max_tokens,
        temperature:     req.temperature ?? 0.7,
        response_format: openaiFormat,
      },
      { signal },
    );
  } catch (err) {
    // AbortSignal → timeout
    if (err instanceof Error && err.name === "AbortError") {
      throw new GatewayTimeoutError(`Request timed out after ${req.timeout_ms}ms`);
    }
    // OpenAI SDK wraps HTTP errors — check status
    const asAny = err as Record<string, unknown>;
    const status = typeof asAny["status"] === "number" ? asAny["status"] : null;
    if (status === 429) throw new GatewayRateLimitedError();
    if (status !== null && RETRYABLE_STATUS_CODES.has(status)) {
      throw new GatewayUpstreamError(status, `Upstream error: HTTP ${status}`);
    }
    if (status !== null && status >= 400) {
      throw new GatewayUpstreamError(status);
    }
    throw new GatewayInvalidResponseError((err as Error).message);
  }

  const raw = completion.choices[0]?.message?.content;
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new GatewayInvalidResponseError("Empty content in completion response");
  }

  let content: unknown;
  try {
    content = JSON.parse(raw);
  } catch {
    throw new GatewayInvalidResponseError("Response content is not valid JSON");
  }

  const usage = completion.usage;
  return {
    content,
    usage: {
      input_tokens:   usage?.prompt_tokens    ?? 0,
      output_tokens:  usage?.completion_tokens ?? 0,
      total_tokens:   usage?.total_tokens      ?? 0,
      cached_tokens:  (usage as Record<string, unknown>)?.["prompt_tokens_details"]
                        ? ((usage as Record<string, unknown>)["prompt_tokens_details"] as Record<string, unknown>)?.["cached_tokens"] as number | undefined
                        : undefined,
    },
    model_used:  completion.model,
    latency_ms:  Date.now() - started,
    attempts:    1,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * AI Gateway 요청.
 *
 * retry_attempts: 총 시도 횟수 (1 = 재시도 없음).
 * total_latency_budget_ms: 모든 시도의 총 허용 시간.
 *
 * 오류 분류:
 *   retryable   → retry_attempts 소진까지 재시도
 *   non-retryable → 즉시 throw
 *
 * 모델이 json_schema response_format을 지원하지 않으면
 * GatewayUnsupportedFormatError를 throw한다.
 * 임의 fallback으로 json_object를 사용하지 않는다.
 */
export async function callGateway(req: GatewayRequest): Promise<GatewayResponse> {
  const maxAttempts = Math.max(1, req.retry_attempts ?? 1);
  const budgetMs    = req.total_latency_budget_ms
    ?? req.timeout_ms * maxAttempts;

  const overallStart = Date.now();
  const client = getGatewayClient();

  let lastError: unknown;
  let totalAttempts = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const elapsedMs  = Date.now() - overallStart;
    const remaining  = budgetMs - elapsedMs;
    if (remaining <= 0) {
      throw new GatewayTimeoutError(
        `Total latency budget ${budgetMs}ms exhausted after ${attempt - 1} attempt(s)`,
      );
    }

    const effectiveTimeout = Math.min(req.timeout_ms, remaining);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), effectiveTimeout);

    totalAttempts = attempt;
    try {
      const result = await callOnce(client, req, controller.signal);
      clearTimeout(timer);
      return { ...result, attempts: totalAttempts };
    } catch (err) {
      clearTimeout(timer);
      lastError = err;

      if (!isRetryableError(err)) throw err;

      // Latency budget check before next attempt
      if (attempt < maxAttempts) {
        const nowElapsed = Date.now() - overallStart;
        if (nowElapsed + 500 >= budgetMs) {
          // Not enough budget for another attempt
          break;
        }
        // Fixed 500ms backoff before retry
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  throw lastError;
}

// ── Re-export error types for callers ─────────────────────────────────────────
export {
  GatewayTimeoutError,
  GatewayRateLimitedError,
  GatewayUpstreamError,
  GatewayInvalidResponseError,
  GatewayUnsupportedFormatError,
} from "./runtime-errors.js";
