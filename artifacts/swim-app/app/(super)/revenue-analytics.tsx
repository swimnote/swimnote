/**
 * (super)/revenue-analytics.tsx — 플랫폼 매출 분석
 * 실제 결제 완료 로그(billingRecords) 기반 집계. 추정/수기 금액 사용 금지.
 * 탭: 주간 / 월간 / 연간
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useSubscriptionStore } from "@/store/subscriptionStore";

const P = "#7C3AED";

type Period = "week" | "month" | "year";

function getPeriodRange(period: Period): { start: Date; end: Date; prevStart: Date; prevEnd: Date } {
  const now = new Date();
  let start: Date, end: Date, prevStart: Date, prevEnd: Date;

  if (period === "week") {
    // 이번 주 월요일 00:00
    const dow = now.getDay() === 0 ? 6 : now.getDay() - 1;
    start = new Date(now); start.setHours(0,0,0,0); start.setDate(now.getDate() - dow);
    end = new Date(now);
    prevStart = new Date(start); prevStart.setDate(prevStart.getDate() - 7);
    prevEnd   = new Date(start); prevEnd.setMilliseconds(-1);
  } else if (period === "month") {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now);
    prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    prevEnd   = new Date(start); prevEnd.setMilliseconds(-1);
  } else {
    start = new Date(now.getFullYear(), 0, 1);
    end = new Date(now);
    prevStart = new Date(now.getFullYear() - 1, 0, 1);
    prevEnd   = new Date(now.getFullYear(), 0, 0, 23, 59, 59, 999);
  }
  return { start, end, prevStart, prevEnd };
}

function fmtKRW(n: number): string {
  return `₩${n.toLocaleString("ko-KR")}`;
}

function pct(current: number, prev: number): string {
  if (prev === 0) return current > 0 ? "+∞%" : "—";
  const diff = ((current - prev) / prev) * 100;
  return (diff >= 0 ? "+" : "") + diff.toFixed(1) + "%";
}

function pctColor(current: number, prev: number): string {
  if (prev === 0) return current > 0 ? "#059669" : "#6B7280";
  return current >= prev ? "#059669" : "#DC2626";
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
  const [period, setPeriod] = useState<Period>("month");
  const billingRecords = useSubscriptionStore(s => s.billingRecords);

  const { start, end, prevStart, prevEnd } = useMemo(() => getPeriodRange(period), [period]);

  // 결제 완료(success)만 매출 집계 대상
  const current = useMemo(() => billingRecords.filter(r => {
    const d = new Date(r.billedAt);
    return d >= start && d <= end;
  }), [billingRecords, start, end]);

  const prev = useMemo(() => billingRecords.filter(r => {
    const d = new Date(r.billedAt);
    return d >= prevStart && d <= prevEnd;
  }), [billingRecords, prevStart, prevEnd]);

  // 현재 기간 통계
  const successRecords  = useMemo(() => current.filter(r => r.status === "success"), [current]);
  const failedRecords   = useMemo(() => current.filter(r => r.status === "failed"), [current]);
  const refundRecords   = useMemo(() => current.filter(r => r.status === "refunded"), [current]);

  const totalRevenue  = useMemo(() => successRecords.reduce((s, r) => s + (r.amount ?? 0), 0), [successRecords]);
  const totalRefunds  = useMemo(() => refundRecords.reduce((s, r) => s + (r.amount ?? 0), 0), [refundRecords]);
  const netRevenue    = totalRevenue - totalRefunds;

  // 이전 기간 매출
  const prevRevenue = useMemo(() => prev.filter(r => r.status === "success").reduce((s, r) => s + (r.amount ?? 0), 0), [prev]);

  // 구독 타입 분류 (planId에 'free' 없으면 신규/갱신 구분 불가 → 간단히 성공건 전부 구독 성공으로 처리)
  const newSubs     = successRecords.filter(r => (r.memo ?? "").includes("신규") || r.creditUsed === 0).length;
  const renewals    = successRecords.filter(r => !((r.memo ?? "").includes("신규")) && r.creditUsed === 0).length;
  const cancels     = current.filter(r => r.billingStatus === "cancelled").length;

  // 예상 다음 기간 매출 (단순 선형 추정)
  const daysInPeriod = Math.max(1, (end.getTime() - start.getTime()) / 86400000);
  const daysSoFar    = Math.max(1, (Date.now() - start.getTime()) / 86400000);
  const projected    = Math.round(totalRevenue * (daysInPeriod / Math.min(daysSoFar, daysInPeriod)));

  const TABS: { key: Period; label: string }[] = [
    { key: "week",  label: "주간" },
    { key: "month", label: "월간" },
    { key: "year",  label: "연간" },
  ];

  const growth = pct(totalRevenue, prevRevenue);
  const growthColor = pctColor(totalRevenue, prevRevenue);

  return (
    <SafeAreaView style={st.safe} edges={[]}>
      <SubScreenHeader title="매출 분석" homePath="/(super)/dashboard" />

      {/* 기간 탭 */}
      <View style={st.tabRow}>
        {TABS.map(t => (
          <Pressable key={t.key} style={[st.tab, period === t.key && st.tabActive]} onPress={() => setPeriod(t.key)}>
            <Text style={[st.tabTxt, period === t.key && st.tabTxtActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 80, gap: 16 }}>

        {/* 안내: 집계 기준 */}
        <View style={st.noticeBox}>
          <Feather name="info" size={12} color="#4F46E5" />
          <Text style={st.noticeTxt}>실제 결제 완료(success) 로그 기반 집계. 미결제·실패·추정 금액 제외.</Text>
        </View>

        {/* 핵심 지표 */}
        <SectionHeader title="핵심 지표" icon="bar-chart-2" />
        <View style={st.cardGrid}>
          <StatCard label="누적 매출" value={fmtKRW(totalRevenue)} sub="결제 성공 기준" color={P} />
          <StatCard label="순 매출" value={fmtKRW(netRevenue)} sub="매출 - 환불" color={netRevenue >= 0 ? "#059669" : "#DC2626"} />
          <StatCard label="전기 대비" value={growth} color={growthColor} sub="이전 기간 동일 집계" />
          <StatCard label="추정 이번 기간" value={fmtKRW(projected)} sub="현재까지 속도 기준" color="#D97706" />
        </View>

        {/* 결제 현황 */}
        <SectionHeader title="결제 현황" icon="credit-card" />
        <View style={st.cardGrid}>
          <StatCard label="결제 성공" value={`${successRecords.length}건`} color="#059669" />
          <StatCard label="결제 실패" value={`${failedRecords.length}건`} color={failedRecords.length > 0 ? "#DC2626" : "#6B7280"} />
          <StatCard label="환불" value={`${refundRecords.length}건`} color={refundRecords.length > 0 ? "#D97706" : "#6B7280"} />
          <StatCard label="환불 금액" value={fmtKRW(totalRefunds)} color={totalRefunds > 0 ? "#DC2626" : "#6B7280"} />
        </View>

        {/* 구독 현황 */}
        <SectionHeader title="구독 현황" icon="users" />
        <View style={st.cardGrid}>
          <StatCard label="신규 구독" value={`${newSubs}건`} color="#059669" />
          <StatCard label="갱신 구독" value={`${renewals}건`} color={P} />
          <StatCard label="해지" value={`${cancels}건`} color={cancels > 0 ? "#DC2626" : "#6B7280"} />
        </View>

        {/* 건별 상세 목록 */}
        <SectionHeader title="기간 내 결제 내역" icon="list" />
        {successRecords.length === 0 ? (
          <View style={st.empty}>
            <Feather name="inbox" size={32} color="#D1D5DB" />
            <Text style={st.emptyTxt}>이 기간의 결제 성공 내역이 없습니다</Text>
          </View>
        ) : (
          successRecords.map(r => (
            <View key={r.id} style={st.recordRow}>
              <View style={{ flex: 1 }}>
                <Text style={st.recordName}>{r.operatorName}</Text>
                <Text style={st.recordSub}>{r.planName} · {new Date(r.billedAt).toLocaleDateString("ko-KR")}</Text>
              </View>
              <Text style={[st.recordAmt, { color: P }]}>{fmtKRW(r.amount)}</Text>
            </View>
          ))
        )}

        {/* 실패 내역 */}
        {failedRecords.length > 0 && (
          <>
            <SectionHeader title="결제 실패 내역" icon="alert-circle" />
            {failedRecords.map(r => (
              <View key={r.id} style={[st.recordRow, { borderLeftColor: "#DC2626", borderLeftWidth: 3 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={st.recordName}>{r.operatorName}</Text>
                  <Text style={st.recordSub}>{r.planName} · {r.failReason ?? "사유 없음"}</Text>
                </View>
                <Text style={[st.recordAmt, { color: "#DC2626" }]}>{fmtKRW(r.amount)}</Text>
              </View>
            ))}
          </>
        )}

        {/* 구독 관리 바로가기 */}
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
  safe:          { flex: 1, backgroundColor: "#F9FAFB" },
  tabRow:        { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 10, gap: 8, backgroundColor: "#fff",
                   borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  tab:           { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center", backgroundColor: "#F3F4F6" },
  tabActive:     { backgroundColor: P },
  tabTxt:        { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#6B7280" },
  tabTxtActive:  { color: "#fff" },
  noticeBox:     { flexDirection: "row", gap: 6, alignItems: "flex-start", backgroundColor: "#EEF2FF",
                   borderRadius: 8, padding: 10, marginTop: 4 },
  noticeTxt:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#4F46E5", flex: 1 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  sectionTitle:  { fontSize: 13, fontFamily: "Inter_700Bold", color: "#111827" },
  cardGrid:      { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  card:          { backgroundColor: "#fff", borderRadius: 12, padding: 14, flex: 1, minWidth: "45%",
                   borderWidth: 1, borderColor: "#E5E7EB" },
  cardLabel:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280", marginBottom: 4 },
  cardValue:     { fontSize: 18, fontFamily: "Inter_700Bold", color: "#111827" },
  cardSub:       { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2 },
  empty:         { alignItems: "center", paddingVertical: 32, gap: 8 },
  emptyTxt:      { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  recordRow:     { backgroundColor: "#fff", borderRadius: 10, padding: 12, flexDirection: "row",
                   alignItems: "center", borderWidth: 1, borderColor: "#E5E7EB" },
  recordName:    { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#111827" },
  recordSub:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },
  recordAmt:     { fontSize: 15, fontFamily: "Inter_700Bold" },
  linkBtn:       { flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center",
                   backgroundColor: "#EDE9FE", borderRadius: 10, padding: 12 },
  linkTxt:       { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
