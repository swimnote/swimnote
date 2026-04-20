/**
 * (admin)/refund-policy.tsx — 환불 정책 확인 및 동의 화면 (관리자)
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet,
  Text, View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckCircle, FileText, ChevronLeft, AlertCircle, AlertTriangle } from "lucide-react-native";
import { apiRequest, useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";

const C = Colors.light;
const PURPLE = "#7C3AED";

const CORE_POLICIES = [
  {
    label: "구독 취소 = 일할 계산 환불 + 자동 회원 탈퇴",
    desc: "구독 취소 시 잔여 기간을 일할 계산하여 환불하며, 즉시 자동 탈퇴 처리됩니다. 모든 데이터가 삭제되며 복구 불가합니다.",
    color: "#7C2D12",
    bg: "#FFF7ED",
    border: "#FED7AA",
  },
  {
    label: "무료 플랜 전환 없음 — 환불 후 탈퇴만 가능",
    desc: "유료 구독 취소 시 무료 플랜으로 전환되지 않습니다. 취소는 곧 탈퇴이며, 재이용 시 새로 가입·구독해야 합니다.",
    color: "#1E3A5F",
    bg: "#EFF6FF",
    border: "#BFDBFE",
  },
  {
    label: "다운그레이드 = 다음 결제일 적용 + 회원 수 조건 충족 필수",
    desc: "현재 등록 회원 수가 새 플랜 한도 이하일 때만 다운그레이드 신청이 가능합니다. 다운그레이드는 다음 결제일부터 적용됩니다.",
    color: "#14532D",
    bg: "#F0FDF4",
    border: "#BBF7D0",
  },
];

const POLICY_SECTIONS = [
  {
    title: "1. 구독 취소 및 일할 계산 환불",
    items: [
      "구독을 취소하면 취소 요청일 기준으로 잔여 기간을 일할 계산하여 환불됩니다.",
      "예: 30일 이용권 구독 후 10일 사용 → 남은 20일분 환불",
      "환불금은 App Store(Apple) 또는 Google Play(구글) 원 결제 수단으로 처리됩니다.",
      "스토어 정책에 따라 환불 처리 기간 및 절차가 달라질 수 있습니다.",
    ],
  },
  {
    title: "2. 구독 취소 시 자동 회원 탈퇴",
    items: [
      "구독 취소는 서비스 이용 종료를 의미하며, 즉시 자동 회원 탈퇴 처리됩니다.",
      "탈퇴 즉시 수영장 운영 데이터(등록 회원, 수업일지, 사진, 영상 등)가 모두 삭제됩니다.",
      "삭제된 데이터는 어떠한 경우에도 복구가 불가능합니다.",
      "서비스를 다시 이용하려면 신규 가입 및 구독이 필요합니다.",
    ],
  },
  {
    title: "3. 무료 플랜 전환 없음",
    items: [
      "SwimNote는 유료 구독 취소 시 무료 플랜으로 자동 전환되지 않습니다.",
      "구독 취소는 곧 탈퇴 처리를 의미하며, 무료로 계속 이용할 수 없습니다.",
      "서비스를 계속 유지하려면 구독을 반드시 유지해야 합니다.",
    ],
  },
  {
    title: "4. 플랜 다운그레이드 조건 및 규칙",
    items: [
      "다운그레이드 신청은 현재 등록 회원 수가 새 플랜의 최대 회원 한도 이하일 때만 가능합니다.",
      "예: 100명 플랜에 70명 등록 중 → 50명 플랜 신청 불가 (초과 인원 20명 정리 후 신청 가능)",
      "예: 100명 플랜에 45명 등록 중 → 50명 플랜 신청 가능 (한도 이하)",
      "한도를 초과한 상태에서 다운그레이드를 강제 진행할 경우, 초과된 회원의 서비스 이용이 제한될 수 있습니다.",
      "다운그레이드는 현재 구독 기간이 끝나는 다음 결제일부터 적용됩니다.",
      "다운그레이드 신청 후에도 현재 결제 기간이 끝날 때까지 기존 플랜 기능을 정상 이용할 수 있습니다.",
      "다운그레이드로 인한 잔여 기간의 차액은 환불되지 않습니다.",
    ],
  },
  {
    title: "5. 플랜 업그레이드",
    items: [
      "하위 플랜 → 상위 플랜 업그레이드는 즉시 적용됩니다.",
      "업그레이드 시 남은 기간에 대한 차액이 즉시 결제됩니다.",
    ],
  },
  {
    title: "6. App Store / Google Play 환불 정책",
    items: [
      "App Store(Apple) 결제는 Apple의 환불 정책이 우선 적용됩니다.",
      "Google Play(구글) 결제는 Google의 환불 정책이 우선 적용됩니다.",
      "스토어 환불 정책과 SwimNote 정책이 상충할 경우 스토어 정책이 우선합니다.",
    ],
  },
  {
    title: "7. 환불 문의",
    items: [
      "환불 및 구독 관련 문의는 앱 내 고객센터 또는 아래 이메일로 연락해 주세요.",
      "이메일: support@swimnote.app",
    ],
  },
];

interface PolicyData {
  version:        string;
  agreed:         boolean;
  agreed_at:      string | null;
  agreed_version: string | null;
  needs_reagree:  boolean;
}

export default function RefundPolicyScreen() {
  const { token } = useAuth() as any;
  const insets = useSafeAreaInsets();
  const { backTo } = useLocalSearchParams<{ backTo?: string }>();

  const [loading,  setLoading]  = useState(true);
  const [agreeing, setAgreeing] = useState(false);
  const [data, setData] = useState<PolicyData>({
    version: "v1.0", agreed: false,
    agreed_at: null, agreed_version: null, needs_reagree: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await apiRequest(token, "/admin/refund-policy");
      const json = await res.json();
      if (json.success) {
        setData({
          version:        json.version        ?? "v1.0",
          agreed:         json.agreed         ?? false,
          agreed_at:      json.agreed_at      ?? null,
          agreed_version: json.agreed_version ?? null,
          needs_reagree:  json.needs_reagree  ?? true,
        });
      }
    } catch (e) {
      console.warn("[refund-policy] load error:", e);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function doAgree() {
    setAgreeing(true);
    try {
      const res  = await apiRequest(token, "/admin/refund-policy/agree", { method: "POST" });
      const json = await res.json();
      if (json.success) {
        setData(prev => ({
          ...prev,
          agreed:         true,
          agreed_at:      json.agreed_at,
          agreed_version: json.agreed_version ?? prev.version,
          needs_reagree:  false,
        }));
        Alert.alert("동의 완료", "환불 정책에 동의하셨습니다.\n구독 및 결제 기능을 이용할 수 있습니다.");
      } else {
        Alert.alert("오류", json.error ?? "동의 처리에 실패했습니다. 잠시 후 다시 시도해주세요.");
      }
    } catch (e) {
      console.error("[refund-policy] agree error:", e);
      Alert.alert("오류", "서버에 연결할 수 없습니다. 네트워크를 확인해주세요.");
    } finally {
      setAgreeing(false);
    }
  }

  function handleAgreePress() {
    Alert.alert(
      "환불 정책 동의",
      [
        `[${data.version}] 환불 정책의 주요 내용을 확인하셨습니까?`,
        "",
        "• 구독 취소 시 일할 계산 환불 + 자동 탈퇴 처리",
        "• 무료 플랜 전환 없음 (재이용 시 재가입 필요)",
        "• 다운그레이드는 회원 수 조건 충족 후 다음 결제일 적용",
        "",
        "위 내용에 동의하시겠습니까?",
      ].join("\n"),
      [
        { text: "취소", style: "cancel" },
        { text: data.agreed ? "재동의합니다" : "동의합니다", onPress: doAgree },
      ],
    );
  }

  function handleBack() {
    if (backTo) router.push((`/(admin)/${backTo}`) as any);
    else router.back();
  }

  const agreedDate = data.agreed_at
    ? new Date(data.agreed_at).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })
    : null;

  const headerBadge = data.agreed && !data.needs_reagree ? "done"
    : data.agreed && data.needs_reagree ? "reagree"
    : "unread";

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* 헤더 */}
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={handleBack}>
          <ChevronLeft size={22} color={C.text} />
        </Pressable>
        <Text style={s.headerTitle}>환불 정책</Text>
        {headerBadge === "done" && (
          <View style={s.agreedBadge}>
            <CheckCircle size={13} color="#16A34A" />
            <Text style={s.agreedBadgeTxt}>동의 완료</Text>
          </View>
        )}
        {headerBadge === "reagree" && (
          <View style={s.reagreeBadge}>
            <AlertCircle size={13} color="#D97706" />
            <Text style={s.reagreeBadgeTxt}>재동의 필요</Text>
          </View>
        )}
        {headerBadge === "unread" && (
          <View style={s.unreadBadge}>
            <Text style={s.unreadBadgeTxt}>미확인</Text>
          </View>
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={PURPLE} style={{ marginTop: 60 }} />
      ) : (
        <>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={s.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* 버전 카드 */}
            <View style={s.infoCard}>
              <View style={s.infoRow}>
                <FileText size={15} color={PURPLE} />
                <Text style={s.infoTitle}>SwimNote 환불 정책 (관리자용)</Text>
              </View>
              <Text style={s.infoVersion}>버전: {data.version} · 시행일: 2025년 1월 1일</Text>
              {agreedDate && !data.needs_reagree && (
                <Text style={s.infoAgreed}>✓ 동의일: {agreedDate}</Text>
              )}
            </View>

            {/* 재동의 알림 */}
            {data.needs_reagree && data.agreed && (
              <View style={s.reagreeBox}>
                <AlertCircle size={18} color="#D97706" />
                <View style={{ flex: 1 }}>
                  <Text style={s.reagreeTitle}>정책이 변경되어 재동의가 필요합니다.</Text>
                  <Text style={s.reagreeDesc}>현재 버전: {data.version}</Text>
                </View>
              </View>
            )}

            {/* 3대 핵심 정책 */}
            <View style={s.coreSection}>
              <View style={s.coreSectionHeader}>
                <AlertTriangle size={16} color="#9A3412" />
                <Text style={s.coreSectionTitle}>3대 핵심 정책 — 반드시 확인하세요</Text>
              </View>
              {CORE_POLICIES.map((p, i) => (
                <View key={i} style={[s.corePolicyCard, { backgroundColor: p.bg, borderColor: p.border }]}>
                  <Text style={[s.corePolicyLabel, { color: p.color }]}>{p.label}</Text>
                  <Text style={[s.corePolicyDesc, { color: p.color }]}>{p.desc}</Text>
                </View>
              ))}
            </View>

            {/* 섹션별 상세 정책 */}
            {POLICY_SECTIONS.map((section, si) => (
              <View key={si} style={s.sectionBox}>
                <Text style={s.sectionTitle}>{section.title}</Text>
                {section.items.map((item, ii) => (
                  <View key={ii} style={s.policyLine}>
                    <View style={s.bullet} />
                    <Text style={s.policyText}>{item}</Text>
                  </View>
                ))}
              </View>
            ))}

            {/* 동의 완료 상태 */}
            {data.agreed && !data.needs_reagree && (
              <View style={s.alreadyAgreed}>
                <CheckCircle size={20} color="#16A34A" />
                <Text style={s.alreadyAgreedTxt}>
                  동의 완료 (버전 {data.agreed_version}){"\n"}
                  {agreedDate && `동의일: ${agreedDate}`}
                </Text>
              </View>
            )}

            <View style={{ height: 120 }} />
          </ScrollView>

          {/* 동의 버튼 */}
          {data.needs_reagree && (
            <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
              <Text style={s.footerHint}>
                {data.agreed
                  ? "정책이 변경되었습니다. 재동의 후 결제 기능을 이용할 수 있습니다."
                  : "위 내용을 모두 읽은 후 동의 버튼을 눌러주세요"}
              </Text>
              <Pressable
                style={[s.agreeBtn, agreeing && { opacity: 0.6 }]}
                onPress={handleAgreePress}
                disabled={agreeing}
              >
                {agreeing
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.agreeBtnTxt}>
                      {data.agreed ? "재동의합니다" : "환불 정책에 동의합니다"}
                    </Text>
                }
              </Pressable>
            </View>
          )}
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:             { flex: 1, backgroundColor: C.background },
  header:           { flexDirection: "row", alignItems: "center", gap: 8,
                      paddingHorizontal: 16, paddingVertical: 12,
                      borderBottomWidth: 1, borderBottomColor: "#E5E7EB",
                      backgroundColor: C.card },
  backBtn:          { padding: 4 },
  headerTitle:      { flex: 1, fontSize: 17, fontFamily: "Pretendard-Regular", color: C.text },
  agreedBadge:      { flexDirection: "row", alignItems: "center", gap: 4,
                      backgroundColor: "#F0FDF4", borderRadius: 10,
                      paddingHorizontal: 8, paddingVertical: 4 },
  agreedBadgeTxt:   { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#16A34A" },
  reagreeBadge:     { flexDirection: "row", alignItems: "center", gap: 4,
                      backgroundColor: "#FFFBEB", borderRadius: 10,
                      paddingHorizontal: 8, paddingVertical: 4 },
  reagreeBadgeTxt:  { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#D97706" },
  unreadBadge:      { backgroundColor: "#FEF2F2", borderRadius: 10,
                      paddingHorizontal: 8, paddingVertical: 4 },
  unreadBadgeTxt:   { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#D96C6C" },

  scrollContent:    { padding: 16, gap: 12 },

  infoCard:         { backgroundColor: "#F5F3FF", borderRadius: 12, padding: 14,
                      borderWidth: 1, borderColor: "#DDD6FE" },
  infoRow:          { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  infoTitle:        { fontSize: 15, fontFamily: "Pretendard-Regular", color: PURPLE },
  infoVersion:      { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  infoAgreed:       { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#16A34A", marginTop: 2 },

  reagreeBox:       { flexDirection: "row", alignItems: "flex-start", gap: 10,
                      backgroundColor: "#FFFBEB", borderRadius: 12, padding: 14,
                      borderWidth: 1, borderColor: "#FDE68A" },
  reagreeTitle:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#92400E" },
  reagreeDesc:      { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#D97706", marginTop: 2 },

  coreSection:      { backgroundColor: "#FAFAFA", borderRadius: 12, padding: 14,
                      borderWidth: 1, borderColor: "#E5E7EB", gap: 10 },
  coreSectionHeader:{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 },
  coreSectionTitle: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#9A3412" },
  corePolicyCard:   { borderRadius: 10, padding: 12, borderWidth: 1, gap: 4 },
  corePolicyLabel:  { fontSize: 13, fontFamily: "Pretendard-Regular" },
  corePolicyDesc:   { fontSize: 12, fontFamily: "Pretendard-Regular", lineHeight: 18 },

  sectionBox:       { backgroundColor: C.card, borderRadius: 12, padding: 14,
                      borderWidth: 1, borderColor: "#E5E7EB", gap: 6 },
  sectionTitle:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: PURPLE, marginBottom: 4 },
  policyLine:       { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  bullet:           { width: 5, height: 5, borderRadius: 3, backgroundColor: PURPLE,
                      marginTop: 7, flexShrink: 0 },
  policyText:       { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular",
                      color: C.text, lineHeight: 20 },

  alreadyAgreed:    { flexDirection: "row", alignItems: "center", gap: 10,
                      backgroundColor: "#F0FDF4", borderRadius: 12, padding: 14,
                      borderWidth: 1, borderColor: "#BBF7D0" },
  alreadyAgreedTxt: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#16A34A", lineHeight: 20 },

  footer:           { paddingHorizontal: 16, paddingTop: 12, gap: 8,
                      backgroundColor: C.card,
                      borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  footerHint:       { fontSize: 11, fontFamily: "Pretendard-Regular",
                      color: "#64748B", textAlign: "center" },
  agreeBtn:         { backgroundColor: PURPLE, borderRadius: 12, paddingVertical: 14,
                      alignItems: "center" },
  agreeBtnTxt:      { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" },
});
