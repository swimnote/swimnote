/**
 * (admin)/diary-hub.tsx — AI 일지피드
 *
 * PRE-CHECK 결과 (2026-08-27):
 *   C1: class_diaries row는 작성 시에만 생성 (B형) — 미작성 KPI 불가
 *   C2: ai_status 컬럼 없음 — AI KPI/필터 제외
 *   C3: GET /diaries/:id pool_admin 이미 허용; diary.tsx viewOnly=true 재사용
 *   C4: diary_reactions(reaction_type IN like/thanks) + diary_messages(diary_comment)
 *   C5: photo_assets_meta(journal_id, media_status=attached)
 *
 * KPI: 오늘 일지 (class_diaries count) + 학생 노트 (class_diary_student_notes count)
 * FILTER: 반 + 선생님 (AI/작성상태 제거)
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
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { LucideIcon } from "@/components/common/LucideIcon";

const C = Colors.light;

// ─── 타입 ────────────────────────────────────────────────────────────────────
type DateRange = "today" | "yesterday" | "week" | "custom";

interface DiaryRow {
  note_id: string;
  diary_id: string;
  lesson_date: string;
  teacher_id: string;
  teacher_name: string;
  class_group_id: string;
  class_name: string;
  schedule_time: string;
  student_id: string;
  student_name: string;
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
  return {
    from: mon.toISOString().slice(0, 10),
    to:   sun.toISOString().slice(0, 10),
  };
}

// ─── 메인 컴포넌트 ───────────────────────────────────────────────────────────
export default function DiaryHubScreen() {
  const { token } = useAuth();

  // 날짜 index
  const [dateRange,   setDateRange]   = useState<DateRange>("today");
  const [customDate,  setCustomDate]  = useState<string>(todayKst());
  const [showDateModal, setShowDateModal] = useState(false);
  const [dateInput,   setDateInput]   = useState<string>(todayKst());

  // 검색
  const [searchText,    setSearchText]    = useState("");
  const [debouncedQ,    setDebouncedQ]    = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 필터 모달
  const [showFilter,     setShowFilter]     = useState(false);
  const [filterGroupId,  setFilterGroupId]  = useState("");
  const [filterTeacherId,setFilterTeacherId]= useState("");
  const [pendingGroupId, setPendingGroupId] = useState("");
  const [pendingTeacherId,setPendingTeacherId]=useState("");

  // 데이터
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [summary,     setSummary]     = useState<Summary>({ total_diaries: 0, total_notes: 0 });
  const [diaries,     setDiaries]     = useState<DiaryRow[]>([]);
  const [groups,      setGroups]      = useState<DiaryGroup[]>([]);
  const [total,       setTotal]       = useState(0);
  const [hasMore,     setHasMore]     = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const pageRef = useRef(1);

  // ─── 검색 debounce ─────────────────────────────────────────────────────
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedQ(searchText.trim()), 350);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchText]);

  // ─── API 파라미터 계산 ───────────────────────────────────────────────────
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
    if (filterGroupId)   p.set("class_group_id", filterGroupId);
    if (filterTeacherId) p.set("teacher_id",      filterTeacherId);
    if (debouncedQ)      p.set("q",               debouncedQ);
    return p;
  }, [dateRange, customDate, filterGroupId, filterTeacherId, debouncedQ]);

  // ─── 데이터 로드 ────────────────────────────────────────────────────────
  const fetchData = useCallback(async (reset = true) => {
    if (!token) return;
    if (reset) { setLoading(true); setError(null); pageRef.current = 1; }
    else { setLoadingMore(true); }
    try {
      const params = getApiParams();
      if (!reset) { params.set("page", String(pageRef.current + 1)); }
      const res = await apiRequest(token, `/admin/diaries/summary?${params.toString()}`);
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

  // 의존성 변경 시 새로 로드
  useEffect(() => {
    fetchData(true);
  }, [dateRange, customDate, filterGroupId, filterTeacherId, debouncedQ]);

  // ─── 날짜 인덱스 표시 라벨 ───────────────────────────────────────────────
  const dateIndexLabel = (): string => {
    switch (dateRange) {
      case "today":     return "오늘";
      case "yesterday": return "어제";
      case "week": {
        const { from, to } = getWeekRange(todayKst());
        return `${formatDateKo(from)} ~ ${formatDateKo(to)}`;
      }
      case "custom":    return formatDateFull(customDate);
    }
  };

  // ─── 커스텀 날짜 확인 ───────────────────────────────────────────────────
  const confirmCustomDate = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) return;
    setCustomDate(dateInput);
    setDateRange("custom");
    setShowDateModal(false);
  };

  // ─── 필터 적용 ──────────────────────────────────────────────────────────
  const applyFilter = () => {
    setFilterGroupId(pendingGroupId);
    setFilterTeacherId(pendingTeacherId);
    setShowFilter(false);
  };
  const resetFilter = () => {
    setPendingGroupId(""); setPendingTeacherId("");
    setFilterGroupId("");  setFilterTeacherId("");
    setShowFilter(false);
  };
  const openFilter = () => {
    setPendingGroupId(filterGroupId);
    setPendingTeacherId(filterTeacherId);
    setShowFilter(true);
  };

  // 활성 필터 수
  const activeFilterCount = [filterGroupId, filterTeacherId].filter(Boolean).length;

  // ─── 반 중복 제거 필터 옵션 ─────────────────────────────────────────────
  const uniqueGroups = groups.filter((g, i, arr) => arr.findIndex(x => x.id === g.id) === i);
  const uniqueTeachers = Array.from(
    new Map(groups.map(g => [g.teacher_id, { id: g.teacher_id, name: g.teacher_name }])).values()
  );

  // ─── row 탭 → diary detail (viewOnly) ───────────────────────────────────
  const onRowPress = (row: DiaryRow) => {
    router.push({
      pathname: "/(teacher)/diary" as any,
      params: {
        editDiaryId: row.diary_id,
        classGroupId: row.class_group_id,
        viewOnly: "true",
      },
    });
  };

  // ─── row 렌더 ───────────────────────────────────────────────────────────
  const renderRow = ({ item }: { item: DiaryRow }) => (
    <Pressable style={s.row} onPress={() => onRowPress(item)}>
      <View style={s.rowTop}>
        <Text style={s.rowTime}>
          {item.lesson_date} {item.schedule_time ? `· ${item.schedule_time.slice(0, 5)}` : ""}
        </Text>
        <Text style={s.rowClass}>{item.class_name ?? "반 미정"}</Text>
      </View>
      <View style={s.rowMid}>
        <LucideIcon name="user" size={13} color={C.textSecondary} />
        <Text style={s.rowStudent}>{item.student_name}</Text>
        <Text style={s.rowSep}>·</Text>
        <Text style={s.rowTeacher}>{item.teacher_name}</Text>
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
    </Pressable>
  );

  // ─── 로딩 스켈레톤 ──────────────────────────────────────────────────────
  const renderSkeleton = () => (
    <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 10 }}>
      {[1,2,3,4,5].map(i => (
        <View key={i} style={[s.row, { opacity: 0.4 }]}>
          <View style={{ height: 13, width: 160, backgroundColor: C.border, borderRadius: 6, marginBottom: 6 }} />
          <View style={{ height: 11, width: 120, backgroundColor: C.border, borderRadius: 6, marginBottom: 6 }} />
          <View style={{ height: 11, width: 80, backgroundColor: C.border, borderRadius: 6 }} />
        </View>
      ))}
    </View>
  );

  // ─── 렌더 ───────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="AI 일지피드" homePath="/(admin)/dashboard" />

      {/* KPI */}
      <View style={s.kpiRow}>
        <View style={s.kpiCard}>
          <Text style={s.kpiValue}>{summary.total_diaries}</Text>
          <Text style={s.kpiLabel}>오늘 일지</Text>
        </View>
        <View style={[s.kpiCard, s.kpiCardRight]}>
          <Text style={s.kpiValue}>{summary.total_notes}</Text>
          <Text style={s.kpiLabel}>학생 노트</Text>
        </View>
      </View>

      {/* DATE INDEX */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.dateIndexBar} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
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

      {/* 날짜 범위 표시 */}
      <Text style={s.dateLabel}>{dateIndexLabel()}</Text>

      {/* 검색 + 필터 */}
      <View style={s.searchRow}>
        <View style={s.searchBox}>
          <LucideIcon name="search" size={14} color={C.textSecondary} />
          <TextInput
            style={s.searchInput}
            value={searchText}
            onChangeText={setSearchText}
            placeholder="학생명 검색"
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
          <LucideIcon name="sliders-horizontal" size={14} color={activeFilterCount > 0 ? "#fff" : C.textSecondary} />
          {activeFilterCount > 0 && <Text style={s.filterCount}>{activeFilterCount}</Text>}
        </Pressable>
      </View>

      {/* 결과 수 */}
      {!loading && !error && (
        <Text style={s.resultCount}>{total.toLocaleString()}건</Text>
      )}

      {/* 메인 컨텐츠 */}
      {loading ? renderSkeleton() : error ? (
        <View style={s.centerBox}>
          <LucideIcon name="alert-circle" size={32} color={C.error} />
          <Text style={s.errorText}>{error}</Text>
          <Pressable style={s.retryBtn} onPress={() => fetchData(true)}>
            <Text style={s.retryBtnText}>다시 시도</Text>
          </Pressable>
        </View>
      ) : diaries.length === 0 ? (
        <View style={s.centerBox}>
          <LucideIcon name="book-open" size={36} color={C.border} />
          <Text style={s.emptyTitle}>
            {debouncedQ || filterGroupId || filterTeacherId ? "필터 결과 없음" : "일지 없음"}
          </Text>
          <Text style={s.emptyDesc}>
            {debouncedQ || filterGroupId || filterTeacherId
              ? "다른 조건으로 조회해 보세요."
              : "해당 날짜에 작성된 일지가 없습니다."}
          </Text>
        </View>
      ) : (
        <FlatList
          data={diaries}
          keyExtractor={item => item.note_id}
          renderItem={renderRow}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, paddingTop: 4 }}
          ItemSeparatorComponent={() => <View style={s.separator} />}
          onEndReached={() => { if (hasMore && !loadingMore) fetchData(false); }}
          onEndReachedThreshold={0.3}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={C.primary} style={{ marginVertical: 16 }} /> : null}
        />
      )}

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
              <Pressable style={[s.modalConfirmBtn, { opacity: /^\d{4}-\d{2}-\d{2}$/.test(dateInput) ? 1 : 0.4 }]}
                onPress={confirmCustomDate} disabled={!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)}>
                <Text style={s.modalConfirmBtnText}>확인</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 필터 모달 */}
      <Modal visible={showFilter} transparent animationType="slide" onRequestClose={() => setShowFilter(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setShowFilter(false)}>
          <Pressable style={s.filterModal} onPress={e => e.stopPropagation()}>
            <View style={s.filterModalHandle} />
            <Text style={s.filterModalTitle}>필터</Text>

            {/* 반 */}
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

            {/* 선생님 */}
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
    </SafeAreaView>
  );
}

