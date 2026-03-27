/**
 * (admin)/teachers.tsx — 선생님 관리 탭
 * 일간(Daily): 오늘 시간대 → 선생님 선택 → 반 목록 → 반 현황판
 * 월간(Monthly): 달력 → 날짜 클릭 → 해당 날 시간대 → 선생님 선택 → 반 목록 → 반 현황판
 * 계정 관리 모달 → TeacherAccountSheet
 */
import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import TeacherPickerList, { TeacherForPicker } from "@/components/admin/TeacherPickerList";
import ClassDetailPanel, { ClassDetail } from "@/components/admin/ClassDetailPanel";
import { MonthlyCalendar } from "@/components/admin/teachers/MonthlyCalendar";
import { TeacherAccountSheet } from "@/components/admin/teachers/TeacherAccountSheet";

const C = Colors.light;
const TAB_BAR_H = Platform.OS === "web" ? 84 : Platform.OS === "android" ? 56 : 49;

const DAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

function todayKo() { return DAY_KO[new Date().getDay()]; }
function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dateToKo(dateStr: string): string {
  return DAY_KO[new Date(dateStr + "T12:00:00Z").getUTCDay()];
}
function parseStartTime(t: string) { return t.split(/[-~]/)[0].trim(); }

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

  const [showAccounts, setShowAccounts] = useState(false);

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

  function switchTab(tab: ScheduleTab) { setScheduleTab(tab); setNav({ step: "main" }); }
  function onSelectDate(date: string) { setNav({ step: "timeslots", date }); }
  function onSelectTime(time: string, day?: string, date?: string) { setNav({ step: "teachers", time, day, date }); }
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

  const todayGroups = useMemo(() => classGroups.filter(g => g.schedule_days.split(",").map(d => d.trim()).includes(todayKo())), [classGroups]);
  const todayUnchecked = todayGroups.filter(g => (attendanceMap[g.id]?.length ?? 0) < g.student_count).length;
  const todayUnwritten = todayGroups.filter(g => !diarySet.has(g.id)).length;

  const todayTimeSlots = useMemo(() =>
    Array.from(new Set(todayGroups.map(g => parseStartTime(g.schedule_time)))).sort(), [todayGroups]);

  const timeslotsForDate = useMemo(() => {
    if (nav.step !== "timeslots") return [];
    const koDay = dateToKo(nav.date);
    const dayGroups = classGroups.filter(g => g.schedule_days.split(",").map(d => d.trim()).includes(koDay));
    return Array.from(new Set(dayGroups.map(g => parseStartTime(g.schedule_time)))).sort();
  }, [nav, classGroups]);

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

  const crumbTime = (nav.step === "classes" || nav.step === "detail") ? (nav as any).time : nav.step === "teachers" ? nav.time : "";
  const crumbDay = (nav as any).day;
  const crumbDate = (nav as any).date;
  const crumbTeacher = (nav.step === "classes" || nav.step === "detail")
    ? teachers.find(t => t.id === (nav as any).teacherId)?.name ?? "선생님" : "";
  const crumbClass = nav.step === "detail" ? (classDetail?.class_group.name ?? "반 현황판") : "";

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
        onBack={nav.step !== "main" ? goBack : undefined}
        rightSlot={
          <Pressable style={[s.accountsBtn, { backgroundColor: C.tintLight }]} onPress={() => setShowAccounts(true)}>
            <Feather name="users" size={15} color={C.tint} />
            <Text style={[s.accountsBtnText, { color: C.tint }]}>계정</Text>
          </Pressable>
        }
      />

      {/* 탭 바 — main에서만 */}
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
              <Pressable onPress={() => { if (nav.step !== "timeslots") setNav({ step: "timeslots", date: crumbDate }); }}>
                <Text style={[s.crumb, { color: nav.step === "timeslots" ? C.text : C.tint, fontWeight: nav.step === "timeslots" ? "700" : "500" }]}>
                  {dateLabel(crumbDate)}
                </Text>
              </Pressable>
            </>
          )}
          {(nav.step === "teachers" || nav.step === "classes" || nav.step === "detail") && (
            <>
              <Feather name="chevron-right" size={12} color={C.textMuted} />
              <Pressable onPress={() => { if (nav.step !== "teachers") setNav({ step: "teachers", time: crumbTime, day: crumbDay, date: crumbDate }); }}>
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
          {nav.step === "detail" && (
            <ClassDetailPanel detail={classDetail} loading={detailLoading} date={detailDate}
              onBack={goBack} bottomInset={insets.bottom + TAB_BAR_H + 20} />
          )}

          {nav.step === "teachers" && (
            <TeacherPickerList time={crumbTime} day={crumbDay} date={crumbDate}
              teachers={teachersForPicker} onSelectTeacher={onSelectTeacher} onBack={goBack}
              bottomInset={insets.bottom + TAB_BAR_H + 20} />
          )}

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
                        <View style={[s.diaryBadge, { backgroundColor: hasDiary ? "#E6FFFA" : "#FFF1BF" }]}>
                          <Text style={[s.diaryBadgeTxt, { color: hasDiary ? "#2EC4B6" : "#D97706" }]}>{hasDiary ? "일지 완료" : "일지 미작성"}</Text>
                        </View>
                      </View>
                      <View style={{ flexDirection: "row", gap: 12 }}>
                        <Text style={[s.classStat, { color: C.textSecondary }]}>학생 {g.student_count}명</Text>
                        <Text style={[s.classStat, { color: "#2EC4B6" }]}>출석 {present}</Text>
                        <Text style={[s.classStat, { color: "#D96C6C" }]}>결석 {absent}</Text>
                      </View>
                    </View>
                    <Feather name="chevron-right" size={18} color={C.textMuted} />
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          {(nav.step === "main" || nav.step === "timeslots") && (
            <ScrollView
              contentContainerStyle={{ paddingBottom: insets.bottom + TAB_BAR_H + 20 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAll(); }} />}
              showsVerticalScrollIndicator={false}>

              {/* 일간 탭 — main */}
              {scheduleTab === "daily" && nav.step === "main" && (
                <>
                  <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 }}>
                    <Text style={[s.sectionTitle, { color: C.text }]}>오늘 확인할 것</Text>
                    <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
                      {[
                        { icon: "calendar", val: todayGroups.length, label: "오늘 수업", color: C.tint },
                        { icon: "alert-circle", val: todayUnchecked, label: "출결 미확인", color: todayUnchecked > 0 ? "#E4A93A" : "#2E9B6F" },
                        { icon: "edit-3", val: todayUnwritten, label: "일지 미작성", color: todayUnwritten > 0 ? "#E4A93A" : "#2E9B6F" },
                      ].map((st, i) => (
                        <View key={i} style={[s.statCard, { backgroundColor: C.card }]}>
                          <Feather name={st.icon as any} size={18} color={st.color} />
                          <Text style={[s.statNum, { color: st.color }]}>{st.val}</Text>
                          <Text style={[s.statLbl, { color: C.textMuted }]}>{st.label}</Text>
                        </View>
                      ))}
                    </View>
                  </View>

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
                              <Text style={[s.timeCardSub, { color: attDone === count ? "#2E9B6F" : "#E4A93A" }]}>출결 {attDone}/{count}</Text>
                              <Text style={[s.timeCardSub, { color: diaryDone === count ? "#2E9B6F" : "#E4A93A" }]}>일지 {diaryDone}/{count}</Text>
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

      <TeacherAccountSheet
        visible={showAccounts}
        teachers={teachers}
        token={token}
        onClose={() => setShowAccounts(false)}
        onRefresh={fetchAll}
      />
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
  emptyBox: { alignItems: "center", paddingVertical: 48, gap: 10 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
});
