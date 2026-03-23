/**
 * components/common/OtpGateModal.tsx
 * 민감 작업 실행 전 OTP 인증 게이트 모달
 * 사용법: visible/onSuccess/onCancel 으로 제어
 */
import { Feather } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import {
  Keyboard, Modal, Pressable, StyleSheet,
  Text, TextInput, View,
} from "react-native";

const P      = "#7C3AED";
const DANGER = "#D96C6C";
const GREEN  = "#1F8F86";
const VALID_OTP = "123456";

interface OtpGateModalProps {
  visible: boolean;
  title: string;
  desc?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function OtpGateModal({ visible, title, desc, onSuccess, onCancel }: OtpGateModalProps) {
  const [code,    setCode]    = useState("");
  const [error,   setError]   = useState("");
  const [success, setSuccess] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setCode(""); setError(""); setSuccess(false);
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [visible]);

  function handleChange(val: string) {
    const digits = val.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    setError("");
    if (digits.length === 6) verify(digits);
  }

  function verify(digits: string) {
    if (digits === VALID_OTP) {
      setSuccess(true);
      Keyboard.dismiss();
      setTimeout(() => { onSuccess(); }, 800);
    } else {
      setError("OTP 코드가 올바르지 않습니다.");
      setCode("");
    }
  }

  function handleConfirm() {
    if (code.length < 6) { setError("6자리 코드를 입력하세요."); return; }
    verify(code);
  }

  return (
    <Modal visible={visible} animationType="fade" transparent statusBarTranslucent
      onRequestClose={onCancel}>
      <Pressable style={s.backdrop} onPress={onCancel}>
        <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
          {/* 헤더 */}
          <View style={s.iconRow}>
            <View style={s.iconCircle}>
              <Feather name="shield" size={22} color={P} />
            </View>
          </View>
          <Text style={s.title}>{title}</Text>
          {!!desc && <Text style={s.desc}>{desc}</Text>}

          {success ? (
            <View style={s.successBox}>
              <Feather name="check-circle" size={20} color={GREEN} />
              <Text style={s.successTxt}>인증 성공 — 실행합니다</Text>
            </View>
          ) : (
            <>
              {/* OTP 입력 */}
              <View style={s.otpWrap}>
                <TextInput
                  ref={inputRef}
                  style={s.otpInput}
                  value={code}
                  onChangeText={handleChange}
                  keyboardType="number-pad"
                  maxLength={6}
                  placeholder="● ● ● ● ● ●"
                  placeholderTextColor="#C9C5C0"
                  textAlign="center"
                  letterSpacing={8}
                />
              </View>

              {/* 에러 */}
              {!!error && (
                <View style={s.errorRow}>
                  <Feather name="alert-circle" size={12} color={DANGER} />
                  <Text style={s.errorTxt}>{error}</Text>
                </View>
              )}

              {/* 힌트 (테스트) */}
              <View style={s.hintBox}>
                <Feather name="info" size={11} color="#9A948F" />
                <Text style={s.hintTxt}>테스트 코드: <Text style={{ fontFamily: "Inter_700Bold" }}>123456</Text></Text>
              </View>

              {/* 버튼 */}
              <View style={s.btnRow}>
                <Pressable style={s.cancelBtn} onPress={onCancel}>
                  <Text style={s.cancelTxt}>취소</Text>
                </Pressable>
                <Pressable style={[s.confirmBtn, code.length < 6 && { opacity: 0.45 }]} onPress={handleConfirm}>
                  <Feather name="unlock" size={14} color="#fff" />
                  <Text style={s.confirmTxt}>인증 확인</Text>
                </Pressable>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop:    { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", alignItems: "center", padding: 20 },
  sheet:       { width: "100%", backgroundColor: "#fff", borderRadius: 20, padding: 24, gap: 12, maxWidth: 380 },
  iconRow:     { alignItems: "center", marginBottom: 4 },
  iconCircle:  { width: 52, height: 52, borderRadius: 26, backgroundColor: "#EEDDF5", alignItems: "center", justifyContent: "center" },
  title:       { fontSize: 17, fontFamily: "Inter_700Bold", color: "#1F1F1F", textAlign: "center" },
  desc:        { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6F6B68", textAlign: "center", lineHeight: 18 },
  otpWrap:     { borderWidth: 2, borderColor: "#E9E2DD", borderRadius: 12, backgroundColor: "#F6F3F1", paddingVertical: 4 },
  otpInput:    { fontSize: 28, fontFamily: "Inter_700Bold", color: "#1F1F1F", paddingVertical: 12, paddingHorizontal: 16 },
  errorRow:    { flexDirection: "row", alignItems: "center", gap: 5 },
  errorTxt:    { fontSize: 12, fontFamily: "Inter_400Regular", color: DANGER },
  hintBox:     { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#F6F3F1", borderRadius: 8, padding: 8 },
  hintTxt:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9A948F" },
  successBox:  { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, justifyContent: "center" },
  successTxt:  { fontSize: 14, fontFamily: "Inter_600SemiBold", color: GREEN },
  btnRow:      { flexDirection: "row", gap: 10, marginTop: 4 },
  cancelBtn:   { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: "#F6F3F1", alignItems: "center" },
  cancelTxt:   { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#1F1F1F" },
  confirmBtn:  { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: P, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6 },
  confirmTxt:  { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
