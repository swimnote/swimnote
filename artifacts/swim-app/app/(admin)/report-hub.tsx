/**
 * AI 학생리포트 발급현황 — PHASE 2
 * SOURCE OF TRUTH: growth_reports (swimming_pool_id 격리)
 * KPI: 발행완료 | 검토대기 | 분석중 | 실패  (NOT_OPEN 제외)
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { LucideIcon } from "@/components/common/LucideIcon";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { apiRequest, useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";

const C = Colors.light;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 상수
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const MONTHS = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];
const INITIALS = ["전체","ㄱ","ㄴ","ㄷ","ㄹ","ㅁ","ㅂ","ㅅ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
const STATUS_OPTIONS = [
  { value: "ALL",              label: "전체" },
  { value: "PUBLISHED",        label: "발행 완료" },
  { value: "REVIEW_REQUIRED",  label: "검토 대기" },
  { value: "ANALYZING",        label: "분석 중" },
  { value: "APPROVED",         label: "승인 완료" },
  { value: "PARTIAL",          label: "일부 완료" },
  { value: "FAILED",           label: "실패" },
];

// display_status → chip 색상
const CHIP_COLOR: Record<string, { bg: string; text: string }> = {
  "발행 완료": { bg: "#E8F5E9", text: "#2E7D32" },
  "검토 대기": { bg: "#FFF3E0", text: "#E65100" },
  "분석 중":   { bg: "#E3F2FD", text: "#1565C0" },
  "분석 준비": { bg: "#E8EAF6", text: "#3949AB" },
  "승인 완료": { bg: "#F3E5F5", text: "#6A1B9A" },
  "일부 완료": { bg: "#FFF8E1", text: "#F57F17" },
  "실패":      { bg: "#FFEBEE", text: "#C62828" },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 타입
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
interface ReportRow {
  report_id: string;
  student_id: string;
  student_name: string;
  class_group_id: string | null;
  class_name: string | null;
  teacher_id: string | null;
  teacher_name: string | null;
  period_start: string;
  period_end: string;
  product_status: string;
  display_status: string;
  analysis_status: string | null;
  teacher_reviewed_at: string | null;
  published_at: string | null;
  has_file: boolean;
}
interface ClassGroup { id: string; name: string; teacher_id: string | null; teacher_name: string | null; }
interface SummaryData {
  summary: { published: number; review_required: number; analyzing: number; failed: number };
  filters: { year: number; month: number };
  students: ReportRow[];
  class_groups: ClassGroup[];
  pagination: { page: number; limit: number; total: number; has_more: boolean };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 화면
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export default function ReportHubScreen() {
  const { token } = useAuth();

  // ── 날짜 상태 ──────────────────────────────────────────
  const now = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  // ── 필터 상태 ──────────────────────────────────────────
  const [q,              setQ]              = useState("");
  const [initial,        setInitial]        = useState("전체");
  const [classGroupId,   setClassGroupId]   = useState<string | null>(null);
  const [teacherId,      setTeacherId]      = useState<string | null>(null);
  const [statusFilter,   setStatusFilter]   = useState("ALL");

  // ── 데이터 상태 ────────────────────────────────────────
  const [data,      setData]      = useState<SummaryData | null>(null);
  const [rows,      setRows]      = useState<ReportRow[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [page,      setPage]      = useState(1);

  // ── 필터 모달 ──────────────────────────────────────────
  const [filterModal, setFilterModal] = useState(false);

  // ── 삭제 상태 ──────────────────────────────────────────
  const [deleteTarget,  setDeleteTarget]  = useState<ReportRow | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting,      setDeleting]      = useState(false);

  // ── debounce ref ───────────────────────────────────────
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // API 호출
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const fetchData = useCallback(async (opts: {
    pg?: number; reset?: boolean;
    yr?: number; mo?: number;
    q?: string; init?: string;
    cgId?: string | null; tId?: string | null; st?: string;
  } = {}) => {
    const pg   = opts.pg   ?? 1;
    const yr   = opts.yr   ?? year;
    const mo   = opts.mo   ?? month;
    const qv   = opts.q    ?? q;
    const init = opts.init ?? initial;
    const cgId = opts.cgId !== undefined ? opts.cgId : classGroupId;
    const tId  = opts.tId  !== undefined ? opts.tId  : teacherId;
    const st   = opts.st   ?? statusFilter;

    if (pg === 1) { setLoading(true); setError(null); }
    else { setLoadingMore(true); }

    try {
      const params = new URLSearchParams({
        year: String(yr), month: String(mo), page: String(pg), limit: "30",
      });
      if (qv)   params.set("q", qv);
      if (init && init !== "전체") params.set("initial", init);
      if (cgId) params.set("class_group_id", cgId);
      if (tId)  params.set("teacher_id", tId);
      if (st && st !== "ALL") params.set("status", st);

      const resp = await apiRequest(token, `/admin/reports/summary?${params.toString()}`);
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error((errBody as any)?.error ?? `서버 오류 (${resp.status})`);
      }
      const res: SummaryData = await resp.json();

      if (pg === 1) {
        setData(res);
        setRows(res.students);
      } else {
        setRows(prev => [...prev, ...res.students]);
        setData(prev => prev ? { ...prev, pagination: res.pagination } : res);
      }
      setPage(pg);
    } catch (e: any) {
      setError(e?.message ?? "조회에 실패했습니다.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [token, year, month, q, initial, classGroupId, teacherId, statusFilter]);

  // 최초 + 월/필터 변경 시 재조회
  useEffect(() => { fetchData({ pg: 1, reset: true }); }, [year, month, initial, classGroupId, teacherId, statusFilter]);

  // 검색어 debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchData({ pg: 1, q });
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q]);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 핸들러
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const onMonthPress = (m: number) => { setMonth(m); setPage(1); };
  const onInitPress  = (i: string) => { setInitial(i); setPage(1); };
  const onLoadMore   = () => {
    if (data?.pagination.has_more && !loadingMore && !loading) {
      fetchData({ pg: page + 1 });
    }
  };

  // row tap: 기존 x-growth 화면으로 studentId 전달
  const onRowPress = (row: ReportRow) => {
    router.push({
      pathname: "/(admin)/x-growth" as any,
      params: { preselect_student_id: row.student_id },
    });
  };

  // 삭제 확인 모달 열기
  const onDeletePress = (row: ReportRow) => {
    setDeleteTarget(row);
    setDeleteConfirm(true);
  };

  // 삭제 실행
  const onDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleteConfirm(false);
    setDeleting(true);
    try {
      const resp = await apiRequest(
        token,
        `/admin/growth-reports/${deleteTarget.report_id}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: "DELETE_GROWTH_REPORT" }),
        },
      );
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error((errBody as any)?.error ?? `오류 (${resp.status})`);
      }
      // 목록에서 즉시 제거
      setRows(prev => prev.filter(r => r.report_id !== deleteTarget.report_id));
      setData(prev =>
        prev
          ? { ...prev, pagination: { ...prev.pagination, total: Math.max(0, prev.pagination.total - 1) } }
          : prev,
      );
    } catch (e: any) {
      // 오류 시 목록 새로 고침
      fetchData({ pg: 1, reset: true });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }, [deleteTarget, token, fetchData]);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 서브 컴포넌트
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const KpiCard = ({ label, value, color }: { label: string; value: number; color: string }) => (
    <View style={[s.kpiCard, { borderTopColor: color }]}>
      <Text style={[s.kpiValue, { color }]}>{value}</Text>
      <Text style={s.kpiLabel}>{label}</Text>
    </View>
  );

  const StatusChip = ({ status }: { status: string }) => {
    const c = CHIP_COLOR[status] ?? { bg: "#F5F5F5", text: "#757575" };
    return (
      <View style={[s.chip, { backgroundColor: c.bg }]}>
        <Text style={[s.chipText, { color: c.text }]}>{status}</Text>
      </View>
    );
  };

  const renderRow = ({ item }: { item: ReportRow }) => {
    const periodStr = item.period_start ? item.period_start.slice(0, 7).replace("-", ".") : "-";
    return (
      <Pressable style={s.row} onPress={() => onRowPress(item)}>
        <View style={s.rowLeft}>
          <Text style={s.rowName}>{item.student_name}</Text>
          <Text style={s.rowSub}>
            {item.class_name ?? "반 없음"}{item.teacher_name ? ` · ${item.teacher_name}` : ""}
          </Text>
          <Text style={s.rowPeriod}>{periodStr}</Text>
        </View>
        <View style={s.rowRight}>
          <StatusChip status={item.display_status} />
          {item.has_file && (
            <View style={s.fileBadge}>
              <LucideIcon name="FileText" size={10} color="#555" />
              <Text style={s.fileBadgeText}>파일</Text>
            </View>
          )}
          <TouchableOpacity
            style={s.menuBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={(e) => { e.stopPropagation(); onDeletePress(item); }}
          >
            <LucideIcon name="Trash2" size={15} color="#C62828" />
          </TouchableOpacity>
        </View>
      </Pressable>
    );
  };

  const renderEmpty = () => {
    if (loading) return null;
    return (
      <View style={s.emptyWrap}>
        <LucideIcon name="FileSearch" size={40} color={C.textMuted} />
        <Text style={s.emptyTitle}>리포트가 없습니다</Text>
        <Text style={s.emptySub}>
          {q || initial !== "전체" || classGroupId || teacherId || statusFilter !== "ALL"
            ? "필터 조건을 변경해보세요."
            : `${year}년 ${month}월에 생성된 리포트가 없습니다.`}
        </Text>
      </View>
    );
  };

  const renderFooter = () => {
    if (!loadingMore) return <View style={{ height: 40 }} />;
    return (
      <View style={s.footerLoading}>
        <ActivityIndicator size="small" color={C.textMuted} />
        <Text style={s.footerText}>불러오는 중...</Text>
      </View>
    );
  };

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 렌더
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const activeFilters = [
    classGroupId ? (data?.class_groups.find(g => g.id === classGroupId)?.name ?? "반") : null,
    teacherId    ? (data?.class_groups.find(g => g.teacher_id === teacherId)?.teacher_name ?? "선생님") : null,
    statusFilter !== "ALL" ? (STATUS_OPTIONS.find(o => o.value === statusFilter)?.label ?? statusFilter) : null,
  ].filter(Boolean);

  return (
    <SafeAreaView style={s.safe}>
      <SubScreenHeader title="AI 학생리포트" homePath="/(admin)/dashboard" />

      <FlatList
        data={rows}
        keyExtractor={item => item.report_id}
        renderItem={renderRow}
        onEndReached={onLoadMore}
        onEndReachedThreshold={0.3}
        ListFooterComponent={renderFooter}
        ListEmptyComponent={renderEmpty}
        ListHeaderComponent={
          <View>
            {/* ── KPI ── */}
            {loading && !data ? (
              <View style={s.kpiRow}>
                {[0,1,2,3].map(i => <View key={i} style={[s.kpiCard, s.kpiSkeleton]} />)}
              </View>
            ) : error ? (
              <View style={s.errorWrap}>
                <LucideIcon name="AlertCircle" size={28} color="#C62828" />
                <Text style={s.errorText}>{error}</Text>
                <TouchableOpacity style={s.retryBtn} onPress={() => fetchData({ pg: 1, reset: true })}>
                  <Text style={s.retryText}>다시 시도</Text>
                </TouchableOpacity>
              </View>
            ) : data ? (
              <View style={s.kpiRow}>
                <KpiCard label="발행 완료" value={data.summary.published}       color="#2E7D32" />
                <KpiCard label="검토 대기" value={data.summary.review_required} color="#E65100" />
                <KpiCard label="분석 중"   value={data.summary.analyzing}       color="#1565C0" />
                <KpiCard label="실패"       value={data.summary.failed}          color="#C62828" />
              </View>
            ) : null}

            {/* ── 연도 + 월 INDEX ── */}
            <View style={s.sectionRow}>
              <TouchableOpacity style={s.yearBtn} onPress={() => setYear(y => y - 1)}>
                <LucideIcon name="ChevronLeft" size={16} color={C.textPrimary} />
              </TouchableOpacity>
              <Text style={s.yearText}>{year}년</Text>
              <TouchableOpacity style={s.yearBtn} onPress={() => setYear(y => y + 1)} disabled={year >= now.getFullYear()}>
                <LucideIcon name="ChevronRight" size={16} color={year >= now.getFullYear() ? C.textMuted : C.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.monthRow}>
              {MONTHS.map((m, idx) => {
                const mo = idx + 1;
                const active = mo === month;
                return (
                  <TouchableOpacity key={mo} style={[s.monthPill, active && s.monthPillActive]} onPress={() => onMonthPress(mo)}>
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

            {/* ── 가나다 INDEX ── */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.initialRow}>
              {INITIALS.map(ini => {
                const active = ini === initial;
                return (
                  <TouchableOpacity key={ini} style={[s.initialPill, active && s.initialPillActive]} onPress={() => onInitPress(ini)}>
                    <Text style={[s.initialText, active && s.initialTextActive]}>{ini}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* ── 필터 버튼 ── */}
            <View style={s.filterRow}>
              <TouchableOpacity style={[s.filterBtn, activeFilters.length > 0 && s.filterBtnActive]} onPress={() => setFilterModal(true)}>
                <LucideIcon name="SlidersHorizontal" size={14} color={activeFilters.length > 0 ? "#1565C0" : C.textMuted} />
                <Text style={[s.filterBtnText, activeFilters.length > 0 && s.filterBtnTextActive]}>
                  필터{activeFilters.length > 0 ? ` (${activeFilters.length})` : ""}
                </Text>
              </TouchableOpacity>
              {activeFilters.length > 0 && (
                <TouchableOpacity style={s.clearBtn} onPress={() => {
                  setClassGroupId(null); setTeacherId(null); setStatusFilter("ALL");
                }}>
                  <Text style={s.clearBtnText}>초기화</Text>
                </TouchableOpacity>
              )}
              <Text style={s.totalCount}>
                총 {data?.pagination.total ?? 0}건
              </Text>
            </View>
          </View>
        }
      />

      {/* ── 삭제 확인 모달 ── */}
      <ConfirmModal
        visible={deleteConfirm}
        title="리포트 삭제"
        message={`이 성장리포트를 삭제하시겠습니까?\n리포트에 남겨진 좋아요와 댓글도 함께 삭제됩니다.`}
        destructive
        onConfirm={onDeleteConfirm}
        onCancel={() => { setDeleteConfirm(false); setDeleteTarget(null); }}
      />

      {/* ── 필터 모달 ── */}
      <Modal visible={filterModal} animationType="slide" transparent onRequestClose={() => setFilterModal(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setFilterModal(false)}>
          <Pressable style={s.modalSheet} onPress={e => e.stopPropagation()}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>필터</Text>

            {/* 상태 */}
            <Text style={s.filterSectionLabel}>상태</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
              {STATUS_OPTIONS.map(opt => {
                const active = statusFilter === opt.value;
                return (
                  <TouchableOpacity key={opt.value} style={[s.modalPill, active && s.modalPillActive]}
                    onPress={() => setStatusFilter(opt.value)}>
                    <Text style={[s.modalPillText, active && s.modalPillTextActive]}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* 반 */}
            <Text style={s.filterSectionLabel}>반</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
              <TouchableOpacity style={[s.modalPill, !classGroupId && s.modalPillActive]}
                onPress={() => setClassGroupId(null)}>
                <Text style={[s.modalPillText, !classGroupId && s.modalPillTextActive]}>전체</Text>
              </TouchableOpacity>
              {(data?.class_groups ?? []).map(g => (
                <TouchableOpacity key={g.id} style={[s.modalPill, classGroupId === g.id && s.modalPillActive]}
                  onPress={() => setClassGroupId(g.id)}>
                  <Text style={[s.modalPillText, classGroupId === g.id && s.modalPillTextActive]}>{g.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* 선생님 */}
            <Text style={s.filterSectionLabel}>선생님</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
              <TouchableOpacity style={[s.modalPill, !teacherId && s.modalPillActive]}
                onPress={() => setTeacherId(null)}>
                <Text style={[s.modalPillText, !teacherId && s.modalPillTextActive]}>전체</Text>
              </TouchableOpacity>
              {/* 선생님 중복 제거 */}
              {Array.from(new Map((data?.class_groups ?? [])
                .filter(g => g.teacher_id && g.teacher_name)
                .map(g => [g.teacher_id!, g])).values()).map(g => (
                <TouchableOpacity key={g.teacher_id} style={[s.modalPill, teacherId === g.teacher_id && s.modalPillActive]}
                  onPress={() => setTeacherId(g.teacher_id!)}>
                  <Text style={[s.modalPillText, teacherId === g.teacher_id && s.modalPillTextActive]}>{g.teacher_name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity style={s.modalApplyBtn} onPress={() => setFilterModal(false)}>
              <Text style={s.modalApplyText}>적용</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 스타일
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.background },

  // KPI
  kpiRow:      { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  kpiCard:     { flex: 1, backgroundColor: "#fff", borderRadius: 10, borderTopWidth: 3, paddingVertical: 12, paddingHorizontal: 8, alignItems: "center", gap: 4,
                 shadowColor: "#000", shadowOpacity: 0.04, shadowOffset: { width: 0, height: 1 }, shadowRadius: 3, elevation: 1 },
  kpiSkeleton: { borderTopColor: "#E0E0E0", opacity: 0.4, height: 60 },
  kpiValue:    { fontSize: 22, fontFamily: "Pretendard-Bold" },
  kpiLabel:    { fontSize: 11, color: C.textMuted, fontFamily: "Pretendard-Regular", textAlign: "center" },

  // 연도/월
  sectionRow:  { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 8 },
  yearBtn:     { padding: 6 },
  yearText:    { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: C.textPrimary },
  monthRow:    { paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  monthPill:   { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: "#F5F5F5" },
  monthPillActive: { backgroundColor: "#0C1A2E" },
  monthPillText: { fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Medium" },
  monthPillTextActive: { color: "#fff" },

  // 검색
  searchRow:   { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginVertical: 4,
                 backgroundColor: "#F5F5F5", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  searchInput: { flex: 1, fontSize: 14, color: C.textPrimary, fontFamily: "Pretendard-Regular", padding: 0 },

  // 가나다
  initialRow:  { paddingHorizontal: 12, paddingVertical: 6, gap: 4 },
  initialPill: { minWidth: 34, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 16, backgroundColor: "#F5F5F5", alignItems: "center" },
  initialPillActive: { backgroundColor: "#1565C0" },
  initialText: { fontSize: 12, color: C.textMuted, fontFamily: "Pretendard-Medium" },
  initialTextActive: { color: "#fff" },

  // 필터 행
  filterRow:  { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  filterBtn:  { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7,
                borderRadius: 20, backgroundColor: "#F5F5F5", borderWidth: 1, borderColor: "transparent" },
  filterBtnActive: { borderColor: "#1565C0", backgroundColor: "#E3F2FD" },
  filterBtnText: { fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Medium" },
  filterBtnTextActive: { color: "#1565C0" },
  clearBtn:  { paddingHorizontal: 10, paddingVertical: 7 },
  clearBtnText: { fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Regular" },
  totalCount: { marginLeft: "auto", fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Regular" },

  // 목록 row
  row: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between",
         paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "#fff",
         borderBottomWidth: 1, borderColor: "#F0F0F0" },
  rowLeft:   { flex: 1, gap: 2 },
  rowName:   { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: C.textPrimary },
  rowSub:    { fontSize: 12, color: C.textMuted, fontFamily: "Pretendard-Regular" },
  rowPeriod: { fontSize: 12, color: C.textMuted, fontFamily: "Pretendard-Regular" },
  rowRight:  { alignItems: "flex-end", gap: 4, marginLeft: 8 },

  // 상태 chip
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  chipText: { fontSize: 11, fontFamily: "Pretendard-Medium" },

  // 파일 badge
  fileBadge:     { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2,
                   borderRadius: 8, backgroundColor: "#F5F5F5" },
  fileBadgeText: { fontSize: 10, color: "#555", fontFamily: "Pretendard-Regular" },

  // 삭제 버튼
  menuBtn: { padding: 4, marginLeft: 4 },

  // empty / error / loading
  emptyWrap:  { alignItems: "center", paddingTop: 60, gap: 8 },
  emptyTitle: { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: C.textPrimary },
  emptySub:   { fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Regular" },
  errorWrap:  { alignItems: "center", paddingTop: 40, gap: 10, paddingHorizontal: 24 },
  errorText:  { fontSize: 14, color: "#C62828", textAlign: "center", fontFamily: "Pretendard-Regular" },
  retryBtn:   { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: "#0C1A2E" },
  retryText:  { color: "#fff", fontSize: 14, fontFamily: "Pretendard-SemiBold" },
  footerLoading: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16 },
  footerText: { fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Regular" },

  // 필터 모달
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalSheet:   { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
                  paddingHorizontal: 20, paddingBottom: 40, paddingTop: 12, gap: 12 },
  modalHandle:  { width: 40, height: 4, borderRadius: 2, backgroundColor: "#DDD", alignSelf: "center", marginBottom: 4 },
  modalTitle:   { fontSize: 17, fontFamily: "Pretendard-Bold", color: C.textPrimary, marginBottom: 4 },
  filterSectionLabel: { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: C.textMuted, marginTop: 4 },
  modalPill:    { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
                  backgroundColor: "#F5F5F5", borderWidth: 1, borderColor: "transparent" },
  modalPillActive: { backgroundColor: "#E3F2FD", borderColor: "#1565C0" },
  modalPillText: { fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Medium" },
  modalPillTextActive: { color: "#1565C0" },
  modalApplyBtn: { marginTop: 8, backgroundColor: "#0C1A2E", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  modalApplyText: { color: "#fff", fontSize: 15, fontFamily: "Pretendard-SemiBold" },
});
