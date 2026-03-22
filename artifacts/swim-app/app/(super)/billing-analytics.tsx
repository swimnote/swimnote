/**
 * (super)/billing-analytics.tsx — 매출·정산 관리
 * 슈퍼관리자 플랫폼 운영 전체 매출·지출·순이익 통합 관리.
 * - 매출: 결제일(billedAt) 기준 실제 결제 완료 금액만 집계
 * - 지출: 인프라 비용 (Supabase, R2, PG수수료, App Store 등) — 추정치 표시
 * - 순이익: 매출 - 총지출
 */
import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useSubscriptionStore } from "@/store/subscriptionStore";

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
  if (prev === 0) return cur > 0 ? "#059669" : "#6B7280";
  return cur >= prev ? "#059669" : "#DC2626";
}

// ─── 지출 항목 단가 (추정치 — 실제 API 연동 대기) ──────────────────────────
const UNIT_COSTS: { id: string; label: string; unit: string; unitCost: number; qty: number; monthly: number; note?: string }[] = [
  { id: "pg",       label: "PG 수수료 (PortOne)",       unit: "매출 2.5%",   unitCost: 0.025, qty: 1,     monthly: 0, note: "결제액 × 2.5%" },
  { id: "appstore", label: "App Store / Google Play 수수료", unit: "인앱 15%", unitCost: 0.15,  qty: 1,     monthly: 0, note: "인앱결제 15% 추정" },
  { id: "supabase", label: "Supabase DB (운영 포함)",   unit: "프로 플랜",   unitCost: 25,    qty: 1,     monthly: 25, note: "슈퍼관리자 운영 DB 포함" },
  { id: "r2",       label: "Cloudflare R2 스토리지",    unit: "GB당 $0.015", unitCost: 0.015, qty: 800,   monthly: 18, note: "추정 800 GB" },
  { id: "traffic",  label: "트래픽·CDN 비용",           unit: "GB당 $0.01",  unitCost: 0.01,  qty: 500,   monthly: 7,  note: "추정 500 GB 월 트래픽" },
  { id: "backup",   label: "백업 DB/스토리지 유지",     unit: "고정",        unitCost: 20,    qty: 1,     monthly: 20, note: "백업 Supabase + R2 복제" },
  { id: "infra",    label: "기타 인프라·모니터링",      unit: "고정",        unitCost: 15,    qty: 1,     monthly: 15, note: "Sentry, Logflare 등" },
];

const KRW_RATE = 1350; // USD → KRW 환산 (참고값)

