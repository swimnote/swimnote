/**
 * report-hub.tsx — WP8: AI 성장리포트 발송 관리 (STEP 5 Dashboard)
 *
 * 플로우:
 *   배치 자동 생성 → READY_TO_SEND (관리자 확인) → [발송] → PUBLISHED (부모 노출)
 *                                              → [폐기] → DISCARDED → [재발급] → REGENERATING → ...
 *
 * 엔드포인트:
 *   GET  /admin/growth-reports/monthly-summary  — KPI 요약
 *   GET  /admin/growth-reports/monthly-list     — 학생 목록 (최신 version)
 *   GET  /admin/growth-reports/:id              — 상세
 *   POST /admin/growth-reports/:id/send         — 개별 발송
 *   PUT  /admin/growth-reports/:id/discard      — 폐기
 *   POST /admin/growth-reports/:id/regenerate   — 재발급
 *   POST /admin/growth-reports/bulk-send        — 전체 발송 (READY_TO_SEND만)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import { SubScreenHeader }  from "@/components/common/SubScreenHeader";
import { LucideIcon }       from "@/components/common/LucideIcon";
import { ConfirmModal }     from "@/components/common/ConfirmModal";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useMode } from "@/context/ModeContext";
import { isXMode } from "@/constants/xTheme";
import { useFeatureGuide } from "@/hooks/useOnboarding";
import { OnboardingSheet } from "@/components/onboarding/OnboardingSheet";
import { GUIDE_CONTENT } from "@/constants/onboardingContent";
import Colors from "@/constants/colors";

const C = Colors.light;

// ── 상수 ──────────────────────────────────────────────────────────────────────

const MONTHS = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];

// ── API 월 계약: 외부 API는 모두 report_month (발행월) 기준 ──────────────────
// 서버가 내부에서 computeAnalysisPeriod(reportYear, reportMonth)로 분석월(-1) 변환.
// 앱은 탭 월(발행월)을 그대로 전송 — toDataMonth 변환 제거.

/**
 * report_period("2026-08") → 발행월 라벨("2026년 9월")
 * 데이터월 + 1 = 발행월
 */
function toIssueLabel(period: string): string {
  const parts = period.split("-");
  if (parts.length < 2) return period;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const issueM = m === 12 ? 1 : m + 1;
  const issueY = m === 12 ? y + 1 : y;
  return `${issueY}년 ${issueM}월`;
}

const DISCARD_REASONS = ["글자·레이아웃 오류","내용 오류","데이터 누락","기타"] as const;
type DiscardReason = typeof DISCARD_REASONS[number];

// ── 타입 ──────────────────────────────────────────────────────────────────────

interface MonthlyReportSummary {
  year:              number;
  month:             number;
  period:            string;
  target_count:      number;
  ready_count:       number;
  published_count:   number;
  failed_count:      number;
  regenerating_count: number;
  discarded_count:   number;
  batch_status:      string | null;
}

interface MonthlyListItem {
  report_id:       string;
  student_id:      string;
  student_name:    string;
  product_status:  string;
  analysis_status: string | null;
  version_number:  number;
  discard_reason:  string | null;
  discarded_at:    string | null;
  period_start:    string;
  period_end:      string;
  report_period:   string;
  published_at:    string | null;
  updated_at:      string;
  class_name:      string | null;
  teacher_name:    string | null;
  content_snippet: string | null;
}

// ── 상태 표시 정의 ───────────────────────────────────────────────────────────

const STATUS_DISPLAY: Record<string, { label: string; bg: string; text: string }> = {
  READY_TO_SEND:      { label: "발송 대기",  bg: "#FFF8E1", text: "#E65100" },
  PUBLISHED:          { label: "발행 완료",  bg: "#E8F5E9", text: "#2E7D32" },
  DISCARDED:          { label: "폐기됨",     bg: "#FFEBEE", text: "#B71C1C" },
  REGENERATING:       { label: "재생성 중",  bg: "#E3F2FD", text: "#1565C0" },
  ANALYZING:          { label: "분석 중",    bg: "#E3F2FD", text: "#1565C0" },
  PREANALYZING:       { label: "분석 중",    bg: "#E3F2FD", text: "#1565C0" },
  READY_FOR_ANALYSIS: { label: "분석 준비",  bg: "#E8EAF6", text: "#3949AB" },
  REVIEW_REQUIRED:    { label: "검수 대기",  bg: "#FFF3E0", text: "#E65100" },
  APPROVED:           { label: "승인 완료",  bg: "#F3E5F5", text: "#6A1B9A" },
  FAILED:             { label: "실패",       bg: "#FFEBEE", text: "#C62828" },
  ANALYSIS_FAILED:    { label: "분석 실패",  bg: "#FFEBEE", text: "#C62828" },
  OPEN:               { label: "대기 중",    bg: "#F5F5F5", text: "#757575" },
  EXCLUDED:           { label: "발급 제외",  bg: "#F5F5F5", text: "#9E9E9E" },
};

function getStatusDisplay(status: string) {
  return STATUS_DISPLAY[status] ?? { label: status, bg: "#F5F5F5", text: "#757575" };
}

function isAnalyzingState(status: string): boolean {
  return ["PREANALYZING","ANALYZING","REGENERATING"].includes(status);
}

