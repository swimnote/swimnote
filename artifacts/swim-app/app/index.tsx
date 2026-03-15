import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Colors from "@/constants/colors";
import { DEMO_ACCOUNTS, LOGIN_LABELS } from "@/constants/auth";
import { useAuth } from "@/context/AuthContext";
import { QuickLoginCard } from "@/components/auth/QuickLoginCard";
import { AuthEntryLinks } from "@/components/auth/AuthEntryLinks";

const C = Colors.light;

export default function LoginScreen() {
  const { unifiedLogin } = useAuth();
  const insets = useSafeAreaInsets();
  const pwRef = useRef<TextInput>(null);

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword]     = useState("");
  const [showPw, setShowPw]         = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");

  async function handleLogin(overrideId?: string, overridePw?: string) {
    const finalId = (overrideId ?? identifier).trim();
    const finalPw = overridePw ?? password;
    if (!finalId || !finalPw) {
      setError("아이디와 비밀번호를 입력해주세요.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await unifiedLogin(finalId, finalPw);
    } catch (err: unknown) {
      const e = err as Error & { needs_activation?: boolean; teacher_id?: string };
      if (e.needs_activation && e.teacher_id) {
        router.push({ pathname: "/teacher-activate", params: { teacher_id: e.teacher_id } } as any);
        return;
      }
      setError(e.message || "아이디 또는 비밀번호를 확인해주세요.");
    } finally {
      setLoading(false);
    }
  }

  const entryLinks = [
    {
      icon: "briefcase",
      label: "수영장 사업자이신가요?",
      action: "가입 신청",
      onPress: () => router.push("/register" as any),
    },
    {
      icon: "mail",
      label: "선생님으로 초대받으셨나요?",
      action: "초대 코드로 가입",
      onPress: () => router.push("/teacher-invite-join" as any),
    },
    {
      icon: "heart",
      label: "학부모이신가요?",
      action: "학부모 로그인",
      onPress: () => router.push("/parent-login" as any),
    },
  ];

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: C.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          {
            paddingTop: insets.top + (Platform.OS === "web" ? 60 : 48),
            paddingBottom: insets.bottom + 40,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── 로고 영역 ── */}
        <View style={styles.logoArea}>
          <View style={[styles.logoBox, { backgroundColor: C.tint }]}>
            <Feather name="droplet" size={34} color="#fff" />
          </View>
          <Text style={[styles.appName, { color: C.text }]}>{LOGIN_LABELS.appName}</Text>
          <Text style={[styles.appSub, { color: C.textSecondary }]}>{LOGIN_LABELS.appSub}</Text>
          <Text style={[styles.appDesc, { color: C.textMuted }]}>
            운영자, 선생님, 학부모가 하나의 앱에서 연결됩니다
          </Text>
        </View>

        {/* ── 로그인 카드 ── */}
        <View style={[styles.card, { backgroundColor: C.card }]}>
          <Text style={[styles.cardTitle, { color: C.text }]}>로그인</Text>

          {/* 아이디 */}
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>아이디</Text>
            <View style={[styles.inputRow, { borderColor: identifier ? C.tint : C.border, backgroundColor: C.background }]}>
              <Feather name="user" size={16} color={identifier ? C.tint : C.textMuted} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={identifier}
                onChangeText={v => { setIdentifier(v); setError(""); }}
                placeholder="이메일 또는 전화번호"
                placeholderTextColor={C.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                onSubmitEditing={() => pwRef.current?.focus()}
                editable={!loading}
              />
            </View>
          </View>

          {/* 비밀번호 */}
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>비밀번호</Text>
            <View style={[styles.inputRow, { borderColor: password ? C.tint : C.border, backgroundColor: C.background }]}>
              <Feather name="lock" size={16} color={password ? C.tint : C.textMuted} />
              <TextInput
                ref={pwRef}
                style={[styles.input, { color: C.text }]}
                value={password}
                onChangeText={v => { setPassword(v); setError(""); }}
                placeholder="비밀번호를 입력하세요"
                placeholderTextColor={C.textMuted}
                secureTextEntry={!showPw}
                returnKeyType="done"
                onSubmitEditing={() => handleLogin()}
                editable={!loading}
              />
              <Pressable onPress={() => setShowPw(v => !v)} hitSlop={10}>
                <Feather name={showPw ? "eye-off" : "eye"} size={16} color={C.textMuted} />
              </Pressable>
            </View>
          </View>

          {/* 에러 메시지 */}
          {!!error && (
            <View style={[styles.errBox, { backgroundColor: "#FEE2E2" }]}>
              <Feather name="alert-circle" size={14} color={C.error} />
              <Text style={[styles.errText, { color: C.error }]}>{error}</Text>
            </View>
          )}

          {/* 로그인 버튼 */}
          <Pressable
            style={({ pressed }) => [
              styles.loginBtn,
              { backgroundColor: C.tint, opacity: pressed || loading ? 0.85 : 1 },
            ]}
            onPress={() => handleLogin()}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" size="small" />
              : (
                <View style={styles.loginBtnInner}>
                  <Text style={styles.loginBtnText}>로그인</Text>
                  <Feather name="arrow-right" size={18} color="#fff" />
                </View>
              )
            }
          </Pressable>
        </View>

        {/* ── 테스트 계정 빠른 로그인 ── */}
        <View style={styles.demoSection}>
          <View style={styles.demoHeader}>
            <View style={[styles.demoDivider, { backgroundColor: C.border }]} />
            <Text style={[styles.demoTitle, { color: C.textMuted }]}>테스트 계정으로 빠른 로그인</Text>
            <View style={[styles.demoDivider, { backgroundColor: C.border }]} />
          </View>
          <View style={styles.demoGrid}>
            {DEMO_ACCOUNTS.map(acc => (
              <QuickLoginCard
                key={acc.id}
                id={acc.id}
                pw={acc.pw}
                label={acc.label}
                roleKey={acc.roleKey}
                color={acc.color}
                disabled={loading}
                onPress={() => {
                  setIdentifier(acc.id);
                  setPassword(acc.pw);
                  handleLogin(acc.id, acc.pw);
                }}
              />
            ))}
          </View>
        </View>

        {/* ── 하단 진입 링크 ── */}
        <AuthEntryLinks links={entryLinks} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: {
    flexGrow: 1,
    paddingHorizontal: 20,
    gap: 20,
  },

  /* 로고 */
  logoArea: { alignItems: "center", gap: 8, paddingBottom: 4 },
  logoBox: {
    width: 72, height: 72, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#1A5CFF", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 12, elevation: 6,
  },
  appName:  { fontSize: 26, fontFamily: "Inter_700Bold", marginTop: 4 },
  appSub:   { fontSize: 14, fontFamily: "Inter_500Medium" },
  appDesc:  { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 2 },

  /* 로그인 카드 */
  card: {
    borderRadius: 20, padding: 22, gap: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 12, elevation: 4,
  },
  cardTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 2 },
  field:  { gap: 6 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  inputRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, height: 52,
  },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  errBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: 12, borderRadius: 12,
  },
  errText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  loginBtn: { height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 2 },
  loginBtnInner: { flexDirection: "row", alignItems: "center", gap: 8 },
  loginBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },

  /* 테스트 계정 */
  demoSection: { gap: 12 },
  demoHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  demoDivider: { flex: 1, height: 1 },
  demoTitle: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.6 },
  demoGrid: { gap: 8 },
});
