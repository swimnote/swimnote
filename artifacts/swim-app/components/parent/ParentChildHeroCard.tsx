import { ChevronRight } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

interface Props {
  student: {
    id: string;
    name: string;
    class_group?: { name?: string; schedule_days?: string; schedule_time?: string } | null;
  };
  unreadPhotos: number;
  unreadDiaries: number;
  todaySchedule: string | null;
  currentLevel: string | number | null;
  onPress: () => void;
}

export function ParentChildHeroCard({ student, unreadPhotos, unreadDiaries, todaySchedule, currentLevel, onPress }: Props) {
  const hasUnread = unreadPhotos > 0 || unreadDiaries > 0;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, { opacity: pressed ? 0.9 : 1 }]}
      onPress={onPress}
    >
      <View style={styles.topRow}>
        <View style={styles.avatarWrap}>
          <Text style={styles.avatarTxt}>{student.name[0]}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: C.text }]}>{student.name}</Text>
          <Text style={[styles.className, { color: C.textSecondary }]}>
            {student.class_group?.name ?? "반 배정 전"}
          </Text>
        </View>
        <ChevronRight size={18} color={C.textMuted} />
      </View>

      {(hasUnread || todaySchedule || currentLevel) && (
        <View style={styles.badgeRow}>
          {unreadDiaries > 0 && (
            <View style={[styles.badge, { backgroundColor: C.tintLight }]}>
              <LucideIcon name="book-open" size={11} color={C.tint} />
              <Text style={[styles.badgeTxt, { color: C.tint }]}>새 일지 {unreadDiaries}건</Text>
            </View>
          )}
          {unreadPhotos > 0 && (
            <View style={[styles.badge, { backgroundColor: "#FEF3C7" }]}>
              <LucideIcon name="image" size={11} color="#EA580C" />
              <Text style={[styles.badgeTxt, { color: "#EA580C" }]}>새 사진 {unreadPhotos}장</Text>
            </View>
          )}
          {todaySchedule && (
            <View style={[styles.badge, { backgroundColor: C.iconBlueBg }]}>
              <LucideIcon name="clock" size={11} color={C.iconBlue} />
              <Text style={[styles.badgeTxt, { color: C.iconBlue }]}>오늘 {todaySchedule}</Text>
            </View>
          )}
          {currentLevel && (
            <View style={[styles.badge, { backgroundColor: C.iconGreenBg }]}>
              <LucideIcon name="award" size={11} color={C.iconGreen} />
              <Text style={[styles.badgeTxt, { color: C.iconGreen }]}>레벨 {currentLevel}</Text>
            </View>
          )}
        </View>
      )}

      {!hasUnread && !todaySchedule && (
        <Text style={[styles.allClear, { color: C.textMuted }]}>오늘 새 소식이 없습니다</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 20,
    backgroundColor: C.card,
    padding: 16,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
  },
  topRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatarWrap: {
    width: 46, height: 46, borderRadius: 14,
    backgroundColor: C.tintLight,
    alignItems: "center", justifyContent: "center",
  },
  avatarTxt: { fontSize: 20, fontFamily: "Pretendard-Regular", color: C.tint },
  name: { fontSize: 18, fontFamily: "Pretendard-Regular" },
  className: { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 20,
  },
  badgeTxt: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  allClear: { fontSize: 12, fontFamily: "Pretendard-Regular" },
});
