/**
 * (teacher)/students.tsx — 대기자 명단
 *
 * 탭: 전체 / 미배정 / 연기예정 / 퇴원예정
 *
 * 전체: 내 풀의 모든 활성 회원 + 예정 상태 회원
 * 미배정: 반 배정이 없는 활성 회원
 * 연기예정: pending_status_change = 'suspended'
 * 퇴원예정: pending_status_change = 'withdrawn'
 *
 * 연기예정/퇴원예정 카드 → 처리 팝업 → 이달 말 유지 / 오늘 즉시 적용
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable,
  RefreshControl, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
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

type TabKey = "all" | "unassigned" | "suspend_pending" | "withdraw_pending";

const TAB_CONFIG: { key: TabKey; label: string; color: string }[] = [
  { key: "all",              label: "전체",   color: "#374151" },
  { key: "unassigned",       label: "미배정", color: "#DC2626" },
  { key: "suspend_pending",  label: "연기예정", color: "#B45309" },
  { key: "withdraw_pending", label: "퇴원예정", color: "#6B7280" },
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
  const [actionTarget, setActionTarget] = useState<TeacherMember | null>(null);
  const [applying,   setApplying]   = useState(false);

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

  // 즉시 적용
  async function applyNow() {
    if (!actionTarget) return;
    setApplying(true);
    try {
      const res = await apiRequest(token, `/students/${actionTarget.id}/apply-pending-now`, {
        method: "POST",
      });
      if (res.ok) {
        // 목록에서 즉시 제거 (상태가 바뀌어 이 탭과 전체 탭에서 사라짐)
        setList(prev => prev.filter(m => m.id !== actionTarget.id));
      }
    } catch (e) { console.error(e); }
    finally { setApplying(false); setActionTarget(null); }
  }

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
    return "회원이 없습니다";
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.background }} edges={[]}>
      <SubScreenHeader title="대기자 명단" homePath="/(teacher)/today-schedule" />

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
          renderItem={({ item }) => {
            const hasPending = item.pending_status_change === "suspended" || item.pending_status_change === "withdrawn";
            return (
              <UnifiedMemberCard
                student={toStudentMember(item)}
                onPress={() => router.push({ pathname: "/(teacher)/student-detail", params: { id: item.id } } as any)}
                actions={hasPending ? [
                  {
                    label: item.pending_status_change === "suspended" ? "연기예정 처리" : "퇴원예정 처리",
                    icon: "settings",
                    color: item.pending_status_change === "suspended" ? "#B45309" : "#DC2626",
                    bg: item.pending_status_change === "suspended" ? "#FEF3C7" : "#FEF2F2",
                    onPress: () => setActionTarget(item),
                  },
                ] : undefined}
              />
            );
          }}
        />
      )}

      {/* 예정 상태 처리 팝업 */}
      {actionTarget && (
        <PendingActionModal
          member={actionTarget}
          applying={applying}
          onApplyNow={applyNow}
          onKeep={() => setActionTarget(null)}
          onCancel={() => setActionTarget(null)}
        />
      )}
    </SafeAreaView>
  );
}

// ── 예정 상태 처리 모달 ───────────────────────────────────────────
function PendingActionModal({
  member, applying, onApplyNow, onKeep, onCancel,
}: {
  member: TeacherMember;
  applying: boolean;
  onApplyNow: () => void;
  onKeep: () => void;
  onCancel: () => void;
}) {
  const isSuspend = member.pending_status_change === "suspended";
  const label = isSuspend ? "연기" : "퇴원";
  const labelColor = isSuspend ? "#B45309" : "#DC2626";
  const labelBg = isSuspend ? "#FEF3C7" : "#FEF2F2";
  const labelBgBtn = isSuspend ? "#FFFBEB" : "#FEF2F2";

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onCancel}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)" }} onPress={onCancel} />
      <View style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        backgroundColor: C.background, borderTopLeftRadius: 20, borderTopRightRadius: 20,
        padding: 24, paddingBottom: 36,
      }}>
        <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: C.text, marginBottom: 4 }}>
          {`"${member.name}" ${label}예정 처리`}
        </Text>
        <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: C.textMuted, marginBottom: 20 }}>
          {label} 처리 시점을 선택하세요.
        </Text>

        <View style={{ gap: 10 }}>
          {/* 이달 말 유지 */}
          <Pressable
            onPress={onKeep}
            style={{ flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "#F9FAFB", borderRadius: 14, padding: 16, borderWidth: 1.5, borderColor: C.border }}
          >
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" }}>
              <Feather name="calendar" size={20} color={C.textSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: C.text }}>이달 말 {label} 유지</Text>
              <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 }}>
                이번 달 수업 계속 유지, 말일에 {label} 확정 처리
              </Text>
            </View>
          </Pressable>

          {/* 오늘 즉시 */}
          <Pressable
            onPress={onApplyNow}
            disabled={applying}
            style={{ flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: labelBgBtn, borderRadius: 14, padding: 16, borderWidth: 1.5, borderColor: labelColor + "40" }}
          >
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: labelBg, alignItems: "center", justifyContent: "center" }}>
              {applying
                ? <ActivityIndicator size={16} color={labelColor} />
                : <Feather name="zap" size={20} color={labelColor} />
              }
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: labelColor }}>
                오늘 즉시 {label}
              </Text>
              <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 }}>
                지금 바로 {label} 처리, 반 배정에서 즉시 제외됩니다
              </Text>
            </View>
          </Pressable>
        </View>

        <Pressable onPress={onCancel} style={{ alignItems: "center", marginTop: 18 }}>
          <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: C.textMuted }}>취소</Text>
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
});
