/**
 * (super)/op-logs.tsx — 운영 로그
 * 슈퍼관리자 전용 cross-pool 이벤트 로그 조회
 * 로그 항목: 시간 · 작업자 · 대상 · 작업 내용
 */
import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const PURPLE = "#7C3AED";

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

const CATEGORY_OPTS = ["전체", "삭제", "구독", "저장공간", "권한", "정책", "결제", "선생님", "휴무일"];

const CAT_STYLE: Record<string, { color: string; bg: string }> = {
  삭제:    { color: "#DC2626", bg: "#FEE2E2" },
  구독:    { color: "#7C3AED", bg: "#EDE9FE" },
  저장공간: { color: "#059669", bg: "#D1FAE5" },
  권한:    { color: "#D97706", bg: "#FEF3C7" },
  정책:    { color: "#4F46E5", bg: "#EEF2FF" },
  결제:    { color: "#0891B2", bg: "#ECFEFF" },
  선생님:  { color: "#0284C7", bg: "#E0F2FE" },
  휴무일:  { color: "#6B7280", bg: "#F3F4F6" },
};

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7)  return `${d}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

function fullTime(iso: string) {
  return new Date(iso).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

export default function OpLogsScreen() {
  const { token } = useAuth();
  const [logs,       setLogs]       = useState<LogItem[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [category,   setCategory]   = useState("전체");
  const [offset,     setOffset]     = useState(0);
  const [hasMore,    setHasMore]    = useState(true);
  const [expanded,   setExpanded]   = useState<Set<string>>(new Set());
  const LIMIT = 30;

  async function load(cat: string, off: number, reset = false) {
    if (off === 0) setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(LIMIT), offset: String(off) });
      if (cat !== "전체") params.set("category", cat);
      const res = await apiRequest(token, `/super/op-logs?${params}`);
      if (res.ok) {
        const data: LogItem[] = await res.json();
        setLogs(prev => reset || off === 0 ? data : [...prev, ...data]);
        setHasMore(data.length === LIMIT);
        setOffset(off + data.length);
      }
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { load(category, 0, true); }, [category]);

  function handleCategoryChange(cat: string) {
    setCategory(cat);
    setOffset(0);
    setHasMore(true);
  }

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="운영 로그" homePath="/(super)/dashboard" />

      {/* 카테고리 필터 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.filterBar} contentContainerStyle={s.filterContent}>
        {CATEGORY_OPTS.map(cat => (
          <Pressable key={cat}
            style={[s.filterChip, category === cat && s.filterActive]}
            onPress={() => handleCategoryChange(cat)}>
            <Text style={[s.filterTxt, category === cat && s.filterActiveTxt]}>{cat}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {loading && logs.length === 0 ? (
        <ActivityIndicator color={PURPLE} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={PURPLE}
            onRefresh={() => { setRefreshing(true); load(category, 0, true); }} />}
          contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 60 }}>

          {logs.length === 0 && (
            <View style={s.emptyBox}>
              <Feather name="list" size={36} color="#D1D5DB" />
              <Text style={s.emptyTxt}>로그가 없습니다</Text>
            </View>
          )}

          {logs.map(log => {
            const cs = CAT_STYLE[log.category] ?? { color: "#6B7280", bg: "#F3F4F6" };
            const isExpanded = expanded.has(log.id);
            return (
              <Pressable key={log.id} style={s.logCard} onPress={() => toggleExpand(log.id)}>
                <View style={s.logTop}>
                  <View style={[s.catBadge, { backgroundColor: cs.bg }]}>
                    <Text style={[s.catTxt, { color: cs.color }]}>{log.category}</Text>
                  </View>
                  <Text style={s.logTime}>{relativeTime(log.created_at)}</Text>
                </View>
                <Text style={s.logDesc}>{log.description}</Text>
                {isExpanded && (
                  <View style={s.logDetail}>
                    <View style={s.detailRow}>
                      <Text style={s.detailLabel}>시간</Text>
                      <Text style={s.detailVal}>{fullTime(log.created_at)}</Text>
                    </View>
                    <View style={s.detailRow}>
                      <Text style={s.detailLabel}>작업자</Text>
                      <Text style={s.detailVal}>{log.actor_name ?? "—"}</Text>
                    </View>
                    {!!log.pool_name && (
                      <View style={s.detailRow}>
                        <Text style={s.detailLabel}>운영자</Text>
                        <Text style={s.detailVal}>{log.pool_name}</Text>
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
                <View style={s.logBottom}>
                  {!!log.actor_name && (
                    <View style={s.actorRow}>
                      <Feather name="user" size={11} color="#9CA3AF" />
                      <Text style={s.actorTxt}>{log.actor_name}</Text>
                    </View>
                  )}
                  {!!log.pool_name && (
                    <View style={s.actorRow}>
                      <Feather name="map-pin" size={11} color="#9CA3AF" />
                      <Text style={s.actorTxt} numberOfLines={1}>{log.pool_name}</Text>
                    </View>
                  )}
                  <Feather name={isExpanded ? "chevron-up" : "chevron-down"} size={14} color="#9CA3AF" style={{ marginLeft: "auto" }} />
                </View>
              </Pressable>
            );
          })}

          {hasMore && logs.length > 0 && (
            <Pressable style={s.loadMore} onPress={() => load(category, offset)}>
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
  filterBar:    { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", flexGrow: 0 },
  filterContent:{ paddingHorizontal: 16, paddingVertical: 8, gap: 6, flexDirection: "row" },
  filterChip:   { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#fff" },
  filterActive: { backgroundColor: PURPLE, borderColor: PURPLE },
  filterTxt:    { fontSize: 13, fontFamily: "Inter_500Medium", color: "#6B7280" },
  filterActiveTxt: { color: "#fff" },
  emptyBox:     { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyTxt:     { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  logCard:      { backgroundColor: "#fff", borderRadius: 14, padding: 14, gap: 6,
                  borderWidth: 1, borderColor: "#E5E7EB" },
  logTop:       { flexDirection: "row", alignItems: "center", gap: 8 },
  catBadge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  catTxt:       { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  logTime:      { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginLeft: "auto" },
  logDesc:      { fontSize: 13, fontFamily: "Inter_500Medium", color: "#374151", lineHeight: 19 },
  logDetail:    { backgroundColor: "#F9FAFB", borderRadius: 10, padding: 10, gap: 6, marginTop: 4 },
  detailRow:    { flexDirection: "row", gap: 8 },
  detailLabel:  { width: 48, fontSize: 12, fontFamily: "Inter_500Medium", color: "#9CA3AF" },
  detailVal:    { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#374151" },
  logBottom:    { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  actorRow:     { flexDirection: "row", alignItems: "center", gap: 3 },
  actorTxt:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  loadMore:     { paddingVertical: 14, borderRadius: 12, backgroundColor: "#fff",
                  alignItems: "center", borderWidth: 1.5, borderColor: "#E5E7EB" },
  loadMoreTxt:  { fontSize: 13, fontFamily: "Inter_600SemiBold", color: PURPLE },
});
