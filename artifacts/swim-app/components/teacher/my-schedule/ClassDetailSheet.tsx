import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import Colors from "@/constants/colors";
import { apiRequest } from "@/context/AuthContext";
import { TeacherClassGroup } from "@/components/teacher/WeeklySchedule";
import { WEEKLY_BADGE } from "@/utils/studentUtils";
import { ChangeLogItem, StudentItem, todayDateStr } from "./utils";

const C = Colors.light;

export default function ClassDetailSheet({
  group, students, attMap, diarySet, themeColor, date, onClose,
  onOpenUnreg, onOpenRemove, onNavigateTo, onDeleteClass, weekChangeLogs, token,
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
}) {
  const myLogs = useMemo(() =>
    (weekChangeLogs || []).filter(l => l.class_group_id === group.id),
    [weekChangeLogs, group.id]
  );

  const groupStudents = students.filter(st =>
    (Array.isArray(st.assigned_class_ids) && st.assigned_class_ids.includes(group.id))
    || st.class_group_id === group.id
  ).sort((a, b) => a.name.localeCompare(b.name));

  const diarDone = diarySet.has(group.id);

  const effectiveDate = date || todayDateStr();
  const [studentAttState, setStudentAttState] = useState<Record<string, "present" | "absent">>({});
  const [savingStudentId, setSavingStudentId] = useState<string | null>(null);

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

  async function toggleStudentAtt(studentId: string, currentStatus: "present" | "absent" | undefined) {
    const newStatus: "present" | "absent" = currentStatus === "absent" ? "present" : "absent";
    setSavingStudentId(studentId);
    try {
      await apiRequest(token, "/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_id: studentId, class_group_id: group.id, date: effectiveDate, status: newStatus }),
      });
      setStudentAttState(prev => ({ ...prev, [studentId]: newStatus }));
    } catch {}
    setSavingStudentId(null);
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={cds.backdrop} onPress={onClose}>
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
            <Pressable onPress={onClose} style={cds.closeBtn}>
              <Feather name="x" size={20} color={C.textSecondary} />
            </Pressable>
          </View>
          <View style={cds.actionRow}>
            <Pressable style={[cds.actionBtn, { backgroundColor: "#DDF2EF", flex: 1 }]}
              onPress={() => onNavigateTo?.(() => router.push(`/class-assign?classId=${group.id}` as any))}>
              <Feather name="users" size={13} color="#4338CA" />
              <Text style={[cds.actionText, { color: "#4338CA" }]}>반배정</Text>
            </Pressable>
            <Pressable style={[cds.actionBtn, { backgroundColor: diarDone ? "#DDF2EF" : "#FFF1BF", flex: 1 }]}
              onPress={() => onNavigateTo?.(() => router.push({ pathname:"/(teacher)/diary", params:{classGroupId: group.id, className: group.name} } as any))}>
              <Feather name="edit-3" size={13} color={diarDone ? "#1F8F86" : "#D97706"} />
              <Text style={[cds.actionText, { color: diarDone ? "#1F8F86" : "#D97706" }]}>수업일지</Text>
            </Pressable>
          </View>
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
              const isSaving  = savingStudentId === st.id;
              return (
                <View key={st.id} style={[cds.studentRow, isAbsent && { backgroundColor: "#FFF5F5" }]}>
                  {isAbsent && <View style={cds.absentDot} />}
                  <View style={{ flex: 1 }}>
                    <Text style={[cds.studentName, isAbsent && { color: "#D96C6C" }]}>{st.name}</Text>
                    <Text style={cds.studentSub}>주 {st.weekly_count || 1}회</Text>
                  </View>
                  {isSaving ? (
                    <ActivityIndicator size="small" color={themeColor} style={{ marginHorizontal: 8 }} />
                  ) : (
                    <View style={{ flexDirection: "row", gap: 4 }}>
                      <Pressable style={[cds.stBtn, !isAbsent && { backgroundColor: "#DDF2EF" }]}
                        onPress={() => !isAbsent && toggleStudentAtt(st.id, attStatus)}>
                        <Text style={[cds.stBtnTxt, { color: !isAbsent ? "#1F8F86" : C.textMuted }]}>출석</Text>
                      </Pressable>
                      <Pressable style={[cds.stBtn, isAbsent && { backgroundColor: "#F9DEDA" }]}
                        onPress={() => toggleStudentAtt(st.id, attStatus)}>
                        <Text style={[cds.stBtnTxt, { color: isAbsent ? "#D96C6C" : C.textMuted }]}>결석</Text>
                      </Pressable>
                      <Pressable style={[cds.stBtn, { backgroundColor: "#F6F3F1" }]}
                        onPress={() => onNavigateTo?.(() => router.push({ pathname:"/(teacher)/student-detail", params:{id: st.id} } as any))}>
                        <Text style={[cds.stBtnTxt, { color: C.textSecondary }]}>반이동</Text>
                      </Pressable>
                    </View>
                  )}
                  <Pressable onPress={() => onNavigateTo?.(() => router.push({ pathname:"/(teacher)/student-detail", params:{id: st.id} } as any))}
                    style={{ padding: 4 }}>
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
  );
}

const cds = StyleSheet.create({
  backdrop:     { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet:        { position: "absolute", bottom: 0, left: 0, right: 0,
                  backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
                  maxHeight: "75%", paddingBottom: 32 },
  handle:       { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB",
                  alignSelf: "center", marginTop: 10, marginBottom: 4 },
  sheetHeader:  { flexDirection: "row", alignItems: "flex-start", padding: 16, paddingTop: 8 },
  sheetTitle:   { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text },
  sheetSub:     { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted, marginTop: 2 },
  closeBtn:     { padding: 4 },
  deleteBtn:    { padding: 8, marginRight: 4 },
  actionRow:    { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  actionBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
                  paddingHorizontal: 10, paddingVertical: 10, borderRadius: 10 },
  actionText:   { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  sectionLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.textMuted,
                  paddingHorizontal: 16, marginBottom: 6 },
  studentScroll:{ flexShrink: 1 },
  studentRow:   { flexDirection: "row", alignItems: "center", gap: 8,
                  paddingHorizontal: 16, paddingVertical: 10,
                  borderTopWidth: 1, borderTopColor: "#F6F3F1" },
  absentDot:    { width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#D96C6C" },
  studentName:  { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  studentSub:   { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 1 },
  stBtn:        { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8,
                  backgroundColor: "#F6F3F1", borderWidth: 1, borderColor: "#E2DDD9" },
  stBtnTxt:     { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  empty:        { alignItems: "center", paddingVertical: 32, gap: 8 },
  emptyText:    { fontSize: 13, color: C.textMuted, fontFamily: "Inter_400Regular" },
});
