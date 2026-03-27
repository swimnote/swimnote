import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import Colors from "@/constants/colors";
import { apiRequest } from "@/context/AuthContext";
import { TeacherClassGroup } from "@/components/teacher/types";
import PastelColorPicker from "@/components/common/PastelColorPicker";
import { WEEKLY_BADGE } from "@/utils/studentUtils";
import { ChangeLogItem, StudentItem, todayDateStr } from "./utils";

const C = Colors.light;

export default function ClassDetailSheet({
  group, students, attMap, diarySet, themeColor, date, onClose,
  onOpenUnreg, onOpenRemove, onNavigateTo, onDeleteClass, weekChangeLogs, token,
  classGroups, onColorChange,
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
}) {
  const myLogs = useMemo(() =>
    (weekChangeLogs || []).filter(l => l.class_group_id === group.id),
    [weekChangeLogs, group.id]
  );

  const effectiveDate = date || todayDateStr();
  const [studentAttState, setStudentAttState] = useState<Record<string, "present" | "absent">>({});
  const [savingStudentId, setSavingStudentId] = useState<string | null>(null);

  // 반이동 모달 상태
  const [moveStudent, setMoveStudent] = useState<StudentItem | null>(null);
  const [movingToClassId, setMovingToClassId] = useState<string | null>(null);
  const [movingStudent, setMovingStudent] = useState(false);

  // 미배정 이동 상태
  const [unassignStudent,    setUnassignStudent]    = useState<StudentItem | null>(null);
  const [showUnassignTiming, setShowUnassignTiming] = useState(false);
  const [unassigningStudent, setUnassigningStudent] = useState(false);

  // 반 색상 (draft: 즉시 프리뷰, 저장은 팝업 닫힐 때)
  const originalColorRef = useRef<string>(group.color || "#FFFFFF");
  const [draftColor, setDraftColor] = useState<string>(group.color || "#FFFFFF");
  const [colorSaving, setColorSaving] = useState(false);

  function handleColorSelect(color: string) {
    setDraftColor(color);
  }

  async function handleClose() {
    if (draftColor !== originalColorRef.current) {
      setColorSaving(true);
      try {
        await apiRequest(token, `/class-groups/${group.id}`, {
          method: "PATCH",
          body: JSON.stringify({ color: draftColor }),
        });
        onColorChange?.(group.id, draftColor);
        originalColorRef.current = draftColor;
      } catch (e) {
        console.error(e);
        setDraftColor(originalColorRef.current);
      }
      setColorSaving(false);
    }
    onClose();
  }

  useEffect(() => {
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

  // 출석/결석: 직접 지정 (toggle 아님)
  async function markAtt(studentId: string, newStatus: "present" | "absent") {
    if (studentAttState[studentId] === newStatus) return; // 이미 해당 상태면 무시
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
    } catch {}
    setSavingStudentId(null);
  }

  // 반이동 실행
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
          expected_updated_at: moveStudent.updated_at ?? undefined,
        }),
      });
      if (res.ok) {
        setMoveStudent(null);
        setMovingToClassId(null);
      }
    } catch {}
    setMovingStudent(false);
  }

  // 미배정으로 이동
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
          expected_updated_at: unassignStudent.updated_at ?? undefined,
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

  // 결석 학생 상단 정렬 → 결석 먼저, 이후 이름순
  const groupStudents = students
    .filter(st =>
      (Array.isArray(st.assigned_class_ids) && st.assigned_class_ids.includes(group.id))
      || st.class_group_id === group.id
    )
    .sort((a, b) => {
      const aAbs = studentAttState[a.id] === "absent" ? 0 : 1;
      const bAbs = studentAttState[b.id] === "absent" ? 0 : 1;
      if (aAbs !== bAbs) return aAbs - bAbs;
      return a.name.localeCompare(b.name);
    });

  const diarDone = diarySet.has(group.id);

  // 반이동 대상 반 목록 (현재 반 제외)
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
                onPress={() => { onClose(); setTimeout(() => onDeleteClass?.(), 200); }}>
                <Feather name="trash-2" size={15} color="#E11D48" />
              </Pressable>
              <Pressable onPress={handleClose} style={cds.closeBtn}>
                {colorSaving
                  ? <ActivityIndicator size="small" color={C.textSecondary} />
                  : <Feather name="x" size={20} color={C.textSecondary} />}
              </Pressable>
            </View>
            <View style={cds.actionRow}>
              <Pressable style={[cds.actionBtn, { backgroundColor: "#E6FFFA", flex: 1 }]}
                onPress={() => onNavigateTo?.(() => router.push(`/class-assign?classId=${group.id}` as any))}>
                <Feather name="users" size={13} color="#4338CA" />
                <Text style={[cds.actionText, { color: "#4338CA" }]}>반배정</Text>
              </Pressable>
              <Pressable style={[cds.actionBtn, { backgroundColor: diarDone ? "#E6FFFA" : "#FFF1BF", flex: 1 }]}
                onPress={() => onNavigateTo?.(() => router.push({ pathname:"/(teacher)/diary", params:{classGroupId: group.id, className: group.name} } as any))}>
                <Feather name="edit-3" size={13} color={diarDone ? "#2EC4B6" : "#D97706"} />
                <Text style={[cds.actionText, { color: diarDone ? "#2EC4B6" : "#D97706" }]}>수업일지</Text>
              </Pressable>
            </View>
            {/* 반 색상 */}
            <PastelColorPicker selected={draftColor} onSelect={handleColorSelect} />
            <Text style={cds.sectionLabel}>학생 목록 · {effectiveDate}</Text>
            <ScrollView style={cds.studentScroll} showsVerticalScrollIndicator={false}>
              {groupStudents.length === 0 ? (
                <View style={cds.empty}>
                  <Feather name="users" size={28} color={C.textMuted} />
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
                        {/* 출석: 직접 present 설정, 페이지 이동 없음 */}
                        <Pressable
                          style={[cds.stBtn, isPresent && { backgroundColor: "#E6FFFA", borderColor: "#2EC4B6" }]}
                          onPress={() => markAtt(st.id, "present")}
                        >
                          <Text style={[cds.stBtnTxt, { color: isPresent ? "#2EC4B6" : C.textMuted }]}>출석</Text>
                        </Pressable>
                        {/* 결석: 직접 absent 설정 → API가 makeup_session 자동 생성, 페이지 이동 없음 */}
                        <Pressable
                          style={[cds.stBtn, isAbsent && { backgroundColor: "#F9DEDA", borderColor: "#D96C6C" }]}
                          onPress={() => markAtt(st.id, "absent")}
                        >
                          <Text style={[cds.stBtnTxt, { color: isAbsent ? "#D96C6C" : C.textMuted }]}>결석</Text>
                        </Pressable>
                        {/* 반이동: 모달 열기, 상세 이동 없음 */}
                        <Pressable
                          style={[cds.stBtn, { backgroundColor: "#F0F0FF" }]}
                          onPress={() => setMoveStudent(st)}
                        >
                          <Text style={[cds.stBtnTxt, { color: "#4338CA" }]}>반이동</Text>
                        </Pressable>
                      </View>
                    )}
                    {/* [>] 학생 상세 이동 */}
                    <Pressable
                      onPress={() => onNavigateTo?.(() => router.push({ pathname:"/(teacher)/student-detail", params:{id: st.id} } as any))}
                      style={{ padding: 4 }}
                    >
                      <Feather name="chevron-right" size={16} color={C.textMuted} />
                    </Pressable>
                  </View>
                );
              })}
              {myLogs.length > 0 && (
                <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#D97706", marginBottom: 4 }}>
                    변경 이력
                  </Text>
                  {myLogs.map(log => {
                    const d = new Date(log.effective_date + "T12:00:00Z");
                    const dateLabel = `${d.getUTCMonth()+1}월 ${d.getUTCDate()}일`;
                    return (
                      <View key={log.id} style={{ flexDirection: "row", alignItems: "flex-start", gap: 6, marginBottom: 4 }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#FCD34D", marginTop: 5, borderWidth: 1, borderColor: "#D97706" }} />
                        <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#92400E", lineHeight: 18 }}>
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

      {/* 반이동 모달: 학생 상세 이동 없이 반 선택 → API 호출 */}
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
                  <Feather name="x" size={20} color={C.textSecondary} />
                </Pressable>
              </View>
              {/* 미배정으로 이동 버튼 — 리스트 상단 고정 */}
              <Pressable
                style={cds.unassignBtn}
                onPress={() => { setUnassignStudent(moveStudent); setShowUnassignTiming(true); }}
              >
                <Feather name="user-x" size={14} color="#D97706" />
                <Text style={cds.unassignBtnTxt}>미배정으로 이동</Text>
              </Pressable>

              <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false}>
                {moveTargetClasses.length === 0 ? (
                  <View style={cds.empty}>
                    <Feather name="alert-circle" size={24} color={C.textMuted} />
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
                      <Feather
                        name={isSelected ? "check-circle" : "circle"}
                        size={16}
                        color={isSelected ? themeColor : C.textMuted}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={[cds.moveClassName, isSelected && { color: themeColor }]}>{g.name}</Text>
                        <Text style={cds.moveClassSub}>{g.schedule_days.split(",").join("·")} · {g.schedule_time}</Text>
                      </View>
                      <Feather name="chevron-right" size={14} color={C.textMuted} />
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

      {/* 미배정 적용 시점 선택 팝업 */}
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
                  <Feather name="x" size={20} color={C.textSecondary} />
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
                    : <Feather name="chevron-right" size={16} color={C.textMuted} />
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
  sheetTitle:      { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text },
  sheetSub:        { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted, marginTop: 2 },
  closeBtn:        { padding: 4 },
  deleteBtn:       { padding: 8, marginRight: 4 },
  actionRow:       { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  actionBtn:       { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
                     paddingHorizontal: 10, paddingVertical: 10, borderRadius: 10 },
  actionText:      { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  sectionLabel:    { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.textMuted,
                     paddingHorizontal: 16, marginBottom: 6 },
  studentScroll:   { flexShrink: 1 },
  studentRow:      { flexDirection: "row", alignItems: "center", gap: 8,
                     paddingHorizontal: 16, paddingVertical: 10,
                     borderTopWidth: 1, borderTopColor: "#F8FAFC" },
  absentDot:       { width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#D96C6C" },
  absentStrike:    { color: "#D96C6C", textDecorationLine: "line-through" },
  studentName:     { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  studentSub:      { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 1 },
  stBtn:           { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8,
                     backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#E2DDD9" },
  stBtnTxt:        { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  empty:           { alignItems: "center", paddingVertical: 32, gap: 8 },
  emptyText:       { fontSize: 13, color: C.textMuted, fontFamily: "Inter_400Regular" },
  moveClassRow:    { flexDirection: "row", alignItems: "center", gap: 10,
                     paddingHorizontal: 16, paddingVertical: 12,
                     borderTopWidth: 1, borderTopColor: "#F8FAFC",
                     borderWidth: 1, borderColor: "transparent", marginHorizontal: 12,
                     marginBottom: 4, borderRadius: 10 },
  moveClassName:   { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  moveClassSub:    { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 1 },
  moveConfirmBtn:  { height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  moveConfirmTxt:  { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  unassignBtn:     { flexDirection: "row", alignItems: "center", gap: 8,
                     marginHorizontal: 12, marginBottom: 8,
                     paddingHorizontal: 14, paddingVertical: 12,
                     backgroundColor: "#FFF8EE", borderRadius: 10,
                     borderWidth: 1, borderColor: "#FCD34D" },
  unassignBtnTxt:  { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#D97706" },
  timingRow:       { flexDirection: "row", alignItems: "center", gap: 10,
                     paddingHorizontal: 16, paddingVertical: 14,
                     borderTopWidth: 1, borderTopColor: "#F8FAFC" },
  timingLabel:     { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  timingSub:       { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
});
