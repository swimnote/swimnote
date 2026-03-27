/**
 * totp-setup.tsx — Google OTP 등록/설정 화면
 * Google Authenticator 앱 연동, 활성화/비활성화
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Platform,
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

  const [step, setStep]                 = useState<Step>("check");
  const [totpEnabled, setTotpEnabled]   = useState(false);
  const [otpauthUrl, setOtpauthUrl]     = useState("");
  const [qrCode, setQrCode]             = useState("");
  const [secret, setSecret]             = useState("");
  const [otpCode, setOtpCode]           = useState("");
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState("");
  const [success, setSuccess]           = useState("");
  const [initialLoading, setInitialLoading] = useState(true);
  const [showSecret, setShowSecret]     = useState(false);

  const otpInputRef = useRef<TextInput>(null);

  useEffect(() => { fetchStatus(); }, []);

  async function fetchStatus() {
    setInitialLoading(true);
    try {
      const res = await apiRequest(token, "/auth/totp/status");
      const data = await res.json();
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
    setSuccess("");
    try {
      const res = await apiRequest(token, "/auth/totp/setup", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "설정을 시작할 수 없습니다.");
      setOtpauthUrl(data.otpauth_url);
      setQrCode(data.qr_code || "");
      setSecret(data.secret);
      setOtpCode("");
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
      const res = await apiRequest(token, "/auth/totp/enable", {
        method: "POST",
        body: JSON.stringify({ otp_code: code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "코드 확인에 실패했습니다.");
      setTotpEnabled(true);
      setSuccess("Google OTP가 활성화되었습니다! 다음 로그인부터 OTP 인증이 필요합니다.");
      setStep("check");
      setOtpCode("");
    } catch (e: any) {
      setError(e.message || "코드 확인에 실패했습니다. 앱의 코드가 맞는지 다시 확인해주세요.");
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
      const res = await apiRequest(token, "/auth/totp/disable", {
        method: "POST",
        body: JSON.stringify({ otp_code: code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "비활성화에 실패했습니다.");
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

  function goToVerify() {
    setOtpCode("");
    setError("");
    setStep("verify");
    setTimeout(() => otpInputRef.current?.focus(), 300);
  }

  function goToDisable() {
    setOtpCode("");
    setError("");
    setStep("disable");
    setTimeout(() => otpInputRef.current?.focus(), 300);
  }

  function OtpBoxes({ color = PURPLE }: { color?: string }) {
    return (
      <Pressable style={styles.otpBoxRow} onPress={() => otpInputRef.current?.focus()}>
        {Array.from({ length: 6 }).map((_, i) => (
          <View key={i} style={[
            styles.otpBox,
            {
              borderColor: otpCode.length === i ? color : otpCode[i] ? color : C.border,
              backgroundColor: otpCode[i] ? color + "15" : C.background,
            },
          ]}>
            <Text style={[styles.otpBoxText, { color }]}>{otpCode[i] || ""}</Text>
          </View>
        ))}
      </Pressable>
    );
  }

  if (initialLoading) {
    return (
      <View style={[styles.root, { backgroundColor: C.background }]}>
        <SubScreenHeader title="Google OTP 등록" />
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
      <SubScreenHeader title="Google OTP 등록" />
      <ScrollView
        contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
      >

        {/* 상태 배지 */}
        <View style={[styles.statusBadge, { backgroundColor: totpEnabled ? "#DCFCE7" : "#FEF3C7" }]}>
          <Feather name={totpEnabled ? "shield" : "alert-circle"} size={15} color={totpEnabled ? "#16A34A" : "#D97706"} />
          <Text style={[styles.statusText, { color: totpEnabled ? "#16A34A" : "#D97706" }]}>
            {totpEnabled ? "OTP 등록 완료 — 2단계 인증 활성화됨" : "OTP 미등록 — 지금 등록하면 보안이 강화됩니다"}
          </Text>
        </View>

        {/* 성공 메시지 */}
        {!!success && (
          <View style={[styles.alertBox, { backgroundColor: "#DCFCE7", borderColor: "#BBF7D0" }]}>
            <Feather name="check-circle" size={15} color="#16A34A" />
            <Text style={[styles.alertText, { color: "#15803D" }]}>{success}</Text>
          </View>
        )}

        {/* ── STEP: 메인 ── */}
        {step === "check" && (
          <>
            <View style={[styles.card, { backgroundColor: C.card }]}>
              <View style={styles.iconRow}>
                <View style={[styles.iconBg, { backgroundColor: totpEnabled ? "#DCFCE7" : "#EDE9FE" }]}>
                  <Feather name="smartphone" size={32} color={totpEnabled ? "#16A34A" : PURPLE} />
                </View>
              </View>

              <Text style={[styles.cardTitle, { color: C.text }]}>
                {totpEnabled ? "OTP 등록 완료" : "Google OTP 등록"}
              </Text>
              <Text style={[styles.cardDesc, { color: C.textSecondary }]}>
                {totpEnabled
                  ? "Google Authenticator 앱과 연동되어 있습니다.\n로그인 시 앱의 6자리 코드가 필요합니다."
                  : "Google Authenticator 앱을 등록하면\n비밀번호 외 OTP 코드로 계정을 보호합니다."}
              </Text>

              {!totpEnabled ? (
                <Pressable
                  style={({ pressed }) => [styles.btn, { backgroundColor: PURPLE, opacity: pressed ? 0.85 : 1 }]}
                  onPress={handleStartSetup}
                  disabled={loading}
                >
                  {loading
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <><Feather name="plus-circle" size={16} color="#fff" /><Text style={styles.btnText}>OTP 등록 시작</Text></>
                  }
                </Pressable>
              ) : (
                <Pressable
                  style={({ pressed }) => [styles.btn, { backgroundColor: "#DC2626", opacity: pressed ? 0.85 : 1 }]}
                  onPress={goToDisable}
                >
                  <Feather name="shield-off" size={16} color="#fff" />
                  <Text style={styles.btnText}>OTP 등록 해제</Text>
                </Pressable>
              )}
            </View>

            {/* 설치 안내 */}
            {!totpEnabled && (
              <View style={[styles.guideCard, { backgroundColor: "#F5F3FF", borderColor: "#DDD6FE" }]}>
                <Text style={[styles.guideTitle, { color: PURPLE }]}>Google Authenticator 설치 방법</Text>
                <View style={styles.guideRow}>
                  <View style={[styles.guideNum, { backgroundColor: PURPLE }]}><Text style={styles.guideNumTxt}>1</Text></View>
                  <Text style={[styles.guideText, { color: "#5B21B6" }]}>
                    App Store / Play Store에서 <Text style={{ fontFamily: "Pretendard-Bold" }}>"Google Authenticator"</Text> 검색 후 설치
                  </Text>
                </View>
                <View style={styles.guideRow}>
                  <View style={[styles.guideNum, { backgroundColor: PURPLE }]}><Text style={styles.guideNumTxt}>2</Text></View>
                  <Text style={[styles.guideText, { color: "#5B21B6" }]}>
                    아래 "OTP 등록 시작" 탭 → QR 코드 스캔
                  </Text>
                </View>
                <View style={styles.guideRow}>
                  <View style={[styles.guideNum, { backgroundColor: PURPLE }]}><Text style={styles.guideNumTxt}>3</Text></View>
                  <Text style={[styles.guideText, { color: "#5B21B6" }]}>
                    앱에 표시된 6자리 코드 입력 → 등록 완료
                  </Text>
                </View>
              </View>
            )}
          </>
        )}

        {/* ── STEP: QR 코드 스캔 ── */}
        {step === "qr" && (
          <View style={[styles.card, { backgroundColor: C.card }]}>
            <Text style={[styles.cardTitle, { color: C.text }]}>1단계 — QR 코드 스캔</Text>
            <Text style={[styles.cardDesc, { color: C.textSecondary }]}>
              Google Authenticator 앱 열기 → <Text style={{ fontFamily: "Pretendard-Bold" }}>+</Text> 버튼 → <Text style={{ fontFamily: "Pretendard-Bold" }}>QR 코드 스캔</Text>
            </Text>

            {!!qrCode && (
              <View style={styles.qrWrapper}>
                <Image
                  source={{ uri: qrCode }}
                  style={{ width: 220, height: 220 }}
                  resizeMode="contain"
                />
              </View>
            )}

            {!qrCode && !!otpauthUrl && (
              <View style={[styles.qrWrapper, { alignItems: "center", justifyContent: "center" }]}>
                <ActivityIndicator color={PURPLE} />
                <Text style={{ fontSize: 12, color: C.textMuted, marginTop: 8 }}>QR 코드 생성 중...</Text>
              </View>
            )}

            <Pressable
              style={[styles.secretToggle, { borderColor: C.border }]}
              onPress={() => setShowSecret(v => !v)}
            >
              <Feather name="key" size={14} color={C.textMuted} />
              <Text style={[styles.secretToggleTxt, { color: C.textSecondary }]}>QR 스캔이 안 되면 키 직접 입력</Text>
              <Feather name={showSecret ? "chevron-up" : "chevron-down"} size={14} color={C.textMuted} />
            </Pressable>

            {showSecret && (
              <View style={[styles.secretBox, { backgroundColor: "#F5F3FF", borderColor: "#DDD6FE" }]}>
                <Text style={[styles.secretLabel, { color: C.textMuted }]}>
                  Google Authenticator에서 "설정 키 입력" 선택 후 아래 키를 입력하세요
                </Text>
                <Text style={[styles.secretText, { color: PURPLE }]} selectable>{secret}</Text>
                <Text style={[styles.secretHint, { color: C.textMuted }]}>계정 유형: 시간 기반</Text>
              </View>
            )}

            <Pressable
              style={({ pressed }) => [styles.btn, { backgroundColor: PURPLE, opacity: pressed ? 0.85 : 1 }]}
              onPress={goToVerify}
            >
              <Text style={styles.btnText}>스캔 완료 — 코드 입력하기</Text>
              <Feather name="arrow-right" size={16} color="#fff" />
            </Pressable>

            <Pressable style={styles.cancelRow} onPress={() => { setStep("check"); setSecret(""); setOtpauthUrl(""); setQrCode(""); }}>
              <Text style={[styles.cancelText, { color: C.textMuted }]}>취소</Text>
            </Pressable>
          </View>
        )}

        {/* ── STEP: OTP 코드 검증 (활성화) ── */}
        {step === "verify" && (
          <View style={[styles.card, { backgroundColor: C.card }]}>
            <View style={styles.iconRow}>
              <View style={[styles.iconBg, { backgroundColor: "#EDE9FE" }]}>
                <Feather name="check-square" size={28} color={PURPLE} />
              </View>
            </View>
            <Text style={[styles.cardTitle, { color: C.text }]}>2단계 — 코드 확인</Text>
            <Text style={[styles.cardDesc, { color: C.textSecondary }]}>
              Google Authenticator 앱에 표시된{"\n"}6자리 숫자를 입력해주세요.
            </Text>

            {!!error && (
              <View style={[styles.alertBox, { backgroundColor: "#F9DEDA", borderColor: "#FCA5A5" }]}>
                <Feather name="alert-circle" size={14} color={C.error} />
                <Text style={[styles.alertText, { color: C.error }]}>{error}</Text>
              </View>
            )}

            <OtpBoxes color={PURPLE} />

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
                : <><Feather name="check-circle" size={16} color="#fff" /><Text style={styles.btnText}>OTP 등록 완료</Text></>
              }
            </Pressable>

            <View style={[styles.tipBox, { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0" }]}>
              <Feather name="info" size={13} color="#16A34A" />
              <Text style={[styles.tipText, { color: "#15803D" }]}>
                코드는 30초마다 갱신됩니다. 시간이 지났다면 새 코드로 입력해주세요.
              </Text>
            </View>

            <Pressable style={styles.cancelRow} onPress={() => setStep("qr")}>
              <Text style={[styles.cancelText, { color: C.textMuted }]}>← QR 코드 다시 보기</Text>
            </Pressable>
          </View>
        )}

        {/* ── STEP: 비활성화 ── */}
        {step === "disable" && (
          <View style={[styles.card, { backgroundColor: C.card }]}>
            <View style={styles.iconRow}>
              <View style={[styles.iconBg, { backgroundColor: "#FEE2E2" }]}>
                <Feather name="shield-off" size={28} color="#DC2626" />
              </View>
            </View>
            <Text style={[styles.cardTitle, { color: C.text }]}>OTP 등록 해제</Text>
            <Text style={[styles.cardDesc, { color: C.textSecondary }]}>
              해제하려면 현재 Google Authenticator 앱의 6자리 코드를 입력하세요.
            </Text>

            {!!error && (
              <View style={[styles.alertBox, { backgroundColor: "#F9DEDA", borderColor: "#FCA5A5" }]}>
                <Feather name="alert-circle" size={14} color={C.error} />
                <Text style={[styles.alertText, { color: C.error }]}>{error}</Text>
              </View>
            )}

            <OtpBoxes color="#DC2626" />

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
                : <><Feather name="shield-off" size={16} color="#fff" /><Text style={styles.btnText}>등록 해제 확인</Text></>
              }
            </Pressable>

            <Pressable style={styles.cancelRow} onPress={() => setStep("check")}>
              <Text style={[styles.cancelText, { color: C.textMuted }]}>취소</Text>
            </Pressable>
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
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    padding: 12, borderRadius: 12,
  },
  statusText: { fontSize: 13, fontFamily: "Pretendard-Medium", flex: 1, lineHeight: 18 },
  alertBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    padding: 12, borderRadius: 12, borderWidth: 1,
  },
  alertText: { fontSize: 13, fontFamily: "Pretendard-Medium", flex: 1, lineHeight: 18 },
  card: {
    borderRadius: 20, padding: 22, gap: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  iconRow: { alignItems: "center" },
  iconBg: { width: 68, height: 68, borderRadius: 34, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 18, fontFamily: "Pretendard-Bold", textAlign: "center" },
  cardDesc: { fontSize: 14, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 22 },
  btn: {
    flexDirection: "row", height: 52, borderRadius: 14,
    alignItems: "center", justifyContent: "center", gap: 8,
  },
  btnText: { color: "#fff", fontSize: 16, fontFamily: "Pretendard-SemiBold" },
  qrWrapper: {
    alignItems: "center", padding: 16,
    backgroundColor: "#FFFFFF", borderRadius: 16,
    borderWidth: 1, borderColor: "#E5E7EB",
  },
  secretToggle: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: 12, borderRadius: 12, borderWidth: 1.5,
  },
  secretToggleTxt: { flex: 1, fontSize: 13, fontFamily: "Pretendard-Medium" },
  secretBox: { padding: 14, borderRadius: 12, borderWidth: 1, gap: 6 },
  secretLabel: { fontSize: 12, fontFamily: "Pretendard-Regular", lineHeight: 18 },
  secretText: { fontSize: 14, fontFamily: "Pretendard-Bold", letterSpacing: 2 },
  secretHint: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  otpBoxRow: { flexDirection: "row", gap: 8, justifyContent: "center" },
  otpBox: {
    width: 44, height: 54, borderRadius: 12, borderWidth: 2,
    alignItems: "center", justifyContent: "center",
  },
  otpBoxText: { fontSize: 24, fontFamily: "Pretendard-Bold" },
  hiddenInput: { position: "absolute", opacity: 0, width: 1, height: 1 },
  cancelRow: { alignItems: "center", paddingVertical: 4 },
  cancelText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  tipBox: {
    flexDirection: "row", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, alignItems: "flex-start",
  },
  tipText: { fontSize: 12, fontFamily: "Pretendard-Regular", flex: 1, lineHeight: 18 },
  guideCard: { padding: 16, borderRadius: 14, borderWidth: 1, gap: 12 },
  guideTitle: { fontSize: 14, fontFamily: "Pretendard-Bold" },
  guideRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  guideNum: {
    width: 20, height: 20, borderRadius: 10,
    alignItems: "center", justifyContent: "center", marginTop: 1, flexShrink: 0,
  },
  guideNumTxt: { fontSize: 11, fontFamily: "Pretendard-Bold", color: "#fff" },
  guideText: { fontSize: 13, fontFamily: "Pretendard-Regular", flex: 1, lineHeight: 20 },
});
