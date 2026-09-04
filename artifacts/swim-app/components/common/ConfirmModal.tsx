/**
 * ConfirmModal — 범용 확인/알림 Modal (mode-aware)
 *
 * X 모드: confirm 버튼 = XT.primary (네이비), 민트(C.tint) 제거
 * Normal 모드: 기존 동일
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
 *
 *   파괴적 작업 — 배경 탭으로 실수 방지:
 *   <ConfirmModal
 *     ...
 *     destructive
 *     disableBackdropDismiss
 *   />
 */
import React, { useEffect, useRef } from "react";
import {
  ActivityIndicator, Modal, Platform, Pressable,
  StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useMode } from "@/context/ModeContext";
import { X as XT, isXMode } from "@/constants/xTheme";

const C = Colors.light;

export interface ConfirmModalProps {
  visible: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  confirmColor?: string;
  loading?: boolean;
  /** true면 배경 탭/back 키로 닫히지 않음 (파괴적 작업 실수 방지) */
  disableBackdropDismiss?: boolean;
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
  confirmColor,
  loading = false,
  disableBackdropDismiss = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const insets = useSafeAreaInsets();
  const { mode } = useMode();
  const isX = isXMode(mode);

  // 연속 탭 방지: visible 변경 시 초기화
  const tappedRef = useRef(false);
  useEffect(() => {
    if (!visible) tappedRef.current = false;
  }, [visible]);

  function handleConfirm() {
    if (loading || tappedRef.current) return;
    tappedRef.current = true;
    onConfirm();
  }

  function handleBackdropPress() {
    if (disableBackdropDismiss) return;
    if (onCancel) onCancel();
    else handleConfirm();
  }

  // X 모드: confirm 버튼 기본색 = XT.primary (Nautic); Normal = C.primaryAction (Sage Strong, WP-N3)
  const defaultConfirmColor = destructive ? C.error : (isX ? XT.primary : C.primaryAction);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={disableBackdropDismiss ? undefined : (onCancel ?? handleConfirm)}
      statusBarTranslucent
    >
      {/* 바깥 터치 → 닫힘 */}
      <Pressable style={s.overlay} onPress={handleBackdropPress}>
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
                  backgroundColor: confirmColor ?? defaultConfirmColor,
                  opacity: loading ? 0.7 : pressed ? 0.85 : 1,
                  flex: onCancel ? 1 : undefined,
                  minWidth: onCancel ? undefined : 120,
                },
              ]}
              onPress={handleConfirm}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={[s.btnTxt, s.confirmTxt, { color: "#fff" }]}>{confirmText}</Text>
              }
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
    fontFamily: "Pretendard-SemiBold",
    textAlign: "center",
  },
  message: {
    fontSize: 14,
    fontFamily: "Pretendard-Regular",
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
    fontFamily: "Pretendard-Regular",
  },
  confirmTxt: {
    fontFamily: "Pretendard-Medium",
  },
});
