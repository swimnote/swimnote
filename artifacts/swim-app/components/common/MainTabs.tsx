import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

export interface TabItem<T extends string> {
  key: T;
  label: string;
  badge?: number;
}

interface MainTabsProps<T extends string> {
  tabs: TabItem<T>[];
  active: T;
  onChange: (key: T) => void;
  accentColor?: string;
}

export function MainTabs<T extends string>({ tabs, active, onChange, accentColor }: MainTabsProps<T>) {
  const tint = accentColor ?? C.tint;
  return (
    <View style={[s.row, { borderBottomColor: C.border }]}>
      {tabs.map(tab => {
        const isActive = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            style={[s.item, isActive && { borderBottomColor: tint }]}
            onPress={() => onChange(tab.key)}
          >
            <Text style={[s.label, { color: isActive ? tint : C.textSecondary }]}>
              {tab.label}
            </Text>
            {typeof tab.badge === "number" && tab.badge > 0 ? (
              <View style={[s.badge, { backgroundColor: C.error }]}>
                <Text style={s.badgeText}>{tab.badge > 99 ? "99+" : tab.badge}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    backgroundColor: C.background,
  },
  item: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    gap: 6,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  label: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  badge: {
    minWidth: 18, height: 18, borderRadius: 9,
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff" },
});
