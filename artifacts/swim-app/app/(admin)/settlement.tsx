/**
 * /(admin)/settlement — 정산 확인 화면
 * 주간 횟수별 회원수 × 수업료 = 매출 상세
 * 총 수업시수 = Σ(회원수 × 주간횟수)
 */
import { ChevronLeft, ChevronRight, CircleAlert, Clock, Settings, TriangleAlert } from "lucide-react-native";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useBrand } from "@/context/BrandContext";

const C = Colors.light;

function fmt(n: number) {
  return n.toLocaleString("ko-KR");
}

function fmtMonth(ym: string) {
  const [y, m] = ym.split("-");
  return `${y}년 ${parseInt(m, 10)}월`;
}

function prevMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function nextMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

interface SummaryGroup {
  type_key: string;
  label: string;
  student_count: number;
  weekly_count: number;
  monthly_fee: number;
  sessions: number;
  subtotal: number;
}

interface ExtraClass {
  class_name: string;
  student_count: number;
}

interface SummaryData {
  month: string;
  groups: SummaryGroup[];
  extra_classes: ExtraClass[];
  total_sessions: number;
  total_revenue: number;
  has_pricing: boolean;
}

const GROUP_COLORS: Record<string, { color: string; bg: string; border: string }> = {
  weekly_1: { color: "#0F172A", bg: "#FFFFFF", border: "#CBD5E1" },
  weekly_2: { color: "#0F172A", bg: "#FFFFFF", border: "#CBD5E1" },
  weekly_3: { color: "#0F172A", bg: "#FFFFFF", border: "#CBD5E1" },
};

