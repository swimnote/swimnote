/**
 * 설정 탭 — 관리자 요약 + X모드 + 로그인설정 + 핵심설정 + 운영 + 분류 4개
 * Settings Design Rule: compact profile · section container · hairline divider
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import { ChevronRight, UserRound } from "lucide-react-native";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { WithdrawalModal } from "@/components/common/WithdrawalModal";
import AppUpdateButton from "@/components/common/AppUpdateButton";
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
import { useMode } from "@/context/ModeContext";
import { X as XT, isXMode } from "@/constants/xTheme";

const C    = Colors.light;
const NAVY = "#0C1A2E";
const MUTED = C.textMuted;
const DEFAULT_LOGIN_MODE_KEY = "@swimnote:default_login_mode";

// ── 핵심 설정 ────────────────────────────────────────────────────────────────
const CORE_ITEMS = [
  { label: "수영레벨/테스트 기준설정", icon: "award"       as const, desc: "수영 레벨 기준 및 테스트 관리",     route: "/(admin)/level-settings" },
  { label: "일지 템플릿 관리",        icon: "file-text"   as const, desc: "레벨별 일지 템플릿 관리",           route: "/(admin)/diary-template-settings" },
  { label: "반 개설 관리",            icon: "users"        as const, desc: "반 정원 및 개설 기본값 설정",       route: "/(admin)/class-capacity-settings" },
  { label: "권한 설정",               icon: "shield"       as const, desc: "관리자 / 선생님 권한",              route: "/(admin)/admin-grant", subAdminHide: true },
  { label: "보강 정책",               icon: "refresh-cw"   as const, desc: "보강 가능 기간 및 규칙",            route: "/(admin)/makeup-policy" },
] as const;

// ── 운영 ─────────────────────────────────────────────────────────────────────
const OPS_ITEMS = [
  { label: "공지사항 발송", icon: "bell"          as const, desc: "학부모 / 선생님 공지 관리", route: "/(admin)/notices" },
  { label: "문의함",        icon: "inbox"         as const, desc: "학부모 문의 확인 및 관리", route: "/(admin)/inquiries" },
  { label: "문의하기",      icon: "message-circle" as const, desc: "SWIMNOTE 운영팀 문의",    route: "/(admin)/support-chat" },
] as const;

// ── 분류 4개 ─────────────────────────────────────────────────────────────────
type SubItem = { label: string; icon: string; desc: string; route: string; danger?: boolean };
type Category = { id: string; icon: string; label: string; subtitle: string; items: SubItem[] };

const CATEGORIES: Category[] = [
  {
    id: "ops",
    icon: "settings-2",
    label: "운영 및 정책",
    subtitle: "구독 · 환불 · 휴무일 · 푸시",
    items: [
      { label: "구독 관리",       icon: "credit-card", desc: "플랜 선택 및 구독 결제",        route: "/(admin)/subscription" },
      { label: "환불 정책 확인",  icon: "file-check",  desc: "환불 정책 확인 및 동의",        route: "/(admin)/refund-policy" },
      { label: "휴무일 관리",     icon: "x-square",    desc: "수영장 휴무 / 공휴일 설정",     route: "/(admin)/holidays" },
      { label: "푸시 발송 설정",  icon: "send",        desc: "단체 푸시 발송 규칙",           route: "/(admin)/push-message-settings" },
      { label: "알림 설정",       icon: "bell-dot",    desc: "푸시 알림 수신 설정",           route: "/(admin)/push-notification-settings" },
      { label: "수업단가표",      icon: "dollar-sign", desc: "주1·2·3회 수업료 단가 설정",    route: "/(admin)/unit-pricing" },
      { label: "수영장 기본 설정",icon: "building-2",  desc: "수영장 정보 / 소개 / 수강료",   route: "/(admin)/pool-settings" },
    ],
  },
  {
    id: "account",
    icon: "users-2",
    label: "초대 및 계정",
    subtitle: "QR 초대 · 초대기록 · 웹접속",
    items: [
      { label: "학부모 QR 초대", icon: "qr-code",  desc: "QR 코드로 학부모·선생님 초대", route: "/(admin)/invite-qr" },
      { label: "초대 기록",      icon: "list",     desc: "회원 초대 발송 내역",           route: "/(admin)/invite-records" },
      { label: "웹 접속 비밀번호",icon: "globe",   desc: "swimnote.kr 웹 관리자 전용",    route: "/(admin)/web-pin-settings" },
      { label: "내 정보",        icon: "user",     desc: "프로필 및 계정 정보",           route: "/(admin)/my-info" },
      { label: "로그아웃 / 탈퇴",icon: "log-out",  desc: "",                              route: "__logout__", danger: true },
    ],
  },
  {
    id: "data",
    icon: "database",
    label: "데이터 및 브랜딩",
    subtitle: "데이터 · 브랜드 · 화이트라벨",
    items: [
      { label: "데이터 관리", icon: "hard-drive", desc: "저장공간 현황 및 정책", route: "/(admin)/data-management" },
      { label: "브랜드 설정", icon: "sliders",    desc: "앱 이름 / 색상 / 로고", route: "/(admin)/branding" },
      { label: "화이트라벨",  icon: "tag",        desc: "커스텀 브랜딩 옵션",   route: "/(admin)/white-label" },
    ],
  },
  {
    id: "system",
    icon: "life-buoy",
    label: "시스템 및 도움말",
    subtitle: "활동 로그 · 도움말 · 업데이트",
    items: [
      { label: "활동 로그",     icon: "activity",   desc: "관리자 / 선생님 활동 기록", route: "/(admin)/data-event-logs" },
      { label: "앱 사용 도움말",icon: "life-buoy",  desc: "FAQ 및 기능 사용 가이드",  route: "/(admin)/help" },
    ],
  },
];

// ── 컴포넌트: 공통 Row ────────────────────────────────────────────────────────
function SectionRow({
  icon, label, desc, last = false, badge, right,
  onPress,
}: {
  icon: string; label: string; desc?: string; last?: boolean;
  badge?: React.ReactNode; right?: React.ReactNode; onPress?: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        r.row,
        !last && r.rowBorder,
        { opacity: pressed && !!onPress ? 0.7 : 1 },
      ]}
      onPress={onPress}
      disabled={!onPress}
    >
      <LucideIcon name={icon as any} size={17} color={NAVY} />
      <View style={{ flex: 1 }}>
        <Text style={r.label}>{label}</Text>
        {!!desc && <Text style={r.desc}>{desc}</Text>}
      </View>
      {badge}
      {right ?? (onPress ? <LucideIcon name="chevron-right" size={15} color={MUTED} /> : null)}
    </Pressable>
  );
}

// ── 컴포넌트: 분류 행 (inline expand) ────────────────────────────────────────
function CategoryRow({
  cat, backTo, policyAgreed, policyNeedsReagree, onLogout,
}: {
  cat: Category; backTo: string;
  policyAgreed: boolean | null; policyNeedsReagree: boolean;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable
        style={({ pressed }) => [r.row, { opacity: pressed ? 0.7 : 1 }]}
        onPress={() => setOpen(v => !v)}
      >
        <LucideIcon name={cat.icon as any} size={17} color={NAVY} />
        <View style={{ flex: 1 }}>
          <Text style={r.label}>{cat.label}</Text>
          <Text style={r.desc}>{cat.subtitle}</Text>
        </View>
        <LucideIcon name={open ? "chevron-up" : "chevron-down"} size={15} color={MUTED} />
      </Pressable>
      {open && (
        <View style={r.subContainer}>
          {cat.items.map((item, idx) => {
            const isPolicy    = item.route.includes("refund-policy");
            const showDone    = isPolicy && policyAgreed === true && !policyNeedsReagree;
            const showReagree = isPolicy && policyNeedsReagree;
            const showUnread  = isPolicy && policyAgreed === false && !policyNeedsReagree;
            const isLogout    = item.route === "__logout__";
            const isLast      = idx === cat.items.length - 1;
            return (
              <Pressable
                key={item.label}
                style={({ pressed }) => [r.subRow, !isLast && r.subRowBorder, { opacity: pressed ? 0.7 : 1 }]}
                onPress={() => isLogout ? onLogout() : router.push((item.route + `?backTo=${backTo}`) as any)}
              >
                <LucideIcon name={item.icon as any} size={15} color={item.danger ? "#D96C6C" : MUTED} />
                <Text style={[r.subLabel, { color: item.danger ? "#D96C6C" : C.text }]}>{item.label}</Text>
                {showUnread  && <View style={r.pBadgeWrap}><Text style={[r.pBadgeTxt, { color: "#D96C6C" }]}>미확인</Text></View>}
                {showReagree && <View style={[r.pBadgeWrap, { backgroundColor: "#FFFBEB" }]}><Text style={[r.pBadgeTxt, { color: "#D97706" }]}>재동의 필요</Text></View>}
                {showDone    && <View style={[r.pBadgeWrap, { backgroundColor: "#F0FDF4" }]}><Text style={[r.pBadgeTxt, { color: "#16A34A" }]}>동의 완료</Text></View>}
                {!isLogout && <LucideIcon name="chevron-right" size={13} color={MUTED} />}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
export default function SettingsScreen() {
  const { adminUser, switchRole, token, logout, pool } = useAuth();
  const isPaidPlan = adminUser?.role === "pool_admin" && !!pool?.subscription_tier && pool.subscription_tier !== "free";
  const { themeColor } = useBrand();
  const { mode } = useMode();
  const insets = useSafeAreaInsets();
  const scrollRef = useTabScrollReset("settings");

  const isX = isXMode(mode);
  const hasMultipleRoles = (adminUser?.roles?.length ?? 0) >= 2;
  const isSubAdmin = adminUser?.role === "sub_admin";
  const roleLabel  = adminUser?.role === "pool_admin" ? "대표" : adminUser?.role === "sub_admin" ? "관리자" : "선생님";

  const [switchModalVisible, setSwitchModalVisible] = useState(false);
  const [switching, setSwitching]                   = useState(false);
  const [defaultTeacher, setDefaultTeacher]         = useState(false);
  const [deleteConfirm, setDeleteConfirm]           = useState(false);
  const [deleteLoading, setDeleteLoading]           = useState(false);
  const [policyAgreed, setPolicyAgreed]             = useState<boolean | null>(null);
  const [policyNeedsReagree, setPolicyNeedsReagree] = useState(false);
  const [settingsStats, setSettingsStats]           = useState<{ total_members: number; total_teachers: number } | null>(null);

  useEffect(() => {
    if (!token) return;
    apiRequest(token, "/admin/dashboard-stats")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) setSettingsStats({ total_members: d.total_members ?? 0, total_teachers: d.total_teachers ?? 0 });
      }).catch(() => {});
    apiRequest(token, "/admin/refund-policy")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.success) {
          setPolicyAgreed(d.agreed === true && d.needs_reagree === false);
          setPolicyNeedsReagree(d.needs_reagree === true && d.agreed === true);
        }
      }).catch(() => {});
  }, [token]);

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

  async function handleDeleteAccount(immediate: boolean) {
    setDeleteLoading(true);
    try {
      const res = await apiRequest(token, "/auth/account", {
        method: "DELETE",
        body: JSON.stringify({ immediate }),
      });
      if (res.ok) { setDeleteConfirm(false); await logout(); }
    } catch { } finally { setDeleteLoading(false); }
  }

  // 설정 완성도 compact 계산
  const completionItems = settingsStats ? [
    { label: "학생 등록",   done: settingsStats.total_members  > 0, route: "/(admin)/members"      },
    { label: "선생님 초대", done: settingsStats.total_teachers > 0, route: "/(admin)/teachers"     },
    { label: "수영장 정보", done: true,                             route: "/(admin)/pool-settings" },
  ] : [];
  const doneCount = completionItems.filter(i => i.done).length;
  const pct       = completionItems.length > 0 ? Math.round((doneCount / completionItems.length) * 100) : 0;

  const X_ACCENT = XT.accent;
  const X_LIGHT  = XT.accentSoft;

  return (
    <View style={{ flex: 1, backgroundColor: isX ? XT.background : C.background }}>
      {/* 헤더 */}
      <View style={[
        s.header,
        { paddingTop: insets.top + 14 },
        isX && { backgroundColor: XT.surfaceNavy, borderBottomColor: XT.surfaceNavyStrong },
      ]}>
        <Text style={[s.headerTitle, isX && { color: XT.textOnNavy }]}>설정</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 80 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 1. 관리자 요약 ─────────────────────────────────────────────── */}
        <View style={[s.card, { marginBottom: 12 }]}>
          <Pressable style={s.profileRow}>
            <View style={s.avatar}>
              <UserRound size={22} color={NAVY} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.profileName}>{adminUser?.name || "관리자"}</Text>
              <Text style={s.profileRole}>{roleLabel}</Text>
            </View>
            {hasMultipleRoles && (
              <Pressable
                style={[s.switchBtn, { borderColor: themeColor }]}
                onPress={() => setSwitchModalVisible(true)}
              >
                <LucideIcon name="repeat" size={13} color={themeColor} />
                <Text style={[s.switchBtnText, { color: themeColor }]}>역할 전환</Text>
              </Pressable>
            )}
          </Pressable>
        </View>

        {/* ── 2. X모드 상태 — X모드/x_pending일 때만 표시 (일반모드 관리자 미표시) */}
        {adminUser?.role !== "teacher" && isX && (
          <View style={[s.card, { marginBottom: 12 }]}>
            {/* X모드 상태 row */}
            <Pressable
              style={({ pressed }) => [r.row, { opacity: pressed ? 0.7 : 1 }]}
              onPress={() => router.push("/(admin)/x-mode-hub" as any)}
            >
              <View style={[s.xIconWrap, { backgroundColor: X_LIGHT }]}>
                <LucideIcon name="layers" size={16} color={X_ACCENT} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={r.label}>SWIMNOTE X모드</Text>
                <Text style={r.desc}>
                  {mode === "x" ? "X모드 사용 중" : mode === "x_pending" ? "X모드 설정 진행 중" : "X모드 알아보기"}
                </Text>
              </View>
              {mode === "x" && (
                <View style={[s.badge, { backgroundColor: X_LIGHT }]}>
                  <Text style={[s.badgeTxt, { color: X_ACCENT }]}>사용 중</Text>
                </View>
              )}
              {mode === "x_pending" && (
                <View style={[s.badge, { backgroundColor: "#FFFBEB" }]}>
                  <Text style={[s.badgeTxt, { color: "#D97706" }]}>설정 중</Text>
                </View>
              )}
              <LucideIcon name="chevron-right" size={15} color={MUTED} />
            </Pressable>

            {/* X모드 세팅하기 — mode=x + pool_admin만 */}
            {adminUser?.role === "pool_admin" && mode === "x" && (
              <>
                <View style={r.divider} />
                <Pressable
                  style={({ pressed }) => [r.row, { opacity: pressed ? 0.7 : 1 }]}
                  onPress={() => router.push("/(admin)/x-setup" as any)}
                >
                  <View style={[s.xIconWrap, { backgroundColor: X_LIGHT }]}>
                    <LucideIcon name="settings" size={16} color={X_ACCENT} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={r.label}>X모드 세팅하기</Text>
                    <Text style={r.desc}>커리큘럼 설정 및 X 운영 설정 관리</Text>
                  </View>
                  <LucideIcon name="chevron-right" size={15} color={MUTED} />
                </Pressable>
              </>
            )}

            {/* 설정 완성도 compact — settingsStats 로드 후 표시 */}
            {settingsStats && (
              <>
                <View style={r.divider} />
                <View style={s.completionRow}>
                  <Text style={s.completionLabel}>설정 완성도</Text>
                  <Text style={[s.completionPct, { color: pct === 100 ? "#16A34A" : themeColor }]}>{pct}%</Text>
                  <View style={[s.barBg, { backgroundColor: C.border }]}>
                    <View style={[s.barFill, { width: `${pct}%` as any, backgroundColor: pct === 100 ? "#16A34A" : themeColor }]} />
                  </View>
                </View>
                <View style={s.completionItems}>
                  {completionItems.map(item => (
                    <Pressable
                      key={item.label}
                      style={s.completionItem}
                      onPress={() => router.push((item.route + "?backTo=settings") as any)}
                    >
                      <View style={[s.dot, { backgroundColor: item.done ? "#D1FAE5" : C.border }]}>
                        {item.done && <LucideIcon name="check" size={10} color="#16A34A" />}
                      </View>
                      <Text style={[s.dotLabel, { color: item.done ? C.textSecondary : C.text }]}>{item.label}</Text>
                      {!item.done && <Text style={[s.dotTag, { color: themeColor }]}>설정하기</Text>}
                    </Pressable>
                  ))}
                </View>
              </>
            )}
          </View>
        )}

        {/* ── 3. 로그인 설정 ─────────────────────────────────────────────── */}
        {hasMultipleRoles && (
          <View style={[s.card, { marginBottom: 12 }]}>
            <Text style={s.sectionLabel}>로그인 설정</Text>
            <View style={r.row}>
              <LucideIcon name="log-in" size={17} color={NAVY} />
              <View style={{ flex: 1 }}>
                <Text style={r.label}>로그인 후 선생님 모드로 시작</Text>
                <Text style={r.desc}>
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
        )}

        {/* ── 4. 핵심 설정 ───────────────────────────────────────────────── */}
        <View style={[s.card, { marginBottom: 12 }]}>
          <Text style={s.sectionLabel}>핵심 설정</Text>
          {CORE_ITEMS
            .filter(item => !(isSubAdmin && (item as any).subAdminHide))
            .map((item, idx, arr) => (
              <SectionRow
                key={item.label}
                icon={item.icon}
                label={item.label}
                desc={item.desc}
                last={idx === arr.length - 1}
                onPress={() => router.push((item.route + "?backTo=settings") as any)}
              />
            ))
          }
        </View>

        {/* ── 5. 운영 ────────────────────────────────────────────────────── */}
        {!isSubAdmin && (
          <View style={[s.card, { marginBottom: 12 }]}>
            <Text style={s.sectionLabel}>운영</Text>
            {OPS_ITEMS.map((item, idx) => (
              <SectionRow
                key={item.label}
                icon={item.icon}
                label={item.label}
                desc={item.desc}
                last={idx === OPS_ITEMS.length - 1}
                onPress={() => router.push((item.route + "?backTo=settings") as any)}
              />
            ))}
          </View>
        )}

        {/* ── 6. 분류 4개 ─────────────────────────────────────────────────── */}
        <View style={[s.card, { marginBottom: 12 }]}>
          {CATEGORIES.map((cat, idx) => (
            <View key={cat.id}>
              {idx > 0 && <View style={r.divider} />}
              <CategoryRow
                cat={cat}
                backTo="settings"
                policyAgreed={policyAgreed}
                policyNeedsReagree={policyNeedsReagree}
                onLogout={() => setDeleteConfirm(true)}
              />
            </View>
          ))}
        </View>

        {/* ── 7. 앱 업데이트 ─────────────────────────────────────────────── */}
        <View style={[s.card, { marginBottom: 12 }]}>
          <Text style={s.sectionLabel}>앱 업데이트</Text>
          <View style={{ paddingTop: 4 }}>
            <AppUpdateButton themeColor={themeColor} />
          </View>
        </View>

        {/* ── 8. 버전 ────────────────────────────────────────────────────── */}
        <View style={{ alignItems: "center", paddingVertical: 16, gap: 2 }}>
          <Text style={s.versionApp}>SWIMNOTE</Text>
          <Text style={s.versionNum}>관리자 설정</Text>
        </View>
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

      <WithdrawalModal
        visible={deleteConfirm}
        onClose={() => setDeleteConfirm(false)}
        onConfirm={handleDeleteAccount}
        loading={deleteLoading}
        isPaidPlan={isPaidPlan}
      />

      <ConfirmModal
        visible={false}
        title=""
        message=""
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    </View>
  );
}

