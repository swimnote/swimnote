/**
 * (super)/sms-billing.tsx — SMS 과금·사용량 관리
 * 운영자별 월 SMS 발송 수 · 무료 제공 수 · 초과 과금 · 차단 여부 · 실패 수
 */
import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useOperatorsStore } from "@/store/operatorsStore";
import { useAuditLogStore } from "@/store/auditLogStore";
import { useAuth } from "@/context/AuthContext";

const P = "#7C3AED";
const WARN = "#D97706";
const DANGER = "#DC2626";

// SMS 과금 단가
const SMS_UNIT_PRICE = 9.9; // 원/건 (초과분)
const FREE_QUOTA = 500;     // 운영자당 월 무료 제공 건수

// 운영자별 mock SMS 데이터 (seed 운영자 ID에 맞춤)
const SMS_USAGE_SEED: Record<string, { sent: number; failed: number; blocked: boolean }> = {
  "op-001": { sent: 320,  failed: 2,  blocked: false },
  "op-002": { sent: 1240, failed: 15, blocked: false },
  "op-003": { sent: 501,  failed: 0,  blocked: false },
  "op-004": { sent: 88,   failed: 0,  blocked: false },
  "op-005": { sent: 0,    failed: 0,  blocked: false },
};

function getUsageForOp(id: string) {
  return SMS_USAGE_SEED[id] ?? { sent: Math.floor(Math.random() * 600), failed: 0, blocked: false };
}

type SortKey = "sent" | "excess" | "charge" | "name";

