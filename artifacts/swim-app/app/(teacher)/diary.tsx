/**
 * (teacher)/diary.tsx — 수영일지 탭
 *
 * 구조: WeeklySchedule → 반 선택 → 일지 작성/보기
 * B안: 기본 = 새 일지 작성, 상단 우측 "지난 일지" 버튼
 */
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView,
  Modal, Platform, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { PoolHeader } from "@/components/PoolHeader";
import { WeeklySchedule, TeacherClassGroup, SlotStatus } from "@/components/teacher/WeeklySchedule";

const C = Colors.light;

interface DiaryEntry {
  id: string;
  class_group_id: string;
  title: string;
  lesson_content?: string | null;
  practice_goals?: string | null;
  next_focus?: string | null;
  author_name?: string | null;
  created_at?: string | null;
  image_urls?: string[] | null;
}

type SubView = "write" | "history";

function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function TeacherDiaryScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const params = useLocalSearchParams<{ classGroupId?: string; className?: string }>();

  const [groups,      setGroups]      = useState<TeacherClassGroup[]>([]);
  const [diarySet,    setDiarySet]    = useState<Set<string>>(new Set());
  const [attMap,      setAttMap]      = useState<Record<string, number>>({});
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);

  const [selectedGroup, setSelectedGroup] = useState<TeacherClassGroup | null>(null);
  const [subView,       setSubView]       = useState<SubView>("write");

  // 일지 작성 폼
  const [form, setForm] = useState({ title: "", lesson_content: "", next_focus: "" });
  const [saving, setSaving] = useState(false);

  // 과거 일지 목록
  const [diaries,       setDiaries]       = useState<DiaryEntry[]>([]);
  const [diaryLoading,  setDiaryLoading]  = useState(false);

  const load = useCallback(async () => {
    const today = todayDateStr();
    try {
      const [cgRes, attRes, dRes] = await Promise.all([
        apiRequest(token, "/class-groups"),
        apiRequest(token, `/attendance?date=${today}`),
        apiRequest(token, `/diary?date=${today}`),
      ]);
      let groupsList: TeacherClassGroup[] = [];
      if (cgRes.ok)  { groupsList = await cgRes.json(); setGroups(groupsList); }
      if (attRes.ok) {
        const arr: any[] = await attRes.json();
        const map: Record<string, number> = {};
        arr.forEach(a => { const cid = a.class_group_id || a.class_id; if (cid) map[cid] = (map[cid] || 0) + 1; });
        setAttMap(map);
      }
      if (dRes.ok) {
        const arr: any[] = await dRes.json();
        setDiarySet(new Set(arr.map((d: any) => d.class_group_id).filter(Boolean)));
      }
      if (params.classGroupId) {
        const found = groupsList.find(g => g.id === params.classGroupId);
        if (found) openGroup(found);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function openGroup(group: TeacherClassGroup) {
    setSelectedGroup(group);
    setSubView("write");
    setForm({ title: "", lesson_content: "", next_focus: "" });
    // 직전 일지 미리 불러와 제목 템플릿
    loadDiaries(group.id);
  }

  async function loadDiaries(classId: string) {
    setDiaryLoading(true);
    try {
      const r = await apiRequest(token, `/diary?class_group_id=${classId}`);
      if (r.ok) {
        const data = await r.json();
        setDiaries(Array.isArray(data) ? data : []);
      }
    } catch (e) { console.error(e); }
    finally { setDiaryLoading(false); }
  }

  async function handleSave() {
    if (!form.title.trim()) { Alert.alert("입력 필요", "제목을 입력해주세요."); return; }
    if (!selectedGroup) return;
    setSaving(true);
    try {
      const r = await apiRequest(token, "/diary", {
        method: "POST",
        body: JSON.stringify({
          title: form.title,
          lesson_content: form.lesson_content || null,
          next_focus: form.next_focus || null,
          class_group_ids: [selectedGroup.id],
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "저장 실패");
      setDiarySet(prev => new Set([...prev, selectedGroup.id]));
      Alert.alert("저장 완료", "수영일지가 작성되었습니다.");
      setSelectedGroup(null);
    } catch (e: any) { Alert.alert("오류", e.message); }
    finally { setSaving(false); }
  }

  // statusMap
  const statusMap: Record<string, SlotStatus> = {};
  groups.forEach(g => {
    statusMap[g.id] = { attChecked: attMap[g.id] || 0, diaryDone: diarySet.has(g.id), hasPhotos: false };
  });

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <PoolHeader />
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  // ── 일지 작성/보기 서브뷰 ──────────────────────────────────
  if (selectedGroup) {
    const group = selectedGroup;
    const prevDiary = diaries[0]; // 가장 최근 일지

    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <PoolHeader />
        {/* 헤더 */}
        <View style={s.subHeader}>
          <Pressable style={s.backBtn} onPress={() => setSelectedGroup(null)}>
            <Feather name="arrow-left" size={20} color={C.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={s.subTitle}>{group.name} 수영일지</Text>
            <Text style={s.subSub}>{todayDateStr()} · {group.schedule_time}</Text>
          </View>
          {/* 지난 일지 토글 */}
          <Pressable
            style={[s.historyBtn, { backgroundColor: subView === "history" ? themeColor : C.background, borderColor: themeColor }]}
            onPress={() => setSubView(prev => prev === "history" ? "write" : "history")}
          >
            <Feather name="clock" size={13} color={subView === "history" ? "#fff" : themeColor} />
            <Text style={[s.historyBtnText, { color: subView === "history" ? "#fff" : themeColor }]}>지난 일지</Text>
          </Pressable>
        </View>

        {subView === "write" ? (
          // ── 새 일지 작성 ──
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
            <ScrollView contentContainerStyle={s.writeForm} showsVerticalScrollIndicator={false}>
              {/* 직전 일지 요약 (있는 경우) */}
              {prevDiary && (
                <View style={[s.prevDiarySummary, { borderColor: themeColor + "30", backgroundColor: themeColor + "08" }]}>
                  <View style={s.prevDiaryHeader}>
                    <Feather name="clock" size={12} color={themeColor} />
                    <Text style={[s.prevDiaryTitle, { color: themeColor }]}>직전 일지: {prevDiary.title}</Text>
                    <Pressable onPress={() => setSubView("history")}>
                      <Text style={[s.prevDiaryMore, { color: themeColor }]}>전체 보기 →</Text>
                    </Pressable>
                  </View>
                  {prevDiary.next_focus && (
                    <Text style={s.prevDiaryNext}>다음 수업 메모: {prevDiary.next_focus}</Text>
                  )}
                </View>
              )}

              <View style={s.formField}>
                <Text style={s.formLabel}>제목 *</Text>
                <TextInput
                  style={s.formInput}
                  value={form.title}
                  onChangeText={v => setForm(p => ({ ...p, title: v }))}
                  placeholder="예: 자유형 발차기 집중 훈련"
                  placeholderTextColor={C.textMuted}
                />
              </View>

              <View style={s.formField}>
                <Text style={s.formLabel}>오늘 수업 내용</Text>
                <TextInput
                  style={[s.formInput, { height: 100, textAlignVertical: "top" }]}
                  value={form.lesson_content}
                  onChangeText={v => setForm(p => ({ ...p, lesson_content: v }))}
                  placeholder="오늘 진행한 수업 내용을 입력하세요."
                  placeholderTextColor={C.textMuted}
                  multiline numberOfLines={4}
                />
              </View>

              <View style={s.formField}>
                <Text style={s.formLabel}>다음 수업 메모</Text>
                <TextInput
                  style={[s.formInput, { height: 70, textAlignVertical: "top" }]}
                  value={form.next_focus}
                  onChangeText={v => setForm(p => ({ ...p, next_focus: v }))}
                  placeholder="다음 수업에서 집중할 내용을 적어두세요."
                  placeholderTextColor={C.textMuted}
                  multiline numberOfLines={3}
                />
              </View>

              <View style={{ height: 120 }} />
            </ScrollView>

            {/* 저장 버튼 */}
            <View style={s.footer}>
              <Pressable style={[s.cancelBtn, { borderColor: C.border }]} onPress={() => setSelectedGroup(null)}>
                <Text style={[s.cancelBtnText, { color: C.textSecondary }]}>나가기</Text>
              </Pressable>
              <Pressable
                style={[s.saveBtn, { backgroundColor: themeColor, opacity: saving ? 0.7 : 1, flex: 2 }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? <ActivityIndicator color="#fff" size="small" />
                  : <><Feather name="save" size={16} color="#fff" /><Text style={s.saveBtnText}>저장</Text></>}
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        ) : (
          // ── 지난 일지 목록 ──
          <>
            {diaryLoading ? (
              <ActivityIndicator color={themeColor} style={{ marginTop: 40 }} />
            ) : (
              <FlatList
                data={diaries}
                keyExtractor={i => i.id}
                contentContainerStyle={s.diaryList}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                  <View style={s.emptyBox}>
                    <Feather name="book-open" size={32} color={C.textMuted} />
                    <Text style={s.emptyText}>작성된 일지가 없습니다</Text>
                  </View>
                }
                renderItem={({ item }) => (
                  <View style={[s.diaryCard, { backgroundColor: C.card }]}>
                    <View style={s.diaryCardHeader}>
                      <Text style={s.diaryCardTitle}>{item.title}</Text>
                      <Text style={s.diaryCardDate}>{item.created_at?.slice(0, 10)}</Text>
                    </View>
                    {item.lesson_content && (
                      <Text style={s.diaryCardContent} numberOfLines={2}>{item.lesson_content}</Text>
                    )}
                    {item.next_focus && (
                      <View style={s.diaryCardNext}>
                        <Feather name="arrow-right" size={11} color={themeColor} />
                        <Text style={[s.diaryCardNextText, { color: themeColor }]}>{item.next_focus}</Text>
                      </View>
                    )}
                  </View>
                )}
              />
            )}
          </>
        )}
      </SafeAreaView>
    );
  }

  // ── 메인 시간표 뷰 ──────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <PoolHeader />
      <View style={s.titleRow}>
        <Text style={s.title}>수영일지</Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        <WeeklySchedule
          classGroups={groups}
          statusMap={statusMap}
          onSelectClass={openGroup}
          themeColor={themeColor}
        />
        <View style={{ height: 120 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#F3F4F6" },
  titleRow:     { paddingHorizontal: 16, paddingVertical: 10 },
  title:        { fontSize: 20, fontFamily: "Inter_700Bold", color: "#111827" },

  subHeader:    { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  backBtn:      { width: 36, height: 36, borderRadius: 10, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  subTitle:     { fontSize: 16, fontFamily: "Inter_700Bold", color: "#111827" },
  subSub:       { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 1 },

  historyBtn:   { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1.5 },
  historyBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  prevDiarySummary: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
  prevDiaryHeader:  { flexDirection: "row", alignItems: "center", gap: 6 },
  prevDiaryTitle:   { flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold" },
  prevDiaryMore:    { fontSize: 11, fontFamily: "Inter_500Medium" },
  prevDiaryNext:    { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280" },

  writeForm:    { padding: 16, gap: 14, paddingBottom: 80 },
  formField:    { gap: 6 },
  formLabel:    { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#374151" },
  formInput:    { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827", backgroundColor: "#fff" },

  footer:       { flexDirection: "row", gap: 10, padding: 12, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  cancelBtn:    { flex: 1, height: 50, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  cancelBtnText:{ fontSize: 14, fontFamily: "Inter_600SemiBold" },
  saveBtn:      { flexDirection: "row", height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", gap: 8 },
  saveBtnText:  { color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },

  diaryList:    { padding: 12, gap: 10, paddingBottom: 120 },
  diaryCard:    { borderRadius: 14, padding: 14, gap: 6 },
  diaryCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  diaryCardTitle:  { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#111827" },
  diaryCardDate:   { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  diaryCardContent:{ fontSize: 13, fontFamily: "Inter_400Regular", color: "#4B5563" },
  diaryCardNext:   { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
  diaryCardNextText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium" },

  emptyBox:     { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyText:    { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
});
