/**
 * (super)/support-group.tsx — 지원 센터 그룹
 * 스펙 섹션 9: 고객센터 / 정책·컴플라이언스 / SMS 템플릿 관리 / 발송 로그 관리 / 인증번호 발송 기록
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useSupportStore } from "@/store/supportStore";
import { useSmsStore } from "@/store/smsStore";
import { useSmsCreditStore } from "@/store/smsCreditStore";

const MENUS = [
  {
    icon: "message-circle" as const,
    title: "고객센터",
    sub: "문의 처리·SLA·환불·결제연결·에스컬레이션",
    path: "/(super)/support",
    color: "#0284C7",
    bg: "#E0F2FE",
  },
  {
    icon: "file-text" as const,
    title: "정책·컴플라이언스",
    sub: "환불정책·개인정보·약관 버전·동의 확인",
    path: "/(super)/policy",
    color: "#D97706",
    bg: "#FEF3C7",
  },
  {
    icon: "edit-3" as const,
    title: "SMS 템플릿 관리",
    sub: "발송 템플릿 편집·활성/비활성·버전 관리",
    path: "/(super)/invite-sms",
    color: "#7C3AED",
    bg: "#EDE9FE",
  },
  {
    icon: "list" as const,
    title: "발송 로그 관리",
    sub: "전체 SMS 발송 이력·실패 내역·운영자별 조회",
    path: "/(super)/sms-billing",
    color: "#0891B2",
    bg: "#ECFEFF",
  },
  {
    icon: "key" as const,
    title: "인증번호 발송 기록",
    sub: "휴대폰 인증·2FA 인증·재발송·실패 기록",
    path: "/(super)/sms-billing",
    color: "#059669",
    bg: "#D1FAE5",
  },
];

export default function SupportGroupScreen() {
  const openCount   = useSupportStore(s => s.getOpenCount());
  const slaOverdue  = useSupportStore(s => s.getSlaOverdueCount());
  const rawRecords  = useSmsStore(s => s.records);
  const rawInvites  = useSmsStore(s => s.invites);
  const smsAccounts = useSmsCreditStore(s => s.accounts);

  const smsRecords  = rawRecords  ?? [];
  const invites     = rawInvites  ?? [];
  const failedSms   = smsRecords.filter(r => r.status === "failed").length;
  const pendingInv  = invites.filter(r => r.status === "pending").length;
  const blockedOps  = smsAccounts.filter(a => a.smsBlocked).length;

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
            <Text style={[s.summaryNum, slaOverdue > 0 && { color: "#DC2626" }]}>{slaOverdue}</Text>
            <Text style={s.summaryLabel}>SLA 초과</Text>
          </View>
          <View style={[s.summaryCard, pendingInv > 0 && s.summaryAlertPurple]}>
            <Text style={[s.summaryNum, pendingInv > 0 && { color: "#7C3AED" }]}>{pendingInv}</Text>
            <Text style={s.summaryLabel}>대기 초대</Text>
          </View>
          <View style={[s.summaryCard, failedSms > 0 && s.summaryAlertRed]}>
            <Text style={[s.summaryNum, failedSms > 0 && { color: "#DC2626" }]}>{failedSms}</Text>
            <Text style={s.summaryLabel}>SMS 실패</Text>
          </View>
          <View style={[s.summaryCard, blockedOps > 0 && s.summaryAlertRed]}>
            <Text style={[s.summaryNum, blockedOps > 0 && { color: "#DC2626" }]}>{blockedOps}</Text>
            <Text style={s.summaryLabel}>SMS 차단</Text>
          </View>
        </View>

        {/* 메뉴 */}
        {MENUS.map((m, idx) => (
          <Pressable key={idx} style={s.card} onPress={() => router.push(m.path as any)}>
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
  safe:              { flex: 1, backgroundColor: "#F5F3FF" },
  summaryRow:        { flexDirection: "row", gap: 5, marginBottom: 6, flexWrap: "wrap" },
  summaryCard:       { flex: 1, minWidth: "18%", backgroundColor: "#fff", borderRadius: 12, padding: 10,
                       alignItems: "center", borderWidth: 1, borderColor: "#E5E7EB" },
  summaryAlertBlue:  { borderColor: "#BAE6FD", backgroundColor: "#F0F9FF" },
  summaryAlertPurple:{ borderColor: "#C4B5FD", backgroundColor: "#F5F3FF" },
  summaryAlertRed:   { borderColor: "#FCA5A5", backgroundColor: "#FFF5F5" },
  summaryNum:        { fontSize: 18, fontFamily: "Inter_700Bold", color: "#111827" },
  summaryLabel:      { fontSize: 9, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2, textAlign: "center" },
  card:              { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "#fff",
                       borderRadius: 14, padding: 16, borderWidth: 1, borderColor: "#E5E7EB" },
  iconBox:           { width: 48, height: 48, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  cardTitle:         { fontSize: 15, fontFamily: "Inter_700Bold", color: "#111827" },
  cardSub:           { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 3, lineHeight: 17 },
});
