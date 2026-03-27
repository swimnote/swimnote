/**
 * WeeklyTimetableV2 — 슬림 운영형 (최종 확정)
 *
 * 카드 구조:
 *   [accent bar] 반 이름 (10px Bold)
 *                학생 이름 · 학생 이름 (9px)
 *                ● checked/total  ← 오늘 컬럼만 표시
 *
 * 레이아웃:
 *   [주중 섹션] 왼쪽 시간축(13~22) + 월·화·수·목·금
 *   [주말 섹션] 왼쪽 시간축(07~16) + 토·일
 *   세로 스크롤만 (가로 스크롤 없음)
 */
import { Feather } from "@expo/vector-icons";
import React, { useMemo } from "react";
import {
  Dimensions, Pressable, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import Colors from "@/constants/colors";
import { SlotStatus, TeacherClassGroup } from "@/components/teacher/WeeklySchedule";
import {
  ChangeLogItem, StudentItem, WT_ROW_H,
  addDaysStr, classColor, getWeekDates, parseHour, todayDateStr,
  WEEKDAY_HOURS, SAT_HOURS,
} from "./utils";

const C        = Colors.light;
const SCREEN_W = Dimensions.get("window").width;
const TIME_W   = 32;
const WD_COL_W = Math.floor((SCREEN_W - TIME_W) / 5);
const WE_COL_W = Math.floor((SCREEN_W - TIME_W) / 2);

const WEEKDAYS = ["월", "화", "수", "목", "금"];
const WEEKEND  = ["토", "일"];

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

  /* 반 ID → 학생 이름 배열 */
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

  /* 날짜 정보 */
  const dateInfo = useMemo(() => {
    const m: Record<string, { label: string; isToday: boolean; dateStr: string }> = {};
    weekDates.forEach(({ koDay, dateStr, label }) => {
      m[koDay] = { label, isToday: dateStr === today, dateStr };
    });
    return m;
  }, [weekDates, today]);

  /* groups 기반 동적 시간축 계산 */
  const { wdHours, weHours } = useMemo(() => {
    const wdTimes: number[] = [];
    const weTimes: number[] = [];
    groups.forEach(g => {
      const days = g.schedule_days.split(",").map(d => d.trim());
      const h = parseHour(g.schedule_time);
      const isWd = WEEKDAYS.some(d => days.includes(d));
      const isWe = ["토", "일"].some(d => days.includes(d));
      if (isWd) wdTimes.push(h);
      if (isWe) weTimes.push(h);
    });
    function toRange(times: number[], fallback: number[]) {
      if (!times.length) return fallback;
      const min = Math.max(6, Math.min(...times));
      const max = Math.min(23, Math.max(...times));
      return Array.from({ length: max - min + 1 }, (_, i) => i + min);
    }
    return {
      wdHours: toRange(wdTimes, WEEKDAY_HOURS),
      weHours: toRange(weTimes, SAT_HOURS),
    };
  }, [groups]);

  /* 셀 맵 */
  const cellMap = useMemo(() => {
    const map: Record<string, TeacherClassGroup[]> = {};
    weekDates.forEach(({ koDay }) => {
      const hours = WEEKDAYS.includes(koDay) ? wdHours : weHours;
      hours.forEach(h => {
        const key = `${koDay}-${h}`;
        map[key] = groups.filter(g => {
          const days = g.schedule_days.split(",").map(d => d.trim());
          return days.includes(koDay) && parseHour(g.schedule_time) === h;
        });
      });
    });
    return map;
  }, [groups, weekDates, wdHours, weHours]);

  /* ── 슬림 운영형 카드 ── */
  function renderCard(g: TeacherClassGroup, isToday: boolean) {
    const selected   = selectedIds.has(g.id);
    const accent     = classColor(g.id);
    const hasDot     = changedClassIds.has(g.id);
    const cardBg     = g.color && g.color !== "#FFFFFF" ? g.color : "#FFFFFF";
    const cardBdr    = cardBg === "#FFFFFF" ? "#E5E7EB" : "transparent";

    /* 학생 이름 한 줄 */
    const names      = classStudentMap[g.id] ?? [];
    const namesLine  = names.length > 0 ? names.join(" · ") : null;

    /* 출결 (오늘만) */
    const total      = g.student_count;
    const checked    = isToday ? (statusMap[g.id]?.attChecked ?? 0) : null;
    const attDone    = checked !== null && total > 0 && checked >= total;

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
            {selected && <Feather name="check" size={7} color="#fff" />}
          </View>
        )}
        <View style={[wt.accentBar, { backgroundColor: accent }]} />

        {/* 반 이름 */}
        <Text style={wt.cardName} numberOfLines={1}>{g.name}</Text>

        {/* 학생 이름 */}
        {namesLine ? (
          <Text style={wt.cardStudents} numberOfLines={1}>{namesLine}</Text>
        ) : total > 0 ? (
          <Text style={wt.cardStudents}>{total}명</Text>
        ) : null}

        {/* 출결 (오늘만) */}
        {checked !== null && total > 0 && (
          <Text style={[wt.cardAtt, attDone ? wt.attDone : wt.attPend]}>
            ● {checked}/{total}
          </Text>
        )}
      </Pressable>
    );
  }

  /* ── 섹션 렌더 ── */
  function renderSection(
    days:       string[],
    hours:      number[],
    colW:       number,
    badge:      string,
    badgeColor: string,
    badgeBg:    string,
  ) {
    return (
      <View>
        {/* 섹션 배지 */}
        <View style={wt.badgeRow}>
          <View style={[wt.badge, { backgroundColor: badgeBg }]}>
            <Text style={[wt.badgeText, { color: badgeColor }]}>{badge}</Text>
          </View>
        </View>

        {/* 요일 헤더 */}
        <View style={[wt.gridRow, wt.headerRow]}>
          <View style={[wt.timeTop, { width: TIME_W }]} />
          {days.map(day => {
            const info = dateInfo[day] ?? { label: "", isToday: false };
            return (
              <View key={day}
                style={[wt.dayHeader, { width: colW },
                  info.isToday && wt.dayHeaderToday]}>
                <Text style={[wt.dayHeaderDate, info.isToday && { color: C.tint }]}>
                  {info.label}
                </Text>
                <Text style={[wt.dayHeaderText,
                  info.isToday && { color: "#2EC4B6", fontFamily: "Inter_500Medium" }]}>
                  {day}
                </Text>
              </View>
            );
          })}
        </View>

        {/* 시간 행 */}
        {hours.map(h => (
          <View key={h} style={[wt.gridRow, { height: WT_ROW_H }]}>
            {/* 시간축 */}
            <View style={[wt.timeCell, { width: TIME_W }]}>
              <Text style={wt.timeText}>{h}</Text>
            </View>
            {/* 셀 */}
            {days.map(day => {
              const info  = dateInfo[day] ?? { isToday: false };
              const cls   = cellMap[`${day}-${h}`] ?? [];
              const isSun = day === "일";
              return (
                <View key={day}
                  style={[wt.cell, { width: colW, height: WT_ROW_H },
                    isSun && wt.cellSunday]}>
                  {cls.map(g => renderCard(g, info.isToday))}
                </View>
              );
            })}
          </View>
        ))}

        {/* 일요일 휴무 레이블 (클래스 없을 때) */}
        {days.includes("일") && !hours.some(h => (cellMap[`일-${h}`] ?? []).length > 0) && (
          <SundayLabel
            sundayIdx={days.indexOf("일")}
            colW={colW}
            timeW={TIME_W}
            headerH={46}
            rowH={WT_ROW_H}
            totalRows={hours.length}
          />
        )}
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* 주간 네비게이션 */}
      <View style={wt.weekNav}>
        <Pressable style={wt.weekNavBtn} onPress={onPrevWeek}>
          <Feather name="chevron-left" size={20} color={C.text} />
        </Pressable>
        <Text style={wt.weekNavTitle}>
          {(() => {
            const s  = new Date(weekStart + "T12:00:00Z");
            const e  = addDaysStr(weekStart, 6);
            const ed = new Date(e + "T12:00:00Z");
            return `${s.getUTCMonth()+1}월 ${s.getUTCDate()}일 ~ ${ed.getUTCMonth()+1}월 ${ed.getUTCDate()}일`;
          })()}
        </Text>
        <Pressable style={wt.weekNavBtn} onPress={onNextWeek}>
          <Feather name="chevron-right" size={20} color={C.text} />
        </Pressable>
      </View>

      {/* ── 디버그 배너 (확인 후 제거) ── */}
      <View style={{ backgroundColor: "#2EC4B6", paddingVertical: 4, alignItems: "center" }}>
        <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff", letterSpacing: 1 }}>
          REAL_WEEKLY_V2
        </Text>
      </View>

      {/* 그리드 */}
      <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
        {renderSection(
          WEEKDAYS, wdHours, WD_COL_W,
          `주중  ${wdHours[0] ?? 13} – ${(wdHours[wdHours.length - 1] ?? 22)}시`,
          "#1F6FAE", "#EFF6FF",
        )}
        <View style={wt.sectionDivider} />
        {renderSection(
          WEEKEND, weHours, WE_COL_W,
          `주말  ${weHours[0] ?? 7} – ${(weHours[weHours.length - 1] ?? 16)}시`,
          "#92400E", "#FEF3C7",
        )}
        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

/* 일요일 휴무 absolute 레이블 */
function SundayLabel({
  sundayIdx, colW, timeW, headerH, rowH, totalRows,
}: {
  sundayIdx: number; colW: number; timeW: number;
  headerH: number; rowH: number; totalRows: number;
}) {
  const left = timeW + sundayIdx * colW + colW / 2;
  const top  = headerH + (totalRows * rowH) / 2 - 12;
  return (
    <View
      style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}
      pointerEvents="none"
    >
      <View style={[wt.closedPill, { position: "absolute", top, left: left - 28 }]}>
        <Text style={wt.closedPillText}>🌙 휴무</Text>
      </View>
    </View>
  );
}

