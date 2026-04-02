/**
 * (super)/cost-analytics.tsx — 비용·지출 분석
 * - 스토어 수수료·세금: 실 결제 API 기반 (실데이터)
 * - 스토리지: 실제 DB 사용량 집계 (실데이터)
 * - DB·기타: 고정 운영비 (실제 계약 비용 입력 필요)
 * - 트래픽: 측정 불가 (₩0 표시)
 */
import { ChartBar, CircleAlert, PieChart } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { billingEnabled } from "@/config/billing";

const P = "#7C3AED";
type Period = "week" | "month" | "year";

// ─── 고정 운영 단가 (실제 계약 비용으로 교체 가능) ──────────────────────────
const UNIT_COSTS = {
  db_monthly:      33750,  // Supabase Pro $25 × ₩1350
  storage_per_gb:     20,  // R2 $0.015/GB × ₩1350 ≈ ₩20/GB
  tax_rate:          0.10, // 세금 추정율 (10%)
  other_monthly:   47250,  // 백업+인프라 $35 × ₩1350
  store_fee_rate:   0.30,  // 앱스토어/구글플레이 수수료 30%
};
// ─────────────────────────────────────────────────────────────────────────────

function fmtKRW(n: number): string {
  return `₩${Math.round(n).toLocaleString("ko-KR")}`;
}

function fmtGb(bytes: number): string {
  const gb = bytes / (1024 ** 3);
  if (gb < 1) return `${(bytes / (1024 ** 2)).toFixed(1)} MB`;
  return `${gb.toFixed(2)} GB`;
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
  icon: string;
  amount: number;
  note: string;
  color: string;
  isReal?: boolean;
  isFixed?: boolean;
}

interface PlatformMetrics {
  total_storage_bytes: number;
  total_storage_gb: number;
  total_pools: number;
  approved_pools: number;
  active_subscriptions: number;
}

