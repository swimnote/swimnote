import { useFonts } from "expo-font";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, router, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, TouchableOpacity, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { NoticePopup } from "@/components/common/NoticePopup";
import { AuthProvider, apiRequest, useAuth, type AccountEntry, type AdminUser, type SessionKind, type ParentAccount } from "@/context/AuthContext";
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

const ROLE_HOME_MAP: Record<string, string> = {
  super_admin: "/(super)/dashboard",
  platform_admin: "/(super)/dashboard",
  super_manager: "/(super)/dashboard",
  pool_admin: "/(admin)/dashboard",
  sub_admin: "/(admin)/dashboard",
  teacher: "/(teacher)/today-schedule",
  parent: "/(parent)/home",
  parent_account: "/(parent)/home",
};

function computeRoleKeys(
  allAccounts: AccountEntry[],
  kind: SessionKind | null,
  adminUser: AdminUser | null,
  parentAccount: ParentAccount | null,
): string[] {
  const result = new Set<string>();
  for (const entry of allAccounts) {
    if (entry.kind === "parent") {
      result.add("parent");
    } else if (entry.kind === "admin" && entry.user) {
      const roles = entry.user.roles?.length ? entry.user.roles : [entry.user.role];
      for (const r of roles) if (r) result.add(r);
    }
  }
  if (result.size === 0) {
    if (kind === "parent") result.add("parent");
    else if (kind === "admin" && adminUser) {
      const roles = adminUser.roles?.length ? adminUser.roles : [adminUser.role];
      for (const r of roles) if (r) result.add(r);
    }
  }
  return Array.from(result);
}

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
 * 앱 시작 라우팅 로직:
 * 1. 세션 없음 → /index (로그인)
 * 2. 세션 있음 + activeRole 유효 → 해당 홈 바로
 * 3. 세션 있음 + activeRole 없거나 무효 → /org-role-select
 * 4. admin이 pool 없거나 pool 상태 이슈 → 적절한 화면
 */
