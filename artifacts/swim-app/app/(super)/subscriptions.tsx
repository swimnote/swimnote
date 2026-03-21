/**
 * (super)/subscriptions.tsx — 구독·결제 관리
 * 탭: 전체 / 결제실패 큐 / 환불 요청 / 차지백·분쟁 / 읽기전용 / 24h 삭제
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

const P = "#0891B2";

const TABS = [
  { key: "all",       label: "전체" },
  { key: "failed",    label: "결제 실패", filter: ["expired", "suspended"] },
  { key: "refund",    label: "환불 요청", filter: ["refund_pending"] },
  { key: "chargeback",label: "차지백·분쟁", filter: ["chargeback"] },
  { key: "readonly",  label: "읽기전용", filter: ["readonly"] },
  { key: "deletion",  label: "24h 삭제", filter: ["deletion_pending"] },
];

const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  trial:          { label: "무료 체험",  color: "#0891B2", bg: "#ECFEFF" },
  active:         { label: "구독 중",    color: "#059669", bg: "#D1FAE5" },
  expired:        { label: "만료",       color: "#DC2626", bg: "#FEE2E2" },
  suspended:      { label: "정지",       color: "#D97706", bg: "#FEF3C7" },
  cancelled:      { label: "해지",       color: "#6B7280", bg: "#F3F4F6" },
  refund_pending: { label: "환불 요청",  color: "#9333EA", bg: "#F3E8FF" },
  chargeback:     { label: "차지백",     color: "#DC2626", bg: "#FEE2E2" },
  readonly:       { label: "읽기전용",   color: "#0284C7", bg: "#E0F2FE" },
  deletion_pending:{ label: "삭제 예정", color: "#DC2626", bg: "#FEE2E2" },
};

function safeDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(iso: string | null | undefined): string {
  const d = safeDate(iso);
  if (!d) return "—";
  return d.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

function fmtDateFull(iso: string | null | undefined): string {
  const d = safeDate(iso);
  if (!d) return "—";
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" });
}

function hoursLeft(iso: string | null | undefined): string {
  const d = safeDate(iso);
  if (!d) return "—";
  const h = Math.floor((d.getTime() - Date.now()) / 3600000);
  if (h < 0) return "만료됨";
  if (h < 1) return "1시간 미만";
  return `${h}h 후 삭제`;
}

export default function SubscriptionsScreen() {
  const { token } = useAuth();
  const [tab,        setTab]        = useState("all");
  const [operators,  setOperators]  = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editOp,     setEditOp]     = useState<any | null>(null);
  const [newStatus,  setNewStatus]  = useState("");
  const [newEndDate, setNewEndDate] = useState("");
  const [newCredit,  setNewCredit]  = useState("");
  const [saving,     setSaving]     = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  async function load() {
    try {
      const res = await apiRequest(token, "/super/operators?limit=200");
      if (res.ok) {
        const data = await res.json();
        setOperators(data.operators ?? []);
      }
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { load(); }, []);

  function filterByTab(items: any[]): any[] {
    const tabCfg = TABS.find(t => t.key === tab);
    if (!tabCfg?.filter) return items;
    return items.filter(op => tabCfg.filter!.includes(op.subscription_status));
  }

  const filtered = filterByTab(operators);

  const counts: Record<string, number> = {
    all:        operators.length,
    failed:     operators.filter(o => ["expired","suspended"].includes(o.subscription_status)).length,
    refund:     operators.filter(o => o.subscription_status === "refund_pending").length,
    chargeback: operators.filter(o => o.subscription_status === "chargeback").length,
    readonly:   operators.filter(o => o.subscription_status === "readonly").length,
    deletion:   operators.filter(o => {
      const d = safeDate(o.subscription_end_at);
      return d ? (d.getTime() - Date.now()) < 86400000 && d.getTime() > Date.now() : false;
    }).length,
  };

  async function quickApprove(id: string) {
    setActionLoading(id);
    await apiRequest(token, `/super/operators/${id}/approve`, { method: "PATCH" }).catch(() => {});
    setActionLoading(null); load();
  }

  async function deferDeletion(id: string) {
    setActionLoading(id);
    await apiRequest(token, `/super/operators/${id}/defer-deletion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hours: 48 }),
    }).catch(() => {});
    setActionLoading(null); load();
  }

  async function handleSave() {
    if (!editOp) return;
    setSaving(true);
    await apiRequest(token, `/super/operators/${editOp.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscription_status: newStatus || undefined,
        subscription_end_at: newEndDate || undefined,
        credit: newCredit ? Number(newCredit) : undefined,
      }),
    }).catch(() => {});
    setSaving(false); setEditOp(null); load();
  }

  const renderItem = ({ item }: { item: any }) => {
    const sc = STATUS_CFG[item.subscription_status] ?? { label: item.subscription_status, color: "#6B7280", bg: "#F3F4F6" };
    const isDeletion = tab === "deletion" || (() => {
      const d = safeDate(item.subscription_end_at);
      return d ? (d.getTime() - Date.now()) < 86400000 && d.getTime() > Date.now() : false;
    })();
    const isFailed = ["expired","suspended","chargeback"].includes(item.subscription_status);

    return (
      <Pressable style={[s.row, isFailed && s.rowAlert]}
        onPress={() => {
          setEditOp(item);
          setNewStatus(item.subscription_status ?? "");
          setNewEndDate(item.subscription_end_at ? fmtDateFull(item.subscription_end_at) : "");
          setNewCredit(item.credit?.toString() ?? "0");
        }}>
        <View style={s.rowMain}>
          <View style={s.rowTop}>
            <Text style={s.opName} numberOfLines={1}>{item.name}</Text>
            <View style={[s.badge, { backgroundColor: sc.bg }]}>
              <Text style={[s.badgeTxt, { color: sc.color }]}>{sc.label}</Text>
            </View>
          </View>
          <View style={s.rowMeta}>
            <Text style={s.metaTxt}>{item.owner_name}</Text>
            <Text style={s.metaDot}>·</Text>
            <Text style={s.metaTxt}>종료: {fmtDate(item.subscription_end_at)}</Text>
            {item.credit != null && item.credit > 0 && (
              <><Text style={s.metaDot}>·</Text>
              <Text style={[s.metaTxt, { color: "#059669" }]}>크레딧 {item.credit?.toLocaleString()}원</Text></>
            )}
            {item.member_count != null && (
              <><Text style={s.metaDot}>·</Text>
              <Text style={s.metaTxt}>회원 {item.member_count}명</Text></>
            )}
          </View>
          {isDeletion && (
            <Text style={s.deletionWarn}>{hoursLeft(item.subscription_end_at)}</Text>
          )}
        </View>
        <View style={s.rowActions}>
          {isFailed && (
            <Pressable style={[s.actionBtn, { backgroundColor: "#D1FAE5" }]}
              onPress={() => quickApprove(item.id)} disabled={actionLoading === item.id}>
              {actionLoading === item.id
                ? <ActivityIndicator size="small" color="#059669" />
                : <Text style={[s.actionTxt, { color: "#059669" }]}>재개</Text>}
            </Pressable>
          )}
          {isDeletion && (
            <Pressable style={[s.actionBtn, { backgroundColor: "#FEF3C7" }]}
              onPress={() => deferDeletion(item.id)} disabled={actionLoading === item.id}>
              {actionLoading === item.id
                ? <ActivityIndicator size="small" color="#D97706" />
                : <Text style={[s.actionTxt, { color: "#D97706" }]}>유예</Text>}
            </Pressable>
          )}
          <Pressable style={[s.actionBtn, { backgroundColor: "#E0F2FE" }]}
            onPress={() => router.push(`/(super)/operator-detail?id=${item.id}` as any)}>
            <Feather name="eye" size={13} color="#0284C7" />
          </Pressable>
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="구독·결제 관리" homePath="/(super)/dashboard" />

      {/* 상태 요약 칩 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.summaryBar} contentContainerStyle={s.summaryContent}>
        {TABS.map(t => {
          const isActive = tab === t.key;
          return (
            <Pressable key={t.key} style={[s.summaryChip, isActive && s.summaryChipActive]}
              onPress={() => setTab(t.key)}>
              {counts[t.key] > 0 && !isActive && t.key !== "all" && <View style={s.alertDot} />}
              <Text style={[s.summaryNum, isActive && { color: "#fff" }]}>{counts[t.key] ?? 0}</Text>
              <Text style={[s.summaryLabel, isActive && { color: "rgba(255,255,255,0.8)" }]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* 탭별 설명 */}
      {tab === "failed" && (
        <View style={s.bannerRow}>
          <Feather name="alert-triangle" size={13} color="#DC2626" />
          <Text style={s.bannerTxt}>결제 실패 운영자는 자동으로 읽기전용 전환 후 30일 내 삭제됩니다</Text>
        </View>
      )}
      {tab === "deletion" && (
        <View style={[s.bannerRow, { backgroundColor: "#FEF3C7" }]}>
          <Feather name="clock" size={13} color="#D97706" />
          <Text style={[s.bannerTxt, { color: "#92400E" }]}>24시간 내 자동 삭제 예정 운영자입니다. 유예 버튼으로 48시간 연장 가능합니다</Text>
        </View>
      )}
      {tab === "chargeback" && (
        <View style={[s.bannerRow, { backgroundColor: "#FEE2E2" }]}>
          <Feather name="alert-octagon" size={13} color="#DC2626" />
          <Text style={[s.bannerTxt, { color: "#7F1D1D" }]}>차지백·분쟁 발생 운영자입니다. 운영자 상세에서 제한 조치를 권고합니다</Text>
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={P} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={i => i.id}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={P}
            onRefresh={() => { setRefreshing(true); load(); }} />}
          contentContainerStyle={{ paddingBottom: 80 }}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#F3F4F6" }} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Feather name="credit-card" size={30} color="#D1D5DB" />
              <Text style={s.emptyTxt}>{TABS.find(t => t.key === tab)?.label} 운영자가 없습니다</Text>
            </View>
          }
        />
      )}

      {/* 수정 모달 */}
      {editOp && (
        <Modal visible animationType="slide" transparent statusBarTranslucent onRequestClose={() => setEditOp(null)}>
          <Pressable style={m.backdrop} onPress={() => setEditOp(null)}>
            <Pressable style={m.sheet} onPress={() => {}}>
              <View style={m.handle} />
              <Text style={m.title}>{editOp.name}</Text>
              <Text style={m.sub}>{editOp.owner_name} · 현재: {STATUS_CFG[editOp.subscription_status]?.label ?? editOp.subscription_status}</Text>

              <View style={m.section}>
                <Text style={m.label}>구독 상태</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {Object.keys(STATUS_CFG).map(k => {
                    const sc = STATUS_CFG[k];
                    return (
                      <Pressable key={k} style={[m.chip, newStatus === k && { backgroundColor: sc.color, borderColor: sc.color }]}
                        onPress={() => setNewStatus(k)}>
                        <Text style={[m.chipTxt, newStatus === k && { color: "#fff" }]}>{sc.label}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              <View style={m.section}>
                <Text style={m.label}>구독 종료일</Text>
                <TextInput style={m.input} value={newEndDate} onChangeText={setNewEndDate}
                  placeholder="YYYY-MM-DD" placeholderTextColor="#9CA3AF" />
              </View>

              <View style={m.section}>
                <Text style={m.label}>크레딧 (원)</Text>
                <TextInput style={m.input} value={newCredit} onChangeText={setNewCredit}
                  keyboardType="numeric" placeholder="0" placeholderTextColor="#9CA3AF" />
              </View>

              <View style={m.linkRow}>
                <Pressable style={m.linkBtn}
                  onPress={() => { setEditOp(null); router.push(`/(super)/operator-detail?id=${editOp.id}` as any); }}>
                  <Feather name="user" size={14} color={P} />
                  <Text style={m.linkTxt}>운영자 상세 전체 보기</Text>
                </Pressable>
              </View>

              <View style={m.btnRow}>
                <Pressable style={m.cancelBtn} onPress={() => setEditOp(null)}>
                  <Text style={m.cancelTxt}>취소</Text>
                </Pressable>
                <Pressable style={[m.saveBtn, { opacity: saving ? 0.6 : 1 }]} onPress={handleSave} disabled={saving}>
                  {saving ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={m.saveTxt}>저장</Text>}
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#F0FDFE" },
  summaryBar:   { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", flexGrow: 0 },
  summaryContent:{ paddingHorizontal: 12, paddingVertical: 8, gap: 6, flexDirection: "row" },
  summaryChip:  { alignItems: "center", paddingHorizontal: 10, paddingVertical: 6,
                  borderRadius: 10, backgroundColor: "#F3F4F6", position: "relative" },
  summaryChipActive:{ backgroundColor: P },
  alertDot:     { position: "absolute", top: 4, right: 4, width: 6, height: 6,
                  borderRadius: 3, backgroundColor: "#DC2626" },
  summaryNum:   { fontSize: 17, fontFamily: "Inter_700Bold", color: "#374151" },
  summaryLabel: { fontSize: 9, fontFamily: "Inter_500Medium", color: "#9CA3AF", marginTop: 1 },
  bannerRow:    { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FEE2E2",
                  paddingHorizontal: 14, paddingVertical: 9 },
  bannerTxt:    { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", color: "#7F1D1D", lineHeight: 16 },
  row:          { flexDirection: "row", alignItems: "center", gap: 10,
                  paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#fff" },
  rowAlert:     { borderLeftWidth: 3, borderLeftColor: "#DC2626" },
  rowMain:      { flex: 1, gap: 3 },
  rowTop:       { flexDirection: "row", alignItems: "center", gap: 8 },
  opName:       { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#111827" },
  badge:        { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  badgeTxt:     { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  rowMeta:      { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4 },
  metaTxt:      { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  metaDot:      { fontSize: 10, color: "#D1D5DB" },
  deletionWarn: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#DC2626" },
  rowActions:   { flexDirection: "row", gap: 6 },
  actionBtn:    { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, minWidth: 36, alignItems: "center" },
  actionTxt:    { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  empty:        { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyTxt:     { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
});

const m = StyleSheet.create({
  backdrop:  { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:     { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
               borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40,
               maxHeight: "85%", gap: 12 },
  handle:    { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  title:     { fontSize: 17, fontFamily: "Inter_700Bold", color: "#111827" },
  sub:       { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: -6 },
  section:   { gap: 6 },
  label:     { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#374151" },
  chip:      { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
               borderWidth: 1.5, borderColor: "#E5E7EB" },
  chipTxt:   { fontSize: 12, fontFamily: "Inter_500Medium", color: "#374151" },
  input:     { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, padding: 12,
               fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827" },
  linkRow:   { flexDirection: "row" },
  linkBtn:   { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#E0F2FE",
               borderRadius: 10, padding: 12, flex: 1 },
  linkTxt:   { fontSize: 13, fontFamily: "Inter_600SemiBold", color: P },
  btnRow:    { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: "#F3F4F6" },
  cancelTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#374151" },
  saveBtn:   { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: P },
  saveTxt:   { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
