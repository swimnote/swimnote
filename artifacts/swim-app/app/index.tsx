/**
 * index.tsx — 로그인 첫 화면
 * 상단: 로고 + 브랜드명 + 보조설명
 * 중단: 아이디/비밀번호 입력 + 로그인 버튼 + 비밀번호 찾기
 * 하단: or 구분선 + 카카오 가입 / 일반 가입
 */
console.log("[INDEX_SCREEN] login screen loaded");
import { CircleAlert, Key, Lock, User, UserX } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import Svg, { Ellipse, Path } from "react-native-svg";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Dimensions, Image, Keyboard, Modal,
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useDebugLog } from "@/context/DebugLogContext";
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
  console.log("[LOGIN] RENDER_START");
  const { unifiedLogin, kakaoSocialLogin, appleSocialLogin } = useAuth();
  const { showOverlay } = useDebugLog();
  const insets = useSafeAreaInsets();
  const pwRef  = useRef<TextInput>(null);

  const [identifier, setIdentifier]       = useState("");
  const [password,   setPassword]         = useState("");
  const [showPw,     setShowPw]           = useState(false);
  const [loading,    setLoading]          = useState(false);
  const [kakaoLoading, setKakaoLoading]   = useState(false);
  const [appleLoading, setAppleLoading]   = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(Platform.OS === "ios");
  const [error,      setError]            = useState("");
  const [failCount,  setFailCount]        = useState(0);
  const [showNotFoundModal, setShowNotFoundModal] = useState(false);
  const [keyboardHeight, setKeyboardHeight]       = useState(0);
  const [focusedField, setFocusedField]           = useState<"id" | "pw" | null>(null);

  useEffect(() => {
    console.log("[LOGIN] useEffect:apple-check start platform=" + Platform.OS);
    if (Platform.OS === "ios") {
      AppleAuthentication.isAvailableAsync().then(available => {
        console.log("[LOGIN] apple available=" + available);
        // false가 확실히 확인될 때만 버튼 숨김. true 응답은 현재 상태 유지.
        if (!available) setAppleAvailable(false);
      }).catch((e: any) => {
        // 체크 에러는 버튼 숨김으로 처리하지 않음 — 실기기에서는 정상 동작하므로 유지
        console.log("[LOGIN] apple check error (버튼 유지)=" + e?.message);
      });
    }
  }, []);

  useEffect(() => {
    console.log("[LOGIN] useEffect:keyboard registered");
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
        days_until_deletion?: number; deletion_scheduled_at?: string; deactivated_at?: string;
      };
      if (e.totp_required && e.totp_session) {
        router.push({ pathname: "/otp-verify", params: { session: e.totp_session } } as any); return;
      }
      if (e.error_code === "pool_deactivated") {
        router.push({
          pathname: "/(auth)/pool-deactivated",
          params: {
            days_until_deletion:   String(e.days_until_deletion ?? 0),
            deletion_scheduled_at: e.deletion_scheduled_at ?? "",
            pool_name:             "",
            is_teacher:            "false",
          },
        } as any);
        return;
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
    if (appleLoading) return;
    const tid = "AL-" + Date.now().toString(36).toUpperCase();
    console.log(`[AppleLogin][STEP1] 버튼 탭 traceId=${tid}`);
    setAppleLoading(true);
    setError("");
    try {
      console.log(`[AppleLogin][STEP2 START] traceId=${tid} signInAsync 호출`);
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      console.log(`[AppleLogin][STEP2 OK] traceId=${tid} user=${credential.user?.substring(0,8)}*** hasToken=${!!credential.identityToken} hasFullName=${!!credential.fullName}`);
      if (!credential.identityToken) {
        console.log(`[AppleLogin][STEP2 FAIL] traceId=${tid} identityToken 없음`);
        setError("Apple 인증 토큰을 받지 못했습니다. 다시 시도해주세요.");
        return;
      }
      const fullName = credential.fullName
        ? [credential.fullName.familyName, credential.fullName.givenName].filter(Boolean).join("")
        : null;
      console.log(`[AppleLogin][STEP3 START] traceId=${tid} appleSocialLogin 호출 fullName=${fullName ?? "없음"}`);
      const loginKind = await appleSocialLogin(credential.identityToken, fullName, tid);
      console.log(`[AppleLogin][STEP5 OK] traceId=${tid} appleSocialLogin 정상 완료 kind=${loginKind} → 라우팅 대기`);
      // [4] 2초 후 fallback 체크 로그
      setTimeout(() => {
        console.log(`[LOGIN FALLBACK] traceId=${tid} 2s 경과 — kind=${loginKind} RootNav가 라우팅했는지 확인`);
      }, 2000);
      // [5] RootNav 미작동 대비: 로그인 완료 직후 직접 navigate (kind 기반)
      // 이 navigate가 성공하면 → RootNav 문제가 아님. 실패하면 → login 처리 자체 문제.
      if (loginKind === "admin") {
        console.log(`[LOGIN FALLBACK] traceId=${tid} 직접 navigate → /(admin)/dashboard`);
        router.replace("/(admin)/dashboard" as any);
      } else {
        console.log(`[LOGIN FALLBACK] traceId=${tid} 직접 navigate → /(parent)/home`);
        router.replace("/(parent)/home" as any);
      }
    } catch (e: any) {
      const code = e?.code ?? "";
      const errCode = e?.error_code ?? "";
      console.log(`[AppleLogin][CATCH] traceId=${tid} code=${code} errCode=${errCode} msg=${e?.message}`);
      if (code === "ERR_REQUEST_CANCELED" || code === "ERR_CANCELED") {
        console.log(`[AppleLogin][STEP2 CANCEL] traceId=${tid} 사용자 취소`);
        return;
      }
      if (errCode === "apple_no_account") {
        console.log(`[AppleLogin][STEP4 NO_ACCOUNT] traceId=${tid} 계정 없음 → 가입 화면`);
        router.push({
          pathname: "/(auth)/signup",
          params: {
            appleId:    e.apple_info?.apple_id ?? "",
            appleEmail: e.apple_info?.email    ?? "",
            appleName:  e.apple_info?.name     ?? "",
          },
        } as any);
        return;
      }
      setError(e?.message || "Apple 로그인에 실패했습니다. 카카오 또는 일반 로그인을 이용해주세요.");
    } finally {
      console.log(`[AppleLogin][FINALLY] traceId=${tid} appleLoading=false`);
      setAppleLoading(false);
    }
  }

  async function handleKakaoLogin() {
    if (Platform.OS === "web") { setError("카카오 로그인은 앱에서만 가능합니다."); return; }
    if (typeof kakaoLogin !== "function") {
      setError("카카오 로그인은 정식 앱 빌드에서만 사용 가능합니다.");
      return;
    }
    setKakaoLoading(true); setError("");
    const ktid = "KL-" + Date.now().toString(36).toUpperCase();
    try {
      console.log(`[KakaoLogin][INDEX STEP1] traceId=${ktid} kakaoLogin 호출`);
      const result = await kakaoLogin();
      console.log(`[KakaoLogin][INDEX STEP2] traceId=${ktid} accessToken 수신 → kakaoSocialLogin 호출`);
      const loginKind = await kakaoSocialLogin(result.accessToken);
      console.log(`[KakaoLogin][INDEX STEP3] traceId=${ktid} kakaoSocialLogin 완료 kind=${loginKind}`);
      // [4] 2초 후 fallback 체크 로그
      setTimeout(() => {
        console.log(`[LOGIN FALLBACK] traceId=${ktid} 2s 경과 — kind=${loginKind} RootNav가 라우팅했는지 확인`);
      }, 2000);
      // [5] RootNav 미작동 대비: 직접 navigate
      if (loginKind === "admin") {
        console.log(`[LOGIN FALLBACK] traceId=${ktid} 직접 navigate → /(admin)/dashboard`);
        router.replace("/(admin)/dashboard" as any);
      } else {
        console.log(`[LOGIN FALLBACK] traceId=${ktid} 직접 navigate → /(parent)/home`);
        router.replace("/(parent)/home" as any);
      }
    } catch (err: unknown) {
      const e = err as Error & { error_code?: string; kakao_info?: any; needs_activation?: boolean; teacher_id?: string };
      if (e.error_code === "kakao_no_account" && e.kakao_info) {
        router.push({
          pathname: "/(auth)/signup",
          params: {
            kakaoId:    e.kakao_info.kakao_id ?? "",
            kakaoPhone: e.kakao_info.phone    ?? "",
            kakaoName:  e.kakao_info.name     ?? "",
          },
        } as any); return;
      }
      if (e.needs_activation && e.teacher_id) {
        router.push({ pathname: "/teacher-activate", params: { teacher_id: e.teacher_id } } as any); return;
      }
      if ((err as any)?.code === "E_CANCELLED_OPERATION" || (e as any)?.message?.includes("cancel")) return;
      setError(e.message || "카카오 로그인에 실패했습니다.");
    } finally { setKakaoLoading(false); }
  }

  const isTablet = Dimensions.get("window").width >= 768;

  console.log("[LOGIN] RETURN_JSX");
  return (
    <View style={[s.root, { backgroundColor: "#fff" }]}>
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingTop: insets.top + (isTablet ? 60 : 24), paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── 전체 콘텐츠 (로고 + 폼 + 가입 버튼) ── */}
        <View style={[s.bottomSection, isTablet && s.bottomSectionTablet]}>
        {/* ── 로고 ── */}
        {(() => { console.log("[LOGIN] JSX:logo"); return null; })()}
        <Image
          source={require("../assets/images/swimnote-logo.png")}
          style={[s.logoImg, isTablet && s.logoImgTablet]}
          resizeMode="contain"
        />
        {/* ── 로그인 폼 ── */}
        {(() => { console.log("[LOGIN] JSX:form"); return null; })()}
        <View style={s.form}>
          {/* 아이디 */}
          {(() => { console.log("[LOGIN] JSX:id-field"); return null; })()}
          <View style={s.fieldWrap}>
            <Text style={s.fieldLabel}>아이디</Text>
            <View style={[s.inputRow, { borderColor: identifier ? BRAND : "#E2E8F0" }]}>
              <User size={16} color={identifier ? BRAND : "#94A3B8"} />
              {(() => { console.log("[LOGIN] JSX:id-textinput"); return null; })()}
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
          {(() => { console.log("[LOGIN] JSX:pw-field"); return null; })()}
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
          {(() => { console.log("[LOGIN] JSX:login-btn"); return null; })()}
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
        {(() => { console.log("[LOGIN] JSX:social-section"); return null; })()}
        <View style={s.signupCol}>
          {/* Sign in with Apple (iOS/iPadOS — isAvailableAsync 체크) */}
          {appleAvailable && (
            <View style={{ position: "relative" }}>
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={14}
                style={[s.appleBtn, appleLoading && { opacity: 0.4 }]}
                onPress={handleAppleLogin}
              />
              {appleLoading && (
                <View style={s.appleLoadingOverlay} pointerEvents="none">
                  <ActivityIndicator color="#fff" size="small" />
                  <Text style={s.appleLoadingText}>Apple 로그인 중…</Text>
                </View>
              )}
            </View>
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
              onPress={() => router.push("/(auth)/signup" as any)}
              disabled={loading}
            >
              <LucideIcon name="user-plus" size={18} color="#475569" />
              <Text style={s.regularBtnText}>일반 가입</Text>
            </Pressable>
          </View>
        </View>

        {/* 디버그 롱프레스 영역 — 3초 길게 누르면 로그 오버레이 열림 */}
        <Pressable
          onLongPress={showOverlay}
          delayLongPress={3000}
          style={{ alignItems: "center", paddingVertical: 14 }}
        >
          <Text style={{ fontSize: 10, color: "#CBD5E1", fontFamily: "Pretendard-Regular" }}>
            SwimNote
          </Text>
        </Pressable>

        </View>{/* ── 하단 그룹 끝 ── */}
      </ScrollView>

      {/* ── 계정 없음 모달 ── */}
      {(() => { console.log("[LOGIN] JSX:modal"); return null; })()}
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
                onPress={() => { setShowNotFoundModal(false); router.push("/(auth)/signup" as any); }}
              >
                <Text style={s.modalBtnText}>회원가입</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── 키보드 위 입력 미리보기 말풍선 ── */}
      {(() => { console.log("[LOGIN] JSX:keyboard-bubble-check focused=" + focusedField + " kbH=" + keyboardHeight); return null; })()}
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

const SCREEN_W = Dimensions.get("window").width;

const s = StyleSheet.create({
  root:    { flex: 1 },
  scroll:  { flexGrow: 1, paddingHorizontal: 24, justifyContent: "flex-end" },

  /* iPad: 가운데 정렬 + 최대 폭 제한 */
  bottomSection: { gap: 0 },
  bottomSectionTablet: { maxWidth: 480, width: "100%", alignSelf: "center" },
  logoImg: { width: 234, height: 215, alignSelf: "center", marginBottom: 12, marginTop: 8 },
  logoImgTablet: { width: 320, height: 265 },

  /* 로고 */
  logoArea:  { alignItems: "center", marginBottom: Math.min(48, SCREEN_W * 0.07) },
  logoWrap:  { alignItems: "center", marginBottom: 10 },
  logoBorder: {
    borderRadius: 21, borderWidth: 2, borderColor: "#04111f",
    shadowColor: "#000", shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18, shadowRadius: 14, elevation: 8,
  },
  logoImage: { width: 80, height: 80, borderRadius: 19, overflow: "hidden", backgroundColor: "#0a2540" },
  wordmark:  { fontSize: 32, fontWeight: "700", color: "#0a0909", marginBottom: 6 },
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

  /* or 구분선 */
  divider:   { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  dividerLine: { flex: 1, height: 1, backgroundColor: "#E2E8F0" },
  dividerLabel:{ fontSize: 12, fontFamily: "Pretendard-Regular", color: "#94A3B8" },

  /* 가입 버튼 영역 */
  signupCol: { gap: 10 },
  appleBtn:  { width: "100%", height: 52 },
  appleLoadingOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 14, backgroundColor: "rgba(0,0,0,0.55)",
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },
  appleLoadingText: { color: "#fff", fontSize: 12, fontFamily: "Pretendard-Regular" },
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
