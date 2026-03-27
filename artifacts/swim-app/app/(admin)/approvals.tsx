import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Modal, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { ClassTransferModal }  from "@/components/admin/ClassTransferModal";
import { TeacherDetailModal }  from "@/components/admin/TeacherDetailModal";
import { ParentDetailModal }   from "@/components/admin/ParentDetailModal";
import { ScreenLayout }  from "@/components/common/ScreenLayout";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { MainTabs }      from "@/components/common/MainTabs";
import { FilterChips, FilterChipItem } from "@/components/common/FilterChips";
import { EmptyState }    from "@/components/common/EmptyState";
import { ApprovalCard, ApprovalCardMeta } from "@/components/approval/ApprovalCard";
import { RejectModal }   from "@/components/common/RejectModal";
import { STATUS_COLORS } from "@/components/common/constants";
import {
  type ParentJoinRequest, type JoinStatus, type MatchStatus, type ChildInfo,
} from "@/store/parentJoinStore";
import { useInviteRecordStore } from "@/store/inviteRecordStore";


const C = Colors.light;

// ── 타입 ───────────────────────────────────────────────────────

// 매칭 상태 설정
const MATCH_CFG: Record<MatchStatus, { label: string; color: string; bg: string; icon: string }> = {
  full_match:  { label: "자동 일치", color: "#1F8F86", bg: "#DDF2EF", icon: "zap"         },
  phone_only:  { label: "번호만 일치", color: "#D97706", bg: "#FFF1BF", icon: "phone"     },
  no_match:    { label: "미일치",    color: "#6F6B68", bg: "#F6F3F1", icon: "alert-circle" },
};

const JOIN_STATUS_CFG: Record<JoinStatus, { label: string }> = {
  auto_approved: { label: "자동 승인" },
  approved:      { label: "승인됨"   },
  pending:       { label: "대기 중"  },
  on_hold:       { label: "보류"     },
  rejected:      { label: "거절됨"   },
};

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


type MainTab   = "parents" | "teachers";
type StatusFilter = "pending" | "approved" | "rejected";

function parseRoles(roles: any): string[] {
  if (Array.isArray(roles)) return roles;
  if (typeof roles === "string" && roles.startsWith("{")) {
    return roles.slice(1, -1).split(",").map(r => r.replace(/^"|"$/g, "").trim()).filter(Boolean);
  }
  return [];
}

const FILTER_CHIPS: FilterChipItem<StatusFilter>[] = [
  { key: "pending",  label: "대기",   icon: "clock",        activeColor: STATUS_COLORS.pending.color,  activeBg: STATUS_COLORS.pending.bg  },
  { key: "approved", label: "승인",   icon: "check-circle", activeColor: STATUS_COLORS.approved.color, activeBg: STATUS_COLORS.approved.bg },
  { key: "rejected", label: "거절됨", icon: "x-circle",     activeColor: STATUS_COLORS.rejected.color, activeBg: STATUS_COLORS.rejected.bg },
];

