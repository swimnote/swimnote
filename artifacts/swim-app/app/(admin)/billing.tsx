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
import { useSubscription, REVENUECAT_SOLO_ENTITLEMENT, REVENUECAT_CENTER_ENTITLEMENT } from "@/lib/revenuecat";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { billingEnabled } from "@/config/billing";
import {
  CircleAlert, CircleX, CreditCard, ExternalLink,
  RotateCcw, TriangleAlert, Check, X, ChevronRight,
  Users, HardDrive, Image, Video, BookOpen, Baby, Palette, CalendarClock,
} from "lucide-react-native";

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
  pending_tier?: string | null;
  pending_plan_name?: string | null;
  downgrade_at?: string | null;
}

const PAYMENT_FAILED_STATUSES = new Set(["payment_failed", "pending_deletion", "deleted"]);

// 티어별 색상
const TIER_COLOR: Record<string, string> = {
  free:     "#64748B",
  starter:  "#4EA7D8",
  basic:    "#2E9B6F",
  standard: "#2EC4B6",
  center_200: "#F59E0B",
  advance:  "#F59E0B",
  pro:      "#F59E0B",
  max:      "#F59E0B",
};

// 티어별 플랜 상세 정보
interface TierDetail {
  label: string;
  isCenter: boolean;
  features: { icon: React.ReactNode; label: string; included: boolean; note?: string }[];
}

