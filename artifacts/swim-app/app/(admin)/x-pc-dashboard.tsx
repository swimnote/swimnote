/**
 * (admin)/x-pc-dashboard.tsx — PC 대시보드 활성화 화면
 *
 * X모드 PIN 설정 + PC 접속 방법 안내.
 * PIN 설정/변경은 기존 web-pin-settings로 push.
 * API/DB: 기존 /pools/web-pin-status 재사용.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LucideIcon } from "@/components/common/LucideIcon";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useMode } from "@/context/ModeContext";
import Colors from "@/constants/colors";

const C = Colors.light;
const NAVY      = "#23415C";
const MINT      = "#355C7D";
const MINT_LIGHT = "#E9EEF3";
const GREEN      = "#16A34A";
const GREEN_LIGHT = "#F0FDF4";
const AMBER_LIGHT = "#FFFBEB";
const AMBER      = "#D97706";

type DashboardReadiness =
  | "available"       // X ACTIVE + PIN 설정됨
  | "pin_required"    // X ACTIVE + PIN 미설정
  | "x_required";     // X모드 아님 (normal/x_pending)

export default function XPcDashboardScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { mode } = useMode();
  const { backTo } = useLocalSearchParams<{ backTo?: string }>();

  const [pinSet, setPinSet] = useState<boolean | null>(null);
  const [loadingPin, setLoadingPin] = useState(true);

  const loadPinStatus = useCallback(async () => {
    if (!token) return;
    setLoadingPin(true);
    try {
      const res = await apiRequest(token, "/pools/web-pin-status");
      if (res.ok) {
        const data = await res.json();
        setPinSet(!!data.isSet);
      }
    } catch {
      // 조용히
    } finally {
      setLoadingPin(false);
    }
  }, [token]);

  useEffect(() => { loadPinStatus(); }, [loadPinStatus]);

  const handleBack = () => {
    if (backTo) {
      router.replace(("/(admin)/" + backTo) as any);
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(admin)/x-mode-hub" as any);
    }
  };

  const goToPinSettings = () => {
    router.push("/(admin)/web-pin-settings?backTo=x-pc-dashboard" as any);
  };

  // 대시보드 사용 가능 여부 판단
  const readiness: DashboardReadiness = (() => {
    if (mode !== "x" && mode !== "x_trial") return "x_required";
    if (pinSet === null) return "pin_required"; // 로딩 중
    return pinSet ? "available" : "pin_required";
  })();

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      {/* 헤더 */}
      <View style={[s.header, { paddingTop: insets.top + 14 }]}>
        <Pressable hitSlop={12} onPress={handleBack} style={s.backBtn}>
          <LucideIcon name="arrow-left" size={20} color={NAVY} />
        </Pressable>
        <Text style={s.headerTitle}>PC 대시보드 활성화</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* 소개 카드 */}
        <View style={s.introCard}>
          <View style={s.introIconWrap}>
            <LucideIcon name="monitor" size={24} color={NAVY} />
          </View>
          <Text style={s.introTitle}>PC 대시보드</Text>
          <Text style={s.introDesc}>
            X모드 PIN을 설정하면 PC에서{"\n"}
            SWIMNOTE 관리자 기능을 사용할 수 있습니다.{"\n"}
            앱 로그인 비밀번호와 별개로 사용되는 PC 전용 추가 보안 PIN입니다.
          </Text>
        </View>

        {/* ① PC 대시보드 PIN */}
        <View style={s.sectionCard}>
          <View style={s.sectionHeaderRow}>
            <View style={s.sectionIconWrap}>
              <LucideIcon name="lock" size={16} color={NAVY} />
            </View>
            <Text style={s.sectionTitle}>PC 대시보드 PIN</Text>
          </View>

          {/* PIN 상태 배지 */}
          {loadingPin ? (
            <ActivityIndicator color={MINT} style={{ marginVertical: 12 }} />
          ) : (
            <View style={[
              s.pinStatusBadge,
              { backgroundColor: pinSet ? GREEN_LIGHT : AMBER_LIGHT },
            ]}>
              <LucideIcon
                name={pinSet ? "shield-check" : "alert-circle"}
                size={14}
                color={pinSet ? GREEN : AMBER}
              />
              <Text style={[s.pinStatusText, { color: pinSet ? GREEN : AMBER }]}>
                {pinSet ? "PC 대시보드 PIN 설정됨" : "PC 대시보드 PIN 미설정"}
              </Text>
            </View>
          )}

          {/* PIN 설정/변경 버튼 */}
          <Pressable
            style={({ pressed }) => [s.pinBtn, pressed && { opacity: 0.75 }]}
            onPress={goToPinSettings}
          >
            <LucideIcon name="key" size={15} color="#fff" />
            <Text style={s.pinBtnText}>
              {pinSet ? "PIN 변경" : "PIN 설정하기"}
            </Text>
          </Pressable>
        </View>

        {/* ② PC 접속 방법 */}
        <View style={s.sectionCard}>
          <View style={s.sectionHeaderRow}>
            <View style={s.sectionIconWrap}>
              <LucideIcon name="globe" size={16} color={NAVY} />
            </View>
            <Text style={s.sectionTitle}>PC 접속 방법</Text>
          </View>

          <View style={s.stepList}>
            {[
              { num: "1", text: "SWIMNOTE 홈페이지(swimnote.kr) 접속" },
              { num: "2", text: "PC모드 로그인 선택" },
              { num: "3", text: "관리자 이메일 / 비밀번호 입력" },
              { num: "4", text: "PC 대시보드 PIN 입력" },
              { num: "5", text: "PC Dashboard 이용" },
            ].map(step => (
              <View key={step.num} style={s.stepRow}>
                <View style={s.stepNum}>
                  <Text style={s.stepNumText}>{step.num}</Text>
                </View>
                <Text style={s.stepText}>{step.text}</Text>
              </View>
            ))}
          </View>

          <View style={s.comingSoonBox}>
            <LucideIcon name="clock" size={13} color={C.textTertiary} />
            <Text style={s.comingSoonText}>
              PC모드 로그인 버튼은 홈페이지 업데이트 후 추가됩니다.{"\n"}
              현재는 swimnote.kr에서 직접 로그인하여 이용할 수 있습니다.
            </Text>
          </View>
        </View>

        {/* ③ PC Dashboard 상태 */}
        <View style={s.sectionCard}>
          <View style={s.sectionHeaderRow}>
            <View style={s.sectionIconWrap}>
              <LucideIcon name="activity" size={16} color={NAVY} />
            </View>
            <Text style={s.sectionTitle}>PC Dashboard 상태</Text>
          </View>

          <ReadinessRow readiness={readiness} />
        </View>

      </ScrollView>
    </View>
  );
}