function RootNav() {
  console.log("[ROOTNAV] RENDER_START");
  const {
    kind, isLoading, isAuthenticating, adminUser, parentAccount, pool,
    activeRole, activePoolId, lastUsedTenant, allAccounts, checkRolePermission, setActiveRole, token, refreshPool,
    pendingRoute, clearPendingRoute,
  } = useAuth();
  console.log(`[ROOTNAV] state: isLoading=${isLoading} isAuth=${isAuthenticating} kind=${kind} role=${adminUser?.role ?? "none"} activeRole=${activeRole ?? "none"}`);
  const segments = useSegments();
  // kindRef: 타임아웃 콜백(stale closure) 내부에서 최신 kind 값 읽기 위한 ref
  const kindRef = useRef(kind);
  kindRef.current = kind;
  const didRoute = useRef(false);
  const [hasRouted, setHasRouted] = useState(false);
  // 타이머 2개 분리 (GPT 권장: 하나의 ref로 2단계 타이머 관리하면 race condition 위험)
  const firstWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const poolRetryRef = useRef(0);
  const [poolLoadError, setPoolLoadError] = useState(false);
  // 경로1 방어: isAuthenticating 워치독
  // — API가 25초 이상 응답 없을 때 세션 존재 여부로 분기:
  //   세션 없음 → "/" (로그인 화면, 재시도 가능)
  //   세션 있음 → "/route-error" (라우팅 실패 안내 + 재시도·로그아웃 버튼)
  const authingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isAuthenticating) {
      authingTimerRef.current = setTimeout(() => {
        authingTimerRef.current = null;
        const hasSession = !!kindRef.current;
        console.warn(`[ROOTNAV] isAuthenticating watchdog(25s) → hasSession=${hasSession}`);
        if (hasSession) {
          router.replace("/route-error" as any);
        } else {
          router.replace("/");
        }
      }, 25000);
    } else {
      if (authingTimerRef.current) { clearTimeout(authingTimerRef.current); authingTimerRef.current = null; }
    }
    return () => { if (authingTimerRef.current) { clearTimeout(authingTimerRef.current); authingTimerRef.current = null; } };
  }, [isAuthenticating]);

  // ─── finishLogin() 완료 신호 수신 ───────────────────────────────────────────
  // SessionContext의 finishLogin()이 pendingRoute를 설정하면 즉시 hasRouted=true + navigate
  // doRoute()의 async 체인(API/AsyncStorage) 완전 우회
  useEffect(() => {
    if (!pendingRoute) return;
    console.log(`[AUTH COMPLETE][PENDING_ROUTE] 감지 → ${pendingRoute} hasRouted 즉시 true`);
    didRoute.current = true;
    setHasRouted(true);
    clearPoolTimers();
    router.replace(pendingRoute as any);
    clearPendingRoute();
  }, [pendingRoute]);
  // ─────────────────────────────────────────────────────────────────────────

  function clearPoolTimers() {
    if (firstWaitTimerRef.current) { clearTimeout(firstWaitTimerRef.current); firstWaitTimerRef.current = null; }
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
  }

  const APP_ROOTS = [
    "(admin)", "(super)", "(teacher)", "(parent)", "(auth)",
    "org-role-select", "pool-apply", "pool-select", "pending", "rejected", "subscription-expired",
    "class-assign", "parent-onboard-nickname",
    "onboarding-admin", "onboarding-teacher", "onboarding-parent", "policy-agreement",
    "pool-join-request", "signup-role", "register", "teacher-activate", "teacher-invite-join",
    "terms", "privacy", "refund",
    "support-ticket-write", "support-ticket-list", "support-ticket-detail",
    "route-error",
  ];

  useEffect(() => {
    if (isLoading || !kind || !didRoute.current) return;
    if ((segments.length as number) === 0 || !APP_ROOTS.includes(segments[0] as string)) {
      router.replace("/org-role-select");
    }
  }, [segments]);

  useEffect(() => {
    console.log(`[AUTH COMPLETE][10] RootNav useEffect 진입 — isLoading=${isLoading} isAuth=${isAuthenticating} kind=${kind ?? "null"} didRoute=${didRoute.current}`);
    if (isLoading) { console.log("[AUTH COMPLETE][10a] isLoading=true → skip"); return; }

    if (!kind) {
      // isAuthenticating=true면 소셜 로그인 API 진행 중 → 아직 kind가 settle 안 됨 → 로그인 화면 복귀 금지
      if (isAuthenticating) {
        console.log("[AUTH COMPLETE][10b] !kind + isAuthenticating=true → skip redirect (auth settling)");
        return;
      }
      console.log("[AUTH COMPLETE][10c] !kind + !isAuthenticating → router.replace('/')");
      didRoute.current = false;
      setHasRouted(false);
      poolRetryRef.current = 0;
      setPoolLoadError(false);
      clearPoolTimers();
      router.replace("/");
      return;
    }

    if (didRoute.current) { console.log(`[AUTH COMPLETE][10d] didRoute=true → skip (already routed)`); return; }

    console.log(`[AUTH COMPLETE][10e] kind=${kind} didRoute=false → doRoute() 호출 예정`);

    function navigate(path: string) {
      if (didRoute.current) return;
      console.log(`[AUTH COMPLETE][12] navigate CALLED → ${path}`);
      didRoute.current = true;
      setHasRouted(true);
      console.log(`[AUTH COMPLETE][13] hasRouted=true`);
      clearPoolTimers();
      router.replace(path as any);
    }

    async function checkOnboarding(role: string, userId: string | undefined): Promise<string | null> {
      if (!userId) return null;
      const ADMIN_ROLES = ["pool_admin", "sub_admin"];
      if (ADMIN_ROLES.includes(role)) {
        const done = await AsyncStorage.getItem(`@swimnote:onboarded_${userId}_admin`).catch(() => "1");
        if (!done) return "/(auth)/onboarding-admin";
        if (role === "pool_admin" && token) {
          try {
            // 경로3 방어: refund-policy API에 5초 타임아웃 → 응답 없어도 doRoute() 계속 진행
            const timeoutPromise = new Promise<null>((_, rej) =>
              setTimeout(() => rej(new Error("refund-policy timeout")), 5000)
            );
            const policyRes = await Promise.race([apiRequest(token, "/admin/refund-policy"), timeoutPromise]);
            if (policyRes && (policyRes as Response).ok) {
              const policyData = await (policyRes as Response).json();
              if (policyData.success && (!policyData.agreed || policyData.needs_reagree)) {
                return "/(auth)/policy-agreement";
              }
            }
          } catch (e) {
            console.warn("[ROUTE] checkOnboarding refund-policy skip:", e);
          }
        }
        return null;
      }
      if (role === "teacher") {
        const done = await AsyncStorage.getItem(`@swimnote:onboarded_${userId}_teacher`).catch(() => "1");
        return done ? null : "/(auth)/onboarding-teacher";
      }
      if (role === "parent" || role === "parent_account") {
        const done = await AsyncStorage.getItem(`@swimnote:onboarded_${userId}_parent`).catch(() => "1");
        return done ? null : "/(auth)/onboarding-parent";
      }
      return null;
    }

    async function doRoute() {
      console.log(`[AUTH COMPLETE][11] doRoute START`);
      // 경로2 방어: 전체를 try/catch로 감싸 예외 발생 시 안전 fallback으로 탈출 보장
      try {
      // GPT 권장: doRoute 시작 시점 값 스냅샷 고정 → 실행 중 외부 state 변경과 섞임 방지
      const snapKind = kind;
      const snapRole = adminUser?.role;
      const snapPoolId = adminUser?.swimming_pool_id;
      const snapPool = pool;
      const snapActiveRole = activeRole;
      const cycleId = Date.now().toString(36).toUpperCase();
      console.log(`[ROUTE][${cycleId}] doRoute start kind=${snapKind} role=${snapRole ?? "none"} activeRole=${snapActiveRole ?? "none"} pool=${snapPool?.id?.substring(0,8) ?? "없음"}`);

      if (snapKind === "admin") {
        const role = snapRole;

        if (role === "super_admin" || role === "platform_admin" || role === "super_manager") {
          const homePath = ROLE_HOME_MAP[role];
          if (homePath) {
            await setActiveRole(role);
            navigate(homePath);
            return;
          }
        }

        if (role === "pool_admin") {
          // swimming_pool_id 없음 = 실제로 수영장 미등록 → pool-apply
          if (!snapPoolId) {
            navigate("/pool-apply");
            return;
          }
          // swimming_pool_id 있는데 pool 데이터 아직 미수신 = 네트워크 지연
          if (!snapPool) {
            if (!firstWaitTimerRef.current && !retryTimerRef.current) {
              console.log(`[ROUTE][${cycleId}] pool 없음 → 1차 대기 4s 시작`);
              firstWaitTimerRef.current = setTimeout(() => {
                firstWaitTimerRef.current = null;
                if (didRoute.current) return;
                console.log(`[ROUTE][${cycleId}] pool 1차 타임아웃(4s) → refreshPool 재시도`);
                poolRetryRef.current = 1;
                refreshPool();
                // 2차 타이머: refreshPool 후 4초 더 대기, 그래도 없으면 대시보드 강제 이동
                retryTimerRef.current = setTimeout(() => {
                  retryTimerRef.current = null;
                  if (didRoute.current) return;
                  // dashboard는 pool?.name (optional chaining) + 독자 /pools/my API 호출로
                  // pool=null 상태에서도 크래시·리다이렉트·무한로딩 없음이 검증됨.
                  console.log(`[ROUTE][${cycleId}] pool 2차 타임아웃(8s 누적) → 대시보드 강제 이동 (pool=null safe)`);
                  navigate("/(admin)/dashboard");
                }, 4000);
              }, 4000);
            }
            return;
          }
          poolRetryRef.current = 0;
          setPoolLoadError(false);
          clearPoolTimers();
          if (snapPool.approval_status === "pending") { navigate("/pending"); return; }
          if (snapPool.approval_status === "rejected") { navigate("/rejected"); return; }
          try {
            // 경로2 보조: my-pools API도 5초 타임아웃 → 응답 없으면 pool-select 건너뜀
            const myPoolsTimeout = new Promise<never>((_, rej) =>
              setTimeout(() => rej(new Error("my-pools timeout")), 5000)
            );
            const poolsRes = await Promise.race([apiRequest(token, "/pools/my-pools"), myPoolsTimeout]);
            const pools = await (poolsRes as Response).json();
            if (Array.isArray(pools) && pools.length > 1 && !lastUsedTenant) {
              navigate("/pool-select");
              return;
            }
          } catch {}
        }
      }

      const targetRole = snapActiveRole;
      console.log(`[ROUTE][${cycleId}] targetRole=${targetRole ?? "없음"} parentAccount=${!!parentAccount}`);
      if (targetRole) {
        const valid = await checkRolePermission(targetRole);
        if (didRoute.current) return; // 비동기 대기 중 이미 라우팅됐으면 중단
        if (valid) {
          const homePath = ROLE_HOME_MAP[targetRole];
          if (homePath) {
            const uid = snapKind === "parent" ? parentAccount?.id : adminUser?.id;
            const onboardPath = await checkOnboarding(targetRole, uid);
            if (didRoute.current) return;
            console.log(`[ROUTE][${cycleId}] NAVIGATE → ${onboardPath ?? homePath}`);
            navigate(onboardPath ?? homePath);
            return;
          }
        }
      }

      const roleKeys = computeRoleKeys(allAccounts, snapKind, adminUser, parentAccount);
      console.log(`[ROUTE][${cycleId}] roleKeys=[${roleKeys.join(",")}] allAccounts=${allAccounts.length}`);
      if (roleKeys.length === 1) {
        const roleKey = roleKeys[0];
        const homePath = ROLE_HOME_MAP[roleKey];
        if (homePath) {
          await setActiveRole(roleKey);
          if (didRoute.current) return;
          const uid = snapKind === "parent" ? parentAccount?.id : adminUser?.id;
          const onboardPath = await checkOnboarding(roleKey, uid);
          if (didRoute.current) return;
          console.log(`[ROUTE][${cycleId}] NAVIGATE → ${onboardPath ?? homePath} (role=${roleKey})`);
          navigate(onboardPath ?? homePath);
          return;
        }
      }

      if (roleKeys.length > 1) {
        const ADMIN_ROLES = ["pool_admin", "sub_admin"];
        const storedDefault = await AsyncStorage.getItem("@swimnote:default_login_mode").catch(() => null);
        const adminRole = roleKeys.find(r => ADMIN_ROLES.includes(r));
        const teacherRole = roleKeys.find(r => r === "teacher");
        const chosen = storedDefault === "teacher"
          ? (teacherRole || adminRole)
          : (adminRole || teacherRole);
        if (chosen) {
          await setActiveRole(chosen);
          if (didRoute.current) return;
          const onboardPath = await checkOnboarding(chosen, adminUser?.id);
          if (didRoute.current) return;
          navigate(onboardPath ?? ROLE_HOME_MAP[chosen] ?? "/org-role-select");
          return;
        }
      }

      console.log(`[ROUTE][${cycleId}] FALLBACK roleKeys=[${roleKeys.join(",")}] → org-role-select`);
      navigate("/org-role-select");
      } catch (err) {
        // 경로2: doRoute() 내 예외 발생 시 → 재시도 버튼 있는 로그인 화면으로 강제 탈출
        console.error("[ROUTE] doRoute() 예외 → 강제 로그인 화면 이동", err);
        if (!didRoute.current) {
          didRoute.current = true;
          clearPoolTimers();
          router.replace("/");
        }
      }
    }

    console.log(`[AUTH COMPLETE][11b] doRoute() 호출`);
    doRoute();
  }, [kind, isLoading, isAuthenticating, adminUser?.role, adminUser?.swimming_pool_id, pool?.id, pool?.approval_status, pool?.subscription_status, activeRole, lastUsedTenant]);

  // [AUTH COMPLETE][14] 로딩 플래그 최종 감시
  useEffect(() => {
    console.log(`[AUTH COMPLETE][14] 플래그 감시 — isLoading=${isLoading} isAuth=${isAuthenticating} hasRouted=${hasRouted} kind=${kind ?? "null"}`);
  }, [isLoading, isAuthenticating, hasRouted, kind]);

  if (isLoading || (!!kind && !hasRouted && !poolLoadError)) return <AppLoadingScreen />;

  if (poolLoadError) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff", padding: 32 }}>
        <Text style={{ fontSize: 16, color: "#333", textAlign: "center", marginBottom: 8 }}>
          서버 응답이 지연되고 있습니다.
        </Text>
        <Text style={{ fontSize: 14, color: "#888", textAlign: "center", marginBottom: 32 }}>
          잠시 후 다시 시도해 주세요.
        </Text>
        <TouchableOpacity
          onPress={() => {
            setPoolLoadError(false);
            setHasRouted(false);
            didRoute.current = false;
            poolRetryRef.current = 0;
            clearPoolTimers();
            refreshPool();
          }}
          style={{ backgroundColor: "#3B82F6", paddingHorizontal: 32, paddingVertical: 14, borderRadius: 10 }}
        >
          <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }}>재시도</Text>
        </TouchableOpacity>
      </View>
    );
  }

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
