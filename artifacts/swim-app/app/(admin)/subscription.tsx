/**
 * (admin)/subscription.tsx — 구독 플랜 선택 화면 (WP3 리팩터)
 *
 * WP3 변경:
 *  - 신규 2.0 플랜 표시: SWIMNOTE / X300 / X500 / X1000
 *  - X 3일 무료체험 CTA / 활성 / 만료 상태 UI
 *  - 저장공간 위젯 (사용량 + 경고)
 *  - DATA100 / DATA300 안내 카드 (WP4 연결 전 disabled)
 *  - Legacy Coach / Premier 신규 판매 CTA 숨김
 *  - Legacy 구독자: 현재 플랜 상태 유지 표시
 *
 * 보존:
 *  - 기존 RevenueCat 구매 플로우 (legacy 구독자 restore/change)
 *  - 환불정책 배너, 취소 예약 배너
 *  - 구독 현황 관리 버튼
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Linking, Platform, Pressable, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LucideIcon } from "@/components/common/LucideIcon";
import Colors from "@/constants/colors";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useSubscription, REVENUECAT_SOLO_ENTITLEMENT, REVENUECAT_CENTER_ENTITLEMENT } from "@/lib/revenuecat";
import { useMode } from "@/context/ModeContext";
import {
  SUBSCRIPTION_PLANS_DEF,
  DATA_PACKS,
  formatMemberLimit,
  isLegacyTier,
  recommendXPlanTier,
  storageWarningLevel,
  getPlanByTier,
} from "@/constants/subscriptionPlans";

const STORE_NAME   = Platform.OS === "ios" ? "App Store (Apple)" : "Google Play";
const STORE_MANAGE = Platform.OS === "ios"
  ? "itms-apps://apps.apple.com/account/subscriptions"
  : "https://play.google.com/store/account/subscriptions";

const C    = Colors.light;
const NAVY = "#0A2540";
const X_ACCENT = "#355C7D";
const X_LIGHT  = "#EEF4FA";

// ── 포맷 헬퍼 ──────────────────────────────────────────────────────────────
function fmtKrw(price: number) {
  return price === 0 ? "무료" : `₩${price.toLocaleString("ko-KR")}`;
}
function fmtStorage(mb: number): string {
  if (mb >= 1024 * 1024) return `${mb / (1024 * 1024)}TB`;
  if (mb >= 1024)        return `${Math.round(mb / 1024)}GB`;
  return `${mb}MB`;
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}
function trialRemainingLabel(endsAt: string | null | undefined): string {
  if (!endsAt) return "";
  const diff = new Date(endsAt).getTime() - Date.now();
  if (diff <= 0) return "체험 종료";
  const h = Math.floor(diff / 3600000);
  if (h >= 24) return `${Math.floor(h / 24)}일 ${h % 24}시간 남음`;
  return `${h}시간 남음`;
}

// ── 오류 코드 → 한국어 메시지 ───────────────────────────────────────────────
function trialErrorMessage(code: string): string {
  switch (code) {
    case "TRIAL_ALREADY_USED":                      return "이 센터는 무료체험을 이미 사용했습니다.";
    case "TRIAL_ALREADY_ACTIVE":                    return "체험이 이미 진행 중입니다.";
    case "TRIAL_NOT_AVAILABLE_FOR_PAID_X":          return "이미 SWIMNOTE X를 이용 중입니다.";
    case "TRIAL_NOT_AVAILABLE_FOR_PREVIOUS_X_BUYER":return "이전 X 구독 이력이 있는 센터는 체험을 이용할 수 없습니다.";
    case "TRIAL_FORCE_DISABLED":                    return "현재 X 체험을 이용할 수 없습니다.";
    default:                                        return "체험 시작에 실패했습니다. 잠시 후 다시 시도해주세요.";
  }
}

// ── Legacy PlanMeta (기존 RC 구매용 — 삭제 금지) ────────────────────────────
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
  { tier: "free",     name: "Free",        price: 0,      limit: 10,   storage: "100MB",  storageMb: 102,   group: "solo",   rcPackageId: null },
  { tier: "starter",  name: "Coach30",     price: 1900,   limit: 30,   storage: "300MB",  storageMb: 307,   group: "solo",   rcPackageId: "solo_30" },
  { tier: "basic",    name: "Coach50",     price: 2900,   limit: 50,   storage: "500MB",  storageMb: 512,   group: "solo",   rcPackageId: "solo_50" },
  { tier: "standard", name: "Coach100",    price: 5900,   limit: 100,  storage: "1GB",    storageMb: 1024,  group: "solo",   rcPackageId: "solo_100", recommended: true },
];
const CENTER_PLANS: PlanMeta[] = [
  { tier: "center_200", name: "Premier200",  price: 19000,  limit: 200,  storage: "5GB",   storageMb: 5120,  group: "center", rcPackageId: "center_200" },
  { tier: "advance",    name: "Premier300",  price: 27000,  limit: 300,  storage: "10GB",  storageMb: 10240, group: "center", rcPackageId: "center_300" },
  { tier: "pro",        name: "Premier500",  price: 43000,  limit: 500,  storage: "20GB",  storageMb: 20480, group: "center", rcPackageId: "center_500" },
  { tier: "max",        name: "Premier1000", price: 79000,  limit: 1000, storage: "50GB",  storageMb: 51200, group: "center", rcPackageId: "center_1000", recommended: true },
];
const ALL_LEGACY_PLANS = [...SOLO_PLANS, ...CENTER_PLANS];

// ── 신규 2.0 X플랜 (subscriptionPlans.ts 단일 소스) ────────────────────────
const NEW_X_PLAN_TIERS = ["x300", "x500", "x1000"] as const;
const SWIMNOTE_TIER    = "swimnote";

export default function SubscriptionScreen() {
  const insets = useSafeAreaInsets();
  const { token, refreshPool, pool } = useAuth();
  const {
    mode, refreshMode,
    x_trial_active, x_trial_ends_at, x_trial_used,
  } = useMode();

  // ── 서버 상태 ──────────────────────────────────────────────────────────────
  const [currentTier,     setCurrentTier]     = useState<string | null>(null);
  const [endsAt,          setEndsAt]          = useState<string | null>(null);
  const [pendingTier,     setPendingTier]     = useState<string | null>(null);
  const [pendingPlanName, setPendingPlanName] = useState<string | null>(null);
  const [storageLimitMb,  setStorageLimitMb]  = useState<number | null>(null);
  const [storageUsedMb,   setStorageUsedMb]   = useState<number | null>(null);
  const [activeMemberCount, setActiveMemberCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const {
    soloOffering, centerOffering, xOffering, swimnoteOffering,
    isSubscribed, activePackageId,
    purchase, isPurchasing, refetchCustomerInfo,
    offeringsLoading, offeringsError, offeringsErrorDetail, refetchOfferings,
  } = useSubscription();

  const rcPriceMap = useMemo(() => {
    const all = [
      ...(soloOffering?.availablePackages ?? []),
      ...(centerOffering?.availablePackages ?? []),
      ...(xOffering?.availablePackages ?? []),
      ...(swimnoteOffering?.availablePackages ?? []),
    ];
    const map: Record<string, string> = {};
    for (const pkg of all) {
      if (pkg.product.priceString) map[pkg.identifier] = pkg.product.priceString;
    }
    return map;
  }, [soloOffering, centerOffering, xOffering]);

  // ── 정책 동의 ──────────────────────────────────────────────────────────────
  const [policyAgreed,  setPolicyAgreed]  = useState<boolean | null>(null);
  const [policyVersion, setPolicyVersion] = useState<string>("v1.0");

  // ── 확인 모달 ──────────────────────────────────────────────────────────────
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmTitle,   setConfirmTitle]   = useState("");
  const [confirmMessage, setConfirmMessage] = useState("");
  const [confirmAction,  setConfirmAction]  = useState<(() => void) | null>(null);
  function showConfirm(title: string, msg: string, action: () => void) {
    setConfirmTitle(title);
    setConfirmMessage(msg);
    setConfirmAction(() => action);
    setConfirmVisible(true);
  }

  // ── Trial 활성화 ────────────────────────────────────────────────────────────
  const [trialActivating, setTrialActivating] = useState(false);
  const [trialError,      setTrialError]      = useState<string | null>(null);
  const [showTrialConfirm, setShowTrialConfirm] = useState(false);

  async function doActivateTrial() {
    if (trialActivating) return;
    setTrialActivating(true);
    setTrialError(null);
    setShowTrialConfirm(false);
    try {
      const res = await apiRequest(token, "/billing/x-trial-activate", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = data?.error ?? "";
        if (code === "TRIAL_ALREADY_ACTIVE") {
          // 이미 활성 → mode refetch 후 trial UI 자동 반영
          await refreshMode().catch(() => {});
          return;
        }
        setTrialError(trialErrorMessage(code));
        return;
      }
      await refreshMode().catch(() => {});
    } catch {
      setTrialError("체험 시작에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setTrialActivating(false);
    }
  }

  // ── 데이터 로드 ─────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const [statusRes, policyRes, storageRes] = await Promise.all([
        apiRequest(token, "/billing/status"),
        apiRequest(token, "/admin/refund-policy").catch(() => null),
        apiRequest(token, "/admin/storage-overview").catch(() => null),
      ]);
      if (statusRes.ok) {
        const d = await statusRes.json();
        setCurrentTier(d.current_plan ?? d.plan_id ?? null);
        setEndsAt(d.subscription_ends_at ?? null);
        setPendingTier(d.pending_tier ?? null);
        setPendingPlanName(d.pending_plan_name ?? null);
        // billing/status may include storage info
        if (d.storage_limit_mb != null) setStorageLimitMb(Number(d.storage_limit_mb));
        if (d.storage_used_mb  != null) setStorageUsedMb(Number(d.storage_used_mb));
      }
      if (policyRes?.ok) {
        const d = await policyRes.json();
        if (d.success) {
          setPolicyAgreed(d.agreed && !d.needs_reagree);
          setPolicyVersion(d.version ?? "v1.0");
        }
      }
      if (storageRes?.ok) {
        const d = await storageRes.json();
        if (d.total_mb != null)  setStorageLimitMb(Number(d.total_mb));
        if (d.used_mb  != null)  setStorageUsedMb(Number(d.used_mb));
      }
      // pool에서 active member count 읽기
      const poolCount = (pool as any)?.active_member_count ?? (pool as any)?.member_count ?? null;
      if (poolCount != null) {
        setActiveMemberCount(Number(poolCount));
      } else {
        // API fallback — per_page=1로 total 필드 확인
        const countRes = await apiRequest(token, "/admin/members?per_page=1").catch(() => null);
        if (countRes?.ok) {
          const cd = await countRes.json().catch(() => ({}));
          if (typeof cd.total === "number") setActiveMemberCount(cd.total);
        }
      }
    } catch {}
    finally { setLoading(false); }
  }, [token, pool]);

  useEffect(() => { loadData(); }, [loadData]);
  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  // ── RevenueCat 구매 (legacy + X 플로우) ────────────────────────────────────
  async function syncRcToServer(info: any, purchasedProductId?: string) {
    let productId    = purchasedProductId ?? null;
    let entitlementId: string | null = null;
    let expiresAt:    string | null = null;

    // X 플랜 제품 ID 판별
    const X_TIERS = ["x300", "x500", "x1000"];
    const SWIMNOTE_TIERS = ["swimnote"];
    const isXProductId = (id: string | null) => {
      if (!id) return false;
      const base = id.replace(/:monthly$/, "").replace(/^com\.swimnote\./, "").replace(/\.monthly$/, "");
      return X_TIERS.includes(base) || X_TIERS.includes(id);
    };
    const isSwimnoteProductId = (id: string | null) => {
      if (!id) return false;
      const base = id.replace(/:monthly$/, "").replace(/^com\.swimnote\./, "").replace(/\.monthly$/, "");
      return SWIMNOTE_TIERS.includes(base) || SWIMNOTE_TIERS.includes(id);
    };

    if (!productId) {
      const active    = info?.entitlements?.active ?? {};
      // X 엔드포인트 우선 확인
      const xEnt      = active[X_ENTITLEMENT] ?? null;
      const centerEnt = active[REVENUECAT_CENTER_ENTITLEMENT] ?? null;
      const soloEnt   = active[REVENUECAT_SOLO_ENTITLEMENT]   ?? null;
      const entitlement = xEnt ?? centerEnt ?? soloEnt;
      if (!entitlement) return;
      productId     = entitlement.productIdentifier;
      if (xEnt) {
        entitlementId = X_ENTITLEMENT;
      } else {
        entitlementId = centerEnt ? REVENUECAT_CENTER_ENTITLEMENT : REVENUECAT_SOLO_ENTITLEMENT;
      }
      expiresAt     = entitlement.expirationDate ? entitlement.expirationDate.slice(0, 10) : null;
    } else {
      if (isXProductId(productId)) {
        // X 플랜만 x_mode entitlement — SWIMNOTE base는 RC entitlement 없음
        entitlementId = X_ENTITLEMENT;
      } else if (isSwimnoteProductId(productId)) {
        // SWIMNOTE base plan: 서버 DB tier authoritative, RC entitlement 없음
        entitlementId = null;
      } else {
        const centerIds = ["center_200","center_300","center_500","center_1000"];
        entitlementId = centerIds.includes(productId)
          ? REVENUECAT_CENTER_ENTITLEMENT : REVENUECAT_SOLO_ENTITLEMENT;
      }
      const active = info?.entitlements?.active ?? {};
      const ent    = active[entitlementId] ?? null;
      expiresAt    = ent?.expirationDate ? ent.expirationDate.slice(0, 10) : null;
    }
    const res = await apiRequest(token, "/billing/sync-rc-subscription", {
      method: "POST",
      body: JSON.stringify({ productId, entitlementId, expiresAt, isActive: true }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data?.code === "REFUND_POLICY_AGREEMENT_REQUIRED") {
        throw new Error("환불 정책 동의 후 구독이 가능합니다.\n설정 > 환불 정책에서 동의해 주세요.");
      }
      if (data?.code === "MEMBER_LIMIT_EXCEEDED_FOR_DOWNGRADE") {
        const err: any = new Error(data?.error ?? "회원 수 한도 초과로 다운그레이드할 수 없습니다.");
        err.code = "MEMBER_LIMIT_EXCEEDED_FOR_DOWNGRADE";
        throw err;
      }
      throw new Error(data?.message ?? "서버 동기화에 실패했습니다. 잠시 후 다시 시도해주세요.");
    }
  }

  // SWIMNOTE 기본플랜 구매 핸들러 — RC swimnote_monthly offering 연결
  async function handleSwimnoteSubscribe() {
    // 환불 정책 동의 확인
    if (policyAgreed === false) {
      showConfirm(
        "환불 정책 동의 필요",
        `유료 결제를 진행하려면 환불 정책 동의가 필요합니다.\n현재 버전: ${policyVersion}`,
        () => router.push("/(admin)/refund-policy" as any),
      );
      return;
    }

    // swimnote_monthly offering 로드 확인
    if (offeringsLoading) {
      showConfirm("구독 상품 로드 중", "잠시 후 다시 시도해주세요.", () => {});
      return;
    }
    if (!swimnoteOffering) {
      showConfirm(
        "구독 상품 준비 중",
        "SWIMNOTE 상품이 스토어에 아직 등록되지 않았습니다.\n스토어 심사 완료 후 구독이 가능합니다.",
        () => refetchOfferings(),
      );
      return;
    }

    // swimnote_monthly 오퍼링에서 패키지 찾기
    // RC 패키지 identifier: "swimnote" 또는 "swimnote:monthly" 또는 product ID 기준
    const swimnotePkgs = swimnoteOffering.availablePackages ?? [];
    const pkg = swimnotePkgs.find(
      (p: any) =>
        p.identifier === "swimnote" ||
        p.identifier === "swimnote:monthly" ||
        p.product?.productIdentifier === "swimnote" ||
        p.product?.productIdentifier === "swimnote:monthly" ||
        p.product?.productIdentifier === "com.swimnote.swimnote.monthly",
    );

    if (!pkg) {
      showConfirm(
        "구독 상품 준비 중",
        "SWIMNOTE 상품이 스토어에 아직 등록되지 않았습니다.\n스토어 심사 완료 후 구독이 가능합니다.",
        () => {},
      );
      return;
    }

    // RC 가격 우선, fallback은 정책 가격
    const priceStr = pkg.product?.priceString ?? `₩${swimnotePlan.price_monthly_krw.toLocaleString("ko-KR")}`;

    showConfirm(
      "SWIMNOTE 구독 시작",
      `${priceStr}/월 · 무제한 회원 · ${swimnotePlan.display_storage}\n\n결제 수단: ${STORE_NAME}`,
      async () => {
        try {
          const info = await purchase(pkg);
          // 서버 동기화 — DB tier=swimnote 갱신 (RC entitlement 없음, productId 기반)
          await syncRcToServer(info, pkg.product?.productIdentifier ?? "com.swimnote.swimnote.monthly");
          await refetchCustomerInfo();
          await refreshPool();
          await refreshMode().catch(() => {});
          showConfirm("구독 완료", "SWIMNOTE 구독이 성공적으로 시작되었습니다!", () => {});
        } catch (e: any) {
          if (e?.userCancelled) return;
          showConfirm("구독 실패", e?.message ?? "결제 중 오류가 발생했습니다.", () => {});
        }
      },
    );
  }

  // X 플랜 변경 핸들러 — RC x_monthly offering 연결
  function handleXPlanChange(plan: typeof xPlans[0]) {
    // 회원 한도 초과 guard (다운그레이드 방어)
    if (activeMemberCount != null && plan.max_members < 999999 && activeMemberCount > plan.max_members) {
      showConfirm(
        `${plan.name} 변경 불가`,
        `현재 활성회원 수(${activeMemberCount.toLocaleString()}명)가 ${plan.name} 한도(${plan.max_members.toLocaleString()}명)를 초과합니다.\n\n회원 수를 조정하거나 더 높은 플랜을 선택해 주세요.`,
        () => {},
      );
      return;
    }

    // 환불 정책 동의 확인
    if (policyAgreed === false) {
      showConfirm(
        "환불 정책 동의 필요",
        `유료 결제를 진행하려면 환불 정책 동의가 필요합니다.\n현재 버전: ${policyVersion}`,
        () => router.push("/(admin)/refund-policy" as any),
      );
      return;
    }

    // x_monthly offering 로드 확인
    if (offeringsLoading) {
      showConfirm("구독 상품 로드 중", "잠시 후 다시 시도해주세요.", () => {});
      return;
    }
    if (offeringsError || !xOffering) {
      showConfirm(
        "구독 상품 로드 실패",
        xOffering == null
          ? "RevenueCat x_monthly offering이 설정되지 않았습니다.\n스토어 콘솔 및 RevenueCat 대시보드를 확인해 주세요."
          : `오류: ${offeringsErrorDetail ?? "알 수 없는 오류"}`,
        () => refetchOfferings(),
      );
      return;
    }

    // x_monthly 오퍼링에서 플랜 tier와 일치하는 패키지 찾기
    // RC 패키지 identifier는 plan tier(x300/x500/x1000) 또는 :monthly 변형
    const xPackages = xOffering.availablePackages ?? [];
    const pkg = xPackages.find(
      (p: any) =>
        p.identifier === plan.tier ||
        p.identifier === `${plan.tier}:monthly` ||
        p.product?.productIdentifier === plan.tier ||
        p.product?.productIdentifier === `${plan.tier}:monthly` ||
        p.product?.productIdentifier === `com.swimnote.${plan.tier}.monthly`,
    );

    if (!pkg) {
      showConfirm(
        "구독 상품 준비 중",
        `${plan.name} 상품이 스토어에 아직 등록되지 않았습니다.\n스토어 심사 완료 후 구독이 가능합니다.`,
        () => {},
      );
      return;
    }

    // RC 가격 우선, fallback은 정책 가격
    const priceStr = pkg.product?.priceString ?? `₩${plan.price_monthly_krw.toLocaleString("ko-KR")}`;
    const isChange = isSubscribed;
    const actionLabel = isChange ? "플랜 변경" : "구독 시작";

    showConfirm(
      `${plan.name} ${actionLabel}`,
      isChange
        ? `현재 구독을 ${plan.name}으로 변경합니다.\n${priceStr}/월 · 최대 ${plan.max_members.toLocaleString()}명 · ${plan.display_storage}\n\n결제 수단: ${STORE_NAME}`
        : `${priceStr}/월 · 최대 ${plan.max_members.toLocaleString()}명 · ${plan.display_storage}\n\nX AI 기능 포함 · 결제 수단: ${STORE_NAME}`,
      async () => {
        try {
          const info = await purchase(pkg);
          // 서버 동기화 — x_mode entitlement + pool 갱신
          await syncRcToServer(info, pkg.product?.productIdentifier ?? plan.tier);
          await refetchCustomerInfo();
          await refreshPool();
          await refreshMode().catch(() => {});
          showConfirm("구독 완료", `${plan.name} 구독이 성공적으로 시작되었습니다!`, () => {});
        } catch (e: any) {
          if (e?.userCancelled) return;
          const serverCode = e?.code ?? "";
          if (serverCode === "MEMBER_LIMIT_EXCEEDED_FOR_DOWNGRADE") {
            showConfirm("다운그레이드 불가", e?.message ?? "회원 수 한도 초과로 플랜을 변경할 수 없습니다.", () => {});
          } else {
            showConfirm("구독 실패", e?.message ?? "결제 중 오류가 발생했습니다.", () => {});
          }
        }
      },
    );
  }

  function handleLegacyPlanSelect(plan: PlanMeta) {
    if (plan.price === 0 || !plan.rcPackageId) return;
    if (policyAgreed === false) {
      showConfirm(
        "환불 정책 동의 필요",
        `유료 결제를 진행하려면 환불 정책 동의가 필요합니다.\n현재 버전: ${policyVersion}`,
        () => router.push("/(admin)/refund-policy" as any),
      );
      return;
    }
    if (offeringsLoading || offeringsError || !plan.rcPackageId) {
      if (offeringsError) {
        showConfirm("구독 상품 로드 실패", `오류: ${offeringsErrorDetail ?? "알 수 없는 오류"}`, () => refetchOfferings());
      } else {
        showConfirm("구독 상품 로드 중", "잠시 후 다시 시도해주세요.", () => {});
      }
      return;
    }
    const allPackages = [
      ...(soloOffering?.availablePackages ?? []),
      ...(centerOffering?.availablePackages ?? []),
    ];
    const pkg = allPackages.find(p => p.identifier === plan.rcPackageId);
    if (!pkg) {
      showConfirm("구독 상품 로드 중", "잠시 후 다시 시도해주세요.", () => refetchOfferings());
      return;
    }
    const priceStr    = fmtKrw(plan.price);
    const isChange    = isSubscribed;
    const actionLabel = isChange ? "플랜 변경" : "구독 시작";
    showConfirm(
      `${plan.name} ${actionLabel}`,
      isChange
        ? `현재 구독을 ${plan.name}으로 변경합니다.\n${priceStr}/월 · 최대 ${plan.limit.toLocaleString()}명 · ${plan.storage}\n\n결제 수단: ${STORE_NAME}`
        : `${priceStr}/월 · 최대 ${plan.limit.toLocaleString()}명 · ${plan.storage}\n\n결제 수단: ${STORE_NAME}`,
      async () => {
        try {
          const info = await purchase(pkg);
          await syncRcToServer(info, plan.rcPackageId ?? undefined);
          await refetchCustomerInfo();
          await refreshPool();
          await refreshMode().catch(() => {});
          showConfirm("구독 완료", "구독이 성공적으로 시작되었습니다!", () => {});
        } catch (e: any) {
          if (e?.userCancelled) return;
          showConfirm("구독 실패", e?.message ?? "결제 중 오류가 발생했습니다.", () => {});
        }
      }
    );
  }

  // ── 계산 값 ────────────────────────────────────────────────────────────────
  const isLegacySubscriber = currentTier != null && isLegacyTier(currentTier) && currentTier !== "free";
  const isNewPlanUser      = currentTier != null && !isLegacyTier(currentTier);
  const legacyPlan         = isLegacySubscriber ? ALL_LEGACY_PLANS.find(p => p.tier === currentTier) : null;

  const swimnotePlan = SUBSCRIPTION_PLANS_DEF.find(p => p.tier === SWIMNOTE_TIER)!;
  const xPlans       = SUBSCRIPTION_PLANS_DEF.filter(p => NEW_X_PLAN_TIERS.includes(p.tier as any));

  // 현재 구독자의 plan_def (저장공간 한도 등)
  const currentPlanDef = currentTier ? getPlanByTier(currentTier) : null;
  const planStorageLimitMb = storageLimitMb ?? currentPlanDef?.storage_limit_mb ?? null;

  // Trial CTA 표시 조건
  const showTrialCTA =
    mode === "normal" &&
    !x_trial_active &&
    !x_trial_used &&
    !isLegacySubscriber; // Legacy 구독자는 Trial 대상 아님

  // X plan 추천 badge
  const recommendedXTier = activeMemberCount != null
    ? recommendXPlanTier(activeMemberCount)
    : null;

  // Storage 표시 여부
  const warnLevel = (planStorageLimitMb != null && storageUsedMb != null)
    ? storageWarningLevel(storageUsedMb, planStorageLimitMb)
    : "normal";

  // [UX 정책] SWIMNOTE 카드 표시 조건
  // X / X_Pending: X가 SWIMNOTE 기본플랜 포함 → 카드 숨김
  // X_Trial: secondary link만 표시, 카드 숨김
  const showSwimnoteCard = mode !== "x" && mode !== "x_pending" && mode !== "x_trial";

  // X_Trial에서 "일반 SWIMNOTE 이용하기" secondary link 표시
  const showSwimnoteSecondaryLink = mode === "x_trial";

  // X Active에서 SWIMNOTE downgrade action 표시
  const showXToSwimnoteDowngrade = mode === "x";

  // DATA pack 표시 — X/X_Pending/X_Trial 또는 storage critical/full
  const showDataPack = mode === "x" || mode === "x_trial" || mode === "x_pending" || warnLevel === "critical" || warnLevel === "full";

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SubScreenHeader title="구독 관리" />

      {/* ── 환불 정책 미동의 배너 ── */}
      {policyAgreed === false && (
        <Pressable
          style={bannerStyle}
          onPress={() => router.push("/(admin)/refund-policy" as any)}
        >
          <View style={{ flex: 1 }}>
            <Text style={bannerTitle}>유료 결제를 진행하려면 환불 정책 확인이 필요합니다.</Text>
            <Text style={bannerDesc}>현재 버전: {policyVersion} · 탭하여 확인하기</Text>
          </View>
          <LucideIcon name="credit-card" size={18} color="#D97706" />
        </Pressable>
      )}

      {/* ── 구독 취소 예약 배너 ── */}
      {!loading && endsAt && pendingTier === "free" && (
        <View style={cancelBannerStyle}>
          <LucideIcon name="clock" size={16} color="#B45309" />
          <View style={{ flex: 1 }}>
            <Text style={cancelBannerTitle}>구독 취소 예약됨</Text>
            <Text style={cancelBannerDesc}>
              {endsAt.slice(0, 10).replace(/-/g, ".")}까지 현재 플랜이 유지됩니다.{"\n"}
              이후 {pendingPlanName ?? "Free"} 플랜으로 전환됩니다.
            </Text>
          </View>
        </View>
      )}

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={C.brandStrong} size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >

          {/* ════ A. X TRIAL 섹션 ════════════════════════════════════════════ */}

          {/* Trial 오류 메시지 */}
          {trialError && (
            <View style={s.errorBanner}>
              <LucideIcon name="alert-circle" size={15} color="#EF4444" />
              <Text style={s.errorBannerText}>{trialError}</Text>
              <Pressable onPress={() => setTrialError(null)}>
                <LucideIcon name="x" size={14} color="#EF4444" />
              </Pressable>
            </View>
          )}

          {/* Trial 미사용 CTA */}
          {showTrialCTA && (
            <View style={s.trialCtaCard}>
              <View style={s.trialCtaHeader}>
                <View style={s.trialCtaIconWrap}>
                  <LucideIcon name="zap" size={20} color="#355C7D" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.trialCtaTitle}>3일 AI 기능 무료체험</Text>
                  <Text style={s.trialCtaSub}>SWIMNOTE X AI 기능을 먼저 경험해보세요</Text>
                </View>
              </View>
              <View style={s.trialCtaInfo}>
                {[
                  "자동결제 없음",
                  "결제정보 등록 필요 없음",
                  "센터 맞춤 X 세팅은 결제 후 제공",
                ].map((txt) => (
                  <View key={txt} style={s.trialCtaInfoRow}>
                    <LucideIcon name="check" size={13} color="#2E7D32" />
                    <Text style={s.trialCtaInfoText}>{txt}</Text>
                  </View>
                ))}
              </View>
              <Pressable
                style={({ pressed }) => [s.trialBtn, { opacity: pressed ? 0.8 : 1 }]}
                onPress={() => setShowTrialConfirm(true)}
                disabled={trialActivating}
              >
                {trialActivating
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={s.trialBtnText}>무료체험 시작하기</Text>
                }
              </Pressable>
            </View>
          )}

          {/* Trial 활성 상태 */}
          {mode === "x_trial" && x_trial_active && (
            <View style={[s.trialActiveCard]}>
              <View style={s.trialActiveHeader}>
                <View style={[s.trialCtaIconWrap, { backgroundColor: "#E3F2FD" }]}>
                  <LucideIcon name="zap" size={20} color={X_ACCENT} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.trialActiveTitle}>X AI 기능 무료체험 중</Text>
                  {x_trial_ends_at && (
                    <Text style={s.trialActiveSub}>
                      {fmtDate(x_trial_ends_at)}까지 · {trialRemainingLabel(x_trial_ends_at)}
                    </Text>
                  )}
                </View>
                <View style={s.trialActiveBadge}>
                  <Text style={s.trialActiveBadgeText}>체험 중</Text>
                </View>
              </View>
              <Text style={s.trialActiveNote}>
                X 정식 구독으로 전환하면 센터 맞춤 세팅과 성장 리포트를 이용할 수 있습니다.
              </Text>
            </View>
          )}

          {/* Trial 사용 완료 (만료 후) */}
          {x_trial_used && !x_trial_active && mode !== "x" && mode !== "x_pending" && (
            <View style={s.trialUsedCard}>
              <LucideIcon name="check-circle" size={18} color="#9CA3AF" />
              <View style={{ flex: 1 }}>
                <Text style={s.trialUsedTitle}>무료체험을 사용했습니다.</Text>
                <Text style={s.trialUsedSub}>X300 / X500 / X1000 중 플랜을 선택해 정식 이용을 시작하세요.</Text>
              </View>
            </View>
          )}

          {/* X Pending (결제완료 / 설정 준비 중) */}
          {mode === "x_pending" && (
            <View style={[s.xPendingCard]}>
              <View style={s.trialActiveHeader}>
                <View style={[s.trialCtaIconWrap, { backgroundColor: "#FFFBEB" }]}>
                  <LucideIcon name="settings" size={20} color="#D97706" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.trialActiveTitle, { color: "#92400E" }]}>SWIMNOTE X 활성화 완료</Text>
                  <Text style={[s.trialActiveSub, { color: "#D97706" }]}>센터 맞춤 세팅을 준비하고 있습니다.</Text>
                </View>
              </View>
              <Text style={[s.trialActiveNote, { color: "#B45309" }]}>
                커리큘럼 연결 등 설정이 완료되면 모든 X 기능이 활성화됩니다.{"\n"}
                관리자에게 문의하거나 설정 상태를 확인해 주세요.
              </Text>
            </View>
          )}

          {/* X Active (정식 사용 중) */}
          {mode === "x" && (
            <View style={s.xActiveCard}>
              <View style={s.trialActiveHeader}>
                <View style={[s.trialCtaIconWrap, { backgroundColor: X_LIGHT }]}>
                  <LucideIcon name="zap" size={20} color={X_ACCENT} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.trialActiveTitle, { color: NAVY }]}>SWIMNOTE X 사용 중</Text>
                  {currentPlanDef && (
                    <Text style={s.trialActiveSub}>
                      {currentPlanDef.name} · {formatMemberLimit(currentPlanDef.max_members)} · {currentPlanDef.display_storage}
                    </Text>
                  )}
                </View>
                <View style={[s.trialActiveBadge, { backgroundColor: X_LIGHT, borderColor: X_ACCENT + "40" }]}>
                  <Text style={[s.trialActiveBadgeText, { color: X_ACCENT }]}>X 사용 중</Text>
                </View>
              </View>
              {endsAt && (
                <Text style={s.trialActiveNote}>
                  구독 만료: {endsAt.slice(0, 10).replace(/-/g, ".")}
                </Text>
              )}
            </View>
          )}

          {/* ════ B. SWIMNOTE 플랜 ══════════════════════════════════════════ */}
          {/* X / X_Pending: X가 SWIMNOTE 포함 → 카드 숨김 / X_Trial: secondary link만 */}
          {showSwimnoteCard && (
          <>
          <View style={s.sectionHeader}>
            <View style={[s.sectionIcon, { backgroundColor: "#F0F4FF" }]}>
              <LucideIcon name="layers" size={18} color={NAVY} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.sectionTitle}>SWIMNOTE</Text>
              <Text style={s.sectionSub}>수영장 운영의 모든 기본 기능</Text>
            </View>
          </View>

          <View style={s.swimnoteCard}>
            <View style={s.planRow}>
              <Text style={s.planName}>SWIMNOTE</Text>
              <View>
                <Text style={[s.planPrice, { color: NAVY }]}>
                  {fmtKrw(swimnotePlan.price_monthly_krw)}
                  <Text style={s.planPriceSub}>/월</Text>
                </Text>
              </View>
            </View>
            <View style={s.planMeta}>
              <MetaChip icon="users"      label={formatMemberLimit(swimnotePlan.max_members)} />
              <MetaChip icon="hard-drive" label={swimnotePlan.display_storage} />
              <MetaChip icon="video"      label="영상 포함" />
            </View>
            <View style={s.swimnoteFeatures}>
              {[
                "회원관리 · 반관리 · 출결",
                "보강 · 일정 · 공지",
                "일지 · 사진 · 영상",
                "앨범 · 학부모 피드",
                `${swimnotePlan.display_storage} 저장공간`,
              ].map(f => (
                <View key={f} style={s.featureRow}>
                  <LucideIcon name="check" size={13} color="#2E7D32" />
                  <Text style={s.featureText}>{f}</Text>
                </View>
              ))}
            </View>
            {/* SWIMNOTE 구매 CTA
                - 현재 플랜: 배지 표시
                - swimnote_monthly offering + swimnote 패키지 수신 시: "구독 시작" 활성
                - offering/package 없음(스토어 미등록): "구독 신청 준비 중" safe disabled
                - 외부 상품 없어도 crash 없음 */}
            {currentTier === "swimnote" ? (
              <View style={[s.cardAction, { backgroundColor: C.backgroundSoft, borderColor: C.border }]}>
                <LucideIcon name="check" size={14} color="#10B981" />
                <Text style={[s.cardActionText, { color: "#10B981", marginLeft: 4 }]}>현재 플랜</Text>
              </View>
            ) : (() => {
              // swimnote_monthly 오퍼링에서 패키지 탐색 (RC 미설정 시 null → safe disabled)
              const swimnotePkgs = swimnoteOffering?.availablePackages ?? [];
              const swimnotePkg = swimnotePkgs.find(
                (p: any) =>
                  p.identifier === "swimnote" ||
                  p.identifier === "swimnote:monthly" ||
                  p.product?.productIdentifier === "swimnote" ||
                  p.product?.productIdentifier === "swimnote:monthly" ||
                  p.product?.productIdentifier === "com.swimnote.swimnote.monthly",
              ) ?? null;
              return swimnotePkg != null ? (
                <Pressable
                  style={({ pressed }) => [s.cardAction, { backgroundColor: "#EEF4FF", borderColor: NAVY + "40", opacity: pressed ? 0.8 : 1 }]}
                  onPress={handleSwimnoteSubscribe}
                  disabled={isPurchasing}
                >
                  <Text style={[s.cardActionText, { color: NAVY }]}>구독 시작</Text>
                </Pressable>
              ) : (
                <View style={[s.cardAction, { backgroundColor: "#F3F4F6", borderColor: "#E5E7EB" }]}>
                  <LucideIcon name="clock" size={13} color={C.textMuted} />
                  <Text style={[s.cardActionText, { color: C.textMuted, marginLeft: 4 }]}>구독 신청 준비 중</Text>
                </View>
              );
            })()}
          </View>
          </>
          )}

          {/* ════ C. X 플랜 (X300/X500/X1000) ════════════════════════════════ */}
          <View style={[s.sectionHeader, { marginTop: 8 }]}>
            <View style={[s.sectionIcon, { backgroundColor: X_LIGHT }]}>
              <LucideIcon name="cpu" size={18} color={X_ACCENT} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.sectionTitle}>SWIMNOTE X</Text>
              <Text style={s.sectionSub}>AI 교육 시스템 · 성장 관리</Text>
            </View>
          </View>

          {xPlans.map(plan => {
            const isCurrent   = currentTier === plan.tier;
            const isRecommended = recommendedXTier === plan.tier && !isCurrent;
            return (
              <View key={plan.tier} style={[s.xPlanCard, isCurrent && { borderColor: X_ACCENT, borderWidth: 2 }]}>
                {isRecommended && (
                  <View style={s.recommendBadge}>
                    <Text style={s.recommendBadgeText}>추천</Text>
                  </View>
                )}
                {isCurrent && (
                  <View style={[s.recommendBadge, { backgroundColor: "#10B981" }]}>
                    <LucideIcon name="check" size={10} color="#fff" />
                    <Text style={s.recommendBadgeText}> 현재</Text>
                  </View>
                )}
                <View style={s.planRow}>
                  <View>
                    <Text style={s.planName}>{plan.name}</Text>
                    <Text style={s.xPlanSub}>SWIMNOTE 기본플랜 포함 · X 전용 AI 추가</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[s.planPrice, { color: X_ACCENT }]}>
                      {fmtKrw(plan.price_monthly_krw)}
                      <Text style={s.planPriceSub}>/월</Text>
                    </Text>
                  </View>
                </View>
                <View style={s.planMeta}>
                  <MetaChip icon="users"      label={formatMemberLimit(plan.max_members)} />
                  <MetaChip icon="hard-drive" label={plan.display_storage} />
                  <MetaChip icon="cpu"        label="X AI" />
                </View>
                {/* Plan CTA — mode별 분기 */}
                {isCurrent ? (
                  <View style={[s.cardAction, { backgroundColor: C.backgroundSoft, borderColor: C.border }]}>
                    <LucideIcon name="check" size={14} color="#10B981" />
                    <Text style={[s.cardActionText, { color: "#10B981", marginLeft: 4 }]}>현재 플랜</Text>
                  </View>
                ) : (mode === "x" || mode === "x_pending") ? (
                  /* X Active / X Pending: 플랜 변경 (member limit guard 포함) */
                  <Pressable
                    style={({ pressed }) => [s.cardAction, { backgroundColor: X_LIGHT, borderColor: X_ACCENT + "40", opacity: pressed ? 0.8 : 1 }]}
                    onPress={() => handleXPlanChange(plan)}
                  >
                    <Text style={[s.cardActionText, { color: X_ACCENT }]}>플랜 변경</Text>
                  </Pressable>
                ) : (
                  /* Normal / X_Trial / Subscription_Required: 구독 신청 준비 중 */
                  <View style={[s.cardAction, { backgroundColor: "#F3F4F6", borderColor: "#E5E7EB" }]}>
                    <LucideIcon name="clock" size={13} color={C.textMuted} />
                    <Text style={[s.cardActionText, { color: C.textMuted, marginLeft: 4 }]}>구독 신청 준비 중</Text>
                  </View>
                )}
              </View>
            );
          })}

          {/* 1001명+ 안내 */}
          {activeMemberCount != null && activeMemberCount > 1000 && (
            <View style={s.enterpriseNote}>
              <LucideIcon name="building" size={14} color={C.textSecondary} />
              <Text style={s.enterpriseNoteText}>
                회원 1,001명 이상은 별도 문의해 주세요.
              </Text>
            </View>
          )}

          {/* ════ X → SWIMNOTE 다운그레이드 action (X Active 전용) ══════════ */}
          {showXToSwimnoteDowngrade && (
            <View style={s.xToSwimnoteCard}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <LucideIcon name="arrow-down-circle" size={16} color={C.textSecondary} />
                <Text style={s.xToSwimnoteTitle}>SWIMNOTE 기본플랜으로 변경</Text>
              </View>
              <Text style={s.xToSwimnoteDesc}>
                현재 결제기간 종료 후 SWIMNOTE(₩9,900/월)로 전환됩니다.{"\n"}
                X 기능은 결제기간 종료일까지 유지됩니다.
              </Text>
              <View style={[s.cardAction, { backgroundColor: "#F3F4F6", borderColor: "#E5E7EB", marginTop: 6 }]}>
                <LucideIcon name="clock" size={13} color={C.textMuted} />
                <Text style={[s.cardActionText, { color: C.textMuted, marginLeft: 4 }]}>
                  다음 결제일부터 SWIMNOTE로 변경 (준비 중)
                </Text>
              </View>
            </View>
          )}

          {/* ════ X Trial → 일반 SWIMNOTE 이용하기 secondary link ══════════ */}
          {showSwimnoteSecondaryLink && (
            <View style={[s.xToSwimnoteCard, { backgroundColor: "#F9FAFB", borderColor: C.border }]}>
              <Text style={[s.xToSwimnoteDesc, { textAlign: "center", marginBottom: 4 }]}>
                X AI 기능 없이 기본 수영장 운영만 필요하신가요?
              </Text>
              <View style={[s.cardAction, { backgroundColor: "#F3F4F6", borderColor: "#E5E7EB" }]}>
                <LucideIcon name="clock" size={13} color={C.textMuted} />
                <Text style={[s.cardActionText, { color: C.textMuted, marginLeft: 4 }]}>
                  일반 SWIMNOTE 이용하기 (준비 중)
                </Text>
              </View>
            </View>
          )}

          {/* ════ D. 저장공간 위젯 ══════════════════════════════════════════ */}
          {planStorageLimitMb != null && (
            <StorageWidget
              usedMb={storageUsedMb}
              limitMb={planStorageLimitMb}
              warnLevel={warnLevel}
            />
          )}

          {/* ════ E. DATA Pack 안내 ═══════════════════════════════════════════ */}
          {showDataPack && (
            <>
              <View style={[s.sectionHeader, { marginTop: 4 }]}>
                <View style={[s.sectionIcon, { backgroundColor: "#F3F4F6" }]}>
                  <LucideIcon name="database" size={18} color={C.textSecondary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.sectionTitle}>추가 저장공간</Text>
                  <Text style={s.sectionSub}>현재 플랜에 추가 (add-on)</Text>
                </View>
              </View>
              {DATA_PACKS.map(pack => (
                <View key={pack.id} style={s.dataPackCard}>
                  <View style={s.planRow}>
                    <View>
                      <Text style={s.planName}>{pack.name}</Text>
                      <Text style={s.dataPackSub}>+{pack.plus_gb}GB 추가</Text>
                    </View>
                    <Text style={[s.planPrice, { color: C.textSecondary, fontSize: 16 }]}>
                      {fmtKrw(pack.price_monthly_krw)}
                      <Text style={s.planPriceSub}>/월</Text>
                    </Text>
                  </View>
                  <View style={[s.cardAction, { backgroundColor: "#F3F4F6", borderColor: "#E5E7EB" }]}>
                    <LucideIcon name="clock" size={13} color={C.textMuted} />
                    <Text style={[s.cardActionText, { color: C.textMuted, marginLeft: 4 }]}>준비 중</Text>
                  </View>
                </View>
              ))}
            </>
          )}

          {/* ════ F. Legacy 구독자 현재 플랜 상태 ════════════════════════════ */}
          {isLegacySubscriber && legacyPlan && (
            <>
              <View style={s.legacySectionHeader}>
                <Text style={s.legacySectionTitle}>현재 구독 플랜</Text>
              </View>
              <View style={s.legacyCard}>
                <View style={s.planRow}>
                  <Text style={s.planName}>{legacyPlan.name}</Text>
                  <Text style={[s.planPrice, { color: C.textSecondary, fontSize: 16 }]}>
                    {fmtKrw(legacyPlan.price)}
                    <Text style={s.planPriceSub}>/월</Text>
                  </Text>
                </View>
                <View style={s.planMeta}>
                  <MetaChip icon="users"      label={`최대 ${legacyPlan.limit.toLocaleString()}명`} />
                  <MetaChip icon="hard-drive" label={legacyPlan.storage} />
                </View>
                {endsAt && pendingTier !== "free" && (
                  <Text style={s.legacyRenewalText}>
                    다음 결제: {endsAt.slice(0, 10).replace(/-/g, ".")}
                  </Text>
                )}
                {/* 플랜 변경 (legacy → legacy) — RC 기존 플로우 유지 */}
                {isSubscribed && (
                  <Pressable
                    style={({ pressed }) => [s.billingBtn, s.legacyChangeBtn, { opacity: pressed ? 0.7 : 1 }]}
                    onPress={() => {
                      // Legacy 내 변경은 기존 플랜 목록으로 이동 (별도 처리 가능)
                      showConfirm(
                        "플랜 변경",
                        "현재 플랜을 변경하려면 아래 구독 현황 관리를 이용해 주세요.",
                        () => {},
                      );
                    }}
                  >
                    <Text style={s.legacyChangeBtnText}>플랜 변경</Text>
                  </Pressable>
                )}
              </View>
            </>
          )}

          {/* ════ 하단 공통 ═══════════════════════════════════════════════════ */}

          {/* 결제 수단 안내 */}
          <View style={s.storePlatformBox}>
            <LucideIcon name="credit-card" size={14} color={C.textSecondary} />
            <Text style={s.storePlatformText}>
              이 기기 결제 수단: <Text style={s.storePlatformBold}>{STORE_NAME}</Text>
            </Text>
          </View>

          {/* 구독 관리 */}
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
            onPress={() => router.push("/(admin)/billing" as any)}
          >
            <Text style={s.billingBtnText}>구독 현황 관리</Text>
          </Pressable>

          <Text style={s.disclaimer}>
            부가세(VAT) 포함 금액입니다. 구독은 매월 자동 갱신됩니다.{"\n"}
            {Platform.OS === "ios"
              ? "결제는 App Store(Apple)를 통해 처리됩니다."
              : "결제는 Google Play를 통해 처리됩니다."}
          </Text>

          <View style={s.legalRow}>
            <Pressable onPress={() => router.push("/terms" as any)} style={({ pressed }) => [s.legalBtn, { opacity: pressed ? 0.6 : 1 }]}>
              <Text style={s.legalBtnText}>이용약관 (EULA)</Text>
            </Pressable>
            <Text style={s.legalSep}>·</Text>
            <Pressable onPress={() => router.push("/privacy" as any)} style={({ pressed }) => [s.legalBtn, { opacity: pressed ? 0.6 : 1 }]}>
              <Text style={s.legalBtnText}>개인정보처리방침</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}

      {/* ── Trial 확인 모달 ── */}
      <ConfirmModal
        visible={showTrialConfirm}
        title="3일 무료체험 시작"
        message={
          "체험 기간: 3일\n자동결제 없음\n센터당 최초 1회\n\n센터 맞춤 세팅(커리큘럼 설정)은 체험에 포함되지 않습니다.\n즉시 사용 가능한 AI 기능부터 경험해보세요."
        }
        onConfirm={doActivateTrial}
        onCancel={() => setShowTrialConfirm(false)}
      />

      {/* ── 일반 확인 모달 (legacy 구매/오류 등) ── */}
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

