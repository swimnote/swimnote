import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useTabScrollReset } from "@/hooks/useTabScrollReset";

const PURPLE = "#7C3AED";

interface PlatformStats {
  total_pools: number;
  approved_pools: number;
  pending_pools: number;
  rejected_pools: number;
  paid_pools: number;
  free_pools: number;
}

interface Pool {
  id: string;
  name: string;
  owner_name: string;
  approval_status: string;
  member_count: number;
  subscription_tier: { tier: string; label: string; isFree: boolean };
}

const TIER_ORDER = [
  { tier: "paid_1000",       label: "1,000명 구독",  color: "#7C3AED", bg: "#F3E8FF", icon: "star" as const },
  { tier: "paid_500",        label: "500명 구독",    color: "#1D4ED8", bg: "#EFF6FF", icon: "award" as const },
  { tier: "paid_300",        label: "300명 구독",    color: "#0891B2", bg: "#ECFEFF", icon: "layers" as const },
  { tier: "paid_100",        label: "100명 구독",    color: "#059669", bg: "#ECFDF5", icon: "users" as const },
  { tier: "free",            label: "무료 이용",      color: "#6B7280", bg: "#F3F4F6", icon: "gift" as const },
  { tier: "paid_enterprise", label: "엔터프라이즈",   color: "#DC2626", bg: "#FEF2F2", icon: "zap" as const },
  { tier: "unapproved",      label: "미승인 / 반려",  color: "#D97706", bg: "#FEF3C7", icon: "clock" as const },
];

