import { ChevronRight, CircleAlert, Pencil, RotateCcw, Trash2, UserX, Users, X } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import Colors from "@/constants/colors";
import { apiRequest, clearApiCache } from "@/context/AuthContext";
import { TeacherClassGroup } from "@/components/teacher/types";
import PastelColorPicker from "@/components/common/PastelColorPicker";
import { WEEKLY_BADGE } from "@/utils/studentUtils";
import { ChangeLogItem, StudentItem, todayDateStr } from "./utils";

const C = Colors.light;

export default function ClassDetailSheet({
  group, students, attMap, diarySet, themeColor, date, onClose,
  onOpenUnreg, onOpenRemove, onNavigateTo, onDeleteClass, weekChangeLogs, token,
  classGroups, onColorChange, onCapacityChange,
}: {
  group: TeacherClassGroup;
  students: StudentItem[];
  attMap: Record<string, number>;
  diarySet: Set<string>;
  themeColor: string;
  date?: string | null;
  token: string | null;
  onClose: () => void;
  onOpenUnreg?: () => void;
  onOpenRemove?: () => void;
  onDeleteClass?: () => void;
  weekChangeLogs?: ChangeLogItem[];
  onNavigateTo?: (navigate: () => void) => void;
  classGroups?: TeacherClassGroup[];
  onColorChange?: (id: string, color: string) => void;
  onCapacityChange?: (id: string, capacity: number | null) => void;
}) {
  const myLogs = useMemo(() =>
    (weekChangeLogs || []).filter(l => l.class_group_id === group.id),
    [weekChangeLogs, group.id]
  );

  const effectiveDate = date || todayDateStr();
  const [studentAttState, setStudentAttState] = useState<Record<string, "present" | "absent">>({});
  const [savingStudentId, setSavingStudentId] = useState<string | null>(null);

  const [moveStudent, setMoveStudent] = useState<StudentItem | null>(null);
  const [movingToClassId, setMovingToClassId] = useState<string | null>(null);
  const [movingStudent, setMovingStudent] = useState(false);

  const [unassignStudent,    setUnassignStudent]    = useState<StudentItem | null>(null);
  const [showUnassignTiming, setShowUnassignTiming] = useState(false);
  const [unassigningStudent, setUnassigningStudent] = useState(false);

  // 보충수업 관련
  const [showMakeupPicker,        setShowMakeupPicker]        = useState(false);
  const [makeupList,              setMakeupList]              = useState<any[]>([]);
  const [makeupLoading,           setMakeupLoading]           = useState(false);
  const [makeupSaving,            setMakeupSaving]            = useState<string | null>(null);
  const [selectedMakeupStudent,   setSelectedMakeupStudent]   = useState<any | null>(null);

  // 이 반/날짜에 배정된 보강 학생
  const [makeupStudents,       setMakeupStudents]       = useState<any[]>([]);
  const [completingMakeupId,   setCompletingMakeupId]   = useState<string | null>(null);
  const [revertingMakeupId,    setRevertingMakeupId]    = useState<string | null>(null);

  const originalColorRef = useRef<string>(group.color || "#FFFFFF");
  const [draftColor, setDraftColor] = useState<string>(group.color || "#FFFFFF");
  const [colorSaving, setColorSaving] = useState(false);

  const originalCapacityRef = useRef<number | null>(group.capacity ?? null);
  const [draftCapacity, setDraftCapacity] = useState<string>(
    group.capacity != null ? String(group.capacity) : ""
  );

  function handleColorSelect(color: string) {
    setDraftColor(color);
  }

  async function handleClose() {
    const parsedCapacity = draftCapacity.trim() === "" ? null : parseInt(draftCapacity, 10);
    const capacityChanged = parsedCapacity !== originalCapacityRef.current;
    const colorChanged = draftColor !== originalColorRef.current;

    if (colorChanged || capacityChanged) {
      setColorSaving(true);
      try {
        const patch: Record<string, unknown> = {};
        if (colorChanged) patch.color = draftColor;
        if (capacityChanged) patch.capacity = parsedCapacity;
        await apiRequest(token, `/class-groups/${group.id}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        });
        if (colorChanged) {
          onColorChange?.(group.id, draftColor);
          originalColorRef.current = draftColor;
        }
        if (capacityChanged) {
          onCapacityChange?.(group.id, parsedCapacity);
          originalCapacityRef.current = parsedCapacity;
        }
      } catch (e) {
        console.error(e);
        setDraftColor(originalColorRef.current);
        setDraftCapacity(originalCapacityRef.current != null ? String(originalCapacityRef.current) : "");
      }
      setColorSaving(false);
    }
    onClose();
  }

  useEffect(() => {
    setStudentAttState({});
    if (!token) return;
    apiRequest(token, `/attendance?class_group_id=${group.id}&date=${effectiveDate}`)
      .then(r => r.ok ? r.json() : [])
      .then((arr: any[]) => {
        const map: Record<string, "present" | "absent"> = {};
        arr.forEach(r => { if (r.student_id && r.status) map[r.student_id] = r.status; });
        setStudentAttState(map);
      })
      .catch(() => {});
  }, [group.id, effectiveDate, token]);

  function loadMakeupStudents() {
    if (!token) return;
    apiRequest(token, `/teacher/makeups/by-class?class_group_id=${group.id}&date=${effectiveDate}`)
      .then(r => r.ok ? r.json() : [])
      .then(setMakeupStudents)
      .catch(() => {});
  }

  useEffect(() => {
    loadMakeupStudents();
  }, [group.id, effectiveDate, token]);

  async function completeMakeupDirect(mkId: string) {
    setCompletingMakeupId(mkId);
    try {
      const res = await apiRequest(token, `/teacher/makeups/${mkId}/complete-direct`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: effectiveDate, class_group_id: group.id }),
      });
      if (res.ok) {
        setMakeupStudents(prev => prev.filter(m => m.id !== mkId));
      }
    } catch {}
    setCompletingMakeupId(null);
  }

  function handleRevertMakeup(mk: any) {
    Alert.alert(
      "배정 취소",
      `${mk.student_name}의 보강 배정을 취소하고 보강 대기로 되돌리시겠습니까?\n\n결석 기록과 보강 권리는 유지됩니다.`,
      [
        { text: "닫기", style: "cancel" },
        {
          text: "배정 취소",
          style: "destructive",
          onPress: async () => {
            setRevertingMakeupId(mk.id);
            try {
              const res = await apiRequest(token, `/teacher/makeups/${mk.id}/revert`, { method: "PATCH" });
              const resBody = await res.json().catch(() => ({}));
              console.log(`[revert] id=${mk.id} status=${res.status}`, JSON.stringify(resBody));
              if (res.ok) {
                clearApiCache();
                setMakeupStudents(prev => prev.filter(m => m.id !== mk.id));
                setTimeout(() => loadMakeupStudents(), 300);
              } else {
                Alert.alert("오류", resBody?.error || "배정 취소에 실패했습니다.");
              }
            } catch {
              Alert.alert("오류", "네트워크 오류가 발생했습니다.");
            } finally {
              setRevertingMakeupId(null);
            }
          },
        },
      ]
    );
  }

  async function openMakeupPicker() {
    setSelectedMakeupStudent(null);
    setShowMakeupPicker(true);
    setMakeupLoading(true);
    try {
      const res = await apiRequest(token, "/teacher/makeups?status=pending");
      if (res.ok) setMakeupList(await res.json());
    } catch {}
    finally { setMakeupLoading(false); }
  }

  async function completeMakeupWithClass(mk: any, targetClassId: string) {
    if (makeupSaving) return;
    setMakeupSaving(mk.id);
    try {
      const assignRes = await apiRequest(token, `/teacher/makeups/${mk.id}/assign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class_group_id: targetClassId, assigned_date: effectiveDate }),
      });
      if (!assignRes.ok) {
        const body = await assignRes.json().catch(() => ({}));
        Alert.alert("처리 실패", body?.error || "보충수업 배정 중 오류가 발생했습니다.");
        return;
      }
      const completeRes = await apiRequest(token, `/admin/makeups/${mk.id}/complete`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (completeRes.ok) {
        setMakeupList(prev => prev.filter(m => m.id !== mk.id));
        setSelectedMakeupStudent(null);
        setShowMakeupPicker(false);
      } else {
        const body = await completeRes.json().catch(() => ({}));
        Alert.alert("처리 실패", body?.error || "보충수업 처리 중 오류가 발생했습니다. 다시 시도해주세요.");
      }
    } catch {
      Alert.alert("오류", "네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    }
    finally { setMakeupSaving(null); }
  }

  async function markAtt(studentId: string, newStatus: "present" | "absent"): Promise<boolean> {
    if (studentAttState[studentId] === newStatus) return true;
    setSavingStudentId(studentId);
    try {
      await apiRequest(token, "/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_id: studentId,
          class_group_id: group.id,
          date: effectiveDate,
          status: newStatus,
        }),
      });
      setStudentAttState(prev => ({ ...prev, [studentId]: newStatus }));
      setSavingStudentId(null);
      // 결석 처리 시 보강 학생 목록 즉시 새로고침
      if (newStatus === "absent") {
        loadMakeupStudents();
      }
      return true;
    } catch {
      setSavingStudentId(null);
      return false;
    }
  }

  async function doMoveStudent() {
    if (!moveStudent || !movingToClassId) return;
    setMovingStudent(true);
    try {
      const res = await apiRequest(token, `/students/${moveStudent.id}/move-class`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_class_id: group.id,
          to_class_id: movingToClassId,
        }),
      });
      if (res.ok) {
        setMoveStudent(null);
        setMovingToClassId(null);
      }
    } catch {}
    setMovingStudent(false);
  }

  async function doUnassignStudent(timing: "now" | "next_week" | "week_after") {
    if (!unassignStudent) return;
    setUnassigningStudent(true);
    try {
      const res = await apiRequest(token, `/students/${unassignStudent.id}/remove-from-class`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class_group_id: group.id,
          effective_timing: timing,
        }),
      });
      if (res.ok) {
        setShowUnassignTiming(false);
        setUnassignStudent(null);
        setMoveStudent(null);
      }
    } catch {}
    setUnassigningStudent(false);
  }

  const groupStudents = students
    .filter(st =>
      ((Array.isArray(st.assigned_class_ids) && st.assigned_class_ids.includes(group.id))
      || st.class_group_id === group.id)
      && (!st.class_enrolled_at || st.class_enrolled_at <= todayDateStr())
    )
    .sort((a, b) => {
      const aAbs = studentAttState[a.id] === "absent" ? 0 : 1;
      const bAbs = studentAttState[b.id] === "absent" ? 0 : 1;
      if (aAbs !== bAbs) return aAbs - bAbs;
      return a.name.localeCompare(b.name);
    });

  const diarDone = diarySet.has(group.id);
  const moveTargetClasses = (classGroups || []).filter(g => g.id !== group.id);

  return (
    <>
      <Modal visible animationType="slide" transparent onRequestClose={handleClose} statusBarTranslucent>
        <Pressable style={cds.backdrop} onPress={handleClose}>
          <Pressable style={cds.sheet} onPress={() => {}}>
            <View style={cds.handle} />
            <View style={cds.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={cds.sheetTitle}>{group.name}</Text>
                <Text style={cds.sheetSub}>{group.schedule_days.split(",").join("·")} · {group.schedule_time}</Text>
              </View>
              <Pressable style={cds.deleteBtn}
                onPress={() => onDeleteClass?.()}>
                <Trash2 size={15} color="#E11D48" />
              </Pressable>
              <Pressable onPress={handleClose} style={cds.closeBtn}>
                {colorSaving
                  ? <ActivityIndicator size="small" color={C.textSecondary} />
                  : <X size={20} color={C.textSecondary} />}
              </Pressable>
            </View>
            <View style={cds.actionRow}>
              <Pressable style={[cds.actionBtn, { backgroundColor: "#E6FFFA", flex: 1 }]}
                onPress={() => onNavigateTo?.(() => router.push({
                pathname: "/class-assign",
                params: {
                  classId: group.id,
                  initialClass: JSON.stringify({
                    id: group.id,
                    name: group.name,
                    schedule_days: group.schedule_days,
                    schedule_time: group.schedule_time,
                    instructor: group.instructor || null,
                    capacity: group.capacity ?? null,
                    level: group.level || null,
                  }),
                },
              } as any))}>
                <Users size={13} color="#4338CA" />
                <Text style={[cds.actionText, { color: "#4338CA" }]}>반배정</Text>
              </Pressable>
              <Pressable style={[cds.actionBtn, { backgroundColor: diarDone ? "#E6FFFA" : "#FFF1BF", flex: 1 }]}
                onPress={() => onNavigateTo?.(() => router.push({ pathname:"/(teacher)/diary", params:{classGroupId: group.id, className: group.name} } as any))}>
                <Pencil size={13} color={diarDone ? "#2EC4B6" : "#D97706"} />
                <Text style={[cds.actionText, { color: diarDone ? "#2EC4B6" : "#D97706" }]}>수업일지</Text>
              </Pressable>
              <Pressable style={[cds.actionBtn, { backgroundColor: "#EEF2FF", flex: 1 }]}
                onPress={() => onNavigateTo?.(() => router.push("/(teacher)/makeups?backTo=my-schedule" as any))}>
                <Users size={13} color="#4F46E5" />
                <Text style={[cds.actionText, { color: "#4F46E5" }]}>보충수업</Text>
              </Pressable>
            </View>
            <PastelColorPicker selected={draftColor} onSelect={handleColorSelect} />
            <View style={cds.capacityRow}>
              <View style={cds.capacityLabelRow}>
                <Users size={14} color={C.textSecondary} />
                <Text style={cds.capacityLabel}>정원</Text>
              </View>
              <View style={cds.capacityInputWrap}>
                <Pressable
                  style={cds.capacityBtn}
                  onPress={() => {
                    const cur = parseInt(draftCapacity || "0", 10);
                    if (cur > 1) setDraftCapacity(String(cur - 1));
                  }}
                >
                  <Text style={cds.capacityBtnTxt}>−</Text>
                </Pressable>
                <TextInput
                  style={cds.capacityInput}
                  value={draftCapacity}
                  onChangeText={v => setDraftCapacity(v.replace(/[^0-9]/g, ""))}
                  keyboardType="number-pad"
                  placeholder="없음"
                  placeholderTextColor={C.textMuted}
                  maxLength={3}
                />
                <Text style={cds.capacityUnit}>명</Text>
                <Pressable
                  style={cds.capacityBtn}
                  onPress={() => {
                    const cur = parseInt(draftCapacity || "0", 10);
                    setDraftCapacity(String(cur + 1));
                  }}
                >
                  <Text style={cds.capacityBtnTxt}>+</Text>
                </Pressable>
              </View>
            </View>
            <Text style={cds.sectionLabel}>학생 목록 · {effectiveDate}</Text>
            <ScrollView style={cds.studentScroll} showsVerticalScrollIndicator={false}>
              {groupStudents.length === 0 ? (
                <View style={cds.empty}>
                  <Users size={28} color={C.textMuted} />
                  <Text style={cds.emptyText}>배정된 학생이 없습니다</Text>
                </View>
              ) : groupStudents.map(st => {
                const wc = Math.min(st.weekly_count || 1, 3) as 1 | 2 | 3;
                const wb = WEEKLY_BADGE[wc];
                const attStatus = studentAttState[st.id];
                const isAbsent  = attStatus === "absent";
                const isPresent = attStatus === "present";
                const isSaving  = savingStudentId === st.id;
                return (
                  <View key={st.id} style={[cds.studentRow, isAbsent && { backgroundColor: "#FFF5F5" }]}>
                    {isAbsent && <View style={cds.absentDot} />}
                    <View style={{ flex: 1 }}>
                      <Text style={[cds.studentName, isAbsent && cds.absentStrike]}>{st.name}</Text>
                      <Text style={cds.studentSub}>주 {st.weekly_count || 1}회</Text>
                    </View>
                    {isSaving ? (
                      <ActivityIndicator size="small" color={themeColor} style={{ marginHorizontal: 8 }} />
                    ) : (
                      <View style={{ flexDirection: "row", gap: 4 }}>
                        <Pressable
                          style={[cds.stBtn, isPresent && { backgroundColor: "#E6FFFA", borderColor: "#2EC4B6" }]}
                          onPress={() => markAtt(st.id, "present")}
                        >
                          <Text style={[cds.stBtnTxt, { color: isPresent ? "#2EC4B6" : C.textMuted }]}>출석</Text>
                        </Pressable>
                        <Pressable
                          style={[cds.stBtn, isAbsent && { backgroundColor: "#F9DEDA", borderColor: "#D96C6C" }]}
                          onPress={() => markAtt(st.id, "absent")}
                        >
                          <Text style={[cds.stBtnTxt, { color: isAbsent ? "#D96C6C" : C.textMuted }]}>결석</Text>
                        </Pressable>
                        <Pressable
                          style={[cds.stBtn, { backgroundColor: "#F0F0FF" }]}
                          onPress={() => setMoveStudent(st)}
                        >
                          <Text style={[cds.stBtnTxt, { color: "#4338CA" }]}>반이동</Text>
                        </Pressable>
                      </View>
                    )}
                    <Pressable
                      onPress={() => onNavigateTo?.(() => router.push({ pathname:"/(teacher)/student-detail", params:{id: st.id} } as any))}
                      style={{ padding: 4 }}
                    >
                      <ChevronRight size={16} color={C.textMuted} />
                    </Pressable>
                  </View>
                );
              })}
              {makeupStudents.length > 0 && (
                <>
                  <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#7C3AED" }} />
                    <Text style={{ fontSize: 12, fontFamily: "Pretendard-SemiBold", color: "#7C3AED" }}>보강 학생</Text>
                  </View>
                  {makeupStudents.map(mk => (
                    <View key={mk.id} style={[cds.studentRow, { backgroundColor: "#F5F3FF", flexDirection: "column", alignItems: "stretch", paddingVertical: 10 }]}>
                      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <Text style={cds.studentName}>{mk.student_name}</Text>
                            <View style={{ backgroundColor: "#7C3AED", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                              <Text style={{ fontSize: 9, color: "#fff", fontFamily: "Pretendard-SemiBold" }}>보강</Text>
                            </View>
                          </View>
                          <Text style={cds.studentSub}>결석일: {mk.absence_date}</Text>
                        </View>
                      </View>
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        {completingMakeupId === mk.id ? (
                          <ActivityIndicator size="small" color="#7C3AED" style={{ marginHorizontal: 8 }} />
                        ) : (
                          <Pressable
                            style={[cds.stBtn, { backgroundColor: "#EDE9FE", borderColor: "#7C3AED", flex: 1 }]}
                            onPress={() => completeMakeupDirect(mk.id)}
                            disabled={revertingMakeupId === mk.id}
                          >
                            <Text style={[cds.stBtnTxt, { color: "#7C3AED" }]}>완료</Text>
                          </Pressable>
                        )}
                        {revertingMakeupId === mk.id ? (
                          <ActivityIndicator size="small" color="#D97706" style={{ marginHorizontal: 8 }} />
                        ) : (
                          <Pressable
                            style={[cds.stBtn, { backgroundColor: "#FFF8EE", borderColor: "#D97706", flex: 1 }]}
                            onPress={() => handleRevertMakeup(mk)}
                            disabled={completingMakeupId === mk.id}
                          >
                            <RotateCcw size={11} color="#D97706" />
                            <Text style={[cds.stBtnTxt, { color: "#D97706" }]}>배정 취소</Text>
                          </Pressable>
                        )}
                      </View>
                    </View>
                  ))}
                </>
              )}
              {myLogs.length > 0 && (
                <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
                  <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: "#D97706", marginBottom: 4 }}>
                    변경 이력
                  </Text>
                  {myLogs.map(log => {
                    const d = new Date(log.effective_date + "T12:00:00Z");
                    const dateLabel = `${d.getUTCMonth()+1}월 ${d.getUTCDate()}일`;
                    return (
                      <View key={log.id} style={{ flexDirection: "row", alignItems: "flex-start", gap: 6, marginBottom: 4 }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#FCD34D", marginTop: 5, borderWidth: 1, borderColor: "#D97706" }} />
                        <Text style={{ flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", color: "#92400E", lineHeight: 18 }}>
                          {dateLabel}: {log.note || log.change_type}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}
              <View style={{ height: 20 }} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {moveStudent && (
        <Modal visible animationType="slide" transparent onRequestClose={() => setMoveStudent(null)} statusBarTranslucent>
          <Pressable style={cds.backdrop} onPress={() => setMoveStudent(null)}>
            <Pressable style={[cds.sheet, { maxHeight: "55%" }]} onPress={() => {}}>
              <View style={cds.handle} />
              <View style={cds.sheetHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={cds.sheetTitle}>반이동</Text>
                  <Text style={cds.sheetSub}>{moveStudent.name} · 이동할 반을 선택하세요</Text>
                </View>
                <Pressable onPress={() => { setMoveStudent(null); setMovingToClassId(null); }} style={cds.closeBtn}>
                  <X size={20} color={C.textSecondary} />
                </Pressable>
              </View>
              <Pressable
                style={cds.unassignBtn}
                onPress={() => { setUnassignStudent(moveStudent); setShowUnassignTiming(true); }}
              >
                <UserX size={14} color="#D97706" />
                <Text style={cds.unassignBtnTxt}>미배정으로 이동</Text>
              </Pressable>

              <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false}>
                {moveTargetClasses.length === 0 ? (
                  <View style={cds.empty}>
                    <CircleAlert size={24} color={C.textMuted} />
                    <Text style={cds.emptyText}>이동 가능한 다른 반이 없습니다</Text>
                  </View>
                ) : moveTargetClasses.map(g => {
                  const isSelected = movingToClassId === g.id;
                  return (
                    <Pressable
                      key={g.id}
                      style={[cds.moveClassRow, isSelected && { backgroundColor: themeColor + "15", borderColor: themeColor }]}
                      onPress={() => setMovingToClassId(g.id)}
                    >
                      <LucideIcon
                        name={isSelected ? "check-circle" : "circle"}
                        size={16}
                        color={isSelected ? themeColor : C.textMuted}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={[cds.moveClassName, isSelected && { color: themeColor }]}>{g.name}</Text>
                        <Text style={cds.moveClassSub}>{g.schedule_days.split(",").join("·")} · {g.schedule_time}</Text>
                      </View>
                      <ChevronRight size={14} color={C.textMuted} />
                    </Pressable>
                  );
                })}
                <View style={{ height: 20 }} />
              </ScrollView>
              {movingToClassId && (
                <View style={{ paddingHorizontal: 16, paddingBottom: 16, paddingTop: 8 }}>
                  <Pressable
                    style={[cds.moveConfirmBtn, { backgroundColor: themeColor, opacity: movingStudent ? 0.6 : 1 }]}
                    onPress={doMoveStudent}
                    disabled={movingStudent}
                  >
                    {movingStudent
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={cds.moveConfirmTxt}>이동 확정</Text>
                    }
                  </Pressable>
                </View>
              )}
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* 보충수업 모달 (2단계) */}
      {showMakeupPicker && (
        <Modal visible animationType="slide" transparent onRequestClose={() => { setShowMakeupPicker(false); setSelectedMakeupStudent(null); }} statusBarTranslucent>
          <Pressable style={cds.backdrop} onPress={() => { setShowMakeupPicker(false); setSelectedMakeupStudent(null); }}>
            <Pressable style={[cds.sheet, { minHeight: "50%" }]} onPress={() => {}}>
              <View style={cds.handle} />
              {selectedMakeupStudent === null ? (
                /* 단계 1: 보강 대기 학생 선택 */
                <>
                  <View style={cds.sheetHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={cds.sheetTitle}>보충수업</Text>
                      <Text style={cds.sheetSub}>보강 대기 학생을 선택하세요</Text>
                    </View>
                    <Pressable onPress={() => setShowMakeupPicker(false)} style={cds.closeBtn}>
                      <X size={20} color={C.textSecondary} />
                    </Pressable>
                  </View>
                  {makeupLoading ? (
                    <View style={{ alignItems: "center", paddingVertical: 40 }}>
                      <ActivityIndicator color="#4F46E5" />
                    </View>
                  ) : makeupList.length === 0 ? (
                    <View style={cds.empty}>
                      <Users size={32} color={C.textMuted} />
                      <Text style={cds.emptyText}>보강 대기 중인 학생이 없습니다</Text>
                    </View>
                  ) : (
                    <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false}>
                      {makeupList.map((mk: any) => (
                        <Pressable
                          key={mk.id}
                          style={({ pressed }) => [cds.moveClassRow, pressed && { opacity: 0.7 }]}
                          onPress={() => setSelectedMakeupStudent(mk)}
                          disabled={!!makeupSaving}
                        >
                          <LucideIcon name="user" size={16} color={C.textMuted} />
                          <View style={{ flex: 1 }}>
                            <Text style={cds.moveClassName}>{mk.student_name}</Text>
                            <Text style={cds.moveClassSub}>결석일 {mk.absence_date}{mk.original_class_group_name ? ` · ${mk.original_class_group_name}` : ""}</Text>
                          </View>
                          <ChevronRight size={14} color={C.textMuted} />
                        </Pressable>
                      ))}
                      <View style={{ height: 20 }} />
                    </ScrollView>
                  )}
                </>
              ) : (
                /* 단계 2: 합류할 반 선택 */
                <>
                  <View style={cds.sheetHeader}>
                    <Pressable onPress={() => setSelectedMakeupStudent(null)} style={{ padding: 4, marginRight: 8 }}>
                      <Text style={{ fontSize: 14, color: "#4F46E5", fontFamily: "Pretendard-Regular" }}>← 뒤로</Text>
                    </Pressable>
                    <View style={{ flex: 1 }}>
                      <Text style={cds.sheetTitle}>{selectedMakeupStudent.student_name}</Text>
                      <Text style={cds.sheetSub}>합류할 반을 선택하세요</Text>
                    </View>
                    <Pressable onPress={() => { setShowMakeupPicker(false); setSelectedMakeupStudent(null); }} style={cds.closeBtn}>
                      <X size={20} color={C.textSecondary} />
                    </Pressable>
                  </View>
                  <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false}>
                    {/* 현재 반을 첫 번째로 표시 */}
                    {[group, ...(classGroups || []).filter(g => g.id !== group.id)].map((cls, idx) => {
                      const isSaving = makeupSaving === selectedMakeupStudent.id;
                      const isCurrentClass = cls.id === group.id;
                      return (
                        <Pressable
                          key={cls.id}
                          style={({ pressed }) => [
                            cds.moveClassRow,
                            isCurrentClass && { backgroundColor: "#EEF2FF", borderColor: "#C7D2FE" },
                            pressed && { opacity: 0.7 },
                          ]}
                          onPress={() => completeMakeupWithClass(selectedMakeupStudent, cls.id)}
                          disabled={isSaving}
                        >
                          <LucideIcon name={isCurrentClass ? "check-circle" : "circle"} size={16} color={isCurrentClass ? "#4F46E5" : C.textMuted} />
                          <View style={{ flex: 1 }}>
                            <Text style={[cds.moveClassName, isCurrentClass && { color: "#4F46E5" }]}>
                              {cls.name}{isCurrentClass ? " (현재 반)" : ""}
                            </Text>
                            <Text style={cds.moveClassSub}>{(cls.schedule_days || "").split(",").join("·")} {cls.schedule_time || ""}</Text>
                          </View>
                          {isSaving
                            ? <ActivityIndicator size="small" color="#4F46E5" />
                            : <ChevronRight size={14} color={C.textMuted} />
                          }
                        </Pressable>
                      );
                    })}
                    <View style={{ height: 20 }} />
                  </ScrollView>
                </>
              )}
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {showUnassignTiming && unassignStudent && (
        <Modal visible animationType="slide" transparent onRequestClose={() => setShowUnassignTiming(false)} statusBarTranslucent>
          <Pressable style={cds.backdrop} onPress={() => setShowUnassignTiming(false)}>
            <Pressable style={[cds.sheet, { maxHeight: "45%" }]} onPress={() => {}}>
              <View style={cds.handle} />
              <View style={[cds.sheetHeader, { paddingBottom: 12 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={cds.sheetTitle}>적용 시점 선택</Text>
                  <Text style={cds.sheetSub}>{unassignStudent.name} · 미배정으로 이동</Text>
                </View>
                <Pressable onPress={() => setShowUnassignTiming(false)} style={cds.closeBtn}>
                  <X size={20} color={C.textSecondary} />
                </Pressable>
              </View>
              {([
                { timing: "now"        as const, label: "오늘부터",     sub: "즉시 반 소속 해제" },
                { timing: "next_week"  as const, label: "다음 주부터",  sub: "다음 주 월요일부터 적용" },
                { timing: "week_after" as const, label: "다다음 주부터",sub: "다다음 주 월요일부터 적용" },
              ]).map(opt => (
                <Pressable
                  key={opt.timing}
                  style={[cds.timingRow, unassigningStudent && { opacity: 0.5 }]}
                  onPress={() => doUnassignStudent(opt.timing)}
                  disabled={unassigningStudent}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={cds.timingLabel}>{opt.label}</Text>
                    <Text style={cds.timingSub}>{opt.sub}</Text>
                  </View>
                  {unassigningStudent
                    ? <ActivityIndicator size="small" color="#D97706" />
                    : <ChevronRight size={16} color={C.textMuted} />
                  }
                </Pressable>
              ))}
              <View style={{ height: 20 }} />
            </Pressable>
          </Pressable>
        </Modal>
      )}

    </>
  );
}

const cds = StyleSheet.create({
  backdrop:        { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet:           { position: "absolute", bottom: 0, left: 0, right: 0,
                     backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
                     maxHeight: "75%", paddingBottom: 32 },
  handle:          { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB",
                     alignSelf: "center", marginTop: 10, marginBottom: 4 },
  sheetHeader:     { flexDirection: "row", alignItems: "flex-start", padding: 16, paddingTop: 8 },
  sheetTitle:      { fontSize: 17, fontFamily: "Pretendard-Regular", color: C.text },
  sheetSub:        { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 2 },
  closeBtn:        { padding: 4 },
  deleteBtn:       { padding: 8, marginRight: 4 },
  actionRow:       { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  actionBtn:       { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
                     paddingHorizontal: 10, paddingVertical: 10, borderRadius: 10 },
  actionText:      { fontSize: 13, fontFamily: "Pretendard-Regular" },
  sectionLabel:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted,
                     paddingHorizontal: 16, marginBottom: 6 },
  studentScroll:   { flexShrink: 1 },
  studentRow:      { flexDirection: "row", alignItems: "center", gap: 8,
                     paddingHorizontal: 16, paddingVertical: 10,
                     borderTopWidth: 1, borderTopColor: "#F8FAFC" },
  absentDot:       { width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#D96C6C" },
  absentStrike:    { color: "#D96C6C", textDecorationLine: "line-through" },
  studentName:     { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  studentSub:      { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 1 },
  stBtn:           { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8,
                     backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#E2DDD9" },
  stBtnTxt:        { fontSize: 11, fontFamily: "Pretendard-Regular" },
  empty:           { alignItems: "center", paddingVertical: 32, gap: 8 },
  emptyText:       { fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Regular" },
  moveClassRow:    { flexDirection: "row", alignItems: "center", gap: 10,
                     paddingHorizontal: 16, paddingVertical: 12,
                     borderTopWidth: 1, borderTopColor: "#F8FAFC",
                     borderWidth: 1, borderColor: "transparent", marginHorizontal: 12,
                     marginBottom: 4, borderRadius: 10 },
  moveClassName:   { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  moveClassSub:    { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 1 },
  moveConfirmBtn:  { height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  moveConfirmTxt:  { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" },
  unassignBtn:     { flexDirection: "row", alignItems: "center", gap: 8,
                     marginHorizontal: 12, marginBottom: 8,
                     paddingHorizontal: 14, paddingVertical: 12,
                     backgroundColor: "#FFF8EE", borderRadius: 10,
                     borderWidth: 1, borderColor: "#FCD34D" },
  unassignBtnTxt:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#D97706" },
  timingRow:       { flexDirection: "row", alignItems: "center", gap: 10,
                     paddingHorizontal: 16, paddingVertical: 14,
                     borderTopWidth: 1, borderTopColor: "#F8FAFC" },
  timingLabel:     { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  timingSub:       { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 },
  capacityRow:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                     paddingHorizontal: 16, paddingVertical: 10,
                     borderTopWidth: 1, borderTopColor: "#F1F5F9" },
  capacityLabelRow:{ flexDirection: "row", alignItems: "center", gap: 6 },
  capacityLabel:   { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  capacityInputWrap:{ flexDirection: "row", alignItems: "center", gap: 6 },
  capacityBtn:     { width: 28, height: 28, borderRadius: 8, backgroundColor: "#F1F5F9",
                     alignItems: "center", justifyContent: "center" },
  capacityBtnTxt:  { fontSize: 16, color: C.textSecondary, lineHeight: 20 },
  capacityInput:   { minWidth: 36, textAlign: "center", fontSize: 15,
                     fontFamily: "Pretendard-Regular", color: C.text, padding: 0 },
  capacityUnit:    { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
});
