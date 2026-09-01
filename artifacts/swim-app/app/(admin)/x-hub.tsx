/**
 * (admin)/x-hub.tsx — SWIMNOTE X 관리자 운영허브 (PHASE 5)
 *
 * SOURCE OF TRUTH:
 *   X 상태: billing.ts GET /x-subscription-status 동일 로직 (superAdminDb)
 *   X Setup: x-setup.ts GET /x-setup/status 동일 (x_setup_submissions)
 *   AI 일지: class_diaries WHERE lesson_date=today (admin dashboard 동일)
 *   성장추적: growth_events.is_invalidated=false, 이번 주
 *   Parent AI: event_logs category='AI' + feature='parent_curriculum_search' (curriculum-hub 동일)
 *   리포트: growth_reports.product_status (report-hub 동일)
 *   커리큘럼: student_curriculum_assignments.is_active=true (curriculum-hub 동일)
 *   학생: student_class_history.left_at IS NULL (curriculum-hub 동일)
 *   선생님: users.role='teacher' (admin dashboard 동일)
 *   학부모: parent_students.status='approved' DISTINCT parent_id
 *   AI 비용: event_logs metadata.estimated_cost_usd SUM
 *   저장공간: /admin/storage 동일 기준 (quota_bytes from subscription_plans)
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

// ─── 타입 ────────────────────────────────────────────────────────────────────
interface SetupCompletion {
  overall: string;
  curriculum: string;
  website: string;
  logo: string;
  photos: string;
}
interface XStatus {
  enabled: boolean;
  subscription_status: string;
  tier_key: string | null;
  started_at: string | null;
  expires_at: string | null;
  setup_completion: SetupCompletion | null;
}
interface Attention  { review_required_reports: number; unassigned_students: number; }
interface Features   { diaries_today: number; growth_events_week: number; parent_ai_searches_month: number; reports_published_month: number; curriculum_assigned_students: number; }
interface Operations { active_students: number; active_teachers: number; connected_parents: number; }
interface AiUsage    { calls_month: number; estimated_cost_usd_month: number; }
interface Storage    { total_bytes: number; quota_bytes: number; used_pct: number | null; tier: string; }

interface HubData {
  x_status:   XStatus;
  attention:  Attention;
  features:   Features;
  operations: Operations;
  ai_usage:   AiUsage;
  storage:    Storage;
}

// ─── 유틸 ────────────────────────────────────────────────────────────────────
function fmtDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  return `${dt.getFullYear()}.${String(dt.getMonth() + 1).padStart(2,"0")}.${String(dt.getDate()).padStart(2,"0")}`;
}
function fmtBytes(bytes: number): string {
  if (bytes < 1024)           return `${bytes} B`;
  if (bytes < 1024 * 1024)    return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3)      return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
function fmtCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

const SUBSCRIPTION_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  ACTIVE:              { label: "활성",       color: "#059669", bg: "#ECFDF5" },
  CANCELLED_BUT_ACTIVE:{ label: "취소 예약",  color: "#D97706", bg: "#FFFBEB" },
  BILLING_ISSUE:       { label: "결제 오류",  color: "#DC2626", bg: "#FEF2F2" },
  EXPIRED:             { label: "만료됨",     color: "#6B7280", bg: "#F3F4F6" },
  UNKNOWN:             { label: "미확인",     color: "#6B7280", bg: "#F3F4F6" },
};
const SETUP_STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: "미시작", IN_PROGRESS: "진행중", SUBMITTED: "검토중",
  REVISION_REQUESTED: "수정요청", APPROVED: "승인완료",
};
const SETUP_STEP_LABEL: Record<string, string> = {
  NOT_SUBMITTED: "미제출", SUBMITTED: "검토중", APPROVED: "승인됨",
  REVISION_REQUESTED: "수정요청",
};
function setupStepColor(v: string | null | undefined): string {
  if (!v) return C.textSecondary;
  if (v === "APPROVED") return "#059669";
  if (v === "REVISION_REQUESTED") return "#DC2626";
  if (v === "SUBMITTED") return "#D97706";
  return "#9CA3AF";
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
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.error || "조회 실패"); }
      setData(await res.json());
    } catch (e: any) {
      setError(e?.message || "X Hub 데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ─── 스켈레톤 ────────────────────────────────────────────────────────────
  if (loading) return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="SWIMNOTE X 관리" homePath="/(admin)/dashboard" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {[1,2,3,4,5].map(i => (
          <View key={i} style={[s.card, { opacity: 0.3 }]}>
            <View style={{ height: 14, width: 100, backgroundColor: C.border, borderRadius: 6, marginBottom: 12 }} />
            <View style={{ height: 24, width: "60%", backgroundColor: C.border, borderRadius: 6 }} />
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );

  // ─── 에러 ────────────────────────────────────────────────────────────────
  if (error || !data) return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="SWIMNOTE X 관리" homePath="/(admin)/dashboard" />
      <View style={s.errorFull}>
        <LucideIcon name="alert-circle" size={32} color={C.error} />
        <Text style={s.errorText}>{error ?? "데이터를 불러오지 못했습니다."}</Text>
        <Pressable style={s.retryBtn} onPress={fetchData}>
          <Text style={s.retryBtnText}>다시 시도</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );

  const { x_status: xs, attention, features, operations, ai_usage, storage } = data;
  const subscriptionBadge = SUBSCRIPTION_LABEL[xs.subscription_status] ?? SUBSCRIPTION_LABEL.UNKNOWN;
  const attentionCount = attention.review_required_reports + attention.unassigned_students;
  const tierLabel = xs.tier_key ? xs.tier_key.replace("tier", "Tier ").replace("standard", "Standard") : null;

  // setup steps
  const setupSteps = xs.setup_completion ? [
    { key: "curriculum", label: "커리큘럼", value: xs.setup_completion.curriculum },
    { key: "website",    label: "홈페이지", value: xs.setup_completion.website },
    { key: "logo",       label: "로고",     value: xs.setup_completion.logo },
    { key: "photos",     label: "사진",     value: xs.setup_completion.photos },
  ] : [];

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="SWIMNOTE X 관리" homePath="/(admin)/dashboard" />
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>

        {/* ── 1. X 상태 카드 ───────────────────────────────────────────── */}
        <View style={[s.card, s.xStatusCard]}>
          <View style={s.xStatusHeader}>
            <LucideIcon name="sparkles" size={15} color="#6366F1" />
            <Text style={s.xStatusTitle}>X 상태</Text>
            <View style={[s.badge, { backgroundColor: subscriptionBadge.bg }]}>
              <Text style={[s.badgeText, { color: subscriptionBadge.color }]}>{subscriptionBadge.label}</Text>
            </View>
          </View>

          <View style={s.xStatusGrid}>
            <View style={s.xStatusCell}>
              <Text style={s.xStatusCellLabel}>플랜</Text>
              <Text style={s.xStatusCellValue}>{tierLabel ?? (xs.enabled ? "활성" : "비활성")}</Text>
            </View>
            <View style={s.xStatusCell}>
              <Text style={s.xStatusCellLabel}>시작일</Text>
              <Text style={s.xStatusCellValue}>{fmtDate(xs.started_at)}</Text>
            </View>
            <View style={s.xStatusCell}>
              <Text style={s.xStatusCellLabel}>만료일</Text>
              <Text style={[s.xStatusCellValue, xs.expires_at && new Date(xs.expires_at) < new Date(Date.now() + 7*86400000) ? { color: "#DC2626" } : {}]}>
                {fmtDate(xs.expires_at)}
              </Text>
            </View>
          </View>

          {/* Setup 완성도 */}
          {xs.setup_completion && (
            <View style={s.setupRow}>
              <Text style={s.setupOverallLabel}>
                설정 — {SETUP_STATUS_LABEL[xs.setup_completion.overall] ?? xs.setup_completion.overall}
              </Text>
              <View style={s.setupSteps}>
                {setupSteps.map(st => (
                  <View key={st.key} style={s.setupStepItem}>
                    <Text style={[s.setupStepText, { color: setupStepColor(st.value) }]}>
                      {st.label}
                    </Text>
                    <Text style={[s.setupStepStatus, { color: setupStepColor(st.value) }]}>
                      {SETUP_STEP_LABEL[st.value ?? ""] ?? "—"}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>

        {/* ── 2. 오늘 확인할 것 ────────────────────────────────────────── */}
        <View style={s.card}>
          <Text style={s.sectionLabel}>오늘 확인할 것</Text>
          {attentionCount === 0 ? (
            <View style={s.attentionEmpty}>
              <LucideIcon name="check-circle" size={18} color="#059669" />
              <Text style={s.attentionEmptyText}>현재 확인할 항목이 없습니다</Text>
            </View>
          ) : (
            <View style={s.attentionList}>
              {attention.review_required_reports > 0 && (
                <Pressable style={s.attentionItem}
                  onPress={() => router.push("/(admin)/report-hub")}>
                  <View style={[s.attentionDot, { backgroundColor: "#D97706" }]} />
                  <Text style={s.attentionItemText}>검토 대기 리포트</Text>
                  <Text style={[s.attentionCount, { color: "#D97706" }]}>{attention.review_required_reports}건</Text>
                  <LucideIcon name="chevron-right" size={14} color={C.textSecondary} />
                </Pressable>
              )}
              {attention.unassigned_students > 0 && (
                <Pressable style={s.attentionItem}
                  onPress={() => router.push("/(admin)/curriculum-hub")}>
                  <View style={[s.attentionDot, { backgroundColor: "#6366F1" }]} />
                  <Text style={s.attentionItemText}>커리큘럼 미배정 학생</Text>
                  <Text style={[s.attentionCount, { color: "#6366F1" }]}>{attention.unassigned_students}명</Text>
                  <LucideIcon name="chevron-right" size={14} color={C.textSecondary} />
                </Pressable>
              )}
            </View>
          )}
        </View>

        {/* ── 3. X 기능 현황 ───────────────────────────────────────────── */}
        <View style={s.card}>
          <Text style={s.sectionLabel}>X 기능 현황</Text>
          <View style={s.featureList}>
            {/* AI 일지 */}
            <Pressable style={s.featureRow} onPress={() => router.push("/(admin)/diary-hub")}>
              <View style={[s.featureIcon, { backgroundColor: "#EFF6FF" }]}>
                <LucideIcon name="book-open" size={14} color="#2563EB" />
              </View>
              <Text style={s.featureLabel}>AI 일지</Text>
              <Text style={s.featureValue}>오늘 <Text style={s.featureNum}>{features.diaries_today}</Text>건</Text>
              <LucideIcon name="chevron-right" size={14} color={C.textSecondary} />
            </Pressable>
            <View style={s.divider} />

            {/* 성장추적 */}
            <Pressable style={s.featureRow} onPress={() => router.push("/(admin)/x-growth")}>
              <View style={[s.featureIcon, { backgroundColor: "#F0FDF4" }]}>
                <LucideIcon name="trending-up" size={14} color="#059669" />
              </View>
              <Text style={s.featureLabel}>성장추적</Text>
              <Text style={s.featureValue}>이번 주 <Text style={s.featureNum}>{features.growth_events_week}</Text>건</Text>
              <LucideIcon name="chevron-right" size={14} color={C.textSecondary} />
            </Pressable>
            <View style={s.divider} />

            {/* Parent AI */}
            <View style={s.featureRow}>
              <View style={[s.featureIcon, { backgroundColor: "#FFF7ED" }]}>
                <LucideIcon name="search" size={14} color="#D97706" />
              </View>
              <Text style={s.featureLabel}>Parent AI</Text>
              <Text style={s.featureValue}>이번 달 <Text style={s.featureNum}>{features.parent_ai_searches_month}</Text>건</Text>
              {/* Parent AI 상세 화면 없음 → non-navigable */}
            </View>
            <View style={s.divider} />

            {/* 리포트 */}
            <Pressable style={s.featureRow} onPress={() => router.push("/(admin)/report-hub")}>
              <View style={[s.featureIcon, { backgroundColor: "#F5F3FF" }]}>
                <LucideIcon name="file-text" size={14} color="#7C3AED" />
              </View>
              <Text style={s.featureLabel}>AI 리포트</Text>
              <Text style={s.featureValue}>이번 달 발행 <Text style={s.featureNum}>{features.reports_published_month}</Text>건</Text>
              <LucideIcon name="chevron-right" size={14} color={C.textSecondary} />
            </Pressable>
            <View style={s.divider} />

            {/* 커리큘럼 */}
            <Pressable style={s.featureRow} onPress={() => router.push("/(admin)/curriculum-hub")}>
              <View style={[s.featureIcon, { backgroundColor: "#ECFDF5" }]}>
                <LucideIcon name="graduation-cap" size={14} color="#059669" />
              </View>
              <Text style={s.featureLabel}>커리큘럼</Text>
              <Text style={s.featureValue}>배정 <Text style={s.featureNum}>{features.curriculum_assigned_students}</Text>명</Text>
              <LucideIcon name="chevron-right" size={14} color={C.textSecondary} />
            </Pressable>
          </View>
        </View>

        {/* ── 4. 운영 현황 ─────────────────────────────────────────────── */}
        <View style={s.card}>
          <Text style={s.sectionLabel}>운영 현황</Text>
          <View style={s.opsGrid}>
            <Pressable style={s.opsCell} onPress={() => router.push("/(admin)/people")}>
              <Text style={s.opsValue}>{operations.active_students}</Text>
              <Text style={s.opsLabel}>재원 학생</Text>
            </Pressable>
            <View style={s.opsVertDivider} />
            <Pressable style={s.opsCell} onPress={() => router.push("/(admin)/people-teachers")}>
              <Text style={s.opsValue}>{operations.active_teachers}</Text>
              <Text style={s.opsLabel}>선생님</Text>
            </Pressable>
            <View style={s.opsVertDivider} />
            <Pressable style={s.opsCell} onPress={() => router.push("/(admin)/parents-list")}>
              <Text style={s.opsValue}>{operations.connected_parents}</Text>
              <Text style={s.opsLabel}>연결 학부모</Text>
            </Pressable>
          </View>
        </View>

        {/* ── 5. AI 사용량 ─────────────────────────────────────────────── */}
        <View style={s.card}>
          <Text style={s.sectionLabel}>AI 사용량 <Text style={s.sectionLabelSub}>(이번 달)</Text></Text>
          <View style={s.aiUsageRow}>
            <View style={s.aiUsageCell}>
              <Text style={s.aiUsageValue}>{ai_usage.calls_month.toLocaleString()}</Text>
              <Text style={s.aiUsageLabel}>AI 호출</Text>
            </View>
            <View style={s.opsVertDivider} />
            <View style={s.aiUsageCell}>
              <Text style={s.aiUsageValue}>{fmtCost(ai_usage.estimated_cost_usd_month)}</Text>
              <Text style={s.aiUsageLabel}>예상 비용 (USD)</Text>
            </View>
          </View>
        </View>

        {/* ── 6. 저장공간 ──────────────────────────────────────────────── */}
        <View style={s.card}>
          <Text style={s.sectionLabel}>저장공간</Text>
          <View style={s.storageRow}>
            <Text style={s.storageUsed}>{fmtBytes(storage.total_bytes)}</Text>
            {storage.quota_bytes > 0 && (
              <Text style={s.storageQuota}> / {fmtBytes(storage.quota_bytes)}</Text>
            )}
            {storage.used_pct !== null && (
              <Text style={[s.storagePct, storage.used_pct > 80 ? { color: "#DC2626" } : { color: C.textSecondary }]}>
                {" "}({storage.used_pct}%)
              </Text>
            )}
          </View>
          {storage.quota_bytes > 0 && (
            <View style={s.storageBar}>
              <View style={[s.storageBarFill, {
                width: `${Math.min(100, storage.used_pct ?? 0)}%` as any,
                backgroundColor: (storage.used_pct ?? 0) > 80 ? "#DC2626" : C.primary,
              }]} />
            </View>
          )}
          <Text style={s.storageTier}>플랜: {storage.tier}</Text>
        </View>

        {/* ── 7. 빠른 관리 ─────────────────────────────────────────────── */}
        <View style={s.card}>
          <Text style={s.sectionLabel}>빠른 관리</Text>
          <View style={s.quickGrid}>
            {[
              { icon: "settings" as const,    label: "X 세팅",      route: "/(admin)/x-setup" },
              { icon: "credit-card" as const, label: "구독 관리",   route: "/(admin)/subscription" },
              { icon: "file-text" as const,   label: "AI 리포트",   route: "/(admin)/report-hub" },
              { icon: "book-open" as const,   label: "AI 일지",     route: "/(admin)/diary-hub" },
              { icon: "graduation-cap" as const, label: "커리큘럼", route: "/(admin)/curriculum-hub" },
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

  card: {
    marginHorizontal: 14, marginTop: 10,
    backgroundColor: "#fff", borderRadius: 14,
    borderWidth: 1, borderColor: "#E5E7EB",
    paddingHorizontal: 16, paddingVertical: 14,
  },
  sectionLabel: { fontSize: 12, fontFamily: "Pretendard-SemiBold", color: C.textSecondary, marginBottom: 10, letterSpacing: 0.3 },
  sectionLabelSub: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#9CA3AF" },

  // X Status
  xStatusCard: {},
  xStatusHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 },
  xStatusTitle: { fontSize: 14, fontFamily: "Pretendard-Bold", color: "#1E1B4B", flex: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeText: { fontSize: 11, fontFamily: "Pretendard-SemiBold" },
  xStatusGrid: { flexDirection: "row", gap: 0, marginBottom: 14 },
  xStatusCell: { flex: 1 },
  xStatusCellLabel: { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#9CA3AF", marginBottom: 2 },
  xStatusCellValue: { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: C.textPrimary },
  setupRow: { borderTopWidth: 1, borderTopColor: "#F3F4F6", paddingTop: 12 },
  setupOverallLabel: { fontSize: 11, fontFamily: "Pretendard-SemiBold", color: C.textSecondary, marginBottom: 8 },
  setupSteps: { flexDirection: "row", gap: 8 },
  setupStepItem: { alignItems: "center", flex: 1 },
  setupStepText: { fontSize: 10, fontFamily: "Pretendard-Regular", marginBottom: 2 },
  setupStepStatus: { fontSize: 10, fontFamily: "Pretendard-SemiBold" },

  // Attention
  attentionEmpty: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  attentionEmptyText: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#059669" },
  attentionList: { gap: 0 },
  attentionItem: { flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 8 },
  attentionDot: { width: 7, height: 7, borderRadius: 4 },
  attentionItemText: { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  attentionCount: { fontSize: 14, fontFamily: "Pretendard-Bold" },

  // Feature list
  featureList: { gap: 0 },
  featureRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 10 },
  featureIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  featureLabel: { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  featureValue: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  featureNum: { fontSize: 14, fontFamily: "Pretendard-Bold", color: C.textPrimary },
  divider: { height: 1, backgroundColor: "#F9FAFB" },

  // Operations grid
  opsGrid: { flexDirection: "row", alignItems: "center" },
  opsCell: { flex: 1, alignItems: "center", paddingVertical: 8 },
  opsValue: { fontSize: 22, fontFamily: "Pretendard-Bold", color: C.textPrimary, marginBottom: 2 },
  opsLabel: { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  opsVertDivider: { width: 1, height: 40, backgroundColor: "#E5E7EB" },

  // AI usage
  aiUsageRow: { flexDirection: "row", alignItems: "center" },
  aiUsageCell: { flex: 1, alignItems: "center", paddingVertical: 6 },
  aiUsageValue: { fontSize: 20, fontFamily: "Pretendard-Bold", color: C.textPrimary, marginBottom: 2 },
  aiUsageLabel: { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary },

  // Storage
  storageRow: { flexDirection: "row", alignItems: "baseline", marginBottom: 8 },
  storageUsed: { fontSize: 18, fontFamily: "Pretendard-Bold", color: C.textPrimary },
  storageQuota: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  storagePct: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  storageBar: { height: 6, backgroundColor: "#F3F4F6", borderRadius: 3, overflow: "hidden", marginBottom: 6 },
  storageBarFill: { height: 6, borderRadius: 3 },
  storageTier: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#9CA3AF" },

  // Quick buttons
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  quickItem: {
    width: "30%", alignItems: "center", paddingVertical: 12,
    backgroundColor: "#F9FAFB", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB",
  },
  quickIcon: { marginBottom: 6 },
  quickLabel: { fontSize: 11, fontFamily: "Pretendard-SemiBold", color: C.textPrimary, textAlign: "center" },

  // Error
  errorFull: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 32 },
  errorText: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.error, textAlign: "center" },
  retryBtn: { paddingHorizontal: 24, paddingVertical: 10, backgroundColor: C.primary, borderRadius: 10 },
  retryBtnText: { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#fff" },
});
