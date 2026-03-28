import { CreditCard, Info } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { ms } from "./memberDetailStyles";
import type { ClassGroup, DetailData } from "./memberDetailTypes";

const C = Colors.light;

interface MemberPaymentTabProps {
  data: DetailData;
  themeColor: string;
  weeklyCount: number;
  assignedClasses: ClassGroup[];
}

export function MemberPaymentTab({ data, themeColor, weeklyCount, assignedClasses }: MemberPaymentTabProps) {
  return (
    <ScrollView contentContainerStyle={ms.tabContent} showsVerticalScrollIndicator={false}>
      <View style={ms.section}>
        <Text style={ms.sectionTitle}>이용 정보</Text>
        {[
          { icon: "calendar" as const, label: "등록일", value: data.created_at ? new Date(data.created_at).toLocaleDateString("ko-KR") : "-" },
          { icon: "edit" as const, label: "최근 수정일", value: data.updated_at ? new Date(data.updated_at).toLocaleDateString("ko-KR") : "-" },
          { icon: "refresh-cw" as const, label: "주 수업 횟수", value: `주 ${weeklyCount}회` },
          { icon: "layers" as const, label: "배정된 반", value: assignedClasses.length > 0 ? assignedClasses.map(c => c.name).join(", ") : "미배정" },
        ].map(({ icon, label, value }) => (
          <View key={label} style={ms.infoRow}>
            <LucideIcon name={icon} size={13} color={C.textMuted} />
            <Text style={ms.infoLabel}>{label}</Text>
            <Text style={ms.infoValue}>{value}</Text>
          </View>
        ))}
      </View>

      <View style={[ms.section, { backgroundColor: "#FFF1BF" }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Info size={16} color="#D97706" />
          <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: "#D97706" }}>개인 결제 내역</Text>
        </View>
        <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: "#92400E", marginTop: 4, lineHeight: 18 }}>
          개인별 결제 내역은 수영장 전체 결제 관리 탭에서 확인할 수 있습니다.{"\n"}
          더보기 → 결제 관리에서 전체 현황을 확인하세요.
        </Text>
        <Pressable style={[ms.outlineBtn, { borderColor: "#D97706", marginTop: 8 }]} onPress={() => router.push("/(admin)/billing" as any)}>
          <CreditCard size={14} color="#D97706" />
          <Text style={[ms.outlineBtnText, { color: "#D97706" }]}>결제 관리 바로가기</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
