/**
 * 설정 탭 — 수업설정 / 운영설정 / 수영장설정 / 계정
 * U: 복수 역할 보유 시 "로그인 기본 모드" 토글 표시
 */
import { ChevronRight, Check, Repeat } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, ScrollView,
  StyleSheet, Switch, Text, View,
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

const DEFAULT_LOGIN_MODE_KEY = "@swimnote:default_login_mode";

type MenuItem = { label: string; icon: string; color: string; bg: string; route: string; desc?: string };

const CLASS_SETTINGS: MenuItem[] = [
  { label: "레벨 / 테스트 설정", icon: "award",         color: "#CA8A04", bg: NB, route: "/(admin)/level-settings",             desc: "수영 레벨 기준 및 테스트 관리" },
  { label: "알림 설정",          icon: "bell",           color: "#F59E0B", bg: NB, route: "/(admin)/push-notification-settings", desc: "푸시 알림 수신 설정" },
  { label: "피드백 기본설정",    icon: "message-circle", color: "#7C3AED", bg: NB, route: "/(admin)/feedback-settings",          desc: "수업 일지 피드백 기본값" },
  { label: "권한 설정",          icon: "shield",         color: "#1D4ED8", bg: NB, route: "/(admin)/admin-grant",                desc: "관리자 / 선생님 권한" },
  { label: "보강 정책",          icon: "refresh-cw",     color: "#EA580C", bg: NB, route: "/(admin)/makeup-policy",             desc: "보강 가능 기간 및 규칙" },
];

const OPS_SETTINGS: MenuItem[] = [
  { label: "학부모 QR 초대",     icon: "qr-code",        color: "#0EA5E9", bg: NB, route: "/(admin)/invite-qr",                 desc: "QR 코드로 학부모·선생님 초대" },
  { label: "구독 관리",          icon: "credit-card",    color: "#7C3AED", bg: NB, route: "/(admin)/subscription",              desc: "현재 플랜 및 사용량 확인" },
  { label: "데이터 관리",        icon: "hard-drive",     color: "#0369A1", bg: NB, route: "/(admin)/data-management",           desc: "저장공간 현황 및 정책" },
  { label: "브랜드 설정",        icon: "sliders",        color: N,         bg: NB, route: "/(admin)/branding",                  desc: "앱 이름 / 색상 / 로고" },
  { label: "화이트라벨",         icon: "tag",            color: "#DB2777", bg: NB, route: "/(admin)/white-label",               desc: "커스텀 브랜딩 옵션" },
  { label: "공지사항",           icon: "file-text",      color: "#0369A1", bg: NB, route: "/(admin)/notices",                   desc: "학부모 / 선생님 공지 관리" },
  { label: "활동 로그",          icon: "activity",       color: "#16A34A", bg: NB, route: "/(admin)/data-event-logs",           desc: "관리자 / 선생님 활동 기록" },
  { label: "초대 기록",          icon: "send",           color: N,         bg: NB, route: "/(admin)/invite-records",            desc: "회원 초대 발송 내역" },
  { label: "휴무일 관리",        icon: "x-square",       color: N,         bg: NB, route: "/(admin)/holidays",                  desc: "수영장 휴무 / 공휴일 설정" },
  { label: "푸시 발송 설정",     icon: "send",           color: N,         bg: NB, route: "/(admin)/push-message-settings",     desc: "단체 푸시 발송 규칙" },
];

const POOL_SETTINGS: MenuItem[] = [
  { label: "수영장 기본 설정",   icon: "settings",       color: N,         bg: NB, route: "/(admin)/pool-settings",             desc: "수영장 정보 / 소개 / 수강료 등" },
];

const MY_SETTINGS: MenuItem[] = [
  { label: "내 정보",            icon: "user",           color: N,         bg: NB, route: "/(admin)/my-info",                   desc: "프로필 및 계정 정보" },
  { label: "앱 사용 도움말",     icon: "life-buoy",      color: "#0EA5E9", bg: NB, route: "/(admin)/help",                      desc: "FAQ 및 기능 사용 가이드" },
  { label: "문의하기",           icon: "message-circle", color: "#7C3AED", bg: "#EEDDF5", route: "/support-ticket-list",        desc: "스윔노트 고객센터 문의" },
];

