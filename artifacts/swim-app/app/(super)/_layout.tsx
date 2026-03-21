/**
 * (super)/_layout.tsx — 슈퍼관리자 레이아웃
 * 하단 탭 없음 → Stack 네비게이션
 */
import { Stack } from "expo-router";
import React from "react";

export default function SuperLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
      <Stack.Screen name="dashboard" />
      <Stack.Screen name="pools" />
      <Stack.Screen name="operators" />
      <Stack.Screen name="subscriptions" />
      <Stack.Screen name="storage-policy" />
      <Stack.Screen name="storage" />
      <Stack.Screen name="kill-switch" />
      <Stack.Screen name="policy" />
      <Stack.Screen name="op-logs" />
      <Stack.Screen name="users" />
      <Stack.Screen name="more" />
      <Stack.Screen name="sync" />
    </Stack>
  );
}
