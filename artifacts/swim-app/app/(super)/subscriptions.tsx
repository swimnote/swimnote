/**
 * (super)/subscriptions.tsx — 구독·결제 관리
 * 실 API 기반: GET /super/operators, GET /billing/revenue-logs
 */
import { Clock, CreditCard, Eye, Lock, OctagonAlert, TriangleAlert, User } from "lucide-react-native";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { OtpGateModal } from "@/components/common/OtpGateModal";
import { billingEnabled } from "@/config/billing";

const P = "#2EC4B6";

const TABS = [
  { key: "all",        label: "전체" },
  { key: "failed",     label: "결제 실패" },
  { key: "refund",     label: "환불 요청" },
  { key: "chargeback", label: "차지백" },
  { key: "readonly",   label: "읽기전용" },
  { key: "deletion",   label: "삭제 예정" },
];

const TIER_NAME: Record<string, string> = {
  free:        "무료",
  starter:     "Coach30",
  basic:       "Coach50",
  standard:    "Coach100",
  center_200:  "Premier200",
  advance:     "Premier300",
  center_300:  "Premier300",
  pro:         "Premier 500",
  center_500:  "Premier 500",
  max:         "Premier 1000",
  center_1000: "Premier 1000",
};

const SUB_STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  active:      { label: "구독 중",   color: "#2EC4B6", bg: "#E6FFFA" },
  trial:       { label: "무료 체험", color: "#2EC4B6", bg: "#ECFEFF" },
  expired:     { label: "결제 실패", color: "#D96C6C", bg: "#F9DEDA" },
  suspended:   { label: "결제 실패", color: "#D96C6C", bg: "#F9DEDA" },
  cancelled:   { label: "해지",      color: "#64748B", bg: "#FFFFFF" },
  readonly:    { label: "읽기전용",  color: "#0284C7", bg: "#E0F2FE" },
  deletion:    { label: "삭제 예정", color: "#D96C6C", bg: "#F9DEDA" },
};

const SUB_STATUS_KEYS = ["active", "trial", "expired", "suspended", "cancelled"];

interface PoolRow {
  id: string;
  name: string;
  owner_name: string;
  approval_status: string;
  subscription_status: string;
  subscription_tier: string;
  credit_balance: number;
  active_member_count: number;
  usage_pct: number;
  is_readonly: boolean;
  deletion_pending: boolean;
  next_billing_at: string | null;
}

function displayStatus(row: PoolRow): string {
  if (row.deletion_pending) return "deletion";
  if (row.is_readonly)      return "readonly";
  return row.subscription_status ?? "active";
}

