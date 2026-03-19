/**
 * FilterChips — 상태 필터칩 공통 컴포넌트
 *
 * 규칙:
 * - 높이 고정: chip(34) + paddingVertical(10×2) = 54px 고정
 * - 항상 한 줄 가로 스크롤, 줄 바꿈 없음
 * - 선택 상태에서는 배경색·글자색·테두리색만 변경
 * - overflow visible 확보하여 칩이 잘리지 않도록 함
 */
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

export interface FilterChipItem<T extends string> {
  key: T;
  label: string;
  count?: number;
  activeColor?: string;
  activeBg?: string;
  icon?: React.ComponentProps<typeof Feather>["name"];
}

interface FilterChipsProps<T extends string> {
  chips: FilterChipItem<T>[];
  active: T;
  onChange: (key: T) => void;
}

export function FilterChips<T extends string>({ chips, active, onChange }: FilterChipsProps<T>) {
  return (
    <View style={s.wrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.scroll}
        contentContainerStyle={s.row}
        keyboardShouldPersistTaps="handled"
      >
        {chips.map(chip => {
          const isActive = chip.key === active;
          const color    = chip.activeColor ?? C.tint;
          const bg       = chip.activeBg   ?? C.tintLight;

          return (
            <Pressable
              key={chip.key}
              onPress={() => onChange(chip.key)}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              style={[
                s.chip,
                {
                  backgroundColor: isActive ? bg    : C.card,
                  borderColor:     isActive ? color : C.border,
                },
              ]}
            >
              {chip.icon ? (
                <Feather name={chip.icon} size={12} color={isActive ? color : C.textMuted} />
              ) : null}
              <Text style={[s.label, { color: isActive ? color : C.textSecondary }]}>
                {chip.label}
              </Text>
              {typeof chip.count === "number" ? (
                <View style={[s.countBubble, { backgroundColor: isActive ? color : C.border }]}>
                  <Text style={[s.countText, { color: isActive ? "#fff" : C.textSecondary }]}>
                    {chip.count}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const CHIP_H        = 34;   // 칩 높이
const PAD_V         = 10;   // 상하 패딩
const WRAPPER_H     = CHIP_H + PAD_V * 2; // = 54

const s = StyleSheet.create({
  /* 높이를 명시적으로 고정 — ScrollView가 높이를 못 보고하는 문제 방지 */
  wrapper: {
    height: WRAPPER_H,
    backgroundColor: C.background,
    overflow: "visible",
  },
  scroll: {
    flex: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: PAD_V,
  },
  /* ★ 크기 고정 — 선택 상태에 무관하게 절대 불변 */
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: CHIP_H,
    paddingHorizontal: 12,
    borderRadius: 17,
    borderWidth: 1.5,
  },
  label: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    includeFontPadding: false,
    lineHeight: 16,
  },
  countBubble: {
    minWidth: 18, height: 18, borderRadius: 9,
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: 4,
  },
  countText: { fontSize: 10, fontFamily: "Inter_700Bold" },
});