function getTierDetail(tier: string, memberLimit: number, displayStorage: string | null, themeColor: string): TierDetail {
  const isFree    = tier === "free";
  const isCenter  = ["center_200","advance","pro","max"].includes(tier);
  const iconSize  = 15;
  const checkColor = isCenter ? "#F59E0B" : themeColor;
  const dimColor  = "#D1D5DB";

  const features = [
    { icon: <Image size={iconSize} color={checkColor} />,   label: "사진 업로드",        included: true },
    { icon: <BookOpen size={iconSize} color={checkColor} />, label: "출결 관리",          included: true },
    { icon: <BookOpen size={iconSize} color={checkColor} />, label: "수업 일지",          included: !isFree },
    { icon: <Baby size={iconSize} color={!isFree ? checkColor : dimColor} />, label: "학부모 연동",  included: !isFree },
    {
      icon: <Video size={iconSize} color={isCenter ? checkColor : dimColor} />,
      label: "영상 업로드",
      included: isCenter,
      note: isCenter ? undefined : "Premier 전용",
    },
    {
      icon: <Palette size={iconSize} color={isCenter ? checkColor : dimColor} />,
      label: "화이트라벨 (앱 이름·로고 커스텀)",
      included: isCenter,
      note: isCenter ? undefined : "Premier 전용",
    },
  ];

  return {
    label: isCenter ? "Premier (수영장/센터)" : isFree ? "무료" : "Coach (개인 선생님)",
    isCenter,
    features,
  };
}

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
    isSubscribed,
    isLoading: rcLoading,
    restore,
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
  useFocusEffect(useCallback(() => { loadBillingInfo(); }, [loadBillingInfo]));

  async function handleRestore() {
    try {
      const info = await restore();
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
  const tierDetail   = getTierDetail(currentTier, billingInfo?.member_limit ?? 10, billingInfo?.display_storage ?? null, themeColor);

  // 다운그레이드 예약 시 미래 플랜 상세
  const pendingTierDetail = billingInfo?.pending_tier
    ? getTierDetail(billingInfo.pending_tier, 0, null, themeColor)
    : null;

  // 갱신일: RC entitlement > 서버값
  const centerEnt = customerInfo?.entitlements.active[REVENUECAT_CENTER_ENTITLEMENT];
  const soloEnt   = customerInfo?.entitlements.active[REVENUECAT_SOLO_ENTITLEMENT];
  const renewalDate =
    centerEnt?.expirationDate?.slice(0, 10) ??
    soloEnt?.expirationDate?.slice(0, 10) ??
    billingInfo?.next_billing_at?.slice(0, 10) ??
    null;

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
                  {billingInfo?.plan_name ?? "무료 이용"}
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
            {isSubscribed && renewalDate && !billingInfo?.pending_tier && (
              <View style={s.infoRow}>
                <Text style={s.metaLabel}>다음 갱신일</Text>
                <Text style={s.metaValue}>{renewalDate}</Text>
              </View>
            )}
          </View>

          {/* ── 다운그레이드 예약 배너 ── */}
          {billingInfo?.pending_tier && billingInfo?.downgrade_at && (
            <View style={[s.downgradeBanner]}>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                <CalendarClock size={16} color="#92400E" style={{ marginTop: 1 }} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={s.downgradeTitle}>다운그레이드 예약됨</Text>
                  <Text style={s.downgradeDesc}>
                    현재 결제 주기가 끝나는{" "}
                    <Text style={s.downgradeDateBold}>{billingInfo.downgrade_at.slice(0, 10)}</Text>
                    {" "}이후{"\n"}
                    <Text style={s.downgradeDateBold}>
                      {billingInfo.pending_plan_name ?? billingInfo.pending_tier}
                    </Text>
                    {" "}플랜으로 자동 전환됩니다.
                  </Text>
                  <Text style={s.downgradeNote}>
                    · 전환 전까지 현재 플랜 혜택이 그대로 유지됩니다{"\n"}
                    · 전환 후 초과 회원은 새 플랜 한도로 제한됩니다{"\n"}
                    · 플랜 유지를 원하면 구독 변경에서 재구독하세요
                  </Text>
                </View>
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

        {/* ── 현재 플랜 상세 ── */}
        <Section title="현재 플랜 포함 기능">
          <View style={[s.detailCard, { borderColor: tierColor + "40" }]}>
            {/* 플랜 요약 헤더 */}
            <View style={[s.detailHeader, { backgroundColor: tierColor + "12" }]}>
              <View style={{ flex: 1 }}>
                <Text style={[s.detailPlanName, { color: tierColor }]}>
                  {billingInfo?.plan_name ?? "무료"}
                </Text>
                <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
                  <View style={s.detailChip}>
                    <Users size={11} color="#64748B" />
                    <Text style={s.detailChipText}>최대 {billingInfo?.member_limit ?? 10}명</Text>
                  </View>
                  <View style={s.detailChip}>
                    <HardDrive size={11} color="#64748B" />
                    <Text style={s.detailChipText}>{billingInfo?.display_storage ?? "100MB"}</Text>
                  </View>
                </View>
              </View>
            </View>

            {/* 기능 목록 */}
            <View style={{ gap: 10, padding: 14 }}>
              {tierDetail.features.map((f, i) => (
                <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={[s.featureIconWrap, { backgroundColor: f.included ? tierColor + "15" : "#F3F4F6" }]}>
                    {f.included
                      ? <Check size={13} color={tierColor} strokeWidth={2.5} />
                      : <X size={13} color="#CBD5E1" strokeWidth={2.5} />
                    }
                  </View>
                  <Text style={[s.featureLabel, !f.included && { color: "#CBD5E1" }]}>{f.label}</Text>
                  {f.note && <Text style={s.featureNote}>{f.note}</Text>}
                </View>
              ))}
            </View>

            {/* 다운그레이드 예정 플랜 미리보기 */}
            {billingInfo?.pending_tier && pendingTierDetail && (
              <View style={s.pendingPlanPreview}>
                <Text style={s.pendingPlanPreviewTitle}>
                  전환 예정 플랜: {billingInfo.pending_plan_name ?? billingInfo.pending_tier}
                </Text>
                <Text style={s.pendingPlanPreviewDesc}>
                  {billingInfo.downgrade_at?.slice(0, 10)} 이후 아래 기능으로 변경됩니다
                </Text>
                <View style={{ gap: 6, marginTop: 8 }}>
                  {pendingTierDetail.features.map((f, i) => (
                    <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      {f.included
                        ? <Check size={12} color="#6B7280" strokeWidth={2.5} />
                        : <X size={12} color="#D1D5DB" strokeWidth={2.5} />
                      }
                      <Text style={[{ fontSize: 12, color: f.included ? "#6B7280" : "#D1D5DB" }]}>{f.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>

          {/* 플랜 변경하기 버튼 */}
          <Pressable
            style={({ pressed }) => [s.changePlanBtn, { borderColor: tierColor, opacity: pressed ? 0.8 : 1 }]}
            onPress={() => router.push("/(admin)/subscription" as any)}
          >
            <Text style={[s.changePlanBtnText, { color: tierColor }]}>플랜 변경하기</Text>
            <ChevronRight size={16} color={tierColor} />
          </Pressable>
        </Section>

        {/* IAP 안내 */}
        <Text style={s.iapNote}>
          {Platform.OS === "ios"
            ? "구독은 Apple을 통해 결제됩니다. 구독 관리·해지는 설정 → Apple ID → 구독에서 할 수 있습니다."
            : "구독은 Google Play를 통해 결제됩니다. 구독 관리는 Google Play → 구독에서 할 수 있습니다."
          }
        </Text>

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
  sectionTitle:  { fontSize: 13, fontWeight: "600", color: "#374151" },

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

  downgradeBanner:     { backgroundColor: "#FFFBEB", borderColor: "#FCD34D", borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 8 },
  downgradeTitle:      { fontSize: 13, fontWeight: "700", color: "#92400E" },
  downgradeDesc:       { fontSize: 13, color: "#78350F", lineHeight: 20 },
  downgradeDateBold:   { fontWeight: "700" },
  downgradeNote:       { fontSize: 12, color: "#A16207", lineHeight: 20, marginTop: 4 },

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

  detailCard:       { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  detailHeader:     { padding: 14, paddingBottom: 12 },
  detailPlanName:   { fontSize: 17, fontWeight: "700" },
  detailChip:       { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#fff", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1, borderColor: "#E5E7EB" },
  detailChipText:   { fontSize: 11, color: "#64748B", fontWeight: "500" },
  featureIconWrap:  { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  featureLabel:     { fontSize: 13, color: "#374151", flex: 1 },
  featureNote:      { fontSize: 11, color: "#9CA3AF" },

  pendingPlanPreview:      { margin: 14, marginTop: 0, padding: 12, backgroundColor: "#F9FAFB", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB" },
  pendingPlanPreviewTitle: { fontSize: 12, fontWeight: "700", color: "#374151" },
  pendingPlanPreviewDesc:  { fontSize: 11, color: "#9CA3AF", marginTop: 2 },

  changePlanBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, borderWidth: 1.5, borderRadius: 10, paddingVertical: 12, marginTop: 4 },
  changePlanBtnText: { fontSize: 14, fontWeight: "700" },

  iapNote:    { fontSize: 11, color: "#9CA3AF", textAlign: "center", lineHeight: 16, marginTop: 4 },
  restoreDesc:    { fontSize: 13, color: "#64748B", lineHeight: 18 },
  restoreBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderRadius: 8, paddingVertical: 12, marginTop: 4 },
  restoreBtnText: { fontSize: 14, fontWeight: "600" },
});
