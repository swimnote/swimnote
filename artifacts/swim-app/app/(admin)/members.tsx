import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { ScreenLayout }  from "@/components/common/ScreenLayout";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { FilterChips, FilterChipItem } from "@/components/common/FilterChips";
import { EmptyState }    from "@/components/common/EmptyState";
import {
  StudentMember, StudentFilterKey,
  WEEKLY_BADGE,
  applyStudentFilter, searchStudents,
} from "@/utils/studentUtils";
import { MemberCard } from "@/components/common/MemberCard";
import { useSelectionMode } from "@/hooks/useSelectionMode";
import { SelectionActionBar } from "@/components/admin/SelectionActionBar";
import { InviteModal } from "@/components/admin/members/InviteModal";
import { RegisterModal } from "@/components/admin/members/RegisterModal";
import { ClassPickerModal } from "@/components/admin/member/ClassPickerModal";
import type { ClassGroup } from "@/components/admin/member/memberDetailTypes";

const C = Colors.light;

const FILTER_CHIPS: FilterChipItem<StudentFilterKey>[] = [
  { key: "all",          label: "전체",   icon: "list" },
  { key: "normal",       label: "정상",   icon: "check-circle",  activeColor: "#1F8F86", activeBg: "#DDF2EF" },
  { key: "unassigned",   label: "미배정", icon: "alert-circle",  activeColor: "#D96C6C", activeBg: "#F9DEDA" },
  { key: "weekly_1",     label: "주1회",  icon: "sun",           activeColor: WEEKLY_BADGE[1].color, activeBg: WEEKLY_BADGE[1].bg },
  { key: "weekly_2",     label: "주2회",  icon: "wind",          activeColor: WEEKLY_BADGE[2].color, activeBg: WEEKLY_BADGE[2].bg },
  { key: "weekly_3",     label: "주3회",  icon: "zap",           activeColor: WEEKLY_BADGE[3].color, activeBg: WEEKLY_BADGE[3].bg },
  { key: "unlinked",     label: "학부모미연결", icon: "user-x",        activeColor: "#EA580C", activeBg: "#FFF1BF" },
  { key: "suspended",    label: "연기",   icon: "pause-circle",  activeColor: "#B45309", activeBg: "#FFF1BF" },
  { key: "withdrawn",    label: "퇴원",   icon: "log-out",       activeColor: "#6F6B68", activeBg: "#F6F3F1" },
];

