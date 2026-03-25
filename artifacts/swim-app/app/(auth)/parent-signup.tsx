/**
 * parent-signup.tsx — 학부모 회원가입
 * 공통 폼: 아이디 / 비밀번호 / 성별 / 휴대폰
 * 완료 후 → /parent-onboard-pool 이동
 *
 * SMS 인증: 미연결 상태 — 번호 저장 후 인증 없이 진행
 * (SMS 서비스 연결 후 phone_verifications 기반 인증 추가 예정)
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const C = Colors.light;
type Gender = "남" | "여" | "기타";

export default function ParentSignupScreen() {
  const insets = useSafeAreaInsets();

  const [name,    setName]    = useState("");
  const [loginId, setLoginId] = useState("");
  const [pw,      setPw]      = useState("");
  const [pwc,     setPwc]     = useState("");
  const [gender,  setGender]  = useState<Gender | null>(null);
  const [phone,   setPhone]   = useState("");
  const [error,   setError]   = useState("");

  function validate() {
    if (!name.trim())    { setError("이름을 입력해주세요."); return false; }
    if (!loginId.trim()) { setError("아이디를 입력해주세요."); return false; }
    if (pw.length < 6)   { setError("비밀번호는 6자 이상이어야 합니다."); return false; }
    if (pw !== pwc)      { setError("비밀번호가 일치하지 않습니다."); return false; }
    if (!gender)         { setError("성별을 선택해주세요."); return false; }
    if (!phone.trim())   { setError("휴대폰 번호를 입력해주세요."); return false; }
    return true;
  }

  function handleNext() {
    setError("");
    if (!validate()) return;
    // SMS 미연결: 인증 없이 수영장 검색 단계로 이동
    // 가입 데이터는 parent-onboard-pool에서 수영장 선택 후 최종 등록
    router.push({
      pathname: "/parent-onboard-pool" as any,
      params: { name, loginId, pw, gender: gender!, phone },
    });
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20), paddingBottom: insets.bottom + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          onPress={() => router.back()}
          style={[styles.backBtn, { top: insets.top + (Platform.OS === "web" ? 67 : 16) }]}
        >
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>

        <View style={styles.header}>
          <View style={[styles.iconBox, { backgroundColor: "#FFF1BF" }]}>
            <Feather name="heart" size={28} color="#E4A93A" />
          </View>
          <Text style={[styles.title, { color: C.text }]}>학부모 가입</Text>
          <Text style={[styles.sub, { color: C.textSecondary }]}>
            수영장 검색 후 자녀 연결을 요청합니다
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: C.card }]}>
          {!!error && (
            <View style={[styles.errorBox, { backgroundColor: "#F9DEDA" }]}>
              <Feather name="alert-circle" size={13} color={C.error} />
              <Text style={[styles.errorTxt, { color: C.error }]}>{error}</Text>
            </View>
          )}

          {/* 이름 */}
          <Field label="이름 *" icon="user">
            <TextInput
              style={[styles.input, { color: C.text }]}
              value={name} onChangeText={setName}
              placeholder="실명 입력" placeholderTextColor={C.textMuted}
              autoCapitalize="none"
            />
          </Field>

          {/* 아이디 */}
          <Field label="아이디 *" icon="at-sign">
            <TextInput
              style={[styles.input, { color: C.text }]}
              value={loginId} onChangeText={setLoginId}
              placeholder="로그인에 사용할 아이디" placeholderTextColor={C.textMuted}
              autoCapitalize="none"
            />
          </Field>

          {/* 비밀번호 */}
          <Field label="비밀번호 *" icon="lock">
            <TextInput
              style={[styles.input, { color: C.text }]}
              value={pw} onChangeText={setPw}
              placeholder="6자 이상" placeholderTextColor={C.textMuted}
              secureTextEntry autoCapitalize="none"
            />
          </Field>

          {/* 비밀번호 확인 */}
          <Field label="비밀번호 확인 *" icon="lock">
            <TextInput
              style={[styles.input, { color: C.text }]}
              value={pwc} onChangeText={setPwc}
              placeholder="비밀번호 재입력" placeholderTextColor={C.textMuted}
              secureTextEntry autoCapitalize="none"
            />
          </Field>

          {/* 성별 */}
          <View style={styles.field}>
            <Text style={[styles.label, { color: C.textSecondary }]}>성별 *</Text>
            <View style={styles.genderRow}>
              {(["남", "여", "기타"] as Gender[]).map(g => (
                <Pressable
                  key={g}
                  style={[styles.genderBtn, gender === g && { backgroundColor: C.tint, borderColor: C.tint }]}
                  onPress={() => setGender(g)}
                >
                  <Text style={[styles.genderTxt, { color: gender === g ? "#fff" : C.textSecondary }]}>{g}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* 휴대폰 */}
          <Field label="휴대폰 번호 *" icon="phone">
            <TextInput
              style={[styles.input, { color: C.text }]}
              value={phone} onChangeText={setPhone}
              placeholder="010-0000-0000" placeholderTextColor={C.textMuted}
              keyboardType="phone-pad"
            />
          </Field>

          {/* SMS 미연결 안내 */}
          <View style={styles.smsNotice}>
            <Feather name="info" size={13} color="#D97706" />
            <Text style={styles.smsNoticeTxt}>
              SMS 인증은 현재 미연결 상태입니다.{"\n"}
              번호는 저장되며 서비스 연결 후 인증이 추가됩니다.
            </Text>
          </View>

          <Pressable
            style={({ pressed }) => [styles.primaryBtn, { backgroundColor: C.tint, opacity: pressed ? 0.85 : 1 }]}
            onPress={handleNext}
          >
            <Text style={styles.primaryBtnTxt}>수영장 검색하기</Text>
            <Feather name="arrow-right" size={16} color="#fff" />
          </Pressable>
        </View>

        <Pressable
          style={({ pressed }) => [styles.loginLink, { opacity: pressed ? 0.6 : 1 }]}
          onPress={() => router.replace("/" as any)}
        >
          <Text style={[styles.loginLinkTxt, { color: C.textSecondary }]}>
            이미 계정이 있으신가요?{" "}
            <Text style={{ color: C.tint, fontFamily: "Inter_600SemiBold" }}>로그인</Text>
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, icon, children }: { label: string; icon: any; children: React.ReactNode }) {
  const C = Colors.light;
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: C.textSecondary }]}>{label}</Text>
      <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
        <Feather name={icon} size={15} color={C.textMuted} style={{ marginRight: 8 }} />
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:     { paddingHorizontal: 20, gap: 24 },
  backBtn:       { position: "absolute", left: 20, zIndex: 10, padding: 4 },
  header:        { alignItems: "center", gap: 10, paddingTop: 8 },
  iconBox:       { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title:         { fontSize: 22, fontFamily: "Inter_700Bold" },
  sub:           { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  card:          { borderRadius: 20, padding: 20, gap: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 3 },
  errorBox:      { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10 },
  errorTxt:      { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  field:         { gap: 6 },
  label:         { fontSize: 12, fontFamily: "Inter_500Medium" },
  inputBox:      { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, height: 46 },
  input:         { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  genderRow:     { flexDirection: "row", gap: 10 },
  genderBtn:     { flex: 1, height: 42, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.light.border, alignItems: "center", justifyContent: "center", backgroundColor: Colors.light.background },
  genderTxt:     { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  smsNotice:     { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#FFFBEB", padding: 10, borderRadius: 10, borderWidth: 1, borderColor: "#FDE68A" },
  smsNoticeTxt:  { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#92400E", lineHeight: 18 },
  primaryBtn:    { height: 50, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryBtnTxt: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  loginLink:     { alignItems: "center", paddingVertical: 4 },
  loginLinkTxt:  { fontSize: 13, fontFamily: "Inter_400Regular" },
});
