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
    key: "teacher",
    icon: "award" as const,
    label: "선생님",
    desc: "수영장에 소속되거나 개인 워크스페이스를 만들어 수업을 관리합니다",
    color: "#2EC4B6",
    bg: "#EFF4FF",
    onPress: () => router.push("/teacher-signup" as any),
  },
  {
    key: "parent",
    icon: "heart" as const,
    label: "학부모",
    desc: "선생님으로부터 초대 링크를 받아 가입합니다",
    color: "#E4A93A",
    bg: "#FFFBEB",
    onPress: () => router.push("/parent-invite-info" as any),
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
          <Text style={{ color: C.tint, fontFamily: "Pretendard-Regular" }}>로그인</Text>
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
  title: { fontSize: 24, fontFamily: "Pretendard-Regular" },
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
  roleLabel: { fontSize: 16, fontFamily: "Pretendard-Regular" },
  roleDesc: { fontSize: 12, fontFamily: "Pretendard-Regular", lineHeight: 17 },
  loginLink: { alignItems: "center", paddingVertical: 8 },
  loginLinkText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
});
