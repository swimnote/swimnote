/**
 * components/common/OtpGateModal.tsx
 * 민감 작업 실행 전 실제 Google TOTP 인증 게이트 모달
 * - /auth/totp/verify-action API로 실제 검증
 * - 사용법: visible/token/onSuccess/onCancel 으로 제어
 */
import { CircleAlert, CircleCheck, Shield, Smartphone, Unlock } from "lucide-react-native";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Keyboard, Modal, Pressable, StyleSheet,
  Text, TextInput, View,
} from "react-native";
import { apiRequest } from "@/context/AuthContext";

const P      = "#7C3AED";
const DANGER = "#D96C6C";
const GREEN  = "#2EC4B6";

interface OtpGateModalProps {
  visible: boolean;
  title: string;
  desc?: string;
  token: string | null;
  onSuccess: () => void;
  onCancel: () => void;
}

export function OtpGateModal({ visible, title, desc, token, onSuccess, onCancel }: OtpGateModalProps) {
  const [code,    setCode]    = useState("");
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setCode(""); setError(""); setSuccess(false); setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [visible]);

  function handleChange(val: string) {
    const digits = val.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    setError("");
  }

  async function verify() {
    const digits = code.replace(/\D/g, "");
    if (digits.length !== 6) { setError("6자리 코드를 입력해주세요."); return; }
    setLoading(true);
    setError("");
    try {
      const res = await apiRequest(token, "/auth/totp/verify-action", {
        method: "POST",
        body: JSON.stringify({ otp_code: digits }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "OTP 코드가 올바르지 않습니다.");
        setCode("");
        setTimeout(() => inputRef.current?.focus(), 100);
        return;
      }
      setSuccess(true);
      Keyboard.dismiss();
      setTimeout(() => { onSuccess(); }, 700);
    } catch {
      setError("서버 연결 오류가 발생했습니다.");
      setCode("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal visible={visible} animationType="fade" transparent statusBarTranslucent
      onRequestClose={onCancel}>
      <Pressable style={s.backdrop} onPress={onCancel}>
        <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
          {/* 헤더 */}
          <View style={s.iconRow}>
            <View style={s.iconCircle}>
              <Shield size={22} color={P} />
            </View>
          </View>
          <Text style={s.title}>{title}</Text>
          {!!desc && <Text style={s.desc}>{desc}</Text>}

          {success ? (
            <View style={s.successBox}>
              <CircleCheck size={20} color={GREEN} />
              <Text style={s.successTxt}>인증 성공 — 실행합니다</Text>
            </View>
          ) : (
            <>
              {/* OTP 박스 */}
              <Pressable style={s.otpWrap} onPress={() => inputRef.current?.focus()}>
                <View style={s.otpBoxRow}>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <View key={i} style={[
                      s.otpBox,
                      { borderColor: code.length === i ? P : code[i] ? P : "#E5E7EB" },
                    ]}>
                      <Text style={s.otpBoxTxt}>{code[i] || ""}</Text>
                    </View>
                  ))}
                </View>

                <TextInput
                  ref={inputRef}
                  style={s.hiddenInput}
                  value={code}
                  onChangeText={handleChange}
                  keyboardType="number-pad"
                  maxLength={6}
                  returnKeyType="done"
                  onSubmitEditing={verify}
                  caretHidden
                />
              </Pressable>

              {/* 에러 */}
              {!!error && (
                <View style={s.errorRow}>
                  <CircleAlert size={13} color={DANGER} />
                  <Text style={s.errorTxt}>{error}</Text>
                </View>
              )}

              {/* 안내 */}
              <View style={s.hintBox}>
                <Smartphone size={12} color="#64748B" />
                <Text style={s.hintTxt}>Google Authenticator 앱의 6자리 코드를 입력하세요</Text>
              </View>

              {/* 버튼 */}
              <View style={s.btnRow}>
                <Pressable style={s.cancelBtn} onPress={onCancel} disabled={loading}>
                  <Text style={s.cancelTxt}>취소</Text>
                </Pressable>
                <Pressable
                  style={[s.confirmBtn, (code.length < 6 || loading) && { opacity: 0.55 }]}
                  onPress={verify}
                  disabled={loading || code.length < 6}
                >
                  {loading
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <><Unlock size={14} color="#fff" /><Text style={s.confirmTxt}>인증 확인</Text></>
                  }
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
  sheet:       { width: "100%", backgroundColor: "#fff", borderRadius: 20, padding: 24, gap: 14, maxWidth: 380 },
  iconRow:     { alignItems: "center", marginBottom: 2 },
  iconCircle:  { width: 52, height: 52, borderRadius: 26, backgroundColor: "#EEDDF5", alignItems: "center", justifyContent: "center" },
  title:       { fontSize: 17, fontFamily: "Pretendard-Regular", color: "#0F172A", textAlign: "center" },
  desc:        { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B", textAlign: "center", lineHeight: 18 },
  otpWrap:     { alignItems: "center", position: "relative" },
  otpBoxRow:   { flexDirection: "row", gap: 8 },
  otpBox:      { width: 42, height: 52, borderRadius: 12, borderWidth: 2, alignItems: "center", justifyContent: "center", backgroundColor: "#F9F8FF" },
  otpBoxTxt:   { fontSize: 22, fontFamily: "Pretendard-Regular", color: P },
  hiddenInput: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0.01, color: "transparent" },
  errorRow:    { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#FEF2F2", padding: 10, borderRadius: 10 },
  errorTxt:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: DANGER, flex: 1 },
  hintBox:     { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#F5F3FF", borderRadius: 10, padding: 10 },
  hintTxt:     { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#7C3AED", flex: 1 },
  successBox:  { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, justifyContent: "center" },
  successTxt:  { fontSize: 14, fontFamily: "Pretendard-Regular", color: GREEN },
  btnRow:      { flexDirection: "row", gap: 10, marginTop: 2 },
  cancelBtn:   { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: "#FFFFFF", alignItems: "center" },
  cancelTxt:   { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  confirmBtn:  { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: P, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6 },
  confirmTxt:  { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
});
