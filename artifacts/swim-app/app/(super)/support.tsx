/**
 * (super)/support.tsx — 고객센터 (처리 대시보드)
 *
 * 구조:
 *  - 고정 헤더
 *  - SLA 알림 배너 (초과 시)
 *  - 3대 지표 요약 1줄 (스크롤 없음)
 *  - 의미 기반 필터 탭 1줄 (horizontal scroll)
 *  - 티켓 리스트 (FlatList, flex:1)
 *
 * 필터 탭: 전체 | 긴급 | SLA초과 | 결제 | 보안 | 환불
 * — 상태 기반 8칩 + 유형 기반 10칩 두 줄 구조 제거
 */
import { ChevronRight, CircleAlert, CreditCard, MessageCircle, OctagonAlert, Plus } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useSupportStore } from "@/store/supportStore";
import { useAuditLogStore } from "@/store/auditLogStore";
import type { SupportTicket, SupportStatus } from "@/domain/types";
import Colors from "@/constants/colors";
const C = Colors.light;

const P = "#7C3AED";
const RED = "#D96C6C";
const AMBER = "#D97706";
const TEAL = "#2EC4B6";

// ── 설정 ─────────────────────────────────────────────────────────────────────

const TYPE_CFG: Record<string, {
  label: string; color: string; bg: string;
  icon: React.ComponentProps<typeof Feather>["name"]; emergency?: boolean;
}> = {
  recovery:   { label: "복구",    color: RED,    bg: "#F9DEDA", icon: "alert-octagon", emergency: true },
  security:   { label: "보안",    color: "#991B1B", bg: "#F9DEDA", icon: "shield-off",  emergency: true },
  refund:     { label: "환불",    color: RED,    bg: "#F9DEDA", icon: "rotate-ccw" },
  payment:    { label: "결제",    color: TEAL,   bg: "#ECFEFF", icon: "credit-card" },
  deletion:   { label: "삭제",    color: AMBER,  bg: "#FFF1BF", icon: "trash-2" },
  policy:     { label: "정책",    color: TEAL,   bg: "#E6FFFA", icon: "file-text" },
  technical:  { label: "기술",    color: P,      bg: "#EEDDF5", icon: "tool" },
  storage:    { label: "저장공간", color: TEAL,   bg: "#E6FFFA", icon: "hard-drive" },
  chargeback: { label: "차지백",  color: "#991B1B", bg: "#F9DEDA", icon: "alert-triangle" },
  other:      { label: "기타",    color: "#64748B", bg: "#FFFFFF", icon: "help-circle" },
};

const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  received:          { label: "접수",    color: RED,    bg: "#F9DEDA" },
  in_progress:       { label: "처리 중", color: AMBER,  bg: "#FFF1BF" },
  on_hold:           { label: "보류",    color: "#64748B", bg: "#FFFFFF" },
  refund_linked:     { label: "환불연계", color: "#9333EA", bg: "#E6FAF8" },
  policy_sent:       { label: "정책발송", color: TEAL,   bg: "#ECFEFF" },
  need_recheck:      { label: "재확인",  color: "#E4A93A", bg: "#FFF1BF" },
  escalated_to_tech: { label: "에스컬",  color: P,      bg: "#EEDDF5" },
  resolved:          { label: "해결됨",  color: TEAL,   bg: "#E6FFFA" },
};

const REQUESTER_CFG: Record<string, { label: string; color: string }> = {
  operator: { label: "운영자", color: P },
  teacher:  { label: "선생님", color: TEAL },
  parent:   { label: "학부모", color: TEAL },
};

const STATUS_KEYS = Object.keys(STATUS_CFG) as SupportStatus[];
const TICKET_TYPES = Object.keys(TYPE_CFG);

// ── 의미 기반 필터 탭 ─────────────────────────────────────────────────────────

type FilterKey = "all" | "urgent" | "sla" | "payment" | "security" | "refund";

