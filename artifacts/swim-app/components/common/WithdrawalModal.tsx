/**
 * WithdrawalModal
 * 학부모 회원탈퇴 — 3단계 보안 플로우
 *
 * FREE  : 1차경고 → 비밀번호 입력 → API 호출
 * PAID  : 1차경고 → 데이터처리 선택 → 비밀번호 입력 → API 호출
 *
 * Props:
 *   visible      — 모달 표시 여부
 *   onClose      — 취소 / 닫기
 *   onConfirm    — (immediate: boolean, password: string) => Promise<void>
 *   loading      — 처리 중 여부
 *   isPaidPlan   — 유료 구독 중이면 90일 옵션 표시
 */
import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const C = Colors.light;

interface Props {
  visible: boolean;
  onClose: () => void;
  onConfirm: (immediate: boolean, password: string) => Promise<void>;
  loading: boolean;
  isPaidPlan?: boolean;
}

type Step = "warning" | "choice" | "password";
type Choice = "immediate" | "retain" | null;

export function WithdrawalModal({ visible, onClose, onConfirm, loading, isPaidPlan = false }: Props) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>("warning");
  const [choice, setChoice] = useState<Choice>(null);
  const [password, setPassword] = useState("");
  const [pwError, setPwError] = useState("");

  function reset() {
    setStep("warning");
    setChoice(null);
    setPassword("");
    setPwError("");
  }

  function handleClose() {
    if (loading) return;
    reset();
    onClose();
  }

  // 1차 경고 → 다음 단계
  function handleWarningContinue() {
    if (isPaidPlan) {
      setStep("choice");
    } else {
      setStep("password");
    }
  }

  // PAID: 선택 확정 → 비밀번호 단계
  function handleChoiceConfirm() {
    if (!choice || loading) return;
    setStep("password");
  }

  // 비밀번호 입력 → 최종 탈퇴
  async function handleFinalWithdraw() {
    if (loading) return;
    if (!password.trim()) {
      setPwError("비밀번호를 입력해주세요.");
      return;
    }
    setPwError("");
    const isImmediate = isPaidPlan ? choice === "immediate" : true;
    try {
      await onConfirm(isImmediate, password);
    } catch {
      // 오류는 호출자에서 처리
    }
  }

  const paddingBottom = Math.max(insets.bottom, 24);

  // ── STEP 1: 1차 경고 ─────────────────────────────────────────────────────
  if (step === "warning") {
    return (
      <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={handleClose}>
        <Pressable style={s.overlay} onPress={handleClose}>
          <Pressable style={[s.sheet, { paddingBottom }]} onPress={e => e.stopPropagation()}>
            <View style={s.header}>
              <View style={s.handle} />
              <Text style={s.title}>회원 탈퇴</Text>
              <Text style={s.subtitle}>
                회원 탈퇴 시 현재 수영장의 계정과{"\n"}
                연결된 데이터에 더 이상 접근할 수 없습니다.{"\n\n"}
                탈퇴 후에도 수영장의 학생 정보(출석, 일지, 성장 기록 등)는{"\n"}
                수영장 측에 유지됩니다.
              </Text>
            </View>
            <View style={s.buttons}>
              <Pressable style={s.cancelBtn} onPress={handleClose}>
                <Text style={s.cancelText}>취소</Text>
              </Pressable>
              <Pressable style={[s.confirmBtn, { backgroundColor: "#D96C6C" }]} onPress={handleWarningContinue}>
                <Text style={s.confirmText}>계속</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  // ── STEP 2 (PAID only): 데이터 처리 선택 ────────────────────────────────
  if (step === "choice") {
    return (
      <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={handleClose}>
        <Pressable style={s.overlay} onPress={handleClose}>
          <Pressable style={[s.sheet, { paddingBottom }]} onPress={e => e.stopPropagation()}>
            <View style={s.header}>
              <View style={s.handle} />
              <Text style={s.title}>데이터 처리 방식</Text>
              <Text style={s.subtitle}>탈퇴 후 데이터 처리 방식을 선택해주세요.</Text>
            </View>

            <View style={s.options}>
              <Pressable
                style={[s.option, choice === "immediate" && s.optionSelected]}
                onPress={() => setChoice("immediate")}
              >
                <View style={s.optionTop}>
                  <View style={[s.dot, { backgroundColor: "#D96C6C" }]} />
                  <Text style={[s.optionTitle, choice === "immediate" && { color: "#D96C6C" }]}>즉시 삭제</Text>
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

              <Pressable
                style={[s.option, choice === "retain" && s.optionSelectedBlue]}
                onPress={() => setChoice("retain")}
              >
                <View style={s.optionTop}>
                  <View style={[s.dot, { backgroundColor: C.brandStrong }]} />
                  <Text style={[s.optionTitle, choice === "retain" && { color: C.brandStrong }]}>90일 보존 후 삭제</Text>
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

            <View style={s.buttons}>
              <Pressable style={s.cancelBtn} onPress={handleClose}>
                <Text style={s.cancelText}>취소</Text>
              </Pressable>
              <Pressable
                style={[
                  s.confirmBtn,
                  !choice && { backgroundColor: "#CBD5E1" },
                  choice === "immediate" && { backgroundColor: "#D96C6C" },
                  choice === "retain" && { backgroundColor: C.primaryAction },
                ]}
                onPress={handleChoiceConfirm}
                disabled={!choice}
              >
                <Text style={s.confirmText}>계속</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  // ── STEP 3: 비밀번호 재확인 ─────────────────────────────────────────────
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={handleClose}>
      <Pressable style={s.overlay} onPress={handleClose}>
        <Pressable style={[s.sheet, { paddingBottom }]} onPress={e => e.stopPropagation()}>
          <View style={s.header}>
            <View style={s.handle} />
            <Text style={s.title}>최종 확인</Text>
            <Text style={s.subtitle}>정말 탈퇴하시겠습니까?{"\n"}비밀번호를 입력하여 본인 확인 후 탈퇴됩니다.</Text>
          </View>

          <View style={s.pwWrap}>
            <TextInput
              style={[s.pwInput, pwError ? s.pwInputError : null]}
              placeholder="비밀번호 입력"
              placeholderTextColor={C.textTertiary}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="current-password"
              value={password}
              onChangeText={v => { setPassword(v); if (pwError) setPwError(""); }}
              editable={!loading}
              returnKeyType="done"
              onSubmitEditing={handleFinalWithdraw}
            />
            {!!pwError && <Text style={s.pwError}>{pwError}</Text>}
          </View>

          <View style={s.buttons}>
            <Pressable style={s.cancelBtn} onPress={handleClose} disabled={loading}>
              <Text style={s.cancelText}>취소</Text>
            </Pressable>
            <Pressable
              style={[s.confirmBtn, { backgroundColor: "#D96C6C" }, (!password.trim() || loading) && { opacity: 0.5 }]}
              onPress={handleFinalWithdraw}
              disabled={!password.trim() || loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={s.confirmText}>최종 탈퇴</Text>
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
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  badgeText: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  optionDesc: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#475569", lineHeight: 20 },

  pwWrap: { marginBottom: 20 },
  pwInput: {
    height: 52,
    borderWidth: 1.5,
    borderColor: C.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 15,
    fontFamily: "Pretendard-Regular",
    color: C.textPrimary,
    backgroundColor: C.backgroundSoft,
  },
  pwInputError: { borderColor: "#D96C6C" },
  pwError: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#D96C6C", marginTop: 6, marginLeft: 4 },

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
