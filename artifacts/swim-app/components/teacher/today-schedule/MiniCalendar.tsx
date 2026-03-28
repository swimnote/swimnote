import { ChevronLeft, ChevronRight } from "lucide-react-native";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { DailyMemoDateInfo, getDaysInMonth, getFirstDayOfMonth, todayStr } from "./types";

const C = Colors.light;

export default function MiniCalendar({
  year, month, memoInfo, onSelectDate, onChangeMonth,
}: {
  year: number; month: number;
  memoInfo: DailyMemoDateInfo[];
  onSelectDate: (d: string) => void;
  onChangeMonth: (y: number, m: number) => void;
}) {
  const days = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const today = todayStr();

  return (
    <View style={cal.wrap}>
      <View style={cal.header}>
        <Pressable style={cal.navBtn}
          onPress={() => { const d = new Date(year, month - 2, 1); onChangeMonth(d.getFullYear(), d.getMonth() + 1); }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <ChevronLeft size={24} color={C.text} />
        </Pressable>
        <Text style={cal.title}>{year}년 {month}월</Text>
        <Pressable style={cal.navBtn}
          onPress={() => { const d = new Date(year, month, 1); onChangeMonth(d.getFullYear(), d.getMonth() + 1); }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <ChevronRight size={24} color={C.text} />
        </Pressable>
      </View>

      <View style={cal.dayRow}>
        {["일","월","화","수","목","금","토"].map(d => (
          <Text key={d} style={[cal.dayLabel, d === "일" && { color: "#D96C6C" }, d === "토" && { color: "#4EA7D8" }]}>{d}</Text>
        ))}
      </View>

      <View style={cal.grid}>
        {cells.map((day, i) => {
          if (!day) return <View key={`e-${i}`} style={cal.cell} />;
          const dateStr = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
          const info = memoInfo.find(m => m.date === dateStr);
          const hasText  = !!info?.has_text;
          const hasAudio = !!info?.has_audio;
          const isToday  = dateStr === today;
          const dayIdx   = new Date(dateStr + "T00:00:00").getDay();
          const isSun    = dayIdx === 0;
          const isSat    = dayIdx === 6;
          return (
            <Pressable key={dateStr} style={cal.cell} onPress={() => onSelectDate(dateStr)}>
              <View style={[cal.dayBox, isToday && { backgroundColor: C.tint }]}>
                <Text style={[
                  cal.dayNum,
                  isToday  ? { color: "#fff", fontFamily: "Pretendard-SemiBold" } :
                  isSun    ? { color: "#D96C6C" } :
                  isSat    ? { color: "#4EA7D8" } :
                             { color: C.text },
                ]}>
                  {day}
                </Text>
              </View>
              <View style={cal.dotRow}>
                {hasText  && <View style={[cal.dot, { backgroundColor: "#E4A93A" }]} />}
                {hasAudio && <View style={[cal.dot, { backgroundColor: "#4EA7D8" }]} />}
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={cal.legend}>
        <View style={cal.legendItem}>
          <View style={[cal.legendDot, { backgroundColor: "#E4A93A" }]} />
          <Text style={cal.legendText}>텍스트 메모</Text>
        </View>
        <View style={cal.legendItem}>
          <View style={[cal.legendDot, { backgroundColor: "#4EA7D8" }]} />
          <Text style={cal.legendText}>음성 메모</Text>
        </View>
      </View>
    </View>
  );
}

const cal = StyleSheet.create({
  wrap:       { backgroundColor: C.card, borderRadius: 18, padding: 16, gap: 10 },
  header:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 },
  navBtn:     { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  title:      { fontSize: 17, fontFamily: "Pretendard-SemiBold", color: C.text },
  dayRow:     { flexDirection: "row", justifyContent: "space-around" },
  dayLabel:   { width: "14.28%" as any, textAlign: "center", fontSize: 11, fontFamily: "Pretendard-Medium", color: C.textSecondary },
  grid:       { flexDirection: "row", flexWrap: "wrap" },
  cell:       { width: "14.28%" as any, alignItems: "center", paddingVertical: 4, gap: 2 },
  dayBox:     { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  dayNum:     { fontSize: 14, fontFamily: "Pretendard-Medium" },
  dotRow:     { flexDirection: "row", gap: 2, minHeight: 6 },
  dot:        { width: 5, height: 5, borderRadius: 3 },
  legend:     { flexDirection: "row", justifyContent: "center", gap: 20, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot:  { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary },
});
