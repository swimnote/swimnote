import { LucideIcon } from "@/components/common/LucideIcon";
import { Tabs, router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { useMode } from "@/context/ModeContext";
import { X, isXMode } from "@/constants/xTheme";
import { emitTabReset } from "@/utils/tabReset";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const C = Colors.light;

export default function AdminLayout() {
  const { themeColor } = useBrand();
  const { mode } = useMode();
  /** §24: paid X이면 config 미완료(x_pending)여도 X UI 적용 */
  const isX = isXMode(mode);
  /** X 모드: 네이비 탭바 / Normal: 기본 민트 */
  const activeTabColor = isX ? X.tabActive : themeColor;
  const tabBarBg = isX ? X.surfaceNavy : "#fff";
  const tabBorderColor = isX ? X.surfaceNavyStrong : C.border;
  const { kind, isLoading, adminUser, token, pool } = useAuth();
  const insets = useSafeAreaInsets();

  // K: 처리 필요 배지 — pending 카운트 폴링
  const [pendingBadge, setPendingBadge] = useState<number | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // M: 메신저 미읽음 배지
  const [messengerUnread, setMessengerUnread] = useState(false);
  const messengerTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const fetchMessengerBadge = useCallback(async () => {
    if (!token || !pool?.id) return;
    try {
      const res = await apiRequest(token, `/messenger/read-state?pool_id=${pool.id}&channel_type=talk`);
      if (!res.ok) return;
      const d = await res.json();
      setMessengerUnread((d.unreadCount ?? 0) > 0);
    } catch { /* 무시 */ }
  }, [token, pool?.id]);

  useFocusEffect(useCallback(() => {
    fetchBadge();
    timerRef.current = setInterval(fetchBadge, 60_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchBadge]));

  useFocusEffect(useCallback(() => {
    fetchMessengerBadge();
    messengerTimerRef.current = setInterval(fetchMessengerBadge, 30_000);
    return () => { if (messengerTimerRef.current) clearInterval(messengerTimerRef.current); };
  }, [fetchMessengerBadge]));

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

  // Amendment A1: SUBSCRIPTION_REQUIRED global gate
  // mode=subscription_required → 구독 필요 화면으로 유도
  // 허용: subscription 화면 (이미 이 레이아웃 내에 존재)
  // 금지: 다른 운영 탭 접근
  // navigation loop 방지: subscription_required 상태이면 subscription으로 replace
  useEffect(() => {
    if (mode === "subscription_required") {
      router.replace("/(admin)/subscription" as any);
    }
  }, [mode]);

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

  const isWithdrawing = adminUser?.withdrawing === true;
  const daysLeft     = adminUser?.days_until_deletion ?? 0;

  return (
    <View style={{ flex: 1 }}>
    {isWithdrawing && (
      <View style={[wdStyle.banner, { top: insets.top }]}>
        <Text style={wdStyle.bannerText}>
          계정 탈퇴 유예 중 — {daysLeft}일 후 자동 삭제 · 재구독 시 복구 가능 (읽기 전용)
        </Text>
      </View>
    )}
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: activeTabColor,
        tabBarInactiveTintColor: isX ? X.tabInactive : C.text,
        headerShown: false,
        tabBarStyle: {
          backgroundColor: tabBarBg,
          borderTopWidth: 1,
          borderTopColor: tabBorderColor,
          height: Platform.OS === "android" ? 60 + Math.max(insets.bottom, 24) : 72,
          paddingBottom: Platform.OS === "android" ? Math.max(insets.bottom + 8, 24) : 12,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontSize: 10, fontFamily: "Pretendard-Regular", marginTop: 2, lineHeight: 14 },
      }}
    >
      {/* ─── 5개 메인 탭 ─── */}
      <Tabs.Screen
        name="dashboard"
        listeners={makeTabListener("dashboard")}
        options={{
          title: "홈",
          tabBarIcon: ({ color }) => <LucideIcon name="home" size={22} color={color} />,
          tabBarBadge: pendingBadge,
          tabBarBadgeStyle: { backgroundColor: "#D96C6C", fontSize: 10, minWidth: 16, height: 16, lineHeight: 16 },
        }}
      />
      <Tabs.Screen
        name="class-hub"
        listeners={makeTabListener("class-hub")}
        options={{ title: "수업관리", tabBarIcon: ({ color }) => <LucideIcon name="layers" size={22} color={color} /> }}
      />
      <Tabs.Screen name="classes" options={{ href: null }} />
      <Tabs.Screen name="admin-revenue" options={{ href: null }} />
      <Tabs.Screen
        name="ops-hub"
        listeners={makeTabListener("ops-hub")}
        options={{ title: "운영관리", tabBarIcon: ({ color }) => <LucideIcon name="briefcase" size={22} color={color} /> }}
      />
      <Tabs.Screen name="people" options={{ href: null }} />
      <Tabs.Screen
        name="messenger"
        listeners={({ navigation }: { navigation: any; route: any }) => ({
          tabPress: (e: any) => {
            e.preventDefault();
            setMessengerUnread(false);
            if (token && pool?.id) {
              apiRequest(token, "/messenger/read-state", {
                method: "POST",
                body: JSON.stringify({ pool_id: pool.id, channel_type: "talk" }),
              }).catch(() => {});
            }
            const state = navigation.getState();
            const currentRoute = state.routes[state.index]?.name;
            if (currentRoute === "messenger") {
              emitTabReset("messenger");
            } else {
              navigation.navigate("messenger");
            }
          },
        })}
        options={{
          title: "메신저",
          tabBarIcon: ({ color }) => (
            <View>
              <LucideIcon name="send" size={22} color={color} />
              {messengerUnread && (
                <View style={{
                  position: "absolute", top: -2, right: -4,
                  width: 8, height: 8, borderRadius: 4,
                  backgroundColor: "#D96C6C",
                }} />
              )}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        listeners={makeTabListener("settings")}
        options={{ title: "설정", tabBarIcon: ({ color }) => <LucideIcon name="settings" size={22} color={color} /> }}
      />

      {/* ─── 숨김 화면들 (탭 없이 push/navigate로 접근) ─── */}
      <Tabs.Screen name="more"                    options={{ href: null }} />
      <Tabs.Screen name="billing"                 options={{ href: null }} />
      <Tabs.Screen name="communication"           options={{ href: null }} />
      <Tabs.Screen name="members"                 options={{ href: null }} />
      <Tabs.Screen name="community"               options={{ href: null }} />
      <Tabs.Screen name="approvals"               options={{ href: null }} />
      <Tabs.Screen name="attendance"              options={{ href: null }} />
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
      <Tabs.Screen name="recovery"                options={{ href: null }} />
      <Tabs.Screen name="feedback-settings"       options={{ href: null }} />
      <Tabs.Screen name="diary-template-settings"   options={{ href: null }} />
      <Tabs.Screen name="class-capacity-settings"   options={{ href: null }} />
      <Tabs.Screen name="unit-pricing"            options={{ href: null }} />
      <Tabs.Screen name="push-notification-settings" options={{ href: null }} />
      <Tabs.Screen name="push-message-settings"   options={{ href: null }} />
      <Tabs.Screen name="my-info"                 options={{ href: null }} />
      <Tabs.Screen name="bulk-register"           options={{ href: null }} />
      <Tabs.Screen name="extra-storage"           options={{ href: null }} />
      <Tabs.Screen name="help"                    options={{ href: null }} />
      <Tabs.Screen name="inquiries"               options={{ href: null }} />
      <Tabs.Screen name="invite-qr"               options={{ href: null }} />
      <Tabs.Screen name="subscription"            options={{ href: null }} />
      <Tabs.Screen name="parents-list"            options={{ href: null }} />
      <Tabs.Screen name="refund-policy"           options={{ href: null }} />
      <Tabs.Screen name="web-pin-settings"        options={{ href: null }} />
      {/* 4대 X 운영허브 — PHASE 0/1 shell (PHASE 2~5에서 내용 구현) */}
      <Tabs.Screen name="report-hub"             options={{ href: null }} />
      <Tabs.Screen name="diary-hub"              options={{ href: null }} />
      <Tabs.Screen name="curriculum-hub"         options={{ href: null }} />
      <Tabs.Screen name="x-hub"                  options={{ href: null }} />
      {/* SWIMNOTE X — 탭 노출 없이 push로만 접근 (WP4) */}
      <Tabs.Screen name="x-growth"               options={{ href: null }} />
      {/* SWIMNOTE X — X01 정보 허브 및 설명 화면 */}
      <Tabs.Screen name="x-setup"                options={{ href: null }} />
      <Tabs.Screen name="x-mode-hub"             options={{ href: null }} />
      <Tabs.Screen name="x-info-overview"        options={{ href: null }} />
      <Tabs.Screen name="x-info-ai"              options={{ href: null }} />
      <Tabs.Screen name="x-info-parent-report"   options={{ href: null }} />
      <Tabs.Screen name="x-info-diary"           options={{ href: null }} />
      <Tabs.Screen name="x-info-curriculum"      options={{ href: null }} />
      <Tabs.Screen name="x-subscription"         options={{ href: null }} />
      {/* CS-02R — AI 문의 (고객센터) */}
      <Tabs.Screen name="support-chat"           options={{ href: null }} />
    </Tabs>
    </View>
  );
}

const wdStyle = StyleSheet.create({
  banner: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 9999,
    backgroundColor: "#D97706",
    paddingVertical: 7,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  bannerText: {
    color: "#fff",
    fontSize: 11,
    fontFamily: "Pretendard-Medium",
    textAlign: "center",
    lineHeight: 16,
  },
});
