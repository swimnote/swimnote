/**
 * (super)/support.tsx — 고객센터
 * 문의 유형·처리 상태·SLA·운영자 연결
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const P = "#7C3AED";

interface Ticket {
  id: string;
  ticket_type: string;
  requester_type: string;
  requester_name: string | null;
  pool_id: string | null;
  pool_name: string | null;
  subject: string;
  description: string | null;
  status: string;
  assignee: string | null;
  sla_hours: number;
  created_at: string;
  resolved_at: string | null;
}

const TYPE_CFG: Record<string, { label: string; color: string; bg: string; icon: React.ComponentProps<typeof Feather>["name"] }> = {
  refund:    { label: "환불",   color: "#DC2626", bg: "#FEE2E2", icon: "rotate-ccw" },
  payment:   { label: "결제",   color: "#0891B2", bg: "#ECFEFF", icon: "credit-card" },
  deletion:  { label: "삭제",   color: "#D97706", bg: "#FEF3C7", icon: "trash-2" },
  policy:    { label: "정책",   color: "#4F46E5", bg: "#EEF2FF", icon: "file-text" },
  technical: { label: "기술",   color: P,         bg: "#EDE9FE", icon: "tool" },
  other:     { label: "기타",   color: "#6B7280", bg: "#F3F4F6", icon: "help-circle" },
};

const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  open:        { label: "미처리",  color: "#DC2626", bg: "#FEE2E2" },
  in_progress: { label: "처리 중", color: "#D97706", bg: "#FEF3C7" },
  resolved:    { label: "해결됨",  color: "#059669", bg: "#D1FAE5" },
  closed:      { label: "종결",    color: "#6B7280", bg: "#F3F4F6" },
};

const REQUESTER_CFG: Record<string, { label: string; color: string }> = {
  operator: { label: "운영자",  color: P },
  teacher:  { label: "선생님",  color: "#059669" },
  parent:   { label: "학부모",  color: "#0891B2" },
};

const TICKET_TYPES = Object.keys(TYPE_CFG);
const STATUS_KEYS  = Object.keys(STATUS_CFG);

function safeDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function isSlaOverdue(ticket: Ticket): boolean {
  const d = safeDate(ticket.created_at);
  if (!d || ticket.status === "resolved" || ticket.status === "closed") return false;
  return Date.now() - d.getTime() > ticket.sla_hours * 3600000;
}

function fmtDate(iso: string | null | undefined): string {
  const d = safeDate(iso);
  if (!d) return "—";
  const diff = Date.now() - d.getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "방금";
  if (h < 24) return `${h}시간 전`;
  return d.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

export default function SupportScreen() {
  const { token } = useAuth();
  const [tickets,    setTickets]    = useState<Ticket[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterType,   setFilterType]   = useState("all");
  const [editTicket, setEditTicket]  = useState<Ticket | null>(null);
  const [newStatus,  setNewStatus]   = useState("in_progress");
  const [assignee,   setAssignee]    = useState("");
  const [saving,     setSaving]      = useState(false);
  const [createModal,setCreateModal] = useState(false);
  const [form,       setForm]        = useState({ ticket_type: "other", requester_type: "operator", requester_name: "", subject: "", description: "", sla_hours: "24" });
  const [creating,   setCreating]    = useState(false);

  async function fetch() {
    try {
      const params = new URLSearchParams();
      if (filterStatus !== "all") params.set("status", filterStatus);
      if (filterType !== "all")   params.set("ticket_type", filterType);
      const res = await apiRequest(token, `/super/support-tickets?${params}`);
      if (res.ok) setTickets(await res.json());
    } finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { fetch(); }, [filterStatus, filterType]);

  async function handleUpdate() {
    if (!editTicket) return;
    setSaving(true);
    await apiRequest(token, `/super/support-tickets/${editTicket.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus, assignee: assignee || null }),
    }).catch(() => {});
    setSaving(false); setEditTicket(null); fetch();
  }

  async function handleCreate() {
    if (!form.subject) return;
    setCreating(true);
    await apiRequest(token, "/super/support-tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, sla_hours: parseInt(form.sla_hours) || 24 }),
    }).catch(() => {});
    setCreating(false); setCreateModal(false);
    setForm({ ticket_type: "other", requester_type: "operator", requester_name: "", subject: "", description: "", sla_hours: "24" });
    fetch();
  }

  const counts: Record<string, number> = { all: tickets.length };
  STATUS_KEYS.forEach(k => { counts[k] = tickets.filter(t => t.status === k).length; });

  const renderItem = ({ item }: { item: Ticket }) => {
    const tc = TYPE_CFG[item.ticket_type] ?? TYPE_CFG.other;
    const sc = STATUS_CFG[item.status] ?? STATUS_CFG.open;
    const rc = REQUESTER_CFG[item.requester_type] ?? { label: item.requester_type, color: "#6B7280" };
    const overdue = isSlaOverdue(item);

    return (
      <Pressable style={[s.row, overdue && s.rowOverdue]} onPress={() => { setEditTicket(item); setNewStatus(item.status); setAssignee(item.assignee ?? ""); }}>
        <View style={[s.typeIcon, { backgroundColor: tc.bg }]}>
          <Feather name={tc.icon} size={15} color={tc.color} />
        </View>
        <View style={s.rowMain}>
          <View style={s.rowTop}>
            <Text style={s.subject} numberOfLines={1}>{item.subject}</Text>
            {overdue && <View style={s.slaTag}><Text style={s.slaTxt}>SLA 초과</Text></View>}
          </View>
          <View style={s.rowMeta}>
            <Text style={[s.metaTxt, { color: rc.color }]}>{rc.label}</Text>
            {item.requester_name && <Text style={s.metaDot}>·</Text>}
            {item.requester_name && <Text style={s.metaTxt}>{item.requester_name}</Text>}
            {item.pool_name && <><Text style={s.metaDot}>·</Text><Text style={s.metaTxt}>{item.pool_name}</Text></>}
            <Text style={s.metaDot}>·</Text>
            <Text style={s.metaTxt}>{fmtDate(item.created_at)}</Text>
          </View>
        </View>
        <View style={s.rowRight}>
          <View style={[s.badge, { backgroundColor: sc.bg }]}>
            <Text style={[s.badgeTxt, { color: sc.color }]}>{sc.label}</Text>
          </View>
          {item.assignee && <Text style={s.assigneeTxt}>{item.assignee}</Text>}
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="고객센터" homePath="/(super)/dashboard" />

      {/* 상태별 요약 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.summaryBar} contentContainerStyle={s.summaryContent}>
        {[{ k: "all", label: "전체" }, ...STATUS_KEYS.map(k => ({ k, label: STATUS_CFG[k].label }))].map(item => {
          const sc = STATUS_CFG[item.k] ?? { color: "#374151", bg: "#F3F4F6" };
          const isActive = filterStatus === item.k;
          return (
            <Pressable key={item.k} style={[s.summaryChip, { backgroundColor: isActive ? sc.color : "#F3F4F6" }]}
              onPress={() => setFilterStatus(item.k)}>
              <Text style={[s.summaryNum, { color: isActive ? "#fff" : "#374151" }]}>{counts[item.k] ?? 0}</Text>
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

      {loading ? (
        <ActivityIndicator color={P} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={tickets}
          keyExtractor={i => i.id}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={P}
            onRefresh={() => { setRefreshing(true); fetch(); }} />}
          contentContainerStyle={{ paddingVertical: 4, paddingBottom: 80 }}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#F3F4F6" }} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Feather name="message-circle" size={32} color="#D1D5DB" />
              <Text style={s.emptyTxt}>문의가 없습니다</Text>
            </View>
          }
        />
      )}

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
              {editTicket.description && <Text style={m.desc}>{editTicket.description}</Text>}

              <View style={m.infoBox}>
                <View style={m.infoRow}>
                  <Text style={m.infoLabel}>유형</Text>
                  <Text style={m.infoVal}>{TYPE_CFG[editTicket.ticket_type]?.label ?? editTicket.ticket_type}</Text>
                </View>
                <View style={m.infoRow}>
                  <Text style={m.infoLabel}>요청자</Text>
                  <Text style={m.infoVal}>{REQUESTER_CFG[editTicket.requester_type]?.label} {editTicket.requester_name ?? ""}</Text>
                </View>
                {editTicket.pool_name && (
                  <View style={m.infoRow}>
                    <Text style={m.infoLabel}>운영자</Text>
                    <Pressable onPress={() => { setEditTicket(null); router.push(`/(super)/operator-detail?id=${editTicket.pool_id}` as any); }}>
                      <Text style={[m.infoVal, { color: P, textDecorationLine: "underline" }]}>{editTicket.pool_name}</Text>
                    </Pressable>
                  </View>
                )}
                <View style={m.infoRow}>
                  <Text style={m.infoLabel}>SLA</Text>
                  <Text style={[m.infoVal, isSlaOverdue(editTicket) && { color: "#DC2626" }]}>
                    {editTicket.sla_hours}시간 {isSlaOverdue(editTicket) ? "· 초과됨" : ""}
                  </Text>
                </View>
              </View>

              <View style={m.section}>
                <Text style={m.label}>처리 상태</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {STATUS_KEYS.map(k => {
                    const sc = STATUS_CFG[k];
                    return (
                      <Pressable key={k} style={[m.optChip, newStatus === k && { backgroundColor: sc.color, borderColor: sc.color }]}
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

              {editTicket.ticket_type === "refund" && (
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
            <Pressable style={m.sheet} onPress={() => {}}>
              <View style={m.handle} />
              <Text style={m.title}>문의 등록</Text>

              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
                <View style={m.section}>
                  <Text style={m.label}>문의 유형</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                    {TICKET_TYPES.map(t => {
                      const tc = TYPE_CFG[t];
                      return (
                        <Pressable key={t} style={[m.optChip, form.ticket_type === t && { backgroundColor: tc.color, borderColor: tc.color }]}
                          onPress={() => setForm(f => ({ ...f, ticket_type: t }))}>
                          <Text style={[m.optTxt, form.ticket_type === t && { color: "#fff" }]}>{tc.label}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>

                <View style={m.section}>
                  <Text style={m.label}>요청자 유형</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                    {["operator", "teacher", "parent"].map(t => (
                      <Pressable key={t} style={[m.optChip, form.requester_type === t && { backgroundColor: P, borderColor: P }]}
                        onPress={() => setForm(f => ({ ...f, requester_type: t }))}>
                        <Text style={[m.optTxt, form.requester_type === t && { color: "#fff" }]}>
                          {REQUESTER_CFG[t]?.label ?? t}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>

                <View style={m.section}>
                  <Text style={m.label}>요청자 이름</Text>
                  <TextInput style={m.input} value={form.requester_name} onChangeText={v => setForm(f => ({ ...f, requester_name: v }))}
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

                <View style={m.section}>
                  <Text style={m.label}>SLA (시간)</Text>
                  <TextInput style={m.input} value={form.sla_hours} onChangeText={v => setForm(f => ({ ...f, sla_hours: v }))}
                    keyboardType="number-pad" placeholder="24" placeholderTextColor="#9CA3AF" />
                </View>

                <View style={m.btnRow}>
                  <Pressable style={m.cancelBtn} onPress={() => setCreateModal(false)}>
                    <Text style={m.cancelTxt}>취소</Text>
                  </Pressable>
                  <Pressable style={[m.saveBtn, { opacity: creating ? 0.6 : 1 }]} onPress={handleCreate} disabled={creating || !form.subject}>
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
  safe:         { flex: 1, backgroundColor: "#F5F3FF" },
  summaryBar:   { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", flexGrow: 0 },
  summaryContent:{ paddingHorizontal: 12, paddingVertical: 8, gap: 6, flexDirection: "row" },
  summaryChip:  { alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  summaryNum:   { fontSize: 17, fontFamily: "Inter_700Bold" },
  summaryLabel: { fontSize: 9, fontFamily: "Inter_500Medium", marginTop: 1 },
  typeBar:      { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", flexGrow: 0 },
  typeContent:  { paddingHorizontal: 12, paddingVertical: 7, gap: 6, flexDirection: "row" },
  typeChip:     { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6,
                  borderRadius: 20, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#fff" },
  typeChipActive:{ backgroundColor: P, borderColor: P },
  typeChipTxt:  { fontSize: 12, fontFamily: "Inter_500Medium", color: "#6B7280" },
  row:          { flexDirection: "row", alignItems: "center", gap: 10,
                  paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#fff" },
  rowOverdue:   { borderLeftWidth: 3, borderLeftColor: "#DC2626" },
  typeIcon:     { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  rowMain:      { flex: 1, gap: 4 },
  rowTop:       { flexDirection: "row", alignItems: "center", gap: 6 },
  subject:      { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#111827" },
  slaTag:       { backgroundColor: "#FEE2E2", paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5 },
  slaTxt:       { fontSize: 9, fontFamily: "Inter_700Bold", color: "#DC2626" },
  rowMeta:      { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" },
  metaTxt:      { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  metaDot:      { fontSize: 10, color: "#D1D5DB" },
  rowRight:     { alignItems: "flex-end", gap: 4 },
  badge:        { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  badgeTxt:     { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  assigneeTxt:  { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  empty:        { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyTxt:     { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  fab:          { position: "absolute", bottom: 20, right: 16, width: 52, height: 52,
                  borderRadius: 26, backgroundColor: P, alignItems: "center", justifyContent: "center",
                  shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 5 },
});

const m = StyleSheet.create({
  backdrop:  { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:     { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
               borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40,
               maxHeight: "88%", gap: 12 },
  handle:    { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  title:     { fontSize: 17, fontFamily: "Inter_700Bold", color: "#111827" },
  desc:      { fontSize: 13, fontFamily: "Inter_400Regular", color: "#374151", lineHeight: 20 },
  infoBox:   { backgroundColor: "#F9FAFB", borderRadius: 10, padding: 12, gap: 6 },
  infoRow:   { flexDirection: "row", gap: 8 },
  infoLabel: { width: 50, fontSize: 12, fontFamily: "Inter_500Medium", color: "#9CA3AF" },
  infoVal:   { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: "#374151" },
  section:   { gap: 6 },
  label:     { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#374151" },
  input:     { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, padding: 12,
               fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827" },
  optChip:   { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
               borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#fff" },
  optTxt:    { fontSize: 13, fontFamily: "Inter_500Medium", color: "#374151" },
  linkBtn:   { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#EDE9FE",
               borderRadius: 10, padding: 12 },
  linkBtnTxt:{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: P },
  btnRow:    { flexDirection: "row", gap: 10, justifyContent: "flex-end", marginTop: 4 },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: "#F3F4F6" },
  cancelTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#374151" },
  saveBtn:   { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: P },
  saveTxt:   { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
