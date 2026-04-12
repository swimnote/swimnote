import { LucideIcon } from "@/components/common/LucideIcon";
import { BookOpen } from "lucide-react-native";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

interface DiaryItem {
  id: string;
  lesson_date?: string;
  common_content?: string;
  teacher_name?: string;
  student_note?: string | null;
  is_new?: boolean;
}

interface Props {
  diaries: DiaryItem[];
  onPress: () => void;
}

function fmt(d: string) {
  const dt = new Date(d.includes("T") ? d : d + "T00:00:00");
  return dt.toLocaleDateString("ko-KR", { month: "short", day: "numeric", weekday: "short" });
}

export function ParentLatestDiaryCard({ diaries, onPress }: Props) {
  const diary = diaries[0] ?? null;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, { opacity: pressed ? 0.92 : 1 }]}
      onPress={onPress}
    >
      {/* 헤더 */}
      <View style={styles.header}>
        <View style={[styles.iconBg, { backgroundColor: "#EDE9FE" }]}>
          <BookOpen size={16} color="#7C3AED" />
        </View>
        <Text style={[styles.title, { color: C.text }]}>최근 수업일지</Text>
        {diary?.is_new && (
          <View style={styles.newBadge}>
            <Text style={styles.newBadgeTxt}>NEW</Text>
          </View>
        )}
        <LucideIcon name="chevron-right" size={14} color={C.textMuted} />
      </View>

      {/* 본문 */}
      {diary ? (
        <View style={styles.body}>
          <View style={styles.metaRow}>
            {diary.lesson_date && (
              <Text style={[styles.date, { color: C.textMuted }]}>{fmt(diary.lesson_date)}</Text>
            )}
            {diary.teacher_name && (
              <Text style={[styles.teacher, { color: C.textMuted }]}>{diary.teacher_name} 선생님</Text>
            )}
          </View>
          {diary.student_note ? (
            <View style={styles.noteBox}>
              <LucideIcon name="user" size={11} color="#7C3AED" />
              <Text style={[styles.noteTxt, { color: "#5B21B6" }]} numberOfLines={2}>
                {diary.student_note}
              </Text>
            </View>
          ) : (
            <Text style={[styles.content, { color: C.textSecondary }]} numberOfLines={2}>
              {diary.common_content || "수업 내용이 기록되지 않았습니다."}
            </Text>
          )}
        </View>
      ) : (
        <View style={styles.empty}>
          <BookOpen size={22} color={C.textMuted} />
          <Text style={[styles.emptyTxt, { color: C.textMuted }]}>아직 수업 기록이 없습니다</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 20,
    marginTop: 12,
    borderRadius: 16,
    backgroundColor: C.card,
    padding: 14,
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconBg: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular" },
  newBadge: {
    backgroundColor: "#7C3AED", borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  newBadgeTxt: { fontSize: 9, fontFamily: "Pretendard-Regular", color: "#fff" },
  body: { gap: 6 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  date: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  teacher: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  content: { fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 19 },
  noteBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 5,
    backgroundColor: "#EEDDF5", borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 6,
  },
  noteTxt: { fontSize: 12, fontFamily: "Pretendard-Regular", flex: 1, lineHeight: 17 },
  empty: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  emptyTxt: { fontSize: 13, fontFamily: "Pretendard-Regular" },
});
