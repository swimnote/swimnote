import { Feather } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { Platform } from "react-native";
import Colors from "@/constants/colors";
import { useBrand } from "@/context/BrandContext";
import { ParentProvider } from "@/context/ParentContext";

const C = Colors.light;

function TabBarIcon({ name, color }: { name: any; color: string }) {
  return <Feather name={name} size={22} color={color} />;
}

function ParentTabs() {
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
        paddingBottom: Platform.OS === "ios" ? 8 : 4,
      },
      tabBarLabelStyle: { fontFamily: "Inter_500Medium", fontSize: 11 },
    }}>
      <Tabs.Screen
        name="index"
        options={{ title: "홈", tabBarIcon: ({ color }) => <TabBarIcon name="home" color={color} /> }}
      />
      <Tabs.Screen
        name="diary"
        options={{ title: "수업피드백", tabBarIcon: ({ color }) => <TabBarIcon name="book-open" color={color} /> }}
      />
      <Tabs.Screen
        name="photos"
        options={{ title: "앨범", tabBarIcon: ({ color }) => <TabBarIcon name="image" color={color} /> }}
      />
      <Tabs.Screen
        name="attendance-history"
        options={{ title: "출결", tabBarIcon: ({ color }) => <TabBarIcon name="calendar" color={color} /> }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: "더보기", tabBarIcon: ({ color }) => <TabBarIcon name="menu" color={color} /> }}
      />
      {/* 숨김 화면들 */}
      <Tabs.Screen name="children" options={{ href: null }} />
      <Tabs.Screen name="notices" options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
      <Tabs.Screen name="attendance" options={{ href: null }} />
      <Tabs.Screen name="student-detail" options={{ href: null }} />
      <Tabs.Screen name="notice-detail" options={{ href: null }} />
      <Tabs.Screen name="swim-diary" options={{ href: null }} />
      <Tabs.Screen name="level" options={{ href: null }} />
    </Tabs>
  );
}

export default function ParentLayout() {
  return (
    <ParentProvider>
      <ParentTabs />
    </ParentProvider>
  );
}