// ─── 서브 컴포넌트 ─────────────────────────────────────────────────────────
function SectionHeader({ icon, title }: { icon: React.ComponentProps<typeof Feather>["name"]; title: string }) {
  return (
    <View style={s.sectionHdr}>
      <View style={s.sectionIconBox}><Feather name={icon} size={14} color={P} /></View>
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
export default function BillingAnalyticsScreen() {
  const [period, setPeriod] = useState<Period>("month");
  const plans = useSubscriptionStore(s => s.plans);
  const billingRecords = useSubscriptionStore(s => s.billingRecords);

  const { start, end, prevStart, prevEnd, label: periodLabel } = useMemo(() => getPeriodRange(period), [period]);

  // ── 기간 내 레코드 필터 ──
  const curRecords  = useMemo(() => billingRecords.filter(r => { const d = new Date(r.billedAt); return d >= start && d <= end; }), [billingRecords, start, end]);
  const prevRecords = useMemo(() => billingRecords.filter(r => { const d = new Date(r.billedAt); return d >= prevStart && d <= prevEnd; }), [billingRecords, prevStart, prevEnd]);

  // ── 매출 집계 ──
  const revenue = useMemo(() => {
    const success   = curRecords.filter(r => r.status === "success");
    const failed    = curRecords.filter(r => r.status === "failed");
    const refunded  = curRecords.filter(r => r.status === "refunded");
    const total     = success.reduce((s, r) => s + r.amount, 0);
    const refundAmt = refunded.reduce((s, r) => s + r.amount, 0);

    // 신규: 해당 기간 처음 결제한 운영자 (이 기간 기준 이전 기록 없음)
    const priorOpIds = new Set(billingRecords.filter(r => new Date(r.billedAt) < start).map(r => r.operatorId));
    const newPayments = success.filter(r => !priorOpIds.has(r.operatorId));
    const renewals    = success.filter(r => priorOpIds.has(r.operatorId));

    const prevSuccess = prevRecords.filter(r => r.status === "success");
    const prevTotal   = prevSuccess.reduce((s, r) => s + r.amount, 0);

    // 플랜별 집계
    const planMap: Record<string, { planName: string; count: number; amount: number }> = {};
    success.forEach(r => {
      if (!planMap[r.planId]) planMap[r.planId] = { planName: r.planName, count: 0, amount: 0 };
      planMap[r.planId].count++;
      planMap[r.planId].amount += r.amount;
    });

    return { total, prevTotal, successCount: success.length, failedCount: failed.length,
      refundCount: refunded.length, refundAmt, newCount: newPayments.length,
      renewalCount: renewals.length, planMap };
  }, [curRecords, prevRecords, billingRecords, start]);

  // ── 지출 집계 ──
  const costs = useMemo(() => {
    const pgFee       = Math.round(revenue.total * UNIT_COSTS[0].unitCost);
    const appFee      = Math.round(revenue.total * UNIT_COSTS[1].unitCost * 0.2); // 인앱은 전체의 약 20% 추정
    const supabase    = Math.round(UNIT_COSTS[2].monthly * KRW_RATE);
    const r2          = Math.round(UNIT_COSTS[3].monthly * KRW_RATE);
    const traffic     = Math.round(UNIT_COSTS[4].monthly * KRW_RATE);
    const backup      = Math.round(UNIT_COSTS[5].monthly * KRW_RATE);
    const infra       = Math.round(UNIT_COSTS[6].monthly * KRW_RATE);
    const total       = pgFee + appFee + supabase + r2 + traffic + backup + infra;
    return [
      { label: "PG 수수료 (PortOne)",             amount: pgFee,    note: "매출 × 2.5%" },
      { label: "App Store / Play 수수료",          amount: appFee,   note: "인앱결제 × 15% (20% 추정)" },
      { label: "Supabase DB (운영 DB 포함)",       amount: supabase, note: "슈퍼관리자 DB 포함 추정치" },
      { label: "Cloudflare R2 스토리지",           amount: r2,       note: "~800 GB 추정" },
      { label: "트래픽·CDN",                       amount: traffic,  note: "~500 GB/월 추정" },
      { label: "백업 DB/스토리지",                  amount: backup,   note: "백업 복제 고정비" },
      { label: "기타 인프라·모니터링",              amount: infra,    note: "Sentry, Logflare 등" },
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

      <ScrollView contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 60 }}>

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
          <Text style={s.estimateNote}>결제일(billedAt) 기준 실제 결제 완료 금액만 집계</Text>

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
            <KpiCard label="결제 성공" value={`${revenue.successCount}건`} color="#059669" />
            <KpiCard label="결제 실패" value={`${revenue.failedCount}건`} color={revenue.failedCount > 0 ? "#DC2626" : "#6B7280"} />
            <KpiCard label="신규 결제" value={`${revenue.newCount}건`} />
            <KpiCard label="구독 갱신" value={`${revenue.renewalCount}건`} />
            <KpiCard label="환불 건수" value={`${revenue.refundCount}건`} color={revenue.refundCount > 0 ? "#D97706" : "#6B7280"} />
            <KpiCard label="환불 금액" value={fmtKRW(revenue.refundAmt)} small color={revenue.refundAmt > 0 ? "#D97706" : "#6B7280"} />
          </View>
        </View>

        {/* ══ 섹션 2: 상품별 매출 ══ */}
        <View style={s.section}>
          <SectionHeader icon="package" title="상품별 매출 분석" />
          {Object.entries(revenue.planMap).length === 0 ? (
            <Text style={s.emptyTxt}>이 기간에 집계된 결제가 없습니다.</Text>
          ) : (
            Object.entries(revenue.planMap).map(([planId, info]) => {
              const plan = plans.find(p => p.id === planId);
              return (
                <View key={planId} style={s.planRow}>
                  <View style={s.planLeft}>
                    <Text style={s.planName}>{info.planName}</Text>
                    {plan && <Text style={s.planSub}>정가 {fmtKRW(plan.priceMonthly ?? plan.price ?? 0)}/월 · 최대 {plan.maxStudents}명</Text>}
                  </View>
                  <View style={s.planRight}>
                    <Text style={s.planAmount}>{fmtKRW(info.amount)}</Text>
                    <Text style={s.planCount}>{info.count}건 결제</Text>
                  </View>
                </View>
              );
            })
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
            <Feather name="info" size={12} color="#D97706" />
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
              <Text style={[s.profitVal, { color: "#059669" }]}>{fmtKRW(revenue.total)}</Text>
            </View>
            <View style={s.profitDivider} />
            <View style={s.profitRow}>
              <Text style={s.profitLabel}>총 지출 (추정)</Text>
              <Text style={[s.profitVal, { color: "#DC2626" }]}>- {fmtKRW(totalCost)}</Text>
            </View>
            <View style={[s.profitDivider, { borderStyle: "solid", borderColor: "#111827" }]} />
            <View style={s.profitRow}>
              <Text style={[s.profitLabel, { fontFamily: "Inter_700Bold", fontSize: 15 }]}>순이익</Text>
              <Text style={[s.profitVal, { fontSize: 20, color: netProfit >= 0 ? "#059669" : "#DC2626" }]}>
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
  safe:             { flex: 1, backgroundColor: "#F5F3FF" },
  periodRow:        { flexDirection: "row", gap: 8 },
  periodTab:        { flex: 1, padding: 10, borderRadius: 10, backgroundColor: "#fff",
                      borderWidth: 1.5, borderColor: "#E5E7EB", alignItems: "center" },
  periodTabActive:  { backgroundColor: P, borderColor: P },
  periodTxt:        { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#6B7280" },
  periodTxtActive:  { color: "#fff" },
  periodLabel:      { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", textAlign: "center", marginTop: -8 },

  section:          { backgroundColor: "#fff", borderRadius: 16, padding: 16, gap: 12,
                      borderWidth: 1, borderColor: "#E5E7EB" },
  sectionHdr:       { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  sectionIconBox:   { width: 28, height: 28, borderRadius: 8, backgroundColor: "#EDE9FE",
                      alignItems: "center", justifyContent: "center" },
  sectionTitle:     { fontSize: 15, fontFamily: "Inter_700Bold", color: "#111827" },
  estimateNote:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  emptyTxt:         { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF", textAlign: "center", paddingVertical: 20 },

  heroCard:         { backgroundColor: "#F5F3FF", borderRadius: 14, padding: 18, gap: 6,
                      borderWidth: 1, borderColor: "#DDD6FE" },
  heroLabel:        { fontSize: 12, fontFamily: "Inter_500Medium", color: "#7C3AED" },
  heroValue:        { fontSize: 30, fontFamily: "Inter_700Bold", color: "#111827" },
  heroCompareRow:   { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  heroCompare:      { fontSize: 13, fontFamily: "Inter_700Bold" },
  heroPrev:         { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },

  kpiGrid:          { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kpiCard:          { width: "30%", minWidth: 95, backgroundColor: "#F9FAFB", borderRadius: 10,
                      padding: 10, gap: 3, borderWidth: 1, borderColor: "#F3F4F6" },
  kpiLabel:         { fontSize: 10, fontFamily: "Inter_400Regular", color: "#6B7280" },
  kpiValue:         { fontSize: 18, fontFamily: "Inter_700Bold", color: "#111827" },
  kpiSub:           { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9CA3AF" },

  planRow:          { flexDirection: "row", alignItems: "center", paddingVertical: 10,
                      borderBottomWidth: 1, borderColor: "#F3F4F6" },
  planLeft:         { flex: 1, gap: 2 },
  planName:         { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#111827" },
  planSub:          { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  planRight:        { alignItems: "flex-end", gap: 2 },
  planAmount:       { fontSize: 15, fontFamily: "Inter_700Bold", color: "#111827" },
  planCount:        { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280" },
  planRowExtra:     { paddingTop: 6 },
  planSubNote:      { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9CA3AF" },

  estimateNoteBanner: { flexDirection: "row", gap: 6, backgroundColor: "#FEF3C7",
                        borderRadius: 8, padding: 10, alignItems: "flex-start" },
  estimateNoteTxt:    { fontSize: 11, fontFamily: "Inter_400Regular", color: "#92400E", flex: 1, lineHeight: 16 },

  costRow:          { flexDirection: "row", alignItems: "center", paddingVertical: 8,
                      borderBottomWidth: 1, borderColor: "#F3F4F6" },
  costLabel:        { fontSize: 13, fontFamily: "Inter_500Medium", color: "#374151" },
  costNote:         { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 1 },
  costAmount:       { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#DC2626" },
  costTotalRow:     { flexDirection: "row", alignItems: "center", paddingTop: 10,
                      borderTopWidth: 2, borderColor: "#DC2626" },
  costTotalLabel:   { flex: 1, fontSize: 14, fontFamily: "Inter_700Bold", color: "#111827" },
  costTotalAmount:  { fontSize: 16, fontFamily: "Inter_700Bold", color: "#DC2626" },

  profitCard:       { backgroundColor: "#F9FAFB", borderRadius: 14, padding: 16, gap: 10 },
  profitRow:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  profitLabel:      { fontSize: 13, fontFamily: "Inter_500Medium", color: "#374151" },
  profitVal:        { fontSize: 17, fontFamily: "Inter_700Bold", color: "#111827" },
  profitDivider:    { borderBottomWidth: 1, borderStyle: "dashed", borderColor: "#D1D5DB" },
  marginTxt:        { fontSize: 12, fontFamily: "Inter_500Medium", color: "#6B7280", textAlign: "right" },
  profitNote:       { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9CA3AF", lineHeight: 16 },
});