// ── 공통 MetaChip ──────────────────────────────────────────────────────────
function MetaChip({ icon, label }: { icon: string; label: string }) {
  return (
    <View style={s.metaItem}>
      <LucideIcon name={icon as any} size={12} color={Colors.light.textSecondary} />
      <Text style={s.metaText}>{label}</Text>
    </View>
  );
}

// ── StorageWidget ───────────────────────────────────────────────────────────
function StorageWidget({
  usedMb, limitMb, warnLevel,
}: {
  usedMb: number | null;
  limitMb: number;
  warnLevel: "normal" | "warning" | "critical" | "full";
}) {
  const C2 = Colors.light;
  const pct = usedMb != null ? Math.min(100, Math.round((usedMb / limitMb) * 100)) : null;
  const barColor = warnLevel === "full"     ? "#EF4444"
                 : warnLevel === "critical" ? "#F97316"
                 : warnLevel === "warning"  ? "#F59E0B"
                 : "#10B981";
  return (
    <View style={s.storageCard}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <LucideIcon name="hard-drive" size={16} color={C2.textSecondary} />
        <Text style={s.storageTitle}>저장공간</Text>
        {pct != null && (
          <Text style={[s.storagePct, { color: barColor }]}>{pct}%</Text>
        )}
      </View>
      {/* 사용량 바 */}
      {pct != null && (
        <View style={s.storageBarBg}>
          <View style={[s.storageBarFill, { width: `${pct}%` as any, backgroundColor: barColor }]} />
        </View>
      )}
      {/* 텍스트 */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
        {usedMb != null
          ? <Text style={s.storageUsedText}>{fmtStorage(usedMb)} 사용 중</Text>
          : <Text style={s.storageUsedText}>사용량 불러오는 중</Text>
        }
        <Text style={s.storageLimitText}>전체 {fmtStorage(limitMb)}</Text>
      </View>
      {/* 경고 메시지 */}
      {warnLevel === "warning" && (
        <Text style={[s.storageWarnText, { color: "#B45309" }]}>
          저장공간을 많이 사용하고 있습니다.
        </Text>
      )}
      {warnLevel === "critical" && (
        <Text style={[s.storageWarnText, { color: "#C2410C" }]}>
          추가 저장공간이 필요하신가요? DATA100 / DATA300을 이용해보세요.
        </Text>
      )}
      {warnLevel === "full" && (
        <Text style={[s.storageWarnText, { color: "#EF4444" }]}>
          저장공간이 가득 찼습니다. 추가 저장공간을 구매하면 다시 업로드할 수 있습니다.{"\n"}
          기존 자료는 계속 조회할 수 있습니다.
        </Text>
      )}
    </View>
  );
}

// ── 배너 스타일 ────────────────────────────────────────────────────────────
const bannerStyle = {
  flexDirection: "row" as const,
  alignItems: "center" as const,
  gap: 12,
  backgroundColor: "#FFFBEB",
  borderBottomWidth: 1,
  borderBottomColor: "#FDE68A",
  paddingHorizontal: 16,
  paddingVertical: 12,
};
const bannerTitle = { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#92400E" };
const bannerDesc  = { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#D97706", marginTop: 2 };

const cancelBannerStyle = {
  flexDirection: "row" as const,
  alignItems: "flex-start" as const,
  gap: 10,
  backgroundColor: "#FFF7ED",
  borderBottomWidth: 1,
  borderBottomColor: "#FED7AA",
  paddingHorizontal: 16,
  paddingVertical: 12,
};
const cancelBannerTitle = { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#92400E", marginBottom: 2 };
const cancelBannerDesc  = { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#B45309", lineHeight: 18 };

// ── StyleSheet ──────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },

  // 오류 배너
  errorBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FEF2F2", borderRadius: 10, padding: 10, borderWidth: 1, borderColor: "#FCA5A5" },
  errorBannerText: { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: "#EF4444" },

  // Trial CTA
  trialCtaCard: { backgroundColor: "#F0F7FF", borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: "#BFDBFE", gap: 10 },
  trialCtaHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  trialCtaIconWrap: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#DBEAFE", alignItems: "center", justifyContent: "center" },
  trialCtaTitle: { fontSize: 16, fontFamily: "Pretendard-Regular", color: "#1E3A5F" },
  trialCtaSub:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#60A5FA", marginTop: 1 },
  trialCtaInfo:  { gap: 4, paddingLeft: 2 },
  trialCtaInfoRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  trialCtaInfoText: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#374151" },
  trialBtn: { backgroundColor: X_ACCENT, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  trialBtnText: { color: "#fff", fontSize: 15, fontFamily: "Pretendard-Regular" },

  // Trial Active
  trialActiveCard: { backgroundColor: "#EFF6FF", borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: "#93C5FD", gap: 8 },
  trialActiveHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  trialActiveTitle: { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#1E40AF" },
  trialActiveSub:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#60A5FA", marginTop: 2 },
  trialActiveBadge: { backgroundColor: "#DBEAFE", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: "#93C5FD" },
  trialActiveBadgeText: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#1E40AF" },
  trialActiveNote:  { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#6B7280", lineHeight: 18 },

  // Trial Used
  trialUsedCard: { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "#F9FAFB", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: Colors.light.border },
  trialUsedTitle: { fontSize: 14, fontFamily: "Pretendard-Regular", color: Colors.light.textSecondary },
  trialUsedSub:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: Colors.light.textMuted, marginTop: 2 },

  // X Pending
  xPendingCard: { backgroundColor: "#FFFBEB", borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: "#FDE68A", gap: 8 },

  // X Active
  xActiveCard: { backgroundColor: X_LIGHT, borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: X_ACCENT + "40", gap: 8 },

  // 섹션 헤더
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4, marginBottom: 2 },
  sectionIcon:   { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  sectionTitle:  { fontSize: 16, fontFamily: "Pretendard-Regular", color: Colors.light.text },
  sectionSub:    { fontSize: 11, fontFamily: "Pretendard-Regular", color: Colors.light.textSecondary },

  // SWIMNOTE 카드
  swimnoteCard: {
    backgroundColor: "#fff", borderRadius: 14, padding: 14,
    borderWidth: 1.5, borderColor: Colors.light.border,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
    gap: 8,
  },
  swimnoteFeatures: { gap: 4 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  featureText: { fontSize: 13, fontFamily: "Pretendard-Regular", color: Colors.light.textSecondary },

  // X 플랜 카드
  xPlanCard: {
    backgroundColor: "#fff", borderRadius: 14, padding: 14,
    borderWidth: 1.5, borderColor: Colors.light.border,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
    overflow: "visible",
    gap: 8,
  },
  xPlanSub: { fontSize: 11, fontFamily: "Pretendard-Regular", color: Colors.light.textMuted, marginTop: 1 },
  recommendBadge: { position: "absolute", top: -10, right: 12, flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: X_ACCENT, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8, zIndex: 10 },
  recommendBadgeText: { color: "#fff", fontSize: 11, fontFamily: "Pretendard-Regular" },

  // Enterprise note
  enterpriseNote: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, backgroundColor: Colors.light.backgroundSoft, borderRadius: 10, borderWidth: 1, borderColor: Colors.light.border },
  enterpriseNoteText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: Colors.light.textSecondary },

  // X → SWIMNOTE 다운그레이드 / X_Trial secondary link
  xToSwimnoteCard: { backgroundColor: "#F0F4FF", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#DBEAFE", gap: 2 },
  xToSwimnoteTitle: { fontSize: 14, fontFamily: "Pretendard-Regular", color: Colors.light.textSecondary },
  xToSwimnoteDesc:  { fontSize: 12, fontFamily: "Pretendard-Regular", color: Colors.light.textMuted, lineHeight: 18 },

  // Storage
  storageCard: { backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: Colors.light.border, gap: 0 },
  storageTitle: { fontSize: 14, fontFamily: "Pretendard-Regular", color: Colors.light.text, flex: 1 },
  storagePct:   { fontSize: 13, fontFamily: "Pretendard-Regular" },
  storageBarBg: { height: 8, backgroundColor: "#F3F4F6", borderRadius: 4, overflow: "hidden" },
  storageBarFill: { height: 8, borderRadius: 4 },
  storageUsedText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: Colors.light.textSecondary },
  storageLimitText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: Colors.light.textMuted },
  storageWarnText: { fontSize: 12, fontFamily: "Pretendard-Regular", lineHeight: 18, marginTop: 8 },

  // DATA Pack
  dataPackCard: {
    backgroundColor: "#fff", borderRadius: 14, padding: 14,
    borderWidth: 1.5, borderColor: Colors.light.border,
    gap: 8,
  },
  dataPackSub: { fontSize: 12, fontFamily: "Pretendard-Regular", color: Colors.light.textMuted, marginTop: 1 },

  // Legacy 섹션
  legacySectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  legacySectionTitle:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: Colors.light.textSecondary },
  legacyCard: {
    backgroundColor: "#F9FAFB", borderRadius: 14, padding: 14,
    borderWidth: 1.5, borderColor: Colors.light.border,
    gap: 8,
  },
  legacyRenewalText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: Colors.light.textSecondary },
  legacyChangeBtn:    { borderColor: Colors.light.textMuted, marginTop: 0 },
  legacyChangeBtnText:{ color: Colors.light.textSecondary, fontSize: 14, fontFamily: "Pretendard-Regular" },

  // 공통 플랜 카드
  planRow:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  planName:    { fontSize: 15, fontFamily: "Pretendard-Regular", color: Colors.light.text },
  planPrice:   { fontSize: 18, fontFamily: "Pretendard-Regular" },
  planPriceSub:{ fontSize: 11, color: Colors.light.textMuted },
  planMeta:    { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  metaItem:    { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: Colors.light.textSecondary },
  cardAction:  { marginTop: 2, paddingVertical: 9, borderRadius: 10, borderWidth: 1, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 4 },
  cardActionText: { fontSize: 13, fontFamily: "Pretendard-Regular" },

  // 하단
  storePlatformBox:  { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: Colors.light.backgroundSoft, borderRadius: 10, borderWidth: 1, borderColor: Colors.light.border, marginTop: 4 },
  storePlatformText: { fontSize: 13, fontFamily: "Pretendard-Regular", color: Colors.light.textSecondary, flex: 1 },
  storePlatformBold: { fontFamily: "Pretendard-Regular", color: Colors.light.textPrimary },
  billingBtn:        { marginTop: 6, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.light.brandStrong, alignItems: "center" },
  billingBtnText:    { color: Colors.light.brandStrong, fontSize: 15, fontFamily: "Pretendard-Regular" },
  manageBtn:         { borderColor: Colors.light.textSecondary },
  manageBtnText:     { color: Colors.light.textSecondary, fontSize: 14, fontFamily: "Pretendard-Regular" },
  disclaimer:        { fontSize: 12, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 18, color: Colors.light.textMuted },
  legalRow:          { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 10, marginBottom: 8 },
  legalBtn:          { paddingVertical: 4, paddingHorizontal: 2 },
  legalBtnText:      { fontSize: 12, fontFamily: "Pretendard-Regular", textDecorationLine: "underline", color: Colors.light.brandStrong },
  legalSep:          { fontSize: 12, fontFamily: "Pretendard-Regular", color: Colors.light.textMuted },
});
