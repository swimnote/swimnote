/**
 * ParentScreenHeader — 학부모 전용 공통 헤더 (mode-aware)
 * - Normal: 흰색 배경 + 기본 색상
 * - X mode: 네이비 배경 + 흰색 텍스트/아이콘
 *
 * 뒤로가기: router.back() — 글로벌 라우터 히스토리 기준 직전 화면 복귀
 * 홈 버튼: router.replace("/(parent)/home") — 사용자가 명시적으로 눌렀을 때만
 * 관리자/선생님 라우트와 절대 연결되지 않음
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useMode } from "@/context/ModeContext";
import { X as XT, isXMode } from "@/constants/xTheme";

const C = Colors.light;

interface Props {
  title: string;
  subtitle?: string;
  showHome?: boolean;
  showBack?: boolean;
  rightSlot?: React.ReactNode;
  leftSlot?: React.ReactNode;
  onBack?: () => void;
}

export function ParentScreenHeader({
  title,
  subtitle,
  showHome = true,
  showBack = true,
  rightSlot,
  leftSlot,
  onBack,
}: Props) {
  const insets = useSafeAreaInsets();
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 8);
  const { mode } = useMode();

  /** §24: x_pending도 X UI */
  const isX = isXMode(mode);

  const handleBack = () => {
    if (onBack) { onBack(); return; }
    router.back();
  };

  const handleHome = () => {
    router.replace("/(parent)/home" as any);
  };

  // ── X mode 색상 ──────────────────────────────────────────────────────────
  const rootBg        = isX ? XT.surfaceNavy    : C.background;
  const borderColor   = isX ? XT.surfaceNavyStrong : C.border;
  const iconColor     = isX ? XT.textOnNavy     : C.text;
  const iconColorSec  = isX ? XT.textOnNavySoft : C.textSecondary;
  const btnBg         = isX ? "rgba(255,255,255,0.12)" : "#FFFFFF";
  const titleColor    = isX ? XT.textOnNavy     : C.text;
  const subtitleColor = isX ? XT.textOnNavySoft : C.textSecondary;

  return (
    <View style={[s.root, { paddingTop: topPad, backgroundColor: rootBg, borderBottomColor: borderColor }]}>
      {leftSlot ?? (showBack ? (
        <Pressable onPress={handleBack} style={[s.btn, { backgroundColor: btnBg }]} hitSlop={10}>
          <LucideIcon name="arrow-left" size={22} color={iconColor} />
        </Pressable>
      ) : (
        <View style={s.placeholder} />
      ))}

      <View style={s.titleBlock}>
        <Text style={[s.title, { color: titleColor }]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={[s.subtitle, { color: subtitleColor }]} numberOfLines={1}>{subtitle}</Text> : null}
      </View>

      <View style={s.right}>
        {rightSlot ?? null}
        {showHome ? (
          <Pressable onPress={handleHome} style={[s.btn, { backgroundColor: btnBg }]} hitSlop={10}>
            <LucideIcon name="home" size={20} color={iconColorSec} />
          </Pressable>
        ) : (
          !rightSlot ? <View style={s.placeholder} /> : null
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    gap: 8,
  },
  btn: {
    width: 38, height: 38,
    alignItems: "center", justifyContent: "center",
    borderRadius: 10,
  },
  placeholder: { width: 38, height: 38 },
  titleBlock: { flex: 1, alignItems: "center" },
  title: {
    fontSize: 17, fontFamily: "Pretendard-Regular",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 12, fontFamily: "Pretendard-Regular",
    textAlign: "center", marginTop: 1,
  },
  right: {
    flexDirection: "row", alignItems: "center",
    gap: 6, minWidth: 38, justifyContent: "flex-end",
  },
});
