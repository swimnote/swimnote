import { useFonts } from "expo-font";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Updates from "expo-updates";
import Constants from "expo-constants";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, AppStateStatus, Linking, Modal, Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X } from "lucide-react-native";
import { UploadQueueProvider, useUploadQueue } from "@/context/UploadQueueContext";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
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

// ─── OTA 강제 업데이트 모달 ─────────────────────────────────────
function ForceUpdateModal({ onUpdate, isApplying }: { onUpdate: () => void; isApplying: boolean }) {
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={{
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.75)",
        justifyContent: "center",
        alignItems: "center",
        padding: 32,
      }}>
        <View style={{
          backgroundColor: "#fff",
          borderRadius: 20,
          padding: 32,
          width: "100%",
          alignItems: "center",
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.25,
          shadowRadius: 20,
          elevation: 20,
        }}>
          <View style={{
            width: 56, height: 56,
            borderRadius: 28,
            backgroundColor: "#E8FBF9",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 20,
          }}>
            <Text style={{ fontSize: 26 }}>🔄</Text>
          </View>
          <Text style={{ fontSize: 20, fontFamily: "Pretendard-Bold", color: "#111", marginBottom: 10, textAlign: "center" }}>
            업데이트 알림
          </Text>
          <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: "#666", textAlign: "center", lineHeight: 22, marginBottom: 28 }}>
            새로운 업데이트가 준비됐습니다.{"\n"}업데이트 후 계속 이용하실 수 있습니다.
          </Text>
          <Pressable
            onPress={onUpdate}
            disabled={isApplying}
            style={{
              backgroundColor: isApplying ? "#A0D4D0" : "#2EC4B6",
              borderRadius: 14,
              paddingVertical: 16,
              paddingHorizontal: 48,
              width: "100%",
              alignItems: "center",
            }}
          >
            {isApplying
              ? <ActivityIndicator color="#fff" />
              : <Text style={{ color: "#fff", fontSize: 16, fontFamily: "Pretendard-SemiBold" }}>지금 업데이트</Text>
            }
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function UploadProgressBanner() {
  const { total, done, failed, isActive, dismiss } = useUploadQueue();
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (total > 0) setVisible(true);
  }, [total]);

  useEffect(() => {
    if (!isActive && total > 0 && done + failed >= total) {
      const t = setTimeout(() => {
        setVisible(false);
        setTimeout(dismiss, 400);
      }, 4000);
      return () => clearTimeout(t);
    }
  }, [isActive, done, failed, total, dismiss]);

  if (!visible || total === 0) return null;

  const isComplete = !isActive && done + failed >= total;
  const percent = total > 0 ? Math.round((done + failed) / total * 100) : 0;

  return (
    <View style={{
      position: "absolute",
      bottom: insets.bottom + 72,
      left: 16, right: 16,
      backgroundColor: isComplete ? "#22C55E" : "#1F8F86",
      borderRadius: 16,
      padding: 14,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 12,
      elevation: 10,
      zIndex: 9999,
    }}>
      {!isComplete && <ActivityIndicator color="#fff" size="small" />}
      <View style={{ flex: 1 }}>
        <Text style={{ color: "#fff", fontSize: 13, fontFamily: "Pretendard-SemiBold" }}>
          {isComplete
            ? `업로드 완료${failed > 0 ? ` (실패 ${failed}장)` : ""}`
            : `사진 업로드 중... ${percent}%`}
        </Text>
        <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 11, fontFamily: "Pretendard-Regular", marginTop: 2 }}>
          {done}/{total}장 완료
        </Text>
        {!isComplete && (
          <View style={{ height: 3, backgroundColor: "rgba(255,255,255,0.3)", borderRadius: 2, marginTop: 6 }}>
            <View style={{ width: `${percent}%` as any, height: 3, backgroundColor: "#fff", borderRadius: 2 }} />
          </View>
        )}
      </View>
      {isComplete && (
        <Pressable onPress={() => { setVisible(false); setTimeout(dismiss, 300); }}>
          <X size={18} color="#fff" />
        </Pressable>
      )}
    </View>
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

function RootNav() {
  const { isLoading, isAuthenticating, kind, pendingRoute, clearPendingRoute } = useAuth();

  // OTA 업데이트 — AppState 기반으로 포그라운드 복귀마다 체크
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isApplyingUpdate, setIsApplyingUpdate] = useState(false);
  const isCheckingRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  async function checkAndFetchUpdate() {
    if (__DEV__ || isCheckingRef.current || showUpdateModal) return;
    isCheckingRef.current = true;
    try {
      const check = await Updates.checkForUpdateAsync();
      console.log("[OTA] 업데이트 체크 결과:", check.isAvailable);
      if (check.isAvailable) {
        setShowUpdateModal(true);
        await Updates.fetchUpdateAsync();
        console.log("[OTA] 다운로드 완료 — 재시작");
        await Updates.reloadAsync();
      }
    } catch (e: any) {
      console.warn("[OTA] 업데이트 체크 실패:", e?.message ?? e);
    } finally {
      isCheckingRef.current = false;
    }
  }

  async function applyUpdate() {
    setIsApplyingUpdate(true);
    try {
      await Updates.reloadAsync();
    } catch (e: any) {
      setIsApplyingUpdate(false);
      Alert.alert("오류", "업데이트 적용 중 오류가 발생했습니다. 앱을 직접 재시작해주세요.");
    }
  }

  // 앱 시작 시 1회 체크
  useEffect(() => {
    checkAndFetchUpdate();
  }, []);

  // 백그라운드 → 포그라운드 복귀 시 체크
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;
      if ((prev === "background" || prev === "inactive") && nextState === "active") {
        checkAndFetchUpdate();
      }
    });
    return () => sub.remove();
  }, []);

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
      {showUpdateModal && (
        <ForceUpdateModal
          onUpdate={applyUpdate}
          isApplying={isApplyingUpdate}
        />
      )}
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
                    <UploadProgressBanner />
                  </SubscriptionProvider>
                </AuthProvider>
              </UploadQueueProvider>
            </BrandProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
