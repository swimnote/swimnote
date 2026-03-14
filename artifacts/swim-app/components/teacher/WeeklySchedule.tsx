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
  level?: string | null;
  instructor?: string | null;
}

export interface SlotStatus {
  attChecked: number;   // 오늘 출결 체크된 학생 수
  diaryDone:  boolean;  // 오늘 일지 작성 여부
  hasPhotos:  boolean;  // 사진/영상 업로드 여부
}

interface WeeklyScheduleProps {
  classGroups: TeacherClassGroup[];
  statusMap:   Record<string, SlotStatus>;
  onSelectClass: (group: TeacherClassGroup) => void;
  themeColor:  string;
  /** 외부에서 selectedDay를 제어할 경우 사용 */
  selectedDay?: string;
  onDayChange?: (day: string) => void;
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

export function WeeklySchedule({
  classGroups, statusMap, onSelectClass, themeColor,
  selectedDay: externalDay, onDayChange,
}: WeeklyScheduleProps) {
  const today = todayKo();
  const [internalDay, setInternalDay] = useState(today);
  const selectedDay = externalDay ?? internalDay;
  const dayScrollRef = useRef<ScrollView>(null);

  function selectDay(day: string) {
    setInternalDay(day);
    onDayChange?.(day);
  }

  // 요일 탭의 각 반 수
  const dayCount = WEEK_DAYS.reduce<Record<string, number>>((acc, d) => {
    acc[d] = getDayClasses(classGroups, d).length;
    return acc;
  }, {});

  const currentClasses = getDayClasses(classGroups, selectedDay);

  return (
    <View style={ws.root}>
      {/* ── 요일 탭 ── */}
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
          <Feather name="calendar" size={28} color={C.textMuted} />
          <Text style={ws.emptyText}>{selectedDay}요일 수업이 없습니다</Text>
        </View>
      ) : (
        <View style={ws.slotList}>
          {currentClasses.map(g => {
            const status  = statusMap[g.id];
            const total   = g.student_count;
            const checked = status?.attChecked ?? 0;
            const attDone = total === 0 || checked >= total;
            const diaryDone = status?.diaryDone ?? true;
            const hasPhotos = status?.hasPhotos ?? false;
            const inactive  = total === 0;
            const hour      = g.schedule_time.split(/[:-]/)[0].trim();

            return (
              <Pressable
                key={g.id}
                style={[ws.slot, { backgroundColor: inactive ? "#F9FAFB" : C.card, borderColor: inactive ? "#E5E7EB" : C.border }]}
                onPress={() => !inactive && onSelectClass(g)}
                disabled={inactive}
              >
                {/* 시간 pill */}
                <View style={[ws.timePill, { backgroundColor: inactive ? "#F3F4F6" : themeColor + "18" }]}>
                  <Text style={[ws.timeText, { color: inactive ? C.textMuted : themeColor }]}>{hour}시</Text>
                </View>

                {/* 반 정보 */}
                <View style={ws.slotMid}>
                  <Text style={[ws.slotName, { color: inactive ? C.textMuted : C.text }]} numberOfLines={1}>
                    {g.name}
                  </Text>
                  <View style={ws.slotMeta}>
                    <Text style={[ws.slotTime, { color: inactive ? C.textMuted : C.textSecondary }]}>
                      {g.schedule_time}
                    </Text>
                    {g.level && (
                      <View style={ws.levelBadge}>
                        <Text style={ws.levelText}>{g.level}</Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* 우측: 학생 수 + 상태 점 */}
                <View style={ws.slotRight}>
                  {/* 학생 수 배지 */}
                  <View style={[ws.cntBadge, { backgroundColor: inactive ? "#F3F4F6" : themeColor + "15" }]}>
                    <Feather name="users" size={10} color={inactive ? C.textMuted : themeColor} />
                    <Text style={[ws.cntText, { color: inactive ? C.textMuted : themeColor }]}>
                      {total}명
                    </Text>
                  </View>

                  {/* 상태 점 */}
                  {!inactive && (
                    <View style={ws.dots}>
                      {/* 출결 미완료 → 빨간 점 */}
                      <View style={[ws.dot, { backgroundColor: attDone ? "#D1FAE5" : "#FEE2E2" }]}>
                        <Feather
                          name={attDone ? "check" : "x"}
                          size={8}
                          color={attDone ? "#059669" : "#DC2626"}
                        />
                      </View>
                      {/* 일지 미작성 → 주황 점 */}
                      <View style={[ws.dot, { backgroundColor: diaryDone ? "#D1FAE5" : "#FEF3C7" }]}>
                        <Feather
                          name={diaryDone ? "check" : "edit-3"}
                          size={8}
                          color={diaryDone ? "#059669" : "#D97706"}
                        />
                      </View>
                      {/* 사진 있음 → 카메라 */}
                      {hasPhotos && (
                        <View style={[ws.dot, { backgroundColor: "#EDE9FE" }]}>
                          <Feather name="camera" size={8} color="#7C3AED" />
                        </View>
                      )}
                    </View>
                  )}
                </View>

                {/* 비활성 오버레이 */}
                {inactive && (
                  <View style={ws.inactiveBadge}>
                    <Text style={ws.inactiveText}>학생없음</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const ws = StyleSheet.create({
  root: { flex: 1 },

  dayBar:        { backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border },
  dayBarContent: { paddingHorizontal: 12, paddingVertical: 8, gap: 6, flexDirection: "row" },
  dayTab: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 11, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.background,
  },
  dayTabText:  { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  todayDot:    { width: 5, height: 5, borderRadius: 3 },
  dayCntBubble:{ minWidth: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  dayCntText:  { fontSize: 9, fontFamily: "Inter_700Bold" },

  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10 },
  sectionDay:    { fontSize: 14, fontFamily: "Inter_700Bold" },
  todayLabel:    { fontSize: 13, fontFamily: "Inter_500Medium" },
  sectionCount:  { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted },

  slotList: { paddingHorizontal: 12, gap: 6 },
  slot: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1,
  },
  timePill:  { width: 42, paddingVertical: 6, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  timeText:  { fontSize: 12, fontFamily: "Inter_700Bold" },
  slotMid:   { flex: 1, gap: 2 },
  slotName:  { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  slotMeta:  { flexDirection: "row", alignItems: "center", gap: 6 },
  slotTime:  { fontSize: 11, fontFamily: "Inter_400Regular" },
  levelBadge:{ backgroundColor: "#EDE9FE", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 6 },
  levelText: { fontSize: 10, fontFamily: "Inter_500Medium", color: "#7C3AED" },

  slotRight: { alignItems: "flex-end", gap: 5 },
  cntBadge:  { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  cntText:   { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  dots:      { flexDirection: "row", gap: 3 },
  dot:       { width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center" },

  inactiveBadge: { backgroundColor: "#F3F4F6", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  inactiveText:  { fontSize: 10, fontFamily: "Inter_400Regular", color: C.textMuted },

  empty:     { alignItems: "center", paddingTop: 48, gap: 10 },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textMuted },
});
