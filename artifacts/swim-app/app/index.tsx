import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const C = Colors.light;

export default function StartScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { backgroundColor: C.background, paddingTop: insets.top + (Platform.OS === "web" ? 67 : 40), paddingBottom: insets.bottom + 32 }]}>
      <View style={styles.logoArea}>
        <View style={[styles.logoBox, { backgroundColor: C.tint }]}>
          <Feather name="droplet" size={36} color="#fff" />
        </View>
        <Text style={[styles.appName, { color: C.text }]}>스윔노트</Text>
        <Text style={[styles.appSub, { color: C.textSecondary }]}>수영장 통합 관리 플랫폼</Text>
      </View>

      <View style={styles.btnArea}>
        <Pressable
          style={({ pressed }) => [styles.btn, { backgroundColor: C.tint, opacity: pressed ? 0.85 : 1 }]}
          onPress={() => router.push("/login")}
        >
          <View style={[styles.btnIcon, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
            <Feather name="user" size={22} color="#fff" />
          </View>
          <View style={styles.btnText}>
            <Text style={styles.btnLabel}>선생님 · 관리자 로그인</Text>
            <Text style={styles.btnSub}>수영장 운영자 및 강사 전용</Text>
          </View>
          <Feather name="chevron-right" size={20} color="rgba(255,255,255,0.7)" />
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.btn, styles.btnParent, { backgroundColor: C.card, borderColor: C.success, opacity: pressed ? 0.85 : 1 }]}
          onPress={() => router.push("/parent-login")}
        >
          <View style={[styles.btnIcon, { backgroundColor: "#D1FAE5" }]}>
            <Feather name="heart" size={22} color={C.success} />
          </View>
          <View style={styles.btnText}>
            <Text style={[styles.btnLabel, { color: C.text }]}>학부모 로그인</Text>
            <Text style={[styles.btnSub, { color: C.textSecondary }]}>자녀 수업 일정 및 일지 확인</Text>
          </View>
          <Feather name="chevron-right" size={20} color={C.textMuted} />
        </Pressable>
      </View>

      <View style={styles.footer}>
        <Pressable style={styles.footerRow} onPress={() => router.push("/register")}>
          <Feather name="plus-circle" size={14} color={C.textMuted} />
          <Text style={[styles.footerText, { color: C.textSecondary }]}>수영장 사업자 가입 신청</Text>
        </Pressable>
        <Pressable style={styles.footerRow} onPress={() => router.push("/teacher-invite-join")}>
          <Feather name="mail" size={14} color={C.textMuted} />
          <Text style={[styles.footerText, { color: C.textSecondary }]}>선생님 초대 코드로 가입</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 24 },
  logoArea: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  logoBox: { width: 80, height: 80, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  appName: { fontSize: 28, fontFamily: "Inter_700Bold" },
  appSub: { fontSize: 14, fontFamily: "Inter_400Regular" },
  btnArea: { gap: 14, marginBottom: 32 },
  btn: { flexDirection: "row", alignItems: "center", gap: 14, padding: 18, borderRadius: 18 },
  btnParent: { borderWidth: 2 },
  btnIcon: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  btnText: { flex: 1, gap: 3 },
  btnLabel: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },
  btnSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.75)" },
  footer: { alignItems: "center", gap: 12, paddingBottom: 8 },
  footerRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  footerText: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
