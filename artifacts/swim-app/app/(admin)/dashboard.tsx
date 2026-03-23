/**
 * 관리자 홈 — 아이콘 기반 운영 OS 허브
 * 배너(4개 핵심 지표) + 메인 아이콘 8개(4×2 그리드)
 * 메신저 외 7개 아이콘은 3열 그리드 팝업을 거쳐 페이지 이동
 */
import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Dimensions, Modal, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { useTabScrollReset } from "@/hooks/useTabScrollReset";
import { IconPopup, type PopupItem } from "@/components/admin/IconPopup";
import { PaymentBanner } from "@/components/common/PaymentBanner";

const C = Colors.light;
const SCREEN_W = Dimensions.get("window").width;
const TAB_BAR_H = Platform.OS === "web" ? 84 : Platform.OS === "android" ? 56 : 49;

function formatWon(n: number) {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1).replace(/\.0$/, "") + "억원";
  if (n >= 10_000) return Math.floor(n / 10_000) + "만원";
  return n.toLocaleString("ko-KR") + "원";
}

const STATUS_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  trial:           { label: "체험 중",   color: "#7C3AED", bg: "#F3E8FF" },
  active:          { label: "구독 중",   color: "#1F8F86", bg: "#DDF2EF" },
  expired:         { label: "만료됨",    color: "#6F6B68", bg: "#F6F3F1" },
  suspended:       { label: "정지됨",    color: "#D97706", bg: "#FFF1BF" },
  cancelled:       { label: "해지됨",    color: "#D96C6C", bg: "#F9DEDA" },
  payment_failed:  { label: "결제 실패", color: "#DC2626", bg: "#FEE2E2" },
  pending_deletion:{ label: "삭제 예약", color: "#9B1C1C", bg: "#FEE2E2" },
  deleted:         { label: "삭제됨",    color: "#6F6B68", bg: "#E5E7EB" },
};

