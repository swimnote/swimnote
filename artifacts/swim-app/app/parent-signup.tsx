import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import {
  Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const C = Colors.light;

const OPTIONS = [
  {
    icon: "search" as const,
    label: "수영장 검색으로 가입 요청",
    desc: "수영장을 검색하고 가입 요청을 보냅니다.\n관리자 승인 후 이용 가능합니다.",
    color: "#1A5CFF",
    bg: "#EFF4FF",
    onPress: () => router.push("/pool-join-request" as any),
  },
  {
    icon: "hash" as const,
    label: "초대코드로 가입",
    desc: "수영장에서 발급받은 초대코드로\n즉시 가입할 수 있습니다.",
    color: "#10B981",
    bg: "#ECFDF5",
    onPress: () => router.push("/parent-code-signup" as any),
  },
];

export default function ParentSignupScreen() {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={[styles.root, { backgroundColor: C.background }]}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.headerRow}>
        <Pressable style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={C.text} />
        </Pressable>
        <Text style={[styles.screenTitle, { color: C.text }]}>학부모 가입</Text>
        <View style={{ width: 28 }} />
      </View>

      <View style={styles.titleArea}>
        <View style={[styles.logoBox, { backgroundColor: "#F59E0B" }]}>
          <Feather name="heart" size={28} color="#fff" />
        </View>
        <Text style={[styles.title, { color: C.text }]}>학부모 회원가입</Text>
        <Text style={[styles.subtitle, { color: C.textSecondary }]}>가입 방법을 선택해주세요</Text>
      </View>

      <View style={styles.cards}>
        {OPTIONS.map(o => (
          <Pressable
            key={o.label}
            style={({ pressed }) => [styles.optionCard, { backgroundColor: C.card, opacity: pressed ? 0.9 : 1 }]}
            onPress={o.onPress}
          >
            <View style={[styles.optionIconWrap, { backgroundColor: o.bg }]}>
              <Feather name={o.icon} size={24} color={o.color} />
            </View>
            <View style={styles.optionInfo}>
              <Text style={[styles.optionLabel, { color: C.text }]}>{o.label}</Text>
              <Text style={[styles.optionDesc, { color: C.textSecondary }]}>{o.desc}</Text>
            </View>
            <Feather name="chevron-right" size={18} color={C.textMuted} />
          </Pressable>
        ))}
      </View>

      <Pressable style={({ pressed }) => [styles.loginLink, { opacity: pressed ? 0.6 : 1 }]} onPress={() => router.replace("/" as any)}>
        <Text style={[styles.loginLinkText, { color: C.textSecondary }]}>
          이미 계정이 있으신가요?{" "}
          <Text style={{ color: C.tint, fontFamily: "Inter_600SemiBold" }}>로그인하기</Text>
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { paddingHorizontal: 20, gap: 28 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backBtn: { padding: 4 },
  screenTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  titleArea: { alignItems: "center", gap: 10 },
  logoBox: {
    width: 64, height: 64, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#F59E0B", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 10, elevation: 5,
  },
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular" },
  cards: { gap: 12 },
  optionCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    borderRadius: 18, padding: 18,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 10, elevation: 3,
  },
  optionIconWrap: { width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  optionInfo: { flex: 1, gap: 4 },
  optionLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  optionDesc: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  loginLink: { alignItems: "center", paddingVertical: 8 },
  loginLinkText: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
