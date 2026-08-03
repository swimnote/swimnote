/**
 * XModeBadge — SWIMNOTE X 모드 상태 뱃지 (WP4)
 *
 * 사용법:
 *   <XModeBadge />                  // mode를 ModeContext에서 자동 읽음
 *   <XModeBadge size="medium" />    // 약간 더 크게
 *
 * 렌더 조건:
 *   mode === "x"         → mintLight 배경 + navy 텍스트 "SWIMNOTE X" pill
 *   mode === "x_pending" → 회색 배경 + 회색 텍스트 "X 준비중" pill
 *   그 외 / null / 로딩   → null (기존 UI 변화 없음)
 *
 * 색상: 기존 디자인 토큰(mint #2EC4B6, mintLight #E6FAF8, navy #0F172A) 재사용
 * 헌법 6조: 기존 일반모드 UI 변경 없음
 */

import React from "react";
import { Text, View } from "react-native";
import { useMode } from "@/context/ModeContext";

interface XModeBadgeProps {
  size?: "small" | "medium";
}

const MINT        = "#2EC4B6";
const MINT_LIGHT  = "#E6FAF8";
const NAVY        = "#0F172A";

export function XModeBadge({ size = "small" }: XModeBadgeProps) {
  const { mode } = useMode();

  if (mode === "x") {
    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: MINT_LIGHT,
          borderRadius: size === "medium" ? 10 : 8,
          paddingHorizontal: size === "medium" ? 8 : 6,
          paddingVertical: size === "medium" ? 3 : 2,
          borderWidth: 1,
          borderColor: MINT,
          flexShrink: 0,
        }}
      >
        <Text
          style={{
            fontSize: size === "medium" ? 11 : 10,
            fontFamily: "Pretendard-SemiBold",
            color: NAVY,
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
          backgroundColor: "#F1F5F9",
          borderRadius: size === "medium" ? 10 : 8,
          paddingHorizontal: size === "medium" ? 8 : 6,
          paddingVertical: size === "medium" ? 3 : 2,
          flexShrink: 0,
        }}
      >
        <Text
          style={{
            fontSize: size === "medium" ? 11 : 10,
            fontFamily: "Pretendard-Regular",
            color: "#94A3B8",
          }}
        >
          X 준비중
        </Text>
      </View>
    );
  }

  return null;
}