export default function MembersScreen() {
  const { token, pool } = useAuth();
  const { themeColor }  = useBrand();
  const insets          = useSafeAreaInsets();
  const { filter: filterParam } = useLocalSearchParams<{ filter?: string }>();

  const [students,          setStudents]          = useState<StudentMember[]>([]);
  const [classGroups,       setClassGroups]       = useState<ClassGroup[]>([]);
  const [loading,           setLoading]           = useState(true);
  const [refreshing,        setRefreshing]        = useState(false);
  const [showMemberLimitModal, setShowMemberLimitModal] = useState(false);
  const [teacherRequests,   setTeacherRequests]   = useState<any[]>([]);
  const [approvingId,       setApprovingId]       = useState<string | null>(null);
  const [rejectingId,       setRejectingId]       = useState<string | null>(null);
  const [filter,         setFilter]         = useState<StudentFilterKey>(
    (filterParam as StudentFilterKey) ?? "all"
  );
  const [search,         setSearch]         = useState("");
  const [showRegister,   setShowRegister]   = useState(false);
  const [inviteTarget,   setInviteTarget]   = useState<StudentMember | null>(null);
  const [deletingId,       setDeletingId]       = useState<string | null>(null);
  const [bulkDeleting,     setBulkDeleting]     = useState(false);
  const [deleteTarget,     setDeleteTarget]     = useState<{id: string; name: string} | null>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [bulkDeleteFail,   setBulkDeleteFail]   = useState(0);
  const [infoModal,        setInfoModal]        = useState<string | null>(null);
  const sel = useSelectionMode();

  // ── 반이동 ─────────────────────────────────────────────────────────
  const [transferTarget,    setTransferTarget]    = useState<StudentMember | null>(null);
  const [transferPickedIds, setTransferPickedIds] = useState<string[]>([]);
  const [transferSaving,    setTransferSaving]    = useState(false);

  // ── 연기 / 퇴원 ────────────────────────────────────────────────────
  const [statusTarget, setStatusTarget] = useState<StudentMember | null>(null);
  const [statusAction, setStatusAction] = useState<"suspended" | "withdrawn" | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [res, reqRes, cgRes] = await Promise.all([
        apiRequest(token, "/students"),
        apiRequest(token, "/students/teacher-requests"),
        apiRequest(token, "/class-groups"),
      ]);
      if (res.ok) {
        const data = await res.json();
        setStudents(Array.isArray(data) ? data : []);
      }
      if (reqRes.ok) {
        const reqData = await reqRes.json();
        setTeacherRequests(Array.isArray(reqData) ? reqData : []);
      }
      if (cgRes.ok) {
        const cgData = await cgRes.json();
        setClassGroups(Array.isArray(cgData) ? cgData : []);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  async function handleApprove(id: string, name: string) {
    setApprovingId(id);
    try {
      const res = await apiRequest(token, `/students/teacher-requests/${id}/approve`, { method: "POST" });
      if (res.ok) {
        setTeacherRequests(prev => prev.filter(r => r.id !== id));
        setInfoModal(`${name} 학생이 정식 회원으로 등록됐습니다.`);
        load();
      } else {
        const d = await res.json();
        setInfoModal(d.message || "승인에 실패했습니다.");
      }
    } catch { setInfoModal("네트워크 오류가 발생했습니다."); }
    finally { setApprovingId(null); }
  }

  async function handleReject(id: string, name: string) {
    setRejectingId(id);
    try {
      const res = await apiRequest(token, `/students/teacher-requests/${id}/reject`, { method: "DELETE" });
      if (res.ok) {
        setTeacherRequests(prev => prev.filter(r => r.id !== id));
      } else {
        const d = await res.json();
        setInfoModal(d.message || "거절에 실패했습니다.");
      }
    } catch { setInfoModal("네트워크 오류가 발생했습니다."); }
    finally { setRejectingId(null); }
  }

  useEffect(() => { load(); }, [load]);

  function handleDelete(id: string, name: string) {
    setDeleteTarget({ id, name });
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const { id } = deleteTarget;
    setDeleteTarget(null);
    setDeletingId(id);
    try {
      const res = await apiRequest(token, `/students/${id}`, { method: "DELETE" });
      if (res.ok) {
        setStudents(prev => prev.filter(s => s.id !== id));
      } else {
        setInfoModal("삭제에 실패했습니다.");
      }
    } catch {
      setInfoModal("네트워크 오류가 발생했습니다.");
    } finally {
      setDeletingId(null);
    }
  }

  function handleBulkDelete() {
    if (sel.selectedIds.size === 0) return;
    setBulkDeleteConfirm(true);
  }

  async function confirmBulkDelete() {
    setBulkDeleteConfirm(false);
    const ids = Array.from(sel.selectedIds);
    const count = ids.length;
    setBulkDeleting(true);
    try {
      console.log(`[admin][deleteStudent] selectedCount=${count}`, ids);
      const results = await Promise.allSettled(
        ids.map(id => apiRequest(token, `/students/${id}`, { method: "DELETE" })
          .then(r => ({ id, ok: r.ok }))
        )
      );
      const succeeded = results
        .filter((r): r is PromiseFulfilledResult<{ id: string; ok: boolean }> => r.status === "fulfilled" && r.value.ok)
        .map(r => r.value.id);
      const failed = ids.length - succeeded.length;
      setStudents(prev => prev.filter(s => !succeeded.includes(s.id)));
      sel.exitSelectionMode();
      console.log(`[admin][deleteStudent] student soft deleted: ${succeeded.join(", ")}`);
      if (failed > 0) setBulkDeleteFail(failed);
    } catch (e) {
      console.error(e);
      setInfoModal("삭제 중 오류가 발생했습니다.");
    } finally {
      setBulkDeleting(false);
    }
  }

  // ── 반이동 ─────────────────────────────────────────────────────────
  function handleTransfer(item: StudentMember) {
    setTransferPickedIds(Array.isArray(item.assigned_class_ids) ? item.assigned_class_ids : []);
    setTransferTarget(item);
  }

  async function confirmTransfer(newIds: string[]) {
    if (!transferTarget) return;
    setTransferTarget(null);
    setTransferSaving(true);
    const wc = typeof transferTarget.weekly_count === "number" ? transferTarget.weekly_count : 1;
    try {
      const res = await apiRequest(token, `/students/${transferTarget.id}/assign`, {
        method: "PATCH",
        body: JSON.stringify({ assigned_class_ids: newIds, weekly_count: wc }),
      });
      if (res.ok) {
        const updated = await res.json();
        setStudents(prev => prev.map(s =>
          s.id === transferTarget.id
            ? { ...s, ...updated, assigned_class_ids: newIds, status: "active" }
            : s
        ));
        load();
      } else {
        const d = await res.json().catch(() => ({}));
        setInfoModal(d.message || "반이동에 실패했습니다.");
      }
    } catch { setInfoModal("네트워크 오류가 발생했습니다."); }
    finally { setTransferSaving(false); }
  }

  // ── 연기 / 퇴원 ────────────────────────────────────────────────────
  function openStatusAction(item: StudentMember, action: "suspended" | "withdrawn") {
    setStatusTarget(item);
    setStatusAction(action);
  }

  async function confirmStatusAction() {
    if (!statusTarget || !statusAction) return;
    const { id, name } = statusTarget;
    const action = statusAction;
    setStatusTarget(null);
    setStatusAction(null);
    setStatusSaving(true);
    try {
      const res = await apiRequest(token, `/students/${id}/change-status`, {
        method: "POST",
        body: JSON.stringify({ new_status: action, effective_mode: "immediate" }),
      });
      if (res.ok) {
        if (action === "withdrawn") {
          // optimistic: 퇴원 → 리스트에서 제거
          setStudents(prev => prev.filter(s => s.id !== id));
        } else {
          // optimistic: 연기 → 상태 갱신 + 반배정 초기화
          setStudents(prev => prev.map(s =>
            s.id === id
              ? { ...s, status: "suspended", assigned_class_ids: [], class_group_id: null, schedule_labels: null }
              : s
          ));
        }
        load();
      } else {
        const d = await res.json().catch(() => ({}));
        setInfoModal(d.message || "처리에 실패했습니다.");
      }
    } catch { setInfoModal("네트워크 오류가 발생했습니다."); }
    finally { setStatusSaving(false); }
  }

  const filtered = searchStudents(applyStudentFilter(students, filter), search);

  const chipsWithCount: FilterChipItem<StudentFilterKey>[] = FILTER_CHIPS.map(chip => ({
    ...chip,
    count: applyStudentFilter(students, chip.key).length,
    activeColor: chip.activeColor || themeColor,
    activeBg: chip.activeBg || (themeColor + "18"),
  }));

  const poolName = (pool as any)?.name || "수영장";
  const memberCount = pool?.member_count ?? 0;
  const memberLimit = pool?.member_limit ?? 9999;
  const isMemberLimitReached = memberCount >= memberLimit;

  const filteredIds = filtered.map(s => s.id);

  function handleAddMember() {
    if (isMemberLimitReached) { setShowMemberLimitModal(true); return; }
    setShowRegister(true);
  }

  const header = (
    <>
      <SubScreenHeader title="회원 관리" />

      {/* ── 선생님 등록 요청 승인 대기 섹션 ── */}
      {teacherRequests.length > 0 && (
        <View style={ms.pendingSection}>
          <View style={ms.pendingHeader}>
            <View style={ms.pendingBadge}>
              <Text style={ms.pendingBadgeTxt}>{teacherRequests.length}</Text>
            </View>
            <Text style={ms.pendingSectionTitle}>선생님 등록 요청 승인 대기</Text>
          </View>
          {teacherRequests.map(req => (
            <View key={req.id} style={ms.pendingCard}>
              <View style={ms.pendingCardLeft}>
                <View style={ms.pendingAvatar}>
                  <Text style={ms.pendingAvatarTxt}>{req.name?.[0] ?? "?"}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={ms.pendingName}>{req.name}</Text>
                  <Text style={ms.pendingMeta} numberOfLines={1}>
                    {[req.birth_year ? `${req.birth_year}년생` : null, req.parent_name, req.parent_phone ? req.parent_phone.replace(/(\d{3})(\d{3,4})(\d{4})/, "$1-$2-$3") : null].filter(Boolean).join(" · ") || "추가 정보 없음"}
                  </Text>
                </View>
              </View>
              <View style={ms.pendingActions}>
                <Pressable
                  style={[ms.pendingBtn, { backgroundColor: "#F9DEDA" }]}
                  onPress={() => handleReject(req.id, req.name)}
                  disabled={rejectingId === req.id || approvingId === req.id}
                >
                  {rejectingId === req.id
                    ? <ActivityIndicator size="small" color="#D96C6C" />
                    : <Text style={[ms.pendingBtnTxt, { color: "#D96C6C" }]}>거절</Text>
                  }
                </Pressable>
                <Pressable
                  style={[ms.pendingBtn, { backgroundColor: "#DDF2EF" }]}
                  onPress={() => handleApprove(req.id, req.name)}
                  disabled={approvingId === req.id || rejectingId === req.id}
                >
                  {approvingId === req.id
                    ? <ActivityIndicator size="small" color="#1F8F86" />
                    : <Text style={[ms.pendingBtnTxt, { color: "#1F8F86" }]}>승인</Text>
                  }
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* 상단 버튼 */}
      <View style={ms.actionRow}>
        {!sel.selectionMode ? (
          <>
            <Pressable style={[ms.actionBtn, { backgroundColor: isMemberLimitReached ? "#9A948F" : themeColor }]} onPress={handleAddMember}>
              <Feather name={isMemberLimitReached ? "lock" : "user-plus"} size={14} color="#fff" />
              <Text style={ms.actionBtnText}>어린이 직접 등록</Text>
            </Pressable>
            <Pressable
              style={[ms.actionBtn, { backgroundColor: "#6F6B68" }]}
              onPress={() => router.push("/(admin)/approvals" as any)}
            >
              <Feather name="check-circle" size={14} color="#fff" />
              <Text style={ms.actionBtnText}>학부모 요청 승인</Text>
            </Pressable>
            <Pressable style={[ms.selBtn]} onPress={sel.enterSelectionMode}>
              <Feather name="check-square" size={16} color={C.textSecondary} />
            </Pressable>
          </>
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 4 }}>
            <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.textSecondary }}>
              선택 모드 — {sel.selectedCount}명 선택됨
            </Text>
          </View>
        )}
      </View>
      {/* 검색 */}
      <View style={[ms.searchRow, { borderColor: C.border, backgroundColor: C.card }]}>
        <Feather name="search" size={16} color={C.textMuted} />
        <TextInput
          style={[ms.searchInput, { color: C.text }]}
          value={search} onChangeText={setSearch}
          placeholder="이름·보호자·전화번호 검색"
          placeholderTextColor={C.textMuted}
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch("")}>
            <Feather name="x-circle" size={16} color={C.textMuted} />
          </Pressable>
        )}
      </View>
      <FilterChips<StudentFilterKey> chips={chipsWithCount} active={filter} onChange={setFilter} wrap wrapCols={3} />
    </>
  );

  if (loading) {
    return (
      <ScreenLayout header={header}>
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} size="large" />
      </ScreenLayout>
    );
  }

  return (
    <>
      <ScreenLayout header={header}>
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          contentContainerStyle={[ms.list, { paddingBottom: sel.selectionMode ? insets.bottom + 90 : insets.bottom + 120 }]}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListHeaderComponent={filter === "suspended" ? (
            <View style={ms.suspendedBanner}>
              <Feather name="info" size={14} color="#B45309" />
              <Text style={ms.suspendedBannerTitle}>연기 회원도 정상 요금 100% 과금</Text>
            </View>
          ) : null}
          ListEmptyComponent={
            <EmptyState
              icon="users"
              title="해당하는 회원이 없습니다"
              subtitle={search ? `"${search}" 검색 결과가 없습니다` : filter !== "all" ? "필터를 변경해보세요" : "어린이 직접 등록 버튼으로 첫 회원을 추가해보세요"}
            />
          }
          renderItem={({ item }) => (
            <View style={{ marginHorizontal: 16 }}>
              <MemberCard
                student={item}
                themeColor={themeColor}
                onPress={() => router.push({ pathname: "/(admin)/member-detail", params: { id: item.id } } as any)}
                showInvite={!!(item.invite_code && !item.parent_user_id)}
                onPressInvite={() => setInviteTarget(item)}
                selectionMode={sel.selectionMode}
                isSelected={sel.isSelected(item.id)}
                onToggle={() => sel.toggleItem(item.id)}
                actions={[
                  {
                    label: "반이동",
                    icon: "shuffle",
                    color: themeColor,
                    bg: themeColor + "15",
                    onPress: () => handleTransfer(item),
                    loading: transferSaving && transferTarget === null,
                  },
                  {
                    label: "연기",
                    icon: "pause-circle",
                    color: "#B45309",
                    bg: "#FFF1BF",
                    onPress: () => openStatusAction(item, "suspended"),
                    loading: statusSaving && statusTarget?.id === item.id && statusAction === "suspended",
                  },
                  {
                    label: "퇴원",
                    icon: "log-out",
                    color: "#991B1B",
                    bg: "#FEF2F2",
                    onPress: () => openStatusAction(item, "withdrawn"),
                    loading: statusSaving && statusTarget?.id === item.id && statusAction === "withdrawn",
                  },
                  {
                    label: "삭제",
                    icon: "trash-2",
                    color: C.error,
                    bg: "#F9DEDA",
                    onPress: () => handleDelete(item.id, item.name),
                    loading: deletingId === item.id,
                  },
                ]}
              />
            </View>
          )}
        />
        <SelectionActionBar
          visible={sel.selectionMode}
          selectedCount={sel.selectedCount}
          totalCount={filtered.length}
          isAllSelected={sel.isAllSelected(filteredIds)}
          deleting={bulkDeleting}
          onSelectAll={() => sel.selectAll(filteredIds)}
          onClearSelection={sel.clearSelection}
          onDeleteSelected={handleBulkDelete}
          onExit={sel.exitSelectionMode}
        />
      </ScreenLayout>

      {/* ── 반이동 모달 ── */}
      {transferTarget && (
        <ClassPickerModal
          groups={classGroups}
          selectedIds={transferPickedIds}
          maxSelect={typeof transferTarget.weekly_count === "number" ? transferTarget.weekly_count : 1}
          onSelect={confirmTransfer}
          onClose={() => setTransferTarget(null)}
        />
      )}

      {showRegister && (
        <RegisterModal
          token={token}
          poolName={poolName}
          onSuccess={(s) => {
            setStudents(prev => [s, ...prev]);
            setShowRegister(false);
          }}
          onClose={() => setShowRegister(false)}
        />
      )}
      {inviteTarget && (
        <InviteModal
          student={inviteTarget}
          poolName={poolName}
          onClose={() => setInviteTarget(null)}
        />
      )}

      {/* ── 연기 확인 ── */}
      <ConfirmModal
        visible={statusTarget !== null && statusAction === "suspended"}
        title="연기 처리"
        message={statusTarget ? `"${statusTarget.name}" 회원을 즉시 연기 처리합니다.\n\n반 배정이 해제되며 연기 상태로 변경됩니다.` : ""}
        confirmText="연기 처리"
        cancelText="취소"
        onConfirm={confirmStatusAction}
        onCancel={() => { setStatusTarget(null); setStatusAction(null); }}
      />

      {/* ── 퇴원 확인 ── */}
      <ConfirmModal
        visible={statusTarget !== null && statusAction === "withdrawn"}
        title="퇴원 처리"
        message={statusTarget ? `"${statusTarget.name}" 회원을 즉시 퇴원 처리합니다.\n\n반 배정이 해제되며 목록에서 제거됩니다.` : ""}
        confirmText="퇴원 처리"
        cancelText="취소"
        destructive
        onConfirm={confirmStatusAction}
        onCancel={() => { setStatusTarget(null); setStatusAction(null); }}
      />

      <ConfirmModal
        visible={!!deleteTarget}
        title="회원 삭제"
        message={`"${deleteTarget?.name}" 회원은 운영 목록에서 제거되고 삭제회원으로 보관됩니다.\n학부모 계정은 유지되며 기존 수업 정보는 보존됩니다.`}
        confirmText="삭제"
        cancelText="취소"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmModal
        visible={bulkDeleteConfirm}
        title="선택 회원 삭제"
        message={`선택한 ${sel.selectedIds.size}명을 삭제 처리합니다.\n삭제된 회원은 보관 목록에서 확인할 수 있습니다.`}
        confirmText={`${sel.selectedIds.size}명 삭제`}
        cancelText="취소"
        destructive
        onConfirm={confirmBulkDelete}
        onCancel={() => setBulkDeleteConfirm(false)}
      />

      <ConfirmModal
        visible={bulkDeleteFail > 0}
        title="일부 실패"
        message={`${bulkDeleteFail}명 삭제에 실패했습니다.`}
        confirmText="확인"
        onConfirm={() => setBulkDeleteFail(0)}
      />

      <ConfirmModal
        visible={!!infoModal}
        title="알림"
        message={infoModal ?? ""}
        confirmText="확인"
        onConfirm={() => setInfoModal(null)}
      />

      <ConfirmModal
        visible={showMemberLimitModal}
        title="등록 가능 인원 초과"
        message={`등록 가능 인원(${memberLimit}명)을 초과했습니다.\n상위 플랜으로 업그레이드해주세요.`}
        confirmText="플랜 업그레이드"
        cancelText="닫기"
        onConfirm={() => { setShowMemberLimitModal(false); router.push("/(admin)/billing" as any); }}
        onCancel={() => setShowMemberLimitModal(false)}
      />
    </>
  );
}

