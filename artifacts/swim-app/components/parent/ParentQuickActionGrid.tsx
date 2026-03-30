import { LucideIcon } from "@/components/common/LucideIcon";
import React from "react";
import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;
const { width: SW } = Dimensions.get("window");
const COL = 3;
const CELL_W = Math.floor((SW - 40 - 16) / COL);

interface QuickAction {
  icon: string;
  label: string;
  sub?: string | null;
  badge?: number | null;
  color: string;
  bg: string;
  onPress: () => void;
}

interface Props {
  actions: QuickAction[];
}

function ActionCell({ icon, label, sub, badge, color, bg, onPress }: QuickAction) {
  return (
    <Pressable
      style={({ pressed }) => [styles.cell, { width: CELL_W, opacity: pressed ? 0.75 : 1 }]}
      onPress={onPress}
    >
      <View style={styles.iconWrap}>
        <View style={[styles.iconBg, { backgroundColor: bg }]}>
          <LucideIcon name={icon} size={26} color={color} />
        </View>
        {badge !== null && badge !== undefined && badge > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeTxt}>{badge > 99 ? "99+" : String(badge)}</Text>
          </View>
        )}
      </View>
      <Text style={[styles.label, { color: C.text }]}>{label}</Text>
      {sub ? (
        <Text style={[styles.sub, { color: C.textMuted }]} numberOfLines={1}>{sub}</Text>
      ) : null}
    </Pressable>
  );
}

export function ParentQuickActionGrid({ actions }: Props) {
  return (
    <View style={styles.grid}>
      {actions.map((a, i) => (
        <ActionCell key={i} {...a} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 20, paddingTop: 12 },
  cell: { alignItems: "center", gap: 5, paddingVertical: 10 },
  iconWrap: { position: "relative" },
  iconBg: { width: 60, height: 60, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute", top: -5, right: -5,
    minWidth: 20, height: 20, borderRadius: 10,
    backgroundColor: "#EF4444",
    alignItems: "center", justifyContent: "center", paddingHorizontal: 4,
    borderWidth: 2, borderColor: "#fff",
  },
  badgeTxt: { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#fff" },
  label: { fontSize: 12, fontFamily: "Pretendard-Regular", textAlign: "center" },
  sub: { fontSize: 10, fontFamily: "Pretendard-Regular", textAlign: "center" },
});
