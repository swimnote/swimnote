import { LucideIcon } from "@/components/common/LucideIcon";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

interface Props {
  currentLevel: string | number | null;
  prevLevel: string | number | null;
  achievedDate?: string | null;
  note?: string | null;
  teacherName?: string | null;
}

function fmt(d: string) {
  const dt = new Date(d.includes("T") ? d : d + "T00:00:00");
  return dt.toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" });
}

export function ParentGrowthCard({ currentLevel, prevLevel, achievedDate, note, teacherName }: Props) {
  if (!currentLevel) return null;

  const levelUp = prevLevel && currentLevel !== prevLevel;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.iconBg, { backgroundColor: "#DCFCE7" }]}>
          <LucideIcon name="trending-up" size={16} color="#16A34A" />
        </View>
        <Text style={[styles.title, { color: C.text }]}>성장 현황</Text>
      </View>

      <View style={styles.levelRow}>
        <View style={styles.levelBadge}>
          <Text style={styles.levelLabel}>현재 레벨</Text>
          <Text style={styles.levelValue}>{currentLevel}</Text>
        </View>
        {levelUp && (
          <View style={styles.upRow}>
            <LucideIcon name="arrow-up" size={14} color="#16A34A" />
            <Text style={[styles.upTxt, { color: "#16A34A" }]}>레벨 상승</Text>
          </View>
        )}
      </View>

      {achievedDate && (
        <Text style={[styles.sub, { color: C.textMuted }]}>
          달성일 {fmt(achievedDate)}{teacherName ? ` · ${teacherName} 선생님` : ""}
        </Text>
      )}
      {note ? (
        <Text style={[styles.note, { color: C.textSecondary }]} numberOfLines={2}>{note}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 20,
    marginTop: 12,
    borderRadius: 16,
    backgroundColor: C.card,
    padding: 14,
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconBg: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  levelRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  levelBadge: {
    backgroundColor: "#DCFCE7", borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 8, gap: 2,
  },
  levelLabel: { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#16A34A" },
  levelValue: { fontSize: 22, fontFamily: "Pretendard-Regular", color: "#15803D" },
  upRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  upTxt: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  sub: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  note: { fontSize: 12, fontFamily: "Pretendard-Regular", lineHeight: 18 },
});
