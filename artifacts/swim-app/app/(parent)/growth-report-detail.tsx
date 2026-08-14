/**
 * (parent)/growth-report-detail.tsx — GR8: Parent Native Growth Report Detail
 *
 * Deep link contract (GR7 spec §9):
 *   route: /(parent)/growth-report-detail?reportId=<reportId>
 *   entry: Push notification tap / Notification Center tap / Feed item tap
 *   auth: server-side ownership (PUBLISHED only, X expiry: PUBLISHED viewing 무제한)
 *
 * 원칙 (GR8 spec):
 *   - APP은 ENGINE 결과를 렌더링만 한다 (분석/점수/요약 재생성 금지)
 *   - section 없으면 해당 영역 자체 생략 (빈 박스 금지)
 *   - 점수/별점/퍼센트/게이지/레이더 차트 금지
 *   - PDF/SNS share는 GR9
 *   - 전체 내용 표시 (numberOfLines 잘림 금지)
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { API_BASE, apiRequest, useAuth } from "@/context/AuthContext";
import { LucideIcon } from "@/components/common/LucideIcon";
import Colors from "@/constants/colors";

const C = Colors.light;

// ── 색상 토큰 (기존 SWIMNOTE 브랜드) ─────────────────────────────────────
const NAVY  = "#0D2E5A";
const MINT  = "#3ECFBA";
const BORDER = "#E5EDF5";
const SECTION_BG = "#F7FAFD";

// ── 타입 ─────────────────────────────────────────────────────────────────

interface ReportSection {
  text: string;
}

interface ReportContent {
  summary_text: string;
  composition_version?: string;
  sections: {
    core_growth?:              ReportSection;
    swimming_progress?:        ReportSection;
    behavioral_strengths?:     ReportSection;
    longitudinal_comparison?:  ReportSection;
    success_conditions?:       ReportSection;
    parent_support?:           ReportSection;
    teacher_guidance?:         ReportSection;
    next_growth_direction?:    ReportSection;
  };
}

interface SnsSummary {
  headline:              string;
  key_points:            string[];
  share_safe:            boolean;
  supporting_claim_ids?: string[];
}

interface GrowthReportDetail {
  report_id:      string;
  student_id:     string;
  report_period:  string;
  published_at:   string;
  report_content: ReportContent;
  sns_summary:    SnsSummary | null;
}

// ── 에러 구분 (spec §10) ──────────────────────────────────────────────────

type DetailError =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "UNPUBLISHED"
  | "INVALID_REPORT_CONTENT"
  | "NETWORK_ERROR"
  | "SERVER_ERROR"
  | "INVALID_REPORT_ID";

// ── Section title 번역 (spec §13) ─────────────────────────────────────────

const SECTION_LABELS: Record<string, string> = {
  core_growth:             "이번 달에 확인된 성장",
  swimming_progress:       "수영에서 확인된 변화",
  behavioral_strengths:    "수업에서 보인 강점",
  longitudinal_comparison: "지난 기록과 이어서 보기",
  success_conditions:      "이런 상황에서 더 잘 나타났어요",
  parent_support:          "가정에서 참고할 포인트",
  teacher_guidance:        "수업에서 이어갈 포인트",
  next_growth_direction:   "다음에 관찰할 성장 방향",
};

// canonical section order (spec §12)
const SECTION_ORDER = [
  "core_growth",
  "swimming_progress",
  "behavioral_strengths",
  "longitudinal_comparison",
  "success_conditions",
  "parent_support",
  "teacher_guidance",
  "next_growth_direction",
] as const;

// ── 에러 메시지 (학부모 친화적) ───────────────────────────────────────────

function errorMessage(code: DetailError): string {
  switch (code) {
    case "NOT_FOUND":              return "리포트를 찾을 수 없습니다.";
    case "FORBIDDEN":              return "이 리포트에 접근할 수 없습니다.";
    case "UNPUBLISHED":            return "아직 공개되지 않은 리포트입니다.";
    case "INVALID_REPORT_CONTENT": return "리포트 데이터를 불러올 수 없습니다.";
    case "NETWORK_ERROR":          return "네트워크 연결을 확인해 주세요.";
    case "INVALID_REPORT_ID":      return "올바르지 않은 리포트 주소입니다.";
    default:                       return "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
  }
}

function errorIcon(code: DetailError): string {
  switch (code) {
    case "FORBIDDEN":  return "lock";
    case "NOT_FOUND":  return "file-x";
    case "UNPUBLISHED": return "clock";
    case "NETWORK_ERROR": return "wifi-off";
    default:           return "alert-circle";
  }
}

// ── 메인 화면 ────────────────────────────────────────────────────────────

export default function GrowthReportDetailScreen() {
  const insets     = useSafeAreaInsets();
  const { token }  = useAuth();
  const { reportId } = useLocalSearchParams<{ reportId?: string }>();

  const [detail,    setDetail]    = useState<GrowthReportDetail | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<DetailError | null>(null);
  const mounted = useRef(true);

  // unmount 후 stale update 방지 (spec §9)
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // ── 데이터 로드 (중복 요청 방지: loading guard) ──────────────────────

  const fetchDetail = useCallback(async () => {
    if (!reportId || reportId.trim().length === 0) {
      if (mounted.current) { setError("INVALID_REPORT_ID"); setLoading(false); }
      return;
    }

    if (!mounted.current) return;
    setLoading(true);
    setError(null);

    try {
      const res = await apiRequest(token, `/parent/growth-reports/${encodeURIComponent(reportId)}`);

      if (!mounted.current) return;

      if (res.status === 401) {
        setError("FORBIDDEN"); setLoading(false); return;
      }
      if (res.status === 403) {
        // 서버가 FORBIDDEN / UNPUBLISHED 구분
        try {
          const body = await res.json();
          const code = body?.error;
          if (code === "UNPUBLISHED") { setError("UNPUBLISHED"); }
          else                        { setError("FORBIDDEN"); }
        } catch { setError("FORBIDDEN"); }
        setLoading(false); return;
      }
      if (res.status === 404) {
        setError("NOT_FOUND"); setLoading(false); return;
      }
      if (res.status === 500) {
        try {
          const body = await res.json();
          if (body?.error === "INVALID_REPORT_CONTENT") {
            setError("INVALID_REPORT_CONTENT");
          } else {
            setError("SERVER_ERROR");
          }
        } catch { setError("SERVER_ERROR"); }
        setLoading(false); return;
      }
      if (!res.ok) {
        setError("SERVER_ERROR"); setLoading(false); return;
      }

      const data = await res.json();

      if (!mounted.current) return;

      if (!data.success || !data.report_content) {
        setError("INVALID_REPORT_CONTENT"); setLoading(false); return;
      }

      setDetail(data as GrowthReportDetail);
      setLoading(false);
    } catch {
      if (mounted.current) { setError("NETWORK_ERROR"); setLoading(false); }
    }
  }, [token, reportId]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  // ── 공통 헤더 ─────────────────────────────────────────────────────────

  const header = (
    <View style={[s.header, { paddingTop: insets.top + 8 }]}>
      <Pressable
        onPress={() => router.back()}
        style={s.backBtn}
        hitSlop={12}
        accessibilityLabel="뒤로가기"
        accessibilityRole="button"
      >
        <LucideIcon name="chevron-left" size={24} color={NAVY} />
      </Pressable>
      <Text style={s.headerTitle}>성장리포트</Text>
      <View style={s.backBtn} />
    </View>
  );

  // ── 로딩 ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={s.root}>
        {header}
        <View style={s.centered}>
          <ActivityIndicator size="large" color={MINT} />
          <Text style={s.loadingLabel}>리포트를 불러오는 중...</Text>
        </View>
      </View>
    );
  }

  // ── 에러 ──────────────────────────────────────────────────────────────

  if (error || !detail) {
    const code = error ?? "SERVER_ERROR";
    return (
      <View style={s.root}>
        {header}
        <View style={s.centered}>
          <LucideIcon name={errorIcon(code) as any} size={40} color="#C0C7D0" />
          <Text style={s.errorTitle}>{errorMessage(code)}</Text>
          {(code === "NETWORK_ERROR" || code === "SERVER_ERROR") && (
            <Pressable
              onPress={fetchDetail}
              style={s.retryBtn}
              accessibilityRole="button"
              accessibilityLabel="다시 시도"
            >
              <Text style={s.retryText}>다시 시도</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  // ── 정상 렌더 ─────────────────────────────────────────────────────────

  const { report_period, published_at, report_content, sns_summary } = detail;
  const [year, month] = report_period.split("-");
  const periodLabel = year && month ? `${year}년 ${Number(month)}월` : report_period;
  const publishedDate = published_at
    ? new Date(published_at).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })
    : null;

  return (
    <View style={s.root}>
      {header}
      {/* 전체 scroll — nested scroll 없음 (spec §33) */}
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        alwaysBounceVertical={false}
      >
        {/* ── 리포트 기간 헤더 ── */}
        <View style={s.periodCard}>
          <View style={s.periodBadge}>
            <LucideIcon name="bar-chart-2" size={14} color={NAVY} />
            <Text style={s.periodBadgeText}>성장리포트</Text>
          </View>
          <Text style={s.periodLabel} accessibilityRole="header">
            {periodLabel}
          </Text>
          {publishedDate && (
            <Text style={s.publishedDate}>{publishedDate} 공개</Text>
          )}
        </View>

        {/* ── 요약 (spec §14 — APP 재작성 금지) ── */}
        {!!report_content.summary_text && (
          <View style={s.summaryCard}>
            <Text style={s.summaryText}>{report_content.summary_text}</Text>
          </View>
        )}

        {/* ── 섹션 (canonical order, spec §12) ── */}
        {SECTION_ORDER.map((key) => {
          const sec = report_content.sections?.[key];
          // 없는 섹션 완전 생략 (spec §11, §17, §18)
          if (!sec || !sec.text || sec.text.trim().length === 0) return null;
          return (
            <ReportSectionCard
              key={key}
              sectionKey={key}
              label={SECTION_LABELS[key] ?? key}
              text={sec.text}
            />
          );
        })}

        {/* 하단 여백 */}
        <View style={{ height: insets.bottom + 32 }} />
      </ScrollView>
    </View>
  );
}

