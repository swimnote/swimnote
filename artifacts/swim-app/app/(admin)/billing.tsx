/**
 * (admin)/billing.tsx — 관리자: 결제 관리
 * 현재 구독 상태 확인, 카드 등록, 플랜 변경, 재결제
 * - 최초 결제 50% 할인 표시
 * - 엔터프라이즈 2000/3000 플랜 포함
 * - 저장공간 80%/90%/100% 상태 표시
 * - MAX 플랜 사용자에게는 엔터프라이즈 플랜만 업그레이드 노출
 */
import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState, useCallback } from "react";
import {
  ActivityIndicator, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { router } from "expo-router";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { ConfirmModal } from "@/components/common/ConfirmModal";

interface Plan {
  tier: string; name: string;
  price_per_month: number; member_limit: number; storage_gb: number;
  display_storage?: string; plan_id?: string;
}
interface CardInfo { id: string; card_last4: string; card_brand: string; card_nickname?: string | null; }
interface SubInfo { tier: string; status: string; next_billing_at?: string | null; plan_name?: string; price_per_month?: number; member_limit?: number; }
interface HistoryItem { id: string; amount: number; status: string; description?: string | null; paid_at?: string | null; type?: string; }
interface BillingStatus {
  is_readonly: boolean; upload_blocked: boolean;
  payment_failed_at: string | null; subscription_status: string | null;
  days_until_deletion: number | null;
  member_count: number; member_limit: number;
  storage_used_gb: number; storage_quota_gb: number; storage_used_pct: number;
  first_payment_used: boolean;
}

const PLAN_COLOR: Record<string, string> = {
  free:            "#6F6B68",
  starter:         "#4EA7D8",
  basic:           "#2E9B6F",
  standard:        "#1F8F86",
  growth:          "#7C3AED",
  pro:             "#EC4899",
  max:             "#D97706",
  enterprise_2000: "#B45309",
  enterprise_3000: "#991B1B",
};

const PLAN_SKU: Record<string, string> = {
  starter:         "swimnote_30",
  basic:           "swimnote_50",
  standard:        "swimnote_100",
  growth:          "swimnote_300",
  pro:             "swimnote_500",
  max:             "swimnote_1000",
  enterprise_2000: "swimnote_2000",
  enterprise_3000: "swimnote_3000",
};

const PAYMENT_FAILED_STATUSES = new Set(["payment_failed", "pending_deletion", "deleted"]);

export default function BillingScreen() {
  const { token, refreshPool } = useAuth();
  const { themeColor } = useBrand();

  const [status, setStatus]       = useState<SubInfo | null>(null);
  const [card, setCard]           = useState<CardInfo | null>(null);
  const [plans, setPlans]         = useState<Plan[]>([]);
  const [history, setHistory]     = useState<HistoryItem[]>([]);
  const [billingInfo, setBillingInfo] = useState<BillingStatus | null>(null);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [showCardForm, setShowCardForm] = useState(false);
  const [cardNum, setCardNum]   = useState("");
  const [expiry, setExpiry]     = useState("");
  const [nickname, setNickname] = useState("");
  const [cardSaving, setCardSaving] = useState(false);

  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmTitle, setConfirmTitle]     = useState("");
  const [confirmMessage, setConfirmMessage] = useState("");
  const [confirmAction, setConfirmAction]   = useState<(() => void) | null>(null);

  function showConfirm(title: string, message: string, action: () => void) {
    setConfirmTitle(title); setConfirmMessage(message);
    setConfirmAction(() => action); setConfirmVisible(true);
  }

  const load = useCallback(async () => {
    try {
      const [sr, hr] = await Promise.all([
        apiRequest(token, "/billing/status"),
        apiRequest(token, "/billing/history"),
      ]);
      const [sd, hd] = await Promise.all([sr.json(), hr.json()]);
      setStatus(sd.subscription ?? null);
      setCard(sd.card ?? null);
      setPlans(Array.isArray(sd.plans) ? sd.plans : []);
      setHistory(Array.isArray(hd) ? hd : []);
      setBillingInfo({
        is_readonly:          sd.is_readonly ?? false,
        upload_blocked:       sd.upload_blocked ?? false,
        payment_failed_at:    sd.payment_failed_at ?? null,
        subscription_status:  sd.subscription_status ?? null,
        days_until_deletion:  sd.days_until_deletion ?? null,
        member_count:         sd.member_count ?? 0,
        member_limit:         sd.member_limit ?? 5,
        storage_used_gb:      sd.storage_used_gb ?? 0,
        storage_quota_gb:     sd.storage_quota_gb ?? 0.1,
        storage_used_pct:     sd.storage_used_pct ?? 0,
        first_payment_used:   sd.first_payment_used ?? false,
      });
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function registerCard() {
    const digits = cardNum.replace(/\s/g, "");
    if (digits.length < 15) { showConfirm("오류", "카드번호를 정확히 입력해주세요.", () => {}); return; }
    if (!expiry)             { showConfirm("오류", "유효기간을 입력해주세요 (MM/YY)", () => {}); return; }
    setCardSaving(true);
    try {
      const r = await apiRequest(token, "/billing/cards", {
        method: "POST",
        body: JSON.stringify({ card_number: digits, expiry, card_nickname: nickname }),
      });
      const d = await r.json();
      if (!r.ok) { showConfirm("카드 등록 실패", d.error ?? "카드 등록에 실패했습니다.", () => {}); return; }
      setShowCardForm(false); setCardNum(""); setExpiry(""); setNickname("");
      load();
    } finally { setCardSaving(false); }
  }

  async function subscribe(tier: string) {
    setSubscribing(tier);
    try {
      const r = await apiRequest(token, "/billing/subscribe", {
        method: "POST", body: JSON.stringify({ tier }),
      });
      const d = await r.json();
      if (!r.ok) { showConfirm("구독 실패", d.error ?? "구독 변경에 실패했습니다.", () => {}); return; }
      if (d.change_type === "first_payment") {
        const gross = d.gross_amount?.toLocaleString?.() ?? "";
        const charged = d.charged_amount?.toLocaleString?.() ?? "";
        showConfirm("첫 구독 50% 할인 적용!", `첫 달 결제 완료\n정가 ₩${gross} → 실결제 ₩${charged}\n다음 달부터 정상가 청구됩니다.`, () => {});
      } else if (d.change_type === "downgrade" && d.applies_at) {
        showConfirm("다운그레이드 예약", d.message ?? `${d.applies_at} 이후 플랜이 변경됩니다.`, () => {});
      } else if (d.change_type === "upgrade") {
        showConfirm("업그레이드 완료", "플랜이 즉시 변경되었습니다.", () => {});
      } else if (d.change_type === "new") {
        showConfirm("구독 시작", "구독이 시작되었습니다.", () => {});
      }
      await load(); await refreshPool();
    } finally { setSubscribing(null); }
  }

  async function retryPayment() {
    setRetrying(true);
    try {
      const r = await apiRequest(token, "/billing/retry", { method: "POST" });
      const d = await r.json();
      if (!r.ok) { showConfirm("재결제 실패", d.error ?? "재결제에 실패했습니다. 카드 정보를 확인해주세요.", () => {}); return; }
      await load(); await refreshPool();
      showConfirm("재결제 성공", "서비스가 정상적으로 복구되었습니다.", () => {});
    } finally { setRetrying(false); }
  }

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={themeColor} />;

  const currentTier     = status?.tier ?? "free";
  const isPaymentFailed = PAYMENT_FAILED_STATUSES.has(billingInfo?.subscription_status ?? "");
  const daysLeft        = billingInfo?.days_until_deletion;
  const storagePct      = billingInfo?.storage_used_pct ?? 0;
  const storageColor    = storagePct >= 100 ? "#DC2626" : storagePct >= 90 ? "#D97706" : storagePct >= 80 ? "#F59E0B" : themeColor;

  // MAX 플랜 사용자는 엔터프라이즈만 노출, 그 외는 전체 노출
  const visiblePlans = currentTier === "max"
    ? plans.filter(p => p.tier === "enterprise_2000" || p.tier === "enterprise_3000")
    : plans;

  return (
    <View style={s.safe}>
      <SubScreenHeader title="구독관리" />

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={themeColor} />}
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
      >

        {/* ── 결제 실패 / 삭제 예약 긴급 배너 ── */}
        {isPaymentFailed && (
          <View style={[s.failBanner,
            billingInfo?.subscription_status === "deleted" ? s.failBannerDeleted : s.failBannerActive]}>
            <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
              <Feather
                name={billingInfo?.subscription_status === "deleted" ? "x-circle" : "alert-triangle"}
                size={18}
                color={billingInfo?.subscription_status === "deleted" ? "#6F6B68" : "#DC2626"}
              />
              <View style={{ flex: 1 }}>
                <Text style={[s.failTitle, billingInfo?.subscription_status === "deleted" && { color: "#6F6B68" }]}>
                  {billingInfo?.subscription_status === "deleted"
                    ? "계정이 삭제되었습니다"
                    : billingInfo?.subscription_status === "pending_deletion"
                    ? "데이터 삭제 예약됨"
                    : "결제 실패로 인해 서비스 이용이 제한되었습니다"}
                </Text>
                <Text style={s.failDesc}>
                  {billingInfo?.subscription_status === "deleted"
                    ? "모든 데이터가 영구 삭제되었습니다."
                    : daysLeft != null
                    ? `데이터 삭제까지 ${daysLeft}일 남았습니다. 지금 재결제하면 복구됩니다.`
                    : "빠른 시일 내에 재결제를 진행해주세요."}
                </Text>
              </View>
            </View>
            {billingInfo?.subscription_status !== "deleted" && (
              <Pressable
                style={[s.retryBtn, retrying && { opacity: 0.6 }]}
                onPress={() => showConfirm("재결제 진행", "등록된 카드로 재결제를 진행합니다.\n서비스가 즉시 복구됩니다.", retryPayment)}
                disabled={retrying}
              >
                {retrying
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={s.retryBtnTxt}>지금 재결제</Text>
                }
              </Pressable>
            )}
          </View>
        )}

        {/* ── 현재 구독 ── */}
        <Section title="현재 구독">
          <View style={[s.subCard, { borderColor: (PLAN_COLOR[currentTier] ?? themeColor) + "50" }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={[s.planDot, { backgroundColor: PLAN_COLOR[currentTier] ?? themeColor }]} />
              <View style={{ flex: 1 }}>
                <Text style={s.planName}>{status?.plan_name ?? "무료 이용"}</Text>
                <Text style={s.planMeta}>
                  {status?.price_per_month ? `₩${status.price_per_month.toLocaleString()}/월` : "무료"}
                  {"  ·  "}최대 {billingInfo?.member_limit ?? status?.member_limit ?? 5}명
                </Text>
                {PLAN_SKU[currentTier] && (
                  <Text style={s.skuLabel}>SKU: {PLAN_SKU[currentTier]}</Text>
                )}
              </View>
              <View style={[s.statusBadge, status?.status === "active" ? s.badgeGreen : s.badgeGray]}>
                <Text style={[s.badgeText, status?.status === "active" ? { color: "#1F8F86" } : { color: "#6F6B68" }]}>
                  {status?.status === "active" ? "활성" : status?.status ?? "미구독"}
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
            {status?.next_billing_at && (
              <View style={s.infoRow}>
                <Text style={s.metaLabel}>다음 결제일</Text>
                <Text style={s.metaValue}>{status.next_billing_at}</Text>
              </View>
            )}
          </View>
        </Section>

        {/* ── 저장공간 현황 ── */}
        <Section title="저장공간">
          <View style={{ gap: 8 }}>
            <View style={s.infoRow}>
              <Text style={s.metaLabel}>사용량</Text>
              <Text style={[s.metaValue, { color: storageColor }]}>
                {(billingInfo?.storage_used_gb ?? 0).toFixed(2)}GB / {(billingInfo?.storage_quota_gb ?? 0.1).toFixed(1)}GB
              </Text>
            </View>
            {/* 저장공간 프로그레스 바 */}
            <View style={s.storageBar}>
              <View style={[s.storageBarFill, {
                width: `${Math.min(storagePct, 100)}%` as any,
                backgroundColor: storageColor,
              }]} />
            </View>
            {storagePct >= 100 && (
              <View style={[s.storageBanner, { backgroundColor: "#FEF2F2", borderColor: "#DC2626" }]}>
                <Feather name="x-circle" size={14} color="#DC2626" />
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
                <Feather name="alert-triangle" size={14} color="#D97706" />
                <Text style={[s.storageBannerTitle, { color: "#D97706", flex: 1 }]}>
                  곧 업로드가 차단됩니다. 저장공간을 정리하거나 업그레이드해주세요. ({storagePct}%)
                </Text>
              </View>
            )}
            {storagePct >= 80 && storagePct < 90 && (
              <View style={[s.storageBanner, { backgroundColor: "#FFFBEB", borderColor: "#FDE68A" }]}>
                <Feather name="alert-circle" size={14} color="#F59E0B" />
                <Text style={[s.storageBannerTitle, { color: "#92400E", flex: 1 }]}>
                  저장공간이 거의 가득 찼습니다. ({storagePct}%)
                </Text>
              </View>
            )}
          </View>
        </Section>

        {/* ── 결제 카드 ── */}
        <Section title="결제 카드">
          {card ? (
            <View style={s.cardBox}>
              <Feather name="credit-card" size={20} color={themeColor} />
              <View style={{ flex: 1 }}>
                <Text style={s.cardBrand}>{card.card_brand}</Text>
                <Text style={s.cardNum}>**** **** **** {card.card_last4}</Text>
                {card.card_nickname && <Text style={s.cardNick}>{card.card_nickname}</Text>}
              </View>
              <Pressable onPress={() => setShowCardForm(true)}>
                <Text style={{ color: themeColor, fontWeight: "500", fontSize: 13 }}>변경</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => setShowCardForm(true)} style={[s.addCardBtn, { borderColor: themeColor }]}>
              <Feather name="plus-circle" size={16} color={themeColor} />
              <Text style={[s.addCardText, { color: themeColor }]}>카드 등록</Text>
            </Pressable>
          )}

          {showCardForm && (
            <View style={s.cardForm}>
              <TextInput style={s.input} placeholder="카드번호 (16자리)" value={cardNum}
                onChangeText={setCardNum} keyboardType="number-pad" maxLength={16} />
              <TextInput style={s.input} placeholder="유효기간 MM/YY" value={expiry}
                onChangeText={setExpiry} maxLength={5} />
              <TextInput style={s.input} placeholder="카드 별명 (선택)" value={nickname}
                onChangeText={setNickname} />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable style={[s.formBtn, { flex: 1, borderWidth: 1, borderColor: "#E9E2DD" }]}
                  onPress={() => setShowCardForm(false)}>
                  <Text style={{ fontWeight: "500", color: "#6F6B68" }}>취소</Text>
                </Pressable>
                <Pressable style={[s.formBtn, { flex: 1, backgroundColor: themeColor }]}
                  onPress={registerCard} disabled={cardSaving}>
                  <Text style={{ fontWeight: "600", color: "#fff" }}>{cardSaving ? "등록 중..." : "등록"}</Text>
                </Pressable>
              </View>
              <Text style={s.cardNote}>
                * 개발 환경에서는 임의 카드번호로 테스트 가능합니다.{"\n"}
                실제 앱스토어/구글플레이 인앱결제 전환 전 임시 카드 입력 화면입니다.
              </Text>
            </View>
          )}
        </Section>

        {/* ── 구독 플랜 ── */}
        <Section title={currentTier === "max" ? "엔터프라이즈 업그레이드" : "구독 플랜"}>
          <View style={{ gap: 10 }}>
            {visiblePlans.map(p => {
              const isCurrent    = p.tier === currentTier;
              const pc           = PLAN_COLOR[p.tier] ?? themeColor;
              const isEnterprise = p.tier.startsWith("enterprise_");
              const currentPrice = plans.find(pl => pl.tier === currentTier)?.price_per_month ?? 0;
              const isUpgrade    = p.price_per_month > currentPrice;
              const isDowngrade  = p.price_per_month < currentPrice && currentPrice > 0;
              const isNewSub     = currentPrice === 0 && p.price_per_month > 0;
              const showDiscount = isNewSub && !(billingInfo?.first_payment_used);
              const discountedPrice = showDiscount ? Math.round(p.price_per_month * 0.5) : null;
              const storageTxt   = p.display_storage
                ? p.display_storage
                : p.storage_gb >= 1 ? `${p.storage_gb}GB` : `${Math.round(p.storage_gb * 1024)}MB`;
              const skuLabel = p.plan_id ?? PLAN_SKU[p.tier] ?? "";
              return (
                <View key={p.tier} style={[s.planCard, isCurrent && { borderColor: pc, borderWidth: 2 }, isEnterprise && s.enterpriseCard]}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Text style={[s.planCardName, { color: pc }]}>{p.name}</Text>
                      {isCurrent && <View style={[s.currentTag, { backgroundColor: pc }]}><Text style={s.currentTagText}>현재</Text></View>}
                      {isEnterprise && !isCurrent && <View style={[s.currentTag, { backgroundColor: "#B45309" }]}><Text style={s.currentTagText}>엔터프라이즈</Text></View>}
                      {showDiscount && <View style={[s.currentTag, { backgroundColor: "#DC2626" }]}><Text style={s.currentTagText}>첫 달 50% 할인</Text></View>}
                      {skuLabel !== "" && <Text style={s.skuBadge}>{skuLabel}</Text>}
                    </View>
                    {showDiscount && discountedPrice != null ? (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={[s.planCardPrice, { textDecorationLine: "line-through", color: "#9A948F", fontSize: 13 }]}>
                          ₩{p.price_per_month.toLocaleString()}/월
                        </Text>
                        <Text style={[s.planCardPrice, { color: "#DC2626" }]}>
                          ₩{discountedPrice.toLocaleString()}/월
                        </Text>
                      </View>
                    ) : (
                      <Text style={s.planCardPrice}>
                        {p.price_per_month === 0 ? "무료" : `₩${p.price_per_month.toLocaleString()}/월`}
                      </Text>
                    )}
                    <Text style={s.planCardMeta}>최대 {p.member_limit.toLocaleString()}명 · {storageTxt}</Text>
                  </View>
                  {!isCurrent && p.price_per_month > 0 && (
                    <Pressable
                      onPress={() => {
                        if (!card) { showConfirm("카드 필요", "결제 카드를 먼저 등록해주세요.", () => {}); return; }
                        const msg = isDowngrade
                          ? `₩${p.price_per_month.toLocaleString()}/월\n다운그레이드는 현재 결제 주기 종료 후 적용됩니다.`
                          : showDiscount && discountedPrice != null
                            ? `첫 달 50% 할인\n정가 ₩${p.price_per_month.toLocaleString()} → ₩${discountedPrice.toLocaleString()} 즉시 결제\n(다음 달부터 ₩${p.price_per_month.toLocaleString()}/월)`
                            : `₩${p.price_per_month.toLocaleString()}/월\n즉시 결제됩니다.`;
                        showConfirm(`${p.name}으로 변경`, msg, () => subscribe(p.tier));
                      }}
                      disabled={!!subscribing}
                      style={[s.subscribeBtn, { backgroundColor: isDowngrade ? "#6B7280" : pc }]}
                    >
                      {subscribing === p.tier
                        ? <ActivityIndicator size="small" color="#fff" />
                        : <Text style={s.subscribeBtnText}>{isDowngrade ? "다운그레이드" : "업그레이드"}</Text>
                      }
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>
          {currentTier === "max" && (
            <Text style={s.enterpriseNote}>
              * 1,000명 이상은 엔터프라이즈 플랜으로만 업그레이드 가능합니다.{"\n"}
              추가 인원 구매는 지원하지 않습니다.
            </Text>
          )}
        </Section>

        {/* ── 결제 내역 ── */}
        <Section title={`결제 내역 (최근 ${history.length}건)`}>
          {history.length === 0
            ? <Text style={s.empty}>결제 내역이 없습니다.</Text>
            : history.map(h => (
              <View key={h.id} style={s.histRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.histDesc}>{h.description ?? h.type ?? "결제"}</Text>
                  <Text style={s.histDate}>{h.paid_at ? h.paid_at.slice(0, 10) : "-"}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={s.histAmount}>₩{Number(h.amount).toLocaleString()}</Text>
                  <Text style={[s.histStatus, { color: h.status === "success" ? "#2E9B6F" : "#D96C6C" }]}>
                    {h.status === "success" ? "성공" : "실패"}
                  </Text>
                </View>
              </View>
            ))
          }
        </Section>
      </ScrollView>

      <ConfirmModal
        visible={confirmVisible}
        title={confirmTitle}
        message={confirmMessage}
        confirmText="확인"
        cancelText="취소"
        onConfirm={() => { setConfirmVisible(false); confirmAction?.(); }}
        onCancel={() => setConfirmVisible(false)}
      />
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: "#F6F3F1" },
  section:          { backgroundColor: "#fff", borderRadius: 12, padding: 16, gap: 12 },
  sectionTitle:     { fontSize: 12, fontWeight: "700", color: "#6F6B68", letterSpacing: 0.5, textTransform: "uppercase" },
  failBanner:       { borderRadius: 12, borderWidth: 1.5, padding: 14, gap: 12 },
  failBannerActive: { backgroundColor: "#FFF1BF", borderColor: "#F59E0B" },
  failBannerDeleted:{ backgroundColor: "#F1F0EF", borderColor: "#9B9591" },
  failTitle:        { fontSize: 13, fontWeight: "700", color: "#DC2626", marginBottom: 2 },
  failDesc:         { fontSize: 12, color: "#4A4540", lineHeight: 17 },
  retryBtn:         { backgroundColor: "#DC2626", paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  retryBtnTxt:      { color: "#fff", fontSize: 14, fontWeight: "700" },
  // 저장공간
  storageBar:       { height: 8, backgroundColor: "#E9E2DD", borderRadius: 4, overflow: "hidden" },
  storageBarFill:   { height: 8, borderRadius: 4 },
  storageBanner:    { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, padding: 10 },
  storageBannerTitle:{ fontSize: 12, fontWeight: "600" },
  storageBannerDesc: { fontSize: 11, color: "#6F6B68", marginTop: 2 },
  storageActionBtn: { borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  storageActionTxt: { fontSize: 12, fontWeight: "700" },
  // 현재 구독
  subCard:          { borderWidth: 1.5, borderRadius: 12, padding: 14, gap: 10 },
  planDot:          { width: 10, height: 10, borderRadius: 5 },
  planName:         { fontSize: 16, fontWeight: "700", color: "#1F1F1F" },
  planMeta:         { fontSize: 12, color: "#6F6B68", marginTop: 2 },
  skuLabel:         { fontSize: 10, color: "#9A948F", marginTop: 2 },
  statusBadge:      { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeGreen:       { backgroundColor: "#DDF2EF" },
  badgeGray:        { backgroundColor: "#F6F3F1" },
  badgeText:        { fontSize: 11, fontWeight: "600" },
  infoRow:          { flexDirection: "row", justifyContent: "space-between" },
  metaLabel:        { fontSize: 13, color: "#6F6B68" },
  metaValue:        { fontSize: 13, color: "#1F1F1F", fontWeight: "600" },
  // 카드
  cardBox:          { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: "#E9E2DD", borderRadius: 12, padding: 14 },
  cardBrand:        { fontSize: 12, color: "#6F6B68" },
  cardNum:          { fontSize: 15, fontWeight: "600", color: "#1F1F1F" },
  cardNick:         { fontSize: 12, color: "#9A948F" },
  addCardBtn:       { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1.5, borderStyle: "dashed", borderRadius: 10, height: 48 },
  addCardText:      { fontWeight: "600", fontSize: 14 },
  cardForm:         { gap: 10, paddingTop: 4 },
  input:            { height: 44, borderWidth: 1.5, borderColor: "#E9E2DD", borderRadius: 10, paddingHorizontal: 12, fontSize: 14, color: "#1F1F1F" },
  formBtn:          { height: 44, borderRadius: 10, justifyContent: "center", alignItems: "center" },
  cardNote:         { fontSize: 11, color: "#9A948F", lineHeight: 16 },
  // 플랜
  planCard:         { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#E9E2DD", borderRadius: 12, padding: 14, gap: 10 },
  enterpriseCard:   { backgroundColor: "#FFFBEB" },
  planCardName:     { fontSize: 14, fontWeight: "700" },
  planCardPrice:    { fontSize: 15, fontWeight: "700", color: "#1F1F1F", marginTop: 2 },
  planCardMeta:     { fontSize: 12, color: "#6F6B68" },
  currentTag:       { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  currentTagText:   { color: "#fff", fontSize: 10, fontWeight: "600" },
  skuBadge:         { fontSize: 10, color: "#9A948F", borderWidth: 1, borderColor: "#E9E2DD", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  subscribeBtn:     { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, minWidth: 60, alignItems: "center" },
  subscribeBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  enterpriseNote:   { fontSize: 11, color: "#9A948F", lineHeight: 16 },
  // 내역
  histRow:          { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#F6F3F1" },
  histDesc:         { fontSize: 13, fontWeight: "500", color: "#1F1F1F" },
  histDate:         { fontSize: 11, color: "#9A948F", marginTop: 2 },
  histAmount:       { fontSize: 14, fontWeight: "700", color: "#1F1F1F" },
  histStatus:       { fontSize: 11, fontWeight: "500", marginTop: 2 },
  empty:            { textAlign: "center", color: "#9A948F", padding: 20 },
});
