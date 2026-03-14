/**
 * (teacher)/diary.tsx — 선생님: 수영일지 작성
 */
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView,
  Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiRequest, safeJson, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";

interface ClassGroup { id: string; name: string; }
interface Student { id: string; name: string; class_group_id?: string | null; }
interface DiaryEntry { id: string; student_id: string; date: string; content: string; student_name?: string; }

export default function TeacherDiaryScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const [classes, setClasses]   = useState<ClassGroup[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [diaries, setDiaries]   = useState<DiaryEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);
  const [modal, setModal]       = useState<Student | null>(null);
  const [form, setForm]         = useState({ date: new Date().toISOString().split("T")[0], content: "" });
  const [saving, setSaving]     = useState(false);

  useEffect(() => {
    (async () => {
      const [cr, sr] = await Promise.all([apiRequest(token, "/class-groups"), apiRequest(token, "/students")]);
      const [cls, sts] = await Promise.all([safeJson(cr), safeJson(sr)]);
      const list = Array.isArray(cls) ? cls : [];
      setClasses(list); setStudents(Array.isArray(sts) ? sts : []);
      if (list.length) { setSelected(list[0].id); fetchDiaries(list[0].id); }
      setLoading(false);
    })();
  }, []);

  async function fetchDiaries(classId: string) {
    const r = await apiRequest(token, `/diary?class_id=${classId}`);
    const data = await safeJson(r);
    setDiaries(Array.isArray(data) ? data : []);
  }

  async function handleSave() {
    if (!modal || !form.content.trim()) { Alert.alert("입력 필요", "내용을 입력해주세요."); return; }
    setSaving(true);
    try {
      const r = await apiRequest(token, "/diary", {
        method: "POST",
        body: JSON.stringify({ student_id: modal.id, date: form.date, content: form.content }),
      });
      const data = await safeJson(r);
      if (!r.ok) throw new Error(data.error);
      if (selected) fetchDiaries(selected);
      setModal(null); setForm({ date: new Date().toISOString().split("T")[0], content: "" });
      Alert.alert("완료", "수영일지가 작성되었습니다.");
    } catch (e: any) { Alert.alert("오류", e.message); }
    finally { setSaving(false); }
  }

  const visible = selected ? students.filter(st => st.class_group_id === selected) : [];

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={themeColor} />;

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <View style={s.header}><Text style={s.title}>수영일지</Text></View>

      {/* 반 탭 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.tabBar} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
        {classes.map(c => (
          <Pressable key={c.id} onPress={() => { setSelected(c.id); fetchDiaries(c.id); }}
            style={[s.tab, selected === c.id && { backgroundColor: themeColor, borderColor: themeColor }]}>
            <Text style={[s.tabText, selected === c.id && { color: "#fff" }]}>{c.name}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <FlatList
        data={visible}
        keyExtractor={i => i.id}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        ListEmptyComponent={<Text style={s.empty}>학생이 없습니다.</Text>}
        renderItem={({ item }) => {
          const entries = diaries.filter(d => d.student_id === item.id);
          return (
            <View style={s.card}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={s.name}>{item.name}</Text>
                <Pressable onPress={() => { setModal(item); setForm({ date: new Date().toISOString().split("T")[0], content: "" }); }}
                  style={[s.writeBtn, { backgroundColor: themeColor }]}>
                  <Text style={s.writeBtnText}>+ 작성</Text>
                </Pressable>
              </View>
              {entries.length > 0 && (
                <View style={{ marginTop: 8, gap: 4 }}>
                  {entries.slice(0, 2).map(e => (
                    <View key={e.id} style={s.diaryRow}>
                      <Text style={s.diaryDate}>{e.date}</Text>
                      <Text style={s.diaryContent} numberOfLines={1}>{e.content}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        }}
      />

      {/* 작성 모달 */}
      <Modal visible={!!modal} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
            <View style={s.modalHeader}>
              <Pressable onPress={() => setModal(null)}><Text style={{ color: "#6B7280", fontFamily: "Inter_500Medium" }}>취소</Text></Pressable>
              <Text style={s.modalTitle}>{modal?.name} 수영일지</Text>
              <Pressable onPress={handleSave} disabled={saving}>
                <Text style={{ color: themeColor, fontFamily: "Inter_700Bold" }}>{saving ? "저장 중..." : "저장"}</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
              <View>
                <Text style={s.label}>날짜</Text>
                <TextInput style={s.input} value={form.date} onChangeText={v => setForm(p => ({ ...p, date: v }))} placeholder="YYYY-MM-DD" />
              </View>
              <View>
                <Text style={s.label}>내용</Text>
                <TextInput
                  style={[s.input, { height: 160, textAlignVertical: "top" }]}
                  value={form.content} onChangeText={v => setForm(p => ({ ...p, content: v }))}
                  placeholder="오늘의 수업 내용, 아이의 발전 상황을 기록해주세요."
                  multiline numberOfLines={8}
                />
              </View>
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#F8FAFF" },
  header:       { padding: 16, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  title:        { fontSize: 17, fontFamily: "Inter_700Bold", color: "#111827" },
  tabBar:       { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  tab:          { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#fff" },
  tabText:      { fontSize: 13, fontFamily: "Inter_500Medium", color: "#374151" },
  card:         { backgroundColor: "#fff", borderRadius: 12, padding: 14 },
  name:         { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#111827" },
  writeBtn:     { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  writeBtnText: { color: "#fff", fontSize: 12, fontFamily: "Inter_600SemiBold" },
  diaryRow:     { flexDirection: "row", gap: 8, alignItems: "center" },
  diaryDate:    { fontSize: 11, color: "#9CA3AF", fontFamily: "Inter_500Medium", width: 80 },
  diaryContent: { fontSize: 13, color: "#374151", fontFamily: "Inter_400Regular", flex: 1 },
  empty:        { textAlign: "center", color: "#9CA3AF", fontFamily: "Inter_400Regular", marginTop: 40 },
  modalHeader:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  modalTitle:   { fontSize: 15, fontFamily: "Inter_700Bold", color: "#111827" },
  label:        { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#374151", marginBottom: 6 },
  input:        { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontFamily: "Inter_400Regular", fontSize: 14, color: "#111827" },
});
