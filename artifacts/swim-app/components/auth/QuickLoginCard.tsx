import { LogIn } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

const ROLE_ICONS: Record<string, string> = {
  super_admin: "shield",
  pool_admin: "settings",
  teacher: "user-check",
  parent: "heart",
};

interface Props {
  id: string;
  pw: string;
  label: string;
  roleKey: string;
  color: string;
  disabled?: boolean;
  onPress: () => void;
}

export function QuickLoginCard({ id, pw, label, roleKey, color, disabled, onPress }: Props) {
  const icon = (ROLE_ICONS[roleKey] ?? "user") as any;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        { borderColor: color + "40", opacity: pressed || disabled ? 0.75 : 1 },
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <View style={[styles.iconWrap, { backgroundColor: color + "18" }]}>
        <LucideIcon name={icon} size={16} color={color} />
      </View>
      <View style={styles.info}>
        <Text style={styles.label} numberOfLines={1}>{label}</Text>
        <Text style={styles.cred}>ID {id} / PW {pw}</Text>
      </View>
      <LogIn size={13} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 58,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    backgroundColor: C.card,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  info: { flex: 1, gap: 2 },
  label: { fontSize: 13, fontFamily: "Pretendard-Medium", color: C.text },
  cred: { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },
});
