/**
 * (teacher)/revenue.tsx — 매출계산기 탭
 * 
 * 이번 달 총 매출 / 회원별 수업 횟수 / 보강/체험/임시이동 카운팅
 * 기타 수기 정산 / 이번 달 정산 저장 / 다음 달 정산 시작
 */
import { ChartBar, ChevronLeft, ChevronRight, CircleArrowRight, CircleCheck, CircleDollarSign, CircleMinus, CirclePlus, Pencil, Save } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { useTabScrollReset } from "@/hooks/useTabScrollReset";
import { addTabResetListener } from "@/utils/tabReset";

const FEE_CHECK_KEY    = "@swimnote:fee_check_enabled";
function feeStorageKey(userId: string, ym: string) {
  return `@swimnote:fee:${userId}:${ym}`;
}
interface FeeEntry { name: string; amount: string; paid: boolean; }
type FeeMap = Record<string, FeeEntry>;

const C = Colors.light;

interface PricingItem { type_key: string; type_name: string; monthly_fee: number; sessions_per_month: number; }
interface StudentSummary {
  student_id: string; student_name: string; class_type: string;
  is_trial: boolean; is_unregistered: boolean;
  regular_sessions: number; makeup_sessions: number; trial_sessions: number;
  temp_transfer_sessions: number; extra_sessions: number; total_sessions: number;
  monthly_fee: number; settlement_amount: number;
}
interface SettlementSummary {
  total_revenue: number; total_sessions: number; total_makeup_sessions: number;
  total_trial_sessions: number; total_temp_transfer_sessions: number;
  withdrawn_count: number; postpone_count: number; month: string;
}

type SubmitStatus = "미정산" | "저장됨" | "제출완료" | "관리자확인";

const STATUS_COLOR: Record<SubmitStatus, { bg: string; text: string }> = {
  "미정산":    { bg: "#FFFFFF", text: "#64748B" },
  "저장됨":    { bg: "#E6FFFA", text: "#2EC4B6" },
  "제출완료":  { bg: "#E6FFFA", text: "#2EC4B6" },
  "관리자확인": { bg: "#EEDDF5", text: "#7C3AED" },
};

