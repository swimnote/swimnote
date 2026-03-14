import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { ScreenLayout } from "@/components/common/ScreenLayout";
import { PageHeader }   from "@/components/common/PageHeader";
import { MainTabs }     from "@/components/common/MainTabs";

const C = Colors.light;

// ── 타입 ───────────────────────────────────────────────────────
interface ClassGroup { id: string; name: string; }
interface Student    { id: string; name: string; class_group_id: string | null; }
interface WeeklyRow {
  student_id: string; student_name: string;
  class_group_id: string | null; class_name: string | null;
  days: Record<string, string>;
}
interface MonthlySummaryRow {
  student_id: string; student_name: string;
  class_group_id: string | null; class_name: string | null;
  present: number; absent: number; late: number; total: number;
}
interface SearchRecord {
  id: string; date: string; status: string;
  student_id: string | null; student_name: string | null;
  class_group_id: string | null; class_name: string | null;
}
type AttStatus = "present" | "absent" | "late";
type ViewMode  = "daily" | "weekly" | "monthly" | "search";

const STATUS_CONFIG = {
  present: { label: "출석", color: Colors.light.present, bg: "#D1FAE5", icon: "check-circle" as const },
  absent:  { label: "결석", color: Colors.light.absent,  bg: "#FEE2E2", icon: "x-circle"    as const },
  late:    { label: "지각", color: Colors.light.late,    bg: "#FEF3C7", icon: "clock"        as const },
};
const DAYS_KO = ["일", "월", "화", "수", "목", "금", "토"];
const SEARCH_DAY_OPTIONS = [
  { label: "최근 7일",  value: 7  },
  { label: "최근 30일", value: 30 },
  { label: "전체",      value: 0  },
];

// ── 날짜 유틸 ──────────────────────────────────────────────────
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr); d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}
function getMonday(dateStr: string): string {
  const d = new Date(dateStr);
  const diff = d.getDay() === 0 ? -6 : 1 - d.getDay();
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
}
function formatDateLabel(ds: string): string {
  const d = new Date(ds);
  return `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일 (${DAYS_KO[d.getDay()]})`;
}
function formatWeekRange(start: string): string {
  const end = addDays(start, 6);
  return `${start.slice(5).replace("-","/")} ~ ${end.slice(5).replace("-","/")}`;
}
function formatMonthLabel(ds: string): string {
  const d = new Date(ds);
  return `${d.getFullYear()}년 ${d.getMonth()+1}월`;
}

