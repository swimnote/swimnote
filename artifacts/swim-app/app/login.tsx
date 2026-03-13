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

export default function LoginScreen() {
  const { adminLogin } = useAuth();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin() {
    if (!email || !password) { setError("이메일과 비밀번호를 입력해주세요."); return; }
    setLoading(true); setError("");
    try {
      await adminLogin(email.trim(), password);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "로그인에 실패했습니다.");
    } finally { setLoading(false); }
  }

  return (
    <KeyboardAvoidingView style={[styles.root, { backgroundColor: C.background }]} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 48), paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">

        <View style={styles.logoArea}>
          <View style={[styles.logoBox, { backgroundColor: C.tint }]}>
            <Feather name="droplet" size={32} color="#fff" />
          </View>
          <Text style={[styles.appName, { color: C.text }]}>수영장 관리 플랫폼</Text>
          <Text style={[styles.appSub, { color: C.textSecondary }]}>B2B 수영장 통합 관리 솔루션</Text>
        </View>

        <View style={[styles.card, { backgroundColor: C.card }]}>
          <Text style={[styles.cardTitle, { color: C.text }]}>관리자 로그인</Text>

          {!!error && (
            <View style={[styles.errBox, { backgroundColor: "#FEE2E2" }]}>
              <Feather name="alert-circle" size={14} color={C.error} />
              <Text style={[styles.errText, { color: C.error }]}>{error}</Text>
            </View>
          )}

          <View style={styles.field}>
            <Text style={[styles.label, { color: C.textSecondary }]}>이메일</Text>
            <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.background }]}>
              <Feather name="mail" size={16} color={C.textMuted} />
              <TextInput style={[styles.input, { color: C.text }]} value={email} onChangeText={setEmail}
                placeholder="이메일" placeholderTextColor={C.textMuted} keyboardType="email-address" autoCapitalize="none" />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: C.textSecondary }]}>비밀번호</Text>
            <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.background }]}>
              <Feather name="lock" size={16} color={C.textMuted} />
              <TextInput style={[styles.input, { color: C.text }]} value={password} onChangeText={setPassword}
                placeholder="비밀번호" placeholderTextColor={C.textMuted} secureTextEntry={!showPw} />
              <Pressable onPress={() => setShowPw(v => !v)}>
                <Feather name={showPw ? "eye-off" : "eye"} size={16} color={C.textMuted} />
              </Pressable>
            </View>
          </View>

          <Pressable style={({ pressed }) => [styles.btn, { backgroundColor: C.tint, opacity: pressed ? 0.85 : 1 }]}
            onPress={handleLogin} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.btnText}>로그인</Text>}
          </Pressable>
        </View>

        <View style={[styles.dividerRow]}>
          <View style={[styles.divider, { backgroundColor: C.border }]} />
          <Text style={[styles.dividerText, { color: C.textMuted }]}>또는</Text>
          <View style={[styles.divider, { backgroundColor: C.border }]} />
        </View>

        <Pressable
          style={({ pressed }) => [styles.parentBtn, { backgroundColor: C.card, borderColor: C.success, opacity: pressed ? 0.85 : 1 }]}
          onPress={() => router.push("/parent-login")}
        >
          <Feather name="smartphone" size={18} color={C.success} />
          <Text style={[styles.parentBtnText, { color: C.success }]}>학부모 로그인 (전화번호 + PIN)</Text>
        </Pressable>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: C.textSecondary }]}>수영장 사업자이신가요?</Text>
          <Pressable onPress={() => router.push("/register")}>
            <Text style={[styles.footerLink, { color: C.tint }]}> 가입 신청하기</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { flexGrow: 1, paddingHorizontal: 24, gap: 20 },
  logoArea: { alignItems: "center", gap: 10 },
  logoBox: { width: 68, height: 68, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  appName: { fontSize: 22, fontFamily: "Inter_700Bold" },
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
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  divider: { flex: 1, height: 1 },
  dividerText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  parentBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, height: 52, borderRadius: 14, borderWidth: 1.5 },
  parentBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  footer: { flexDirection: "row", justifyContent: "center", alignItems: "center" },
  footerText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  footerLink: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
