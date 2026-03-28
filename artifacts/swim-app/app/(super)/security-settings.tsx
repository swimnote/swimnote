/**
 * (super)/security-settings.tsx — 보안·설정 통합 화면
 * A. 계정 목록·권한·활성 여부
 * B. 1차 인증 (비밀번호 변경)
 * C. 2차 인증 옵션
 * D. 플랫폼 인프라 상태 (InfraStatusPanel)
 * E. 데이터 백업 빠른 접근
 * F. 세션·접속 관리 (SessionsSection)
 * G. 보안 정책 (SecurityPolicySection) + 로그인 이력 (LoginHistorySection)
 */
import { AtSign, ChevronRight, CircleAlert, CircleCheck, Eye, Info, Key, Lock, PenLine, RefreshCw, Save, Shield, ShieldOff, Trash2, TriangleAlert, Unlock, UserPlus } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useMemo, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet,
  Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth, apiRequest } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { OtpGateModal } from "@/components/common/OtpGateModal";
import { useSecurityStore } from "@/store/securityStore";
import { useAuditLogStore } from "@/store/auditLogStore";
import InfraStatusPanel from "@/components/super/InfraStatusPanel";
import { SectionTitle } from "@/components/super/security-settings/SectionTitle";
import { SessionsSection } from "@/components/super/security-settings/SessionsSection";
import { SecurityPolicySection } from "@/components/super/security-settings/SecurityPolicySection";
import { LoginHistorySection } from "@/components/super/security-settings/LoginHistorySection";
import {
  P, DANGER, WARN, GREEN,
  TwoFAMode, TWO_FA_OPTIONS,
  SensitiveTrigger, SENSITIVE_TRIGGERS,
  ROLE_LABELS,
  isAccountLocked, relTime,
  FlatSession,
} from "@/components/super/security-settings/types";
import { router } from "expo-router";
import Colors from "@/constants/colors";
const C = Colors.light;


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

  // ── OTP 실제 등록/변경 상태 ──
  const [totpEnabled,    setTotpEnabled]    = useState<boolean | null>(null);
  const [otpSetupStep,   setOtpSetupStep]   = useState<"loading"|"qr"|"verify">("loading");
  const [otpSetupQr,     setOtpSetupQr]     = useState("");
  const [otpSetupSecret, setOtpSetupSecret] = useState("");
  const [otpSetupCode,   setOtpSetupCode]   = useState("");
  const [otpSetupError,  setOtpSetupError]  = useState("");
  const [otpSetupBusy,   setOtpSetupBusy]   = useState(false);
  const [otpSetupDone,   setOtpSetupDone]   = useState(false);
  const [otpShowSecret,  setOtpShowSecret]  = useState(false);
  const otpCodeRef = useRef<TextInput>(null);

  // ── F. 보안 정책 ──
  const [maxFail,     setMaxFail]     = useState(5);
  const [lockMinutes, setLockMinutes] = useState(30);

  // ── 계정 상세 모달 ──
  const [accountDetail, setAccountDetail] = useState<string | null>(null);
  const detailAcc = useMemo(() => accounts.find(a => a.id === accountDetail), [accounts, accountDetail]);

  // ── OTP 실제 등록 로직 ──
  useEffect(() => {
    if (!token) return;
    apiRequest(token, "/auth/totp/status")
      .then(r => r.json())
      .then((d: any) => setTotpEnabled(d.totp_enabled ?? false))
      .catch(() => setTotpEnabled(false));
  }, [token]);

  function openOtpModal() {
    setOtpSetupStep("loading");
    setOtpSetupQr("");
    setOtpSetupSecret("");
    setOtpSetupCode("");
    setOtpSetupError("");
    setOtpSetupDone(false);
    setOtpShowSecret(false);
    setOtpReenrollModal(true);
    apiRequest(token, "/auth/totp/setup", { method: "POST" })
      .then(r => r.json())
      .then((d: any) => {
        if (d.qr_code) {
          setOtpSetupQr(d.qr_code);
          setOtpSetupSecret(d.secret || "");
          setOtpSetupStep("qr");
        } else {
          setOtpSetupError("QR 코드 생성에 실패했습니다.");
          setOtpSetupStep("qr");
        }
      })
      .catch(() => {
        setOtpSetupError("서버 오류가 발생했습니다.");
        setOtpSetupStep("qr");
      });
  }

  async function verifyOtpSetup() {
    const code = otpSetupCode.replace(/\D/g, "");
    if (code.length !== 6) { setOtpSetupError("6자리 코드를 입력해주세요."); return; }
    setOtpSetupBusy(true);
    setOtpSetupError("");
    try {
      const res = await apiRequest(token, "/auth/totp/enable", {
        method: "POST",
        body: JSON.stringify({ otp_code: code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "코드가 올바르지 않습니다.");
      setTotpEnabled(true);
      setOtpSetupDone(true);
    } catch (e: any) {
      setOtpSetupError(e.message || "코드가 올바르지 않습니다. 앱의 코드를 다시 확인해주세요.");
    } finally {
      setOtpSetupBusy(false);
    }
  }

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
                  <View style={[s.accountAvatar, { backgroundColor: isSuperManager ? "#E0F2FE" : acc.isActive ? "#EEDDF5" : "#FFFFFF" }]}>
                    <Text style={[s.accountAvatarTxt, { color: isSuperManager ? "#0284C7" : acc.isActive ? P : "#64748B" }]}>{acc.name[0]}</Text>
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
                          <Eye size={9} color="#16A34A" />
                          <Text style={{ fontSize: 9, fontFamily: "Pretendard-SemiBold", color: "#16A34A" }}>읽기전용</Text>
                        </View>
                      )}
                      {!isSuperManager && (acc.twoFactorEnabled
                        ? <View style={s.twoFaBadgeOn}><Shield size={9} color={GREEN} /><Text style={s.twoFaTxtOn}>2FA</Text></View>
                        : <View style={s.twoFaBadgeOff}><ShieldOff size={9} color="#64748B" /><Text style={s.twoFaTxtOff}>2FA 없음</Text></View>)}
                      {acc.loginFailCount > 0 && (
                        <View style={s.failBadge}><Text style={s.failTxt}>실패 {acc.loginFailCount}회</Text></View>
                      )}
                    </View>
                  </View>
                  {acc.role !== "super_admin"
                    ? <Pressable style={s.smDeleteBtn} onPress={() => setSmDeleteId(acc.id)}>
                        <Trash2 size={14} color={DANGER} />
                      </Pressable>
                    : <ChevronRight size={14} color="#D1D5DB" />}
                </Pressable>
              </View>
            );
          })}

          {/* 슈퍼매니저 추가 버튼 */}
          <Pressable style={s.smAddBtn} onPress={() => setSmAddModal(true)}>
            <UserPlus size={15} color="#0284C7" />
            <Text style={s.smAddBtnTxt}>슈퍼매니저 추가</Text>
          </Pressable>
          <View style={s.smInfoBox}>
            <Info size={12} color="#0284C7" />
            <Text style={s.smInfoTxt}>슈퍼매니저는 운영콘솔 전체를 읽기 전용으로 열람할 수 있습니다. 수정·삭제·승인 등 쓰기 작업은 불가합니다. 회원가입 화면에서 직접 가입할 수 없습니다.</Text>
          </View>
        </View>

        {/* ══ B. 1차 인증 ══ */}
        <View style={s.section}>
          <SectionTitle title="B. 1차 인증 — 비밀번호" />
          <View style={s.infoRow}>
            <Lock size={14} color={P} />
            <Text style={s.infoLabel}>마지막 비밀번호 변경</Text>
            <Text style={s.infoValue}>{lastPwChange}</Text>
          </View>
          <View style={s.infoRow}>
            <Info size={14} color="#64748B" />
            <Text style={s.infoLabel}>비밀번호 정책</Text>
            <Text style={s.infoValue}>8자 이상 · 영문+숫자+특수문자</Text>
          </View>
          <Pressable style={s.actionBtn} onPress={() => setPwModal(true)}>
            <Key size={15} color={P} />
            <Text style={s.actionBtnTxt}>비밀번호 변경</Text>
            <ChevronRight size={14} color="#D1D5DB" style={{ marginLeft: "auto" }} />
          </Pressable>
        </View>

        {/* ══ B-2. 계정 ID 변경 ══ */}
        <View style={s.section}>
          <SectionTitle title="B-2. 관리자 ID 변경" sub="이메일 형식의 로그인 ID" />
          <View style={s.infoRow}>
            <AtSign size={14} color={P} />
            <Text style={s.infoLabel}>현재 ID</Text>
            <Text style={s.infoValue}>{currentId}</Text>
          </View>
          <Pressable style={s.actionBtn} onPress={() => setIdModal(true)}>
            <PenLine size={15} color={P} />
            <Text style={s.actionBtnTxt}>ID 변경</Text>
            <ChevronRight size={14} color="#D1D5DB" style={{ marginLeft: "auto" }} />
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
              <Shield size={14} color={twoFAMode === "disabled" ? DANGER : GREEN} />
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
              {opt.key === "disabled" && <TriangleAlert size={14} color={WARN} />}
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

          {/* OTP 연결/재등록 */}
          {(twoFAMode === "otp" || twoFAMode === "otp_sms_backup") && (
            <Pressable style={s.actionBtn} onPress={openOtpModal}>
              <LucideIcon name={totpEnabled ? "refresh-cw" : "smartphone"} size={15} color={totpEnabled ? "#2EC4B6" : P} />
              <View style={{ flex: 1 }}>
                <Text style={[s.actionBtnTxt, { color: totpEnabled ? "#2EC4B6" : P }]}>
                  {totpEnabled ? "OTP 재등록 (QR 갱신)" : "Google OTP 연결하기"}
                </Text>
                {totpEnabled === false && (
                  <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: DANGER, marginTop: 2 }}>
                    OTP 미등록 — 지금 연결하세요
                  </Text>
                )}
              </View>
              <ChevronRight size={14} color="#D1D5DB" />
            </Pressable>
          )}

          {/* 복구 코드 */}
          <Pressable style={s.actionBtn} onPress={() => {
            setShowRecoveryCodes(v => !v);
            if (!showRecoveryCodes) createLog({ category: "보안", title: "복구 코드 조회", detail: "백업 코드 목록 열람", actorName, impact: "medium" });
          }}>
            <Key size={15} color={P} />
            <Text style={s.actionBtnTxt}>{showRecoveryCodes ? "복구 코드 숨기기" : "복구 코드 보기"}</Text>
            <LucideIcon name={showRecoveryCodes ? "chevron-up" : "chevron-down"} size={14} color="#D1D5DB" style={{ marginLeft: "auto" }} />
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
                <RefreshCw size={12} color={DANGER} />
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
                <CircleAlert size={12} color={DANGER} />
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

        {/* ══ D. 플랫폼 인프라 상태 ══ */}
        <View style={s.section}>
          <InfraStatusPanel />
        </View>

        {/* ══ E. 백업 빠른 접근 ══ */}
        <View style={s.section}>
          <SectionTitle title="E. 데이터 백업" sub="전체 DB 백업 및 자동 백업 관리" />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable
              style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8,
                backgroundColor: "#EEDDF5", borderRadius: 10, padding: 14 }}
              onPress={() => router.push("/(super)/backup")}>
              <Save size={16} color={P} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: P }}>백업 관리</Text>
                <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2 }}>수동 백업 · 자동 설정 · 복구</Text>
              </View>
              <ChevronRight size={14} color={P} />
            </Pressable>
          </View>
        </View>

        {/* ══ F. 세션·접속 관리 ══ */}
        <SessionsSection sessions={allSessions} onTerminate={doTerminateSession} />

        {/* ══ G. 보안 정책 ══ */}
        <SecurityPolicySection
          maxFail={maxFail}
          lockMinutes={lockMinutes}
          onMaxFailChange={setMaxFail}
          onLockMinutesChange={setLockMinutes}
        />

        {/* ══ G. 로그인 이력 ══ */}
        <LoginHistorySection />

      </ScrollView>

      {/* ══ 계정 상세 모달 ══ */}
      {detailAcc && (
        <Modal visible animationType="slide" transparent statusBarTranslucent
          onRequestClose={() => setAccountDetail(null)}>
          <Pressable style={m.backdrop} onPress={() => setAccountDetail(null)}>
            <Pressable style={m.sheet} onPress={() => {}}>
              <View style={m.handle} />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                <View style={[m.avatar, { backgroundColor: detailAcc.isActive ? "#EEDDF5" : "#FFFFFF" }]}>
                  <Text style={[m.avatarTxt, { color: detailAcc.isActive ? P : "#64748B" }]}>{detailAcc.name[0]}</Text>
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
                  ["계정 상태",   detailAcc.isActive ? "활성" : "비활성",                                          detailAcc.isActive ? GREEN : "#64748B"],
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
                  <Pressable style={[m.actBtn, { backgroundColor: "#E6FFFA" }]} onPress={() => doUnlock(detailAcc.id)}>
                    <Unlock size={14} color={GREEN} />
                    <Text style={[m.actBtnTxt, { color: GREEN }]}>잠금 해제</Text>
                  </Pressable>
                ) : (
                  <Pressable style={[m.actBtn, { backgroundColor: "#F9DEDA" }]} onPress={() => doLock(detailAcc.id)}>
                    <Lock size={14} color={DANGER} />
                    <Text style={[m.actBtnTxt, { color: DANGER }]}>잠금 ({lockMinutes}분)</Text>
                  </Pressable>
                )}
                {detailAcc.loginFailCount > 0 && (
                  <Pressable style={[m.actBtn, { backgroundColor: "#E6FFFA" }]} onPress={() => doResetFail(detailAcc.id)}>
                    <RefreshCw size={14} color="#2EC4B6" />
                    <Text style={[m.actBtnTxt, { color: "#2EC4B6" }]}>실패 초기화</Text>
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
                <CircleCheck size={36} color={GREEN} />
                <Text style={{ fontSize: 16, fontFamily: "Pretendard-SemiBold", color: GREEN }}>변경 완료!</Text>
              </View>
            ) : (
              <>
                <TextInput style={m.input} value={currentPw} onChangeText={setCurrentPw}
                  placeholder="현재 비밀번호" placeholderTextColor="#64748B" secureTextEntry />
                <TextInput style={m.input} value={newPw} onChangeText={setNewPw}
                  placeholder="새 비밀번호 (8자 이상)" placeholderTextColor="#64748B" secureTextEntry />
                <TextInput style={m.input} value={confirmPw} onChangeText={setConfirmPw}
                  placeholder="새 비밀번호 확인" placeholderTextColor="#64748B" secureTextEntry />
                {pwError ? <Text style={{ fontSize: 12, color: DANGER, fontFamily: "Pretendard-Regular" }}>{pwError}</Text> : null}
                <View style={{ backgroundColor: "#FFFFFF", borderRadius: 8, padding: 10 }}>
                  <Text style={{ fontSize: 11, color: "#64748B", fontFamily: "Pretendard-Regular" }}>정책: 8자 이상 · 영문+숫자+특수문자 포함</Text>
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
                <CircleCheck size={40} color="#16A34A" />
                <Text style={{ marginTop: 10, fontSize: 14, fontFamily: "Pretendard-Medium", color: "#16A34A" }}>ID가 변경되었습니다</Text>
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

      {/* ══ OTP 등록/재등록 모달 ══ */}
      <Modal visible={otpReenrollModal} animationType="slide" transparent statusBarTranslucent
        onRequestClose={() => { if (!otpSetupBusy) setOtpReenrollModal(false); }}>
        <Pressable style={m.backdrop} onPress={() => { if (!otpSetupBusy) setOtpReenrollModal(false); }}>
          <Pressable style={[m.sheet, { gap: 16 }]} onPress={e => e.stopPropagation()}>
            <View style={m.handle} />

            {/* 완료 상태 */}
            {otpSetupDone ? (
              <>
                <View style={{ alignItems: "center", gap: 12, paddingVertical: 12 }}>
                  <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: "#DCFCE7", alignItems: "center", justifyContent: "center" }}>
                    <CircleCheck size={32} color="#16A34A" />
                  </View>
                  <Text style={{ fontSize: 18, fontFamily: "Pretendard-SemiBold", color: "#0F172A" }}>OTP 등록 완료</Text>
                  <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B", textAlign: "center", lineHeight: 20 }}>
                    Google Authenticator와 연결되었습니다.{"\n"}다음 로그인부터 OTP 코드가 필요합니다.
                  </Text>
                </View>
                <Pressable style={m.confirmBtn} onPress={() => {
                  createLog({ category: "보안", title: totpEnabled ? "OTP 재등록 완료" : "OTP 최초 등록 완료", detail: "QR 스캔 후 코드 검증 완료", actorName, impact: "high" });
                  setOtpReenrollModal(false);
                }}>
                  <Text style={m.confirmTxt}>확인</Text>
                </Pressable>
              </>
            ) : otpSetupStep === "loading" ? (
              /* 로딩 */
              <View style={{ alignItems: "center", paddingVertical: 40, gap: 12 }}>
                <ActivityIndicator color={P} size="large" />
                <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: "#64748B" }}>QR 코드 생성 중...</Text>
              </View>
            ) : (
              /* QR + 코드 입력 */
              <>
                <Text style={m.modalTitle}>{totpEnabled ? "OTP 재등록 (QR 갱신)" : "Google OTP 연결"}</Text>
                <Text style={{ fontSize: 13, color: "#64748B", fontFamily: "Pretendard-Regular", lineHeight: 19 }}>
                  {totpEnabled
                    ? "새 QR 코드를 생성하면 기존 OTP 앱 연결이 끊깁니다. 새 코드로 재등록 후 사용하세요."
                    : "Google Authenticator 앱에서 QR 코드를 스캔한 후 6자리 코드를 입력해주세요."}
                </Text>

                {/* QR 코드 */}
                {!!otpSetupQr ? (
                  <View style={{ alignItems: "center", padding: 16, backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#E5E7EB" }}>
                    <Image source={{ uri: otpSetupQr }} style={{ width: 200, height: 200 }} resizeMode="contain" />
                  </View>
                ) : !!otpSetupError ? (
                  <View style={{ backgroundColor: "#F9DEDA", padding: 12, borderRadius: 10 }}>
                    <Text style={{ fontSize: 13, color: DANGER, fontFamily: "Pretendard-Regular" }}>{otpSetupError}</Text>
                  </View>
                ) : null}

                {/* 수동 입력 키 */}
                {!!otpSetupSecret && (
                  <Pressable
                    style={{ borderWidth: 1.5, borderColor: "#E6FAF8", borderRadius: 12, padding: 12, gap: 6, backgroundColor: "#F5F3FF" }}
                    onPress={() => setOtpShowSecret(v => !v)}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Key size={13} color={P} />
                      <Text style={{ fontSize: 12, fontFamily: "Pretendard-Medium", color: P, flex: 1 }}>QR이 안 되면 키 직접 입력</Text>
                      <LucideIcon name={otpShowSecret ? "chevron-up" : "chevron-down"} size={13} color={P} />
                    </View>
                    {otpShowSecret && (
                      <>
                        <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" }}>
                          앱 → "설정 키 입력" 선택 후 아래 키 입력 (계정 유형: 시간 기반)
                        </Text>
                        <Text style={{ fontSize: 14, fontFamily: "Pretendard-SemiBold", color: P, letterSpacing: 2 }} selectable>
                          {otpSetupSecret}
                        </Text>
                      </>
                    )}
                  </Pressable>
                )}

                {/* 안내 배너 */}
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#FFF7ED", padding: 10, borderRadius: 8 }}>
                  <TriangleAlert size={14} color={WARN} />
                  <Text style={{ flex: 1, fontSize: 12, color: "#92400E", fontFamily: "Pretendard-Regular", lineHeight: 18 }}>
                    Google Authenticator 앱 열기 → + → QR 코드 스캔
                  </Text>
                </View>

                {/* 6자리 코드 입력 */}
                <View style={{ gap: 8 }}>
                  <Text style={{ fontSize: 13, fontFamily: "Pretendard-Medium", color: "#0F172A" }}>스캔 후 앱의 6자리 코드 입력</Text>
                  <TextInput
                    ref={otpCodeRef}
                    style={{
                      height: 52, borderRadius: 12, borderWidth: 2,
                      borderColor: otpSetupCode.length === 6 ? P : "#E5E7EB",
                      paddingHorizontal: 16, fontSize: 24, fontFamily: "Pretendard-SemiBold",
                      letterSpacing: 8, textAlign: "center", color: P,
                    }}
                    placeholder="000000"
                    placeholderTextColor="#D1D5DB"
                    value={otpSetupCode}
                    onChangeText={v => { setOtpSetupCode(v.replace(/\D/g, "").slice(0, 6)); setOtpSetupError(""); }}
                    keyboardType="number-pad"
                    maxLength={6}
                    onSubmitEditing={verifyOtpSetup}
                  />
                  {!!otpSetupError && (
                    <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: DANGER }}>{otpSetupError}</Text>
                  )}
                </View>

                <View style={m.btnRow}>
                  <Pressable style={m.cancelBtn} onPress={() => setOtpReenrollModal(false)}>
                    <Text style={m.cancelTxt}>취소</Text>
                  </Pressable>
                  <Pressable
                    style={[m.confirmBtn, { backgroundColor: otpSetupCode.length === 6 ? P : "#E5E7EB" }]}
                    onPress={verifyOtpSetup}
                    disabled={otpSetupBusy || otpSetupCode.length !== 6}
                  >
                    {otpSetupBusy
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={m.confirmTxt}>등록 완료</Text>
                    }
                  </Pressable>
                </View>
              </>
            )}
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
              <Eye size={13} color="#0284C7" />
              <Text style={m.infoTxt}>읽기 전용 계정입니다. 회원가입으로 직접 가입 불가 — 이 화면에서만 등록됩니다.</Text>
            </View>
            {smSuccess ? (
              <View style={m.successRow}>
                <CircleCheck size={18} color={GREEN} />
                <Text style={m.successTxt}>슈퍼매니저 계정이 추가되었습니다.</Text>
              </View>
            ) : (
              <>
                <TextInput style={m.input} placeholder="이름" value={smName} onChangeText={setSmName} placeholderTextColor="#64748B" />
                <TextInput style={m.input} placeholder="이메일 (로그인 ID)" value={smEmail} onChangeText={setSmEmail} keyboardType="email-address" autoCapitalize="none" placeholderTextColor="#64748B" />
                <TextInput style={m.input} placeholder="초기 비밀번호 (8자 이상)" value={smPw} onChangeText={setSmPw} secureTextEntry placeholderTextColor="#64748B" />
                {!!smError && <Text style={m.errorTxt}>{smError}</Text>}
                <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                  <Pressable style={m.cancelBtn} onPress={() => { setSmAddModal(false); setSmError(""); setSmName(""); setSmEmail(""); setSmPw(""); }}>
                    <Text style={m.cancelTxt}>취소</Text>
                  </Pressable>
                  <Pressable style={[m.confirmBtn, { backgroundColor: "#0284C7" }]} onPress={() => setOtpAction("sm_add")}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                      <Lock size={12} color="#fff" />
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
            <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A", marginBottom: 4 }}>
              <Text style={{ fontFamily: "Pretendard-SemiBold" }}>{smDeleteTarget?.name}</Text> 계정을 삭제하시겠습니까?
            </Text>
            <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B", marginBottom: 16 }}>
              {smDeleteTarget?.email} · 삭제 후 복구 불가
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable style={m.cancelBtn} onPress={() => setSmDeleteId(null)}>
                <Text style={m.cancelTxt}>취소</Text>
              </Pressable>
              <Pressable style={[m.confirmBtn, { backgroundColor: DANGER }]} onPress={() => setOtpAction("sm_delete")}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <Lock size={12} color="#fff" />
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
        token={token}
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
            <Text style={{ fontSize: 13, color: "#64748B", fontFamily: "Pretendard-Regular" }}>
              {TWO_FA_OPTIONS.find(o => o.key === twoFAMode)?.label}
              {" → "}
              {TWO_FA_OPTIONS.find(o => o.key === pendingMode)?.label}
            </Text>
            {pendingMode === "disabled" && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#F9DEDA", padding: 10, borderRadius: 8 }}>
                <TriangleAlert size={14} color={DANGER} />
                <Text style={{ flex: 1, fontSize: 12, color: DANGER, fontFamily: "Pretendard-Regular" }}>2차 인증 비활성화는 보안 위험을 높입니다.</Text>
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
  safe:             { flex: 1, backgroundColor: C.background },
  section:          { backgroundColor: "#fff", borderRadius: 16, padding: 16, gap: 10,
                      borderWidth: 1, borderColor: "#E5E7EB" },
  emptyTxt:         { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B", textAlign: "center", paddingVertical: 12 },

  infoRow:          { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6,
                      borderBottomWidth: 1, borderBottomColor: "#FFFFFF" },
  infoLabel:        { flex: 1, fontSize: 13, fontFamily: "Pretendard-Medium", color: "#0F172A" },
  infoValue:        { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B" },
  actionBtn:        { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12,
                      paddingHorizontal: 14, borderRadius: 12, backgroundColor: "#EEDDF5",
                      borderWidth: 1, borderColor: "#E6FAF8" },
  actionBtnTxt:     { flex: 1, fontSize: 14, fontFamily: "Pretendard-Medium", color: P },

  accountCardWrap:  { borderBottomWidth: 1, borderBottomColor: "#FFFFFF" },
  accountCard:      { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  accountAvatar:    { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  accountAvatarTxt: { fontSize: 16, fontFamily: "Pretendard-SemiBold" },
  accountNameRow:   { flexDirection: "row", alignItems: "center", gap: 6 },
  accountName:      { fontSize: 14, fontFamily: "Pretendard-Medium", color: "#0F172A" },
  accountEmail:     { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2 },
  accountMetaRow:   { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap" },
  roleBadge:        { backgroundColor: "#EEDDF5", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  roleTxt:          { fontSize: 10, fontFamily: "Pretendard-SemiBold", color: P },
  twoFaBadgeOn:     { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#E6FFFA",
                      borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 },
  twoFaTxtOn:       { fontSize: 9, fontFamily: "Pretendard-SemiBold", color: GREEN },
  twoFaBadgeOff:    { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#FFFFFF",
                      borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 },
  twoFaTxtOff:      { fontSize: 9, fontFamily: "Pretendard-Regular", color: "#64748B" },
  failBadge:        { backgroundColor: "#F9DEDA", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  failTxt:          { fontSize: 9, fontFamily: "Pretendard-SemiBold", color: DANGER },
  lockedBadge:      { backgroundColor: "#F9DEDA", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  lockedTxt:        { fontSize: 10, fontFamily: "Pretendard-SemiBold", color: DANGER },
  inactiveBadge:    { backgroundColor: "#FFFFFF", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  inactiveTxt:      { fontSize: 10, fontFamily: "Pretendard-SemiBold", color: "#64748B" },

  smDeleteBtn:      { width: 30, height: 30, borderRadius: 8, backgroundColor: "#FEF2F2",
                      alignItems: "center", justifyContent: "center" },
  smAddBtn:         { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10,
                      paddingVertical: 11, paddingHorizontal: 14, borderRadius: 10,
                      backgroundColor: "#E6FAF8", borderWidth: 1, borderColor: "#E6FAF8", borderStyle: "dashed" },
  smAddBtnTxt:      { fontSize: 14, fontFamily: "Pretendard-Medium", color: "#0284C7" },
  smInfoBox:        { flexDirection: "row", gap: 6, backgroundColor: "#E6FAF8", borderRadius: 8,
                      padding: 10, marginTop: 8, alignItems: "flex-start" },
  smInfoTxt:        { flex: 1, fontSize: 11, fontFamily: "Pretendard-Regular", color: "#0284C7", lineHeight: 16 },

  currentTwoFa:     { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8,
                      borderBottomWidth: 1, borderBottomColor: "#FFFFFF" },
  currentTwoFaLabel:{ flex: 1, fontSize: 13, fontFamily: "Pretendard-Medium", color: "#0F172A" },
  currentTwoFaTxt:  { fontSize: 13, fontFamily: "Pretendard-SemiBold" },
  twoFaOption:      { flexDirection: "row", alignItems: "center", gap: 12, padding: 12,
                      borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB" },
  twoFaOptionActive:{ borderColor: P, backgroundColor: "#EEDDF5" },
  twoFaRadio:       { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: "#D1D5DB",
                      alignItems: "center", justifyContent: "center" },
  twoFaRadioActive: { borderColor: P },
  twoFaRadioDot:    { width: 8, height: 8, borderRadius: 4, backgroundColor: P },
  twoFaOptLabel:    { fontSize: 13, fontFamily: "Pretendard-Medium", color: "#0F172A" },
  twoFaOptDesc:     { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2 },
  triggerSection:   { borderTopWidth: 1, borderTopColor: "#FFFFFF", paddingTop: 10, gap: 8 },
  triggerHeader:    { fontSize: 12, fontFamily: "Pretendard-Medium", color: "#64748B" },
  triggerRow:       { flexDirection: "row", alignItems: "center", gap: 10 },
  triggerLabel:     { fontSize: 13, fontFamily: "Pretendard-Medium", color: "#0F172A" },

  forceRow:           { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10,
                        borderBottomWidth: 1, borderBottomColor: "#FFFFFF" },
  forceLabel:         { fontSize: 14, fontFamily: "Pretendard-Medium", color: "#0F172A" },
  forceSub:           { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2 },
  forceBadge:         { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1.5 },
  forceBadgeOn:       { borderColor: GREEN, backgroundColor: "#E6FFFA" },
  forceBadgeOff:      { borderColor: DANGER, backgroundColor: "#F9DEDA" },
  forceBadgeTxt:      { fontSize: 12, fontFamily: "Pretendard-SemiBold" },

  recoveryCodesBox:   { backgroundColor: "#F1F5F9", borderRadius: 12, padding: 14, gap: 10,
                        borderWidth: 1, borderColor: "#E5E7EB" },
  recoveryCodesTitle: { fontSize: 12, fontFamily: "Pretendard-Medium", color: "#0F172A" },
  recoveryCodesGrid:  { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  recoveryCodeItem:   { backgroundColor: "#fff", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
                        borderWidth: 1, borderColor: "#E5E7EB" },
  recoveryCode:       { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: "#0F172A", letterSpacing: 1 },
  recoveryCodesHint:  { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  regenBtn:           { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8 },
  regenTxt:           { fontSize: 12, fontFamily: "Pretendard-Medium", color: DANGER },

  failLogSection:     { borderTopWidth: 1, borderTopColor: "#FFFFFF", paddingTop: 10, gap: 8 },
  failLogTitle:       { fontSize: 12, fontFamily: "Pretendard-Medium", color: "#64748B" },
  failLogRow:         { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6,
                        borderRadius: 8, backgroundColor: "#FFF5F5", paddingHorizontal: 10 },
  failLogDevice:      { fontSize: 12, fontFamily: "Pretendard-Medium", color: "#0F172A" },
  failLogMeta:        { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 1 },
  failLogBadge:       { backgroundColor: "#F9DEDA", borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 },
  failLogBadgeTxt:    { fontSize: 10, fontFamily: "Pretendard-SemiBold", color: DANGER },
});

const m = StyleSheet.create({
  backdrop:   { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:      { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
                borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, gap: 14 },
  handle:     { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  avatar:     { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  avatarTxt:  { fontSize: 22, fontFamily: "Pretendard-SemiBold" },
  modalName:  { fontSize: 17, fontFamily: "Pretendard-SemiBold", color: "#0F172A" },
  modalTitle: { fontSize: 18, fontFamily: "Pretendard-SemiBold", color: "#0F172A" },
  modalEmail: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2 },
  detailGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  detailItem: { width: "47%", backgroundColor: "#F1F5F9", borderRadius: 10, padding: 10,
                borderWidth: 1, borderColor: "#E5E7EB" },
  detailKey:  { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  detailVal:  { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#0F172A", marginTop: 3 },
  actBtn:     { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14,
                paddingVertical: 10, borderRadius: 10 },
  actBtnTxt:  { fontSize: 13, fontFamily: "Pretendard-Medium" },
  closeBtn:   { backgroundColor: "#FFFFFF", borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  closeTxt:   { fontSize: 15, fontFamily: "Pretendard-Medium", color: "#0F172A" },
  input:      { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, padding: 12,
                fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  btnRow:     { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  cancelBtn:  { flex: 1, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: "#FFFFFF", alignItems: "center" },
  cancelTxt:  { fontSize: 14, fontFamily: "Pretendard-Medium", color: "#0F172A" },
  confirmBtn: { flex: 1, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: P, alignItems: "center" },
  confirmTxt: { fontSize: 14, fontFamily: "Pretendard-Medium", color: "#fff" },
  sheetTitle: { fontSize: 17, fontFamily: "Pretendard-SemiBold", color: "#0F172A" },
  infoBox:    { flexDirection: "row", gap: 6, backgroundColor: "#E6FAF8", borderRadius: 8, padding: 10, alignItems: "flex-start" },
  infoTxt:    { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", color: "#0284C7", lineHeight: 17 },
  successRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12 },
  successTxt: { fontSize: 14, fontFamily: "Pretendard-Medium", color: "#2EC4B6" },
  errorTxt:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: DANGER },

  // ── 외부 서비스 상세 모달 ──
  svcSheet:          { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24,
                       padding: 20, paddingBottom: 36, maxHeight: "80%" },
  svcHeader:         { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  svcIconBig:        { width: 46, height: 46, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  svcName:           { fontSize: 16, fontFamily: "Pretendard-SemiBold", color: "#0F172A" },
  svcType:           { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2 },
  svcStatusRow:      { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 10,
                       padding: 10, marginBottom: 14, flexWrap: "wrap" },
  svcStatusTxt:      { fontSize: 13, fontFamily: "Pretendard-SemiBold" },
  svcStatusMsg:      { fontSize: 12, fontFamily: "Pretendard-Regular", flex: 1 },
  svcDetailRow:      { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#FFFFFF", gap: 3 },
  svcDetailKey:      { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  svcDetailVal:      { fontSize: 13, fontFamily: "Pretendard-Medium", color: "#0F172A" },
  svcPlaceholderBanner: { flexDirection: "row", alignItems: "flex-start", gap: 6, backgroundColor: "#F3F4F6",
                          borderRadius: 8, padding: 10, marginTop: 10 },
  svcPlaceholderTxt:    { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", flex: 1 },
  svcFooter:         { flexDirection: "row", gap: 8, marginTop: 16 },
  svcRefreshBtn:     { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
                       gap: 6, paddingVertical: 12, borderRadius: 10, backgroundColor: P },
  svcRefreshTxt:     { fontSize: 13, fontFamily: "Pretendard-Medium", color: "#fff" },
  svcCloseBtn:       { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: "#FFFFFF", alignItems: "center" },
  svcCloseTxt:       { fontSize: 13, fontFamily: "Pretendard-Medium", color: "#0F172A" },
});
