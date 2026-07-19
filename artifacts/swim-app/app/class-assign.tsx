/**
 * class-assign.tsx — 반배정 변경 화면 (Admin + Teacher 공유)
 * 진입: ?classId=xxx
 *
 * 배정 대상: 현재 반에 없는 학생 중 assigned_class_ids.length < weekly_count (또는 미설정)
 * 주횟수 미설정 학생 → 주횟수 선택 팝업 먼저 표시
 * 배정 후 남은 횟수 있으면 리스트 유지, 다 채우면 제거
 */
import { ArrowLeft, Calendar, Check, CircleX, Clock, Layers, Minus, Plus, RefreshCw, Search, Trash2, TriangleAlert, User, UserPlus, X } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {ActivityIndicator, KeyboardAvoidingView, Modal, Platform,
  Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { UnifiedMemberCard } from "@/components/common/MemberCard";
import type { StudentMember } from "@/utils/studentUtils";
const C = Colors.light;

interface ClassGroup {
  id: string;
  name: string;
  schedule_days: string;
  schedule_time: string;
  instructor: string | null;
  teacher_user_id: string | null;
  capacity: number | null;
  level: string | null;
  co_teacher_ids?: string[];
}

interface TeacherItem {
  id: string;
  name: string;
  position?: string;
}

interface Student {
  id: string;
  name: string;
  birth_year?: number | null;
  parent_phone?: string | null;
  parent_name?: string | null;
  class_group_id?: string | null;
  assigned_class_ids?: string[];
  schedule_labels?: string | null;
  status?: string;
  weekly_count?: number | null;
  parent_user_id?: string | null;
  updated_at?: string | null;
  pending_status_change?: "suspended" | "withdrawn" | null;
  pending_effective_mode?: "next_month" | null;
  pending_effective_month?: string | null;
}

function toStudentMember(s: Student): StudentMember {
  return {
    id: s.id,
    swimming_pool_id: "",
    name: s.name,
    birth_year: s.birth_year != null ? String(s.birth_year) : null,
    parent_phone: s.parent_phone,
    parent_name: s.parent_name,
    parent_user_id: s.parent_user_id,
    registration_path: "admin_created",
    status: s.status || "active",
    weekly_count: s.weekly_count,
    assigned_class_ids: s.assigned_class_ids,
    schedule_labels: s.schedule_labels,
    class_group_id: s.class_group_id,
    pending_status_change: s.pending_status_change,
    pending_effective_mode: s.pending_effective_mode,
    pending_effective_month: s.pending_effective_month,
    created_at: "",
    updated_at: "",
    assignedClasses: [],
  };
}

// ── 모듈 레벨 학생 캐시 (화면 재진입 시 즉시 표시) ──────────────
let _stuCache: { data: Student[]; ts: number } | null = null;

function isActiveStudent(s: Student) {
  return s.status === "active" || s.status === "pending_parent_link" || s.status === "unregistered";
}
function isInClass(s: Student, cid: string) {
  const ids: string[] = Array.isArray(s.assigned_class_ids) ? s.assigned_class_ids : [];
  return s.class_group_id === cid || ids.includes(cid);
}

export default function ClassAssignScreen() {
  const { token, activeRole, adminUser } = useAuth();
  const insets = useSafeAreaInsets();
  const { classId, initialClass } = useLocalSearchParams<{ classId: string; initialClass?: string }>();
  const isAdmin = activeRole === "pool_admin" || activeRole === "super_admin";
  // 자기 반 담당 선생님도 co-teacher 추가/제거 가능
  const [canManageTeachers, setCanManageTeachers] = useState(isAdmin);

  const [classInfo, setClassInfo] = useState<ClassGroup | null>(() => {
    if (initialClass) { try { return JSON.parse(initialClass); } catch { return null; } }
    return null;
  });
  const [allStudents, setAllStudents] = useState<Student[]>(() =>
    _stuCache ? _stuCache.data.filter(isActiveStudent) : []
  );
  const [assigned, setAssigned] = useState<Student[]>(() =>
    _stuCache && classId
      ? _stuCache.data.filter(isActiveStudent).filter(s => isInClass(s, classId))
      : []
  );
  const [loadingStudents, setLoadingStudents] = useState(!_stuCache);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [weeklyPicker, setWeeklyPicker] = useState<Student | null>(null);
  const [timingTarget, setTimingTarget] = useState<Student | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  /* ── co-teacher 상태 ── */
  const [coTeacherIds, setCoTeacherIds]     = useState<string[]>([]);
  const [teachers, setTeachers]             = useState<TeacherItem[]>([]);
  const [showTeacherModal, setShowTeacherModal] = useState(false);
  const [coTeacherSaving, setCoTeacherSaving]   = useState(false);
  const [teacherSearch, setTeacherSearch]   = useState("");

  /* ── 주담당 선생님 변경 상태 ── */
  const [showMainTeacherModal, setShowMainTeacherModal] = useState(false);
  const [mainTeacherSearch, setMainTeacherSearch]       = useState("");
  const [mainTeacherSaving, setMainTeacherSaving]       = useState(false);

  const load = useCallback(async () => {
    if (!classId) return;
    try {
      const [cgRes, stuRes] = await Promise.all([
        apiRequest(token, `/class-groups/${classId}`),
        apiRequest(token, "/students?pool_all=true"),
      ]);
      if (cgRes.ok) {
        const cg = await cgRes.json();
        setClassInfo(cg);
        setCoTeacherIds(Array.isArray(cg.co_teacher_ids) ? cg.co_teacher_ids : []);
        // 자기 반 담당 선생님도 co-teacher 관리 가능
        if (adminUser?.id && cg.teacher_user_id === adminUser.id) {
          setCanManageTeachers(true);
        }
      }
      if (stuRes.ok) {
        const allStu: Student[] = await stuRes.json();
        _stuCache = { data: allStu, ts: Date.now() };
        const active = allStu.filter(isActiveStudent);
        setAllStudents(active);
        setAssigned(active.filter(s => isInClass(s, classId)));
      }
    } catch (e) { console.error(e); }
    finally { setLoadingStudents(false); setRefreshing(false); }
  }, [token, classId]);

  useEffect(() => { load(); }, [load]);

  // 선생님 목록 백그라운드 로드 (관리자 전용)
  useEffect(() => {
    if (!canManageTeachers || !token) return;
    apiRequest(token, "/teachers").then(r => { if (r.ok) r.json().then(setTeachers); }).catch(() => {});
  }, [token, canManageTeachers]);

  async function handleAddCoTeacher(teacher: TeacherItem) {
    if (!classId) return;
    const newIds = [...coTeacherIds.filter(id => id !== teacher.id), teacher.id];
    const prevIds = [...coTeacherIds];
    // 즉시 반영
    setCoTeacherIds(newIds);
    setShowTeacherModal(false);
    setTeacherSearch("");
    // 백그라운드 API
    apiRequest(token, `/class-groups/${classId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ co_teacher_ids: newIds }),
    }).then(r => { if (!r.ok) setCoTeacherIds(prevIds); }).catch(() => setCoTeacherIds(prevIds));
  }

  async function handleChangeMainTeacher(teacher: TeacherItem) {
    if (!classId) return;
    const prevInfo = classInfo;
    // 즉시 반영
    setClassInfo(prev => prev ? { ...prev, instructor: teacher.name, teacher_user_id: teacher.id } : prev);
    setShowMainTeacherModal(false);
    setMainTeacherSearch("");
    // 백그라운드 API
    apiRequest(token, `/class-groups/${classId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teacher_user_id: teacher.id }),
    }).then(r => { if (!r.ok) setClassInfo(prevInfo); }).catch(() => setClassInfo(prevInfo));
  }

  async function handleRemoveCoTeacher(removeId: string) {
    if (!classId) return;
    const newIds = coTeacherIds.filter(id => id !== removeId);
    const prevIds = [...coTeacherIds];
    // 즉시 반영
    setCoTeacherIds(newIds);
    // 백그라운드 API
    apiRequest(token, `/class-groups/${classId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ co_teacher_ids: newIds }),
    }).then(r => { if (!r.ok) setCoTeacherIds(prevIds); }).catch(() => setCoTeacherIds(prevIds));
  }

  const dupNames = useMemo(() => {
    const counts: Record<string, number> = {};
    allStudents.forEach(s => { counts[s.name] = (counts[s.name] || 0) + 1; });
    return new Set(Object.entries(counts).filter(([, v]) => v > 1).map(([k]) => k));
  }, [allStudents]);

  const assignable = allStudents.filter(s => {
    const ids: string[] = Array.isArray(s.assigned_class_ids) ? s.assigned_class_ids : [];
    if (ids.includes(classId!) || s.class_group_id === classId) return false;
    if (s.weekly_count && s.weekly_count > 0) {
      return ids.length < s.weekly_count;
    }
    return true;
  }).filter(s => {
    if (!search.trim()) return true;
    const q = search.trim();
    return s.name.includes(q) || (s.parent_phone || "").includes(q);
  });

  function handlePressAdd(student: Student) {
    if (!classId) return;
    const ids: string[] = Array.isArray(student.assigned_class_ids) ? student.assigned_class_ids : [];
    if (ids.includes(classId)) return;
    if (!student.weekly_count || student.weekly_count < 1) {
      setWeeklyPicker(student);
    } else {
      doAssign(student, student.weekly_count);
    }
  }

  function handleWeeklySelected(weekly: number) {
    if (!weeklyPicker) return;
    const student = weeklyPicker;
    setWeeklyPicker(null);
    doAssign(student, weekly);
  }

  async function doAssign(student: Student, weeklyCount: number) {
    if (!classId) return;
    const capacityOver = classInfo?.capacity != null && assigned.length >= classInfo.capacity;
    if (capacityOver) return;

    const currentIds: string[] = Array.isArray(student.assigned_class_ids) ? student.assigned_class_ids : [];
    const newIds = [...currentIds, classId];
    const optimistic = { ...student, assigned_class_ids: newIds, weekly_count: weeklyCount };

    // 즉시 UI 반영
    setAllStudents(prev => prev.map(s => s.id === student.id ? optimistic : s));
    setAssigned(prev => [...prev, optimistic]);
    setHasChanges(true);

    // 백그라운드 API
    try {
      const res = await apiRequest(token, `/students/${student.id}/assign`, {
        method: "PATCH",
        body: JSON.stringify({ assigned_class_ids: newIds, weekly_count: weeklyCount }),
      });
      if (!res.ok) {
        setAllStudents(prev => prev.map(s => s.id === student.id ? student : s));
        setAssigned(prev => prev.filter(s => s.id !== student.id));
      } else {
        const updated: Student = await res.json();
        setAllStudents(prev => prev.map(s => s.id === student.id ? { ...s, ...updated } : s));
        setAssigned(prev => prev.map(s => s.id === student.id ? { ...s, ...updated } : s));
      }
    } catch {
      setAllStudents(prev => prev.map(s => s.id === student.id ? student : s));
      setAssigned(prev => prev.filter(s => s.id !== student.id));
    }
  }

  async function doRemove(student: Student, timing: "now" | "next_week" | "week_after" = "now") {
    if (!classId) return;

    const prevAssigned = assigned;
    const prevAll = allStudents;

    // 즉시 UI 반영
    setAssigned(prev => prev.filter(s => s.id !== student.id));
    setAllStudents(prev => prev.map(s => s.id === student.id
      ? { ...s, assigned_class_ids: (s.assigned_class_ids || []).filter(id => id !== classId), class_group_id: s.class_group_id === classId ? null : s.class_group_id }
      : s
    ));
    setHasChanges(true);

    // 백그라운드 API
    try {
      const res = await apiRequest(token, `/students/${student.id}/remove-from-class`, {
        method: "POST",
        body: JSON.stringify({ class_group_id: classId, effective_timing: timing }),
      });
      if (!res.ok) { setAssigned(prevAssigned); setAllStudents(prevAll); }
    } catch {
      setAssigned(prevAssigned); setAllStudents(prevAll);
    }
  }

  const days = classInfo?.schedule_days.split(",").map(d => d.trim()).join("·") || "";
  const capacityLabel = classInfo?.capacity != null
    ? `${assigned.length} / ${classInfo.capacity}명`
    : `${assigned.length}명`;
  const capacityOver = classInfo?.capacity != null && assigned.length >= classInfo.capacity;

  function goBack() {
    router.back();
  }

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <View style={[s.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20) }]}>
        <Pressable onPress={goBack} style={s.backBtn}>
          <ArrowLeft size={20} color={C.text} />
        </Pressable>
        <Text style={[s.title, { color: C.text }]}>반배정 변경</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAwareScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        showsVerticalScrollIndicator={false}
      >
        {classInfo && (
          <View style={[s.classCard, { backgroundColor: C.card }]}>
            <View style={[s.classIcon, { backgroundColor: "#E6FAF8" }]}>
              <Layers size={20} color="#7C3AED" />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[s.className, { color: C.text }]}>{classInfo.name}</Text>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={s.metaRow}>
                  <Calendar size={12} color={C.textMuted} />
                  <Text style={[s.meta, { color: C.textSecondary }]}>{days}요일</Text>
                </View>
                <View style={s.metaRow}>
                  <Clock size={12} color={C.textMuted} />
                  <Text style={[s.meta, { color: C.textSecondary }]}>{classInfo.schedule_time}</Text>
                </View>
              </View>
              {/* 주담당 선생님 */}
              {isAdmin ? (
                <Pressable
                  style={[s.metaRow, { gap: 4 }]}
                  onPress={() => { setMainTeacherSearch(""); setShowMainTeacherModal(true); }}
                  disabled={mainTeacherSaving}
                >
                  <User size={12} color={C.textMuted} />
                  <Text style={[s.meta, { color: C.textSecondary }]}>
                    {classInfo.instructor || "선생님 미지정"}
                  </Text>
                  <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, backgroundColor: "#EEF2FF" }}>
                    <Text style={{ fontSize: 10, fontFamily: "Pretendard-Regular", color: "#4F46E5" }}>변경</Text>
                  </View>
                </Pressable>
              ) : classInfo.instructor ? (
                <View style={s.metaRow}>
                  <User size={12} color={C.textMuted} />
                  <Text style={[s.meta, { color: C.textSecondary }]}>{classInfo.instructor}</Text>
                </View>
              ) : null}
              {/* 추가 선생님 */}
              {coTeacherIds.length > 0 && coTeacherIds.map(cid => {
                const ct = teachers.find(t => t.id === cid);
                return (
                  <View key={cid} style={[s.metaRow, { gap: 4 }]}>
                    <UserPlus size={12} color="#7C3AED" />
                    <Text style={[s.meta, { color: "#7C3AED" }]}>{ct?.name || "선생님"}</Text>
                    {canManageTeachers && (
                      <Pressable onPress={() => handleRemoveCoTeacher(cid)} hitSlop={8} disabled={coTeacherSaving}>
                        <X size={11} color="#EF4444" />
                      </Pressable>
                    )}
                  </View>
                );
              })}
              {/* 선생님 추가 버튼 */}
              {canManageTeachers && (
                <Pressable
                  style={[s.metaRow, { marginTop: 2 }]}
                  onPress={() => { setTeacherSearch(""); setShowTeacherModal(true); }}
                  disabled={coTeacherSaving}
                >
                  <UserPlus size={12} color={C.tint} />
                  <Text style={[s.meta, { color: C.tint }]}>선생님 추가</Text>
                </Pressable>
              )}
            </View>
            <View style={[s.countBadge, { backgroundColor: capacityOver ? "#F9DEDA" : C.tintLight }]}>
              <Text style={[s.countText, { color: capacityOver ? C.error : C.tint }]}>{capacityLabel}</Text>
            </View>
          </View>
        )}

        <View style={s.sectionHeader}>
          <Text style={[s.sectionTitle, { color: C.text }]}>현재 소속 회원</Text>
          <Text style={[s.sectionCount, { color: C.textMuted }]}>{assigned.length}명</Text>
        </View>

        {assigned.length === 0 ? (
          <View style={s.emptyRow}>
            <Text style={[s.emptyText, { color: C.textMuted }]}>이 반에 배정된 회원이 없습니다</Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            {assigned.map(item => (
              <UnifiedMemberCard
                key={item.id}
                student={toStudentMember(item)}
                showTeacher={false}
                actions={[
                  {
                    label: "회원 정보",
                    icon: "user",
                    color: "#0369A1",
                    bg: "#E0F2FE",
                    loading: false,
                    onPress: () => router.push({ pathname: "/(teacher)/student-detail", params: { id: item.id } } as any),
                  },
                  {
                    label: "반 제외-미배정 이동",
                    icon: "user-minus",
                    color: C.error,
                    bg: "#F9DEDA",
                    loading: saving === item.id,
                    onPress: () => setTimingTarget(item),
                  },
                ]}
              />
            ))}
          </View>
        )}

        <View style={[s.divider, { borderTopColor: C.border }]} />

        <View style={s.sectionHeader}>
          <Text style={[s.sectionTitle, { color: C.text }]}>배정 가능 회원</Text>
          <Text style={[s.sectionCount, { color: C.textMuted }]}>{assignable.length}명</Text>
        </View>

        <View style={[s.searchWrap, { backgroundColor: C.card, borderColor: C.border }]}>
          <Search size={16} color={C.textMuted} />
          <TextInput
            style={[s.searchInput, { color: C.text }]}
            value={search}
            onChangeText={setSearch}
            placeholder="이름 또는 전화번호 검색..."
            placeholderTextColor={C.textMuted}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")}>
              <CircleX size={16} color={C.textMuted} />
            </Pressable>
          )}
        </View>

        {loadingStudents ? (
          <ActivityIndicator color={C.tint} style={{ marginTop: 24, marginBottom: 8 }} />
        ) : assignable.length === 0 ? (
          <View style={s.emptyRow}>
            <Text style={[s.emptyText, { color: C.textMuted }]}>
              {search.trim()
                ? `"${search}"에 해당하는 배정 가능한 회원이 없습니다`
                : "배정 가능한 회원이 없습니다"}
            </Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            {assignable.map(item => (
              <StudentRow
                key={item.id}
                student={item}
                classId={classId!}
                action="add"
                loading={saving === item.id}
                onPress={() => handlePressAdd(item)}
                disabled={capacityOver}
                isDuplicate={dupNames.has(item.name)}
              />
            ))}
          </View>
        )}

        <View style={[s.doneWrap, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable
            style={[s.doneBtn, { backgroundColor: hasChanges ? C.tint : C.border }]}
            onPress={goBack}
          >
            <Check size={18} color={hasChanges ? "#fff" : C.textMuted} />
            <Text style={[s.doneTxt, { color: hasChanges ? "#fff" : C.textMuted }]}>
              {hasChanges ? `배정 완료 — ${assigned.length}명 확정` : "변경 없음 · 돌아가기"}
            </Text>
          </Pressable>
        </View>
      </KeyboardAwareScrollView>

      {weeklyPicker && (
        <WeeklyPickerModal
          studentName={weeklyPicker.name}
          onSelect={handleWeeklySelected}
          onCancel={() => setWeeklyPicker(null)}
        />
      )}

      {timingTarget && (
        <RemoveTimingModal
          studentName={timingTarget.name}
          onSelect={(timing) => {
            const target = timingTarget;
            setTimingTarget(null);
            doRemove(target, timing);
          }}
          onCancel={() => setTimingTarget(null)}
        />
      )}

      {/* ── 주담당 선생님 변경 모달 ── */}
      <Modal visible={showMainTeacherModal} animationType="slide" transparent onRequestClose={() => setShowMainTeacherModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1, justifyContent: "flex-end" }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setShowMainTeacherModal(false)} />
          <View style={{ backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20,
            paddingBottom: insets.bottom + 16, maxHeight: "75%" }}>
            <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: C.border,
              flexDirection: "row", alignItems: "center" }}>
              <Text style={{ flex: 1, fontSize: 16, fontFamily: "Pretendard-Regular", color: C.text }}>
                주담당 선생님 변경
              </Text>
              <Pressable onPress={() => setShowMainTeacherModal(false)} hitSlop={8}>
                <X size={20} color={C.textSecondary} />
              </Pressable>
            </View>
            {classInfo?.instructor ? (
              <View style={{ marginHorizontal: 16, marginTop: 12, flexDirection: "row", alignItems: "center",
                backgroundColor: "#F0FDF4", borderRadius: 10, padding: 10, gap: 8 }}>
                <User size={14} color="#16A34A" />
                <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: "#16A34A" }}>
                  현재 담당: {classInfo.instructor}
                </Text>
              </View>
            ) : null}
            <View style={[s.searchWrap, { marginTop: 12, marginHorizontal: 16, marginBottom: 8, backgroundColor: C.background }]}>
              <Search size={15} color={C.textMuted} />
              <TextInput
                style={[s.searchInput, { color: C.text }]}
                value={mainTeacherSearch}
                onChangeText={setMainTeacherSearch}
                placeholder="이름으로 검색..."
                placeholderTextColor={C.textMuted}
              />
              {mainTeacherSearch.length > 0 && (
                <Pressable onPress={() => setMainTeacherSearch("")}>
                  <CircleX size={15} color={C.textMuted} />
                </Pressable>
              )}
            </View>
            {mainTeacherSaving ? (
              <ActivityIndicator color={C.tint} style={{ marginVertical: 32 }} />
            ) : (
              <ScrollView style={{ paddingHorizontal: 16 }} contentContainerStyle={{ gap: 8, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
                {teachers
                  .filter(t => !mainTeacherSearch.trim() || t.name.includes(mainTeacherSearch.trim()))
                  .map(t => {
                    const isCurrent = classInfo?.instructor === t.name;
                    return (
                      <Pressable
                        key={t.id}
                        style={{ flexDirection: "row", alignItems: "center",
                          backgroundColor: isCurrent ? "#F0FDF4" : C.background,
                          borderRadius: 12, padding: 14, gap: 10 }}
                        onPress={() => !isCurrent && handleChangeMainTeacher(t)}
                        disabled={isCurrent}
                      >
                        <View style={{ width: 36, height: 36, borderRadius: 18,
                          backgroundColor: isCurrent ? "#D1FAE5" : "#EEF2FF",
                          alignItems: "center", justifyContent: "center" }}>
                          <User size={16} color={isCurrent ? "#16A34A" : "#4F46E5"} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text }}>{t.name}</Text>
                          {t.position ? (
                            <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted }}>{t.position}</Text>
                          ) : null}
                        </View>
                        {isCurrent ? (
                          <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: "#D1FAE5" }}>
                            <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: "#16A34A" }}>현재</Text>
                          </View>
                        ) : (
                          <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: "#EEF2FF" }}>
                            <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: "#4F46E5" }}>배정</Text>
                          </View>
                        )}
                      </Pressable>
                    );
                  })}
                {teachers.filter(t => !mainTeacherSearch.trim() || t.name.includes(mainTeacherSearch.trim())).length === 0 ? (
                  <View style={{ alignItems: "center", paddingVertical: 32 }}>
                    <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted }}>
                      등록된 선생님이 없습니다
                    </Text>
                  </View>
                ) : null}
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── 선생님 추가 모달 ── */}
      <Modal visible={showTeacherModal} animationType="slide" transparent onRequestClose={() => setShowTeacherModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1, justifyContent: "flex-end" }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setShowTeacherModal(false)} />
          <View style={{ backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20,
            paddingBottom: insets.bottom + 16, maxHeight: "75%" }}>
            <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: C.border,
              flexDirection: "row", alignItems: "center" }}>
              <Text style={{ flex: 1, fontSize: 16, fontFamily: "Pretendard-Regular", color: C.text }}>
                공동담당 선생님 추가
              </Text>
              <Pressable onPress={() => setShowTeacherModal(false)} hitSlop={8}>
                <X size={20} color={C.textSecondary} />
              </Pressable>
            </View>
            <View style={[s.searchWrap, { marginTop: 12, marginHorizontal: 16, marginBottom: 8, backgroundColor: C.background }]}>
              <Search size={15} color={C.textMuted} />
              <TextInput
                style={[s.searchInput, { color: C.text }]}
                value={teacherSearch}
                onChangeText={setTeacherSearch}
                placeholder="이름으로 검색..."
                placeholderTextColor={C.textMuted}
              />
              {teacherSearch.length > 0 && (
                <Pressable onPress={() => setTeacherSearch("")}>
                  <CircleX size={15} color={C.textMuted} />
                </Pressable>
              )}
            </View>
            {coTeacherSaving ? (
              <ActivityIndicator color={C.tint} style={{ marginVertical: 32 }} />
            ) : (
              <ScrollView style={{ paddingHorizontal: 16 }} contentContainerStyle={{ gap: 8, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
                {teachers
                  .filter(t =>
                    !coTeacherIds.includes(t.id) &&
                    classInfo?.teacher_user_id !== t.id &&
                    (!teacherSearch.trim() || t.name.includes(teacherSearch.trim()))
                  )
                  .map(t => (
                    <Pressable
                      key={t.id}
                      style={{ flexDirection: "row", alignItems: "center", backgroundColor: C.background,
                        borderRadius: 12, padding: 14, gap: 10 }}
                      onPress={() => handleAddCoTeacher(t)}
                    >
                      <View style={{ width: 36, height: 36, borderRadius: 18,
                        backgroundColor: "#EEF2FF", alignItems: "center", justifyContent: "center" }}>
                        <User size={16} color="#4F46E5" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text }}>{t.name}</Text>
                        {t.position ? (
                          <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted }}>{t.position}</Text>
                        ) : null}
                      </View>
                      <View style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
                        backgroundColor: "#EEF2FF" }}>
                        <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: "#4F46E5" }}>추가</Text>
                      </View>
                    </Pressable>
                  ))}
                {teachers.filter(t =>
                  !coTeacherIds.includes(t.id) &&
                  classInfo?.teacher_user_id !== t.id &&
                  (!teacherSearch.trim() || t.name.includes(teacherSearch.trim()))
                ).length === 0 ? (
                  <View style={{ alignItems: "center", paddingVertical: 32 }}>
                    <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted }}>
                      추가할 수 있는 선생님이 없습니다
                    </Text>
                  </View>
                ) : null}
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function WeeklyPickerModal({
  studentName, onSelect, onCancel,
}: { studentName: string; onSelect: (n: number) => void; onCancel: () => void }) {
  return (
    <Modal visible animationType="fade" transparent onRequestClose={onCancel}>
      <Pressable style={wp.backdrop} onPress={onCancel} />
      <View style={wp.card}>
        <Text style={wp.title}>주 몇 회 수업인가요?</Text>
        <Text style={wp.sub}>{studentName} 회원의 주 수업 횟수를 선택하세요</Text>
        <View style={wp.btnRow}>
          {[1, 2, 3].map(n => (
            <Pressable key={n} style={wp.optBtn} onPress={() => onSelect(n)}>
              <Text style={wp.optNum}>주 {n}회</Text>
              <Text style={wp.optSub}>{n}개 반 배정</Text>
            </Pressable>
          ))}
        </View>
        <Pressable style={wp.cancelBtn} onPress={onCancel}>
          <Text style={wp.cancelTxt}>취소</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function RemoveTimingModal({
  studentName, onSelect, onCancel,
}: { studentName: string; onSelect: (t: "now" | "next_week" | "week_after") => void; onCancel: () => void }) {
  const opts: { key: "now" | "next_week" | "week_after"; label: string; sub: string }[] = [
    { key: "now",        label: "오늘부터",    sub: "지금 즉시 반 배정 해제" },
    { key: "next_week",  label: "다음 주부터",  sub: "이번 주까지는 기존 반 유지" },
    { key: "week_after", label: "다다음 주부터", sub: "이번 주/다음 주까지 기존 반 유지" },
  ];
  return (
    <Modal visible animationType="fade" transparent onRequestClose={onCancel}>
      <Pressable style={rt.backdrop} onPress={onCancel} />
      <View style={rt.card}>
        <Text style={rt.title}>반 제외 시점 선택</Text>
        <Text style={rt.sub}>{studentName} 회원을 이 반에서 제외합니다</Text>
        <View style={rt.optList}>
          {opts.map(o => (
            <Pressable key={o.key} style={rt.optBtn} onPress={() => onSelect(o.key)}>
              <Text style={rt.optLabel}>{o.label}</Text>
              <Text style={rt.optSub}>{o.sub}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable style={rt.cancelBtn} onPress={onCancel}>
          <Text style={rt.cancelTxt}>취소</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
const C_rt = Colors.light;
const rt = StyleSheet.create({
  backdrop:  { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  card:      { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: C_rt.card,
               borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 36, gap: 8 },
  title:     { fontSize: 17, fontFamily: "Pretendard-Regular", color: C_rt.text, textAlign: "center" },
  sub:       { fontSize: 13, fontFamily: "Pretendard-Regular", color: C_rt.textMuted, textAlign: "center", marginBottom: 8 },
  optList:   { gap: 8 },
  optBtn:    { backgroundColor: "#FFF1F2", borderRadius: 12, padding: 14, gap: 3 },
  optLabel:  { fontSize: 15, fontFamily: "Pretendard-Regular", color: C_rt.error },
  optSub:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: C_rt.textMuted },
  cancelBtn: { marginTop: 4, paddingVertical: 14, alignItems: "center" },
  cancelTxt: { fontSize: 15, fontFamily: "Pretendard-Regular", color: C_rt.textMuted },
});

function StudentRow({
  student, classId, action, loading, onPress, disabled, isDuplicate,
}: {
  student: Student;
  classId: string;
  action: "add" | "remove";
  loading: boolean;
  onPress: () => void;
  disabled?: boolean;
  isDuplicate?: boolean;
}) {
  const isAdd = action === "add";
  const ids: string[] = Array.isArray(student.assigned_class_ids) ? student.assigned_class_ids : [];
  const assignedCount = ids.length;
  const weekly = student.weekly_count;

  const progressLabel = weekly
    ? assignedCount > 0
      ? `${assignedCount}/${weekly}개 반 배정됨`
      : `주 ${weekly}회 미배정`
    : "주횟수 미설정";

  return (
    <View style={[sr.row, disabled && { opacity: 0.5 }]}>
      <View style={sr.avatar}>
        <Text style={sr.avatarText}>{student.name[0]}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={sr.name}>{student.name}</Text>
        {isDuplicate && student.schedule_labels ? (
          <View style={sr.scheduleHintTag}>
            <Text style={sr.scheduleHintTxt}>{student.schedule_labels}</Text>
          </View>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {student.parent_phone && (
            <Text style={sr.phone}>{student.parent_phone.slice(-4)}</Text>
          )}
          <View style={[sr.progressBadge, weekly ? (assignedCount < weekly ? { backgroundColor: "#FFF1BF" } : { backgroundColor: "#D1FAE5" }) : { backgroundColor: "#F3F4F6" }]}>
            <Text style={[sr.progressText, weekly ? (assignedCount < weekly ? { color: "#D97706" } : { color: "#065F46" }) : { color: "#6B7280" }]}>
              {progressLabel}
            </Text>
          </View>
        </View>
      </View>
      <Pressable
        style={[sr.btn, isAdd ? sr.addBtn : sr.removeBtn, (loading || disabled) && { opacity: 0.5 }]}
        onPress={!loading && !disabled ? onPress : undefined}
        disabled={loading || disabled}
      >
        {loading
          ? <ActivityIndicator size="small" color="#fff" />
          : isAdd
            ? <Plus size={16} color="#fff" />
            : <Minus size={16} color="#fff" />}
      </Pressable>
    </View>
  );
}

const sr = StyleSheet.create({
  row:          { flexDirection: "row", alignItems: "center", backgroundColor: C.card,
                  borderRadius: 12, padding: 12, gap: 10 },
  avatar:       { width: 38, height: 38, borderRadius: 19, backgroundColor: C.tint + "18",
                  alignItems: "center", justifyContent: "center" },
  avatarText:   { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.tint },
  name:         { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  phone:        { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },
  progressBadge:   { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  progressText:    { fontSize: 10, fontFamily: "Pretendard-Regular" },
  scheduleHintTag: { alignSelf: "flex-start", backgroundColor: "#F1F5F9", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  scheduleHintTxt: { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B" },
  btn:          { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  addBtn:       { backgroundColor: C.tint },
  removeBtn:    { backgroundColor: C.error },
});

const wp = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  card:     { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: C.card,
              borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40, gap: 12 },
  title:    { fontSize: 18, fontFamily: "Pretendard-Regular", color: C.text, textAlign: "center" },
  sub:      { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted, textAlign: "center" },
  btnRow:   { flexDirection: "row", gap: 10, marginTop: 8 },
  optBtn:   { flex: 1, backgroundColor: C.tintLight, borderRadius: 12, padding: 14, alignItems: "center", gap: 4 },
  optNum:   { fontSize: 16, fontFamily: "Pretendard-Regular", color: C.tint },
  optSub:   { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  cancelBtn:{ paddingVertical: 14, alignItems: "center" },
  cancelTxt:{ fontSize: 15, fontFamily: "Pretendard-Regular", color: C.textMuted },
});

const s = StyleSheet.create({
  root:         { flex: 1 },
  header:       { flexDirection: "row", alignItems: "center", paddingHorizontal: 16,
                  paddingBottom: 12, gap: 8 },
  backBtn:      { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title:        { flex: 1, textAlign: "center", fontSize: 17, fontFamily: "Pretendard-Regular" },
  classCard:    { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginBottom: 12,
                  borderRadius: 14, padding: 14, gap: 12 },
  classIcon:    { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  className:    { fontSize: 15, fontFamily: "Pretendard-Regular" },
  metaRow:      { flexDirection: "row", alignItems: "center", gap: 4 },
  meta:         { fontSize: 12, fontFamily: "Pretendard-Regular" },
  countBadge:   { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  countText:    { fontSize: 13, fontFamily: "Pretendard-Regular" },
  sectionHeader:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                  paddingHorizontal: 16, paddingVertical: 10 },
  sectionTitle: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  sectionCount: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  divider:      { borderTopWidth: 1, marginVertical: 12, marginHorizontal: 16 },
  searchWrap:   { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginBottom: 10,
                  borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, gap: 8 },
  searchInput:  { flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular" },
  emptyRow:     { alignItems: "center", paddingVertical: 32 },
  emptyText:    { fontSize: 13, fontFamily: "Pretendard-Regular" },
  doneWrap:     { paddingHorizontal: 16, paddingTop: 10, backgroundColor: C.background },
  doneBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center",
                  gap: 8, paddingVertical: 15, borderRadius: 14 },
  doneTxt:      { fontSize: 16, fontFamily: "Pretendard-Regular" },
  backdrop:     { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
});
