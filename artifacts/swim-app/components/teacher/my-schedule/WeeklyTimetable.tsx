import { Feather } from "@expo/vector-icons";
import React, { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { TeacherClassGroup } from "@/components/teacher/WeeklySchedule";
import {
  ChangeLogItem, WT_COL_W, WT_ROW_H,
  addDaysStr, classColor, getDayHours, getWeekDates, parseHour, todayDateStr,
} from "./utils";

const C = Colors.light;

export default function WeeklyTimetable({
  groups, onSelectClass, selectionMode, selectedIds, toggleSelect,
  weekStart, changeLogs, onPrevWeek, onNextWeek,
}: {
  groups: TeacherClassGroup[];
  onSelectClass: (g: TeacherClassGroup) => void;
  selectionMode: boolean;
  selectedIds: Set<string>;
  toggleSelect: (id: string) => void;
  weekStart: string;
  changeLogs: ChangeLogItem[];
  onPrevWeek: () => void;
  onNextWeek: () => void;
}) {
  const today = todayDateStr();
  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);

  const changedClassIds = useMemo(
    () => new Set(changeLogs.map(l => l.class_group_id)),
    [changeLogs],
  );

  const cellClasses = useMemo(() => {
    const map: Record<string, TeacherClassGroup[]> = {};
    weekDates.forEach(({ koDay }) => {
      getDayHours(koDay).forEach(h => {
        const key = `${koDay}-${h}`;
        map[key] = groups.filter(g => {
          const days = g.schedule_days.split(",").map(d => d.trim());
          return days.includes(koDay) && parseHour(g.schedule_time) === h;
        });
      });
    });
    return map;
  }, [groups, weekDates]);

  return (
    <View style={{ flex: 1 }}>
      {/* ── 주간 네비게이션 ── */}
      <View style={wt.weekNav}>
        <Pressable style={wt.weekNavBtn} onPress={onPrevWeek}>
          <Feather name="chevron-left" size={20} color={C.text} />
        </Pressable>
        <Text style={wt.weekNavTitle}>
          {(() => {
            const s = new Date(weekStart + "T12:00:00Z");
            const e = addDaysStr(weekStart, 6);
            const ed = new Date(e + "T12:00:00Z");
            return `${s.getUTCMonth()+1}월 ${s.getUTCDate()}일 ~ ${ed.getUTCMonth()+1}월 ${ed.getUTCDate()}일`;
          })()}
        </Text>
        <Pressable style={wt.weekNavBtn} onPress={onNextWeek}>
          <Feather name="chevron-right" size={20} color={C.text} />
        </Pressable>
      </View>

      {/* ── 주간 그리드 ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={wt.outer}>
        <ScrollView showsVerticalScrollIndicator={false} style={wt.inner}>
          <View style={{ flexDirection: "row" }}>
            {weekDates.map(({ koDay, dateStr, label }) => {
              const isToday  = dateStr === today;
              const dayHours = getDayHours(koDay);

              return (
                <View key={koDay} style={[wt.dayCol, { width: WT_COL_W }]}>
                  {/* 요일 헤더 */}
                  <View style={[wt.dayHeader, isToday && wt.dayHeaderToday]}>
                    <Text style={[wt.dayHeaderDate, isToday && { color: C.tint }]}>{label}</Text>
                    <Text style={[wt.dayHeaderText, isToday && { color: C.tint, fontFamily: "Inter_700Bold" }]}>
                      {koDay}
                    </Text>
                    {/* 운영 시간 범위 표시 */}
                    {dayHours.length > 0 && (
                      <Text style={wt.dayRangeLabel}>
                        {dayHours[0]}–{dayHours[dayHours.length - 1]}시
                      </Text>
                    )}
                  </View>

                  {/* 시간 슬롯 */}
                  {dayHours.length === 0 ? (
                    <View style={wt.closedCol}>
                      <Feather name="moon" size={14} color={C.textMuted} />
                      <Text style={wt.closedTxt}>휴무</Text>
                    </View>
                  ) : (
                    dayHours.map(h => {
                      const cls = cellClasses[`${koDay}-${h}`] ?? [];
                      return (
                        <View key={h} style={[wt.hourRow, { height: WT_ROW_H }]}>
                          {/* 시간 레이블 */}
                          <Text style={wt.hourLabel}>{h}:00</Text>

                          {/* 반 카드 영역 */}
                          <View style={wt.hourCards}>
                            {cls.map(g => {
                              const selected = selectedIds.has(g.id);
                              const accentBg = classColor(g.id);
                              const hasDot   = changedClassIds.has(g.id);
                              const cardBg   = g.color && g.color !== "#FFFFFF" ? g.color : "#FFFFFF";
                              const cardBdr  = cardBg === "#FFFFFF" ? "#E5E7EB" : "transparent";
                              return (
                                <Pressable
                                  key={g.id}
                                  style={[wt.classCard, {
                                    backgroundColor: cardBg,
                                    borderColor:     cardBdr,
                                    opacity:         selected ? 0.78 : 1,
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
                                      {selected && <Feather name="check" size={8} color="#fff" />}
                                    </View>
                                  )}
                                  <View style={[wt.accentBar, { backgroundColor: accentBg }]} />
                                  <Text style={wt.cardName} numberOfLines={2}>{g.name}</Text>
                                  <Text style={wt.cardTime} numberOfLines={1}>{g.schedule_time}</Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        </View>
                      );
                    })
                  )}
                </View>
              );
            })}
          </View>
          <View style={{ height: 120 }} />
        </ScrollView>
      </ScrollView>
    </View>
  );
}

const wt = StyleSheet.create({
  weekNav:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                   paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border },
  weekNavBtn:    { padding: 8 },
  weekNavTitle:  { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.text },
  outer:         { flex: 1 },
  inner:         { flex: 1 },

  /* ── 요일 컬럼 ── */
  dayCol:        { borderRightWidth: 1, borderRightColor: C.border },
  dayHeader:     { height: 52, alignItems: "center", justifyContent: "center", paddingVertical: 4,
                   borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: "#FBF8F6" },
  dayHeaderToday:{ backgroundColor: C.tint + "0F" },
  dayHeaderDate: { fontSize: 10, fontFamily: "Inter_400Regular", color: C.textMuted, lineHeight: 13 },
  dayHeaderText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.text, lineHeight: 16 },
  dayRangeLabel: { fontSize: 8, fontFamily: "Inter_400Regular", color: C.textMuted, lineHeight: 11, marginTop: 1 },

  /* ── 휴무 ── */
  closedCol:     { alignItems: "center", paddingTop: 28, gap: 6 },
  closedTxt:     { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textMuted },

  /* ── 시간 row (컬럼 내부) ── */
  hourRow:       { borderBottomWidth: 1, borderBottomColor: "#F0EDE9", padding: 2 },
  hourLabel:     { fontSize: 8, fontFamily: "Inter_400Regular", color: "#C4B5A5",
                   lineHeight: 10, marginBottom: 2 },
  hourCards:     { gap: 2 },

  /* ── 반 카드 ── */
  classCard:     { borderRadius: 6, padding: 4, paddingLeft: 8, minHeight: 34,
                   justifyContent: "center", borderWidth: 1, overflow: "hidden" },
  cardName:      { fontSize: 9, fontFamily: "Inter_600SemiBold", color: "#111827", lineHeight: 12 },
  cardTime:      { fontSize: 8, fontFamily: "Inter_400Regular", color: "#374151", marginTop: 1 },
  accentBar:     { position: "absolute", left: 0, top: 0, bottom: 0, width: 3 },
  checkBox:      { position: "absolute", top: 3, right: 3, width: 14, height: 14,
                   borderRadius: 7, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  changeDot:     { position: "absolute", top: 4, right: 4, width: 7, height: 7,
                   borderRadius: 4, backgroundColor: "#FCD34D", borderWidth: 1,
                   borderColor: "#D97706", zIndex: 10 },
});
