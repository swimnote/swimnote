import type { LevelDef } from "@/components/common/LevelBadge";
import type { StudentMember } from "@/utils/studentUtils";
import Colors from "@/constants/colors";

const C = Colors.light;

export interface ClassGroup {
  id: string;
  name: string;
  schedule_days: string;
  schedule_time: string;
  instructor: string | null;
  student_count: number;
}

export interface ParentLink {
  id: string;
  name: string;
  phone: string;
  link_status: string;
}

// ── WP-M2: 이번 달 출결 요약 ────────────────────────────────────────
export interface AttendanceSummary {
  current_month_present_count: number;
  current_month_absent_count: number;
  current_month_late_count: number;
}

// ── WP-M2: 보강 요약 ─────────────────────────────────────────────────
export interface MakeupSummary {
  /** waiting + expired 상태 합산 (배정 대기 중) */
  waiting_count: number;
  /** 배정 완료, 수업 미완료 */
  assigned_count: number;
  /** 수업 완료 */
  completed_count: number;
}

// ── WP-M2: 회원 상세 전체 Data Contract ─────────────────────────────
export interface DetailData extends StudentMember {
  // ── A. 기본정보 (s.* 에 포함, 여기서 명시 선언) ─────────────────
  notes: string | null;
  memo: string | null;
  deleted_at?: string | null;
  archived_reason?: string | null;
  class_enrolled_at?: string | null;
  is_purged?: boolean;

  // ── B. 보호자 연락처 (WP-M1 P1 → WP-M2에서 정식 선언) ───────────
  parent_phone2?: string | null;
  parent_phone3?: string | null;
  parent_phone4?: string | null;

  // ── C. 반/수강 정보 (WP-M2 additive) ────────────────────────────
  class_name: string | null;
  class_schedule_days?: string | null;
  class_schedule_time?: string | null;
  class_capacity?: number | null;
  teacher_user_id?: string | null;
  teacher_name: string | null;

  // ── D. 레벨 정보 (WP-M2 additive) ───────────────────────────────
  /** 학생 개인 레벨 SoT: students.current_level_order */
  current_level_order?: number | null;
  current_level_name?: string | null;
  current_level_color?: string | null;
  current_level_text_color?: string | null;

  // ── E. 이번 달 출결 요약 (WP-M2 additive) ────────────────────────
  attendance_summary?: AttendanceSummary;

  // ── F. 보강 요약 (WP-M2 additive) ────────────────────────────────
  makeup_summary?: MakeupSummary;

  // ── G. 학부모 계정 summary (WP-M2 additive) ──────────────────────
  parent_account_linked?: boolean;
  parent_account_id?: string | null;
  parent_account_name: string | null;
  parent_link_status: string | null;

  // ── 기존 필드 유지 ────────────────────────────────────────────────
  parents?: ParentLink[];
  recent_attendance: { date: string; status: string; class_group_id?: string | null }[];
  recent_diaries: {
    id: string;
    lesson_date: string;
    common_content: string;
    teacher_name: string;
    student_note: string | null;
  }[];
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

// ── 회원 상태 meta (STATUS_META에 WP-M1 추가 status 반영) ────────────
export const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  active:    { label: "재원",     color: C.brandStrong, bg: C.brandSoft },
  inactive:  { label: "연기",     color: "#D97706", bg: "#FFF1BF" },
  suspended: { label: "연기",     color: "#D97706", bg: "#FFF1BF" },
  archived:  { label: "아카이브", color: "#6B7280", bg: "#F3F4F6" },
  withdrawn: { label: "퇴원",     color: "#D96C6C", bg: "#F9DEDA" },
  deleted:   { label: "삭제됨",   color: "#9CA3AF", bg: "#F1F5F9" },
};
