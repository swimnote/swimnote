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
          <Text style={styles.name}>{student.name}</Text>
          <Text style={styles.className}>
            {student.class_group?.name ?? "반 배정 전"}
          </Text>
        </View>
        <ChevronRight size={18} color="rgba(255,255,255,0.6)" />
      </View>

      {(hasUnread || todaySchedule || currentLevel) && (
        <View style={styles.badgeRow}>
          {unreadDiaries > 0 && (
            <View style={styles.badge}>
              <LucideIcon name="book-open" size={11} color={C.tint} />
              <Text style={styles.badgeTxt}>새 일지 {unreadDiaries}건</Text>
            </View>
          )}
          {unreadPhotos > 0 && (
            <View style={styles.badge}>
              <LucideIcon name="image" size={11} color={C.tint} />
              <Text style={styles.badgeTxt}>새 사진 {unreadPhotos}장</Text>
            </View>
          )}
          {todaySchedule && (
            <View style={styles.badge}>
              <LucideIcon name="clock" size={11} color={C.tint} />
              <Text style={styles.badgeTxt}>오늘 {todaySchedule}</Text>
            </View>
          )}
          {currentLevel && (
            <View style={styles.badge}>
              <LucideIcon name="award" size={11} color={C.tint} />
              <Text style={styles.badgeTxt}>레벨 {currentLevel}</Text>
            </View>
          )}
        </View>
      )}

      {!hasUnread && !todaySchedule && (
        <Text style={styles.allClear}>오늘 새 소식이 없습니다</Text>
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
    backgroundColor: C.tint,
    padding: 16,
    gap: 12,
    shadowColor: C.tint,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  topRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatarWrap: {
    width: 46, height: 46, borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center", justifyContent: "center",
  },
  avatarTxt: { fontSize: 20, fontFamily: "Pretendard-Regular", color: "#fff" },
  name: { fontSize: 18, fontFamily: "Pretendard-Regular", color: "#fff" },
  className: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "rgba(255,255,255,0.75)", marginTop: 2 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#fff",
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 20,
  },
  badgeTxt: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.tint },
  allClear: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "rgba(255,255,255,0.6)" },
});
