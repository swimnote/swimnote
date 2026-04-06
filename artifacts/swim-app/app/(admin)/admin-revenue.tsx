/**
 * (admin)/admin-revenue.tsx — 관리자 매출관리 탭
 *
 * 선생님 수업 정산 및 다음 달 발생 관리 전용 탭
 * - 회원별 수업 횟수 / 보강·체험·임시이동 카운팅
 * - 기타 수기 정산 / 이번 달 저장 / 다음 달 시작
 * - 보강 이월 정리 → makeups 화면 연결
 * - 단가표 → pool-settings 화면 연결
 * - 휴무일 지정 → HolidayModal (components/admin/revenue/ 로 이동됨)
 *
 * API: /settlement/calculator, /settlement/save, /settlement/finalize
 *      /holidays (GET, POST, DELETE)
 */
import { Calendar, ChevronLeft, ChevronRight, CircleAlert, CircleArrowRight, DollarSign, List, RotateCcw, Save, Users } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useTabScrollReset } from "@/hooks/useTabScrollReset";
import { addTabResetListener } from "@/utils/tabReset";
import { HolidayModal } from "@/components/admin/revenue/HolidayModal";

const C = Colors.light;

/* ────────────────────────────────────────────────
   메인 타입
──────────────────────────────────────────────── */
interface SettlementSummary {
  total_revenue: number; total_sessions: number; total_makeup_sessions: number;
  total_trial_sessions: number; total_temp_transfer_sessions: number;
  withdrawn_count: number; postpone_count: number; month: string;
}

interface TeacherItem {
  id: string; name: string; class_count?: number; student_count?: number;
  makeup_waiting?: number; position?: string;
}

type SettlementStatus = "미정산" | "저장됨" | "제출완료" | "관리자확인";

interface TeacherReport {
  teacher_id: string;
  teacher_name: string;
  status: "draft" | "submitted" | "confirmed" | null;
  total_revenue?: number;
  total_sessions?: number;
  student_count?: number;
  makeup_count?: number;
  trial_count?: number;
  transfer_count?: number;
  postpone_count?: number;
  withdrawn_count?: number;
  extra_manual_amount?: number;
}

function apiStatusToUI(raw: string | null | undefined): SettlementStatus {
  if (raw === "submitted")  return "제출완료";
  if (raw === "confirmed")  return "관리자확인";
  if (raw === "draft")      return "저장됨";
  return "미정산";
}

function curMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function formatWon(n: number) { return n.toLocaleString("ko-KR") + "원"; }

/* ────────────────────────────────────────────────
   AdminRevenueScreen
──────────────────────────────────────────────── */
const STATUS_COLOR: Record<SettlementStatus, { bg: string; text: string }> = {
  "미정산":    { bg: "#FFFFFF", text: "#64748B" },
  "저장됨":    { bg: "#E6FAF8", text: "#0F172A" },
  "제출완료":  { bg: "#E6FAF8", text: "#0F172A" },
  "관리자확인": { bg: "#E6FAF8", text: "#0F172A" },
};

