/**
 * OnboardingInlineHelp.tsx — TYPE D
 * 짧은 설명 — 화면 내 항상 표시 가능한 inline helper.
 *
 * 사용법:
 *   <OnboardingInlineHelp
 *     text="학부모 전화번호를 정확히 입력하면 자동으로 연결됩니다."
 *   />
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

interface OnboardingInlineHelpProps {
  text: string;
  /** 아이콘 (emoji 문자열 또는 생략) */
  icon?: string;
  /** 배경/강조 색상 테마 */
  variant?: "info" | "tip" | "x";
  style?: object;
}

export function OnboardingInlineHelp({
  text,
  icon,
  variant = "info",
  style,
}: OnboardingInlineHelpProps) {
  const bg =
    variant === "x"
      ? "rgba(26,64,112,0.06)"
      : variant === "tip"
        ? C.brandMist
        : C.backgroundSoft;

  const borderColor =
    variant === "x"
      ? "#CAD6E8"
      : variant === "tip"
        ? C.brandSoft
        : C.border;

  const textColor =
    variant === "x" ? "#1A4070" : C.textSecondary;

  const defaultIcon =
    variant === "x" ? "✦" : variant === "tip" ? "💡" : "ℹ️";

  return (
    <View style={[styles.wrap, { backgroundColor: bg, borderColor }, style]}>
      <Text style={styles.iconText}>{icon ?? defaultIcon}</Text>
      <Text style={[styles.text, { color: textColor }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  iconText: { fontSize: 14, lineHeight: 20, marginTop: 1 },
  text: { flex: 1, fontSize: 13, lineHeight: 20 },
});
