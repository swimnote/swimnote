/**
 * (super)/more.tsx — 슈퍼관리자 더보기 (4그룹 재분류)
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";

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
};

type MenuEntry = {
  icon: string;
  label: string;
  sub: string;
  onPress: () => void;
  color: keyof typeof ICON_COLOR_MAP;
  badge?: string;
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

  const go = (path: string) => () => router.push(path as any);

  const GROUPS: { title: string; items: MenuEntry[] }[] = [
    {
      title: "① 운영 관리",
      items: [
        { icon: "users",       label: "운영자 관리",        sub: "승인·제한·멤버 현황",              color: "purple", onPress: go("/(super)/pools") },
        { icon: "credit-card", label: "구독·결제 관리",      sub: "결제 상태·크레딧·플랜 변경",       color: "blue",   onPress: go("/(super)/subscriptions") },
        { icon: "package",     label: "구독 상품 설정",      sub: "플랜·추가 용량 상품 관리",          color: "indigo", onPress: go("/(super)/subscription-products") },
        { icon: "hard-drive",  label: "저장공간 관리",        sub: "80%경고·95%차단·업로드 급증",      color: "green",  onPress: go("/(super)/storage") },
        { icon: "settings",    label: "저장공간 정책",        sub: "과금 기준·임계값·override 설정",   color: "slate",  onPress: go("/(super)/storage-policy") },
      ],
    },
    {
      title: "② 보호/통제",
      items: [
        { icon: "zap",         label: "데이터·킬스위치",     sub: "삭제 실행·유예·안전장치 확인",     color: "red",    onPress: go("/(super)/kill-switch") },
        { icon: "archive",     label: "백업/복구/스냅샷",    sub: "스냅샷 생성·복구 작업 관리",       color: "orange", onPress: go("/(super)/backup") },
        { icon: "eye-off",     label: "읽기전용 제어",        sub: "플랫폼·운영자·기능별 제어",       color: "slate",  onPress: go("/(super)/readonly-control") },
        { icon: "toggle-left", label: "기능 플래그",          sub: "전역 토글·운영자 예외·롤백",       color: "purple", onPress: go("/(super)/feature-flags") },
      ],
    },
    {
      title: "③ 정책/지원",
      items: [
        { icon: "file-text",   label: "정책·컴플라이언스",   sub: "이용약관·환불·개인정보 버전 관리", color: "indigo", onPress: go("/(super)/policy") },
        { icon: "headphones",  label: "고객센터",             sub: "SLA·상태관리·에스컬레이션",        color: "blue",   onPress: go("/(super)/support") },
        { icon: "send",        label: "초대/SMS 관리",         sub: "선생님·학부모·운영자 초대 발송",  color: "green",  onPress: go("/(super)/invite-sms") },
      ],
    },
    {
      title: "④ 보안/감사",
      items: [
        { icon: "list",        label: "운영 로그·감사",       sub: "전체 액션 감사 기록 조회",         color: "slate",  onPress: go("/(super)/op-logs") },
        { icon: "alert-triangle",label:"장애·리스크 센터",   sub: "결제·저장·SLA 위험 현황",          color: "red",    onPress: go("/(super)/risk-center") },
        { icon: "shield",      label: "슈퍼관리자 보안관리",  sub: "2FA·세션·잠금·권한 등급",          color: "purple", onPress: go("/(super)/security") },
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
            <Pressable style={s.securityBtn} onPress={() => router.push("/(super)/security" as any)}>
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
        <MenuItem icon="database"  label="데이터 동기화" sub="변경분 수집·스냅샷·새벽 배치" color="slate" onPress={go("/(super)/sync")} />
        <MenuItem icon="info"      label="SwimNote 정보" sub="버전 및 플랫폼 정보" color="slate" onPress={() => {}} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
  profileCard: { borderRadius: 20, padding: 18, flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 8 },
  profileAvatar: { width: 54, height: 54, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.25)", alignItems: "center", justifyContent: "center" },
  profileAvatarTxt: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff" },
  profileName: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  profileRole: { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.8)", marginTop: 2 },
  securityBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6,
                 borderRadius: 10, backgroundColor: "rgba(255,255,255,0.2)" },
  securityBtnTxt: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" },
  sectionLabel: { fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.5, textTransform: "uppercase",
                  marginTop: 12, marginBottom: 4, paddingLeft: 2 },
  menuItem: { flexDirection: "row", alignItems: "center", borderRadius: 14, padding: 14, gap: 12, marginBottom: 6,
              shadowColor: "#0000001A", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 4, elevation: 1 },
  menuIcon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  menuLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  menuSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginRight: 4 },
  badgeTxt: { fontSize: 11, fontFamily: "Inter_700Bold" },
});
