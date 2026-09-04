/**
 * answer-policy.ts — AI Data Runtime 공통 AnswerPolicy (RT1)
 *
 * Production behavior 변경 없음.
 * 기존 route에서 import 금지 (RT2 이후 단계적 연결).
 *
 * 4개 상태의 의미:
 *   DB_DIRECT            = DB 근거만으로 직접 응답 (AI 0회)
 *   GROUNDED_AI          = 검증된 근거를 AI에 전달하여 문장화/종합 (AI 1회)
 *   HUMAN_REQUIRED       = 관련 근거는 존재하지만 정책상 자동 응답 금지
 *   INSUFFICIENT_EVIDENCE = retrieval을 충분히 수행했지만 사용할 근거 부족
 *
 * HUMAN_REQUIRED와 INSUFFICIENT_EVIDENCE는 절대 같은 상태로 취급하지 않는다.
 */

import type { EvidencePack } from "./evidence-pack.js";

// ── Decision type ─────────────────────────────────────────────────────────────

export type AnswerPolicyDecision =
  | "DB_DIRECT"
  | "GROUNDED_AI"
  | "HUMAN_REQUIRED"
  | "INSUFFICIENT_EVIDENCE";

// ── Policy result ─────────────────────────────────────────────────────────────

export interface PolicyResult {
  decision:         AnswerPolicyDecision;
  reason:           string;
  /** AI를 호출해야 하는 경우 true. */
  requires_ai:      boolean;
  /** 즉시 답변 가능 (DB_DIRECT). */
  can_answer_directly: boolean;
}

// ── Domain policy input ────────────────────────────────────────────────────────

/**
 * Domain-specific policy evaluator가 구현하는 인터페이스.
 * RT2 이후 각 Retriever/Adapter에서 결정.
 *
 * 이번 RT1에서는 type 선언만. 실제 domain 로직은 각 RT에서 구현.
 */
export interface DomainPolicyEvaluator {
  /**
   * EvidencePack을 받아 AnswerPolicyDecision을 반환한다.
   * domain-specific 규칙 (answer_mode, intent, confidence 등)을 적용.
   */
  evaluate(pack: EvidencePack): PolicyResult;
}

// ── Shared policy constants ────────────────────────────────────────────────────

export const POLICY_RESULTS = {
  DB_DIRECT: (reason = "Single KB fact covers the question"): PolicyResult => ({
    decision:            "DB_DIRECT",
    reason,
    requires_ai:         false,
    can_answer_directly: true,
  }),

  GROUNDED_AI: (reason = "Multiple facts require synthesis"): PolicyResult => ({
    decision:            "GROUNDED_AI",
    reason,
    requires_ai:         true,
    can_answer_directly: false,
  }),

  HUMAN_REQUIRED: (reason = "Policy: human review required for this topic"): PolicyResult => ({
    decision:            "HUMAN_REQUIRED",
    reason,
    requires_ai:         false,
    can_answer_directly: false,
  }),

  INSUFFICIENT_EVIDENCE: (reason = "Retrieval exhausted but no usable evidence"): PolicyResult => ({
    decision:            "INSUFFICIENT_EVIDENCE",
    reason,
    requires_ai:         false,
    can_answer_directly: false,
  }),
} as const;

// ── Baseline policy helper ────────────────────────────────────────────────────

/**
 * EvidencePack confidence 기반 기본 정책.
 *
 * 각 domain Retriever가 이 helper를 기반으로 확장할 수 있다.
 *
 * 규칙:
 *   - ai_callable=false → INSUFFICIENT_EVIDENCE
 *   - confidence=HIGH → DB_DIRECT 후보 (domain이 overrule 가능)
 *   - confidence=MEDIUM/LOW → GROUNDED_AI
 *   - INSUFFICIENT: "DB exact phrase와 질문이 다름" 자체는 INSUFFICIENT_EVIDENCE 아님.
 *     semantic/keyword retrieval까지 실패했을 때만.
 */
export function baselinePolicy(pack: EvidencePack): PolicyResult {
  if (!pack.ai_callable || pack.confidence === "INSUFFICIENT") {
    return POLICY_RESULTS.INSUFFICIENT_EVIDENCE("No usable evidence after full retrieval");
  }

  if (pack.confidence === "HIGH" && pack.verified_facts.length === 1) {
    return POLICY_RESULTS.DB_DIRECT("Single high-confidence fact");
  }

  return POLICY_RESULTS.GROUNDED_AI(
    `${pack.verified_facts.length} facts at ${pack.confidence} confidence`,
  );
}
