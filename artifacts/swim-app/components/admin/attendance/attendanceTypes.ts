import Colors from "@/constants/colors";

export interface ClassGroup { id: string; name: string; }
export interface Student    { id: string; name: string; class_group_id: string | null; }
export interface WeeklyRow {
  student_id: string; student_name: string;
  class_group_id: string | null; class_name: string | null;
  days: Record<string, string>;
}
export interface MonthlySummaryRow {
  student_id: string; student_name: string;
  class_group_id: string | null; class_name: string | null;
  present: number; absent: number; late: number; total: number;
}
export interface SearchRecord {
  id: string; date: string; status: string;
  student_id: string | null; student_name: string | null;
  class_group_id: string | null; class_name: string | null;
}
export interface MakeupSession {
  id: string; student_id: string; student_name: string;
  original_class_group_id: string | null; original_class_group_name: string;
  original_teacher_id: string | null; original_teacher_name: string;
  absence_date: string; status: string;
}
export interface EligibleClass {
  id: string; name: string; schedule_days: string; schedule_time: string;
  capacity: number; current_members: number; available_slots: number;
  instructor: string; teacher_user_id: string;
}

export type AttStatus = "present" | "absent" | "late";
export type ViewMode  = "daily" | "weekly" | "monthly" | "search" | "makeup";

export const STATUS_CONFIG = {
  present: { label: "출석", color: Colors.light.present, bg: "#E6FFFA", icon: "check-circle" as const },
  absent:  { label: "결석", color: Colors.light.absent,  bg: "#F9DEDA", icon: "x-circle"    as const },
  late:    { label: "지각", color: Colors.light.late,    bg: "#FFF1BF", icon: "clock"        as const },
};

export const DAYS_KO = ["일", "월", "화", "수", "목", "금", "토"];

export const SEARCH_DAY_OPTIONS = [
  { label: "최근 7일",  value: 7  },
  { label: "최근 30일", value: 30 },
  { label: "전체",      value: 0  },
];

export const EXTINGUISH_REASONS = [
  { key: "보강원하지않음", label: "보강 원하지 않음" },
  { key: "무단결석",       label: "무단결석" },
  { key: "기타",           label: "기타 (직접입력)" },
];
