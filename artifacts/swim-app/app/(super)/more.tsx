/**
 * (super)/more.tsx — 슈퍼관리자 더보기
 * 9그룹 메뉴 구조:
 * 1) 운영 관리  2) 매출 분석  3) 비용·지출  4) 데이터 관리
 * 5) 고객센터  6) 정책·컴플라이언스  7) 보안·통제
 * 8) 시스템 상태  9) 광고 관리
 */
import { ChevronRight, Shield } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;
const PURPLE = "#7C3AED";

const IC = "#0F172A"; const IB = "#E6FAF8";

const ICON_COLOR_MAP: Record<string, { bg: string; icon: string }> = {
  mint:    { bg: IB, icon: IC },
  orange:  { bg: IB, icon: IC },
  navy:    { bg: IB, icon: IC },
  purple:  { bg: "#E6FAF8", icon: PURPLE },
  violet:  { bg: IB, icon: IC },
  blue:    { bg: IB, icon: IC },
  green:   { bg: IB, icon: IC },
  red:     { bg: IB, icon: IC },
  indigo:  { bg: IB, icon: IC },
  slate:   { bg: IB, icon: IC },
  teal:    { bg: IB, icon: IC },
  rose:    { bg: IB, icon: IC },
};

type MenuEntry = {
  icon: string; label: string; sub: string;
  onPress: () => void; color: keyof typeof ICON_COLOR_MAP; badge?: string;
};

function MenuItem({ icon, label, sub, onPress, color, badge }: MenuEntry) {
  const cfg = ICON_COLOR_MAP[color];
  return (
    <Pressable
      style={({ pressed }) => [s.menuItem, { backgroundColor: C.card, opacity: pressed ? 0.8 : 1 }]}
      onPress={onPress}
    >
      <View style={[s.menuIcon, { backgroundColor: cfg.bg }]}>
        <LucideIcon name={icon as any} size={20} color={cfg.icon} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.menuLabel, { color: C.text }]}>{label}</Text>
        {sub ? <Text style={[s.menuSub, { color: C.textMuted }]}>{sub}</Text> : null}
      </View>
      {badge ? (
        <View style={[s.badge, { backgroundColor: cfg.bg }]}>
          <Text style={[s.badgeTxt, { color: cfg.icon }]}>{badge}</Text>
        </View>
      ) : null}
      <ChevronRight size={18} color={C.textMuted} />
    </Pressable>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <Text style={[s.sectionLabel, { color: C.textMuted }]}>{title}</Text>;
}

interface RiskSummary {
  storage_risk:    number;
  deletion_pending: number;
  sla_overdue:     number;
}

