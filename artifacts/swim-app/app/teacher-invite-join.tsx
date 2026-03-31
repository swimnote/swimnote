/**
 * 선생님 초대 코드로 가입하는 화면
 * - 초대 코드 입력 → 검증
 * - 이메일/비밀번호/이름 입력 → 가입 완료 → 승인 대기 안내
 */
import { ArrowLeft, CircleAlert, Info, Key, Lock, Send, UserPlus } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { API_BASE, useAuth } from "@/context/AuthContext";

const C = Colors.light;

interface InviteInfo { id: string; name: string; phone: string; position: string | null; pool_name: string; invite_status: string; }

export default function TeacherInviteJoinScreen() {
  const insets = useSafeAreaInsets();
  const { setAdminSession } = useAuth();
  const params = useLocalSearchParams();
  const [step, setStep] = useState<"token" | "form">("token");
  const [token, setToken] = useState(String(params.token || ""));
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [tokenError, setTokenError] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (params.token && typeof params.token === "string") {
      setToken(params.token);
      handleVerifyToken(params.token);
    }
  }, []);

  async function handleVerifyToken(tok?: string) {
    const t = tok || token;
    if (!t.trim()) { setTokenError("초대 코드를 입력해주세요."); return; }
    setVerifying(true); setTokenError("");
    try {
      const res = await fetch(`${API_BASE}/public/teacher-invite/${encodeURIComponent(t.trim())}`);
      const data = await res.json();
      if (!res.ok) { setTokenError(data.message || "유효하지 않은 초대 코드입니다."); return; }
      setInviteInfo(data.data);
      setName(data.data.name || "");
      setStep("form");
    } catch { setTokenError("네트워크 오류가 발생했습니다."); }
    finally { setVerifying(false); }
  }

  async function handleSubmit() {
    if (!email.trim() || !password || !name.trim()) { setFormError("모든 필드를 입력해주세요."); return; }
    if (password.length < 6) { setFormError("비밀번호는 6자 이상이어야 합니다."); return; }
    if (password !== passwordConfirm) { setFormError("비밀번호가 일치하지 않습니다."); return; }
    setSubmitting(true); setFormError("");
    try {
      const res = await fetch(`${API_BASE}/public/teacher-invite/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim(), email: email.trim(), password, name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.message || "가입 중 오류가 발생했습니다."); return; }
      // 자동 로그인 후 선생님 홈(승인 대기 화면)으로 이동
      await setAdminSession(data.token, data.user);
      router.replace("/(teacher)/today-schedule" as any);
    } catch { setFormError("네트워크 오류가 발생했습니다."); }
    finally { setSubmitting(false); }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.background }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      {/* 헤더 */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <ArrowLeft size={22} color={C.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: C.text }]}>선생님 초대 가입</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* ── 토큰 입력 단계 ────────────────────────────────────── */}
      {step === "token" && (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
          <View style={[styles.illustBox, { backgroundColor: C.tintLight }]}>
            <Send size={40} color={C.tint} />
          </View>
          <Text style={[styles.sectionTitle, { color: C.text }]}>초대 코드를 입력하세요</Text>
          <Text style={[styles.sectionSub, { color: C.textSecondary }]}>
            수영장 관리자로부터 받은{"\n"}초대 코드를 입력해주세요
          </Text>

          {tokenError ? (
            <View style={[styles.errBox, { backgroundColor: "#F9DEDA" }]}>
              <CircleAlert size={14} color={C.error} />
              <Text style={[styles.errText, { color: C.error }]}>{tokenError}</Text>
            </View>
          ) : null}

          <View style={[styles.tokenInputRow, { borderColor: token ? C.tint : C.border, backgroundColor: C.card }]}>
            <Key size={18} color={token ? C.tint : C.textMuted} />
            <TextInput
              style={[styles.tokenInput, { color: C.text }]}
              value={token}
              onChangeText={t => { setToken(t); setTokenError(""); }}
              placeholder="tok_으로 시작하는 초대 코드"
              placeholderTextColor={C.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <Pressable
            style={({ pressed }) => [styles.primaryBtn, { backgroundColor: C.button, opacity: pressed || verifying ? 0.8 : 1 }]}
            onPress={() => handleVerifyToken()}
            disabled={verifying}
          >
            {verifying ? <ActivityIndicator color="#fff" /> : (
              <><CircleCheck size={18} color="#fff" />
              <Text style={styles.primaryBtnText}>코드 확인</Text></>
            )}
          </Pressable>

          <View style={[styles.infoBox, { backgroundColor: "#F0F9FF", borderColor: "#BAE6FD" }]}>
            <Info size={14} color="#0284C7" />
            <Text style={[styles.infoText, { color: "#0369A1" }]}>
              초대 코드는 관리자가 생성한 고유 코드입니다.{"\n"}
              코드를 분실한 경우 관리자에게 문의해주세요.
            </Text>
          </View>
        </ScrollView>
      )}

      {/* ── 폼 단계 ───────────────────────────────────────────── */}
      {step === "form" && inviteInfo && (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
          {/* 수영장/초대 정보 */}
          <View style={[styles.inviteInfoCard, { backgroundColor: C.tintLight, borderColor: C.tint }]}>
            <Droplet size={20} color={C.tint} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.invitePoolName, { color: C.tint }]}>{inviteInfo.pool_name}</Text>
              {inviteInfo.position && <Text style={[styles.invitePosition, { color: C.tint }]}>{inviteInfo.position}</Text>}
            </View>
            <View style={[styles.statusDot, { backgroundColor: C.success }]} />
          </View>

          <Text style={[styles.sectionTitle, { color: C.text }]}>계정 정보를 입력하세요</Text>
          <Text style={[styles.sectionSub, { color: C.textSecondary }]}>가입 후 관리자 승인이 완료되면 이용할 수 있어요</Text>

          {formError ? (
            <View style={[styles.errBox, { backgroundColor: "#F9DEDA" }]}>
              <CircleAlert size={14} color={C.error} />
              <Text style={[styles.errText, { color: C.error }]}>{formError}</Text>
            </View>
          ) : null}

          <View style={{ gap: 14 }}>
            {[
              { key: "name",  label: "이름 *",  ph: inviteInfo.name || "선생님 이름", icon: "user",  val: name,            set: setName },
              { key: "email", label: "이메일 *", ph: "login@example.com",             icon: "mail",  val: email,           set: setEmail, kb: "email-address", cap: "none" },
            ].map(f => (
              <View key={f.key} style={{ gap: 6 }}>
                <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>{f.label}</Text>
                <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.card }]}>
                  <LucideIcon name={f.icon as any} size={16} color={C.textMuted} />
                  <TextInput
                    style={[styles.textInput, { color: C.text }]}
                    value={f.val} onChangeText={f.set}
                    placeholder={f.ph} placeholderTextColor={C.textMuted}
                    keyboardType={(f.kb as any) || "default"}
                    autoCapitalize={(f.cap as any) || "sentences"}
                  />
                </View>
              </View>
            ))}
            {/* 비밀번호 */}
            <View style={{ gap: 6 }}>
              <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>비밀번호 * (6자 이상)</Text>
              <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.card }]}>
                <Lock size={16} color={C.textMuted} />
                <TextInput
                  style={[styles.textInput, { color: C.text }]}
                  value={password} onChangeText={setPassword}
                  placeholder="6자 이상" placeholderTextColor={C.textMuted}
                  secureTextEntry={!showPassword} autoCapitalize="none"
                />
                <Pressable onPress={() => setShowPassword(v => !v)}>
                  <LucideIcon name={showPassword ? "eye-off" : "eye"} size={16} color={C.textMuted} />
                </Pressable>
              </View>
            </View>
            <View style={{ gap: 6 }}>
              <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>비밀번호 확인 *</Text>
              <View style={[styles.inputRow, {
                borderColor: passwordConfirm && password !== passwordConfirm ? C.error : C.border,
                backgroundColor: C.card,
              }]}>
                <Lock size={16} color={C.textMuted} />
                <TextInput
                  style={[styles.textInput, { color: C.text }]}
                  value={passwordConfirm} onChangeText={setPasswordConfirm}
                  placeholder="비밀번호 재입력" placeholderTextColor={C.textMuted}
                  secureTextEntry={!showPassword} autoCapitalize="none"
                />
              </View>
              {passwordConfirm.length > 0 && password !== passwordConfirm && (
                <Text style={[styles.errHint, { color: C.error }]}>비밀번호가 일치하지 않습니다</Text>
              )}
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [styles.primaryBtn, { backgroundColor: C.button, opacity: pressed || submitting ? 0.8 : 1 }]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? <ActivityIndicator color="#fff" /> : (
              <><UserPlus size={18} color="#fff" />
              <Text style={styles.primaryBtnText}>가입 완료</Text></>
            )}
          </Pressable>
        </ScrollView>
      )}

    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 12, justifyContent: "space-between" },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontFamily: "Pretendard-Regular" },
  content: { padding: 20, gap: 16 },
  illustBox: { width: 80, height: 80, borderRadius: 24, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  sectionTitle: { fontSize: 20, fontFamily: "Pretendard-Regular" },
  sectionSub: { fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 22 },
  errBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10 },
  errText: { fontSize: 13, fontFamily: "Pretendard-Regular", flex: 1 },
  errHint: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  tokenInputRow: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 2, borderRadius: 14, paddingHorizontal: 16, height: 54 },
  tokenInput: { flex: 1, fontSize: 15, fontFamily: "Pretendard-Regular" },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, height: 52, borderRadius: 14 },
  primaryBtnText: { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" },
  infoBox: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 14, borderRadius: 12, borderWidth: 1 },
  infoText: { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 20 },
  inviteInfoCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1.5 },
  invitePoolName: { fontSize: 16, fontFamily: "Pretendard-Regular" },
  invitePosition: { fontSize: 13, fontFamily: "Pretendard-Regular", marginTop: 2 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  fieldLabel: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, height: 50 },
  textInput: { flex: 1, fontSize: 15, fontFamily: "Pretendard-Regular" },
});
