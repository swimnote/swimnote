/**
 * (admin)/admin-revenue.tsx — 관리자 매출관리 탭
 *
 * 선생님 수업 정산 및 다음 달 발생 관리 전용 탭
 * - 회원별 수업 횟수 / 보강·체험·임시이동 카운팅
 * - 기타 수기 정산 / 이번 달 저장 / 다음 달 시작
 * - 보강 이월 정리 → makeups 화면 연결
 * - 단가표 → pool-settings 화면 연결
 * - 휴무일 지정 → HolidayModal (공휴일·일요일 자동, 요일 일괄, 날짜 개별)
 *
 * API: /settlement/calculator, /settlement/save, /settlement/finalize
 *      /holidays (GET, POST, DELETE)
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Dimensions, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useTabScrollReset } from "@/hooks/useTabScrollReset";
import { addTabResetListener } from "@/utils/tabReset";

const C = Colors.light;
const SCREEN_W = Dimensions.get("window").width;

/* ────────────────────────────────────────────────
   한국 공휴일 헬퍼
   고정 공휴일 + 음력 기반 근사값 (2025~2030)
──────────────────────────────────────────────── */
const LUNAR_HOLIDAYS: Record<number, string[]> = {
  2025: [
    "2025-01-28","2025-01-29","2025-01-30",
    "2025-05-05",
    "2025-10-05","2025-10-06","2025-10-07",
  ],
  2026: [
    "2026-02-16","2026-02-17","2026-02-18",
    "2026-05-24",
    "2026-09-24","2026-09-25","2026-09-26",
  ],
  2027: [
    "2027-02-07","2027-02-08","2027-02-09",
    "2027-05-13",
    "2027-09-14","2027-09-15","2027-09-16",
  ],
  2028: [
    "2028-01-26","2028-01-27","2028-01-28",
    "2028-05-02",
    "2028-10-02","2028-10-03","2028-10-04",
  ],
  2029: [
    "2029-02-12","2029-02-13","2029-02-14",
    "2029-05-21",
    "2029-10-02","2029-10-03","2029-10-04",
  ],
  2030: [
    "2030-02-02","2030-02-03","2030-02-04",
    "2030-05-11",
    "2030-09-21","2030-09-22","2030-09-23",
  ],
};
const FIXED_HOLIDAYS: [number, number][] = [
  [1,1],[3,1],[5,5],[6,6],[8,15],[10,3],[10,9],[12,25],
];

function getPublicHolidaysForMonth(year: number, month: number): string[] {
  const mm = String(month).padStart(2, "0");
  const result: string[] = [];
  for (const [fm, fd] of FIXED_HOLIDAYS) {
    if (fm === month) result.push(`${year}-${mm}-${String(fd).padStart(2,"0")}`);
  }
  for (const d of (LUNAR_HOLIDAYS[year] || [])) {
    if (d.startsWith(`${year}-${mm}`)) result.push(d);
  }
  return result;
}

function getSundaysInMonth(year: number, month: number): string[] {
  const mm = String(month).padStart(2, "0");
  const total = new Date(year, month, 0).getDate();
  const out: string[] = [];
  for (let d = 1; d <= total; d++) {
    if (new Date(year, month - 1, d).getDay() === 0) {
      out.push(`${year}-${mm}-${String(d).padStart(2,"0")}`);
    }
  }
  return out;
}

function getWeekdayDatesInMonth(year: number, month: number, weekday: number): string[] {
  const mm = String(month).padStart(2, "0");
  const total = new Date(year, month, 0).getDate();
  const out: string[] = [];
  for (let d = 1; d <= total; d++) {
    if (new Date(year, month - 1, d).getDay() === weekday) {
      out.push(`${year}-${mm}-${String(d).padStart(2,"0")}`);
    }
  }
  return out;
}

/* ────────────────────────────────────────────────
   HolidayModal
──────────────────────────────────────────────── */
interface HolidayItemDB { id: string; holiday_date: string; reason: string | null; }

