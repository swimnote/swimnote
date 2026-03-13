import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";

export default function PendingScreen() {
  const { logout, pool, refreshPool } = useAuth();
  const insets = useSafeAreaInsets();
  const C = Colors.light;

  return (
    <View style={[styles.container, { backgroundColor: C.background, paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0), paddingBottom: insets.bottom + 34 }]}>
      <View style={styles.content}>
        <View style={[styles.iconBox, { backgroundColor: "#FEF3C7" }]}>
          <Feather name="clock" size={40} color="#F59E0B" />
        </View>
        <Text style={[styles.title, { color: C.text }]}>승인 대기 중</Text>
        <Text style={[styles.message, { color: C.textSecondary }]}>
          <Text style={{ fontFamily: "Inter_600SemiBold", color: C.text }}>{pool?.name || "수영장"}</Text>
          {"\n\n"}신청서가 접수되었습니다.{"\n"}슈퍼관리자의 검토 후 승인이 완료되면{"\n"}서비스를 이용하실 수 있습니다.
        </Text>

        <View style={[styles.infoCard, { backgroundColor: C.card, borderColor: C.border }]}>
          <View style={styles.infoRow}>
            <Feather name="map-pin" size={14} color={C.textMuted} />
            <Text style={[styles.infoText, { color: C.textSecondary }]}>{pool?.address || "-"}</Text>
          </View>
          <View style={styles.infoRow}>
            <Feather name="phone" size={14} color={C.textMuted} />
            <Text style={[styles.infoText, { color: C.textSecondary }]}>{pool?.phone || "-"}</Text>
          </View>
          <View style={styles.infoRow}>
            <Feather name="calendar" size={14} color={C.textMuted} />
            <Text style={[styles.infoText, { color: C.textSecondary }]}>신청일: {pool?.created_at ? new Date(pool.created_at).toLocaleDateString("ko-KR") : "-"}</Text>
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [styles.refreshBtn, { backgroundColor: C.tintLight, opacity: pressed ? 0.8 : 1 }]}
          onPress={refreshPool}
        >
          <Feather name="refresh-cw" size={16} color={C.tint} />
          <Text style={[styles.refreshText, { color: C.tint }]}>승인 상태 확인</Text>
        </Pressable>

        <Pressable onPress={logout}>
          <Text style={[styles.logoutText, { color: C.textMuted }]}>로그아웃</Text>
        </Pressable>
      </View>
    </View>
  );
}

import { Platform } from "react-native";
const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 20 },
  iconBox: { width: 96, height: 96, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 26, fontFamily: "Inter_700Bold" },
  message: { fontSize: 15, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 24 },
  infoCard: { width: "100%", borderRadius: 14, borderWidth: 1, padding: 16, gap: 10 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  infoText: { fontSize: 14, fontFamily: "Inter_400Regular", flex: 1 },
  refreshBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12 },
  refreshText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  logoutText: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
