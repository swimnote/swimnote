/**
 * (teacher)/diary-index.tsx — 수업 일지 Hub
 *
 * - 날짜별 수업 단위로 Group Card 표시 (lesson_date + class_group_id 기준)
 * - 같은 수업의 공통 일지 + 학생별 추가 일지를 하나의 Group Card에 묶음 (§7)
 * - 공유 버튼과 chevron hit area 분리 (§9)
 * - writeCard SafeArea 아래 정상 spacing (§6)
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { shareDiaryEntry } from "@/utils/diaryShare";
import { ActivityIndicator, FlatList, Pressable,
  StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { UnwrittenScheduleSheet } from "@/components/teacher/diary/UnwrittenScheduleSheet";

const C = Colors.light;
const KO_DAYS = ["월", "화", "수", "목", "금", "토"];
/* ── 타입 ────────────────────────────────────────────────────────── */
interface DiaryIndexEntry {
  diary_id: string;
  lesson_date: string;
  class_name: string;
  schedule_days: string;
  schedule_time: string;
  content: string;
  teacher_name: string;
  created_at: string;
  entry_type: "class_common" | "student_note";
  student_id: string | null;
  student_name: string | null;
  note_content: string | null;
  source_diary_id: string;
  source_note_id: string | null;
}

/** 날짜별 수업 단위 Group — 같은 source_diary_id 항목들을 묶음 */
interface DiaryGroup {
  /** 그룹 대표 key */
  key: string;
  lesson_date: string;
  class_name: string;
  schedule_days: string;
  schedule_time: string;
  teacher_name: string;
  source_diary_id: string;
  /** 반 공통 일지 (있으면 1개) */
  common: DiaryIndexEntry | null;
  /** 학생별 추가 일지 */
  notes: DiaryIndexEntry[];
}

