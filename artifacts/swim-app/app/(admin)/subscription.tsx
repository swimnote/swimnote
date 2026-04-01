/**
 * (admin)/subscription.tsx — RevenueCat 구독 관리
 *
 * Solo 티어 / Center 티어 인앱 결제
 * - useSubscription 훅으로 현재 구독 상태 확인
 * - 오퍼링에서 실시간 가격 표시 (하드코딩 없음)
 * - 구매 / 복원 지원
 */
import { Check, Crown, RefreshCw, ShieldCheck, Zap } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useState } from "react";
import {
  ActivityIndicator, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useSubscription } from "@/lib/revenuecat";

const C = Colors.light;

const SOLO_FEATURES = [
  "무제한 수업일지 작성",
  "수업 사진 첨부",
  "학부모 앱 연동",
  "출결 관리",
  "공지/쪽지 발송",
  "학생 30명까지 (Solo 제한)",
  "영상 첨부 ❌",
];

const CENTER_FEATURES = [
  "Solo 모든 기능 포함",
  "학생 수 무제한",
  "수업 영상 첨부 ✅",
  "여러 선생님 계정",
  "관리자(sub_admin) 권한",
  "데이터 무제한 저장",
  "우선 지원",
];

function FeatureRow({ text, included = true }: { text: string; included?: boolean }) {
  const isNeg = text.includes("❌");
  return (
    <View style={f.featureRow}>
      <LucideIcon name={isNeg ? "x" : "check"} size={15} color={isNeg ? "#9CA3AF" : "#10B981"} />
      <Text style={[f.featureText, isNeg && { color: "#9CA3AF" }]}>{text.replace("❌", "").replace("✅", "").trim()}</Text>
    </View>
  );
}

