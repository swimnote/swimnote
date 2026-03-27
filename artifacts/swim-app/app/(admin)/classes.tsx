/**
 * (admin)/classes.tsx — 관리자 수업 스케줄러
 *
 * 선생님 my-schedule.tsx 구조 완전 이식
 * - 탭 순서: 월 / 주 / 일 (monthly 기본)
 * - 날짜 클릭 → DaySheet 팝업 (선생님과 동일)
 * - navigateFromSheet 패턴 (iOS 터치 freeze 방지)
 * - 일간 뷰: WeeklySchedule 공용 컴포넌트 + 담당 선생님 표시
 * - AdminClassDetailSheet 사용 (관리자 기능)
 */
import { Calendar, Check, ChevronLeft, ChevronRight, Plus, Repeat, RotateCcw, User, Users, X } from "lucide-react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Dimensions, Modal,
  Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { addTabResetListener } from "@/utils/tabReset";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import ClassCreateFlow from "@/components/classes/ClassCreateFlow";
import { WeeklySchedule } from "@/components/teacher/WeeklySchedule";
import { TeacherClassGroup, SlotStatus } from "@/components/teacher/types";
import WeeklyTimetableV2 from "@/components/teacher/my-schedule/WeeklyTimetableV2";
import { getMondayStr, addDaysStr, ChangeLogItem } from "@/components/teacher/my-schedule/utils";
import StudentManagementSheet from "@/components/teacher/StudentManagementSheet";
import AdminClassDetailSheet from "@/components/admin/AdminClassDetailSheet";

const C = Colors.light;
const SCREEN_W = Dimensions.get("window").width;
const KO_DAY_ARR   = ["일", "월", "화", "수", "목", "금", "토"];
const TIMETABLE_COLS = ["월", "화", "수", "목", "금", "토", "일"];
const WEEKDAY_NAMES  = ["일", "월", "화", "수", "목", "금", "토"];

type ViewMode = "monthly" | "weekly" | "daily";

function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function parseHour(t: string): number { return parseInt(t.split(/[:-]/)[0]) || 0; }
function getKoDay(dateStr: string): string {
  return KO_DAY_ARR[new Date(dateStr + "T12:00:00Z").getUTCDay()];
}
function classesForDate(groups: TeacherClassGroup[], dateStr: string) {
  const koDay = getKoDay(dateStr);
  return groups
    .filter(g => g.schedule_days.split(",").map(d => d.trim()).includes(koDay))
    .sort((a, b) => parseHour(a.schedule_time) - parseHour(b.schedule_time));
}
function dateLabelFull(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00Z");
  return `${d.getUTCMonth()+1}월 ${d.getUTCDate()}일 (${KO_DAY_ARR[d.getUTCDay()]})`;
}
function fmtHour(t: string) { return `${parseHour(t)}시`; }
function getHourRange(groups: TeacherClassGroup[]): number[] {
  if (!groups.length) return Array.from({ length: 8 }, (_, i) => i + 9);
  const hours = groups.map(g => parseHour(g.schedule_time));
  const minH = Math.max(6, Math.min(...hours));
  const maxH = Math.min(22, Math.max(...hours));
  return Array.from({ length: maxH - minH + 1 }, (_, i) => i + minH);
}
const COLORS = ["#4EA7D8","#2E9B6F","#E4A93A","#D96C6C","#8B5CF6","#EC4899","#06B6D4","#84CC16"];
function classColor(id: string) {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
  return COLORS[Math.abs(h) % COLORS.length];
}


