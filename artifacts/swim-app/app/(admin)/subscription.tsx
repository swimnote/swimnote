/**
 * (admin)/subscription.tsx — 구독 플랜 선택 화면
 *
 * Coach (개인 선생님, 사진만): Free / Coach30 / Coach50 / Coach100
 * Premier (수영장, 사진+영상): Premier200 / Premier300 / Premier500 / Premier1000
 *
 * 플랜 탭 → RevenueCat 구매 플로우 직접 연동
 * RevenueCat 패키지 미로드 시 → billing 화면으로 폴백
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, Linking, Platform, Pressable, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Crown, Users, HardDrive, Check, Zap, Image as ImageIcon, Video, CreditCard } from "lucide-react-native";
import Colors from "@/constants/colors";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useSubscription, REVENUECAT_SOLO_ENTITLEMENT, REVENUECAT_CENTER_ENTITLEMENT } from "@/lib/revenuecat";

const STORE_NAME    = Platform.OS === "ios" ? "App Store (Apple)" : "Google Play";
const STORE_MANAGE  = Platform.OS === "ios"
  ? "itms-apps://apps.apple.com/account/subscriptions"
  : "https://play.google.com/store/account/subscriptions";

const C = Colors.light;

interface PlanMeta {
  tier: string;
  name: string;
  price: number;
  limit: number;
  storage: string;
  storageMb: number;
  group: "solo" | "center";
  rcPackageId: string | null;
  recommended?: boolean;
}

const SOLO_PLANS: PlanMeta[] = [
  { tier: "free",     name: "Free",        price: 0,      limit: 10,   storage: "100MB", storageMb: 102,    group: "solo",   rcPackageId: null },
  { tier: "starter",  name: "Coach30",     price: 1900,   limit: 30,   storage: "300MB", storageMb: 307,    group: "solo",   rcPackageId: "solo_30" },
  { tier: "basic",    name: "Coach50",     price: 2900,   limit: 50,   storage: "500MB", storageMb: 512,    group: "solo",   rcPackageId: "solo_50" },
  { tier: "standard", name: "Coach100",    price: 5900,   limit: 100,  storage: "1GB",   storageMb: 1024,   group: "solo",   rcPackageId: "solo_100", recommended: true },
];

const CENTER_PLANS: PlanMeta[] = [
  { tier: "center_200", name: "Premier200",  price: 19000,  limit: 200,  storage: "5GB",   storageMb: 5120,   group: "center", rcPackageId: "center_200" },
  { tier: "advance",    name: "Premier300",  price: 27000,  limit: 300,  storage: "10GB",  storageMb: 10240,  group: "center", rcPackageId: "center_300" },
  { tier: "pro",        name: "Premier500",  price: 43000,  limit: 500,  storage: "20GB",  storageMb: 20480,  group: "center", rcPackageId: "center_500" },
  { tier: "max",        name: "Premier1000", price: 79000,  limit: 1000, storage: "50GB",  storageMb: 51200,  group: "center", rcPackageId: "center_1000", recommended: true },
];

function fmt(price: number) {
  return price === 0 ? "무료" : `₩${price.toLocaleString("ko-KR")}`;
}

export default function SubscriptionScreen() {
  const insets = useSafeAreaInsets();
  const { token, refreshPool } = useAuth();
  const [currentTier, setCurrentTier] = useState<string | null>(null);
  const [loading, setLoading]         = useState(true);


  const {
    soloOffering,
    centerOffering,
    isSubscribed,
    activePackageId,
    purchase,
    isPurchasing,
    refetchCustomerInfo,
    offeringsLoading,
    offeringsError,
    offeringsErrorDetail,
    refetchOfferings,
  } = useSubscription();

  // RevenueCat에서 로드된 실제 가격 맵 (rcPackageId → 실제 가격 문자열)
  const rcPriceMap = useMemo(() => {
    const all = [
      ...(soloOffering?.availablePackages ?? []),
      ...(centerOffering?.availablePackages ?? []),
    ];
    const map: Record<string, string> = {};
    for (const pkg of all) {
      if (pkg.product.priceString) map[pkg.identifier] = pkg.product.priceString;
    }
    return map;
  }, [soloOffering, centerOffering]);

  const [policyAgreed,  setPolicyAgreed]  = useState<boolean | null>(null);
  const [policyVersion, setPolicyVersion] = useState<string>("v1.0");

  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmTitle, setConfirmTitle]     = useState("");
  const [confirmMessage, setConfirmMessage] = useState("");
  const [confirmAction, setConfirmAction]   = useState<(() => void) | null>(null);

  function showConfirm(title: string, msg: string, action: () => void) {
    setConfirmTitle(title);
    setConfirmMessage(msg);
    setConfirmAction(() => action);
    setConfirmVisible(true);
  }

  const loadData = useCallback(async () => {
    try {
      const [statusRes, policyRes] = await Promise.all([
        apiRequest(token, "/billing/status"),
        apiRequest(token, "/admin/refund-policy").catch(() => null),
      ]);
      if (statusRes.ok) {
        const d = await statusRes.json();
        setCurrentTier(d.current_plan ?? d.plan_id ?? null);
      }
      if (policyRes?.ok) {
        const d = await policyRes.json();
        if (d.success) {
          setPolicyAgreed(d.agreed && !d.needs_reagree);
          setPolicyVersion(d.version ?? "v1.0");
        }
      }
    } catch {}
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { loadData(); }, [loadData]);
  // 화면 포커스 복귀 시 재조회 (슈퍼관리자 변경 직후 즉시 반영)
  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  async function syncRcToServer(info: any) {
    try {
      const active = info?.entitlements?.active ?? {};
      // center 구독 우선, 없으면 solo
      const centerEnt = active[REVENUECAT_CENTER_ENTITLEMENT] ?? null;
      const soloEnt   = active[REVENUECAT_SOLO_ENTITLEMENT]   ?? null;
      const entitlement = centerEnt ?? soloEnt;
      if (!entitlement) return;
      const entitlementId = centerEnt
        ? REVENUECAT_CENTER_ENTITLEMENT
        : REVENUECAT_SOLO_ENTITLEMENT;
      await apiRequest(token, "/billing/sync-rc-subscription", {
        method: "POST",
        body: JSON.stringify({
          productId:     entitlement.productIdentifier,
          entitlementId,
          expiresAt:     entitlement.expirationDate ? entitlement.expirationDate.slice(0, 10) : null,
          isActive:      true,
        }),
      });
    } catch (e) {
      console.warn("[subscription] 서버 동기화 실패:", e);
    }
  }

  function handlePlanSelect(plan: PlanMeta) {
    if (plan.price === 0 || !plan.rcPackageId) return;

    // 정책 미동의 시 결제 진입 차단
    if (policyAgreed === false) {
      Alert.alert(
        "환불 정책 동의 필요",
        `유료 결제를 진행하려면 환불 정책 동의가 필요합니다.\n현재 버전: ${policyVersion}`,
        [
          { text: "취소", style: "cancel" },
          { text: "환불 정책 확인하러 가기", onPress: () => router.push("/(admin)/refund-policy" as any) },
        ]
      );
      return;
    }

    if (offeringsLoading) {
      showConfirm("구독 상품 로드 중", "구독 상품 정보를 불러오는 중입니다. 잠시 후 다시 시도해주세요.", () => {});
      return;
    }
    if (offeringsError) {
      const detail = offeringsErrorDetail ?? "알 수 없는 오류";
      console.error("[IAP] offerings 로드 실패 — raw error:", offeringsErrorDetail);
      showConfirm(
        "구독 상품 로드 실패",
        `구독 상품 정보를 불러오지 못했습니다.\n\n오류: ${detail}\n\n'확인'을 눌러 다시 시도합니다.`,
        () => refetchOfferings()
      );
      return;
    }

    const allPackages = [
      ...(soloOffering?.availablePackages ?? []),
      ...(centerOffering?.availablePackages ?? []),
    ];
    const pkg = allPackages.find(p => p.identifier === plan.rcPackageId);

    const priceStr    = `₩${plan.price.toLocaleString("ko-KR")}`;
    const isChange    = isSubscribed;
    const actionLabel = isChange ? "플랜 변경" : "구독 시작";
    const confirmBody = isChange
      ? `현재 구독을 ${plan.name}으로 변경합니다.\n${priceStr}/월 · 최대 ${plan.limit.toLocaleString()}명 · ${plan.storage}\n\n결제 수단: ${STORE_NAME}`
      : `${priceStr}/월 · 최대 ${plan.limit.toLocaleString()}명 · ${plan.storage}\n\n결제 수단: ${STORE_NAME}`;

    if (!pkg) {
      showConfirm(
        "구독 상품 로드 중",
        "구독 상품 정보를 불러오는 중입니다. 잠시 후 다시 시도해주세요.",
        () => refetchOfferings(),
      );
      return;
    }

    showConfirm(
      `${plan.name} ${actionLabel}`,
      confirmBody,
      async () => {
        try {
          const info = await purchase(pkg);
          await syncRcToServer(info);
          await refetchCustomerInfo();
          await refreshPool();
          showConfirm("구독 완료", "구독이 성공적으로 시작되었습니다!", () => {});
        } catch (e: any) {
          if (e?.userCancelled) return;
          showConfirm("구독 실패", e?.message ?? "결제 중 오류가 발생했습니다.", () => {});
        }
      }
    );
  }

  const goToBilling = () => router.push("/(admin)/billing");

  // 가격·이름·스토리지는 클라이언트 하드코딩 값 고정 사용 (서버 값 무시)
  function mergePlan(plan: PlanMeta): PlanMeta {
    return plan;
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SubScreenHeader title="구독 관리" />

      {/* 환불 정책 미동의 배너 */}
      {policyAgreed === false && (
        <Pressable
          style={policyBannerStyle}
          onPress={() => router.push("/(admin)/refund-policy" as any)}
        >
          <View style={{ flex: 1 }}>
            <Text style={policyBannerTitle}>유료 결제를 진행하려면 환불 정책 확인이 필요합니다.</Text>
            <Text style={policyBannerDesc}>현재 버전: {policyVersion} · 탭하여 확인하기</Text>
          </View>
          <CreditCard size={18} color="#D97706" />
        </Pressable>
      )}

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

          {SOLO_PLANS.map(raw => { const plan = mergePlan(raw); return (
            <PlanCard
              key={plan.tier}
              plan={plan}
              isCurrent={currentTier === plan.tier}
              accentColor="#7C3AED"
              isPurchasing={isPurchasing}
              isUserSubscribed={isSubscribed}
              onSelect={plan.price === 0 ? undefined : () => handlePlanSelect(plan)}
              rcPriceString={plan.rcPackageId ? rcPriceMap[plan.rcPackageId] : undefined}
            />
          ); })}

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

          {CENTER_PLANS.map(raw => { const plan = mergePlan(raw); return (
            <PlanCard
              key={plan.tier}
              plan={plan}
              isCurrent={currentTier === plan.tier}
              accentColor="#F59E0B"
              isPurchasing={isPurchasing}
              isUserSubscribed={isSubscribed}
              onSelect={() => handlePlanSelect(plan)}
              rcPriceString={plan.rcPackageId ? rcPriceMap[plan.rcPackageId] : undefined}
            />
          ); })}

          {/* ── 결제 수단 안내 ── */}
          <View style={s.storePlatformBox}>
            <CreditCard size={14} color="#64748B" />
            <Text style={s.storePlatformText}>
              이 기기 결제 수단: <Text style={s.storePlatformBold}>{STORE_NAME}</Text>
            </Text>
          </View>

          {/* ── 구독 관리 / 해지 ── */}
          {isSubscribed && (
            <Pressable
              style={({ pressed }) => [s.billingBtn, s.manageBtn, { opacity: pressed ? 0.7 : 1 }]}
              onPress={() => Linking.openURL(STORE_MANAGE)}
            >
              <Text style={s.manageBtnText}>
                {Platform.OS === "ios" ? "App Store에서 구독 관리·해지" : "Google Play에서 구독 관리·해지"}
              </Text>
            </Pressable>
          )}

          <Pressable
            style={({ pressed }) => [s.billingBtn, { opacity: pressed ? 0.7 : 1 }]}
            onPress={goToBilling}
          >
            <Text style={s.billingBtnText}>구독 현황 관리</Text>
          </Pressable>

          <Text style={[s.disclaimer, { color: C.textMuted }]}>
            부가세(VAT) 포함 금액입니다. 구독은 매월 자동 갱신됩니다.{"\n"}
            {Platform.OS === "ios"
              ? "결제는 App Store(Apple)를 통해 처리됩니다."
              : "결제는 Google Play를 통해 처리됩니다."}
          </Text>

          <View style={s.legalRow}>
            <Pressable onPress={() => router.push("/terms" as any)} style={({ pressed }) => [s.legalBtn, { opacity: pressed ? 0.6 : 1 }]}>
              <Text style={[s.legalBtnText, { color: C.tint }]}>이용약관 (EULA)</Text>
            </Pressable>
            <Text style={[s.legalSep, { color: C.textMuted }]}>·</Text>
            <Pressable onPress={() => router.push("/privacy" as any)} style={({ pressed }) => [s.legalBtn, { opacity: pressed ? 0.6 : 1 }]}>
              <Text style={[s.legalBtnText, { color: C.tint }]}>개인정보처리방침</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}

      <ConfirmModal
        visible={confirmVisible}
        title={confirmTitle}
        message={confirmMessage}
        onConfirm={() => { setConfirmVisible(false); confirmAction?.(); }}
        onCancel={() => setConfirmVisible(false)}
      />
    </View>
  );
}

