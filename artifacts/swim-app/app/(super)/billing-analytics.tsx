/**
 * (super)/billing-analytics.tsx — 매출·정산 관리
 * 슈퍼관리자 플랫폼 운영 전체 매출·지출·순이익 통합 관리.
 * - 매출: 결제일(billedAt) 기준 실제 결제 완료 금액만 집계
 * - 지출: 인프라 비용 (Supabase, R2, 스토어수수료 등) — 추정치 표시
 * - 순이익: 매출 - 총지출
 */
import { Info } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { billingEnabled } from "@/config/billing";
import Colors from "@/constants/colors";
const C = Colors.light;

const P = "#7C3AED";
type Period = "week" | "month" | "year";

// ─── 기간 범위 계산 ────────────────────────────────────────────────────────
function getPeriodRange(period: Period) {
  const now = new Date();
  let start: Date, end: Date, prevStart: Date, prevEnd: Date, label: string;

  if (period === "week") {
    const dow = now.getDay() === 0 ? 6 : now.getDay() - 1;
    start = new Date(now); start.setHours(0,0,0,0); start.setDate(now.getDate() - dow);
    end   = new Date(now);
    prevStart = new Date(start); prevStart.setDate(prevStart.getDate() - 7);
    prevEnd   = new Date(start); prevEnd.setMilliseconds(-1);
    label = `${start.getMonth()+1}/${start.getDate()} — ${end.getMonth()+1}/${end.getDate()}`;
  } else if (period === "month") {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end   = new Date(now);
    prevStart = new Date(now.getFullYear(), now.getMonth()-1, 1);
    prevEnd   = new Date(start); prevEnd.setMilliseconds(-1);
    label = `${now.getFullYear()}년 ${now.getMonth()+1}월`;
  } else {
    start = new Date(now.getFullYear(), 0, 1);
    end   = new Date(now);
    prevStart = new Date(now.getFullYear()-1, 0, 1);
    prevEnd   = new Date(now.getFullYear(), 0, 0, 23, 59, 59, 999);
    label = `${now.getFullYear()}년`;
  }
  return { start, end, prevStart, prevEnd, label };
}

function fmtKRW(n: number) { return `₩${n.toLocaleString("ko-KR")}`; }

function pctStr(cur: number, prev: number): string {
  if (prev === 0) return cur > 0 ? "+∞%" : "—";
  const d = ((cur - prev) / prev) * 100;
  return (d >= 0 ? "+" : "") + d.toFixed(1) + "%";
}

function pctColor(cur: number, prev: number): string {
  if (prev === 0) return cur > 0 ? "#2EC4B6" : "#64748B";
  return cur >= prev ? "#2EC4B6" : "#D96C6C";
}

// ─── 지출 항목 단가 (추정치) ─────────────────────────────────────────────
// 결제 채널: 앱스토어 / 구글플레이 인앱결제 (수수료 30%, 구독 첫 해 15% 감면 없이 30% 적용)
// PG(PortOne) 수수료는 적용하지 않음 — 스토어 결제 전용.
const UNIT_COSTS: { id: string; label: string; unit: string; unitCost: number; qty: number; monthly: number; note?: string }[] = [
  { id: "appstore", label: "앱스토어/구글플레이 수수료 (30%)", unit: "매출 30%", unitCost: 0.30, qty: 1,   monthly: 0,  note: "인앱결제 스토어 수수료 30%" },
  { id: "supabase", label: "Supabase DB (운영 포함)",          unit: "프로 플랜", unitCost: 25,  qty: 1,   monthly: 25, note: "슈퍼관리자 운영 DB 포함" },
  { id: "r2",       label: "Cloudflare R2 스토리지",           unit: "GB당 $0.015", unitCost: 0.015, qty: 800, monthly: 18, note: "추정 800 GB" },
  { id: "traffic",  label: "트래픽·CDN 비용",                  unit: "GB당 $0.01",  unitCost: 0.01,  qty: 500, monthly: 7,  note: "추정 500 GB 월 트래픽" },
  { id: "backup",   label: "백업 DB/스토리지 유지",            unit: "고정",        unitCost: 20,  qty: 1,   monthly: 20, note: "백업 Supabase + R2 복제" },
  { id: "infra",    label: "기타 인프라·모니터링",             unit: "고정",        unitCost: 15,  qty: 1,   monthly: 15, note: "Sentry, Logflare 등" },
];

