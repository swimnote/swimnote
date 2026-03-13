import {
  Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { BrandProvider, useBrand, DEFAULT_THEME_COLOR } from "@/context/BrandContext";

SplashScreen.preventAutoHideAsync();
const queryClient = new QueryClient();

/**
 * 로그인 상태가 바뀔 때마다 BrandContext를 동기화한다.
 * - 수영장 관리자: pool 정보의 theme_color, logo_url, logo_emoji, name 적용
 * - 학부모: pool_name만 적용
 * - 슈퍼관리자: SwimClass 기본값 유지
 * - 로그아웃: 브랜드 초기화
 */
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
        // 슈퍼관리자는 플랫폼 기본 브랜드
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

function RootNav() {
  const { kind, adminUser, pool, isLoading } = useAuth();

  useEffect(() => {
    if (isLoading) return;

    if (!kind) { router.replace("/login"); return; }

    if (kind === "parent") { router.replace("/(parent)/children"); return; }

    if (kind === "admin") {
      const role = adminUser?.role;
      if (role === "super_admin") { router.replace("/(super)/pools"); return; }
      if (role === "teacher") { router.replace("/(teacher)/classes"); return; }
      if (role === "pool_admin") {
        if (!adminUser?.swimming_pool_id) { router.replace("/pool-apply"); return; }
        if (pool) {
          if (pool.approval_status === "pending") { router.replace("/pending"); return; }
          if (pool.approval_status === "rejected") { router.replace("/rejected"); return; }
          if (["expired", "suspended", "cancelled"].includes(pool.subscription_status)) {
            router.replace("/subscription-expired"); return;
          }
        }
        router.replace("/(admin)/dashboard");
      }
    }
  }, [kind, adminUser, pool, isLoading]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="parent-login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="pool-apply" />
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
                <RootNav />
              </AuthProvider>
            </BrandProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
