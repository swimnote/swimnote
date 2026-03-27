/**
 * (super)/audit-group.tsx — 감사·리스크 그룹
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useAuditLogStore } from "@/store/auditLogStore";
import { useRiskStore } from "@/store/riskStore";

const MENUS = [
  {
    icon: "activity" as const,
    title: "운영 로그·감사",
    sub: "결제·삭제·승인·보안 이벤트 전체 로그",
    path: "/(super)/op-logs",
    color: "#2EC4B6",
    bg: "#E6FFFA",
  },
  {
    icon: "shield" as const,
    title: "장애·리스크 센터",
    sub: "오늘 처리 큐·서비스 상태·알림 내역",
    path: "/(super)/risk-center",
    color: "#9333EA",
    bg: "#F3E8FF",
  },
  {
    icon: "alert-octagon" as const,
    title: "보안 이벤트 로그",
    sub: "로그인 실패·IP 차단·권한 이상 탐지",
    path: "/(super)/op-logs",
    color: "#D96C6C",
    bg: "#F9DEDA",
  },
  {
    icon: "eye" as const,
    title: "민감 작업 로그",
    sub: "킬스위치·권한변경·플랜변경·강제해지 기록",
    path: "/(super)/op-logs",
    color: "#2EC4B6",
    bg: "#ECFEFF",
  },
];

export default function AuditGroupScreen() {
  const allLogs      = useAuditLogStore(s => s.logs);
  const riskSummary  = useRiskStore(s => s.summary);
  const todayLogs    = allLogs.filter(l => {
    const d = new Date(l.createdAt);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }).length;
  const criticalLogs = allLogs.filter(l => l.impact === 'critical').length;

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="감사·리스크" homePath="/(super)/dashboard" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 60 }}>
        {/* 요약 */}
        <View style={[s.summaryRow, { flexWrap: "wrap" }]}>
          <View style={s.summaryCard}>
            <Text style={s.summaryNum}>{allLogs.length}</Text>
            <Text style={s.summaryLabel}>전체 로그</Text>
          </View>
          <View style={s.summaryCard}>
            <Text style={s.summaryNum}>{todayLogs}</Text>
            <Text style={s.summaryLabel}>오늘 로그</Text>
          </View>
          <View style={[s.summaryCard, criticalLogs > 0 && s.summaryAlertRed]}>
            <Text style={[s.summaryNum, criticalLogs > 0 && { color: "#D96C6C" }]}>{criticalLogs}</Text>
            <Text style={s.summaryLabel}>심각 이벤트</Text>
          </View>
          <View style={[s.summaryCard, riskSummary.securityEvents > 0 && s.summaryAlertRed]}>
            <Text style={[s.summaryNum, riskSummary.securityEvents > 0 && { color: "#D96C6C" }]}>{riskSummary.securityEvents}</Text>
            <Text style={s.summaryLabel}>보안 이벤트</Text>
          </View>
        </View>

        {/* 최근 로그 미리보기 */}
        {allLogs.slice(0, 3).map(log => (
          <View key={log.id} style={s.logRow}>
            <View style={[s.catBadge, log.impact === 'critical' && s.catBadgeCritical]}>
              <Text style={[s.catTxt, log.impact === 'critical' && { color: "#D96C6C" }]}>{log.category}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.logTitle} numberOfLines={1}>{log.title}</Text>
              <Text style={s.logMeta}>{log.actorName} · {new Date(log.createdAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Text>
            </View>
          </View>
        ))}

        <Pressable style={s.viewAllBtn} onPress={() => router.push('/(super)/op-logs' as any)}>
          <Text style={s.viewAllTxt}>전체 로그 보기 →</Text>
        </Pressable>

        <View style={s.divider} />

        {MENUS.map((m, idx) => (
          <Pressable key={idx} style={s.card} onPress={() => router.push(m.path as any)}>
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
  safe:            { flex: 1, backgroundColor: C.background },
  summaryRow:      { flexDirection: "row", gap: 6, marginBottom: 6 },
  summaryCard:     { flex: 1, backgroundColor: "#fff", borderRadius: 12, padding: 10,
                     alignItems: "center", borderWidth: 1, borderColor: "#E5E7EB" },
  summaryAlertRed: { borderColor: "#FCA5A5", backgroundColor: "#FFF5F5" },
  summaryNum:      { fontSize: 20, fontFamily: "Inter_700Bold", color: "#111827" },
  summaryLabel:    { fontSize: 9, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2, textAlign: "center" },
  logRow:          { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff",
                     borderRadius: 10, padding: 10, borderWidth: 1, borderColor: "#E5E7EB" },
  catBadge:        { backgroundColor: "#E6FFFA", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  catBadgeCritical:{ backgroundColor: "#F9DEDA" },
  catTxt:          { fontSize: 10, fontFamily: "Inter_700Bold", color: "#2EC4B6" },
  logTitle:        { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#111827" },
  logMeta:         { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2 },
  viewAllBtn:      { alignItems: "center", paddingVertical: 10 },
  viewAllTxt:      { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#2EC4B6" },
  divider:         { height: 1, backgroundColor: "#E5E7EB", marginVertical: 4 },
  card:            { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "#fff",
                     borderRadius: 14, padding: 16, borderWidth: 1, borderColor: "#E5E7EB" },
  iconBox:         { width: 48, height: 48, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  cardTitle:       { fontSize: 15, fontFamily: "Inter_700Bold", color: "#111827" },
  cardSub:         { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 3, lineHeight: 17 },
});
