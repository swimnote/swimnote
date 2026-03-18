import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import Colors from "@/constants/colors";
import { useBrand } from "@/context/BrandContext";

const C = Colors.light;

export default function AdminLayout() {
  const { themeColor } = useBrand();
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
        tabBarBackground: () => isIOS ? (
          <BlurView intensity={100} tint="light" style={StyleSheet.absoluteFill} />
        ) : isWeb ? (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: "#fff" }]} />
        ) : null,
      }}
    >
      {/* ─── 6개 메인 탭 (탭 클릭 시 항상 루트로 리셋) ─── */}
      <Tabs.Screen
        name="dashboard"
        listeners={({ navigation, route }) => ({
          tabPress: (e) => { e.preventDefault(); navigation.navigate(route.name as never); },
        })}
        options={{ title: "홈", tabBarIcon: ({ color }) => <Feather name="home" size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="people"
        listeners={({ navigation, route }) => ({
          tabPress: (e) => { e.preventDefault(); navigation.navigate(route.name as never); },
        })}
        options={{ title: "사람", tabBarIcon: ({ color }) => <Feather name="users" size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="classes"
        listeners={({ navigation, route }) => ({
          tabPress: (e) => { e.preventDefault(); navigation.navigate(route.name as never); },
        })}
        options={{ title: "수업", tabBarIcon: ({ color }) => <Feather name="layers" size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="messenger"
        listeners={({ navigation, route }) => ({
          tabPress: (e) => { e.preventDefault(); navigation.navigate(route.name as never); },
        })}
        options={{ title: "메신저", tabBarIcon: ({ color }) => <Feather name="send" size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="billing"
        listeners={({ navigation, route }) => ({
          tabPress: (e) => { e.preventDefault(); navigation.navigate(route.name as never); },
        })}
        options={{ title: "정산", tabBarIcon: ({ color }) => <Feather name="credit-card" size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="more"
        listeners={({ navigation, route }) => ({
          tabPress: (e) => { e.preventDefault(); navigation.navigate(route.name as never); },
        })}
        options={{ title: "더보기", tabBarIcon: ({ color }) => <Feather name="menu" size={22} color={color} /> }}
      />

      {/* ─── 숨김 화면들 (탭 없이 push/navigate로 접근) ─── */}
      <Tabs.Screen name="communication"     options={{ href: null }} />
      <Tabs.Screen name="members"           options={{ href: null }} />
      <Tabs.Screen name="community"         options={{ href: null }} />
      <Tabs.Screen name="approvals"         options={{ href: null }} />
      <Tabs.Screen name="attendance"        options={{ href: null }} />
      <Tabs.Screen name="parents"           options={{ href: null }} />
      <Tabs.Screen name="notices"           options={{ href: null }} />
      <Tabs.Screen name="mode"              options={{ href: null }} />
      <Tabs.Screen name="diary-write"       options={{ href: null }} />
      <Tabs.Screen name="photo-upload"      options={{ href: null }} />
      <Tabs.Screen name="teachers"          options={{ href: null }} />
      <Tabs.Screen name="pool-settings"     options={{ href: null }} />
      <Tabs.Screen name="notifications"     options={{ href: null }} />
      <Tabs.Screen name="branches"          options={{ href: null }} />
      <Tabs.Screen name="withdrawn-members" options={{ href: null }} />
      <Tabs.Screen name="branding"          options={{ href: null }} />
      <Tabs.Screen name="member-detail"     options={{ href: null }} />
      <Tabs.Screen name="teacher-hub"       options={{ href: null }} />
      <Tabs.Screen name="makeups"           options={{ href: null }} />
      <Tabs.Screen name="holidays"          options={{ href: null }} />
    </Tabs>
  );
}
