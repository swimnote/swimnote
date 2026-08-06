/**
 * curriculum-confidence.ts — Curriculum Item Match Confidence 계산
 *
 * ExtractedMeaning(교사 입력 의미)와 curriculum item(title+description)을
 * 키워드 토큰 겹침(token overlap) 방식으로 비교합니다.
 *
 * V1 설계 결정:
 *   - 알고리즘: matched_keywords / total_keywords (token overlap)
 *   - V1 고정: match_status = "PENDING_REVIEW". AUTO_ACCEPTED 금지.
 *   - threshold 미달: null 반환 (해당 candidate 제외)
 *   - allKeywords 길이 0: null 반환 (의미 키워드 없음)
 *   - 대소문자 구분 없음 (toLowerCase 정규화)
 *   - matching_algorithm_version = "token_overlap_v1"
 */

import type { ExtractedMeaning } from "./diary-parser.js";
import type { GrowthConfidenceConfigV1 } from "../config/growth-confidence-config.js";
import { validateConfidenceConfig } from "../config/growth-confidence-config.js";

// ── 공개 상수 ─────────────────────────────────────────────────────────────────

export const MATCHING_ALGORITHM_VERSION = "token_overlap_v1" as const;

// ── 공개 타입 ─────────────────────────────────────────────────────────────────

export interface ConfidenceResult {
  /** 0.0 ~ 1.0: matched_keywords / total_keywords */
  confidence: number;
  /** V1 고정 — AUTO_ACCEPTED 절대 사용 금지 */
  match_status: "PENDING_REVIEW";
  /** 알고리즘 식별자 */
  matching_algorithm_version: typeof MATCHING_ALGORITHM_VERSION;
}

// ── 메인 함수 ─────────────────────────────────────────────────────────────────

/**
 * 교사 메모의 의미(ExtractedMeaning)와 curriculum item 텍스트를
 * 키워드 토큰 겹침으로 비교하여 confidence를 계산합니다.
 *
 * @returns ConfidenceResult (threshold 이상) 또는 null (threshold 미달·키워드 없음)
 */
export function computeCurriculumConfidence(
  meaning: ExtractedMeaning,
  item: { title: string; description: string | null },
  config: GrowthConfidenceConfigV1,
): ConfidenceResult | null {
  validateConfidenceConfig(config);

  // allKeywords = strokes + skills + issues (2자 이상만)
  const keywords = [
    ...meaning.strokes,
    ...meaning.skills,
    ...meaning.issues,
  ].filter((k): k is string => typeof k === "string" && k.length >= 2);

  // 키워드가 없으면 매칭 불가 → null
  if (keywords.length === 0) return null;

  // title + description 합쳐 소문자 정규화
  const target = [item.title, item.description ?? ""].join(" ").toLowerCase();

  // 각 keyword가 target에 포함되는지 확인
  const matched = keywords.filter((k) =>
    target.includes(k.toLowerCase()),
  ).length;

  const score = matched / keywords.length; // 0.0 ~ 1.0

  // threshold 미달 → 제외
  if (score < config.reviewThreshold) return null;

  // V1: AUTO_ACCEPTED 절대 사용 금지
  return {
    confidence:                 Number(score.toFixed(4)),
    match_status:               "PENDING_REVIEW",
    matching_algorithm_version: MATCHING_ALGORITHM_VERSION,
  };
}