const ms = StyleSheet.create({
  pendingSection:     { marginHorizontal: 16, marginBottom: 10, borderRadius: 14, backgroundColor: "#FFFBEB", borderWidth: 1.5, borderColor: "#FDE68A", padding: 12, gap: 8 },
  pendingHeader:      { flexDirection: "row", alignItems: "center", gap: 8 },
  pendingBadge:       { width: 22, height: 22, borderRadius: 11, backgroundColor: "#D97706", alignItems: "center", justifyContent: "center" },
  pendingBadgeTxt:    { color: "#fff", fontSize: 11, fontFamily: "Inter_700Bold" },
  pendingSectionTitle:{ fontSize: 13, fontFamily: "Inter_700Bold", color: "#92400E" },
  pendingCard:        { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", borderRadius: 10, padding: 10, borderWidth: 1, borderColor: "#FDE68A" },
  pendingCardLeft:    { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  pendingAvatar:      { width: 36, height: 36, borderRadius: 10, backgroundColor: "#FFF1BF", alignItems: "center", justifyContent: "center" },
  pendingAvatarTxt:   { fontSize: 14, fontFamily: "Inter_700Bold", color: "#D97706" },
  pendingName:        { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  pendingMeta:        { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 1 },
  pendingActions:     { flexDirection: "row", gap: 6 },
  pendingBtn:         { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  pendingBtnTxt:      { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  actionRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 12 },
  actionBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  selBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, height: 44, marginHorizontal: 16, marginBottom: 4 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  list: { paddingTop: 10 },
  suspendedBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FFF1BF", borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, marginHorizontal: 16, marginBottom: 10, borderWidth: 1, borderColor: "#FDE68A" },
  suspendedBannerTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#92400E" },
  suspendedBannerBody: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#92400E", lineHeight: 18 },
});
