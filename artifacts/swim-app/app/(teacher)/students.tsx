/**
 * (teacher)/students.tsx — 회원관리
 *
 * 탭: 전체 / 미배정 / 연기예정 / 퇴원예정 / 연기 / 퇴원
 *
 * 카드 클릭 → WaitingActionSheet (반 배정 / 연기 / 퇴원)
 * 연기/퇴원 → MemberStatusChangeModal (기존 API 재사용)
 * 반 배정 → student-detail 이동
 */
import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Animated, FlatList, Modal, Pressable,
  RefreshControl, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { UnifiedMemberCard } from "@/components/common/MemberCard";
import { MemberStatusChangeModal } from "@/components/common/MemberStatusChangeModal";
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
  { key: "all",              label: "전체",    color: "#1F1F1F" },
  { key: "unassigned",       label: "미배정",  color: "#D96C6C" },
  { key: "suspend_pending",  label: "연기예정", color: "#B45309" },
  { key: "withdraw_pending", label: "퇴원예정", color: "#6F6B68" },
  { key: "suspended",        label: "연기",    color: "#7C3AED" },
  { key: "withdrawn",        label: "퇴원",    color: "#374151" },
];

export default function WaitingListScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const [tab,        setTab]        = useState<TabKey>("all");
  const [list,       setList]       = useState<TeacherMember[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search,     setSearch]     = useState("");

  // 하단 시트 (카드 클릭)
  const [sheetTarget,  setSheetTarget]  = useState<TeacherMember | null>(null);
  // 상태 변경 모달 (연기 / 퇴원)
  const [statusTarget, setStatusTarget] = useState<TeacherMember | null>(null);

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

  const load = useCallback(async (activeTab: TabKey) => {
    try {
      const res = await apiRequest(token, `/teacher/me/members?tab=${activeTab}`);
      if (res.ok) setList(await res.json());
      else setList([]);
    } catch (e) { console.error(e); setList([]); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

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
    <SafeAreaView style={{ flex: 1, backgroundColor: C.background }} edges={[]}>
      <SubScreenHeader title="회원관리" homePath="/(teacher)/today-schedule" />

      {/* 탭 */}
      <View style={s.tabRow}>
        {TAB_CONFIG.map(t => {
          const active = tab === t.key;
          const cnt = tab === t.key ? displayed.length : 0;
          return (
            <Pressable
              key={t.key}
              style={[s.tabBtn, active && { backgroundColor: t.color, borderColor: t.color }]}
              onPress={() => setTab(t.key)}
            >
              <Text style={[s.tabTxt, active && { color: "#fff" }]}>
                {t.label}{active && cnt > 0 ? ` ${cnt}` : ""}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* 검색 */}
      <View style={s.searchRow}>
        <Feather name="search" size={15} color={C.textMuted} style={{ marginLeft: 10 }} />
        <TextInput
          style={s.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="이름 또는 반 이름 검색..."
          placeholderTextColor={C.textMuted}
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch("")} style={{ paddingRight: 10 }}>
            <Feather name="x" size={15} color={C.textMuted} />
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
              <Feather name="users" size={36} color={C.textMuted} />
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
              onPress={() => setSheetTarget(item)}
            />
          )}
        />
      )}

      {/* 카드 클릭 → 하단 시트 */}
      {sheetTarget && (
        <WaitingActionSheet
          member={sheetTarget}
          onClose={() => setSheetTarget(null)}
          onAssign={() => {
            setSheetTarget(null);
            router.push({ pathname: "/(teacher)/student-detail", params: { id: sheetTarget.id } } as any);
          }}
          onStatusChange={() => {
            setStatusTarget(sheetTarget);
            setSheetTarget(null);
          }}
        />
      )}

      {/* 연기 / 퇴원 → MemberStatusChangeModal */}
      {statusTarget && (
        <MemberStatusChangeModal
          visible
          studentId={statusTarget.id}
          studentName={statusTarget.name}
          currentStatus={statusTarget.status}
          pendingStatusChange={statusTarget.pending_status_change}
          pendingEffectiveMode={statusTarget.pending_effective_mode}
          onClose={() => setStatusTarget(null)}
          onChanged={({ status, mode }) => {
            setStatusTarget(null);
            load(tab);
            if (mode === "immediate") {
              const label = status === "withdrawn" ? "퇴원" : status === "suspended" ? "연기" :
                            status === "active" ? "정상" : "미배정";
              showToast(`${label} 처리되었습니다`);
            } else {
              showToast("다음 달부터 적용됩니다");
            }
          }}
        />
      )}

      {/* Toast */}
      {toastMsg.length > 0 && (
        <Animated.View style={[s.toast, { opacity: toastOpacity, bottom: insets.bottom + 28 }]}>
          <Feather name="check-circle" size={14} color="#fff" />
          <Text style={s.toastText}>{toastMsg}</Text>
        </Animated.View>
      )}
    </SafeAreaView>
  );
}