export default function SmsBillingScreen() {
  const { adminUser } = useAuth();
  const actorName  = adminUser?.name ?? '슈퍼관리자';
  const createLog  = useAuditLogStore(s => s.createLog);
  const operators  = useOperatorsStore(s => s.operators);

  const [sort,      setSort]      = useState<SortKey>("charge");
  const [detail,    setDetail]    = useState<string | null>(null);
  const [blockMap,  setBlockMap]  = useState<Record<string, boolean>>({});

  // 운영자별 SMS 사용량 집계
  const usageList = useMemo(() => operators.map(op => {
    const base    = getUsageForOp(op.id);
    const blocked = blockMap[op.id] ?? base.blocked;
    const excess  = Math.max(0, base.sent - FREE_QUOTA);
    const charge  = Math.round(excess * SMS_UNIT_PRICE);
    return { op, sent: base.sent, failed: base.failed, blocked, excess, charge };
  }), [operators, blockMap]);

  const sorted = useMemo(() => [...usageList].sort((a, b) => {
    if (sort === "sent")   return b.sent - a.sent;
    if (sort === "excess") return b.excess - a.excess;
    if (sort === "charge") return b.charge - a.charge;
    return a.op.name.localeCompare(b.op.name);
  }), [usageList, sort]);

  const totalSent    = useMemo(() => usageList.reduce((s, u) => s + u.sent, 0), [usageList]);
  const totalExcess  = useMemo(() => usageList.reduce((s, u) => s + u.excess, 0), [usageList]);
  const totalCharge  = useMemo(() => usageList.reduce((s, u) => s + u.charge, 0), [usageList]);
  const totalFailed  = useMemo(() => usageList.reduce((s, u) => s + u.failed, 0), [usageList]);
  const blockedCount = useMemo(() => usageList.filter(u => u.blocked).length, [usageList]);
  const unpaidCount  = useMemo(() => usageList.filter(u => u.charge > 0).length, [usageList]);

  function toggleBlock(opId: string, current: boolean) {
    const newVal = !current;
    setBlockMap(prev => ({ ...prev, [opId]: newVal }));
    const op = operators.find(o => o.id === opId);
    createLog({
      category: 'SMS과금',
      title: `SMS 발송 ${newVal ? '차단' : '차단해제'}: ${op?.name ?? opId}`,
      detail: `운영자 ${op?.name ?? opId} SMS 발송 ${newVal ? '차단' : '허용'} 처리`,
      actorName,
      impact: 'medium',
      operatorId: opId,
      operatorName: op?.name,
    });
  }

  const detailItem = detail ? sorted.find(u => u.op.id === detail) : null;

  const now = new Date();
  const monthLabel = `${now.getFullYear()}년 ${now.getMonth() + 1}월`;

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="SMS 과금·사용량" homePath="/(super)/op-group" />

      <ScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 60 }}>
        {/* 월 헤더 */}
        <View style={s.monthHeader}>
          <Feather name="calendar" size={14} color={P} />
          <Text style={s.monthLabel}>{monthLabel} 기준</Text>
          <Text style={s.freeQuotaLabel}>무료 제공 {FREE_QUOTA.toLocaleString()}건/운영자</Text>
        </View>

        {/* 전체 요약 카드 */}
        <View style={s.summaryGrid}>
          <View style={s.summaryCard}>
            <Text style={s.summaryNum}>{totalSent.toLocaleString()}</Text>
            <Text style={s.summaryLabel}>총 발송</Text>
          </View>
          <View style={[s.summaryCard, totalExcess > 0 && s.summaryWarn]}>
            <Text style={[s.summaryNum, totalExcess > 0 && { color: WARN }]}>{totalExcess.toLocaleString()}</Text>
            <Text style={s.summaryLabel}>초과 발송</Text>
          </View>
          <View style={[s.summaryCard, totalCharge > 0 && s.summaryWarn]}>
            <Text style={[s.summaryNum, totalCharge > 0 && { color: WARN }]}>₩{totalCharge.toLocaleString()}</Text>
            <Text style={s.summaryLabel}>예상 과금</Text>
          </View>
          <View style={[s.summaryCard, totalFailed > 0 && s.summaryDanger]}>
            <Text style={[s.summaryNum, totalFailed > 0 && { color: DANGER }]}>{totalFailed}</Text>
            <Text style={s.summaryLabel}>발송 실패</Text>
          </View>
          <View style={[s.summaryCard, unpaidCount > 0 && s.summaryWarn]}>
            <Text style={[s.summaryNum, unpaidCount > 0 && { color: WARN }]}>{unpaidCount}</Text>
            <Text style={s.summaryLabel}>미결제 운영자</Text>
          </View>
          <View style={[s.summaryCard, blockedCount > 0 && s.summaryDanger]}>
            <Text style={[s.summaryNum, blockedCount > 0 && { color: DANGER }]}>{blockedCount}</Text>
            <Text style={s.summaryLabel}>차단 운영자</Text>
          </View>
        </View>

        {/* 정렬 탭 */}
        <View style={s.sortRow}>
          <Text style={s.sortLabel}>정렬:</Text>
          {([["charge", "과금액"], ["excess", "초과건수"], ["sent", "발송수"], ["name", "이름"]] as [SortKey, string][]).map(([key, label]) => (
            <Pressable key={key} style={[s.sortBtn, sort === key && s.sortBtnActive]}
              onPress={() => setSort(key)}>
              <Text style={[s.sortBtnTxt, sort === key && s.sortBtnTxtActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {/* 운영자별 행 */}
        {sorted.map(({ op, sent, failed, blocked, excess, charge }) => (
          <Pressable key={op.id} style={[s.row, blocked && s.rowBlocked]}
            onPress={() => setDetail(op.id)}>
            <View style={{ flex: 1 }}>
              <View style={s.rowTop}>
                <Text style={s.rowName}>{op.name}</Text>
                {blocked && (
                  <View style={s.blockedBadge}>
                    <Text style={s.blockedTxt}>차단</Text>
                  </View>
                )}
                {excess > 0 && !blocked && (
                  <View style={s.excessBadge}>
                    <Text style={s.excessTxt}>초과</Text>
                  </View>
                )}
              </View>
              <View style={s.rowMetaRow}>
                <Text style={s.rowMeta}>발송 {sent.toLocaleString()}건</Text>
                <Text style={s.rowMetaDot}>·</Text>
                <Text style={[s.rowMeta, excess > 0 && { color: WARN }]}>초과 {excess}건</Text>
                <Text style={s.rowMetaDot}>·</Text>
                <Text style={[s.rowMeta, failed > 0 && { color: DANGER }]}>실패 {failed}건</Text>
              </View>
            </View>
            <View style={s.rowRight}>
              <Text style={[s.rowCharge, charge > 0 && { color: WARN }]}>
                {charge > 0 ? `₩${charge.toLocaleString()}` : "무료"}
              </Text>
              <Switch
                value={!blocked}
                onValueChange={() => toggleBlock(op.id, blocked)}
                trackColor={{ false: "#FCA5A5", true: "#D1FAE5" }}
                thumbColor={!blocked ? "#059669" : DANGER}
                style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
              />
            </View>
          </Pressable>
        ))}
      </ScrollView>

      {/* 운영자 상세 모달 */}
      {detailItem && (
        <Modal visible animationType="slide" transparent statusBarTranslucent
          onRequestClose={() => setDetail(null)}>
          <Pressable style={m.backdrop} onPress={() => setDetail(null)}>
            <Pressable style={m.sheet} onPress={() => {}}>
              <View style={m.handle} />
              <Text style={m.title}>{detailItem.op.name}</Text>
              <Text style={m.sub}>{detailItem.op.code} · {monthLabel}</Text>

              <View style={m.statGrid}>
                <View style={m.statItem}>
                  <Text style={m.statNum}>{detailItem.sent.toLocaleString()}</Text>
                  <Text style={m.statLabel}>총 발송</Text>
                </View>
                <View style={m.statItem}>
                  <Text style={m.statNum}>{FREE_QUOTA.toLocaleString()}</Text>
                  <Text style={m.statLabel}>무료 제공</Text>
                </View>
                <View style={[m.statItem, detailItem.excess > 0 && m.statWarn]}>
                  <Text style={[m.statNum, detailItem.excess > 0 && { color: WARN }]}>{detailItem.excess}</Text>
                  <Text style={m.statLabel}>초과 발송</Text>
                </View>
                <View style={[m.statItem, detailItem.charge > 0 && m.statWarn]}>
                  <Text style={[m.statNum, detailItem.charge > 0 && { color: WARN }]}>₩{detailItem.charge.toLocaleString()}</Text>
                  <Text style={m.statLabel}>예상 과금액</Text>
                </View>
                <View style={[m.statItem, detailItem.failed > 0 && m.statDanger]}>
                  <Text style={[m.statNum, detailItem.failed > 0 && { color: DANGER }]}>{detailItem.failed}</Text>
                  <Text style={m.statLabel}>발송 실패</Text>
                </View>
              </View>

              <View style={m.chargeInfo}>
                <Feather name="info" size={12} color="#6B7280" />
                <Text style={m.chargeInfoTxt}>초과 과금 단가: ₩{SMS_UNIT_PRICE}/건 · 무료 할당: {FREE_QUOTA}건/월</Text>
              </View>

              <View style={m.blockRow}>
                <Text style={m.blockLabel}>SMS 발송 {detailItem.blocked ? "차단됨" : "허용 중"}</Text>
                <Switch
                  value={!detailItem.blocked}
                  onValueChange={() => { toggleBlock(detailItem.op.id, detailItem.blocked); setDetail(null); }}
                  trackColor={{ false: "#FCA5A5", true: "#D1FAE5" }}
                  thumbColor={!detailItem.blocked ? "#059669" : DANGER}
                />
              </View>

              <Pressable style={m.closeBtn} onPress={() => setDetail(null)}>
                <Text style={m.closeTxt}>닫기</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#F5F3FF" },
  monthHeader:  { flexDirection: "row", alignItems: "center", gap: 8 },
  monthLabel:   { fontSize: 14, fontFamily: "Inter_700Bold", color: "#111827", flex: 1 },
  freeQuotaLabel:{ fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280" },
  summaryGrid:  { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  summaryCard:  { width: "30.5%", backgroundColor: "#fff", borderRadius: 12, padding: 10,
                  alignItems: "center", borderWidth: 1, borderColor: "#E5E7EB" },
  summaryWarn:  { borderColor: "#FDE68A", backgroundColor: "#FFFBEB" },
  summaryDanger:{ borderColor: "#FCA5A5", backgroundColor: "#FFF5F5" },
  summaryNum:   { fontSize: 16, fontFamily: "Inter_700Bold", color: "#111827" },
  summaryLabel: { fontSize: 9, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 3, textAlign: "center" },
  sortRow:      { flexDirection: "row", alignItems: "center", gap: 6 },
  sortLabel:    { fontSize: 12, fontFamily: "Inter_500Medium", color: "#6B7280" },
  sortBtn:      { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: "#F3F4F6" },
  sortBtnActive:{ backgroundColor: P },
  sortBtnTxt:   { fontSize: 11, fontFamily: "Inter_500Medium", color: "#6B7280" },
  sortBtnTxtActive:{ color: "#fff" },
  row:          { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff",
                  borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  rowBlocked:   { borderColor: "#FCA5A5", backgroundColor: "#FFF5F5" },
  rowTop:       { flexDirection: "row", alignItems: "center", gap: 6 },
  rowName:      { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#111827" },
  blockedBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, backgroundColor: "#FEE2E2" },
  blockedTxt:   { fontSize: 10, fontFamily: "Inter_700Bold", color: DANGER },
  excessBadge:  { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, backgroundColor: "#FEF3C7" },
  excessTxt:    { fontSize: 10, fontFamily: "Inter_700Bold", color: WARN },
  rowMetaRow:   { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  rowMeta:      { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280" },
  rowMetaDot:   { fontSize: 11, color: "#D1D5DB" },
  rowRight:     { alignItems: "flex-end", gap: 4 },
  rowCharge:    { fontSize: 13, fontFamily: "Inter_700Bold", color: "#059669" },
});

const m = StyleSheet.create({
  backdrop:    { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:       { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
                 borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, gap: 14 },
  handle:      { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  title:       { fontSize: 18, fontFamily: "Inter_700Bold", color: "#111827" },
  sub:         { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  statGrid:    { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statItem:    { flex: 1, minWidth: "28%", backgroundColor: "#F9FAFB", borderRadius: 10, padding: 10, alignItems: "center",
                 borderWidth: 1, borderColor: "#E5E7EB" },
  statWarn:    { borderColor: "#FDE68A", backgroundColor: "#FFFBEB" },
  statDanger:  { borderColor: "#FCA5A5", backgroundColor: "#FFF5F5" },
  statNum:     { fontSize: 18, fontFamily: "Inter_700Bold", color: "#111827" },
  statLabel:   { fontSize: 10, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 3, textAlign: "center" },
  chargeInfo:  { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#F3F4F6",
                 padding: 10, borderRadius: 8 },
  chargeInfoTxt:{ fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280", flex: 1 },
  blockRow:    { flexDirection: "row", alignItems: "center", gap: 10 },
  blockLabel:  { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#374151" },
  closeBtn:    { backgroundColor: "#F3F4F6", borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  closeTxt:    { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#374151" },
});
