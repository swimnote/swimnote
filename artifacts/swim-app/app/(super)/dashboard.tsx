/**
 * (super)/dashboard.tsx — 슈퍼관리자 운영 콘솔 홈
 * 상단: 6대 핵심 지표
 * 중단: 오늘 처리할 일 큐
 * 하단: 기능 메뉴 그리드
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

interface DashStats {
  total_operators: number;
  active_operators: number;
  pending_operators: number;
  payment_issue_count: number;
  storage_danger_count: number;
  deletion_pending_count: number;
}

interface TodoPool { id: string; name: string; owner_name: string; [k: string]: any; }
interface TodoData {
  pending_approval: TodoPool[];
  payment_failed: TodoPool[];
  storage_danger: TodoPool[];
  deletion_pending: TodoPool[];
}

const MENUS = [
  { id: "operators",     icon: "users" as const,        title: "운영자 관리",  sub: "목록·승인·반려",      path: "/(super)/pools",         color: P,         bg: "#EDE9FE" },
  { id: "subscriptions", icon: "credit-card" as const,  title: "구독 관리",    sub: "플랜·결제·크레딧",    path: "/(super)/subscriptions", color: "#0891B2", bg: "#ECFEFF" },
  { id: "storage",       icon: "hard-drive" as const,   title: "저장공간",     sub: "사용량·업로드 차단",   path: "/(super)/storage",       color: "#059669", bg: "#D1FAE5" },
  { id: "kill-switch",   icon: "alert-triangle" as const, title: "킬스위치",   sub: "데이터 영구 삭제",     path: "/(super)/kill-switch",   color: "#DC2626", bg: "#FEE2E2" },
  { id: "policy",        icon: "file-text" as const,    title: "정책 관리",    sub: "환불·개인정보·약관",   path: "/(super)/policy",        color: "#D97706", bg: "#FEF3C7" },
  { id: "op-logs",       icon: "list" as const,         title: "운영 로그",    sub: "승인·구독·삭제 기록",  path: "/(super)/op-logs",       color: "#4F46E5", bg: "#EEF2FF" },
];

function StatCard({ label, value, alert, onPress }: { label: string; value: number; alert?: boolean; onPress?: () => void }) {
  return (
    <Pressable style={[s.statCard, alert && value > 0 && s.statCardAlert]} onPress={onPress}>
      <Text style={[s.statNum, alert && value > 0 && { color: "#DC2626" }]}>{value}</Text>
      <Text style={s.statLabel} numberOfLines={2}>{label}</Text>
      {alert && value > 0 && <View style={s.alertDot} />}
    </Pressable>
  );
}

const TODO_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ComponentProps<typeof Feather>["name"]; filter: string }> = {
  pending_approval: { label: "승인 대기",      color: "#D97706", bg: "#FEF3C7", icon: "clock",          filter: "pending" },
  payment_failed:   { label: "결제 이슈",      color: "#DC2626", bg: "#FEE2E2", icon: "credit-card",    filter: "payment_failed" },
  storage_danger:   { label: "저장공간 위험",  color: "#7C3AED", bg: "#EDE9FE", icon: "hard-drive",     filter: "storage_alert" },
  deletion_pending: { label: "자동삭제 예정",  color: "#0891B2", bg: "#ECFEFF", icon: "trash-2",        filter: "deletion_pending" },
};

const SUB_LABEL: Record<string, string> = {
  trial: "체험 중", active: "구독 중", expired: "만료", suspended: "정지", cancelled: "해지",
};
const SUB_COLOR: Record<string, string> = {
  trial: "#7C3AED", active: "#059669", expired: "#6B7280", suspended: "#D97706", cancelled: "#DC2626",
};

export default function SuperDashboard() {
  const { logout, user, token } = useAuth();
  const [stats,      setStats]      = useState<DashStats | null>(null);
  const [todo,       setTodo]       = useState<TodoData | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);

  async function load() {
    try {
      const res = await apiRequest(token, "/super/dashboard-stats");
      if (res.ok) {
        const data = await res.json();
        setStats(data.stats);
        setTodo(data.todo);
      }
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { load(); }, []);

  async function quickApprove(id: string) {
    setProcessing(id);
    await apiRequest(token, `/super/operators/${id}/approve`, { method: "PATCH" }).catch(() => {});
    setProcessing(null);
    load();
  }

  const today = new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
  const totalTodo = ((todo?.pending_approval?.length ?? 0) + (todo?.payment_failed?.length ?? 0) +
    (todo?.storage_danger?.length ?? 0) + (todo?.deletion_pending?.length ?? 0));

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      {/* 헤더 */}
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>운영 콘솔</Text>
          <Text style={s.headerSub}>{today} · {user?.name ?? "슈퍼관리자"}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={s.avatarCircle}>
            <Text style={s.avatarText}>{user?.name?.[0] ?? "S"}</Text>
          </View>
          <Pressable style={s.logoutBtn} onPress={logout}>
            <Feather name="log-out" size={15} color={P} />
          </Pressable>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={P}
          onRefresh={() => { setRefreshing(true); load(); }} />}>

        {/* 6대 핵심 지표 */}
        {loading ? (
          <ActivityIndicator color={P} style={{ marginVertical: 30 }} />
        ) : (
          <View style={s.statsGrid}>
            <StatCard label="전체 운영자" value={stats?.total_operators ?? 0} />
            <StatCard label="활성 운영자" value={stats?.active_operators ?? 0} />
            <StatCard label="승인 대기" value={stats?.pending_operators ?? 0} alert
              onPress={() => router.push({ pathname: "/(super)/pools", params: { filter: "pending" } } as any)} />
            <StatCard label="결제 이슈" value={stats?.payment_issue_count ?? 0} alert
              onPress={() => router.push({ pathname: "/(super)/pools", params: { filter: "payment_failed" } } as any)} />
            <StatCard label="저장 95% 초과" value={stats?.storage_danger_count ?? 0} alert
              onPress={() => router.push("/(super)/storage" as any)} />
            <StatCard label="24h 내 삭제" value={stats?.deletion_pending_count ?? 0} alert
              onPress={() => router.push({ pathname: "/(super)/pools", params: { filter: "deletion_pending" } } as any)} />
          </View>
        )}

        {/* 오늘 처리할 일 */}
        {!loading && totalTodo > 0 && (
          <View style={s.section}>
            <View style={s.sectionRow}>
              <Text style={s.sectionTitle}>오늘 처리할 일</Text>
              <View style={s.todoBadge}><Text style={s.todoBadgeTxt}>{totalTodo}건</Text></View>
            </View>

            {(Object.entries(todo ?? {}) as [string, TodoPool[]][])
              .filter(([, arr]) => arr.length > 0)
              .map(([type, items]) => {
                const cfg = TODO_CONFIG[type];
                if (!cfg) return null;
                return (
                  <View key={type} style={s.todoGroup}>
                    <View style={s.todoGroupHeader}>
                      <View style={[s.todoTypeTag, { backgroundColor: cfg.bg }]}>
                        <Feather name={cfg.icon} size={12} color={cfg.color} />
                        <Text style={[s.todoTypeTxt, { color: cfg.color }]}>{cfg.label}</Text>
                      </View>
                      <Text style={s.todoCount}>{items.length}건</Text>
                      <Pressable onPress={() => router.push({ pathname: "/(super)/pools", params: { filter: cfg.filter } } as any)}>
                        <Text style={s.seeAll}>전체 보기</Text>
                      </Pressable>
                    </View>

                    {items.slice(0, 3).map(pool => (
                      <View key={pool.id} style={s.todoItem}>
                        <View style={s.todoItemLeft}>
                          <Text style={s.todoItemName} numberOfLines={1}>{pool.name}</Text>
                          <Text style={s.todoItemSub} numberOfLines={1}>
                            {pool.owner_name}
                            {type === "storage_danger" && pool.usage_pct != null
                              ? ` · 사용률 ${pool.usage_pct}%`
                              : type === "payment_failed" && pool.subscription_status
                              ? ` · ${SUB_LABEL[pool.subscription_status] ?? pool.subscription_status}`
                              : type === "deletion_pending" && pool.subscription_end_at
                              ? ` · ${new Date(pool.subscription_end_at).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} 삭제`
                              : ""}
                          </Text>
                        </View>
                        <View style={s.todoActions}>
                          {type === "pending_approval" && (
                            <Pressable style={[s.actionBtn, { backgroundColor: "#D1FAE5" }]}
                              onPress={() => quickApprove(pool.id)}
                              disabled={processing === pool.id}>
                              {processing === pool.id
                                ? <ActivityIndicator size="small" color="#059669" />
                                : <Text style={[s.actionBtnTxt, { color: "#059669" }]}>승인</Text>
                              }
                            </Pressable>
                          )}
                          <Pressable style={[s.actionBtn, { backgroundColor: "#F3F4F6" }]}
                            onPress={() => router.push(`/(super)/operator-detail?id=${pool.id}` as any)}>
                            <Text style={[s.actionBtnTxt, { color: "#374151" }]}>상세</Text>
                          </Pressable>
                        </View>
                      </View>
                    ))}
                  </View>
                );
              })}
          </View>
        )}

        {!loading && totalTodo === 0 && (
          <View style={s.allClearBox}>
            <Feather name="check-circle" size={28} color="#10B981" />
            <Text style={s.allClearTxt}>오늘 처리할 일이 없습니다</Text>
          </View>
        )}

        {/* 기능 메뉴 */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>기능 메뉴</Text>
          <View style={s.menuGrid}>
            {MENUS.map(m => (
              <Pressable key={m.id} style={s.menuCard} onPress={() => router.push(m.path as any)}>
                <View style={[s.menuIcon, { backgroundColor: m.bg }]}>
                  <Feather name={m.icon} size={22} color={m.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.menuTitle}>{m.title}</Text>
                  <Text style={s.menuSub} numberOfLines={1}>{m.sub}</Text>
                </View>
                <Feather name="chevron-right" size={16} color="#D1D5DB" />
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#F5F3FF" },
  header:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                  paddingHorizontal: 20, paddingTop: 14, paddingBottom: 12 },
  headerTitle:  { fontSize: 24, fontFamily: "Inter_700Bold", color: "#111827" },
  headerSub:    { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2 },
  avatarCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: P,
                  alignItems: "center", justifyContent: "center" },
  avatarText:   { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  logoutBtn:    { width: 36, height: 36, borderRadius: 10, backgroundColor: "#EDE9FE",
                  alignItems: "center", justifyContent: "center" },

  statsGrid:    { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 16, gap: 10, marginBottom: 8 },
  statCard:     { width: "30.5%", backgroundColor: "#fff", borderRadius: 14, padding: 14, gap: 4,
                  borderWidth: 1.5, borderColor: "#E5E7EB", position: "relative" },
  statCardAlert:{ borderColor: "#FCA5A5", backgroundColor: "#FFF1F2" },
  statNum:      { fontSize: 26, fontFamily: "Inter_700Bold", color: "#111827" },
  statLabel:    { fontSize: 10, fontFamily: "Inter_500Medium", color: "#6B7280", lineHeight: 14 },
  alertDot:     { position: "absolute", top: 8, right: 8, width: 8, height: 8,
                  borderRadius: 4, backgroundColor: "#DC2626" },

  section:      { paddingHorizontal: 16, marginBottom: 8 },
  sectionRow:   { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#111827" },
  todoBadge:    { backgroundColor: "#DC2626", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  todoBadgeTxt: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" },

  todoGroup:       { backgroundColor: "#fff", borderRadius: 14, marginBottom: 10, overflow: "hidden",
                     borderWidth: 1, borderColor: "#E5E7EB" },
  todoGroupHeader: { flexDirection: "row", alignItems: "center", gap: 6,
                     paddingHorizontal: 14, paddingVertical: 10,
                     backgroundColor: "#F9FAFB", borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  todoTypeTag:     { flexDirection: "row", alignItems: "center", gap: 4,
                     paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  todoTypeTxt:     { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  todoCount:       { fontSize: 12, fontFamily: "Inter_500Medium", color: "#6B7280" },
  seeAll:          { fontSize: 12, fontFamily: "Inter_600SemiBold", color: P, marginLeft: "auto" },
  todoItem:        { flexDirection: "row", alignItems: "center", gap: 10,
                     paddingHorizontal: 14, paddingVertical: 12,
                     borderBottomWidth: 1, borderBottomColor: "#F9FAFB" },
  todoItemLeft:    { flex: 1 },
  todoItemName:    { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#111827" },
  todoItemSub:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2 },
  todoActions:     { flexDirection: "row", gap: 6 },
  actionBtn:       { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, minWidth: 44, alignItems: "center" },
  actionBtnTxt:    { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  allClearBox:  { alignItems: "center", paddingVertical: 28, gap: 8 },
  allClearTxt:  { fontSize: 14, fontFamily: "Inter_500Medium", color: "#6B7280" },

  menuGrid:     { gap: 8 },
  menuCard:     { flexDirection: "row", alignItems: "center", gap: 12,
                  backgroundColor: "#fff", borderRadius: 14, padding: 14,
                  borderWidth: 1, borderColor: "#E5E7EB" },
  menuIcon:     { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  menuTitle:    { fontSize: 14, fontFamily: "Inter_700Bold", color: "#111827" },
  menuSub:      { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2 },
});
