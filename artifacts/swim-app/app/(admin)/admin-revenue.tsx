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
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
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
  "미정산":    { bg: "#F8FAFC", text: "#6B7280" },
  "저장됨":    { bg: "#E6FFFA", text: "#2EC4B6" },
  "제출완료":  { bg: "#E6FFFA", text: "#2EC4B6" },
  "관리자확인": { bg: "#EEDDF5", text: "#7C3AED" },
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
      <SubScreenHeader title="매출관리" />

      {/* ── 월 선택 + 휴무일 지정 바 ── */}
      <View style={[s.topBar, { borderBottomColor: C.border }]}>
        <View style={s.monthNav}>
          <Pressable style={s.monthArrow} onPress={() => changeMonth(-1)} hitSlop={8}>
            <Feather name="chevron-left" size={20} color={themeColor} />
          </Pressable>
          <Text style={[s.monthLabel, { color: C.text }]}>
            {month.replace("-", "년 ")}월
          </Text>
          <Pressable style={s.monthArrow} onPress={() => changeMonth(1)} hitSlop={8}>
            <Feather name="chevron-right" size={20} color={themeColor} />
          </Pressable>
        </View>

        <Pressable
          style={[s.holiBtn, { backgroundColor: "#FFF1BF", borderColor: "#E4A93A" }]}
          onPress={() => setHoliModal(true)}
        >
          <Feather name="calendar" size={14} color="#D97706" />
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
            <Pressable style={[s.quickBtn, { backgroundColor: "#EEDDF5" }]}
              onPress={() => router.push("/(admin)/makeups" as any)}>
              <Feather name="rotate-ccw" size={16} color="#7C3AED" />
              <Text style={[s.quickLabel, { color: "#7C3AED" }]}>보강 이월</Text>
            </Pressable>
            <Pressable style={[s.quickBtn, { backgroundColor: "#E6FFFA" }]}
              onPress={() => router.push("/(admin)/pool-settings" as any)}>
              <Feather name="dollar-sign" size={16} color="#2EC4B6" />
              <Text style={[s.quickLabel, { color: "#2EC4B6" }]}>단가표</Text>
            </Pressable>
            <Pressable style={[s.quickBtn, { backgroundColor: "#E6FFFA" }]}
              onPress={() => router.push("/(admin)/holidays" as any)}>
              <Feather name="list" size={16} color="#2EC4B6" />
              <Text style={[s.quickLabel, { color: "#2EC4B6" }]}>휴무 목록</Text>
            </Pressable>
          </View>

          {/* ── 총 매출 요약 ── */}
          {summary && (
            <View style={[s.summaryCard, { borderColor: themeColor + "30" }]}>
              <View style={s.summaryTop}>
                <Text style={[s.summaryTitle, { color: C.textMuted }]}>이번 달 총 매출</Text>
                <Text style={[s.summaryAmount, { color: themeColor }]}>{formatWon(summary.total_revenue)}</Text>
              </View>
              <View style={s.summaryRow}>
                <View style={s.summaryItem}>
                  <Text style={[s.summaryItemLabel, { color: C.textMuted }]}>정규</Text>
                  <Text style={[s.summaryItemVal, { color: C.text }]}>{summary.total_sessions}회</Text>
                </View>
                <View style={s.summaryItem}>
                  <Text style={[s.summaryItemLabel, { color: C.textMuted }]}>보강</Text>
                  <Text style={[s.summaryItemVal, { color: C.text }]}>{summary.total_makeup_sessions}회</Text>
                </View>
                <View style={s.summaryItem}>
                  <Text style={[s.summaryItemLabel, { color: C.textMuted }]}>체험</Text>
                  <Text style={[s.summaryItemVal, { color: C.text }]}>{summary.total_trial_sessions}회</Text>
                </View>
                <View style={s.summaryItem}>
                  <Text style={[s.summaryItemLabel, { color: C.textMuted }]}>임시이동</Text>
                  <Text style={[s.summaryItemVal, { color: C.text }]}>{summary.total_temp_transfer_sessions}회</Text>
                </View>
              </View>
            </View>
          )}

          {/* ── 선생님별 매출내역 ── */}
          <View style={s.teacherHeader}>
            <Text style={[s.sectionTitle, { color: C.text }]}>선생님별 매출내역</Text>
            <Text style={[s.teacherCount, { color: C.textMuted }]}>{teachers.length}명</Text>
          </View>
          {teachers.length === 0 ? (
            <View style={s.emptyBox}>
              <Feather name="users" size={40} color={C.textMuted} />
              <Text style={[s.emptyTxt, { color: C.textMuted }]}>등록된 선생님이 없습니다</Text>
            </View>
          ) : (
            teachers.map(t => {
              const report = reports.find(r => r.teacher_id === t.id);
              const status: SettlementStatus = apiStatusToUI(report?.status);
              const statusStyle = STATUS_COLOR[status];
              return (
                <View key={t.id} style={[s.teacherCard, { backgroundColor: C.card }]}>
                  <View style={s.teacherCardTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.teacherName, { color: C.text }]}>{t.name}</Text>
                      {t.position ? <Text style={[s.teacherPos, { color: C.textMuted }]}>{t.position}</Text> : null}
                    </View>
                    <View style={[s.statusBadge, { backgroundColor: statusStyle.bg }]}>
                      <Text style={[s.statusTxt, { color: statusStyle.text }]}>{status}</Text>
                    </View>
                  </View>

                  <Text style={[s.teacherAmt, { color: themeColor }]}>
                    {report?.total_revenue != null ? formatWon(report.total_revenue) : "—"}
                  </Text>

                  <View style={s.statsGrid}>
                    <View style={s.statBox}>
                      <Text style={[s.statBoxVal, { color: C.text }]}>
                        {report?.total_sessions ?? t.student_count ?? "—"}
                      </Text>
                      <Text style={[s.statBoxLabel, { color: C.textMuted }]}>수업시간</Text>
                    </View>
                    <View style={s.statBox}>
                      <Text style={[s.statBoxVal, { color: C.text }]}>
                        {report?.student_count ?? t.student_count ?? "—"}
                      </Text>
                      <Text style={[s.statBoxLabel, { color: C.textMuted }]}>수업인원</Text>
                    </View>
                    <View style={s.statBox}>
                      <Text style={[s.statBoxVal, { color: "#7C3AED" }]}>
                        {report?.makeup_count ?? t.makeup_waiting ?? "—"}
                      </Text>
                      <Text style={[s.statBoxLabel, { color: C.textMuted }]}>보강</Text>
                    </View>
                    <View style={s.statBox}>
                      <Text style={[s.statBoxVal, { color: "#2EC4B6" }]}>
                        {report?.trial_count ?? "—"}
                      </Text>
                      <Text style={[s.statBoxLabel, { color: C.textMuted }]}>체험</Text>
                    </View>
                    <View style={s.statBox}>
                      <Text style={[s.statBoxVal, { color: "#2EC4B6" }]}>
                        {report?.transfer_count ?? "—"}
                      </Text>
                      <Text style={[s.statBoxLabel, { color: C.textMuted }]}>이동</Text>
                    </View>
                    <View style={s.statBox}>
                      <Text style={[s.statBoxVal, { color: "#D97706" }]}>
                        {report?.postpone_count ?? "—"}
                      </Text>
                      <Text style={[s.statBoxLabel, { color: C.textMuted }]}>연기</Text>
                    </View>
                    <View style={s.statBox}>
                      <Text style={[s.statBoxVal, { color: "#D96C6C" }]}>
                        {report?.withdrawn_count ?? "—"}
                      </Text>
                      <Text style={[s.statBoxLabel, { color: C.textMuted }]}>탈퇴</Text>
                    </View>
                  </View>
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
              style={[s.actionBtn, { backgroundColor: themeColor, opacity: saving ? 0.7 : 1 }]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? <ActivityIndicator size={16} color="#fff" /> : <Feather name="save" size={16} color="#fff" />}
              <Text style={s.actionBtnTxt}>이번 달 저장</Text>
            </Pressable>
            <Pressable
              style={[s.actionBtn, { backgroundColor: "#7C3AED" }]}
              onPress={() => setNextMonthModal(true)}
            >
              <Feather name="arrow-right-circle" size={16} color="#fff" />
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
            <Feather name="alert-circle" size={32} color="#7C3AED" style={{ alignSelf: "center", marginBottom: 8 }} />
            <Text style={[s.modalTitle, { color: C.text }]}>다음 달 수업 발생</Text>
            <Text style={[s.modalDesc, { color: C.textSecondary }]}>
              현재 월 정산을 마무리하고{"\n"}다음 달 수업 일정을 새로 생성합니다.{"\n"}보강 이월도 함께 처리됩니다.
            </Text>
            <View style={s.modalBtns}>
              <Pressable style={[s.modalBtn, { backgroundColor: "#F8FAFC" }]} onPress={() => setNextMonthModal(false)}>
                <Text style={[s.modalBtnTxt, { color: C.textSecondary }]}>취소</Text>
              </Pressable>
              <Pressable
                style={[s.modalBtn, { backgroundColor: "#7C3AED" }]}
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
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1 },
  monthNav: { flexDirection: "row", alignItems: "center", gap: 8 },
  monthArrow: { padding: 4 },
  monthLabel: { fontSize: 16, fontFamily: "Inter_700Bold", minWidth: 90, textAlign: "center" },
  holiBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1.5 },
  holiBtnTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#D97706" },

  quickRow: { flexDirection: "row", gap: 8 },
  quickBtn: { flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "center", borderRadius: 12, paddingVertical: 12, gap: 4 },
  quickLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  summaryCard: { borderRadius: 16, padding: 16, borderWidth: 1.5, backgroundColor: Colors.light.card, gap: 12 },
  summaryTop: { gap: 2 },
  summaryTitle: { fontSize: 12, fontFamily: "Inter_500Medium" },
  summaryAmount: { fontSize: 24, fontFamily: "Inter_700Bold" },
  summaryRow: { flexDirection: "row" },
  summaryItem: { flex: 1, alignItems: "center", gap: 2 },
  summaryItemLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  summaryItemVal: { fontSize: 14, fontFamily: "Inter_700Bold" },

  sectionTitle: { fontSize: 15, fontFamily: "Inter_700Bold", marginTop: 4 },

  emptyBox: { alignItems: "center", paddingVertical: 40, gap: 8 },
  emptyTxt: { fontSize: 14, fontFamily: "Inter_400Regular" },

  teacherHeader:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  teacherCount:   { fontSize: 13, fontFamily: "Inter_500Medium" },
  teacherCard:    { borderRadius: 16, padding: 16, gap: 10, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  teacherCardTop: { flexDirection: "row", alignItems: "flex-start" },
  teacherName:    { fontSize: 16, fontFamily: "Inter_700Bold" },
  teacherPos:     { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  teacherAmt:     { fontSize: 22, fontFamily: "Inter_700Bold" },
  statusBadge:    { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusTxt:      { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  statsGrid:      { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  statBox:        { minWidth: "20%", flex: 1, backgroundColor: "#F1F5F9", borderRadius: 10, padding: 8, alignItems: "center", gap: 2 },
  statBoxVal:     { fontSize: 16, fontFamily: "Inter_700Bold" },
  statBoxLabel:   { fontSize: 10, fontFamily: "Inter_400Regular" },

  extraCard: { borderRadius: 14, padding: 14 },
  inputRow: { flexDirection: "row", gap: 8 },
  input: { width: 110, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, fontFamily: "Inter_400Regular" },
  inputMemo: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, fontFamily: "Inter_400Regular" },

  actionRow: { flexDirection: "row", gap: 10 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 14, borderRadius: 14 },
  actionBtnTxt: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
  savedMsg: { textAlign: "center", fontSize: 13, fontFamily: "Inter_600SemiBold" },

  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.4)" },
  modalBox: { ...StyleSheet.absoluteFillObject, justifyContent: "center", alignItems: "center", padding: 24, pointerEvents: "box-none" },
  modalCard: { borderRadius: 20, padding: 24, width: "100%", maxWidth: 340, gap: 12 },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  modalDesc: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  modalBtns: { flexDirection: "row", gap: 10, marginTop: 4 },
  modalBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: "center" },
  modalBtnTxt: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
