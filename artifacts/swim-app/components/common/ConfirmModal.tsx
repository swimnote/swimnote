/**
 * ConfirmModal — 범용 확인/알림 Modal
 * Alert.alert 대체 컴포넌트
 *
 * usage:
 *   <ConfirmModal
 *     visible={confirmVisible}
 *     title="삭제 확인"
 *     message="정말 삭제하시겠습니까?"
 *     confirmText="삭제"
 *     destructive
 *     onConfirm={handleDelete}
 *     onCancel={() => setConfirmVisible(false)}
 *   />
 *
 *   단순 알림(취소 없음):
 *   <ConfirmModal
 *     visible={alertVisible}
 *     title="완료"
 *     message="저장되었습니다."
 *     confirmText="확인"
 *     onConfirm={() => setAlertVisible(false)}
 *   />
 */
import React from "react";
import {
  Modal, Platform, Pressable,
  StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const C = Colors.light;

interface ConfirmModalProps {
  visible: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
}

export function ConfirmModal({
  visible,
  title,
  message,
  confirmText = "확인",
  cancelText = "취소",
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onCancel ?? onConfirm}
      statusBarTranslucent
    >
      {/* 바깥 터치 → 닫힘 (onCancel 없으면 onConfirm) */}
      <Pressable style={s.overlay} onPress={onCancel ?? onConfirm}>
        {/* 카드 내부 터치는 전파 차단 */}
        <Pressable onPress={() => {}} style={[s.card, { paddingBottom: Math.max(insets.bottom, 8) + 8, backgroundColor: C.card }]}>
          <Text style={[s.title, { color: C.text }]}>{title}</Text>
          <Text style={[s.message, { color: C.textSecondary }]}>{message}</Text>

          <View style={[s.btnRow, onCancel ? {} : { justifyContent: "center" }]}>
            {onCancel && (
              <Pressable
                style={({ pressed }) => [s.btn, s.cancelBtn, { borderColor: C.border, opacity: pressed ? 0.7 : 1 }]}
                onPress={onCancel}
              >
                <Text style={[s.btnTxt, { color: C.textSecondary }]}>{cancelText}</Text>
              </Pressable>
            )}
            <Pressable
              style={({ pressed }) => [
                s.btn,
                {
                  backgroundColor: destructive ? C.error : C.tint,
                  opacity: pressed ? 0.85 : 1,
                  flex: onCancel ? 1 : undefined,
                  minWidth: onCancel ? undefined : 120,
                },
              ]}
              onPress={onConfirm}
            >
              <Text style={[s.btnTxt, { color: "#fff" }]}>{confirmText}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  card: {
    width: "100%",
    borderRadius: 20,
    padding: 24,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  title: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  message: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 21,
  },
  btnRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
  },
  btn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtn: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
  },
  btnTxt: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
});
