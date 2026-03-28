import { ChevronLeft, ChevronRight, Save, X } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Dimensions, Modal, Pressable, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import Colors from "@/constants/colors";
import { apiRequest } from "@/context/AuthContext";
import {
  getPublicHolidaysForMonth, getSundaysInMonth, getWeekdayDatesInMonth,
} from "./holidayUtils";

const C = Colors.light;
const SCREEN_W = Dimensions.get("window").width;

interface HolidayItemDB { id: string; holiday_date: string; reason: string | null; }

interface HolidayModalProps {
  visible: boolean;
  onClose: () => void;
  poolId: string;
  token: string | null;
  themeColor: string;
}

export function HolidayModal({ visible, onClose, poolId, token, themeColor }: HolidayModalProps) {
  const now = new Date();
  const [year, setYear]       = useState(now.getFullYear());
  const [month, setMonth]     = useState(now.getMonth() + 1);
  const [dbHolidays, setDbHolidays] = useState<HolidayItemDB[]>([]);
  const [selected, setSelected]     = useState<Set<string>>(new Set());
  const [autoPublic, setAutoPublic] = useState(true);
  const [autoSunday, setAutoSunday] = useState(true);
  const [loading, setLoading]       = useState(false);
  const [saving, setSaving]         = useState(false);
  const [savedMsg, setSavedMsg]     = useState("");

  const KO_DAYS = ["일","월","화","수","목","금","토"];
  const CELL = Math.floor((SCREEN_W - 48) / 7);

  const calCells = useMemo(() => {
    const firstDay = new Date(year, month - 1, 1).getDay();
    const total    = new Date(year, month, 0).getDate();
    const mm       = String(month).padStart(2, "0");
    const cells: (string | null)[] = Array(firstDay).fill(null);
    for (let d = 1; d <= total; d++) cells.push(`${year}-${mm}-${String(d).padStart(2,"0")}`);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [year, month]);

  const loadAndInit = useCallback(async () => {
    if (!visible || !poolId) return;
    setLoading(true);
    try {
      const mm  = String(month).padStart(2, "0");
      const res = await apiRequest(token, `/holidays?pool_id=${poolId}&month=${year}-${mm}`);
      if (res.ok) {
        const data  = await res.json();
        const dbH: HolidayItemDB[] = data.holidays || [];
        setDbHolidays(dbH);
        const init = new Set(dbH.map(h => h.holiday_date));
        if (autoPublic) getPublicHolidaysForMonth(year, month).forEach(d => init.add(d));
        if (autoSunday) getSundaysInMonth(year, month).forEach(d => init.add(d));
        setSelected(init);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [visible, poolId, token, year, month]);

  useEffect(() => { if (visible) loadAndInit(); }, [visible, year, month]);

  function changeHoliMonth(delta: number) {
    let y = year, m = month + delta;
    if (m < 1) { y--; m = 12; }
    if (m > 12){ y++; m = 1; }
    setYear(y); setMonth(m);
  }

  function toggleAutoPublic() {
    const next = !autoPublic;
    setAutoPublic(next);
    setSelected(prev => {
      const s = new Set(prev);
      const pubDates = getPublicHolidaysForMonth(year, month);
      if (next) { pubDates.forEach(d => s.add(d)); }
      else { pubDates.forEach(d => { if (!dbHolidays.some(h => h.holiday_date === d)) s.delete(d); }); }
      return s;
    });
  }

  function toggleAutoSunday() {
    const next = !autoSunday;
    setAutoSunday(next);
    setSelected(prev => {
      const s = new Set(prev);
      const sundays = getSundaysInMonth(year, month);
      if (next) { sundays.forEach(d => s.add(d)); }
      else { sundays.forEach(d => { if (!dbHolidays.some(h => h.holiday_date === d)) s.delete(d); }); }
      return s;
    });
  }

  function toggleWeekday(weekday: number) {
    const dates  = getWeekdayDatesInMonth(year, month, weekday);
    const allSel = dates.length > 0 && dates.every(d => selected.has(d));
    setSelected(prev => {
      const s = new Set(prev);
      if (allSel) dates.forEach(d => s.delete(d));
      else        dates.forEach(d => s.add(d));
      return s;
    });
  }

  function toggleDay(dateStr: string) {
    setSelected(prev => {
      const s = new Set(prev);
      if (s.has(dateStr)) s.delete(dateStr); else s.add(dateStr);
      return s;
    });
  }

  async function handleSave() {
    setSaving(true); setSavedMsg("");
    try {
      const mm  = String(month).padStart(2, "0");
      const pfx = `${year}-${mm}`;
      const dbForMonth = dbHolidays.filter(h => h.holiday_date.startsWith(pfx));
      const dbSet      = new Set(dbForMonth.map(h => h.holiday_date));
      const toAdd      = [...selected].filter(d => d.startsWith(pfx) && !dbSet.has(d));
      const toRemove   = dbForMonth.filter(h => !selected.has(h.holiday_date));
      await Promise.all([
        ...toAdd.map(d => apiRequest(token, "/holidays", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pool_id: poolId, holiday_date: d, reason: null }),
        })),
        ...toRemove.map(h => apiRequest(token, `/holidays/${h.id}`, { method: "DELETE" })),
      ]);
      setSavedMsg("저장 완료!");
      await loadAndInit();
    } catch { setSavedMsg("저장 실패"); }
    finally { setSaving(false); setTimeout(() => setSavedMsg(""), 2500); }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={hm.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[hm.sheet, { backgroundColor: C.background }]}>
          <View style={[hm.header, { borderBottomColor: C.border }]}>
            <Text style={[hm.headerTitle, { color: C.text }]}>휴무일 지정</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <X size={22} color={C.textMuted} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 100 }}>
            {/* ── 자동 옵션 ── */}
            <View style={[hm.optCard, { backgroundColor: C.card }]}>
              <Text style={[hm.optTitle, { color: C.textMuted }]}>기본 자동 옵션</Text>
              <View style={hm.optRow}>
                <Pressable style={[hm.optBtn, autoPublic && { backgroundColor: "#FFF1BF", borderColor: "#E4A93A" }]} onPress={toggleAutoPublic}>
                  <LucideIcon name={autoPublic ? "check-square" : "square"} size={18} color={autoPublic ? "#D97706" : C.textMuted} />
                  <View>
                    <Text style={[hm.optBtnLabel, { color: autoPublic ? "#D97706" : C.text }]}>공휴일 자동</Text>
                    <Text style={[hm.optBtnSub, { color: C.textMuted }]}>삼일절·광복절·추석 등</Text>
                  </View>
                </Pressable>
                <Pressable style={[hm.optBtn, autoSunday && { backgroundColor: "#F9DEDA", borderColor: "#D96C6C" }]} onPress={toggleAutoSunday}>
                  <LucideIcon name={autoSunday ? "check-square" : "square"} size={18} color={autoSunday ? "#D96C6C" : C.textMuted} />
                  <View>
                    <Text style={[hm.optBtnLabel, { color: autoSunday ? "#D96C6C" : C.text }]}>일요일 자동</Text>
                    <Text style={[hm.optBtnSub, { color: C.textMuted }]}>매주 일요일 전체</Text>
                  </View>
                </Pressable>
              </View>
            </View>

            {/* ── 월 네비게이션 ── */}
            <View style={[hm.monthNav, { backgroundColor: C.card }]}>
              <Pressable style={hm.navBtn} onPress={() => changeHoliMonth(-1)} hitSlop={8}>
                <ChevronLeft size={20} color={themeColor} />
              </Pressable>
              <Text style={[hm.monthTitle, { color: C.text }]}>{year}년 {month}월</Text>
              <Pressable style={hm.navBtn} onPress={() => changeHoliMonth(1)} hitSlop={8}>
                <ChevronRight size={20} color={themeColor} />
              </Pressable>
            </View>

            {/* ── 요일 일괄 선택 ── */}
            <View style={[hm.weekdayCard, { backgroundColor: C.card }]}>
              <Text style={[hm.optTitle, { color: C.textMuted }]}>요일별 일괄 지정</Text>
              <View style={hm.weekdayRow}>
                {KO_DAYS.map((wd, i) => {
                  const dates  = getWeekdayDatesInMonth(year, month, i);
                  const allSel = dates.length > 0 && dates.every(d => selected.has(d));
                  const isSun  = i === 0;
                  const isSat  = i === 6;
                  return (
                    <Pressable key={wd}
                      style={[hm.weekdayBtn, allSel ? { backgroundColor: isSun ? "#D96C6C" : isSat ? themeColor : C.text } : { backgroundColor: C.background, borderWidth: 1, borderColor: C.border }]}
                      onPress={() => toggleWeekday(i)}
                    >
                      <Text style={[hm.weekdayBtnTxt, allSel ? { color: "#fff" } : { color: isSun ? "#D96C6C" : isSat ? themeColor : C.text }]}>{wd}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* ── 달력 ── */}
            {loading ? (
              <ActivityIndicator color={themeColor} style={{ marginVertical: 30 }} />
            ) : (
              <View style={[hm.calCard, { backgroundColor: C.card }]}>
                <View style={hm.calWeekRow}>
                  {KO_DAYS.map((wd, i) => (
                    <View key={wd} style={[hm.calHeaderCell, { width: CELL }]}>
                      <Text style={[hm.calHeaderTxt, i === 0 && { color: "#D96C6C" }, i === 6 && { color: themeColor }]}>{wd}</Text>
                    </View>
                  ))}
                </View>
                {Array.from({ length: Math.ceil(calCells.length / 7) }, (_, wi) => (
                  <View key={wi} style={hm.calWeekRow}>
                    {calCells.slice(wi * 7, wi * 7 + 7).map((dateStr, di) => {
                      if (!dateStr) return <View key={di} style={[hm.calCell, { width: CELL }]} />;
                      const dayNum  = parseInt(dateStr.split("-")[2]);
                      const isHoli  = selected.has(dateStr);
                      const isPubH  = getPublicHolidaysForMonth(year, month).includes(dateStr);
                      const isSun   = di === 0;
                      const isSat   = di === 6;
                      return (
                        <Pressable key={dateStr} style={[hm.calCell, { width: CELL }]} onPress={() => toggleDay(dateStr)}>
                          <View style={[hm.dayCircle, isHoli && { backgroundColor: isSun || isPubH ? "#D96C6C" : "#0F172A" }]}>
                            <Text style={[hm.dayNum, isHoli ? { color: "#fff" } : isSun || isPubH ? { color: "#D96C6C" } : isSat ? { color: themeColor } : { color: C.text }]}>{dayNum}</Text>
                          </View>
                          {isHoli && <Text style={hm.holiLabel}>휴</Text>}
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
                <View style={hm.legend}>
                  <View style={hm.legendItem}><View style={[hm.legendDot, { backgroundColor: "#D96C6C" }]} /><Text style={[hm.legendTxt, { color: C.textMuted }]}>공휴일·일요일</Text></View>
                  <View style={hm.legendItem}><View style={[hm.legendDot, { backgroundColor: "#0F172A" }]} /><Text style={[hm.legendTxt, { color: C.textMuted }]}>지정 휴무일</Text></View>
                </View>
              </View>
            )}

            {savedMsg ? <Text style={[hm.savedMsg, { color: themeColor }]}>{savedMsg}</Text> : null}
            <Pressable style={[hm.saveBtn, { backgroundColor: themeColor, opacity: saving ? 0.7 : 1 }]} onPress={handleSave} disabled={saving}>
              {saving ? <ActivityIndicator size={18} color="#fff" /> : <Save size={18} color="#fff" />}
              <Text style={hm.saveBtnTxt}>{month}월 휴무일 저장</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const hm = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "92%", overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 18, borderBottomWidth: 1 },
  headerTitle: { fontSize: 18, fontFamily: "Pretendard-SemiBold" },
  optCard: { borderRadius: 16, padding: 14, gap: 10 },
  optTitle: { fontSize: 12, fontFamily: "Pretendard-Medium" },
  optRow: { flexDirection: "row", gap: 10 },
  optBtn: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.background },
  optBtnLabel: { fontSize: 14, fontFamily: "Pretendard-Medium" },
  optBtnSub: { fontSize: 11, fontFamily: "Pretendard-Regular", marginTop: 1 },
  monthNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  navBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  monthTitle: { fontSize: 17, fontFamily: "Pretendard-SemiBold" },
  weekdayCard: { borderRadius: 16, padding: 14, gap: 10 },
  weekdayRow: { flexDirection: "row", gap: 6 },
  weekdayBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center" },
  weekdayBtnTxt: { fontSize: 13, fontFamily: "Pretendard-SemiBold" },
  calCard: { borderRadius: 16, padding: 14, gap: 8 },
  calWeekRow: { flexDirection: "row" },
  calHeaderCell: { height: 28, alignItems: "center", justifyContent: "center" },
  calHeaderTxt: { fontSize: 12, fontFamily: "Pretendard-Medium", color: C.textSecondary },
  calCell: { height: 56, alignItems: "center", paddingTop: 4, gap: 2 },
  dayCircle: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  dayNum: { fontSize: 14, fontFamily: "Pretendard-Medium" },
  holiLabel: { fontSize: 9, fontFamily: "Pretendard-SemiBold", color: "#D96C6C" },
  legend: { flexDirection: "row", gap: 14, justifyContent: "center", paddingTop: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendTxt: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  savedMsg: { textAlign: "center", fontSize: 14, fontFamily: "Pretendard-Medium" },
  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 15, borderRadius: 14 },
  saveBtnTxt: { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: "#fff" },
});
