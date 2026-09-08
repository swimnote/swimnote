/**
 * CoachMark.tsx — TYPE C
 * 특정 버튼/영역 가리키는 overlay + pointer + callout.
 *
 * 사용법:
 *   <CoachMark
 *     visible={shouldShow}
 *     onDismiss={markSeen}
 *     targetRef={buttonRef}
 *     title="출결 처리"
 *     body="학생을 길게 누르면 출결을 빠르게 변경할 수 있습니다."
 *   />
 *
 * targetLayout 또는 targetRef 중 하나 제공.
 */

import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;
const { width: SW, height: SH } = Dimensions.get("window");

export interface TargetLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CoachMarkProps {
  visible: boolean;
  onDismiss: () => void;
  targetLayout?: TargetLayout | null;
  title: string;
  body: string;
  /** CTA label (기본: "확인") */
  dismissLabel?: string;
  /** 말풍선 위치 기본값: 'bottom' (target 아래) | 'top' */
  position?: "top" | "bottom" | "auto";
  xTheme?: boolean;
}

export function CoachMark({
  visible,
  onDismiss,
  targetLayout,
  title,
  body,
  dismissLabel = "확인",
  position = "auto",
  xTheme = false,
}: CoachMarkProps) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    } else {
      opacity.setValue(0);
    }
  }, [visible, opacity]);

  // 말풍선 위치 계산
  const calloutTop =
    targetLayout == null
      ? SH / 2 - 80
      : position === "top" || (position === "auto" && targetLayout.y > SH / 2)
        ? targetLayout.y - 160
        : targetLayout.y + targetLayout.height + 16;

  const calloutLeft = targetLayout
    ? Math.max(16, Math.min(SW - 280, targetLayout.x + targetLayout.width / 2 - 140))
    : SW / 2 - 140;

  const bg = xTheme ? "#1A4070" : C.primaryAction;
  const textColor = "#FFFFFF";

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onDismiss}>
      <Animated.View style={[styles.overlay, { opacity }]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onDismiss} />

        {/* highlight ring around target */}
        {targetLayout && (
          <View
            style={[
              styles.highlight,
              {
                top: targetLayout.y - 6,
                left: targetLayout.x - 6,
                width: targetLayout.width + 12,
                height: targetLayout.height + 12,
              },
            ]}
          />
        )}

        {/* callout bubble */}
        <View
          style={[
            styles.callout,
            { backgroundColor: bg, top: calloutTop, left: calloutLeft },
          ]}
        >
          <Text style={[styles.calloutTitle, { color: textColor }]}>{title}</Text>
          <Text style={[styles.calloutBody, { color: "rgba(255,255,255,0.85)" }]}>{body}</Text>
          <TouchableOpacity onPress={onDismiss} style={styles.dismissBtn} activeOpacity={0.8}>
            <Text style={[styles.dismissText, { color: textColor }]}>{dismissLabel}</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  highlight: {
    position: "absolute",
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  callout: {
    position: "absolute",
    width: 280,
    borderRadius: 14,
    padding: 16,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  calloutTitle: {
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 6,
    lineHeight: 21,
  },
  calloutBody: {
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 12,
  },
  dismissBtn: {
    alignSelf: "flex-end",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  dismissText: { fontSize: 13, fontWeight: "600" },
});
