/**
 * 설정 탭 — 수업설정 / 운영설정 / 수영장설정 3섹션 구조
 * 구독 관리(billing)는 운영설정 하위에 위치, 업그레이드 UI는 앱 심사 후 활성화
 */
import { Activity, ChevronRight, Repeat } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ROLE_CONFIGS } from "@/constants/auth";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { useTabScrollReset } from "@/hooks/useTabScrollReset";

const C = Colors.light;
const N = "#0F172A";
const NB = "#E6FAF8";

type MenuItem = {
  label: string;
  icon: string;
  color: string;
  bg: string;
  route: string;
  desc?: string;
};

const CLASS_SETTINGS: MenuItem[] = [
  { label: "레벨 / 테스트 설정", icon: "award",          color: "#CA8A04", bg: NB, route: "/(admin)/level-settings",             desc: "수영 레벨 기준 및 테스트 관리" },
  { label: "알림 설정",          icon: "bell",            color: "#F59E0B", bg: NB, route: "/(admin)/push-notification-settings", desc: "푸시 알림 수신 설정" },
  { label: "피드백 기본설정",    icon: "message-circle",  color: "#7C3AED", bg: NB, route: "/(admin)/feedback-settings",          desc: "수업 일지 피드백 기본값" },
  { label: "권한 설정",          icon: "shield",          color: "#1D4ED8", bg: NB, route: "/(admin)/admin-grant",                desc: "부관리자 / 선생님 권한" },
  { label: "보강 정책",          icon: "refresh-cw",      color: "#EA580C", bg: NB, route: "/(admin)/makeup-policy",             desc: "보강 가능 기간 및 규칙" },
];

const OPS_SETTINGS: MenuItem[] = [
  { label: "구독 관리",          icon: "credit-card",     color: "#7C3AED", bg: NB, route: "/(admin)/billing",                   desc: "현재 플랜 및 사용량 확인" },
  { label: "데이터 관리",        icon: "hard-drive",      color: "#0369A1", bg: NB, route: "/(admin)/data-management",           desc: "저장공간 현황 및 정책" },
  { label: "브랜드 설정",        icon: "sliders",         color: N,         bg: NB, route: "/(admin)/branding",                  desc: "앱 이름 / 색상 / 로고" },
  { label: "화이트라벨",         icon: "tag",             color: "#DB2777", bg: NB, route: "/(admin)/white-label",               desc: "커스텀 브랜딩 옵션" },
  { label: "공지사항",           icon: "file-text",       color: "#0369A1", bg: NB, route: "/(admin)/notices",                   desc: "학부모 / 선생님 공지 관리" },
  { label: "활동 로그",          icon: "activity",        color: "#16A34A", bg: NB, route: "/(admin)/data-event-logs",           desc: "관리자 / 선생님 활동 기록" },
  { label: "초대 기록",          icon: "send",            color: N,         bg: NB, route: "/(admin)/invite-records",            desc: "회원 초대 발송 내역" },
  { label: "휴무일 관리",        icon: "x-square",        color: N,         bg: NB, route: "/(admin)/holidays",                  desc: "수영장 휴무 / 공휴일 설정" },
  { label: "푸시 발송 설정",     icon: "send",            color: N,         bg: NB, route: "/(admin)/push-message-settings",     desc: "단체 푸시 발송 규칙" },
];

const POOL_SETTINGS: MenuItem[] = [
  { label: "수영장 기본 설정",   icon: "settings",        color: N,         bg: NB, route: "/(admin)/pool-settings",             desc: "수영장 정보 / 소개 / 수강료 등" },
];

const MY_SETTINGS: MenuItem[] = [
  { label: "내 정보",            icon: "user",            color: N,         bg: NB, route: "/(admin)/my-info",                   desc: "프로필 및 계정 정보" },
  { label: "모드 변경",          icon: "grid",            color: N,         bg: NB, route: "/(admin)/mode",                      desc: "관리자 / 선생님 모드 전환" },
];

