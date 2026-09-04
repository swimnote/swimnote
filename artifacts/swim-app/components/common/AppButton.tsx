/**
 * AppButton — WP-N3 Design System Primary Button Primitive
 *
 * variant:
 *   primary     → Clear Pool Strong (#1683A3) — 저장/다음/등록/확인/완료 (white label 5.6:1 ✅)
 *   secondary   → Clear Pool Soft bg (#D9F2F6) + Sage Strong text — 보조/취소
 *   tertiary    → Transparent + textPrimary — 텍스트 전용
 *   destructive → Red (#D96C6C) — 삭제/위험
 *
 * X mode: primary → XT.primary (Nautic), X 변경 금지.
 *
 * 규칙:
 *   - 기능이 다르다는 이유로 색을 다르게 하지 않는다.
 *   - 색에는 항상 의미가 있어야 한다.
 */
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Colors from "@/constants/colors";
import { X as XT } from "@/constants/xTheme";
import { useMode } from "@/context/ModeContext";
import { isXMode } from "@/constants/xTheme";

const C = Colors.light;

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "destructive";
export type ButtonSize    = "md" | "sm" | "lg";

interface Props {
  label:    string;
  onPress:  () => void;
  variant?: ButtonVariant;
  size?:    ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  /** Optional leading icon element */
  icon?: React.ReactNode;
}

const VARIANT_CONFIG: Record<
  ButtonVariant,
  { bg: string; pressedBg: string; textColor: string; borderColor?: string }
> = {
  primary: {
    bg:        C.primaryAction,        // C.primaryAction (Clear Pool Strong #1683A3)
    pressedBg: C.primaryActionPressed, // #3D5750
    textColor: "#FFFFFF",              // 5.6:1 on Sage Strong ✅ AA
  },
  secondary: {
    bg:        C.brandSoft,            // #DDE7E3 Sage Soft
    pressedBg: C.brandMid,            // #6BD2DE Clear Pool Mid (pressed)
    textColor: C.brandStrong,          // #1683A3 Clear Pool Strong text
  },
  tertiary: {
    bg:        "transparent",
    pressedBg: C.backgroundSoft,       // #EEF9FB Clear Pool Mist
    textColor: C.textPrimary,
  },
  destructive: {
    bg:        C.error,                // #D96C6C
    pressedBg: "#B85C5C",
    textColor: "#FFFFFF",
  },
};

const SIZE_CONFIG: Record<ButtonSize, { height: number; fontSize: number; paddingH: number; borderRadius: number }> = {
  sm: { height: 40, fontSize: 14, paddingH: 14, borderRadius: 10 },
  md: { height: 52, fontSize: 16, paddingH: 20, borderRadius: 14 },
  lg: { height: 58, fontSize: 17, paddingH: 24, borderRadius: 16 },
};

export function AppButton({
  label,
  onPress,
  variant  = "primary",
  size     = "md",
  loading  = false,
  disabled = false,
  fullWidth = false,
  icon,
}: Props) {
  const { mode } = useMode();
  const isX = isXMode(mode);

  // Primary CTA: X → Nautic Primary (#1A4070), Normal → C.primaryAction (#4F6F67 Sage Strong)
  const vCfg = variant === "primary" && isX
    ? { ...VARIANT_CONFIG.primary, bg: XT.primary, pressedBg: XT.primaryPressed }
    : VARIANT_CONFIG[variant];
  const sCfg = SIZE_CONFIG[size];
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        {
          height:         sCfg.height,
          borderRadius:   sCfg.borderRadius,
          paddingHorizontal: sCfg.paddingH,
          backgroundColor: isDisabled
            ? C.disabled
            : pressed
              ? vCfg.pressedBg
              : vCfg.bg,
        },
        fullWidth && styles.fullWidth,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={isDisabled ? C.disabledText : vCfg.textColor}
          size="small"
        />
      ) : (
        <View style={styles.inner}>
          {icon}
          <Text
            style={[
              styles.label,
              {
                fontSize:  sCfg.fontSize,
                color: isDisabled ? C.disabledText : vCfg.textColor,
              },
            ]}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base:     { alignItems: "center", justifyContent: "center" },
  fullWidth: { alignSelf: "stretch" },
  inner:    { flexDirection: "row", alignItems: "center", gap: 8 },
  label:    { fontFamily: "Pretendard-Regular" },
});
