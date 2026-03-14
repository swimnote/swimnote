import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList,
  RefreshControl, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { ScreenLayout }  from "@/components/common/ScreenLayout";
import { PageHeader }    from "@/components/common/PageHeader";
import { MainTabs }      from "@/components/common/MainTabs";
import { FilterChips, FilterChipItem } from "@/components/common/FilterChips";
import { EmptyState }    from "@/components/common/EmptyState";
import { ApprovalCard, ApprovalCardMeta } from "@/components/approval/ApprovalCard";
import { RejectModal }   from "@/components/common/RejectModal";
import { STATUS_COLORS } from "@/components/common/constants";

const C = Colors.light;

// ── 타입 ───────────────────────────────────────────────────────
interface JoinRequest {
  id: string; swimming_pool_id: string; parent_name: string; phone: string;
  request_status: "pending" | "approved" | "rejected";
  requested_at: string; processed_at?: string | null;
  rejection_reason?: string | null; parent_account_id?: string | null;
  child_name?: string | null; child_birth_year?: number | null;
  children_requested?: Array<{ childName: string; childBirthYear: number | null }> | null;
}

interface TeacherInvite {
  id: string; name: string; phone: string; position: string | null;
  invite_token: string | null; invite_status: string;
  created_at: string; requested_at: string | null;
  approved_at: string | null; user_email: string | null;
}

type MainTab   = "parents" | "teachers";
type StatusFilter = "pending" | "approved" | "rejected";

// ── 필터칩 정의 (고정) ──────────────────────────────────────────
const FILTER_CHIPS: FilterChipItem<StatusFilter>[] = [
  { key: "pending",  label: "대기",   icon: "clock",        activeColor: STATUS_COLORS.pending.color,  activeBg: STATUS_COLORS.pending.bg  },
  { key: "approved", label: "승인",   icon: "check-circle", activeColor: STATUS_COLORS.approved.color, activeBg: STATUS_COLORS.approved.bg },
  { key: "rejected", label: "거절됨", icon: "x-circle",     activeColor: STATUS_COLORS.rejected.color, activeBg: STATUS_COLORS.rejected.bg },
];