const wt = StyleSheet.create({
  weekNav:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                  paddingHorizontal: 8, paddingVertical: 5, backgroundColor: "#FAFBFC",
                  borderBottomWidth: 0.5, borderBottomColor: "#E5E7EB" },
  weekNavBtn:   { padding: 8 },
  weekNavTitle: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#111827" },

  /* 섹션 배지 */
  badgeRow:  { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 3 },
  badge:     { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  badgeText: { fontSize: 10, fontFamily: "Inter_500Medium" },

  /* 그리드 */
  gridRow:   { flexDirection: "row" },
  headerRow: { borderBottomWidth: 0.5, borderBottomColor: "#E5E7EB" },

  /* 시간축 */
  timeTop:   { height: 42, backgroundColor: "#FAFBFC",
               borderRightWidth: 0.5, borderRightColor: "#E5E7EB" },
  timeCell:  { backgroundColor: "#FAFBFC", borderRightWidth: 0.5, borderRightColor: "#E5E7EB",
               alignItems: "center", justifyContent: "flex-start", paddingTop: 5 },
  timeText:  { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9CA3AF" },

  /* 요일 헤더 */
  dayHeader:      { height: 42, alignItems: "center", justifyContent: "center",
                    borderLeftWidth: 0.5, borderLeftColor: "#E5E7EB", backgroundColor: "#FAFBFC" },
  dayHeaderToday: { backgroundColor: "#2EC4B614" },
  dayHeaderDate:  { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9CA3AF", lineHeight: 13 },
  dayHeaderText:  { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", lineHeight: 14 },

  /* 셀 */
  cell:       { borderLeftWidth: 0.5, borderLeftColor: "#E5E7EB",
                borderBottomWidth: 0.5, borderBottomColor: "#E5E7EB",
                padding: 2, gap: 2, backgroundColor: "#FFFFFF" },
  cellSunday: { backgroundColor: "#FAFBFC" },

  /* 슬림 운영형 카드 */
  card:         { borderRadius: 7, padding: 3, paddingLeft: 7,
                  minHeight: 38, justifyContent: "center",
                  borderWidth: 1, overflow: "hidden", gap: 1 },
  accentBar:    { position: "absolute", left: 0, top: 0, bottom: 0, width: 3 },
  checkBox:     { position: "absolute", top: 2, right: 2, width: 13, height: 13,
                  borderRadius: 7, borderWidth: 1,
                  alignItems: "center", justifyContent: "center" },
  changeDot:    { position: "absolute", top: 3, right: 3, width: 6, height: 6,
                  borderRadius: 3, backgroundColor: "#FCD34D",
                  borderWidth: 1, borderColor: "#D97706", zIndex: 10 },

  cardName:     { fontSize: 10, fontFamily: "Inter_500Medium", color: "#111827", lineHeight: 13 },
  cardStudents: { fontSize: 8.5, fontFamily: "Inter_400Regular", color: "#6B7280", lineHeight: 12 },
  cardAtt:      { fontSize: 8, fontFamily: "Inter_500Medium", lineHeight: 11 },
  attDone:      { color: "#059669" },
  attPend:      { color: "#D97706" },

  /* 구분선 */
  sectionDivider: { height: 6, backgroundColor: "#F3F4F6", marginVertical: 4 },

  /* 휴무 */
  closedPill:     { backgroundColor: "#FEF3C7", paddingHorizontal: 8, paddingVertical: 3,
                    borderRadius: 10, borderWidth: 1, borderColor: "#F59E0B" },
  closedPillText: { fontSize: 10, fontFamily: "Inter_400Regular", color: "#92400E" },
});
