import { ArrowLeft, Heart, Link2, MessageCircle } from "lucide-react-native";
import { router } from "expo-router";
import React from "react";
import {
  Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const C = Colors.light;

export default function ParentInviteInfoScreen() {
  const insets = useSafeAreaInsets();

  const steps = [
    { icon: "message-circle" as const, color: "#2EC4B6", bg: "#E6FFFA", title: "담당 선생님에게 요청", desc: "자녀의 담당 선생님 또는 수영장 관리자에게 초대 링크를 요청하세요." },
    { icon: "link-2" as const,         color: "#7C3AED", bg: "#EDE9FE", title: "초대 링크 수신",      desc: "선생님이 문자 또는 카카오톡으로 전용 초대 링크를 보내드립니다." },
    { icon: "heart" as const,          color: "#E4A93A", bg: "#FFFBEB", title: "링크로 간편 가입",    desc: "받은 링크를 누르면 자녀 정보가 미리 채워진 가입 화면이 열립니다." },
  ];

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: C.background }]}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.headerRow}>
        <Pressable
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
          onPress={() => router.back()}
        >
          <ArrowLeft size={20} color={C.text} />
        </Pressable>
      </View>

      <View style={styles.heroArea}>
        <View style={[styles.heroIcon, { backgroundColor: "#FFFBEB" }]}>
          <Heart size={32} color="#E4A93A" />
        </View>
        <Text style={[styles.heroTitle, { color: C.text }]}>학부모 가입 안내</Text>
        <Text style={[styles.heroDesc, { color: C.textSecondary }]}>
          학부모 계정은 선생님의 초대 링크를 통해서만{"\n"}가입할 수 있습니다
        </Text>
      </View>

      <View style={[styles.infoBox, { backgroundColor: "#FFF8E6", borderColor: "#FDE68A" }]}>
        <Text style={[styles.infoText, { color: "#92400E" }]}>
          💡 자녀 정보 보호를 위해 초대 링크 없이는 가입이 제한됩니다.
        </Text>
      </View>

      <View style={styles.stepSection}>
        <Text style={[styles.stepSectionTitle, { color: C.text }]}>가입 방법</Text>
        {steps.map((s, i) => (
          <View key={i} style={[styles.stepCard, { backgroundColor: C.card }]}>
            <View style={[styles.stepNum, { backgroundColor: s.bg }]}>
              <Text style={[styles.stepNumText, { color: s.color }]}>{i + 1}</Text>
            </View>
            <View style={[styles.stepIconBox, { backgroundColor: s.bg }]}>
              {s.icon === "message-circle" && <MessageCircle size={20} color={s.color} />}
              {s.icon === "link-2"         && <Link2 size={20} color={s.color} />}
              {s.icon === "heart"          && <Heart size={20} color={s.color} />}
            </View>
            <View style={styles.stepInfo}>
              <Text style={[styles.stepTitle, { color: C.text }]}>{s.title}</Text>
              <Text style={[styles.stepDesc, { color: C.textSecondary }]}>{s.desc}</Text>
            </View>
          </View>
        ))}
      </View>

      <Pressable
        style={({ pressed }) => [styles.backToLoginBtn, { backgroundColor: C.tint, opacity: pressed ? 0.85 : 1 }]}
        onPress={() => router.replace("/" as any)}
      >
        <Text style={styles.backToLoginText}>로그인 화면으로</Text>
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.backLink, { opacity: pressed ? 0.6 : 1 }]}
        onPress={() => router.back()}
      >
        <Text style={[styles.backLinkText, { color: C.textSecondary }]}>역할 선택으로 돌아가기</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { paddingHorizontal: 20, gap: 24 },
  headerRow: { flexDirection: "row", alignItems: "center" },
  backBtn: { padding: 4 },
  heroArea: { alignItems: "center", gap: 12, paddingVertical: 8 },
  heroIcon: {
    width: 72, height: 72, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#E4A93A", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 10, elevation: 4,
  },
  heroTitle: { fontSize: 22, fontFamily: "Pretendard-Regular" },
  heroDesc: { fontSize: 14, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 22 },
  infoBox: {
    borderWidth: 1, borderRadius: 14, padding: 14,
  },
  infoText: { fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 20 },
  stepSection: { gap: 10 },
  stepSectionTitle: { fontSize: 16, fontFamily: "Pretendard-Regular", marginBottom: 2 },
  stepCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 12,
    borderRadius: 16, padding: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  stepNum: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  stepNumText: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  stepIconBox: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  stepInfo: { flex: 1, gap: 4 },
  stepTitle: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  stepDesc: { fontSize: 12, fontFamily: "Pretendard-Regular", lineHeight: 18 },
  backToLoginBtn: {
    height: 52, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    marginTop: 4,
  },
  backToLoginText: { color: "#fff", fontSize: 15, fontFamily: "Pretendard-Regular" },
  backLink: { alignItems: "center", paddingVertical: 4 },
  backLinkText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
});
