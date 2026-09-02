/**
 * x-subscription — SWIMNOTE X 정기결제 신청 / 구독 관리 (X02-D, X02-D2)
 *
 * 결제 흐름:
 *  IDLE → [신청] → RESERVING → RESERVED → LOADING_PRODUCT → READY_TO_PURCHASE
 *       → [결제] → PURCHASING → SYNCING → X_ACTIVE / PURCHASED_X_PENDING
 *
 * X02-D2 추가:
 *  - Restore 구매 복원 (pool_admin)
 *  - 구독 상태 세부 조회 (ACTIVE / CANCELLED_BUT_ACTIVE / BILLING_ISSUE / EXPIRED)
 *  - 구독 관리 deep-link (Apple 구독 관리)
 *  - CANCELLED_BUT_ACTIVE / BILLING_ISSUE UI
 *
 * 서버 정책:
 *  - sequence / tier / product 서버 결정 (클라이언트 계산 금지)
 *  - RevenueCat V2 server verification
 *  - pool_admin only 구매/복원
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useMode } from "@/context/ModeContext";
import { X as XT } from "@/constants/xTheme";
import { getXOffering, X_ENTITLEMENT } from "@/lib/revenuecat";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Purchases, { PURCHASES_ERROR_CODE } from "react-native-purchases";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Apple 구독 관리 URL (iOS App Store)
const APPLE_SUBSCRIPTION_MANAGE_URL =
  Platform.OS === "ios"
    ? "itms-apps://apps.apple.com/account/subscriptions"
    : "https://play.google.com/store/account/subscriptions";

const C      = Colors.light;
const NAVY   = XT.primary;   // Nautic Primary (xTheme single source)
const X_ACCENT = "#355C7D";
const X_LIGHT  = "#EEF4FA";

// ── 할인 정책 (표시 전용) ─────────────────────────────────────────────────────
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

// ── X 구독 상태 (서버 응답) ────────────────────────────────────────────────────
type XSubscriptionStatus = {
  subscription_status: "ACTIVE" | "CANCELLED_BUT_ACTIVE" | "EXPIRED" | "BILLING_ISSUE" | "PENDING" | "UNKNOWN";
  tier_key: string | null;
  krw_price: string | null;
  franchise_number: string | null;
  purchased_at: string | null;
  subscription_end_at: string | null;
  payment_failed_at: string | null;
  auto_renew_cancelled: boolean;
  synced_at: string | null;
  source: "paid" | "manual" | null;
};

// ── 구독 상태 표시 텍스트 ─────────────────────────────────────────────────────
function formatSubscriptionDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "—";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${dd}`;
}

// ── 구매 상태 ─────────────────────────────────────────────────────────────────
type PurchasePhase =
  | "IDLE"
  | "RESERVING"
  | "RESERVED"
  | "LOADING_PRODUCT"
  | "READY_TO_PURCHASE"
  | "PURCHASING"
  | "USER_CANCELLED"
  | "PURCHASE_FAILED"
  | "SYNCING"
  | "SYNC_FAILED"
  | "PURCHASED_X_PENDING"
  | "X_ACTIVE"
  | "X_TRIAL_ACTIVE"    // WP3: 3일 무료체험 진행 중
  | "PRODUCT_NOT_AVAILABLE";

interface SlotInfo {
  slotId: string;
  sequenceNumber: number;
  franchiseNumber: string;
  tierKey: string;
  discountPercent: number;
  storeProductId: string;
  paymentDeadlineAt: string;
  existing: boolean;
}

// ── X 한국 정책 가격 (앱 내 표시 전용) ─────────────────────────────────────────
// Apple Purchase Sheet / purchasePackage / RC product 는 변경 없음.
// 서버 slot.tierKey 기준으로 앱 내부 원화 안내 가격만 결정.
const X_KRW_PRICE: Record<string, string> = {
  tier1:    "₩75,000 / 월",
  tier2:    "₩105,000 / 월",
  tier3:    "₩135,000 / 월",
  standard: "₩150,000 / 월",
};
function getXKrwPrice(tierKey: string): string {
  return X_KRW_PRICE[tierKey] ?? "₩- / 월";
}

// RC 취소 오류 감지 (userCancelled deprecated → PURCHASES_ERROR_CODE 사용)
function isUserCancelled(e: any): boolean {
  return (
    e?.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR ||
    e?.userCancelled === true  // legacy fallback
  );
}

// deadline 남은 시간 표시 — §7 NaN-safe
// Returns a complete display string (never exposes NaN / raw timestamp)
function formatDeadline(deadlineAt: string | null | undefined): string {
  if (!deadlineAt) return "결제 기한 확인 필요";
  const d = new Date(deadlineAt);
  if (isNaN(d.getTime())) return "결제 기한 확인 필요";
  const diff = d.getTime() - Date.now();
  if (diff <= 0) return "예약 만료";
  const totalMinutes = Math.ceil(diff / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h >= 1) return `약 ${h}시간 남음`;
  return `약 ${m}분 남음`;
}

// ── 메인 화면 ─────────────────────────────────────────────────────────────────
export default function XSubscriptionScreen() {
  const insets = useSafeAreaInsets();
  const { token, pool, activeRole, adminUser } = useAuth();
  const { mode, refreshMode } = useMode();

  const [phase, setPhase] = useState<PurchasePhase>("IDLE");
  const [slot, setSlot]   = useState<SlotInfo | null>(null);
  const [pkg, setPkg]     = useState<any | null>(null);
  const [offeringError, setOfferingError] = useState<string | null>(null);

  // X02-D2: 구독 상태 세부 정보
  const [subscriptionStatus, setSubscriptionStatus] = useState<XSubscriptionStatus | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  // in-flight 잠금 (double tap defense)
  const inFlight = useRef(false);
  // purchase-succeeded guard: purchasePackage 성공 후 재진입 절대 방지
  // handleReserve 재실행 시에만 false로 리셋
  const purchaseSucceeded = useRef(false);
  // handleSync를 handlePurchase 클로저에서 안전하게 최신값으로 참조하기 위한 ref
  // (handleSync는 handlePurchase 이후에 선언되므로 deps 대신 ref 사용)
  const handleSyncRef = useRef<() => Promise<void>>(async () => {});

  // activeRole이 null(초기화 전)일 때 adminUser.role로 fallback
  const isPoolAdmin = (activeRole ?? adminUser?.role) === "pool_admin";
  const planLabel   = pool?.subscription_tier
    ? (pool.subscription_tier === "free" ? "무료 플랜" : `${pool.subscription_tier} 플랜`)
    : "현재 플랜";

  // 화면 진입 시 현재 mode 반영
  useEffect(() => {
    if (mode === "x") {
      setPhase("X_ACTIVE");
    } else if (mode === "x_pending") {
      setPhase("PURCHASED_X_PENDING");
    } else if (mode === "x_trial") {
      setPhase("X_TRIAL_ACTIVE"); // WP3
    }
    // normal/null → IDLE 유지
  }, [mode]);

  // X02-D2: mode==="x" 시 구독 상태 세부 정보 fetch
  useEffect(() => {
    if (mode !== "x" || !token) return;
    let cancelled = false;
    const fetch = async () => {
      setIsLoadingStatus(true);
      try {
        const res = await apiRequest(token, "/billing/x-subscription-status", { method: "GET" });
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setSubscriptionStatus(data);
        }
      } catch { /* silent — transient failure, UI will show data if available */ }
      finally { if (!cancelled) setIsLoadingStatus(false); }
    };
    fetch();
    return () => { cancelled = true; };
  }, [mode, token]);

  // 결제 성공 후 X_ACTIVE 전환 시 대시보드로 이동 (구매 직후에만)
  // purchaseSucceeded.current = true일 때만 내비게이션 — 단순 화면 진입은 무시
  useEffect(() => {
    if (phase !== "X_ACTIVE" || !purchaseSucceeded.current) return;
    const t = setTimeout(() => {
      Alert.alert(
        "SWIMNOTE X 시작! 🎉",
        "결제가 완료되어 X모드가 활성화되었습니다.\n지금 바로 프리미엄 기능을 이용하세요.",
        [{
          text: "확인",
          onPress: () => {
            purchaseSucceeded.current = false; // 완료 처리 후 리셋
            router.back();
          },
        }],
        { cancelable: false },
      );
    }, 400); // mode 반영 완료 후 짧은 딜레이
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── STEP 1: 예약 (reserve slot) ────────────────────────────────────────────
  const handleReserve = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    purchaseSucceeded.current = false; // 새 예약 시작 시 purchase guard 리셋
    setPhase("RESERVING");
    setOfferingError(null);

    try {
      const res  = await apiRequest(token, "/billing/x-reserve-slot", { method: "POST" });

      // §7: HTML / non-JSON 응답 방어 (구버전 dist, 프록시 오류 등)
      const ct = res.headers.get("content-type") ?? "";
      if (res.status >= 500 || !ct.includes("application/json")) {
        throw new Error("예약 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
      }
      let data: any;
      try { data = await res.json(); } catch {
        throw new Error("예약 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
      }

      if (!res.ok) {
        if (data?.error === "ALREADY_SUBSCRIBED") {
          // 이미 구독 중 → mode 재조회
          await refreshMode();
          return;
        }
        throw new Error(data?.message ?? "예약 오류");
      }

      const s: SlotInfo = data.slot;
      setSlot(s);
      setPhase("RESERVED");

      // STEP 2: offering 로드
      setPhase("LOADING_PRODUCT");
      try {
        const offering = await getXOffering();
        if (!offering) {
          setOfferingError("현재 결제 상품 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
          setPhase("PRODUCT_NOT_AVAILABLE");
          return;
        }

        // storeProductId와 정확히 일치하는 package 탐색
        const packages: any[] = offering.availablePackages ?? [];
        const matched = packages.find(
          (p: any) => p.product?.identifier === s.storeProductId,
        );

        if (!matched) {
          setOfferingError("현재 결제 상품 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
          setPhase("PRODUCT_NOT_AVAILABLE");
          return;
        }

        setPkg(matched);
        setPhase("READY_TO_PURCHASE");
      } catch (_err) {
        setOfferingError("현재 결제 상품 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
        setPhase("PRODUCT_NOT_AVAILABLE");
      }
    } catch (err: any) {
      setPhase("IDLE");
      Alert.alert("예약 오류", err?.message ?? "슬롯 예약 중 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      inFlight.current = false;
    }
  }, [token, refreshMode]);

  // ── STEP 3: Store 구매 ─────────────────────────────────────────────────────
  const handlePurchase = useCallback(async () => {
    // purchaseSucceeded guard: 이미 성공한 구매를 절대 재호출하지 않음
    // (phase 복귀, component remount, sandbox deferred transaction 등 모든 경로 차단)
    if (inFlight.current || !pkg || !slot || purchaseSucceeded.current) return;

    // deadline 만료 확인
    if (new Date(slot.paymentDeadlineAt) <= new Date()) {
      // 재예약 유도: IDLE로 초기화
      setSlot(null);
      setPkg(null);
      setPhase("IDLE");
      Alert.alert("예약 만료", "예약 기한이 만료되었습니다. 다시 신청해주세요.");
      return;
    }

    inFlight.current = true;
    setPhase("PURCHASING");

    try {
      await Purchases.purchasePackage(pkg);
      // 성공 즉시 flag 설정 — 이후 어떤 상태 변화에서도 재구매 불가
      purchaseSucceeded.current = true;
    } catch (e: any) {
      if (isUserCancelled(e)) {
        // 취소: slot 유지, 다시 결제 가능 (purchaseSucceeded는 false 유지)
        setPhase("USER_CANCELLED");
        inFlight.current = false;
        return;
      }
      setPhase("PURCHASE_FAILED");
      inFlight.current = false;
      return;
    }

    // 구매 성공 → sync (inFlight을 false로 해제해야 handleSync가 진입 가능)
    // handleSync는 이 useCallback 이후에 선언되므로 deps 대신 ref를 통해 최신값 참조
    inFlight.current = false;
    await handleSyncRef.current();
  }, [pkg, slot, token]);

  // ── STEP 4: 서버 sync ──────────────────────────────────────────────────────
  const handleSync = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPhase("SYNCING");

    try {
      const res  = await apiRequest(token, "/billing/sync-x-subscription", { method: "POST" });

      // §7: HTML / non-JSON 응답 방어
      const ct2 = res.headers.get("content-type") ?? "";
      if (res.status >= 500 || !ct2.includes("application/json")) {
        setPhase("SYNC_FAILED");
        return;
      }
      let data: any;
      try { data = await res.json(); } catch { setPhase("SYNC_FAILED"); return; }

      if (!res.ok) {
        setPhase("SYNC_FAILED");
        return;
      }

      // sync 성공 → mode 재조회
      await refreshMode();
      // mode 반영은 useEffect가 처리
    } catch (_err) {
      setPhase("SYNC_FAILED");
    } finally {
      inFlight.current = false;
    }
  }, [token, refreshMode]);

  // handleSyncRef를 항상 최신 handleSync로 유지 (handlePurchase 클로저에서 사용)
  useEffect(() => { handleSyncRef.current = handleSync; }, [handleSync]);

  // X02-D2: 구매 복원 (Restore Purchases)
  // spec §5: RC restore → server confirm → refreshMode
  // spec §5 E: server sync 실패 시 client entitlement만으로 X 확정 금지
  const handleRestore = useCallback(async () => {
    if (!isPoolAdmin || isRestoring) return;
    setIsRestoring(true);

    try {
      // Step 1: RC restore
      const customerInfo = await Purchases.restorePurchases();
      const activeEntitlements = customerInfo.entitlements.active ?? {};
      const hasXEntitlement = X_ENTITLEMENT in activeEntitlements;

      if (!hasXEntitlement) {
        // spec §6 B: X entitlement 없음
        Alert.alert(
          "복원할 구독 없음",
          "이 Apple ID에 복원 가능한 SWIMNOTE X 구독이 없습니다.",
          [{ text: "확인" }],
        );
        return;
      }

      // Step 2: server sync (spec §5: 최종 truth = server)
      const res = await apiRequest(token, "/billing/restore-x-subscription", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body?.error === "RC_ENTITLEMENT_INACTIVE") {
          // spec §6 D: wrong Apple ID / no server-confirmed purchase
          Alert.alert(
            "복원 실패",
            "서버에서 X 구독을 확인하지 못했습니다. 다른 Apple ID로 로그인한 경우 해당 계정으로 복원해주세요.",
            [{ text: "확인" }],
          );
          return;
        }
        // spec §6 E: server sync failure
        Alert.alert(
          "서버 동기화 실패",
          "구독 정보를 서버와 동기화하지 못했습니다. 잠시 후 다시 시도해주세요.",
          [{ text: "확인" }],
        );
        return;
      }

      // Step 3: mode refresh
      await refreshMode();
      Alert.alert(
        "복원 완료",
        "SWIMNOTE X 구독이 복원되었습니다.",
        [{ text: "확인" }],
      );
    } catch (e: any) {
      // spec §6 C: network/transient failure — confirmed state 보존
      const msg: string = e?.message ?? "";
      const isCancel = msg.toLowerCase().includes("cancel") || e?.userCancelled === true;
      if (!isCancel) {
        Alert.alert(
          "복원 오류",
          "구매 복원 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
          [{ text: "확인" }],
        );
      }
    } finally {
      setIsRestoring(false);
    }
  }, [isPoolAdmin, isRestoring, token, refreshMode]);

  // X02-D2: Apple 구독 관리 (spec §7: Apple subscription management)
  const handleManageSubscription = useCallback(() => {
    Linking.openURL(APPLE_SUBSCRIPTION_MANAGE_URL).catch(() => {
      Alert.alert("오류", "구독 관리 화면을 열 수 없습니다. 기기 설정 → Apple ID → 구독에서 확인해주세요.");
    });
  }, []);

  // 취소 후 재시도: 기존 slot+pkg 재사용
  const handleRetryFromCancelled = useCallback(() => {
    if (!pkg || !slot) return;
    setPhase("READY_TO_PURCHASE");
  }, [pkg, slot]);

  // offering 재로드 (PRODUCT_NOT_AVAILABLE)
  const handleRetryOffering = useCallback(async () => {
    if (!slot || inFlight.current) return;
    inFlight.current = true;
    setPhase("LOADING_PRODUCT");
    setOfferingError(null);

    try {
      const offering = await getXOffering();
      if (!offering) throw new Error("offering 없음");
      const packages: any[] = offering.availablePackages ?? [];
      const matched = packages.find((p: any) => p.product?.identifier === slot.storeProductId);
      if (!matched) throw new Error("package 없음");
      setPkg(matched);
      setPhase("READY_TO_PURCHASE");
    } catch (_err) {
      setOfferingError("현재 결제 상품 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
      setPhase("PRODUCT_NOT_AVAILABLE");
    } finally {
      inFlight.current = false;
    }
  }, [slot]);

  // ── 렌더링 ─────────────────────────────────────────────────────────────────

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

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >

        {/* ── X_ACTIVE ─────────────────────────────────────────────────────── */}
        {phase === "X_ACTIVE" && (
          <ActiveView
            franchiseNumber={slot?.franchiseNumber ?? null}
            subscriptionStatus={subscriptionStatus}
            isLoadingStatus={isLoadingStatus}
            isRestoring={isRestoring}
            isPoolAdmin={isPoolAdmin}
            onManage={handleManageSubscription}
            onRestore={handleRestore}
          />
        )}

        {/* ── X_TRIAL_ACTIVE ───────────────────────────────────────────────── */}
        {phase === "X_TRIAL_ACTIVE" && (
          <TrialActiveView
            mode={mode}
            onGoSubscribe={() => {
              // Trial → X 정식 구독 전환을 위해 IDLE로 진입
              setPhase("IDLE");
            }}
          />
        )}

        {/* ── PURCHASED_X_PENDING ──────────────────────────────────────────── */}
        {phase === "PURCHASED_X_PENDING" && (
          <PendingView />
        )}

        {/* ── SYNC_FAILED ──────────────────────────────────────────────────── */}
        {phase === "SYNC_FAILED" && (
          <SyncFailedView onRetry={handleSync} />
        )}

        {/* ── 정보 화면 (IDLE / RESERVING / mode 미진입) ─────────────────────── */}
        {!["X_ACTIVE", "PURCHASED_X_PENDING", "SYNC_FAILED"].includes(phase) && (
          <>
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

            {/* SWIMNOTE X 설명 */}
            <View style={s.section}>
              <Text style={s.sectionTitle}>추가 서비스</Text>
              <View style={[s.card, { backgroundColor: C.card }]}>
                <View style={[s.xHeader, { backgroundColor: X_LIGHT }]}>
                  <View style={s.xBadge}>
                    <Text style={s.xBadgeText}>X</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.xTitle, { color: X_ACCENT }]}>SWIMNOTE X</Text>
                    <Text style={s.xSubtitle}>별도 정기결제 · 기본 플랜과 독립 운영</Text>
                  </View>
                </View>
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

            {/* 선착순 할인 정책 (퍼센트만 — 실제 금액 없음) */}
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
                    <Text style={[s.tierRange, tier.highlight && { color: X_ACCENT }]}>
                      {tier.range}
                    </Text>
                    <View style={[s.tierBadge, { backgroundColor: tier.highlight ? X_ACCENT : "#F1F5F9" }]}>
                      <Text style={[s.tierRate, { color: tier.highlight ? "#fff" : C.textSecondary }]}>
                        {tier.rate}
                      </Text>
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
                SWIMNOTE 기본 플랜과 SWIMNOTE X는 별도 정기결제입니다.{"\n"}
                기본 플랜의 결제일과 X모드 결제일은 서로 다를 수 있습니다.
              </Text>
            </View>

            {/* ── 예약 확인 카드 (RESERVED / LOADING / READY / PURCHASING / CANCELLED / FAILED) */}
            {slot && !["IDLE", "RESERVING"].includes(phase) && (
              <ReservationCard
                slot={slot}
                pkg={pkg}
                phase={phase}
                offeringError={offeringError}
                onPurchase={handlePurchase}
                onRetryFromCancelled={handleRetryFromCancelled}
                onRetryOffering={handleRetryOffering}
                onSync={handleSync}
              />
            )}

            {/* ── CTA 버튼 영역 ── */}
            {["IDLE", "RESERVING"].includes(phase) && (
              <CtaSection
                isPoolAdmin={isPoolAdmin}
                isReserving={phase === "RESERVING"}
                onPress={handleReserve}
              />
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ── 서브 컴포넌트 ─────────────────────────────────────────────────────────────

function CtaSection({
  isPoolAdmin,
  isReserving,
  onPress,
}: {
  isPoolAdmin: boolean;
  isReserving: boolean;
  onPress: () => void;
}) {
  if (!isPoolAdmin) {
    return (
      <View style={[s.card, { backgroundColor: "#F8FAFC", padding: 16, alignItems: "center", gap: 8 }]}>
        <Text style={[s.planSub, { textAlign: "center", lineHeight: 20 }]}>
          이 계정에는 정기결제 권한이 없습니다.{"\n"}
          수영장 소유자 또는 결제 권한이 있는 계정에서 진행해주세요.
        </Text>
      </View>
    );
  }

  return (
    <Pressable
      style={({ pressed }) => [
        s.ctaBtn,
        { backgroundColor: isReserving ? X_ACCENT + "80" : X_ACCENT, opacity: pressed ? 0.85 : 1 },
      ]}
      onPress={onPress}
      disabled={isReserving}
    >
      {isReserving
        ? <ActivityIndicator size="small" color="#fff" />
        : <Text style={s.ctaBtnText}>정기결제 신청하기</Text>
      }
    </Pressable>
  );
}

function ReservationCard({
  slot,
  pkg,
  phase,
  offeringError,
  onPurchase,
  onRetryFromCancelled,
  onRetryOffering,
  onSync,
}: {
  slot: SlotInfo;
  pkg: any | null;
  phase: PurchasePhase;
  offeringError: string | null;
  onPurchase: () => void;
  onRetryFromCancelled: () => void;
  onRetryOffering: () => void;
  onSync: () => void;
}) {
  // RC localizedPrice는 purchasePackage/package matching에만 사용 (표시 불가 — storefront 의존)
  // 앱 내 가격 안내는 서버 slot.tierKey 기준 KRW 정책 가격으로 고정
  const krwPrice: string = getXKrwPrice(slot.tierKey);
  const deadlineRemaining = formatDeadline(slot.paymentDeadlineAt);

  const isLoading = phase === "LOADING_PRODUCT" || phase === "RESERVED";
  const isPurchasing = phase === "PURCHASING";
  const isSyncing = phase === "SYNCING";

  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>예약 정보</Text>
      <View style={[s.reserveCard, { backgroundColor: X_LIGHT, borderColor: X_ACCENT + "40" }]}>

        {/* 가맹번호 */}
        <View style={s.reserveRow}>
          <Text style={s.reserveLabel}>X 가맹번호</Text>
          <Text style={[s.reserveValue, { color: X_ACCENT, fontFamily: "Pretendard-SemiBold" }]}>
            {slot.franchiseNumber}
          </Text>
        </View>

        {/* 선착순 할인 */}
        {slot.discountPercent > 0 && (
          <View style={s.reserveRow}>
            <Text style={s.reserveLabel}>선착순 할인</Text>
            <View style={[s.discountBadge, { backgroundColor: X_ACCENT }]}>
              <Text style={s.discountBadgeText}>{slot.discountPercent}% 할인</Text>
            </View>
          </View>
        )}

        {/* 월 결제 가격 — KRW 정책 가격 (storefront 무관, 앱 내 한국 정책 안내) */}
        <View style={s.reserveRow}>
          <Text style={s.reserveLabel}>월 정기결제</Text>
          {isLoading
            ? <ActivityIndicator size="small" color={X_ACCENT} />
            : <Text style={[s.reserveValue, { fontSize: 16 }]}>{krwPrice}</Text>
          }
        </View>

        {/* 결제 기한 */}
        <View style={s.reserveRow}>
          <Text style={s.reserveLabel}>결제 기한</Text>
          <Text style={[s.reserveValue, { color: deadlineRemaining === "예약 만료" ? "#DC2626" : C.textSecondary }]}>
            {deadlineRemaining}
          </Text>
        </View>

        {/* 기한 안내 */}
        <View style={[s.deadlineNote, { borderTopColor: X_ACCENT + "20" }]}>
          <Text style={s.deadlineNoteText}>
            예약 후 1시간 이내 결제가 완료되지 않으면 해당 가맹번호는 자동으로 만료됩니다.
          </Text>
        </View>
      </View>

      {/* PRODUCT_NOT_AVAILABLE */}
      {offeringError && (
        <View style={s.errorCard}>
          <LucideIcon name="alert-circle" size={15} color="#DC2626" />
          <Text style={s.errorText}>{offeringError}</Text>
          <Pressable onPress={onRetryOffering} style={s.retryBtn}>
            <Text style={s.retryBtnText}>다시 시도</Text>
          </Pressable>
        </View>
      )}

      {/* 취소 후 재시도 */}
      {phase === "USER_CANCELLED" && (
        <View style={s.cancelCard}>
          <Text style={s.cancelText}>결제가 취소되었습니다.</Text>
          <Pressable
            style={[s.ctaBtn, { backgroundColor: X_ACCENT }]}
            onPress={onRetryFromCancelled}
          >
            <Text style={s.ctaBtnText}>다시 결제하기</Text>
          </Pressable>
        </View>
      )}

      {/* 결제 실패 */}
      {phase === "PURCHASE_FAILED" && (
        <View style={s.errorCard}>
          <LucideIcon name="alert-triangle" size={15} color="#DC2626" />
          <Text style={s.errorText}>결제를 완료하지 못했습니다. 잠시 후 다시 시도해주세요.</Text>
        </View>
      )}

      {/* 결제 계속하기 버튼 */}
      {(phase === "READY_TO_PURCHASE") && (
        <Pressable
          style={({ pressed }) => [s.ctaBtn, { backgroundColor: X_ACCENT, opacity: pressed ? 0.85 : 1 }]}
          onPress={onPurchase}
        >
          <Text style={s.ctaBtnText}>결제 계속하기</Text>
        </Pressable>
      )}

      {/* 결제 중 */}
      {isPurchasing && (
        <View style={[s.ctaBtn, { backgroundColor: X_ACCENT + "80", flexDirection: "row", gap: 10 }]}>
          <ActivityIndicator size="small" color="#fff" />
          <Text style={s.ctaBtnText}>결제 진행 중...</Text>
        </View>
      )}

      {/* 동기화 중 */}
      {isSyncing && (
        <View style={[s.ctaBtn, { backgroundColor: X_ACCENT + "80", flexDirection: "row", gap: 10 }]}>
          <ActivityIndicator size="small" color="#fff" />
          <Text style={s.ctaBtnText}>X모드 활성화 확인 중...</Text>
        </View>
      )}
    </View>
  );
}

// ── 구독 상태 배지 UI ──────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: XSubscriptionStatus["subscription_status"] }) {
  const config: Record<string, { label: string; bg: string; color: string }> = {
    ACTIVE:              { label: "이용 중",          bg: "#E8F5F0", color: "#166534" },
    CANCELLED_BUT_ACTIVE:{ label: "해지 예정",         bg: "#FEF3C7", color: "#92400E" },
    EXPIRED:             { label: "이용 종료",         bg: "#FEF2F2", color: "#DC2626" },
    BILLING_ISSUE:       { label: "결제 확인 필요",    bg: "#FEF2F2", color: "#DC2626" },
    PENDING:             { label: "처리 중",           bg: "#F0F9FF", color: "#0369A1" },
    UNKNOWN:             { label: "구독 상태 확인 중",  bg: "#F8FAFC", color: "#6B7280" },
  };
  const c = config[status] ?? config.UNKNOWN;
  return (
    <View style={{ borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: c.bg }}>
      <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: c.color }}>{c.label}</Text>
    </View>
  );
}

function ActiveView({
  franchiseNumber,
  subscriptionStatus,
  isLoadingStatus,
  isRestoring,
  isPoolAdmin,
  onManage,
  onRestore,
}: {
  franchiseNumber: string | null;
  subscriptionStatus: XSubscriptionStatus | null;
  isLoadingStatus: boolean;
  isRestoring: boolean;
  isPoolAdmin: boolean;
  onManage: () => void;
  onRestore: () => void;
}) {
  const isCancelledButActive = subscriptionStatus?.subscription_status === "CANCELLED_BUT_ACTIVE";
  const isBillingIssue       = subscriptionStatus?.subscription_status === "BILLING_ISSUE";
  const endDate = subscriptionStatus?.subscription_end_at;

  return (
    <View style={{ gap: 16 }}>
      {/* 상태 카드 */}
      <View style={[s.card, { backgroundColor: X_LIGHT, padding: 20, gap: 14 }]}>
        {/* 헤더 */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={[s.xBadge, { width: 48, height: 48, borderRadius: 14 }]}>
            <Text style={[s.xBadgeText, { fontSize: 20 }]}>X</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.planName, { color: X_ACCENT, fontSize: 17 }]}>SWIMNOTE X</Text>
            {subscriptionStatus && (
              <StatusBadge status={subscriptionStatus.subscription_status} />
            )}
          </View>
          {isLoadingStatus && <ActivityIndicator size="small" color={X_ACCENT} />}
        </View>

        {/* 구독 상세 정보 */}
        {subscriptionStatus && (
          <View style={{ gap: 0 }}>
            {/* 가맹번호 */}
            {(subscriptionStatus.franchise_number || franchiseNumber) && (
              <View style={s.reserveRow}>
                <Text style={s.reserveLabel}>X 가맹번호</Text>
                <Text style={[s.reserveValue, { color: X_ACCENT }]}>
                  {subscriptionStatus.franchise_number ?? franchiseNumber}
                </Text>
              </View>
            )}

            {/* 월 결제 */}
            {subscriptionStatus.krw_price && (
              <View style={s.reserveRow}>
                <Text style={s.reserveLabel}>월 결제</Text>
                <Text style={s.reserveValue}>{subscriptionStatus.krw_price} / 월</Text>
              </View>
            )}

            {/* 구독 시작일 */}
            {subscriptionStatus.purchased_at && (
              <View style={s.reserveRow}>
                <Text style={s.reserveLabel}>구독 시작일</Text>
                <Text style={s.reserveValue}>{formatSubscriptionDate(subscriptionStatus.purchased_at)}</Text>
              </View>
            )}

            {/* 다음 갱신일 or 이용 종료일 */}
            {endDate && (
              <View style={s.reserveRow}>
                <Text style={s.reserveLabel}>
                  {isCancelledButActive ? "이용 종료 예정일" : "다음 갱신일"}
                </Text>
                <Text style={[s.reserveValue, isCancelledButActive ? { color: "#D97706" } : {}]}>
                  {formatSubscriptionDate(endDate)}
                </Text>
              </View>
            )}

            {/* 자동갱신 상태 */}
            <View style={s.reserveRow}>
              <Text style={s.reserveLabel}>자동갱신</Text>
              <Text style={[s.reserveValue, { color: subscriptionStatus.auto_renew_cancelled ? "#D97706" : "#166534" }]}>
                {subscriptionStatus.auto_renew_cancelled ? "해지 예정" : "유지 중"}
              </Text>
            </View>
          </View>
        )}

        {/* CANCELLED_BUT_ACTIVE 안내 */}
        {isCancelledButActive && endDate && (
          <View style={{ borderRadius: 10, backgroundColor: "#FFFBEB", borderWidth: 1, borderColor: "#FCD34D", padding: 12 }}>
            <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: "#92400E", lineHeight: 18 }}>
              구독 해지 예정입니다.{"\n"}
              {formatSubscriptionDate(endDate)}까지 SWIMNOTE X를 계속 사용할 수 있습니다.
            </Text>
          </View>
        )}

        {/* BILLING_ISSUE 안내 */}
        {isBillingIssue && (
          <View style={{ borderRadius: 10, backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA", padding: 12 }}>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 4 }}>
              <LucideIcon name="alert-circle" size={14} color="#DC2626" />
              <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: "#DC2626" }}>결제 확인 필요</Text>
            </View>
            <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: "#991B1B", lineHeight: 18 }}>
              결제 처리에 문제가 있습니다. 구독 관리에서 결제 정보를 확인해주세요.
            </Text>
          </View>
        )}
      </View>

      {/* 액션 버튼 영역 */}
      <View style={{ gap: 10 }}>
        {/* X모드 세팅하기 */}
        <Pressable
          style={({ pressed }) => [s.ctaBtn, { backgroundColor: X_ACCENT, opacity: pressed ? 0.85 : 1 }]}
          onPress={() => router.push("/(admin)/x-setup" as any)}
        >
          <LucideIcon name="settings" size={16} color="#fff" />
          <Text style={s.ctaBtnText}>X모드 세팅하기</Text>
        </Pressable>

        {/* 구독 관리 (Apple subscription management) — pool_admin만 */}
        {isPoolAdmin && (
          <Pressable
            style={({ pressed }) => [
              s.ctaBtn,
              { backgroundColor: "transparent", borderWidth: 1.5, borderColor: X_ACCENT, opacity: pressed ? 0.7 : 1 },
            ]}
            onPress={onManage}
          >
            <LucideIcon name="external-link" size={16} color={X_ACCENT} />
            <Text style={[s.ctaBtnText, { color: X_ACCENT }]}>구독 관리</Text>
          </Pressable>
        )}

        {/* 구매 복원 — pool_admin만, CANCELLED_BUT_ACTIVE가 아닌 경우 */}
        {isPoolAdmin && !isCancelledButActive && (
          <Pressable
            style={({ pressed }) => [
              s.ctaBtn,
              { backgroundColor: "transparent", borderWidth: 1, borderColor: C.border, opacity: pressed ? 0.7 : 1 },
            ]}
            onPress={onRestore}
            disabled={isRestoring}
          >
            {isRestoring
              ? <ActivityIndicator size="small" color={C.textMuted} />
              : <LucideIcon name="refresh-cw" size={15} color={C.textMuted} />
            }
            <Text style={[s.ctaBtnText, { color: C.textMuted, fontSize: 14 }]}>
              {isRestoring ? "복원 중..." : "구매 복원"}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// ── WP3: Trial Active 뷰 ──────────────────────────────────────────────────────
function TrialActiveView({
  mode,
  onGoSubscribe,
}: {
  mode: string | null;
  onGoSubscribe: () => void;
}) {
  return (
    <View style={{ gap: 16 }}>
      {/* 체험 진행 중 상태 카드 */}
      <View style={[s.card, { backgroundColor: "#EFF6FF", padding: 0, overflow: "hidden" }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: "#BFDBFE" }}>
          <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: "#DBEAFE", alignItems: "center", justifyContent: "center" }}>
            <LucideIcon name="zap" size={22} color={X_ACCENT} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontFamily: "Pretendard-Regular", color: "#1E3A5F" }}>
              X AI 기능 무료체험 중
            </Text>
            <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: "#60A5FA", marginTop: 2 }}>
              3일 무료체험 · 자동결제 없음
            </Text>
          </View>
          <View style={{ backgroundColor: "#DBEAFE", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: "#93C5FD" }}>
            <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: "#1E40AF" }}>체험 중</Text>
          </View>
        </View>
        <View style={{ padding: 14, gap: 8 }}>
          <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: "#374151", lineHeight: 20 }}>
            현재 체험 중인 기능: AI 일지 작성 지원, 학부모 AI 피드
          </Text>
          <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: "#6B7280", lineHeight: 18 }}>
            체험에 포함되지 않는 기능: 센터 맞춤 커리큘럼 설정, 성장 리포트, X 전용 분석 기능
          </Text>
        </View>
      </View>

      {/* X 정식 구독 안내 */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>SWIMNOTE X 정식 구독으로 모든 기능 이용</Text>
        <View style={[s.card, { backgroundColor: C.card }]}>
          <View style={[s.xHeader, { backgroundColor: X_LIGHT }]}>
            <View style={s.xBadge}>
              <Text style={s.xBadgeText}>X</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.xTitle, { color: X_ACCENT }]}>SWIMNOTE X</Text>
              <Text style={s.xSubtitle}>체험 종료 후에도 계속 이용</Text>
            </View>
          </View>
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

      {/* 구독 신청 버튼 */}
      <Pressable
        style={({ pressed }) => [s.ctaBtn, { backgroundColor: X_ACCENT, opacity: pressed ? 0.85 : 1 }]}
        onPress={onGoSubscribe}
      >
        <Text style={s.ctaBtnText}>X 정식 구독 신청하기</Text>
      </Pressable>
    </View>
  );
}