// ── 메인 컴포넌트 ───────────────────────────────────────────────
export default function ApprovalsScreen() {
  const { token, adminUser, pool } = useAuth();
  const insets = useSafeAreaInsets();
  const actorName = adminUser?.name ?? "관리자";

  // 학부모 가입 요청 (실제 API)
  const [apiParentRequests, setApiParentRequests] = useState<ParentJoinRequest[]>([]);

  // inviteRecordStore — 초대 이력 연동
  const inviteRecords    = useInviteRecordStore(s => s.records);

  const [mainTab,  setMainTab]  = useState<MainTab>("parents");
  const [filter,   setFilter]   = useState<StatusFilter>("pending");
  const [invites,  setInvites]  = useState<TeacherInvite[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // 거절 모달 (선생님용)
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);

  // 학부모 상세 팝업 — parentJoinStore 기반
  const [storeParentDetail, setStoreParentDetail] = useState<ParentJoinRequest | null>(null);
  // 학부모 거절 사유 모달
  const [storeRejectTargetId, setStoreRejectTargetId] = useState<string | null>(null);
  // 선생님 상세 팝업
  const [teacherDetailInvite, setTeacherDetailInvite] = useState<TeacherInvite | null>(null);
  const [teacherDetail, setTeacherDetail] = useState<TeacherDetail | null>(null);
  const [teacherDetailLoading, setTeacherDetailLoading] = useState(false);
  // 수업 인수 팝업
  const [transferSource, setTransferSource] = useState<TeacherInvite | null>(null);
  const [actionProcessing, setActionProcessing] = useState(false);

  function mapApiToRequest(r: any): ParentJoinRequest {
    const childrenRaw = typeof r.children_requested === "string"
      ? JSON.parse(r.children_requested || "[]")
      : (r.children_requested || []);
    const children: ChildInfo[] = childrenRaw.length > 0
      ? childrenRaw.map((c: any) => ({ name: c.childName || "", birthDate: c.childBirthYear ? String(c.childBirthYear) : "" }))
      : r.child_name ? [{ name: r.child_name, birthDate: r.child_birth_year ? String(r.child_birth_year) : "" }] : [];
    const statusMap: Record<string, JoinStatus> = {
      pending: "pending", approved: "approved", auto_approved: "auto_approved",
      rejected: "rejected", revoked: "rejected", on_hold: "on_hold",
    };
    const matchStatus: MatchStatus = r.request_status === "auto_approved" ? "full_match" : "no_match";
    return {
      id: r.id,
      operatorId: r.swimming_pool_id || "",
      operatorName: "",
      parentId: r.parent_account_id || r.id,
      parentName: r.parent_name,
      parentPhone: r.phone,
      relation: "부",
      displayName: r.parent_name,
      children,
      status: statusMap[r.request_status] || "pending",
      matchStatus,
      matchedStudentIds: [],
      createdAt: r.requested_at,
      reviewedAt: r.processed_at || undefined,
      reviewedBy: undefined,
      rejectReason: r.rejection_reason || null,
    };
  }

  // ── 데이터 로드 ────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const [iRes, pRes] = await Promise.all([
        apiRequest(token, "/admin/teacher-invites"),
        apiRequest(token, "/admin/parent-requests"),
      ]);
      if (iRes.ok) { const d = await iRes.json(); setInvites(d.data ?? []); }
      if (pRes.ok) { const d = await pRes.json(); setApiParentRequests((d.data ?? []).map(mapApiToRequest)); }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // ── 학부모 승인 (API) ─────────────────────────────────────────
  async function handleStoreApprove(reqId: string) {
    setProcessingId(reqId);
    try {
      const res = await apiRequest(token, `/admin/parent-requests/${reqId}`, {
        method: "PATCH", body: JSON.stringify({ action: "approve" }),
      });
      const d = await res.json();
      if (!res.ok) { Alert.alert("오류", d.message || "처리 중 오류가 발생했습니다."); return; }
      setStoreParentDetail(null);
      Alert.alert("승인 완료", "학부모 가입 요청이 승인되었습니다.");
      await load();
    } catch (e) { console.error(e); }
    finally { setProcessingId(null); }
  }

  // ── 학부모 거절 (API) ─────────────────────────────────────────
  async function handleStoreReject(reqId: string, reason: string) {
    setProcessingId(reqId);
    try {
      const res = await apiRequest(token, `/admin/parent-requests/${reqId}`, {
        method: "PATCH", body: JSON.stringify({ action: "reject", rejection_reason: reason || null }),
      });
      const d = await res.json();
      if (!res.ok) { Alert.alert("오류", d.message || "처리 중 오류가 발생했습니다."); return; }
      setStoreRejectTargetId(null);
      setStoreParentDetail(null);
      await load();
    } catch (e) { console.error(e); }
    finally { setProcessingId(null); }
  }

  // ── 학부모 승인 해제 (API) ────────────────────────────────────
  async function handleStoreReApprove(reqId: string) {
    setProcessingId(reqId);
    try {
      const res = await apiRequest(token, `/admin/parent-requests/${reqId}`, {
        method: "PATCH", body: JSON.stringify({ action: "revoke" }),
      });
      const d = await res.json();
      if (!res.ok) { Alert.alert("오류", d.message || "처리 중 오류가 발생했습니다."); return; }
      setStoreParentDetail(null);
      await load();
    } catch (e) { console.error(e); }
    finally { setProcessingId(null); }
  }

  // ── 학부모 보류 (미지원, 무시) ───────────────────────────────
  function handleStoreHold(_reqId: string) {
    setStoreParentDetail(null);
  }

  // ── 선생님 승인/거절 ──────────────────────────────────────────
  async function handleInviteAction(inviteId: string, action: string, reason?: string) {
    setProcessingId(inviteId);
    try {
      const body: any = { action, rejection_reason: reason };
      const res = await apiRequest(token, `/admin/teacher-invites/${inviteId}`, {
        method: "PATCH", body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) Alert.alert("오류", d.message || "처리 중 오류 발생");
      else {
        setRejectTargetId(null);
        setTeacherDetailInvite(null);
        setTeacherDetail(null);
        await load();
      }
    } finally { setProcessingId(null); }
  }

  // ── 선생님 상세 보기 ──────────────────────────────────────────
  async function handleViewTeacher(inv: TeacherInvite) {
    setTeacherDetailInvite(inv);
    setTeacherDetailLoading(true);
    try {
      const res = await apiRequest(token, `/admin/teacher-invites/${inv.id}/detail`);
      if (res.ok) {
        const d = await res.json();
        setTeacherDetail(d.data);
      }
    } catch (e) { console.error(e); }
    finally { setTeacherDetailLoading(false); }
  }

  // ── 선생님 승인 해제 ──────────────────────────────────────────
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
      await load();
    } finally { setActionProcessing(false); }
  }

  // ── 수업 인수 ─────────────────────────────────────────────────
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
      await load();
    } finally { setActionProcessing(false); }
  }

  // ── 거절 모달 핸들러 (선생님용) ──────────────────────────────
  function handleRejectConfirm(reason: string) {
    if (!rejectTargetId) return;
    handleInviteAction(rejectTargetId, "reject", reason);
  }

  // ── 필터링 ────────────────────────────────────────────────────
  const filteredParents = apiParentRequests.filter(r => {
    if (filter === "pending")  return r.status === "pending" || r.status === "on_hold";
    if (filter === "approved") return r.status === "approved" || r.status === "auto_approved";
    if (filter === "rejected") return r.status === "rejected";
    return false;
  });
  const filteredTeachers = invites.filter(i => {
    if (filter === "pending")  return i.invite_status === "joinedPendingApproval";
    if (filter === "approved") return i.invite_status === "approved";
    if (filter === "rejected") return i.invite_status === "rejected" || i.invite_status === "inactive";
    return false;
  });

  const pendingParentsCnt  = apiParentRequests.filter(r => r.status === "pending" || r.status === "on_hold").length;
  const pendingTeachersCnt = invites.filter(i => i.invite_status === "joinedPendingApproval").length;

  function chipsWithCount(): FilterChipItem<StatusFilter>[] {
    return FILTER_CHIPS.map(chip => {
      let cnt = 0;
      if (mainTab === "parents") {
        if (chip.key === "pending")  cnt = apiParentRequests.filter(r => r.status === "pending" || r.status === "on_hold").length;
        if (chip.key === "approved") cnt = apiParentRequests.filter(r => r.status === "approved" || r.status === "auto_approved").length;
        if (chip.key === "rejected") cnt = apiParentRequests.filter(r => r.status === "rejected").length;
      } else {
        if (chip.key === "pending")  cnt = invites.filter(i => i.invite_status === "joinedPendingApproval").length;
        if (chip.key === "approved") cnt = invites.filter(i => i.invite_status === "approved").length;
        if (chip.key === "rejected") cnt = invites.filter(i => i.invite_status === "rejected" || i.invite_status === "inactive").length;
      }
      return { ...chip, count: cnt };
    });
  }

  // ── 학부모 카드 빌더 (parentJoinStore) ───────────────────────
  function buildStoreMeta(req: ParentJoinRequest): ApprovalCardMeta {
    const isPending = req.status === "pending" || req.status === "on_hold";
    const statusMap: Record<JoinStatus, ApprovalCardMeta["statusKey"]> = {
      pending:      "pending",
      auto_approved:"approved",
      approved:     "approved",
      on_hold:      "pending",
      rejected:     "rejected",
    };
    return {
      id:              req.id,
      name:            req.parentName,
      sub1:            `${req.parentPhone}${req.children.length > 0 ? " · 자녀: " + req.children.map(c => c.name).join(", ") : ""}`,
      requestedAt:     req.createdAt,
      statusKey:       statusMap[req.status],
      avatarInitial:   req.parentName[0],
      rejectionReason: req.rejectReason,
      showActions:     isPending,
      processing:      processingId === req.id,
    };
  }

  function buildStoreExtra(req: ParentJoinRequest) {
    const mc = MATCH_CFG[req.matchStatus];
    const normalizePhone = (p: string) => p.replace(/\D/g, "");
    const relatedInvites = inviteRecords.filter(
      r => r.targetType === "guardian" && normalizePhone(r.targetPhone) === normalizePhone(req.parentPhone),
    );
    const lastInvite = relatedInvites[0];
    return (
      <View style={x.childBox}>
        <View style={x.matchRow}>
          <Feather name={mc.icon as any} size={11} color={mc.color} />
          <Text style={[x.matchTxt, { color: mc.color }]}>{mc.label}</Text>
          {req.status === "auto_approved" && (
            <View style={x.autoChip}>
              <Text style={x.autoChipTxt}>자동승인</Text>
            </View>
          )}
          {req.status === "on_hold" && (
            <View style={[x.autoChip, { backgroundColor: "#FFF1BF" }]}>
              <Text style={[x.autoChipTxt, { color: "#D97706" }]}>보류</Text>
            </View>
          )}
        </View>
        <Text style={x.childTitle}>자녀 정보 ({req.children.length}명)</Text>
        {req.children.map((c, i) => (
          <View key={i} style={x.childRow}>
            <Text style={x.childName}>{c.name}</Text>
            <Text style={x.childYear}>{c.birthDate}</Text>
          </View>
        ))}
        {lastInvite && (
          <View style={x.inviteHint}>
            <Feather name="send" size={11} color="#1F8F86" />
            <Text style={x.inviteHintTxt}>
              초대 이력 있음 · {lastInvite.senderName} ·{" "}
              {new Date(lastInvite.createdAt).toLocaleDateString("ko-KR")}
              {relatedInvites.length > 1 ? ` 외 ${relatedInvites.length - 1}건` : ""}
            </Text>
          </View>
        )}
      </View>
    );
  }

  // ── 선생님 카드 빌더 ─────────────────────────────────────────
  function buildTeacherMeta(inv: TeacherInvite): ApprovalCardMeta {
    const isPending = inv.invite_status === "joinedPendingApproval";
    const statusMap: Record<string, ApprovalCardMeta["statusKey"]> = {
      joinedPendingApproval: "waitingApproval",
      approved:              "approved",
      rejected:              "rejected",
      invited:               "invited",
      inactive:              "inactive",
    };
    const roles: string[] = parseRoles(inv.user_roles);
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

  // ── 수업 인수 가능한 선생님 목록 ─────────────────────────────
  function getAvailableTeachersForTransfer(sourceInvite: TeacherInvite) {
    return invites
      .filter(i =>
        i.invite_status === "approved" &&
        i.user_id !== null &&
        i.user_id !== sourceInvite.user_id &&
        i.id !== sourceInvite.id
      )
      .map(i => ({ inviteId: i.id, userId: i.user_id!, name: i.name, phone: i.phone }));
  }

  // ── 공통 헤더 ─────────────────────────────────────────────────
  const header = (
    <>
      <SubScreenHeader title="승인 관리" />
      <MainTabs<MainTab>
        tabs={[
          { key: "parents",  label: "학부모 승인", badge: pendingParentsCnt  },
          { key: "teachers", label: "선생님 승인", badge: pendingTeachersCnt },
        ]}
        active={mainTab}
        onChange={key => { setMainTab(key); setFilter("pending"); }}
      />
      <FilterChips<StatusFilter>
        chips={chipsWithCount()}
        active={filter}
        onChange={setFilter}
      />
    </>
  );

  if (loading) {
    return (
      <ScreenLayout header={header}>
        <ActivityIndicator color={C.tint} style={{ marginTop: 80 }} />
      </ScreenLayout>
    );
  }

  const isParentTab = mainTab === "parents";
  const data        = isParentTab ? filteredParents : filteredTeachers;

  return (
    <>
      <ScreenLayout header={header}>
        <FlatList
          data={data}
          keyExtractor={item => item.id}
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={
            <EmptyState
              icon={isParentTab ? "users" : "send"}
              title={filter === "pending" ? "대기 중인 요청이 없습니다" : filter === "approved" ? "승인된 내역이 없습니다" : "거절된 내역이 없습니다"}
              subtitle="상단 필터에서 다른 상태를 선택해보세요"
            />
          }
          renderItem={({ item }) => {
            if (isParentTab) {
              const req = item as ParentJoinRequest;
              const isPending = req.status === "pending" || req.status === "on_hold";
              return (
                <ApprovalCard
                  meta={buildStoreMeta(req)}
                  extra={buildStoreExtra(req)}
                  onApprove={isPending ? () => handleStoreApprove(req.id) : undefined}
                  onView={() => setStoreParentDetail(req)}
                />
              );
            } else {
              const inv = item as TeacherInvite;
              return (
                <ApprovalCard
                  meta={buildTeacherMeta(inv)}
                  onApprove={() => handleInviteAction(inv.id, "approve")}
                  onView={() => handleViewTeacher(inv)}
                />
              );
            }
          }}
        />
      </ScreenLayout>

      {/* 학부모 거절 사유 모달 (스토어) */}
      <RejectModal
        visible={!!storeRejectTargetId}
        onClose={() => setStoreRejectTargetId(null)}
        onConfirm={(reason) => storeRejectTargetId && handleStoreReject(storeRejectTargetId, reason)}
        loading={false}
      />

      {/* 선생님 거절 사유 모달 */}
      <RejectModal
        visible={!!rejectTargetId}
        onClose={() => setRejectTargetId(null)}
        onConfirm={handleRejectConfirm}
        loading={!!processingId}
      />

      {/* 학부모 상세 팝업 (스토어 기반) */}
      {storeParentDetail && (
        <ParentDetailModal
          req={storeParentDetail}
          onClose={() => setStoreParentDetail(null)}
          onApprove={() => handleStoreApprove(storeParentDetail.id)}
          onHold={() => handleStoreHold(storeParentDetail.id)}
          onOpenReject={() => { setStoreParentDetail(null); setStoreRejectTargetId(storeParentDetail.id); }}
          onRevoke={() => handleStoreReApprove(storeParentDetail.id)}
          onReApprove={() => handleStoreReApprove(storeParentDetail.id)}
        />
      )}

      {/* 선생님 상세 팝업 */}
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

      {/* 수업 인수 팝업 */}
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

// 자녀 정보 extra 스타일
const x = StyleSheet.create({
  childBox:    { gap: 6 },
  matchRow:    { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 4 },
  matchTxt:    { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  autoChip:    { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, backgroundColor: "#DDF2EF" },
  autoChipTxt: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#1F8F86" },
  childTitle:  { fontSize: 11, fontFamily: "Inter_600SemiBold", color: C.textSecondary, marginBottom: 2 },
  childRow:    { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  childName:    { fontSize: 13, fontFamily: "Inter_500Medium", color: C.text },
  childYear:    { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted },
  inviteHint:   { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2,
                  backgroundColor: "#ECFEFF", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  inviteHintTxt:{ fontSize: 11, fontFamily: "Inter_500Medium", color: "#1F8F86", flex: 1 },
});

const s = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
});
