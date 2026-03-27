import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";

export default function SubscriptionExpiredScreen() {
  const { logout } = useAuth();
  const insets = useSafeAreaInsets();
  const C = Colors.light;

  useEffect(() => {
    router.replace("/(admin)/dashboard" as any);
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: C.background, paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0), paddingBottom: insets.bottom + 34 }]}>
      <View style={styles.content}>
        <View style={[styles.iconBox, { backgroundColor: "#E6FFFA" }]}>
          <Feather name="check-circle" size={40} color="#2EC4B6" />
        </View>
        <Text style={[styles.title, { color: C.text }]}>서비스 이용 중</Text>
        <Text style={[styles.message, { color: C.textSecondary }]}>
          현재 앱 내 결제 기능은 제공되지 않습니다.
        </Text>
        <Pressable onPress={logout}>
          <Text style={[styles.logoutText, { color: C.textMuted }]}>로그아웃</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1 },
  content:     { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 20 },
  iconBox:     { width: 96, height: 96, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  title:       { fontSize: 26, fontFamily: "Pretendard-Bold" },
  message:     { fontSize: 15, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 24 },
  logoutText:  { fontSize: 13, fontFamily: "Pretendard-Regular" },
});