// ── 메인 컴포넌트 ───────────────────────────────────────────────
export default function AttendanceScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();

  const [viewMode,      setViewMode]      = useState<ViewMode>("daily");
  const [baseDate,      setBaseDate]      = useState(() => new Date().toISOString().split("T")[0]);
  const [classGroups,   setClassGroups]   = useState<ClassGroup[]>([]);
  const [students,      setStudents]      = useState<Student[]>([]);
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [loadingInit,   setLoadingInit]   = useState(true);

  const [dailyAtt,      setDailyAtt]      = useState<Record<string, AttStatus>>({});
  const [savingId,      setSavingId]      = useState<string | null>(null);
  const [loadingDaily,  setLoadingDaily]  = useState(false);

  const [weeklyData,    setWeeklyData]    = useState<WeeklyRow[]>([]);
  const [loadingWeekly, setLoadingWeekly] = useState(false);

  const [monthlyData,    setMonthlyData]    = useState<MonthlySummaryRow[]>([]);
  const [loadingMonthly, setLoadingMonthly] = useState(false);

  const [searchName,      setSearchName]      = useState("");
  const [searchDays,      setSearchDays]      = useState(30);
  const [searchResults,   setSearchResults]   = useState<SearchRecord[]>([]);
  const [loadingSearch,   setLoadingSearch]   = useState(false);
  const [searchTriggered, setSearchTriggered] = useState(false);

  const searchInputRef = useRef<TextInput>(null);

  // ── 초기화 ────────────────────────────────────────────────────
  useEffect(() => { fetchInit(); }, []);

  async function fetchInit() {
    try {
      const [cgRes, stRes] = await Promise.all([
        apiRequest(token, "/class-groups"),
        apiRequest(token, "/students"),
      ]);
      const [cgs, sts] = await Promise.all([cgRes.json(), stRes.json()]);
      const cgArr: ClassGroup[] = Array.isArray(cgs) ? cgs : (cgs.data ?? []);
      const stArr: Student[]    = Array.isArray(sts) ? sts : (sts.data ?? []);
      setClassGroups(cgArr);
      setStudents(stArr);
      if (cgArr.length > 0) setSelectedClass(cgArr[0].id);
    } finally { setLoadingInit(false); }
  }

  // ── 일자별 ────────────────────────────────────────────────────
  const fetchDaily = useCallback(async (classId: string, date: string) => {
    setLoadingDaily(true);
    try {
      const res = await apiRequest(token, `/attendance?class_group_id=${classId}&date=${date}`);
      const data = await res.json();
      const arr = Array.isArray(data) ? data : (data.data ?? []);
      const map: Record<string, AttStatus> = {};
      arr.forEach((r: any) => { if (r.student_id) map[r.student_id] = r.status; });
      setDailyAtt(map);
    } catch (e) { console.error(e); }
    finally { setLoadingDaily(false); }
  }, [token]);

  useEffect(() => {
    if (viewMode === "daily" && selectedClass) fetchDaily(selectedClass, baseDate);
  }, [viewMode, selectedClass, baseDate]);

  // ── 주간 ──────────────────────────────────────────────────────
  const fetchWeekly = useCallback(async (classId: string | null, date: string) => {
    setLoadingWeekly(true);
    try {
      const monday = getMonday(date);
      const url = `/attendance/weekly?start_date=${monday}${classId ? `&class_group_id=${classId}` : ""}`;
      const res = await apiRequest(token, url);
      const json = await res.json();
      setWeeklyData(json.data ?? []);
    } catch (e) { console.error(e); }
    finally { setLoadingWeekly(false); }
  }, [token]);

  useEffect(() => {
    if (viewMode === "weekly") fetchWeekly(selectedClass, baseDate);
  }, [viewMode, selectedClass, baseDate]);

  // ── 월간 ──────────────────────────────────────────────────────
  const fetchMonthly = useCallback(async (classId: string | null, date: string) => {
    setLoadingMonthly(true);
    try {
      const d = new Date(date);
      const url = `/attendance/monthly-summary?year=${d.getFullYear()}&month=${d.getMonth()+1}${classId ? `&class_group_id=${classId}` : ""}`;
      const res = await apiRequest(token, url);
      const json = await res.json();
      setMonthlyData(json.data ?? []);
    } catch (e) { console.error(e); }
    finally { setLoadingMonthly(false); }
  }, [token]);

  useEffect(() => {
    if (viewMode === "monthly") fetchMonthly(selectedClass, baseDate);
  }, [viewMode, selectedClass, baseDate]);

  // ── 이름 검색 ─────────────────────────────────────────────────
  async function runSearch() {
    if (!searchName.trim()) return;
    setLoadingSearch(true); setSearchTriggered(true);
    try {
      const url = `/attendance/search?name=${encodeURIComponent(searchName.trim())}${searchDays ? `&days=${searchDays}` : ""}`;
      const res  = await apiRequest(token, url);
      const json = await res.json();
      setSearchResults(json.data ?? []);
    } catch (e) { console.error(e); }
    finally { setLoadingSearch(false); }
  }

  // ── 출결 저장 ─────────────────────────────────────────────────
  async function markAttendance(studentId: string, status: AttStatus) {
    if (!selectedClass) return;
    setSavingId(studentId);
    try {
      await apiRequest(token, "/attendance", {
        method: "POST",
        body: JSON.stringify({ student_id: studentId, class_group_id: selectedClass, date: baseDate, status }),
      });
      setDailyAtt(prev => ({ ...prev, [studentId]: status }));
    } finally { setSavingId(null); }
  }

  // ── 날짜 이동 ─────────────────────────────────────────────────
  function navigateDate(dir: -1 | 1) {
    if (viewMode === "daily")   { setBaseDate(d => addDays(d, dir)); return; }
    if (viewMode === "weekly")  { setBaseDate(d => addDays(d, 7 * dir)); return; }
    if (viewMode === "monthly") {
      setBaseDate(d => {
        const dt = new Date(d);
        dt.setMonth(dt.getMonth() + dir);
        return dt.toISOString().split("T")[0];
      });
    }
  }

  // ── 뷰 탭 핸들러 ─────────────────────────────────────────────
  function handleTabChange(tab: ViewMode) {
    setViewMode(tab);
    if (tab === "search") setTimeout(() => searchInputRef.current?.focus(), 100);
  }

  const classStudents = students.filter(s => s.class_group_id === selectedClass);
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(getMonday(baseDate), i));

  // ── 날짜 탐색 바 ─────────────────────────────────────────────
  const DateNav = (
    <View style={[a.dateNav, { backgroundColor: C.card, borderColor: C.border }]}>
      <Pressable style={a.navArrow} onPress={() => navigateDate(-1)}>
        <Feather name="chevron-left" size={20} color={C.textSecondary} />
      </Pressable>
      <Text style={[a.dateLabel, { color: C.text }]}>
        {viewMode === "daily"   && formatDateLabel(baseDate)}
        {viewMode === "weekly"  && formatWeekRange(getMonday(baseDate))}
        {viewMode === "monthly" && formatMonthLabel(baseDate)}
      </Text>
      <Pressable style={a.navArrow} onPress={() => navigateDate(1)}>
        <Feather name="chevron-right" size={20} color={C.textSecondary} />
      </Pressable>
    </View>
  );

  // ── 반 선택 탭 ───────────────────────────────────────────────
  const ClassTabs = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingVertical: 8 }}>
      {viewMode !== "monthly" && (
        <Pressable
          style={[a.classTab, { backgroundColor: selectedClass === null ? C.tint : C.card, borderColor: selectedClass === null ? C.tint : C.border }]}
          onPress={() => setSelectedClass(null)}
        >
          <Text style={[a.classTabText, { color: selectedClass === null ? "#fff" : C.textSecondary }]}>전체</Text>
        </Pressable>
      )}
      {classGroups.map(cg => (
        <Pressable
          key={cg.id}
          style={[a.classTab, { backgroundColor: selectedClass === cg.id ? C.tint : C.card, borderColor: selectedClass === cg.id ? C.tint : C.border }]}
          onPress={() => setSelectedClass(cg.id)}
        >
          <Text style={[a.classTabText, { color: selectedClass === cg.id ? "#fff" : C.textSecondary }]}>{cg.name}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );

  // ── 고정 상단 헤더 ───────────────────────────────────────────
  const header = (
    <>
      <PageHeader title="출결 관리" />
      <MainTabs<ViewMode>
        tabs={[
          { key: "daily",   label: "일자별" },
          { key: "weekly",  label: "주간"   },
          { key: "monthly", label: "월간"   },
          { key: "search",  label: "검색"   },
        ]}
        active={viewMode}
        onChange={handleTabChange}
      />
    </>
  );

  // ── 검색 모드 ─────────────────────────────────────────────────
  if (viewMode === "search") {
    return (
      <ScreenLayout header={header}>
        {/* 검색창 */}
        <View style={[a.searchBox, { backgroundColor: C.card, borderColor: C.border, marginTop: 10 }]}>
          <Feather name="search" size={16} color={C.textMuted} style={{ marginLeft: 12 }} />
          <TextInput
            ref={searchInputRef}
            style={[a.searchInput, { color: C.text }]}
            placeholder="회원 이름 검색"
            placeholderTextColor={C.textMuted}
            value={searchName}
            onChangeText={setSearchName}
            onSubmitEditing={runSearch}
            returnKeyType="search"
          />
          {searchName.length > 0 && (
            <Pressable onPress={() => { setSearchName(""); setSearchResults([]); setSearchTriggered(false); }} style={{ padding: 8 }}>
              <Feather name="x" size={16} color={C.textMuted} />
            </Pressable>
          )}
        </View>

        {/* 날짜 범위 필터 */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingVertical: 10 }}>
          {SEARCH_DAY_OPTIONS.map(opt => (
            <Pressable
              key={opt.value}
              style={[a.chip, { backgroundColor: searchDays === opt.value ? C.tintLight : C.card, borderColor: searchDays === opt.value ? C.tint : C.border }]}
              onPress={() => setSearchDays(opt.value)}
            >
              <Text style={[a.chipText, { color: searchDays === opt.value ? C.tint : C.textSecondary }]}>{opt.label}</Text>
            </Pressable>
          ))}
          <Pressable style={[a.chip, { backgroundColor: C.tint, borderColor: C.tint }]} onPress={runSearch}>
            <Text style={[a.chipText, { color: "#fff" }]}>검색</Text>
          </Pressable>
        </ScrollView>

        {loadingSearch ? (
          <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} />
        ) : searchTriggered && searchResults.length === 0 ? (
          <View style={a.empty}>
            <Feather name="search" size={36} color={C.textMuted} />
            <Text style={[a.emptyText, { color: C.textMuted }]}>검색 결과가 없습니다</Text>
          </View>
        ) : (
          <FlatList
            data={searchResults}
            keyExtractor={item => item.id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 100, paddingTop: 4, gap: 8 }}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={searchResults.length > 0 ? (
              <Text style={[a.resultCount, { color: C.textSecondary }]}>{searchResults.length}건 조회됨</Text>
            ) : null}
            renderItem={({ item }) => {
              const cfg = STATUS_CONFIG[item.status as AttStatus] ?? STATUS_CONFIG.absent;
              return (
                <View style={[a.searchCard, { backgroundColor: C.card, borderColor: C.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[a.searchName, { color: C.text }]}>{item.student_name ?? "-"}</Text>
                    <Text style={[a.searchSub, { color: C.textSecondary }]}>
                      {item.date}  {item.class_name ?? "반 미지정"}
                    </Text>
                  </View>
                  <View style={[a.badge, { backgroundColor: cfg.bg }]}>
                    <Feather name={cfg.icon} size={12} color={cfg.color} />
                    <Text style={[a.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
                  </View>
                </View>
              );
            }}
          />
        )}
      </ScreenLayout>
    );
  }

  // ── 일자별 / 주간 / 월간 공통 헤더 ───────────────────────────
  const commonSubHeader = (
    <>
      {DateNav}
      {!loadingInit && ClassTabs}
    </>
  );

  // ── 일자별 ────────────────────────────────────────────────────
  if (viewMode === "daily") {
    return (
      <ScreenLayout header={<>{header}{commonSubHeader}</>}>
        {(loadingDaily || loadingInit) ? (
          <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={classStudents}
            keyExtractor={item => item.id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 100, paddingTop: 4, gap: 10 }}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={a.empty}>
                <Feather name="users" size={40} color={C.textMuted} />
                <Text style={[a.emptyText, { color: C.textMuted }]}>
                  {classGroups.length === 0 ? "등록된 반이 없습니다" : "반에 배정된 회원이 없습니다"}
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              const status = dailyAtt[item.id];
              return (
                <View style={[a.card, { backgroundColor: C.card }]}>
                  <View style={[a.avatar, { backgroundColor: C.tintLight }]}>
                    <Text style={[a.avatarText, { color: C.tint }]}>{item.name[0]}</Text>
                  </View>
                  <View style={a.memberInfo}>
                    <Text style={[a.memberName, { color: C.text }]}>{item.name}</Text>
                    {status ? (
                      <View style={[a.badge, { backgroundColor: STATUS_CONFIG[status].bg }]}>
                        <Feather name={STATUS_CONFIG[status].icon} size={12} color={STATUS_CONFIG[status].color} />
                        <Text style={[a.badgeText, { color: STATUS_CONFIG[status].color }]}>{STATUS_CONFIG[status].label}</Text>
                      </View>
                    ) : (
                      <Text style={[a.noStatus, { color: C.textMuted }]}>미체크</Text>
                    )}
                  </View>
                  <View style={a.attBtns}>
                    {(["present", "late", "absent"] as AttStatus[]).map(st => (
                      <Pressable
                        key={st}
                        style={[a.attBtn, {
                          backgroundColor: status === st ? STATUS_CONFIG[st].bg    : C.background,
                          borderColor:     status === st ? STATUS_CONFIG[st].color : C.border,
                        }]}
                        onPress={() => markAttendance(item.id, st)}
                        disabled={savingId === item.id}
                      >
                        {savingId === item.id
                          ? <ActivityIndicator size="small" color={C.tint} />
                          : <Feather name={STATUS_CONFIG[st].icon} size={16} color={status === st ? STATUS_CONFIG[st].color : C.textMuted} />
                        }
                      </Pressable>
                    ))}
                  </View>
                </View>
              );
            }}
          />
        )}
      </ScreenLayout>
    );
  }

  // ── 주간 ──────────────────────────────────────────────────────
  if (viewMode === "weekly") {
    return (
      <ScreenLayout header={<>{header}{commonSubHeader}</>}>
        {loadingWeekly ? (
          <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} />
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View>
                <View style={[a.weekHeaderRow, { borderColor: C.border }]}>
                  <View style={[a.weekNameCell, { borderColor: C.border }]}>
                    <Text style={[a.weekHeaderText, { color: C.textSecondary }]}>회원</Text>
                  </View>
                  {weekDates.map(d => {
                    const dt = new Date(d);
                    const isToday = d === new Date().toISOString().split("T")[0];
                    const isSun = dt.getDay() === 0;
                    const isSat = dt.getDay() === 6;
                    return (
                      <View key={d} style={[a.weekDateCell, { borderColor: C.border, backgroundColor: isToday ? C.tintLight : "transparent" }]}>
                        <Text style={[a.weekDayLabel, { color: isSun ? "#EF4444" : isSat ? "#3B82F6" : C.textSecondary }]}>{DAYS_KO[dt.getDay()]}</Text>
                        <Text style={[a.weekDateLabel, { color: isToday ? C.tint : C.text }]}>{dt.getDate()}</Text>
                      </View>
                    );
                  })}
                </View>
                {weeklyData.length === 0 ? (
                  <View style={a.empty}>
                    <Text style={[a.emptyText, { color: C.textMuted }]}>데이터가 없습니다</Text>
                  </View>
                ) : weeklyData.map(row => (
                  <View key={row.student_id} style={[a.weekRow, { borderColor: C.border }]}>
                    <View style={[a.weekNameCell, { borderColor: C.border }]}>
                      <Text style={[a.weekStudentName, { color: C.text }]} numberOfLines={1}>{row.student_name}</Text>
                      {row.class_name && <Text style={[a.weekClassName, { color: C.textMuted }]} numberOfLines={1}>{row.class_name}</Text>}
                    </View>
                    {weekDates.map(d => {
                      const st = row.days[d] as AttStatus | undefined;
                      return (
                        <View key={d} style={[a.weekStatusCell, { borderColor: C.border }]}>
                          {st ? (
                            <View style={[a.weekBadge, { backgroundColor: STATUS_CONFIG[st].bg }]}>
                              <Text style={[a.weekBadgeText, { color: STATUS_CONFIG[st].color }]}>{STATUS_CONFIG[st].label}</Text>
                            </View>
                          ) : (
                            <Text style={[a.weekEmpty, { color: C.border }]}>-</Text>
                          )}
                        </View>
                      );
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>
          </ScrollView>
        )}
      </ScreenLayout>
    );
  }

  // ── 월간 ──────────────────────────────────────────────────────
  return (
    <ScreenLayout header={<>{header}{commonSubHeader}</>}>
      {loadingMonthly ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={monthlyData}
          keyExtractor={item => item.student_id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 100, paddingTop: 4, gap: 10 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={a.empty}>
              <Feather name="calendar" size={40} color={C.textMuted} />
              <Text style={[a.emptyText, { color: C.textMuted }]}>이 달의 출결 데이터가 없습니다</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={[a.monthCard, { backgroundColor: C.card, borderColor: C.border }]}>
              <View style={[a.avatar, { backgroundColor: C.tintLight }]}>
                <Text style={[a.avatarText, { color: C.tint }]}>{item.student_name[0]}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[a.memberName, { color: C.text }]}>{item.student_name}</Text>
                {item.class_name && <Text style={[a.weekClassName, { color: C.textMuted }]}>{item.class_name}</Text>}
              </View>
              <View style={a.monthStats}>
                <View style={a.monthStat}>
                  <Text style={[a.monthStatNum, { color: STATUS_CONFIG.present.color }]}>{item.present}</Text>
                  <Text style={[a.monthStatLabel, { color: C.textMuted }]}>출석</Text>
                </View>
                <View style={a.monthStat}>
                  <Text style={[a.monthStatNum, { color: STATUS_CONFIG.absent.color }]}>{item.absent}</Text>
                  <Text style={[a.monthStatLabel, { color: C.textMuted }]}>결석</Text>
                </View>
                <View style={a.monthStat}>
                  <Text style={[a.monthStatNum, { color: STATUS_CONFIG.late.color }]}>{item.late}</Text>
                  <Text style={[a.monthStatLabel, { color: C.textMuted }]}>지각</Text>
                </View>
              </View>
            </View>
          )}
        />
      )}
    </ScreenLayout>
  );
}

const a = StyleSheet.create({
  dateNav: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginHorizontal: 16, marginTop: 8, marginBottom: 2,
    borderRadius: 12, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 4,
  },
  navArrow: { padding: 8 },
  dateLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold", textAlign: "center", flex: 1 },

  classTab:     { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5 },
  classTabText: { fontSize: 14, fontFamily: "Inter_500Medium" },

  card: { flexDirection: "row", alignItems: "center", borderRadius: 14, padding: 14, gap: 12 },
  avatar:     { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  memberInfo: { flex: 1, gap: 4 },
  memberName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  badge:      { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText:  { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  noStatus:   { fontSize: 12, fontFamily: "Inter_400Regular" },
  attBtns:    { flexDirection: "row", gap: 8 },
  attBtn:     { width: 36, height: 36, borderRadius: 10, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },

  empty:     { alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  emptyText: { fontSize: 15, fontFamily: "Inter_400Regular" },

  weekHeaderRow:   { flexDirection: "row", borderBottomWidth: 1 },
  weekRow:         { flexDirection: "row", borderBottomWidth: 1 },
  weekNameCell:    { width: 88, paddingHorizontal: 10, paddingVertical: 10, borderRightWidth: 1, justifyContent: "center" },
  weekDateCell:    { width: 56, alignItems: "center", paddingVertical: 8, borderRightWidth: 1 },
  weekStatusCell:  { width: 56, alignItems: "center", justifyContent: "center", paddingVertical: 10, borderRightWidth: 1 },
  weekHeaderText:  { fontSize: 12, fontFamily: "Inter_500Medium" },
  weekDayLabel:    { fontSize: 11, fontFamily: "Inter_500Medium" },
  weekDateLabel:   { fontSize: 14, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  weekStudentName: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  weekClassName:   { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  weekBadge:       { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5 },
  weekBadgeText:   { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  weekEmpty:       { fontSize: 14 },

  monthCard:      { flexDirection: "row", alignItems: "center", borderRadius: 14, padding: 14, gap: 12, borderWidth: 1 },
  monthStats:     { flexDirection: "row", gap: 12 },
  monthStat:      { alignItems: "center", minWidth: 36 },
  monthStatNum:   { fontSize: 18, fontFamily: "Inter_700Bold" },
  monthStatLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },

  searchBox:   { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, marginHorizontal: 16, height: 46 },
  searchInput: { flex: 1, paddingHorizontal: 10, fontSize: 15, fontFamily: "Inter_400Regular", height: "100%" },
  chip:        { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, borderWidth: 1.5 },
  chipText:    { fontSize: 13, fontFamily: "Inter_500Medium" },
  searchCard:  { flexDirection: "row", alignItems: "center", borderRadius: 12, padding: 14, borderWidth: 1, gap: 10 },
  searchName:  { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  searchSub:   { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 3 },
  resultCount: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 8 },
});
