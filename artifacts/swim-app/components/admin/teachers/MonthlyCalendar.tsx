import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;
const SCREEN_W = Dimensions.get("window").width;
const DAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

const CLASS_COLORS = ["#4EA7D8","#2E9B6F","#E4A93A","#D96C6C","#8B5CF6","#EC4899","#06B6D4","#84CC16"];
function classColor(id: string) {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
  return CLASS_COLORS[Math.abs(h) % CLASS_COLORS.length];
}

function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dateToKo(dateStr: string): string {
  return DAY_KO[new Date(dateStr + "T12:00:00Z").getUTCDay()];
}

interface ClassGroup { id: string; schedule_days: string; }

interface MonthlyCalendarProps {
  classGroups: ClassGroup[];
  onSelectDate: (date: string) => void;
}

export function MonthlyCalendar({ classGroups, onSelectDate }: MonthlyCalendarProps) {
  const today = todayDateStr();
  const [offset, setOffset] = useState(0);
  const CELL = Math.floor((SCREEN_W - 32) / 7);

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

  function hasClasses(dateStr: string) {
    const koDay = dateToKo(dateStr);
    return classGroups.some(g => g.schedule_days.split(",").map(d => d.trim()).includes(koDay));
  }
  function getClasses(dateStr: string) {
    const koDay = dateToKo(dateStr);
    return classGroups.filter(g => g.schedule_days.split(",").map(d => d.trim()).includes(koDay));
  }

  return (
    <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10 }}>
        <Pressable style={mc.navBtn} onPress={() => setOffset(o => o - 1)}><Feather name="chevron-left" size={20} color={C.text} /></Pressable>
        <Text style={[mc.monthTitle, { color: C.text }]}>{year}년 {month}월</Text>
        <Pressable style={mc.navBtn} onPress={() => setOffset(o => o + 1)}><Feather name="chevron-right" size={20} color={C.text} /></Pressable>
      </View>
      <View style={{ flexDirection: "row" }}>
        {DAY_KO.map((wd, i) => (
          <View key={wd} style={[mc.weekHeader, { width: CELL }]}>
            <Text style={[mc.weekHeaderText, i === 0 && { color: "#D96C6C" }, i === 6 && { color: C.tint }]}>{wd}</Text>
          </View>
        ))}
      </View>
      {Array.from({ length: Math.ceil(days.length / 7) }, (_, wi) => (
        <View key={wi} style={{ flexDirection: "row" }}>
          {days.slice(wi * 7, wi * 7 + 7).map((dateStr, di) => {
            if (!dateStr) return <View key={di} style={[mc.dayCell, { width: CELL }]} />;
            const isToday = dateStr === today;
            const cls = getClasses(dateStr);
            const dayNum = parseInt(dateStr.split("-")[2]);
            return (
              <Pressable key={dateStr}
                style={[mc.dayCell, { width: CELL }, isToday && { backgroundColor: C.tintLight, borderRadius: 8 }]}
                onPress={() => hasClasses(dateStr) ? onSelectDate(dateStr) : undefined}
              >
                <View style={[mc.dayNumWrap, isToday && { backgroundColor: C.tint }]}>
                  <Text style={[mc.dayNum, { color: di === 0 ? "#D96C6C" : di === 6 ? C.tint : C.text }, isToday && { color: "#fff" }]}>
                    {dayNum}
                  </Text>
                </View>
                <View style={{ flexDirection: "row", gap: 1.5, marginTop: 3, flexWrap: "wrap", justifyContent: "center" }}>
                  {cls.slice(0, 4).map(g => (
                    <View key={g.id} style={[mc.dot, { backgroundColor: classColor(g.id) }]} />
                  ))}
                  {cls.length > 4 && <Text style={[mc.moreText, { color: C.textMuted }]}>+{cls.length - 4}</Text>}
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
  navBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#F8FAFC", alignItems: "center", justifyContent: "center" },
  monthTitle: { fontSize: 17, fontFamily: "Pretendard-Bold" },
  weekHeader: { height: 28, alignItems: "center", justifyContent: "center" },
  weekHeaderText: { fontSize: 12, fontFamily: "Pretendard-SemiBold", color: C.textSecondary },
  dayCell: { height: 64, alignItems: "center", paddingTop: 6 },
  dayNumWrap: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  dayNum: { fontSize: 13, fontFamily: "Pretendard-Medium" },
  dot: { width: 6, height: 6, borderRadius: 3 },
  moreText: { fontSize: 8, fontFamily: "Pretendard-Regular" },
});
