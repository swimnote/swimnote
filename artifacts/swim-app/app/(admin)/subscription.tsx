/**
 * (admin)/subscription.tsx — 구독 플랜 선택 화면
 *
 * Solo 티어 (개인 선생님): 30명 / 50명 / 100명
 * Center 티어 (수영장 운영): 300명 / 500명 / 1000명
 *
 * 결제는 기존 billing 시스템을 통해 처리됩니다.
 */
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Pressable, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Crown, Users, HardDrive, Check, Zap } from "lucide-react-native";
import Colors from "@/constants/colors";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;

interface PlanMeta {
  tier: string;
  name: string;
  price: number;
  limit: number;
  storage: string;
  group: "solo" | "center";
  recommended?: boolean;
}

const PLANS: PlanMeta[] = [
  { tier: "starter",  name: "스타터",  price: 2900,  limit: 30,   storage: "600MB", group: "solo" },
  { tier: "basic",    name: "베이직",  price: 3900,  limit: 50,   storage: "1GB",   group: "solo" },
  { tier: "standard", name: "스탠다드", price: 9900,  limit: 100,  storage: "5GB",   group: "solo", recommended: true },
  { tier: "advance",  name: "어드밴스", price: 29000, limit: 300,  storage: "20GB",  group: "center" },
  { tier: "pro",      name: "프로",    price: 59000, limit: 500,  storage: "40GB",  group: "center" },
  { tier: "max",      name: "맥스",    price: 99000, limit: 1000, storage: "100GB", group: "center", recommended: true },
];

const SOLO_FEATURES  = ["수업일지 무제한", "수업 사진 첨부", "학부모 앱 연동", "출결 관리", "공지/쪽지 발송", "영상 첨부 ❌"];
const CENTER_FEATURES = ["Solo 모든 기능 포함", "수업 영상 첨부 ✅", "여러 선생님 계정", "관리자(sub_admin) 권한"];

function fmt(price: number) {
  return price === 0 ? "무료" : `₩${price.toLocaleString("ko-KR")}`;
}

export default function SubscriptionScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();

  const [currentTier, setCurrentTier] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiRequest(token, "/billing/status");
        if (res.ok) {
          const d = await res.json();
          setCurrentTier(d.plan_id ?? d.current_plan ?? d.subscription_status ?? null);
        }
      } catch {}
      finally { setLoading(false); }
    })();
  }, []);

  const soloPlans   = PLANS.filter(p => p.group === "solo");
  const centerPlans = PLANS.filter(p => p.group === "center");

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SubScreenHeader title="구독 관리" />

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={C.tint} size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Solo 섹션 */}
          <View style={s.groupHeader}>
            <View style={[s.groupIcon, { backgroundColor: "#EDE9FE" }]}>
              <Zap size={18} color="#7C3AED" />
            </View>
            <View>
              <Text style={[s.groupTitle, { color: C.text }]}>Solo</Text>
              <Text style={[s.groupSub, { color: C.textSecondary }]}>개인 선생님 / 소규모</Text>
            </View>
          </View>

          <View style={s.featureBox}>
            {SOLO_FEATURES.map((f, i) => {
              const isNeg = f.includes("❌");
              return (
                <View key={i} style={s.featureRow}>
                  <Text style={{ fontSize: 12, color: isNeg ? "#9CA3AF" : "#10B981" }}>{isNeg ? "✕" : "✓"}</Text>
                  <Text style={[s.featureText, isNeg && { color: "#9CA3AF" }]}>{f.replace("❌", "").replace("✅", "").trim()}</Text>
                </View>
              );
            })}
          </View>

          {soloPlans.map(plan => (
            <PlanCard
              key={plan.tier}
              plan={plan}
              isCurrent={currentTier === plan.tier}
              accentColor="#7C3AED"
              onSelect={() => router.push("/(admin)/billing")}
            />
          ))}

          <View style={s.divider} />

          {/* Center 섹션 */}
          <View style={s.groupHeader}>
            <View style={[s.groupIcon, { backgroundColor: "#FEF3C7" }]}>
              <Crown size={18} color="#F59E0B" />
            </View>
            <View>
              <Text style={[s.groupTitle, { color: C.text }]}>Center</Text>
              <Text style={[s.groupSub, { color: C.textSecondary }]}>수영장 전체 운영</Text>
            </View>
          </View>

          <View style={s.featureBox}>
            {CENTER_FEATURES.map((f, i) => (
              <View key={i} style={s.featureRow}>
                <Text style={{ fontSize: 12, color: "#10B981" }}>✓</Text>
                <Text style={s.featureText}>{f.replace("✅", "").trim()}</Text>
              </View>
            ))}
          </View>

          {centerPlans.map(plan => (
            <PlanCard
              key={plan.tier}
              plan={plan}
              isCurrent={currentTier === plan.tier}
              accentColor="#F59E0B"
              onSelect={() => router.push("/(admin)/billing")}
            />
          ))}

          <Pressable
            style={({ pressed }) => [s.billingBtn, { opacity: pressed ? 0.7 : 1 }]}
            onPress={() => router.push("/(admin)/billing")}
          >
            <Text style={s.billingBtnText}>결제 · 카드 관리</Text>
          </Pressable>

          <Text style={[s.disclaimer, { color: C.textMuted }]}>
            부가세(VAT) 포함 금액입니다. 구독은 매월 자동 갱신됩니다.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

