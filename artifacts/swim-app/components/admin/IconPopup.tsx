/**
 * IconPopup — 3열 아이콘 그리드 공통 팝업
 * 모든 메인 아이콘 팝업이 동일한 디자인을 사용
 * - 바깥 터치 닫기
 * - X 버튼 닫기
 * - 드래그 아래로 닫기
 */
import { Feather } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import {
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const C = Colors.light;
const SCREEN_H = Dimensions.get("window").height;
const DRAG_THRESHOLD = 80;

export interface PopupItem {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  color: string;
  bg: string;
  onPress: () => void;
  badge?: number;
  disabled?: boolean;
}

interface IconPopupProps {
  visible: boolean;
  title: string;
  items: PopupItem[];
  onClose: () => void;
}

export function IconPopup({ visible, title, items, onClose }: IconPopupProps) {
  const insets = useSafeAreaInsets();
  const slideY = useRef(new Animated.Value(SCREEN_H)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(slideY, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 4,
        speed: 18,
      }).start();
    } else {
      slideY.setValue(SCREEN_H);
    }
  }, [visible]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 8,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) slideY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > DRAG_THRESHOLD || g.vy > 0.5) {
          Animated.timing(slideY, {
            toValue: SCREEN_H,
            duration: 200,
            useNativeDriver: true,
          }).start(onClose);
        } else {
          Animated.spring(slideY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
        }
      },
    })
  ).current;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {/* 배경 오버레이 */}
      <Pressable style={s.backdrop} onPress={onClose} />

      {/* 슬라이드업 시트 */}
      <Animated.View
        style={[s.sheet, { paddingBottom: insets.bottom + 24, transform: [{ translateY: slideY }] }]}
      >
        {/* 드래그 핸들 */}
        <View {...panResponder.panHandlers}>
          <View style={s.handle} />

          {/* 헤더 */}
          <View style={s.header}>
            <Text style={s.title}>{title}</Text>
            <Pressable onPress={onClose} style={s.closeBtn} hitSlop={10}>
              <Feather name="x" size={20} color={C.textSecondary} />
            </Pressable>
          </View>
        </View>

        {/* 3열 그리드 */}
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.grid}
          bounces={false}
        >
          {items.map((item, i) => (
            <Pressable
              key={i}
              style={({ pressed }) => [s.iconCell, { opacity: pressed || item.disabled ? 0.6 : 1 }]}
              onPress={() => { if (!item.disabled) { onClose(); item.onPress(); } }}
              disabled={item.disabled}
            >
              <View style={[s.iconBox, { backgroundColor: item.bg }]}>
                <Feather name={item.icon} size={24} color={item.color} />
                {item.badge !== undefined && item.badge > 0 && (
                  <View style={s.badge}>
                    <Text style={s.badgeTxt}>{item.badge > 99 ? "99+" : item.badge}</Text>
                  </View>
                )}
              </View>
              <Text style={s.label} numberOfLines={2}>{item.label}</Text>
            </Pressable>
          ))}
          {/* 빈 셀로 3열 맞추기 */}
          {Array.from({ length: (3 - (items.length % 3)) % 3 }).map((_, i) => (
            <View key={`empty-${i}`} style={s.iconCell} />
          ))}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: SCREEN_H * 0.75,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -4 },
    elevation: 20,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: "#D1D5DB",
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: C.text,
    fontFamily: "Inter_700Bold",
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 12,
    paddingVertical: 16,
    gap: 0,
  },
  iconCell: {
    width: "33.33%",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  iconBox: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: C.text,
    textAlign: "center",
    lineHeight: 16,
    fontFamily: "Inter_600SemiBold",
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#EF4444",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: "#fff",
  },
  badgeTxt: { color: "#fff", fontSize: 9, fontWeight: "700" },
});
