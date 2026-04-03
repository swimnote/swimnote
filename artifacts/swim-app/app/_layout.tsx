import { useFonts } from "expo-font";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, router, useSegments } from "expo-router";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Platform, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { NoticePopup } from "@/components/common/NoticePopup";
import { AuthProvider, apiRequest, useAuth, type AccountEntry, type AdminUser, type SessionKind, type ParentAccount } from "@/context/AuthContext";
import { BrandProvider, useBrand, DEFAULT_THEME_COLOR } from "@/context/BrandContext";
import { initializeRevenueCat, loginRevenueCat, logoutRevenueCat, SubscriptionProvider } from "@/lib/revenuecat";

try {
  initializeRevenueCat();
} catch (err: any) {
  console.warn("[RevenueCat] 초기화 실패:", err?.message ?? "Unknown error");
}

function AppLoadingScreen() {
  return (
    <View style={loadingStyles.container}>
      <Image
        source={require("../assets/images/swimnote-logo.png")}
        style={loadingStyles.logo}
        resizeMode="contain"
      />
      <ActivityIndicator size="small" color="#2EC4B6" style={{ marginTop: 32 }} />
    </View>
  );
}

const loadingStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F5F5",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  logo: {
    width: 120,
    height: 120,
  },
  appName: {
    fontSize: 26,
    fontFamily: "Pretendard-Regular",
    color: "#0F172A",
    letterSpacing: 6,
    marginTop: 8,
  },
});

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
    if (!token || registered.current || Platform.OS === "web") return;
    async function registerToken() {
      try {
        const { status: existing } = await Notifications.getPermissionsAsync();
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
  const {
    kind, isLoading, adminUser, parentAccount, pool,
    activeRole, activePoolId, lastUsedTenant, allAccounts, checkRolePermission, setActiveRole, token,
  } = useAuth();
  const segments = useSegments();
  const didRoute = useRef(false);

  const APP_ROOTS = [
    "(admin)", "(super)", "(teacher)", "(parent)", "(auth)",
    "org-role-select", "pool-apply", "pool-select", "pending", "rejected", "subscription-expired",
    "class-assign", "parent-onboard-nickname",
    "pool-join-request", "signup-role", "register", "teacher-activate", "teacher-invite-join",
    "terms", "privacy", "refund",
    "support-ticket-write", "support-ticket-list", "support-ticket-detail",
  ];

  useEffect(() => {
    if (isLoading || !kind || !didRoute.current) return;
    if (segments.length === 0 || !APP_ROOTS.includes(segments[0] as string)) {
      router.replace("/org-role-select");
    }
  }, [segments]);

  useEffect(() => {
    if (isLoading) return;

    if (!kind) {
      didRoute.current = false;
      router.replace("/");
      return;
    }

    if (didRoute.current) return;

    async function doRoute() {
      if (kind === "admin") {
        const role = adminUser?.role;

        // 슈퍼관리자 계열은 activeRole 무시하고 즉시 해당 홈으로 라우팅
        if (role === "super_admin" || role === "platform_admin" || role === "super_manager") {
          const homePath = ROLE_HOME_MAP[role];
          if (homePath) {
            didRoute.current = true;
            await setActiveRole(role);
            router.replace(homePath as any);
            return;
          }
        }

        if (role === "pool_admin") {
          if (!adminUser?.swimming_pool_id) {
            didRoute.current = true;
            router.replace("/pool-apply");
            return;
          }
          if (!pool) return;
          if (pool.approval_status === "pending") { didRoute.current = true; router.replace("/pending"); return; }
          if (pool.approval_status === "rejected") { didRoute.current = true; router.replace("/rejected"); return; }
          try {
            const poolsRes = await apiRequest(token, "/pools/my-pools");
            const pools = await poolsRes.json();
            if (Array.isArray(pools) && pools.length > 1 && !lastUsedTenant) {
              didRoute.current = true;
              router.replace("/pool-select" as any);
              return;
            }
          } catch {}
        }
      }

      const targetRole = activeRole;
      if (targetRole) {
        const valid = await checkRolePermission(targetRole);
        if (valid) {
          const homePath = ROLE_HOME_MAP[targetRole];
          if (homePath) {
            didRoute.current = true;
            router.replace(homePath as any);
            return;
          }
        }
      }

      const roleKeys = computeRoleKeys(allAccounts, kind, adminUser, parentAccount);
      if (roleKeys.length === 1) {
        const roleKey = roleKeys[0];
        const homePath = ROLE_HOME_MAP[roleKey];
        if (homePath) {
          didRoute.current = true;
          await setActiveRole(roleKey);
          router.replace(homePath as any);
          return;
        }
      }

      // 복수 역할: 저장된 기본 진입 모드 확인 → 없으면 관리자 우선
      if (roleKeys.length > 1) {
        const ADMIN_ROLES = ["pool_admin", "sub_admin"];
        const storedDefault = await AsyncStorage.getItem("@swimnote:default_login_mode").catch(() => null);
        const adminRole = roleKeys.find(r => ADMIN_ROLES.includes(r));
        const teacherRole = roleKeys.find(r => r === "teacher");
        const chosen = storedDefault === "teacher"
          ? (teacherRole || adminRole)
          : (adminRole || teacherRole);
        if (chosen) {
          didRoute.current = true;
          await setActiveRole(chosen);
          router.replace(ROLE_HOME_MAP[chosen] as any);
          return;
        }
      }

      didRoute.current = true;
      router.replace("/org-role-select");
    }

    doRoute();
  }, [kind, isLoading, adminUser?.role, adminUser?.swimming_pool_id, pool?.id, pool?.approval_status, pool?.subscription_status, activeRole, lastUsedTenant]);

  if (isLoading) return <AppLoadingScreen />;

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
  const [fontsLoaded, fontError] = useFonts({
    "Pretendard-Regular": require("../assets/fonts/Pretendard-Regular.otf"),
  });

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary onError={(error, stack) => console.error("[ROOT_ERROR_BOUNDARY]", error?.message, stack)}>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <BrandProvider>
              <AuthProvider>
                <SubscriptionProvider>
                  <BrandSync />
                  <RcUserSync />
                  <PushTokenSync />
                  <PushNavSync />
                  <NoticePopup />
                  <RootNav />
                </SubscriptionProvider>
              </AuthProvider>
            </BrandProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