export default function SettingsScreen() {
  const { adminUser, switchRole, token, logout } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();
  const scrollRef = useTabScrollReset("settings");

  const [switchModalVisible, setSwitchModalVisible] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [defaultTeacher, setDefaultTeacher] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  async function handleDeleteAccount() {
    setDeleteLoading(true);
    try {
      const res = await apiRequest(token, "/auth/account", { method: "DELETE" });
      if (res.ok) { setDeleteConfirm(false); await logout(); }
    } catch { } finally { setDeleteLoading(false); }
  }

  // I: 설정 완성도
  const [settingsStats, setSettingsStats] = useState<{ total_members: number; total_teachers: number; total_parents: number } | null>(null);

  useEffect(() => {
    if (!token) return;
    apiRequest(token, "/admin/dashboard-stats").then(r => r.ok ? r.json() : null).then(d => {
      if (d) setSettingsStats({ total_members: d.total_members ?? 0, total_teachers: d.total_teachers ?? 0, total_parents: d.total_parents ?? 0 });
    }).catch(() => {});
  }, [token]);

  const hasMultipleRoles = (adminUser?.roles?.length ?? 0) >= 2;

  useEffect(() => {
    AsyncStorage.getItem(DEFAULT_LOGIN_MODE_KEY).then(v => {
      setDefaultTeacher(v === "teacher");
    }).catch(() => {});
  }, []);

  async function toggleDefaultMode(val: boolean) {
    setDefaultTeacher(val);
    await AsyncStorage.setItem(DEFAULT_LOGIN_MODE_KEY, val ? "teacher" : "admin").catch(() => {});
  }

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
              onPress={() => router.push((item.route + "?backTo=settings") as any)}
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
            <Text style={s.profileRole}>
              {adminUser?.role === "pool_admin" ? "대표" : adminUser?.role === "sub_admin" ? "관리자" : "선생님"}
            </Text>
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

        {/* I: 설정 완성도 점수 */}
        {(() => {
          if (!settingsStats) return null;
          const items = [
            { label: "학생 등록",   done: settingsStats.total_members  > 0, route: "/(admin)/members"   },
            { label: "선생님 초대", done: settingsStats.total_teachers > 0, route: "/(admin)/teachers"  },
            { label: "수영장 정보", done: true,                             route: "/(admin)/pool-settings" },
          ];
          const doneCount = items.filter(i => i.done).length;
          const pct = Math.round((doneCount / items.length) * 100);
          return (
            <View style={[sc.card, { backgroundColor: C.card }]}>
              <View style={sc.topRow}>
                <Text style={sc.title}>설정 완성도</Text>
                <Text style={[sc.pct, { color: pct === 100 ? "#16A34A" : themeColor }]}>{pct}%</Text>
              </View>
              <View style={[sc.barBg, { backgroundColor: C.border }]}>
                <View style={[sc.barFill, { width: `${pct}%` as any, backgroundColor: pct === 100 ? "#16A34A" : themeColor }]} />
              </View>
              <View style={sc.list}>
                {items.map(item => (
                  <Pressable key={item.label} style={sc.row} onPress={() => router.push((item.route + "?backTo=settings") as any)}>
                    <View style={[sc.dot, { backgroundColor: item.done ? "#D1FAE5" : C.border }]}>
                      {item.done && <Check size={11} color="#16A34A" />}
                    </View>
                    <Text style={[sc.rowLabel, { color: item.done ? C.textSecondary : C.text }]}>{item.label}</Text>
                    {!item.done && <Text style={[sc.rowTag, { color: themeColor }]}>설정하기</Text>}
                  </Pressable>
                ))}
              </View>
            </View>
          );
        })()}

        {/* 로그인 기본 모드 (복수 역할 보유 시만 표시) */}
        {hasMultipleRoles && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>로그인 설정</Text>
            <View style={[s.sectionCard, { backgroundColor: C.card }]}>
              <View style={s.toggleRow}>
                <View style={[s.menuIcon, { backgroundColor: NB }]}>
                  <LucideIcon name="log-in" size={18} color={N} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.menuLabel}>로그인 후 선생님 모드로 시작</Text>
                  <Text style={s.menuDesc}>
                    {defaultTeacher ? "로그인 시 선생님 화면으로 진입합니다" : "로그인 시 관리자 화면으로 진입합니다"}
                  </Text>
                </View>
                <Switch
                  value={defaultTeacher}
                  onValueChange={toggleDefaultMode}
                  trackColor={{ false: C.border, true: themeColor }}
                  thumbColor="#fff"
                />
              </View>
            </View>
          </View>
        )}

        {renderSection("수업 설정", CLASS_SETTINGS.filter(m =>
          adminUser?.role === "sub_admin" ? m.label !== "권한 설정" : true
        ))}
        {adminUser?.role !== "sub_admin" && renderSection("운영 설정", OPS_SETTINGS)}
        {adminUser?.role !== "sub_admin" && renderSection("수영장 설정", POOL_SETTINGS)}
        {renderSection("계정 / 기타", MY_SETTINGS)}

        {/* 계정 삭제 */}
        <Pressable
          style={({ pressed }) => [s.deleteBtn, { opacity: pressed ? 0.7 : 1 }]}
          onPress={() => setDeleteConfirm(true)}
        >
          <Text style={s.deleteBtnText}>회원 탈퇴</Text>
        </Pressable>

      </ScrollView>

      <ConfirmModal
        visible={deleteConfirm}
        title="회원 탈퇴"
        message={"계정을 삭제하면 모든 데이터가 익명 처리되며\n복구할 수 없습니다. 정말 탈퇴하시겠습니까?"}
        confirmText={deleteLoading ? "처리 중..." : "탈퇴하기"}
        destructive
        onConfirm={handleDeleteAccount}
        onCancel={() => setDeleteConfirm(false)}
      />

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
  headerTitle:    { fontSize: 20, fontFamily: "Pretendard-Regular", color: C.text },
  profileCard:    { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: 18, shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  profileAvatar:  { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  profileInitial: { fontSize: 20, fontFamily: "Pretendard-Regular" },
  profileName:    { fontSize: 17, fontFamily: "Pretendard-Regular", color: C.text },
  profileRole:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 },
  switchBtn:      { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1.5 },
  switchBtnText:  { fontSize: 12, fontFamily: "Pretendard-Regular" },
  section:        { gap: 8 },
  sectionTitle:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted, paddingHorizontal: 4 },
  sectionCard:    { borderRadius: 18, overflow: "hidden", shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  menuRow:        { flexDirection: "row", alignItems: "center", gap: 14, padding: 14 },
  toggleRow:      { flexDirection: "row", alignItems: "center", gap: 14, padding: 14 },
  menuRowBorder:  { borderBottomWidth: 1, borderBottomColor: C.border },
  menuIcon:       { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  menuLabel:      { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.text },
  menuDesc:       { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 2 },
  deleteBtn:      { alignItems: "center", paddingVertical: 14 },
  deleteBtnText:  { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#D96C6C" },
});

// I: 설정 완성도 스타일
const sc = StyleSheet.create({
  card:     { borderRadius: 18, padding: 16, gap: 10, shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  topRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title:    { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.text },
  pct:      { fontSize: 20, fontFamily: "Pretendard-Regular" },
  barBg:    { height: 6, borderRadius: 6, overflow: "hidden" },
  barFill:  { height: 6, borderRadius: 6 },
  list:     { gap: 6, marginTop: 4 },
  row:      { flexDirection: "row", alignItems: "center", gap: 10 },
  dot:      { width: 22, height: 22, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  rowLabel: { fontSize: 13, fontFamily: "Pretendard-Regular", flex: 1 },
  rowTag:   { fontSize: 12, fontFamily: "Pretendard-Regular" },
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
