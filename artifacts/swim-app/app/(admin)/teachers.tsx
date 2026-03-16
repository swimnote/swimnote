import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal,
  Platform, Pressable, RefreshControl, ScrollView,
  StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;

// ── 타입 ──────────────────────────────────────────────────────────────
interface Teacher {
  id: string; name: string; email: string; phone: string; position: string;
  is_activated: boolean; is_admin_self_teacher: boolean; created_at: string;
}

interface ClassGroup {
  id: string; name: string;
  schedule_days: string; schedule_time: string;
  student_count: number; teacher_user_id?: string | null;
  level?: string | null; capacity?: number | null;
}

interface AttendanceRecord {
  student_id: string; status: string; class_group_id: string; date: string;
}

interface DiaryRecord {
  id: string; class_group_id: string; created_at: string;
}

interface StudentRecord {
  id: string; name: string; status: string; has_makeup: boolean;
}

interface AttDetailRecord {
  student_id: string; student_name: string; status: string; has_makeup: boolean;
}

interface DiaryDetail {
  id: string; common_content: string; teacher_name: string; created_at: string; is_edited: boolean;
}

interface ClassDetail {
  class_group: {
    id: string; name: string; schedule_days: string; schedule_time: string;
    capacity: number | null; teacher_id: string | null; teacher_name: string | null;
  };
  students: StudentRecord[];
  attendance: AttDetailRecord[];
  diary: DiaryDetail | null;
}

type ScheduleTab = "today" | "weekly";
type DashboardTab = "students" | "attendance" | "diary" | "absent";

// ── 요일 유틸 ─────────────────────────────────────────────────────────
const DAY_KO = ["일", "월", "화", "수", "목", "금", "토"];
const WEEK_DAYS = ["월", "화", "수", "목", "금", "토", "일"];

function todayKo() { return DAY_KO[new Date().getDay()]; }
function parseStartTime(t: string) { return t.split(/[-~]/)[0].trim(); }
function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function isTodayClass(g: ClassGroup) {
  return g.schedule_days.split(",").map(d => d.trim()).includes(todayKo());
}

