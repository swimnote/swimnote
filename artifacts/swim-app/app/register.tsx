import { ArrowLeft, Briefcase, CircleAlert, CircleCheck, Home, Key, Lock, Mail, MapPin, Phone, User } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState, useEffect, useRef } from "react";
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
import { API_BASE, safeJson } from "@/context/auth/SessionContext";

type SmsState = "idle" | "sending" | "sent" | "verifying" | "verified" | "error";

export default function RegisterScreen() {
  const { unifiedLogin } = useAuth();
  const { id: prefillId } = useLocalSearchParams<{ id?: string }>();
  const insets = useSafeAreaInsets();
  const C = Colors.light;

  const [form, setForm] = useState({
    email:           prefillId || "",
    password:        "",
    passwordConfirm: "",
    name:            "",
    phone:           "",
    pool_name:       "",
    pool_address:    "",
    pool_phone:      "",
    pool_owner_name: "",
  });
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState("");

  const [smsState,      setSmsState]      = useState<SmsState>("idle");
  const [smsCode,       setSmsCode]       = useState("");
  const [smsError,      setSmsError]      = useState("");
  const [timer,         setTimer]         = useState(0);
  const [devCode,       setDevCode]       = useState<string | null>(null);
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
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  }

  async function handleSendSms() {
    setSmsError("");
    setDevCode(null);
    const cleaned = form.phone.replace(/[-\s]/g, "");
    if (!/^01[016789]\d{7,8}$/.test(cleaned)) {
      setSmsError("올바른 휴대폰 번호를 입력해주세요.");
      return;
    }
    setSmsState("sending");
    try {
      const res = await fetch(`${API_BASE}/auth/send-sms-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: cleaned, purpose: "pool_admin_signup" }),
      });
      const data = await safeJson(res);
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
      const cleaned = form.phone.replace(/[-\s]/g, "");
      const res = await fetch(`${API_BASE}/auth/verify-sms-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: cleaned, code: smsCode.trim(), purpose: "pool_admin_signup" }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.message || "인증에 실패했습니다.");
      if (timerRef.current) clearInterval(timerRef.current);
      setSmsState("verified");
    } catch (e: any) {
      setSmsState("sent");
      setSmsError(e.message || "인증번호가 올바르지 않습니다.");
    }
  }

  function validateForm() {
    if (!form.name.trim()) { setError("이름을 입력해주세요."); return false; }
    if (!form.email.trim()) { setError("이메일을 입력해주세요."); return false; }
    if (!form.phone.trim()) { setError("휴대폰 번호를 입력해주세요."); return false; }
    if (smsState !== "verified") { setError("휴대폰 인증을 완료해주세요."); return false; }
    if (form.password.length < 6) { setError("비밀번호는 6자 이상이어야 합니다."); return false; }
    if (form.password !== form.passwordConfirm) { setError("비밀번호가 일치하지 않습니다."); return false; }
    if (!form.pool_name.trim()) { setError("수영장 이름을 입력해주세요."); return false; }
    if (!form.pool_address.trim()) { setError("수영장 주소를 입력해주세요."); return false; }
    if (!form.pool_phone.trim()) { setError("수영장 전화번호를 입력해주세요."); return false; }
    if (!form.pool_owner_name.trim()) { setError("대표자 이름을 입력해주세요."); return false; }
    return true;
  }

  async function handleRegister() {
    if (!validateForm()) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiRequest(null, "/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email:           form.email.trim(),
          password:        form.password,
          name:            form.name.trim(),
          phone:           form.phone.replace(/[-\s]/g, ""),
          role:            "pool_admin",
          pool_name:       form.pool_name.trim(),
          pool_address:    form.pool_address.trim(),
          pool_phone:      form.pool_phone.trim(),
          pool_owner_name: form.pool_owner_name.trim(),
        }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.message || data.error || "가입에 실패했습니다.");
      await unifiedLogin(form.email.trim(), form.password);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "가입에 실패했습니다.");
    } finally {
      setLoading(false);
    }
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
          { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20), paddingBottom: insets.bottom + 34 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          onPress={() => router.back()}
          style={[styles.backBtn, { top: insets.top + (Platform.OS === "web" ? 67 : 16) }]}
        >
          <ArrowLeft size={22} color={C.text} />
        </Pressable>

        <View style={styles.header}>
          <Text style={[styles.title, { color: C.text }]}>수영장 관리자 가입</Text>
          <Text style={[styles.subtitle, { color: C.textSecondary }]}>
            가입과 동시에 수영장이 즉시 개설됩니다
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.shadow }]}>
          {!!error && (
            <View style={[styles.errorBox, { backgroundColor: "#F9DEDA" }]}>
              <CircleAlert size={14} color={C.error} />
              <Text style={[styles.errorText, { color: C.error }]}>{error}</Text>
            </View>
          )}

          {/* 이름 */}
          <View style={styles.field}>
            <Text style={[styles.label, { color: C.textSecondary }]}>이름 *</Text>
            <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
              <User size={16} color={C.textMuted} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={form.name}
                onChangeText={v => setForm(f => ({ ...f, name: v }))}
                placeholder="담당자 이름"
                placeholderTextColor={C.textMuted}
                autoCapitalize="none"
              />
            </View>
          </View>

          {/* 이메일 */}
          <View style={styles.field}>
            <Text style={[styles.label, { color: C.textSecondary }]}>아이디(이메일) *</Text>
            <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
              <Mail size={16} color={C.textMuted} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={form.email}
                onChangeText={v => setForm(f => ({ ...f, email: v }))}
                placeholder="로그인에 사용할 이메일"
                placeholderTextColor={C.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>
          </View>

          {/* 휴대폰 번호 + 인증번호 받기 */}
          <View style={styles.field}>
            <Text style={[styles.label, { color: C.textSecondary }]}>휴대폰 번호 *</Text>
            <View style={styles.phoneRow}>
              <View style={[styles.inputBox, { flex: 1, borderColor: phoneVerified ? "#2EC4B6" : C.border, backgroundColor: C.background }]}>
                <Phone size={16} color={phoneVerified ? "#2EC4B6" : C.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { color: C.text }]}
                  value={form.phone}
                  onChangeText={v => {
                    setForm(f => ({ ...f, phone: v }));
                    if (smsState !== "idle") { setSmsState("idle"); setSmsCode(""); setSmsError(""); }
                  }}
                  placeholder="010-0000-0000"
                  placeholderTextColor={C.textMuted}
                  keyboardType="phone-pad"
                  editable={!phoneVerified}
                />
                {phoneVerified && <CircleCheck size={16} color="#2EC4B6" />}
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

            {/* 인증번호 입력칸 */}
            {(smsState === "sent" || smsState === "verifying") && (
              <View style={styles.codeSection}>
                <View style={styles.codeRow}>
                  <View style={[styles.inputBox, { flex: 1, borderColor: C.border, backgroundColor: C.background }]}>
                    <Key size={16} color={C.textMuted} style={styles.inputIcon} />
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
                  인증번호를 {form.phone}으로 보냈습니다.
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

            {!!smsError && (
              <Text style={styles.smsErrTxt}>{smsError}</Text>
            )}
          </View>

          {/* 비밀번호 */}
          <View style={styles.field}>
            <Text style={[styles.label, { color: C.textSecondary }]}>비밀번호 *</Text>
            <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
              <Lock size={16} color={C.textMuted} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={form.password}
                onChangeText={v => setForm(f => ({ ...f, password: v }))}
                placeholder="6자 이상"
                placeholderTextColor={C.textMuted}
                secureTextEntry
                autoCapitalize="none"
              />
            </View>
          </View>

          {/* 비밀번호 확인 */}
          <View style={styles.field}>
            <Text style={[styles.label, { color: C.textSecondary }]}>비밀번호 확인 *</Text>
            <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
              <Lock size={16} color={C.textMuted} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={form.passwordConfirm}
                onChangeText={v => setForm(f => ({ ...f, passwordConfirm: v }))}
                placeholder="비밀번호 재입력"
                placeholderTextColor={C.textMuted}
                secureTextEntry
                autoCapitalize="none"
              />
            </View>
          </View>

          {/* 수영장 정보 구분선 */}
          <View style={styles.sectionDivider}>
            <View style={[styles.sectionLine, { backgroundColor: C.border }]} />
            <Text style={[styles.sectionLabel, { color: C.textMuted, backgroundColor: C.card }]}>수영장 정보</Text>
            <View style={[styles.sectionLine, { backgroundColor: C.border }]} />
          </View>

          {/* 수영장 이름 */}
          <View style={styles.field}>
            <Text style={[styles.label, { color: C.textSecondary }]}>수영장 이름 *</Text>
            <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
              <MapPin size={16} color={C.textMuted} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={form.pool_name}
                onChangeText={v => setForm(f => ({ ...f, pool_name: v }))}
                placeholder="예: 토이키즈 수영장"
                placeholderTextColor={C.textMuted}
              />
            </View>
          </View>

          {/* 수영장 주소 */}
          <View style={styles.field}>
            <Text style={[styles.label, { color: C.textSecondary }]}>주소 *</Text>
            <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
              <Home size={16} color={C.textMuted} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={form.pool_address}
                onChangeText={v => setForm(f => ({ ...f, pool_address: v }))}
                placeholder="도로명 주소"
                placeholderTextColor={C.textMuted}
              />
            </View>
          </View>

          {/* 수영장 전화번호 */}
          <View style={styles.field}>
            <Text style={[styles.label, { color: C.textSecondary }]}>수영장 전화번호 *</Text>
            <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
              <Phone size={16} color={C.textMuted} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={form.pool_phone}
                onChangeText={v => setForm(f => ({ ...f, pool_phone: v }))}
                placeholder="02-0000-0000"
                placeholderTextColor={C.textMuted}
                keyboardType="phone-pad"
              />
            </View>
          </View>

          {/* 대표자 이름 */}
          <View style={styles.field}>
            <Text style={[styles.label, { color: C.textSecondary }]}>대표자 이름 *</Text>
            <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
              <Briefcase size={16} color={C.textMuted} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={form.pool_owner_name}
                onChangeText={v => setForm(f => ({ ...f, pool_owner_name: v }))}
                placeholder="사업자 대표자 이름"
                placeholderTextColor={C.textMuted}
              />
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.btn,
              { backgroundColor: phoneVerified ? C.tint : "#B0B0B0", opacity: pressed ? 0.85 : 1 },
            ]}
            onPress={handleRegister}
            disabled={loading || !phoneVerified}
          >
            {loading
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.btnText}>계정 생성하기</Text>
            }
          </Pressable>
        </View>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: C.textSecondary }]}>이미 계정이 있으신가요?</Text>
          <Pressable onPress={() => router.replace("/login")}>
            <Text style={[styles.footerLink, { color: C.tint }]}> 로그인</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:    { flexGrow: 1, paddingHorizontal: 24, gap: 20, paddingTop: 80 },
  backBtn:      { position: "absolute", left: 24, zIndex: 10, width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  header:       { gap: 6, marginTop: 20, alignItems: "center" },
  title:        { fontSize: 26, fontFamily: "Pretendard-Regular" },
  subtitle:     { fontSize: 14, fontFamily: "Pretendard-Regular", textAlign: "center" },
  card:         { borderRadius: 20, padding: 24, gap: 14, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 20, elevation: 4 },
  errorBox:     { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10 },
  errorText:    { fontSize: 13, fontFamily: "Pretendard-Regular", flex: 1 },
  field:        { gap: 6 },
  label:        { fontSize: 13, fontFamily: "Pretendard-Regular" },
  inputBox:     { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, height: 48 },
  inputIcon:    { marginRight: 8 },
  input:        { flex: 1, fontSize: 15, fontFamily: "Pretendard-Regular" },
  phoneRow:     { flexDirection: "row", gap: 8, alignItems: "center" },
  smsBtn:       { height: 48, paddingHorizontal: 14, borderRadius: 12, alignItems: "center", justifyContent: "center", minWidth: 72 },
  smsBtnTxt:    { color: "#fff", fontSize: 13, fontFamily: "Pretendard-Regular" },
  codeSection:  { gap: 6, marginTop: 4 },
  codeRow:      { flexDirection: "row", gap: 8, alignItems: "center" },
  timerTxt:     { fontSize: 13, fontFamily: "Pretendard-Regular", marginRight: 4 },
  codeSent:     { fontSize: 12, fontFamily: "Pretendard-Regular" },
  verifiedTxt:  { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#2EC4B6" },
  smsErrTxt:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#D96C6C" },
  devCodeBox:     { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6,
                    backgroundColor: "#FFF3CD", borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  devCodeLabel:   { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#856404" },
  devCodeNum:     { fontSize: 16, fontFamily: "Pretendard-Regular", color: "#856404", letterSpacing: 2 },
  sectionDivider: { flexDirection: "row", alignItems: "center", gap: 8, marginVertical: 4 },
  sectionLine:    { flex: 1, height: 1 },
  sectionLabel:   { fontSize: 12, fontFamily: "Pretendard-Regular", paddingHorizontal: 4 },
  btn:            { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 4 },
  btnText:      { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" },
  footer:       { flexDirection: "row", justifyContent: "center", alignItems: "center" },
  footerText:   { fontSize: 14, fontFamily: "Pretendard-Regular" },
  footerLink:   { fontSize: 14, fontFamily: "Pretendard-Regular" },
});
