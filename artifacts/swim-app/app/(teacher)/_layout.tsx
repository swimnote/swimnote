import { Feather } from "@expo/vector-icons";
import { router, Tabs } from "expo-router";
import React from "react";
import { Platform, Pressable, View } from "react-native";
import Colors from "@/constants/colors";
import { useBrand } from "@/context/BrandContext";
import { useAuth } from "@/context/AuthContext";

export default function TeacherLayout() {
  const { themeColor } = useBrand();
  const { logout } = useAuth();
  const C = Colors.light;

  const handleLogout = async () => {
    await logout();
    router.replace("/");
  };

  const handleSwitchMode = () => {
    router.replace("/org-role-select");
  };

  return (
    <Tabs screenOptions={{
      tabBarActiveTintColor: themeColor,
      tabBarInactiveTintColor: C.tabIconDefault,
      headerShown: true,
      headerStyle: { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.border },
      headerTitleStyle: { fontFamily: "Inter_600SemiBold", fontSize: 16, color: C.text },
      headerRight: () => (
        <View style={{ flexDirection: "row", alignItems: "center", marginRight: 8, gap: 4 }}>
          <Pressable onPress={handleSwitchMode} style={{ padding: 8 }} hitSlop={4}>
            <Feather name="grid" size={20} color={C.textSecondary} />
          </Pressable>
          <Pressable onPress={handleLogout} style={{ padding: 8 }} hitSlop={4}>
            <Feather name="log-out" size={20} color={C.text} />
          </Pressable>
        </View>
      ),
      tabBarStyle: {
        backgroundColor: "#fff",
        borderTopWidth: 1,
        borderTopColor: C.border,
        elevation: 0,
        height: Platform.OS === "web" ? 84 : 60,
      },
      tabBarLabelStyle: { fontFamily: "Inter_500Medium", fontSize: 10 },
    }}>
      <Tabs.Screen name="today-schedule" options={{ title: "오늘 스케줄", headerTitle: "오늘 스케줄", tabBarIcon: ({ color }) => <Feather name="sun"          size={22} color={color} /> }} />
      <Tabs.Screen name="my-schedule"    options={{ title: "수업 관리",   headerTitle: "수업 관리",   tabBarIcon: ({ color }) => <Feather name="layers"       size={22} color={color} /> }} />
      <Tabs.Screen name="attendance"     options={{ title: "출결 관리",   headerTitle: "출결 관리",   tabBarIcon: ({ color }) => <Feather name="check-square" size={22} color={color} /> }} />
      <Tabs.Screen name="diary"          options={{ title: "수영일지",    headerTitle: "수영일지",    tabBarIcon: ({ color }) => <Feather name="book"         size={22} color={color} /> }} />
      <Tabs.Screen name="photos"         options={{ title: "사진영상",    headerTitle: "사진영상",    tabBarIcon: ({ color }) => <Feather name="camera"  size={22} color={color} /> }} />
      <Tabs.Screen name="messenger"      options={{ title: "메신저",      headerTitle: "업무 메신저", tabBarIcon: ({ color }) => <Feather name="send"     size={22} color={color} /> }} />
      <Tabs.Screen name="revenue"        options={{ title: "매출계산기",  headerTitle: "내 매출계산기", tabBarIcon: ({ color }) => <Feather name="dollar-sign" size={22} color={color} /> }} />
      <Tabs.Screen name="settings"       options={{ title: "관리설정",    headerTitle: "관리설정",    tabBarIcon: ({ color }) => <Feather name="settings" size={22} color={color} /> }} />
      <Tabs.Screen name="student-detail" options={{ href: null, headerShown: false }} />
    </Tabs>
  );
}
