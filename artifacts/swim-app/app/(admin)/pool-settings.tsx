import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView,
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;

interface PoolSettings {
  id: string; name: string; name_en: string;
  business_reg_number: string; address: string; phone: string; owner_name: string;
  approval_status: string; subscription_status: string;
}

export default function PoolSettingsScreen() {
  const { token, refreshPool } = useAuth();
  const insets = useSafeAreaInsets();
  const [settings, setSettings] = useState<PoolSettings | null>(null);
  const [form, setForm] = useState({ name: "", name_en: "", address: "", phone: "", owner_name: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await apiRequest(token, "/pools/settings");
        if (res.ok) {
          const data = await res.json();
          setSettings(data);
          setForm({ name: data.name || "", name_en: data.name_en || "", address: data.address || "", phone: data.phone || "", owner_name: data.owner_name || "" });
        }
      } finally { setLoading(false); }
    })();
  }, [token]);

  async function handleSave() {
    if (form.name_en && !/^[a-z0-9_]+$/.test(form.name_en)) {
      setError("영문표시명은 소문자, 숫자, 언더스코어(_)만 사용할 수 있습니다."); return;
    }
    setSaving(true); setError("");
    try {
      const res = await apiRequest(token, "/pools/settings", {
        method: "PUT",
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "저장 실패");
      setSettings(data);
      await refreshPool?.();
      Alert.alert("완료", "수영장 정보가 저장되었습니다.");
    } catch (err: any) { setError(err.message || "저장 중 오류"); }
    finally { setSaving(false); }
  }

  if (loading) return <View style={[styles.root, { backgroundColor: C.background, alignItems: "center", justifyContent: "center" }]}><ActivityIndicator color={C.tint} /></View>;

  return (
    <KeyboardAvoidingView style={[styles.root, { backgroundColor: C.background }]} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <Text style={[styles.headerTitle, { color: C.text }]}>수영장 설정</Text>
        <Pressable
          style={[styles.saveBtn, { backgroundColor: C.tint, opacity: saving ? 0.6 : 1 }]}
          onPress={handleSave} disabled={saving}
        >
          {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>저장</Text>}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: insets.bottom + 60 }} showsVerticalScrollIndicator={false}>
        {error ? (
          <View style={[styles.errBox, { backgroundColor: "#FEE2E2" }]}>
            <Feather name="alert-circle" size={14} color={C.error} />
            <Text style={[styles.errText, { color: C.error }]}>{error}</Text>
          </View>
        ) : null}

        <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.shadow }]}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>기본 정보</Text>

          {[
            { key: "name", label: "수영장 이름", icon: "droplet", placeholder: "수영장 이름" },
            { key: "address", label: "주소", icon: "map-pin", placeholder: "수영장 주소" },
            { key: "phone", label: "대표 전화", icon: "phone", placeholder: "02-0000-0000" },
            { key: "owner_name", label: "대표자 이름", icon: "user", placeholder: "대표자명" },
          ].map(({ key, label, icon, placeholder }) => (
            <View key={key} style={styles.field}>
              <Text style={[styles.label, { color: C.textSecondary }]}>{label}</Text>
              <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
                <Feather name={icon as any} size={16} color={C.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { color: C.text }]}
                  value={form[key as keyof typeof form]}
                  onChangeText={v => setForm(f => ({ ...f, [key]: v }))}
                  placeholder={placeholder} placeholderTextColor={C.textMuted}
                />
              </View>
            </View>
          ))}
        </View>

        <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.shadow }]}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>파일명 설정</Text>
          <View style={styles.field}>
            <Text style={[styles.label, { color: C.textSecondary }]}>영문표시명</Text>
            <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
              <Feather name="type" size={16} color={C.textMuted} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={form.name_en}
                onChangeText={v => setForm(f => ({ ...f, name_en: v.toLowerCase().replace(/[^a-z0-9_]/g, "") }))}
                placeholder="예: toykids_hwajeong" placeholderTextColor={C.textMuted}
                autoCapitalize="none"
              />
            </View>
            <Text style={[styles.hint, { color: C.textMuted }]}>소문자·숫자·_ 만 사용 가능</Text>
          </View>

          {form.name_en ? (
            <View style={[styles.previewBox, { backgroundColor: C.tintLight }]}>
              <Feather name="file" size={14} color={C.tint} />
              <Text style={[styles.previewText, { color: C.tint }]}>
                파일명 예시: {form.name_en}_20260314_154530_a3f8.jpg
              </Text>
            </View>
          ) : null}
        </View>

        {settings && (
          <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.shadow }]}>
            <Text style={[styles.sectionTitle, { color: C.text }]}>계정 상태</Text>
            <View style={styles.statusRow}>
              <Text style={[styles.statusLabel, { color: C.textSecondary }]}>사업자등록번호</Text>
              <Text style={[styles.statusValue, { color: C.text }]}>{settings.business_reg_number || "미입력"}</Text>
            </View>
            <View style={styles.statusRow}>
              <Text style={[styles.statusLabel, { color: C.textSecondary }]}>승인 상태</Text>
              <View style={[styles.badge, {
                backgroundColor: settings.approval_status === "approved" ? "#D1FAE5" : "#FEF3C7"
              }]}>
                <Text style={[styles.badgeText, {
                  color: settings.approval_status === "approved" ? "#059669" : "#D97706"
                }]}>
                  {settings.approval_status === "approved" ? "승인됨" : settings.approval_status === "pending" ? "심사 중" : "반려"}
                </Text>
              </View>
            </View>
            <View style={styles.statusRow}>
              <Text style={[styles.statusLabel, { color: C.textSecondary }]}>구독 상태</Text>
              <Text style={[styles.statusValue, { color: C.text }]}>
                {settings.subscription_status === "trial" ? "체험 중" : settings.subscription_status === "active" ? "구독 중" : settings.subscription_status}
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
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 16 },
  headerTitle: { fontSize: 24, fontFamily: "Inter_700Bold" },
  saveBtn: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20, minWidth: 60, alignItems: "center" },
  saveBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  errBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10 },
  errText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  card: { borderRadius: 16, padding: 18, gap: 14, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 12, elevation: 3 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  field: { gap: 4 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  hint: { fontSize: 11, fontFamily: "Inter_400Regular" },
  inputBox: { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, height: 48 },
  inputIcon: { marginRight: 8 },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  previewBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10 },
  previewText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  statusRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  statusLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  statusValue: { fontSize: 13, fontFamily: "Inter_500Medium" },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
