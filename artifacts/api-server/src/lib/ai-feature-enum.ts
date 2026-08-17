/**
 * AI Feature Enum — CS-PA0 공통 feature 상수
 *
 * 모든 AI 호출은 여기 정의된 값을 feature 필드에 사용한다.
 * event_logs.metadata->>'feature' 값과 일치해야 함.
 *
 * 규칙:
 * - 신규 AI 기능 추가 시 여기에 먼저 추가
 * - 화면마다 임의 문자열 금지
 * - 기존 값(teacher_diary, parent_curriculum_search)은 DB와의 호환성을 위해 그대로 유지
 */

export const AI_FEATURE = {
  /** 교사 AI 일지 생성 */
  TEACHER_AI_DIARY: "teacher_diary",
  /** 학부모 커리큘럼 AI 검색/대화 */
  PARENT_CURRICULUM_AI: "parent_curriculum_search",
  /** 성장 리포트 AI 생성 */
  GROWTH_REPORT_AI: "growth_report_ai",
  /** AI 고객센터 */
  SUPPORT_AI: "support_ai",
  /** 영상 분석 (향후) */
  VIDEO_ANALYSIS: "video_analysis",
  /** AI 검색 (향후) */
  AI_SEARCH: "ai_search",
  /** 리포트 요약 (향후) */
  REPORT_SUMMARY: "report_summary",
  /** 기타 */
  OTHER: "other",
} as const;

export type AiFeature = (typeof AI_FEATURE)[keyof typeof AI_FEATURE];

/** feature 값이 유효한 enum 값인지 확인 */
export function isValidAiFeature(value: string): value is AiFeature {
  return Object.values(AI_FEATURE).includes(value as AiFeature);
}

/** feature 표시명 (UI용) */
export const AI_FEATURE_LABEL: Record<AiFeature, string> = {
  teacher_diary:             "교사 AI 일지",
  parent_curriculum_search:  "학부모 커리큘럼 AI",
  growth_report_ai:          "성장 리포트 AI",
  support_ai:                "AI 고객센터",
  video_analysis:            "영상 분석",
  ai_search:                 "AI 검색",
  report_summary:            "리포트 요약",
  other:                     "기타",
};

/**
 * LLM Avoidance 소스 분류
 * llm_used=false 일 때의 해결 경로
 */
export const RESOLUTION_SOURCE = {
  RULE:         "RULE",
  KNOWN_ISSUE:  "KNOWN_ISSUE",
  SOLUTION_DB:  "SOLUTION_DB",
  FAQ:          "FAQ",
  CACHE:        "CACHE",
  LLM:          "LLM",
  HUMAN:        "HUMAN",
} as const;

export type ResolutionSource = (typeof RESOLUTION_SOURCE)[keyof typeof RESOLUTION_SOURCE];

/**
 * Support Case 상태
 */
export const SUPPORT_CASE_STATE = {
  NEW:              "NEW",
  AI_PROCESSING:    "AI_PROCESSING",
  AI_RESPONDED:     "AI_RESPONDED",
  AI_RESOLVED:      "AI_RESOLVED",
  HUMAN_REQUIRED:   "HUMAN_REQUIRED",
  HUMAN_RESPONDED:  "HUMAN_RESPONDED",
  ESCALATED:        "ESCALATED",
  RESOLVED:         "RESOLVED",
  CLOSED:           "CLOSED",
} as const;

export type SupportCaseState = (typeof SUPPORT_CASE_STATE)[keyof typeof SUPPORT_CASE_STATE];

/**
 * Escalation 사유
 */
export const ESCALATION_REASON = {
  NO_KNOWLEDGE:           "NO_KNOWLEDGE",
  LOW_CONFIDENCE:         "LOW_CONFIDENCE",
  USER_REQUESTED_HUMAN:   "USER_REQUESTED_HUMAN",
  ACCOUNT_ACTION_REQUIRED:"ACCOUNT_ACTION_REQUIRED",
  BILLING_REQUIRED:       "BILLING_REQUIRED",
  REFUND_REQUIRED:        "REFUND_REQUIRED",
  BUG_REPORT:             "BUG_REPORT",
  SAFETY_OR_PRIVACY:      "SAFETY_OR_PRIVACY",
  OTHER:                  "OTHER",
} as const;

export type EscalationReason = (typeof ESCALATION_REASON)[keyof typeof ESCALATION_REASON];

/**
 * Knowledge item 유형
 */
export const KNOWLEDGE_ITEM_TYPE = {
  FAQ:          "FAQ",
  RULE:         "RULE",
  KNOWN_ISSUE:  "KNOWN_ISSUE",
  SOLUTION:     "SOLUTION",
} as const;

export type KnowledgeItemType = (typeof KNOWLEDGE_ITEM_TYPE)[keyof typeof KNOWLEDGE_ITEM_TYPE];
