/**
 * 관리자 홈 — 아이콘 기반 운영 OS 허브
 * 배너(4개 핵심 지표) + 메인 아이콘 8개(4×2 그리드)
 * 메신저 외 7개 아이콘은 3열 그리드 팝업을 거쳐 페이지 이동
 * SearchModal, AdminQuickRegisterModal → components/admin/ 로 이동됨
 */
import { ChevronRight, CircleAlert, LogOut, Repeat, Search, TriangleAlert, UserPlus, UserX } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Dimensions, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { useTabScrollReset } from "@/hooks/useTabScrollReset";
import { IconPopup, type PopupItem } from "@/components/admin/IconPopup";
import { PaymentBanner } from "@/components/common/PaymentBanner";
import { SearchModal } from "@/components/admin/SearchModal";
import { AdminQuickRegisterModal } from "@/components/admin/AdminQuickRegisterModal";

const C = Colors.light;
const SCREEN_W = Dimensions.get("window").width;
const TAB_BAR_H = Platform.OS === "web" ? 84 : Platform.OS === "android" ? 60 : 60;

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

// ── 아이콘 배경 (민트 유지) ───────────────────────────────────────────────────
const _IB = "#E6FAF8";

// ── 팝업 콘텐츠 정의 ─────────────────────────────────────────────────────────
type PopupKey = "운영관리" | "데이터관리";

function buildPopupItems(key: PopupKey, stats: any): PopupItem[] {
  const pending  = stats?.pending_requests ?? 0;
  const ib = _IB;

  switch (key) {
    case "운영관리": return [
      { icon: "users",       label: "회원 명부",     color: "#1D4ED8", bg: ib, onPress: () => router.push("/(admin)/members") },
      { icon: "user",        label: "학부모 계정",   color: "#DB2777", bg: ib, onPress: () => router.push("/(admin)/parents") },
      { icon: "user-check",  label: "선생님 관리",   color: "#16A34A", bg: ib, onPress: () => router.push("/(admin)/people-teachers") },
      { icon: "check-circle",label: "승인 관리",     color: "#16A34A", bg: ib, onPress: () => router.push("/(admin)/approvals"), badge: pending },
      { icon: "send",        label: "초대 기록",     color: "#7C3AED", bg: ib, onPress: () => router.push("/(admin)/invite-records") },
      { icon: "trending-up", label: "월별 매출",     color: "#CA8A04", bg: ib, onPress: () => router.push("/(admin)/admin-revenue") },
      { icon: "check-square",label: "정산 확인",     color: "#16A34A", bg: ib, onPress: () => router.push("/(admin)/settlement") },
    ];
    case "데이터관리": return [
      { icon: "rotate-ccw",  label: "백업·복구",     color: "#EA580C", bg: ib, onPress: () => router.push("/(admin)/recovery") },
      { icon: "pie-chart",   label: "저장 현황",     color: "#CA8A04", bg: ib, onPress: () => router.push("/(admin)/data-storage-overview") },
      { icon: "list",        label: "이벤트 기록",   color: "#0369A1", bg: ib, onPress: () => router.push("/(admin)/data-event-logs") },
      { icon: "archive",     label: "삭제·보존 정책",color: "#DC2626", bg: ib, onPress: () => router.push("/(admin)/data-delete") },
    ];
    default: return [];
  }
}

// ── 메인 홈 아이콘 정의 ───────────────────────────────────────────────────────
const IB = "#E6FAF8";

