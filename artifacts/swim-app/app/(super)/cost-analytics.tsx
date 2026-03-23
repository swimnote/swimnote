/**
 * (super)/cost-analytics.tsx — 비용·지출 분석
 * 플랫폼 운영 비용 집계. 실제 인프라 연동 불가 시 명확한 mock 소스 분리.
 * 추후 실제 API 연동 시 COST_SOURCE 교체만으로 대응 가능.
 * 탭: 주간 / 월간 / 연간
 */
import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useSubscriptionStore } from "@/store/subscriptionStore";

const P = "#7C3AED";
type Period = "week" | "month" | "year";

// ─── MOCK COST SOURCE ───────────────────────────────────────────────────────
// 실제 인프라 API 연동 전까지 고정 단가 기반 추정 비용.
// 교체 방법: 아래 UNIT_COSTS를 실제 API 응답으로 대체.
const UNIT_COSTS = {
  db_monthly:       28000,  // DB 호스팅 월 비용 (원)
  storage_per_gb:     120,  // 스토리지 GB당 월 비용
  traffic_per_gb:      80,  // 트래픽 GB당 비용
  pg_fee_rate:       0.035, // PG 수수료율 (3.5%)
  tax_rate:           0.10, // 세금 추정율 (10%)
  other_monthly:    15000,  // 기타 고정 운영비
};

// 운영자 수·스토리지 시뮬레이션 (operatorsStore 없이 상수 기반)
const PLATFORM_METRICS = {
  totalStorageGb:  850,
  totalTrafficGb:  1200,
};
// ─────────────────────────────────────────────────────────────────────────────

function fmtKRW(n: number): string {
  return `₩${Math.round(n).toLocaleString("ko-KR")}`;
}

function getPeriodMultiplier(period: Period): number {
  if (period === "week")  return 7 / 30;   // 월 비용의 7/30
  if (period === "month") return 1;
  return 12;
}

interface CostItem { label: string; icon: React.ComponentProps<typeof Feather>["name"]; amount: number; note: string; color: string }

