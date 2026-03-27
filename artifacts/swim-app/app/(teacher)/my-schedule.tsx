/**
 * (teacher)/my-schedule.tsx — 통합 업무 스케줄러 (thin shell)
 * 컴포넌트: components/teacher/my-schedule/
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal,
  Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { addTabResetListener } from "@/utils/tabReset";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import ClassCreateFlow from "@/components/classes/ClassCreateFlow";
import { WeeklySchedule } from "@/components/teacher/WeeklySchedule";
import { TeacherClassGroup, SlotStatus } from "@/components/teacher/types";
import StudentManagementSheet from "@/components/teacher/StudentManagementSheet";

import WeeklyTimetable from "@/components/teacher/my-schedule/WeeklyTimetableV2";
import MonthlyCalendar from "@/components/teacher/my-schedule/MonthlyCalendar";
import DaySheet from "@/components/teacher/my-schedule/DaySheet";
import ClassDetailSheet from "@/components/teacher/my-schedule/ClassDetailSheet";
import UnregisteredPickerModal from "@/components/teacher/my-schedule/UnregisteredPickerModal";
import MoveToClassModal from "@/components/teacher/my-schedule/MoveToClassModal";
import {
  ChangeLogItem, StudentItem,
  addDaysStr, classesForDate, getKoDay, getMondayStr, todayDateStr,
} from "@/components/teacher/my-schedule/utils";
import { useMyScheduleData } from "@/components/teacher/my-schedule/hooks/useMyScheduleData";
import { useMyScheduleActions } from "@/components/teacher/my-schedule/hooks/useMyScheduleActions";

const C = Colors.light;

type ViewMode = "monthly" | "weekly" | "daily";

export default function MyScheduleScreen() {
  const { token, adminUser } = useAuth();
  const { themeColor } = useBrand();
  const params = useLocalSearchParams<{ openDate?: string }>();
  const selfTeacher = adminUser ? { id: adminUser.id, name: adminUser.name || "나" } : undefined;
  const poolId = (adminUser as any)?.swimming_pool_id || "";

  const [viewMode,      setViewMode]      = useState<ViewMode>("monthly");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds,   setSelectedIds]   = useState<Set<string>>(new Set());
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());

  const [showCreate, setShowCreate] = useState(false);
  const [createInitialDays, setCreateInitialDays] = useState<string[]>([]);
  const [createInitialStep, setCreateInitialStep] = useState<1|2|3|4>(1);
  const [deleting,   setDeleting]   = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteFailCount,   setDeleteFailCount]   = useState(0);
  const [showManagement, setShowManagement] = useState(false);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayAttMap, setDayAttMap] = useState<Record<string, number>>({});
  const [dayDiarySet, setDayDiarySet] = useState<Set<string>>(new Set());
  const [dayMemo, setDayMemo] = useState("");
  const [memoDateSet, setMemoDateSet] = useState<Set<string>>(new Set());

  const [detailGroup,       setDetailGroup]       = useState<TeacherClassGroup | null>(null);
  const [showDeleteClassConfirm, setShowDeleteClassConfirm] = useState(false);
  const [deletingClass,         setDeletingClass]          = useState<TeacherClassGroup | null>(null);
  const [unregClassId,          setUnregClassId]           = useState<string | null>(null);
  const [removeClassGroup,  setRemoveClassGroup]  = useState<TeacherClassGroup | null>(null);

  const [selectedGroup, setSelectedGroup] = useState<TeacherClassGroup | null>(null);

  const [weeklyViewStart, setWeeklyViewStart] = useState<string>(() => getMondayStr(todayDateStr()));
  const [weekChangeLogs, setWeekChangeLogs] = useState<ChangeLogItem[]>([]);

  const isMountedRef = useRef(false);
  const pendingRestoreDateRef = useRef<string | null>(null);
  const autoOpenDoneRef = useRef(false);
  const selectedDateRef = useRef<string | null>(null);
  selectedDateRef.current = selectedDate;

  const {
    groups, setGroups,
    students, setStudents,
    loading, setLoading,
    refreshing, setRefreshing,
    todayAttMap, todayDiarySet,
    load,
  } = useMyScheduleData(token);

  const {
    dayViewAttState, setDayViewAttState,
    dayViewAttSaving,
    showMoveSheet, setShowMoveSheet,
    moveStudent, setMoveStudent,
    moveSheetSaving,
    dayMakeups, dayMakeupsLoading,
    loadDayMakeups,
    markDayAtt,
    handleMoveToClass,
  } = useMyScheduleActions({ token, selectedGroup, load });

  useEffect(() => { load(); }, [load]);

  const handleDeleteClass = useCallback(async () => {
    if (!deletingClass) return;
    try {
      const res = await apiRequest(token, `/class-groups/${deletingClass.id}`, { method: "DELETE" });
      if (res.ok) {
        setSelectedGroup(null);
        setDeletingClass(null);
        setShowDeleteClassConfirm(false);
        load();
      }
    } catch {}
  }, [token, deletingClass, load]);

  useEffect(() => {
    if (!loading && params.openDate && typeof params.openDate === "string" && !autoOpenDoneRef.current) {
      autoOpenDoneRef.current = true;
      setViewMode("monthly");
      handleDatePress(params.openDate);
    }
  }, [loading, params.openDate]);

  useEffect(() => {
    if (!token || viewMode !== "weekly") return;
    apiRequest(token, `/class-change-logs?week_start=${weeklyViewStart}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.logs) setWeekChangeLogs(d.logs); })
      .catch(() => {});
  }, [token, weeklyViewStart, viewMode]);

  async function loadDayData(dateStr: string) {
    try {
      const [attRes, dRes] = await Promise.all([
        apiRequest(token, `/attendance?date=${dateStr}`),
        apiRequest(token, `/diary?date=${dateStr}`),
      ]);
      if (attRes.ok) {
        const arr: any[] = await attRes.json();
        const map: Record<string,number> = {};
        arr.forEach(a => { const cid = a.class_group_id||a.class_id; if (cid) map[cid]=(map[cid]||0)+1; });
        setDayAttMap(map);
      }
      if (dRes.ok) {
        const arr: any[] = await dRes.json();
        setDayDiarySet(new Set(arr.map((d:any) => d.class_group_id).filter(Boolean)));
      }
    } catch {}
  }

  async function loadMemo(dateStr: string) {
    const key = `scheduleMemo_${poolId}_${dateStr}`;
    const v = await AsyncStorage.getItem(key).catch(() => null);
    setDayMemo(v || "");
  }
  async function saveMemo(dateStr: string, text: string) {
    const key = `scheduleMemo_${poolId}_${dateStr}`;
    if (text.trim()) {
      await AsyncStorage.setItem(key, text).catch(() => {});
      setMemoDateSet(prev => new Set([...prev, dateStr]));
    } else {
      await AsyncStorage.removeItem(key).catch(() => {});
      setMemoDateSet(prev => { const n = new Set(prev); n.delete(dateStr); return n; });
    }
  }

  function handleDatePress(dateStr: string) {
    if (selectionMode) {
      setSelectedDates(prev => {
        const next = new Set(prev);
        next.has(dateStr) ? next.delete(dateStr) : next.add(dateStr);
        return next;
      });
      return;
    }
    if (selectedDate === dateStr) {
      setSelectedDate(null);
    } else {
      setSelectedDate(dateStr);
      loadDayData(dateStr);
      loadMemo(dateStr);
    }
  }

  function handleDaySheetClassPress(g: TeacherClassGroup) {
    setDetailGroup(g);
  }

  function navigateFromSheet(navigate: () => void) {
    const dateToRestore = selectedDate;
    setDetailGroup(null);
    setSelectedDate(null);
    if (dateToRestore) pendingRestoreDateRef.current = dateToRestore;
    setTimeout(navigate, 350);
  }

  function handleDaySheetMakeup() {
    navigateFromSheet(() => router.push("/(teacher)/makeups" as any));
  }

  useFocusEffect(useCallback(() => {
    if (!isMountedRef.current) { isMountedRef.current = true; return; }

    if (pendingRestoreDateRef.current) {
      const d = pendingRestoreDateRef.current;
      pendingRestoreDateRef.current = null;
      setViewMode("monthly");
      setSelectedDate(d);
      loadDayData(d);
      loadMemo(d);
      return;
    }

    apiRequest(token, "/students").then(r => r.ok && r.json()).then(data => {
      if (Array.isArray(data)) setStudents(data);
    }).catch(() => {});
    const cur = selectedDateRef.current;
    if (cur) {
      loadDayData(cur);
      loadMemo(cur);
    }
  }, [token]));

  useEffect(() => {
    return addTabResetListener("my-schedule", () => {
      setSelectedGroup(null);
      setDetailGroup(null);
      setSelectedDate(null);
      setSelectionMode(false);
      setSelectedIds(new Set());
      setSelectedDates(new Set());
      setViewMode("monthly");
    });
  }, []);

  const groupStudents = selectedGroup
    ? students.filter(st =>
        (Array.isArray(st.assigned_class_ids) && st.assigned_class_ids.includes(selectedGroup.id))
        || st.class_group_id === selectedGroup.id
      ).sort((a, b) => {
        const aAbs = dayViewAttState[a.id] === "absent";
        const bAbs = dayViewAttState[b.id] === "absent";
        if (aAbs !== bAbs) return aAbs ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
    : [];

  const statusMap: Record<string, SlotStatus> = {};
  groups.forEach(g => {
    statusMap[g.id] = {
      attChecked: todayAttMap[g.id] || 0,
      diaryDone:  todayDiarySet.has(g.id),
      hasPhotos:  false,
    };
  });

  function toggleSelect(id: string) {
    setSelectedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }
  async function confirmDelete() {
    setShowDeleteConfirm(false); setDeleting(true);
    const ids = Array.from(selectedIds); let failed = 0;
    for (const id of ids) { const res = await apiRequest(token, `/class-groups/${id}`, { method: "DELETE" }); if (!res.ok) failed++; }
    setDeleting(false); setSelectionMode(false); setSelectedIds(new Set());
    if (failed > 0) setDeleteFailCount(failed);
    load();
  }
  async function confirmDeleteMemos() {
    setShowDeleteConfirm(false); setDeleting(true);
    for (const dateStr of Array.from(selectedDates)) {
      await AsyncStorage.removeItem(`scheduleMemo_${poolId}_${dateStr}`).catch(() => {});
      await AsyncStorage.removeItem(`scheduleAudioList_${poolId}_${dateStr}`).catch(() => {});
    }
    setMemoDateSet(prev => {
      const next = new Set(prev);
      selectedDates.forEach(d => next.delete(d));
      return next;
    });
    setDeleting(false); setSelectionMode(false); setSelectedDates(new Set());
  }

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <SubScreenHeader title="스케줄러" homePath="/(teacher)/today-schedule" />
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  if (viewMode === "daily" && selectedGroup) {
    const g = selectedGroup;
    const diarDone = todayDiarySet.has(g.id);

    const classDone = (() => {
      const m = g.schedule_time?.match(/(\d+):(\d+)\s*[-~]\s*(\d+):(\d+)/);
      if (!m) return false;
      const now = new Date();
      return now.getHours() * 60 + now.getMinutes() > parseInt(m[3]) * 60 + parseInt(m[4]);
    })();

    const otherGroups = groups.filter(og => og.id !== g.id);

    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <SubScreenHeader title={g.name} subtitle={`${g.schedule_days} · ${g.schedule_time}`}
          onBack={() => setSelectedGroup(null)} homePath="/(teacher)/today-schedule"
          rightSlot={
            <Pressable style={{ padding: 8 }} onPress={() => { setDeletingClass(g); setShowDeleteClassConfirm(true); }}>
              <Feather name="trash-2" size={18} color="#E11D48" />
            </Pressable>
          } />
        <View style={s.subHeader}>
          <Pressable style={[s.subActionBtn, { backgroundColor: "#E6FFFA", flex: 1 }]}
            onPress={() => router.push(`/class-assign?classId=${g.id}` as any)}>
            <Feather name="users" size={13} color="#4338CA" />
            <Text style={[s.subActionText, { color: "#4338CA" }]}>반배정</Text>
          </Pressable>
          <Pressable style={[s.subActionBtn, { backgroundColor: diarDone ? "#E6FFFA" : "#FFF1BF", flex: 1 }]}
            onPress={() => router.push({ pathname:"/(teacher)/diary", params:{classGroupId: g.id, className: g.name} } as any)}>
            <Feather name="edit-3" size={13} color={diarDone ? "#2EC4B6" : "#D97706"} />
            <Text style={[s.subActionText, { color: diarDone ? "#2EC4B6" : "#D97706" }]}>수업일지</Text>
          </Pressable>
        </View>

        <FlatList data={groupStudents} keyExtractor={i => i.id}
          contentContainerStyle={s.studentList} showsVerticalScrollIndicator={false}
          extraData={[dayViewAttState, dayMakeups]}
          ListEmptyComponent={<View style={s.emptyBox}><Feather name="users" size={32} color={C.textMuted} /><Text style={s.emptyText}>배정된 학생이 없습니다</Text></View>}
          ListHeaderComponent={<Text style={s.listHeader}>학생 {groupStudents.length}명</Text>}
          ListFooterComponent={
            <View style={{ marginTop: 16 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#D96C6C" }} />
                <Text style={s.listHeader}>보강 대기 {dayMakeups.length}명</Text>
                {dayMakeupsLoading && <ActivityIndicator size="small" color="#D96C6C" />}
              </View>
              {dayMakeups.length === 0 && !dayMakeupsLoading && (
                <Text style={{ fontSize: 12, color: C.textMuted, paddingLeft: 4 }}>결석 처리 시 자동으로 추가됩니다</Text>
              )}
              {dayMakeups.map(mk => (
                <View key={mk.id} style={[s.studentRow, { backgroundColor: "#FDEAEA" }]}>
                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: "#D96C6C", marginRight: 2 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.studentName, { color: "#D96C6C" }]}>{mk.student_name}</Text>
                    <Text style={s.studentSub}>결석일 {mk.absence_date} · 보강 대기 중</Text>
                  </View>
                  <View style={[s.stBtn, { backgroundColor: "#FDEAEA", borderColor: "#D96C6C" }]}>
                    <Text style={[s.stBtnTxt, { color: "#D96C6C" }]}>대기</Text>
                  </View>
                </View>
              ))}
            </View>
          }
          renderItem={({ item }) => {
            const attStatus = dayViewAttState[item.id];
            const isAbsent  = attStatus === "absent";
            const isPresent = attStatus === "present";
            const saving    = dayViewAttSaving.has(item.id);

            return (
              <View style={[s.studentRow, { backgroundColor: C.card }]}>
                <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6 }}>
                  {isAbsent && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: "#D96C6C" }} />}
                  <View style={{ flex: 1 }}>
                    <Text style={[s.studentName,
                      classDone && { textDecorationLine: "line-through", color: C.textSecondary }
                    ]}>{item.name}</Text>
                    <Text style={s.studentSub}>주 {item.weekly_count || 1}회</Text>
                  </View>
                </View>

                <View style={{ flexDirection: "row", gap: 4 }}>
                  <Pressable
                    disabled={saving}
                    style={[s.stBtn, isPresent && { backgroundColor: "#E6FFFA", borderColor: "#2EC4B6" }]}
                    onPress={() => markDayAtt(item.id, "present")}>
                    {saving && !isPresent
                      ? <ActivityIndicator size="small" color="#2EC4B6" style={{ width: 20 }} />
                      : <Text style={[s.stBtnTxt, { color: isPresent ? "#2EC4B6" : C.textMuted }]}>출석</Text>}
                  </Pressable>
                  <Pressable
                    disabled={saving}
                    style={[s.stBtn, isAbsent && { backgroundColor: "#FDEAEA", borderColor: "#D96C6C" }]}
                    onPress={() => markDayAtt(item.id, "absent")}>
                    {saving && !isAbsent
                      ? <ActivityIndicator size="small" color="#D96C6C" style={{ width: 20 }} />
                      : <Text style={[s.stBtnTxt, { color: isAbsent ? "#D96C6C" : C.textMuted }]}>결석</Text>}
                  </Pressable>
                  <Pressable style={s.stBtn}
                    onPress={() => { setMoveStudent(item); setShowMoveSheet(true); }}>
                    <Text style={[s.stBtnTxt, { color: C.textSecondary }]}>반이동</Text>
                  </Pressable>
                </View>

                <Pressable onPress={() => router.push({ pathname:"/(teacher)/student-detail", params:{id: item.id} } as any)}
                  style={{ padding: 4 }}>
                  <Feather name="chevron-right" size={16} color={C.textMuted} />
                </Pressable>
              </View>
            );
          }}
        />

        <Modal visible={showMoveSheet} transparent animationType="slide"
          onRequestClose={() => { setShowMoveSheet(false); setMoveStudent(null); }}>
          <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)" }}
            onPress={() => { setShowMoveSheet(false); setMoveStudent(null); }} />
          <View style={{ backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 }}>
            <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: C.text, marginBottom: 4 }}>반이동</Text>
            <Text style={{ fontSize: 12, color: C.textSecondary, marginBottom: 16 }}>
              {moveStudent?.name} 학생을 이동할 반을 선택하세요
            </Text>
            {otherGroups.length === 0 && (
              <Text style={{ color: C.textMuted, fontSize: 13, textAlign: "center", paddingVertical: 20 }}>
                이동 가능한 다른 반이 없습니다
              </Text>
            )}
            {otherGroups.map(og => (
              <Pressable key={og.id} disabled={moveSheetSaving}
                style={{ flexDirection: "row", alignItems: "center", paddingVertical: 14,
                  borderBottomWidth: 1, borderBottomColor: "#F0EDE9" }}
                onPress={() => handleMoveToClass(og.id)}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text }}>{og.name}</Text>
                  <Text style={{ fontSize: 11, color: C.textSecondary, marginTop: 2 }}>{og.schedule_days} · {og.schedule_time}</Text>
                </View>
                {moveSheetSaving
                  ? <ActivityIndicator size="small" color={themeColor} />
                  : <Feather name="chevron-right" size={16} color={C.textMuted} />}
              </Pressable>
            ))}
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  const dayClasses = selectedDate ? classesForDate(groups, selectedDate) : [];

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="스케줄러" homePath="/(teacher)/today-schedule" />

      <View style={s.titleArea}>
        <View style={s.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>수업 스케줄러</Text>
            <Text style={s.titleSub}>
              {new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" })}
            </Text>
          </View>
          <View style={s.rightBtns}>
            {selectionMode ? (
              <>
                <Pressable style={[s.selBtn, { backgroundColor: selectedDates.size > 0 ? "#D96C6C" : "#9CA3AF" }]}
                  onPress={() => { if (selectedDates.size > 0) setShowDeleteConfirm(true); }}
                  disabled={deleting || selectedDates.size === 0}>
                  {deleting
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <><Feather name="trash-2" size={13} color="#fff" /><Text style={s.selBtnText}>메모삭제{selectedDates.size > 0 ? ` (${selectedDates.size})` : ""}</Text></>}
                </Pressable>
                <Pressable style={[s.selBtn, { backgroundColor: "#6B7280" }]}
                  onPress={() => { setSelectionMode(false); setSelectedIds(new Set()); setSelectedDates(new Set()); }}>
                  <Text style={s.selBtnText}>취소</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Pressable style={[s.selBtn, { backgroundColor: "#F8FAFC" }]} onPress={() => setSelectionMode(true)}>
                  <Feather name="check-square" size={13} color={C.textSecondary} />
                  <Text style={[s.selBtnText, { color: C.textSecondary }]}>선택</Text>
                </Pressable>
                <Pressable style={[s.mgmtBtn, { borderColor: themeColor }]} onPress={() => setShowManagement(true)}>
                  <Feather name="users" size={13} color={themeColor} />
                  <Text style={[s.mgmtBtnText, { color: themeColor }]}>수강생관리</Text>
                </Pressable>
                <Pressable style={[s.createBtn, { backgroundColor: themeColor }]} onPress={() => { setCreateInitialDays([]); setCreateInitialStep(1); setShowCreate(true); }}>
                  <Feather name="plus" size={14} color="#fff" />
                  <Text style={s.createBtnText}>반 등록</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>

        <View style={s.controlRow}>
          <View style={s.viewToggle}>
            {(["monthly","weekly","daily"] as ViewMode[]).map(mode => {
              const labels = { monthly: "월", weekly: "주", daily: "일" };
              const isActive = viewMode === mode;
              return (
                <Pressable key={mode}
                  style={[s.toggleBtn, isActive && { backgroundColor: themeColor, borderColor: themeColor }]}
                  onPress={() => { setViewMode(mode); setSelectionMode(false); setSelectedIds(new Set()); setSelectedDates(new Set()); if (mode !== "monthly") setSelectedDate(null); }}>
                  <Text style={[s.toggleText, isActive && { color: "#fff" }]}>{labels[mode]}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable style={[s.diaryIndexBtn, { borderColor: themeColor + "55", backgroundColor: themeColor + "12" }]}
            onPress={() => router.push("/(teacher)/diary-index" as any)}>
            <Feather name="book-open" size={13} color={themeColor} />
            <Text style={[s.diaryIndexBtnText, { color: themeColor }]}>수업 일지</Text>
          </Pressable>
        </View>
      </View>

      {viewMode === "monthly" && (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
          <MonthlyCalendar
            groups={groups}
            themeColor={themeColor}
            selectedDate={selectedDate}
            onSelectDate={handleDatePress}
            memoDateSet={memoDateSet}
            selectionMode={selectionMode}
            selectedDates={selectedDates}
          />
          <View style={{ height: 120 }} />
        </ScrollView>
      )}

      {viewMode === "weekly" && (
        <View style={{ flex: 1 }}>
          {groups.length === 0 && (
            <View style={s.emptyHintBanner}>
              <Text style={s.emptyHintText}>등록된 수업이 없습니다</Text>
            </View>
          )}
          <WeeklyTimetable
            groups={groups}
            onSelectClass={g => setDetailGroup(g)}
            selectionMode={selectionMode}
            selectedIds={selectedIds}
            toggleSelect={toggleSelect}
            weekStart={weeklyViewStart}
            changeLogs={weekChangeLogs}
            onPrevWeek={() => setWeeklyViewStart(prev => addDaysStr(prev, -7))}
            onNextWeek={() => setWeeklyViewStart(prev => addDaysStr(prev, 7))}
            students={students}
            statusMap={statusMap}
          />
        </View>
      )}

      {viewMode === "daily" && !selectedGroup && (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
          <WeeklySchedule
            classGroups={groups} statusMap={statusMap} onSelectClass={setSelectedGroup}
            themeColor={themeColor} selectionMode={selectionMode}
            selectedIds={selectedIds} onToggleSelect={toggleSelect} />
          <View style={{ height: 80 }} />
        </ScrollView>
      )}

      {viewMode === "monthly" && selectedDate && !detailGroup && !unregClassId && !removeClassGroup && (
        <DaySheet
          dateStr={selectedDate}
          classes={dayClasses}
          attMap={dayAttMap}
          diarySet={dayDiarySet}
          themeColor={themeColor}
          poolId={poolId}
          memo={dayMemo}
          onMemoChange={setDayMemo}
          onSaveMemo={() => saveMemo(selectedDate, dayMemo)}
          onClose={() => setSelectedDate(null)}
          onSelectClass={handleDaySheetClassPress}
          onOpenMakeup={handleDaySheetMakeup}
          onAddClass={() => {
            const koDay = selectedDate ? getKoDay(selectedDate) : null;
            const validDay = koDay && koDay !== "일" ? koDay : null;
            setCreateInitialDays(validDay ? [validDay] : []);
            setCreateInitialStep(validDay ? 2 : 1);
            setSelectedDate(null);
            setTimeout(() => setShowCreate(true), 200);
          }}
        />
      )}

      {detailGroup && (
        <ClassDetailSheet
          group={detailGroup}
          students={students}
          attMap={selectedDate ? dayAttMap : todayAttMap}
          diarySet={selectedDate ? dayDiarySet : todayDiarySet}
          themeColor={themeColor}
          date={selectedDate}
          token={token}
          classGroups={groups}
          onClose={() => setDetailGroup(null)}
          onDeleteClass={() => { const g = detailGroup; setDetailGroup(null); setTimeout(() => { setDeletingClass(g); setShowDeleteClassConfirm(true); }, 200); }}
          onNavigateTo={navigateFromSheet}
          weekChangeLogs={viewMode === "weekly" ? weekChangeLogs : undefined}
          onColorChange={(id, color) =>
            setGroups(prev => prev.map(g => g.id === id ? { ...g, color } : g))
          }
        />
      )}

      <StudentManagementSheet
        visible={showManagement}
        token={token}
        groups={groups}
        themeColor={themeColor}
        onClose={() => setShowManagement(false)}
        onAssignDone={() => { setShowManagement(false); setDetailGroup(null); setSelectedGroup(null); load(); }}
      />

      {showCreate && (
        <ClassCreateFlow
          token={token}
          role="teacher"
          selfTeacher={selfTeacher}
          initialDays={createInitialDays}
          initialStep={createInitialStep}
          onSuccess={(newGroup) => {
            const g = newGroup as TeacherClassGroup;
            setGroups(prev => [...prev, g]);
            setShowCreate(false);
            setTimeout(() => setDetailGroup(g), 300);
          }}
          onClose={() => setShowCreate(false)}
        />
      )}

      <ConfirmModal visible={showDeleteConfirm} title="메모 삭제"
        message={`선택한 날짜 ${selectedDates.size}일의 텍스트·음성 메모를 삭제하시겠습니까?\n수업·출결 데이터는 삭제되지 않습니다.`}
        confirmText="삭제" cancelText="취소" destructive
        onConfirm={confirmDeleteMemos} onCancel={() => setShowDeleteConfirm(false)} />
      <ConfirmModal visible={deleteFailCount > 0} title="일부 실패"
        message={`${deleteFailCount}개 반 삭제에 실패했습니다.`}
        confirmText="확인" onConfirm={() => setDeleteFailCount(0)} />

      {unregClassId && (
        <UnregisteredPickerModal token={token} classGroupId={unregClassId} themeColor={themeColor}
          onClose={() => setUnregClassId(null)}
          onAssigned={() => { setUnregClassId(null); load(); }} />
      )}

      {removeClassGroup && (
        <MoveToClassModal token={token} classGroup={removeClassGroup} classGroups={groups}
          students={students} themeColor={themeColor}
          onClose={() => setRemoveClassGroup(null)}
          onMoved={() => { setRemoveClassGroup(null); load(); }} />
      )}

      <ConfirmModal visible={showDeleteClassConfirm} title="반 삭제"
        message={`이 반을 삭제하면 다음 주부터 시간표에서 사라집니다.\n현재 소속 회원은 미배정으로 이동하며,\n기존 수업 기록과 일지는 유지됩니다.`}
        confirmText="반 삭제" cancelText="취소" destructive
        onConfirm={handleDeleteClass}
        onCancel={() => { setShowDeleteClassConfirm(false); setDeletingClass(null); }} />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#FAFBFC" },
  titleArea:    { backgroundColor: "#FAFBFC", borderBottomWidth: 0.5, borderBottomColor: "#E5E7EB",
                  paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  titleRow:     { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  title:        { fontSize: 19, fontFamily: "Inter_600SemiBold", color: "#111827" },
  titleSub:     { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  rightBtns:    { flexDirection: "row", gap: 4, alignItems: "center" },
  selBtn:       { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 7, borderRadius: 10 },
  selBtnText:   { fontSize: 12, fontFamily: "Inter_500Medium", color: "#fff" },
  mgmtBtn:      { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 7, borderRadius: 10, borderWidth: 1, backgroundColor: "#FAFBFC" },
  mgmtBtnText:  { fontSize: 12, fontFamily: "Inter_500Medium" },
  createBtn:    { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 },
  createBtnText:{ color: "#fff", fontSize: 13, fontFamily: "Inter_500Medium" },
  controlRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  viewToggle:   { flexDirection: "row", gap: 5 },
  toggleBtn:    { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#FAFBFC" },
  toggleText:   { fontSize: 12, fontFamily: "Inter_500Medium", color: "#9CA3AF" },
  diaryIndexBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  diaryIndexBtnText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  subHeader:    { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 12,
                  backgroundColor: "#FAFBFC", borderBottomWidth: 0.5, borderBottomColor: "#E5E7EB" },
  subActionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
                  gap: 5, paddingVertical: 9, borderRadius: 10 },
  subActionText:{ fontSize: 12, fontFamily: "Inter_600SemiBold" },
  studentList:  { padding: 12, gap: 8, paddingBottom: 120 },
  listHeader:   { fontSize: 12, fontFamily: "Inter_500Medium", color: C.textMuted, marginBottom: 4 },
  studentRow:   { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 14 },
  studentName:  { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  studentSub:   { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  stBtn:        { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8,
                  backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#E2DDD9" },
  stBtnTxt:     { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  emptyBox:     { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyText:    { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textMuted },
  emptyHintBanner: { paddingVertical: 6, paddingHorizontal: 14, backgroundColor: "#F1F5F9", borderBottomWidth: 1, borderBottomColor: "#F0EDE9", alignItems: "center" },
  emptyHintText:   { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textMuted },
});
