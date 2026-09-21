/**
 * TemplateInputModal — canonical shared component for "내 템플릿 추가/수정"
 *
 * 모든 route(admin, teacher)에서 이 컴포넌트만 사용한다.
 * 화면별 독립 구현 금지.
 */
import React from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Colors from "@/constants/colors";
const C = Colors.light;

interface Props {
  visible: boolean;
  title: string;
  titleValue: string;
  textValue: string;
  onTitleChange: (v: string) => void;
  onTextChange: (v: string) => void;
  error?: string;
  saving?: boolean;
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
}

export function TemplateInputModal({
  visible,
  title,
  titleValue,
  textValue,
  onTitleChange,
  onTextChange,
  error,
  saving,
  onClose,
  onConfirm,
  confirmLabel = "저장",
}: Props) {
  function handleClose() {
    Keyboard.dismiss();
    onClose();
  }
  function handleConfirm() {
    Keyboard.dismiss();
    onConfirm();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={s.overlay}>
          <View style={s.sheet}>
            <Text style={s.title}>{title}</Text>
            <TextInput
              style={s.input}
              value={titleValue}
              onChangeText={onTitleChange}
              placeholder="제목 (선택)"
              placeholderTextColor={C.textMuted}
              maxLength={100}
              returnKeyType="next"
            />
            <TextInput
              style={[s.input, s.textArea]}
              value={textValue}
              onChangeText={onTextChange}
              placeholder="내용을 입력하세요"
              placeholderTextColor={C.textMuted}
              multiline
              numberOfLines={4}
              scrollEnabled={true}
            />
            {!!error && <Text style={s.error}>{error}</Text>}
            <View style={s.btnRow}>
              <Pressable style={[s.btn, s.btnCancel]} onPress={handleClose}>
                <Text style={s.cancelText}>취소</Text>
              </Pressable>
              <Pressable
                style={[s.btn, s.btnConfirm, saving && { opacity: 0.6 }]}
                onPress={handleConfirm}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={s.confirmText}>{confirmLabel}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: 24,
  },
  sheet: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  title: {
    fontSize: 16,
    fontFamily: "Pretendard-Regular",
    color: "#1E293B",
    marginBottom: 16,
  } as any,
  input: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    fontFamily: "Pretendard-Regular",
    color: "#1E293B",
    backgroundColor: "#F8FAFC",
    marginBottom: 10,
  } as any,
  textArea: {
    minHeight: 90,
    maxHeight: 200,
    textAlignVertical: "top",
  },
  error: {
    fontSize: 12,
    fontFamily: "Pretendard-Regular",
    color: "#D96C6C",
    marginTop: 4,
    marginBottom: 4,
  } as any,
  btnRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  btn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  btnCancel: {
    borderColor: "#E2E8F0",
  },
  btnConfirm: {
    backgroundColor: "#2A9D8F",
    borderColor: "#2A9D8F",
  },
  cancelText: {
    fontSize: 14,
    fontFamily: "Pretendard-Regular",
    color: "#64748B",
  } as any,
  confirmText: {
    fontSize: 14,
    fontFamily: "Pretendard-SemiBold",
    color: "#fff",
  } as any,
});
