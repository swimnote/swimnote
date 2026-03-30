/**
 * (super)/support-group.tsx — 지원 센터 그룹
 * 스펙 섹션 9: 고객센터 / 정책·컴플라이언스
 */
import { ChevronRight } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useSupportStore } from "@/store/supportStore";
import Colors from "@/constants/colors";
const C = Colors.light;

const MENUS = [
  {
    icon: "inbox" as const,
    title: "일반 문의",
    sub: "선생님·학부모가 보내는 일반 문의 관리",
    path: "/(super)/support-general",
    color: "#7C3AED",
    bg: "#EEDDF5",
  },
  {
    icon: "message-circle" as const,
    title: "고객센터",
    sub: "문의 처리·SLA·환불·결제연결·에스컬레이션",
    path: "/(super)/support",
    color: "#0284C7",
    bg: "#E0F2FE",
  },
  {
    icon: "bell" as const,
    title: "공지사항 관리",
    sub: "수영장별 공지 작성·수정·발송 관리",
    path: "/(super)/pool-notices",
    color: "#7C3AED",
    bg: "#EEDDF5",
  },
  {
    icon: "file-text" as const,
    title: "정책·컴플라이언스",
    sub: "환불정책·개인정보·약관 버전·동의 확인",
    path: "/(super)/policy",
    color: "#D97706",
    bg: "#FFF1BF",
  },
];

export default function SupportGroupScreen() {
  const openCount   = useSupportStore(s => s.getOpenCount());
  const slaOverdue  = useSupportStore(s => s.getSlaOverdueCount());

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="지원 센터" homePath="/(super)/dashboard" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 60 }}>

        {/* 요약 */}
        <View style={s.summaryRow}>
          <View style={[s.summaryCard, openCount > 0 && s.summaryAlertBlue]}>
            <Text style={[s.summaryNum, openCount > 0 && { color: "#0284C7" }]}>{openCount}</Text>
            <Text style={s.summaryLabel}>미처리 문의</Text>
          </View>
          <View style={[s.summaryCard, slaOverdue > 0 && s.summaryAlertRed]}>
            <Text style={[s.summaryNum, slaOverdue > 0 && { color: "#D96C6C" }]}>{slaOverdue}</Text>
            <Text style={s.summaryLabel}>SLA 초과</Text>
          </View>
        </View>

        {/* 메뉴 */}
        {MENUS.map((m, idx) => (
          <Pressable key={idx} style={s.card} onPress={() => router.push(m.path as any)}>
            <View style={[s.iconBox, { backgroundColor: m.bg }]}>
              <LucideIcon name={m.icon} size={22} color={m.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>{m.title}</Text>
              <Text style={s.cardSub}>{m.sub}</Text>
            </View>
            <ChevronRight size={16} color="#D1D5DB" />
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:              { flex: 1, backgroundColor: C.background },
  summaryRow:        { flexDirection: "row", gap: 5, marginBottom: 6, flexWrap: "wrap" },
  summaryCard:       { flex: 1, minWidth: "18%", backgroundColor: "#fff", borderRadius: 12, padding: 10,
                       alignItems: "center", borderWidth: 1, borderColor: "#E5E7EB" },
  summaryAlertBlue:  { borderColor: "#BAE6FD", backgroundColor: "#F0F9FF" },
  summaryAlertPurple:{ borderColor: "#C4B5FD", backgroundColor: "#EEDDF5" },
  summaryAlertRed:   { borderColor: "#FCA5A5", backgroundColor: "#FFF5F5" },
  summaryNum:        { fontSize: 18, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  summaryLabel:      { fontSize: 9, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2, textAlign: "center" },
  card:              { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "#fff",
                       borderRadius: 14, padding: 16, borderWidth: 1, borderColor: "#E5E7EB" },
  iconBox:           { width: 48, height: 48, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  cardTitle:         { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  cardSub:           { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 3, lineHeight: 17 },
});
