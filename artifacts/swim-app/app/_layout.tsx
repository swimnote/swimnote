import { useFonts } from "expo-font";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, router, usePathname } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SplashScreen from "expo-splash-screen";
import * as Updates from "expo-updates";
import Constants from "expo-constants";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, AppState, AppStateStatus, Linking, Modal, Platform, Pressable, Text, View } from "react-native";
// Modal, Pressable kept for other uses in this file
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X } from "lucide-react-native";
import { UploadQueueProvider, useUploadQueue } from "@/context/UploadQueueContext";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { NoticePopup } from "@/components/common/NoticePopup";
import { AuthProvider, useAuth, apiRequest } from "@/context/AuthContext";
import { BrandProvider, useBrand, DEFAULT_THEME_COLOR } from "@/context/BrandContext";
import { initializeRevenueCat, loginRevenueCat, logoutRevenueCat, SubscriptionProvider } from "@/lib/revenuecat";

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

// ── 전역 에러 핸들러 (Android fatal crash 캡처 + 서버 전송) ──────────
declare const ErrorUtils: any;
const _CRASH_API = process.env.EXPO_PUBLIC_API_URL
  ? `${process.env.EXPO_PUBLIC_API_URL}/crash-report`
  : null;

function sendCrashReport(error: any, isFatal: boolean, source: string) {
  if (!_CRASH_API) return;
  try {
    fetch(_CRASH_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        isFatal,
        message: error?.message ?? "(no msg)",
        stack: (error?.stack ?? "").substring(0, 3000),
        platform: Platform.OS,
        version: Constants.expoConfig?.version ?? "unknown",
        versionCode: (Constants.expoConfig as any)?.android?.versionCode ?? null,
        buildNumber: (Constants.expoConfig as any)?.ios?.buildNumber ?? null,
        source,
      }),
    }).catch(() => {});
  } catch (_) {}
}

try {
  if (typeof ErrorUtils !== "undefined" && ErrorUtils.setGlobalHandler) {
    const _prevErrHandler = ErrorUtils.getGlobalHandler();
    ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
      const fatal = !!isFatal;
      console.error(`[GLOBAL_ERROR] isFatal=${fatal} msg=${error?.message ?? "(no msg)"}`);
      console.error(`[GLOBAL_ERROR_STACK] ${(error?.stack ?? "").substring(0, 800)}`);
      sendCrashReport(error, fatal, "global_error_handler");
      if (typeof _prevErrHandler === "function") _prevErrHandler(error, isFatal);
    });
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


function OtaUpdateBanner(_props: { ready?: boolean }) {
  return null;
}

function UploadProgressModal() {
  const { total, done, failed, isActive, dismiss } = useUploadQueue();
  const insets = useSafeAreaInsets();
  const [visible, setVisible]   = useState(false);
  const slideAnim  = useRef(new Animated.Value(200)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  // 업로드 시작 시 슬라이드 업
  useEffect(() => {
    if (total > 0) {
      setVisible(true);
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 65, friction: 11 }).start();
    }
  }, [total]);

  // 진행률 애니메이션
  useEffect(() => {
    const percent = total > 0 ? (done + failed) / total : 0;
    Animated.timing(progressAnim, { toValue: percent, duration: 300, useNativeDriver: false }).start();
  }, [done, failed, total]);

  // 완료 시 4초 후 자동 닫힘
  useEffect(() => {
    if (!isActive && total > 0 && done + failed >= total) {
      const t = setTimeout(() => {
        Animated.timing(slideAnim, { toValue: 260, duration: 350, useNativeDriver: true }).start(() => {
          setVisible(false);
          dismiss();
        });
      }, 3500);
      return () => clearTimeout(t);
    }
  }, [isActive, done, failed, total]);

  function handleDismiss() {
    Animated.timing(slideAnim, { toValue: 260, duration: 300, useNativeDriver: true }).start(() => {
      setVisible(false);
      dismiss();
    });
  }

  if (!visible || total === 0) return null;

  const isComplete = !isActive && done + failed >= total;
  const hasFailed  = failed > 0;
  const percent    = total > 0 ? Math.round((done + failed) / total * 100) : 0;
  const accentColor = isComplete ? (hasFailed ? "#F59E0B" : "#10B981") : "#2EC4B6";

  return (
    <Animated.View style={{
      position: "absolute",
      bottom: insets.bottom + 66,
      left: 16, right: 16,
      transform: [{ translateY: slideAnim }],
      zIndex: 9999,
    }}>
      <View style={{
        backgroundColor: "#fff",
        borderRadius: 20,
        padding: 18,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.13,
        shadowRadius: 20,
        elevation: 14,
        borderWidth: 1,
        borderColor: "#F0F0F0",
      }}>
        {/* 헤더 */}
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 14, gap: 10 }}>
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: accentColor + "1A", alignItems: "center", justifyContent: "center" }}>
            {isComplete
              ? <Text style={{ fontSize: 18 }}>{hasFailed ? "⚠️" : "✅"}</Text>
              : <ActivityIndicator color={accentColor} size="small" />
            }
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#111827" }}>
              {isComplete
                ? (hasFailed ? `업로드 완료 (일부 실패)` : "업로드 완료 🎉")
                : "사진 업로드 중..."}
            </Text>
            <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: "#6B7280", marginTop: 1 }}>
              {isComplete
                ? `${done}장 성공${hasFailed ? ` · ${failed}장 실패` : ""}`
                : `${done + failed}/${total}장 · ${percent}%`}
            </Text>
          </View>
          {isComplete && (
            <Pressable
              onPress={handleDismiss}
              hitSlop={12}
              style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" }}
            >
              <X size={14} color="#9CA3AF" />
            </Pressable>
          )}
        </View>

        {/* 진행률 바 */}
        <View style={{ height: 6, backgroundColor: "#F3F4F6", borderRadius: 3, overflow: "hidden" }}>
          <Animated.View style={{
            height: 6,
            borderRadius: 3,
            backgroundColor: accentColor,
            width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
          }} />
        </View>

        {/* 하단 힌트 */}
        {!isComplete && (
          <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: "#9CA3AF", marginTop: 8, textAlign: "center" }}>
            화면을 이동해도 계속 업로드됩니다
          </Text>
        )}
      </View>
    </Animated.View>
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
        const N = Notifications!;
        const { status: existing } = await N.getPermissionsAsync();
        let finalStatus = existing;
        if (existing !== "granted") {
          const { status } = await N.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== "granted") return;
        const tokenData = await N.getExpoPushTokenAsync();
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

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10분

