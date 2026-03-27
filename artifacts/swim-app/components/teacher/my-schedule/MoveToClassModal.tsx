import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import Colors from "@/constants/colors";
import { apiRequest } from "@/context/AuthContext";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { TeacherClassGroup } from "@/components/teacher/types";
import { StudentItem } from "./utils";

const C = Colors.light;

export default function MoveToClassModal({
  token, classGroup, classGroups, students, themeColor, onClose, onMoved,
}: {
  token: string | null;
  classGroup: TeacherClassGroup;
  classGroups: TeacherClassGroup[];
  students: StudentItem[];
  themeColor: string;
  onClose: () => void;
  onMoved: () => void;
}) {
  const [step, setStep] = useState<"list" | "pick-class" | "confirm">("list");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<StudentItem | null>(null);
  const [fromClassId, setFromClassId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [conflictVisible, setConflictVisible] = useState(false);

  const teacherClassIds = new Set(classGroups.map(g => g.id));
  const eligible = students.filter(st => {
    const ids: string[] = Array.isArray(st.assigned_class_ids) ? st.assigned_class_ids : (st.class_group_id ? [st.class_group_id] : []);
    if (ids.includes(classGroup.id)) return false;
    return ids.some(id => teacherClassIds.has(id));
  }).sort((a, b) => a.name.localeCompare(b.name));
  const filtered = eligible.filter(st => !q || st.name.includes(q));

  function teacherClassesOf(st: StudentItem): TeacherClassGroup[] {
    const ids: string[] = Array.isArray(st.assigned_class_ids) ? st.assigned_class_ids : (st.class_group_id ? [st.class_group_id] : []);
    return classGroups.filter(g => ids.includes(g.id) && g.id !== classGroup.id);
  }
  function clsLabel(g: TeacherClassGroup) {
    const days = g.schedule_days.split(",").map(d => d.trim()).join("·");
    const [h, m] = g.schedule_time.split(":");
    return `${days} ${h}:${m}반`;
  }
  function handleSelectStudent(st: StudentItem) {
    setSelected(st);
    const fromCls = teacherClassesOf(st);
    if (fromCls.length === 1) { setFromClassId(fromCls[0].id); setStep("confirm"); }
    else { setFromClassId(null); setStep("pick-class"); }
  }
  async function doMove() {
    if (!selected || !fromClassId) return;
    setMoving(true);
    const res = await apiRequest(token, `/students/${selected.id}/move-class`, {
      method: "POST", body: JSON.stringify({
        from_class_id: fromClassId,
        to_class_id: classGroup.id,
        expected_updated_at: selected.updated_at ?? undefined,
      }),
    });
    setMoving(false);
    if (res.status === 409) { setConflictVisible(true); return; }
    onMoved();
  }

  const fromCls = classGroups.find(g => g.id === fromClassId);
  const confirmMsg = selected && fromCls
    ? `${selected.name} 회원을 ${clsLabel(fromCls)}에서 ${clsLabel(classGroup)}으로 이동하시겠습니까?`
    : "";

  return (
    <>
      <Modal visible animationType="slide" transparent onRequestClose={onClose}>
        <Pressable style={rm.backdrop} onPress={onClose} />
        <View style={rm.sheet}>
          <View style={rm.handle} />
          {step === "list" && (
            <>
              <View style={rm.header}>
                <View style={{ flex: 1 }}>
                  <Text style={rm.title}>반이동 — {clsLabel(classGroup)}</Text>
                  <Text style={rm.sub}>선택한 학생을 현재 반으로 이동합니다</Text>
                </View>
                <Pressable onPress={onClose} style={{ padding: 4 }}><Feather name="x" size={20} color={C.textSecondary} /></Pressable>
              </View>
              <View style={rm.searchBar}>
                <Feather name="search" size={14} color={C.textMuted} />
                <TextInput style={rm.searchInput} value={q} onChangeText={setQ} placeholder="이름 검색" placeholderTextColor={C.textMuted} />
                {!!q && <Pressable onPress={() => setQ("")}><Feather name="x" size={14} color={C.textMuted} /></Pressable>}
              </View>
              <ScrollView style={rm.list} showsVerticalScrollIndicator={false}>
                {filtered.length === 0 ? (
                  <View style={rm.empty}><Feather name="users" size={28} color={C.textMuted} /><Text style={rm.emptyTxt}>이동 가능한 학생이 없습니다</Text></View>
                ) : filtered.map(item => {
                  const fromClses = teacherClassesOf(item);
                  return (
                    <View key={item.id} style={rm.row}>
                      <View style={{ flex: 1 }}>
                        <Text style={rm.name}>{item.name}</Text>
                        <Text style={rm.weeklyBadge}>주 {item.weekly_count ?? 1}회</Text>
                        <Text style={rm.classSub} numberOfLines={2}>현재 반: {fromClses.map(clsLabel).join(" / ") || "—"}</Text>
                      </View>
                      <Pressable style={[rm.moveBtn, { borderColor: themeColor }]} onPress={() => handleSelectStudent(item)}>
                        <Text style={[rm.moveTxt, { color: themeColor }]}>이동</Text>
                      </Pressable>
                    </View>
                  );
                })}
                <View style={{ height: 40 }} />
              </ScrollView>
            </>
          )}
          {step === "pick-class" && selected && (
            <>
              <View style={rm.header}>
                <Pressable onPress={() => { setStep("list"); setSelected(null); }} style={{ padding: 4, marginRight: 8 }}>
                  <Feather name="arrow-left" size={20} color={C.textSecondary} />
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text style={rm.title}>어떤 반에서 제거할까요?</Text>
                  <Text style={rm.sub}>{selected.name} · 주 {selected.weekly_count ?? 1}회</Text>
                </View>
              </View>
              <ScrollView style={rm.list} showsVerticalScrollIndicator={false}>
                {teacherClassesOf(selected).map(g => (
                  <Pressable key={g.id} style={rm.pickRow} onPress={() => { setFromClassId(g.id); setStep("confirm"); }}>
                    <View style={{ flex: 1 }}>
                      <Text style={rm.pickName}>{clsLabel(g)}</Text>
                      <Text style={rm.pickSub}>이 반에서 {selected.name} 회원만 제거됩니다</Text>
                    </View>
                    <Feather name="chevron-right" size={18} color={C.textMuted} />
                  </Pressable>
                ))}
                <View style={{ height: 40 }} />
              </ScrollView>
            </>
          )}
        </View>
      </Modal>
      <ConfirmModal visible={step === "confirm" && !!selected && !!fromClassId}
        title="반이동 확인" message={confirmMsg} confirmText="이동" cancelText="취소"
        onConfirm={() => { setStep("list"); doMove(); }}
        onCancel={() => setStep(selected && teacherClassesOf(selected).length > 1 ? "pick-class" : "list")} />

      {conflictVisible && (
        <Modal visible animationType="fade" transparent onRequestClose={() => { setConflictVisible(false); onMoved(); }}>
          <Pressable style={rm.backdrop} onPress={() => { setConflictVisible(false); onMoved(); }} />
          <View style={{ position: "absolute", left: 24, right: 24, top: "35%", backgroundColor: "#fff", borderRadius: 14, padding: 24, alignItems: "center", shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 12, elevation: 10 }}>
            <Text style={{ fontSize: 17, fontWeight: "700", color: "#222", marginBottom: 8 }}>배정 상태가 변경되었습니다</Text>
            <Text style={{ fontSize: 14, color: "#555", textAlign: "center", marginBottom: 20 }}>다른 작업자가 먼저 처리했습니다.{"\n"}최신 목록으로 돌아갑니다.</Text>
            <Pressable
              onPress={() => { setConflictVisible(false); onMoved(); }}
              style={{ backgroundColor: themeColor, paddingHorizontal: 32, paddingVertical: 12, borderRadius: 8 }}
            >
              <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }}>확인</Text>
            </Pressable>
          </View>
        </Modal>
      )}
    </>
  );
}

