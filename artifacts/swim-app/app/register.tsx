import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

export default function RegisterScreen() {
  const { unifiedLogin } = useAuth();
  const { id: prefillId } = useLocalSearchParams<{ id?: string }>();
  const insets = useSafeAreaInsets();
  const C = Colors.light;

  const [form, setForm] = useState({
    email: prefillId || "",
    password: "",
    passwordConfirm: "",
    name: "",
    phone: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function validateForm() {
    if (!form.email || !form.password || !form.name) {
      setError("필수 항목을 모두 입력해주세요."); return false;
    }
    if (form.password !== form.passwordConfirm) {
      setError("비밀번호가 일치하지 않습니다."); return false;
    }
    if (form.password.length < 6) {
      setError("비밀번호는 6자 이상이어야 합니다."); return false;
    }
    return true;
  }

  async function handleRegister() {
    if (!validateForm()) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiRequest(null, "/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: form.email.trim(),
          password: form.password,
          name: form.name,
          phone: form.phone.trim() || null,
          role: "pool_admin",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "가입에 실패했습니다.");
      await unifiedLogin(form.email.trim(), form.password);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "가입에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20), paddingBottom: insets.bottom + 34 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          onPress={() => router.back()}
          style={[styles.backBtn, { top: insets.top + (Platform.OS === "web" ? 67 : 16) }]}
        >
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>

        <View style={styles.header}>
          <Text style={[styles.title, { color: C.text }]}>수영장 관리자 가입</Text>
          <Text style={[styles.subtitle, { color: C.textSecondary }]}>
            가입 후 수영장 등록 신청을 진행해주세요
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.shadow }]}>
          {!!error && (
            <View style={[styles.errorBox, { backgroundColor: "#F9DEDA" }]}>
              <Feather name="alert-circle" size={14} color={C.error} />
              <Text style={[styles.errorText, { color: C.error }]}>{error}</Text>
            </View>
          )}

          {[
            { key: "name",            label: "이름 *",          placeholder: "담당자 이름",           icon: "user"  as const, keyboardType: "default"   as const },
            { key: "email",           label: "아이디(이메일) *", placeholder: "로그인에 사용할 이메일", icon: "mail"  as const, keyboardType: "email-address" as const },
            { key: "phone",           label: "휴대폰 번호",      placeholder: "010-0000-0000 (선택)", icon: "phone" as const, keyboardType: "phone-pad"  as const },
            { key: "password",        label: "비밀번호 *",       placeholder: "6자 이상",              icon: "lock"  as const, secure: true, keyboardType: "default" as const },
            { key: "passwordConfirm", label: "비밀번호 확인 *",  placeholder: "비밀번호 재입력",       icon: "lock"  as const, secure: true, keyboardType: "default" as const },
          ].map(({ key, label, placeholder, icon, secure, keyboardType }) => (
            <View key={key} style={styles.field}>
              <Text style={[styles.label, { color: C.textSecondary }]}>{label}</Text>
              <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
                <Feather name={icon} size={16} color={C.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { color: C.text }]}
                  value={form[key as keyof typeof form]}
                  onChangeText={(v) => setForm((f) => ({ ...f, [key]: v }))}
                  placeholder={placeholder}
                  placeholderTextColor={C.textMuted}
                  secureTextEntry={!!secure}
                  keyboardType={keyboardType}
                  autoCapitalize="none"
                />
              </View>
            </View>
          ))}

          {/* SMS 미연결 안내 */}
          <View style={styles.smsNotice}>
            <Feather name="info" size={13} color="#D97706" />
            <Text style={styles.smsNoticeTxt}>
              휴대폰 SMS 인증은 현재 미연결 상태입니다.{"\n"}
              번호는 저장되지만 인증 없이 가입됩니다.
            </Text>
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.btn,
              { backgroundColor: C.tint, opacity: pressed ? 0.85 : 1 },
            ]}
            onPress={handleRegister}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.btnText}>계정 생성하기</Text>
            }
          </Pressable>
        </View>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: C.textSecondary }]}>이미 계정이 있으신가요?</Text>
          <Pressable onPress={() => router.replace("/login")}>
            <Text style={[styles.footerLink, { color: C.tint }]}> 로그인</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:    { flexGrow: 1, paddingHorizontal: 24, gap: 20, paddingTop: 80 },
  backBtn:      { position: "absolute", left: 24, zIndex: 10, width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  header:       { gap: 6, marginTop: 20, alignItems: "center" },
  title:        { fontSize: 26, fontFamily: "Inter_700Bold" },
  subtitle:     { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  card:         { borderRadius: 20, padding: 24, gap: 14, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 20, elevation: 4 },
  errorBox:     { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10 },
  errorText:    { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  field:        { gap: 6 },
  label:        { fontSize: 13, fontFamily: "Inter_500Medium" },
  inputBox:     { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, height: 48 },
  inputIcon:    { marginRight: 8 },
  input:        { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  smsNotice:    { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#FFFBEB", padding: 10, borderRadius: 10, borderWidth: 1, borderColor: "#FDE68A" },
  smsNoticeTxt: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#92400E", lineHeight: 18 },
  btn:          { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 4 },
  btnText:      { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  footer:       { flexDirection: "row", justifyContent: "center", alignItems: "center" },
  footerText:   { fontSize: 14, fontFamily: "Inter_400Regular" },
  footerLink:   { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
