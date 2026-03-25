import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest } from "@/context/AuthContext";
import { ScheduleItem } from "./types";

const C = Colors.light;

interface NearbyClass { id: string; name: string; schedule_time: string; teacher_name: string; student_count: number; }
interface AbsenceStudent { id: string; name: string; selected: boolean; }

export default function AbsenceModal({
  visible, item, date, token, themeColor, onClose, onDone,
}: {
  visible: boolean; item: ScheduleItem | null; date: string; token: string | null;
  themeColor: string; onClose: () => void; onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<"ask" | "select">("ask");
  const [loading, setLoading] = useState(false);
  const [students, setStudents] = useState<AbsenceStudent[]>([]);
  const [nearby, setNearby] = useState<NearbyClass[]>([]);
  const [selectedClass, setSelectedClass] = useState<string>("");
  const [result, setResult] = useState<string>("");

  useEffect(() => {
    if (!visible) { setStep("ask"); setResult(""); setStudents([]); setNearby([]); setSelectedClass(""); }
  }, [visible]);

  async function handleNoTransfer() {
    if (!item) return;
    setLoading(true);
    try {
      const res = await apiRequest(token, "/absences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pool_id: (item as any).pool_id || "", class_group_id: item.id, absence_date: date, absence_time: item.schedule_time }),
      });
      const data = await res.json();
      if (data.success) {
        setResult(`결근 처리 완료. 학생 ${data.affected_students}명이 미실시(선생님) 보강으로 이월되었습니다.`);
      } else {
        setResult("오류: " + (data.error || "처리 실패"));
      }
    } catch { setResult("처리 중 오류가 발생했습니다."); }
    finally { setLoading(false); }
  }
  async function handleHasTransfer() {
    if (!item) return;
    setLoading(true);
    try {
      const [stuRes, nearbyRes] = await Promise.all([
        apiRequest(token, `/class-groups/${item.id}/students`),
        apiRequest(token, `/absences/nearby?class_group_id=${item.id}&date=${date}&time=${item.schedule_time}`),
      ]);
      const stuData = stuRes.ok ? await stuRes.json() : [];
      const nearData = nearbyRes.ok ? await nearbyRes.json() : { classes: [] };
      const stuList = Array.isArray(stuData) ? stuData : (stuData.students || []);
      setStudents(stuList.map((s: any) => ({ id: s.id, name: s.name, selected: false })));
      setNearby(nearData.classes || []);
      setStep("select");
    } catch { setResult("조회 실패"); }
    finally { setLoading(false); }
  }
  async function handleSubmitTransfer() {
    if (!item) return;
    setLoading(true);
    try {
      const absRes = await apiRequest(token, "/absences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pool_id: (item as any).pool_id || "", class_group_id: item.id, absence_date: date, absence_time: item.schedule_time }),
      });
      const absData = await absRes.json();
      if (!absData.success) { setResult("결근 등록 실패: " + absData.error); setLoading(false); return; }
      const aid = absData.absence?.id;
      const transferIds = students.filter(s => s.selected).map(s => s.id);
      if (transferIds.length > 0 && selectedClass) {
        await apiRequest(token, `/absences/${aid}/transfer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transfer_student_ids: transferIds, to_class_group_id: selectedClass }),
        });
      }
      const remaining = students.filter(s => !s.selected).length;
      setResult(`처리 완료. 이동 ${transferIds.length}명, 미실시(선생님) ${remaining}명`);
    } catch { setResult("처리 중 오류"); }
    finally { setLoading(false); }
  }
  function toggleStudent(id: string) {
    setStudents(prev => prev.map(s => s.id === id ? { ...s, selected: !s.selected } : s));
  }

  if (!visible) return null;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={ab.overlay} onPress={onClose} />
      <View style={[ab.sheet, { paddingBottom: insets.bottom + 20 }]}>
        <View style={ab.handle} />
        {result ? (
          <View style={{ gap: 16, padding: 4 }}>
            <View style={[ab.resultBox, { backgroundColor: result.startsWith("오류") ? "#F9DEDA" : "#DDF2EF" }]}>
              <Feather name={result.startsWith("오류") ? "alert-circle" : "check-circle"} size={20}
                color={result.startsWith("오류") ? "#D96C6C" : "#1F8F86"} />
              <Text style={[ab.resultText, { color: result.startsWith("오류") ? "#D96C6C" : "#065F46" }]}>{result}</Text>
            </View>
            <Pressable style={[ab.btn, { backgroundColor: themeColor }]} onPress={() => { onDone(); onClose(); }}>
              <Text style={ab.btnText}>확인</Text>
            </Pressable>
          </View>
        ) : step === "ask" ? (
          <View style={{ gap: 16 }}>
            <Text style={ab.title}>결근 처리</Text>
            <View style={[ab.warnBox, { backgroundColor: "#FFF1BF" }]}>
              <Feather name="alert-triangle" size={16} color="#D97706" />
              <Text style={[ab.warnText, { color: "#92400E" }]}>
                {item?.name} 수업을 결근 처리합니다.{"\n"}옆 반 이동 수업하는 학생이 있습니까?
              </Text>
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable style={[ab.choiceBtn, { backgroundColor: "#F6F3F1", flex: 1 }]} onPress={handleNoTransfer} disabled={loading}>
                {loading ? <ActivityIndicator size="small" color="#6F6B68" /> : <>
                  <Feather name="x-circle" size={18} color="#6F6B68" />
                  <Text style={[ab.choiceBtnText, { color: "#1F1F1F" }]}>없음</Text>
                  <Text style={ab.choiceSub}>전원 미실시(선생님)</Text>
                </>}
              </Pressable>
              <Pressable style={[ab.choiceBtn, { backgroundColor: themeColor + "15", borderColor: themeColor, borderWidth: 1.5, flex: 1 }]} onPress={handleHasTransfer} disabled={loading}>
                {loading ? <ActivityIndicator size="small" color={themeColor} /> : <>
                  <Feather name="users" size={18} color={themeColor} />
                  <Text style={[ab.choiceBtnText, { color: themeColor }]}>있음</Text>
                  <Text style={ab.choiceSub}>학생 선택 → 옆 반 이동</Text>
                </>}
              </Pressable>
            </View>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={ab.title}>이동할 학생 및 반 선택</Text>
            <Text style={[ab.sectionLabel, { color: C.textSecondary }]}>이동할 학생 선택</Text>
            {students.map(s => (
              <Pressable key={s.id}
                style={[ab.studentRow, { backgroundColor: s.selected ? themeColor+"15" : C.background, borderColor: s.selected ? themeColor : C.border }]}
                onPress={() => toggleStudent(s.id)}>
                <Feather name={s.selected ? "check-square" : "square"} size={18} color={s.selected ? themeColor : C.textMuted} />
                <Text style={[ab.studentName, { color: C.text }]}>{s.name}</Text>
                <Text style={[ab.studentTag, { color: s.selected ? themeColor : C.textMuted }]}>{s.selected ? "이동" : "미실시"}</Text>
              </Pressable>
            ))}
            {nearby.length > 0 && (
              <>
                <Text style={[ab.sectionLabel, { color: C.textSecondary, marginTop: 12 }]}>이동할 반 선택</Text>
                {nearby.map(nc => (
                  <Pressable key={nc.id}
                    style={[ab.studentRow, { backgroundColor: selectedClass===nc.id ? themeColor+"15" : C.background, borderColor: selectedClass===nc.id ? themeColor : C.border }]}
                    onPress={() => setSelectedClass(nc.id)}>
                    <Feather name={selectedClass===nc.id ? "check-circle" : "circle"} size={18} color={selectedClass===nc.id ? themeColor : C.textMuted} />
                    <View style={{ flex: 1 }}>
                      <Text style={[ab.studentName, { color: C.text }]}>{nc.name}</Text>
                      <Text style={[ab.studentTag, { color: C.textSecondary }]}>{nc.schedule_time} · {nc.teacher_name} · {nc.student_count}명</Text>
                    </View>
                  </Pressable>
                ))}
              </>
            )}
            <Pressable style={[ab.btn, { backgroundColor: themeColor, marginTop: 16, opacity: loading ? 0.6 : 1 }]}
              onPress={handleSubmitTransfer} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={ab.btnText}>처리 완료</Text>}
            </Pressable>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const ab = StyleSheet.create({
  overlay:      { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:        { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 14, maxHeight: "85%" },
  handle:       { width: 36, height: 4, backgroundColor: "#E9E2DD", borderRadius: 2, alignSelf: "center", marginBottom: 4 },
  title:        { fontSize: 18, fontFamily: "Inter_700Bold", color: C.text },
  warnBox:      { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 14, borderRadius: 14 },
  warnText:     { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  choiceBtn:    { alignItems: "center", gap: 6, padding: 18, borderRadius: 16 },
  choiceBtnText:{ fontSize: 16, fontFamily: "Inter_700Bold" },
  choiceSub:    { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, textAlign: "center" },
  btn:          { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  btnText:      { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  sectionLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 8, marginBottom: 4 },
  studentRow:   { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1.5, marginBottom: 6 },
  studentName:  { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  studentTag:   { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  resultBox:    { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 16, borderRadius: 14 },
  resultText:   { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", lineHeight: 22 },
});