// ─── 월간 달력 ──────────────────────────────────────────────────
function MonthlyCalendar({ groups, themeColor, selectedDate, onSelectDate }: {
  groups: TeacherClassGroup[];
  themeColor: string;
  selectedDate: string | null;
  onSelectDate: (dateStr: string) => void;
}) {
  const today = todayDateStr();
  const { token, adminUser } = useAuth();
  const poolId = (adminUser as any)?.swimming_pool_id || "";
  const [offset, setOffset] = useState(0);
  const [holidayDates, setHolidayDates] = useState<Set<string>>(new Set());

  const { year, month, days } = useMemo(() => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const y = d.getFullYear(); const m = d.getMonth() + 1;
    const firstDay = new Date(y, m - 1, 1).getDay();
    const daysInMonth = new Date(y, m, 0).getDate();
    const cells: (string | null)[] = Array(firstDay).fill(null);
    for (let i = 1; i <= daysInMonth; i++)
      cells.push(`${y}-${String(m).padStart(2,"0")}-${String(i).padStart(2,"0")}`);
    while (cells.length % 7 !== 0) cells.push(null);
    return { year: y, month: m, days: cells };
  }, [offset]);

  useEffect(() => {
    if (!poolId) return;
    const mm = String(month).padStart(2, "0");
    apiRequest(token, `/holidays?pool_id=${poolId}&month=${year}-${mm}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.holidays) setHolidayDates(new Set(d.holidays.map((h: any) => h.holiday_date))); })
      .catch(() => {});
  }, [token, poolId, year, month]);

  const CELL_H = Math.max(72, Math.floor((SCREEN_W - 32) / 7 * 1.1));
  const CELL_W = Math.floor((SCREEN_W - 32) / 7);
  const now = new Date();
  const nowHour = now.getHours();

  return (
    <View style={mc.root}>
      <View style={mc.monthNav}>
        <Pressable style={mc.navBtn} onPress={() => setOffset(o => o - 1)}>
          <ChevronLeft size={20} color={C.text} />
        </Pressable>
        <Pressable onPress={() => setOffset(0)}>
          <Text style={mc.monthTitle}>{year}년 {month}월</Text>
        </Pressable>
        <Pressable style={mc.navBtn} onPress={() => setOffset(o => o + 1)}>
          <ChevronRight size={20} color={C.text} />
        </Pressable>
      </View>

      <View style={mc.weekRow}>
        {WEEKDAY_NAMES.map((wd, i) => (
          <View key={wd} style={[mc.weekHeader, { width: CELL_W }]}>
            <Text style={[mc.weekHeaderText,
              i === 0 && { color: "#D96C6C" },
              i === 6 && { color: themeColor },
            ]}>{wd}</Text>
          </View>
        ))}
      </View>

      {Array.from({ length: Math.ceil(days.length / 7) }, (_, wi) => (
        <View key={wi} style={mc.weekRow}>
          {days.slice(wi * 7, wi * 7 + 7).map((dateStr, di) => {
            if (!dateStr) return <View key={di} style={[mc.dayCell, { width: CELL_W, height: CELL_H }]} />;
            const isToday    = dateStr === today;
            const isPast     = dateStr < today;
            const isSelected = dateStr === selectedDate;
            const isHoliday  = holidayDates.has(dateStr);
            const cls        = classesForDate(groups, dateStr);
            const dayNum     = parseInt(dateStr.split("-")[2]);
            const isSun      = di === 0;
            const isSat      = di === 6;
            const timePills  = cls.slice(0, 3).map(g => fmtHour(g.schedule_time));
            const extraCount = cls.length - timePills.length;

            return (
              <Pressable key={dateStr}
                style={[
                  mc.dayCell, { width: CELL_W, height: CELL_H },
                  isSelected && { backgroundColor: themeColor + "18", borderRadius: 8 },
                  isToday && !isSelected && { backgroundColor: themeColor + "0C" },
                  isHoliday && { backgroundColor: "#FEF2F2" },
                ]}
                onPress={() => onSelectDate(dateStr)}>

                <View style={[mc.dayNumWrap,
                  isToday && { backgroundColor: themeColor },
                  isSelected && !isToday && { backgroundColor: themeColor + "30" },
                ]}>
                  <Text style={[mc.dayNum,
                    (isSun || isHoliday) ? { color: "#D96C6C" } : isSat ? { color: themeColor } : {},
                    isToday && { color: "#fff" },
                  ]}>{dayNum}</Text>
                </View>

                {isHoliday ? (
                  <Text style={mc.holidayTag}>휴무일</Text>
                ) : (
                  <View style={mc.timePills}>
                    {timePills.map((label, ti) => {
                      const pillIsPast = isPast ||
                        (isToday && parseHour(cls[ti].schedule_time) < nowHour);
                      return (
                        <View key={ti} style={[mc.timePill, { backgroundColor: classColor(cls[ti].id) + "22" }]}>
                          <Text style={[mc.timePillText, { color: classColor(cls[ti].id) }]}>{label}</Text>
                          {pillIsPast && (
                            <View style={mc.strikeOverlay} pointerEvents="none">
                              <View style={mc.strikeLine} />
                            </View>
                          )}
                        </View>
                      );
                    })}
                    {extraCount > 0 && <Text style={mc.moreTxt}>+{extraCount}</Text>}
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
const mc = StyleSheet.create({
  root:           { paddingHorizontal: 16, paddingBottom: 8 },
  monthNav:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10 },
  navBtn:         { width: 36, height: 36, borderRadius: 10, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  monthTitle:     { fontSize: 17, fontFamily: "Pretendard-Bold", color: C.text },
  weekRow:        { flexDirection: "row" },
  weekHeader:     { height: 28, alignItems: "center", justifyContent: "center" },
  weekHeaderText: { fontSize: 12, fontFamily: "Pretendard-SemiBold", color: C.textSecondary },
  dayCell:        { alignItems: "center", paddingTop: 4, paddingHorizontal: 1 },
  dayNumWrap:     { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  dayNum:         { fontSize: 12, fontFamily: "Pretendard-Medium", color: C.text },
  timePills:      { flexDirection: "column", alignItems: "center", gap: 1, marginTop: 2, width: "100%" },
  timePill:       { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4, alignItems: "center" },
  timePillText:   { fontSize: 9, fontFamily: "Pretendard-SemiBold" },
  strikeOverlay:  { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "center" },
  strikeLine:     { height: 1.5, backgroundColor: "rgba(0,0,0,0.28)", borderRadius: 1, marginHorizontal: 1 },
  moreTxt:        { fontSize: 8, fontFamily: "Pretendard-Regular", color: C.textMuted },
  holidayTag:     { fontSize: 9, fontFamily: "Pretendard-Bold", color: "#D96C6C", marginTop: 2 },
});

// ─── 날짜 상세 팝업 ─────────────────────────────────────────────
function DaySheet({ dateStr, classes, attMap, themeColor, onClose, onSelectClass, onOpenMakeup }: {
  dateStr: string;
  classes: TeacherClassGroup[];
  attMap: Record<string, number>;
  themeColor: string;
  onClose: () => void;
  onSelectClass: (g: TeacherClassGroup) => void;
  onOpenMakeup: () => void;
}) {
  const label = dateLabelFull(dateStr);

  return (
    <Modal visible animationType="slide" transparent statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={dy.backdrop} onPress={onClose}>
        <Pressable style={dy.sheet} onPress={() => {}}>
          <View style={dy.handle} />

          {/* 헤더 */}
          <View style={dy.header}>
            <View style={{ flex: 1 }}>
              <Text style={dy.dateTitle}>{label}</Text>
              <Text style={dy.dateSub}>{classes.length > 0 ? `수업 ${classes.length}개` : "수업 없음"}</Text>
            </View>
            <View style={dy.headerActions}>
              <Pressable style={[dy.headerBtn, { backgroundColor: "#E6FFFA" }]} onPress={onOpenMakeup}>
                <Repeat size={13} color="#4338CA" />
                <Text style={[dy.headerBtnTxt, { color: "#4338CA" }]}>보강</Text>
              </Pressable>
              <Pressable onPress={onClose} style={dy.closeBtn}>
                <X size={20} color={C.textSecondary} />
              </Pressable>
            </View>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }}
            contentContainerStyle={{ paddingBottom: 80 }}>

            {classes.length === 0 && (
              <View style={dy.emptyBox}>
                <Calendar size={32} color={C.textMuted} />
                <Text style={dy.emptyTxt}>이 날은 수업이 없습니다</Text>
                <Pressable style={[dy.emptyAction, { borderColor: "#4338CA" }]} onPress={onOpenMakeup}>
                  <Repeat size={13} color="#4338CA" />
                  <Text style={[dy.emptyActionTxt, { color: "#4338CA" }]}>보강 추가</Text>
                </Pressable>
              </View>
            )}

            {classes.length > 0 && (
              <View style={{ paddingHorizontal: 16, gap: 8, marginBottom: 12 }}>
                {classes.map(g => {
                  const attCnt = attMap[g.id] || 0;
                  const color  = classColor(g.id);
                  return (
                    <Pressable key={g.id} style={dy.classCard} onPress={() => onSelectClass(g)}>
                      <View style={[dy.colorBar, { backgroundColor: color }]} />
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <Text style={dy.classTime}>{g.schedule_time}</Text>
                          <Text style={dy.className} numberOfLines={1}>{g.name}</Text>
                        </View>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2, flexWrap: "wrap" }}>
                          <Text style={dy.classSub}>{g.student_count}명</Text>
                          {!!g.instructor && (
                            <View style={dy.instructorBadge}>
                              <User size={9} color="#64748B" />
                              <Text style={dy.instructorTxt}>{g.instructor}</Text>
                            </View>
                          )}
                          {attCnt > 0 && (
                            <View style={dy.attBadge}>
                              <Check size={9} color="#2EC4B6" />
                              <Text style={dy.attBadgeTxt}>출결 {attCnt}</Text>
                            </View>
                          )}
                        </View>
                      </View>
                      <ChevronRight size={16} color={C.textSecondary} />
                    </Pressable>
                  );
                })}
              </View>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
const dy = StyleSheet.create({
  backdrop:       { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet:          { position: "absolute", bottom: 0, left: 0, right: 0,
                    backgroundColor: "#fff", borderTopLeftRadius: 22, borderTopRightRadius: 22,
                    maxHeight: "78%", paddingBottom: 8 },
  handle:         { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB",
                    alignSelf: "center", marginTop: 10, marginBottom: 4 },
  header:         { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 16,
                    paddingVertical: 10, gap: 8 },
  dateTitle:      { fontSize: 18, fontFamily: "Pretendard-Bold", color: C.text },
  dateSub:        { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 },
  headerActions:  { flexDirection: "row", alignItems: "center", gap: 6 },
  headerBtn:      { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10,
                    paddingVertical: 7, borderRadius: 10 },
  headerBtnTxt:   { fontSize: 12, fontFamily: "Pretendard-SemiBold" },
  closeBtn:       { padding: 4, marginLeft: 2 },
  emptyBox:       { alignItems: "center", paddingVertical: 32, gap: 10 },
  emptyTxt:       { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  emptyAction:    { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14,
                    paddingVertical: 8, borderRadius: 10, borderWidth: 1.5 },
  emptyActionTxt: { fontSize: 13, fontFamily: "Pretendard-SemiBold" },
  classCard:      { flexDirection: "row", alignItems: "center", gap: 10,
                    backgroundColor: "#F1F5F9", borderRadius: 12, padding: 12,
                    borderWidth: 1, borderColor: C.border },
  colorBar:       { width: 3, height: 40, borderRadius: 2 },
  classTime:      { fontSize: 14, fontFamily: "Pretendard-Bold", color: C.text },
  className:      { fontSize: 14, fontFamily: "Pretendard-Medium", color: C.text, flex: 1 },
  classSub:       { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  instructorBadge:{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6,
                    paddingVertical: 2, borderRadius: 6, backgroundColor: "#FFFFFF" },
  instructorTxt:  { fontSize: 10, fontFamily: "Pretendard-Medium", color: "#64748B" },
  attBadge:       { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6,
                    paddingVertical: 2, borderRadius: 6, backgroundColor: "#E6FFFA" },
  attBadgeTxt:    { fontSize: 10, fontFamily: "Pretendard-SemiBold", color: "#2EC4B6" },
});

// ══════════════════ 메인 스크린 ══════════════════════════════════
export default function ClassesScreen() {
  const { token, adminUser } = useAuth();
  const { themeColor } = useBrand();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const poolId = (adminUser as any)?.swimming_pool_id || "";

  const [viewMode,    setViewMode]    = useState<ViewMode>("monthly");
  const [groups,      setGroups]      = useState<TeacherClassGroup[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [showCreate,  setShowCreate]  = useState(false);
  const [showManagement, setShowManagement] = useState(false);

  // 날짜 팝업 (월간)
  const [selectedDate,  setSelectedDate]  = useState<string | null>(null);
  const [dayAttMap,     setDayAttMap]     = useState<Record<string, number>>({});
  const [todayAttMap,   setTodayAttMap]   = useState<Record<string, number>>({});

  // 반 상세 시트
  const [detailGroup, setDetailGroup] = useState<TeacherClassGroup | null>(null);

  // 주간 시간표 네비게이션
  const [weeklyViewStart, setWeeklyViewStart] = useState(() => getMondayStr(todayDateStr()));

  // 포커스 복귀 시 날짜 팝업 복원용
  const isMountedRef          = useRef(false);
  const pendingRestoreDateRef = useRef<string | null>(null);

  // ── 데이터 로드 ──
  const load = useCallback(async () => {
    const today = todayDateStr();
    try {
      const [cgRes, attRes] = await Promise.all([
        apiRequest(token, "/class-groups"),
        apiRequest(token, `/attendance?date=${today}`),
      ]);
      if (cgRes.ok) setGroups(await cgRes.json());
      if (attRes.ok) {
        const arr: any[] = await attRes.json();
        const map: Record<string, number> = {};
        arr.forEach(a => { const cid = a.class_group_id || a.class_id; if (cid) map[cid] = (map[cid] || 0) + 1; });
        setTodayAttMap(map);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // ── 날짜별 출결 로드 ──
  async function loadDayData(dateStr: string) {
    try {
      const attRes = await apiRequest(token, `/attendance?date=${dateStr}`);
      if (attRes.ok) {
        const arr: any[] = await attRes.json();
        const map: Record<string, number> = {};
        arr.forEach(a => { const cid = a.class_group_id || a.class_id; if (cid) map[cid] = (map[cid] || 0) + 1; });
        setDayAttMap(map);
      }
    } catch {}
  }

  // ── 날짜 클릭 ──
  function handleDatePress(dateStr: string) {
    if (selectedDate === dateStr) {
      setSelectedDate(null);
    } else {
      setSelectedDate(dateStr);
      loadDayData(dateStr);
    }
  }

  // ── 모달 닫고 안전하게 페이지 이동 (iOS 터치 freeze 방지) ──
  function navigateFromSheet(navigate: () => void) {
    const dateToRestore = selectedDate;
    setDetailGroup(null);
    setSelectedDate(null);
    if (dateToRestore) pendingRestoreDateRef.current = dateToRestore;
    setTimeout(navigate, 350);
  }

  // ── 포커스 복귀: 날짜 팝업 복원 ──
  useFocusEffect(useCallback(() => {
    if (!isMountedRef.current) { isMountedRef.current = true; return; }

    if (pendingRestoreDateRef.current) {
      const d = pendingRestoreDateRef.current;
      pendingRestoreDateRef.current = null;
      setViewMode("monthly");
      setSelectedDate(d);
      loadDayData(d);
    }

    load();
  }, [token]));

  // ── 탭 재탭 초기화 ──
  useEffect(() => {
    return addTabResetListener("classes", () => {
      setDetailGroup(null);
      setSelectedDate(null);
      setViewMode("monthly");
    });
  }, []);

  // returnTo=weekly: class-assign에서 돌아올 때 주간으로 전환
  useEffect(() => {
    if (returnTo === "weekly") {
      setViewMode("weekly");
      setDetailGroup(null);
      setSelectedDate(null);
      load();
    }
  }, [returnTo]);

  // ── statusMap (일간 WeeklySchedule 용) ──
  const statusMap = useMemo<Record<string, SlotStatus>>(() => {
    const map: Record<string, SlotStatus> = {};
    groups.forEach(g => {
      map[g.id] = {
        attChecked: todayAttMap[g.id] || 0,
        diaryDone:  true,
        hasPhotos:  false,
      };
    });
    return map;
  }, [groups, todayAttMap]);

  const dayClasses = selectedDate ? classesForDate(groups, selectedDate) : [];

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <SubScreenHeader title="수업 스케줄러" />
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="수업 스케줄러" />

      {/* 헤더 영역 */}
      <View style={s.titleArea}>
        <View style={s.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>수업 스케줄러</Text>
            <Text style={s.titleSub}>
              {new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" })}
            </Text>
          </View>
          <View style={s.rightBtns}>
            <Pressable style={[s.iconBtn, { backgroundColor: "#EEDDF5" }]}
              onPress={() => router.push("/(admin)/makeups" as any)}>
              <RotateCcw size={13} color="#7C3AED" />
              <Text style={[s.iconBtnTxt, { color: "#7C3AED" }]}>보강</Text>
            </Pressable>
            <Pressable style={[s.mgmtBtn, { borderColor: themeColor }]}
              onPress={() => setShowManagement(true)}>
              <Users size={13} color={themeColor} />
              <Text style={[s.mgmtBtnTxt, { color: themeColor }]}>수강생관리</Text>
            </Pressable>
            <Pressable style={[s.createBtn, { backgroundColor: C.button }]}
              onPress={() => setShowCreate(true)}>
              <Plus size={14} color="#fff" />
              <Text style={s.createBtnTxt}>반 등록</Text>
            </Pressable>
          </View>
        </View>

        {/* 탭: 월 / 주 / 일 */}
        <View style={s.controlRow}>
          <View style={s.viewToggle}>
            {(["monthly", "weekly", "daily"] as ViewMode[]).map(mode => {
              const labels = { monthly: "월", weekly: "주", daily: "일" };
              const isActive = viewMode === mode;
              return (
                <Pressable key={mode}
                  style={[s.toggleBtn, isActive && { backgroundColor: themeColor, borderColor: themeColor }]}
                  onPress={() => { setViewMode(mode); if (mode !== "monthly") setSelectedDate(null); }}>
                  <Text style={[s.toggleText, isActive && { color: "#fff" }]}>{labels[mode]}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>

      {/* ── 월간 뷰 ── */}
      {viewMode === "monthly" && (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
          <MonthlyCalendar
            groups={groups}
            themeColor={themeColor}
            selectedDate={selectedDate}
            onSelectDate={handleDatePress}
          />
          <View style={{ height: 120 }} />
        </ScrollView>
      )}

      {/* ── 주간 뷰 ── */}
      {viewMode === "weekly" && (
        <View style={{ flex: 1 }}>
          {groups.length === 0 && (
            <View style={s.emptyHintBanner}>
              <Text style={s.emptyHintText}>등록된 수업이 없습니다</Text>
            </View>
          )}
          <WeeklyTimetableV2
            groups={groups}
            onSelectClass={setDetailGroup}
            selectionMode={false}
            selectedIds={new Set()}
            toggleSelect={() => {}}
            weekStart={weeklyViewStart}
            changeLogs={[]}
            onPrevWeek={() => setWeeklyViewStart(prev => addDaysStr(prev, -7))}
            onNextWeek={() => setWeeklyViewStart(prev => addDaysStr(prev, 7))}
            statusMap={statusMap}
          />
        </View>
      )}

      {/* ── 일간 뷰 ── */}
      {viewMode === "daily" && (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
          <WeeklySchedule
            classGroups={groups}
            statusMap={statusMap}
            onSelectClass={setDetailGroup}
            themeColor={themeColor}
            selectionMode={false}
            selectedIds={new Set()}
            onToggleSelect={() => {}}
          />
          <View style={{ height: 80 }} />
        </ScrollView>
      )}

      {/* ── 날짜 상세 팝업 (월간) ── */}
      {viewMode === "monthly" && selectedDate && (
        <DaySheet
          dateStr={selectedDate}
          classes={dayClasses}
          attMap={dayAttMap}
          themeColor={themeColor}
          onClose={() => setSelectedDate(null)}
          onSelectClass={(g) => setDetailGroup(g)}
          onOpenMakeup={() => navigateFromSheet(() => router.push("/(admin)/makeups" as any))}
        />
      )}

      {/* ── 반 상세 시트 ── */}
      {detailGroup && (
        <AdminClassDetailSheet
          group={detailGroup}
          token={token}
          themeColor={themeColor}
          onClose={() => setDetailGroup(null)}
          onReload={() => { load(); setDetailGroup(null); }}
          onColorChange={(id, color) =>
            setGroups(prev => prev.map(g => g.id === id ? { ...g, color } : g))
          }
        />
      )}

      {/* 수강생관리 */}
      <StudentManagementSheet
        visible={showManagement}
        token={token}
        groups={groups}
        themeColor={themeColor}
        onClose={() => setShowManagement(false)}
        onAssignDone={() => {
          setShowManagement(false);
          setDetailGroup(null);
          setSelectedDate(null);
          load();
        }}
      />

      {/* 반 등록 */}
      {showCreate && (
        <ClassCreateFlow
          token={token}
          role="pool_admin"
          onSuccess={(newGroup) => {
            setGroups(prev => [...prev, newGroup as TeacherClassGroup]);
            setShowCreate(false);
            setTimeout(() => setDetailGroup(newGroup as TeacherClassGroup), 300);
          }}
          onClose={() => setShowCreate(false)}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: "#FFFFFF" },

  titleArea:   { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.border,
                 paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  titleRow:    { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  title:       { fontSize: 20, fontFamily: "Pretendard-Bold", color: "#0F172A" },
  titleSub:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B" },

  rightBtns:   { flexDirection: "row", gap: 4, alignItems: "center" },
  iconBtn:     { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 7, borderRadius: 10 },
  iconBtnTxt:  { fontSize: 12, fontFamily: "Pretendard-SemiBold" },
  mgmtBtn:     { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 7, borderRadius: 10, borderWidth: 1.5, backgroundColor: "#fff" },
  mgmtBtnTxt:  { fontSize: 12, fontFamily: "Pretendard-SemiBold" },
  createBtn:   { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 },
  createBtnTxt:{ color: "#fff", fontSize: 13, fontFamily: "Pretendard-SemiBold" },

  controlRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  viewToggle:  { flexDirection: "row", gap: 6 },
  toggleBtn:   { paddingHorizontal: 18, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: C.border, backgroundColor: "#fff" },
  toggleText:  { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: C.textSecondary },

  emptyBox:    { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyText:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted },
  emptyHintBanner: { paddingVertical: 6, paddingHorizontal: 14, backgroundColor: "#F1F5F9", borderBottomWidth: 1, borderBottomColor: "#F0EDE9", alignItems: "center" },
  emptyHintText:   { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },
});
