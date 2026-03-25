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
import { NoticePopup } from "@/components/common/NoticePopup";
import { AuthProvider, apiRequest, useAuth, type AccountEntry, type AdminUser, type SessionKind, type ParentAccount } from "@/context/AuthContext";
import { BrandProvider, useBrand, DEFAULT_THEME_COLOR } from "@/context/BrandContext";

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
    "class-assign", "parent-onboard-pool", "parent-onboard-child", "parent-onboard-nickname",
    "pool-join-request", "signup-role", "register", "teacher-activate", "teacher-invite-join",
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
          if (["expired", "suspended", "cancelled"].includes(pool.subscription_status)) {
            didRoute.current = true; router.replace("/subscription-expired"); return;
          }
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

      didRoute.current = true;
      router.replace("/org-role-select");
    }

    doRoute();
  }, [kind, isLoading, adminUser?.role, adminUser?.swimming_pool_id, pool?.id, pool?.approval_status, pool?.subscription_status, activeRole, lastUsedTenant]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#ffffff" } }}>
      <Stack.Screen name="index" />
      {/* (auth) 그룹 — 인증 화면 */}
      <Stack.Screen name="(auth)/login" />
      <Stack.Screen name="(auth)/org-role-select" />
      <Stack.Screen name="(auth)/parent-login" />
      <Stack.Screen name="(auth)/otp-verify" />
      <Stack.Screen name="(auth)/totp-setup" />
      <Stack.Screen name="(auth)/forgot-password" />
      <Stack.Screen name="(auth)/teacher-signup" />
      <Stack.Screen name="(auth)/parent-signup" />
      <Stack.Screen name="(auth)/parent-code-signup" />
      <Stack.Screen name="(auth)/parent-onboard-pool" />
      <Stack.Screen name="(auth)/parent-onboard-child" />
      <Stack.Screen name="(auth)/parent-onboard-nickname" />
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
                <NoticePopup />
                <RootNav />
              </AuthProvider>
            </BrandProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
