import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { LOGIN_LABELS, DEMO_ACCOUNTS } from "@/constants/auth";
import { useAuth } from "@/context/AuthContext";

const C = Colors.light;

export default function LoginPasswordScreen() {
  const { unifiedLogin } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();

  const [identifier, setIdentifier] = useState(id || "");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [inviteCode, setInviteCode] = useState("");
  const [showInvite, setShowInvite] = useState(false);

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
      setError(e.message || "로그인에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: C.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + (Platform.OS === "web" ? 70 : 50), paddingBottom: insets.bottom + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.topRow}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={22} color={C.text} />
          </Pressable>
          <View style={styles.idChip}>
            <Feather name="user" size={13} color={C.tint} />
            <Text style={[styles.idChipText, { color: C.tint }]} numberOfLines={1}>{identifier}</Text>
            <Pressable onPress={() => router.replace("/")} style={{ marginLeft: 2 }}>
              <Text style={[styles.changeIdText, { color: C.textMuted }]}>{LOGIN_LABELS.backToId}</Text>
            </Pressable>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: C.card }]}>
          <Text style={[styles.cardTitle, { color: C.text }]}>비밀번호 입력</Text>

          {!!error && (
            <View style={[styles.errBox, { backgroundColor: "#FEE2E2" }]}>
              <Feather name="alert-circle" size={14} color={C.error} />
              <Text style={[styles.errText, { color: C.error }]}>{error}</Text>
            </View>
          )}

          <View style={styles.field}>
            <Text style={[styles.label, { color: C.textSecondary }]}>{LOGIN_LABELS.passwordInput.label}</Text>
            <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.background }]}>
              <Feather name="lock" size={16} color={C.textMuted} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={password}
                onChangeText={v => { setPassword(v); setError(""); }}
                placeholder={LOGIN_LABELS.passwordInput.placeholder}
                placeholderTextColor={C.textMuted}
                secureTextEntry={!showPw}
                returnKeyType="done"
                onSubmitEditing={() => handleLogin()}
                autoFocus
              />
              <Pressable onPress={() => setShowPw(v => !v)} hitSlop={8}>
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
              : <Text style={styles.btnText}>{LOGIN_LABELS.loginBtn}</Text>
            }
          </Pressable>

          <Pressable style={styles.forgotRow}>
            <Text style={[styles.forgotText, { color: C.textMuted }]}>{LOGIN_LABELS.forgotPw}</Text>
          </Pressable>
        </View>

        <Pressable
          style={[styles.inviteToggle, { borderColor: C.border }]}
          onPress={() => setShowInvite(v => !v)}
        >
          <Feather name="link" size={15} color={C.textSecondary} />
          <Text style={[styles.inviteToggleText, { color: C.textSecondary }]}>{LOGIN_LABELS.inviteCode.sectionTitle}</Text>
          <Feather name={showInvite ? "chevron-up" : "chevron-down"} size={15} color={C.textMuted} />
        </Pressable>

        {showInvite && (
          <View style={[styles.inviteCard, { backgroundColor: C.card, borderColor: C.border }]}>
            <Text style={[styles.inviteHelper, { color: C.textSecondary }]}>{LOGIN_LABELS.inviteCode.helper}</Text>
            <View style={styles.inviteRow}>
              <View style={[styles.inputRow, styles.inviteInput, { borderColor: C.border, backgroundColor: C.background }]}>
                <Feather name="hash" size={15} color={C.textMuted} />
                <TextInput
                  style={[styles.input, { color: C.text }]}
                  value={inviteCode}
                  onChangeText={setInviteCode}
                  placeholder={LOGIN_LABELS.inviteCode.placeholder}
                  placeholderTextColor={C.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <Pressable
                style={({ pressed }) => [styles.inviteBtn, { backgroundColor: C.tint, opacity: pressed ? 0.85 : 1 }]}
              >
                <Text style={styles.inviteBtnText}>{LOGIN_LABELS.inviteCode.btn}</Text>
              </Pressable>
            </View>
          </View>
        )}

        <View style={[styles.demoSection]}>
          <Text style={[styles.demoTitle, { color: C.textMuted }]}>테스트 계정으로 빠른 로그인</Text>
          <View style={styles.demoGrid}>
            {DEMO_ACCOUNTS.map(acc => (
              <Pressable
                key={acc.id}
                style={({ pressed }) => [
                  styles.demoBtn,
                  { backgroundColor: C.card, borderColor: acc.color + "55", opacity: pressed ? 0.8 : 1 },
                ]}
                onPress={() => {
                  setIdentifier(acc.id);
                  setPassword(acc.pw);
                  handleLogin(acc.id, acc.pw);
                }}
                disabled={loading}
              >
                <View style={[styles.demoIcon, { backgroundColor: acc.color + "20" }]}>
                  <Feather name="user" size={14} color={acc.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.demoLabel, { color: C.text }]}>{acc.label}</Text>
                  <Text style={[styles.demoId, { color: C.textMuted }]}>ID: {acc.id} / PW: {acc.pw}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { flexGrow: 1, paddingHorizontal: 24, gap: 18 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  idChip: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#EEF3FF", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7,
  },
  idChipText: { fontSize: 14, fontFamily: "Inter_600SemiBold", flex: 1 },
  changeIdText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  card: {
    borderRadius: 20, padding: 22, gap: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  cardTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  errBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10 },
  errText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  field: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  inputRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 12, height: 52,
  },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  btn: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  btnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  forgotRow: { alignItems: "center", paddingVertical: 4 },
  forgotText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  inviteToggle: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: 14, borderRadius: 14, borderWidth: 1.5,
  },
  inviteToggleText: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  inviteCard: {
    borderRadius: 16, padding: 16, gap: 12, borderWidth: 1,
  },
  inviteHelper: { fontSize: 12, fontFamily: "Inter_400Regular" },
  inviteRow: { flexDirection: "row", gap: 8 },
  inviteInput: { flex: 1 },
  inviteBtn: {
    height: 52, paddingHorizontal: 16, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
  inviteBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  demoSection: { gap: 10 },
  demoTitle: { fontSize: 11, fontFamily: "Inter_500Medium", textAlign: "center", textTransform: "uppercase", letterSpacing: 0.5 },
  demoGrid: { gap: 8 },
  demoBtn: { flexDirection: "row", alignItems: "center", gap: 10, padding: 11, borderRadius: 12, borderWidth: 1.5 },
  demoIcon: { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  demoLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  demoId: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
});
