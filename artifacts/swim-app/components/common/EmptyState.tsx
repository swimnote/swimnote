import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

interface EmptyStateProps {
  icon?: React.ComponentProps<typeof Feather>["name"];
  title: string;
  subtitle?: string;
}

export function EmptyState({ icon = "inbox", title, subtitle }: EmptyStateProps) {
  return (
    <View style={s.root}>
      <View style={[s.iconWrap, { backgroundColor: C.tintLight }]}>
        <Feather name={icon} size={32} color={C.tint} />
      </View>
      <Text style={[s.title, { color: C.text }]}>{title}</Text>
      {subtitle ? <Text style={[s.sub, { color: C.textMuted }]}>{subtitle}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 80,
    gap: 12,
  },
  iconWrap: {
    width: 72, height: 72, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
  },
  title: { fontSize: 15, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  sub:   { fontSize: 12, fontFamily: "Inter_400Regular",  textAlign: "center", lineHeight: 18, paddingHorizontal: 30 },
});
