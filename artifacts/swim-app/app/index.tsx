/**
 * index.tsx — 로그인 첫 화면
 * 상단: 로고 + 브랜드명 + 보조설명
 * 중단: 아이디/비밀번호 입력 + 로그인 버튼 + 비밀번호 찾기
 * 하단: or 구분선 + 카카오 가입 / 일반 가입
 */
import { CircleAlert, Key, Lock, User, UserX } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import Svg, { Ellipse, Path } from "react-native-svg";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Dimensions, Keyboard, Modal,
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import SwimNoteLogo from "../assets/images/swimnote-logo.svg";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { toAsciiOnly } from "@/utils/koreanToQwerty";
import { login as kakaoLogin } from "@react-native-seoul/kakao-login";
import * as AppleAuthentication from "expo-apple-authentication";

const C = Colors.light;
const BRAND   = "#F97316";
const KAKAO   = "#FEE500";

function KakaoIcon({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 3C6.48 3 2 6.58 2 11C2 13.8 3.68 16.27 6.24 17.76L5.1 21.5L9.3 19.04C10.16 19.22 11.07 19.32 12 19.32C17.52 19.32 22 15.74 22 11C22 6.58 17.52 3 12 3Z"
        fill="#3C1E1E"
      />
    </Svg>
  );
}

