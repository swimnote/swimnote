/**
 * (admin)/holidays.tsx — 수영장 휴무일 관리
 * 
 * 달력에서 휴무일 선택/취소
 * 선택된 날짜는 다음 달 수업 생성 시 제외
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

const C = Colors.light;

interface Holiday { id: string; holiday_date: string; reason: string | null; }

function monthStr(y: number, m: number) { return `${y}-${String(m).padStart(2, "0")}`; }
function getDaysInMonth(y: number, m: number) { return new Date(y, m, 0).getDate(); }
function getFirstDayOfMonth(y: number, m: number) { return new Date(y, m - 1, 1).getDay(); }
function dateStr(y: number, m: number, d: number) { return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }

export default function HolidaysScreen() {
  const { token, adminUser } = useAuth();
  const poolId = (adminUser as any)?.swimming_pool_id || "";
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [reasonModal, setReasonModal] = useState(false);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest(token, `/holidays?pool_id=${poolId}&month=${monthStr(year, month)}`);
      if (res.ok) { const d = await res.json(); setHolidays(d.holidays || []); }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [token, poolId, year, month]);

  useEffect(() => { load(); }, [load]);

  function isHoliday(d: string) { return holidays.some(h => h.holiday_date === d); }
  function getHoliday(d: string) { return holidays.find(h => h.holiday_date === d); }

  async function handleDayPress(d: string) {
    const existing = getHoliday(d);
    if (existing) {
      setSaving(d);
      try {
        await apiRequest(token, `/holidays/${existing.id}`, { method: "DELETE" });
        setHolidays(prev => prev.filter(h => h.id !== existing.id));
      } finally { setSaving(null); }
    } else {
      setSelectedDate(d);
      setReason("");
      setReasonModal(true);
    }
  }

  async function handleAddHoliday() {
    if (!selectedDate) return;
    setSaving(selectedDate);
    setReasonModal(false);
    try {
      const res = await apiRequest(token, "/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pool_id: poolId, holiday_date: selectedDate, reason: reason.trim() || null }),
      });
      if (res.ok) {
        const d = await res.json();
        setHolidays(prev => [...prev, d.holiday].filter(Boolean));
      }
    } finally { setSaving(null); setSelectedDate(null); }
  }

  function changeMonth(delta: number) {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear()); setMonth(d.getMonth() + 1);
  }

  const days = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];

  return (
    <View style={s.safe}>
      <SubScreenHeader title="휴무일 관리" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 80 }} showsVerticalScrollIndicator={false}>
        {/* 월 선택 */}
        <View style={[s.monthRow, { backgroundColor: C.card }]}>
          <Pressable onPress={() => changeMonth(-1)} style={s.navBtn}>
            <Feather name="chevron-left" size={22} color={themeColor} />
          </Pressable>
          <Text style={[s.monthText, { color: C.text }]}>{year}년 {month}월 휴무일</Text>
          <Pressable onPress={() => changeMonth(1)} style={s.navBtn}>
            <Feather name="chevron-right" size={22} color={themeColor} />
          </Pressable>
        </View>

        {/* 안내 */}
        <View style={[s.infoBox, { backgroundColor: "#FFF1BF" }]}>
          <Feather name="info" size={14} color="#D97706" />
          <Text style={s.infoText}>날짜를 누르면 휴무일로 등록됩니다. 다시 누르면 취소됩니다.{"\n"}휴무일에는 수업이 생성되지 않으며, 빠진 수업은 미실시(수영장) 보강으로 이월됩니다.</Text>
        </View>

        {/* 달력 */}
        <View style={[s.calCard, { backgroundColor: C.card }]}>
          {/* 요일 헤더 */}
          <View style={s.weekRow}>
            {weekdays.map(w => (
              <Text key={w} style={[s.weekLabel, { color: w === "일" ? "#D96C6C" : w === "토" ? "#4EA7D8" : C.textSecondary }]}>{w}</Text>
            ))}
          </View>
          {/* 날짜 그리드 */}
          <View style={s.grid}>
            {Array.from({ length: firstDay }).map((_, i) => <View key={`e${i}`} style={s.cell} />)}
            {Array.from({ length: days }).map((_, i) => {
              const d = i + 1;
              const ds = dateStr(year, month, d);
              const isHol = isHoliday(ds);
              const hol = getHoliday(ds);
              const dayOfWeek = (firstDay + i) % 7;
              const isSat = dayOfWeek === 6;
              const isSun = dayOfWeek === 0;
              const isSaving = saving === ds;
              return (
                <Pressable
                  key={d}
                  style={[s.cell, { }]}
                  onPress={() => handleDayPress(ds)}
                  disabled={!!saving}
                >
                  <View style={[s.dayBox, {
                    backgroundColor: isHol ? "#D96C6C15" : "transparent",
                    borderColor: isHol ? "#D96C6C" : "transparent",
                    borderWidth: isHol ? 1.5 : 0,
                  }]}>
                    {isSaving ? (
                      <ActivityIndicator size="small" color="#D96C6C" />
                    ) : (
                      <Text style={[s.dayNum, {
                        color: isHol ? "#D96C6C" : isSun ? "#D96C6C" : isSat ? "#4EA7D8" : C.text,
                        fontFamily: isHol ? "Inter_700Bold" : "Inter_400Regular",
                      }]}>{d}</Text>
                    )}
                    {isHol && <Feather name="x" size={8} color="#D96C6C" />}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* 이번 달 휴무일 목록 */}
        {loading ? <ActivityIndicator color={themeColor} /> : (
          <View style={[s.listCard, { backgroundColor: C.card }]}>
            <Text style={[s.listTitle, { color: C.text }]}>이번 달 휴무일 ({holidays.length}일)</Text>
            {holidays.length === 0 ? (
              <Text style={[s.emptyText, { color: C.textMuted }]}>등록된 휴무일이 없습니다.</Text>
            ) : holidays.map(h => (
              <View key={h.id} style={[s.holidayRow, { borderColor: C.border }]}>
                <View style={[s.redDot]} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.holidayDate, { color: C.text }]}>{h.holiday_date}</Text>
                  {h.reason && <Text style={[s.holidayReason, { color: C.textSecondary }]}>{h.reason}</Text>}
                </View>
                <Pressable
                  onPress={async () => {
                    setSaving(h.id);
                    try {
                      await apiRequest(token, `/holidays/${h.id}`, { method: "DELETE" });
                      setHolidays(prev => prev.filter(x => x.id !== h.id));
                    } finally { setSaving(null); }
                  }}
                  style={s.deleteBtn}
                  disabled={!!saving}
                >
                  <Feather name="x" size={16} color="#D96C6C" />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* 사유 입력 모달 */}
      <Modal visible={reasonModal} transparent animationType="fade" onRequestClose={() => setReasonModal(false)}>
        <Pressable style={s.overlay} onPress={() => setReasonModal(false)} />
        <View style={s.modalCard}>
          <Text style={[s.modalTitle, { color: C.text }]}>휴무 사유 입력</Text>
          <Text style={[s.modalDate, { color: themeColor }]}>{selectedDate}</Text>
          <TextInput
            style={[s.reasonInput, { borderColor: C.border, color: C.text }]}
            value={reason}
            onChangeText={setReason}
            placeholder="예: 수영장 정기점검, 공휴일 (선택사항)"
            placeholderTextColor={C.textMuted}
          />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable style={[s.modalBtn, { backgroundColor: "#F6F3F1", flex: 1 }]} onPress={() => setReasonModal(false)}>
              <Text style={[s.modalBtnText, { color: C.text }]}>취소</Text>
            </Pressable>
            <Pressable style={[s.modalBtn, { backgroundColor: "#D96C6C", flex: 1 }]} onPress={handleAddHoliday}>
              <Text style={s.modalBtnText}>휴무일 등록</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: "#F6F3F1" },
  monthRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 16, padding: 12 },
  navBtn:      { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  monthText:   { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text },
  infoBox:     { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 14, borderRadius: 14 },
  infoText:    { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18, color: "#92400E" },
  calCard:     { borderRadius: 18, padding: 16, gap: 10, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  weekRow:     { flexDirection: "row", justifyContent: "space-around", paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: "#E9E2DD" },
  weekLabel:   { width: "14.28%" as any, textAlign: "center", fontSize: 12, fontFamily: "Inter_600SemiBold" },
  grid:        { flexDirection: "row", flexWrap: "wrap" },
  cell:        { width: "14.28%" as any, alignItems: "center", paddingVertical: 5 },
  dayBox:      { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  dayNum:      { fontSize: 15, fontFamily: "Inter_400Regular" },
  listCard:    { borderRadius: 16, padding: 16, gap: 10, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  listTitle:   { fontSize: 15, fontFamily: "Inter_700Bold" },
  emptyText:   { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", paddingVertical: 16 },
  holidayRow:  { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1 },
  redDot:      { width: 8, height: 8, borderRadius: 4, backgroundColor: "#D96C6C" },
  holidayDate: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  holidayReason:{ fontSize: 12, fontFamily: "Inter_400Regular" },
  deleteBtn:   { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: "#F9DEDA" },
  overlay:     { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  modalCard:   { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 16 },
  modalTitle:  { fontSize: 18, fontFamily: "Inter_700Bold" },
  modalDate:   { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  reasonInput: { borderWidth: 1.5, borderRadius: 12, padding: 14, fontSize: 14, fontFamily: "Inter_400Regular" },
  modalBtn:    { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  modalBtnText:{ color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
