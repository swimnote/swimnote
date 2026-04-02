/**
 * 수업관리 허브 — 하단탭 2번째
 * 수업관련 모든 메뉴를 한 화면에서 바로 접근
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
    title: "수업 운영",
    items: [
      { label: "수업 스케줄",   icon: "calendar",    color: "#16A34A", route: "/(admin)/classes",                desc: "반별 수업 일정 및 달력 관리" },
      { label: "반 관리",       icon: "layers",      color: "#0369A1", route: "/(admin)/class-management",      desc: "반 생성 · 수정 · 배정" },
      { label: "출결 관리",     icon: "clipboard",   color: "#EA580C", route: "/(admin)/attendance",            desc: "출석 현황 및 결석 처리" },
      { label: "수업 일지",     icon: "book",        color: "#7C3AED", route: "/(admin)/diary-teacher-entries", desc: "선생님별 수업 일지 열람" },
      { label: "공지사항",      icon: "file-text",   color: "#0369A1", route: "/(admin)/notices",               desc: "학부모 · 선생님 공지 관리" },
    ],
  },
  {
    title: "보강 관리",
    items: [
      { label: "보강 관리",     icon: "rotate-ccw",  color: "#EA580C", route: "/(admin)/makeups",              desc: "보강 신청 · 대기 · 배정 처리" },
      { label: "휴무일 관리",   icon: "x-square",    color: "#1D4ED8", route: "/(admin)/holidays",             desc: "수영장 휴무 · 공휴일 설정" },
      { label: "보강정책 설정", icon: "sliders",     color: "#7C3AED", route: "/(admin)/makeup-policy",        desc: "보강 가능 기간 및 규칙" },
    ],
  },
];

export default function ClassHubScreen() {
  const insets = useSafeAreaInsets();
  const { themeColor } = useBrand();
  const scrollRef = useTabScrollReset("class-hub");

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <View style={[s.header, { paddingTop: insets.top + 14 }]}>
        <Text style={[s.headerTitle, { color: themeColor }]}>수업관리</Text>
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
                  onPress={() => router.push((item.route + "?backTo=class-hub") as any)}
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
