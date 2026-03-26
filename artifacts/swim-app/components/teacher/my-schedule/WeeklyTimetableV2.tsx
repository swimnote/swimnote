/**
 * WeeklyTimetableV2 — 시안 버전
 *
 * 구조:
 *   [주중 섹션] 왼쪽 시간축(13~22) + 월·화·수·목·금 (5열)
 *   [주말 섹션] 왼쪽 시간축(07~16) + 토·일 (2열)
 *
 * 변경 포인트 vs V1:
 *   - 셀 내부 시간 레이블 제거 → 좌측 공유 시간축만 표시
 *   - 가로 스크롤 없음 → 화면 전체 폭 분할
 *   - 주중 / 주말 섹션 분리 → 각 섹션에 자체 시간축
 */
import { Feather } from "@expo/vector-icons";
import React, { useMemo } from "react";
import {
  Dimensions, Pressable, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import Colors from "@/constants/colors";
import { TeacherClassGroup } from "@/components/teacher/WeeklySchedule";
import {
  ChangeLogItem, WT_ROW_H,
  addDaysStr, classColor, getWeekDates, parseHour, todayDateStr,
  WEEKDAY_HOURS, SAT_HOURS,
} from "./utils";

const C        = Colors.light;
const SCREEN_W = Dimensions.get("window").width;
const TIME_W   = 32;                                        // 좌측 시간축 폭
const WD_COL_W = Math.floor((SCREEN_W - TIME_W) / 5);     // 평일 1열 폭 ≈ 68 px
const WE_COL_W = Math.floor((SCREEN_W - TIME_W) / 2);     // 주말 1열 폭 ≈ 171 px

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
}

