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
import { useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useSecurityStore } from "@/store/securityStore";
import { useAuditLogStore } from "@/store/auditLogStore";
import type { SuperAdminAccount, SuperAdminRole, SuperAdminSession } from "@/domain/types";

const P = "#7C3AED";
const DANGER = "#DC2626";
const WARN = "#D97706";
const GREEN = "#059669";

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
  { key: "sensitive_only", label: "킬스위치·삭제·권한변경 시만 추가 인증" },
];

// ─── 외부 서비스 시드 ────────────────────────────────────────────────────────
type ServiceStatus = "connected" | "warning" | "disconnected";
interface ExtService {
  id: string; name: string; icon: string;
  status: ServiceStatus; lastChecked: string; note?: string;
}
const INITIAL_SERVICES: ExtService[] = [
  { id: "supabase",  name: "Supabase DB",      icon: "database",      status: "connected",    lastChecked: "5분 전" },
  { id: "r2",        name: "Cloudflare R2",    icon: "cloud",         status: "connected",    lastChecked: "12분 전" },
  { id: "portone",   name: "PortOne PG",       icon: "credit-card",   status: "warning",      lastChecked: "1시간 전", note: "인증 토큰 만료 임박" },
  { id: "sms",       name: "SMS Provider",     icon: "message-square",status: "connected",    lastChecked: "3분 전" },
  { id: "apns",      name: "APNs",             icon: "bell",          status: "connected",    lastChecked: "8분 전" },
  { id: "email",     name: "Email Provider",   icon: "mail",          status: "disconnected", lastChecked: "3시간 전", note: "SMTP 연결 실패" },
];
const STATUS_CFG: Record<ServiceStatus, { label: string; color: string; bg: string }> = {
  connected:    { label: "정상",  color: GREEN,  bg: "#D1FAE5" },
  warning:      { label: "경고",  color: WARN,   bg: "#FEF3C7" },
  disconnected: { label: "끊김",  color: DANGER, bg: "#FEE2E2" },
};

const ROLE_LABELS: Record<string, string> = {
  super_admin:     "슈퍼관리자",
  senior_admin:    "시니어관리자",
  admin:           "관리자",
  viewer:          "뷰어",
  support:         "지원팀",
  read_only_admin: "읽기전용",
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
  title: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#111827" },
  sub:   { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
});

