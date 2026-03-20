import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Colors from "@/constants/colors";
import { DEMO_ACCOUNTS, LOGIN_LABELS } from "@/constants/auth";
import { useAuth } from "@/context/AuthContext";
import { QuickLoginCard } from "@/components/auth/QuickLoginCard";

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
  const [failCount, setFailCount]   = useState(0);
  const [showNotFoundModal, setShowNotFoundModal] = useState(false);

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
      setFailCount(0);
    } catch (err: unknown) {
      const e = err as Error & { needs_activation?: boolean; teacher_id?: string; error_code?: string };
      if (e.error_code === "pending_pool_request") {
        setError("가입 요청이 승인 대기 중입니다.\n수영장 관리자 승인 후 로그인 가능합니다.");
        return;
      }
      if (e.error_code === "pending_teacher_approval") {
        setError("관리자 승인 대기 중입니다. 수영장 관리자가 승인하면 로그인할 수 있습니다.");
        return;
      }
      if (e.needs_activation && e.teacher_id) {
        router.push({ pathname: "/teacher-activate", params: { teacher_id: e.teacher_id } } as any);
        return;
      }
      if (e.error_code === "user_not_found") {
        setShowNotFoundModal(true);
        return;
      }
      if (e.error_code === "wrong_password") {
        const nextCount = failCount + 1;
        setFailCount(nextCount);
        setError("아이디 또는 비밀번호가 올바르지 않습니다.");
        return;
      }
      setError(e.message || "아이디 또는 비밀번호를 확인해주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: C.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 60 : 48), paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── 로고 ── */}
        <View style={styles.logoArea}>
          <View style={[styles.logoBox, { backgroundColor: C.tint }]}>
            <Feather name="droplet" size={34} color="#fff" />
          </View>
          <Text style={[styles.appName, { color: C.text }]}>{LOGIN_LABELS.appName}</Text>
          <Text style={[styles.appSub, { color: C.textSecondary }]}>{LOGIN_LABELS.appSub}</Text>
          <Text style={[styles.appDesc, { color: C.textMuted }]}>
            수영장 · 선생님 · 학부모가 하나로 연결됩니다
          </Text>
        </View>

        {/* ── 로그인 카드 ── */}
        <View style={[styles.card, { backgroundColor: C.card }]}>
          <Text style={[styles.cardTitle, { color: C.text }]}>로그인</Text>

          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>아이디</Text>
            <View style={[styles.inputRow, { borderColor: identifier ? C.tint : C.border, backgroundColor: C.background }]}>
              <Feather name="user" size={16} color={identifier ? C.tint : C.textMuted} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={identifier}
                onChangeText={v => { setIdentifier(v); setError(""); setFailCount(0); }}
                placeholder="아이디 또는 전화번호"
                placeholderTextColor={C.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                onSubmitEditing={() => pwRef.current?.focus()}
                editable={!loading}
              />
            </View>
          </View>

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

          {!!error && (
            <View style={[styles.errBox, { backgroundColor: "#FEE2E2" }]}>
              <Feather name="alert-circle" size={14} color={C.error} />
              <Text style={[styles.errText, { color: C.error }]}>{error}</Text>
            </View>
          )}

          <Pressable
            style={({ pressed }) => [styles.loginBtn, { backgroundColor: C.tint, opacity: pressed || loading ? 0.85 : 1 }]}
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

          {/* ── 비밀번호 찾기 (항상 노출) ── */}
          <Pressable
            style={({ pressed }) => [styles.forgotBtn, { opacity: pressed ? 0.7 : 1 }]}
            onPress={() => router.push({ pathname: "/forgot-password", params: { identifier } } as any)}
          >
            <Feather name="key" size={13} color={C.textMuted} />
            <Text style={[styles.forgotText, { color: C.textMuted }]}>비밀번호를 잊으셨나요?</Text>
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

        {/* ── 회원가입 ── */}
        <View style={styles.signupRow}>
          <Text style={[styles.signupLabel, { color: C.textSecondary }]}>아직 계정이 없으신가요?</Text>
          <Pressable
            style={({ pressed }) => [styles.signupBtn, { opacity: pressed ? 0.7 : 1 }]}
            onPress={() => router.push("/signup-role" as any)}
          >
            <Text style={[styles.signupBtnText, { color: C.tint }]}>회원가입</Text>
            <Feather name="arrow-right" size={14} color={C.tint} />
          </Pressable>
        </View>
      </ScrollView>

      {/* ── 계정 없음 모달 ── */}
      <Modal
        transparent
        visible={showNotFoundModal}
        animationType="fade"
        onRequestClose={() => setShowNotFoundModal(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowNotFoundModal(false)}>
          <Pressable style={[styles.modalCard, { backgroundColor: C.card }]} onPress={e => e.stopPropagation()}>
            <View style={[styles.modalIconWrap, { backgroundColor: "#FEF3C7" }]}>
              <Feather name="user-x" size={26} color="#D97706" />
            </View>
            <Text style={[styles.modalTitle, { color: C.text }]}>가입된 계정이 없습니다</Text>
            <Text style={[styles.modalDesc, { color: C.textSecondary }]}>
              입력하신 아이디로 등록된 계정이 없습니다.{"\n"}
              아이디를 다시 확인하거나, 새로 가입해주세요.
            </Text>
            <View style={styles.modalBtns}>
              <Pressable
                style={({ pressed }) => [styles.modalBtn, styles.modalBtnSecondary, { borderColor: C.border, opacity: pressed ? 0.7 : 1 }]}
                onPress={() => setShowNotFoundModal(false)}
              >
                <Text style={[styles.modalBtnText, { color: C.textSecondary }]}>다시 입력</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.modalBtn, { backgroundColor: C.tint, opacity: pressed ? 0.85 : 1 }]}
                onPress={() => { setShowNotFoundModal(false); router.push("/signup-role" as any); }}
              >
                <Text style={[styles.modalBtnText, { color: "#fff" }]}>회원가입하기</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { flexGrow: 1, paddingHorizontal: 20, gap: 20 },
  logoArea: { alignItems: "center", gap: 8, paddingBottom: 4 },
  logoBox: { width: 72, height: 72, borderRadius: 22, alignItems: "center", justifyContent: "center", shadowColor: "#1A5CFF", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 12, elevation: 6 },
  appName: { fontSize: 26, fontFamily: "Inter_700Bold", marginTop: 4 },
  appSub: { fontSize: 14, fontFamily: "Inter_500Medium" },
  appDesc: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 2 },
  card: { borderRadius: 20, padding: 22, gap: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 12, elevation: 4 },
  cardTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 2 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, height: 52 },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  errBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12 },
  errText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  loginBtn: { height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 2 },
  loginBtnInner: { flexDirection: "row", alignItems: "center", gap: 8 },
  loginBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },
  forgotBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center", paddingVertical: 4 },
  forgotText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  demoSection: { gap: 12 },
  demoHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  demoDivider: { flex: 1, height: 1 },
  demoTitle: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.6 },
  demoGrid: { gap: 8 },
  signupRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  signupLabel: { fontSize: 14, fontFamily: "Inter_400Regular" },
  signupBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4 },
  signupBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  modalCard: { width: 300, borderRadius: 22, padding: 24, alignItems: "center", gap: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 10 },
  modalIconWrap: { width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  modalTitle: { fontSize: 17, fontFamily: "Inter_700Bold", textAlign: "center" },
  modalDesc: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  modalBtns: { flexDirection: "row", gap: 10, marginTop: 6, width: "100%" },
  modalBtn: { flex: 1, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  modalBtnSecondary: { borderWidth: 1.5 },
  modalBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
