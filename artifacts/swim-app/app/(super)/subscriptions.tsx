/**
 * (super)/subscriptions.tsx — 구독·결제 관리
 * operatorsStore + subscriptionStore — API 호출 없음
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
import { useOperatorsStore } from "@/store/operatorsStore";
import { useSubscriptionStore } from "@/store/subscriptionStore";
import { useAuditLogStore } from "@/store/auditLogStore";
import type { Operator } from "@/domain/types";

const P = "#0891B2";

const TABS = [
  { key: "all",        label: "전체" },
  { key: "failed",     label: "결제 실패" },
  { key: "refund",     label: "환불 요청" },
  { key: "chargeback", label: "차지백" },
  { key: "readonly",   label: "읽기전용" },
  { key: "deletion",   label: "삭제 예정" },
];

const BILLING_STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  active:                { label: "구독 중",    color: "#059669", bg: "#D1FAE5" },
  payment_failed:        { label: "결제 실패",  color: "#DC2626", bg: "#FEE2E2" },
  grace:                 { label: "유예 중",    color: "#D97706", bg: "#FEF3C7" },
  cancelled:             { label: "해지",       color: "#6B7280", bg: "#F3F4F6" },
  auto_delete_scheduled: { label: "삭제 예정",  color: "#DC2626", bg: "#FEE2E2" },
  readonly:              { label: "읽기전용",   color: "#0284C7", bg: "#E0F2FE" },
  free:                  { label: "무료 체험",  color: "#0891B2", bg: "#ECFEFF" },
};

const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  pending:    { label: "승인 대기", color: "#D97706", bg: "#FEF3C7" },
  active:     { label: "운영",     color: "#059669", bg: "#D1FAE5" },
  rejected:   { label: "반려",     color: "#DC2626", bg: "#FEE2E2" },
  cancelled:  { label: "해지",     color: "#6B7280", bg: "#F3F4F6" },
  readonly:   { label: "읽기전용", color: "#7C3AED", bg: "#EDE9FE" },
  restricted: { label: "제한",     color: "#DC2626", bg: "#FEE2E2" },
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
  if (h < 0) return "삭제 예정 초과";
  if (h < 1) return "1시간 미만";
  return `${h}h 후 삭제`;
}

export default function SubscriptionsScreen() {
  const { adminUser } = useAuth();
  const actorName = adminUser?.name ?? '슈퍼관리자';

  const [tab, setTab]                 = useState("all");
  const [refreshing, setRefreshing]   = useState(false);
  const [editOp, setEditOp]           = useState<Operator | null>(null);
  const [newCredit, setNewCredit]     = useState("");
  const [newEndDate, setNewEndDate]   = useState("");
  const [newStatus, setNewStatus]     = useState("");
  const [saving, setSaving]           = useState(false);

  const operators       = useOperatorsStore(s => s.operators);
  const applyCredit     = useSubscriptionStore(s => s.applyCredit);
  const billingRecords  = useSubscriptionStore(s => s.billingRecords);
  const approveOp       = useOperatorsStore(s => s.approveOperator);
  const scheduleDelete  = useOperatorsStore(s => s.scheduleAutoDelete);
  const updateOpField   = useOperatorsStore(s => s.updateOperatorField);
  const createLog       = useAuditLogStore(s => s.createLog);

  // Refund/chargeback from billing records
  const refundOpIds    = useMemo(() => new Set(billingRecords.filter(r => r.action === 'refund' || r.status === 'refund_requested').map(r => r.operatorId)), [billingRecords]);
  const chargebackOpIds = useMemo(() => new Set(billingRecords.filter(r => r.action === 'chargeback' || r.status === 'chargeback').map(r => r.operatorId)), [billingRecords]);

  const filtered = useMemo(() => {
    switch (tab) {
      case "failed":     return operators.filter(o => o.billingStatus === 'payment_failed' || o.billingStatus === 'grace');
      case "refund":     return operators.filter(o => refundOpIds.has(o.id));
      case "chargeback": return operators.filter(o => chargebackOpIds.has(o.id));
      case "readonly":   return operators.filter(o => o.status === 'readonly');
      case "deletion":   return operators.filter(o => !!o.autoDeleteScheduledAt);
      default:           return operators;
    }
  }, [tab, operators, refundOpIds, chargebackOpIds]);

  const counts = useMemo(() => ({
    all:        operators.length,
    failed:     operators.filter(o => o.billingStatus === 'payment_failed' || o.billingStatus === 'grace').length,
    refund:     operators.filter(o => refundOpIds.has(o.id)).length,
    chargeback: operators.filter(o => chargebackOpIds.has(o.id)).length,
    readonly:   operators.filter(o => o.status === 'readonly').length,
    deletion:   operators.filter(o => !!o.autoDeleteScheduledAt).length,
  }), [operators, refundOpIds, chargebackOpIds]);

  function handleRetry(op: Operator) {
    const updatedOp = { ...op, billingStatus: 'active' as any };
    updateOpField(op.id, { billingStatus: 'active' });
    createLog({ category: '결제', title: `${op.name} 결제 재시도 승인`, operatorId: op.id, operatorName: op.name, actorName, impact: 'medium', detail: '결제 재시도 수동 처리' });
  }

  function handleDeferDeletion(op: Operator) {
    const at = new Date(Date.now() + 48 * 3600000).toISOString();
    scheduleDelete(op.id, at);
    createLog({ category: '삭제', title: `${op.name} 삭제 48h 유예`, operatorId: op.id, operatorName: op.name, actorName, impact: 'high', detail: '자동삭제 유예 48시간 연장' });
  }

  function handleSave() {
    if (!editOp) return;
    setSaving(true);
    try {
      const updates: Partial<Operator> = {};
      if (newStatus)  updates.billingStatus = newStatus as any;
      if (newEndDate) updates.subscriptionEndAt = new Date(newEndDate).toISOString();
      if (newCredit)  updates.creditBalance = Number(newCredit);
      updateOpField(editOp.id, updates);
      if (newCredit) {
        applyCredit(editOp.id, editOp.name, Number(newCredit), '관리자 수동 지급');
        createLog({ category: '결제', title: `${editOp.name} 크레딧 지급`, operatorId: editOp.id, operatorName: editOp.name, actorName, impact: 'medium', detail: `${Number(newCredit).toLocaleString()}원 크레딧` });
      }
      setEditOp(null);
    } finally { setSaving(false); }
  }

  const renderItem = ({ item }: { item: Operator }) => {
    const bCfg = BILLING_STATUS_CFG[item.billingStatus] ?? { label: item.billingStatus, color: "#6B7280", bg: "#F3F4F6" };
    const isFailed = item.billingStatus === 'payment_failed' || item.billingStatus === 'grace';
    const isDeletion = !!item.autoDeleteScheduledAt;

    return (
      <Pressable style={[s.row, isFailed && s.rowAlert]}
        onPress={() => {
          setEditOp(item);
          setNewStatus(item.billingStatus ?? "");
          setNewEndDate(item.subscriptionEndAt ? fmtDateFull(item.subscriptionEndAt) : "");
          setNewCredit(item.creditBalance?.toString() ?? "0");
        }}>
        <View style={s.rowMain}>
          <View style={s.rowTop}>
            <Text style={s.opName} numberOfLines={1}>{item.name}</Text>
            <View style={[s.badge, { backgroundColor: bCfg.bg }]}>
              <Text style={[s.badgeTxt, { color: bCfg.color }]}>{bCfg.label}</Text>
            </View>
            {refundOpIds.has(item.id) && (
              <View style={[s.badge, { backgroundColor: "#F3E8FF" }]}>
                <Text style={[s.badgeTxt, { color: "#9333EA" }]}>환불</Text>
              </View>
            )}
            {chargebackOpIds.has(item.id) && (
              <View style={[s.badge, { backgroundColor: "#FEE2E2" }]}>
                <Text style={[s.badgeTxt, { color: "#991B1B" }]}>차지백</Text>
              </View>
            )}
          </View>
          <View style={s.rowMeta}>
            <Text style={s.metaTxt}>{item.representativeName}</Text>
            <Text style={s.metaDot}>·</Text>
            <Text style={s.metaTxt}>종료: {fmtDate(item.subscriptionEndAt)}</Text>
            {(item.creditBalance ?? 0) > 0 && (
              <><Text style={s.metaDot}>·</Text>
                <Text style={[s.metaTxt, { color: "#059669" }]}>크레딧 {item.creditBalance?.toLocaleString()}원</Text>
              </>
            )}
            <Text style={s.metaDot}>·</Text>
            <Text style={s.metaTxt}>{item.activeMemberCount}명</Text>
          </View>
          {isDeletion && (
            <Text style={s.deletionWarn}>{hoursLeft(item.autoDeleteScheduledAt)}</Text>
          )}
        </View>
        <View style={s.rowActions}>
          {isFailed && (
            <Pressable style={[s.actionBtn, { backgroundColor: "#D1FAE5" }]} onPress={() => handleRetry(item)}>
              <Text style={[s.actionTxt, { color: "#059669" }]}>재시도</Text>
            </Pressable>
          )}
          {isDeletion && (
            <Pressable style={[s.actionBtn, { backgroundColor: "#FEF3C7" }]} onPress={() => handleDeferDeletion(item)}>
              <Text style={[s.actionTxt, { color: "#D97706" }]}>유예</Text>
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
          const count = counts[t.key as keyof typeof counts] ?? 0;
          return (
            <Pressable key={t.key}
              style={[s.summaryChip, isActive && s.summaryChipActive]}
              onPress={() => setTab(t.key)}>
              {count > 0 && !isActive && t.key !== "all" && <View style={s.alertDot} />}
              <Text style={[s.summaryNum, isActive && { color: "#fff" }]}>{count}</Text>
              <Text style={[s.summaryLabel, isActive && { color: "rgba(255,255,255,0.8)" }]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {tab === "failed" && (
        <View style={s.bannerRow}>
          <Feather name="alert-triangle" size={13} color="#DC2626" />
          <Text style={s.bannerTxt}>결제 실패 운영자는 자동으로 읽기전용 전환 후 30일 내 삭제됩니다</Text>
        </View>
      )}
      {tab === "deletion" && (
        <View style={[s.bannerRow, { backgroundColor: "#FEF3C7" }]}>
          <Feather name="clock" size={13} color="#D97706" />
          <Text style={[s.bannerTxt, { color: "#92400E" }]}>자동삭제 예정 운영자입니다. 유예 버튼으로 48시간 연장 가능합니다</Text>
        </View>
      )}
      {tab === "chargeback" && (
        <View style={[s.bannerRow, { backgroundColor: "#FEE2E2" }]}>
          <Feather name="alert-octagon" size={13} color="#DC2626" />
          <Text style={[s.bannerTxt, { color: "#7F1D1D" }]}>차지백·분쟁 발생 운영자입니다. 운영자 상세에서 제한 조치를 권고합니다</Text>
        </View>
      )}

      <FlatList
        data={filtered}
        keyExtractor={i => i.id}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={P}
          onRefresh={() => { setRefreshing(true); setTimeout(() => setRefreshing(false), 400); }} />}
        contentContainerStyle={{ paddingBottom: 80 }}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#F3F4F6" }} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <Feather name="credit-card" size={30} color="#D1D5DB" />
            <Text style={s.emptyTxt}>{TABS.find(t => t.key === tab)?.label} 운영자가 없습니다</Text>
          </View>
        }
      />

      {/* 수정 모달 */}
      {editOp && (
        <Modal visible animationType="slide" transparent statusBarTranslucent onRequestClose={() => setEditOp(null)}>
          <Pressable style={m.backdrop} onPress={() => setEditOp(null)}>
            <Pressable style={m.sheet} onPress={() => {}}>
              <View style={m.handle} />
              <Text style={m.title}>{editOp.name}</Text>
              <Text style={m.sub}>
                {editOp.representativeName} · 현재: {BILLING_STATUS_CFG[editOp.billingStatus]?.label ?? editOp.billingStatus}
              </Text>

              <View style={m.section}>
                <Text style={m.label}>결제 상태 변경</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {Object.keys(BILLING_STATUS_CFG).map(k => {
                    const sc = BILLING_STATUS_CFG[k];
                    return (
                      <Pressable key={k}
                        style={[m.chip, newStatus === k && { backgroundColor: sc.color, borderColor: sc.color }]}
                        onPress={() => setNewStatus(k)}>
                        <Text style={[m.chipTxt, newStatus === k && { color: "#fff" }]}>{sc.label}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              <View style={m.section}>
                <Text style={m.label}>구독 종료일 (YYYY-MM-DD)</Text>
                <TextInput style={m.input} value={newEndDate} onChangeText={setNewEndDate}
                  placeholder="2026-12-31" placeholderTextColor="#9CA3AF" />
              </View>

              <View style={m.section}>
                <Text style={m.label}>크레딧 지급 (원)</Text>
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
  safe:          { flex: 1, backgroundColor: "#F0FDFE" },
  summaryBar:    { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", flexGrow: 0 },
  summaryContent:{ paddingHorizontal: 12, paddingVertical: 8, gap: 6, flexDirection: "row" },
  summaryChip:   { alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: "#F3F4F6", position: "relative" },
  summaryChipActive:{ backgroundColor: P },
  alertDot:      { position: "absolute", top: 4, right: 4, width: 6, height: 6, borderRadius: 3, backgroundColor: "#DC2626" },
  summaryNum:    { fontSize: 17, fontFamily: "Inter_700Bold", color: "#374151" },
  summaryLabel:  { fontSize: 9, fontFamily: "Inter_500Medium", color: "#9CA3AF", marginTop: 1 },
  bannerRow:     { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FEE2E2", paddingHorizontal: 14, paddingVertical: 9 },
  bannerTxt:     { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", color: "#7F1D1D", lineHeight: 16 },
  row:           { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#fff" },
  rowAlert:      { borderLeftWidth: 3, borderLeftColor: "#DC2626" },
  rowMain:       { flex: 1, gap: 3 },
  rowTop:        { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  opName:        { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#111827" },
  badge:         { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  badgeTxt:      { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  rowMeta:       { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4 },
  metaTxt:       { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  metaDot:       { fontSize: 10, color: "#D1D5DB" },
  deletionWarn:  { fontSize: 11, fontFamily: "Inter_700Bold", color: "#DC2626" },
  rowActions:    { flexDirection: "row", gap: 6 },
  actionBtn:     { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, minWidth: 36, alignItems: "center" },
  actionTxt:     { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  empty:         { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyTxt:      { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
});

const m = StyleSheet.create({
  backdrop:  { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:     { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, maxHeight: "85%", gap: 12 },
  handle:    { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  title:     { fontSize: 17, fontFamily: "Inter_700Bold", color: "#111827" },
  sub:       { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: -6 },
  section:   { gap: 6 },
  label:     { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#374151" },
  chip:      { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: "#E5E7EB" },
  chipTxt:   { fontSize: 12, fontFamily: "Inter_500Medium", color: "#374151" },
  input:     { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, padding: 12, fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827" },
  linkRow:   { flexDirection: "row" },
  linkBtn:   { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#E0F2FE", borderRadius: 10, padding: 12, flex: 1 },
  linkTxt:   { fontSize: 13, fontFamily: "Inter_600SemiBold", color: P },
  btnRow:    { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: "#F3F4F6" },
  cancelTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#374151" },
  saveBtn:   { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: P },
  saveTxt:   { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
