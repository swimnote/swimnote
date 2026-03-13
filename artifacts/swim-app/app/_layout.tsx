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

SplashScreen.preventAutoHideAsync();
const queryClient = new QueryClient();

function RootNav() {
  const { kind, adminUser, pool, isLoading } = useAuth();

  useEffect(() => {
    if (isLoading) return;

    if (!kind) { router.replace("/login"); return; }

    if (kind === "parent") { router.replace("/(parent)/children"); return; }

    if (kind === "admin") {
      const role = adminUser?.role;
      if (role === "super_admin") { router.replace("/(super)/pools"); return; }
      if (role === "pool_admin") {
        if (!adminUser?.swimming_pool_id) { router.replace("/pool-apply"); return; }
        if (pool) {
          if (pool.approval_status === "pending") { router.replace("/pending"); return; }
          if (pool.approval_status === "rejected") { router.replace("/rejected"); return; }
          if (["expired", "suspended", "cancelled"].includes(pool.subscription_status)) { router.replace("/subscription-expired"); return; }
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
      <Stack.Screen name="(parent)" />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <AuthProvider>
              <RootNav />
            </AuthProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
