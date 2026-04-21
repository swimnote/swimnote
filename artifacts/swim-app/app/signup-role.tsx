import { ArrowLeft, Briefcase, Award, Heart, Check } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  Pressable, ScrollView, StyleSheet, Text, View, TouchableOpacity,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const C = Colors.light;
const MINT = "#2EC4B6";
const MINT_DARK = "#1BA89B";
const MINT_LIGHT = "#E6FAF8";

type RoleKey = "admin" | "teacher" | "parent";

interface RoleItem {
  key: RoleKey;
  Icon: React.ComponentType<{ size: number; color: string }>;
  iconColor: string;
  label: string;
  desc: string;
  condition: string;
}

const ROLES: RoleItem[] = [
  {
    key: "admin",
    Icon: Briefcase,
    iconColor: "#4F6EF7",
    label: "수영장 대표",
    desc: "수영장을 직접 운영하는 원장/관리자\n또는 1인 레슨 팀을 운영하는 선생님",
    condition: "",
  },
  {
    key: "teacher",
    Icon: Award,
    iconColor: "#2E9B6F",
    label: "선생님",
    desc: "스윔노트에 가입된 수영장에서 근무 중인 선생님",
    condition: "(수영장 대표의 초대 후 가입 가능)",
  },
  {
    key: "parent",
    Icon: Heart,
    iconColor: "#E4A93A",
    label: "학부모",
    desc: "스윔노트에 가입된 수영장에 자녀가 등록된 학부모",
    condition: "(회원 등록 완료 후 이용 가능)",
  },
];

export default function SignupRoleScreen() {
  const insets = useSafeAreaInsets();
  const { appleId, appleEmail, appleName, kakaoId, kakaoPhone } = useLocalSearchParams<{
    appleId?: string; appleEmail?: string; appleName?: string; kakaoId?: string; kakaoPhone?: string;
  }>();

  const [selected, setSelected] = useState<RoleKey | null>(null);

  const isSocial = !!(appleId || kakaoId);
  const socialParams = {
    ...(appleId ? { appleId } : {}),
    ...(kakaoId ? { kakaoId } : {}),
    ...(kakaoPhone ? { phone: kakaoPhone } : {}),
  };

  function handleNext() {
    if (!selected) return;
    if (selected === "admin") {
      router.push({ pathname: "/register", params: isSocial ? socialParams : {} } as any);
    } else if (selected === "teacher") {
      router.push({ pathname: "/(auth)/teacher-signup", params: isSocial ? socialParams : {} } as any);
    } else if (selected === "parent") {
      router.push({ pathname: "/pool-join-request", params: isSocial ? socialParams : {} } as any);
    }
  }

  return (
    <View style={[styles.root, { backgroundColor: C.background }]}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 16, paddingBottom: 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Pressable style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]} onPress={() => router.back()}>
            <ArrowLeft size={20} color={C.text} />
          </Pressable>
        </View>

        <View style={styles.titleArea}>
          <Text style={[styles.title, { color: C.text }]}>어떤 역할로 가입하시겠어요?</Text>
          <Text style={[styles.subtitle, { color: C.textSecondary }]}>
            {appleId
              ? "Apple 인증이 완료됐습니다."
              : kakaoId
              ? "카카오 인증이 완료됐습니다."
              : "역할을 선택하고 다음 단계로 이동하세요."}
          </Text>
        </View>

        <View style={styles.cards}>
          {ROLES.map(r => {
            const isSelected = selected === r.key;
            return (
              <Pressable
                key={r.key}
                style={[
                  styles.roleCard,
                  isSelected
                    ? { backgroundColor: MINT, borderColor: MINT_DARK, borderWidth: 2 }
                    : { backgroundColor: C.card, borderColor: "#E5E5E5", borderWidth: 1.5 },
                ]}
                onPress={() => setSelected(r.key)}
              >
                {isSelected && (
                  <View style={styles.checkBadge}>
                    <Check size={13} color="#fff" strokeWidth={3} />
                  </View>
                )}

                <View style={styles.cardRow}>
                  <View style={[
                    styles.iconWrap,
                    isSelected
                      ? { backgroundColor: "rgba(255,255,255,0.25)" }
                      : { backgroundColor: r.iconColor + "18" },
                  ]}>
                    <r.Icon size={22} color={isSelected ? "#fff" : r.iconColor} />
                  </View>

                  <View style={styles.cardText}>
                    <Text style={[styles.roleLabel, { color: isSelected ? "#fff" : C.text }]}>
                      {r.label}
                    </Text>
                    <Text style={[styles.roleDesc, { color: isSelected ? "rgba(255,255,255,0.9)" : C.textSecondary }]}>
                      {r.desc}
                    </Text>
                    {r.condition ? (
                      <Text style={[styles.roleCondition, { color: isSelected ? "rgba(255,255,255,0.7)" : "#999" }]}>
                        {r.condition}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>

        <Pressable style={({ pressed }) => [styles.loginLink, { opacity: pressed ? 0.6 : 1 }]} onPress={() => router.back()}>
          <Text style={[styles.loginLinkText, { color: C.textSecondary }]}>
            이미 계정이 있으신가요?{" "}
            <Text style={{ color: C.tint }}>로그인</Text>
          </Text>
        </Pressable>
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={[styles.nextBtn, { backgroundColor: selected ? MINT : "#CCC" }]}
          onPress={handleNext}
          disabled={!selected}
          activeOpacity={0.85}
        >
          <Text style={styles.nextBtnText}>다음</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { paddingHorizontal: 20, gap: 24 },
  header: { flexDirection: "row", alignItems: "center" },
  backBtn: { padding: 4 },
  titleArea: { gap: 6 },
  title: { fontSize: 22, fontFamily: "Pretendard-Regular", fontWeight: "700" },
  subtitle: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  cards: { gap: 16 },
  roleCard: {
    borderRadius: 16,
    padding: 18,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  checkBadge: {
    position: "absolute",
    top: 14,
    right: 14,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  cardRow: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  iconWrap: {
    width: 46,
    height: 46,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 2,
  },
  cardText: { flex: 1, gap: 4 },
  roleLabel: { fontSize: 16, fontFamily: "Pretendard-Regular", fontWeight: "700" },
  roleDesc: { fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 20 },
  roleCondition: { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 },
  loginLink: { alignItems: "center", paddingVertical: 4 },
  loginLinkText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  bottomBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: "#fff",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E5E5E5",
  },
  nextBtn: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  nextBtnText: { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular", fontWeight: "600" },
});