// ── 검색 모달 (기존 로직 유지) ──────────────────────────────────────────────
function SearchModal({ visible, onClose, token }: { visible: boolean; onClose: () => void; token: string | null }) {
  const [q, setQ] = useState("");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const debounce = useRef<any>(null);

  useEffect(() => { if (!visible) { setQ(""); setResult(null); } }, [visible]);

  function handleChange(text: string) {
    setQ(text);
    if (debounce.current) clearTimeout(debounce.current);
    if (text.trim().length < 1) { setResult(null); return; }
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await apiRequest(token, `/admin/search?q=${encodeURIComponent(text)}`);
        if (res.ok) setResult(await res.json());
      } finally { setLoading(false); }
    }, 300);
  }

  const total = result
    ? (result.students?.length ?? 0) + (result.teachers?.length ?? 0) + (result.classes?.length ?? 0) + (result.notices?.length ?? 0)
    : 0;

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={sm.container}>
        <View style={sm.header}>
          <View style={sm.searchBar}>
            <Feather name="search" size={18} color={C.textMuted} />
            <TextInput style={sm.input} placeholder="회원, 반, 선생님, 공지 검색..." placeholderTextColor={C.textMuted}
              value={q} onChangeText={handleChange} autoFocus returnKeyType="search" />
            {q.length > 0 && (
              <Pressable onPress={() => { setQ(""); setResult(null); }}>
                <Feather name="x-circle" size={16} color={C.textMuted} />
              </Pressable>
            )}
          </View>
          <Pressable onPress={onClose} style={sm.closeBtn}>
            <Text style={{ color: C.tint, fontSize: 15, fontFamily: "Inter_600SemiBold" }}>취소</Text>
          </Pressable>
        </View>
        {loading ? (
          <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} />
        ) : result ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 60 }}>
            {total === 0 ? (
              <View style={sm.empty}><Feather name="search" size={40} color={C.textMuted} /><Text style={sm.emptyText}>검색 결과가 없습니다</Text></View>
            ) : (
              <>
                {(result.students ?? []).length > 0 && (
                  <View>
                    <Text style={sm.sectionLabel}>회원 ({result.students.length})</Text>
                    {result.students.map((s: any) => (
                      <Pressable key={s.id} style={sm.row} onPress={() => { onClose(); router.push({ pathname: "/(admin)/member-detail", params: { id: s.id } }); }}>
                        <View style={[sm.avatar, { backgroundColor: C.tint + "20" }]}><Text style={[sm.avatarText, { color: C.tint }]}>{s.name[0]}</Text></View>
                        <View style={{ flex: 1 }}><Text style={sm.rowTitle}>{s.name}</Text><Text style={sm.rowSub}>{s.class_name || "미배정"}</Text></View>
                        <Feather name="chevron-right" size={16} color={C.textMuted} />
                      </Pressable>
                    ))}
                  </View>
                )}
                {(result.classes ?? []).length > 0 && (
                  <View>
                    <Text style={sm.sectionLabel}>반 ({result.classes.length})</Text>
                    {result.classes.map((c: any) => (
                      <Pressable key={c.id} style={sm.row} onPress={() => { onClose(); router.push("/(admin)/classes"); }}>
                        <View style={[sm.avatar, { backgroundColor: "#7C3AED20" }]}><Feather name="layers" size={16} color="#7C3AED" /></View>
                        <View style={{ flex: 1 }}><Text style={sm.rowTitle}>{c.name}</Text><Text style={sm.rowSub}>{c.schedule_days}</Text></View>
                        <Feather name="chevron-right" size={16} color={C.textMuted} />
                      </Pressable>
                    ))}
                  </View>
                )}
                {(result.notices ?? []).length > 0 && (
                  <View>
                    <Text style={sm.sectionLabel}>공지 ({result.notices.length})</Text>
                    {result.notices.map((n: any) => (
                      <Pressable key={n.id} style={sm.row} onPress={() => { onClose(); router.push("/(admin)/community"); }}>
                        <View style={[sm.avatar, { backgroundColor: "#D9770620" }]}><Feather name="bell" size={16} color="#D97706" /></View>
                        <View style={{ flex: 1 }}><Text style={sm.rowTitle}>{n.title}</Text></View>
                        <Feather name="chevron-right" size={16} color={C.textMuted} />
                      </Pressable>
                    ))}
                  </View>
                )}
                {(result.teachers ?? []).length > 0 && (
                  <View>
                    <Text style={sm.sectionLabel}>선생님 ({result.teachers.length})</Text>
                    {result.teachers.map((t: any) => (
                      <View key={t.id} style={sm.row}>
                        <View style={[sm.avatar, { backgroundColor: "#1F8F8620" }]}><Feather name="user" size={16} color="#1F8F86" /></View>
                        <View style={{ flex: 1 }}><Text style={sm.rowTitle}>{t.name}</Text><Text style={sm.rowSub}>{t.phone || "연락처 없음"}</Text></View>
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}
          </ScrollView>
        ) : (
          <View style={sm.empty}><Feather name="search" size={50} color={C.border} /><Text style={sm.emptyText}>이름, 반 이름, 공지 제목으로 검색</Text></View>
        )}
      </View>
    </Modal>
  );
}

const sm = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background, paddingTop: Platform.OS === "ios" ? 58 : 24 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 10, marginBottom: 8 },
  searchBar: { flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: C.card, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, gap: 10, borderWidth: 1, borderColor: C.border },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", color: C.text },
  closeBtn: { paddingHorizontal: 4 },
  sectionLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.textMuted, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#FBF8F6" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border },
  avatar: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  rowTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: C.text },
  rowSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  empty: { alignItems: "center", paddingVertical: 60, gap: 12 },
  emptyText: { fontSize: 15, fontFamily: "Inter_400Regular", color: C.textMuted },
});

// ── 팝업 콘텐츠 정의 ─────────────────────────────────────────────────────────
// 5대 카테고리: 운영관리·수업관리·보강관리·매출관리·데이터관리·수업설정·운영설정
type PopupKey = "운영관리" | "수업관리" | "보강관리" | "매출관리" | "데이터관리" | "수업설정" | "운영설정";

