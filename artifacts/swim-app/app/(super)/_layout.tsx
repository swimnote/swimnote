/**
 * (super)/_layout.tsx — 슈퍼관리자 Stack 레이아웃
 */
import { Stack } from "expo-router";
import React from "react";

export default function SuperLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
      <Stack.Screen name="dashboard" />
      <Stack.Screen name="pools" />
      <Stack.Screen name="operator-detail" />
      <Stack.Screen name="subscriptions" />
      <Stack.Screen name="storage" />
      <Stack.Screen name="storage-policy" />
      <Stack.Screen name="kill-switch" />
      <Stack.Screen name="policy" />
      <Stack.Screen name="op-logs" />
      <Stack.Screen name="support" />
      <Stack.Screen name="risk-center" />
      <Stack.Screen name="users" />
      <Stack.Screen name="more" />
      <Stack.Screen name="sync" />
      <Stack.Screen name="feature-flags" />
    </Stack>
  );
}