const FILTER_TABS: Array<{ key: FilterKey; label: string; color: string; icon: React.ComponentProps<typeof Feather>["name"] }> = [
  { key: "all",      label: "전체",    color: "#0F172A",  icon: "list" },
  { key: "urgent",   label: "긴급",    color: RED,        icon: "alert-octagon" },
  { key: "sla",      label: "SLA 초과", color: "#D97706", icon: "clock" },
  { key: "payment",  label: "결제",    color: TEAL,       icon: "credit-card" },
  { key: "security", label: "보안",    color: "#991B1B",  icon: "shield-off" },
  { key: "refund",   label: "환불",    color: "#9333EA",  icon: "rotate-ccw" },
];

function applyFilter(tickets: SupportTicket[], key: FilterKey): SupportTicket[] {
  switch (key) {
    case "urgent":
      return tickets.filter(t =>
        t.riskLevel === "critical" || t.riskLevel === "high" ||
        t.type === "recovery" || t.type === "security"
      );
    case "sla":
      return tickets.filter(t => t.isSlaOverdue);
    case "payment":
      return tickets.filter(t => t.type === "payment" || t.type === "chargeback");
    case "security":
      return tickets.filter(t => t.type === "security");
    case "refund":
      return tickets.filter(t => t.type === "refund");
    default:
      return tickets;
  }
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────

function safeDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function fmtRelative(iso: string | null | undefined): string {
  const d = safeDate(iso);
  if (!d) return "—";
  const diff = Date.now() - d.getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "방금";
  if (h < 24) return `${h}시간 전`;
  return d.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

function getSlaStatus(ticket: SupportTicket): { overdue: boolean; label: string } {
  if (!ticket.slaDueAt || ticket.status === "resolved") return { overdue: false, label: "" };
  const d = safeDate(ticket.slaDueAt);
  if (!d) return { overdue: false, label: "" };
  const msLeft = d.getTime() - Date.now();
  if (msLeft < 0) return { overdue: true, label: "SLA 초과" };
  const hLeft = Math.floor(msLeft / 3600000);
  if (hLeft < 4) return { overdue: false, label: `${hLeft}시간 남음` };
  return { overdue: false, label: "" };
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function SupportScreen() {
  const { adminUser } = useAuth();
  const actorName = adminUser?.name ?? "슈퍼관리자";

  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [refreshing, setRefreshing]     = useState(false);
  const [editTicket, setEditTicket]     = useState<SupportTicket | null>(null);
  const [newStatus, setNewStatus]       = useState<SupportStatus>("in_progress");
  const [assignee, setAssignee]         = useState("");
  const [internalMemo, setInternalMemo] = useState("");
  const [saving, setSaving]             = useState(false);
  const [createModal, setCreateModal]   = useState(false);
  const [form, setForm]                 = useState({
    type: "other", requesterRole: "operator", requesterName: "",
    operatorId: "", operatorName: "", title: "", body: "",
    riskLevel: "medium" as any,
  });
  const [creating, setCreating] = useState(false);

  // 리스크 센터 → 복구 긴급 자동 연결
  const params = useLocalSearchParams<{ type?: string }>();
  useEffect(() => {
    if (params.type === "recovery") {
      setForm(f => ({
        ...f, type: "recovery", riskLevel: "critical",
        title: "[긴급] 복구 실패 문의",
        body: "복구 실패가 발생했습니다. 즉시 확인해 주세요.\n\n[리스크 센터에서 자동 연결됨]",
      }));
      setCreateModal(true);
    }
  }, [params.type]);

  const allTickets     = useSupportStore(s => s.tickets);
  const updateStatus   = useSupportStore(s => s.updateTicketStatus);
  const assignTicket   = useSupportStore(s => s.assignTicket);
  const addMemo        = useSupportStore(s => s.addInternalMemo);
  const createTicketFn = useSupportStore(s => s.createTicket);
  const createLog      = useAuditLogStore(s => s.createLog);

  // 필터 적용 → 긴급 우선 정렬
  const filtered = useMemo(() => {
    const list = applyFilter(allTickets, activeFilter);
    const emergencyTypes = new Set(["recovery", "security"]);
    return [...list].sort((a, b) => {
      const ae = (emergencyTypes.has(a.type) || a.riskLevel === "critical") ? 1 : 0;
      const be = (emergencyTypes.has(b.type) || b.riskLevel === "critical") ? 1 : 0;
      if (be !== ae) return be - ae;
      if (a.isSlaOverdue && !b.isSlaOverdue) return -1;
      if (!a.isSlaOverdue && b.isSlaOverdue) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [allTickets, activeFilter]);

  // 상단 지표
  const openCount    = useMemo(() => allTickets.filter(t => t.status !== "resolved").length, [allTickets]);
  const slaCount     = useMemo(() => allTickets.filter(t => t.isSlaOverdue).length, [allTickets]);
  const urgentCount  = useMemo(() => allTickets.filter(t =>
    t.riskLevel === "critical" || t.riskLevel === "high" || t.type === "recovery" || t.type === "security"
  ).length, [allTickets]);

  // 탭별 카운트
  const tabCount = useMemo(() => {
    const r: Record<FilterKey, number> = { all: 0, urgent: 0, sla: 0, payment: 0, security: 0, refund: 0 };
    (Object.keys(r) as FilterKey[]).forEach(k => {
      r[k] = applyFilter(allTickets, k).length;
    });
    return r;
  }, [allTickets]);

  function handleUpdate() {
    if (!editTicket) return;
    setSaving(true);
    try {
      updateStatus(editTicket.id, newStatus);
      if (assignee.trim()) assignTicket(editTicket.id, assignee.trim());
      if (internalMemo.trim()) addMemo(editTicket.id, internalMemo.trim());
      createLog({
        category: "고객센터",
        title: `티켓 상태 변경: ${editTicket.title}`,
        operatorId: editTicket.operatorId,
        operatorName: editTicket.operatorName,
        actorName,
        impact: "low",
        detail: `${STATUS_CFG[newStatus]?.label ?? newStatus}${assignee ? ` · 담당: ${assignee}` : ""}`,
      });
      setEditTicket(null);
      setInternalMemo("");
    } finally { setSaving(false); }
  }

  function handleCreate() {
    if (!form.title.trim()) return;
    setCreating(true);
    try {
      createTicketFn({
        type: form.type as any,
        requesterRole: form.requesterRole as any,
        requesterName: form.requesterName,
        operatorId: form.operatorId,
        operatorName: form.operatorName,
        title: form.title,
        body: form.body,
        status: "received",
        assigneeName: "",
        riskLevel: form.riskLevel,
        internalMemo: "",
        repeatedIssueFlag: false,
      });
      createLog({
        category: "고객센터",
        title: `신규 티켓 등록: ${form.title}`,
        actorName,
        impact: "low",
        detail: `유형: ${TYPE_CFG[form.type]?.label ?? form.type}`,
      });
      setCreateModal(false);
      setForm({ type: "other", requesterRole: "operator", requesterName: "", operatorId: "", operatorName: "", title: "", body: "", riskLevel: "medium" });
    } finally { setCreating(false); }
  }

  // ── 티켓 카드 렌더 ────────────────────────────────────────────────────────
  const renderItem = ({ item }: { item: SupportTicket }) => {
    const tc = TYPE_CFG[item.type] ?? TYPE_CFG.other;
    const sc = STATUS_CFG[item.status] ?? STATUS_CFG.received;
    const rc = REQUESTER_CFG[item.requesterRole] ?? { label: item.requesterRole, color: "#64748B" };
    const { overdue, label: slaLabel } = getSlaStatus(item);
    const isEmergency = tc.emergency === true;

    return (
      <Pressable
        style={[s.row, overdue && s.rowOverdue, isEmergency && s.rowEmergency]}
        onPress={() => {
          setEditTicket(item);
          setNewStatus(item.status as SupportStatus);
          setAssignee(item.assigneeName ?? "");
          setInternalMemo(item.internalMemo ?? "");
        }}>
        {isEmergency && <View style={s.emergencyStripe} />}
        <View style={[s.typeIcon, { backgroundColor: tc.bg }]}>
          <LucideIcon name={tc.icon} size={15} color={tc.color} />
        </View>
        <View style={s.rowMain}>
          <View style={s.rowTop}>
            {isEmergency && (
              <View style={s.emergencyBadge}>
                <OctagonAlert size={9} color={RED} />
                <Text style={s.emergencyBadgeTxt}>긴급</Text>
              </View>
            )}
            {overdue && <View style={s.slaTag}><Text style={s.slaTxt}>SLA 초과</Text></View>}
            {slaLabel && !overdue && (
              <View style={[s.slaTag, { backgroundColor: "#FFF1BF" }]}>
                <Text style={[s.slaTxt, { color: AMBER }]}>{slaLabel}</Text>
              </View>
            )}
          </View>
          <Text style={[s.subject, isEmergency && { color: RED }]} numberOfLines={1}>{item.title}</Text>
          <View style={s.rowMeta}>
            <Text style={[s.metaTxt, { color: rc.color }]}>{rc.label}</Text>
            {item.operatorName ? (
              <><Text style={s.metaDot}>·</Text><Text style={s.metaTxt}>{item.operatorName}</Text></>
            ) : item.requesterName ? (
              <><Text style={s.metaDot}>·</Text><Text style={s.metaTxt}>{item.requesterName}</Text></>
            ) : null}
            <Text style={s.metaDot}>·</Text>
            <Text style={s.metaTxt}>{fmtRelative(item.createdAt)}</Text>
          </View>
        </View>
        <View style={s.rowRight}>
          <View style={[s.badge, { backgroundColor: sc.bg }]}>
            <Text style={[s.badgeTxt, { color: sc.color }]}>{sc.label}</Text>
          </View>
          {item.assigneeName ? <Text style={s.assigneeTxt}>{item.assigneeName}</Text> : null}
        </View>
      </Pressable>
    );
  };

  // ── 렌더 ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={[]}>
      {/* 고정 헤더 */}
      <SubScreenHeader title="고객센터" homePath="/(super)/dashboard" />

      {/* SLA 초과 알림 배너 */}
      {slaCount > 0 && (
        <Pressable
          style={s.slaBanner}
          onPress={() => setActiveFilter("sla")}
          hitSlop={{ top: 4, bottom: 4, left: 0, right: 0 }}>
          <CircleAlert size={14} color="#991B1B" />
          <Text style={s.slaBannerTxt}>
            SLA 초과 <Text style={{ fontFamily: "Pretendard-Bold" }}>{slaCount}건</Text> — 즉시 처리 필요
          </Text>
          <ChevronRight size={14} color="#991B1B" />
        </Pressable>
      )}

      {/* 3대 지표 요약 (스크롤 없음, 1줄 고정) */}
      <View style={s.statRow}>
        <View style={s.statItem}>
          <Text style={s.statNum}>{openCount}</Text>
          <Text style={s.statLabel}>미처리</Text>
        </View>
        <View style={s.statDivider} />
        <Pressable
          style={s.statItem}
          onPress={() => setActiveFilter("sla")}
          hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}>
          <Text style={[s.statNum, slaCount > 0 && { color: RED }]}>{slaCount}</Text>
          <Text style={[s.statLabel, slaCount > 0 && { color: RED }]}>SLA 초과</Text>
        </Pressable>
        <View style={s.statDivider} />
        <Pressable
          style={s.statItem}
          onPress={() => setActiveFilter("urgent")}
          hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}>
          <Text style={[s.statNum, urgentCount > 0 && { color: "#D97706" }]}>{urgentCount}</Text>
          <Text style={[s.statLabel, urgentCount > 0 && { color: "#D97706" }]}>긴급</Text>
        </Pressable>
      </View>

      {/* 필터 탭 1줄 (6개 의미 기반, 명확한 높이) */}
      <View style={s.tabBarWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.tabContent}
          style={s.tabBar}>
          {FILTER_TABS.map(tab => {
            const isActive = activeFilter === tab.key;
            const cnt = tabCount[tab.key];
            return (
              <Pressable
                key={tab.key}
                style={[s.tabChip, isActive && { backgroundColor: tab.color, borderColor: tab.color }]}
                onPress={() => setActiveFilter(tab.key)}
                hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
                <LucideIcon name={tab.icon} size={11} color={isActive ? "#fff" : tab.color} />
                <Text style={[s.tabChipTxt, isActive && { color: "#fff" }]}>{tab.label}</Text>
                {cnt > 0 && (
                  <View style={[s.tabCount, isActive && { backgroundColor: "rgba(255,255,255,0.3)" }]}>
                    <Text style={[s.tabCountTxt, isActive && { color: "#fff" }]}>{cnt}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* 티켓 리스트 (flex:1 — 나머지 공간 전체) */}
      <FlatList
        style={s.list}
        data={filtered}
        keyExtractor={i => i.id}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={P}
            onRefresh={() => { setRefreshing(true); setTimeout(() => setRefreshing(false), 400); }}
          />
        }
        contentContainerStyle={s.listContent}
        ItemSeparatorComponent={() => <View style={s.separator} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <MessageCircle size={32} color="#D1D5DB" />
            <Text style={s.emptyTxt}>해당 조건의 문의가 없습니다</Text>
          </View>
        }
      />

      {/* 등록 FAB */}
      <Pressable style={s.fab} onPress={() => setCreateModal(true)}>
        <Plus size={20} color="#fff" />
      </Pressable>

      {/* 처리 모달 */}
      {editTicket && (
        <Modal visible animationType="slide" transparent statusBarTranslucent onRequestClose={() => setEditTicket(null)}>
          <Pressable style={m.backdrop} onPress={() => setEditTicket(null)}>
            <Pressable style={m.sheet} onPress={() => {}}>
              <View style={m.handle} />
              <Text style={m.title}>{editTicket.title}</Text>
              {editTicket.body ? <Text style={m.desc} numberOfLines={3}>{editTicket.body}</Text> : null}

              <View style={m.infoBox}>
                <View style={m.infoRow}>
                  <Text style={m.infoLabel}>유형</Text>
                  <Text style={m.infoVal}>{TYPE_CFG[editTicket.type]?.label ?? editTicket.type}</Text>
                </View>
                <View style={m.infoRow}>
                  <Text style={m.infoLabel}>요청자</Text>
                  <Text style={m.infoVal}>
                    {REQUESTER_CFG[editTicket.requesterRole]?.label} {editTicket.requesterName ?? ""}
                  </Text>
                </View>
                {editTicket.operatorName ? (
                  <View style={m.infoRow}>
                    <Text style={m.infoLabel}>운영자</Text>
                    <Pressable onPress={() => {
                      setEditTicket(null);
                      router.push(`/(super)/operator-detail?id=${editTicket.operatorId}` as any);
                    }}>
                      <Text style={[m.infoVal, { color: P, textDecorationLine: "underline" }]}>{editTicket.operatorName}</Text>
                    </Pressable>
                  </View>
                ) : null}
                <View style={m.infoRow}>
                  <Text style={m.infoLabel}>SLA 마감</Text>
                  <Text style={[m.infoVal, editTicket.isSlaOverdue && { color: RED }]}>
                    {editTicket.slaDueAt
                      ? new Date(editTicket.slaDueAt).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                      : "—"}
                    {editTicket.isSlaOverdue ? " · 초과됨" : ""}
                  </Text>
                </View>
              </View>

              <View style={m.section}>
                <Text style={m.label}>처리 상태</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {STATUS_KEYS.map(k => {
                    const sc = STATUS_CFG[k];
                    return (
                      <Pressable key={k}
                        style={[m.optChip, newStatus === k && { backgroundColor: sc.color, borderColor: sc.color }]}
                        onPress={() => setNewStatus(k)}>
                        <Text style={[m.optTxt, newStatus === k && { color: "#fff" }]}>{sc.label}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              <View style={m.section}>
                <Text style={m.label}>담당자</Text>
                <TextInput style={m.input} value={assignee} onChangeText={setAssignee}
                  placeholder="담당자 이름" placeholderTextColor="#64748B" />
              </View>

              <View style={m.section}>
                <Text style={m.label}>내부 메모</Text>
                <TextInput style={[m.input, { minHeight: 60 }]} value={internalMemo} onChangeText={setInternalMemo}
                  multiline placeholder="내부 처리 메모" placeholderTextColor="#64748B" textAlignVertical="top" />
              </View>

              {editTicket.type === "refund" && (
                <Pressable style={m.linkBtn} onPress={() => { setEditTicket(null); router.push("/(super)/subscriptions" as any); }}>
                  <CreditCard size={14} color={P} />
                  <Text style={m.linkBtnTxt}>구독·결제 관리로 이동</Text>
                </Pressable>
              )}

              <View style={m.btnRow}>
                <Pressable style={m.cancelBtn} onPress={() => setEditTicket(null)}>
                  <Text style={m.cancelTxt}>닫기</Text>
                </Pressable>
                <Pressable style={[m.saveBtn, { opacity: saving ? 0.6 : 1 }]} onPress={handleUpdate} disabled={saving}>
                  {saving
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={m.saveTxt}>저장</Text>}
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* 신규 티켓 등록 모달 */}
      {createModal && (
        <Modal visible animationType="slide" transparent statusBarTranslucent onRequestClose={() => setCreateModal(false)}>
          <Pressable style={m.backdrop} onPress={() => setCreateModal(false)}>
            <Pressable style={[m.sheet, { maxHeight: "90%" }]} onPress={() => {}}>
              <View style={m.handle} />
              <Text style={m.title}>문의 등록</Text>

              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
                <View style={m.section}>
                  <Text style={m.label}>문의 유형</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                    {TICKET_TYPES.map(t => {
                      const tc = TYPE_CFG[t];
                      return (
                        <Pressable key={t}
                          style={[m.optChip, form.type === t && { backgroundColor: tc.color, borderColor: tc.color }]}
                          onPress={() => setForm(f => ({ ...f, type: t }))}>
                          <Text style={[m.optTxt, form.type === t && { color: "#fff" }]}>{tc.label}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>

                <View style={m.section}>
                  <Text style={m.label}>요청자 유형</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                    {["operator", "teacher", "parent"].map(t => (
                      <Pressable key={t}
                        style={[m.optChip, form.requesterRole === t && { backgroundColor: P, borderColor: P }]}
                        onPress={() => setForm(f => ({ ...f, requesterRole: t }))}>
                        <Text style={[m.optTxt, form.requesterRole === t && { color: "#fff" }]}>
                          {REQUESTER_CFG[t]?.label ?? t}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>

                <View style={m.section}>
                  <Text style={m.label}>요청자 이름</Text>
                  <TextInput style={m.input} value={form.requesterName}
                    onChangeText={v => setForm(f => ({ ...f, requesterName: v }))}
                    placeholder="이름 (선택)" placeholderTextColor="#64748B" />
                </View>

                <View style={m.section}>
                  <Text style={m.label}>제목 *</Text>
                  <TextInput style={m.input} value={form.title}
                    onChangeText={v => setForm(f => ({ ...f, title: v }))}
                    placeholder="문의 제목" placeholderTextColor="#64748B" />
                </View>

                <View style={m.section}>
                  <Text style={m.label}>내용</Text>
                  <TextInput style={[m.input, { minHeight: 80 }]} value={form.body}
                    onChangeText={v => setForm(f => ({ ...f, body: v }))}
                    multiline placeholder="문의 내용 (선택)" placeholderTextColor="#64748B" textAlignVertical="top" />
                </View>

                <View style={m.btnRow}>
                  <Pressable style={m.cancelBtn} onPress={() => setCreateModal(false)}>
                    <Text style={m.cancelTxt}>취소</Text>
                  </Pressable>
                  <Pressable
                    style={[m.saveBtn, { opacity: creating || !form.title ? 0.6 : 1 }]}
                    onPress={handleCreate}
                    disabled={creating || !form.title}>
                    {creating
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={m.saveTxt}>등록</Text>}
                  </Pressable>
                </View>
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </SafeAreaView>
  );
}

// ── 스타일 ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.background },

  // SLA 배너
  slaBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#F9DEDA", paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "#FCA5A5",
  },
  slaBannerTxt: { fontFamily: "Pretendard-Medium", fontSize: 13, color: "#991B1B", flex: 1 },

  // 3대 지표 요약 (no scroll, 명확한 높이)
  statRow: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#fff",
    borderBottomWidth: 1, borderBottomColor: "#E5E7EB",
    height: 56,
    paddingHorizontal: 16,
  },
  statItem:    { flex: 1, alignItems: "center", justifyContent: "center" },
  statNum:     { fontSize: 20, fontFamily: "Pretendard-Bold", color: "#0F172A" },
  statLabel:   { fontSize: 10, fontFamily: "Pretendard-Medium", color: "#64748B", marginTop: 1 },
  statDivider: { width: 1, height: 28, backgroundColor: "#E5E7EB" },

  // 필터 탭 (명확한 height, overflow visible)
  tabBarWrapper: {
    backgroundColor: "#fff",
    borderBottomWidth: 1, borderBottomColor: "#E5E7EB",
    height: 48,
    justifyContent: "center",
  },
  tabBar:    { flexGrow: 0 },
  tabContent:{ paddingHorizontal: 12, paddingVertical: 6, gap: 6, flexDirection: "row", alignItems: "center" },
  tabChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1.5, borderColor: "#E5E7EB",
    backgroundColor: "#fff", height: 34,
  },
  tabChipTxt:  { fontSize: 12, fontFamily: "Pretendard-SemiBold", color: "#64748B" },
  tabCount:    { backgroundColor: "#FFFFFF", borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },
  tabCountTxt: { fontSize: 10, fontFamily: "Pretendard-Bold", color: "#0F172A" },

  // 리스트
  list:        { flex: 1, backgroundColor: "#FFFFFF" },
  listContent: { paddingBottom: 100 },
  separator:   { height: 1, backgroundColor: "#FFFFFF" },
  empty:       { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyTxt:    { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#64748B" },

  // 티켓 카드
  row: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#fff",
  },
  rowOverdue:   { borderLeftWidth: 3, borderLeftColor: RED },
  rowEmergency: { backgroundColor: "#FFF1F2", borderLeftWidth: 4, borderLeftColor: RED },
  emergencyStripe: {
    position: "absolute", left: 0, top: 0, bottom: 0, width: 4,
    backgroundColor: RED, borderRadius: 2,
  },
  emergencyBadge: {
    flexDirection: "row", alignItems: "center", gap: 2,
    backgroundColor: "#F9DEDA", paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5,
  },
  emergencyBadgeTxt: { fontSize: 10, fontFamily: "Pretendard-Bold", color: RED },
  typeIcon:   { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  rowMain:    { flex: 1, gap: 3 },
  rowTop:     { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" },
  subject:    { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#0F172A" },
  slaTag:     { backgroundColor: "#F9DEDA", paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5 },
  slaTxt:     { fontSize: 9, fontFamily: "Pretendard-Bold", color: RED },
  rowMeta:    { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" },
  metaTxt:    { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  metaDot:    { fontSize: 10, color: "#D1D5DB" },
  rowRight:   { alignItems: "flex-end", gap: 4 },
  badge:      { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
  badgeTxt:   { fontSize: 10, fontFamily: "Pretendard-SemiBold" },
  assigneeTxt:{ fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B" },

  // FAB
  fab: {
    position: "absolute", bottom: 24, right: 16,
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: P, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22, shadowRadius: 4, elevation: 5,
  },
});

const m = StyleSheet.create({
  backdrop:  { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 40, maxHeight: "88%", gap: 12,
  },
  handle:    { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  title:     { fontSize: 17, fontFamily: "Pretendard-Bold", color: "#0F172A" },
  desc:      { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A", lineHeight: 20 },
  infoBox:   { backgroundColor: "#F1F5F9", borderRadius: 10, padding: 12, gap: 6 },
  infoRow:   { flexDirection: "row", gap: 8 },
  infoLabel: { width: 60, fontSize: 12, fontFamily: "Pretendard-Medium", color: "#64748B" },
  infoVal:   { flex: 1, fontSize: 12, fontFamily: "Pretendard-Medium", color: "#0F172A" },
  section:   { gap: 6 },
  label:     { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: "#0F172A" },
  input: {
    borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10,
    padding: 12, fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A",
  },
  optChip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#fff",
  },
  optTxt:    { fontSize: 13, fontFamily: "Pretendard-Medium", color: "#0F172A" },
  linkBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#EEDDF5", borderRadius: 10, padding: 12,
  },
  linkBtnTxt:{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: P },
  btnRow:    { flexDirection: "row", gap: 10, justifyContent: "flex-end", marginTop: 4 },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: "#FFFFFF" },
  cancelTxt: { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#64748B" },
  saveBtn:   { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: P },
  saveTxt:   { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#fff" },
});
