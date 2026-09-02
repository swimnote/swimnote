/**
 * index.tsx — 로그인 첫 화면
 * 상단: 로고 + 브랜드명 + 보조설명
 * 중단: 아이디/비밀번호 입력 + 로그인 버튼 + 비밀번호 찾기
 * 하단: or 구분선 + 카카오 가입 / 일반 가입
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import Svg, { Ellipse, Path } from "react-native-svg";
import React, { useEffect, useRef, useState } from "react";
import {ActivityIndicator, Alert, Dimensions, Image, Keyboard, Modal,
  Platform, Pressable, StyleSheet, Text, TextInput, View} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { consumeLoginDiagnostic } from "@/context/auth/SessionContext";
import { toAsciiOnly } from "@/utils/koreanToQwerty";
import { login as kakaoLogin } from "@react-native-seoul/kakao-login";
import * as AppleAuthentication from "expo-apple-authentication";

const C = Colors.light;
const BRAND   = "#F97316";
const KAKAO   = "#FEE500";
const NAVY    = "#1B3A70";   // 네이비 기본색 (버튼 fill)
const MINT    = C.brandStrong;   // 브랜드 액센트

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

function AppleIcon({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="#fff">
      <Path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
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
  const [appleAvailable, setAppleAvailable] = useState(Platform.OS === "ios");
  const [error,      setError]            = useState("");
  const [failCount,  setFailCount]        = useState(0);
  const [showNotFoundModal, setShowNotFoundModal] = useState(false);
  const [keyboardHeight, setKeyboardHeight]       = useState(0);
  const [focusedField, setFocusedField]           = useState<"id" | "pw" | null>(null);

  useEffect(() => {
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

  function showDiagAlert(d: Record<string, any>): Promise<void> {
    return new Promise(resolve => {
      Alert.alert(
        "🔍 로그인 진단",
        `stage: ${d.stage ?? "—"}\nmethod: ${d.method ?? "—"}\nurl: ${d.url ?? "—"}\nstatus: ${d.status ?? "—"}\ncontentType: ${d.contentType ?? "—"}\nserver: ${d.server ?? "—"}\ncfRay: ${d.cfRay ?? "—"}\nrenderOrigin: ${d.renderOrigin ?? "—"}\n\nrawText:\n${d.rawText ?? "—"}`,
        [{ text: "확인", onPress: () => resolve() }],
      );
    });
  }

  async function handleLogin() {
    const finalId = identifier.trim();
    const finalPw = password;
    if (!finalId || !finalPw) { setError("아이디와 비밀번호를 입력해주세요."); return; }
    setLoading(true); setError("");
    try {
      await unifiedLogin(finalId, finalPw);
      setFailCount(0);
      // 로그인 성공 후 fetchPool/refund-policy 403 진단 (임시)
      const fpDiag = consumeLoginDiagnostic();
      if (fpDiag) await showDiagAlert(fpDiag);
    } catch (err: unknown) {
      const e = err as Error & {
        needs_activation?: boolean; teacher_id?: string;
        error_code?: string; totp_required?: boolean; totp_session?: string;
        days_until_deletion?: number; deletion_scheduled_at?: string; deactivated_at?: string;
        diagnostic?: Record<string, any>;
      };
      // ── 403 진단 Alert (임시 디버그) ─────────────────────────────────────
      if (e.diagnostic) await showDiagAlert(e.diagnostic);
      // ────────────────────────────────────────────────────────────────────
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
      if (e.error_code === "withdrawal_in_progress") {
        const daysLeft = (e as any).days_until_deletion;
        setError(daysLeft != null
          ? `탈퇴 처리 중인 계정입니다. ${daysLeft}일 후 완전히 삭제됩니다.\n재구독하시면 탈퇴 신청이 자동으로 취소됩니다.`
          : "탈퇴 처리 중인 계정입니다.");
        return;
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
      console.log(`[AppleLogin][STEP5 OK] traceId=${tid} appleSocialLogin 정상 완료 kind=${loginKind} → finishLogin이 라우팅 처리`);
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

  async function handleKakaoLogin(overridePoolId?: string) {
    if (Platform.OS === "web") { setError("카카오 로그인은 앱에서만 가능합니다."); return; }
    if (typeof kakaoLogin !== "function") {
      setError("카카오 로그인은 정식 앱 빌드에서만 사용 가능합니다.");
      return;
    }
    // 2.0: 최초 호출 시(overridePoolId 없음) 학부모 전용 안내 표시
    if (!overridePoolId) {
      const confirmed = await new Promise<boolean>(resolve => {
        Alert.alert(
          "카카오 회원가입 안내",
          "카카오 회원가입은 학부모만 가능합니다.\n관리자와 선생님은 앱 내 가입을 이용해 주세요.",
          [
            { text: "확인", onPress: () => resolve(true) },
            { text: "취소", style: "cancel", onPress: () => resolve(false) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) }
        );
      });
      if (!confirmed) return;
    }
    setKakaoLoading(true); setError("");
    const ktid = "KL-" + Date.now().toString(36).toUpperCase();
    // accessToken을 catch 블록에서도 접근 가능하도록 선언 (ambiguous 재시도용)
    let kakaoAccessToken: string | null = null;
    try {
      console.log(`[KakaoLogin][INDEX STEP1] traceId=${ktid} kakaoLogin 호출`);
      const result = await kakaoLogin();
      kakaoAccessToken = result.accessToken;
      if (!kakaoAccessToken) {
        // SDK가 accessToken 없이 resolve하는 경우 (비정상 SDK 응답)
        console.warn(`[KakaoLogin][KAKAO_TOKEN_MISSING] traceId=${ktid} accessToken이 없음`);
        throw Object.assign(new Error("카카오 로그인 토큰을 받지 못했습니다."), { error_code: "KAKAO_TOKEN_MISSING" });
      }
      console.log(`[KakaoLogin][INDEX STEP2] traceId=${ktid} accessToken 수신 → kakaoSocialLogin 호출 overridePoolId=${overridePoolId ?? "none"}`);
      const loginKind = await kakaoSocialLogin(kakaoAccessToken, overridePoolId);
      console.log(`[KakaoLogin][INDEX STEP3] traceId=${ktid} kakaoSocialLogin 완료 kind=${loginKind} → finishLogin이 라우팅 처리`);
    } catch (err: unknown) {
      const e = err as Error & {
        error_code?: string; kakao_info?: any; needs_activation?: boolean; teacher_id?: string;
        pools?: { id: string; name: string }[];
        code?: string;
      };

      // 카카오 앱/웹 취소 — E_CANCELLED_OPERATION이 표준 코드 (iOS/Android 공통)
      // message.includes("cancel")은 제거: 한국어 에러 메시지를 취소로 오인할 수 있음
      if (e.code === "E_CANCELLED_OPERATION") return;

      // SDK 레벨 에러 분류 (accessToken 미수신 시점, 서버 호출 전)
      // kakaoAccessToken이 null이면 SDK 에러, 값이 있으면 서버 에러
      if (!kakaoAccessToken && !e.error_code) {
        const sdkMsg = e.message ?? "";
        const sdkErrCode =
          sdkMsg.toLowerCase().includes("network") || sdkMsg.toLowerCase().includes("timeout")
            ? "KAKAO_NETWORK_ERROR"
            : "KAKAO_SDK_ERROR";
        console.warn(`[KakaoLogin][${sdkErrCode}] traceId=${ktid} code=${e.code ?? "none"}`);
        setError("카카오 로그인에 실패했습니다. 잠시 후 다시 시도해주세요.");
        return;
      }

      if (e.error_code === "kakao_no_account" && e.kakao_info) {
        // 2.0: 역할 선택 화면 skip → 학부모 연결 화면으로 바로 이동 (parentOnly=1)
        router.push({
          pathname: "/(auth)/kakao-link",
          params: {
            kakaoId:           e.kakao_info.kakao_id    ?? "",
            kakaoProfileImage: e.kakao_info.profile_image ?? "",
            kakaoName:         e.kakao_info.name         ?? "",
            parentOnly:        "1",
          },
        } as any);
        return;
      }
      if (e.needs_activation && e.teacher_id) {
        router.push({ pathname: "/teacher-activate", params: { teacher_id: e.teacher_id } } as any); return;
      }

      // 다중 pool 계정 충돌 — 서버가 pools[] 목록 반환 → Alert으로 선택 후 재시도
      // accessToken은 이미 발급된 것을 재사용하므로 카카오 앱 재실행 없음
      if (e.error_code === "KAKAO_PARENT_AMBIGUOUS" && Array.isArray(e.pools) && e.pools.length > 0) {
        console.warn(`[KakaoLogin][AMBIGUOUS] traceId=${ktid} poolCount=${e.pools.length} → Alert 표시`);
        const buttons = e.pools.map((p) => ({
          text: p.name,
          onPress: () => {
            if (kakaoAccessToken) {
              // 선택한 pool_id를 overridePoolId로 전달 → 서버 phone+pool 정확 매칭
              kakaoSocialLogin(kakaoAccessToken, p.id)
                .then(() => {/* finishLogin이 라우팅 처리 */})
                .catch((retryErr: any) => {
                  setError(retryErr?.message || "카카오 로그인에 실패했습니다.");
                });
            }
          },
        }));
        buttons.push({ text: "취소", onPress: () => {} } as any);
        Alert.alert(
          "수영장 선택",
          "동일 전화번호로 여러 수영장에 계정이 있습니다.\n어느 수영장으로 로그인할까요?",
          buttons as any,
          { cancelable: true }
        );
        return;
      }

      // 서버에서 분류된 에러 코드별 사용자 메시지
      const errMsg = (() => {
        switch (e.error_code) {
          case "KAKAO_PARENT_AMBIGUOUS": return "여러 수영장에 계정이 있습니다. 잠시 후 다시 시도해주세요.";
          case "KAKAO_INVALID_TOKEN":    return "카카오 인증이 만료되었습니다. 다시 시도해주세요.";
          case "KAKAO_API_TIMEOUT":      return "카카오 서버가 응답하지 않습니다. 잠시 후 다시 시도해주세요.";
          case "KAKAO_API_ERROR":        return "카카오 서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
          case "KAKAO_PROFILE_FAILED":   return "카카오 프로필 정보를 가져올 수 없습니다. 다시 시도해주세요.";
          case "network_error":          return "서버에 연결할 수 없습니다. 네트워크를 확인해주세요.";
          default:                       return e.message || "카카오 로그인에 실패했습니다.";
        }
      })();
      // Phase 1: raw e.message 노출 금지 — 항상 안전한 사용자 메시지 사용
      const safeErrMsg = errMsg === e.message
        ? "카카오 로그인에 실패했습니다. 잠시 후 다시 시도해주세요."
        : errMsg;
      console.warn(`[KakaoLogin][ERR] traceId=${ktid} error_code=${e.error_code ?? "none"} sanitized_msg=${safeErrMsg}`);
      setError(safeErrMsg);
    } finally { setKakaoLoading(false); }
  }

  const isTablet = Dimensions.get("window").width >= 768;

  return (
    <View style={[s.root, { backgroundColor: "#fff" }]}>
      <KeyboardAwareScrollView
        contentContainerStyle={[s.scroll, { paddingTop: insets.top + (isTablet ? 60 : 24), paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── 전체 콘텐츠 (로고 + 폼 + 가입 버튼) ── */}
        <View style={[s.bottomSection, isTablet && s.bottomSectionTablet]}>
        {/* ── 로고 ── */}
        <Image
          source={require("../assets/images/swimnote-logo.png")}
          style={[s.logoImg, isTablet && s.logoImgTablet]}
          resizeMode="contain"
        />
        {/* ── 로그인 폼 ── */}
        <View style={s.form}>
          {/* 아이디 */}
          <View style={s.fieldWrap}>
            <Text style={s.fieldLabel}>아이디</Text>
            <View style={[s.inputRow, { borderColor: identifier ? MINT : C.border }]}>
              <LucideIcon name="user" size={16} color={identifier ? MINT : C.textMuted} />
              <TextInput
                style={s.input}
                value={identifier}
                onChangeText={v => { setIdentifier(toAsciiOnly(v)); setError(""); setFailCount(0); }}
                onFocus={() => setFocusedField("id")}
                placeholder="아이디를 입력하세요"
                placeholderTextColor="#CBD5E1"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
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
            <View style={[s.inputRow, { borderColor: password ? MINT : C.border }]}>
              <LucideIcon name="lock" size={16} color={password ? MINT : C.textMuted} />
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
                <LucideIcon name={showPw ? "eye-off" : "eye"} size={16} color={C.textMuted} />
              </Pressable>
            </View>
          </View>

          {/* 오류 메시지 */}
          {!!error && (
            <View style={s.errBox}>
              <LucideIcon name="alert-circle" size={14} color="#EF4444" />
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
            <LucideIcon name="key" size={12} color={C.textMuted} />
            <Text style={s.forgotText}>비밀번호를 잊으셨나요?</Text>
          </Pressable>
        </View>

        {/* ── 소셜 / 가입 버튼 ── */}
        <View style={s.signupCol}>
          {/* 일반 가입 — 메인 CTA */}
          <Pressable
            style={({ pressed }) => [s.signupMainBtn, { opacity: pressed || loading ? 0.85 : 1 }]}
            onPress={() => router.push("/(auth)/signup" as any)}
            disabled={loading}
          >
            <LucideIcon name="user-plus" size={18} color="#0a2540" />
            <Text style={s.signupMainBtnText}>회원가입</Text>
          </Pressable>

          {/* 소셜 버튼 — 아이콘 + 텍스트 (Phase 1: "로그인/회원가입" 통합 레이블) */}
          <View style={s.socialBtnCol}>
            {appleAvailable && (
              <Pressable
                style={[s.socialFullBtn, s.appleFullBtn, (appleLoading || loading) && { opacity: 0.5 }]}
                onPress={handleAppleLogin}
                disabled={appleLoading || loading}
              >
                {appleLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <AppleIcon size={18} />
                }
                <Text style={s.appleFullBtnText}>Apple로 로그인/회원가입</Text>
              </Pressable>
            )}
            <Pressable
              style={[s.socialFullBtn, s.kakaoFullBtn, (kakaoLoading || loading) && { opacity: 0.5 }]}
              onPress={handleKakaoLogin}
              disabled={kakaoLoading || loading}
            >
              {kakaoLoading
                ? <ActivityIndicator color="#3C1E1E" size="small" />
                : <KakaoIcon size={20} />
              }
              <Text style={s.kakaoFullBtnText}>카카오로 로그인/회원가입</Text>
            </Pressable>
          </View>
        </View>

        <View style={{ alignItems: "center", paddingVertical: 14 }}>
          <Text style={{ fontSize: 10, color: "#CBD5E1", fontFamily: "Pretendard-Regular" }}>
            SwimNote
          </Text>
        </View>

        </View>{/* ── 하단 그룹 끝 ── */}
      </KeyboardAwareScrollView>

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
              <LucideIcon name="user-x" size={26} color="#D97706" />
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
                style={[s.modalBtn, { backgroundColor: NAVY }]}
                onPress={() => { setShowNotFoundModal(false); router.push("/(auth)/signup" as any); }}
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

const SCREEN_W = Dimensions.get("window").width;

const s = StyleSheet.create({
  root:    { flex: 1 },
  scroll:  { flexGrow: 1, paddingHorizontal: 24, justifyContent: "flex-end" },

  /* 앱 소개 이미지 */
  appImgRow: { flexDirection: "row", justifyContent: "center", alignItems: "flex-end", gap: 8, marginBottom: 16 },
  appImg: { width: SCREEN_W * 0.26, height: SCREEN_W * 0.46, borderRadius: 14, overflow: "hidden" },
  appImgCenter: { width: SCREEN_W * 0.30, height: SCREEN_W * 0.53, marginBottom: -4 },

  /* iPad: 가운데 정렬 + 최대 폭 제한 */
  bottomSection: { gap: 0 },
  bottomSectionTablet: { maxWidth: 480, width: "100%", alignSelf: "center" },
  logoImg: { width: Math.min(SCREEN_W * 0.49, 210), height: Math.min(SCREEN_W * 0.49, 210), alignSelf: "center", marginBottom: 16, marginTop: 0 },
  logoImgTablet: { width: Math.min(SCREEN_W * 0.49, 210), height: Math.min(SCREEN_W * 0.49, 210) },

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
  tagline:   { fontSize: 16, color: C.textStrong, fontFamily: "Pretendard-Regular", textAlign: "center" },
  taglineSub:{ fontSize: 13, color: "#242222", fontFamily: "Pretendard-Regular", textAlign: "center", marginTop: 4 },

  /* 폼 */
  form:      { gap: 14, marginBottom: 20 },
  fieldWrap: { gap: 6 },
  fieldLabel:{ fontSize: 13, fontFamily: "Pretendard-Regular", color: "#475569" },
  inputRow:  {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1.5, borderRadius: 12,
    paddingHorizontal: 14, height: 52, backgroundColor: C.backgroundSoft,
  },
  input:     { flex: 1, fontSize: 15, fontFamily: "Pretendard-Regular", color: C.textPrimary },

  errBox:    { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, backgroundColor: "#FEF2F2" },
  errText:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#EF4444", flex: 1 },

  loginBtn:  {
    height: 54, borderRadius: 14, backgroundColor: NAVY,
    alignItems: "center", justifyContent: "center",
    shadowColor: NAVY, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 10, elevation: 5,
    marginTop: 4,
  },
  loginBtnText: { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" },

  forgotRow: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-end", paddingVertical: 2 },
  forgotText:{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted },

  /* or 구분선 */
  divider:   { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  dividerLine: { flex: 1, height: 1, backgroundColor: C.border },
  dividerLabel:{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted },

  /* 가입 버튼 영역 */
  signupCol: { gap: 14 },

  signupMainBtn: {
    height: 54, borderRadius: 14, backgroundColor: "#fff",
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderWidth: 1.5, borderColor: MINT,
    shadowColor: "rgba(0,0,0,0.08)", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1, shadowRadius: 6, elevation: 2,
  },
  signupMainBtnText: { fontSize: 16, fontFamily: "Pretendard-Regular", color: "#0a2540" },

  /* Phase 1: 소셜 버튼 full-width (아이콘 + 텍스트) */
  socialBtnCol: { gap: 10 },
  socialFullBtn: {
    height: 52, borderRadius: 14,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 6, elevation: 3,
  },
  appleFullBtn:     { backgroundColor: "#000", shadowColor: "#000" },
  appleFullBtnText: { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" },
  kakaoFullBtn:     { backgroundColor: KAKAO, shadowColor: KAKAO },
  kakaoFullBtnText: { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#3C1E1E" },

  /* 하위호환: icon-only 스타일 (더 이상 사용하지 않음, 안전하게 유지) */
  socialIconRow: { flexDirection: "row", justifyContent: "center", gap: 16 },
  socialIconBtn: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  appleIconBtn:  { backgroundColor: "#000" },
  kakaoIconBtn:  { backgroundColor: KAKAO },

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
  modalTitle:    { fontSize: 17, fontFamily: "Pretendard-Regular", color: C.textPrimary, textAlign: "center" },
  modalDesc:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, textAlign: "center", lineHeight: 20 },
  modalBtns:     { flexDirection: "row", gap: 10, marginTop: 6, width: "100%" },
  modalBtn:      { flex: 1, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  modalBtnOutline: { borderWidth: 1.5, borderColor: C.border },
  modalBtnOutlineText: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  modalBtnText:  { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
});
