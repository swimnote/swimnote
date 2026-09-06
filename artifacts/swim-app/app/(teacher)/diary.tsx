/**
 * (teacher)/diary.tsx — 수업 일지 (thin shell)
 * 컴포넌트: components/teacher/diary/
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import { compressImageIfNeeded } from "../../utils/compressImage";
import { deleteTempFileAfterUpload } from "@/utils/mediaCleanupV2";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, BackHandler, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth, API_BASE } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { useMode } from "@/context/ModeContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { WeeklySchedule } from "@/components/teacher/WeeklySchedule";
import { TeacherClassGroup, SlotStatus } from "@/components/teacher/types";

import { ConfirmModal } from "@/components/common/ConfirmModal";
import AuditModal from "@/components/teacher/diary/AuditModal";
import DiaryWriteView from "@/components/teacher/diary/DiaryWriteView";
import type { DiaryInsertResult } from "@/components/ai/features/diary/useDiaryAIV2";
import type { CurriculumMatch } from "@/components/ai/services/DiaryAIService";
import DiaryEditView from "@/components/teacher/diary/DiaryEditView";
import DiaryHistoryList from "@/components/teacher/diary/DiaryHistoryList";
import AlbumPickerModal from "@/components/teacher/diary/AlbumPickerModal";
import MyAlbumPickerModal from "@/components/teacher/diary/MyAlbumPickerModal";
import {
  AlbumPhotoInfo, AlbumVideoInfo, DiaryEntry, DiaryTemplate, DiaryTemplateLevel, ExistingNote,
  StudentNote, StudentOption, SubView, UploadedMedia, todayStr,
} from "@/components/teacher/diary/types";
import { LucideIcon } from "@/components/common/LucideIcon";
import { emitDiaryChanged } from "@/utils/diaryEvents";
import { BookOpen, Clock } from "lucide-react-native";
import { SessionSelectorSheet, DiarySession } from "@/components/teacher/diary/SessionSelectorSheet";
import { haptic } from "@/utils/haptic";
import { directUploadPhotos } from "@/utils/directUploadPhotos";
import { getInfoAsync } from "expo-file-system/legacy";
const C = Colors.light;
export default function TeacherDiaryScreen() {
  const { token, adminUser: user } = useAuth();
  const { themeColor } = useBrand();
  const { mode } = useMode();
  const params = useLocalSearchParams<{ classGroupId?: string; className?: string; lessonDate?: string; startTime?: string; editDiaryId?: string; backTo?: string; viewOnly?: string }>();
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
  const [classStudents,        setClassStudents]        = useState<StudentOption[]>([]);
  const [classStudentsLoading, setClassStudentsLoading] = useState(false);
  const [classStudentsLoaded,  setClassStudentsLoaded]  = useState(false);
  const [classStudentsError,   setClassStudentsError]   = useState<string | null>(null);
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
  const [pendingDiaryId,  setPendingDiaryId]  = useState<string | null>(null);
  const [pendingNoteIds,  setPendingNoteIds]  = useState<Record<string, string>>({});
  const [hasDraft,             setHasDraft]             = useState(false);
  // replace confirm — 동일 날짜+슬롯 일지 교체 확인
  const [showReplaceConfirm,   setShowReplaceConfirm]   = useState(false);
  const [replacingDiaryId,     setReplacingDiaryId]     = useState<string | null>(null);
  const [replaceLoading,       setReplaceLoading]       = useState(false);
  /** WP7: AI generate 결과의 curriculum matches — diary save 시 서버로 전달 */
  const [aiCurriculumMatches, setAiCurriculumMatches] = useState<CurriculumMatch[]>([]);
  const [startTime, setStartTime] = useState<string>(params.startTime ?? "");
  const [showSessionSelector, setShowSessionSelector] = useState(false);
  const [showSwitchConfirm, setShowSwitchConfirm] = useState(false);
  const pendingSessionRef = useRef<DiarySession | null>(null);
  const handledParamKey = useRef<string | undefined>(undefined);
  // [FIX] expo-router가 동일 route 인스턴스를 재사용할 때 targetDate가 stale 상태로 남는 버그 방지.
  // params.classGroupId / params.editDiaryId 가 변경되면(= 새 내비게이션) lessonDate를 재동기화.
  const lastNavKeyRef = useRef(`${params.classGroupId ?? ""}|${params.editDiaryId ?? ""}|${params.lessonDate ?? ""}`);
  useEffect(() => {
    const navKey = `${params.classGroupId ?? ""}|${params.editDiaryId ?? ""}|${params.lessonDate ?? ""}`;
    if (navKey !== lastNavKeyRef.current) {
      lastNavKeyRef.current = navKey;
      if (params.lessonDate && /^\d{4}-\d{2}-\d{2}$/.test(params.lessonDate)) {
        setTargetDate(params.lessonDate);
      }
      if (params.startTime) setStartTime(params.startTime);
      setSelectedGroup(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.classGroupId, params.editDiaryId, params.lessonDate, params.startTime]);
  const diariesReqVersion = useRef(0);
  const studentsReqRef    = useRef(0); // stale response 방어용 monotonic counter
  const draftKey = selectedGroup
    ? `@swimnote:diary_draft:${selectedGroup.id}:${targetDate}`
    : null;
  // 그룹/날짜 변경 시 pendingDiaryId 초기화 (다른 일지 컨텍스트에서 재시도 방지)
  useEffect(() => {
    setPendingDiaryId(null);
    setPendingNoteIds({});
  }, [selectedGroup?.id, targetDate]);
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
        const deletedInLoad = arr.filter((d: any) => d.is_deleted === true);
        if (deletedInLoad.length > 0) {
          if (__DEV__) console.error(`[LOAD] ⚠️ /diaries?lesson_date=${targetDate} returned ${deletedInLoad.length} is_deleted=true entries!`);
        }
        const keysToSet = arr.map((d: any) => d.class_group_id && d.lesson_date ? `${d.class_group_id}_${d.lesson_date}` : null).filter(Boolean) as string[];
        if (__DEV__) console.log(`[LOAD] diarySet update: count=${arr.length}`);
        setDiarySet(new Set(keysToSet));
      }
      const paramKey = params.classGroupId ?? params.editDiaryId;
      if (paramKey && paramKey !== handledParamKey.current) {
        if (params.editDiaryId) {
          handledParamKey.current = paramKey;
          try {
            const dr = await apiRequest(token, `/diaries/${params.editDiaryId}`);
            if (dr.ok) {
              const diaryData = await dr.json();
              if (diaryData.is_deleted) {
                setSaveMsg({ type: "error", text: "삭제된 일지는 수정할 수 없습니다." });
              } else {
                const group = groupsList.find(g => g.id === diaryData.class_group_id);
                if (group) {
                  setSelectedGroup(group);
                  setEditDiary(diaryData);
                  setEditContent(diaryData.common_content || "");
                  setEditNotes(Array.isArray(diaryData.student_notes) ? diaryData.student_notes.map((n: any) => ({ ...n })) : []);
                  setEditNewNotes([]); setEditAddStudent(null); setEditAddInput(""); setEditError(null);
                  setSubView("edit");
                  loadClassStudents(group.id);
                } else {
                  setSaveMsg({ type: "error", text: "수업 그룹 정보를 불러올 수 없습니다." });
                }
              }
            } else {
              setSaveMsg({ type: "error", text: "일지를 찾을 수 없습니다. 삭제되었을 수 있습니다." });
            }
          } catch {
            setSaveMsg({ type: "error", text: "일지를 불러오는 중 오류가 발생했습니다." });
          }
        } else if (params.classGroupId) {
          const found = groupsList.find(g => g.id === params.classGroupId);
          if (found) {
            // writeIntent=true: classGroupId + lessonDate 진입은 Quick Write / 미작성 수업 선택
            // → 중간 history 화면 없이 즉시 write 뷰로 진입 (§3)
            openGroup(found, undefined, true);
            handledParamKey.current = paramKey;
          }
        }
      }
    } catch (e) { if (__DEV__) console.error('[load] error:', e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token, targetDate, params.classGroupId, params.editDiaryId]);
  useEffect(() => { load(); }, [load]);
  // overrideDate: session switch 시 targetDate가 아직 React state 반영 전일 때 명시적으로 전달
  // writeIntent: true 이면 write 뷰로 즉시 진입 (Quick Write / 미작성 수업 선택 경로)
  async function openGroup(group: TeacherClassGroup, overrideDate?: string, writeIntent?: boolean) {
    // writeIntent=true (Quick Write) 이면 write 뷰로 즉시 진입, 아니면 history 뷰에서 시작
    setSelectedGroup(group); setSubView(writeIntent ? "write" : "history"); setCommonContent(""); setStudentNotes([]);
    setAddNoteStudent(null); setNoteInput("");
    setGroupMedia([]); setStudentMedia({}); setHasDraft(false);
    setSelectedAlbumIds([]); setSelectedAlbumPhotos([]); setSelectedAlbumVideos([]);
    setStudentAlbumPhotos({}); setStudentAlbumVideos({});
    // 학생 로딩 상태 초기화 — 새 그룹 진입 시 stale loaded 상태 방지
    setClassStudentsLoading(false); setClassStudentsLoaded(false); setClassStudentsError(null);
    loadTemplates(); loadClassStudents(group.id, overrideDate ?? targetDate);
    const reqVer = ++diariesReqVersion.current;
    try {
      const r = await apiRequest(token, `/diaries?class_group_id=${group.id}`);
      if (r.ok) {
        const data = await r.json();
        if (reqVer !== diariesReqVersion.current) {
          if (__DEV__) console.log(`[HISTORY LOAD] STALE IGNORED`);
          return;
        }
        const list: DiaryEntry[] = Array.isArray(data) ? data : [];
        if (__DEV__) console.log(`[HISTORY LOAD] count=${list.length}`);
        setDiaries(list);
      }
    } catch {}
    // 드래프트 감지 — overrideDate or targetDate 기준
    try {
      const key = `@swimnote:diary_draft:${group.id}:${overrideDate ?? targetDate}`;
      const saved = await AsyncStorage.getItem(key);
      if (__DEV__) console.log(`[openGroup] draft check found=${!!saved}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        const hasContent = !!(parsed.commonContent?.trim() || parsed.studentNotes?.length > 0);
        if (__DEV__) console.log(`[openGroup] draft hasContent=${hasContent} contentLength=${parsed.commonContent?.length ?? 0} notes=${parsed.studentNotes?.length}`);
        if (hasContent) {
          setHasDraft(true);
          if (__DEV__) console.log(`[openGroup] setHasDraft(true)`);
        }
      }
    } catch {}
  }
  async function restoreDraft() {
    if (__DEV__) console.log(`[restoreDraft] CALLED`);
    if (!draftKey) return;
    try {
      const saved = await AsyncStorage.getItem(draftKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (__DEV__) console.log(`[restoreDraft] 복원 contentLength=${(parsed.commonContent ?? "").length} notes=${parsed.studentNotes?.length}`);
        setCommonContent(parsed.commonContent ?? "");
        setStudentNotes(parsed.studentNotes ?? []);
        setHasDraft(false);
        haptic.success();
      }
    } catch {}
  }
  async function discardDraft() {
    await AsyncStorage.removeItem(draftKey!).catch(() => {});
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
  // lessonDate: session switch 시 state targetDate가 아직 반영 전일 때 명시적으로 전달
  async function loadClassStudents(classId: string, lessonDate?: string) {
    const dateToUse = lessonDate ?? targetDate;
    // ── 요청 ID 캡처 — stale response 방어 ────────────────────────────────
    const reqId = ++studentsReqRef.current;
    setClassStudentsLoading(true);
    setClassStudentsLoaded(false);
    setClassStudentsError(null);
    try {
      const [scheduleRes, makeupRes, attRes] = await Promise.all([
        apiRequest(token, `/today-schedule?date=${dateToUse}`),
        apiRequest(token, `/attendance/makeup-students?class_group_id=${classId}&date=${dateToUse}`),
        // 결석 학생 조회 — 전체일지 대상에서 제외하기 위해 사전 로드
        apiRequest(token, `/attendance?class_group_id=${classId}&date=${dateToUse}`),
      ]);

      // stale 응답 폐기
      if (studentsReqRef.current !== reqId) return;

      // 결석(absent) 학생 ID Set 구성
      const attList: any[] = attRes.ok ? (await attRes.json().catch(() => [])) : [];
      const absentIds = new Set<string>(
        attList.filter((a: any) => a.status === "absent").map((a: any) => a.student_id)
      );

      let regularStudents: any[] = [];
      if (scheduleRes.ok) {
        const scheduleData: any[] = await scheduleRes.json().catch(() => []);
        const classData = scheduleData.find((g: any) => g.id === classId);
        if (classData?.students?.length > 0) {
          regularStudents = classData.students.filter((s: any) =>
            !["deleted", "archived"].includes(s.status) &&
            !absentIds.has(s.id)   // 결석 학생 제외
          );
        }
      }
      if (regularStudents.length === 0) {
        // [FIX] /students fallback(N+1 쿼리+클라이언트필터) → 전용 date-filtered 엔드포인트 사용
        const studentsRes = await apiRequest(token, `/class-groups/${classId}/students?date=${dateToUse}`);
        const list: any[] = studentsRes.ok ? (await studentsRes.json().catch(() => [])) : [];
        regularStudents = list.filter((s: any) =>
          !["deleted", "archived"].includes(s.status) &&
          !absentIds.has(s.id)   // 결석 학생 제외 (서버가 이미 날짜·반 필터링 완료)
        );
      }
      const makeupList: any[] = makeupRes.ok ? (await makeupRes.json().catch(() => [])) : [];
      const regularIds = new Set(regularStudents.map((s: any) => s.id));
      const makeupStudents = makeupList
        .filter((m: any) => !regularIds.has(m.id) && m.att_status !== "assigned")
        .map((m: any) => ({ ...m, is_makeup: true }));

      // 최종 stale 체크 후 확정
      if (studentsReqRef.current !== reqId) return;
      setClassStudents([...regularStudents, ...makeupStudents]);
      setClassStudentsLoaded(true);
    } catch (e: any) {
      if (studentsReqRef.current !== reqId) return;
      // 개인정보 미포함 — endpoint/status/classId 축약값만 기록
      if (__DEV__) console.error(`[loadClassStudents] err cg=...${classId.slice(-8)} msg=${String(e?.message ?? "unknown").slice(0, 60)}`);
      setClassStudentsError("학생 정보를 불러오지 못했습니다.");
    } finally {
      // reqId 일치할 때만 loading 해제 (stale 요청이 finally에서 덮어쓰지 않도록)
      if (studentsReqRef.current === reqId) setClassStudentsLoading(false);
    }
  }
  /** isDirty: write-view에 입력된 내용이 있는지 (session 전환 전 확인용) */
  const isDirty =
    (subView === "write") &&
    (commonContent.trim().length > 0 || studentNotes.length > 0 ||
     selectedAlbumIds.length > 0 || groupMedia.length > 0);

  /**
   * handleSessionSwitch — 세션 선택기에서 다른 회차 선택 시 호출
   * 1. dirty 상태면 confirm 모달 → 확인 후 실행
   * 2. targetDate / startTime / selectedGroup 원자적 전환
   * 3. 학생 목록 재로드 (openGroup 내부에서 처리)
   */
  function handleSessionSwitch(session: DiarySession) {
    const doSwitch = () => {
      setTargetDate(session.lessonDate);
      setStartTime(session.scheduleTime);
      const found = groups.find(g => g.id === session.classGroupId);
      if (found) {
        openGroup(found, session.lessonDate);
      }
    };
    if (isDirty) {
      pendingSessionRef.current = session;
      setShowSwitchConfirm(true);
    } else {
      doSwitch();
    }
  }

  async function loadDiaries(classId: string) {
    setDiaryLoading(true);
    const reqVer = ++diariesReqVersion.current;
    try {
      const r = await apiRequest(token, `/diaries?class_group_id=${classId}`);
      if (r.ok) {
        const data = await r.json();
        if (reqVer !== diariesReqVersion.current) {
          if (__DEV__) console.log(`[loadDiaries] STALE IGNORED`);
          return;
        }
        setDiaries(Array.isArray(data) ? data : []);
      } else { if (__DEV__) console.error(`[loadDiaries] API 오류 status=${r.status}`); }
    } catch (e) { if (__DEV__) console.error('[loadDiaries] 네트워크 오류:', e); }
    finally { setDiaryLoading(false); }
  }
  async function uploadGroupMedia(kind: "photo" | "video") {
    if (!selectedGroup) return;
    if (kind === "video" && !planFeatures.video_enabled) { setShowVideoGateModal(true); return; }
    if (planFeatures.storage_used_pct >= 100) { setShowStorageModal(true); return; }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: kind === "video" ? ["videos"] : ["images"],
      allowsMultipleSelection: kind !== "video",
      selectionLimit: kind === "photo" ? 10 : 1,
      quality: kind === "video" ? 1 : 0.85,
    });
    if (result.canceled || !result.assets?.length) return;
    const caption = `${selectedGroup.schedule_days || ""} ${selectedGroup.schedule_time || ""}반 일지`.trim() || `${selectedGroup.name} 일지`;
    setMediaUploading("group");

    // ── VIDEO: keep existing FormData multipart path ───────────────
    if (kind === "video") {
      const videoAssetUris = result.assets.map(a => a.uri);
      const newItems: UploadedMedia[] = result.assets.map(a => ({ uri: a.uri, kind, uploading: true, uploaded: false }));
      setGroupMedia(prev => [...prev, ...newItems]);
      try {
        const form = new FormData();
        for (const asset of result.assets) {
          form.append("video", { uri: asset.uri, name: asset.fileName || "video.mp4", type: asset.mimeType || "video/mp4" } as any);
        }
        form.append("class_id", selectedGroup.id); form.append("caption", caption);
        form.append("lesson_date", targetDate);
        const res = await fetch(`${API_BASE}/videos/group`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({})) as any;
          throw new Error(errData?.error || `업로드 실패 (${res.status})`);
        }
        const resData = await res.json().catch(() => ({})) as any;
        setGroupMedia(prev => prev.map(m => newItems.find(n => n.uri === m.uri) ? { ...m, uploading: false, uploaded: true } : m));
        // ── V6 fix: 업로드된 video를 selectedAlbumVideos에 추가해야 save payload에 포함됨 ──
        if (resData?.video?.id) {
          const v = resData.video;
          const videoInfo: AlbumVideoInfo = { id: v.id, file_url: v.file_url, created_at: v.created_at, uploaded_by_name: v.uploaded_by_name, caption: v.caption };
          setSelectedAlbumVideos(prev => prev.some(x => x.id === v.id) ? prev : [...prev, videoInfo]);
        }
      } catch (e) {
        if (__DEV__) console.error("[uploadGroupMedia] video error:", e);
        setGroupMedia(prev => prev.map(m => newItems.find(n => n.uri === m.uri) ? { ...m, uploading: false, error: String((e as Error)?.message || "실패") } : m));
      } finally {
        setMediaUploading(null);
        // 업로드 완료(성공/실패) 후 ImagePicker temp video 파일 삭제
        for (const uri of videoAssetUris) { deleteTempFileAfterUpload(uri).catch(() => {}); }
      }
      return;
    }

    // ── PHOTO: direct-upload to R2 ─────────────────────────────────
    // Max 10 photos enforced via selectionLimit; slice is a safety net
    const assets = result.assets.slice(0, 10);

    type CompressedFile = { compressedUri: string; fileName: string; mimeType: string; fileSize: number; clientId: string; origUri: string };
    let compressedFiles: CompressedFile[] = [];
    try {
      for (const asset of assets) {
        const originalUri = asset.uri;
        const compressedUri = await compressImageIfNeeded(originalUri, asset.fileSize ?? undefined);
        const wasCompressed = compressedUri !== originalUri;
        const fileName = wasCompressed ? "photo.jpg" : (asset.fileName || "photo.jpg");
        const mimeType = wasCompressed ? "image/jpeg" : (asset.mimeType || "image/jpeg");
        let fileSize = asset.fileSize ?? 0;
        try {
          const info = await getInfoAsync(compressedUri);
          if (info.exists) fileSize = info.size;
        } catch {}
        const clientId = `grp_${Date.now().toString()}_${Math.random().toString(36).substr(2, 9)}`;
        compressedFiles.push({ compressedUri, fileName, mimeType, fileSize, clientId, origUri: originalUri });
      }
    } catch (e) {
      if (__DEV__) console.error("[uploadGroupMedia] compress error:", e);
      setGroupMedia(prev => prev.filter(m => m.uploading === false || m.uploaded === true));
      setMediaUploading(null);
      return;
    }

    // 압축 완료 직후: origUri(picker 사본)이 compressedUri와 다른 경우 즉시 삭제
    // (compressedUri는 ImageManipulator 결과물 — 업로드 후 별도 정리)
    for (const cf of compressedFiles) {
      if (cf.origUri !== cf.compressedUri) {
        deleteTempFileAfterUpload(cf.origUri).catch(() => {});
      }
    }

    // Add placeholder items with clientIds for progress tracking
    const newItems: UploadedMedia[] = compressedFiles.map(cf => ({
      uri: cf.compressedUri,
      kind: "photo" as const,
      uploading: true,
      uploaded: false,
      clientId: cf.clientId,
      fileName: cf.fileName,
      mimeType: cf.mimeType,
      fileSize: cf.fileSize,
      progress: 0,
    }));
    setGroupMedia(prev => [...prev, ...newItems]);

    const directFiles = compressedFiles.map(cf => ({
      clientId: cf.clientId,
      uri: cf.compressedUri,
      fileName: cf.fileName,
      mimeType: cf.mimeType,
      fileSize: cf.fileSize,
    }));

    try {
      const results = await directUploadPhotos({
        token: token || "",
        albumType: "group",
        classId: selectedGroup.id,
        lessonDate: targetDate,
        caption,
        files: directFiles,
        onItemProgress: (clientId, progress) => {
          setGroupMedia(prev => prev.map(m => m.clientId === clientId ? { ...m, progress } : m));
        },
        onItemDone: (clientId) => {
          setGroupMedia(prev => prev.map(m => m.clientId === clientId ? { ...m, progress: 100 } : m));
        },
        onItemError: (clientId, error) => {
          setGroupMedia(prev => prev.map(m => m.clientId === clientId ? { ...m, uploading: false, error } : m));
        },
      });

      // Apply final states
      setGroupMedia(prev => prev.map(m => {
        if (!m.clientId) return m;
        const r = results.find(res => res.clientId === m.clientId);
        if (!r) return m;
        if (r.error) return { ...m, uploading: false, uploaded: false, error: r.error };
        return { ...m, uploading: false, uploaded: true, progress: 100, error: undefined };
      }));

      // Append successful photos to album for diary-attach (deduplicated)
      const successPhotos: AlbumPhotoInfo[] = [];
      const successIds: string[] = [];
      for (const r of results) {
        if (!r.error && r.photo) {
          successIds.push(r.photo.id);
          successPhotos.push({ id: r.photo.id, file_url: r.photo.file_url, created_at: r.photo.created_at, uploaded_by_name: r.photo.uploaded_by_name, media_status: r.photo.media_status, journal_id: r.photo.journal_id });
        }
      }
      if (successIds.length > 0) {
        setSelectedAlbumIds(prev => { const ex = new Set(prev); return [...prev, ...successIds.filter(id => !ex.has(id))]; });
        setSelectedAlbumPhotos(prev => { const ex = new Set(prev.map(p => p.id)); return [...prev, ...successPhotos.filter(p => !ex.has(p.id))]; });
      }
      // [FIX] compressedUri 즉시 삭제 금지 — state uri가 같은 파일을 가리키므로 ExpoImage preview 소실됨
      // compressedUri는 V3 cleanup (다음 앱 실행 시 ImageManipulator/ 디렉터리 일괄 정리)에서 처리됨
    } catch (e) {
      if (__DEV__) console.error("[uploadGroupMedia] photo upload error:", e);
      setGroupMedia(prev => prev.map(m => newItems.find(n => n.clientId === m.clientId) ? { ...m, uploading: false, error: String((e as Error)?.message || "실패") } : m));
      // catch: 세션 전체 실패 — compressedUri 삭제도 제거 (preview 소실 방지, V3 cleanup이 처리)
    } finally {
      setMediaUploading(null);
    }
  }
  async function uploadStudentMedia(student: StudentOption, kind: "photo" | "video") {
    if (!selectedGroup) return;
    if (kind === "video" && !planFeatures.video_enabled) { setShowVideoGateModal(true); return; }
    if (planFeatures.storage_used_pct >= 100) { setShowStorageModal(true); return; }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: kind === "video" ? ["videos"] : ["images"],
      allowsMultipleSelection: kind !== "video",
      selectionLimit: kind === "photo" ? 10 : 1,
      quality: kind === "video" ? 1 : 0.85,
    });
    if (result.canceled || !result.assets?.length) return;
    setMediaUploading(student.id);

    // ── VIDEO: keep existing FormData multipart path ───────────────
    if (kind === "video") {
      const videoAssetUris = result.assets.map(a => a.uri);
      const newItems: UploadedMedia[] = result.assets.map(a => ({ uri: a.uri, kind, uploading: true, uploaded: false }));
      setStudentMedia(prev => ({ ...prev, [student.id]: [...(prev[student.id] || []), ...newItems] }));
      try {
        const form = new FormData();
        for (const asset of result.assets) {
          form.append("video", { uri: asset.uri, name: asset.fileName || "video.mp4", type: asset.mimeType || "video/mp4" } as any);
        }
        if (selectedGroup) form.append("class_id", selectedGroup.id);
        form.append("student_id", student.id); form.append("caption", `${student.name} 개별 일지`);
        form.append("lesson_date", targetDate);
        const res = await fetch(`${API_BASE}/videos/private`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({})) as any;
          throw new Error(errData?.error || `업로드 실패 (${res.status})`);
        }
        const resData = await res.json().catch(() => ({})) as any;
        setStudentMedia(prev => ({ ...prev, [student.id]: (prev[student.id] || []).map(m => newItems.find(n => n.uri === m.uri) ? { ...m, uploading: false, uploaded: true } : m) }));
        // ── V6 fix: 업로드된 video를 studentAlbumVideos에 추가해야 save payload에 포함됨 ──
        if (resData?.video?.id) {
          const v = resData.video;
          const videoInfo: AlbumVideoInfo = { id: v.id, file_url: v.file_url, created_at: v.created_at, uploaded_by_name: v.uploaded_by_name, caption: v.caption };
          setStudentAlbumVideos(prev => {
            const existing = prev[student.id] ?? [];
            if (existing.some(x => x.id === v.id)) return prev;
            return { ...prev, [student.id]: [...existing, videoInfo] };
          });
        }
      } catch (e) {
        if (__DEV__) console.error("[uploadStudentMedia] video error:", e);
        setStudentMedia(prev => ({ ...prev, [student.id]: (prev[student.id] || []).map(m => newItems.find(n => n.uri === m.uri) ? { ...m, uploading: false, error: String((e as Error)?.message || "실패") } : m) }));
      } finally {
        setMediaUploading(null);
        // 업로드 완료(성공/실패) 후 ImagePicker temp video 파일 삭제
        for (const uri of videoAssetUris) { deleteTempFileAfterUpload(uri).catch(() => {}); }
      }
      return;
    }

    // ── PHOTO: direct-upload to R2 ─────────────────────────────────
    // Max 10 photos enforced via selectionLimit; slice is a safety net
    const assets = result.assets.slice(0, 10);
    const studentId = student.id;

    type CompressedFile = { compressedUri: string; fileName: string; mimeType: string; fileSize: number; clientId: string; origUri: string };
    let compressedFiles: CompressedFile[] = [];
    try {
      for (const asset of assets) {
        const originalUri = asset.uri;
        const compressedUri = await compressImageIfNeeded(originalUri, asset.fileSize ?? undefined);
        const wasCompressed = compressedUri !== originalUri;
        const fileName = wasCompressed ? "photo.jpg" : (asset.fileName || "photo.jpg");
        const mimeType = wasCompressed ? "image/jpeg" : (asset.mimeType || "image/jpeg");
        let fileSize = asset.fileSize ?? 0;
        try {
          const info = await getInfoAsync(compressedUri);
          if (info.exists) fileSize = info.size;
        } catch {}
        const clientId = `stu_${studentId.slice(-6)}_${Date.now().toString()}_${Math.random().toString(36).substr(2, 9)}`;
        compressedFiles.push({ compressedUri, fileName, mimeType, fileSize, clientId, origUri: originalUri });
      }
    } catch (e) {
      if (__DEV__) console.error("[uploadStudentMedia] compress error:", e);
      setMediaUploading(null);
      return;
    }

    // 압축 완료 직후: origUri(picker 사본)이 compressedUri와 다른 경우 즉시 삭제
    for (const cf of compressedFiles) {
      if (cf.origUri !== cf.compressedUri) {
        deleteTempFileAfterUpload(cf.origUri).catch(() => {});
      }
    }

    const newItems: UploadedMedia[] = compressedFiles.map(cf => ({
      uri: cf.compressedUri,
      kind: "photo" as const,
      uploading: true,
      uploaded: false,
      clientId: cf.clientId,
      fileName: cf.fileName,
      mimeType: cf.mimeType,
      fileSize: cf.fileSize,
      progress: 0,
    }));
    setStudentMedia(prev => ({ ...prev, [studentId]: [...(prev[studentId] || []), ...newItems] }));

    const directFiles = compressedFiles.map(cf => ({
      clientId: cf.clientId,
      uri: cf.compressedUri,
      fileName: cf.fileName,
      mimeType: cf.mimeType,
      fileSize: cf.fileSize,
    }));

    try {
      const results = await directUploadPhotos({
        token: token || "",
        albumType: "private",
        classId: selectedGroup.id,
        studentId,
        lessonDate: targetDate,
        caption: `${student.name} 개별 일지`,
        files: directFiles,
        onItemProgress: (clientId, progress) => {
          setStudentMedia(prev => ({
            ...prev,
            [studentId]: (prev[studentId] || []).map(m => m.clientId === clientId ? { ...m, progress } : m),
          }));
        },
        onItemDone: (clientId) => {
          setStudentMedia(prev => ({
            ...prev,
            [studentId]: (prev[studentId] || []).map(m => m.clientId === clientId ? { ...m, progress: 100 } : m),
          }));
        },
        onItemError: (clientId, error) => {
          setStudentMedia(prev => ({
            ...prev,
            [studentId]: (prev[studentId] || []).map(m => m.clientId === clientId ? { ...m, uploading: false, error } : m),
          }));
        },
      });

      // Apply final states
      setStudentMedia(prev => ({
        ...prev,
        [studentId]: (prev[studentId] || []).map(m => {
          if (!m.clientId) return m;
          const r = results.find(res => res.clientId === m.clientId);
          if (!r) return m;
          if (r.error) return { ...m, uploading: false, uploaded: false, error: r.error };
          return { ...m, uploading: false, uploaded: true, progress: 100, error: undefined };
        }),
      }));

      // Append successful photos to studentAlbumPhotos so note-attach works — deduplicate
      const successPhotos: AlbumPhotoInfo[] = [];
      for (const r of results) {
        if (!r.error && r.photo) {
          successPhotos.push({ id: r.photo.id, file_url: r.photo.file_url, created_at: r.photo.created_at, uploaded_by_name: r.photo.uploaded_by_name, media_status: r.photo.media_status, journal_id: r.photo.journal_id });
        }
      }
      if (successPhotos.length > 0) {
        setStudentAlbumPhotos(prev => {
          const existing = new Set((prev[studentId] ?? []).map(p => p.id));
          return { ...prev, [studentId]: [...(prev[studentId] ?? []), ...successPhotos.filter(p => !existing.has(p.id))] };
        });
      }
      // [FIX] compressedUri 즉시 삭제 금지 — state uri preview 소실 방지; V3 cleanup이 처리
    } catch (e) {
      if (__DEV__) console.error("[uploadStudentMedia] photo upload error:", e);
      setStudentMedia(prev => ({
        ...prev,
        [studentId]: (prev[studentId] || []).map(m => newItems.find(n => n.clientId === m.clientId) ? { ...m, uploading: false, error: String((e as Error)?.message || "실패") } : m),
      }));
    } finally {
      setMediaUploading(null);
    }
  }

  // ── Per-item retry for direct-upload photos ────────────────────────
  async function retryGroupPhotoItem(clientId: string) {
    if (!selectedGroup) return;
    const item = groupMedia.find(m => m.clientId === clientId);
    if (!item || !item.fileName || !item.mimeType || !item.fileSize) return;
    const caption = `${selectedGroup.schedule_days || ""} ${selectedGroup.schedule_time || ""}반 일지`.trim() || `${selectedGroup.name} 일지`;
    // Reset item to uploading state
    setGroupMedia(prev => prev.map(m => m.clientId === clientId ? { ...m, uploading: true, uploaded: false, error: undefined, progress: 0 } : m));
    const results = await directUploadPhotos({
      token: token || "",
      albumType: "group",
      classId: selectedGroup.id,
      lessonDate: targetDate,
      caption,
      files: [{ clientId, uri: item.uri, fileName: item.fileName, mimeType: item.mimeType, fileSize: item.fileSize }],
      onItemProgress: (_id, progress) => {
        setGroupMedia(prev => prev.map(m => m.clientId === clientId ? { ...m, progress } : m));
      },
    });
    const r = results[0];
    if (!r) return;
    if (r.error) {
      setGroupMedia(prev => prev.map(m => m.clientId === clientId ? { ...m, uploading: false, uploaded: false, error: r.error } : m));
      // 재시도도 실패: item.uri(compressedUri) 삭제 — FINAL FAILURE
      deleteTempFileAfterUpload(item.uri).catch(() => {});
    } else {
      setGroupMedia(prev => prev.map(m => m.clientId === clientId ? { ...m, uploading: false, uploaded: true, progress: 100, error: undefined } : m));
      // 재시도 성공: item.uri(compressedUri) 삭제
      deleteTempFileAfterUpload(item.uri).catch(() => {});
      if (r.photo) {
        const photo: AlbumPhotoInfo = { id: r.photo.id, file_url: r.photo.file_url, created_at: r.photo.created_at, uploaded_by_name: r.photo.uploaded_by_name, media_status: r.photo.media_status, journal_id: r.photo.journal_id };
        setSelectedAlbumIds(prev => prev.includes(r.photo!.id) ? prev : [...prev, r.photo!.id]);
        setSelectedAlbumPhotos(prev => prev.some(p => p.id === r.photo!.id) ? prev : [...prev, photo]);
      }
    }
  }

  async function retryStudentPhotoItem(studentId: string, clientId: string) {
    if (!selectedGroup) return;
    const item = (studentMedia[studentId] || []).find(m => m.clientId === clientId);
    if (!item || !item.fileName || !item.mimeType || !item.fileSize) return;
    const student = classStudents.find(s => s.id === studentId) ?? { id: studentId, name: "학생" };
    setStudentMedia(prev => ({
      ...prev,
      [studentId]: (prev[studentId] || []).map(m => m.clientId === clientId ? { ...m, uploading: true, uploaded: false, error: undefined, progress: 0 } : m),
    }));
    const results = await directUploadPhotos({
      token: token || "",
      albumType: "private",
      classId: selectedGroup.id,
      studentId,
      lessonDate: targetDate,
      caption: `${student.name} 개별 일지`,
      files: [{ clientId, uri: item.uri, fileName: item.fileName, mimeType: item.mimeType, fileSize: item.fileSize }],
      onItemProgress: (_id, progress) => {
        setStudentMedia(prev => ({
          ...prev,
          [studentId]: (prev[studentId] || []).map(m => m.clientId === clientId ? { ...m, progress } : m),
        }));
      },
    });
    const r = results[0];
    if (!r) return;
    if (r.error) {
      setStudentMedia(prev => ({
        ...prev,
        [studentId]: (prev[studentId] || []).map(m => m.clientId === clientId ? { ...m, uploading: false, uploaded: false, error: r.error } : m),
      }));
      // 재시도도 실패: item.uri(compressedUri) 삭제 — FINAL FAILURE
      deleteTempFileAfterUpload(item.uri).catch(() => {});
    } else {
      setStudentMedia(prev => ({
        ...prev,
        [studentId]: (prev[studentId] || []).map(m => m.clientId === clientId ? { ...m, uploading: false, uploaded: true, progress: 100, error: undefined } : m),
      }));
      // 재시도 성공: item.uri(compressedUri) 삭제
      deleteTempFileAfterUpload(item.uri).catch(() => {});
      if (r.photo) {
        const photo: AlbumPhotoInfo = { id: r.photo.id, file_url: r.photo.file_url, created_at: r.photo.created_at, uploaded_by_name: r.photo.uploaded_by_name, media_status: r.photo.media_status, journal_id: r.photo.journal_id };
        setStudentAlbumPhotos(prev => {
          const existing = new Set((prev[studentId] ?? []).map(p => p.id));
          if (existing.has(photo.id)) return prev;
          return { ...prev, [studentId]: [...(prev[studentId] ?? []), photo] };
        });
      }
    }
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
  }

  const handleAIInsert = useCallback((result: DiaryInsertResult) => {
    // 공통 일지 교체
    setCommonContent(result.commonDiary);
    // 학생별 메모 병합 (기존 유지 + AI 결과 추가/덮어쓰기)
    if (result.students.length > 0) {
      setStudentNotes(prev => {
        const next = [...prev];
        for (const s of result.students) {
          const idx = next.findIndex(n => n.student_id === s.studentId);
          if (idx >= 0) {
            next[idx] = { ...next[idx], note_content: s.note };
          } else {
            next.push({ student_id: s.studentId, student_name: s.studentName, note_content: s.note });
          }
        }
        return next;
      });
    }
    // WP7: curriculum matches 저장 — diary save 시 서버로 전달하여 growth_events 생성
    setAiCurriculumMatches(result.curriculumMatches ?? []);
  }, []);

  // ── 작성 세션 전체 초기화 (나가기 확정 시 호출) ──────────────────────────
  const resetWriteSession = useCallback(() => {
    setCommonContent(""); setStudentNotes([]); setNoteInput(""); setAddNoteStudent(null);
    setAiCurriculumMatches([]);
    setGroupMedia([]); setStudentMedia({}); setMediaUploading(null);
    setSelectedAlbumIds([]); setSelectedAlbumPhotos([]); setSelectedAlbumVideos([]);
    setStudentAlbumPhotos({}); setStudentAlbumVideos({});
    setPendingDiaryId(null); setPendingNoteIds({});
    setFormError(null); setHasDraft(false);
    if (draftKey) AsyncStorage.removeItem(draftKey).catch(() => {});
  }, [draftKey]);

  // draft 유무 판별 — ref로 관리해 handleExitDiary 클로저 오염 방지
  const hasWriteDraftRef = useRef(false);
  useEffect(() => {
    hasWriteDraftRef.current =
      subView === "write" && !!(
        commonContent.trim().length > 0 ||
        studentNotes.length > 0 ||
        noteInput.trim().length > 0 ||
        groupMedia.length > 0 ||
        selectedAlbumPhotos.length > 0 ||
        selectedAlbumVideos.length > 0 ||
        Object.values(studentAlbumPhotos).some(arr => arr.length > 0) ||
        Object.values(studentAlbumVideos).some(arr => arr.length > 0) ||
        Object.values(studentMedia).flat().length > 0
      );
  }, [subView, commonContent, studentNotes, noteInput, groupMedia,
      selectedAlbumPhotos, selectedAlbumVideos, studentAlbumPhotos,
      studentAlbumVideos, studentMedia]);

  const handleExitDiary = useCallback(() => {
    const doExit = () => {
      resetWriteSession();
      if (params.backTo) {
        router.replace((`/(teacher)/${params.backTo}`) as any);
        return;
      }
      setSelectedGroup(null);
    };
    if (hasWriteDraftRef.current) {
      Alert.alert(
        "일지 작성을 종료할까요?",
        "작성 중인 내용은 저장되지 않습니다.",
        [
          { text: "취소", style: "cancel" },
          { text: "나가기", style: "destructive", onPress: doExit },
        ],
      );
      return;
    }
    doExit();
  }, [params.backTo, resetWriteSession]);

  // 초기 mount focus는 skip — 이후 복귀 시만 diaries refetch
  const isMountFocusRef = useRef(true);
  // diary-reactions 화면을 열었던 diaryId 추적 — 복귀 시 해당 item만 pinpoint 갱신
  const lastOpenedReactionDiaryIdRef = useRef<string | null>(null);
  // useFocusEffect closure에서 최신 token/selectedGroup 참조를 위한 ref
  const tokenRef = useRef(token);
  const selectedGroupIdRef = useRef(selectedGroup?.id);
  useEffect(() => { tokenRef.current = token; }, [token]);
  useEffect(() => { selectedGroupIdRef.current = selectedGroup?.id; }, [selectedGroup?.id]);

  // Android 하드웨어 Back — draft 있으면 확인 Alert 호출
  // + 화면 복귀 시 like_count 자동 갱신 (messages-inbox 등 다른 화면 갔다 돌아올 때)
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (hasWriteDraftRef.current) {
          handleExitDiary();
          return true; // 기본 back 차단
        }
        return false;
      });

      if (isMountFocusRef.current) {
        isMountFocusRef.current = false; // 초기 mount는 기존 useEffect가 처리
      } else {
        const reactionDiaryId = lastOpenedReactionDiaryIdRef.current;
        const curGroupId = selectedGroupIdRef.current;
        const curToken = tokenRef.current;
        if (reactionDiaryId && curToken) {
          // diary-reactions에서 복귀: 해당 diary item의 count만 pinpoint 갱신
          lastOpenedReactionDiaryIdRef.current = null;
          (async () => {
            try {
              const r = await apiRequest(curToken, `/diaries/${reactionDiaryId}/comment-count`);
              if (r.ok) {
                const d = await r.json();
                setDiaries(prev => prev.map(item =>
                  item.id === reactionDiaryId
                    ? { ...item, like_count: d.like_count ?? item.like_count, comment_count: d.comment_count ?? item.comment_count }
                    : item
                ));
              }
            } catch {}
          })();
        } else if (curGroupId) {
          // 다른 화면(메시지함 등)에서 복귀: 전체 refetch
          loadDiaries(curGroupId);
        }
      }

      return () => sub.remove();
    }, [handleExitDiary]),
  );

  async function handleSave() {
    // [WP11] Save 중복 요청 차단
    if (saving) return;
    // 영상 업로드 완료 전 저장 차단 — video ID가 payload에 누락되는 것을 방지
    if (mediaUploading !== null) {
      setFormError("영상 업로드가 완료될 때까지 잠시 기다려주세요.");
      return;
    }
    if (__DEV__) console.log(`[HANDLE_SAVE] contentLength=${commonContent.length} studentCount=${studentNotes.length} isRetry=${!!pendingDiaryId}`);
    const isRetry = !!pendingDiaryId;
    let effectiveNotes = [...studentNotes];
    if (addNoteStudent && noteInput.trim()) {
      const idx = effectiveNotes.findIndex(n => n.student_id === addNoteStudent!.id);
      if (idx >= 0) {
        effectiveNotes[idx] = { ...effectiveNotes[idx], note_content: noteInput.trim() };
      } else {
        effectiveNotes.push({ student_id: addNoteStudent.id, student_name: addNoteStudent.name, note_content: noteInput.trim() });
      }
    }
    if (!isRetry) {
      // 학생 로딩 미완료 — loading 중이거나 아직 응답 전
      if (classStudentsLoading || !classStudentsLoaded) {
        setFormError("학생 정보를 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
        return;
      }
      // 학생 로딩 실패
      if (classStudentsError) {
        setFormError("학생 정보를 불러오지 못했습니다. 화면을 새로 고침하거나 다시 시도해주세요.");
        return;
      }
      // 전체 결석: 출석 학생이 없으면 일지 저장 불가 (로딩 완료 후에만 판정)
      if (classStudents.length === 0) {
        setFormError("출석한 학생이 없어 일지를 저장할 수 없습니다. 출결을 먼저 확인해주세요.");
        return;
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
    }
    setFormError(null); setSaving(true);
    try {
      if (__DEV__) console.log(`[handleSave] START isRetry=${isRetry} albumPhotoCount=${selectedAlbumIds.length} studentAlbumCount=${Object.keys(studentAlbumPhotos).length} noteCount=${effectiveNotes.length}`);

      // ── Step 1: 일지 생성 (첫 시도만) ─────────────────────────────────
      let diaryId = pendingDiaryId;
      let noteMap = { ...pendingNoteIds };
      if (!isRetry) {
        if (__DEV__) console.log(`[handleSave] Step1 - POST /diaries START`);
        const r = await apiRequest(token, "/diaries", {
          method: "POST",
          body: JSON.stringify({
            class_group_id: selectedGroup!.id,
            lesson_date:    targetDate,
            common_content: commonContent.trim(),
            student_notes:  effectiveNotes.map(n => ({ student_id: n.student_id, note_content: n.note_content.trim() })),
            // WP7: AI curriculum matches — 서버에서 growth_events 생성에 사용
            ...(aiCurriculumMatches.length > 0 && { curriculum_matches: aiCurriculumMatches }),
          }),
        });
        const data = await r.json();
        if (__DEV__) console.log(`[handleSave] Step1 - POST /diaries response ok=${r.ok} status=${r.status}`);
        if (!r.ok) throw new Error(data?.error || "저장 실패");
        diaryId = data.diary_id || data.id;
        noteMap = {};
        if (data.student_notes && Array.isArray(data.student_notes)) {
          for (const n of data.student_notes) { noteMap[n.student_id] = n.id; }
        }
        if (__DEV__) console.log(`[handleSave] Step1 DONE diaryId=${diaryId} noteCount=${Object.keys(noteMap).length}`);
        setPendingDiaryId(diaryId!);
        setPendingNoteIds(noteMap);
        if (draftKey) await AsyncStorage.removeItem(draftKey).catch(() => {});
        setHasDraft(false);
      } else {
        if (__DEV__) console.log(`[handleSave] RETRY MODE diaryId=${diaryId} noteCount=${Object.keys(noteMap).length}`);
      }

      // ── Step 2: 사진/영상 연결 — 에러 수집 ───────────────────────────
      const errors: string[] = [];
      if (selectedAlbumIds.length > 0) {
        if (__DEV__) console.log(`[handleSave] Step2 - diary-attach START diary_id=${diaryId} photoCount=${selectedAlbumIds.length}`);
        const pr = await apiRequest(token, "/photos/diary-attach", {
          method: "POST",
          body: JSON.stringify({ diary_id: diaryId, photo_ids: selectedAlbumIds }),
        }).catch(() => null);
        if (__DEV__) console.log(`[handleSave] Step2 - diary-attach DONE ok=${pr?.ok} status=${pr?.status}`);
        if (!pr?.ok) {
          const d = pr ? await pr.json().catch(() => ({})) as any : {};
          if (__DEV__) console.log(`[handleSave] Step2 - diary-attach ERROR ok=${pr?.ok}`);
          errors.push(`전체일지 사진 ${selectedAlbumIds.length}장: ${d?.error || "연결 실패"}`);
        }
      }
      if (selectedAlbumVideos.length > 0) {
        const pr = await apiRequest(token, "/videos/diary-attach", {
          method: "POST",
          body: JSON.stringify({ diary_id: diaryId, video_ids: selectedAlbumVideos.map(v => v.id) }),
        }).catch(() => null);
        if (!pr?.ok) {
          const d = pr ? await pr.json().catch(() => ({})) as any : {};
          errors.push(`전체일지 영상 ${selectedAlbumVideos.length}개: ${d?.error || "연결 실패"}`);
        }
      }
      if (__DEV__) console.log(`[handleSave] Step3 - student note photos. noteCount=${Object.keys(noteMap).length}`);
      for (const [studentId, noteId] of Object.entries(noteMap)) {
        const photos = studentAlbumPhotos[studentId] ?? [];
        const sName = effectiveNotes.find(n => n.student_id === studentId)?.student_name ?? "학생";
        if (__DEV__) console.log(`[handleSave] note loop photoCount=${photos.length}`);
        if (photos.length > 0) {
          if (__DEV__) console.log(`[handleSave] note-attach START photoCount=${photos.length}`);
          const pr = await apiRequest(token, "/photos/note-attach", {
            method: "POST",
            body: JSON.stringify({ note_id: noteId, photo_ids: photos.map((p: AlbumPhotoInfo) => p.id) }),
          }).catch(() => null);
          if (__DEV__) console.log(`[handleSave] note-attach DONE ok=${pr?.ok} status=${pr?.status}`);
          if (!pr?.ok) {
            const d = pr ? await pr.json().catch(() => ({})) as any : {};
            if (__DEV__) console.log(`[handleSave] note-attach ERROR ok=${pr?.ok}`);
            errors.push(`${sName} 개별사진 ${photos.length}장: ${d?.error || "연결 실패"}`);
          }
        }
        const vids = studentAlbumVideos[studentId] ?? [];
        if (vids.length > 0) {
          const pr = await apiRequest(token, "/videos/note-attach", {
            method: "POST",
            body: JSON.stringify({ note_id: noteId, video_ids: vids.map((v: AlbumVideoInfo) => v.id) }),
          }).catch(() => null);
          if (!pr?.ok) {
            const d = pr ? await pr.json().catch(() => ({})) as any : {};
            errors.push(`${sName} 개별영상 ${vids.length}개: ${d?.error || "연결 실패"}`);
          }
        }
      }
      // ── Step 3: 결과 처리 ─────────────────────────────────────────────
      if (errors.length > 0) {
        setFormError(
          `일지 본문은 저장됐습니다. 아래 사진/영상 연결에 실패했습니다:\n` +
          errors.map(e => `• ${e}`).join('\n') +
          `\n\n저장 버튼을 다시 누르면 재시도합니다.`
        );
        return;
      }
      // 전체 성공
      setPendingDiaryId(null);
      setPendingNoteIds({});
      setSelectedAlbumIds([]); setSelectedAlbumPhotos([]); setSelectedAlbumVideos([]);
      setStudentAlbumPhotos({}); setStudentAlbumVideos({});
      setStudentNotes([]); setCommonContent(""); setAddNoteStudent(null); setNoteInput("");
      haptic.success();
      // 전 화면에 생성 이벤트 전파 (홈·스케줄러·어드민 즉시 갱신)
      emitDiaryChanged({ type: "created", diaryId: "", classGroupId: selectedGroup!.id, lessonDate: targetDate });
      // 즉시 history 뷰로 전환
      setSubView("history");
      const savedGroupId = selectedGroup!.id;
      apiRequest(token, `/diaries?class_group_id=${savedGroupId}`)
        .then(r2 => r2.ok ? r2.json() : [])
        .then((list: any[]) => {
          const diaryList: DiaryEntry[] = Array.isArray(list) ? list : [];
          setDiaries(diaryList);
          setDiarySet(prev => {
            const next = new Set(prev);
            diaryList.forEach(d => { if (d.class_group_id && d.lesson_date) next.add(`${d.class_group_id}_${d.lesson_date}`); });
            return next;
          });
        })
        .catch(() => {
          setDiarySet(prev => new Set([...prev, `${selectedGroup!.id}_${targetDate}`]));
        });
      setSaveMsg({ type: "success", text: "수업 일지가 저장되었습니다. 학부모에게 알림이 발송됩니다." });
      // 저장 성공 후 항상 diary history에 머뭄.
      // 자동으로 다른 화면으로 이동하지 않음 — 사용자가 뒤로가기로 직접 이동.
      setTimeout(() => {
        setSaveMsg(null);
      }, 2000);
    } catch (e: any) {
      setFormError(e.message || "저장 중 오류가 발생했습니다.");
      if (selectedGroup) {
        const syncGroupId = selectedGroup.id;
        apiRequest(token, `/diaries?class_group_id=${syncGroupId}`)
          .then(r => r.ok ? r.json() : [])
          .then((list: any[]) => {
            const diaryList: DiaryEntry[] = Array.isArray(list) ? list : [];
            setDiaries(diaryList);
            setDiarySet(prev => {
              const next = new Set(prev);
              prev.forEach(k => { if (k.startsWith(syncGroupId)) next.delete(k); });
              diaryList.forEach(d => { if (d.class_group_id && d.lesson_date) next.add(`${d.class_group_id}_${d.lesson_date}`); });
              return next;
            });
            const todayStillExists = diaryList.some(d => d.lesson_date === targetDate);
            if (todayStillExists) setSubView("history");
          })
          .catch(() => {});
      }
    }
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
      if (!diaryRes.ok) throw new Error("일지를 불러올 수 없습니다. 이미 삭제되었을 수 있습니다.");
      const data = await diaryRes.json();
      if (data.is_deleted) throw new Error("삭제된 일지는 수정할 수 없습니다.");
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
    // 영상 업로드 완료 전 저장 차단
    if (mediaUploading !== null) {
      setEditError("영상 업로드가 완료될 때까지 잠시 기다려주세요.");
      return;
    }
    const hasEditMedia =
      editLinkedPhotos.length > 0 ||
      editLinkedVideos.length > 0 ||
      editNewAlbumIds.length > 0 ||
      editNewAlbumVideos.length > 0;
    const hasEditContent = editContent.trim().length > 0 || editNotes.some(n => !n._deleted && n.note_content?.trim()) || editNewNotes.some(n => n.note_content?.trim()) || hasEditMedia;
    if (!hasEditContent) { setEditError("전체 일지 또는 개인 일지 내용이나 사진/영상을 추가해주세요."); return; }
    setEditSaving(true); setEditError(null);
    try {
      // ── 텍스트 수정 및 노트 관리 ─────────────────────────────────────
      const r = await apiRequest(token, `/diaries/${editDiary.id}`, { method: "PUT", body: JSON.stringify({ common_content: editContent.trim() }) });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || "수정 실패"); }
      for (const note of editNotes) {
        if (note._deleted) await apiRequest(token, `/diaries/student-notes/${note.id}`, { method: "DELETE" });
        else if (note._modified) await apiRequest(token, `/diaries/student-notes/${note.id}`, { method: "PUT", body: JSON.stringify({ note_content: note.note_content }) });
      }
      const savedEditNoteIds: Record<string, string> = {};
      for (const note of editNewNotes) {
        const r2 = await apiRequest(token, `/diaries/${editDiary.id}/student-notes`, { method: "POST", body: JSON.stringify({ student_id: note.student_id, note_content: note.note_content }) });
        if (r2.ok) { const d2 = await r2.json(); if (d2.note_id) savedEditNoteIds[note.student_id] = d2.note_id; }
      }
      // ── 사진/영상 연결 — 에러 수집 ──────────────────────────────────
      const errors: string[] = [];
      if (editRemovedPhotoIds.length > 0) {
        const dr = await apiRequest(token, "/photos/diary-detach", { method: "POST", body: JSON.stringify({ photo_ids: editRemovedPhotoIds }) })
          .catch(() => null);
        if (!dr?.ok) {
          const d = dr ? await dr.json().catch(() => ({})) as any : {};
          errors.push(`사진 ${editRemovedPhotoIds.length}장 제거: ${d?.error || "연결 해제 실패"}`);
        }
      }
      if (editRemovedVideoIds.length > 0) {
        const dr = await apiRequest(token, "/videos/diary-detach", { method: "POST", body: JSON.stringify({ video_ids: editRemovedVideoIds }) })
          .catch(() => null);
        if (!dr?.ok) {
          const d = dr ? await dr.json().catch(() => ({})) as any : {};
          errors.push(`영상 ${editRemovedVideoIds.length}개 제거: ${d?.error || "연결 해제 실패"}`);
        }
      }
      if (editNewAlbumIds.length > 0) {
        const pr = await apiRequest(token, "/photos/diary-attach", {
          method: "POST",
          body: JSON.stringify({ diary_id: editDiary.id, photo_ids: editNewAlbumIds }),
        }).catch(() => null);
        if (!pr?.ok) {
          const d = pr ? await pr.json().catch(() => ({})) as any : {};
          errors.push(`전체일지 사진 ${editNewAlbumIds.length}장: ${d?.error || "연결 실패"}`);
        }
      }
      if (editNewAlbumVideos.length > 0) {
        const pr = await apiRequest(token, "/videos/diary-attach", {
          method: "POST",
          body: JSON.stringify({ diary_id: editDiary.id, video_ids: editNewAlbumVideos.map(v => v.id) }),
        }).catch(() => null);
        if (!pr?.ok) {
          const d = pr ? await pr.json().catch(() => ({})) as any : {};
          errors.push(`전체일지 영상 ${editNewAlbumVideos.length}개: ${d?.error || "연결 실패"}`);
        }
      }
      for (const note of editNotes) {
        if (!note._deleted) {
          const photos = studentAlbumPhotos[note.student_id] ?? [];
          const vids = studentAlbumVideos[note.student_id] ?? [];
          if (photos.length > 0) {
            const pr = await apiRequest(token, "/photos/note-attach", { method: "POST", body: JSON.stringify({ note_id: note.id, photo_ids: photos.map((p: AlbumPhotoInfo) => p.id) }) }).catch(() => null);
            if (!pr?.ok) {
              const d = pr ? await pr.json().catch(() => ({})) as any : {};
              errors.push(`${note.student_name ?? "학생"} 개별사진 ${photos.length}장: ${d?.error || "연결 실패"}`);
            }
          }
          if (vids.length > 0) {
            const pr = await apiRequest(token, "/videos/note-attach", { method: "POST", body: JSON.stringify({ note_id: note.id, video_ids: vids.map((v: AlbumVideoInfo) => v.id) }) }).catch(() => null);
            if (!pr?.ok) {
              const d = pr ? await pr.json().catch(() => ({})) as any : {};
              errors.push(`${note.student_name ?? "학생"} 개별영상 ${vids.length}개: ${d?.error || "연결 실패"}`);
            }
          }
        }
      }
      for (const [studentId, noteId] of Object.entries(savedEditNoteIds)) {
        const sName = editNewNotes.find(n => n.student_id === studentId)?.student_name ?? "학생";
        const photos = studentAlbumPhotos[studentId] ?? [];
        if (photos.length > 0) {
          const pr = await apiRequest(token, "/photos/note-attach", { method: "POST", body: JSON.stringify({ note_id: noteId, photo_ids: photos.map((p: AlbumPhotoInfo) => p.id) }) }).catch(() => null);
          if (!pr?.ok) {
            const d = pr ? await pr.json().catch(() => ({})) as any : {};
            errors.push(`${sName} 개별사진 ${photos.length}장: ${d?.error || "연결 실패"}`);
          }
        }
        const vids = studentAlbumVideos[studentId] ?? [];
        if (vids.length > 0) {
          const pr = await apiRequest(token, "/videos/note-attach", { method: "POST", body: JSON.stringify({ note_id: noteId, video_ids: vids.map((v: AlbumVideoInfo) => v.id) }) }).catch(() => null);
          if (!pr?.ok) {
            const d = pr ? await pr.json().catch(() => ({})) as any : {};
            errors.push(`${sName} 개별영상 ${vids.length}개: ${d?.error || "연결 실패"}`);
          }
        }
      }
      // ── 결과 처리 ────────────────────────────────────────────────────
      if (errors.length > 0) {
        setEditError(
          `일지 본문은 저장됐습니다. 아래 사진/영상 연결에 실패했습니다:\n` +
          errors.map(e => `• ${e}`).join('\n') +
          `\n\n저장 버튼을 다시 누르면 재시도합니다.`
        );
        return;
      }
      // 전체 성공
      setEditLinkedPhotos([]); setEditRemovedPhotoIds([]); setEditNewAlbumIds([]); setEditNewAlbumPhotos([]);
      setEditLinkedVideos([]); setEditRemovedVideoIds([]); setEditNewAlbumVideos([]);
      haptic.success();
      if (params.editDiaryId) {
        // Hub에서 진입한 경우 backTo="diary-index" → Hub으로 명시 복귀 (Home 이동 금지 §12)
        if (params.backTo) { router.replace((`/(teacher)/${params.backTo}`) as any); }
        else { router.back(); }
      }
      else { setSubView("history"); setEditDiary(null); await loadDiaries(selectedGroup.id); }
    } catch (e: any) { setEditError(e.message || "저장 중 오류가 발생했습니다."); }
    finally { setEditSaving(false); }
  }
  async function confirmDelete() {
    if (!deleteTarget || !selectedGroup) return;
    const deletedId = deleteTarget.id;
    const groupId = selectedGroup.id;
    const deletedDate = deleteTarget.lesson_date ?? targetDate;

    if (__DEV__) console.log(`[DELETE TARGET] diary_id=${deletedId} lesson_date=${deletedDate}`);

    setDeleteLoading(true);
    try {
      // 1. DELETE API 호출
      const r = await apiRequest(token, `/diaries/${deletedId}`, { method: "DELETE" });
      const deleteBodyText = await r.text().catch(() => "");
      let deleteBodyJson: any = {};
      try { deleteBodyJson = JSON.parse(deleteBodyText); } catch {}
      if (__DEV__) console.log(`[DELETE RESPONSE] diary_id=${deletedId} status=${r.status}`);
      if (__DEV__ && deleteBodyJson?._verify) {
        const v = deleteBodyJson._verify;
        console.log(`[DELETE DB VERIFY] is_deleted=${v.is_deleted} still_attached_photos=${v.still_attached_photos}`);
        if (v.is_deleted !== true) {
          console.error(`[DELETE DB VERIFY] ⚠️ CRITICAL: DB is_deleted is NOT true after DELETE!`);
        }
        if (Number(v.still_attached_photos) > 0) {
          console.error(`[DELETE DB VERIFY] ⚠️ CRITICAL: ${v.still_attached_photos} photos still attached after DELETE!`);
        }
      }

      // 멱등 삭제: 200 OK 또는 alreadyDeleted/이미삭제 응답 → 성공
      // 404는 진짜 오류(pool 불일치 등)이므로 성공으로 처리하지 않음
      const isAlreadyDeleted =
        deleteBodyJson?.alreadyDeleted === true ||
        (typeof deleteBodyJson?.error === "string" && deleteBodyJson.error.includes("이미 삭제"));
      const isDeleteSuccess = r.ok || isAlreadyDeleted;

      if (!isDeleteSuccess) {
        setDeleteError(deleteBodyJson?.error || `삭제에 실패했습니다 (${r.status}). 다시 시도해주세요.`);
        return;
      }
      if (!r.ok && isAlreadyDeleted) {
        if (__DEV__) console.log(`[DELETE RESPONSE] idempotent — diary already deleted, cleaning client state`);
      }

      // 2. 모달 + 로딩 즉시 해제 → 화면 freeze 없음
      setDeleteTarget(null);
      setDeleteError(null);
      setDeleteLoading(false);   // ← 여기서 즉시 해제 (refetch 전)
      if (editDiary?.id === deletedId) setEditDiary(null);

      // 3. 로컬 즉시 UI 업데이트
      setDiaries(prev => prev.filter(d => d.id !== deletedId));
      setDiarySet(prev => { const n = new Set(prev); n.delete(`${groupId}_${deletedDate}`); return n; });
      if (__DEV__) console.log(`[CLIENT DELETE CLEANUP] keyRemoved=${groupId}_${deletedDate}`);
      // 전 화면에 삭제 이벤트 전파 (홈·스케줄러·어드민 즉시 갱신)
      emitDiaryChanged({ type: "deleted", diaryId: deletedId, classGroupId: groupId, lessonDate: deletedDate });

      // 4. draft 제거 (sync 불필요 → 비동기 처리)
      AsyncStorage.removeItem(`@swimnote:diary_draft:${groupId}:${deletedDate}`).catch(() => {});
      setHasDraft(false);
      setCommonContent("");
      setStudentNotes([]);
      setPendingDiaryId(null);
      setPendingNoteIds({});
      setSubView("history");

      // Issue 1 Fix: 삭제 후 backTo 파라미터가 있으면 원래 화면으로 복귀
      // → 사용자가 diary 화면에 남아 있어 실수로 새 일지를 재생성하는 것을 방지
      const backToAfterDelete = params.backTo as string | undefined;
      if (backToAfterDelete === "my-schedule") {
        setTimeout(() => router.replace("/(teacher)/my-schedule" as any), 300);
      } else if (backToAfterDelete === "today-schedule") {
        setTimeout(() => router.replace("/(teacher)/today-schedule" as any), 300);
      } else if (backToAfterDelete) {
        setTimeout(() => router.back(), 300);
      }

      // 5. 진짜 백그라운드 재조회 — UI 블로킹 없음 (fire-and-forget)
      const bgVer = ++diariesReqVersion.current;
      ;(async () => {
        try {
          const r2 = await apiRequest(token, `/diaries?class_group_id=${groupId}`);
          const raw = r2.ok ? await r2.json().catch(() => null) : null;
          if (!Array.isArray(raw)) {
            if (__DEV__) console.log(`[HISTORY AFTER DELETE] re-fetch status=${r2.status} not array`);
            return;
          }
          // 버전 확인 — 더 최신 요청이 있으면 이 결과 무시
          if (bgVer !== diariesReqVersion.current) {
            if (__DEV__) console.log(`[HISTORY AFTER DELETE] STALE IGNORED`);
            return;
          }
          // 서버 응답 기준 전체 교체 + 클라이언트 deletedId 안전장치 필터
          const diaryList = (raw as DiaryEntry[]).filter(d => !d.is_deleted && d.id !== deletedId);
          const deletedIdStillInServer = (raw as DiaryEntry[]).some(d => d.id === deletedId && !d.is_deleted);
          if (__DEV__) console.log(`[HISTORY AFTER DELETE] count=${diaryList.length} deletedIdStillInServer=${deletedIdStillInServer}`);
          if (deletedIdStillInServer) {
            if (__DEV__) console.warn(`[HISTORY AFTER DELETE] ⚠️ diary STILL in server response (is_deleted=false) — DB not updated!`);
          }
          setDiaries(diaryList);
          setDiarySet(() => {
            const next = new Set<string>();
            diaryList.forEach(d => { if (d.class_group_id && d.lesson_date) next.add(`${d.class_group_id}_${d.lesson_date}`); });
            return next;
          });
          if (__DEV__) console.log(`[CLIENT AFTER REFETCH] count=${diaryList.length}`);
        } catch (e) {
          if (__DEV__) console.error(`[HISTORY AFTER DELETE] re-fetch failed:`, e);
        }
      })();

    } catch (e) {
      if (__DEV__) console.error(`[DELETE ERROR]`, e);
      setDeleteError("네트워크 오류로 삭제하지 못했습니다. 다시 시도해주세요.");
    } finally {
      // 에러 경로 safety net (setDeleteLoading(false)가 step 2에서 호출되지 않은 경우)
      setDeleteLoading(false);
    }
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
    // diarySet 대신 diaries를 source of truth로 사용 — session switch 직후 race condition 방지
    const myDiaryExists = diaries.some(d =>
      d.class_group_id === group.id &&
      String(d.lesson_date ?? "").slice(0, 10) === targetDate &&
      !d.is_deleted
    );
    if (subView === "edit") {
      return (
        <SafeAreaView style={s.safe} edges={[]}>
          <SubScreenHeader
            title={params.viewOnly === "true" ? "일지 보기" : "일지 수정"}
            subtitle={editDiary ? `${editDiary.lesson_date} · ${group.schedule_time}` : ""}
            onBack={() => {
              if (params.editDiaryId) {
                // Hub 등 외부 진입 시 backTo로 명시 복귀 — router.back() 금지 (Home으로 빠질 수 있음)
                if (params.backTo) router.replace((`/(teacher)/${params.backTo}`) as any);
                else router.back();
              } else {
                setSubView("history"); setEditDiary(null);
              }
            }}
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
            viewOnly={params.viewOnly === "true"}
            onBack={() => {
              if (params.editDiaryId) {
                if (params.backTo) router.replace((`/(teacher)/${params.backTo}`) as any);
                else router.back();
              } else {
                setSubView("history"); setEditDiary(null);
              }
            }}
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
            onUploadStudentMedia={uploadStudentMedia}
            mediaUploading={mediaUploading}
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
          subtitle={`${targetDate} · ${startTime || group.schedule_time}`}
          onBack={handleExitDiary}
          homePath="/(teacher)/today-schedule"
          onTitlePress={() => setShowSessionSelector(true)}
        />
        <View style={s.subHeader}>
          <View style={{ flex: 1 }} />
          <Pressable
            style={[s.tabBtn, { backgroundColor: C.background, borderColor: themeColor }]}
            onPress={() => {
              if (subView === "history") {
                if (myDiaryExists) {
                  // [FIX] 기존 일지가 있으면 canonical edit path로 직접 이동
                  // 이전: replace confirm → write view(날짜 변경 가능) — 두 번째 edit UI
                  // 변경: openEditDiary → DiaryEditView — 단일 canonical edit path
                  const existing = diaries.find(d =>
                    d.class_group_id === group.id &&
                    String(d.lesson_date ?? "").slice(0, 10) === targetDate &&
                    !d.is_deleted
                  );
                  if (existing) { openEditDiary(existing); }
                } else {
                  setSubView("write");
                }
              } else {
                setSubView("history");
              }
            }}>
            {subView === "history"
              ? <BookOpen size={13} color={themeColor} />
              : <Clock    size={13} color={themeColor} />}
            <Text style={[s.tabBtnText, { color: themeColor }]}>
              {subView === "history" ? "일지작성" : "지난 일지"}
            </Text>
          </Pressable>
        </View>
        {subView === "write" && hasDraft && (
          <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#EFF6FF", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginHorizontal: 16, marginBottom: 8, gap: 10 }}>
            <LucideIcon name="rotate-ccw" size={14} color="#2563EB" />
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
            classStudents={classStudents}
            classStudentsLoading={classStudentsLoading}
            classStudentsLoaded={classStudentsLoaded}
            classStudentsError={classStudentsError}
            onRetryLoadStudents={() => selectedGroup && loadClassStudents(selectedGroup.id)}
            studentNotes={studentNotes}
            addNoteStudent={addNoteStudent} setAddNoteStudent={setAddNoteStudent}
            noteInput={noteInput} setNoteInput={setNoteInput}
            saving={saving} formError={formError} saveMsg={saveMsg}
            groupMedia={groupMedia} studentMedia={studentMedia} mediaUploading={mediaUploading}
            showPickerFor={showPickerFor} setShowPickerFor={setShowPickerFor}
            commonCursorRef={commonCursorRef} noteCursorRef={noteCursorRef}
            onSave={handleSave}
            onBack={handleExitDiary}
            poolId={user?.swimming_pool_id ?? ""}
            teacherId={user?.id ?? ""}
            onAIInsert={mode === "x" ? handleAIInsert : undefined}
            onUploadGroupMedia={uploadGroupMedia}
            onUploadStudentMedia={uploadStudentMedia}
            onAddNote={handleAddNote}
            onRemoveNote={(studentId) => setStudentNotes(prev => prev.filter(n => n.student_id !== studentId))}
            onOpenAlbumPicker={() => setShowAlbumPicker(true)}
            selectedAlbumPhotos={selectedAlbumPhotos}
            onRemoveAlbumPhoto={(id) => {
              setSelectedAlbumIds(prev => prev.filter(i => i !== id));
              setSelectedAlbumPhotos(prev => prev.filter(p => p.id !== id));
            }}
            selectedAlbumVideos={selectedAlbumVideos}
            onRemoveAlbumVideo={(id) => setSelectedAlbumVideos(prev => prev.filter(v => v.id !== id))}
            onOpenStudentAlbumPicker={(student) => { setStudentAlbumPickerTarget(student); setShowStudentAlbumPicker(true); }}
            onOpenGroupMyAlbum={(kind) => {
              if (kind === "video" && !planFeatures?.video_enabled) { setShowVideoGateModal(true); return; }
              setGroupMyAlbumMediaType(kind);
              setShowGroupMyAlbum(true);
            }}
            onOpenStudentMyAlbum={(student, kind) => {
              setStudentMyAlbumTarget(student);
              setStudentMyAlbumMediaType(kind);
              setShowStudentMyAlbum(true);
            }}
            insertAtCursor={insertAtCursor}
            token={token || ""}
            studentAlbumPhotos={studentAlbumPhotos}
            studentAlbumVideos={studentAlbumVideos}
            onRemoveStudentAlbumPhoto={(studentId, photoId) => setStudentAlbumPhotos(prev => ({ ...prev, [studentId]: (prev[studentId] ?? []).filter(p => p.id !== photoId) }))}
            onRemoveStudentAlbumVideo={(studentId, videoId) => setStudentAlbumVideos(prev => ({ ...prev, [studentId]: (prev[studentId] ?? []).filter(v => v.id !== videoId) }))}
            videoEnabled={planFeatures?.video_enabled ?? false}
            onRetryGroupPhotoItem={retryGroupPhotoItem}
            onRetryStudentPhotoItem={retryStudentPhotoItem}
            onRemoveGroupMediaItem={(clientIdOrUri) =>
              setGroupMedia(prev => prev.filter(m => (m.clientId ?? m.uri) !== clientIdOrUri))
            }
            onRemoveStudentMediaItem={(studentId, clientIdOrUri) =>
              setStudentMedia(prev => ({
                ...prev,
                [studentId]: (prev[studentId] ?? []).filter(m => (m.clientId ?? m.uri) !== clientIdOrUri),
              }))
            }
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
            onWriteDiary={() => setSubView("write")}
            onPressReactions={(diary) => {
              lastOpenedReactionDiaryIdRef.current = diary.id;
              router.push({ pathname: "/(teacher)/diary-reactions" as any, params: { diaryId: diary.id, lessonDate: diary.lesson_date } });
            }}
            token={token}
            classGroupId={group.id}
          />
        )}
        {auditTarget && (
          <AuditModal diaryId={auditTarget} token={token!} onClose={() => setAuditTarget(null)} />
        )}
        {/* 수업 회차 전환 selector */}
        <SessionSelectorSheet
          visible={showSessionSelector}
          token={token}
          onClose={() => setShowSessionSelector(false)}
          onSelect={handleSessionSwitch}
          currentClassGroupId={group.id}
          currentLessonDate={targetDate}
        />
        {/* dirty 상태에서 회차 전환 시 확인 */}
        <ConfirmModal
          visible={showSwitchConfirm}
          title="수업 변경"
          message="작성 중인 내용이 있습니다. 수업을 변경하면 내용이 초기화됩니다. 계속하시겠습니까?"
          confirmText="변경"
          cancelText="취소"
          onConfirm={() => {
            setShowSwitchConfirm(false);
            const s = pendingSessionRef.current;
            pendingSessionRef.current = null;
            if (s) {
              setTargetDate(s.lessonDate);
              setStartTime(s.scheduleTime);
              const found = groups.find(g => g.id === s.classGroupId);
              if (found) openGroup(found, s.lessonDate);
            }
          }}
          onCancel={() => { setShowSwitchConfirm(false); pendingSessionRef.current = null; }}
        />
        <ConfirmModal
          visible={showVideoGateModal}
          title="영상 업로드 불가"
          message="저장공간이 부족하거나 업로드 제한에 도달했습니다. 구독 관리에서 확인해주세요."
          confirmText="구독 관리"
          cancelText="닫기"
          onConfirm={() => { setShowVideoGateModal(false); router.push("/(admin)/subscription" as any); }}
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
        {/* ── 동일 날짜·슬롯 일지 교체 확인 ─────────────────────────── */}
        <ConfirmModal
          visible={showReplaceConfirm}
          title="이미 작성된 일지가 있습니다"
          message={`${targetDate} 수업의 일지가 이미 작성되어 있습니다.\n새로 작성한 일지로 기존 일지를 바꾸시겠습니까?`}
          confirmText={replaceLoading ? "삭제 중…" : "새로 작성"}
          cancelText="취소"
          onConfirm={async () => {
            if (replaceLoading) return;
            if (!replacingDiaryId) {
              // 기존 diary id 를 못 찾은 경우 — 그냥 write 진입
              setShowReplaceConfirm(false);
              setSubView("write");
              return;
            }
            setReplaceLoading(true);
            try {
              const r = await apiRequest(token, `/diaries/${replacingDiaryId}`, { method: "DELETE" });
              if (r.ok) {
                // diarySet 에서 해당 key 제거
                setDiarySet(prev => {
                  const next = new Set(prev);
                  next.delete(`${selectedGroup!.id}_${targetDate}`);
                  return next;
                });
                // diaries 목록에서도 제거
                setDiaries(prev => prev.filter(d => d.id !== replacingDiaryId));
                setShowReplaceConfirm(false);
                setReplacingDiaryId(null);
                setSubView("write");
              } else {
                const err = await r.json().catch(() => ({}));
                if (__DEV__) console.error("[REPLACE] DELETE failed", r.status, err);
                setShowReplaceConfirm(false);
                setReplaceLoading(false);
                setSaveMsg({ type: "error", text: "기존 일지 삭제에 실패했습니다. 다시 시도해주세요." });
                return;
              }
            } catch (e) {
              if (__DEV__) console.error("[REPLACE] DELETE error", e);
              setShowReplaceConfirm(false);
              setReplaceLoading(false);
              setSaveMsg({ type: "error", text: "기존 일지 삭제 중 오류가 발생했습니다." });
              return;
            }
            setReplaceLoading(false);
          }}
          onCancel={() => {
            setShowReplaceConfirm(false);
            setReplacingDiaryId(null);
          }}
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
  safe:         { flex: 1, backgroundColor: C.surface },
  subHeader:    { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border },
  tabBtn:       { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1.5 },
  tabBtnText:   { fontSize: 12, lineHeight: 17 },
  dateLabelRow: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 2 },
  dateLabel:    { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#6B7280" },
});
