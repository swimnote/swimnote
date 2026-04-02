import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, RefreshControl,
  StyleSheet, View,
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

type StatusFilter = "pending" | "approved" | "rejected";

function parseRoles(roles: any): string[] {
  if (Array.isArray(roles)) return roles;
  if (typeof roles === "string" && roles.startsWith("{")) {
    return roles.slice(1, -1).split(",").map(r => r.replace(/^"|"$/g, "").trim()).filter(Boolean);
  }
  return [];
}

const _IC = "#0F172A"; const _IB = "#E6FAF8";
const FILTER_CHIPS: FilterChipItem<StatusFilter>[] = [
  { key: "pending",  label: "대기",   icon: "clock",        activeColor: _IC, activeBg: _IB },
  { key: "approved", label: "승인",   icon: "check-circle", activeColor: _IC, activeBg: _IB },
  { key: "rejected", label: "거절됨", icon: "x-circle",     activeColor: _IC, activeBg: _IB },
];

export default function ApprovalsScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();

  const [filter, setFilter]   = useState<StatusFilter>("pending");
  const [invites, setInvites]  = useState<TeacherInvite[]>([]);
  const [loading, setLoading]  = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [teacherDetailInvite, setTeacherDetailInvite] = useState<TeacherInvite | null>(null);
  const [teacherDetail, setTeacherDetail] = useState<TeacherDetail | null>(null);
  const [teacherDetailLoading, setTeacherDetailLoading] = useState(false);
  const [transferSource, setTransferSource] = useState<TeacherInvite | null>(null);
  const [actionProcessing, setActionProcessing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiRequest(token, "/admin/teacher-invites");
      if (res.ok) { const d = await res.json(); setInvites(d.data ?? []); }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function handleInviteAction(inviteId: string, action: string, reason?: string) {
    setProcessingId(inviteId);
    try {
      const res = await apiRequest(token, `/admin/teacher-invites/${inviteId}`, {
        method: "PATCH", body: JSON.stringify({ action, rejection_reason: reason }),
      });
      const d = await res.json();
      if (!res.ok) { const { Alert } = require("react-native"); Alert.alert("오류", d.message || "처리 중 오류 발생"); }
      else {
        setRejectTargetId(null);
        setTeacherDetailInvite(null);
        setTeacherDetail(null);
        await load();
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
      if (!res.ok) { const { Alert } = require("react-native"); Alert.alert("오류", d.message || "처리 중 오류"); return; }
      setTeacherDetailInvite(null);
      setTeacherDetail(null);
      await load();
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
      if (!res.ok) { const { Alert } = require("react-native"); Alert.alert("오류", d.message || "처리 중 오류"); return; }
      const { Alert } = require("react-native");
      Alert.alert("완료", d.message || "수업 인수가 완료되었습니다.");
      setTransferSource(null);
      setTeacherDetailInvite(null);
      setTeacherDetail(null);
      await load();
    } finally { setActionProcessing(false); }
  }

  const filteredTeachers = invites.filter(i => {
    if (filter === "pending")  return i.invite_status === "joinedPendingApproval";
    if (filter === "approved") return i.invite_status === "approved";
    if (filter === "rejected") return i.invite_status === "rejected" || i.invite_status === "inactive";
    return false;
  });

  const pendingCnt = invites.filter(i => i.invite_status === "joinedPendingApproval").length;

  const chips: FilterChipItem<StatusFilter>[] = FILTER_CHIPS.map(chip => ({
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

  const header = (
    <>
      <SubScreenHeader title="선생님 승인" />
      <FilterChips<StatusFilter> chips={chips} active={filter} onChange={setFilter} />
    </>
  );

  if (loading) {
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
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
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

const s = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
});
