/**
 * FilterChips — 상태 필터칩 공통 컴포넌트
 *
 * wrap=false(기본): 높이 고정 54px, 가로 스크롤 한 줄
 * wrap=true:        COLS 고정 개수로 나눈 2줄 그리드, 모든 칩 동일 너비
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import React from "react";
import {
  Pressable, ScrollView, StyleSheet, Text,
  useWindowDimensions, View,
} from "react-native";
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
  wrapCols?: number;
}

/* ── 단일 칩 ─────────────────────────────────────────── */
function Chip<T extends string>({
  chip, active, onChange, fixedWidth, showIcon = true,
}: {
  chip: FilterChipItem<T>;
  active: T;
  onChange: (k: T) => void;
  fixedWidth?: number;
  showIcon?: boolean;
}) {
  const isActive = chip.key === active;
  const color    = chip.activeColor ?? C.tint;
  const bg       = chip.activeBg   ?? C.tintLight;

  return (
    <Pressable
      onPress={() => onChange(chip.key)}
      hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
      style={[
        s.chip,
        fixedWidth != null && { width: fixedWidth },
        { backgroundColor: isActive ? bg : C.card, borderColor: isActive ? color : C.border },
      ]}
    >
      {showIcon && chip.icon ? (
        <LucideIcon name={chip.icon} size={11} color={isActive ? color : C.textMuted} />
      ) : null}
      <Text
        style={[s.label, { color: isActive ? color : C.textSecondary }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {chip.label}
      </Text>
      {typeof chip.count === "number" ? (
        <View style={[s.countBubble, { backgroundColor: isActive ? color : C.border }]}>
          <Text style={[s.countText, { color: isActive ? "#fff" : C.textSecondary }]}>
            {chip.count > 99 ? "99+" : chip.count}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/* ── 메인 컴포넌트 ───────────────────────────────────── */
export function FilterChips<T extends string>({
  chips, active, onChange, wrap = false, wrapCols = 5,
}: FilterChipsProps<T>) {
  const { width: screenW } = useWindowDimensions();

  if (wrap) {
    const GAP   = 7;
    const PAD_H = 16;
    const chipW = Math.floor(
      (screenW - PAD_H * 2 - GAP * (wrapCols - 1)) / wrapCols,
    );

    const rows: FilterChipItem<T>[][] = [];
    for (let i = 0; i < chips.length; i += wrapCols) {
      rows.push(chips.slice(i, i + wrapCols));
    }

    return (
      <View style={[s.wrapWrapper, { paddingHorizontal: PAD_H, gap: GAP }]}>
        {rows.map((row, ri) => (
          <View key={ri} style={[s.wrapRow, { gap: GAP, justifyContent: "center" }]}>
            {row.map(chip => (
              <Chip key={chip.key} chip={chip} active={active} onChange={onChange} fixedWidth={chipW} showIcon={false} />
            ))}
          </View>
        ))}
      </View>
    );
  }

  /* ── 기본: 가로 스크롤 ─────────────────────────────── */
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

/* ── 스타일 ──────────────────────────────────────────── */
const CHIP_H    = 30;
const PAD_V     = 9;
const WRAPPER_H = CHIP_H + PAD_V * 2; // = 48

const s = StyleSheet.create({
  /* 가로 스크롤 모드 */
  wrapper: { height: WRAPPER_H, backgroundColor: C.background, overflow: "visible" },
  scroll:  { flex: 1 },
  row: {
    flexDirection: "row", alignItems: "center",
    gap: 7, paddingHorizontal: 16, paddingVertical: PAD_V,
  },

  /* wrap 모드 */
  wrapWrapper: {
    backgroundColor: C.background,
    paddingVertical: 10,
  },
  wrapRow: {
    flexDirection: "row",
    alignItems: "center",
  },

  /* 공통 칩 */
  chip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    height: CHIP_H,
    paddingHorizontal: 6,
    borderRadius: 15,
    borderWidth: 1.5,
  },
  label: {
    fontSize: 11,
    fontFamily: "Pretendard-Medium",
    includeFontPadding: false,
    lineHeight: 15,
    textAlign: "center",
  },
  countBubble: {
    minWidth: 16, height: 16, borderRadius: 8,
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: 3,
  },
  countText: { fontSize: 9, fontFamily: "Pretendard-SemiBold" },
});
