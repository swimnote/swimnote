import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import Colors from "@/constants/colors";

export default function SuperLayout() {
  const C = Colors.light;
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

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
      <Tabs.Screen
        name="dashboard"
        listeners={({ navigation, route }) => ({
          tabPress: (e) => { e.preventDefault(); navigation.navigate(route.name as never); },
        })}
        options={{ title: "대시보드", tabBarIcon: ({ color }) => <Feather name="grid" size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="pools"
        listeners={({ navigation, route }) => ({
          tabPress: (e) => { e.preventDefault(); navigation.navigate(route.name as never); },
        })}
        options={{ title: "수영장 승인", tabBarIcon: ({ color }) => <Feather name="map-pin" size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="subscriptions"
        listeners={({ navigation, route }) => ({
          tabPress: (e) => { e.preventDefault(); navigation.navigate(route.name as never); },
        })}
        options={{ title: "구독 관리", tabBarIcon: ({ color }) => <Feather name="credit-card" size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="users"
        listeners={({ navigation, route }) => ({
          tabPress: (e) => { e.preventDefault(); navigation.navigate(route.name as never); },
        })}
        options={{ title: "계정 관리", tabBarIcon: ({ color }) => <Feather name="users" size={22} color={color} /> }}
      />
      <Tabs.Screen name="storage-policy" options={{ href: null }} />
    </Tabs>
  );
}
