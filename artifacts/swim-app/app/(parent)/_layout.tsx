import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import Colors from "@/constants/colors";
import { useBrand } from "@/context/BrandContext";
import { useAuth } from "@/context/AuthContext";
import { ParentProvider } from "@/context/ParentContext";
import { emitTabReset } from "@/utils/tabReset";

const C = Colors.light;

function TabBarIcon({ name, color }: { name: any; color: string }) {
  return <Feather name={name} size={22} color={color} />;
}

function ParentTabs() {
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
        name="home"
        listeners={makeTabListener("home")}
        options={{ title: "홈", tabBarIcon: ({ color }) => <TabBarIcon name="home" color={color} /> }}
      />
      <Tabs.Screen
        name="diary"
        listeners={makeTabListener("diary")}
        options={{ title: "수업피드백", tabBarIcon: ({ color }) => <TabBarIcon name="book-open" color={color} /> }}
      />
      <Tabs.Screen
        name="photos"
        listeners={makeTabListener("photos")}
        options={{ title: "앨범", tabBarIcon: ({ color }) => <TabBarIcon name="image" color={color} /> }}
      />
      <Tabs.Screen
        name="attendance-history"
        listeners={makeTabListener("attendance-history")}
        options={{ title: "출결", tabBarIcon: ({ color }) => <TabBarIcon name="calendar" color={color} /> }}
      />
      <Tabs.Screen
        name="more"
        listeners={makeTabListener("more")}
        options={{ title: "더보기", tabBarIcon: ({ color }) => <TabBarIcon name="menu" color={color} /> }}
      />

      {/* ─── 숨김 화면들 ─── */}
      <Tabs.Screen name="shopping"      options={{ href: null }} />
      <Tabs.Screen name="children"      options={{ href: null }} />
      <Tabs.Screen name="notices"       options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
      <Tabs.Screen name="attendance"    options={{ href: null }} />
      <Tabs.Screen name="student-detail" options={{ href: null }} />
      <Tabs.Screen name="notice-detail" options={{ href: null }} />
      <Tabs.Screen name="swim-diary"    options={{ href: null }} />
      <Tabs.Screen name="level"         options={{ href: null }} />
    </Tabs>
  );
}

export default function ParentLayout() {
  const { kind, isLoading } = useAuth();

  if (isLoading || kind !== "parent") {
    return null;
  }

  return (
    <ParentProvider>
      <ParentTabs />
    </ParentProvider>
  );
}
