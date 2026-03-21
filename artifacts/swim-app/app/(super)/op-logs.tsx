/**
 * (super)/op-logs.tsx — 운영 로그 (이벤트 피드 + 탭 + Invalid Date 수정)
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
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const P = "#7C3AED";

interface LogItem {
  id: string;
  pool_id: string;
  pool_name: string | null;
  category: string;
  actor_name: string | null;
  target: string | null;
  description: string;
  created_at: string;
}

const TABS = ["전체", "권한", "구독", "저장공간", "삭제", "정책", "결제", "보안", "기능 플래그", "읽기전용 전환", "고객센터"];

const CAT_CFG: Record<string, { color: string; bg: string; icon: React.ComponentProps<typeof Feather>["name"] }> = {
  권한:          { color: "#D97706", bg: "#FEF3C7", icon: "shield" },
  구독:          { color: P,         bg: "#EDE9FE", icon: "credit-card" },
  저장공간:      { color: "#059669", bg: "#D1FAE5", icon: "hard-drive" },
  삭제:          { color: "#DC2626", bg: "#FEE2E2", icon: "trash-2" },
  정책:          { color: "#4F46E5", bg: "#EEF2FF", icon: "file-text" },
  결제:          { color: "#0891B2", bg: "#ECFEFF", icon: "dollar-sign" },
  보안:          { color: "#991B1B", bg: "#FEE2E2", icon: "lock" },
  "기능 플래그": { color: "#059669", bg: "#D1FAE5", icon: "toggle-left" },
  "읽기전용 전환": { color: "#7C3AED", bg: "#EDE9FE", icon: "eye-off" },
  고객센터:      { color: "#0284C7", bg: "#E0F2FE", icon: "message-circle" },
};

function safeDate(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function relativeTime(iso: string) {
  const d = safeDate(iso);
  if (!d) return "—";
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const dy = Math.floor(h / 24);
  if (dy < 7) return `${dy}일 전`;
  return d.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

function fullTime(iso: string) {
  const d = safeDate(iso);
  if (!d) return "—";
  return d.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

export default function OpLogsScreen() {
  const { token } = useAuth();
  const [logs,       setLogs]       = useState<LogItem[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab,  setActiveTab]  = useState("전체");
  const [offset,     setOffset]     = useState(0);
  const [hasMore,    setHasMore]    = useState(true);
  const [expanded,   setExpanded]   = useState<Set<string>>(new Set());
  const LIMIT = 30;

  async function load(tab: string, off: number) {
    if (off === 0) setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(LIMIT), offset: String(off) });
      if (tab !== "전체") params.set("category", tab);
      const res = await apiRequest(token, `/super/op-logs?${params}`);
      if (res.ok) {
        const data: LogItem[] = await res.json();
        setLogs(prev => off === 0 ? data : [...prev, ...data]);
        setHasMore(data.length === LIMIT);
        setOffset(off + data.length);
      }
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => {
    setOffset(0); setHasMore(true); setLogs([]);
    load(activeTab, 0);
  }, [activeTab]);

  function toggleExpand(id: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // 날짜 구분선 계산
  function getDateLabel(iso: string): string {
    const d = safeDate(iso);
    if (!d) return "";
    const today = new Date();
    const diff = Math.floor((today.getTime() - d.getTime()) / 86400000);
    if (diff === 0) return "오늘";
    if (diff === 1) return "어제";
    return d.toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
  }

  let lastDateLabel = "";

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="운영 로그" homePath="/(super)/dashboard" />

      {/* 탭 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.tabBar} contentContainerStyle={s.tabContent}>
        {TABS.map(tab => {
          const cfg = CAT_CFG[tab];
          return (
            <Pressable key={tab}
              style={[s.tab, activeTab === tab && (cfg ? { backgroundColor: cfg.color, borderColor: cfg.color } : s.tabAllActive)]}
              onPress={() => setActiveTab(tab)}>
              {cfg && <Feather name={cfg.icon} size={12} color={activeTab === tab ? "#fff" : cfg.color} />}
              <Text style={[s.tabTxt, activeTab === tab && { color: "#fff" }]}>{tab}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {loading && logs.length === 0 ? (
        <ActivityIndicator color={P} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={P}
            onRefresh={() => { setRefreshing(true); load(activeTab, 0); }} />}
          contentContainerStyle={{ paddingBottom: 60, paddingTop: 8 }}>

          {logs.length === 0 && (
            <View style={s.empty}>
              <Feather name="list" size={32} color="#D1D5DB" />
              <Text style={s.emptyTxt}>로그가 없습니다</Text>
            </View>
          )}

          {logs.map(log => {
            const cfg = CAT_CFG[log.category] ?? { color: "#6B7280", bg: "#F3F4F6", icon: "activity" as const };
            const isExpanded = expanded.has(log.id);
            const dateLabel = getDateLabel(log.created_at);
            let showDate = false;
            if (dateLabel && dateLabel !== lastDateLabel) {
              showDate = true;
              lastDateLabel = dateLabel;
            }

            return (
              <React.Fragment key={log.id}>
                {showDate && (
                  <View style={s.dateDivider}>
                    <View style={s.dateLine} />
                    <Text style={s.dateLabel}>{dateLabel}</Text>
                    <View style={s.dateLine} />
                  </View>
                )}

                <Pressable style={s.logCard} onPress={() => toggleExpand(log.id)}>
                  {/* 아이콘 */}
                  <View style={[s.logIcon, { backgroundColor: cfg.bg }]}>
                    <Feather name={cfg.icon as any} size={16} color={cfg.color} />
                  </View>

                  {/* 내용 */}
                  <View style={s.logBody}>
                    <View style={s.logTop}>
                      <Text style={s.logDesc} numberOfLines={isExpanded ? undefined : 2}>{log.description}</Text>
                      <Text style={s.logTime}>{relativeTime(log.created_at)}</Text>
                    </View>

                    <View style={s.logMeta}>
                      <View style={[s.catBadge, { backgroundColor: cfg.bg }]}>
                        <Text style={[s.catTxt, { color: cfg.color }]}>{log.category}</Text>
                      </View>
                      {!!log.actor_name && (
                        <Text style={s.logMetaTxt}>{log.actor_name}</Text>
                      )}
                      {!!log.pool_name && (
                        <><Text style={s.logMetaDot}>·</Text>
                        <Text style={s.logMetaTxt} numberOfLines={1}>{log.pool_name}</Text></>
                      )}
                      <Feather name={isExpanded ? "chevron-up" : "chevron-down"} size={13} color="#D1D5DB" style={{ marginLeft: "auto" }} />
                    </View>

                    {isExpanded && (
                      <View style={s.logDetail}>
                        <View style={s.detailRow}>
                          <Text style={s.detailLabel}>시간</Text>
                          <Text style={s.detailVal}>{fullTime(log.created_at)}</Text>
                        </View>
                        {!!log.actor_name && (
                          <View style={s.detailRow}>
                            <Text style={s.detailLabel}>작업자</Text>
                            <Text style={s.detailVal}>{log.actor_name}</Text>
                          </View>
                        )}
                        {!!log.pool_name && (
                          <View style={s.detailRow}>
                            <Text style={s.detailLabel}>운영자</Text>
                            <Pressable onPress={() => router.push(`/(super)/operator-detail?id=${log.pool_id}` as any)}>
                              <Text style={[s.detailVal, { color: P, textDecorationLine: "underline" }]}>{log.pool_name}</Text>
                            </Pressable>
                          </View>
                        )}
                        {!!log.target && (
                          <View style={s.detailRow}>
                            <Text style={s.detailLabel}>대상</Text>
                            <Text style={s.detailVal}>{log.target}</Text>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                </Pressable>
              </React.Fragment>
            );
          })}

          {hasMore && logs.length > 0 && (
            <Pressable style={s.loadMore} onPress={() => load(activeTab, offset)}>
              <Text style={s.loadMoreTxt}>더 보기</Text>
            </Pressable>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#F5F3FF" },
  tabBar:       { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", flexGrow: 0 },
  tabContent:   { paddingHorizontal: 12, paddingVertical: 8, gap: 6, flexDirection: "row" },
  tab:          { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 7,
                  borderRadius: 20, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#fff" },
  tabAllActive: { backgroundColor: P, borderColor: P },
  tabTxt:       { fontSize: 12, fontFamily: "Inter_500Medium", color: "#6B7280" },
  dateDivider:  { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 6 },
  dateLine:     { flex: 1, height: 1, backgroundColor: "#E5E7EB" },
  dateLabel:    { fontSize: 11, fontFamily: "Inter_500Medium", color: "#9CA3AF" },
  logCard:      { flexDirection: "row", alignItems: "flex-start", gap: 10,
                  paddingHorizontal: 14, paddingVertical: 12,
                  backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  logIcon:      { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 2, flexShrink: 0 },
  logBody:      { flex: 1, gap: 6 },
  logTop:       { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  logDesc:      { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#374151", lineHeight: 19 },
  logTime:      { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", flexShrink: 0 },
  logMeta:      { flexDirection: "row", alignItems: "center", gap: 6 },
  catBadge:     { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  catTxt:       { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  logMetaTxt:   { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  logMetaDot:   { fontSize: 10, color: "#D1D5DB" },
  logDetail:    { backgroundColor: "#F9FAFB", borderRadius: 8, padding: 10, gap: 5 },
  detailRow:    { flexDirection: "row", gap: 8 },
  detailLabel:  { width: 48, fontSize: 11, fontFamily: "Inter_500Medium", color: "#9CA3AF" },
  detailVal:    { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", color: "#374151" },
  empty:        { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyTxt:     { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  loadMore:     { margin: 16, paddingVertical: 14, borderRadius: 12, backgroundColor: "#fff",
                  alignItems: "center", borderWidth: 1.5, borderColor: "#E5E7EB" },
  loadMoreTxt:  { fontSize: 13, fontFamily: "Inter_600SemiBold", color: P },
});
