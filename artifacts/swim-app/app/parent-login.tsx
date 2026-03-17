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

export default function ParentLoginScreen() {
  const { parentLogin } = useAuth();
  const insets = useSafeAreaInsets();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin() {
    if (!identifier.trim()) { setError("아이디 또는 전화번호를 입력해주세요."); return; }
    if (password.length < 4) { setError("비밀번호는 4자리 이상이어야 합니다."); return; }
    setLoading(true); setError("");
    try {
      await parentLogin(identifier.trim(), password);
    } catch (err: unknown) {
      const e = err as Error & { error_code?: string };
      if (e.error_code === "pending_pool_request") {
        setError("가입 요청이 승인 대기 중입니다.\n수영장 관리자 승인 후 로그인 가능합니다.");
      } else {
        setError(e.message || "로그인에 실패했습니다.");
      }
    } finally { setLoading(false); }
  }

  return (
    <KeyboardAvoidingView style={[styles.root, { backgroundColor: C.background }]} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 24), paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">

        <Pressable onPress={() => router.back()} style={styles.back}>
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>

        <View style={styles.header}>
          <View style={[styles.iconBox, { backgroundColor: "#D1FAE5" }]}>
            <Feather name="user" size={30} color={C.success} />
          </View>
          <Text style={[styles.title, { color: C.text }]}>학부모 로그인</Text>
          <Text style={[styles.sub, { color: C.textSecondary }]}>
            가입 시 설정한{"\n"}아이디(또는 전화번호)와 비밀번호로 로그인하세요
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: C.card }]}>
          {!!error && (
            <View style={[styles.errBox, { backgroundColor: "#FEE2E2" }]}>
              <Feather name="alert-circle" size={14} color={C.error} />
              <Text style={[styles.errText, { color: C.error }]}>{error}</Text>
            </View>
          )}

          <View style={styles.field}>
            <Text style={[styles.label, { color: C.textSecondary }]}>아이디 또는 전화번호</Text>
            <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.background }]}>
              <Feather name="user" size={16} color={C.textMuted} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={identifier}
                onChangeText={v => { setIdentifier(v); setError(""); }}
                placeholder="아이디 또는 010-0000-0000"
                placeholderTextColor={C.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
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
                onChangeText={v => { setPassword(v); setError(""); }}
                placeholder="비밀번호 입력"
                placeholderTextColor={C.textMuted}
                secureTextEntry={!showPw}
                returnKeyType="done"
                onSubmitEditing={handleLogin}
              />
              <Pressable onPress={() => setShowPw(v => !v)} hitSlop={10}>
                <Feather name={showPw ? "eye-off" : "eye"} size={16} color={C.textMuted} />
              </Pressable>
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [styles.btn, { backgroundColor: C.success, opacity: pressed ? 0.85 : 1 }]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? <ActivityIndicator color="#fff" size="small" /> : (
              <View style={styles.btnContent}>
                <Feather name="log-in" size={18} color="#fff" />
                <Text style={styles.btnText}>로그인</Text>
              </View>
            )}
          </Pressable>
        </View>

        <Pressable
          style={({ pressed }) => [styles.joinRequestBtn, { backgroundColor: C.card, borderColor: C.border, opacity: pressed ? 0.8 : 1 }]}
          onPress={() => router.push("/pool-join-request")}
        >
          <View style={[styles.joinIconBox, { backgroundColor: C.tintLight }]}>
            <Feather name="user-plus" size={18} color={C.tint} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.joinBtnTitle, { color: C.text }]}>수영장 가입 요청</Text>
            <Text style={[styles.joinBtnSub, { color: C.textSecondary }]}>수영장을 검색하고 가입 요청을 보내세요</Text>
          </View>
          <Feather name="chevron-right" size={18} color={C.textMuted} />
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { flexGrow: 1, paddingHorizontal: 24, gap: 24 },
  back: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  header: { alignItems: "center", gap: 12 },
  iconBox: { width: 72, height: 72, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
  card: { borderRadius: 18, padding: 22, gap: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 3 },
  errBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10 },
  errText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  field: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, height: 50 },
  input: { flex: 1, fontSize: 16, fontFamily: "Inter_400Regular" },
  btn: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  btnContent: { flexDirection: "row", alignItems: "center", gap: 8 },
  btnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  joinRequestBtn: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 16, borderWidth: 1.5 },
  joinIconBox: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  joinBtnTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  joinBtnSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
