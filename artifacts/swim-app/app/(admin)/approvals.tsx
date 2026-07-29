import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Modal, Pressable,
  RefreshControl, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { ClassTransferModal }  from "@/components/admin/ClassTransferModal";
import { TeacherDetailModal }  from "@/components/admin/TeacherDetailModal";
import { ScreenLayout }  from "@/components/common/ScreenLayout";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { FilterChips, FilterChipItem } from "@/components/common/FilterChips";
import { EmptyState }    from "@/components/common/EmptyState";
import { ApprovalCard, ApprovalCardMeta } from "@/components/approval/ApprovalCard";
import { RejectModal }   from "@/components/common/RejectModal";
import { LucideIcon }    from "@/components/common/LucideIcon";

const C = Colors.light;

interface TeacherInvite {
  id: string; name: string; phone: string; position: string | null;
  invite_token: string | null; invite_status: string;
  created_at: string; requested_at: string | null;
  approved_at: string | null; user_email: string | null;
  user_id: string | null;
  user_roles?: string[] | null;
}

interface TeacherDetail {
  id: string; name: string; phone: string; position: string | null;
  invite_status: string; approved_at: string | null;
  user_email: string | null; user_id: string | null;
  user_roles: string[]; is_activated: boolean;
  class_count: number; member_count: number;
}

interface ParentPending {
  id: string;
  parent_id: string;
  parent_name: string;
  parent_phone: string;
  child_name_raw: string;
  pending_reason: string | null;
  rejection_reason: string | null;
  status: string;
  retry_count: number;
  created_at: string;
}

type StatusFilter = "pending" | "approved" | "rejected";
type TabType = "teacher" | "parent";

function parseRoles(roles: any): string[] {
  if (Array.isArray(roles)) return roles;
  if (typeof roles === "string" && roles.startsWith("{")) {
    return roles.slice(1, -1).split(",").map(r => r.replace(/^"|"$/g, "").trim()).filter(Boolean);
  }
  return [];
}

function pendingReasonLabel(reason: string | null): string {
  if (!reason) return "";
  if (reason === "name_mismatch")  return "학생 이름 불일치";
  if (reason === "phone_mismatch") return "보호자2 전화번호 불일치";
  if (reason === "duplicate_name") return "동명이인 — 전화번호 확인 필요";
  return reason;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const h = d.getHours().toString().padStart(2, "0");
    const min = d.getMinutes().toString().padStart(2, "0");
    return `${m}/${day} ${h}:${min}`;
  } catch { return iso; }
}

const _IC = "#0F172A"; const _IB = "#E6FAF8";
const FILTER_CHIPS_TEACHER: FilterChipItem<StatusFilter>[] = [
  { key: "pending",  label: "대기",   icon: "clock",        activeColor: _IC, activeBg: _IB },
  { key: "approved", label: "승인",   icon: "check-circle", activeColor: _IC, activeBg: _IB },
  { key: "rejected", label: "거절됨", icon: "x-circle",     activeColor: _IC, activeBg: _IB },
];