function ReadinessRow({ readiness }: { readiness: DashboardReadiness }) {
  if (readiness === "available") {
    return (
      <View style={[s.readinessBadge, { backgroundColor: GREEN_LIGHT }]}>
        <LucideIcon name="check-circle" size={16} color={GREEN} />
        <Text style={[s.readinessText, { color: GREEN }]}>사용 가능</Text>
      </View>
    );
  }
  if (readiness === "pin_required") {
    return (
      <View style={[s.readinessBadge, { backgroundColor: AMBER_LIGHT }]}>
        <LucideIcon name="alert-circle" size={16} color={AMBER} />
        <View style={{ flex: 1 }}>
          <Text style={[s.readinessText, { color: AMBER }]}>PIN 설정 필요</Text>
          <Text style={s.readinessHint}>PC 대시보드 PIN을 설정하면 이용할 수 있습니다.</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={[s.readinessBadge, { backgroundColor: C.backgroundSoft }]}>
      <LucideIcon name="lock" size={16} color={C.textSecondary} />
      <View style={{ flex: 1 }}>
        <Text style={[s.readinessText, { color: C.textSecondary }]}>X모드 활성화 필요</Text>
        <Text style={s.readinessHint}>X모드 구독 후 커리큘럼을 등록하면 PC Dashboard를 이용할 수 있습니다.</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 12,
    backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.border,
  },
  backBtn: { width: 32, alignItems: "flex-start" },
  headerTitle: { fontSize: 16, fontFamily: "Pretendard-SemiBold", color: NAVY },
  scroll: { padding: 20, gap: 16 },

  introCard: {
    backgroundColor: MINT_LIGHT, borderRadius: 16, padding: 20,
    alignItems: "center", gap: 8, borderWidth: 1, borderColor: "#C6D5E3",
  },
  introIconWrap: {
    width: 52, height: 52, borderRadius: 16,
    backgroundColor: "#D8E6F3", alignItems: "center", justifyContent: "center",
    marginBottom: 4,
  },
  introTitle: { fontSize: 18, fontFamily: "Pretendard-Bold", color: NAVY },
  introDesc: { fontSize: 13, fontFamily: "Pretendard-Regular", color: MINT, lineHeight: 20, textAlign: "center" },

  sectionCard: {
    backgroundColor: "#fff", borderRadius: 16, padding: 18,
    borderWidth: 1, borderColor: C.border, gap: 12,
  },
  sectionHeaderRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  sectionIconWrap: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: MINT_LIGHT, alignItems: "center", justifyContent: "center",
  },
  sectionTitle: { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: NAVY },

  pinStatusBadge: {
    flexDirection: "row", alignItems: "center", gap: 8,
    alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20,
  },
  pinStatusText: { fontSize: 13, fontFamily: "Pretendard-SemiBold" },

  pinBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: NAVY, borderRadius: 12, paddingVertical: 14,
  },
  pinBtnText: { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#fff" },

  stepList: { gap: 10 },
  stepRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  stepNum: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: MINT_LIGHT, alignItems: "center", justifyContent: "center",
    flexShrink: 0, marginTop: 1,
  },
  stepNumText: { fontSize: 11, fontFamily: "Pretendard-Bold", color: NAVY },
  stepText: { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textPrimary, lineHeight: 22 },

  comingSoonBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: C.backgroundSoft, borderRadius: 10, padding: 12,
  },
  comingSoonText: {
    flex: 1, fontSize: 11, fontFamily: "Pretendard-Regular",
    color: C.textTertiary, lineHeight: 17,
  },

  readinessBadge: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    borderRadius: 12, padding: 14,
  },
  readinessText: { fontSize: 14, fontFamily: "Pretendard-SemiBold" },
  readinessHint: {
    fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary,
    marginTop: 3, lineHeight: 16,
  },
});