function HolidayModal({ visible, onClose, poolId, token, themeColor }: {
  visible: boolean; onClose: () => void;
  poolId: string; token: string; themeColor: string;
}) {
  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [dbHolidays, setDbHolidays]   = useState<HolidayItemDB[]>([]);
  const [selected, setSelected]       = useState<Set<string>>(new Set());
  const [autoPublic, setAutoPublic]   = useState(true);
  const [autoSunday, setAutoSunday]   = useState(true);
  const [loading, setLoading]         = useState(false);
  const [saving, setSaving]           = useState(false);
  const [savedMsg, setSavedMsg]       = useState("");

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
        const data   = await res.json();
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
      if (next) {
        pubDates.forEach(d => s.add(d));
      } else {
        pubDates.forEach(d => {
          if (!dbHolidays.some(h => h.holiday_date === d)) s.delete(d);
        });
      }
      return s;
    });
  }

  function toggleAutoSunday() {
    const next = !autoSunday;
    setAutoSunday(next);
    setSelected(prev => {
      const s = new Set(prev);
      const sundays = getSundaysInMonth(year, month);
      if (next) {
        sundays.forEach(d => s.add(d));
      } else {
        sundays.forEach(d => {
          if (!dbHolidays.some(h => h.holiday_date === d)) s.delete(d);
        });
      }
      return s;
    });
  }

  function toggleWeekday(weekday: number) {
    const dates   = getWeekdayDatesInMonth(year, month, weekday);
    const allSel  = dates.length > 0 && dates.every(d => selected.has(d));
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

          {/* 헤더 */}
          <View style={[hm.header, { borderBottomColor: C.border }]}>
            <Text style={[hm.headerTitle, { color: C.text }]}>휴무일 지정</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Feather name="x" size={22} color={C.textMuted} />
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 100 }}
          >
            {/* ── 자동 옵션 ── */}
            <View style={[hm.optCard, { backgroundColor: C.card }]}>
              <Text style={[hm.optTitle, { color: C.textMuted }]}>기본 자동 옵션</Text>
              <View style={hm.optRow}>
                <Pressable
                  style={[hm.optBtn, autoPublic && { backgroundColor: "#FFF1BF", borderColor: "#E4A93A" }]}
                  onPress={toggleAutoPublic}
                >
                  <Feather name={autoPublic ? "check-square" : "square"} size={18}
                    color={autoPublic ? "#D97706" : C.textMuted} />
                  <View>
                    <Text style={[hm.optBtnLabel, { color: autoPublic ? "#D97706" : C.text }]}>공휴일 자동</Text>
                    <Text style={[hm.optBtnSub, { color: C.textMuted }]}>삼일절·광복절·추석 등</Text>
                  </View>
                </Pressable>
                <Pressable
                  style={[hm.optBtn, autoSunday && { backgroundColor: "#F9DEDA", borderColor: "#D96C6C" }]}
                  onPress={toggleAutoSunday}
                >
                  <Feather name={autoSunday ? "check-square" : "square"} size={18}
                    color={autoSunday ? "#D96C6C" : C.textMuted} />
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
                <Feather name="chevron-left" size={20} color={themeColor} />
              </Pressable>
              <Text style={[hm.monthTitle, { color: C.text }]}>{year}년 {month}월</Text>
              <Pressable style={hm.navBtn} onPress={() => changeHoliMonth(1)} hitSlop={8}>
                <Feather name="chevron-right" size={20} color={themeColor} />
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
                    <Pressable
                      key={wd}
                      style={[
                        hm.weekdayBtn,
                        allSel ? { backgroundColor: isSun ? "#D96C6C" : isSat ? themeColor : C.text }
                               : { backgroundColor: C.background, borderWidth: 1, borderColor: C.border },
                      ]}
                      onPress={() => toggleWeekday(i)}
                    >
                      <Text style={[
                        hm.weekdayBtnTxt,
                        allSel ? { color: "#fff" }
                               : { color: isSun ? "#D96C6C" : isSat ? themeColor : C.text },
                      ]}>{wd}</Text>
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
                {/* 요일 헤더 */}
                <View style={hm.calWeekRow}>
                  {KO_DAYS.map((wd, i) => (
                    <View key={wd} style={[hm.calHeaderCell, { width: CELL }]}>
                      <Text style={[
                        hm.calHeaderTxt,
                        i === 0 && { color: "#D96C6C" },
                        i === 6 && { color: themeColor },
                      ]}>{wd}</Text>
                    </View>
                  ))}
                </View>

                {/* 날짜 그리드 */}
                {Array.from({ length: Math.ceil(calCells.length / 7) }, (_, wi) => (
                  <View key={wi} style={hm.calWeekRow}>
                    {calCells.slice(wi * 7, wi * 7 + 7).map((dateStr, di) => {
                      if (!dateStr) return <View key={di} style={[hm.calCell, { width: CELL }]} />;
                      const dayNum   = parseInt(dateStr.split("-")[2]);
                      const isHoli   = selected.has(dateStr);
                      const isPubH   = getPublicHolidaysForMonth(year, month).includes(dateStr);
                      const isSun    = di === 0;
                      const isSat    = di === 6;
                      return (
                        <Pressable
                          key={dateStr}
                          style={[hm.calCell, { width: CELL }]}
                          onPress={() => toggleDay(dateStr)}
                        >
                          <View style={[
                            hm.dayCircle,
                            isHoli && { backgroundColor: isSun || isPubH ? "#D96C6C" : "#1F1F1F" },
                          ]}>
                            <Text style={[
                              hm.dayNum,
                              isHoli ? { color: "#fff" }
                                     : isSun || isPubH ? { color: "#D96C6C" }
                                     : isSat ? { color: themeColor }
                                     : { color: C.text },
                            ]}>{dayNum}</Text>
                          </View>
                          {isHoli && (
                            <Text style={hm.holiLabel}>휴</Text>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                ))}

                {/* 범례 */}
                <View style={hm.legend}>
                  <View style={hm.legendItem}>
                    <View style={[hm.legendDot, { backgroundColor: "#D96C6C" }]} />
                    <Text style={[hm.legendTxt, { color: C.textMuted }]}>공휴일·일요일</Text>
                  </View>
                  <View style={hm.legendItem}>
                    <View style={[hm.legendDot, { backgroundColor: "#1F1F1F" }]} />
                    <Text style={[hm.legendTxt, { color: C.textMuted }]}>지정 휴무일</Text>
                  </View>
                </View>
              </View>
            )}

            {/* ── 저장 버튼 ── */}
            {savedMsg ? (
              <Text style={[hm.savedMsg, { color: themeColor }]}>{savedMsg}</Text>
            ) : null}
            <Pressable
              style={[hm.saveBtn, { backgroundColor: themeColor, opacity: saving ? 0.7 : 1 }]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator size={18} color="#fff" />
                : <Feather name="save" size={18} color="#fff" />}
              <Text style={hm.saveBtnTxt}>
                {month}월 휴무일 저장
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

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
  "미정산":    { bg: "#F6F3F1", text: "#6F6B68" },
  "저장됨":    { bg: "#DDF2EF", text: "#1F8F86" },
  "제출완료":  { bg: "#DDF2EF", text: "#1F8F86" },
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

  // 같은 탭 재탭 시 → 현재 월로 초기화
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
            <Pressable style={[s.quickBtn, { backgroundColor: "#DDF2EF" }]}
              onPress={() => router.push("/(admin)/pool-settings" as any)}>
              <Feather name="dollar-sign" size={16} color="#1F8F86" />
              <Text style={[s.quickLabel, { color: "#1F8F86" }]}>단가표</Text>
            </Pressable>
            <Pressable style={[s.quickBtn, { backgroundColor: "#DDF2EF" }]}
              onPress={() => router.push("/(admin)/holidays" as any)}>
              <Feather name="list" size={16} color="#1F8F86" />
              <Text style={[s.quickLabel, { color: "#1F8F86" }]}>휴무 목록</Text>
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
                  {/* 카드 상단: 이름 + 상태 */}
                  <View style={s.teacherCardTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.teacherName, { color: C.text }]}>{t.name}</Text>
                      {t.position ? <Text style={[s.teacherPos, { color: C.textMuted }]}>{t.position}</Text> : null}
                    </View>
                    <View style={[s.statusBadge, { backgroundColor: statusStyle.bg }]}>
                      <Text style={[s.statusTxt, { color: statusStyle.text }]}>{status}</Text>
                    </View>
                  </View>

                  {/* 매출결산액 */}
                  <Text style={[s.teacherAmt, { color: themeColor }]}>
                    {report?.total_revenue != null ? formatWon(report.total_revenue) : "—"}
                  </Text>

                  {/* 통계 그리드 */}
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
                      <Text style={[s.statBoxVal, { color: "#1F8F86" }]}>
                        {report?.trial_count ?? "—"}
                      </Text>
                      <Text style={[s.statBoxLabel, { color: C.textMuted }]}>체험</Text>
                    </View>
                    <View style={s.statBox}>
                      <Text style={[s.statBoxVal, { color: "#1F8F86" }]}>
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
              <Pressable style={[s.modalBtn, { backgroundColor: "#F6F3F1" }]} onPress={() => setNextMonthModal(false)}>
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
        token={token || ""}
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
  statBox:        { minWidth: "20%", flex: 1, backgroundColor: "#FBF8F6", borderRadius: 10, padding: 8, alignItems: "center", gap: 2 },
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

/* ────────────────────────────────────────────────
   Styles — HolidayModal
──────────────────────────────────────────────── */
const hm = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "92%", overflow: "hidden" },

  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 18, borderBottomWidth: 1 },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },

  optCard: { borderRadius: 16, padding: 14, gap: 10 },
  optTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  optRow: { flexDirection: "row", gap: 10 },
  optBtn: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.light.border, backgroundColor: Colors.light.background },
  optBtnLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  optBtnSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },

  monthNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  navBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  monthTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },

  weekdayCard: { borderRadius: 16, padding: 14, gap: 10 },
  weekdayRow: { flexDirection: "row", gap: 6 },
  weekdayBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center" },
  weekdayBtnTxt: { fontSize: 13, fontFamily: "Inter_700Bold" },

  calCard: { borderRadius: 16, padding: 14, gap: 8 },
  calWeekRow: { flexDirection: "row" },
  calHeaderCell: { height: 28, alignItems: "center", justifyContent: "center" },
  calHeaderTxt: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.textSecondary },
  calCell: { height: 56, alignItems: "center", paddingTop: 4, gap: 2 },
  dayCircle: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  dayNum: { fontSize: 14, fontFamily: "Inter_500Medium" },
  holiLabel: { fontSize: 9, fontFamily: "Inter_700Bold", color: "#D96C6C" },

  legend: { flexDirection: "row", gap: 14, justifyContent: "center", paddingTop: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendTxt: { fontSize: 11, fontFamily: "Inter_400Regular" },

  savedMsg: { textAlign: "center", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 15, borderRadius: 14 },
  saveBtnTxt: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
});