function PlanCard({
  plan, isCurrent, accentColor, onSelect,
}: {
  plan: PlanMeta;
  isCurrent: boolean;
  accentColor: string;
  onSelect: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        s.planCard,
        isCurrent && { borderColor: accentColor, borderWidth: 2 },
        { opacity: pressed ? 0.92 : 1 },
      ]}
      onPress={onSelect}
    >
      {plan.recommended && !isCurrent && (
        <View style={[s.recBadge, { backgroundColor: accentColor }]}>
          <Text style={s.recBadgeText}>추천</Text>
        </View>
      )}
      {isCurrent && (
        <View style={[s.recBadge, { backgroundColor: "#10B981" }]}>
          <Check size={11} color="#fff" />
          <Text style={s.recBadgeText}>현재 플랜</Text>
        </View>
      )}

      <View style={s.planRow}>
        <Text style={s.planName}>{plan.name}</Text>
        <Text style={[s.planPrice, { color: accentColor }]}>
          {fmt(plan.price)}<Text style={s.planPriceSub}>/월</Text>
        </Text>
      </View>

      <View style={s.planMeta}>
        <View style={s.metaItem}>
          <Users size={13} color="#64748B" />
          <Text style={s.metaText}>최대 {plan.limit.toLocaleString()}명</Text>
        </View>
        <View style={s.metaItem}>
          <HardDrive size={13} color="#64748B" />
          <Text style={s.metaText}>{plan.storage}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 16, gap: 10 },
  groupHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8 },
  groupIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  groupTitle: { fontSize: 18, fontFamily: "Pretendard-Regular" },
  groupSub: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  featureBox: { backgroundColor: "#F8FAFC", borderRadius: 12, padding: 12, gap: 5 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  featureText: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#374151" },
  planCard: {
    backgroundColor: "#fff", borderRadius: 16, padding: 16,
    borderWidth: 1.5, borderColor: "#E2E8F0",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
    overflow: "visible",
  },
  recBadge: { position: "absolute", top: -11, right: 14, flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, zIndex: 10 },
  recBadgeText: { color: "#fff", fontSize: 11, fontFamily: "Pretendard-Regular" },
  planRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  planName: { fontSize: 16, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  planPrice: { fontSize: 20, fontFamily: "Pretendard-Regular" },
  planPriceSub: { fontSize: 13, color: "#9CA3AF" },
  planMeta: { flexDirection: "row", gap: 16, marginTop: 8 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B" },
  divider: { height: 1, backgroundColor: "#E2E8F0", marginVertical: 8 },
  billingBtn: { marginTop: 8, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: "#2EC4B6", alignItems: "center" },
  billingBtnText: { color: "#2EC4B6", fontSize: 15, fontFamily: "Pretendard-Regular" },
  disclaimer: { fontSize: 12, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 18 },
});
