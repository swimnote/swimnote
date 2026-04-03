/**
 * (admin)/push-notification-settings.tsx — 관리자 푸시 알림 수신 설정
 *
 * 섹션:
 *  1. 운영 알림 (구독 만료, 결제, 보강 신청)
 *  2. 메신저 알림
 */
import { Info } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
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

interface Settings {
  subscription: boolean;
  billing: boolean;
  makeup_request: boolean;
  messenger: boolean;
}

const DEFAULT: Settings = {
  subscription: true,
  billing: true,
  makeup_request: true,
  messenger: true,
};

type Section = {
  title: string;
  icon: string;
  items: { key: keyof Settings; label: string; desc: string }[];
};

const SECTIONS: Section[] = [
  {
    title: "운영 알림",
    icon: "shield",
    items: [
      { key: "subscription", label: "구독 만료 알림",  desc: "플랜 구독 만료 D-7, D-1, 당일 알림" },
      { key: "billing",      label: "결제 알림",       desc: "결제 성공·실패 즉시 알림 (비활성 불가)" },
      { key: "makeup_request",label: "보강 신청 알림", desc: "학부모가 보강을 신청하면 즉시 알림" },
    ],
  },
  {
    title: "메신저 알림",
    icon: "message-circle",
    items: [
      { key: "messenger", label: "메신저 멘션 알림", desc: "@멘션된 메시지 수신 시 알림" },
    ],
  },
];

export default function AdminPushNotificationSettingsScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const [settings, setSettings] = useState<Settings>(DEFAULT);
  const [loading, setLoading]   = useState(true);
  const [saving,  setSaving]    = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiRequest(token, "/push-settings");
      if (res.ok) {
        const { settings: s } = await res.json();
        setSettings(prev => ({ ...prev, ...s }));
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (key: keyof Settings, value: boolean) => {
    if (key === "billing") return; // 결제 알림은 항상 ON
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
      <SubScreenHeader title="푸시 알림 설정" onBack={() => router.replace("/(admin)/dashboard" as any)} />

      {loading ? (
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 60 }}
        >
          <Text style={s.desc}>관리자 계정에서 수신할 알림 항목을 설정합니다.</Text>

          {SECTIONS.map(section => (
            <View key={section.title}>
              <View style={s.sectionHeader}>
                <LucideIcon name={section.icon as any} size={14} color={themeColor} />
                <Text style={[s.sectionTitle, { color: themeColor }]}>{section.title}</Text>
              </View>
              <View style={s.card}>
                {section.items.map((item, idx) => {
                  const isAlwaysOn = item.key === "billing";
                  return (
                    <View key={item.key} style={[s.row, idx > 0 && { borderTopWidth: 1, borderTopColor: C.border }]}>
                      <View style={s.textBox}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={s.label}>{item.label}</Text>
                          {isAlwaysOn && (
                            <View style={s.badge}>
                              <Text style={s.badgeText}>필수</Text>
                            </View>
                          )}
                        </View>
                        <Text style={s.itemDesc}>{item.desc}</Text>
                      </View>
                      <Switch
                        value={isAlwaysOn ? true : settings[item.key]}
                        onValueChange={v => toggle(item.key, v)}
                        disabled={saving || isAlwaysOn}
                        trackColor={{ false: C.border, true: themeColor + "80" }}
                        thumbColor={(isAlwaysOn || settings[item.key]) ? themeColor : C.textMuted}
                      />
                    </View>
                  );
                })}
              </View>
            </View>
          ))}

          <View style={s.infoBox}>
            <Info size={13} color={C.textMuted} />
            <Text style={s.infoText}>
              결제 알림은 보안상 항상 발송됩니다. 기기 알림 설정에서 꺼도 서버 로그에 기록됩니다.
            </Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: C.background },
  desc:         { fontSize: 13, color: C.textMuted, marginBottom: 2, marginLeft: 4 },
  sectionHeader:{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  sectionTitle: { fontSize: 13, fontWeight: "700" },
  card:         { backgroundColor: C.card, borderRadius: 14, overflow: "hidden",
                  borderWidth: 1, borderColor: C.border },
  row:          { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  textBox:      { flex: 1, gap: 3 },
  label:        { fontSize: 14, fontWeight: "600", color: C.text },
  itemDesc:     { fontSize: 12, color: C.textMuted },
  badge:        { backgroundColor: "#FEE2E2", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  badgeText:    { fontSize: 10, fontWeight: "700", color: "#DC2626" },
  infoBox:      { flexDirection: "row", gap: 6, alignItems: "flex-start",
                  backgroundColor: "#F0EDEA", padding: 12, borderRadius: 10 },
  infoText:     { flex: 1, fontSize: 12, color: C.textMuted, lineHeight: 18 },
});
