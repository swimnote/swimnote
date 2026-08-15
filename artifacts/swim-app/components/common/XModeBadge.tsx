/**
 * XModeBadge — SWIMNOTE X 모드 상태 뱃지 (WP4 / A1 Theme Polish)
 *
 * 사용법:
 *   <XModeBadge />                  // mode를 ModeContext에서 자동 읽음
 *   <XModeBadge size="medium" />    // 약간 더 크게
 *
 * 렌더 조건:
 *   mode === "x"         → Steel Blue (xAccentLight) 배경 + xAccent 테두리 "SWIMNOTE X" pill
 *   mode === "x_pending" → Muted Gold (xPendingLight) 배경 + xPending 테두리 "X 준비중" pill
 *   그 외 / null / 로딩   → null (기존 UI 변화 없음)
 *
 * A1: X 전용 Steel Blue 토큰 적용 (mint #2EC4B6와 구별)
 * 헌법 6조: 기존 일반모드 UI 변경 없음
 */

import React from "react";
import { Text, View } from "react-native";
import { useMode } from "@/context/ModeContext";

interface XModeBadgeProps {
  size?: "small" | "medium";
}

// X 전용 토큰 — theme/colors.ts xAccent/xPending 계열
const X_ACCENT        = "#355C7D";
const X_ACCENT_LIGHT  = "#E9EEF3";
const X_ACCENT_STRONG = "#23415C";
const X_PENDING       = "#B7791F";
const X_PENDING_LIGHT = "#F8EED8";

export function XModeBadge({ size = "small" }: XModeBadgeProps) {
  const { mode } = useMode();

  if (mode === "x") {
    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: X_ACCENT_LIGHT,
          borderRadius: size === "medium" ? 10 : 8,
          paddingHorizontal: size === "medium" ? 8 : 6,
          paddingVertical: size === "medium" ? 3 : 2,
          borderWidth: 1,
          borderColor: X_ACCENT,
          flexShrink: 0,
        }}
      >
        <Text
          style={{
            fontSize: size === "medium" ? 11 : 10,
            fontFamily: "Pretendard-SemiBold",
            color: X_ACCENT_STRONG,
            letterSpacing: 0.2,
          }}
        >
          SWIMNOTE X
        </Text>
      </View>
    );
  }

  if (mode === "x_pending") {
    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: X_PENDING_LIGHT,
          borderRadius: size === "medium" ? 10 : 8,
          paddingHorizontal: size === "medium" ? 8 : 6,
          paddingVertical: size === "medium" ? 3 : 2,
          borderWidth: 1,
          borderColor: X_PENDING,
          flexShrink: 0,
        }}
      >
        <Text
          style={{
            fontSize: size === "medium" ? 11 : 10,
            fontFamily: "Pretendard-Regular",
            color: X_PENDING,
          }}
        >
          X 준비중
        </Text>
      </View>
    );
  }

  return null;
}
