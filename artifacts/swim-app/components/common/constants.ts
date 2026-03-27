/**
 * 전역 상태 색상 상수 — 앱 전체에서 이 값만 사용
 */

export const STATUS_COLORS = {
  pending: {
    color:  "#D97706",
    bg:     "#FFF1BF",
    border: "#E4A93A",
    label:  "대기",
    icon:   "clock" as const,
  },
  approved: {
    color:  "#2EC4B6",
    bg:     "#E6FFFA",
    border: "#2E9B6F",
    label:  "승인",
    icon:   "check-circle" as const,
  },
  rejected: {
    color:  "#D96C6C",
    bg:     "#F9DEDA",
    border: "#D96C6C",
    label:  "거절됨",
    icon:   "x-circle" as const,
  },
  invited: {
    color:  "#4EA7D8",
    bg:     "#E6FFFA",
    border: "#4EA7D8",
    label:  "초대 보냄",
    icon:   "send" as const,
  },
  waitingApproval: {
    color:  "#D97706",
    bg:     "#FFF1BF",
    border: "#E4A93A",
    label:  "승인 대기",
    icon:   "clock" as const,
  },
  free: {
    color:  "#2EC4B6",
    bg:     "#E6FFFA",
    border: "#2E9B6F",
    label:  "무료 이용",
    icon:   "gift" as const,
  },
  paid: {
    color:  "#2EC4B6",
    bg:     "#E6FFFA",
    border: "#4EA7D8",
    label:  "유료 이용",
    icon:   "credit-card" as const,
  },
  inactive: {
    color:  "#6B7280",
    bg:     "#F8FAFC",
    border: "#D1D5DB",
    label:  "비활성",
    icon:   "minus-circle" as const,
  },
  all: {
    color:  "#111827",
    bg:     "#F1F5F9",
    border: "#E5E7EB",
    label:  "전체",
    icon:   "list" as const,
  },
} as const;

export type StatusKey = keyof typeof STATUS_COLORS;

/** 출결 전용 */
export const ATT_COLORS = {
  present: { color: "#2EC4B6", bg: "#E6FFFA", label: "출석", icon: "check-circle" as const },
  absent:  { color: "#D96C6C", bg: "#F9DEDA", label: "결석", icon: "x-circle"    as const },
  late:    { color: "#D97706", bg: "#FFF1BF", label: "지각", icon: "clock"        as const },
} as const;