function buildPopupItems(key: PopupKey, stats: any): PopupItem[] {
  const pending  = stats?.pending_requests ?? 0;
  const makeups  = stats?.pending_makeups ?? 0;

  switch (key) {
    // ─ 운영 관리: 인원 + 구독/결제 통합 ─
    case "운영관리": return [
      { icon: "users",       label: "회원 명부",   color: "#1F8F86", bg: "#DDF2EF", onPress: () => router.push("/(admin)/members") },
      { icon: "user",        label: "학부모 계정",  color: "#1F8F86", bg: "#DFF3EC", onPress: () => router.push("/(admin)/parents") },
      { icon: "user-check",  label: "선생님 관리",  color: "#7C3AED", bg: "#EEDDF5", onPress: () => router.push("/(admin)/people-teachers") },
      { icon: "check-circle",label: "승인 관리",   color: "#D96C6C", bg: "#FEF2F2", onPress: () => router.push("/(admin)/approvals"), badge: pending },
      { icon: "send",        label: "초대 안내 기록", color: "#1F8F86", bg: "#ECFEFF", onPress: () => router.push("/(admin)/invite-records") },
      { icon: "credit-card", label: "결제·구독",   color: "#D97706", bg: "#FFFBEB", onPress: () => router.push("/(admin)/billing") },
      { icon: "hard-drive",  label: "추가 용량",   color: "#1F8F86", bg: "#DFF3EC", onPress: () => router.push("/(admin)/extra-storage") },
      { icon: "trending-up", label: "매출 관리",   color: "#EA580C", bg: "#FFF1BF", onPress: () => router.push("/(admin)/admin-revenue") },
    ];
    // ─ 수업 관리 ─
    case "수업관리": return [
      { icon: "calendar",    label: "수업 스케줄",  color: "#1F8F86", bg: "#DDF2EF", onPress: () => router.push("/(admin)/classes") },
      { icon: "layers",      label: "반 관리",     color: "#7C3AED", bg: "#EEDDF5", onPress: () => router.push("/(admin)/class-management") },
      { icon: "clipboard",   label: "출결 관리",   color: "#1F8F86", bg: "#DFF3EC", onPress: () => router.push("/(admin)/attendance") },
      { icon: "book",        label: "수업 일지",   color: "#D97706", bg: "#FFFBEB", onPress: () => router.push("/(admin)/diary-teacher-entries") },
      { icon: "users",       label: "수강생 관리",  color: "#1F8F86", bg: "#ECFEFF", onPress: () => router.push("/(admin)/members") },
      { icon: "shuffle",     label: "반 이동",     color: "#D96C6C", bg: "#FEF2F2", onPress: () => router.push("/(admin)/class-management") },
    ];
    // ─ 보강 관리 ─
    case "보강관리": return [
      { icon: "clock",       label: "보강 대기",   color: "#D96C6C", bg: "#FEF2F2", onPress: () => router.push("/(admin)/makeups"), badge: makeups },
      { icon: "plus-circle", label: "보강 배정",   color: "#1F8F86", bg: "#DDF2EF", onPress: () => router.push("/(admin)/makeups") },
      { icon: "bar-chart-2", label: "보강 현황",   color: "#1F8F86", bg: "#DFF3EC", onPress: () => router.push("/(admin)/makeups") },
    ];
    // ─ 매출 관리 ─
    case "매출관리": return [
      { icon: "trending-up", label: "월별 매출",   color: "#1F8F86", bg: "#DFF3EC", onPress: () => router.push("/(admin)/admin-revenue") },
      { icon: "check-square",label: "정산 확인",   color: "#7C3AED", bg: "#EEDDF5", onPress: () => router.push("/(admin)/settlement") },
      { icon: "calendar",    label: "휴무일 관리",  color: "#1F8F86", bg: "#ECFEFF", onPress: () => router.push("/(admin)/holidays") },
    ];
    // ─ 데이터 관리: 백업·복구 + 저장공간 + 삭제·보존 통합 ─
    case "데이터관리": return [
      { icon: "rotate-ccw",  label: "백업·복구",   color: "#D96C6C", bg: "#F9DEDA", onPress: () => router.push("/(admin)/recovery") },
      { icon: "list",        label: "이벤트 기록",  color: "#D97706", bg: "#FFFBEB", onPress: () => router.push("/(admin)/data-event-logs") },
      { icon: "pie-chart",   label: "저장공간 현황", color: "#1F8F86", bg: "#ECFEFF", onPress: () => router.push("/(admin)/data-storage-overview") },
      { icon: "users",       label: "계정별 사용량", color: "#1F8F86", bg: "#DDF2EF", onPress: () => router.push("/(admin)/data-storage-by-account") },
      { icon: "bar-chart-2", label: "카테고리별\n사용량", color: "#7C3AED", bg: "#EEDDF5", onPress: () => router.push("/(admin)/data-storage-by-category") },
      { icon: "archive",     label: "삭제·보존\n정책", color: "#6F6B68", bg: "#F6F3F1", onPress: () => router.push("/(admin)/data-delete") },
    ];
    // ─ 수업 설정 (기존 운영설정 → 이름 변경, 수업 기준/정책만) ─
    case "수업설정": return [
      { icon: "settings",    label: "수업운영\n설정",  color: "#1F8F86", bg: "#DDF2EF", onPress: () => router.push("/(admin)/pool-settings") },
      { icon: "refresh-cw",  label: "보강정책\n설정",  color: "#7C3AED", bg: "#EEDDF5", onPress: () => router.push("/(admin)/makeup-policy") },
      { icon: "shield",      label: "권한 설정",    color: "#D97706", bg: "#FFFBEB", onPress: () => router.push("/(admin)/admin-grant") },
      { icon: "bell",        label: "알림 설정",    color: "#1F8F86", bg: "#DFF3EC", onPress: () => router.push("/(admin)/notifications") },
      { icon: "award",       label: "레벨/테스트\n설정", color: "#1F8F86", bg: "#ECFEFF", onPress: () => router.push("/(admin)/level-settings" as any) },
      { icon: "message-circle", label: "피드백\n기본설정", color: "#D96C6C", bg: "#FEF2F2", onPress: () => router.push("/(admin)/pool-settings") },
    ];
    // ─ 운영 설정 (기존 플랫폼설정 → 이름 변경, 브랜드/인프라만) ─
    case "운영설정": return [
      { icon: "sliders",     label: "브랜드 설정",  color: "#EC4899", bg: "#F6D8E1", onPress: () => router.push("/(admin)/branding") },
      { icon: "tag",         label: "화이트라벨",   color: "#7C3AED", bg: "#EEDDF5", onPress: () => router.push("/(admin)/white-label" as any) },
      { icon: "layers",      label: "수영장 관리",  color: "#0D9488", bg: "#CCFBF1", onPress: () => router.push("/(admin)/branches") },
      { icon: "settings",    label: "수영장 설정",  color: "#6F6B68", bg: "#F6F3F1", onPress: () => router.push("/(admin)/pool-settings") },
      { icon: "file-text",   label: "공지사항",     color: "#7C3AED", bg: "#EEDDF5", onPress: () => router.push("/(admin)/notices") },
      { icon: "users",       label: "초대방식\n설정", color: "#1F8F86", bg: "#DFF3EC", onPress: () => router.push("/(admin)/invite-sms") },
    ];
    default: return [];
  }
}

