/**
 * 데이터 관리 — 허브 화면
 * 데이터 보호(백업·복구) / 사용 현황 / 삭제·보존 / 기록 4개 섹션
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
  badge?: string;
}

const SECTIONS: { title: string; desc?: string; items: MenuItem[] }[] = [
  {
    title: "데이터 보호",
    desc: "백업 생성 및 장애 시 복구",
    items: [
      {
        label: "백업·복구",
        desc: "스냅샷 생성 · 복구 이력 · 긴급 롤백",
        icon: "rotate-ccw",
        color: "#D96C6C",
        bg: "#F9DEDA",
        route: "/(admin)/recovery",
      },
    ],
  },
  {
    title: "사용 현황",
    desc: "저장공간 분석 및 용량 관리",
    items: [
      {
        label: "저장공간 현황",
        desc: "총 사용량 · 제공 용량 · 게이지",
        icon: "pie-chart",
        color: "#1F8F86",
        bg: "#DDF2EF",
        route: "/(admin)/data-storage-overview",
      },
      {
        label: "계정별 사용량",
        desc: "선생님 계정별 저장 현황",
        icon: "users",
        color: "#7C3AED",
        bg: "#EEDDF5",
        route: "/(admin)/data-storage-by-account",
      },
      {
        label: "카테고리별 사용량",
        desc: "사진 · 영상 · 메신저 · 기록",
        icon: "bar-chart-2",
        color: "#0D9488",
        bg: "#CCFBF1",
        route: "/(admin)/data-storage-by-category",
      },
    ],
  },
  {
    title: "삭제·보존 정책",
    desc: "데이터 보존 기간 및 원본 삭제 관리",
    items: [
      {
        label: "삭제·보존 정책",
        desc: "보존 기간 설정 · 복구 가능 데이터 · 원본 삭제",
        icon: "archive",
        color: "#6F6B68",
        bg: "#F6F3F1",
        route: "/(admin)/data-delete",
        badge: "위험",
      },
    ],
  },
  {
    title: "기록",
    desc: "시스템 이벤트 감사 로그",
    items: [
      {
        label: "이벤트 기록",
        desc: "삭제 · 결제 · 구독 · 권한 · 선생님 이력",
        icon: "clock",
        color: "#6F6B68",
        bg: "#F6F3F1",
        route: "/(admin)/data-event-logs",
      },
    ],
  },
];

export default function DataManagementScreen() {
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SubScreenHeader title="데이터 관리" />

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 24, paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >
        {SECTIONS.map(section => (
          <View key={section.title}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>{section.title}</Text>
              {section.desc && <Text style={s.sectionDesc}>{section.desc}</Text>}
            </View>
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
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={s.label}>{item.label}</Text>
                      {item.badge && (
                        <View style={s.badgeWrap}>
                          <Text style={s.badgeText}>{item.badge}</Text>
                        </View>
                      )}
                    </View>
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
  sectionHeader: { marginBottom: 8, gap: 2 },
  sectionTitle:  { fontSize: 14, fontFamily: "Inter_700Bold", color: C.text },
  sectionDesc:   { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary },
  card:          { borderRadius: 18, overflow: "hidden", shadowColor: "#00000012", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  row:           { flexDirection: "row", alignItems: "center", gap: 14, padding: 16 },
  rowBorder:     { borderBottomWidth: 1, borderBottomColor: "#F6F3F1" },
  iconWrap:      { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  label:         { fontSize: 15, fontFamily: "Inter_600SemiBold", color: C.text },
  desc:          { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  badgeWrap:     { backgroundColor: "#F9DEDA", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText:     { fontSize: 10, fontFamily: "Inter_700Bold", color: "#D96C6C" },
});
