/**
 * (auth)/purchase-policy-agreement.tsx
 *
 * 신규 pool_admin 가입 직후 표시되는 구매·구독·환불 정책 동의 화면.
 * 정책 전문 스크롤 → [필수] 체크박스 → 동의하고 시작하기.
 * 서버 POST /admin/purchase-policy/consent 성공 후
 * AsyncStorage 게이트 플래그 제거 → onboarding 이동.
 *
 * 절대 원칙:
 * - 체크박스 기본 선택 금지
 * - 서버 저장 성공 전 이동 금지
 * - 자동 동의 금지
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { LucideIcon } from "@/components/common/LucideIcon";
import { apiRequest, useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";

const C = Colors.light;
const ACCENT = "#002F5F";  // Navy — SWIMNOTE brand

export const PURCHASE_POLICY_GATE_KEY = "@swimnote:purchase_policy_gate";

// ── 정책 전문 단락 구분 ──────────────────────────────────────────────────────
const POLICY_SECTIONS: { heading?: string; lines: string[] }[] = [
  {
    lines: [
      "SWIMNOTE 구매·구독·환불 정책",
    ],
  },
  {
    heading: "제1조 목적",
    lines: [
      "본 정책은 SWIMNOTE 및 SWIMNOTE X 서비스에서 제공하는 유료 구독, 무료체험, 앱 내 구매, 플랜 변경, 자동갱신, 구독 해지, 결제 실패 및 환불에 관한 사항을 정합니다.",
      "본 정책과 관계 법령 또는 Apple App Store 및 Google Play의 적용 정책이 충돌하는 경우 관계 법령 및 해당 결제 플랫폼의 강행 규정과 정책이 우선 적용될 수 있습니다.",
    ],
  },
  {
    heading: "제2조 서비스 및 상품",
    lines: [
      "SWIMNOTE는 수영장 운영을 위한 회원관리, 수업관리, 출결, 일지, 사진·영상, 커리큘럼, AI 기능 등 디지털 서비스를 제공합니다.",
      "현재 주요 월간 구독 상품은 다음과 같습니다.",
      "SWIMNOTE — 월 9,900원",
      "SWIMNOTE X300 — 월 129,000원 / 최대 300명 / 약 300GB 저장공간",
      "SWIMNOTE X500 — 월 199,000원 / 최대 500명 / 약 500GB 저장공간",
      "SWIMNOTE X1000 — 월 359,000원 / 최대 1,000명 / 1TB 저장공간",
      "최종 결제금액, 세금, 통화 등은 Apple App Store 또는 Google Play 결제화면에 표시되는 금액을 기준으로 합니다.",
    ],
  },
  {
    heading: "제3조 자동갱신",
    lines: [
      "SWIMNOTE 및 SWIMNOTE X 유료 구독은 월 단위 자동갱신 구독입니다.",
      "사용자가 자동갱신을 해지하지 않는 경우 결제 플랫폼의 정책에 따라 다음 이용기간의 요금이 자동으로 결제될 수 있습니다.",
      "다음 결제일, 결제수단, 실제 청구금액 및 자동갱신 상태는 Apple App Store 또는 Google Play의 구독관리 정보를 기준으로 합니다.",
    ],
  },
  {
    heading: "제4조 X 3일 무료체험",
    lines: [
      "SWIMNOTE X의 3일 무료체험은 SWIMNOTE가 자체 제공하는 1회성 무료체험입니다.",
      "· 시작 시점부터 정확히 72시간",
      "· 수영장당 1회",
      "· 결제정보 등록 불필요",
      "· 체험 시작에 따른 자동결제 없음",
      "· 체험 종료 후 X 유료구독으로 자동 전환되지 않음",
      "· 계속 이용하려면 사용자가 직접 X 상품을 구매해야 함",
      "무료체험 적용 후 앱의 상태를 정확히 갱신하기 위하여 앱 재시작 안내가 표시될 수 있습니다.",
    ],
  },
  {
    heading: "제5조 유료 구독 적용",
    lines: [
      "App Store 또는 Google Play에서 결제가 정상적으로 완료되고 SWIMNOTE가 유효한 구독상태를 확인한 경우 해당 구독 상품의 이용권한이 적용됩니다.",
      "X 상품 적용 후 앱 상태 갱신을 위해 앱 재시작을 요청할 수 있습니다.",
      "앱 재시작은 추가 결제를 의미하지 않습니다.",
    ],
  },
  {
    heading: "제6조~7조 플랜 업그레이드·다운그레이드",
    lines: [
      "상위 플랜 변경은 결제 플랫폼 정책에 따라 즉시 적용될 수 있습니다. 실제 추가 결제금액, 적용일 및 잔여기간 처리는 구매 시 결제 플랫폼에서 표시되는 내용을 기준으로 합니다.",
      "하위 플랜으로의 변경은 현재 결제기간 종료 후 다음 갱신일부터 적용될 수 있습니다. 플랜 한도 초과만을 이유로 기존 회원이나 운영 데이터를 임의로 삭제하지 않습니다.",
    ],
  },
  {
    heading: "제8조 구독 해지",
    lines: [
      "사용자는 Apple App Store 또는 Google Play의 구독관리 기능에서 자동갱신을 해지할 수 있습니다.",
      "구독 해지는 다음 자동결제를 중단하는 절차이며 이미 결제된 현재 이용기간을 즉시 종료하는 절차와는 다릅니다.",
      "정상적으로 해지한 경우에도 현재 결제기간 종료일까지 해당 구독을 이용할 수 있습니다.",
      "앱을 삭제하는 것만으로 구독이 해지되지 않습니다.",
    ],
  },
  {
    heading: "제9조~10조 결제 실패·만료",
    lines: [
      "카드 승인 실패 또는 결제수단 문제로 자동갱신 결제가 실패할 수 있습니다. Apple 또는 Google에서 유예기간을 제공하며 유효한 구독권한이 유지되는 동안에는 서비스를 계속 이용할 수 있습니다.",
      "결제 실패 발생만을 이유로 회원 및 운영 데이터를 즉시 삭제하지 않습니다.",
      "유효한 이용기간이 모두 종료되고 구독권한이 확인되지 않는 경우 서비스 이용이 일시중지될 수 있습니다. 기존 운영 데이터는 결제 만료만을 이유로 즉시 삭제되지 않습니다.",
    ],
  },
  {
    heading: "제11조 환불",
    lines: [
      "App Store 또는 Google Play를 통해 결제한 구매의 결제 취소 및 환불은 각 결제 플랫폼의 절차와 정책 및 관계 법령에 따라 처리됩니다.",
      "환불 승인 여부는 실제 결제상태, 이용내역, 관계 법령 및 결제 플랫폼의 정책에 따라 달라질 수 있습니다.",
      "본 정책은 관계 법령에서 보장하는 사용자의 환불, 청약철회 또는 기타 권리를 제한하지 않습니다.",
    ],
  },
  {
    heading: "제12조~13조 청약철회·해지와 환불의 차이",
    lines: [
      "관계 법령에서 청약철회를 보장하는 경우 사용자는 해당 권리를 행사할 수 있습니다. 다만 디지털콘텐츠 제공이 시작되는 등 관계 법령에서 정한 사유가 있는 경우 청약철회가 제한될 수 있습니다.",
      "구독 해지는 향후 자동갱신을 중단하는 절차입니다. 환불은 이미 이루어진 결제의 금액 반환을 요청하는 절차입니다.",
    ],
  },
  {
    heading: "제14조~20조 가격·기능·AI·데이터·정책 변경",
    lines: [
      "SWIMNOTE는 합리적 사유로 구독가격을 변경할 수 있습니다. 기존 구독자에게 인상된 가격을 적용하는 경우 관계 법령 및 결제 플랫폼에서 요구하는 사전 고지 및 동의 절차를 따릅니다.",
      "구독 해지 또는 결제 만료만으로 회원, 반, 출결, 일지 및 기타 운영 데이터를 즉시 삭제하지 않습니다.",
      "본 정책은 관계 법령, Apple App Store 또는 Google Play 정책, 서비스 또는 상품 변경에 따라 개정될 수 있습니다. 사용자에게 중대한 영향을 미치는 변경은 시행 전에 앱 내 공지 등의 방법으로 안내합니다.",
    ],
  },
];

export default function PurchasePolicyAgreementScreen() {
  const { token } = useAuth() as any;

  const [checked,  setChecked]  = useState(false);
  const [agreeing, setAgreeing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [version,  setVersion]  = useState<string>("1.0");

  // 현재 active 정책 버전 로드 (표시용)
  useEffect(() => {
    if (!token) return;
    apiRequest(token, "/admin/purchase-policy/consent")
      .then(r => r.json()).then(d => {
        if (d.current_version) setVersion(d.current_version);
      }).catch(() => {});
  }, [token]);

  const doAgree = useCallback(async () => {
    if (!checked || agreeing) return;
    setAgreeing(true);
    setErrorMsg(null);
    try {
      const appVersion = Constants.expoConfig?.version ?? "unknown";
      const platform   = Platform.OS;
      const res  = await apiRequest(token, "/admin/purchase-policy/consent", {
        method: "POST",
        body: JSON.stringify({ source: "signup", platform, app_version: appVersion }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(data?.error ?? "처리에 실패했습니다. 잠시 후 다시 시도해주세요.");
        return;
      }
      // 성공 → 게이트 플래그 제거 → onboarding
      await AsyncStorage.removeItem(PURCHASE_POLICY_GATE_KEY).catch(() => {});
      router.replace("/(admin)/onboarding" as any);
    } catch {
      setErrorMsg("서버 연결에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setAgreeing(false);
    }
  }, [checked, agreeing, token]);

  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      {/* 헤더 */}
      <View style={s.hero}>
        <View style={s.heroIcon}>
          <LucideIcon name="shield-check" size={32} color={ACCENT} />
        </View>
        <Text style={s.heroTitle}>구매·구독·환불 정책</Text>
        <Text style={s.heroSub}>
          {"SWIMNOTE의 무료체험, 유료 구독, 자동갱신,\n플랜 변경 및 환불에 관한 내용을 확인해주세요."}
        </Text>
        <View style={s.versionBadge}>
          <Text style={s.versionTxt}>v{version}</Text>
        </View>
      </View>

      {/* 오류 메시지 */}
      {errorMsg && (
        <View style={s.errorBox}>
          <Text style={s.errorTxt}>{errorMsg}</Text>
        </View>
      )}

      {/* 정책 전문 */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.policyBox}>
          {POLICY_SECTIONS.map((sec, si) => (
            <View key={si} style={si > 0 ? s.section : undefined}>
              {sec.heading && (
                <Text style={s.sectionHeading}>{sec.heading}</Text>
              )}
              {sec.lines.map((line, li) => (
                <Text key={li} style={[s.bodyLine, si === 0 && li === 0 && s.policyTitle]}>
                  {line}
                </Text>
              ))}
            </View>
          ))}
        </View>
        <View style={{ height: 24 }} />
      </ScrollView>

      {/* 하단 고정 */}
      <View style={s.footer}>
        {/* [필수] 체크박스 */}
        <Pressable
          style={s.checkRow}
          onPress={() => setChecked(v => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
        >
          <View style={[s.checkbox, checked && s.checkboxChecked]}>
            {checked && <LucideIcon name="check" size={14} color="#fff" />}
          </View>
          <Text style={s.checkLabel}>
            <Text style={s.required}>[필수] </Text>
            구매·구독·환불 정책을 확인하고 동의합니다.
          </Text>
        </Pressable>

        {/* 동의하고 시작하기 */}
        <Pressable
          style={[s.agreeBtn, (!checked || agreeing) && s.agreeBtnDisabled]}
          onPress={doAgree}
          disabled={!checked || agreeing}
          accessibilityLabel="동의하고 시작하기"
        >
          {agreeing
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.agreeTxt}>동의하고 시작하기</Text>
          }
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:         { flex: 1, backgroundColor: "#F8FAFC" },

  hero:         { alignItems: "center", paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16,
                  backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.border },
  heroIcon:     { width: 64, height: 64, borderRadius: 18, backgroundColor: "#EFF6FF",
                  alignItems: "center", justifyContent: "center", marginBottom: 10 },
  heroTitle:    { fontSize: 20, fontFamily: "Pretendard-SemiBold", color: ACCENT, marginBottom: 6 },
  heroSub:      { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary,
                  textAlign: "center", lineHeight: 20, marginBottom: 8 },
  versionBadge: { backgroundColor: "#DBEAFE", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3 },
  versionTxt:   { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#1D4ED8" },

  errorBox:     { backgroundColor: "#FEF2F2", paddingHorizontal: 16, paddingVertical: 10,
                  borderBottomWidth: 1, borderBottomColor: "#FECACA" },
  errorTxt:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#DC2626", textAlign: "center" },

  scroll:       { padding: 16 },

  policyBox:    { backgroundColor: "#fff", borderRadius: 14, padding: 16,
                  borderWidth: 1, borderColor: C.border },
  policyTitle:  { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: ACCENT,
                  marginBottom: 4, textAlign: "center" },
  section:      { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#F1F5F9" },
  sectionHeading: { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: ACCENT, marginBottom: 6 },
  bodyLine:     { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textPrimary,
                  lineHeight: 20, marginBottom: 4 },

  footer:       { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 28, gap: 12,
                  backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: C.border },

  checkRow:     { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  checkbox:     { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: C.border,
                  alignItems: "center", justifyContent: "center", marginTop: 1, flexShrink: 0 },
  checkboxChecked: { backgroundColor: ACCENT, borderColor: ACCENT },
  checkLabel:   { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textPrimary, lineHeight: 20 },
  required:     { color: "#DC2626" },

  agreeBtn:     { backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  agreeBtnDisabled: { opacity: 0.35 },
  agreeTxt:     { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: "#fff" },
});