// ── 섹션 카드 컴포넌트 ────────────────────────────────────────────────────

function ReportSectionCard({
  sectionKey,
  label,
  text,
}: {
  sectionKey: string;
  label: string;
  text: string;
}) {
  return (
    <View
      style={s.sectionCard}
      accessibilityLabel={label}
    >
      <View style={s.sectionHeader}>
        <View style={s.sectionDot} />
        <Text style={s.sectionTitle} accessibilityRole="header">
          {label}
        </Text>
      </View>
      {/* 전체 내용 표시 — numberOfLines 없음 (spec §32, §33) */}
      <Text style={s.sectionText}>{text}</Text>
    </View>
  );
}

// ── 스타일 ───────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:         { flex: 1, backgroundColor: "#fff" },
  header:       {
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom:  12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: "#fff",
  },
  backBtn:      { width: 40, alignItems: "flex-start" },
  headerTitle:  { fontSize: 17, fontWeight: "600", color: NAVY },

  scroll:       { flex: 1 },
  scrollContent: { paddingTop: 20, paddingHorizontal: 16 },

  // 기간 카드
  periodCard: {
    backgroundColor: "#EAF4FF",
    borderRadius: 16,
    padding: 20,
    marginBottom: 14,
    gap: 6,
  },
  periodBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 2,
  },
  periodBadgeText: {
    fontSize: 12,
    fontFamily: "Pretendard-SemiBold",
    color: NAVY,
    letterSpacing: 0.3,
  },
  periodLabel: {
    fontSize: 22,
    fontFamily: "Pretendard-Bold",
    color: NAVY,
  },
  publishedDate: {
    fontSize: 12,
    fontFamily: "Pretendard-Regular",
    color: "#6B8099",
  },

  // 요약 카드
  summaryCard: {
    backgroundColor: SECTION_BG,
    borderRadius: 14,
    padding: 18,
    marginBottom: 14,
    borderLeftWidth: 3,
    borderLeftColor: MINT,
  },
  summaryText: {
    fontSize: 14,
    fontFamily: "Pretendard-Regular",
    color: "#2C3E50",
    lineHeight: 24,
  },

  // 섹션 카드
  sectionCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 10,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: MINT,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: "Pretendard-SemiBold",
    color: NAVY,
    flex: 1,
  },
  sectionText: {
    fontSize: 14,
    fontFamily: "Pretendard-Regular",
    color: "#2C3E50",
    lineHeight: 24,
  },

  // 로딩 / 에러 공통
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 32,
  },
  loadingLabel: {
    fontSize: 14,
    color: "#888",
    fontFamily: "Pretendard-Regular",
  },
  errorTitle: {
    fontSize: 15,
    color: "#555",
    textAlign: "center",
    fontFamily: "Pretendard-Regular",
    lineHeight: 24,
  },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: NAVY,
    borderRadius: 10,
  },
  retryText: {
    fontSize: 14,
    color: "#fff",
    fontFamily: "Pretendard-SemiBold",
  },
});
