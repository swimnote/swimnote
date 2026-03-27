/**
 * 이벤트 기록 타임라인
 * 카테고리 필터 + 무한 스크롤 FlatList
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const C = Colors.light;

interface EventLogItem {
  id: string; pool_id: string; category: string;
  actor_id: string; actor_name: string; target: string | null;
  description: string; metadata: any; created_at: string;
}

const CAT_META: Record<string, { icon: string; color: string; bg: string }> = {
  "삭제":     { icon: "trash-2",     color: "#D96C6C", bg: "#F9DEDA" },
  "결제":     { icon: "credit-card", color: "#2EC4B6", bg: "#E6FFFA" },
  "구독":     { icon: "star",        color: "#7C3AED", bg: "#EEDDF5" },
  "해지":     { icon: "x-circle",    color: "#E4A93A", bg: "#FFF1BF" },
  "권한":     { icon: "shield",      color: "#2EC4B6", bg: "#E6FFFA" },
  "선생님":   { icon: "user-check",  color: "#0D9488", bg: "#CCFBF1" },
  "저장공간": { icon: "hard-drive",  color: "#EC4899", bg: "#F6D8E1" },
  "휴무일":   { icon: "calendar",    color: "#6B7280", bg: "#F8FAFC" },
};
const CATEGORIES = ["전체", "삭제", "결제", "구독", "해지", "권한", "선생님", "저장공간", "휴무일"] as const;

export default function DataEventLogsScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const [logs,        setLogs]        = useState<EventLogItem[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [page,        setPage]        = useState(0);
  const [hasMore,     setHasMore]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [filter,      setFilter]      = useState("전체");

  const load = useCallback(async (p = 0, cat = filter) => {
    if (loading) return;
    setLoading(true);
    try {
      const catParam = cat === "전체" ? "" : `&category=${encodeURIComponent(cat)}`;
      const res = await apiRequest(token, `/admin/event-logs?limit=30&offset=${p * 30}${catParam}`);
      if (res.ok) {
        const data: EventLogItem[] = await res.json();
        if (p === 0) setLogs(data);
        else setLogs(prev => [...prev, ...data]);
        setHasMore(data.length === 30);
        setPage(p);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token, loading, filter]);

  useEffect(() => { load(0, filter); }, [filter]);

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SubScreenHeader title="이벤트 기록" />

      {/* 카테고리 필터 */}
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8, flexDirection: "row" }}
        style={{ borderBottomWidth: 1, borderBottomColor: C.border, flexGrow: 0, flexShrink: 0 }}
      >
        {CATEGORIES.map(cat => {
          const active = filter === cat;
          const meta = CAT_META[cat];
          return (
            <Pressable
              key={cat}
              onPress={() => setFilter(cat)}
              style={[s.chip, active && { backgroundColor: (meta?.color ?? themeColor) + "20", borderColor: meta?.color ?? themeColor }]}
            >
              {meta && <Feather name={meta.icon as any} size={12} color={active ? (meta.color ?? themeColor) : C.textMuted} />}
              <Text style={[s.chipText, { color: active ? (meta?.color ?? themeColor) : C.textSecondary }]}>{cat}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <FlatList
        data={logs}
        keyExtractor={(item, i) => item.id || String(i)}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(0, filter); }}
            tintColor={themeColor}
          />
        }
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 100, paddingTop: 12, gap: 10 }}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={themeColor} style={{ marginTop: 40 }} />
          ) : (
            <View style={{ alignItems: "center", paddingTop: 60, gap: 12 }}>
              <Feather name="clock" size={40} color={C.textMuted} />
              <Text style={{ fontSize: 15, fontFamily: "Pretendard-Regular", color: C.textMuted }}>이벤트 기록이 없습니다</Text>
            </View>
          )
        }
        onEndReached={() => { if (hasMore && !loading) load(page + 1, filter); }}
        onEndReachedThreshold={0.3}
        ListFooterComponent={
          loading && logs.length > 0 ? <ActivityIndicator color={themeColor} style={{ marginVertical: 16 }} /> : null
        }
        renderItem={({ item: ev }) => {
          const meta = CAT_META[ev.category] || { icon: "activity", color: C.textSecondary, bg: "#F8FAFC" };
          // 안전한 날짜 파싱 — Invalid Date / NaN:NaN 방지
          const rawDate = ev.created_at;
          const dt = rawDate ? new Date(rawDate) : null;
          const validDate = dt && !isNaN(dt.getTime());
          const dateStr = validDate ? dt!.toLocaleDateString("ko-KR", { month: "short", day: "numeric" }) : "날짜 없음";
          const timeStr = validDate ? `${String(dt!.getHours()).padStart(2, "0")}:${String(dt!.getMinutes()).padStart(2, "0")}` : "—";
          // 안전한 텍스트 필드 — undefined 노출 방지
          const description = (ev.description && ev.description !== "undefined") ? ev.description : "기록 없음";
          const actorName   = (ev.actor_name  && ev.actor_name  !== "undefined") ? ev.actor_name  : "시스템";
          const target      = (ev.target      && ev.target      !== "undefined") ? ev.target      : null;
          return (
            <View style={[s.card, { backgroundColor: C.card }]}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                <View style={[s.evtIcon, { backgroundColor: meta.bg }]}>
                  <Feather name={meta.icon as any} size={16} color={meta.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <View style={[s.badge, { backgroundColor: meta.bg }]}>
                      <Text style={[s.badgeText, { color: meta.color }]}>{ev.category || "기타"}</Text>
                    </View>
                  </View>
                  <Text style={s.desc}>{description}</Text>
                  {target && <Text style={s.target}>대상: {target}</Text>}
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={s.date}>{dateStr}</Text>
                  <Text style={s.time}>{timeStr}</Text>
                </View>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
                <Feather name="user" size={11} color={C.textMuted} />
                <Text style={s.actor}>{actorName}</Text>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  chip:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, width: 76, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#fff" },
  chipText:  { fontSize: 13, fontFamily: "Pretendard-SemiBold" },
  card:      { borderRadius: 16, padding: 14, gap: 6, shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  evtIcon:   { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  badge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeText: { fontSize: 11, fontFamily: "Pretendard-Bold" },
  desc:      { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#111827", lineHeight: 20 },
  target:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#6B7280", marginTop: 2 },
  date:      { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#9CA3AF" },
  time:      { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#9CA3AF", marginTop: 2 },
  actor:     { fontSize: 11, fontFamily: "Pretendard-Medium", color: "#9CA3AF" },
});
