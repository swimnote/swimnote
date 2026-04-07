/**
 * 저장공간 현황 — 총 사용량 · 제공 용량 · 남은 용량 · 게이지
 */
import { LucideIcon } from "@/components/common/LucideIcon";
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
  display_storage: string | null;
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
  const quota = storage?.quota_bytes ?? 512 * 1024 * 1024; // fallback: 500MB
  const free  = Math.max(0, quota - used);
  const pct   = quota > 0 ? Math.min(100, (used / quota) * 100) : 0;
  const gaugeColor = pct >= 90 ? "#D96C6C" : pct >= 70 ? "#E4A93A" : themeColor;
  // display_storage: 서버에서 내려오는 플랜 표시 용량 (예: "500MB", "5GB", "500GB")
  const quotaLabel = storage?.display_storage ?? fmtBytes(quota);

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SubScreenHeader title="저장공간 현황" />

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
            { label: "사용량",    display: fmtBytes(used),   icon: "hard-drive"   as const, color: gaugeColor },
            { label: "제공 용량", display: quotaLabel,        icon: "server"       as const, color: "#64748B" },
            { label: "남은 용량", display: fmtBytes(free),   icon: "check-circle" as const, color: "#2EC4B6" },
          ].map(item => (
            <View key={item.label} style={[s.statCard, { backgroundColor: C.card }]}>
              <View style={[s.statIcon, { backgroundColor: item.color + "15" }]}>
                <LucideIcon name={item.icon} size={22} color={item.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.statLabel}>{item.label}</Text>
                <Text style={[s.statValue, { color: item.color }]}>{item.display}</Text>
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
  cardTitle:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B", marginBottom: 4 },
  bigNum:     { fontSize: 40, fontFamily: "Pretendard-Regular" },
  sub:        { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#64748B", marginBottom: 6 },
  gaugeWrap:  { height: 12, backgroundColor: "#E5E7EB", borderRadius: 6, overflow: "hidden" },
  gaugeBar:   { height: 12, borderRadius: 6 },
  statCard:   { flexDirection: "row", alignItems: "center", gap: 16, padding: 16, borderRadius: 18, shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  statIcon:   { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  statLabel:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B", marginBottom: 2 },
  statValue:  { fontSize: 22, fontFamily: "Pretendard-Regular" },
});
