import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { ScreenLayout } from "@/components/common/ScreenLayout";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
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
interface MakeupSession {
  id: string; student_id: string; student_name: string;
  original_class_group_id: string | null; original_class_group_name: string;
  original_teacher_id: string | null; original_teacher_name: string;
  absence_date: string; status: string;
}
interface EligibleClass {
  id: string; name: string; schedule_days: string; schedule_time: string;
  capacity: number; current_members: number; available_slots: number;
  instructor: string; teacher_user_id: string;
}

type AttStatus = "present" | "absent" | "late";
type ViewMode  = "daily" | "weekly" | "monthly" | "search" | "makeup";

const STATUS_CONFIG = {
  present: { label: "출석", color: Colors.light.present, bg: "#DDF2EF", icon: "check-circle" as const },
  absent:  { label: "결석", color: Colors.light.absent,  bg: "#F9DEDA", icon: "x-circle"    as const },
  late:    { label: "지각", color: Colors.light.late,    bg: "#FFF1BF", icon: "clock"        as const },
};
const DAYS_KO = ["일", "월", "화", "수", "목", "금", "토"];
const SEARCH_DAY_OPTIONS = [
  { label: "최근 7일",  value: 7  },
  { label: "최근 30일", value: 30 },
  { label: "전체",      value: 0  },
];
const EXTINGUISH_REASONS = [
  { key: "보강원하지않음", label: "보강 원하지 않음" },
  { key: "무단결석",       label: "무단결석" },
  { key: "기타",           label: "기타 (직접입력)" },
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
function daysSince(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - d.getTime()) / 86400000);
}
function todayStr(): string { return new Date().toISOString().split("T")[0]; }

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

  // 보강관리 상태
  const [makeupList,    setMakeupList]    = useState<MakeupSession[]>([]);
  const [loadingMakeup, setLoadingMakeup] = useState(false);

  // 보강 지정 모달
  const [assignTarget,    setAssignTarget]    = useState<MakeupSession | null>(null);
  const [eligibleClasses, setEligibleClasses] = useState<EligibleClass[]>([]);
  const [loadingEligible, setLoadingEligible] = useState(false);
  const [assignClassId,   setAssignClassId]   = useState<string>("");
  const [assignDate,      setAssignDate]      = useState<string>("");
  const [assigning,       setAssigning]       = useState(false);

  // 결석소멸 모달
  const [extinguishTarget, setExtinguishTarget] = useState<MakeupSession | null>(null);
  const [extReason,        setExtReason]        = useState<string>("");
  const [extCustom,        setExtCustom]        = useState<string>("");
  const [extinguishing,    setExtinguishing]    = useState(false);

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

  // ── 보강 대기 목록 ────────────────────────────────────────────
  const fetchMakeup = useCallback(async () => {
    setLoadingMakeup(true);
    try {
      const res  = await apiRequest(token, "/admin/makeups/pending");
      const data = await res.json();
      setMakeupList(Array.isArray(data) ? data : []);
    } catch (e) { console.error(e); }
    finally { setLoadingMakeup(false); }
  }, [token]);

  useEffect(() => {
    if (viewMode === "makeup") fetchMakeup();
  }, [viewMode]);

  // ── 보강 지정 열기 ────────────────────────────────────────────
  async function openAssign(mk: MakeupSession) {
    setAssignTarget(mk);
    setAssignClassId("");
    setAssignDate(todayStr());
    setLoadingEligible(true);
    try {
      const res = await apiRequest(token, "/admin/makeups/eligible-classes");
      const data = await res.json();
      const list: EligibleClass[] = Array.isArray(data) ? data : [];
      // 같은 선생님 우선 정렬
      list.sort((a, b) => {
        const aMatch = a.teacher_user_id === mk.original_teacher_id ? 0 : 1;
        const bMatch = b.teacher_user_id === mk.original_teacher_id ? 0 : 1;
        return aMatch - bMatch;
      });
      setEligibleClasses(list);
    } catch (e) { console.error(e); }
    finally { setLoadingEligible(false); }
  }

  async function doAssign() {
    if (!assignTarget || !assignClassId) return;
    setAssigning(true);
    try {
      const res = await apiRequest(token, `/admin/makeups/${assignTarget.id}/assign`, {
        method: "PATCH",
        body: JSON.stringify({ class_group_id: assignClassId, assigned_date: assignDate }),
      });
      if (res.ok) {
        setAssignTarget(null);
        fetchMakeup();
      }
    } catch (e) { console.error(e); }
    finally { setAssigning(false); }
  }

  // ── 결석소멸 ─────────────────────────────────────────────────
  function openExtinguish(mk: MakeupSession) {
    setExtinguishTarget(mk);
    setExtReason("");
    setExtCustom("");
  }

  async function doExtinguish() {
    if (!extinguishTarget || !extReason) return;
    setExtinguishing(true);
    try {
      const res = await apiRequest(token, `/admin/makeups/${extinguishTarget.id}/extinguish`, {
        method: "POST",
        body: JSON.stringify({ reason: extReason, custom: extReason === "기타" ? extCustom : undefined }),
      });
      if (res.ok) {
        setExtinguishTarget(null);
        fetchMakeup();
      }
    } catch (e) { console.error(e); }
    finally { setExtinguishing(false); }
  }

  // ── 출결 저장 ─────────────────────────────────────────────────
  async function markAttendance(studentId: string, status: AttStatus) {
    if (!selectedClass) return;
    setSavingId(studentId);
    try {
      const prevStatus = dailyAtt[studentId] ?? null;
      await apiRequest(token, "/attendance", {
        method: "POST",
        body: JSON.stringify({ student_id: studentId, class_group_id: selectedClass, date: baseDate, status }),
      });
      setDailyAtt(prev => ({ ...prev, [studentId]: status }));
      // 결석 처리 → 보강대기 즉시 갱신
      if (status === "absent" && prevStatus !== "absent") {
        fetchMakeup();
      }
      // 결석 취소 → 보강대기에서 제거됨 → 즉시 갱신
      if (status !== "absent" && prevStatus === "absent") {
        fetchMakeup();
      }
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
      <SubScreenHeader title="출결 관리" />
      <MainTabs<ViewMode>
        tabs={[
          { key: "daily",   label: "일자별" },
          { key: "weekly",  label: "주간"   },
          { key: "monthly", label: "월간"   },
          { key: "search",  label: "검색"   },
          { key: "makeup",  label: makeupList.length > 0 ? `보강(${makeupList.length})` : "보강관리" },
        ]}
        active={viewMode}
        onChange={handleTabChange}
      />
    </>
  );

  // ── 보강 관리 탭 ─────────────────────────────────────────────
  if (viewMode === "makeup") {
    return (
      <ScreenLayout header={header}>
        {/* 보강 지정 모달 */}
        <Modal visible={!!assignTarget} transparent animationType="slide" onRequestClose={() => setAssignTarget(null)}>
          <View style={a.modalOverlay}>
            <View style={[a.modalSheet, { backgroundColor: C.card }]}>
              <View style={a.modalHeader}>
                <Text style={[a.modalTitle, { color: C.text }]}>보강 반 지정</Text>
                <Pressable onPress={() => setAssignTarget(null)}>
                  <Feather name="x" size={22} color={C.textSecondary} />
                </Pressable>
              </View>
              {assignTarget && (
                <Text style={[a.modalSub, { color: C.textSecondary }]}>
                  {assignTarget.student_name} · 결석일 {assignTarget.absence_date}
                </Text>
              )}
              {/* 날짜 선택 */}
              <Text style={[a.fieldLabel, { color: C.textSecondary }]}>보강 날짜</Text>
              <View style={[a.dateInput, { borderColor: C.border, backgroundColor: C.background }]}>
                <Feather name="calendar" size={16} color={C.textSecondary} style={{ marginRight: 8 }} />
                <TextInput
                  style={[{ flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", color: C.text }]}
                  value={assignDate}
                  onChangeText={setAssignDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={C.textMuted}
                />
              </View>
              {/* 반 목록 */}
              <Text style={[a.fieldLabel, { color: C.textSecondary, marginTop: 8 }]}>보강 가능 반 (정원 여유)</Text>
              {loadingEligible ? (
                <ActivityIndicator color={C.tint} style={{ marginTop: 16 }} />
              ) : (
                <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false}>
                  {eligibleClasses.length === 0 ? (
                    <Text style={[{ color: C.textMuted, textAlign: "center", marginTop: 24, fontFamily: "Inter_400Regular" }]}>
                      보강 가능한 반이 없습니다
                    </Text>
                  ) : eligibleClasses.map(ec => {
                    const isSame = assignTarget && ec.teacher_user_id === assignTarget.original_teacher_id;
                    const selected = assignClassId === ec.id;
                    return (
                      <TouchableOpacity
                        key={ec.id}
                        style={[a.eligibleCard, {
                          backgroundColor: selected ? C.tintLight : C.background,
                          borderColor: selected ? C.tint : C.border,
                        }]}
                        onPress={() => setAssignClassId(ec.id)}
                      >
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <Text style={[a.eligibleName, { color: C.text }]}>{ec.name}</Text>
                            {isSame && (
                              <View style={[a.sameTag, { backgroundColor: "#DDF2EF" }]}>
                                <Text style={{ fontSize: 10, color: "#1F8F86", fontFamily: "Inter_600SemiBold" }}>담당</Text>
                              </View>
                            )}
                          </View>
                          <Text style={[a.eligibleSub, { color: C.textSecondary }]}>
                            {ec.schedule_days} {ec.schedule_time} · {ec.instructor || "-"}
                          </Text>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={[a.slotText, { color: ec.available_slots > 0 ? C.tint : "#D96C6C" }]}>
                            여유 {ec.available_slots}명
                          </Text>
                          <Text style={[{ fontSize: 11, color: C.textMuted, fontFamily: "Inter_400Regular" }]}>
                            {ec.current_members}/{ec.capacity ?? "∞"}명
                          </Text>
                        </View>
                        {selected && <Feather name="check-circle" size={20} color={C.tint} style={{ marginLeft: 8 }} />}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}
              <Pressable
                style={[a.confirmBtn, { backgroundColor: assignClassId ? C.tint : C.border, opacity: assigning ? 0.6 : 1 }]}
                onPress={doAssign}
                disabled={!assignClassId || assigning}
              >
                {assigning
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={a.confirmBtnText}>보강 지정</Text>
                }
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* 결석소멸 모달 */}
        <Modal visible={!!extinguishTarget} transparent animationType="slide" onRequestClose={() => setExtinguishTarget(null)}>
          <View style={a.modalOverlay}>
            <View style={[a.modalSheet, { backgroundColor: C.card }]}>
              <View style={a.modalHeader}>
                <Text style={[a.modalTitle, { color: C.text }]}>결석 소멸</Text>
                <Pressable onPress={() => setExtinguishTarget(null)}>
                  <Feather name="x" size={22} color={C.textSecondary} />
                </Pressable>
              </View>
              {extinguishTarget && (
                <Text style={[a.modalSub, { color: C.textSecondary }]}>
                  {extinguishTarget.student_name} · 결석일 {extinguishTarget.absence_date}
                </Text>
              )}
              <Text style={[a.fieldLabel, { color: C.textSecondary }]}>소멸 사유 선택</Text>
              {EXTINGUISH_REASONS.map(r => (
                <TouchableOpacity
                  key={r.key}
                  style={[a.reasonRow, {
                    backgroundColor: extReason === r.key ? C.tintLight : C.background,
                    borderColor: extReason === r.key ? C.tint : C.border,
                  }]}
                  onPress={() => setExtReason(r.key)}
                >
                  <View style={[a.radio, { borderColor: extReason === r.key ? C.tint : C.border }]}>
                    {extReason === r.key && <View style={[a.radioDot, { backgroundColor: C.tint }]} />}
                  </View>
                  <Text style={[a.reasonLabel, { color: C.text }]}>{r.label}</Text>
                </TouchableOpacity>
              ))}
              {extReason === "기타" && (
                <TextInput
                  style={[a.customInput, { borderColor: C.border, color: C.text, backgroundColor: C.background }]}
                  placeholder="사유를 직접 입력하세요"
                  placeholderTextColor={C.textMuted}
                  value={extCustom}
                  onChangeText={setExtCustom}
                  multiline
                  numberOfLines={2}
                />
              )}
              <View style={[a.warnBox, { backgroundColor: "#FFF1BF" }]}>
                <Feather name="alert-triangle" size={14} color="#D97706" />
                <Text style={[{ fontSize: 12, fontFamily: "Inter_400Regular", color: "#92400E", flex: 1 }]}>
                  소멸 처리 후 보강 기회가 사라집니다. 신중히 처리하세요.
                </Text>
              </View>
              <Pressable
                style={[a.confirmBtn, { backgroundColor: extReason ? "#D96C6C" : C.border, opacity: extinguishing ? 0.6 : 1 }]}
                onPress={doExtinguish}
                disabled={!extReason || extinguishing || (extReason === "기타" && !extCustom.trim())}
              >
                {extinguishing
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={a.confirmBtnText}>소멸 처리</Text>
                }
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* 보강 대기 목록 */}
        {loadingMakeup ? (
          <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={makeupList}
            keyExtractor={item => item.id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 100, paddingTop: 12, gap: 10 }}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <View style={[a.makeupSummary, { backgroundColor: C.tintLight, borderColor: C.tint }]}>
                <Feather name="clock" size={16} color={C.tint} />
                <Text style={[{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.tint }]}>
                  보강 대기 {makeupList.length}명
                </Text>
                <Pressable style={[a.refreshBtn]} onPress={fetchMakeup}>
                  <Feather name="refresh-cw" size={14} color={C.tint} />
                </Pressable>
              </View>
            }
            ListEmptyComponent={
              <View style={a.empty}>
                <Feather name="check-circle" size={40} color={C.textMuted} />
                <Text style={[a.emptyText, { color: C.textMuted }]}>보강 대기 중인 회원이 없습니다</Text>
              </View>
            }
            renderItem={({ item }) => {
              const days = daysSince(item.absence_date);
              return (
                <View style={[a.mkCard, { backgroundColor: C.card, borderColor: days >= 14 ? "#FCA5A5" : C.border }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <View style={[a.avatar, { backgroundColor: C.tintLight }]}>
                      <Text style={[a.avatarText, { color: C.tint }]}>{item.student_name?.[0] ?? "?"}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[a.memberName, { color: C.text }]}>{item.student_name}</Text>
                      <Text style={[a.mkSub, { color: C.textSecondary }]}>
                        {item.original_class_group_name} · {item.original_teacher_name}
                      </Text>
                    </View>
                    <View style={[a.daysTag, { backgroundColor: days >= 14 ? "#F9DEDA" : "#F6F3F1" }]}>
                      <Text style={[a.daysTagText, { color: days >= 14 ? "#D96C6C" : C.textSecondary }]}>
                        {days}일 경과
                      </Text>
                    </View>
                  </View>
                  <Text style={[a.absDate, { color: C.textMuted }]}>결석일: {item.absence_date}</Text>
                  <View style={a.mkActions}>
                    <Pressable
                      style={[a.mkBtn, { backgroundColor: C.tint }]}
                      onPress={() => openAssign(item)}
                    >
                      <Feather name="calendar" size={14} color="#fff" />
                      <Text style={a.mkBtnText}>보강 지정</Text>
                    </Pressable>
                    <Pressable
                      style={[a.mkBtn, { backgroundColor: "#F9DEDA", borderWidth: 1, borderColor: "#FCA5A5" }]}
                      onPress={() => openExtinguish(item)}
                    >
                      <Feather name="x-circle" size={14} color="#D96C6C" />
                      <Text style={[a.mkBtnText, { color: "#D96C6C" }]}>결석 소멸</Text>
                    </Pressable>
                  </View>
                </View>
              );
            }}
          />
        )}
      </ScreenLayout>
    );
  }

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
            ListHeaderComponent={
              <View style={a.readonlyBanner}>
                <Feather name="info" size={13} color="#6F6B68" />
                <Text style={a.readonlyBannerTxt}>출결 체크는 선생님 모드에서만 처리 가능합니다 (관리자: 읽기 전용)</Text>
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
                  <View style={a.readonlyTag}>
                    <Feather name="lock" size={11} color="#9A948F" />
                    <Text style={a.readonlyTagTxt}>선생님 전용</Text>
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
                        <Text style={[a.weekDayLabel, { color: isSun ? "#D96C6C" : isSat ? "#4EA7D8" : C.textSecondary }]}>{DAYS_KO[dt.getDay()]}</Text>
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
      <Text style={{ backgroundColor: "red", color: "white", fontWeight: "bold", fontSize: 14, padding: 6, textAlign: "center" }}>
      </Text>
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
  readonlyTag:     { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: "#F6F3F1", borderWidth: 1, borderColor: "#E9E2DD" },
  readonlyTagTxt:  { fontSize: 11, fontFamily: "Inter_500Medium", color: "#9A948F" },
  readonlyBanner:  { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FFF9E6", borderRadius: 10, padding: 10, marginHorizontal: 0, marginBottom: 8 },
  readonlyBannerTxt: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6F6B68", flex: 1 },

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

  // 보강 관리
  makeupSummary: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1.5, marginBottom: 4 },
  refreshBtn:    { marginLeft: "auto" as any, padding: 4 },
  mkCard:        { borderRadius: 14, padding: 14, borderWidth: 1.5, backgroundColor: "#fff" },
  mkSub:         { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  absDate:       { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 8 },
  daysTag:       { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  daysTagText:   { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  mkActions:     { flexDirection: "row", gap: 8 },
  mkBtn:         { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  mkBtnText:     { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },

  // 모달
  modalOverlay:  { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet:    { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, gap: 12, maxHeight: "85%" },
  modalHeader:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle:    { fontSize: 18, fontFamily: "Inter_700Bold" },
  modalSub:      { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: -4 },
  fieldLabel:    { fontSize: 12, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  dateInput:     { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, height: 46 },
  eligibleCard:  { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderRadius: 12, padding: 12, marginBottom: 8, gap: 8 },
  eligibleName:  { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  eligibleSub:   { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  sameTag:       { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  slotText:      { fontSize: 13, fontFamily: "Inter_700Bold" },
  confirmBtn:    { padding: 14, borderRadius: 14, alignItems: "center", marginTop: 8 },
  confirmBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },
  reasonRow:     { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderRadius: 12, padding: 12, marginBottom: 6 },
  radio:         { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioDot:      { width: 10, height: 10, borderRadius: 5 },
  reasonLabel:   { fontSize: 14, fontFamily: "Inter_500Medium" },
  customInput:   { borderWidth: 1.5, borderRadius: 12, padding: 12, minHeight: 60, textAlignVertical: "top", fontSize: 14, fontFamily: "Inter_400Regular" },
  warnBox:       { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 10 },
});
