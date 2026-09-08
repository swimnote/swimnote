/**
 * (admin)/diary-hub.tsx — 수업일지 (통합 canonical Admin 목록)
 *
 * Layout: FlatList 1개, ListHeaderComponent 안에 A~F 영역 순서 배치.
 * absolute/fixed/negative-margin/zIndex 없음 → 겹침 구조적으로 불가.
 *
 * params:
 *   aiFilter=true     X Dashboard AI 클릭 시 AI 탭 자동 선택
 *   studentId=xxx     회원관리 학생 진입 시 해당 학생 필터
 *   teacherId=xxx     class-hub 선생님별 진입 시 해당 선생님 필터
 *   backTo=xxx        뒤로가기 힌트 (x-hub 등)
 *
 * 일괄삭제: row 길게 누르면 선택모드 진입 → 체크 선택 → 삭제 버튼
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
import { router, useLocalSearchParams } from "expo-router";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { LucideIcon } from "@/components/common/LucideIcon";
import { ConfirmModal } from "@/components/common/ConfirmModal";

const C = Colors.light;

// ─── 타입 ────────────────────────────────────────────────────────────────────
type DateRange  = "today" | "yesterday" | "week" | "custom";
type AiFilter   = "all" | "ai" | "normal";
type DeleteMode = "photo_only" | "full" | null;

interface DiaryRow {
  diary_id: string;
  lesson_date: string;
  teacher_id: string;
  teacher_name: string;
  class_group_id: string;
  class_name: string | null;
  schedule_time: string | null;
  ai_generated: boolean;
  content_preview: string | null;
  student_note_count: number;
  reaction_count: number;
  comment_count: number;
  photo_count: number;
}

interface DiaryGroup {
  id: string;
  name: string;
  teacher_id: string;
  teacher_name: string;
}

interface Summary {
  total_diaries: number;
  total_notes: number;
}

// ─── 날짜 유틸 ───────────────────────────────────────────────────────────────
function todayKst(): string {
  return new Date().toLocaleString("en-CA", { timeZone: "Asia/Seoul" }).slice(0, 10);
}
function yesterdayKst(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleString("en-CA", { timeZone: "Asia/Seoul" }).slice(0, 10);
}
function formatDateKo(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getMonth() + 1}/${d.getDate()} (${days[d.getDay()]})`;
}
function formatDateFull(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${days[d.getDay()]}요일`;
}
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function getWeekRange(dateStr: string): { from: string; to: string } {
  const d = new Date(dateStr + "T12:00:00");
  const dow = d.getDay();
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diffToMon);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { from: mon.toISOString().slice(0, 10), to: sun.toISOString().slice(0, 10) };
}

// ─── 메인 컴포넌트 ───────────────────────────────────────────────────────────
export default function DiaryHubScreen() {
  const { token } = useAuth();
  const params = useLocalSearchParams<{
    aiFilter?: string;
    studentId?: string;
    teacherId?: string;
    backTo?: string;
  }>();

  // ─── 필터 상태 ─────────────────────────────────────────────────────────
  const [aiFilter, setAiFilter] = useState<AiFilter>(
    params.aiFilter === "true" ? "ai" : "all"
  );
  const studentIdParam = params.studentId ?? "";
  // teacherId param → 초기 filterTeacherId 설정
  const [filterGroupId,    setFilterGroupId]    = useState("");
  const [filterTeacherId,  setFilterTeacherId]  = useState(params.teacherId ?? "");
  const [pendingGroupId,   setPendingGroupId]   = useState("");
  const [pendingTeacherId, setPendingTeacherId] = useState(params.teacherId ?? "");

  // ─── 날짜 ─────────────────────────────────────────────────────────────
  const [dateRange,     setDateRange]     = useState<DateRange>("today");
  const [customDate,    setCustomDate]    = useState<string>(todayKst());
  const [showDateModal, setShowDateModal] = useState(false);
  const [dateInput,     setDateInput]     = useState<string>(todayKst());

  // ─── 검색 ─────────────────────────────────────────────────────────────
  const [searchText, setSearchText] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── 데이터 ───────────────────────────────────────────────────────────
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [summary,     setSummary]     = useState<Summary>({ total_diaries: 0, total_notes: 0 });
  const [diaries,     setDiaries]     = useState<DiaryRow[]>([]);
  const [groups,      setGroups]      = useState<DiaryGroup[]>([]);
  const [total,       setTotal]       = useState(0);
  const [hasMore,     setHasMore]     = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const pageRef = useRef(1);

  // ─── 선택/일괄삭제 상태 ────────────────────────────────────────────────
  const [selectMode,     setSelectMode]     = useState(false);
  const [selected,       setSelected]       = useState<Set<string>>(new Set());
  const [showModeModal,  setShowModeModal]  = useState(false);
  const [pendingMode,    setPendingMode]    = useState<DeleteMode>(null);
  const [showConfirm,    setShowConfirm]    = useState(false);
  const [deleting,       setDeleting]       = useState(false);
  const [deleteMsg,      setDeleteMsg]      = useState<string | null>(null);
  const [showFilterModal, setShowFilterModal] = useState(false);

  // 검색 debounce
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedQ(searchText.trim()), 350);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchText]);

  // ─── API 파라미터 ───────────────────────────────────────────────────────
  const getApiParams = useCallback((): URLSearchParams => {
    const today = todayKst();
    let date = today;
    let range = "day";
    switch (dateRange) {
      case "today":     date = today;         range = "day";  break;
      case "yesterday": date = yesterdayKst(); range = "day";  break;
      case "week":      date = today;         range = "week"; break;
      case "custom":    date = customDate;    range = "day";  break;
    }
    const p = new URLSearchParams({ date, range, page: "1", limit: "30" });
    if (aiFilter === "ai")     p.set("ai_only", "true");
    if (aiFilter === "normal") p.set("ai_only", "false");
    if (filterGroupId)   p.set("class_group_id", filterGroupId);
    if (filterTeacherId) p.set("teacher_id",      filterTeacherId);
    if (debouncedQ)      p.set("q",               debouncedQ);
    if (studentIdParam)  p.set("student_id",      studentIdParam);
    return p;
  }, [dateRange, customDate, aiFilter, filterGroupId, filterTeacherId, debouncedQ, studentIdParam]);

  // ─── 데이터 로드 ─────────────────────────────────────────────────────
  const fetchData = useCallback(async (reset = true) => {
    if (!token) return;
    if (reset) { setLoading(true); setError(null); pageRef.current = 1; }
    else       { setLoadingMore(true); }
    try {
      const p2 = getApiParams();
      if (!reset) p2.set("page", String(pageRef.current + 1));
      const res = await apiRequest(token, `/admin/diaries/summary?${p2.toString()}`);
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.error || "조회 실패"); }
      const data = await res.json();
      if (reset) {
        setSummary(data.summary ?? { total_diaries: 0, total_notes: 0 });
        setDiaries(data.diaries ?? []);
        setGroups(data.class_groups ?? []);
        pageRef.current = 1;
      } else {
        setDiaries(prev => [...prev, ...(data.diaries ?? [])]);
        pageRef.current = data.pagination.page ?? pageRef.current + 1;
      }
      setTotal(data.pagination?.total ?? 0);
      setHasMore(data.pagination?.has_more ?? false);
    } catch (e: any) {
      setError(e?.message || "일지 현황을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [token, getApiParams]);

  useEffect(() => { fetchData(true); }, [dateRange, customDate, aiFilter, filterGroupId, filterTeacherId, debouncedQ]);

  // 날짜 라벨
  const dateIndexLabel = (): string => {
    switch (dateRange) {
      case "today":     return "오늘";
      case "yesterday": return "어제";
      case "week": {
        const { from, to } = getWeekRange(todayKst());
        return `${formatDateKo(from)} ~ ${formatDateKo(to)}`;
      }
      case "custom": return formatDateFull(customDate);
    }
  };

  const confirmCustomDate = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) return;
    setCustomDate(dateInput);
    setDateRange("custom");
    setShowDateModal(false);
  };

  // 필터 모달
  const applyFilter = () => {
    setFilterGroupId(pendingGroupId);
    setFilterTeacherId(pendingTeacherId);
    setShowFilterModal(false);
  };
  const resetFilter = () => {
    setPendingGroupId(""); setPendingTeacherId("");
    setFilterGroupId("");  setFilterTeacherId("");
    setShowFilterModal(false);
  };
  const openFilter = () => {
    setPendingGroupId(filterGroupId);
    setPendingTeacherId(filterTeacherId);
    setShowFilterModal(true);
  };

  const activeFilterCount = [filterGroupId, filterTeacherId].filter(Boolean).length;
  const uniqueGroups   = groups.filter((g, i, arr) => arr.findIndex(x => x.id === g.id) === i);
  const uniqueTeachers = Array.from(
    new Map(groups.map(g => [g.teacher_id, { id: g.teacher_id, name: g.teacher_name }])).values()
  );

  // ─── 선택/일괄삭제 함수 ─────────────────────────────────────────────
  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    if (selected.size === diaries.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(diaries.map(d => d.diary_id)));
    }
  }
  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }
  function handleDeleteRequest() {
    if (selected.size === 0) return;
    setShowModeModal(true);
  }
  function handleModeSelect(mode: DeleteMode) {
    setPendingMode(mode);
    setShowModeModal(false);
    setShowConfirm(true);
  }
  async function executeDelete() {
    if (!pendingMode || selected.size === 0) return;
    setDeleting(true);
    setShowConfirm(false);
    try {
      const ids = Array.from(selected);
      const res = await apiRequest(token, "/diaries/admin/bulk-delete", {
        method: "POST",
        body: JSON.stringify({ ids, mode: pendingMode }),
      });
      if (res.ok) {
        const data = await res.json();
        if (pendingMode === "full") {
          setDiaries(prev => prev.filter(d => !selected.has(d.diary_id)));
          setTotal(prev => prev - selected.size);
        }
        setDeleteMsg(`${data.deleted_count ?? selected.size}건 ${pendingMode === "full" ? "삭제" : "사진 삭제"} 완료`);
        exitSelectMode();
        setTimeout(() => setDeleteMsg(null), 3000);
      } else {
        const err = await res.json().catch(() => ({}));
        setDeleteMsg(`삭제 실패: ${err.error || "서버 오류"}`);
      }
    } catch {
      setDeleteMsg("삭제 중 오류가 발생했습니다.");
    } finally {
      setDeleting(false);
      setPendingMode(null);
    }
  }

  // ─── row 상세 이동 ───────────────────────────────────────────────────
  const onRowPress = (row: DiaryRow) => {
    if (selectMode) { toggleSelect(row.diary_id); return; }
    router.push({
      pathname: "/(teacher)/diary" as any,
      params: { editDiaryId: row.diary_id, classGroupId: row.class_group_id, viewOnly: "true" },
    });
  };

  const AI_TABS: { key: AiFilter; label: string }[] = [
    { key: "all",    label: "전체" },
    { key: "ai",     label: "AI" },
    { key: "normal", label: "일반" },
  ];
  const kpiLabel = aiFilter === "ai" ? "AI 일지" : aiFilter === "normal" ? "일반 일지" : "수업 일지";
  const screenTitle = studentIdParam ? "학생 수업일지" : "수업일지";

  // ─── row 렌더 ────────────────────────────────────────────────────────
  const renderRow = ({ item }: { item: DiaryRow }) => {
    const isSelected = selectMode && selected.has(item.diary_id);
    return (
      <Pressable
        style={[s.row, isSelected && s.rowSelected]}
        onPress={() => onRowPress(item)}
        onLongPress={() => {
          if (!selectMode) {
            setSelectMode(true);
            setSelected(new Set([item.diary_id]));
          }
        }}>
        {selectMode && (
          <View style={[s.checkbox, isSelected && s.checkboxActive]}>
            {isSelected && <LucideIcon name="check" size={12} color="#fff" />}
          </View>
        )}
        <View style={{ flex: 1 }}>
          <View style={s.rowTop}>
            <Text style={s.rowTime}>
              {item.lesson_date}{item.schedule_time ? ` · ${item.schedule_time.slice(0, 5)}` : ""}
            </Text>
            <View style={s.rowTopRight}>
              {item.ai_generated && (
                <View style={s.aiChip}><Text style={s.aiChipText}>AI</Text></View>
              )}
              <Text style={s.rowClass}>{item.class_name ?? "반 미정"}</Text>
            </View>
          </View>
          {item.content_preview ? (
            <Text style={s.rowContent} numberOfLines={2}>{item.content_preview}</Text>
          ) : null}
          <View style={s.rowMid}>
            <LucideIcon name="user" size={13} color={C.textSecondary} />
            <Text style={s.rowTeacher}>{item.teacher_name}</Text>
            {item.student_note_count > 0 && (
              <>
                <Text style={s.rowSep}>·</Text>
                <Text style={s.rowNoteCount}>학생 {item.student_note_count}명</Text>
              </>
            )}
          </View>
          <View style={s.rowStats}>
            {item.photo_count > 0 && (
              <View style={s.statChip}>
                <LucideIcon name="image" size={11} color={C.textSecondary} />
                <Text style={s.statText}>{item.photo_count}</Text>
              </View>
            )}
            {item.reaction_count > 0 && (
              <View style={s.statChip}>
                <LucideIcon name="heart" size={11} color={C.textSecondary} />
                <Text style={s.statText}>{item.reaction_count}</Text>
              </View>
            )}
            {item.comment_count > 0 && (
              <View style={s.statChip}>
                <LucideIcon name="message-circle" size={11} color={C.textSecondary} />
                <Text style={s.statText}>{item.comment_count}</Text>
              </View>
            )}
            {item.photo_count === 0 && item.reaction_count === 0 && item.comment_count === 0 && (
              <Text style={s.statNone}>반응 없음</Text>
            )}
          </View>
        </View>
      </Pressable>
    );
  };

  // ─── ListEmptyComponent ─────────────────────────────────────────────
  const renderEmpty = () => {
    if (loading) {
      return (
        <View style={s.skeletonWrap}>
          {[1, 2, 3, 4, 5].map(i => (
            <View key={i} style={[s.row, s.skeletonRow]}>
              <View style={s.skeletonLine1} />
              <View style={s.skeletonLine2} />
              <View style={s.skeletonLine3} />
            </View>
          ))}
        </View>
      );
    }
    if (error) {
      return (
        <View style={s.centerBox}>
          <LucideIcon name="alert-circle" size={32} color={C.error} />
          <Text style={s.errorText}>{error}</Text>
          <Pressable style={s.retryBtn} onPress={() => fetchData(true)}>
            <Text style={s.retryBtnText}>다시 시도</Text>
          </Pressable>
        </View>
      );
    }
    const emptyTitle =
      debouncedQ || filterGroupId || filterTeacherId ? "필터 결과 없음"
      : aiFilter === "ai"     ? "AI 일지 없음"
      : aiFilter === "normal" ? "일반 일지 없음"
      : "수업일지 없음";
    const emptyDesc =
      debouncedQ || filterGroupId || filterTeacherId ? "다른 조건으로 조회해 보세요."
      : aiFilter === "ai"     ? "해당 날짜에 AI로 작성된 일지가 없습니다."
      : aiFilter === "normal" ? "해당 날짜에 일반 작성 일지가 없습니다."
      : "해당 날짜에 작성된 수업일지가 없습니다.";
    return (
      <View style={s.centerBox}>
        <LucideIcon name="book-open" size={36} color={C.border} />
        <Text style={s.emptyTitle}>{emptyTitle}</Text>
        <Text style={s.emptyDesc}>{emptyDesc}</Text>
      </View>
    );
  };

  // ─── ListHeaderComponent — A~F 영역 ─────────────────────────────────
  const renderHeader = () => (
    <View>
      {/* 선택모드 배너 */}
      {selectMode && (
        <View style={s.selectBanner}>
          <Pressable onPress={exitSelectMode} style={s.selectBannerCancel}>
            <LucideIcon name="x" size={16} color={C.textSecondary} />
            <Text style={s.selectBannerCancelText}>취소</Text>
          </Pressable>
          <Text style={s.selectBannerCount}>{selected.size}개 선택</Text>
          <View style={s.selectBannerActions}>
            <Pressable onPress={toggleSelectAll} style={s.selectBannerBtn}>
              <Text style={s.selectBannerBtnText}>
                {selected.size === diaries.length ? "전체해제" : "전체선택"}
              </Text>
            </Pressable>
            <Pressable
              onPress={handleDeleteRequest}
              style={[s.selectBannerDelBtn, selected.size === 0 && { opacity: 0.4 }]}
              disabled={selected.size === 0}>
              <Text style={s.selectBannerDelBtnText}>삭제</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* 삭제 메시지 */}
      {deleteMsg && (
        <View style={s.deleteMsgBar}>
          <Text style={s.deleteMsgText}>{deleteMsg}</Text>
        </View>
      )}

      {/* A. KPI 카드 */}
      <View style={s.kpiRow}>
        <View style={s.kpiCard}>
          <Text style={s.kpiValue}>{summary.total_diaries}</Text>
          <Text style={s.kpiLabel}>{kpiLabel}</Text>
        </View>
        <View style={[s.kpiCard, s.kpiCardRight]}>
          <Text style={s.kpiValue}>{summary.total_notes}</Text>
          <Text style={s.kpiLabel}>학생 노트</Text>
        </View>
      </View>

      {/* B. AI 필터 탭 */}
      <View style={s.aiTabRow}>
        {AI_TABS.map(tab => (
          <Pressable
            key={tab.key}
            style={[s.aiTab, aiFilter === tab.key && s.aiTabActive]}
            onPress={() => setAiFilter(tab.key)}>
            <Text style={[s.aiTabText, aiFilter === tab.key && s.aiTabTextActive]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* C. 날짜 버튼 */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.dateIndexBar}
        contentContainerStyle={s.dateIndexContent}>
        {(["today", "yesterday", "week"] as const).map(r => (
          <Pressable key={r} style={[s.dateBtn, dateRange === r && s.dateBtnActive]} onPress={() => setDateRange(r)}>
            <Text style={[s.dateBtnText, dateRange === r && s.dateBtnTextActive]}>
              {r === "today" ? "오늘" : r === "yesterday" ? "어제" : "이번 주"}
            </Text>
          </Pressable>
        ))}
        <Pressable
          style={[s.dateBtn, dateRange === "custom" && s.dateBtnActive]}
          onPress={() => { setDateInput(customDate); setShowDateModal(true); }}>
          <LucideIcon name="calendar" size={12} color={dateRange === "custom" ? "#fff" : C.textSecondary} />
          <Text style={[s.dateBtnText, dateRange === "custom" && s.dateBtnTextActive]}>
            {dateRange === "custom" ? formatDateKo(customDate) : "날짜 선택"}
          </Text>
        </Pressable>
      </ScrollView>

      {/* D. 날짜 라벨 */}
      <Text style={s.dateLabel}>{dateIndexLabel()}</Text>

      {/* E. 검색바 */}
      <View style={s.searchRow}>
        <View style={s.searchBox}>
          <LucideIcon name="search" size={14} color={C.textSecondary} />
          <TextInput
            style={s.searchInput}
            value={searchText}
            onChangeText={setSearchText}
            placeholder="내용 또는 선생님 검색"
            placeholderTextColor={C.textSecondary}
            returnKeyType="search"
          />
          {searchText.length > 0 && (
            <Pressable onPress={() => setSearchText("")} hitSlop={8}>
              <LucideIcon name="x" size={14} color={C.textSecondary} />
            </Pressable>
          )}
        </View>
        <Pressable style={[s.filterBtn, activeFilterCount > 0 && s.filterBtnActive]} onPress={openFilter}>
          <LucideIcon name="sliders" size={14} color={activeFilterCount > 0 ? "#fff" : C.textSecondary} />
          {activeFilterCount > 0 && <Text style={s.filterCount}>{activeFilterCount}</Text>}
        </Pressable>
      </View>

      {/* F. 결과 수 */}
      {!loading && !error && (
        <Text style={s.resultCount}>{total.toLocaleString()}건 · 길게 눌러 선택</Text>
      )}
    </View>
  );

  // ─── 렌더 ────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title={screenTitle} homePath="/(admin)/dashboard" />

      <FlatList
        data={loading || error ? [] : diaries}
        keyExtractor={item => item.diary_id}
        renderItem={renderRow}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={s.listContent}
        ItemSeparatorComponent={() => <View style={s.separator} />}
        onEndReached={() => { if (hasMore && !loadingMore) fetchData(false); }}
        onEndReachedThreshold={0.3}
        ListFooterComponent={
          loadingMore
            ? <ActivityIndicator color={C.primary} style={{ marginVertical: 16 }} />
            : null
        }
        keyboardShouldPersistTaps="handled"
      />

      {/* 날짜 선택 모달 */}
      <Modal visible={showDateModal} transparent animationType="fade" onRequestClose={() => setShowDateModal(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setShowDateModal(false)}>
          <Pressable style={s.dateModalBox} onPress={e => e.stopPropagation()}>
            <Text style={s.modalTitle}>날짜 선택</Text>
            <View style={s.dateNavRow}>
              <Pressable onPress={() => setDateInput(addDays(dateInput, -1))} hitSlop={8}>
                <LucideIcon name="chevron-left" size={22} color={C.textPrimary} />
              </Pressable>
              <TextInput
                style={s.dateInputField}
                value={dateInput}
                onChangeText={setDateInput}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={C.textSecondary}
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />
              <Pressable onPress={() => setDateInput(addDays(dateInput, 1))} hitSlop={8}
                disabled={dateInput >= todayKst()}>
                <LucideIcon name="chevron-right" size={22} color={dateInput >= todayKst() ? C.border : C.textPrimary} />
              </Pressable>
            </View>
            <View style={s.modalBtnRow}>
              <Pressable style={s.modalCancelBtn} onPress={() => setShowDateModal(false)}>
                <Text style={s.modalCancelBtnText}>취소</Text>
              </Pressable>
              <Pressable
                style={[s.modalConfirmBtn, { opacity: /^\d{4}-\d{2}-\d{2}$/.test(dateInput) ? 1 : 0.4 }]}
                onPress={confirmCustomDate}
                disabled={!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)}>
                <Text style={s.modalConfirmBtnText}>확인</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 반/선생님 필터 모달 */}
      <Modal visible={showFilterModal} transparent animationType="slide" onRequestClose={() => setShowFilterModal(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setShowFilterModal(false)}>
          <Pressable style={s.filterModal} onPress={e => e.stopPropagation()}>
            <View style={s.filterModalHandle} />
            <Text style={s.filterModalTitle}>필터</Text>

            <Text style={s.filterSection}>반</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 4 }}>
                <Pressable style={[s.filterChip, !pendingGroupId && s.filterChipActive]}
                  onPress={() => setPendingGroupId("")}>
                  <Text style={[s.filterChipText, !pendingGroupId && s.filterChipTextActive]}>전체</Text>
                </Pressable>
                {uniqueGroups.map(g => (
                  <Pressable key={g.id} style={[s.filterChip, pendingGroupId === g.id && s.filterChipActive]}
                    onPress={() => setPendingGroupId(pendingGroupId === g.id ? "" : g.id)}>
                    <Text style={[s.filterChipText, pendingGroupId === g.id && s.filterChipTextActive]}>{g.name}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            <Text style={s.filterSection}>선생님</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
              <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 4 }}>
                <Pressable style={[s.filterChip, !pendingTeacherId && s.filterChipActive]}
                  onPress={() => setPendingTeacherId("")}>
                  <Text style={[s.filterChipText, !pendingTeacherId && s.filterChipTextActive]}>전체</Text>
                </Pressable>
                {uniqueTeachers.map(t => (
                  <Pressable key={t.id} style={[s.filterChip, pendingTeacherId === t.id && s.filterChipActive]}
                    onPress={() => setPendingTeacherId(pendingTeacherId === t.id ? "" : t.id)}>
                    <Text style={[s.filterChipText, pendingTeacherId === t.id && s.filterChipTextActive]}>{t.name}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            <View style={s.filterActionRow}>
              <Pressable style={s.filterResetBtn} onPress={resetFilter}>
                <Text style={s.filterResetBtnText}>초기화</Text>
              </Pressable>
              <Pressable style={s.filterApplyBtn} onPress={applyFilter}>
                <Text style={s.filterApplyBtnText}>적용</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 삭제 모드 선택 모달 */}
      <Modal visible={showModeModal} transparent animationType="fade" onRequestClose={() => setShowModeModal(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setShowModeModal(false)}>
          <Pressable style={s.modeModalBox} onPress={e => e.stopPropagation()}>
            <Text style={s.modalTitle}>삭제 방법 선택</Text>
            <Text style={s.modeModalDesc}>
              {selected.size}개 일지의 삭제 방법을 선택하세요.
            </Text>
            <Pressable style={s.modeBtn} onPress={() => handleModeSelect("photo_only")}>
              <LucideIcon name="image" size={18} color={C.textPrimary} />
              <View style={{ flex: 1 }}>
                <Text style={s.modeBtnTitle}>사진만 삭제</Text>
                <Text style={s.modeBtnDesc}>일지 내용 유지, 첨부 사진만 제거</Text>
              </View>
            </Pressable>
            <Pressable style={[s.modeBtn, s.modeBtnDanger]} onPress={() => handleModeSelect("full")}>
              <LucideIcon name="trash-2" size={18} color={C.error} />
              <View style={{ flex: 1 }}>
                <Text style={[s.modeBtnTitle, { color: C.error }]}>일지 전체 삭제</Text>
                <Text style={s.modeBtnDesc}>일지·사진·학생 노트 모두 삭제 (복구 불가)</Text>
              </View>
            </Pressable>
            <Pressable style={s.modalCancelBtn} onPress={() => setShowModeModal(false)}>
              <Text style={s.modalCancelBtnText}>취소</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 삭제 확인 모달 */}
      <ConfirmModal
        visible={showConfirm}
        title={pendingMode === "full" ? "일지를 삭제할까요?" : "사진을 삭제할까요?"}
        message={
          pendingMode === "full"
            ? `${selected.size}개 일지와 관련 데이터가 모두 삭제됩니다. 복구가 불가능합니다.`
            : `${selected.size}개 일지의 사진이 삭제됩니다.`
        }
        confirmText={deleting ? "삭제 중..." : "삭제"}
        onConfirm={executeDelete}
        onCancel={() => setShowConfirm(false)}
      />
    </SafeAreaView>
  );
}

// ─── 스타일 ──────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.background },
  listContent: { paddingHorizontal: 16, paddingBottom: 40 },

  // 선택모드 배너
  selectBanner: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "#EFF6FF", borderRadius: 10, marginBottom: 10,
    paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: C.primary,
  },
  selectBannerCancel: { flexDirection: "row", alignItems: "center", gap: 4 },
  selectBannerCancelText: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  selectBannerCount: { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: C.primary },
  selectBannerActions: { flexDirection: "row", gap: 8, alignItems: "center" },
  selectBannerBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: C.border, backgroundColor: "#fff" },
  selectBannerBtnText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  selectBannerDelBtn: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6, backgroundColor: C.error },
  selectBannerDelBtnText: { fontSize: 12, fontFamily: "Pretendard-SemiBold", color: "#fff" },

  // 삭제 메시지
  deleteMsgBar: { backgroundColor: "#D1FAE5", borderRadius: 8, padding: 10, marginBottom: 8 },
  deleteMsgText: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#065F46", textAlign: "center" },

  // A. KPI
  kpiRow: { flexDirection: "row", marginTop: 12, marginBottom: 12, gap: 10 },
  kpiCard: {
    flex: 1, backgroundColor: "#fff", borderRadius: 12,
    borderWidth: 1, borderColor: C.border,
    paddingVertical: 14, paddingHorizontal: 16,
  },
  kpiCardRight: {},
  kpiValue: { fontSize: 24, fontFamily: "Pretendard-Bold", color: C.textPrimary, marginBottom: 2 },
  kpiLabel: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },

  // B. AI 필터 탭
  aiTabRow: { flexDirection: "row", marginBottom: 12, gap: 6 },
  aiTab: {
    paddingHorizontal: 16, paddingVertical: 9,
    borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: "#fff",
  },
  aiTabActive: { backgroundColor: C.primary, borderColor: C.primary },
  aiTabText:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  aiTabTextActive: { color: "#fff", fontFamily: "Pretendard-SemiBold" },

  // C. 날짜 버튼
  dateIndexBar:     { marginHorizontal: -16, marginBottom: 12 },
  dateIndexContent: { paddingHorizontal: 16, paddingVertical: 4, gap: 8 },
  dateBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4,
    height: 34, paddingHorizontal: 12,
    borderRadius: 20, borderWidth: 1, borderColor: C.border, backgroundColor: "#fff",
  },
  dateBtnActive:     { backgroundColor: C.primary, borderColor: C.primary },
  dateBtnText:       { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  dateBtnTextActive: { color: "#fff", fontFamily: "Pretendard-SemiBold" },

  // D. 날짜 라벨
  dateLabel: {
    fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary,
    marginBottom: 8,
  },

  // E. 검색바
  searchRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  searchBox: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 12, paddingVertical: 9,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textPrimary, padding: 0 },
  filterBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 12, paddingVertical: 9,
    backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: C.border,
  },
  filterBtnActive: { backgroundColor: C.primary, borderColor: C.primary },
  filterCount: {
    fontSize: 11, fontFamily: "Pretendard-Bold", color: "#fff",
    backgroundColor: "#3B82F6", borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1,
  },

  // F. 결과 수
  resultCount: {
    fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary,
    marginBottom: 8,
  },

  // 스켈레톤
  skeletonWrap:  { gap: 8, marginTop: 4 },
  skeletonRow:   { opacity: 0.4 },
  skeletonLine1: { height: 13, width: 160, backgroundColor: C.border, borderRadius: 6, marginBottom: 6 },
  skeletonLine2: { height: 11, width: 220, backgroundColor: C.border, borderRadius: 6, marginBottom: 6 },
  skeletonLine3: { height: 11, width: 120, backgroundColor: C.border, borderRadius: 6 },

  // Row
  row:         { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14 },
  rowSelected: { borderColor: C.primary, borderWidth: 2, backgroundColor: "#EFF6FF" },
  separator:   { height: 8 },
  checkbox: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: C.border,
    backgroundColor: "#fff", alignItems: "center", justifyContent: "center", marginTop: 2,
  },
  checkboxActive: { backgroundColor: C.primary, borderColor: C.primary },
  rowTop:      { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  rowTopRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowTime:     { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  rowClass:    { fontSize: 12, fontFamily: "Pretendard-SemiBold", color: C.textPrimary },
  aiChip:      { backgroundColor: "#EFF6FF", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  aiChipText:  { fontSize: 10, fontFamily: "Pretendard-Bold", color: C.primary },
  rowContent:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textPrimary, lineHeight: 19, marginBottom: 8 },
  rowMid:      { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 6 },
  rowTeacher:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  rowNoteCount: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  rowSep:      { fontSize: 12, color: C.border },
  rowStats:    { flexDirection: "row", gap: 8, alignItems: "center" },
  statChip:    { flexDirection: "row", alignItems: "center", gap: 3 },
  statText:    { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  statNone:    { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.border },

  // Empty/Error
  centerBox:  { alignItems: "center", paddingVertical: 40, gap: 8 },
  emptyTitle: { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: C.textPrimary },
  emptyDesc:  { fontSize: 13, fontFamily: "Pretendard-Regular",  color: C.textSecondary, textAlign: "center" },
  errorText:  { fontSize: 14, fontFamily: "Pretendard-Regular",  color: C.error },
  retryBtn:   { marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: C.primary, borderRadius: 8 },
  retryBtnText: { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#fff" },

  // 날짜 선택 모달
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center" },
  dateModalBox: { width: 300, backgroundColor: "#fff", borderRadius: 16, padding: 20 },
  modalTitle:   { fontSize: 16, fontFamily: "Pretendard-SemiBold", color: C.textPrimary, marginBottom: 16, textAlign: "center" },
  dateNavRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  dateInputField: {
    flex: 1, textAlign: "center", fontSize: 16, fontFamily: "Pretendard-Regular",
    color: C.textPrimary, borderBottomWidth: 1, borderColor: C.border, paddingVertical: 4, marginHorizontal: 8,
  },
  modalBtnRow:      { flexDirection: "row", gap: 8 },
  modalCancelBtn:   { flex: 1, paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: C.border, alignItems: "center" },
  modalCancelBtnText: { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: C.textSecondary },
  modalConfirmBtn:  { flex: 1, paddingVertical: 11, borderRadius: 10, backgroundColor: C.primary, alignItems: "center" },
  modalConfirmBtnText: { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#fff" },

  // 반/선생님 필터 모달
  filterModal: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 36,
  },
  filterModalHandle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: C.border,
    alignSelf: "center", marginBottom: 16,
  },
  filterModalTitle: { fontSize: 16, fontFamily: "Pretendard-SemiBold", color: C.textPrimary, marginBottom: 16 },
  filterSection:    { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: C.textPrimary, marginBottom: 8 },
  filterChip: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1, borderColor: C.border, backgroundColor: "#fff",
  },
  filterChipActive:     { backgroundColor: C.primary, borderColor: C.primary },
  filterChipText:       { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  filterChipTextActive: { color: "#fff", fontFamily: "Pretendard-SemiBold" },
  filterActionRow:  { flexDirection: "row", gap: 10, marginTop: 4 },
  filterResetBtn:   { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: C.border, alignItems: "center" },
  filterResetBtnText: { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: C.textSecondary },
  filterApplyBtn:   { flex: 2, paddingVertical: 12, borderRadius: 10, backgroundColor: C.primary, alignItems: "center" },
  filterApplyBtnText: { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#fff" },

  // 삭제 모드 선택 모달
  modeModalBox: { width: 320, backgroundColor: "#fff", borderRadius: 16, padding: 20 },
  modeModalDesc: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, textAlign: "center", marginBottom: 16 },
  modeBtn: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14, borderRadius: 10, borderWidth: 1, borderColor: C.border,
    backgroundColor: "#fff", marginBottom: 8,
  },
  modeBtnDanger: { borderColor: "#FCA5A5", backgroundColor: "#FFF5F5" },
  modeBtnTitle:  { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: C.textPrimary },
  modeBtnDesc:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 },
});
