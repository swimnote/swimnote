import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import Colors from "@/constants/colors";
import { useBrand } from "@/context/BrandContext";
import { emitTabReset } from "@/utils/tabReset";

export default function TeacherLayout() {
  const { themeColor } = useBrand();
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
      {/* ─── 5개 메인 탭 ─── */}
      <Tabs.Screen
        name="today-schedule"
        listeners={makeTabListener("today-schedule")}
        options={{ title: "홈", tabBarIcon: ({ color }) => <Feather name="home" size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="my-schedule"
        listeners={makeTabListener("my-schedule")}
        options={{ title: "수업", tabBarIcon: ({ color }) => <Feather name="layers" size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="messenger"
        listeners={makeTabListener("messenger")}
        options={{ title: "메신저", tabBarIcon: ({ color }) => <Feather name="send" size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="revenue"
        listeners={makeTabListener("revenue")}
        options={{ title: "정산", tabBarIcon: ({ color }) => <Feather name="dollar-sign" size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="settings"
        listeners={makeTabListener("settings")}
        options={{ title: "더보기", tabBarIcon: ({ color }) => <Feather name="menu" size={22} color={color} /> }}
      />

      {/* ─── 숨김 화면들 (수업 탭 내에서 router.push로 접근) ─── */}
      <Tabs.Screen name="attendance"     options={{ href: null }} />
      <Tabs.Screen name="diary"          options={{ href: null }} />
      <Tabs.Screen name="photos"         options={{ href: null }} />
      <Tabs.Screen name="student-detail" options={{ href: null }} />
    </Tabs>
  );
}
