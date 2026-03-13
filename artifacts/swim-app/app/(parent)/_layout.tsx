import { Feather } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

export default function ParentLayout() {
  return (
    <Tabs screenOptions={{
      tabBarActiveTintColor: C.success,
      tabBarInactiveTintColor: C.tabIconDefault,
      headerShown: false,
      tabBarStyle: {
        backgroundColor: "#fff",
        borderTopWidth: 1,
        borderTopColor: C.border,
        elevation: 0,
        height: Platform.OS === "web" ? 84 : 60,
      },
      tabBarLabelStyle: { fontFamily: "Inter_500Medium", fontSize: 11 },
    }}>
      <Tabs.Screen name="children" options={{ title: "자녀 목록", tabBarIcon: ({ color }) => <Feather name="users" size={22} color={color} /> }} />
      <Tabs.Screen name="notices" options={{ title: "공지사항", tabBarIcon: ({ color }) => <Feather name="bell" size={22} color={color} /> }} />
      <Tabs.Screen name="student-detail" options={{ href: null }} />
    </Tabs>
  );
}
