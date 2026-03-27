/**
 * (super)/cost-analytics.tsx — 비용·지출 분석
 * 플랫폼 운영 비용 집계.
 * - 스토어 수수료·세금: 실 결제 API 기반
 * - 인프라 비용(DB·스토리지·트래픽·기타): 단가 기반 추정
 * 탭: 주간 / 월간 / 연간
 */
import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { billingEnabled } from "@/config/billing";

const P = "#7C3AED";
type Period = "week" | "month" | "year";

// ─── 인프라 단가 (실제 계약 단가로 교체 가능) ──────────────────────────────
const UNIT_COSTS = {
  db_monthly:      28000,  // DB 호스팅 월 비용 (원)
  storage_per_gb:    120,  // 스토리지 GB당 월 비용
  traffic_per_gb:     80,  // 트래픽 GB당 비용
  tax_rate:          0.10, // 세금 추정율 (10%)
  other_monthly:   15000,  // 기타 고정 운영비
  store_fee_rate:   0.30,  // 앱스토어/구글플레이 수수료 30%
};

// 플랫폼 인프라 규모 추정
const PLATFORM_METRICS = {
  totalStorageGb: 850,
  totalTrafficGb: 1200,
};
// ─────────────────────────────────────────────────────────────────────────────

function fmtKRW(n: number): string {
  return `₩${Math.round(n).toLocaleString("ko-KR")}`;
}

function getPeriodMultiplier(period: Period): number {
  if (period === "week")  return 7 / 30;
  if (period === "month") return 1;
  return 12;
}

function getDateRange(period: Period): { start: string; end: string } {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (period === "week") {
    const s = new Date(now);
    s.setDate(s.getDate() - 7);
    return { start: s.toISOString().slice(0, 10), end: today };
  }
  if (period === "month") {
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    return { start: `${now.getFullYear()}-${mm}-01`, end: today };
  }
  return { start: `${now.getFullYear()}-01-01`, end: today };
}

interface CostItem {
  label: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  amount: number;
  note: string;
  color: string;
  isReal?: boolean;
}

