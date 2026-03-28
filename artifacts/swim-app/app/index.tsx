import { ArrowRight, CircleAlert, Key, Lock, User, UserX } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import SwimNoteLogo from "../assets/images/swimnote-logo.svg";

import Colors from "@/constants/colors";
import { LOGIN_LABELS } from "@/constants/auth";
import { useAuth } from "@/context/AuthContext";

const C = Colors.light;

export default function LoginScreen() {
  const { unifiedLogin } = useAuth();
  const insets = useSafeAreaInsets();
  const pwRef = useRef<TextInput>(null);

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword]     = useState("");
  const [showPw, setShowPw]         = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");
  const [failCount, setFailCount]   = useState(0);
  const [showNotFoundModal, setShowNotFoundModal] = useState(false);

  async function handleLogin(overrideId?: string, overridePw?: string) {
    const finalId = (overrideId ?? identifier).trim();
    const finalPw = overridePw ?? password;
    if (!finalId || !finalPw) {
      setError("아이디와 비밀번호를 입력해주세요.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await unifiedLogin(finalId, finalPw);
      setFailCount(0);
    } catch (err: unknown) {
      const e = err as Error & {
        needs_activation?: boolean; teacher_id?: string;
        error_code?: string; totp_required?: boolean; totp_session?: string;
      };
      console.error("[LOGIN_ERROR]", {
        message: e.message,
        error_code: e.error_code,
        stack: e.stack,
      });
      if (e.totp_required && e.totp_session) {
        router.push({ pathname: "/otp-verify", params: { session: e.totp_session } } as any);
        return;
      }
      if (e.error_code === "pending_pool_request") {
        setError("가입 요청이 승인 대기 중입니다.\n수영장 관리자 승인 후 로그인 가능합니다.");
        return;
      }
      if (e.error_code === "pending_teacher_approval") {
        setError("관리자 승인 대기 중입니다. 수영장 관리자가 승인하면 로그인할 수 있습니다.");
        return;
      }
      if (e.needs_activation && e.teacher_id) {
        router.push({ pathname: "/teacher-activate", params: { teacher_id: e.teacher_id } } as any);
        return;
      }
      if (e.error_code === "user_not_found") {
        setShowNotFoundModal(true);
        return;
      }
      if (e.error_code === "wrong_password") {
        const nextCount = failCount + 1;
        setFailCount(nextCount);
        setError("아이디 또는 비밀번호가 올바르지 않습니다.");
        return;
      }
      setError(e.message || "아이디 또는 비밀번호를 확인해주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: C.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.logoArea}>
          <View style={styles.logoWrap}>
            <View style={styles.logoBorder}>
              <View style={styles.logoImage}>
                <SwimNoteLogo width={100} height={115} viewBox="160 44 185 210" />
              </View>
            </View>
            <Text style={styles.logoWordmark}>SwimNote</Text>
          </View>
          <Text style={[styles.appSub, { color: C.text, marginTop: 10 }]}>어린이 수영레슨 올인원</Text>
          <Text style={[styles.appDesc, { color: C.textMuted, marginTop: 6 }]}>
            수영장 · 선생님 · 학부모가 하나로 연결됩니다
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: C.card }]}>
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>아이디</Text>
            <View style={[styles.inputRow, { borderColor: identifier ? C.tint : C.border, backgroundColor: C.background }]}>
              <User size={16} color={identifier ? C.tint : C.textMuted} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={identifier}
                onChangeText={v => { setIdentifier(v); setError(""); setFailCount(0); }}
                placeholder="아이디 또는 전화번호"
                placeholderTextColor={C.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                onSubmitEditing={() => pwRef.current?.focus()}
                editable={!loading}
              />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>비밀번호</Text>
            <View style={[styles.inputRow, { borderColor: password ? C.button : C.border, backgroundColor: C.background }]}>
              <Lock size={16} color={password ? C.button : C.textMuted} />
              <TextInput
                ref={pwRef}
                style={[styles.input, { color: C.text }]}
                value={password}
                onChangeText={v => { setPassword(v); setError(""); }}
                placeholder="비밀번호를 입력하세요"
                placeholderTextColor={C.textMuted}
                secureTextEntry={!showPw}
                returnKeyType="done"
                onSubmitEditing={() => handleLogin()}
                editable={!loading}
              />
              <Pressable onPress={() => setShowPw(v => !v)} hitSlop={8}>
                <LucideIcon name={showPw ? "eye-off" : "eye"} size={15} color={C.textMuted} />
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.arrowBtn, { opacity: pressed || loading ? 0.5 : 1 }]}
                onPress={() => handleLogin()}
                disabled={loading}
              >
                {loading
                  ? <ActivityIndicator color={C.tint} size="small" />
                  : <ArrowRight size={22} color={C.tint} />
                }
              </Pressable>
            </View>
          </View>

          {!!error && (
            <View style={[styles.errBox, { backgroundColor: "#F9DEDA" }]}>
              <CircleAlert size={14} color={C.error} />
              <Text style={[styles.errText, { color: C.error }]}>{error}</Text>
            </View>
          )}

          <Pressable
            style={({ pressed }) => [styles.forgotBtn, { opacity: pressed ? 0.7 : 1 }]}
            onPress={() => router.push({ pathname: "/forgot-password", params: { identifier } } as any)}
          >
            <Key size={13} color={C.textMuted} />
            <Text style={[styles.forgotText, { color: C.textMuted }]}>비밀번호를 잊으셨나요?</Text>
          </Pressable>
        </View>

        <View style={styles.signupRow}>
          <Text style={[styles.signupLabel, { color: C.textSecondary }]}>아직 계정이 없으신가요?</Text>
          <Pressable
            style={({ pressed }) => [styles.signupBtn, { opacity: pressed ? 0.7 : 1 }]}
            onPress={() => router.push("/signup" as any)}
          >
            <Text style={[styles.signupBtnText, { color: C.tint }]}>회원가입</Text>
            <ArrowRight size={14} color={C.tint} />
          </Pressable>
        </View>
      </ScrollView>

      <Modal
        transparent
        visible={showNotFoundModal}
        animationType="fade"
        onRequestClose={() => setShowNotFoundModal(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowNotFoundModal(false)}>
          <Pressable style={[styles.modalCard, { backgroundColor: C.card }]} onPress={e => e.stopPropagation()}>
            <View style={[styles.modalIconWrap, { backgroundColor: "#FFF1BF" }]}>
              <UserX size={26} color="#D97706" />
            </View>
            <Text style={[styles.modalTitle, { color: C.text }]}>가입된 계정이 없습니다</Text>
            <Text style={[styles.modalDesc, { color: C.textSecondary }]}>
              입력하신 아이디로 등록된 계정이 없습니다.{"\n"}
              아이디를 다시 확인하거나, 새로 가입해주세요.
            </Text>
            <View style={styles.modalBtns}>
              <Pressable
                style={({ pressed }) => [styles.modalBtn, styles.modalBtnSecondary, { borderColor: C.border, opacity: pressed ? 0.7 : 1 }]}
                onPress={() => setShowNotFoundModal(false)}
              >
                <Text style={[styles.modalBtnText, { color: C.textSecondary }]}>다시 입력</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.modalBtn, { backgroundColor: C.button, opacity: pressed ? 0.85 : 1 }]}
                onPress={() => { setShowNotFoundModal(false); router.push("/signup" as any); }}
              >
                <Text style={[styles.modalBtnText, { color: "#fff" }]}>회원가입하기</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { flexGrow: 1, paddingHorizontal: 20, justifyContent: "center" },
  logoArea: { alignItems: "center", paddingBottom: 24 },

  logoWrap: { alignItems: "center", gap: 10 },
  logoBorder: { borderRadius: 21, borderWidth: 2, borderColor: "#04111f", shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.22, shadowRadius: 18, elevation: 10 },
  logoImage: { width: 100, height: 115, borderRadius: 19, overflow: "hidden", backgroundColor: "#0a2540" },
  logoWordmark: { fontSize: 36, fontWeight: "700", color: "#0a2540", letterSpacing: 0.5 },
  appSub: { fontSize: 18, fontFamily: "Pretendard-Regular", textAlign: "center", letterSpacing: 0.3 },
  appDesc: { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 20 },
  card: { borderRadius: 20, padding: 16, gap: 10, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 12, elevation: 4 },
  cardTitle: { fontSize: 17, fontFamily: "Pretendard-Regular" },
  field: { gap: 4 },
  fieldLabel: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, height: 46 },
  input: { flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular" },
  errBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10 },
  errText: { fontSize: 12, fontFamily: "Pretendard-Regular", flex: 1 },
  arrowBtn: { alignItems: "center", justifyContent: "center", paddingLeft: 4 },
  forgotBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center", paddingVertical: 2 },
  forgotText: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  signupRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 14 },
  signupLabel: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  signupBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4 },
  signupBtnText: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  modalCard: { width: 300, borderRadius: 22, padding: 24, alignItems: "center", gap: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 10 },
  modalIconWrap: { width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  modalTitle: { fontSize: 17, fontFamily: "Pretendard-Regular", textAlign: "center" },
  modalDesc: { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 20 },
  modalBtns: { flexDirection: "row", gap: 10, marginTop: 6, width: "100%" },
  modalBtn: { flex: 1, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  modalBtnSecondary: { borderWidth: 1.5 },
  modalBtnText: { fontSize: 14, fontFamily: "Pretendard-Regular" },
});
