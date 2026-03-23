/**
 * (super)/sms-billing.tsx — SMS 판매·정산 관리
 * smsCreditStore 연동 — 선불 충전형 크레딧 시스템
 * 총 판매량·정산·운영자별 잔액·차단·무료 제공량 설정·단가 수정
 */
import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  Alert, Modal, Pressable, ScrollView, StyleSheet, Switch,
  Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useAuth } from "@/context/AuthContext";
import { useSmsCreditStore, CREDIT_PACKAGES, SMS_UNIT_PRICE, SMS_FREE_DEFAULT } from "@/store/smsCreditStore";
import { useOperatorsStore } from "@/store/operatorsStore";

const P = "#7C3AED";
const WARN = "#D97706";
const DANGER = "#D96C6C";
const GREEN = "#1F8F86";

const SMS_TYPE_COLORS = {
  invite:  { label: "초대",  color: "#1F8F86", bg: "#ECFEFF" },
  auth:    { label: "인증",  color: P,         bg: "#EEDDF5" },
  notice:  { label: "안내",  color: GREEN,     bg: "#DDF2EF" },
  warning: { label: "경고",  color: DANGER,    bg: "#F9DEDA" },
};

type SortKey = "balance" | "purchased" | "used" | "name";

export default function SmsBillingScreen() {
  const { adminUser } = useAuth();
  const actorName = adminUser?.name ?? "슈퍼관리자";

  const accounts       = useSmsCreditStore(s => s.accounts);
  const unitPrice      = useSmsCreditStore(s => s.unitPrice);
  const setBlocked     = useSmsCreditStore(s => s.setBlocked);
  const setAllowOverage= useSmsCreditStore(s => s.setAllowOverage);
  const setFreeQuota   = useSmsCreditStore(s => s.setFreeQuota);
  const setUnitPrice   = useSmsCreditStore(s => s.setUnitPrice);
  const operators      = useOperatorsStore(s => s.operators);

  const [sort,        setSort]        = useState<SortKey>("purchased");
  const [detail,      setDetail]      = useState<string | null>(null);
  const [quotaModal,  setQuotaModal]  = useState<string | null>(null);
  const [quotaInput,  setQuotaInput]  = useState("");
  const [priceModal,  setPriceModal]  = useState(false);
  const [priceInput,  setPriceInput]  = useState(String(unitPrice));

  const enriched = useMemo(() => accounts.map(acc => {
    const op = operators.find(o => o.id === acc.operatorId);
    return { acc, op };
  }), [accounts, operators]);

  const sorted = useMemo(() => [...enriched].sort((a, b) => {
    if (sort === "balance")   return b.acc.creditBalance - a.acc.creditBalance;
    if (sort === "purchased") return b.acc.creditPurchasedTotal - a.acc.creditPurchasedTotal;
    if (sort === "used")      return b.acc.creditUsedTotal - a.acc.creditUsedTotal;
    return a.acc.operatorName.localeCompare(b.acc.operatorName);
  }), [enriched, sort]);

  const totalPurchased  = useMemo(() => accounts.reduce((s, a) => s + a.creditPurchasedTotal, 0), [accounts]);
  const totalSales      = useMemo(() => Math.round(totalPurchased * unitPrice), [totalPurchased, unitPrice]);
  const totalFreeUsed   = useMemo(() => accounts.reduce((s, a) => s + a.freeUsedMonthly, 0), [accounts]);
  const totalPaidUsed   = useMemo(() => accounts.reduce((s, a) => s + a.creditUsedTotal, 0), [accounts]);
  const totalBalance    = useMemo(() => accounts.reduce((s, a) => s + a.creditBalance, 0), [accounts]);
  const blockedCount    = useMemo(() => accounts.filter(a => a.smsBlocked).length, [accounts]);

  const detailItem = detail ? sorted.find(e => e.acc.operatorId === detail) : null;

  function handleSetQuota() {
    const n = parseInt(quotaInput);
    if (isNaN(n) || n < 0) { Alert.alert("오류", "유효한 숫자를 입력하세요"); return; }
    if (quotaModal) {
      setFreeQuota(quotaModal, n, actorName);
      setQuotaModal(null);
      setQuotaInput("");
    }
  }

  function handleSetPrice() {
    const n = parseFloat(priceInput);
    if (isNaN(n) || n <= 0) { Alert.alert("오류", "유효한 단가를 입력하세요"); return; }
    setUnitPrice(n, actorName);
    setPriceModal(false);
  }

  const now = new Date();
  const monthLabel = `${now.getFullYear()}년 ${now.getMonth() + 1}월`;

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="SMS 판매·정산 관리" homePath="/(super)/op-group" />

      <ScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 60 }}>

        {/* 헤더 */}
        <View style={s.monthHeader}>
          <Feather name="calendar" size={14} color={P} />
          <Text style={s.monthLabel}>{monthLabel} · 선불 충전형</Text>
          <Pressable onPress={() => setPriceModal(true)} style={s.priceBtn}>
            <Text style={s.priceBtnTxt}>단가 ₩{unitPrice}/건 ✏️</Text>
          </Pressable>
        </View>

        {/* 전체 요약 */}
        <View style={s.summaryGrid}>
          {[
            { num: totalPurchased.toLocaleString() + "건", label: "총 크레딧 판매", color: P },
            { num: `₩${totalSales.toLocaleString()}`,      label: "총 판매 금액",   color: "#1F8F86" },
            { num: totalFreeUsed.toLocaleString() + "건",  label: "무료 제공 사용", color: GREEN },
            { num: totalPaidUsed.toLocaleString() + "건",  label: "유료 크레딧 사용", color: WARN },
            { num: totalBalance.toLocaleString() + "건",   label: "전체 잔여 크레딧", color: "#6F6B68" },
            { num: String(blockedCount),                    label: "차단 운영자",    color: blockedCount > 0 ? DANGER : "#6F6B68" },
          ].map(({ num, label, color }) => (
            <View key={label} style={s.summaryCard}>
              <Text style={[s.summaryNum, { color }]}>{num}</Text>
              <Text style={s.summaryLabel}>{label}</Text>
            </View>
          ))}
        </View>

        {/* 패키지 현황 */}
        <View style={s.card}>
          <Text style={s.cardTitle}>충전 패키지 현황</Text>
          {CREDIT_PACKAGES.map(pkg => {
            const cnt = accounts.reduce((n, a) => n + a.purchaseHistory.filter(p => p.packageName === pkg.name).length, 0);
            return (
              <View key={pkg.id} style={s.pkgRow}>
                <Text style={s.pkgName}>{pkg.name}</Text>
                <Text style={s.pkgDetail}>{pkg.creditCount}건 / ₩{pkg.price.toLocaleString()}</Text>
                <Text style={[s.pkgCnt, { color: cnt > 0 ? P : "#9A948F" }]}>{cnt}건 판매</Text>
              </View>
            );
          })}
        </View>

        {/* 정렬 */}
        <View style={s.sortRow}>
          <Text style={s.sortLabel}>정렬:</Text>
          {(["purchased", "balance", "used", "name"] as SortKey[]).map(k => (
            <Pressable key={k} style={[s.sortBtn, sort === k && s.sortBtnActive]} onPress={() => setSort(k)}>
              <Text style={[s.sortBtnTxt, sort === k && { color: "#fff" }]}>
                {k === "purchased" ? "구매량" : k === "balance" ? "잔액" : k === "used" ? "사용량" : "이름"}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* 운영자별 목록 */}
        {sorted.map(({ acc, op }) => {
          const totalUsed = acc.freeUsedMonthly + acc.creditUsedTotal;
          return (
            <Pressable key={acc.operatorId} style={[s.opCard, acc.smsBlocked && s.opCardBlocked]} onPress={() => setDetail(acc.operatorId)}>
              <View style={s.opTop}>
                <Text style={s.opName} numberOfLines={1}>{acc.operatorName}</Text>
                <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                  {acc.smsBlocked && <View style={s.blockedBadge}><Text style={s.blockedTxt}>차단</Text></View>}
                  {!acc.allowOverage && <View style={s.noBadge}><Text style={s.noBadgeTxt}>초과불허</Text></View>}
                  <Feather name="chevron-right" size={14} color="#D1D5DB" />
                </View>
              </View>
              <View style={s.opGrid}>
                <View style={s.opStat}>
                  <Text style={s.opStatVal}>{acc.creditBalance.toLocaleString()}</Text>
                  <Text style={s.opStatLabel}>잔액</Text>
                </View>
                <View style={s.opStat}>
                  <Text style={s.opStatVal}>{acc.creditPurchasedTotal.toLocaleString()}</Text>
                  <Text style={s.opStatLabel}>총 구매</Text>
                </View>
                <View style={s.opStat}>
                  <Text style={s.opStatVal}>{acc.freeUsedMonthly}/{acc.freeQuotaMonthly}</Text>
                  <Text style={s.opStatLabel}>무료 사용</Text>
                </View>
                <View style={s.opStat}>
                  <Text style={s.opStatVal}>{acc.creditUsedTotal.toLocaleString()}</Text>
                  <Text style={s.opStatLabel}>유료 사용</Text>
                </View>
              </View>
              {/* 유형별 */}
              <View style={s.typeRow}>
                {(["invite","auth","notice","warning"] as const).map(t => {
                  const meta = SMS_TYPE_COLORS[t];
                  return (
                    <View key={t} style={[s.typeBadge, { backgroundColor: meta.bg }]}>
                      <Text style={[s.typeTxt, { color: meta.color }]}>{meta.label} {acc.typesCount[t]}</Text>
                    </View>
                  );
                })}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* 상세 모달 */}
      <Modal visible={!!detail} transparent animationType="slide" onRequestClose={() => setDetail(null)}>
        <Pressable style={m.overlay} onPress={() => setDetail(null)}>
          <Pressable style={m.sheet} onPress={e => e.stopPropagation()}>
            {detailItem && (() => {
              const { acc } = detailItem;
              return (
                <>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <Text style={m.title} numberOfLines={1}>{acc.operatorName}</Text>
                    {acc.smsBlocked && <View style={s.blockedBadge}><Text style={s.blockedTxt}>차단</Text></View>}
                  </View>

                  <View style={m.row}><Text style={m.rowLabel}>크레딧 잔액</Text><Text style={[m.rowVal, { color: acc.creditBalance > 0 ? GREEN : DANGER }]}>{acc.creditBalance.toLocaleString()}건</Text></View>
                  <View style={m.row}><Text style={m.rowLabel}>총 구매</Text><Text style={m.rowVal}>{acc.creditPurchasedTotal.toLocaleString()}건</Text></View>
                  <View style={m.row}><Text style={m.rowLabel}>유료 사용</Text><Text style={m.rowVal}>{acc.creditUsedTotal.toLocaleString()}건</Text></View>
                  <View style={m.row}><Text style={m.rowLabel}>무료 사용</Text><Text style={m.rowVal}>{acc.freeUsedMonthly}/{acc.freeQuotaMonthly}건</Text></View>
                  <View style={m.divider} />

                  <Text style={[m.rowLabel, { marginBottom: 6, fontFamily: "Inter_600SemiBold" }]}>유형별 사용</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                    {(["invite","auth","notice","warning"] as const).map(t => {
                      const meta = SMS_TYPE_COLORS[t];
                      return (
                        <View key={t} style={[s.typeBadge, { backgroundColor: meta.bg, paddingHorizontal: 12, paddingVertical: 6 }]}>
                          <Text style={[s.typeTxt, { color: meta.color, fontSize: 12 }]}>{meta.label} {acc.typesCount[t]}건</Text>
                        </View>
                      );
                    })}
                  </View>
                  <View style={m.divider} />

                  {/* 액션 */}
                  <Text style={[m.rowLabel, { fontFamily: "Inter_600SemiBold", marginBottom: 6 }]}>조치</Text>
                  <View style={{ gap: 8 }}>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <Pressable style={[m.actionBtn, { flex: 1, backgroundColor: acc.smsBlocked ? "#DDF2EF" : "#F9DEDA" }]}
                        onPress={() => { setBlocked(acc.operatorId, !acc.smsBlocked, actorName); }}>
                        <Feather name={acc.smsBlocked ? "unlock" : "slash"} size={13} color={acc.smsBlocked ? GREEN : DANGER} />
                        <Text style={[m.actionTxt, { color: acc.smsBlocked ? GREEN : DANGER }]}>{acc.smsBlocked ? "차단 해제" : "발송 차단"}</Text>
                      </Pressable>
                      <Pressable style={[m.actionBtn, { flex: 1, backgroundColor: "#F0F9FF" }]}
                        onPress={() => { setAllowOverage(acc.operatorId, !acc.allowOverage, actorName); }}>
                        <Feather name="toggle-left" size={13} color="#1F8F86" />
                        <Text style={[m.actionTxt, { color: "#1F8F86" }]}>초과 {acc.allowOverage ? "불허" : "허용"}</Text>
                      </Pressable>
                    </View>
                    <Pressable style={[m.actionBtn, { backgroundColor: "#EEDDF5" }]}
                      onPress={() => { setDetail(null); setQuotaInput(String(acc.freeQuotaMonthly)); setQuotaModal(acc.operatorId); }}>
                      <Feather name="gift" size={13} color={P} />
                      <Text style={[m.actionTxt, { color: P }]}>무료 제공량 변경 (현재 {acc.freeQuotaMonthly}건)</Text>
                    </Pressable>
                  </View>

                  {/* 구매 내역 */}
                  {acc.purchaseHistory.length > 0 && (
                    <>
                      <View style={m.divider} />
                      <Text style={[m.rowLabel, { fontFamily: "Inter_600SemiBold", marginBottom: 6 }]}>충전 내역</Text>
                      {acc.purchaseHistory.slice(0, 4).map(p => (
                        <View key={p.id} style={m.histRow}>
                          <Text style={m.histPkg}>{p.packageName}</Text>
                          <Text style={m.histCredit}>+{p.creditCount}건</Text>
                          <Text style={m.histPrice}>₩{p.price.toLocaleString()}</Text>
                        </View>
                      ))}
                    </>
                  )}

                  <Pressable style={m.closeBtn} onPress={() => setDetail(null)}>
                    <Text style={m.closeTxt}>닫기</Text>
                  </Pressable>
                </>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>

      {/* 무료 제공량 변경 모달 */}
      <Modal visible={!!quotaModal} transparent animationType="fade" onRequestClose={() => setQuotaModal(null)}>
        <Pressable style={m.overlay} onPress={() => setQuotaModal(null)}>
          <Pressable style={m.sheet} onPress={e => e.stopPropagation()}>
            <Text style={m.title}>무료 제공량 변경</Text>
            <Text style={m.sub}>{quotaModal ? accounts.find(a => a.operatorId === quotaModal)?.operatorName : ''}</Text>
            <TextInput
              style={m.input}
              value={quotaInput}
              onChangeText={setQuotaInput}
              placeholder="건수 입력 (예: 500)"
              keyboardType="numeric"
            />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
              <Pressable style={m.cancelBtn} onPress={() => setQuotaModal(null)}><Text style={m.cancelTxt}>취소</Text></Pressable>
              <Pressable style={m.confirmBtn} onPress={handleSetQuota}><Text style={m.confirmTxt}>저장</Text></Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 단가 변경 모달 */}
      <Modal visible={priceModal} transparent animationType="fade" onRequestClose={() => setPriceModal(false)}>
        <Pressable style={m.overlay} onPress={() => setPriceModal(false)}>
          <Pressable style={m.sheet} onPress={e => e.stopPropagation()}>
            <Text style={m.title}>SMS 단가 변경</Text>
            <Text style={m.sub}>현재 단가: ₩{unitPrice}/건</Text>
            <TextInput
              style={m.input}
              value={priceInput}
              onChangeText={setPriceInput}
              placeholder="새 단가 (예: 9.9)"
              keyboardType="decimal-pad"
            />
            <Text style={{ fontSize: 12, color: "#6F6B68", fontFamily: "Inter_400Regular" }}>
              변경 시 모든 운영자에게 즉시 적용됩니다.
            </Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
              <Pressable style={m.cancelBtn} onPress={() => setPriceModal(false)}><Text style={m.cancelTxt}>취소</Text></Pressable>
              <Pressable style={m.confirmBtn} onPress={handleSetPrice}><Text style={m.confirmTxt}>저장</Text></Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#FFFBEB" },
  monthHeader:  { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#FDE68A" },
  monthLabel:   { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#92400E" },
  priceBtn:     { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: "#FFF1BF" },
  priceBtnTxt:  { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#D97706" },
  summaryGrid:  { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  summaryCard:  { flex: 1, minWidth: "30%", backgroundColor: "#fff", borderRadius: 12, padding: 12, alignItems: "center", borderWidth: 1, borderColor: "#E9E2DD" },
  summaryNum:   { fontSize: 16, fontFamily: "Inter_700Bold" },
  summaryLabel: { fontSize: 10, fontFamily: "Inter_400Regular", color: "#6F6B68", marginTop: 3, textAlign: "center" },
  card:         { backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#E9E2DD", gap: 8 },
  cardTitle:    { fontSize: 14, fontFamily: "Inter_700Bold", color: "#1F1F1F", marginBottom: 4 },
  pkgRow:       { flexDirection: "row", alignItems: "center", gap: 8 },
  pkgName:      { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#1F1F1F", width: 90 },
  pkgDetail:    { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#6F6B68" },
  pkgCnt:       { fontSize: 12, fontFamily: "Inter_700Bold" },
  sortRow:      { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  sortLabel:    { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6F6B68" },
  sortBtn:      { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: "#F6F3F1" },
  sortBtnActive:{ backgroundColor: P },
  sortBtnTxt:   { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#6F6B68" },
  opCard:       { backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#E9E2DD", gap: 8 },
  opCardBlocked:{ borderColor: "#FCA5A5", backgroundColor: "#FFF5F5" },
  opTop:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  opName:       { flex: 1, fontSize: 14, fontFamily: "Inter_700Bold", color: "#1F1F1F" },
  blockedBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: "#F9DEDA" },
  blockedTxt:   { fontSize: 10, fontFamily: "Inter_700Bold", color: DANGER },
  noBadge:      { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: "#F6F3F1" },
  noBadgeTxt:   { fontSize: 10, fontFamily: "Inter_500Medium", color: "#6F6B68" },
  opGrid:       { flexDirection: "row", gap: 4 },
  opStat:       { flex: 1, alignItems: "center", backgroundColor: "#FBF8F6", borderRadius: 10, padding: 8 },
  opStatVal:    { fontSize: 14, fontFamily: "Inter_700Bold", color: "#1F1F1F" },
  opStatLabel:  { fontSize: 9, fontFamily: "Inter_400Regular", color: "#9A948F", marginTop: 2 },
  typeRow:      { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  typeBadge:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  typeTxt:      { fontSize: 11, fontFamily: "Inter_600SemiBold" },
});

const m = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet:      { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 10, paddingBottom: 40, maxHeight: "85%" },
  title:      { fontSize: 17, fontFamily: "Inter_700Bold", color: "#1F1F1F" },
  sub:        { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6F6B68" },
  row:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 5 },
  rowLabel:   { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6F6B68" },
  rowVal:     { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#1F1F1F" },
  divider:    { height: 1, backgroundColor: "#F6F3F1", marginVertical: 6 },
  actionBtn:  { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, padding: 12 },
  actionTxt:  { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  histRow:    { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  histPkg:    { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: "#1F1F1F" },
  histCredit: { fontSize: 12, fontFamily: "Inter_700Bold", color: GREEN },
  histPrice:  { fontSize: 12, fontFamily: "Inter_500Medium", color: "#6F6B68", width: 80, textAlign: "right" },
  input:      { backgroundColor: "#FBF8F6", borderWidth: 1, borderColor: "#E9E2DD", borderRadius: 12, padding: 12, fontSize: 15, fontFamily: "Inter_400Regular", color: "#1F1F1F" },
  cancelBtn:  { flex: 1, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#F6F3F1" },
  cancelTxt:  { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#6F6B68" },
  confirmBtn: { flex: 2, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: P },
  confirmTxt: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  closeBtn:   { height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#F6F3F1", marginTop: 6 },
  closeTxt:   { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#6F6B68" },
});
