/**
 * retrieval-result.ts — AI Data Runtime 공통 Retrieval 타입 (RT1)
 *
 * Production behavior 변경 없음.
 * 기존 route에서 import 금지 (RT2 이후 단계적 연결).
 *
 * DB 검색 동작은 이번 RT1에서 변경하지 않는다.
 * 이 파일은 공통 계약 타입 선언만 포함한다.
 */

import type { RuntimeDomain } from "./request-context.js";

// ── Source types ──────────────────────────────────────────────────────────────

/**
 * 검색 결과의 출처 유형.
 *
 * PROFESSIONAL_KNOWLEDGE / STUDENT_EVIDENCE는 Growth Report 단계를 위해
 * 지금 계약에 포함한다 (RT6에서 구현).
 */
export type RetrievalSourceType =
  | "KNOWLEDGE_ITEM"       // support_knowledge_items
  | "CURRICULUM_ITEM"      // curriculum_items
  | "DIARY_TEMPLATE"       // diary_templates
  | "UTTERANCE"            // support_intent_utterances (shortcut)
  | "PROFESSIONAL_KNOWLEDGE" // 미래: kf.v2_search_index 등
  | "STUDENT_EVIDENCE";    // 미래: growth_events 기반 개인 증거

// ── Match method ──────────────────────────────────────────────────────────────

/**
 * 어떤 기법으로 매칭되었는가.
 *
 * SEMANTIC은 현재 구현 없음. 계약에만 존재.
 */
export type MatchMethod =
  | "EXACT"        // 정규화 후 exact string match
  | "KEYWORD"      // ILIKE / token overlap 기반
  | "SEMANTIC"     // 벡터 유사도 (미래)
  | "PASSTHROUGH"; // 필터 없이 전체 전달 (curriculum 현재 방식)

// ── Confidence ────────────────────────────────────────────────────────────────

export type RetrievalConfidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";

// ── Missing reason ─────────────────────────────────────────────────────────────

export type MissingReason =
  | "NO_MATCH"        // 검색 자체 실패
  | "THRESHOLD_FAIL"  // 임계값 미달
  | "TIE_BREAK"       // 동점 처리 실패
  | "SCOPE_EMPTY"     // 검색 대상 자체 없음
  | "EVIDENCE_ZERO"   // 학생 개인 증거 없음
  | "SYNONYM_MISS"    // 동의어 매핑 실패
  | "KNOWLEDGE_GAP"   // 질문 intent/facet은 명확하지만 해당 canonical KI가 DB에 없음
  | "RANKING_MISS"    // 적합한 KI가 DB에 있으나 낮은 순위로 밀림 (slot mismatch 등)
  | "STATUS_EXCLUDED"; // 관련 KI 존재하지만 inactive/pending 상태

// ── RetrievalMatch ────────────────────────────────────────────────────────────

export interface RetrievalMatch {
  /** DB row PK 또는 식별자. */
  source_id:    string;
  source_type:  RetrievalSourceType;
  /** AI에 전달할 텍스트 (원문 또는 요약). 개인정보 미포함. */
  text:         string;
  /** 0–100. 검색 신뢰도. */
  score:        number;
  /** 동일 결과 집합 내 순위 (1-based). */
  rank:         number;
  match_method: MatchMethod;
  /**
   * 테넌트 소유 정보.
   * global scope source는 tenant_id를 "global"로 표시.
   * cross-tenant 검증에 사용.
   */
  tenant_id:    string;       // "global" or actual pool_id
  /** domain-specific 추가 정보. */
  metadata?:    Record<string, unknown>;
}

// ── RetrievalResult ────────────────────────────────────────────────────────────

export interface RetrievalResult {
  domain:          RuntimeDomain;
  tenant_id:       string;
  /** 정규화된 쿼리. 원문 아님. */
  query:           string;
  matches:         RetrievalMatch[];
  matched_count:   number;
  /** status/scope 필터로 제외된 수 (알 수 있는 경우). */
  excluded_count:  number;
  confidence:      RetrievalConfidence;
  usable_for_ai:   boolean;
  missing_reason?: MissingReason;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * matched_count, confidence, usable_for_ai를 자동 계산하여 RetrievalResult 생성.
 */
export function buildRetrievalResult(
  params: Omit<RetrievalResult, "matched_count" | "confidence" | "usable_for_ai"> & {
    matches: RetrievalMatch[];
    excluded_count: number;
    missing_reason?: MissingReason;
  },
): RetrievalResult {
  const matched_count = params.matches.length;

  let confidence: RetrievalConfidence;
  let usable_for_ai: boolean;

  if (matched_count === 0) {
    confidence = "NONE";
    usable_for_ai = false;
  } else {
    const topScore = Math.max(...params.matches.map(m => m.score));
    if (topScore >= 80) {
      confidence = "HIGH";
      usable_for_ai = true;
    } else if (topScore >= 50) {
      confidence = "MEDIUM";
      usable_for_ai = true;
    } else {
      confidence = "LOW";
      usable_for_ai = false;
    }
  }

  return {
    domain:          params.domain,
    tenant_id:       params.tenant_id,
    query:           params.query,
    matches:         params.matches,
    matched_count,
    excluded_count:  params.excluded_count,
    confidence,
    usable_for_ai,
    missing_reason:  params.missing_reason,
  };
}

/**
 * source가 주어진 tenant와 같은 tenant이거나 global인지 확인.
 */
export function isMatchTenantCompatible(
  match: RetrievalMatch,
  contextTenantId: string,
): boolean {
  return match.tenant_id === "global" || match.tenant_id === contextTenantId;
}