function isFailed(row: PoolRow): boolean {
  return ["expired", "suspended"].includes(row.subscription_status);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

function hoursLeft(row: PoolRow): string {
  if (!row.next_billing_at) return "—";
  const d = new Date(row.next_billing_at);
  if (isNaN(d.getTime())) return "—";
  const h = Math.floor((d.getTime() - Date.now()) / 3600000);
  if (h < 0) return "삭제 초과";
  if (h < 1) return "1시간 미만";
  return `${h}h 후 삭제`;
}

export default function SubscriptionsScreen() {
  if (!billingEnabled) return null;
  const { token } = useAuth();

  const [operators, setOperators]       = useState<PoolRow[]>([]);
  const [refundIds, setRefundIds]       = useState<Set<string>>(new Set());
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);
  const [tab, setTab]                   = useState("all");

  const [editOp, setEditOp]             = useState<PoolRow | null>(null);
  const [newCredit, setNewCredit]       = useState("");
  const [newStatus, setNewStatus]       = useState("");
  const [saving, setSaving]             = useState(false);
  const [otpVisible, setOtpVisible]     = useState(false);
  const pendingActionRef                = useRef<"save" | "retry" | "defer" | null>(null);
  const actionTargetRef                 = useRef<PoolRow | null>(null);

  const fetchData = useCallback(async () => {
    if (!token) return;
    try {
      const [opsRes, revRes] = await Promise.all([
        apiRequest(token, "/super/operators"),
        apiRequest(token, "/billing/revenue-logs?limit=500"),
      ]);
      if (opsRes.ok) {
        const data: PoolRow[] = await opsRes.json();
        setOperators(data);
      }
      if (revRes.ok) {
        const revData = await revRes.json();
        const logs: any[] = revData?.logs ?? [];
        const ids = new Set(
          logs
            .filter((l: any) => l.event_type === "refund" || Number(l.refunded_amount ?? 0) !== 0)
            .map((l: any) => l.pool_id as string)
        );
        setRefundIds(ids);
      }
    } catch (_) {
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  const filtered = useMemo(() => {
    switch (tab) {
      case "failed":     return operators.filter(o => isFailed(o));
      case "refund":     return operators.filter(o => refundIds.has(o.id));
      case "chargeback": return [];
      case "readonly":   return operators.filter(o => o.is_readonly);
      case "deletion":   return operators.filter(o => o.deletion_pending);
      default:           return operators;
    }
  }, [tab, operators, refundIds]);

  const counts = useMemo(() => ({
    all:        operators.length,
    failed:     operators.filter(isFailed).length,
    refund:     operators.filter(o => refundIds.has(o.id)).length,
    chargeback: 0,
    readonly:   operators.filter(o => o.is_readonly).length,
    deletion:   operators.filter(o => o.deletion_pending).length,
  }), [operators, refundIds]);

  async function handleRetry(op: PoolRow) {
    if (!token) return;
    try {
      await apiRequest(token, `/super/operators/${op.id}/subscription`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription_status: "active" }),
      });
      setOperators(prev => prev.map(o => o.id === op.id ? { ...o, subscription_status: "active" } : o));
    } catch (_) {}
  }

  async function handleDeferDeletion(op: PoolRow) {
    if (!token) return;
    try {
      await apiRequest(token, `/super/operators/${op.id}/defer-deletion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hours: 48 }),
      });
      setOperators(prev => prev.map(o => o.id === op.id ? { ...o, deletion_pending: false } : o));
    } catch (_) {}
  }

  async function handleSave() {
    if (!editOp || !token) return;
    setSaving(true);
    try {
      const body: Record<string, any> = {};
      if (newStatus)  body.subscription_status = newStatus;
      if (newCredit !== "") body.credit_amount = Number(newCredit);
      if (Object.keys(body).length > 0) {
        await apiRequest(token, `/super/operators/${editOp.id}/subscription`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        setOperators(prev => prev.map(o => {
          if (o.id !== editOp.id) return o;
          return {
            ...o,
            ...(newStatus ? { subscription_status: newStatus } : {}),
            ...(newCredit !== "" ? { credit_balance: Number(newCredit) } : {}),
          };
        }));
      }
      setEditOp(null);
    } catch (_) {
    } finally {
      setSaving(false);
    }
  }

  function openEdit(op: PoolRow) {
    setEditOp(op);
    setNewStatus(op.subscription_status ?? "");
    setNewCredit(op.credit_balance?.toString() ?? "0");
  }

  function triggerAction(action: "save" | "retry" | "defer", op: PoolRow) {
    pendingActionRef.current = action;
    actionTargetRef.current = op;
    setOtpVisible(true);
  }

  async function onOtpSuccess() {
    setOtpVisible(false);
    const action = pendingActionRef.current;
    const op = actionTargetRef.current;
    if (!op) return;
    if (action === "save")  await handleSave();
    if (action === "retry") await handleRetry(op);
    if (action === "defer") await handleDeferDeletion(op);
  }

  const renderItem = ({ item }: { item: PoolRow }) => {
    const status = displayStatus(item);
    const cfg = SUB_STATUS_CFG[status] ?? { label: status, color: "#64748B", bg: "#FFFFFF" };
    const failed = isFailed(item);

    return (
      <Pressable style={[s.row, failed && s.rowAlert]} onPress={() => openEdit(item)}>
        <View style={s.rowMain}>
          <View style={s.rowTop}>
            <Text style={s.opName} numberOfLines={1}>{item.name}</Text>
            <View style={[s.badge, { backgroundColor: cfg.bg }]}>
              <Text style={[s.badgeTxt, { color: cfg.color }]}>{cfg.label}</Text>
            </View>
            {refundIds.has(item.id) && (
              <View style={[s.badge, { backgroundColor: "#E6FAF8" }]}>
                <Text style={[s.badgeTxt, { color: "#9333EA" }]}>환불</Text>
              </View>
            )}
          </View>
          <View style={s.rowMeta}>
            <Text style={s.metaTxt}>{item.owner_name}</Text>
            <Text style={s.metaDot}>·</Text>
            <Text style={s.metaTxt}>플랜: {TIER_NAME[item.subscription_tier] ?? item.subscription_tier ?? "—"}</Text>
            {(item.credit_balance ?? 0) > 0 && (
              <><Text style={s.metaDot}>·</Text>
                <Text style={[s.metaTxt, { color: P }]}>크레딧 {item.credit_balance?.toLocaleString()}원</Text>
              </>
            )}
            <Text style={s.metaDot}>·</Text>
            <Text style={s.metaTxt}>{item.active_member_count}명</Text>
          </View>
          {item.deletion_pending && (
            <Text style={s.deletionWarn}>{hoursLeft(item)}</Text>
          )}
        </View>
        <View style={s.rowActions}>
          {failed && (
            <Pressable style={[s.actionBtn, { backgroundColor: "#E6FFFA" }]}
              onPress={() => triggerAction("retry", item)}>
              <Text style={[s.actionTxt, { color: P }]}>재시도</Text>
            </Pressable>
          )}
          {item.deletion_pending && (
            <Pressable style={[s.actionBtn, { backgroundColor: "#FFF1BF" }]}
              onPress={() => triggerAction("defer", item)}>
              <Text style={[s.actionTxt, { color: "#D97706" }]}>유예</Text>
            </Pressable>
          )}
          <Pressable style={[s.actionBtn, { backgroundColor: "#E0F2FE" }]}
            onPress={() => router.push(`/(super)/operator-detail?id=${item.id}&backTo=subscriptions` as any)}>
            <Eye size={13} color="#0284C7" />
          </Pressable>
        </View>
      </Pressable>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <SubScreenHeader title="구독·결제 관리" homePath="/(super)/more" />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={P} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="구독·결제 관리" homePath="/(super)/more" />

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
          <TriangleAlert size={13} color="#D96C6C" />
          <Text style={s.bannerTxt}>결제 실패 운영자는 자동으로 읽기전용 전환 후 30일 내 삭제됩니다</Text>
        </View>
      )}
      {tab === "deletion" && (
        <View style={[s.bannerRow, { backgroundColor: "#FFF1BF" }]}>
          <Clock size={13} color="#D97706" />
          <Text style={[s.bannerTxt, { color: "#92400E" }]}>자동삭제 예정 운영자입니다. 유예 버튼으로 48시간 연장 가능합니다</Text>
        </View>
      )}
      {tab === "chargeback" && (
        <View style={[s.bannerRow, { backgroundColor: "#F9DEDA" }]}>
          <OctagonAlert size={13} color="#D96C6C" />
          <Text style={[s.bannerTxt, { color: "#7F1D1D" }]}>차지백·분쟁 발생 운영자입니다. 운영자 상세에서 제한 조치를 권고합니다</Text>
        </View>
      )}

      <FlatList
        data={filtered}
        keyExtractor={i => i.id}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={P} onRefresh={onRefresh} />}
        contentContainerStyle={{ paddingBottom: 80 }}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#FFFFFF" }} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <CreditCard size={30} color="#D1D5DB" />
            <Text style={s.emptyTxt}>{TABS.find(t => t.key === tab)?.label} 운영자가 없습니다</Text>
          </View>
        }
      />

      {editOp && (
        <Modal visible animationType="slide" transparent statusBarTranslucent onRequestClose={() => setEditOp(null)}>
          <Pressable style={m.backdrop} onPress={() => setEditOp(null)}>
            <Pressable style={m.sheet} onPress={() => {}}>
              <View style={m.handle} />
              <Text style={m.title}>{editOp.name}</Text>
              <Text style={m.sub}>
                {editOp.owner_name} · 현재: {SUB_STATUS_CFG[displayStatus(editOp)]?.label ?? editOp.subscription_status}
              </Text>

              <View style={m.section}>
                <Text style={m.label}>구독 상태 변경</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {SUB_STATUS_KEYS.map(k => {
                    const sc = SUB_STATUS_CFG[k];
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
                <Text style={m.label}>크레딧 지급 (원)</Text>
                <TextInput style={m.input} value={newCredit} onChangeText={setNewCredit}
                  keyboardType="numeric" placeholder="0" placeholderTextColor="#64748B" />
              </View>

              <View style={m.linkRow}>
                <Pressable style={m.linkBtn}
                  onPress={() => { setEditOp(null); router.push(`/(super)/operator-detail?id=${editOp.id}&backTo=subscriptions` as any); }}>
                  <User size={14} color={P} />
                  <Text style={m.linkTxt}>운영자 상세 전체 보기</Text>
                </Pressable>
              </View>

              <View style={m.btnRow}>
                <Pressable style={m.cancelBtn} onPress={() => setEditOp(null)}>
                  <Text style={m.cancelTxt}>취소</Text>
                </Pressable>
                <Pressable style={[m.saveBtn, { opacity: saving ? 0.6 : 1 }]}
                  onPress={() => triggerAction("save", editOp)} disabled={saving}>
                  {saving
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <><Lock size={13} color="#fff" /><Text style={m.saveTxt}>OTP 인증 후 저장</Text></>}
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      <OtpGateModal
        visible={otpVisible}
        token={token}
        title="구독 변경 OTP 인증"
        desc="구독 상태·크레딧 변경은 OTP 인증이 필요합니다."
        onSuccess={onOtpSuccess}
        onCancel={() => setOtpVisible(false)}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: "#F0FDFE" },
  summaryBar:       { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", flexGrow: 0 },
  summaryContent:   { paddingHorizontal: 12, paddingVertical: 8, gap: 6, flexDirection: "row" },
  summaryChip:      { alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: "#FFFFFF", position: "relative" },
  summaryChipActive:{ backgroundColor: P },
  alertDot:         { position: "absolute", top: 4, right: 4, width: 6, height: 6, borderRadius: 3, backgroundColor: "#D96C6C" },
  summaryNum:       { fontSize: 17, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  summaryLabel:     { fontSize: 9, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 1 },
  bannerRow:        { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#F9DEDA", paddingHorizontal: 14, paddingVertical: 9 },
  bannerTxt:        { flex: 1, fontSize: 11, fontFamily: "Pretendard-Regular", color: "#7F1D1D", lineHeight: 16 },
  row:              { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#fff" },
  rowAlert:         { borderLeftWidth: 3, borderLeftColor: "#D96C6C" },
  rowMain:          { flex: 1, gap: 3 },
  rowTop:           { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  opName:           { flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  badge:            { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  badgeTxt:         { fontSize: 10, fontFamily: "Pretendard-Regular" },
  rowMeta:          { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4 },
  metaTxt:          { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  metaDot:          { fontSize: 10, color: "#D1D5DB" },
  deletionWarn:     { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#D96C6C" },
  rowActions:       { flexDirection: "row", gap: 6 },
  actionBtn:        { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, minWidth: 36, alignItems: "center" },
  actionTxt:        { fontSize: 11, fontFamily: "Pretendard-Regular" },
  empty:            { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyTxt:         { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#64748B" },
});

const m = StyleSheet.create({
  backdrop:  { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:     { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, maxHeight: "85%", gap: 12 },
  handle:    { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  title:     { fontSize: 17, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  sub:       { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: -6 },
  section:   { gap: 6 },
  label:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  chip:      { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: "#E5E7EB" },
  chipTxt:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  input:     { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, padding: 12, fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  linkRow:   { flexDirection: "row" },
  linkBtn:   { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#E0F2FE", borderRadius: 10, padding: 12, flex: 1 },
  linkTxt:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: P },
  btnRow:    { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: "#FFFFFF" },
  cancelTxt: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  saveBtn:   { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: P },
  saveTxt:   { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
});
