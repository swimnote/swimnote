/**
 * (admin)/x-hub.tsx — SWIMNOTE X 운영현황 (WP11)
 *
 * API: GET /api/admin/x-hub/summary
 * Response contract (WP11):
 *   plan    — X 플랜 정보 (실시간)
 *   monthly — 이번 달 AI 활용 (snapshot + live)
 *   live    — 실시간 운영현황
 *   storage — 저장공간
 *   period  — { year, month }
 *   unavailable — 실패한 metric 목록 (null 표시)
 *
 * null = metric unavailable (API 실패 또는 WP 미구현)
 * 0   = 정상 결과 0건
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
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { LucideIcon } from "@/components/common/LucideIcon";

const C = Colors.light;
const SCREEN_TITLE = "SWIMNOTE X 운영현황";

// ─── 타입 ────────────────────────────────────────────────────────────────────
interface PlanInfo {
  enabled:             boolean | null;
  subscription_status: string  | null;
  tier_key:            string  | null;
  tier_label:          string  | null;
  started_at:          string  | null;
  expires_at:          string  | null;
}
interface MonthlyKpi {
  parent_curriculum_search_count: number | null;
  parent_curriculum_user_count:   number | null;
  ai_diary_count:                 null;   // WP9 전까지 항상 null
  ai_diary_teacher_count:         null;
  growth_report_sent_count:       number | null;
  growth_report_pending_count:    number | null;
}
interface LiveKpi {
  diaries_today:                number | null;
  growth_events_week:           number | null;
  curriculum_assigned_students: number | null;
  unassigned_students:          number | null;
  active_students:              number | null;
  active_teachers:              number | null;
  connected_parents:            number | null;
  ai_calls_month:               number | null;
}
interface StorageInfo {
  total_bytes: number | null;
  quota_bytes: number | null;
  used_pct:    number | null;
  tier:        string | null;
}
interface HubData {
  plan:        PlanInfo;
  monthly:     MonthlyKpi;
  live:        LiveKpi;
  storage:     StorageInfo;
  period:      { year: number; month: number };
  unavailable: string[];
}

// ─── 유틸 ────────────────────────────────────────────────────────────────────
function fmtDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  return `${dt.getFullYear()}.${String(dt.getMonth() + 1).padStart(2,"0")}.${String(dt.getDate()).padStart(2,"0")}`;
}
function fmtBytes(bytes: number): string {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3)   return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
/** null → "—", number → 천단위 포맷 */
function fmtNum(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString();
}

const SUBSCRIPTION_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  ACTIVE:               { label: "활성",     color: "#059669", bg: "#ECFDF5" },
  CANCELLED_BUT_ACTIVE: { label: "취소 예약", color: "#D97706", bg: "#FFFBEB" },
  BILLING_ISSUE:        { label: "결제 오류", color: "#DC2626", bg: "#FEF2F2" },
  EXPIRED:              { label: "만료됨",   color: "#6B7280", bg: "#F3F4F6" },
  UNKNOWN:              { label: "미확인",   color: "#6B7280", bg: "#F3F4F6" },
};

// ─── 서브 컴포넌트 ────────────────────────────────────────────────────────────
function SectionLabel({ title, sub }: { title: string; sub?: string }) {
  return (
    <Text style={s.sectionLabel}>
      {title}{sub ? <Text style={s.sectionLabelSub}>{sub}</Text> : null}
    </Text>
  );
}

function KpiRow({
  icon, iconBg, iconColor, label, value, onPress,
}: {
  icon: any; iconBg: string; iconColor: string;
  label: string; value: string; onPress?: () => void;
}) {
  const Inner = (
    <View style={s.kpiRow}>
      <View style={[s.kpiIcon, { backgroundColor: iconBg }]}>
        <LucideIcon name={icon} size={14} color={iconColor} />
      </View>
      <Text style={s.kpiLabel}>{label}</Text>
      <Text style={s.kpiValue}>{value}</Text>
      {onPress && <LucideIcon name="chevron-right" size={14} color={C.textSecondary} />}
    </View>
  );
  return onPress
    ? <Pressable onPress={onPress}>{Inner}</Pressable>
    : Inner;
}

