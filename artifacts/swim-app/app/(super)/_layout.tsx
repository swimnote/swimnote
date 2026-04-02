/**
 * (super)/_layout.tsx — 슈퍼관리자 탭 레이아웃
 *
 * 5개 하단 탭: 운영관리·보호통제·감사리스크·지원센터·더보기
 * 진입 가드: super_admin / platform_admin / super_manager 만 허용.
 */
import { Activity, Briefcase, HeadphonesIcon, MoreHorizontal, Shield } from "lucide-react-native";
import { Tabs, router } from "expo-router";
import React, { useEffect } from "react";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";

const C = Colors.light;
const ACTIVE = "#7C3AED";

const SUPER_ROLES = new Set(["super_admin", "platform_admin", "super_manager"]);

const ROLE_HOME_MAP: Record<string, string> = {
  pool_admin: "/(admin)/dashboard",
  sub_admin:  "/(admin)/dashboard",
  teacher:    "/(teacher)/today-schedule",
  parent:     "/(parent)/home",
};

export default function SuperLayout() {
  const { kind, isLoading, adminUser } = useAuth();

  useEffect(() => {
    if (isLoading || !kind) return;

    if (kind === "parent") {
      router.replace("/(parent)/home" as any);
      return;
    }

    if (kind === "admin") {
      const role = adminUser?.role;
      if (!role) return;
      if (SUPER_ROLES.has(role)) return;
      const home = ROLE_HOME_MAP[role] ?? "/";
      router.replace(home as any);
    }
  }, [isLoading, kind, adminUser?.role]);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: ACTIVE,
        tabBarInactiveTintColor: C.tabIconDefault,
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
        options={{
          title: "운영관리",
          tabBarIcon: ({ color }) => <Briefcase size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="protect-group"
        options={{
          title: "보호통제",
          tabBarIcon: ({ color }) => <Shield size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="audit-group"
        options={{
          title: "감사리스크",
          tabBarIcon: ({ color }) => <Activity size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="support-group"
        options={{
          title: "지원센터",
          tabBarIcon: ({ color }) => <HeadphonesIcon size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "더보기",
          tabBarIcon: ({ color }) => <MoreHorizontal size={22} color={color} />,
        }}
      />

      {/* ─── 숨김 화면들 (탭 없이 push/navigate로 접근) ─── */}
      <Tabs.Screen name="pools"                    options={{ href: null }} />
      <Tabs.Screen name="operator-detail"          options={{ href: null }} />
      <Tabs.Screen name="subscriptions"            options={{ href: null }} />
      <Tabs.Screen name="subscription-products"    options={{ href: null }} />
      <Tabs.Screen name="storage"                  options={{ href: null }} />
      <Tabs.Screen name="storage-policy"           options={{ href: null }} />
      <Tabs.Screen name="kill-switch"              options={{ href: null }} />
      <Tabs.Screen name="backup"                   options={{ href: null }} />
      <Tabs.Screen name="readonly-control"         options={{ href: null }} />
      <Tabs.Screen name="feature-flags"            options={{ href: null }} />
      <Tabs.Screen name="policy"                   options={{ href: null }} />
      <Tabs.Screen name="support"                  options={{ href: null }} />
      <Tabs.Screen name="op-logs"                  options={{ href: null }} />
      <Tabs.Screen name="risk-center"              options={{ href: null }} />
      <Tabs.Screen name="security"                 options={{ href: null }} />
      <Tabs.Screen name="op-group"                 options={{ href: null }} />
      <Tabs.Screen name="users"                    options={{ href: null }} />
      <Tabs.Screen name="security-settings"        options={{ href: null }} />
      <Tabs.Screen name="sync"                     options={{ href: null }} />
      <Tabs.Screen name="revenue-analytics"        options={{ href: null }} />
      <Tabs.Screen name="cost-analytics"           options={{ href: null }} />
      <Tabs.Screen name="billing-analytics"        options={{ href: null }} />
      <Tabs.Screen name="system-status"            options={{ href: null }} />
      <Tabs.Screen name="ads"                      options={{ href: null }} />
      <Tabs.Screen name="notices"                  options={{ href: null }} />
      <Tabs.Screen name="pool-notices"             options={{ href: null }} />
      <Tabs.Screen name="db-status"                options={{ href: null }} />
      <Tabs.Screen name="infra-usage"              options={{ href: null }} />
      <Tabs.Screen name="support-general"          options={{ href: null }} />
    </Tabs>
  );
}
