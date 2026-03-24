import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useRef, useState } from "react";
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
  const { unifiedLogin, completeTotpLogin } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();

  const [identifier, setIdentifier] = useState(id || "");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [inviteCode, setInviteCode] = useState("");
  const [showInvite, setShowInvite] = useState(false);

  // TOTP 상태
  const [totpRequired, setTotpRequired] = useState(false);
  const [totpSession, setTotpSession] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const otpInputRef = useRef<TextInput>(null);

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
        setTotpRequired(true);
        setTotpSession(e.totp_session);
        setLoading(false);
        setTimeout(() => otpInputRef.current?.focus(), 300);
        return;
      }
      setError(e.message || "로그인에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function handleOtpVerify() {
    const code = otpCode.replace(/\s/g, "");
    if (code.length !== 6) {
      setError("6자리 코드를 입력해주세요.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await completeTotpLogin(totpSession, code);
    } catch (err: unknown) {
      const e = err as Error;
      setError(e.message || "OTP 인증에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  function handleOtpChange(v: string) {
    const digits = v.replace(/\D/g, "").slice(0, 6);
    setOtpCode(digits);
    setError("");
  }

  function resetToPassword() {
    setTotpRequired(false);
    setTotpSession("");
    setOtpCode("");
    setError("");
  }

  if (totpRequired) {
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
            <Pressable onPress={resetToPassword} style={styles.backBtn}>
              <Feather name="arrow-left" size={22} color={C.text} />
            </Pressable>
            <View style={[styles.idChip, { backgroundColor: "#EDE9FE" }]}>
              <Feather name="shield" size={13} color="#7C3AED" />
              <Text style={[styles.idChipText, { color: "#7C3AED" }]} numberOfLines={1}>2단계 인증</Text>
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: C.card }]}>
            <View style={styles.otpIconRow}>
              <View style={[styles.otpIconBg, { backgroundColor: "#EDE9FE" }]}>
                <Feather name="smartphone" size={28} color="#7C3AED" />
              </View>
            </View>

            <Text style={[styles.cardTitle, { color: C.text }]}>Google OTP 인증</Text>
            <Text style={[styles.otpDesc, { color: C.textSecondary }]}>
              Google Authenticator 앱에서{"\n"}6자리 코드를 입력해주세요.
            </Text>

            {!!error && (
              <View style={[styles.errBox, { backgroundColor: "#F9DEDA" }]}>
                <Feather name="alert-circle" size={14} color={C.error} />
                <Text style={[styles.errText, { color: C.error }]}>{error}</Text>
              </View>
            )}

            <View style={styles.otpBoxRow}>
              {Array.from({ length: 6 }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.otpBox,
                    {
                      borderColor: otpCode.length === i ? "#7C3AED" : otpCode[i] ? "#7C3AED" : C.border,
                      backgroundColor: otpCode[i] ? "#EDE9FE" : C.background,
                    },
                  ]}
                >
                  <Text style={[styles.otpBoxText, { color: "#7C3AED" }]}>{otpCode[i] || ""}</Text>
                </View>
              ))}
            </View>

            <TextInput
              ref={otpInputRef}
              style={styles.hiddenInput}
              value={otpCode}
              onChangeText={handleOtpChange}
              keyboardType="number-pad"
              maxLength={6}
              returnKeyType="done"
              onSubmitEditing={handleOtpVerify}
              autoFocus
            />

            <Pressable
              style={[styles.otpBoxRow, { justifyContent: "center", marginTop: -8 }]}
              onPress={() => otpInputRef.current?.focus()}
            >
              <Text style={[styles.otpTapHint, { color: C.textMuted }]}>숫자 박스를 탭하여 키보드 열기</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.btn,
                { backgroundColor: otpCode.length === 6 ? "#7C3AED" : C.border, opacity: pressed ? 0.85 : 1 },
              ]}
              onPress={handleOtpVerify}
              disabled={loading || otpCode.length !== 6}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.btnText}>인증 완료</Text>
              }
            </Pressable>

            <Pressable style={styles.forgotRow} onPress={resetToPassword}>
              <Text style={[styles.forgotText, { color: C.textMuted }]}>← 비밀번호 입력으로 돌아가기</Text>
            </Pressable>
          </View>

          <View style={[styles.otpGuideCard, { backgroundColor: "#F5F3FF", borderColor: "#DDD6FE" }]}>
            <Feather name="info" size={14} color="#7C3AED" />
            <Text style={[styles.otpGuideText, { color: "#5B21B6" }]}>
              Google Authenticator 앱을 열고 계정 이름 옆의 6자리 숫자를 입력하세요. 코드는 30초마다 갱신됩니다.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
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
            <View style={[styles.errBox, { backgroundColor: "#F9DEDA" }]}>
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
    backgroundColor: "#DDF2EF", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7,
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
  inviteCard: { borderRadius: 16, padding: 16, gap: 12, borderWidth: 1 },
  inviteHelper: { fontSize: 12, fontFamily: "Inter_400Regular" },
  inviteRow: { flexDirection: "row", gap: 8 },
  inviteInput: { flex: 1 },
  inviteBtn: {
    height: 52, paddingHorizontal: 16, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
  inviteBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  // TOTP 스타일
  otpIconRow: { alignItems: "center", paddingVertical: 4 },
  otpIconBg: { width: 68, height: 68, borderRadius: 34, alignItems: "center", justifyContent: "center" },
  otpDesc: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
  otpBoxRow: { flexDirection: "row", gap: 8, justifyContent: "center" },
  otpBox: {
    width: 44, height: 52, borderRadius: 12, borderWidth: 2,
    alignItems: "center", justifyContent: "center",
  },
  otpBoxText: { fontSize: 22, fontFamily: "Inter_700Bold" },
  hiddenInput: { position: "absolute", opacity: 0, width: 1, height: 1 },
  otpTapHint: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center" },
  otpGuideCard: {
    flexDirection: "row", gap: 8, padding: 14, borderRadius: 14, borderWidth: 1, alignItems: "flex-start",
  },
  otpGuideText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 18 },
});
