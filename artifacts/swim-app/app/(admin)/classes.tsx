/**
 * (admin)/classes.tsx — 관리자 수업 탭
 * 선생님 my-schedule과 동일한 UI 구조
 * - 일간/주간/월간 뷰 토글
 * - 반 클릭 → AdminClassDetailSheet (반배정/미등록/반이동/담당선생님)
 * - 수강생관리 바텀시트 (배정 기능 활성)
 * - 반 등록 기능 유지
 * - returnTo=weekly URL 파라미터 지원
 */
import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Dimensions, Modal, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { addTabResetListener } from "@/utils/tabReset";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import ClassCreateFlow from "@/components/classes/ClassCreateFlow";
import { WeeklySchedule, DayBar, TeacherClassGroup, SlotStatus } from "@/components/teacher/WeeklySchedule";
import StudentManagementSheet from "@/components/teacher/StudentManagementSheet";
import AdminClassDetailSheet from "@/components/admin/AdminClassDetailSheet";

const C = Colors.light;
const SCREEN_W = Dimensions.get("window").width;
const KO_DAY_ARR = ["일", "월", "화", "수", "목", "금", "토"];
const TIMETABLE_COLS = ["월", "화", "수", "목", "금", "토", "일"];
const WEEKDAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
const COL_W = 64;
const TIME_W = 40;
const ROW_H = 56;

type ViewMode = "daily" | "weekly" | "monthly";

function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseHour(t: string): number { return parseInt(t.split(/[:-]/)[0]) || 0; }
function getKoDay(dateStr: string): string {
  return KO_DAY_ARR[new Date(dateStr + "T12:00:00Z").getUTCDay()];
}
function classesForDate(groups: TeacherClassGroup[], dateStr: string) {
  const koDay = getKoDay(dateStr);
  return groups.filter(g => g.schedule_days.split(",").map(d => d.trim()).includes(koDay))
    .sort((a, b) => parseHour(a.schedule_time) - parseHour(b.schedule_time));
}
function getHourRange(groups: TeacherClassGroup[]): number[] {
  if (!groups.length) return Array.from({ length: 8 }, (_, i) => i + 9);
  const hours = groups.map(g => parseHour(g.schedule_time));
  const minH = Math.max(6, Math.min(...hours));
  const maxH = Math.min(22, Math.max(...hours));
  return Array.from({ length: maxH - minH + 1 }, (_, i) => i + minH);
}

const COLORS = ["#3B82F6","#10B981","#F59E0B","#EF4444","#8B5CF6","#EC4899","#06B6D4","#84CC16"];
function classColor(id: string, alpha = 1) {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
  const base = COLORS[Math.abs(h) % COLORS.length];
  if (alpha === 1) return base;
  return base + Math.round(alpha * 255).toString(16).padStart(2, "0");
}

