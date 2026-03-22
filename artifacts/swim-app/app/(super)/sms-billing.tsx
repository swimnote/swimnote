/**
 * (super)/sms-billing.tsx — SMS 과금·사용량 관리
 * 운영자별 월 SMS 발송 수 · 무료 제공 수 · 초과 과금 · 차단 여부 · 실패 수
 * + 유형별 발송 수 (초대/인증/안내/경고) · 초과 허용 여부 · 미납 상태
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
const GREEN = "#059669";

const SMS_UNIT_PRICE = 9.9;
const FREE_QUOTA = 500;

interface SmsSeedEntry {
  sent: number;
  failed: number;
  blocked: boolean;
  allowExcess: boolean;
  unpaid: boolean;
  types: { invite: number; auth: number; notice: number; warning: number };
}

const SMS_USAGE_SEED: Record<string, SmsSeedEntry> = {
  "op-001": { sent: 320,  failed: 2,  blocked: false, allowExcess: true,  unpaid: false,
              types: { invite: 180, auth: 95, notice: 40, warning: 5 } },
  "op-002": { sent: 1240, failed: 15, blocked: false, allowExcess: true,  unpaid: true,
              types: { invite: 620, auth: 410, notice: 150, warning: 60 } },
  "op-003": { sent: 501,  failed: 0,  blocked: false, allowExcess: true,  unpaid: true,
              types: { invite: 200, auth: 200, notice: 80, warning: 21 } },
  "op-004": { sent: 88,   failed: 0,  blocked: false, allowExcess: false, unpaid: false,
              types: { invite: 50, auth: 30, notice: 8, warning: 0 } },
  "op-005": { sent: 0,    failed: 0,  blocked: false, allowExcess: false, unpaid: false,
              types: { invite: 0, auth: 0, notice: 0, warning: 0 } },
};

function getUsage(id: string): SmsSeedEntry {
  return SMS_USAGE_SEED[id] ?? {
    sent: Math.floor(Math.random() * 600), failed: 0, blocked: false, allowExcess: true, unpaid: false,
    types: { invite: 0, auth: 0, notice: 0, warning: 0 },
  };
}

type SortKey = "sent" | "excess" | "charge" | "name";

const SMS_TYPE_COLORS = {
  invite:  { label: "초대",  color: "#0891B2", bg: "#ECFEFF" },
  auth:    { label: "인증",  color: P,         bg: "#EDE9FE" },
  notice:  { label: "안내",  color: GREEN,     bg: "#D1FAE5" },
  warning: { label: "경고",  color: DANGER,    bg: "#FEE2E2" },
};

export default function SmsBillingScreen() {
  const { adminUser } = useAuth();
  const actorName = adminUser?.name ?? "슈퍼관리자";
  const createLog  = useAuditLogStore(s => s.createLog);
  const operators  = useOperatorsStore(s => s.operators);

  const [sort,          setSort]          = useState<SortKey>("charge");
  const [detail,        setDetail]        = useState<string | null>(null);
  const [blockMap,      setBlockMap]      = useState<Record<string, boolean>>({});
  const [allowExcessMap,setAllowExcessMap]= useState<Record<string, boolean>>({});

  const usageList = useMemo(() => operators.map(op => {
    const base        = getUsage(op.id);
    const blocked     = blockMap[op.id] ?? base.blocked;
    const allowExcess = allowExcessMap[op.id] ?? base.allowExcess;
    const excess      = Math.max(0, base.sent - FREE_QUOTA);
    const charge      = Math.round(excess * SMS_UNIT_PRICE);
    return { op, sent: base.sent, failed: base.failed, blocked, allowExcess,
             unpaid: base.unpaid, excess, charge, types: base.types };
  }), [operators, blockMap, allowExcessMap]);

  const sorted = useMemo(() => [...usageList].sort((a, b) => {
    if (sort === "sent")   return b.sent - a.sent;
    if (sort === "excess") return b.excess - a.excess;
    if (sort === "charge") return b.charge - a.charge;
    return a.op.name.localeCompare(b.op.name);
  }), [usageList, sort]);

  const totalSent    = useMemo(() => usageList.reduce((acc, u) => acc + u.sent, 0), [usageList]);
  const totalExcess  = useMemo(() => usageList.reduce((acc, u) => acc + u.excess, 0), [usageList]);
  const totalCharge  = useMemo(() => usageList.reduce((acc, u) => acc + u.charge, 0), [usageList]);
  const totalFailed  = useMemo(() => usageList.reduce((acc, u) => acc + u.failed, 0), [usageList]);
  const blockedCount = useMemo(() => usageList.filter(u => u.blocked).length, [usageList]);
  const unpaidCount  = useMemo(() => usageList.filter(u => u.unpaid).length, [usageList]);

  function toggleBlock(opId: string, current: boolean) {
    const newVal = !current;
    setBlockMap(prev => ({ ...prev, [opId]: newVal }));
    const op = operators.find(o => o.id === opId);
    createLog({
      category: "SMS과금",
      title: `SMS 발송 ${newVal ? "차단" : "차단해제"}: ${op?.name ?? opId}`,
      detail: `운영자 ${op?.name ?? opId} SMS 발송 ${newVal ? "차단" : "허용"} 처리`,
      actorName, impact: "medium", operatorId: opId, operatorName: op?.name,
    });
  }

  function toggleAllowExcess(opId: string, current: boolean) {
    const newVal = !current;
    setAllowExcessMap(prev => ({ ...prev, [opId]: newVal }));
    const op = operators.find(o => o.id === opId);
    createLog({
      category: "SMS과금",
      title: `SMS 초과 허용 ${newVal ? "활성" : "비활성"}: ${op?.name ?? opId}`,
      detail: `초과 발송 ${newVal ? "허용" : "차단"} 설정`,
      actorName, impact: "medium", operatorId: opId, operatorName: op?.name,
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
          <Text style={s.freeQuotaLabel}>무료 {FREE_QUOTA.toLocaleString()}건/운영자</Text>
        </View>

        {/* 전체 요약 */}
        <View style={s.summaryGrid}>
          {[
            { num: totalSent.toLocaleString(),         label: "총 발송",       warn: false, danger: false },
            { num: totalExcess.toLocaleString(),        label: "초과 발송",     warn: totalExcess > 0, danger: false },
            { num: `₩${totalCharge.toLocaleString()}`, label: "예상 과금",     warn: totalCharge > 0, danger: false },
            { num: String(totalFailed),                 label: "발송 실패",     warn: false, danger: totalFailed > 0 },
            { num: String(unpaidCount),                 label: "미결제 운영자", warn: unpaidCount > 0, danger: false },
            { num: String(blockedCount),                label: "차단 운영자",   warn: false, danger: blockedCount > 0 },
          ].map(({ num, label, warn, danger }) => (
            <View key={label} style={[s.summaryCard, warn && s.summaryWarn, danger && s.summaryDanger]}>
              <Text style={[s.summaryNum, warn && { color: WARN }, danger && { color: DANGER }]}>{num}</Text>
              <Text style={s.summaryLabel}>{label}</Text>
            </View>
          ))}
        </View>

        {/* SMS 유형별 합계 */}
        <View style={s.typeSection}>
          <Text style={s.typeSectionTitle}>플랫폼 전체 유형별 발송</Text>
          <View style={s.typeRow}>
            {(["invite", "auth", "notice", "warning"] as const).map(k => {
              const total = usageList.reduce((acc, u) => acc + u.types[k], 0);
              const cfg = SMS_TYPE_COLORS[k];
              return (
                <View key={k} style={[s.typeCard, { borderTopColor: cfg.color, backgroundColor: cfg.bg }]}>
                  <Text style={[s.typeNum, { color: cfg.color }]}>{total.toLocaleString()}</Text>
                  <Text style={s.typeLabel}>{cfg.label}</Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* 정렬 */}
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
        {sorted.map(({ op, sent, failed, blocked, allowExcess, unpaid, excess, charge, types }) => (
          <Pressable key={op.id} style={[s.row, blocked && s.rowBlocked, unpaid && s.rowUnpaid]}
            onPress={() => setDetail(op.id)}>
            <View style={{ flex: 1 }}>
              <View style={s.rowTop}>
                <Text style={s.rowName}>{op.name}</Text>
                {blocked && <View style={s.blockedBadge}><Text style={s.blockedTxt}>차단</Text></View>}
                {unpaid  && <View style={s.unpaidBadge}><Text style={s.unpaidTxt}>미납</Text></View>}
                {excess > 0 && !blocked && <View style={s.excessBadge}><Text style={s.excessTxt}>초과</Text></View>}
                {!allowExcess && <View style={s.noExcessBadge}><Text style={s.noExcessTxt}>초과차단</Text></View>}
              </View>
              <View style={s.rowMetaRow}>
                <Text style={s.rowMeta}>발송 {sent.toLocaleString()}건</Text>
                <Text style={s.rowMetaDot}>·</Text>
                <Text style={[s.rowMeta, excess > 0 && { color: WARN }]}>초과 {excess}건</Text>
                <Text style={s.rowMetaDot}>·</Text>
                <Text style={[s.rowMeta, failed > 0 && { color: DANGER }]}>실패 {failed}건</Text>
              </View>
              {/* 유형별 미니 바 */}
              <View style={s.typeMiniRow}>
                {(["invite", "auth", "notice", "warning"] as const).map(k => (
                  <View key={k} style={s.typeMini}>
                    <View style={[s.typeMiniDot, { backgroundColor: SMS_TYPE_COLORS[k].color }]} />
                    <Text style={s.typeMiniTxt}>{SMS_TYPE_COLORS[k].label} {types[k]}</Text>
                  </View>
                ))}
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
                thumbColor={!blocked ? GREEN : DANGER}
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
              <Text style={m.sub}>{detailItem.op.code} · {monthLabel}
                {detailItem.unpaid ? "  ⚠ 미납" : ""}
              </Text>

              {/* 기본 통계 */}
              <View style={m.statGrid}>
                {[
                  { num: detailItem.sent.toLocaleString(), label: "총 발송", warn: false },
                  { num: FREE_QUOTA.toLocaleString(), label: "무료 제공", warn: false },
                  { num: String(detailItem.excess), label: "초과 발송", warn: detailItem.excess > 0 },
                  { num: `₩${detailItem.charge.toLocaleString()}`, label: "예상 과금액", warn: detailItem.charge > 0 },
                  { num: String(detailItem.failed), label: "발송 실패", warn: detailItem.failed > 0 },
                ].map(({ num, label, warn }) => (
                  <View key={label} style={[m.statItem, warn && m.statWarn]}>
                    <Text style={[m.statNum, warn && { color: WARN }]}>{num}</Text>
                    <Text style={m.statLabel}>{label}</Text>
                  </View>
                ))}
              </View>

              {/* 유형별 발송 */}
              <Text style={m.sectionHeader}>유형별 발송 수</Text>
              <View style={m.typeGrid}>
                {(["invite", "auth", "notice", "warning"] as const).map(k => {
                  const cfg = SMS_TYPE_COLORS[k];
                  return (
                    <View key={k} style={[m.typeItem, { backgroundColor: cfg.bg, borderTopColor: cfg.color }]}>
                      <Text style={[m.typeNum, { color: cfg.color }]}>{detailItem.types[k]}</Text>
                      <Text style={m.typeLbl}>{cfg.label}</Text>
                    </View>
                  );
                })}
              </View>

              <View style={m.chargeInfo}>
                <Feather name="info" size={12} color="#6B7280" />
                <Text style={m.chargeInfoTxt}>초과 과금 단가: ₩{SMS_UNIT_PRICE}/건 · 무료 할당: {FREE_QUOTA}건/월</Text>
              </View>

              {/* 차단 스위치 */}
              <View style={m.blockRow}>
                <View style={{ flex: 1 }}>
                  <Text style={m.blockLabel}>SMS 발송 {detailItem.blocked ? "차단됨" : "허용 중"}</Text>
                  <Text style={m.blockSub}>발송 자체를 차단/허용</Text>
                </View>
                <Switch
                  value={!detailItem.blocked}
                  onValueChange={() => { toggleBlock(detailItem.op.id, detailItem.blocked); setDetail(null); }}
                  trackColor={{ false: "#FCA5A5", true: "#D1FAE5" }}
                  thumbColor={!detailItem.blocked ? GREEN : DANGER}
                />
              </View>

              {/* 초과 허용 스위치 */}
              <View style={m.blockRow}>
                <View style={{ flex: 1 }}>
                  <Text style={m.blockLabel}>초과 발송 {detailItem.allowExcess ? "허용" : "차단"}</Text>
                  <Text style={m.blockSub}>무료 {FREE_QUOTA}건 초과 시 추가 발송 허용 여부</Text>
                </View>
                <Switch
                  value={detailItem.allowExcess}
                  onValueChange={() => { toggleAllowExcess(detailItem.op.id, detailItem.allowExcess); setDetail(null); }}
                  trackColor={{ false: "#FCA5A5", true: "#D1FAE5" }}
                  thumbColor={detailItem.allowExcess ? GREEN : DANGER}
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
  safe:           { flex: 1, backgroundColor: "#F5F3FF" },
  monthHeader:    { flexDirection: "row", alignItems: "center", gap: 8 },
  monthLabel:     { fontSize: 14, fontFamily: "Inter_700Bold", color: "#111827", flex: 1 },
  freeQuotaLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280" },
  summaryGrid:    { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  summaryCard:    { width: "30.5%", backgroundColor: "#fff", borderRadius: 12, padding: 10,
                   alignItems: "center", borderWidth: 1, borderColor: "#E5E7EB" },
  summaryWarn:    { borderColor: "#FDE68A", backgroundColor: "#FFFBEB" },
  summaryDanger:  { borderColor: "#FCA5A5", backgroundColor: "#FFF5F5" },
  summaryNum:     { fontSize: 16, fontFamily: "Inter_700Bold", color: "#111827" },
  summaryLabel:   { fontSize: 9, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 3, textAlign: "center" },
  typeSection:    { backgroundColor: "#fff", borderRadius: 12, padding: 12, gap: 8,
                   borderWidth: 1, borderColor: "#E5E7EB" },
  typeSectionTitle:{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#374151" },
  typeRow:        { flexDirection: "row", gap: 8 },
  typeCard:       { flex: 1, borderRadius: 8, borderTopWidth: 2, padding: 8, alignItems: "center" },
  typeNum:        { fontSize: 15, fontFamily: "Inter_700Bold" },
  typeLabel:      { fontSize: 10, fontFamily: "Inter_500Medium", color: "#6B7280", marginTop: 2 },
  sortRow:        { flexDirection: "row", alignItems: "center", gap: 6 },
  sortLabel:      { fontSize: 12, fontFamily: "Inter_500Medium", color: "#6B7280" },
  sortBtn:        { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: "#F3F4F6" },
  sortBtnActive:  { backgroundColor: P },
  sortBtnTxt:     { fontSize: 11, fontFamily: "Inter_500Medium", color: "#6B7280" },
  sortBtnTxtActive:{ color: "#fff" },
  row:            { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff",
                   borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  rowBlocked:     { borderColor: "#FCA5A5", backgroundColor: "#FFF5F5" },
  rowUnpaid:      { borderColor: "#FDE68A", backgroundColor: "#FFFBEB" },
  rowTop:         { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  rowName:        { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#111827" },
  blockedBadge:   { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, backgroundColor: "#FEE2E2" },
  blockedTxt:     { fontSize: 10, fontFamily: "Inter_700Bold", color: DANGER },
  unpaidBadge:    { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, backgroundColor: "#FEF3C7" },
  unpaidTxt:      { fontSize: 10, fontFamily: "Inter_700Bold", color: WARN },
  excessBadge:    { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, backgroundColor: "#FEF3C7" },
  excessTxt:      { fontSize: 10, fontFamily: "Inter_700Bold", color: WARN },
  noExcessBadge:  { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, backgroundColor: "#F3F4F6" },
  noExcessTxt:    { fontSize: 10, fontFamily: "Inter_700Bold", color: "#6B7280" },
  rowMetaRow:     { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  rowMeta:        { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280" },
  rowMetaDot:     { fontSize: 11, color: "#D1D5DB" },
  typeMiniRow:    { flexDirection: "row", gap: 8, marginTop: 5, flexWrap: "wrap" },
  typeMini:       { flexDirection: "row", alignItems: "center", gap: 3 },
  typeMiniDot:    { width: 6, height: 6, borderRadius: 3 },
  typeMiniTxt:    { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  rowRight:       { alignItems: "flex-end", gap: 4 },
  rowCharge:      { fontSize: 13, fontFamily: "Inter_700Bold", color: "#059669" },
});

const m = StyleSheet.create({
  backdrop:     { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:        { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
                  borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, gap: 12 },
  handle:       { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  title:        { fontSize: 18, fontFamily: "Inter_700Bold", color: "#111827" },
  sub:          { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  sectionHeader:{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#374151" },
  statGrid:     { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statItem:     { flex: 1, minWidth: "28%", backgroundColor: "#F9FAFB", borderRadius: 10, padding: 10, alignItems: "center",
                  borderWidth: 1, borderColor: "#E5E7EB" },
  statWarn:     { borderColor: "#FDE68A", backgroundColor: "#FFFBEB" },
  statNum:      { fontSize: 17, fontFamily: "Inter_700Bold", color: "#111827" },
  statLabel:    { fontSize: 10, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 3, textAlign: "center" },
  typeGrid:     { flexDirection: "row", gap: 8 },
  typeItem:     { flex: 1, borderRadius: 8, borderTopWidth: 2, padding: 8, alignItems: "center" },
  typeNum:      { fontSize: 15, fontFamily: "Inter_700Bold" },
  typeLbl:      { fontSize: 10, fontFamily: "Inter_500Medium", color: "#6B7280", marginTop: 2 },
  chargeInfo:   { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#F3F4F6",
                  padding: 10, borderRadius: 8 },
  chargeInfoTxt:{ fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280", flex: 1 },
  blockRow:     { flexDirection: "row", alignItems: "center", gap: 10 },
  blockLabel:   { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#374151" },
  blockSub:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 1 },
  closeBtn:     { backgroundColor: "#F3F4F6", borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  closeTxt:     { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#374151" },
});
