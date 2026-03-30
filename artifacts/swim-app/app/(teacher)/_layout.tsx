import { Home, Layers, Send, Settings, Users } from "lucide-react-native";
import { BlurView } from "expo-blur";
import { Tabs, router } from "expo-router";
import React, { useEffect } from "react";
import { Platform, StyleSheet, View } from "react-native";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { emitTabReset } from "@/utils/tabReset";
import { FeedbackTemplateProvider } from "@/context/FeedbackTemplateContext";

const SUPER_ROLES = new Set(["super_admin", "platform_admin", "super_manager"]);
const POOL_ADMIN_ROLES = new Set(["pool_admin", "sub_admin"]);

export default function TeacherLayout() {
  const { themeColor } = useBrand();
  const { kind, isLoading, adminUser } = useAuth();
  const C = Colors.light;

  // 권한 보호: teacher 이외 역할이 teacher 화면에 직접 접근 시 올바른 홈으로 리다이렉트
  // 역할별 라우팅 규칙:
  //   super 계열     → /(super)/dashboard
  //   pool_admin 등  → /(admin)/dashboard
  //   teacher        → OK (통과)
  // 딜레이: 역할 전환 직후 state 업데이트 타이밍 이슈 방지
  useEffect(() => {
    if (isLoading || !kind) return;
    const role = adminUser?.role;
    if (!role) return;
    if (role === "teacher") return; // OK

    if (kind === "admin") {
      if (SUPER_ROLES.has(role)) {
        const timer = setTimeout(() => {
          router.replace("/(super)/dashboard" as any);
        }, 200);
        return () => clearTimeout(timer);
      }
      if (POOL_ADMIN_ROLES.has(role)) {
        const timer = setTimeout(() => {
          router.replace("/(admin)/dashboard" as any);
        }, 200);
        return () => clearTimeout(timer);
      }
    }
  }, [isLoading, kind, adminUser?.role]);

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
    <FeedbackTemplateProvider>
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: themeColor,
        tabBarInactiveTintColor: C.text,
        headerShown: false,
        tabBarStyle: {
          height: 72,
          backgroundColor: "transparent",
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: "#E2E8F0",
          paddingBottom: 12,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontFamily: "Pretendard-Regular", fontSize: 10, marginTop: 2 },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView intensity={100} tint="light" style={StyleSheet.absoluteFill} />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: "#fff" }]} />
          ),
      }}
    >
      {/* ─── 5개 메인 탭 ─── */}
      <Tabs.Screen
        name="today-schedule"
        listeners={makeTabListener("today-schedule")}
        options={{ title: "홈", tabBarIcon: ({ color }) => <Home size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="my-schedule"
        listeners={makeTabListener("my-schedule")}
        options={{ title: "수업관리", tabBarIcon: ({ color }) => <Layers size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="students"
        listeners={makeTabListener("students")}
        options={{ title: "수강관리", tabBarIcon: ({ color }) => <Users size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="messenger"
        listeners={makeTabListener("messenger")}
        options={{ title: "메신저", tabBarIcon: ({ color }) => <Send size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="settings"
        listeners={makeTabListener("settings")}
        options={{ title: "설정", tabBarIcon: ({ color }) => <Settings size={22} color={color} /> }}
      />

      {/* ─── 숨김 화면들 (router.push로 접근) ─── */}
      <Tabs.Screen name="attendance"       options={{ href: null }} />
      <Tabs.Screen name="diary"            options={{ href: null }} />
      <Tabs.Screen name="diary-index"      options={{ href: null }} />
      <Tabs.Screen name="diary-unwritten"  options={{ href: null }} />
      <Tabs.Screen name="photos"           options={{ href: null }} />
      <Tabs.Screen name="student-detail"   options={{ href: null }} />
      <Tabs.Screen name="feedback-custom"  options={{ href: null }} />
      <Tabs.Screen name="makeups"          options={{ href: null }} />
      <Tabs.Screen name="my-info"          options={{ href: null }} />
      <Tabs.Screen name="revenue"          options={{ href: null }} />
      <Tabs.Screen name="notices"          options={{ href: null }} />
    </Tabs>
    </FeedbackTemplateProvider>
  );
}
