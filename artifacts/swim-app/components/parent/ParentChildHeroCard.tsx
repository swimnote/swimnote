import { LucideIcon } from "@/components/common/LucideIcon";
import { LevelBadge, type LevelDef } from "@/components/common/LevelBadge";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

interface Props {
  student: {
    id: string;
    name: string;
    class_group?: { name?: string; schedule_days?: string; schedule_time?: string } | null;
    access_blocked?: boolean;
  };
  attended: number;
  total: number;
  todaySchedule: string | null;
  currentLevel: string | number | null;
  levelDef?: LevelDef | null;
  onPress: () => void;
}

export function ParentChildHeroCard({ student, attended, total, todaySchedule, currentLevel, levelDef, onPress }: Props) {
  const cg = student.class_group;
  const hasClass = !!cg?.name;
  const chipBg = levelDef?.badge_color ? levelDef.badge_color + "22" : C.brandSoft;
  const chipTxt = levelDef?.badge_color ?? C.brandStrong;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, { opacity: pressed ? 0.95 : 1 }]}
      onPress={onPress}
    >
      {/* 상단: 이름 + 레벨 + 화살표 */}
      <View style={styles.topRow}>
        {currentLevel && levelDef ? (
          <LevelBadge level={levelDef} size="sm" />
        ) : (
          <View style={[styles.avatar, { backgroundColor: C.brandSoft }]}>
            <LucideIcon name="award" size={20} color={C.brandStrong} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={[styles.name, { color: C.text }]}>{student.name}</Text>
            {currentLevel ? (
              <View style={[styles.levelChip, { backgroundColor: chipBg }]}>
                <Text style={[styles.levelChipTxt, { color: chipTxt }]}>{String(currentLevel)}</Text>
              </View>
            ) : null}
          </View>
          {hasClass ? (
            <Text style={[styles.sub, { color: C.textSecondary }]}>
              {cg!.name}{cg!.schedule_time ? ` · ${cg!.schedule_time}` : ""}
            </Text>
          ) : (
            <Text style={[styles.sub, { color: C.textMuted }]}>반 정보가 아직 없습니다</Text>
          )}
        </View>
        <LucideIcon name="chevron-right" size={16} color={C.textMuted} />
      </View>

      {/* 구분선 */}
      <View style={[styles.hr, { backgroundColor: C.border }]} />

      {/* 하단: 출석 + 오늘 수업 */}
      <View style={styles.bottomRow}>
        {/* 이번달 출석 */}
        <View style={styles.chip}>
          <LucideIcon name="calendar-check" size={13} color="#2563EB" />
          {total > 0 ? (
            <Text style={[styles.chipTxt, { color: C.textSecondary }]}>
              이번달{" "}
              <Text style={{ color: C.text, fontFamily: "Pretendard-SemiBold" }}>{attended}</Text>
              /{total}회
            </Text>
          ) : (
            <Text style={[styles.chipTxt, { color: C.textMuted }]}>이번달 출석 기록 없음</Text>
          )}
        </View>

        {/* 오늘 수업 */}
        {todaySchedule ? (
          <View style={[styles.todayChip, { backgroundColor: C.brandSoft, borderColor: C.brandStrong }]}>
            <LucideIcon name="clock" size={13} color={C.brandStrong} />
            <Text style={[styles.chipTxt, { color: C.brandStrong, fontFamily: "Pretendard-SemiBold" }]}>
              오늘 {todaySchedule} 수업
            </Text>
          </View>
        ) : (
          <View style={[styles.todayChip, { backgroundColor: C.background, borderColor: C.border }]}>
            <Text style={[styles.chipTxt, { color: C.textMuted }]}>오늘 수업 없음</Text>
          </View>
        )}
      </View>
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
  avatar: {
    width: 28, height: 28, borderRadius: 8,
    alignItems: "center", justifyContent: "center",
  },
  name: { fontSize: 18, fontFamily: "Pretendard-Regular" },
  sub: { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 },
  hr: { height: 1 },
  bottomRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  chip: { flexDirection: "row", alignItems: "center", gap: 5 },
  chipTxt: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  todayChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 20, borderWidth: 1,
  },
  levelChip: {
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 8,
  },
  levelChipTxt: {
    fontSize: 11, fontFamily: "Pretendard-Regular",
  },
});
