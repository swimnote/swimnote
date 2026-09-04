/**
 * report-hub.tsx — WP8: AI 성장리포트 발송 관리
 *
 * 플로우:
 *   배치 자동 생성 → READY_TO_SEND (관리자 확인) → [발송] → PUBLISHED (부모 노출)
 *                                              → [폐기] → DISCARDED → [재발급] → REGENERATING → ...
 *
 * 엔드포인트:
 *   GET  /admin/growth-reports/monthly-summary  — KPI 요약
 *   GET  /admin/growth-reports/monthly-list     — 학생 목록 (최신 version)
 *   POST /admin/growth-reports/:id/send         — 개별 발송
 *   PUT  /admin/growth-reports/:id/discard      — 폐기
 *   POST /admin/growth-reports/:id/regenerate   — 재발급
 *   POST /admin/growth-reports/bulk-send        — 전체 발송
 *
 * 보안:
 *   - pool_admin JWT scope (서버 측 검증)
 *   - cross-pool: 서버 측 swimming_pool_id 검증
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
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
import Colors from "@/constants/colors";

const C = Colors.light;

// ── 상수 ──────────────────────────────────────────────────────────────────────

const MONTHS = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];

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
  version_number:  number;
  discard_reason:  string | null;
  discarded_at:    string | null;
  period_start:    string;
  period_end:      string;
  report_period:   string;
  published_at:    string | null;
  updated_at:      string;
  content_snippet: string | null;
}

// ── 상태 표시 정의 ───────────────────────────────────────────────────────────

const STATUS_DISPLAY: Record<string, { label: string; bg: string; text: string }> = {
  READY_TO_SEND: { label: "발송 대기",  bg: "#FFF8E1", text: "#E65100" },
  PUBLISHED:     { label: "발행 완료",  bg: "#E8F5E9", text: "#2E7D32" },
  DISCARDED:     { label: "폐기됨",     bg: "#FFEBEE", text: "#B71C1C" },
  REGENERATING:  { label: "재생성 중",  bg: "#E3F2FD", text: "#1565C0" },
  ANALYZING:     { label: "분석 중",    bg: "#E3F2FD", text: "#1565C0" },
  PREANALYZING:  { label: "분석 중",    bg: "#E3F2FD", text: "#1565C0" },
  READY_FOR_ANALYSIS: { label: "분석 준비", bg: "#E8EAF6", text: "#3949AB" },
  REVIEW_REQUIRED:    { label: "검토 대기", bg: "#FFF3E0", text: "#E65100" },
  APPROVED:      { label: "승인 완료",  bg: "#F3E5F5", text: "#6A1B9A" },
  FAILED:        { label: "실패",       bg: "#FFEBEE", text: "#C62828" },
  OPEN:          { label: "대기 중",    bg: "#F5F5F5", text: "#757575" },
};

function getStatusDisplay(status: string) {
  return STATUS_DISPLAY[status] ?? { label: status, bg: "#F5F5F5", text: "#757575" };
}

function isAnalyzingState(status: string): boolean {
  return ["OPEN","PREANALYZING","READY_FOR_ANALYSIS","ANALYZING","REGENERATING","REVIEW_REQUIRED"].includes(status);
}

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
  const { token } = useAuth();
  const now = new Date();

  // ── 날짜 상태 ──────────────────────────────────────────────────────────────
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  // ── 데이터 상태 ────────────────────────────────────────────────────────────
  const [summary,     setSummary]     = useState<MonthlyReportSummary | null>(null);
  const [rows,        setRows]        = useState<MonthlyListItem[]>([]);
  const [total,       setTotal]       = useState(0);
  const [loading,     setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [offset,      setOffset]      = useState(0);
  const [q,           setQ]           = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Action 상태 ────────────────────────────────────────────────────────────
  const [actionLoading, setActionLoading] = useState<string | null>(null);  // reportId

  // ── 폐기 모달 ──────────────────────────────────────────────────────────────
  const [discardTarget, setDiscardTarget]         = useState<MonthlyListItem | null>(null);
  const [discardReason, setDiscardReason]         = useState<DiscardReason>("글자·레이아웃 오류");
  const [discardMemo,   setDiscardMemo]           = useState("");
  const [discardConfirm, setDiscardConfirm]       = useState(false);
  const [discardLoading, setDiscardLoading]       = useState(false);

  // ── 전체 발송 확인 모달 ────────────────────────────────────────────────────
  const [bulkSendConfirm, setBulkSendConfirm]     = useState(false);
  const [bulkSendLoading, setBulkSendLoading]     = useState(false);

  // ── 재발급 확인 모달 ───────────────────────────────────────────────────────
  const [regenTarget,  setRegenTarget]            = useState<MonthlyListItem | null>(null);
  const [regenConfirm, setRegenConfirm]           = useState(false);
  const [regenLoading, setRegenLoading]           = useState(false);

  // ── API 호출: summary ───────────────────────────────────────────────────────
  const fetchSummary = useCallback(async (yr: number, mo: number) => {
    try {
      const res = await apiRequest(token, `/admin/growth-reports/monthly-summary?year=${yr}&month=${mo}`);
      if (!res.ok) return;
      const d = await res.json();
      setSummary(d);
    } catch { /* ignore */ }
  }, [token]);

  // ── API 호출: list ─────────────────────────────────────────────────────────
  const fetchList = useCallback(async (opts: {
    yr?: number; mo?: number; off?: number; reset?: boolean; qv?: string;
  } = {}) => {
    const yr  = opts.yr  ?? year;
    const mo  = opts.mo  ?? month;
    const off = opts.off ?? 0;
    const qv  = opts.qv  !== undefined ? opts.qv : q;

    if (off === 0) { setLoading(true); setError(null); }
    else { setLoadingMore(true); }

    try {
      const params = new URLSearchParams({
        year: String(yr), month: String(mo),
        limit: "50", offset: String(off),
      });
      if (qv) params.set("q", qv);

      const res = await apiRequest(token, `/admin/growth-reports/monthly-list?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any)?.error ?? `오류 (${res.status})`);
      }
      const d = await res.json();

      if (off === 0) {
        setRows(d.items ?? []);
      } else {
        setRows(prev => [...prev, ...(d.items ?? [])]);
      }
      setTotal(d.total ?? 0);
      setOffset(off);
    } catch (e: any) {
      setError(e?.message ?? "조회에 실패했습니다.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [token, year, month, q]);

  // 월 변경 시 재로딩
  useEffect(() => {
    fetchSummary(year, month);
    fetchList({ yr: year, mo: month, off: 0 });
  }, [year, month]);

  // 검색어 debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchList({ off: 0, qv: q });
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
      // optimistic update
      setRows(prev => prev.map(r =>
        r.report_id === item.report_id ? { ...r, product_status: "PUBLISHED" } : r
      ));
      // summary refresh
      await fetchSummary(year, month);
    } catch (e: any) {
      Alert.alert("오류", e?.message ?? "발송에 실패했습니다.");
    } finally {
      setActionLoading(null);
    }
  }, [token, year, month, fetchSummary]);

  // ── 폐기 실행 ──────────────────────────────────────────────────────────────
  const onDiscardConfirm = useCallback(async () => {
    if (!discardTarget) return;
    setDiscardLoading(true);
    try {
      const res = await apiRequest(
        token,
        `/admin/growth-reports/${discardTarget.report_id}/discard`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: discardReason, memo: discardMemo || undefined }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        Alert.alert("오류", (body as any)?.error ?? "폐기에 실패했습니다.");
        return;
      }
      // optimistic
      setRows(prev => prev.map(r =>
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
      // refresh list
      await fetchList({ yr: year, mo: month, off: 0 });
      await fetchSummary(year, month);
    } catch (e: any) {
      Alert.alert("오류", e?.message ?? "재발급에 실패했습니다.");
    } finally {
      setRegenLoading(false);
    }
  }, [regenTarget, token, year, month, fetchList, fetchSummary]);

  // ── 전체 발송 ──────────────────────────────────────────────────────────────
  const onBulkSend = useCallback(async () => {
    setBulkSendLoading(true);
    try {
      const res = await apiRequest(
        token,
        `/admin/growth-reports/bulk-send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ year, month }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        Alert.alert("오류", (body as any)?.error ?? "전체 발송에 실패했습니다.");
        return;
      }
      const d = await res.json();
      Alert.alert("전체 발송 완료", `${d.published}건이 발송되었습니다.${d.errors > 0 ? `\n(오류 ${d.errors}건)` : ""}`);
      setBulkSendConfirm(false);
      await fetchList({ yr: year, mo: month, off: 0 });
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
    const period = item.period_start ? item.period_start.slice(0, 7).replace("-", ".") : "";
    const verLabel = item.version_number > 1 ? ` v${item.version_number}` : "";

    const showSend    = item.product_status === "READY_TO_SEND";
    const showDiscard = item.product_status === "READY_TO_SEND";
    const showRegen   = item.product_status === "DISCARDED";
    const showAnalyzing = isAnalyzingState(item.product_status);

    return (
      <Pressable
        style={s.row}
        onPress={() => router.push({
          pathname: "/(admin)/x-growth" as any,
          params: { preselect_student_id: item.student_id },
        })}
      >
        <View style={s.rowTop}>
          <Text style={s.rowName}>{item.student_name}{verLabel}</Text>
          <View style={[s.chip, { backgroundColor: sd.bg }]}>
            {showAnalyzing && (
              <ActivityIndicator size={10} color={sd.text} style={{ marginRight: 4 }} />
            )}
            <Text style={[s.chipText, { color: sd.text }]}>{sd.label}</Text>
          </View>
        </View>

        {item.product_status === "DISCARDED" && item.discard_reason && (
          <Text style={s.discardReason}>폐기 사유: {item.discard_reason}</Text>
        )}
        {period ? <Text style={s.rowPeriod}>{period}</Text> : null}

        {/* 액션 버튼 */}
        {(showSend || showDiscard || showRegen) && (
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
      {/* ── KPI 요약 바 ── */}
      {summary ? (
        <View style={s.kpiSection}>
          {/* 배치 상태 */}
          {summary.batch_status && BATCH_STATUS_LABEL[summary.batch_status] && (
            <View style={s.batchBadge}>
              {summary.batch_status === "RUNNING" && (
                <ActivityIndicator size={10} color={BATCH_STATUS_LABEL[summary.batch_status].color} style={{ marginRight: 4 }} />
              )}
              <Text style={[s.batchBadgeText, { color: BATCH_STATUS_LABEL[summary.batch_status].color }]}>
                {BATCH_STATUS_LABEL[summary.batch_status].label}
              </Text>
            </View>
          )}

          <View style={s.kpiRow}>
            <View style={[s.kpiCard, { borderTopColor: "#E65100" }]}>
              <Text style={[s.kpiValue, { color: "#E65100" }]}>{summary.ready_count}</Text>
              <Text style={s.kpiLabel}>발송 대기</Text>
            </View>
            <View style={[s.kpiCard, { borderTopColor: "#2E7D32" }]}>
              <Text style={[s.kpiValue, { color: "#2E7D32" }]}>{summary.published_count}</Text>
              <Text style={s.kpiLabel}>발행 완료</Text>
            </View>
            <View style={[s.kpiCard, { borderTopColor: "#1565C0" }]}>
              <Text style={[s.kpiValue, { color: "#1565C0" }]}>{summary.regenerating_count}</Text>
              <Text style={s.kpiLabel}>생성 중</Text>
            </View>
            <View style={[s.kpiCard, { borderTopColor: "#C62828" }]}>
              <Text style={[s.kpiValue, { color: "#C62828" }]}>{summary.failed_count}</Text>
              <Text style={s.kpiLabel}>실패</Text>
            </View>
          </View>

          {/* 전체 발송 버튼 */}
          {summary.ready_count > 0 && (
            <TouchableOpacity
              style={s.bulkSendBtn}
              onPress={() => setBulkSendConfirm(true)}
            >
              <LucideIcon name="Send" size={14} color="#fff" />
              <Text style={s.bulkSendBtnText}>
                대기 중 {summary.ready_count}건 전체 발송
              </Text>
            </TouchableOpacity>
          )}
        </View>
      ) : loading ? (
        <View style={s.kpiSection}>
          <View style={s.kpiRow}>
            {[0,1,2,3].map(i => (
              <View key={i} style={[s.kpiCard, s.kpiSkeleton]} />
            ))}
          </View>
        </View>
      ) : null}

      {/* ── 연도 + 월 선택 ── */}
      <View style={s.sectionRow}>
        <TouchableOpacity style={s.yearBtn} onPress={() => { setYear(y => y - 1); }}>
          <LucideIcon name="ChevronLeft" size={16} color={C.textPrimary} />
        </TouchableOpacity>
        <Text style={s.yearText}>{year}년</Text>
        <TouchableOpacity
          style={s.yearBtn}
          onPress={() => { setYear(y => y + 1); }}
          disabled={year >= now.getFullYear()}
        >
          <LucideIcon name="ChevronRight" size={16} color={year >= now.getFullYear() ? C.textMuted : C.textPrimary} />
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
        <LucideIcon name="Search" size={16} color={C.textMuted} />
        <TextInput
          style={s.searchInput}
          value={q}
          onChangeText={setQ}
          placeholder="학생 이름 검색"
          placeholderTextColor={C.textMuted}
        />
        {q.length > 0 && (
          <TouchableOpacity onPress={() => setQ("")}>
            <LucideIcon name="X" size={16} color={C.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* 총 건수 */}
      {!loading && (
        <Text style={s.totalCount}>총 {total}명</Text>
      )}

      {/* 오류 */}
      {error && (
        <View style={s.errorWrap}>
          <LucideIcon name="AlertCircle" size={24} color="#C62828" />
          <Text style={s.errorText}>{error}</Text>
          <TouchableOpacity
            style={s.retryBtn}
            onPress={() => { fetchSummary(year, month); fetchList({ yr: year, mo: month, off: 0 }); }}
          >
            <Text style={s.retryText}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={s.safe}>
      <SubScreenHeader title="AI 성장리포트 발송" homePath="/(admin)/dashboard" />

      {loading && rows.length === 0 ? (
        <View style={s.centerLoading}>
          <ActivityIndicator size="large" color={C.textMuted} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={item => item.report_id}
          renderItem={renderRow}
          ListHeaderComponent={ListHeader}
          onEndReached={() => {
            if (!loadingMore && !loading && rows.length < total) {
              fetchList({ off: offset + 50 });
            }
          }}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            loadingMore
              ? <View style={s.footerLoading}><ActivityIndicator color={C.textMuted} /></View>
              : rows.length === 0 && !loading
              ? (
                <View style={s.emptyWrap}>
                  <LucideIcon name="FileSearch" size={40} color={C.textMuted} />
                  <Text style={s.emptyTitle}>리포트가 없습니다</Text>
                  <Text style={s.emptySub}>{year}년 {month}월 AI 성장리포트가 아직 없습니다.</Text>
                </View>
              )
              : <View style={{ height: 40 }} />
          }
        />
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
        message={`발송 대기 중인 ${summary?.ready_count ?? 0}건을 모두 발송하시겠습니까?\n발송 후에는 학부모에게 즉시 알림이 전송됩니다.`}
        onConfirm={onBulkSend}
        onCancel={() => setBulkSendConfirm(false)}
      />
    </SafeAreaView>
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
  kpiRow:     { flexDirection: "row", gap: 8 },
  kpiCard:    {
    flex: 1, backgroundColor: "#fff", borderRadius: 10, borderTopWidth: 3,
    paddingVertical: 12, paddingHorizontal: 4, alignItems: "center", gap: 2,
    shadowColor: "#000", shadowOpacity: 0.04, shadowOffset: { width: 0, height: 1 }, shadowRadius: 3, elevation: 1,
  },
  kpiSkeleton: { borderTopColor: "#E0E0E0", opacity: 0.4, height: 64 },
  kpiValue:    { fontSize: 20, fontFamily: "Pretendard-Bold" },
  kpiLabel:    { fontSize: 10, color: C.textMuted, fontFamily: "Pretendard-Regular", textAlign: "center" },

  batchBadge:     { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  batchBadgeText: { fontSize: 12, fontFamily: "Pretendard-Medium" },

  // 전체 발송 버튼
  bulkSendBtn: {
    marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, backgroundColor: "#0C1A2E", borderRadius: 12, paddingVertical: 14, paddingHorizontal: 20,
  },
  bulkSendBtnText: { color: "#fff", fontSize: 14, fontFamily: "Pretendard-SemiBold" },

  // 연도/월
  sectionRow:        { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 16 },
  yearBtn:           { padding: 6 },
  yearText:          { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: C.textPrimary },
  monthRow:          { paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  monthPill:         { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: "#F5F5F5" },
  monthPillActive:   { backgroundColor: "#0C1A2E" },
  monthPillText:     { fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Medium" },
  monthPillTextActive: { color: "#fff" },

  // 검색
  searchRow:   {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginVertical: 4,
    backgroundColor: "#F5F5F5", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: 14, color: C.textPrimary, fontFamily: "Pretendard-Regular", padding: 0 },

  totalCount: { paddingHorizontal: 16, paddingBottom: 8, fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Regular" },

  // 목록 row
  row: {
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "#fff",
    borderBottomWidth: 1, borderColor: "#F0F0F0", gap: 4,
  },
  rowTop:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  rowName:     { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: C.textPrimary, flex: 1 },
  rowPeriod:   { fontSize: 12, color: C.textMuted, fontFamily: "Pretendard-Regular" },
  discardReason: { fontSize: 12, color: "#B71C1C", fontFamily: "Pretendard-Regular" },

  // 상태 chip
  chip:     { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  chipText: { fontSize: 11, fontFamily: "Pretendard-Medium" },

  // 액션 버튼 행
  actionRow:      { flexDirection: "row", gap: 6, marginTop: 4 },
  actionBtn:      { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  actionBtnPrimary: { backgroundColor: "#0C1A2E" },
  actionBtnGhost:   { borderWidth: 1, borderColor: "#E0E0E0", backgroundColor: "#fff" },
  actionBtnDisabled: { opacity: 0.5 },
  actionBtnPrimaryText: { fontSize: 12, fontFamily: "Pretendard-SemiBold", color: "#fff" },
  actionBtnDangerText:  { fontSize: 12, fontFamily: "Pretendard-SemiBold", color: "#C62828" },
  actionBtnBlueText:    { fontSize: 12, fontFamily: "Pretendard-SemiBold", color: "#1565C0" },

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
  sheet:   {
    backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingBottom: 40, paddingTop: 12, gap: 12,
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#DDD", alignSelf: "center", marginBottom: 4 },
  sheetTitle:  { fontSize: 17, fontFamily: "Pretendard-Bold", color: C.textPrimary },
  sheetSub:    { fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Regular", marginTop: -4 },
  sectionLabel:{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: C.textMuted },

  // 라디오 폐기 사유
  radioRow:       { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  radioRowActive: { /* just text change */ },
  radioCircle:    { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: "#BDBDBD" },
  radioCircleActive: { borderColor: "#0C1A2E", backgroundColor: "#0C1A2E" },
  radioLabel:     { fontSize: 14, color: C.textPrimary, fontFamily: "Pretendard-Regular" },
  radioLabelActive: { fontFamily: "Pretendard-SemiBold" },

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