// ── Row 스타일 ────────────────────────────────────────────────────────────────
const r = StyleSheet.create({
  row:          { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, paddingHorizontal: 14 },
  rowBorder:    { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E2E8F0" },
  label:        { fontSize: 14, fontFamily: "Pretendard-Regular", fontWeight: "500", color: NAVY },
  desc:         { fontSize: 11, fontFamily: "Pretendard-Regular", color: MUTED, marginTop: 1 },
  divider:      { height: StyleSheet.hairlineWidth, backgroundColor: "#E2E8F0", marginHorizontal: 14 },
  subContainer: { backgroundColor: "#F8FAFC", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#E2E8F0" },
  subRow:       { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, paddingHorizontal: 20 },
  subRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#EEF1F5" },
  subLabel:     { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: NAVY },
  pBadgeWrap:   { backgroundColor: "#FEF2F2", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginRight: 4 },
  pBadgeTxt:    { fontSize: 10, fontFamily: "Pretendard-Regular" },
});

// ── 메인 스타일 ───────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  header:        { backgroundColor: "#fff", paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  headerTitle:   { fontSize: 20, fontFamily: "Pretendard-Regular", color: C.text },

  card:          { backgroundColor: C.card, borderRadius: 16, overflow: "hidden", shadowColor: "#0000000A", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 4, elevation: 1 },
  sectionLabel:  { fontSize: 11, fontFamily: "Pretendard-Regular", color: MUTED, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 },

  profileRow:    { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  avatar:        { width: 42, height: 42, borderRadius: 13, backgroundColor: "#EEF2F8", alignItems: "center", justifyContent: "center" },
  profileName:   { fontSize: 15, fontFamily: "Pretendard-Regular", fontWeight: "600", color: NAVY },
  profileRole:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: MUTED, marginTop: 1 },
  switchBtn:     { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 9, borderWidth: 1.5 },
  switchBtnText: { fontSize: 12, fontFamily: "Pretendard-Regular" },

  xIconWrap:     { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  badge:         { borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3, marginRight: 4 },
  badgeTxt:      { fontSize: 10, fontFamily: "Pretendard-Regular", fontWeight: "600" },

  completionRow:   { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 10 },
  completionLabel: { fontSize: 12, fontFamily: "Pretendard-Regular", color: MUTED },
  completionPct:   { fontSize: 13, fontFamily: "Pretendard-Regular", fontWeight: "600" },
  barBg:           { flex: 1, height: 4, borderRadius: 4, overflow: "hidden" },
  barFill:         { height: 4, borderRadius: 4 },
  completionItems: { flexDirection: "row", gap: 10, paddingHorizontal: 14, paddingBottom: 12 },
  completionItem:  { flexDirection: "row", alignItems: "center", gap: 5 },
  dot:             { width: 18, height: 18, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  dotLabel:        { fontSize: 11, fontFamily: "Pretendard-Regular" },
  dotTag:          { fontSize: 11, fontFamily: "Pretendard-Regular" },

  versionApp:    { fontSize: 12, fontFamily: "Pretendard-Regular", fontWeight: "600", color: MUTED },
  versionNum:    { fontSize: 11, fontFamily: "Pretendard-Regular", color: MUTED },
});

// ── 모달 스타일 ───────────────────────────────────────────────────────────────
const sm = StyleSheet.create({
  overlay:         { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", padding: 24 },
  sheet:           { backgroundColor: "#fff", borderRadius: 24, padding: 24, width: "100%", gap: 12 },
  title:           { fontSize: 18, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  sub:             { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginBottom: 4 },
  roleRow:         { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1.5, borderRadius: 14, padding: 14 },
  roleIcon:        { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  roleLabel:       { fontSize: 15, fontFamily: "Pretendard-Regular" },
  roleSub:         { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 },
  activeBadge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  activeBadgeText: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  closeBtn:        { marginTop: 4, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: C.backgroundSoft },
  closeBtnText:    { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.textSecondary },
});
