import { CircleCheck, CircleX } from "lucide-react-native";
import React, { useCallback, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";

export type ToastType = "success" | "error";

interface ToastState {
  message: string;
  type: ToastType;
  visible: boolean;
}

export function useToast() {
  const [state, setState] = useState<ToastState>({ message: "", type: "success", visible: false });
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, type: ToastType = "success") => {
    if (timerRef.current) clearTimeout(timerRef.current);

    setState({ message, type, visible: true });
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();

    timerRef.current = setTimeout(() => {
      Animated.timing(fadeAnim, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => {
        setState(s => ({ ...s, visible: false }));
      });
    }, 2500);
  }, [fadeAnim]);

  function ToastComponent() {
    if (!state.visible) return null;
    const isSuccess = state.type === "success";
    return (
      <Animated.View
        pointerEvents="none"
        style={[
          ts.container,
          isSuccess ? ts.success : ts.error,
          { opacity: fadeAnim, transform: [{ translateY: fadeAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] },
        ]}
      >
        {isSuccess
          ? <CircleCheck size={16} color="#fff" />
          : <CircleX size={16} color="#fff" />}
        <Text style={ts.text} numberOfLines={2}>{state.message}</Text>
      </Animated.View>
    );
  }

  return { showToast, ToastComponent };
}

const ts = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 36,
    left: 24,
    right: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 6,
    zIndex: 9999,
  },
  success: { backgroundColor: "#16A34A" },
  error:   { backgroundColor: "#DC2626" },
  text: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Pretendard-Regular",
    color: "#fff",
  },
});
