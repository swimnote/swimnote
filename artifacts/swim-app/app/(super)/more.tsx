/**
 * (super)/more.tsx — 슈퍼관리자 더보기
 * 9그룹 메뉴 구조:
 * 1) 운영 관리  2) 매출 분석  3) 비용·지출  4) 데이터 관리
 * 5) 고객센터  6) 정책·컴플라이언스  7) 보안·통제
 * 8) 시스템 상태  9) 광고 관리
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useOperatorsStore } from "@/store/operatorsStore";
import { useSupportStore } from "@/store/supportStore";

const C = Colors.light;
const PURPLE = "#7C3AED";

const ICON_COLOR_MAP: Record<string, { bg: string; icon: string }> = {
  purple:  { bg: "#F3E8FF", icon: PURPLE },
  blue:    { bg: "#E0F2FE", icon: "#0891B2" },
  green:   { bg: "#D1FAE5", icon: "#059669" },
  red:     { bg: "#FEE2E2", icon: "#DC2626" },
  orange:  { bg: "#FEF3C7", icon: "#D97706" },
  indigo:  { bg: "#EEF2FF", icon: "#4F46E5" },
  slate:   { bg: "#F1F5F9", icon: "#475569" },
  teal:    { bg: "#CCFBF1", icon: "#0D9488" },
  rose:    { bg: "#FFE4E6", icon: "#E11D48" },
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
        <Feather name={icon as any} size={20} color={cfg.icon} />
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
      <Feather name="chevron-right" size={18} color={C.textMuted} />
    </Pressable>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <Text style={[s.sectionLabel, { color: C.textMuted }]}>{title}</Text>;
}

export default function SuperMoreScreen() {
  const insets = useSafeAreaInsets();
  const { adminUser: user } = useAuth();
  const operators = useOperatorsStore(s => s.operators);
  const slaOverdue = useSupportStore(s => s.getSlaOverdueCount());

  const go = (path: string) => () => router.push(path as any);

  const paymentIssue = operators.filter(o => o.billingStatus === "payment_failed" || o.billingStatus === "grace").length;
  const storageRisk  = operators.filter(o => o.storageBlocked95).length;

  const GROUPS: { title: string; items: MenuEntry[] }[] = [
    {
      title: "① 운영 관리",
      items: [
        {
          icon: "briefcase", label: "운영 관리",
          sub: "운영자·구독·저장공간·상태 관리",
          color: "purple", onPress: go("/(super)/op-group"),
          badge: paymentIssue > 0 ? `결제 ${paymentIssue}` : undefined,
        },
      ],
    },
    {
      title: "② 매출 분석",
      items: [
        {
          icon: "bar-chart-2", label: "매출 분석",
          sub: "주간·월간·연간 결제 기반 집계",
          color: "green", onPress: go("/(super)/revenue-analytics"),
        },
      ],
    },
    {
      title: "③ 비용·지출",
      items: [
        {
          icon: "trending-down", label: "비용·지출",
          sub: "DB·스토리지·PG수수료·순이익",
          color: "orange", onPress: go("/(super)/cost-analytics"),
        },
      ],
    },
    {
      title: "④ 데이터 관리",
      items: [
        {
          icon: "shield", label: "보호·통제",
          sub: "킬스위치·백업·기능플래그·읽기전용",
          color: "red", onPress: go("/(super)/protect-group"),
          badge: storageRisk > 0 ? `저장 위험 ${storageRisk}` : undefined,
        },
      ],
    },
    {
      title: "⑤ 고객센터",
      items: [
        {
          icon: "message-circle", label: "지원 센터",
          sub: "문의·복구·보안·SLA 관리",
          color: "blue", onPress: go("/(super)/support-group"),
          badge: slaOverdue > 0 ? `SLA 초과 ${slaOverdue}` : undefined,
        },
      ],
    },
    {
      title: "⑥ 정책·컴플라이언스",
      items: [
        {
          icon: "file-text", label: "정책·컴플라이언스",
          sub: "약관·개인정보·환불정책·동의상태",
          color: "indigo", onPress: go("/(super)/support-group"),
        },
      ],
    },
    {
      title: "⑦ 보안·통제",
      items: [
        {
          icon: "lock", label: "보안·설정",
          sub: "계정·2FA·외부서비스·세션·이상감지",
          color: "rose", onPress: go("/(super)/security-settings"),
        },
        {
          icon: "activity", label: "감사·리스크",
          sub: "운영로그·리스크·민감작업",
          color: "indigo", onPress: go("/(super)/audit-group"),
        },
      ],
    },
    {
      title: "⑧ 시스템 상태",
      items: [
        {
          icon: "server", label: "시스템 상태",
          sub: "DB·스토리지·PG·이메일·푸시·장애",
          color: "teal", onPress: go("/(super)/system-status"),
        },
        {
          icon: "bell", label: "공지 관리",
          sub: "전체·관리자·선생님·학부모 공지 등록",
          color: "indigo", onPress: go("/(super)/notices"),
        },
      ],
    },
    {
      title: "⑨ 광고 관리",
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
              <Feather name="shield" size={16} color="#fff" />
              <Text style={s.securityBtnTxt}>보안</Text>
            </Pressable>
          </View>
        )}

        {GROUPS.map(g => (
          <View key={g.title}>
            <SectionHeader title={g.title} />
            {g.items.map(item => (
              <MenuItem key={item.label} {...item} />
            ))}
          </View>
        ))}

        {/* 시스템 */}
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
  headerTitle:      { fontSize: 22, fontFamily: "Inter_700Bold" },
  profileCard:      { borderRadius: 20, padding: 18, flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 8 },
  profileAvatar:    { width: 54, height: 54, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.25)",
                      alignItems: "center", justifyContent: "center" },
  profileAvatarTxt: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff" },
  profileName:      { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  profileRole:      { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.8)", marginTop: 2 },
  securityBtn:      { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6,
                      borderRadius: 10, backgroundColor: "rgba(255,255,255,0.2)" },
  securityBtnTxt:   { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" },
  sectionLabel:     { fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.5, textTransform: "uppercase",
                      marginTop: 12, marginBottom: 4, paddingLeft: 2 },
  menuItem:         { flexDirection: "row", alignItems: "center", borderRadius: 14, padding: 14, gap: 12, marginBottom: 6,
                      shadowColor: "#0000001A", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 4, elevation: 1 },
  menuIcon:         { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  menuLabel:        { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  menuSub:          { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  badge:            { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginRight: 4 },
  badgeTxt:         { fontSize: 11, fontFamily: "Inter_700Bold" },
});
