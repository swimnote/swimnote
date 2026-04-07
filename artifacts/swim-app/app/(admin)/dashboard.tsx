/**
 * 관리자 홈 — 아이콘 기반 운영 OS 허브
 * 배너(4개 핵심 지표) + 메인 아이콘 8개(4×2 그리드)
 * 메신저 외 7개 아이콘은 3열 그리드 팝업을 거쳐 페이지 이동
 * SearchModal, AdminQuickRegisterModal → components/admin/ 로 이동됨
 */
import { Check, ChevronRight, CircleAlert, Crown, LogOut, Repeat, Search, TriangleAlert, UserPlus, UserX, X, Zap } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Modal, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { useTabScrollReset } from "@/hooks/useTabScrollReset";
import { PaymentBanner } from "@/components/common/PaymentBanner";
import { SearchModal } from "@/components/admin/SearchModal";
import { AdminQuickRegisterModal } from "@/components/admin/AdminQuickRegisterModal";
import OnboardingTooltip from "@/components/common/OnboardingTooltip";

const WIZARD_DISMISSED_KEY = "@swimnote:setup_wizard_dismissed";
const WIZARD_CELEBRATED_KEY = "@swimnote:setup_wizard_celebrated";

const C = Colors.light;
const TAB_BAR_H = Platform.OS === "web" ? 90 : 72;

function formatWon(n: number) {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1).replace(/\.0$/, "") + "억원";
  if (n >= 10_000) return Math.floor(n / 10_000) + "만원";
  return n.toLocaleString("ko-KR") + "원";
}

const STATUS_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  trial:           { label: "체험 중",   color: "#7C3AED", bg: "#E6FAF8" },
  active:          { label: "구독 중",   color: "#2EC4B6", bg: "#E6FFFA" },
  expired:         { label: "만료됨",    color: "#64748B", bg: "#FFFFFF" },
  suspended:       { label: "정지됨",    color: "#D97706", bg: "#FFF1BF" },
  cancelled:       { label: "해지됨",    color: "#D96C6C", bg: "#F9DEDA" },
  payment_failed:  { label: "결제 실패", color: "#DC2626", bg: "#FEE2E2" },
  pending_deletion:{ label: "삭제 예약", color: "#9B1C1C", bg: "#FEE2E2" },
  deleted:         { label: "삭제됨",    color: "#64748B", bg: "#E5E7EB" },
};


// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export default function DashboardScreen() {
  const { adminUser, pool, logout, token, switchRole, setLastUsedRole } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();
  const scrollRef = useTabScrollReset("dashboard");

  const [stats, setStats] = useState<any>(null);
  const [storagePct, setStoragePct] = useState<number | null>(null);
  const [videoStoragePct, setVideoStoragePct] = useState<number | null>(null);
  const [memberLimit, setMemberLimit] = useState<number>(10);
  const [makeupAssigned, setMakeupAssigned] = useState<number>(0);
  const [subTier, setSubTier]               = useState<string>("free");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [switching, setSwitching] = useState(false);

  // B: 시작 가이드 마법사
  const [wizardDismissed, setWizardDismissed] = useState(true);
  const [showCelebration, setShowCelebration] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(WIZARD_DISMISSED_KEY).then(v => {
      setWizardDismissed(v === "1");
    }).catch(() => {});
  }, []);

  async function dismissWizard() {
    setWizardDismissed(true);
    await AsyncStorage.setItem(WIZARD_DISMISSED_KEY, "1").catch(() => {});
  }

  // W: 모든 설정 완료 시 축하 팝업 (한 번만)
  useEffect(() => {
    if (!stats) return;
    const hasMembers  = (stats.total_members ?? 0) > 0;
    const hasTeachers = (stats.total_teachers ?? 0) > 0;
    const hasParents  = (stats.total_parents ?? 0) > 0;
    if (hasMembers && hasTeachers && hasParents) {
      AsyncStorage.getItem(WIZARD_CELEBRATED_KEY).then(v => {
        if (!v) {
          setShowCelebration(true);
          AsyncStorage.setItem(WIZARD_CELEBRATED_KEY, "1").catch(() => {});
        }
      }).catch(() => {});
    }
  }, [stats]);

  const fetchStats = useCallback(async () => {
    try {
      const [statsRes, storageRes, stats2Res, poolRes, featRes] = await Promise.all([
        apiRequest(token, "/admin/dashboard-stats"),
        apiRequest(token, "/admin/storage").catch(() => null),
        apiRequest(token, "/admin/dashboard-stats2").catch(() => null),
        apiRequest(token, "/pools/my").catch(() => null),
        apiRequest(token, "/billing/features").catch(() => null),
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (storageRes?.ok) {
        const s = await storageRes.json();
        const quota = s.quota_bytes ?? 5 * 1024 ** 3;
        setStoragePct(quota > 0 ? Math.min(100, Math.round((s.total_bytes / quota) * 1000) / 10) : 0);
        setVideoStoragePct(quota > 0 ? Math.min(100, Math.round((s.video_bytes / quota) * 1000) / 10) : 0);
      }
      if (stats2Res?.ok) {
        const s2 = await stats2Res.json();
        setMakeupAssigned(s2.makeup_assigned ?? 0);
      }
      if (poolRes?.ok) {
        const p = await poolRes.json();
        setMemberLimit(p.member_limit ?? 10);
      }
      if (featRes?.ok) {
        const f = await featRes.json();
        setSubTier(f.tier ?? "free");
      }
    } finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  useFocusEffect(useCallback(() => {
    fetchStats();
  }, [fetchStats]));

  // pool_admin이면 항상 선생님 모드 전환 가능 (자동 생성 구조 — 신규·기존 계정 모두 지원)
  const canSwitchToTeacher = adminUser?.role === "pool_admin" || !!(adminUser?.roles?.includes("teacher"));

  // 구독 등급 아이콘 설정
  const PREMIER_TIERS = new Set(["center_200", "advance", "pro", "max"]);
  const COACH_TIERS   = new Set(["starter", "basic", "standard"]);
  const tierInfo = PREMIER_TIERS.has(subTier)
    ? { Icon: Crown, color: "#F59E0B", bg: "#FEF3C7", label: "Premier" }
    : COACH_TIERS.has(subTier)
    ? { Icon: Zap,   color: "#7C3AED", bg: "#EDE9FE", label: "Coach" }
    : { Icon: null,  color: "#94A3B8", bg: "#F1F5F9", label: "Free" };

  const roleLabel = adminUser?.role === "pool_admin" ? "대표" : adminUser?.role === "sub_admin" ? "관리자" : "선생님";

  async function handleSwitchToTeacher() {
    if (switching) return;
    setSwitching(true);
    try {
      await switchRole("teacher");
      await setLastUsedRole("teacher");
      router.replace("/(teacher)/today-schedule" as any);
    } catch (e) { console.error(e); }
    finally { setSwitching(false); }
  }

  const _BIB = "#E6FAF8";

  return (
    <View style={{ flex: 1, backgroundColor: "#F5F6FA" }}>
      {/* ── 상단 헤더 ── */}
      <View style={[s.topBar, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 14) }]}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={s.poolName} numberOfLines={1}>{pool?.name || "수영장"}</Text>
            {canSwitchToTeacher && (
              <Pressable
                style={({ pressed }) => [
                  s.switchChip,
                  { borderColor: "#0F172A30", backgroundColor: "#E6FAF8", opacity: pressed || switching ? 0.7 : 1 },
                ]}
                onPress={handleSwitchToTeacher}
                disabled={switching}
              >
                {switching
                  ? <ActivityIndicator size="small" color="#0F172A" />
                  : <>
                      <Repeat size={10} color="#0F172A" />
                      <Text style={[s.switchChipTxt, { color: C.text }]}>선생님으로 전환</Text>
                    </>
                }
              </Pressable>
            )}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 }}>
            {/* 구독 등급 아이콘 — 누르면 구독 옵션 화면으로 이동 */}
            <Pressable
              onPress={() => router.push("/(admin)/subscription")}
              hitSlop={8}
              style={({ pressed }) => [
                s.tierBadge,
                { backgroundColor: tierInfo.bg, opacity: pressed ? 0.75 : 1 },
              ]}
            >
              {tierInfo.Icon
                ? <tierInfo.Icon size={11} color={tierInfo.color} strokeWidth={2.5} />
                : null
              }
              <Text style={[s.tierBadgeTxt, { color: tierInfo.color }]}>{tierInfo.label}</Text>
            </Pressable>
            {/* 관리자 자격 표시 */}
            <Text style={s.greet}>{pool?.name ?? adminUser?.name ?? ""}</Text>
            <View style={[s.roleChip]}>
              <Text style={s.roleChipTxt}>{roleLabel}</Text>
            </View>
          </View>
        </View>
        <Pressable onPress={() => setShowSearch(true)} style={s.headerBtn} hitSlop={8}>
          <Search size={20} color={C.textSecondary} />
        </Pressable>
        <Pressable onPress={logout} style={s.headerBtn} hitSlop={8}>
          <LogOut size={18} color={C.textSecondary} />
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: TAB_BAR_H + 24, paddingTop: 16, gap: 20 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchStats(); }} tintColor={themeColor} />
        }
      >
        <PaymentBanner />

        {/* B: 시작 가이드 마법사 — 학생/선생님/학부모 미완료 시 표시 */}
        {!loading && !wizardDismissed && stats && (() => {
          const steps = [
            { label: "학생 등록",    done: (stats.total_members  ?? 0) > 0, route: "/(admin)/members",        icon: "users" },
            { label: "선생님 초대",  done: (stats.total_teachers ?? 0) > 0, route: "/(admin)/teachers",       icon: "user-check" },
          ];
          const allDone = steps.every(s => s.done);
          if (allDone) return null;
          return (
            <View style={wz.card}>
              <View style={wz.header}>
                <Text style={wz.title}>시작 가이드</Text>
                <Pressable onPress={dismissWizard} hitSlop={8}>
                  <X size={16} color={C.textMuted} />
                </Pressable>
              </View>
              <Text style={wz.sub}>아래 3단계를 완료하면 운영 준비가 끝납니다</Text>
              {steps.map((step, idx) => (
                <Pressable
                  key={step.label}
                  style={[wz.step, idx < steps.length - 1 && wz.stepBorder]}
                  onPress={() => router.push((step.route + "?backTo=dashboard") as any)}
                >
                  <View style={[wz.stepIcon, { backgroundColor: step.done ? "#D1FAE5" : "#F1F5F9" }]}>
                    {step.done
                      ? <Check size={16} color="#16A34A" />
                      : <LucideIcon name={step.icon as any} size={16} color={C.textMuted} />
                    }
                  </View>
                  <Text style={[wz.stepLabel, step.done && wz.stepDone]}>{step.label}</Text>
                  {!step.done && <ChevronRight size={14} color={C.textMuted} style={{ marginLeft: "auto" }} />}
                  {step.done && <Text style={wz.doneTag}>완료</Text>}
                </Pressable>
              ))}
            </View>
          );
        })()}

        {/* 첫 방문 툴팁: 대시보드 안내 */}
        {!loading && (
          <OnboardingTooltip
            storageKey="@swimnote:tooltip_dashboard_v1"
            title="대시보드 사용법"
            message="아래 숫자 카드를 탭하면 해당 메뉴로 바로 이동합니다. 처리할 일이 생기면 알림 카드로 표시됩니다."
            accentColor={themeColor}
          />
        )}

        {loading ? (
          <ActivityIndicator color={themeColor} size="large" style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* ── 운영 현황 카드 ── */}
            <View style={{ gap: 8 }}>
              {/* 1행: 이번 달 매출 + 전체 회원 */}
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable
                  style={({ pressed }) => [s.bannerCard, { flex: 1, opacity: pressed ? 0.85 : 1 }]}
                  onPress={() => router.push("/(admin)/admin-revenue?backTo=dashboard")}
                >
                  <View style={[s.bannerIcon, { backgroundColor: _BIB }]}>
                    <LucideIcon name="trending-up" size={18} color="#CA8A04" />
                  </View>
                  <Text style={[s.bannerValue, { color: "#CA8A04" }]}>
                    {stats ? formatWon(stats.monthly_revenue ?? 0) : "—"}
                  </Text>
                  <Text style={s.bannerLabel}>이번 달 매출</Text>
                  <Text style={s.bannerSub}>월 누적 매출</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [s.bannerCard, { flex: 1, opacity: pressed ? 0.85 : 1 }]}
                  onPress={() => router.push("/(admin)/members?backTo=dashboard")}
                >
                  <View style={[s.bannerIcon, { backgroundColor: _BIB }]}>
                    <LucideIcon name="users" size={18} color="#1D4ED8" />
                  </View>
                  <Text style={[s.bannerValue, { color: "#1D4ED8" }]}>
                    {stats ? String(stats.total_members) : "—"}명
                  </Text>
                  <Text style={s.bannerLabel}>전체 회원</Text>
                  <Text style={s.bannerSub}>등록 회원 수</Text>
                </Pressable>
              </View>

              {/* 2행: 보강 상태 + 인원관리 (좌우 절반) */}
              <View style={{ flexDirection: "row", gap: 10 }}>
                {/* 왼쪽: 보강 상태 */}
                <Pressable
                  style={({ pressed }) => [s.bannerWide, { flex: 1, opacity: pressed ? 0.85 : 1 }]}
                  onPress={() => router.push("/(admin)/makeups?backTo=dashboard")}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <View style={[s.bannerIcon, { backgroundColor: _BIB }]}>
                      <LucideIcon name="rotate-ccw" size={18} color="#EA580C" />
                    </View>
                    <Text style={s.bannerLabel}>보강 상태</Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <View style={s.wideSubItem}>
                      <Text style={[s.wideSubVal, { color: "#16A34A" }]}>
                        {stats ? String(makeupAssigned) : "—"}건
                      </Text>
                      <Text style={s.wideSubLabel}>남은 보강</Text>
                    </View>
                    <View style={s.wideSubDivider} />
                    <View style={s.wideSubItem}>
                      <Text style={[s.wideSubVal, { color: "#EA580C" }]}>
                        {stats ? String(stats.pending_makeups ?? 0) : "—"}건
                      </Text>
                      <Text style={s.wideSubLabel}>미처리 보강</Text>
                    </View>
                  </View>
                </Pressable>

                {/* 오른쪽: 인원관리 */}
                <Pressable
                  style={({ pressed }) => [s.bannerWide, { flex: 1, opacity: pressed ? 0.85 : 1, justifyContent: "center", alignItems: "center", gap: 8 }]}
                  onPress={() => router.push("/(admin)/people?backTo=dashboard")}
                >
                  <View style={[s.bannerIcon, { backgroundColor: "#EFF6FF", marginBottom: 0 }]}>
                    <LucideIcon name="users" size={22} color="#1D4ED8" />
                  </View>
                  <Text style={[s.bannerLabel, { fontFamily: "Pretendard-Regular" }]}>인원관리</Text>
                  <Text style={s.bannerSub}>회원 · 선생님 · 승인</Text>
                </Pressable>
              </View>

              {/* 3행: 통합 사용량 (full-width, 3지표) */}
              <Pressable
                style={({ pressed }) => [s.bannerWide, { opacity: pressed ? 0.85 : 1 }]}
                onPress={() => router.push("/(admin)/data-storage-overview?backTo=dashboard")}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <View style={[s.bannerIcon, { backgroundColor: _BIB }]}>
                    <LucideIcon name="hard-drive" size={18} color="#0369A1" />
                  </View>
                  <Text style={s.bannerLabel}>통합 사용량</Text>
                </View>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={[s.wideSubItem, { flex: 1 }]}>
                    <Text style={[s.wideSubVal, { color: "#1D4ED8" }]}>
                      {stats ? `${stats.total_members}/${memberLimit}` : "—"}명
                    </Text>
                    <Text style={s.wideSubLabel}>회원 사용량</Text>
                  </View>
                  <View style={s.wideSubDivider} />
                  <View style={[s.wideSubItem, { flex: 1 }]}>
                    <Text style={[s.wideSubVal, { color: "#0369A1" }]}>
                      {storagePct !== null ? `${storagePct}%` : "—"}
                    </Text>
                    <Text style={s.wideSubLabel}>데이터 사용량</Text>
                  </View>
                  <View style={s.wideSubDivider} />
                  <View style={[s.wideSubItem, { flex: 1 }]}>
                    <Text style={[s.wideSubVal, { color: "#7C3AED" }]}>
                      {videoStoragePct !== null ? `${videoStoragePct}%` : "—"}
                    </Text>
                    <Text style={s.wideSubLabel}>영상 사용량</Text>
                  </View>
                </View>
              </Pressable>
            </View>

            {/* ── 미배정 / 학부모미연결 분리 카운트 ── */}
            {stats && (
              <View style={s.splitStatRow}>
                <Pressable style={[s.splitStatItem, { flex: 1 }]} onPress={() => router.push("/(admin)/members?filter=unassigned&backTo=dashboard" as any)}>
                  <View style={[s.splitStatIcon, { backgroundColor: "#E6FAF8" }]}>
                    <CircleAlert size={14} color="#0F172A" />
                  </View>
                  <View>
                    <Text style={[s.splitStatNum, { color: C.text }]}>{stats.unassigned ?? 0}명</Text>
                    <Text style={s.splitStatLabel}>수업 미배정</Text>
                  </View>
                </Pressable>
                <View style={s.splitStatDivider} />
                <Pressable style={[s.splitStatItem, { flex: 1 }]} onPress={() => router.push("/(admin)/members?filter=unlinked&backTo=dashboard" as any)}>
                  <View style={[s.splitStatIcon, { backgroundColor: "#E6FAF8" }]}>
                    <UserX size={14} color="#0F172A" />
                  </View>
                  <View>
                    <Text style={[s.splitStatNum, { color: C.text }]}>{stats.unlinked_members ?? 0}명</Text>
                    <Text style={s.splitStatLabel}>학부모미연결</Text>
                  </View>
                </Pressable>
              </View>
            )}

            {/* X: 스마트 처리 알림 — 처리 필요 항목 한눈에 */}
            {stats && (() => {
              const alerts = [
                stats.pending_requests > 0 && {
                  icon: "user-check" as const,
                  color: "#D97706",
                  bg: "#FFFBEB",
                  label: `승인 대기 ${stats.pending_requests}건`,
                  sub: "탭하여 처리",
                  route: "/(admin)/approvals?backTo=dashboard",
                },
                (stats.pending_makeups ?? 0) > 0 && {
                  icon: "rotate-ccw" as const,
                  color: "#D96C6C",
                  bg: "#FEF2F2",
                  label: `보강 미처리 ${stats.pending_makeups}건`,
                  sub: "배정 필요",
                  route: "/(admin)/makeups?backTo=dashboard",
                },
                (stats.unassigned ?? 0) > 0 && {
                  icon: "alert-circle" as const,
                  color: "#DC2626",
                  bg: "#FEE2E2",
                  label: `수업 미배정 ${stats.unassigned}명`,
                  sub: "반 배정 필요",
                  route: "/(admin)/members?filter=unassigned&backTo=dashboard",
                },
                (stats.unlinked_members ?? 0) > 0 && {
                  icon: "user-x" as const,
                  color: "#EA580C",
                  bg: "#FFF7ED",
                  label: `학부모 미연결 ${stats.unlinked_members}명`,
                  sub: "초대 발송 권장",
                  route: "/(admin)/members?filter=unlinked&backTo=dashboard",
                },
              ].filter(Boolean) as { icon: string; color: string; bg: string; label: string; sub: string; route: string }[];
              if (alerts.length === 0) return null;
              return (
                <View style={s.alertCard}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <TriangleAlert size={13} color="#D97706" />
                    <Text style={[s.alertTxt, { fontWeight: "700", color: "#D97706" }]}>처리 필요 {alerts.length}건</Text>
                  </View>
                  {alerts.map(a => (
                    <Pressable
                      key={a.label}
                      style={[s.alertRow, { backgroundColor: a.bg }]}
                      onPress={() => router.push(a.route as any)}
                    >
                      <LucideIcon name={a.icon as any} size={13} color={a.color} />
                      <View style={{ flex: 1 }}>
                        <Text style={[s.alertTxt, { color: a.color }]}>{a.label}</Text>
                        <Text style={[s.alertSub]}>{a.sub}</Text>
                      </View>
                      <ChevronRight size={12} color={a.color} />
                    </Pressable>
                  ))}
                </View>
              );
            })()}

            {/* ── 핵심 퀵액션 3버튼 ── */}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                style={({ pressed }) => [s.quickBtn, { opacity: pressed ? 0.82 : 1, backgroundColor: C.card }]}
                onPress={() => setShowRegister(true)}
              >
                <View style={[s.quickBtnIcon, { backgroundColor: "#E6FAF8" }]}>
                  <UserPlus size={18} color="#1D4ED8" />
                </View>
                <Text style={s.quickBtnLabel}>회원등록</Text>
                <Text style={s.quickBtnSub}>즉시 등록</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [s.quickBtn, { opacity: pressed ? 0.82 : 1, backgroundColor: C.card }]}
                onPress={() => router.push("/(admin)/admin-revenue?backTo=dashboard")}
              >
                <View style={[s.quickBtnIcon, { backgroundColor: "#FFFBEB" }]}>
                  <LucideIcon name="trending-up" size={18} color="#CA8A04" />
                </View>
                <Text style={s.quickBtnLabel}>매출 확인</Text>
                <Text style={[s.quickBtnSub, { color: "#CA8A04" }]}>{stats ? formatWon(stats.monthly_revenue ?? 0) : "—"}</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [s.quickBtn, { opacity: pressed ? 0.82 : 1, backgroundColor: C.card }]}
                onPress={() => router.push("/(admin)/classes?backTo=dashboard")}
              >
                <View style={[s.quickBtnIcon, { backgroundColor: "#F0FDF4" }]}>
                  <LucideIcon name="calendar" size={18} color="#16A34A" />
                </View>
                <Text style={s.quickBtnLabel}>스케줄러</Text>
                <Text style={s.quickBtnSub}>일정 관리</Text>
              </Pressable>
            </View>


          </>
        )}
      </ScrollView>

      {/* ── 검색 모달 ── */}
      <SearchModal visible={showSearch} onClose={() => setShowSearch(false)} token={token} />

      {/* ── 회원 퀵등록 모달 ── */}
      <AdminQuickRegisterModal
        visible={showRegister}
        token={token}
        poolName={pool?.name || ""}
        onClose={() => setShowRegister(false)}
        onSuccess={() => { fetchStats(); }}
      />

      {/* W: 설정 완료 축하 모달 */}
      <Modal visible={showCelebration} transparent animationType="fade" onRequestClose={() => setShowCelebration(false)}>
        <Pressable style={cel.overlay} onPress={() => setShowCelebration(false)}>
          <Pressable style={cel.sheet} onPress={e => e.stopPropagation()}>
            <Text style={cel.emoji}>🎉</Text>
            <Text style={cel.title}>준비 완료!</Text>
            <Text style={cel.sub}>학생, 선생님, 학부모가 모두 연결됐습니다.{"\n"}이제 스윔노트를 본격적으로 운영하세요.</Text>
            <Pressable
              style={[cel.btn, { backgroundColor: themeColor }]}
              onPress={() => setShowCelebration(false)}
            >
              <Text style={cel.btnTxt}>시작하기</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

    </View>
  );
}

