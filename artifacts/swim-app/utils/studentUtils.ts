/**
 * 학생 회원 관련 공통 유틸 함수
 *
 * 대표 상태: 정상 / 미배정 / 휴원 / 퇴원 (회원 1명당 하나)
 * 주횟수 태그: 주1 / 주2 / 주3+ (정상 회원에게만 유효, 3회 이상은 주3으로 묶음)
 */

export type RegistrationPath = "admin_created" | "parent_requested";
export type WeeklyCount = 1 | 2 | 3;

export interface StudentMember {
  id: string;
  swimming_pool_id: string;
  name: string;
  birth_year?: string | null;
  birth_date?: string | null;
  phone?: string | null;
  parent_name?: string | null;
  parent_phone?: string | null;
  parent_user_id?: string | null;
  registration_path: RegistrationPath;
  status: string;
  weekly_count?: number | null;
  assigned_class_ids?: string[] | null;
  schedule_labels?: string | null;
  invite_code?: string | null;
  memo?: string | null;
  class_group_id?: string | null;
  class_group_name?: string | null;
  created_at: string;
  updated_at: string;
  withdrawn_at?: string | null;
  archived_reason?: string | null;
  // 예약 상태 (다음달 이동 예약)
  pending_status_change?: "suspended" | "withdrawn" | null;
  pending_effective_mode?: "next_month" | null;
  pending_effective_month?: string | null;
  // enriched
  assignedClasses?: AssignedClassInfo[];
}

export interface AssignedClassInfo {
  id: string;
  name: string;
  schedule_days: string;
  schedule_time: string;
  instructor?: string | null;
}

// ── 대표 상태 ────────────────────────────────────────────────────

export type PrimaryStatus = "normal" | "unassigned" | "suspended" | "withdrawn";

/**
 * 주횟수 배지 (3회 이상은 주3회+로 표시)
 */
export const WEEKLY_BADGE: Record<1 | 2 | 3, { bg: string; color: string; label: string }> = {
  1: { bg: "#DBEAFE", color: "#1D4ED8", label: "주1회" },
  2: { bg: "#D1FAE5", color: "#059669", label: "주2회" },
  3: { bg: "#EDE9FE", color: "#7C3AED", label: "주3회+" },
} as const;

/** 주횟수 — 3 이상은 3으로 cap */
export function getEffectiveWeekly(s: StudentMember): 1 | 2 | 3 {
  const wc = typeof s.weekly_count === "number" ? s.weekly_count : 1;
  return Math.min(Math.max(wc, 1), 3) as 1 | 2 | 3;
}

/**
 * 대표 상태 계산
 * - suspended → 휴원
 * - withdrawn → 퇴원
 * - active/pending_parent_link: assigned >= weekly_count → 정상, 아니면 미배정
 */
export function getPrimaryStatus(s: StudentMember): PrimaryStatus {
  const st = s.status;
  if (st === "suspended") return "suspended";
  if (st === "withdrawn") return "withdrawn";
  const ids = Array.isArray(s.assigned_class_ids) ? s.assigned_class_ids : [];
  const wc = typeof s.weekly_count === "number" && s.weekly_count > 0 ? s.weekly_count : 1;
  if (ids.length > 0 && ids.length >= wc) return "normal";
  return "unassigned";
}

export const PRIMARY_STATUS_BADGE: Record<PrimaryStatus, { label: string; color: string; bg: string }> = {
  normal:     { label: "정상",  color: "#059669", bg: "#D1FAE5" },
  unassigned: { label: "미배정", color: "#DC2626", bg: "#FEE2E2" },
  suspended:  { label: "휴원",  color: "#B45309", bg: "#FEF3C7" },
  withdrawn:  { label: "퇴원",  color: "#6B7280", bg: "#F3F4F6" },
};

// ── 예약 배지 ─────────────────────────────────────────────────────

export type PendingBadge = {
  label: string;
  color: string;
  bg: string;
} | null;

/**
 * 예약 배지 계산
 * pending_status_change 가 있고 pending_effective_mode = "next_month" 일 때 표시
 */
export function getMemberPendingBadge(s: StudentMember): PendingBadge {
  if (!s.pending_status_change || s.pending_effective_mode !== "next_month") return null;
  if (s.pending_status_change === "suspended") {
    return { label: "휴원예정", color: "#B45309", bg: "#FFFBEB" };
  }
  if (s.pending_status_change === "withdrawn") {
    return { label: "퇴원예정", color: "#DC2626", bg: "#FFF1F2" };
  }
  return null;
}