/* ── 주간 시간표 (read-only, 선택모드 없음) ── */
function WeeklyTimetable({ groups, onSelectClass }: {
  groups: TeacherClassGroup[];
  onSelectClass: (g: TeacherClassGroup) => void;
}) {
  const hours = useMemo(() => getHourRange(groups), [groups]);
  const cellClasses = useMemo(() => {
    const map: Record<string, TeacherClassGroup[]> = {};
    TIMETABLE_COLS.forEach(day => {
      hours.forEach(h => {
        const key = `${day}-${h}`;
        map[key] = groups.filter(g => {
          const days = g.schedule_days.split(",").map(d => d.trim());
          return days.includes(day) && parseHour(g.schedule_time) === h;
        });
      });
    });
    return map;
  }, [groups, hours]);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={wt.outer}>
      <View>
        <View style={wt.headerRow}>
          <View style={[wt.timeCell, wt.header]} />
          {TIMETABLE_COLS.map(day => (
            <View key={day} style={[wt.dayHeader, { width: COL_W }]}>
              <Text style={wt.dayHeaderText}>{day}</Text>
            </View>
          ))}
        </View>
        {hours.map(h => (
          <View key={h} style={[wt.row, { height: ROW_H }]}>
            <View style={wt.timeCell}>
              <Text style={wt.timeText}>{h}:00</Text>
            </View>
            {TIMETABLE_COLS.map(day => {
              const cls = cellClasses[`${day}-${h}`] ?? [];
              return (
                <View key={day} style={[wt.cell, { width: COL_W }]}>
                  {cls.map(g => (
                    <Pressable
                      key={g.id}
                      style={[wt.classCard, { backgroundColor: classColor(g.id) }]}
                      onPress={() => onSelectClass(g)}
                    >
                      <Text style={wt.cardName} numberOfLines={2}>{g.name}</Text>
                      <Text style={wt.cardTime} numberOfLines={1}>{g.schedule_time}</Text>
                    </Pressable>
                  ))}
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const wt = StyleSheet.create({
  outer:        { flex: 1 },
  headerRow:    { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.border },
  header:       { backgroundColor: "#F9FAFB" },
  dayHeader:    { height: 36, alignItems: "center", justifyContent: "center",
                  borderLeftWidth: 1, borderLeftColor: C.border, backgroundColor: "#F9FAFB" },
  dayHeaderText:{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.text },
  row:          { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  timeCell:     { width: TIME_W, alignItems: "center", justifyContent: "flex-start",
                  paddingTop: 4, borderRightWidth: 1, borderRightColor: C.border },
  timeText:     { fontSize: 10, fontFamily: "Inter_400Regular", color: C.textMuted },
  cell:         { borderLeftWidth: 1, borderLeftColor: "#F3F4F6", padding: 2, gap: 2 },
  classCard:    { flex: 1, borderRadius: 6, padding: 4, minHeight: 48, justifyContent: "center" },
  cardName:     { fontSize: 9, fontFamily: "Inter_600SemiBold", color: "#fff", lineHeight: 12 },
  cardTime:     { fontSize: 8, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.85)", marginTop: 2 },
});

/* ── 월간 달력 ── */
function MonthlyCalendar({ groups, themeColor, onSelectDate }: {
  groups: TeacherClassGroup[];
  themeColor: string;
  onSelectDate: (dateStr: string, cls: TeacherClassGroup[]) => void;
}) {
  const today = todayDateStr();
  const { token, adminUser } = useAuth();
  const poolId = (adminUser as any)?.swimming_pool_id || "";
  const [offset, setOffset] = useState(0);
  const [holidayDates, setHolidayDates] = useState<Set<string>>(new Set());

  const { year, month, days } = useMemo(() => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const firstDay = new Date(y, m - 1, 1).getDay();
    const daysInMonth = new Date(y, m, 0).getDate();
    const cells: (string | null)[] = Array(firstDay).fill(null);
    for (let i = 1; i <= daysInMonth; i++) {
      cells.push(`${y}-${String(m).padStart(2,"0")}-${String(i).padStart(2,"0")}`);
    }
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

  const CELL_SIZE = Math.floor((SCREEN_W - 32) / 7);

  return (
    <View style={mc.root}>
      <View style={mc.monthNav}>
        <Pressable style={mc.navBtn} onPress={() => setOffset(o => o - 1)}>
          <Feather name="chevron-left" size={20} color={C.text} />
        </Pressable>
        <Text style={mc.monthTitle}>{year}년 {month}월</Text>
        <Pressable style={mc.navBtn} onPress={() => setOffset(o => o + 1)}>
          <Feather name="chevron-right" size={20} color={C.text} />
        </Pressable>
      </View>
      <View style={mc.weekRow}>
        {WEEKDAY_NAMES.map((wd, i) => (
          <View key={wd} style={[mc.weekHeader, { width: CELL_SIZE }]}>
            <Text style={[mc.weekHeaderText, i === 0 && { color: "#EF4444" }, i === 6 && { color: themeColor }]}>{wd}</Text>
          </View>
        ))}
      </View>
      {Array.from({ length: Math.ceil(days.length / 7) }, (_, wi) => (
        <View key={wi} style={mc.weekRow}>
          {days.slice(wi * 7, wi * 7 + 7).map((dateStr, di) => {
            if (!dateStr) return <View key={di} style={[mc.dayCell, { width: CELL_SIZE }]} />;
            const isToday   = dateStr === today;
            const isHoliday = holidayDates.has(dateStr);
            const cls       = classesForDate(groups, dateStr);
            const dayNum    = parseInt(dateStr.split("-")[2]);
            const isSun     = di === 0;
            const isSat     = di === 6;
            return (
              <Pressable
                key={dateStr}
                style={[mc.dayCell, { width: CELL_SIZE },
                  isToday && { backgroundColor: themeColor + "12" },
                  isHoliday && { backgroundColor: "#FEF2F2" },
                ]}
                onPress={() => onSelectDate(dateStr, cls)}
              >
                <View style={[mc.dayNumWrap, isToday && { backgroundColor: themeColor }]}>
                  <Text style={[mc.dayNum,
                    (isSun || isHoliday) ? { color: "#EF4444" } : isSat ? { color: themeColor } : {},
                    isToday && { color: "#fff" },
                  ]}>{dayNum}</Text>
                </View>
                {isHoliday ? (
                  <Text style={mc.holidayTag}>휴무일</Text>
                ) : (
                  <View style={mc.dotsRow}>
                    {cls.slice(0, 4).map(g => (
                      <View key={g.id} style={[mc.dot, { backgroundColor: classColor(g.id) }]} />
                    ))}
                    {cls.length > 4 && <Text style={mc.moreText}>+{cls.length - 4}</Text>}
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
  navBtn:         { width: 36, height: 36, borderRadius: 10, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  monthTitle:     { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text },
  weekRow:        { flexDirection: "row" },
  weekHeader:     { height: 28, alignItems: "center", justifyContent: "center" },
  weekHeaderText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  dayCell:        { height: 64, alignItems: "center", paddingTop: 6, borderRadius: 8 },
  dayNumWrap:     { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  dayNum:         { fontSize: 13, fontFamily: "Inter_500Medium", color: C.text },
  dotsRow:        { flexDirection: "row", gap: 2, marginTop: 3, flexWrap: "wrap", justifyContent: "center" },
  dot:            { width: 6, height: 6, borderRadius: 3 },
  moreText:       { fontSize: 8, fontFamily: "Inter_400Regular", color: C.textMuted },
  holidayTag:     { fontSize: 9, fontFamily: "Inter_700Bold", color: "#EF4444", marginTop: 2 },
});

/* ── 날짜 시트 (월간 날짜 클릭) ── */
function DaySheet({ dateStr, dayClasses, themeColor, onSelectClass, onClose }: {
  dateStr: string; dayClasses: TeacherClassGroup[]; themeColor: string;
  onSelectClass: (g: TeacherClassGroup) => void; onClose: () => void;
}) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const DOW = ["일","월","화","수","목","금","토"][new Date(dateStr + "T00:00:00").getDay()];
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={daysh.backdrop} onPress={onClose} />
      <View style={[daysh.sheet, { minHeight: "30%" }]}>
        <View style={daysh.handle} />
        <View style={daysh.sheetHeader}>
          <Text style={[daysh.sheetTitle, { flex: 1 }]}>{y}년 {m}월 {d}일 ({DOW})</Text>
          <Pressable onPress={onClose} style={{ padding: 4 }}>
            <Feather name="x" size={20} color={C.textSecondary} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
          {dayClasses.length === 0 ? (
            <Text style={{ color: C.textMuted, textAlign: "center", marginTop: 20 }}>이 날 수업이 없습니다</Text>
          ) : dayClasses.map(g => (
            <Pressable key={g.id} style={[daysh.classRow, { borderLeftColor: classColor(g.id) }]}
              onPress={() => { onClose(); setTimeout(() => onSelectClass(g), 100); }}>
              <View style={[daysh.dot, { backgroundColor: classColor(g.id) }]} />
              <View style={{ flex: 1 }}>
                <Text style={daysh.className}>{g.name}</Text>
                <Text style={daysh.classSub}>{g.schedule_time} · {g.student_count}명</Text>
              </View>
              <Feather name="chevron-right" size={16} color={C.textMuted} />
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const daysh = StyleSheet.create({
  backdrop:    { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet:       { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
                 borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: "90%", minHeight: "30%" },
  handle:      { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB",
                 alignSelf: "center", marginTop: 10, marginBottom: 4 },
  sheetHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12,
                 borderBottomWidth: 1, borderBottomColor: C.border },
  sheetTitle:  { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text },
  classRow:    { flexDirection: "row", alignItems: "center", backgroundColor: C.card,
                 borderRadius: 12, padding: 12, gap: 10, borderLeftWidth: 4 },
  dot:         { width: 10, height: 10, borderRadius: 5 },
  className:   { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  classSub:    { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted, marginTop: 2 },
});

/* ══════════════════ 메인 스크린 ══════════════════ */
export default function ClassesScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();

  const [viewMode,    setViewMode]    = useState<ViewMode>("weekly");
  const [selectedDay, setSelectedDay] = useState(() => KO_DAY_ARR[new Date().getDay()]);
  const [groups,      setGroups]      = useState<TeacherClassGroup[]>([]);
  const [attMap,      setAttMap]      = useState<Record<string, number>>({});
  const [diarySet,    setDiarySet]    = useState<Set<string>>(new Set());
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);

  const [showCreate,      setShowCreate]      = useState(false);
  const [showManagement,  setShowManagement]  = useState(false);

  // 반 상세 시트
  const [detailGroup,  setDetailGroup]  = useState<TeacherClassGroup | null>(null);
  // 날짜 시트 (월간 → 날짜 클릭)
  const [daySheet,     setDaySheet]     = useState<{ dateStr: string; cls: TeacherClassGroup[] } | null>(null);

  // 탭 포커스 시 초기화
  useFocusEffect(useCallback(() => {
    setDetailGroup(null); setDaySheet(null);
  }, []));

  useEffect(() => {
    return addTabResetListener("classes", () => {
      setDetailGroup(null); setDaySheet(null); setViewMode("weekly");
    });
  }, []);

  /* ── 데이터 로드 ── */
  const load = useCallback(async () => {
    const today = todayDateStr();
    try {
      const [cgRes, attRes, dRes] = await Promise.all([
        apiRequest(token, "/class-groups"),
        apiRequest(token, `/attendance?date=${today}`),
        apiRequest(token, `/diary?date=${today}`),
      ]);
      if (cgRes.ok)  setGroups(await cgRes.json());
      if (attRes.ok) {
        const arr: any[] = await attRes.json();
        const map: Record<string, number> = {};
        arr.forEach(a => { const cid = a.class_group_id || a.class_id; if (cid) map[cid] = (map[cid] || 0) + 1; });
        setAttMap(map);
      }
      if (dRes.ok) {
        const arr: any[] = await dRes.json();
        setDiarySet(new Set(arr.map((d: any) => d.class_group_id).filter(Boolean)));
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // returnTo=weekly: class-assign 화면에서 돌아올 때 주간 뷰로 전환 + 갱신
  useEffect(() => {
    if (returnTo === "weekly") {
      setViewMode("weekly");
      setDetailGroup(null);
      setDaySheet(null);
      load();
    }
  }, [returnTo]);

  /* ── statusMap (WeeklySchedule 일간 뷰용) ── */
  const statusMap = useMemo(() => {
    const map: Record<string, SlotStatus> = {};
    groups.forEach(g => {
      map[g.id] = {
        attChecked: attMap[g.id] || 0,
        diaryDone:  diarySet.has(g.id),
        hasPhotos:  false,
      };
    });
    return map;
  }, [groups, attMap, diarySet]);

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <SubScreenHeader title="수업관리" />
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="수업관리" />

      {/* 타이틀 + 버튼 */}
      <View style={s.titleArea}>
        <View style={s.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>수업</Text>
            <Text style={s.titleSub}>
              {new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" })}
            </Text>
          </View>

          <View style={s.rightBtns}>
            <Pressable style={[s.iconBtn, { backgroundColor: "#FEF9C3" }]}
              onPress={() => router.push("/(admin)/community" as any)}>
              <Feather name="bell" size={13} color="#CA8A04" />
              <Text style={[s.iconBtnText, { color: "#CA8A04" }]}>공지</Text>
            </Pressable>
            <Pressable style={[s.iconBtn, { backgroundColor: "#EDE9FE" }]}
              onPress={() => router.push("/(admin)/makeups" as any)}>
              <Feather name="rotate-ccw" size={13} color="#7C3AED" />
              <Text style={[s.iconBtnText, { color: "#7C3AED" }]}>보강</Text>
            </Pressable>
            <Pressable style={[s.mgmtBtn, { borderColor: themeColor }]}
              onPress={() => setShowManagement(true)}>
              <Feather name="users" size={13} color={themeColor} />
              <Text style={[s.mgmtBtnText, { color: themeColor }]}>수강생관리</Text>
            </Pressable>
            <Pressable style={[s.createBtn, { backgroundColor: themeColor }]}
              onPress={() => setShowCreate(true)}>
              <Feather name="plus" size={14} color="#fff" />
              <Text style={s.createBtnText}>반 등록</Text>
            </Pressable>
          </View>
        </View>

        {/* 뷰 모드 토글 */}
        <View style={s.controlRow}>
          <View style={s.viewToggle}>
            {(["daily","weekly","monthly"] as ViewMode[]).map(mode => {
              const labels = { daily: "일간", weekly: "주간", monthly: "월간" };
              const isActive = viewMode === mode;
              return (
                <Pressable key={mode} style={[s.toggleBtn, isActive && { backgroundColor: themeColor, borderColor: themeColor }]}
                  onPress={() => setViewMode(mode)}>
                  <Text style={[s.toggleText, isActive && { color: "#fff" }]}>{labels[mode]}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>

      {/* ── 일간 뷰 ── */}
      {viewMode === "daily" && (
        <>
          {/* 요일 탭 — 스크롤 밖에 고정 */}
          <DayBar
            classGroups={groups}
            selectedDay={selectedDay}
            onDayChange={setSelectedDay}
            themeColor={themeColor}
          />
          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
            <WeeklySchedule
              classGroups={groups}
              statusMap={statusMap}
              onSelectClass={setDetailGroup}
              themeColor={themeColor}
              selectedDay={selectedDay}
              onDayChange={setSelectedDay}
              hideDayBar
              selectionMode={false}
              selectedIds={new Set()}
              onToggleSelect={() => {}}
            />
            {groups.length === 0 && (
              <View style={s.emptyBox}>
                <Feather name="layers" size={40} color={C.textMuted} />
                <Text style={s.emptyTitle}>등록된 반이 없습니다</Text>
                <Text style={s.emptySub}>상단 '반 등록'을 눌러 첫 번째 반을 만들어보세요</Text>
              </View>
            )}
          </ScrollView>
        </>
      )}

      {/* ── 주간 뷰 ── */}
      {viewMode === "weekly" && (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
          <WeeklyTimetable groups={groups} onSelectClass={setDetailGroup} />
          {groups.length === 0 && (
            <View style={s.emptyBox}>
              <Feather name="layers" size={40} color={C.textMuted} />
              <Text style={s.emptyTitle}>등록된 반이 없습니다</Text>
              <Text style={s.emptySub}>상단 '반 등록'을 눌러 첫 번째 반을 만들어보세요</Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* ── 월간 뷰 ── */}
      {viewMode === "monthly" && (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
          <MonthlyCalendar
            groups={groups}
            themeColor={themeColor}
            onSelectDate={(dateStr, cls) => setDaySheet({ dateStr, cls })}
          />
        </ScrollView>
      )}

      {/* 반 상세 시트 (관리자 전용: 반배정/미등록/반이동/담당선생님) */}
      {detailGroup && (
        <AdminClassDetailSheet
          group={detailGroup}
          token={token}
          themeColor={themeColor}
          onClose={() => setDetailGroup(null)}
          onReload={() => { load(); setDetailGroup(null); setViewMode("weekly"); }}
        />
      )}

      {/* 날짜 시트 */}
      {daySheet && (
        <DaySheet
          dateStr={daySheet.dateStr}
          dayClasses={daySheet.cls}
          themeColor={themeColor}
          onSelectClass={(g) => { setDaySheet(null); setTimeout(() => setDetailGroup(g), 100); }}
          onClose={() => setDaySheet(null)}
        />
      )}

      {/* 수강생관리 바텀시트 (관리자도 배정 가능) */}
      <StudentManagementSheet
        visible={showManagement}
        token={token}
        groups={groups}
        themeColor={themeColor}
        onClose={() => setShowManagement(false)}
        onAssignDone={() => {
          setShowManagement(false);
          setViewMode("weekly");
          setDetailGroup(null);
          setDaySheet(null);
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
  safe:         { flex: 1, backgroundColor: "#F3F4F6" },

  titleArea:    { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.border,
                  paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  titleRow:     { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  title:        { fontSize: 20, fontFamily: "Inter_700Bold", color: "#111827" },
  titleSub:     { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },

  rightBtns:    { flexDirection: "row", gap: 4, alignItems: "center" },
  iconBtn:      { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8,
                  paddingVertical: 7, borderRadius: 10 },
  iconBtnText:  { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  mgmtBtn:      { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8,
                  paddingVertical: 7, borderRadius: 10, borderWidth: 1.5, backgroundColor: "#fff" },
  mgmtBtnText:  { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  createBtn:    { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10,
                  paddingVertical: 8, borderRadius: 10 },
  createBtnText:{ color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },

  controlRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                  paddingHorizontal: 16, paddingVertical: 8 },
  viewToggle:   { flexDirection: "row", gap: 6 },
  toggleBtn:    { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20,
                  borderWidth: 1.5, borderColor: C.border, backgroundColor: "#fff" },
  toggleText:   { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textSecondary },

  emptyBox:     { alignItems: "center", paddingVertical: 60, gap: 10 },
  emptyTitle:   { fontSize: 14, fontFamily: "Inter_500Medium", color: C.textMuted },
  emptySub:     { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted, textAlign: "center" },
});
