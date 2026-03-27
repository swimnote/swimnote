import { ArrowLeft, AtSign, Check, ChevronRight, CircleAlert, Info, Lock, Phone, User } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { API_BASE, useAuth } from "@/context/AuthContext";

const C = Colors.light;

export default function ParentRegisterScreen() {
  const insets = useSafeAreaInsets();
  const { setParentSession } = useAuth();

  const [parentName, setParentName]           = useState("");
  const [phone, setPhone]                     = useState("");
  const [loginId, setLoginId]                 = useState("");
  const [password, setPassword]               = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPw, setShowPw]                   = useState(false);
  const [termsAgreed, setTermsAgreed]         = useState(false);
  const [privacyAgreed, setPrivacyAgreed]     = useState(false);
  const [refundAgreed, setRefundAgreed]       = useState(false);
  const [submitting, setSubmitting]           = useState(false);
  const [error, setError]                     = useState("");

  async function handleRegister() {
    setError("");
    if (!parentName.trim()) { setError("이름을 입력해주세요."); return; }
    if (!phone.trim())      { setError("전화번호를 입력해주세요."); return; }
    if (!loginId.trim())    { setError("아이디를 입력해주세요."); return; }
    if (loginId.trim().length < 3) { setError("아이디는 3자 이상이어야 합니다."); return; }
    if (!password)          { setError("비밀번호를 입력해주세요."); return; }
    if (password.length < 4) { setError("비밀번호는 4자리 이상이어야 합니다."); return; }
    if (password !== passwordConfirm) { setError("비밀번호가 일치하지 않습니다."); return; }
    if (!termsAgreed) { setError("이용약관에 동의해주세요."); return; }
    if (!privacyAgreed) { setError("개인정보 처리방침에 동의해주세요."); return; }
    if (!refundAgreed)  { setError("환불 및 결제 정책에 동의해주세요."); return; }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/auth/simple-parent-register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parent_name: parentName.trim(),
          phone: phone.trim(),
          loginId: loginId.trim(),
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || "오류가 발생했습니다."); return; }

      await setParentSession(data.token, data.parent);
      router.replace("/(parent)/home" as any);
    } catch {
      setError("네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* 헤더 */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <ArrowLeft size={22} color={C.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: C.text }]}>학부모 회원가입</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* 안내 */}
        <View style={[styles.infoBox, { backgroundColor: C.tintLight }]}>
          <Info size={15} color={C.tint} />
          <Text style={[styles.infoText, { color: C.tint }]}>
            가입 후 홈에서 자녀를 수영장과 연결할 수 있습니다.
          </Text>
        </View>

        {!!error && (
          <View style={[styles.errBox, { backgroundColor: "#F9DEDA" }]}>
            <CircleAlert size={14} color={C.error} />
            <Text style={[styles.errText, { color: C.error }]}>{error}</Text>
          </View>
        )}

        <View style={{ gap: 14 }}>
          {/* 이름 */}
          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: C.textSecondary }]}>이름 *</Text>
            <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.card }]}>
              <User size={16} color={C.textMuted} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={parentName} onChangeText={setParentName}
                placeholder="홍길동" placeholderTextColor={C.textMuted}
              />
            </View>
          </View>

          {/* 전화번호 */}
          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: C.textSecondary }]}>전화번호 *</Text>
            <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.card }]}>
              <Phone size={16} color={C.textMuted} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={phone} onChangeText={setPhone}
                placeholder="010-0000-0000" placeholderTextColor={C.textMuted}
                keyboardType="phone-pad"
              />
            </View>
          </View>

          {/* 아이디 */}
          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: C.textSecondary }]}>아이디 * (로그인에 사용)</Text>
            <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.card }]}>
              <AtSign size={16} color={C.textMuted} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={loginId} onChangeText={setLoginId}
                placeholder="영문/숫자 3자 이상" placeholderTextColor={C.textMuted}
                autoCapitalize="none" autoCorrect={false}
              />
            </View>
          </View>

          {/* 비밀번호 */}
          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: C.textSecondary }]}>비밀번호 * (4자리 이상)</Text>
            <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.card }]}>
              <Lock size={16} color={C.textMuted} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={password} onChangeText={setPassword}
                placeholder="비밀번호 설정" placeholderTextColor={C.textMuted}
                secureTextEntry={!showPw}
              />
              <Pressable onPress={() => setShowPw(v => !v)} hitSlop={10}>
                <LucideIcon name={showPw ? "eye-off" : "eye"} size={16} color={C.textMuted} />
              </Pressable>
            </View>
          </View>

          {/* 비밀번호 확인 */}
          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: C.textSecondary }]}>비밀번호 확인 *</Text>
            <View style={[styles.inputRow, {
              borderColor: passwordConfirm && password !== passwordConfirm ? C.error : C.border,
              backgroundColor: C.card,
            }]}>
              <Lock size={16} color={C.textMuted} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={passwordConfirm} onChangeText={setPasswordConfirm}
                placeholder="비밀번호 재입력" placeholderTextColor={C.textMuted}
                secureTextEntry={!showPw}
              />
            </View>
            {!!passwordConfirm && password !== passwordConfirm && (
              <Text style={{ color: C.error, fontSize: 12, fontFamily: "Pretendard-Regular" }}>
                비밀번호가 일치하지 않습니다
              </Text>
            )}
          </View>
        </View>

        {/* 동의 항목 묶음 */}
        <View style={[styles.agreeBox, { borderColor: C.border, backgroundColor: C.card }]}>
          {/* 전체 동의 */}
          <Pressable
            style={styles.termsRow}
            onPress={() => {
              const all = termsAgreed && privacyAgreed && refundAgreed;
              setTermsAgreed(!all); setPrivacyAgreed(!all); setRefundAgreed(!all);
            }}
            activeOpacity={0.7}
          >
            <View style={[
              styles.checkbox,
              {
                borderColor: (termsAgreed && privacyAgreed && refundAgreed) ? C.tint : C.border,
                backgroundColor: (termsAgreed && privacyAgreed && refundAgreed) ? C.tint : "transparent",
              }
            ]}>
              {termsAgreed && privacyAgreed && refundAgreed && <Check size={12} color="#fff" />}
            </View>
            <Text style={[styles.termsTextBold, { color: C.text }]}>전체 동의</Text>
          </Pressable>

          <View style={[styles.divider, { backgroundColor: C.border }]} />

          {/* 이용약관 */}
          <Pressable style={styles.termsRow} onPress={() => setTermsAgreed(v => !v)} activeOpacity={0.7}>
            <View style={[
              styles.checkbox,
              { borderColor: termsAgreed ? C.tint : C.border, backgroundColor: termsAgreed ? C.tint : "transparent" }
            ]}>
              {termsAgreed && <Check size={12} color="#fff" />}
            </View>
            <Text style={[styles.termsText, { color: C.textSecondary, flex: 1 }]}>이용약관 동의 (필수)</Text>
            <Pressable hitSlop={8} onPress={() => router.push("/terms" as any)}>
              <ChevronRight size={16} color={C.textMuted} />
            </Pressable>
          </Pressable>

          {/* 개인정보 처리방침 */}
          <Pressable style={styles.termsRow} onPress={() => setPrivacyAgreed(v => !v)} activeOpacity={0.7}>
            <View style={[
              styles.checkbox,
              { borderColor: privacyAgreed ? C.tint : C.border, backgroundColor: privacyAgreed ? C.tint : "transparent" }
            ]}>
              {privacyAgreed && <Check size={12} color="#fff" />}
            </View>
            <Text style={[styles.termsText, { color: C.textSecondary, flex: 1 }]}>개인정보 처리방침 동의 (필수)</Text>
            <Pressable hitSlop={8} onPress={() => router.push("/privacy" as any)}>
              <ChevronRight size={16} color={C.textMuted} />
            </Pressable>
          </Pressable>

          {/* 환불 및 결제 정책 */}
          <Pressable style={styles.termsRow} onPress={() => setRefundAgreed(v => !v)} activeOpacity={0.7}>
            <View style={[
              styles.checkbox,
              { borderColor: refundAgreed ? C.tint : C.border, backgroundColor: refundAgreed ? C.tint : "transparent" }
            ]}>
              {refundAgreed && <Check size={12} color="#fff" />}
            </View>
            <Text style={[styles.termsText, { color: C.textSecondary, flex: 1 }]}>환불 및 결제 정책 동의 (필수)</Text>
            <Pressable hitSlop={8} onPress={() => router.push("/refund" as any)}>
              <ChevronRight size={16} color={C.textMuted} />
            </Pressable>
          </Pressable>
        </View>

        {/* 가입 버튼 */}
        <Pressable
          style={[styles.submitBtn, { backgroundColor: C.button, opacity: submitting ? 0.7 : 1 }]}
          onPress={handleRegister}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.submitTxt}>가입하기</Text>
          }
        </Pressable>

        <Pressable style={styles.loginLink} onPress={() => router.replace("/parent-login" as any)}>
          <Text style={[styles.loginLinkTxt, { color: C.textMuted }]}>
            이미 계정이 있으신가요? <Text style={{ color: C.tint }}>로그인</Text>
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header:      { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12 },
  backBtn:     { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontFamily: "Pretendard-SemiBold" },
  content:     { paddingHorizontal: 20, paddingTop: 20, gap: 16 },
  infoBox:     { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 10 },
  infoText:    { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 19 },
  errBox:      { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10 },
  errText:     { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular" },
  label:       { fontSize: 13, fontFamily: "Pretendard-Medium" },
  inputRow:    { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  input:       { flex: 1, fontSize: 15, fontFamily: "Pretendard-Regular" },
  agreeBox:      { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, gap: 10 },
  divider:       { height: 1, marginVertical: 2 },
  termsRow:      { flexDirection: "row", alignItems: "center", gap: 10 },
  checkbox:      { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, justifyContent: "center", alignItems: "center" },
  termsText:     { fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 18 },
  termsTextBold: { fontSize: 14, fontFamily: "Pretendard-SemiBold" },
  submitBtn:   { height: 52, borderRadius: 12, justifyContent: "center", alignItems: "center", marginTop: 8 },
  submitTxt:   { color: "#fff", fontSize: 16, fontFamily: "Pretendard-SemiBold" },
  loginLink:   { alignItems: "center", paddingTop: 8 },
  loginLinkTxt:{ fontSize: 13, fontFamily: "Pretendard-Regular" },
});
