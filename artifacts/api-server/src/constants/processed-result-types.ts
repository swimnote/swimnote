/**
 * parent_student_requests.processed_result_type 실제 DB 값
 *
 * PHASE 1: makeup_assignment 만 사용
 * PHASE 2~3 확장 예정: absence_record, class_change, postpone_record 등
 */
export const PROCESSED_RESULT_TYPES = {
  MAKEUP_ASSIGNMENT: "makeup_assignment",
} as const;

export type ProcessedResultType =
  typeof PROCESSED_RESULT_TYPES[keyof typeof PROCESSED_RESULT_TYPES];