/* ── 날짜 포맷 ───────────────────────────────────────────────────── */
function formatDate(iso: string) {
  const d = new Date(iso + "T12:00:00");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${days[d.getDay()]}요일`;
}

/** entries → DiaryGroup[] 변환 (source_diary_id 기준 grouping) */
function groupEntries(entries: DiaryIndexEntry[]): DiaryGroup[] {
  const map = new Map<string, DiaryGroup>();
  for (const e of entries) {
    const key = e.source_diary_id;
    if (!map.has(key)) {
      map.set(key, {
        key,
        lesson_date: e.lesson_date,
        class_name: e.class_name,
        schedule_days: e.schedule_days,
        schedule_time: e.schedule_time,
        teacher_name: e.teacher_name,
        source_diary_id: e.source_diary_id,
        common: null,
        notes: [],
      });
    }
    const g = map.get(key)!;
    if (e.entry_type === "class_common") {
      g.common = e;
    } else {
      g.notes.push(e);
    }
  }
  return Array.from(map.values());
}

/* ════════════════════════════════════════════════════════════════
   메인 컴포넌트
   ════════════════════════════════════════════════════════════════ */
export default function DiaryIndexScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();
  const { studentId: paramStudentId, studentName: paramStudentName } = useLocalSearchParams<{ studentId?: string; studentName?: string }>();
  const studentScopeId   = paramStudentId   || null;
  const studentScopeName = paramStudentName || null;

  const [entries, setEntries]       = useState<DiaryIndexEntry[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [availableTimes, setAvailableTimes] = useState<string[]>([]);
  /* ── 필터 상태 ── */
  const [searchText,  setSearchText]  = useState("");
  const [activeDay,   setActiveDay]   = useState<string | null>(null);
  const [activeTime,  setActiveTime]  = useState<string | null>(null);
  const [showDayPicker,  setShowDayPicker]  = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showQuickWrite, setShowQuickWrite] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── 데이터 로드 ── */
  const load = useCallback(async (sName = "", day: string | null = null, time: string | null = null) => {
    if (!token) return;
    const params = new URLSearchParams();
    if (studentScopeId) {
      params.set("student_id", studentScopeId);
    } else if (sName.trim()) {
      params.set("student_name", sName.trim());
    }
    if (day) params.set("day", day);
    if (time) params.set("time", time);
    try {
      const res = await apiRequest(token, `/diaries/index?${params.toString()}`);
      if (res.ok) {
        const d = await res.json();
        const list: DiaryIndexEntry[] = Array.isArray(d.entries) ? d.entries : [];
        setEntries(list);
        if (!day && !sName && !time && !studentScopeId) {
          const times = Array.from(new Set(list.map(e => (e.schedule_time || "").slice(0, 5)).filter(Boolean))).sort();
          setAvailableTimes(times);
        }
      }
    } catch (e) {
      console.error("[diary-index] load error", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, studentScopeId]);

  useEffect(() => { load(); }, [load]);

  /* ── 검색어 변경 시 디바운스 ── */
  const handleSearchChange = useCallback((text: string) => {
    setSearchText(text);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      load(text, activeDay, activeTime);
    }, 300);
  }, [load, activeDay, activeTime]);

  /* ── 요일 필터 변경 ── */
  const handleDaySelect = useCallback((day: string | null) => {
    setActiveDay(day);
    setShowDayPicker(false);
    load(searchText, day, activeTime);
  }, [searchText, activeTime, load]);

  /* ── 시간 필터 변경 ── */
  const handleTimeSelect = useCallback((time: string | null) => {
    setActiveTime(time);
    setShowTimePicker(false);
    load(searchText, activeDay, time);
  }, [searchText, activeDay, load]);

  /* ── 그룹 tap → diary.tsx 수정 뷰 ── */
  const handleGroupPress = useCallback((group: DiaryGroup) => {
    router.push({
      pathname: "/(teacher)/diary",
      params: { editDiaryId: group.source_diary_id, backTo: "diary-index" },
    } as any);
  }, []);

  /* ── 공유 (반 공통 기준) ── */
  const handleShare = useCallback((group: DiaryGroup) => {
    const item = group.common ?? group.notes[0];
    if (!item) return;
    shareDiaryEntry({
      studentName:  undefined,
      className:    group.class_name,
      teacherName:  group.teacher_name,
      lessonDate:   group.lesson_date,
      content:      group.common?.content ?? group.notes[0]?.note_content ?? "",
      noteContent:  undefined,
    });
  }, []);

  /* ── Group Card 렌더 ── */
  const renderGroup = useCallback(({ item: group }: { item: DiaryGroup }) => {
    const timeStr = (group.schedule_time || "").slice(0, 5);
    const daysStr = group.schedule_days || "";
    return (
      <Pressable
        style={[di.card, { backgroundColor: C.card }]}
        onPress={() => handleGroupPress(group)}
      >
        {/* 상단: 날짜 + 공유/진입 버튼 */}
        <View style={di.cardTop}>
          <View style={di.cardTopLeft}>
            <Text style={di.cardDate}>{formatDate(group.lesson_date)}</Text>
            <Text style={di.cardMeta}>
              {daysStr ? `${daysStr} ` : ""}
              {timeStr ? `${timeStr}반` : group.class_name}
              {timeStr ? ` · ${timeStr}` : ""}
            </Text>
          </View>
          {/* 공유 + 진입 — 별도 hit area (§9) */}
          <View style={di.cardActions}>
            <Pressable
              style={di.shareBtn}
              hitSlop={8}
              onPress={(e) => { e.stopPropagation(); handleShare(group); }}
            >
              <LucideIcon name="share-2" size={13} color="#4EA7D8" />
              <Text style={di.shareBtnText}>공유</Text>
            </Pressable>
            <View style={di.chevronWrap}>
              <LucideIcon name="chevron-right" size={15} color={C.textMuted} />
            </View>
          </View>
        </View>

        {/* 반 공통 일지 */}
        {group.common && (
          <View style={di.entryRow}>
            <View style={[di.typeBadge, { backgroundColor: C.brandMist }]}>
              <LucideIcon name="users" size={10} color={C.textPrimary} />
              <Text style={[di.typeBadgeText, { color: C.textPrimary }]}>반 공통</Text>
            </View>
            <Text style={di.entryContent} numberOfLines={2}>{group.common.content}</Text>
          </View>
        )}

        {/* 학생별 추가 일지 */}
        {group.notes.map((note, idx) => (
          <View
            key={note.source_note_id ?? `${note.student_id}-${idx}`}
            style={[di.entryRow, idx > 0 || group.common ? di.entryRowBorder : undefined]}
          >
            <View style={[di.typeBadge, { backgroundColor: "#F0FDF4" }]}>
              <LucideIcon name="user" size={10} color="#15803D" />
              <Text style={[di.typeBadgeText, { color: "#15803D" }]}>{note.student_name} 추가</Text>
            </View>
            <Text style={di.entryContent} numberOfLines={2}>
              {note.note_content ?? note.content}
            </Text>
          </View>
        ))}
      </Pressable>
    );
  }, [handleGroupPress, handleShare]);

  /* ── 그룹 데이터 ── */
  const groups = groupEntries(entries);
  const keyExtractor = useCallback((item: DiaryGroup) => item.key, []);
  const activeFilterCount = [activeDay, activeTime].filter(Boolean).length;

  return (
    <SafeAreaView style={di.safe} edges={[]}>
      <SubScreenHeader
        title={studentScopeName ? `${studentScopeName} · 일지` : "수업 일지"}
        subtitle={studentScopeName ? "개인 일지 이력" : "학생에게 노출된 전체 이력"}
        homePath="/(teacher)/today-schedule"
      />

      {/* 일지 작성 카드 — SafeArea 아래 정상 spacing (§6) */}
      <Pressable
        style={[di.writeCard, { backgroundColor: themeColor }]}
        onPress={() => setShowQuickWrite(true)}
      >
        <View style={di.writeCardIcon}>
          <LucideIcon name="edit" size={18} color="#fff" />
        </View>
        <View style={di.writeCardBody}>
          <Text style={di.writeCardTitle}>일지 작성</Text>
          <Text style={di.writeCardSub}>아직 작성하지 않은 수업을 선택해 일지를 작성합니다.</Text>
        </View>
        <LucideIcon name="chevron-right" size={16} color="rgba(255,255,255,0.7)" />
      </Pressable>

      {/* 지난 일지 섹션 헤더 */}
      <View style={di.sectionHeader}>
        <Text style={di.sectionTitle}>지난 일지</Text>
        <Text style={di.sectionSub}>작성한 수업 일지를 확인하고 수정할 수 있습니다.</Text>
      </View>

      {/* 검색창 */}
      <View style={di.searchRow}>
        <LucideIcon name="search" size={15} color={C.textSecondary} />
        <TextInput
          style={di.searchInput}
          value={searchText}
          onChangeText={handleSearchChange}
          placeholder="학생 이름으로 검색"
          placeholderTextColor={C.textMuted}
          returnKeyType="search"
        />
        {searchText.length > 0 && (
          <Pressable onPress={() => handleSearchChange("")}>
            <LucideIcon name="x-circle" size={15} color={C.textSecondary} />
          </Pressable>
        )}
      </View>

      {/* 필터 바 */}
      <View style={di.filterBar}>
        <Pressable
          style={[di.filterBtn, activeDay ? { backgroundColor: themeColor + "18", borderColor: themeColor } : undefined]}
          onPress={() => { setShowDayPicker(v => !v); setShowTimePicker(false); }}
        >
          <LucideIcon name="calendar" size={12} color={activeDay ? themeColor : C.textSecondary} />
          <Text style={[di.filterBtnText, activeDay ? { color: themeColor } : undefined]}>
            {activeDay ? `${activeDay}요일` : "요일"}
          </Text>
          <LucideIcon name="chevron-down" size={11} color={activeDay ? themeColor : C.textSecondary} />
        </Pressable>
        <Pressable
          style={[di.filterBtn, activeTime ? { backgroundColor: themeColor + "18", borderColor: themeColor } : undefined]}
          onPress={() => { setShowTimePicker(v => !v); setShowDayPicker(false); }}
        >
          <LucideIcon name="clock" size={12} color={activeTime ? themeColor : C.textSecondary} />
          <Text style={[di.filterBtnText, activeTime ? { color: themeColor } : undefined]}>
            {activeTime || "시간"}
          </Text>
          <LucideIcon name="chevron-down" size={11} color={activeTime ? themeColor : C.textSecondary} />
        </Pressable>
        {activeFilterCount > 0 && (
          <Pressable
            style={di.resetBtn}
            onPress={() => { setActiveDay(null); setActiveTime(null); load(searchText, null, null); }}
          >
            <LucideIcon name="x" size={12} color="#D96C6C" />
            <Text style={di.resetBtnText}>초기화</Text>
          </Pressable>
        )}
        <Text style={di.resultCount}>{groups.length}건</Text>
      </View>

      {/* 요일 선택 드롭다운 */}
      {showDayPicker && (
        <View style={di.picker}>
          <Pressable style={di.pickerItem} onPress={() => handleDaySelect(null)}>
            <Text style={[di.pickerItemText, !activeDay && { color: themeColor, fontFamily: "Pretendard-Regular" }]}>전체</Text>
          </Pressable>
          {KO_DAYS.map(d => (
            <Pressable key={d} style={di.pickerItem} onPress={() => handleDaySelect(d)}>
              <Text style={[di.pickerItemText, activeDay === d && { color: themeColor, fontFamily: "Pretendard-Regular" }]}>{d}요일</Text>
              {activeDay === d && <LucideIcon name="check" size={14} color={themeColor} />}
            </Pressable>
          ))}
        </View>
      )}

      {/* 시간 선택 드롭다운 */}
      {showTimePicker && (
        <View style={di.picker}>
          <Pressable style={di.pickerItem} onPress={() => handleTimeSelect(null)}>
            <Text style={[di.pickerItemText, !activeTime && { color: themeColor, fontFamily: "Pretendard-Regular" }]}>전체</Text>
          </Pressable>
          {availableTimes.length === 0 ? (
            <Text style={di.pickerEmptyText}>수업 시간 정보 없음</Text>
          ) : availableTimes.map(t => (
            <Pressable key={t} style={di.pickerItem} onPress={() => handleTimeSelect(t)}>
              <Text style={[di.pickerItemText, activeTime === t && { color: themeColor, fontFamily: "Pretendard-Regular" }]}>{t}</Text>
              {activeTime === t && <LucideIcon name="check" size={14} color={themeColor} />}
            </Pressable>
          ))}
        </View>
      )}

      {/* 목록 */}
      {loading ? (
        <ActivityIndicator color={themeColor} style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={groups}
          keyExtractor={keyExtractor}
          renderItem={renderGroup}
          contentContainerStyle={[di.listContent, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
          onRefresh={() => { setRefreshing(true); load(searchText, activeDay, activeTime); }}
          refreshing={refreshing}
          ListEmptyComponent={
            <View style={di.empty}>
              <LucideIcon name="book-open" size={36} color={C.textMuted} />
              <Text style={di.emptyTitle}>작성된 수업 일지가 없습니다.</Text>
              <Text style={di.emptyDesc}>
                {searchText || activeDay || activeTime
                  ? "검색/필터 조건을 변경해보세요."
                  : "새 일지를 작성하면 여기에 표시됩니다."}
              </Text>
            </View>
          }
        />
      )}

      {/* 미작성 수업 선택 바텀시트 */}
      <UnwrittenScheduleSheet
        visible={showQuickWrite}
        token={token}
        onClose={() => setShowQuickWrite(false)}
        backTo="diary-index"
      />
    </SafeAreaView>
  );
}

const di = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.background },

  /* ── 일지 작성 CTA ── */
  writeCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    marginHorizontal: 16,
    marginTop: 12,    /* SafeArea/Header 아래 정상 gap (§6) */
    marginBottom: 16,
    paddingHorizontal: 16, paddingVertical: 14,
    borderRadius: 14,
  },
  writeCardIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center", justifyContent: "center",
  },
  writeCardBody: { flex: 1, gap: 2 },
  writeCardTitle: { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: "#fff" },
  writeCardSub: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "rgba(255,255,255,0.8)" },

  /* ── 섹션 헤더 ── */
  sectionHeader: { paddingHorizontal: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: C.text },
  sectionSub: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 },

  /* ── 검색 ── */
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginBottom: 10,
    backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 12, paddingVertical: 9,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text, padding: 0 },

  /* ── 필터 ── */
  filterBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  filterBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10,
    borderWidth: 1.5, borderColor: C.border, backgroundColor: "#fff",
  },
  filterBtnText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  resetBtn: {
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 8, paddingVertical: 6,
    borderRadius: 8, backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FCA5A5",
  },
  resetBtnText: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#D96C6C" },
  resultCount: { marginLeft: "auto", fontSize: 12, color: C.textSecondary, fontFamily: "Pretendard-Regular" },

  /* ── 드롭다운 ── */
  picker: {
    marginHorizontal: 16, backgroundColor: "#fff",
    borderWidth: 1, borderColor: C.border, borderRadius: 12,
    marginBottom: 8, paddingVertical: 4, zIndex: 100,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 8, elevation: 4,
  },
  pickerItem: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  pickerItemText: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  pickerEmptyText: { fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Regular", textAlign: "center", padding: 12 },

  /* ── 목록 ── */
  listContent: { paddingHorizontal: 16, paddingBottom: 32, gap: 10 },

  /* ── Group Card ── */
  card: {
    borderRadius: 14, padding: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  cardTop: {
    flexDirection: "row", alignItems: "flex-start",
    justifyContent: "space-between", marginBottom: 10,
  },
  cardTopLeft: { flex: 1, gap: 2 },
  cardDate: { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: C.text },
  cardMeta: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },

  /* 공유 + chevron — 별도 hit area, 겹침 금지 (§9) */
  cardActions: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginLeft: 8,
  },
  shareBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 9, paddingVertical: 4,
    borderRadius: 8, backgroundColor: "#EBF5FB",
    borderWidth: 1, borderColor: "#B8DCF0",
  },
  shareBtnText: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#4EA7D8" },
  chevronWrap: {
    width: 28, height: 28,
    alignItems: "center", justifyContent: "center",
  },

  /* ── 일지 행 (공통/개별) ── */
  entryRow: { gap: 4, paddingTop: 8 },
  entryRowBorder: {
    marginTop: 8, paddingTop: 8,
    borderTopWidth: 1, borderTopColor: C.border,
  },
  typeBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2,
    alignSelf: "flex-start",
  },
  typeBadgeText: { fontSize: 10, fontFamily: "Pretendard-Regular" },
  entryContent: { fontSize: 13, color: C.text, fontFamily: "Pretendard-Regular", lineHeight: 19 },

  /* ── empty ── */
  empty: { alignItems: "center", paddingTop: 80, gap: 8 },
  emptyTitle: { fontSize: 16, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  emptyDesc: { fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Regular", textAlign: "center" },
});
