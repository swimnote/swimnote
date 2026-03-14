import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";

const C = Colors.light;

const DEMO_ACCOUNTS = [
  { id: "1", pw: "1", label: "플랫폼 운영자", icon: "shield" as const, color: "#7C3AED" },
  { id: "2", pw: "2", label: "토이키즈 관리자", icon: "settings" as const, color: "#1A5CFF" },
  { id: "3", pw: "3", label: "토이키즈 선생님", icon: "user" as const, color: "#0891B2" },
  { id: "4", pw: "4", label: "서태웅 학부모", icon: "heart" as const, color: "#059669" },
];

export default function LoginScreen() {
  const { unifiedLogin } = useAuth();
  const insets = useSafeAreaInsets();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin(id?: string, pw?: string) {
    const finalId = id ?? identifier.trim();
    const finalPw = pw ?? password;
    if (!finalId || !finalPw) { setError("아이디와 비밀번호를 입력해주세요."); return; }
    setLoading(true); setError("");
    try {
      await unifiedLogin(finalId, finalPw);
    } catch (err: unknown) {
      const e = err as Error & { needs_activation?: boolean; teacher_id?: string };
      if (e.needs_activation && e.teacher_id) {
        router.push({ pathname: "/teacher-activate", params: { teacher_id: e.teacher_id } });
        return;
      }
      setError(e.message || "로그인에 실패했습니다.");
    } finally { setLoading(false); }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: C.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <Pressable
        onPress={() => router.replace("/")}
        style={[styles.backBtn, { top: insets.top + (Platform.OS === "web" ? 60 : 12) }]}
      >
        <Feather name="arrow-left" size={22} color={C.text} />
      </Pressable>

      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + (Platform.OS === "web" ? 120 : 80), paddingBottom: insets.bottom + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.logoArea}>
          <View style={[styles.logoBox, { backgroundColor: C.tint }]}>
            <Feather name="droplet" size={32} color="#fff" />
          </View>
          <Text style={[styles.appName, { color: C.text }]}>스윔노트</Text>
          <Text style={[styles.appSub, { color: C.textSecondary }]}>수영장 통합 관리 플랫폼</Text>
        </View>

        <View style={[styles.card, { backgroundColor: C.card }]}>
          <Text style={[styles.cardTitle, { color: C.text }]}>로그인</Text>

          {!!error && (
            <View style={[styles.errBox, { backgroundColor: "#FEE2E2" }]}>
              <Feather name="alert-circle" size={14} color={C.error} />
              <Text style={[styles.errText, { color: C.error }]}>{error}</Text>
            </View>
          )}

          <View style={styles.field}>
            <Text style={[styles.label, { color: C.textSecondary }]}>아이디</Text>
            <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.background }]}>
              <Feather name="user" size={16} color={C.textMuted} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={identifier}
                onChangeText={setIdentifier}
                placeholder="아이디 입력"
                placeholderTextColor={C.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: C.textSecondary }]}>비밀번호</Text>
            <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.background }]}>
              <Feather name="lock" size={16} color={C.textMuted} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={password}
                onChangeText={setPassword}
                placeholder="비밀번호 입력"
                placeholderTextColor={C.textMuted}
                secureTextEntry={!showPw}
              />
              <Pressable onPress={() => setShowPw(v => !v)}>
                <Feather name={showPw ? "eye-off" : "eye"} size={16} color={C.textMuted} />
              </Pressable>
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [styles.btn, { backgroundColor: C.tint, opacity: pressed ? 0.85 : 1 }]}
            onPress={() => handleLogin()}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.btnText}>로그인</Text>
            }
          </Pressable>
        </View>

        <View style={[styles.demoSection]}>
          <Text style={[styles.demoTitle, { color: C.textSecondary }]}>테스트 계정으로 빠른 로그인</Text>
          <View style={styles.demoGrid}>
            {DEMO_ACCOUNTS.map(acc => (
              <Pressable
                key={acc.id}
                style={({ pressed }) => [
                  styles.demoBtn,
                  { backgroundColor: C.card, borderColor: acc.color, opacity: pressed ? 0.8 : 1 },
                ]}
                onPress={() => {
                  setIdentifier(acc.id);
                  setPassword(acc.pw);
                  handleLogin(acc.id, acc.pw);
                }}
                disabled={loading}
              >
                <View style={[styles.demoIcon, { backgroundColor: acc.color + "1A" }]}>
                  <Feather name={acc.icon} size={15} color={acc.color} />
                </View>
                <View style={styles.demoTextCol}>
                  <Text style={[styles.demoLabel, { color: C.text }]}>{acc.label}</Text>
                  <Text style={[styles.demoId, { color: C.textMuted }]}>ID: {acc.id} / PW: {acc.pw}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: C.textSecondary }]}>수영장 사업자이신가요?</Text>
          <Pressable onPress={() => router.push("/register")}>
            <Text style={[styles.footerLink, { color: C.tint }]}> 가입 신청하기</Text>
          </Pressable>
        </View>
        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: C.textSecondary }]}>선생님으로 초대받으셨나요?</Text>
          <Pressable onPress={() => router.push("/teacher-invite-join")}>
            <Text style={[styles.footerLink, { color: C.tint }]}> 초대 코드로 가입</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { flexGrow: 1, paddingHorizontal: 24, gap: 20 },
  backBtn: { position: "absolute", left: 16, zIndex: 10, width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  logoArea: { alignItems: "center", gap: 10 },
  logoBox: { width: 68, height: 68, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  appName: { fontSize: 24, fontFamily: "Inter_700Bold" },
  appSub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  card: { borderRadius: 18, padding: 22, gap: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 3 },
  cardTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  errBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10 },
  errText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  field: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, height: 48 },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  btn: { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  btnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  demoSection: { gap: 12 },
  demoTitle: { fontSize: 12, fontFamily: "Inter_500Medium", textAlign: "center" },
  demoGrid: { gap: 8 },
  demoBtn: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, borderWidth: 1.5 },
  demoIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  demoTextCol: { flex: 1, gap: 2 },
  demoLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  demoId: { fontSize: 11, fontFamily: "Inter_400Regular" },
  footer: { flexDirection: "row", justifyContent: "center", alignItems: "center" },
  footerText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  footerLink: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
