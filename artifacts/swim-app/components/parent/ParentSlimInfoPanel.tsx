/**
 * ParentSlimInfoPanel
 *
 * ParentChildHeroCard의 슬림 대체 컴포넌트.
 * 기존 HeroCard와 동일한 Props를 그대로 수용한다.
 * 추가 API 호출·상태관리 없음.
 *
 * 레이아웃:
 *   [LevelBadge sm] | 이름 · 반 · 출석   | [오늘수업 Badge (조건부)]
 *
 * 오늘 수업이 있는 경우에만 오른쪽 Badge를 렌더링.
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import { LevelBadge, type LevelDef } from "@/components/common/LevelBadge";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

export interface ParentSlimInfoPanelProps {
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

export function ParentSlimInfoPanel({
  student,
  attended,
  total,
  todaySchedule,
  currentLevel,
  levelDef,
  onPress,
}: ParentSlimInfoPanelProps) {
  const cg = student.class_group;
  const className = cg?.name ?? null;
  const hasToday = !!todaySchedule;

  return (
    <Pressable
      style={({ pressed }) => [styles.panel, { opacity: pressed ? 0.93 : 1 }]}
      onPress={onPress}
    >
      {/* 왼쪽: 레벨 뱃지 */}
      <LevelBadge level={levelDef ?? null} size="sm" />

      {/* 중앙: 이름 · 반 · 출석 */}
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {student.name}
          </Text>
          {currentLevel ? (
            <View style={[styles.levelPill, { backgroundColor: (levelDef?.badge_color ?? "#2EC4B6") + "22" }]}>
              <Text style={[styles.levelPillTxt, { color: levelDef?.badge_color ?? "#2EC4B6" }]}>
                {String(currentLevel)}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.metaRow}>
          {/* 반 정보 */}
          {className ? (
            <Text style={styles.meta} numberOfLines={1}>
              {className}
              {cg?.schedule_time ? ` · ${cg.schedule_time}` : ""}
            </Text>
          ) : (
            <Text style={[styles.meta, { color: C.textMuted }]}>반 정보 없음</Text>
          )}

          {/* 구분점 */}
          {total > 0 ? <Text style={styles.dot}>·</Text> : null}

          {/* 출석 */}
          {total > 0 ? (
            <View style={styles.attendRow}>
              <LucideIcon name="calendar-check" size={11} color="#2563EB" />
              <Text style={styles.meta}>
                <Text style={styles.attendNum}>{attended}</Text>/{total}회
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* 오른쪽: 오늘 수업 Badge — 오늘 수업이 있을 때만 렌더링 */}
      {hasToday ? (
        <View style={styles.todayBadge}>
          <LucideIcon name="clock" size={11} color="#2EC4B6" />
          <Text style={styles.todayTxt}>{todaySchedule}</Text>
        </View>
      ) : null}

      {/* 화살표 */}
      <LucideIcon name="chevron-right" size={15} color={C.textMuted} style={styles.arrow} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 16,
    backgroundColor: C.card,
    paddingVertical: 13,
    paddingHorizontal: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  info: {
    flex: 1,
    gap: 3,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  name: {
    fontSize: 16,
    fontFamily: "Pretendard-Regular",
    color: C.text,
    flexShrink: 1,
  },
  levelPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  levelPillTxt: {
    fontSize: 11,
    fontFamily: "Pretendard-Regular",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flexWrap: "wrap",
  },
  meta: {
    fontSize: 12,
    fontFamily: "Pretendard-Regular",
    color: C.textSecondary,
  },
  dot: {
    fontSize: 11,
    color: C.textMuted,
  },
  attendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  attendNum: {
    fontFamily: "Pretendard-Regular",
    color: C.text,
  },
  todayBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#E6FAF8",
    borderRadius: 20,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "#2EC4B6",
  },
  todayTxt: {
    fontSize: 12,
    fontFamily: "Pretendard-Regular",
    color: "#2EC4B6",
  },
  arrow: {
    marginLeft: 2,
  },
});
