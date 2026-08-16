/**
 * NavigationListItem — A1-2 Design System
 *
 * 표준 진입 메뉴 아이템:
 *   icon (no bg tile) + title + optional subtitle + chevron
 *
 * 규칙:
 *   - 아이콘 뒤 decorative tile/background 없음
 *   - 장식용 border 없음
 *   - 분리는 spacing 또는 subtle divider로만
 *   - touch target 최소 44×44 유지
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

interface Props {
  /** Lucide icon name */
  icon?:        string;
  /** Icon color — defaults to C.text (navy) */
  iconColor?:   string;
  title:        string;
  subtitle?:    string;
  onPress?:     () => void;
  /** Optional right-side badge/element before chevron */
  rightBadge?:  React.ReactNode;
  /** Show a subtle bottom divider (default true) */
  showDivider?: boolean;
  /** Hide the chevron (default false) */
  hideChevron?: boolean;
}

export function NavigationListItem({
  icon,
  iconColor,
  title,
  subtitle,
  onPress,
  rightBadge,
  showDivider = true,
  hideChevron = false,
}: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && styles.rowPressed,
      ]}
      accessibilityRole="button"
    >
      {/* Icon — no bg tile, just the icon with leading padding */}
      {icon ? (
        <View style={styles.iconWrap}>
          <LucideIcon name={icon as any} size={18} color={iconColor ?? C.text} />
        </View>
      ) : null}

      {/* Content + divider */}
      <View style={[styles.content, showDivider && styles.contentDivider]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text>
          ) : null}
        </View>
        {rightBadge}
        {!hideChevron && (
          <LucideIcon name="chevron-right" size={16} color={C.textMuted} />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection:  "row",
    alignItems:     "center",
    minHeight:      52,
    paddingLeft:    16,
    backgroundColor: "transparent",
  },
  rowPressed: {
    backgroundColor: C.backgroundSoft,
  },
  iconWrap: {
    width:  44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flex:          1,
    flexDirection: "row",
    alignItems:    "center",
    gap:           8,
    paddingRight:  16,
    paddingVertical: 12,
  },
  contentDivider: {
    borderBottomWidth: 1,
    borderBottomColor: "#F0F0F0",
  },
  title: {
    fontSize:    15,
    fontFamily:  "Pretendard-Regular",
    color:       C.text,
  },
  subtitle: {
    fontSize:    12,
    fontFamily:  "Pretendard-Regular",
    color:       C.textSecondary,
    lineHeight:  17,
  },
});
