/**
 * XInfoDetailPage — X 기능 설명 화면 공통 레이아웃
 * 무엇인가 / 왜 필요한가 / 수영장 효과 구조
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import Colors from "@/constants/colors";
import { router } from "expo-router";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const C = Colors.light;
const X_ACCENT = "#355C7D";

export interface XInfoSection {
  label: string;
  body: string;
}

interface Props {
  title: string;
  icon: string;
  tagline: string;
  sections: XInfoSection[];
  noteText?: string;
  ctaLabel?: string;
  onCta?: () => void;
}

export default function XInfoDetailPage({ title, icon, tagline, sections, noteText, ctaLabel, onCta }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      {/* 헤더 */}
      <View style={[s.header, { paddingTop: insets.top + 14 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.backBtn}>
          <LucideIcon name="chevron-left" size={22} color={C.text} />
        </Pressable>
        <Text style={s.headerTitle}>{title}</Text>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {/* 아이콘 + 태그라인 카드 */}
        <View style={[s.heroCard, { backgroundColor: "#EEF4FA" }]}>
          <View style={s.heroIcon}>
            <LucideIcon name={icon as any} size={26} color={X_ACCENT} />
          </View>
          <Text style={s.heroTagline}>{tagline}</Text>
        </View>

        {/* 섹션들 */}
        {sections.map((sec, i) => (
          <View key={i} style={[s.sectionCard, { backgroundColor: C.card }]}>
            <Text style={s.sectionLabel}>{sec.label}</Text>
            <Text style={s.sectionBody}>{sec.body}</Text>
          </View>
        ))}

        {noteText && (
          <View style={s.noteBox}>
            <Text style={s.noteText}>{noteText}</Text>
          </View>
        )}

        {ctaLabel && onCta && (
          <Pressable
            style={({ pressed }) => [s.cta, { opacity: pressed ? 0.8 : 1 }]}
            onPress={onCta}
          >
            <Text style={s.ctaText}>{ctaLabel}</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  header:      { backgroundColor: C.card, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn:     { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontFamily: "Pretendard-Regular", color: C.text },
  heroCard:    { borderRadius: 18, padding: 20, alignItems: "center", gap: 12 },
  heroIcon:    { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  heroTagline: { fontSize: 15, fontFamily: "Pretendard-Regular", color: X_ACCENT, textAlign: "center", lineHeight: 22 },
  sectionCard: { borderRadius: 16, padding: 16, gap: 6, shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 4, elevation: 1 },
  sectionLabel:{ fontSize: 12, fontFamily: "Pretendard-Regular", color: X_ACCENT, letterSpacing: 0.3 },
  sectionBody: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text, lineHeight: 22 },
  noteBox:     { borderRadius: 12, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: C.border, padding: 14 },
  noteText:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 20 },
  cta:         { borderRadius: 14, backgroundColor: "#0F2742", paddingVertical: 15, alignItems: "center" },
  ctaText:     { fontSize: 16, fontFamily: "Pretendard-Regular", color: "#fff" },
});
