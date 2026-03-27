import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView,
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

import { API_BASE } from "@/context/AuthContext";

const C = Colors.light;

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ identifier?: string }>();
  const pwRef = useRef<TextInput>(null);
  const pw2Ref = useRef<TextInput>(null);

  const [step, setStep] = useState<"id" | "pw" | "done">("id");
  const [identifier, setIdentifier] = useState(params.identifier || "");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
      setStep("pw");
    } catch { setError("서버 오류가 발생했습니다."); } finally { setLoading(false); }
  }

  async function resetPassword() {
    if (!newPw || newPw.length < 6) { setError("비밀번호는 6자 이상이어야 합니다."); return; }
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
          <Pressable style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]} onPress={() => (step === "pw" ? setStep("id") : router.back())}>
            <Feather name="arrow-left" size={20} color={C.text} />
          </Pressable>
          <Text style={[styles.screenTitle, { color: C.text }]}>비밀번호 찾기</Text>
          <View style={{ width: 28 }} />
        </View>

        {/* 완료 화면 */}
        {step === "done" && (
          <View style={styles.doneWrap}>
            <View style={[styles.doneIcon, { backgroundColor: "#DFF3EC" }]}>
              <Feather name="check-circle" size={40} color="#2E9B6F" />
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
            <View style={[styles.iconWrap, { backgroundColor: "#FFF1BF" }]}>
              <Feather name="key" size={24} color="#D97706" />
            </View>
            <Text style={[styles.cardTitle, { color: C.text }]}>아이디 확인</Text>
            <Text style={[styles.cardDesc, { color: C.textSecondary }]}>
              가입하신 이메일 또는 전화번호를 입력해주세요.
            </Text>

            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>아이디</Text>
              <View style={[styles.inputRow, { borderColor: identifier ? C.tint : C.border, backgroundColor: C.background }]}>
                <Feather name="user" size={15} color={identifier ? C.tint : C.textMuted} />
                <TextInput
                  style={[styles.input, { color: C.text }]}
                  value={identifier}
                  onChangeText={v => { setIdentifier(v); setError(""); }}
                  placeholder="이메일 또는 전화번호"
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
                <Feather name="alert-circle" size={14} color={C.error} />
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

        {/* 단계 2: 새 비밀번호 설정 */}
        {step === "pw" && (
          <View style={[styles.card, { backgroundColor: C.card }]}>
            <View style={[styles.iconWrap, { backgroundColor: "#EFF4FF" }]}>
              <Feather name="lock" size={24} color={C.tint} />
            </View>
            <Text style={[styles.cardTitle, { color: C.text }]}>새 비밀번호 설정</Text>
            <View style={[styles.idBadge, { backgroundColor: C.background, borderColor: C.border }]}>
              <Feather name="user" size={13} color={C.textMuted} />
              <Text style={[styles.idBadgeText, { color: C.textSecondary }]}>{identifier}</Text>
            </View>

            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>새 비밀번호</Text>
              <View style={[styles.inputRow, { borderColor: newPw ? C.tint : C.border, backgroundColor: C.background }]}>
                <Feather name="lock" size={15} color={newPw ? C.tint : C.textMuted} />
                <TextInput
                  ref={pwRef}
                  style={[styles.input, { color: C.text }]}
                  value={newPw}
                  onChangeText={v => { setNewPw(v); setError(""); }}
                  placeholder="6자리 이상"
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
              <View style={[styles.inputRow, { borderColor: newPw2 ? C.tint : C.border, backgroundColor: C.background }]}>
                <Feather name="lock" size={15} color={newPw2 ? C.tint : C.textMuted} />
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
                <Feather name="alert-circle" size={14} color={C.error} />
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
  screenTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  card: {
    borderRadius: 20, padding: 22, gap: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 12, elevation: 4,
  },
  iconWrap: { width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 4 },
  cardTitle: { fontSize: 20, fontFamily: "Inter_700Bold", textAlign: "center" },
  cardDesc: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20, marginTop: -6 },
  idBadge: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  idBadgeText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  inputRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, height: 52,
  },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  errBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12 },
  errText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  submitBtn: { height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 2 },
  submitBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },
  /* 완료 */
  doneWrap: { alignItems: "center", gap: 16, paddingTop: 40 },
  doneIcon: { width: 80, height: 80, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  doneTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
  doneDesc: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22, color: "#6B7280" },
});
