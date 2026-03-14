import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal,
  Platform, Pressable, RefreshControl, ScrollView,
  StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;

// ── 타입 ──────────────────────────────────────────────────────
interface Teacher {
  id: string; name: string; email: string; phone: string;
  is_activated: boolean; is_admin_self_teacher: boolean; created_at: string;
}

interface ClassGroup {
  id: string; name: string;
  schedule_days: string; schedule_time: string;
  student_count: number; teacher_user_id?: string | null;
  level?: string | null; capacity?: number | null;
  description?: string | null;
}

interface AttendanceRecord {
  student_id: string; status: string; class_group_id: string; date: string;
}

interface DiaryRecord {
  id: string; class_group_id: string; created_at: string;
}

type MainTab = "accounts" | "schedule";
type ScheduleView = "today" | "weekly";

// ── 요일 유틸 ─────────────────────────────────────────────────
const DAY_KO = ["일", "월", "화", "수", "목", "금", "토"];
const WEEK_DAYS = ["월", "화", "수", "목", "금", "토", "일"];

function todayKo() {
  return DAY_KO[new Date().getDay()];
}

function parseStartTime(scheduleTime: string): string {
  return scheduleTime.split(/[-~]/)[0].trim();
}

function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isTodayClass(group: ClassGroup): boolean {
  const days = group.schedule_days.split(",").map(d => d.trim());
  return days.includes(todayKo());
}

function getWeekDayClasses(group: ClassGroup, weekOffset: number = 0): string[] {
  const days = group.schedule_days.split(",").map(d => d.trim());
  return WEEK_DAYS.filter(d => days.includes(d));
}

function sortByTime(a: ClassGroup, b: ClassGroup): number {
  return parseStartTime(a.schedule_time).localeCompare(parseStartTime(b.schedule_time));
}

