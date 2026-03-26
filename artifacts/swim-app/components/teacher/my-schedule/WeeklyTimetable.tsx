import { Feather } from "@expo/vector-icons";
import React, { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { TeacherClassGroup } from "@/components/teacher/WeeklySchedule";
import {
  ChangeLogItem, FIXED_HOURS, WT_COL_W, WT_ROW_H, WT_TIME_W,
  addDaysStr, classColor, getWeekDates, parseHour, todayDateStr,
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

  const changedClassIds = useMemo(() => new Set(changeLogs.map(l => l.class_group_id)), [changeLogs]);

  const cellClasses = useMemo(() => {
    const map: Record<string, TeacherClassGroup[]> = {};
    weekDates.forEach(({ koDay }) => {
      FIXED_HOURS.forEach(h => {
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

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={wt.outer}>
        <ScrollView showsVerticalScrollIndicator={false} style={wt.inner}>
          <View>
            <View style={wt.headerRow}>
              <View style={[wt.timeCell, wt.header]} />
              {weekDates.map(({ koDay, dateStr, label }) => {
                const isToday = dateStr === today;
                return (
                  <View key={koDay} style={[wt.dayHeader, { width: WT_COL_W }]}>
                    <Text style={[wt.dayHeaderDate, isToday && { color: C.tint }]}>{label}</Text>
                    <Text style={[wt.dayHeaderText, isToday && { color: C.tint, fontFamily: "Inter_700Bold" }]}>{koDay}</Text>
                  </View>
                );
              })}
            </View>

            {FIXED_HOURS.map(h => (
              <View key={h} style={[wt.row, { height: WT_ROW_H }]}>
                <View style={wt.timeCell}>
                  <Text style={wt.timeText}>{h}:00</Text>
                </View>
                {weekDates.map(({ koDay }) => {
                  const cls = cellClasses[`${koDay}-${h}`] ?? [];
                  return (
                    <View key={koDay} style={[wt.cell, { width: WT_COL_W }]}>
                      {cls.map(g => {
                        const selected = selectedIds.has(g.id);
                        const bg = classColor(g.id);
                        const hasDot = changedClassIds.has(g.id);
                        const cardBg = g.color || "#F1F5F9";
                        const cardBorder = !g.color || g.color === "#FFFFFF" ? "#E5E7EB" : "transparent";
                        return (
                          <Pressable key={g.id}
                            style={[wt.classCard, { backgroundColor: cardBg, borderColor: cardBorder, opacity: selected ? 0.8 : 1 }]}
                            onPress={() => selectionMode ? toggleSelect(g.id) : onSelectClass(g)}
                            onLongPress={() => toggleSelect(g.id)}>
                            {hasDot && <View style={wt.changeDot} />}
                            {selectionMode && (
                              <View style={[wt.checkBox, { borderColor: "#374151", backgroundColor: selected ? "#374151" : "transparent" }]}>
                                {selected && <Feather name="check" size={8} color="#fff" />}
                              </View>
                            )}
                            <View style={[wt.accentBar, { backgroundColor: bg }]} />
                            <Text style={wt.cardName} numberOfLines={2}>{g.name}</Text>
                            <Text style={wt.cardTime} numberOfLines={1}>{g.schedule_time}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  );
                })}
              </View>
            ))}
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
  headerRow:     { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.border },
  header:        { backgroundColor: "#FBF8F6" },
  dayHeader:     { height: 44, alignItems: "center", justifyContent: "center", paddingVertical: 4,
                   borderLeftWidth: 1, borderLeftColor: C.border, backgroundColor: "#FBF8F6" },
  dayHeaderDate: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textMuted, lineHeight: 14 },
  dayHeaderText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.text, lineHeight: 16 },
  row:           { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#F0EDE9" },
  timeCell:      { width: WT_TIME_W, alignItems: "center", justifyContent: "flex-start",
                   paddingTop: 4, borderRightWidth: 1, borderRightColor: C.border, backgroundColor: "#FBF8F6" },
  timeText:      { fontSize: 10, fontFamily: "Inter_400Regular", color: C.textMuted },
  cell:          { borderLeftWidth: 1, borderLeftColor: "#EAE7E2", padding: 2, gap: 2 },
  classCard:     { flex: 1, borderRadius: 6, padding: 4, paddingLeft: 7, minHeight: 44, justifyContent: "center", borderWidth: 1, overflow: "hidden" },
  cardName:      { fontSize: 9, fontFamily: "Inter_600SemiBold", color: "#111827", lineHeight: 12 },
  cardTime:      { fontSize: 8, fontFamily: "Inter_400Regular", color: "#374151", marginTop: 2 },
  accentBar:     { position: "absolute", left: 0, top: 0, bottom: 0, width: 3 },
  checkBox:      { position: "absolute", top: 3, right: 3, width: 14, height: 14,
                   borderRadius: 7, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  changeDot:     { position: "absolute", top: 4, right: 4, width: 7, height: 7,
                   borderRadius: 4, backgroundColor: "#FCD34D", borderWidth: 1, borderColor: "#D97706", zIndex: 10 },
});
