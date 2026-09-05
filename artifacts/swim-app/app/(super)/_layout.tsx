/**
 * (super)/_layout.tsx — 슈퍼관리자 스택 레이아웃
 *
 * 기존 5탭 하단 바를 제거하고 Dashboard 중심 Stack 구조로 변경.
 * 모든 기존 화면은 Global Menu 또는 Dashboard에서 접근 가능.
 * 진입 가드: super_admin / platform_admin / super_manager 만 허용.
 */
import { Stack, router } from "expo-router";
import React, { useEffect } from "react";
import { Platform } from "react-native";
import { useAuth, apiRequest } from "@/context/AuthContext";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";

const SUPER_ROLES = new Set(["super_admin", "platform_admin", "super_manager"]);

const ROLE_HOME_MAP: Record<string, string> = {
  pool_admin: "/(admin)/dashboard",
  sub_admin:  "/(admin)/dashboard",
  teacher:    "/(teacher)/today-schedule",
  parent:     "/(parent)/home",
};

async function registerSuperPushToken(token: string): Promise<void> {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") return;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) return;
    const expoPushToken = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!expoPushToken?.data) return;
    await apiRequest(token, "/push-token", {
      method: "POST",
      body: JSON.stringify({ token: expoPushToken.data }),
    });
  } catch (e) {
    console.warn("[super-layout] 푸시 토큰 등록 실패:", e);
  }
}

export default function SuperLayout() {
  const { kind, isLoading, adminUser, token } = useAuth();

  // 슈퍼관리자 푸시 토큰 등록 (서버 성능 알림 수신용)
  useEffect(() => {
    if (!token || Platform.OS === "web") return;
    registerSuperPushToken(token);
  }, [token]);

  useEffect(() => {
    if (isLoading || !kind) return;

    if (kind === "parent") {
      router.replace("/(parent)/home" as any);
      return;
    }

    if (kind === "admin") {
      const role = adminUser?.role;
      if (!role) return;
      if (SUPER_ROLES.has(role)) return;
      const home = ROLE_HOME_MAP[role] ?? "/";
      router.replace(home as any);
    }
  }, [isLoading, kind, adminUser?.role]);

  return (
    <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
      {/* ─── 루트: 대시보드 ─── */}
      <Stack.Screen name="dashboard" />

      {/* ─── 글로벌 메뉴 (신규) ─── */}
      <Stack.Screen name="global-menu" />

      {/* ─── 기존 그룹 허브 화면 (레거시 접근 경로 유지) ─── */}
      <Stack.Screen name="op-group" />
      <Stack.Screen name="protect-group" />
      <Stack.Screen name="audit-group" />
      <Stack.Screen name="support-group" />
      <Stack.Screen name="more" />

      {/* ─── 수영장·운영 관리 ─── */}
      <Stack.Screen name="pools" />
      <Stack.Screen name="operator-detail" />
      <Stack.Screen name="subscriptions" />
      <Stack.Screen name="subscription-products" />
      <Stack.Screen name="storage" />
      <Stack.Screen name="storage-policy" />

      {/* ─── 보호·통제 ─── */}
      <Stack.Screen name="kill-switch" />
      <Stack.Screen name="backup" />
      <Stack.Screen name="readonly-control" />
      <Stack.Screen name="feature-flags" />
      <Stack.Screen name="sync" />
      <Stack.Screen name="db-status" />

      {/* ─── 감사·리스크 ─── */}
      <Stack.Screen name="op-logs" />
      <Stack.Screen name="risk-center" />
      <Stack.Screen name="security" />

      {/* ─── 정책·지원 ─── */}
      <Stack.Screen name="policy" />
      <Stack.Screen name="support" />
      <Stack.Screen name="support-general" />
      <Stack.Screen name="inquiries" />
      <Stack.Screen name="pool-notices" />

      {/* ─── 콘텐츠 ─── */}
      <Stack.Screen name="notices" />
      <Stack.Screen name="ads" />
      <Stack.Screen name="strip-banner" />

      {/* ─── 매출·결제 ─── */}
      <Stack.Screen name="revenue-analytics" />
      <Stack.Screen name="billing-analytics" />
      <Stack.Screen name="cost-analytics" />

      {/* ─── 시스템 ─── */}
      <Stack.Screen name="system-status" />

      {/* ─── 설정 ─── */}
      <Stack.Screen name="security-settings" />
      <Stack.Screen name="users" />

      {/* ─── 마케팅 (WP12) ─── */}
      <Stack.Screen name="marketing" />

      {/* ─── 데이터 무결성 검사 (WP13) ─── */}
      <Stack.Screen name="integrity" />
    </Stack>
  );
}
