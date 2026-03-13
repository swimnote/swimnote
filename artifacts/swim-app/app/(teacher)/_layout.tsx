import { Feather } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { Platform } from "react-native";
import Colors from "@/constants/colors";
import { useBrand } from "@/context/BrandContext";

export default function TeacherLayout() {
  const { themeColor } = useBrand();
  const C = Colors.light;
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
      <Tabs.Screen name="classes"    options={{ title: "내 반",    tabBarIcon: ({ color }) => <Feather name="layers"       size={22} color={color} /> }} />
      <Tabs.Screen name="attendance" options={{ title: "출결",     tabBarIcon: ({ color }) => <Feather name="check-square" size={22} color={color} /> }} />
      <Tabs.Screen name="diary"      options={{ title: "수영일지", tabBarIcon: ({ color }) => <Feather name="book"         size={22} color={color} /> }} />
      <Tabs.Screen name="photos"     options={{ title: "사진",     tabBarIcon: ({ color }) => <Feather name="camera"       size={22} color={color} /> }} />
    </Tabs>
  );
}
