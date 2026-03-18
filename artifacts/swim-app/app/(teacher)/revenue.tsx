/**
 * (teacher)/revenue.tsx — 매출계산기 탭
 * 
 * 이번 달 총 매출 / 회원별 수업 횟수 / 보강/체험/임시이동 카운팅
 * 기타 수기 정산 / 이번 달 정산 저장 / 다음 달 정산 시작
 */
import { Feather } from "@expo/vector-icons";
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
  total_trial_sessions: number; total_temp_transfer_sessions: number; month: string;
}

type SubmitStatus = "미정산" | "저장됨" | "제출완료" | "관리자확인";

const STATUS_COLOR: Record<SubmitStatus, { bg: string; text: string }> = {
  "미정산":    { bg: "#F3F4F6", text: "#6B7280" },
  "저장됨":    { bg: "#DBEAFE", text: "#2563EB" },
  "제출완료":  { bg: "#D1FAE5", text: "#059669" },
  "관리자확인": { bg: "#EDE9FE", text: "#7C3AED" },
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [calcRes, statusRes] = await Promise.all([
        apiRequest(token, `/settlement/calculator?pool_id=${poolId}&month=${month}`),
        apiRequest(token, `/settlement/my-status?pool_id=${poolId}&month=${month}`).catch(() => null),
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
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token, poolId, month]);

  useEffect(() => { load(); }, [load]);

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

  const totalRevenue = (summary?.total_revenue || 0) + parseInt(extraAmount || "0", 10);

  return (
    <SafeAreaView style={rv.safe} edges={["top"]}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 80 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={themeColor} />}
      >
        {/* 월 선택 */}
        <View style={[rv.monthRow, { backgroundColor: C.card }]}>
          <Pressable onPress={() => changeMonth(-1)} style={rv.navBtn}>
            <Feather name="chevron-left" size={22} color={themeColor} />
          </Pressable>
          <Text style={[rv.monthText, { color: C.text }]}>{month.replace("-", "년 ")}월 정산</Text>
          <Pressable onPress={() => changeMonth(1)} style={rv.navBtn}>
            <Feather name="chevron-right" size={22} color={themeColor} />
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator color={themeColor} style={{ marginTop: 60 }} />
        ) : (
          <>
            {/* ─── 정산 상태 배지 ──────────────────────── */}
            <View style={rv.statusRow}>
              <View style={[rv.statusBadge, { backgroundColor: STATUS_COLOR[submitStatus].bg }]}>
                <Feather
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
              <Text style={rv.summaryLabel}>이번 달 예상 매출</Text>
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
                <Feather name="bar-chart-2" size={15} color={themeColor} />
                <Text style={[rv.sectionTitle, { color: C.text }]}>이번 달 정산 요약</Text>
              </View>
              <View style={rv.summaryGrid}>
                {[
                  { label: "수업인원", val: students.length, color: C.text },
                  { label: "수업시간", val: summary?.total_sessions ?? 0, color: C.text },
                  { label: "보강", val: summary?.total_makeup_sessions ?? 0, color: "#7C3AED" },
                  { label: "체험수업", val: summary?.total_trial_sessions ?? 0, color: "#059669" },
                  { label: "이동", val: summary?.total_temp_transfer_sessions ?? 0, color: "#2563EB" },
                  { label: "연기", val: 0, color: "#D97706" },
                  { label: "탈퇴", val: students.filter(s => s.is_unregistered).length, color: "#EF4444" },
                ].map(item => (
                  <View key={item.label} style={rv.summaryGridBox}>
                    <Text style={[rv.summaryGridVal, { color: item.color }]}>{item.val}</Text>
                    <Text style={[rv.summaryGridLabel, { color: C.textMuted }]}>{item.label}</Text>
                  </View>
                ))}
              </View>
            </View>

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
                      {s.is_trial && <View style={[rv.tag, { backgroundColor: "#FEF3C7" }]}><Text style={[rv.tagText, { color: "#D97706" }]}>체험</Text></View>}
                      {s.is_unregistered && <View style={[rv.tag, { backgroundColor: "#F3F4F6" }]}><Text style={[rv.tagText, { color: "#6B7280" }]}>미등록</Text></View>}
                      {s.temp_transfer_sessions > 0 && <View style={[rv.tag, { backgroundColor: "#EDE9FE" }]}><Text style={[rv.tagText, { color: "#7C3AED" }]}>임시이동</Text></View>}
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
                <Text style={[rv.totalLabel, { color: C.text }]}>소계</Text>
                <Text style={[rv.totalAmount, { color: C.text }]}>{formatWon(summary?.total_revenue || 0)}</Text>
              </View>
            </View>

            {/* ─── 기타 수기 정산 ─────────────────────── */}
            <View style={[rv.card, { backgroundColor: C.card }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Feather name="edit" size={15} color={themeColor} />
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
                  <Feather name="plus-circle" size={14} color={themeColor} />
                  <Text style={[rv.extraSummaryText, { color: themeColor }]}>
                    기타 정산 포함 총액: {formatWon(totalRevenue)}
                  </Text>
                </View>
              ) : null}
            </View>

            {/* ─── 저장 메시지 ─────────────────────────── */}
            {savedMsg ? (
              <View style={[rv.msg, { backgroundColor: savedMsg.includes("실패") ? "#FEE2E2" : "#D1FAE5" }]}>
                <Feather name={savedMsg.includes("실패") ? "alert-circle" : "check-circle"} size={14} color={savedMsg.includes("실패") ? "#EF4444" : "#059669"} />
                <Text style={[rv.msgText, { color: savedMsg.includes("실패") ? "#DC2626" : "#065F46" }]}>{savedMsg}</Text>
              </View>
            ) : null}

            {/* ─── 버튼 ─────────────────────────────────── */}
            <Pressable
              style={[rv.saveBtn, { backgroundColor: "#6B7280", opacity: saving ? 0.6 : 1 }]}
              onPress={handleSave} disabled={saving || submitting}
            >
              {saving ? <ActivityIndicator color="#fff" /> : <>
                <Feather name="save" size={16} color="#fff" />
                <Text style={rv.saveBtnText}>임시 저장</Text>
              </>}
            </Pressable>

            <Pressable
              style={[rv.submitBtn, { backgroundColor: submitStatus === "제출완료" || submitStatus === "관리자확인" ? "#D1FAE5" : themeColor, opacity: submitting ? 0.6 : 1 }]}
              onPress={handleSubmit}
              disabled={submitting || saving || submitStatus === "관리자확인"}
            >
              {submitting ? <ActivityIndicator color={submitStatus === "제출완료" ? "#059669" : "#fff"} /> : <>
                <Feather
                  name={submitStatus === "제출완료" || submitStatus === "관리자확인" ? "check-circle" : "send"}
                  size={16}
                  color={submitStatus === "제출완료" || submitStatus === "관리자확인" ? "#059669" : "#fff"}
                />
                <Text style={[rv.submitBtnText, { color: submitStatus === "제출완료" || submitStatus === "관리자확인" ? "#059669" : "#fff" }]}>
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
              <Feather name="arrow-right-circle" size={16} color={themeColor} />
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
          <Feather name="arrow-right-circle" size={32} color={themeColor} style={{ alignSelf: "center" }} />
          <Text style={[rv.confirmTitle, { color: C.text }]}>다음 달 정산 시작</Text>
          <Text style={[rv.confirmSub, { color: C.textSecondary }]}>
            {month}월 정산을 확정하고{"\n"}{monthStr(1).replace("-", "년 ")}월 정산을 시작합니다.{"\n\n"}
            이번 달 정산을 먼저 저장한 상태에서 진행하세요.
          </Text>
          <View style={{ gap: 8 }}>
            <Pressable
              style={[rv.confirmBtn, { backgroundColor: themeColor }]}
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
            <Pressable style={[rv.confirmBtn, { backgroundColor: "#F3F4F6" }]} onPress={() => setNextMonthModal(false)}>
              <Text style={[rv.confirmBtnText, { color: C.text }]}>취소</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const rv = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: "#F3F4F6" },
  monthRow:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 16, padding: 12 },
  navBtn:           { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  monthText:        { fontSize: 17, fontFamily: "Inter_700Bold" },
  summaryCard:      { borderRadius: 18, padding: 22, gap: 14 },
  summaryLabel:     { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.8)" },
  summaryAmount:    { fontSize: 32, fontFamily: "Inter_700Bold", color: "#fff" },
  statsRow:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  statItem:         { flex: 1, alignItems: "center", gap: 2 },
  statNum:          { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff" },
  statLabel:        { fontSize: 10, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.7)" },
  statDivider:      { width: 1, height: 30, backgroundColor: "rgba(255,255,255,0.3)" },
  card:             { borderRadius: 16, padding: 16, gap: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  sectionTitle:     { fontSize: 15, fontFamily: "Inter_700Bold" },
  emptyText:        { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", paddingVertical: 24 },
  studentRow:       { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, gap: 8 },
  studentName:      { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  studentSub:       { fontSize: 12, fontFamily: "Inter_400Regular" },
  tag:              { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  tagText:          { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  settlementAmount: { fontSize: 15, fontFamily: "Inter_700Bold" },
  sessionCount:     { fontSize: 11, fontFamily: "Inter_400Regular" },
  totalRow:         { flexDirection: "row", justifyContent: "space-between", paddingTop: 10, borderTopWidth: 1, marginTop: 4 },
  totalLabel:       { fontSize: 14, fontFamily: "Inter_700Bold" },
  totalAmount:      { fontSize: 16, fontFamily: "Inter_700Bold" },
  hint:             { fontSize: 11, fontFamily: "Inter_400Regular" },
  inputBox:         { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, height: 48 },
  inputPrefix:      { fontSize: 16, fontFamily: "Inter_600SemiBold", marginRight: 8 },
  input:            { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  memoInput:        { borderWidth: 1.5, borderRadius: 12, padding: 12, fontSize: 14, fontFamily: "Inter_400Regular" },
  extraSummary:     { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10 },
  extraSummaryText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  msg:              { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12 },
  msgText:          { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },
  statusRow:        { flexDirection: "row", alignItems: "center", gap: 10 },
  statusBadge:      { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  statusTxt:        { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  statusDesc:       { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  summaryGrid:      { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  summaryGridBox:   { minWidth: "28%", flex: 1, backgroundColor: "#F9FAFB", borderRadius: 12, padding: 10, alignItems: "center", gap: 2 },
  summaryGridVal:   { fontSize: 18, fontFamily: "Inter_700Bold" },
  summaryGridLabel: { fontSize: 10, fontFamily: "Inter_400Regular" },
  saveBtn:          { height: 52, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  saveBtnText:      { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  submitBtn:        { height: 52, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  submitBtnText:    { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  nextBtn:          { height: 52, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 2 },
  nextBtnText:      { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  overlay:          { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  confirmSheet:     { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 16 },
  confirmHandle:    { width: 36, height: 4, backgroundColor: "#E5E7EB", borderRadius: 2, alignSelf: "center" },
  confirmTitle:     { fontSize: 20, fontFamily: "Inter_700Bold", textAlign: "center" },
  confirmSub:       { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
  confirmBtn:       { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  confirmBtnText:   { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
