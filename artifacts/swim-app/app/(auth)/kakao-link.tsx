/**
 * (auth)/kakao-link.tsx
 * 카카오/Apple 로그인 후 계정 연결 화면
 * 역할 선택(관리자 / 선생님·코치 / 학부모) → 전화번호 입력 → 연결
 */
import { ArrowLeft, Phone, Link2 } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { API_BASE } from "@/context/AuthContext";

const C = Colors.light;

type Role = "admin" | "teacher" | "parent";

const ROLES: { key: Role; label: string }[] = [
  { key: "admin",   label: "관리자" },
  { key: "teacher", label: "선생님·코치" },
  { key: "parent",  label: "학부모" },
];

export default function KakaoLinkScreen() {
  const insets = useSafeAreaInsets();
  const { kakaoId, kakaoProfileImage, kakaoName, loginType } = useLocalSearchParams<{
    kakaoId: string;
    kakaoProfileImage?: string;
    kakaoName?: string;
    loginType?: string;
  }>();

  const isApple = loginType === "apple";
  const { setParentSession, setAdminSession } = useAuth();
  const [role, setRole] = useState<Role>("parent");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pendingMsg, setPendingMsg] = useState("");

  async function handleLink() {
    const cleanPhone = phone.replace(/[^0-9]/g, "");
    if (!cleanPhone || cleanPhone.length < 10) {
      setError("올바른 전화번호를 입력해주세요.");
      return;
    }
    setLoading(true);
    setError("");
    setPendingMsg("");
    try {
      let endpoint: string;
      let body: Record<string, any>;

      const isTeacherRole = role === "admin" || role === "teacher";

      if (isApple) {
        endpoint = isTeacherRole ? "/auth/apple-link-teacher" : "/auth/apple-link-account";
        body = { appleId: kakaoId, phone: cleanPhone };
      } else {
        endpoint = isTeacherRole ? "/auth/kakao-link-teacher" : "/auth/kakao-link-account";
        body = { kakaoId, phone: cleanPhone, kakaoProfileImage: kakaoProfileImage || null };
      }

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.needs_activation && data.teacher_id) {
          router.replace({ pathname: "/teacher-activate", params: { teacher_id: data.teacher_id } } as any);
          return;
        }
        if (data.error_code === "phone_not_registered" || res.status === 404) {
          if (role === "admin") {
            router.replace({ pathname: "/register", params: isApple ? { appleId: kakaoId } : { kakaoId } } as any);
            return;
          }
          setPendingMsg("입력하신 전화번호가 등록되어 있지 않습니다.\n관리자가 등록 확인 후 메인화면으로 연결됩니다.");
          return;
        }
        setError(data.message || data.error || "연결에 실패했습니다.");
        return;
      }

      if (data.kind === "admin" && data.user) {
        await setAdminSession(data.token, data.user);
      } else {
        await setParentSession(data.token, data.parent);
      }
    } catch {
      setError("네트워크 오류가 발생했습니다.");
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
          { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={C.text} />
        </Pressable>

        <View style={styles.iconWrap}>
          <View style={[styles.iconBg, { backgroundColor: isApple ? "#000" : "#FEE500" }]}>
            <Link2 size={28} color={isApple ? "#fff" : "#3C1E1E"} />
          </View>
        </View>

        <Text style={[styles.title, { color: C.text }]}>계정 연결</Text>
        <Text style={[styles.desc, { color: C.textSecondary }]}>
          {kakaoName ? `${kakaoName}님, ` : ""}
          {isApple ? "Apple 계정" : "카카오 계정"}과 수영장 계정을 연결합니다.{"\n"}
          역할을 선택하고 등록된 전화번호를 입력해주세요.
        </Text>

        <View style={[styles.card, { backgroundColor: C.card }]}>
          {!!error && (
            <View style={[styles.msgBox, { backgroundColor: "#F9DEDA" }]}>
              <Text style={[styles.msgText, { color: C.error }]}>{error}</Text>
            </View>
          )}
          {!!pendingMsg && (
            <View style={[styles.msgBox, { backgroundColor: "#EEF4FF" }]}>
              <Text style={[styles.msgText, { color: "#1A5CFF" }]}>{pendingMsg}</Text>
            </View>
          )}

          <View style={styles.roleWrap}>
            <Text style={[styles.label, { color: C.textSecondary }]}>역할 선택</Text>
            <View style={styles.roleRow}>
              {ROLES.map(({ key, label }) => (
                <Pressable
                  key={key}
                  style={[
                    styles.roleBtn,
                    {
                      borderColor: role === key ? C.primary : C.border,
                      backgroundColor: role === key ? C.primary + "15" : C.background,
                    },
                  ]}
                  onPress={() => { setRole(key); setError(""); setPendingMsg(""); }}
                >
                  <Text style={[styles.roleBtnText, { color: role === key ? C.primary : C.textSecondary }]}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: C.textSecondary }]}>전화번호</Text>
            <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.background }]}>
              <Phone size={16} color={C.textMuted} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={phone}
                onChangeText={v => { setPhone(v); setError(""); setPendingMsg(""); }}
                placeholder="010-0000-0000"
                placeholderTextColor={C.textMuted}
                keyboardType="phone-pad"
                returnKeyType="done"
                onSubmitEditing={handleLink}
                autoFocus
              />
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.btn,
              { backgroundColor: isApple ? "#000" : "#FEE500", opacity: pressed ? 0.85 : 1 },
            ]}
            onPress={handleLink}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color={isApple ? "#fff" : "#3C1E1E"} size="small" />
              : <Text style={[styles.btnText, { color: isApple ? "#fff" : "#3C1E1E" }]}>계정 연결하기</Text>
            }
          </Pressable>
        </View>

        <Text style={[styles.hint, { color: C.textMuted }]}>
          수영장에 등록된 전화번호가 없다면{"\n"}수영장 관리자에게 먼저 등록을 요청해주세요.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { flexGrow: 1, paddingHorizontal: 24, gap: 20 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  iconWrap: { alignItems: "center", marginBottom: 8 },
  iconBg: {
    width: 72, height: 72, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 4,
  },
  title: { fontSize: 22, fontFamily: "Pretendard-Regular", textAlign: "center" },
  desc: { fontSize: 14, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 22 },
  card: {
    borderRadius: 20, padding: 22, gap: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  msgBox: { padding: 12, borderRadius: 10 },
  msgText: { fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 20 },
  roleWrap: { gap: 8 },
  roleRow: { flexDirection: "row", gap: 8 },
  roleBtn: {
    flex: 1, height: 44, borderRadius: 12, borderWidth: 1.5,
    alignItems: "center", justifyContent: "center",
  },
  roleBtnText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  field: { gap: 8 },
  label: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  inputRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, height: 52,
  },
  input: { flex: 1, fontSize: 15, fontFamily: "Pretendard-Regular" },
  btn: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  btnText: { fontSize: 16, fontFamily: "Pretendard-Regular" },
  hint: { fontSize: 12, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 20 },
});