// ─── 메인 ─────────────────────────────────────────────────────────────────────
export default function SecuritySettingsScreen() {
  const { adminUser } = useAuth();
  const actorName = adminUser?.name ?? "슈퍼관리자";
  const createLog = useAuditLogStore(s => s.createLog);

  const accounts       = useSecurityStore(s => s.accounts);
  const terminateSess  = useSecurityStore(s => s.terminateSession);
  const lockAcc        = useSecurityStore(s => s.lockAccount);
  const unlockAcc      = useSecurityStore(s => s.unlockAccount);
  const resetFail      = useSecurityStore(s => s.resetFailCount);

  // 모든 활성 세션 (계정에서 flatten)
  type FlatSession = SuperAdminSession & { accountId: string; accountName: string };
  const allSessions = useMemo<FlatSession[]>(() =>
    accounts.flatMap(acc =>
      acc.sessions
        .filter(s => s.isActive)
        .map(s => ({ ...s, accountId: acc.id, accountName: acc.name }))
    )
  , [accounts]);

  // ── B. 비밀번호 ──
  const [pwModal,      setPwModal]      = useState(false);
  const [currentPw,    setCurrentPw]    = useState("");
  const [newPw,        setNewPw]        = useState("");
  const [confirmPw,    setConfirmPw]    = useState("");
  const [pwError,      setPwError]      = useState("");
  const [pwSuccess,    setPwSuccess]    = useState(false);
  const [lastPwChange, setLastPwChange] = useState("2026년 1월 15일");

  // ── C. 2차 인증 ──
  const [twoFAMode,     setTwoFAMode]     = useState<TwoFAMode>("otp");
  const [sensitiveTrig, setSensitiveTrig] = useState<SensitiveTrigger>("sensitive_only");
  const [twoFAModal,    setTwoFAModal]    = useState(false);
  const [pendingMode,   setPendingMode]   = useState<TwoFAMode | null>(null);
  const [forceEnabled,  setForceEnabled]  = useState(true);
  const [showRecoveryCodes, setShowRecoveryCodes] = useState(false);
  const [otpReenrollModal,  setOtpReenrollModal]  = useState(false);

  // ── D. 외부 서비스 ──
  const [services,   setServices]   = useState<ExtService[]>(INITIAL_SERVICES);
  const [refreshing, setRefreshing] = useState<string | null>(null);

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
    setPwSuccess(true);
    setLastPwChange(new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" }));
    createLog({ category: "보안", title: "비밀번호 변경", detail: "슈퍼관리자 비밀번호 변경 완료", actorName, impact: "high" });
    setTimeout(() => { setPwModal(false); setPwSuccess(false); setCurrentPw(""); setNewPw(""); setConfirmPw(""); }, 1200);
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
    setRefreshing(id);
    setTimeout(() => {
      setServices(prev => prev.map(sv =>
        sv.id === id ? { ...sv, status: "connected", lastChecked: "방금 전", note: undefined } : sv
      ));
      setRefreshing(null);
      createLog({ category: "보안", title: `외부 서비스 연결 확인: ${id}`, detail: `${id} 연결 상태 수동 확인`, actorName, impact: "low" });
    }, 1000);
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
            return (
              <Pressable key={acc.id} style={s.accountCard} onPress={() => setAccountDetail(acc.id)}>
                <View style={[s.accountAvatar, { backgroundColor: acc.isActive ? "#EDE9FE" : "#F3F4F6" }]}>
                  <Text style={[s.accountAvatarTxt, { color: acc.isActive ? P : "#9CA3AF" }]}>{acc.name[0]}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={s.accountNameRow}>
                    <Text style={s.accountName}>{acc.name}</Text>
                    {locked && <View style={s.lockedBadge}><Text style={s.lockedTxt}>잠금</Text></View>}
                    {!acc.isActive && <View style={s.inactiveBadge}><Text style={s.inactiveTxt}>비활성</Text></View>}
                  </View>
                  <Text style={s.accountEmail}>{acc.email}</Text>
                  <View style={s.accountMetaRow}>
                    <View style={s.roleBadge}><Text style={s.roleTxt}>{ROLE_LABELS[acc.role] ?? acc.role}</Text></View>
                    {acc.twoFactorEnabled
                      ? <View style={s.twoFaBadgeOn}><Feather name="shield" size={9} color={GREEN} /><Text style={s.twoFaTxtOn}>2FA</Text></View>
                      : <View style={s.twoFaBadgeOff}><Feather name="shield-off" size={9} color="#9CA3AF" /><Text style={s.twoFaTxtOff}>2FA 없음</Text></View>}
                    {acc.loginFailCount > 0 && (
                      <View style={s.failBadge}><Text style={s.failTxt}>실패 {acc.loginFailCount}회</Text></View>
                    )}
                  </View>
                </View>
                <Feather name="chevron-right" size={14} color="#D1D5DB" />
              </Pressable>
            );
          })}
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
            <Feather name="info" size={14} color="#6B7280" />
            <Text style={s.infoLabel}>비밀번호 정책</Text>
            <Text style={s.infoValue}>8자 이상 · 영문+숫자+특수문자</Text>
          </View>
          <Pressable style={s.actionBtn} onPress={() => setPwModal(true)}>
            <Feather name="key" size={15} color={P} />
            <Text style={s.actionBtnTxt}>비밀번호 변경</Text>
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
              <Feather name="refresh-cw" size={15} color="#0891B2" />
              <Text style={[s.actionBtnTxt, { color: "#0891B2" }]}>OTP 재등록 (QR 갱신)</Text>
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
          <SectionTitle title="D. 외부 서비스 연결 상태" />
          {services.map(sv => {
            const cfg = STATUS_CFG[sv.status];
            const isRef = refreshing === sv.id;
            return (
              <View key={sv.id} style={s.serviceRow}>
                <View style={[s.serviceIconBox, { backgroundColor: cfg.bg }]}>
                  <Feather name={sv.icon as any} size={16} color={cfg.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={s.serviceName}>{sv.name}</Text>
                    <View style={[s.statusBadge, { backgroundColor: cfg.bg }]}>
                      <Text style={[s.statusTxt, { color: cfg.color }]}>{cfg.label}</Text>
                    </View>
                  </View>
                  <Text style={s.serviceLastChecked}>마지막 확인: {sv.lastChecked}</Text>
                  {sv.note && <Text style={[s.serviceNote, { color: sv.status === "disconnected" ? DANGER : WARN }]}>{sv.note}</Text>}
                </View>
                <Pressable style={s.refreshBtn} disabled={isRef} onPress={() => refreshService(sv.id)}>
                  <Feather name={isRef ? "loader" : "refresh-cw"} size={14} color={P} />
                </Pressable>
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
              <View style={[s.sessionIconBox, { backgroundColor: "#F3F4F6" }]}>
                <Feather name="monitor" size={14} color="#6B7280" />
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
                <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: "#374151" }}>{act}</Text>
              </View>
            ))}
          </View>
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
                <View style={[m.avatar, { backgroundColor: detailAcc.isActive ? "#EDE9FE" : "#F3F4F6" }]}>
                  <Text style={[m.avatarTxt, { color: detailAcc.isActive ? P : "#9CA3AF" }]}>{detailAcc.name[0]}</Text>
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
                  ["계정 상태",   detailAcc.isActive ? "활성" : "비활성",                                          detailAcc.isActive ? GREEN : "#6B7280"],
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
                  <Pressable style={[m.actBtn, { backgroundColor: "#D1FAE5" }]} onPress={() => doUnlock(detailAcc.id)}>
                    <Feather name="unlock" size={14} color={GREEN} />
                    <Text style={[m.actBtnTxt, { color: GREEN }]}>잠금 해제</Text>
                  </Pressable>
                ) : (
                  <Pressable style={[m.actBtn, { backgroundColor: "#FEE2E2" }]} onPress={() => doLock(detailAcc.id)}>
                    <Feather name="lock" size={14} color={DANGER} />
                    <Text style={[m.actBtnTxt, { color: DANGER }]}>잠금 ({lockMinutes}분)</Text>
                  </Pressable>
                )}
                {detailAcc.loginFailCount > 0 && (
                  <Pressable style={[m.actBtn, { backgroundColor: "#EEF2FF" }]} onPress={() => doResetFail(detailAcc.id)}>
                    <Feather name="refresh-cw" size={14} color="#4F46E5" />
                    <Text style={[m.actBtnTxt, { color: "#4F46E5" }]}>실패 초기화</Text>
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
                  placeholder="현재 비밀번호" placeholderTextColor="#9CA3AF" secureTextEntry />
                <TextInput style={m.input} value={newPw} onChangeText={setNewPw}
                  placeholder="새 비밀번호 (8자 이상)" placeholderTextColor="#9CA3AF" secureTextEntry />
                <TextInput style={m.input} value={confirmPw} onChangeText={setConfirmPw}
                  placeholder="새 비밀번호 확인" placeholderTextColor="#9CA3AF" secureTextEntry />
                {pwError ? <Text style={{ fontSize: 12, color: DANGER, fontFamily: "Inter_400Regular" }}>{pwError}</Text> : null}
                <View style={{ backgroundColor: "#F3F4F6", borderRadius: 8, padding: 10 }}>
                  <Text style={{ fontSize: 11, color: "#6B7280", fontFamily: "Inter_400Regular" }}>정책: 8자 이상 · 영문+숫자+특수문자 포함</Text>
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

      {/* ══ OTP 재등록 모달 ══ */}
      <Modal visible={otpReenrollModal} animationType="fade" transparent statusBarTranslucent
        onRequestClose={() => setOtpReenrollModal(false)}>
        <Pressable style={m.backdrop} onPress={() => setOtpReenrollModal(false)}>
          <Pressable style={m.sheet} onPress={() => {}}>
            <View style={m.handle} />
            <Text style={m.modalTitle}>OTP 재등록</Text>
            <Text style={{ fontSize: 13, color: "#6B7280", fontFamily: "Inter_400Regular" }}>
              새 QR 코드를 생성하면 기존 OTP 앱과의 연결이 끊깁니다. 새 코드로 재등록 후 사용 가능합니다.
            </Text>
            {/* Mock QR Placeholder */}
            <View style={{ alignItems: "center", gap: 8 }}>
              <View style={{ width: 140, height: 140, backgroundColor: "#F3F4F6", borderRadius: 14,
                             alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#E5E7EB" }}>
                <Feather name="grid" size={80} color="#D1D5DB" />
              </View>
              <View style={{ backgroundColor: "#F9FAFB", borderRadius: 8, padding: 10, width: "100%", alignItems: "center" }}>
                <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280" }}>비밀 키 (수동 입력용)</Text>
                <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: "#111827", letterSpacing: 2, marginTop: 4 }}>
                  JBSW Y3DP EHPK 3PXP
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FEF3C7", padding: 10, borderRadius: 8 }}>
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
      <Modal visible={twoFAModal} animationType="fade" transparent statusBarTranslucent
        onRequestClose={() => { setTwoFAModal(false); setPendingMode(null); }}>
        <Pressable style={m.backdrop} onPress={() => { setTwoFAModal(false); setPendingMode(null); }}>
          <Pressable style={m.sheet} onPress={() => {}}>
            <View style={m.handle} />
            <Text style={m.modalTitle}>2차 인증 방식 변경</Text>
            <Text style={{ fontSize: 13, color: "#6B7280", fontFamily: "Inter_400Regular" }}>
              {TWO_FA_OPTIONS.find(o => o.key === twoFAMode)?.label}
              {" → "}
              {TWO_FA_OPTIONS.find(o => o.key === pendingMode)?.label}
            </Text>
            {pendingMode === "disabled" && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FEE2E2", padding: 10, borderRadius: 8 }}>
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
    </SafeAreaView>
  );
}

// ─── StyleSheet ──────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: "#F5F3FF" },
  section:          { backgroundColor: "#fff", borderRadius: 16, padding: 16, gap: 10,
                      borderWidth: 1, borderColor: "#E5E7EB" },
  emptyTxt:         { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF", textAlign: "center", paddingVertical: 12 },

  infoRow:          { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6,
                      borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  infoLabel:        { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#374151" },
  infoValue:        { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280" },
  actionBtn:        { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12,
                      paddingHorizontal: 14, borderRadius: 12, backgroundColor: "#F5F3FF",
                      borderWidth: 1, borderColor: "#DDD6FE" },
  actionBtnTxt:     { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", color: P },

  accountCard:      { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10,
                      borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  accountAvatar:    { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  accountAvatarTxt: { fontSize: 16, fontFamily: "Inter_700Bold" },
  accountNameRow:   { flexDirection: "row", alignItems: "center", gap: 6 },
  accountName:      { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#111827" },
  accountEmail:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },
  accountMetaRow:   { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap" },
  roleBadge:        { backgroundColor: "#EDE9FE", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  roleTxt:          { fontSize: 10, fontFamily: "Inter_700Bold", color: P },
  twoFaBadgeOn:     { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#D1FAE5",
                      borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 },
  twoFaTxtOn:       { fontSize: 9, fontFamily: "Inter_700Bold", color: GREEN },
  twoFaBadgeOff:    { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#F3F4F6",
                      borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 },
  twoFaTxtOff:      { fontSize: 9, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  failBadge:        { backgroundColor: "#FEE2E2", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  failTxt:          { fontSize: 9, fontFamily: "Inter_700Bold", color: DANGER },
  lockedBadge:      { backgroundColor: "#FEE2E2", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  lockedTxt:        { fontSize: 10, fontFamily: "Inter_700Bold", color: DANGER },
  inactiveBadge:    { backgroundColor: "#F3F4F6", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  inactiveTxt:      { fontSize: 10, fontFamily: "Inter_700Bold", color: "#9CA3AF" },

  currentTwoFa:     { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8,
                      borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  currentTwoFaLabel:{ flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#374151" },
  currentTwoFaTxt:  { fontSize: 13, fontFamily: "Inter_700Bold" },
  twoFaOption:      { flexDirection: "row", alignItems: "center", gap: 12, padding: 12,
                      borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB" },
  twoFaOptionActive:{ borderColor: P, backgroundColor: "#F5F3FF" },
  twoFaRadio:       { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: "#D1D5DB",
                      alignItems: "center", justifyContent: "center" },
  twoFaRadioActive: { borderColor: P },
  twoFaRadioDot:    { width: 8, height: 8, borderRadius: 4, backgroundColor: P },
  twoFaOptLabel:    { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#374151" },
  twoFaOptDesc:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2 },
  triggerSection:   { borderTopWidth: 1, borderTopColor: "#F3F4F6", paddingTop: 10, gap: 8 },
  triggerHeader:    { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#6B7280" },
  triggerRow:       { flexDirection: "row", alignItems: "center", gap: 10 },
  triggerLabel:     { fontSize: 13, fontFamily: "Inter_500Medium", color: "#374151" },

  serviceRow:       { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10,
                      borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  serviceIconBox:   { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  serviceName:      { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#111827" },
  statusBadge:      { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  statusTxt:        { fontSize: 10, fontFamily: "Inter_700Bold" },
  serviceLastChecked:{ fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2 },
  serviceNote:      { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2 },
  refreshBtn:       { width: 32, height: 32, borderRadius: 8, backgroundColor: "#EDE9FE",
                      alignItems: "center", justifyContent: "center" },

  sessionRow:       { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10,
                      borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  sessionIconBox:   { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  sessionDevice:    { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#111827" },
  sessionOwner:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280",
                      backgroundColor: "#F3F4F6", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  sessionMeta:      { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },
  sessionTime:      { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 1 },
  terminateBtn:     { backgroundColor: "#FEE2E2", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  terminateTxt:     { fontSize: 11, fontFamily: "Inter_600SemiBold", color: DANGER },

  policyRow:        { flexDirection: "row", alignItems: "center", paddingVertical: 8,
                      borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  policyLabel:      { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#374151" },
  policyBtn:        { width: 30, height: 30, borderRadius: 8, backgroundColor: "#F3F4F6",
                      alignItems: "center", justifyContent: "center" },
  policyBtnTxt:     { fontSize: 18, fontFamily: "Inter_700Bold", color: "#374151", lineHeight: 22 },
  policyVal:        { fontSize: 14, fontFamily: "Inter_700Bold", color: "#111827", minWidth: 32, textAlign: "center" },
  policyChip:       { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: "#F3F4F6" },
  policyChipActive: { backgroundColor: P },
  policyChipTxt:    { fontSize: 12, fontFamily: "Inter_500Medium", color: "#6B7280" },
  policyChipTxtActive:{ color: "#fff" },

  forceRow:           { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10,
                        borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  forceLabel:         { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#111827" },
  forceSub:           { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2 },
  forceBadge:         { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1.5 },
  forceBadgeOn:       { borderColor: GREEN, backgroundColor: "#D1FAE5" },
  forceBadgeOff:      { borderColor: DANGER, backgroundColor: "#FEE2E2" },
  forceBadgeTxt:      { fontSize: 12, fontFamily: "Inter_700Bold" },

  recoveryCodesBox:   { backgroundColor: "#F9FAFB", borderRadius: 12, padding: 14, gap: 10,
                        borderWidth: 1, borderColor: "#E5E7EB" },
  recoveryCodesTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#374151" },
  recoveryCodesGrid:  { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  recoveryCodeItem:   { backgroundColor: "#fff", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
                        borderWidth: 1, borderColor: "#E5E7EB" },
  recoveryCode:       { fontSize: 13, fontFamily: "Inter_700Bold", color: "#111827", letterSpacing: 1 },
  recoveryCodesHint:  { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  regenBtn:           { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8 },
  regenTxt:           { fontSize: 12, fontFamily: "Inter_600SemiBold", color: DANGER },

  failLogSection:     { borderTopWidth: 1, borderTopColor: "#F3F4F6", paddingTop: 10, gap: 8 },
  failLogTitle:       { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#6B7280" },
  failLogRow:         { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6,
                        borderRadius: 8, backgroundColor: "#FFF5F5", paddingHorizontal: 10 },
  failLogDevice:      { fontSize: 12, fontFamily: "Inter_500Medium", color: "#374151" },
  failLogMeta:        { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 1 },
  failLogBadge:       { backgroundColor: "#FEE2E2", borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 },
  failLogBadgeTxt:    { fontSize: 10, fontFamily: "Inter_700Bold", color: DANGER },
});

const m = StyleSheet.create({
  backdrop:   { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:      { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
                borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, gap: 14 },
  handle:     { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  avatar:     { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  avatarTxt:  { fontSize: 22, fontFamily: "Inter_700Bold" },
  modalName:  { fontSize: 17, fontFamily: "Inter_700Bold", color: "#111827" },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#111827" },
  modalEmail: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },
  detailGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  detailItem: { width: "47%", backgroundColor: "#F9FAFB", borderRadius: 10, padding: 10,
                borderWidth: 1, borderColor: "#E5E7EB" },
  detailKey:  { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  detailVal:  { fontSize: 14, fontFamily: "Inter_700Bold", color: "#111827", marginTop: 3 },
  actBtn:     { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14,
                paddingVertical: 10, borderRadius: 10 },
  actBtnTxt:  { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  closeBtn:   { backgroundColor: "#F3F4F6", borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  closeTxt:   { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#374151" },
  input:      { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, padding: 12,
                fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827" },
  btnRow:     { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  cancelBtn:  { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: "#F3F4F6" },
  cancelTxt:  { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#374151" },
  confirmBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: P },
  confirmTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
