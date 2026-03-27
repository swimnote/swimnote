import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { ScheduleItem } from "./types";

const C = Colors.light;

export default function ScheduleCard({
  item, themeColor, onMemo, onAttendance, onDiary, onAbsence,
}: {
  item: ScheduleItem; themeColor: string;
  onMemo: () => void; onAttendance: () => void; onDiary: () => void; onAbsence: () => void;
}) {
  const attDone    = item.att_total > 0 && item.att_present === item.att_total;
  const attPartial = item.att_total > 0 && item.att_present > 0 && !attDone;
  const noAtt      = item.att_total === 0;

  return (
    <View style={[card.wrap, { backgroundColor: C.card }]}>
      <View style={card.topRow}>
        <View style={[card.timeBox, { backgroundColor: themeColor + "15" }]}>
          <Text style={[card.time, { color: themeColor }]}>{item.schedule_time}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={card.name}>{item.name}</Text>
          <Text style={card.sub}>학생 {item.student_count}명{item.level ? ` · ${item.level}` : ""}</Text>
        </View>
        {item.has_note && (
          <View style={[card.noteBadge, { backgroundColor: "#FFF1BF" }]}>
            <Feather name="edit-3" size={10} color="#D97706" />
            <Text style={card.noteBadgeText}>메모</Text>
          </View>
        )}
      </View>
      <View style={card.statusRow}>
        <View style={[card.badge, { backgroundColor: attDone ? "#E6FFFA" : attPartial ? "#FFF1BF" : "#F8FAFC" }]}>
          <Feather name={attDone ? "check-circle" : "circle"} size={11}
            color={attDone ? "#2EC4B6" : attPartial ? "#D97706" : "#9CA3AF"} />
          <Text style={[card.badgeText, { color: attDone ? "#2EC4B6" : attPartial ? "#D97706" : "#6B7280" }]}>
            {noAtt ? "출결 미시작" : `출결 ${item.att_present}/${item.att_total}`}
          </Text>
        </View>
        <View style={[card.badge, { backgroundColor: item.diary_done ? "#E6FFFA" : "#FFF1BF" }]}>
          <Feather name={item.diary_done ? "check-circle" : "edit"} size={11} color={item.diary_done ? "#2EC4B6" : "#D97706"} />
          <Text style={[card.badgeText, { color: item.diary_done ? "#2EC4B6" : "#D97706" }]}>
            {item.diary_done ? "일지 완료" : "일지 미작성"}
          </Text>
        </View>
      </View>
      <View style={card.btnRow}>
        <Pressable style={[card.actionBtn, { borderColor: attDone ? "#2EC4B6" : C.border }]} onPress={onAttendance}>
          <Feather name="check-square" size={14} color={attDone ? "#2EC4B6" : C.textSecondary} />
          <Text style={[card.actionText, { color: attDone ? "#2EC4B6" : C.textSecondary }]}>출결</Text>
        </Pressable>
        <Pressable style={[card.actionBtn, { borderColor: item.diary_done ? "#2EC4B6" : C.border }]} onPress={onDiary}>
          <Feather name="book" size={14} color={item.diary_done ? "#2EC4B6" : C.textSecondary} />
          <Text style={[card.actionText, { color: item.diary_done ? "#2EC4B6" : C.textSecondary }]}>일지</Text>
        </Pressable>
        <Pressable style={[card.actionBtn, { borderColor: item.has_note ? "#D97706" : C.border }]} onPress={onMemo}>
          <Feather name="edit-3" size={14} color={item.has_note ? "#D97706" : C.textSecondary} />
          <Text style={[card.actionText, { color: item.has_note ? "#D97706" : C.textSecondary }]}>
            {item.has_note ? "메모 수정" : "개인메모"}
          </Text>
        </Pressable>
        <Pressable style={[card.actionBtn, { borderColor: "#D96C6C", backgroundColor: "#FEF2F2" }]} onPress={onAbsence}>
          <Feather name="user-x" size={14} color="#D96C6C" />
          <Text style={[card.actionText, { color: "#D96C6C" }]}>결근</Text>
        </Pressable>
      </View>
    </View>
  );
}

const card = StyleSheet.create({
  wrap:          { borderRadius: 16, padding: 14, gap: 10, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  topRow:        { flexDirection: "row", alignItems: "center", gap: 10 },
  timeBox:       { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  time:          { fontSize: 15, fontFamily: "Pretendard-Bold" },
  name:          { fontSize: 16, fontFamily: "Pretendard-Bold", color: C.text },
  sub:           { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 1 },
  statusRow:     { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  badge:         { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeText:     { fontSize: 11, fontFamily: "Pretendard-SemiBold" },
  noteBadge:     { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 7 },
  noteBadgeText: { fontSize: 10, fontFamily: "Pretendard-SemiBold", color: "#D97706" },
  btnRow:        { flexDirection: "row", gap: 8 },
  actionBtn:     { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5 },
  actionText:    { fontSize: 12, fontFamily: "Pretendard-SemiBold" },
});