function getRoleHome(kind: string | null, role?: string): string {
  if (kind === "parent") return "/(parent)/home";
  if (kind === "admin") {
    if (role === "super_admin" || role === "platform_admin" || role === "super_manager") return "/(super)/dashboard";
    if (role === "teacher") return "/(teacher)/today-schedule";
    return "/(admin)/dashboard";
  }
  return "/";
}

function RootNav() {
  const { isLoading, isAuthenticating, kind, pendingRoute, clearPendingRoute, refreshSession, adminUser } = useAuth();
  const pathname = usePathname();

  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const isCheckingRef = useRef(false);
  const pathnameRef = useRef(pathname);
  const backgroundAtRef = useRef<number | null>(null);
  const didGoBackgroundRef = useRef(false);
  const otaReadyRef = useRef(false);

  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);

  async function checkAndDownloadOta() {
    if (__DEV__ || isCheckingRef.current) return;
    isCheckingRef.current = true;
    try {
      const { isAvailable } = await Updates.checkForUpdateAsync();
      if (isAvailable) {
        // 다운로드만 해두고 즉시 재시작하지 않음 — 백그라운드 복귀 시 적용
        await Updates.fetchUpdateAsync();
        otaReadyRef.current = true;
      }
    } catch (_) {
    } finally {
      isCheckingRef.current = false;
    }
  }

  // 앱 시작 시 OTA 체크 (다운로드만, 재시작은 백그라운드 복귀 시)
  useEffect(() => { checkAndDownloadOta(); }, []);

  // 백그라운드 복귀 처리
  // - OTA 준비됨: 재시작
  // - 그 외: 현재 화면 유지 + 세션 갱신만 (홈 이동 없음)
  // * inactive만 거친 경우(제어센터·알림 배너 등)는 무시
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;

      if (nextState === "background") {
        didGoBackgroundRef.current = true;
      }

      // active 복귀 시 — background를 실제로 거친 경우만 처리
      if ((prev === "background" || prev === "inactive") && nextState === "active") {
        if (!didGoBackgroundRef.current) return;
        didGoBackgroundRef.current = false;

        // OTA 다운로드 완료 → 재시작
        if (otaReadyRef.current) {
          Updates.reloadAsync().catch(() => {});
          return;
        }

        // 항상 현재 화면 유지, 세션 갱신만
        refreshSession?.().catch(() => {});
      }
    });
    return () => sub.remove();
  }, [refreshSession]);

  // 앱 버전 체크 — 강제/소프트 업데이트 유도
  useEffect(() => {
    if (__DEV__) return;
    (async () => {
      try {
        const API_URL = process.env.EXPO_PUBLIC_API_URL;
        if (!API_URL) return;
        const res = await fetch(`${API_URL}/app-version`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const current = Constants.expoConfig?.version ?? "0.0.0";
        const platform = Platform.OS === "ios" ? "ios" : "android";
        const { min_version, latest_version } = data[platform] ?? {};
        const storeUrl = data.store_urls?.[platform];

        function cmp(a: string, b: string): number {
          const pa = a.split(".").map(Number);
          const pb = b.split(".").map(Number);
          for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const d = (pa[i] ?? 0) - (pb[i] ?? 0);
            if (d !== 0) return d;
          }
          return 0;
        }

        if (min_version && cmp(current, min_version) < 0) {
          // 강제 업데이트
          Alert.alert(
            "업데이트 필요",
            "더 나은 서비스를 위해 최신 버전으로 업데이트해주세요.\n업데이트 후 계속 이용할 수 있습니다.",
            [{ text: "업데이트", onPress: () => storeUrl && Linking.openURL(storeUrl) }],
            { cancelable: false }
          );
          return;
        }

        if (latest_version && cmp(current, latest_version) < 0) {
          // 소프트 업데이트
          Alert.alert(
            "새 버전 출시",
            "새로운 버전이 출시되었습니다.\n지금 업데이트하시겠어요?",
            [
              { text: "나중에" },
              { text: "업데이트", onPress: () => storeUrl && Linking.openURL(storeUrl) },
            ]
          );
        }
      } catch (_) {}
    })();
  }, []);

  // kind가 한 번이라도 설정됐는지 추적 — 로그아웃 감지용
  // (한 번도 로그인 안 한 상태에서 kind=null은 정상: login 화면이 초기 라우트)
  const wasLoggedIn = useRef(false);
  useEffect(() => {
    if (kind) wasLoggedIn.current = true;
  }, [kind]);

  // ─── 단일 라우팅 트리거 ─────────────────────────────────────────────────────
  // finishLogin()이 pendingRoute를 설정하면 즉시 navigate
  // 로그인 완료 / 앱 복원 모두 이 경로만 통과
  useEffect(() => {
    if (!pendingRoute || isLoading) return;
    const dest = pendingRoute;
    router.replace(dest as any);
    clearPendingRoute();
  }, [pendingRoute, isLoading]);

  // ─── 로그아웃 감지 → 로그인 화면 ──────────────────────────────────────────
  // 조건: 이전에 로그인된 상태(wasLoggedIn=true)에서 kind가 null로 바뀐 경우만
  // apple_no_account / kakao_no_account 후 kind=null은 wasLoggedIn=false이므로
  // 이 effect가 발동하지 않음 → signup 화면으로 정상 이동 가능
  useEffect(() => {
    if (isLoading || isAuthenticating || pendingRoute) return;
    if (!kind && wasLoggedIn.current) {
      wasLoggedIn.current = false;
      router.replace("/");
    }
  }, [isLoading, isAuthenticating, kind, pendingRoute]);
  // ──────────────────────────────────────────────────────────────────────────

  // 앱 최초 로딩 중(세션 복원 전) → Stack 자체를 렌더하지 않음
  if (isLoading) return <AppLoadingScreen />;

  // pendingRoute 중: Stack은 마운트 유지 + 불투명 오버레이 위에 덮음
  // → router.replace() 가 Stack이 마운트된 상태에서 실행돼야 정상 동작
  // (Stack을 return 으로 교체하면 재마운트 시 초기 경로(/)로 리셋됨)
  return (
    <View style={{ flex: 1 }}>
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
      {/* pendingRoute 중: Stack 위에 로딩 오버레이 — Stack은 언마운트하지 않음
          pointerEvents="auto"(기본값)이므로 아래 Stack 터치 입력 차단 */}
      {!!pendingRoute && (
        <View
          style={{
            position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: "#FFFFFF", justifyContent: "center", alignItems: "center",
            zIndex: 9000,
          }}
          pointerEvents="box-only"
        >
          <ActivityIndicator size="large" color="#2EC4B6" />
        </View>
      )}
      <OtaUpdateBanner />
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    "Pretendard-Regular":  require("../assets/fonts/Pretendard-Regular.otf"),
    "Pretendard-Medium":   require("../assets/fonts/Pretendard-Medium.otf"),
    "Pretendard-SemiBold": require("../assets/fonts/Pretendard-SemiBold.otf"),
    "Pretendard-Bold":     require("../assets/fonts/Pretendard-Bold.otf"),
  });
  const [fontsReady, setFontsReady] = useState(false);

  useEffect(() => {
    if (fontsLoaded) {
      setFontsReady(true);
      SplashScreen.hideAsync();
    } else if (fontError) {
      console.warn("[FONT] LOAD_FAILED → waiting for timeout", fontError?.message);
    }
  }, [fontsLoaded, fontError]);

  // 안전 타임아웃: 5초 후 강제 렌더링
  useEffect(() => {
    const t = setTimeout(() => {
      setFontsReady(prev => {
        if (!prev) SplashScreen.hideAsync();
        return true;
      });
    }, 5_000);
    return () => clearTimeout(t);
  }, []);

  if (!fontsReady) {
    return (
      <View style={{ flex: 1, backgroundColor: "#FFFFFF", justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#2EC4B6" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary onError={(error, stack) => console.error("[ROOT_ERROR_BOUNDARY]", error?.message, stack)}>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
            <BrandProvider>
              <UploadQueueProvider>
                <AuthProvider>
                  <SubscriptionProvider>
                    <BrandSync />
                    <RcUserSync />
                    <PushTokenSync />
                    <PushNavSync />
                    <NoticePopup />
                    <RootNav />
                    <UploadProgressModal />
                  </SubscriptionProvider>
                </AuthProvider>
              </UploadQueueProvider>
            </BrandProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
