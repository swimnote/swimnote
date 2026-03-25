/**
 * WeeklySchedule — 선생님용 공통 주간 시간표 컴포넌트
 *
 * 내반 / 출결 / 수영일지 / 사진 / 영상 5개 화면 모두 재사용
 * 클릭 핸들러만 다르게 주입
 */
import { Feather } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import {
  Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

export interface TeacherClassGroup {
  id: string;
  name: string;
  schedule_days: string;
  schedule_time: string;
  student_count: number;
  capacity?: number | null;
  level?: string | null;
  instructor?: string | null;
}

export interface SlotStatus {
  attChecked: number;
  diaryDone:  boolean;
  hasPhotos:  boolean;
}

interface WeeklyScheduleProps {
  classGroups: TeacherClassGroup[];
  statusMap:   Record<string, SlotStatus>;
  onSelectClass: (group: TeacherClassGroup) => void;
  themeColor:  string;
  selectedDay?: string;
  onDayChange?: (day: string) => void;
  selectionMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  hideDayBar?: boolean;
}

const WEEK_DAYS = ["월", "화", "수", "목", "금", "토", "일"];
const DAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

function todayKo() { return DAY_KO[new Date().getDay()]; }

function parseHour(t: string): number {
  const h = t.split(/[:-]/)[0].trim();
  return parseInt(h) || 0;
}

function getDayClasses(groups: TeacherClassGroup[], day: string) {
  return groups
    .filter(g => g.schedule_days.split(",").map(d => d.trim()).includes(day))
    .sort((a, b) => parseHour(a.schedule_time) - parseHour(b.schedule_time));
}

const CLASS_COLORS = [
  "#1F8F86","#EC4899","#14B8A6","#E4A93A","#8B5CF6",
  "#2E9B6F","#4EA7D8","#D96C6C","#F97316","#06B6D4",
];
function classColor(id: string) {
  let n = 0; for (let i = 0; i < id.length; i++) n += id.charCodeAt(i);
  return CLASS_COLORS[n % CLASS_COLORS.length];
}

export function WeeklySchedule({
  classGroups, statusMap, onSelectClass, themeColor,
  selectedDay: externalDay, onDayChange,
  selectionMode = false, selectedIds = new Set(), onToggleSelect,
  hideDayBar = false,
}: WeeklyScheduleProps) {
  const today = todayKo();
  const [internalDay, setInternalDay] = useState(today);
  const selectedDay = externalDay ?? internalDay;
  const dayScrollRef = useRef<ScrollView>(null);

  function selectDay(day: string) {
    setInternalDay(day);
    onDayChange?.(day);
  }

  const dayCount = WEEK_DAYS.reduce<Record<string, number>>((acc, d) => {
    acc[d] = getDayClasses(classGroups, d).length;
    return acc;
  }, {});

  const currentClasses = getDayClasses(classGroups, selectedDay);

  return (
    <View style={ws.root}>
      {/* ── 요일 탭 ── */}
      {!hideDayBar && (
        <ScrollView
          ref={dayScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={ws.dayBar}
          contentContainerStyle={ws.dayBarContent}
        >
          {WEEK_DAYS.map(day => {
            const isActive  = selectedDay === day;
            const isToday   = day === today;
            const cnt       = dayCount[day];
            return (
              <Pressable
                key={day}
                style={[
                  ws.dayTab,
                  isActive && { backgroundColor: themeColor, borderColor: themeColor },
                  !isActive && isToday && { borderColor: themeColor + "80" },
                ]}
                onPress={() => selectDay(day)}
              >
                <Text style={[ws.dayTabText, isActive && { color: "#fff" }, !isActive && isToday && { color: themeColor }]}>
                  {day}
                </Text>
                {isToday && !isActive && (
                  <View style={[ws.todayDot, { backgroundColor: themeColor }]} />
                )}
                {cnt > 0 && (
                  <View style={[ws.dayCntBubble, { backgroundColor: isActive ? "rgba(255,255,255,0.35)" : themeColor + "20" }]}>
                    <Text style={[ws.dayCntText, { color: isActive ? "#fff" : themeColor }]}>{cnt}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {/* ── 날짜 + 클래스 수 헤더 ── */}
      <View style={ws.sectionHeader}>
        <Text style={[ws.sectionDay, { color: selectedDay === today ? themeColor : C.text }]}>
          {selectedDay}요일 수업
          {selectedDay === today && <Text style={[ws.todayLabel, { color: themeColor }]}> · 오늘</Text>}
        </Text>
        <Text style={ws.sectionCount}>{currentClasses.length}개 반</Text>
      </View>

      {/* ── 시간 슬롯 리스트 ── */}
      {currentClasses.length === 0 ? (
        <View style={ws.empty}>
          <Feather name="calendar" size={24} color={C.textMuted} />
          <Text style={ws.emptyText}>{selectedDay}요일 수업이 없습니다</Text>
        </View>
      ) : (
        <View style={ws.slotList}>
          {currentClasses.map(g => {
            const status    = statusMap[g.id];
            const total     = g.student_count;
            const checked   = status?.attChecked ?? 0;
            const attDone   = total === 0 || checked >= total;
            const diaryDone = status?.diaryDone ?? true;
            const hasPhotos = status?.hasPhotos ?? false;
            const inactive  = total === 0;
            const color     = classColor(g.id);
            const isSelected = selectedIds.has(g.id);

            return (
              <Pressable
                key={g.id}
                style={[
                  ws.slot,
                  { borderColor: isSelected ? themeColor : C.border },
                  inactive && ws.slotInactive,
                ]}
                onPress={() => selectionMode ? onToggleSelect?.(g.id) : (!inactive && onSelectClass(g))}
                onLongPress={() => !inactive && onToggleSelect?.(g.id)}
                disabled={!selectionMode && inactive}
              >
                {/* 왼쪽 컬러 바 */}
                <View style={[ws.colorBar, { backgroundColor: inactive ? "#D1D5DB" : color }]} />

                {/* 선택 모드 체크박스 */}
                {selectionMode && !inactive && (
                  <View style={[ws.checkBox, { borderColor: themeColor, backgroundColor: isSelected ? themeColor : "#fff" }]}>
                    {isSelected && <Feather name="check" size={9} color="#fff" />}
                  </View>
                )}

                {/* 시간 */}
                <Text style={[ws.timeCol, { color: inactive ? C.textMuted : color }]}>
                  {g.schedule_time.replace(/:00$/, "").replace(/:00 /, " ")}
                </Text>

                {/* 반 이름 + 담당 선생 */}
                <View style={{ flex: 1, justifyContent: "center" }}>
                  <Text style={[ws.nameCol, { color: inactive ? C.textMuted : C.text }]} numberOfLines={1}>
                    {g.name}
                    {g.level ? <Text style={ws.levelInline}> {g.level}</Text> : null}
                  </Text>
                  {!!g.instructor && (
                    <Text style={ws.instructorCol} numberOfLines={1}>{g.instructor}</Text>
                  )}
                </View>

                {/* 우측 정보 */}
                <View style={ws.rightCol}>
                  <Text style={[ws.cntText, { color: inactive ? C.textMuted : C.textSecondary }]}>
                    {total}명
                  </Text>
                  {!inactive && (
                    <View style={ws.dots}>
                      <View style={[ws.dot, { backgroundColor: attDone ? "#DDF2EF" : "#F9DEDA" }]}>
                        <Feather name={attDone ? "check" : "x"} size={7} color={attDone ? "#1F8F86" : "#D96C6C"} />
                      </View>
                      <View style={[ws.dot, { backgroundColor: diaryDone ? "#DDF2EF" : "#FFF1BF" }]}>
                        <Feather name={diaryDone ? "check" : "edit-3"} size={7} color={diaryDone ? "#1F8F86" : "#D97706"} />
                      </View>
                      {hasPhotos && (
                        <View style={[ws.dot, { backgroundColor: "#EEDDF5" }]}>
                          <Feather name="camera" size={7} color="#7C3AED" />
                        </View>
                      )}
                    </View>
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ── 독립형 요일 탭 (스크롤 밖 고정용) ─────────────────────────────
export interface DayBarProps {
  classGroups: TeacherClassGroup[];
  selectedDay: string;
  onDayChange: (day: string) => void;
  themeColor: string;
}

export function DayBar({ classGroups, selectedDay, onDayChange, themeColor }: DayBarProps) {
  const today = todayKo();
  const dayCount = WEEK_DAYS.reduce<Record<string, number>>((acc, d) => {
    acc[d] = getDayClasses(classGroups, d).length;
    return acc;
  }, {});

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={ws.dayBar}
      contentContainerStyle={ws.dayBarContent}
    >
      {WEEK_DAYS.map(day => {
        const isActive = selectedDay === day;
        const isToday  = day === today;
        const cnt      = dayCount[day];
        return (
          <Pressable
            key={day}
            style={[
              ws.dayTab,
              isActive && { backgroundColor: themeColor, borderColor: themeColor },
              !isActive && isToday && { borderColor: themeColor + "80" },
            ]}
            onPress={() => onDayChange(day)}
          >
            <Text style={[ws.dayTabText, isActive && { color: "#fff" }, !isActive && isToday && { color: themeColor }]}>
              {day}
            </Text>
            {isToday && !isActive && (
              <View style={[ws.todayDot, { backgroundColor: themeColor }]} />
            )}
            {cnt > 0 && (
              <View style={[ws.dayCntBubble, { backgroundColor: isActive ? "rgba(255,255,255,0.35)" : themeColor + "20" }]}>
                <Text style={[ws.dayCntText, { color: isActive ? "#fff" : themeColor }]}>{cnt}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const ws = StyleSheet.create({
  root: { flex: 1 },

  dayBar:        { backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border },
  dayBarContent: { paddingHorizontal: 12, paddingVertical: 6, gap: 5, flexDirection: "row" },
  dayTab: {
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 9, paddingVertical: 5,
    borderRadius: 16, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.background,
  },
  dayTabText:   { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  todayDot:     { width: 4, height: 4, borderRadius: 2 },
  dayCntBubble: { minWidth: 14, height: 14, borderRadius: 7, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  dayCntText:   { fontSize: 9, fontFamily: "Inter_700Bold" },

  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 14, paddingVertical: 7 },
  sectionDay:    { fontSize: 13, fontFamily: "Inter_700Bold" },
  todayLabel:    { fontSize: 12, fontFamily: "Inter_500Medium" },
  sectionCount:  { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textMuted },

  slotList: { paddingHorizontal: 10, gap: 5 },

  slot: {
    flexDirection: "row", alignItems: "center",
    borderRadius: 10, paddingVertical: 6,
    borderWidth: 1, backgroundColor: C.card,
    overflow: "hidden", minHeight: 44,
  },
  slotInactive: { backgroundColor: "#FBF8F6", borderColor: "#E9E2DD" },

  colorBar: { width: 4, alignSelf: "stretch" },

  timeCol: {
    fontSize: 11, fontFamily: "Inter_700Bold",
    width: 62, textAlign: "center",
  },
  nameCol: {
    fontSize: 13, fontFamily: "Inter_600SemiBold",
    color: C.text,
  },
  levelInline:    { fontSize: 10, fontFamily: "Inter_400Regular", color: C.textMuted },
  instructorCol:  { fontSize: 10, fontFamily: "Inter_400Regular", color: C.textMuted, marginTop: 1 },

  rightCol: { alignItems: "flex-end", paddingRight: 10, gap: 3 },
  cntText:  { fontSize: 10, fontFamily: "Inter_500Medium", color: C.textSecondary },
  dots:     { flexDirection: "row", gap: 2 },
  dot:      { width: 14, height: 14, borderRadius: 7, alignItems: "center", justifyContent: "center" },

  checkBox: { width: 18, height: 18, borderRadius: 9, borderWidth: 2,
              alignItems: "center", justifyContent: "center", marginLeft: 6 },

  empty:    { alignItems: "center", paddingTop: 32, gap: 8 },
  emptyText:{ fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted },
});
