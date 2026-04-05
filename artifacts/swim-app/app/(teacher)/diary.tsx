/**
 * (teacher)/diary.tsx — 수업 일지 (thin shell)
 * 컴포넌트: components/teacher/diary/
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { WeeklySchedule } from "@/components/teacher/WeeklySchedule";
import { TeacherClassGroup, SlotStatus } from "@/components/teacher/types";

import { ConfirmModal } from "@/components/common/ConfirmModal";
import AuditModal from "@/components/teacher/diary/AuditModal";
import DiaryWriteView from "@/components/teacher/diary/DiaryWriteView";
import DiaryEditView from "@/components/teacher/diary/DiaryEditView";
import DiaryHistoryList from "@/components/teacher/diary/DiaryHistoryList";
import {
  API_BASE, DiaryEntry, DiaryTemplate, ExistingNote,
  StudentNote, StudentOption, SubView, UploadedMedia, todayStr,
} from "@/components/teacher/diary/types";
import { Clock, RotateCcw } from "lucide-react-native";
import { haptic } from "@/utils/haptic";

const C = Colors.light;

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

  const [groupMedia,   setGroupMedia]   = useState<UploadedMedia[]>([]);
  const [studentMedia, setStudentMedia] = useState<Record<string, UploadedMedia[]>>({});
  const [mediaUploading, setMediaUploading] = useState<string | null>(null);

  const [diaries,      setDiaries]      = useState<DiaryEntry[]>([]);
  const [diaryLoading, setDiaryLoading] = useState(false);
  const [auditTarget,  setAuditTarget]  = useState<string | null>(null);

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
  const editCursorRef = useRef<number>(0);

  const [saveMsg,       setSaveMsg]       = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [formError,     setFormError]     = useState<string | null>(null);

  const [hasDraft,      setHasDraft]      = useState(false);

  const draftKey = selectedGroup
    ? `@swimnote:diary_draft:${selectedGroup.id}:${targetDate}`
    : null;

  useEffect(() => {
    if (!draftKey || subView !== "write") return;
    const hasContent = commonContent.trim().length > 0 || studentNotes.length > 0;
    if (!hasContent) return;
    const timer = setTimeout(() => {
      AsyncStorage.setItem(draftKey, JSON.stringify({ commonContent, studentNotes })).catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [commonContent, studentNotes, draftKey, subView]);
  const [deleteTarget,  setDeleteTarget]  = useState<DiaryEntry | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError,   setDeleteError]   = useState<string | null>(null);

  type PlanFeatures = { video_enabled: boolean; storage_quota_gb: number; storage_used_gb: number; storage_used_pct: number; upload_blocked: boolean; tier: string };
  const [planFeatures, setPlanFeatures] = useState<PlanFeatures>({ video_enabled: false, storage_quota_gb: 0, storage_used_gb: 0, storage_used_pct: 0, upload_blocked: false, tier: "free" });
  const [showVideoGateModal, setShowVideoGateModal] = useState(false);
  const [showStorageModal,   setShowStorageModal]   = useState(false);

  const load = useCallback(async () => {
    try {
      const [cgRes, attRes, dRes, featRes] = await Promise.all([
        apiRequest(token, "/class-groups"),
        apiRequest(token, `/attendance?date=${targetDate}`),
        apiRequest(token, `/diaries?lesson_date=${targetDate}`),
        apiRequest(token, "/billing/features"),
      ]);
      if (featRes.ok) {
        const feat = await featRes.json().catch(() => null);
        if (feat) setPlanFeatures(feat);
      }
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
              setEditNewNotes([]); setEditAddStudent(null); setEditAddInput(""); setEditError(null);
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

  async function openGroup(group: TeacherClassGroup) {
    setSelectedGroup(group); setSubView("write"); setCommonContent(""); setStudentNotes([]);
    setShowTemplates(false); setGroupMedia([]); setStudentMedia({}); setHasDraft(false);
    loadTemplates(); loadClassStudents(group.id); loadDiaries(group.id);
    try {
      const key = `@swimnote:diary_draft:${group.id}:${targetDate}`;
      const saved = await AsyncStorage.getItem(key);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.commonContent?.trim() || parsed.studentNotes?.length > 0) {
          setHasDraft(true);
        }
      }
    } catch {}
  }

  async function restoreDraft() {
    if (!draftKey) return;
    try {
      const saved = await AsyncStorage.getItem(draftKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        setCommonContent(parsed.commonContent ?? "");
        setStudentNotes(parsed.studentNotes ?? []);
        setHasDraft(false);
        haptic.success();
      }
    } catch {}
  }

  async function discardDraft() {
    if (!draftKey) return;
    await AsyncStorage.removeItem(draftKey).catch(() => {});
    setHasDraft(false);
    haptic.light();
  }
  async function loadTemplates() {
    try { const r = await apiRequest(token, "/diary-templates"); if (r.ok) setTemplates(await r.json()); } catch {}
  }
  async function loadClassStudents(classId: string) {
    try {
      const r = await apiRequest(token, `/class-groups/${classId}/students`);
      if (r.ok) { const data = await r.json(); setClassStudents(Array.isArray(data) ? data : []); }
    } catch {}
  }
  async function loadDiaries(classId: string) {
    setDiaryLoading(true);
    try {
      const r = await apiRequest(token, `/diaries?class_group_id=${classId}`);
      if (r.ok) { const data = await r.json(); setDiaries(Array.isArray(data) ? data : []); }
    } catch {} finally { setDiaryLoading(false); }
  }

  async function uploadGroupMedia(kind: "photo" | "video") {
    if (!selectedGroup) return;
    if (kind === "video" && !planFeatures.video_enabled) { setShowVideoGateModal(true); return; }
    if (planFeatures.storage_used_pct >= 100) { setShowStorageModal(true); return; }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: kind === "video" ? ["videos"] : ["images"],
      allowsMultipleSelection: kind !== "video", quality: kind === "video" ? 1 : 0.85,
    });
    if (result.canceled || !result.assets?.length) return;
    const caption = `${selectedGroup.schedule_days || ""} ${selectedGroup.schedule_time || ""}반 일지`.trim() || `${selectedGroup.name} 일지`;
    setMediaUploading("group");
    const newItems: UploadedMedia[] = result.assets.map(a => ({ uri: a.uri, kind, uploading: true, uploaded: false }));
    setGroupMedia(prev => [...prev, ...newItems]);
    try {
      const form = new FormData();
      for (const asset of result.assets) { form.append(kind === "video" ? "video" : "photos", { uri: asset.uri, name: asset.fileName || (kind === "video" ? "video.mp4" : "photo.jpg"), type: asset.mimeType || (kind === "video" ? "video/mp4" : "image/jpeg") } as any); }
      form.append("class_id", selectedGroup.id); form.append("caption", caption);
      const endpoint = kind === "video" ? "/videos/group" : "/photos/group";
      const res = await fetch(`${API_BASE}${endpoint}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as any;
        throw new Error(errData?.error || `업로드 실패 (${res.status})`);
      }
      setGroupMedia(prev => prev.map(m => newItems.find(n => n.uri === m.uri) ? { ...m, uploading: false, uploaded: true } : m));
    } catch (e) {
      console.error("[uploadGroupMedia] error:", e);
      setGroupMedia(prev => prev.map(m => newItems.find(n => n.uri === m.uri) ? { ...m, uploading: false, error: String((e as Error)?.message || "실패") } : m));
    } finally { setMediaUploading(null); }
  }

  async function uploadStudentMedia(student: StudentOption, kind: "photo" | "video") {
    if (kind === "video" && !planFeatures.video_enabled) { setShowVideoGateModal(true); return; }
    if (planFeatures.storage_used_pct >= 100) { setShowStorageModal(true); return; }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: kind === "video" ? ["videos"] : ["images"],
      allowsMultipleSelection: kind !== "video", quality: kind === "video" ? 1 : 0.85,
    });
    if (result.canceled || !result.assets?.length) return;
    setMediaUploading(student.id);
    const newItems: UploadedMedia[] = result.assets.map(a => ({ uri: a.uri, kind, uploading: true, uploaded: false }));
    setStudentMedia(prev => ({ ...prev, [student.id]: [...(prev[student.id] || []), ...newItems] }));
    try {
      const form = new FormData();
      for (const asset of result.assets) { form.append(kind === "video" ? "video" : "photos", { uri: asset.uri, name: asset.fileName || (kind === "video" ? "video.mp4" : "photo.jpg"), type: asset.mimeType || (kind === "video" ? "video/mp4" : "image/jpeg") } as any); }
      if (selectedGroup) form.append("class_id", selectedGroup.id);
      form.append("student_id", student.id); form.append("caption", `${student.name} 개별 일지`);
      const endpoint = kind === "video" ? "/videos/private" : "/photos/private";
      const res = await fetch(`${API_BASE}${endpoint}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as any;
        throw new Error(errData?.error || `업로드 실패 (${res.status})`);
      }
      setStudentMedia(prev => ({ ...prev, [student.id]: (prev[student.id] || []).map(m => newItems.find(n => n.uri === m.uri) ? { ...m, uploading: false, uploaded: true } : m) }));
    } catch (e) {
      console.error("[uploadStudentMedia] error:", e);
      setStudentMedia(prev => ({ ...prev, [student.id]: (prev[student.id] || []).map(m => newItems.find(n => n.uri === m.uri) ? { ...m, uploading: false, error: String((e as Error)?.message || "실패") } : m) }));
    } finally { setMediaUploading(null); }
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
      if (existing >= 0) { const next = [...prev]; next[existing] = { ...next[existing], note_content: noteInput.trim() }; return next; }
      return [...prev, { student_id: addNoteStudent!.id, student_name: addNoteStudent!.name, note_content: noteInput.trim() }];
    });
    setAddNoteStudent(null); setNoteInput("");
  }

  async function handleSave() {
    if (!selectedGroup) return;
    if (!commonContent.trim()) { setFormError("공통 일지 내용을 입력해주세요."); return; }
    setFormError(null); setSaving(true);
    try {
      const r = await apiRequest(token, "/diaries", {
        method: "POST",
        body: JSON.stringify({ class_group_id: selectedGroup.id, lesson_date: targetDate, common_content: commonContent.trim(), student_notes: studentNotes.map(n => ({ student_id: n.student_id, note_content: n.note_content })) }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "저장 실패");
      setDiarySet(prev => new Set([...prev, selectedGroup.id]));
      if (draftKey) await AsyncStorage.removeItem(draftKey).catch(() => {});
      setHasDraft(false);
      haptic.success();
      setSaveMsg({ type: "success", text: "수업 일지가 저장되었습니다. 학부모에게 알림이 발송됩니다." });
      const cameFromUnwritten = !!(params.lessonDate && params.lessonDate.match(/^\d{4}-\d{2}-\d{2}$/));
      setTimeout(() => { setSaveMsg(null); if (cameFromUnwritten) router.back(); else setSelectedGroup(null); }, 2000);
    } catch (e: any) { setSaveMsg({ type: "error", text: e.message || "저장 중 오류가 발생했습니다." }); }
    finally { setSaving(false); }
  }

  async function openEditDiary(item: DiaryEntry) {
    setEditDiary(item); setEditContent(item.common_content || "");
    setEditNotes([]); setEditNewNotes([]); setEditAddStudent(null); setEditAddInput(""); setEditError(null);
    setSubView("edit"); setEditLoading(true);
    try {
      const r = await apiRequest(token, `/diaries/${item.id}`);
      if (!r.ok) throw new Error("불러오기 실패");
      const data = await r.json();
      setEditDiary(data); setEditContent(data.common_content || "");
      setEditNotes(Array.isArray(data.student_notes) ? data.student_notes.map((n: any) => ({ ...n })) : []);
    } catch (e: any) { setEditError(e.message || "불러오기 오류"); }
    finally { setEditLoading(false); }
  }

  async function handleEditSave() {
    if (!editDiary || !selectedGroup) return;
    if (!editContent.trim()) { setEditError("일지 본문을 입력해주세요."); return; }
    setEditSaving(true); setEditError(null);
    try {
      const r = await apiRequest(token, `/diaries/${editDiary.id}`, { method: "PUT", body: JSON.stringify({ common_content: editContent.trim() }) });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || "수정 실패"); }
      for (const note of editNotes) {
        if (note._deleted) await apiRequest(token, `/diaries/student-notes/${note.id}`, { method: "DELETE" });
      }
      for (const note of editNotes) {
        if (!note._deleted && note._modified) await apiRequest(token, `/diaries/student-notes/${note.id}`, { method: "PUT", body: JSON.stringify({ note_content: note.note_content }) });
      }
      for (const note of editNewNotes) {
        await apiRequest(token, `/diaries/${editDiary.id}/student-notes`, { method: "POST", body: JSON.stringify({ student_id: note.student_id, note_content: note.note_content }) });
      }
      if (params.editDiaryId) { router.back(); }
      else { setSubView("history"); setEditDiary(null); await loadDiaries(selectedGroup.id); }
    } catch (e: any) { setEditError(e.message || "저장 중 오류가 발생했습니다."); }
    finally { setEditSaving(false); }
  }

  async function confirmDelete() {
    if (!deleteTarget || !selectedGroup) return;
    setDeleteLoading(true);
    try {
      const r = await apiRequest(token, `/diaries/${deleteTarget.id}`, { method: "DELETE" });
      if (r.ok) {
        setDiaries(prev => prev.filter(d => d.id !== deleteTarget.id));
        setDiarySet(prev => { const next = new Set(prev); next.delete(selectedGroup.id); return next; });
        setDeleteTarget(null);
      } else { const d = await r.json(); setDeleteError(d.error || "삭제 실패"); }
    } finally { setDeleteLoading(false); }
  }

  const statusMap: Record<string, SlotStatus> = {};
  groups.forEach(g => { statusMap[g.id] = { attChecked: attMap[g.id] || 0, diaryDone: diarySet.has(g.id), hasPhotos: false }; });

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <SubScreenHeader title="수업 일지" homePath="/(teacher)/today-schedule" />
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  if (selectedGroup) {
    const group = selectedGroup;
    const myDiaryExists = diarySet.has(group.id);

    if (subView === "edit") {
      return (
        <SafeAreaView style={s.safe} edges={[]}>
          <SubScreenHeader
            title="일지 수정"
            subtitle={editDiary ? `${editDiary.lesson_date} · ${group.schedule_time}` : ""}
            onBack={() => { if (params.editDiaryId) router.back(); else { setSubView("history"); setEditDiary(null); } }}
            homePath="/(teacher)/today-schedule"
          />
          <DiaryEditView
            group={group} themeColor={themeColor}
            editDiary={editDiary} editContent={editContent} setEditContent={setEditContent}
            editNotes={editNotes} editNewNotes={editNewNotes}
            editAddStudent={editAddStudent} setEditAddStudent={setEditAddStudent}
            editAddInput={editAddInput} setEditAddInput={setEditAddInput}
            editSaving={editSaving} editError={editError} setEditError={setEditError}
            editLoading={editLoading}
            editPickerFor={editPickerFor} setEditPickerFor={setEditPickerFor}
            editCursorRef={editCursorRef}
            classStudents={classStudents}
            onSave={handleEditSave}
            onBack={() => { if (params.editDiaryId) router.back(); else { setSubView("history"); setEditDiary(null); } }}
            onUpdateNoteContent={(noteId, content) => setEditNotes(prev => prev.map(n => n.id === noteId ? { ...n, note_content: content, _modified: true } : n))}
            onMarkNoteDeleted={(noteId) => setEditNotes(prev => prev.map(n => n.id === noteId ? { ...n, _deleted: true } : n))}
            onEditAddNote={() => {
              if (!editAddStudent || !editAddInput.trim()) return;
              setEditNewNotes(prev => [...prev, { student_id: editAddStudent!.id, student_name: editAddStudent!.name, note_content: editAddInput.trim() }]);
              setEditAddStudent(null); setEditAddInput("");
            }}
            onRemoveNewNote={(idx) => setEditNewNotes(prev => prev.filter((_, i) => i !== idx))}
            insertAtCursor={insertAtCursor}
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
        <View style={s.subHeader}>
          <View style={{ flex: 1 }} />
          <Pressable
            style={[s.tabBtn, { backgroundColor: subView === "history" ? themeColor : C.background, borderColor: themeColor }]}
            onPress={() => setSubView(v => v === "history" ? "write" : "history")}>
            <Clock size={13} color={subView === "history" ? "#fff" : themeColor} />
            <Text style={[s.tabBtnText, { color: subView === "history" ? "#fff" : themeColor }]}>지난 일지</Text>
          </Pressable>
        </View>

        {subView === "write" && hasDraft && (
          <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#EFF6FF", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginHorizontal: 16, marginBottom: 8, gap: 10 }}>
            <RotateCcw size={14} color="#2563EB" />
            <Text style={{ flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", color: "#1E40AF" }}>
              작성 중이던 드래프트가 있어요
            </Text>
            <Pressable onPress={restoreDraft} style={{ paddingHorizontal: 10, paddingVertical: 5, backgroundColor: "#2563EB", borderRadius: 7 }}>
              <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: "#fff" }}>복원</Text>
            </Pressable>
            <Pressable onPress={discardDraft} hitSlop={8}>
              <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: "#93C5FD" }}>삭제</Text>
            </Pressable>
          </View>
        )}

        {subView === "write" ? (
          <DiaryWriteView
            group={group} targetDate={targetDate} themeColor={themeColor} myDiaryExists={myDiaryExists}
            templates={templates} showTemplates={showTemplates} setShowTemplates={setShowTemplates}
            commonContent={commonContent} setCommonContent={setCommonContent}
            classStudents={classStudents} studentNotes={studentNotes}
            addNoteStudent={addNoteStudent} setAddNoteStudent={setAddNoteStudent}
            noteInput={noteInput} setNoteInput={setNoteInput}
            saving={saving} formError={formError} saveMsg={saveMsg}
            groupMedia={groupMedia} studentMedia={studentMedia} mediaUploading={mediaUploading}
            showPickerFor={showPickerFor} setShowPickerFor={setShowPickerFor}
            commonCursorRef={commonCursorRef} noteCursorRef={noteCursorRef}
            onSave={handleSave}
            onBack={() => setSelectedGroup(null)}
            onUploadGroupMedia={uploadGroupMedia}
            onUploadStudentMedia={uploadStudentMedia}
            onAddNote={handleAddNote}
            onRemoveNote={(studentId) => setStudentNotes(prev => prev.filter(n => n.student_id !== studentId))}
            insertAtCursor={insertAtCursor}
          />
        ) : (
          <DiaryHistoryList
            diaries={diaries} diaryLoading={diaryLoading} themeColor={themeColor}
            userId={user?.id} refreshing={refreshing}
            deleteTarget={deleteTarget} deleteLoading={deleteLoading} deleteError={deleteError}
            onRefresh={() => { setRefreshing(true); loadDiaries(group.id); setRefreshing(false); }}
            onOpenEdit={openEditDiary}
            onDelete={(diary) => { setDeleteTarget(diary); setDeleteError(null); }}
            onDeleteConfirm={confirmDelete}
            onDeleteCancel={() => setDeleteTarget(null)}
            token={token}
            classGroupId={group.id}
          />
        )}

        {auditTarget && (
          <AuditModal diaryId={auditTarget} token={token!} onClose={() => setAuditTarget(null)} />
        )}
        <ConfirmModal
          visible={showVideoGateModal}
          title="영상 업로드 불가"
          message={`현재 플랜(${planFeatures?.tier ?? "Free"})은 영상 업로드를 지원하지 않습니다.\nCenter 200 이상 플랜에서 영상을 업로드할 수 있습니다.`}
          confirmText="플랜 업그레이드"
          cancelText="닫기"
          onConfirm={() => { setShowVideoGateModal(false); router.push("/(admin)/billing" as any); }}
          onCancel={() => setShowVideoGateModal(false)}
        />
        <ConfirmModal
          visible={showStorageModal}
          title="저장공간 초과"
          message={`저장공간이 가득 찼습니다 (${planFeatures?.storage_used_pct ?? 100}% 사용 중).\n상위 플랜으로 업그레이드하거나 기존 파일을 삭제해주세요.`}
          confirmText="플랜 업그레이드"
          cancelText="닫기"
          onConfirm={() => { setShowStorageModal(false); router.push("/(admin)/billing" as any); }}
          onCancel={() => setShowStorageModal(false)}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="수업 일지" homePath="/(teacher)/today-schedule" />
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
        <WeeklySchedule classGroups={groups} statusMap={statusMap} onSelectClass={openGroup} themeColor={themeColor} />
        <View style={{ height: 120 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: "#FFFFFF" },
  subHeader:{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  tabBtn:   { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1.5 },
  tabBtnText: { fontSize: 12, fontFamily: "Pretendard-Regular" },
});
