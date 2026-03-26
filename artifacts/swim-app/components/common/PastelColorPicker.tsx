/**
 * PastelColorPicker — 반 색상 선택 파스텔 컬러 피커
 *
 * 사용법:
 *   <PastelColorPicker value={color} onChange={setColor} />
 *
 * - 버튼 클릭 시 색상표가 아래로 펼쳐짐
 * - 선택된 색상에 체크 + 굵은 테두리
 * - 흰색은 회색 테두리로 구분
 */
import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

export const PASTEL_COLORS = [
  "#FFFFFF",
  "#FEE2E2", "#FECACA",
  "#FEF3C7", "#FDE68A",
  "#DCFCE7", "#BBF7D0", "#D1FAE5", "#CCFBF1",
  "#E0F2FE", "#BAE6FD", "#BFDBFE",
  "#DDD6FE", "#E9D5FF", "#F5D0FE",
  "#FBCFE8", "#FCE7F3",
  "#F1F5F9", "#E2E8F0", "#D1D5DB",
];

interface Props {
  selected: string;
  onSelect: (color: string) => void;
  label?: string;
}

export default function PastelColorPicker({ selected, onSelect, label = "반 색상" }: Props) {
  const [open, setOpen] = useState(false);

  const value = selected || "#FFFFFF";
  const isWhite = value === "#FFFFFF";
  const displayColor = value;

  return (
    <View>
      <Pressable style={pc.row} onPress={() => setOpen(v => !v)}>
        <View style={pc.labelRow}>
          <Feather name="droplet" size={14} color={C.textSecondary} />
          <Text style={pc.label}>{label}</Text>
        </View>
        <View style={pc.previewRow}>
          <View style={[
            pc.circle,
            { backgroundColor: displayColor },
            isWhite && pc.circleWhite,
          ]} />
          <Text style={pc.previewText}>{isWhite ? "기본 (흰색)" : displayColor}</Text>
          <Feather name={open ? "chevron-up" : "chevron-down"} size={14} color={C.textMuted} />
        </View>
      </Pressable>

      {open && (
        <View style={pc.panel}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={pc.chipRow}>
            {PASTEL_COLORS.map(col => {
              const isSelected = value === col;
              const isWhiteChip = col === "#FFFFFF";
              return (
                <Pressable
                  key={col}
                  style={[
                    pc.chip,
                    { backgroundColor: col },
                    isWhiteChip && pc.chipWhite,
                    isSelected && pc.chipSelected,
                  ]}
                  onPress={() => { onSelect(col); setOpen(false); }}
                >
                  {isSelected && (
                    <Feather name="check" size={13} color="#111827" />
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const pc = StyleSheet.create({
  row: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12, paddingHorizontal: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary },
  previewRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  previewText: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textMuted },
  circle: {
    width: 22, height: 22, borderRadius: 11,
  },
  circleWhite: {
    borderWidth: 1.5, borderColor: "#D1D5DB",
  },
  panel: {
    backgroundColor: "#FAFAFA",
    borderBottomWidth: 1, borderBottomColor: C.border,
    paddingVertical: 10,
  },
  chipRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, gap: 8,
  },
  chip: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "transparent",
  },
  chipWhite: {
    borderColor: "#D1D5DB",
  },
  chipSelected: {
    borderWidth: 2.5, borderColor: "#374151",
  },
});
