/**
 * (super)/op-group.tsx — 운영 관리 그룹
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useOperatorsStore } from "@/store/operatorsStore";
import Colors from "@/constants/colors";
const C = Colors.light;

const P = "#7C3AED";

const MENUS = [
  {
    icon: "users" as const,
    title: "운영자 관리",
    sub: "운영자 목록·제한·해지·플랜 상태·로그",
    path: "/(super)/pools",
    color: P,
    bg: "#EEDDF5",
  },
  {
    icon: "hard-drive" as const,
    title: "저장공간 관리",
    sub: "사용량·급증·차단·삭제 큐·임시허용",
    path: "/(super)/storage",
    color: "#2EC4B6",
    bg: "#E6FFFA",
  },
  {
    icon: "sliders" as const,
    title: "저장공간 정책",
    sub: "자동삭제·차단·급증 임계값 설정",
    path: "/(super)/storage-policy",
    color: "#2EC4B6",
    bg: "#ECFEFF",
  },
  {
    icon: "bell" as const,
    title: "공지·팝업 관리",
    sub: "공지 등록·수정·삭제, 대상별 팝업 설정",
    path: "/(super)/notices",
    color: "#2EC4B6",
    bg: "#E6FFFA",
  },
];

export default function OpGroupScreen() {
  const operators = useOperatorsStore(s => s.operators);
  const pendingCount = operators.filter(o => o.status === 'pending').length;

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="운영 관리" homePath="/(super)/dashboard" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 60 }}>
        {/* 요약 */}
        <View style={s.summaryRow}>
          <View style={s.summaryCard}>
            <Text style={s.summaryNum}>{operators.length}</Text>
            <Text style={s.summaryLabel}>전체 운영자</Text>
          </View>
          <View style={[s.summaryCard, pendingCount > 0 && s.summaryAlert]}>
            <Text style={[s.summaryNum, pendingCount > 0 && { color: "#D97706" }]}>{pendingCount}</Text>
            <Text style={s.summaryLabel}>승인 대기</Text>
          </View>
        </View>

        {MENUS.map(m => (
          <Pressable key={m.path} style={s.card} onPress={() => router.push(m.path as any)}>
            <View style={[s.iconBox, { backgroundColor: m.bg }]}>
              <Feather name={m.icon} size={22} color={m.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>{m.title}</Text>
              <Text style={s.cardSub}>{m.sub}</Text>
            </View>
            <Feather name="chevron-right" size={16} color="#D1D5DB" />
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: C.background },
  summaryRow:   { flexDirection: "row", gap: 8, marginBottom: 6 },
  summaryCard:  { flex: 1, backgroundColor: "#fff", borderRadius: 12, padding: 12, alignItems: "center",
                  borderWidth: 1, borderColor: "#E5E7EB" },
  summaryAlert: { borderColor: "#FCA5A5", backgroundColor: "#FFF5F5" },
  summaryNum:   { fontSize: 22, fontFamily: "Pretendard-Bold", color: "#111827" },
  summaryLabel: { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#6B7280", marginTop: 3 },
  card:         { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "#fff",
                  borderRadius: 14, padding: 16, borderWidth: 1, borderColor: "#E5E7EB" },
  iconBox:      { width: 48, height: 48, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  cardTitle:    { fontSize: 15, fontFamily: "Pretendard-Bold", color: "#111827" },
  cardSub:      { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#6B7280", marginTop: 3, lineHeight: 17 },
});
