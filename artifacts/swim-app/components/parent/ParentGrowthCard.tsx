import { LucideIcon } from "@/components/common/LucideIcon";
import { Award, TrendingUp } from "lucide-react-native";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

interface GrowthData {
  current_level: string;
  achieved_date?: string | null;
  prev_level?: string | null;
  note?: string | null;
  teacher_name?: string | null;
}

interface Props {
  growth: GrowthData | null;
  onPress: () => void;
}

function fmt(d: string) {
  const dt = new Date(d.includes("T") ? d : d + "T00:00:00");
  return dt.toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" });
}

export function ParentGrowthCard({ growth, onPress }: Props) {
  const hasLevelUp = !!(growth?.prev_level && growth.prev_level !== growth.current_level);

  return (
    <Pressable
      style={({ pressed }) => [styles.card, { opacity: pressed ? 0.92 : 1 }]}
      onPress={onPress}
    >
      {/* 헤더 */}
      <View style={styles.header}>
        <View style={[styles.iconBg, { backgroundColor: "#DCFCE7" }]}>
          <TrendingUp size={16} color="#16A34A" />
        </View>
        <Text style={[styles.title, { color: C.text }]}>현재 레벨</Text>
        {hasLevelUp && (
          <View style={styles.upBadge}>
            <LucideIcon name="arrow-up" size={11} color="#16A34A" />
            <Text style={styles.upBadgeTxt}>레벨 상승</Text>
          </View>
        )}
        <LucideIcon name="chevron-right" size={14} color={C.textMuted} />
      </View>

      {/* 본문 */}
      {growth ? (
        <View style={styles.body}>
          <View style={styles.levelRow}>
            <View style={styles.levelBadge}>
              <Text style={styles.levelValue}>{growth.current_level}</Text>
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              {growth.achieved_date && (
                <Text style={[styles.metaTxt, { color: C.textMuted }]}>
                  달성일 {fmt(growth.achieved_date)}
                </Text>
              )}
              {growth.prev_level && growth.prev_level !== growth.current_level && (
                <Text style={[styles.metaTxt, { color: C.textMuted }]}>
                  이전 {growth.prev_level}
                </Text>
              )}
              {growth.teacher_name && (
                <Text style={[styles.metaTxt, { color: C.textMuted }]}>
                  {growth.teacher_name} 선생님
                </Text>
              )}
            </View>
          </View>
          {growth.note ? (
            <View style={styles.noteBox}>
              <LucideIcon name="message-square" size={11} color="#16A34A" />
              <Text style={[styles.noteTxt, { color: "#15803D" }]} numberOfLines={1}>
                {growth.note}
              </Text>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.empty}>
          <Award size={22} color={C.textMuted} />
          <Text style={[styles.emptyTxt, { color: C.textMuted }]}>아직 레벨 기록이 없습니다</Text>
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
  upBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: "#DCFCE7", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
  },
  upBadgeTxt: { fontSize: 11, color: "#16A34A", fontFamily: "Pretendard-Regular" },
  body: { gap: 8 },
  levelRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  levelBadge: {
    backgroundColor: "#DCFCE7", borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  levelValue: { fontSize: 18, fontFamily: "Pretendard-Regular", color: "#15803D" },
  metaTxt: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  noteBox: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#F0FDF4", borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 6,
  },
  noteTxt: { fontSize: 12, fontFamily: "Pretendard-Regular", flex: 1 },
  empty: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  emptyTxt: { fontSize: 13, fontFamily: "Pretendard-Regular" },
});
