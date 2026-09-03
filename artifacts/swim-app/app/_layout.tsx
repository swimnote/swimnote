import Colors from "@/constants/colors";
const C = Colors.light;
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
import { LucideIcon } from "@/components/common/LucideIcon";
import { UploadQueueProvider, useUploadQueue } from "@/context/UploadQueueContext";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { NoticePopup } from "@/components/common/NoticePopup";
import MaintenanceScreen from "@/components/MaintenanceScreen";
import { AuthProvider, useAuth, apiRequest } from "@/context/AuthContext";
import { ModeProvider, useMode } from "@/context/ModeContext";
import { BrandProvider, useBrand, DEFAULT_THEME_COLOR } from "@/context/BrandContext";
import { initializeRevenueCat, loginRevenueCat, logoutRevenueCat, SubscriptionProvider } from "@/lib/revenuecat";
import { runLegacyMediaCleanup } from "@/utils/mediaStorageCleanup";
import { runMediaCleanupV2, runMediaCleanupV3 } from "@/utils/mediaCleanupV2";
import { DevOtaRestartModal } from "@/components/common/DevOtaRestartModal";

// 1.6.3+: 명시적으로 "true"일 때만 점검 화면 진입. 기본값 = 정상 진입.
export const MAINTENANCE_MODE = process.env.EXPO_PUBLIC_MAINTENANCE_MODE === "true";

// ── 2.0.0 개발 전용: OTA 다운로드 완료 즉시 재시작 모달 표시 ─────────
// 출시 전 false로 변경하거나 이 파일에서 DevOtaRestartModal 렌더를 제거.
const DEV_OTA_RESTART_MODAL = (Constants.expoConfig?.version ?? "").startsWith("2.0");

// Expo Go 환경 여부 — Expo Go SDK 53부터 Android 원격 알림 미지원
const IS_EXPO_GO = Constants.appOwnership === "expo";

// expo-notifications: 정적 import 시 Expo Go Android에서 에러 오버레이 발생
// → Expo Go가 아닐 때만 동적 require로 로드
type NotificationsModule = typeof import("expo-notifications");
const Notifications: NotificationsModule | null = IS_EXPO_GO
  ? null
  : (() => { try { return require("expo-notifications") as NotificationsModule; } catch { return null; } })();

if (!MAINTENANCE_MODE) {
  try {
    initializeRevenueCat();
  } catch (err: any) {
    console.warn("[RevenueCat] 초기화 실패:", err?.message ?? "Unknown error");
  }
}

// ── 전역 에러 핸들러 (Android fatal crash 캡처 + 서버 전송) ──────────
declare const ErrorUtils: any;
const _CRASH_API = process.env.EXPO_PUBLIC_API_URL
  ? `${process.env.EXPO_PUBLIC_API_URL}/crash-report`
  : null;

// ── Updates 진단 스냅샷 (항목 6-9) ─────────────────────────────────
// expo-updates v29: currentlyRunning 제거됨 — 직접 export된 API 사용
function getUpdatesDiagnostics() {
  try {
    return {
      updateId: Updates.updateId ?? null,
      isEmbeddedLaunch: Updates.isEmbeddedLaunch ?? null,
      isEmergencyLaunch: Updates.isEmergencyLaunch ?? null,
      emergencyLaunchReason: Updates.emergencyLaunchReason ?? null,
      runtimeVersion: Updates.runtimeVersion ?? null,
      channel: Updates.channel ?? null,
    };
  } catch (_) {
    return {
      updateId: null,
      isEmbeddedLaunch: null,
      isEmergencyLaunch: null,
      emergencyLaunchReason: null,
      runtimeVersion: null,
      channel: null,
    };
  }
}

// ── 앱 시작 시 진단 정보 전송 (항목 10) ─────────────────────────────
function sendAppLaunchDiagnostics() {
  if (!_CRASH_API) return;
  try {
    const updates = getUpdatesDiagnostics();
    const diagnostics = {
      timestamp: new Date().toISOString(),
      isFatal: false,
      source: "app_launch",
      message: "APP_LAUNCH_DIAGNOSTICS",
      stack: "",
      platform: Platform.OS,
      version: Constants.expoConfig?.version ?? "unknown",
      buildNumber: (Constants.expoConfig as any)?.ios?.buildNumber ?? null,
      versionCode: (Constants.expoConfig as any)?.android?.versionCode ?? null,
      ...updates,
    };
    console.log("[APP_LAUNCH_DIAGNOSTICS]", JSON.stringify(diagnostics));
    fetch(_CRASH_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(diagnostics),
    }).catch(() => {});
  } catch (_) {}
}

