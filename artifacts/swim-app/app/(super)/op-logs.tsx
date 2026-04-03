/**
 * (super)/op-logs.tsx — 운영 로그 (감사 로그 뷰어)
 * /super/op-logs API에서 실데이터 로드
 */
import { Activity, List } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";

const C = Colors.light;
const P = "#7C3AED";

const TABS = ["전체", "운영자관리", "구독", "저장공간", "삭제", "정책", "결제", "보안", "기능 플래그", "읽기전용", "고객센터"];

const CAT_CFG: Record<string, { color: string; bg: string; icon: string }> = {
  운영자관리:   { color: "#D97706", bg: "#FFF1BF", icon: "shield" },
  구독:         { color: P,         bg: "#EEDDF5", icon: "credit-card" },
  저장공간:     { color: "#2EC4B6", bg: "#E6FFFA", icon: "hard-drive" },
  삭제:         { color: "#D96C6C", bg: "#F9DEDA", icon: "trash-2" },
  정책:         { color: "#2EC4B6", bg: "#E6FFFA", icon: "file-text" },
  결제:         { color: "#2EC4B6", bg: "#ECFEFF", icon: "dollar-sign" },
  보안:         { color: "#991B1B", bg: "#F9DEDA", icon: "lock" },
  "기능 플래그":{ color: "#2EC4B6", bg: "#E6FFFA", icon: "toggle-left" },
  읽기전용:     { color: "#7C3AED", bg: "#EEDDF5", icon: "eye-off" },
  고객센터:     { color: "#0284C7", bg: "#E0F2FE", icon: "message-circle" },
};

interface OpLog {
  id: string;
  pool_id: string | null;
  category: string;
  actor_id: string | null;
  actor_name: string | null;
  target: string | null;
  description: string;
  metadata: any;
  created_at: string;
  pool_name: string | null;
}

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

function getDateLabel(iso: string): string {
  const d = safeDate(iso);
  if (!d) return "";
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diff === 0) return "오늘";
  if (diff === 1) return "어제";
  return d.toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
}