export default function SettingsScreen() {
  const { token, adminUser, switchRole } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();
  const scrollRef = useTabScrollReset("settings");

  const [switchModalVisible, setSwitchModalVisible] = useState(false);
  const [switching, setSwitching] = useState(false);
  const hasMultipleRoles = (adminUser?.roles?.length ?? 0) >= 2;

  async function handleSwitchRole(role: string) {
    setSwitching(true);
    try {
      await switchRole(role);
      setSwitchModalVisible(false);
      const cfg = ROLE_CONFIGS[role];
      if (cfg) router.replace(cfg.route as any);
    } catch (e) { console.error(e); }
    finally { setSwitching(false); }
  }

  function renderSection(title: string, items: MenuItem[]) {
    return (
      <View style={s.section}>
        <Text style={s.sectionTitle}>{title}</Text>
        <View style={[s.sectionCard, { backgroundColor: C.card }]}>
          {items.map((item, idx) => (
            <Pressable
              key={item.label}
              style={({ pressed }) => [
                s.menuRow,
                idx < items.length - 1 && s.menuRowBorder,
                { opacity: pressed ? 0.7 : 1 },
              ]}
              onPress={() => router.push(item.route as any)}
            >
              <View style={[s.menuIcon, { backgroundColor: item.bg }]}>
                <LucideIcon name={item.icon as any} size={18} color={item.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.menuLabel}>{item.label}</Text>
                {item.desc ? <Text style={s.menuDesc}>{item.desc}</Text> : null}
              </View>
              <ChevronRight size={16} color={C.textMuted} />
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      {/* 헤더 */}
      <View style={[s.header, { paddingTop: insets.top + 14 }]}>
        <Text style={s.headerTitle}>설정</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: insets.bottom + 80 }}
        showsVerticalScrollIndicator={false}
      >
        {/* 프로필 카드 */}
        <View style={[s.profileCard, { backgroundColor: C.card }]}>
          <View style={[s.profileAvatar, { backgroundColor: themeColor + "20" }]}>
            <Text style={[s.profileInitial, { color: themeColor }]}>
              {adminUser?.name?.[0] || "A"}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.profileName}>{adminUser?.name || "관리자"}</Text>
            <Text style={s.profileRole}>수영장 관리자</Text>
          </View>
          {hasMultipleRoles && (
            <Pressable
              style={[s.switchBtn, { borderColor: themeColor }]}
              onPress={() => setSwitchModalVisible(true)}
            >
              <Repeat size={14} color={themeColor} />
              <Text style={[s.switchBtnText, { color: themeColor }]}>역할 전환</Text>
            </Pressable>
          )}
        </View>

        {/* 섹션들 */}
        {renderSection("수업 설정", CLASS_SETTINGS)}
        {renderSection("운영 설정", OPS_SETTINGS)}
        {renderSection("수영장 설정", POOL_SETTINGS)}
        {renderSection("계정 / 기타", MY_SETTINGS)}
      </ScrollView>

      {/* 역할 전환 모달 */}
      <Modal
        visible={switchModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSwitchModalVisible(false)}
      >
        <Pressable style={sm.overlay} onPress={() => setSwitchModalVisible(false)}>
          <Pressable style={sm.sheet} onPress={e => e.stopPropagation()}>
            <Text style={sm.title}>역할 전환</Text>
            <Text style={sm.sub}>전환할 역할을 선택하세요</Text>
            {(adminUser?.roles ?? []).map(role => {
              const cfg = ROLE_CONFIGS[role];
              if (!cfg) return null;
              const isActive = adminUser?.role === role;
              return (
                <Pressable
                  key={role}
                  style={[sm.roleRow, { borderColor: isActive ? cfg.color : C.border, backgroundColor: isActive ? cfg.color + "0A" : "#fff" }]}
                  onPress={() => !isActive && handleSwitchRole(role)}
                  disabled={isActive || switching}
                >
                  <View style={[sm.roleIcon, { backgroundColor: cfg.bgColor }]}>
                    <LucideIcon name={cfg.icon as any} size={20} color={cfg.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[sm.roleLabel, { color: isActive ? cfg.color : C.text }]}>{cfg.title}</Text>
                    <Text style={sm.roleSub}>{cfg.subtitle}</Text>
                  </View>
                  {isActive
                    ? <View style={[sm.activeBadge, { backgroundColor: cfg.color + "20" }]}>
                        <Text style={[sm.activeBadgeText, { color: cfg.color }]}>현재</Text>
                      </View>
                    : switching
                      ? <ActivityIndicator color={cfg.color} size="small" />
                      : <ChevronRight size={16} color={C.textMuted} />
                  }
                </Pressable>
              );
            })}
            <Pressable style={sm.closeBtn} onPress={() => setSwitchModalVisible(false)}>
              <Text style={sm.closeBtnText}>닫기</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    backgroundColor: "#fff",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerTitle: { fontSize: 20, fontFamily: "Pretendard-Regular", color: C.text },

  profileCard: {
    flexDirection: "row", alignItems: "center", gap: 14, padding: 16,
    borderRadius: 18, shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1, shadowRadius: 6, elevation: 2,
  },
  profileAvatar:  { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  profileInitial: { fontSize: 20, fontFamily: "Pretendard-Regular" },
  profileName:    { fontSize: 17, fontFamily: "Pretendard-Regular", color: C.text },
  profileRole:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 },
  switchBtn:      { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1.5 },
  switchBtnText:  { fontSize: 12, fontFamily: "Pretendard-Regular" },

  otpBanner: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, borderWidth: 1.5, padding: 14 },
  otpIcon:   { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  otpTitle:  { fontSize: 13, fontFamily: "Pretendard-Regular" },
  otpSub:    { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 },

  section:      { gap: 8 },
  sectionTitle: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted, paddingHorizontal: 4 },
  sectionCard:  { borderRadius: 18, overflow: "hidden", shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },

  menuRow:       { flexDirection: "row", alignItems: "center", gap: 14, padding: 14 },
  menuRowBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  menuIcon:      { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  menuLabel:     { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.text },
  menuDesc:      { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 2 },
});

const sm = StyleSheet.create({
  overlay:         { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", padding: 24 },
  sheet:           { backgroundColor: "#fff", borderRadius: 24, padding: 24, width: "100%", gap: 12 },
  title:           { fontSize: 18, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  sub:             { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B", marginBottom: 4 },
  roleRow:         { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1.5, borderRadius: 14, padding: 14 },
  roleIcon:        { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  roleLabel:       { fontSize: 15, fontFamily: "Pretendard-Regular" },
  roleSub:         { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2 },
  activeBadge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  activeBadgeText: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  closeBtn:        { marginTop: 4, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#F1F5F9" },
  closeBtnText:    { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#64748B" },
});
