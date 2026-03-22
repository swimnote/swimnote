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
      <Stack.Screen name="subscription-products" />
      <Stack.Screen name="storage" />
      <Stack.Screen name="storage-policy" />
      <Stack.Screen name="kill-switch" />
      <Stack.Screen name="backup" />
      <Stack.Screen name="readonly-control" />
      <Stack.Screen name="feature-flags" />
      <Stack.Screen name="policy" />
      <Stack.Screen name="support" />
      <Stack.Screen name="invite-sms" />
      <Stack.Screen name="op-logs" />
      <Stack.Screen name="risk-center" />
      <Stack.Screen name="security" />
      <Stack.Screen name="security-settings" />
      <Stack.Screen name="op-group" />
      <Stack.Screen name="support-group" />
      <Stack.Screen name="protect-group" />
      <Stack.Screen name="audit-group" />
      <Stack.Screen name="sms-billing" />
      <Stack.Screen name="users" />
      <Stack.Screen name="more" />
      <Stack.Screen name="sync" />
    </Stack>
  );
}
