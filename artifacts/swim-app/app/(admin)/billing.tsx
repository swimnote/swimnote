/**
 * (admin)/billing.tsx — 관리자: 결제 관리
 * 현재 구독 상태 확인, 카드 등록, 플랜 변경, 재결제
 */
import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState, useCallback } from "react";
import {
  ActivityIndicator, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { ConfirmModal } from "@/components/common/ConfirmModal";

interface Plan { tier: string; name: string; price_per_month: number; member_limit: number; storage_gb: number; }
interface CardInfo { id: string; card_last4: string; card_brand: string; card_nickname?: string | null; }
interface SubInfo { tier: string; status: string; next_billing_at?: string | null; plan_name?: string; price_per_month?: number; member_limit?: number; }
interface HistoryItem { id: string; amount: number; status: string; description?: string | null; paid_at?: string | null; type?: string; }
interface BillingStatus {
  is_readonly: boolean;
  upload_blocked: boolean;
  payment_failed_at: string | null;
  subscription_status: string | null;
  days_until_deletion: number | null;
  member_count: number;
  member_limit: number;
}

const PLAN_COLOR: Record<string, string> = {
  free:     "#6F6B68",
  starter:  "#4EA7D8",
  basic:    "#2E9B6F",
  standard: "#1F8F86",
  growth:   "#7C3AED",
  pro:      "#EC4899",
  max:      "#D97706",
};

const PAYMENT_FAILED_STATUSES = new Set(["payment_failed", "pending_deletion", "deleted"]);

export default function BillingScreen() {
  const { token, refreshPool } = useAuth();
  const { themeColor } = useBrand();

  const [status, setStatus]     = useState<SubInfo | null>(null);
  const [card, setCard]         = useState<CardInfo | null>(null);
  const [plans, setPlans]       = useState<Plan[]>([]);
  const [history, setHistory]   = useState<HistoryItem[]>([]);
  const [billingInfo, setBillingInfo] = useState<BillingStatus | null>(null);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [showCardForm, setShowCardForm] = useState(false);
  const [cardNum, setCardNum]   = useState("");
  const [expiry, setExpiry]     = useState("");
  const [nickname, setNickname] = useState("");
  const [cardSaving, setCardSaving] = useState(false);

  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  // ConfirmModal state
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("");
  const [confirmMessage, setConfirmMessage] = useState("");
  const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);

  function showConfirm(title: string, message: string, action: () => void) {
    setConfirmTitle(title);
    setConfirmMessage(message);
    setConfirmAction(() => action);
    setConfirmVisible(true);
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
        is_readonly: sd.is_readonly ?? false,
        upload_blocked: sd.upload_blocked ?? false,
        payment_failed_at: sd.payment_failed_at ?? null,
        subscription_status: sd.subscription_status ?? null,
        days_until_deletion: sd.days_until_deletion ?? null,
        member_count: sd.member_count ?? 0,
        member_limit: sd.member_limit ?? 5,
      });
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function registerCard() {
    const digits = cardNum.replace(/\s/g, "");
    if (digits.length < 15) {
      showConfirm("오류", "카드번호를 정확히 입력해주세요.", () => {});
      return;
    }
    if (!expiry) {
      showConfirm("오류", "유효기간을 입력해주세요 (MM/YY)", () => {});
      return;
    }
    setCardSaving(true);
    try {
      const r = await apiRequest(token, "/billing/cards", {
        method: "POST",
        body: JSON.stringify({ card_number: digits, expiry, card_nickname: nickname }),
      });
      const d = await r.json();
      if (!r.ok) {
        showConfirm("카드 등록 실패", d.error ?? "카드 등록에 실패했습니다.", () => {});
        return;
      }
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
      if (!r.ok) {
        showConfirm("구독 실패", d.error ?? "구독 변경에 실패했습니다.", () => {});
        return;
      }
      await load();
      await refreshPool();
    } finally { setSubscribing(null); }
  }

  async function retryPayment() {
    setRetrying(true);
    try {
      const r = await apiRequest(token, "/billing/retry", { method: "POST" });
      const d = await r.json();
      if (!r.ok) {
        showConfirm("재결제 실패", d.error ?? "재결제에 실패했습니다. 카드 정보를 확인해주세요.", () => {});
        return;
      }
      await load();
      await refreshPool();
      showConfirm("재결제 성공", "서비스가 정상적으로 복구되었습니다.", () => {});
    } finally { setRetrying(false); }
  }

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={themeColor} />;

  const currentTier = status?.tier ?? "free";
  const isPaymentFailed = PAYMENT_FAILED_STATUSES.has(billingInfo?.subscription_status ?? "");
  const daysLeft = billingInfo?.days_until_deletion;

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
          <View style={[s.failBanner, billingInfo?.subscription_status === "deleted" ? s.failBannerDeleted : s.failBannerActive]}>
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
                    : "결제 실패 — 서비스 이용 제한"}
                </Text>
                <Text style={s.failDesc}>
                  {billingInfo?.subscription_status === "deleted"
                    ? "모든 데이터가 영구 삭제되었습니다."
                    : daysLeft != null
                    ? `${daysLeft}일 후 모든 데이터가 영구 삭제됩니다. 지금 재결제하면 복구됩니다.`
                    : "빠른 시일 내에 재결제를 진행해주세요."}
                </Text>
              </View>
            </View>
            {billingInfo?.subscription_status !== "deleted" && (
              <Pressable
                style={[s.retryBtn, retrying && { opacity: 0.6 }]}
                onPress={() => showConfirm(
                  "재결제 진행",
                  `등록된 카드로 재결제를 진행합니다.\n서비스가 즉시 복구됩니다.`,
                  retryPayment
                )}
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
              </View>
              <View style={[s.statusBadge, status?.status === "active" ? s.badgeGreen : s.badgeGray]}>
                <Text style={[s.badgeText, status?.status === "active" ? { color: "#1F8F86" } : { color: "#6F6B68" }]}>
                  {status?.status === "active" ? "활성" : status?.status ?? "미구독"}
                </Text>
              </View>
            </View>
            <View style={s.infoRow}>
              <Text style={s.metaLabel}>현재 회원 수</Text>
              <Text style={s.metaValue}>
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
                실제 PG(토스/포트원) 연동 시 실제 카드 정보를 입력합니다.
              </Text>
            </View>
          )}
        </Section>

        {/* ── 구독 플랜 ── */}
        <Section title="구독 플랜">
          <View style={{ gap: 10 }}>
            {plans.map(p => {
              const isCurrent = p.tier === currentTier;
              const pc = PLAN_COLOR[p.tier] ?? themeColor;
              return (
                <View key={p.tier} style={[s.planCard, isCurrent && { borderColor: pc, borderWidth: 2 }]}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={[s.planCardName, { color: pc }]}>{p.name}</Text>
                      {isCurrent && <View style={[s.currentTag, { backgroundColor: pc }]}><Text style={s.currentTagText}>현재</Text></View>}
                    </View>
                    <Text style={s.planCardPrice}>
                      {p.price_per_month === 0 ? "무료" : `₩${p.price_per_month.toLocaleString()}/월`}
                    </Text>
                    <Text style={s.planCardMeta}>최대 {p.member_limit}명 · {p.storage_gb}GB</Text>
                  </View>
                  {!isCurrent && p.price_per_month > 0 && (
                    <Pressable
                      onPress={() => {
                        if (!card) {
                          showConfirm("카드 필요", "결제 카드를 먼저 등록해주세요.", () => {});
                          return;
                        }
                        showConfirm(
                          `${p.name}으로 변경`,
                          `₩${p.price_per_month.toLocaleString()}/월\n업그레이드 시 일할 금액이 즉시 결제됩니다.`,
                          () => subscribe(p.tier)
                        );
                      }}
                      disabled={!!subscribing}
                      style={[s.subscribeBtn, { backgroundColor: pc }]}
                    >
                      {subscribing === p.tier
                        ? <ActivityIndicator size="small" color="#fff" />
                        : <Text style={s.subscribeBtnText}>변경</Text>
                      }
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>
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
  safe:            { flex: 1, backgroundColor: "#F6F3F1" },
  section:         { backgroundColor: "#fff", borderRadius: 12, padding: 16, gap: 12 },
  sectionTitle:    { fontSize: 12, fontWeight: "700", color: "#6F6B68", letterSpacing: 0.5, textTransform: "uppercase" },
  // 결제 실패 배너
  failBanner:      { borderRadius: 12, borderWidth: 1.5, padding: 14, gap: 12 },
  failBannerActive:{ backgroundColor: "#FFF1BF", borderColor: "#F59E0B" },
  failBannerDeleted:{ backgroundColor: "#F1F0EF", borderColor: "#9B9591" },
  failTitle:       { fontSize: 13, fontWeight: "700", color: "#DC2626", marginBottom: 2 },
  failDesc:        { fontSize: 12, color: "#4A4540", lineHeight: 17 },
  retryBtn:        { backgroundColor: "#DC2626", paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  retryBtnTxt:     { color: "#fff", fontSize: 14, fontWeight: "700" },
  // 현재 구독
  subCard:         { borderWidth: 1.5, borderRadius: 12, padding: 14, gap: 10 },
  planDot:         { width: 10, height: 10, borderRadius: 5 },
  planName:        { fontSize: 16, fontWeight: "700", color: "#1F1F1F" },
  planMeta:        { fontSize: 12, color: "#6F6B68", marginTop: 2 },
  statusBadge:     { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeGreen:      { backgroundColor: "#DDF2EF" },
  badgeGray:       { backgroundColor: "#F6F3F1" },
  badgeText:       { fontSize: 11, fontWeight: "600" },
  infoRow:         { flexDirection: "row", justifyContent: "space-between" },
  metaLabel:       { fontSize: 13, color: "#6F6B68" },
  metaValue:       { fontSize: 13, color: "#1F1F1F", fontWeight: "600" },
  // 카드
  cardBox:         { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: "#E9E2DD", borderRadius: 12, padding: 14 },
  cardBrand:       { fontSize: 12, color: "#6F6B68" },
  cardNum:         { fontSize: 15, fontWeight: "600", color: "#1F1F1F" },
  cardNick:        { fontSize: 12, color: "#9A948F" },
  addCardBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1.5, borderStyle: "dashed", borderRadius: 10, height: 48 },
  addCardText:     { fontWeight: "600", fontSize: 14 },
  cardForm:        { gap: 10, paddingTop: 4 },
  input:           { height: 44, borderWidth: 1.5, borderColor: "#E9E2DD", borderRadius: 10, paddingHorizontal: 12, fontSize: 14, color: "#1F1F1F" },
  formBtn:         { height: 44, borderRadius: 10, justifyContent: "center", alignItems: "center" },
  cardNote:        { fontSize: 11, color: "#9A948F", lineHeight: 16 },
  // 플랜
  planCard:        { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#E9E2DD", borderRadius: 12, padding: 14, gap: 10 },
  planCardName:    { fontSize: 14, fontWeight: "700" },
  planCardPrice:   { fontSize: 15, fontWeight: "700", color: "#1F1F1F", marginTop: 2 },
  planCardMeta:    { fontSize: 12, color: "#6F6B68" },
  currentTag:      { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  currentTagText:  { color: "#fff", fontSize: 10, fontWeight: "600" },
  subscribeBtn:    { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, minWidth: 50, alignItems: "center" },
  subscribeBtnText:{ color: "#fff", fontSize: 13, fontWeight: "600" },
  // 내역
  histRow:         { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#F6F3F1" },
  histDesc:        { fontSize: 13, fontWeight: "500", color: "#1F1F1F" },
  histDate:        { fontSize: 11, color: "#9A948F", marginTop: 2 },
  histAmount:      { fontSize: 14, fontWeight: "700", color: "#1F1F1F" },
  histStatus:      { fontSize: 11, fontWeight: "500", marginTop: 2 },
  empty:           { textAlign: "center", color: "#9A948F", padding: 20 },
});
