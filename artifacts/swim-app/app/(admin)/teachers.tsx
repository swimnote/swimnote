/**
 * (admin)/teachers.tsx — 선생님 관리 탭
 * 일간(Daily): 오늘 시간대 → 선생님 선택 → 반 목록 → 반 현황판
 * 월간(Monthly): 달력 → 날짜 클릭 → 해당 날 시간대 → 선생님 선택 → 반 목록 → 반 현황판
 * 계정 관리 모달 (추가·수정·삭제·인증코드) 보존
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Dimensions, KeyboardAvoidingView, Modal,
  Platform, Pressable, RefreshControl, ScrollView,
  StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import TeacherPickerList, { TeacherForPicker } from "@/components/admin/TeacherPickerList";
import ClassDetailPanel, { ClassDetail } from "@/components/admin/ClassDetailPanel";

const C = Colors.light;
const SCREEN_W = Dimensions.get("window").width;
const TAB_BAR_H = Platform.OS === "web" ? 84 : Platform.OS === "android" ? 56 : 49;

const DAY_KO = ["일", "월", "화", "수", "목", "금", "토"];
const WEEK_DAYS = ["월", "화", "수", "목", "금", "토", "일"];

function todayKo() { return DAY_KO[new Date().getDay()]; }
function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dateToKo(dateStr: string): string {
  return DAY_KO[new Date(dateStr + "T12:00:00Z").getUTCDay()];
}
function parseStartTime(t: string) { return t.split(/[-~]/)[0].trim(); }

const CLASS_COLORS = ["#3B82F6","#10B981","#F59E0B","#EF4444","#8B5CF6","#EC4899","#06B6D4","#84CC16"];
function classColor(id: string) {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
  return CLASS_COLORS[Math.abs(h) % CLASS_COLORS.length];
}

type ScheduleTab = "daily" | "monthly";

interface Teacher {
  id: string; name: string; email: string; phone: string; position: string;
  is_activated: boolean; is_admin_self_teacher: boolean; created_at: string;
}
interface ClassGroup {
  id: string; name: string; schedule_days: string; schedule_time: string;
  student_count: number; teacher_user_id?: string | null;
}
interface AttRecord { student_id: string; status: string; class_group_id: string; date: string; }
interface DiaryRecord { id: string; class_group_id: string; }

type NavStep =
  | { step: "main" }
  | { step: "timeslots"; date: string }
  | { step: "teachers"; time: string; day?: string; date?: string }
  | { step: "classes"; time: string; day?: string; date?: string; teacherId: string }
  | { step: "detail"; time: string; day?: string; date?: string; teacherId: string; classId: string };

// ─── 월간 달력 컴포넌트 ─────────────────────────────────────────────
function MonthlyCalendar({
  classGroups, onSelectDate,
}: { classGroups: ClassGroup[]; onSelectDate: (date: string) => void }) {
  const today = todayDateStr();
  const [offset, setOffset] = useState(0);
  const CELL = Math.floor((SCREEN_W - 32) / 7);

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

  function hasClasses(dateStr: string) {
    const koDay = dateToKo(dateStr);
    return classGroups.some(g => g.schedule_days.split(",").map(d => d.trim()).includes(koDay));
  }
  function getClasses(dateStr: string) {
    const koDay = dateToKo(dateStr);
    return classGroups.filter(g => g.schedule_days.split(",").map(d => d.trim()).includes(koDay));
  }

  return (
    <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10 }}>
        <Pressable style={mc.navBtn} onPress={() => setOffset(o => o - 1)}><Feather name="chevron-left" size={20} color={C.text} /></Pressable>
        <Text style={[mc.monthTitle, { color: C.text }]}>{year}년 {month}월</Text>
        <Pressable style={mc.navBtn} onPress={() => setOffset(o => o + 1)}><Feather name="chevron-right" size={20} color={C.text} /></Pressable>
      </View>
      <View style={{ flexDirection: "row" }}>
        {DAY_KO.map((wd, i) => (
          <View key={wd} style={[mc.weekHeader, { width: CELL }]}>
            <Text style={[mc.weekHeaderText, i === 0 && { color: "#EF4444" }, i === 6 && { color: C.tint }]}>{wd}</Text>
          </View>
        ))}
      </View>
      {Array.from({ length: Math.ceil(days.length / 7) }, (_, wi) => (
        <View key={wi} style={{ flexDirection: "row" }}>
          {days.slice(wi * 7, wi * 7 + 7).map((dateStr, di) => {
            if (!dateStr) return <View key={di} style={[mc.dayCell, { width: CELL }]} />;
            const isToday = dateStr === today;
            const cls = getClasses(dateStr);
            const dayNum = parseInt(dateStr.split("-")[2]);
            return (
              <Pressable key={dateStr} style={[mc.dayCell, { width: CELL }, isToday && { backgroundColor: C.tintLight, borderRadius: 8 }]}
                onPress={() => hasClasses(dateStr) ? onSelectDate(dateStr) : undefined}>
                <View style={[mc.dayNumWrap, isToday && { backgroundColor: C.tint }]}>
                  <Text style={[mc.dayNum, { color: di === 0 ? "#EF4444" : di === 6 ? C.tint : C.text }, isToday && { color: "#fff" }]}>
                    {dayNum}
                  </Text>
                </View>
                <View style={{ flexDirection: "row", gap: 1.5, marginTop: 3, flexWrap: "wrap", justifyContent: "center" }}>
                  {cls.slice(0, 4).map(g => (
                    <View key={g.id} style={[mc.dot, { backgroundColor: classColor(g.id) }]} />
                  ))}
                  {cls.length > 4 && <Text style={[mc.moreText, { color: C.textMuted }]}>+{cls.length - 4}</Text>}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const mc = StyleSheet.create({
  navBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  monthTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  weekHeader: { height: 28, alignItems: "center", justifyContent: "center" },
  weekHeaderText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  dayCell: { height: 64, alignItems: "center", paddingTop: 6 },
  dayNumWrap: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  dayNum: { fontSize: 13, fontFamily: "Inter_500Medium" },
  dot: { width: 6, height: 6, borderRadius: 3 },
  moreText: { fontSize: 8, fontFamily: "Inter_400Regular" },
});

// ─── 메인 화면 ─────────────────────────────────────────────────────
export default function TeachersScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();

  const [scheduleTab, setScheduleTab] = useState<ScheduleTab>("daily");
  const [nav, setNav] = useState<NavStep>({ step: "main" });

  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [classGroups, setClassGroups] = useState<ClassGroup[]>([]);
  const [attendanceMap, setAttendanceMap] = useState<Record<string, AttRecord[]>>({});
  const [diarySet, setDiarySet] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [classDetail, setClassDetail] = useState<ClassDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailDate, setDetailDate] = useState(todayDateStr());

  // ── 계정 관리 모달
  const [showAccounts, setShowAccounts] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState("");
  const [newTeacher, setNewTeacher] = useState<{ teacher: Teacher; code: string } | null>(null);
  const [codeVisible, setCodeVisible] = useState<Record<string, string>>({});
  const [loadingCode, setLoadingCode] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", is_admin_self_teacher: false });
  const [selectedTeacherDetail, setSelectedTeacherDetail] = useState<Teacher | null>(null);
  const [editName, setEditName] = useState(""); const [editPhone, setEditPhone] = useState(""); const [editPosition, setEditPosition] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Teacher | null>(null);

  // ── 데이터 로드
  const fetchAll = useCallback(async () => {
    try {
      const today = todayDateStr();
      const [tRes, cgRes, attRes, diaryRes] = await Promise.all([
        apiRequest(token, "/teachers"),
        apiRequest(token, "/class-groups"),
        apiRequest(token, `/attendance?date=${today}`),
        apiRequest(token, `/diary?date=${today}`),
      ]);
      if (tRes.ok) setTeachers(await tRes.json());
      if (cgRes.ok) setClassGroups(await cgRes.json());
      if (attRes.ok) {
        const data: AttRecord[] = await attRes.json();
        const map: Record<string, AttRecord[]> = {};
        data.forEach(a => { if (!map[a.class_group_id]) map[a.class_group_id] = []; map[a.class_group_id].push(a); });
        setAttendanceMap(map);
      }
      if (diaryRes.ok) {
        const data: DiaryRecord[] = await diaryRes.json();
        setDiarySet(new Set(data.map(d => d.class_group_id)));
      }
    } finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function fetchClassDetail(classId: string, date: string) {
    setDetailLoading(true); setDetailDate(date);
    try {
      const res = await apiRequest(token, `/admin/class-groups/${classId}/detail?date=${date}`);
      if (res.ok) setClassDetail(await res.json());
    } finally { setDetailLoading(false); }
  }

  // ── 탭 전환
  function switchTab(tab: ScheduleTab) { setScheduleTab(tab); setNav({ step: "main" }); }

  // ── 탐색 핸들러
  function onSelectDate(date: string) { setNav({ step: "timeslots", date }); }

  function onSelectTime(time: string, day?: string, date?: string) {
    setNav({ step: "teachers", time, day, date });
  }

  function onSelectTeacher(teacherId: string) {
    if (nav.step !== "teachers") return;
    setNav({ step: "classes", time: nav.time, day: nav.day, date: nav.date, teacherId });
  }

  function onSelectClass(classId: string) {
    if (nav.step !== "classes") return;
    setClassDetail(null);
    const date = nav.date || todayDateStr();
    setNav({ step: "detail", time: nav.time, day: nav.day, date: nav.date, teacherId: nav.teacherId, classId });
    fetchClassDetail(classId, date);
  }

  function goBack() {
    if (nav.step === "detail") { const { time, day, date, teacherId } = nav; setNav({ step: "classes", time, day, date, teacherId }); }
    else if (nav.step === "classes") { const { time, day, date } = nav; setNav({ step: "teachers", time, day, date }); }
    else if (nav.step === "teachers") {
      if (nav.date) setNav({ step: "timeslots", date: nav.date }); else setNav({ step: "main" });
    }
    else if (nav.step === "timeslots") { setNav({ step: "main" }); }
  }

  // ── 오늘 통계
  const todayGroups = useMemo(() => classGroups.filter(g => g.schedule_days.split(",").map(d => d.trim()).includes(todayKo())), [classGroups]);
  const todayUnchecked = todayGroups.filter(g => (attendanceMap[g.id]?.length ?? 0) < g.student_count).length;
  const todayUnwritten = todayGroups.filter(g => !diarySet.has(g.id)).length;

  // ── 시간대 목록 for daily
  const todayTimeSlots = useMemo(() =>
    Array.from(new Set(todayGroups.map(g => parseStartTime(g.schedule_time)))).sort(), [todayGroups]);

  // ── 시간대 목록 for monthly (given date)
  const timeslotsForDate = useMemo(() => {
    if (nav.step !== "timeslots") return [];
    const koDay = dateToKo(nav.date);
    const dayGroups = classGroups.filter(g => g.schedule_days.split(",").map(d => d.trim()).includes(koDay));
    return Array.from(new Set(dayGroups.map(g => parseStartTime(g.schedule_time)))).sort();
  }, [nav, classGroups]);

  // ── 선생님 목록 for picker
  const teachersForPicker = useMemo((): TeacherForPicker[] => {
    if (nav.step !== "teachers") return [];
    const { time, day, date } = nav;
    const koDay = day || (date ? dateToKo(date) : todayKo());
    const slotGroups = classGroups.filter(g =>
      g.schedule_days.split(",").map(d => d.trim()).includes(koDay) &&
      parseStartTime(g.schedule_time) === time
    );
    const ids = [...new Set(slotGroups.map(g => g.teacher_user_id).filter(Boolean))] as string[];
    return ids.map(id => {
      const t = teachers.find(x => x.id === id);
      if (!t) return null;
      const tgs = slotGroups.filter(g => g.teacher_user_id === id);
      return {
        id: t.id, name: t.name, position: t.position, classCount: tgs.length,
        uncheckedAtt: tgs.filter(g => (attendanceMap[g.id]?.length ?? 0) < g.student_count).length,
        unwrittenDiary: tgs.filter(g => !diarySet.has(g.id)).length,
      };
    }).filter(Boolean) as TeacherForPicker[];
  }, [nav, classGroups, teachers, attendanceMap, diarySet]);

  // ── 반 목록 for class list
  const classesForList = useMemo(() => {
    if (nav.step !== "classes") return [];
    const { time, day, date, teacherId } = nav;
    const koDay = day || (date ? dateToKo(date) : todayKo());
    return classGroups.filter(g =>
      g.schedule_days.split(",").map(d => d.trim()).includes(koDay) &&
      parseStartTime(g.schedule_time) === time &&
      g.teacher_user_id === teacherId
    );
  }, [nav, classGroups]);

  // ── 계정 관리 핸들러
  function resetForm() { setForm({ name: "", email: "", phone: "", password: "", is_admin_self_teacher: false }); setAddError(""); }
  async function handleCreate() {
    if (!form.name.trim() || !form.email.trim() || !form.password || !form.phone.trim()) { setAddError("모든 필수 항목을 입력해주세요."); return; }
    if (form.password.length < 6) { setAddError("비밀번호는 6자 이상이어야 합니다."); return; }
    setSaving(true); setAddError("");
    try {
      const res = await apiRequest(token, "/teachers", { method: "POST", body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "생성 실패");
      setShowAdd(false); resetForm();
      setNewTeacher({ teacher: data.teacher, code: data.activation_code });
      fetchAll();
    } catch (err: any) { setAddError(err.message || "생성 중 오류"); }
    finally { setSaving(false); }
  }
  async function handleViewCode(id: string) {
    setLoadingCode(id);
    try {
      const res = await apiRequest(token, `/teachers/${id}/activation-code`);
      const data = await res.json();
      if (res.ok) setCodeVisible(prev => ({ ...prev, [id]: data.activation_code }));
    } finally { setLoadingCode(null); }
  }
  function openTeacherEdit(t: Teacher) {
    setSelectedTeacherDetail(t); setEditName(t.name); setEditPhone(t.phone || ""); setEditPosition(t.position || "");
  }
  async function handleSaveTeacher() {
    if (!selectedTeacherDetail) return;
    setEditSaving(true);
    try {
      const res = await apiRequest(token, `/teachers/${selectedTeacherDetail.id}`, {
        method: "PATCH", body: JSON.stringify({ name: editName, phone: editPhone, position: editPosition }),
      });
      if (res.ok) { fetchAll(); setSelectedTeacherDetail(null); }
    } finally { setEditSaving(false); }
  }
  async function confirmDeleteTeacher() {
    if (!deleteTarget) return;
    const res = await apiRequest(token, `/teachers/${deleteTarget.id}`, { method: "DELETE" });
    setDeleteTarget(null);
    if (res.ok) { fetchAll(); setSelectedTeacherDetail(null); }
  }

  // ── 브레드크럼 헬퍼
  const crumbTime = (nav.step === "classes" || nav.step === "detail") ? (nav as any).time : nav.step === "teachers" ? nav.time : "";
  const crumbDay = (nav as any).day;
  const crumbDate = (nav as any).date;
  const crumbTeacher = (nav.step === "classes" || nav.step === "detail")
    ? teachers.find(t => t.id === (nav as any).teacherId)?.name ?? "선생님" : "";
  const crumbClass = nav.step === "detail" ? (classDetail?.class_group.name ?? "반 현황판") : "";

  // ── 현재 탭 보여야 하는 조건: "main" 또는 monthly "timeslots"
  const showTabs = nav.step === "main" || (nav.step === "timeslots" && scheduleTab === "monthly");

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <SubScreenHeader
        title={
          nav.step === "main" ? "선생님 관리"
          : nav.step === "timeslots" ? dateLabel((nav as any).date)
          : nav.step === "teachers" ? (crumbDate ? dateLabel(crumbDate) : `${crumbDay ?? "오늘"}요일 ${crumbTime}`)
          : nav.step === "classes" ? crumbTeacher
          : (classDetail?.class_group.name ?? "반 현황판")
        }
        onBack={nav.step !== "main" ? goBack : () => router.navigate("/(admin)/more" as any)}
        rightSlot={
          <Pressable style={[s.accountsBtn, { backgroundColor: C.tintLight }]} onPress={() => setShowAccounts(true)}>
            <Feather name="users" size={15} color={C.tint} />
            <Text style={[s.accountsBtnText, { color: C.tint }]}>계정</Text>
          </Pressable>
        }
      />

      {/* 탭 바 (daily/monthly) — main에서만 표시 */}
      {nav.step === "main" && (
        <View style={[s.tabBar, { borderBottomColor: C.border }]}>
          {(["daily", "monthly"] as ScheduleTab[]).map(tab => (
            <Pressable key={tab} style={[s.tabItem, scheduleTab === tab && { borderBottomColor: C.tint, borderBottomWidth: 2.5 }]} onPress={() => switchTab(tab)}>
              <Text style={[s.tabLabel, { color: scheduleTab === tab ? C.tint : C.textSecondary }]}>
                {tab === "daily" ? "일간" : "월간"}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* 브레드크럼 */}
      {nav.step !== "main" && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          style={[s.breadcrumb, { borderBottomColor: C.border }]}
          contentContainerStyle={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 20, paddingVertical: 8 }}>
          <Pressable onPress={() => setNav({ step: "main" })}><Text style={[s.crumb, { color: C.tint }]}>시간표</Text></Pressable>
          {(nav.step === "timeslots" || nav.step === "teachers" || nav.step === "classes" || nav.step === "detail") && crumbDate && (
            <>
              <Feather name="chevron-right" size={12} color={C.textMuted} />
              <Pressable onPress={() => {
                if (nav.step !== "timeslots") setNav({ step: "timeslots", date: crumbDate });
              }}>
                <Text style={[s.crumb, { color: nav.step === "timeslots" ? C.text : C.tint, fontWeight: nav.step === "timeslots" ? "700" : "500" }]}>
                  {dateLabel(crumbDate)}
                </Text>
              </Pressable>
            </>
          )}
          {(nav.step === "teachers" || nav.step === "classes" || nav.step === "detail") && (
            <>
              <Feather name="chevron-right" size={12} color={C.textMuted} />
              <Pressable onPress={() => {
                if (nav.step !== "teachers") setNav({ step: "teachers", time: crumbTime, day: crumbDay, date: crumbDate });
              }}>
                <Text style={[s.crumb, { color: nav.step === "teachers" ? C.text : C.tint, fontWeight: nav.step === "teachers" ? "700" : "500" }]}>
                  {crumbDay ? `${crumbDay}요일 ` : ""}{crumbTime}
                </Text>
              </Pressable>
            </>
          )}
          {(nav.step === "classes" || nav.step === "detail") && (
            <>
              <Feather name="chevron-right" size={12} color={C.textMuted} />
              <Pressable onPress={() => nav.step !== "classes" && setNav({ step: "classes", time: crumbTime, day: crumbDay, date: crumbDate, teacherId: (nav as any).teacherId })}>
                <Text style={[s.crumb, { color: nav.step === "classes" ? C.text : C.tint, fontWeight: nav.step === "classes" ? "700" : "500" }]}>{crumbTeacher}</Text>
              </Pressable>
            </>
          )}
          {nav.step === "detail" && crumbClass && (
            <>
              <Feather name="chevron-right" size={12} color={C.textMuted} />
              <Text style={[s.crumb, { color: C.text, fontWeight: "700" }]}>{crumbClass}</Text>
            </>
          )}
        </ScrollView>
      )}

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      ) : (
        <>
          {/* ── 반 현황판 */}
          {nav.step === "detail" && (
            <ClassDetailPanel detail={classDetail} loading={detailLoading} date={detailDate}
              onBack={goBack} bottomInset={insets.bottom + TAB_BAR_H + 20} />
          )}

          {/* ── 선생님 선택 */}
          {nav.step === "teachers" && (
            <TeacherPickerList time={crumbTime} day={crumbDay} date={crumbDate}
              teachers={teachersForPicker} onSelectTeacher={onSelectTeacher} onBack={goBack}
              bottomInset={insets.bottom + TAB_BAR_H + 20} />
          )}

          {/* ── 반 목록 */}
          {nav.step === "classes" && (
            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: insets.bottom + TAB_BAR_H + 20, gap: 8 }} showsVerticalScrollIndicator={false}>
              <Text style={[s.sectionTitle, { color: C.text }]}>{crumbTeacher} · 반 선택</Text>
              <Text style={[s.sectionSub, { color: C.textMuted }]}>
                {crumbDay ? `${crumbDay}요일 ` : crumbDate ? `${dateLabel(crumbDate)} ` : "오늘 "}{crumbTime}
              </Text>
              {classesForList.length === 0 ? (
                <View style={s.emptyBox}><Feather name="layers" size={36} color={C.textMuted} /><Text style={[s.emptyText, { color: C.textMuted }]}>해당 시간 반이 없습니다</Text></View>
              ) : classesForList.map(g => {
                const att = attendanceMap[g.id] || [];
                const present = att.filter(a => a.status === "present").length;
                const absent = att.filter(a => a.status === "absent").length;
                const hasDiary = diarySet.has(g.id);
                return (
                  <Pressable key={g.id} style={[s.classCard, { backgroundColor: C.card }]} onPress={() => onSelectClass(g.id)}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <Text style={[s.className, { color: C.text }]}>{g.name}</Text>
                        <View style={[s.diaryBadge, { backgroundColor: hasDiary ? "#D1FAE5" : "#FEF3C7" }]}>
                          <Text style={[s.diaryBadgeTxt, { color: hasDiary ? "#059669" : "#D97706" }]}>{hasDiary ? "일지 완료" : "일지 미작성"}</Text>
                        </View>
                      </View>
                      <View style={{ flexDirection: "row", gap: 12 }}>
                        <Text style={[s.classStat, { color: C.textSecondary }]}>학생 {g.student_count}명</Text>
                        <Text style={[s.classStat, { color: "#059669" }]}>출석 {present}</Text>
                        <Text style={[s.classStat, { color: "#EF4444" }]}>결석 {absent}</Text>
                      </View>
                    </View>
                    <Feather name="chevron-right" size={18} color={C.textMuted} />
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          {/* ── 메인 / 시간대 선택 */}
          {(nav.step === "main" || nav.step === "timeslots") && (
            <ScrollView
              contentContainerStyle={{ paddingBottom: insets.bottom + TAB_BAR_H + 20 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAll(); }} />}
              showsVerticalScrollIndicator={false}>

              {/* 일간 탭 — main */}
              {scheduleTab === "daily" && nav.step === "main" && (
                <>
                  {/* 오늘 통계 */}
                  <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 }}>
                    <Text style={[s.sectionTitle, { color: C.text }]}>오늘 확인할 것</Text>
                    <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
                      {[
                        { icon: "calendar", val: todayGroups.length, label: "오늘 수업", color: C.tint },
                        { icon: "alert-circle", val: todayUnchecked, label: "출결 미확인", color: todayUnchecked > 0 ? "#F59E0B" : "#10B981" },
                        { icon: "edit-3", val: todayUnwritten, label: "일지 미작성", color: todayUnwritten > 0 ? "#F59E0B" : "#10B981" },
                      ].map((st, i) => (
                        <View key={i} style={[s.statCard, { backgroundColor: C.card }]}>
                          <Feather name={st.icon as any} size={18} color={st.color} />
                          <Text style={[s.statNum, { color: st.color }]}>{st.val}</Text>
                          <Text style={[s.statLbl, { color: C.textMuted }]}>{st.label}</Text>
                        </View>
                      ))}
                    </View>
                  </View>

                  {/* 오늘 시간대 목록 */}
                  <View style={{ paddingHorizontal: 20, gap: 8 }}>
                    <Text style={[s.sectionTitle, { color: C.text }]}>오늘({todayKo()}요일) 수업 일정</Text>
                    {todayTimeSlots.length === 0 ? (
                      <View style={s.emptyBox}><Feather name="calendar" size={36} color={C.textMuted} /><Text style={[s.emptyText, { color: C.textMuted }]}>오늘 수업이 없습니다</Text></View>
                    ) : todayTimeSlots.map(time => {
                      const count = todayGroups.filter(g => parseStartTime(g.schedule_time) === time).length;
                      const teacherCount = [...new Set(todayGroups.filter(g => parseStartTime(g.schedule_time) === time && g.teacher_user_id).map(g => g.teacher_user_id))].length;
                      const attDone = todayGroups.filter(g => parseStartTime(g.schedule_time) === time && (attendanceMap[g.id]?.length ?? 0) >= g.student_count).length;
                      const diaryDone = todayGroups.filter(g => parseStartTime(g.schedule_time) === time && diarySet.has(g.id)).length;
                      return (
                        <Pressable key={time} style={[s.timeCard, { backgroundColor: C.card }]}
                          onPress={() => onSelectTime(time, todayKo())}>
                          <View style={[s.timeBox, { backgroundColor: C.tintLight }]}>
                            <Feather name="clock" size={14} color={C.tint} />
                            <Text style={[s.timeText, { color: C.tint }]}>{time}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[s.timeCardMain, { color: C.text }]}>{count}개 반 · {teacherCount}명 선생님</Text>
                            <View style={{ flexDirection: "row", gap: 8, marginTop: 3 }}>
                              <Text style={[s.timeCardSub, { color: attDone === count ? "#10B981" : "#F59E0B" }]}>출결 {attDone}/{count}</Text>
                              <Text style={[s.timeCardSub, { color: diaryDone === count ? "#10B981" : "#F59E0B" }]}>일지 {diaryDone}/{count}</Text>
                            </View>
                          </View>
                          <Feather name="chevron-right" size={18} color={C.textMuted} />
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              )}

              {/* 월간 탭 — main: 달력 */}
              {scheduleTab === "monthly" && nav.step === "main" && (
                <>
                  <View style={[s.hintRow, { backgroundColor: C.tintLight }]}>
                    <Feather name="info" size={13} color={C.tint} />
                    <Text style={[s.hintTxt, { color: C.tint }]}>수업이 있는 날짜를 눌러 탐색하세요</Text>
                  </View>
                  <MonthlyCalendar classGroups={classGroups} onSelectDate={onSelectDate} />
                </>
              )}

              {/* 월간 — timeslots: 해당 날 시간대 목록 */}
              {nav.step === "timeslots" && (
                <View style={{ paddingHorizontal: 20, paddingTop: 12, gap: 8 }}>
                  <Text style={[s.sectionTitle, { color: C.text }]}>{dateLabel((nav as any).date)} 수업</Text>
                  {timeslotsForDate.length === 0 ? (
                    <View style={s.emptyBox}><Feather name="calendar" size={36} color={C.textMuted} /><Text style={[s.emptyText, { color: C.textMuted }]}>해당 날 수업이 없습니다</Text></View>
                  ) : timeslotsForDate.map(time => {
                    const koDay = dateToKo((nav as any).date);
                    const slotGroups = classGroups.filter(g => g.schedule_days.split(",").map(d => d.trim()).includes(koDay) && parseStartTime(g.schedule_time) === time);
                    const teacherCount = [...new Set(slotGroups.map(g => g.teacher_user_id).filter(Boolean))].length;
                    return (
                      <Pressable key={time} style={[s.timeCard, { backgroundColor: C.card }]}
                        onPress={() => onSelectTime(time, koDay, (nav as any).date)}>
                        <View style={[s.timeBox, { backgroundColor: C.tintLight }]}>
                          <Feather name="clock" size={14} color={C.tint} />
                          <Text style={[s.timeText, { color: C.tint }]}>{time}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[s.timeCardMain, { color: C.text }]}>{slotGroups.length}개 반 · {teacherCount}명 선생님</Text>
                        </View>
                        <Feather name="chevron-right" size={18} color={C.textMuted} />
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </ScrollView>
          )}
        </>
      )}

      {/* ── 계정 목록 모달 ─────────────────────────────────────────────── */}
      <Modal visible={showAccounts} animationType="slide" transparent presentationStyle="overFullScreen">
        <View style={[s.overlay, { justifyContent: "flex-end" }]}>
          <View style={[s.sheet, { backgroundColor: C.card, height: "85%", borderTopLeftRadius: 24, borderTopRightRadius: 24 }]}>
            <View style={s.sheetHandle} />
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 12 }}>
              <Text style={[s.sheetTitle, { color: C.text }]}>선생님 계정 관리</Text>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable style={[s.addBtn, { backgroundColor: C.tint }]} onPress={() => { resetForm(); setShowAdd(true); }}>
                  <Feather name="plus" size={16} color="#fff" />
                  <Text style={s.addBtnText}>계정 추가</Text>
                </Pressable>
                <Pressable onPress={() => setShowAccounts(false)}>
                  <Feather name="x" size={22} color={C.textSecondary} />
                </Pressable>
              </View>
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, gap: 10 }} showsVerticalScrollIndicator={false}>
              {teachers.length === 0 ? (
                <View style={s.emptyBox}><Feather name="users" size={36} color={C.textMuted} /><Text style={[s.emptyText, { color: C.textMuted }]}>등록된 선생님이 없습니다</Text></View>
              ) : teachers.map(t => (
                <View key={t.id} style={[s.teacherCard, { backgroundColor: C.background }]}>
                  <Pressable style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }} onPress={() => openTeacherEdit(t)}>
                    <View style={[s.avatar, { backgroundColor: C.tintLight }]}><Feather name="user" size={18} color={C.tint} /></View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={[s.teacherName, { color: C.text }]}>{t.name}</Text>
                        {t.is_admin_self_teacher && (
                          <View style={[s.selfBadge, { backgroundColor: "#7C3AED15" }]}>
                            <Text style={[s.selfBadgeText, { color: "#7C3AED" }]}>내 계정</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[s.teacherSub, { color: C.textMuted }]}>{t.email}</Text>
                      {t.position && <Text style={[s.teacherSub, { color: C.tint }]}>{t.position}</Text>}
                    </View>
                    <View style={[s.statusBadge, { backgroundColor: t.is_activated ? "#D1FAE5" : "#FEF3C7" }]}>
                      <Text style={[s.statusText, { color: t.is_activated ? "#059669" : "#D97706" }]}>{t.is_activated ? "활성" : "인증 대기"}</Text>
                    </View>
                    <Feather name="edit-2" size={14} color={C.textMuted} />
                  </Pressable>
                  {!t.is_activated && (
                    <Pressable style={[s.codeBtn, { borderTopColor: C.border }]} onPress={() => handleViewCode(t.id)} disabled={loadingCode === t.id}>
                      {loadingCode === t.id ? <ActivityIndicator size={14} color={C.tint} />
                        : codeVisible[t.id] ? <Text style={[s.codeBtnText, { color: C.tint }]}>인증코드: {codeVisible[t.id]}</Text>
                        : <><Feather name="eye" size={13} color={C.tint} /><Text style={[s.codeBtnText, { color: C.tint }]}>인증코드 보기</Text></>}
                    </Pressable>
                  )}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 계정 추가 모달 */}
      <Modal visible={showAdd} animationType="slide" transparent presentationStyle="overFullScreen">
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={[s.overlay, { justifyContent: "flex-end" }]}>
            <View style={[s.sheet, { backgroundColor: C.card, paddingBottom: 40 }]}>
              <View style={s.sheetHandle} />
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={[s.sheetTitle, { color: C.text }]}>선생님 계정 추가</Text>
                <Pressable onPress={() => { setShowAdd(false); resetForm(); }}><Feather name="x" size={22} color={C.textSecondary} /></Pressable>
              </View>
              {addError ? <View style={[s.errBox, { backgroundColor: "#FEE2E2" }]}><Text style={[s.errText, { color: "#EF4444" }]}>{addError}</Text></View> : null}
              <View style={s.field}><Text style={[s.label, { color: C.textSecondary }]}>이름 *</Text>
                <TextInput style={[s.input, { borderColor: C.border, color: C.text }]} value={form.name} onChangeText={v => setForm(f => ({ ...f, name: v }))} placeholder="선생님 이름" placeholderTextColor={C.textMuted} /></View>
              <View style={s.field}><Text style={[s.label, { color: C.textSecondary }]}>이메일 *</Text>
                <TextInput style={[s.input, { borderColor: C.border, color: C.text }]} value={form.email} onChangeText={v => setForm(f => ({ ...f, email: v }))} placeholder="이메일" placeholderTextColor={C.textMuted} keyboardType="email-address" autoCapitalize="none" /></View>
              <View style={s.field}><Text style={[s.label, { color: C.textSecondary }]}>연락처 *</Text>
                <TextInput style={[s.input, { borderColor: C.border, color: C.text }]} value={form.phone} onChangeText={v => setForm(f => ({ ...f, phone: v }))} placeholder="010-0000-0000" placeholderTextColor={C.textMuted} keyboardType="phone-pad" /></View>
              <View style={s.field}><Text style={[s.label, { color: C.textSecondary }]}>비밀번호 *</Text>
                <TextInput style={[s.input, { borderColor: C.border, color: C.text }]} value={form.password} onChangeText={v => setForm(f => ({ ...f, password: v }))} placeholder="6자 이상" placeholderTextColor={C.textMuted} secureTextEntry /></View>
              <View style={[s.switchRow, { borderTopColor: C.border }]}>
                <Text style={[s.switchLabel, { color: C.text }]}>관리자 본인용 선생님 계정</Text>
                <Switch value={form.is_admin_self_teacher} onValueChange={v => setForm(f => ({ ...f, is_admin_self_teacher: v }))} trackColor={{ true: C.tint }} />
              </View>
              <View style={s.modalActions}>
                <Pressable style={[s.cancelBtn, { borderColor: C.border }]} onPress={() => { setShowAdd(false); resetForm(); }}>
                  <Text style={[s.cancelText, { color: C.textSecondary }]}>취소</Text>
                </Pressable>
                <Pressable style={[s.submitBtn, { backgroundColor: saving ? C.textMuted : C.tint }]} onPress={handleCreate} disabled={saving}>
                  <Text style={s.submitText}>{saving ? "생성 중…" : "계정 생성"}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 계정 생성 성공 모달 */}
      <Modal visible={!!newTeacher} animationType="fade" transparent presentationStyle="overFullScreen">
        <View style={[s.overlay, { justifyContent: "center" }]}>
          <View style={[s.successCard, { backgroundColor: C.card }]}>
            <View style={[s.successIcon, { backgroundColor: "#D1FAE5" }]}><Feather name="check-circle" size={36} color="#059669" /></View>
            <Text style={[s.sheetTitle, { color: C.text, textAlign: "center" }]}>계정 생성 완료</Text>
            <Text style={[s.label, { color: C.textSecondary, textAlign: "center" }]}>
              {newTeacher?.teacher.name} 선생님 계정이 생성되었습니다.{"\n"}아래 인증코드를 전달해 주세요.
            </Text>
            <View style={[s.codeBox, { backgroundColor: C.tintLight, borderRadius: 12 }]}>
              <Text style={[s.codeText, { color: C.tint }]}>{newTeacher?.code}</Text>
            </View>
            <Pressable style={[s.submitBtn, { backgroundColor: C.tint, width: "100%" }]} onPress={() => setNewTeacher(null)}>
              <Text style={s.submitText}>확인</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* 선생님 정보 수정 모달 */}
      <Modal visible={!!selectedTeacherDetail} animationType="slide" transparent presentationStyle="overFullScreen">
        <View style={[s.overlay, { justifyContent: "flex-end" }]}>
          <View style={[s.sheet, { backgroundColor: C.card, paddingBottom: 40 }]}>
            <View style={s.sheetHandle} />
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={[s.sheetTitle, { color: C.text }]}>선생님 정보 수정</Text>
              <Pressable onPress={() => setSelectedTeacherDetail(null)}><Feather name="x" size={22} color={C.textSecondary} /></Pressable>
            </View>
            <View style={s.field}><Text style={[s.label, { color: C.textSecondary }]}>이름</Text>
              <TextInput style={[s.input, { borderColor: C.border, color: C.text }]} value={editName} onChangeText={setEditName} placeholderTextColor={C.textMuted} /></View>
            <View style={s.field}><Text style={[s.label, { color: C.textSecondary }]}>연락처</Text>
              <TextInput style={[s.input, { borderColor: C.border, color: C.text }]} value={editPhone} onChangeText={setEditPhone} keyboardType="phone-pad" placeholderTextColor={C.textMuted} /></View>
            <View style={s.field}><Text style={[s.label, { color: C.textSecondary }]}>직급</Text>
              <TextInput style={[s.input, { borderColor: C.border, color: C.text }]} value={editPosition} onChangeText={setEditPosition} placeholder="예: 수석코치" placeholderTextColor={C.textMuted} /></View>
            <View style={[s.field, { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 }]}>
              <Text style={[s.label, { color: C.textMuted }]}>이메일: {selectedTeacherDetail?.email}</Text>
            </View>
            <View style={s.modalActions}>
              <Pressable style={[s.cancelBtn, { borderColor: "#EF4444" }]} onPress={() => { const t = selectedTeacherDetail; setSelectedTeacherDetail(null); setDeleteTarget(t); }}>
                <Text style={[s.cancelText, { color: "#EF4444" }]}>삭제</Text>
              </Pressable>
              <Pressable style={[s.submitBtn, { backgroundColor: editSaving ? C.textMuted : C.tint }]} onPress={handleSaveTeacher} disabled={editSaving}>
                <Text style={s.submitText}>{editSaving ? "저장 중…" : "저장"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* 삭제 확인 모달 */}
      <Modal visible={!!deleteTarget} animationType="fade" transparent presentationStyle="overFullScreen">
        <View style={[s.overlay, { justifyContent: "center" }]}>
          <View style={[s.successCard, { backgroundColor: C.card, gap: 16 }]}>
            <Text style={[s.sheetTitle, { color: C.text, textAlign: "center" }]}>선생님 삭제</Text>
            <Text style={[s.label, { color: C.textSecondary, textAlign: "center" }]}>
              {deleteTarget?.name} 계정을 삭제하시겠습니까?{"\n"}이 작업은 되돌릴 수 없습니다.
            </Text>
            <View style={s.modalActions}>
              <Pressable style={[s.cancelBtn, { borderColor: C.border }]} onPress={() => setDeleteTarget(null)}>
                <Text style={[s.cancelText, { color: C.textSecondary }]}>취소</Text>
              </Pressable>
              <Pressable style={[s.submitBtn, { backgroundColor: "#EF4444" }]} onPress={confirmDeleteTeacher}>
                <Text style={s.submitText}>삭제</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function dateLabel(dateStr: string) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T12:00:00Z");
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일(${DAY_KO[d.getUTCDay()]})`;
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 10 },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", flex: 1 },
  accountsBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
  accountsBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  tabBar: { flexDirection: "row", borderBottomWidth: 1 },
  tabItem: { flex: 1, alignItems: "center", paddingVertical: 12, borderBottomWidth: 2.5, borderBottomColor: "transparent" },
  tabLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  breadcrumb: { borderBottomWidth: 1 },
  crumb: { fontSize: 13, fontFamily: "Inter_500Medium" },
  hintRow: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginVertical: 10, padding: 10, borderRadius: 10 },
  hintTxt: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 2 },
  sectionSub: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 8 },
  statCard: { flex: 1, alignItems: "center", padding: 12, borderRadius: 14, gap: 4, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 1 },
  statNum: { fontSize: 22, fontFamily: "Inter_700Bold" },
  statLbl: { fontSize: 11, fontFamily: "Inter_400Regular" },
  timeCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 5, elevation: 1 },
  timeBox: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  timeText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  timeCardMain: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  timeCardSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  classCard: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 5, elevation: 1 },
  className: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  classStat: { fontSize: 12, fontFamily: "Inter_400Regular" },
  diaryBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  diaryBadgeTxt: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  teacherCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, padding: 14, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  teacherName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  teacherSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  selfBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  selfBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  codeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderTopWidth: 1 },
  codeBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  codeBox: { padding: 16, alignItems: "center" },
  codeText: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: 6 },
  emptyBox: { alignItems: "center", paddingVertical: 48, gap: 10 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 14 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  successCard: { marginHorizontal: 24, borderRadius: 20, padding: 24, alignItems: "center", gap: 12 },
  successIcon: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  addBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
  errBox: { padding: 10, borderRadius: 10 },
  errText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  field: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, height: 48, fontSize: 15, fontFamily: "Inter_400Regular" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, borderTopWidth: 1 },
  switchLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  cancelBtn: { flex: 1, height: 48, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  cancelText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  submitBtn: { flex: 1, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  submitText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  bg: {},
  shadow: {},
});
