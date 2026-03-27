import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

export interface LevelDef {
  level_order: number;
  level_name: string;
  level_description?: string;
  learning_content?: string;
  promotion_test_rule?: string;
  badge_type?: string;
  badge_label?: string;
  badge_color?: string;
  badge_text_color?: string;
  is_active?: boolean;
}

interface Props {
  level: LevelDef | null | undefined;
  size?: "sm" | "md" | "lg";
  showName?: boolean;
}

const SIZES = {
  sm: { badge: 28, font: 12, radius: 8, nameFontSize: 11 },
  md: { badge: 38, font: 16, radius: 10, nameFontSize: 13 },
  lg: { badge: 56, font: 24, radius: 14, nameFontSize: 15 },
};

export function LevelBadge({ level, size = "md", showName = false }: Props) {
  if (!level) {
    const s = SIZES[size];
    return (
      <View style={[styles.badge, { width: s.badge, height: s.badge, borderRadius: s.radius, backgroundColor: "#E5E7EB" }]}>
        <Text style={[styles.label, { fontSize: s.font, color: "#64748B" }]}>-</Text>
      </View>
    );
  }

  const s = SIZES[size];
  const badgeType = level.badge_type ?? "text";
  const badgeColor = level.badge_color ?? "#2EC4B6";
  const textColor = level.badge_text_color ?? "#FFFFFF";
  const badgeLabel = level.badge_label ?? level.level_name ?? String(level.level_order);

  return (
    <View style={styles.wrap}>
      <View style={[
        styles.badge,
        { width: s.badge, height: s.badge, borderRadius: s.radius, backgroundColor: badgeColor }
      ]}>
        {badgeType === "icon" ? (
          <Feather name="award" size={s.font} color={textColor} />
        ) : (
          <Text style={[styles.label, { fontSize: s.font, color: textColor }]} numberOfLines={1}>
            {badgeLabel}
          </Text>
        )}
      </View>
      {showName && (
        <Text style={[styles.name, { fontSize: s.nameFontSize }]} numberOfLines={1}>
          {level.level_name}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 4 },
  badge: {
    alignItems: "center", justifyContent: "center",
    shadowColor: "#00000025", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1, shadowRadius: 4, elevation: 2,
  },
  label: { fontFamily: "Pretendard-Bold", textAlign: "center" },
  name: { fontFamily: "Pretendard-SemiBold", color: "#3A3530" },
});
