import { Check, ChevronLeft, ChevronRight } from "lucide-react-native";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { TeacherClassGroup } from "@/components/teacher/types";
import {
  SCREEN_W, WEEKDAY_NAMES, classesForDate, fmtHour,
  parseHour, todayDateStr,
} from "./utils";

const C = Colors.light;

export default function MonthlyCalendar({
  groups, themeColor, selectedDate, onSelectDate, memoDateSet,
  selectionMode, selectedDates,
}: {
  groups: TeacherClassGroup[];
  themeColor: string;
  selectedDate: string | null;
  onSelectDate: (dateStr: string) => void;
  memoDateSet: Set<string>;
  selectionMode?: boolean;
  selectedDates?: Set<string>;
}) {
  const today = todayDateStr();
  const { token, adminUser } = useAuth();
  const poolId = (adminUser as any)?.swimming_pool_id || "";
  const [offset, setOffset] = useState(0);
  const [holidayDates, setHolidayDates] = useState<Set<string>>(new Set());

  const { year, month, days } = useMemo(() => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const y = d.getFullYear(); const m = d.getMonth() + 1;
    const firstDay = new Date(y, m - 1, 1).getDay();
    const daysInMonth = new Date(y, m, 0).getDate();
    const cells: (string | null)[] = Array(firstDay).fill(null);
    for (let i = 1; i <= daysInMonth; i++)
      cells.push(`${y}-${String(m).padStart(2,"0")}-${String(i).padStart(2,"0")}`);
    while (cells.length % 7 !== 0) cells.push(null);
    return { year: y, month: m, days: cells };
  }, [offset]);

  useEffect(() => {
    if (!poolId) return;
    const mm = String(month).padStart(2, "0");
    apiRequest(token, `/holidays?pool_id=${poolId}&month=${year}-${mm}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.holidays) setHolidayDates(new Set(d.holidays.map((h: any) => h.holiday_date))); })
      .catch(() => {});
  }, [token, poolId, year, month]);

  const CELL_H = Math.max(72, Math.floor((SCREEN_W - 32) / 7 * 1.1));
  const CELL_W = Math.floor((SCREEN_W - 32) / 7);
  const nowHour = useMemo(() => new Date().getHours(), []);

  const dateClassMap = useMemo(() => {
    const map: Record<string, TeacherClassGroup[]> = {};
    days.forEach(dateStr => {
      if (dateStr) map[dateStr] = classesForDate(groups, dateStr);
    });
    return map;
  }, [groups, days]);

  return (
    <View style={mc.root}>
      <View style={mc.monthNav}>
        <Pressable style={mc.navBtn} onPress={() => setOffset(o => o - 1)}>
          <ChevronLeft size={20} color={C.text} />
        </Pressable>
        <Pressable onPress={() => setOffset(0)}>
          <Text style={mc.monthTitle}>{year}년 {month}월</Text>
        </Pressable>
        <Pressable style={mc.navBtn} onPress={() => setOffset(o => o + 1)}>
          <ChevronRight size={20} color={C.text} />
        </Pressable>
      </View>

      <View style={mc.weekRow}>
        {WEEKDAY_NAMES.map((wd, i) => (
          <View key={wd} style={[mc.weekHeader, { width: CELL_W }]}>
            <Text style={[mc.weekHeaderText,
              i === 0 && { color: "#D96C6C" },
              i === 6 && { color: C.tint },
            ]}>{wd}</Text>
          </View>
        ))}
      </View>

      {Array.from({ length: Math.ceil(days.length / 7) }, (_, wi) => (
        <View key={wi} style={mc.weekRow}>
          {days.slice(wi * 7, wi * 7 + 7).map((dateStr, di) => {
            if (!dateStr) return <View key={di} style={[mc.dayCell, { width: CELL_W, height: CELL_H }]} />;
            const isToday       = dateStr === today;
            const isPast        = dateStr < today;
            const isSelected    = !selectionMode && dateStr === selectedDate;
            const isMultiPicked = selectionMode && (selectedDates?.has(dateStr) ?? false);
            const isHoliday     = holidayDates.has(dateStr);
            const cls        = dateClassMap[dateStr] ?? [];
            const dayNum     = parseInt(dateStr.split("-")[2]);
            const isSun      = di === 0;
            const isSat      = di === 6;
            const hasMemo    = memoDateSet.has(dateStr);
            const timePills  = cls.slice(0, 3).map(g => fmtHour(g.schedule_time));
            const extraCount = cls.length - timePills.length;

            return (
              <Pressable key={dateStr}
                style={[
                  mc.dayCell, { width: CELL_W, height: CELL_H },
                  isSelected && { backgroundColor: C.tintLight, borderRadius: 8 },
                  isMultiPicked && { backgroundColor: "#2E9B6F" + "20", borderRadius: 8, borderWidth: 1.5, borderColor: "#2E9B6F" },
                  isToday && !isSelected && !isMultiPicked && { backgroundColor: C.tintLight },
                  isHoliday && !isMultiPicked && { backgroundColor: "#FEF2F2" },
                ]}
                onPress={() => onSelectDate(dateStr)}>

                {isMultiPicked && (
                  <View style={{ position: "absolute", top: 3, right: 3, width: 14, height: 14, borderRadius: 7,
                    backgroundColor: "#2E9B6F", alignItems: "center", justifyContent: "center" }}>
                    <Check size={9} color="#fff" />
                  </View>
                )}

                <View style={[mc.dayNumWrap,
                  isToday && { backgroundColor: C.tint },
                  isSelected && !isToday && { backgroundColor: C.tintLight },
                ]}>
                  <Text style={[mc.dayNum,
                    isSun || isHoliday ? { color: "#D96C6C" } : isSat ? { color: C.tint } : {},
                    isToday && { color: "#fff" },
                  ]}>{dayNum}</Text>
                </View>

                {hasMemo && !isHoliday && (
                  <View style={mc.memoDot} />
                )}

                {isHoliday ? (
                  <Text style={mc.holidayTag}>휴무일</Text>
                ) : (
                  <View style={mc.timePills}>
                    {timePills.map((label, ti) => {
                      const pillIsPast = isPast ||
                        (isToday && parseHour(cls[ti].schedule_time) < nowHour);
                      const rawColor = cls[ti].color;
                      const pillBg = rawColor && rawColor !== "#FFFFFF" ? rawColor : "#FFFFFF";
                      const pillBorder = pillBg === "#FFFFFF" ? "#E5E7EB" : "transparent";
                      return (
                        <View key={ti} style={[mc.timePill, { backgroundColor: pillBg, borderWidth: 0.5, borderColor: pillBorder }]}>
                          <Text style={[mc.timePillText, { color: C.text }]}>{label}</Text>
                          {pillIsPast && (
                            <View style={mc.strikeOverlay} pointerEvents="none">
                              <View style={mc.strikeLine} />
                            </View>
                          )}
                        </View>
                      );
                    })}
                    {extraCount > 0 && (
                      <Text style={mc.moreTxt}>+{extraCount}</Text>
                    )}
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const mc = StyleSheet.create({
  root:           { paddingHorizontal: 16, paddingBottom: 8 },
  monthNav:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10 },
  navBtn:         { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, alignItems: "center", justifyContent: "center" },
  monthTitle:     { fontSize: 17, fontFamily: "Pretendard-Regular", color: C.text },
  weekRow:        { flexDirection: "row" },
  weekHeader:     { height: 28, alignItems: "center", justifyContent: "center" },
  weekHeaderText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  dayCell:        { alignItems: "center", paddingTop: 4, paddingHorizontal: 1 },
  dayNumWrap:     { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  dayNum:         { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.text },
  memoDot:        { width: 4, height: 4, borderRadius: 2, backgroundColor: "#E4A93A", marginTop: 1 },
  timePills:      { flexDirection: "column", alignItems: "center", gap: 1, marginTop: 2, width: "100%" },
  timePill:       { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4, alignItems: "center" },
  timePillText:   { fontSize: 9, fontFamily: "Pretendard-Regular" },
  strikeOverlay:  { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "center" },
  strikeLine:     { height: 1.5, backgroundColor: "rgba(0,0,0,0.28)", borderRadius: 1, marginHorizontal: 1 },
  moreTxt:        { fontSize: 8, fontFamily: "Pretendard-Regular", color: C.textMuted },
  holidayTag:     { fontSize: 9, fontFamily: "Pretendard-Regular", color: "#D96C6C", marginTop: 2 },
});
