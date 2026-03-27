import type { LevelDef } from "@/components/common/LevelBadge";
import type { StudentMember } from "@/utils/studentUtils";

export interface ClassGroup {
  id: string;
  name: string;
  schedule_days: string;
  schedule_time: string;
  instructor: string | null;
  student_count: number;
}

export interface DetailData extends StudentMember {
  class_name: string | null;
  teacher_name: string | null;
  parent_account_name: string | null;
  parent_link_status: string | null;
  recent_attendance: { date: string; status: string }[];
  recent_diaries: {
    id: string;
    lesson_date: string;
    common_content: string;
    teacher_name: string;
    student_note: string | null;
  }[];
  notes: string | null;
  memo: string | null;
}

export interface ActivityLog {
  id: string;
  target_name: string;
  action_type: string;
  target_type: string;
  before_value: string | null;
  after_value: string | null;
  actor_name: string;
  actor_role: string;
  note: string | null;
  created_at: string;
}

export interface LevelInfo {
  current_level_order: number | null;
  current_level: LevelDef | null;
  all_levels: LevelDef[];
}

export const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  active:    { label: "재원",   color: "#2EC4B6", bg: "#E6FFFA" },
  inactive:  { label: "연기",   color: "#D97706", bg: "#FFF1BF" },
  suspended: { label: "연기",   color: "#D97706", bg: "#FFF1BF" },
  withdrawn: { label: "퇴원",   color: "#D96C6C", bg: "#F9DEDA" },
  deleted:   { label: "삭제됨", color: "#9CA3AF", bg: "#F1F5F9" },
};
