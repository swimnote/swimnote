import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";

/** eligible-occurrences API 응답 단일 회차 */
interface MakeupOccurrence {
  class_group_id: string;
  class_name: string;
  occurrence_date: string;   // YYYY-MM-DD (서버 계약 필드명 고정)
  schedule_time: string;
  teacher_id?: string | null;
  teacher_name?: string | null;
  is_mine: boolean;
  available_slots: number;
  is_full: boolean;
  is_past: boolean;
  is_today: boolean;
  is_future: boolean;
}
import {
  ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import Colors from "@/constants/colors";
import { LucideIcon } from "@/components/common/LucideIcon";
import { ChevronRight, CircleAlert, Users, UserX, X } from "lucide-react-native";
import { apiRequest, clearApiCache } from "@/context/AuthContext";
import { TeacherClassGroup } from "@/components/teacher/types";
import PastelColorPicker from "@/components/common/PastelColorPicker";
import { SubSheetModal } from "@/components/common/SubSheetModal";
import { WEEKLY_BADGE } from "@/utils/studentUtils";
import { ChangeLogItem, StudentItem, todayDateStr } from "./utils";

const C = Colors.light;

export default function ClassDetailSheet({
  group, students, attMap, diarySet, themeColor, date, onClose,
  onOpenUnreg, onOpenRemove, onNavigateTo, onDeleteClass, weekChangeLogs, token,
  classGroups, onColorChange, onCapacityChange, onStudentsChanged,
  studentsByDate, studentsByDateError, onRetryStudentsByDate,
  studentListMode, classGroupsLoadState, onRetryClassGroups,
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
  onNavigateTo?: (navigate: () => void, groupIdToRestore?: string) => void;
  /** null = 아직 로딩 중 또는 에러 */
  classGroups?: TeacherClassGroup[] | null;
  onColorChange?: (id: string, color: string) => void;
  onCapacityChange?: (id: string, capacity: number | null) => void;
  /** 서버 날짜 API로 사전 필터된 학생 목록 (있으면 내부 filter 대신 사용) */
  studentsByDate?: StudentItem[];
  /** true = 날짜 기준 학생명단 API 조회 실패 (로딩 중과 구분) */
  studentsByDateError?: boolean;
  /** 학생명단 조회 실패 시 재시도 콜백 */
  onRetryStudentsByDate?: () => void;
  /**
   * "historical": studentsByDate===undefined → 로딩, fallback 금지; studentsByDateError=true → 에러 UI
   * "current"   : students prop 기반 client-side 필터
   * (미지정)    : 기존 호환 동작
   */
  studentListMode?: "historical" | "current";
  /** 전체 반 목록 로드 상태 */
  classGroupsLoadState?: "loading" | "loaded" | "error";
  /** 반 목록 로드 실패 시 재시도 콜백 */
  onRetryClassGroups?: () => void;
  /** 반이동/미배정 성공 후 부모가 학생 목록을 재조회하도록 호출 */
  onStudentsChanged?: () => void;
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
  // 보강 회차 선택 (단계 3)
  const [selectedMakeupClassId,   setSelectedMakeupClassId]   = useState<string | null>(null);
  const [makeupOccurrences,       setMakeupOccurrences]       = useState<MakeupOccurrence[]>([]);
  const [makeupOccLoading,        setMakeupOccLoading]        = useState(false);
  const [makeupOccError,          setMakeupOccError]          = useState(false);
  // sequence ID — 늦게 도착한 이전 반 응답이 현재 반을 덮어쓰지 않도록
  const occSeqRef = useRef(0);

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
              const contentType = res.headers?.get?.("content-type") ?? "";
              const isJson = contentType.includes("application/json");
              const resBody = isJson ? await res.json().catch(() => ({})) : {};
              console.log(`[revert] id=${mk.id} http=${res.status} isJson=${isJson}`, JSON.stringify(resBody));
              if (res.ok && isJson && resBody?.success === true) {
                clearApiCache();
                setMakeupStudents(prev => prev.filter(m => m.id !== mk.id));
                setTimeout(() => loadMakeupStudents(), 300);
              } else if (!res.ok && isJson) {
                Alert.alert("오류", resBody?.error || "배정 취소에 실패했습니다.");
              } else {
                Alert.alert("오류", "서버 응답이 올바르지 않습니다. 잠시 후 다시 시도해주세요.");
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

  /** 보강 피커 관련 모든 상태를 초기화 (7가지 경로 공통) */
  function resetMakeupPickerState() {
    setSelectedMakeupStudent(null);
    setSelectedMakeupClassId(null);
    setMakeupOccurrences([]);
    setMakeupOccLoading(false);
    setMakeupOccError(false);
  }

  async function openMakeupPicker() {
    resetMakeupPickerState();
    setShowMakeupPicker(true);
    setMakeupLoading(true);
    try {
      const res = await apiRequest(token, "/teacher/makeups?status=pending");
      if (res.ok) setMakeupList(await res.json());
    } catch {}
    finally { setMakeupLoading(false); }
  }

  /** 단계 2→3: 반 선택 후 eligible-occurrences 조회 (sequence ID로 경쟁 방지) */
  async function selectMakeupClass(mk: any, targetClassId: string) {
    occSeqRef.current += 1;
    const mySeq = occSeqRef.current;
    setSelectedMakeupClassId(targetClassId);
    setMakeupOccLoading(true);
    setMakeupOccError(false);
    setMakeupOccurrences([]);
    try {
      const res = await apiRequest(token, `/teacher/makeups/${mk.id}/eligible-occurrences?class_group_id=${targetClassId}`);
      if (occSeqRef.current !== mySeq) return; // 늦게 도착한 이전 반 응답 무시
      if (res.ok) {
        const data = await res.json();
        setMakeupOccurrences((data.occurrences || []) as MakeupOccurrence[]);
      } else {
        setMakeupOccError(true);
      }
    } catch {
      if (occSeqRef.current === mySeq) setMakeupOccError(true);
    } finally {
      if (occSeqRef.current === mySeq) setMakeupOccLoading(false);
    }
  }

  /** 단계 3: 날짜 선택 후 저장 (미래=assign, 당일·과거=complete-direct) */
  async function completeMakeupWithDate(mk: any, _targetClassId: string, occ: MakeupOccurrence) {
    if (makeupSaving) return;
    // 서버 응답 occ의 class_group_id/occurrence_date를 신뢰 (_targetClassId는 화면 표시용)
    const { occurrence_date: occurrenceDate, class_group_id: occClassId, is_full: isFull, is_future: isFuture } = occ;

    const doSave = async () => {
      setMakeupSaving(mk.id);
      try {
        if (isFuture) {
          const res = await apiRequest(token, `/teacher/makeups/${mk.id}/assign`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ class_group_id: occClassId, assigned_date: occurrenceDate }),
          });
          if (res.ok) {
            setMakeupList(prev => prev.filter(m => m.id !== mk.id));
            resetMakeupPickerState(); setShowMakeupPicker(false);
            onStudentsChanged?.();
          } else {
            const body = await res.json().catch(() => ({}));
            Alert.alert("처리 실패", body?.message || body?.error || "보강 배정 중 오류가 발생했습니다.");
          }
        } else {
          const res = await apiRequest(token, `/teacher/makeups/${mk.id}/complete-direct`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date: occurrenceDate, class_group_id: occClassId }),
          });
          if (res.ok) {
            setMakeupList(prev => prev.filter(m => m.id !== mk.id));
            resetMakeupPickerState(); setShowMakeupPicker(false);
            onStudentsChanged?.();
          } else {
            const body = await res.json().catch(() => ({}));
            Alert.alert("처리 실패", body?.message || body?.error || "보강 처리 중 오류가 발생했습니다.");
          }
        }
      } catch {
        Alert.alert("오류", "네트워크 오류가 발생했습니다.");
      } finally { setMakeupSaving(null); }
    };

    if (isFuture && isFull) {
      Alert.alert("정원 부족", "이 반의 정원이 가득 찼습니다.\n미래 수업은 정원 여유가 있을 때 배정할 수 있습니다.");
      return;
    }
    if (!isFuture && isFull) {
      Alert.alert(
        "정원 초과",
        "정원을 초과한 반입니다.\n실제로 보강 수업에 참여한 경우에만 처리해 주세요.",
        [{ text: "취소", style: "cancel" }, { text: "그래도 처리", onPress: doSave }],
      );
      return;
    }
    await doSave();
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
          effective_date: effectiveDate,
        }),
      });
      if (res.ok) {
        setMoveStudent(null);
        setMovingToClassId(null);
        onStudentsChanged?.();
      } else {
        const body = await res.json().catch(() => ({}));
        const msg = body?.message || body?.error || `반이동 실패 (${res.status})`;
        Alert.alert("반이동 실패", msg);
      }
    } catch (e: any) {
      Alert.alert("오류", e?.message || "네트워크 오류가 발생했습니다.");
    }
    setMovingStudent(false);
  }

  async function doUnassignStudent(timing: "now" | "next_week" | "week_after") {
    if (!unassignStudent) return;
    setUnassigningStudent(true);
    try {
      const body: Record<string, string> = {
        class_group_id: group.id,
        effective_timing: timing,
      };
      // "now" 케이스에는 effective_date 전달 (history 기록용)
      if (timing === "now") body.effective_date = effectiveDate;

      const res = await apiRequest(token, `/students/${unassignStudent.id}/remove-from-class`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setShowUnassignTiming(false);
        setUnassignStudent(null);
        setMoveStudent(null);
        onStudentsChanged?.();
      } else {
        const errBody = await res.json().catch(() => ({}));
        const msg = errBody?.message || errBody?.error || `미배정 실패 (${res.status})`;
        Alert.alert("미배정 실패", msg);
      }
    } catch (e: any) {
      Alert.alert("오류", e?.message || "네트워크 오류가 발생했습니다.");
    }
    setUnassigningStudent(false);
  }

  // groupStudents:
  //   historical 모드:
  //     studentsByDateError=true → null (에러, 별도 렌더)
  //     studentsByDate===undefined → null (로딩 중)
  //     studentsByDate!==undefined → 목록 사용 (fallback 금지)
  //   current 모드 / 미지정: 기존 client-side 필터
  const groupStudents: StudentItem[] | null = (() => {
    let list: StudentItem[];
    if (studentListMode === "historical") {
      if (studentsByDateError) return null; // 에러 상태
      if (studentsByDate === undefined) return null; // 로딩 중
      list = [...studentsByDate];
    } else {
      // current 모드 또는 미지정 (기존 호환)
      list = studentsByDate
        ? [...studentsByDate]
        : students.filter(st =>
            ((Array.isArray(st.assigned_class_ids) && st.assigned_class_ids.includes(group.id))
            || st.class_group_id === group.id)
            && (!st.class_enrolled_at || st.class_enrolled_at <= todayDateStr())
          );
    }
    return list.sort((a, b) => {
      const aAbs = studentAttState[a.id] === "absent" ? 0 : 1;
      const bAbs = studentAttState[b.id] === "absent" ? 0 : 1;
      if (aAbs !== bAbs) return aAbs - bAbs;
      return a.name.localeCompare(b.name);
    });
  })();

  const diarDone = diarySet.has(group.id);
  // moveTargetClasses:
  //   null = 아직 로딩 중 또는 에러 (classGroupsLoadState !== "loaded" 또는 classGroups === null)
  //   []   = 로드 완료, 이동 가능한 다른 반 없음
  const moveTargetClasses: TeacherClassGroup[] | null =
    classGroupsLoadState !== "loaded" || classGroups == null
      ? null
      : classGroups.filter(g => g.id !== group.id);

  return (
    <>
      <Modal visible animationType="slide" transparent onRequestClose={handleClose} statusBarTranslucent>
        <Pressable style={cds.backdrop} onPress={handleClose}>
          <View style={cds.mainSheet} onStartShouldSetResponder={() => true}>
            <View style={cds.handle} />
            <View style={cds.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={cds.sheetTitle}>{group.name}</Text>
                <Text style={cds.sheetSub}>{group.schedule_days.split(",").join("·")} · {group.schedule_time}</Text>
              </View>
              <Pressable style={cds.deleteBtn}
                onPress={() => onDeleteClass?.()}>
                <LucideIcon name="trash-2" size={15} color="#E11D48" />
              </Pressable>
              <Pressable onPress={handleClose} style={cds.closeBtn}>
                {colorSaving
                  ? <ActivityIndicator size="small" color={C.textSecondary} />
                  : <LucideIcon name="x" size={20} color={C.textSecondary} />}
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
                <LucideIcon name="users" size={13} color="#4338CA" />
                <Text style={[cds.actionText, { color: "#4338CA" }]}>반배정</Text>
              </Pressable>
              <Pressable style={[cds.actionBtn, { backgroundColor: diarDone ? "#E6FFFA" : "#FFF1BF", flex: 1 }]}
                onPress={() => onNavigateTo?.(() => router.push({ pathname:"/(teacher)/diary", params:{classGroupId: group.id, className: group.name, lessonDate: effectiveDate, backTo: "my-schedule"} } as any), group.id)}>
                <LucideIcon name="edit" size={13} color={diarDone ? "#2EC4B6" : "#D97706"} />
                <Text style={[cds.actionText, { color: diarDone ? "#2EC4B6" : "#D97706" }]}>수업일지</Text>
              </Pressable>
              <Pressable style={[cds.actionBtn, { backgroundColor: "#EEF2FF", flex: 1 }]}
                onPress={() => onNavigateTo?.(() => router.push("/(teacher)/makeups?backTo=my-schedule" as any))}>
                <LucideIcon name="users" size={13} color="#4F46E5" />
                <Text style={[cds.actionText, { color: "#4F46E5" }]}>보충수업</Text>
              </Pressable>
            </View>
            <PastelColorPicker selected={draftColor} onSelect={handleColorSelect} />
            <View style={cds.capacityRow}>
              <View style={cds.capacityLabelRow}>
                <LucideIcon name="users" size={14} color={C.textSecondary} />
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
            <ScrollView
              style={cds.studentScroll}
              contentContainerStyle={cds.studentScrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {groupStudents === null && studentsByDateError ? (
                // historical 모드 — 에러 (로딩 중과 구분)
                <View style={cds.empty}>
                  <LucideIcon name="circle-alert" size={28} color={C.textMuted} />
                  <Text style={cds.emptyText}>학생 명단을 불러오지 못했습니다</Text>
                  {onRetryStudentsByDate && (
                    <Pressable onPress={onRetryStudentsByDate} style={{ marginTop: 8 }}>
                      <Text style={{ color: C.tint, fontSize: 13, fontFamily: "Pretendard-Regular" }}>재시도</Text>
                    </Pressable>
                  )}
                </View>
              ) : groupStudents === null ? (
                // historical 모드 — 로딩 중
                <View style={[cds.empty, { flexDirection: "row", gap: 8 }]}>
                  <ActivityIndicator size="small" color={C.tint} />
                  <Text style={cds.emptyText}>학생 목록 불러오는 중...</Text>
                </View>
              ) : groupStudents.length === 0 ? (
                <View style={cds.empty}>
                  <LucideIcon name="users" size={28} color={C.textMuted} />
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
                          onPress={() => {
                            setMoveStudent(st);
                          }}
                        >
                          <Text style={[cds.stBtnTxt, { color: "#4338CA" }]}>반이동</Text>
                        </Pressable>
                      </View>
                    )}
                    <Pressable
                      onPress={() => onNavigateTo?.(() => router.push({ pathname:"/(teacher)/student-detail", params:{id: st.id} } as any))}
                      style={{ padding: 4 }}
                    >
                      <LucideIcon name="chevron-right" size={16} color={C.textMuted} />
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
                            <LucideIcon name="rotate-ccw" size={11} color="#D97706" />
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
            </ScrollView>
          </View>
        </Pressable>

      {moveStudent && (
        <SubSheetModal
          visible
          onClose={() => { setMoveStudent(null); setMovingToClassId(null); }}
          height="55%"
          title="반이동"
          subtitle={`${moveStudent.name} · 이동할 반을 선택하세요`}
        >
          <Pressable
            style={cds.unassignBtn}
            onPress={() => { setUnassignStudent(moveStudent); setShowUnassignTiming(true); }}
          >
            <UserX size={14} color="#D97706" />
            <Text style={cds.unassignBtnTxt}>미배정으로 이동</Text>
          </Pressable>

          <ScrollView
            style={{ flex: 1, minHeight: 0 }}
            contentContainerStyle={{ paddingBottom: 20 }}
            showsVerticalScrollIndicator={false}
          >
            {moveTargetClasses === null ? (
              classGroupsLoadState === "error" ? (
                <View style={cds.empty}>
                  <CircleAlert size={24} color={C.textMuted} />
                  <Text style={cds.emptyText}>반 목록을 불러오지 못했습니다</Text>
                  {onRetryClassGroups && (
                    <Pressable onPress={onRetryClassGroups} style={{ marginTop: 8 }}>
                      <Text style={{ color: C.tint, fontSize: 13, fontFamily: "Pretendard-Regular" }}>재시도</Text>
                    </Pressable>
                  )}
                </View>
              ) : (
                <View style={[cds.empty, { flexDirection: "row", gap: 8 }]}>
                  <ActivityIndicator size="small" color={C.tint} />
                  <Text style={cds.emptyText}>반 목록 불러오는 중...</Text>
                </View>
              )
            ) : moveTargetClasses.length === 0 ? (
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
        </SubSheetModal>
      )}

      {/* 보충수업 모달 (3단계) — 헤더가 단계별로 달라 title 생략, 각 단계 헤더를 children 으로 제공 */}
      {showMakeupPicker && (
        <SubSheetModal
          visible
          onClose={() => { setShowMakeupPicker(false); resetMakeupPickerState(); }}
          height="60%"
        >
          {selectedMakeupStudent === null ? (
            /* 단계 1: 보강 대기 학생 선택 */
            <>
              <View style={cds.sheetHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={cds.sheetTitle}>보충수업</Text>
                  <Text style={cds.sheetSub}>보강 대기 학생을 선택하세요</Text>
                </View>
                <Pressable onPress={() => { setShowMakeupPicker(false); resetMakeupPickerState(); }} style={cds.closeBtn}>
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
                <ScrollView
                  style={{ flex: 1, minHeight: 0 }}
                  contentContainerStyle={{ paddingBottom: 20 }}
                  showsVerticalScrollIndicator={false}
                >
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
                </ScrollView>
              )}
            </>
          ) : selectedMakeupClassId === null ? (
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
                <Pressable onPress={() => { setShowMakeupPicker(false); resetMakeupPickerState(); }} style={cds.closeBtn}>
                  <X size={20} color={C.textSecondary} />
                </Pressable>
              </View>
              <ScrollView
                style={{ flex: 1, minHeight: 0 }}
                contentContainerStyle={{ paddingBottom: 20 }}
                showsVerticalScrollIndicator={false}
              >
                {/* 현재 반을 첫 번째로 표시 */}
                {[group, ...(classGroups || []).filter(g => g.id !== group.id)].map((cls) => {
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
                      onPress={() => selectMakeupClass(selectedMakeupStudent, cls.id)}
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
              </ScrollView>
            </>
          ) : (
            /* 단계 3: 날짜 선택 (eligible-occurrences 기반) */
            <>
              <View style={cds.sheetHeader}>
                <Pressable onPress={() => setSelectedMakeupClassId(null)} style={{ padding: 4, marginRight: 8 }}>
                  <Text style={{ fontSize: 14, color: "#4F46E5", fontFamily: "Pretendard-Regular" }}>← 뒤로</Text>
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text style={cds.sheetTitle}>{selectedMakeupStudent.student_name}</Text>
                  <Text style={cds.sheetSub}>보강 날짜를 선택하세요</Text>
                </View>
                <Pressable onPress={() => { setShowMakeupPicker(false); resetMakeupPickerState(); }} style={cds.closeBtn}>
                  <X size={20} color={C.textSecondary} />
                </Pressable>
              </View>
              {makeupOccLoading ? (
                <View style={{ alignItems: "center", paddingVertical: 40 }}>
                  <ActivityIndicator color="#4F46E5" />
                </View>
              ) : makeupOccError ? (
                <View style={cds.empty}>
                  <LucideIcon name="circle-alert" size={28} color={C.textMuted} />
                  <Text style={cds.emptyText}>수업 회차를 불러오지 못했습니다</Text>
                  <Pressable onPress={() => selectMakeupClass(selectedMakeupStudent, selectedMakeupClassId)} style={{ marginTop: 8 }}>
                    <Text style={{ color: C.tint, fontSize: 13, fontFamily: "Pretendard-Regular" }}>재시도</Text>
                  </Pressable>
                </View>
              ) : makeupOccurrences.length === 0 ? (
                <View style={cds.empty}>
                  <LucideIcon name="calendar-x" size={28} color={C.textMuted} />
                  <Text style={cds.emptyText}>배정 가능한 날짜가 없습니다</Text>
                </View>
              ) : (
                <ScrollView
                  style={{ flex: 1, minHeight: 0 }}
                  contentContainerStyle={{ paddingBottom: 20 }}
                  showsVerticalScrollIndicator={false}
                >
                  {(() => {
                    const past    = makeupOccurrences.filter((o: any) => o.is_past);
                    const today   = makeupOccurrences.filter((o: any) => o.is_today);
                    const future  = makeupOccurrences.filter((o: any) => o.is_future);
                    const days = ["일","월","화","수","목","금","토"];
                    function fmtOcc(dateStr: string) {
                      const d = new Date(dateStr + "T00:00:00");
                      return `${d.getMonth()+1}/${d.getDate()} (${days[d.getDay()]})`;
                    }
                    function renderOccRow(occ: MakeupOccurrence) {
                      const isSaving = makeupSaving === selectedMakeupStudent.id;
                      return (
                        <Pressable
                          key={occ.occurrence_date}
                          style={({ pressed }) => [cds.moveClassRow, pressed && { opacity: 0.7 }]}
                          onPress={() => completeMakeupWithDate(selectedMakeupStudent, selectedMakeupClassId!, occ)}
                          disabled={isSaving || (occ.is_full && occ.is_future)}
                        >
                          <LucideIcon name="calendar" size={16} color={occ.is_full && occ.is_future ? C.textMuted : "#4F46E5"} />
                          <View style={{ flex: 1 }}>
                            <Text style={[cds.moveClassName, (occ.is_full && occ.is_future) && { color: C.textMuted }]}>
                              {fmtOcc(occ.occurrence_date)}
                            </Text>
                          </View>
                          {occ.is_full && (
                            <View style={{ backgroundColor: occ.is_future ? "#F9DEDA" : "#FFF1BF", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginRight: 4 }}>
                              <Text style={{ fontSize: 10, fontFamily: "Pretendard-Regular", color: occ.is_future ? "#D96C6C" : "#D97706" }}>
                                {occ.is_future ? "정원마감" : "정원초과"}
                              </Text>
                            </View>
                          )}
                          {isSaving
                            ? <ActivityIndicator size="small" color="#4F46E5" />
                            : <ChevronRight size={14} color={occ.is_full && occ.is_future ? C.textMuted : C.textMuted} />
                          }
                        </Pressable>
                      );
                    }
                    return (
                      <>
                        {past.length > 0 && (
                          <>
                            <Text style={[cds.moveClassSub, { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, fontSize: 11, color: C.textMuted }]}>지난 수업</Text>
                            {past.map(renderOccRow)}
                          </>
                        )}
                        {today.length > 0 && (
                          <>
                            <Text style={[cds.moveClassSub, { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, fontSize: 11, color: "#2EC4B6" }]}>오늘</Text>
                            {today.map(renderOccRow)}
                          </>
                        )}
                        {future.length > 0 && (
                          <>
                            <Text style={[cds.moveClassSub, { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, fontSize: 11, color: C.textMuted }]}>예정 수업</Text>
                            {future.map(renderOccRow)}
                          </>
                        )}
                      </>
                    );
                  })()}
                </ScrollView>
              )}
            </>
          )}
        </SubSheetModal>
      )}

      {showUnassignTiming && unassignStudent && (
        <SubSheetModal
          visible
          onClose={() => setShowUnassignTiming(false)}
          maxHeight="45%"
          title="적용 시점 선택"
          subtitle={`${unassignStudent.name} · 미배정으로 이동`}
          headerPaddingBottom={12}
        >
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
        </SubSheetModal>
      )}

      </Modal>

    </>
  );
}

const cds = StyleSheet.create({
  backdrop:        { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  mainSheet:       { position: "absolute", bottom: 0, left: 0, right: 0,
                     backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
                     height: "75%" },
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
  studentScroll:      { flex: 1, minHeight: 0 },
  studentScrollContent: { paddingBottom: 48 },
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
