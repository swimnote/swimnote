/**
 * (admin)/curriculum-hub.tsx — AI 커리큘럼 허브 (PHASE 4, INDEX FIX)
 *
 * FIX: students list → FlatList virtualization (ScrollView+map 제거)
 * FIX: 반 filter UI 추가 (class_group_id param 기존 API 그대로 사용)
 *
 * 두 시스템 완전 분리 유지:
 *   A. 교육 커리큘럼 (curriculum_versions → curriculum_items → student_curriculum_assignments → growth_events)
 *   B. X Global AI 일지 템플릿 (global_template_sets → diary_templates scope='x_global')
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { LucideIcon } from "@/components/common/LucideIcon";

const C = Colors.light;

// ─── 타입 ────────────────────────────────────────────────────────────────────
interface CurriculumVersion {
  curriculum_version_id: string;
  version_name: string;
  is_active: boolean;
  item_count: number;
  assigned_student_count: number;
}
interface Summary {
  active_versions: number;
  active_items: number;
  assigned_students: number;
  unassigned_students: number;
}
interface ParentAi {
  current_month_search_count: number;
  latest_at: string | null;
  searcher_count: number;
}
interface XGlobal {
  active_set_id: string;
  active_set_name: string;
  template_count: number;
}
interface SummaryResponse {
  summary: Summary;
  versions: CurriculumVersion[];
  parent_ai: ParentAi;
  x_global: XGlobal | null;
}
interface StudentRow {
  student_id: string;
  student_name: string;
  class_group_id: string | null;
  class_name: string | null;
  teacher_id: string | null;
  teacher_name: string | null;
  assignment: {
    curriculum_version_id: string;
    curriculum_version_name: string;
    is_active: boolean;
  } | null;
  recent_growth_event_count: number;
  latest_growth_event_at: string | null;
}
interface ClassGroup { id: string; name: string; }

// ─── 상수 ───────────────────────────────────────────────────────────────────
const INITIALS = ["ㄱ","ㄴ","ㄷ","ㄹ","ㅁ","ㅂ","ㅅ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];

function formatRelative(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diffDays === 0) return "오늘";
  if (diffDays === 1) return "어제";
  if (diffDays < 7)  return `${diffDays}일 전`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}주 전`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ─── 메인 컴포넌트 ───────────────────────────────────────────────────────────
export default function CurriculumHubScreen() {
  const { token } = useAuth();

  // 요약
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError,   setSummaryError]   = useState<string | null>(null);
  const [summaryData,    setSummaryData]    = useState<SummaryResponse | null>(null);

  // 학생 탐색
  const [searchText,      setSearchText]      = useState("");
  const [debouncedQ,      setDebouncedQ]      = useState("");
  const [selectedInitial, setSelectedInitial] = useState("");
  const [filterClassId,   setFilterClassId]   = useState("");
  const [filterAssign,    setFilterAssign]    = useState<""|"assigned"|"unassigned">("");
  const [filterVersionId, setFilterVersionId] = useState("");
  const [pendingClass,    setPendingClass]    = useState("");
  const [pendingAssign,   setPendingAssign]   = useState<""|"assigned"|"unassigned">("");
  const [pendingVersion,  setPendingVersion]  = useState("");
  const [showFilter,      setShowFilter]      = useState(false);

  // 학생 목록 (FlatList)
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [studentsError,   setStudentsError]   = useState<string | null>(null);
  const [students,        setStudents]        = useState<StudentRow[]>([]);
  const [total,           setTotal]           = useState(0);
  const [hasMore,         setHasMore]         = useState(false);
  const [loadingMore,     setLoadingMore]     = useState(false);
  const pageRef = useRef(1);

  // 반 목록 — student 응답에서 누적 수집 (API 변경 없음)
  const [classGroups, setClassGroups] = useState<ClassGroup[]>([]);

  // 검색 debounce
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedQ(searchText.trim()), 350);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchText]);

  // ─── 요약 로드 ────────────────────────────────────────────────────────────
  const fetchSummary = useCallback(async () => {
    if (!token) return;
    setSummaryLoading(true); setSummaryError(null);
    try {
      const res = await apiRequest(token, "/admin/curriculum/summary");
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.error || "조회 실패"); }
      setSummaryData(await res.json());
    } catch (e: any) {
      setSummaryError(e?.message || "커리큘럼 현황을 불러오지 못했습니다.");
    } finally {
      setSummaryLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  // ─── 학생 목록 로드 ───────────────────────────────────────────────────────
  const fetchStudents = useCallback(async (reset = true) => {
    if (!token) return;
    if (reset) { setStudentsLoading(true); setStudentsError(null); pageRef.current = 1; }
    else        { setLoadingMore(true); }
    try {
      const p = new URLSearchParams({ page: reset ? "1" : String(pageRef.current + 1), limit: "30" });
      if (debouncedQ)      p.set("q",                    debouncedQ);
      if (selectedInitial) p.set("initial",              selectedInitial);
      if (filterClassId)   p.set("class_group_id",       filterClassId);
      if (filterAssign)    p.set("assignment",            filterAssign);
      if (filterVersionId) p.set("curriculum_version_id",filterVersionId);
      const res = await apiRequest(token, `/admin/curriculum/students?${p.toString()}`);
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.error || "조회 실패"); }
      const data = await res.json();
      const rows: StudentRow[] = data.students ?? [];
      if (reset) { setStudents(rows); pageRef.current = 1; }
      else       { setStudents(prev => [...prev, ...rows]); pageRef.current = data.pagination?.page ?? pageRef.current + 1; }
      setTotal(data.pagination?.total ?? 0);
      setHasMore(data.pagination?.has_more ?? false);
      // 반 목록 누적 (class_group_id / class_name 기준)
      setClassGroups(prev => {
        const map = new Map(prev.map(g => [g.id, g]));
        for (const r of rows) {
          if (r.class_group_id && r.class_name && !map.has(r.class_group_id)) {
            map.set(r.class_group_id, { id: r.class_group_id, name: r.class_name });
          }
        }
        return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "ko"));
      });
    } catch (e: any) {
      setStudentsError(e?.message || "학생 목록을 불러오지 못했습니다.");
    } finally {
      setStudentsLoading(false); setLoadingMore(false);
    }
  }, [token, debouncedQ, selectedInitial, filterClassId, filterAssign, filterVersionId]);

  useEffect(() => { fetchStudents(true); }, [debouncedQ, selectedInitial, filterClassId, filterAssign, filterVersionId]);

  // ─── 필터 ───────────────────────────────────────────────────────────────
  const activeFilterCount = [filterClassId, filterAssign, filterVersionId].filter(Boolean).length;
  const openFilter = () => {
    setPendingClass(filterClassId); setPendingAssign(filterAssign); setPendingVersion(filterVersionId);
    setShowFilter(true);
  };
  const applyFilter = () => {
    setFilterClassId(pendingClass); setFilterAssign(pendingAssign); setFilterVersionId(pendingVersion);
    setShowFilter(false);
  };
  const resetFilter = () => {
    setPendingClass(""); setPendingAssign(""); setPendingVersion("");
    setFilterClassId(""); setFilterAssign(""); setFilterVersionId("");
    setShowFilter(false);
  };

  // ─── 학생 row 렌더 ───────────────────────────────────────────────────────
  const renderStudent = useCallback(({ item }: { item: StudentRow }) => (
    <View style={[s.studentRow, { marginHorizontal: 16 }]}>
      <View style={s.studentTop}>
        <Text style={s.studentName}>{item.student_name}</Text>
        {item.assignment ? (
          <View style={[s.assignChip, s.assignChipActive]}>
            <Text style={s.assignChipText} numberOfLines={1}>{item.assignment.curriculum_version_name}</Text>
          </View>
        ) : (
          <View style={s.assignChip}>
            <Text style={[s.assignChipText, { color: C.textSecondary }]}>미배정</Text>
          </View>
        )}
      </View>
      <View style={s.studentMeta}>
        <LucideIcon name="users" size={12} color={C.textSecondary} />
        <Text style={s.studentMetaText}>{item.class_name ?? "반 미정"} · {item.teacher_name ?? "선생님 미정"}</Text>
      </View>
      {item.recent_growth_event_count > 0 && (
        <View style={s.growthRow}>
          <LucideIcon name="trending-up" size={11} color="#6B7280" />
          <Text style={s.growthText}>
            최근 성장 이벤트 {item.recent_growth_event_count}건
            {item.latest_growth_event_at ? ` · ${formatRelative(item.latest_growth_event_at)}` : ""}
          </Text>
        </View>
      )}
    </View>
  ), []);

  // ─── ListHeaderComponent ─────────────────────────────────────────────────
  const ListHeader = (
    <View>
      {/* ── A. 교육 커리큘럼 ────────────────────────────────────────── */}
      <View style={s.sectionHeader}>
        <Text style={s.sectionTitle}>교육 커리큘럼</Text>
        <Text style={s.sectionSub}>curriculum_versions → student_curriculum_assignments</Text>
      </View>

      {/* KPI */}
      {summaryLoading ? (
        <View style={s.kpiGrid}>
          {[1,2,3,4].map(i => <View key={i} style={[s.kpiCard, { opacity: 0.3 }]}><View style={{ height: 28, width: 40, backgroundColor: C.border, borderRadius: 6 }} /></View>)}
        </View>
      ) : summaryError ? (
        <View style={s.errBox}>
          <LucideIcon name="alert-circle" size={20} color={C.error} />
          <Text style={s.errText}>{summaryError}</Text>
          <Pressable style={s.retryBtn} onPress={fetchSummary}><Text style={s.retryBtnText}>다시 시도</Text></Pressable>
        </View>
      ) : summaryData ? (
        <>
          <View style={s.kpiGrid}>
            <View style={s.kpiCard}>
              <Text style={s.kpiValue}>{summaryData.summary.active_versions}</Text>
              <Text style={s.kpiLabel}>활성 커리큘럼</Text>
            </View>
            <View style={s.kpiCard}>
              <Text style={s.kpiValue}>{summaryData.summary.active_items}</Text>
              <Text style={s.kpiLabel}>커리큘럼 항목</Text>
            </View>
            <View style={s.kpiCard}>
              <Text style={s.kpiValue}>{summaryData.summary.assigned_students}</Text>
              <Text style={s.kpiLabel}>배정 학생</Text>
            </View>
            <View style={[s.kpiCard, summaryData.summary.unassigned_students > 0 && s.kpiCardWarn]}>
              <Text style={s.kpiValue}>{summaryData.summary.unassigned_students}</Text>
              <Text style={s.kpiLabel}>미배정 학생</Text>
            </View>
          </View>

          {/* 커리큘럼 버전 INDEX */}
          <Text style={s.subSectionTitle}>커리큘럼 버전</Text>
          {summaryData.versions.length === 0 ? (
            <Text style={s.emptyDesc}>등록된 커리큘럼 버전이 없습니다.</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
              <Pressable style={[s.versionChip, !filterVersionId && s.versionChipActive]}
                onPress={() => setFilterVersionId("")}>
                <Text style={[s.versionChipText, !filterVersionId && s.versionChipTextActive]}>전체</Text>
              </Pressable>
              {summaryData.versions.map(v => (
                <Pressable key={v.curriculum_version_id}
                  style={[s.versionChip, filterVersionId === v.curriculum_version_id && s.versionChipActive]}
                  onPress={() => setFilterVersionId(filterVersionId === v.curriculum_version_id ? "" : v.curriculum_version_id)}>
                  {v.is_active && <View style={s.activeVersionDot} />}
                  <Text style={[s.versionChipText, filterVersionId === v.curriculum_version_id && s.versionChipTextActive]}
                    numberOfLines={1}>{v.version_name}</Text>
                  <Text style={s.versionChipMeta}>{v.item_count}항목 · {v.assigned_student_count}명</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </>
      ) : null}

      {/* ── 학생 탐색 헤더 ───────────────────────────────────────────── */}
      <Text style={s.subSectionTitle}>학생 탐색</Text>

      {/* 검색 + 필터 버튼 */}
      <View style={s.searchRow}>
        <View style={s.searchBox}>
          <LucideIcon name="search" size={14} color={C.textSecondary} />
          <TextInput style={s.searchInput} value={searchText} onChangeText={setSearchText}
            placeholder="학생명 검색" placeholderTextColor={C.textSecondary} returnKeyType="search" />
          {searchText.length > 0 && (
            <Pressable onPress={() => setSearchText("")} hitSlop={8}>
              <LucideIcon name="x" size={14} color={C.textSecondary} />
            </Pressable>
          )}
        </View>
        <Pressable style={[s.filterBtn, activeFilterCount > 0 && s.filterBtnActive]} onPress={openFilter}>
          <LucideIcon name="sliders-horizontal" size={14} color={activeFilterCount > 0 ? "#fff" : C.textSecondary} />
          {activeFilterCount > 0 && <Text style={s.filterCount}>{activeFilterCount}</Text>}
        </Pressable>
      </View>

      {/* 가나다 INDEX */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.initialBar}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 6 }}>
        <Pressable style={[s.initialBtn, !selectedInitial && s.initialBtnActive]}
          onPress={() => setSelectedInitial("")}>
          <Text style={[s.initialBtnText, !selectedInitial && s.initialBtnTextActive]}>전체</Text>
        </Pressable>
        {INITIALS.map(ch => (
          <Pressable key={ch} style={[s.initialBtn, selectedInitial === ch && s.initialBtnActive]}
            onPress={() => setSelectedInitial(selectedInitial === ch ? "" : ch)}>
            <Text style={[s.initialBtnText, selectedInitial === ch && s.initialBtnTextActive]}>{ch}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* 결과 수 / 로딩 */}
      {studentsLoading ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginLeft: 16, marginBottom: 4 }}>
          <ActivityIndicator size="small" color={C.primary} />
          <Text style={s.resultCount}>불러오는 중…</Text>
        </View>
      ) : studentsError ? null : (
        <Text style={s.resultCount}>{total.toLocaleString()}명</Text>
      )}

      {/* 에러 */}
      {studentsError ? (
        <View style={s.errBox}>
          <LucideIcon name="alert-circle" size={20} color={C.error} />
          <Text style={s.errText}>{studentsError}</Text>
          <Pressable style={s.retryBtn} onPress={() => fetchStudents(true)}><Text style={s.retryBtnText}>다시 시도</Text></Pressable>
        </View>
      ) : null}
    </View>
  );

  // ─── ListFooterComponent ─────────────────────────────────────────────────
  const ListFooter = (
    <View>
      {/* load more */}
      {hasMore && !loadingMore && (
        <Pressable style={[s.loadMoreBtn, { marginHorizontal: 16 }]} onPress={() => fetchStudents(false)}>
          <Text style={s.loadMoreBtnText}>더 보기</Text>
        </Pressable>
      )}
      {loadingMore && <ActivityIndicator color={C.primary} style={{ marginVertical: 14 }} />}

      {/* ── Parent AI 사용 현황 ──────────────────────────────────────── */}
      <View style={[s.sectionHeader, { marginTop: 24 }]}>
        <Text style={s.sectionTitle}>학부모 AI 커리큘럼 검색</Text>
        <Text style={s.sectionSub}>event_logs (category=AI, feature=parent_curriculum_search)</Text>
      </View>
      {summaryData && (
        <View style={s.parentAiCard}>
          <View style={s.parentAiRow}>
            <LucideIcon name="search" size={16} color={C.primary} />
            <Text style={s.parentAiValue}>{summaryData.parent_ai.current_month_search_count}건</Text>
            <Text style={s.parentAiLabel}>이번 달 AI 커리큘럼 검색</Text>
          </View>
          {summaryData.parent_ai.searcher_count > 0 && (
            <Text style={s.parentAiSub}>
              학부모 {summaryData.parent_ai.searcher_count}명 사용
              {summaryData.parent_ai.latest_at ? ` · 최근 ${formatRelative(summaryData.parent_ai.latest_at)}` : ""}
            </Text>
          )}
          {summaryData.parent_ai.current_month_search_count === 0 && (
            <Text style={s.parentAiSub}>이번 달 검색 기록 없음</Text>
          )}
        </View>
      )}

      {/* ── B. X Global AI 일지 템플릿 (완전 독립 섹션) ─────────────── */}
      <View style={[s.xGlobalSection, { marginTop: 20, marginBottom: 40 }]}>
        <View style={s.xGlobalHeader}>
          <LucideIcon name="sparkles" size={16} color="#6366F1" />
          <Text style={s.xGlobalTitle}>X Global AI 일지 템플릿</Text>
        </View>
        <Text style={s.xGlobalSub}>AI 일지 생성에 사용되는 글로벌 템플릿</Text>
        <Text style={s.xGlobalNote}>※ 교육 커리큘럼과 별개의 독립 시스템</Text>
        {summaryData?.x_global ? (
          <View>
            <View style={s.xGlobalRow}>
              <View style={s.xGlobalActiveBadge}><Text style={s.xGlobalActiveBadgeText}>ACTIVE</Text></View>
              <Text style={s.xGlobalSetName}>{summaryData.x_global.active_set_name}</Text>
            </View>
            <Text style={s.xGlobalCount}>템플릿 {summaryData.x_global.template_count}개</Text>
          </View>
        ) : summaryData && !summaryData.x_global ? (
          <Text style={s.emptyDesc}>활성 글로벌 템플릿 셋 없음</Text>
        ) : null}
      </View>
    </View>
  );

  // ─── Empty ───────────────────────────────────────────────────────────────
  const ListEmpty = studentsLoading || studentsError ? null : (
    <View style={s.emptyBox}>
      <LucideIcon name="users" size={32} color={C.border} />
      <Text style={s.emptyTitle}>학생 없음</Text>
      <Text style={s.emptyDesc}>
        {debouncedQ || selectedInitial || activeFilterCount > 0
          ? "필터 조건에 해당하는 학생이 없습니다."
          : "등록된 학생이 없습니다."}
      </Text>
    </View>
  );

  // ─── 렌더 ───────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="AI 커리큘럼" homePath="/(admin)/dashboard" />

      {/* FlatList — virtualization, ListHeader/Footer로 나머지 섹션 포함 */}
      <FlatList
        data={students}
        keyExtractor={item => item.student_id}
        renderItem={renderStudent}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={ListFooter}
        ListEmptyComponent={ListEmpty}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        contentContainerStyle={{ paddingTop: 0, paddingBottom: 8 }}
        onEndReached={() => { if (hasMore && !loadingMore && !studentsLoading) fetchStudents(false); }}
        onEndReachedThreshold={0.3}
        keyboardShouldPersistTaps="handled"
        removeClippedSubviews={false}
      />

      {/* ── 필터 모달 (반 + 배정 상태 + 커리큘럼 버전) ────────────────── */}
      <Modal visible={showFilter} transparent animationType="slide" onRequestClose={() => setShowFilter(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setShowFilter(false)}>
          <Pressable style={s.filterModal} onPress={e => e.stopPropagation()}>
            <View style={s.filterHandle} />
            <Text style={s.filterTitle}>필터</Text>

            {/* 반 filter */}
            <Text style={s.filterSection}>반</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}
              contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}>
              <Pressable style={[s.filterChip, !pendingClass && s.filterChipActive]}
                onPress={() => setPendingClass("")}>
                <Text style={[s.filterChipText, !pendingClass && s.filterChipTextActive]}>전체</Text>
              </Pressable>
              {classGroups.map(g => (
                <Pressable key={g.id} style={[s.filterChip, pendingClass === g.id && s.filterChipActive]}
                  onPress={() => setPendingClass(pendingClass === g.id ? "" : g.id)}>
                  <Text style={[s.filterChipText, pendingClass === g.id && s.filterChipTextActive]}>{g.name}</Text>
                </Pressable>
              ))}
              {classGroups.length === 0 && (
                <Text style={[s.filterChipText, { paddingVertical: 7, color: C.border }]}>학생 로드 후 표시</Text>
              )}
            </ScrollView>

            {/* 배정 상태 */}
            <Text style={s.filterSection}>배정 상태</Text>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
              {([["", "전체"], ["assigned", "배정됨"], ["unassigned", "미배정"]] as const).map(([v, l]) => (
                <Pressable key={v} style={[s.filterChip, pendingAssign === v && s.filterChipActive]}
                  onPress={() => setPendingAssign(v)}>
                  <Text style={[s.filterChipText, pendingAssign === v && s.filterChipTextActive]}>{l}</Text>
                </Pressable>
              ))}
            </View>

            {/* 커리큘럼 버전 */}
            {summaryData && summaryData.versions.length > 0 && (
              <>
                <Text style={s.filterSection}>커리큘럼 버전</Text>
                <ScrollView style={{ maxHeight: 150, marginBottom: 20 }}>
                  <Pressable style={[s.filterListItem, !pendingVersion && s.filterListItemActive]}
                    onPress={() => setPendingVersion("")}>
                    <Text style={[s.filterListItemText, !pendingVersion && { color: C.primary, fontFamily: "Pretendard-SemiBold" }]}>전체</Text>
                  </Pressable>
                  {summaryData.versions.map(v => (
                    <Pressable key={v.curriculum_version_id}
                      style={[s.filterListItem, pendingVersion === v.curriculum_version_id && s.filterListItemActive]}
                      onPress={() => setPendingVersion(pendingVersion === v.curriculum_version_id ? "" : v.curriculum_version_id)}>
                      {v.is_active && <View style={s.activeVersionDot} />}
                      <Text style={[s.filterListItemText, pendingVersion === v.curriculum_version_id && { color: C.primary, fontFamily: "Pretendard-SemiBold" }]}>
                        {v.version_name}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            )}

            <View style={s.filterActionRow}>
              <Pressable style={s.filterResetBtn} onPress={resetFilter}><Text style={s.filterResetBtnText}>초기화</Text></Pressable>
              <Pressable style={s.filterApplyBtn} onPress={applyFilter}><Text style={s.filterApplyBtnText}>적용</Text></Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// ─── 스타일 ──────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.background },

  sectionHeader: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  sectionTitle: { fontSize: 16, fontFamily: "Pretendard-Bold", color: C.textPrimary },
  sectionSub: { fontSize: 10, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 },
  subSectionTitle: { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: C.textSecondary, marginLeft: 16, marginTop: 12, marginBottom: 8 },

  kpiGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12, gap: 8, marginBottom: 4 },
  kpiCard: { flex: 1, minWidth: "44%", backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingVertical: 14, paddingHorizontal: 14 },
  kpiCardWarn: { borderColor: "#FCD34D", backgroundColor: "#FFFBEB" },
  kpiValue: { fontSize: 22, fontFamily: "Pretendard-Bold", color: C.textPrimary, marginBottom: 2 },
  kpiLabel: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },

  versionChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: "#fff", maxWidth: 200 },
  versionChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  versionChipText: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  versionChipTextActive: { color: "#fff", fontFamily: "Pretendard-SemiBold" },
  versionChipMeta: { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#9CA3AF" },
  activeVersionDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#10B981" },

  searchRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 6 },
  searchBox: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 9 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textPrimary, padding: 0 },
  filterBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: C.border },
  filterBtnActive: { backgroundColor: C.primary, borderColor: C.primary },
  filterCount: { fontSize: 11, fontFamily: "Pretendard-Bold", color: "#fff", backgroundColor: "#3B82F6", borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },

  initialBar: { marginBottom: 4 },
  initialBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: "#fff", minWidth: 36, alignItems: "center" },
  initialBtnActive: { backgroundColor: C.primary, borderColor: C.primary },
  initialBtnText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  initialBtnTextActive: { color: "#fff", fontFamily: "Pretendard-SemiBold" },
  resultCount: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginLeft: 18, marginBottom: 4 },

  studentRow: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14 },
  studentTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  studentName: { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: C.textPrimary, flex: 1, marginRight: 8 },
  assignChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1, borderColor: C.border, maxWidth: 160 },
  assignChipActive: { backgroundColor: "#EFF6FF", borderColor: "#BFDBFE" },
  assignChipText: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#2563EB" },
  studentMeta: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4 },
  studentMetaText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  growthRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  growthText: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#6B7280" },

  loadMoreBtn: { paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: C.border, alignItems: "center", marginTop: 4, marginBottom: 8 },
  loadMoreBtnText: { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: C.textSecondary },

  parentAiCard: { marginHorizontal: 16, backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14 },
  parentAiRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  parentAiValue: { fontSize: 20, fontFamily: "Pretendard-Bold", color: C.textPrimary },
  parentAiLabel: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  parentAiSub: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },

  xGlobalSection: { marginHorizontal: 16, backgroundColor: "#F5F3FF", borderRadius: 14, borderWidth: 1, borderColor: "#DDD6FE", padding: 16 },
  xGlobalHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  xGlobalTitle: { fontSize: 15, fontFamily: "Pretendard-Bold", color: "#4C1D95" },
  xGlobalSub: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#7C3AED", marginBottom: 2 },
  xGlobalNote: { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#8B5CF6", marginBottom: 12, fontStyle: "italic" },
  xGlobalRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  xGlobalActiveBadge: { paddingHorizontal: 7, paddingVertical: 2, backgroundColor: "#7C3AED", borderRadius: 6 },
  xGlobalActiveBadgeText: { fontSize: 10, fontFamily: "Pretendard-Bold", color: "#fff", letterSpacing: 0.5 },
  xGlobalSetName: { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#4C1D95" },
  xGlobalCount: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#7C3AED" },

  errBox: { alignItems: "center", paddingVertical: 20, gap: 8, paddingHorizontal: 32 },
  errText: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.error, textAlign: "center" },
  retryBtn: { paddingHorizontal: 18, paddingVertical: 8, backgroundColor: C.primary, borderRadius: 9 },
  retryBtnText: { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: "#fff" },
  emptyBox: { alignItems: "center", paddingVertical: 24, gap: 8, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: C.textSecondary },
  emptyDesc: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, textAlign: "center", marginLeft: 16, marginTop: 4 },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  filterModal: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 36 },
  filterHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: "center", marginBottom: 14 },
  filterTitle: { fontSize: 16, fontFamily: "Pretendard-Bold", color: C.textPrimary, marginBottom: 16 },
  filterSection: { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: C.textSecondary, marginBottom: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: C.border, backgroundColor: "#fff" },
  filterChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  filterChipText: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  filterChipTextActive: { color: "#fff", fontFamily: "Pretendard-SemiBold" },
  filterListItem: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  filterListItemActive: { backgroundColor: "#EFF6FF" },
  filterListItemText: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  filterActionRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  filterResetBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: C.border, alignItems: "center" },
  filterResetBtnText: { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: C.textSecondary },
  filterApplyBtn: { flex: 2, paddingVertical: 13, borderRadius: 12, backgroundColor: C.primary, alignItems: "center" },
  filterApplyBtnText: { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: "#fff" },
});