// ── KPI 집계 ─────────────────────────────────────────────────────────────────

interface KpiCounts {
  total: number;
  beforeGen: number;  // OPEN, READY_FOR_ANALYSIS
  analyzing: number;  // PREANALYZING, ANALYZING, REGENERATING
  reviewing: number;  // REVIEW_REQUIRED, APPROVED
  ready:     number;  // READY_TO_SEND
  published: number;  // PUBLISHED
  discarded: number;  // DISCARDED
  excluded:  number;  // EXCLUDED
  failed:    number;  // FAILED, ANALYSIS_FAILED
}

function computeKpi(items: MonthlyListItem[]): KpiCounts {
  const counts: KpiCounts = { total: items.length, beforeGen: 0, analyzing: 0, reviewing: 0, ready: 0, published: 0, discarded: 0, excluded: 0, failed: 0 };
  for (const it of items) {
    const s = it.product_status;
    if (["OPEN","READY_FOR_ANALYSIS"].includes(s))          counts.beforeGen++;
    else if (["PREANALYZING","ANALYZING","REGENERATING"].includes(s)) counts.analyzing++;
    else if (["REVIEW_REQUIRED","APPROVED"].includes(s))    counts.reviewing++;
    else if (s === "READY_TO_SEND")                         counts.ready++;
    else if (s === "PUBLISHED")                             counts.published++;
    else if (s === "DISCARDED")                             counts.discarded++;
    else if (s === "EXCLUDED")                              counts.excluded++;
    else if (["FAILED","ANALYSIS_FAILED"].includes(s))      counts.failed++;
  }
  return counts;
}

// ── 상태 필터 옵션 ────────────────────────────────────────────────────────────

const FILTER_OPTIONS: { label: string; value: string[] | null }[] = [
  { label: "전체",     value: null },
  { label: "검수 대기", value: ["REVIEW_REQUIRED","APPROVED"] },
  { label: "발송 대기", value: ["READY_TO_SEND"] },
  { label: "발행 완료", value: ["PUBLISHED"] },
  { label: "발급 제외", value: ["EXCLUDED"] },
  { label: "제외·실패", value: ["DISCARDED","FAILED","ANALYSIS_FAILED"] },
];

// ── BatchStatusBadge ──────────────────────────────────────────────────────────

