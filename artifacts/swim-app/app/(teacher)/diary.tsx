/**
 * (teacher)/diary.tsx — 수영일지 v3
 *
 * 구조: WeeklySchedule → 반 선택 → write(작성) / history(지난 일지 목록) / edit(수정)
 * - "지난 일지" 카드 탭 → 전체 수정 화면 진입
 * - 공통 일지 + 학생별 추가 일지 모두 수정 가능
 */
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView,
  Modal, Platform, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { WeeklySchedule, TeacherClassGroup, SlotStatus } from "@/components/teacher/WeeklySchedule";
import SentencePicker from "@/components/teacher/SentencePicker";

const C = Colors.light;

interface DiaryTemplate { id: string; category: string; level?: string | null; template_text: string; }
interface StudentOption  { id: string; name: string; birth_year?: string | null; }
interface StudentNote    { student_id: string; student_name: string; note_content: string; }
interface ExistingNote   { id: string; student_id: string; student_name: string; note_content: string; _deleted?: boolean; _modified?: boolean; }
interface DiaryEntry {
  id: string; class_group_id: string; lesson_date: string;
  common_content: string; teacher_name: string; teacher_id?: string;
  is_edited: boolean; is_deleted: boolean;
  note_count?: number; class_name?: string; schedule_time?: string;
  student_notes?: ExistingNote[];
}
interface AuditLog {
  id: string; target_type: string; action_type: string;
  before_content?: string | null; after_content?: string | null;
  actor_name: string; actor_role: string; created_at: string;
}