export default function SuperDashboardScreen() {
  const { token, logout, user } = useAuth();
  const insets = useSafeAreaInsets();
  const scrollRef = useTabScrollReset("dashboard");

  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [pools, setPools] = useState<Pool[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  async function fetchAll() {
    try {
      const [statsRes, poolsRes] = await Promise.all([
        apiRequest(token, "/admin/platform-stats"),
        apiRequest(token, "/admin/pools"),
      ]);
      const [s, p] = await Promise.all([statsRes.json(), poolsRes.json()]);
      setStats(s);
      setPools(Array.isArray(p) ? p : []);
      // 처음 로드 시 상위 2개 섹션 자동 펼침
      const initialExpand: Record<string, boolean> = {};
      TIER_ORDER.slice(0, 2).forEach(t => { initialExpand[t.tier] = true; });
      setExpanded(prev => Object.keys(prev).length ? prev : initialExpand);
    } catch (err) { console.error(err); }
    finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { fetchAll(); }, []);

  function toggleTier(tier: string) {
    setExpanded(prev => ({ ...prev, [tier]: !prev[tier] }));
  }

  // 풀을 티어별로 분류
  const grouped = TIER_ORDER.map(t => ({
    ...t,
    pools: pools.filter(p => p.subscription_tier.tier === t.tier),
  })).filter(g => g.pools.length > 0);

  const pendingPools = pools.filter(p => p.approval_status === "pending");

  return (
    <View style={{ flex: 1, backgroundColor: "#F5F3FF" }}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20), paddingBottom: insets.bottom + 100, paddingHorizontal: 20, gap: 20 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAll(); }} tintColor={PURPLE} />}
        showsVerticalScrollIndicator={false}
      >
        {/* 헤더 */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerTitle}>플랫폼 운영 현황</Text>
            <Text style={styles.headerSub}>{user?.name || "운영자"} · 슈퍼관리자</Text>
          </View>
          <Pressable onPress={logout} style={styles.logoutBtn}>
            <Feather name="log-out" size={18} color={PURPLE} />
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator color={PURPLE} size="large" style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* 플랫폼 통계 카드 3개 */}
            <View style={styles.statsRow}>
              {[
                { label: "총 등록\n수영장", value: stats?.total_pools ?? 0, icon: "map-pin" as const, color: PURPLE, bg: "#EDE9FE" },
                { label: "승인된\n수영장",  value: stats?.approved_pools ?? 0, icon: "check-circle" as const, color: "#059669", bg: "#D1FAE5" },
                { label: "미승인\n수영장",  value: stats?.pending_pools ?? 0,  icon: "clock" as const, color: "#D97706", bg: "#FEF3C7" },
              ].map(s => (
                <View key={s.label} style={[styles.statCard, { shadowColor: PURPLE + "22" }]}>
                  <View style={[styles.statIcon, { backgroundColor: s.bg }]}>
                    <Feather name={s.icon} size={18} color={s.color} />
                  </View>
                  <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
                  <Text style={styles.statLabel}>{s.label}</Text>
                </View>
              ))}
            </View>

            {/* 유료 / 무료 요약 */}
            <View style={[styles.summaryCard, { shadowColor: PURPLE + "22" }]}>
              <View style={styles.summaryRow}>
                <View style={styles.summaryItem}>
                  <Feather name="credit-card" size={16} color={PURPLE} />
                  <Text style={styles.summaryLabel}>유료 구독</Text>
                  <Text style={[styles.summaryValue, { color: PURPLE }]}>{stats?.paid_pools ?? 0}개</Text>
                </View>
                <View style={[styles.dividerV]} />
                <View style={styles.summaryItem}>
                  <Feather name="gift" size={16} color="#6B7280" />
                  <Text style={styles.summaryLabel}>무료 이용</Text>
                  <Text style={[styles.summaryValue, { color: "#6B7280" }]}>{stats?.free_pools ?? 0}개</Text>
                </View>
                <View style={[styles.dividerV]} />
                <View style={styles.summaryItem}>
                  <Feather name="alert-circle" size={16} color="#D97706" />
                  <Text style={styles.summaryLabel}>반려</Text>
                  <Text style={[styles.summaryValue, { color: "#D97706" }]}>{stats?.rejected_pools ?? 0}개</Text>
                </View>
              </View>
            </View>

            {/* 승인 대기 알림 배너 */}
            {pendingPools.length > 0 && (
              <View style={styles.pendingBanner}>
                <Feather name="bell" size={16} color="#92400E" />
                <Text style={styles.pendingText}>
                  승인 대기 중인 수영장이 <Text style={{ fontFamily: "Inter_700Bold" }}>{pendingPools.length}개</Text> 있습니다
                </Text>
              </View>
            )}

            {/* 빠른 메뉴 */}
            <View style={styles.quickRow}>
              <Pressable
                style={[styles.quickBtn, { backgroundColor: "#EDE9FE" }]}
                onPress={() => router.push("/(super)/storage-policy" as any)}
              >
                <Feather name="hard-drive" size={18} color={PURPLE} />
                <Text style={[styles.quickTxt, { color: PURPLE }]}>저장 용량 정책</Text>
              </Pressable>
              <Pressable
                style={[styles.quickBtn, { backgroundColor: "#FEF3C7" }]}
                onPress={() => router.push("/(super)/pools" as any)}
              >
                <Feather name="clock" size={18} color="#D97706" />
                <Text style={[styles.quickTxt, { color: "#D97706" }]}>승인 대기 {stats?.pending_pools ?? 0}건</Text>
              </Pressable>
            </View>

            {/* 구독 단계별 수영장 목록 */}
            <Text style={styles.sectionTitle}>구독 단계별 현황</Text>
            {grouped.length === 0 ? (
              <View style={styles.emptyBox}>
                <Feather name="inbox" size={32} color="#A78BFA" />
                <Text style={styles.emptyText}>등록된 수영장이 없습니다</Text>
              </View>
            ) : (
              grouped.map(group => (
                <View key={group.tier} style={[styles.tierSection, { shadowColor: PURPLE + "22" }]}>
                  {/* 티어 헤더 (탭 시 펼침) */}
                  <Pressable
                    style={[styles.tierHeader, { backgroundColor: group.bg }]}
                    onPress={() => toggleTier(group.tier)}
                  >
                    <View style={[styles.tierIconWrap, { backgroundColor: group.color + "20" }]}>
                      <Feather name={group.icon} size={16} color={group.color} />
                    </View>
                    <Text style={[styles.tierLabel, { color: group.color }]}>{group.label}</Text>
                    <View style={[styles.tierCount, { backgroundColor: group.color }]}>
                      <Text style={styles.tierCountText}>{group.pools.length}</Text>
                    </View>
                    <Feather
                      name={expanded[group.tier] ? "chevron-up" : "chevron-down"}
                      size={18} color={group.color} style={{ marginLeft: "auto" }}
                    />
                  </Pressable>

                  {/* 수영장 목록 */}
                  {expanded[group.tier] && (
                    <View style={styles.tierBody}>
                      {group.pools.map((pool, idx) => (
                        <View
                          key={pool.id}
                          style={[
                            styles.poolRow,
                            idx < group.pools.length - 1 && styles.poolRowBorder,
                          ]}
                        >
                          <View style={[styles.poolDot, { backgroundColor: group.color }]} />
                          <View style={styles.poolInfo}>
                            <Text style={styles.poolName}>{pool.name}</Text>
                            <Text style={styles.poolOwner}>{pool.owner_name} 대표</Text>
                          </View>
                          <View style={styles.memberBadge}>
                            <Feather name="users" size={11} color="#6B7280" />
                            <Text style={styles.memberCount}>{pool.member_count}명</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  headerTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: "#1F1235" },
  headerSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },
  logoutBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#EDE9FE", alignItems: "center", justifyContent: "center" },
  statsRow: { flexDirection: "row", gap: 10 },
  statCard: { flex: 1, backgroundColor: "#fff", borderRadius: 16, padding: 14, alignItems: "center", gap: 6, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 10, elevation: 3 },
  statIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  statValue: { fontSize: 26, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280", textAlign: "center", lineHeight: 15 },
  summaryCard: { backgroundColor: "#fff", borderRadius: 16, padding: 16, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 10, elevation: 3 },
  summaryRow: { flexDirection: "row", alignItems: "center" },
  summaryItem: { flex: 1, alignItems: "center", gap: 4 },
  summaryLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280" },
  summaryValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  dividerV: { width: 1, height: 44, backgroundColor: "#E5E7EB" },
  pendingBanner: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#FEF3C7", borderRadius: 12, padding: 14, borderLeftWidth: 4, borderLeftColor: "#F59E0B" },
  pendingText: { fontSize: 14, fontFamily: "Inter_500Medium", color: "#92400E", flex: 1 },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: "#1F1235" },
  quickRow: { flexDirection: "row", gap: 12 },
  quickBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, paddingVertical: 14 },
  quickTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  emptyBox: { alignItems: "center", paddingVertical: 40, gap: 10, backgroundColor: "#fff", borderRadius: 16 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#A78BFA" },
  tierSection: { backgroundColor: "#fff", borderRadius: 16, overflow: "hidden", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 10, elevation: 3 },
  tierHeader: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14 },
  tierIconWrap: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  tierLabel: { fontSize: 15, fontFamily: "Inter_700Bold" },
  tierCount: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20 },
  tierCountText: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" },
  tierBody: { paddingHorizontal: 14, paddingBottom: 6 },
  poolRow: { flexDirection: "row", alignItems: "center", paddingVertical: 11, gap: 10 },
  poolRowBorder: { borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  poolDot: { width: 8, height: 8, borderRadius: 4 },
  poolInfo: { flex: 1 },
  poolName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#1F2937" },
  poolOwner: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  memberBadge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#F3F4F6", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  memberCount: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#6B7280" },
});
