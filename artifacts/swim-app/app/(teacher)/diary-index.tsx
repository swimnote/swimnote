/**
 * (teacher)/diary-index.tsx — 수업 일지 인덱스
 *
 * - 학생에게 노출된 모든 일지 이력 (반 공통 + 학생별 추가)
 * - 학생 이름 검색 (즉시 필터)
 * - 요일 / 시간 필터
 * - 최신순 정렬
 * - 항목 클릭 → diary.tsx 로 이동 (해당 반)
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

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

/* ── 날짜 포맷 ───────────────────────────────────────────────────── */
function formatDate(iso: string) {
  const d = new Date(iso + "T12:00:00");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${days[d.getDay()]}요일`;
}

/* ════════════════════════════════════════════════════════════════
   메인 컴포넌트
   ════════════════════════════════════════════════════════════════ */
export default function DiaryIndexScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();

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

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── 데이터 로드 ── */
  const load = useCallback(async (sName = "", day: string | null = null, time: string | null = null) => {
    if (!token) return;
    const params = new URLSearchParams();
    if (sName.trim()) params.set("student_name", sName.trim());
    if (day) params.set("day", day);
    if (time) params.set("time", time);
    try {
      const res = await apiRequest(token, `/diaries/index?${params.toString()}`);
      if (res.ok) {
        const d = await res.json();
        const list: DiaryIndexEntry[] = Array.isArray(d.entries) ? d.entries : [];
        setEntries(list);

        // 활성 수업 시간 목록 추출 (중복 제거, 정렬)
        if (!day && !sName && !time) {
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
  }, [token]);

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

  /* ── 항목 클릭 → diary.tsx 수정 뷰 ── */
  const handlePress = useCallback((entry: DiaryIndexEntry) => {
    router.push({
      pathname: "/(teacher)/diary",
      params: { editDiaryId: entry.source_diary_id },
    } as any);
  }, []);

  /* ── 렌더 ── */
  const renderItem = useCallback(({ item }: { item: DiaryIndexEntry }) => {
    const isNote = item.entry_type === "student_note";
    return (
      <Pressable style={[di.card, { backgroundColor: C.card }]} onPress={() => handlePress(item)}>
        {/* 상단 메타 */}
        <View style={di.cardTop}>
          <Text style={di.cardDate}>{formatDate(item.lesson_date)}</Text>
          <View style={[di.typeBadge, { backgroundColor: isNote ? "#EDE9FE" : "#EFF6FF" }]}>
            {isNote
              ? <><Feather name="user" size={10} color="#7C3AED" /><Text style={[di.typeBadgeText, { color: "#7C3AED" }]}>{item.student_name} 추가</Text></>
              : <><Feather name="users" size={10} color="#2563EB" /><Text style={[di.typeBadgeText, { color: "#2563EB" }]}>반 공통</Text></>
            }
          </View>
        </View>

        {/* 반/시간 */}
        <View style={di.cardMeta}>
          <Feather name="layers" size={11} color={C.textSecondary} />
          <Text style={di.cardMetaText}>{item.class_name}</Text>
          <Feather name="clock" size={11} color={C.textSecondary} style={{ marginLeft: 8 }} />
          <Text style={di.cardMetaText}>{(item.schedule_time || "").slice(0, 5)}</Text>
          {item.schedule_days && (
            <Text style={di.cardMetaText}> · {item.schedule_days}</Text>
          )}
        </View>

        {/* 내용 미리보기 */}
        <Text style={di.cardContent} numberOfLines={2}>{item.content}</Text>

        <Feather name="chevron-right" size={15} color={C.textMuted} style={di.chevron} />
      </Pressable>
    );
  }, [handlePress]);

  const keyExtractor = useCallback((item: DiaryIndexEntry, index: number) => `${item.diary_id}-${item.entry_type}-${item.student_id || "x"}-${index}`, []);

  const activeFilterCount = [activeDay, activeTime].filter(Boolean).length;

  return (
    <SafeAreaView style={di.safe} edges={[]}>
      <SubScreenHeader title="수업 일지" subtitle="학생에게 노출된 전체 이력" homePath="/(teacher)/today-schedule" />

      {/* 일지 작성 버튼 */}
      <Pressable
        style={[di.writeBtn, { backgroundColor: themeColor }]}
        onPress={() => router.push("/(teacher)/diary-unwritten" as any)}
      >
        <Feather name="edit-3" size={15} color="#fff" />
        <Text style={di.writeBtnText}>일지 작성</Text>
        <View style={di.writeBtnBadgeWrap}>
          <Feather name="chevron-right" size={15} color="rgba(255,255,255,0.7)" />
        </View>
      </Pressable>

      {/* 검색창 */}
      <View style={di.searchRow}>
        <Feather name="search" size={15} color={C.textSecondary} />
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
            <Feather name="x-circle" size={15} color={C.textSecondary} />
          </Pressable>
        )}
      </View>

      {/* 필터 바 */}
      <View style={di.filterBar}>
        {/* 요일 필터 버튼 */}
        <Pressable
          style={[di.filterBtn, activeDay && { backgroundColor: themeColor + "18", borderColor: themeColor }]}
          onPress={() => { setShowDayPicker(v => !v); setShowTimePicker(false); }}
        >
          <Feather name="calendar" size={12} color={activeDay ? themeColor : C.textSecondary} />
          <Text style={[di.filterBtnText, activeDay && { color: themeColor }]}>
            {activeDay ? `${activeDay}요일` : "요일"}
          </Text>
          <Feather name="chevron-down" size={11} color={activeDay ? themeColor : C.textSecondary} />
        </Pressable>

        {/* 시간 필터 버튼 */}
        <Pressable
          style={[di.filterBtn, activeTime && { backgroundColor: themeColor + "18", borderColor: themeColor }]}
          onPress={() => { setShowTimePicker(v => !v); setShowDayPicker(false); }}
        >
          <Feather name="clock" size={12} color={activeTime ? themeColor : C.textSecondary} />
          <Text style={[di.filterBtnText, activeTime && { color: themeColor }]}>
            {activeTime || "시간"}
          </Text>
          <Feather name="chevron-down" size={11} color={activeTime ? themeColor : C.textSecondary} />
        </Pressable>

        {/* 필터 초기화 */}
        {activeFilterCount > 0 && (
          <Pressable
            style={di.resetBtn}
            onPress={() => { setActiveDay(null); setActiveTime(null); load(searchText, null, null); }}
          >
            <Feather name="x" size={12} color="#EF4444" />
            <Text style={di.resetBtnText}>초기화</Text>
          </Pressable>
        )}

        <Text style={di.resultCount}>{entries.length}건</Text>
      </View>

      {/* 요일 선택 드롭다운 */}
      {showDayPicker && (
        <View style={di.picker}>
          <Pressable style={di.pickerItem} onPress={() => handleDaySelect(null)}>
            <Text style={[di.pickerItemText, !activeDay && { color: themeColor, fontFamily: "Inter_700Bold" }]}>전체</Text>
          </Pressable>
          {KO_DAYS.map(d => (
            <Pressable key={d} style={di.pickerItem} onPress={() => handleDaySelect(d)}>
              <Text style={[di.pickerItemText, activeDay === d && { color: themeColor, fontFamily: "Inter_700Bold" }]}>{d}요일</Text>
              {activeDay === d && <Feather name="check" size={14} color={themeColor} />}
            </Pressable>
          ))}
        </View>
      )}

      {/* 시간 선택 드롭다운 */}
      {showTimePicker && (
        <View style={di.picker}>
          <Pressable style={di.pickerItem} onPress={() => handleTimeSelect(null)}>
            <Text style={[di.pickerItemText, !activeTime && { color: themeColor, fontFamily: "Inter_700Bold" }]}>전체</Text>
          </Pressable>
          {availableTimes.length === 0 ? (
            <Text style={di.pickerEmptyText}>수업 시간 정보 없음</Text>
          ) : availableTimes.map(t => (
            <Pressable key={t} style={di.pickerItem} onPress={() => handleTimeSelect(t)}>
              <Text style={[di.pickerItemText, activeTime === t && { color: themeColor, fontFamily: "Inter_700Bold" }]}>{t}</Text>
              {activeTime === t && <Feather name="check" size={14} color={themeColor} />}
            </Pressable>
          ))}
        </View>
      )}

      {/* 목록 */}
      {loading ? (
        <ActivityIndicator color={themeColor} style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={di.listContent}
          showsVerticalScrollIndicator={false}
          onRefresh={() => { setRefreshing(true); load(searchText, activeDay, activeTime); }}
          refreshing={refreshing}
          ListEmptyComponent={
            <View style={di.empty}>
              <Feather name="book-open" size={36} color={C.textMuted} />
              <Text style={di.emptyTitle}>일지가 없습니다</Text>
              <Text style={di.emptyDesc}>
                {searchText || activeDay || activeTime
                  ? "검색/필터 조건을 변경해보세요."
                  : "아직 작성된 수업 일지가 없습니다."}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const di = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.background },

  writeBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginBottom: 12,
    paddingHorizontal: 16, paddingVertical: 13,
    borderRadius: 12,
  },
  writeBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff", flex: 1 },
  writeBtnBadgeWrap: { opacity: 0.7 },

  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  backBtn: { marginBottom: 6, width: 32 },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 12, color: C.textSecondary, fontFamily: "Inter_400Regular", marginTop: 2 },

  searchRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginBottom: 10,
    backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 12, paddingVertical: 9,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", color: C.text, padding: 0 },

  filterBar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 16, paddingBottom: 10,
  },
  filterBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10,
    borderWidth: 1.5, borderColor: C.border, backgroundColor: "#fff",
  },
  filterBtnText: { fontSize: 12, fontFamily: "Inter_500Medium", color: C.textSecondary },
  resetBtn: {
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 8, paddingVertical: 6,
    borderRadius: 8, backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FCA5A5",
  },
  resetBtnText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#EF4444" },
  resultCount: { marginLeft: "auto", fontSize: 12, color: C.textSecondary, fontFamily: "Inter_400Regular" },

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
  pickerItemText: { fontSize: 14, fontFamily: "Inter_400Regular", color: C.text },
  pickerEmptyText: { fontSize: 13, color: C.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", padding: 12 },

  listContent: { paddingHorizontal: 16, paddingBottom: 32, gap: 8 },
  card: {
    borderRadius: 14, padding: 14, shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04,
    shadowRadius: 4, elevation: 1, position: "relative",
  },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  cardDate: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.text },
  typeBadge: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  typeBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  cardMeta: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  cardMetaText: { fontSize: 11, color: C.textSecondary, fontFamily: "Inter_400Regular", marginLeft: 3 },
  cardContent: { fontSize: 13, color: C.text, fontFamily: "Inter_400Regular", lineHeight: 19 },
  chevron: { position: "absolute", right: 12, top: "50%" },
  empty: { alignItems: "center", paddingTop: 80, gap: 8 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  emptyDesc: { fontSize: 13, color: C.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
});