// ── 공통 반 현황판 컴포넌트 ─────────────────────────────────────────────
function ClassDashboard({
  detail, loading, date, onClose,
}: {
  detail: ClassDetail | null; loading: boolean; date: string; onClose: () => void;
}) {
  const [tab, setTab] = useState<DashboardTab>("students");
  const cg = detail?.class_group;
  const students = detail?.students ?? [];
  const attendance = detail?.attendance ?? [];
  const diary = detail?.diary;
  const present = attendance.filter(a => a.status === "present").length;
  const absent = attendance.filter(a => a.status === "absent").length;

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      {/* 상단 요약 */}
      <Pressable onPress={onClose} style={[db.backRow, { borderBottomColor: C.border }]}>
        <Feather name="chevron-left" size={20} color={C.tint} />
        <Text style={[db.backText, { color: C.tint }]}>반 목록으로</Text>
      </Pressable>

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
          {/* 반 요약 카드 */}
          <View style={[db.summaryCard, { backgroundColor: C.card, shadowColor: C.shadow }]}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
              <View style={{ flex: 1 }}>
                <Text style={[db.className, { color: C.text }]}>{cg?.name ?? "—"}</Text>
                <Text style={[db.subInfo, { color: C.textSecondary }]}>
                  {cg?.teacher_name ?? "선생님 미지정"} · {cg?.schedule_time}
                </Text>
                <Text style={[db.subInfo, { color: C.textMuted }]}>{cg?.schedule_days}</Text>
              </View>
              {diary ? (
                <View style={[db.badge, { backgroundColor: "#D1FAE5" }]}>
                  <Text style={[db.badgeText, { color: "#059669" }]}>일지 완료</Text>
                </View>
              ) : (
                <View style={[db.badge, { backgroundColor: "#FEF3C7" }]}>
                  <Text style={[db.badgeText, { color: "#D97706" }]}>일지 미작성</Text>
                </View>
              )}
            </View>
            <View style={[db.statRow, { borderTopColor: C.border }]}>
              <View style={db.statItem}>
                <Text style={[db.statVal, { color: C.text }]}>{students.length}</Text>
                <Text style={[db.statLabel, { color: C.textMuted }]}>총 학생</Text>
              </View>
              <View style={[db.statDivider, { backgroundColor: C.border }]} />
              <View style={db.statItem}>
                <Text style={[db.statVal, { color: "#059669" }]}>{present}</Text>
                <Text style={[db.statLabel, { color: C.textMuted }]}>출석</Text>
              </View>
              <View style={[db.statDivider, { backgroundColor: C.border }]} />
              <View style={db.statItem}>
                <Text style={[db.statVal, { color: "#EF4444" }]}>{absent}</Text>
                <Text style={[db.statLabel, { color: C.textMuted }]}>결석</Text>
              </View>
              <View style={[db.statDivider, { backgroundColor: C.border }]} />
              <View style={db.statItem}>
                <Text style={[db.statVal, { color: C.tint }]}>{students.filter(s => s.has_makeup).length}</Text>
                <Text style={[db.statLabel, { color: C.textMuted }]}>보강</Text>
              </View>
            </View>
          </View>

          {/* 탭 바 */}
          <View style={[db.tabBar, { borderBottomColor: C.border }]}>
            {([
              { key: "students" as DashboardTab, label: "학생" },
              { key: "attendance" as DashboardTab, label: "출결" },
              { key: "diary" as DashboardTab, label: "일지" },
              { key: "absent" as DashboardTab, label: "결석" },
            ]).map(({ key, label }) => (
              <Pressable key={key} style={[db.tabItem, tab === key && { borderBottomColor: C.tint, borderBottomWidth: 2 }]} onPress={() => setTab(key)}>
                <Text style={[db.tabLabel, { color: tab === key ? C.tint : C.textSecondary }]}>{label}</Text>
              </Pressable>
            ))}
          </View>

          {/* 학생 탭 */}
          {tab === "students" && (
            <View style={{ paddingHorizontal: 20, paddingTop: 12, gap: 8 }}>
              {students.length === 0 ? (
                <Text style={[db.empty, { color: C.textMuted }]}>등록된 학생이 없습니다</Text>
              ) : students.map(s => (
                <View key={s.id} style={[db.listRow, { backgroundColor: C.card, shadowColor: C.shadow }]}>
                  <View style={[db.avatar, { backgroundColor: C.tintLight }]}>
                    <Feather name="user" size={16} color={C.tint} />
                  </View>
                  <Text style={[db.listName, { color: C.text }]}>{s.name}</Text>
                  {s.has_makeup && (
                    <View style={[db.mkBadge, { backgroundColor: "#EDE9FE" }]}>
                      <Text style={[db.mkText, { color: "#7C3AED" }]}>보강</Text>
                    </View>
                  )}
                  <View style={[db.statusPill, { backgroundColor: s.status === "active" ? "#D1FAE5" : "#FEF3C7" }]}>
                    <Text style={[db.statusText, { color: s.status === "active" ? "#059669" : "#D97706" }]}>
                      {s.status === "active" ? "정상" : s.status}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* 출결 탭 */}
          {tab === "attendance" && (
            <View style={{ paddingHorizontal: 20, paddingTop: 12, gap: 8 }}>
              {attendance.length === 0 ? (
                <Text style={[db.empty, { color: C.textMuted }]}>출결 기록이 없습니다</Text>
              ) : attendance.map(a => (
                <View key={a.student_id} style={[db.listRow, { backgroundColor: C.card, shadowColor: C.shadow }]}>
                  <View style={[db.avatar, { backgroundColor: a.status === "present" ? "#D1FAE5" : "#FEE2E2" }]}>
                    <Feather name={a.status === "present" ? "check" : "x"} size={14} color={a.status === "present" ? "#059669" : "#EF4444"} />
                  </View>
                  <Text style={[db.listName, { color: C.text }]}>{a.student_name}</Text>
                  {a.has_makeup && (
                    <View style={[db.mkBadge, { backgroundColor: "#EDE9FE" }]}>
                      <Text style={[db.mkText, { color: "#7C3AED" }]}>보강</Text>
                    </View>
                  )}
                  <View style={[db.statusPill, {
                    backgroundColor: a.status === "present" ? "#D1FAE5" : a.status === "absent" ? "#FEE2E2" : "#F3F4F6",
                  }]}>
                    <Text style={[db.statusText, {
                      color: a.status === "present" ? "#059669" : a.status === "absent" ? "#EF4444" : C.textSecondary,
                    }]}>
                      {a.status === "present" ? "출석" : a.status === "absent" ? "결석" : a.status}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* 일지 탭 */}
          {tab === "diary" && (
            <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
              {diary ? (
                <View style={[db.diaryCard, { backgroundColor: C.card, shadowColor: C.shadow, borderLeftColor: C.tint }]}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <Text style={[db.diaryTeacher, { color: C.tint }]}>{diary.teacher_name}</Text>
                    <Text style={[db.diaryTime, { color: C.textMuted }]}>
                      {new Date(diary.created_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                    </Text>
                  </View>
                  <Text style={[db.diaryContent, { color: C.text }]}>{diary.common_content || "(내용 없음)"}</Text>
                  {diary.is_edited && <Text style={[db.diaryTime, { color: C.textMuted, marginTop: 6 }]}>수정됨</Text>}
                </View>
              ) : (
                <View style={[db.diaryEmpty, { borderColor: C.border }]}>
                  <Feather name="edit-3" size={32} color={C.textMuted} />
                  <Text style={[db.empty, { color: C.textMuted }]}>아직 일지가 작성되지 않았습니다</Text>
                  <Text style={[db.emptySub, { color: C.textMuted }]}>{date} 기준</Text>
                </View>
              )}
            </View>
          )}

          {/* 결석 탭 */}
          {tab === "absent" && (
            <View style={{ paddingHorizontal: 20, paddingTop: 12, gap: 8 }}>
              {attendance.filter(a => a.status === "absent").length === 0 ? (
                <Text style={[db.empty, { color: C.textMuted }]}>결석자가 없습니다</Text>
              ) : attendance.filter(a => a.status === "absent").map(a => (
                <View key={a.student_id} style={[db.listRow, { backgroundColor: C.card, shadowColor: C.shadow }]}>
                  <View style={[db.avatar, { backgroundColor: "#FEE2E2" }]}>
                    <Feather name="x" size={14} color="#EF4444" />
                  </View>
                  <Text style={[db.listName, { color: C.text }]}>{a.student_name}</Text>
                  {a.has_makeup && (
                    <View style={[db.mkBadge, { backgroundColor: "#EDE9FE" }]}>
                      <Text style={[db.mkText, { color: "#7C3AED" }]}>보강</Text>
                    </View>
                  )}
                  <View style={[db.statusPill, { backgroundColor: "#FEE2E2" }]}>
                    <Text style={[db.statusText, { color: "#EF4444" }]}>결석</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ── 메인 화면 ───────────────────────────────────────────────────────────
export default function TeachersScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();

  // ── 스케줄 탭
  const [scheduleTab, setScheduleTab] = useState<ScheduleTab>("today");

  // ── 데이터
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [classGroups, setClassGroups] = useState<ClassGroup[]>([]);
  const [attendanceMap, setAttendanceMap] = useState<Record<string, AttendanceRecord[]>>({});
  const [diarySet, setDiarySet] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ── 탐색 상태: 시간 → 선생님 → 반 → 현황판
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedTeacherId, setSelectedTeacherId] = useState<string | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
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
      const [tRes, cgRes] = await Promise.all([
        apiRequest(token, "/teachers"),
        apiRequest(token, "/class-groups"),
      ]);
      if (tRes.ok) setTeachers(await tRes.json());
      if (cgRes.ok) setClassGroups(await cgRes.json());

      const today = todayDateStr();
      const [attRes, diaryRes] = await Promise.all([
        apiRequest(token, `/attendance?date=${today}`),
        apiRequest(token, `/diary?date=${today}`),
      ]);
      if (attRes.ok) {
        const attData: AttendanceRecord[] = await attRes.json();
        const map: Record<string, AttendanceRecord[]> = {};
        attData.forEach(a => { if (!map[a.class_group_id]) map[a.class_group_id] = []; map[a.class_group_id].push(a); });
        setAttendanceMap(map);
      }
      if (diaryRes.ok) {
        const dData: DiaryRecord[] = await diaryRes.json();
        setDiarySet(new Set(dData.map(d => d.class_group_id)));
      }
    } finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  async function fetchClassDetail(classId: string, date: string) {
    setDetailLoading(true);
    setDetailDate(date);
    try {
      const res = await apiRequest(token, `/admin/class-groups/${classId}/detail?date=${date}`);
      if (res.ok) setClassDetail(await res.json());
    } finally { setDetailLoading(false); }
  }

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── 탐색 리셋
  function resetNav() {
    setSelectedTime(null); setSelectedDay(null);
    setSelectedTeacherId(null); setSelectedClassId(null);
    setClassDetail(null);
  }

  function goBackToTimes() {
    setSelectedTime(null); setSelectedDay(null);
    setSelectedTeacherId(null); setSelectedClassId(null);
    setClassDetail(null);
  }

  function goBackToTeachers() {
    setSelectedTeacherId(null); setSelectedClassId(null);
    setClassDetail(null);
  }

  function goBackToClasses() {
    setSelectedClassId(null);
    setClassDetail(null);
  }

  // ── 스케줄 계산
  const todayGroups = classGroups.filter(isTodayClass);
  const todayTimeSlots = Array.from(new Set(todayGroups.map(g => parseStartTime(g.schedule_time)))).sort();

  const weeklySlots = (() => {
    const slots: Array<{ day: string; time: string; count: number }> = [];
    const seen = new Set<string>();
    for (const day of WEEK_DAYS) {
      const dayGroups = classGroups.filter(g => g.schedule_days.split(",").map(d => d.trim()).includes(day));
      const times = Array.from(new Set(dayGroups.map(g => parseStartTime(g.schedule_time)))).sort();
      for (const time of times) {
        const key = `${day}-${time}`;
        if (!seen.has(key)) { seen.add(key); slots.push({ day, time, count: dayGroups.filter(g => parseStartTime(g.schedule_time) === time).length }); }
      }
    }
    return slots;
  })();

  // ── 현재 선택 기준으로 필터된 반들
  const filteredGroups = classGroups.filter(g => {
    const matchTime = selectedTime ? parseStartTime(g.schedule_time) === selectedTime : true;
    const matchDay = selectedDay ? g.schedule_days.split(",").map(d => d.trim()).includes(selectedDay) : (scheduleTab === "today" ? isTodayClass(g) : true);
    const matchTeacher = selectedTeacherId ? g.teacher_user_id === selectedTeacherId : true;
    return matchTime && matchDay && matchTeacher;
  });

  // 특정 시간대 선생님 목록 (가나다순)
  function getTeachersForSlot(time: string, day?: string): Array<{ teacher: Teacher; count: number }> {
    const groups = classGroups.filter(g => {
      const matchTime = parseStartTime(g.schedule_time) === time;
      const matchDay = day ? g.schedule_days.split(",").map(d => d.trim()).includes(day)
                           : isTodayClass(g);
      return matchTime && matchDay;
    });
    const teacherIds = Array.from(new Set(groups.map(g => g.teacher_user_id).filter(Boolean))) as string[];
    return teacherIds
      .map(id => {
        const teacher = teachers.find(t => t.id === id);
        if (!teacher) return null;
        return { teacher, count: groups.filter(g => g.teacher_user_id === id).length };
      })
      .filter(Boolean)
      .sort((a, b) => a!.teacher.name.localeCompare(b!.teacher.name, "ko")) as Array<{ teacher: Teacher; count: number }>;
  }

  // 오늘 확인할 것 통계
  const todayUnchecked = todayGroups.filter(g => {
    const att = attendanceMap[g.id] || [];
    return att.length < g.student_count;
  }).length;
  const todayUnwritten = todayGroups.filter(g => !diarySet.has(g.id)).length;

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

  // ── 탭 전환 시 nav 리셋
  function switchTab(tab: ScheduleTab) {
    setScheduleTab(tab);
    resetNav();
  }

  // ── 반 선택
  function selectClass(g: ClassGroup) {
    setSelectedClassId(g.id);
    fetchClassDetail(g.id, scheduleTab === "today" ? todayDateStr() : todayDateStr());
  }

  // ── 렌더
  const navLevel = selectedClassId ? 3 : selectedTeacherId ? 2 : selectedTime ? 1 : 0;

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      {/* 헤더 */}
      <View style={[s.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        {navLevel > 0 ? (
          <Pressable onPress={() => {
            if (navLevel === 3) goBackToClasses();
            else if (navLevel === 2) goBackToTeachers();
            else goBackToTimes();
          }} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Feather name="arrow-left" size={20} color={C.tint} />
            <Text style={[s.headerTitle, { color: C.tint, fontSize: 15 }]}>
              {navLevel === 1 ? "시간대 선택" : navLevel === 2 ? "선생님 선택" : "반 선택"}
            </Text>
          </Pressable>
        ) : (
          <Text style={[s.headerTitle, { color: C.text }]}>선생님 관리</Text>
        )}
        <Pressable style={[s.accountsBtn, { backgroundColor: C.tintLight }]} onPress={() => setShowAccounts(true)}>
          <Feather name="users" size={15} color={C.tint} />
          <Text style={[s.accountsBtnText, { color: C.tint }]}>계정</Text>
        </Pressable>
      </View>

      {/* 브레드크럼 */}
      {navLevel > 0 && (
        <View style={[s.breadcrumb, { backgroundColor: C.card, borderBottomColor: C.border }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 20 }}>
            <Pressable onPress={goBackToTimes}>
              <Text style={[s.crumb, { color: C.tint }]}>시간표</Text>
            </Pressable>
            {selectedTime && (
              <>
                <Feather name="chevron-right" size={12} color={C.textMuted} />
                <Pressable onPress={navLevel > 1 ? goBackToTeachers : undefined}>
                  <Text style={[s.crumb, { color: navLevel > 1 ? C.tint : C.text, fontWeight: navLevel === 1 ? "700" : "500" }]}>
                    {selectedDay ? `${selectedDay} ` : ""}{selectedTime}
                  </Text>
                </Pressable>
              </>
            )}
            {selectedTeacherId && (
              <>
                <Feather name="chevron-right" size={12} color={C.textMuted} />
                <Pressable onPress={navLevel > 2 ? goBackToClasses : undefined}>
                  <Text style={[s.crumb, { color: navLevel > 2 ? C.tint : C.text, fontWeight: navLevel === 2 ? "700" : "500" }]}>
                    {teachers.find(t => t.id === selectedTeacherId)?.name ?? "선생님"}
                  </Text>
                </Pressable>
              </>
            )}
            {selectedClassId && classDetail && (
              <>
                <Feather name="chevron-right" size={12} color={C.textMuted} />
                <Text style={[s.crumb, { color: C.text, fontWeight: "700" }]}>{classDetail.class_group.name}</Text>
              </>
            )}
          </ScrollView>
        </View>
      )}

      {/* 스케줄 탭 (레벨 0~2에서만 표시) */}
      {navLevel < 3 && (
        <View style={[s.tabBar, { borderBottomColor: C.border }]}>
          {(["today", "weekly"] as ScheduleTab[]).map(tab => (
            <Pressable key={tab} style={[s.tabItem, scheduleTab === tab && { borderBottomColor: C.tint, borderBottomWidth: 2.5 }]} onPress={() => switchTab(tab)}>
              <Text style={[s.tabLabel, { color: scheduleTab === tab ? C.tint : C.textSecondary }]}>
                {tab === "today" ? "오늘" : "주간"}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      ) : (
        <>
          {/* ── 반 현황판 (Level 3) ────────────────────────── */}
          {navLevel === 3 && (
            <ClassDashboard
              detail={classDetail}
              loading={detailLoading}
              date={detailDate}
              onClose={goBackToClasses}
            />
          )}

          {/* ── 시간표 / 선생님 / 반 목록 (Level 0~2) ───────── */}
          {navLevel < 3 && (
            <ScrollView
              contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAll(); }} />}
              showsVerticalScrollIndicator={false}
            >
              {/* 오늘 확인할 것 (Level 0만) */}
              {navLevel === 0 && (
                <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 }}>
                  <Text style={[s.sectionTitle, { color: C.text }]}>오늘 확인할 것</Text>
                  <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
                    <View style={[s.statCard, { backgroundColor: C.card, shadowColor: C.shadow }]}>
                      <Feather name="calendar" size={18} color={C.tint} />
                      <Text style={[s.statNum, { color: C.text }]}>{todayGroups.length}</Text>
                      <Text style={[s.statLbl, { color: C.textMuted }]}>오늘 수업</Text>
                    </View>
                    <View style={[s.statCard, { backgroundColor: C.card, shadowColor: C.shadow }]}>
                      <Feather name="alert-circle" size={18} color={todayUnchecked > 0 ? "#F59E0B" : "#10B981"} />
                      <Text style={[s.statNum, { color: todayUnchecked > 0 ? "#F59E0B" : "#10B981" }]}>{todayUnchecked}</Text>
                      <Text style={[s.statLbl, { color: C.textMuted }]}>출결 미확인</Text>
                    </View>
                    <View style={[s.statCard, { backgroundColor: C.card, shadowColor: C.shadow }]}>
                      <Feather name="edit-3" size={18} color={todayUnwritten > 0 ? "#F59E0B" : "#10B981"} />
                      <Text style={[s.statNum, { color: todayUnwritten > 0 ? "#F59E0B" : "#10B981" }]}>{todayUnwritten}</Text>
                      <Text style={[s.statLbl, { color: C.textMuted }]}>일지 미작성</Text>
                    </View>
                  </View>
                </View>
              )}

              {/* ── Level 0: 시간대 목록 ─────────────────────── */}
              {navLevel === 0 && (
                <View style={{ paddingHorizontal: 20, paddingTop: 8, gap: 8 }}>
                  <Text style={[s.sectionTitle, { color: C.text }]}>
                    {scheduleTab === "today" ? `오늘(${todayKo()}요일) 수업 일정` : "주간 수업 일정"}
                  </Text>

                  {scheduleTab === "today" && (
                    todayTimeSlots.length === 0 ? (
                      <View style={s.emptyBox}>
                        <Feather name="calendar" size={36} color={C.textMuted} />
                        <Text style={[s.emptyText, { color: C.textMuted }]}>오늘 수업이 없습니다</Text>
                      </View>
                    ) : todayTimeSlots.map(time => {
                      const count = todayGroups.filter(g => parseStartTime(g.schedule_time) === time).length;
                      const teacherCount = getTeachersForSlot(time).length;
                      const attDone = todayGroups.filter(g => parseStartTime(g.schedule_time) === time && (attendanceMap[g.id]?.length ?? 0) >= g.student_count).length;
                      const diaryDone = todayGroups.filter(g => parseStartTime(g.schedule_time) === time && diarySet.has(g.id)).length;
                      return (
                        <Pressable key={time} style={[s.timeCard, { backgroundColor: C.card, shadowColor: C.shadow }]} onPress={() => { setSelectedTime(time); setSelectedDay(null); }}>
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
                    })
                  )}

                  {scheduleTab === "weekly" && (() => {
                    const byDay: Record<string, typeof weeklySlots> = {};
                    weeklySlots.forEach(sl => { if (!byDay[sl.day]) byDay[sl.day] = []; byDay[sl.day].push(sl); });
                    return WEEK_DAYS.filter(d => byDay[d]).map(day => (
                      <View key={day} style={{ marginBottom: 4 }}>
                        <Text style={[s.dayHeader, { color: C.textSecondary, borderBottomColor: C.border }]}>{day}요일</Text>
                        {byDay[day].map(sl => {
                          const count = classGroups.filter(g =>
                            g.schedule_days.split(",").map(d => d.trim()).includes(day) && parseStartTime(g.schedule_time) === sl.time
                          ).length;
                          return (
                            <Pressable key={`${day}-${sl.time}`} style={[s.timeCard, { backgroundColor: C.card, shadowColor: C.shadow }]}
                              onPress={() => { setSelectedTime(sl.time); setSelectedDay(day); }}>
                              <View style={[s.timeBox, { backgroundColor: C.tintLight }]}>
                                <Feather name="clock" size={14} color={C.tint} />
                                <Text style={[s.timeText, { color: C.tint }]}>{sl.time}</Text>
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text style={[s.timeCardMain, { color: C.text }]}>{count}개 반</Text>
                              </View>
                              <Feather name="chevron-right" size={18} color={C.textMuted} />
                            </Pressable>
                          );
                        })}
                      </View>
                    ));
                  })()}
                </View>
              )}

              {/* ── Level 1: 선생님 목록 ─────────────────────── */}
              {navLevel === 1 && selectedTime && (
                <View style={{ paddingHorizontal: 20, paddingTop: 16, gap: 8 }}>
                  <Text style={[s.sectionTitle, { color: C.text }]}>
                    {selectedDay ? `${selectedDay}요일 ` : ""}{selectedTime} · 선생님 선택
                  </Text>
                  {getTeachersForSlot(selectedTime, selectedDay ?? undefined).length === 0 ? (
                    <View style={s.emptyBox}>
                      <Text style={[s.emptyText, { color: C.textMuted }]}>해당 시간 수업 없음</Text>
                    </View>
                  ) : getTeachersForSlot(selectedTime, selectedDay ?? undefined).map(({ teacher, count }) => (
                    <Pressable key={teacher.id} style={[s.teacherCard, { backgroundColor: C.card, shadowColor: C.shadow }]}
                      onPress={() => setSelectedTeacherId(teacher.id)}>
                      <View style={[s.avatar, { backgroundColor: C.tintLight }]}>
                        <Feather name="user" size={20} color={C.tint} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.teacherName, { color: C.text }]}>{teacher.name}</Text>
                        {teacher.position && <Text style={[s.teacherSub, { color: C.tint }]}>{teacher.position}</Text>}
                        <Text style={[s.teacherSub, { color: C.textMuted }]}>{count}개 반 운영 중</Text>
                      </View>
                      <Feather name="chevron-right" size={18} color={C.textMuted} />
                    </Pressable>
                  ))}
                </View>
              )}

              {/* ── Level 2: 반 목록 ─────────────────────────── */}
              {navLevel === 2 && selectedTeacherId && (
                <View style={{ paddingHorizontal: 20, paddingTop: 16, gap: 8 }}>
                  <Text style={[s.sectionTitle, { color: C.text }]}>
                    {teachers.find(t => t.id === selectedTeacherId)?.name} · 반 선택
                  </Text>
                  {filteredGroups.length === 0 ? (
                    <View style={s.emptyBox}>
                      <Text style={[s.emptyText, { color: C.textMuted }]}>해당 시간 반 없음</Text>
                    </View>
                  ) : filteredGroups.map(g => {
                    const att = attendanceMap[g.id] || [];
                    const present = att.filter(a => a.status === "present").length;
                    const absent = att.filter(a => a.status === "absent").length;
                    const hasDiary = diarySet.has(g.id);
                    return (
                      <Pressable key={g.id} style={[s.classCard, { backgroundColor: C.card, shadowColor: C.shadow }]} onPress={() => selectClass(g)}>
                        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8, gap: 8 }}>
                          <View style={[s.timeBox, { backgroundColor: C.tintLight }]}>
                            <Feather name="clock" size={12} color={C.tint} />
                            <Text style={[s.timeText, { color: C.tint, fontSize: 11 }]}>{g.schedule_time}</Text>
                          </View>
                          <Text style={[s.className, { color: C.text, flex: 1 }]} numberOfLines={1}>{g.name}</Text>
                          <Feather name="chevron-right" size={16} color={C.textMuted} />
                        </View>
                        <View style={{ flexDirection: "row", gap: 12 }}>
                          <Text style={[s.classStat, { color: C.textSecondary }]}>학생 {g.student_count}명</Text>
                          <Text style={[s.classStat, { color: "#059669" }]}>출석 {present}</Text>
                          <Text style={[s.classStat, { color: "#EF4444" }]}>결석 {absent}</Text>
                          <View style={[s.diaryBadge, { backgroundColor: hasDiary ? "#D1FAE5" : "#FEF3C7" }]}>
                            <Text style={[s.diaryBadgeText, { color: hasDiary ? "#059669" : "#D97706" }]}>
                              {hasDiary ? "일지 완료" : "일지 미작성"}
                            </Text>
                          </View>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </ScrollView>
          )}
        </>
      )}

      {/* ── 계정 목록 모달 ────────────────────────────────── */}
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
                <View style={s.emptyBox}>
                  <Feather name="users" size={36} color={C.textMuted} />
                  <Text style={[s.emptyText, { color: C.textMuted }]}>등록된 선생님이 없습니다</Text>
                </View>
              ) : teachers.map(t => (
                <View key={t.id} style={[s.teacherCard, { backgroundColor: C.background, shadowColor: C.shadow }]}>
                  <Pressable style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }} onPress={() => openTeacherEdit(t)}>
                    <View style={[s.avatar, { backgroundColor: C.tintLight }]}>
                      <Feather name="user" size={18} color={C.tint} />
                    </View>
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
                      <Text style={[s.statusText, { color: t.is_activated ? "#059669" : "#D97706" }]}>
                        {t.is_activated ? "활성" : "인증 대기"}
                      </Text>
                    </View>
                    <Feather name="edit-2" size={14} color={C.textMuted} />
                  </Pressable>
                  {!t.is_activated && (
                    <Pressable
                      style={[s.codeBtn, { borderTopColor: C.border, borderColor: C.border }]}
                      onPress={() => handleViewCode(t.id)}
                      disabled={loadingCode === t.id}
                    >
                      {loadingCode === t.id ? (
                        <ActivityIndicator size={14} color={C.tint} />
                      ) : codeVisible[t.id] ? (
                        <Text style={[s.codeBtnText, { color: C.tint }]}>인증코드: {codeVisible[t.id]}</Text>
                      ) : (
                        <>
                          <Feather name="eye" size={13} color={C.tint} />
                          <Text style={[s.codeBtnText, { color: C.tint }]}>인증코드 보기</Text>
                        </>
                      )}
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
                <Pressable onPress={() => { setShowAdd(false); resetForm(); }}>
                  <Feather name="x" size={22} color={C.textSecondary} />
                </Pressable>
              </View>
              {addError ? <View style={[s.errBox, { backgroundColor: "#FEE2E2" }]}><Text style={[s.errText, { color: "#EF4444" }]}>{addError}</Text></View> : null}
              <View style={s.field}><Text style={[s.label, { color: C.textSecondary }]}>이름 *</Text>
                <TextInput style={[s.input, { borderColor: C.border, backgroundColor: C.bg, color: C.text }]} value={form.name} onChangeText={v => setForm(f => ({ ...f, name: v }))} placeholder="선생님 이름" placeholderTextColor={C.textMuted} /></View>
              <View style={s.field}><Text style={[s.label, { color: C.textSecondary }]}>이메일 *</Text>
                <TextInput style={[s.input, { borderColor: C.border, backgroundColor: C.bg, color: C.text }]} value={form.email} onChangeText={v => setForm(f => ({ ...f, email: v }))} placeholder="이메일 주소" placeholderTextColor={C.textMuted} keyboardType="email-address" autoCapitalize="none" /></View>
              <View style={s.field}><Text style={[s.label, { color: C.textSecondary }]}>연락처 *</Text>
                <TextInput style={[s.input, { borderColor: C.border, backgroundColor: C.bg, color: C.text }]} value={form.phone} onChangeText={v => setForm(f => ({ ...f, phone: v }))} placeholder="010-0000-0000" placeholderTextColor={C.textMuted} keyboardType="phone-pad" /></View>
              <View style={s.field}><Text style={[s.label, { color: C.textSecondary }]}>비밀번호 *</Text>
                <TextInput style={[s.input, { borderColor: C.border, backgroundColor: C.bg, color: C.text }]} value={form.password} onChangeText={v => setForm(f => ({ ...f, password: v }))} placeholder="6자 이상" placeholderTextColor={C.textMuted} secureTextEntry /></View>
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
            <View style={[s.successIcon, { backgroundColor: "#D1FAE5" }]}>
              <Feather name="check-circle" size={36} color="#059669" />
            </View>
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
              <TextInput style={[s.input, { borderColor: C.border, backgroundColor: C.bg, color: C.text }]} value={editName} onChangeText={setEditName} placeholderTextColor={C.textMuted} /></View>
            <View style={s.field}><Text style={[s.label, { color: C.textSecondary }]}>연락처</Text>
              <TextInput style={[s.input, { borderColor: C.border, backgroundColor: C.bg, color: C.text }]} value={editPhone} onChangeText={setEditPhone} keyboardType="phone-pad" placeholderTextColor={C.textMuted} /></View>
            <View style={s.field}><Text style={[s.label, { color: C.textSecondary }]}>직급</Text>
              <TextInput style={[s.input, { borderColor: C.border, backgroundColor: C.bg, color: C.text }]} value={editPosition} onChangeText={setEditPosition} placeholder="예: 수석코치" placeholderTextColor={C.textMuted} /></View>
            <View style={[s.field, { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 }]}>
              <Text style={[s.label, { color: C.textMuted }]}>이메일: {selectedTeacherDetail?.email}</Text>
            </View>
            <View style={s.modalActions}>
              <Pressable style={[s.cancelBtn, { borderColor: "#EF4444" }]}
                onPress={() => { const t = selectedTeacherDetail; setSelectedTeacherDetail(null); setDeleteTarget(t); }}>
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

// ── 반 현황판 스타일 ────────────────────────────────────────────────────
const db = StyleSheet.create({
  backRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1 },
  backText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  summaryCard: { margin: 20, borderRadius: 16, padding: 16, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  className: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 4 },
  subInfo: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  statRow: { flexDirection: "row", borderTopWidth: 1, marginTop: 12, paddingTop: 12 },
  statItem: { flex: 1, alignItems: "center", gap: 3 },
  statVal: { fontSize: 20, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  statDivider: { width: 1, marginVertical: 4 },
  tabBar: { flexDirection: "row", borderBottomWidth: 1 },
  tabItem: { flex: 1, alignItems: "center", paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  listRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  listName: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  mkBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  mkText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  diaryCard: { borderRadius: 12, padding: 16, borderLeftWidth: 4, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  diaryTeacher: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  diaryTime: { fontSize: 11, fontFamily: "Inter_400Regular" },
  diaryContent: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },
  diaryEmpty: { borderWidth: 1.5, borderStyle: "dashed", borderRadius: 16, padding: 40, alignItems: "center", gap: 10 },
  empty: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 40 },
  emptySub: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" },
});

// ── 화면 스타일 ─────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 12 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
  accountsBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
  accountsBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  breadcrumb: { paddingVertical: 8, borderBottomWidth: 1 },
  crumb: { fontSize: 13, fontFamily: "Inter_500Medium" },
  tabBar: { flexDirection: "row", borderBottomWidth: 1 },
  tabItem: { flex: 1, alignItems: "center", paddingVertical: 12, borderBottomWidth: 2.5, borderBottomColor: "transparent" },
  tabLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_700Bold", marginBottom: 4 },
  dayHeader: { fontSize: 13, fontFamily: "Inter_600SemiBold", paddingVertical: 8, borderBottomWidth: 1, marginBottom: 6 },
  statCard: { flex: 1, borderRadius: 14, padding: 14, alignItems: "center", gap: 6, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  statNum: { fontSize: 22, fontFamily: "Inter_700Bold" },
  statLbl: { fontSize: 11, fontFamily: "Inter_400Regular" },
  timeCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, padding: 14, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1 },
  timeBox: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  timeText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  timeCardMain: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  timeCardSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  teacherCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, padding: 14, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  teacherName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  teacherSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  classCard: { borderRadius: 14, padding: 14, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1 },
  className: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  classStat: { fontSize: 12, fontFamily: "Inter_400Regular" },
  diaryBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  diaryBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  emptyBox: { alignItems: "center", paddingVertical: 48, gap: 10 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  selfBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  selfBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  codeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderTopWidth: 1, borderWidth: 0 },
  codeBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  codeBox: { padding: 16, alignItems: "center" },
  codeText: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: 6 },
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
