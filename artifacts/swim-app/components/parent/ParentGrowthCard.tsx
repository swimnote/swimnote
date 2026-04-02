import { ChevronRight } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

interface Props {
  studentId?:     string;
  currentLevel:   string | number | null;
  prevLevel:      string | number | null;
  achievedDate?:  string | null;
  note?:          string | null;
  teacherName?:   string | null;
}

function fmt(d: string) {
  const dt = new Date(d.includes("T") ? d : d + "T00:00:00");
  return dt.toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" });
}

export function ParentGrowthCard({ studentId, currentLevel, prevLevel, achievedDate, note, teacherName }: Props) {
  if (!currentLevel) return null;

  const levelUp = prevLevel && currentLevel !== prevLevel;

  function goReport() {
    router.push({ pathname: "/(parent)/growth-report" as any, params: { studentId } });
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.iconBg, { backgroundColor: "#DCFCE7" }]}>
          <LucideIcon name="trending-up" size={16} color="#16A34A" />
        </View>
        <Text style={[styles.title, { color: C.text }]}>성장 현황</Text>
        {levelUp && (
          <View style={styles.upBadge}>
            <LucideIcon name="arrow-up" size={11} color="#16A34A" />
            <Text style={styles.upBadgeText}>레벨 상승</Text>
          </View>
        )}
      </View>

      <View style={styles.levelRow}>
        <View style={styles.levelBadge}>
          <Text style={styles.levelLabel}>현재 레벨</Text>
          <Text style={styles.levelValue}>{currentLevel}</Text>
        </View>
        <View style={{ flex: 1 }}>
          {achievedDate ? (
            <Text style={[styles.sub, { color: C.textMuted }]}>
              달성일 {fmt(achievedDate)}{teacherName ? `\n${teacherName} 선생님` : ""}
            </Text>
          ) : null}
          {note ? (
            <Text style={[styles.note, { color: C.textSecondary }]} numberOfLines={2}>{note}</Text>
          ) : null}
        </View>
      </View>

      {/* 3개월 리포트 바로가기 */}
      <Pressable style={styles.reportBtn} onPress={goReport}>
        <LucideIcon name="bar-chart-2" size={13} color="#4EA7D8" />
        <Text style={styles.reportBtnText}>3개월 성장 리포트 보기</Text>
        <ChevronRight size={13} color="#4EA7D8" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 20, marginTop: 12, borderRadius: 16,
    backgroundColor: C.card, padding: 14, gap: 10,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  header:      { flexDirection: "row", alignItems: "center", gap: 8 },
  iconBg:      { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  title:       { fontSize: 14, fontFamily: "Pretendard-Regular", flex: 1 },
  upBadge:     { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#DCFCE7", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  upBadgeText: { fontSize: 11, color: "#16A34A", fontFamily: "Pretendard-Regular" },
  levelRow:    { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  levelBadge:  { backgroundColor: "#DCFCE7", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, gap: 2 },
  levelLabel:  { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#16A34A" },
  levelValue:  { fontSize: 22, fontFamily: "Pretendard-Regular", color: "#15803D" },
  sub:         { fontSize: 11, fontFamily: "Pretendard-Regular", lineHeight: 17 },
  note:        { fontSize: 12, fontFamily: "Pretendard-Regular", lineHeight: 18, marginTop: 2 },
  reportBtn:   {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#EBF5FB", borderRadius: 10, borderWidth: 1, borderColor: "#B8DCF0",
    paddingHorizontal: 12, paddingVertical: 9,
  },
  reportBtnText: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#4EA7D8", flex: 1 },
});
