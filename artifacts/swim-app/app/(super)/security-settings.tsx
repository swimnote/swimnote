/**
 * (super)/security-settings.tsx — 보안·설정 통합 화면
 * A. 계정 목록·권한·활성 여부
 * B. 1차 인증 (비밀번호 변경)
 * C. 2차 인증 옵션
 * D. 외부 서비스 연결 상태
 * E. 세션·접속 관리
 * F. 보안 정책
 */
import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  Modal, Pressable, ScrollView, StyleSheet,
  Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth, apiRequest } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { OtpGateModal } from "@/components/common/OtpGateModal";
import { useSecurityStore } from "@/store/securityStore";
import { useAuditLogStore } from "@/store/auditLogStore";
import type { SuperAdminAccount, SuperAdminRole, SuperAdminSession } from "@/domain/types";

const P = "#7C3AED";
const DANGER = "#D96C6C";
const WARN = "#D97706";
const GREEN = "#1F8F86";

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────
function isAccountLocked(acc: SuperAdminAccount): boolean {
  if (!acc.lockedUntil) return false;
  return new Date(acc.lockedUntil) > new Date();
}

function relTime(iso: string | null | undefined): string {
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

// ─── 2차 인증 옵션 ───────────────────────────────────────────────────────────
type TwoFAMode = "disabled" | "otp" | "sms" | "email" | "otp_sms_backup";
const TWO_FA_OPTIONS: { key: TwoFAMode; label: string; desc: string }[] = [
  { key: "disabled",       label: "비활성",         desc: "2차 인증 없음 (권장하지 않음)" },
  { key: "otp",            label: "OTP 앱 인증",    desc: "Google Authenticator / Authy 등" },
  { key: "sms",            label: "SMS 인증",       desc: "등록된 휴대폰 번호로 인증코드 발송" },
  { key: "email",          label: "이메일 인증",     desc: "등록된 이메일로 인증코드 발송" },
  { key: "otp_sms_backup", label: "OTP + SMS 백업", desc: "OTP 우선, 불가시 SMS로 백업" },
];

type SensitiveTrigger = "always" | "sensitive_only";
const SENSITIVE_TRIGGERS: { key: SensitiveTrigger; label: string }[] = [
  { key: "always",         label: "로그인 시 항상 2차 인증" },
  { key: "sensitive_only", label: "킬스위치·백업·삭제·권한변경·구독변경·구독료변경·용량비용변경·운영자정보수정·슈퍼관리자 개인정보변경 시 OTP 인증" },
];

// ─── 외부 서비스 시드 ────────────────────────────────────────────────────────
type ServiceStatus =
  | "normal"       // 정상
  | "caution"      // 주의
  | "warning"      // 경고
  | "error"        // 작동 안 됨
  | "disconnected" // 끊김
  | "unconnected"  // 미연결
  | "checking"     // 점검중
  | "planned";     // 예정

interface ExtService {
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

const STATUS_CFG: Record<ServiceStatus, { label: string; color: string; bg: string; icon: string }> = {
  normal:       { label: "정상",       color: "#1F8F86", bg: "#DDF2EF", icon: "check-circle" },
  caution:      { label: "주의",       color: "#D97706", bg: "#FEF3C7", icon: "alert-circle" },
  warning:      { label: "경고",       color: "#DC6803", bg: "#FFF1BF", icon: "alert-triangle" },
  error:        { label: "작동 안 됨", color: "#D96C6C", bg: "#FEE2E2", icon: "x-circle" },
  disconnected: { label: "끊김",       color: "#DC2626", bg: "#FEE2E2", icon: "wifi-off" },
  unconnected:  { label: "미연결",     color: "#6B7280", bg: "#F3F4F6", icon: "minus-circle" },
  checking:     { label: "점검중",     color: "#8B5CF6", bg: "#EDE9FE", icon: "loader" },
  planned:      { label: "예정",       color: "#9A948F", bg: "#F6F3F1", icon: "clock" },
};

const CATEGORY_CFG: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  data:      { label: "데이터/인프라",  icon: "database",    color: "#1F8F86", bg: "#DDF2EF" },
  payment:   { label: "결제/정산",      icon: "credit-card", color: "#7C3AED", bg: "#EEDDF5" },
  messaging: { label: "알림/메시징",    icon: "bell",        color: "#D97706", bg: "#FEF3C7" },
  appstore:  { label: "앱스토어/배포",  icon: "package",     color: "#0284C7", bg: "#E0F2FE" },
  other:     { label: "기타 외부 연동", icon: "link",        color: "#6B7280", bg: "#F3F4F6" },
};

const _ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
function fmtChecked(iso: string | null): string {
  if (!iso) return "확인 없음";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "방금 전";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

const INITIAL_SERVICES: ExtService[] = [
  // ── A. 데이터/인프라 ──────────────────────────────────────────────────
  { id: "supabase_db", category: "data", name: "Supabase DB", icon: "database",
    serviceType: "DB", status: "normal", isConnected: true,
    endpointUrl: "https://xxxxx.supabase.co", projectId: "xxxxxxxxxxxxxx",
    connectedAt: "2026-03-10T09:00:00Z", lastCheckedAt: _ago(5),
    statusMessage: "DB 응답 정상 (응답 12ms)", notes: "PostgreSQL 17 · 메인 운영 데이터베이스" },
  { id: "supabase_auth", category: "data", name: "Supabase Auth", icon: "shield",
    serviceType: "Auth", status: "normal", isConnected: true,
    endpointUrl: "https://xxxxx.supabase.co/auth/v1", projectId: "xxxxxxxxxxxxxx",
    connectedAt: "2026-03-10T09:00:00Z", lastCheckedAt: _ago(5),
    statusMessage: "인증 서비스 정상 동작 중", notes: "JWT 발급 · 세션 관리" },
  { id: "supabase_storage", category: "data", name: "Supabase Storage", icon: "archive",
    serviceType: "Storage", status: "caution", isConnected: true,
    endpointUrl: "https://xxxxx.supabase.co/storage/v1", projectId: "xxxxxxxxxxxxxx",
    bucketName: "swimnote-media", connectedAt: "2026-03-10T09:00:00Z", lastCheckedAt: _ago(12),
    statusMessage: "용량 사용률 82% — 임박", notes: "미디어 파일·영상 보조 저장소" },
  { id: "cloudflare_r2", category: "data", name: "Cloudflare R2", icon: "cloud",
    serviceType: "Storage", status: "normal", isConnected: true,
    endpointUrl: "https://xxxx.r2.cloudflarestorage.com", bucketName: "swimnote-primary",
    connectedAt: "2026-03-01T00:00:00Z", lastCheckedAt: _ago(12),
    statusMessage: "연결 정상 · 업로드 평균 180ms", notes: "영상 파일 메인 스토리지" },
  { id: "backup_storage", category: "data", name: "백업 스토리지", icon: "hard-drive",
    serviceType: "Storage", status: "unconnected", isConnected: false, lastCheckedAt: null,
    statusMessage: "아직 연결되지 않음", notes: "재해 복구용 오프사이트 백업 예정", isPlaceholder: true },
  { id: "cdn", category: "data", name: "CDN (Cloudflare)", icon: "globe",
    serviceType: "CDN", status: "normal", isConnected: true,
    endpointUrl: "https://cdn.swimnote.app", connectedAt: "2026-03-01T00:00:00Z", lastCheckedAt: _ago(3),
    statusMessage: "전 리전 정상 · 캐시 적중률 94%", notes: "정적 파일 · 이미지 CDN" },

  // ── B. 결제/정산 ──────────────────────────────────────────────────────
  { id: "portone", category: "payment", name: "PortOne", icon: "credit-card",
    serviceType: "Payment", status: "warning", isConnected: true,
    endpointUrl: "https://api.portone.io", projectId: "imp_xxxxxxxxxx",
    connectedAt: "2026-02-15T00:00:00Z", lastCheckedAt: _ago(60), lastErrorAt: _ago(30),
    statusMessage: "인증 토큰 만료 임박 (24시간 이내)", notes: "PG사 통합 결제 인터페이스" },
  { id: "pg_toss", category: "payment", name: "토스페이먼츠", icon: "zap",
    serviceType: "Payment", status: "normal", isConnected: true,
    endpointUrl: "https://api.tosspayments.com", projectId: "live_xxxxxxxxxx",
    connectedAt: "2026-02-15T00:00:00Z", lastCheckedAt: _ago(20),
    statusMessage: "결제 정상 처리 중", notes: "카드 · 간편결제 주 PG사" },
  { id: "pg_inicis", category: "payment", name: "KG이니시스", icon: "shopping-bag",
    serviceType: "Payment", status: "unconnected", isConnected: false, lastCheckedAt: null,
    statusMessage: "아직 연결되지 않음", notes: "법인카드 · 계좌이체 보조 PG 예정", isPlaceholder: true },
  { id: "pg_nice", category: "payment", name: "나이스페이", icon: "shopping-bag",
    serviceType: "Payment", status: "planned", isConnected: false, lastCheckedAt: null,
    statusMessage: "연결 예정", notes: "해외카드 지원 추가 PG 검토 중", isPlaceholder: true },
  { id: "settlement", category: "payment", name: "정산 계좌 연동", icon: "dollar-sign",
    serviceType: "Settlement", status: "unconnected", isConnected: false, lastCheckedAt: null,
    statusMessage: "아직 연결되지 않음", notes: "운영자 수익 정산 자동화 예정", isPlaceholder: true },

  // ── C. 알림/메시징 ───────────────────────────────────────────────────
  { id: "apns", category: "messaging", name: "Apple Push (APNs)", icon: "bell",
    serviceType: "Push", status: "normal", isConnected: true,
    endpointUrl: "https://api.push.apple.com", projectId: "com.swimnote.app",
    connectedAt: "2026-03-01T00:00:00Z", lastCheckedAt: _ago(8),
    statusMessage: "iOS 푸시 정상 발송 중", notes: "APNs JWT p8 키 등록 완료" },
  { id: "fcm", category: "messaging", name: "Firebase Cloud Messaging", icon: "smartphone",
    serviceType: "Push", status: "normal", isConnected: true,
    endpointUrl: "https://fcm.googleapis.com/v1", projectId: "swimnote-prod",
    connectedAt: "2026-03-01T00:00:00Z", lastCheckedAt: _ago(8),
    statusMessage: "Android 푸시 정상 발송 중", notes: "Firebase Admin SDK v2" },
  { id: "sms_provider", category: "messaging", name: "SMS (알림톡)", icon: "message-square",
    serviceType: "SMS", status: "error", isConnected: true,
    endpointUrl: "https://api.bizppurio.com", projectId: "swimnote_biz",
    connectedAt: "2026-02-01T00:00:00Z", lastCheckedAt: _ago(45), lastErrorAt: _ago(20),
    statusMessage: "알림톡 연동 오류 — 자체 발송으로 전환됨", notes: "카카오 비즈메시지 (비즈뿌리오)" },
  { id: "email_provider", category: "messaging", name: "Email (SendGrid)", icon: "mail",
    serviceType: "Email", status: "disconnected", isConnected: false,
    endpointUrl: "https://api.sendgrid.com", projectId: "swimnote-sg",
    connectedAt: "2026-01-15T00:00:00Z", lastCheckedAt: _ago(180), lastErrorAt: _ago(60),
    statusMessage: "SMTP 인증 실패 — API 키 재발급 필요", notes: "이메일 발송 서비스 (SendGrid)" },
  { id: "slack_notify", category: "messaging", name: "슬랙 내부 알림", icon: "hash",
    serviceType: "Notification", status: "unconnected", isConnected: false, lastCheckedAt: null,
    statusMessage: "아직 연결되지 않음", notes: "슈퍼관리자 장애/이상 감지 알림 예정", isPlaceholder: true },

  // ── D. 앱스토어/배포 ─────────────────────────────────────────────────
  { id: "app_store_connect", category: "appstore", name: "App Store Connect", icon: "monitor",
    serviceType: "AppStore", status: "unconnected", isConnected: false,
    projectId: "com.swimnote.app", lastCheckedAt: null,
    statusMessage: "API 연결 미구성", notes: "iOS 앱 구독 상태 조회용 — 추후 연결 예정", isPlaceholder: true },
  { id: "google_play_console", category: "appstore", name: "Google Play Console", icon: "box",
    serviceType: "PlayStore", status: "unconnected", isConnected: false,
    projectId: "com.swimnote.app", lastCheckedAt: null,
    statusMessage: "API 연결 미구성", notes: "Android 앱 구독 상태 조회용 — 추후 연결 예정", isPlaceholder: true },

  // ── E. 기타 외부 연동 ────────────────────────────────────────────────
  { id: "sentry", category: "other", name: "Sentry (오류 수집)", icon: "activity",
    serviceType: "Monitoring", status: "caution", isConnected: true,
    endpointUrl: "https://sentry.io/organizations/swimnote", projectId: "swimnote-react-native",
    connectedAt: "2026-03-01T00:00:00Z", lastCheckedAt: _ago(15),
    statusMessage: "오류 이벤트 급증 감지 (최근 1시간)", notes: "앱 오류 수집 · 성능 모니터링" },
  { id: "analytics", category: "other", name: "분석 서비스", icon: "bar-chart-2",
    serviceType: "Analytics", status: "planned", isConnected: false, lastCheckedAt: null,
    statusMessage: "연결 예정", notes: "사용 패턴 분석 · 이탈률 추적 예정", isPlaceholder: true },
  { id: "ads_provider", category: "other", name: "광고 연동", icon: "image",
    serviceType: "Ads", status: "planned", isConnected: false, lastCheckedAt: null,
    statusMessage: "연결 예정", notes: "학부모 화면 광고 플랫폼 검토 중", isPlaceholder: true },
];

const ROLE_LABELS: Record<string, string> = {
  super_admin:     "슈퍼관리자",
  senior_admin:    "시니어관리자",
  admin:           "관리자",
  viewer:          "뷰어",
  support:         "지원팀",
  read_only_admin: "읽기전용",
  super_manager:   "슈퍼매니저",
};

const REAUTH_ACTIONS = ["운영자 강제 해지", "플랜 강제 변경", "데이터 삭제", "권한 변경", "킬스위치 실행"];

// ─── 섹션 타이틀 ─────────────────────────────────────────────────────────────
function SectionTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <View style={{ gap: 2, marginBottom: 8 }}>
      <Text style={st.title}>{title}</Text>
      {sub && <Text style={st.sub}>{sub}</Text>}
    </View>
  );
}
const st = StyleSheet.create({
  title: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#1F1F1F" },
  sub:   { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9A948F" },
});

// ─── 메인 ─────────────────────────────────────────────────────────────────────
export default function SecuritySettingsScreen() {
  const { adminUser, token } = useAuth();
  const actorName = adminUser?.name ?? "슈퍼관리자";
  const createLog = useAuditLogStore(s => s.createLog);

  const accounts          = useSecurityStore(s => s.accounts);
  const terminateSess     = useSecurityStore(s => s.terminateSession);
  const lockAcc           = useSecurityStore(s => s.lockAccount);
  const unlockAcc         = useSecurityStore(s => s.unlockAccount);
  const resetFail         = useSecurityStore(s => s.resetFailCount);
  const addSuperManager   = useSecurityStore(s => s.addSuperManager);
  const deleteSuperManager = useSecurityStore(s => s.deleteSuperManager);

  // ── 슈퍼매니저 추가 모달 ──
  const [smAddModal,   setSmAddModal]   = useState(false);
  const [smName,       setSmName]       = useState("");
  const [smEmail,      setSmEmail]      = useState("");
  const [smPw,         setSmPw]         = useState("");
  const [smError,      setSmError]      = useState("");
  const [smSuccess,    setSmSuccess]    = useState(false);

  // ── 슈퍼매니저 삭제 확인 ──
  const [smDeleteId,   setSmDeleteId]   = useState<string | null>(null);
  const smDeleteTarget = useMemo(() => accounts.find(a => a.id === smDeleteId), [accounts, smDeleteId]);

  async function handleAddSuperManager() {
    setSmError("");
    if (!smName.trim())          { setSmError("이름을 입력하세요."); return; }
    if (!smEmail.includes("@"))  { setSmError("올바른 이메일 형식을 입력하세요."); return; }
    if (smPw.length < 8)         { setSmError("초기 비밀번호는 8자 이상이어야 합니다."); return; }
    if (accounts.some(a => a.email === smEmail)) { setSmError("이미 등록된 이메일입니다."); return; }
    try {
      const res = await apiRequest(token, "/auth/create-super-manager", {
        method: "POST",
        body: JSON.stringify({ name: smName.trim(), email: smEmail.trim(), password: smPw }),
      });
      const data = await res.json();
      if (!res.ok) { setSmError(data.error || data.message || "계정 생성에 실패했습니다."); return; }
      addSuperManager(smName.trim(), smEmail.trim(), data.user?.id);
    } catch {
      addSuperManager(smName.trim(), smEmail.trim());
    }
    createLog({ category: "보안", title: `슈퍼매니저 추가: ${smName.trim()}`, detail: `${smEmail.trim()} 계정 등록`, actorName, impact: "high" });
    setSmSuccess(true);
    setTimeout(() => { setSmAddModal(false); setSmSuccess(false); setSmName(""); setSmEmail(""); setSmPw(""); }, 1200);
  }

  function handleDeleteSuperManager() {
    if (!smDeleteId || !smDeleteTarget) return;
    deleteSuperManager(smDeleteId);
    createLog({ category: "보안", title: `관리자 삭제: ${smDeleteTarget.name}`, detail: `${smDeleteTarget.email} (${ROLE_LABELS[smDeleteTarget.role] ?? smDeleteTarget.role}) 계정 삭제`, actorName, impact: "high" });
    setSmDeleteId(null);
  }

  // 모든 활성 세션 (계정에서 flatten)
  type FlatSession = SuperAdminSession & { accountId: string; accountName: string };
  const allSessions = useMemo<FlatSession[]>(() =>
    accounts.flatMap(acc =>
      acc.sessions
        .filter(s => s.isActive)
        .map(s => ({ ...s, accountId: acc.id, accountName: acc.name }))
    )
  , [accounts]);

  // ── OTP 인증 게이트 ──
  type OtpAction = "pw" | "id" | "sm_add" | "sm_delete" | null;
  const [otpAction, setOtpAction] = useState<OtpAction>(null);

  // ── B. 비밀번호 ──
  const [pwModal,      setPwModal]      = useState(false);
  const [currentPw,    setCurrentPw]    = useState("");
  const [newPw,        setNewPw]        = useState("");
  const [confirmPw,    setConfirmPw]    = useState("");
  const [pwError,      setPwError]      = useState("");
  const [pwSuccess,    setPwSuccess]    = useState(false);
  const [lastPwChange, setLastPwChange] = useState("2026년 1월 15일");

  // ── B-2. ID 변경 ──
  const [idModal,       setIdModal]       = useState(false);
  const [currentId,     setCurrentId]     = useState("superadmin@swimnote.kr");
  const [newId,         setNewId]         = useState("");
  const [idVerifyPw,    setIdVerifyPw]    = useState("");
  const [idError,       setIdError]       = useState("");
  const [idSuccess,     setIdSuccess]     = useState(false);

  // ── C. 2차 인증 ──
  const [twoFAMode,     setTwoFAMode]     = useState<TwoFAMode>("otp");
  const [sensitiveTrig, setSensitiveTrig] = useState<SensitiveTrigger>("sensitive_only");
  const [twoFAModal,    setTwoFAModal]    = useState(false);
  const [pendingMode,   setPendingMode]   = useState<TwoFAMode | null>(null);
  const [forceEnabled,  setForceEnabled]  = useState(true);
  const [showRecoveryCodes, setShowRecoveryCodes] = useState(false);
  const [otpReenrollModal,  setOtpReenrollModal]  = useState(false);

  // ── D. 외부 서비스 ──
  const [services,        setServices]        = useState<ExtService[]>(INITIAL_SERVICES);
  const [refreshing,      setRefreshing]      = useState<string | null>(null);
  const [selectedService, setSelectedService] = useState<ExtService | null>(null);

  // ── F. 보안 정책 ──
  const [maxFail,     setMaxFail]     = useState(5);
  const [lockMinutes, setLockMinutes] = useState(30);

  // ── 계정 상세 모달 ──
  const [accountDetail, setAccountDetail] = useState<string | null>(null);
  const detailAcc = useMemo(() => accounts.find(a => a.id === accountDetail), [accounts, accountDetail]);

  function handlePwChange() {
    setPwError("");
    if (currentPw !== "admin1234") { setPwError("현재 비밀번호가 올바르지 않습니다."); return; }
    if (newPw.length < 8)          { setPwError("새 비밀번호는 8자 이상이어야 합니다."); return; }
    if (newPw !== confirmPw)        { setPwError("비밀번호 확인이 일치하지 않습니다."); return; }
    setOtpAction("pw");
  }
  function executePwChange() {
    setPwSuccess(true);
    setLastPwChange(new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" }));
    createLog({ category: "보안", title: "비밀번호 변경", detail: "슈퍼관리자 비밀번호 변경 완료 (OTP 인증)", actorName, impact: "high" });
    setTimeout(() => { setPwModal(false); setPwSuccess(false); setCurrentPw(""); setNewPw(""); setConfirmPw(""); }, 1200);
  }

  // 로그인 이력 시드 데이터
  const LOGIN_HISTORY = useMemo(() => [
    { id: "lh-001", at: "2026-03-22 11:42", ip: "211.234.56.78",  device: "Chrome / macOS",  status: "success" as const, method: "OTP" },
    { id: "lh-002", at: "2026-03-22 09:17", ip: "211.234.56.78",  device: "Chrome / macOS",  status: "success" as const, method: "OTP" },
    { id: "lh-003", at: "2026-03-21 20:03", ip: "175.112.34.90",  device: "Safari / iPhone", status: "fail"    as const, method: "OTP", failReason: "OTP 코드 불일치" },
    { id: "lh-004", at: "2026-03-21 18:55", ip: "175.112.34.90",  device: "Safari / iPhone", status: "fail"    as const, method: "OTP", failReason: "OTP 코드 만료" },
    { id: "lh-005", at: "2026-03-21 14:30", ip: "211.234.56.78",  device: "Chrome / macOS",  status: "success" as const, method: "OTP" },
    { id: "lh-006", at: "2026-03-20 10:11", ip: "203.0.113.45",   device: "Edge / Windows",  status: "success" as const, method: "SMS" },
    { id: "lh-007", at: "2026-03-19 22:47", ip: "198.51.100.22",  device: "Unknown",          status: "block"   as const, method: "비밀번호", failReason: "5회 실패로 자동 차단" },
  ], []);

  function handleIdChange() {
    setIdError("");
    if (!newId.includes("@"))        { setIdError("올바른 이메일 형식을 입력하세요."); return; }
    if (idVerifyPw !== "admin1234")  { setIdError("비밀번호가 올바르지 않습니다."); return; }
    setOtpAction("id");
  }
  function executeIdChange() {
    createLog({ category: "보안", title: `관리자 ID 변경: ${currentId} → ${newId}`, detail: "슈퍼관리자 로그인 ID 변경 (OTP 인증)", actorName, impact: "high" });
    setCurrentId(newId);
    setIdSuccess(true);
    setTimeout(() => { setIdModal(false); setIdSuccess(false); setNewId(""); setIdVerifyPw(""); }, 1400);
  }

  function confirmTwoFA() {
    if (!pendingMode) return;
    const prevLabel = TWO_FA_OPTIONS.find(o => o.key === twoFAMode)?.label ?? twoFAMode;
    const nextLabel = TWO_FA_OPTIONS.find(o => o.key === pendingMode)?.label ?? pendingMode;
    setTwoFAMode(pendingMode);
    createLog({ category: "보안", title: `2차 인증 방식 변경: ${prevLabel} → ${nextLabel}`, detail: "2FA 방식 변경", actorName, impact: "high" });
    setTwoFAModal(false); setPendingMode(null);
  }

  function refreshService(id: string) {
    const svc = services.find(s => s.id === id);
    if (!svc || svc.isPlaceholder) return;
    setRefreshing(id);
    setTimeout(() => {
      const checkedNow = new Date().toISOString();
      setServices(prev => prev.map(sv =>
        sv.id === id
          ? { ...sv, status: sv.status === "normal" ? "normal" : sv.status, lastCheckedAt: checkedNow }
          : sv
      ));
      setRefreshing(null);
      createLog({ category: "보안", title: `외부 서비스 확인: ${svc.name}`, detail: `연결 상태 수동 점검`, actorName, impact: "low" });
    }, 900);
  }

  function refreshAllServices() {
    const connected = services.filter(sv => !sv.isPlaceholder);
    connected.forEach(sv => refreshService(sv.id));
  }

  function doLock(accountId: string) {
    const hours = lockMinutes / 60;
    lockAcc(accountId, hours, actorName);
    createLog({ category: "보안", title: `계정 잠금: ${accounts.find(a => a.id === accountId)?.name}`, detail: `${lockMinutes}분 잠금`, actorName, impact: "high" });
    setAccountDetail(null);
  }

  function doUnlock(accountId: string) {
    unlockAcc(accountId, actorName);
    createLog({ category: "보안", title: `계정 잠금 해제: ${accounts.find(a => a.id === accountId)?.name}`, detail: "잠금 해제", actorName, impact: "medium" });
    setAccountDetail(null);
  }

  function doTerminateSession(sess: FlatSession) {
    terminateSess(sess.accountId, sess.id, actorName);
    createLog({ category: "보안", title: "세션 강제 종료", detail: `${sess.accountName} / ${sess.device} / ${sess.ip}`, actorName, impact: "high" });
  }

  function doResetFail(accountId: string) {
    resetFail(accountId);
    createLog({ category: "보안", title: `로그인 실패 초기화: ${accounts.find(a => a.id === accountId)?.name}`, detail: "실패 횟수 초기화", actorName, impact: "low" });
    setAccountDetail(null);
  }

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="보안·설정" homePath="/(super)/dashboard" />

      <ScrollView contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 60 }}>

        {/* ══ A. 계정 목록 ══ */}
        <View style={s.section}>
          <SectionTitle title="A. 슈퍼관리자 계정 관리" sub={`${accounts.length}개 계정`} />
          {accounts.map(acc => {
            const locked = isAccountLocked(acc);
            const isSuperManager = acc.role === "super_manager";
            return (
              <View key={acc.id} style={s.accountCardWrap}>
                <Pressable style={s.accountCard} onPress={() => !isSuperManager && setAccountDetail(acc.id)}>
                  <View style={[s.accountAvatar, { backgroundColor: isSuperManager ? "#E0F2FE" : acc.isActive ? "#EEDDF5" : "#F6F3F1" }]}>
                    <Text style={[s.accountAvatarTxt, { color: isSuperManager ? "#0284C7" : acc.isActive ? P : "#9A948F" }]}>{acc.name[0]}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={s.accountNameRow}>
                      <Text style={s.accountName}>{acc.name}</Text>
                      {locked && <View style={s.lockedBadge}><Text style={s.lockedTxt}>잠금</Text></View>}
                      {!acc.isActive && <View style={s.inactiveBadge}><Text style={s.inactiveTxt}>비활성</Text></View>}
                    </View>
                    <Text style={s.accountEmail}>{acc.email}</Text>
                    <View style={s.accountMetaRow}>
                      <View style={[s.roleBadge, isSuperManager && { backgroundColor: "#E0F2FE" }]}>
                        <Text style={[s.roleTxt, isSuperManager && { color: "#0284C7" }]}>{ROLE_LABELS[acc.role] ?? acc.role}</Text>
                      </View>
                      {isSuperManager && (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#F0FDF4", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 }}>
                          <Feather name="eye" size={9} color="#16A34A" />
                          <Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: "#16A34A" }}>읽기전용</Text>
                        </View>
                      )}
                      {!isSuperManager && (acc.twoFactorEnabled
                        ? <View style={s.twoFaBadgeOn}><Feather name="shield" size={9} color={GREEN} /><Text style={s.twoFaTxtOn}>2FA</Text></View>
                        : <View style={s.twoFaBadgeOff}><Feather name="shield-off" size={9} color="#9A948F" /><Text style={s.twoFaTxtOff}>2FA 없음</Text></View>)}
                      {acc.loginFailCount > 0 && (
                        <View style={s.failBadge}><Text style={s.failTxt}>실패 {acc.loginFailCount}회</Text></View>
                      )}
                    </View>
                  </View>
                  {acc.role !== "super_admin"
                    ? <Pressable style={s.smDeleteBtn} onPress={() => setSmDeleteId(acc.id)}>
                        <Feather name="trash-2" size={14} color={DANGER} />
                      </Pressable>
                    : <Feather name="chevron-right" size={14} color="#D1D5DB" />}
                </Pressable>
              </View>
            );
          })}

          {/* 슈퍼매니저 추가 버튼 */}
          <Pressable style={s.smAddBtn} onPress={() => setSmAddModal(true)}>
            <Feather name="user-plus" size={15} color="#0284C7" />
            <Text style={s.smAddBtnTxt}>슈퍼매니저 추가</Text>
          </Pressable>
          <View style={s.smInfoBox}>
            <Feather name="info" size={12} color="#0284C7" />
            <Text style={s.smInfoTxt}>슈퍼매니저는 운영콘솔 전체를 읽기 전용으로 열람할 수 있습니다. 수정·삭제·승인 등 쓰기 작업은 불가합니다. 회원가입 화면에서 직접 가입할 수 없습니다.</Text>
          </View>
        </View>

        {/* ══ B. 1차 인증 ══ */}
        <View style={s.section}>
          <SectionTitle title="B. 1차 인증 — 비밀번호" />
          <View style={s.infoRow}>
            <Feather name="lock" size={14} color={P} />
            <Text style={s.infoLabel}>마지막 비밀번호 변경</Text>
            <Text style={s.infoValue}>{lastPwChange}</Text>
          </View>
          <View style={s.infoRow}>
            <Feather name="info" size={14} color="#6F6B68" />
            <Text style={s.infoLabel}>비밀번호 정책</Text>
            <Text style={s.infoValue}>8자 이상 · 영문+숫자+특수문자</Text>
          </View>
          <Pressable style={s.actionBtn} onPress={() => setPwModal(true)}>
            <Feather name="key" size={15} color={P} />
            <Text style={s.actionBtnTxt}>비밀번호 변경</Text>
            <Feather name="chevron-right" size={14} color="#D1D5DB" style={{ marginLeft: "auto" }} />
          </Pressable>
        </View>

        {/* ══ B-2. 계정 ID 변경 ══ */}
        <View style={s.section}>
          <SectionTitle title="B-2. 관리자 ID 변경" sub="이메일 형식의 로그인 ID" />
          <View style={s.infoRow}>
            <Feather name="at-sign" size={14} color={P} />
            <Text style={s.infoLabel}>현재 ID</Text>
            <Text style={s.infoValue}>{currentId}</Text>
          </View>
          <Pressable style={s.actionBtn} onPress={() => setIdModal(true)}>
            <Feather name="edit-2" size={15} color={P} />
            <Text style={s.actionBtnTxt}>ID 변경</Text>
            <Feather name="chevron-right" size={14} color="#D1D5DB" style={{ marginLeft: "auto" }} />
          </Pressable>
        </View>

        {/* ══ C. 2차 인증 ══ */}
        <View style={s.section}>
          <SectionTitle title="C. 2차 인증 설정" sub="슈퍼관리자 전용 — 운영자/선생님/학부모 미적용" />

          {/* 강제 여부 */}
          <View style={s.forceRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.forceLabel}>2차 인증 강제</Text>
              <Text style={s.forceSub}>비활성화 시 2차 인증 건너뛰기 허용</Text>
            </View>
            <Pressable
              style={[s.forceBadge, forceEnabled ? s.forceBadgeOn : s.forceBadgeOff]}
              onPress={() => {
                const next = !forceEnabled;
                setForceEnabled(next);
                createLog({ category: "보안", title: `2차 인증 강제 ${next ? "활성" : "비활성"}`, detail: "2FA 강제 설정 변경", actorName, impact: "high" });
              }}>
              <Text style={[s.forceBadgeTxt, { color: forceEnabled ? GREEN : DANGER }]}>
                {forceEnabled ? "강제 ON" : "선택 OFF"}
              </Text>
            </Pressable>
          </View>

          <View style={s.currentTwoFa}>
            <Text style={s.currentTwoFaLabel}>현재 방식</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Feather name="shield" size={14} color={twoFAMode === "disabled" ? DANGER : GREEN} />
              <Text style={[s.currentTwoFaTxt, { color: twoFAMode === "disabled" ? DANGER : GREEN }]}>
                {TWO_FA_OPTIONS.find(o => o.key === twoFAMode)?.label}
              </Text>
            </View>
          </View>
          {TWO_FA_OPTIONS.map(opt => (
            <Pressable key={opt.key}
              style={[s.twoFaOption, twoFAMode === opt.key && s.twoFaOptionActive]}
              onPress={() => { setPendingMode(opt.key); setTwoFAModal(true); }}>
              <View style={[s.twoFaRadio, twoFAMode === opt.key && s.twoFaRadioActive]}>
                {twoFAMode === opt.key && <View style={s.twoFaRadioDot} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.twoFaOptLabel, twoFAMode === opt.key && { color: P }]}>{opt.label}</Text>
                <Text style={s.twoFaOptDesc}>{opt.desc}</Text>
              </View>
              {opt.key === "disabled" && <Feather name="alert-triangle" size={14} color={WARN} />}
            </Pressable>
          ))}
          <View style={s.triggerSection}>
            <Text style={s.triggerHeader}>추가 인증 적용 시점</Text>
            {SENSITIVE_TRIGGERS.map(t => (
              <Pressable key={t.key} style={s.triggerRow} onPress={() => setSensitiveTrig(t.key)}>
                <View style={[s.twoFaRadio, sensitiveTrig === t.key && s.twoFaRadioActive]}>
                  {sensitiveTrig === t.key && <View style={s.twoFaRadioDot} />}
                </View>
                <Text style={[s.triggerLabel, sensitiveTrig === t.key && { color: P }]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>

          {/* OTP 재등록 */}
          {(twoFAMode === "otp" || twoFAMode === "otp_sms_backup") && (
            <Pressable style={s.actionBtn} onPress={() => setOtpReenrollModal(true)}>
              <Feather name="refresh-cw" size={15} color="#1F8F86" />
              <Text style={[s.actionBtnTxt, { color: "#1F8F86" }]}>OTP 재등록 (QR 갱신)</Text>
              <Feather name="chevron-right" size={14} color="#D1D5DB" style={{ marginLeft: "auto" }} />
            </Pressable>
          )}

          {/* 복구 코드 */}
          <Pressable style={s.actionBtn} onPress={() => {
            setShowRecoveryCodes(v => !v);
            if (!showRecoveryCodes) createLog({ category: "보안", title: "복구 코드 조회", detail: "백업 코드 목록 열람", actorName, impact: "medium" });
          }}>
            <Feather name="key" size={15} color={P} />
            <Text style={s.actionBtnTxt}>{showRecoveryCodes ? "복구 코드 숨기기" : "복구 코드 보기"}</Text>
            <Feather name={showRecoveryCodes ? "chevron-up" : "chevron-down"} size={14} color="#D1D5DB" style={{ marginLeft: "auto" }} />
          </Pressable>
          {showRecoveryCodes && (
            <View style={s.recoveryCodesBox}>
              <Text style={s.recoveryCodesTitle}>백업 복구 코드 (1회용)</Text>
              <View style={s.recoveryCodesGrid}>
                {["JK9X-2M4P","BT7W-8Q3R","LN5C-6Y1V","MR2E-4Z8T","WD6A-0H7J","FK1S-9U3X","QP4N-5L6B","HG8D-2C7M"].map(code => (
                  <View key={code} style={s.recoveryCodeItem}>
                    <Text style={s.recoveryCode}>{code}</Text>
                  </View>
                ))}
              </View>
              <Text style={s.recoveryCodesHint}>안전한 곳에 보관하세요. 코드당 1회만 사용 가능합니다.</Text>
              <Pressable style={s.regenBtn} onPress={() => createLog({ category: "보안", title: "복구 코드 재생성", detail: "백업 코드 재발급", actorName, impact: "high" })}>
                <Feather name="refresh-cw" size={12} color={DANGER} />
                <Text style={s.regenTxt}>코드 재생성 (기존 코드 무효화)</Text>
              </Pressable>
            </View>
          )}

          {/* 2차 인증 실패 로그 */}
          <View style={s.failLogSection}>
            <Text style={s.failLogTitle}>2차 인증 실패 기록 (최근 3건)</Text>
            {[
              { id: "f1", time: "2026-03-22T09:15:00Z", ip: "211.47.22.xxx", device: "Chrome / Windows" },
              { id: "f2", time: "2026-03-21T22:08:00Z", ip: "61.78.109.xxx", device: "Safari / iPhone" },
              { id: "f3", time: "2026-03-20T14:55:00Z", ip: "175.211.33.xxx", device: "Chrome / Mac" },
            ].map(f => (
              <View key={f.id} style={s.failLogRow}>
                <Feather name="alert-circle" size={12} color={DANGER} />
                <View style={{ flex: 1 }}>
                  <Text style={s.failLogDevice}>{f.device}</Text>
                  <Text style={s.failLogMeta}>{f.ip} · {relTime(f.time)}</Text>
                </View>
                <View style={s.failLogBadge}>
                  <Text style={s.failLogBadgeTxt}>실패</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* ══ D. 외부 서비스 ══ */}
        <View style={s.section}>
          {/* 헤더 */}
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <SectionTitle title="D. 외부 서비스 연결 상태" />
              {(() => {
                const alerts = services.filter(sv => sv.status === "error" || sv.status === "disconnected" || sv.status === "warning").length;
                return alerts > 0 ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}>
                    <Feather name="alert-circle" size={12} color={DANGER} />
                    <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: DANGER }}>
                      {alerts}건 주의 필요
                    </Text>
                  </View>
                ) : (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}>
                    <Feather name="check-circle" size={12} color={GREEN} />
                    <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: GREEN }}>모든 연결 서비스 정상</Text>
                  </View>
                );
              })()}
            </View>
            <Pressable style={s.refreshAllBtn} onPress={refreshAllServices}>
              <Feather name="refresh-cw" size={13} color={P} />
              <Text style={s.refreshAllTxt}>전체 새로고침</Text>
            </Pressable>
          </View>

          {/* 카테고리별 서비스 목록 */}
          {(["data", "payment", "messaging", "appstore", "other"] as const).map(cat => {
            const catSvcs = services.filter(sv => sv.category === cat);
            if (catSvcs.length === 0) return null;
            const catCfg = CATEGORY_CFG[cat];
            return (
              <View key={cat} style={{ gap: 6 }}>
                {/* 카테고리 헤더 */}
                <View style={s.catHeader}>
                  <View style={[s.catIconBox, { backgroundColor: catCfg.bg }]}>
                    <Feather name={catCfg.icon as any} size={12} color={catCfg.color} />
                  </View>
                  <Text style={[s.catLabel, { color: catCfg.color }]}>{catCfg.label}</Text>
                  <View style={s.catLine} />
                </View>
                {/* 서비스 카드들 */}
                {catSvcs.map(sv => {
                  const cfg = STATUS_CFG[sv.status];
                  const isRef = refreshing === sv.id;
                  return (
                    <Pressable
                      key={sv.id}
                      style={[s.serviceCard, sv.status === "error" || sv.status === "disconnected"
                        ? { borderColor: cfg.color, borderWidth: 1.5 }
                        : {}]}
                      onPress={() => setSelectedService(sv)}
                    >
                      <View style={[s.serviceIconBox, { backgroundColor: cfg.bg }]}>
                        <Feather name={sv.icon as any} size={15} color={cfg.color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <Text style={s.serviceName}>{sv.name}</Text>
                          <View style={[s.statusBadge, { backgroundColor: cfg.bg }]}>
                            <Feather name={cfg.icon as any} size={9} color={cfg.color} />
                            <Text style={[s.statusTxt, { color: cfg.color }]}>{cfg.label}</Text>
                          </View>
                          {sv.isPlaceholder && (
                            <View style={s.placeholderTag}>
                              <Text style={s.placeholderTagTxt}>미연결</Text>
                            </View>
                          )}
                        </View>
                        <Text style={s.serviceMsg} numberOfLines={1}>{sv.statusMessage}</Text>
                        <Text style={s.serviceLastChecked}>
                          {sv.lastCheckedAt ? `확인: ${fmtChecked(sv.lastCheckedAt)}` : "확인 없음"}
                        </Text>
                      </View>
                      {!sv.isPlaceholder && (
                        <Pressable
                          style={[s.refreshBtn, isRef && { opacity: 0.5 }]}
                          disabled={isRef}
                          onPress={() => refreshService(sv.id)}
                          hitSlop={8}
                        >
                          <Feather name={isRef ? "loader" : "refresh-cw"} size={13} color={P} />
                        </Pressable>
                      )}
                      <Feather name="chevron-right" size={15} color="#C4BDB8" />
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
        </View>

        {/* ══ E. 세션·접속 관리 ══ */}
        <View style={s.section}>
          <SectionTitle title="E. 세션·접속 관리" sub={`활성 세션 ${allSessions.length}개`} />
          {allSessions.length === 0 && (
            <Text style={s.emptyTxt}>현재 활성 세션이 없습니다</Text>
          )}
          {allSessions.map(sess => (
            <View key={sess.id} style={s.sessionRow}>
              <View style={[s.sessionIconBox, { backgroundColor: "#F6F3F1" }]}>
                <Feather name="monitor" size={14} color="#6F6B68" />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={s.sessionDevice}>{sess.device}</Text>
                  <Text style={s.sessionOwner}>{sess.accountName}</Text>
                </View>
                <Text style={s.sessionMeta}>{sess.ip}</Text>
                <Text style={s.sessionTime}>시작: {relTime(sess.startedAt)}</Text>
              </View>
              <Pressable style={s.terminateBtn} onPress={() => doTerminateSession(sess)}>
                <Text style={s.terminateTxt}>종료</Text>
              </Pressable>
            </View>
          ))}
        </View>

        {/* ══ F. 보안 정책 ══ */}
        <View style={s.section}>
          <SectionTitle title="F. 보안 정책" />
          <View style={s.policyRow}>
            <Text style={s.policyLabel}>로그인 실패 제한</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Pressable style={s.policyBtn} onPress={() => setMaxFail(Math.max(3, maxFail - 1))}>
                <Text style={s.policyBtnTxt}>−</Text>
              </Pressable>
              <Text style={s.policyVal}>{maxFail}회</Text>
              <Pressable style={s.policyBtn} onPress={() => setMaxFail(Math.min(10, maxFail + 1))}>
                <Text style={s.policyBtnTxt}>+</Text>
              </Pressable>
            </View>
          </View>
          <View style={s.policyRow}>
            <Text style={s.policyLabel}>계정 잠금 시간</Text>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {([15, 30, 60, 120] as const).map(min => (
                <Pressable key={min} style={[s.policyChip, lockMinutes === min && s.policyChipActive]}
                  onPress={() => setLockMinutes(min)}>
                  <Text style={[s.policyChipTxt, lockMinutes === min && s.policyChipTxtActive]}>
                    {min >= 60 ? `${min / 60}h` : `${min}m`}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          <View style={{ gap: 6, paddingTop: 6 }}>
            <Text style={s.policyLabel}>재인증 필요 작업</Text>
            {REAUTH_ACTIONS.map(act => (
              <View key={act} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3 }}>
                <Feather name="check-circle" size={12} color={P} />
                <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: "#1F1F1F" }}>{act}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ══ G. 로그인 이력 ══ */}
        <View style={s.section}>
          <SectionTitle title="G. 로그인 이력" sub="최근 7건" />
          {LOGIN_HISTORY.map(log => {
            const isSuccess = log.status === "success";
            const isFail    = log.status === "fail";
            const isBlock   = log.status === "block";
            const color = isSuccess ? "#16A34A" : isBlock ? "#D96C6C" : "#D97706";
            const bg    = isSuccess ? "#DFF3EC" : isBlock ? "#FEF2F2" : "#FFFBEB";
            return (
              <View key={log.id} style={[s.infoRow, { backgroundColor: bg, borderRadius: 10, padding: 10, flexDirection: "column", alignItems: "flex-start", gap: 3 }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, width: "100%" }}>
                  <Feather name={isSuccess ? "check-circle" : isBlock ? "slash" : "alert-circle"} size={13} color={color} />
                  <Text style={[s.infoLabel, { color, flex: 1 }]}>{isSuccess ? "로그인 성공" : isBlock ? "계정 차단" : "로그인 실패"}</Text>
                  <Text style={[s.infoValue, { fontSize: 11 }]}>{log.at}</Text>
                </View>
                <Text style={[s.infoValue, { paddingLeft: 21, fontSize: 12 }]}>{log.device} · {log.ip} · {log.method}</Text>
                {(isFail || isBlock) && log.failReason && (
                  <Text style={[s.infoValue, { paddingLeft: 21, fontSize: 11, color }]}>{log.failReason}</Text>
                )}
              </View>
            );
          })}
        </View>

      </ScrollView>

      {/* ══ 계정 상세 모달 ══ */}
      {detailAcc && (
        <Modal visible animationType="slide" transparent statusBarTranslucent
          onRequestClose={() => setAccountDetail(null)}>
          <Pressable style={m.backdrop} onPress={() => setAccountDetail(null)}>
            <Pressable style={m.sheet} onPress={() => {}}>
              <View style={m.handle} />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                <View style={[m.avatar, { backgroundColor: detailAcc.isActive ? "#EEDDF5" : "#F6F3F1" }]}>
                  <Text style={[m.avatarTxt, { color: detailAcc.isActive ? P : "#9A948F" }]}>{detailAcc.name[0]}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={m.modalName}>{detailAcc.name}</Text>
                  <Text style={m.modalEmail}>{detailAcc.email}</Text>
                </View>
              </View>

              <View style={m.detailGrid}>
                {([
                  ["권한 등급",   ROLE_LABELS[detailAcc.role] ?? detailAcc.role,                                  undefined],
                  ["2차 인증",    detailAcc.twoFactorEnabled ? "활성" : "비활성",                                  detailAcc.twoFactorEnabled ? GREEN : DANGER],
                  ["계정 상태",   detailAcc.isActive ? "활성" : "비활성",                                          detailAcc.isActive ? GREEN : "#6F6B68"],
                  ["로그인 실패", `${detailAcc.loginFailCount}회`,                                                  detailAcc.loginFailCount > 0 ? DANGER : undefined],
                  ["마지막 로그인", relTime(detailAcc.lastLoginAt),                                                 undefined],
                  ["마지막 IP",   detailAcc.lastLoginIp ?? "—",                                                    undefined],
                ] as [string, string, string | undefined][]).map(([k, v, color]) => (
                  <View key={k} style={m.detailItem}>
                    <Text style={m.detailKey}>{k}</Text>
                    <Text style={[m.detailVal, color ? { color } : {}]}>{v}</Text>
                  </View>
                ))}
              </View>

              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {isAccountLocked(detailAcc) ? (
                  <Pressable style={[m.actBtn, { backgroundColor: "#DDF2EF" }]} onPress={() => doUnlock(detailAcc.id)}>
                    <Feather name="unlock" size={14} color={GREEN} />
                    <Text style={[m.actBtnTxt, { color: GREEN }]}>잠금 해제</Text>
                  </Pressable>
                ) : (
                  <Pressable style={[m.actBtn, { backgroundColor: "#F9DEDA" }]} onPress={() => doLock(detailAcc.id)}>
                    <Feather name="lock" size={14} color={DANGER} />
                    <Text style={[m.actBtnTxt, { color: DANGER }]}>잠금 ({lockMinutes}분)</Text>
                  </Pressable>
                )}
                {detailAcc.loginFailCount > 0 && (
                  <Pressable style={[m.actBtn, { backgroundColor: "#DDF2EF" }]} onPress={() => doResetFail(detailAcc.id)}>
                    <Feather name="refresh-cw" size={14} color="#1F8F86" />
                    <Text style={[m.actBtnTxt, { color: "#1F8F86" }]}>실패 초기화</Text>
                  </Pressable>
                )}
              </View>

              <Pressable style={m.closeBtn} onPress={() => setAccountDetail(null)}>
                <Text style={m.closeTxt}>닫기</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* ══ 비밀번호 변경 모달 ══ */}
      <Modal visible={pwModal} animationType="slide" transparent statusBarTranslucent
        onRequestClose={() => { setPwModal(false); setPwError(""); }}>
        <Pressable style={m.backdrop} onPress={() => { setPwModal(false); setPwError(""); }}>
          <Pressable style={m.sheet} onPress={() => {}}>
            <View style={m.handle} />
            <Text style={m.modalTitle}>비밀번호 변경</Text>
            {pwSuccess ? (
              <View style={{ alignItems: "center", gap: 8, paddingVertical: 20 }}>
                <Feather name="check-circle" size={36} color={GREEN} />
                <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: GREEN }}>변경 완료!</Text>
              </View>
            ) : (
              <>
                <TextInput style={m.input} value={currentPw} onChangeText={setCurrentPw}
                  placeholder="현재 비밀번호" placeholderTextColor="#9A948F" secureTextEntry />
                <TextInput style={m.input} value={newPw} onChangeText={setNewPw}
                  placeholder="새 비밀번호 (8자 이상)" placeholderTextColor="#9A948F" secureTextEntry />
                <TextInput style={m.input} value={confirmPw} onChangeText={setConfirmPw}
                  placeholder="새 비밀번호 확인" placeholderTextColor="#9A948F" secureTextEntry />
                {pwError ? <Text style={{ fontSize: 12, color: DANGER, fontFamily: "Inter_400Regular" }}>{pwError}</Text> : null}
                <View style={{ backgroundColor: "#F6F3F1", borderRadius: 8, padding: 10 }}>
                  <Text style={{ fontSize: 11, color: "#6F6B68", fontFamily: "Inter_400Regular" }}>정책: 8자 이상 · 영문+숫자+특수문자 포함</Text>
                </View>
                <View style={m.btnRow}>
                  <Pressable style={m.cancelBtn} onPress={() => { setPwModal(false); setPwError(""); }}>
                    <Text style={m.cancelTxt}>취소</Text>
                  </Pressable>
                  <Pressable style={[m.confirmBtn, { opacity: currentPw && newPw && confirmPw ? 1 : 0.4 }]}
                    disabled={!currentPw || !newPw || !confirmPw} onPress={handlePwChange}>
                    <Text style={m.confirmTxt}>변경</Text>
                  </Pressable>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ══ ID 변경 모달 ══ */}
      <Modal visible={idModal} animationType="slide" transparent statusBarTranslucent
        onRequestClose={() => setIdModal(false)}>
        <Pressable style={m.backdrop} onPress={() => setIdModal(false)}>
          <Pressable style={m.sheet} onPress={() => {}}>
            <Text style={m.sheetTitle}>관리자 ID 변경</Text>
            <Text style={m.sheetSub}>현재 ID: {currentId}</Text>
            {idSuccess ? (
              <View style={{ alignItems: "center", paddingVertical: 20 }}>
                <Feather name="check-circle" size={40} color="#16A34A" />
                <Text style={{ marginTop: 10, fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#16A34A" }}>ID가 변경되었습니다</Text>
              </View>
            ) : (
              <>
                <Text style={m.fieldLabel}>새 ID (이메일)</Text>
                <TextInput style={m.input} value={newId} onChangeText={setNewId}
                  placeholder="new@swimnote.kr" keyboardType="email-address" autoCapitalize="none" />
                <Text style={m.fieldLabel}>현재 비밀번호 확인</Text>
                <TextInput style={m.input} value={idVerifyPw} onChangeText={setIdVerifyPw}
                  placeholder="비밀번호를 입력하세요" secureTextEntry />
                {!!idError && <Text style={m.errTxt}>{idError}</Text>}
                <Pressable style={m.confirmBtn} onPress={handleIdChange}>
                  <Text style={m.confirmTxt}>ID 변경 확인</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ══ OTP 재등록 모달 ══ */}
      <Modal visible={otpReenrollModal} animationType="fade" transparent statusBarTranslucent
        onRequestClose={() => setOtpReenrollModal(false)}>
        <Pressable style={m.backdrop} onPress={() => setOtpReenrollModal(false)}>
          <Pressable style={m.sheet} onPress={() => {}}>
            <View style={m.handle} />
            <Text style={m.modalTitle}>OTP 재등록</Text>
            <Text style={{ fontSize: 13, color: "#6F6B68", fontFamily: "Inter_400Regular" }}>
              새 QR 코드를 생성하면 기존 OTP 앱과의 연결이 끊깁니다. 새 코드로 재등록 후 사용 가능합니다.
            </Text>
            {/* Mock QR Placeholder */}
            <View style={{ alignItems: "center", gap: 8 }}>
              <View style={{ width: 140, height: 140, backgroundColor: "#F6F3F1", borderRadius: 14,
                             alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#E9E2DD" }}>
                <Feather name="grid" size={80} color="#D1D5DB" />
              </View>
              <View style={{ backgroundColor: "#FBF8F6", borderRadius: 8, padding: 10, width: "100%", alignItems: "center" }}>
                <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: "#6F6B68" }}>비밀 키 (수동 입력용)</Text>
                <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: "#1F1F1F", letterSpacing: 2, marginTop: 4 }}>
                  JBSW Y3DP EHPK 3PXP
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FFF1BF", padding: 10, borderRadius: 8 }}>
              <Feather name="alert-triangle" size={14} color={WARN} />
              <Text style={{ flex: 1, fontSize: 12, color: "#92400E", fontFamily: "Inter_400Regular" }}>Google Authenticator 또는 Authy 앱으로 QR을 스캔하세요.</Text>
            </View>
            <View style={m.btnRow}>
              <Pressable style={m.cancelBtn} onPress={() => setOtpReenrollModal(false)}>
                <Text style={m.cancelTxt}>취소</Text>
              </Pressable>
              <Pressable style={m.confirmBtn} onPress={() => {
                createLog({ category: "보안", title: "OTP 재등록 완료", detail: "QR 코드 갱신 후 OTP 재등록", actorName, impact: "high" });
                setOtpReenrollModal(false);
              }}>
                <Text style={m.confirmTxt}>등록 완료</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ══ 2차 인증 변경 확인 모달 ══ */}
      {/* ── 슈퍼매니저 추가 모달 ── */}
      <Modal visible={smAddModal} animationType="slide" transparent statusBarTranslucent
        onRequestClose={() => { setSmAddModal(false); setSmError(""); }}>
        <Pressable style={m.backdrop} onPress={() => { setSmAddModal(false); setSmError(""); }}>
          <Pressable style={m.sheet} onPress={e => e.stopPropagation()}>
            <Text style={m.sheetTitle}>슈퍼매니저 계정 추가</Text>
            <View style={m.infoBox}>
              <Feather name="eye" size={13} color="#0284C7" />
              <Text style={m.infoTxt}>읽기 전용 계정입니다. 회원가입으로 직접 가입 불가 — 이 화면에서만 등록됩니다.</Text>
            </View>
            {smSuccess ? (
              <View style={m.successRow}>
                <Feather name="check-circle" size={18} color={GREEN} />
                <Text style={m.successTxt}>슈퍼매니저 계정이 추가되었습니다.</Text>
              </View>
            ) : (
              <>
                <TextInput style={m.input} placeholder="이름" value={smName} onChangeText={setSmName} placeholderTextColor="#9A948F" />
                <TextInput style={m.input} placeholder="이메일 (로그인 ID)" value={smEmail} onChangeText={setSmEmail} keyboardType="email-address" autoCapitalize="none" placeholderTextColor="#9A948F" />
                <TextInput style={m.input} placeholder="초기 비밀번호 (8자 이상)" value={smPw} onChangeText={setSmPw} secureTextEntry placeholderTextColor="#9A948F" />
                {!!smError && <Text style={m.errorTxt}>{smError}</Text>}
                <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                  <Pressable style={m.cancelBtn} onPress={() => { setSmAddModal(false); setSmError(""); setSmName(""); setSmEmail(""); setSmPw(""); }}>
                    <Text style={m.cancelTxt}>취소</Text>
                  </Pressable>
                  <Pressable style={[m.confirmBtn, { backgroundColor: "#0284C7" }]} onPress={() => setOtpAction("sm_add")}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                      <Feather name="lock" size={12} color="#fff" />
                      <Text style={m.confirmTxt}>OTP 인증 후 추가</Text>
                    </View>
                  </Pressable>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── 슈퍼매니저 삭제 확인 모달 ── */}
      <Modal visible={!!smDeleteId} animationType="fade" transparent statusBarTranslucent
        onRequestClose={() => setSmDeleteId(null)}>
        <Pressable style={m.backdrop} onPress={() => setSmDeleteId(null)}>
          <Pressable style={m.sheet} onPress={e => e.stopPropagation()}>
            <Text style={m.sheetTitle}>슈퍼매니저 삭제</Text>
            <Text style={{ fontSize: 14, fontFamily: "Inter_400Regular", color: "#1F1F1F", marginBottom: 4 }}>
              <Text style={{ fontFamily: "Inter_700Bold" }}>{smDeleteTarget?.name}</Text> 계정을 삭제하시겠습니까?
            </Text>
            <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: "#6F6B68", marginBottom: 16 }}>
              {smDeleteTarget?.email} · 삭제 후 복구 불가
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable style={m.cancelBtn} onPress={() => setSmDeleteId(null)}>
                <Text style={m.cancelTxt}>취소</Text>
              </Pressable>
              <Pressable style={[m.confirmBtn, { backgroundColor: DANGER }]} onPress={() => setOtpAction("sm_delete")}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <Feather name="lock" size={12} color="#fff" />
                  <Text style={m.confirmTxt}>OTP 인증 후 삭제</Text>
                </View>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── OTP 인증 게이트 ── */}
      <OtpGateModal
        visible={otpAction !== null}
        title={
          otpAction === "pw"        ? "비밀번호 변경 OTP 인증"
          : otpAction === "id"      ? "관리자 ID 변경 OTP 인증"
          : otpAction === "sm_add"  ? "슈퍼매니저 추가 OTP 인증"
          :                           "슈퍼매니저 삭제 OTP 인증"
        }
        desc={
          otpAction === "sm_add" || otpAction === "sm_delete"
            ? "슈퍼매니저 계정 변경은 OTP 인증이 필요합니다."
            : "슈퍼관리자 개인정보 변경은 OTP 인증이 필요합니다."
        }
        onSuccess={() => {
          const act = otpAction;
          setOtpAction(null);
          if (act === "pw")         executePwChange();
          else if (act === "id")    executeIdChange();
          else if (act === "sm_add")    handleAddSuperManager();
          else if (act === "sm_delete") handleDeleteSuperManager();
        }}
        onCancel={() => setOtpAction(null)}
      />

      <Modal visible={twoFAModal} animationType="fade" transparent statusBarTranslucent
        onRequestClose={() => { setTwoFAModal(false); setPendingMode(null); }}>
        <Pressable style={m.backdrop} onPress={() => { setTwoFAModal(false); setPendingMode(null); }}>
          <Pressable style={m.sheet} onPress={() => {}}>
            <View style={m.handle} />
            <Text style={m.modalTitle}>2차 인증 방식 변경</Text>
            <Text style={{ fontSize: 13, color: "#6F6B68", fontFamily: "Inter_400Regular" }}>
              {TWO_FA_OPTIONS.find(o => o.key === twoFAMode)?.label}
              {" → "}
              {TWO_FA_OPTIONS.find(o => o.key === pendingMode)?.label}
            </Text>
            {pendingMode === "disabled" && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#F9DEDA", padding: 10, borderRadius: 8 }}>
                <Feather name="alert-triangle" size={14} color={DANGER} />
                <Text style={{ flex: 1, fontSize: 12, color: DANGER, fontFamily: "Inter_400Regular" }}>2차 인증 비활성화는 보안 위험을 높입니다.</Text>
              </View>
            )}
            <View style={m.btnRow}>
              <Pressable style={m.cancelBtn} onPress={() => { setTwoFAModal(false); setPendingMode(null); }}>
                <Text style={m.cancelTxt}>취소</Text>
              </Pressable>
              <Pressable style={[m.confirmBtn, pendingMode === "disabled" && { backgroundColor: DANGER }]}
                onPress={confirmTwoFA}>
                <Text style={m.confirmTxt}>변경 확인</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ══ 외부 서비스 상세 모달 ══ */}
      <Modal
        visible={!!selectedService}
        animationType="slide"
        transparent
        statusBarTranslucent
        onRequestClose={() => setSelectedService(null)}
      >
        <View style={m.backdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setSelectedService(null)} />
          {selectedService && (() => {
            const sv  = selectedService;
            const cfg = STATUS_CFG[sv.status];
            const catCfg = CATEGORY_CFG[sv.category];
            return (
              <View style={m.svcSheet}>
                <View style={m.handle} />

                {/* 상단 헤더 */}
                <View style={m.svcHeader}>
                  <View style={[m.svcIconBig, { backgroundColor: cfg.bg }]}>
                    <Feather name={sv.icon as any} size={22} color={cfg.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={m.svcName}>{sv.name}</Text>
                    <Text style={m.svcType}>{sv.serviceType} · {catCfg.label}</Text>
                  </View>
                  <Pressable onPress={() => setSelectedService(null)} hitSlop={10}>
                    <Feather name="x" size={20} color="#6F6B68" />
                  </Pressable>
                </View>

                {/* 상태 배지 + 메시지 */}
                <View style={[m.svcStatusRow, { backgroundColor: cfg.bg }]}>
                  <Feather name={cfg.icon as any} size={14} color={cfg.color} />
                  <Text style={[m.svcStatusTxt, { color: cfg.color }]}>{cfg.label}</Text>
                  <Text style={[m.svcStatusMsg, { color: cfg.color }]}>— {sv.statusMessage}</Text>
                </View>

                <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 340 }}>
                  {/* 연결 정보 */}
                  {sv.endpointUrl && (
                    <View style={m.svcDetailRow}>
                      <Text style={m.svcDetailKey}>연결 URL</Text>
                      <Text style={m.svcDetailVal} numberOfLines={2}>{sv.endpointUrl}</Text>
                    </View>
                  )}
                  {sv.projectId && (
                    <View style={m.svcDetailRow}>
                      <Text style={m.svcDetailKey}>프로젝트 / 앱 ID</Text>
                      <Text style={m.svcDetailVal}>{sv.projectId}</Text>
                    </View>
                  )}
                  {sv.bucketName && (
                    <View style={m.svcDetailRow}>
                      <Text style={m.svcDetailKey}>버킷명</Text>
                      <Text style={m.svcDetailVal}>{sv.bucketName}</Text>
                    </View>
                  )}
                  {sv.connectedAt && (
                    <View style={m.svcDetailRow}>
                      <Text style={m.svcDetailKey}>연결 등록일</Text>
                      <Text style={m.svcDetailVal}>{new Date(sv.connectedAt).toLocaleDateString("ko-KR")}</Text>
                    </View>
                  )}
                  <View style={m.svcDetailRow}>
                    <Text style={m.svcDetailKey}>마지막 확인</Text>
                    <Text style={m.svcDetailVal}>
                      {sv.lastCheckedAt
                        ? `${new Date(sv.lastCheckedAt).toLocaleString("ko-KR")} (${fmtChecked(sv.lastCheckedAt)})`
                        : "확인 없음"}
                    </Text>
                  </View>
                  {sv.lastErrorAt && (
                    <View style={m.svcDetailRow}>
                      <Text style={m.svcDetailKey}>마지막 오류</Text>
                      <Text style={[m.svcDetailVal, { color: DANGER }]}>
                        {new Date(sv.lastErrorAt).toLocaleString("ko-KR")}
                      </Text>
                    </View>
                  )}
                  {sv.notes && (
                    <View style={m.svcDetailRow}>
                      <Text style={m.svcDetailKey}>사용 목적</Text>
                      <Text style={m.svcDetailVal}>{sv.notes}</Text>
                    </View>
                  )}
                  <View style={m.svcDetailRow}>
                    <Text style={m.svcDetailKey}>연결 여부</Text>
                    <Text style={[m.svcDetailVal, { color: sv.isConnected ? GREEN : "#6B7280" }]}>
                      {sv.isConnected ? "연결됨" : "미연결"}
                    </Text>
                  </View>
                  {sv.isPlaceholder && (
                    <View style={m.svcPlaceholderBanner}>
                      <Feather name="info" size={11} color="#6B7280" />
                      <Text style={m.svcPlaceholderTxt}>아직 연결 설정이 완료되지 않은 예비 항목입니다.</Text>
                    </View>
                  )}
                </ScrollView>

                {/* 하단 버튼 */}
                <View style={m.svcFooter}>
                  {!sv.isPlaceholder && (
                    <Pressable
                      style={[m.svcRefreshBtn, refreshing === sv.id && { opacity: 0.6 }]}
                      disabled={refreshing === sv.id}
                      onPress={() => {
                        refreshService(sv.id);
                        setSelectedService(s => s ? { ...s, lastCheckedAt: new Date().toISOString() } : s);
                      }}
                    >
                      <Feather name={refreshing === sv.id ? "loader" : "refresh-cw"} size={13} color="#fff" />
                      <Text style={m.svcRefreshTxt}>상태 새로고침</Text>
                    </Pressable>
                  )}
                  <Pressable style={m.svcCloseBtn} onPress={() => setSelectedService(null)}>
                    <Text style={m.svcCloseTxt}>닫기</Text>
                  </Pressable>
                </View>
              </View>
            );
          })()}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── StyleSheet ──────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: "#EEDDF5" },
  section:          { backgroundColor: "#fff", borderRadius: 16, padding: 16, gap: 10,
                      borderWidth: 1, borderColor: "#E9E2DD" },
  emptyTxt:         { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9A948F", textAlign: "center", paddingVertical: 12 },

  infoRow:          { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6,
                      borderBottomWidth: 1, borderBottomColor: "#F6F3F1" },
  infoLabel:        { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#1F1F1F" },
  infoValue:        { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6F6B68" },
  actionBtn:        { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12,
                      paddingHorizontal: 14, borderRadius: 12, backgroundColor: "#EEDDF5",
                      borderWidth: 1, borderColor: "#DDD6FE" },
  actionBtnTxt:     { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", color: P },

  accountCardWrap:  { borderBottomWidth: 1, borderBottomColor: "#F6F3F1" },
  accountCard:      { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  accountAvatar:    { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  accountAvatarTxt: { fontSize: 16, fontFamily: "Inter_700Bold" },
  accountNameRow:   { flexDirection: "row", alignItems: "center", gap: 6 },
  accountName:      { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#1F1F1F" },
  accountEmail:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6F6B68", marginTop: 2 },
  accountMetaRow:   { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap" },
  roleBadge:        { backgroundColor: "#EEDDF5", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  roleTxt:          { fontSize: 10, fontFamily: "Inter_700Bold", color: P },
  twoFaBadgeOn:     { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#DDF2EF",
                      borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 },
  twoFaTxtOn:       { fontSize: 9, fontFamily: "Inter_700Bold", color: GREEN },
  twoFaBadgeOff:    { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#F6F3F1",
                      borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 },
  twoFaTxtOff:      { fontSize: 9, fontFamily: "Inter_400Regular", color: "#9A948F" },
  failBadge:        { backgroundColor: "#F9DEDA", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  failTxt:          { fontSize: 9, fontFamily: "Inter_700Bold", color: DANGER },
  lockedBadge:      { backgroundColor: "#F9DEDA", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  lockedTxt:        { fontSize: 10, fontFamily: "Inter_700Bold", color: DANGER },
  inactiveBadge:    { backgroundColor: "#F6F3F1", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  inactiveTxt:      { fontSize: 10, fontFamily: "Inter_700Bold", color: "#9A948F" },

  smDeleteBtn:      { width: 30, height: 30, borderRadius: 8, backgroundColor: "#FEF2F2",
                      alignItems: "center", justifyContent: "center" },
  smAddBtn:         { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10,
                      paddingVertical: 11, paddingHorizontal: 14, borderRadius: 10,
                      backgroundColor: "#EFF6FF", borderWidth: 1, borderColor: "#BFDBFE", borderStyle: "dashed" },
  smAddBtnTxt:      { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#0284C7" },
  smInfoBox:        { flexDirection: "row", gap: 6, backgroundColor: "#EFF6FF", borderRadius: 8,
                      padding: 10, marginTop: 8, alignItems: "flex-start" },
  smInfoTxt:        { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", color: "#0284C7", lineHeight: 16 },

  currentTwoFa:     { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8,
                      borderBottomWidth: 1, borderBottomColor: "#F6F3F1" },
  currentTwoFaLabel:{ flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#1F1F1F" },
  currentTwoFaTxt:  { fontSize: 13, fontFamily: "Inter_700Bold" },
  twoFaOption:      { flexDirection: "row", alignItems: "center", gap: 12, padding: 12,
                      borderRadius: 10, borderWidth: 1, borderColor: "#E9E2DD" },
  twoFaOptionActive:{ borderColor: P, backgroundColor: "#EEDDF5" },
  twoFaRadio:       { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: "#D1D5DB",
                      alignItems: "center", justifyContent: "center" },
  twoFaRadioActive: { borderColor: P },
  twoFaRadioDot:    { width: 8, height: 8, borderRadius: 4, backgroundColor: P },
  twoFaOptLabel:    { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#1F1F1F" },
  twoFaOptDesc:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9A948F", marginTop: 2 },
  triggerSection:   { borderTopWidth: 1, borderTopColor: "#F6F3F1", paddingTop: 10, gap: 8 },
  triggerHeader:    { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#6F6B68" },
  triggerRow:       { flexDirection: "row", alignItems: "center", gap: 10 },
  triggerLabel:     { fontSize: 13, fontFamily: "Inter_500Medium", color: "#1F1F1F" },

  // ── 외부 서비스 ──
  refreshAllBtn:    { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10,
                      paddingVertical: 6, borderRadius: 8, backgroundColor: "#EEDDF5" },
  refreshAllTxt:    { fontSize: 11, fontFamily: "Inter_600SemiBold", color: P },
  catHeader:        { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  catIconBox:       { width: 20, height: 20, borderRadius: 5, alignItems: "center", justifyContent: "center" },
  catLabel:         { fontSize: 11, fontFamily: "Inter_700Bold" },
  catLine:          { flex: 1, height: 1, backgroundColor: "#E9E2DD", marginLeft: 4 },
  serviceCard:      { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10,
                      paddingHorizontal: 10, borderRadius: 12, backgroundColor: "#FAFAFA",
                      borderWidth: 1, borderColor: "#E9E2DD" },
  serviceIconBox:   { width: 34, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  serviceName:      { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#1F1F1F" },
  statusBadge:      { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 6,
                      paddingHorizontal: 6, paddingVertical: 2 },
  statusTxt:        { fontSize: 10, fontFamily: "Inter_700Bold" },
  serviceMsg:       { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6F6B68", marginTop: 1 },
  serviceLastChecked:{ fontSize: 10, fontFamily: "Inter_400Regular", color: "#9A948F", marginTop: 1 },
  placeholderTag:   { backgroundColor: "#F3F4F6", borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 },
  placeholderTagTxt:{ fontSize: 9, fontFamily: "Inter_600SemiBold", color: "#6B7280" },
  refreshBtn:       { width: 28, height: 28, borderRadius: 7, backgroundColor: "#EEDDF5",
                      alignItems: "center", justifyContent: "center" },
  serviceRow:       { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10,
                      borderBottomWidth: 1, borderBottomColor: "#F6F3F1" },
  serviceNote:      { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2 },

  sessionRow:       { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10,
                      borderBottomWidth: 1, borderBottomColor: "#F6F3F1" },
  sessionIconBox:   { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  sessionDevice:    { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#1F1F1F" },
  sessionOwner:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6F6B68",
                      backgroundColor: "#F6F3F1", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  sessionMeta:      { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6F6B68", marginTop: 2 },
  sessionTime:      { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9A948F", marginTop: 1 },
  terminateBtn:     { backgroundColor: "#F9DEDA", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  terminateTxt:     { fontSize: 11, fontFamily: "Inter_600SemiBold", color: DANGER },

  policyRow:        { flexDirection: "row", alignItems: "center", paddingVertical: 8,
                      borderBottomWidth: 1, borderBottomColor: "#F6F3F1" },
  policyLabel:      { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#1F1F1F" },
  policyBtn:        { width: 30, height: 30, borderRadius: 8, backgroundColor: "#F6F3F1",
                      alignItems: "center", justifyContent: "center" },
  policyBtnTxt:     { fontSize: 18, fontFamily: "Inter_700Bold", color: "#1F1F1F", lineHeight: 22 },
  policyVal:        { fontSize: 14, fontFamily: "Inter_700Bold", color: "#1F1F1F", minWidth: 32, textAlign: "center" },
  policyChip:       { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: "#F6F3F1" },
  policyChipActive: { backgroundColor: P },
  policyChipTxt:    { fontSize: 12, fontFamily: "Inter_500Medium", color: "#6F6B68" },
  policyChipTxtActive:{ color: "#fff" },

  forceRow:           { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10,
                        borderBottomWidth: 1, borderBottomColor: "#F6F3F1" },
  forceLabel:         { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#1F1F1F" },
  forceSub:           { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9A948F", marginTop: 2 },
  forceBadge:         { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1.5 },
  forceBadgeOn:       { borderColor: GREEN, backgroundColor: "#DDF2EF" },
  forceBadgeOff:      { borderColor: DANGER, backgroundColor: "#F9DEDA" },
  forceBadgeTxt:      { fontSize: 12, fontFamily: "Inter_700Bold" },

  recoveryCodesBox:   { backgroundColor: "#FBF8F6", borderRadius: 12, padding: 14, gap: 10,
                        borderWidth: 1, borderColor: "#E9E2DD" },
  recoveryCodesTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#1F1F1F" },
  recoveryCodesGrid:  { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  recoveryCodeItem:   { backgroundColor: "#fff", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
                        borderWidth: 1, borderColor: "#E9E2DD" },
  recoveryCode:       { fontSize: 13, fontFamily: "Inter_700Bold", color: "#1F1F1F", letterSpacing: 1 },
  recoveryCodesHint:  { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9A948F" },
  regenBtn:           { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8 },
  regenTxt:           { fontSize: 12, fontFamily: "Inter_600SemiBold", color: DANGER },

  failLogSection:     { borderTopWidth: 1, borderTopColor: "#F6F3F1", paddingTop: 10, gap: 8 },
  failLogTitle:       { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#6F6B68" },
  failLogRow:         { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6,
                        borderRadius: 8, backgroundColor: "#FFF5F5", paddingHorizontal: 10 },
  failLogDevice:      { fontSize: 12, fontFamily: "Inter_500Medium", color: "#1F1F1F" },
  failLogMeta:        { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9A948F", marginTop: 1 },
  failLogBadge:       { backgroundColor: "#F9DEDA", borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 },
  failLogBadgeTxt:    { fontSize: 10, fontFamily: "Inter_700Bold", color: DANGER },
});

const m = StyleSheet.create({
  backdrop:   { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:      { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
                borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, gap: 14 },
  handle:     { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  avatar:     { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  avatarTxt:  { fontSize: 22, fontFamily: "Inter_700Bold" },
  modalName:  { fontSize: 17, fontFamily: "Inter_700Bold", color: "#1F1F1F" },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#1F1F1F" },
  modalEmail: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6F6B68", marginTop: 2 },
  detailGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  detailItem: { width: "47%", backgroundColor: "#FBF8F6", borderRadius: 10, padding: 10,
                borderWidth: 1, borderColor: "#E9E2DD" },
  detailKey:  { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9A948F" },
  detailVal:  { fontSize: 14, fontFamily: "Inter_700Bold", color: "#1F1F1F", marginTop: 3 },
  actBtn:     { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14,
                paddingVertical: 10, borderRadius: 10 },
  actBtnTxt:  { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  closeBtn:   { backgroundColor: "#F6F3F1", borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  closeTxt:   { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#1F1F1F" },
  input:      { borderWidth: 1.5, borderColor: "#E9E2DD", borderRadius: 10, padding: 12,
                fontSize: 14, fontFamily: "Inter_400Regular", color: "#1F1F1F" },
  btnRow:     { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  cancelBtn:  { flex: 1, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: "#F6F3F1", alignItems: "center" },
  cancelTxt:  { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#1F1F1F" },
  confirmBtn: { flex: 1, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: P, alignItems: "center" },
  confirmTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  sheetTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#1F1F1F" },
  infoBox:    { flexDirection: "row", gap: 6, backgroundColor: "#EFF6FF", borderRadius: 8, padding: 10, alignItems: "flex-start" },
  infoTxt:    { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#0284C7", lineHeight: 17 },
  successRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12 },
  successTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#1F8F86" },
  errorTxt:   { fontSize: 12, fontFamily: "Inter_400Regular", color: DANGER },

  // ── 외부 서비스 상세 모달 ──
  svcSheet:          { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24,
                       padding: 20, paddingBottom: 36, maxHeight: "80%" },
  svcHeader:         { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  svcIconBig:        { width: 46, height: 46, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  svcName:           { fontSize: 16, fontFamily: "Inter_700Bold", color: "#1F1F1F" },
  svcType:           { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6F6B68", marginTop: 2 },
  svcStatusRow:      { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 10,
                       padding: 10, marginBottom: 14, flexWrap: "wrap" },
  svcStatusTxt:      { fontSize: 13, fontFamily: "Inter_700Bold" },
  svcStatusMsg:      { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  svcDetailRow:      { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#F6F3F1", gap: 3 },
  svcDetailKey:      { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9A948F" },
  svcDetailVal:      { fontSize: 13, fontFamily: "Inter_500Medium", color: "#1F1F1F" },
  svcPlaceholderBanner: { flexDirection: "row", alignItems: "flex-start", gap: 6, backgroundColor: "#F3F4F6",
                          borderRadius: 8, padding: 10, marginTop: 10 },
  svcPlaceholderTxt:    { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280", flex: 1 },
  svcFooter:         { flexDirection: "row", gap: 8, marginTop: 16 },
  svcRefreshBtn:     { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
                       gap: 6, paddingVertical: 12, borderRadius: 10, backgroundColor: P },
  svcRefreshTxt:     { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
  svcCloseBtn:       { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: "#F6F3F1", alignItems: "center" },
  svcCloseTxt:       { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#1F1F1F" },
});
