import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Linking, Modal, Platform, Pressable,
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
  full_match:  { label: "자동 일치", color: "#2EC4B6", bg: "#E6FFFA", icon: "zap"         },
  phone_only:  { label: "번호만 일치", color: "#D97706", bg: "#FFF1BF", icon: "phone"     },
  no_match:    { label: "미일치",    color: "#6B7280", bg: "#F8FAFC", icon: "alert-circle" },
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
type StatusFilter = "unlinked" | "approved" | "rejected";

interface UnlinkedStudent {
  id: string; name: string; phone: string | null;
  birth_year: number | null; status: string;
  class_name: string | null;
}

function parseRoles(roles: any): string[] {
  if (Array.isArray(roles)) return roles;
  if (typeof roles === "string" && roles.startsWith("{")) {
    return roles.slice(1, -1).split(",").map(r => r.replace(/^"|"$/g, "").trim()).filter(Boolean);
  }
  return [];
}

const _IC = "#0F172A"; const _IB = "#E6FAF8";
const PARENT_FILTER_CHIPS: FilterChipItem<StatusFilter>[] = [
  { key: "unlinked", label: "미연결", icon: "link",         activeColor: _IC, activeBg: _IB },
  { key: "approved", label: "연결됨", icon: "check-circle", activeColor: _IC, activeBg: _IB },
];
const TEACHER_FILTER_CHIPS: FilterChipItem<StatusFilter>[] = [
  { key: "unlinked", label: "대기",   icon: "clock",        activeColor: _IC, activeBg: _IB },
  { key: "approved", label: "승인",   icon: "check-circle", activeColor: _IC, activeBg: _IB },
  { key: "rejected", label: "거절됨", icon: "x-circle",     activeColor: _IC, activeBg: _IB },
];

