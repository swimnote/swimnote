/**
 * components/super/security-settings/types.ts
 * security-settings 화면의 공유 타입·상수·헬퍼
 */
import type { SuperAdminAccount, SuperAdminSession } from "@/domain/types";

// ─── 색상 상수 ──────────────────────────────────────────────────────────────
export const P      = "#7C3AED";
export const DANGER = "#D96C6C";
export const WARN   = "#D97706";
export const GREEN  = "#1F8F86";

// ─── 2차 인증 ───────────────────────────────────────────────────────────────
export type TwoFAMode = "disabled" | "otp" | "sms" | "email" | "otp_sms_backup";

export const TWO_FA_OPTIONS: { key: TwoFAMode; label: string; desc: string }[] = [
  { key: "disabled",       label: "비활성",         desc: "2차 인증 없음 (권장하지 않음)" },
  { key: "otp",            label: "OTP 앱 인증",    desc: "Google Authenticator / Authy 등" },
  { key: "sms",            label: "SMS 인증",       desc: "등록된 휴대폰 번호로 인증코드 발송" },
  { key: "email",          label: "이메일 인증",     desc: "등록된 이메일로 인증코드 발송" },
  { key: "otp_sms_backup", label: "OTP + SMS 백업", desc: "OTP 우선, 불가시 SMS로 백업" },
];

export type SensitiveTrigger = "always" | "sensitive_only";
export const SENSITIVE_TRIGGERS: { key: SensitiveTrigger; label: string }[] = [
  { key: "always",         label: "로그인 시 항상 2차 인증" },
  { key: "sensitive_only", label: "킬스위치·백업·삭제·권한변경·구독변경·구독료변경·용량비용변경·운영자정보수정·슈퍼관리자 개인정보변경 시 OTP 인증" },
];

// ─── 외부 서비스 ─────────────────────────────────────────────────────────────
export type ServiceStatus =
  | "normal"
  | "caution"
  | "warning"
  | "error"
  | "disconnected"
  | "unconnected"
  | "checking"
  | "planned";

export interface ExtService {
  id: string;
  category: "data" | "payment" | "messaging" | "appstore" | "other";
  name: string;
  icon: string;
  serviceType: string;
  status: ServiceStatus;
  isConnected: boolean;
  endpointUrl?: string;
  projectId?: string;
  bucketName?: string;
  connectedAt?: string;
  lastCheckedAt: string | null;
  lastErrorAt?: string | null;
  statusMessage: string;
  notes?: string;
  isPlaceholder?: boolean;
}

export const STATUS_CFG: Record<ServiceStatus, { label: string; color: string; bg: string; icon: string }> = {
  normal:       { label: "정상",       color: GREEN,    bg: "#DDF2EF", icon: "check-circle" },
  caution:      { label: "주의",       color: "#D97706", bg: "#FEF3C7", icon: "alert-circle" },
  warning:      { label: "경고",       color: "#DC6803", bg: "#FFF1BF", icon: "alert-triangle" },
  error:        { label: "작동 안 됨", color: DANGER,   bg: "#FEE2E2", icon: "x-circle" },
  disconnected: { label: "끊김",       color: "#DC2626", bg: "#FEE2E2", icon: "wifi-off" },
  unconnected:  { label: "미연결",     color: "#6B7280", bg: "#F3F4F6", icon: "minus-circle" },
  checking:     { label: "점검중",     color: "#8B5CF6", bg: "#EDE9FE", icon: "loader" },
  planned:      { label: "예정",       color: "#9A948F", bg: "#F6F3F1", icon: "clock" },
};

export const CATEGORY_CFG: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  data:      { label: "데이터/인프라",  icon: "database",    color: GREEN,    bg: "#DDF2EF" },
  payment:   { label: "결제/정산",      icon: "credit-card", color: P,        bg: "#EEDDF5" },
  messaging: { label: "알림/메시징",    icon: "bell",        color: "#D97706", bg: "#FEF3C7" },
  appstore:  { label: "앱스토어/배포",  icon: "package",     color: "#0284C7", bg: "#E0F2FE" },
  other:     { label: "기타 외부 연동", icon: "link",        color: "#6B7280", bg: "#F3F4F6" },
};

// ─── 헬퍼 ──────────────────────────────────────────────────────────────────
export const _ago = (min: number): string =>
  new Date(Date.now() - min * 60000).toISOString();

export function isAccountLocked(acc: SuperAdminAccount): boolean {
  if (!acc.lockedUntil) return false;
  return new Date(acc.lockedUntil) > new Date();
}

export function relTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const diff = Date.now() - d.getTime();
  const m = Math.floor(Math.abs(diff) / 60000);
  const h = Math.floor(m / 60);
  if (m < 60)  return `${m}분 전`;
  if (h < 24)  return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export function fmtChecked(iso: string | null): string {
  if (!iso) return "확인 없음";
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 60)    return "방금 전";
  if (sec < 3600)  return `${Math.floor(sec / 60)}분 전`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
  return `${Math.floor(sec / 86400)}일 전`;
}

// ─── 계정·권한 ───────────────────────────────────────────────────────────────
export const ROLE_LABELS: Record<string, string> = {
  super_admin:     "슈퍼관리자",
  senior_admin:    "시니어관리자",
  admin:           "관리자",
  viewer:          "뷰어",
  support:         "지원팀",
  read_only_admin: "읽기전용",
  super_manager:   "슈퍼매니저",
};

export const REAUTH_ACTIONS = [
  "운영자 강제 해지",
  "플랜 강제 변경",
  "데이터 삭제",
  "권한 변경",
  "킬스위치 실행",
];

// ─── 세션 ────────────────────────────────────────────────────────────────────
export type FlatSession = SuperAdminSession & {
  accountId: string;
  accountName: string;
};

// ─── 로그인 이력 ─────────────────────────────────────────────────────────────
export type LoginStatus = "success" | "fail" | "block";

export interface LoginHistoryItem {
  id: string;
  at: string;
  ip: string;
  device: string;
  status: LoginStatus;
  method: string;
  failReason?: string;
}

export const LOGIN_HISTORY: LoginHistoryItem[] = [
  { id: "lh-001", at: "2026-03-22 11:42", ip: "211.234.56.78",  device: "Chrome / macOS",  status: "success", method: "OTP" },
  { id: "lh-002", at: "2026-03-22 09:17", ip: "211.234.56.78",  device: "Chrome / macOS",  status: "success", method: "OTP" },
  { id: "lh-003", at: "2026-03-21 20:03", ip: "175.112.34.90",  device: "Safari / iPhone", status: "fail",    method: "OTP", failReason: "OTP 코드 불일치" },
  { id: "lh-004", at: "2026-03-21 18:55", ip: "175.112.34.90",  device: "Safari / iPhone", status: "fail",    method: "OTP", failReason: "OTP 코드 만료" },
  { id: "lh-005", at: "2026-03-21 14:30", ip: "211.234.56.78",  device: "Chrome / macOS",  status: "success", method: "OTP" },
  { id: "lh-006", at: "2026-03-20 10:11", ip: "203.0.113.45",   device: "Edge / Windows",  status: "success", method: "SMS" },
  { id: "lh-007", at: "2026-03-19 22:47", ip: "198.51.100.22",  device: "Unknown",          status: "block",   method: "비밀번호", failReason: "5회 실패로 자동 차단" },
];
