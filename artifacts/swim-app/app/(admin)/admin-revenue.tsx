/**
 * (admin)/admin-revenue.tsx — 관리자 매출관리 탭
 *
 * 선생님 수업 정산 및 다음 달 발생 관리 전용 탭
 * - 회원별 수업 횟수 / 보강·체험·임시이동 카운팅
 * - 기타 수기 정산 / 이번 달 저장 / 다음 달 시작
 * - 보강 이월 정리 → makeups 화면 연결
 * - 단가표 → pool-settings 화면 연결
 *
 * API: /settlement/calculator, /settlement/save, /settlement/finalize
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
import { PageHeader } from "@/components/common/PageHeader";

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

function monthStr(offset = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function formatWon(n: number) { return n.toLocaleString("ko-KR") + "원"; }

export default function AdminRevenueScreen() {
  const { token, adminUser } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const [month, setMonth]       = useState(monthStr());
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary]   = useState<SettlementSummary | null>(null);
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [pricing, setPricing]   = useState<PricingItem[]>([]);
  const [extraAmount, setExtraAmount] = useState("");
  const [extraMemo, setExtraMemo]     = useState("");
  const [saving, setSaving]     = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [nextMonthModal, setNextMonthModal] = useState(false);

  const poolId = (adminUser as any)?.swimming_pool_id || "";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest(token, `/settlement/calculator?pool_id=${poolId}&month=${month}`);
      if (res.ok) {
        const data = await res.json();
        setSummary(data.summary);
        setStudents(data.students || []);
        setPricing(data.pricing || []);
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
      <PageHeader title="매출관리" />

      {/* ── 월 선택 바 ── */}
      <View style={s.monthBar}>
        <Pressable style={s.monthArrow} onPress={() => changeMonth(-1)} hitSlop={8}>
          <Feather name="chevron-left" size={20} color={themeColor} />
        </Pressable>
        <Text style={[s.monthLabel, { color: C.text }]}>{month.replace("-", "년 ")}월</Text>
        <Pressable style={s.monthArrow} onPress={() => changeMonth(1)} hitSlop={8}>
          <Feather name="chevron-right" size={20} color={themeColor} />
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={themeColor} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={themeColor} />}
          contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: pBottom }}
          showsVerticalScrollIndicator={false}
        >
          {/* ── 바로가기 버튼 ── */}
          <View style={s.quickRow}>
            <Pressable style={[s.quickBtn, { backgroundColor: "#EDE9FE" }]}
              onPress={() => router.push("/(admin)/makeups" as any)}>
              <Feather name="rotate-ccw" size={16} color="#7C3AED" />
              <Text style={[s.quickLabel, { color: "#7C3AED" }]}>보강 이월</Text>
            </Pressable>
            <Pressable style={[s.quickBtn, { backgroundColor: "#DBEAFE" }]}
              onPress={() => router.push("/(admin)/pool-settings" as any)}>
              <Feather name="dollar-sign" size={16} color="#2563EB" />
              <Text style={[s.quickLabel, { color: "#2563EB" }]}>단가표</Text>
            </Pressable>
            <Pressable style={[s.quickBtn, { backgroundColor: "#D1FAE5" }]}
              onPress={() => router.push("/(admin)/holidays" as any)}>
              <Feather name="x-square" size={16} color="#059669" />
              <Text style={[s.quickLabel, { color: "#059669" }]}>휴무일</Text>
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
                  <Text style={[s.summaryItemLabel, { color: C.textMuted }]}>정규 수업</Text>
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

          {/* ── 회원별 수업 횟수 ── */}
          <Text style={[s.sectionTitle, { color: C.text }]}>회원별 수업 횟수</Text>
          {students.length === 0 ? (
            <View style={s.emptyBox}>
              <Feather name="inbox" size={40} color={C.textMuted} />
              <Text style={[s.emptyTxt, { color: C.textMuted }]}>이번 달 정산 데이터가 없습니다</Text>
            </View>
          ) : (
            students.map(s_ => (
              <View key={s_.student_id} style={[s.studentCard, { backgroundColor: C.card }]}>
                <View style={s.studentHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.studentName, { color: C.text }]}>{s_.student_name}</Text>
                    <Text style={[s.studentType, { color: C.textMuted }]}>{s_.class_type}</Text>
                  </View>
                  <Text style={[s.studentAmt, { color: themeColor }]}>{formatWon(s_.settlement_amount)}</Text>
                </View>
                <View style={s.studentStats}>
                  {s_.regular_sessions > 0 && (
                    <View style={s.statChip}><Text style={s.statTxt}>정규 {s_.regular_sessions}회</Text></View>
                  )}
                  {s_.makeup_sessions > 0 && (
                    <View style={[s.statChip, { backgroundColor: "#EDE9FE" }]}><Text style={[s.statTxt, { color: "#7C3AED" }]}>보강 {s_.makeup_sessions}회</Text></View>
                  )}
                  {s_.trial_sessions > 0 && (
                    <View style={[s.statChip, { backgroundColor: "#D1FAE5" }]}><Text style={[s.statTxt, { color: "#059669" }]}>체험 {s_.trial_sessions}회</Text></View>
                  )}
                  {s_.temp_transfer_sessions > 0 && (
                    <View style={[s.statChip, { backgroundColor: "#DBEAFE" }]}><Text style={[s.statTxt, { color: "#2563EB" }]}>임시이동 {s_.temp_transfer_sessions}회</Text></View>
                  )}
                </View>
              </View>
            ))
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
              <Pressable style={[s.modalBtn, { backgroundColor: "#F3F4F6" }]} onPress={() => setNextMonthModal(false)}>
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
    </View>
  );
}

const s = StyleSheet.create({
  monthBar: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  monthArrow: { padding: 4 },
  monthLabel: { fontSize: 16, fontFamily: "Inter_700Bold", minWidth: 100, textAlign: "center" },

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

  studentCard: { borderRadius: 14, padding: 14, gap: 8 },
  studentHeader: { flexDirection: "row", alignItems: "center" },
  studentName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  studentType: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  studentAmt: { fontSize: 15, fontFamily: "Inter_700Bold" },
  studentStats: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  statChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: "#F3F4F6" },
  statTxt: { fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.textSecondary },

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