export default function WeeklyTimetableV2({
  groups, onSelectClass, selectionMode, selectedIds, toggleSelect,
  weekStart, changeLogs, onPrevWeek, onNextWeek,
}: Props) {
  const today    = todayDateStr();
  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);

  const changedClassIds = useMemo(
    () => new Set(changeLogs.map(l => l.class_group_id)),
    [changeLogs],
  );

  const dateInfo = useMemo(() => {
    const m: Record<string, { label: string; isToday: boolean }> = {};
    weekDates.forEach(({ koDay, dateStr, label }) => {
      m[koDay] = { label, isToday: dateStr === today };
    });
    return m;
  }, [weekDates, today]);

  const cellMap = useMemo(() => {
    const map: Record<string, TeacherClassGroup[]> = {};
    weekDates.forEach(({ koDay }) => {
      const hours = WEEKDAYS.includes(koDay) ? WEEKDAY_HOURS : SAT_HOURS;
      hours.forEach(h => {
        const key = `${koDay}-${h}`;
        map[key] = groups.filter(g => {
          const days = g.schedule_days.split(",").map(d => d.trim());
          return days.includes(koDay) && parseHour(g.schedule_time) === h;
        });
      });
    });
    return map;
  }, [groups, weekDates]);

  function renderCard(g: TeacherClassGroup) {
    const selected = selectedIds.has(g.id);
    const accent   = classColor(g.id);
    const hasDot   = changedClassIds.has(g.id);
    const cardBg   = g.color && g.color !== "#FFFFFF" ? g.color : "#FFFFFF";
    const cardBdr  = cardBg === "#FFFFFF" ? "#E5E7EB" : "transparent";
    return (
      <Pressable
        key={g.id}
        style={[wt.card, { backgroundColor: cardBg, borderColor: cardBdr, opacity: selected ? 0.75 : 1 }]}
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
        <Text style={wt.cardName} numberOfLines={3}>{g.name}</Text>
      </Pressable>
    );
  }

  function renderSection(
    days: string[],
    hours: number[],
    colW: number,
    badge: string,
    badgeColor: string,
    badgeBg: string,
  ) {
    return (
      <View>
        {/* ── 섹션 배지 ── */}
        <View style={wt.sectionBadgeRow}>
          <View style={[wt.sectionBadge, { backgroundColor: badgeBg }]}>
            <Text style={[wt.sectionBadgeText, { color: badgeColor }]}>{badge}</Text>
          </View>
        </View>

        {/* ── 요일 헤더 ── */}
        <View style={[wt.gridRow, wt.headerRow]}>
          <View style={[wt.timeAxisTop, { width: TIME_W }]} />
          {days.map(day => {
            const info = dateInfo[day] ?? { label: "", isToday: false };
            return (
              <View key={day} style={[wt.dayHeader, { width: colW },
                info.isToday && { backgroundColor: C.tint + "14" }]}>
                <Text style={[wt.dayHeaderDate, info.isToday && { color: C.tint }]}>{info.label}</Text>
                <Text style={[wt.dayHeaderText, info.isToday && { color: C.tint, fontFamily: "Inter_700Bold" }]}>
                  {day}
                </Text>
              </View>
            );
          })}
        </View>

        {/* ── 시간 행 ── */}
        {hours.map(h => (
          <View key={h} style={[wt.gridRow, { height: WT_ROW_H }]}>
            {/* 시간축 */}
            <View style={[wt.timeAxis, { width: TIME_W }]}>
              <Text style={wt.timeAxisText}>{h}</Text>
            </View>

            {/* 요일 셀 */}
            {days.map(day => {
              const cls    = cellMap[`${day}-${h}`] ?? [];
              const isSun  = day === "일";
              return (
                <View key={day} style={[wt.cell, { width: colW },
                  isSun && wt.cellSunday]}>
                  {cls.map(g => renderCard(g))}
                </View>
              );
            })}
          </View>
        ))}

        {/* 일요일 휴무 오버레이 텍스트 (맨 첫 행에 표시) */}
        {days.includes("일") && (
          <SundayClosedLabel
            colW={colW}
            timeW={TIME_W}
            totalCols={days.length}
            sundayIdx={days.indexOf("일")}
            rowH={WT_ROW_H}
            hours={hours}
            hasSundayClasses={hours.some(h => (cellMap[`일-${h}`] ?? []).length > 0)}
          />
        )}
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* ── 주간 네비게이션 ── */}
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

      {/* ── 그리드 (세로 스크롤) ── */}
      <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
        {renderSection(
          WEEKDAYS, WEEKDAY_HOURS, WD_COL_W,
          "주중  13 – 22시", "#1F6FAE", "#EFF6FF",
        )}

        <View style={wt.sectionDivider} />

        {renderSection(
          WEEKEND, SAT_HOURS, WE_COL_W,
          "주말  07 – 16시", "#92400E", "#FEF3C7",
        )}
        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

/* 일요일 휴무 텍스트 오버레이 (데이터 없을 때만) */
function SundayClosedLabel({
  colW, timeW, totalCols, sundayIdx, rowH, hours, hasSundayClasses,
}: {
  colW: number; timeW: number; totalCols: number; sundayIdx: number;
  rowH: number; hours: number[]; hasSundayClasses: boolean;
}) {
  if (hasSundayClasses) return null;
  const leftOffset = timeW + sundayIdx * colW;
  const topOffset  = 46 + Math.floor(hours.length / 2) * rowH;
  return (
    <View style={{ position: "absolute", left: leftOffset, top: topOffset, width: colW, alignItems: "center" }} pointerEvents="none">
      <View style={wt.closedPill}>
        <Feather name="moon" size={10} color="#92400E" />
        <Text style={wt.closedPillText}>휴무</Text>
      </View>
    </View>
  );
}

const wt = StyleSheet.create({
  weekNav:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                  paddingHorizontal: 8, paddingVertical: 6,
                  borderBottomWidth: 1, borderBottomColor: C.border },
  weekNavBtn:   { padding: 8 },
  weekNavTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.text },

  /* ── 섹션 배지 ── */
  sectionBadgeRow:  { paddingHorizontal: 10, paddingTop: 10, paddingBottom: 4 },
  sectionBadge:     { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3,
                      borderRadius: 10 },
  sectionBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },

  /* ── 그리드 row ── */
  gridRow:       { flexDirection: "row" },
  headerRow:     { borderBottomWidth: 1, borderBottomColor: C.border },

  /* ── 시간축 ── */
  timeAxisTop:   { backgroundColor: "#FBF8F6", borderRightWidth: 1, borderRightColor: C.border },
  timeAxis:      { backgroundColor: "#FBF8F6", borderRightWidth: 1, borderRightColor: C.border,
                   alignItems: "center", justifyContent: "flex-start", paddingTop: 5 },
  timeAxisText:  { fontSize: 10, fontFamily: "Inter_400Regular", color: "#B0A89D" },

  /* ── 요일 헤더 ── */
  dayHeader:     { height: 46, alignItems: "center", justifyContent: "center",
                   borderLeftWidth: 1, borderLeftColor: C.border, backgroundColor: "#FBF8F6" },
  dayHeaderDate: { fontSize: 10, fontFamily: "Inter_400Regular", color: C.textMuted, lineHeight: 13 },
  dayHeaderText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.text, lineHeight: 15 },

  /* ── 셀 ── */
  cell:          { borderLeftWidth: 1, borderLeftColor: "#EAE7E2",
                   borderBottomWidth: 1, borderBottomColor: "#F0EDE9",
                   padding: 2, gap: 2 },
  cellSunday:    { backgroundColor: "#FAFAFA" },

  /* ── 반 카드 ── */
  card:          { borderRadius: 5, paddingVertical: 4, paddingHorizontal: 5, paddingLeft: 7,
                   minHeight: 32, justifyContent: "center", borderWidth: 1, overflow: "hidden" },
  cardName:      { fontSize: 9, fontFamily: "Inter_600SemiBold", color: "#111827", lineHeight: 12 },
  accentBar:     { position: "absolute", left: 0, top: 0, bottom: 0, width: 3 },
  checkBox:      { position: "absolute", top: 2, right: 2, width: 13, height: 13,
                   borderRadius: 7, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  changeDot:     { position: "absolute", top: 3, right: 3, width: 6, height: 6,
                   borderRadius: 3, backgroundColor: "#FCD34D",
                   borderWidth: 1, borderColor: "#D97706", zIndex: 10 },

  /* ── 구분선 / 휴무 ── */
  sectionDivider: { height: 8, backgroundColor: "#F0EDE9", marginVertical: 4 },
  closedPill:     { flexDirection: "row", alignItems: "center", gap: 3,
                    backgroundColor: "#FEF3C7", paddingHorizontal: 8, paddingVertical: 4,
                    borderRadius: 12, borderWidth: 1, borderColor: "#F59E0B" },
  closedPillText: { fontSize: 10, fontFamily: "Inter_500Medium", color: "#92400E" },
});
