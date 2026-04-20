import { ArrowLeft, ChevronRight, UserPlus } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import {
  Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const C = Colors.light;

interface RoleCard {
  key: string;
  icon: any;
  iconColor: string;
  iconBg: string;
  label: string;
  tag: string;
  tagColor: string;
  tagBg: string;
  bullets: string[];
  onPress: () => void;
}

export default function SignupRoleScreen() {
  const insets = useSafeAreaInsets();
  const { appleId, appleEmail, appleName, kakaoId, kakaoPhone } = useLocalSearchParams<{
    appleId?: string; appleEmail?: string; appleName?: string; kakaoId?: string; kakaoPhone?: string;
  }>();

  const isSocial = !!(appleId || kakaoId);

  const socialParams = {
    ...(appleId ? { appleId } : {}),
    ...(kakaoId ? { kakaoId } : {}),
    ...(kakaoPhone ? { phone: kakaoPhone } : {}),
  };

  const ROLES: RoleCard[] = [
    {
      key: "admin",
      icon: "briefcase",
      iconColor: "#4F6EF7",
      iconBg: "#EFF4FF",
      label: "수영장 대표",
      tag: "원장님 · 원감님",
      tagColor: "#4F6EF7",
      tagBg: "#EFF4FF",
      bullets: [
        "수영장을 직접 운영하는 대표자",
        "선생님·학부모 초대 및 전체 관리",
        "수업 운영, 출결, 수업일지 통합 관리",
      ],
      onPress: () => router.push({ pathname: "/register", params: isSocial ? socialParams : {} } as any),
    },
    {
      key: "teacher",
      icon: "award",
      iconColor: "#2E9B6F",
      iconBg: "#DFF3EC",
      label: "선생님",
      tag: "선생님·코치",
      tagColor: "#2E9B6F",
      tagBg: "#DFF3EC",
      bullets: [
        "소속 수영장을 검색해 가입 요청을 보냅니다",
        "수영장 관리자 승인 후 수업을 시작할 수 있어요",
      ],
      onPress: () => router.push({ pathname: "/(auth)/teacher-signup", params: isSocial ? socialParams : {} } as any),
    },
    {
      key: "parent",
      icon: "heart",
      iconColor: "#E4A93A",
      iconBg: "#FFFBEB",
      label: "학부모",
      tag: "학부모",
      tagColor: "#D97706",
      tagBg: "#FFF8E1",
      bullets: [
        "아이가 등록한 수영장이 없는 경우 가입이 불가합니다",
        "수영장에서 자녀 회원등록을 먼저 마쳐야 가입 가능",
        "가입 후 수업일지·사진·출결을 실시간으로 확인",
      ],
      onPress: () => router.push({ pathname: "/pool-join-request", params: isSocial ? socialParams : {} } as any),
    },
  ];

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
        <View style={[styles.logoBox, { backgroundColor: appleId ? "#000" : C.tint }]}>
          <UserPlus size={28} color="#fff" />
        </View>
        <Text style={[styles.title, { color: C.text }]}>회원가입</Text>
        <Text style={[styles.subtitle, { color: C.textSecondary }]}>
          {appleId
            ? "Apple 인증이 완료됐습니다.\n어떤 역할로 가입하시겠어요?"
            : kakaoId
            ? "카카오 인증이 완료됐습니다.\n어떤 역할로 가입하시겠어요?"
            : "어떤 역할로 가입하시겠어요?"}
        </Text>
      </View>

      <View style={styles.cards}>
        {ROLES.map(r => (
          <Pressable
            key={r.key}
            style={({ pressed }) => [styles.roleCard, { backgroundColor: C.card, opacity: pressed ? 0.9 : 1 }]}
            onPress={r.onPress}
          >
            <View style={styles.cardTop}>
              <View style={[styles.roleIconWrap, { backgroundColor: r.iconBg }]}>
                <LucideIcon name={r.icon} size={22} color={r.iconColor} />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={[styles.roleLabel, { color: C.text }]}>{r.label}</Text>
                  <View style={[styles.tag, { backgroundColor: r.tagBg }]}>
                    <Text style={[styles.tagText, { color: r.tagColor }]}>{r.tag}</Text>
                  </View>
                </View>
              </View>
              <ChevronRight size={16} color={C.textMuted} />
            </View>
            <View style={[styles.divider, { backgroundColor: C.border }]} />
            <View style={styles.bullets}>
              {r.bullets.map((b, i) => (
                <View key={i} style={styles.bulletRow}>
                  <View style={[styles.bulletDot, { backgroundColor: r.iconColor }]} />
                  <Text style={[styles.bulletText, { color: C.textSecondary }]}>{b}</Text>
                </View>
              ))}
            </View>
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
  container: { paddingHorizontal: 20, gap: 24 },
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
    borderRadius: 18, padding: 18, gap: 12,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 10, elevation: 3,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  roleIconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  roleLabel: { fontSize: 16, fontFamily: "Pretendard-Regular" },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tagText: { fontSize: 10, fontFamily: "Pretendard-Regular" },
  divider: { height: StyleSheet.hairlineWidth },
  bullets: { gap: 6 },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  bulletDot: { width: 5, height: 5, borderRadius: 3, marginTop: 5, flexShrink: 0 },
  bulletText: { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", lineHeight: 18 },
  loginLink: { alignItems: "center", paddingVertical: 8 },
  loginLinkText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
});