export default function AdminRevenueScreen() {
  const { token, adminUser } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();
  const scrollRef = useTabScrollReset("admin-revenue");

  const [month, setMonth]       = useState(curMonthStr());
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary]   = useState<SettlementSummary | null>(null);
  const [teachers, setTeachers] = useState<TeacherItem[]>([]);
  const [reports, setReports]   = useState<TeacherReport[]>([]);
  const [extraAmount, setExtraAmount] = useState("");
  const [extraMemo, setExtraMemo]     = useState("");
  const [saving, setSaving]     = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [nextMonthModal, setNextMonthModal] = useState(false);
  const [holiModal, setHoliModal]           = useState(false);

  const poolId = (adminUser as any)?.swimming_pool_id || "";
  const { backTo } = useLocalSearchParams<{ backTo?: string }>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [calcRes, teacherRes, reportRes] = await Promise.all([
        apiRequest(token, `/settlement/calculator?pool_id=${poolId}&month=${month}`),
        apiRequest(token, "/admin/teachers"),
        apiRequest(token, `/settlement/reports?pool_id=${poolId}&month=${month}`).catch(() => null),
      ]);
      if (calcRes.ok) {
        const data = await calcRes.json();
        setSummary(data.summary);
      }
      if (teacherRes.ok) {
        const tData = await teacherRes.json();
        setTeachers(Array.isArray(tData) ? tData : []);
      }
      if (reportRes && reportRes.ok) {
        const rData = await reportRes.json();
        setReports(Array.isArray(rData) ? rData : (rData.reports || []));
      } else {
        setReports([]);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token, poolId, month]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    return addTabResetListener("admin-revenue", () => setMonth(curMonthStr()));
  }, []);

  function changeMonth(delta: number) {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  async function handleSave() {
    setSaving(true); setSavedMsg("");
    try {
      const res = await apiRequest(token, "/settlement/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pool_id: poolId, month,
          extra_amount: Number(extraAmount) || 0,
          extra_memo: extraMemo,
        }),
      });
      setSavedMsg(res.ok ? "저장 완료" : "저장 실패");
    } catch { setSavedMsg("저장 실패"); }
    finally { setSaving(false); setTimeout(() => setSavedMsg(""), 2000); }
  }

  const TAB_BAR_H = 84;
  const pBottom   = insets.bottom + TAB_BAR_H + 24;

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      {backTo ? (
        <SubScreenHeader title="수업정산" />
      ) : (
        <View style={[s.tabHeader, { paddingTop: insets.top + 14 }]}>
          <Text style={[s.tabHeaderTitle, { color: themeColor }]}>수업정산</Text>
        </View>
      )}

      {/* ── 월 선택 + 휴무일 지정 바 ── */}
      <View style={[s.topBar, { borderBottomColor: C.border }]}>
        <View style={s.monthNav}>
          <Pressable style={s.monthArrow} onPress={() => changeMonth(-1)} hitSlop={8}>
            <ChevronLeft size={20} color={themeColor} />
          </Pressable>
          <Text style={[s.monthLabel, { color: C.text }]}>
            {month.replace("-", "년 ")}월
          </Text>
          <Pressable style={s.monthArrow} onPress={() => changeMonth(1)} hitSlop={8}>
            <ChevronRight size={20} color={themeColor} />
          </Pressable>
        </View>

        <Pressable
          style={[s.holiBtn, { backgroundColor: "#E6FAF8", borderColor: "#CBD5E1" }]}
          onPress={() => setHoliModal(true)}
        >
          <Calendar size={14} color="#0F172A" />
          <Text style={s.holiBtnTxt}>휴무일 지정</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={themeColor} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          ref={scrollRef}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={themeColor} />}
          contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: pBottom }}
          showsVerticalScrollIndicator={false}
        >
          {/* ── 바로가기 버튼 ── */}
          <View style={s.quickRow}>
            <Pressable style={[s.quickBtn, { backgroundColor: "#E6FAF8" }]}
              onPress={() => router.push("/(admin)/makeups?backTo=admin-revenue" as any)}>
              <RotateCcw size={16} color="#0F172A" />
              <Text style={[s.quickLabel, { color: "#0F172A" }]}>보강 이월</Text>
            </Pressable>
            <Pressable style={[s.quickBtn, { backgroundColor: "#E6FAF8" }]}
              onPress={() => router.push("/(admin)/unit-pricing" as any)}>
              <DollarSign size={16} color="#0F172A" />
              <Text style={[s.quickLabel, { color: "#0F172A" }]}>단가표</Text>
            </Pressable>
            <Pressable style={[s.quickBtn, { backgroundColor: "#E6FAF8" }]}
              onPress={() => router.push("/(admin)/holidays?backTo=admin-revenue" as any)}>
              <List size={16} color="#0F172A" />
              <Text style={[s.quickLabel, { color: "#0F172A" }]}>휴무 목록</Text>
            </Pressable>
          </View>

          {/* ── 전체 합산 요약 (submitted 기준) ── */}
          {(() => {
            const submittedReports = reports.filter(r => r.status === "submitted" || r.status === "confirmed" || r.status === "draft");
            const totalRevenue  = submittedReports.reduce((s, r) => s + (r.total_revenue || 0), 0);
            const totalSessions = submittedReports.reduce((s, r) => s + (r.total_sessions || 0), 0);
            const totalExtra    = submittedReports.reduce((s, r) => s + (r.extra_manual_amount || 0), 0);
            const submitted     = reports.filter(r => r.status === "submitted" || r.status === "confirmed").length;
            return (
              <View style={[s.summaryCard, { borderColor: themeColor + "30" }]}>
                <View style={s.summaryTopRow}>
                  <Text style={[s.summaryLabel, { color: C.textMuted }]}>전체합산 수업금액</Text>
                  <View style={s.submitBadge}>
                    <Text style={[s.submitBadgeTxt, { color: themeColor }]}>제출 {submitted}/{teachers.length}명</Text>
                  </View>
                </View>
                <Text style={[s.summaryTotal, { color: themeColor }]}>{formatWon(totalRevenue)}</Text>
                <View style={s.summaryMetrics}>
                  <View style={[s.metricBox, { backgroundColor: themeColor + "10" }]}>
                    <Text style={[s.metricVal, { color: C.text }]}>{totalSessions}<Text style={s.metricUnit}>회</Text></Text>
                    <Text style={[s.metricLabel, { color: C.textMuted }]}>전체수업시수</Text>
                  </View>
                  <View style={[s.metricBox, { backgroundColor: "#FFF7ED" }]}>
                    <Text style={[s.metricVal, { color: "#C2410C" }]}>{formatWon(totalExtra)}</Text>
                    <Text style={[s.metricLabel, { color: C.textMuted }]}>추가수업비용</Text>
                  </View>
                </View>
                {totalSessions > 0 && totalRevenue > 0 && (
                  <Text style={[s.formulaHint, { color: C.textMuted }]}>
                    수업당 단가 ≈ {formatWon(Math.round((totalRevenue - totalExtra) / totalSessions))} / 회
                  </Text>
                )}
              </View>
            );
          })()}

          {/* ── 선생님별 정산내역 (이름순) ── */}
          <View style={s.teacherHeader}>
            <Text style={[s.sectionTitle, { color: C.text }]}>선생님별 정산내역</Text>
            <Text style={[s.teacherCount, { color: C.textMuted }]}>{teachers.length}명</Text>
          </View>

          {/* 컬럼 헤더 */}
          {teachers.length > 0 && (
            <View style={s.tableHeader}>
              <Text style={[s.colHead, { flex: 2 }]}>이름</Text>
              <Text style={[s.colHead, { flex: 2, textAlign: "right" }]}>매출</Text>
              <Text style={[s.colHead, { flex: 1, textAlign: "center" }]}>수업시수</Text>
              <Text style={[s.colHead, { flex: 2, textAlign: "right" }]}>추가수업비용</Text>
            </View>
          )}

          {teachers.length === 0 ? (
            <View style={s.emptyBox}>
              <Users size={40} color={C.textMuted} />
              <Text style={[s.emptyTxt, { color: C.textMuted }]}>등록된 선생님이 없습니다</Text>
            </View>
          ) : (
            [...teachers]
              .sort((a, b) => a.name.localeCompare(b.name, "ko"))
              .map((t, idx) => {
                const report = reports.find(r => r.teacher_id === t.id);
                const status: SettlementStatus = apiStatusToUI(report?.status);
                const statusStyle = STATUS_COLOR[status];
                const isLast = idx === teachers.length - 1;
                return (
                  <View key={t.id} style={[s.tableRow, !isLast && s.tableRowBorder]}>
                    {/* 이름 + 상태 */}
                    <View style={{ flex: 2, gap: 3 }}>
                      <Text style={[s.rowName, { color: C.text }]}>{t.name}</Text>
                      <View style={[s.statusPill, { backgroundColor: statusStyle.bg }]}>
                        <Text style={[s.statusPillTxt, { color: statusStyle.text }]}>{status}</Text>
                      </View>
                    </View>
                    {/* 매출 */}
                    <Text style={[s.rowAmt, { flex: 2, color: report?.total_revenue != null ? themeColor : C.textMuted }]}>
                      {report?.total_revenue != null ? formatWon(report.total_revenue) : "미제출"}
                    </Text>
                    {/* 수업시수 */}
                    <Text style={[s.rowVal, { flex: 1 }]}>
                      {report?.total_sessions != null ? `${report.total_sessions}회` : "—"}
                    </Text>
                    {/* 추가수업비용 */}
                    <Text style={[s.rowExtra, { flex: 2, color: (report?.extra_manual_amount || 0) > 0 ? "#C2410C" : C.textMuted }]}>
                      {(report?.extra_manual_amount || 0) > 0 ? formatWon(report!.extra_manual_amount!) : "—"}
                    </Text>
                  </View>
                );
              })
          )}

          {/* ── 기타 수기 정산 ── */}
          <Text style={[s.sectionTitle, { color: C.text }]}>기타 수기 정산</Text>
          <View style={[s.extraCard, { backgroundColor: C.card }]}>
            <View style={s.inputRow}>
              <TextInput
                style={[s.input, { color: C.text, borderColor: C.border }]}
                placeholder="금액 (원)"
                placeholderTextColor={C.textMuted}
                keyboardType="numeric"
                value={extraAmount}
                onChangeText={setExtraAmount}
              />
              <TextInput
                style={[s.inputMemo, { color: C.text, borderColor: C.border }]}
                placeholder="메모"
                placeholderTextColor={C.textMuted}
                value={extraMemo}
                onChangeText={setExtraMemo}
              />
            </View>
          </View>

          {/* ── 저장 / 다음 달 시작 ── */}
          <View style={s.actionRow}>
            <Pressable
              style={[s.actionBtn, { backgroundColor: C.button, opacity: saving ? 0.7 : 1 }]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? <ActivityIndicator size={16} color="#fff" /> : <Save size={16} color="#fff" />}
              <Text style={s.actionBtnTxt}>이번 달 저장</Text>
            </Pressable>
            <Pressable
              style={[s.actionBtn, { backgroundColor: "#2EC4B6" }]}
              onPress={() => setNextMonthModal(true)}
            >
              <CircleArrowRight size={16} color="#fff" />
              <Text style={s.actionBtnTxt}>다음 달 시작</Text>
            </Pressable>
          </View>
          {savedMsg ? <Text style={[s.savedMsg, { color: themeColor }]}>{savedMsg}</Text> : null}
        </ScrollView>
      )}

      {/* ── 다음 달 시작 확인 모달 ── */}
      <Modal visible={nextMonthModal} transparent animationType="fade" onRequestClose={() => setNextMonthModal(false)}>
        <Pressable style={s.overlay} onPress={() => setNextMonthModal(false)} />
        <View style={s.modalBox}>
          <View style={[s.modalCard, { backgroundColor: C.card }]}>
            <CircleAlert size={32} color="#0F172A" style={{ alignSelf: "center", marginBottom: 8 }} />
            <Text style={[s.modalTitle, { color: C.text }]}>다음 달 수업 발생</Text>
            <Text style={[s.modalDesc, { color: C.textSecondary }]}>
              현재 월 정산을 마무리하고{"\n"}다음 달 수업 일정을 새로 생성합니다.{"\n"}보강 이월도 함께 처리됩니다.
            </Text>
            <View style={s.modalBtns}>
              <Pressable style={[s.modalBtn, { backgroundColor: "#FFFFFF" }]} onPress={() => setNextMonthModal(false)}>
                <Text style={[s.modalBtnTxt, { color: C.textSecondary }]}>취소</Text>
              </Pressable>
              <Pressable
                style={[s.modalBtn, { backgroundColor: "#2EC4B6" }]}
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
                <Text style={[s.modalBtnTxt, { color: "#fff" }]}>확인</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── 휴무일 지정 모달 ── */}
      <HolidayModal
        visible={holiModal}
        onClose={() => setHoliModal(false)}
        poolId={poolId}
        token={token}
        themeColor={themeColor}
      />
    </View>
  );
}

