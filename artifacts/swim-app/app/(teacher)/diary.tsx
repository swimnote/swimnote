/**
 * (teacher)/diary.tsx — 선생님: 수영일지 작성 (반 단위)
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
interface DiaryEntry {
  id: string;
  class_group_id: string;
  title: string;
  lesson_content?: string | null;
  practice_goals?: string | null;
  good_points?: string | null;
  next_focus?: string | null;
  author_name?: string | null;
  created_at?: string | null;
  comment_count?: number;
}

const EMPTY_FORM = {
  title: "",
  lesson_content: "",
  practice_goals: "",
  good_points: "",
  next_focus: "",
};

export default function TeacherDiaryScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const [classes, setClasses]   = useState<ClassGroup[]>([]);
  const [diaries, setDiaries]   = useState<DiaryEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm]         = useState(EMPTY_FORM);
  const [saving, setSaving]     = useState(false);

  useEffect(() => {
    (async () => {
      const cr = await apiRequest(token, "/class-groups");
      const cls = await safeJson(cr);
      const list: ClassGroup[] = Array.isArray(cls) ? cls : [];
      setClasses(list);
      if (list.length) { setSelected(list[0].id); fetchDiaries(list[0].id); }
      setLoading(false);
    })();
  }, []);

  async function fetchDiaries(classId: string) {
    const r = await apiRequest(token, `/diary?class_group_id=${classId}`);
    const data = await safeJson(r);
    setDiaries(Array.isArray(data) ? data : []);
  }

  async function handleSave() {
    if (!form.title.trim()) { Alert.alert("입력 필요", "제목을 입력해주세요."); return; }
    if (!selected) return;
    setSaving(true);
    try {
      const r = await apiRequest(token, "/diary", {
        method: "POST",
        body: JSON.stringify({
          title: form.title,
          lesson_content: form.lesson_content || null,
          practice_goals: form.practice_goals || null,
          good_points: form.good_points || null,
          next_focus: form.next_focus || null,
          class_group_ids: [selected],
        }),
      });
      const data = await safeJson(r);
      if (!r.ok) throw new Error((data as any)?.error || "저장 실패");
      fetchDiaries(selected);
      setModalOpen(false);
      setForm(EMPTY_FORM);
      Alert.alert("완료", "수영일지가 작성되었습니다.");
    } catch (e: any) { Alert.alert("오류", e.message); }
    finally { setSaving(false); }
  }

  function openModal() { setForm(EMPTY_FORM); setModalOpen(true); }

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={themeColor} />;

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <View style={s.header}>
        <Text style={s.title}>수영일지</Text>
      </View>

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

      {/* 작성 버튼 */}
      <View style={s.actionBar}>
        <Text style={s.subLabel}>
          {classes.find(c => c.id === selected)?.name ?? ""} 일지 목록
        </Text>
        <Pressable onPress={openModal} style={[s.writeBtn, { backgroundColor: themeColor }]}>
          <Text style={s.writeBtnText}>+ 일지 작성</Text>
        </Pressable>
      </View>

      <FlatList
        data={diaries}
        keyExtractor={i => i.id}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        ListEmptyComponent={<Text style={s.empty}>작성된 일지가 없습니다.</Text>}
        renderItem={({ item }) => (
          <View style={s.card}>
            <Text style={s.cardTitle}>{item.title}</Text>
            {item.lesson_content ? (
              <Text style={s.cardContent} numberOfLines={2}>{item.lesson_content}</Text>
            ) : null}
            <Text style={s.cardMeta}>
              {item.author_name} · {item.created_at ? item.created_at.slice(0, 10) : ""}
              {(item.comment_count ?? 0) > 0 ? `  💬 ${item.comment_count}` : ""}
            </Text>
          </View>
        )}
      />

      {/* 작성 모달 */}
      <Modal visible={modalOpen} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
            <View style={s.modalHeader}>
              <Pressable onPress={() => setModalOpen(false)}>
                <Text style={{ color: "#6B7280", fontFamily: "Inter_500Medium" }}>취소</Text>
              </Pressable>
              <Text style={s.modalTitle}>수영일지 작성</Text>
              <Pressable onPress={handleSave} disabled={saving}>
                <Text style={{ color: themeColor, fontFamily: "Inter_700Bold" }}>
                  {saving ? "저장 중..." : "저장"}
                </Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
              <View>
                <Text style={s.label}>제목 <Text style={{ color: "#EF4444" }}>*</Text></Text>
                <TextInput
                  style={s.input}
                  value={form.title}
                  onChangeText={v => setForm(p => ({ ...p, title: v }))}
                  placeholder="예) 자유형 발차기 집중 훈련"
                />
              </View>
              <View>
                <Text style={s.label}>수업 내용</Text>
                <TextInput
                  style={[s.input, { height: 120, textAlignVertical: "top" }]}
                  value={form.lesson_content}
                  onChangeText={v => setForm(p => ({ ...p, lesson_content: v }))}
                  placeholder="오늘 진행한 수업 내용을 입력해주세요."
                  multiline numberOfLines={5}
                />
              </View>
              <View>
                <Text style={s.label}>잘한 점</Text>
                <TextInput
                  style={[s.input, { height: 80, textAlignVertical: "top" }]}
                  value={form.good_points}
                  onChangeText={v => setForm(p => ({ ...p, good_points: v }))}
                  placeholder="오늘 아이들이 잘한 점을 기록해주세요."
                  multiline numberOfLines={3}
                />
              </View>
              <View>
                <Text style={s.label}>다음 시간 집중 포인트</Text>
                <TextInput
                  style={[s.input, { height: 80, textAlignVertical: "top" }]}
                  value={form.next_focus}
                  onChangeText={v => setForm(p => ({ ...p, next_focus: v }))}
                  placeholder="다음 수업에서 집중할 부분을 적어주세요."
                  multiline numberOfLines={3}
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
  actionBar:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  subLabel:     { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#374151" },
  writeBtn:     { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  writeBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  card:         { backgroundColor: "#fff", borderRadius: 12, padding: 14, gap: 4 },
  cardTitle:    { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#111827" },
  cardContent:  { fontSize: 13, fontFamily: "Inter_400Regular", color: "#4B5563" },
  cardMeta:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 4 },
  empty:        { textAlign: "center", color: "#9CA3AF", fontFamily: "Inter_400Regular", marginTop: 40 },
  modalHeader:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  modalTitle:   { fontSize: 15, fontFamily: "Inter_700Bold", color: "#111827" },
  label:        { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#374151", marginBottom: 6 },
  input:        { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontFamily: "Inter_400Regular", fontSize: 14, color: "#111827" },
});
