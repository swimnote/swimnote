/**
 * ModalSheet — 공통 바텀시트 팝업
 *
 * - 화면 높이의 75% 고정
 * - 상단 드래그 핸들 / 스와이프 다운으로 닫기
 * - 바깥 터치로 닫기
 * - 우측 상단 X 버튼
 * - 내부 ScrollView (스크롤바 표시)
 * - KeyboardAvoidingView (입력형 팝업 대응)
 */
import { X } from "lucide-react-native";
import React, { useCallback, useEffect, useRef } from "react";
import {
  Animated,
  Dimensions,
  KeyboardAvoidingView,
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
const SCREEN_HEIGHT = Dimensions.get("window").height;
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.75;
const DISMISS_THRESHOLD = 80;

interface ModalSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export function ModalSheet({ visible, onClose, title, children }: ModalSheetProps) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const dragY = useRef(new Animated.Value(0)).current;

  const show = useCallback(() => {
    translateY.setValue(SHEET_HEIGHT);
    dragY.setValue(0);
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: true,
      tension: 65,
      friction: 11,
    }).start();
  }, [translateY, dragY]);

  const hide = useCallback(
    (onFinish?: () => void) => {
      Animated.timing(translateY, {
        toValue: SHEET_HEIGHT,
        duration: 220,
        useNativeDriver: true,
      }).start(() => {
        dragY.setValue(0);
        onFinish?.();
      });
    },
    [translateY, dragY],
  );

  useEffect(() => {
    if (visible) {
      show();
    } else {
      translateY.setValue(SHEET_HEIGHT);
      dragY.setValue(0);
    }
  }, [visible]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (_, gs) => gs.dy > 2,
      onMoveShouldSetPanResponder: (_, gs) => gs.dy > 5 && Math.abs(gs.dy) > Math.abs(gs.dx),
      onPanResponderMove: (_, gs) => {
        if (gs.dy > 0) dragY.setValue(gs.dy);
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > DISMISS_THRESHOLD || gs.vy > 0.8) {
          hide(onClose);
        } else {
          Animated.spring(dragY, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    }),
  ).current;

  const combinedY = Animated.add(translateY, dragY);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={() => hide(onClose)}
      statusBarTranslucent
    >
      <Pressable style={s.backdrop} onPress={() => hide(onClose)} />

      <Animated.View
        style={[
          s.sheet,
          { paddingBottom: insets.bottom, transform: [{ translateY: combinedY }] },
        ]}
      >
        {/* 드래그 핸들 */}
        <View {...panResponder.panHandlers} style={s.handleArea}>
          <View style={s.handleBar} />
        </View>

        {/* 헤더 */}
        <View style={s.header}>
          <View style={s.headerSpacer} />
          <Text style={s.title} numberOfLines={1}>
            {title}
          </Text>
          <Pressable onPress={() => hide(onClose)} style={s.closeBtn} hitSlop={10}>
            <X size={20} color={C.textSecondary} />
          </Pressable>
        </View>

        {/* 내용 */}
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={s.content}
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
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
    height: SHEET_HEIGHT,
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 12,
    overflow: "hidden",
  },
  handleArea: {
    paddingVertical: 14,
    alignItems: "center",
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#E5E7EB",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#FFFFFF",
  },
  headerSpacer: { width: 36 },
  title: {
    flex: 1,
    fontSize: 16,
    fontFamily: "Pretendard-SemiBold",
    color: C.text,
    textAlign: "center",
  },
  closeBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
  },
  content: {
    padding: 20,
    gap: 12,
    flexGrow: 1,
  },
});