function sendCrashReport(error: any, isFatal: boolean, source: string) {
  if (!_CRASH_API) return;
  try {
    const updates = getUpdatesDiagnostics();
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
        ...updates,
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

// 앱 시작 시 즉시 진단 정보 전송 (isEmergencyLaunch 포함)
// 유지보수 모드에서는 사용자/API 진입보다 먼저 화면을 표시하므로 전송하지 않는다.
if (!MAINTENANCE_MODE) sendAppLaunchDiagnostics();

function AppLoadingScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: "#FFFFFF", justifyContent: "center", alignItems: "center" }}>
      <ActivityIndicator size="large" color={C.brandStrong} />
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
  const accentColor = isComplete ? (hasFailed ? "#F59E0B" : "#10B981") : C.brandStrong;

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
            <Text style={{ fontSize: 14, fontFamily: "Pretendard-SemiBold", color: C.textPrimary }}>
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
              <LucideIcon name="x" size={14} color={C.textMuted} />
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
          <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 8, textAlign: "center" }}>
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

// ── Android 알림 채널 설정 (앱 시작 시 1회 등록) ──────────────────────
async function setupNotificationChannels(N: NotificationsModule) {
  if (Platform.OS !== "android") return;
  try {
    await N.setNotificationChannelAsync("diary", {
      name: "수업 일지",
      description: "선생님이 작성한 수업 일지 알림",
      importance: N.AndroidImportance.HIGH,
      vibrationPattern: [0, 300, 200, 300],
      lightColor: C.brandStrong,
      sound: "default",
      enableLights: true,
      enableVibrate: true,
      showBadge: true,
    });
    await N.setNotificationChannelAsync("class_reminder", {
      name: "수업 알림",
      description: "전날/당일 수업 시작 전 알림",
      importance: N.AndroidImportance.DEFAULT,
      sound: "default",
      enableVibrate: true,
      showBadge: true,
    });
    await N.setNotificationChannelAsync("notice", {
      name: "공지사항",
      description: "수영장 공지 및 안내",
      importance: N.AndroidImportance.DEFAULT,
      sound: "default",
      showBadge: true,
    });
    await N.setNotificationChannelAsync("makeup_schedule", {
      name: "보강 알림",
      description: "보강 수업 배정 및 취소 알림",
      importance: N.AndroidImportance.DEFAULT,
      sound: "default",
      enableVibrate: true,
    });
    await N.setNotificationChannelAsync("photo_upload", {
      name: "사진 업로드",
      description: "새 수업 사진 업로드 알림",
      importance: N.AndroidImportance.LOW,
      showBadge: false,
    });
    await N.setNotificationChannelAsync("messenger", {
      name: "메신저",
      description: "선생님·학교 메시지 알림",
      importance: N.AndroidImportance.HIGH,
      sound: "default",
      enableVibrate: true,
      showBadge: true,
    });
  } catch (_) {}
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
        // Android 알림 채널 먼저 등록
        await setupNotificationChannels(N);
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
 * 알림 타입별로 적합한 화면으로 딥링크 이동
 *
 * type 매핑:
 *  diary_upload           → 일지 화면
 *  prev_day_reminder      → 출석/스케줄 화면
 *  same_day_reminder      → 출석/스케줄 화면
 *  makeup_day_of          → 출석/스케줄 화면
 *  makeup_schedule        → 출석/스케줄 화면
 *  photo_upload           → 사진 화면
 *  notice                 → 공지 화면
 *  messenger              → 메신저 화면
 *  (기타/미분류)           → 공지 화면 (기본)
 */
function PushNavSync() {
  const { kind, adminUser } = useAuth();

  useEffect(() => {
    // Expo Go SDK 53+: Android 원격 알림 미지원 → 리스너 등록 스킵 (Notifications는 null)
    if (!Notifications || Platform.OS === "web") return;

    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as Record<string, unknown> | null;
      const notifType = (data?.type as string | undefined) ?? "";
      const role = adminUser?.roles?.[0] ?? adminUser?.role ?? "";
      const isSuperAdmin = role === "super_admin" || role === "platform_admin" || role === "super_manager";
      const isTeacher = role === "teacher";

      // ── 일지 알림 ─────────────────────────────────────────────────────
      if (notifType === "diary_upload") {
        if (kind === "parent") {
          router.push("/(parent)/swim-diary" as any);
        } else if (kind === "admin") {
          router.push(isTeacher ? "/(teacher)/diary" as any : "/(admin)/diary-teacher-entries" as any);
        }
        return;
      }

      // ── 수업 알림 (전날 / 당일 / 보강) ───────────────────────────────
      if (
        notifType === "prev_day_reminder" ||
        notifType === "same_day_reminder" ||
        notifType === "makeup_day_of" ||
        notifType === "makeup_schedule"
      ) {
        if (kind === "parent") {
          router.push("/(parent)/attendance" as any);
        } else if (kind === "admin") {
          router.push(isTeacher ? "/(teacher)/today-schedule" as any : "/(admin)/notices" as any);
        }
        return;
      }

      // ── 사진 업로드 알림 ──────────────────────────────────────────────
      if (notifType === "photo_upload") {
        if (kind === "parent") {
          router.push("/(parent)/photos" as any);
        } else if (kind === "admin") {
          router.push(isTeacher ? "/(teacher)/photos" as any : "/(admin)/notices" as any);
        }
        return;
      }

      // ── 메신저 알림 ───────────────────────────────────────────────────
      if (notifType === "messenger") {
        if (kind === "admin") {
          router.push(isTeacher ? "/(teacher)/messenger" as any : "/(admin)/messenger" as any);
        } else if (kind === "parent") {
          router.push("/(parent)/notices" as any);
        }
        return;
      }

      // ── 공지 / 기본 폴백 ─────────────────────────────────────────────
      if (kind === "parent") {
        router.push("/(parent)/notices" as any);
        return;
      }
      if (kind === "admin" && adminUser) {
        if (isSuperAdmin) {
          router.push("/(super)/pool-notices" as any);
        } else if (isTeacher) {
          router.push("/(teacher)/notices" as any);
        } else {
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
  const { isLoading, isAuthenticating, kind, pendingRoute, clearPendingRoute, refreshSession, adminUser, token } = useAuth();
  const pathname = usePathname();

  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const isCheckingRef = useRef(false);
  const pathnameRef = useRef(pathname);
  const backgroundAtRef = useRef<number | null>(null);
  const didGoBackgroundRef = useRef(false);
  const otaDownloadedRef = useRef(false);   // 다운로드 완료 여부
  const inquiryPopupShownRef = useRef(false);
  const tokenRef = useRef(token);
  const kindRef = useRef<"parent" | "teacher" | "admin" | "super" | "pool_admin" | null>(kind);

  const [showForceModal, setShowForceModal] = useState(false);
  const [forceStoreUrl,  setForceStoreUrl]  = useState<string | null>(null);
  // [2.0.0] DEV OTA Restart Modal — 다운로드 완료 직후 즉시 표시
  const [otaModalVisible, setOtaModalVisible] = useState(false);
  const forcedRef = useRef(false); // Native force 판정 캐시 (foreground 복귀 중복 Modal 방지)
  const isSessionCheckedRef = useRef(false); // 세션 내 OTA check 1회 제한

  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);
  useEffect(() => { tokenRef.current = token; }, [token]);
  useEffect(() => { kindRef.current = kind; }, [kind]);

  // OTA 체크 + silent 다운로드 (V2: 사용자 알림 없음)
  async function checkAndDownloadOta() {
    if (__DEV__ || !Updates.isEnabled || isCheckingRef.current) return;
    isCheckingRef.current = true;
    try {
      const { isAvailable } = await Updates.checkForUpdateAsync();
      if (isAvailable) {
        await Updates.fetchUpdateAsync();
        otaDownloadedRef.current = true;
        console.log("[OTA] update downloaded, pending silent apply");

        // [2.0.0] DEV OTA Restart Modal: 다운로드 완료 즉시 모달 표시
        // 1.6.3에서는 DEV_OTA_RESTART_MODAL=false → 기존 silent 동작 유지
        if (DEV_OTA_RESTART_MODAL) {
          setOtaModalVisible(true);
        }
      }
    } catch (_) {
      // 실패 시 앱 계속 사용 — 사용자 알림 없음
    } finally {
      isCheckingRef.current = false;
    }
  }

  // OTA 조용한 적용 (30분+ background 복귀 시 내부 호출)
  async function silentApplyOta() {
    otaDownloadedRef.current = false; // reload loop 방지: 플래그 먼저 reset
    try {
      await Updates.reloadAsync();
    } catch (_) {
      // 실패 시 앱 계속 사용 — 사용자 알림 없음
    }
  }

  // Native version check — forced이면 true 반환 (OTA skip)
  // 네트워크 실패 → false 반환(fail-open), 서버 명시적 min_version 위반 → true(fail-closed)
  async function checkNativeVersion(): Promise<boolean> {
    if (__DEV__) return false;
    if (forcedRef.current) { setShowForceModal(true); return true; } // 이미 판정된 경우
    try {
      const API_URL = process.env.EXPO_PUBLIC_API_URL;
      if (!API_URL) return false;
      const res = await fetch(`${API_URL}/app-version`, { cache: "no-store" });
      if (!res.ok) return false;
      const data = await res.json();
      // Constants.expoConfig?.version = native 빌드 시 embed된 app.json version
      // OTA 업데이트로 변경되지 않으므로 Native Store version 판정에 안전
      const current = Constants.expoConfig?.version ?? "0.0.0";
      const platform = Platform.OS === "ios" ? "ios" : "android";
      const { min_version, latest_version } = data[platform] ?? {};
      const storeUrl: string | null = data.store_urls?.[platform] ?? null;

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
        // 강제 차단 — Modal 표시 (취소/우회 불가)
        setForceStoreUrl(storeUrl);
        setShowForceModal(true);
        forcedRef.current = true;
        return true;
      }

      if (latest_version && cmp(current, latest_version) < 0) {
        // 선택 업데이트 안내
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
    return false;
  }

  // 앱 시작 시 1회 통합 check (Native force → OTA silent download)
  useEffect(() => {
    if (isSessionCheckedRef.current) return;
    isSessionCheckedRef.current = true;
    (async () => {
      const forced = await checkNativeVersion();
      if (!forced) await checkAndDownloadOta();
    })();
  }, []);

  // Legacy media cleanup — documentDirectory 누적 파일 1회 정리
  // UI를 막지 않도록 fire-and-forget; 내부 예외가 앱 부팅에 영향을 주지 않음
  useEffect(() => { runLegacyMediaCleanup().catch(() => {}); }, []);

  // Media Cleanup V2 — image disk cache(SDWebImage) + ImagePicker temp 1회 정리
  // UploadQueueContext는 in-memory only → 앱 시작 시 항상 isActive=false → 안전
  useEffect(() => { runMediaCleanupV2(false).catch(() => {}); }, []);
  // V3: 앱 버전 기반 1회 실행 — 앱 업데이트 후 첫 실행 시 stale media cache 일괄 정리
  useEffect(() => {
    const appVersion = Constants.expoConfig?.version ?? "unknown";
    runMediaCleanupV3(appVersion, false).catch(() => {});
  }, []);

  // 백그라운드 복귀 처리 (V2)
  // - OTA 다운로드 완료 + 30분+ background: silent reload
  // - 30분 미만 background: OTA reload 없음
  // * inactive만 거친 경우(제어센터·알림 배너 등)는 무시
  useEffect(() => {
    const THIRTY_MIN = 30 * 60 * 1000;
    const sub = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;

      if (nextState === "background") {
        didGoBackgroundRef.current = true;
        backgroundAtRef.current = Date.now();
      }

      // active 복귀 시 — background를 실제로 거친 경우만 처리
      if ((prev === "background" || prev === "inactive") && nextState === "active") {
        if (!didGoBackgroundRef.current) return;
        didGoBackgroundRef.current = false;

        const elapsed = backgroundAtRef.current != null
          ? Date.now() - backgroundAtRef.current
          : 0;

        if (elapsed >= THIRTY_MIN) {
          // 30분+ 복귀
          if (otaDownloadedRef.current) {
            // 다운로드된 OTA 있음 → silent reload
            silentApplyOta();
            return; // reload 이후 아래 로직 불필요
          }
          // 다운로드된 OTA 없음 → 이 시점에 추가 check (30분+ 복귀 시 1회)
          checkNativeVersion().then(forced => {
            if (!forced) checkAndDownloadOta();
          });
        }
        // 30분 미만: OTA 관련 아무 것도 하지 않음

        // roles 갱신은 RolesPollingGuard의 AppState 리스너가 단독 처리.
        // 여기서 refreshSession을 동시에 호출하면 role 덮어쓰기 race condition 발생.

        // 미읽은 문의 답변 팝업 — 세션당 1회
        if (!inquiryPopupShownRef.current && tokenRef.current && kindRef.current) {
          inquiryPopupShownRef.current = true;
          apiRequest(tokenRef.current, "/inquiries/unread-count")
            .then(r => r.json())
            .then((d: any) => {
              const count = Number(d?.count ?? 0);
              if (count > 0) {
                const k = kindRef.current;
                const route =
                  k === "parent"  ? "/(parent)/inquiries"  :
                  k === "teacher" ? "/(teacher)/inquiries" :
                  k === "admin"   ? "/(admin)/inquiries"   :
                  k === "super"   ? "/(super)/inquiries"   : null;
                if (route) {
                  Alert.alert(
                    "📩 문의 답변 도착",
                    `${count}건의 미읽은 답변이 있습니다.`,
                    [
                      { text: "나중에", style: "cancel" },
                      { text: "확인하기", onPress: () => router.push(route as any) },
                    ]
                  );
                }
              }
            })
            .catch(() => {});
        }
      }
    });
    return () => sub.remove();
  }, [refreshSession]);


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
          <ActivityIndicator size="large" color={C.brandStrong} />
        </View>
      )}
      {/* ── [2.0.0] DEV OTA Restart Modal — 다운로드 완료 즉시 표시 ─────── */}
      {DEV_OTA_RESTART_MODAL && (
        <DevOtaRestartModal visible={otaModalVisible} />
      )}
      {/* ── Native 강제 업데이트 Modal — 취소/back button 우회 불가 ──────── */}
      <Modal
        visible={showForceModal}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => {}}
      >
        <View style={{
          flex: 1, backgroundColor: "rgba(0,0,0,0.85)",
          alignItems: "center", justifyContent: "center", paddingHorizontal: 32,
        }}>
          <View style={{
            backgroundColor: "#fff", borderRadius: 20, padding: 28,
            width: "100%", shadowColor: "#000", shadowOpacity: 0.15,
            shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 10,
          }}>
            <View style={{ alignItems: "center", marginBottom: 16 }}>
              <View style={{
                width: 56, height: 56, borderRadius: 16,
                backgroundColor: "#FEF3C7", alignItems: "center", justifyContent: "center",
                marginBottom: 12,
              }}>
                <Text style={{ fontSize: 26 }}>🔔</Text>
              </View>
              <Text style={{ fontSize: 18, fontFamily: "Pretendard-SemiBold", color: C.textPrimary }}>
                업데이트 필요
              </Text>
            </View>
            <Text style={{
              fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary,
              textAlign: "center", lineHeight: 22, marginBottom: 24,
            }}>
              더 나은 서비스를 위해{"\n"}최신 버전으로 업데이트해주세요.{"\n"}업데이트 후 계속 이용할 수 있습니다.
            </Text>
            <Pressable
              onPress={() => forceStoreUrl && Linking.openURL(forceStoreUrl)}
              style={{
                backgroundColor: "#EF4444", borderRadius: 12, height: 50,
                alignItems: "center", justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 15, fontFamily: "Pretendard-SemiBold", color: "#fff" }}>
                업데이트
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/**
 * ModeForegroundRefresh — foreground 복귀 시 Mode 재조회 (WP3)
 *
 * ModeProvider 하위에서 렌더링되므로 useMode() 접근 가능.
 * UI 없음(return null). 기존 AppState 리스너 동작을 변경하지 않음.
 */
function ModeForegroundRefresh() {
  const { refreshMode } = useMode();
  const { token, pool, isLoading } = useAuth();

  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const didGoBackgroundRef = useRef(false);

  // 최신 값을 비동기 listener에서 읽기 위한 Ref
  const tokenRef = useRef(token);
  const poolIdRef = useRef(pool?.id ?? null);
  const isLoadingRef = useRef(isLoading);

  useEffect(() => { tokenRef.current = token; }, [token]);
  useEffect(() => { poolIdRef.current = pool?.id ?? null; }, [pool?.id]);
  useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;

      if (nextState === "background") {
        didGoBackgroundRef.current = true;
      }

      // background를 실제로 거친 경우에만 재조회
      if ((prev === "background" || prev === "inactive") && nextState === "active") {
        if (!didGoBackgroundRef.current) return;
        didGoBackgroundRef.current = false;

        if (tokenRef.current && poolIdRef.current && !isLoadingRef.current) {
          // refreshMode 내부에서 isRefreshingRef lock으로 중복 호출 차단
          refreshMode();
        }
      }
    });
    return () => sub.remove();
  }, []); // 한 번만 등록 — 값은 ref로 읽음, refreshMode는 안정적

  return null;
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
        <ActivityIndicator size="large" color={C.brandStrong} />
      </View>
    );
  }

  // V1.6.2 retirement — 모든 startup/auth/provider/router 완전 우회
  if (Constants.expoConfig?.version === "1.6.2") {
    const storeUrl = Platform.OS === "ios"
      ? "https://apps.apple.com/app/id6761360360"
      : "https://play.google.com/store/apps/details?id=com.swimnote.app";
    const openStore = () => {
      Linking.canOpenURL(storeUrl)
        .then(ok => Linking.openURL(storeUrl))
        .catch(() => Linking.openURL(storeUrl));
    };
    return (
      <View style={{ flex: 1, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
        <Text style={{ fontSize: 20, fontWeight: "700", color: "#111827", textAlign: "center", marginBottom: 12 }}>
          새로운 SWIMNOTE가 출시되었습니다.
        </Text>
        <Text style={{ fontSize: 15, color: "#6B7280", textAlign: "center", lineHeight: 24, marginBottom: 16 }}>
          원활한 서비스 이용을 위해 최신 버전으로 업데이트해주세요.
        </Text>
        <Text style={{ fontSize: 13, color: "#9CA3AF", textAlign: "center", lineHeight: 20, marginBottom: 36 }}>
          App Store는 현재 업데이트 준비 중입니다.{"\n"}조금만 기다려주시면 감사하겠습니다.
        </Text>
        <Pressable
          onPress={openStore}
          style={{ backgroundColor: "#1E3A5F", borderRadius: 12, paddingVertical: 14, paddingHorizontal: 40 }}
        >
          <Text style={{ fontSize: 16, fontWeight: "600", color: "#FFFFFF" }}>업데이트하기</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      {MAINTENANCE_MODE ? (
        <MaintenanceScreen />
      ) : (
        <ErrorBoundary onError={(error, stack) => console.error("[ROOT_ERROR_BOUNDARY]", error?.message, stack)}>
          <QueryClientProvider client={queryClient}>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <KeyboardProvider>
              <BrandProvider>
                <UploadQueueProvider>
                  <AuthProvider>
                    <ModeProvider>
                      <SubscriptionProvider>
                        <BrandSync />
                        <RcUserSync />
                        <PushTokenSync />
                        <PushNavSync />
                        <NoticePopup />
                        <ModeForegroundRefresh />
                        <RootNav />
                        <UploadProgressModal />
                      </SubscriptionProvider>
                    </ModeProvider>
                  </AuthProvider>
                </UploadQueueProvider>
              </BrandProvider>
              </KeyboardProvider>
            </GestureHandlerRootView>
          </QueryClientProvider>
        </ErrorBoundary>
      )}
    </SafeAreaProvider>
  );
}
