/**
 * totp-setup.tsx — Google OTP 설정 화면
 * Google Authenticator 앱 연동, 활성화/비활성화
 */
import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const C = Colors.light;
const PURPLE = "#7C3AED";

type Step = "check" | "qr" | "verify" | "disable";

export default function TotpSetupScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<Step>("check");
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [initialLoading, setInitialLoading] = useState(true);

  const otpInputRef = useRef<TextInput>(null);

  useEffect(() => {
    fetchStatus();
  }, []);

  async function fetchStatus() {
    setInitialLoading(true);
    try {
      const data = await apiRequest(token, "/auth/totp/status");
      setTotpEnabled(data.totp_enabled ?? false);
    } catch {
      setTotpEnabled(false);
    } finally {
      setInitialLoading(false);
    }
  }

  async function handleStartSetup() {
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest(token, "/auth/totp/setup", { method: "POST" });
      setQrCode(data.qr_code);
      setSecret(data.secret);
      setStep("qr");
    } catch (e: any) {
      setError(e.message || "설정을 시작할 수 없습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function handleEnable() {
    const code = otpCode.replace(/\s/g, "");
    if (code.length !== 6) { setError("6자리 코드를 입력해주세요."); return; }
    setLoading(true);
    setError("");
    try {
      await apiRequest(token, "/auth/totp/enable", {
        method: "POST",
        body: JSON.stringify({ otp_code: code }),
      });
      setTotpEnabled(true);
      setSuccess("Google OTP가 활성화되었습니다! 다음 로그인부터 OTP 인증이 필요합니다.");
      setStep("check");
      setOtpCode("");
    } catch (e: any) {
      setError(e.message || "코드 확인에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDisable() {
    const code = otpCode.replace(/\s/g, "");
    if (code.length !== 6) { setError("6자리 코드를 입력해주세요."); return; }
    setLoading(true);
    setError("");
    try {
      await apiRequest(token, "/auth/totp/disable", {
        method: "POST",
        body: JSON.stringify({ otp_code: code }),
      });
      setTotpEnabled(false);
      setSuccess("Google OTP가 비활성화되었습니다.");
      setStep("check");
      setOtpCode("");
    } catch (e: any) {
      setError(e.message || "비활성화에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  function handleOtpChange(v: string) {
    setOtpCode(v.replace(/\D/g, "").slice(0, 6));
    setError("");
  }

  if (initialLoading) {
    return (
      <View style={[styles.root, { backgroundColor: C.background }]}>
        <SubScreenHeader title="Google OTP 설정" />
        <View style={styles.centerBox}>
          <ActivityIndicator color={PURPLE} size="large" />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: C.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <SubScreenHeader title="Google OTP 설정" />
      <ScrollView
        contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* 상태 뱃지 */}
        <View style={[styles.statusBadge, { backgroundColor: totpEnabled ? "#DCFCE7" : "#F3F4F6" }]}>
          <Feather name={totpEnabled ? "shield" : "shield-off"} size={16} color={totpEnabled ? "#16A34A" : "#6B7280"} />
          <Text style={[styles.statusText, { color: totpEnabled ? "#16A34A" : "#6B7280" }]}>
            {totpEnabled ? "Google OTP 활성화됨" : "Google OTP 비활성화됨"}
          </Text>
        </View>

        {/* 성공 메시지 */}
        {!!success && (
          <View style={[styles.successBox, { backgroundColor: "#DCFCE7", borderColor: "#BBF7D0" }]}>
            <Feather name="check-circle" size={15} color="#16A34A" />
            <Text style={[styles.successText, { color: "#15803D" }]}>{success}</Text>
          </View>
        )}

        {/* STEP: 메인 화면 */}
        {step === "check" && (
          <View style={[styles.card, { backgroundColor: C.card }]}>
            <View style={styles.iconRow}>
              <View style={[styles.iconBg, { backgroundColor: "#EDE9FE" }]}>
                <Feather name="smartphone" size={32} color={PURPLE} />
              </View>
            </View>
            <Text style={[styles.cardTitle, { color: C.text }]}>
              {totpEnabled ? "OTP 설정 관리" : "Google OTP 설정"}
            </Text>
            <Text style={[styles.cardDesc, { color: C.textSecondary }]}>
              {totpEnabled
                ? "Google Authenticator 앱과 연동되어 있습니다.\n로그인 시 앱의 6자리 코드가 필요합니다."
                : "Google Authenticator 앱을 연동하면\n로그인 시 추가 보안 인증이 적용됩니다."}
            </Text>

            {!totpEnabled ? (
              <Pressable
                style={({ pressed }) => [styles.btn, { backgroundColor: PURPLE, opacity: pressed ? 0.85 : 1 }]}
                onPress={handleStartSetup}
                disabled={loading}
              >
                {loading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <>
                      <Feather name="plus-circle" size={16} color="#fff" />
                      <Text style={styles.btnText}>OTP 설정 시작</Text>
                    </>
                }
              </Pressable>
            ) : (
              <Pressable
                style={({ pressed }) => [styles.btn, { backgroundColor: "#DC2626", opacity: pressed ? 0.85 : 1 }]}
                onPress={() => { setOtpCode(""); setError(""); setStep("disable"); setTimeout(() => otpInputRef.current?.focus(), 300); }}
              >
                <Feather name="shield-off" size={16} color="#fff" />
                <Text style={styles.btnText}>OTP 비활성화</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* STEP: QR 코드 스캔 */}
        {step === "qr" && (
          <View style={[styles.card, { backgroundColor: C.card }]}>
            <Text style={[styles.cardTitle, { color: C.text }]}>1단계 — QR 코드 스캔</Text>
            <Text style={[styles.cardDesc, { color: C.textSecondary }]}>
              Google Authenticator 앱을 열고{"\n"}아래 QR 코드를 스캔해주세요.
            </Text>

            {!!qrCode && (
              <View style={styles.qrWrapper}>
                <Image source={{ uri: qrCode }} style={styles.qrImage} contentFit="contain" />
              </View>
            )}

            <View style={[styles.secretBox, { backgroundColor: "#F5F3FF", borderColor: "#DDD6FE" }]}>
              <Text style={[styles.secretLabel, { color: C.textMuted }]}>QR 코드가 안 보이면 직접 입력</Text>
              <Text style={[styles.secretText, { color: PURPLE }]} selectable>{secret}</Text>
            </View>

            <Pressable
              style={({ pressed }) => [styles.btn, { backgroundColor: PURPLE, opacity: pressed ? 0.85 : 1 }]}
              onPress={() => { setStep("verify"); setOtpCode(""); setError(""); setTimeout(() => otpInputRef.current?.focus(), 300); }}
            >
              <Text style={styles.btnText}>스캔 완료 — 코드 확인</Text>
              <Feather name="arrow-right" size={16} color="#fff" />
            </Pressable>

            <Pressable style={styles.cancelRow} onPress={() => setStep("check")}>
              <Text style={[styles.cancelText, { color: C.textMuted }]}>취소</Text>
            </Pressable>
          </View>
        )}

        {/* STEP: OTP 검증 (활성화) */}
        {step === "verify" && (
          <View style={[styles.card, { backgroundColor: C.card }]}>
            <Text style={[styles.cardTitle, { color: C.text }]}>2단계 — 코드 확인</Text>
            <Text style={[styles.cardDesc, { color: C.textSecondary }]}>
              Google Authenticator 앱에 표시된{"\n"}6자리 코드를 입력해주세요.
            </Text>

            {!!error && (
              <View style={[styles.errBox, { backgroundColor: "#F9DEDA" }]}>
                <Feather name="alert-circle" size={14} color={C.error} />
                <Text style={[styles.errText, { color: C.error }]}>{error}</Text>
              </View>
            )}

            <Pressable style={styles.otpBoxRow} onPress={() => otpInputRef.current?.focus()}>
              {Array.from({ length: 6 }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.otpBox,
                    {
                      borderColor: otpCode.length === i ? PURPLE : otpCode[i] ? PURPLE : C.border,
                      backgroundColor: otpCode[i] ? "#EDE9FE" : C.background,
                    },
                  ]}
                >
                  <Text style={[styles.otpBoxText, { color: PURPLE }]}>{otpCode[i] || ""}</Text>
                </View>
              ))}
            </Pressable>

            <TextInput
              ref={otpInputRef}
              style={styles.hiddenInput}
              value={otpCode}
              onChangeText={handleOtpChange}
              keyboardType="number-pad"
              maxLength={6}
              returnKeyType="done"
              onSubmitEditing={handleEnable}
              autoFocus
            />

            <Pressable
              style={({ pressed }) => [
                styles.btn,
                { backgroundColor: otpCode.length === 6 ? PURPLE : C.border, opacity: pressed ? 0.85 : 1 },
              ]}
              onPress={handleEnable}
              disabled={loading || otpCode.length !== 6}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <><Feather name="check-circle" size={16} color="#fff" /><Text style={styles.btnText}>OTP 활성화</Text></>
              }
            </Pressable>

            <Pressable style={styles.cancelRow} onPress={() => setStep("qr")}>
              <Text style={[styles.cancelText, { color: C.textMuted }]}>← QR 코드로 돌아가기</Text>
            </Pressable>
          </View>
        )}

        {/* STEP: 비활성화 */}
        {step === "disable" && (
          <View style={[styles.card, { backgroundColor: C.card }]}>
            <View style={styles.iconRow}>
              <View style={[styles.iconBg, { backgroundColor: "#FEE2E2" }]}>
                <Feather name="shield-off" size={32} color="#DC2626" />
              </View>
            </View>
            <Text style={[styles.cardTitle, { color: C.text }]}>OTP 비활성화</Text>
            <Text style={[styles.cardDesc, { color: C.textSecondary }]}>
              비활성화하려면 현재 Google Authenticator 앱의 6자리 코드를 입력하세요.
            </Text>

            {!!error && (
              <View style={[styles.errBox, { backgroundColor: "#F9DEDA" }]}>
                <Feather name="alert-circle" size={14} color={C.error} />
                <Text style={[styles.errText, { color: C.error }]}>{error}</Text>
              </View>
            )}

            <Pressable style={styles.otpBoxRow} onPress={() => otpInputRef.current?.focus()}>
              {Array.from({ length: 6 }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.otpBox,
                    {
                      borderColor: otpCode.length === i ? "#DC2626" : otpCode[i] ? "#DC2626" : C.border,
                      backgroundColor: otpCode[i] ? "#FEE2E2" : C.background,
                    },
                  ]}
                >
                  <Text style={[styles.otpBoxText, { color: "#DC2626" }]}>{otpCode[i] || ""}</Text>
                </View>
              ))}
            </Pressable>

            <TextInput
              ref={otpInputRef}
              style={styles.hiddenInput}
              value={otpCode}
              onChangeText={handleOtpChange}
              keyboardType="number-pad"
              maxLength={6}
              returnKeyType="done"
              onSubmitEditing={handleDisable}
              autoFocus
            />

            <Pressable
              style={({ pressed }) => [
                styles.btn,
                { backgroundColor: otpCode.length === 6 ? "#DC2626" : C.border, opacity: pressed ? 0.85 : 1 },
              ]}
              onPress={handleDisable}
              disabled={loading || otpCode.length !== 6}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <><Feather name="shield-off" size={16} color="#fff" /><Text style={styles.btnText}>OTP 비활성화 확인</Text></>
              }
            </Pressable>

            <Pressable style={styles.cancelRow} onPress={() => setStep("check")}>
              <Text style={[styles.cancelText, { color: C.textMuted }]}>취소</Text>
            </Pressable>
          </View>
        )}

        {/* 안내 카드 */}
        {step === "check" && (
          <View style={[styles.guideCard, { backgroundColor: "#F5F3FF", borderColor: "#DDD6FE" }]}>
            <Text style={[styles.guideTitle, { color: PURPLE }]}>Google Authenticator 설치</Text>
            <View style={styles.guideRow}>
              <Feather name="smartphone" size={14} color={PURPLE} />
              <Text style={[styles.guideText, { color: "#5B21B6" }]}>
                App Store / Play Store에서 "Google Authenticator" 검색 후 설치
              </Text>
            </View>
            <View style={styles.guideRow}>
              <Feather name="camera" size={14} color={PURPLE} />
              <Text style={[styles.guideText, { color: "#5B21B6" }]}>
                앱 내 "+" 버튼 → QR 코드 스캔
              </Text>
            </View>
            <View style={styles.guideRow}>
              <Feather name="clock" size={14} color={PURPLE} />
              <Text style={[styles.guideText, { color: "#5B21B6" }]}>
                30초마다 갱신되는 6자리 코드로 로그인
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { padding: 20, gap: 16 },
  centerBox: { flex: 1, alignItems: "center", justifyContent: "center" },
  statusBadge: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: 12, borderRadius: 12, alignSelf: "flex-start",
  },
  statusText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  successBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    padding: 12, borderRadius: 12, borderWidth: 1,
  },
  successText: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },
  card: {
    borderRadius: 20, padding: 22, gap: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  iconRow: { alignItems: "center" },
  iconBg: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  cardDesc: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
  btn: {
    flexDirection: "row", height: 52, borderRadius: 14,
    alignItems: "center", justifyContent: "center", gap: 8,
  },
  btnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  qrWrapper: { alignItems: "center", padding: 8 },
  qrImage: { width: 200, height: 200 },
  secretBox: { padding: 14, borderRadius: 12, borderWidth: 1, gap: 4 },
  secretLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  secretText: { fontSize: 13, fontFamily: "Inter_600SemiBold", letterSpacing: 1 },
  errBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10 },
  errText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  otpBoxRow: { flexDirection: "row", gap: 8, justifyContent: "center" },
  otpBox: {
    width: 44, height: 52, borderRadius: 12, borderWidth: 2,
    alignItems: "center", justifyContent: "center",
  },
  otpBoxText: { fontSize: 22, fontFamily: "Inter_700Bold" },
  hiddenInput: { position: "absolute", opacity: 0, width: 1, height: 1 },
  cancelRow: { alignItems: "center", paddingVertical: 4 },
  cancelText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  guideCard: { padding: 16, borderRadius: 14, borderWidth: 1, gap: 10 },
  guideTitle: { fontSize: 13, fontFamily: "Inter_700Bold" },
  guideRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  guideText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 18 },
});
