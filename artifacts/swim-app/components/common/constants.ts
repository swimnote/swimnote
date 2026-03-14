/**
 * 전역 상태 색상 상수 — 앱 전체에서 이 값만 사용
 */

export const STATUS_COLORS = {
  pending: {
    color:  "#D97706",
    bg:     "#FEF3C7",
    border: "#F59E0B",
    label:  "대기",
    icon:   "clock" as const,
  },
  approved: {
    color:  "#059669",
    bg:     "#D1FAE5",
    border: "#10B981",
    label:  "승인",
    icon:   "check-circle" as const,
  },
  rejected: {
    color:  "#DC2626",
    bg:     "#FEE2E2",
    border: "#EF4444",
    label:  "거절됨",
    icon:   "x-circle" as const,
  },
  invited: {
    color:  "#3B82F6",
    bg:     "#DBEAFE",
    border: "#60A5FA",
    label:  "초대 보냄",
    icon:   "send" as const,
  },
  waitingApproval: {
    color:  "#D97706",
    bg:     "#FEF3C7",
    border: "#F59E0B",
    label:  "승인 대기",
    icon:   "clock" as const,
  },
  free: {
    color:  "#059669",
    bg:     "#D1FAE5",
    border: "#10B981",
    label:  "무료 이용",
    icon:   "gift" as const,
  },
  paid: {
    color:  "#1A5CFF",
    bg:     "#EEF3FF",
    border: "#3B82F6",
    label:  "유료 이용",
    icon:   "credit-card" as const,
  },
  inactive: {
    color:  "#6B7280",
    bg:     "#F3F4F6",
    border: "#D1D5DB",
    label:  "비활성",
    icon:   "minus-circle" as const,
  },
  all: {
    color:  "#374151",
    bg:     "#F9FAFB",
    border: "#E5E7EB",
    label:  "전체",
    icon:   "list" as const,
  },
} as const;

export type StatusKey = keyof typeof STATUS_COLORS;

/** 출결 전용 */
export const ATT_COLORS = {
  present: { color: "#059669", bg: "#D1FAE5", label: "출석", icon: "check-circle" as const },
  absent:  { color: "#DC2626", bg: "#FEE2E2", label: "결석", icon: "x-circle"    as const },
  late:    { color: "#D97706", bg: "#FEF3C7", label: "지각", icon: "clock"        as const },
} as const;