export default function CostAnalyticsScreen() {
  if (!billingEnabled) return null;
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const [period, setPeriod] = useState<Period>("month");
  const [apiRevenue, setApiRevenue] = useState(0);
  const [loadingRev, setLoadingRev] = useState(false);

  const fetchRevenue = useCallback(async (p: Period) => {
    if (!token) return;
    const { start, end } = getDateRange(p);
    setLoadingRev(true);
    try {
      const res = await apiRequest(token, `/billing/revenue-logs?start=${start}&end=${end}&limit=1000`);
      if (res.ok) {
        const data = await res.json();
        setApiRevenue(Number(data?.summary?.total_charged ?? 0));
      }
    } catch (_) {
      // 네트워크 오류 시 0 유지
    } finally {
      setLoadingRev(false);
    }
  }, [token]);

  useEffect(() => {
    fetchRevenue(period);
  }, [period, fetchRevenue]);

  const mult = getPeriodMultiplier(period);

  const costs = useMemo((): CostItem[] => {
    const db      = UNIT_COSTS.db_monthly * mult;
    const storage = UNIT_COSTS.storage_per_gb * PLATFORM_METRICS.totalStorageGb * mult;
    const traffic = UNIT_COSTS.traffic_per_gb * PLATFORM_METRICS.totalTrafficGb * mult;
    const storeFee = apiRevenue * UNIT_COSTS.store_fee_rate;
    const tax     = apiRevenue * UNIT_COSTS.tax_rate;
    const other   = UNIT_COSTS.other_monthly * mult;
    return [
      { label: "데이터베이스",   icon: "database",   amount: db,       note: "DB 호스팅 비용 (추정)",                    color: "#2EC4B6" },
      { label: "스토리지",       icon: "hard-drive", amount: storage,  note: `${PLATFORM_METRICS.totalStorageGb}GB × ${fmtKRW(UNIT_COSTS.storage_per_gb)}/GB (추정)`,  color: "#7C3AED" },
      { label: "트래픽",         icon: "wifi",       amount: traffic,  note: `${PLATFORM_METRICS.totalTrafficGb}GB × ${fmtKRW(UNIT_COSTS.traffic_per_gb)}/GB (추정)`,  color: "#2EC4B6" },
      { label: "스토어 수수료",  icon: "smartphone", amount: storeFee, note: "실결제 × 30% (앱스토어·구글플레이)",          color: "#D96C6C", isReal: true },
      { label: "세금 추정",      icon: "percent",    amount: tax,      note: `실결제 × ${(UNIT_COSTS.tax_rate * 100).toFixed(0)}% 추정`,                               color: "#D97706" },
      { label: "기타 운영비",    icon: "box",        amount: other,    note: "도메인·이메일·모니터링 등 (추정)",            color: "#6B7280" },
    ];
  }, [period, mult, apiRevenue]);

  const totalCost = useMemo(() => costs.reduce((s, c) => s + c.amount, 0), [costs]);
  const netProfit = apiRevenue - totalCost;

  const TABS: { key: Period; label: string }[] = [
    { key: "week",  label: "주간" },
    { key: "month", label: "월간" },
    { key: "year",  label: "연간" },
  ];

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="비용·지출" homePath="/(super)/dashboard" />

      <View style={s.tabRow}>
        {TABS.map(t => (
          <Pressable key={t.key} style={[s.tab, period === t.key && s.tabActive]} onPress={() => setPeriod(t.key)}>
            <Text style={[s.tabTxt, period === t.key && s.tabTxtActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 16, gap: 14 }}>

        <View style={s.mockBanner}>
          <Feather name="alert-circle" size={12} color="#D97706" />
          <Text style={s.mockTxt}>인프라 비용·세금은 단가 기반 추정값입니다. 스토어 수수료는 실결제 기준으로 계산됩니다.</Text>
        </View>

        {loadingRev && (
          <View style={{ alignItems: "center", paddingVertical: 8 }}>
            <ActivityIndicator size="small" color={P} />
          </View>
        )}

        <View style={s.summaryRow}>
          <View style={[s.summaryCard, { borderColor: "#EEDDF5" }]}>
            <Text style={s.summaryLabel}>총 지출</Text>
            <Text style={[s.summaryValue, { color: "#D96C6C" }]}>{fmtKRW(totalCost)}</Text>
          </View>
          <View style={[s.summaryCard, { borderColor: "#E6FFFA" }]}>
            <Text style={s.summaryLabel}>순이익</Text>
            <Text style={[s.summaryValue, { color: netProfit >= 0 ? "#2EC4B6" : "#D96C6C" }]}>{fmtKRW(netProfit)}</Text>
          </View>
        </View>

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
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Text style={s.costLabel}>{c.label}</Text>
                {c.isReal && (
                  <View style={s.realBadge}>
                    <Text style={s.realBadgeTxt}>실데이터</Text>
                  </View>
                )}
              </View>
              <Text style={s.costNote}>{c.note}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={[s.costAmt, { color: c.color }]}>{fmtKRW(c.amount)}</Text>
              <Text style={s.costPct}>{totalCost > 0 ? `${((c.amount / totalCost) * 100).toFixed(1)}%` : "—"}</Text>
            </View>
          </View>
        ))}

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

        <View style={[s.profitBox, { borderColor: netProfit >= 0 ? "#E6FFFA" : "#F9DEDA" }]}>
          <View style={s.profitRow}>
            <Text style={s.profitLabel}>실결제 매출</Text>
            <Text style={[s.profitVal, { color: "#2EC4B6" }]}>{fmtKRW(apiRevenue)}</Text>
          </View>
          <View style={s.profitRow}>
            <Text style={s.profitLabel}>총 지출</Text>
            <Text style={[s.profitVal, { color: "#D96C6C" }]}>− {fmtKRW(totalCost)}</Text>
          </View>
          <View style={[s.profitRow, { borderTopWidth: 1, borderTopColor: "#E5E7EB", marginTop: 8, paddingTop: 8 }]}>
            <Text style={[s.profitLabel, { fontFamily: "Inter_700Bold" }]}>순이익</Text>
            <Text style={[s.profitVal, { fontFamily: "Inter_700Bold", color: netProfit >= 0 ? "#2EC4B6" : "#D96C6C" }]}>
              {netProfit >= 0 ? "" : "−"}{fmtKRW(Math.abs(netProfit))}
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: "#F1F5F9" },
  tabRow:        { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 10, gap: 8, backgroundColor: "#fff",
                   borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  tab:           { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center", backgroundColor: "#F8FAFC" },
  tabActive:     { backgroundColor: P },
  tabTxt:        { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#6B7280" },
  tabTxtActive:  { color: "#fff" },
  mockBanner:    { flexDirection: "row", gap: 6, alignItems: "flex-start", backgroundColor: "#FFF1BF",
                   borderRadius: 8, padding: 10, marginTop: 4 },
  mockTxt:       { fontSize: 11, fontFamily: "Inter_400Regular", color: "#D97706", flex: 1 },
  summaryRow:    { flexDirection: "row", gap: 10 },
  summaryCard:   { flex: 1, backgroundColor: "#fff", borderRadius: 12, padding: 14,
                   borderWidth: 1, alignItems: "center" },
  summaryLabel:  { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", marginBottom: 4 },
  summaryValue:  { fontSize: 20, fontFamily: "Inter_700Bold" },
  sectionHdr:    { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionTitle:  { fontSize: 13, fontFamily: "Inter_700Bold", color: "#111827" },
  costRow:       { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff",
                   borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  costIcon:      { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  costLabel:     { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#111827" },
  costNote:      { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 1 },
  costAmt:       { fontSize: 14, fontFamily: "Inter_700Bold" },
  costPct:       { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  realBadge:     { backgroundColor: "#E6FFFA", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  realBadgeTxt:  { fontSize: 9, fontFamily: "Inter_600SemiBold", color: "#2EC4B6" },
  barWrap:       { flexDirection: "row", height: 14, borderRadius: 7, overflow: "hidden", backgroundColor: "#F8FAFC" },
  barSeg:        { height: 14 },
  legendRow:     { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  legendItem:    { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot:     { width: 8, height: 8, borderRadius: 4 },
  legendTxt:     { fontSize: 10, fontFamily: "Inter_400Regular", color: "#6B7280" },
  profitBox:     { backgroundColor: "#fff", borderRadius: 12, padding: 16, borderWidth: 1 },
  profitRow:     { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  profitLabel:   { fontSize: 13, fontFamily: "Inter_400Regular", color: "#111827" },
  profitVal:     { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
