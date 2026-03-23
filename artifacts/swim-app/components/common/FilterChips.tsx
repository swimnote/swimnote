/**
 * FilterChips — 상태 필터칩 공통 컴포넌트
 *
 * 규칙:
 * - 기본(wrap=false): 높이 고정(54px) 가로 스크롤 한 줄
 * - wrap=true: flexWrap으로 자동 2줄 배치, 높이 자동
 * - 선택 상태에서는 배경색·글자색·테두리색만 변경
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
  wrap?: boolean;
}

function Chip<T extends string>({
  chip, active, onChange,
}: { chip: FilterChipItem<T>; active: T; onChange: (k: T) => void }) {
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
}

export function FilterChips<T extends string>({ chips, active, onChange, wrap = false }: FilterChipsProps<T>) {
  if (wrap) {
    return (
      <View style={s.wrapWrapper}>
        {chips.map(chip => (
          <Chip key={chip.key} chip={chip} active={active} onChange={onChange} />
        ))}
      </View>
    );
  }

  return (
    <View style={s.wrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.scroll}
        contentContainerStyle={s.row}
        keyboardShouldPersistTaps="handled"
      >
        {chips.map(chip => (
          <Chip key={chip.key} chip={chip} active={active} onChange={onChange} />
        ))}
      </ScrollView>
    </View>
  );
}

const CHIP_H    = 34;
const PAD_V     = 10;
const WRAPPER_H = CHIP_H + PAD_V * 2; // = 54

const s = StyleSheet.create({
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
  wrapWrapper: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: PAD_V,
    backgroundColor: C.background,
  },
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