export default function OpLogsScreen() {
  const { token } = useAuth();
  const [activeTab, setActiveTab] = useState("전체");
  const [logs, setLogs]           = useState<OpLog[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded]   = useState<Set<string>>(new Set());
  const [error, setError]         = useState<string | null>(null);

  const fetchLogs = useCallback(async (tab: string) => {
    if (!token) return;
    try {
      const cat = tab === "전체" ? "" : `&category=${encodeURIComponent(tab)}`;
      const res = await apiRequest(token, `/super/op-logs?limit=100${cat}`);
      if (!res.ok) { setError("로그를 불러오지 못했습니다"); return; }
      const data = await res.json();
      setLogs(Array.isArray(data) ? data as OpLog[] : []);
      setError(null);
    } catch {
      setError("네트워크 오류가 발생했습니다");
    }
  }, [token]);

  useEffect(() => {
    setLoading(true);
    fetchLogs(activeTab).finally(() => setLoading(false));
  }, [fetchLogs, activeTab]);

  async function switchTab(tab: string) {
    setActiveTab(tab);
  }

  async function onRefresh() {
    setRefreshing(true);
    await fetchLogs(activeTab);
    setRefreshing(false);
  }

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  let lastDateLabel = "";

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="운영 로그" homePath="/(super)/audit-group" />

      <View style={s.countBanner}>
        <Activity size={13} color={P} />
        <Text style={s.countTxt}>
          총 <Text style={{ color: P, fontFamily: "Pretendard-Regular" }}>{logs.length}</Text>건 기록됨
        </Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.tabBar} contentContainerStyle={s.tabContent}>
        {TABS.map(tab => {
          const cfg = CAT_CFG[tab];
          const isActive = activeTab === tab;
          return (
            <Pressable key={tab}
              style={[s.tab, isActive && (cfg ? { backgroundColor: cfg.color, borderColor: cfg.color } : s.tabAllActive)]}
              onPress={() => switchTab(tab)}>
              {cfg && <LucideIcon name={cfg.icon} size={12} color={isActive ? "#fff" : cfg.color} />}
              <Text style={[s.tabTxt, isActive && { color: "#fff" }]}>{tab}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {loading && !refreshing ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={P} />
        </View>
      ) : error ? (
        <View style={s.empty}>
          <List size={32} color="#D1D5DB" />
          <Text style={s.emptyTxt}>{error}</Text>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={P} onRefresh={onRefresh} />}
          contentContainerStyle={{ paddingBottom: 60, paddingTop: 8 }}>

          {logs.length === 0 && (
            <View style={s.empty}>
              <List size={32} color="#D1D5DB" />
              <Text style={s.emptyTxt}>해당 카테고리의 로그가 없습니다</Text>
            </View>
          )}

          {logs.map(log => {
            const cfg = CAT_CFG[log.category] ?? { color: "#64748B", bg: "#FFFFFF", icon: "activity" as const };
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
                  <View style={[s.logIcon, { backgroundColor: cfg.bg }]}>
                    <LucideIcon name={cfg.icon as any} size={16} color={cfg.color} />
                  </View>

                  <View style={s.logBody}>
                    <View style={s.logTop}>
                      <Text style={s.logDesc} numberOfLines={isExpanded ? undefined : 2}>{log.description}</Text>
                      <Text style={s.logTime}>{relativeTime(log.created_at)}</Text>
                    </View>

                    {log.target && !isExpanded && (
                      <Text style={s.logSubDesc} numberOfLines={1}>{log.target}</Text>
                    )}

                    <View style={s.logMeta}>
                      <View style={[s.catBadge, { backgroundColor: cfg.bg }]}>
                        <Text style={[s.catTxt, { color: cfg.color }]}>{log.category}</Text>
                      </View>
                      {!!log.actor_name && (
                        <Text style={s.logMetaTxt}>{log.actor_name}</Text>
                      )}
                      {!!log.pool_name && (
                        <><Text style={s.logMetaDot}>·</Text>
                          <Text style={s.logMetaTxt} numberOfLines={1}>{log.pool_name}</Text>
                        </>
                      )}
                      <View style={{ marginLeft: "auto" }}>
                        <LucideIcon name={isExpanded ? "chevron-up" : "chevron-down"} size={13} color="#D1D5DB" />
                      </View>
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
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: C.background },
  countBanner:  { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fff", paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#FFFFFF" },
  countTxt:     { fontFamily: "Pretendard-Regular", fontSize: 13, color: "#0F172A" },
  tabBar:       { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", flexGrow: 0 },
  tabContent:   { paddingHorizontal: 12, paddingVertical: 8, gap: 6, flexDirection: "row" },
  tab:          { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 7,
                  borderRadius: 20, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#fff" },
  tabAllActive: { backgroundColor: P, borderColor: P },
  tabTxt:       { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B" },
  dateDivider:  { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 6 },
  dateLine:     { flex: 1, height: 1, backgroundColor: "#E5E7EB" },
  dateLabel:    { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  logCard:      { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#FFFFFF" },
  logIcon:      { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 2, flexShrink: 0 },
  logBody:      { flex: 1, gap: 5 },
  logTop:       { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  logDesc:      { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A", lineHeight: 19 },
  logSubDesc:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B" },
  logTime:      { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", flexShrink: 0 },
  logMeta:      { flexDirection: "row", alignItems: "center", gap: 5 },
  catBadge:     { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  catTxt:       { fontSize: 10, fontFamily: "Pretendard-Regular" },
  logMetaTxt:   { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  logMetaDot:   { fontSize: 10, color: "#D1D5DB" },
  logDetail:    { backgroundColor: "#F1F5F9", borderRadius: 8, padding: 10, gap: 5 },
  detailRow:    { flexDirection: "row", gap: 8 },
  detailLabel:  { width: 48, fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  detailVal:    { flex: 1, fontSize: 11, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  empty:        { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyTxt:     { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#64748B" },
});