export default function ApprovalsScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<TabType>("teacher");

  // ── 선생님 탭 상태 ──
  const [filter, setFilter]   = useState<StatusFilter>("pending");
  const [invites, setInvites]  = useState<TeacherInvite[]>([]);
  const [loadingTeacher, setLoadingTeacher] = useState(true);
  const [refreshingTeacher, setRefreshingTeacher] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [teacherDetailInvite, setTeacherDetailInvite] = useState<TeacherInvite | null>(null);
  const [teacherDetail, setTeacherDetail] = useState<TeacherDetail | null>(null);
  const [teacherDetailLoading, setTeacherDetailLoading] = useState(false);
  const [transferSource, setTransferSource] = useState<TeacherInvite | null>(null);
  const [actionProcessing, setActionProcessing] = useState(false);

  // ── 학부모 탭 상태 ──
  const [parentFilter, setParentFilter] = useState<StatusFilter>("pending");
  const [parentPending, setParentPending] = useState<ParentPending[]>([]);
  const [loadingParent, setLoadingParent] = useState(false);
  const [refreshingParent, setRefreshingParent] = useState(false);
  const [parentProcessingId, setParentProcessingId] = useState<string | null>(null);
  const [parentRejectTarget, setParentRejectTarget] = useState<ParentPending | null>(null);

  const loadTeacher = useCallback(async () => {
    try {
      const res = await apiRequest(token, "/admin/teacher-invites");
      if (res.ok) { const d = await res.json(); setInvites(d.data ?? []); }
    } catch (e) { console.error(e); }
    finally { setLoadingTeacher(false); setRefreshingTeacher(false); }
  }, [token]);

  const loadParent = useCallback(async (statusFilter: StatusFilter = "pending") => {
    setLoadingParent(true);
    try {
      const res = await apiRequest(token, `/admin/parent-v2-pending?status=${statusFilter}`);
      if (res.ok) { const d = await res.json(); setParentPending(d.data ?? []); }
    } catch (e) { console.error(e); }
    finally { setLoadingParent(false); setRefreshingParent(false); }
  }, [token]);

  useEffect(() => { loadTeacher(); }, [loadTeacher]);
  useEffect(() => { if (tab === "parent") loadParent(parentFilter); }, [tab, parentFilter, loadParent]);

  // ── 선생님 액션 ──
  async function handleInviteAction(inviteId: string, action: string, reason?: string) {
    setProcessingId(inviteId);
    try {
      const res = await apiRequest(token, `/admin/teacher-invites/${inviteId}`, {
        method: "PATCH", body: JSON.stringify({ action, rejection_reason: reason }),
      });
      const d = await res.json();
      if (!res.ok) { Alert.alert("오류", d.message || "처리 중 오류 발생"); }
      else {
        setRejectTargetId(null);
        setTeacherDetailInvite(null);
        setTeacherDetail(null);
        const newStatus = action === "approve" ? "approved" : action === "reject" ? "rejected" : "inactive";
        setInvites(prev => prev.map(i => i.id === inviteId ? { ...i, invite_status: newStatus } : i));
      }
    } finally { setProcessingId(null); }
  }

  async function handleViewTeacher(inv: TeacherInvite) {
    setTeacherDetailInvite(inv);
    setTeacherDetailLoading(true);
    try {
      const res = await apiRequest(token, `/admin/teacher-invites/${inv.id}/detail`);
      if (res.ok) { const d = await res.json(); setTeacherDetail(d.data); }
    } catch (e) { console.error(e); }
    finally { setTeacherDetailLoading(false); }
  }

  async function handleRevokeTeacher(inviteId: string) {
    setActionProcessing(true);
    try {
      const res = await apiRequest(token, `/admin/teacher-invites/${inviteId}`, {
        method: "PATCH", body: JSON.stringify({ action: "revoke" }),
      });
      const d = await res.json();
      if (!res.ok) { Alert.alert("오류", d.message || "처리 중 오류"); return; }
      setTeacherDetailInvite(null);
      setTeacherDetail(null);
      setInvites(prev => prev.map(i => i.id === inviteId ? { ...i, invite_status: "inactive" } : i));
    } finally { setActionProcessing(false); }
  }

  async function handleTransfer(inviteId: string, targetUserId: string, targetName: string) {
    setActionProcessing(true);
    try {
      const res = await apiRequest(token, `/admin/teacher-invites/${inviteId}/transfer`, {
        method: "POST",
        body: JSON.stringify({ target_user_id: targetUserId, target_teacher_name: targetName }),
      });
      const d = await res.json();
      if (!res.ok) { Alert.alert("오류", d.message || "처리 중 오류"); return; }
      Alert.alert("완료", d.message || "수업 인수가 완료되었습니다.");
      setTransferSource(null);
      setTeacherDetailInvite(null);
      setTeacherDetail(null);
      await loadTeacher();
    } finally { setActionProcessing(false); }
  }

  // ── 학부모 연결 승인/거절 ──
  async function handleParentApprove(item: ParentPending) {
    setParentProcessingId(item.id);
    try {
      const res = await apiRequest(token, `/admin/parent-v2-pending/${item.id}`, {
        method: "PATCH", body: JSON.stringify({ action: "approve" }),
      });
      const d = await res.json();
      if (!res.ok) { Alert.alert("오류", d.message || "처리 중 오류가 발생했습니다."); return; }
      Alert.alert("승인 완료", `${item.parent_name}님과 ${item.child_name_raw} 연결이 완료됐습니다.`);
      setParentPending(prev => prev.filter(p => p.id !== item.id));
    } finally { setParentProcessingId(null); }
  }

  async function handleParentReject(item: ParentPending, reason?: string) {
    setParentProcessingId(item.id);
    try {
      const res = await apiRequest(token, `/admin/parent-v2-pending/${item.id}`, {
        method: "PATCH", body: JSON.stringify({ action: "reject", reason }),
      });
      const d = await res.json();
      if (!res.ok) { Alert.alert("오류", d.message || "처리 중 오류가 발생했습니다."); return; }
      setParentRejectTarget(null);
      setParentPending(prev => prev.filter(p => p.id !== item.id));
    } finally { setParentProcessingId(null); }
  }

  // ── 선생님 탭 렌더 ──
  const filteredTeachers = invites.filter(i => {
    if (filter === "pending")  return i.invite_status === "joinedPendingApproval";
    if (filter === "approved") return i.invite_status === "approved";
    if (filter === "rejected") return i.invite_status === "rejected" || i.invite_status === "inactive";
    return false;
  });
  const pendingCnt = invites.filter(i => i.invite_status === "joinedPendingApproval").length;
  const teacherChips: FilterChipItem<StatusFilter>[] = FILTER_CHIPS_TEACHER.map(chip => ({
    ...chip,
    count: chip.key === "pending"  ? pendingCnt
         : chip.key === "approved" ? invites.filter(i => i.invite_status === "approved").length
         : invites.filter(i => i.invite_status === "rejected" || i.invite_status === "inactive").length,
  }));

  function buildTeacherMeta(inv: TeacherInvite): ApprovalCardMeta {
    const isPending = inv.invite_status === "joinedPendingApproval";
    const statusMap: Record<string, ApprovalCardMeta["statusKey"]> = {
      joinedPendingApproval: "waitingApproval",
      approved:              "approved",
      rejected:              "rejected",
      invited:               "invited",
      inactive:              "inactive",
    };
    const roles = parseRoles(inv.user_roles);
    const isAdminGranted = roles.includes("pool_admin");
    const roleText = isAdminGranted ? "선생님+관리자권한" : "선생님";
    const positionText = [inv.position, roleText].filter(Boolean).join(" · ");
    return {
      id:          inv.id,
      name:        inv.name,
      sub1:        inv.phone,
      sub2:        [positionText, inv.user_email].filter(Boolean).join(" · ") || undefined,
      requestedAt: inv.requested_at ?? inv.created_at,
      statusKey:   statusMap[inv.invite_status] ?? "inactive",
      avatarIcon:  "user",
      showActions: isPending,
      processing:  processingId === inv.id,
    };
  }

  function getAvailableTeachersForTransfer(sourceInvite: TeacherInvite) {
    return invites
      .filter(i => i.invite_status === "approved" && i.user_id !== null && i.user_id !== sourceInvite.user_id && i.id !== sourceInvite.id)
      .map(i => ({ inviteId: i.id, userId: i.user_id!, name: i.name, phone: i.phone }));
  }

  // ── 공통 헤더 ──
  const PARENT_FILTER_CHIPS: FilterChipItem<StatusFilter>[] = [
    { key: "pending",  label: "대기",   icon: "clock",        activeColor: _IC, activeBg: _IB },
    { key: "approved", label: "승인됨", icon: "check-circle", activeColor: _IC, activeBg: _IB },
    { key: "rejected", label: "거절됨", icon: "x-circle",     activeColor: _IC, activeBg: _IB },
  ];

  const header = (
    <>
      <SubScreenHeader title="승인 관리" />
      {/* 탭: 선생님 / 학부모 */}
      <View style={s.tabRow}>
        <Pressable
          style={[s.tabBtn, tab === "teacher" && s.tabBtnActive]}
          onPress={() => setTab("teacher")}
        >
          <LucideIcon name="graduation-cap" size={15} color={tab === "teacher" ? C.tint : C.textMuted} />
          <Text style={[s.tabTxt, tab === "teacher" && s.tabTxtActive]}>선생님</Text>
          {pendingCnt > 0 && (
            <View style={s.badge}><Text style={s.badgeTxt}>{pendingCnt}</Text></View>
          )}
        </Pressable>
        <Pressable
          style={[s.tabBtn, tab === "parent" && s.tabBtnActive]}
          onPress={() => setTab("parent")}
        >
          <LucideIcon name="users" size={15} color={tab === "parent" ? C.tint : C.textMuted} />
          <Text style={[s.tabTxt, tab === "parent" && s.tabTxtActive]}>학부모 연결</Text>
          {parentFilter === "pending" && parentPending.length > 0 && (
            <View style={s.badge}><Text style={s.badgeTxt}>{parentPending.length}</Text></View>
          )}
        </Pressable>
      </View>

      {tab === "teacher" && (
        <FilterChips<StatusFilter> chips={teacherChips} active={filter} onChange={setFilter} />
      )}
      {tab === "parent" && (
        <FilterChips<StatusFilter>
          chips={PARENT_FILTER_CHIPS}
          active={parentFilter}
          onChange={v => setParentFilter(v)}
        />
      )}
    </>
  );

  // ── 선생님 탭 내용 ──
  if (tab === "teacher") {
    if (loadingTeacher) {
      return (
        <ScreenLayout header={header}>
          <ActivityIndicator color={C.tint} style={{ marginTop: 80 }} />
        </ScreenLayout>
      );
    }
    return (
      <>
        <ScreenLayout header={header}>
          <FlatList
            data={filteredTeachers}
            keyExtractor={item => item.id}
            contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 100 }]}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshingTeacher} onRefresh={() => { setRefreshingTeacher(true); loadTeacher(); }} />}
            ListEmptyComponent={
              <EmptyState
                icon="send"
                title={
                  filter === "pending"  ? "승인 대기 선생님이 없습니다"
                  : filter === "approved" ? "승인된 선생님이 없습니다"
                  : "내역이 없습니다"
                }
                subtitle={
                  filter === "pending"
                    ? "선생님이 앱에 가입하면 여기 표시됩니다"
                    : "상단 필터에서 다른 상태를 선택해보세요"
                }
              />
            }
            renderItem={({ item: inv }) => (
              <ApprovalCard
                meta={buildTeacherMeta(inv)}
                onApprove={() => handleInviteAction(inv.id, "approve")}
                onView={() => handleViewTeacher(inv)}
              />
            )}
          />
        </ScreenLayout>

        <RejectModal
          visible={!!rejectTargetId}
          onClose={() => setRejectTargetId(null)}
          onConfirm={reason => rejectTargetId && handleInviteAction(rejectTargetId, "reject", reason)}
          loading={!!processingId}
        />

        {teacherDetailInvite && (
          teacherDetailLoading ? (
            <Modal visible transparent animationType="fade">
              <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "rgba(0,0,0,0.3)" }}>
                <ActivityIndicator color={C.tint} size="large" />
              </View>
            </Modal>
          ) : (
            <TeacherDetailModal
              detail={teacherDetail}
              processing={actionProcessing || processingId === teacherDetailInvite.id}
              onClose={() => { setTeacherDetailInvite(null); setTeacherDetail(null); }}
              onApprove={teacherDetailInvite.invite_status === "joinedPendingApproval"
                ? () => handleInviteAction(teacherDetailInvite.id, "approve")
                : undefined}
              onRejectOpen={teacherDetailInvite.invite_status === "joinedPendingApproval"
                ? () => setRejectTargetId(teacherDetailInvite.id)
                : undefined}
              onRevoke={teacherDetailInvite.invite_status === "approved"
                ? () => handleRevokeTeacher(teacherDetailInvite.id)
                : undefined}
              onTransfer={teacherDetailInvite.invite_status === "approved"
                ? () => setTransferSource(teacherDetailInvite)
                : undefined}
            />
          )
        )}

        {transferSource && (
          <ClassTransferModal
            sourceName={transferSource.name}
            availableTeachers={getAvailableTeachersForTransfer(transferSource)}
            processing={actionProcessing}
            onConfirm={(targetUserId, targetName) => handleTransfer(transferSource.id, targetUserId, targetName)}
            onClose={() => setTransferSource(null)}
          />
        )}
      </>
    );
  }

  // ── 학부모 연결 탭 내용 ──
  return (
    <>
      <ScreenLayout header={header}>
        {loadingParent ? (
          <ActivityIndicator color={C.tint} style={{ marginTop: 80 }} />
        ) : (
          <FlatList
            data={parentPending}
            keyExtractor={item => item.id}
            contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 100 }]}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshingParent}
                onRefresh={() => { setRefreshingParent(true); loadParent(parentFilter); }}
              />
            }
            ListEmptyComponent={
              <EmptyState
                icon="link"
                title={
                  parentFilter === "pending"  ? "연결 대기 중인 학부모가 없습니다"
                  : parentFilter === "approved" ? "승인된 연결이 없습니다"
                  : "거절 내역이 없습니다"
                }
                subtitle={
                  parentFilter === "pending"
                    ? "학부모가 자녀 연결을 요청하면 여기 표시됩니다"
                    : "상단 필터에서 다른 상태를 선택해보세요"
                }
              />
            }
            renderItem={({ item }) => (
              <ParentPendingCard
                item={item}
                processing={parentProcessingId === item.id}
                onApprove={() => handleParentApprove(item)}
                onReject={() => setParentRejectTarget(item)}
              />
            )}
          />
        )}
      </ScreenLayout>

      {/* 거절 모달 */}
      <RejectModal
        visible={!!parentRejectTarget}
        onClose={() => setParentRejectTarget(null)}
        onConfirm={reason => parentRejectTarget && handleParentReject(parentRejectTarget, reason)}
        loading={!!parentProcessingId}
      />
    </>
  );
}

