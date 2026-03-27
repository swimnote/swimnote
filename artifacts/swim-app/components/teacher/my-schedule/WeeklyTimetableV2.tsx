/**
 * WeeklyTimetableV2 — iOS 캘린더형 7일 통합 그리드
 *
 * 레이아웃:
 *   시간축(왼쪽) + 월·화·수·목·금·토·일 단일 그리드
 *   섹션 배지 없음 / 선 최소화 / 흰 배경
 *   기능·로직·클릭이벤트는 기존 그대로 유지
 */
import { Feather } from "@expo/vector-icons";
import React, { useMemo } from "react";
import {
  Dimensions, Pressable, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import { SlotStatus, TeacherClassGroup } from "@/components/teacher/types";
import {
  ChangeLogItem, StudentItem, WT_ROW_H,
  addDaysStr, classColor, getWeekDates, parseHour, todayDateStr,
} from "./utils";

const SCREEN_W  = Dimensions.get("window").width;
const TIME_W    = 28;
const ALL_DAYS  = ["월", "화", "수", "목", "금", "토"];
const COL_W     = Math.floor((SCREEN_W - TIME_W) / 6);
const FIXED_HOURS = Array.from({ length: 13 }, (_, i) => i + 9); // 9~21시 고정

interface Props {
  groups:        TeacherClassGroup[];
  onSelectClass: (g: TeacherClassGroup) => void;
  selectionMode: boolean;
  selectedIds:   Set<string>;
  toggleSelect:  (id: string) => void;
  weekStart:     string;
  changeLogs:    ChangeLogItem[];
  onPrevWeek:    () => void;
  onNextWeek:    () => void;
  students?:     StudentItem[];
  statusMap?:    Record<string, SlotStatus>;
}

export default function WeeklyTimetableV2({
  groups, onSelectClass, selectionMode, selectedIds, toggleSelect,
  weekStart, changeLogs, onPrevWeek, onNextWeek,
  students = [], statusMap = {},
}: Props) {
  const today     = todayDateStr();
  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);

  const changedClassIds = useMemo(
    () => new Set(changeLogs.map(l => l.class_group_id)),
    [changeLogs],
  );

  const classStudentMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    students.forEach(s => {
      if (!s.name) return;
      const ids: string[] = Array.isArray(s.assigned_class_ids) && s.assigned_class_ids.length
        ? s.assigned_class_ids
        : s.class_group_id ? [s.class_group_id] : [];
      ids.forEach(cid => {
        if (!map[cid]) map[cid] = [];
        map[cid].push(s.name);
      });
    });
    return map;
  }, [students]);

  const dateInfo = useMemo(() => {
    const m: Record<string, { label: string; isToday: boolean; dateStr: string }> = {};
    weekDates.forEach(({ koDay, dateStr, label }) => {
      m[koDay] = { label, isToday: dateStr === today, dateStr };
    });
    return m;
  }, [weekDates, today]);

  /* 시간축: 9시~21시 고정 */
  const allHours = FIXED_HOURS;

  /* 7일 전체 셀 맵 */
  const cellMap = useMemo(() => {
    const map: Record<string, TeacherClassGroup[]> = {};
    weekDates.forEach(({ koDay }) => {
      allHours.forEach(h => {
        const key = `${koDay}-${h}`;
        map[key] = groups.filter(g => {
          const days = g.schedule_days.split(",").map(d => d.trim());
          return days.includes(koDay) && parseHour(g.schedule_time) === h;
        });
      });
    });
    return map;
  }, [groups, weekDates]);

  /* ── 카드 렌더 (기존 로직 그대로) ── */
  function renderCard(g: TeacherClassGroup, isToday: boolean) {
    const selected  = selectedIds.has(g.id);
    const accent    = classColor(g.id);
    const hasDot    = changedClassIds.has(g.id);
    const cardBg    = g.color && g.color !== "#FFFFFF" ? g.color : "#FFFFFF";
    const cardBdr   = cardBg === "#FFFFFF" ? "#E5E7EB" : "transparent";

    const names     = classStudentMap[g.id] ?? [];
    const namesLine = names.length > 0 ? names.join(" · ") : null;

    const total   = g.student_count;
    const checked = isToday ? (statusMap[g.id]?.attChecked ?? 0) : null;
    const attDone = checked !== null && total > 0 && checked >= total;

    return (
      <Pressable
        key={g.id}
        style={[wt.card, {
          backgroundColor: cardBg,
          borderColor:     cardBdr,
          opacity:         selected ? 0.75 : 1,
        }]}
        onPress={() => selectionMode ? toggleSelect(g.id) : onSelectClass(g)}
        onLongPress={() => toggleSelect(g.id)}
      >
        {hasDot && <View style={wt.changeDot} />}
        {selectionMode && (
          <View style={[wt.checkBox, {
            borderColor:     "#374151",
            backgroundColor: selected ? "#374151" : "transparent",
          }]}>
            {selected && <Feather name="check" size={6} color="#fff" />}
          </View>
        )}
        <View style={[wt.accentBar, { backgroundColor: accent }]} />
        <Text style={wt.cardName} numberOfLines={1}>{g.name}</Text>
        {namesLine ? (
          <Text style={wt.cardStudents} numberOfLines={1}>{namesLine}</Text>
        ) : total > 0 ? (
          <Text style={wt.cardStudents}>{total}명</Text>
        ) : null}
        {checked !== null && total > 0 && (
          <Text style={[wt.cardAtt, attDone ? wt.attDone : wt.attPend]}>
            ● {checked}/{total}
          </Text>
        )}
      </Pressable>
    );
  }

  return (
    <View style={wt.root}>
      {/* 주간 네비게이션 */}
      <View style={wt.weekNav}>
        <Pressable style={wt.weekNavBtn} onPress={onPrevWeek}>
          <Feather name="chevron-left" size={18} color="#9CA3AF" />
        </Pressable>
        <Text style={wt.weekNavTitle}>
          {(() => {
            const s  = new Date(weekStart + "T12:00:00Z");
            const e  = addDaysStr(weekStart, 6);
            const ed = new Date(e + "T12:00:00Z");
            return `${s.getUTCMonth()+1}월 ${s.getUTCDate()}일 – ${ed.getUTCMonth()+1}월 ${ed.getUTCDate()}일`;
          })()}
        </Text>
        <Pressable style={wt.weekNavBtn} onPress={onNextWeek}>
          <Feather name="chevron-right" size={18} color="#9CA3AF" />
        </Pressable>
      </View>

      {/* 7일 통합 그리드 */}
      <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
        {/* 요일 헤더 */}
        <View style={[wt.gridRow, wt.headerRow]}>
          <View style={[wt.timeTop, { width: TIME_W }]} />
          {ALL_DAYS.map(day => {
            const info = dateInfo[day] ?? { label: "", isToday: false };
            return (
              <View key={day}
                style={[wt.dayHeader, { width: COL_W }, info.isToday && wt.dayHeaderToday]}>
                <Text style={[wt.dayHeaderDate, info.isToday && { color: "#2EC4B6" }]}>
                  {info.label}
                </Text>
                <Text style={[wt.dayHeaderText, info.isToday && { color: "#2EC4B6" }]}>
                  {day}
                </Text>
              </View>
            );
          })}
        </View>

        {/* 시간 행 */}
        {allHours.map(h => (
          <View key={h} style={[wt.gridRow, { height: WT_ROW_H }]}>
            <View style={[wt.timeCell, { width: TIME_W }]}>
              <Text style={wt.timeText}>{h}</Text>
            </View>
            {ALL_DAYS.map(day => {
              const info = dateInfo[day] ?? { isToday: false };
              const cls  = cellMap[`${day}-${h}`] ?? [];
              return (
                <View key={day} style={[wt.cell, { width: COL_W, height: WT_ROW_H }]}>
                  {cls.map(g => renderCard(g, info.isToday))}
                </View>
              );
            })}
          </View>
        ))}

        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

const wt = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#FFFFFF" },

  weekNav: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 4, paddingVertical: 6, backgroundColor: "#FFFFFF",
    borderBottomWidth: 0.5, borderBottomColor: "#E5E7EB",
  },
  weekNavBtn:   { padding: 10 },
  weekNavTitle: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280" },

  gridRow:   { flexDirection: "row" },
  headerRow: { borderBottomWidth: 0.5, borderBottomColor: "#E5E7EB" },

  timeTop: {
    backgroundColor: "#FFFFFF",
    borderRightWidth: 0.5, borderRightColor: "#E5E7EB",
  },
  timeCell: {
    backgroundColor: "#FFFFFF",
    borderRightWidth: 0.5, borderRightColor: "#E5E7EB",
    alignItems: "center", justifyContent: "flex-start", paddingTop: 4,
  },
  timeText: { fontSize: 9, fontFamily: "Inter_400Regular", color: "#D1D5DB" },

  dayHeader: {
    alignItems: "center", justifyContent: "center",
    borderLeftWidth: 0.5, borderLeftColor: "#E5E7EB",
    backgroundColor: "#FFFFFF", paddingVertical: 6,
  },
  dayHeaderToday: { backgroundColor: "#F0FFFE" },
  dayHeaderDate:  { fontSize: 9, fontFamily: "Inter_400Regular", color: "#D1D5DB", lineHeight: 12 },
  dayHeaderText:  { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", lineHeight: 15 },

  cell: {
    borderLeftWidth: 0.5, borderLeftColor: "#E5E7EB",
    borderBottomWidth: 0.5, borderBottomColor: "#E5E7EB",
    padding: 2, gap: 2, backgroundColor: "#FFFFFF",
  },

  card: {
    borderRadius: 4, padding: 2, paddingLeft: 6,
    minHeight: 30, justifyContent: "center",
    borderWidth: 1, overflow: "hidden", gap: 1,
  },
  accentBar:  { position: "absolute", left: 0, top: 0, bottom: 0, width: 3 },
  checkBox:   {
    position: "absolute", top: 2, right: 2, width: 12, height: 12,
    borderRadius: 6, borderWidth: 1, alignItems: "center", justifyContent: "center",
  },
  changeDot:  {
    position: "absolute", top: 3, right: 3, width: 5, height: 5,
    borderRadius: 3, backgroundColor: "#FCD34D", zIndex: 10,
  },

  cardName:     { fontSize: 9, fontFamily: "Inter_500Medium", color: "#111827", lineHeight: 12 },
  cardStudents: { fontSize: 8, fontFamily: "Inter_400Regular", color: "#9CA3AF", lineHeight: 11 },
  cardAtt:      { fontSize: 8, fontFamily: "Inter_400Regular", lineHeight: 11 },
  attDone:      { color: "#059669" },
  attPend:      { color: "#D97706" },
});
