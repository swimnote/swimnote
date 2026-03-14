import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

// ──────────────────────────── 타입 정의 ──────────────────────────────
interface ClassGroup { id: string; name: string; }
interface Student { id: string; name: string; class_group_id: string | null; }
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
type ViewMode = "daily" | "weekly" | "monthly" | "search";

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

// ──────────────────────────── 유틸 함수 ──────────────────────────────
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr); d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}
function getMonday(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
}
function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${DAYS_KO[d.getDay()]})`;
}
function formatWeekRange(start: string): string {
  const end = addDays(start, 6);
  return `${start.slice(5).replace("-", "/")} ~ ${end.slice(5).replace("-", "/")}`;
}
function formatMonthLabel(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
}
function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ──────────────────────────── 컴포넌트 ───────────────────────────────
export default function AttendanceScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const C = Colors.light;

  const [viewMode, setViewMode] = useState<ViewMode>("daily");
  const [baseDate, setBaseDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [classGroups, setClassGroups] = useState<ClassGroup[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [loadingInit, setLoadingInit] = useState(true);

  // 일자별
  const [dailyAtt, setDailyAtt] = useState<Record<string, AttStatus>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loadingDaily, setLoadingDaily] = useState(false);

  // 주간
  const [weeklyData, setWeeklyData] = useState<WeeklyRow[]>([]);
  const [loadingWeekly, setLoadingWeekly] = useState(false);

  // 월간
  const [monthlyData, setMonthlyData] = useState<MonthlySummaryRow[]>([]);
  const [loadingMonthly, setLoadingMonthly] = useState(false);

  // 검색
  const [searchName, setSearchName] = useState("");
  const [searchDays, setSearchDays] = useState(30);
  const [searchResults, setSearchResults] = useState<SearchRecord[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [searchTriggered, setSearchTriggered] = useState(false);

  const searchInputRef = useRef<TextInput>(null);

  // ─── 초기화 ───────────────────────────────────────────────────────
  useEffect(() => { fetchInit(); }, []);

  async function fetchInit() {
    try {
      const [cgRes, stRes] = await Promise.all([
        apiRequest(token, "/class-groups"),
        apiRequest(token, "/students"),
      ]);
      const [cgs, sts] = await Promise.all([cgRes.json(), stRes.json()]);
      const cgArr: ClassGroup[] = Array.isArray(cgs) ? cgs : (cgs.data ?? []);
      const stArr: Student[] = Array.isArray(sts) ? sts : (sts.data ?? []);
      setClassGroups(cgArr);
      setStudents(stArr);
      if (cgArr.length > 0) setSelectedClass(cgArr[0].id);
    } finally { setLoadingInit(false); }
  }

  // ─── 일자별 출결 조회 ─────────────────────────────────────────────
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

  // ─── 주간 조회 ────────────────────────────────────────────────────
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

  // ─── 월간 조회 ────────────────────────────────────────────────────
  const fetchMonthly = useCallback(async (classId: string | null, date: string) => {
    setLoadingMonthly(true);
    try {
      const d = new Date(date);
      const url = `/attendance/monthly-summary?year=${d.getFullYear()}&month=${d.getMonth() + 1}${classId ? `&class_group_id=${classId}` : ""}`;
      const res = await apiRequest(token, url);
      const json = await res.json();
      setMonthlyData(json.data ?? []);
    } catch (e) { console.error(e); }
    finally { setLoadingMonthly(false); }
  }, [token]);

  useEffect(() => {
    if (viewMode === "monthly") fetchMonthly(selectedClass, baseDate);
  }, [viewMode, selectedClass, baseDate]);

  // ─── 이름 검색 ────────────────────────────────────────────────────
  async function runSearch() {
    if (!searchName.trim()) return;
    setLoadingSearch(true);
    setSearchTriggered(true);
    try {
      const res = await apiRequest(token, `/attendance/search?name=${encodeURIComponent(searchName.trim())}&days=${searchDays}`);
      const json = await res.json();
      setSearchResults(json.data ?? []);
    } catch (e) { console.error(e); }
    finally { setLoadingSearch(false); }
  }

  // ─── 출결 체크/저장 ───────────────────────────────────────────────
  async function markAttendance(studentId: string, status: AttStatus) {
    if (!selectedClass) return;
    setSavingId(studentId);
    try {
      await apiRequest(token, "/attendance", {
        method: "POST",
        body: JSON.stringify({ class_group_id: selectedClass, student_id: studentId, date: baseDate, status }),
      });
      setDailyAtt(prev => ({ ...prev, [studentId]: status }));
    } finally { setSavingId(null); }
  }

  // ─── 날짜 탐색 ────────────────────────────────────────────────────
  function navigateDate(dir: -1 | 1) {
    if (viewMode === "daily")   setBaseDate(d => addDays(d, dir));
    else if (viewMode === "weekly") setBaseDate(d => addDays(d, 7 * dir));
    else if (viewMode === "monthly") {
      setBaseDate(d => {
        const dt = new Date(d);
        dt.setMonth(dt.getMonth() + dir);
        return dt.toISOString().split("T")[0];
      });
    }
  }

  // ─── 유틸 ─────────────────────────────────────────────────────────
  const classStudents = students.filter(s => s.class_group_id === selectedClass);
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(getMonday(baseDate), i));

  // ─── 렌더링 ───────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      {/* 헤더 */}
      <View style={[s.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <Text style={[s.title, { color: C.text }]}>출결 관리</Text>
        <Pressable
          style={[s.searchIconBtn, { backgroundColor: viewMode === "search" ? C.tintLight : C.card, borderColor: viewMode === "search" ? C.tint : C.border }]}
          onPress={() => {
            setViewMode(viewMode === "search" ? "daily" : "search");
            setTimeout(() => searchInputRef.current?.focus(), 100);
          }}
        >
          <Feather name="search" size={18} color={viewMode === "search" ? C.tint : C.textSecondary} />
        </Pressable>
      </View>

      {/* 보기 모드 탭 */}
      <View style={[s.modeRow, { borderColor: C.border }]}>
        {(["daily", "weekly", "monthly"] as const).map((m) => {
          const label = m === "daily" ? "일자별" : m === "weekly" ? "주간" : "월간";
          return (
            <Pressable
              key={m}
              style={[s.modeTab, { borderBottomColor: viewMode === m ? C.tint : "transparent" }]}
              onPress={() => setViewMode(m)}
            >
              <Text style={[s.modeTabText, { color: viewMode === m ? C.tint : C.textSecondary, fontFamily: viewMode === m ? "Inter_600SemiBold" : "Inter_400Regular" }]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {viewMode === "search" ? (
        /* ──── 검색 모드 ──── */
        <View style={{ flex: 1 }}>
          <View style={[s.searchBox, { backgroundColor: C.card, borderColor: C.border }]}>
            <Feather name="search" size={16} color={C.textMuted} style={{ marginLeft: 12 }} />
            <TextInput
              ref={searchInputRef}
              style={[s.searchInput, { color: C.text }]}
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
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingBottom: 8 }}>
            {SEARCH_DAY_OPTIONS.map((opt) => (
              <Pressable
                key={opt.value}
                style={[s.filterChip, { backgroundColor: searchDays === opt.value ? C.tintLight : C.card, borderColor: searchDays === opt.value ? C.tint : C.border }]}
                onPress={() => setSearchDays(opt.value)}
              >
                <Text style={[s.filterChipText, { color: searchDays === opt.value ? C.tint : C.textSecondary }]}>{opt.label}</Text>
              </Pressable>
            ))}
            <Pressable style={[s.filterChip, { backgroundColor: C.tint, borderColor: C.tint }]} onPress={runSearch}>
              <Text style={[s.filterChipText, { color: "#fff" }]}>검색</Text>
            </Pressable>
          </ScrollView>

          {loadingSearch ? (
            <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} />
          ) : searchTriggered && searchResults.length === 0 ? (
            <View style={s.empty}>
              <Feather name="search" size={36} color={C.textMuted} />
              <Text style={[s.emptyText, { color: C.textMuted }]}>검색 결과가 없습니다</Text>
            </View>
          ) : (
            <FlatList
              data={searchResults}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, paddingTop: 4, gap: 8 }}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const cfg = STATUS_CONFIG[item.status as AttStatus] ?? STATUS_CONFIG.absent;
                return (
                  <View style={[s.searchCard, { backgroundColor: C.card, borderColor: C.border }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.searchCardName, { color: C.text }]}>{item.student_name ?? "-"}</Text>
                      <Text style={[s.searchCardSub, { color: C.textSecondary }]}>
                        {item.date}  {item.class_name ?? "반 미지정"}
                      </Text>
                    </View>
                    <View style={[s.badge, { backgroundColor: cfg.bg }]}>
                      <Feather name={cfg.icon} size={12} color={cfg.color} />
                      <Text style={[s.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
                    </View>
                  </View>
                );
              }}
              ListHeaderComponent={
                searchResults.length > 0 ? (
                  <Text style={[s.resultCount, { color: C.textSecondary }]}>{searchResults.length}건 조회됨</Text>
                ) : null
              }
            />
          )}
        </View>
      ) : (
        /* ──── 일자별 / 주간 / 월간 공통 ──── */
        <View style={{ flex: 1 }}>
          {/* 날짜 탐색 바 */}
          <View style={[s.dateNav, { backgroundColor: C.card, borderColor: C.border }]}>
            <Pressable style={s.navArrow} onPress={() => navigateDate(-1)}>
              <Feather name="chevron-left" size={20} color={C.textSecondary} />
            </Pressable>
            <Text style={[s.dateNavLabel, { color: C.text }]}>
              {viewMode === "daily"   && formatDateLabel(baseDate)}
              {viewMode === "weekly"  && `${formatWeekRange(getMonday(baseDate))}`}
              {viewMode === "monthly" && formatMonthLabel(baseDate)}
            </Text>
            <Pressable style={s.navArrow} onPress={() => navigateDate(1)}>
              <Feather name="chevron-right" size={20} color={C.textSecondary} />
            </Pressable>
          </View>

          {/* 반 선택 탭 */}
          {!loadingInit && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingVertical: 8 }}>
              {viewMode !== "monthly" && (
                <Pressable
                  style={[s.classTab, { backgroundColor: selectedClass === null ? C.tint : C.card, borderColor: selectedClass === null ? C.tint : C.border }]}
                  onPress={() => setSelectedClass(null)}
                >
                  <Text style={[s.classTabText, { color: selectedClass === null ? "#fff" : C.textSecondary }]}>전체</Text>
                </Pressable>
              )}
              {classGroups.map((cg) => (
                <Pressable
                  key={cg.id}
                  style={[s.classTab, { backgroundColor: selectedClass === cg.id ? C.tint : C.card, borderColor: selectedClass === cg.id ? C.tint : C.border }]}
                  onPress={() => setSelectedClass(cg.id)}
                >
                  <Text style={[s.classTabText, { color: selectedClass === cg.id ? "#fff" : C.textSecondary }]}>{cg.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          {/* ── 일자별 콘텐츠 ── */}
          {viewMode === "daily" && (
            loadingDaily || loadingInit ? <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} /> : (
              <FlatList
                data={classStudents}
                keyExtractor={(item) => item.id}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, paddingTop: 4, gap: 10 }}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                  <View style={s.empty}>
                    <Feather name="users" size={40} color={C.textMuted} />
                    <Text style={[s.emptyText, { color: C.textMuted }]}>
                      {classGroups.length === 0 ? "등록된 반이 없습니다" : "반에 배정된 회원이 없습니다"}
                    </Text>
                  </View>
                }
                renderItem={({ item }) => {
                  const status = dailyAtt[item.id];
                  return (
                    <View style={[s.card, { backgroundColor: C.card, shadowColor: C.shadow }]}>
                      <View style={[s.avatar, { backgroundColor: C.tintLight }]}>
                        <Text style={[s.avatarText, { color: C.tint }]}>{item.name[0]}</Text>
                      </View>
                      <View style={s.memberInfo}>
                        <Text style={[s.memberName, { color: C.text }]}>{item.name}</Text>
                        {status ? (
                          <View style={[s.badge, { backgroundColor: STATUS_CONFIG[status].bg }]}>
                            <Feather name={STATUS_CONFIG[status].icon} size={12} color={STATUS_CONFIG[status].color} />
                            <Text style={[s.badgeText, { color: STATUS_CONFIG[status].color }]}>{STATUS_CONFIG[status].label}</Text>
                          </View>
                        ) : (
                          <Text style={[s.noStatus, { color: C.textMuted }]}>미체크</Text>
                        )}
                      </View>
                      <View style={s.attBtns}>
                        {(["present", "late", "absent"] as AttStatus[]).map((st) => (
                          <Pressable
                            key={st}
                            style={[s.attBtn, {
                              backgroundColor: status === st ? STATUS_CONFIG[st].bg : C.background,
                              borderColor: status === st ? STATUS_CONFIG[st].color : C.border,
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
            )
          )}

          {/* ── 주간 콘텐츠 ── */}
          {viewMode === "weekly" && (
            loadingWeekly ? <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} /> : (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}>
                {/* 요일 인덱스 헤더 */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View>
                    {/* 날짜 헤더 행 */}
                    <View style={[s.weekHeaderRow, { borderColor: C.border }]}>
                      <View style={[s.weekNameCell, { borderColor: C.border }]}>
                        <Text style={[s.weekHeaderText, { color: C.textSecondary }]}>회원</Text>
                      </View>
                      {weekDates.map((d) => {
                        const dt = new Date(d);
                        const isToday = d === new Date().toISOString().split("T")[0];
                        const isSun = dt.getDay() === 0;
                        const isSat = dt.getDay() === 6;
                        return (
                          <View key={d} style={[s.weekDateCell, { borderColor: C.border, backgroundColor: isToday ? C.tintLight : "transparent" }]}>
                            <Text style={[s.weekDayLabel, { color: isSun ? "#EF4444" : isSat ? "#3B82F6" : C.textSecondary }]}>{DAYS_KO[dt.getDay()]}</Text>
                            <Text style={[s.weekDateLabel, { color: isToday ? C.tint : C.text }]}>{dt.getDate()}</Text>
                          </View>
                        );
                      })}
                    </View>
                    {/* 학생별 행 */}
                    {weeklyData.length === 0 ? (
                      <View style={s.empty}>
                        <Text style={[s.emptyText, { color: C.textMuted }]}>데이터가 없습니다</Text>
                      </View>
                    ) : weeklyData.map((row) => (
                      <View key={row.student_id} style={[s.weekRow, { borderColor: C.border }]}>
                        <View style={[s.weekNameCell, { borderColor: C.border }]}>
                          <Text style={[s.weekStudentName, { color: C.text }]} numberOfLines={1}>{row.student_name}</Text>
                          {row.class_name && <Text style={[s.weekClassName, { color: C.textMuted }]} numberOfLines={1}>{row.class_name}</Text>}
                        </View>
                        {weekDates.map((d) => {
                          const st = row.days[d] as AttStatus | undefined;
                          return (
                            <View key={d} style={[s.weekStatusCell, { borderColor: C.border }]}>
                              {st ? (
                                <View style={[s.weekBadge, { backgroundColor: STATUS_CONFIG[st].bg }]}>
                                  <Text style={[s.weekBadgeText, { color: STATUS_CONFIG[st].color }]}>{STATUS_CONFIG[st].label}</Text>
                                </View>
                              ) : (
                                <Text style={[s.weekEmpty, { color: C.border }]}>-</Text>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </ScrollView>
            )
          )}

          {/* ── 월간 콘텐츠 ── */}
          {viewMode === "monthly" && (
            loadingMonthly ? <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} /> : (
              <FlatList
                data={monthlyData}
                keyExtractor={(item) => item.student_id}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, paddingTop: 4, gap: 10 }}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                  <View style={s.empty}>
                    <Feather name="calendar" size={40} color={C.textMuted} />
                    <Text style={[s.emptyText, { color: C.textMuted }]}>이 달의 출결 데이터가 없습니다</Text>
                  </View>
                }
                renderItem={({ item }) => (
                  <View style={[s.monthCard, { backgroundColor: C.card, borderColor: C.border }]}>
                    <View style={[s.avatar, { backgroundColor: C.tintLight }]}>
                      <Text style={[s.avatarText, { color: C.tint }]}>{item.student_name[0]}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.memberName, { color: C.text }]}>{item.student_name}</Text>
                      {item.class_name && <Text style={[s.weekClassName, { color: C.textMuted }]}>{item.class_name}</Text>}
                    </View>
                    <View style={s.monthStats}>
                      <View style={s.monthStat}>
                        <Text style={[s.monthStatNum, { color: STATUS_CONFIG.present.color }]}>{item.present}</Text>
                        <Text style={[s.monthStatLabel, { color: C.textMuted }]}>출석</Text>
                      </View>
                      <View style={s.monthStat}>
                        <Text style={[s.monthStatNum, { color: STATUS_CONFIG.absent.color }]}>{item.absent}</Text>
                        <Text style={[s.monthStatLabel, { color: C.textMuted }]}>결석</Text>
                      </View>
                      <View style={s.monthStat}>
                        <Text style={[s.monthStatNum, { color: STATUS_CONFIG.late.color }]}>{item.late}</Text>
                        <Text style={[s.monthStatLabel, { color: C.textMuted }]}>지각</Text>
                      </View>
                    </View>
                  </View>
                )}
              />
            )
          )}
        </View>
      )}
    </View>
  );
}

// ──────────────────────────── 스타일 ─────────────────────────────────
const s = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  searchIconBtn: { width: 38, height: 38, borderRadius: 10, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  modeRow: { flexDirection: "row", borderBottomWidth: 1, marginHorizontal: 20, marginBottom: 4 },
  modeTab: { flex: 1, alignItems: "center", paddingVertical: 10, borderBottomWidth: 2.5 },
  modeTabText: { fontSize: 14 },
  dateNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginHorizontal: 20, marginVertical: 8, borderRadius: 12, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 4 },
  navArrow: { padding: 8 },
  dateNavLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold", textAlign: "center", flex: 1 },
  classTab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5 },
  classTabText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  card: { flexDirection: "row", alignItems: "center", borderRadius: 14, padding: 14, gap: 12, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8, elevation: 2 },
  avatar: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  memberInfo: { flex: 1, gap: 4 },
  memberName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  noStatus: { fontSize: 12, fontFamily: "Inter_400Regular" },
  attBtns: { flexDirection: "row", gap: 8 },
  attBtn: { width: 36, height: 36, borderRadius: 10, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  emptyText: { fontSize: 15, fontFamily: "Inter_400Regular" },
  // 주간
  weekHeaderRow: { flexDirection: "row", borderBottomWidth: 1 },
  weekRow: { flexDirection: "row", borderBottomWidth: 1 },
  weekNameCell: { width: 88, paddingHorizontal: 10, paddingVertical: 10, borderRightWidth: 1, justifyContent: "center" },
  weekDateCell: { width: 56, alignItems: "center", paddingVertical: 8, borderRightWidth: 1 },
  weekStatusCell: { width: 56, alignItems: "center", justifyContent: "center", paddingVertical: 10, borderRightWidth: 1 },
  weekHeaderText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  weekDayLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  weekDateLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  weekStudentName: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  weekClassName: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  weekBadge: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5 },
  weekBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  weekEmpty: { fontSize: 14 },
  // 월간
  monthCard: { flexDirection: "row", alignItems: "center", borderRadius: 14, padding: 14, gap: 12, borderWidth: 1 },
  monthStats: { flexDirection: "row", gap: 12 },
  monthStat: { alignItems: "center", minWidth: 36 },
  monthStatNum: { fontSize: 18, fontFamily: "Inter_700Bold" },
  monthStatLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  // 검색
  searchBox: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, marginHorizontal: 20, marginBottom: 10, height: 46 },
  searchInput: { flex: 1, paddingHorizontal: 10, fontSize: 15, fontFamily: "Inter_400Regular", height: "100%" },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, borderWidth: 1.5 },
  filterChipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  searchCard: { flexDirection: "row", alignItems: "center", borderRadius: 12, padding: 14, borderWidth: 1, gap: 10 },
  searchCardName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  searchCardSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 3 },
  resultCount: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 8 },
});
