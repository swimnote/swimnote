import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";

const STATUS_LABELS: Record<string, string> = {
  expired: "구독 만료",
  suspended: "서비스 일시 정지",
  cancelled: "구독 해지",
};

const STATUS_DESC: Record<string, string> = {
  expired: "구독 기간이 만료되었습니다.\n슈퍼관리자에게 구독 갱신을 요청해 주세요.",
  suspended: "서비스가 일시 정지되었습니다.\n슈퍼관리자에게 문의해 주세요.",
  cancelled: "구독이 해지된 상태입니다.\n슈퍼관리자에게 문의해 주세요.",
};

export default function SubscriptionExpiredScreen() {
  const { logout, pool, refreshPool } = useAuth();
  const insets = useSafeAreaInsets();
  const C = Colors.light;
  const status = pool?.subscription_status || "expired";

  return (
    <View style={[styles.container, { backgroundColor: C.background, paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0), paddingBottom: insets.bottom + 34 }]}>
      <View style={styles.content}>
        <View style={[styles.iconBox, { backgroundColor: "#FEF3C7" }]}>
          <Feather name="alert-triangle" size={40} color="#F59E0B" />
        </View>
        <Text style={[styles.title, { color: C.text }]}>{STATUS_LABELS[status] || "구독 오류"}</Text>
        <Text style={[styles.message, { color: C.textSecondary }]}>{STATUS_DESC[status] || "관리자에게 문의해 주세요."}</Text>

        {pool?.subscription_end_at ? (
          <View style={[styles.infoCard, { backgroundColor: C.card, borderColor: C.border }]}>
            <Text style={[styles.infoLabel, { color: C.textMuted }]}>만료일</Text>
            <Text style={[styles.infoValue, { color: C.text }]}>
              {new Date(pool.subscription_end_at).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })}
            </Text>
          </View>
        ) : null}

        <Pressable
          style={({ pressed }) => [styles.refreshBtn, { backgroundColor: C.tintLight, opacity: pressed ? 0.8 : 1 }]}
          onPress={refreshPool}
        >
          <Feather name="refresh-cw" size={16} color={C.tint} />
          <Text style={[styles.refreshText, { color: C.tint }]}>상태 새로고침</Text>
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
  title: { fontSize: 26, fontFamily: "Inter_700Bold" },
  message: { fontSize: 15, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 24 },
  infoCard: { width: "100%", borderRadius: 14, borderWidth: 1, padding: 16, gap: 4 },
  infoLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  infoValue: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  refreshBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12 },
  refreshText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  logoutText: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
