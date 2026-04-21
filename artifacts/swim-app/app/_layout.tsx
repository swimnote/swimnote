import { useFonts } from "expo-font";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import Constants from "expo-constants";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { NoticePopup } from "@/components/common/NoticePopup";
import { AuthProvider, useAuth, apiRequest } from "@/context/AuthContext";
import { BrandProvider, useBrand, DEFAULT_THEME_COLOR } from "@/context/BrandContext";
import { initializeRevenueCat, loginRevenueCat, logoutRevenueCat, SubscriptionProvider } from "@/lib/revenuecat";
import { DebugLogProvider, useDebugLog } from "@/context/DebugLogContext";
import { DebugLogOverlay } from "@/components/debug/DebugLogOverlay";

// Expo Go 환경 여부 — Expo Go SDK 53부터 Android 원격 알림 미지원
const IS_EXPO_GO = Constants.appOwnership === "expo";

// expo-notifications: 정적 import 시 Expo Go Android에서 에러 오버레이 발생
// → Expo Go가 아닐 때만 동적 require로 로드
type NotificationsModule = typeof import("expo-notifications");
const Notifications: NotificationsModule | null = IS_EXPO_GO
  ? null
  : (() => { try { return require("expo-notifications") as NotificationsModule; } catch { return null; } })();

try {
  initializeRevenueCat();
} catch (err: any) {
  console.warn("[RevenueCat] 초기화 실패:", err?.message ?? "Unknown error");
}

// ── 빌드 식별 로그 ──────────────────────────────────────
const BUILD_TAG = "SwimNote-20260407-pools-summary-v3";
console.log(`[BUILD_TAG] ${BUILD_TAG}`);
console.log(`[BUILD_TAG] API_BASE=${process.env.EXPO_PUBLIC_API_URL || "https://" + (process.env.EXPO_PUBLIC_DOMAIN || "unknown") + "/api"}`);

// ── 파일 진입 로그 ──────────────────────────────────────
console.log("[LAYOUT] FILE_ENTRY");

// ── 전역 에러 핸들러 (Android fatal crash 캡처) ──────────
declare const ErrorUtils: any;
try {
  if (typeof ErrorUtils !== "undefined" && ErrorUtils.setGlobalHandler) {
    const _prevErrHandler = ErrorUtils.getGlobalHandler();
    ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
      console.error(`[GLOBAL_ERROR] isFatal=${isFatal} msg=${error?.message ?? "(no msg)"}`);
      console.error(`[GLOBAL_ERROR_STACK] ${(error?.stack ?? "").substring(0, 800)}`);
      if (typeof _prevErrHandler === "function") _prevErrHandler(error, isFatal);
    });
    console.log("[LAYOUT] global error handler installed");
  } else {
    console.log("[LAYOUT] ErrorUtils NOT available");
  }
} catch (handlerErr: any) {
  console.warn("[LAYOUT] failed to install global error handler:", handlerErr?.message);
}

function AppLoadingScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: "#FFFFFF", justifyContent: "center", alignItems: "center" }}>
      <ActivityIndicator size="large" color="#2EC4B6" />
    </View>
  );
}

// 화면 하단 중앙 롱프레스(3초) → 디버그 로그 오버레이 열기/닫기
// 각 설정 화면의 "🔍 디버그 로그 보기" 버튼이 주 진입 경로
// 이 컴포넌트는 보조 수단으로, 화면 하단 중앙 투명 영역에서만 동작
function DebugTapTarget() {
  const { toggleOverlay } = useDebugLog();
  return (
    <Pressable
      onLongPress={toggleOverlay}
      delayLongPress={3000}
      style={{
        position: "absolute",
        bottom: 0,
        left: "25%",
        width: "50%",
        height: 36,
        zIndex: 9998,
      }}
    />
  );
}

SplashScreen.preventAutoHideAsync();
const queryClient = new QueryClient();

function BrandSync() {
  const { kind, adminUser, parentAccount, pool } = useAuth();
  const { setBrand, resetBrand } = useBrand();

  useEffect(() => {
    if (!kind) { resetBrand(); return; }
    if (kind === "admin") {
      if (adminUser?.role === "super_admin" || adminUser?.role === "platform_admin" || adminUser?.role === "super_manager") {
        setBrand({ poolName: null, themeColor: DEFAULT_THEME_COLOR, logoUrl: null, logoEmoji: null });
        return;
      }
      if (pool) {
        setBrand({ poolName: pool.name, themeColor: pool.theme_color || DEFAULT_THEME_COLOR, logoUrl: pool.logo_url || null, logoEmoji: pool.logo_emoji || null });
      }
    } else if (kind === "parent" && parentAccount) {
      setBrand({ poolName: parentAccount.pool_name || null, themeColor: DEFAULT_THEME_COLOR, logoUrl: null, logoEmoji: null });
    }
  }, [kind, adminUser?.role, pool?.id, pool?.theme_color, parentAccount?.swimming_pool_id]);

  return null;
}

