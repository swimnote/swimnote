/**
 * (super)/dashboard.tsx — 슈퍼관리자 홈
 * 하단 탭 없음 · 아이콘형 6개 메뉴 구성
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

const PURPLE = "#7C3AED";

interface PlatformStats {
  total_pools: number;
  approved_pools: number;
  pending_pools: number;
  paid_pools: number;
}

const MENUS = [
  {
    id: "operators",
    icon: "map-pin" as const,
    title: "운영자 관리",
    sub: "수영장·코치 운영 현황",
    color: "#7C3AED",
    bg: "#EDE9FE",
    path: "/(super)/pools",
  },
  {
    id: "subscriptions",
    icon: "credit-card" as const,
    title: "구독 관리",
    sub: "플랜·결제·크레딧",
    color: "#0891B2",
    bg: "#ECFEFF",
    path: "/(super)/subscriptions",
  },
  {
    id: "storage",
    icon: "hard-drive" as const,
    title: "저장공간 관리",
    sub: "용량·업로드 제한",
    color: "#059669",
    bg: "#D1FAE5",
    path: "/(super)/storage-policy",
  },
  {
    id: "kill-switch",
    icon: "alert-triangle" as const,
    title: "킬스위치",
    sub: "데이터 영구 삭제",
    color: "#DC2626",
    bg: "#FEE2E2",
    path: "/(super)/kill-switch",
  },
  {
    id: "policy",
    icon: "file-text" as const,
    title: "정책 관리",
    sub: "환불·운영 정책 문서",
    color: "#D97706",
    bg: "#FEF3C7",
    path: "/(super)/policy",
  },
  {
    id: "op-logs",
    icon: "list" as const,
    title: "운영 로그",
    sub: "승인·구독·킬스위치 기록",
    color: "#4F46E5",
    bg: "#EEF2FF",
    path: "/(super)/op-logs",
  },
];

export default function SuperDashboardScreen() {
  const { logout, user } = useAuth();
  const { token } = useAuth();
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchStats() {
    try {
      const res = await apiRequest(token, "/admin/platform-stats");
      if (res.ok) setStats(await res.json());
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { fetchStats(); }, []);

  const today = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" });

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} tintColor={PURPLE}
            onRefresh={() => { setRefreshing(true); fetchStats(); }} />
        }
      >
        {/* 헤더 */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            <Text style={s.headerTitle}>플랫폼 관리</Text>
            <Text style={s.headerSub}>{today}</Text>
          </View>
          <View style={s.headerRight}>
            <View style={s.avatarCircle}>
              <Text style={s.avatarText}>{user?.name?.[0] ?? "S"}</Text>
            </View>
            <Pressable onPress={logout} style={s.logoutBtn}>
              <Feather name="log-out" size={16} color={PURPLE} />
            </Pressable>
          </View>
        </View>

        {/* 운영자 정보 */}
        <View style={s.profileBanner}>
          <View style={s.profileLeft}>
            <Text style={s.profileName}>{user?.name ?? "슈퍼관리자"}님</Text>
            <Text style={s.profileRole}>슈퍼관리자</Text>
          </View>
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <View style={s.statsRow}>
              <View style={s.statItem}>
                <Text style={s.statNum}>{stats?.total_pools ?? 0}</Text>
                <Text style={s.statLabel}>전체</Text>
              </View>
              <View style={s.statDivider} />
              <View style={s.statItem}>
                <Text style={s.statNum}>{stats?.approved_pools ?? 0}</Text>
                <Text style={s.statLabel}>운영 중</Text>
              </View>
              <View style={s.statDivider} />
              <View style={s.statItem}>
                <Text style={[s.statNum, stats?.pending_pools ? { color: "#FCD34D" } : {}]}>
                  {stats?.pending_pools ?? 0}
                </Text>
                <Text style={s.statLabel}>대기</Text>
              </View>
            </View>
          )}
        </View>

        {/* 대기 알림 */}
        {(stats?.pending_pools ?? 0) > 0 && (
          <Pressable style={s.alertBanner} onPress={() => router.push("/(super)/pools" as any)}>
            <Feather name="bell" size={16} color="#92400E" />
            <Text style={s.alertText}>
              승인 대기 중인 운영자가{" "}
              <Text style={{ fontFamily: "Inter_700Bold" }}>{stats!.pending_pools}개</Text>{" "}
              있습니다 — 확인하기
            </Text>
            <Feather name="chevron-right" size={15} color="#92400E" />
          </Pressable>
        )}

        {/* 6개 메뉴 그리드 */}
        <View style={s.grid}>
          {MENUS.map(menu => (
            <Pressable key={menu.id} style={s.menuCard}
              onPress={() => router.push(menu.path as any)}>
              <View style={[s.menuIcon, { backgroundColor: menu.bg }]}>
                <Feather name={menu.icon} size={28} color={menu.color} />
              </View>
              <Text style={s.menuTitle}>{menu.title}</Text>
              <Text style={s.menuSub} numberOfLines={1}>{menu.sub}</Text>
              <View style={[s.menuArrow, { backgroundColor: menu.bg }]}>
                <Feather name="chevron-right" size={14} color={menu.color} />
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#F5F3FF" },
  header:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                  paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  headerLeft:   {},
  headerRight:  { flexDirection: "row", alignItems: "center", gap: 10 },
  headerTitle:  { fontSize: 26, fontFamily: "Inter_700Bold", color: "#1F1235" },
  headerSub:    { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2 },
  avatarCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: PURPLE,
                  alignItems: "center", justifyContent: "center" },
  avatarText:   { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  logoutBtn:    { width: 36, height: 36, borderRadius: 10, backgroundColor: "#EDE9FE",
                  alignItems: "center", justifyContent: "center" },
  profileBanner:{ marginHorizontal: 20, backgroundColor: PURPLE, borderRadius: 20,
                  padding: 18, flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 12 },
  profileLeft:  { flex: 1 },
  profileName:  { fontSize: 17, fontFamily: "Inter_700Bold", color: "#fff" },
  profileRole:  { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.75)", marginTop: 3 },
  statsRow:     { flexDirection: "row", alignItems: "center", gap: 12 },
  statItem:     { alignItems: "center" },
  statNum:      { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff" },
  statLabel:    { fontSize: 10, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.7)", marginTop: 2 },
  statDivider:  { width: 1, height: 36, backgroundColor: "rgba(255,255,255,0.25)" },
  alertBanner:  { flexDirection: "row", alignItems: "center", gap: 8,
                  marginHorizontal: 20, marginBottom: 12,
                  backgroundColor: "#FEF3C7", borderRadius: 12, padding: 12,
                  borderLeftWidth: 4, borderLeftColor: "#F59E0B" },
  alertText:    { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#92400E" },
  grid:         { paddingHorizontal: 16, paddingTop: 4,
                  flexDirection: "row", flexWrap: "wrap", gap: 12 },
  menuCard:     { width: "47%", backgroundColor: "#fff", borderRadius: 20, padding: 18,
                  shadowColor: "#7C3AED22", shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 1, shadowRadius: 12, elevation: 3, gap: 8, position: "relative" },
  menuIcon:     { width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  menuTitle:    { fontSize: 15, fontFamily: "Inter_700Bold", color: "#111827", marginTop: 4 },
  menuSub:      { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  menuArrow:    { position: "absolute", top: 14, right: 14, width: 26, height: 26,
                  borderRadius: 8, alignItems: "center", justifyContent: "center" },
});