const KRW_RATE = 1350; // USD → KRW 환산 (참고값)

// ─── 서브 컴포넌트 ─────────────────────────────────────────────────────────
function SectionHeader({ icon, title }: { icon: React.ComponentProps<typeof Feather>["name"]; title: string }) {
  return (
    <View style={s.sectionHdr}>
      <View style={s.sectionIconBox}><LucideIcon name={icon} size={14} color={P} /></View>
      <Text style={s.sectionTitle}>{title}</Text>
    </View>
  );
}

function KpiCard({ label, value, sub, color, small }: { label: string; value: string; sub?: string; color?: string; small?: boolean }) {
  return (
    <View style={s.kpiCard}>
      <Text style={s.kpiLabel}>{label}</Text>
      <Text style={[s.kpiValue, small && { fontSize: 16 }, color ? { color } : {}]}>{value}</Text>
      {sub ? <Text style={s.kpiSub}>{sub}</Text> : null}
    </View>
  );
}

// ─── 메인 ─────────────────────────────────────────────────────────────────
interface RevLog {
  id: string; plan_id: string; plan_name?: string;
  charged_amount: number; refunded_amount: number;
  event_type?: string; intro_discount_amount?: number;
}
interface RevSummary {
  total_charged: number; total_refunded: number;
  total_store_fee: number; total_net_revenue: number;
  total_discount: number; count: number;
}
interface PlanStat { plan_id: string; plan_name?: string; payment_count: number; total_amount: number; }

