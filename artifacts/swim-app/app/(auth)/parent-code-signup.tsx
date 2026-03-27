import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView,
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

import { API_BASE } from "@/context/AuthContext";
const C = Colors.light;

type InviteInfo = {
  id: string; code: string; pool_name: string;
  parent_name: string; phone: string;
  child_name?: string; child_birth_year?: number;
  swimming_pool_id: string;
};

export default function ParentCodeSignupScreen() {
  const insets = useSafeAreaInsets();
  const pwRef = useRef<TextInput>(null);
  const pw2Ref = useRef<TextInput>(null);

  const [step, setStep] = useState<"code" | "confirm" | "account" | "done">("code");
  const [code, setCode] = useState("");
  const [invite, setInvite] = useState<InviteInfo | null>(null);

  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function verifyCode() {
    if (code.trim().length < 6) { setError("코드를 올바르게 입력해주세요."); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch(`${API_BASE}/auth/parent-invite/verify?code=${encodeURIComponent(code.trim().toUpperCase())}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error || "유효하지 않은 코드입니다."); return; }
      setInvite(data.invite);
      setStep("confirm");
    } catch { setError("서버 오류가 발생했습니다."); } finally { setLoading(false); }
  }

  async function joinWithCode() {
    if (!loginId.trim()) { setError("아이디를 입력해주세요."); return; }
    if (loginId.trim().length < 3) { setError("아이디는 3자 이상이어야 합니다."); return; }
    if (!password || password.length < 4) { setError("비밀번호는 4자리 이상이어야 합니다."); return; }
    if (password !== passwordConfirm) { setError("비밀번호가 일치하지 않습니다."); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch(`${API_BASE}/auth/parent-invite/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim().toUpperCase(), loginId: loginId.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || data.message || "가입 실패"); return; }
      setStep("done");
    } catch { setError("서버 오류가 발생했습니다."); } finally { setLoading(false); }
  }

  if (step === "done") {
    return (
      <View style={[styles.root, { backgroundColor: C.background }]}>
        <View style={[styles.doneWrap, { paddingTop: insets.top + 60 }]}>
          <View style={[styles.doneIcon, { backgroundColor: "#DFF3EC" }]}>
            <Feather name="check-circle" size={40} color="#2E9B6F" />
          </View>
          <Text style={[styles.doneTitle, { color: C.text }]}>가입 완료!</Text>
          <Text style={[styles.doneDesc, { color: C.textSecondary }]}>
            <Text style={{ fontFamily: "Inter_600SemiBold", color: C.text }}>{invite?.pool_name}</Text>
            {" "}에 가입되었습니다.{"\n"}
            아이디{" "}
            <Text style={{ fontFamily: "Inter_700Bold", color: C.text }}>{loginId}</Text>
            {"\n"}로 로그인해주세요.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.doneBtn, { backgroundColor: C.button, opacity: pressed ? 0.85 : 1 }]}
            onPress={() => router.replace("/parent-login" as any)}
          >
            <Text style={styles.doneBtnText}>학부모 로그인으로</Text>
          </Pressable>
        </View>
      </View>
    );
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
        {/* 헤더 */}
        <View style={styles.headerRow}>
          <Pressable
            style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
            onPress={() => {
              if (step === "confirm") { setStep("code"); setInvite(null); }
              else if (step === "account") setStep("confirm");
              else router.back();
            }}
          >
            <Feather name="arrow-left" size={20} color={C.text} />
          </Pressable>
          <Text style={[styles.screenTitle, { color: C.text }]}>초대코드로 가입</Text>
          <View style={{ width: 28 }} />
        </View>

        {/* 단계 1: 코드 입력 */}
        {step === "code" && (
          <View style={[styles.card, { backgroundColor: C.card }]}>
            <View style={[styles.iconWrap, { backgroundColor: "#DFF3EC" }]}>
              <Feather name="hash" size={24} color="#2E9B6F" />
            </View>
            <Text style={[styles.cardTitle, { color: C.text }]}>초대코드 입력</Text>
            <Text style={[styles.cardDesc, { color: C.textSecondary }]}>
              수영장에서 받은 초대코드를 입력해주세요.
            </Text>

            <View style={styles.field}>
              <View style={[styles.inputRow, { borderColor: code ? C.tint : C.border, backgroundColor: C.background }]}>
                <Feather name="hash" size={15} color={code ? C.tint : C.textMuted} />
                <TextInput
                  style={[styles.codeInput, { color: C.text }]}
                  value={code}
                  onChangeText={v => { setCode(v.toUpperCase()); setError(""); }}
                  placeholder="예: ABCD1234"
                  placeholderTextColor={C.textMuted}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={verifyCode}
                  maxLength={10}
                />
              </View>
            </View>

            {!!error && (
              <View style={[styles.errBox, { backgroundColor: "#F9DEDA" }]}>
                <Feather name="alert-circle" size={14} color={C.error} />
                <Text style={[styles.errText, { color: C.error }]}>{error}</Text>
              </View>
            )}

            <Pressable
              style={({ pressed }) => [styles.submitBtn, { backgroundColor: "#2E9B6F", opacity: pressed || loading ? 0.85 : 1 }]}
              onPress={verifyCode}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.submitBtnText}>코드 확인</Text>
              }
            </Pressable>
          </View>
        )}

        {/* 단계 2: 정보 확인 */}
        {step === "confirm" && invite && (
          <View style={[styles.card, { backgroundColor: C.card }]}>
            <View style={[styles.iconWrap, { backgroundColor: "#DFF3EC" }]}>
              <Feather name="user-check" size={24} color="#2E9B6F" />
            </View>
            <Text style={[styles.cardTitle, { color: C.text }]}>정보 확인</Text>
            <Text style={[styles.cardDesc, { color: C.textSecondary }]}>
              등록된 정보가 맞는지 확인해주세요.
            </Text>

            <View style={[styles.infoBox, { backgroundColor: C.background, borderColor: C.border }]}>
              {[
                { label: "수영장", value: invite.pool_name },
                { label: "이름", value: invite.parent_name },
                { label: "전화번호", value: invite.phone },
                ...(invite.child_name ? [{ label: "자녀 이름", value: invite.child_name }] : []),
                ...(invite.child_birth_year ? [{ label: "자녀 출생년도", value: String(invite.child_birth_year) }] : []),
              ].map((item, i, arr) => (
                <React.Fragment key={item.label}>
                  <View style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: C.textMuted }]}>{item.label}</Text>
                    <Text style={[styles.infoValue, { color: C.text }]}>{item.value}</Text>
                  </View>
                  {i < arr.length - 1 && <View style={[styles.infoDivider, { backgroundColor: C.border }]} />}
                </React.Fragment>
              ))}
            </View>

            <Pressable
              style={({ pressed }) => [styles.submitBtn, { backgroundColor: "#2E9B6F", opacity: pressed ? 0.85 : 1 }]}
              onPress={() => setStep("account")}
            >
              <Text style={styles.submitBtnText}>맞습니다, 계속</Text>
            </Pressable>
          </View>
        )}

        {/* 단계 3: 계정 설정 */}
        {step === "account" && (
          <View style={[styles.card, { backgroundColor: C.card }]}>
            <View style={[styles.iconWrap, { backgroundColor: "#EFF4FF" }]}>
              <Feather name="lock" size={24} color={C.tint} />
            </View>
            <Text style={[styles.cardTitle, { color: C.text }]}>계정 설정</Text>
            <Text style={[styles.cardDesc, { color: C.textSecondary }]}>
              로그인에 사용할 아이디와{"\n"}비밀번호를 설정해주세요.
            </Text>

            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>아이디 (3자 이상)</Text>
              <View style={[styles.inputRow, { borderColor: loginId ? C.tint : C.border, backgroundColor: C.background }]}>
                <Feather name="at-sign" size={15} color={loginId ? C.tint : C.textMuted} />
                <TextInput
                  style={[styles.input, { color: C.text }]}
                  value={loginId}
                  onChangeText={v => { setLoginId(v); setError(""); }}
                  placeholder="영문/숫자 아이디"
                  placeholderTextColor={C.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => pwRef.current?.focus()}
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>비밀번호 (4자리 이상)</Text>
              <View style={[styles.inputRow, { borderColor: password ? C.tint : C.border, backgroundColor: C.background }]}>
                <Feather name="lock" size={15} color={password ? C.tint : C.textMuted} />
                <TextInput
                  ref={pwRef}
                  style={[styles.input, { color: C.text }]}
                  value={password}
                  onChangeText={v => { setPassword(v); setError(""); }}
                  placeholder="비밀번호 설정"
                  placeholderTextColor={C.textMuted}
                  secureTextEntry={!showPw}
                  returnKeyType="next"
                  onSubmitEditing={() => pw2Ref.current?.focus()}
                />
                <Pressable onPress={() => setShowPw(v => !v)} hitSlop={10}>
                  <Feather name={showPw ? "eye-off" : "eye"} size={15} color={C.textMuted} />
                </Pressable>
              </View>
            </View>

            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>비밀번호 확인</Text>
              <View style={[styles.inputRow, { borderColor: passwordConfirm && password !== passwordConfirm ? C.error : (passwordConfirm ? C.tint : C.border), backgroundColor: C.background }]}>
                <Feather name="lock" size={15} color={passwordConfirm ? C.tint : C.textMuted} />
                <TextInput
                  ref={pw2Ref}
                  style={[styles.input, { color: C.text }]}
                  value={passwordConfirm}
                  onChangeText={v => { setPasswordConfirm(v); setError(""); }}
                  placeholder="비밀번호 재입력"
                  placeholderTextColor={C.textMuted}
                  secureTextEntry={!showPw}
                  returnKeyType="done"
                  onSubmitEditing={joinWithCode}
                />
              </View>
              {!!passwordConfirm && password !== passwordConfirm && (
                <Text style={{ color: C.error, fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 }}>비밀번호가 일치하지 않습니다</Text>
              )}
            </View>

            {!!error && (
              <View style={[styles.errBox, { backgroundColor: "#F9DEDA" }]}>
                <Feather name="alert-circle" size={14} color={C.error} />
                <Text style={[styles.errText, { color: C.error }]}>{error}</Text>
              </View>
            )}

            <Pressable
              style={({ pressed }) => [styles.submitBtn, { backgroundColor: C.button, opacity: pressed || loading ? 0.85 : 1 }]}
              onPress={joinWithCode}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.submitBtnText}>가입 완료</Text>
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
  screenTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  card: {
    borderRadius: 20, padding: 22, gap: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 12, elevation: 4,
  },
  iconWrap: { width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 4 },
  cardTitle: { fontSize: 20, fontFamily: "Inter_700Bold", textAlign: "center" },
  cardDesc: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20, marginTop: -6 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  inputRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, height: 52,
  },
  codeInput: { flex: 1, fontSize: 18, fontFamily: "Inter_700Bold", letterSpacing: 3, textAlign: "center" },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  infoBox: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  infoRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 11 },
  infoLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  infoValue: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  infoDivider: { height: 1 },
  errBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12 },
  errText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  submitBtn: { height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 2 },
  submitBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },
  doneWrap: { flex: 1, alignItems: "center", paddingHorizontal: 32, gap: 16 },
  doneIcon: { width: 80, height: 80, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  doneTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
  doneDesc: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
  doneBtn: { height: 52, borderRadius: 14, paddingHorizontal: 32, alignItems: "center", justifyContent: "center", marginTop: 12 },
  doneBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
});
