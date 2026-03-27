/**
 * (parent)/push-settings.tsx — 학부모 푸시 알림 설정
 */
import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, ScrollView, StyleSheet, Switch, Text, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";

const C = {
  background: "#FFFFFF",
  card: "#FFFFFF",
  border: "#E5E7EB",
  text: "#1A1A1A",
  textMuted: "#8A8A8A",
  primary: "#2EC4B6",
};

interface PushSettings {
  notice: boolean;
  class_reminder: boolean;
  diary_upload: boolean;
  photo_upload: boolean;
}

const DEFAULT: PushSettings = {
  notice: true,
  class_reminder: true,
  diary_upload: true,
  photo_upload: true,
};

const ITEMS: { key: keyof PushSettings; label: string; desc: string; icon: string }[] = [
  { key: "notice",        label: "공지사항 알림",    desc: "수영장 공지가 등록되면 알림",       icon: "bell" },
  { key: "class_reminder",label: "수업 일정 알림",   desc: "전날/당일 수업 전 리마인더 알림",   icon: "calendar" },
  { key: "diary_upload",  label: "수업 일지 알림",   desc: "선생님이 일지를 작성하면 알림",     icon: "book-open" },
  { key: "photo_upload",  label: "사진 업로드 알림", desc: "새 사진이 업로드되면 알림",         icon: "camera" },
];

export default function ParentPushSettingsScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const [settings, setSettings] = useState<PushSettings>(DEFAULT);
  const [loading, setLoading]   = useState(true);
  const [saving,  setSaving]    = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiRequest(token, "/push-settings");
      if (res.ok) {
        const data = await res.json();
        setSettings(prev => ({ ...prev, ...data.settings }));
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (key: keyof PushSettings, value: boolean) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    try {
      setSaving(true);
      await apiRequest(token, "/push-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { [key]: value } }),
      });
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="푸시 알림 설정" homePath="/(parent)/more" />

      {loading ? (
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 60 }}
        >
          <Text style={s.sectionTitle}>알림을 받을 항목을 선택하세요.</Text>

          <View style={s.card}>
            {ITEMS.map((item, idx) => (
              <View key={item.key} style={[s.row, idx > 0 && { borderTopWidth: 1, borderTopColor: C.border }]}>
                <View style={[s.iconBox, { backgroundColor: themeColor + "15" }]}>
                  <Feather name={item.icon as any} size={16} color={themeColor} />
                </View>
                <View style={s.textBox}>
                  <Text style={s.label}>{item.label}</Text>
                  <Text style={s.desc}>{item.desc}</Text>
                </View>
                <Switch
                  value={settings[item.key]}
                  onValueChange={v => toggle(item.key, v)}
                  disabled={saving}
                  trackColor={{ false: C.border, true: themeColor + "80" }}
                  thumbColor={settings[item.key] ? themeColor : C.textMuted}
                />
              </View>
            ))}
          </View>

          <View style={s.infoBox}>
            <Feather name="info" size={13} color={C.textMuted} />
            <Text style={s.infoText}>
              알림을 완전히 끄려면 기기의 알림 설정에서도 꺼주세요.
            </Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: C.background },
  sectionTitle:{ fontSize: 13, color: C.textMuted, marginBottom: 4, marginLeft: 4 },
  card:        { backgroundColor: C.card, borderRadius: 14, overflow: "hidden",
                 borderWidth: 1, borderColor: C.border },
  row:         { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  iconBox:     { width: 34, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  textBox:     { flex: 1, gap: 2 },
  label:       { fontSize: 14, fontWeight: "600", color: C.text },
  desc:        { fontSize: 12, color: C.textMuted },
  infoBox:     { flexDirection: "row", gap: 6, alignItems: "flex-start",
                 backgroundColor: "#F0EDEA", padding: 12, borderRadius: 10 },
  infoText:    { flex: 1, fontSize: 12, color: C.textMuted, lineHeight: 18 },
});