// ── 메인 홈 아이콘 정의 ──────────────────────────────────────────────────────
const MAIN_ICONS: Array<{
  key: PopupKey | "메신저";
  label: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  color: string;
  bg: string;
}> = [
  { key: "운영관리",  label: "운영 관리",  icon: "briefcase",    color: "#1F8F86", bg: "#DDF2EF" },
  { key: "수업관리",  label: "수업 관리",  icon: "calendar",     color: "#7C3AED", bg: "#EEDDF5" },
  { key: "보강관리",  label: "보강 관리",  icon: "rotate-ccw",   color: "#D96C6C", bg: "#FEF2F2" },
  { key: "메신저",    label: "메신저",     icon: "message-circle",color: "#1F8F86", bg: "#DFF3EC" },
  { key: "매출관리",  label: "매출 관리",  icon: "trending-up",  color: "#D97706", bg: "#FFFBEB" },
  { key: "데이터관리",label: "데이터 관리",icon: "hard-drive",   color: "#1F8F86", bg: "#ECFEFF" },
  { key: "수업설정",  label: "수업 설정",  icon: "settings",     color: "#EA580C", bg: "#FFF1BF" },
  { key: "운영설정",  label: "운영 설정",  icon: "sliders",      color: "#6F6B68", bg: "#FBF8F6" },
];

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export default function DashboardScreen() {
  const { adminUser, pool, logout, token, switchRole, setLastUsedRole } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();
  const scrollRef = useTabScrollReset("dashboard");

  const [stats, setStats] = useState<any>(null);
  const [storagePct, setStoragePct] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [activePopup, setActivePopup] = useState<PopupKey | null>(null);
  const [switching, setSwitching] = useState(false);

  // 팝업 → 하위 화면 진입 시 어느 팝업에서 왔는지 기억해 뒤로 복귀 때 복원
  const lastPopupRef = useRef<PopupKey | null>(null);

  useFocusEffect(useCallback(() => {
    const popup = lastPopupRef.current;
    if (popup) {
      lastPopupRef.current = null;
      setActivePopup(popup);
    }
  }, []));

  // 팝업 아이템의 onPress를 래핑해 팝업 키를 기억한 뒤 화면 이동
  const wrapPopupItems = useCallback((key: PopupKey, items: PopupItem[]): PopupItem[] =>
    items.map(item => ({
      ...item,
      onPress: () => { lastPopupRef.current = key; item.onPress(); },
    }))
  , []);

  // 관리자 계정은 항상 선생님으로 전환 가능 (switch-role이 teacher 자동 추가)
  const canSwitchToTeacher = true;

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

  const fetchStats = useCallback(async () => {
    try {
      const [statsRes, storageRes] = await Promise.all([
        apiRequest(token, "/admin/dashboard-stats"),
        apiRequest(token, "/admin/storage").catch(() => null),
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (storageRes?.ok) {
        const s = await storageRes.json();
        const quota = s.quota_bytes ?? 5 * 1024 ** 3;
        setStoragePct(quota > 0 ? Math.min(100, Math.round((s.total_bytes / quota) * 1000) / 10) : 0);
      }
    } finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const sub = STATUS_BADGE[pool?.subscription_status || "trial"];

  // 4개 배너 KPI
  const bannerItems = [
    {
      label: "데이터 사용량",
      value: storagePct !== null ? `${storagePct}%` : "—",
      sub: "전체 저장공간",
      icon: "hard-drive" as const,
      color: "#1F8F86",
      bg: "#ECFEFF",
      onPress: () => router.push("/(admin)/data-storage-overview"),
    },
    {
      label: "이번 달 매출",
      value: stats ? formatWon(stats.monthly_revenue ?? 0) : "—",
      sub: "월 누적 매출",
      icon: "trending-up" as const,
      color: "#1F8F86",
      bg: "#DFF3EC",
      onPress: () => router.push("/(admin)/admin-revenue"),
    },
    {
      label: "전체 회원",
      value: stats ? String(stats.total_members) : "—",
      sub: "등록 회원 수",
      icon: "users" as const,
      color: themeColor,
      bg: themeColor + "18",
      onPress: () => router.push("/(admin)/members"),
    },
    {
      label: "미처리 보강",
      value: stats ? String(stats.pending_makeups ?? 0) : "—",
      sub: "처리 필요",
      icon: "rotate-ccw" as const,
      color: "#D96C6C",
      bg: "#FEF2F2",
      onPress: () => router.push("/(admin)/makeups"),
    },
  ];

  function handleIconPress(key: PopupKey | "메신저") {
    if (key === "메신저") {
      router.push("/(admin)/messenger");
    } else {
      setActivePopup(key);
    }
  }

  const iconCellW = (SCREEN_W - 32 - 3 * 16) / 4; // 4열 기준 (gap:16, px:16)

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
                  { borderColor: "#1F8F86" + "50", backgroundColor: "#DDF2EF", opacity: pressed || switching ? 0.7 : 1 },
                ]}
                onPress={handleSwitchToTeacher}
                disabled={switching}
              >
                {switching
                  ? <ActivityIndicator size="small" color="#1F8F86" />
                  : <>
                      <Feather name="repeat" size={10} color="#1F8F86" />
                      <Text style={[s.switchChipTxt, { color: "#1F8F86" }]}>선생님으로 전환</Text>
                    </>
                }
              </Pressable>
            )}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
            <Text style={s.greet}>안녕하세요, {adminUser?.name}님</Text>
            {sub && (
              <View style={[s.subBadge, { backgroundColor: sub.bg }]}>
                <Text style={[s.subBadgeTxt, { color: sub.color }]}>{sub.label}</Text>
              </View>
            )}
          </View>
        </View>
        <Pressable onPress={() => setShowSearch(true)} style={s.headerBtn} hitSlop={8}>
          <Feather name="search" size={20} color={C.textSecondary} />
        </Pressable>
        <Pressable onPress={logout} style={s.headerBtn} hitSlop={8}>
          <Feather name="log-out" size={18} color={C.textSecondary} />
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
            {/* ── 배너: 4개 KPI 2×2 그리드 ── */}
            <View>
              <Text style={s.sectionLabel}>운영 현황</Text>
              <View style={s.bannerGrid}>
                {bannerItems.map(b => (
                  <Pressable
                    key={b.label}
                    style={({ pressed }) => [s.bannerCard, { opacity: pressed ? 0.85 : 1 }]}
                    onPress={b.onPress}
                  >
                    <View style={[s.bannerIcon, { backgroundColor: b.bg }]}>
                      <Feather name={b.icon} size={18} color={b.color} />
                    </View>
                    <Text style={[s.bannerValue, { color: b.color }]}>{b.value}</Text>
                    <Text style={s.bannerLabel}>{b.label}</Text>
                    <Text style={s.bannerSub}>{b.sub}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* ── 처리 필요 알림 ── */}
            {stats && (stats.pending_requests > 0 || (stats.pending_makeups ?? 0) > 0) && (
              <View style={s.alertCard}>
                <Feather name="alert-triangle" size={15} color="#D97706" />
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

            {/* ── 메인 아이콘 8개 (4×2 그리드) ── */}
            <View>
              <Text style={s.sectionLabel}>관리 메뉴</Text>
              <View style={s.iconGrid}>
                {MAIN_ICONS.map(item => (
                  <Pressable
                    key={item.key}
                    style={({ pressed }) => [s.iconCell, { width: iconCellW, opacity: pressed ? 0.7 : 1 }]}
                    onPress={() => handleIconPress(item.key)}
                  >
                    <View style={[s.iconBox, { backgroundColor: item.bg }]}>
                      <Feather name={item.icon} size={26} color={item.color} />
                      {/* 메신저 예외: 직접 이동 표시 */}
                      {item.key === "메신저" && (
                        <View style={[s.directBadge, { backgroundColor: item.color }]}>
                          <Feather name="arrow-right" size={8} color="#fff" />
                        </View>
                      )}
                      {/* 보강 대기 배지 */}
                      {item.key === "보강관리" && (stats?.pending_makeups ?? 0) > 0 && (
                        <View style={s.notiBadge}>
                          <Text style={s.notiBadgeTxt}>{stats.pending_makeups}</Text>
                        </View>
                      )}
                      {/* 승인 대기 배지 */}
                      {item.key === "운영관리" && (stats?.pending_requests ?? 0) > 0 && (
                        <View style={s.notiBadge}>
                          <Text style={s.notiBadgeTxt}>{stats.pending_requests}</Text>
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

      {/* ── 팝업들 (7개, 메신저 제외) ── */}
      {(["운영관리", "수업관리", "보강관리", "매출관리", "데이터관리", "수업설정", "운영설정"] as PopupKey[]).map(key => (
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
  poolName:    { fontSize: 18, fontFamily: "Inter_700Bold", color: C.text },
  greet:       { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary },
  switchChip:  { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  switchChipTxt: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  subBadge:    { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  subBadgeTxt: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  headerBtn:   { width: 36, height: 36, borderRadius: 10, backgroundColor: "#F6F3F1", alignItems: "center", justifyContent: "center" },

  sectionLabel:  { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textMuted, marginBottom: 10 },
  sectionLabel2: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textMuted, marginBottom: 12 },

  bannerGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  bannerCard: {
    width: "47.5%",
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 10,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  bannerIcon:  { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  bannerValue: { fontSize: 19, fontFamily: "Inter_700Bold", marginBottom: 1 },
  bannerLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.text },
  bannerSub:   { fontSize: 10, fontFamily: "Inter_400Regular", color: C.textMuted, marginTop: 1 },

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
  alertTxt: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.text },

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
  iconLabel:   { fontSize: 11, fontFamily: "Inter_600SemiBold", color: C.text, textAlign: "center" },
  directBadge: { position: "absolute", bottom: 4, right: 4, width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  notiBadge:   { position: "absolute", top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: "#D96C6C", alignItems: "center", justifyContent: "center", paddingHorizontal: 4, borderWidth: 1.5, borderColor: "#F5F6FA" },
  notiBadgeTxt:{ color: "#fff", fontSize: 9, fontWeight: "700" },

  statCard: { backgroundColor: "#fff", borderRadius: 16, padding: 16, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  statRow:  { flexDirection: "row", alignItems: "center" },
  statItem: { flex: 1, alignItems: "center", paddingVertical: 4 },
  statNum:  { fontSize: 22, fontFamily: "Inter_700Bold" },
  statName: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  statDivider: { width: 1, height: 36, backgroundColor: C.border },
});
