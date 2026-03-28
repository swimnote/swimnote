/**
 * otp-verify.tsx — 로그인 중 TOTP 2단계 인증 화면
 * login.tsx에서 분리: 비밀번호 입력 후 totp_required 상태일 때 이 화면으로 이동
 * params: totpSession (서버에서 발급한 임시 세션 ID)
 */
import { ArrowLeft, CircleAlert, Info, Shield, Smartphone } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import React, { useRef, useState, createRef } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";

const C = Colors.light;

export default function OtpVerifyScreen() {
  const { completeTotpLogin } = useAuth();
  const { session: totpSession } = useLocalSearchParams<{ session: string }>();
  const insets = useSafeAreaInsets();

  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const digitRefs = useRef<Array<React.RefObject<TextInput>>>(
    Array.from({ length: 6 }, () => createRef<TextInput>())
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const otpCode = digits.join("");

  async function handleVerify() {
    const code = digits.join("");
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
      setDigits(["", "", "", "", "", ""]);
      setTimeout(() => digitRefs.current[0].current?.focus(), 100);
    } finally {
      setLoading(false);
    }
  }

  function handleDigitChange(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    setError("");
    if (digit && index < 5) {
      digitRefs.current[index + 1].current?.focus();
    }
    if (digit && index === 5) {
      digitRefs.current[5].current?.blur();
    }
  }

  function handleDigitKeyPress(index: number, key: string) {
    if (key === "Backspace" && !digits[index] && index > 0) {
      const next = [...digits];
      next[index - 1] = "";
      setDigits(next);
      digitRefs.current[index - 1].current?.focus();
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
            <ArrowLeft size={22} color={C.text} />
          </Pressable>
          <View style={[styles.idChip, { backgroundColor: "#E6FAF8" }]}>
            <Shield size={13} color="#7C3AED" />
            <Text style={[styles.idChipText, { color: "#7C3AED" }]} numberOfLines={1}>2단계 인증</Text>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: C.card }]}>
          <View style={styles.otpIconRow}>
            <View style={[styles.otpIconBg, { backgroundColor: "#E6FAF8" }]}>
              <Smartphone size={28} color="#7C3AED" />
            </View>
          </View>

          <Text style={[styles.cardTitle, { color: C.text }]}>Google OTP 인증</Text>
          <Text style={[styles.otpDesc, { color: C.textSecondary }]}>
            Google Authenticator 앱에서{"\n"}6자리 코드를 입력해주세요.
          </Text>

          {!!error && (
            <View style={[styles.errBox, { backgroundColor: "#F9DEDA" }]}>
              <CircleAlert size={14} color={C.error} />
              <Text style={[styles.errText, { color: C.error }]}>{error}</Text>
            </View>
          )}

          <View style={styles.otpBoxRow}>
            {digits.map((d, i) => (
              <TextInput
                key={i}
                ref={digitRefs.current[i]}
                style={[
                  styles.otpBox,
                  {
                    borderColor: d ? "#7C3AED" : C.border,
                    backgroundColor: d ? "#E6FAF8" : C.background,
                    fontSize: 22,
                    fontFamily: "Pretendard-SemiBold",
                    color: "#7C3AED",
                    textAlign: "center",
                  },
                ]}
                value={d}
                onChangeText={(v) => handleDigitChange(i, v)}
                onKeyPress={({ nativeEvent }) => handleDigitKeyPress(i, nativeEvent.key)}
                keyboardType="number-pad"
                maxLength={2}
                returnKeyType={i === 5 ? "done" : "next"}
                onSubmitEditing={i === 5 ? handleVerify : undefined}
                autoFocus={i === 0}
                selectTextOnFocus
              />
            ))}
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.btn,
              { backgroundColor: otpCode.length === 6 ? "#7C3AED" : C.border, opacity: pressed ? 0.85 : 1 },
            ]}
            onPress={handleVerify}
            disabled={loading || otpCode.length !== 6}
          >
            {loading
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.btnText}>인증 완료</Text>
            }
          </Pressable>

          <Pressable style={styles.forgotRow} onPress={() => router.back()}>
            <Text style={[styles.forgotText, { color: C.textMuted }]}>← 비밀번호 입력으로 돌아가기</Text>
          </Pressable>
        </View>

        <View style={[styles.otpGuideCard, { backgroundColor: "#F5F3FF", borderColor: "#E6FAF8" }]}>
          <Info size={14} color="#7C3AED" />
          <Text style={[styles.otpGuideText, { color: "#5B21B6" }]}>
            Google Authenticator 앱을 열고 계정 이름 옆의 6자리 숫자를 입력하세요. 코드는 30초마다 갱신됩니다.
          </Text>
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
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7,
  },
  idChipText: { fontSize: 14, fontFamily: "Pretendard-Medium", flex: 1 },
  card: {
    borderRadius: 20, padding: 22, gap: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  cardTitle: { fontSize: 18, fontFamily: "Pretendard-SemiBold" },
  errBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10 },
  errText: { fontSize: 13, fontFamily: "Pretendard-Regular", flex: 1 },
  otpIconRow: { alignItems: "center", paddingVertical: 4 },
  otpIconBg: { width: 68, height: 68, borderRadius: 34, alignItems: "center", justifyContent: "center" },
  otpDesc: { fontSize: 14, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 22 },
  otpBoxRow: { flexDirection: "row", gap: 8, justifyContent: "center" },
  otpBox: {
    width: 44, height: 52, borderRadius: 12, borderWidth: 2,
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: 0, paddingVertical: 0,
  },
  btn: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  btnText: { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Medium" },
  forgotRow: { alignItems: "center", paddingVertical: 4 },
  forgotText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  otpGuideCard: {
    flexDirection: "row", gap: 8, padding: 14, borderRadius: 14, borderWidth: 1, alignItems: "flex-start",
  },
  otpGuideText: { fontSize: 12, fontFamily: "Pretendard-Regular", flex: 1, lineHeight: 18 },
});