const rm = StyleSheet.create({
  backdrop:    { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet:       { position: "absolute", bottom: 0, left: 0, right: 0,
                 backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
                 maxHeight: "80%", paddingBottom: 32 },
  handle:      { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginTop: 10, marginBottom: 4 },
  header:      { flexDirection: "row", alignItems: "flex-start", padding: 16, paddingTop: 8 },
  title:       { fontSize: 17, fontFamily: "Pretendard-Bold", color: C.text },
  sub:         { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 2 },
  searchBar:   { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16,
                 marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#F8FAFC", borderRadius: 10 },
  searchInput: { flex: 1, fontSize: 14, color: C.text, fontFamily: "Pretendard-Regular" },
  list:        { flexShrink: 1 },
  row:         { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: "#F8FAFC" },
  name:        { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: C.text },
  weeklyBadge: { fontSize: 12, fontFamily: "Pretendard-Bold", color: C.tint, marginTop: 2 },
  classSub:    { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 2 },
  moveBtn:     { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, minWidth: 52, alignItems: "center" },
  moveTxt:     { fontSize: 13, fontFamily: "Pretendard-Bold" },
  pickRow:     { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 16, borderTopWidth: 1, borderTopColor: "#F8FAFC" },
  pickName:    { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: C.text },
  pickSub:     { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 2 },
  empty:       { alignItems: "center", paddingVertical: 40, gap: 8 },
  emptyTxt:    { fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Regular" },
});