// ─── 스타일 ──────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.background },

  // KPI
  kpiRow: { flexDirection: "row", marginHorizontal: 16, marginTop: 12, marginBottom: 8, gap: 10 },
  kpiCard: {
    flex: 1, backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: C.border,
    paddingVertical: 14, paddingHorizontal: 16,
  },
  kpiCardRight: {},
  kpiValue: { fontSize: 24, fontFamily: "Pretendard-Bold", color: C.textPrimary, marginBottom: 2 },
  kpiLabel: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },

  // Date index
  dateIndexBar: { marginBottom: 0 },
  dateBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1, borderColor: C.border, backgroundColor: "#fff",
  },
  dateBtnActive: { backgroundColor: C.primary, borderColor: C.primary },
  dateBtnText: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  dateBtnTextActive: { color: "#fff", fontFamily: "Pretendard-SemiBold" },
  dateLabel: {
    fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary,
    marginLeft: 18, marginTop: 6, marginBottom: 4,
  },

  // Search row
  searchRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 6, marginTop: 6 },
  searchBox: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 12, paddingVertical: 9,
  },
  searchInput: {
    flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textPrimary, padding: 0,
  },
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
  resultCount: {
    fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary,
    marginLeft: 18, marginBottom: 4,
  },

  // Row
  row: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14 },
  separator: { height: 8 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  rowTime: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  rowClass: { fontSize: 12, fontFamily: "Pretendard-SemiBold", color: C.primary },
  rowMid: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 6 },
  rowStudent: { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: C.textPrimary },
  rowSep: { fontSize: 13, color: C.border },
  rowTeacher: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  rowStats: { flexDirection: "row", gap: 10 },
  statChip: { flexDirection: "row", alignItems: "center", gap: 3 },
  statText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  statNone: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.border },

  // Center (loading/empty/error)
  centerBox: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 32 },
  errorText: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.error, textAlign: "center" },
  retryBtn: {
    marginTop: 4, paddingHorizontal: 20, paddingVertical: 10,
    backgroundColor: C.primary, borderRadius: 10,
  },
  retryBtnText: { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#fff" },
  emptyTitle: { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: C.textSecondary },
  emptyDesc: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, textAlign: "center" },

  // 날짜 선택 모달
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center" },
  dateModalBox: {
    backgroundColor: "#fff", borderRadius: 16, padding: 20, width: 300,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 10, elevation: 8,
  },
  modalTitle: { fontSize: 16, fontFamily: "Pretendard-Bold", color: C.textPrimary, marginBottom: 16, textAlign: "center" },
  dateNavRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  dateInputField: {
    flex: 1, textAlign: "center", fontSize: 16, fontFamily: "Pretendard-SemiBold", color: C.textPrimary,
    borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 8, marginHorizontal: 8,
  },
  modalBtnRow: { flexDirection: "row", gap: 10 },
  modalCancelBtn: {
    flex: 1, paddingVertical: 11, borderRadius: 10,
    borderWidth: 1, borderColor: C.border, alignItems: "center",
  },
  modalCancelBtnText: { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: C.textSecondary },
  modalConfirmBtn: {
    flex: 1, paddingVertical: 11, borderRadius: 10,
    backgroundColor: C.primary, alignItems: "center",
  },
  modalConfirmBtnText: { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#fff" },

  // 필터 모달
  filterModal: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 32,
  },
  filterModalHandle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: "center", marginBottom: 14,
  },
  filterModalTitle: {
    fontSize: 16, fontFamily: "Pretendard-Bold", color: C.textPrimary, marginBottom: 16,
  },
  filterSection: {
    fontSize: 13, fontFamily: "Pretendard-SemiBold", color: C.textSecondary, marginBottom: 8,
  },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1, borderColor: C.border, backgroundColor: "#fff",
  },
  filterChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  filterChipText: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  filterChipTextActive: { color: "#fff", fontFamily: "Pretendard-SemiBold" },
  filterActionRow: { flexDirection: "row", gap: 10 },
  filterResetBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 12,
    borderWidth: 1, borderColor: C.border, alignItems: "center",
  },
  filterResetBtnText: { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: C.textSecondary },
  filterApplyBtn: {
    flex: 2, paddingVertical: 13, borderRadius: 12,
    backgroundColor: C.primary, alignItems: "center",
  },
  filterApplyBtnText: { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: "#fff" },
});
