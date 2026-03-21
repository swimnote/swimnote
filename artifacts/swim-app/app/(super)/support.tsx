/**
 * (super)/support.tsx — 고객센터
 * supportStore에서 15+개 티켓 데이터 — API 호출 없음
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
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
import { SLA_HOURS } from "@/domain/policies";

const P = "#7C3AED";

const TYPE_CFG: Record<string, { label: string; color: string; bg: string; icon: React.ComponentProps<typeof Feather>["name"] }> = {
  refund:     { label: "환불",   color: "#DC2626", bg: "#FEE2E2", icon: "rotate-ccw" },
  payment:    { label: "결제",   color: "#0891B2", bg: "#ECFEFF", icon: "credit-card" },
  deletion:   { label: "삭제",   color: "#D97706", bg: "#FEF3C7", icon: "trash-2" },
  policy:     { label: "정책",   color: "#4F46E5", bg: "#EEF2FF", icon: "file-text" },
  technical:  { label: "기술",   color: P,         bg: "#EDE9FE", icon: "tool" },
  storage:    { label: "저장공간", color: "#059669", bg: "#D1FAE5", icon: "hard-drive" },
  chargeback: { label: "차지백", color: "#991B1B", bg: "#FEE2E2", icon: "alert-triangle" },
  other:      { label: "기타",   color: "#6B7280", bg: "#F3F4F6", icon: "help-circle" },
};

const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  open:               { label: "미처리",  color: "#DC2626", bg: "#FEE2E2" },
  pending:            { label: "대기 중", color: "#D97706", bg: "#FEF3C7" },
  in_progress:        { label: "처리 중", color: "#D97706", bg: "#FEF3C7" },
  escalated_to_tech:  { label: "에스컬",  color: P,         bg: "#EDE9FE" },
  resolved:           { label: "해결됨",  color: "#059669", bg: "#D1FAE5" },
};

const REQUESTER_CFG: Record<string, { label: string; color: string }> = {
  operator: { label: "운영자",  color: P },
  teacher:  { label: "선생님",  color: "#059669" },
  parent:   { label: "학부모",  color: "#0891B2" },
};

const TICKET_TYPES = Object.keys(TYPE_CFG);
const STATUS_KEYS  = Object.keys(STATUS_CFG) as SupportStatus[];

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
  if (!ticket.slaDueAt || ticket.status === 'resolved') return { overdue: false, label: "" };
  const d = safeDate(ticket.slaDueAt);
  if (!d) return { overdue: false, label: "" };
  const msLeft = d.getTime() - Date.now();
  if (msLeft < 0) return { overdue: true, label: "SLA 초과" };
  const hLeft = Math.floor(msLeft / 3600000);
  if (hLeft < 4) return { overdue: false, label: `${hLeft}시간 남음` };
  return { overdue: false, label: "" };
}

export default function SupportScreen() {
  const { adminUser } = useAuth();
  const actorName = adminUser?.name ?? '슈퍼관리자';

  const [filterStatus, setFilterStatus]  = useState("all");
  const [filterType, setFilterType]      = useState("all");
  const [refreshing, setRefreshing]      = useState(false);
  const [editTicket, setEditTicket]      = useState<SupportTicket | null>(null);
  const [newStatus, setNewStatus]        = useState<SupportStatus>("in_progress");
  const [assignee, setAssignee]          = useState("");
  const [internalMemo, setInternalMemo]  = useState("");
  const [saving, setSaving]              = useState(false);
  const [createModal, setCreateModal]    = useState(false);
  const [form, setForm]                  = useState({
    type: "other", requesterType: "operator", requesterName: "",
    operatorId: "", operatorName: "", subject: "", description: "",
    riskLevel: "medium" as any,
  });
  const [creating, setCreating]          = useState(false);

  const allTickets        = useSupportStore(s => s.tickets);
  const updateStatus      = useSupportStore(s => s.updateTicketStatus);
  const assignTicket      = useSupportStore(s => s.assignTicket);
  const addMemo           = useSupportStore(s => s.addInternalMemo);
  const createTicketFn    = useSupportStore(s => s.createTicket);
  const createLog         = useAuditLogStore(s => s.createLog);

  const filtered = useMemo(() => {
    let list = allTickets;
    if (filterStatus !== "all") list = list.filter(t => t.status === filterStatus);
    if (filterType !== "all")   list = list.filter(t => t.type === filterType);
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [allTickets, filterStatus, filterType]);

  const counts: Record<string, number> = useMemo(() => {
    const c: Record<string, number> = { all: allTickets.length };
    STATUS_KEYS.forEach(k => { c[k] = allTickets.filter(t => t.status === k).length; });
    return c;
  }, [allTickets]);

  const slaOverdueCount = useMemo(() => allTickets.filter(t => t.isSlaOverdue).length, [allTickets]);

  function handleUpdate() {
    if (!editTicket) return;
    setSaving(true);
    try {
      updateStatus(editTicket.id, newStatus);
      if (assignee.trim()) assignTicket(editTicket.id, assignee.trim());
      if (internalMemo.trim()) addMemo(editTicket.id, internalMemo.trim());
      createLog({
        category: '고객센터',
        title: `티켓 상태 변경: ${editTicket.subject}`,
        operatorId: editTicket.operatorId,
        operatorName: editTicket.operatorName,
        actorName,
        impact: 'low',
        detail: `${STATUS_CFG[newStatus]?.label ?? newStatus}${assignee ? ` · 담당: ${assignee}` : ''}`,
      });
      setEditTicket(null);
      setInternalMemo("");
    } finally { setSaving(false); }
  }

  function handleCreate() {
    if (!form.subject.trim()) return;
    setCreating(true);
    try {
      const ticket = createTicketFn({
        type: form.type as any,
        requesterType: form.requesterType as any,
        requesterName: form.requesterName,
        operatorId: form.operatorId,
        operatorName: form.operatorName,
        subject: form.subject,
        description: form.description,
        status: 'open',
        assigneeName: '',
        riskLevel: form.riskLevel,
        internalMemo: '',
      });
      createLog({
        category: '고객센터',
        title: `신규 티켓 등록: ${form.subject}`,
        actorName,
        impact: 'low',
        detail: `유형: ${TYPE_CFG[form.type]?.label ?? form.type}`,
      });
      setCreateModal(false);
      setForm({ type: "other", requesterType: "operator", requesterName: "", operatorId: "", operatorName: "", subject: "", description: "", riskLevel: "medium" });
    } finally { setCreating(false); }
  }

  const renderItem = ({ item }: { item: SupportTicket }) => {
    const tc = TYPE_CFG[item.type] ?? TYPE_CFG.other;
    const sc = STATUS_CFG[item.status] ?? STATUS_CFG.open;
    const rc = REQUESTER_CFG[item.requesterType] ?? { label: item.requesterType, color: "#6B7280" };
    const { overdue, label: slaLabel } = getSlaStatus(item);

    return (
      <Pressable style={[s.row, overdue && s.rowOverdue, item.riskLevel === 'critical' && s.rowCritical]}
        onPress={() => { setEditTicket(item); setNewStatus(item.status as SupportStatus); setAssignee(item.assigneeName ?? ""); setInternalMemo(item.internalMemo ?? ""); }}>
        <View style={[s.typeIcon, { backgroundColor: tc.bg }]}>
          <Feather name={tc.icon} size={15} color={tc.color} />
        </View>
        <View style={s.rowMain}>
          <View style={s.rowTop}>
            <Text style={s.subject} numberOfLines={1}>{item.subject}</Text>
            {overdue && <View style={s.slaTag}><Text style={s.slaTxt}>SLA 초과</Text></View>}
            {slaLabel && !overdue && <View style={[s.slaTag, { backgroundColor: "#FEF3C7" }]}><Text style={[s.slaTxt, { color: "#D97706" }]}>{slaLabel}</Text></View>}
          </View>
          <View style={s.rowMeta}>
            <Text style={[s.metaTxt, { color: rc.color }]}>{rc.label}</Text>
            {item.requesterName && <><Text style={s.metaDot}>·</Text><Text style={s.metaTxt}>{item.requesterName}</Text></>}
            {item.operatorName && <><Text style={s.metaDot}>·</Text><Text style={s.metaTxt}>{item.operatorName}</Text></>}
            <Text style={s.metaDot}>·</Text>
            <Text style={s.metaTxt}>{fmtRelative(item.createdAt)}</Text>
          </View>
        </View>
        <View style={s.rowRight}>
          <View style={[s.badge, { backgroundColor: sc.bg }]}>
            <Text style={[s.badgeTxt, { color: sc.color }]}>{sc.label}</Text>
          </View>
          {item.assigneeName && <Text style={s.assigneeTxt}>{item.assigneeName}</Text>}
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="고객센터" homePath="/(super)/dashboard" />

      {/* SLA 알림 배너 */}
      {slaOverdueCount > 0 && (
        <Pressable style={s.slaBanner} onPress={() => setFilterStatus("open")}>
          <Feather name="alert-circle" size={14} color="#DC2626" />
          <Text style={s.slaBannerTxt}>SLA 초과 티켓 <Text style={{ fontFamily: "Inter_700Bold" }}>{slaOverdueCount}건</Text> — 즉시 처리 필요</Text>
        </Pressable>
      )}

      {/* 상태별 요약 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.summaryBar} contentContainerStyle={s.summaryContent}>
        {[
          { k: "all", label: "전체", color: "#374151" },
          ...STATUS_KEYS.map(k => ({ k, label: STATUS_CFG[k].label, color: STATUS_CFG[k].color })),
        ].map(item => {
          const isActive = filterStatus === item.k;
          return (
            <Pressable key={item.k}
              style={[s.summaryChip, { backgroundColor: isActive ? item.color : "#F3F4F6" }]}
              onPress={() => setFilterStatus(item.k)}>
              <Text style={[s.summaryNum, { color: isActive ? "#fff" : "#111827" }]}>{counts[item.k] ?? 0}</Text>
              <Text style={[s.summaryLabel, { color: isActive ? "rgba(255,255,255,0.8)" : "#9CA3AF" }]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* 유형 필터 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.typeBar} contentContainerStyle={s.typeContent}>
        <Pressable style={[s.typeChip, filterType === "all" && s.typeChipActive]} onPress={() => setFilterType("all")}>
          <Text style={[s.typeChipTxt, filterType === "all" && { color: "#fff" }]}>전체 유형</Text>
        </Pressable>
        {TICKET_TYPES.map(t => {
          const tc = TYPE_CFG[t];
          const isActive = filterType === t;
          return (
            <Pressable key={t} style={[s.typeChip, isActive && { backgroundColor: tc.color, borderColor: tc.color }]}
              onPress={() => setFilterType(t)}>
              <Feather name={tc.icon} size={12} color={isActive ? "#fff" : tc.color} />
              <Text style={[s.typeChipTxt, isActive && { color: "#fff" }]}>{tc.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* 리스트 */}
      <FlatList
        data={filtered}
        keyExtractor={i => i.id}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={P}
          onRefresh={() => { setRefreshing(true); setTimeout(() => setRefreshing(false), 400); }} />}
        contentContainerStyle={{ paddingVertical: 4, paddingBottom: 80 }}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#F3F4F6" }} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <Feather name="message-circle" size={32} color="#D1D5DB" />
            <Text style={s.emptyTxt}>해당 조건의 문의가 없습니다</Text>
          </View>
        }
      />

      {/* 등록 FAB */}
      <Pressable style={s.fab} onPress={() => setCreateModal(true)}>
        <Feather name="plus" size={20} color="#fff" />
      </Pressable>

      {/* 처리 모달 */}
      {editTicket && (
        <Modal visible animationType="slide" transparent statusBarTranslucent onRequestClose={() => setEditTicket(null)}>
          <Pressable style={m.backdrop} onPress={() => setEditTicket(null)}>
            <Pressable style={m.sheet} onPress={() => {}}>
              <View style={m.handle} />
              <Text style={m.title}>{editTicket.subject}</Text>
              {editTicket.description && <Text style={m.desc} numberOfLines={3}>{editTicket.description}</Text>}

              <View style={m.infoBox}>
                <View style={m.infoRow}>
                  <Text style={m.infoLabel}>유형</Text>
                  <Text style={m.infoVal}>{TYPE_CFG[editTicket.type]?.label ?? editTicket.type}</Text>
                </View>
                <View style={m.infoRow}>
                  <Text style={m.infoLabel}>요청자</Text>
                  <Text style={m.infoVal}>{REQUESTER_CFG[editTicket.requesterType]?.label} {editTicket.requesterName ?? ""}</Text>
                </View>
                {editTicket.operatorName && (
                  <View style={m.infoRow}>
                    <Text style={m.infoLabel}>운영자</Text>
                    <Pressable onPress={() => { setEditTicket(null); router.push(`/(super)/operator-detail?id=${editTicket.operatorId}` as any); }}>
                      <Text style={[m.infoVal, { color: P, textDecorationLine: "underline" }]}>{editTicket.operatorName}</Text>
                    </Pressable>
                  </View>
                )}
                <View style={m.infoRow}>
                  <Text style={m.infoLabel}>SLA 마감</Text>
                  <Text style={[m.infoVal, editTicket.isSlaOverdue && { color: "#DC2626" }]}>
                    {editTicket.slaDueAt ? new Date(editTicket.slaDueAt).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
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
                  placeholder="담당자 이름" placeholderTextColor="#9CA3AF" />
              </View>

              <View style={m.section}>
                <Text style={m.label}>내부 메모</Text>
                <TextInput style={[m.input, { minHeight: 60 }]} value={internalMemo} onChangeText={setInternalMemo}
                  multiline placeholder="내부 처리 메모" placeholderTextColor="#9CA3AF" textAlignVertical="top" />
              </View>

              {editTicket.type === "refund" && (
                <Pressable style={m.linkBtn} onPress={() => { setEditTicket(null); router.push("/(super)/subscriptions" as any); }}>
                  <Feather name="credit-card" size={14} color={P} />
                  <Text style={m.linkBtnTxt}>구독·결제 관리로 이동</Text>
                </Pressable>
              )}

              <View style={m.btnRow}>
                <Pressable style={m.cancelBtn} onPress={() => setEditTicket(null)}>
                  <Text style={m.cancelTxt}>닫기</Text>
                </Pressable>
                <Pressable style={[m.saveBtn, { opacity: saving ? 0.6 : 1 }]} onPress={handleUpdate} disabled={saving}>
                  {saving ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={m.saveTxt}>저장</Text>}
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* 신규 티켓 모달 */}
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
                        <Pressable key={t} style={[m.optChip, form.type === t && { backgroundColor: tc.color, borderColor: tc.color }]}
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
                      <Pressable key={t} style={[m.optChip, form.requesterType === t && { backgroundColor: P, borderColor: P }]}
                        onPress={() => setForm(f => ({ ...f, requesterType: t }))}>
                        <Text style={[m.optTxt, form.requesterType === t && { color: "#fff" }]}>
                          {REQUESTER_CFG[t]?.label ?? t}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>

                <View style={m.section}>
                  <Text style={m.label}>요청자 이름</Text>
                  <TextInput style={m.input} value={form.requesterName} onChangeText={v => setForm(f => ({ ...f, requesterName: v }))}
                    placeholder="이름 (선택)" placeholderTextColor="#9CA3AF" />
                </View>

                <View style={m.section}>
                  <Text style={m.label}>제목 *</Text>
                  <TextInput style={m.input} value={form.subject} onChangeText={v => setForm(f => ({ ...f, subject: v }))}
                    placeholder="문의 제목" placeholderTextColor="#9CA3AF" />
                </View>

                <View style={m.section}>
                  <Text style={m.label}>내용</Text>
                  <TextInput style={[m.input, { minHeight: 80 }]} value={form.description}
                    onChangeText={v => setForm(f => ({ ...f, description: v }))}
                    multiline placeholder="문의 내용 (선택)" placeholderTextColor="#9CA3AF" textAlignVertical="top" />
                </View>

                <View style={m.btnRow}>
                  <Pressable style={m.cancelBtn} onPress={() => setCreateModal(false)}>
                    <Text style={m.cancelTxt}>취소</Text>
                  </Pressable>
                  <Pressable style={[m.saveBtn, { opacity: creating || !form.subject ? 0.6 : 1 }]}
                    onPress={handleCreate} disabled={creating || !form.subject}>
                    {creating ? <ActivityIndicator color="#fff" size="small" />
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

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: "#F5F3FF" },
  slaBanner:     { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FEE2E2", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#FCA5A5" },
  slaBannerTxt:  { fontFamily: "Inter_500Medium", fontSize: 13, color: "#991B1B", flex: 1 },
  summaryBar:    { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", flexGrow: 0 },
  summaryContent:{ paddingHorizontal: 12, paddingVertical: 8, gap: 6, flexDirection: "row" },
  summaryChip:   { alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  summaryNum:    { fontSize: 17, fontFamily: "Inter_700Bold" },
  summaryLabel:  { fontSize: 9, fontFamily: "Inter_500Medium", marginTop: 1 },
  typeBar:       { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", flexGrow: 0 },
  typeContent:   { paddingHorizontal: 12, paddingVertical: 7, gap: 6, flexDirection: "row" },
  typeChip:      { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#fff" },
  typeChipActive:{ backgroundColor: P, borderColor: P },
  typeChipTxt:   { fontSize: 12, fontFamily: "Inter_500Medium", color: "#6B7280" },
  row:           { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#fff" },
  rowOverdue:    { borderLeftWidth: 3, borderLeftColor: "#DC2626" },
  rowCritical:   { backgroundColor: "#FFF5F5" },
  typeIcon:      { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  rowMain:       { flex: 1, gap: 4 },
  rowTop:        { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  subject:       { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#111827" },
  slaTag:        { backgroundColor: "#FEE2E2", paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5 },
  slaTxt:        { fontSize: 9, fontFamily: "Inter_700Bold", color: "#DC2626" },
  rowMeta:       { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" },
  metaTxt:       { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  metaDot:       { fontSize: 10, color: "#D1D5DB" },
  rowRight:      { alignItems: "flex-end", gap: 4 },
  badge:         { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  badgeTxt:      { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  assigneeTxt:   { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  empty:         { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyTxt:      { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  fab:           { position: "absolute", bottom: 20, right: 16, width: 52, height: 52, borderRadius: 26, backgroundColor: P, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 5 },
});

const m = StyleSheet.create({
  backdrop:   { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:      { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, maxHeight: "88%", gap: 12 },
  handle:     { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  title:      { fontSize: 17, fontFamily: "Inter_700Bold", color: "#111827" },
  desc:       { fontSize: 13, fontFamily: "Inter_400Regular", color: "#374151", lineHeight: 20 },
  infoBox:    { backgroundColor: "#F9FAFB", borderRadius: 10, padding: 12, gap: 6 },
  infoRow:    { flexDirection: "row", gap: 8 },
  infoLabel:  { width: 60, fontSize: 12, fontFamily: "Inter_500Medium", color: "#9CA3AF" },
  infoVal:    { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: "#374151" },
  section:    { gap: 6 },
  label:      { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#374151" },
  input:      { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, padding: 12, fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827" },
  optChip:    { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#fff" },
  optTxt:     { fontSize: 13, fontFamily: "Inter_500Medium", color: "#374151" },
  linkBtn:    { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#EDE9FE", borderRadius: 10, padding: 12 },
  linkBtnTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: P },
  btnRow:     { flexDirection: "row", gap: 10, justifyContent: "flex-end", marginTop: 4 },
  cancelBtn:  { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: "#F3F4F6" },
  cancelTxt:  { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#374151" },
  saveBtn:    { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: P },
  saveTxt:    { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
