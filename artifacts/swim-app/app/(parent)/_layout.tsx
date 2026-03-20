/**
 * 학부모 레이아웃 — Stack 기반 (탭바 없음)
 * 모든 화면은 home.tsx에서 아이콘으로 진입하며,
 * 뒤로가기/홈 버튼은 ParentScreenHeader에서 처리
 */
import { Stack } from "expo-router";
import React from "react";
import { ParentProvider } from "@/context/ParentContext";
import { useAuth } from "@/context/AuthContext";

function ParentStack() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
      <Stack.Screen name="home" />
      <Stack.Screen name="notices" />
      <Stack.Screen name="diary" />
      <Stack.Screen name="photos" />
      <Stack.Screen name="attendance-history" />
      <Stack.Screen name="program" />
      <Stack.Screen name="messages" />
      <Stack.Screen name="more" />
      <Stack.Screen name="children" />
      <Stack.Screen name="parent-profile" />
      <Stack.Screen name="child-profile" />
      <Stack.Screen name="level" />
      <Stack.Screen name="attendance" />
      <Stack.Screen name="student-detail" />
      <Stack.Screen name="notice-detail" />
      <Stack.Screen name="swim-diary" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="shopping" />
    </Stack>
  );
}

export default function ParentLayout() {
  const { kind, isLoading } = useAuth();
  if (isLoading || kind !== "parent") return null;

  return (
    <ParentProvider>
      <ParentStack />
    </ParentProvider>
  );
}
