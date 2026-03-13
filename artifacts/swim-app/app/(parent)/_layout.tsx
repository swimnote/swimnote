import { Feather } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { Platform } from "react-native";
import Colors from "@/constants/colors";
import { useBrand } from "@/context/BrandContext";

const C = Colors.light;

export default function ParentLayout() {
  const { themeColor } = useBrand();
  return (
    <Tabs screenOptions={{
      tabBarActiveTintColor: themeColor,
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
      <Tabs.Screen name="notifications" options={{ title: "알림", tabBarIcon: ({ color }) => <Feather name="inbox" size={22} color={color} /> }} />
      {/* 숨김 화면들 */}
      <Tabs.Screen name="attendance" options={{ href: null }} />
      <Tabs.Screen name="student-detail" options={{ href: null }} />
      <Tabs.Screen name="attendance-history" options={{ href: null }} />
      <Tabs.Screen name="notice-detail" options={{ href: null }} />
      <Tabs.Screen name="photos" options={{ href: null }} />
      <Tabs.Screen name="swim-diary" options={{ href: null }} />
    </Tabs>
  );
}
