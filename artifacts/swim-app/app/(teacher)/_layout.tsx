import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import Colors from "@/constants/colors";
import { useBrand } from "@/context/BrandContext";

export default function TeacherLayout() {
  const { themeColor } = useBrand();
  const C = Colors.light;
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: themeColor,
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
        tabBarBackground: () =>
          isIOS ? (
            <BlurView intensity={100} tint="light" style={StyleSheet.absoluteFill} />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: "#fff" }]} />
          ) : null,
      }}
    >
      <Tabs.Screen name="today-schedule" options={{ title: "오늘 스케줄", tabBarIcon: ({ color }) => <Feather name="sun"          size={22} color={color} /> }} />
      <Tabs.Screen name="my-schedule"    options={{ title: "수업 관리",   tabBarIcon: ({ color }) => <Feather name="layers"       size={22} color={color} /> }} />
      <Tabs.Screen name="attendance"     options={{ title: "출결 관리",   tabBarIcon: ({ color }) => <Feather name="check-square" size={22} color={color} /> }} />
      <Tabs.Screen name="diary"          options={{ title: "수영일지",    tabBarIcon: ({ color }) => <Feather name="book"         size={22} color={color} /> }} />
      <Tabs.Screen name="photos"         options={{ title: "사진영상",    tabBarIcon: ({ color }) => <Feather name="camera"       size={22} color={color} /> }} />
      <Tabs.Screen name="messenger"      options={{ title: "메신저",      tabBarIcon: ({ color }) => <Feather name="send"         size={22} color={color} /> }} />
      <Tabs.Screen name="revenue"        options={{ title: "매출계산기",  tabBarIcon: ({ color }) => <Feather name="dollar-sign"  size={22} color={color} /> }} />
      <Tabs.Screen name="settings"       options={{ title: "관리설정",    tabBarIcon: ({ color }) => <Feather name="settings"     size={22} color={color} /> }} />
      <Tabs.Screen name="student-detail" options={{ href: null }} />
    </Tabs>
  );
}
