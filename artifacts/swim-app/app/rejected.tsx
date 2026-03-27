import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";

export default function RejectedScreen() {
  const { logout, pool } = useAuth();
  const insets = useSafeAreaInsets();
  const C = Colors.light;

  return (
    <View style={[styles.container, { backgroundColor: C.background, paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0), paddingBottom: insets.bottom + 34 }]}>
      <View style={styles.content}>
        <View style={[styles.iconBox, { backgroundColor: "#F9DEDA" }]}>
          <Feather name="x-circle" size={40} color="#D96C6C" />
        </View>
        <Text style={[styles.title, { color: C.text }]}>가입 신청 반려</Text>
        <Text style={[styles.message, { color: C.textSecondary }]}>
          안타깝게도 수영장 가입 신청이 반려되었습니다.{"\n"}아래 사유를 확인해 주세요.
        </Text>

        {pool?.rejection_reason ? (
          <View style={[styles.reasonCard, { backgroundColor: "#F9DEDA", borderColor: "#FECACA" }]}>
            <Text style={[styles.reasonLabel, { color: C.error }]}>반려 사유</Text>
            <Text style={[styles.reasonText, { color: C.text }]}>{pool.rejection_reason}</Text>
          </View>
        ) : null}

        <Pressable
          style={({ pressed }) => [styles.reapplyBtn, { backgroundColor: C.button, opacity: pressed ? 0.85 : 1 }]}
          onPress={() => router.replace("/pool-apply")}
        >
          <Text style={styles.reapplyText}>다시 신청하기</Text>
        </Pressable>
        <Pressable onPress={logout}>
          <Text style={[styles.logoutText, { color: C.textMuted }]}>로그아웃</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 20 },
  iconBox: { width: 96, height: 96, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 26, fontFamily: "Pretendard-Bold" },
  message: { fontSize: 15, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 24 },
  reasonCard: { width: "100%", borderRadius: 14, borderWidth: 1, padding: 16, gap: 8 },
  reasonLabel: { fontSize: 12, fontFamily: "Pretendard-SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  reasonText: { fontSize: 15, fontFamily: "Pretendard-Regular", lineHeight: 22 },
  reapplyBtn: { paddingVertical: 14, paddingHorizontal: 32, borderRadius: 14, alignItems: "center" },
  reapplyText: { color: "#fff", fontSize: 16, fontFamily: "Pretendard-SemiBold" },
  logoutText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
});
