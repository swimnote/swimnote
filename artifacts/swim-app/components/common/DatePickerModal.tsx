import { ChevronLeft, ChevronRight } from "lucide-react-native";
import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

const WEEK_DAYS = ["일", "월", "화", "수", "목", "금", "토"];

interface DatePickerModalProps {
  visible: boolean;
  value: string;
  onConfirm: (date: string) => void;
  onClose: () => void;
}

function toYMD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function parseDate(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s + "T12:00:00");
  return isNaN(d.getTime()) ? null : d;
}

export function DatePickerModal({ visible, value, onConfirm, onClose }: DatePickerModalProps) {
  const today = new Date();
  const initDate = parseDate(value) ?? today;

  const [year, setYear]   = useState(initDate.getFullYear());
  const [month, setMonth] = useState(initDate.getMonth());
  const [selected, setSelected] = useState<string>(value || toYMD(today));

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }

  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }

  function buildCells() {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: Array<number | null> = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }

  function handleSelect(day: number) {
    const d = new Date(year, month, day);
    setSelected(toYMD(d));
  }

  function handleConfirm() {
    onConfirm(selected);
    onClose();
  }

  const cells = buildCells();
  const todayStr = toYMD(today);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={dp.overlay}>
        <View style={dp.sheet}>
          {/* 헤더 — 연월 네비게이션 */}
          <View style={dp.navRow}>
            <Pressable onPress={prevMonth} style={dp.navBtn} hitSlop={8}>
              <ChevronLeft size={20} color={C.text} />
            </Pressable>
            <Text style={[dp.monthLabel, { color: C.text }]}>
              {year}년 {month + 1}월
            </Text>
            <Pressable onPress={nextMonth} style={dp.navBtn} hitSlop={8}>
              <ChevronRight size={20} color={C.text} />
            </Pressable>
          </View>

          {/* 요일 헤더 */}
          <View style={dp.weekRow}>
            {WEEK_DAYS.map((w, i) => (
              <Text
                key={w}
                style={[dp.weekLabel, i === 0 && { color: "#EF4444" }, i === 6 && { color: "#3B82F6" }]}
              >
                {w}
              </Text>
            ))}
          </View>

          {/* 날짜 그리드 */}
          <View style={dp.grid}>
            {cells.map((day, idx) => {
              if (!day) return <View key={`empty-${idx}`} style={dp.cell} />;
              const dateStr = toYMD(new Date(year, month, day));
              const isSelected = dateStr === selected;
              const isToday    = dateStr === todayStr;
              const dow = idx % 7;

              return (
                <Pressable
                  key={dateStr}
                  style={[dp.cell, isSelected && { backgroundColor: C.tint, borderRadius: 20 }]}
                  onPress={() => handleSelect(day)}
                >
                  {isToday && !isSelected && <View style={dp.todayDot} />}
                  <Text style={[
                    dp.dayText,
                    dow === 0 && { color: "#EF4444" },
                    dow === 6 && { color: "#3B82F6" },
                    isSelected && { color: "#fff", fontFamily: "Pretendard-SemiBold" },
                    isToday && !isSelected && { fontFamily: "Pretendard-SemiBold" },
                  ]}>
                    {day}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* 선택된 날짜 표시 */}
          <Text style={[dp.selectedLabel, { color: C.textSecondary }]}>
            선택: {selected || "—"}
          </Text>

          {/* 버튼 */}
          <View style={dp.btnRow}>
            <Pressable style={[dp.btn, dp.cancelBtn]} onPress={onClose}>
              <Text style={[dp.btnTxt, { color: C.textSecondary }]}>취소</Text>
            </Pressable>
            <Pressable style={[dp.btn, { backgroundColor: C.tint }]} onPress={handleConfirm}>
              <Text style={[dp.btnTxt, { color: "#fff" }]}>확인</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const dp = StyleSheet.create({
  overlay:       { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", paddingHorizontal: 24 },
  sheet:         { backgroundColor: "#fff", borderRadius: 20, padding: 20, gap: 12 },
  navRow:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  navBtn:        { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  monthLabel:    { fontSize: 16, fontFamily: "Pretendard-SemiBold", fontWeight: "600" },
  weekRow:       { flexDirection: "row" },
  weekLabel:     { flex: 1, textAlign: "center", fontSize: 12, fontFamily: "Pretendard-Regular", color: "#888", paddingVertical: 4 },
  grid:          { flexDirection: "row", flexWrap: "wrap" },
  cell:          { width: `${100 / 7}%`, aspectRatio: 1, alignItems: "center", justifyContent: "center" },
  dayText:       { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#222" },
  todayDot:      { position: "absolute", bottom: 4, width: 4, height: 4, borderRadius: 2, backgroundColor: C.tint },
  selectedLabel: { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center" },
  btnRow:        { flexDirection: "row", gap: 10, marginTop: 4 },
  btn:           { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: "center" },
  cancelBtn:     { backgroundColor: "#F3F4F6" },
  btnTxt:        { fontSize: 15, fontFamily: "Pretendard-Regular" },
});
