/**
 * (auth)/kakao-link.tsx
 * 카카오 로그인 후 기존 계정(전화번호)을 연결하는 화면
 * 카카오 계정 정보는 있으나 parent_accounts에 매핑이 없는 경우
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

export default function KakaoLinkScreen() {
  const insets = useSafeAreaInsets();
  const { kakaoId, kakaoProfileImage, kakaoName } = useLocalSearchParams<{
    kakaoId: string;
    kakaoProfileImage?: string;
    kakaoName?: string;
  }>();

  const { setParentSession } = useAuth();
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLink() {
    const cleanPhone = phone.replace(/[^0-9]/g, "");
    if (!cleanPhone || cleanPhone.length < 10) {
      setError("올바른 전화번호를 입력해주세요.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/auth/kakao-link-account`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kakaoId,
          phone: cleanPhone,
          kakaoProfileImage: kakaoProfileImage || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || data.error || "연결에 실패했습니다.");
        return;
      }
      await setParentSession(data.token, data.parent);
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
          <View style={[styles.iconBg, { backgroundColor: "#FEE500" }]}>
            <Link2 size={28} color="#3C1E1E" />
          </View>
        </View>

        <Text style={[styles.title, { color: C.text }]}>계정 연결</Text>
        <Text style={[styles.desc, { color: C.textSecondary }]}>
          {kakaoName ? `${kakaoName}님,` : ""} 카카오 계정과 수영장 계정을 연결합니다.{"\n"}
          수영장에 등록된 전화번호를 입력해주세요.
        </Text>

        <View style={[styles.card, { backgroundColor: C.card }]}>
          {!!error && (
            <View style={[styles.errBox, { backgroundColor: "#F9DEDA" }]}>
              <Text style={[styles.errText, { color: C.error }]}>{error}</Text>
            </View>
          )}

          <View style={styles.field}>
            <Text style={[styles.label, { color: C.textSecondary }]}>전화번호</Text>
            <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.background }]}>
              <Phone size={16} color={C.textMuted} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={phone}
                onChangeText={v => { setPhone(v); setError(""); }}
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
              { backgroundColor: "#FEE500", opacity: pressed ? 0.85 : 1 },
            ]}
            onPress={handleLink}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#3C1E1E" size="small" />
              : <Text style={styles.btnText}>계정 연결하기</Text>
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
  errBox: { padding: 12, borderRadius: 10 },
  errText: { fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 20 },
  field: { gap: 8 },
  label: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  inputRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, height: 52,
  },
  input: { flex: 1, fontSize: 15, fontFamily: "Pretendard-Regular" },
  btn: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  btnText: { color: "#3C1E1E", fontSize: 16, fontFamily: "Pretendard-Regular" },
  hint: { fontSize: 12, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 20 },
});
