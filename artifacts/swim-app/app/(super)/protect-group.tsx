/**
 * (super)/protect-group.tsx — 보호·통제 그룹
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useOperatorsStore } from "@/store/operatorsStore";
import { useFeatureFlagStore } from "@/store/featureFlagStore";

const MENUS = [
  {
    icon: "alert-triangle" as const,
    title: "데이터·킬스위치",
    sub: "삭제 예약·유예·4단계 안전장치·실행 로그",
    path: "/(super)/kill-switch",
    color: "#D96C6C",
    bg: "#F9DEDA",
  },
  {
    icon: "save" as const,
    title: "백업/복구/스냅샷",
    sub: "스냅샷 목록·단일복구·비교복구·배치잡",
    path: "/(super)/backup",
    color: "#2EC4B6",
    bg: "#E6FFFA",
  },
  {
    icon: "toggle-left" as const,
    title: "기능 플래그",
    sub: "ON/OFF 제어·운영자별 예외·롤백·위험 플래그",
    path: "/(super)/feature-flags",
    color: "#7C3AED",
    bg: "#EEDDF5",
  },
  {
    icon: "lock" as const,
    title: "읽기전용 제어",
    sub: "플랫폼 전체·운영자별·기능별 읽기전용 전환",
    path: "/(super)/readonly-control",
    color: "#991B1B",
    bg: "#FEF2F2",
  },
];

export default function ProtectGroupScreen() {
  const operators       = useOperatorsStore(s => s.operators);
  const deletionPending = operators.filter(o => !!o.autoDeleteScheduledAt).length;
  const readonlyCount   = operators.filter(o => o.isReadOnly).length;
  const allFlags        = useFeatureFlagStore(s => s.flags);
  const dangerActive    = allFlags.filter(f =>
    f.scope === 'global' && f.enabled &&
    ['auto_deletion_policy','readonly_auto_trigger','upload_spike_detection'].includes(f.key)
  ).length;

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="보호·통제" homePath="/(super)/dashboard" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 60 }}>
        {/* 요약 */}
        <View style={s.summaryRow}>
          <View style={[s.summaryCard, deletionPending > 0 && s.summaryAlertRed]}>
            <Text style={[s.summaryNum, deletionPending > 0 && { color: "#D96C6C" }]}>{deletionPending}</Text>
            <Text style={s.summaryLabel}>삭제 예정</Text>
          </View>
          <View style={[s.summaryCard, readonlyCount > 0 && s.summaryAlertOrange]}>
            <Text style={[s.summaryNum, readonlyCount > 0 && { color: "#D97706" }]}>{readonlyCount}</Text>
            <Text style={s.summaryLabel}>읽기전용</Text>
          </View>
          <View style={[s.summaryCard, dangerActive > 0 && s.summaryAlertRed]}>
            <Text style={[s.summaryNum, dangerActive > 0 && { color: "#D96C6C" }]}>{dangerActive}</Text>
            <Text style={s.summaryLabel}>위험 플래그 ON</Text>
          </View>
        </View>

        {dangerActive > 0 && (
          <View style={s.warningBanner}>
            <Feather name="alert-triangle" size={14} color="#D96C6C" />
            <Text style={s.warningTxt}>위험 플래그 {dangerActive}개가 활성화되어 있습니다. 기능 플래그 화면에서 확인하세요.</Text>
          </View>
        )}

        {MENUS.map(m => (
          <Pressable key={m.path} style={s.card} onPress={() => router.push(m.path as any)}>
            <View style={[s.iconBox, { backgroundColor: m.bg }]}>
              <Feather name={m.icon} size={22} color={m.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>{m.title}</Text>
              <Text style={s.cardSub}>{m.sub}</Text>
            </View>
            <Feather name="chevron-right" size={16} color="#D1D5DB" />
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: C.background },
  summaryRow:       { flexDirection: "row", gap: 8, marginBottom: 6 },
  summaryCard:      { flex: 1, backgroundColor: "#fff", borderRadius: 12, padding: 12, alignItems: "center",
                      borderWidth: 1, borderColor: "#E5E7EB" },
  summaryAlertRed:  { borderColor: "#FCA5A5", backgroundColor: "#FFF5F5" },
  summaryAlertOrange:{ borderColor: "#FDE68A", backgroundColor: "#FFFBEB" },
  summaryNum:       { fontSize: 22, fontFamily: "Inter_700Bold", color: "#111827" },
  summaryLabel:     { fontSize: 9, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 3, textAlign: "center" },
  warningBanner:    { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#F9DEDA",
                      padding: 12, borderRadius: 10, borderWidth: 1, borderColor: "#FCA5A5" },
  warningTxt:       { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#991B1B", lineHeight: 17 },
  card:             { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "#fff",
                      borderRadius: 14, padding: 16, borderWidth: 1, borderColor: "#E5E7EB" },
  iconBox:          { width: 48, height: 48, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  cardTitle:        { fontSize: 15, fontFamily: "Inter_700Bold", color: "#111827" },
  cardSub:          { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 3, lineHeight: 17 },
});
