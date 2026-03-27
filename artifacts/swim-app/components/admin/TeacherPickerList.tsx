/**
 * TeacherPickerList — 관리자 공통 선생님 선택 리스트
 * 수업탭(주간), 선생님관리(일간/월간) 세 흐름에서 재사용
 * 항상 표시 (선생님 1명이어도 자동 진입 금지)
 */
import { ChevronLeft, ChevronRight, CircleAlert, Clock, Pencil, UserX } from "lucide-react-native";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

export interface TeacherForPicker {
  id: string;
  name: string;
  position?: string;
  classCount: number;
  uncheckedAtt: number;
  unwrittenDiary: number;
}

interface Props {
  date?: string;         // "2024-03-16" optional
  day?: string;          // "월" optional
  time: string;          // "15:00"
  teachers: TeacherForPicker[];
  onSelectTeacher: (teacherId: string) => void;
  onBack: () => void;
  bottomInset?: number;
}

export default function TeacherPickerList({
  date, day, time, teachers, onSelectTeacher, onBack, bottomInset = 120,
}: Props) {
  const sorted = [...teachers].sort((a, b) => a.name.localeCompare(b.name, "ko"));

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      {/* 뒤로가기 */}
      <Pressable onPress={onBack} style={[t.backRow, { borderBottomColor: C.border }]}>
        <ChevronLeft size={20} color={C.tint} />
        <Text style={[t.backText, { color: C.tint }]}>
          {day ? `${day}요일` : date ? dateLabel(date) : "시간표"}으로
        </Text>
      </Pressable>

      {/* 컨텍스트 헤더 */}
      <View style={[t.contextBar, { backgroundColor: C.tintLight }]}>
        {date && <Text style={[t.contextText, { color: C.tint }]}>{dateLabel(date)}</Text>}
        {day && !date && <Text style={[t.contextText, { color: C.tint }]}>{day}요일</Text>}
        <View style={[t.timePill, { backgroundColor: C.tint }]}>
          <Clock size={12} color="#fff" />
          <Text style={t.timePillText}>{time}</Text>
        </View>
        <Text style={[t.contextText, { color: C.tint }]}>선생님 선택</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: bottomInset, gap: 1 }} showsVerticalScrollIndicator={false}>
        {sorted.length === 0 ? (
          <View style={t.emptyBox}>
            <UserX size={40} color={C.textMuted} />
            <Text style={[t.emptyText, { color: C.textMuted }]}>해당 시간에 배정된 선생님이 없습니다</Text>
          </View>
        ) : sorted.map((teacher, idx) => (
          <Pressable
            key={teacher.id}
            style={[
              t.row,
              { backgroundColor: C.card, borderTopColor: C.border },
              idx === 0 && t.rowFirst,
              idx === sorted.length - 1 && t.rowLast,
            ]}
            onPress={() => onSelectTeacher(teacher.id)}
          >
            {/* 이름 + 직급 */}
            <View style={{ flex: 1 }}>
              <Text style={[t.name, { color: C.text }]}>{teacher.name}</Text>
              {teacher.position ? (
                <Text style={[t.position, { color: C.tint }]}>{teacher.position}</Text>
              ) : null}
              <Text style={[t.sub, { color: C.textMuted }]}>{teacher.classCount}개 반 운영 중</Text>
            </View>

            {/* 상태 뱃지 */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              {teacher.uncheckedAtt > 0 && (
                <View style={[t.badge, { backgroundColor: "#FFF1BF" }]}>
                  <CircleAlert size={10} color="#D97706" />
                  <Text style={[t.badgeText, { color: "#D97706" }]}>출결 {teacher.uncheckedAtt}</Text>
                </View>
              )}
              {teacher.unwrittenDiary > 0 && (
                <View style={[t.badge, { backgroundColor: "#F9DEDA" }]}>
                  <Pencil size={10} color="#D96C6C" />
                  <Text style={[t.badgeText, { color: "#D96C6C" }]}>일지 {teacher.unwrittenDiary}</Text>
                </View>
              )}
              <ChevronRight size={18} color={C.textMuted} />
            </View>
          </Pressable>
        ))}
        {sorted.length > 0 && (
          <Text style={[t.hint, { color: C.textMuted }]}>
            {sorted.length}명 · 가나다순 정렬
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

function dateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일(${dayNames[d.getUTCDay()]})`;
}

const t = StyleSheet.create({
  backRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1 },
  backText: { fontSize: 14, fontFamily: "Pretendard-Medium" },
  contextBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 10, flexWrap: "wrap" },
  contextText: { fontSize: 13, fontFamily: "Pretendard-SemiBold" },
  timePill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  timePillText: { fontSize: 12, fontFamily: "Pretendard-Bold", color: "#fff" },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1, minHeight: 64 },
  rowFirst: { borderTopLeftRadius: 14, borderTopRightRadius: 14, borderTopWidth: 0 },
  rowLast: { borderBottomLeftRadius: 14, borderBottomRightRadius: 14 },
  name: { fontSize: 16, fontFamily: "Pretendard-SemiBold", marginBottom: 2 },
  position: { fontSize: 12, fontFamily: "Pretendard-Medium", marginBottom: 2 },
  sub: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  badge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  badgeText: { fontSize: 10, fontFamily: "Pretendard-SemiBold" },
  emptyBox: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 14, fontFamily: "Pretendard-Regular", textAlign: "center" },
  hint: { fontSize: 11, fontFamily: "Pretendard-Regular", textAlign: "center", marginTop: 12 },
});