type SubView = "write" | "history" | "edit";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── 감사기록 모달 ─────────────────────────────────────────────────────────
function AuditModal({ diaryId, token, onClose }: { diaryId: string; token: string; onClose: () => void }) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest(token, `/diaries/${diaryId}/audit-logs`)
      .then(r => r.ok ? r.json() : [])
      .then(setLogs)
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  }, []);

  const actionLabel: Record<string, string> = { create: "작성", update: "수정", delete: "삭제" };
  const targetLabel: Record<string, string> = { common: "공통 일지", student_note: "개별 일지" };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={a.overlay}>
        <View style={[a.sheet, { backgroundColor: C.card }]}>
          <View style={a.sheetHeader}>
            <Text style={[a.sheetTitle, { color: C.text }]}>변경 기록</Text>
            <Pressable onPress={onClose}><Feather name="x" size={20} color={C.textSecondary} /></Pressable>
          </View>
          {loading ? <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} /> : (
            <ScrollView contentContainerStyle={{ gap: 10, padding: 16 }}>
              {logs.length === 0 && <Text style={{ textAlign: "center", color: C.textMuted, marginTop: 20 }}>기록이 없습니다</Text>}
              {logs.map(log => (
                <View key={log.id} style={[a.logCard, { backgroundColor: C.background }]}>
                  <View style={a.logHeader}>
                    <View style={[a.logBadge, { backgroundColor: log.action_type === "delete" ? "#FEE2E2" : log.action_type === "update" ? "#FEF3C7" : "#D1FAE5" }]}>
                      <Text style={[a.logBadgeText, { color: log.action_type === "delete" ? C.error : log.action_type === "update" ? C.warning : C.success }]}>
                        {actionLabel[log.action_type]}
                      </Text>
                    </View>
                    <Text style={a.logTarget}>{targetLabel[log.target_type]}</Text>
                    <Text style={a.logMeta}>{log.actor_name} · {new Date(log.created_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</Text>
                  </View>
                  {log.before_content && (
                    <View style={[a.logContent, { backgroundColor: "#FEF2F2", borderColor: "#FCA5A5" }]}>
                      <Text style={a.logContentLabel}>수정 전</Text>
                      <Text style={[a.logContentText, { color: C.text }]}>{log.before_content}</Text>
                    </View>
                  )}
                  {log.after_content && (
                    <View style={[a.logContent, { backgroundColor: "#F0FDF4", borderColor: "#86EFAC" }]}>
                      <Text style={a.logContentLabel}>수정 후</Text>
                      <Text style={[a.logContentText, { color: C.text }]}>{log.after_content}</Text>
                    </View>
                  )}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════
// 메인 화면
// ════════════════════════════════════════════════════════════════════════
export default function TeacherDiaryScreen() {
  const { token, adminUser: user } = useAuth();
  const { themeColor } = useBrand();
  const params = useLocalSearchParams<{ classGroupId?: string; className?: string; lessonDate?: string; editDiaryId?: string }>();

  const targetDate = (params.lessonDate && params.lessonDate.match(/^\d{4}-\d{2}-\d{2}$/))
    ? params.lessonDate : todayStr();

  const [groups,     setGroups]     = useState<TeacherClassGroup[]>([]);
  const [diarySet,   setDiarySet]   = useState<Set<string>>(new Set());
  const [attMap,     setAttMap]     = useState<Record<string, number>>({});
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [selectedGroup, setSelectedGroup] = useState<TeacherClassGroup | null>(null);
  const [subView,       setSubView]       = useState<SubView>("write");

  // ── 작성 폼 상태 ─────────────────────────────────────────────────────
  const [templates,      setTemplates]      = useState<DiaryTemplate[]>([]);
  const [showTemplates,  setShowTemplates]  = useState(false);
  const [commonContent,  setCommonContent]  = useState("");
  const [classStudents,  setClassStudents]  = useState<StudentOption[]>([]);
  const [studentNotes,   setStudentNotes]   = useState<StudentNote[]>([]);
  const [addNoteStudent, setAddNoteStudent] = useState<StudentOption | null>(null);
  const [noteInput,      setNoteInput]      = useState("");
  const [saving,         setSaving]         = useState(false);
  const [showPickerFor,  setShowPickerFor]  = useState<"common" | "note" | "editCommon" | "editNote" | null>(null);
  const commonCursorRef = useRef<number>(0);
  const noteCursorRef   = useRef<number>(0);

  // ── 기록 목록 상태 ────────────────────────────────────────────────────
  const [diaries,      setDiaries]      = useState<DiaryEntry[]>([]);
  const [diaryLoading, setDiaryLoading] = useState(false);
  const [auditTarget,  setAuditTarget]  = useState<string | null>(null);

  // ── 수정 뷰 상태 ─────────────────────────────────────────────────────
  const [editDiary,      setEditDiary]      = useState<DiaryEntry | null>(null);
  const [editContent,    setEditContent]    = useState("");
  const [editNotes,      setEditNotes]      = useState<ExistingNote[]>([]);
  const [editNewNotes,   setEditNewNotes]   = useState<StudentNote[]>([]);
  const [editAddStudent, setEditAddStudent] = useState<StudentOption | null>(null);
  const [editAddInput,   setEditAddInput]   = useState("");
  const [editSaving,     setEditSaving]     = useState(false);
  const [editError,      setEditError]      = useState<string | null>(null);
  const [editLoading,    setEditLoading]    = useState(false);
  const [editPickerFor,  setEditPickerFor]  = useState<"common" | "note" | null>(null);
  const editCursorRef    = useRef<number>(0);
  const editNoteCursorRef = useRef<number>(0);

  // ── 삭제 확인 ─────────────────────────────────────────────────────────
  const [saveMsg,         setSaveMsg]         = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [formError,       setFormError]       = useState<string | null>(null);
  const [deleteTarget,    setDeleteTarget]    = useState<DiaryEntry | null>(null);
  const [deleteLoading,   setDeleteLoading]   = useState(false);
  const [deleteError,     setDeleteError]     = useState<string | null>(null);

  // ── 초기 로드 ────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const [cgRes, attRes, dRes] = await Promise.all([
        apiRequest(token, "/class-groups"),
        apiRequest(token, `/attendance?date=${targetDate}`),
        apiRequest(token, `/diaries?lesson_date=${targetDate}`),
      ]);
      let groupsList: TeacherClassGroup[] = [];
      if (cgRes.ok) { groupsList = await cgRes.json(); setGroups(groupsList); }
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
      if (params.editDiaryId) {
        // diary-index에서 진입 시 바로 해당 일지 수정 뷰 열기
        try {
          const dr = await apiRequest(token, `/diaries/${params.editDiaryId}`);
          if (dr.ok) {
            const diaryData = await dr.json();
            const group = groupsList.find(g => g.id === diaryData.class_group_id);
            if (group) {
              setSelectedGroup(group);
              setEditDiary(diaryData);
              setEditContent(diaryData.common_content || "");
              setEditNotes(Array.isArray(diaryData.student_notes) ? diaryData.student_notes.map((n: any) => ({ ...n })) : []);
              setEditNewNotes([]);
              setEditAddStudent(null);
              setEditAddInput("");
              setEditError(null);
              setSubView("edit");
              loadClassStudents(group.id);
            }
          }
        } catch {}
      } else if (params.classGroupId) {
        const found = groupsList.find(g => g.id === params.classGroupId);
        if (found) openGroup(found);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token, targetDate]);

  useEffect(() => { load(); }, [load]);

  // ── 반 선택 ──────────────────────────────────────────────────────────
  async function openGroup(group: TeacherClassGroup) {
    setSelectedGroup(group);
    setSubView("write");
    setCommonContent("");
    setStudentNotes([]);
    setShowTemplates(false);
    loadTemplates();
    loadClassStudents(group.id);
    loadDiaries(group.id);
  }

  async function loadTemplates() {
    try {
      const r = await apiRequest(token, "/diary-templates");
      if (r.ok) setTemplates(await r.json());
    } catch {}
  }

  async function loadClassStudents(classId: string) {
    try {
      const r = await apiRequest(token, `/class-groups/${classId}/students`);
      if (r.ok) {
        const data = await r.json();
        setClassStudents(Array.isArray(data) ? data : []);
      }
    } catch {}
  }

  async function loadDiaries(classId: string) {
    setDiaryLoading(true);
    try {
      const r = await apiRequest(token, `/diaries?class_group_id=${classId}`);
      if (r.ok) {
        const data = await r.json();
        setDiaries(Array.isArray(data) ? data : []);
      }
    } catch {}
    finally { setDiaryLoading(false); }
  }

  function insertAtCursor(current: string, insert: string, cursorPos: number, setter: (v: string) => void) {
    const before = current.slice(0, cursorPos);
    const after  = current.slice(cursorPos);
    const glue   = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
    setter(before + glue + insert + after);
  }

  function handleAddNote() {
    if (!addNoteStudent || !noteInput.trim()) return;
    setStudentNotes(prev => {
      const existing = prev.findIndex(n => n.student_id === addNoteStudent!.id);
      if (existing >= 0) {
        const next = [...prev];
        next[existing] = { ...next[existing], note_content: noteInput.trim() };
        return next;
      }
      return [...prev, { student_id: addNoteStudent!.id, student_name: addNoteStudent!.name, note_content: noteInput.trim() }];
    });
    setAddNoteStudent(null);
    setNoteInput("");
  }

  function removeStudentNote(studentId: string) {
    setStudentNotes(prev => prev.filter(n => n.student_id !== studentId));
  }

  // ── 신규 일지 저장 ───────────────────────────────────────────────────
  async function handleSave() {
    if (!selectedGroup) return;
    if (!commonContent.trim()) { setFormError("공통 일지 내용을 입력해주세요."); return; }
    setFormError(null);
    setSaving(true);
    try {
      const r = await apiRequest(token, "/diaries", {
        method: "POST",
        body: JSON.stringify({
          class_group_id: selectedGroup.id,
          lesson_date: targetDate,
          common_content: commonContent.trim(),
          student_notes: studentNotes.map(n => ({ student_id: n.student_id, note_content: n.note_content })),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "저장 실패");
      setDiarySet(prev => new Set([...prev, selectedGroup.id]));
      setSaveMsg({ type: "success", text: "수업 일지가 저장되었습니다. 학부모에게 알림이 발송됩니다." });
      const cameFromUnwritten = !!(params.lessonDate && params.lessonDate.match(/^\d{4}-\d{2}-\d{2}$/));
      setTimeout(() => {
        setSaveMsg(null);
        if (cameFromUnwritten) router.back();
        else setSelectedGroup(null);
      }, 2000);
    } catch (e: any) { setSaveMsg({ type: "error", text: e.message || "저장 중 오류가 발생했습니다." }); }
    finally { setSaving(false); }
  }

  // ── 삭제 ─────────────────────────────────────────────────────────────
  function handleDelete(diary: DiaryEntry) { setDeleteTarget(diary); setDeleteError(null); }

  async function confirmDelete() {
    if (!deleteTarget || !selectedGroup) return;
    setDeleteLoading(true);
    try {
      const r = await apiRequest(token, `/diaries/${deleteTarget.id}`, { method: "DELETE" });
      if (r.ok) {
        setDiaries(prev => prev.filter(d => d.id !== deleteTarget.id));
        setDiarySet(prev => { const next = new Set(prev); next.delete(selectedGroup.id); return next; });
        setDeleteTarget(null);
      } else {
        const d = await r.json();
        setDeleteError(d.error || "삭제 실패");
      }
    } finally { setDeleteLoading(false); }
  }

  // ── 수정 뷰 열기 ─────────────────────────────────────────────────────
  async function openEditDiary(item: DiaryEntry) {
    setEditDiary(item);
    setEditContent(item.common_content || "");
    setEditNotes([]);
    setEditNewNotes([]);
    setEditAddStudent(null);
    setEditAddInput("");
    setEditError(null);
    setSubView("edit");
    setEditLoading(true);

    try {
      const r = await apiRequest(token, `/diaries/${item.id}`);
      if (!r.ok) throw new Error("불러오기 실패");
      const data = await r.json();
      setEditDiary(data);
      setEditContent(data.common_content || "");
      setEditNotes(Array.isArray(data.student_notes) ? data.student_notes.map((n: any) => ({ ...n })) : []);
    } catch (e: any) {
      setEditError(e.message || "불러오기 오류");
    } finally {
      setEditLoading(false);
    }
  }

  // ── 수정 저장 ─────────────────────────────────────────────────────────
  async function handleEditSave() {
    if (!editDiary || !selectedGroup) return;
    if (!editContent.trim()) { setEditError("일지 본문을 입력해주세요."); return; }
    setEditSaving(true);
    setEditError(null);
    try {
      // 1. 공통 일지 수정
      const r = await apiRequest(token, `/diaries/${editDiary.id}`, {
        method: "PUT",
        body: JSON.stringify({ common_content: editContent.trim() }),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || "수정 실패"); }

      // 2. 삭제 표시된 기존 노트 제거
      for (const note of editNotes) {
        if (note._deleted) {
          await apiRequest(token, `/diaries/student-notes/${note.id}`, { method: "DELETE" });
        }
      }

      // 3. 수정된 기존 노트 업데이트
      for (const note of editNotes) {
        if (!note._deleted && note._modified) {
          await apiRequest(token, `/diaries/student-notes/${note.id}`, {
            method: "PUT",
            body: JSON.stringify({ note_content: note.note_content }),
          });
        }
      }

      // 4. 새로 추가된 노트 저장
      for (const note of editNewNotes) {
        await apiRequest(token, `/diaries/${editDiary.id}/student-notes`, {
          method: "POST",
          body: JSON.stringify({ student_id: note.student_id, note_content: note.note_content }),
        });
      }

      // 수정 완료 → 이전 화면으로
      if (params.editDiaryId) {
        router.back();
      } else {
        setSubView("history");
        setEditDiary(null);
        await loadDiaries(selectedGroup.id);
      }
    } catch (e: any) {
      setEditError(e.message || "저장 중 오류가 발생했습니다.");
    } finally {
      setEditSaving(false);
    }
  }

  // ── 수정 뷰: 학생별 노트 관리 ────────────────────────────────────────
  function handleEditAddNote() {
    if (!editAddStudent || !editAddInput.trim()) return;
    setEditNewNotes(prev => [...prev, {
      student_id: editAddStudent!.id,
      student_name: editAddStudent!.name,
      note_content: editAddInput.trim(),
    }]);
    setEditAddStudent(null);
    setEditAddInput("");
  }

  function markNoteDeleted(noteId: string) {
    setEditNotes(prev => prev.map(n => n.id === noteId ? { ...n, _deleted: true } : n));
  }

  function updateNoteContent(noteId: string, content: string) {
    setEditNotes(prev => prev.map(n => n.id === noteId ? { ...n, note_content: content, _modified: true } : n));
  }

  function removeNewNote(idx: number) {
    setEditNewNotes(prev => prev.filter((_, i) => i !== idx));
  }

  const statusMap: Record<string, SlotStatus> = {};
  groups.forEach(g => {
    statusMap[g.id] = { attChecked: attMap[g.id] || 0, diaryDone: diarySet.has(g.id), hasPhotos: false };
  });

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <SubScreenHeader title="수업 일지" homePath="/(teacher)/today-schedule" />
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  // ── 반 선택 후 서브뷰 ────────────────────────────────────────────────
  if (selectedGroup) {
    const group = selectedGroup;
    const myDiaryExists = diarySet.has(group.id);

    // ── 수정 뷰 ─────────────────────────────────────────────────────
    if (subView === "edit") {
      const activeNotes = editNotes.filter(n => !n._deleted);
      const usedStudentIds = new Set([
        ...activeNotes.map(n => n.student_id),
        ...editNewNotes.map(n => n.student_id),
      ]);

      return (
        <SafeAreaView style={s.safe} edges={[]}>
          <SubScreenHeader
            title="일지 수정"
            subtitle={editDiary ? `${editDiary.lesson_date} · ${group.schedule_time}` : ""}
            onBack={() => {
              if (params.editDiaryId) router.back();
              else { setSubView("history"); setEditDiary(null); }
            }}
            homePath="/(teacher)/today-schedule"
          />

          {editLoading ? (
            <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
          ) : (
            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
              <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

                {/* 일지 정보 헤더 카드 */}
                <View style={[s.infoCard, { backgroundColor: themeColor + "12", borderColor: themeColor + "30" }]}>
                  <View style={s.infoCardRow}>
                    <Feather name="layers" size={14} color={themeColor} />
                    <Text style={[s.infoCardText, { color: themeColor }]}>{group.name}</Text>
                  </View>
                  <View style={s.infoCardRow}>
                    <Feather name="calendar" size={14} color={themeColor} />
                    <Text style={[s.infoCardText, { color: themeColor }]}>
                      {editDiary?.lesson_date} · {group.schedule_time}
                    </Text>
                  </View>
                  <View style={s.infoCardRow}>
                    <Feather name="user" size={14} color={themeColor} />
                    <Text style={[s.infoCardText, { color: themeColor }]}>
                      {editDiary?.teacher_name} 선생님
                    </Text>
                  </View>
                </View>

                {/* 공통 일지 카드 */}
                <View style={[s.card, { backgroundColor: C.card }]}>
                  <View style={s.cardHeader}>
                    <View style={[s.cardIcon, { backgroundColor: themeColor + "20" }]}>
                      <Feather name="book-open" size={15} color={themeColor} />
                    </View>
                    <Text style={[s.cardTitle, { color: C.text }]}>반 공통 일지</Text>
                    <Text style={s.cardSub}>모든 학생에게 공통으로 보이는 내용</Text>
                  </View>
                  <TextInput
                    style={[s.textarea, { borderColor: C.border, color: C.text }]}
                    value={editContent}
                    onChangeText={t => { setEditContent(t); if (editError) setEditError(null); }}
                    onSelectionChange={e => { editCursorRef.current = e.nativeEvent.selection.start; }}
                    placeholder="수업 내용을 입력하세요"
                    placeholderTextColor={C.textMuted}
                    multiline
                    numberOfLines={6}
                    textAlignVertical="top"
                  />
                  <View style={s.textareaFooter}>
                    <Text style={s.charCount}>{editContent.length}자</Text>
                    <TouchableOpacity
                      style={s.sentencePickBtn}
                      onPress={() => setEditPickerFor("common")}
                      activeOpacity={0.7}
                    >
                      <Feather name="book-open" size={13} color={C.tint} />
                      <Text style={s.sentencePickBtnText}>문장 불러오기</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* 학생별 추가 일지 카드 */}
                <View style={[s.card, { backgroundColor: C.card }]}>
                  <View style={s.cardHeader}>
                    <View style={[s.cardIcon, { backgroundColor: "#8B5CF620" }]}>
                      <Feather name="users" size={15} color="#8B5CF6" />
                    </View>
                    <Text style={[s.cardTitle, { color: C.text }]}>학생별 추가 일지</Text>
                    <Text style={s.cardSub}>개별 코멘트 수정</Text>
                  </View>

                  {/* 기존 노트 목록 */}
                  {activeNotes.map(note => (
                    <View key={note.id} style={[s.editNoteItem, { backgroundColor: "#F5F3FF", borderColor: "#C4B5FD" }]}>
                      <View style={s.editNoteHeader}>
                        <Text style={s.noteName}>{note.student_name}</Text>
                        <Pressable onPress={() => markNoteDeleted(note.id)}>
                          <Feather name="trash-2" size={15} color={C.error} />
                        </Pressable>
                      </View>
                      <TextInput
                        style={[s.noteTextarea, { borderColor: "#C4B5FD", color: C.text }]}
                        value={note.note_content}
                        onChangeText={t => updateNoteContent(note.id, t)}
                        onSelectionChange={e => { editNoteCursorRef.current = e.nativeEvent.selection.start; }}
                        multiline
                        numberOfLines={3}
                        textAlignVertical="top"
                        placeholder="개별 코멘트를 입력하세요"
                        placeholderTextColor={C.textMuted}
                      />
                    </View>
                  ))}

                  {/* 새로 추가된 노트 */}
                  {editNewNotes.map((note, idx) => (
                    <View key={idx} style={[s.editNoteItem, { backgroundColor: "#ECFDF5", borderColor: "#6EE7B7" }]}>
                      <View style={s.editNoteHeader}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <View style={[s.statusBadge, { backgroundColor: "#D1FAE5" }]}>
                            <Text style={[s.statusBadgeText, { color: "#059669" }]}>신규</Text>
                          </View>
                          <Text style={[s.noteName, { color: "#059669" }]}>{note.student_name}</Text>
                        </View>
                        <Pressable onPress={() => removeNewNote(idx)}>
                          <Feather name="x-circle" size={15} color={C.error} />
                        </Pressable>
                      </View>
                      <Text style={[s.noteContent, { color: C.text }]}>{note.note_content}</Text>
                    </View>
                  ))}

                  {/* 학생 추가 선택 */}
                  {classStudents.length === 0 ? (
                    <View style={[s.emptyStudents, { backgroundColor: C.background, borderColor: C.border }]}>
                      <Feather name="users" size={16} color={C.textMuted} />
                      <Text style={[s.emptyStudentsText, { color: C.textMuted }]}>이 수업에 배정된 학생이 없습니다</Text>
                    </View>
                  ) : (
                    <>
                      {/* 추가할 학생 선택 칩 */}
                      {classStudents.filter(st => !usedStudentIds.has(st.id)).length > 0 && (
                        <View style={{ gap: 6 }}>
                          <Text style={[s.sectionLabel, { color: C.textSecondary }]}>학생 추가</Text>
                          {classStudents.filter(st => !usedStudentIds.has(st.id)).map(st => (
                            <Pressable
                              key={st.id}
                              style={[s.studentChip, { backgroundColor: C.background, borderColor: C.border },
                                editAddStudent?.id === st.id && { borderColor: "#8B5CF6", backgroundColor: "#F5F3FF" }]}
                              onPress={() => {
                                if (editAddStudent?.id === st.id) { setEditAddStudent(null); setEditAddInput(""); }
                                else { setEditAddStudent(st); setEditAddInput(""); }
                              }}
                            >
                              <Text style={[s.studentChipText, { color: editAddStudent?.id === st.id ? "#8B5CF6" : C.text }]}>
                                {st.name}
                              </Text>
                              <Feather name="plus-circle" size={15} color={editAddStudent?.id === st.id ? "#8B5CF6" : C.textMuted} />
                            </Pressable>
                          ))}
                        </View>
                      )}

                      {/* 선택된 학생 노트 입력 */}
                      {editAddStudent && (
                        <View style={[s.noteInput, { backgroundColor: "#F5F3FF", borderColor: "#8B5CF6" }]}>
                          <Text style={[s.noteName, { color: "#8B5CF6", marginBottom: 6 }]}>{editAddStudent.name} 추가 일지</Text>
                          <TextInput
                            style={[s.noteTextarea, { borderColor: "#8B5CF6", color: C.text }]}
                            value={editAddInput}
                            onChangeText={setEditAddInput}
                            placeholder="이 학생에게 전달할 추가 내용을 입력하세요"
                            placeholderTextColor={C.textMuted}
                            multiline
                            numberOfLines={3}
                            textAlignVertical="top"
                            autoFocus
                          />
                          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                            <Pressable style={[s.noteBtn, { borderColor: C.border }]} onPress={() => { setEditAddStudent(null); setEditAddInput(""); }}>
                              <Text style={{ color: C.textSecondary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>취소</Text>
                            </Pressable>
                            <Pressable style={[s.noteBtn, { backgroundColor: "#8B5CF6", borderColor: "#8B5CF6", flex: 1 }]} onPress={handleEditAddNote} disabled={!editAddInput.trim()}>
                              <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 13 }}>추가</Text>
                            </Pressable>
                          </View>
                        </View>
                      )}
                    </>
                  )}
                </View>

                <View style={{ height: 100 }} />
              </ScrollView>

              {/* 저장 버튼 */}
              <View style={s.footer}>
                {editError && (
                  <View style={[s.inlineError, { backgroundColor: "#FEE2E2" }]}>
                    <Feather name="alert-circle" size={13} color={C.error} />
                    <Text style={[s.inlineErrorText, { color: C.error }]}>{editError}</Text>
                  </View>
                )}
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Pressable style={[s.cancelBtnFt, { borderColor: C.border }]} onPress={() => {
                    if (params.editDiaryId) router.back();
                    else { setSubView("history"); setEditDiary(null); }
                  }}>
                    <Text style={[s.cancelBtnFtText, { color: C.textSecondary }]}>취소</Text>
                  </Pressable>
                  <Pressable
                    style={[s.saveBtn, { backgroundColor: themeColor, opacity: editSaving ? 0.5 : 1, flex: 2 }]}
                    onPress={handleEditSave}
                    disabled={editSaving}
                  >
                    {editSaving
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <><Feather name="save" size={16} color="#fff" /><Text style={s.saveBtnText}>저장</Text></>
                    }
                  </Pressable>
                </View>
              </View>
            </KeyboardAvoidingView>
          )}

          {/* 문장 불러오기 */}
          <SentencePicker
            visible={editPickerFor !== null}
            onClose={() => setEditPickerFor(null)}
            onInsert={text => {
              if (editPickerFor === "common") {
                insertAtCursor(editContent, text, editCursorRef.current, setEditContent);
                editCursorRef.current = editCursorRef.current + text.length;
              }
              setEditPickerFor(null);
            }}
          />
        </SafeAreaView>
      );
    }

    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <SubScreenHeader
          title={group.name}
          subtitle={`${targetDate} · ${group.schedule_time}`}
          onBack={() => setSelectedGroup(null)}
          homePath="/(teacher)/today-schedule"
        />

        {/* 탭 헤더 */}
        <View style={s.subHeader}>
          <View style={{ flex: 1 }} />
          <Pressable
            style={[s.tabBtn, { backgroundColor: subView === "history" ? themeColor : C.background, borderColor: themeColor }]}
            onPress={() => setSubView(v => v === "history" ? "write" : "history")}
          >
            <Feather name="clock" size={13} color={subView === "history" ? "#fff" : themeColor} />
            <Text style={[s.tabBtnText, { color: subView === "history" ? "#fff" : themeColor }]}>지난 일지</Text>
          </Pressable>
        </View>

        {subView === "write" ? (
          // ── 새 일지 작성 ────────────────────────────────────────────
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
            <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

              {myDiaryExists && (
                <View style={[s.infoBox, { backgroundColor: "#FEF3C7" }]}>
                  <Feather name="alert-circle" size={13} color="#D97706" />
                  <Text style={s.infoText}>오늘 이미 일지가 작성되어 있습니다. 수정은 "지난 일지"에서 할 수 있습니다.</Text>
                </View>
              )}

              {/* 공통 일지 카드 */}
              <View style={[s.card, { backgroundColor: C.card }]}>
                <View style={s.cardHeader}>
                  <View style={[s.cardIcon, { backgroundColor: themeColor + "20" }]}>
                    <Feather name="book-open" size={15} color={themeColor} />
                  </View>
                  <Text style={[s.cardTitle, { color: C.text }]}>반 공통 일지</Text>
                  <Text style={s.cardSub}>모든 학생에게 공통으로 보이는 내용</Text>
                </View>

                {templates.length > 0 && (
                  <Pressable style={[s.templateBtn, { borderColor: themeColor }]} onPress={() => setShowTemplates(v => !v)}>
                    <Feather name="zap" size={13} color={themeColor} />
                    <Text style={[s.templateBtnText, { color: themeColor }]}>템플릿 선택</Text>
                    <Feather name={showTemplates ? "chevron-up" : "chevron-down"} size={13} color={themeColor} />
                  </Pressable>
                )}

                {showTemplates && (
                  <View style={s.templateList}>
                    {templates.map(t => (
                      <Pressable key={t.id} style={[s.templateItem, { backgroundColor: C.background }]} onPress={() => {
                        setCommonContent(prev => prev.trim() ? `${prev.trim()}\n${t.template_text}` : t.template_text);
                        setShowTemplates(false);
                      }}>
                        <Text style={[s.templateText, { color: C.text }]} numberOfLines={2}>{t.template_text}</Text>
                        {t.category !== "general" && <Text style={[s.templateCategory, { color: themeColor }]}>{t.category}</Text>}
                      </Pressable>
                    ))}
                  </View>
                )}

                <TextInput
                  style={[s.textarea, { borderColor: C.border, color: C.text }]}
                  value={commonContent}
                  onChangeText={setCommonContent}
                  onSelectionChange={e => { commonCursorRef.current = e.nativeEvent.selection.start; }}
                  placeholder="오늘 수업 내용을 입력하세요.\n(모든 학생 학부모에게 공통으로 노출됩니다)"
                  placeholderTextColor={C.textMuted}
                  multiline
                  numberOfLines={6}
                  textAlignVertical="top"
                />
                <View style={s.textareaFooter}>
                  <Text style={s.charCount}>{commonContent.length}자</Text>
                  <TouchableOpacity style={s.sentencePickBtn} onPress={() => setShowPickerFor("common")} activeOpacity={0.7}>
                    <Feather name="book-open" size={13} color={C.tint} />
                    <Text style={s.sentencePickBtnText}>문장 불러오기</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* 학생별 추가 일지 카드 */}
              <View style={[s.card, { backgroundColor: C.card }]}>
                <View style={s.cardHeader}>
                  <View style={[s.cardIcon, { backgroundColor: "#8B5CF620" }]}>
                    <Feather name="user" size={15} color="#8B5CF6" />
                  </View>
                  <Text style={[s.cardTitle, { color: C.text }]}>학생별 추가 일지</Text>
                  <Text style={s.cardSub}>필요한 학생만 선택</Text>
                </View>

                {studentNotes.map(note => (
                  <View key={note.student_id} style={[s.noteItem, { backgroundColor: "#F5F3FF" }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.noteName}>{note.student_name}</Text>
                      <Text style={s.noteContent} numberOfLines={2}>{note.note_content}</Text>
                    </View>
                    <Pressable onPress={() => removeStudentNote(note.student_id)}>
                      <Feather name="x-circle" size={18} color={C.textMuted} />
                    </Pressable>
                  </View>
                ))}

                {classStudents.length === 0 ? (
                  <View style={[s.emptyStudents, { backgroundColor: C.background, borderColor: C.border }]}>
                    <Feather name="users" size={16} color={C.textMuted} />
                    <Text style={[s.emptyStudentsText, { color: C.textMuted }]}>이 수업에 배정된 학생이 없습니다</Text>
                  </View>
                ) : (
                  <View style={{ gap: 6 }}>
                    <Text style={[s.sectionLabel, { color: C.textSecondary }]}>학생 선택</Text>
                    {classStudents.filter(st => !studentNotes.some(n => n.student_id === st.id)).map(st => (
                      <Pressable
                        key={st.id}
                        style={[s.studentChip, { backgroundColor: C.background, borderColor: C.border },
                          addNoteStudent?.id === st.id && { borderColor: "#8B5CF6", backgroundColor: "#F5F3FF" }]}
                        onPress={() => {
                          if (addNoteStudent?.id === st.id) { setAddNoteStudent(null); setNoteInput(""); }
                          else { setAddNoteStudent(st); setNoteInput(""); }
                        }}
                      >
                        <Text style={[s.studentChipText, { color: addNoteStudent?.id === st.id ? "#8B5CF6" : C.text }]}>
                          {st.name}
                        </Text>
                        <Feather name="plus-circle" size={15} color={addNoteStudent?.id === st.id ? "#8B5CF6" : C.textMuted} />
                      </Pressable>
                    ))}
                  </View>
                )}

                {addNoteStudent && (
                  <View style={[s.noteInput, { backgroundColor: "#F5F3FF", borderColor: "#8B5CF6" }]}>
                    <Text style={[s.noteName, { color: "#8B5CF6", marginBottom: 6 }]}>{addNoteStudent.name} 추가 일지</Text>
                    <TextInput
                      style={[s.noteTextarea, { borderColor: "#8B5CF6", color: C.text }]}
                      value={noteInput}
                      onChangeText={setNoteInput}
                      onSelectionChange={e => { noteCursorRef.current = e.nativeEvent.selection.start; }}
                      placeholder="이 학생에게 전달할 추가 내용을 입력하세요"
                      placeholderTextColor={C.textMuted}
                      multiline
                      numberOfLines={3}
                      textAlignVertical="top"
                      autoFocus
                    />
                    <TouchableOpacity style={[s.sentencePickBtn, { alignSelf: "flex-start", marginTop: 6 }]} onPress={() => setShowPickerFor("note")} activeOpacity={0.7}>
                      <Feather name="book-open" size={13} color="#8B5CF6" />
                      <Text style={[s.sentencePickBtnText, { color: "#8B5CF6" }]}>문장 불러오기</Text>
                    </TouchableOpacity>
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                      <Pressable style={[s.noteBtn, { borderColor: C.border }]} onPress={() => { setAddNoteStudent(null); setNoteInput(""); }}>
                        <Text style={{ color: C.textSecondary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>취소</Text>
                      </Pressable>
                      <Pressable style={[s.noteBtn, { backgroundColor: "#8B5CF6", borderColor: "#8B5CF6", flex: 1 }]} onPress={handleAddNote} disabled={!noteInput.trim()}>
                        <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 13 }}>추가</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              </View>

              <View style={{ height: 100 }} />
            </ScrollView>

            {/* 저장 버튼 */}
            <View style={s.footer}>
              {formError && (
                <View style={[s.inlineError, { backgroundColor: "#FEE2E2" }]}>
                  <Feather name="alert-circle" size={13} color={C.error} />
                  <Text style={[s.inlineErrorText, { color: C.error }]}>{formError}</Text>
                </View>
              )}
              {saveMsg && (
                <View style={[s.inlineError, { backgroundColor: saveMsg.type === "success" ? "#D1FAE5" : "#FEE2E2" }]}>
                  <Feather name={saveMsg.type === "success" ? "check-circle" : "alert-circle"} size={13}
                    color={saveMsg.type === "success" ? "#059669" : C.error} />
                  <Text style={[s.inlineErrorText, { color: saveMsg.type === "success" ? "#059669" : C.error }]}>
                    {saveMsg.text}
                  </Text>
                </View>
              )}
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable style={[s.cancelBtnFt, { borderColor: C.border }]} onPress={() => setSelectedGroup(null)}>
                  <Text style={[s.cancelBtnFtText, { color: C.textSecondary }]}>나가기</Text>
                </Pressable>
                <Pressable
                  style={[s.saveBtn, { backgroundColor: themeColor, opacity: saving || myDiaryExists ? 0.5 : 1, flex: 2 }]}
                  onPress={handleSave}
                  disabled={saving || myDiaryExists}
                >
                  {saving
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <><Feather name="save" size={16} color="#fff" /><Text style={s.saveBtnText}>저장</Text></>
                  }
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        ) : (
          // ── 지난 일지 목록 ─────────────────────────────────────────────
          <>
            {diaryLoading ? (
              <ActivityIndicator color={themeColor} style={{ marginTop: 40 }} />
            ) : (
              <FlatList
                data={diaries}
                keyExtractor={i => i.id}
                contentContainerStyle={s.diaryList}
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadDiaries(group.id); setRefreshing(false); }} />}
                ListEmptyComponent={
                  <View style={s.emptyBox}>
                    <Feather name="book-open" size={32} color={C.textMuted} />
                    <Text style={s.emptyText}>작성된 일지가 없습니다</Text>
                  </View>
                }
                renderItem={({ item }) => {
                  const isMine = item.teacher_id === user?.id;
                  return (
                    <Pressable
                      style={({ pressed }) => [
                        s.diaryCard,
                        { backgroundColor: C.card, opacity: pressed && isMine ? 0.88 : 1 },
                        isMine && s.diaryCardEditable,
                      ]}
                      onPress={() => { if (isMine) openEditDiary(item); }}
                    >
                      {/* 배지 행 */}
                      <View style={s.badgeRow}>
                        {item.is_edited && (
                          <View style={[s.statusBadge, { backgroundColor: "#FEF3C7" }]}>
                            <Text style={[s.statusBadgeText, { color: "#92400E" }]}>수정됨</Text>
                          </View>
                        )}
                        {item.note_count && Number(item.note_count) > 0 && (
                          <View style={[s.statusBadge, { backgroundColor: "#EDE9FE" }]}>
                            <Feather name="user" size={10} color="#7C3AED" />
                            <Text style={[s.statusBadgeText, { color: "#7C3AED" }]}>개별 {item.note_count}명</Text>
                          </View>
                        )}
                        {isMine && (
                          <View style={[s.statusBadge, { backgroundColor: "#EFF6FF", marginLeft: "auto" }]}>
                            <Feather name="edit-2" size={10} color="#3B82F6" />
                            <Text style={[s.statusBadgeText, { color: "#3B82F6" }]}>탭하여 수정</Text>
                          </View>
                        )}
                      </View>

                      <View style={s.diaryCardHeader}>
                        <View>
                          <Text style={[s.diaryCardDate, { color: C.text }]}>{item.lesson_date}</Text>
                          <Text style={[s.diaryTeacher, { color: C.textMuted }]}>{item.teacher_name} 선생님</Text>
                        </View>
                        {isMine && (
                          <Pressable
                            style={[s.iconBtn, { backgroundColor: "#FEF2F2" }]}
                            onPress={e => { e.stopPropagation?.(); handleDelete(item); }}
                          >
                            <Feather name="trash-2" size={13} color={C.error} />
                          </Pressable>
                        )}
                      </View>

                      <Text style={[s.diaryContent, { color: C.textSecondary }]} numberOfLines={3}>
                        {item.common_content}
                      </Text>
                    </Pressable>
                  );
                }}
              />
            )}
          </>
        )}

        {/* 감사기록 모달 */}
        {auditTarget && (
          <AuditModal diaryId={auditTarget} token={token} onClose={() => setAuditTarget(null)} />
        )}

        {/* 삭제 확인 모달 */}
        <Modal visible={!!deleteTarget} transparent animationType="fade" onRequestClose={() => setDeleteTarget(null)}>
          <View style={s.delOverlay}>
            <View style={[s.delSheet, { backgroundColor: C.card }]}>
              <View style={[s.delIconWrap, { backgroundColor: "#FEE2E2" }]}>
                <Feather name="trash-2" size={26} color={C.error} />
              </View>
              <Text style={[s.delTitle, { color: C.text }]}>일지 삭제</Text>
              <Text style={[s.delDesc, { color: C.textSecondary }]}>
                이 일지를 삭제하시겠습니까?{"\n"}삭제된 일지는 관리자만 확인할 수 있습니다.
              </Text>
              {deleteError && (
                <View style={[s.inlineError, { backgroundColor: "#FEE2E2" }]}>
                  <Feather name="alert-circle" size={13} color={C.error} />
                  <Text style={[s.inlineErrorText, { color: C.error }]}>{deleteError}</Text>
                </View>
              )}
              <View style={{ flexDirection: "row", gap: 10, width: "100%" }}>
                <Pressable style={[s.delBtn, { borderColor: C.border, backgroundColor: C.background, flex: 1 }]}
                  onPress={() => setDeleteTarget(null)} disabled={deleteLoading}>
                  <Text style={{ color: C.textSecondary, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>취소</Text>
                </Pressable>
                <Pressable style={[s.delBtn, { backgroundColor: C.error, flex: 1, opacity: deleteLoading ? 0.6 : 1 }]}
                  onPress={confirmDelete} disabled={deleteLoading}>
                  {deleteLoading
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 14 }}>삭제</Text>
                  }
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        {/* 문장 불러오기 */}
        <SentencePicker
          visible={showPickerFor !== null}
          onClose={() => setShowPickerFor(null)}
          onInsert={text => {
            if (showPickerFor === "common") {
              insertAtCursor(commonContent, text, commonCursorRef.current, setCommonContent);
              commonCursorRef.current = commonCursorRef.current + text.length;
            } else if (showPickerFor === "note") {
              insertAtCursor(noteInput, text, noteCursorRef.current, setNoteInput);
              noteCursorRef.current = noteCursorRef.current + text.length;
            }
            setShowPickerFor(null);
          }}
        />
      </SafeAreaView>
    );
  }

  // ── 메인 시간표 뷰 ──────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="수업 일지" homePath="/(teacher)/today-schedule" />
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        <WeeklySchedule classGroups={groups} statusMap={statusMap} onSelectClass={openGroup} themeColor={themeColor} />
        <View style={{ height: 120 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#F3F4F6" },
  titleRow:     { paddingHorizontal: 16, paddingVertical: 10 },
  title:        { fontSize: 20, fontFamily: "Inter_700Bold" },

  subHeader:    { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  backBtn:      { width: 36, height: 36, borderRadius: 10, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  subTitle:     { fontSize: 16, fontFamily: "Inter_700Bold", color: "#111827" },
  subSub:       { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 1 },
  tabBtn:       { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1.5 },
  tabBtnText:   { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  infoCard:     { borderRadius: 14, borderWidth: 1.5, padding: 14, gap: 8 },
  infoCardRow:  { flexDirection: "row", alignItems: "center", gap: 8 },
  infoCardText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  form:         { padding: 14, gap: 14, paddingBottom: 80 },
  infoBox:      { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12 },
  infoText:     { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#92400E", lineHeight: 18 },

  card:         { borderRadius: 16, padding: 14, gap: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  cardHeader:   { flexDirection: "row", alignItems: "center", gap: 8 },
  cardIcon:     { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  cardTitle:    { fontSize: 14, fontFamily: "Inter_700Bold", flex: 1 },
  cardSub:      { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },

  templateBtn:  { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, alignSelf: "flex-start" },
  templateBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  templateList: { gap: 6 },
  templateItem: { borderRadius: 10, padding: 12, gap: 4 },
  templateText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  templateCategory: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  textarea:     { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22, minHeight: 140, textAlignVertical: "top", backgroundColor: "#fff" },
  textareaFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  charCount:    { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  sentencePickBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1.5, borderColor: C.tintLight, backgroundColor: "#F0F5FF" },
  sentencePickBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.tint },

  emptyStudents: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  emptyStudentsText: { fontSize: 13, fontFamily: "Inter_400Regular" },

  sectionLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  studentChip:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 10, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 8 },
  studentChipText: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },
  noteItem:     { flexDirection: "row", alignItems: "center", borderRadius: 10, padding: 10, gap: 8 },
  editNoteItem: { borderRadius: 12, borderWidth: 1.5, padding: 12, gap: 8 },
  editNoteHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  noteName:     { fontSize: 12, fontFamily: "Inter_700Bold", color: "#7C3AED" },
  noteContent:  { fontSize: 13, fontFamily: "Inter_400Regular", color: "#374151", lineHeight: 18 },
  noteInput:    { borderRadius: 12, borderWidth: 1.5, padding: 12, gap: 4 },
  noteTextarea: { borderWidth: 1.5, borderRadius: 10, padding: 10, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20, minHeight: 80, textAlignVertical: "top", backgroundColor: "#fff" },
  noteBtn:      { flex: 1, height: 38, borderRadius: 10, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },

  footer:       { gap: 8, padding: 12, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  cancelBtnFt:  { flex: 1, height: 50, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  cancelBtnFtText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  saveBtn:      { flexDirection: "row", height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", gap: 8 },
  saveBtnText:  { color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },

  diaryList:    { padding: 12, gap: 10, paddingBottom: 120 },
  diaryCard:    { borderRadius: 14, padding: 14, gap: 8 },
  diaryCardEditable: { borderWidth: 1.5, borderColor: "#DBEAFE" },
  badgeRow:     { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  statusBadge:  { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  statusBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  diaryCardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  diaryCardDate: { fontSize: 15, fontFamily: "Inter_700Bold" },
  diaryTeacher:  { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  diaryContent:  { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  iconBtn:      { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },

  emptyBox:     { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyText:    { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF" },

  inlineError:  { flexDirection: "row", alignItems: "center", gap: 6, padding: 10, borderRadius: 10 },
  inlineErrorText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 17 },

  delOverlay:   { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: 24 },
  delSheet:     { width: "100%", borderRadius: 22, padding: 24, alignItems: "center", gap: 14 },
  delIconWrap:  { width: 64, height: 64, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  delTitle:     { fontSize: 18, fontFamily: "Inter_700Bold" },
  delDesc:      { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  delBtn:       { height: 48, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
});

const a = StyleSheet.create({
  overlay:  { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet:    { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "85%", minHeight: "50%" },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  sheetTitle:  { fontSize: 16, fontFamily: "Inter_700Bold" },
  logCard:  { borderRadius: 12, padding: 12, gap: 8 },
  logHeader: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  logBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  logBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  logTarget: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#6B7280" },
  logMeta:   { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", textAlign: "right" },
  logContent: { borderRadius: 8, borderWidth: 1, padding: 10, gap: 4 },
  logContentLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#6B7280" },
  logContentText:  { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
});