const s = StyleSheet.create({
  topBar: {
    backgroundColor: "#fff",
    paddingHorizontal: 20,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  poolName:    { fontSize: 18, fontFamily: "Pretendard-Regular", color: C.text },
  greet:       { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  switchChip:  { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  switchChipTxt: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  subBadge:    { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  subBadgeTxt: { fontSize: 10, fontFamily: "Pretendard-Regular" },
  headerBtn:   { width: 36, height: 36, borderRadius: 10, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  tierBadge:   { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  tierBadgeTxt:{ fontSize: 10, fontFamily: "Pretendard-SemiBold" },
  roleChip:    { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: "#E0F2FE" },
  roleChipTxt: { fontSize: 10, fontFamily: "Pretendard-SemiBold", color: "#0369A1" },

  sectionLabel:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted, marginBottom: 10 },

  bannerGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  bannerCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 12,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  bannerWide: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  bannerIcon:  { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  bannerValue: { fontSize: 19, fontFamily: "Pretendard-Regular", marginBottom: 1 },
  bannerLabel: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text },
  bannerSub:   { fontSize: 10, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 1 },
  wideSubItem:   { alignItems: "center", gap: 2 },
  wideSubVal:    { fontSize: 17, fontFamily: "Pretendard-Regular" },
  wideSubLabel:  { fontSize: 10, fontFamily: "Pretendard-Regular", color: C.textMuted },
  wideSubDivider: { width: 1, height: 32, backgroundColor: C.border, alignSelf: "center" },

  alertCard: {
    backgroundColor: "#FFFBEB",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#FDE68A",
    gap: 6,
  },
  alertRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 8,
    padding: 8,
  },
  alertTxt: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text },
  alertSub: { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 1 },

  iconGrid:  { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  iconCell:  { alignItems: "center", gap: 8 },
  iconBox: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  iconLabel:   { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.text, textAlign: "center" },
  directBadge: { position: "absolute", bottom: 4, right: 4, width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  notiBadge:   { position: "absolute", top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: "#D96C6C", alignItems: "center", justifyContent: "center", paddingHorizontal: 4, borderWidth: 1.5, borderColor: "#F5F6FA" },
  notiBadgeTxt:{ color: "#fff", fontSize: 9, fontWeight: "700" },

  splitStatRow:    { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.card, borderRadius: 14, padding: 14, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  splitStatItem:   { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  splitStatIcon:   { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  splitStatNum:    { fontSize: 16, fontFamily: "Pretendard-Regular" },
  splitStatLabel:  { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 1 },
  splitStatDivider: { width: 1, height: 32, backgroundColor: C.border },

  quickBtn:          { flex: 1, borderRadius: 14, padding: 12, alignItems: "center", gap: 4, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  quickBtnIcon:      { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  quickBtnLabel:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text },
  quickBtnSub:       { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },
});

// B: 시작 가이드 마법사 스타일
const wz = StyleSheet.create({
  card:      { backgroundColor: "#EFF6FF", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#BFDBFE", gap: 4 },
  header:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 },
  title:     { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#1D4ED8" },
  sub:       { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B", marginBottom: 8 },
  step:      { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  stepBorder:{ borderBottomWidth: 1, borderBottomColor: "#BFDBFE" },
  stepIcon:  { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  stepLabel: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text, flex: 1 },
  stepDone:  { color: "#64748B", textDecorationLine: "line-through" },
  doneTag:   { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#16A34A", backgroundColor: "#D1FAE5", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
});

// W: 설정 완료 축하 스타일
const cel = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 32 },
  sheet:   { backgroundColor: "#fff", borderRadius: 24, padding: 28, width: "100%", alignItems: "center", gap: 12 },
  emoji:   { fontSize: 48 },
  title:   { fontSize: 22, fontFamily: "Pretendard-Regular", color: C.text },
  sub:     { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary, textAlign: "center", lineHeight: 22 },
  btn:     { marginTop: 8, width: "100%", height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  btnTxt:  { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" },
});
