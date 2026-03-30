import { Home, Layers, Send, Settings, Users } from "lucide-react-native";
import { Tabs, router } from "expo-router";
import React, { useEffect } from "react";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { emitTabReset } from "@/utils/tabReset";

const C = Colors.light;

export default function AdminLayout() {
  const { themeColor } = useBrand();
  const { kind, isLoading, adminUser } = useAuth();

  useEffect(() => {
    if (isLoading || !kind) return;
    if (kind === "admin") {
      const role = adminUser?.role;
      if (role === "super_admin" || role === "platform_admin" || role === "super_manager") {
        router.replace("/(super)/dashboard" as any);
        return;
      }
      if (role === "teacher") {
        router.replace("/(teacher)/today-schedule" as any);
        return;
      }
    }
  }, [isLoading, kind, adminUser?.role]);

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
          backgroundColor: "#fff",
          borderTopWidth: 1,
          borderTopColor: C.border,
          height: 60,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 10, fontFamily: "Pretendard-Regular" },
      }}
    >
      {/* ─── 5개 메인 탭 ─── */}
      <Tabs.Screen
        name="dashboard"
        listeners={makeTabListener("dashboard")}
        options={{ title: "홈", tabBarIcon: ({ color }) => <Home size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="class-hub"
        listeners={makeTabListener("class-hub")}
        options={{ title: "수업관리", tabBarIcon: ({ color }) => <Layers size={22} color={color} /> }}
      />
      <Tabs.Screen name="classes" options={{ href: null }} />
      <Tabs.Screen
        name="people"
        listeners={makeTabListener("people")}
        options={{ title: "회원관리", tabBarIcon: ({ color }) => <Users size={22} color={color} /> }}
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

      {/* ─── 숨김 화면들 (탭 없이 push/navigate로 접근) ─── */}
      <Tabs.Screen name="more"                    options={{ href: null }} />
      <Tabs.Screen name="admin-revenue"           options={{ href: null }} />
      <Tabs.Screen name="billing"                 options={{ href: null }} />
      <Tabs.Screen name="communication"           options={{ href: null }} />
      <Tabs.Screen name="members"                 options={{ href: null }} />
      <Tabs.Screen name="community"               options={{ href: null }} />
      <Tabs.Screen name="approvals"               options={{ href: null }} />
      <Tabs.Screen name="attendance"              options={{ href: null }} />
      <Tabs.Screen name="parents"                 options={{ href: null }} />
      <Tabs.Screen name="notices"                 options={{ href: null }} />
      <Tabs.Screen name="mode"                    options={{ href: null }} />
      <Tabs.Screen name="diary-write"             options={{ href: null }} />
      <Tabs.Screen name="diary-teacher-entries"   options={{ href: null }} />
      <Tabs.Screen name="photo-upload"            options={{ href: null }} />
      <Tabs.Screen name="teachers"                options={{ href: null }} />
      <Tabs.Screen name="pool-settings"           options={{ href: null }} />
      <Tabs.Screen name="notifications"           options={{ href: null }} />
      <Tabs.Screen name="branches"                options={{ href: null }} />
      <Tabs.Screen name="withdrawn-members"       options={{ href: null }} />
      <Tabs.Screen name="branding"                options={{ href: null }} />
      <Tabs.Screen name="white-label"             options={{ href: null }} />
      <Tabs.Screen name="member-detail"           options={{ href: null }} />
      <Tabs.Screen name="teacher-hub"             options={{ href: null }} />
      <Tabs.Screen name="people-teachers"         options={{ href: null }} />
      <Tabs.Screen name="teacher-pending-detail"  options={{ href: null }} />
      <Tabs.Screen name="people-pending"          options={{ href: null }} />
      <Tabs.Screen name="makeups"                 options={{ href: null }} />
      <Tabs.Screen name="makeup-policy"           options={{ href: null }} />
      <Tabs.Screen name="level-settings"          options={{ href: null }} />
      <Tabs.Screen name="settlement"              options={{ href: null }} />
      <Tabs.Screen name="holidays"                options={{ href: null }} />
      <Tabs.Screen name="class-management"        options={{ href: null }} />
      <Tabs.Screen name="data-management"         options={{ href: null }} />
      <Tabs.Screen name="data-storage-overview"   options={{ href: null }} />
      <Tabs.Screen name="data-storage-by-account" options={{ href: null }} />
      <Tabs.Screen name="data-storage-by-category" options={{ href: null }} />
      <Tabs.Screen name="data-delete"             options={{ href: null }} />
      <Tabs.Screen name="data-event-logs"         options={{ href: null }} />
      <Tabs.Screen name="admin-grant"             options={{ href: null }} />
      <Tabs.Screen name="invite-records"          options={{ href: null }} />
      <Tabs.Screen name="extra-storage"           options={{ href: null }} />
      <Tabs.Screen name="recovery"                options={{ href: null }} />
      <Tabs.Screen name="feedback-settings"       options={{ href: null }} />
      <Tabs.Screen name="push-notification-settings" options={{ href: null }} />
      <Tabs.Screen name="push-message-settings"   options={{ href: null }} />
      <Tabs.Screen name="my-info"                 options={{ href: null }} />
    </Tabs>
  );
}
