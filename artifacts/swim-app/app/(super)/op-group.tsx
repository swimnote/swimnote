/**
 * (super)/op-group.tsx — 운영 관리 그룹
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useOperatorsStore } from "@/store/operatorsStore";
import { useAuth, API_BASE } from "@/context/AuthContext";
import Colors from "@/constants/colors";
const C = Colors.light;

const P = "#7C3AED";

const MENUS = [
  {
    icon: "users" as const,
    title: "운영처 관리",
    sub: "운영처 목록·제한·해지·플랜 상태·로그",
    path: "/(super)/pools",
    color: P,
    bg: "#EEDDF5",
  },
  {
    icon: "zap" as const,
    title: "X모드 관리",
    sub: "운영처별 X 사용권 상태 확인 · 상세에서 수동 제어",
    path: "/(super)/pools",
    color: C.brandStrong,
    bg: C.brandSoft,
  },
  {
    icon: "hard-drive" as const,
    title: "저장공간 관리",
    sub: "사용량·급증·차단·삭제 큐·임시허용",
    path: "/(super)/storage",
    color: C.brandStrong,
    bg: C.brandSoft,
  },
  {
    icon: "sliders" as const,
    title: "저장공간 정책",
    sub: "자동삭제·차단·급증 임계값 설정",
    path: "/(super)/storage-policy",
    color: C.brandStrong,
    bg: "#ECFEFF",
  },
  {
    icon: "bell" as const,
    title: "공지·팝업 관리",
    sub: "공지 등록·수정·삭제, 대상별 팝업 설정",
    path: "/(super)/notices",
    color: C.brandStrong,
    bg: C.brandSoft,
  },
];

export default function OpGroupScreen() {
  const { token } = useAuth();
  const operators = useOperatorsStore(s => s.operators);
  const fetchOperators = useOperatorsStore(s => s.fetchOperators);
  const pendingCount = operators.filter(o => o.status === 'pending').length;

  // 화면 진입·재진입 시 항상 최신 데이터 fetch (뒤로 갔다 돌아와도 갱신)
  useFocusEffect(
    useCallback(() => {
      if (token) fetchOperators(token, API_BASE);
    }, [token, fetchOperators])
  );

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="운영 관리" homePath="/(super)/more" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 60 }}>
        {/* 요약 — 탭하면 해당 목록으로 이동 */}
        <View style={s.summaryRow}>
          <Pressable
            style={s.summaryCard}
            onPress={() => router.push("/(super)/pools?backTo=op-group" as any)}
          >
            <Text style={s.summaryNum}>{operators.length}</Text>
            <Text style={s.summaryLabel}>전체 운영처</Text>
          </Pressable>
          <Pressable
            style={[s.summaryCard, pendingCount > 0 && s.summaryAlert]}
            onPress={() => router.push("/(super)/pools?filter=pending&backTo=op-group" as any)}
          >
            <Text style={[s.summaryNum, pendingCount > 0 && { color: "#D97706" }]}>{pendingCount}</Text>
            <Text style={s.summaryLabel}>승인 대기</Text>
          </Pressable>
        </View>

        {MENUS.map(m => (
          <Pressable key={m.path} style={s.card} onPress={() => router.push((m.path + "?backTo=op-group") as any)}>
            <View style={[s.iconBox, { backgroundColor: m.bg }]}>
              <LucideIcon name={m.icon} size={22} color={m.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>{m.title}</Text>
              <Text style={s.cardSub}>{m.sub}</Text>
            </View>
            <LucideIcon name="chevron-right" size={16} color="#D1D5DB" />
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
                  borderWidth: 1, borderColor: C.border },
  summaryAlert: { borderColor: "#FCA5A5", backgroundColor: "#FFF5F5" },
  summaryNum:   { fontSize: 22, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  summaryLabel: { fontSize: 10, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 3 },
  card:         { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "#fff",
                  borderRadius: 14, padding: 16, borderWidth: 1, borderColor: C.border },
  iconBox:      { width: 48, height: 48, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  cardTitle:    { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  cardSub:      { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 3, lineHeight: 17 },
});
