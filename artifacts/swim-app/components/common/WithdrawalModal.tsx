/**
 * WithdrawalModal
 * 탈퇴 시 두 가지 삭제 방식을 선택하는 공통 바텀시트 스타일 모달
 *
 * Props:
 *   visible      — 모달 표시 여부
 *   onClose      — 취소 / 닫기
 *   onConfirm    — (immediate: boolean) => Promise<void>   실제 탈퇴 실행
 *   loading      — 처리 중 여부
 *   isPaidPlan   — 유료 구독 중 여부 (true면 90일 보존 옵션 표시)
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const C = Colors.light;

interface Props {
  visible: boolean;
  onClose: () => void;
  onConfirm: (immediate: boolean) => Promise<void>;
  loading: boolean;
  isPaidPlan?: boolean; // 유료 구독 중이면 90일 옵션 활성화
}

type Choice = "immediate" | "retain" | null;

export function WithdrawalModal({ visible, onClose, onConfirm, loading, isPaidPlan = false }: Props) {
  const [choice, setChoice] = useState<Choice>(null);
  const insets = useSafeAreaInsets();

  function handleClose() {
    if (loading) return;
    setChoice(null);
    onClose();
  }

  function handleConfirm() {
    if (!choice || loading) return;
    const isImmediate = choice === "immediate";
    setChoice(null);
    onClose();
    onConfirm(isImmediate).catch(() => {});
  }

  // 무료 플랜: 선택지 없이 즉시 삭제만 확인
  if (!isPaidPlan) {
    // [BUG FIX] handleConfirm()은 choice가 null이면 즉시 return 하므로
    // 무료 플랜에서는 onConfirm(true)을 직접 호출한다.
    function handleFreeConfirm() {
      if (loading) return;
      onClose();
      onConfirm(true).catch(() => {});
    }

    return (
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={handleClose}
      >
        <Pressable style={s.overlay} onPress={handleClose}>
          <Pressable style={[s.sheet, { paddingBottom: Math.max(insets.bottom, BASE_SHEET_PADDING_BOTTOM) }]} onPress={e => e.stopPropagation()}>
            <View style={s.header}>
              <View style={s.handle} />
              <Text style={s.title}>회원 탈퇴</Text>
              <Text style={s.subtitle}>
                탈퇴 시 계정 정보가 즉시 삭제됩니다.{"\n"}
                동일한 전화번호·이메일로 재가입할 수 있으나,{"\n"}
                기존 데이터는 복구할 수 없습니다.
              </Text>
            </View>

            <View style={s.buttons}>
              <Pressable style={s.cancelBtn} onPress={handleClose} disabled={loading}>
                <Text style={s.cancelText}>취소</Text>
              </Pressable>
              <Pressable
                style={[s.confirmBtn, { backgroundColor: "#D96C6C" }, loading && { opacity: 0.7 }]}
                onPress={handleFreeConfirm}
                disabled={loading}
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

  // 유료 플랜: 즉시 삭제 vs 90일 보존 선택
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <Pressable style={s.overlay} onPress={handleClose}>
        <Pressable style={[s.sheet, { paddingBottom: Math.max(insets.bottom, BASE_SHEET_PADDING_BOTTOM) }]} onPress={e => e.stopPropagation()}>
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
                탈퇴 즉시 동일한 이메일로 재가입할 수 있습니다.{"\n"}
                <Text style={{ color: "#D96C6C" }}>기존 데이터는 복구할 수 없습니다.</Text>
              </Text>
            </Pressable>

            {/* 90일 보존 */}
            <Pressable
              style={[s.option, choice === "retain" && s.optionSelectedBlue]}
              onPress={() => setChoice("retain")}
            >
              <View style={s.optionTop}>
                <View style={[s.dot, { backgroundColor: C.brandStrong }]} />
                <Text style={[s.optionTitle, choice === "retain" && { color: C.brandStrong }]}>
                  90일 보존 후 삭제
                </Text>
                <View style={[s.badge, { backgroundColor: C.brandSoft }]}>
                  <Text style={[s.badgeText, { color: C.brandStrong }]}>복구 가능</Text>
                </View>
              </View>
              <Text style={s.optionDesc}>
                90일간 데이터가 보존됩니다.{"\n"}
                이 기간 중 앱을 읽기 전용으로 사용할 수 있으며,{"\n"}
                동일 플랜 재구독 시 계정이 완전히 복구됩니다.{"\n"}
                <Text style={{ color: C.textSecondary }}>90일 후 완전히 삭제됩니다.</Text>
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
                choice === "retain" && { backgroundColor: C.primaryAction },
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

// paddingBottom은 컴포넌트 내에서 insets.bottom으로 처리하므로 sheet는 상수 없이 선언
// (실제 paddingBottom은 JSX에서 인라인으로 주입)
const BASE_SHEET_PADDING_BOTTOM = 24;

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: C.border,
    alignSelf: "center", marginBottom: 16,
  },
  header: { marginBottom: 20 },
  title: { fontSize: 18, fontFamily: "Pretendard-Regular", color: C.textPrimary, marginBottom: 6 },
  subtitle: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 18 },

  options: { gap: 12, marginBottom: 20 },
  option: {
    borderWidth: 1.5, borderColor: C.border, borderRadius: 16,
    padding: 16, backgroundColor: C.backgroundSoft,
  },
  optionSelected: { borderColor: "#D96C6C", backgroundColor: "#FFF5F5" },
  optionSelectedBlue: { borderColor: C.brandStrong, backgroundColor: C.brandMist },
  optionTop: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  optionTitle: { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.textPrimary, flex: 1 },
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
  cancelText: { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  confirmBtn: {
    flex: 2, height: 50, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#CBD5E1",
  },
  confirmText: { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" },
});
