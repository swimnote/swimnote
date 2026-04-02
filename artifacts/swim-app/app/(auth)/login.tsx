/**
 * (auth)/login.tsx — 관리자/선생님 비밀번호 입력 화면
 * 역할: 인증 1단계만 담당
 * - TOTP UI 제거 → otp-verify.tsx로 분리
 * - TOTP 필요 시 /otp-verify?session=... 로 이동
 * - 역할 선택 → org-role-select.tsx로 분리
 */
import { ArrowLeft, CircleAlert, Lock, User } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { LOGIN_LABELS } from "@/constants/auth";
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
      const e = err as Error & {
        needs_activation?: boolean;
        teacher_id?: string;
        totp_required?: boolean;
        totp_session?: string;
      };
      if (e.needs_activation && e.teacher_id) {
        router.push({ pathname: "/teacher-activate", params: { teacher_id: e.teacher_id } } as any);
        return;
      }
      if (e.totp_required && e.totp_session) {
        router.push({ pathname: "/otp-verify", params: { session: e.totp_session } } as any);
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
      behavior={Platform.OS === "ios" ? "padding" : undefined}
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
            <ArrowLeft size={22} color={C.text} />
          </Pressable>
          <View style={styles.idChip}>
            <User size={13} color={C.tint} />
            <Text style={[styles.idChipText, { color: C.tint }]} numberOfLines={1}>{identifier}</Text>
            <Pressable onPress={() => router.replace("/")} style={{ marginLeft: 2 }}>
              <Text style={[styles.changeIdText, { color: C.textMuted }]}>{LOGIN_LABELS.backToId}</Text>
            </Pressable>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: C.card }]}>
          <Text style={[styles.cardTitle, { color: C.text }]}>비밀번호 입력</Text>

          {!!error && (
            <View style={[styles.errBox, { backgroundColor: "#F9DEDA" }]}>
              <CircleAlert size={14} color={C.error} />
              <Text style={[styles.errText, { color: C.error }]}>{error}</Text>
            </View>
          )}

          <View style={styles.field}>
            <Text style={[styles.label, { color: C.textSecondary }]}>{LOGIN_LABELS.passwordInput.label}</Text>
            <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.background }]}>
              <Lock size={16} color={C.textMuted} />
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
                <LucideIcon name={showPw ? "eye-off" : "eye"} size={16} color={C.textMuted} />
              </Pressable>
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [styles.btn, { backgroundColor: C.button, opacity: pressed ? 0.85 : 1 }]}
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
    backgroundColor: "#E6FFFA", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7,
  },
  idChipText: { fontSize: 14, fontFamily: "Pretendard-Regular", flex: 1 },
  changeIdText: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  card: {
    borderRadius: 20, padding: 22, gap: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  cardTitle: { fontSize: 18, fontFamily: "Pretendard-Regular" },
  errBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10 },
  errText: { fontSize: 13, fontFamily: "Pretendard-Regular", flex: 1 },
  field: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  inputRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 12, height: 52,
  },
  input: { flex: 1, fontSize: 15, fontFamily: "Pretendard-Regular" },
  btn: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  btnText: { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" },
  forgotRow: { alignItems: "center", paddingVertical: 4 },
  forgotText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
});
