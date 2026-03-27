/**
 * (super)/op-logs.tsx — 운영 로그 (감사 로그 뷰어)
 * auditLogStore에서 데이터 읽기 — API 호출 없음
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useAuditLogStore } from "@/store/auditLogStore";

const P = "#7C3AED";

const TABS = ["전체", "운영자관리", "구독", "저장공간", "삭제", "정책", "결제", "보안", "기능플래그", "읽기전용 전환", "고객센터"];

const CAT_CFG: Record<string, { color: string; bg: string; icon: React.ComponentProps<typeof Feather>["name"] }> = {
  운영자관리:      { color: "#D97706", bg: "#FFF1BF", icon: "shield" },
  구독:            { color: P,         bg: "#EEDDF5", icon: "credit-card" },
  저장공간:        { color: "#2EC4B6", bg: "#E6FFFA", icon: "hard-drive" },
  삭제:            { color: "#D96C6C", bg: "#F9DEDA", icon: "trash-2" },
  정책:            { color: "#2EC4B6", bg: "#E6FFFA", icon: "file-text" },
  결제:            { color: "#2EC4B6", bg: "#ECFEFF", icon: "dollar-sign" },
  보안:            { color: "#991B1B", bg: "#F9DEDA", icon: "lock" },
  기능플래그:      { color: "#2EC4B6", bg: "#E6FFFA", icon: "toggle-left" },
  "읽기전용 전환": { color: "#7C3AED", bg: "#EEDDF5", icon: "eye-off" },
  고객센터:        { color: "#0284C7", bg: "#E0F2FE", icon: "message-circle" },
};

const IMPACT_CFG: Record<string, { color: string; label: string }> = {
  critical: { color: "#991B1B", label: "심각" },
  high:     { color: "#D96C6C", label: "높음" },
  medium:   { color: "#D97706", label: "중간" },
  low:      { color: "#2EC4B6", label: "낮음" },
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

function getDateLabel(iso: string): string {
  const d = safeDate(iso);
  if (!d) return "";
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diff === 0) return "오늘";
  if (diff === 1) return "어제";
  return d.toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
}

export default function OpLogsScreen() {
  const [activeTab, setActiveTab] = useState("전체");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);

  const allLogs    = useAuditLogStore(s => s.logs);
  const setCategory = useAuditLogStore(s => s.setFilterCategory);

  const logs = useMemo(() => {
    if (activeTab === "전체") return allLogs;
    return allLogs.filter(l => l.category === activeTab);
  }, [allLogs, activeTab]);

  function switchTab(tab: string) {
    setActiveTab(tab);
    setCategory(tab === "전체" ? "" : tab);
  }

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  // date divider tracking
  let lastDateLabel = "";

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="운영 로그" homePath="/(super)/dashboard" />

      {/* 카운트 배너 */}
      <View style={s.countBanner}>
        <Feather name="activity" size={13} color={P} />
        <Text style={s.countTxt}>
          총 <Text style={{ color: P, fontFamily: "Inter_700Bold" }}>{allLogs.length}</Text>건 기록됨
          {activeTab !== "전체" && <Text> · 필터: {logs.length}건</Text>}
        </Text>
      </View>

      {/* 탭 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.tabBar} contentContainerStyle={s.tabContent}>
        {TABS.map(tab => {
          const cfg = CAT_CFG[tab];
          const isActive = activeTab === tab;
          return (
            <Pressable key={tab}
              style={[s.tab, isActive && (cfg ? { backgroundColor: cfg.color, borderColor: cfg.color } : s.tabAllActive)]}
              onPress={() => switchTab(tab)}>
              {cfg && <Feather name={cfg.icon} size={12} color={isActive ? "#fff" : cfg.color} />}
              <Text style={[s.tabTxt, isActive && { color: "#fff" }]}>{tab}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={P}
          onRefresh={() => { setRefreshing(true); setTimeout(() => setRefreshing(false), 400); }} />}
        contentContainerStyle={{ paddingBottom: 60, paddingTop: 8 }}>

        {logs.length === 0 && (
          <View style={s.empty}>
            <Feather name="list" size={32} color="#D1D5DB" />
            <Text style={s.emptyTxt}>해당 카테고리의 로그가 없습니다</Text>
          </View>
        )}

        {logs.map(log => {
          const cfg = CAT_CFG[log.category] ?? { color: "#6B7280", bg: "#F8FAFC", icon: "activity" as const };
          const impactCfg = IMPACT_CFG[log.impact] ?? IMPACT_CFG.low;
          const isExpanded = expanded.has(log.id);
          const dateLabel = getDateLabel(log.createdAt);
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
                    <Text style={s.logDesc} numberOfLines={isExpanded ? undefined : 2}>{log.title}</Text>
                    <Text style={s.logTime}>{relativeTime(log.createdAt)}</Text>
                  </View>

                  {log.detail && !isExpanded && (
                    <Text style={s.logSubDesc} numberOfLines={1}>{log.detail}</Text>
                  )}

                  <View style={s.logMeta}>
                    <View style={[s.catBadge, { backgroundColor: cfg.bg }]}>
                      <Text style={[s.catTxt, { color: cfg.color }]}>{log.category}</Text>
                    </View>
                    <View style={[s.impactBadge, { backgroundColor: impactCfg.color + "22" }]}>
                      <Text style={[s.impactTxt, { color: impactCfg.color }]}>{impactCfg.label}</Text>
                    </View>
                    {!!log.actorName && (
                      <Text style={s.logMetaTxt}>{log.actorName}</Text>
                    )}
                    {!!log.operatorName && (
                      <><Text style={s.logMetaDot}>·</Text>
                        <Text style={s.logMetaTxt} numberOfLines={1}>{log.operatorName}</Text>
                      </>
                    )}
                    <Feather name={isExpanded ? "chevron-up" : "chevron-down"} size={13} color="#D1D5DB" style={{ marginLeft: "auto" }} />
                  </View>

                  {isExpanded && (
                    <View style={s.logDetail}>
                      <View style={s.detailRow}>
                        <Text style={s.detailLabel}>시간</Text>
                        <Text style={s.detailVal}>{fullTime(log.createdAt)}</Text>
                      </View>
                      {!!log.actorName && (
                        <View style={s.detailRow}>
                          <Text style={s.detailLabel}>작업자</Text>
                          <Text style={s.detailVal}>{log.actorName}</Text>
                        </View>
                      )}
                      {!!log.operatorName && (
                        <View style={s.detailRow}>
                          <Text style={s.detailLabel}>운영자</Text>
                          <Pressable onPress={() => router.push(`/(super)/operator-detail?id=${log.operatorId}` as any)}>
                            <Text style={[s.detailVal, { color: P, textDecorationLine: "underline" }]}>{log.operatorName}</Text>
                          </Pressable>
                        </View>
                      )}
                      {!!log.detail && (
                        <View style={s.detailRow}>
                          <Text style={s.detailLabel}>상세</Text>
                          <Text style={s.detailVal}>{log.detail}</Text>
                        </View>
                      )}
                      {!!log.reason && (
                        <View style={s.detailRow}>
                          <Text style={s.detailLabel}>사유</Text>
                          <Text style={s.detailVal}>{log.reason}</Text>
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
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#EEDDF5" },
  countBanner:  { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fff", paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#F8FAFC" },
  countTxt:     { fontFamily: "Inter_400Regular", fontSize: 13, color: "#111827" },
  tabBar:       { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", flexGrow: 0 },
  tabContent:   { paddingHorizontal: 12, paddingVertical: 8, gap: 6, flexDirection: "row" },
  tab:          { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 7,
                  borderRadius: 20, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#fff" },
  tabAllActive: { backgroundColor: P, borderColor: P },
  tabTxt:       { fontSize: 12, fontFamily: "Inter_500Medium", color: "#6B7280" },
  dateDivider:  { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 6 },
  dateLine:     { flex: 1, height: 1, backgroundColor: "#E5E7EB" },
  dateLabel:    { fontSize: 11, fontFamily: "Inter_500Medium", color: "#9CA3AF" },
  logCard:      { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#F8FAFC" },
  logIcon:      { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 2, flexShrink: 0 },
  logBody:      { flex: 1, gap: 5 },
  logTop:       { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  logDesc:      { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#111827", lineHeight: 19 },
  logSubDesc:   { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280" },
  logTime:      { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", flexShrink: 0 },
  logMeta:      { flexDirection: "row", alignItems: "center", gap: 5 },
  catBadge:     { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  catTxt:       { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  impactBadge:  { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 6 },
  impactTxt:    { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  logMetaTxt:   { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  logMetaDot:   { fontSize: 10, color: "#D1D5DB" },
  logDetail:    { backgroundColor: "#F1F5F9", borderRadius: 8, padding: 10, gap: 5 },
  detailRow:    { flexDirection: "row", gap: 8 },
  detailLabel:  { width: 48, fontSize: 11, fontFamily: "Inter_500Medium", color: "#9CA3AF" },
  detailVal:    { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", color: "#111827" },
  empty:        { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyTxt:     { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
});