// ── 카드 클릭 하단 시트 ───────────────────────────────────────────
function WaitingActionSheet({
  member, onClose, onAssign, onStatusChange,
}: {
  member: TeacherMember;
  onClose: () => void;
  onAssign: () => void;
  onStatusChange: () => void;
}) {
  const hasPending = !!member.pending_status_change;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={sh.overlay} onPress={onClose} />
      <View style={sh.sheet}>
        {/* 헤더 */}
        <View style={sh.handleBar} />
        <Text style={sh.name}>{member.name}</Text>
        {hasPending && (
          <View style={sh.pendingBadge}>
            <Text style={sh.pendingBadgeText}>
              {member.pending_status_change === "suspended" ? "⏸ 연기예정" : "🚪 퇴원예정"}
            </Text>
          </View>
        )}

        <View style={sh.options}>
          {/* 반 배정 */}
          <Pressable style={[sh.option, { borderColor: "#2EC4B620" }]} onPress={onAssign}>
            <View style={[sh.optIcon, { backgroundColor: "#E6F9F7" }]}>
              <Feather name="user-check" size={20} color="#2EC4B6" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[sh.optLabel, { color: "#1F8F86" }]}>반 배정</Text>
              <Text style={sh.optSub}>학생 상세 페이지에서 반을 변경합니다</Text>
            </View>
            <Feather name="chevron-right" size={16} color="#9CA3AF" />
          </Pressable>

          {/* 연기 */}
          <Pressable style={[sh.option, { borderColor: "#B4530920" }]} onPress={onStatusChange}>
            <View style={[sh.optIcon, { backgroundColor: "#FFF1BF" }]}>
              <Feather name="pause-circle" size={20} color="#B45309" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[sh.optLabel, { color: "#B45309" }]}>연기</Text>
              <Text style={sh.optSub}>수강 연기 처리 — 이동 시점 선택 가능</Text>
            </View>
            <Feather name="chevron-right" size={16} color="#9CA3AF" />
          </Pressable>

          {/* 퇴원 */}
          <Pressable style={[sh.option, { borderColor: "#D96C6C20" }]} onPress={onStatusChange}>
            <View style={[sh.optIcon, { backgroundColor: "#FEF2F2" }]}>
              <Feather name="log-out" size={20} color="#D96C6C" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[sh.optLabel, { color: "#D96C6C" }]}>퇴원</Text>
              <Text style={sh.optSub}>수강 종료 처리 — 이동 시점 선택 가능</Text>
            </View>
            <Feather name="chevron-right" size={16} color="#9CA3AF" />
          </Pressable>
        </View>

        <Pressable onPress={onClose} style={sh.cancelBtn}>
          <Text style={sh.cancelText}>취소</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  tabRow:      { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.background, borderBottomWidth: 1, borderBottomColor: C.border },
  tabBtn:      { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: C.border },
  tabTxt:      { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  searchRow:   { flexDirection: "row", alignItems: "center", backgroundColor: C.background, borderBottomWidth: 1, borderBottomColor: C.border },
  searchInput: { flex: 1, height: 42, paddingHorizontal: 8, fontSize: 14, fontFamily: "Inter_400Regular", color: C.text },
  emptyBox:    { alignItems: "center", gap: 10, paddingVertical: 60 },
  emptyText:   { fontSize: 14, fontFamily: "Inter_400Regular", color: C.textMuted, textAlign: "center" },
  emptyHint:   { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 4 },
  toast: {
    position: "absolute", left: 24, right: 24,
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(30,30,30,0.88)", borderRadius: 14,
    paddingVertical: 12, paddingHorizontal: 16,
  },
  toastText: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#fff", flex: 1 },
});

const sh = StyleSheet.create({
  overlay:   { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet:     {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 36,
  },
  handleBar: { width: 36, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: "center", marginBottom: 16 },
  name:      { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text, textAlign: "center", marginBottom: 6 },
  pendingBadge: {
    alignSelf: "center", paddingHorizontal: 10, paddingVertical: 3,
    borderRadius: 10, backgroundColor: "#FFF1BF", marginBottom: 14,
  },
  pendingBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#B45309" },
  options:   { gap: 8, marginBottom: 6, marginTop: 8 },
  option:    {
    flexDirection: "row", alignItems: "center", gap: 14,
    borderRadius: 14, padding: 14, borderWidth: 1.5,
    backgroundColor: C.background,
  },
  optIcon:   { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  optLabel:  { fontSize: 15, fontFamily: "Inter_700Bold" },
  optSub:    { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  cancelBtn: { alignItems: "center", marginTop: 14 },
  cancelText: { fontSize: 14, fontFamily: "Inter_500Medium", color: C.textMuted },
});
