/**
 * (teacher)/growth-report-list.tsx — AI 학생리포트 목록 (Teacher용)
 *
 * 담당 학생의 growth_reports (REVIEW_REQUIRED / APPROVED / PUBLISHED) 목록.
 * 전체 관리자 KPI/비용/수영장 전체 현황 노출 없음.
 * 각 항목 → /(teacher)/growth-report-review?reportId=X
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useFocusEffect } from "expo-router";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { LucideIcon } from "@/components/common/LucideIcon";

const C = Colors.light;

interface ReportItem {
  id: string;
  student_id: string;
  student_name: string;
  product_status: string;
  report_period: string | null;
  published_at: string | null;
  teacher_review_action: string | null;
  created_at: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  REVIEW_REQUIRED: { label: "검토 대기", color: "#D97706", bg: "#FFFBEB" },
  APPROVED:        { label: "승인됨",    color: "#059669", bg: "#ECFDF5" },
  PUBLISHED:       { label: "발행됨",    color: "#2563EB", bg: "#EFF6FF" },
};

function fmtPeriod(period: string | null): string {
  if (!period) return "—";
  // "2026-07" → "2026년 7월"
  const m = period.match(/^(\d{4})-(\d{2})$/);
  if (m) return `${m[1]}년 ${parseInt(m[2])}월`;
  return period;
}

export default function GrowthReportListScreen() {
  const { token } = useAuth();
  const router    = useRouter();

  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [reports,  setReports]  = useState<ReportItem[]>([]);

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const res = await apiRequest(token, "/teacher/growth-reports");
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.error || "조회 실패"); }
      const d = await res.json();
      setReports(d.reports ?? []);
    } catch (e: any) {
      setError(e?.message || "리포트 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  const reviewRequired = reports.filter(r => r.product_status === "REVIEW_REQUIRED");
  const others         = reports.filter(r => r.product_status !== "REVIEW_REQUIRED");

  function renderItem({ item }: { item: ReportItem }) {
    const cfg = STATUS_CONFIG[item.product_status] ?? { label: item.product_status, color: "#6B7280", bg: "#F3F4F6" };
    return (
      <Pressable
        style={({ pressed }) => [s.item, { opacity: pressed ? 0.7 : 1 }]}
        onPress={() => router.push({ pathname: "/(teacher)/growth-report-review" as any, params: { reportId: item.id } })}
      >
        <View style={s.itemLeft}>
          <Text style={s.studentName}>{item.student_name || "학생"}</Text>
          <Text style={s.period}>{fmtPeriod(item.report_period)}</Text>
        </View>
        <View style={[s.statusBadge, { backgroundColor: cfg.bg }]}>
          <Text style={[s.statusText, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
        <LucideIcon name="chevron-right" size={16} color={C.textSecondary} />
      </Pressable>
    );
  }

  function ListHeader() {
    if (reviewRequired.length === 0) return null;
    return (
      <View style={s.sectionHeader}>
        <View style={[s.dot, { backgroundColor: "#D97706" }]} />
        <Text style={s.sectionTitle}>검토 대기 ({reviewRequired.length})</Text>
      </View>
    );
  }

  const allItems: ReportItem[] = [
    ...reviewRequired,
    ...(others.length > 0 ? [{ _divider: true } as any] : []),
    ...others,
  ];

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="AI 학생리포트" homePath="/(teacher)/today-schedule" />

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      ) : error ? (
        <View style={s.center}>
          <LucideIcon name="alert-circle" size={32} color={C.error} />
          <Text style={s.errorText}>{error}</Text>
          <Pressable style={s.retryBtn} onPress={fetchData}>
            <Text style={s.retryBtnText}>다시 시도</Text>
          </Pressable>
        </View>
      ) : reports.length === 0 ? (
        <View style={s.center}>
          <LucideIcon name="file-text" size={36} color={C.textMuted} />
          <Text style={s.emptyTitle}>담당 학생의 AI 리포트가 없습니다</Text>
          <Text style={s.emptyDesc}>검토 대기 또는 발행된 리포트가 생기면 여기에 표시됩니다</Text>
        </View>
      ) : (
        <FlatList
          data={allItems}
          keyExtractor={(item, idx) => (item as any)._divider ? `div-${idx}` : (item as ReportItem).id}
          renderItem={({ item }) => {
            if ((item as any)._divider) {
              return (
                <View style={s.sectionHeader}>
                  <Text style={s.sectionTitle}>발행된 리포트 ({others.length})</Text>
                </View>
              );
            }
            return renderItem({ item: item as ReportItem });
          }}
          ListHeaderComponent={<ListHeader />}
          contentContainerStyle={{ paddingBottom: 40 }}
          ItemSeparatorComponent={() => <View style={s.separator} />}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: "#F3F4F6" },
  center:     { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 32 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  dot:        { width: 7, height: 7, borderRadius: 4 },
  sectionTitle: { fontSize: 12, fontFamily: "Pretendard-SemiBold", color: C.textSecondary, letterSpacing: 0.3 },
  item:       {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#fff", paddingHorizontal: 16, paddingVertical: 14,
  },
  itemLeft:   { flex: 1 },
  studentName:{ fontSize: 14, fontFamily: "Pretendard-SemiBold", color: C.textPrimary, marginBottom: 2 },
  period:     { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  statusBadge:{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginRight: 4 },
  statusText: { fontSize: 11, fontFamily: "Pretendard-SemiBold" },
  separator:  { height: 1, backgroundColor: "#F3F4F6" },
  errorText:  { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.error, textAlign: "center" },
  retryBtn:   { paddingHorizontal: 24, paddingVertical: 10, backgroundColor: C.primary, borderRadius: 10 },
  retryBtnText: { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#fff" },
  emptyTitle: { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: C.textPrimary, textAlign: "center" },
  emptyDesc:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, textAlign: "center" },
});