function monthStr(offset = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function formatWon(n: number) { return n.toLocaleString("ko-KR") + "원"; }

export default function RevenueScreen() {
  const { token, adminUser } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();
  const scrollRef = useTabScrollReset("revenue");
  const [month, setMonth] = useState(monthStr());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState<SettlementSummary | null>(null);
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [pricing, setPricing] = useState<PricingItem[]>([]);
  const [extraAmount, setExtraAmount] = useState("");
  const [extraMemo, setExtraMemo] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("미정산");
  const [nextMonthModal, setNextMonthModal] = useState(false);

  const poolId = (adminUser as any)?.swimming_pool_id || "";
  const userId = adminUser?.id ?? "unknown";

  /* ── 납부 체크 상태 ── */
  const [feeCheckEnabled, setFeeCheckEnabled] = useState(false);
  const [feeMap, setFeeMap]                   = useState<FeeMap>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [calcRes, statusRes, feeEnabledRaw, feeRaw] = await Promise.all([
        apiRequest(token, `/settlement/calculator?pool_id=${poolId}&month=${month}`),
        apiRequest(token, `/settlement/my-status?pool_id=${poolId}&month=${month}`).catch(() => null),
        AsyncStorage.getItem(FEE_CHECK_KEY),
        AsyncStorage.getItem(feeStorageKey(userId, month)),
      ]);
      if (calcRes.ok) {
        const data = await calcRes.json();
        setSummary(data.summary);
        setStudents(data.students || []);
        setPricing(data.pricing || []);
      }
      if (statusRes && statusRes.ok) {
        const sd = await statusRes.json();
        const rawStatus = sd.status;
        if (rawStatus === "submitted") setSubmitStatus("제출완료");
        else if (rawStatus === "confirmed") setSubmitStatus("관리자확인");
        else if (rawStatus === "draft") setSubmitStatus("저장됨");
        else setSubmitStatus("미정산");
      } else {
        setSubmitStatus("미정산");
      }
      setFeeCheckEnabled(feeEnabledRaw === "1");
      setFeeMap(feeRaw ? JSON.parse(feeRaw) : {});
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token, poolId, month, userId]);

  useEffect(() => { load(); }, [load]);

  // 같은 탭 재탭 시 → 현재 월로 초기화
  useEffect(() => {
    return addTabResetListener("revenue", () => setMonth(monthStr()));
  }, []);

  function changeMonth(delta: number) {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  async function doSave(status: "draft" | "submitted") {
    const res = await apiRequest(token, "/settlement/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pool_id: poolId, month, summary, students,
        extra_manual_amount: parseInt(extraAmount || "0", 10),
        extra_manual_memo: extraMemo || null,
        status,
      }),
    });
    return res.json();
  }

  async function handleSave() {
    setSaving(true); setSavedMsg("");
    try {
      const data = await doSave("draft");
      if (data.success) {
        setSubmitStatus("저장됨");
        setSavedMsg("정산이 저장되었습니다.");
        setTimeout(() => setSavedMsg(""), 3000);
      } else { setSavedMsg("저장 실패: " + data.error); }
    } catch { setSavedMsg("저장 중 오류"); }
    finally { setSaving(false); }
  }

  async function handleSubmit() {
    setSubmitting(true); setSavedMsg("");
    try {
      const data = await doSave("submitted");
      if (data.success !== false) {
        setSubmitStatus("제출완료");
        setSavedMsg("정산이 제출되었습니다. 관리자에게 보고됩니다.");
        setTimeout(() => setSavedMsg(""), 4000);
      } else { setSavedMsg("제출 실패: " + (data.error || "알 수 없는 오류")); }
    } catch { setSavedMsg("제출 중 오류"); }
    finally { setSubmitting(false); }
  }

  function getPricingName(key: string) {
    return pricing.find(p => p.type_key === key)?.type_name || key;
  }

  // 납부 기능 활성화 시: 납부 확정된 학생의 수령액만 매출로 계산
  const paidOnlyRevenue = feeCheckEnabled
    ? Object.values(feeMap as Record<string, { paid: boolean; amount: string }>)
        .filter(e => e.paid)
        .reduce((s, e) => s + (parseInt(e.amount || "0", 10)), 0)
    : (summary?.total_revenue || 0);
  const totalRevenue = paidOnlyRevenue + parseInt(extraAmount || "0", 10);

  return (
    <SafeAreaView style={rv.safe} edges={[]}>
      <View style={[rv.tabHeader, { paddingTop: insets.top + 14 }]}>
        <Text style={[rv.tabHeaderTitle, { color: themeColor }]}>정산</Text>
      </View>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 80 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={themeColor} />}
      >
        {/* 월 선택 */}
        <View style={[rv.monthRow, { backgroundColor: C.card }]}>
          <Pressable onPress={() => changeMonth(-1)} style={rv.navBtn}>
            <ChevronLeft size={22} color={themeColor} />
          </Pressable>
          <Text style={[rv.monthText, { color: C.text }]}>{month.replace("-", "년 ")}월 정산</Text>
          <Pressable onPress={() => changeMonth(1)} style={rv.navBtn}>
            <ChevronRight size={22} color={themeColor} />
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator color={themeColor} style={{ marginTop: 60 }} />
        ) : (
          <>
            {/* ─── 정산 상태 배지 ──────────────────────── */}
            <View style={rv.statusRow}>
              <View style={[rv.statusBadge, { backgroundColor: STATUS_COLOR[submitStatus].bg }]}>
                <LucideIcon
                  name={submitStatus === "제출완료" || submitStatus === "관리자확인" ? "check-circle" : submitStatus === "저장됨" ? "save" : "clock"}
                  size={13}
                  color={STATUS_COLOR[submitStatus].text}
                />
                <Text style={[rv.statusTxt, { color: STATUS_COLOR[submitStatus].text }]}>{submitStatus}</Text>
              </View>
              <Text style={[rv.statusDesc, { color: C.textMuted }]}>
                {submitStatus === "제출완료" ? "관리자에게 보고됨" :
                 submitStatus === "저장됨" ? "임시 저장 상태" :
                 submitStatus === "관리자확인" ? "관리자가 확인했습니다" : "아직 제출하지 않았습니다"}
              </Text>
            </View>

            {/* ─── 상단 요약 카드 ─────────────────────── */}
            <View style={[rv.summaryCard, { backgroundColor: themeColor }]}>
              <Text style={rv.summaryLabel}>{feeCheckEnabled ? "이번 달 납부 수령액" : "이번 달 예상 매출"}</Text>
              <Text style={rv.summaryAmount}>{formatWon(totalRevenue)}</Text>
              <View style={rv.statsRow}>
                <View style={rv.statItem}>
                  <Text style={rv.statNum}>{summary?.total_sessions || 0}</Text>
                  <Text style={rv.statLabel}>수업</Text>
                </View>
                <View style={rv.statDivider} />
                <View style={rv.statItem}>
                  <Text style={rv.statNum}>{summary?.total_makeup_sessions || 0}</Text>
                  <Text style={rv.statLabel}>보강</Text>
                </View>
                <View style={rv.statDivider} />
                <View style={rv.statItem}>
                  <Text style={rv.statNum}>{summary?.total_trial_sessions || 0}</Text>
                  <Text style={rv.statLabel}>체험</Text>
                </View>
                <View style={rv.statDivider} />
                <View style={rv.statItem}>
                  <Text style={rv.statNum}>{summary?.total_temp_transfer_sessions || 0}</Text>
                  <Text style={rv.statLabel}>이동</Text>
                </View>
              </View>
            </View>

            {/* ─── 정산 요약 카드 (상세 통계) ─────────── */}
            <View style={[rv.card, { backgroundColor: C.card }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <ChartBar size={15} color={themeColor} />
                <Text style={[rv.sectionTitle, { color: C.text }]}>이번 달 정산 요약</Text>
              </View>
              <View style={rv.summaryGrid}>
                {[
                  { label: "수업인원", val: students.length, color: C.text },
                  { label: "수업시간", val: summary?.total_sessions ?? 0, color: C.text },
                  { label: "보강", val: summary?.total_makeup_sessions ?? 0, color: "#7C3AED" },
                  { label: "체험수업", val: summary?.total_trial_sessions ?? 0, color: "#2EC4B6" },
                  { label: "이동", val: summary?.total_temp_transfer_sessions ?? 0, color: "#2EC4B6" },
                  { label: "연기", val: summary?.postpone_count ?? 0, color: "#D97706" },
                  { label: "탈퇴", val: summary?.withdrawn_count ?? students.filter(s => s.is_unregistered).length, color: "#D96C6C" },
                ].map(item => (
                  <View key={item.label} style={rv.summaryGridBox}>
                    <Text style={[rv.summaryGridVal, { color: item.color }]}>{item.val}</Text>
                    <Text style={[rv.summaryGridLabel, { color: C.textMuted }]}>{item.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* ─── 납부 수령 현황 카드 (납부 기능 켰을 때만) ── */}
            {feeCheckEnabled && (() => {
              const entries     = Object.values(feeMap) as FeeEntry[];
              const paidList    = entries.filter(e => e.paid);
              const totalPaid   = paidList.reduce((s, e) => s + (parseInt(e.amount || "0", 10)), 0);
              const unpaidCount = entries.length - paidList.length;
              return (
                <View style={[rv.card, { backgroundColor: C.card }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 }}>
                    <CircleDollarSign size={15} color={themeColor} />
                    <Text style={[rv.sectionTitle, { color: C.text }]}>납부 수령 현황</Text>
                    <Pressable
                      style={{ marginLeft: "auto" as any, flexDirection: "row", alignItems: "center", gap: 4 }}
                      onPress={() => router.push("/(teacher)/fee-check" as any)}
                    >
                      <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: themeColor }}>관리</Text>
                      <ChevronRight size={13} color={themeColor} />
                    </Pressable>
                  </View>
                  <View style={rv.feeRow}>
                    <View style={[rv.feeChip, { backgroundColor: themeColor + "12" }]}>
                      <CircleCheck size={14} color={themeColor} />
                      <Text style={[rv.feeChipText, { color: themeColor }]}>납부 {paidList.length}명</Text>
                    </View>
                    <View style={[rv.feeChip, { backgroundColor: "#FEF2F2" }]}>
                      <CircleMinus size={14} color="#DC2626" />
                      <Text style={[rv.feeChipText, { color: "#DC2626" }]}>미납 {unpaidCount}명</Text>
                    </View>
                  </View>
                  <View style={[rv.feeTotalRow, { borderTopColor: C.border }]}>
                    <Text style={[rv.feeTotalLabel, { color: C.textMuted }]}>총 납부액</Text>
                    <Text style={[rv.feeTotalAmt, { color: themeColor }]}>{totalPaid.toLocaleString("ko-KR")}원</Text>
                  </View>
                </View>
              );
            })()}

            {/* ─── 회원별 리스트 ───────────────────────── */}
            <View style={[rv.card, { backgroundColor: C.card }]}>
              <Text style={[rv.sectionTitle, { color: C.text }]}>회원별 정산 내역</Text>
              {students.length === 0 ? (
                <Text style={[rv.emptyText, { color: C.textMuted }]}>이번 달 수업 기록이 없습니다.</Text>
              ) : students.map(s => (
                <View key={s.student_id} style={[rv.studentRow, { borderColor: C.border }]}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={[rv.studentName, { color: C.text }]}>{s.student_name}</Text>
                      {s.is_trial && <View style={[rv.tag, { backgroundColor: "#FFF1BF" }]}><Text style={[rv.tagText, { color: "#D97706" }]}>체험</Text></View>}
                      {s.is_unregistered && <View style={[rv.tag, { backgroundColor: "#FFFFFF" }]}><Text style={[rv.tagText, { color: "#64748B" }]}>미등록</Text></View>}
                      {s.temp_transfer_sessions > 0 && <View style={[rv.tag, { backgroundColor: "#EEDDF5" }]}><Text style={[rv.tagText, { color: "#7C3AED" }]}>임시이동</Text></View>}
                    </View>
                    <Text style={[rv.studentSub, { color: C.textSecondary }]}>
                      {getPricingName(s.class_type)} · 진행 {s.total_sessions}회
                      {s.makeup_sessions > 0 ? ` (보강 ${s.makeup_sessions})` : ""}
                      {s.temp_transfer_sessions > 0 ? ` (이동 ${s.temp_transfer_sessions})` : ""}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 2 }}>
                    <Text style={[rv.settlementAmount, { color: themeColor }]}>{formatWon(s.settlement_amount)}</Text>
                    <Text style={[rv.sessionCount, { color: C.textMuted }]}>
                      {s.regular_sessions + s.extra_sessions}/{pricing.find(p => p.type_key === s.class_type)?.sessions_per_month || 4}회
                    </Text>
                  </View>
                </View>
              ))}
              <View style={[rv.totalRow, { borderTopColor: C.border }]}>
                <Text style={[rv.totalLabel, { color: C.text }]}>{feeCheckEnabled ? "납부 수령 소계" : "소계"}</Text>
                <Text style={[rv.totalAmount, { color: C.text }]}>{formatWon(paidOnlyRevenue)}</Text>
              </View>
            </View>

            {/* ─── 기타 수기 정산 ─────────────────────── */}
            <View style={[rv.card, { backgroundColor: C.card }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Pencil size={15} color={themeColor} />
                <Text style={[rv.sectionTitle, { color: C.text }]}>기타 수기 정산</Text>
              </View>
              <Text style={[rv.hint, { color: C.textMuted }]}>시간표에 없는 예외적인 항목에만 사용하세요.</Text>
              <View style={[rv.inputBox, { borderColor: C.border }]}>
                <Text style={[rv.inputPrefix, { color: C.textSecondary }]}>₩</Text>
                <TextInput
                  style={[rv.input, { color: C.text }]}
                  value={extraAmount}
                  onChangeText={v => setExtraAmount(v.replace(/[^0-9]/g, ""))}
                  placeholder="금액 (원)"
                  placeholderTextColor={C.textMuted}
                  keyboardType="number-pad"
                />
              </View>
              <TextInput
                style={[rv.memoInput, { borderColor: C.border, color: C.text }]}
                value={extraMemo}
                onChangeText={setExtraMemo}
                placeholder="메모 (예: 특별 수업비 등)"
                placeholderTextColor={C.textMuted}
              />
              {extraAmount ? (
                <View style={[rv.extraSummary, { backgroundColor: themeColor + "10" }]}>
                  <CirclePlus size={14} color={themeColor} />
                  <Text style={[rv.extraSummaryText, { color: themeColor }]}>
                    기타 정산 포함 총액: {formatWon(totalRevenue)}
                  </Text>
                </View>
              ) : null}
            </View>

            {/* ─── 저장 메시지 ─────────────────────────── */}
            {savedMsg ? (
              <View style={[rv.msg, { backgroundColor: savedMsg.includes("실패") ? "#F9DEDA" : "#E6FFFA" }]}>
                <LucideIcon name={savedMsg.includes("실패") ? "alert-circle" : "check-circle"} size={14} color={savedMsg.includes("실패") ? "#D96C6C" : "#2EC4B6"} />
                <Text style={[rv.msgText, { color: savedMsg.includes("실패") ? "#D96C6C" : "#065F46" }]}>{savedMsg}</Text>
              </View>
            ) : null}

            {/* ─── 버튼 ─────────────────────────────────── */}
            <Pressable
              style={[rv.saveBtn, { backgroundColor: "#64748B", opacity: saving ? 0.6 : 1 }]}
              onPress={handleSave} disabled={saving || submitting}
            >
              {saving ? <ActivityIndicator color="#fff" /> : <>
                <Save size={16} color="#fff" />
                <Text style={rv.saveBtnText}>임시 저장</Text>
              </>}
            </Pressable>

            <Pressable
              style={[rv.submitBtn, { backgroundColor: submitStatus === "제출완료" || submitStatus === "관리자확인" ? "#E6FFFA" : themeColor, opacity: submitting ? 0.6 : 1 }]}
              onPress={handleSubmit}
              disabled={submitting || saving || submitStatus === "관리자확인"}
            >
              {submitting ? <ActivityIndicator color={submitStatus === "제출완료" ? "#2EC4B6" : "#fff"} /> : <>
                <LucideIcon
                  name={submitStatus === "제출완료" || submitStatus === "관리자확인" ? "check-circle" : "send"}
                  size={16}
                  color={submitStatus === "제출완료" || submitStatus === "관리자확인" ? "#2EC4B6" : "#fff"}
                />
                <Text style={[rv.submitBtnText, { color: submitStatus === "제출완료" || submitStatus === "관리자확인" ? "#2EC4B6" : "#fff" }]}>
                  {submitStatus === "제출완료" ? "제출완료 (재제출 가능)" :
                   submitStatus === "관리자확인" ? "관리자 확인 완료" :
                   "이번 달 정산 제출"}
                </Text>
              </>}
            </Pressable>

            <Pressable
              style={[rv.nextBtn, { borderColor: themeColor }]}
              onPress={() => setNextMonthModal(true)}
            >
              <CircleArrowRight size={16} color={themeColor} />
              <Text style={[rv.nextBtnText, { color: themeColor }]}>다음 달 정산 시작</Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      {/* ── 다음 달 시작 확인 모달 ─────────────────────── */}
      <Modal visible={nextMonthModal} transparent animationType="fade" onRequestClose={() => setNextMonthModal(false)}>
        <Pressable style={rv.overlay} onPress={() => setNextMonthModal(false)} />
        <View style={rv.confirmSheet}>
          <View style={rv.confirmHandle} />
          <CircleArrowRight size={32} color={themeColor} style={{ alignSelf: "center" }} />
          <Text style={[rv.confirmTitle, { color: C.text }]}>다음 달 정산 시작</Text>
          <Text style={[rv.confirmSub, { color: C.textSecondary }]}>
            {month}월 정산을 확정하고{"\n"}{monthStr(1).replace("-", "년 ")}월 정산을 시작합니다.{"\n\n"}
            이번 달 정산을 먼저 저장한 상태에서 진행하세요.
          </Text>
          <View style={{ gap: 8 }}>
            <Pressable
              style={[rv.confirmBtn, { backgroundColor: C.button }]}
              onPress={async () => {
                try {
                  await apiRequest(token, "/settlement/finalize", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ pool_id: poolId, month }),
                  });
                  setNextMonthModal(false);
                  changeMonth(1);
                } catch { setNextMonthModal(false); }
              }}
            >
              <Text style={rv.confirmBtnText}>확정 후 다음 달 시작</Text>
            </Pressable>
            <Pressable style={[rv.confirmBtn, { backgroundColor: "#FFFFFF" }]} onPress={() => setNextMonthModal(false)}>
              <Text style={[rv.confirmBtnText, { color: C.text }]}>취소</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const rv = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: "#FFFFFF" },
  tabHeader:        { backgroundColor: "#fff", paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  tabHeaderTitle:   { fontSize: 20, fontFamily: "Pretendard-Regular" },
  monthRow:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 16, padding: 12 },
  navBtn:           { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  monthText:        { fontSize: 17, fontFamily: "Pretendard-Regular" },
  summaryCard:      { borderRadius: 18, padding: 22, gap: 14 },
  summaryLabel:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: "rgba(255,255,255,0.8)" },
  summaryAmount:    { fontSize: 32, fontFamily: "Pretendard-Regular", color: "#fff" },
  statsRow:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  statItem:         { flex: 1, alignItems: "center", gap: 2 },
  statNum:          { fontSize: 20, fontFamily: "Pretendard-Regular", color: "#fff" },
  statLabel:        { fontSize: 10, fontFamily: "Pretendard-Regular", color: "rgba(255,255,255,0.7)" },
  statDivider:      { width: 1, height: 30, backgroundColor: "rgba(255,255,255,0.3)" },
  card:             { borderRadius: 16, padding: 16, gap: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  sectionTitle:     { fontSize: 15, fontFamily: "Pretendard-Regular" },
  emptyText:        { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center", paddingVertical: 24 },
  studentRow:       { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, gap: 8 },
  studentName:      { fontSize: 15, fontFamily: "Pretendard-Regular" },
  studentSub:       { fontSize: 12, fontFamily: "Pretendard-Regular" },
  tag:              { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  tagText:          { fontSize: 10, fontFamily: "Pretendard-Regular" },
  settlementAmount: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  sessionCount:     { fontSize: 11, fontFamily: "Pretendard-Regular" },
  totalRow:         { flexDirection: "row", justifyContent: "space-between", paddingTop: 10, borderTopWidth: 1, marginTop: 4 },
  totalLabel:       { fontSize: 14, fontFamily: "Pretendard-Regular" },
  totalAmount:      { fontSize: 16, fontFamily: "Pretendard-Regular" },
  hint:             { fontSize: 11, fontFamily: "Pretendard-Regular" },
  inputBox:         { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, height: 48 },
  inputPrefix:      { fontSize: 16, fontFamily: "Pretendard-Regular", marginRight: 8 },
  input:            { flex: 1, fontSize: 15, fontFamily: "Pretendard-Regular" },
  memoInput:        { borderWidth: 1.5, borderRadius: 12, padding: 12, fontSize: 14, fontFamily: "Pretendard-Regular" },
  extraSummary:     { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10 },
  extraSummaryText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  msg:              { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12 },
  msgText:          { fontSize: 13, fontFamily: "Pretendard-Regular", flex: 1 },
  statusRow:        { flexDirection: "row", alignItems: "center", gap: 10 },
  statusBadge:      { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  statusTxt:        { fontSize: 13, fontFamily: "Pretendard-Regular" },
  statusDesc:       { fontSize: 12, fontFamily: "Pretendard-Regular", flex: 1 },
  summaryGrid:      { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  summaryGridBox:   { minWidth: "28%", flex: 1, backgroundColor: "#F1F5F9", borderRadius: 12, padding: 10, alignItems: "center", gap: 2 },
  summaryGridVal:   { fontSize: 18, fontFamily: "Pretendard-Regular" },
  summaryGridLabel: { fontSize: 10, fontFamily: "Pretendard-Regular" },
  saveBtn:          { height: 52, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  saveBtnText:      { color: "#fff", fontSize: 15, fontFamily: "Pretendard-Regular" },
  submitBtn:        { height: 52, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  submitBtnText:    { fontSize: 15, fontFamily: "Pretendard-Regular" },
  nextBtn:          { height: 52, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 2 },
  nextBtnText:      { fontSize: 15, fontFamily: "Pretendard-Regular" },
  overlay:          { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  confirmSheet:     { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 16 },
  confirmHandle:    { width: 36, height: 4, backgroundColor: "#E5E7EB", borderRadius: 2, alignSelf: "center" },
  confirmTitle:     { fontSize: 20, fontFamily: "Pretendard-Regular", textAlign: "center" },
  confirmSub:       { fontSize: 14, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 22 },
  confirmBtn:       { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  confirmBtnText:   { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" },
  feeRow:           { flexDirection: "row", gap: 8, marginBottom: 12 },
  feeChip:          { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  feeChipText:      { fontSize: 13, fontFamily: "Pretendard-Regular" },
  feeTotalRow:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, paddingTop: 12 },
  feeTotalLabel:    { fontSize: 13, fontFamily: "Pretendard-Regular" },
  feeTotalAmt:      { fontSize: 18, fontFamily: "Pretendard-Regular" },
});