export default function SuperMoreScreen() {
  const insets = useSafeAreaInsets();
  const { adminUser: user, token } = useAuth();
  const go = (path: string) => () => router.push(path as any);

  const [risk, setRisk] = useState<RiskSummary>({
    storage_risk: 0, deletion_pending: 0, sla_overdue: 0,
  });
  const [totpEnabled, setTotpEnabled] = useState<boolean | null>(null);

  const fetchRisk = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiRequest(token, "/super/risk-summary");
      if (res.ok) {
        const data = await res.json();
        setRisk({
          storage_risk:     Number(data.storage_risk    ?? 0),
          deletion_pending: Number(data.deletion_pending ?? 0),
          sla_overdue:      Number(data.sla_overdue     ?? 0),
        });
      }
    } catch (_) {}
  }, [token]);

  useEffect(() => { fetchRisk(); }, [fetchRisk]);

  useEffect(() => {
    if (!token) return;
    apiRequest(token, "/auth/totp/status")
      .then(r => r.json())
      .then((d: any) => setTotpEnabled(d.totp_enabled ?? false))
      .catch(() => setTotpEnabled(false));
  }, [token]);

  const GROUPS: { title: string; items: MenuEntry[] }[] = [
    {
      title: "① 운영 관리",
      items: [
        {
          icon: "briefcase", label: "운영 관리",
          sub: "운영자·저장공간·상태 관리",
          color: "orange", onPress: go("/(super)/op-group"),
        },
      ],
    },
    {
      title: "② 데이터 관리",
      items: [
        {
          icon: "shield", label: "보호·통제",
          sub: "킬스위치·백업·기능플래그·읽기전용",
          color: "navy", onPress: go("/(super)/protect-group"),
          badge: risk.storage_risk > 0 ? `저장 위험 ${risk.storage_risk}` : undefined,
        },
      ],
    },
    {
      title: "③ 고객센터",
      items: [
        {
          icon: "message-circle", label: "지원 센터",
          sub: "문의·복구·보안·SLA 관리",
          color: "navy", onPress: go("/(super)/support-group"),
          badge: risk.sla_overdue > 0 ? `SLA 초과 ${risk.sla_overdue}` : undefined,
        },
      ],
    },
    {
      title: "④ 정책·컴플라이언스",
      items: [
        {
          icon: "file-text", label: "정책·컴플라이언스",
          sub: "약관·개인정보·환불정책·동의상태",
          color: "navy", onPress: go("/(super)/policy"),
        },
      ],
    },
    {
      title: "⑤ 보안·통제",
      items: [
        {
          icon: "lock", label: "보안·설정",
          sub: "계정·2FA·외부서비스·세션·이상감지",
          color: "navy", onPress: go("/(super)/security-settings"),
        },
        {
          icon: "smartphone", label: "Google OTP",
          sub: "Google Authenticator 2단계 인증 설정",
          color: "purple", onPress: () => router.push("/totp-setup" as any),
        },
        {
          icon: "activity", label: "감사·리스크",
          sub: "운영로그·리스크·민감작업",
          color: "navy", onPress: go("/(super)/audit-group"),
        },
      ],
    },
    {
      title: "⑥ 시스템 상태",
      items: [
        {
          icon: "server", label: "시스템 상태",
          sub: "DB·스토리지·이메일·푸시·장애",
          color: "navy", onPress: go("/(super)/system-status"),
        },
        {
          icon: "database", label: "DB 이원화 모니터링",
          sub: "슈퍼관리자 DB · 수영장 운영 DB 용량·이벤트 로그",
          color: "navy", onPress: go("/(super)/db-status"),
        },
        {
          icon: "bell", label: "공지 관리",
          sub: "전체·관리자·선생님·학부모 공지 등록",
          color: "navy", onPress: go("/(super)/notices"),
        },
      ],
    },
    {
      title: "⑦ 광고 관리",
      items: [
        {
          icon: "image", label: "광고 관리",
          sub: "광고 등록·수정·상태 관리 (노출 준비 중)",
          color: "orange", onPress: go("/(super)/ads"),
        },
      ],
    },
  ];

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <View style={[s.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20) }]}>
        <Text style={[s.headerTitle, { color: C.text }]}>더보기</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, gap: 8 }}
      >
        {user && (
          <View style={[s.profileCard, { backgroundColor: PURPLE }]}>
            <View style={s.profileAvatar}>
              <Text style={s.profileAvatarTxt}>{user.name?.[0] ?? "S"}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.profileName}>{user.name}님</Text>
              <Text style={s.profileRole}>슈퍼관리자</Text>
            </View>
            <Pressable style={s.securityBtn} onPress={() => router.push("/(super)/security-settings" as any)}>
              <Shield size={16} color="#fff" />
              <Text style={s.securityBtnTxt}>보안</Text>
            </Pressable>
          </View>
        )}

        {/* OTP 보안 배너 */}
        {totpEnabled !== null && (
          <Pressable
            style={[
              s.otpBanner,
              { backgroundColor: totpEnabled ? "#F0FDF4" : "#FEF9EC", borderColor: totpEnabled ? "#BBF7D0" : "#FDE68A" },
            ]}
            onPress={() => router.push("/totp-setup" as any)}
          >
            <View style={[s.otpBannerIcon, { backgroundColor: totpEnabled ? "#DCFCE7" : "#FEF3C7" }]}>
              <LucideIcon name={totpEnabled ? "shield" : "smartphone"} size={20} color={totpEnabled ? "#16A34A" : "#D97706"} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.otpBannerTitle, { color: totpEnabled ? "#15803D" : "#92400E" }]}>
                {totpEnabled ? "Google OTP 활성화됨" : "Google OTP 미등록"}
              </Text>
              <Text style={[s.otpBannerSub, { color: totpEnabled ? "#16A34A" : "#B45309" }]}>
                {totpEnabled ? "2단계 인증이 설정되어 있습니다" : "탭하여 2단계 인증을 등록하세요"}
              </Text>
            </View>
            <ChevronRight size={16} color={totpEnabled ? "#16A34A" : "#D97706"} />
          </Pressable>
        )}

        {GROUPS.map(g => (
          <View key={g.title}>
            <SectionHeader title={g.title} />
            {g.items.map(item => (
              <MenuItem key={item.label} {...item} />
            ))}
          </View>
        ))}

        <SectionHeader title="시스템" />
        <MenuItem icon="database" label="데이터 동기화" sub="변경분 수집·스냅샷·새벽 배치" color="slate" onPress={go("/(super)/sync")} />
        <MenuItem icon="info"     label="SwimNote 정보"  sub="버전 및 플랫폼 정보" color="slate" onPress={() => {}} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root:             { flex: 1 },
  header:           { paddingHorizontal: 20, paddingBottom: 16 },
  headerTitle:      { fontSize: 22, fontFamily: "Pretendard-Regular" },
  profileCard:      { borderRadius: 20, padding: 18, flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 8 },
  profileAvatar:    { width: 54, height: 54, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.25)",
                      alignItems: "center", justifyContent: "center" },
  profileAvatarTxt: { fontSize: 22, fontFamily: "Pretendard-Regular", color: "#fff" },
  profileName:      { fontSize: 18, fontFamily: "Pretendard-Regular", color: "#fff" },
  profileRole:      { fontSize: 13, fontFamily: "Pretendard-Regular", color: "rgba(255,255,255,0.8)", marginTop: 2 },
  securityBtn:      { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6,
                      borderRadius: 10, backgroundColor: "rgba(255,255,255,0.2)" },
  securityBtnTxt:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#fff" },
  sectionLabel:     { fontSize: 12, fontFamily: "Pretendard-Regular", letterSpacing: 0.5, textTransform: "uppercase",
                      marginTop: 12, marginBottom: 4, paddingLeft: 2 },
  menuItem:         { flexDirection: "row", alignItems: "center", borderRadius: 14, padding: 14, gap: 12, marginBottom: 6,
                      shadowColor: "#0000001A", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 4, elevation: 1 },
  menuIcon:         { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  menuLabel:        { fontSize: 15, fontFamily: "Pretendard-Regular" },
  menuSub:          { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 },
  badge:            { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginRight: 4 },
  badgeTxt:         { fontSize: 11, fontFamily: "Pretendard-Regular" },
  otpBanner:        { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1.5,
                      padding: 14, marginBottom: 6 },
  otpBannerIcon:    { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  otpBannerTitle:   { fontSize: 14, fontFamily: "Pretendard-Regular" },
  otpBannerSub:     { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 },
});
