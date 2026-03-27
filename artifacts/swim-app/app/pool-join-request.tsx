import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { API_BASE, useAuth } from "@/context/AuthContext";

const C = Colors.light;

export default function ParentRegisterScreen() {
  const insets = useSafeAreaInsets();
  const { setParentSession } = useAuth();

  const [parentName, setParentName]           = useState("");
  const [phone, setPhone]                     = useState("");
  const [loginId, setLoginId]                 = useState("");
  const [password, setPassword]               = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPw, setShowPw]                   = useState(false);
  const [termsAgreed, setTermsAgreed]         = useState(false);
  const [submitting, setSubmitting]           = useState(false);
  const [error, setError]                     = useState("");

  async function handleRegister() {
    setError("");
    if (!parentName.trim()) { setError("이름을 입력해주세요."); return; }
    if (!phone.trim())      { setError("전화번호를 입력해주세요."); return; }
    if (!loginId.trim())    { setError("아이디를 입력해주세요."); return; }
    if (loginId.trim().length < 3) { setError("아이디는 3자 이상이어야 합니다."); return; }
    if (!password)          { setError("비밀번호를 입력해주세요."); return; }
    if (password.length < 4) { setError("비밀번호는 4자리 이상이어야 합니다."); return; }
    if (password !== passwordConfirm) { setError("비밀번호가 일치하지 않습니다."); return; }
    if (!termsAgreed) { setError("이용약관에 동의해주세요."); return; }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/auth/simple-parent-register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parent_name: parentName.trim(),
          phone: phone.trim(),
          loginId: loginId.trim(),
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || "오류가 발생했습니다."); return; }

      await setParentSession(data.token, data.parent);
      router.replace("/(parent)/home" as any);
    } catch {
      setError("네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* 헤더 */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: C.text }]}>학부모 회원가입</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* 안내 */}
        <View style={[styles.infoBox, { backgroundColor: C.tintLight }]}>
          <Feather name="info" size={15} color={C.tint} />
          <Text style={[styles.infoText, { color: C.tint }]}>
            가입 후 홈에서 자녀를 수영장과 연결할 수 있습니다.
          </Text>
        </View>

        {!!error && (
          <View style={[styles.errBox, { backgroundColor: "#F9DEDA" }]}>
            <Feather name="alert-circle" size={14} color={C.error} />
            <Text style={[styles.errText, { color: C.error }]}>{error}</Text>
          </View>
        )}

        <View style={{ gap: 14 }}>
          {/* 이름 */}
          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: C.textSecondary }]}>이름 *</Text>
            <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.card }]}>
              <Feather name="user" size={16} color={C.textMuted} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={parentName} onChangeText={setParentName}
                placeholder="홍길동" placeholderTextColor={C.textMuted}
              />
            </View>
          </View>

          {/* 전화번호 */}
          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: C.textSecondary }]}>전화번호 *</Text>
            <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.card }]}>
              <Feather name="phone" size={16} color={C.textMuted} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={phone} onChangeText={setPhone}
                placeholder="010-0000-0000" placeholderTextColor={C.textMuted}
                keyboardType="phone-pad"
              />
            </View>
          </View>

          {/* 아이디 */}
          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: C.textSecondary }]}>아이디 * (로그인에 사용)</Text>
            <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.card }]}>
              <Feather name="at-sign" size={16} color={C.textMuted} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={loginId} onChangeText={setLoginId}
                placeholder="영문/숫자 3자 이상" placeholderTextColor={C.textMuted}
                autoCapitalize="none" autoCorrect={false}
              />
            </View>
          </View>

          {/* 비밀번호 */}
          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: C.textSecondary }]}>비밀번호 * (4자리 이상)</Text>
            <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.card }]}>
              <Feather name="lock" size={16} color={C.textMuted} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={password} onChangeText={setPassword}
                placeholder="비밀번호 설정" placeholderTextColor={C.textMuted}
                secureTextEntry={!showPw}
              />
              <Pressable onPress={() => setShowPw(v => !v)} hitSlop={10}>
                <Feather name={showPw ? "eye-off" : "eye"} size={16} color={C.textMuted} />
              </Pressable>
            </View>
          </View>

          {/* 비밀번호 확인 */}
          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: C.textSecondary }]}>비밀번호 확인 *</Text>
            <View style={[styles.inputRow, {
              borderColor: passwordConfirm && password !== passwordConfirm ? C.error : C.border,
              backgroundColor: C.card,
            }]}>
              <Feather name="lock" size={16} color={C.textMuted} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={passwordConfirm} onChangeText={setPasswordConfirm}
                placeholder="비밀번호 재입력" placeholderTextColor={C.textMuted}
                secureTextEntry={!showPw}
              />
            </View>
            {!!passwordConfirm && password !== passwordConfirm && (
              <Text style={{ color: C.error, fontSize: 12, fontFamily: "Inter_400Regular" }}>
                비밀번호가 일치하지 않습니다
              </Text>
            )}
          </View>
        </View>

        {/* 이용약관 동의 */}
        <Pressable
          style={styles.termsRow}
          onPress={() => setTermsAgreed(v => !v)}
          activeOpacity={0.7}
        >
          <View style={[
            styles.checkbox,
            { borderColor: termsAgreed ? C.tint : C.border, backgroundColor: termsAgreed ? C.tint : "transparent" }
          ]}>
            {termsAgreed && <Feather name="check" size={12} color="#fff" />}
          </View>
          <Text style={[styles.termsText, { color: C.textSecondary }]}>
            {"스윔노트 "}
            <Text
              style={{ color: C.tint, textDecorationLine: "underline" }}
              onPress={(e) => { e.stopPropagation(); router.push("/terms" as any); }}
            >
              이용약관
            </Text>
            {"에 동의합니다 (필수)"}
          </Text>
        </Pressable>

        {/* 가입 버튼 */}
        <Pressable
          style={[styles.submitBtn, { backgroundColor: C.tint, opacity: submitting ? 0.7 : 1 }]}
          onPress={handleRegister}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.submitTxt}>가입하기</Text>
          }
        </Pressable>

        <Pressable style={styles.loginLink} onPress={() => router.replace("/parent-login" as any)}>
          <Text style={[styles.loginLinkTxt, { color: C.textMuted }]}>
            이미 계정이 있으신가요? <Text style={{ color: C.tint }}>로그인</Text>
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header:      { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12 },
  backBtn:     { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontFamily: "Inter_600SemiBold" },
  content:     { paddingHorizontal: 20, paddingTop: 20, gap: 16 },
  infoBox:     { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 10 },
  infoText:    { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  errBox:      { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10 },
  errText:     { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  label:       { fontSize: 13, fontFamily: "Inter_500Medium" },
  inputRow:    { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  input:       { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  termsRow:    { flexDirection: "row", alignItems: "center", gap: 10 },
  checkbox:    { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, justifyContent: "center", alignItems: "center" },
  termsText:   { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  submitBtn:   { height: 52, borderRadius: 12, justifyContent: "center", alignItems: "center", marginTop: 8 },
  submitTxt:   { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  loginLink:   { alignItems: "center", paddingTop: 8 },
  loginLinkTxt:{ fontSize: 13, fontFamily: "Inter_400Regular" },
});
