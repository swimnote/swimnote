/**
 * evidence-pack.ts — AI Data Runtime 공통 EvidencePack (RT1)
 *
 * Production behavior 변경 없음.
 * 기존 route에서 import 금지 (RT2 이후 단계적 연결).
 *
 * 보안 원칙 (cross-tenant guard):
 *   - 다른 tenant의 RetrievalMatch가 포함되면 빌드 실패.
 *   - global scope ("tenant_id": "global") source는 명시적으로 허용.
 *   - INSUFFICIENT_EVIDENCE와 HUMAN_REQUIRED는 절대 동일 취급 금지.
 */

import type { RuntimeDomain } from "./request-context.js";
import type { RetrievalMatch } from "./retrieval-result.js";
import { isMatchTenantCompatible } from "./retrieval-result.js";
import { CrossTenantEvidenceError, EvidenceBuildError } from "./runtime-errors.js";

// ── Student context ───────────────────────────────────────────────────────────

export interface StudentContext {
  student_id:    string;
  pool_id:       string;
  display_name?: string;   // AI에 전달 가능한 범위 (비식별화 가능)
}

// ── EvidencePack ──────────────────────────────────────────────────────────────

export interface EvidencePack {
  readonly request_id:         string;
  readonly domain:             RuntimeDomain;
  readonly tenant_id:          string;
  /** AI에 전달할 검증된 근거 목록. cross-tenant match 불포함 보장. */
  readonly verified_facts:     ReadonlyArray<RetrievalMatch>;
  readonly student_context?:   Readonly<StudentContext>;
  /**
   * AI에 적용할 답변 제약.
   * 예: "다른 pool 정보 언급 금지", "추측 금지"
   */
  readonly answer_constraints: ReadonlyArray<string>;
  /**
   * 부재 정보 목록.
   * 예: "학생 개인 진도 기록 없음"
   * AI가 근거 없이 대답하지 않도록 명시.
   */
  readonly missing_info:       ReadonlyArray<string>;
  readonly confidence:         EvidenceConfidence;
  /** false이면 AiGateway 호출 금지. */
  readonly ai_callable:        boolean;
}

export type EvidenceConfidence = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";

// ── Builder options ────────────────────────────────────────────────────────────

export interface BuildEvidencePackOptions {
  request_id:         string;
  domain:             RuntimeDomain;
  /** 서버에서 검증된 tenant_id (pool_id). */
  tenant_id:          string;
  /**
   * RetrievalMatch 목록.
   * cross-tenant match가 포함되면 CrossTenantEvidenceError.
   */
  matches:            RetrievalMatch[];
  student_context?:   StudentContext;
  answer_constraints?: string[];
  missing_info?:      string[];
}

// ── Confidence calculation ────────────────────────────────────────────────────

function computeEvidenceConfidence(
  facts: RetrievalMatch[],
): EvidenceConfidence {
  if (facts.length === 0) return "INSUFFICIENT";
  const topScore = Math.max(...facts.map(f => f.score));
  if (topScore >= 80) return "HIGH";
  if (topScore >= 50) return "MEDIUM";
  return "LOW";
}

// ── Builder ───────────────────────────────────────────────────────────────────

/**
 * EvidencePack 생성.
 *
 * 검증:
 *   - request_id 필수
 *   - tenant_id 필수
 *   - 각 match가 contextTenant 또는 global인지 확인
 *     → 위반 시 CrossTenantEvidenceError
 */
export function buildEvidencePack(opts: BuildEvidencePackOptions): EvidencePack {
  if (!opts.request_id || opts.request_id.trim() === "") {
    throw new EvidenceBuildError("EvidencePack: request_id is required.");
  }
  if (!opts.tenant_id || opts.tenant_id.trim() === "") {
    throw new EvidenceBuildError("EvidencePack: tenant_id is required.");
  }

  // Cross-tenant guard
  for (const match of opts.matches) {
    if (!isMatchTenantCompatible(match, opts.tenant_id)) {
      throw new CrossTenantEvidenceError(match.tenant_id, opts.tenant_id);
    }
  }

  const verified_facts = [...opts.matches];
  const confidence = computeEvidenceConfidence(verified_facts);
  const ai_callable = confidence !== "INSUFFICIENT";

  return Object.freeze({
    request_id:         opts.request_id.trim(),
    domain:             opts.domain,
    tenant_id:          opts.tenant_id.trim(),
    verified_facts:     Object.freeze(verified_facts),
    student_context:    opts.student_context
                          ? Object.freeze({ ...opts.student_context })
                          : undefined,
    answer_constraints: Object.freeze([...(opts.answer_constraints ?? [])]),
    missing_info:       Object.freeze([...(opts.missing_info ?? [])]),
    confidence,
    ai_callable,
  });
}

/**
 * EvidencePack에서 AI 전달용 텍스트 목록 추출.
 * AI는 이 텍스트만 근거로 사용.
 */
export function extractEvidenceTexts(pack: EvidencePack): string[] {
  return pack.verified_facts.map(f => f.text);
}

/**
 * EvidencePack에서 source_id 목록 추출 (diagnostics용).
 */
export function extractSourceIds(pack: EvidencePack): string[] {
  return pack.verified_facts.map(f => f.source_id);
}