function RcUserSync() {
  const { kind, adminUser } = useAuth();
  const userId = kind === "admin" ? adminUser?.id : null;
  const prevUserId = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === "web") return;
    if (userId && userId !== prevUserId.current) {
      prevUserId.current = userId;
      loginRevenueCat(userId).catch(() => {});
    } else if (!userId && prevUserId.current) {
      prevUserId.current = null;
      logoutRevenueCat().catch(() => {});
    }
  }, [userId]);

  return null;
}

function PushTokenSync() {
  const { token, kind, parentAccount } = useAuth();
  const registered = useRef(false);

  useEffect(() => {
    // Expo Go SDK 53+: Android 원격 알림 미지원 → 스킵 (Notifications는 null)
    if (!token || registered.current || Platform.OS === "web" || !Notifications) return;
    async function registerToken() {
      try {
        const { status: existing } = await Notifications!.getPermissionsAsync();
        let finalStatus = existing;
        if (existing !== "granted") {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== "granted") return;
        const tokenData = await Notifications.getExpoPushTokenAsync();
        if (!tokenData?.data) return;
        await apiRequest(token, "/push-token", {
          method: "POST",
          body: JSON.stringify({ token: tokenData.data, parent_account_id: kind === "parent" && parentAccount ? parentAccount.id : null }),
        });
        registered.current = true;
      } catch (_) {}
    }
    registerToken();
  }, [token]);

  return null;
}

/**
 * 푸시 탭 딥링크 핸들러
 * 푸시 알림 탭 시 역할에 맞는 공지함 화면으로 이동
 *
 * 라우팅 규칙:
 *  - parent          → /(parent)/notices
 *  - teacher         → /(teacher)/notices
 *  - pool_admin/sub_admin → /(admin)/notices
 *  - super_admin/etc → /(super)/pool-notices (관리 화면)
 *
 * 데이터 페이로드 { noticeId } 가 없는 알림(타입 불일치 등)은 무시.
 */
function PushNavSync() {
  const { kind, adminUser } = useAuth();

  useEffect(() => {
    // Expo Go SDK 53+: Android 원격 알림 미지원 → 리스너 등록 스킵 (Notifications는 null)
    if (!Notifications || Platform.OS === "web") return;

    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as Record<string, unknown> | null;

      // 공지 타입 알림이 아니면 무시
      const category = (data?.category as string | undefined) ?? (data?.type as string | undefined);
      if (category && category !== "notice") return;

      // 역할에 따라 공지함 화면으로 이동
      if (kind === "parent") {
        router.push("/(parent)/notices" as any);
        return;
      }
      if (kind === "admin" && adminUser) {
        const role = adminUser.roles?.[0] ?? adminUser.role;
        if (role === "super_admin" || role === "platform_admin" || role === "super_manager") {
          router.push("/(super)/pool-notices" as any);
        } else if (role === "teacher") {
          router.push("/(teacher)/notices" as any);
        } else {
          // pool_admin, sub_admin
          router.push("/(admin)/notices" as any);
        }
      }
    });
    return () => sub.remove();
  }, [kind, adminUser?.role]);

  return null;
}

/**
 * RootNav — 단일 라우팅 구조
 *
 * 진입점: pendingRoute (SessionContext.finishLogin()이 설정)
 * 로그인 완료 / 앱 복원 모두 동일한 경로로 처리
 * 목적지 계산: SessionContext.computeLoginDest() (API 대기 없음)
 */
