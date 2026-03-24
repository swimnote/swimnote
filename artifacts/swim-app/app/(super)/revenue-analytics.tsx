/**
 * (super)/revenue-analytics.tsx — 플랫폼 매출 분석 (API 연동)
 * GET /billing/revenue-logs → 실제 revenue_logs DB 기반 집계
 * 탭: 주간 / 월간 / 연간
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";

const P = "#7C3AED";
type Period = "week" | "month" | "year";

interface RevenueLog {
  id: string;
  pool_id: string;
  pool_name?: string;
  plan_id: string;
  plan_name?: string;
  event_type?: string;
  gross_amount: number;
  intro_discount_amount: number;
  charged_amount: number;
  refunded_amount: number;
  store_fee: number;
  net_revenue: number;
  occurred_at: string;
}

interface RevenueSummary {
  total_gross: number;
  total_charged: number;
  total_discount: number;
  total_store_fee: number;
  total_net_revenue: number;
  total_refunded: number;
  count: number;
}

function getPeriodDates(period: Period): { start: string; end: string; prevStart: string; prevEnd: string } {
  const now   = new Date();
  const toIso = (d: Date) => d.toISOString().split("T")[0];

  let start: Date, end: Date, prevStart: Date, prevEnd: Date;

  if (period === "week") {
    const dow = now.getDay() === 0 ? 6 : now.getDay() - 1;
    start = new Date(now); start.setHours(0,0,0,0); start.setDate(now.getDate() - dow);
    end   = new Date(now);
    prevStart = new Date(start); prevStart.setDate(prevStart.getDate() - 7);
    prevEnd   = new Date(start); prevEnd.setDate(prevEnd.getDate() - 1);
  } else if (period === "month") {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end   = new Date(now);
    prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    prevEnd   = new Date(now.getFullYear(), now.getMonth(), 0);
  } else {
    start = new Date(now.getFullYear(), 0, 1);
    end   = new Date(now);
    prevStart = new Date(now.getFullYear() - 1, 0, 1);
    prevEnd   = new Date(now.getFullYear() - 1, 11, 31);
  }
  return { start: toIso(start), end: toIso(end), prevStart: toIso(prevStart), prevEnd: toIso(prevEnd) };
}

function fmtKRW(n: number): string {
  return `₩${Math.round(n).toLocaleString("ko-KR")}`;
}

function pct(current: number, prev: number): string {
  if (prev === 0) return current > 0 ? "+∞%" : "—";
  const diff = ((current - prev) / prev) * 100;
  return (diff >= 0 ? "+" : "") + diff.toFixed(1) + "%";
}

function pctColor(current: number, prev: number): string {
  if (prev === 0) return current > 0 ? "#1F8F86" : "#6F6B68";
  return current >= prev ? "#1F8F86" : "#D96C6C";
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <View style={st.card}>
      <Text style={st.cardLabel}>{label}</Text>
      <Text style={[st.cardValue, color ? { color } : {}]}>{value}</Text>
      {sub ? <Text style={st.cardSub}>{sub}</Text> : null}
    </View>
  );
}

function SectionHeader({ title, icon }: { title: string; icon: React.ComponentProps<typeof Feather>["name"] }) {
  return (
    <View style={st.sectionHeader}>
      <Feather name={icon} size={14} color={P} />
      <Text style={st.sectionTitle}>{title}</Text>
    </View>
  );
}

export default function RevenueAnalyticsScreen() {
  const { token } = useAuth();
  const [period, setPeriod] = useState<Period>("month");

  const [logs,        setLogs]        = useState<RevenueLog[]>([]);
  const [prevLogs,    setPrevLogs]    = useState<RevenueLog[]>([]);
  const [summary,     setSummary]     = useState<RevenueSummary | null>(null);
  const [prevSummary, setPrevSummary] = useState<RevenueSummary | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);

  const fetchLogs = useCallback(async (p: Period) => {
    const { start, end, prevStart, prevEnd } = getPeriodDates(p);
    try {
      const [curRes, prevRes] = await Promise.all([
        apiRequest(token, `/billing/revenue-logs?start=${start}&end=${end}`),
        apiRequest(token, `/billing/revenue-logs?start=${prevStart}&end=${prevEnd}`),
      ]);
      const [curData, prevData] = await Promise.all([curRes.json(), prevRes.json()]);
      setLogs(Array.isArray(curData.logs) ? curData.logs : []);
      setSummary(curData.summary ?? null);
      setPrevLogs(Array.isArray(prevData.logs) ? prevData.logs : []);
      setPrevSummary(prevData.summary ?? null);
    } catch (e) { console.error("revenue-logs fetch:", e); }
  }, [token]);

  const load = useCallback(async (p?: Period) => {
    const target = p ?? period;
    setLoading(true);
    await fetchLogs(target);
    setLoading(false);
  }, [fetchLogs, period]);

  useEffect(() => { load(period); }, [period]);

  const totalRevenue  = summary?.total_charged   ?? 0;
  const totalRefunds  = summary?.total_refunded  ?? 0;
  const totalDiscount = summary?.total_discount  ?? 0;
  const totalStoreFee = summary?.total_store_fee ?? 0;
  const netRevenue    = totalRevenue - totalRefunds;
  const prevRevenue   = prevSummary?.total_charged ?? 0;

  const newSubs = useMemo(() => logs.filter(r => r.event_type === "first_payment" || r.event_type === "new_subscription").length, [logs]);
  const renewals = useMemo(() => logs.filter(r => r.event_type === "renewal").length, [logs]);
  const upgrades = useMemo(() => logs.filter(r => r.event_type === "upgrade").length, [logs]);

  const daysInPeriod = useMemo(() => {
    const { start, end } = getPeriodDates(period);
    return Math.max(1, (new Date(end).getTime() - new Date(start).getTime()) / 86400000);
  }, [period]);
  const projected = Math.round(totalRevenue * (daysInPeriod / Math.min(
    Math.max(1, (Date.now() - new Date(getPeriodDates(period).start).getTime()) / 86400000),
    daysInPeriod,
  )));

  const TABS: { key: Period; label: string }[] = [
    { key: "week",  label: "주간" },
    { key: "month", label: "월간" },
    { key: "year",  label: "연간" },
  ];

  const growth      = pct(totalRevenue, prevRevenue);
  const growthColor = pctColor(totalRevenue, prevRevenue);

  if (loading) {
    return (
      <SafeAreaView style={st.safe} edges={[]}>
        <SubScreenHeader title="매출 분석" homePath="/(super)/dashboard" />
        <ActivityIndicator style={{ flex: 1 }} color={P} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={st.safe} edges={[]}>
      <SubScreenHeader title="매출 분석" homePath="/(super)/dashboard" />

      <View style={st.tabRow}>
        {TABS.map(t => (
          <Pressable key={t.key} style={[st.tab, period === t.key && st.tabActive]} onPress={() => setPeriod(t.key)}>
            <Text style={[st.tabTxt, period === t.key && st.tabTxtActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 80, gap: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={P}
          onRefresh={async () => { setRefreshing(true); await fetchLogs(period); setRefreshing(false); }} />}
      >
        <View style={st.noticeBox}>
          <Feather name="info" size={12} color="#1F8F86" />
          <Text style={st.noticeTxt}>revenue_logs DB 실측 기반. 추정·미결제 금액 제외.</Text>
        </View>

        {/* 핵심 지표 */}
        <SectionHeader title="핵심 지표" icon="bar-chart-2" />
        <View style={st.cardGrid}>
          <StatCard label="기간 내 청구액" value={fmtKRW(totalRevenue)} sub="결제 기준" color={P} />
          <StatCard label="순 매출" value={fmtKRW(netRevenue)} sub="청구 - 환불"
            color={netRevenue >= 0 ? "#1F8F86" : "#D96C6C"} />
          <StatCard label="전기 대비" value={growth} color={growthColor} sub="이전 기간" />
          <StatCard label="추정 기간 합산" value={fmtKRW(projected)} sub="현재 속도 기준" color="#D97706" />
        </View>

        {/* 할인·수수료 */}
        <SectionHeader title="할인 및 수수료" icon="percent" />
        <View style={st.cardGrid}>
          <StatCard label="첫 달 50% 할인액" value={fmtKRW(totalDiscount)} sub="할인 합계" color="#DC2626" />
          <StatCard label="스토어 수수료 (30%)" value={fmtKRW(totalStoreFee)} sub="앱스토어/구글플레이" color="#9A948F" />
          <StatCard label="순이익 (수수료 후)" value={fmtKRW(netRevenue - totalStoreFee)} color="#1F8F86" />
        </View>

        {/* 결제 현황 */}
        <SectionHeader title="결제 현황" icon="credit-card" />
        <View style={st.cardGrid}>
          <StatCard label="전체 건수" value={`${logs.length}건`} color={P} />
          <StatCard label="신규 구독" value={`${newSubs}건`} color="#1F8F86" />
          <StatCard label="갱신" value={`${renewals}건`} color="#6366F1" />
          <StatCard label="업그레이드" value={`${upgrades}건`} color="#D97706" />
        </View>

        {/* 환불 */}
        {totalRefunds > 0 && (
          <>
            <SectionHeader title="환불 현황" icon="rotate-ccw" />
            <View style={st.cardGrid}>
              <StatCard label="환불 건수" value={`${logs.filter(r => r.refunded_amount > 0).length}건`} color="#D96C6C" />
              <StatCard label="환불 금액" value={fmtKRW(totalRefunds)} color="#D96C6C" />
            </View>
          </>
        )}

        {/* 건별 상세 목록 */}
        <SectionHeader title="기간 내 결제 내역" icon="list" />
        {logs.length === 0 ? (
          <View style={st.empty}>
            <Feather name="inbox" size={32} color="#D1D5DB" />
            <Text style={st.emptyTxt}>이 기간의 결제 내역이 없습니다</Text>
          </View>
        ) : (
          logs.map(r => (
            <View key={r.id} style={st.recordRow}>
              <View style={{ flex: 1 }}>
                <Text style={st.recordName}>{r.pool_name ?? r.pool_id}</Text>
                <Text style={st.recordSub}>
                  {r.plan_name ?? r.plan_id}
                  {r.event_type ? ` · ${r.event_type === "first_payment" ? "첫 결제" : r.event_type === "renewal" ? "갱신" : r.event_type === "upgrade" ? "업그레이드" : r.event_type}` : ""}
                  {" · "}{new Date(r.occurred_at).toLocaleDateString("ko-KR")}
                </Text>
                {r.intro_discount_amount > 0 && (
                  <Text style={{ fontSize: 10, fontFamily: "Inter_400Regular", color: "#DC2626", marginTop: 1 }}>
                    첫 달 50% 할인 적용 (-{fmtKRW(r.intro_discount_amount)})
                  </Text>
                )}
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[st.recordAmt, { color: P }]}>{fmtKRW(r.charged_amount)}</Text>
                {r.store_fee > 0 && (
                  <Text style={{ fontSize: 10, fontFamily: "Inter_400Regular", color: "#9A948F" }}>
                    수수료 -{fmtKRW(r.store_fee)}
                  </Text>
                )}
              </View>
            </View>
          ))
        )}

        <Pressable style={st.linkBtn} onPress={() => router.push("/(super)/subscriptions" as any)}>
          <Feather name="credit-card" size={14} color={P} />
          <Text style={[st.linkTxt, { color: P }]}>구독·결제 관리로 이동</Text>
          <Feather name="chevron-right" size={14} color={P} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: "#FBF8F6" },
  tabRow:        { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 10, gap: 8, backgroundColor: "#fff",
                   borderBottomWidth: 1, borderBottomColor: "#E9E2DD" },
  tab:           { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center", backgroundColor: "#F6F3F1" },
  tabActive:     { backgroundColor: P },
  tabTxt:        { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#6F6B68" },
  tabTxtActive:  { color: "#fff" },
  noticeBox:     { flexDirection: "row", gap: 6, alignItems: "flex-start", backgroundColor: "#DDF2EF",
                   borderRadius: 8, padding: 10, marginTop: 4 },
  noticeTxt:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#1F8F86", flex: 1 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  sectionTitle:  { fontSize: 13, fontFamily: "Inter_700Bold", color: "#1F1F1F" },
  cardGrid:      { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  card:          { backgroundColor: "#fff", borderRadius: 12, padding: 14, flex: 1, minWidth: "45%",
                   borderWidth: 1, borderColor: "#E9E2DD" },
  cardLabel:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6F6B68", marginBottom: 4 },
  cardValue:     { fontSize: 18, fontFamily: "Inter_700Bold", color: "#1F1F1F" },
  cardSub:       { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9A948F", marginTop: 2 },
  empty:         { alignItems: "center", paddingVertical: 32, gap: 8 },
  emptyTxt:      { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9A948F" },
  recordRow:     { backgroundColor: "#fff", borderRadius: 10, padding: 12, flexDirection: "row",
                   alignItems: "flex-start", borderWidth: 1, borderColor: "#E9E2DD" },
  recordName:    { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#1F1F1F" },
  recordSub:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6F6B68", marginTop: 2 },
  recordAmt:     { fontSize: 15, fontFamily: "Inter_700Bold" },
  linkBtn:       { flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center",
                   backgroundColor: "#EEDDF5", borderRadius: 10, padding: 12 },
  linkTxt:       { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
