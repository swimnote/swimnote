/**
 * 저장공간 현황 — 총 사용량 · 제공 용량 · 남은 용량 · 게이지
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const C = Colors.light;

function fmtBytes(b: number) {
  if (b === 0) return "0 B";
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

interface AdminStorage {
  total_bytes: number; quota_bytes: number;
  photo_bytes: number; video_bytes: number;
  messenger_bytes: number; diary_bytes: number;
  notice_bytes: number; system_bytes: number;
}

export default function DataStorageOverviewScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();
  const [storage, setStorage] = useState<AdminStorage | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest(token, "/admin/storage");
      if (res.ok) setStorage(await res.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const used  = storage?.total_bytes ?? 0;
  const quota = storage?.quota_bytes ?? 5 * 1024 ** 3;
  const free  = Math.max(0, quota - used);
  const pct   = quota > 0 ? Math.min(100, (used / quota) * 100) : 0;
  const gaugeColor = pct >= 90 ? "#DC2626" : pct >= 70 ? "#F59E0B" : themeColor;

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SubScreenHeader title="저장공간 현황" onBack={() => router.navigate("/(admin)/data-management" as any)} />

      {loading ? (
        <ActivityIndicator color={themeColor} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
        >
          {/* 게이지 카드 */}
          <View style={[s.card, { backgroundColor: C.card }]}>
            <Text style={s.cardTitle}>전체 사용률</Text>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 12 }}>
              <Text style={[s.bigNum, { color: gaugeColor }]}>{pct.toFixed(1)}%</Text>
              <Text style={s.sub}>사용 중</Text>
            </View>
            <View style={s.gaugeWrap}>
              <View style={[s.gaugeBar, { width: `${pct}%` as any, backgroundColor: gaugeColor }]} />
            </View>
          </View>

          {/* 수치 카드 3개 */}
          {[
            { label: "사용량",    bytes: used,  icon: "hard-drive" as const, color: gaugeColor },
            { label: "제공 용량", bytes: quota, icon: "server"     as const, color: "#6B7280" },
            { label: "남은 용량", bytes: free,  icon: "check-circle" as const, color: "#059669" },
          ].map(item => (
            <View key={item.label} style={[s.statCard, { backgroundColor: C.card }]}>
              <View style={[s.statIcon, { backgroundColor: item.color + "15" }]}>
                <Feather name={item.icon} size={22} color={item.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.statLabel}>{item.label}</Text>
                <Text style={[s.statValue, { color: item.color }]}>{fmtBytes(item.bytes)}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card:       { borderRadius: 18, padding: 20, shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  cardTitle:  { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#6B7280", marginBottom: 4 },
  bigNum:     { fontSize: 40, fontFamily: "Inter_700Bold" },
  sub:        { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginBottom: 6 },
  gaugeWrap:  { height: 12, backgroundColor: "#E5E7EB", borderRadius: 6, overflow: "hidden" },
  gaugeBar:   { height: 12, borderRadius: 6 },
  statCard:   { flexDirection: "row", alignItems: "center", gap: 16, padding: 16, borderRadius: 18, shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  statIcon:   { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  statLabel:  { fontSize: 13, fontFamily: "Inter_500Medium", color: "#6B7280", marginBottom: 2 },
  statValue:  { fontSize: 22, fontFamily: "Inter_700Bold" },
});