export default function CostAnalyticsScreen() {
  const insets = useSafeAreaInsets();
  const [period, setPeriod] = useState<Period>("month");
  const billingRecords = useSubscriptionStore(s => s.billingRecords);

  const mult = getPeriodMultiplier(period);

  const costs = useMemo((): CostItem[] => {
    const db       = UNIT_COSTS.db_monthly * mult;
    const storage  = UNIT_COSTS.storage_per_gb * PLATFORM_METRICS.totalStorageGb * mult;
    const traffic  = UNIT_COSTS.traffic_per_gb * PLATFORM_METRICS.totalTrafficGb * mult;
    const rev      = billingRecords.filter(r => r.status === "success").reduce((s, r) => s + (r.amount ?? 0), 0);
    const pg       = rev * UNIT_COSTS.pg_fee_rate;
    const tax      = rev * UNIT_COSTS.tax_rate;
    const other    = UNIT_COSTS.other_monthly * mult;
    return [
      { label: "데이터베이스",  icon: "database",    amount: db,      note: "DB 호스팅 비용",            color: "#1F8F86" },
      { label: "스토리지",      icon: "hard-drive",  amount: storage, note: `${PLATFORM_METRICS.totalStorageGb}GB × ${fmtKRW(UNIT_COSTS.storage_per_gb)}/GB`, color: "#7C3AED" },
      { label: "트래픽",        icon: "wifi",        amount: traffic, note: `${PLATFORM_METRICS.totalTrafficGb}GB × ${fmtKRW(UNIT_COSTS.traffic_per_gb)}/GB`, color: "#1F8F86" },
      { label: "PG 수수료",     icon: "credit-card", amount: pg,      note: `매출 × ${(UNIT_COSTS.pg_fee_rate*100).toFixed(1)}%`,                            color: "#D96C6C" },
      { label: "세금 추정",     icon: "percent",     amount: tax,     note: `매출 × ${(UNIT_COSTS.tax_rate*100).toFixed(0)}% 추정`,                           color: "#D97706" },
      { label: "기타 운영비",   icon: "box",         amount: other,   note: "도메인·이메일·모니터링 등", color: "#6F6B68" },
    ];
  }, [period, billingRecords]);

  const totalCost = useMemo(() => costs.reduce((s, c) => s + c.amount, 0), [costs]);

  const revenue = useMemo(() => {
    // 현재 기간 매출 (간단 추정: 전체 성공 기록 × mult/12)
    const total = billingRecords.filter(r => r.status === "success").reduce((s, r) => s + (r.amount ?? 0), 0);
    return total * mult / 12;
  }, [billingRecords, mult]);

  const netProfit = revenue - totalCost;

  const TABS: { key: Period; label: string }[] = [
    { key: "week",  label: "주간" },
    { key: "month", label: "월간" },
    { key: "year",  label: "연간" },
  ];

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="비용·지출" homePath="/(super)/dashboard" />

      {/* 탭 */}
      <View style={s.tabRow}>
        {TABS.map(t => (
          <Pressable key={t.key} style={[s.tab, period === t.key && s.tabActive]} onPress={() => setPeriod(t.key)}>
            <Text style={[s.tabTxt, period === t.key && s.tabTxtActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 16, gap: 14 }}>

        {/* mock 알림 */}
        <View style={s.mockBanner}>
          <Feather name="alert-circle" size={12} color="#D97706" />
          <Text style={s.mockTxt}>비용 데이터는 단가 기반 추정값입니다. 실제 인프라 API 연동 시 자동 교체됩니다.</Text>
        </View>

        {/* 요약 카드 */}
        <View style={s.summaryRow}>
          <View style={[s.summaryCard, { borderColor: "#EEDDF5" }]}>
            <Text style={s.summaryLabel}>총 지출</Text>
            <Text style={[s.summaryValue, { color: "#D96C6C" }]}>{fmtKRW(totalCost)}</Text>
          </View>
          <View style={[s.summaryCard, { borderColor: "#DDF2EF" }]}>
            <Text style={s.summaryLabel}>순이익</Text>
            <Text style={[s.summaryValue, { color: netProfit >= 0 ? "#1F8F86" : "#D96C6C" }]}>{fmtKRW(netProfit)}</Text>
          </View>
        </View>

        {/* 비용 항목별 */}
        <View style={s.sectionHdr}>
          <Feather name="pie-chart" size={14} color={P} />
          <Text style={s.sectionTitle}>항목별 비용</Text>
        </View>
        {costs.map(c => (
          <View key={c.label} style={s.costRow}>
            <View style={[s.costIcon, { backgroundColor: c.color + "20" }]}>
              <Feather name={c.icon} size={16} color={c.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.costLabel}>{c.label}</Text>
              <Text style={s.costNote}>{c.note}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={[s.costAmt, { color: c.color }]}>{fmtKRW(c.amount)}</Text>
              <Text style={s.costPct}>{totalCost > 0 ? `${((c.amount/totalCost)*100).toFixed(1)}%` : "—"}</Text>
            </View>
          </View>
        ))}

        {/* 구성비 바 */}
        <View style={s.sectionHdr}>
          <Feather name="bar-chart-2" size={14} color={P} />
          <Text style={s.sectionTitle}>비용 구성비</Text>
        </View>
        <View style={s.barWrap}>
          {costs.filter(c => c.amount > 0).map(c => (
            <View key={c.label} style={[s.barSeg, {
              flex: c.amount / Math.max(totalCost, 1),
              backgroundColor: c.color,
            }]} />
          ))}
        </View>
        <View style={s.legendRow}>
          {costs.map(c => (
            <View key={c.label} style={s.legendItem}>
              <View style={[s.legendDot, { backgroundColor: c.color }]} />
              <Text style={s.legendTxt}>{c.label}</Text>
            </View>
          ))}
        </View>

        {/* 수익성 요약 */}
        <View style={[s.profitBox, { borderColor: netProfit >= 0 ? "#DDF2EF" : "#F9DEDA" }]}>
          <View style={s.profitRow}>
            <Text style={s.profitLabel}>매출 (추정)</Text>
            <Text style={[s.profitVal, { color: "#1F8F86" }]}>{fmtKRW(revenue)}</Text>
          </View>
          <View style={s.profitRow}>
            <Text style={s.profitLabel}>총 지출</Text>
            <Text style={[s.profitVal, { color: "#D96C6C" }]}>− {fmtKRW(totalCost)}</Text>
          </View>
          <View style={[s.profitRow, { borderTopWidth: 1, borderTopColor: "#E9E2DD", marginTop: 8, paddingTop: 8 }]}>
            <Text style={[s.profitLabel, { fontFamily: "Inter_700Bold" }]}>순이익</Text>
            <Text style={[s.profitVal, { fontFamily: "Inter_700Bold", color: netProfit >= 0 ? "#1F8F86" : "#D96C6C" }]}>
              {netProfit >= 0 ? "" : "−"}{fmtKRW(Math.abs(netProfit))}
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: "#FBF8F6" },
  tabRow:        { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 10, gap: 8, backgroundColor: "#fff",
                   borderBottomWidth: 1, borderBottomColor: "#E9E2DD" },
  tab:           { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center", backgroundColor: "#F6F3F1" },
  tabActive:     { backgroundColor: P },
  tabTxt:        { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#6F6B68" },
  tabTxtActive:  { color: "#fff" },
  mockBanner:    { flexDirection: "row", gap: 6, alignItems: "flex-start", backgroundColor: "#FFF1BF",
                   borderRadius: 8, padding: 10, marginTop: 4 },
  mockTxt:       { fontSize: 11, fontFamily: "Inter_400Regular", color: "#D97706", flex: 1 },
  summaryRow:    { flexDirection: "row", gap: 10 },
  summaryCard:   { flex: 1, backgroundColor: "#fff", borderRadius: 12, padding: 14,
                   borderWidth: 1, alignItems: "center" },
  summaryLabel:  { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6F6B68", marginBottom: 4 },
  summaryValue:  { fontSize: 20, fontFamily: "Inter_700Bold" },
  sectionHdr:    { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionTitle:  { fontSize: 13, fontFamily: "Inter_700Bold", color: "#1F1F1F" },
  costRow:       { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff",
                   borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#E9E2DD" },
  costIcon:      { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  costLabel:     { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#1F1F1F" },
  costNote:      { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9A948F", marginTop: 1 },
  costAmt:       { fontSize: 14, fontFamily: "Inter_700Bold" },
  costPct:       { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9A948F" },
  barWrap:       { flexDirection: "row", height: 14, borderRadius: 7, overflow: "hidden", backgroundColor: "#F6F3F1" },
  barSeg:        { height: 14 },
  legendRow:     { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  legendItem:    { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot:     { width: 8, height: 8, borderRadius: 4 },
  legendTxt:     { fontSize: 10, fontFamily: "Inter_400Regular", color: "#6F6B68" },
  profitBox:     { backgroundColor: "#fff", borderRadius: 12, padding: 16, borderWidth: 1 },
  profitRow:     { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  profitLabel:   { fontSize: 13, fontFamily: "Inter_400Regular", color: "#1F1F1F" },
  profitVal:     { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