function PendingView() {
  return (
    <View style={[s.card, { backgroundColor: X_LIGHT, padding: 20, gap: 14 }]}>
      <View style={{ alignItems: "center", gap: 8 }}>
        <View style={[s.xBadge, { width: 52, height: 52, borderRadius: 16 }]}>
          <Text style={[s.xBadgeText, { fontSize: 22 }]}>X</Text>
        </View>
        <Text style={[s.planName, { color: X_ACCENT, fontSize: 17, textAlign: "center" }]}>
          SWIMNOTE X 이용이 시작되었습니다.
        </Text>
        <Text style={[s.planSub, { textAlign: "center", lineHeight: 20 }]}>
          우리 수영장 커리큘럼과 X 기능 설정을 진행해주세요.
        </Text>
      </View>
      <Pressable
        style={({ pressed }) => [s.ctaBtn, { backgroundColor: X_ACCENT, opacity: pressed ? 0.85 : 1 }]}
        onPress={() => router.push("/(admin)/x-setup" as any)}
      >
        <Text style={s.ctaBtnText}>X모드 세팅하기</Text>
      </Pressable>
    </View>
  );
}

function SyncFailedView({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={[s.card, { backgroundColor: "#FFFBEB", borderWidth: 1, borderColor: "#FCD34D", padding: 18, gap: 12 }]}>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <LucideIcon name="alert-triangle" size={18} color="#D97706" />
        <Text style={[s.planName, { color: "#92400E", flex: 1 }]}>
          결제는 완료되었지만 X모드 활성화 확인이 지연되고 있습니다.
        </Text>
      </View>
      <Text style={[s.planSub, { lineHeight: 20 }]}>
        실제 결제는 정상적으로 처리되었을 수 있습니다. 잠시 후 다시 확인해주세요.
      </Text>
      <Pressable
        style={({ pressed }) => [s.ctaBtn, { backgroundColor: "#D97706", opacity: pressed ? 0.85 : 1 }]}
        onPress={onRetry}
      >
        <Text style={s.ctaBtnText}>활성화 다시 확인</Text>
      </Pressable>
    </View>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────
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

  reserveCard:     { borderRadius: 16, borderWidth: 1, padding: 0, overflow: "hidden" },
  reserveRow:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: X_ACCENT + "15" },
  reserveLabel:    { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  reserveValue:    { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.text },
  discountBadge:   { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  discountBadgeText: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#fff" },
  deadlineNote:    { padding: 14, borderTopWidth: 1 },
  deadlineNoteText:{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted, lineHeight: 18 },

  ctaBtn:          { borderRadius: 14, paddingVertical: 15, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  ctaBtnText:      { fontSize: 16, fontFamily: "Pretendard-Regular", color: "#fff" },

  errorCard:       { flexDirection: "row", alignItems: "flex-start", flexWrap: "wrap", gap: 8, borderRadius: 12, backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA", padding: 14 },
  errorText:       { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: "#DC2626", lineHeight: 20 },
  retryBtn:        { alignSelf: "flex-start", marginTop: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: "#FEE2E2", borderWidth: 1, borderColor: "#FECACA" },
  retryBtnText:    { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#DC2626" },

  cancelCard:      { gap: 12 },
  cancelText:      { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary, textAlign: "center" },
});
