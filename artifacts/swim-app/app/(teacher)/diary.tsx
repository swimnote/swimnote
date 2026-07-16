/**
 * (teacher)/diary.tsx — 수업 일지 (thin shell)
 * 컴포넌트: components/teacher/diary/
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import { compressImageIfNeeded } from "../../utils/compressImage";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth, API_BASE } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { WeeklySchedule } from "@/components/teacher/WeeklySchedule";
import { TeacherClassGroup, SlotStatus } from "@/components/teacher/types";

import { ConfirmModal } from "@/components/common/ConfirmModal";
import AuditModal from "@/components/teacher/diary/AuditModal";
import DiaryWriteView from "@/components/teacher/diary/DiaryWriteView";
import DiaryEditView from "@/components/teacher/diary/DiaryEditView";
import DiaryHistoryList from "@/components/teacher/diary/DiaryHistoryList";
import AlbumPickerModal from "@/components/teacher/diary/AlbumPickerModal";
import MyAlbumPickerModal from "@/components/teacher/diary/MyAlbumPickerModal";
import {
  AlbumPhotoInfo, AlbumVideoInfo, DiaryEntry, DiaryTemplate, DiaryTemplateLevel, ExistingNote,
  StudentNote, StudentOption, SubView, UploadedMedia, todayStr,
} from "@/components/teacher/diary/types";
import { Clock, RotateCcw } from "lucide-react-native";
import { haptic } from "@/utils/haptic";

const C = Colors.light;

export default function TeacherDiaryScreen() {
  const { token, adminUser: user } = useAuth();
  const { themeColor } = useBrand();
  const params = useLocalSearchParams<{ classGroupId?: string; className?: string; lessonDate?: string; editDiaryId?: string; backTo?: string }>();

  const [targetDate, setTargetDate] = useState<string>(() =>
    (params.lessonDate && params.lessonDate.match(/^\d{4}-\d{2}-\d{2}$/))
      ? params.lessonDate : todayStr()
  );

  const DAY_KO_IDX = ["일", "월", "화", "수", "목", "금", "토"];

  function getDateForKoDay(dayKo: string, refDate: string): string {
    const targetIdx = DAY_KO_IDX.indexOf(dayKo);
    if (targetIdx === -1) return refDate;
    const ref = new Date(refDate + "T12:00:00");
    const diff = targetIdx - ref.getDay();
    const d = new Date(ref);
    d.setDate(d.getDate() + diff);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  const selectedDayKo = DAY_KO_IDX[new Date(targetDate + "T12:00:00").getDay()];

  const [groups,     setGroups]     = useState<TeacherClassGroup[]>([]);
  const [diarySet,   setDiarySet]   = useState<Set<string>>(new Set());
  const [attMap,     setAttMap]     = useState<Record<string, number>>({});
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [selectedGroup, setSelectedGroup] = useState<TeacherClassGroup | null>(null);
  const [subView,       setSubView]       = useState<SubView>("write");

  const [templates,      setTemplates]      = useState<DiaryTemplate[]>([]);
  const [levels,         setLevels]         = useState<DiaryTemplateLevel[]>([]);
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

  // 마지막으로 처리한 param 값을 저장 — classGroupId가 바뀔 때마다 재처리
  const handledParamKey = useRef<string | undefined>(undefined);

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

  const [showAlbumPicker,     setShowAlbumPicker]     = useState(false);
  const [selectedAlbumIds,    setSelectedAlbumIds]    = useState<string[]>([]);
  const [selectedAlbumPhotos, setSelectedAlbumPhotos] = useState<AlbumPhotoInfo[]>([]);

  const [showStudentAlbumPicker,     setShowStudentAlbumPicker]     = useState(false);
  const [studentAlbumPickerTarget,   setStudentAlbumPickerTarget]   = useState<StudentOption | null>(null);
  const [studentAlbumPhotos,         setStudentAlbumPhotos]         = useState<Record<string, AlbumPhotoInfo[]>>({});

  const [studentAlbumVideos,     setStudentAlbumVideos]     = useState<Record<string, AlbumVideoInfo[]>>({});
  const [showGroupMyAlbum,       setShowGroupMyAlbum]       = useState(false);
  const [groupMyAlbumMediaType,  setGroupMyAlbumMediaType]  = useState<"photo" | "video">("photo");
  const [showStudentMyAlbum,     setShowStudentMyAlbum]     = useState(false);
  const [studentMyAlbumTarget,   setStudentMyAlbumTarget]   = useState<StudentOption | null>(null);
  const [studentMyAlbumMediaType,setStudentMyAlbumMediaType]= useState<"photo" | "video">("photo");

  const [selectedAlbumVideos,  setSelectedAlbumVideos]  = useState<AlbumVideoInfo[]>([]);

  const [showEditAlbumPicker,         setShowEditAlbumPicker]         = useState(false);
  const [showEditStudentAlbumPicker,  setShowEditStudentAlbumPicker]  = useState(false);
  const [editLinkedPhotos,     setEditLinkedPhotos]     = useState<AlbumPhotoInfo[]>([]);
  const [editRemovedPhotoIds,  setEditRemovedPhotoIds]  = useState<string[]>([]);
  const [editNewAlbumIds,      setEditNewAlbumIds]      = useState<string[]>([]);
  const [editNewAlbumPhotos,   setEditNewAlbumPhotos]   = useState<AlbumPhotoInfo[]>([]);
  const [editLinkedVideos,     setEditLinkedVideos]     = useState<AlbumVideoInfo[]>([]);
  const [editRemovedVideoIds,  setEditRemovedVideoIds]  = useState<string[]>([]);
  const [editNewAlbumVideos,   setEditNewAlbumVideos]   = useState<AlbumVideoInfo[]>([]);

  type PlanFeatures = { video_enabled: boolean; storage_quota_gb: number; storage_used_gb: number; storage_used_pct: number; upload_blocked: boolean; tier: string };
  const [planFeatures, setPlanFeatures] = useState<PlanFeatures>({ video_enabled: false, storage_quota_gb: 0, storage_used_gb: 0, storage_used_pct: 0, upload_blocked: false, tier: "free" });
  const [showVideoGateModal, setShowVideoGateModal] = useState(false);
  const [showStorageModal,   setShowStorageModal]   = useState(false);

  const load = useCallback(async () => {
    try {
      const [cgRes, attRes, dRes, featRes] = await Promise.all([
        apiRequest(token, "/class-groups?mine=true"),
        apiRequest(token, `/attendance?date=${targetDate}`),
        apiRequest(token, `/diaries?lesson_date=${targetDate}`),
        apiRequest(token, "/billing/features"),
      ]);
      if (featRes.ok) {
        const feat = await featRes.json().catch(() => null);
        if (feat) setPlanFeatures(feat);
      }
      let groupsList: TeacherClassGroup[] = [];
      if (cgRes.ok) {
        const allGroups: any[] = await cgRes.json();
        const uid = user?.id;
        groupsList = uid
          ? allGroups.filter((g: any) =>
              g.teacher_user_id === uid ||
              (Array.isArray(g.co_teacher_ids) && g.co_teacher_ids.includes(uid))
            )
          : allGroups;
        setGroups(groupsList);
      }
      if (attRes.ok) {
        const arr: any[] = await attRes.json();
        const map: Record<string, number> = {};
        arr.forEach(a => { const cid = a.class_group_id || a.class_id; if (cid) map[cid] = (map[cid] || 0) + 1; });
        setAttMap(map);
      }
      if (dRes.ok) {
        const arr: any[] = await dRes.json();
        setDiarySet(new Set(arr.map((d: any) => d.class_group_id && d.lesson_date ? `${d.class_group_id}_${d.lesson_date}` : null).filter(Boolean) as string[]));
      }
      // classGroupId가 바뀔 때마다 재처리 (동일 값이면 skip)
      const paramKey = params.classGroupId ?? params.editDiaryId;
      if (paramKey && paramKey !== handledParamKey.current) {
        handledParamKey.current = paramKey;
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
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token, targetDate, params.classGroupId, params.editDiaryId]);

  useEffect(() => { load(); }, [load]);

  async function openGroup(group: TeacherClassGroup) {
    setSelectedGroup(group); setSubView("write"); setCommonContent(""); setStudentNotes([]);
    setGroupMedia([]); setStudentMedia({}); setHasDraft(false);
    setSelectedAlbumIds([]); setSelectedAlbumPhotos([]); setSelectedAlbumVideos([]);
    loadTemplates(); loadClassStudents(group.id);
    // 오늘 일지가 있으면 히스토리 뷰로 자동 전환
    try {
      const r = await apiRequest(token, `/diaries?class_group_id=${group.id}`);
      if (r.ok) {
        const data = await r.json();
        const list: DiaryEntry[] = Array.isArray(data) ? data : [];
        setDiaries(list);
        const todayExists = list.some(d => d.lesson_date === targetDate);
        if (todayExists) { setSubView("history"); return; }
      }
    } catch {}
    // 오늘 일지 없으면 임시저장 확인
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
    try {
      const [tr, lr] = await Promise.all([
        apiRequest(token, "/diary-templates"),
        apiRequest(token, "/diary-template-levels"),
      ]);
      if (tr.ok) setTemplates(await tr.json());
      if (lr.ok) setLevels(await lr.json());
    } catch {}
  }
  async function loadClassStudents(classId: string) {
    try {
      const [studentsRes, makeupRes] = await Promise.all([
        apiRequest(token, `/students?class_group_id=${classId}`),
        apiRequest(token, `/attendance/makeup-students?class_group_id=${classId}&date=${targetDate}`),
      ]);
      const list: any[] = studentsRes.ok ? (await studentsRes.json().catch(() => [])) : [];
      const makeupList: any[] = makeupRes.ok ? (await makeupRes.json().catch(() => [])) : [];

      const regularStudents = list.filter((s: any) =>
        !["deleted", "archived"].includes(s.status) &&
        (s.class_group_id === classId ||
          (Array.isArray(s.assigned_class_ids) && s.assigned_class_ids.includes(classId)))
      );

      // 보충수업 학생은 정규 학생 목록에 없으면 추가 (is_makeup 플래그)
      const regularIds = new Set(regularStudents.map((s: any) => s.id));
      const makeupStudents = makeupList
        .filter((m: any) => !regularIds.has(m.id))
        .map((m: any) => ({ ...m, is_makeup: true }));

      setClassStudents([...regularStudents, ...makeupStudents]);
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
      for (const asset of result.assets) {
        const uri = kind === "photo" ? await compressImageIfNeeded(asset.uri, asset.fileSize ?? undefined) : asset.uri;
        form.append(kind === "video" ? "video" : "photos", { uri, name: asset.fileName || (kind === "video" ? "video.mp4" : "photo.jpg"), type: asset.mimeType || (kind === "video" ? "video/mp4" : "image/jpeg") } as any);
      }
      form.append("class_id", selectedGroup.id); form.append("caption", caption);
      form.append("lesson_date", targetDate);
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
      for (const asset of result.assets) {
        const uri = kind === "photo" ? await compressImageIfNeeded(asset.uri, asset.fileSize ?? undefined) : asset.uri;
        form.append(kind === "video" ? "video" : "photos", { uri, name: asset.fileName || (kind === "video" ? "video.mp4" : "photo.jpg"), type: asset.mimeType || (kind === "video" ? "video/mp4" : "image/jpeg") } as any);
      }
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
    const glue   = before.length > 0 && !before.endsWith("\n") ? "\n\n" : (before.length > 0 && !before.endsWith("\n\n") && before.endsWith("\n") ? "\n" : "");
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

    // 입력 중인 개인 일지가 있으면 목록에 자동 추가
    let effectiveNotes = [...studentNotes];
    if (addNoteStudent && noteInput.trim()) {
      const idx = effectiveNotes.findIndex(n => n.student_id === addNoteStudent!.id);
      if (idx >= 0) {
        effectiveNotes[idx] = { ...effectiveNotes[idx], note_content: noteInput.trim() };
      } else {
        effectiveNotes.push({ student_id: addNoteStudent.id, student_name: addNoteStudent.name, note_content: noteInput.trim() });
      }
    }

    const hasAnyMedia =
      groupMedia.some(m => m.uploaded) ||
      selectedAlbumPhotos.length > 0 ||
      selectedAlbumVideos.length > 0 ||
      Object.values(studentMedia).flat().some(m => m.uploaded) ||
      Object.values(studentAlbumPhotos).some(arr => arr.length > 0) ||
      Object.values(studentAlbumVideos).some(arr => arr.length > 0);
    const hasAnyContent = commonContent.trim().length > 0 || effectiveNotes.some(n => n.note_content?.trim()) || hasAnyMedia;
    if (!hasAnyContent) { setFormError("전체 일지 또는 개인 일지 내용이나 사진/영상을 추가해주세요."); return; }
    setFormError(null); setSaving(true);
    try {
      const r = await apiRequest(token, "/diaries", {
        method: "POST",
        body: JSON.stringify({ class_group_id: selectedGroup.id, lesson_date: targetDate, common_content: commonContent.trim(), student_notes: effectiveNotes.map(n => ({ student_id: n.student_id, note_content: n.note_content })) }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "저장 실패");
      const savedDiaryId = data.diary_id || data.id;
      // 앨범 사진 연결
      if (selectedAlbumIds.length > 0 && savedDiaryId) {
        await apiRequest(token, "/photos/diary-attach", {
          method: "POST",
          body: JSON.stringify({ diary_id: savedDiaryId, photo_ids: selectedAlbumIds }),
        }).catch(() => {});
      }
      // 앨범 영상 연결
      if (selectedAlbumVideos.length > 0 && savedDiaryId) {
        await apiRequest(token, "/videos/diary-attach", {
          method: "POST",
          body: JSON.stringify({ diary_id: savedDiaryId, video_ids: selectedAlbumVideos.map(v => v.id) }),
        }).catch(() => {});
      }
      // 학생별 앨범 사진/영상 연결
      if (data.student_notes && Array.isArray(data.student_notes)) {
        for (const note of data.student_notes) {
          const photos = studentAlbumPhotos[note.student_id] ?? [];
          if (photos.length > 0) {
            await apiRequest(token, "/photos/note-attach", {
              method: "POST",
              body: JSON.stringify({ note_id: note.id, photo_ids: photos.map((p: AlbumPhotoInfo) => p.id) }),
            }).catch(() => {});
          }
          const vids = studentAlbumVideos[note.student_id] ?? [];
          if (vids.length > 0) {
            await apiRequest(token, "/videos/note-attach", {
              method: "POST",
              body: JSON.stringify({ note_id: note.id, video_ids: vids.map((v: AlbumVideoInfo) => v.id) }),
            }).catch(() => {});
          }
        }
      }
      setSelectedAlbumIds([]); setSelectedAlbumPhotos([]); setSelectedAlbumVideos([]);
      setStudentAlbumPhotos({}); setStudentAlbumVideos({});
      setStudentNotes([]); setCommonContent(""); setAddNoteStudent(null); setNoteInput("");
      setDiarySet(prev => new Set([...prev, `${selectedGroup.id}_${targetDate}`]));
      if (draftKey) await AsyncStorage.removeItem(draftKey).catch(() => {});
      setHasDraft(false);
      haptic.success();
      setSaveMsg({ type: "success", text: "수업 일지가 저장되었습니다. 학부모에게 알림이 발송됩니다." });
      const cameFromExternal = !!(params.lessonDate && params.lessonDate.match(/^\d{4}-\d{2}-\d{2}$/)) || !!(params.backTo) || !!(params.classGroupId);
      const savedGroupId = selectedGroup.id;
      setTimeout(() => { setSaveMsg(null); if (cameFromExternal) router.back(); else setSelectedGroup(prev => prev?.id === savedGroupId ? null : prev); }, 2000);
    } catch (e: any) { setSaveMsg({ type: "error", text: e.message || "저장 중 오류가 발생했습니다." }); }
    finally { setSaving(false); }
  }

  async function openEditDiary(item: DiaryEntry) {
    setEditDiary(item); setEditContent(item.common_content || "");
    setEditNotes([]); setEditNewNotes([]); setEditAddStudent(null); setEditAddInput(""); setEditError(null);
    setEditLinkedPhotos([]); setEditRemovedPhotoIds([]); setEditNewAlbumIds([]); setEditNewAlbumPhotos([]);
    setEditLinkedVideos([]); setEditRemovedVideoIds([]); setEditNewAlbumVideos([]);
    setStudentAlbumPhotos({}); setStudentAlbumVideos({}); setStudentAlbumPickerTarget(null);
    setSubView("edit"); setEditLoading(true);
    try {
      const [diaryRes, photoRes, videoRes] = await Promise.all([
        apiRequest(token, `/diaries/${item.id}`),
        apiRequest(token, `/photos/diary/${item.id}`),
        apiRequest(token, `/videos/diary/${item.id}`),
      ]);
      if (!diaryRes.ok) throw new Error("불러오기 실패");
      const data = await diaryRes.json();
      setEditDiary(data); setEditContent(data.common_content || "");
      setEditNotes(Array.isArray(data.student_notes) ? data.student_notes.map((n: any) => ({ ...n })) : []);
      if (photoRes.ok) {
        const photoData = await photoRes.json();
        setEditLinkedPhotos(Array.isArray(photoData.photos) ? photoData.photos : []);
      }
      if (videoRes.ok) {
        const videoData = await videoRes.json();
        setEditLinkedVideos(Array.isArray(videoData.videos) ? videoData.videos : []);
      }
    } catch (e: any) { setEditError(e.message || "불러오기 오류"); }
    finally { setEditLoading(false); }
  }

  async function handleEditSave() {
    if (!editDiary || !selectedGroup) return;
    const hasEditMedia =
      editLinkedPhotos.length > 0 ||
      editLinkedVideos.length > 0 ||
      editNewAlbumIds.length > 0 ||
      editNewAlbumVideos.length > 0;
    const hasEditContent = editContent.trim().length > 0 || editNotes.some(n => !n._deleted && n.note_content?.trim()) || editNewNotes.some(n => n.note_content?.trim()) || hasEditMedia;
    if (!hasEditContent) { setEditError("전체 일지 또는 개인 일지 내용이나 사진/영상을 추가해주세요."); return; }
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
      const savedEditNoteIds: Record<string, string> = {};
      for (const note of editNewNotes) {
        const r2 = await apiRequest(token, `/diaries/${editDiary.id}/student-notes`, { method: "POST", body: JSON.stringify({ student_id: note.student_id, note_content: note.note_content }) });
        if (r2.ok) { const d2 = await r2.json(); if (d2.note_id) savedEditNoteIds[note.student_id] = d2.note_id; }
      }
      // 기존 note 학생별 사진/영상 연결
      for (const note of editNotes) {
        if (!note._deleted) {
          const photos = studentAlbumPhotos[note.student_id] ?? [];
          if (photos.length > 0) await apiRequest(token, "/photos/note-attach", { method: "POST", body: JSON.stringify({ note_id: note.id, photo_ids: photos.map((p: AlbumPhotoInfo) => p.id) }) }).catch(() => {});
          const vids = studentAlbumVideos[note.student_id] ?? [];
          if (vids.length > 0) await apiRequest(token, "/videos/note-attach", { method: "POST", body: JSON.stringify({ note_id: note.id, video_ids: vids.map((v: AlbumVideoInfo) => v.id) }) }).catch(() => {});
        }
      }
      // 신규 note 학생별 사진/영상 연결
      for (const [studentId, noteId] of Object.entries(savedEditNoteIds)) {
        const photos = studentAlbumPhotos[studentId] ?? [];
        if (photos.length > 0) await apiRequest(token, "/photos/note-attach", { method: "POST", body: JSON.stringify({ note_id: noteId, photo_ids: photos.map((p: AlbumPhotoInfo) => p.id) }) }).catch(() => {});
        const vids = studentAlbumVideos[studentId] ?? [];
        if (vids.length > 0) await apiRequest(token, "/videos/note-attach", { method: "POST", body: JSON.stringify({ note_id: noteId, video_ids: vids.map((v: AlbumVideoInfo) => v.id) }) }).catch(() => {});
      }
      // 사진 제거 (journal_id = NULL)
      if (editRemovedPhotoIds.length > 0) {
        await apiRequest(token, "/photos/diary-detach", {
          method: "POST",
          body: JSON.stringify({ photo_ids: editRemovedPhotoIds }),
        }).catch(() => {});
      }
      // 신규 앨범 사진 연결
      if (editNewAlbumIds.length > 0) {
        await apiRequest(token, "/photos/diary-attach", {
          method: "POST",
          body: JSON.stringify({ diary_id: editDiary.id, photo_ids: editNewAlbumIds }),
        }).catch(() => {});
      }
      // 영상 제거 (journal_id = NULL)
      if (editRemovedVideoIds.length > 0) {
        await apiRequest(token, "/videos/diary-detach", {
          method: "POST",
          body: JSON.stringify({ video_ids: editRemovedVideoIds }),
        }).catch(() => {});
      }
      // 신규 앨범 영상 연결
      if (editNewAlbumVideos.length > 0) {
        await apiRequest(token, "/videos/diary-attach", {
          method: "POST",
          body: JSON.stringify({ diary_id: editDiary.id, video_ids: editNewAlbumVideos.map(v => v.id) }),
        }).catch(() => {});
      }
      setEditLinkedPhotos([]); setEditRemovedPhotoIds([]); setEditNewAlbumIds([]); setEditNewAlbumPhotos([]);
      setEditLinkedVideos([]); setEditRemovedVideoIds([]); setEditNewAlbumVideos([]);
      setStudentAlbumPhotos({}); setStudentAlbumVideos({});
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
        setDiarySet(prev => { const next = new Set(prev); next.delete(`${selectedGroup.id}_${deleteTarget.lesson_date ?? targetDate}`); return next; });
        setDeleteTarget(null);
      } else { const d = await r.json(); setDeleteError(d.error || "삭제 실패"); }
    } finally { setDeleteLoading(false); }
  }

  const statusMap: Record<string, SlotStatus> = {};
  groups.forEach(g => { statusMap[g.id] = { attChecked: attMap[g.id] || 0, diaryDone: diarySet.has(`${g.id}_${targetDate}`), hasPhotos: false }; });

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
    const myDiaryExists = diarySet.has(`${group.id}_${targetDate}`);

    if (subView === "edit") {
      return (
        <SafeAreaView style={s.safe} edges={[]}>
          <SubScreenHeader
            title="일지 수정"
            subtitle={editDiary ? `${editDiary.lesson_date} · ${group.schedule_time}` : ""}
            onBack={() => { if (params.editDiaryId || params.backTo || params.classGroupId) router.back(); else { setSubView("history"); setEditDiary(null); } }}
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
            onBack={() => { if (params.editDiaryId || params.backTo || params.classGroupId) router.back(); else { setSubView("history"); setEditDiary(null); } }}
            onUpdateNoteContent={(noteId, content) => setEditNotes(prev => prev.map(n => n.id === noteId ? { ...n, note_content: content, _modified: true } : n))}
            onMarkNoteDeleted={(noteId) => setEditNotes(prev => prev.map(n => n.id === noteId ? { ...n, _deleted: true } : n))}
            onEditAddNote={() => {
              if (!editAddStudent || !editAddInput.trim()) return;
              setEditNewNotes(prev => [...prev, { student_id: editAddStudent!.id, student_name: editAddStudent!.name, note_content: editAddInput.trim() }]);
              setEditAddStudent(null); setEditAddInput("");
            }}
            onRemoveNewNote={(idx) => setEditNewNotes(prev => prev.filter((_, i) => i !== idx))}
            insertAtCursor={insertAtCursor}
            token={token || ""}
            linkedPhotos={editLinkedPhotos}
            onRemoveLinkedPhoto={(id) => {
              setEditRemovedPhotoIds(prev => [...prev, id]);
              setEditLinkedPhotos(prev => prev.filter(p => p.id !== id));
            }}
            onOpenAlbumPicker={() => setShowEditAlbumPicker(true)}
            newAlbumPhotos={editNewAlbumPhotos}
            onRemoveNewAlbumPhoto={(id) => {
              setEditNewAlbumIds(prev => prev.filter(i => i !== id));
              setEditNewAlbumPhotos(prev => prev.filter(p => p.id !== id));
            }}
            linkedVideos={editLinkedVideos}
            onRemoveLinkedVideo={(id) => {
              setEditRemovedVideoIds(prev => [...prev, id]);
              setEditLinkedVideos(prev => prev.filter(v => v.id !== id));
            }}
            newAlbumVideos={editNewAlbumVideos}
            onRemoveNewAlbumVideo={(id) => setEditNewAlbumVideos(prev => prev.filter(v => v.id !== id))}
            studentAlbumPhotos={studentAlbumPhotos}
            studentAlbumVideos={studentAlbumVideos}
            onOpenStudentAlbumPicker={(student) => { setStudentAlbumPickerTarget(student); setShowEditStudentAlbumPicker(true); }}
            onRemoveStudentAlbumPhoto={(studentId, photoId) => setStudentAlbumPhotos(prev => ({ ...prev, [studentId]: (prev[studentId] ?? []).filter(p => p.id !== photoId) }))}
            onRemoveStudentAlbumVideo={(studentId, videoId) => setStudentAlbumVideos(prev => ({ ...prev, [studentId]: (prev[studentId] ?? []).filter(v => v.id !== videoId) }))}
          />
          <AlbumPickerModal
            visible={showEditAlbumPicker}
            token={token || ""}
            initialSelected={editNewAlbumIds}
            onConfirm={({ photos, videos }) => { setEditNewAlbumIds(photos.map(p => p.id)); setEditNewAlbumPhotos(photos); setEditNewAlbumVideos(videos); setShowEditAlbumPicker(false); }}
            onClose={() => setShowEditAlbumPicker(false)}
          />
          <AlbumPickerModal
            visible={showEditStudentAlbumPicker}
            token={token || ""}
            initialSelected={studentAlbumPickerTarget ? (studentAlbumPhotos[studentAlbumPickerTarget.id] ?? []).map(p => p.id) : []}
            onConfirm={({ photos }) => {
              if (studentAlbumPickerTarget) setStudentAlbumPhotos(prev => ({ ...prev, [studentAlbumPickerTarget.id]: photos }));
              setShowEditStudentAlbumPicker(false); setStudentAlbumPickerTarget(null);
            }}
            onClose={() => { setShowEditStudentAlbumPicker(false); setStudentAlbumPickerTarget(null); }}
          />
        </SafeAreaView>
      );
    }

    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <SubScreenHeader
          title={group.name}
          subtitle={`${targetDate} · ${group.schedule_time}`}
          onBack={() => {
            if (params.backTo || params.classGroupId) { router.back(); }
            else { setSelectedGroup(null); }
          }}
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

            commonContent={commonContent} setCommonContent={setCommonContent}
            classStudents={classStudents} studentNotes={studentNotes}
            addNoteStudent={addNoteStudent} setAddNoteStudent={setAddNoteStudent}
            noteInput={noteInput} setNoteInput={setNoteInput}
            saving={saving} formError={formError} saveMsg={saveMsg}
            groupMedia={groupMedia} studentMedia={studentMedia} mediaUploading={mediaUploading}
            showPickerFor={showPickerFor} setShowPickerFor={setShowPickerFor}
            commonCursorRef={commonCursorRef} noteCursorRef={noteCursorRef}
            onSave={handleSave}
            onBack={() => {
              if (params.backTo || params.classGroupId) { router.back(); }
              else { setSelectedGroup(null); }
            }}
            onUploadGroupMedia={uploadGroupMedia}
            onUploadStudentMedia={uploadStudentMedia}
            onAddNote={handleAddNote}
            onRemoveNote={(studentId) => setStudentNotes(prev => prev.filter(n => n.student_id !== studentId))}
            insertAtCursor={insertAtCursor}
            token={token || ""}
            onOpenAlbumPicker={() => setShowAlbumPicker(true)}
            selectedAlbumPhotos={selectedAlbumPhotos}
            onRemoveAlbumPhoto={(id) => {
              setSelectedAlbumIds(prev => prev.filter(i => i !== id));
              setSelectedAlbumPhotos(prev => prev.filter(p => p.id !== id));
            }}
            selectedAlbumVideos={selectedAlbumVideos}
            onRemoveAlbumVideo={(id) => setSelectedAlbumVideos(prev => prev.filter(v => v.id !== id))}
            onOpenStudentAlbumPicker={(student) => { setStudentAlbumPickerTarget(student); setShowStudentAlbumPicker(true); }}
            studentAlbumPhotos={studentAlbumPhotos}
            onRemoveStudentAlbumPhoto={(studentId, photoId) => setStudentAlbumPhotos(prev => ({ ...prev, [studentId]: (prev[studentId] ?? []).filter(p => p.id !== photoId) }))}
            studentAlbumVideos={studentAlbumVideos}
            onRemoveStudentAlbumVideo={(studentId, videoId) => setStudentAlbumVideos(prev => ({ ...prev, [studentId]: (prev[studentId] ?? []).filter(v => v.id !== videoId) }))}
            onOpenGroupMyAlbum={(kind) => {
              if (kind === "video" && !planFeatures?.video_enabled) { setShowVideoGateModal(true); return; }
              setGroupMyAlbumMediaType(kind);
              setShowGroupMyAlbum(true);
            }}
            onOpenStudentMyAlbum={(student, kind) => {
              if (kind === "video" && !planFeatures?.video_enabled) { setShowVideoGateModal(true); return; }
              setStudentMyAlbumTarget(student);
              setStudentMyAlbumMediaType(kind);
              setShowStudentMyAlbum(true);
            }}
            videoEnabled={planFeatures?.video_enabled ?? false}
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
          message="동영상 업로드는 프리미어 플랜부터 사용할 수 있습니다."
          confirmText="플랜 업그레이드"
          cancelText="닫기"
          onConfirm={() => { setShowVideoGateModal(false); router.push("/(admin)/billing" as any); }}
          onCancel={() => setShowVideoGateModal(false)}
        />
        <AlbumPickerModal
          visible={showAlbumPicker}
          token={token || ""}
          initialSelected={selectedAlbumIds}
          onConfirm={({ photos, videos }) => { setSelectedAlbumIds(photos.map(p => p.id)); setSelectedAlbumPhotos(photos); setSelectedAlbumVideos(videos); setShowAlbumPicker(false); }}
          onClose={() => setShowAlbumPicker(false)}
        />
        <AlbumPickerModal
          visible={showStudentAlbumPicker}
          token={token || ""}
          initialSelected={studentAlbumPickerTarget ? (studentAlbumPhotos[studentAlbumPickerTarget.id] ?? []).map(p => p.id) : []}
          onConfirm={({ photos }) => {
            if (studentAlbumPickerTarget) {
              setStudentAlbumPhotos(prev => ({ ...prev, [studentAlbumPickerTarget.id]: photos }));
            }
            setShowStudentAlbumPicker(false);
            setStudentAlbumPickerTarget(null);
          }}
          onClose={() => { setShowStudentAlbumPicker(false); setStudentAlbumPickerTarget(null); }}
        />
        <MyAlbumPickerModal
          visible={showGroupMyAlbum}
          mediaType={groupMyAlbumMediaType}
          token={token}
          onClose={() => setShowGroupMyAlbum(false)}
          onConfirm={(photos, videos) => {
            if (photos.length > 0) {
              setSelectedAlbumPhotos(prev => {
                const existing = new Set(prev.map(p => p.id));
                return [...prev, ...photos.filter(p => !existing.has(p.id))];
              });
              setSelectedAlbumIds(prev => [...new Set([...prev, ...photos.map(p => p.id)])]);
            }
            if (videos.length > 0) {
              setSelectedAlbumVideos(prev => {
                const existing = new Set(prev.map(v => v.id));
                return [...prev, ...videos.filter(v => !existing.has(v.id))];
              });
            }
            setShowGroupMyAlbum(false);
          }}
        />
        <MyAlbumPickerModal
          visible={showStudentMyAlbum}
          mediaType={studentMyAlbumMediaType}
          token={token}
          onClose={() => { setShowStudentMyAlbum(false); setStudentMyAlbumTarget(null); }}
          onConfirm={(photos, videos) => {
            if (studentMyAlbumTarget) {
              const sid = studentMyAlbumTarget.id;
              if (photos.length > 0) {
                setStudentAlbumPhotos(prev => {
                  const existing = new Set((prev[sid] ?? []).map(p => p.id));
                  return { ...prev, [sid]: [...(prev[sid] ?? []), ...photos.filter(p => !existing.has(p.id))] };
                });
              }
              if (videos.length > 0) {
                setStudentAlbumVideos(prev => {
                  const existing = new Set((prev[sid] ?? []).map(v => v.id));
                  return { ...prev, [sid]: [...(prev[sid] ?? []), ...videos.filter(v => !existing.has(v.id))] };
                });
              }
            }
            setShowStudentMyAlbum(false);
            setStudentMyAlbumTarget(null);
          }}
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

  function handleDayChange(day: string) {
    const newDate = getDateForKoDay(day, targetDate);
    if (newDate !== targetDate) {
      setTargetDate(newDate);
      setSelectedGroup(null);
    }
  }

  function formatTargetDate(dateStr: string): string {
    const [, m, d] = dateStr.split("-");
    return `${parseInt(m)}월 ${parseInt(d)}일`;
  }

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="수업 일지" homePath="/(teacher)/today-schedule" />
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
        <View style={s.dateLabelRow}>
          <Text style={s.dateLabel}>{formatTargetDate(targetDate)}</Text>
        </View>
        <WeeklySchedule
          classGroups={groups} statusMap={statusMap} onSelectClass={openGroup} themeColor={themeColor}
          selectedDay={selectedDayKo}
          onDayChange={handleDayChange}
        />
        <View style={{ height: 120 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#FFFFFF" },
  subHeader:    { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  tabBtn:       { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1.5 },
  tabBtnText:   { fontSize: 12, fontFamily: "Pretendard-Regular" },
  dateLabelRow: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 2 },
  dateLabel:    { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#6B7280" },
});