// ── 메인 컴포넌트 ───────────────────────────────────────────────
export default function ApprovalsScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();

  const [mainTab,  setMainTab]  = useState<MainTab>("parents");
  const [filter,   setFilter]   = useState<StatusFilter>("pending");
  const [joinReqs, setJoinReqs] = useState<JoinRequest[]>([]);
  const [invites,  setInvites]  = useState<TeacherInvite[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);

  // ── 데이터 로드 ───────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const [jrRes, iRes] = await Promise.all([
        apiRequest(token, "/admin/parent-requests"),
        apiRequest(token, "/admin/teacher-invites"),
      ]);
      if (jrRes.ok) { const d = await jrRes.json(); setJoinReqs(d.data ?? []); }
      if (iRes.ok)  { const d = await iRes.json();  setInvites(d.data  ?? []); }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // ── 학부모 승인/거절 ──────────────────────────────────────────
  async function handleJoinDecision(reqId: string, action: "approve" | "reject", reason?: string) {
    setProcessingId(reqId);
    try {
      const res = await apiRequest(token, `/admin/parent-requests/${reqId}`, {
        method: "PATCH",
        body: JSON.stringify({ action, rejection_reason: reason }),
      });
      const d = await res.json();
      if (!res.ok) { Alert.alert("오류", d.message || "처리 중 오류가 발생했습니다."); return; }
      if (action === "approve" && d.default_pin) {
        Alert.alert("승인 완료", `학부모 계정이 생성되었습니다.\n초기 PIN: ${d.default_pin}\n(학부모에게 전달해 주세요)`);
      }
      setRejectTargetId(null);
      await load();
    } finally { setProcessingId(null); }
  }

  // ── 선생님 승인/거절 ──────────────────────────────────────────
  async function handleInviteAction(inviteId: string, action: "approve" | "reject", reason?: string) {
    setProcessingId(inviteId);
    try {
      const res = await apiRequest(token, `/admin/teacher-invites/${inviteId}`, {
        method: "PATCH",
        body: JSON.stringify({ action, rejection_reason: reason }),
      });
      const d = await res.json();
      if (!res.ok) Alert.alert("오류", d.message || "처리 중 오류 발생");
      else await load();
      setRejectTargetId(null);
    } finally { setProcessingId(null); }
  }

  // ── 필터링 ───────────────────────────────────────────────────
  const filteredParents = joinReqs.filter(r => r.request_status === filter);
  const filteredTeachers = invites.filter(i => {
    if (filter === "pending")  return i.invite_status === "joinedPendingApproval";
    if (filter === "approved") return i.invite_status === "approved";
    if (filter === "rejected") return i.invite_status === "rejected";
    return false;
  });

  const pendingParentsCnt  = joinReqs.filter(r => r.request_status === "pending").length;
  const pendingTeachersCnt = invites.filter(i => i.invite_status === "joinedPendingApproval").length;

  // ── 필터칩에 카운트 주입 ────────────────────────────────────────
  function chipsWithCount(): FilterChipItem<StatusFilter>[] {
    return FILTER_CHIPS.map(chip => {
      let cnt = 0;
      if (mainTab === "parents") {
        cnt = joinReqs.filter(r => r.request_status === chip.key).length;
      } else {
        cnt = invites.filter(i => {
          if (chip.key === "pending")  return i.invite_status === "joinedPendingApproval";
          if (chip.key === "approved") return i.invite_status === "approved";
          if (chip.key === "rejected") return i.invite_status === "rejected";
          return false;
        }).length;
      }
      return { ...chip, count: cnt };
    });
  }

  // ── 학부모 카드 빌더 ──────────────────────────────────────────
  function buildParentMeta(req: JoinRequest): ApprovalCardMeta {
    const isPending = req.request_status === "pending";
    return {
      id:              req.id,
      name:            req.parent_name,
      sub1:            req.phone,
      requestedAt:     req.requested_at,
      statusKey:       req.request_status,
      avatarInitial:   req.parent_name[0],
      rejectionReason: req.rejection_reason ?? undefined,
      showActions:     isPending,
      processing:      processingId === req.id,
    };
  }

  function buildParentExtra(req: JoinRequest) {
    const list = req.children_requested && req.children_requested.length > 0
      ? req.children_requested
      : (req.child_name ? [{ childName: req.child_name, childBirthYear: req.child_birth_year }] : []);
    if (!list.length) return null;
    return (
      <View style={x.childBox}>
        <Text style={x.childTitle}>자녀 정보</Text>
        {list.map((c, i) => (
          <View key={i} style={x.childRow}>
            <Text style={x.childName}>{c.childName}</Text>
            {c.childBirthYear ? <Text style={x.childYear}>{c.childBirthYear}년생</Text> : null}
          </View>
        ))}
      </View>
    );
  }

  // ── 선생님 카드 빌더 ──────────────────────────────────────────
  function buildTeacherMeta(inv: TeacherInvite): ApprovalCardMeta {
    const isPending = inv.invite_status === "joinedPendingApproval";
    const statusMap: Record<string, ApprovalCardMeta["statusKey"]> = {
      joinedPendingApproval: "waitingApproval",
      approved:              "approved",
      rejected:              "rejected",
      invited:               "invited",
    };
    return {
      id:          inv.id,
      name:        inv.name,
      sub1:        inv.phone,
      sub2:        [inv.position, inv.user_email].filter(Boolean).join(" · ") || undefined,
      requestedAt: inv.requested_at ?? inv.created_at,
      statusKey:   statusMap[inv.invite_status] ?? "inactive",
      avatarIcon:  "user",
      showActions: isPending,
      processing:  processingId === inv.id,
    };
  }

  // ── 거절 모달 핸들러 ──────────────────────────────────────────
  const isParentTarget = rejectTargetId ? joinReqs.some(r => r.id === rejectTargetId) : false;
  function handleRejectConfirm(reason: string) {
    if (!rejectTargetId) return;
    if (isParentTarget) handleJoinDecision(rejectTargetId, "reject", reason);
    else                handleInviteAction(rejectTargetId, "reject", reason);
  }

  // ── 공통 헤더 ─────────────────────────────────────────────────
  const header = (
    <>
      <PageHeader title="승인 관리" />
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

  // ── 렌더 ─────────────────────────────────────────────────────
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
          contentContainerStyle={[
            s.list,
            { paddingBottom: insets.bottom + 100 },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={
            <EmptyState
              icon={isParentTab ? "users" : "send"}
              title={
                filter === "pending"  ? "대기 중인 요청이 없습니다" :
                filter === "approved" ? "승인된 내역이 없습니다"   :
                                        "거절된 내역이 없습니다"
              }
              subtitle="상단 필터에서 다른 상태를 선택해보세요"
            />
          }
          renderItem={({ item }) => {
            if (isParentTab) {
              const req = item as JoinRequest;
              return (
                <ApprovalCard
                  meta={buildParentMeta(req)}
                  extra={buildParentExtra(req)}
                  onApprove={() => handleJoinDecision(req.id, "approve")}
                  onReject={() => setRejectTargetId(req.id)}
                />
              );
            } else {
              const inv = item as TeacherInvite;
              return (
                <ApprovalCard
                  meta={buildTeacherMeta(inv)}
                  onApprove={() => handleInviteAction(inv.id, "approve")}
                  onReject={() => setRejectTargetId(inv.id)}
                />
              );
            }
          }}
        />
      </ScreenLayout>

      {/* 거절 사유 모달 */}
      <RejectModal
        visible={!!rejectTargetId}
        onClose={() => setRejectTargetId(null)}
        onConfirm={handleRejectConfirm}
        loading={!!processingId}
      />
    </>
  );
}

// 자녀 정보 extra 스타일
const x = StyleSheet.create({
  childBox:  { gap: 6 },
  childTitle:{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: C.textSecondary, marginBottom: 2 },
  childRow:  { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  childName: { fontSize: 13, fontFamily: "Inter_500Medium", color: C.text },
  childYear: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted },
});

const s = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
});
