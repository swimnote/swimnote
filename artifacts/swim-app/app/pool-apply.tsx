import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
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

export default function PoolApplyScreen() {
  const { token, refreshPool, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const C = Colors.light;

  const [form, setForm] = useState({ name: "", address: "", phone: "", owner_name: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleApply() {
    if (!form.name || !form.address || !form.phone || !form.owner_name) {
      setError("모든 항목을 입력해주세요."); return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await apiRequest(token, "/pools/apply", {
        method: "POST",
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "신청에 실패했습니다.");
      await refreshPool();
      router.replace("/pending");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "신청에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.background }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 24), paddingBottom: insets.bottom + 34 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View style={[styles.iconBox, { backgroundColor: C.tintLight }]}>
            <Feather name="map-pin" size={28} color={C.tint} />
          </View>
          <Text style={[styles.title, { color: C.text }]}>수영장 등록 신청</Text>
          <Text style={[styles.subtitle, { color: C.textSecondary }]}>
            신청 후 슈퍼관리자의 승인을 받으면{"\n"}서비스를 이용하실 수 있습니다.
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.shadow }]}>
          {error ? (
            <View style={[styles.errorBox, { backgroundColor: "#FEE2E2" }]}>
              <Feather name="alert-circle" size={14} color={C.error} />
              <Text style={[styles.errorText, { color: C.error }]}>{error}</Text>
            </View>
          ) : null}

          {[
            { key: "name", label: "수영장 이름 *", placeholder: "예: 한강 수영장", icon: "droplet" as const },
            { key: "address", label: "주소 *", placeholder: "수영장 주소를 입력하세요", icon: "map-pin" as const },
            { key: "phone", label: "대표 전화 *", placeholder: "02-0000-0000", icon: "phone" as const },
            { key: "owner_name", label: "대표자 이름 *", placeholder: "사업자 대표자명", icon: "user" as const },
          ].map(({ key, label, placeholder, icon }) => (
            <View key={key} style={styles.field}>
              <Text style={[styles.label, { color: C.textSecondary }]}>{label}</Text>
              <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
                <Feather name={icon} size={16} color={C.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { color: C.text }]}
                  value={form[key as keyof typeof form]}
                  onChangeText={(v) => setForm(f => ({ ...f, [key]: v }))}
                  placeholder={placeholder}
                  placeholderTextColor={C.textMuted}
                />
              </View>
            </View>
          ))}

          <Pressable
            style={({ pressed }) => [styles.btn, { backgroundColor: C.tint, opacity: pressed ? 0.85 : 1 }]}
            onPress={handleApply}
            disabled={loading}
          >
            {loading ? <ActivityIndicator color="#fff" size="small" /> : (
              <View style={styles.btnContent}>
                <Feather name="send" size={18} color="#fff" />
                <Text style={styles.btnText}>신청서 제출하기</Text>
              </View>
            )}
          </Pressable>
        </View>

        <Pressable onPress={logout} style={styles.logoutBtn}>
          <Text style={[styles.logoutText, { color: C.textMuted }]}>다른 계정으로 로그인</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingHorizontal: 24, gap: 24, justifyContent: "center" },
  header: { alignItems: "center", gap: 12 },
  iconBox: { width: 72, height: 72, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
  card: { borderRadius: 20, padding: 24, gap: 14, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 20, elevation: 4 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10 },
  errorText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  field: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  inputBox: { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, height: 48 },
  inputIcon: { marginRight: 8 },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  btn: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 4 },
  btnContent: { flexDirection: "row", alignItems: "center", gap: 8 },
  btnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  logoutBtn: { alignItems: "center" },
  logoutText: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
