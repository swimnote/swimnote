/**
 * (super)/_layout.tsx — 슈퍼관리자 Stack 레이아웃
 *
 * 진입 가드: super_admin / platform_admin / super_manager 만 허용.
 * 그 외 역할이 직접 접근 시 올바른 홈으로 강제 리다이렉트.
 */
import { Stack, router } from "expo-router";
import React, { useEffect } from "react";
import { useAuth } from "@/context/AuthContext";

const SUPER_ROLES = new Set(["super_admin", "platform_admin", "super_manager"]);

const ROLE_HOME_MAP: Record<string, string> = {
  pool_admin: "/(admin)/dashboard",
  sub_admin:  "/(admin)/dashboard",
  teacher:    "/(teacher)/today-schedule",
  parent:     "/(parent)/home",
};

export default function SuperLayout() {
  const { kind, isLoading, adminUser } = useAuth();

  // 권한 보호: 슈퍼관리자 계열 이외 계정이 (super) 영역 진입 시 차단
  useEffect(() => {
    if (isLoading || !kind) return;

    if (kind === "parent") {
      router.replace("/(parent)/home" as any);
      return;
    }

    if (kind === "admin") {
      const role = adminUser?.role;
      if (!role) return;
      if (SUPER_ROLES.has(role)) return; // OK

      // 슈퍼가 아닌 관리자가 진입했을 경우 올바른 홈으로 보냄
      const home = ROLE_HOME_MAP[role] ?? "/";
      router.replace(home as any);
    }
  }, [isLoading, kind, adminUser?.role]);

  return (
    <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
      <Stack.Screen name="dashboard" />
      <Stack.Screen name="pools" />
      <Stack.Screen name="operator-detail" />
      <Stack.Screen name="subscriptions" />
      <Stack.Screen name="subscription-products" />
      <Stack.Screen name="storage" />
      <Stack.Screen name="storage-policy" />
      <Stack.Screen name="kill-switch" />
      <Stack.Screen name="backup" />
      <Stack.Screen name="readonly-control" />
      <Stack.Screen name="feature-flags" />
      <Stack.Screen name="policy" />
      <Stack.Screen name="support" />
      <Stack.Screen name="op-logs" />
      <Stack.Screen name="risk-center" />
      <Stack.Screen name="security" />
      <Stack.Screen name="security-settings" />
      <Stack.Screen name="op-group" />
      <Stack.Screen name="support-group" />
      <Stack.Screen name="protect-group" />
      <Stack.Screen name="audit-group" />
      <Stack.Screen name="users" />
      <Stack.Screen name="more" />
      <Stack.Screen name="sync" />
      <Stack.Screen name="revenue-analytics" />
      <Stack.Screen name="cost-analytics" />
      <Stack.Screen name="billing-analytics" />
      <Stack.Screen name="system-status" />
      <Stack.Screen name="ads" />
      <Stack.Screen name="notices" />
      <Stack.Screen name="db-status" />
    </Stack>
  );
}