export default function SubscriptionScreen() {
  const insets = useSafeAreaInsets();
  const {
    isSubscribed, isSoloTier, isCenterTier,
    soloOffering, centerOffering,
    isPurchasing, isRestoring, isLoading,
    purchase, restore,
  } = useSubscription();

  const [confirmPlan, setConfirmPlan] = useState<"solo" | "center" | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const soloPkg   = soloOffering?.availablePackages?.[0];
  const centerPkg = centerOffering?.availablePackages?.[0];

  const soloPrice   = soloPkg?.product?.priceString   ?? "$9.99";
  const centerPrice = centerPkg?.product?.priceString ?? "$29.99";

  async function handlePurchase(plan: "solo" | "center") {
    setErrorMsg("");
    const pkg = plan === "solo" ? soloPkg : centerPkg;
    if (!pkg) { setErrorMsg("구독 상품을 불러오는 중입니다. 잠시 후 다시 시도해주세요."); return; }
    try {
      await purchase(pkg);
      setConfirmPlan(null);
    } catch (e: any) {
      if (e?.userCancelled) return;
      setErrorMsg(e?.message ?? "구매 중 오류가 발생했습니다.");
    }
  }

  async function handleRestore() {
    setErrorMsg("");
    try {
      await restore();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "복원 중 오류가 발생했습니다.");
    }
  }

  const PT = insets.top + (Platform.OS === "web" ? 68 : 0);

  if (isLoading) {
    return (
      <View style={[s.root, { backgroundColor: C.background }]}>
        <SubScreenHeader title="구독 관리" />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={C.tint} size="large" />
        </View>
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <SubScreenHeader title="구독 관리" />

      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* 현재 상태 배너 */}
        <View style={[s.statusBanner, { backgroundColor: isSubscribed ? "#ECFDF5" : "#F8FAFC" }]}>
          <LucideIcon name={isSubscribed ? "shield-check" : "shield"} size={22} color={isSubscribed ? "#10B981" : C.textMuted} />
          <View style={{ flex: 1 }}>
            <Text style={[s.statusTitle, { color: isSubscribed ? "#065F46" : C.text }]}>
              {isCenterTier ? "Center 티어 이용 중" : isSoloTier ? "Solo 티어 이용 중" : "무료 체험 중"}
            </Text>
            <Text style={[s.statusSub, { color: C.textSecondary }]}>
              {isSubscribed ? "구독이 활성화되어 있습니다" : "구독을 시작하면 더 많은 기능을 이용할 수 있습니다"}
            </Text>
          </View>
        </View>

        {errorMsg ? (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{errorMsg}</Text>
          </View>
        ) : null}

        {/* Solo 플랜 카드 */}
        <View style={[s.planCard, isSoloTier && s.activePlanCard, { backgroundColor: C.card }]}>
          <View style={s.planHeader}>
            <View style={[s.planIconBox, { backgroundColor: "#EDE9FE" }]}>
              <Zap size={22} color="#7C3AED" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.planName, { color: C.text }]}>Solo</Text>
              <Text style={[s.planSubtitle, { color: C.textSecondary }]}>개인 선생님 / 소규모</Text>
            </View>
            {isSoloTier && (
              <View style={s.activeBadge}>
                <Text style={s.activeBadgeText}>현재 플랜</Text>
              </View>
            )}
            <Text style={[s.planPrice, { color: "#7C3AED" }]}>{soloPrice}<Text style={s.planPriceSub}>/월</Text></Text>
          </View>
          <View style={s.divider} />
          {SOLO_FEATURES.map((f, i) => <FeatureRow key={i} text={f} />)}
          {!isSoloTier && !isCenterTier && (
            <Pressable
              style={({ pressed }) => [s.planBtn, { backgroundColor: "#7C3AED", opacity: pressed || isPurchasing ? 0.8 : 1 }]}
              onPress={() => setConfirmPlan("solo")}
              disabled={isPurchasing}
            >
              <Text style={s.planBtnText}>Solo 시작하기</Text>
            </Pressable>
          )}
        </View>

        {/* Center 플랜 카드 */}
        <View style={[s.planCard, isCenterTier && s.activePlanCard, { backgroundColor: C.card, borderColor: isCenterTier ? "#F59E0B" : C.border }]}>
          <View style={[s.recommendedBadge, { backgroundColor: "#F59E0B" }]}>
            <Crown size={12} color="#fff" />
            <Text style={s.recommendedText}>추천</Text>
          </View>
          <View style={s.planHeader}>
            <View style={[s.planIconBox, { backgroundColor: "#FEF3C7" }]}>
              <Crown size={22} color="#F59E0B" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.planName, { color: C.text }]}>Center</Text>
              <Text style={[s.planSubtitle, { color: C.textSecondary }]}>수영장 전체 운영</Text>
            </View>
            {isCenterTier && (
              <View style={[s.activeBadge, { backgroundColor: "#FEF3C7" }]}>
                <Text style={[s.activeBadgeText, { color: "#92400E" }]}>현재 플랜</Text>
              </View>
            )}
            <Text style={[s.planPrice, { color: "#F59E0B" }]}>{centerPrice}<Text style={s.planPriceSub}>/월</Text></Text>
          </View>
          <View style={s.divider} />
          {CENTER_FEATURES.map((f, i) => <FeatureRow key={i} text={f} />)}
          {!isCenterTier && (
            <Pressable
              style={({ pressed }) => [s.planBtn, { backgroundColor: "#F59E0B", opacity: pressed || isPurchasing ? 0.8 : 1 }]}
              onPress={() => setConfirmPlan("center")}
              disabled={isPurchasing}
            >
              <Text style={s.planBtnText}>{isSoloTier ? "Center로 업그레이드" : "Center 시작하기"}</Text>
            </Pressable>
          )}
        </View>

        {/* 구매 복원 */}
        <Pressable
          style={({ pressed }) => [s.restoreBtn, { opacity: pressed || isRestoring ? 0.7 : 1 }]}
          onPress={handleRestore}
          disabled={isRestoring}
        >
          {isRestoring ? (
            <ActivityIndicator color={C.tint} size="small" />
          ) : (
            <>
              <RefreshCw size={14} color={C.tint} />
              <Text style={[s.restoreText, { color: C.tint }]}>구매 복원</Text>
            </>
          )}
        </Pressable>

        <Text style={[s.disclaimer, { color: C.textMuted }]}>
          구독은 자동으로 갱신됩니다. 구독 관리 및 해지는 앱스토어/구글플레이에서 가능합니다.
        </Text>
      </ScrollView>

      {/* 구매 확인 모달 */}
      <Modal
        visible={confirmPlan !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmPlan(null)}
      >
        <View style={s.modalOverlay}>
          <View style={[s.modalBox, { backgroundColor: C.background }]}>
            <Text style={[s.modalTitle, { color: C.text }]}>
              {confirmPlan === "solo" ? "Solo 구독 시작" : "Center 구독 시작"}
            </Text>
            <Text style={[s.modalBody, { color: C.textSecondary }]}>
              {confirmPlan === "solo"
                ? `Solo 플랜을 ${soloPrice}/월로 구독하시겠습니까?`
                : `Center 플랜을 ${centerPrice}/월로 구독하시겠습니까?`}
            </Text>
            <View style={s.modalBtns}>
              <Pressable
                style={({ pressed }) => [s.modalCancelBtn, { borderColor: C.border, opacity: pressed ? 0.7 : 1 }]}
                onPress={() => setConfirmPlan(null)}
              >
                <Text style={{ color: C.text, fontFamily: "Pretendard-Regular", fontSize: 15 }}>취소</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [s.modalConfirmBtn, { backgroundColor: confirmPlan === "center" ? "#F59E0B" : "#7C3AED", opacity: pressed || isPurchasing ? 0.8 : 1 }]}
                onPress={() => confirmPlan && handlePurchase(confirmPlan)}
                disabled={isPurchasing}
              >
                {isPurchasing ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={{ color: "#fff", fontFamily: "Pretendard-Regular", fontSize: 15 }}>구독하기</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const f = StyleSheet.create({
  featureRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3 },
  featureText: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#374151", flex: 1 },
});

