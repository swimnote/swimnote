/**
 * (admin)/billing.tsx — 구독관리 (RevenueCat Apple/Google IAP)
 *
 * Apple 3.1.1 준수: 카드 직접 수집 없음, 모든 결제는 Apple IAP / Google Play 처리
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Linking, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useSubscription, PACKAGE_META, REVENUECAT_SOLO_ENTITLEMENT } from "@/lib/revenuecat";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { billingEnabled } from "@/config/billing";
import { CircleAlert, CircleX, CreditCard, ExternalLink, RotateCcw, TriangleAlert, Check, X } from "lucide-react-native";

const STORE_NAME   = Platform.OS === "ios" ? "App Store (Apple)" : "Google Play";
const STORE_MANAGE = Platform.OS === "ios"
  ? "itms-apps://apps.apple.com/account/subscriptions"
  : "https://play.google.com/store/account/subscriptions";

interface BillingStatus {
  is_readonly: boolean;
  upload_blocked: boolean;
  subscription_status: string | null;
  days_until_deletion: number | null;
  member_count: number;
  member_limit: number;
  storage_used_gb: number;
  storage_quota_gb: number;
  storage_used_pct: number;
  plan_name: string | null;
  display_storage: string | null;
  storage_mb: number | null;
  current_tier: string;
  next_billing_at?: string | null;
  // 다운그레이드 예약 필드
  pending_tier?: string | null;
  pending_plan_name?: string | null;
  downgrade_at?: string | null;
}

const TIER_COLOR: Record<string, string> = {
  free:     "#64748B",
  starter:  "#4EA7D8",
  basic:    "#2E9B6F",
  standard: "#2EC4B6",
};

const PAYMENT_FAILED_STATUSES = new Set(["payment_failed", "pending_deletion", "deleted"]);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export default function BillingScreen() {
  if (!billingEnabled) return null;

  const { token, refreshPool } = useAuth();
  const { themeColor } = useBrand();
  const {
    soloOffering,
    centerOffering,
    isSubscribed,
    activePackageId,
    isLoading: rcLoading,
    purchase,
    restore,
    isPurchasing,
    isRestoring,
    customerInfo,
    refetchCustomerInfo,
  } = useSubscription();

  const [billingInfo, setBillingInfo] = useState<BillingStatus | null>(null);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);

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

  const loadBillingInfo = useCallback(async () => {
    try {
      const r  = await apiRequest(token, "/billing/status");
      const sd = await r.json();
      const activeTier = sd.subscription_tier ?? sd.current_plan ?? sd.subscription?.tier ?? "free";
      setBillingInfo({
        is_readonly:         sd.is_readonly ?? false,
        upload_blocked:      sd.upload_blocked ?? false,
        subscription_status: sd.subscription_status ?? null,
        days_until_deletion: sd.days_until_deletion ?? null,
        member_count:        sd.member_count ?? 0,
        member_limit:        sd.member_limit ?? 10,
        storage_used_gb:     sd.storage_used_gb ?? 0,
        storage_quota_gb:    sd.storage_quota_gb ?? 0.5,
        storage_used_pct:    sd.storage_used_pct ?? 0,
        plan_name:           sd.plan_name ?? null,
        display_storage:     sd.display_storage ?? null,
        storage_mb:          sd.storage_mb ?? null,
        current_tier:        activeTier,
        next_billing_at:     sd.next_billing_at ?? sd.subscription?.next_billing_at ?? null,
        pending_tier:        sd.pending_tier ?? null,
        pending_plan_name:   sd.pending_plan_name ?? null,
        downgrade_at:        sd.downgrade_at ?? null,
      });
    } catch (e) {
      console.error("billing status error:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { loadBillingInfo(); }, [loadBillingInfo]);
  // 화면 포커스 복귀 시 재조회 (슈퍼관리자 변경 직후 즉시 반영)
  useFocusEffect(useCallback(() => { loadBillingInfo(); }, [loadBillingInfo]));

  async function syncRcSubscriptionToServer(info: any) {
    try {
      const entitlement = info?.entitlements?.active?.[REVENUECAT_SOLO_ENTITLEMENT];
      if (!entitlement) return;
      await apiRequest(token, "/billing/sync-rc-subscription", {
        method: "POST",
        body: JSON.stringify({
          productId:     entitlement.productIdentifier,
          entitlementId: REVENUECAT_SOLO_ENTITLEMENT,
          expiresAt:     entitlement.expirationDate ? entitlement.expirationDate.slice(0, 10) : null,
          isActive:      true,
        }),
      });
    } catch (e) {
      console.warn("[billing] 서버 동기화 실패 (무시):", e);
    }
  }

  async function handlePurchase(pkg: any) {
    try {
      const info = await purchase(pkg);
      await syncRcSubscriptionToServer(info);
      await loadBillingInfo();
      await refreshPool();
      showConfirm("구독 완료", "구독이 성공적으로 시작되었습니다!", () => {});
    } catch (e: any) {
      if (e?.userCancelled) return;
      showConfirm("구독 실패", e?.message ?? "결제 중 오류가 발생했습니다.", () => {});
    }
  }

  async function handleRestore() {
    try {
      const info = await restore();
      await syncRcSubscriptionToServer(info);
      await loadBillingInfo();
      await refreshPool();
      showConfirm("복원 완료", "이전 구독이 복원되었습니다.", () => {});
    } catch (e: any) {
      showConfirm("복원 실패", e?.message ?? "구독 복원 중 오류가 발생했습니다.", () => {});
    }
  }

  if (loading) {
    return <ActivityIndicator style={{ flex: 1 }} color={themeColor} />;
  }

  const isPaymentFailed = PAYMENT_FAILED_STATUSES.has(billingInfo?.subscription_status ?? "");
  const daysLeft        = billingInfo?.days_until_deletion;
  const storagePct      = billingInfo?.storage_used_pct ?? 0;
  const storageColor    = storagePct >= 100 ? "#DC2626" : storagePct >= 90 ? "#D97706" : storagePct >= 80 ? "#F59E0B" : themeColor;

  const currentTier  = billingInfo?.current_tier ?? "free";
  const tierColor    = TIER_COLOR[currentTier] ?? themeColor;

  const soloPackages   = soloOffering?.availablePackages   ?? [];
  const centerPackages = centerOffering?.availablePackages ?? [];

  return (
    <View style={s.safe}>
      <SubScreenHeader title="구독관리" />

      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); loadBillingInfo(); refetchCustomerInfo(); }}
            tintColor={themeColor}
          />
        }
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 80 }}
        showsVerticalScrollIndicator={false}
      >

        {/* ── 결제 실패 긴급 배너 ── */}
        {isPaymentFailed && (
          <View style={[s.failBanner,
            billingInfo?.subscription_status === "deleted" ? s.failBannerDeleted : s.failBannerActive]}>
            <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
              {billingInfo?.subscription_status === "deleted"
                ? <CircleX size={18} color="#64748B" />
                : <TriangleAlert size={18} color="#DC2626" />
              }
              <View style={{ flex: 1 }}>
                <Text style={[s.failTitle, billingInfo?.subscription_status === "deleted" && { color: "#64748B" }]}>
                  {billingInfo?.subscription_status === "deleted"
                    ? "계정이 삭제되었습니다"
                    : billingInfo?.subscription_status === "pending_deletion"
                    ? "데이터 삭제 예약됨"
                    : "서비스 이용이 제한되었습니다"}
                </Text>
                <Text style={s.failDesc}>
                  {daysLeft != null
                    ? `데이터 삭제까지 ${daysLeft}일 남았습니다. 구독을 재시작하면 복구됩니다.`
                    : "아래에서 구독을 다시 시작해주세요."}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* ── 현재 구독 ── */}
        <Section title="현재 구독">
          <View style={[s.subCard, { borderColor: tierColor + "50" }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={[s.planDot, { backgroundColor: tierColor }]} />
              <View style={{ flex: 1 }}>
                <Text style={s.planName}>
                  {isSubscribed
                    ? (PACKAGE_META[activePackageId ?? ""]?.name ?? billingInfo?.plan_name ?? "구독 중")
                    : (billingInfo?.plan_name ?? "무료 이용")}
                </Text>
                <Text style={s.planMeta}>
                  최대 {billingInfo?.member_limit ?? 10}명
                  {billingInfo?.display_storage ? ` · ${billingInfo.display_storage}` : ""}
                </Text>
              </View>
              <View style={[s.statusBadge, isSubscribed ? s.badgeGreen : s.badgeGray]}>
                <Text style={[s.badgeText, isSubscribed ? { color: "#2EC4B6" } : { color: "#64748B" }]}>
                  {isSubscribed ? "구독 중" : "무료"}
                </Text>
              </View>
            </View>
            <View style={s.infoRow}>
              <Text style={s.metaLabel}>현재 회원 수</Text>
              <Text style={[s.metaValue,
                (billingInfo?.member_count ?? 0) >= (billingInfo?.member_limit ?? 10) && { color: "#D97706" }]}>
                {billingInfo?.member_count ?? 0}명 / {billingInfo?.member_limit ?? 10}명
              </Text>
            </View>
            {isSubscribed && customerInfo?.entitlements.active[REVENUECAT_SOLO_ENTITLEMENT]?.expirationDate && (
              <View style={s.infoRow}>
                <Text style={s.metaLabel}>다음 갱신일</Text>
                <Text style={s.metaValue}>
                  {customerInfo.entitlements.active[REVENUECAT_SOLO_ENTITLEMENT]?.expirationDate?.slice(0, 10) ?? "-"}
                </Text>
              </View>
            )}
            {billingInfo?.next_billing_at && !billingInfo?.pending_tier && (
              <View style={s.infoRow}>
                <Text style={s.metaLabel}>다음 갱신일</Text>
                <Text style={s.metaValue}>{billingInfo.next_billing_at.slice(0, 10)}</Text>
              </View>
            )}
          </View>

          {/* ── 다운그레이드 예약 배너 ── */}
          {billingInfo?.pending_tier && billingInfo?.downgrade_at && (
            <View style={[s.storageBanner, { backgroundColor: "#FEF9C3", borderColor: "#CA8A04", marginTop: 10 }]}>
              <TriangleAlert size={14} color="#CA8A04" />
              <View style={{ flex: 1 }}>
                <Text style={[s.storageBannerTitle, { color: "#92400E" }]}>
                  다운그레이드 예약됨
                </Text>
                <Text style={[s.storageBannerDesc, { color: "#78350F" }]}>
                  {billingInfo.downgrade_at.slice(0, 10)}에{" "}
                  <Text style={{ fontFamily: "Pretendard-SemiBold" }}>
                    {billingInfo.pending_plan_name ?? billingInfo.pending_tier}
                  </Text>{" "}
                  플랜으로 전환됩니다. 그 전까지 현재 플랜이 유지됩니다.
                </Text>
              </View>
            </View>
          )}
        </Section>

        {/* ── 저장공간 ── */}
        <Section title="저장공간">
          <View style={{ gap: 8 }}>
            <View style={s.infoRow}>
              <Text style={s.metaLabel}>사용량</Text>
              <Text style={[s.metaValue, { color: storageColor }]}>
                {(billingInfo?.storage_used_gb ?? 0).toFixed(2)}GB / {billingInfo?.display_storage ?? `${(billingInfo?.storage_quota_gb ?? 0.5).toFixed(1)}GB`}
              </Text>
            </View>
            <View style={s.storageBar}>
              <View style={[s.storageBarFill, {
                width: `${Math.min(storagePct, 100)}%` as any,
                backgroundColor: storageColor,
              }]} />
            </View>
            {storagePct >= 100 && (
              <View style={[s.storageBanner, { backgroundColor: "#FEF2F2", borderColor: "#DC2626" }]}>
                <CircleX size={14} color="#DC2626" />
                <View style={{ flex: 1 }}>
                  <Text style={[s.storageBannerTitle, { color: "#DC2626" }]}>저장공간이 가득 차 업로드가 제한됩니다</Text>
                  <Text style={s.storageBannerDesc}>파일을 삭제하거나 상위 플랜으로 업그레이드하세요.</Text>
                </View>
                <Pressable
                  onPress={() => router.push("/(admin)/data-storage-overview" as any)}
                  style={[s.storageActionBtn, { borderColor: "#DC2626" }]}
                >
                  <Text style={[s.storageActionTxt, { color: "#DC2626" }]}>사진 정리</Text>
                </Pressable>
              </View>
            )}
            {storagePct >= 90 && storagePct < 100 && (
              <View style={[s.storageBanner, { backgroundColor: "#FFFBEB", borderColor: "#F59E0B" }]}>
                <TriangleAlert size={14} color="#D97706" />
                <Text style={[s.storageBannerTitle, { color: "#D97706", flex: 1 }]}>
                  곧 업로드가 차단됩니다. 업그레이드해주세요. ({storagePct}%)
                </Text>
              </View>
            )}
            {storagePct >= 80 && storagePct < 90 && (
              <View style={[s.storageBanner, { backgroundColor: "#FFFBEB", borderColor: "#FDE68A" }]}>
                <CircleAlert size={14} color="#F59E0B" />
                <Text style={[s.storageBannerTitle, { color: "#92400E", flex: 1 }]}>
                  저장공간이 거의 가득 찼습니다. ({storagePct}%)
                </Text>
              </View>
            )}
          </View>
        </Section>

        {/* ── 결제 수단 안내 ── */}
        <View style={s.platformBanner}>
          <CreditCard size={14} color="#475569" />
          <Text style={s.platformBannerText}>
            이 기기 결제 수단: <Text style={s.platformBannerBold}>{STORE_NAME}</Text>
          </Text>
          {isSubscribed && (
            <Pressable
              style={s.platformManageBtn}
              onPress={() => Linking.openURL(STORE_MANAGE)}
            >
              <ExternalLink size={12} color="#2EC4B6" />
              <Text style={s.platformManageTxt}>구독 관리·해지</Text>
            </Pressable>
          )}
        </View>

        {/* ── Coach 구독 플랜 ── */}
        <Section title="Coach 구독 플랜 (개인 선생님)">
          {rcLoading ? (
            <View style={s.emptyOffering}>
              <ActivityIndicator size="small" color={themeColor} />
              <Text style={[s.emptyOfferingText, { marginTop: 8 }]}>플랜 불러오는 중...</Text>
            </View>
          ) : soloPackages.length === 0 ? (
            <View style={s.emptyOffering}>
              <Text style={[s.emptyOfferingText, { fontFamily: "Pretendard-SemiBold", marginBottom: 4 }]}>구독 플랜을 불러올 수 없습니다</Text>
              <Text style={[s.emptyOfferingText, { fontSize: 12, color: "#94A3B8" }]}>
                App Store에 인앱결제 상품이 등록·심사 완료된 후 이용 가능합니다.{"\n"}아래로 당겨서 새로고침하세요.
              </Text>
            </View>
          ) : (
            <View style={{ gap: 14 }}>
              {soloPackages.map((pkg) => {
                const pkgId     = pkg.identifier;
                const meta      = PACKAGE_META[pkgId];
                const isCurrent = isSubscribed && activePackageId === pkg.product.identifier;
                const planName  = meta?.name ?? pkg.product.title ?? pkgId;
                const memberLim = meta?.memberLimit ?? 0;
                const storage   = meta?.storage ?? "";
                const priceStr  = pkg.product.priceString;
                const isChanging   = isSubscribed && !isCurrent;
                const btnLabel    = isCurrent ? "현재 플랜" : isChanging ? "플랜 변경하기" : `${STORE_NAME.split(" ")[0]}로 구독하기`;
                const btnColor    = isCurrent ? "#E5E7EB" : themeColor;
                const btnTxtColor = isCurrent ? "#9CA3AF" : "#fff";
                const confirmMsg  = isChanging
                  ? `현재 구독을 ${planName}으로 변경합니다.\n${priceStr}/월 · 최대 ${memberLim}명 · ${storage}\n\n결제 수단: ${STORE_NAME}`
                  : `${priceStr}/월 · 최대 ${memberLim}명 · ${storage}\n\n결제 수단: ${STORE_NAME}`;
                const featureRows: { label: string; ok: boolean }[] = [
                  { label: "사진 업로드",  ok: true },
                  { label: "출결 관리",    ok: true },
                  { label: "수업 일지",    ok: true },
                  { label: "학부모 연동",  ok: true },
                  { label: "영상 업로드",  ok: false },
                  { label: "화이트라벨",   ok: false },
                ];
                const triggerPurchase = () => {
                  if (isCurrent || isPurchasing) return;
                  showConfirm(isChanging ? `${planName} 플랜 변경` : `${planName} 구독`, confirmMsg, () => handlePurchase(pkg));
                };
                return (
                  <Pressable
                    key={pkgId}
                    onPress={triggerPurchase}
                    disabled={isCurrent || isPurchasing}
                    style={({ pressed }) => [
                      s.planCard,
                      isCurrent && { borderColor: themeColor, borderWidth: 2 },
                      pressed && !isCurrent && { opacity: 0.88 },
                    ]}
                  >
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <View style={{ gap: 2, flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={[s.planCardName, { color: themeColor }]}>{planName}</Text>
                          {isCurrent && (
                            <View style={[s.currentTag, { backgroundColor: themeColor }]}>
                              <Text style={s.currentTagText}>현재</Text>
                            </View>
                          )}
                        </View>
                        <Text style={s.planCardPrice}>{priceStr}<Text style={s.planCardPriceSub}>/월</Text></Text>
                      </View>
                    </View>
                    <View style={s.planCardInfoRow}>
                      <View style={s.planCardInfoChip}><Text style={s.planCardInfoChipText}>최대 {memberLim}명</Text></View>
                      <View style={s.planCardInfoChip}><Text style={s.planCardInfoChipText}>저장공간 {storage}</Text></View>
                    </View>
                    <View style={{ gap: 6, marginTop: 4 }}>
                      {featureRows.map((f) => (
                        <View key={f.label} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          {f.ok ? <Check size={14} color="#16A34A" strokeWidth={2.5} /> : <X size={14} color="#D1D5DB" strokeWidth={2.5} />}
                          <Text style={[s.featureText, !f.ok && { color: "#D1D5DB" }]}>{f.label}</Text>
                          {!f.ok && <Text style={s.featureNote}>(Premier 전용)</Text>}
                        </View>
                      ))}
                    </View>
                    <View style={[s.subscribeBtn, { backgroundColor: btnColor, marginTop: 8 }]}>
                      {isPurchasing ? <ActivityIndicator size="small" color="#fff" /> : <Text style={[s.subscribeBtnText, { color: btnTxtColor }]}>{btnLabel}</Text>}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </Section>

        {/* ── Premier 구독 플랜 ── */}
        <Section title="Premier 구독 플랜 (수영장/센터)">
          {rcLoading ? (
            <View style={s.emptyOffering}>
              <ActivityIndicator size="small" color="#F59E0B" />
              <Text style={[s.emptyOfferingText, { marginTop: 8 }]}>플랜 불러오는 중...</Text>
            </View>
          ) : centerPackages.length === 0 ? (
            <View style={s.emptyOffering}>
              <Text style={[s.emptyOfferingText, { fontFamily: "Pretendard-SemiBold", marginBottom: 4 }]}>구독 플랜을 불러올 수 없습니다</Text>
              <Text style={[s.emptyOfferingText, { fontSize: 12, color: "#94A3B8" }]}>
                App Store에 인앱결제 상품이 등록·심사 완료된 후 이용 가능합니다.{"\n"}아래로 당겨서 새로고침하세요.
              </Text>
            </View>
          ) : (
            <View style={{ gap: 14 }}>
              {centerPackages.map((pkg) => {
                const pkgId     = pkg.identifier;
                const meta      = PACKAGE_META[pkgId];
                const isCurrent = isSubscribed && activePackageId === pkg.product.identifier;
                const planName  = meta?.name ?? pkg.product.title ?? pkgId;
                const memberLim = meta?.memberLimit ?? 0;
                const storage   = meta?.storage ?? "";
                const priceStr  = pkg.product.priceString;
                const isChanging   = isSubscribed && !isCurrent;
                const btnLabel    = isCurrent ? "현재 플랜" : isChanging ? "플랜 변경하기" : `${STORE_NAME.split(" ")[0]}로 구독하기`;
                const btnColor    = isCurrent ? "#E5E7EB" : "#F59E0B";
                const btnTxtColor = isCurrent ? "#9CA3AF" : "#fff";
                const confirmMsg  = isChanging
                  ? `현재 구독을 ${planName}으로 변경합니다.\n${priceStr}/월 · 최대 ${memberLim}명 · ${storage}\n영상 업로드 · 화이트라벨 포함\n\n결제 수단: ${STORE_NAME}`
                  : `${priceStr}/월 · 최대 ${memberLim}명 · ${storage}\n영상 업로드 · 화이트라벨 포함\n\n결제 수단: ${STORE_NAME}`;
                const featureRows: { label: string; ok: boolean }[] = [
                  { label: "사진 업로드",  ok: true },
                  { label: "영상 업로드",  ok: true },
                  { label: "출결 관리",    ok: true },
                  { label: "수업 일지",    ok: true },
                  { label: "학부모 연동",  ok: true },
                  { label: "화이트라벨 (앱 이름·로고 커스텀)", ok: true },
                ];
                const triggerPurchase = () => {
                  if (isCurrent || isPurchasing) return;
                  showConfirm(isChanging ? `${planName} 플랜 변경` : `${planName} 구독`, confirmMsg, () => handlePurchase(pkg));
                };
                return (
                  <Pressable
                    key={pkgId}
                    onPress={triggerPurchase}
                    disabled={isCurrent || isPurchasing}
                    style={({ pressed }) => [
                      s.planCard,
                      { borderColor: isCurrent ? "#F59E0B" : "#FEF3C7" },
                      isCurrent && { borderWidth: 2 },
                      pressed && !isCurrent && { opacity: 0.88 },
                    ]}
                  >
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <View style={{ gap: 2, flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={[s.planCardName, { color: "#F59E0B" }]}>{planName}</Text>
                          {isCurrent && (
                            <View style={[s.currentTag, { backgroundColor: "#F59E0B" }]}>
                              <Text style={s.currentTagText}>현재</Text>
                            </View>
                          )}
                        </View>
                        <Text style={s.planCardPrice}>{priceStr}<Text style={s.planCardPriceSub}>/월</Text></Text>
                      </View>
                    </View>
                    <View style={s.planCardInfoRow}>
                      <View style={[s.planCardInfoChip, { backgroundColor: "#FEF3C7" }]}><Text style={[s.planCardInfoChipText, { color: "#92400E" }]}>최대 {memberLim}명</Text></View>
                      <View style={[s.planCardInfoChip, { backgroundColor: "#FEF3C7" }]}><Text style={[s.planCardInfoChipText, { color: "#92400E" }]}>저장공간 {storage}</Text></View>
                    </View>
                    <View style={{ gap: 6, marginTop: 4 }}>
                      {featureRows.map((f) => (
                        <View key={f.label} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <Check size={14} color="#16A34A" strokeWidth={2.5} />
                          <Text style={s.featureText}>{f.label}</Text>
                        </View>
                      ))}
                    </View>
                    <View style={[s.subscribeBtn, { backgroundColor: btnColor, marginTop: 8 }]}>
                      {isPurchasing ? <ActivityIndicator size="small" color="#fff" /> : <Text style={[s.subscribeBtnText, { color: btnTxtColor }]}>{btnLabel}</Text>}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </Section>

        {/* IAP 안내 */}
        <Text style={s.iapNote}>
          {Platform.OS === "ios"
            ? "구독은 Apple을 통해 결제됩니다. 구독 관리·해지는 설정 → Apple ID → 구독에서 할 수 있습니다."
            : "구독은 Google Play를 통해 결제됩니다. 구독 관리는 Google Play → 구독에서 할 수 있습니다."}</Text>

        {/* ── 구독 복원 ── */}
        <Section title="구독 복원">
          <Text style={s.restoreDesc}>
            이전에 구독한 기록이 있으면 아래 버튼으로 복원할 수 있습니다.
          </Text>
          <Pressable
            onPress={() => showConfirm("구독 복원", "이전에 구독한 기록을 복원합니다.", handleRestore)}
            disabled={isRestoring}
            style={[s.restoreBtn, { borderColor: themeColor }]}
          >
            {isRestoring
              ? <ActivityIndicator size="small" color={themeColor} />
              : <>
                  <RotateCcw size={15} color={themeColor} />
                  <Text style={[s.restoreBtnText, { color: themeColor }]}>구독 복원하기</Text>
                </>
            }
          </Pressable>
        </Section>

      </ScrollView>

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

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: "#fff" },
  section:       { gap: 10 },
  sectionTitle:  { fontSize: 13, fontWeight: "600", color: "#374151"},

  failBanner:        { borderRadius: 10, padding: 14, gap: 10, borderWidth: 1 },
  failBannerActive:  { backgroundColor: "#FEF2F2", borderColor: "#FECACA" },
  failBannerDeleted: { backgroundColor: "#F9FAFB", borderColor: "#E5E7EB" },
  failTitle:         { fontSize: 14, fontWeight: "600", color: "#DC2626" },
  failDesc:          { fontSize: 13, color: "#64748B", marginTop: 2, lineHeight: 18 },

  subCard:    { borderWidth: 1, borderRadius: 12, padding: 14, gap: 8 },
  planDot:    { width: 10, height: 10, borderRadius: 5 },
  planName:   { fontSize: 16, fontWeight: "700", color: "#111827" },
  planMeta:   { fontSize: 12, color: "#64748B" },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1, borderColor: "#E5E7EB" },
  badgeGreen: { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0" },
  badgeGray:  { backgroundColor: "#F9FAFB", borderColor: "#E5E7EB" },
  badgeText:  { fontSize: 12, fontWeight: "600" },
  infoRow:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  metaLabel:  { fontSize: 13, color: "#64748B" },
  metaValue:  { fontSize: 13, fontWeight: "600", color: "#374151" },

  storageBar:        { height: 6, backgroundColor: "#F1F5F9", borderRadius: 3, overflow: "hidden" },
  storageBarFill:    { height: 6, borderRadius: 3 },
  storageBanner:     { flexDirection: "row", gap: 8, padding: 10, borderRadius: 8, alignItems: "center", borderWidth: 1 },
  storageBannerTitle:{ fontSize: 13, fontWeight: "500" },
  storageBannerDesc: { fontSize: 12, color: "#64748B", marginTop: 2 },
  storageActionBtn:  { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1 },
  storageActionTxt:  { fontSize: 12, fontWeight: "600" },

  platformBanner:    { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: "#F8FAFC", borderRadius: 10, borderWidth: 1, borderColor: "#E2E8F0" },
  platformBannerText:{ fontSize: 13, color: "#475569", flex: 1, fontFamily: "Pretendard-Regular" },
  platformBannerBold:{ color: "#0F172A", fontWeight: "600" },
  platformManageBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: "#F0FDFB", borderWidth: 1, borderColor: "#2EC4B6" },
  platformManageTxt: { fontSize: 12, color: "#2EC4B6", fontWeight: "600" },

  emptyOffering:     { padding: 20, alignItems: "center" },
  emptyOfferingText: { color: "#9CA3AF", fontSize: 14 },

  planCard:           { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 14, padding: 16, gap: 10,
                        shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 },
  planCardName:       { fontSize: 17, fontWeight: "700" },
  planCardPrice:      { fontSize: 22, fontWeight: "700", color: "#111827" },
  planCardPriceSub:   { fontSize: 13, fontWeight: "400", color: "#9CA3AF" },
  planCardInfoRow:    { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  planCardInfoChip:   { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: "#F3F4F6" },
  planCardInfoChipText:{ fontSize: 12, fontWeight: "500", color: "#374151" },
  featureText:        { fontSize: 13, color: "#374151" },
  featureNote:        { fontSize: 11, color: "#9CA3AF" },
  currentTag:         { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  currentTagText:     { fontSize: 11, fontWeight: "600", color: "#fff" },
  subscribeBtn:       { paddingVertical: 11, borderRadius: 10, alignItems: "center" },
  subscribeBtnText:   { fontSize: 14, fontWeight: "600" },

  iapNote:    { fontSize: 11, color: "#9CA3AF", textAlign: "center", lineHeight: 16, marginTop: 4 },

  restoreDesc:    { fontSize: 13, color: "#64748B", lineHeight: 18 },
  restoreBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderRadius: 8, paddingVertical: 12, marginTop: 4 },
  restoreBtnText: { fontSize: 14, fontWeight: "600" },
});
