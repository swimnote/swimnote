/**
 * parent-signup.tsx — 학부모 회원가입
 * 공통 폼: 아이디 / 비밀번호 / 성별 / 휴대폰 + SMS 인증
 * 인증 완료 후 → /parent-onboard-pool 이동
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const C = Colors.light;
const MOCK_CODE     = "123456";
const VERIFY_SECS   = 180;
type Gender = "남" | "여" | "기타";
type Step   = "form" | "verify";

export default function ParentSignupScreen() {
  const insets = useSafeAreaInsets();

  const [step, setStep]         = useState<Step>("form");
  const [name, setName]         = useState("");
  const [loginId, setLoginId]   = useState("");
  const [pw, setPw]             = useState("");
  const [pwc, setPwc]           = useState("");
  const [gender, setGender]     = useState<Gender | null>(null);
  const [phone, setPhone]       = useState("");
  const [error, setError]       = useState("");

  const [code, setCode]         = useState("");
  const [codeError, setCodeError] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [timer, setTimer]       = useState(VERIFY_SECS);
  const [timerOn, setTimerOn]   = useState(false);
  const [resendN, setResendN]   = useState(0);

  useEffect(() => {
    if (!timerOn) return;
    if (timer <= 0) { setTimerOn(false); return; }
    const id = setInterval(() => setTimer(t => t - 1), 1000);
    return () => clearInterval(id);
  }, [timerOn, timer]);

  function fmtTimer(s: number) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  function validate() {
    if (!name.trim())    { setError("이름을 입력해주세요."); return false; }
    if (!loginId.trim()) { setError("아이디를 입력해주세요."); return false; }
    if (pw.length < 6)   { setError("비밀번호는 6자 이상이어야 합니다."); return false; }
    if (pw !== pwc)      { setError("비밀번호가 일치하지 않습니다."); return false; }
    if (!gender)         { setError("성별을 선택해주세요."); return false; }
    if (!phone.trim())   { setError("휴대폰 번호를 입력해주세요."); return false; }
    return true;
  }

  function handleNext() {
    setError("");
    if (!validate()) return;
    sendCode();
    setStep("verify");
  }

  function sendCode() {
    setCodeSent(true);
    setCode("");
    setCodeError("");
    setTimer(VERIFY_SECS);
    setTimerOn(true);
    setResendN(n => n + 1);
    console.log(`[MOCK SMS] ${phone} → 인증번호: ${MOCK_CODE}`);
  }

  function handleVerify() {
    setCodeError("");
    if (code !== MOCK_CODE) {
      setCodeError("인증번호가 올바르지 않습니다."); return;
    }
    setTimerOn(false);
    router.push("/parent-onboard-pool" as any);
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20), paddingBottom: insets.bottom + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          onPress={() => step === "verify" ? setStep("form") : router.back()}
          style={[styles.backBtn, { top: insets.top + (Platform.OS === "web" ? 67 : 16) }]}
        >
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>

        {/* ── STEP 1: 가입 폼 ── */}
        {step === "form" && (
          <>
            <View style={styles.header}>
              <View style={[styles.iconBox, { backgroundColor: "#FEF3C7" }]}>
                <Feather name="heart" size={28} color="#F59E0B" />
              </View>
              <Text style={[styles.title, { color: C.text }]}>학부모 가입</Text>
              <Text style={[styles.sub, { color: C.textSecondary }]}>
                수영장 검색 후 자녀 연결을 요청합니다
              </Text>
            </View>

            <View style={[styles.card, { backgroundColor: C.card }]}>
              {!!error && (
                <View style={[styles.errorBox, { backgroundColor: "#FEE2E2" }]}>
                  <Feather name="alert-circle" size={13} color={C.error} />
                  <Text style={[styles.errorTxt, { color: C.error }]}>{error}</Text>
                </View>
              )}

              {/* 이름 */}
              <Field label="이름 *" icon="user">
                <TextInput
                  style={[styles.input, { color: C.text }]}
                  value={name} onChangeText={setName}
                  placeholder="실명 입력" placeholderTextColor={C.textMuted}
                  autoCapitalize="none"
                />
              </Field>

              {/* 아이디 */}
              <Field label="아이디 *" icon="at-sign">
                <TextInput
                  style={[styles.input, { color: C.text }]}
                  value={loginId} onChangeText={setLoginId}
                  placeholder="로그인에 사용할 아이디" placeholderTextColor={C.textMuted}
                  autoCapitalize="none"
                />
              </Field>

              {/* 비밀번호 */}
              <Field label="비밀번호 *" icon="lock">
                <TextInput
                  style={[styles.input, { color: C.text }]}
                  value={pw} onChangeText={setPw}
                  placeholder="6자 이상" placeholderTextColor={C.textMuted}
                  secureTextEntry autoCapitalize="none"
                />
              </Field>

              {/* 비밀번호 확인 */}
              <Field label="비밀번호 확인 *" icon="lock">
                <TextInput
                  style={[styles.input, { color: C.text }]}
                  value={pwc} onChangeText={setPwc}
                  placeholder="비밀번호 재입력" placeholderTextColor={C.textMuted}
                  secureTextEntry autoCapitalize="none"
                />
              </Field>

              {/* 성별 */}
              <View style={styles.field}>
                <Text style={[styles.label, { color: C.textSecondary }]}>성별 *</Text>
                <View style={styles.genderRow}>
                  {(["남", "여", "기타"] as Gender[]).map(g => (
                    <Pressable
                      key={g}
                      style={[styles.genderBtn, gender === g && { backgroundColor: C.tint, borderColor: C.tint }]}
                      onPress={() => setGender(g)}
                    >
                      <Text style={[styles.genderTxt, { color: gender === g ? "#fff" : C.textSecondary }]}>{g}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* 휴대폰 */}
              <Field label="휴대폰 번호 *" icon="phone">
                <TextInput
                  style={[styles.input, { color: C.text }]}
                  value={phone} onChangeText={setPhone}
                  placeholder="010-0000-0000" placeholderTextColor={C.textMuted}
                  keyboardType="phone-pad"
                />
              </Field>

              <View style={[styles.smsBadge, { backgroundColor: C.tintLight }]}>
                <Feather name="smartphone" size={13} color={C.tint} />
                <Text style={[styles.smsBadgeTxt, { color: C.tint }]}>
                  다음 단계에서 SMS 인증을 진행합니다
                </Text>
              </View>

              <Pressable
                style={({ pressed }) => [styles.primaryBtn, { backgroundColor: C.tint, opacity: pressed ? 0.85 : 1 }]}
                onPress={handleNext}
              >
                <Text style={styles.primaryBtnTxt}>인증번호 받기</Text>
                <Feather name="arrow-right" size={16} color="#fff" />
              </Pressable>
            </View>

            <Pressable
              style={({ pressed }) => [styles.loginLink, { opacity: pressed ? 0.6 : 1 }]}
              onPress={() => router.replace("/" as any)}
            >
              <Text style={[styles.loginLinkTxt, { color: C.textSecondary }]}>
                이미 계정이 있으신가요?{" "}
                <Text style={{ color: C.tint, fontFamily: "Inter_600SemiBold" }}>로그인</Text>
              </Text>
            </Pressable>
          </>
        )}

        {/* ── STEP 2: SMS 인증 ── */}
        {step === "verify" && (
          <>
            <View style={styles.header}>
              <View style={[styles.iconBox, { backgroundColor: "#ECFDF5" }]}>
                <Feather name="smartphone" size={28} color="#10B981" />
              </View>
              <Text style={[styles.title, { color: C.text }]}>휴대폰 인증</Text>
              <Text style={[styles.sub, { color: C.textSecondary }]}>
                <Text style={{ fontFamily: "Inter_600SemiBold", color: C.text }}>{phone}</Text>
                {"\n"}로 전송된 6자리 인증번호를 입력해주세요
              </Text>
            </View>

            <View style={[styles.card, { backgroundColor: C.card }]}>
              {!!codeError && (
                <View style={[styles.errorBox, { backgroundColor: "#FEE2E2" }]}>
                  <Feather name="alert-circle" size={13} color={C.error} />
                  <Text style={[styles.errorTxt, { color: C.error }]}>{codeError}</Text>
                </View>
              )}

              <View style={styles.field}>
                <Text style={[styles.label, { color: C.textSecondary }]}>인증번호</Text>
                <View style={[styles.codeRow, { borderColor: C.border, backgroundColor: C.background }]}>
                  <TextInput
                    style={[styles.codeInput, { color: C.text }]}
                    value={code}
                    onChangeText={setCode}
                    placeholder="6자리 숫자 입력"
                    placeholderTextColor={C.textMuted}
                    keyboardType="number-pad"
                    maxLength={6}
                    autoFocus
                  />
                  {timerOn && (
                    <Text style={[styles.timerTxt, { color: timer <= 30 ? C.error : C.tint }]}>
                      {fmtTimer(timer)}
                    </Text>
                  )}
                  {!timerOn && timer === 0 && (
                    <Text style={[styles.timerTxt, { color: C.error }]}>만료</Text>
                  )}
                </View>
              </View>

              <View style={styles.mockHint}>
                <Feather name="info" size={12} color={C.textMuted} />
                <Text style={[styles.mockHintTxt, { color: C.textMuted }]}>
                  테스트 인증번호: <Text style={{ fontFamily: "Inter_700Bold" }}>{MOCK_CODE}</Text>
                </Text>
              </View>

              <Pressable
                style={({ pressed }) => [styles.primaryBtn, { backgroundColor: C.tint, opacity: pressed ? 0.85 : 1 }]}
                onPress={handleVerify}
              >
                <Text style={styles.primaryBtnTxt}>인증 확인 → 수영장 검색</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.resendBtn, { opacity: pressed ? 0.6 : 1 }]}
                onPress={sendCode}
              >
                <Feather name="refresh-cw" size={13} color={C.textSecondary} />
                <Text style={[styles.resendTxt, { color: C.textSecondary }]}>
                  인증번호 재발송{resendN > 1 ? ` (${resendN}회)` : ""}
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, icon, children }: { label: string; icon: any; children: React.ReactNode }) {
  const C = Colors.light;
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: C.textSecondary }]}>{label}</Text>
      <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
        <Feather name={icon} size={15} color={C.textMuted} style={{ marginRight: 8 }} />
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:     { paddingHorizontal: 20, gap: 24 },
  backBtn:       { position: "absolute", left: 20, zIndex: 10, padding: 4 },
  header:        { alignItems: "center", gap: 10, paddingTop: 8 },
  iconBox:       { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title:         { fontSize: 22, fontFamily: "Inter_700Bold" },
  sub:           { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  card:          { borderRadius: 20, padding: 20, gap: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 3 },
  errorBox:      { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10 },
  errorTxt:      { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  field:         { gap: 6 },
  label:         { fontSize: 12, fontFamily: "Inter_500Medium" },
  inputBox:      { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, height: 46 },
  input:         { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  genderRow:     { flexDirection: "row", gap: 10 },
  genderBtn:     { flex: 1, height: 42, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.light.border, alignItems: "center", justifyContent: "center", backgroundColor: Colors.light.background },
  genderTxt:     { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  smsBadge:      { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10 },
  smsBadgeTxt:   { fontSize: 12, fontFamily: "Inter_400Regular" },
  primaryBtn:    { height: 50, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryBtnTxt: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  loginLink:     { alignItems: "center", paddingVertical: 4 },
  loginLinkTxt:  { fontSize: 13, fontFamily: "Inter_400Regular" },
  codeRow:       { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, height: 52 },
  codeInput:     { flex: 1, fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: 6 },
  timerTxt:      { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  mockHint:      { flexDirection: "row", alignItems: "center", gap: 6 },
  mockHintTxt:   { fontSize: 12, fontFamily: "Inter_400Regular" },
  resendBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10 },
  resendTxt:     { fontSize: 13, fontFamily: "Inter_400Regular" },
});