export default function LoginScreen() {
  const { unifiedLogin, kakaoSocialLogin, appleSocialLogin } = useAuth();
  const insets = useSafeAreaInsets();
  const pwRef  = useRef<TextInput>(null);

  const [identifier, setIdentifier]       = useState("");
  const [password,   setPassword]         = useState("");
  const [showPw,     setShowPw]           = useState(false);
  const [loading,    setLoading]          = useState(false);
  const [kakaoLoading, setKakaoLoading]   = useState(false);
  const [appleLoading, setAppleLoading]   = useState(false);
  const [error,      setError]            = useState("");
  const [failCount,  setFailCount]        = useState(0);
  const [showNotFoundModal, setShowNotFoundModal] = useState(false);
  const [keyboardHeight, setKeyboardHeight]       = useState(0);
  const [focusedField, setFocusedField]           = useState<"id" | "pw" | null>(null);

  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const onShow = Keyboard.addListener(showEvt, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const onHide = Keyboard.addListener(hideEvt, () => {
      setKeyboardHeight(0);
      setFocusedField(null);
    });
    return () => { onShow.remove(); onHide.remove(); };
  }, []);

  async function handleLogin() {
    const finalId = identifier.trim();
    const finalPw = password;
    if (!finalId || !finalPw) { setError("아이디와 비밀번호를 입력해주세요."); return; }
    setLoading(true); setError("");
    try {
      await unifiedLogin(finalId, finalPw);
      setFailCount(0);
    } catch (err: unknown) {
      const e = err as Error & {
        needs_activation?: boolean; teacher_id?: string;
        error_code?: string; totp_required?: boolean; totp_session?: string;
      };
      if (e.totp_required && e.totp_session) {
        router.push({ pathname: "/otp-verify", params: { session: e.totp_session } } as any); return;
      }
      if (e.error_code === "pending_pool_request") {
        setError("가입 요청이 승인 대기 중입니다.\n수영장 관리자 승인 후 로그인 가능합니다."); return;
      }
      if (e.error_code === "pending_teacher_approval") {
        setError("관리자 승인 대기 중입니다. 수영장 관리자가 승인하면 로그인할 수 있습니다."); return;
      }
      if (e.needs_activation && e.teacher_id) {
        router.push({ pathname: "/teacher-activate", params: { teacher_id: e.teacher_id } } as any); return;
      }
      if (e.error_code === "user_not_found") { setShowNotFoundModal(true); return; }
      if (e.error_code === "wrong_password") {
        setFailCount(n => n + 1);
        setError("아이디 또는 비밀번호가 올바르지 않습니다."); return;
      }
      setError(e.message || "아이디 또는 비밀번호를 확인해주세요.");
    } finally { setLoading(false); }
  }

  async function handleAppleLogin() {
    if (Platform.OS !== "ios") { setError("Apple 로그인은 iOS에서만 사용 가능합니다."); return; }
    setAppleLoading(true); setError("");
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      const fullName = credential.fullName
        ? [credential.fullName.familyName, credential.fullName.givenName].filter(Boolean).join("")
        : null;
      await appleSocialLogin(credential.identityToken!, fullName);
    } catch (err: unknown) {
      const e = err as any;
      if (e?.code === "ERR_REQUEST_CANCELED") return;
      const code = e?.error_code;
      if (code === "apple_no_account" && e?.apple_info) {
        router.push({
          pathname: "/(auth)/kakao-link",
          params: {
            kakaoId: e.apple_info.apple_id,
            kakaoName: e.apple_info.name || "",
            kakaoProfileImage: "",
            loginType: "apple",
          },
        } as any);
        return;
      }
      setError(e?.message || "Apple 로그인에 실패했습니다.");
    } finally { setAppleLoading(false); }
  }

  async function handleKakaoLogin() {
    if (Platform.OS === "web") { setError("카카오 로그인은 앱에서만 가능합니다."); return; }
    if (typeof kakaoLogin !== "function") {
      setError("카카오 로그인은 정식 앱 빌드에서만 사용 가능합니다.");
      return;
    }
    setKakaoLoading(true); setError("");
    try {
      const result = await kakaoLogin();
      await kakaoSocialLogin(result.accessToken);
    } catch (err: unknown) {
      const e = err as Error & { error_code?: string; kakao_info?: any };
      if (e.error_code === "kakao_no_account" && e.kakao_info) {
        router.push({
          pathname: "/(auth)/kakao-link",
          params: { kakaoId: e.kakao_info.kakao_id, kakaoProfileImage: e.kakao_info.profile_image || "", kakaoName: e.kakao_info.name || "" },
        } as any); return;
      }
      if ((err as any)?.code === "E_CANCELLED_OPERATION" || (e as any)?.message?.includes("cancel")) return;
      setError(e.message || "카카오 로그인에 실패했습니다.");
    } finally { setKakaoLoading(false); }
  }

  return (
    <View style={[s.root, { backgroundColor: "#fff" }]}>
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        scrollEnabled={false}
      >
        {/* ── 전체 콘텐츠 (로고 + 폼 + 가입 버튼) ── */}
        <View style={s.bottomSection}>
        <View style={s.logoArea}>
          <View style={s.logoWrap}>
            <View style={s.logoBorder}>
              <View style={s.logoImage}>
                <SwimNoteLogo width={80} height={92} viewBox="160 44 185 210" />
              </View>
            </View>
          </View>
          <Text style={s.tagline}>어린이 수영레슨 올인원 플랫폼</Text>
          <Text style={s.taglineSub}>수영장 · 선생님 · 학부모가 하나로</Text>
        </View>

        {/* ── 로그인 폼 ── */}
        <View style={s.form}>
          {/* 아이디 */}
          <View style={s.fieldWrap}>
            <Text style={s.fieldLabel}>아이디</Text>
            <View style={[s.inputRow, { borderColor: identifier ? BRAND : "#E2E8F0" }]}>
              <User size={16} color={identifier ? BRAND : "#94A3B8"} />
              <TextInput
                style={s.input}
                value={identifier}
                onChangeText={v => { setIdentifier(toAsciiOnly(v)); setError(""); setFailCount(0); }}
                onFocus={() => setFocusedField("id")}
                placeholder="아이디를 입력하세요"
                placeholderTextColor="#CBD5E1"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="ascii-capable"
                returnKeyType="next"
                onSubmitEditing={() => pwRef.current?.focus()}
                editable={!loading}
              />
            </View>
          </View>

          {/* 비밀번호 */}
          <View style={s.fieldWrap}>
            <Text style={s.fieldLabel}>비밀번호</Text>
            <View style={[s.inputRow, { borderColor: password ? BRAND : "#E2E8F0" }]}>
              <Lock size={16} color={password ? BRAND : "#94A3B8"} />
              <TextInput
                ref={pwRef}
                style={s.input}
                value={password}
                onChangeText={v => { setPassword(toAsciiOnly(v)); setError(""); }}
                onFocus={() => setFocusedField("pw")}
                placeholder="비밀번호를 입력하세요"
                placeholderTextColor="#CBD5E1"
                secureTextEntry={!showPw}
                keyboardType="ascii-capable"
                returnKeyType="done"
                onSubmitEditing={handleLogin}
                editable={!loading}
              />
              <Pressable onPress={() => setShowPw(v => !v)} hitSlop={8}>
                <LucideIcon name={showPw ? "eye-off" : "eye"} size={16} color="#94A3B8" />
              </Pressable>
            </View>
          </View>

          {/* 오류 메시지 */}
          {!!error && (
            <View style={s.errBox}>
              <CircleAlert size={14} color="#EF4444" />
              <Text style={s.errText}>{error}</Text>
            </View>
          )}

          {/* 로그인 버튼 */}
          <Pressable
            style={({ pressed }) => [s.loginBtn, { opacity: pressed || loading ? 0.85 : 1 }]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.loginBtnText}>로그인</Text>
            }
          </Pressable>

          {/* 비밀번호 찾기 */}
          <Pressable
            style={s.forgotRow}
            onPress={() => router.push({ pathname: "/forgot-password", params: { identifier } } as any)}
          >
            <Key size={12} color="#94A3B8" />
            <Text style={s.forgotText}>비밀번호를 잊으셨나요?</Text>
          </Pressable>
        </View>

        {/* ── 소셜 / 가입 버튼 ── */}
        <View style={s.signupCol}>
          {/* Sign in with Apple (iOS 전용 공식 버튼) */}
          {Platform.OS === "ios" && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={14}
              style={s.appleBtn}
              onPress={handleAppleLogin}
            />
          )}

          <View style={s.signupRow}>
            {/* 카카오 가입 */}
            <Pressable
              style={({ pressed }) => [s.socialBtn, s.kakaoBtn, { opacity: pressed || kakaoLoading ? 0.85 : 1 }]}
              onPress={handleKakaoLogin}
              disabled={kakaoLoading || loading}
            >
              {kakaoLoading
                ? <ActivityIndicator color="#3C1E1E" size="small" />
                : (
                  <>
                    <KakaoIcon size={22} />
                    <Text style={s.kakaoBtnText}>카카오 가입</Text>
                  </>
                )
              }
            </Pressable>

            {/* 일반 가입 */}
            <Pressable
              style={({ pressed }) => [s.socialBtn, s.regularBtn, { opacity: pressed ? 0.85 : 1 }]}
              onPress={() => router.push("/signup" as any)}
              disabled={loading}
            >
              <LucideIcon name="user-plus" size={18} color="#475569" />
              <Text style={s.regularBtnText}>일반 가입</Text>
            </Pressable>
          </View>
        </View>

        {/* ── 학부모 로그인 링크 ── */}
        <Pressable
          style={({ pressed }) => [s.parentLoginRow, { opacity: pressed ? 0.6 : 1 }]}
          onPress={() => router.push("/parent-login" as any)}
        >
          <Text style={s.parentLoginText}>학부모이신가요? </Text>
          <Text style={s.parentLoginLink}>학부모 로그인</Text>
        </Pressable>

        </View>{/* ── 하단 그룹 끝 ── */}
      </ScrollView>

      {/* ── 계정 없음 모달 ── */}
      <Modal
        transparent
        visible={showNotFoundModal}
        animationType="fade"
        onRequestClose={() => setShowNotFoundModal(false)}
      >
        <Pressable style={s.overlay} onPress={() => setShowNotFoundModal(false)}>
          <Pressable style={s.modalCard} onPress={e => e.stopPropagation()}>
            <View style={s.modalIconWrap}>
              <UserX size={26} color="#D97706" />
            </View>
            <Text style={s.modalTitle}>가입된 계정이 없습니다</Text>
            <Text style={s.modalDesc}>
              입력하신 아이디로 등록된 계정이 없습니다.{"\n"}
              아이디를 다시 확인하거나, 새로 가입해주세요.
            </Text>
            <View style={s.modalBtns}>
              <Pressable
                style={[s.modalBtn, s.modalBtnOutline]}
                onPress={() => setShowNotFoundModal(false)}
              >
                <Text style={s.modalBtnOutlineText}>다시 입력</Text>
              </Pressable>
              <Pressable
                style={[s.modalBtn, { backgroundColor: BRAND }]}
                onPress={() => { setShowNotFoundModal(false); router.push("/signup" as any); }}
              >
                <Text style={s.modalBtnText}>회원가입</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── 키보드 위 입력 미리보기 말풍선 ── */}
      {focusedField !== null && keyboardHeight > 0 && (
        <View style={[s.inputBubble, { bottom: keyboardHeight + 10 }]}>
          <Text style={s.inputBubbleLabel}>
            {focusedField === "id" ? "아이디" : "비밀번호"}
          </Text>
          <Text style={s.inputBubbleValue} numberOfLines={1}>
            {focusedField === "id"
              ? (identifier || "입력 중…")
              : (password ? "•".repeat(password.length) : "입력 중…")}
          </Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1 },
  scroll:  { flexGrow: 1, paddingHorizontal: 24, justifyContent: "flex-end" },

  /* 로고 */
  logoArea:  { alignItems: "center", marginBottom: 32 + Dimensions.get("window").height * 0.07 },
  logoWrap:  { alignItems: "center", marginBottom: 10 },
  logoBorder: {
    borderRadius: 21, borderWidth: 2, borderColor: "#04111f",
    shadowColor: "#000", shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18, shadowRadius: 14, elevation: 8,
  },
  logoImage: { width: 80, height: 92, borderRadius: 19, overflow: "hidden", backgroundColor: "#0a2540" },
  wordmark:  { fontSize: 32, fontWeight: "700", color: "#0a0909", letterSpacing: 0.5, marginBottom: 6 },
  tagline:   { fontSize: 16, color: "#334155", fontFamily: "Pretendard-Regular", textAlign: "center" },
  taglineSub:{ fontSize: 13, color: "#242222", fontFamily: "Pretendard-Regular", textAlign: "center", marginTop: 4 },

  /* 폼 */
  form:      { gap: 14, marginBottom: 20 },
  fieldWrap: { gap: 6 },
  fieldLabel:{ fontSize: 13, fontFamily: "Pretendard-Regular", color: "#475569" },
  inputRow:  {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1.5, borderRadius: 12,
    paddingHorizontal: 14, height: 52, backgroundColor: "#F8FAFC",
  },
  input:     { flex: 1, fontSize: 15, fontFamily: "Pretendard-Regular", color: "#0F172A" },

  errBox:    { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, backgroundColor: "#FEF2F2" },
  errText:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#EF4444", flex: 1 },

  loginBtn:  {
    height: 54, borderRadius: 14, backgroundColor: "#a1f7da",
    alignItems: "center", justifyContent: "center",
    shadowColor: "#a1f7da", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 10, elevation: 5,
    marginTop: 4,
  },
  loginBtnText: { color: "#0a2540", fontSize: 16, fontFamily: "Pretendard-Regular" },

  forgotRow: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-end", paddingVertical: 2 },
  forgotText:{ fontSize: 12, fontFamily: "Pretendard-Regular", color: "#94A3B8" },

  bottomSection: { gap: 0 },

  /* or 구분선 */
  divider:   { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  dividerLine: { flex: 1, height: 1, backgroundColor: "#E2E8F0" },
  dividerLabel:{ fontSize: 12, fontFamily: "Pretendard-Regular", color: "#94A3B8" },

  /* 가입 버튼 영역 */
  signupCol: { gap: 10 },
  appleBtn:  { width: "100%", height: 52 },
  signupRow: { flexDirection: "row", gap: 12 },
  socialBtn: {
    flex: 1, height: 52, borderRadius: 14,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },
  kakaoBtn:  {
    backgroundColor: KAKAO,
    shadowColor: KAKAO, shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25, shadowRadius: 6, elevation: 3,
  },
  kakaoBtnText: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#3C1E1E" },
  regularBtn:   { backgroundColor: "#97cdf7", borderWidth: 1.5, borderColor: "#97cdf7" },
  regularBtnText:{ fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0a2540" },

  /* 키보드 위 입력 미리보기 */
  inputBubble: {
    position: "absolute", left: 24, right: 24,
    backgroundColor: "rgba(10,37,64,0.92)",
    borderRadius: 14, paddingHorizontal: 18, paddingVertical: 12,
    flexDirection: "row", alignItems: "center", gap: 10,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 12, elevation: 8,
  },
  inputBubbleLabel: {
    fontSize: 11, fontFamily: "Pretendard-Regular",
    color: "#a1f7da", minWidth: 44,
  },
  inputBubbleValue: {
    fontSize: 16, fontFamily: "Pretendard-Regular",
    color: "#fff", flex: 1,
  },

  /* 학부모 로그인 */
  parentLoginRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 12 },
  parentLoginText: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#94A3B8" },
  parentLoginLink: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#F97316", textDecorationLine: "underline" },

  /* 모달 */
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  modalCard: {
    width: 300, borderRadius: 22, padding: 24, alignItems: "center", gap: 12,
    backgroundColor: "#fff",
    shadowColor: "#000", shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15, shadowRadius: 24, elevation: 10,
  },
  modalIconWrap: { width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#FFF1BF", marginBottom: 4 },
  modalTitle:    { fontSize: 17, fontFamily: "Pretendard-Regular", color: "#0F172A", textAlign: "center" },
  modalDesc:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B", textAlign: "center", lineHeight: 20 },
  modalBtns:     { flexDirection: "row", gap: 10, marginTop: 6, width: "100%" },
  modalBtn:      { flex: 1, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  modalBtnOutline: { borderWidth: 1.5, borderColor: "#E2E8F0" },
  modalBtnOutlineText: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#64748B" },
  modalBtnText:  { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
});
