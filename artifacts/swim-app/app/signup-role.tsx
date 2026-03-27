import { ArrowLeft, ChevronRight, UserPlus } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import React from "react";
import {
  Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const C = Colors.light;

const ROLES = [
  {
    key: "admin",
    icon: "briefcase" as const,
    label: "수영장 운영자",
    desc: "수영장을 등록하고 회원·선생님·수업을 관리합니다",
    color: "#2EC4B6",
    bg: "#EFF4FF",
    onPress: () => router.push("/register" as any),
  },
  {
    key: "teacher",
    icon: "award" as const,
    label: "선생님",
    desc: "수영장을 검색하여 가입 요청을 보냅니다",
    color: "#2E9B6F",
    bg: "#DFF3EC",
    onPress: () => router.push("/teacher-signup" as any),
  },
  {
    key: "parent",
    icon: "heart" as const,
    label: "학부모",
    desc: "간편하게 가입 후 홈에서 자녀를 연결합니다",
    color: "#E4A93A",
    bg: "#FFFBEB",
    onPress: () => router.push("/pool-join-request" as any),
  },
];

export default function SignupRoleScreen() {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={[styles.root, { backgroundColor: C.background }]}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* 헤더 */}
      <View style={styles.header}>
        <Pressable style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]} onPress={() => router.back()}>
          <ArrowLeft size={20} color={C.text} />
        </Pressable>
      </View>

      <View style={styles.titleArea}>
        <View style={[styles.logoBox, { backgroundColor: C.tint }]}>
          <UserPlus size={28} color="#fff" />
        </View>
        <Text style={[styles.title, { color: C.text }]}>회원가입</Text>
        <Text style={[styles.subtitle, { color: C.textSecondary }]}>
          어떤 역할로 가입하시겠어요?
        </Text>
      </View>

      <View style={styles.cards}>
        {ROLES.map(r => (
          <Pressable
            key={r.key}
            style={({ pressed }) => [styles.roleCard, { backgroundColor: C.card, opacity: pressed ? 0.9 : 1 }]}
            onPress={r.onPress}
          >
            <View style={[styles.roleIconWrap, { backgroundColor: r.bg }]}>
              <LucideIcon name={r.icon} size={24} color={r.color} />
            </View>
            <View style={styles.roleInfo}>
              <Text style={[styles.roleLabel, { color: C.text }]}>{r.label}</Text>
              <Text style={[styles.roleDesc, { color: C.textSecondary }]}>{r.desc}</Text>
            </View>
            <ChevronRight size={18} color={C.textMuted} />
          </Pressable>
        ))}
      </View>

      <Pressable style={({ pressed }) => [styles.loginLink, { opacity: pressed ? 0.6 : 1 }]} onPress={() => router.back()}>
        <Text style={[styles.loginLinkText, { color: C.textSecondary }]}>
          이미 계정이 있으신가요?{" "}
          <Text style={{ color: C.tint, fontFamily: "Pretendard-SemiBold" }}>로그인</Text>
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { paddingHorizontal: 20, gap: 28 },
  header: { flexDirection: "row", alignItems: "center" },
  backBtn: { padding: 4 },
  titleArea: { alignItems: "center", gap: 10 },
  logoBox: {
    width: 64, height: 64, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#2EC4B6", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 10, elevation: 5,
  },
  title: { fontSize: 24, fontFamily: "Pretendard-Bold" },
  subtitle: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  cards: { gap: 12 },
  roleCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    borderRadius: 18, padding: 18,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 10, elevation: 3,
  },
  roleIconWrap: { width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  roleInfo: { flex: 1, gap: 3 },
  roleLabel: { fontSize: 16, fontFamily: "Pretendard-SemiBold" },
  roleDesc: { fontSize: 12, fontFamily: "Pretendard-Regular", lineHeight: 17 },
  loginLink: { alignItems: "center", paddingVertical: 8 },
  loginLinkText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
});