// ── 수업 카드 ─────────────────────────────────────────────────
function ClassCard({
  group, attendance, hasdiary, onPressAttendance, onPressDiary,
}: {
  group: ClassGroup;
  attendance: AttendanceRecord[];
  hasdiary: boolean;
  onPressAttendance: () => void;
  onPressDiary: () => void;
}) {
  const presentCount = attendance.filter(a => a.status === "present").length;
  const absentCount = attendance.filter(a => a.status === "absent").length;
  const checkedCount = attendance.length;
  const totalCount = group.student_count;

  const days = group.schedule_days.split(",").map(d => d.trim()).join("·");

  return (
    <View style={[card.root, { backgroundColor: C.card }]}>
      {/* 상단: 시간 + 반 이름 + 뱃지 */}
      <View style={card.topRow}>
        <View style={[card.timeBox, { backgroundColor: C.tintLight }]}>
          <Feather name="clock" size={12} color={C.tint} />
          <Text style={[card.timeText, { color: C.tint }]} numberOfLines={1}>{group.schedule_time}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={[card.className, { color: C.text }]} numberOfLines={1}>{group.name}</Text>
          <Text style={[card.dayText, { color: C.textMuted }]}>{days}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 6 }}>
          {group.level && (
            <View style={[card.badge, { backgroundColor: "#EDE9FE" }]}>
              <Text style={[card.badgeText, { color: "#7C3AED" }]}>{group.level}</Text>
            </View>
          )}
        </View>
      </View>

      {/* 중간: 학생 수 + 출결 + 일지 상태 */}
      <View style={[card.statsRow, { borderTopColor: C.border, borderBottomColor: C.border }]}>
        <View style={card.statItem}>
          <Feather name="users" size={14} color={C.textSecondary} />
          <Text style={[card.statLabel, { color: C.textSecondary }]}>학생</Text>
          <Text style={[card.statValue, { color: C.text }]}>{totalCount}명</Text>
        </View>
        <View style={[card.statDivider, { backgroundColor: C.border }]} />
        <View style={card.statItem}>
          <Feather name="check-circle" size={14} color={checkedCount === totalCount && totalCount > 0 ? C.success : C.warning} />
          <Text style={[card.statLabel, { color: C.textSecondary }]}>출결</Text>
          <Text style={[card.statValue, { color: checkedCount === totalCount && totalCount > 0 ? C.success : C.warning }]}>
            {checkedCount}/{totalCount}
          </Text>
        </View>
        <View style={[card.statDivider, { backgroundColor: C.border }]} />
        <View style={card.statItem}>
          <Feather name="book" size={14} color={hasdiary ? C.success : C.textMuted} />
          <Text style={[card.statLabel, { color: C.textSecondary }]}>일지</Text>
          <Text style={[card.statValue, { color: hasdiary ? C.success : C.textMuted }]}>
            {hasdiary ? "작성됨" : "미작성"}
          </Text>
        </View>
        <View style={[card.statDivider, { backgroundColor: C.border }]} />
        <View style={card.statItem}>
          <Feather name="user-x" size={14} color={absentCount > 0 ? C.error : C.textMuted} />
          <Text style={[card.statLabel, { color: C.textSecondary }]}>결석</Text>
          <Text style={[card.statValue, { color: absentCount > 0 ? C.error : C.textMuted }]}>
            {absentCount}명
          </Text>
        </View>
      </View>

      {/* 하단: 버튼 */}
      <View style={card.actions}>
        <Pressable
          style={({ pressed }) => [card.actionBtn, { backgroundColor: C.tintLight, opacity: pressed ? 0.8 : 1 }]}
          onPress={onPressAttendance}
        >
          <Feather name="check-square" size={14} color={C.tint} />
          <Text style={[card.actionBtnText, { color: C.tint }]}>출결 관리</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [card.actionBtn, { backgroundColor: hasdiary ? "#D1FAE5" : "#FEF3C7", opacity: pressed ? 0.8 : 1 }]}
          onPress={onPressDiary}
        >
          <Feather name="edit-3" size={14} color={hasdiary ? C.success : C.warning} />
          <Text style={[card.actionBtnText, { color: hasdiary ? C.success : C.warning }]}>
            {hasdiary ? "일지 보기" : "일지 작성"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────
export default function TeachersScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();

  // 탭
  const [mainTab, setMainTab] = useState<MainTab>("accounts");
  const [scheduleView, setScheduleView] = useState<ScheduleView>("today");

  // 계정 관리
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState("");
  const [newTeacher, setNewTeacher] = useState<{ teacher: Teacher; code: string } | null>(null);
  const [codeVisible, setCodeVisible] = useState<Record<string, string>>({});
  const [loadingCode, setLoadingCode] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", is_admin_self_teacher: false });

  // 스케줄
  const [classGroups, setClassGroups] = useState<ClassGroup[]>([]);
  const [attendanceMap, setAttendanceMap] = useState<Record<string, AttendanceRecord[]>>({});
  const [diarySet, setDiarySet] = useState<Set<string>>(new Set());
  const [scheduleLoading, setScheduleLoading] = useState(false);

  const hasAdminSelf = teachers.some(t => t.is_admin_self_teacher);

  // ── 데이터 로드 ────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    try {
      const tRes = await apiRequest(token, "/teachers");
      if (tRes.ok) setTeachers(await tRes.json());
    } finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  const fetchSchedule = useCallback(async () => {
    setScheduleLoading(true);
    try {
      // 반 목록 로드
      const cgRes = await apiRequest(token, "/class-groups");
      if (!cgRes.ok) return;
      const groups: ClassGroup[] = await cgRes.json();
      setClassGroups(groups);

      // 오늘 날짜 출결 + 일지 조회
      const today = todayDateStr();
      const attRes = await apiRequest(token, `/attendance?date=${today}`);
      const diaryRes = await apiRequest(token, `/diary?date=${today}`);

      if (attRes.ok) {
        const attData: AttendanceRecord[] = await attRes.json();
        const map: Record<string, AttendanceRecord[]> = {};
        attData.forEach(a => {
          if (!map[a.class_group_id]) map[a.class_group_id] = [];
          map[a.class_group_id].push(a);
        });
        setAttendanceMap(map);
      }

      if (diaryRes.ok) {
        const diaryData: DiaryRecord[] = await diaryRes.json();
        const set = new Set(diaryData.map((d: DiaryRecord) => d.class_group_id));
        setDiarySet(set);
      }
    } catch (e) { console.error(e); }
    finally { setScheduleLoading(false); }
  }, [token]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (mainTab === "schedule") fetchSchedule();
  }, [mainTab, fetchSchedule]);

  // ── 계정 관리 핸들러 ──────────────────────────────────────
  function resetForm() { setForm({ name: "", email: "", phone: "", password: "", is_admin_self_teacher: false }); setAddError(""); }

  async function handleCreate() {
    if (!form.name.trim() || !form.email.trim() || !form.password || !form.phone.trim()) { setAddError("모든 필수 항목을 입력해주세요."); return; }
    if (form.password.length < 6) { setAddError("비밀번호는 6자 이상이어야 합니다."); return; }
    if (form.is_admin_self_teacher && hasAdminSelf) { setAddError("관리자 본인용 선생님 계정은 이미 등록되어 있습니다."); return; }
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
      else Alert.alert("오류", data.error || "코드 조회 실패");
    } finally { setLoadingCode(null); }
  }

  async function handleDeleteTeacher(id: string, name: string) {
    Alert.alert("선생님 삭제", `${name} 계정을 삭제하시겠습니까?`, [
      { text: "취소", style: "cancel" },
      { text: "삭제", style: "destructive", onPress: async () => {
        const res = await apiRequest(token, `/teachers/${id}`, { method: "DELETE" });
        if (res.ok) fetchAll();
        else Alert.alert("오류", "삭제에 실패했습니다.");
      }},
    ]);
  }

  // ── 스케줄 계산 ────────────────────────────────────────────
  const todayGroups = classGroups.filter(isTodayClass).sort(sortByTime);

  const weeklyGroups = WEEK_DAYS.map(day => ({
    day,
    groups: classGroups
      .filter(g => g.schedule_days.split(",").map(d => d.trim()).includes(day))
      .sort(sortByTime),
  })).filter(({ groups }) => groups.length > 0);

  const todayUnwritten = todayGroups.filter(g => !diarySet.has(g.id)).length;
  const todayUnchecked = todayGroups.filter(g => {
    const att = attendanceMap[g.id] || [];
    return att.length < g.student_count;
  }).length;

  // ── 렌더 ──────────────────────────────────────────────────
  return (
    <View style={[styles.root, { backgroundColor: C.background }]}>
      {/* 헤더 */}
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <View>
          <Text style={[styles.headerTitle, { color: C.text }]}>선생님 관리</Text>
        </View>
        {mainTab === "accounts" && (
          <Pressable
            style={[styles.addBtn, { backgroundColor: C.tint }]}
            onPress={() => { resetForm(); setShowAdd(true); }}
          >
            <Feather name="plus" size={18} color="#fff" />
            <Text style={styles.addBtnText}>계정 추가</Text>
          </Pressable>
        )}
      </View>

      {/* 메인 탭 */}
      <View style={[styles.tabBar, { borderBottomColor: C.border }]}>
        {([
          { key: "accounts" as MainTab, label: "계정 목록", icon: "users" as const },
          { key: "schedule" as MainTab, label: "스케줄", icon: "calendar" as const },
        ]).map(({ key, label, icon }) => (
          <Pressable
            key={key}
            style={[styles.tabItem, mainTab === key && { borderBottomColor: C.tint }]}
            onPress={() => setMainTab(key)}
          >
            <Feather name={icon} size={15} color={mainTab === key ? C.tint : C.textMuted} />
            <Text style={[styles.tabLabel, { color: mainTab === key ? C.tint : C.textSecondary }]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {/* ── 계정 목록 탭 ────────────────────────────────────── */}
      {mainTab === "accounts" && (
        loading ? (
          <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} />
        ) : (
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 120, gap: 10, paddingTop: 12 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAll(); }} />}
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.infoBox, { backgroundColor: C.tintLight }]}>
              <Feather name="info" size={14} color={C.tint} />
              <Text style={[styles.infoText, { color: C.tint }]}>
                계정 생성 후 인증코드를 선생님에게 전달하세요.{"\n"}선생님이 앱 로그인 후 코드를 입력하면 활성화됩니다.
              </Text>
            </View>
            {teachers.length === 0 ? (
              <View style={styles.empty}>
                <Feather name="users" size={40} color={C.textMuted} />
                <Text style={[styles.emptyText, { color: C.textMuted }]}>등록된 선생님이 없습니다</Text>
                <Text style={[styles.emptySub, { color: C.textMuted }]}>승인 메뉴에서 선생님을 승인한 후 여기에 표시됩니다</Text>
              </View>
            ) : teachers.map(t => (
              <View key={t.id} style={[styles.card, { backgroundColor: C.card, shadowColor: C.shadow }]}>
                <View style={styles.cardTop}>
                  <View style={[styles.avatar, { backgroundColor: t.is_admin_self_teacher ? "#7C3AED15" : C.tintLight }]}>
                    <Feather name="user" size={20} color={t.is_admin_self_teacher ? "#7C3AED" : C.tint} />
                  </View>
                  <View style={styles.cardInfo}>
                    <View style={styles.nameRow}>
                      <Text style={[styles.teacherName, { color: C.text }]}>{t.name}</Text>
                      {t.is_admin_self_teacher && (
                        <View style={[styles.selfBadge, { backgroundColor: "#7C3AED15" }]}>
                          <Text style={[styles.selfBadgeText, { color: "#7C3AED" }]}>내 계정</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.teacherEmail, { color: C.textSecondary }]}>{t.email}</Text>
                    {t.phone && <Text style={[styles.teacherPhone, { color: C.textMuted }]}>{t.phone}</Text>}
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: t.is_activated ? "#D1FAE5" : "#FEF3C7" }]}>
                    <Text style={[styles.statusText, { color: t.is_activated ? "#059669" : "#D97706" }]}>
                      {t.is_activated ? "활성" : "인증 대기"}
                    </Text>
                  </View>
                </View>
                {!t.is_activated && (
                  <View style={[styles.codeSection, { borderTopColor: C.border }]}>
                    {codeVisible[t.id] ? (
                      <View style={[styles.codeBox, { backgroundColor: "#FEF3C7", borderRadius: 10, padding: 12 }]}>
                        <Text style={[styles.codeLabel, { color: "#92400E" }]}>인증코드 (선생님에게 전달해주세요)</Text>
                        <Text style={[styles.codeValue, { color: "#92400E" }]}>{codeVisible[t.id]}</Text>
                      </View>
                    ) : (
                      <Pressable style={[styles.viewCodeBtn, { borderColor: C.warning }]} onPress={() => handleViewCode(t.id)} disabled={loadingCode === t.id}>
                        {loadingCode === t.id ? <ActivityIndicator color={C.warning} size="small" /> : (
                          <><Feather name="key" size={14} color={C.warning} />
                          <Text style={[styles.viewCodeText, { color: C.warning }]}>인증코드 보기</Text></>
                        )}
                      </Pressable>
                    )}
                  </View>
                )}
                <View style={[styles.cardActions, { borderTopColor: C.border }]}>
                  <Pressable style={styles.actionBtn} onPress={() => handleDeleteTeacher(t.id, t.name)}>
                    <Feather name="trash-2" size={14} color={C.error} />
                    <Text style={[styles.actionText, { color: C.error }]}>삭제</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </ScrollView>
        )
      )}

      {/* ── 스케줄 탭 ───────────────────────────────────────── */}
      {mainTab === "schedule" && (
        scheduleLoading ? (
          <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
        ) : (
          <ScrollView
            contentContainerStyle={{ paddingBottom: insets.bottom + 100, paddingTop: 12 }}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={scheduleLoading} onRefresh={fetchSchedule} />}
          >
            {/* 오늘/주간 전환 */}
            <View style={[styles.viewToggle, { marginHorizontal: 20, borderColor: C.border }]}>
              {(["today", "weekly"] as ScheduleView[]).map(v => (
                <Pressable
                  key={v}
                  style={[styles.viewToggleItem, scheduleView === v && { backgroundColor: C.tint }]}
                  onPress={() => setScheduleView(v)}
                >
                  <Text style={[styles.viewToggleText, { color: scheduleView === v ? "#fff" : C.textSecondary }]}>
                    {v === "today" ? "오늘" : "주간"}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* 오늘 확인할 것 요약 */}
            {scheduleView === "today" && (
              <View style={[styles.summaryBox, { backgroundColor: C.card, marginHorizontal: 20, marginTop: 14, borderColor: C.border }]}>
                <View style={styles.summaryHeader}>
                  <Feather name="alert-circle" size={15} color={C.tint} />
                  <Text style={[styles.summaryTitle, { color: C.text }]}>오늘 확인할 것</Text>
                  <Text style={[styles.summaryDate, { color: C.textMuted }]}>
                    {new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" })}
                  </Text>
                </View>
                <View style={styles.summaryItems}>
                  <View style={[styles.summaryItem, { backgroundColor: todayGroups.length > 0 ? C.tintLight : C.background }]}>
                    <Feather name="layers" size={16} color={C.tint} />
                    <View>
                      <Text style={[styles.summaryItemValue, { color: C.tint }]}>{todayGroups.length}개</Text>
                      <Text style={[styles.summaryItemLabel, { color: C.textMuted }]}>오늘 수업</Text>
                    </View>
                  </View>
                  <View style={[styles.summaryItem, { backgroundColor: todayUnchecked > 0 ? "#FEF3C7" : C.background }]}>
                    <Feather name="check-square" size={16} color={todayUnchecked > 0 ? C.warning : C.textMuted} />
                    <View>
                      <Text style={[styles.summaryItemValue, { color: todayUnchecked > 0 ? C.warning : C.textMuted }]}>{todayUnchecked}건</Text>
                      <Text style={[styles.summaryItemLabel, { color: C.textMuted }]}>출결 미확인</Text>
                    </View>
                  </View>
                  <View style={[styles.summaryItem, { backgroundColor: todayUnwritten > 0 ? "#FEE2E2" : C.background }]}>
                    <Feather name="book-open" size={16} color={todayUnwritten > 0 ? C.error : C.textMuted} />
                    <View>
                      <Text style={[styles.summaryItemValue, { color: todayUnwritten > 0 ? C.error : C.textMuted }]}>{todayUnwritten}건</Text>
                      <Text style={[styles.summaryItemLabel, { color: C.textMuted }]}>일지 미작성</Text>
                    </View>
                  </View>
                </View>
              </View>
            )}

            {/* 수업 목록 */}
            <View style={{ paddingHorizontal: 20, marginTop: 16, gap: 12 }}>
              {scheduleView === "today" ? (
                todayGroups.length === 0 ? (
                  <View style={styles.empty}>
                    <Feather name="calendar" size={48} color={C.textMuted} />
                    <Text style={[styles.emptyText, { color: C.textMuted }]}>오늘 수업이 없습니다</Text>
                    <Text style={[styles.emptySub, { color: C.textMuted }]}>오늘({todayKo()}) 배정된 수업이 없습니다</Text>
                  </View>
                ) : todayGroups.map(group => (
                  <ClassCard
                    key={group.id}
                    group={group}
                    attendance={attendanceMap[group.id] || []}
                    hasdiary={diarySet.has(group.id)}
                    onPressAttendance={() => router.push({ pathname: "/(admin)/attendance", params: { classGroupId: group.id } } as any)}
                    onPressDiary={() => router.push({ pathname: "/(admin)/diary-write", params: { classGroupId: group.id, className: group.name } } as any)}
                  />
                ))
              ) : (
                weeklyGroups.length === 0 ? (
                  <View style={styles.empty}>
                    <Feather name="calendar" size={48} color={C.textMuted} />
                    <Text style={[styles.emptyText, { color: C.textMuted }]}>배정된 수업이 없습니다</Text>
                  </View>
                ) : weeklyGroups.map(({ day, groups }) => (
                  <View key={day}>
                    <View style={styles.weekDayHeader}>
                      <Text style={[styles.weekDayLabel, { color: day === todayKo() ? C.tint : C.text }]}>
                        {day}요일
                      </Text>
                      {day === todayKo() && (
                        <View style={[styles.todayBadge, { backgroundColor: C.tint }]}>
                          <Text style={styles.todayBadgeText}>오늘</Text>
                        </View>
                      )}
                    </View>
                    <View style={{ gap: 10 }}>
                      {groups.map(group => (
                        <ClassCard
                          key={group.id}
                          group={group}
                          attendance={attendanceMap[group.id] || []}
                          hasdiary={diarySet.has(group.id)}
                          onPressAttendance={() => router.push({ pathname: "/(admin)/attendance", params: { classGroupId: group.id } } as any)}
                          onPressDiary={() => router.push({ pathname: "/(admin)/diary-write", params: { classGroupId: group.id, className: group.name } } as any)}
                        />
                      ))}
                    </View>
                  </View>
                ))
              )}
            </View>
          </ScrollView>
        )
      )}

      {/* ── 계정 추가 모달 ──────────────────────────────────── */}
      <Modal visible={showAdd} animationType="slide" transparent presentationStyle="overFullScreen">
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={[styles.sheet, { backgroundColor: C.card, paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.sheetHandle} />
            <Text style={[styles.sheetTitle, { color: C.text }]}>선생님 계정 추가</Text>
            {!!addError && <View style={[styles.errBox, { backgroundColor: "#FEE2E2" }]}>
              <Text style={[styles.errText, { color: C.error }]}>{addError}</Text>
            </View>}
            {["name", "email", "phone", "password"].map(key => (
              <View key={key} style={styles.field}>
                <Text style={[styles.label, { color: C.textSecondary }]}>
                  {key === "name" ? "이름 *" : key === "email" ? "이메일 *" : key === "phone" ? "전화번호 *" : "비밀번호 (6자 이상) *"}
                </Text>
                <TextInput
                  style={[styles.input, { borderColor: C.border, color: C.text }]}
                  value={(form as any)[key]}
                  onChangeText={v => setForm({ ...form, [key]: v })}
                  placeholder={key === "name" ? "김선생" : key === "email" ? "teacher@example.com" : key === "phone" ? "010-0000-0000" : "••••••"}
                  placeholderTextColor={C.textMuted}
                  secureTextEntry={key === "password"}
                  keyboardType={key === "email" ? "email-address" : key === "phone" ? "phone-pad" : "default"}
                />
              </View>
            ))}
            <View style={[styles.switchRow, { borderColor: C.border }]}>
              <Text style={[styles.switchLabel, { color: C.text }]}>관리자 본인용 계정</Text>
              <Switch
                value={form.is_admin_self_teacher}
                onValueChange={v => setForm({ ...form, is_admin_self_teacher: v })}
                trackColor={{ false: C.border, true: C.tintLight }}
                thumbColor={form.is_admin_self_teacher ? C.tint : C.textMuted}
              />
            </View>
            <View style={styles.modalActions}>
              <Pressable style={[styles.cancelBtn, { borderColor: C.border }]} onPress={() => { setShowAdd(false); resetForm(); }}>
                <Text style={[styles.cancelText, { color: C.textSecondary }]}>취소</Text>
              </Pressable>
              <Pressable style={[styles.submitBtn, { backgroundColor: C.tint }]} onPress={handleCreate} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.submitText}>추가</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 계정 생성 완료 모달 */}
      <Modal visible={!!newTeacher} animationType="fade" transparent>
        <View style={styles.overlay}>
          <View style={[styles.modalContent, { backgroundColor: C.card }]}>
            <View style={[styles.successIcon, { backgroundColor: "#D1FAE5" }]}>
              <Feather name="check-circle" size={48} color={C.success} />
            </View>
            <Text style={[styles.modalTitle, { color: C.text }]}>계정 생성 완료</Text>
            <Text style={[styles.modalSub, { color: C.textSecondary }]}>선생님에게 아래 인증코드를 전달하세요</Text>
            <View style={[styles.codeBox, { backgroundColor: C.background, borderColor: C.tint }]}>
              <Text style={[styles.codeValue, { color: C.text }]}>{newTeacher?.code}</Text>
            </View>
            <Pressable style={[styles.modalBtn, { backgroundColor: C.tint }]} onPress={() => setNewTeacher(null)}>
              <Text style={styles.modalBtnText}>확인</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── 수업 카드 스타일 ──────────────────────────────────────────
const card = StyleSheet.create({
  root: { borderRadius: 14, overflow: "hidden", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  topRow: { flexDirection: "row", alignItems: "flex-start", padding: 14, gap: 6 },
  timeBox: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  timeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  className: { fontSize: 15, fontFamily: "Inter_700Bold" },
  dayText: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  statsRow: { flexDirection: "row", borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 10 },
  statItem: { flex: 1, alignItems: "center", gap: 3 },
  statLabel: { fontSize: 10, fontFamily: "Inter_400Regular" },
  statValue: { fontSize: 13, fontFamily: "Inter_700Bold" },
  statDivider: { width: 1, marginVertical: 4 },
  actions: { flexDirection: "row", padding: 12, gap: 10 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8, borderRadius: 8 },
  actionBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});

// ── 화면 스타일 ───────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 10 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
  addBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },

  tabBar: { flexDirection: "row", borderBottomWidth: 1, marginHorizontal: 16 },
  tabItem: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  viewToggle: { flexDirection: "row", borderRadius: 10, borderWidth: 1, overflow: "hidden" },
  viewToggleItem: { flex: 1, paddingVertical: 9, alignItems: "center", justifyContent: "center" },
  viewToggleText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  summaryBox: { borderRadius: 14, padding: 14, borderWidth: 1, gap: 12 },
  summaryHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  summaryTitle: { flex: 1, fontSize: 14, fontFamily: "Inter_700Bold" },
  summaryDate: { fontSize: 12, fontFamily: "Inter_400Regular" },
  summaryItems: { flexDirection: "row", gap: 10 },
  summaryItem: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10 },
  summaryItemValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  summaryItemLabel: { fontSize: 10, fontFamily: "Inter_400Regular" },

  weekDayHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, marginBottom: 6 },
  weekDayLabel: { fontSize: 15, fontFamily: "Inter_700Bold" },
  todayBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  todayBadgeText: { color: "#fff", fontSize: 11, fontFamily: "Inter_600SemiBold" },

  infoBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 10 },
  infoText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },

  card: { borderRadius: 14, overflow: "hidden", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  avatar: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardInfo: { flex: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  teacherName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  selfBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  selfBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  teacherEmail: { fontSize: 13, fontFamily: "Inter_400Regular" },
  teacherPhone: { fontSize: 12, fontFamily: "Inter_400Regular" },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  codeSection: { borderTopWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  codeBox: { padding: 12, borderRadius: 10, borderWidth: 1 },
  codeLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 6 },
  codeValue: { fontSize: 16, fontFamily: "Inter_700Bold", letterSpacing: 1 },
  viewCodeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderWidth: 1.5, borderRadius: 10 },
  viewCodeText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  cardActions: { borderTopWidth: 1, paddingHorizontal: 14, paddingVertical: 10 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  actionText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  empty: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  emptySub: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 14 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
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
  modalContent: { marginHorizontal: 20, marginBottom: 60, padding: 20, borderRadius: 20, alignItems: "center", gap: 16 },
  successIcon: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", marginTop: 20 },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  modalSub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  modalBtn: { width: "100%", height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 8 },
  modalBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },

  shadow: {},
});
