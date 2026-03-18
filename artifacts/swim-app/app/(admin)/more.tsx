/**
 * 더보기 탭 — 설정 허브
 * 결제, 지점, 브랜드, 선생님 관리, 승인, 활동 로그, 모드 변경
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
import { PageHeader } from "@/components/common/PageHeader";
import { useTabScrollReset } from "@/hooks/useTabScrollReset";

const C = Colors.light;
const TABS = ["설정 메뉴", "활동 로그"] as const;
type Tab = typeof TABS[number];

interface ActivityLog {
  id: string; target_name: string; action_type: string; target_type: string;
  before_value: string | null; after_value: string | null;
  actor_name: string; actor_role: string; note: string | null; created_at: string;
}

const ACTION_META: Record<string, { label: string; icon: string; color: string }> = {
  update:  { label: "정보 수정",  icon: "edit-2",      color: "#2563EB" },
  create:  { label: "신규 등록",  icon: "plus-circle", color: "#059669" },
  delete:  { label: "삭제",       icon: "trash-2",     color: "#DC2626" },
  restore: { label: "복구",       icon: "rotate-ccw",  color: "#7C3AED" },
  assign:  { label: "반 배정",    icon: "link",        color: "#D97706" },
};

const TYPE_LABEL: Record<string, string> = {
  status: "상태", info: "기본정보", class: "반", diary: "일지",
  attendance: "출결", parent: "학부모",
};

export default function MoreScreen() {
  const { token, adminUser } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();
  const scrollRef = useTabScrollReset("more");

  const [tab, setTab] = useState<Tab>("설정 메뉴");
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsPage, setLogsPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadLogs = useCallback(async (page = 0) => {
    if (logsLoading) return;
    setLogsLoading(true);
    try {
      const res = await apiRequest(token, `/admin/activity-logs?limit=30&offset=${page * 30}`);
      if (res.ok) {
        const data: ActivityLog[] = await res.json();
        if (page === 0) setLogs(data);
        else setLogs(prev => [...prev, ...data]);
        setHasMore(data.length === 30);
        setLogsPage(page);
      }
    } catch (e) { console.error(e); }
    finally { setLogsLoading(false); setRefreshing(false); }
  }, [token, logsLoading]);

  useEffect(() => {
    if (tab === "활동 로그") loadLogs(0);
  }, [tab]);

  const settingGroups = [
    {
      title: "운영",
      items: [
        { label: "승인 관리",    icon: "check-circle" as const, color: "#059669", bg: "#D1FAE5", route: "/(admin)/approvals"          },
        { label: "선생님 관리",  icon: "user-check"   as const, color: "#7C3AED", bg: "#F3E8FF", route: "/(admin)/teachers"           },
        { label: "학부모 계정",  icon: "users"        as const, color: "#2563EB", bg: "#DBEAFE", route: "/(admin)/parents"            },
        { label: "수업 관리",    icon: "book-open"    as const, color: "#0D9488", bg: "#CCFBF1", route: "/(admin)/class-management"   },
        { label: "삭제/복구 센터", icon: "archive"      as const, color: "#DC2626", bg: "#FEE2E2", route: "/(admin)/withdrawn-members" },
      ],
    },
    {
      title: "정산 · 일정",
      items: [
        { label: "수업 단가표",  icon: "dollar-sign"  as const, color: "#7C3AED", bg: "#EDE9FE", route: "/(admin)/pool-settings" },
        { label: "휴무일 관리",  icon: "x-square"     as const, color: "#EF4444", bg: "#FEE2E2", route: "/(admin)/holidays"      },
      ],
    },
    {
      title: "설정",
      items: [
        { label: "브랜드 설정",  icon: "sliders"      as const, color: "#EC4899", bg: "#FCE7F3", route: "/(admin)/branding"      },
        { label: "지점 관리",    icon: "map-pin"      as const, color: "#0D9488", bg: "#CCFBF1", route: "/(admin)/branches"      },
        { label: "알림 설정",    icon: "bell"         as const, color: "#D97706", bg: "#FEF3C7", route: "/(admin)/notifications" },
        { label: "수영장 설정",  icon: "settings"     as const, color: "#6B7280", bg: "#F3F4F6", route: "/(admin)/pool-settings" },
      ],
    },
    {
      title: "앱 구독",
      items: [
        { label: "구독관리",     icon: "credit-card"  as const, color: "#D97706", bg: "#FEF3C7", route: "/(admin)/billing"       },
      ],
    },
    {
      title: "기타",
      items: [
        { label: "모드 변경",    icon: "grid"         as const, color: "#6B7280", bg: "#F3F4F6", route: "/(admin)/mode"          },
      ],
    },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <PageHeader title="더보기" />

      {/* 탭바 */}
      <View style={s.tabBar}>
        {TABS.map(t => (
          <Pressable key={t} style={[s.tabItem, tab === t && { borderBottomColor: themeColor, borderBottomWidth: 2 }]} onPress={() => setTab(t)}>
            <Text style={[s.tabText, { color: tab === t ? themeColor : C.textSecondary }]}>{t}</Text>
          </Pressable>
        ))}
      </View>

      {tab === "설정 메뉴" ? (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: insets.bottom + 100 }}
          showsVerticalScrollIndicator={false}
        >
          {/* 프로필 카드 */}
          <View style={[s.profileCard, { backgroundColor: C.card }]}>
            <View style={[s.profileAvatar, { backgroundColor: themeColor + "20" }]}>
              <Text style={[s.profileInitial, { color: themeColor }]}>{adminUser?.name?.[0] || "A"}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.profileName}>{adminUser?.name || "관리자"}</Text>
              <Text style={s.profileRole}>수영장 관리자</Text>
            </View>
          </View>

          {/* 설정 그룹 */}
          {settingGroups.map(group => (
            <View key={group.title}>
              <Text style={s.groupTitle}>{group.title}</Text>
              <View style={[s.groupCard, { backgroundColor: C.card }]}>
                {group.items.map((item, idx) => (
                  <Pressable
                    key={item.label}
                    style={({ pressed }) => [
                      s.menuRow,
                      idx < group.items.length - 1 && s.menuRowBorder,
                      { opacity: pressed ? 0.7 : 1 },
                    ]}
                    onPress={() => router.push(item.route as any)}
                  >
                    <View style={[s.menuIcon, { backgroundColor: item.bg }]}>
                      <Feather name={item.icon} size={18} color={item.color} />
                    </View>
                    <Text style={s.menuLabel}>{item.label}</Text>
                    <Feather name="chevron-right" size={16} color={C.textMuted} style={{ marginLeft: "auto" }} />
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      ) : (
        /* 활동 로그 탭 */
        <FlatList
          data={logs}
          keyExtractor={(l, i) => l.id || String(i)}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); loadLogs(0); }}
              tintColor={themeColor}
            />
          }
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 100, paddingTop: 16, gap: 8 }}
          ListEmptyComponent={
            logsLoading ? (
              <ActivityIndicator color={themeColor} style={{ marginTop: 40 }} />
            ) : (
              <View style={s.empty}>
                <Feather name="activity" size={40} color={C.textMuted} />
                <Text style={s.emptyText}>활동 기록이 없습니다</Text>
              </View>
            )
          }
          onEndReached={() => { if (hasMore && !logsLoading) loadLogs(logsPage + 1); }}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            logsLoading && logs.length > 0 ? <ActivityIndicator color={themeColor} style={{ marginVertical: 16 }} /> : null
          }
          renderItem={({ item: log }) => {
            const meta = ACTION_META[log.action_type] || { label: log.action_type, icon: "activity", color: C.textSecondary };
            const typeLabel = TYPE_LABEL[log.target_type] || log.target_type;
            const dt = new Date(log.created_at);
            const dateStr = dt.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
            const timeStr = `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
            return (
              <View style={[s.logCard, { backgroundColor: C.card }]}>
                <View style={s.logHeader}>
                  <View style={[s.logIcon, { backgroundColor: meta.color + "15" }]}>
                    <Feather name={meta.icon as any} size={16} color={meta.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.logName}>{log.target_name}</Text>
                    <Text style={[s.logAction, { color: meta.color }]}>
                      {typeLabel} {meta.label}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={s.logDate}>{dateStr}</Text>
                    <Text style={s.logTime}>{timeStr}</Text>
                  </View>
                </View>
                {(log.before_value || log.after_value) && (
                  <View style={s.logChange}>
                    {log.before_value && (
                      <View style={s.logValueRow}>
                        <Text style={s.logValueLabel}>변경 전</Text>
                        <Text style={[s.logValue, { color: "#DC2626" }]}>{log.before_value}</Text>
                      </View>
                    )}
                    {log.after_value && (
                      <View style={s.logValueRow}>
                        <Text style={s.logValueLabel}>변경 후</Text>
                        <Text style={[s.logValue, { color: "#059669" }]}>{log.after_value}</Text>
                      </View>
                    )}
                  </View>
                )}
                {log.note && <Text style={s.logNote}>메모: {log.note}</Text>}
                <View style={s.logFooter}>
                  <Feather name="user" size={11} color={C.textMuted} />
                  <Text style={s.logActor}>{log.actor_name}</Text>
                  <Text style={s.logActorRole}>({log.actor_role === "pool_admin" ? "관리자" : "선생님"})</Text>
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  tabBar: { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.border },
  tabItem: { flex: 1, paddingVertical: 14, alignItems: "center" },
  tabText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  profileCard: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: 18, shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  profileAvatar: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  profileInitial: { fontSize: 20, fontFamily: "Inter_700Bold" },
  profileName: { fontSize: 18, fontFamily: "Inter_700Bold", color: C.text },
  profileRole: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  groupTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textMuted, marginBottom: 8, paddingHorizontal: 4 },
  groupCard: { borderRadius: 18, overflow: "hidden", shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  menuRow: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16 },
  menuRowBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  menuIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  menuLabel: { fontSize: 15, fontFamily: "Inter_500Medium", color: C.text },

  empty: { alignItems: "center", paddingVertical: 60, gap: 12 },
  emptyText: { fontSize: 15, fontFamily: "Inter_400Regular", color: C.textMuted },

  logCard: { borderRadius: 16, padding: 14, gap: 8, shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  logHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  logIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  logName: { fontSize: 15, fontFamily: "Inter_700Bold", color: C.text },
  logAction: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginTop: 1 },
  logDate: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted },
  logTime: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textMuted, marginTop: 2 },
  logChange: { backgroundColor: "#F9FAFB", borderRadius: 10, padding: 10, gap: 4 },
  logValueRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  logValueLabel: { width: 50, fontSize: 12, fontFamily: "Inter_500Medium", color: C.textSecondary },
  logValue: { flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold" },
  logNote: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, fontStyle: "italic" },
  logFooter: { flexDirection: "row", alignItems: "center", gap: 4 },
  logActor: { fontSize: 11, fontFamily: "Inter_500Medium", color: C.textMuted },
  logActorRole: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textMuted },
});
