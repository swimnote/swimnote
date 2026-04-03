/**
 * (admin)/subscription.tsx — 구독 플랜 선택 화면
 *
 * Coach (개인 선생님, 사진만): Free / Coach30 / Coach50 / Coach100
 * Premier (수영장, 사진+영상): Premier200 / Premier300 / Premier500 / Premier1000
 */
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Platform, Pressable, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Crown, Users, HardDrive, Check, Zap, Image as ImageIcon, Video } from "lucide-react-native";
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
  storageMb: number;
  group: "solo" | "center";
  recommended?: boolean;
}

const SOLO_PLANS: PlanMeta[] = [
  { tier: "free",     name: "Free",       price: 0,      limit: 10,   storage: "500MB", storageMb: 512,    group: "solo" },
  { tier: "starter",  name: "Coach30",   price: 3500,   limit: 30,   storage: "3GB",   storageMb: 3072,   group: "solo" },
  { tier: "basic",    name: "Coach50",   price: 6500,   limit: 50,   storage: "5GB",   storageMb: 5120,   group: "solo" },
  { tier: "standard", name: "Coach100",  price: 9500,   limit: 100,  storage: "10GB",  storageMb: 10240,  group: "solo", recommended: true },
];

const CENTER_PLANS: PlanMeta[] = [
  { tier: "center_200", name: "Premier200",  price: 69000,  limit: 200,  storage: "50GB",  storageMb: 51200,  group: "center" },
  { tier: "advance",    name: "Premier300",  price: 99000,  limit: 300,  storage: "80GB",  storageMb: 81920,  group: "center" },
  { tier: "pro",        name: "Premier500",  price: 149000, limit: 500,  storage: "130GB", storageMb: 133120, group: "center" },
  { tier: "max",        name: "Premier 1000", price: 249000, limit: 1000, storage: "500GB", storageMb: 512000, group: "center", recommended: true },
];

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
          setCurrentTier(d.current_plan ?? d.plan_id ?? null);
        }
      } catch {}
      finally { setLoading(false); }
    })();
  }, []);

  const goToBilling = () => router.push("/(admin)/billing");

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
          {/* Coach 섹션 */}
          <View style={s.sectionHeader}>
            <View style={[s.sectionIcon, { backgroundColor: "#EDE9FE" }]}>
              <Zap size={18} color="#7C3AED" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.sectionTitle, { color: C.text }]}>Coach</Text>
              <Text style={[s.sectionSub, { color: C.textSecondary }]}>개인 선생님</Text>
            </View>
            <View style={s.featurePill}>
              <ImageIcon size={12} color="#7C3AED" />
              <Text style={[s.featurePillText, { color: "#7C3AED" }]}>사진 가능</Text>
            </View>
            <View style={[s.featurePill, s.featurePillGray]}>
              <Video size={12} color="#9CA3AF" />
              <Text style={[s.featurePillText, { color: "#9CA3AF" }]}>영상 불가</Text>
            </View>
          </View>

          {SOLO_PLANS.map(plan => (
            <PlanCard
              key={plan.tier}
              plan={plan}
              isCurrent={currentTier === plan.tier}
              accentColor="#7C3AED"
              onSelect={plan.price === 0 ? undefined : goToBilling}
            />
          ))}

          <View style={s.divider} />

          {/* Premier 섹션 */}
          <View style={s.sectionHeader}>
            <View style={[s.sectionIcon, { backgroundColor: "#FEF3C7" }]}>
              <Crown size={18} color="#F59E0B" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.sectionTitle, { color: C.text }]}>Premier</Text>
              <Text style={[s.sectionSub, { color: C.textSecondary }]}>수영장/센터</Text>
            </View>
            <View style={[s.featurePill, { borderColor: "#F59E0B" }]}>
              <ImageIcon size={12} color="#F59E0B" />
              <Text style={[s.featurePillText, { color: "#F59E0B" }]}>사진+영상</Text>
            </View>
          </View>

          {CENTER_PLANS.map(plan => (
            <PlanCard
              key={plan.tier}
              plan={plan}
              isCurrent={currentTier === plan.tier}
              accentColor="#F59E0B"
              onSelect={goToBilling}
            />
          ))}

          <Pressable
            style={({ pressed }) => [s.billingBtn, { opacity: pressed ? 0.7 : 1 }]}
            onPress={goToBilling}
          >
            <Text style={s.billingBtnText}>
              {Platform.OS === "ios" ? "Apple 구독 관리" : "Google Play 구독 관리"}
            </Text>
          </Pressable>

          <Text style={[s.disclaimer, { color: C.textMuted }]}>
            부가세(VAT) 포함 금액입니다. 구독은 매월 자동 갱신됩니다.{"\n"}
            {Platform.OS === "ios"
              ? "결제는 App Store(Apple)를 통해 처리됩니다."
              : "결제는 Google Play를 통해 처리됩니다."}
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
  onSelect?: () => void;
}) {
  const isFree = plan.price === 0;
  return (
    <Pressable
      style={({ pressed }) => [
        s.planCard,
        isCurrent && { borderColor: accentColor, borderWidth: 2 },
        isFree && { borderStyle: "dashed" as const },
        { opacity: pressed && onSelect ? 0.92 : 1 },
      ]}
      onPress={onSelect}
      disabled={!onSelect}
    >
      {plan.recommended && !isCurrent && (
        <View style={[s.badge, { backgroundColor: accentColor }]}>
          <Text style={s.badgeText}>추천</Text>
        </View>
      )}
      {isCurrent && (
        <View style={[s.badge, { backgroundColor: "#10B981" }]}>
          <Check size={10} color="#fff" />
          <Text style={s.badgeText}>현재</Text>
        </View>
      )}

      <View style={s.planRow}>
        <Text style={[s.planName, { color: isFree ? C.textSecondary : C.text }]}>{plan.name}</Text>
        <Text style={[s.planPrice, { color: isFree ? C.textMuted : accentColor }]}>
          {fmt(plan.price)}
          {!isFree && <Text style={s.planPriceSub}>/월</Text>}
        </Text>
      </View>

      <View style={s.planMeta}>
        <View style={s.metaItem}>
          <Users size={12} color="#64748B" />
          <Text style={s.metaText}>최대 {plan.limit.toLocaleString()}명</Text>
        </View>
        <View style={s.metaItem}>
          <HardDrive size={12} color="#64748B" />
          <Text style={s.metaText}>{plan.storage}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 16, gap: 10 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4, marginBottom: 2 },
  sectionIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sectionTitle: { fontSize: 17, fontFamily: "Pretendard-Regular" },
  sectionSub: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  featurePill: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20, borderWidth: 1, borderColor: "#7C3AED" },
  featurePillGray: { borderColor: "#D1D5DB" },
  featurePillText: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  planCard: {
    backgroundColor: "#fff", borderRadius: 14, padding: 14,
    borderWidth: 1.5, borderColor: "#E2E8F0",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
    overflow: "visible",
  },
  badge: { position: "absolute", top: -10, right: 12, flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8, zIndex: 10 },
  badgeText: { color: "#fff", fontSize: 11, fontFamily: "Pretendard-Regular" },
  planRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  planName: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  planPrice: { fontSize: 19, fontFamily: "Pretendard-Regular" },
  planPriceSub: { fontSize: 12, color: "#9CA3AF" },
  planMeta: { flexDirection: "row", gap: 14, marginTop: 6 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B" },
  divider: { height: 1, backgroundColor: "#E2E8F0", marginVertical: 6 },
  billingBtn: { marginTop: 6, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: "#2EC4B6", alignItems: "center" },
  billingBtnText: { color: "#2EC4B6", fontSize: 15, fontFamily: "Pretendard-Regular" },
  disclaimer: { fontSize: 12, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 18 },
});
