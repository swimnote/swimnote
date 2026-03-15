import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

interface LinkItem {
  icon: string;
  label: string;
  action: string;
  onPress: () => void;
}

interface Props {
  links: LinkItem[];
}

export function AuthEntryLinks({ links }: Props) {
  return (
    <View style={styles.wrap}>
      {links.map((item, idx) => (
        <React.Fragment key={idx}>
          {idx > 0 && <View style={styles.divider} />}
          <Pressable style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]} onPress={item.onPress}>
            <Feather name={item.icon as any} size={12} color={C.textMuted} />
            <Text style={styles.label}>{item.label}</Text>
            <Text style={styles.action}>{item.action}</Text>
            <Feather name="chevron-right" size={12} color={C.tint} />
          </Pressable>
        </React.Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: C.card,
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  divider: {
    height: 1,
    backgroundColor: C.border,
    marginHorizontal: 16,
  },
  label: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
  },
  action: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: C.tint,
  },
});
