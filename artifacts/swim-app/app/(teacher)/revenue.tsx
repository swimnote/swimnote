/**
 * (teacher)/revenue.tsx — 정산 V2
 *
 * 화면 구성:
 * [월 선택] → [Summary] → [운영정보] → [학생 목록 + 상세 + 조정] → [저장]
 *
 * 원칙:
 * - 서버가 모든 금액을 계산. APP은 adjustment만 입력.
 * - unpriced 학생 존재 시 저장 차단.
 * - confirmed 정산은 수정 불가.
 * - 저장 실패 시 입력값 유지.
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { useTabScrollReset } from "@/hooks/useTabScrollReset";
import { addTabResetListener } from "@/utils/tabReset";

const C = Colors.light;

// ─── 타입 ─────────────────────────────────────────────────────────────────────

interface TeacherAllocation {
  teacher_id: string;
  regular_slot_count: number;
  allocation_ratio: number;
  allocated_auto_amount: number;
}

interface StudentCalc {
  student_id: string;
  student_name: string;
  weekly_count: number;
  pricing_status: "priced" | "unpriced";
  monthly_fee: number | null;
  sessions_per_month: number | null;
  scheduled_regular_count: number;
  completed_makeup_count: number;
  service_count: number;
  billable_count: number | null;
  student_auto_amount: number | null;
  teacher_allocations: TeacherAllocation[];
}

interface TeacherAgg {
  teacher_id: string;
  student_count: number;
  regular_slot_count: number;
  completed_makeup_performed_count: number;
  allocated_auto_amount: number;
}

interface PoolSummary {
  student_count: number;
  priced_student_count: number;
  unpriced_student_count: number;
  student_auto_total: number;
  teacher_allocated_auto_total: number;
}

interface Adjustment {
  amount: string;          // raw input string (may be negative, e.g. "-10000")
  reason: "discount" | "trial" | "collect" | "other";
  memo: string;
}

type SettleStatus = "none" | "submitted" | "confirmed";

// ─── 유틸 ─────────────────────────────────────────────────────────────────────

function monthStr(offset = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatWon(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("ko-KR") + "원";
}

function formatWonSigned(n: number) {
  if (n === 0) return "0원";
  const sign = n > 0 ? "+" : "";
  return sign + n.toLocaleString("ko-KR") + "원";
}

function formatPct(ratio: number) {
  return (ratio * 100).toFixed(1) + "%";
}

const REASON_LABELS: Record<string, string> = {
  discount: "할인",
  trial: "체험",
  collect: "회수결제",
  other: "기타",
};

const REASONS = ["discount", "trial", "collect", "other"] as const;

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function RevenueScreen() {
  const { token, adminUser } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();
  const scrollRef = useTabScrollReset<ScrollView>("revenue");

  const [month, setMonth] = useState(monthStr());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  // 서버 계산 결과
  const [pricedStudents, setPricedStudents] = useState<StudentCalc[]>([]);
  const [unpricedStudents, setUnpricedStudents] = useState<StudentCalc[]>([]);
  const [teacherAgg, setTeacherAgg] = useState<TeacherAgg | null>(null);

  // 정산 상태
  const [settleStatus, setSettleStatus] = useState<SettleStatus>("none");
  const [autoSnapshot, setAutoSnapshot] = useState<number | null>(null);
  const [currentAuto, setCurrentAuto] = useState<number | null>(null);
  const [hasChanged, setHasChanged] = useState(false);
  const [savedTotalRevenue, setSavedTotalRevenue] = useState<number | null>(null);

  // 사용자 입력: 학생별 adjustment
  const [adjustments, setAdjustments] = useState<Map<string, Adjustment>>(new Map());
  const [hasUnsaved, setHasUnsaved] = useState(false);

  // 학생 상세 펼침
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // 오류/성공 메시지
  const [msg, setMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const poolId = (adminUser as any)?.swimming_pool_id || "";
  const userId = adminUser?.id ?? "";

  // ── 로드 ────────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!poolId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [calcRes, statusRes] = await Promise.all([
        apiRequest(token, `/settlement/calculator?pool_id=${poolId}&month=${month}`),
        apiRequest(token, `/settlement/my-status?pool_id=${poolId}&month=${month}`).catch(() => null),
      ]);

      if (calcRes.ok) {
        const data = await calcRes.json();
        setPricedStudents(data.students ?? []);
        setUnpricedStudents(data.unpriced_students ?? []);
        setTeacherAgg(data.teacher_aggregation ?? null);
      }

      if (statusRes?.ok) {
        const sd = await statusRes.json();
        setSettleStatus(sd.status ?? "none");
        setAutoSnapshot(sd.auto_amount_snapshot ?? null);
        setCurrentAuto(sd.current_auto_amount ?? null);
        setHasChanged(sd.has_changed ?? false);
        setSavedTotalRevenue(sd.total_revenue ?? null);
      } else {
        setSettleStatus("none");
        setAutoSnapshot(null);
        setCurrentAuto(null);
        setHasChanged(false);
        setSavedTotalRevenue(null);
      }
    } catch (e) {
      console.error("[revenue] load:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, poolId, month]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => {
    return addTabResetListener("revenue", () => setMonth(monthStr()));
  }, []);

  // ── 월 변경 ─────────────────────────────────────────────────────────────────

  function changeMonth(delta: number) {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    setAdjustments(new Map());
    setExpanded(new Set());
    setHasUnsaved(false);
    setMsg(null);
  }

  // ── 조정 입력 ────────────────────────────────────────────────────────────────

  function updateAdj(sid: string, patch: Partial<Adjustment>) {
    setAdjustments(prev => {
      const next = new Map(prev);
      const cur = next.get(sid) ?? { amount: "", reason: "discount" as const, memo: "" };
      next.set(sid, { ...cur, ...patch });
      return next;
    });
    setHasUnsaved(true);
  }

  // ── 저장 ─────────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setMsg(null);
    try {
      const adjList: any[] = [];
      for (const [sid, adj] of adjustments.entries()) {
        const amount = parseInt(adj.amount.replace(/[^0-9\-]/g, ""), 10);
        if (!isNaN(amount)) {
          adjList.push({
            student_id: sid,
            adjustment_amount: amount,
            adjustment_reason: adj.reason,
            adjustment_memo: adj.memo || null,
          });
        }
      }

      const res = await apiRequest(token, "/settlement/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pool_id: poolId,
          month,
          adjustments: adjList,
        }),
      });
      const data = await res.json();

      if (data.success) {
        setHasUnsaved(false);
        setSettleStatus("submitted");
        setMsg({ text: "저장됐습니다.", type: "success" });
        // 상태 재조회 (snapshot 갱신)
        await load();
      } else if (data.error_code === "SETTLEMENT_CONFIRMED") {
        setMsg({ text: "관리자가 확인한 정산은 수정할 수 없습니다.", type: "error" });
      } else if (data.error_code === "PRICING_NOT_CONFIGURED") {
        setMsg({
          text: `센터 수업료 설정이 필요한 회원 ${data.unpriced_count}명이 있습니다. 관리자에게 수업료 설정을 요청하세요.`,
          type: "error",
        });
      } else {
        setMsg({ text: data.message || "저장 중 오류가 발생했습니다.", type: "error" });
      }
    } catch {
      // 네트워크 오류 — 입력값 유지
      setMsg({ text: "네트워크 오류가 발생했습니다. 입력한 내용은 유지됩니다.", type: "error" });
    } finally {
      setSaving(false);
    }
  }

  // ── 계산 ─────────────────────────────────────────────────────────────────────

  const isConfirmed = settleStatus === "confirmed";

  function myAlloc(s: StudentCalc) {
    return s.teacher_allocations.find(a => a.teacher_id === userId) ?? null;
  }

  function previewFinal(s: StudentCalc): number | null {
    const alloc = myAlloc(s);
    if (!alloc) return null;
    const base = alloc.allocated_auto_amount;
    const adj = adjustments.get(s.student_id);
    const adjAmt = adj ? parseInt(adj.amount.replace(/[^0-9\-]/g, ""), 10) : 0;
    return base + (isNaN(adjAmt) ? 0 : adjAmt);
  }

  const totalAllocAuto = teacherAgg?.allocated_auto_amount ?? 0;
  const totalAdjAmt = pricedStudents.reduce((sum, s) => {
    const adj = adjustments.get(s.student_id);
    if (!adj) return sum;
    const n = parseInt(adj.amount.replace(/[^0-9\-]/g, ""), 10);
    return sum + (isNaN(n) ? 0 : n);
  }, 0);
  const totalPreviewFinal = totalAllocAuto + totalAdjAmt;

  const weeklyLabel = (wc: number) => `주${wc}회`;

  // ── 상태 배지 텍스트 ─────────────────────────────────────────────────────────

  function statusLabel(): string {
    if (settleStatus === "confirmed") return "관리자 확인";
    if (hasChanged && settleStatus === "submitted") return "저장 후 변경";
    if (settleStatus === "submitted") return "저장됨";
    return "미저장";
  }
  function statusColor(): { bg: string; text: string } {
    if (settleStatus === "confirmed") return { bg: "#EEDDF5", text: "#7C3AED" };
    if (hasChanged) return { bg: "#FEF3C7", text: "#92400E" };
    if (settleStatus === "submitted") return { bg: C.brandMist, text: C.brandStrong };
    return { bg: C.surface, text: C.textSecondary };
  }

  // ── 렌더 ─────────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      {/* 헤더 */}
      <View style={[s.header, { paddingTop: insets.top + 14 }]}>
        <Text style={[s.headerTitle, { color: themeColor }]}>정산</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={themeColor}
          />
        }
        keyboardShouldPersistTaps="handled"
      >
        {/* ── 월 선택 ─────────────────────────────────────────────────── */}
        <View style={[s.monthRow, { backgroundColor: C.card }]}>
          <Pressable onPress={() => changeMonth(-1)} style={s.navBtn} hitSlop={8}>
            <LucideIcon name="chevron-left" size={22} color={themeColor} />
          </Pressable>
          <Text style={[s.monthText, { color: C.text }]}>
            {month.replace("-", "년 ")}월 정산
          </Text>
          <Pressable onPress={() => changeMonth(1)} style={s.navBtn} hitSlop={8}>
            <LucideIcon name="chevron-right" size={22} color={themeColor} />
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator color={themeColor} style={{ marginTop: 60 }} />
        ) : (
          <>
            {/* ── 상태 배지 ─────────────────────────────────────────── */}
            <View style={s.statusRow}>
              <View style={[s.statusBadge, { backgroundColor: statusColor().bg }]}>
                <LucideIcon
                  name={
                    settleStatus === "confirmed" ? "check-circle" :
                    hasChanged ? "alert-triangle" :
                    settleStatus === "submitted" ? "save" : "clock"
                  }
                  size={13}
                  color={statusColor().text}
                />
                <Text style={[s.statusTxt, { color: statusColor().text }]}>
                  {statusLabel()}
                </Text>
              </View>
              {hasChanged && (
                <Text style={[s.statusDesc, { color: "#92400E" }]}>
                  저장 이후 수업 데이터가 변경됐습니다
                </Text>
              )}
            </View>

            {/* ── unpriced 경고 배너 ────────────────────────────────── */}
            {unpricedStudents.length > 0 && (
              <View style={[s.warnBanner, { backgroundColor: "#FEF3C7", borderColor: "#F59E0B" }]}>
                <LucideIcon name="alert-triangle" size={15} color="#92400E" />
                <Text style={[s.warnText, { color: "#92400E" }]}>
                  수업료 설정이 필요한 회원 {unpricedStudents.length}명{"\n"}
                  관리자에게 센터 수업료 설정을 요청하세요.
                </Text>
              </View>
            )}

            {/* ── Summary 카드 ──────────────────────────────────────── */}
            <View style={[s.summaryCard, { backgroundColor: themeColor }]}>
              <Text style={s.summaryCardLabel}>자동 기준 매출</Text>
              <Text style={s.summaryCardMain}>{formatWon(totalAllocAuto)}</Text>

              <View style={s.summaryDivider} />

              <View style={s.summaryRow}>
                <View style={s.summaryItem}>
                  <Text style={s.summaryItemLabel}>조정 금액</Text>
                  <Text style={[s.summaryItemVal, { color: totalAdjAmt < 0 ? "#FCA5A5" : "#fff" }]}>
                    {formatWonSigned(totalAdjAmt)}
                  </Text>
                </View>
                <View style={s.summaryItemSep} />
                <View style={s.summaryItem}>
                  <Text style={s.summaryItemLabel}>반영 예정 매출</Text>
                  <Text style={s.summaryItemValMain}>{formatWon(totalPreviewFinal)}</Text>
                </View>
              </View>

              {settleStatus === "submitted" && savedTotalRevenue !== null && (
                <View style={s.savedRow}>
                  <LucideIcon name="save" size={12} color="rgba(255,255,255,0.7)" />
                  <Text style={s.savedRowText}>
                    저장된 반영 매출 {formatWon(savedTotalRevenue)}
                  </Text>
                </View>
              )}
            </View>

            {/* ── 운영 정보 ─────────────────────────────────────────── */}
            <View style={[s.card, { backgroundColor: C.card }]}>
              <View style={s.cardTitleRow}>
                <LucideIcon name="bar-chart-2" size={15} color={themeColor} />
                <Text style={[s.cardTitle, { color: C.text }]}>이번 달 운영 현황</Text>
              </View>
              <View style={s.opsRow}>
                {[
                  { label: "담당 회원", val: teacherAgg?.student_count ?? pricedStudents.length, unit: "명" },
                  { label: "정규 수업", val: teacherAgg?.regular_slot_count ?? 0, unit: "회" },
                  { label: "완료 보강", val: teacherAgg?.completed_makeup_performed_count ?? 0, unit: "회" },
                ].map((item, i) => (
                  <React.Fragment key={item.label}>
                    {i > 0 && <View style={s.opsDivider} />}
                    <View style={s.opsItem}>
                      <Text style={[s.opsVal, { color: C.text }]}>
                        {item.val}<Text style={[s.opsUnit, { color: C.textSecondary }]}>{item.unit}</Text>
                      </Text>
                      <Text style={[s.opsLabel, { color: C.textMuted }]}>{item.label}</Text>
                    </View>
                  </React.Fragment>
                ))}
              </View>
            </View>

            {/* ── 학생 목록 ─────────────────────────────────────────── */}
            <View style={[s.card, { backgroundColor: C.card }]}>
              <View style={s.cardTitleRow}>
                <LucideIcon name="users" size={15} color={themeColor} />
                <Text style={[s.cardTitle, { color: C.text }]}>학생별 정산</Text>
                {hasUnsaved && (
                  <View style={[s.unsavedBadge, { backgroundColor: "#FEF3C7" }]}>
                    <Text style={s.unsavedTxt}>저장하지 않은 변경</Text>
                  </View>
                )}
              </View>

              {pricedStudents.length === 0 && unpricedStudents.length === 0 ? (
                <Text style={[s.empty, { color: C.textMuted }]}>
                  이번 달 담당 회원이 없습니다.
                </Text>
              ) : (
                <>
                  {/* priced 학생 */}
                  {pricedStudents.map((st, idx) => {
                    const alloc = myAlloc(st);
                    const adj = adjustments.get(st.student_id);
                    const adjAmt = adj ? parseInt(adj.amount.replace(/[^0-9\-]/g, ""), 10) : 0;
                    const safeAdj = isNaN(adjAmt) ? 0 : adjAmt;
                    const preview = (alloc?.allocated_auto_amount ?? 0) + safeAdj;
                    const isExp = expanded.has(st.student_id);

                    return (
                      <View
                        key={st.student_id}
                        style={[
                          s.studentCard,
                          { borderColor: C.border },
                          idx < pricedStudents.length - 1 && { borderBottomWidth: 1 },
                        ]}
                      >
                        {/* 기본 행 */}
                        <Pressable
                          style={s.studentRow}
                          onPress={() => setExpanded(prev => {
                            const n = new Set(prev);
                            if (n.has(st.student_id)) n.delete(st.student_id);
                            else n.add(st.student_id);
                            return n;
                          })}
                        >
                          <View style={s.studentLeft}>
                            <View style={s.studentNameRow}>
                              <Text style={[s.studentName, { color: C.text }]}>{st.student_name}</Text>
                              <View style={[s.weeklyTag, { backgroundColor: themeColor + "18" }]}>
                                <Text style={[s.weeklyTagText, { color: themeColor }]}>
                                  {weeklyLabel(st.weekly_count)}
                                </Text>
                              </View>
                            </View>
                            <View style={s.studentAmtRow}>
                              <Text style={[s.studentAmtLabel, { color: C.textMuted }]}>내 기준매출</Text>
                              <Text style={[s.studentAmt, { color: C.text }]}>
                                {formatWon(alloc?.allocated_auto_amount ?? null)}
                              </Text>
                            </View>
                            {safeAdj !== 0 && (
                              <View style={s.studentAmtRow}>
                                <Text style={[s.studentAmtLabel, { color: C.textMuted }]}>조정</Text>
                                <Text style={[s.studentAdj, { color: safeAdj < 0 ? "#DC2626" : "#059669" }]}>
                                  {formatWonSigned(safeAdj)}
                                </Text>
                              </View>
                            )}
                            <View style={s.studentAmtRow}>
                              <Text style={[s.studentAmtLabel, { color: C.textMuted }]}>반영 예정</Text>
                              <Text style={[s.studentFinal, { color: themeColor }]}>
                                {formatWon(preview)}
                              </Text>
                            </View>
                          </View>
                          <LucideIcon
                            name={isExp ? "chevron-up" : "chevron-down"}
                            size={16}
                            color={C.textMuted}
                          />
                        </Pressable>

                        {/* 상세 패널 */}
                        {isExp && (
                          <View style={[s.detailPanel, { borderTopColor: C.border }]}>
                            {/* 계산 근거 */}
                            <View style={s.detailSection}>
                              <DetailRow label="정상 월수업료" value={formatWon(st.monthly_fee)} />
                              <DetailRow label="월 기준 횟수" value={`${st.sessions_per_month}회`} />
                              <DetailRow label="학생 전체 정규수업" value={`${st.scheduled_regular_count}회`} />
                              <DetailRow label="내 담당 정규수업" value={`${alloc?.regular_slot_count ?? 0}회`} />
                              <DetailRow label="내 배분 비율" value={formatPct(alloc?.allocation_ratio ?? 0)} />
                              <DetailRow label="학생 완료 보강" value={`${st.completed_makeup_count}회`} />
                              <DetailRow label="청구 횟수" value={`${st.billable_count}회`} />
                            </View>

                            <View style={[s.detailDivider, { backgroundColor: C.border }]} />

                            <View style={s.detailSection}>
                              <DetailRow label="학생 전체 기준매출" value={formatWon(st.student_auto_amount)} muted />
                              <DetailRow label="내 기준매출" value={formatWon(alloc?.allocated_auto_amount ?? null)} strong themeColor={themeColor} />
                            </View>

                            <View style={[s.detailDivider, { backgroundColor: C.border }]} />

                            {/* 조정 입력 */}
                            {!isConfirmed && (
                              <View style={s.adjSection}>
                                <Text style={[s.adjTitle, { color: C.text }]}>조정</Text>

                                {/* 금액 */}
                                <View style={[s.adjInputRow, { borderColor: C.border }]}>
                                  <Text style={[s.adjPrefix, { color: C.textSecondary }]}>₩</Text>
                                  <TextInput
                                    style={[s.adjInput, { color: C.text }]}
                                    value={adj?.amount ?? ""}
                                    onChangeText={v => updateAdj(st.student_id, { amount: v })}
                                    placeholder="조정 금액 (음수 가능, 예: -10000)"
                                    placeholderTextColor={C.textMuted}
                                    keyboardType="numbers-and-punctuation"
                                  />
                                </View>

                                {/* 사유 */}
                                <View style={s.reasonRow}>
                                  {REASONS.map(r => (
                                    <Pressable
                                      key={r}
                                      style={[
                                        s.reasonBtn,
                                        {
                                          backgroundColor: adj?.reason === r ? themeColor : C.surface,
                                          borderColor: adj?.reason === r ? themeColor : C.border,
                                        },
                                      ]}
                                      onPress={() => updateAdj(st.student_id, { reason: r })}
                                    >
                                      <Text style={[s.reasonTxt, { color: adj?.reason === r ? "#fff" : C.textSecondary }]}>
                                        {REASON_LABELS[r]}
                                      </Text>
                                    </Pressable>
                                  ))}
                                </View>

                                {/* 메모 */}
                                <TextInput
                                  style={[s.memoInput, { borderColor: C.border, color: C.text }]}
                                  value={adj?.memo ?? ""}
                                  onChangeText={v => updateAdj(st.student_id, { memo: v })}
                                  placeholder="메모 (선택)"
                                  placeholderTextColor={C.textMuted}
                                />
                              </View>
                            )}

                            <View style={[s.detailDivider, { backgroundColor: C.border }]} />

                            {/* 반영 예정 */}
                            <View style={[s.finalRow, { backgroundColor: themeColor + "0D" }]}>
                              <Text style={[s.finalLabel, { color: C.text }]}>반영 예정</Text>
                              <Text style={[s.finalAmt, { color: themeColor }]}>{formatWon(preview)}</Text>
                            </View>
                          </View>
                        )}
                      </View>
                    );
                  })}

                  {/* unpriced 학생 */}
                  {unpricedStudents.map(st => (
                    <View key={st.student_id} style={[s.unpricedRow, { borderColor: C.border }]}>
                      <View style={s.studentNameRow}>
                        <Text style={[s.studentName, { color: C.text }]}>{st.student_name}</Text>
                        <View style={[s.weeklyTag, { backgroundColor: C.surface, borderColor: C.border }]}>
                          <Text style={[s.weeklyTagText, { color: C.textSecondary }]}>
                            {weeklyLabel(st.weekly_count)}
                          </Text>
                        </View>
                      </View>
                      <View style={[s.unpricedLabel, { backgroundColor: "#FEF3C7" }]}>
                        <LucideIcon name="alert-triangle" size={12} color="#92400E" />
                        <Text style={[s.unpricedLabelTxt, { color: "#92400E" }]}>
                          센터 수업료 설정 필요
                        </Text>
                      </View>
                    </View>
                  ))}
                </>
              )}
            </View>

            {/* ── 메시지 ──────────────────────────────────────────────── */}
            {msg && (
              <View style={[s.msgBox, {
                backgroundColor: msg.type === "success" ? "#D1FAE5" : "#FEE2E2",
                borderColor: msg.type === "success" ? "#34D399" : "#FCA5A5",
              }]}>
                <LucideIcon
                  name={msg.type === "success" ? "check-circle" : "alert-circle"}
                  size={15}
                  color={msg.type === "success" ? "#065F46" : "#991B1B"}
                />
                <Text style={[s.msgText, { color: msg.type === "success" ? "#065F46" : "#991B1B" }]}>
                  {msg.text}
                </Text>
              </View>
            )}

            {/* ── 저장 버튼 ─────────────────────────────────────────── */}
            {!isConfirmed ? (
              <Pressable
                style={[
                  s.saveBtn,
                  { backgroundColor: hasUnsaved ? themeColor : C.brandStrong, opacity: saving ? 0.6 : 1 },
                ]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <LucideIcon name="save" size={17} color="#fff" />
                    <Text style={s.saveBtnText}>
                      {settleStatus === "submitted" ? "정산 다시 저장" : "이번 달 정산 저장"}
                    </Text>
                  </>
                )}
              </Pressable>
            ) : (
              <View style={[s.confirmedBox, { backgroundColor: "#EEDDF5" }]}>
                <LucideIcon name="check-circle" size={18} color="#7C3AED" />
                <Text style={[s.confirmedTxt, { color: "#7C3AED" }]}>
                  관리자가 이번 달 정산을 확인했습니다.
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── 상세 행 컴포넌트 ──────────────────────────────────────────────────────────

function DetailRow({
  label, value, muted, strong, themeColor,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
  themeColor?: string;
}) {
  return (
    <View style={s.detailRow}>
      <Text style={[s.detailLabel, { color: Colors.light.textMuted }]}>{label}</Text>
      <Text style={[
        s.detailValue,
        { color: strong && themeColor ? themeColor : muted ? Colors.light.textSecondary : Colors.light.text },
      ]}>
        {value}
      </Text>
    </View>
  );
}

// ─── 스타일 ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: C.surface },
  header:          { backgroundColor: "#fff", paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  headerTitle:     { fontSize: 20, fontFamily: "Pretendard-Regular" },

  monthRow:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 16, padding: 12 },
  navBtn:          { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  monthText:       { fontSize: 17, fontFamily: "Pretendard-Regular" },

  statusRow:       { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  statusBadge:     { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  statusTxt:       { fontSize: 13, fontFamily: "Pretendard-Regular" },
  statusDesc:      { fontSize: 12, fontFamily: "Pretendard-Regular", flex: 1 },

  warnBanner:      { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1 },
  warnText:        { fontSize: 13, fontFamily: "Pretendard-Regular", flex: 1, lineHeight: 19 },

  // Summary 카드
  summaryCard:     { borderRadius: 18, padding: 20, gap: 4 },
  summaryCardLabel:{ fontSize: 12, fontFamily: "Pretendard-Regular", color: "rgba(255,255,255,0.75)" },
  summaryCardMain: { fontSize: 30, fontFamily: "Pretendard-Regular", color: "#fff", marginTop: 2 },
  summaryDivider:  { height: 1, backgroundColor: "rgba(255,255,255,0.25)", marginVertical: 12 },
  summaryRow:      { flexDirection: "row", gap: 0 },
  summaryItem:     { flex: 1, gap: 4 },
  summaryItemSep:  { width: 1, backgroundColor: "rgba(255,255,255,0.25)", marginHorizontal: 12 },
  summaryItemLabel:{ fontSize: 11, fontFamily: "Pretendard-Regular", color: "rgba(255,255,255,0.75)" },
  summaryItemVal:  { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" },
  summaryItemValMain:{ fontSize: 17, fontFamily: "Pretendard-Regular", color: "#fff" },
  savedRow:        { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6 },
  savedRowText:    { fontSize: 11, fontFamily: "Pretendard-Regular", color: "rgba(255,255,255,0.65)" },

  // 공통 카드
  card:            { borderRadius: 16, padding: 16, gap: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  cardTitleRow:    { flexDirection: "row", alignItems: "center", gap: 6 },
  cardTitle:       { fontSize: 15, fontFamily: "Pretendard-Regular", flex: 1 },

  // 운영정보
  opsRow:          { flexDirection: "row", alignItems: "center" },
  opsItem:         { flex: 1, alignItems: "center", gap: 3 },
  opsDivider:      { width: 1, height: 36, backgroundColor: C.border, marginHorizontal: 8 },
  opsVal:          { fontSize: 22, fontFamily: "Pretendard-Regular" },
  opsUnit:         { fontSize: 13, fontFamily: "Pretendard-Regular" },
  opsLabel:        { fontSize: 11, fontFamily: "Pretendard-Regular" },

  // 학생 목록
  unsavedBadge:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, marginLeft: "auto" as any },
  unsavedTxt:      { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#92400E" },
  empty:           { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center", paddingVertical: 24 },

  studentCard:     { paddingVertical: 0 },
  studentRow:      { flexDirection: "row", alignItems: "flex-start", paddingVertical: 12, gap: 8 },
  studentLeft:     { flex: 1, gap: 4 },
  studentNameRow:  { flexDirection: "row", alignItems: "center", gap: 6 },
  studentName:     { fontSize: 15, fontFamily: "Pretendard-Regular" },
  weeklyTag:       { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: "transparent" },
  weeklyTagText:   { fontSize: 11, fontFamily: "Pretendard-Regular" },
  studentAmtRow:   { flexDirection: "row", alignItems: "center", gap: 6 },
  studentAmtLabel: { fontSize: 12, fontFamily: "Pretendard-Regular", width: 70 },
  studentAmt:      { fontSize: 14, fontFamily: "Pretendard-Regular" },
  studentAdj:      { fontSize: 13, fontFamily: "Pretendard-Regular" },
  studentFinal:    { fontSize: 14, fontFamily: "Pretendard-Regular" },

  // 상세 패널
  detailPanel:     { borderTopWidth: 1, paddingVertical: 12, gap: 0 },
  detailSection:   { gap: 8, paddingVertical: 4 },
  detailRow:       { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  detailLabel:     { fontSize: 13, fontFamily: "Pretendard-Regular" },
  detailValue:     { fontSize: 13, fontFamily: "Pretendard-Regular" },
  detailDivider:   { height: 1, marginVertical: 8 },

  // 조정 입력
  adjSection:      { gap: 8, paddingVertical: 4 },
  adjTitle:        { fontSize: 14, fontFamily: "Pretendard-Regular" },
  adjInputRow:     { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, height: 44 },
  adjPrefix:       { fontSize: 15, fontFamily: "Pretendard-Regular", marginRight: 6 },
  adjInput:        { flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular" },
  reasonRow:       { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  reasonBtn:       { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  reasonTxt:       { fontSize: 12, fontFamily: "Pretendard-Regular" },
  memoInput:       { borderWidth: 1.5, borderRadius: 10, padding: 10, fontSize: 13, fontFamily: "Pretendard-Regular", minHeight: 40 },

  // 반영 예정
  finalRow:        { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 10, borderRadius: 10, marginTop: 4 },
  finalLabel:      { fontSize: 14, fontFamily: "Pretendard-Regular" },
  finalAmt:        { fontSize: 16, fontFamily: "Pretendard-Regular" },

  // unpriced
  unpricedRow:     { paddingVertical: 12, gap: 8, borderBottomWidth: 1 },
  unpricedLabel:   { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, alignSelf: "flex-start" as any },
  unpricedLabelTxt:{ fontSize: 12, fontFamily: "Pretendard-Regular" },

  // 메시지
  msgBox:          { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1 },
  msgText:         { fontSize: 13, fontFamily: "Pretendard-Regular", flex: 1, lineHeight: 19 },

  // 저장 버튼
  saveBtn:         { height: 54, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  saveBtnText:     { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" },
  confirmedBox:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 16, borderRadius: 16 },
  confirmedTxt:    { fontSize: 14, fontFamily: "Pretendard-Regular" },
});
