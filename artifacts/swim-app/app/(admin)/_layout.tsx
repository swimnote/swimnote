import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import Colors from "@/constants/colors";
import { useBrand } from "@/context/BrandContext";
import { emitTabReset } from "@/utils/tabReset";

const C = Colors.light;

export default function AdminLayout() {
  const { themeColor } = useBrand();
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
      {/* ─── 6개 메인 탭 ─── */}
      <Tabs.Screen
        name="dashboard"
        listeners={makeTabListener("dashboard")}
        options={{ title: "홈", tabBarIcon: ({ color }) => <Feather name="home" size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="people"
        listeners={makeTabListener("people")}
        options={{ title: "인원관리", tabBarIcon: ({ color }) => <Feather name="users" size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="classes"
        listeners={makeTabListener("classes")}
        options={{ title: "수업", tabBarIcon: ({ color }) => <Feather name="layers" size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="messenger"
        listeners={makeTabListener("messenger")}
        options={{ title: "메신저", tabBarIcon: ({ color }) => <Feather name="send" size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="admin-revenue"
        listeners={makeTabListener("admin-revenue")}
        options={{ title: "매출관리", tabBarIcon: ({ color }) => <Feather name="trending-up" size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="more"
        listeners={makeTabListener("more")}
        options={{ title: "더보기", tabBarIcon: ({ color }) => <Feather name="menu" size={22} color={color} /> }}
      />

      {/* ─── 숨김 화면들 (탭 없이 push/navigate로 접근) ─── */}
      <Tabs.Screen name="billing"           options={{ href: null }} />
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
      <Tabs.Screen name="people-teachers"   options={{ href: null }} />
      <Tabs.Screen name="people-pending"    options={{ href: null }} />
      <Tabs.Screen name="makeups"                    options={{ href: null }} />
      <Tabs.Screen name="holidays"                   options={{ href: null }} />
      <Tabs.Screen name="class-management"           options={{ href: null }} />
      <Tabs.Screen name="data-management"            options={{ href: null }} />
      <Tabs.Screen name="data-storage-overview"      options={{ href: null }} />
      <Tabs.Screen name="data-storage-by-account"    options={{ href: null }} />
      <Tabs.Screen name="data-storage-by-category"   options={{ href: null }} />
      <Tabs.Screen name="data-delete"                options={{ href: null }} />
      <Tabs.Screen name="data-event-logs"            options={{ href: null }} />
    </Tabs>
  );
}
