/**
 * OnboardingFullScreen.tsx — TYPE A
 * 실제 설정/입력이 필요한 경우 또는 setup 안내 full-screen.
 *
 * Layout:
 *   좌측 상단 로고
 *   중앙 icon + 제목 + 설명 + step indicator (optional)
 *   하단 Primary CTA + Secondary CTA
 */

import React from "react";
import {
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

interface OnboardingFullScreenProps {
  /** 좌측 상단 로고: 'swimnote' | 'x' */
  logo?: "swimnote" | "x";
  /** 중앙 아이콘 (emoji 또는 react element) */
  icon?: React.ReactNode;
  /** 제목 */
  title: string;
  /** 본문 설명 */
  body: string;
  /** Primary CTA 텍스트 */
  primaryLabel: string;
  /** Secondary CTA 텍스트 (생략 가능) */
  secondaryLabel?: string;
  /** Primary CTA 핸들러 */
  onPrimary: () => void;
  /** Secondary CTA 핸들러 */
  onSecondary?: () => void;
  /** Step indicator: 현재 페이지 (0-indexed) */
  currentStep?: number;
  /** Step indicator: 전체 페이지 수 */
  totalSteps?: number;
  /** X theme 적용 여부 */
  xTheme?: boolean;
}

const SWIMNOTE_LOGO = require("@/assets/images/swimnote-logo.png");
const X_WORDMARK = require("@/assets/images/swimnote-x-wordmark.png");

export function OnboardingFullScreen({
  logo = "swimnote",
  icon,
  title,
  body,
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
  currentStep,
  totalSteps,
  xTheme = false,
}: OnboardingFullScreenProps) {
  const bg = xTheme ? "#EEF3FA" : C.background;
  const titleColor = xTheme ? "#14283D" : C.textStrong;
  const bodyColor = xTheme ? "#4A6080" : C.textSecondary;
  const primaryBg = xTheme ? "#1A4070" : C.primaryAction;
  const primaryText = "#FFFFFF";

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
      {/* 좌측 상단 로고 */}
      <View style={styles.logoRow}>
        <Image
          source={logo === "x" ? X_WORDMARK : SWIMNOTE_LOGO}
          style={logo === "x" ? styles.xWordmark : styles.logo}
          resizeMode="contain"
        />
      </View>

      {/* 본문 */}
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Step indicator */}
        {totalSteps != null && totalSteps > 1 && (
          <View style={styles.stepRow}>
            {Array.from({ length: totalSteps }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.stepDot,
                  i === currentStep && {
                    backgroundColor: xTheme ? "#1A4070" : C.primaryAction,
                    width: 20,
                  },
                ]}
              />
            ))}
          </View>
        )}

        {/* Icon */}
        {icon != null && (
          <View style={styles.iconWrap}>{icon}</View>
        )}

        <Text style={[styles.title, { color: titleColor }]}>{title}</Text>
        <Text style={[styles.body, { color: bodyColor }]}>{body}</Text>
      </ScrollView>

      {/* 하단 CTA */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: primaryBg }]}
          onPress={onPrimary}
          activeOpacity={0.85}
        >
          <Text style={[styles.primaryBtnText, { color: primaryText }]}>
            {primaryLabel}
          </Text>
        </TouchableOpacity>
        {secondaryLabel != null && (
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={onSecondary}
            activeOpacity={0.7}
          >
            <Text style={[styles.secondaryBtnText, { color: bodyColor }]}>
              {secondaryLabel}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  logoRow: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  logo: { width: 120, height: 32 },
  xWordmark: { width: 140, height: 32 },
  content: {
    flexGrow: 1,
    alignItems: "center",
    paddingHorizontal: 32,
    paddingTop: 32,
    paddingBottom: 24,
  },
  stepRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 32,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#D0D7DE",
  },
  iconWrap: {
    marginBottom: 24,
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: "rgba(22,131,163,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 30,
    marginBottom: 16,
  },
  body: {
    fontSize: 15,
    lineHeight: 24,
    textAlign: "center",
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 16,
    gap: 10,
  },
  primaryBtn: {
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  primaryBtnText: { fontSize: 16, fontWeight: "600" },
  secondaryBtn: { paddingVertical: 10, alignItems: "center" },
  secondaryBtnText: { fontSize: 15 },
});