function RootNav() {
  const { isLoading, isAuthenticating, kind, pendingRoute, clearPendingRoute } = useAuth();

  // ─── 단일 라우팅 트리거 ─────────────────────────────────────────────────────
  // SessionContext.finishLogin()이 pendingRoute를 설정하면 즉시 navigate
  // 로그인 완료 + 앱 복원 모두 이 하나의 useEffect만 통과
  useEffect(() => {
    if (!pendingRoute) return;
    console.log(`[ROUTE] pendingRoute → ${pendingRoute}`);
    router.replace(pendingRoute as any);
    clearPendingRoute();
  }, [pendingRoute]);

  // 세션 없음 → 로그인 화면
  useEffect(() => {
    if (isLoading || isAuthenticating || pendingRoute) return;
    if (!kind) {
      console.log(`[ROUTE] 세션 없음 → /`);
      router.replace("/");
    }
  }, [isLoading, isAuthenticating, kind, pendingRoute]);
  // ──────────────────────────────────────────────────────────────────────────

  // 초기 로딩 중 또는 라우팅 대기 중 → 로딩 화면
  if (isLoading || !!pendingRoute) return <AppLoadingScreen />;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#ffffff" } }}>
      <Stack.Screen name="index" />
      {/* (auth) 그룹 — 파일시스템으로 자동 등록됨, 개별 화면은 선언 불필요 */}
      <Stack.Screen name="(auth)" />
      {/* 로그인 후 온보딩/전환 화면 */}
      <Stack.Screen name="register" />
      <Stack.Screen name="pool-apply" />
      <Stack.Screen name="pool-select" />
      <Stack.Screen name="pool-join-request" />
      <Stack.Screen name="teacher-invite-join" />
      <Stack.Screen name="signup-role" />
      <Stack.Screen name="teacher-activate" />
      <Stack.Screen name="pending" />
      <Stack.Screen name="rejected" />
      <Stack.Screen name="subscription-expired" />
      {/* 역할별 앱 그룹 */}
      <Stack.Screen name="(admin)" />
      <Stack.Screen name="(super)" />
      <Stack.Screen name="(teacher)" />
      <Stack.Screen name="(parent)" />
      <Stack.Screen name="class-assign" />
      <Stack.Screen name="support-ticket-write" />
      <Stack.Screen name="support-ticket-list" />
      <Stack.Screen name="support-ticket-detail" />
      <Stack.Screen name="terms" />
      <Stack.Screen name="privacy" />
    </Stack>
  );
}

export default function RootLayout() {
  console.log("[LAYOUT] RootLayout RENDER_START");
  const [fontsLoaded, fontError] = useFonts({
    "Pretendard-Regular":  require("../assets/fonts/Pretendard-Regular.otf"),
    "Pretendard-Medium":   require("../assets/fonts/Pretendard-Medium.otf"),
    "Pretendard-SemiBold": require("../assets/fonts/Pretendard-SemiBold.otf"),
    "Pretendard-Bold":     require("../assets/fonts/Pretendard-Bold.otf"),
  });
  console.log(`[FONT] useFonts result: loaded=${fontsLoaded} error=${fontError?.message ?? "none"}`);
  const [fontsReady, setFontsReady] = useState(false);

  useEffect(() => {
    console.log(`[FONT] useEffect fired: loaded=${fontsLoaded} hasError=${!!fontError}`);
    if (fontsLoaded) {
      console.log("[FONT] LOADED_OK → setFontsReady(true) + hideAsync");
      setFontsReady(true);
      SplashScreen.hideAsync();
    } else if (fontError) {
      console.warn("[FONT] LOAD_FAILED → waiting for timeout", fontError?.message);
    }
  }, [fontsLoaded, fontError]);

  // 안전 타임아웃: 5초 후 강제 렌더링
  useEffect(() => {
    console.log("[FONT] timeout useEffect registered");
    const t = setTimeout(() => {
      console.log("[FONT] TIMEOUT_FIRED → forcing fontsReady=true");
      setFontsReady(prev => {
        if (!prev) SplashScreen.hideAsync();
        return true;
      });
    }, 5_000);
    return () => clearTimeout(t);
  }, []);

  if (!fontsReady) {
    console.log("[LAYOUT] fontsReady=false → returning loading view");
    return (
      <View style={{ flex: 1, backgroundColor: "#FFFFFF", justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#2EC4B6" />
      </View>
    );
  }
  console.log("[LAYOUT] fontsReady=true → rendering root tree");

  return (
    <SafeAreaProvider>
      <ErrorBoundary onError={(error, stack) => console.error("[ROOT_ERROR_BOUNDARY]", error?.message, stack)}>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <DebugLogProvider>
              <BrandProvider>
                <AuthProvider>
                  <SubscriptionProvider>
                    <BrandSync />
                    <RcUserSync />
                    <PushTokenSync />
                    <PushNavSync />
                    <NoticePopup />
                    <RootNav />
                    <DebugLogOverlay />
                    <DebugTapTarget />
                  </SubscriptionProvider>
                </AuthProvider>
              </BrandProvider>
            </DebugLogProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
