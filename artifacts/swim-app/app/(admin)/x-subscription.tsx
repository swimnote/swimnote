/**
 * x-subscription — SWIMNOTE X 정기결제 신청
 * X01: UI 구조만 — 실제 결제 연결은 X02에서 진행
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useMode } from "@/context/ModeContext";
import { router } from "expo-router";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const C = Colors.light;
const NAVY = "#0F2742";
const X_ACCENT = "#355C7D";
const X_LIGHT = "#EEF4FA";

const DISCOUNT_TIERS = [
  { range: "1~100호",   rate: "50% 할인", highlight: true  },
  { range: "101~300호", rate: "30% 할인", highlight: false },
  { range: "301~500호", rate: "10% 할인", highlight: false },
  { range: "501호 이후", rate: "정상가",   highlight: false },
];

const X_FEATURES = [
  "SWIMNOTE AI ENGINE",
  "수영장별 커리큘럼 제작/연결",
  "AI 기반 일지 작성 지원",
  "학부모 AI 기능 (성장 리포트 등)",
];

export default function XSubscriptionScreen() {
  const insets = useSafeAreaInsets();
  const { pool } = useAuth();
  const { mode } = useMode();

  const planLabel = pool?.subscription_tier
    ? (pool.subscription_tier === "free" ? "무료 플랜" : `${pool.subscription_tier} 플랜`)
    : "현재 플랜";

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      {/* 헤더 */}
      <View style={[s.header, { paddingTop: insets.top + 14 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.backBtn}>
          <LucideIcon name="chevron-left" size={22} color={C.text} />
        </Pressable>
        <Text style={s.headerTitle}>정기결제 신청</Text>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>

        {/* 현재 SWIMNOTE 플랜 */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>현재 이용 중인 SWIMNOTE 플랜</Text>
          <View style={[s.card, { backgroundColor: C.card }]}>
            <View style={s.planRow}>
              <View style={[s.planIcon, { backgroundColor: "#F0F7FF" }]}>
                <LucideIcon name="check-circle" size={20} color="#2563EB" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.planName}>{planLabel}</Text>
                <Text style={s.planSub}>앱 운영 및 데이터 관리 서비스 · 현재 이용 중</Text>
              </View>
            </View>
          </View>
        </View>

        {/* SWIMNOTE X 추가 서비스 */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>추가 서비스</Text>
          <View style={[s.card, { backgroundColor: C.card }]}>
            {/* X 헤더 */}
            <View style={[s.xHeader, { backgroundColor: X_LIGHT }]}>
              <View style={s.xBadge}>
                <Text style={s.xBadgeText}>X</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.xTitle, { color: X_ACCENT }]}>SWIMNOTE X</Text>
                <Text style={s.xSubtitle}>별도 정기결제 · 기본 플랜과 독립 운영</Text>
              </View>
              <View style={s.priceBadge}>
                <Text style={s.priceText}>월 150,000원</Text>
                <Text style={s.priceNote}>정상가</Text>
              </View>
            </View>
            {/* 기능 목록 */}
            <View style={{ padding: 14, gap: 10 }}>
              {X_FEATURES.map((f, i) => (
                <View key={i} style={s.featureRow}>
                  <LucideIcon name="check" size={14} color={X_ACCENT} />
                  <Text style={s.featureText}>{f}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* 선착순 할인 정책 */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>선착순 X모드 가맹 할인</Text>
          <View style={[s.card, { backgroundColor: C.card, overflow: "hidden" }]}>
            {DISCOUNT_TIERS.map((tier, i) => (
              <View
                key={i}
                style={[
                  s.tierRow,
                  i < DISCOUNT_TIERS.length - 1 && s.tierRowBorder,
                  tier.highlight && { backgroundColor: X_LIGHT },
                ]}
              >
                <Text style={[s.tierRange, tier.highlight && { color: X_ACCENT }]}>{tier.range}</Text>
                <View style={[s.tierBadge, { backgroundColor: tier.highlight ? X_ACCENT : "#F1F5F9" }]}>
                  <Text style={[s.tierRate, { color: tier.highlight ? "#fff" : C.textSecondary }]}>{tier.rate}</Text>
                </View>
              </View>
            ))}
            <View style={s.discountNote}>
              <Text style={s.discountNoteText}>
                이 할인은 X모드 정기결제에만 적용됩니다. SWIMNOTE 기본 플랜과 무관합니다.
              </Text>
            </View>
          </View>
        </View>

        {/* 결제 구분 안내 */}
        <View style={s.separateCard}>
          <LucideIcon name="info" size={16} color={C.textMuted} />
          <Text style={s.separateText}>
            SWIMNOTE 기본 플랜 결제와 X모드 정기결제는 완전히 별개입니다. 결제일, 갱신일, 해지 모두 독립적으로 운영됩니다.
          </Text>
        </View>

        {/* CTA — X01에서는 비활성 */}
        {(mode === null || mode === "normal") ? (
          <View>
            <Pressable
              style={[s.ctaBtn, { backgroundColor: X_ACCENT + "40" }]}
              disabled
            >
              <Text style={[s.ctaBtnText, { color: X_ACCENT + "80" }]}>정기결제 신청하기</Text>
            </Pressable>
            <Text style={s.ctaNote}>결제 연결은 준비 중입니다. 곧 업데이트됩니다.</Text>
          </View>
        ) : (
          <View style={[s.card, { backgroundColor: X_LIGHT, padding: 16, alignItems: "center" }]}>
            <LucideIcon name="check-circle" size={22} color={X_ACCENT} />
            <Text style={[s.planName, { color: X_ACCENT, marginTop: 8 }]}>
              {mode === "x_pending" ? "X모드 설정 진행 중입니다." : "현재 X모드를 이용하고 있습니다."}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  header:          { backgroundColor: C.card, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn:         { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  headerTitle:     { fontSize: 17, fontFamily: "Pretendard-Regular", color: C.text },
  section:         { gap: 8 },
  sectionTitle:    { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted, paddingHorizontal: 4 },
  card:            { borderRadius: 18, overflow: "hidden", shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  planRow:         { flexDirection: "row", alignItems: "center", gap: 14, padding: 14 },
  planIcon:        { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  planName:        { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.text },
  planSub:         { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 2 },
  xHeader:         { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  xBadge:          { width: 36, height: 36, borderRadius: 10, backgroundColor: X_ACCENT, alignItems: "center", justifyContent: "center" },
  xBadgeText:      { fontSize: 16, fontFamily: "Pretendard-Regular", color: "#fff" },
  xTitle:          { fontSize: 16, fontFamily: "Pretendard-Regular" },
  xSubtitle:       { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 2 },
  priceBadge:      { alignItems: "flex-end" },
  priceText:       { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  priceNote:       { fontSize: 10, fontFamily: "Pretendard-Regular", color: C.textMuted },
  featureRow:      { flexDirection: "row", alignItems: "center", gap: 8 },
  featureText:     { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  tierRow:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14 },
  tierRowBorder:   { borderBottomWidth: 1, borderBottomColor: C.border },
  tierRange:       { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  tierBadge:       { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  tierRate:        { fontSize: 13, fontFamily: "Pretendard-Regular" },
  discountNote:    { padding: 14, borderTopWidth: 1, borderTopColor: C.border },
  discountNoteText:{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted, lineHeight: 18 },
  separateCard:    { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: 12, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: C.border, padding: 14 },
  separateText:    { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 20 },
  ctaBtn:          { borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  ctaBtnText:      { fontSize: 16, fontFamily: "Pretendard-Regular" },
  ctaNote:         { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted, textAlign: "center", marginTop: 8 },
});