// ─── 메인 컴포넌트 ───────────────────────────────────────────────────────────
export default function XHubScreen() {
  const { token } = useAuth();
  const router    = useRouter();

  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [data,    setData]    = useState<HubData | null>(null);

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const res = await apiRequest(token, "/admin/x-hub/summary");
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error || "조회 실패");
      }
      setData(await res.json());
    } catch (e: any) {
      setError(e?.message || "운영현황을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ─── 로딩 ───────────────────────────────────────────────────────────────
  if (loading) return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title={SCREEN_TITLE} homePath="/(admin)/dashboard" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {[1,2,3,4].map(i => (
          <View key={i} style={[s.card, { opacity: 0.3 }]}>
            <View style={{ height: 12, width: 80, backgroundColor: C.border, borderRadius: 6, marginBottom: 14 }} />
            <View style={{ height: 20, width: "55%", backgroundColor: C.border, borderRadius: 6, marginBottom: 10 }} />
            <View style={{ height: 20, width: "40%", backgroundColor: C.border, borderRadius: 6 }} />
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );

  // ─── 전체 오류 ───────────────────────────────────────────────────────────
  if (error || !data) return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title={SCREEN_TITLE} homePath="/(admin)/dashboard" />
      <View style={s.errorFull}>
        <LucideIcon name="alert-circle" size={32} color={C.error} />
        <Text style={s.errorText}>{error ?? "데이터를 불러오지 못했습니다."}</Text>
        <Pressable style={s.retryBtn} onPress={fetchData}>
          <Text style={s.retryBtnText}>다시 시도</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );

  const { plan, monthly, live, storage, period, unavailable } = data;
  const isPartial = unavailable.length > 0;

  const badge = SUBSCRIPTION_BADGE[plan.subscription_status ?? "UNKNOWN"] ?? SUBSCRIPTION_BADGE.UNKNOWN;

  // attention items
  const reviewCnt     = monthly.growth_report_pending_count;
  const unassignedCnt = live.unassigned_students;
  const hasAttention  = (reviewCnt ?? 0) > 0 || (unassignedCnt ?? 0) > 0;

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title={SCREEN_TITLE} homePath="/(admin)/dashboard" />
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>

        {/* partial 안내 */}
        {isPartial && (
          <View style={s.partialBanner}>
            <LucideIcon name="info" size={13} color="#D97706" />
            <Text style={s.partialText}>일부 지표를 불러오지 못했습니다 (—)</Text>
          </View>
        )}

        {/* ── 1. 오늘 확인할 것 ────────────────────────────────────────── */}
        <View style={s.card}>
          <SectionLabel title="오늘 확인할 것" />
          {!hasAttention ? (
            <View style={s.attentionEmpty}>
              <LucideIcon name="check-circle" size={17} color="#059669" />
              <Text style={s.attentionEmptyText}>현재 확인할 항목이 없습니다</Text>
            </View>
          ) : (
            <View>
              {(reviewCnt ?? 0) > 0 && (
                <Pressable style={s.attentionItem}
                  onPress={() => router.push("/(admin)/report-hub")}>
                  <View style={[s.attentionDot, { backgroundColor: "#D97706" }]} />
                  <Text style={s.attentionItemText}>검토 대기 리포트</Text>
                  <Text style={[s.attentionCount, { color: "#D97706" }]}>{reviewCnt}건</Text>
                  <LucideIcon name="chevron-right" size={14} color={C.textSecondary} />
                </Pressable>
              )}
              {(unassignedCnt ?? 0) > 0 && (
                <Pressable style={s.attentionItem}
                  onPress={() => router.push("/(admin)/curriculum-hub")}>
                  <View style={[s.attentionDot, { backgroundColor: "#6366F1" }]} />
                  <Text style={s.attentionItemText}>커리큘럼 미배정 학생</Text>
                  <Text style={[s.attentionCount, { color: "#6366F1" }]}>{unassignedCnt}명</Text>
                  <LucideIcon name="chevron-right" size={14} color={C.textSecondary} />
                </Pressable>
              )}
            </View>
          )}
        </View>

        {/* ── 2. 이번 달 AI 활용 ──────────────────────────────────────── */}
        <View style={s.card}>
          <SectionLabel title="이번 달 AI 활용" sub={`  ${period.year}.${String(period.month).padStart(2,"0")}`} />
          <View style={s.kpiList}>
            {/* AI 일지 — WP9 전까지 unavailable */}
            <KpiRow
              icon="book-open" iconBg="#EFF6FF" iconColor="#2563EB"
              label="AI 일지"
              value={monthly.ai_diary_count != null ? `${monthly.ai_diary_count}건` : "—"}
              onPress={() => router.push("/(admin)/diary-hub")}
            />
            <View style={s.divider} />
            {/* 학부모 커리큘럼 검색 */}
            <KpiRow
              icon="search" iconBg="#FFF7ED" iconColor="#D97706"
              label="커리큘럼 검색"
              value={monthly.parent_curriculum_search_count != null
                ? `${fmtNum(monthly.parent_curriculum_search_count)}건 / ${fmtNum(monthly.parent_curriculum_user_count)}명`
                : "—"}
            />
            <View style={s.divider} />
            {/* 성장리포트 발송 */}
            <KpiRow
              icon="file-text" iconBg="#F5F3FF" iconColor="#7C3AED"
              label="성장리포트 발송"
              value={monthly.growth_report_sent_count != null
                ? `완료 ${monthly.growth_report_sent_count}건`
                : "—"}
              onPress={() => router.push("/(admin)/report-hub")}
            />
            <View style={s.divider} />
            {/* 성장추적 이벤트 (이번 주) */}
            <KpiRow
              icon="trending-up" iconBg="#F0FDF4" iconColor="#059669"
              label="성장추적"
              value={live.growth_events_week != null ? `이번 주 ${fmtNum(live.growth_events_week)}건` : "—"}
              onPress={() => router.push("/(admin)/x-growth")}
            />
          </View>
        </View>

        {/* ── 3. 현재 운영현황 ─────────────────────────────────────────── */}
        <View style={s.card}>
          <SectionLabel title="현재 운영현황" />
          <View style={s.opsGrid}>
            <Pressable style={s.opsCell} onPress={() => router.push("/(admin)/people")}>
              <Text style={s.opsValue}>{fmtNum(live.active_students)}</Text>
              <Text style={s.opsLabel}>재원 학생</Text>
            </Pressable>
            <View style={s.opsVertDivider} />
            <Pressable style={s.opsCell} onPress={() => router.push("/(admin)/people-teachers")}>
              <Text style={s.opsValue}>{fmtNum(live.active_teachers)}</Text>
              <Text style={s.opsLabel}>선생님</Text>
            </Pressable>
            <View style={s.opsVertDivider} />
            <Pressable style={s.opsCell} onPress={() => router.push("/(admin)/parents-list")}>
              <Text style={s.opsValue}>{fmtNum(live.connected_parents)}</Text>
              <Text style={s.opsLabel}>연결 학부모</Text>
            </Pressable>
          </View>
          {/* 커리큘럼 배정 현황 */}
          <View style={[s.divider, { marginTop: 10 }]} />
          <Pressable style={[s.kpiRow, { marginTop: 8 }]}
            onPress={() => router.push("/(admin)/curriculum-hub")}>
            <View style={[s.kpiIcon, { backgroundColor: "#ECFDF5" }]}>
              <LucideIcon name="graduation-cap" size={14} color="#059669" />
            </View>
            <Text style={s.kpiLabel}>커리큘럼 배정</Text>
            <Text style={s.kpiValue}>{fmtNum(live.curriculum_assigned_students)}명</Text>
            <LucideIcon name="chevron-right" size={14} color={C.textSecondary} />
          </Pressable>
        </View>

        {/* ── 4. 현재 X 플랜 ───────────────────────────────────────────── */}
        <View style={s.card}>
          <View style={s.planHeader}>
            <SectionLabel title="현재 X 플랜" />
            {plan.subscription_status && (
              <View style={[s.badge, { backgroundColor: badge.bg }]}>
                <Text style={[s.badgeText, { color: badge.color }]}>{badge.label}</Text>
              </View>
            )}
          </View>
          <View style={s.planGrid}>
            <View style={s.planCell}>
              <Text style={s.planCellLabel}>플랜</Text>
              <Text style={s.planCellValue}>
                {plan.tier_label
                  ? `SWIMNOTE X ${plan.tier_label}`
                  : (plan.enabled ? "X 활성" : plan.enabled == null ? "—" : "미활성")}
              </Text>
            </View>
            <View style={s.planCell}>
              <Text style={s.planCellLabel}>시작일</Text>
              <Text style={s.planCellValue}>{fmtDate(plan.started_at)}</Text>
            </View>
            <View style={s.planCell}>
              <Text style={s.planCellLabel}>만료일</Text>
              <Text style={[s.planCellValue,
                plan.expires_at && new Date(plan.expires_at) < new Date(Date.now() + 7*86400000)
                  ? { color: "#DC2626" } : {}]}>
                {fmtDate(plan.expires_at)}
              </Text>
            </View>
          </View>
        </View>

        {/* ── 5. 저장공간 ──────────────────────────────────────────────── */}
        {storage.quota_bytes != null && (
          <View style={s.card}>
            <SectionLabel title="저장공간" />
            <View style={s.storageRow}>
              <Text style={s.storageUsed}>
                {storage.total_bytes != null ? fmtBytes(storage.total_bytes) : "—"}
              </Text>
              {storage.quota_bytes > 0 && (
                <Text style={s.storageQuota}> / {fmtBytes(storage.quota_bytes)}</Text>
              )}
              {storage.used_pct != null && (
                <Text style={[s.storagePct, storage.used_pct > 80 ? { color: "#DC2626" } : { color: C.textSecondary }]}>
                  {" "}({storage.used_pct}%)
                </Text>
              )}
            </View>
            {storage.quota_bytes > 0 && storage.used_pct != null && (
              <View style={s.storageBar}>
                <View style={[s.storageBarFill, {
                  width: `${Math.min(100, storage.used_pct)}%` as any,
                  backgroundColor: storage.used_pct > 80 ? "#DC2626" : C.primary,
                }]} />
              </View>
            )}
          </View>
        )}

        {/* ── 6. 빠른 관리 ─────────────────────────────────────────────── */}
        <View style={s.card}>
          <SectionLabel title="빠른 관리" />
          <View style={s.quickGrid}>
            {[
              { icon: "book-open"      as const, label: "커리큘럼 세팅", route: "/(admin)/x-setup" },
              { icon: "credit-card"    as const, label: "구독 관리",     route: "/(admin)/subscription" },
              { icon: "file-text"      as const, label: "AI 리포트",     route: "/(admin)/report-hub" },
              { icon: "book-open"      as const, label: "AI 일지",       route: "/(admin)/diary-hub" },
              { icon: "graduation-cap" as const, label: "커리큘럼",      route: "/(admin)/curriculum-hub" },
            ].map(item => (
              <Pressable key={item.route} style={s.quickItem}
                onPress={() => router.push(item.route as any)}>
                <View style={s.quickIcon}>
                  <LucideIcon name={item.icon} size={18} color={C.primary} />
                </View>
                <Text style={s.quickLabel}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── 스타일 ──────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F3F4F6" },

  partialBanner: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginHorizontal: 14, marginTop: 8, marginBottom: 2,
    backgroundColor: "#FFFBEB", borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 7,
    borderWidth: 1, borderColor: "#FDE68A",
  },
  partialText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#D97706" },

  card: {
    marginHorizontal: 14, marginTop: 10,
    backgroundColor: "#fff", borderRadius: 14,
    borderWidth: 1, borderColor: "#E5E7EB",
    paddingHorizontal: 16, paddingVertical: 14,
  },
  sectionLabel: {
    fontSize: 12, fontFamily: "Pretendard-SemiBold",
    color: C.textSecondary, marginBottom: 10, letterSpacing: 0.3,
  },
  sectionLabelSub: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#9CA3AF" },

  // KPI row
  kpiList: { gap: 0 },
  kpiRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 10 },
  kpiIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  kpiLabel: { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  kpiValue: { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: C.textPrimary },
  divider: { height: 1, backgroundColor: "#F9FAFB" },

  // Attention
  attentionEmpty: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  attentionEmptyText: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#059669" },
  attentionItem: { flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 8 },
  attentionDot: { width: 7, height: 7, borderRadius: 4 },
  attentionItemText: { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  attentionCount: { fontSize: 14, fontFamily: "Pretendard-Bold" },

  // Operations grid
  opsGrid: { flexDirection: "row", alignItems: "center" },
  opsCell: { flex: 1, alignItems: "center", paddingVertical: 8 },
  opsValue: { fontSize: 22, fontFamily: "Pretendard-Bold", color: C.textPrimary, marginBottom: 2 },
  opsLabel: { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  opsVertDivider: { width: 1, height: 40, backgroundColor: "#E5E7EB" },

  // Plan card
  planHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeText: { fontSize: 11, fontFamily: "Pretendard-SemiBold" },
  planGrid: { flexDirection: "row", gap: 0 },
  planCell: { flex: 1 },
  planCellLabel: { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#9CA3AF", marginBottom: 3 },
  planCellValue: { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: C.textPrimary },

  // Storage
  storageRow: { flexDirection: "row", alignItems: "baseline", marginBottom: 8 },
  storageUsed: { fontSize: 18, fontFamily: "Pretendard-Bold", color: C.textPrimary },
  storageQuota: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  storagePct: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  storageBar: { height: 6, backgroundColor: "#F3F4F6", borderRadius: 3, overflow: "hidden" },
  storageBarFill: { height: 6, borderRadius: 3 },

  // Quick buttons
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  quickItem: {
    width: "30%", alignItems: "center", paddingVertical: 12,
    backgroundColor: "#F9FAFB", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB",
  },
  quickIcon: { marginBottom: 6 },
  quickLabel: {
    fontSize: 11, fontFamily: "Pretendard-SemiBold",
    color: C.textPrimary, textAlign: "center",
  },

  // Error
  errorFull: {
    flex: 1, alignItems: "center", justifyContent: "center",
    gap: 12, paddingHorizontal: 32,
  },
  errorText: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.error, textAlign: "center" },
  retryBtn: { paddingHorizontal: 24, paddingVertical: 10, backgroundColor: C.primary, borderRadius: 10 },
  retryBtnText: { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#fff" },
});
