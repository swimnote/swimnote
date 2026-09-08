/**
 * OnboardingSheet.tsx — TYPE B
 * 기능 전체를 이해해야 하는 경우 — Bottom Sheet 1~3장 슬라이드.
 *
 * 규칙:
 * - 닫기 가능
 * - 다시 자동 노출하지 않음 (호출자가 markSeen/markComplete 처리)
 * - 한 화면에서 한 번에 하나의 guide만 노출할 것 (호출자 책임)
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Image,
  Modal,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const C = Colors.light;
const { height: SCREEN_H } = Dimensions.get("window");
const SHEET_HEIGHT = Math.min(SCREEN_H * 0.72, 560);

export interface OnboardingSlide {
  /** emoji 또는 icon name (사용처에서 렌더링) */
  icon?: React.ReactNode;
  title: string;
  body: string;
}

interface OnboardingSheetProps {
  visible: boolean;
  /** 닫기 / 완료 시 호출 */
  onDismiss: () => void;
  slides: OnboardingSlide[];
  /** Primary CTA (마지막 슬라이드) */
  primaryLabel?: string;
  /** 중간 슬라이드 CTA (기본값: "다음") */
  nextLabel?: string;
  /** Secondary — 건너뛰기 (기본값: "나중에") */
  skipLabel?: string;
  /** X theme */
  xTheme?: boolean;
  /** 좌측 상단 로고 */
  logo?: "swimnote" | "x";
}

const SWIMNOTE_LOGO = require("@/assets/images/swimnote-logo.png");
const X_WORDMARK = require("@/assets/images/swimnote-x-wordmark.png");

export function OnboardingSheet({
  visible,
  onDismiss,
  slides,
  primaryLabel = "시작하기",
  nextLabel = "다음",
  skipLabel = "나중에",
  xTheme = false,
  logo = "swimnote",
}: OnboardingSheetProps) {
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState(0);
  const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;

  const primaryBg = xTheme ? "#1A4070" : C.primaryAction;
  const titleColor = xTheme ? "#14283D" : C.textStrong;
  const bodyColor = xTheme ? "#4A6080" : C.textSecondary;
  const dotActive = xTheme ? "#1A4070" : C.primaryAction;

  useEffect(() => {
    if (visible) {
      setPage(0);
      Animated.spring(translateY, {
        toValue: 0,
        tension: 65,
        friction: 11,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(translateY, {
        toValue: SHEET_HEIGHT,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, translateY]);

  const close = useCallback(() => {
    Animated.timing(translateY, {
      toValue: SHEET_HEIGHT,
      duration: 200,
      useNativeDriver: true,
    }).start(() => onDismiss());
  }, [translateY, onDismiss]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 8,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 60) {
          close();
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            tension: 65,
            friction: 11,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  const isLast = page === slides.length - 1;
  const slide = slides[page];

  const goNext = () => {
    if (isLast) { close(); }
    else { setPage((p) => p + 1); }
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={close} />
        <Animated.View
          style={[styles.sheet, { transform: [{ translateY }], paddingBottom: insets.bottom + 16 }]}
          {...panResponder.panHandlers}
        >
          {/* drag handle */}
          <View style={styles.dragHandle} />

          {/* header row */}
          <View style={styles.headerRow}>
            <Image
              source={logo === "x" ? X_WORDMARK : SWIMNOTE_LOGO}
              style={logo === "x" ? styles.xWordmark : styles.logo}
              resizeMode="contain"
            />
            <TouchableOpacity onPress={close} hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* content */}
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {slide.icon != null && (
              <View style={[styles.iconWrap, xTheme && styles.iconWrapX]}>
                {slide.icon}
              </View>
            )}
            <Text style={[styles.title, { color: titleColor }]}>{slide.title}</Text>
            <Text style={[styles.body, { color: bodyColor }]}>{slide.body}</Text>
          </ScrollView>

          {/* step dots */}
          {slides.length > 1 && (
            <View style={styles.dotsRow}>
              {slides.map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.dot,
                    i === page && { backgroundColor: dotActive, width: 20 },
                  ]}
                />
              ))}
            </View>
          )}

          {/* CTA */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: primaryBg }]}
              onPress={goNext}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>
                {isLast ? primaryLabel : nextLabel}
              </Text>
            </TouchableOpacity>
            {!isLast && (
              <TouchableOpacity style={styles.skipBtn} onPress={close} activeOpacity={0.7}>
                <Text style={[styles.skipText, { color: bodyColor }]}>{skipLabel}</Text>
              </TouchableOpacity>
            )}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    minHeight: SHEET_HEIGHT,
    maxHeight: SCREEN_H * 0.85,
    paddingHorizontal: 24,
  },
  dragHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#D0D7DE",
    marginTop: 10,
    marginBottom: 6,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  logo: { width: 110, height: 28 },
  xWordmark: { width: 130, height: 28 },
  closeText: { fontSize: 16, color: "#8E9BAA" },
  content: {
    alignItems: "center",
    paddingTop: 16,
    paddingBottom: 8,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: "rgba(22,131,163,0.08)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  iconWrapX: { backgroundColor: "rgba(26,64,112,0.08)" },
  title: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 28,
    marginBottom: 12,
  },
  body: {
    fontSize: 15,
    lineHeight: 24,
    textAlign: "center",
  },
  dotsRow: {
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    marginVertical: 16,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#D0D7DE",
  },
  footer: { gap: 8 },
  primaryBtn: {
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  primaryBtnText: { fontSize: 16, fontWeight: "600", color: "#FFFFFF" },
  skipBtn: { paddingVertical: 10, alignItems: "center" },
  skipText: { fontSize: 15 },
});
