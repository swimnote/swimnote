/**
 * (admin)/billing.tsx — 구독관리 (RevenueCat Apple/Google IAP)
 *
 * Apple 3.1.1 준수: 카드 직접 수집 없음, 모든 결제는 Apple IAP / Google Play 처리
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { router } from "expo-router";
import { useSubscription, PACKAGE_META, REVENUECAT_SOLO_ENTITLEMENT } from "@/lib/revenuecat";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { billingEnabled } from "@/config/billing";
import { CircleAlert, CircleX, RotateCcw, TriangleAlert } from "lucide-react-native";

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
}

interface SubInfo {
  tier: string;
  status: string;
  next_billing_at?: string | null;
  plan_name?: string;
  price_per_month?: number;
  member_limit?: number;
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
  const [subInfo, setSubInfo]         = useState<SubInfo | null>(null);
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
      setSubInfo(sd.subscription ?? null);
      setBillingInfo({
        is_readonly:         sd.is_readonly ?? false,
        upload_blocked:      sd.upload_blocked ?? false,
        subscription_status: sd.subscription_status ?? null,
        days_until_deletion: sd.days_until_deletion ?? null,
        member_count:        sd.member_count ?? 0,
        member_limit:        sd.member_limit ?? 5,
        storage_used_gb:     sd.storage_used_gb ?? 0,
        storage_quota_gb:    sd.storage_quota_gb ?? 0.1,
        storage_used_pct:    sd.storage_used_pct ?? 0,
      });
    } catch (e) {
      console.error("billing status error:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { loadBillingInfo(); }, [loadBillingInfo]);

  async function handlePurchase(pkg: any) {
    try {
      const info = await purchase(pkg);
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
      await restore();
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

  const currentTier  = subInfo?.tier ?? "free";
  const tierColor    = TIER_COLOR[currentTier] ?? themeColor;

  const soloPackages = soloOffering?.availablePackages ?? [];

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
                    ? (PACKAGE_META[activePackageId ?? ""]?.name ?? subInfo?.plan_name ?? "구독 중")
                    : (subInfo?.plan_name ?? "무료 이용")}
                </Text>
                <Text style={s.planMeta}>
                  최대 {billingInfo?.member_limit ?? 5}명
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
                (billingInfo?.member_count ?? 0) >= (billingInfo?.member_limit ?? 5) && { color: "#D97706" }]}>
                {billingInfo?.member_count ?? 0}명 / {billingInfo?.member_limit ?? 5}명
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
          </View>
        </Section>

        {/* ── 저장공간 ── */}
        <Section title="저장공간">
          <View style={{ gap: 8 }}>
            <View style={s.infoRow}>
              <Text style={s.metaLabel}>사용량</Text>
              <Text style={[s.metaValue, { color: storageColor }]}>
                {(billingInfo?.storage_used_gb ?? 0).toFixed(2)}GB / {(billingInfo?.storage_quota_gb ?? 0.1).toFixed(1)}GB
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

        {/* ── Coach 구독 플랜 ── */}
        <Section title="Coach 구독 플랜">
          {rcLoading ? (
            <View style={s.emptyOffering}>
              <ActivityIndicator size="small" color={themeColor} />
              <Text style={[s.emptyOfferingText, { marginTop: 8 }]}>플랜 불러오는 중...</Text>
            </View>
          ) : soloPackages.length === 0 ? (
            <View style={s.emptyOffering}>
              <Text style={s.emptyOfferingText}>구독 플랜을 불러올 수 없습니다.{"\n"}아래 새로고침을 당겨서 재시도해 주세요.</Text>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              {soloPackages.map((pkg) => {
                const pkgId    = pkg.identifier;
                const meta     = PACKAGE_META[pkgId];
                const isCurrent = isSubscribed && activePackageId === pkg.product.identifier;
                const planName  = meta?.name ?? pkg.product.title ?? pkgId;
                const memberLim = meta?.memberLimit ?? 0;
                const storage   = meta?.storage ?? "";
                const priceStr  = pkg.product.priceString;
                const isHigher  = !isSubscribed || (meta?.memberLimit ?? 0) > (PACKAGE_META[activePackageId ?? ""]?.memberLimit ?? 0);
                const btnLabel  = isCurrent ? "현재 플랜" : isHigher ? "업그레이드" : "다운그레이드";
                const btnColor  = isCurrent ? "#E5E7EB" : themeColor;
                const btnTxtColor = isCurrent ? "#9CA3AF" : "#fff";

                return (
                  <View key={pkgId} style={[s.planCard, isCurrent && { borderColor: themeColor, borderWidth: 2 }]}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={[s.planCardName, { color: themeColor }]}>{planName}</Text>
                        {isCurrent && (
                          <View style={[s.currentTag, { backgroundColor: themeColor }]}>
                            <Text style={s.currentTagText}>현재</Text>
                          </View>
                        )}
                      </View>
                      <Text style={s.planCardPrice}>{priceStr}/월</Text>
                      <Text style={s.planCardMeta}>최대 {memberLim}명 · {storage}</Text>
                    </View>
                    <Pressable
                      onPress={() => {
                        if (isCurrent) return;
                        showConfirm(
                          `${planName} 구독`,
                          `${priceStr}/월\n${Platform.OS === "ios" ? "Apple" : "Google Play"}을 통해 결제됩니다.`,
                          () => handlePurchase(pkg),
                        );
                      }}
                      disabled={isCurrent || isPurchasing}
                      style={[s.subscribeBtn, { backgroundColor: btnColor }]}
                    >
                      {isPurchasing
                        ? <ActivityIndicator size="small" color="#fff" />
                        : <Text style={[s.subscribeBtnText, { color: btnTxtColor }]}>{btnLabel}</Text>
                      }
                    </Pressable>
                  </View>
                );
              })}
            </View>
          )}

          {/* Apple IAP 구독 관리 안내 */}
          <Text style={s.iapNote}>
            {Platform.OS === "ios"
              ? "구독은 Apple을 통해 결제됩니다. 구독 관리·해지는 설정 → Apple ID → 구독에서 할 수 있습니다."
              : "구독은 Google Play를 통해 결제됩니다. 구독 관리는 Google Play → 구독에서 할 수 있습니다."}
          </Text>
        </Section>

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
  sectionTitle:  { fontSize: 13, fontWeight: "600", color: "#374151", letterSpacing: 0.3 },

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

  emptyOffering:     { padding: 20, alignItems: "center" },
  emptyOfferingText: { color: "#9CA3AF", fontSize: 14 },

  planCard:        { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, padding: 14, gap: 12 },
  planCardName:    { fontSize: 16, fontWeight: "700" },
  planCardPrice:   { fontSize: 15, fontWeight: "600", color: "#111827" },
  planCardMeta:    { fontSize: 12, color: "#64748B" },
  currentTag:      { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  currentTagText:  { fontSize: 11, fontWeight: "600", color: "#fff" },
  subscribeBtn:    { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 8, minWidth: 90, alignItems: "center" },
  subscribeBtnText:{ fontSize: 13, fontWeight: "600" },

  iapNote:    { fontSize: 11, color: "#9CA3AF", textAlign: "center", lineHeight: 16, marginTop: 4 },

  restoreDesc:    { fontSize: 13, color: "#64748B", lineHeight: 18 },
  restoreBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderRadius: 8, paddingVertical: 12, marginTop: 4 },
  restoreBtnText: { fontSize: 14, fontWeight: "600" },
});
