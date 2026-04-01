/**
 * OnboardingTooltip — 첫 방문 사용자를 위한 힌트 배너
 * AsyncStorage에 dismissed 상태를 저장하여 한 번만 표시
 */
import { Lightbulb, X } from "lucide-react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

interface Props {
  storageKey: string;
  title: string;
  message: string;
  accentColor?: string;
}

export default function OnboardingTooltip({
  storageKey,
  title,
  message,
  accentColor = C.tint,
}: Props) {
  const [visible, setVisible] = useState(false);
  const opacity = useState(new Animated.Value(0))[0];

  useEffect(() => {
    AsyncStorage.getItem(storageKey).then(val => {
      if (!val) {
        setVisible(true);
        Animated.timing(opacity, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }).start();
      }
    });
  }, [storageKey]);

  function dismiss() {
    Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setVisible(false));
    AsyncStorage.setItem(storageKey, "dismissed").catch(() => {});
  }

  if (!visible) return null;

  return (
    <Animated.View style={[tt.wrap, { opacity, borderLeftColor: accentColor }]}>
      <View style={[tt.iconBox, { backgroundColor: accentColor + "15" }]}>
        <Lightbulb size={16} color={accentColor} />
      </View>
      <View style={tt.textArea}>
        <Text style={[tt.title, { color: accentColor }]}>{title}</Text>
        <Text style={tt.msg}>{message}</Text>
      </View>
      <Pressable onPress={dismiss} hitSlop={12} style={tt.closeBtn}>
        <X size={14} color={C.textMuted} />
      </Pressable>
    </Animated.View>
  );
}

const tt = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    borderLeftWidth: 4,
    padding: 12,
    shadowColor: "#00000010",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 3,
  },
  iconBox: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  textArea: { flex: 1, gap: 2 },
  title: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  msg: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 18 },
  closeBtn: { padding: 2, flexShrink: 0 },
});
