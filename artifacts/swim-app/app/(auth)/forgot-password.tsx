import { ArrowLeft, CircleAlert, CircleCheck, Hash, Lock, Phone, Smartphone, Terminal, User } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router, useLocalSearchParams } from "expo-router";
import React, { useRef, useState, useEffect } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView,
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { API_BASE } from "@/context/AuthContext";

const C = Colors.light;
type Step = "id" | "sms" | "pw" | "done";
type SmsState = "idle" | "sending" | "sent" | "verifying" | "verified" | "error";

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ identifier?: string }>();
  const pwRef = useRef<TextInput>(null);
  const pw2Ref = useRef<TextInput>(null);

  const [step, setStep] = useState<Step>("id");
  const [identifier, setIdentifier] = useState(params.identifier || "");
  const [phone, setPhone] = useState("");
  const [smsState, setSmsState] = useState<SmsState>("idle");
  const [smsCode, setSmsCode] = useState("");
  const [smsError, setSmsError] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [timer, setTimer] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  function startTimer(seconds = 180) {
    if (timerRef.current) clearInterval(timerRef.current);
    setTimer(seconds);
    timerRef.current = setInterval(() => {
      setTimer(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          if (smsState !== "verified") { setSmsState("error"); setSmsError("인증시간이 만료되었습니다. 다시 요청해주세요."); }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  function fmtTimer(s: number) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  async function checkAccount() {
    if (!identifier.trim()) { setError("아이디를 입력해주세요."); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch(`${API_BASE}/auth/unified-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim(), password: "____check____" }),
      });
      const data = await res.json();
      if (data.error_code === "user_not_found") {
        setError("해당 아이디로 등록된 계정이 없습니다."); return;
      }
      setStep("sms");
    } catch { setError("서버 오류가 발생했습니다."); } finally { setLoading(false); }
  }

  async function handleSendSms() {
    setSmsError(""); setDevCode(null);
    const cleaned = phone.replace(/[-\s]/g, "");
    if (!/^01[016789]\d{7,8}$/.test(cleaned)) {
      setSmsError("올바른 휴대폰 번호를 입력해주세요."); return;
    }
    setSmsState("sending");
    try {
      const res = await fetch(`${API_BASE}/auth/send-sms-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: cleaned, purpose: "reset_password" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "발송에 실패했습니다.");
      setSmsState("sent");
      setSmsCode("");
      startTimer(180);
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
        body: JSON.stringify({ phone: cleaned, code: smsCode.trim(), purpose: "reset_password" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "인증에 실패했습니다.");
      if (timerRef.current) clearInterval(timerRef.current);
      setSmsState("verified");
      setStep("pw");
    } catch (e: any) {
      setSmsState("sent");
      setSmsError(e.message || "인증번호가 올바르지 않습니다.");
    }
  }

  async function resetPassword() {
    if (!newPw || newPw.length < 4) { setError("비밀번호는 4자 이상이어야 합니다."); return; }
    if (newPw !== newPw2) { setError("비밀번호가 일치하지 않습니다."); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch(`${API_BASE}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim(), new_password: newPw }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || data.message || "변경 실패"); return; }
      setStep("done");
    } catch { setError("서버 오류가 발생했습니다."); } finally { setLoading(false); }
  }

  function goBack() {
    if (step === "sms") setStep("id");
    else if (step === "pw") setStep("sms");
    else router.back();
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: C.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <Pressable style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]} onPress={goBack}>
            <ArrowLeft size={20} color={C.text} />
          </Pressable>
          <Text style={[styles.screenTitle, { color: C.text }]}>비밀번호 찾기</Text>
          <View style={{ width: 28 }} />
        </View>

        {/* 완료 */}
        {step === "done" && (
          <View style={styles.doneWrap}>
            <View style={[styles.doneIcon, { backgroundColor: "#E6FAF8" }]}>
              <CircleCheck size={36} color={C.tint} />
            </View>
            <Text style={[styles.doneTitle, { color: C.text }]}>비밀번호 변경 완료</Text>
            <Text style={[styles.doneDesc, { color: C.textSecondary }]}>
              새 비밀번호로 로그인해주세요.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.submitBtn, { backgroundColor: C.button, opacity: pressed ? 0.85 : 1 }]}
              onPress={() => router.replace("/" as any)}
            >
              <Text style={styles.submitBtnText}>로그인 화면으로</Text>
            </Pressable>
          </View>
        )}

        {/* 단계 1: 아이디 확인 */}
        {step === "id" && (
          <View style={[styles.card, { backgroundColor: C.card }]}>
            <View style={[styles.iconWrap, { backgroundColor: "#E6FAF8" }]}>
              <User size={24} color={C.tint} />
            </View>
            <Text style={[styles.cardTitle, { color: C.text }]}>아이디 확인</Text>
            <Text style={[styles.cardDesc, { color: C.textSecondary }]}>
              가입하신 아이디(또는 전화번호)를 입력해주세요.
            </Text>

            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>아이디</Text>
              <View style={[styles.inputRow, { borderColor: identifier ? C.tint : C.border, backgroundColor: C.background }]}>
                <User size={15} color={identifier ? C.tint : C.textMuted} />
                <TextInput
                  style={[styles.input, { color: C.text }]}
                  value={identifier}
                  onChangeText={v => { setIdentifier(v); setError(""); }}
                  placeholder="아이디 또는 전화번호"
                  placeholderTextColor={C.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={checkAccount}
                />
              </View>
            </View>

            {!!error && (
              <View style={[styles.errBox, { backgroundColor: "#F9DEDA" }]}>
                <CircleAlert size={14} color={C.error} />
                <Text style={[styles.errText, { color: C.error }]}>{error}</Text>
              </View>
            )}

            <Pressable
              style={({ pressed }) => [styles.submitBtn, { backgroundColor: C.button, opacity: pressed || loading ? 0.85 : 1 }]}
              onPress={checkAccount}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.submitBtnText}>다음</Text>
              }
            </Pressable>
          </View>
        )}

        {/* 단계 2: SMS 인증 */}
        {step === "sms" && (
          <View style={[styles.card, { backgroundColor: C.card }]}>
            <View style={[styles.iconWrap, { backgroundColor: "#E6FAF8" }]}>
              <Smartphone size={24} color={C.tint} />
            </View>
            <Text style={[styles.cardTitle, { color: C.text }]}>휴대폰 인증</Text>
            <Text style={[styles.cardDesc, { color: C.textSecondary }]}>
              가입 시 등록한 휴대폰 번호로 인증해주세요.
            </Text>

            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>휴대폰 번호</Text>
              <View style={styles.phoneRow}>
                <View style={[styles.inputRow, { flex: 1, borderColor: phone ? C.tint : C.border, backgroundColor: C.background }]}>
                  <Phone size={15} color={phone ? C.tint : C.textMuted} />
                  <TextInput
                    style={[styles.input, { color: C.text }]}
                    value={phone}
                    onChangeText={v => { setPhone(v); setSmsError(""); }}
                    placeholder="010-0000-0000"
                    placeholderTextColor={C.textMuted}
                    keyboardType="phone-pad"
                    returnKeyType="done"
                    editable={smsState !== "verified"}
                  />
                </View>
                <Pressable
                  style={[styles.smsBtn, { backgroundColor: smsState === "verified" ? "#CBD5E1" : C.tint }]}
                  onPress={handleSendSms}
                  disabled={smsState === "sending" || smsState === "verified"}
                >
                  {smsState === "sending"
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={styles.smsBtnTxt}>{smsState === "sent" || smsState === "error" ? "재발송" : "인증"}</Text>
                  }
                </Pressable>
              </View>
            </View>

            {(smsState === "sent" || smsState === "verifying" || smsState === "error") && (
              <View style={styles.field}>
                <View style={styles.phoneRow}>
                  <View style={[styles.inputRow, { flex: 1, borderColor: smsCode ? C.tint : C.border, backgroundColor: C.background }]}>
                    <Hash size={15} color={smsCode ? C.tint : C.textMuted} />
                    <TextInput
                      style={[styles.input, { color: C.text }]}
                      value={smsCode}
                      onChangeText={v => { setSmsCode(v.replace(/\D/g, "").slice(0, 6)); setSmsError(""); }}
                      placeholder="인증번호 6자리"
                      placeholderTextColor={C.textMuted}
                      keyboardType="number-pad"
                      maxLength={6}
                    />
                    {timer > 0 && <Text style={[styles.timerTxt, { color: timer <= 30 ? C.error : C.textMuted }]}>{fmtTimer(timer)}</Text>}
                  </View>
                  <Pressable
                    style={[styles.smsBtn, { backgroundColor: C.tint }]}
                    onPress={handleVerifySms}
                    disabled={smsState === "verifying"}
                  >
                    {smsState === "verifying"
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={styles.smsBtnTxt}>확인</Text>
                    }
                  </Pressable>
                </View>
                {!!smsError && <Text style={{ fontSize: 12, color: C.error, marginTop: 2 }}>{smsError}</Text>}
              </View>
            )}

            {devCode && (
              <View style={styles.devCodeBox}>
                <Terminal size={13} color="#856404" />
                <Text style={styles.devCodeLabel}>개발용 인증번호:</Text>
                <Text style={styles.devCodeNum}>{devCode}</Text>
              </View>
            )}
          </View>
        )}

        {/* 단계 3: 새 비밀번호 설정 */}
        {step === "pw" && (
          <View style={[styles.card, { backgroundColor: C.card }]}>
            <View style={[styles.iconWrap, { backgroundColor: "#E6FAF8" }]}>
              <Lock size={24} color={C.tint} />
            </View>
            <Text style={[styles.cardTitle, { color: C.text }]}>새 비밀번호 설정</Text>
            <View style={[styles.idBadge, { backgroundColor: C.background, borderColor: C.border }]}>
              <User size={13} color={C.textMuted} />
              <Text style={[styles.idBadgeText, { color: C.textSecondary }]}>{identifier}</Text>
            </View>

            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>새 비밀번호 (4자 이상)</Text>
              <View style={[styles.inputRow, { borderColor: newPw ? C.tint : C.border, backgroundColor: C.background }]}>
                <Lock size={15} color={newPw ? C.tint : C.textMuted} />
                <TextInput
                  ref={pwRef}
                  style={[styles.input, { color: C.text }]}
                  value={newPw}
                  onChangeText={v => { setNewPw(v); setError(""); }}
                  placeholder="4자 이상"
                  placeholderTextColor={C.textMuted}
                  secureTextEntry={!showPw}
                  returnKeyType="next"
                  onSubmitEditing={() => pw2Ref.current?.focus()}
                />
                <Pressable onPress={() => setShowPw(v => !v)} hitSlop={10}>
                  <LucideIcon name={showPw ? "eye-off" : "eye"} size={15} color={C.textMuted} />
                </Pressable>
              </View>
            </View>

            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>비밀번호 확인</Text>
              <View style={[styles.inputRow, { borderColor: newPw2 ? C.tint : C.border, backgroundColor: C.background }]}>
                <Lock size={15} color={newPw2 ? C.tint : C.textMuted} />
                <TextInput
                  ref={pw2Ref}
                  style={[styles.input, { color: C.text }]}
                  value={newPw2}
                  onChangeText={v => { setNewPw2(v); setError(""); }}
                  placeholder="비밀번호를 다시 입력"
                  placeholderTextColor={C.textMuted}
                  secureTextEntry={!showPw}
                  returnKeyType="done"
                  onSubmitEditing={resetPassword}
                />
              </View>
            </View>

            {!!error && (
              <View style={[styles.errBox, { backgroundColor: "#F9DEDA" }]}>
                <CircleAlert size={14} color={C.error} />
                <Text style={[styles.errText, { color: C.error }]}>{error}</Text>
              </View>
            )}

            <Pressable
              style={({ pressed }) => [styles.submitBtn, { backgroundColor: C.button, opacity: pressed || loading ? 0.85 : 1 }]}
              onPress={resetPassword}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.submitBtnText}>비밀번호 변경</Text>
              }
            </Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { paddingHorizontal: 20, gap: 24 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backBtn: { padding: 4 },
  screenTitle: { fontSize: 18, fontFamily: "Pretendard-Regular" },
  card: {
    borderRadius: 20, padding: 22, gap: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 12, elevation: 4,
  },
  iconWrap: { width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 4 },
  cardTitle: { fontSize: 20, fontFamily: "Pretendard-Regular", textAlign: "center" },
  cardDesc: { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 20, marginTop: -6 },
  idBadge: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  idBadgeText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  inputRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, height: 52,
  },
  input: { flex: 1, fontSize: 15, fontFamily: "Pretendard-Regular" },
  phoneRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  smsBtn: { height: 52, paddingHorizontal: 14, borderRadius: 14, alignItems: "center", justifyContent: "center", minWidth: 70 },
  smsBtnTxt: { color: "#fff", fontSize: 13, fontFamily: "Pretendard-Regular" },
  timerTxt: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  devCodeBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FFF3CD", borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  devCodeLabel: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#856404" },
  devCodeNum: { fontSize: 16, fontFamily: "Pretendard-Regular", color: "#856404", letterSpacing: 2 },
  errBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12 },
  errText: { fontSize: 13, fontFamily: "Pretendard-Regular", flex: 1 },
  submitBtn: { height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 2 },
  submitBtnText: { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" },
  doneWrap: { alignItems: "center", gap: 16, paddingTop: 40 },
  doneIcon: { width: 80, height: 80, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  doneTitle: { fontSize: 22, fontFamily: "Pretendard-Regular" },
  doneDesc: { fontSize: 14, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 22, color: "#64748B" },
});