function PlanCard({
  plan, isCurrent, accentColor, isPurchasing, isUserSubscribed, onSelect, rcPriceString,
}: {
  plan: PlanMeta;
  isCurrent: boolean;
  accentColor: string;
  isPurchasing?: boolean;
  isUserSubscribed?: boolean;
  onSelect?: () => void;
  rcPriceString?: string;
}) {
  const isFree = plan.price === 0;
  const actionLabel = isCurrent
    ? "현재 플랜"
    : isUserSubscribed
      ? "플랜 변경하기"
      : `구독하기`;

  return (
    <Pressable
      style={({ pressed }) => [
        s.planCard,
        isCurrent && { borderColor: accentColor, borderWidth: 2 },
        isFree && { borderStyle: "dashed" as const },
        { opacity: pressed && onSelect ? 0.92 : 1 },
      ]}
      onPress={onSelect}
      disabled={!onSelect || isPurchasing}
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
          {isFree ? "무료" : fmt(plan.price)}
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

      {!isFree && (
        <View style={[
          s.cardAction,
          { backgroundColor: isCurrent ? "#F1F5F9" : accentColor + "14", borderColor: isCurrent ? "#E2E8F0" : accentColor + "40" },
        ]}>
          <Text style={[s.cardActionText, { color: isCurrent ? "#94A3B8" : accentColor }]}>
            {actionLabel}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const policyBannerStyle = {
  flexDirection: "row" as const,
  alignItems: "center" as const,
  gap: 12,
  backgroundColor: "#FFFBEB",
  borderBottomWidth: 1,
  borderBottomColor: "#FDE68A",
  paddingHorizontal: 16,
  paddingVertical: 12,
};
const policyBannerTitle = { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#92400E" };
const policyBannerDesc  = { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#D97706", marginTop: 2 };

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
  cardAction:     { marginTop: 10, paddingVertical: 9, borderRadius: 10, borderWidth: 1, alignItems: "center" },
  cardActionText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  storePlatformBox: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: "#F8FAFC", borderRadius: 10, borderWidth: 1, borderColor: "#E2E8F0", marginTop: 4 },
  storePlatformText: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B", flex: 1 },
  storePlatformBold: { fontFamily: "Pretendard-Regular", color: "#0F172A" },
  billingBtn:     { marginTop: 6, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: "#2EC4B6", alignItems: "center" },
  billingBtnText: { color: "#2EC4B6", fontSize: 15, fontFamily: "Pretendard-Regular" },
  manageBtn:      { borderColor: "#64748B" },
  manageBtnText:  { color: "#64748B", fontSize: 14, fontFamily: "Pretendard-Regular" },
  disclaimer: { fontSize: 12, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 18 },
  legalRow:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 10, marginBottom: 8 },
  legalBtn:     { paddingVertical: 4, paddingHorizontal: 2 },
  legalBtnText: { fontSize: 12, fontFamily: "Pretendard-Regular", textDecorationLine: "underline" },
  legalSep:     { fontSize: 12, fontFamily: "Pretendard-Regular" },
});