export default function CostAnalyticsScreen() {
  if (!billingEnabled) return null;
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const [period, setPeriod] = useState<Period>("month");
  const [apiRevenue, setApiRevenue] = useState(0);
  const [metrics, setMetrics] = useState<PlatformMetrics | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchAll = useCallback(async (p: Period) => {
    if (!token) return;
    const { start, end } = getDateRange(p);
    setLoading(true);
    try {
      const [revRes, metRes] = await Promise.all([
        apiRequest(token, `/billing/revenue-logs?start=${start}&end=${end}&limit=1000`),
        apiRequest(token, "/super/platform-metrics"),
      ]);
      if (revRes.ok) {
        const data = await revRes.json();
        setApiRevenue(Number(data?.summary?.total_charged ?? 0));
      }
      if (metRes.ok) {
        setMetrics(await metRes.json());
      }
    } catch (_) {
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchAll(period);
  }, [period, fetchAll]);

  const mult = getPeriodMultiplier(period);
  const actualStorageGb = metrics?.total_storage_gb ?? 0;

  const costs = useMemo((): CostItem[] => {
    const db       = UNIT_COSTS.db_monthly * mult;
    const storage  = UNIT_COSTS.storage_per_gb * actualStorageGb * mult;
    const storeFee = apiRevenue * UNIT_COSTS.store_fee_rate;
    const tax      = apiRevenue * UNIT_COSTS.tax_rate;
    const other    = UNIT_COSTS.other_monthly * mult;
    return [
      {
        label: "데이터베이스",
        icon: "database",
        amount: db,
        note: `Supabase Pro 고정 비용 (${fmtKRW(UNIT_COSTS.db_monthly)}/월)`,
        color: "#2EC4B6",
        isFixed: true,
      },
      {
        label: "스토리지 (R2)",
        icon: "hard-drive",
        amount: storage,
        note: metrics
          ? `실제 ${fmtGb(metrics.total_storage_bytes)} × ${fmtKRW(UNIT_COSTS.storage_per_gb)}/GB`
          : "스토리지 데이터 로딩 중...",
        color: "#7C3AED",
        isReal: true,
      },
      {
        label: "스토어 수수료",
        icon: "smartphone",
        amount: storeFee,
        note: "실결제 × 30% (앱스토어·구글플레이)",
        color: "#D96C6C",
        isReal: true,
      },
      {
        label: "세금 추정",
        icon: "percent",
        amount: tax,
        note: `실결제 × ${(UNIT_COSTS.tax_rate * 100).toFixed(0)}% 추정`,
        color: "#D97706",
        isReal: true,
      },
      {
        label: "기타 운영비",
        icon: "box",
        amount: other,
        note: `백업 DB + 인프라·모니터링 고정비 (${fmtKRW(UNIT_COSTS.other_monthly)}/월)`,
        color: "#64748B",
        isFixed: true,
      },
    ];
  }, [period, mult, apiRevenue, actualStorageGb, metrics]);

  const totalCost = useMemo(() => costs.reduce((s, c) => s + c.amount, 0), [costs]);
  const netProfit = apiRevenue - totalCost;

  const TABS: { key: Period; label: string }[] = [
    { key: "week",  label: "주간" },
    { key: "month", label: "월간" },
    { key: "year",  label: "연간" },
  ];

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="비용·지출" homePath="/(super)/more" />

      <View style={s.tabRow}>
        {TABS.map(t => (
          <Pressable key={t.key} style={[s.tab, period === t.key && s.tabActive]} onPress={() => setPeriod(t.key)}>
            <Text style={[s.tabTxt, period === t.key && s.tabTxtActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 16, gap: 14 }}>

        <View style={s.infoBanner}>
          <CircleAlert size={12} color="#0369A1" />
          <Text style={s.infoTxt}>
            스토리지·스토어수수료·세금은 실데이터 기반. DB·기타 운영비는 실제 계약 고정 비용.
          </Text>
        </View>

        {loading && (
          <View style={{ alignItems: "center", paddingVertical: 8 }}>
            <ActivityIndicator size="small" color={P} />
          </View>
        )}

        {/* 플랫폼 현황 요약 */}
        {metrics && (
          <View style={s.metricsRow}>
            <View style={s.metricCard}>
              <Text style={s.metricLabel}>전체 수영장</Text>
              <Text style={s.metricValue}>{metrics.total_pools}개</Text>
            </View>
            <View style={s.metricCard}>
              <Text style={s.metricLabel}>유료 구독</Text>
              <Text style={s.metricValue}>{metrics.active_subscriptions}개</Text>
            </View>
            <View style={s.metricCard}>
              <Text style={s.metricLabel}>실사용 용량</Text>
              <Text style={s.metricValue}>{fmtGb(metrics.total_storage_bytes)}</Text>
            </View>
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
          <PieChart size={14} color={P} />
          <Text style={s.sectionTitle}>항목별 비용</Text>
        </View>
        {costs.map(c => (
          <View key={c.label} style={s.costRow}>
            <View style={[s.costIcon, { backgroundColor: c.color + "20" }]}>
              <LucideIcon name={c.icon} size={16} color={c.color} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Text style={s.costLabel}>{c.label}</Text>
                {c.isReal && (
                  <View style={s.realBadge}>
                    <Text style={s.realBadgeTxt}>실데이터</Text>
                  </View>
                )}
                {c.isFixed && (
                  <View style={s.fixedBadge}>
                    <Text style={s.fixedBadgeTxt}>고정비</Text>
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
          <ChartBar size={14} color={P} />
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
            <Text style={s.profitLabel}>순이익</Text>
            <Text style={[s.profitVal, { color: netProfit >= 0 ? "#2EC4B6" : "#D96C6C" }]}>
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
  tab:           { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center", backgroundColor: "#FFFFFF" },
  tabActive:     { backgroundColor: P },
  tabTxt:        { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B" },
  tabTxtActive:  { color: "#fff" },
  infoBanner:    { flexDirection: "row", gap: 6, alignItems: "flex-start", backgroundColor: "#E0F2FE",
                   borderRadius: 8, padding: 10, marginTop: 4 },
  infoTxt:       { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#0369A1", flex: 1 },
  metricsRow:    { flexDirection: "row", gap: 8 },
  metricCard:    { flex: 1, backgroundColor: "#fff", borderRadius: 10, padding: 12, alignItems: "center",
                   borderWidth: 1, borderColor: "#E5E7EB", gap: 4 },
  metricLabel:   { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B" },
  metricValue:   { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  summaryRow:    { flexDirection: "row", gap: 10 },
  summaryCard:   { flex: 1, backgroundColor: "#fff", borderRadius: 12, padding: 14,
                   borderWidth: 1, alignItems: "center" },
  summaryLabel:  { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B", marginBottom: 4 },
  summaryValue:  { fontSize: 20, fontFamily: "Pretendard-Regular" },
  sectionHdr:    { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionTitle:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  costRow:       { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff",
                   borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  costIcon:      { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  costLabel:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  costNote:      { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 1 },
  costAmt:       { fontSize: 14, fontFamily: "Pretendard-Regular" },
  costPct:       { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B" },
  realBadge:     { backgroundColor: "#E6FFFA", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  realBadgeTxt:  { fontSize: 9, fontFamily: "Pretendard-Regular", color: "#2EC4B6" },
  fixedBadge:    { backgroundColor: "#F1F5F9", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  fixedBadgeTxt: { fontSize: 9, fontFamily: "Pretendard-Regular", color: "#64748B" },
  barWrap:       { flexDirection: "row", height: 14, borderRadius: 7, overflow: "hidden", backgroundColor: "#FFFFFF" },
  barSeg:        { height: 14 },
  legendRow:     { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  legendItem:    { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot:     { width: 8, height: 8, borderRadius: 4 },
  legendTxt:     { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B" },
  profitBox:     { backgroundColor: "#fff", borderRadius: 12, padding: 16, borderWidth: 1 },
  profitRow:     { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  profitLabel:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  profitVal:     { fontSize: 14, fontFamily: "Pretendard-Regular" },
});