const MAIN_ICONS: Array<{
  key: PopupKey;
  label: string;
  icon: string;
  color: string;
  bg: string;
}> = [
  { key: "운영관리",  label: "운영관리",  icon: "briefcase",      color: "#1D4ED8", bg: IB },
];

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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [activePopup, setActivePopup] = useState<PopupKey | null>(null);
  const [switching, setSwitching] = useState(false);

  const lastPopupRef = useRef<PopupKey | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const [statsRes, storageRes, stats2Res, poolRes] = await Promise.all([
        apiRequest(token, "/admin/dashboard-stats"),
        apiRequest(token, "/admin/storage").catch(() => null),
        apiRequest(token, "/admin/dashboard-stats2").catch(() => null),
        apiRequest(token, "/pools/").catch(() => null),
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
    } finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  useFocusEffect(useCallback(() => {
    const popup = lastPopupRef.current;
    if (popup) {
      lastPopupRef.current = null;
      setActivePopup(popup);
    }
    fetchStats();
  }, [fetchStats]));

  const wrapPopupItems = useCallback((key: PopupKey, items: PopupItem[]): PopupItem[] =>
    items.map(item => ({
      ...item,
      onPress: () => { lastPopupRef.current = key; item.onPress(); },
    }))
  , []);

  // pool_admin이면 항상 선생님 모드 전환 가능 (자동 생성 구조 — 신규·기존 계정 모두 지원)
  const canSwitchToTeacher = adminUser?.role === "pool_admin" || !!(adminUser?.roles?.includes("teacher"));

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

  function handleIconPress(key: PopupKey) {
    setActivePopup(key);
  }

  const iconCellW = (SCREEN_W - 32 - 2 * 16) / 3;

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
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
            <Text style={s.greet}>{pool?.name ? `${pool.name} 관리자` : (adminUser?.name ?? "관리자")}</Text>
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

        {loading ? (
          <ActivityIndicator color={themeColor} size="large" style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* ── 운영 현황 카드 ── */}
            <View style={{ gap: 8 }}>
              <Text style={s.sectionLabel}>운영 현황</Text>

              {/* 1행: 이번 달 매출 + 전체 회원 */}
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable
                  style={({ pressed }) => [s.bannerCard, { flex: 1, opacity: pressed ? 0.85 : 1 }]}
                  onPress={() => router.push("/(admin)/admin-revenue")}
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
                  onPress={() => router.push("/(admin)/members")}
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

              {/* 2행: 보강 상태 (full-width) */}
              <Pressable
                style={({ pressed }) => [s.bannerWide, { opacity: pressed ? 0.85 : 1 }]}
                onPress={() => router.push("/(admin)/makeups")}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <View style={[s.bannerIcon, { backgroundColor: _BIB }]}>
                    <LucideIcon name="rotate-ccw" size={18} color="#EA580C" />
                  </View>
                  <Text style={s.bannerLabel}>보강 상태</Text>
                </View>
                <View style={{ flexDirection: "row", gap: 12 }}>
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

              {/* 3행: 통합 사용량 (full-width, 3지표) */}
              <Pressable
                style={({ pressed }) => [s.bannerWide, { opacity: pressed ? 0.85 : 1 }]}
                onPress={() => router.push("/(admin)/data-storage-overview")}
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
              <Pressable style={s.splitStatRow} onPress={() => router.push("/(admin)/members")}>
                <View style={s.splitStatItem}>
                  <View style={[s.splitStatIcon, { backgroundColor: "#E6FAF8" }]}>
                    <CircleAlert size={14} color="#0F172A" />
                  </View>
                  <View>
                    <Text style={[s.splitStatNum, { color: C.text }]}>{stats.unassigned ?? 0}명</Text>
                    <Text style={s.splitStatLabel}>수업 미배정</Text>
                  </View>
                </View>
                <View style={s.splitStatDivider} />
                <View style={s.splitStatItem}>
                  <View style={[s.splitStatIcon, { backgroundColor: "#E6FAF8" }]}>
                    <UserX size={14} color="#0F172A" />
                  </View>
                  <View>
                    <Text style={[s.splitStatNum, { color: C.text }]}>{stats.unlinked_members ?? 0}명</Text>
                    <Text style={s.splitStatLabel}>학부모미연결</Text>
                  </View>
                </View>
                <ChevronRight size={14} color={C.textMuted} style={{ marginLeft: "auto" }} />
              </Pressable>
            )}

            {/* ── 처리 필요 알림 ── */}
            {stats && (stats.pending_requests > 0 || (stats.pending_makeups ?? 0) > 0) && (
              <View style={s.alertCard}>
                <TriangleAlert size={15} color="#D97706" />
                <View style={{ flex: 1, gap: 4 }}>
                  {stats.pending_requests > 0 && (
                    <Pressable onPress={() => router.push("/(admin)/approvals")}>
                      <Text style={s.alertTxt}>
                        승인 대기 <Text style={{ fontWeight: "700", color: "#D97706" }}>{stats.pending_requests}건</Text> — 탭하여 처리
                      </Text>
                    </Pressable>
                  )}
                  {(stats.pending_makeups ?? 0) > 0 && (
                    <Pressable onPress={() => router.push("/(admin)/makeups")}>
                      <Text style={s.alertTxt}>
                        보강 미처리 <Text style={{ fontWeight: "700", color: "#D96C6C" }}>{stats.pending_makeups}건</Text> — 탭하여 처리
                      </Text>
                    </Pressable>
                  )}
                </View>
              </View>
            )}

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
                onPress={() => router.push("/(admin)/admin-revenue")}
              >
                <View style={[s.quickBtnIcon, { backgroundColor: "#FFFBEB" }]}>
                  <LucideIcon name="trending-up" size={18} color="#CA8A04" />
                </View>
                <Text style={s.quickBtnLabel}>매출 확인</Text>
                <Text style={[s.quickBtnSub, { color: "#CA8A04" }]}>{stats ? formatWon(stats.monthly_revenue ?? 0) : "—"}</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [s.quickBtn, { opacity: pressed ? 0.82 : 1, backgroundColor: C.card }]}
                onPress={() => router.push("/(admin)/classes")}
              >
                <View style={[s.quickBtnIcon, { backgroundColor: "#F0FDF4" }]}>
                  <LucideIcon name="calendar" size={18} color="#16A34A" />
                </View>
                <Text style={s.quickBtnLabel}>스케줄러</Text>
                <Text style={s.quickBtnSub}>일정 관리</Text>
              </Pressable>
            </View>

            {/* ── 관리 메뉴 ── */}
            <View>
              <Text style={s.sectionLabel}>관리 메뉴</Text>
              <View style={s.iconGrid}>
                {/* 팝업 아이콘들 */}
                {MAIN_ICONS.map(item => (
                  <Pressable
                    key={item.key}
                    style={({ pressed }) => [s.iconCell, { width: iconCellW, opacity: pressed ? 0.7 : 1 }]}
                    onPress={() => handleIconPress(item.key)}
                  >
                    <View style={[s.iconBox, { backgroundColor: item.bg }]}>
                      <LucideIcon name={item.icon} size={26} color={item.color} />
                      {item.key === "운영관리" && (stats?.pending_requests ?? 0) > 0 && (
                        <View style={s.notiBadge}>
                          <Text style={s.notiBadgeTxt}>{stats!.pending_requests}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={s.iconLabel}>{item.label}</Text>
                  </Pressable>
                ))}
              </View>
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

      {/* ── 팝업들 ── */}
      {(["운영관리", "데이터관리"] as PopupKey[]).map(key => (
        <IconPopup
          key={key}
          visible={activePopup === key}
          title={key}
          items={wrapPopupItems(key, buildPopupItems(key, stats))}
          onClose={() => setActivePopup(null)}
        />
      ))}
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
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "#FFFBEB",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  alertTxt: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text },

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
