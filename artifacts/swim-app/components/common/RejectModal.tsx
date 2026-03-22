/**
 * RejectModal — 거절 사유 입력 공통 모달
 */
import React, { useState } from "react";
import {
  KeyboardAvoidingView, Modal, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const C = Colors.light;

interface RejectModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  loading?: boolean;
}

export function RejectModal({ visible, onClose, onConfirm, loading }: RejectModalProps) {
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState("");

  function handleClose() { setReason(""); onClose(); }
  function handleConfirm() {
    onConfirm(reason.trim());
    setReason("");
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={[s.sheet, { backgroundColor: C.card, paddingBottom: insets.bottom + 20 }]}>
          <View style={s.handle} />
          <Text style={[s.title, { color: C.text }]}>거절 사유 입력</Text>
          <TextInput
            style={[s.input, { borderColor: C.border, color: C.text, backgroundColor: C.background }]}
            value={reason}
            onChangeText={setReason}
            placeholder="거절 사유를 입력해주세요"
            placeholderTextColor={C.textMuted}
            multiline
            autoFocus
          />
          <View style={s.row}>
            <Pressable
              style={({ pressed }) => [s.cancelBtn, { borderColor: C.border, opacity: pressed ? 0.8 : 1 }]}
              onPress={handleClose}
            >
              <Text style={[s.cancelText, { color: C.textSecondary }]}>취소</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                s.confirmBtn,
                { backgroundColor: C.error, opacity: (pressed || loading) ? 0.7 : 1 },
              ]}
              onPress={handleConfirm}
              disabled={!!loading}
            >
              <Text style={s.confirmText}>거절 확정</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 14 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  input: {
    borderWidth: 1.5, borderRadius: 12,
    padding: 12, minHeight: 90,
    textAlignVertical: "top", fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  row: { flexDirection: "row", gap: 12 },
  cancelBtn: {
    flex: 1, height: 46, borderRadius: 12, borderWidth: 1.5,
    alignItems: "center", justifyContent: "center",
  },
  cancelText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  confirmBtn: {
    flex: 1, height: 46, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  confirmText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
