/**
 * (teacher)/students.tsx — 회원관리
 *
 * 탭: 전체 / 미배정 / 연기예정 / 퇴원예정 / 연기 / 퇴원
 *
 * 카드 클릭 → student-detail 바로 진입 (중간 Action Sheet 제거)
 * 상태변경 → student-detail 내부 Section B / H (MemberStatusChangeModal)
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Animated, FlatList, Pressable,
  RefreshControl, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useMode } from "@/context/ModeContext";
import { X as XT, isXMode } from "@/constants/xTheme";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { UnifiedMemberCard } from "@/components/common/MemberCard";
import type { StudentMember } from "@/utils/studentUtils";

const C = Colors.light;

interface TeacherMember {
  id: string;
  name: string;
  status: string;
  birth_year: number | null;
  phone: string | null;
  parent_name: string | null;
  parent_user_id: string | null;
  weekly_count: number | null;
  class_group_id: string | null;
  class_group_name: string | null;
  last_class_group_name: string | null;
  assigned_class_ids: string[] | null;
  schedule_labels: string | null;
  pending_status_change: "suspended" | "withdrawn" | null;
  pending_effective_mode: "next_month" | null;
  pending_effective_month: string | null;
  updated_at: string | null;
  withdrawn_at: string | null;
  archived_reason: string | null;
}

function toStudentMember(m: TeacherMember): StudentMember {
  return {
    id: m.id,
    swimming_pool_id: "",
    name: m.name,
    birth_year: m.birth_year != null ? String(m.birth_year) : null,
    phone: m.phone,
    parent_name: m.parent_name,
    parent_phone: null,
    parent_user_id: m.parent_user_id,
    registration_path: "admin_created",
    status: m.status || "active",
    weekly_count: m.weekly_count,
    assigned_class_ids: m.assigned_class_ids,
    class_group_id: m.class_group_id,
    class_group_name: m.class_group_name || m.last_class_group_name,
    schedule_labels: m.schedule_labels,
    pending_status_change: m.pending_status_change,
    pending_effective_mode: m.pending_effective_mode,
    pending_effective_month: m.pending_effective_month,
    created_at: "",
    updated_at: m.updated_at || "",
    withdrawn_at: m.withdrawn_at,
    archived_reason: m.archived_reason,
    assignedClasses: [],
  };
}

type TabKey = "all" | "unassigned" | "suspend_pending" | "withdraw_pending" | "suspended" | "withdrawn";

const TAB_CONFIG: { key: TabKey; label: string; color: string }[] = [
  { key: "all",              label: "전체",    color: C.textPrimary },
  { key: "unassigned",       label: "미배정",  color: "#D96C6C" },
  { key: "suspend_pending",  label: "연기예정", color: "#B45309" },
  { key: "withdraw_pending", label: "퇴원예정", color: C.textSecondary },
  { key: "suspended",        label: "연기",    color: "#7C3AED" },
  { key: "withdrawn",        label: "퇴원",    color: C.textPrimary },
];

export default function WaitingListScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();
  const { mode } = useMode();
  const isX = isXMode(mode);

  const [tab,        setTab]        = useState<TabKey>("all");
  const [list,       setList]       = useState<TeacherMember[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search,     setSearch]     = useState("");
  const [tabCounts,  setTabCounts]  = useState<Record<TabKey, number>>({
    all: 0, unassigned: 0, suspend_pending: 0, withdraw_pending: 0, suspended: 0, withdrawn: 0,
  });

  // Toast
  const [toastMsg,    setToastMsg]    = useState("");
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastMsg(msg);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(2000),
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
    toastTimer.current = setTimeout(() => setToastMsg(""), 2600);
  }

  const loadCounts = useCallback(async () => {
    try {
      const res = await apiRequest(token, "/teacher/me/members/counts");
      if (res.ok) {
        const data = await res.json();
        setTabCounts({
          all:              data.all              ?? 0,
          unassigned:       data.unassigned       ?? 0,
          suspend_pending:  data.suspend_pending  ?? 0,
          withdraw_pending: data.withdraw_pending ?? 0,
          suspended:        data.suspended        ?? 0,
          withdrawn:        data.withdrawn        ?? 0,
        });
      }
    } catch (e) { console.error(e); }
  }, [token]);

  const load = useCallback(async (activeTab: TabKey) => {
    try {
      const [res] = await Promise.all([
        apiRequest(token, `/teacher/me/members?tab=${activeTab}`),
        loadCounts(),
      ]);
      if (res.ok) setList(await res.json());
      else setList([]);
    } catch (e) { console.error(e); setList([]); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token, loadCounts]);

  useEffect(() => {
    setLoading(true);
    setList([]);
    setSearch("");
    load(tab);
  }, [tab, load]);

  const isMountedRef = useRef(false);
  useFocusEffect(useCallback(() => {
    if (!isMountedRef.current) { isMountedRef.current = true; return; }
    load(tab);
  }, [load, tab]));

  const displayed = list.filter(m => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return m.name.toLowerCase().includes(q)
      || (m.class_group_name || m.last_class_group_name || "").toLowerCase().includes(q);
  });

  function getEmptyText() {
    if (search.trim()) return "검색 결과가 없습니다";
    if (tab === "unassigned") return "미배정 회원이 없습니다";
    if (tab === "suspend_pending") return "연기예정 회원이 없습니다";
    if (tab === "withdraw_pending") return "퇴원예정 회원이 없습니다";
    if (tab === "suspended") return "연기 중인 회원이 없습니다";
    if (tab === "withdrawn") return "퇴원한 회원이 없습니다";
    return "회원이 없습니다";
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: isX ? XT.background : C.background }} edges={[]}>
      <SubScreenHeader title="회원관리" homePath="/(teacher)/today-schedule" />

      {/* 탭 */}
      <View style={s.tabRow}>
        {TAB_CONFIG.map(t => {
          const active = tab === t.key;
          const cnt = tabCounts[t.key] ?? 0;
          return (
            <Pressable
              key={t.key}
              style={[s.tabBtn, active && { backgroundColor: t.color, borderColor: t.color }]}
              onPress={() => setTab(t.key)}
            >
              <Text style={[s.tabTxt, active && { color: "#fff" }]}>
                {t.label}
                {cnt > 0 ? (
                  <Text style={[s.tabCount, active && { color: "#fff" }]}> {cnt}</Text>
                ) : null}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* 검색 */}
      <View style={s.searchRow}>
        <LucideIcon name="search" size={15} color={C.textMuted} style={{ marginLeft: 10 }} />
        <TextInput
          style={s.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="이름 또는 반 이름 검색..."
          placeholderTextColor={C.textMuted}
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch("")} style={{ paddingRight: 10 }}>
            <LucideIcon name="x" size={15} color={C.textMuted} />
          </Pressable>
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
      ) : (
        <FlatList
          data={displayed}
          keyExtractor={m => m.id}
          contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: insets.bottom + 60 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(tab); }}
              tintColor={themeColor}
            />
          }
          ListEmptyComponent={
            <View style={s.emptyBox}>
              <LucideIcon name="users" size={36} color={C.textMuted} />
              <Text style={s.emptyText}>{getEmptyText()}</Text>
              {!search.trim() && tab === "all" && (
                <Text style={[s.emptyHint, { color: C.textMuted }]}>
                  회원이 없거나 데이터를 불러오는 중입니다
                </Text>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <UnifiedMemberCard
              student={toStudentMember(item)}
              onPress={() => router.push({ pathname: "/(teacher)/student-detail", params: { id: item.id, backTo: "students" } } as any)}
            />
          )}
        />
      )}

      {/* Toast */}
      {toastMsg.length > 0 && (
        <Animated.View style={[s.toast, { opacity: toastOpacity, bottom: insets.bottom + 28 }]}>
          <LucideIcon name="check-circle" size={14} color="#fff" />
          <Text style={s.toastText}>{toastMsg}</Text>
        </Animated.View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  tabRow:      { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.background, borderBottomWidth: 1, borderBottomColor: C.border },
  tabBtn:      { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: C.border },
  tabTxt:      { fontSize: 12, lineHeight: 17, color: C.textSecondary },
  tabCount:    { fontSize: 12, lineHeight: 17, color: C.textMuted },
  searchRow:   { flexDirection: "row", alignItems: "center", backgroundColor: C.background, borderBottomWidth: 1, borderBottomColor: C.border },
  searchInput: { flex: 1, height: 42, paddingHorizontal: 8, fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  emptyBox:    { alignItems: "center", gap: 10, paddingVertical: 60 },
  emptyText:   { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textMuted, textAlign: "center" },
  emptyHint:   { fontSize: 12, fontFamily: "Pretendard-Regular", textAlign: "center", marginTop: 4 },
  toast: {
    position: "absolute", left: 24, right: 24,
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(30,30,30,0.88)", borderRadius: 14,
    paddingVertical: 12, paddingHorizontal: 16,
  },
  toastText: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#fff", flex: 1 },
});

