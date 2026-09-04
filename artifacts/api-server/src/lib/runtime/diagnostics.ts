/**
 * diagnostics.ts — AI Data Runtime 공통 Diagnostics (RT1)
 *
 * Production behavior 변경 없음.
 * 기존 route logging 변경 금지.
 * 기존 route에서 import 금지 (RT2 이후 단계적 연결).
 *
 * 저장 위치: event_logs.metadata JSONB (기존 구조 재사용)
 *   → schema migration 없음.
 *   → saveAiTrace()의 기존 경로를 통해 저장.
 *
 * 저장 금지:
 *   - raw user query / input_text
 *   - prompt 전체
 *   - answer 전체
 *   - token / secret
 *   - 개인정보
 */

import type { RuntimeDomain } from "./request-context.js";
import type { AnswerPolicyDecision } from "./answer-policy.js";

// ── Runtime version ───────────────────────────────────────────────────────────

export const RUNTIME_VERSION = "rt1" as const;

// ── Diagnostic payload ────────────────────────────────────────────────────────

/**
 * per-request diagnostics.
 *
 * 이 구조를 event_logs.metadata JSONB에 포함시킨다.
 * 기존 AiTraceContext의 metadata에 "diagnostics" 키로 중첩 가능.
 */
export interface RuntimeDiagnostics {
  runtime_version:      typeof RUNTIME_VERSION;
  domain:               RuntimeDomain;
  intent?:              string;
  retrieval_candidates: number;
  final_match_count:    number;
  /** source_id 목록만. 개인정보/원문 불포함. */
  source_ids:           string[];
  answer_mode:          AnswerPolicyDecision;
  ai_called:            boolean;
  fallback_reason?:     string;
  missing_reason?:      string;
  latency_ms:           number;
  model?:               string;
  input_tokens?:        number;
  output_tokens?:       number;
  total_tokens?:        number;
  error_stage?:         string;
  error_code?:          string;
  // raw_query: 절대 포함 금지
}

// ── Builder ───────────────────────────────────────────────────────────────────

export interface BuildDiagnosticsOptions {
  domain:               RuntimeDomain;
  intent?:              string;
  retrieval_candidates: number;
  final_match_count:    number;
  source_ids:           string[];
  answer_mode:          AnswerPolicyDecision;
  ai_called:            boolean;
  fallback_reason?:     string;
  missing_reason?:      string;
  latency_ms:           number;
  model?:               string;
  input_tokens?:        number;
  output_tokens?:       number;
  total_tokens?:        number;
  error_stage?:         string;
  error_code?:          string;
}

/**
 * RuntimeDiagnostics 생성.
 *
 * 보안 검증:
 *   - source_ids에 원문 텍스트가 포함되지 않도록
 *     각 ID가 짧은 식별자인지 확인 (길이 > 256이면 제거).
 *   - "raw_query", "input_text", "prompt" 키 포함 불가.
 */
export function buildDiagnostics(opts: BuildDiagnosticsOptions): RuntimeDiagnostics {
  // source_ids 보안 필터: 긴 텍스트(원문)를 실수로 포함시키지 않도록.
  const safeSourceIds = opts.source_ids.filter(id => id.length <= 256);

  return {
    runtime_version:      RUNTIME_VERSION,
    domain:               opts.domain,
    intent:               opts.intent,
    retrieval_candidates: opts.retrieval_candidates,
    final_match_count:    opts.final_match_count,
    source_ids:           safeSourceIds,
    answer_mode:          opts.answer_mode,
    ai_called:            opts.ai_called,
    fallback_reason:      opts.fallback_reason,
    missing_reason:       opts.missing_reason,
    latency_ms:           opts.latency_ms,
    model:                opts.model,
    input_tokens:         opts.input_tokens,
    output_tokens:        opts.output_tokens,
    total_tokens:         opts.total_tokens,
    error_stage:          opts.error_stage,
    error_code:           opts.error_code,
  };
}

/**
 * RuntimeDiagnostics를 event_logs.metadata에 포함 가능한 형태로 직렬화.
 *
 * 사용법:
 *   const metadata = {
 *     ...existingAiTraceMetadata,
 *     diagnostics: serializeDiagnostics(diag),
 *   };
 */
export function serializeDiagnostics(
  diag: RuntimeDiagnostics,
): Record<string, unknown> {
  // undefined 값 제거 후 반환
  return Object.fromEntries(
    Object.entries(diag).filter(([, v]) => v !== undefined)
  );
}

// ── Guards ────────────────────────────────────────────────────────────────────

/**
 * diagnostics payload에 금지 필드가 포함되어 있지 않은지 확인.
 * 테스트 및 pre-save 검증용.
 */
const FORBIDDEN_KEYS = new Set([
  "raw_query",
  "input_text",
  "prompt",
  "user_prompt",
  "system_prompt",
  "answer",
  "content",
  "secret",
  "token",
  "password",
  "api_key",
]);

export function assertNoPiiInDiagnostics(
  diag: Record<string, unknown>,
): void {
  for (const key of Object.keys(diag)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(
        `Diagnostics contains forbidden key "${key}". Raw user content must not be logged.`
      );
    }
  }
  // source_ids 길이 재확인
  const ids = diag["source_ids"];
  if (Array.isArray(ids)) {
    for (const id of ids) {
      if (typeof id === "string" && id.length > 256) {
        throw new Error(
          `Diagnostics source_id too long (${id.length} chars). Raw text must not be stored as source_id.`
        );
      }
    }
  }
}
