/**
 * 데이터 관리 — 메인 목록
 * 사용 현황 / 관리 / 기록 3개 섹션
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const C = Colors.light;

interface MenuItem {
  label: string;
  desc: string;
  icon: string;
  color: string;
  bg: string;
  route: string;
}

const SECTIONS: { title: string; items: MenuItem[] }[] = [
  {
    title: "사용 현황",
    items: [
      { label: "저장공간 현황",    desc: "총 사용량 · 제공 용량 · 게이지", icon: "pie-chart",   color: "#2563EB", bg: "#DBEAFE", route: "/(admin)/data-storage-overview"    },
      { label: "계정별 사용량",    desc: "선생님 계정별 저장 현황",          icon: "users",       color: "#7C3AED", bg: "#EDE9FE", route: "/(admin)/data-storage-by-account"  },
      { label: "카테고리별 사용량", desc: "사진 · 영상 · 메신저 · 기록",     icon: "bar-chart-2", color: "#0D9488", bg: "#CCFBF1", route: "/(admin)/data-storage-by-category" },
    ],
  },
  {
    title: "관리",
    items: [
      { label: "원본 데이터 삭제", desc: "선택 기간 파일 영구 삭제 (킬 스위치)", icon: "alert-triangle", color: "#DC2626", bg: "#FEE2E2", route: "/(admin)/data-delete" },
    ],
  },
  {
    title: "기록",
    items: [
      { label: "이벤트 기록", desc: "삭제 · 결제 · 구독 · 권한 · 선생님 이력", icon: "clock", color: "#6B7280", bg: "#F3F4F6", route: "/(admin)/data-event-logs" },
    ],
  },
];

export default function DataManagementScreen() {
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SubScreenHeader title="데이터 관리" onBack={() => router.navigate("/(admin)/more" as any)} />

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 24, paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >
        {SECTIONS.map(section => (
          <View key={section.title}>
            <Text style={s.sectionTitle}>{section.title}</Text>
            <View style={[s.card, { backgroundColor: C.card }]}>
              {section.items.map((item, idx) => (
                <Pressable
                  key={item.label}
                  style={({ pressed }) => [
                    s.row,
                    idx < section.items.length - 1 && s.rowBorder,
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                  onPress={() => router.push(item.route as any)}
                >
                  <View style={[s.iconWrap, { backgroundColor: item.bg }]}>
                    <Feather name={item.icon as any} size={20} color={item.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.label}>{item.label}</Text>
                    <Text style={s.desc}>{item.desc}</Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={C.textMuted} />
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
  sectionTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#6B7280", marginBottom: 8, paddingHorizontal: 4 },
  card:         { borderRadius: 18, overflow: "hidden", shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  row:          { flexDirection: "row", alignItems: "center", gap: 14, padding: 16 },
  rowBorder:    { borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  iconWrap:     { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  label:        { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#111827" },
  desc:         { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2 },
});
