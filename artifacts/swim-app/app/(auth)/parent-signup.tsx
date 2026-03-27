/**
 * parent-signup.tsx — 학부모 회원가입
 * 공통 폼: 아이디 / 비밀번호 / 성별 / 휴대폰
 * 휴대폰 SMS 인증 필수 → 인증 완료 후 수영장 검색 단계로 이동
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState, useEffect, useRef } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { API_BASE } from "@/context/auth/SessionContext";

const C = Colors.light;
type Gender = "남" | "여" | "기타";
type SmsState = "idle" | "sending" | "sent" | "verifying" | "verified" | "error";

export default function ParentSignupScreen() {
  const insets = useSafeAreaInsets();

  const [name,    setName]    = useState("");
  const [loginId, setLoginId] = useState("");
  const [pw,      setPw]      = useState("");
  const [pwc,     setPwc]     = useState("");
  const [gender,  setGender]  = useState<Gender | null>(null);
  const [phone,   setPhone]   = useState("");
  const [error,   setError]   = useState("");

  const [smsState,  setSmsState]  = useState<SmsState>("idle");
  const [smsCode,   setSmsCode]   = useState("");
  const [smsError,  setSmsError]  = useState("");
  const [timer,     setTimer]     = useState(0);
  const [devCode,   setDevCode]   = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startTimer(seconds = 180) {
    if (timerRef.current) clearInterval(timerRef.current);
    setTimer(seconds);
    timerRef.current = setInterval(() => {
      setTimer(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          if (smsState !== "verified") setSmsState("error");
          setSmsError("인증시간이 만료되었습니다. 다시 요청해주세요.");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  function fmtTimer(s: number) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  async function handleSendSms() {
    setSmsError("");
    setDevCode(null);
    const cleaned = phone.replace(/[-\s]/g, "");
    if (!/^01[016789]\d{7,8}$/.test(cleaned)) {
      setSmsError("올바른 휴대폰 번호를 입력해주세요."); return;
    }
    setSmsState("sending");
    try {
      const res = await fetch(`${API_BASE}/auth/send-sms-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: cleaned, purpose: "parent_signup" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "발송에 실패했습니다.");
      setSmsState("sent");
      setSmsCode("");
      startTimer(180);
      // 개발용 provider인 경우 인증번호를 화면에 표시
      if (data.dev_code) setDevCode(data.dev_code);
    } catch (e: any) {
      setSmsState("error");
      setSmsError(e.message || "잠시 후 다시 시도해주세요.");
    }
  }

  async function handleVerifySms() {
    setSmsError("");
    if (smsCode.trim().length !== 6) { setSmsError("6자리 인증번호를 입력해주세요."); return; }
    setSmsState("verifying");
    try {
      const cleaned = phone.replace(/[-\s]/g, "");
      const res = await fetch(`${API_BASE}/auth/verify-sms-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: cleaned, code: smsCode.trim(), purpose: "parent_signup" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "인증에 실패했습니다.");
      if (timerRef.current) clearInterval(timerRef.current);
      setSmsState("verified");
    } catch (e: any) {
      setSmsState("sent");
      setSmsError(e.message || "인증번호가 올바르지 않습니다.");
    }
  }

  function validate() {
    if (!name.trim())           { setError("이름을 입력해주세요."); return false; }
    if (!loginId.trim())        { setError("아이디를 입력해주세요."); return false; }
    if (pw.length < 6)          { setError("비밀번호는 6자 이상이어야 합니다."); return false; }
    if (pw !== pwc)             { setError("비밀번호가 일치하지 않습니다."); return false; }
    if (!gender)                { setError("성별을 선택해주세요."); return false; }
    if (!phone.trim())          { setError("휴대폰 번호를 입력해주세요."); return false; }
    if (smsState !== "verified") { setError("휴대폰 인증을 완료해주세요."); return false; }
    return true;
  }

  function handleNext() {
    setError("");
    if (!validate()) return;
    router.push({
      pathname: "/parent-onboard-pool" as any,
      params: { name, loginId, pw, gender: gender!, phone: phone.replace(/[-\s]/g, "") },
    });
  }

  const phoneVerified = smsState === "verified";

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
          onPress={() => router.back()}
          style={[styles.backBtn, { top: insets.top + (Platform.OS === "web" ? 67 : 16) }]}
        >
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>

        <View style={styles.header}>
          <View style={[styles.iconBox, { backgroundColor: "#FFF1BF" }]}>
            <Feather name="heart" size={28} color="#E4A93A" />
          </View>
          <Text style={[styles.title, { color: C.text }]}>학부모 가입</Text>
          <Text style={[styles.sub, { color: C.textSecondary }]}>
            수영장 검색 후 자녀 연결을 요청합니다
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: C.card }]}>
          {!!error && (
            <View style={[styles.errorBox, { backgroundColor: "#F9DEDA" }]}>
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

          {/* 휴대폰 번호 + 인증 */}
          <View style={styles.field}>
            <Text style={[styles.label, { color: C.textSecondary }]}>휴대폰 번호 *</Text>
            <View style={styles.phoneRow}>
              <View style={[styles.inputBox, { flex: 1, borderColor: phoneVerified ? "#2EC4B6" : C.border, backgroundColor: C.background }]}>
                <Feather name="phone" size={15} color={phoneVerified ? "#2EC4B6" : C.textMuted} style={{ marginRight: 8 }} />
                <TextInput
                  style={[styles.input, { color: C.text }]}
                  value={phone}
                  onChangeText={v => {
                    setPhone(v);
                    if (smsState !== "idle") { setSmsState("idle"); setSmsCode(""); setSmsError(""); }
                  }}
                  placeholder="010-0000-0000" placeholderTextColor={C.textMuted}
                  keyboardType="phone-pad"
                  editable={!phoneVerified}
                />
                {phoneVerified && <Feather name="check-circle" size={16} color="#2EC4B6" />}
              </View>
              {!phoneVerified && (
                <Pressable
                  style={[styles.smsBtn, { backgroundColor: smsState === "sending" ? "#ccc" : C.tint }]}
                  onPress={handleSendSms}
                  disabled={smsState === "sending" || smsState === "verifying"}
                >
                  {smsState === "sending"
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.smsBtnTxt}>{smsState === "sent" ? "재발송" : "인증번호"}</Text>
                  }
                </Pressable>
              )}
            </View>

            {(smsState === "sent" || smsState === "verifying") && (
              <View style={styles.codeSection}>
                <View style={styles.codeRow}>
                  <View style={[styles.inputBox, { flex: 1, borderColor: C.border, backgroundColor: C.background }]}>
                    <Feather name="key" size={15} color={C.textMuted} style={{ marginRight: 8 }} />
                    <TextInput
                      style={[styles.input, { color: C.text }]}
                      value={smsCode}
                      onChangeText={setSmsCode}
                      placeholder="인증번호 6자리"
                      placeholderTextColor={C.textMuted}
                      keyboardType="number-pad"
                      maxLength={6}
                    />
                    {timer > 0 && (
                      <Text style={[styles.timerTxt, { color: timer < 60 ? C.error : "#D97706" }]}>
                        {fmtTimer(timer)}
                      </Text>
                    )}
                  </View>
                  <Pressable
                    style={[styles.smsBtn, { backgroundColor: smsState === "verifying" ? "#ccc" : "#2EC4B6" }]}
                    onPress={handleVerifySms}
                    disabled={smsState === "verifying"}
                  >
                    {smsState === "verifying"
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={styles.smsBtnTxt}>확인</Text>
                    }
                  </Pressable>
                </View>
                <Text style={[styles.codeSent, { color: "#2EC4B6" }]}>
                  인증번호를 {phone}으로 보냈습니다.
                </Text>
                {!!devCode && (
                  <View style={styles.devCodeBox}>
                    <Text style={styles.devCodeLabel}>[개발용] 인증번호:</Text>
                    <Text style={styles.devCodeNum}>{devCode}</Text>
                  </View>
                )}
              </View>
            )}

            {phoneVerified && (
              <Text style={styles.verifiedTxt}>✓ 휴대폰 인증이 완료되었습니다.</Text>
            )}
            {!!smsError && <Text style={styles.smsErrTxt}>{smsError}</Text>}
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: phoneVerified ? C.tint : "#B0B0B0", opacity: pressed ? 0.85 : 1 },
            ]}
            onPress={handleNext}
            disabled={!phoneVerified}
          >
            <Text style={styles.primaryBtnTxt}>수영장 검색하기</Text>
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
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, icon, children }: { label: string; icon: any; children: React.ReactNode }) {
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
  phoneRow:      { flexDirection: "row", gap: 8, alignItems: "center" },
  smsBtn:        { height: 46, paddingHorizontal: 14, borderRadius: 12, alignItems: "center", justifyContent: "center", minWidth: 72 },
  smsBtnTxt:     { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  codeSection:   { gap: 6, marginTop: 2 },
  codeRow:       { flexDirection: "row", gap: 8, alignItems: "center" },
  timerTxt:      { fontSize: 13, fontFamily: "Inter_600SemiBold", marginRight: 4 },
  codeSent:      { fontSize: 12, fontFamily: "Inter_400Regular" },
  verifiedTxt:   { fontSize: 12, fontFamily: "Inter_500Medium", color: "#2EC4B6" },
  smsErrTxt:     { fontSize: 12, fontFamily: "Inter_400Regular", color: "#D96C6C" },
  devCodeBox:    { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6,
                   backgroundColor: "#FFF3CD", borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  devCodeLabel:  { fontSize: 11, fontFamily: "Inter_500Medium", color: "#856404" },
  devCodeNum:    { fontSize: 16, fontFamily: "Inter_700Bold", color: "#856404", letterSpacing: 2 },
  primaryBtn:    { height: 50, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryBtnTxt: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  loginLink:     { alignItems: "center", paddingVertical: 4 },
  loginLinkTxt:  { fontSize: 13, fontFamily: "Inter_400Regular" },
});