// ── 메인 컴포넌트 ───────────────────────────────────────────────
export default function ApprovalsScreen() {
  const { token, adminUser, pool } = useAuth();
  const insets = useSafeAreaInsets();
  const actorName = adminUser?.name ?? "관리자";

  // 학부모 가입 요청 (실제 API)
  const [apiParentRequests, setApiParentRequests] = useState<ParentJoinRequest[]>([]);
  // 미연결 학생 (parent_user_id IS NULL)
  const [unlinkedStudents, setUnlinkedStudents] = useState<UnlinkedStudent[]>([]);

  // inviteRecordStore — 초대 이력 연동
  const inviteRecords    = useInviteRecordStore(s => s.records);

  const [mainTab,  setMainTab]  = useState<MainTab>("parents");
  const [filter,   setFilter]   = useState<StatusFilter>("unlinked");
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
      const [iRes, pRes, uRes] = await Promise.all([
        apiRequest(token, "/admin/teacher-invites"),
        apiRequest(token, "/admin/parent-requests"),
        apiRequest(token, "/admin/unlinked-students"),
      ]);
      if (iRes.ok) { const d = await iRes.json(); setInvites(d.data ?? []); }
      if (pRes.ok) { const d = await pRes.json(); setApiParentRequests((d.data ?? []).map(mapApiToRequest)); }
      if (uRes.ok) { const d = await uRes.json(); setUnlinkedStudents(d.data ?? []); }
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
    if (filter === "approved") return r.status === "approved" || r.status === "auto_approved";
    if (filter === "rejected") return r.status === "rejected";
    return false;
  });
  const filteredTeachers = invites.filter(i => {
    if (filter === "unlinked") return i.invite_status === "joinedPendingApproval";
    if (filter === "approved") return i.invite_status === "approved";
    if (filter === "rejected") return i.invite_status === "rejected" || i.invite_status === "inactive";
    return false;
  });

  const unlinkedParentsCnt = unlinkedStudents.length;
  const pendingTeachersCnt = invites.filter(i => i.invite_status === "joinedPendingApproval").length;

  function chipsWithCount(): FilterChipItem<StatusFilter>[] {
    const chips = mainTab === "parents" ? PARENT_FILTER_CHIPS : TEACHER_FILTER_CHIPS;
    return chips.map(chip => {
      let cnt = 0;
      if (mainTab === "parents") {
        if (chip.key === "unlinked") cnt = unlinkedStudents.length;
        if (chip.key === "approved") cnt = apiParentRequests.filter(r => r.status === "approved" || r.status === "auto_approved").length;
      } else {
        if (chip.key === "unlinked") cnt = invites.filter(i => i.invite_status === "joinedPendingApproval").length;
        if (chip.key === "approved") cnt = invites.filter(i => i.invite_status === "approved").length;
        if (chip.key === "rejected") cnt = invites.filter(i => i.invite_status === "rejected" || i.invite_status === "inactive").length;
      }
      return { ...chip, count: cnt };
    });
  }

  // ── SMS 초대 ─────────────────────────────────────────────────
  function handleSmsInvite(student: UnlinkedStudent) {
    const phone = student.phone?.replace(/\D/g, "") || "";
    if (!phone) { Alert.alert("알림", "해당 학생의 연락처가 없습니다."); return; }
    const msg = encodeURIComponent(`[SwimNote] 안녕하세요! ${student.name} 학부모님, SwimNote 앱에 가입하여 자녀의 수업 정보를 확인하세요.`);
    Linking.openURL(`sms:${phone}${Platform.OS === "ios" ? "&" : "?"}body=${msg}`).catch(() => {
      Alert.alert("알림", `연락처: ${student.phone}`);
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
            <Feather name="send" size={11} color="#2EC4B6" />
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
          { key: "parents",  label: "학부모", badge: unlinkedParentsCnt  },
          { key: "teachers", label: "선생님 승인", badge: pendingTeachersCnt },
        ]}
        active={mainTab}
        onChange={key => { setMainTab(key); setFilter(key === "parents" ? "unlinked" : "unlinked"); }}
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

  const isParentTab   = mainTab === "parents";
  const isUnlinkedTab = isParentTab && filter === "unlinked";
  const listData: any[] = isParentTab
    ? (isUnlinkedTab ? unlinkedStudents : filteredParents)
    : filteredTeachers;

  return (
    <>
      <ScreenLayout header={header}>
        <FlatList
          data={listData}
          keyExtractor={item => item.id}
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={
            <EmptyState
              icon={isParentTab ? "users" : "send"}
              title={
                isUnlinkedTab ? "미연결 학생이 없습니다"
                  : filter === "approved" ? "연결된 학부모가 없습니다"
                  : "내역이 없습니다"
              }
              subtitle={isUnlinkedTab ? "모든 학생이 학부모와 연결되었습니다" : "상단 필터에서 다른 상태를 선택해보세요"}
            />
          }
          renderItem={({ item }) => {
            // ── 미연결 학생 카드 ───────────────────────────────
            if (isUnlinkedTab) {
              const st = item as UnlinkedStudent;
              return (
                <View style={[s.unlinkCard, { backgroundColor: C.card, borderColor: C.border }]}>
                  <View style={[s.unlinkAvatar, { backgroundColor: C.tintLight }]}>
                    <Text style={[s.unlinkAvatarTxt, { color: C.tint }]}>{st.name[0]}</Text>
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={[s.unlinkName, { color: C.text }]}>{st.name}</Text>
                    <Text style={[s.unlinkSub, { color: C.textMuted }]}>
                      {[st.class_name, st.birth_year ? `${st.birth_year}년생` : null, st.phone].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                  {st.phone ? (
                    <Pressable
                      style={({ pressed }) => [s.smsBtn, { opacity: pressed ? 0.7 : 1 }]}
                      onPress={() => handleSmsInvite(st)}
                    >
                      <Feather name="message-square" size={14} color="#fff" />
                      <Text style={s.smsBtnTxt}>초대</Text>
                    </Pressable>
                  ) : (
                    <View style={[s.smsBtn, { backgroundColor: C.border }]}>
                      <Text style={[s.smsBtnTxt, { color: C.textMuted }]}>연락처 없음</Text>
                    </View>
                  )}
                </View>
              );
            }
            // ── 연결된 학부모 카드 ────────────────────────────
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
            }
            // ── 선생님 카드 ───────────────────────────────────
            const inv = item as TeacherInvite;
            return (
              <ApprovalCard
                meta={buildTeacherMeta(inv)}
                onApprove={() => handleInviteAction(inv.id, "approve")}
                onView={() => handleViewTeacher(inv)}
              />
            );
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
  matchTxt:    { fontSize: 11, fontFamily: "Pretendard-SemiBold" },
  autoChip:    { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, backgroundColor: "#E6FFFA" },
  autoChipTxt: { fontSize: 10, fontFamily: "Pretendard-Bold", color: "#2EC4B6" },
  childTitle:  { fontSize: 11, fontFamily: "Pretendard-SemiBold", color: C.textSecondary, marginBottom: 2 },
  childRow:    { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  childName:    { fontSize: 13, fontFamily: "Pretendard-Medium", color: C.text },
  childYear:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted },
  inviteHint:   { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2,
                  backgroundColor: "#ECFEFF", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  inviteHintTxt:{ fontSize: 11, fontFamily: "Pretendard-Medium", color: "#2EC4B6", flex: 1 },
});

const s = StyleSheet.create({
  list:          { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  unlinkCard:    { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  unlinkAvatar:  { width: 42, height: 42, borderRadius: 21, justifyContent: "center", alignItems: "center" },
  unlinkAvatarTxt:{ fontSize: 17, fontFamily: "Pretendard-Bold" },
  unlinkName:    { fontSize: 15, fontFamily: "Pretendard-SemiBold" },
  unlinkSub:     { fontSize: 12, fontFamily: "Pretendard-Regular" },
  smsBtn:        { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#2EC4B6", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  smsBtnTxt:     { color: "#fff", fontSize: 13, fontFamily: "Pretendard-SemiBold" },
});
