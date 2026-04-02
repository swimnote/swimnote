import { Briefcase, Home, Layers, Send, Settings, TrendingUp } from "lucide-react-native";
import { Tabs, router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { emitTabReset } from "@/utils/tabReset";

const C = Colors.light;

export default function AdminLayout() {
  const { themeColor } = useBrand();
  const { kind, isLoading, adminUser, token } = useAuth();

  // K: 처리 필요 배지 — pending 카운트 폴링
  const [pendingBadge, setPendingBadge] = useState<number | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchBadge = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiRequest(token, "/admin/dashboard-stats");
      if (!res.ok) return;
      const d = await res.json();
      const total = (d.pending_requests ?? 0) + (d.pending_makeups ?? 0);
      setPendingBadge(total > 0 ? total : undefined);
    } catch { /* 무시 */ }
  }, [token]);

  useFocusEffect(useCallback(() => {
    fetchBadge();
    timerRef.current = setInterval(fetchBadge, 60_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchBadge]));

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
        tabBarInactiveTintColor: C.text,
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#fff",
          borderTopWidth: 1,
          borderTopColor: C.border,
          height: 72,
          paddingBottom: 12,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontSize: 10, fontFamily: "Pretendard-Regular", marginTop: 2 },
      }}
    >
      {/* ─── 5개 메인 탭 ─── */}
      <Tabs.Screen
        name="dashboard"
        listeners={makeTabListener("dashboard")}
        options={{
          title: "홈",
          tabBarIcon: ({ color }) => <Home size={22} color={color} />,
          tabBarBadge: pendingBadge,
          tabBarBadgeStyle: { backgroundColor: "#D96C6C", fontSize: 10, minWidth: 16, height: 16, lineHeight: 16 },
        }}
      />
      <Tabs.Screen
        name="class-hub"
        listeners={makeTabListener("class-hub")}
        options={{ title: "수업관리", tabBarIcon: ({ color }) => <Layers size={22} color={color} /> }}
      />
      <Tabs.Screen name="classes" options={{ href: null }} />
      <Tabs.Screen
        name="admin-revenue"
        listeners={makeTabListener("admin-revenue")}
        options={{ title: "수업정산", tabBarIcon: ({ color }) => <TrendingUp size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="ops-hub"
        listeners={makeTabListener("ops-hub")}
        options={{ title: "운영관리", tabBarIcon: ({ color }) => <Briefcase size={22} color={color} /> }}
      />
      <Tabs.Screen name="people" options={{ href: null }} />
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
      <Tabs.Screen name="bulk-register"           options={{ href: null }} />
      <Tabs.Screen name="help"                    options={{ href: null }} />
      <Tabs.Screen name="invite-qr"               options={{ href: null }} />
      <Tabs.Screen name="subscription"            options={{ href: null }} />
    </Tabs>
  );
}
