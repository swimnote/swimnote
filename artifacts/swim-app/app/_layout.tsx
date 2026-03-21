import {
  Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, router, useSegments } from "expo-router";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, apiRequest, useAuth, type AccountEntry, type AdminUser, type SessionKind, type ParentAccount } from "@/context/AuthContext";
import { BrandProvider, useBrand, DEFAULT_THEME_COLOR } from "@/context/BrandContext";

SplashScreen.preventAutoHideAsync();
const queryClient = new QueryClient();

// 역할 키 → 홈 경로 매핑
const ROLE_HOME_MAP: Record<string, string> = {
  super_admin: "/(super)/dashboard",
  platform_admin: "/(super)/dashboard",
  pool_admin: "/(admin)/dashboard",
  sub_admin: "/(admin)/dashboard",
  teacher: "/(teacher)/today-schedule",
  parent: "/(parent)/home",
  parent_account: "/(parent)/home",
};

// 계정에서 이용 가능한 역할 키 목록 추출
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
  // fallback: allAccounts 비어있으면 현재 세션에서 추출
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
      if (adminUser?.role === "super_admin" || adminUser?.role === "platform_admin") {
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
 * 앱 시작 라우팅 로직:
 * 1. 세션 없음 → /index (로그인)
 * 2. 세션 있음 + last_used_role 유효 → 해당 홈 바로
 * 3. 세션 있음 + last_used_role 없거나 무효 → /org-role-select
 * 4. admin이 pool 없거나 pool 상태 이슈 → 적절한 화면
 */
function RootNav() {
  const {
    kind, isLoading, adminUser, parentAccount, pool,
    lastUsedRole, allAccounts, checkRolePermission, setLastUsedRole,
  } = useAuth();
  const segments = useSegments();
  const didRoute = useRef(false);

  // 뒤로가기로 로그인 화면 도달 시 재리다이렉트
  useEffect(() => {
    if (isLoading || !kind || !didRoute.current) return;
    const APP_ROOTS = [
      "(admin)", "(super)", "(teacher)", "(parent)",
      "org-role-select", "pool-apply", "pending", "rejected", "subscription-expired",
      "class-assign", "parent-onboard-pool", "parent-onboard-child", "parent-onboard-nickname",
    ];
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
      // pool_admin 특수 체크
      if (kind === "admin") {
        const role = adminUser?.role;
        if (role === "pool_admin") {
          if (!adminUser?.swimming_pool_id) {
            didRoute.current = true;
            router.replace("/pool-apply");
            return;
          }
          if (!pool) return; // pool 로딩 대기
          if (pool.approval_status === "pending") { didRoute.current = true; router.replace("/pending"); return; }
          if (pool.approval_status === "rejected") { didRoute.current = true; router.replace("/rejected"); return; }
          if (["expired", "suspended", "cancelled"].includes(pool.subscription_status)) {
            didRoute.current = true; router.replace("/subscription-expired"); return;
          }
        }
      }

      // last_used_role 기반 자동 진입
      const targetRole = lastUsedRole;
      if (targetRole) {
        // 권한 유효성 검증
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

      // last_used_role 없거나 무효 → 이용 가능한 역할 수 계산
      // 역할 1개: 자동 분기 / 역할 2개 이상: 역할 선택 화면
      const roleKeys = computeRoleKeys(allAccounts, kind, adminUser, parentAccount);
      if (roleKeys.length === 1) {
        const roleKey = roleKeys[0];
        const homePath = ROLE_HOME_MAP[roleKey];
        if (homePath) {
          didRoute.current = true;
          await setLastUsedRole(roleKey);
          router.replace(homePath as any);
          return;
        }
      }

      // 여러 역할이거나 경로 없음 → 역할 선택 화면
      didRoute.current = true;
      router.replace("/org-role-select");
    }

    doRoute();
  }, [kind, isLoading, adminUser?.role, adminUser?.swimming_pool_id, pool?.id, pool?.approval_status, pool?.subscription_status, lastUsedRole]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#ffffff" } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="login" />
      <Stack.Screen name="org-role-select" />
      <Stack.Screen name="parent-login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="pool-apply" />
      <Stack.Screen name="pool-join-request" />
      <Stack.Screen name="teacher-invite-join" />
      <Stack.Screen name="signup-role" />
      <Stack.Screen name="teacher-signup" />
      <Stack.Screen name="parent-signup" />
      <Stack.Screen name="parent-code-signup" />
      <Stack.Screen name="parent-onboard-pool" />
      <Stack.Screen name="parent-onboard-child" />
      <Stack.Screen name="parent-onboard-nickname" />
      <Stack.Screen name="forgot-password" />
      <Stack.Screen name="pending" />
      <Stack.Screen name="rejected" />
      <Stack.Screen name="subscription-expired" />
      <Stack.Screen name="(admin)" />
      <Stack.Screen name="(super)" />
      <Stack.Screen name="(teacher)" />
      <Stack.Screen name="(parent)" />
      <Stack.Screen name="class-assign" />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <BrandProvider>
              <AuthProvider>
                <BrandSync />
                <PushTokenSync />
                <RootNav />
              </AuthProvider>
            </BrandProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
