/** parent_student_requests.request_type 실제 DB 값 */
export const PARENT_REQUEST_TYPES = {
  ABSENCE:    "absence",
  MAKEUP:     "makeup",
  POSTPONE:   "postpone",
  WITHDRAWAL: "withdrawal",
  COUNSELING: "counseling",
  INQUIRY:    "inquiry",
} as const;

export type ParentRequestType = typeof PARENT_REQUEST_TYPES[keyof typeof PARENT_REQUEST_TYPES];

export const VALID_REQUEST_TYPES: readonly string[] = Object.values(PARENT_REQUEST_TYPES);

export const REQUEST_TYPE_LABELS: Record<string, string> = {
  absence:    "결석 신청",
  makeup:     "보강 요청",
  postpone:   "연기 신청",
  withdrawal: "퇴원 신청",
  counseling: "상담 요청",
  inquiry:    "문의",
};
