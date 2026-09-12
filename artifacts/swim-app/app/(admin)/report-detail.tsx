/**
 * (admin)/report-detail.tsx — AI 성장리포트 상세 (관리자)
 *
 * report-hub에서 report_id를 전달받아 진입.
 * - 학생명 / 대상 월 / 반 / 담당 선생님 / 상태 / 발송 현황 표시
 * - report_content 섹션 표시 (빈 섹션 숨김)
 * - claim_ids / fact_package / trace / grounding metadata 노출 금지
 * - back → report-hub
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

const C    = Colors.light;
const MINT      = "#355C7D";
const NAVY      = "#23415C";
const MINT_LIGHT = "#E9EEF3";

// ── 상태 표시 ────────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { label: string; bg: string; text: string }> = {
  GENERATING:          { label: "생성 중",      bg: "#EDE7F6", text: "#4527A0" },
  ANALYSIS_FAILED:     { label: "분석 실패",     bg: "#FFEBEE", text: "#C62828" },
  REVIEW_REQUIRED:     { label: "검수 필요",     bg: "#FFF9C4", text: "#795548" },
  APPROVED:            { label: "검수 완료",     bg: "#E8F5E9", text: "#2E7D32" },
  READY_TO_SEND:       { label: "발송 대기",     bg: "#E3F2FD", text: "#1565C0" },
  PUBLISHED:           { label: "발송 완료",     bg: "#E8F5E9", text: "#1B5E20" },
  DISCARDED:           { label: "폐기됨",        bg: "#FAFAFA", text: "#757575" },
  AUTO_ACCEPTED:       { label: "자동 승인",     bg: "#E8F5E9", text: "#2E7D32" },
  EXCLUDED:            { label: "발급 제외",     bg: "#F5F5F5", text: "#9E9E9E" },
};

const REVIEW_ACTION_MAP: Record<string, string> = {
  APPROVE:            "선생님 승인",
  REQUEST_REANALYSIS: "재분석 요청",
};

function getStatus(s: string) {
  return STATUS_MAP[s] ?? { label: s, bg: "#EEEEEE", text: "#424242" };
}

// ── 리포트 콘텐츠 섹션 파서 ──────────────────────────────────────────────────

interface ReportSection { title?: string; content?: string; [key: string]: unknown }

// 섹션 key → 한국어 라벨 매핑
const SECTION_TITLE_MAP: Record<string, string> = {
  core_growth:            "핵심 성장",
  swimming_progress:      "교육과정 진행",
  success_conditions:     "성공 조건",
  parent_support:         "부모 지원 방향",
  teacher_guidance:       "선생님 가이드",
  behavioral_strengths:   "수업에서 보인 강점",
  next_growth_direction:  "다음 성장 방향",
  longitudinal_comparison:"성장 추이",
};

function parseSections(raw: unknown): ReportSection[] {
  if (!raw) return [];
  // Array 직접 전달
  if (Array.isArray(raw)) return raw as ReportSection[];
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    // { sections: [...] } — Array
    if (Array.isArray(obj["sections"])) return obj["sections"] as ReportSection[];
    if (Array.isArray(obj["content"]))  return obj["content"]  as ReportSection[];
    // { sections: { core_growth: {text, is_empty}, ... } } — Object dict
    const secObj = obj["sections"];
    if (secObj && typeof secObj === "object" && !Array.isArray(secObj)) {
      return Object.entries(secObj as Record<string, unknown>)
        .filter(([, v]) => v && typeof v === "object" && !(v as any).is_empty)
        .map(([k, v]) => ({
          title:   SECTION_TITLE_MAP[k] ?? k,
          content: (v as any).text ?? "",
        }));
    }
  }
  return [];
}

// ── 메인 화면 ────────────────────────────────────────────────────────────────

interface ReportDetail {
  report_id:              string;
  product_status:         string;
  analysis_status?:       string;
  report_period?:         string;
  version_number?:        number;
  published_at?:          string;
  created_at?:            string;
  teacher_reviewed_at?:   string;
  teacher_review_action?: string;
  teacher_review_note?:   string;
  report_period_open?:    string;
  report_period_close?:   string;
  student: {
    id:           string;
    name?:        string;
    class_name?:  string;
    teacher_name?: string;
  };
  report_content?: unknown;
}

export default function AdminReportDetailScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { report_id } = useLocalSearchParams<{ report_id: string }>();

  const [detail,  setDetail]  = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !report_id) { setError("잘못된 접근입니다."); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest(token, `/admin/growth-reports/${report_id}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error === "REPORT_NOT_FOUND" ? "리포트를 찾을 수 없습니다." : "서버 오류가 발생했습니다.");
        return;
      }
      const data = await res.json();
      setDetail(data);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, [token, report_id]);

  useEffect(() => { void load(); }, [load]);

  // ── 렌더링 ─────────────────────────────────────────────────────────────────

  const renderContent = () => {
    if (loading) return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={MINT} />
      </View>
    );
    if (error) return (
      <View style={s.center}>
        <LucideIcon name="alert-circle" size={36} color={C.textMuted} />
        <Text style={s.errorTxt}>{error}</Text>
        <Pressable style={s.retryBtn} onPress={load}>
          <Text style={s.retryTxt}>다시 시도</Text>
        </Pressable>
      </View>
    );
    if (!detail) return null;

    const sd = getStatus(detail.product_status);
    const stu = detail.student;
    // 발행월 기준 표시: report_period(데이터월) + 1 = 발행월
    const periodLabel = (() => {
      if (!detail.report_period) return "";
      const [y, m] = detail.report_period.split("-").map(Number);
      const issueM = m === 12 ? 1 : m + 1;
      const issueY = m === 12 ? y + 1 : y;
      return `${issueY}.${String(issueM).padStart(2, "0")}`;
    })();
    const verLabel = (detail.version_number ?? 1) > 1 ? ` v${detail.version_number}` : "";
    const reviewLabel = detail.teacher_review_action
      ? REVIEW_ACTION_MAP[detail.teacher_review_action] ?? detail.teacher_review_action
      : null;
    const reviewedAt = detail.teacher_reviewed_at
      ? new Date(detail.teacher_reviewed_at).toLocaleDateString("ko-KR")
      : null;
    // PostgreSQL timestamp("2026-09-07 08:42:52.368157+00") 안전 파싱
    // iOS JavaScriptCore: space→T 필수, microseconds(6자리) → milli(3자리) truncate 필수
    const parseDateSafe = (s?: string | null): Date | null => {
      if (!s) return null;
      const normalized = s
        .replace(" ", "T")                       // PostgreSQL space → T
        .replace(/(\.\d{3})\d+/, "$1")           // microseconds(6) → ms(3)
        .replace(/([+-])(\d{2})$/, "$1$2:00");   // +00 → +00:00 (ISO 8601 필수)
      const d = new Date(normalized);
      return isNaN(d.getTime()) ? null : d;
    };
    const publishedAt = parseDateSafe(detail.published_at)?.toLocaleDateString("ko-KR") ?? null;

    const sections = parseSections(detail.report_content);
    // 빈 evidence 섹션 숨김 (앱 정책)
    const visibleSections = sections.filter(
      sec => (sec.content && String(sec.content).trim().length > 0)
    );

    return (
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* 학생 정보 카드 */}
        <View style={s.card}>
          <View style={s.rowSpread}>
            <Text style={s.studentName}>{stu.name ?? "-"}{verLabel}</Text>
            <View style={[s.chip, { backgroundColor: sd.bg }]}>
              <Text style={[s.chipTxt, { color: sd.text }]}>{sd.label}</Text>
            </View>
          </View>

          <View style={s.metaRow}>
            <LucideIcon name="calendar" size={13} color={C.textMuted} />
            <Text style={s.metaTxt}>{periodLabel || "-"} 리포트</Text>
          </View>
          {stu.class_name ? (
            <View style={s.metaRow}>
              <LucideIcon name="users" size={13} color={C.textMuted} />
              <Text style={s.metaTxt}>{stu.class_name}</Text>
            </View>
          ) : null}
          {stu.teacher_name ? (
            <View style={s.metaRow}>
              <LucideIcon name="user" size={13} color={C.textMuted} />
              <Text style={s.metaTxt}>담당: {stu.teacher_name}</Text>
            </View>
          ) : null}
        </View>

        {/* 검수/발송 현황 */}
        <View style={s.card}>
          <Text style={s.sectionTitle}>검수 · 발송 현황</Text>
          <View style={s.statusRow}>
            <Text style={s.statusLabel}>선생님 검수</Text>
            <Text style={s.statusValue}>
              {reviewLabel ?? "미완료"}
              {reviewedAt ? `  ${reviewedAt}` : ""}
            </Text>
          </View>
          {detail.teacher_review_note ? (
            <View style={s.statusRow}>
              <Text style={s.statusLabel}>검수 메모</Text>
              <Text style={[s.statusValue, { flex: 1, flexWrap: "wrap" }]}>
                {detail.teacher_review_note}
              </Text>
            </View>
          ) : null}
          <View style={s.statusRow}>
            <Text style={s.statusLabel}>발송 일시</Text>
            <Text style={s.statusValue}>{publishedAt ?? "미발송"}</Text>
          </View>
        </View>

        {/* 리포트 내용 */}
        {visibleSections.length > 0 ? (
          <View style={s.card}>
            <Text style={s.sectionTitle}>리포트 내용</Text>
            {visibleSections.map((sec, idx) => (
              <View key={idx} style={idx < visibleSections.length - 1 ? s.secBlock : s.secBlockLast}>
                {sec.title ? (
                  <Text style={s.secTitle}>{String(sec.title)}</Text>
                ) : null}
                <Text style={s.secBody}>{String(sec.content ?? "")}</Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={s.card}>
            <Text style={s.sectionTitle}>리포트 내용</Text>
            <Text style={s.emptyTxt}>표시할 내용이 없습니다.</Text>
          </View>
        )}
      </ScrollView>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      {/* 헤더 */}
      <View style={[s.header, { paddingTop: insets.top + 14 }]}>
        <Pressable hitSlop={12} onPress={() => router.replace("/(admin)/report-hub" as any)} style={s.backBtn}>
          <LucideIcon name="arrow-left" size={20} color="#F0F4FF" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={s.title}>성장리포트 상세</Text>
            <View style={s.xBadge}>
              <Text style={s.xBadgeTxt}>SWIMNOTE X</Text>
            </View>
          </View>
          <Text style={s.headerSub}>AI 성장리포트 관리자 뷰</Text>
        </View>
      </View>

      {renderContent()}
    </View>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header:     { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: NAVY },
  backBtn:    { padding: 4 },
  title:      { fontSize: 18, fontWeight: "700", color: "#F0F4FF" },
  headerSub:  { fontSize: 12, color: "#8AB0D4", marginTop: 2 },
  xBadge:     { backgroundColor: MINT_LIGHT, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  xBadgeTxt:  { fontSize: 9, fontWeight: "700", color: MINT, letterSpacing: 0.5 },

  center:     { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  errorTxt:   { fontSize: 14, color: C.textMuted, textAlign: "center" },
  retryBtn:   { marginTop: 8, paddingVertical: 10, paddingHorizontal: 24, backgroundColor: MINT, borderRadius: 8 },
  retryTxt:   { color: "#fff", fontWeight: "600", fontSize: 14 },

  card:       { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 12, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: NAVY, marginBottom: 12 },

  rowSpread:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  studentName: { fontSize: 18, fontWeight: "700", color: "#212121" },
  chip:       { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  chipTxt:    { fontSize: 11, fontWeight: "600" },

  metaRow:    { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  metaTxt:    { fontSize: 13, color: C.textMuted },

  statusRow:  { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8, gap: 8 },
  statusLabel: { fontSize: 13, color: C.textMuted, minWidth: 80 },
  statusValue: { fontSize: 13, color: "#212121", fontWeight: "500", textAlign: "right" },

  secBlock:   { marginBottom: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: "#F0F0F0" },
  secBlockLast: { marginBottom: 0 },
  secTitle:   { fontSize: 13, fontWeight: "700", color: NAVY, marginBottom: 6 },
  secBody:    { fontSize: 14, color: "#333", lineHeight: 22 },
  emptyTxt:   { fontSize: 13, color: C.textMuted, textAlign: "center", marginVertical: 12 },
});