export default function SettlementScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const todayYM = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(todayYM);
  const [data, setData]   = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiRequest(token, `/admin/settlement-summary?month=${month}`);
      if (r.ok) setData(await r.json());
    } finally { setLoading(false); }
  }, [token, month]);

  useEffect(() => { load(); }, [load]);

  const isCurrentMonth = month === todayYM;

  return (
    <View style={s.root}>
      <SubScreenHeader title="정산 확인" />

      {/* 월 선택 */}
      <View style={s.monthRow}>
        <Pressable style={s.monthBtn} onPress={() => setMonth(prevMonth(month))}>
          <ChevronLeft size={20} color={C.text} />
        </Pressable>
        <View style={{ alignItems: "center" }}>
          <Text style={s.monthTxt}>{fmtMonth(month)}</Text>
          {isCurrentMonth && (
            <View style={[s.nowBadge, { backgroundColor: themeColor }]}>
              <Text style={s.nowBadgeTxt}>이번달</Text>
            </View>
          )}
        </View>
        <Pressable
          style={[s.monthBtn, month >= todayYM && { opacity: 0.3 }]}
          onPress={() => month < todayYM && setMonth(nextMonth(month))}
          disabled={month >= todayYM}
        >
          <ChevronRight size={20} color={C.text} />
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} color={themeColor} />
      ) : !data ? (
        <View style={s.empty}>
          <CircleAlert size={40} color={C.border} />
          <Text style={s.emptyTxt}>데이터를 불러올 수 없습니다</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 80 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
          showsVerticalScrollIndicator={false}
        >
          {/* 단가 미설정 안내 */}
          {!data.has_pricing && (
            <Pressable
              style={s.warningCard}
              onPress={() => router.push("/(admin)/pool-settings" as any)}
            >
              <TriangleAlert size={16} color="#D97706" />
              <Text style={s.warningTxt}>수업 단가가 설정되지 않았습니다. 수업 설정에서 단가표를 등록하세요.</Text>
              <ChevronRight size={16} color="#D97706" />
            </Pressable>
          )}

          {/* 상단 총합 카드 */}
          <View style={[s.totalCard, { borderColor: themeColor }]}>
            <View style={s.totalRow}>
              <View style={s.totalItem}>
                <Text style={s.totalLabel}>총 수업시수</Text>
                <Text style={[s.totalValue, { color: themeColor }]}>
                  {fmt(data.total_sessions)}
                  <Text style={s.totalUnit}>시수</Text>
                </Text>
              </View>
              <View style={s.totalDivider} />
              <View style={s.totalItem}>
                <Text style={s.totalLabel}>이달 예상 매출</Text>
                <Text style={[s.totalValue, { color: "#D97706" }]}>
                  {fmt(data.total_revenue)}
                  <Text style={s.totalUnit}>원</Text>
                </Text>
              </View>
            </View>
            <View style={[s.totalFooter, { backgroundColor: themeColor + "15" }]}>
              <Text style={[s.totalFooterTxt, { color: themeColor }]}>
                수업시수 = 회원수 × 주간횟수 / 수업료 = 회원수 × 단가
              </Text>
            </View>
          </View>

          {/* 주간 횟수별 상세 */}
          <Text style={s.sectionTitle}>주간 횟수별 현황</Text>
          {data.groups.length === 0 ? (
            <View style={[s.card, { alignItems: "center", paddingVertical: 24 }]}>
              <Text style={{ color: C.textSecondary, fontSize: 13 }}>배정된 회원이 없습니다</Text>
            </View>
          ) : (
            data.groups.map(g => {
              const palette = GROUP_COLORS[g.type_key] || { color: "#64748B", bg: "#FFFFFF", border: C.border };
              return (
                <View key={g.type_key} style={[s.groupCard, { borderColor: palette.border, backgroundColor: palette.bg }]}>
                  {/* 헤더 */}
                  <View style={s.groupHeader}>
                    <View style={[s.groupBadge, { backgroundColor: palette.color }]}>
                      <Text style={s.groupBadgeTxt}>{g.label}</Text>
                    </View>
                    <Text style={[s.groupSubtotal, { color: palette.color }]}>{fmt(g.subtotal)}원</Text>
                  </View>

                  {/* 계산식 행 */}
                  <View style={s.calcGrid}>
                    <CalcCell label="회원 수" value={`${g.student_count}명`} color={palette.color} />
                    <CalcOp op="×" />
                    <CalcCell label="월 수업료" value={`${fmt(g.monthly_fee)}원`} color={palette.color} />
                    <CalcOp op="=" />
                    <CalcCell label="소계" value={`${fmt(g.subtotal)}원`} color={palette.color} bold />
                  </View>

                  {/* 시수 */}
                  <View style={[s.sessionRow, { borderColor: palette.border }]}>
                    <Clock size={13} color={palette.color} />
                    <Text style={[s.sessionTxt, { color: palette.color }]}>
                      수업시수 {g.student_count}명 × {g.weekly_count}시수 = <Text style={{ fontWeight: "800" }}>{g.sessions}시수</Text>
                    </Text>
                  </View>
                </View>
              );
            })
          )}

          {/* 기타 수업 */}
          {data.extra_classes.length > 0 && (
            <>
              <Text style={s.sectionTitle}>기타 수업</Text>
              <View style={s.card}>
                {data.extra_classes.map((ec, i) => (
                  <View key={i} style={[s.extraRow, i > 0 && { borderTopWidth: 1, borderTopColor: C.border }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.extraName}>{ec.class_name}</Text>
                      <Text style={s.extraSub}>별도 정산 (단가표 외 수업)</Text>
                    </View>
                    <Text style={s.extraCount}>{ec.student_count}명</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* 단가 설정 바로가기 */}
          <Pressable
            style={[s.settingBtn, { borderColor: themeColor + "60" }]}
            onPress={() => router.push("/(admin)/pool-settings" as any)}
          >
            <Settings size={15} color={themeColor} />
            <Text style={[s.settingBtnTxt, { color: themeColor }]}>수업 단가표 설정하기</Text>
            <ChevronRight size={15} color={themeColor} />
          </Pressable>

          {/* 계산 기준 안내 */}
          <View style={s.infoCard}>
            <Text style={s.infoTitle}>계산 기준</Text>
            <Text style={s.infoItem}>• 수업시수: 주1회 = 1시수, 주2회 = 2시수, 주3회 이상 = 3시수</Text>
            <Text style={s.infoItem}>• 총 수업시수 = 각 그룹 (회원수 × 주간횟수)의 합계</Text>
            <Text style={s.infoItem}>• 매출 = 각 그룹 (회원수 × 월 수업료)의 합계</Text>
            <Text style={s.infoItem}>• 반에 배정된 활성 회원만 집계됩니다</Text>
            <Text style={s.infoItem}>• 기타 수업(체험반 등)은 별도 집계</Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function CalcCell({ label, value, color, bold }: { label: string; value: string; color: string; bold?: boolean }) {
  return (
    <View style={{ alignItems: "center", flex: 1 }}>
      <Text style={{ fontSize: 10, color: "#64748B", marginBottom: 2 }}>{label}</Text>
      <Text style={{ fontSize: 13, fontWeight: bold ? "800" : "700", color }}>{value}</Text>
    </View>
  );
}
function CalcOp({ op }: { op: string }) {
  return <Text style={{ fontSize: 16, color: "#64748B", paddingTop: 10 }}>{op}</Text>;
}

const s = StyleSheet.create({
  root:           { flex: 1, backgroundColor: C.background },
  monthRow:       { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 14, gap: 24, borderBottomWidth: 1, borderBottomColor: C.border },
  monthBtn:       { width: 36, height: 36, borderRadius: 10, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.border },
  monthTxt:       { fontSize: 17, fontWeight: "700", color: C.text },
  nowBadge:       { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, marginTop: 3 },
  nowBadgeTxt:    { fontSize: 10, fontWeight: "700", color: "#fff" },
  totalCard:      { backgroundColor: "#fff", borderRadius: 16, borderWidth: 2, marginBottom: 22, overflow: "hidden" },
  totalRow:       { flexDirection: "row", padding: 18, gap: 0 },
  totalItem:      { flex: 1, alignItems: "center", gap: 4 },
  totalDivider:   { width: 1, backgroundColor: C.border, marginVertical: 4 },
  totalLabel:     { fontSize: 12, color: C.textSecondary, fontWeight: "600" },
  totalValue:     { fontSize: 26, fontWeight: "800" },
  totalUnit:      { fontSize: 13, fontWeight: "500" },
  totalFooter:    { paddingVertical: 8, paddingHorizontal: 14, alignItems: "center" },
  totalFooterTxt: { fontSize: 11, fontWeight: "500" },
  sectionTitle:   { fontSize: 14, fontWeight: "700", color: C.text, marginBottom: 10, marginTop: 2 },
  groupCard:      { borderRadius: 14, borderWidth: 1.5, marginBottom: 12, overflow: "hidden" },
  groupHeader:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8 },
  groupBadge:     { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  groupBadgeTxt:  { fontSize: 13, fontWeight: "700", color: "#fff" },
  groupSubtotal:  { fontSize: 18, fontWeight: "800" },
  calcGrid:       { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingBottom: 12, gap: 4 },
  sessionRow:     { flexDirection: "row", alignItems: "center", gap: 6, borderTopWidth: 1, paddingHorizontal: 14, paddingVertical: 10 },
  sessionTxt:     { fontSize: 12, fontWeight: "600" },
  card:           { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: C.border, marginBottom: 12 },
  extraRow:       { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 14 },
  extraName:      { fontSize: 14, fontWeight: "700", color: C.text },
  extraSub:       { fontSize: 11, color: C.textSecondary, marginTop: 2 },
  extraCount:     { fontSize: 16, fontWeight: "700", color: "#64748B" },
  settingBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1.5, borderRadius: 12, paddingVertical: 14, marginBottom: 16 },
  settingBtnTxt:  { fontSize: 14, fontWeight: "700" },
  warningCard:    { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#E6FAF8", borderWidth: 1.5, borderColor: "#CBD5E1", borderRadius: 12, padding: 14, marginBottom: 14 },
  warningTxt:     { flex: 1, fontSize: 12, color: "#0F172A", fontWeight: "600" },
  infoCard:       { backgroundColor: "#FFFFFF", borderRadius: 12, padding: 14, gap: 5 },
  infoTitle:      { fontSize: 13, fontWeight: "700", color: C.text, marginBottom: 3 },
  infoItem:       { fontSize: 11, color: C.textSecondary, lineHeight: 17 },
  empty:          { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  emptyTxt:       { color: C.textSecondary, fontSize: 14 },
});
