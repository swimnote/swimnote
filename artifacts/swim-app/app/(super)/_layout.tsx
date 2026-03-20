import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import Colors from "@/constants/colors";
import { emitTabReset } from "@/utils/tabReset";

export default function SuperLayout() {
  const C = Colors.light;
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  function makeTabListener(tabName: string) {
    return ({ navigation }: { navigation: any; route: any }) => ({
      tabPress: (e: any) => {
        e.preventDefault();
        const state = navigation.getState();
        const currentRoute = state.routes[state.index]?.name;
        if (currentRoute === tabName) {
          emitTabReset(tabName);
        } else {
          navigation.navigate(tabName);
        }
      },
    });
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#7C3AED",
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
      {/* ─── 5개 메인 탭 ─── */}
      <Tabs.Screen
        name="dashboard"
        listeners={makeTabListener("dashboard")}
        options={{ title: "홈", tabBarIcon: ({ color }) => <Feather name="home" size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="pools"
        listeners={makeTabListener("pools")}
        options={{ title: "수영장", tabBarIcon: ({ color }) => <Feather name="map-pin" size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="subscriptions"
        listeners={makeTabListener("subscriptions")}
        options={{ title: "구독", tabBarIcon: ({ color }) => <Feather name="credit-card" size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="users"
        listeners={makeTabListener("users")}
        options={{ title: "운영", tabBarIcon: ({ color }) => <Feather name="tool" size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="more"
        listeners={makeTabListener("more")}
        options={{ title: "더보기", tabBarIcon: ({ color }) => <Feather name="menu" size={22} color={color} /> }}
      />

      {/* ─── 숨김 화면들 ─── */}
      <Tabs.Screen name="storage-policy" options={{ href: null }} />
      <Tabs.Screen name="sync" options={{ href: null }} />
    </Tabs>
  );
}
