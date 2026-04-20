import { ArrowLeft } from "lucide-react-native";
import { router } from "expo-router";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const C = Colors.light;
const PURPLE = "#7C3AED";

const CORE_POLICIES = [
  {
    label: "구독 취소",
    desc: "일할 계산 환불 + 자동 회원 탈퇴 (데이터 즉시 삭제)",
  },
  {
    label: "다운그레이드",
    desc: "현재 구독 기간 종료 후 다음 결제일부터 적용",
  },
];

const SECTIONS = [
  {
    title: "1. 구독 취소 및 환불",
    items: [
      "구독을 취소하면 취소 요청일 기준으로 잔여 기간을 일할 계산하여 환불됩니다.",
      "예: 30일 이용권 구독 후 10일 사용 → 남은 20일분 환불",
      "환불금은 App Store(Apple) 또는 Google Play(구글) 결제 수단으로 처리됩니다.",
      "구독 취소 시 서비스는 즉시 중단되며, 자동으로 회원 탈퇴 처리됩니다.",
      "탈퇴 후에는 수영장 운영 데이터(회원, 수업일지, 사진, 영상 등)가 즉시 삭제됩니다.",
      "삭제된 데이터는 복구가 불가능하오니 신중하게 결정해 주세요.",
    ],
  },
  {
    title: "2. 플랜 다운그레이드",
    items: [
      "상위 플랜 → 하위 플랜 다운그레이드는 현재 구독 기간 종료 후 다음 결제일부터 적용됩니다.",
      "다운그레이드 신청 후에도 현재 결제 기간이 끝날 때까지 기존 플랜의 모든 기능을 이용할 수 있습니다.",
      "다운그레이드로 인한 잔여 기간의 차액은 환불되지 않습니다.",
    ],
  },
  {
    title: "3. 플랜 업그레이드",
    items: [
      "하위 플랜 → 상위 플랜 업그레이드는 즉시 적용됩니다.",
      "업그레이드 시 남은 기간에 대한 차액이 즉시 결제됩니다.",
    ],
  },
  {
    title: "4. 무료 플랜 전환 불가",
    items: [
      "SwimNote는 구독 취소 시 무료 플랜으로 자동 전환되지 않습니다.",
      "구독 취소는 서비스 이용 종료 및 자동 회원 탈퇴를 의미합니다.",
      "서비스를 유지하려면 구독을 계속 유지하셔야 합니다.",
    ],
  },
  {
    title: "5. 스토어 환불 정책",
    items: [
      "App Store(Apple) 결제는 Apple의 환불 정책이 우선 적용됩니다.",
      "Google Play(구글) 결제는 Google의 환불 정책이 우선 적용됩니다.",
      "스토어 정책에 따라 환불 처리 기간 및 방식이 달라질 수 있습니다.",
    ],
  },
  {
    title: "6. 환불 문의",
    items: [
      "환불 및 구독 관련 문의는 앱 내 고객센터 또는 이메일로 연락해 주세요.",
      "이메일: support@swimnote.app",
    ],
  },
];

export default function RefundScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <ArrowLeft size={22} color={C.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: C.text }]}>환불 및 결제 정책</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.effectiveDate}>시행일: 2025년 1월 1일 · 버전: v1.0</Text>

        {/* 핵심 정책 요약 */}
        <View style={styles.coreBanner}>
          <Text style={styles.coreBannerTitle}>⚠️ 핵심 정책 요약</Text>
          {CORE_POLICIES.map((p, i) => (
            <View key={i} style={styles.coreRow}>
              <Text style={styles.coreBullet}>•</Text>
              <Text style={styles.coreText}>
                <Text style={{ fontFamily: "Pretendard-Regular" }}>{p.label}</Text>
                {" "}→ {p.desc}
              </Text>
            </View>
          ))}
        </View>

        {/* 섹션별 정책 */}
        {SECTIONS.map((section, si) => (
          <View key={si} style={styles.section}>
            <Text style={[styles.sectionTitle, { color: PURPLE }]}>{section.title}</Text>
            {section.items.map((item, ii) => (
              <View key={ii} style={styles.itemRow}>
                <View style={styles.bullet} />
                <Text style={[styles.itemText, { color: C.textSecondary }]}>{item}</Text>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header:          { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12 },
  backBtn:         { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerTitle:     { flex: 1, textAlign: "center", fontSize: 17, fontFamily: "Pretendard-Regular" },
  content:         { paddingHorizontal: 20, paddingTop: 12, gap: 16 },
  effectiveDate:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#94A3B8" },

  coreBanner:      { backgroundColor: "#FFF7ED", borderRadius: 12, padding: 14,
                     borderWidth: 1, borderColor: "#FED7AA", gap: 8 },
  coreBannerTitle: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#9A3412", marginBottom: 2 },
  coreRow:         { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  coreBullet:      { fontSize: 14, color: "#EA580C", marginTop: 1 },
  coreText:        { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular",
                     color: "#7C2D12", lineHeight: 20 },

  section:         { gap: 8 },
  sectionTitle:    { fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 20 },
  itemRow:         { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  bullet:          { width: 5, height: 5, borderRadius: 3, backgroundColor: PURPLE,
                     marginTop: 8, flexShrink: 0 },
  itemText:        { flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 22 },
});
