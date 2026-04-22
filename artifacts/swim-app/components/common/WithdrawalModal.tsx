/**
 * WithdrawalModal
 * 탈퇴 시 두 가지 삭제 방식을 선택하는 공통 바텀시트 스타일 모달
 *
 * Props:
 *   visible      — 모달 표시 여부
 *   onClose      — 취소 / 닫기
 *   onConfirm    — (immediate: boolean) => Promise<void>   실제 탈퇴 실행
 *   loading      — 처리 중 여부
 */
import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

interface Props {
  visible: boolean;
  onClose: () => void;
  onConfirm: (immediate: boolean) => Promise<void>;
  loading: boolean;
}

type Choice = "immediate" | "retain" | null;

export function WithdrawalModal({ visible, onClose, onConfirm, loading }: Props) {
  const [choice, setChoice] = useState<Choice>(null);

  function handleClose() {
    if (loading) return;
    setChoice(null);
    onClose();
  }

  async function handleConfirm() {
    if (!choice || loading) return;
    await onConfirm(choice === "immediate");
    setChoice(null);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <Pressable style={s.overlay} onPress={handleClose}>
        <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
          {/* 헤더 */}
          <View style={s.header}>
            <View style={s.handle} />
            <Text style={s.title}>회원 탈퇴</Text>
            <Text style={s.subtitle}>
              탈퇴 후 데이터 처리 방식을 선택해주세요.
            </Text>
          </View>

          {/* 선택지 */}
          <View style={s.options}>
            {/* 즉시 삭제 */}
            <Pressable
              style={[s.option, choice === "immediate" && s.optionSelected]}
              onPress={() => setChoice("immediate")}
            >
              <View style={s.optionTop}>
                <View style={[s.dot, { backgroundColor: "#D96C6C" }]} />
                <Text style={[s.optionTitle, choice === "immediate" && { color: "#D96C6C" }]}>
                  즉시 삭제
                </Text>
                <View style={[s.badge, { backgroundColor: "#FEE2E2" }]}>
                  <Text style={[s.badgeText, { color: "#D96C6C" }]}>재가입 가능</Text>
                </View>
              </View>
              <Text style={s.optionDesc}>
                개인정보가 즉시 삭제됩니다.{"\n"}
                탈퇴 즉시 동일한 전화번호·이메일로{"\n"}
                재가입할 수 있습니다.{"\n"}
                <Text style={{ color: "#D96C6C" }}>기존 데이터는 복구할 수 없습니다.</Text>
              </Text>
            </Pressable>

            {/* 90일 보존 */}
            <Pressable
              style={[s.option, choice === "retain" && s.optionSelectedBlue]}
              onPress={() => setChoice("retain")}
            >
              <View style={s.optionTop}>
                <View style={[s.dot, { backgroundColor: "#2EC4B6" }]} />
                <Text style={[s.optionTitle, choice === "retain" && { color: "#2EC4B6" }]}>
                  90일 보존 후 삭제
                </Text>
                <View style={[s.badge, { backgroundColor: "#E6FFFA" }]}>
                  <Text style={[s.badgeText, { color: "#2EC4B6" }]}>복구 가능</Text>
                </View>
              </View>
              <Text style={s.optionDesc}>
                90일간 데이터가 보존됩니다.{"\n"}
                보존 기간 내 재가입 시 기존 데이터를{"\n"}
                복구할 수 있습니다.{"\n"}
                <Text style={{ color: "#64748B" }}>90일 후 완전히 삭제됩니다.</Text>
              </Text>
            </Pressable>
          </View>

          {/* 버튼 */}
          <View style={s.buttons}>
            <Pressable style={s.cancelBtn} onPress={handleClose} disabled={loading}>
              <Text style={s.cancelText}>취소</Text>
            </Pressable>
            <Pressable
              style={[
                s.confirmBtn,
                !choice && { backgroundColor: "#CBD5E1" },
                choice === "immediate" && { backgroundColor: "#D96C6C" },
                choice === "retain" && { backgroundColor: "#2EC4B6" },
                loading && { opacity: 0.7 },
              ]}
              onPress={handleConfirm}
              disabled={!choice || loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={s.confirmText}>탈퇴 확인</Text>
              )}
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
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 36,
    paddingTop: 12,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: "#E2E8F0",
    alignSelf: "center", marginBottom: 16,
  },
  header: { marginBottom: 20 },
  title: { fontSize: 18, fontFamily: "Pretendard-Regular", color: "#0F172A", marginBottom: 6 },
  subtitle: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B", lineHeight: 18 },

  options: { gap: 12, marginBottom: 20 },
  option: {
    borderWidth: 1.5, borderColor: "#E2E8F0", borderRadius: 16,
    padding: 16, backgroundColor: "#F8FAFC",
  },
  optionSelected: { borderColor: "#D96C6C", backgroundColor: "#FFF5F5" },
  optionSelectedBlue: { borderColor: "#2EC4B6", backgroundColor: "#F0FDFB" },
  optionTop: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  optionTitle: { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#0F172A", flex: 1 },
  badge: {
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 8,
  },
  badgeText: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  optionDesc: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#475569", lineHeight: 20 },

  buttons: { flexDirection: "row", gap: 10 },
  cancelBtn: {
    flex: 1, height: 50, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#F1F5F9",
  },
  cancelText: { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#64748B" },
  confirmBtn: {
    flex: 2, height: 50, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#CBD5E1",
  },
  confirmText: { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" },
});
