/**
 * (teacher)/diary.tsx — 선생님: 수영일지
 *
 * 기능:
 *  - 반 탭 → 일지 목록 조회
 *  - + 일지 작성 버튼 → 모달
 *  - 롱프레스 → 선택 모드 (다중 선택)
 *  - 선택 모드 툴바: 사진만 삭제 | 일지 삭제 | 취소
 */
import { Feather } from "@expo/vector-icons";
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
  image_urls?: string[] | null;
}

const EMPTY_FORM = { title: "", lesson_content: "" };
const DANGER = "#EF4444";
const AMBER  = "#F59E0B";

export default function TeacherDiaryScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();

  const [classes, setClasses]     = useState<ClassGroup[]>([]);
  const [diaries, setDiaries]     = useState<DiaryEntry[]>([]);
  const [selClass, setSelClass]   = useState<string | null>(null);
  const [loading, setLoading]     = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm]           = useState(EMPTY_FORM);
  const [saving, setSaving]       = useState(false);

  // 선택 모드
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected]     = useState<Set<string>>(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);

  useEffect(() => {
    (async () => {
      const cr = await apiRequest(token, "/class-groups");
      const cls = await safeJson(cr);
      const list: ClassGroup[] = Array.isArray(cls) ? cls : [];
      setClasses(list);
      if (list.length) { setSelClass(list[0].id); fetchDiaries(list[0].id); }
      setLoading(false);
    })();
  }, []);

  async function fetchDiaries(classId: string) {
    const r = await apiRequest(token, `/diary?class_group_id=${classId}`);
    const data = await safeJson(r);
    setDiaries(Array.isArray(data) ? data : []);
  }

  // ── 선택 모드 헬퍼 ────────────────────────────────────────────────
  function exitSelect() { setSelectMode(false); setSelected(new Set()); }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === diaries.length) setSelected(new Set());
    else setSelected(new Set(diaries.map(d => d.id)));
  }

  function enterSelectWith(diary: DiaryEntry) {
    setSelectMode(true);
    setSelected(new Set([diary.id]));
  }

  // ── 삭제 확인 (web: window.confirm, native: Alert) ───────────────
  function confirmAndRun(message: string, onConfirm: () => Promise<void>) {
    if (Platform.OS === "web") {
      if ((window as any).confirm(message)) onConfirm();
    } else {
      Alert.alert("확인", message, [
        { text: "취소", style: "cancel" },
        { text: "삭제", style: "destructive", onPress: onConfirm },
      ]);
    }
  }

  // ── 사진만 삭제 (선택 항목들) ────────────────────────────────────
  function bulkDeletePhotos() {
    const ids = [...selected];
    const withPhotos = ids.filter(id => {
      const d = diaries.find(x => x.id === id);
      return d?.image_urls && d.image_urls.length > 0;
    });
    if (!withPhotos.length) {
      if (Platform.OS === "web") (window as any).alert("선택한 일지에 사진이 없습니다.");
      else Alert.alert("알림", "선택한 일지에 사진이 없습니다.");
      return;
    }
    confirmAndRun(
      `선택한 ${ids.length}개 일지의 사진을 삭제하시겠습니까?\n(일지 내용은 유지됩니다)`,
      async () => {
        setBulkWorking(true);
        try {
          await Promise.all(withPhotos.map(id =>
            apiRequest(token, `/diary/${id}/photos`, { method: "DELETE" })
          ));
          setDiaries(prev => prev.map(d =>
            withPhotos.includes(d.id) ? { ...d, image_urls: [] } : d
          ));
          exitSelect();
        } catch { Alert.alert("오류", "사진 삭제 중 오류가 발생했습니다."); }
        finally { setBulkWorking(false); }
      }
    );
  }

  // ── 일지 삭제 (선택 항목들) ──────────────────────────────────────
  function bulkDeleteDiaries() {
    const ids = [...selected];
    confirmAndRun(
      `선택한 ${ids.length}개 일지를 삭제하시겠습니까?\n(사진 포함 전체 삭제됩니다)`,
      async () => {
        setBulkWorking(true);
        try {
          await Promise.all(ids.map(id =>
            apiRequest(token, `/diary/${id}`, { method: "DELETE" })
          ));
          setDiaries(prev => prev.filter(d => !ids.includes(d.id)));
          exitSelect();
        } catch { Alert.alert("오류", "일지 삭제 중 오류가 발생했습니다."); }
        finally { setBulkWorking(false); }
      }
    );
  }

  // ── 일지 작성 ────────────────────────────────────────────────────
  function openModal() { setForm(EMPTY_FORM); setModalOpen(true); }

  async function handleSave() {
    if (!form.title.trim()) { Alert.alert("입력 필요", "제목을 입력해주세요."); return; }
    if (!selClass) return;
    setSaving(true);
    try {
      const r = await apiRequest(token, "/diary", {
        method: "POST",
        body: JSON.stringify({
          title: form.title,
          lesson_content: form.lesson_content || null,
          class_group_ids: [selClass],
        }),
      });
      const data = await safeJson(r);
      if (!r.ok) throw new Error((data as any)?.error || "저장 실패");
      fetchDiaries(selClass);
      setModalOpen(false);
      setForm(EMPTY_FORM);
      Alert.alert("완료", "수영일지가 작성되었습니다.");
    } catch (e: any) { Alert.alert("오류", e.message); }
    finally { setSaving(false); }
  }

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={themeColor} />;

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      {/* 헤더 */}
      <View style={s.header}>
        <Text style={s.title}>수영일지</Text>
      </View>

      {/* 반 탭 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.tabBar} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
        {classes.map(c => (
          <Pressable key={c.id}
            onPress={() => {
              exitSelect();
              setSelClass(c.id);
              fetchDiaries(c.id);
            }}
            style={[s.tab, selClass === c.id && { backgroundColor: themeColor, borderColor: themeColor }]}>
            <Text style={[s.tabText, selClass === c.id && { color: "#fff" }]}>{c.name}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* 액션 바 */}
      <View style={s.actionBar}>
        {selectMode ? (
          /* 선택 모드 툴바 */
          <View style={s.toolbar}>
            {/* 전체 선택 */}
            <Pressable onPress={toggleAll} style={s.toolbarLeft}>
              <Feather
                name={selected.size === diaries.length ? "check-square" : "square"}
                size={18} color={themeColor}
              />
              <Text style={[s.toolbarToggleText, { color: themeColor }]}>
                {selected.size === diaries.length ? "전체 해제" : "전체 선택"}
              </Text>
            </Pressable>

            <Text style={s.toolbarCount}>{selected.size}개 선택</Text>

            <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
              {/* 사진만 삭제 */}
              <Pressable
                onPress={bulkDeletePhotos}
                disabled={selected.size === 0 || bulkWorking}
                style={[s.toolbarBtn, { backgroundColor: AMBER, opacity: selected.size === 0 ? 0.4 : 1 }]}
              >
                {bulkWorking
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <><Feather name="image" size={13} color="#fff" /><Text style={s.toolbarBtnText}>사진만 삭제</Text></>
                }
              </Pressable>
              {/* 일지 삭제 */}
              <Pressable
                onPress={bulkDeleteDiaries}
                disabled={selected.size === 0 || bulkWorking}
                style={[s.toolbarBtn, { backgroundColor: DANGER, opacity: selected.size === 0 ? 0.4 : 1 }]}
              >
                <Feather name="trash-2" size={13} color="#fff" />
                <Text style={s.toolbarBtnText}>일지 삭제</Text>
              </Pressable>
              {/* 취소 */}
              <Pressable onPress={exitSelect} style={s.toolbarCancel}>
                <Text style={s.toolbarCancelText}>취소</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          /* 기본 바 */
          <>
            <Text style={s.subLabel}>
              {classes.find(c => c.id === selClass)?.name ?? ""} 일지 목록
            </Text>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              {diaries.length > 0 && (
                <Pressable onPress={() => setSelectMode(true)} style={s.selectModeBtn}>
                  <Feather name="check-square" size={15} color={themeColor} />
                  <Text style={[s.selectModeBtnText, { color: themeColor }]}>선택</Text>
                </Pressable>
              )}
              <Pressable onPress={openModal} style={[s.writeBtn, { backgroundColor: themeColor }]}>
                <Text style={s.writeBtnText}>+ 일지 작성</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>

      {/* 일지 목록 */}
      <FlatList
        data={diaries}
        keyExtractor={i => i.id}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        ListEmptyComponent={<Text style={s.empty}>작성된 일지가 없습니다.</Text>}
        renderItem={({ item }) => {
          const isSelected = selected.has(item.id);
          const photoCount = Array.isArray(item.image_urls) ? item.image_urls.length : 0;
          return (
            <Pressable
              onPress={() => selectMode ? toggleSelect(item.id) : undefined}
              onLongPress={() => { if (!selectMode) enterSelectWith(item); }}
              style={[s.card, isSelected && s.cardSelected]}
            >
              {/* 선택 체크 */}
              {selectMode && (
                <View style={[s.checkCircle, isSelected && { backgroundColor: themeColor, borderColor: themeColor }]}>
                  {isSelected && <Feather name="check" size={11} color="#fff" />}
                </View>
              )}

              <Text style={s.cardTitle}>{item.title}</Text>
              {item.lesson_content ? (
                <Text style={s.cardContent} numberOfLines={2}>{item.lesson_content}</Text>
              ) : null}

              <View style={s.cardFooter}>
                <Text style={s.cardMeta}>
                  {item.author_name} · {item.created_at ? item.created_at.slice(0, 10) : ""}
                  {(item.comment_count ?? 0) > 0 ? `  💬 ${item.comment_count}` : ""}
                </Text>
                {photoCount > 0 && (
                  <View style={s.photoBadge}>
                    <Feather name="image" size={11} color={AMBER} />
                    <Text style={s.photoBadgeText}>{photoCount}</Text>
                  </View>
                )}
              </View>
            </Pressable>
          );
        }}
      />

      {/* 일지 작성 모달 */}
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
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: "#F8FAFF" },
  header: { padding: 16, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  title:  { fontSize: 17, fontFamily: "Inter_700Bold", color: "#111827" },

  tabBar: { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  tab:    { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#fff" },
  tabText:{ fontSize: 13, fontFamily: "Inter_500Medium", color: "#374151" },

  actionBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", minHeight: 52 },
  subLabel:  { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#374151" },

  // 선택 모드 진입 버튼
  selectModeBtn:     { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 5 },
  selectModeBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },

  writeBtn:     { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  writeBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },

  // 선택 모드 툴바
  toolbar:           { flex: 1, flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" },
  toolbarLeft:       { flexDirection: "row", alignItems: "center", gap: 4 },
  toolbarToggleText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  toolbarCount:      { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280", textAlign: "center" },
  toolbarBtn:        { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 18 },
  toolbarBtnText:    { color: "#fff", fontSize: 12, fontFamily: "Inter_600SemiBold" },
  toolbarCancel:     { paddingHorizontal: 6, paddingVertical: 6 },
  toolbarCancelText: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#6B7280" },

  // 카드
  card:        { backgroundColor: "#fff", borderRadius: 12, padding: 14, gap: 4 },
  cardSelected:{ borderWidth: 2, borderColor: "#1A5CFF", backgroundColor: "#EFF6FF" },
  cardTitle:   { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#111827", paddingRight: 28 },
  cardContent: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#4B5563" },
  cardFooter:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  cardMeta:    { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  photoBadge:  { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#FEF3C7", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  photoBadgeText: { fontSize: 11, fontFamily: "Inter_500Medium", color: "#92400E" },
  checkCircle: { position: "absolute", top: 12, right: 12, width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#D1D5DB", backgroundColor: "#F9FAFB", alignItems: "center", justifyContent: "center" },

  // 빈 목록
  empty: { textAlign: "center", color: "#9CA3AF", fontFamily: "Inter_400Regular", marginTop: 40 },

  // 모달
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  modalTitle:  { fontSize: 15, fontFamily: "Inter_700Bold", color: "#111827" },
  label:       { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#374151", marginBottom: 6 },
  input:       { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontFamily: "Inter_400Regular", fontSize: 14, color: "#111827" },
});
