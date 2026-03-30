import { LucideIcon } from "@/components/common/LucideIcon";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

interface Props {
  attended: number;
  total: number;
  latestStatus: string | null;
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  present: { label: "출석", color: "#16A34A" },
  absent: { label: "결석", color: "#EF4444" },
  makeup: { label: "보강", color: "#F59E0B" },
  late: { label: "지각", color: "#6366F1" },
  excused: { label: "공결", color: "#0369A1" },
};

export function ParentAttendanceCard({ attended, total, latestStatus }: Props) {
  if (total === 0) return null;

  const rate = total > 0 ? Math.round((attended / total) * 100) : 0;
  const statusInfo = latestStatus ? STATUS_MAP[latestStatus] : null;
  const month = new Date().toLocaleDateString("ko-KR", { month: "long" });

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.iconBg, { backgroundColor: "#DBEAFE" }]}>
          <LucideIcon name="calendar-check" size={16} color="#2563EB" />
        </View>
        <Text style={[styles.title, { color: C.text }]}>{month} 출석</Text>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={[styles.statNum, { color: C.text }]}>{attended}<Text style={[styles.statUnit, { color: C.textMuted }]}> / {total}회</Text></Text>
          <Text style={[styles.statLabel, { color: C.textMuted }]}>출석 횟수</Text>
        </View>
        <View style={[styles.divider, { backgroundColor: C.border }]} />
        <View style={styles.stat}>
          <Text style={[styles.statNum, { color: rate >= 80 ? "#16A34A" : rate >= 60 ? "#F59E0B" : "#EF4444" }]}>
            {rate}<Text style={[styles.statUnit, { color: C.textMuted }]}>%</Text>
          </Text>
          <Text style={[styles.statLabel, { color: C.textMuted }]}>출석률</Text>
        </View>
        {statusInfo && (
          <>
            <View style={[styles.divider, { backgroundColor: C.border }]} />
            <View style={styles.stat}>
              <Text style={[styles.statNum, { color: statusInfo.color, fontSize: 14 }]}>{statusInfo.label}</Text>
              <Text style={[styles.statLabel, { color: C.textMuted }]}>최근 수업</Text>
            </View>
          </>
        )}
      </View>
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
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconBg: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  statsRow: { flexDirection: "row", alignItems: "center" },
  stat: { flex: 1, alignItems: "center", gap: 3 },
  statNum: { fontSize: 22, fontFamily: "Pretendard-Regular" },
  statUnit: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  statLabel: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  divider: { width: 1, height: 36, marginHorizontal: 4 },
});
