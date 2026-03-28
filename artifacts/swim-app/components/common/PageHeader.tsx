import { LucideIcon } from "@/components/common/LucideIcon";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const C = Colors.light;

interface ActionButton {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  onPress: () => void;
  color?: string;
}

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: ActionButton;
  /** 커스텀 우측 요소 */
  rightSlot?: React.ReactNode;
}

export function PageHeader({ title, subtitle, action, rightSlot }: PageHeaderProps) {
  const insets = useSafeAreaInsets();
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 16);

  return (
    <View style={[s.root, { paddingTop: topPad }]}>
      <View style={s.textCol}>
        <Text style={s.title} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={s.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {rightSlot ?? null}
      {action && !rightSlot ? (
        <Pressable
          style={({ pressed }) => [s.btn, { backgroundColor: action.color ?? C.tint, opacity: pressed ? 0.85 : 1 }]}
          onPress={action.onPress}
        >
          <LucideIcon name={action.icon} size={16} color="#fff" />
          <Text style={s.btnText}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 10,
    backgroundColor: C.background,
  },
  textCol: { flex: 1 },
  title: { fontSize: 22, fontFamily: "Pretendard-Regular", color: C.text },
  subtitle: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 2 },
  btn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10,
  },
  btnText: { color: "#fff", fontSize: 13, fontFamily: "Pretendard-Regular" },
});
