/**
 * (super)/dashboard.tsx — 슈퍼관리자 운영 콘솔
 * 8개 메뉴 그리드 + 핵심 지표 + 리스크 요약
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiRequest, useAuth } from "@/context/AuthContext";

const P = "#7C3AED";

interface Stats {
  total_operators: number; active_operators: number; pending_operators: number;
  payment_issue_count: number; storage_danger_count: number; deletion_pending_count: number;
}

const MENUS = [
  { id: "ops",     icon: "users" as const,         title: "운영자 관리",    sub: "승인·반려·제한·종료",       path: "/(super)/pools",        color: P,         bg: "#EDE9FE" },
  { id: "sub",     icon: "credit-card" as const,   title: "구독·결제",      sub: "플랜·결제실패·환불·차지백",  path: "/(super)/subscriptions", color: "#0891B2", bg: "#ECFEFF" },
  { id: "store",   icon: "hard-drive" as const,     title: "저장공간",       sub: "사용량·급증·차단·삭제큐",   path: "/(super)/storage",      color: "#059669", bg: "#D1FAE5" },
  { id: "kill",    icon: "alert-triangle" as const, title: "데이터·킬스위치",sub: "삭제·유예·실행로그",        path: "/(super)/kill-switch",  color: "#DC2626", bg: "#FEE2E2" },
  { id: "policy",  icon: "file-text" as const,      title: "정책·컴플라이언스", sub: "환불·개인정보·버전·동의", path: "/(super)/policy",       color: "#D97706", bg: "#FEF3C7" },
  { id: "logs",    icon: "activity" as const,       title: "운영 로그·감사", sub: "결제·삭제·보안 이벤트",     path: "/(super)/op-logs",      color: "#4F46E5", bg: "#EEF2FF" },
  { id: "support", icon: "message-circle" as const, title: "고객센터",       sub: "문의·SLA·환불·결제연결",    path: "/(super)/support",      color: "#0284C7", bg: "#E0F2FE" },
  { id: "risk",    icon: "shield" as const,         title: "장애·리스크",    sub: "오늘 처리 큐·서비스 상태",  path: "/(super)/risk-center",  color: "#9333EA", bg: "#F3E8FF" },
];

export default function SuperDashboard() {
  const { logout, user, token } = useAuth();
  const [stats,      setStats]      = useState<Stats | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    try {
      const res = await apiRequest(token, "/super/dashboard-stats");
      if (res.ok) { const d = await res.json(); setStats(d.stats); }
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { load(); }, []);

  const today = new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
  const totalAlerts = (stats?.pending_operators ?? 0) + (stats?.payment_issue_count ?? 0) +
    (stats?.storage_danger_count ?? 0) + (stats?.deletion_pending_count ?? 0);

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      {/* 헤더 */}
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>운영 콘솔</Text>
          <Text style={s.headerSub}>{today}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {totalAlerts > 0 && (
            <Pressable style={s.alertPill} onPress={() => router.push("/(super)/risk-center" as any)}>
              <Feather name="alert-circle" size={13} color="#DC2626" />
              <Text style={s.alertPillTxt}>{totalAlerts}건 처리 필요</Text>
            </Pressable>
          )}
          <View style={s.avatarCircle}>
            <Text style={s.avatarTxt}>{user?.name?.[0] ?? "S"}</Text>
          </View>
          <Pressable style={s.logoutBtn} onPress={logout}>
            <Feather name="log-out" size={15} color={P} />
          </Pressable>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={P}
          onRefresh={() => { setRefreshing(true); load(); }} />}>

        {/* 6대 핵심 지표 */}
        {loading ? (
          <ActivityIndicator color={P} style={{ marginVertical: 20 }} />
        ) : (
          <View style={s.statsGrid}>
            {[
              { label: "전체 운영자",   v: stats?.total_operators ?? 0,      alert: false, path: "/(super)/pools" },
              { label: "활성 운영자",   v: stats?.active_operators ?? 0,     alert: false, path: "/(super)/pools" },
              { label: "승인 대기",     v: stats?.pending_operators ?? 0,    alert: true,  path: "/(super)/pools?filter=pending" },
              { label: "결제 이슈",     v: stats?.payment_issue_count ?? 0,  alert: true,  path: "/(super)/subscriptions" },
              { label: "저장 위험",     v: stats?.storage_danger_count ?? 0, alert: true,  path: "/(super)/storage" },
              { label: "24h 삭제",      v: stats?.deletion_pending_count ?? 0, alert: true, path: "/(super)/risk-center" },
            ].map((item, i) => (
              <Pressable key={i} style={[s.statCard, item.alert && item.v > 0 && s.statAlert]}
                onPress={() => router.push(item.path as any)}>
                {item.alert && item.v > 0 && <View style={s.alertDot} />}
                <Text style={[s.statNum, item.alert && item.v > 0 && { color: "#DC2626" }]}>{item.v}</Text>
                <Text style={s.statLabel}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* 장애·리스크 센터 진입 버튼 */}
        {totalAlerts > 0 && (
          <Pressable style={s.riskBanner} onPress={() => router.push("/(super)/risk-center" as any)}>
            <View style={[s.riskIconWrap, { backgroundColor: "#F3E8FF" }]}>
              <Feather name="shield" size={18} color="#9333EA" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.riskBannerTitle}>장애·리스크 센터</Text>
              <Text style={s.riskBannerSub}>처리 필요 {totalAlerts}건 · 지금 확인하기</Text>
            </View>
            <View style={s.riskBannerBadge}>
              <Text style={s.riskBannerBadgeTxt}>{totalAlerts}</Text>
            </View>
            <Feather name="chevron-right" size={16} color="#9333EA" />
          </Pressable>
        )}

        {/* 8개 메뉴 2×4 그리드 */}
        <View style={s.menuSection}>
          <View style={s.menuGrid}>
            {MENUS.map(m => (
              <Pressable key={m.id} style={s.menuCard} onPress={() => router.push(m.path as any)}>
                <View style={[s.menuIconBox, { backgroundColor: m.bg }]}>
                  <Feather name={m.icon} size={24} color={m.color} />
                </View>
                <Text style={s.menuTitle}>{m.title}</Text>
                <Text style={s.menuSub} numberOfLines={2}>{m.sub}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* 운영자 정보 */}
        <View style={s.footer}>
          <Feather name="user" size={13} color="#9CA3AF" />
          <Text style={s.footerTxt}>{user?.name ?? "슈퍼관리자"} · 슈퍼관리자 계정</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: "#0F0A1E" },
  header:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                   paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14 },
  headerTitle:   { fontSize: 22, fontFamily: "Inter_700Bold", color: "#F9FAFB" },
  headerSub:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },
  alertPill:     { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#FEE2E2",
                   borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  alertPillTxt:  { fontSize: 11, fontFamily: "Inter_700Bold", color: "#DC2626" },
  avatarCircle:  { width: 34, height: 34, borderRadius: 17, backgroundColor: P,
                   alignItems: "center", justifyContent: "center" },
  avatarTxt:     { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
  logoutBtn:     { width: 34, height: 34, borderRadius: 9, backgroundColor: "rgba(124,58,237,0.15)",
                   alignItems: "center", justifyContent: "center" },

  statsGrid:     { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 14, gap: 8, marginBottom: 10 },
  statCard:      { width: "30.5%", backgroundColor: "#1A1030", borderRadius: 12, padding: 12,
                   borderWidth: 1, borderColor: "#2D1B4E", position: "relative" },
  statAlert:     { borderColor: "#450A0A", backgroundColor: "#1C0A0A" },
  alertDot:      { position: "absolute", top: 8, right: 8, width: 7, height: 7,
                   borderRadius: 3.5, backgroundColor: "#DC2626" },
  statNum:       { fontSize: 24, fontFamily: "Inter_700Bold", color: "#F9FAFB" },
  statLabel:     { fontSize: 10, fontFamily: "Inter_500Medium", color: "#6B7280", marginTop: 2, lineHeight: 14 },

  riskBanner:    { flexDirection: "row", alignItems: "center", gap: 10,
                   marginHorizontal: 14, marginBottom: 12,
                   backgroundColor: "#1A0F2E", borderRadius: 14, padding: 14,
                   borderWidth: 1, borderColor: "#4C1D95" },
  riskIconWrap:  { width: 40, height: 40, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  riskBannerTitle:{ fontSize: 14, fontFamily: "Inter_700Bold", color: "#F9FAFB" },
  riskBannerSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2 },
  riskBannerBadge:{ backgroundColor: "#DC2626", borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  riskBannerBadgeTxt:{ fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" },

  menuSection:   { paddingHorizontal: 14 },
  menuGrid:      { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  menuCard:      { width: "47.5%", backgroundColor: "#1A1030", borderRadius: 16, padding: 16,
                   borderWidth: 1, borderColor: "#2D1B4E", gap: 8 },
  menuIconBox:   { width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  menuTitle:     { fontSize: 14, fontFamily: "Inter_700Bold", color: "#F9FAFB" },
  menuSub:       { fontSize: 10, fontFamily: "Inter_400Regular", color: "#6B7280", lineHeight: 15 },

  footer:        { flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center", paddingTop: 24 },
  footerTxt:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#4B5563" },
});