const BATCH_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  PENDING:   { label: "배치 대기 중",   color: "#757575" },
  RUNNING:   { label: "배치 실행 중",   color: "#1565C0" },
  COMPLETED: { label: "배치 완료",      color: "#2E7D32" },
  PARTIAL:   { label: "배치 일부 완료", color: "#E65100" },
  FAILED:    { label: "배치 실패",      color: "#C62828" },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 화면
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export default function ReportHubScreen() {
  const { token, adminUser } = useAuth();
  const { mode } = useMode();
  const inX = isXMode(mode);
  // Growth report guide: X모드 = x_growth_report, 일반 = admin_growth_report (중복 노출 0)
  const { shouldShow: showAdminGrowthGuide, markSeen: markAdminGrowthGuideSeen } = useFeatureGuide(adminUser?.id, "admin_growth_report");
  const { shouldShow: showXGrowthGuide, markSeen: markXGrowthGuideSeen } = useFeatureGuide(adminUser?.id, "x_growth_report");
  const activeReportGuideSlides = inX
    ? [{ icon: undefined, title: GUIDE_CONTENT.x_growth_report.title, body: GUIDE_CONTENT.x_growth_report.body }]
    : [{ icon: undefined, title: GUIDE_CONTENT.admin_growth_report.title, body: GUIDE_CONTENT.admin_growth_report.body }];
  const showActiveReportGuide = inX ? showXGrowthGuide : showAdminGrowthGuide;
  const markActiveReportGuideSeen = inX ? markXGrowthGuideSeen : markAdminGrowthGuideSeen;
  const now = new Date();

  // ── 날짜 상태 ──────────────────────────────────────────────────────────────
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  // ── 데이터 상태 ────────────────────────────────────────────────────────────
  const [summary,  setSummary]  = useState<MonthlyReportSummary | null>(null);
  const [allRows,  setAllRows]  = useState<MonthlyListItem[]>([]);   // KPI 계산용 전체
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [q,        setQ]        = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 필터 상태 ──────────────────────────────────────────────────────────────
  const [filterStatuses, setFilterStatuses] = useState<string[] | null>(null);

  // ── 멀티 선택 상태 ─────────────────────────────────────────────────────────
  const [selectMode,   setSelectMode]   = useState(false);
  const [selectedIds,  setSelectedIds]  = useState<Set<string>>(new Set());
  const [selectSending, setSelectSending] = useState(false);

  // ── Action 상태 ────────────────────────────────────────────────────────────
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // ── 폐기 모달 ──────────────────────────────────────────────────────────────
  const [discardTarget,  setDiscardTarget]  = useState<MonthlyListItem | null>(null);
  const [discardReason,  setDiscardReason]  = useState<DiscardReason>("글자·레이아웃 오류");
  const [discardMemo,    setDiscardMemo]    = useState("");
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [discardLoading, setDiscardLoading] = useState(false);

  // ── 전체 발송 확인 모달 ────────────────────────────────────────────────────
  const [bulkSendConfirm, setBulkSendConfirm] = useState(false);
  const [bulkSendLoading, setBulkSendLoading] = useState(false);

  // ── 재발급 확인 모달 ───────────────────────────────────────────────────────
  const [regenTarget,  setRegenTarget]  = useState<MonthlyListItem | null>(null);
  const [regenConfirm, setRegenConfirm] = useState(false);
  const [regenLoading, setRegenLoading] = useState(false);

  // ── 화면에 표시할 rows (클라이언트 필터링) ────────────────────────────────
  const displayRows = useMemo(() => {
    if (!filterStatuses) return allRows;
    return allRows.filter(r => filterStatuses.includes(r.product_status));
  }, [allRows, filterStatuses]);

  // ── KPI 집계 (전체 rows 기준) ─────────────────────────────────────────────
  const kpi = useMemo(() => computeKpi(allRows), [allRows]);

  // ── API 호출: summary (KPI 배지용, 에러 무시) ─────────────────────────────
  // ★ yr/mo = report_month (발행월) 그대로 전송 — 서버가 내부에서 분석월(-1) 변환
  const fetchSummary = useCallback(async (yr: number, mo: number) => {
    try {
      const res = await apiRequest(token, `/admin/reports/summary?year=${yr}&month=${mo}&limit=1&offset=0`);
      if (!res.ok) return;
      // 서버 응답: { summary, students, pagination, ... }
      // MonthlyReportSummary 호환 형태로 변환 (batch_status 등 없으면 null)
      const d = await res.json();
      setSummary(d as any);
    } catch { /* ignore */ }
  }, [token]);

  // ── API 호출: list (최대 200, 클라이언트 필터링) ───────────────────────────
  // ★ yr/mo = report_month (발행월) 그대로 전송 — 서버가 내부에서 분석월(-1) 변환
  const fetchList = useCallback(async (opts: { yr?: number; mo?: number; qv?: string } = {}) => {
    const yr = opts.yr ?? year;
    const mo = opts.mo ?? month;
    const qv = opts.qv !== undefined ? opts.qv : q;

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        year: String(yr), month: String(mo), limit: "200", offset: "0",
      });
      if (qv) params.set("q", qv);

      const res = await apiRequest(token, `/admin/reports/summary?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any)?.error ?? `오류 (${res.status})`);
      }
      const d = await res.json();
      // 서버 응답: { students: [...], pagination: { total }, summary }
      setAllRows(d.students ?? d.items ?? []);
      setTotal(d.pagination?.total ?? d.total ?? 0);
    } catch (e: any) {
      setError(e?.message ?? "조회에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }, [token, year, month, q]);

  // 월 변경 시 재로딩
  useEffect(() => {
    fetchSummary(year, month);
    fetchList({ yr: year, mo: month });
    // 선택 초기화
    setSelectMode(false);
    setSelectedIds(new Set());
    setFilterStatuses(null);
  }, [year, month]);

  // 검색어 debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchList({ qv: q });
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q]);

  // ── 개별 발송 ──────────────────────────────────────────────────────────────
  const onSend = useCallback(async (item: MonthlyListItem) => {
    setActionLoading(item.report_id);
    try {
      const res = await apiRequest(token, `/admin/growth-reports/${item.report_id}/send`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        Alert.alert("오류", (body as any)?.error ?? "발송에 실패했습니다.");
        return;
      }
      setAllRows(prev => prev.map(r =>
        r.report_id === item.report_id ? { ...r, product_status: "PUBLISHED" } : r
      ));
      await fetchSummary(year, month);
    } catch (e: any) {
      Alert.alert("오류", e?.message ?? "발송에 실패했습니다.");
    } finally {
      setActionLoading(null);
    }
  }, [token, year, month, fetchSummary]);

  // ── 선택 발송 (individual send per selected id) ────────────────────────────
  const onSelectSend = useCallback(async () => {
    if (selectedIds.size === 0) return;
    // READY_TO_SEND + APPROVED 발송 가능
    const targets = displayRows.filter(r => selectedIds.has(r.report_id) && ["READY_TO_SEND", "APPROVED"].includes(r.product_status));
    if (targets.length === 0) { Alert.alert("알림", "발송 가능한 상태의 리포트를 선택하세요."); return; }
    Alert.alert(
      "선택 발송",
      `${targets.length}건을 발송하시겠습니까?\n발송 후 학부모에게 즉시 알림이 전송됩니다.`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "발송",
          style: "default",
          onPress: async () => {
            setSelectSending(true);
            let ok = 0, fail = 0;
            for (const item of targets) {
              try {
                const res = await apiRequest(token, `/admin/growth-reports/${item.report_id}/send`, { method: "POST" });
                if (res.ok) {
                  ok++;
                  setAllRows(prev => prev.map(r =>
                    r.report_id === item.report_id ? { ...r, product_status: "PUBLISHED" } : r
                  ));
                } else { fail++; }
              } catch { fail++; }
            }
            setSelectSending(false);
            setSelectMode(false);
            setSelectedIds(new Set());
            Alert.alert("발송 완료", `${ok}건 발송 완료${fail > 0 ? `\n${fail}건 실패` : ""}`);
            await fetchSummary(year, month);
          },
        },
      ],
    );
  }, [selectedIds, displayRows, token, year, month, fetchSummary]);

  // ── 폐기 실행 ──────────────────────────────────────────────────────────────
  const onDiscardConfirm = useCallback(async () => {
    if (!discardTarget) return;
    setDiscardLoading(true);
    try {
      const res = await apiRequest(
        token,
        `/admin/growth-reports/${discardTarget.report_id}/discard`,
        { method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: discardReason, memo: discardMemo || undefined }) },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        Alert.alert("오류", (body as any)?.error ?? "폐기에 실패했습니다.");
        return;
      }
      setAllRows(prev => prev.map(r =>
        r.report_id === discardTarget.report_id
          ? { ...r, product_status: "DISCARDED", discard_reason: discardReason }
          : r
      ));
      setDiscardConfirm(false);
      setDiscardTarget(null);
      setDiscardMemo("");
      await fetchSummary(year, month);
    } catch (e: any) {
      Alert.alert("오류", e?.message ?? "폐기에 실패했습니다.");
    } finally {
      setDiscardLoading(false);
    }
  }, [discardTarget, discardReason, discardMemo, token, year, month, fetchSummary]);

  // ── 재발급 실행 ─────────────────────────────────────────────────────────────
  const onRegenConfirm = useCallback(async () => {
    if (!regenTarget) return;
    setRegenLoading(true);
    try {
      const res = await apiRequest(
        token,
        `/admin/growth-reports/${regenTarget.report_id}/regenerate`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        Alert.alert("오류", (body as any)?.error ?? "재발급에 실패했습니다.");
        return;
      }
      const d = await res.json();
      Alert.alert("재발급 요청됨", `새 리포트가 생성 중입니다.\n(버전 ${d.version_number})`);
      setRegenConfirm(false);
      setRegenTarget(null);
      await fetchList({ yr: year, mo: month });
      await fetchSummary(year, month);
    } catch (e: any) {
      Alert.alert("오류", e?.message ?? "재발급에 실패했습니다.");
    } finally {
      setRegenLoading(false);
    }
  }, [regenTarget, token, year, month, fetchList, fetchSummary]);

  // ── 전체 발송 (READY_TO_SEND만, bulk-send API) ─────────────────────────────
  const onBulkSend = useCallback(async () => {
    setBulkSendLoading(true);
    try {
      const res = await apiRequest(
        token,
        `/admin/growth-reports/bulk-send`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ year, month }) },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        Alert.alert("오류", (body as any)?.error ?? "전체 발송에 실패했습니다.");
        return;
      }
      const d = await res.json();
      Alert.alert("전체 발송 완료", `${d.published}건이 발송되었습니다.${d.errors > 0 ? `\n(오류 ${d.errors}건)` : ""}`);
      setBulkSendConfirm(false);
      await fetchList({ yr: year, mo: month });
      await fetchSummary(year, month);
    } catch (e: any) {
      Alert.alert("오류", e?.message ?? "전체 발송에 실패했습니다.");
    } finally {
      setBulkSendLoading(false);
    }
  }, [token, year, month, fetchList, fetchSummary]);

  // ── 행 렌더링 ──────────────────────────────────────────────────────────────
  const renderRow = ({ item }: { item: MonthlyListItem }) => {
    const sd = getStatusDisplay(item.product_status);
    const isLoading = actionLoading === item.report_id;
    const verLabel = item.version_number > 1 ? ` v${item.version_number}` : "";
    const showSend    = ["READY_TO_SEND", "APPROVED"].includes(item.product_status);
    const showDiscard = ["READY_TO_SEND", "APPROVED"].includes(item.product_status);
    const showRegen   = ["DISCARDED", "READY_TO_SEND", "APPROVED"].includes(item.product_status);
    const showAnalyzing = isAnalyzingState(item.product_status);
    const isSelected  = selectedIds.has(item.report_id);
    const canSelect   = ["READY_TO_SEND", "APPROVED"].includes(item.product_status);

    return (
      <Pressable
        style={[s.row, isSelected && s.rowSelected]}
        onPress={() => {
          if (selectMode) {
            if (!canSelect) return;
            setSelectedIds(prev => {
              const next = new Set(prev);
              next.has(item.report_id) ? next.delete(item.report_id) : next.add(item.report_id);
              return next;
            });
          } else {
            router.push({
              pathname: "/(admin)/report-detail" as any,
              params: { report_id: item.report_id },
            });
          }
        }}
      >
        {/* 상단: 이름 + 선택 체크박스 or 상태 chip */}
        <View style={s.rowTop}>
          {selectMode ? (
            <View style={[s.checkbox, isSelected && s.checkboxActive]}>
              {isSelected && <LucideIcon name="check" size={12} color="#fff" />}
            </View>
          ) : null}
          <Text style={[s.rowName, { flex: 1 }]}>{item.student_name}{verLabel}</Text>
          <View style={[s.chip, { backgroundColor: sd.bg }]}>
            {showAnalyzing && (
              <ActivityIndicator size={10} color={sd.text} style={{ marginRight: 4 }} />
            )}
            <Text style={[s.chipText, { color: sd.text }]}>{sd.label}</Text>
          </View>
        </View>

        {/* 반 / 담당 선생님 */}
        {(item.class_name || item.teacher_name) ? (
          <View style={s.metaRow}>
            {item.class_name ? (
              <View style={s.metaItem}>
                <LucideIcon name="users" size={11} color={C.textMuted} />
                <Text style={s.metaTxt}>{item.class_name}</Text>
              </View>
            ) : null}
            {item.teacher_name ? (
              <View style={s.metaItem}>
                <LucideIcon name="user" size={11} color={C.textMuted} />
                <Text style={s.metaTxt}>{item.teacher_name}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {item.product_status === "DISCARDED" && item.discard_reason && (
          <Text style={s.discardReason}>폐기 사유: {item.discard_reason}</Text>
        )}

        {/* 액션 버튼 — 선택 모드에서는 숨김 */}
        {!selectMode && (showSend || showDiscard || showRegen) && (
          <View style={s.actionRow}>
            {showSend && (
              <TouchableOpacity
                style={[s.actionBtn, s.actionBtnPrimary, isLoading && s.actionBtnDisabled]}
                disabled={isLoading}
                onPress={() => onSend(item)}
              >
                {isLoading
                  ? <ActivityIndicator size={12} color="#fff" />
                  : <LucideIcon name="Send" size={12} color="#fff" />
                }
                <Text style={s.actionBtnPrimaryText}>발송</Text>
              </TouchableOpacity>
            )}
            {showDiscard && (
              <TouchableOpacity
                style={[s.actionBtn, s.actionBtnGhost, isLoading && s.actionBtnDisabled]}
                disabled={isLoading}
                onPress={() => { setDiscardTarget(item); setDiscardConfirm(true); }}
              >
                <LucideIcon name="Trash2" size={12} color="#C62828" />
                <Text style={s.actionBtnDangerText}>폐기</Text>
              </TouchableOpacity>
            )}
            {showRegen && (
              <TouchableOpacity
                style={[s.actionBtn, s.actionBtnGhost]}
                onPress={() => { setRegenTarget(item); setRegenConfirm(true); }}
              >
                <LucideIcon name="RefreshCw" size={12} color="#1565C0" />
                <Text style={s.actionBtnBlueText}>재발급</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </Pressable>
    );
  };

  // ── 헤더 컴포넌트 ──────────────────────────────────────────────────────────
  const ListHeader = (
    <View>
      {/* ── KPI 요약 ── */}
      <View style={s.kpiSection}>
        {/* 배치 상태 */}
        {summary?.batch_status && BATCH_STATUS_LABEL[summary.batch_status] && (
          <View style={s.batchBadge}>
            {summary.batch_status === "RUNNING" && (
              <ActivityIndicator size={10} color={BATCH_STATUS_LABEL[summary.batch_status].color} style={{ marginRight: 4 }} />
            )}
            <Text style={[s.batchBadgeText, { color: BATCH_STATUS_LABEL[summary.batch_status].color }]}>
              {BATCH_STATUS_LABEL[summary.batch_status].label}
            </Text>
          </View>
        )}

        {/* KPI 8개 → 2줄 (4 + 4) */}
        {loading && allRows.length === 0 ? (
          <View>
            <View style={s.kpiRow}>{[0,1,2,3].map(i => <View key={i} style={[s.kpiCard, s.kpiSkeleton]} />)}</View>
            <View style={[s.kpiRow, { marginTop: 6 }]}>{[4,5,6,7].map(i => <View key={i} style={[s.kpiCard, s.kpiSkeleton]} />)}</View>
          </View>
        ) : (
          <View>
            <View style={s.kpiRow}>
              <KpiCard value={kpi.total}     label="전체"    color="#23415C" onPress={() => setFilterStatuses(null)} />
              <KpiCard value={kpi.beforeGen} label="생성 전"  color="#757575" onPress={() => setFilterStatuses(["OPEN","READY_FOR_ANALYSIS"])} />
              <KpiCard value={kpi.analyzing} label="분석 중"  color="#1565C0" onPress={() => setFilterStatuses(["PREANALYZING","ANALYZING","REGENERATING"])} />
              <KpiCard value={kpi.reviewing} label="검수 대기" color="#E65100" onPress={() => setFilterStatuses(["REVIEW_REQUIRED","APPROVED"])} />
            </View>
            <View style={[s.kpiRow, { marginTop: 6 }]}>
              <KpiCard value={kpi.ready}     label="발송 대기" color="#F57C00" onPress={() => setFilterStatuses(["READY_TO_SEND"])} />
              <KpiCard value={kpi.published} label="발행 완료" color="#2E7D32" onPress={() => setFilterStatuses(["PUBLISHED"])} />
              <KpiCard value={kpi.excluded} label="발급 제외"  color="#9E9E9E" onPress={() => setFilterStatuses(["EXCLUDED"])} />
              <KpiCard value={kpi.discarded} label="폐기"      color="#B71C1C" onPress={() => setFilterStatuses(["DISCARDED"])} />
              <KpiCard value={kpi.failed}    label="실패"      color="#C62828" onPress={() => setFilterStatuses(["FAILED","ANALYSIS_FAILED"])} />
            </View>
          </View>
        )}

        {/* 전체 발송 버튼 */}
        {(kpi.ready + kpi.reviewing) > 0 && !selectMode && (
          <TouchableOpacity
            style={s.bulkSendBtn}
            onPress={() => setBulkSendConfirm(true)}
          >
            <LucideIcon name="send" size={14} color="#fff" />
            <Text style={s.bulkSendBtnText}>
              대기 중 {kpi.ready + kpi.reviewing}건 전체 발송
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── 연도 + 월 선택 ── */}
      <View style={s.sectionRow}>
        <TouchableOpacity style={s.yearBtn} onPress={() => setYear(y => y - 1)}>
          <LucideIcon name="chevron-left" size={16} color={C.textPrimary} />
        </TouchableOpacity>
        <Text style={s.yearText}>{year}년</Text>
        <TouchableOpacity
          style={s.yearBtn}
          onPress={() => setYear(y => y + 1)}
          disabled={year >= now.getFullYear()}
        >
          <LucideIcon name="chevron-right" size={16} color={year >= now.getFullYear() ? C.textMuted : C.textPrimary} />
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.monthRow}>
        {MONTHS.map((m, idx) => {
          const mo = idx + 1;
          const active = mo === month;
          return (
            <TouchableOpacity
              key={mo}
              style={[s.monthPill, active && s.monthPillActive]}
              onPress={() => setMonth(mo)}
            >
              <Text style={[s.monthPillText, active && s.monthPillTextActive]}>{m}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── 검색 ── */}
      <View style={s.searchRow}>
        <LucideIcon name="search" size={16} color={C.textMuted} />
        <TextInput
          style={s.searchInput}
          value={q}
          onChangeText={setQ}
          placeholder="학생 이름 검색"
          placeholderTextColor={C.textMuted}
        />
        {q.length > 0 && (
          <TouchableOpacity onPress={() => setQ("")}>
            <LucideIcon name="x" size={16} color={C.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* ── 상태 필터 chips ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 6, paddingHorizontal: 16, paddingBottom: 8, paddingTop: 4 }}
      >
        {FILTER_OPTIONS.map(opt => {
          const active = JSON.stringify(filterStatuses) === JSON.stringify(opt.value);
          return (
            <TouchableOpacity
              key={String(opt.value)}
              style={[s.filterChip, active && s.filterChipActive]}
              onPress={() => setFilterStatuses(opt.value)}
            >
              <Text style={[s.filterChipTxt, active && s.filterChipTxtActive]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* 총 건수 + 선택 모드 토글 */}
      <View style={s.countRow}>
        {!loading && (
          <Text style={s.totalCount}>
            {filterStatuses ? `${displayRows.length}건 (전체 ${total}건)` : `총 ${total}건`}
          </Text>
        )}
        {(kpi.ready + kpi.reviewing) > 0 && (
          <TouchableOpacity
            style={[s.selectToggleBtn, selectMode && s.selectToggleBtnActive]}
            onPress={() => { setSelectMode(v => !v); setSelectedIds(new Set()); }}
          >
            <LucideIcon name={selectMode ? "x" : "check-square"} size={14} color={selectMode ? "#fff" : C.textPrimary} />
            <Text style={[s.selectToggleTxt, selectMode && { color: "#fff" }]}>
              {selectMode ? "선택 취소" : "선택"}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 오류 */}
      {error && (
        <View style={s.errorWrap}>
          <LucideIcon name="alert-circle" size={24} color="#C62828" />
          <Text style={s.errorText}>{error}</Text>
          <TouchableOpacity
            style={s.retryBtn}
            onPress={() => { fetchSummary(year, month); fetchList({ yr: year, mo: month }); }}
          >
            <Text style={s.retryText}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={s.safe}>
      <SubScreenHeader title="AI 성장리포트" homePath="/(admin)/dashboard" />

      {loading && allRows.length === 0 ? (
        <View style={s.centerLoading}>
          <ActivityIndicator size="large" color={C.textMuted} />
        </View>
      ) : (
        <FlatList
          data={displayRows}
          keyExtractor={item => item.report_id}
          renderItem={renderRow}
          ListHeaderComponent={ListHeader}
          ListFooterComponent={
            displayRows.length === 0 && !loading
              ? (
                <View style={s.emptyWrap}>
                  <LucideIcon name="file-text" size={40} color={C.textMuted} />
                  <Text style={s.emptyTitle}>리포트가 없습니다</Text>
                  <Text style={s.emptySub}>{year}년 {month}월 발행 예정 AI 성장리포트가 아직 없습니다.</Text>
                </View>
              )
              : <View style={{ height: selectMode ? 100 : 40 }} />
          }
        />
      )}

      {/* ── 선택 발송 하단 바 ── */}
      {selectMode && (
        <View style={s.selectBar}>
          <Text style={s.selectBarTxt}>
            {selectedIds.size > 0
              ? `${selectedIds.size}건 선택됨 (발송 가능: ${[...selectedIds].filter(id => ["READY_TO_SEND","APPROVED"].includes(allRows.find(r => r.report_id === id)?.product_status ?? "")).length}건)`
              : "발송 대기 또는 검수 완료 항목을 선택하세요"}
          </Text>
          <TouchableOpacity
            style={[s.selectSendBtn, (selectedIds.size === 0 || selectSending) && s.actionBtnDisabled]}
            disabled={selectedIds.size === 0 || selectSending}
            onPress={onSelectSend}
          >
            {selectSending
              ? <ActivityIndicator size={14} color="#fff" />
              : <LucideIcon name="Send" size={14} color="#fff" />
            }
            <Text style={s.selectSendTxt}>선택 발송</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── 폐기 사유 선택 모달 ── */}
      <Modal
        visible={discardConfirm}
        animationType="slide"
        transparent
        onRequestClose={() => { setDiscardConfirm(false); setDiscardTarget(null); }}
      >
        <Pressable style={s.overlay} onPress={() => { setDiscardConfirm(false); setDiscardTarget(null); }}>
          <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>리포트 폐기</Text>
            <Text style={s.sheetSub}>{discardTarget?.student_name} 학생의 리포트를 폐기합니다.</Text>

            <Text style={s.sectionLabel}>폐기 사유</Text>
            {DISCARD_REASONS.map(reason => (
              <TouchableOpacity
                key={reason}
                style={[s.radioRow, discardReason === reason && s.radioRowActive]}
                onPress={() => setDiscardReason(reason)}
              >
                <View style={[s.radioCircle, discardReason === reason && s.radioCircleActive]} />
                <Text style={[s.radioLabel, discardReason === reason && s.radioLabelActive]}>{reason}</Text>
              </TouchableOpacity>
            ))}

            <Text style={s.sectionLabel}>추가 메모 (선택)</Text>
            <TextInput
              style={s.memoInput}
              value={discardMemo}
              onChangeText={setDiscardMemo}
              placeholder="예: 3번째 단락에 오타 있음"
              placeholderTextColor={C.textMuted}
              multiline
              maxLength={200}
            />

            <View style={s.sheetBtns}>
              <TouchableOpacity
                style={s.cancelSheetBtn}
                onPress={() => { setDiscardConfirm(false); setDiscardTarget(null); }}
              >
                <Text style={s.cancelSheetText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.dangerSheetBtn, discardLoading && s.actionBtnDisabled]}
                onPress={onDiscardConfirm}
                disabled={discardLoading}
              >
                {discardLoading
                  ? <ActivityIndicator size={14} color="#fff" />
                  : <Text style={s.dangerSheetText}>폐기</Text>
                }
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── 재발급 확인 모달 ── */}
      <ConfirmModal
        visible={regenConfirm}
        title="리포트 재발급"
        message={`${regenTarget?.student_name} 학생의 리포트를 재발급하시겠습니까?\nAI가 새로 분석하여 새 버전을 생성합니다.\n이전 버전은 이력으로 보존됩니다.`}
        onConfirm={onRegenConfirm}
        onCancel={() => { setRegenConfirm(false); setRegenTarget(null); }}
      />

      {/* ── 전체 발송 확인 모달 ── */}
      <ConfirmModal
        visible={bulkSendConfirm}
        title="전체 발송"
        message={`발송 대기 중인 ${kpi.ready}건을 모두 발송하시겠습니까?\n발송 후에는 학부모에게 즉시 알림이 전송됩니다.\n이미 PUBLISHED/DISCARDED 상태는 제외됩니다.`}
        onConfirm={onBulkSend}
        onCancel={() => setBulkSendConfirm(false)}
      />

      {/* Feature Guide: X모드=x_growth_report / 일반=admin_growth_report (중복 0) */}
      <OnboardingSheet
        visible={showActiveReportGuide}
        onDismiss={markActiveReportGuideSeen}
        slides={activeReportGuideSlides}
      />
    </SafeAreaView>
  );
}

// ── KpiCard 컴포넌트 ─────────────────────────────────────────────────────────

function KpiCard({ value, label, color, onPress }: {
  value: number; label: string; color: string; onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[s.kpiCard, { borderTopColor: color }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[s.kpiValue, { color }]}>{value}</Text>
      <Text style={s.kpiLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 스타일
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: C.background },
  centerLoading: { flex: 1, alignItems: "center", justifyContent: "center" },

  // KPI 섹션
  kpiSection: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  kpiRow:     { flexDirection: "row", gap: 6 },
  kpiCard:    {
    flex: 1, backgroundColor: "#fff", borderRadius: 10, borderTopWidth: 3,
    paddingVertical: 10, paddingHorizontal: 2, alignItems: "center", gap: 2,
    shadowColor: "#000", shadowOpacity: 0.04, shadowOffset: { width: 0, height: 1 }, shadowRadius: 3, elevation: 1,
  },
  kpiSkeleton: { borderTopColor: "#E0E0E0", opacity: 0.4, height: 58 },
  kpiValue:    { fontSize: 18, fontFamily: "Pretendard-Bold" },
  kpiLabel:    { fontSize: 9, color: C.textMuted, fontFamily: "Pretendard-Regular", textAlign: "center" },

  batchBadge:     { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  batchBadgeText: { fontSize: 12, fontFamily: "Pretendard-Medium" },

  // 전체 발송 버튼
  bulkSendBtn: {
    marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, backgroundColor: "#0C1A2E", borderRadius: 12, paddingVertical: 13, paddingHorizontal: 20,
  },
  bulkSendBtnText: { color: "#fff", fontSize: 14, fontFamily: "Pretendard-SemiBold" },

  // 연도/월
  sectionRow:        { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 14 },
  yearBtn:           { padding: 6 },
  yearText:          { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: C.textPrimary },
  monthRow:          { paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  monthPill:         { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: "#F5F5F5" },
  monthPillActive:   { backgroundColor: "#0C1A2E" },
  monthPillText:     { fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Medium" },
  monthPillTextActive: { color: "#fff" },

  // 검색
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginVertical: 4,
    backgroundColor: "#F5F5F5", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: 14, color: C.textPrimary, fontFamily: "Pretendard-Regular", padding: 0 },

  // 상태 필터 chips
  filterChip:       { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: "#F5F5F5" },
  filterChipActive: { backgroundColor: "#0C1A2E" },
  filterChipTxt:    { fontSize: 12, color: C.textMuted, fontFamily: "Pretendard-Medium" },
  filterChipTxtActive: { color: "#fff" },

  // 총 건수 + 선택 토글
  countRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 6 },
  totalCount: { fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Regular" },
  selectToggleBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1, borderColor: "#E0E0E0",
  },
  selectToggleBtnActive: { backgroundColor: "#0C1A2E", borderColor: "#0C1A2E" },
  selectToggleTxt: { fontSize: 12, fontFamily: "Pretendard-Medium", color: C.textPrimary },

  // 목록 row
  row: {
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "#fff",
    borderBottomWidth: 1, borderColor: "#F0F0F0", gap: 4,
  },
  rowSelected: { backgroundColor: "#EBF5FB" },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  rowName: { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: C.textPrimary },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 2 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  metaTxt: { fontSize: 12, color: C.textMuted, fontFamily: "Pretendard-Regular" },
  discardReason: { fontSize: 12, color: "#B71C1C", fontFamily: "Pretendard-Regular" },

  // 체크박스
  checkbox: {
    width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: "#BDBDBD",
    backgroundColor: "#fff", alignItems: "center", justifyContent: "center", marginRight: 4,
  },
  checkboxActive: { backgroundColor: "#0C1A2E", borderColor: "#0C1A2E" },

  // 상태 chip
  chip:     { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  chipText: { fontSize: 11, fontFamily: "Pretendard-Medium" },

  // 액션 버튼 행
  actionRow:        { flexDirection: "row", gap: 6, marginTop: 4 },
  actionBtn:        { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  actionBtnPrimary: { backgroundColor: "#0C1A2E" },
  actionBtnGhost:   { borderWidth: 1, borderColor: "#E0E0E0", backgroundColor: "#fff" },
  actionBtnDisabled: { opacity: 0.5 },
  actionBtnPrimaryText: { fontSize: 12, fontFamily: "Pretendard-SemiBold", color: "#fff" },
  actionBtnDangerText:  { fontSize: 12, fontFamily: "Pretendard-SemiBold", color: "#C62828" },
  actionBtnBlueText:    { fontSize: 12, fontFamily: "Pretendard-SemiBold", color: "#1565C0" },

  // 선택 발송 하단 바
  selectBar: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "#fff",
    borderTopWidth: 1, borderTopColor: "#E0E0E0",
    shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 8, elevation: 8,
  },
  selectBarTxt:  { fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Regular", flex: 1 },
  selectSendBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#0C1A2E", borderRadius: 10, paddingVertical: 12, paddingHorizontal: 20,
  },
  selectSendTxt: { color: "#fff", fontSize: 14, fontFamily: "Pretendard-SemiBold" },

  // empty / error / footer
  emptyWrap:   { alignItems: "center", paddingTop: 60, gap: 8 },
  emptyTitle:  { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: C.textPrimary },
  emptySub:    { fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Regular" },
  errorWrap:   { alignItems: "center", paddingVertical: 32, gap: 8, paddingHorizontal: 24 },
  errorText:   { fontSize: 14, color: "#C62828", textAlign: "center", fontFamily: "Pretendard-Regular" },
  retryBtn:    { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: "#0C1A2E" },
  retryText:   { color: "#fff", fontSize: 14, fontFamily: "Pretendard-SemiBold" },
  footerLoading: { paddingVertical: 20, alignItems: "center" },

  // 모달 공통
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingBottom: 40, paddingTop: 12, gap: 12,
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#DDD", alignSelf: "center", marginBottom: 4 },
  sheetTitle:  { fontSize: 17, fontFamily: "Pretendard-Bold", color: C.textPrimary },
  sheetSub:    { fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Regular", marginTop: -4 },
  sectionLabel:{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: C.textMuted },

  // 라디오 폐기 사유
  radioRow:          { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  radioRowActive:    {},
  radioCircle:       { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: "#BDBDBD" },
  radioCircleActive: { borderColor: "#0C1A2E", backgroundColor: "#0C1A2E" },
  radioLabel:        { fontSize: 14, color: C.textPrimary, fontFamily: "Pretendard-Regular" },
  radioLabelActive:  { fontFamily: "Pretendard-SemiBold" },

  // 메모
  memoInput: {
    borderWidth: 1, borderColor: "#E0E0E0", borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14,
    color: C.textPrimary, fontFamily: "Pretendard-Regular",
    minHeight: 64, textAlignVertical: "top",
  },

  // 모달 버튼
  sheetBtns:      { flexDirection: "row", gap: 10, marginTop: 4 },
  cancelSheetBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: "#F5F5F5", alignItems: "center" },
  cancelSheetText:{ fontSize: 15, fontFamily: "Pretendard-SemiBold", color: C.textPrimary },
  dangerSheetBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: "#C62828", alignItems: "center" },
  dangerSheetText:{ fontSize: 15, fontFamily: "Pretendard-SemiBold", color: "#fff" },
});
