import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

type Step = "form" | "phone_verify";

const MOCK_CODE = "123456";
const VERIFY_SECONDS = 180;

export default function RegisterScreen() {
  const { unifiedLogin } = useAuth();
  const { id: prefillId } = useLocalSearchParams<{ id?: string }>();
  const insets = useSafeAreaInsets();
  const C = Colors.light;

  const [step, setStep]   = useState<Step>("form");
  const [form, setForm]   = useState({ email: prefillId || "", password: "", passwordConfirm: "", name: "", phone: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  // 휴대폰 인증 상태
  const [verifyCode,    setVerifyCode]    = useState("");
  const [codeError,     setCodeError]     = useState("");
  const [codeSent,      setCodeSent]      = useState(false);
  const [timer,         setTimer]         = useState(VERIFY_SECONDS);
  const [timerActive,   setTimerActive]   = useState(false);
  const [verified,      setVerified]      = useState(false);
  const [resendCount,   setResendCount]   = useState(0);

  // 타이머
  useEffect(() => {
    if (!timerActive) return;
    if (timer <= 0) { setTimerActive(false); return; }
    const id = setInterval(() => setTimer(t => t - 1), 1000);
    return () => clearInterval(id);
  }, [timerActive, timer]);

  function fmtTimer(s: number) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  }

  function validateForm() {
    if (!form.email || !form.password || !form.name) {
      setError("필수 항목을 모두 입력해주세요."); return false;
    }
    if (form.password !== form.passwordConfirm) {
      setError("비밀번호가 일치하지 않습니다."); return false;
    }
    if (form.password.length < 6) {
      setError("비밀번호는 6자 이상이어야 합니다."); return false;
    }
    return true;
  }

  function handleNext() {
    if (!validateForm()) return;
    if (form.phone.trim()) {
      // 휴대폰 번호 있으면 인증 단계로
      setError("");
      setStep("phone_verify");
      sendCode();
    } else {
      // 번호 없으면 바로 가입
      doRegister();
    }
  }

  function sendCode() {
    setCodeSent(true);
    setTimer(VERIFY_SECONDS);
    setTimerActive(true);
    setVerifyCode("");
    setCodeError("");
    setResendCount(c => c + 1);
    // mock: 콘솔에 코드 출력 (실제 SMS 발송 mock)
    console.log(`[MOCK SMS] ${form.phone} 로 인증번호 ${MOCK_CODE} 발송`);
  }

  function handleVerify() {
    setCodeError("");
    if (verifyCode !== MOCK_CODE) {
      setCodeError("인증번호가 올바르지 않습니다.");
      return;
    }
    setVerified(true);
    setTimerActive(false);
    doRegister();
  }

  async function doRegister() {
    setLoading(true);
    setError("");
    try {
      const res = await apiRequest(null, "/auth/register", {
        method: "POST",
        body: JSON.stringify({ email: form.email.trim(), password: form.password, name: form.name, phone: form.phone, role: "pool_admin" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "가입에 실패했습니다.");
      await unifiedLogin(form.email.trim(), form.password);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "가입에 실패했습니다.");
      if (step === "phone_verify") setStep("form");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.background }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20), paddingBottom: insets.bottom + 34 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable onPress={() => step === "phone_verify" ? setStep("form") : router.back()}
          style={[styles.backBtn, { top: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>

        {/* ──────────── STEP 1: 가입 폼 ──────────── */}
        {step === "form" && (
          <>
            <View style={styles.header}>
              <Text style={[styles.title, { color: C.text }]}>수영장 관리자 가입</Text>
              <Text style={[styles.subtitle, { color: C.textSecondary }]}>가입 후 수영장 등록 신청을 진행해주세요</Text>
            </View>

            <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.shadow }]}>
              {error ? (
                <View style={[styles.errorBox, { backgroundColor: "#FEE2E2" }]}>
                  <Feather name="alert-circle" size={14} color={C.error} />
                  <Text style={[styles.errorText, { color: C.error }]}>{error}</Text>
                </View>
              ) : null}

              {[
                { key: "name",            label: "이름 *",          placeholder: "담당자 이름",      icon: "user"  as const, keyboardType: "default" as const },
                { key: "email",           label: "아이디 *",         placeholder: "로그인에 사용할 아이디", icon: "user" as const, keyboardType: "default" as const },
                { key: "phone",           label: "휴대폰 번호",       placeholder: "010-0000-0000",   icon: "phone" as const, keyboardType: "phone-pad" as const },
                { key: "password",        label: "비밀번호 *",        placeholder: "6자 이상",         icon: "lock"  as const, secure: true, keyboardType: "default" as const },
                { key: "passwordConfirm", label: "비밀번호 확인 *",   placeholder: "비밀번호 재입력",  icon: "lock"  as const, secure: true, keyboardType: "default" as const },
              ].map(({ key, label, placeholder, icon, secure, keyboardType }) => (
                <View key={key} style={styles.field}>
                  <Text style={[styles.label, { color: C.textSecondary }]}>{label}</Text>
                  <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
                    <Feather name={icon} size={16} color={C.textMuted} style={styles.inputIcon} />
                    <TextInput
                      style={[styles.input, { color: C.text }]}
                      value={form[key as keyof typeof form]}
                      onChangeText={(v) => setForm(f => ({ ...f, [key]: v }))}
                      placeholder={placeholder}
                      placeholderTextColor={C.textMuted}
                      secureTextEntry={!!secure}
                      keyboardType={keyboardType}
                      autoCapitalize="none"
                    />
                  </View>
                </View>
              ))}

              {form.phone.trim() ? (
                <View style={styles.phoneBadge}>
                  <Feather name="shield" size={13} color="#0891B2" />
                  <Text style={styles.phoneBadgeTxt}>휴대폰 번호 입력 시 SMS 인증 단계가 추가됩니다</Text>
                </View>
              ) : null}

              <Pressable
                style={({ pressed }) => [styles.btn, { backgroundColor: C.tint, opacity: pressed ? 0.85 : 1 }]}
                onPress={handleNext}
                disabled={loading}
              >
                {loading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.btnText}>{form.phone.trim() ? "다음: 휴대폰 인증" : "계정 생성하기"}</Text>
                }
              </Pressable>
            </View>

            <View style={styles.footer}>
              <Text style={[styles.footerText, { color: C.textSecondary }]}>이미 계정이 있으신가요?</Text>
              <Pressable onPress={() => router.replace("/login")}>
                <Text style={[styles.footerLink, { color: C.tint }]}> 로그인</Text>
              </Pressable>
            </View>
          </>
        )}

        {/* ──────────── STEP 2: 휴대폰 인증 ──────────── */}
        {step === "phone_verify" && (
          <>
            <View style={styles.header}>
              <View style={styles.verifyIcon}>
                <Feather name="smartphone" size={28} color="#0891B2" />
              </View>
              <Text style={[styles.title, { color: C.text }]}>휴대폰 인증</Text>
              <Text style={[styles.subtitle, { color: C.textSecondary }]}>{form.phone} 로 인증번호를 발송했습니다</Text>
            </View>

            <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.shadow }]}>
              {codeError ? (
                <View style={[styles.errorBox, { backgroundColor: "#FEE2E2" }]}>
                  <Feather name="alert-circle" size={14} color={C.error} />
                  <Text style={[styles.errorText, { color: C.error }]}>{codeError}</Text>
                </View>
              ) : null}
              {error ? (
                <View style={[styles.errorBox, { backgroundColor: "#FEE2E2" }]}>
                  <Feather name="alert-circle" size={14} color={C.error} />
                  <Text style={[styles.errorText, { color: C.error }]}>{error}</Text>
                </View>
              ) : null}

              <View style={styles.field}>
                <View style={styles.codeLabelRow}>
                  <Text style={[styles.label, { color: C.textSecondary }]}>인증번호 6자리</Text>
                  {timerActive && (
                    <Text style={[styles.timerTxt, { color: timer < 30 ? "#DC2626" : "#0891B2" }]}>
                      {fmtTimer(timer)}
                    </Text>
                  )}
                  {!timerActive && timer === 0 && (
                    <Text style={styles.expiredTxt}>만료됨</Text>
                  )}
                </View>
                <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
                  <Feather name="key" size={16} color={C.textMuted} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { color: C.text, letterSpacing: 4, fontSize: 18 }]}
                    value={verifyCode}
                    onChangeText={v => { setVerifyCode(v.slice(0, 6)); setCodeError(""); }}
                    placeholder="000000"
                    placeholderTextColor={C.textMuted}
                    keyboardType="number-pad"
                    maxLength={6}
                  />
                </View>
              </View>

              {/* mock 힌트 */}
              <View style={styles.mockHint}>
                <Feather name="info" size={12} color="#D97706" />
                <Text style={styles.mockHintTxt}>테스트 인증번호: {MOCK_CODE} (mock)</Text>
              </View>

              <View style={styles.verifyPolicies}>
                <Text style={styles.policyTxt}>• 인증번호 유효시간: 3분</Text>
                <Text style={styles.policyTxt}>• 재발송 대기시간: 30초</Text>
                <Text style={styles.policyTxt}>• 일일 발송 제한: 5회</Text>
                <Text style={styles.policyTxt}>• 정책 관리: 슈퍼관리자 보안·설정</Text>
              </View>

              <Pressable
                style={({ pressed }) => [styles.btn, { backgroundColor: "#0891B2", opacity: (verifyCode.length === 6 && !loading) ? (pressed ? 0.85 : 1) : 0.4 }]}
                onPress={handleVerify}
                disabled={verifyCode.length !== 6 || loading}
              >
                {loading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.btnText}>인증 확인 · 가입 완료</Text>
                }
              </Pressable>

              <Pressable
                style={[styles.resendBtn, { opacity: (timer <= 0 || !timerActive) && resendCount < 5 ? 1 : 0.4 }]}
                onPress={sendCode}
                disabled={timerActive || resendCount >= 5}
              >
                <Feather name="refresh-cw" size={13} color="#0891B2" />
                <Text style={styles.resendTxt}>
                  {resendCount >= 5 ? "재발송 한도 초과" : "인증번호 재발송"}
                  {resendCount > 0 ? ` (${resendCount}/5)` : ""}
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:       { flexGrow: 1, paddingHorizontal: 24, gap: 20, paddingTop: 80 },
  backBtn:         { position: "absolute", left: 24, zIndex: 10, width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  header:          { gap: 6, marginTop: 20, alignItems: "center" },
  verifyIcon:      { width: 64, height: 64, borderRadius: 18, backgroundColor: "#ECFEFF", alignItems: "center", justifyContent: "center", marginBottom: 4 },
  title:           { fontSize: 26, fontFamily: "Inter_700Bold" },
  subtitle:        { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  card:            { borderRadius: 20, padding: 24, gap: 14, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 20, elevation: 4 },
  errorBox:        { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10 },
  errorText:       { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  field:           { gap: 6 },
  codeLabelRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  timerTxt:        { fontSize: 14, fontFamily: "Inter_700Bold" },
  expiredTxt:      { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#9CA3AF" },
  label:           { fontSize: 13, fontFamily: "Inter_500Medium" },
  inputBox:        { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, height: 48 },
  inputIcon:       { marginRight: 8 },
  input:           { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  phoneBadge:      { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#ECFEFF",
                     padding: 10, borderRadius: 10, borderWidth: 1, borderColor: "#BAE6FD" },
  phoneBadgeTxt:   { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#0891B2" },
  mockHint:        { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#FFFBEB",
                     padding: 10, borderRadius: 10, borderWidth: 1, borderColor: "#FDE68A" },
  mockHintTxt:     { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: "#D97706" },
  verifyPolicies:  { backgroundColor: "#F9FAFB", borderRadius: 10, padding: 12, gap: 4,
                     borderWidth: 1, borderColor: "#E5E7EB" },
  policyTxt:       { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280" },
  btn:             { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 4 },
  btnText:         { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  resendBtn:       { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12 },
  resendTxt:       { fontSize: 14, fontFamily: "Inter_500Medium", color: "#0891B2" },
  footer:          { flexDirection: "row", justifyContent: "center", alignItems: "center" },
  footerText:      { fontSize: 14, fontFamily: "Inter_400Regular" },
  footerLink:      { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