export default function BillingAnalyticsScreen() {
  if (!billingEnabled) return null;
  const { token } = useAuth();
  const [period, setPeriod] = useState<Period>("month");
  const [logs,        setLogs]        = useState<RevLog[]>([]);
  const [summary,     setSummary]     = useState<RevSummary | null>(null);
  const [prevSummary, setPrevSummary] = useState<RevSummary | null>(null);
  const [planStats,   setPlanStats]   = useState<PlanStat[]>([]);
  const [refreshing,  setRefreshing]  = useState(false);

  const { start, end, prevStart, prevEnd, label: periodLabel } = useMemo(() => getPeriodRange(period), [period]);

  const toDateStr = (d: Date) => d.toISOString().split("T")[0];

  const fetchData = useCallback(async () => {
    try {
      const [curRes, prevRes, planRes] = await Promise.all([
        apiRequest(token, `/billing/revenue-logs?start=${toDateStr(start)}&end=${toDateStr(end)}`),
        apiRequest(token, `/billing/revenue-logs?start=${toDateStr(prevStart)}&end=${toDateStr(prevEnd)}`),
        apiRequest(token, "/billing/revenue-by-plan"),
      ]);
      const [curData, prevData, planData] = await Promise.all([curRes.json(), prevRes.json(), planRes.json()]);
      setLogs(Array.isArray(curData.logs) ? curData.logs : []);
      setSummary(curData.summary ?? null);
      setPrevSummary(prevData.summary ?? null);
      setPlanStats(Array.isArray(planData) ? planData : []);
    } catch (e) { console.error("billing-analytics fetchData:", e); }
  }, [token, start, end, prevStart, prevEnd]);

  useEffect(() => { fetchData(); }, [period]);

  // ── 매출 집계 (API 데이터 기반) ──
  const revenue = useMemo(() => {
    const total     = summary?.total_charged   ?? 0;
    const prevTotal = prevSummary?.total_charged ?? 0;
    const refundAmt = summary?.total_refunded  ?? 0;
    const newCount  = logs.filter(r => r.event_type === "first_payment" || r.event_type === "new_subscription").length;
    const renewalCount = logs.filter(r => r.event_type === "renewal").length;
    const failedCount  = 0; // revenue_logs엔 성공 건만 존재
    const successCount = summary?.count ?? 0;
    const refundCount  = logs.filter(r => (r.refunded_amount ?? 0) > 0).length;
    const planMap: Record<string, { planName: string; count: number; amount: number }> = {};
    planStats.forEach(p => {
      planMap[p.plan_id] = { planName: p.plan_name ?? p.plan_id, count: p.payment_count, amount: p.total_amount };
    });
    return { total, prevTotal, successCount, failedCount, refundCount, refundAmt, newCount, renewalCount, planMap };
  }, [summary, prevSummary, logs, planStats]);

  // ── 지출 집계 (앱스토어/구글플레이 수수료 30%, PG 수수료 없음) ──
  const costs = useMemo(() => {
    const storeFee = Math.round(revenue.total * UNIT_COSTS[0].unitCost); // 30% 스토어 수수료
    const supabase = Math.round(UNIT_COSTS[1].monthly * KRW_RATE);
    const r2       = Math.round(UNIT_COSTS[2].monthly * KRW_RATE);
    const traffic  = Math.round(UNIT_COSTS[3].monthly * KRW_RATE);
    const backup   = Math.round(UNIT_COSTS[4].monthly * KRW_RATE);
    const infra    = Math.round(UNIT_COSTS[5].monthly * KRW_RATE);
    const total    = storeFee + supabase + r2 + traffic + backup + infra;
    return [
      { label: "앱스토어/구글플레이 수수료 (30%)", amount: storeFee, note: "인앱결제 매출 × 30%" },
      { label: "Supabase DB (운영 DB 포함)",        amount: supabase, note: "슈퍼관리자 DB 포함 추정치" },
      { label: "Cloudflare R2 스토리지",            amount: r2,       note: "~800 GB 추정" },
      { label: "트래픽·CDN",                        amount: traffic,  note: "~500 GB/월 추정" },
      { label: "백업 DB/스토리지",                   amount: backup,   note: "백업 복제 고정비" },
      { label: "기타 인프라·모니터링",               amount: infra,    note: "Sentry, Logflare 등" },
      { label: "총 지출 (추정)", amount: total, note: "실제 청구서 연동 시 자동 업데이트" },
    ];
  }, [revenue.total]);

  const totalCost   = costs[costs.length - 1].amount;
  const netProfit   = revenue.total - totalCost;
  const profitMargin = revenue.total > 0 ? ((netProfit / revenue.total) * 100).toFixed(1) : "—";

  const PERIODS: { key: Period; label: string }[] = [
    { key: "week",  label: "주간" },
    { key: "month", label: "월간" },
    { key: "year",  label: "연간" },
  ];

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="매출·정산 관리" homePath="/(super)/dashboard" />

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={P}
          onRefresh={async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }} />}
      >

        {/* 기간 선택 */}
        <View style={s.periodRow}>
          {PERIODS.map(p => (
            <Pressable key={p.key}
              style={[s.periodTab, period === p.key && s.periodTabActive]}
              onPress={() => setPeriod(p.key)}>
              <Text style={[s.periodTxt, period === p.key && s.periodTxtActive]}>{p.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={s.periodLabel}>{periodLabel}</Text>

        {/* ══ 섹션 1: 매출 요약 ══ */}
        <View style={s.section}>
          <SectionHeader icon="trending-up" title="매출 요약" />
          <Text style={s.estimateNote}>revenue_logs DB 기준 · 결제 완료 금액만 집계 (미결제·추정 제외)</Text>

          {/* 주요 KPI — 총매출 강조 */}
          <View style={s.heroCard}>
            <Text style={s.heroLabel}>선택 기간 총 매출</Text>
            <Text style={s.heroValue}>{fmtKRW(revenue.total)}</Text>
            <View style={s.heroCompareRow}>
              <Text style={[s.heroCompare, { color: pctColor(revenue.total, revenue.prevTotal) }]}>
                전기 대비 {pctStr(revenue.total, revenue.prevTotal)}
              </Text>
              <Text style={s.heroPrev}>전기: {fmtKRW(revenue.prevTotal)}</Text>
            </View>
          </View>

          <View style={s.kpiGrid}>
            <KpiCard label="결제 성공" value={`${revenue.successCount}건`} color="#2EC4B6" />
            <KpiCard label="결제 실패" value={`${revenue.failedCount}건`} color={revenue.failedCount > 0 ? "#D96C6C" : "#64748B"} />
            <KpiCard label="신규 결제" value={`${revenue.newCount}건`} />
            <KpiCard label="구독 갱신" value={`${revenue.renewalCount}건`} />
            <KpiCard label="환불 건수" value={`${revenue.refundCount}건`} color={revenue.refundCount > 0 ? "#D97706" : "#64748B"} />
            <KpiCard label="환불 금액" value={fmtKRW(revenue.refundAmt)} small color={revenue.refundAmt > 0 ? "#D97706" : "#64748B"} />
          </View>
        </View>

        {/* ══ 섹션 2: 상품별 매출 ══ */}
        <View style={s.section}>
          <SectionHeader icon="package" title="상품별 매출 분석" />
          {Object.entries(revenue.planMap).length === 0 ? (
            <Text style={s.emptyTxt}>이 기간에 집계된 결제가 없습니다.</Text>
          ) : (
            Object.entries(revenue.planMap).map(([planId, info]) => (
              <View key={planId} style={s.planRow}>
                <View style={s.planLeft}>
                  <Text style={s.planName}>{info.planName}</Text>
                  <Text style={s.planSub}>{info.count}건 결제</Text>
                </View>
                <View style={s.planRight}>
                  <Text style={s.planAmount}>{fmtKRW(info.amount)}</Text>
                </View>
              </View>
            ))
          )}
          {/* 기타 플랜 — 시드에 없는 플랜 */}
          <View style={s.planRowExtra}>
            <Text style={s.planSubNote}>* 업그레이드 결제 건은 플랜 전환 기록으로 별도 추적됩니다.</Text>
          </View>
        </View>

        {/* ══ 섹션 3: 지출 내역 ══ */}
        <View style={s.section}>
          <SectionHeader icon="minus-circle" title="지출 항목 (추정치)" />
          <View style={[s.estimateNoteBanner]}>
            <Info size={12} color="#D97706" />
            <Text style={s.estimateNoteTxt}>
              정확한 비용 API 미연동. 사용량 기반 추정치이며 실제 청구서와 차이가 있을 수 있습니다.
              슈퍼관리자 운영 DB·백업 비용도 포함됩니다.
            </Text>
          </View>
          {costs.slice(0, -1).map((c, i) => (
            <View key={i} style={s.costRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.costLabel}>{c.label}</Text>
                <Text style={s.costNote}>{c.note}</Text>
              </View>
              <Text style={s.costAmount}>{fmtKRW(c.amount)}</Text>
            </View>
          ))}
          <View style={s.costTotalRow}>
            <Text style={s.costTotalLabel}>총 지출 (추정)</Text>
            <Text style={s.costTotalAmount}>{fmtKRW(totalCost)}</Text>
          </View>
        </View>

        {/* ══ 섹션 4: 순이익 ══ */}
        <View style={[s.section, { gap: 10 }]}>
          <SectionHeader icon="bar-chart-2" title="순이익" />
          <View style={s.profitCard}>
            <View style={s.profitRow}>
              <Text style={s.profitLabel}>총 매출</Text>
              <Text style={[s.profitVal, { color: "#2EC4B6" }]}>{fmtKRW(revenue.total)}</Text>
            </View>
            <View style={s.profitDivider} />
            <View style={s.profitRow}>
              <Text style={s.profitLabel}>총 지출 (추정)</Text>
              <Text style={[s.profitVal, { color: "#D96C6C" }]}>- {fmtKRW(totalCost)}</Text>
            </View>
            <View style={[s.profitDivider, { borderStyle: "solid", borderColor: "#0F172A" }]} />
            <View style={s.profitRow}>
              <Text style={[s.profitLabel, { fontFamily: "Pretendard-Bold", fontSize: 15 }]}>순이익</Text>
              <Text style={[s.profitVal, { fontSize: 20, color: netProfit >= 0 ? "#2EC4B6" : "#D96C6C" }]}>
                {fmtKRW(netProfit)}
              </Text>
            </View>
            <Text style={s.marginTxt}>영업이익률 {profitMargin}%</Text>
          </View>
          <Text style={s.profitNote}>
            * 순이익 = 총 매출 - 총 지출(추정치). 환율 기준: ₩{KRW_RATE.toLocaleString()}/$.
            실제 인프라 청구 연동 시 자동 업데이트됩니다.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: C.background },
  periodRow:        { flexDirection: "row", gap: 8 },
  periodTab:        { flex: 1, padding: 10, borderRadius: 10, backgroundColor: "#fff",
                      borderWidth: 1.5, borderColor: "#E5E7EB", alignItems: "center" },
  periodTabActive:  { backgroundColor: P, borderColor: P },
  periodTxt:        { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: "#64748B" },
  periodTxtActive:  { color: "#fff" },
  periodLabel:      { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B", textAlign: "center", marginTop: -8 },

  section:          { backgroundColor: "#fff", borderRadius: 16, padding: 16, gap: 12,
                      borderWidth: 1, borderColor: "#E5E7EB" },
  sectionHdr:       { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  sectionIconBox:   { width: 28, height: 28, borderRadius: 8, backgroundColor: "#EEDDF5",
                      alignItems: "center", justifyContent: "center" },
  sectionTitle:     { fontSize: 15, fontFamily: "Pretendard-Bold", color: "#0F172A" },
  estimateNote:     { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  emptyTxt:         { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B", textAlign: "center", paddingVertical: 20 },

  heroCard:         { backgroundColor: "#EEDDF5", borderRadius: 14, padding: 18, gap: 6,
                      borderWidth: 1, borderColor: "#E6FAF8" },
  heroLabel:        { fontSize: 12, fontFamily: "Pretendard-Medium", color: "#7C3AED" },
  heroValue:        { fontSize: 30, fontFamily: "Pretendard-Bold", color: "#0F172A" },
  heroCompareRow:   { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  heroCompare:      { fontSize: 13, fontFamily: "Pretendard-Bold" },
  heroPrev:         { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },

  kpiGrid:          { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kpiCard:          { width: "30%", minWidth: 95, backgroundColor: "#F1F5F9", borderRadius: 10,
                      padding: 10, gap: 3, borderWidth: 1, borderColor: "#FFFFFF" },
  kpiLabel:         { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B" },
  kpiValue:         { fontSize: 18, fontFamily: "Pretendard-Bold", color: "#0F172A" },
  kpiSub:           { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B" },

  planRow:          { flexDirection: "row", alignItems: "center", paddingVertical: 10,
                      borderBottomWidth: 1, borderColor: "#FFFFFF" },
  planLeft:         { flex: 1, gap: 2 },
  planName:         { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#0F172A" },
  planSub:          { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  planRight:        { alignItems: "flex-end", gap: 2 },
  planAmount:       { fontSize: 15, fontFamily: "Pretendard-Bold", color: "#0F172A" },
  planCount:        { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  planRowExtra:     { paddingTop: 6 },
  planSubNote:      { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B" },

  estimateNoteBanner: { flexDirection: "row", gap: 6, backgroundColor: "#FFF1BF",
                        borderRadius: 8, padding: 10, alignItems: "flex-start" },
  estimateNoteTxt:    { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#92400E", flex: 1, lineHeight: 16 },

  costRow:          { flexDirection: "row", alignItems: "center", paddingVertical: 8,
                      borderBottomWidth: 1, borderColor: "#FFFFFF" },
  costLabel:        { fontSize: 13, fontFamily: "Pretendard-Medium", color: "#0F172A" },
  costNote:         { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 1 },
  costAmount:       { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#D96C6C" },
  costTotalRow:     { flexDirection: "row", alignItems: "center", paddingTop: 10,
                      borderTopWidth: 2, borderColor: "#D96C6C" },
  costTotalLabel:   { flex: 1, fontSize: 14, fontFamily: "Pretendard-Bold", color: "#0F172A" },
  costTotalAmount:  { fontSize: 16, fontFamily: "Pretendard-Bold", color: "#D96C6C" },

  profitCard:       { backgroundColor: "#F1F5F9", borderRadius: 14, padding: 16, gap: 10 },
  profitRow:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  profitLabel:      { fontSize: 13, fontFamily: "Pretendard-Medium", color: "#0F172A" },
  profitVal:        { fontSize: 17, fontFamily: "Pretendard-Bold", color: "#0F172A" },
  profitDivider:    { borderBottomWidth: 1, borderStyle: "dashed", borderColor: "#D1D5DB" },
  marginTxt:        { fontSize: 12, fontFamily: "Pretendard-Medium", color: "#64748B", textAlign: "right" },
  profitNote:       { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B", lineHeight: 16 },
});
