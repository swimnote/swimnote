import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { LucideIcon } from "@/components/common/LucideIcon";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { TeacherClassGroup } from "@/components/teacher/types";
import {
  SCREEN_W, WEEKDAY_NAMES, classesForDate, fmtHour,
  parseHour, todayDateStr,
} from "./utils";

const C = Colors.light;

// 셀 고정 높이: dateHeader(28) + gap(2) + 최대2pill(14*2=28) + +N(14) = 72 → 80으로 여유
const CELL_H = 80;
const CELL_W = Math.floor((SCREEN_W - 32) / 7);
// 대표 일정 최대 2개
const MAX_PILLS = 2;

export default function MonthlyCalendar({
  groups, themeColor, selectedDate, onSelectDate, memoDateSet,
  makeupDateSet,
  selectionMode, selectedDates,
}: {
  groups: TeacherClassGroup[];
  themeColor: string;
  selectedDate: string | null;
  onSelectDate: (dateStr: string) => void;
  memoDateSet: Set<string>;
  makeupDateSet?: Set<string>;
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
          <LucideIcon name="chevron-left" size={20} color={C.text} />
        </Pressable>
        <Pressable onPress={() => setOffset(0)}>
          <Text style={mc.monthTitle}>{year}년 {month}월</Text>
        </Pressable>
        <Pressable style={mc.navBtn} onPress={() => setOffset(o => o + 1)}>
          <LucideIcon name="chevron-right" size={20} color={C.text} />
        </Pressable>
      </View>

      <View style={mc.weekRow}>
        {WEEKDAY_NAMES.map((wd, i) => (
          <View key={wd} style={[mc.weekHeader, { width: CELL_W }]}>
            <Text style={[mc.weekHeaderText,
              i === 0 && { color: "#D96C6C" },
              i === 6 && { color: C.brandStrong },
            ]}>{wd}</Text>
          </View>
        ))}
      </View>

      {Array.from({ length: Math.ceil(days.length / 7) }, (_, wi) => (
        <View key={wi} style={mc.weekRow}>
          {days.slice(wi * 7, wi * 7 + 7).map((dateStr, di) => {
            if (!dateStr) return <View key={di} style={[mc.dayCell, { width: CELL_W }]} />;

            const isToday       = dateStr === today;
            const isPast        = dateStr < today;
            const isSelected    = !selectionMode && dateStr === selectedDate;
            const isMultiPicked = selectionMode && (selectedDates?.has(dateStr) ?? false);
            const isHoliday     = holidayDates.has(dateStr);
            const cls           = dateClassMap[dateStr] ?? [];
            const dayNum        = parseInt(dateStr.split("-")[2]);
            const isSun         = di === 0;
            const isSat         = di === 6;
            const hasMemo       = memoDateSet.has(dateStr);
            const hasMakeup     = makeupDateSet?.has(dateStr) ?? false;

            // 최대 2개 대표 일정
            const visibleCls  = cls.slice(0, MAX_PILLS);
            const extraCount  = cls.length - visibleCls.length;

            return (
              <Pressable key={dateStr}
                style={[
                  mc.dayCell, { width: CELL_W },
                  isSelected    && { backgroundColor: C.brandSoft, borderRadius: 8 },
                  isMultiPicked && { backgroundColor: "#2E9B6F20", borderRadius: 8, borderWidth: 1.5, borderColor: "#2E9B6F" },
                  isToday && !isSelected && !isMultiPicked && { backgroundColor: C.brandSoft },
                  isHoliday && !isMultiPicked && { backgroundColor: "#FEF2F2" },
                ]}
                onPress={() => onSelectDate(dateStr)}>

                {/* 멀티선택 체크 뱃지 */}
                {isMultiPicked && (
                  <View style={mc.multiCheckBadge}>
                    <LucideIcon name="check" size={9} color="#fff" />
                  </View>
                )}

                {/* ─── 날짜 헤더 영역 (항상 최상단) ─── */}
                <View style={mc.dateHeaderRow}>
                  <View style={[mc.dayNumWrap,
                    isToday    && { backgroundColor: C.brandStrong },
                    isSelected && !isToday && { backgroundColor: C.brandSoft },
                  ]}>
                    <Text style={[mc.dayNum,
                      (isSun || isHoliday) ? { color: "#D96C6C" } : isSat ? { color: C.brandStrong } : {},
                      isToday && { color: "#fff" },
                    ]}>{dayNum}</Text>
                  </View>
                  {/* 메모/보강 점 */}
                  {(hasMemo || hasMakeup) && !isHoliday && (
                    <View style={mc.dotRow}>
                      {hasMemo   && <View style={mc.memoDot} />}
                      {hasMakeup && <View style={[mc.memoDot, { backgroundColor: "#7C3AED" }]} />}
                    </View>
                  )}
                </View>

                {/* ─── 콘텐츠 영역 (overflow hidden) ─── */}
                <View style={mc.contentArea}>
                  {isHoliday ? (
                    <Text style={mc.holidayTag} numberOfLines={1}>휴무일</Text>
                  ) : (
                    <>
                      {visibleCls.map((g, ti) => {
                        const pillIsPast = isPast ||
                          (isToday && parseHour(g.schedule_time) < nowHour);
                        const rawColor = g.color;
                        const pillBg = rawColor && rawColor !== "#FFFFFF" ? rawColor : "#FFFFFF";
                        const pillBorder = pillBg === "#FFFFFF" ? "#E5E7EB" : "transparent";
                        return (
                          <View key={ti} style={[mc.timePill, { backgroundColor: pillBg, borderWidth: 0.5, borderColor: pillBorder }]}>
                            <Text
                              style={[
                                mc.timePillText,
                                { color: C.text },
                                pillIsPast && { textDecorationLine: "line-through", color: C.textMuted },
                              ]}
                              numberOfLines={1}
                            >
                              {fmtHour(g.schedule_time)}
                            </Text>
                          </View>
                        );
                      })}
                      {extraCount > 0 && (
                        <Text style={mc.moreTxt} numberOfLines={1}>+{extraCount}</Text>
                      )}
                    </>
                  )}
                </View>
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

  // 셀: 고정 높이, overflow hidden으로 콘텐츠 침범 차단
  dayCell:        { height: CELL_H, alignItems: "center", paddingTop: 4, paddingHorizontal: 1, overflow: "hidden" },

  // 날짜 헤더 행: 숫자 + 점
  dateHeaderRow:  { alignItems: "center", justifyContent: "center", height: 26 },
  dayNumWrap:     { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  dayNum:         { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text, lineHeight: 18 },
  dotRow:         { flexDirection: "row", gap: 2, marginTop: 2, position: "absolute", bottom: -4, left: 0, right: 0, justifyContent: "center" },
  memoDot:        { width: 4, height: 4, borderRadius: 2, backgroundColor: "#E4A93A" },

  // 콘텐츠 영역: 날짜 아래, 최대 높이 제한
  contentArea:    { width: "100%", alignItems: "center", marginTop: 3, flex: 1, overflow: "hidden" },

  // 시간 pill: 취소선은 Text에만
  timePill:       { paddingHorizontal: 3, paddingVertical: 1, borderRadius: 4, alignItems: "center", marginBottom: 1, width: "92%" },
  timePillText:   { fontSize: 10, fontFamily: "Pretendard-Regular", lineHeight: 14 },

  moreTxt:        { fontSize: 9, fontFamily: "Pretendard-Regular", color: C.textMuted, lineHeight: 14, marginTop: 1 },
  holidayTag:     { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#D96C6C", lineHeight: 16, marginTop: 2 },

  multiCheckBadge: { position: "absolute", top: 3, right: 3, width: 14, height: 14, borderRadius: 7,
    backgroundColor: "#2E9B6F", alignItems: "center", justifyContent: "center" },
});
