import { LucideIcon } from "@/components/common/LucideIcon";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

interface TodoItem {
  icon: string;
  color: string;
  label: string;
  onPress: () => void;
}

interface Props {
  items: TodoItem[];
}

export function ParentTodoCard({ items }: Props) {
  if (items.length === 0) return null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.dot, { backgroundColor: "#EF4444" }]} />
        <Text style={[styles.title, { color: C.text }]}>오늘 확인할 것</Text>
      </View>
      {items.map((item, i) => (
        <Pressable
          key={i}
          style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
          onPress={item.onPress}
        >
          <View style={[styles.iconBg, { backgroundColor: item.color + "18" }]}>
            <LucideIcon name={item.icon} size={15} color={item.color} />
          </View>
          <Text style={[styles.rowLabel, { color: C.text }]}>{item.label}</Text>
          <LucideIcon name="chevron-right" size={14} color={C.textMuted} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 20,
    marginTop: 12,
    borderRadius: 16,
    backgroundColor: C.card,
    padding: 14,
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  title: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  row: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 6, borderRadius: 10,
  },
  iconBg: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  rowLabel: { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular" },
});
