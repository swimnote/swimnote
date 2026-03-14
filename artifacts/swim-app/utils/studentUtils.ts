/**
 * 학생 회원 관련 공통 유틸 함수
 */

export type RegistrationPath = "admin_created" | "parent_requested";
export type StudentStatus = "active" | "pending_parent_link";
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
  status: StudentStatus | string;
  weekly_count?: number | null;
  assigned_class_ids?: string[] | null;
  schedule_labels?: string | null;
  invite_code?: string | null;
  memo?: string | null;
  class_group_id?: string | null;
  class_group_name?: string | null;
  created_at: string;
  updated_at: string;
  // enriched fields
  assignedClasses?: AssignedClassInfo[];
}

export interface AssignedClassInfo {
  id: string;
  name: string;
  schedule_days: string;
  schedule_time: string;
  instructor?: string | null;
}

/** 주1/주2/주3 배지 색상 */
export const WEEKLY_BADGE = {
  1: { bg: "#DBEAFE", color: "#1D4ED8", label: "주1회" },
  2: { bg: "#D1FAE5", color: "#059669", label: "주2회" },
  3: { bg: "#EDE9FE", color: "#7C3AED", label: "주3회" },
} as const;

/** 학생 배정 상태 계산 */
export function getStudentAssignmentStatus(s: StudentMember): "unassigned" | "mismatch" | "ok" {
  const ids = s.assigned_class_ids || [];
  const wc = s.weekly_count || 1;
  if (ids.length === 0) return "unassigned";
  if (ids.length !== wc) return "mismatch";
  return "ok";
}

/** 학부모 연결 상태 */
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

/** 필터 타입 */
export type StudentFilterKey =
  | "all"
  | "unassigned"
  | "pending_link"
  | "mismatch"
  | "weekly_1"
  | "weekly_2"
  | "weekly_3"
  | "linked";

/** 필터 적용 */
export function applyStudentFilter(students: StudentMember[], filter: StudentFilterKey): StudentMember[] {
  if (filter === "all") return students;
  return students.filter(s => {
    const assignStatus = getStudentAssignmentStatus(s);
    const connStatus = getStudentConnectionStatus(s);
    switch (filter) {
      case "unassigned":   return assignStatus === "unassigned";
      case "mismatch":     return assignStatus === "mismatch";
      case "pending_link": return connStatus === "pending";
      case "linked":       return connStatus === "linked";
      case "weekly_1":     return (s.weekly_count || 1) === 1;
      case "weekly_2":     return s.weekly_count === 2;
      case "weekly_3":     return s.weekly_count === 3;
      default:             return true;
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