const s = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 16, gap: 16 },
  statusBanner: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: 16 },
  statusTitle: { fontSize: 16, fontFamily: "Pretendard-Regular" },
  statusSub: { fontSize: 13, fontFamily: "Pretendard-Regular", marginTop: 2 },
  errorBox: { backgroundColor: "#FEF2F2", padding: 12, borderRadius: 12 },
  errorText: { color: "#DC2626", fontSize: 13, fontFamily: "Pretendard-Regular" },
  planCard: {
    borderRadius: 20, padding: 20, gap: 6,
    borderWidth: 1.5, borderColor: "#E2E8F0",
    shadowColor: "#000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 3,
    overflow: "visible",
  },
  activePlanCard: { borderColor: "#10B981", borderWidth: 2 },
  planHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
  planIconBox: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  planName: { fontSize: 20, fontFamily: "Pretendard-Regular" },
  planSubtitle: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  activeBadge: { backgroundColor: "#D1FAE5", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  activeBadgeText: { fontSize: 12, color: "#065F46", fontFamily: "Pretendard-Regular" },
  planPrice: { fontSize: 22, fontFamily: "Pretendard-Regular" },
  planPriceSub: { fontSize: 13, color: "#9CA3AF" },
  divider: { height: 1, backgroundColor: "#E2E8F0", marginVertical: 10 },
  planBtn: { marginTop: 14, paddingVertical: 14, borderRadius: 14, alignItems: "center" },
  planBtnText: { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" },
  recommendedBadge: { position: "absolute", top: -12, right: 20, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 10, zIndex: 10 },
  recommendedText: { color: "#fff", fontSize: 12, fontFamily: "Pretendard-Regular" },
  restoreBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 14 },
  restoreText: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  disclaimer: { fontSize: 12, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 18, paddingHorizontal: 8 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  modalBox: { width: 320, borderRadius: 20, padding: 24, gap: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.15, shadowRadius: 20, elevation: 12 },
  modalTitle: { fontSize: 18, fontFamily: "Pretendard-Regular", textAlign: "center" },
  modalBody: { fontSize: 14, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 22 },
  modalBtns: { flexDirection: "row", gap: 12, marginTop: 4 },
  modalCancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1.5, alignItems: "center" },
  modalConfirmBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: "center" },
});