// ── 학부모 연결 카드 컴포넌트 ──────────────────────────────────────────
function ParentPendingCard({
  item, processing, onApprove, onReject,
}: {
  item: ParentPending;
  processing: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const reasonLabel = pendingReasonLabel(item.pending_reason);
  const isPending   = item.status === "pending";

  return (
    <View style={[pc.card, { backgroundColor: C.card, borderColor: C.border }]}>
      {/* 학생 이름 + 요청 시간 */}
      <View style={pc.topRow}>
        <View style={pc.studentBadge}>
          <LucideIcon name="user" size={14} color={C.tint} />
          <Text style={[pc.studentName, { color: C.text }]}>{item.child_name_raw || "—"}</Text>
        </View>
        <Text style={[pc.time, { color: C.textMuted }]}>{formatDate(item.created_at)}</Text>
      </View>

      {/* 학부모 정보 */}
      <View style={pc.infoRow}>
        <LucideIcon name="user-circle" size={14} color={C.textMuted} />
        <Text style={[pc.infoTxt, { color: C.textSecondary }]}>{item.parent_name}</Text>
        <Text style={[pc.sep, { color: C.border }]}>·</Text>
        <Text style={[pc.infoTxt, { color: C.textSecondary }]}>{item.parent_phone}</Text>
      </View>

      {/* 자동승인 실패 이유 */}
      {!!reasonLabel && (
        <View style={[pc.reasonBox, { backgroundColor: "#FEF2F2", borderColor: "#FCA5A5" }]}>
          <LucideIcon name="alert-circle" size={13} color="#DC2626" />
          <Text style={[pc.reasonTxt, { color: "#DC2626" }]}>자동승인 실패: {reasonLabel}</Text>
        </View>
      )}

      {/* 액션 버튼 (pending만) */}
      {isPending && (
        <View style={pc.btnRow}>
          <Pressable
            style={[pc.rejectBtn, { borderColor: C.border }]}
            onPress={onReject}
            disabled={processing}
          >
            <Text style={[pc.rejectTxt, { color: C.textSecondary }]}>거절</Text>
          </Pressable>
          <Pressable
            style={[pc.approveBtn, { backgroundColor: C.tint }]}
            onPress={onApprove}
            disabled={processing}
          >
            {processing
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={pc.approveTxt}>승인</Text>
            }
          </Pressable>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  list:        { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  tabRow:      { flexDirection: "row", paddingHorizontal: 16, gap: 8, paddingBottom: 4 },
  tabBtn:      { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
                 gap: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: C.border },
  tabBtnActive:{ borderColor: C.tint, backgroundColor: C.tintLight },
  tabTxt:      { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textMuted },
  tabTxtActive:{ color: C.tint },
  badge:       { backgroundColor: "#EF4444", borderRadius: 8, minWidth: 18, height: 18,
                 alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  badgeTxt:    { color: "#fff", fontSize: 11, fontFamily: "Pretendard-Regular" },
});

const pc = StyleSheet.create({
  card:       { borderRadius: 12, borderWidth: 1, padding: 14, gap: 8 },
  topRow:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  studentBadge:{ flexDirection: "row", alignItems: "center", gap: 6,
                 backgroundColor: C.tintLight, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  studentName:{ fontSize: 15, fontFamily: "Pretendard-Regular", fontWeight: "600" },
  time:       { fontSize: 12, fontFamily: "Pretendard-Regular" },
  infoRow:    { flexDirection: "row", alignItems: "center", gap: 6 },
  infoTxt:    { fontSize: 13, fontFamily: "Pretendard-Regular" },
  sep:        { fontSize: 13 },
  reasonBox:  { flexDirection: "row", alignItems: "center", gap: 6,
                borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  reasonTxt:  { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular" },
  btnRow:     { flexDirection: "row", gap: 8, marginTop: 4 },
  rejectBtn:  { flex: 1, height: 40, borderRadius: 9, borderWidth: 1,
                alignItems: "center", justifyContent: "center" },
  rejectTxt:  { fontSize: 14, fontFamily: "Pretendard-Regular" },
  approveBtn: { flex: 2, height: 40, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  approveTxt: { color: "#fff", fontSize: 14, fontFamily: "Pretendard-Regular" },
});
