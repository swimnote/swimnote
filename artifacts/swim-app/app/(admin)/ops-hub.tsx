/**
 * 운영관리 허브 — 하단탭 3번째 (기존 회원관리 탭 자리)
 */
import { ChevronRight } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useBrand } from "@/context/BrandContext";
import { useTabScrollReset } from "@/hooks/useTabScrollReset";

const C = Colors.light;
const NB = "#E6FAF8";

type MenuItem = { label: string; icon: string; color: string; route: string; desc: string };

const SECTIONS: { title: string; items: MenuItem[] }[] = [
  {
    title: "회원 · 계정",
    items: [
      { label: "회원 명부",     icon: "users",        color: "#1D4ED8", route: "/(admin)/members",          desc: "전체 등록 회원 목록 관리" },
      { label: "학부모 계정",   icon: "user",         color: "#DB2777", route: "/(admin)/parents",           desc: "학부모 앱 계정 관리" },
      { label: "선생님 관리",   icon: "user-check",   color: "#16A34A", route: "/(admin)/people-teachers",   desc: "선생님 등록 및 권한 설정" },
      { label: "승인 관리",     icon: "check-circle", color: "#16A34A", route: "/(admin)/approvals",         desc: "가입 · 보강 승인 처리" },
      { label: "초대 기록",     icon: "send",         color: "#7C3AED", route: "/(admin)/invite-records",    desc: "초대 링크 발송 이력" },
    ],
  },
  {
    title: "매출 · 정산",
    items: [
      { label: "월별 매출",     icon: "trending-up",  color: "#CA8A04", route: "/(admin)/admin-revenue",     desc: "월별 수납 및 매출 현황" },
      { label: "정산 확인",     icon: "check-square", color: "#16A34A", route: "/(admin)/settlement",        desc: "선생님별 정산 내역" },
    ],
  },
];

export default function OpsHubScreen() {
  const insets = useSafeAreaInsets();
  const { themeColor } = useBrand();
  const scrollRef = useTabScrollReset("ops-hub");

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <View style={[s.header, { paddingTop: insets.top + 14 }]}>
        <Text style={[s.headerTitle, { color: themeColor }]}>운영관리</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: insets.bottom + 80 }}
        showsVerticalScrollIndicator={false}
      >
        {SECTIONS.map(sec => (
          <View key={sec.title} style={s.section}>
            <Text style={s.sectionTitle}>{sec.title}</Text>
            <View style={[s.card, { backgroundColor: C.card }]}>
              {sec.items.map((item, idx) => (
                <Pressable
                  key={item.label}
                  style={({ pressed }) => [
                    s.row,
                    idx < sec.items.length - 1 && s.rowBorder,
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                  onPress={() => router.push((item.route + "?backTo=ops-hub") as any)}
                >
                  <View style={[s.iconBox, { backgroundColor: NB }]}>
                    <LucideIcon name={item.icon as any} size={20} color={item.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.label}>{item.label}</Text>
                    <Text style={s.desc}>{item.desc}</Text>
                  </View>
                  <ChevronRight size={16} color={C.textMuted} />
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  header:      { backgroundColor: "#fff", paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  headerTitle: { fontSize: 20, fontFamily: "Pretendard-Regular" },
  section:     { gap: 8 },
  sectionTitle:{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted, paddingHorizontal: 4 },
  card:        { borderRadius: 18, overflow: "hidden", shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  row:         { flexDirection: "row", alignItems: "center", gap: 14, padding: 14 },
  rowBorder:   { borderBottomWidth: 1, borderBottomColor: C.border },
  iconBox:     { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  label:       { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.text },
  desc:        { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 2 },
});
