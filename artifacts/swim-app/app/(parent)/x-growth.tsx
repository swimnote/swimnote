/**
 * (parent)/x-growth.tsx — SWIMNOTE X 성장 리포트 (학부모용) (WP4 placeholder)
 *
 * XModeGuard로 보호: mode !== "x" 이면 홈으로 redirect.
 * WP17(학부모 화면) 이후 실제 기능으로 교체됩니다.
 */

import React from "react";
import {
  Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LucideIcon } from "@/components/common/LucideIcon";
import { XModeGuard } from "@/components/common/XModeGuard";
import Colors from "@/constants/colors";

const C = Colors.light;
// X 전용 토큰 — A1 Theme Polish (Steel Blue)
const MINT       = "#355C7D";   // xAccent
const MINT_LIGHT = "#E9EEF3";   // xAccentLight
const NAVY       = "#23415C";   // xAccentStrong

const FEATURES = [
  { icon: "activity",       label: "실시간 성장판",         sub: "자녀의 수영 항목별 달성 현황" },
  { icon: "file-text",      label: "월별 성장 리포트",      sub: "AI가 분석한 자녀 성장 요약" },
  { icon: "award",          label: "커리큘럼 달성 현황",    sub: "수영 커리큘럼 단계별 진도" },
];

export default function ParentXGrowthScreen() {
  const insets = useSafeAreaInsets();

  return (
    <XModeGuard allowedKind="parent">
      <View style={{ flex: 1, backgroundColor: C.background }}>
        {/* 헤더 */}
        <View style={[s.header, { paddingTop: insets.top + 14 }]}>
          <Pressable
            hitSlop={12}
            onPress={() => router.back()}
            style={s.backBtn}
          >
            <LucideIcon name="arrow-left" size={20} color={NAVY} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={s.title}>성장 리포트</Text>
              <View style={s.xBadge}>
                <Text style={s.xBadgeTxt}>SWIMNOTE X</Text>
              </View>
            </View>
            <Text style={s.sub}>자녀의 수영 성장을 한눈에</Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
        >
          {/* 준비 중 배너 */}
          <View style={s.comingSoonCard}>
            <Text style={{ fontSize: 32, marginBottom: 8 }}>📈</Text>
            <Text style={s.comingSoonTitle}>곧 만나요!</Text>
            <Text style={s.comingSoonSub}>
              자녀의 수영 성장을 AI로 분석하는{"\n"}
              SWIMNOTE X 리포트가 준비 중이에요.
            </Text>
          </View>

          {/* 예정 기능 목록 */}
          <Text style={s.sectionLabel}>출시 예정 기능</Text>
          {FEATURES.map(f => (
            <View key={f.label} style={s.featureCard}>
              <View style={s.featureIcon}>
                <LucideIcon name={f.icon as any} size={18} color={MINT} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.featureLabel}>{f.label}</Text>
                <Text style={s.featureSub}>{f.sub}</Text>
              </View>
              <View style={s.comingSoonChip}>
                <Text style={s.comingSoonChipTxt}>준비중</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </XModeGuard>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.backgroundSoft,
    alignItems: "center", justifyContent: "center",
  },
  title:  { fontSize: 18, fontFamily: "Pretendard-SemiBold", color: NAVY },
  sub:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 1 },
  xBadge: {
    backgroundColor: MINT_LIGHT, borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: MINT,
  },
  xBadgeTxt: { fontSize: 10, fontFamily: "Pretendard-SemiBold", color: NAVY },
  comingSoonCard: {
    backgroundColor: "#fff", borderRadius: 16, padding: 24,
    alignItems: "center",
    borderWidth: 1, borderColor: C.border,
  },
  comingSoonTitle: { fontSize: 16, fontFamily: "Pretendard-SemiBold", color: NAVY, marginBottom: 6 },
  comingSoonSub:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, textAlign: "center", lineHeight: 20 },
  sectionLabel:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 4 },
  featureCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#fff", borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.border,
  },
  featureIcon: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: MINT_LIGHT, alignItems: "center", justifyContent: "center",
  },
  featureLabel: { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: NAVY },
  featureSub:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 },
  comingSoonChip: {
    backgroundColor: C.backgroundSoft, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  comingSoonChipTxt: { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },
});