/* ────────────────────────────────────────────────
   Styles — AdminRevenueScreen
──────────────────────────────────────────────── */
const s = StyleSheet.create({
  tabHeader:      { backgroundColor: "#fff", paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  tabHeaderTitle: { fontSize: 20, fontFamily: "Pretendard-Regular" },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1 },
  monthNav: { flexDirection: "row", alignItems: "center", gap: 8 },
  monthArrow: { padding: 4 },
  monthLabel: { fontSize: 16, fontFamily: "Pretendard-Regular", minWidth: 90, textAlign: "center" },
  holiBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1.5 },
  holiBtnTxt: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A" },

  quickRow: { flexDirection: "row", gap: 8 },
  quickBtn: { flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "center", borderRadius: 12, paddingVertical: 12, gap: 4 },
  quickLabel: { fontSize: 12, fontFamily: "Pretendard-Regular" },

  summaryCard:    { borderRadius: 16, padding: 16, borderWidth: 1.5, backgroundColor: Colors.light.card, gap: 8 },
  summaryTopRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  summaryLabel:   { fontSize: 12, fontFamily: "Pretendard-Regular" },
  summaryTotal:   { fontSize: 26, fontFamily: "Pretendard-Regular" },
  submitBadge:    { backgroundColor: "#F0FFF4", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3 },
  submitBadgeTxt: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  summaryMetrics: { flexDirection: "row", gap: 10, marginTop: 4 },
  metricBox:      { flex: 1, borderRadius: 12, padding: 12, gap: 4, alignItems: "center" },
  metricVal:      { fontSize: 18, fontFamily: "Pretendard-Regular" },
  metricUnit:     { fontSize: 12, fontFamily: "Pretendard-Regular" },
  metricLabel:    { fontSize: 11, fontFamily: "Pretendard-Regular" },
  formulaHint:    { fontSize: 11, fontFamily: "Pretendard-Regular", textAlign: "right", marginTop: 2 },

  sectionTitle: { fontSize: 15, fontFamily: "Pretendard-Regular", marginTop: 4 },

  emptyBox: { alignItems: "center", paddingVertical: 40, gap: 8 },
  emptyTxt: { fontSize: 14, fontFamily: "Pretendard-Regular" },

  teacherHeader:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  teacherCount:   { fontSize: 13, fontFamily: "Pretendard-Regular" },

  tableHeader:    { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 8,
                    backgroundColor: "#F8FAFC", borderRadius: 10, borderWidth: 1, borderColor: Colors.light.border },
  colHead:        { fontSize: 11, fontFamily: "Pretendard-Regular", color: Colors.light.textMuted },

  tableRow:       { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 14,
                    backgroundColor: Colors.light.card, marginTop: 1 },
  tableRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  rowName:        { fontSize: 14, fontFamily: "Pretendard-Regular" },
  statusPill:     { alignSelf: "flex-start", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, marginTop: 3 },
  statusPillTxt:  { fontSize: 10, fontFamily: "Pretendard-Regular" },
  rowAmt:         { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "right" },
  rowVal:         { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center", color: Colors.light.text },
  rowExtra:       { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "right" },

  statusBadge:    { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusTxt:      { fontSize: 12, fontFamily: "Pretendard-Regular" },

  extraCard: { borderRadius: 14, padding: 14 },
  inputRow: { flexDirection: "row", gap: 8 },
  input: { width: 110, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, fontFamily: "Pretendard-Regular" },
  inputMemo: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, fontFamily: "Pretendard-Regular" },

  actionRow: { flexDirection: "row", gap: 10 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 14, borderRadius: 14 },
  actionBtnTxt: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
  savedMsg: { textAlign: "center", fontSize: 13, fontFamily: "Pretendard-Regular" },

  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.4)" },
  modalBox: { ...StyleSheet.absoluteFillObject, justifyContent: "center", alignItems: "center", padding: 24, pointerEvents: "box-none" },
  modalCard: { borderRadius: 20, padding: 24, width: "100%", maxWidth: 340, gap: 12 },
  modalTitle: { fontSize: 18, fontFamily: "Pretendard-Regular", textAlign: "center" },
  modalDesc: { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 20 },
  modalBtns: { flexDirection: "row", gap: 10, marginTop: 4 },
  modalBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: "center" },
  modalBtnTxt: { fontSize: 15, fontFamily: "Pretendard-Regular" },
});