/** 다음 달 YYYY-MM 계산 */
export function getNextMonthStr(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

// ── 필터 ─────────────────────────────────────────────────────────

/** 필터 타입 — 전체/정상/미배정/주1/주2/주3/미연결/휴원/퇴원 */
export type StudentFilterKey =
  | "all"
  | "normal"
  | "unassigned"
  | "weekly_1"
  | "weekly_2"
  | "weekly_3"
  | "unlinked"
  | "suspended"
  | "withdrawn";

/**
 * 필터 적용
 * - 정상 = 대표상태 normal
 * - 미배정 = 대표상태 unassigned
 * - 주1/2/3 = 정상이면서 해당 주횟수 (3회 이상은 주3에 포함)
 * - 미연결 = parent_user_id 없음 (주 상태 무관)
 * - 휴원/퇴원 = 해당 대표 상태
 */
export function applyStudentFilter(students: StudentMember[], filter: StudentFilterKey): StudentMember[] {
  if (filter === "all") return students;
  return students.filter(s => {
    const ps = getPrimaryStatus(s);
    const wc = getEffectiveWeekly(s);
    switch (filter) {
      case "normal":     return ps === "normal";
      case "unassigned": return ps === "unassigned";
      case "weekly_1":   return ps === "normal" && wc === 1;
      case "weekly_2":   return ps === "normal" && wc === 2;
      case "weekly_3":   return ps === "normal" && wc >= 3;
      case "unlinked":   return !s.parent_user_id;
      case "suspended":  return ps === "suspended";
      case "withdrawn":  return ps === "withdrawn";
      default:           return true;
    }
  });
}

/** 검색 적용 (이름, 보호자이름, 전화번호) */
export function searchStudents(students: StudentMember[], query: string): StudentMember[] {
  if (!query.trim()) return students;
  const q = query.toLowerCase().trim();
  return students.filter(s =>
    s.name.toLowerCase().includes(q) ||
    (s.parent_name || "").toLowerCase().includes(q) ||
    (s.parent_phone || "").includes(q) ||
    (s.phone || "").includes(q)
  );
}

// ── 하위 호환 (기존 코드에서 직접 참조하는 함수들) ───────────────

/** @deprecated getPrimaryStatus 사용 권장 */
export function getStudentAssignmentStatus(s: StudentMember): "unassigned" | "mismatch" | "ok" {
  const ids = Array.isArray(s.assigned_class_ids) ? s.assigned_class_ids : [];
  const wc = s.weekly_count || 1;
  if (ids.length === 0) return "unassigned";
  if (ids.length !== wc) return "mismatch";
  return "ok";
}

/** @deprecated parent_user_id 유무로 직접 판단 권장 */
export function getStudentConnectionStatus(s: StudentMember): "linked" | "pending" | "none" {
  if (s.parent_user_id) return "linked";
  if (s.status === "pending_parent_link") return "pending";
  return "none";
}

/** 수업 라벨 생성: "월4·목7" 형식 */
export function toShortScheduleLabel(classes: AssignedClassInfo[]): string {
  return classes.map(c => {
    const days = c.schedule_days.split(",").map(d => d.trim());
    const time = c.schedule_time.split(":")[0];
    return days.map(d => `${d}${time}`).join("·");
  }).join("·");
}

/** 초대 문자 메시지 생성 */
export function buildInviteMessage(params: {
  poolName: string;
  studentName: string;
  inviteCode: string;
  appUrl: string;
}): string {
  const { poolName, studentName, inviteCode, appUrl } = params;
  return `[스윔노트] ${poolName} 학부모 앱 초대\n\n안녕하세요! ${poolName}입니다.\n${studentName} 어린이의 수업 정보 확인을 위해 스윔노트 앱에 가입해주세요.\n\n▶ 초대코드: ${inviteCode}\n▶ 앱 다운로드/접속: ${appUrl}\n\n앱 가입 후 초대코드를 입력하면 아이의 수업 현황을 실시간으로 확인하실 수 있습니다.`;
}

/** 전화번호 정규화 */
export function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, "").replace(/^(\d{3})(\d{4})(\d{4})$/, "$1-$2-$3");
}

/** 전화번호 유효성 검사 */
export function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/[^0-9]/g, "");
  return /^010\d{8}$/.test(digits) || /^0[1-9]\d{7,8}$/.test(digits);
}

/** 출생년도 유효성 검사 */
export function isValidBirthYear(year: string): boolean {
  const y = parseInt(year);
  const current = new Date().getFullYear();
  return !isNaN(y) && y >= 2000 && y <= current;
}
