/**
 * 관리자 대시보드 — 통합 운영 허브
 * 실 DB 데이터 기반 (GET /admin/dashboard-stats + 검색)
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, Keyboard, Modal, Platform,
  Pressable, RefreshControl, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { useTabScrollReset } from "@/hooks/useTabScrollReset";

const C = Colors.light;

interface DashStats {
  total_members: number; unassigned: number; withdrawn: number;
  deleted_members: number; new_this_week: number; today_present: number;
  pending_requests: number; total_classes: number; diary_done_today: number;
  total_teachers: number; expiring_soon: number; pending_makeups: number;
  monthly_revenue: number;
  recent_members: any[]; activity_logs: any[];
}

function formatWon(n: number) {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1).replace(/\.0$/, "") + "억원";
  if (n >= 10_000) return Math.floor(n / 10_000) + "만원";
  return n.toLocaleString("ko-KR") + "원";
}

interface SearchResult {
  students: any[]; teachers: any[]; classes: any[];
  notices: any[]; parents: any[];
}

const STATUS_COLOR: Record<string, { label: string; color: string; bg: string }> = {
  trial:     { label: "체험 중",  color: "#7C3AED", bg: "#F3E8FF" },
  active:    { label: "구독 중",  color: "#059669", bg: "#D1FAE5" },
  expired:   { label: "만료됨",   color: "#6B7280", bg: "#F3F4F6" },
  suspended: { label: "정지됨",   color: "#D97706", bg: "#FEF3C7" },
  cancelled: { label: "해지됨",   color: "#DC2626", bg: "#FEE2E2" },
};

function ActionLogItem({ log }: { log: any }) {
  const icons: Record<string, string> = {
    update: "edit-2", create: "plus-circle", delete: "trash-2",
    restore: "rotate-ccw", assign: "link",
  };
  const colors: Record<string, string> = {
    update: "#2563EB", create: "#059669", delete: "#DC2626",
    restore: "#7C3AED", assign: "#D97706",
  };
  const icon = icons[log.action_type] || "activity";
  const color = colors[log.action_type] || C.textSecondary;
  const dt = new Date(log.created_at);
  const timeStr = `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;

  return (
    <View style={al.row}>
      <View style={[al.icon, { backgroundColor: color + "15" }]}>
        <Feather name={icon as any} size={14} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={al.name} numberOfLines={1}>{log.target_name}</Text>
        <Text style={al.action} numberOfLines={1}>
          {log.action_type === "update" ? "정보 수정" :
           log.action_type === "create" ? "신규 등록" :
           log.action_type === "delete" ? "삭제" :
           log.action_type === "restore" ? "복구" : log.action_type}
          {log.after_value ? `: ${log.after_value}` : ""}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={al.time}>{timeStr}</Text>
        <Text style={[al.actor, { color }]}>{log.actor_role === "pool_admin" ? "관리자" : log.actor_name}</Text>
      </View>
    </View>
  );
}

const al = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  icon: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  action: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 1 },
  time: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textMuted },
  actor: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 1 },
});

// ── 검색 모달 ──────────────────────────────────────────────────────────────
function SearchModal({ visible, onClose, token }: { visible: boolean; onClose: () => void; token: string | null }) {
  const [q, setQ] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const debounce = useRef<any>(null);

  useEffect(() => {
    if (!visible) { setQ(""); setResult(null); }
  }, [visible]);

  function handleChange(text: string) {
    setQ(text);
    if (debounce.current) clearTimeout(debounce.current);
    if (text.trim().length < 1) { setResult(null); return; }
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await apiRequest(token, `/admin/search?q=${encodeURIComponent(text)}`);
        if (res.ok) setResult(await res.json());
      } catch { }
      finally { setLoading(false); }
    }, 300);
  }

  const totalCount = result
    ? (result.students.length + result.teachers.length + result.classes.length + result.notices.length + result.parents.length)
    : 0;

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={sm.container}>
        <View style={sm.header}>
          <View style={sm.searchBar}>
            <Feather name="search" size={18} color={C.textMuted} />
            <TextInput
              style={sm.input}
              placeholder="회원, 반, 선생님, 공지 검색..."
              placeholderTextColor={C.textMuted}
              value={q}
              onChangeText={handleChange}
              autoFocus
              returnKeyType="search"
            />
            {q.length > 0 && (
              <Pressable onPress={() => { setQ(""); setResult(null); }}>
                <Feather name="x-circle" size={16} color={C.textMuted} />
              </Pressable>
            )}
          </View>
          <Pressable onPress={onClose} style={sm.closeBtn}>
            <Text style={{ color: C.tint, fontSize: 15, fontFamily: "Inter_600SemiBold" }}>취소</Text>
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} />
        ) : result ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 60 }}>
            {totalCount === 0 ? (
              <View style={sm.empty}>
                <Feather name="search" size={40} color={C.textMuted} />
                <Text style={sm.emptyText}>검색 결과가 없습니다</Text>
              </View>
            ) : (
              <>
                {result.students.length > 0 && (
                  <View>
                    <Text style={sm.sectionLabel}>회원 ({result.students.length})</Text>
                    {result.students.map((s) => (
                      <Pressable key={s.id} style={sm.row} onPress={() => { onClose(); router.push({ pathname: "/(admin)/member-detail", params: { id: s.id } }); }}>
                        <View style={[sm.avatar, { backgroundColor: C.tint + "20" }]}>
                          <Text style={[sm.avatarText, { color: C.tint }]}>{s.name[0]}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={sm.rowTitle}>{s.name}</Text>
                          <Text style={sm.rowSub}>{s.class_name || "미배정"} · {s.birth_year ? `${s.birth_year}년생` : ""}</Text>
                        </View>
                        <Feather name="chevron-right" size={16} color={C.textMuted} />
                      </Pressable>
                    ))}
                  </View>
                )}
                {result.classes.length > 0 && (
                  <View>
                    <Text style={sm.sectionLabel}>반 ({result.classes.length})</Text>
                    {result.classes.map((c) => (
                      <Pressable key={c.id} style={sm.row} onPress={() => { onClose(); router.push("/(admin)/classes"); }}>
                        <View style={[sm.avatar, { backgroundColor: "#7C3AED20" }]}>
                          <Feather name="layers" size={16} color="#7C3AED" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={sm.rowTitle}>{c.name}</Text>
                          <Text style={sm.rowSub}>{c.schedule_days} · {c.schedule_time}</Text>
                        </View>
                        <Feather name="chevron-right" size={16} color={C.textMuted} />
                      </Pressable>
                    ))}
                  </View>
                )}
                {result.notices.length > 0 && (
                  <View>
                    <Text style={sm.sectionLabel}>공지 ({result.notices.length})</Text>
                    {result.notices.map((n) => (
                      <Pressable key={n.id} style={sm.row} onPress={() => { onClose(); router.push("/(admin)/community"); }}>
                        <View style={[sm.avatar, { backgroundColor: "#D9770620" }]}>
                          <Feather name="bell" size={16} color="#D97706" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={sm.rowTitle}>{n.title}</Text>
                        </View>
                        <Feather name="chevron-right" size={16} color={C.textMuted} />
                      </Pressable>
                    ))}
                  </View>
                )}
                {result.teachers.length > 0 && (
                  <View>
                    <Text style={sm.sectionLabel}>선생님 ({result.teachers.length})</Text>
                    {result.teachers.map((t) => (
                      <View key={t.id} style={sm.row}>
                        <View style={[sm.avatar, { backgroundColor: "#05966920" }]}>
                          <Feather name="user" size={16} color="#059669" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={sm.rowTitle}>{t.name}</Text>
                          <Text style={sm.rowSub}>{t.phone || "연락처 없음"}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}
          </ScrollView>
        ) : (
          <View style={sm.empty}>
            <Feather name="search" size={50} color={C.border} />
            <Text style={sm.emptyText}>이름, 반 이름, 공지 제목으로 검색</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const sm = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background, paddingTop: Platform.OS === "ios" ? 58 : 24 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 10, marginBottom: 8 },
  searchBar: { flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: C.card, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, gap: 10, borderWidth: 1, borderColor: C.border },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", color: C.text },
  closeBtn: { paddingHorizontal: 4 },
  sectionLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.textMuted, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#F9FAFB", textTransform: "uppercase", letterSpacing: 0.5 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border },
  avatar: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  rowTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: C.text },
  rowSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  empty: { alignItems: "center", paddingVertical: 60, gap: 12 },
  emptyText: { fontSize: 15, fontFamily: "Inter_400Regular", color: C.textMuted },
});

// ── 메인 대시보드 ───────────────────────────────────────────────────────────
export default function DashboardScreen() {
  const { adminUser, pool, logout, token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();
  const scrollRef = useTabScrollReset("dashboard");

  const [stats, setStats] = useState<DashStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [storagePct, setStoragePct] = useState<number | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const [statsRes, storageRes] = await Promise.all([
        apiRequest(token, "/admin/dashboard-stats"),
        apiRequest(token, "/admin/storage").catch(() => null),
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (storageRes?.ok) {
        const s = await storageRes.json();
        const quota = s.quota_bytes ?? 5 * 1024 ** 3;
        const pct = quota > 0 ? Math.min(100, (s.total_bytes / quota) * 100) : 0;
        setStoragePct(Math.round(pct * 10) / 10);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const sub = STATUS_COLOR[pool?.subscription_status || "trial"];

  const kpiCards = stats ? [
    { label: "전체 회원",  value: stats.total_members,    icon: "users"       as const, color: themeColor,  bg: themeColor + "18", route: "/(admin)/members" as const, params: { filter: "all" } },
    { label: "미배정 회원", value: stats.unassigned,        icon: "user-x"       as const, color: "#7C3AED",  bg: "#F3E8FF",          route: "/(admin)/members" as const, params: { filter: "unassigned" } },
    { label: "학부모 승인 대기", value: stats.pending_requests, icon: "clock" as const, color: "#D97706", bg: "#FEF3C7",           route: "/(admin)/approvals" as const },
    { label: "보강 미처리", value: stats.pending_makeups ?? 0, icon: "rotate-ccw" as const, color: "#DC2626", bg: "#FEE2E2",       route: "/(admin)/makeups" as const },
  ] : [];

  const tasks = stats ? [
    stats.pending_requests > 0  && { key: "pending",  label: `승인 대기 ${stats.pending_requests}건`, icon: "clock" as const, color: "#D97706", bg: "#FEF3C7", route: "/(admin)/approvals" as const },
    (stats.pending_makeups ?? 0) > 0 && { key: "makeup",   label: `보강 미처리 ${stats.pending_makeups}건`, icon: "rotate-ccw" as const, color: "#DC2626", bg: "#FEE2E2", route: "/(admin)/makeups" as const },
    stats.expiring_soon > 0     && { key: "expiring", label: `만료 임박 ${stats.expiring_soon}명`,    icon: "calendar" as const, color: "#EA580C",  bg: "#FFF7ED", route: "/(admin)/members" as const },
  ].filter(Boolean) as any[] : [];

  const quickActions = [
    { label: "회원 등록",  icon: "user-plus"    as const, color: themeColor,  bg: themeColor + "18",  route: "/(admin)/members"    as const },
    { label: "이번 달 매출", icon: "trending-up" as const, color: "#059669", bg: "#D1FAE5", route: "/(admin)/admin-revenue" as const, value: stats ? formatWon(stats.monthly_revenue ?? 0) : "—" },
    { label: "반 관리",   icon: "layers"        as const, color: "#7C3AED",   bg: "#F3E8FF",           route: "/(admin)/classes"    as const },
    { label: "공지 작성",  icon: "edit-3"       as const, color: "#D97706",   bg: "#FEF3C7",           route: "/(admin)/community"  as const },
    { label: "저장공간 현황", icon: "hard-drive" as const, color: "#0D9488", bg: "#CCFBF1", route: "/(admin)/data-storage-overview" as const, value: storagePct !== null ? `${storagePct}% 사용 중` : "—" },
    { label: "선생님 관리", icon: "user-check"   as const, color: "#EC4899",   bg: "#FCE7F3",           route: "/(admin)/teachers"   as const },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: "#F3F4F6" }}>
      {/* 상단 헤더 */}
      <View style={[s.topBar, { paddingTop: insets.top + 12 }]}>
        <View>
          <Text style={s.poolName}>{pool?.name || "수영장"}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
            <Text style={s.greet}>안녕하세요, {adminUser?.name}님</Text>
            {sub && (
              <View style={[s.subBadge, { backgroundColor: sub.bg }]}>
                <Text style={[s.subBadgeText, { color: sub.color }]}>{sub.label}</Text>
              </View>
            )}
          </View>
        </View>
        <Pressable onPress={logout} style={s.logoutBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="log-out" size={18} color={C.textSecondary} />
        </Pressable>
      </View>

      {/* 검색창 */}
      <Pressable style={s.searchBox} onPress={() => setShowSearch(true)}>
        <Feather name="search" size={17} color={C.textMuted} />
        <Text style={s.searchPlaceholder}>회원, 반, 선생님, 공지 검색...</Text>
      </Pressable>

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 100, gap: 20 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchStats(); }} tintColor={themeColor} />
        }
      >
        {loading ? (
          <ActivityIndicator color={themeColor} size="large" style={{ marginTop: 30 }} />
        ) : (
          <>
            {/* KPI 카드 2x2 */}
            <View style={s.kpiGrid}>
              {kpiCards.map((k) => (
                <Pressable key={k.label} style={[s.kpiCard, { backgroundColor: C.card }]} onPress={() => router.push((k as any).params ? { pathname: k.route as any, params: (k as any).params } : k.route as any)}>
                  <View style={[s.kpiIcon, { backgroundColor: k.bg }]}>
                    <Feather name={k.icon} size={20} color={k.color} />
                  </View>
                  <Text style={[s.kpiValue, { color: k.color }]}>{k.value}</Text>
                  <Text style={s.kpiLabel}>{k.label}</Text>
                </Pressable>
              ))}
            </View>

            {/* 미완료 과제 (있을 때만) */}
            {tasks.length > 0 && (
              <View style={[s.card, { backgroundColor: C.card }]}>
                <View style={s.cardHeader}>
                  <Feather name="alert-triangle" size={16} color="#D97706" />
                  <Text style={s.cardTitle}>처리 필요 항목</Text>
                </View>
                {tasks.map((t: any) => (
                  <Pressable key={t.key} style={[s.taskRow, { backgroundColor: t.bg }]} onPress={() => router.push(t.route as any)}>
                    <Feather name={t.icon} size={15} color={t.color} />
                    <Text style={[s.taskLabel, { color: t.color }]}>{t.label}</Text>
                    <Feather name="chevron-right" size={15} color={t.color} style={{ marginLeft: "auto" }} />
                  </Pressable>
                ))}
              </View>
            )}

            {/* 빠른 액션 2열 그리드 */}
            <View>
              <Text style={s.sectionTitle}>빠른 액션</Text>
              <View style={s.actionGrid}>
                {quickActions.map((a) => (
                  <Pressable
                    key={a.label}
                    style={({ pressed }) => [s.actionCard, { backgroundColor: C.card, opacity: pressed ? 0.8 : 1 }]}
                    onPress={() => router.push(a.route as any)}
                  >
                    <View style={[s.actionIcon, { backgroundColor: a.bg }]}>
                      <Feather name={a.icon} size={22} color={a.color} />
                    </View>
                    <Text style={s.actionLabel}>{a.label}</Text>
                    {(a as any).value !== undefined && (
                      <Text style={[s.actionLabel, { color: (a as any).color, fontFamily: "Inter_700Bold", fontSize: 13, marginTop: 1 }]}>{(a as any).value}</Text>
                    )}
                  </Pressable>
                ))}
              </View>
            </View>

            {/* 수업 현황 요약 */}
            {stats && (
              <View style={[s.card, { backgroundColor: C.card }]}>
                <Text style={s.cardTitle}>오늘 수업 현황</Text>
                <View style={s.statRow}>
                  <View style={s.statItem}>
                    <Text style={[s.statNum, { color: "#7C3AED" }]}>{stats.total_classes}</Text>
                    <Text style={s.statName}>전체 반</Text>
                  </View>
                  <View style={s.statDivider} />
                  <View style={s.statItem}>
                    <Text style={[s.statNum, { color: "#059669" }]}>{stats.diary_done_today}</Text>
                    <Text style={s.statName}>일지 완료</Text>
                  </View>
                  <View style={s.statDivider} />
                  <View style={s.statItem}>
                    <Text style={[s.statNum, { color: themeColor }]}>{stats.total_teachers}</Text>
                    <Text style={s.statName}>선생님</Text>
                  </View>
                  <View style={s.statDivider} />
                  <View style={s.statItem}>
                    <Text style={[s.statNum, { color: "#EA580C" }]}>{stats.today_present}</Text>
                    <Text style={s.statName}>오늘 출석</Text>
                  </View>
                </View>
              </View>
            )}

            {/* 최근 등록 회원 */}
            {stats && stats.recent_members.length > 0 && (
              <View style={[s.card, { backgroundColor: C.card }]}>
                <View style={[s.cardHeader, { marginBottom: 2 }]}>
                  <Text style={s.cardTitle}>최근 등록 회원</Text>
                  <Pressable onPress={() => router.push("/(admin)/members")}>
                    <Text style={[s.cardMore, { color: themeColor }]}>전체 보기</Text>
                  </Pressable>
                </View>
                {stats.recent_members.map((m) => (
                  <Pressable
                    key={m.id}
                    style={s.memberRow}
                    onPress={() => router.push({ pathname: "/(admin)/member-detail", params: { id: m.id } })}
                  >
                    <View style={[s.memberAvatar, { backgroundColor: themeColor + "20" }]}>
                      <Text style={[s.memberInitial, { color: themeColor }]}>{m.name[0]}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.memberName}>{m.name}</Text>
                      <Text style={s.memberSub}>{m.class_name || "미배정"}</Text>
                    </View>
                    <Text style={s.memberDate}>
                      {m.created_at ? new Date(m.created_at).toLocaleDateString("ko-KR", { month: "short", day: "numeric" }) : ""}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

            {/* 최근 활동 로그 */}
            {stats && stats.activity_logs.length > 0 && (
              <View style={[s.card, { backgroundColor: C.card }]}>
                <View style={[s.cardHeader, { marginBottom: 2 }]}>
                  <Text style={s.cardTitle}>최근 변경 이력</Text>
                  <Pressable onPress={() => router.push("/(admin)/more")}>
                    <Text style={[s.cardMore, { color: themeColor }]}>전체 보기</Text>
                  </Pressable>
                </View>
                {stats.activity_logs.slice(0, 5).map((log, i) => (
                  <ActionLogItem key={log.id || i} log={log} />
                ))}
              </View>
            )}

            {/* 수영장 기본 정보 */}
            {pool && (
              <View style={[s.card, { backgroundColor: C.card }]}>
                <Text style={s.cardTitle}>수영장 정보</Text>
                {[
                  { icon: "map-pin" as const, value: pool.address },
                  { icon: "phone"   as const, value: pool.phone },
                  { icon: "user"    as const, value: `${pool.owner_name} 대표` },
                ].map(({ icon, value }) => value && (
                  <View key={icon} style={s.poolRow}>
                    <Feather name={icon} size={13} color={C.textMuted} />
                    <Text style={s.poolText}>{value}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      <SearchModal visible={showSearch} onClose={() => setShowSearch(false)} token={token} />
    </View>
  );
}

const s = StyleSheet.create({
  topBar: { backgroundColor: "#fff", paddingHorizontal: 20, paddingBottom: 12, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: C.border },
  poolName: { fontSize: 20, fontFamily: "Inter_700Bold", color: C.text },
  greet: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary },
  subBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  subBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  logoutBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center", marginTop: 4 },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", marginHorizontal: 16, marginTop: 12, marginBottom: 4, paddingHorizontal: 16, paddingVertical: 13, borderRadius: 14, borderWidth: 1, borderColor: C.border },
  searchPlaceholder: { fontSize: 14, fontFamily: "Inter_400Regular", color: C.textMuted },

  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 8 },
  kpiCard: { flex: 1, minWidth: "45%", borderRadius: 16, padding: 16, gap: 6, shadowColor: "#00000018", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8, elevation: 3 },
  kpiIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  kpiValue: { fontSize: 28, fontFamily: "Inter_700Bold" },
  kpiLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary },

  card: { borderRadius: 18, padding: 16, shadowColor: "#00000015", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8, elevation: 2, gap: 8 },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: C.text },
  cardMore: { fontSize: 13, fontFamily: "Inter_500Medium" },

  taskRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12 },
  taskLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  sectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: C.text, marginBottom: 10 },
  actionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  actionCard: { flex: 1, minWidth: "30%", borderRadius: 14, padding: 14, alignItems: "center", gap: 8, shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8, elevation: 2 },
  actionIcon: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  actionLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.text, textAlign: "center" },

  statRow: { flexDirection: "row", alignItems: "center" },
  statItem: { flex: 1, alignItems: "center", paddingVertical: 8 },
  statNum: { fontSize: 24, fontFamily: "Inter_700Bold" },
  statName: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  statDivider: { width: 1, height: 40, backgroundColor: C.border },

  memberRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.border },
  memberAvatar: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  memberInitial: { fontSize: 15, fontFamily: "Inter_700Bold" },
  memberName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  memberSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 1 },
  memberDate: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textMuted },

  poolRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  poolText: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary },
});
