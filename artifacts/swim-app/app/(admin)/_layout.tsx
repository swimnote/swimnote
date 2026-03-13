import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import React from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";
import Colors from "@/constants/colors";

export default function AdminLayout() {
  const C = Colors.light;
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: C.tint,
        tabBarInactiveTintColor: C.tabIconDefault,
        headerShown: false,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : "#fff",
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: C.border,
          elevation: 0,
          height: isWeb ? 84 : undefined,
        },
        tabBarLabelStyle: { fontFamily: "Inter_500Medium", fontSize: 11 },
        tabBarBackground: () => isIOS ? (
          <BlurView intensity={100} tint="light" style={StyleSheet.absoluteFill} />
        ) : isWeb ? (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: "#fff" }]} />
        ) : null,
      }}
    >
      <Tabs.Screen name="dashboard" options={{ title: "대시보드", tabBarIcon: ({ color }) => <Feather name="grid" size={22} color={color} /> }} />
      <Tabs.Screen name="members" options={{ title: "회원", tabBarIcon: ({ color }) => <Feather name="users" size={22} color={color} /> }} />
      <Tabs.Screen name="classes" options={{ title: "반관리", tabBarIcon: ({ color }) => <Feather name="layers" size={22} color={color} /> }} />
      <Tabs.Screen name="attendance" options={{ title: "출결", tabBarIcon: ({ color }) => <Feather name="check-square" size={22} color={color} /> }} />
      <Tabs.Screen name="parents" options={{ title: "학부모", tabBarIcon: ({ color }) => <Feather name="user-check" size={22} color={color} /> }} />
      <Tabs.Screen name="notices" options={{ title: "공지", tabBarIcon: ({ color }) => <Feather name="bell" size={22} color={color} /> }} />
    </Tabs>
  );
}
