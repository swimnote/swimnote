/**
 * (teacher)/teacher-gr-detail.tsx
 *
 * 선생님 전용 성장리포트 상세 화면.
 * 학생상세 History에서 진입하든 Notification에서 진입하든 동일 화면.
 *
 * route: /(teacher)/teacher-gr-detail?reportId=<id>
 * API:   GET /teacher/growth-reports/:reportId
 *
 * 금지:
 *   - AI trace / prompt / FactPackage / 내부 metadata 노출 금지
 *   - 점수/게이지/레이더 차트 금지
 *   - 댓글 작성 / 좋아요 금지 (read-only)
 *
 * 하단: "학부모 반응 보기" → growth-report-reactions
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LucideIcon } from "@/components/common/LucideIcon";
import { apiRequest, useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";

const C = Colors.light;

const NAVY   = "#0D2E5A";
const MINT   = "#3ECFBA";
const BORDER = "#E5EDF5";

interface ReportSection {
  text: string;
}

interface ReportContent {
  summary_text?: string;
  sections?: {
    core_growth?:             ReportSection;
    swimming_progress?:       ReportSection;
    behavioral_strengths?:    ReportSection;
    longitudinal_comparison?: ReportSection;
    success_conditions?:      ReportSection;
    parent_support?:          ReportSection;
    teacher_guidance?:        ReportSection;
    next_growth_direction?:   ReportSection;
  };
}

interface TeacherGrReport {
  id:             string;
  student_id:     string;
  student_name:   string;
  report_period:  string;
  published_at:   string | null;
  summary_text:   string | null;
  report_content: ReportContent | null;
}

interface ApiResponse {
  success: boolean;
  report:  TeacherGrReport;
}

const SECTION_LABELS: Record<string, string> = {
  core_growth:            "핵심 성장",
  swimming_progress:      "수영 성장",
  behavioral_strengths:   "행동 특성",
  longitudinal_comparison:"성장 흐름",
  success_conditions:     "성공 조건",
  parent_support:         "가정 지원",
  teacher_guidance:       "교사 가이드",
  next_growth_direction:  "다음 방향",
};

function formatPeriod(period: string): string {
  const parts = period.split("-");
  if (parts.length < 2) return period;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const issueM = m === 12 ? 1 : m + 1;
  const issueY = m === 12 ? y + 1 : y;
  return `${issueY}년 ${issueM}월`;
}

function formatPublishedAt(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}. 발행`;
  } catch {
    return "";
  }
}

export default function TeacherGrDetailScreen() {
  const insets    = useSafeAreaInsets();
  const { token } = useAuth();
  const params    = useLocalSearchParams<{ reportId?: string }>();
  const reportId  = params.reportId ?? "";

  const [report,  setReport]  = useState<TeacherGrReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !reportId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await apiRequest(token, `/teacher/growth-reports/${encodeURIComponent(reportId)}`);
      if (r.ok) {
        const data = (await r.json()) as ApiResponse;
        setReport(data.report ?? null);
      } else if (r.status === 403 || r.status === 404) {
        setError("현재 이 학생의 성장리포트에 접근할 권한이 없습니다.");
      } else {
        setError("리포트를 불러올 수 없습니다.");
      }
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, [token, reportId]);

  useEffect(() => { load(); }, [load]);

  const goReactions = useCallback(() => {
    router.push({
      pathname: "/(teacher)/growth-report-reactions",
      params: { reportId, source: "teacher-gr-detail" },
    } as any);
  }, [reportId]);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={s.backBtn}>
          <LucideIcon name="arrow-left" size={20} color={C.text} />
        </Pressable>
        <Text style={s.headerTitle}>성장리포트</Text>
        <View style={{ width: 32 }} />
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={C.primary} />
        </View>
      ) : error ? (
        <View style={s.center}>
          <LucideIcon name="lock" size={36} color={C.textTertiary} />
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : !report ? (
        <View style={s.center}>
          <Text style={s.errorText}>리포트를 찾을 수 없습니다.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
        >
          {/* ── 리포트 헤더 카드 ── */}
          <View style={[s.heroCard, { backgroundColor: NAVY }]}>
            <Text style={s.heroLabel}>AI 성장리포트</Text>
            <Text style={s.heroPeriod}>{formatPeriod(report.report_period)}</Text>
            <Text style={s.heroStudent}>{report.student_name}</Text>
            {report.published_at && (
              <Text style={s.heroDate}>{formatPublishedAt(report.published_at)}</Text>
            )}
          </View>

          {/* ── 요약 ── */}
          {(report.summary_text || report.report_content?.summary_text) && (
            <View style={s.summaryCard}>
              <View style={s.summaryHeader}>
                <View style={[s.mintDot, { backgroundColor: MINT }]} />
                <Text style={[s.summaryTitle, { color: NAVY }]}>종합 요약</Text>
              </View>
              <Text style={[s.summaryText, { color: C.text }]}>
                {report.summary_text || report.report_content?.summary_text}
              </Text>
            </View>
          )}

          {/* ── 섹션들 ── */}
          {report.report_content?.sections && Object.entries(report.report_content.sections).map(([key, sec]) => {
            if (!sec?.text) return null;
            const label = SECTION_LABELS[key] ?? key;
            return (
              <View key={key} style={s.sectionCard}>
                <View style={s.sectionHeader}>
                  <View style={[s.sectionAccent, { backgroundColor: MINT }]} />
                  <Text style={[s.sectionTitle, { color: NAVY }]}>{label}</Text>
                </View>
                <Text style={[s.sectionText, { color: C.text }]}>{sec.text}</Text>
              </View>
            );
          })}

          {/* ── 학부모 반응 보기 ── */}
          <Pressable
            style={s.reactionsBtn}
            onPress={goReactions}
          >
            <LucideIcon name="heart" size={16} color={NAVY} />
            <Text style={[s.reactionsBtnTxt, { color: NAVY }]}>학부모 반응 보기</Text>
            <LucideIcon name="chevron-right" size={16} color={NAVY} />
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: BORDER,
    backgroundColor: C.background,
  },
  backBtn:     { width: 32, alignItems: "flex-start" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "600", color: C.text },
  center:      { flex: 1, justifyContent: "center", alignItems: "center", gap: 14, padding: 24 },
  errorText:   { fontSize: 14, color: C.textSecondary, textAlign: "center", lineHeight: 22 },

  heroCard: {
    margin: 16, borderRadius: 16, padding: 24,
    gap: 4,
  },
  heroLabel:   { fontSize: 11, color: "#94B8DC", fontWeight: "600", letterSpacing: 0.5 },
  heroPeriod:  { fontSize: 22, fontWeight: "700", color: "#FFFFFF", marginTop: 4 },
  heroStudent: { fontSize: 15, color: "#C5D8EF", marginTop: 2 },
  heroDate:    { fontSize: 12, color: "#7BA8CA", marginTop: 6 },

  summaryCard: {
    marginHorizontal: 16, marginBottom: 12,
    backgroundColor: C.card, borderRadius: 14, padding: 18,
    borderWidth: 1, borderColor: BORDER,
  },
  summaryHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  mintDot:       { width: 8, height: 8, borderRadius: 4 },
  summaryTitle:  { fontSize: 13, fontWeight: "700" },
  summaryText:   { fontSize: 14, lineHeight: 22 },

  sectionCard: {
    marginHorizontal: 16, marginBottom: 10,
    backgroundColor: C.card, borderRadius: 14, padding: 18,
    borderWidth: 1, borderColor: BORDER,
  },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  sectionAccent: { width: 3, height: 16, borderRadius: 2 },
  sectionTitle:  { fontSize: 13, fontWeight: "700" },
  sectionText:   { fontSize: 14, lineHeight: 22 },

  reactionsBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, marginHorizontal: 16, marginTop: 8, marginBottom: 8,
    paddingVertical: 14, borderRadius: 12,
    borderWidth: 1.5, borderColor: "#D0DCF0",
    backgroundColor: "#F0F5FF",
  },
  reactionsBtnTxt: { fontSize: 14, fontWeight: "600" },
});
