import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Tabs, router } from "expo-router";
import React, { useEffect } from "react";
import { Platform, StyleSheet, View } from "react-native";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { emitTabReset } from "@/utils/tabReset";
import { FeedbackTemplateProvider } from "@/context/FeedbackTemplateContext";

const ADMIN_ONLY_ROLES = ["pool_admin", "super_admin", "platform_admin"];

export default function TeacherLayout() {
  const { themeColor } = useBrand();
  const { kind, isLoading, adminUser } = useAuth();
  const C = Colors.light;

  // 권한 보호: 관리자 전용 역할로 선생님 화면에 직접 접근하는 경우만 리다이렉트
  // 역할 전환 직후 state 업데이트 타이밍 이슈 방지를 위해 200ms 딜레이 사용
  useEffect(() => {
    if (isLoading || !kind) return;
    const role = adminUser?.role;
    if (!role) return;
    // role이 명시적으로 "teacher"면 OK (전환 성공)
    if (role === "teacher") return;
    // 순수 관리자 역할이면 짧은 딜레이 후 관리자 홈으로
    // (딜레이 중 state가 "teacher"로 바뀌면 cleanup으로 취소됨)
    if (kind === "admin" && ADMIN_ONLY_ROLES.includes(role)) {
      const timer = setTimeout(() => {
        router.replace("/(admin)/dashboard" as any);
      }, 200);
      return () => clearTimeout(timer);
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
        tabBarInactiveTintColor: C.tabIconDefault,
        headerShown: false,
        tabBarStyle: {
          display: "none",
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
      <Tabs.Screen name="attendance"        options={{ href: null }} />
      <Tabs.Screen name="diary"             options={{ href: null }} />
      <Tabs.Screen name="diary-index"       options={{ href: null }} />
      <Tabs.Screen name="diary-unwritten"   options={{ href: null }} />
      <Tabs.Screen name="photos"           options={{ href: null }} />
      <Tabs.Screen name="student-detail"   options={{ href: null }} />
      <Tabs.Screen name="feedback-custom"  options={{ href: null }} />
      <Tabs.Screen name="makeups"          options={{ href: null }} />
      <Tabs.Screen name="my-info"          options={{ href: null }} />
      <Tabs.Screen name="students"         options={{ href: null }} />
    </Tabs>
    </FeedbackTemplateProvider>
  );
}
