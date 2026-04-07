/**
 * (super)/audit-group.tsx — 감사·리스크 그룹
 * 실 API 연결 완료 — useAuditLogStore / useRiskStore 완전 제거
 */
import { ChevronRight } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useAuth, apiRequest } from "@/context/AuthContext";
import Colors from "@/constants/colors";
const C = Colors.light;

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
    bg: "#E6FAF8",
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

interface RecentLog {
  id: string;
  category: string;
  description: string;
  actor_name: string;
  created_at: string;
  pool_name?: string;
}

interface Summary {
  totalLogs: number;
  todayLogs: number;
  criticalLogs: number;
  securityEvents: number;
}

export default function AuditGroupScreen() {
  const { token } = useAuth();

  const [recentLogs, setRecentLogs] = useState<RecentLog[]>([]);
  const [summary,    setSummary]    = useState<Summary>({ totalLogs: 0, todayLogs: 0, criticalLogs: 0, securityEvents: 0 });
  const [loading,    setLoading]    = useState(true);

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [logsRes, riskRes] = await Promise.all([
        apiRequest(token, '/super/recent-audit-logs?limit=10'),
        apiRequest(token, '/super/risk-summary'),
      ]);

      let logs: RecentLog[] = [];
      if (logsRes.ok) {
        const d = await logsRes.json();
        logs = Array.isArray(d?.logs) ? d.logs : [];
        setRecentLogs(logs);
      }

      if (riskRes.ok) {
        const r = await riskRes.json();
        const today = new Date();
        const todayCount = logs.filter(l => {
          const d = new Date(l.created_at);
          return d.getFullYear() === today.getFullYear() &&
                 d.getMonth()    === today.getMonth()    &&
                 d.getDate()     === today.getDate();
        }).length;
        setSummary({
          totalLogs:      logs.length,
          todayLogs:      todayCount,
          criticalLogs:   0,
          securityEvents: r?.security_events ?? 0,
        });
      }
    } catch (e) {
      console.error('AuditGroup fetchData error:', e);
    } finally {
      setLoading(false);
    }
  }, [token]);

  // 화면 진입·재진입 시 최신 감사 데이터 재조회
  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="감사·리스크" homePath="/(super)/dashboard" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 60 }}>
        {/* 요약 */}
        {loading
          ? <ActivityIndicator color="#2EC4B6" style={{ marginTop: 20 }} />
          : (
            <View style={[s.summaryRow, { flexWrap: "wrap" }]}>
              <View style={s.summaryCard}>
                <Text style={s.summaryNum}>{summary.totalLogs}</Text>
                <Text style={s.summaryLabel}>최근 로그</Text>
              </View>
              <View style={s.summaryCard}>
                <Text style={s.summaryNum}>{summary.todayLogs}</Text>
                <Text style={s.summaryLabel}>오늘 로그</Text>
              </View>
              <View style={[s.summaryCard, summary.criticalLogs > 0 && s.summaryAlertRed]}>
                <Text style={[s.summaryNum, summary.criticalLogs > 0 && { color: "#D96C6C" }]}>{summary.criticalLogs}</Text>
                <Text style={s.summaryLabel}>심각 이벤트</Text>
              </View>
              <View style={[s.summaryCard, summary.securityEvents > 0 && s.summaryAlertRed]}>
                <Text style={[s.summaryNum, summary.securityEvents > 0 && { color: "#D96C6C" }]}>{summary.securityEvents}</Text>
                <Text style={s.summaryLabel}>보안 이벤트</Text>
              </View>
            </View>
          )
        }

        {/* 최근 로그 미리보기 */}
        {recentLogs.slice(0, 3).map(log => (
          <View key={log.id} style={s.logRow}>
            <View style={s.catBadge}>
              <Text style={s.catTxt}>{log.category}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.logTitle} numberOfLines={1}>{log.description}</Text>
              <Text style={s.logMeta}>
                {log.actor_name}
                {log.pool_name ? ` · ${log.pool_name}` : ""}
                {" · "}
                {new Date(log.created_at).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          </View>
        ))}

        <Pressable style={s.viewAllBtn} onPress={() => router.push('/(super)/op-logs?backTo=audit-group' as any)}>
          <Text style={s.viewAllTxt}>전체 로그 보기 →</Text>
        </Pressable>

        <View style={s.divider} />

        {MENUS.map((m, idx) => (
          <Pressable key={idx} style={s.card} onPress={() => router.push((m.path + "?backTo=audit-group") as any)}>
            <View style={[s.iconBox, { backgroundColor: m.bg }]}>
              <LucideIcon name={m.icon} size={22} color={m.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>{m.title}</Text>
              <Text style={s.cardSub}>{m.sub}</Text>
            </View>
            <ChevronRight size={16} color="#D1D5DB" />
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
  summaryNum:      { fontSize: 20, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  summaryLabel:    { fontSize: 9, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2, textAlign: "center" },
  logRow:          { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff",
                     borderRadius: 10, padding: 10, borderWidth: 1, borderColor: "#E5E7EB" },
  catBadge:        { backgroundColor: "#E6FFFA", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  catTxt:          { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#2EC4B6" },
  logTitle:        { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  logMeta:         { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2 },
  viewAllBtn:      { alignItems: "center", paddingVertical: 10 },
  viewAllTxt:      { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#2EC4B6" },
  divider:         { height: 1, backgroundColor: "#E5E7EB", marginVertical: 4 },
  card:            { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "#fff",
                     borderRadius: 14, padding: 16, borderWidth: 1, borderColor: "#E5E7EB" },
  iconBox:         { width: 48, height: 48, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  cardTitle:       { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  cardSub:         { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 3, lineHeight: 17 },
});
