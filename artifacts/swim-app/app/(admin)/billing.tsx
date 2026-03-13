/**
 * (admin)/billing.tsx — 관리자: 결제 관리 MVP
 * 현재 구독 상태 확인, 카드 등록, 플랜 변경
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState, useCallback } from "react";
import {
  ActivityIndicator, Alert, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";

interface Plan { tier: string; name: string; price_per_month: number; member_limit: number; storage_gb: number; }
interface CardInfo { id: string; card_last4: string; card_brand: string; card_nickname?: string | null; }
interface SubInfo { tier: string; status: string; next_billing_at?: string | null; plan_name?: string; price_per_month?: number; member_limit?: number; }
interface HistoryItem { id: string; amount: number; status: string; description?: string | null; paid_at?: string | null; type?: string; }

const PLAN_COLOR: Record<string, string> = {
  free: "#6B7280", paid_100: "#3B82F6", paid_300: "#7C3AED",
  paid_500: "#EC4899", paid_1000: "#F97316", paid_enterprise: "#D97706",
};

export default function BillingScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();

  const [status, setStatus]       = useState<SubInfo | null>(null);
  const [card, setCard]           = useState<CardInfo | null>(null);
  const [plans, setPlans]         = useState<Plan[]>([]);
  const [history, setHistory]     = useState<HistoryItem[]>([]);
  const [memberCount, setMemberCount] = useState(0);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // 카드 등록 폼
  const [showCardForm, setShowCardForm] = useState(false);
  const [cardNum, setCardNum]     = useState("");
  const [expiry, setExpiry]       = useState("");
  const [nickname, setNickname]   = useState("");
  const [cardSaving, setCardSaving] = useState(false);

  // 구독 변경 중
  const [subscribing, setSubscribing] = useState<string | null>(null);

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
      setMemberCount(sd.member_count ?? 0);
      setHistory(Array.isArray(hd) ? hd : []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function registerCard() {
    const digits = cardNum.replace(/\s/g, "");
    if (digits.length < 15) { Alert.alert("오류", "카드번호를 정확히 입력해주세요."); return; }
    if (!expiry) { Alert.alert("오류", "유효기간을 입력해주세요 (MM/YY)"); return; }
    setCardSaving(true);
    try {
      const r = await apiRequest(token, "/billing/cards", {
        method: "POST",
        body: JSON.stringify({ card_number: digits, expiry, card_nickname: nickname }),
      });
      const d = await r.json();
      if (!r.ok) { Alert.alert("오류", d.error ?? "카드 등록 실패"); return; }
      Alert.alert("완료", "카드가 등록되었습니다.");
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
      if (!r.ok) { Alert.alert("오류", d.error ?? "구독 실패"); return; }
      const msg = d.prorate_amount
        ? `일할 결제: ₩${d.prorate_amount.toLocaleString()}\n다음 결제일: ${d.next_billing_at}`
        : `구독이 변경되었습니다.\n다음 결제일: ${d.next_billing_at}`;
      Alert.alert("구독 완료", msg);
      load();
    } finally { setSubscribing(null); }
  }

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={themeColor} />;

  const currentTier = status?.tier ?? "free";

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="arrow-left" size={22} color="#111827" />
        </Pressable>
        <Text style={s.title}>결제 관리</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={themeColor} />}
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
      >

        {/* ── 현재 구독 ── */}
        <Section title="현재 구독">
          <View style={[s.subCard, { borderColor: PLAN_COLOR[currentTier] + "50" }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={[s.planDot, { backgroundColor: PLAN_COLOR[currentTier] }]} />
              <View style={{ flex: 1 }}>
                <Text style={s.planName}>{status?.plan_name ?? "무료 이용"}</Text>
                <Text style={s.planMeta}>
                  {status?.price_per_month ? `₩${status.price_per_month.toLocaleString()}/월` : "무료"}
                  {"  ·  "}최대 {status?.member_limit ?? 50}명
                </Text>
              </View>
              <View style={[s.statusBadge, status?.status === "active" ? s.badgeGreen : s.badgeGray]}>
                <Text style={[s.badgeText, status?.status === "active" ? { color: "#059669" } : { color: "#6B7280" }]}>
                  {status?.status === "active" ? "활성" : status?.status ?? "미구독"}
                </Text>
              </View>
            </View>
            <View style={s.row}>
              <Text style={s.metaLabel}>현재 회원 수</Text>
              <Text style={s.metaValue}>{memberCount}명</Text>
            </View>
            {status?.next_billing_at && (
              <View style={s.row}>
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
                <Text style={{ color: themeColor, fontFamily: "Inter_500Medium", fontSize: 13 }}>변경</Text>
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
                <Pressable style={[s.formBtn, { flex: 1, borderWidth: 1, borderColor: "#E5E7EB" }]}
                  onPress={() => setShowCardForm(false)}>
                  <Text style={{ fontFamily: "Inter_500Medium", color: "#6B7280" }}>취소</Text>
                </Pressable>
                <Pressable style={[s.formBtn, { flex: 1, backgroundColor: themeColor }]}
                  onPress={registerCard} disabled={cardSaving}>
                  <Text style={{ fontFamily: "Inter_600SemiBold", color: "#fff" }}>{cardSaving ? "등록 중..." : "등록"}</Text>
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
            {plans.filter(p => p.tier !== "paid_enterprise").map(p => {
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
                        if (!card) { Alert.alert("카드 필요", "결제 카드를 먼저 등록해주세요."); return; }
                        Alert.alert(
                          `${p.name}으로 변경`,
                          `₩${p.price_per_month.toLocaleString()}/월\n업그레이드 시 일할 금액이 즉시 결제됩니다.`,
                          [
                            { text: "취소", style: "cancel" },
                            { text: "변경", onPress: () => subscribe(p.tier) },
                          ]
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
            <View style={[s.planCard, { borderStyle: "dashed", borderColor: "#D97706" }]}>
              <View style={{ flex: 1 }}>
                <Text style={[s.planCardName, { color: "#D97706" }]}>엔터프라이즈</Text>
                <Text style={s.planCardPrice}>별도 협의</Text>
                <Text style={s.planCardMeta}>무제한 · 500GB+</Text>
              </View>
              <Text style={{ fontSize: 12, color: "#D97706", fontFamily: "Inter_500Medium" }}>문의</Text>
            </View>
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
                  <Text style={[s.histStatus, { color: h.status === "success" ? "#10B981" : "#EF4444" }]}>
                    {h.status === "success" ? "성공" : "실패"}
                  </Text>
                </View>
              </View>
            ))
          }
        </Section>
      </ScrollView>
    </SafeAreaView>
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
  safe:            { flex: 1, backgroundColor: "#F8FAFF" },
  header:          { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  title:           { fontSize: 17, fontFamily: "Inter_700Bold", color: "#111827" },
  section:         { backgroundColor: "#fff", borderRadius: 12, padding: 16, gap: 12 },
  sectionTitle:    { fontSize: 12, fontFamily: "Inter_700Bold", color: "#6B7280", letterSpacing: 0.5, textTransform: "uppercase" },
  // 현재 구독
  subCard:         { borderWidth: 1.5, borderRadius: 12, padding: 14, gap: 10 },
  planDot:         { width: 10, height: 10, borderRadius: 5 },
  planName:        { fontSize: 16, fontFamily: "Inter_700Bold", color: "#111827" },
  planMeta:        { fontSize: 12, color: "#6B7280", fontFamily: "Inter_400Regular", marginTop: 2 },
  statusBadge:     { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeGreen:      { backgroundColor: "#D1FAE5" },
  badgeGray:       { backgroundColor: "#F3F4F6" },
  badgeText:       { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  row:             { flexDirection: "row", justifyContent: "space-between" },
  metaLabel:       { fontSize: 13, color: "#6B7280", fontFamily: "Inter_400Regular" },
  metaValue:       { fontSize: 13, color: "#111827", fontFamily: "Inter_600SemiBold" },
  // 카드
  cardBox:         { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, padding: 14 },
  cardBrand:       { fontSize: 12, color: "#6B7280", fontFamily: "Inter_400Regular" },
  cardNum:         { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#111827" },
  cardNick:        { fontSize: 12, color: "#9CA3AF", fontFamily: "Inter_400Regular" },
  addCardBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1.5, borderStyle: "dashed", borderRadius: 10, height: 48 },
  addCardText:     { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  cardForm:        { gap: 10, paddingTop: 4 },
  input:           { height: 44, borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, paddingHorizontal: 12, fontFamily: "Inter_400Regular", fontSize: 14, color: "#111827" },
  formBtn:         { height: 44, borderRadius: 10, justifyContent: "center", alignItems: "center" },
  cardNote:        { fontSize: 11, color: "#9CA3AF", fontFamily: "Inter_400Regular", lineHeight: 16 },
  // 플랜
  planCard:        { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, padding: 14, gap: 10 },
  planCardName:    { fontSize: 14, fontFamily: "Inter_700Bold" },
  planCardPrice:   { fontSize: 15, fontFamily: "Inter_700Bold", color: "#111827", marginTop: 2 },
  planCardMeta:    { fontSize: 12, color: "#6B7280", fontFamily: "Inter_400Regular" },
  currentTag:      { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  currentTagText:  { color: "#fff", fontSize: 10, fontFamily: "Inter_600SemiBold" },
  subscribeBtn:    { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, minWidth: 50, alignItems: "center" },
  subscribeBtnText:{ color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  // 내역
  histRow:         { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  histDesc:        { fontSize: 13, fontFamily: "Inter_500Medium", color: "#111827" },
  histDate:        { fontSize: 11, color: "#9CA3AF", fontFamily: "Inter_400Regular", marginTop: 2 },
  histAmount:      { fontSize: 14, fontFamily: "Inter_700Bold", color: "#111827" },
  histStatus:      { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2 },
  empty:           { textAlign: "center", color: "#9CA3AF", fontFamily: "Inter_400Regular", padding: 20 },
});
