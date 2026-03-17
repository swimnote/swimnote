import {
  Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, apiRequest, useAuth } from "@/context/AuthContext";
import { BrandProvider, useBrand, DEFAULT_THEME_COLOR } from "@/context/BrandContext";

SplashScreen.preventAutoHideAsync();
const queryClient = new QueryClient();

function BrandSync() {
  const { kind, adminUser, parentAccount, pool } = useAuth();
  const { setBrand, resetBrand } = useBrand();

  useEffect(() => {
    if (!kind) {
      resetBrand();
      return;
    }
    if (kind === "admin") {
      if (adminUser?.role === "super_admin") {
        setBrand({ poolName: null, themeColor: DEFAULT_THEME_COLOR, logoUrl: null, logoEmoji: null });
        return;
      }
      if (pool) {
        setBrand({
          poolName:   pool.name,
          themeColor: pool.theme_color || DEFAULT_THEME_COLOR,
          logoUrl:    pool.logo_url    || null,
          logoEmoji:  pool.logo_emoji  || null,
        });
      }
    } else if (kind === "parent" && parentAccount) {
      setBrand({
        poolName:   parentAccount.pool_name || null,
        themeColor: DEFAULT_THEME_COLOR,
        logoUrl:    null,
        logoEmoji:  null,
      });
    }
  }, [kind, adminUser?.role, pool?.id, pool?.theme_color, parentAccount?.swimming_pool_id]);

  return null;
}

function PushTokenSync() {
  const { token, kind, parentAccount } = useAuth();
  const registered = useRef(false);

  useEffect(() => {
    if (!token || registered.current) return;
    if (Platform.OS === "web") return;

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
          body: JSON.stringify({
            token: tokenData.data,
            parent_account_id: kind === "parent" && parentAccount ? parentAccount.id : null,
          }),
        });
        registered.current = true;
      } catch (_) {}
    }
    registerToken();
  }, [token]);

  return null;
}

/**
 * 인증 상태에 따른 라우팅:
 * - 세션 없음 → "/" (로그인 ID 화면)
 * - 세션 있음 → "/org-role-select" (조직+역할 선택 화면)
 *
 * 역할 선택 후 앱 내부 이동은 org-role-select에서 직접 router.replace()로 처리한다.
 * 이 effect는 kind 또는 isLoading이 바뀔 때만 재실행되므로, 앱 내부 탐색 중에는 재실행되지 않는다.
 */
function RootNav() {
  const { kind, isLoading, adminUser, pool } = useAuth();
  const didRoute = useRef(false);

  useEffect(() => {
    if (isLoading) return;

    if (!kind) {
      didRoute.current = false;
      router.replace("/");
      return;
    }

    if (didRoute.current) return;

    if (kind === "admin") {
      const role = adminUser?.role;
      if (role === "pool_admin") {
        if (!adminUser?.swimming_pool_id) {
          didRoute.current = true;
          router.replace("/pool-apply");
          return;
        }
        if (!pool) return;
        if (pool.approval_status === "pending") { router.replace("/pending"); return; }
        if (pool.approval_status === "rejected") { router.replace("/rejected"); return; }
        if (["expired", "suspended", "cancelled"].includes(pool.subscription_status)) {
          router.replace("/subscription-expired"); return;
        }
      }
    }

    didRoute.current = true;
    router.replace("/org-role-select");
  }, [kind, isLoading, adminUser?.role, adminUser?.swimming_pool_id, pool?.id, pool?.approval_status, pool?.subscription_status]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
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
      <Stack.Screen name="forgot-password" />
      <Stack.Screen name="pending" />
      <Stack.Screen name="rejected" />
      <Stack.Screen name="subscription-expired" />
      <Stack.Screen name="(admin)" />
      <Stack.Screen name="(super)" />
      <Stack.Screen name="(teacher)" />
      <Stack.Screen name="(parent)" />
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
