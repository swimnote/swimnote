/**
 * AdminWeekBoard — 관리자 주간 시간표 보드
 * 셀 클릭 시 → onCellPress(day, time) 호출 (선생님 선택 단계로)
 */
import React, { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

const COLS = ["월", "화", "수", "목", "금", "토", "일"];
const COL_W = 56;
const TIME_W = 44;
const ROW_H = 60;

const CLASS_COLORS = ["#3B82F6","#10B981","#F59E0B","#EF4444","#8B5CF6","#EC4899","#06B6D4","#84CC16"];

function classColor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
  return CLASS_COLORS[Math.abs(h) % CLASS_COLORS.length];
}

function parseHour(t: string): number { return parseInt(t.split(/[:-]/)[0]) || 0; }

export interface ClassGroupItem {
  id: string; name: string; schedule_days: string; schedule_time: string;
  student_count: number; teacher_user_id?: string | null;
}

interface Props {
  classGroups: ClassGroupItem[];
  onCellPress: (day: string, time: string) => void;
}

export default function AdminWeekBoard({ classGroups, onCellPress }: Props) {
  const hours = useMemo(() => {
    if (!classGroups.length) return Array.from({ length: 8 }, (_, i) => i + 9);
    const hs = classGroups.map(g => parseHour(g.schedule_time));
    const minH = Math.max(6, Math.min(...hs));
    const maxH = Math.min(22, Math.max(...hs));
    return Array.from({ length: maxH - minH + 1 }, (_, i) => i + minH);
  }, [classGroups]);

  const cellMap = useMemo(() => {
    const map: Record<string, ClassGroupItem[]> = {};
    COLS.forEach(day => {
      hours.forEach(h => {
        map[`${day}-${h}`] = classGroups.filter(g => {
          const days = g.schedule_days.split(",").map(d => d.trim());
          return days.includes(day) && parseHour(g.schedule_time) === h;
        });
      });
    });
    return map;
  }, [classGroups, hours]);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View>
        {/* 요일 헤더 */}
        <View style={wb.headerRow}>
          <View style={[wb.timeCell, { backgroundColor: "#F9FAFB" }]} />
          {COLS.map(day => (
            <View key={day} style={[wb.dayHeader, { width: COL_W }]}>
              <Text style={wb.dayHeaderText}>{day}</Text>
            </View>
          ))}
        </View>

        {/* 시간 행 */}
        {hours.map(h => (
          <View key={h} style={[wb.row, { height: ROW_H }]}>
            <View style={wb.timeCell}>
              <Text style={wb.timeText}>{h}:00</Text>
            </View>
            {COLS.map(day => {
              const cls = cellMap[`${day}-${h}`] ?? [];
              return (
                <Pressable
                  key={day}
                  style={[wb.cell, { width: COL_W }, cls.length > 0 && { backgroundColor: "#F0F9FF" }]}
                  onPress={() => onCellPress(day, `${String(h).padStart(2, "0")}:00`)}
                >
                  {cls.map(g => (
                    <View key={g.id} style={[wb.classChip, { backgroundColor: classColor(g.id) }]}>
                      <Text style={wb.chipName} numberOfLines={2}>{g.name}</Text>
                      <Text style={wb.chipCount}>{g.student_count}명</Text>
                    </View>
                  ))}
                  {cls.length === 0 && (
                    <View style={wb.emptyCell}>
                      <Text style={wb.emptyCellText}>+</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const wb = StyleSheet.create({
  headerRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.border },
  dayHeader: { height: 36, alignItems: "center", justifyContent: "center", borderLeftWidth: 1, borderLeftColor: C.border, backgroundColor: "#F9FAFB" },
  dayHeaderText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.text },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  timeCell: { width: TIME_W, alignItems: "center", justifyContent: "flex-start", paddingTop: 4, borderRightWidth: 1, borderRightColor: C.border },
  timeText: { fontSize: 10, fontFamily: "Inter_400Regular", color: C.textMuted },
  cell: { borderLeftWidth: 1, borderLeftColor: "#F3F4F6", padding: 2, gap: 2 },
  classChip: { borderRadius: 5, padding: 3, minHeight: 26, justifyContent: "center" },
  chipName: { fontSize: 8, fontFamily: "Inter_600SemiBold", color: "#fff", lineHeight: 10 },
  chipCount: { fontSize: 7, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.85)", marginTop: 1 },
  emptyCell: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyCellText: { fontSize: 16, color: "#E5E7EB", fontFamily: "Inter_400Regular" },
});
