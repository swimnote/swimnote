/**
 * (teacher)/photos.tsx — 사진 & 영상 앨범
 */
import { router, useLocalSearchParams } from "expo-router";
import { LucideIcon } from "@/components/common/LucideIcon";
import * as ImagePicker from "expo-image-picker";
import * as VideoThumbnails from "expo-video-thumbnails";
import { compressImageIfNeeded } from "../../utils/compressImage";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Dimensions, FlatList,
  Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import Colors from "@/constants/colors";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { TeacherClassGroup } from "@/components/teacher/types";
import { API_BASE, apiRequest, safeJson, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { useUploadQueue, PhotoUploadJob } from "@/context/UploadQueueContext";
import { FullAlbumPickerModal } from "@/components/teacher/album/FullAlbumPickerModal";

const C = Colors.light;
const { width: W } = Dimensions.get("window");
const PHOTO_SIZE = Math.floor((W - 6) / 3);
// ── 타입 ──────────────────────────────────────────────────────────────────
type MediaType = "photo" | "video";
type AlbumScope = "group" | "private";
type Step = "home" | "list" | "student" | "upload";
interface MediaItem {
  id: string;
  file_url: string;
  thumbnail_url?: string;
  album_type: string;
  class_name: string;
  schedule_days: string;
  schedule_time: string;
  student_name: string;
  caption: string;
  uploader_name: string;
  created_at: string;
  file_size_bytes: number;
}
interface Student {
  id: string;
  name: string;
  assigned_class_ids?: string[];
  class_group_id?: string | null;
}
interface MediaUsage {
  photo_bytes: number; photo_count: number;
  video_bytes: number; video_count: number;
  total_bytes: number; month_bytes: number;
}
// ── 유틸 함수 (모두 null/undefined 안전) ─────────────────────────────────
function fmtBytes(b: number | null | undefined): string {
  const n = Number(b ?? 0);
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
function parseTs(ts: string): Date {
  const iso = ts.replace(' ', 'T').replace('+00:00', 'Z').replace('+00', 'Z');
  return new Date(iso);
}
function fmtDate(d: string | null | undefined): string {
  if (!d) return "";
  try {
    const dt = parseTs(String(d));
    if (isNaN(dt.getTime())) return "";
    return dt.toLocaleDateString("ko-KR", {
      year: "numeric", month: "short", day: "numeric",
    });
  } catch { return ""; }
}
function safeLabel(item: MediaItem | null | undefined): string {
  if (!item) return "";
  if (item.caption) return item.caption;
  if (item.album_type === "group") return item.class_name || "전체앨범";
  if (item.album_type === "private") return `${item.student_name || "학생"} 개별`;
  return "기타";
}
function normalizeItem(raw: any, idx: number): MediaItem {
  return {
    id: String(raw?.id ?? `item_fallback_${idx}`),
    file_url: String(raw?.presigned_url ?? raw?.file_url ?? raw?.url ?? ""),
    thumbnail_url: raw?.thumbnail_presigned_url ? String(raw.thumbnail_presigned_url) : undefined,
    album_type: String(raw?.album_type ?? "group"),
    class_name: String(raw?.class_name ?? ""),
    schedule_days: String(raw?.schedule_days ?? ""),
    schedule_time: String(raw?.schedule_time ?? ""),
    student_name: String(raw?.student_name ?? ""),
    caption: String(raw?.caption ?? ""),
    uploader_name: String(raw?.uploaded_by_name ?? raw?.uploader_name ?? ""),
    created_at: String(raw?.created_at ?? ""),
    file_size_bytes: Number(raw?.file_size_bytes ?? raw?.file_size ?? 0),
  };
}
function photoUri(url: string | null | undefined, tok?: string | null): string {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  const base = `${API_BASE.replace(/\/api$/, "")}${url}`;
  return tok ? `${base}?token=${tok}` : base;
}
// ── 앨범 설정 ─────────────────────────────────────────────────────────────
const MEDIA_CONFIG: Record<`${MediaType}_${AlbumScope}`, {
  icon: string; title: string; sub: string; color: string; bg: string;
}> = {
  photo_group:   { icon: "image",  title: "사진", sub: "전체앨범", color: "#E4A93A", bg: "#FFF1BF" },
  photo_private: { icon: "user",   title: "사진", sub: "개인앨범", color: C.brandStrong, bg: C.brandMist },
  video_group:   { icon: "video",  title: "영상", sub: "전체앨범", color: C.brandStrong, bg: C.brandMist },
  video_private: { icon: "video",  title: "영상", sub: "개인앨범", color: "#7C3AED", bg: "#EEDDF5" },
};
// ─────────────────────────────────────────────────────────────────────────
export default function TeacherPhotosScreen() {
  // student-scoped mode: studentId + studentName from Student Detail
  const { studentId: paramStudentId, studentName: paramStudentName } = useLocalSearchParams<{ studentId?: string; studentName?: string }>();
  const studentScopeId   = paramStudentId   || null;
  const studentScopeName = paramStudentName || null;

  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();
  const mountedRef = useRef(true);
  const [groups,   setGroups]   = useState<TeacherClassGroup[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [usage,    setUsage]    = useState<MediaUsage | null>(null);
  const [mediaType, setMediaType] = useState<MediaType>("photo");
  const [scope,     setScope]     = useState<AlbumScope>("group");
  // student-scoped mode: 홈 스킵, list로 바로 진입
  const [step,      setStep]      = useState<Step>(studentScopeId ? "list" : "home");
  const [selGroup,  setSelGroup]  = useState<TeacherClassGroup | null>(null);
  const [selStudent,setSelStudent]= useState<Student | null>(null);
  // 리스트 상태
  const [items,       setItems]       = useState<MediaItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError,   setListError]   = useState<string | null>(null);
  const [selectMode,  setSelectMode]  = useState(false);
  const [selected,    setSelected]    = useState<Set<string>>(new Set());
  const [deleting,    setDeleting]    = useState(false);
  const [confirmDel,  setConfirmDel]  = useState(false);
  const [videoActionItem, setVideoActionItem] = useState<MediaItem | null>(null);
  // drag-select refs
  const selectModeRef = useRef(false);
  useEffect(() => { selectModeRef.current = selectMode; }, [selectMode]);
  const dragScrollYRef = useRef(0);
  const dragContainerPageYRef = useRef(0);
  const dragContainerRef = useRef<View>(null);
  const itemsForDragRef = useRef<MediaItem[]>([]);
  useEffect(() => { itemsForDragRef.current = items; }, [items]);
  const [saving,        setSaving]        = useState(false);
  const [confirmSave,   setConfirmSave]   = useState(false);
  const [savedPhotoIds, setSavedPhotoIds] = useState<Set<string>>(new Set());
  // 라이트박스
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const lightboxIdxRef = useRef<number | null>(null);
  const itemsRef = useRef<MediaItem[]>([]);
  useEffect(() => { lightboxIdxRef.current = lightboxIdx; }, [lightboxIdx]);
  useEffect(() => { itemsRef.current = items; }, [items]);
  const lbPanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 10 && Math.abs(gs.dx) > Math.abs(gs.dy),
      onPanResponderRelease: (_, gs) => {
        const cur = lightboxIdxRef.current;
        const arr = itemsRef.current;
        if (cur === null) return;
        if (gs.dx < -50 && cur < arr.length - 1) setLightboxIdx(cur + 1);
        else if (gs.dx > 50 && cur > 0) setLightboxIdx(cur - 1);
      },
    })
  ).current;
  // 업로드
  const [uploading,       setUploading]       = useState(false);
  const [compressProgress, setCompressProgress] = useState(0);
  const [compressTotal,    setCompressTotal]    = useState(0);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg,   setErrorMsg]   = useState<string | null>(null);
  const { addJobs, isActive: uploadActive, done: uploadDone, total: uploadTotal } = useUploadQueue();
  // 업로드 완료 후 목록 자동 새로고침 — loadList 선언 후 아래에서 useEffect 실행
  const prevActiveRef = useRef(false);
  type PlanFeatures = { video_enabled: boolean; storage_quota_gb: number; storage_used_gb: number; storage_used_pct: number; upload_blocked: boolean; tier: string };
  const [planFeatures, setPlanFeatures] = useState<PlanFeatures>({ video_enabled: false, storage_quota_gb: 0, storage_used_gb: 0, storage_used_pct: 0, upload_blocked: false, tier: "free" });
  const [showVideoGateModal,  setShowVideoGateModal]  = useState(false);
  const [showStorageModal,    setShowStorageModal]    = useState(false);
  const [showFullAlbumPicker, setShowFullAlbumPicker] = useState(false);
  // mountedRef 초기화
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  // ── 앨범 설정 (항상 유효한 값) ──────────────────────────────────────────
  const cfgKey = `${mediaType}_${scope}` as `${MediaType}_${AlbumScope}`;
  const cfg = MEDIA_CONFIG[cfgKey] ?? MEDIA_CONFIG["photo_group"];
  // ── 초기 로드 ─────────────────────────────────────────────────────────
  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const [cgRes, stRes, usageRes, featRes] = await Promise.all([
          apiRequest(token, "/class-groups"),
          apiRequest(token, "/students"),
          apiRequest(token, "/teacher/me/media-usage"),
          apiRequest(token, "/billing/features"),
        ]);
        if (featRes?.ok) {
          const feat = await featRes.json().catch(() => null);
          if (!canceled && feat) setPlanFeatures(feat);
        }
        if (canceled) return;
        const [cls, sts] = await Promise.all([safeJson(cgRes), safeJson(stRes)]);
        setGroups(Array.isArray(cls) ? cls : []);
        setStudents(Array.isArray(sts) ? sts : []);
        if (usageRes?.ok) {
          const u = await usageRes.json().catch(() => null);
          if (!canceled && u) setUsage(u);
        }
      } catch (e) {
        console.warn("[photos] init error:", e);
      } finally {
        if (!canceled) setLoading(false);
      }
    })();
    return () => { canceled = true; };
  }, [token]);
  // ── 리스트 로드 ──────────────────────────────────────────────────────
  // forceMt/forceSc: openList에서 setMediaType/setScope 직후 직접 호출 시
  // 상태 업데이트가 아직 반영 안 된 stale closure 문제를 피하기 위해 명시적 파라미터 사용
  const loadList = useCallback(async (forceMt?: MediaType, forceSc?: AlbumScope) => {
    const mt = forceMt !== undefined ? forceMt : mediaType;
    const sc = forceSc !== undefined ? forceSc : scope;
    setListLoading(true);
    setListError(null);
    try {
      const isPhoto = mt === "photo";
      // student-scoped mode: GET /photos/private/:studentId (기존 backend 재사용)
      // video는 student-scoped private endpoint 없음 → teacher-all fallback
      const endpoint = (studentScopeId && isPhoto)
        ? `/photos/private/${studentScopeId}`
        : isPhoto
          ? `/photos/teacher-all?scope=${sc}`
          : `/videos/teacher-all?scope=${sc}`;
      const res = await apiRequest(token, endpoint);
      const data = await safeJson(res);
      let raw: any[] = [];
      if (Array.isArray(data)) {
        raw = data;
      } else if (data && typeof data === "object") {
        const key = isPhoto ? "photos" : "videos";
        raw = Array.isArray(data[key]) ? data[key] : [];
      }
      const normalized = raw.map((r, i) => normalizeItem(r, i));
      if (mountedRef.current) {
        setItems(normalized);
      }
    } catch (e) {
      console.warn("[ALBUM LOAD] ERROR:", e);
      if (mountedRef.current) {
        setListError("목록을 불러오는 중 오류가 발생했습니다.");
      }
    } finally {
      if (mountedRef.current) setListLoading(false);
    }
  }, [token, mediaType, scope]);
  // student-scoped mode: 초기 진입 시 list 자동 로드
  useEffect(() => {
    if (studentScopeId) {
      loadList("photo", "private");
    }
    // studentScopeId는 route mount 시 한 번만 적용
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentScopeId]);

  // 업로드 완료 후 목록 자동 새로고침
  useEffect(() => {
    if (prevActiveRef.current && !uploadActive && step === "list") {
      loadList();
    }
    prevActiveRef.current = uploadActive;
  }, [uploadActive, step, loadList]);
  const openList = useCallback((mt: MediaType, sc: AlbumScope) => {
    setMediaType(mt);
    setScope(sc);
    setSelectMode(false);
    setSelected(new Set());
    setItems([]);
    setStep("list");
    // 상태 업데이트는 비동기 배치이므로, 명시적 파라미터로 즉시 로드
    loadList(mt, sc);
  }, [loadList]);
  // 전체앨범 사진 목록 로드 시 내앨범 저장 여부 병렬 로드
  useEffect(() => {
    if (step !== "list" || scope !== "group" || mediaType !== "photo") return;
    (async () => {
      try {
        const res = await apiRequest(token, "/photos/saved");
        const data = await safeJson(res);
        const photos: any[] = Array.isArray(data?.photos) ? data.photos : [];
        setSavedPhotoIds(new Set(photos.map((p: any) => p.id)));
      } catch { /* 무시 */ }
    })();
  }, [step, scope, mediaType, token]);
  // ── 선택 모드 ─────────────────────────────────────────────────────────
  function exitSelect() { setSelectMode(false); setSelected(new Set()); }
  function toggleSelect(id: string) {
    if (!id) return;
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleAll() {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map(i => i.id).filter(Boolean)));
  }
  // ── drag-select: 사진 3열 그리드 ─────────────────────────────────────
  function selectPhotoAt(pageX: number, pageY: number) {
    if (!selectModeRef.current) return;
    const relY = pageY - dragContainerPageYRef.current + dragScrollYRef.current - 2;
    if (relY < 0) return;
    const col = Math.min(2, Math.max(0, Math.floor(pageX / (PHOTO_SIZE + 2))));
    const row = Math.floor(relY / (PHOTO_SIZE + 2));
    const idx = row * 3 + col;
    const target = itemsForDragRef.current[idx];
    if (target?.id) {
      setSelected(prev => {
        if (prev.has(target.id)) return prev;
        const n = new Set(prev); n.add(target.id); return n;
      });
    }
  }
  const photoGridDragPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => selectModeRef.current,
    onMoveShouldSetPanResponder: () => selectModeRef.current,
    onPanResponderGrant: e => selectPhotoAt(e.nativeEvent.pageX, e.nativeEvent.pageY),
    onPanResponderMove: e => selectPhotoAt(e.nativeEvent.pageX, e.nativeEvent.pageY),
  })).current;
  // ── drag-select: 영상 리스트 (행 높이 약 76px) ───────────────────────
  const VIDEO_ROW_H = 76;
  function selectVideoAt(pageY: number) {
    if (!selectModeRef.current) return;
    const relY = pageY - dragContainerPageYRef.current + dragScrollYRef.current - 12;
    if (relY < 0) return;
    const idx = Math.floor(relY / (VIDEO_ROW_H + 8));
    const target = itemsForDragRef.current[idx];
    if (target?.id) {
      setSelected(prev => {
        if (prev.has(target.id)) return prev;
        const n = new Set(prev); n.add(target.id); return n;
      });
    }
  }
  const videoListDragPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => selectModeRef.current,
    onMoveShouldSetPanResponder: () => selectModeRef.current,
    onPanResponderGrant: e => selectVideoAt(e.nativeEvent.pageY),
    onPanResponderMove: e => selectVideoAt(e.nativeEvent.pageY),
  })).current;
  // ── 개별 영상 삭제 ─────────────────────────────────────────────────
  async function deleteSingleVideo(id: string) {
    setVideoActionItem(null);
    setDeleting(true);
    try {
      setItems(prev => prev.filter(i => i.id !== id));
      const res = await fetch(`${API_BASE}/videos/bulk`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ ids: [id] }),
      });
      const data = await res.json().catch(() => ({}));
      const deleted = (data as any)?.deleted ?? 1;
      setSuccessMsg(`${deleted}개가 삭제됐습니다.`);
    } catch {
      setSuccessMsg("삭제됐습니다.");
    } finally {
      setDeleting(false);
    }
  }
  // ── 선택 삭제 ─────────────────────────────────────────────────────────
  async function deleteSelected() {
    const ids = Array.from(selected).filter(Boolean);
    if (ids.length === 0) { setConfirmDel(false); return; }
    setDeleting(true);
    const isPhoto = mediaType === "photo";
    try {
      setItems(prev => prev.filter(i => !ids.includes(i.id)));
      exitSelect();
      const endpoint = scope === "private"
        ? (isPhoto ? "/photos/saved" : "/videos/saved")
        : (isPhoto ? "/photos/bulk" : "/videos/bulk");
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json().catch(() => ({}));
      const deleted = (data as any)?.deleted ?? ids.length;
      setSuccessMsg(
        scope === "private"
          ? `${deleted}개가 개인앨범에서 제거됐습니다.`
          : `${deleted}개가 삭제됐습니다.`
      );
    } catch (e) {
      console.warn("[photos] delete error:", e);
      setSuccessMsg(`${ids.length}개가 처리됐습니다.`);
    } finally {
      setDeleting(false);
      setConfirmDel(false);
    }
  }
  // ── 내앨범으로 이동 ───────────────────────────────────────────────────
  async function saveToMyAlbum() {
    const ids = Array.from(selected).filter(Boolean);
    if (!ids.length) { setConfirmSave(false); return; }
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/photos/saved`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ photo_ids: ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.error ?? "저장 실패");
      setSavedPhotoIds(prev => new Set([...prev, ...ids]));
      setSuccessMsg(`${ids.length}장이 내 개인앨범에 추가됐습니다.`);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
      setConfirmSave(false);
    }
  }
  // ── 업로드 ────────────────────────────────────────────────────────────
  const groupStudents = (selGroup
    ? students.filter(st =>
        (Array.isArray(st.assigned_class_ids) && st.assigned_class_ids.includes(selGroup.id))
        || st.class_group_id === selGroup.id
      )
    : []
  ).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  function selectStudent(st: Student) {
    setSelStudent(st);
    setStep("upload");
  }
  async function handleTileUpload(mt: MediaType, sc: AlbumScope) {
    const isVideo = mt === "video";
    if (isVideo && !planFeatures.video_enabled) { setShowVideoGateModal(true); return; }
    if (planFeatures.storage_used_pct >= 100) { setShowStorageModal(true); return; }
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert("권한 필요", "미디어 접근 권한이 필요합니다."); return; }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: isVideo ? ["videos"] : ["images"],
        allowsMultipleSelection: !isVideo,
        quality: isVideo ? 1 : 0.85,
        selectionLimit: isVideo ? 1 : 100,
      });
      if (result.canceled || !result.assets?.length) return;
      const assets = result.assets;
      await doUpload(assets, null, null, mt, sc);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "업로드 중 오류가 발생했습니다.");
    }
  }
  async function doUpload(assets: any[], group: TeacherClassGroup | null | undefined, student: Student | null | undefined, overrideMt?: MediaType, overrideSc?: AlbumScope) {
    const isVideo = (overrideMt ?? mediaType) === "video";
    const sc = overrideSc ?? scope;
    setUploading(true);
    try {
      if (!isVideo) {
        setCompressTotal(assets.length);
        setCompressProgress(0);
        const endpoint = sc === "group" ? "/photos/group" : "/photos/private";
        const jobs: PhotoUploadJob[] = [];
        const BATCH = 5;
        for (let i = 0; i < assets.length; i += BATCH) {
          const batch = assets.slice(i, i + BATCH);
          const uris = await Promise.all(
            batch.map((a: any) => compressImageIfNeeded(a.uri, a.fileSize ?? undefined))
          );
          uris.forEach(uri => jobs.push({
            uri,
            endpoint,
            params: {
              class_id: group?.id ?? "",
              ...(sc === "private" && student?.id ? { student_id: student.id } : {}),
            },
            token: token ?? "",
          }));
          setCompressProgress(Math.min(i + BATCH, assets.length));
        }
        addJobs(jobs);
        setSuccessMsg(`${assets.length}장 업로드 시작!\n화면을 이동해도 계속 업로드됩니다.`);
        return;
      }
      // ── 영상: 블로킹 방식 ────────────────────────────────────────────
      const form = new FormData();
      for (const asset of assets) {
        const uri = asset.uri;
        form.append("video", {
          uri,
          name: asset.fileName || "video.mp4",
          type: asset.mimeType || "video/mp4",
        } as any);
        try {
          const thumb = await VideoThumbnails.getThumbnailAsync(uri, { time: 1000 });
          form.append("thumbnail", {
            uri: thumb.uri,
            name: "thumbnail.jpg",
            type: "image/jpeg",
          } as any);
        } catch (thumbErr) {
          console.warn("[videos] 썸네일 생성 실패 (무시됨):", thumbErr);
        }
      }
      form.append("class_id", group?.id ?? "");
      if (sc === "private" && student?.id) form.append("student_id", student.id);
      const videoEndpoint = sc === "group" ? "/videos/group" : "/videos/private";
      const res = await fetch(`${API_BASE}${videoEndpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token ?? ""}` },
        body: form,
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((resData as any)?.error ?? "업로드 실패");
      setSuccessMsg(
        sc === "group"
          ? `영상이 ${group?.name ? `${group.name} ` : ""}전체앨범에 추가됐습니다.`
          : `영상이 ${student?.name ?? "학생"} 개인 ${cfg.title} 앨범에 추가됐습니다.`
      );
      await loadList();
    } catch (e: any) {
      console.warn("[photos] upload error:", e);
      setErrorMsg(e?.message ?? "업로드 중 오류가 발생했습니다.");
    } finally {
      setUploading(false);
      setCompressTotal(0);
      setCompressProgress(0);
    }
  }
  async function pickAndUpload() {
    const isVideo = mediaType === "video";
    if (isVideo && !planFeatures.video_enabled) { setShowVideoGateModal(true); return; }
    if (planFeatures.storage_used_pct >= 100) { setShowStorageModal(true); return; }
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert("권한 필요", "미디어 접근 권한이 필요합니다."); return; }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: isVideo ? ["videos"] : ["images"],
        allowsMultipleSelection: !isVideo,
        quality: isVideo ? 1 : 0.85,
        selectionLimit: isVideo ? 1 : 100,
      });
      if (result.canceled || !result.assets?.length) return;
      await doUpload(result.assets, selGroup, selStudent);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "업로드 중 오류가 발생했습니다.");
    }
  }
  // ── 로딩 ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <SubScreenHeader title="사진 & 영상" homePath="/(teacher)/today-schedule" />
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }
  // ── 홈 ────────────────────────────────────────────────────────────────
  if (step === "home") {
    const HOME_TILES: {
      key: string; mt: MediaType; sc: AlbumScope;
      icon: string; title: string; sub: string;
      color: string; bg: string; isPremier: boolean;
    }[] = [
      { key: "photo_upload",   mt: "photo", sc: "group",   icon: "camera",  title: "전체사진 업로드", sub: "전체 학생에게 공유",  color: "#B45309", bg: "#FEF3C7", isPremier: false },
      { key: "video_upload",   mt: "video", sc: "group",   icon: "video",   title: "전체영상 업로드", sub: "전체 학생에게 공유",  color: "#0F766E", bg: "#CCFBF1", isPremier: false },
      { key: "photo_album",    mt: "photo", sc: "private", icon: "image",   title: "내사진앨범",     sub: "내가 올린 개인 사진", color: "#C2410C", bg: "#FFEDD5", isPremier: false },
      { key: "video_album",    mt: "video", sc: "private", icon: "video",   title: "내영상앨범",     sub: "내가 올린 개인 영상", color: "#5B21B6", bg: "#EDE9FE", isPremier: false },
    ];
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <SubScreenHeader title="사진 & 영상" homePath="/(teacher)/today-schedule" />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}>
          <View style={s.grid}>
            {HOME_TILES.map(tile => (
              <Pressable
                key={tile.key}
                style={[s.gridBtn, { backgroundColor: tile.bg, borderColor: tile.color + "90" }]}
                onPress={() => openList(tile.mt, tile.sc)}
                accessibilityRole="button"
                accessibilityLabel={tile.title}
              >
                {tile.isPremier && (
                  <View style={s.premierBadge}>
                    <Text style={s.premierBadgeText}>프리미어 이상</Text>
                  </View>
                )}
                <View style={[s.gridIcon, { backgroundColor: tile.color + "20" }]}>
                  <LucideIcon name={tile.icon} size={32} color={tile.color} />
                </View>
                <Text style={[s.gridTitle, { color: tile.color }]}>{tile.title}</Text>
                <Text style={[s.gridSub, { color: tile.color + "CC" }]}>{tile.sub}</Text>
              </Pressable>
            ))}
          </View>
          <View style={s.limitCard}>
            <View style={s.limitCardHeader}>
              <LucideIcon name="info" size={14} color={C.textSecondary} />
              <Text style={s.limitCardTitle}>업로드 제한사항</Text>
            </View>
            <View style={s.limitCardBody}>
              <View style={s.limitRow}>
                <LucideIcon name="image" size={13} color="#E4A93A" />
                <Text style={s.limitText}>사진: 1장 최대 <Text style={{ color: C.textPrimary }}>8MB</Text> · 최대 <Text style={{ color: C.textPrimary }}>100장</Text> 동시 업로드</Text>
              </View>
              <View style={s.limitRow}>
                <LucideIcon name="video" size={13} color={C.brandStrong} />
                <Text style={s.limitText}>영상: 1개 최대 <Text style={{ color: C.textPrimary }}>100MB</Text> · <Text style={{ color: "#7C3AED" }}>프리미어 플랜</Text> 이상만 사용 가능</Text>
              </View>
              <View style={s.limitRow}>
                <LucideIcon name="users" size={13} color={C.textMuted} />
                <Text style={s.limitText}>업로드한 사진·영상은 학부모 앱에서 즉시 확인 가능합니다</Text>
              </View>
              <View style={s.limitRow}>
                <LucideIcon name="hard-drive" size={13} color={C.textMuted} />
                <Text style={s.limitText}>저장공간 초과 시 업로드가 제한됩니다 (현재 {planFeatures.storage_used_pct.toFixed(0)}% 사용 중)</Text>
              </View>
            </View>
          </View>
          <View style={s.usageCard}>
            <View style={s.usageCardHeader}>
              <LucideIcon name="hard-drive" size={15} color={themeColor} />
              <Text style={[s.usageCardTitle, { color: themeColor }]}>내 업로드 사용량</Text>
            </View>
            {usage === null ? (
              <View style={{ paddingVertical: 18, alignItems: "center" }}>
                <ActivityIndicator size="small" color={themeColor} />
                <Text style={[s.usageMonthText, { marginTop: 6 }]}>사용량 계산 중…</Text>
              </View>
            ) : (
              <View style={s.usageCardBody}>
                {([
                  { icon: "image" as const, color: "#E4A93A", label: `사진 ${usage.photo_count}개`, bytes: usage.photo_bytes },
                  { icon: "video" as const, color: "#7C3AED", label: `영상 ${usage.video_count}개`, bytes: usage.video_bytes },
                ]).map(row => (
                  <View key={row.label} style={s.usageItem}>
                    <LucideIcon name={row.icon} size={14} color={row.color} />
                    <Text style={s.usageItemLabel}>{row.label}</Text>
                    <Text style={s.usageItemBytes}>{fmtBytes(row.bytes)}</Text>
                  </View>
                ))}
                <View style={s.usageDivider} />
                <View style={[s.usageItem, { backgroundColor: themeColor + "08" }]}>
                  <LucideIcon name="database" size={14} color={themeColor} />
                  <Text style={[s.usageItemLabel, { color: themeColor, fontFamily: "Pretendard-Regular" }]}>총 사용량</Text>
                  <Text style={[s.usageItemBytes, { color: themeColor, fontFamily: "Pretendard-Regular" }]}>{fmtBytes(usage.total_bytes)}</Text>
                </View>
                <Text style={s.usageMonthText}>이번 달: {fmtBytes(usage.month_bytes)}</Text>
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }
  // ── 리스트 뷰 ─────────────────────────────────────────────────────────
  if (step === "list") {
    const isPhoto = mediaType === "photo";
    const safeItems = Array.isArray(items) ? items : [];
    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <SubScreenHeader
          title={studentScopeName ? `${studentScopeName} · 사진/영상` : `${cfg.title} ${cfg.sub}`}
          subtitle={listLoading ? "불러오는 중…" : `${safeItems.length}개`}
          onBack={() => { exitSelect(); studentScopeId ? router.back() : setStep("home"); }}
          homePath="/(teacher)/today-schedule"
        />
        {selectMode ? (
          <View style={s.selectBar}>
            <Pressable onPress={toggleAll} style={s.selectBarLeft}>
              <LucideIcon
                name={selected.size === safeItems.length && safeItems.length > 0 ? "check-square" : "square"}
                size={18} color={cfg.color}
              />
              <Text style={[s.selectBarAllText, { color: cfg.color }]}>
                {selected.size === safeItems.length && safeItems.length > 0 ? "전체해제" : "전체선택"}
              </Text>
            </Pressable>
            <Text style={s.selectBarCount}>{selected.size}개 선택</Text>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {scope === "group" && mediaType === "photo" && (
                <Pressable
                  onPress={() => selected.size > 0 && setConfirmSave(true)}
                  disabled={selected.size === 0 || saving || deleting}
                  style={[s.selectBarSave, { opacity: selected.size === 0 ? 0.4 : 1 }]}
                >
                  {saving
                    ? <ActivityIndicator color="#fff" size="small" />
                    : (
                      <>
                        <LucideIcon name="bookmark-plus" size={14} color="#fff" />
                        <Text style={s.selectBarSaveText}>내앨범</Text>
                      </>
                    )
                  }
                </Pressable>
              )}
              <Pressable
                onPress={() => {
                  if (selected.size === 0) {
                    // 전체 선택 후 삭제
                    setSelected(new Set(safeItems.map(i => i.id).filter(Boolean)));
                    setTimeout(() => setConfirmDel(true), 0);
                  } else {
                    setConfirmDel(true);
                  }
                }}
                disabled={deleting || saving}
                style={[s.selectBarDel, { opacity: deleting ? 0.4 : 1 }]}
              >
                {deleting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : (
                    <>
                      <LucideIcon name="trash-2" size={14} color="#fff" />
                      <Text style={s.selectBarDelText}>
                        {selected.size === 0 ? "전체삭제" : `${selected.size}개 삭제`}
                      </Text>
                    </>
                  )
                }
              </Pressable>
              <Pressable onPress={exitSelect} style={s.selectBarCancel}>
                <Text style={s.selectBarCancelText}>취소</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={s.listToolbar}>
            {safeItems.length > 0 && (
              <Pressable onPress={() => setSelectMode(true)} style={s.listSelectBtn}>
                <LucideIcon name="check-square" size={15} color={cfg.color} />
                <Text style={[s.listSelectBtnText, { color: cfg.color }]}>선택</Text>
              </Pressable>
            )}
          </View>
        )}
        {listLoading ? (
          <View style={s.centerBox}>
            <ActivityIndicator color={cfg.color} size="large" />
            <Text style={s.centerText}>목록을 불러오는 중…</Text>
          </View>
        ) : listError && !uploadActive ? (
          <View style={s.centerBox}>
            <LucideIcon name="alert-circle" size={36} color="#D96C6C" />
            <Text style={[s.centerText, { color: "#D96C6C" }]}>{listError}</Text>
            <Pressable onPress={() => loadList()} style={s.retryBtn}>
              <LucideIcon name="refresh-cw" size={14} color="#fff" />
              <Text style={s.retryBtnText}>다시 시도</Text>
            </Pressable>
          </View>
        ) : uploadActive && safeItems.length === 0 ? (
          <View style={s.centerBox}>
            <Text style={s.centerText}>업로드 중… {uploadDone}/{uploadTotal}장</Text>
            <Text style={[s.centerText, { fontSize: 13, color: C.textMuted, marginTop: 4 }]}>완료 후 자동으로 목록이 업데이트됩니다</Text>
          </View>
        ) : safeItems.length === 0 ? (
          <View style={s.centerBox}>
            <LucideIcon name={cfg.icon} size={44} color="#D1D5DB" />
            <Text style={s.emptyTitle}>아직 업로드된 {cfg.title}이 없습니다</Text>
            <Text style={s.emptySubText}>아래 + 버튼으로 {cfg.title}을 업로드하세요</Text>
          </View>
        ) : isPhoto ? (
          <View
            ref={dragContainerRef}
            style={{ flex: 1 }}
            onLayout={() => {
              dragContainerRef.current?.measure((_x, _y, _w, _h, _px, py) => {
                dragContainerPageYRef.current = py;
              });
            }}
            {...(selectMode ? photoGridDragPan.panHandlers : {})}
          >
          <FlatList
            data={safeItems}
            keyExtractor={(item, idx) => item?.id ?? String(idx)}
            numColumns={3}
            scrollEnabled={!selectMode}
            contentContainerStyle={{ padding: 2, paddingBottom: insets.bottom + 100 }}
            columnWrapperStyle={{ gap: 2 }}
            removeClippedSubviews
            onScroll={e => { dragScrollYRef.current = e.nativeEvent.contentOffset.y; }}
            scrollEventThrottle={16}
            onLayout={() => {
              console.log(`[ALBUM FLATLIST] data.length=${safeItems.length}`);
            }}
            renderItem={({ item, index }) => {
              if (!item) return null;
              const isSel = selected.has(item.id);
              const isSaved = scope === "group" && mediaType === "photo" && savedPhotoIds.has(item.id);
              const label = safeLabel(item);
              const uri = photoUri(item.file_url, token);
              if (index === 0) {
                console.log(`[ALBUM IMAGE RENDER] index=0 mediaId=${item.id} status=${(item as any).media_status ?? "n/a"} fileUrl=${item.file_url} resolvedUri=${uri}`);
              }
              return (
                <Pressable
                  onPress={() => selectMode ? toggleSelect(item.id) : setLightboxIdx(items.findIndex(i => i.id === item.id))}
                  onLongPress={() => {
                    if (!selectMode) {
                      setSelectMode(true);
                      setSelected(new Set([item.id]));
                    }
                  }}
                  style={[
                    s.photoCell,
                    { width: PHOTO_SIZE, height: PHOTO_SIZE },
                    isSaved && !isSel && { borderWidth: 2, borderColor: C.brandStrong },
                    isSel && { borderWidth: 3, borderColor: cfg.color },
                  ]}
                >
                  {uri ? (
                    <Image
                      source={{ uri }}
                      style={{ width: "100%", height: "100%" }}
                      contentFit="cover"
                      cachePolicy="memory"
                      onError={(e) => console.warn(`[ALBUM IMAGE ERROR] mediaId=${item.id} resolvedUri=${uri} error=${JSON.stringify(e.error)}`)}
                    />
                  ) : (
                    <View style={s.photoPlaceholder}>
                      <LucideIcon name="image" size={22} color="#D1D5DB" />
                    </View>
                  )}
                  {!!item.created_at && (
                    <View style={s.photoDateOverlay}>
                      <Text style={s.photoDateText}>
                        {fmtDate(item.created_at).replace("년 ", "/").replace("월 ", "/").replace("일", "")}
                      </Text>
                    </View>
                  )}
                  {!!label && (
                    <View style={s.photoLabelBar}>
                      <Text style={s.photoLabelText} numberOfLines={1}>{label}</Text>
                    </View>
                  )}
                  {isSaved && (
                    <View style={s.savedBadge}>
                      <LucideIcon name="bookmark-plus" size={11} color="#fff" />
                    </View>
                  )}
                  {selectMode && (
                    <View style={[
                      s.checkCircle,
                      isSel && { backgroundColor: cfg.color, borderColor: cfg.color },
                    ]}>
                      {isSel && <LucideIcon name="check" size={12} color="#fff" />}
                    </View>
                  )}
                </Pressable>
              );
            }}
          />
          </View>
        ) : (
          <View
            ref={dragContainerRef}
            style={{ flex: 1 }}
            onLayout={() => {
              dragContainerRef.current?.measure((_x, _y, _w, _h, _px, py) => {
                dragContainerPageYRef.current = py;
              });
            }}
            {...(selectMode ? videoListDragPan.panHandlers : {})}
          >
          <FlatList
            data={safeItems}
            keyExtractor={(item, idx) => item?.id ?? String(idx)}
            scrollEnabled={!selectMode}
            contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: insets.bottom + 100 }}
            onScroll={e => { dragScrollYRef.current = e.nativeEvent.contentOffset.y; }}
            scrollEventThrottle={16}
            renderItem={({ item }) => {
              if (!item) return null;
              const isSel = selected.has(item.id);
              const label = safeLabel(item);
              return (
                <Pressable
                  onPress={() => {
                    if (selectMode) { toggleSelect(item.id); return; }
                    setVideoActionItem(item);
                  }}
                  onLongPress={() => {
                    if (!selectMode) {
                      setSelectMode(true);
                      setSelected(new Set([item.id]));
                    }
                  }}
                  style={[
                    s.videoRow,
                    { backgroundColor: C.card },
                    isSel && { borderWidth: 2, borderColor: cfg.color },
                  ]}
                >
                  {item.thumbnail_url ? (
                    <Image
                      source={{ uri: item.thumbnail_url }}
                      style={[s.videoThumb, { borderRadius: 12 }]}
                      contentFit="cover"
                      cachePolicy="memory"
                    />
                  ) : (
                    <View style={[s.videoThumb, { backgroundColor: cfg.bg, borderRadius: 12 }]}>
                      <LucideIcon name="video" size={22} color={cfg.color} />
                    </View>
                  )}
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={s.videoLabel} numberOfLines={1}>{label || "영상"}</Text>
                    <Text style={s.videoMeta} numberOfLines={1}>
                      {fmtDate(item.created_at)}
                      {item.file_size_bytes ? ` · ${fmtBytes(item.file_size_bytes)}` : ""}
                    </Text>
                    {!!item.uploader_name && (
                      <Text style={s.videoUploader} numberOfLines={1}>{item.uploader_name}</Text>
                    )}
                  </View>
                  {selectMode ? (
                    <View style={[s.checkCircle, isSel && { backgroundColor: cfg.color, borderColor: cfg.color }]}>
                      {isSel && <LucideIcon name="check" size={12} color="#fff" />}
                    </View>
                  ) : (
                    <LucideIcon name="chevron-right" size={18} color={C.textSecondary} />
                  )}
                </Pressable>
              );
            }}
          />
          </View>
        )}
        {!selectMode && (
          <Pressable
            onPress={() => {
              if (scope === "private") {
                setShowFullAlbumPicker(true);
              } else {
                pickAndUpload();
              }
            }}
            style={[s.fab, { backgroundColor: cfg.color, bottom: insets.bottom + 20 }]}
            accessibilityRole="button"
            accessibilityLabel={`${cfg.title} ${scope === "private" ? "저장" : "업로드"}`}
          >
            {uploading ? <ActivityIndicator color="#fff" /> : <LucideIcon name="plus" size={26} color="#fff" />}
          </Pressable>
        )}
        <FullAlbumPickerModal
          visible={showFullAlbumPicker}
          mediaType={mediaType}
          token={token}
          onClose={() => setShowFullAlbumPicker(false)}
          onSaved={(count) => {
            setShowFullAlbumPicker(false);
            setSuccessMsg(`${count}개가 개인앨범에 저장됐습니다.`);
            loadList();
          }}
        />
        {(() => {
          const lbItem = lightboxIdx !== null ? items[lightboxIdx] ?? null : null;
          const hasPrev = lightboxIdx !== null && lightboxIdx > 0;
          const hasNext = lightboxIdx !== null && lightboxIdx < items.length - 1;
          return (
            <Modal
              visible={lightboxIdx !== null}
              transparent
              animationType="fade"
              statusBarTranslucent
              onRequestClose={() => setLightboxIdx(null)}
            >
              <View style={s.lbBg}>
                <View style={[s.lbTopBar, { paddingTop: insets.top + 12 }]}>
                  <Pressable
                    onPress={() => setLightboxIdx(null)}
                    style={s.lbClose}
                    accessibilityRole="button"
                    accessibilityLabel="닫기"
                  >
                    <LucideIcon name="x" size={26} color="#fff" />
                  </Pressable>
                  {items.length > 1 && lightboxIdx !== null && (
                    <Text style={s.lbCounter}>{lightboxIdx + 1} / {items.length}</Text>
                  )}
                  <View style={{ width: 44 }} />
                </View>
                <View style={s.lbImageWrap} {...lbPanResponder.panHandlers}>
                  {lbItem && !!lbItem.file_url ? (
                    <Image
                      source={{ uri: photoUri(lbItem.file_url, token) }}
                      style={s.lbImage}
                      contentFit="contain"
                      cachePolicy="memory"
                    />
                  ) : (
                    <View style={s.lbImagePlaceholder}>
                      <LucideIcon name="image" size={60} color="rgba(255,255,255,0.3)" />
                      <Text style={{ color: "rgba(255,255,255,0.4)", marginTop: 12 }}>이미지를 불러올 수 없습니다</Text>
                    </View>
                  )}
                </View>
                {lbItem && !!safeLabel(lbItem) && (
                  <Text style={s.lbLabel}>{safeLabel(lbItem)}</Text>
                )}
                {lbItem && (
                  <Text style={s.lbMeta}>
                    {lbItem.uploader_name ? `${lbItem.uploader_name}  ` : ""}
                    {fmtDate(lbItem.created_at)}
                    {lbItem.file_size_bytes ? `  ·  ${fmtBytes(lbItem.file_size_bytes)}` : ""}
                  </Text>
                )}
                {items.length > 1 && (
                  <View style={s.lbArrowRow}>
                    <Pressable
                      onPress={() => setLightboxIdx(i => (i !== null && i > 0 ? i - 1 : i))}
                      style={[s.lbArrow, !hasPrev && s.lbArrowDisabled]}
                      hitSlop={16}
                      disabled={!hasPrev}
                    >
                      <LucideIcon name="chevron-left" size={28} color={hasPrev ? "#fff" : "rgba(255,255,255,0.25)"} />
                    </Pressable>
                    <Pressable
                      onPress={() => setLightboxIdx(i => (i !== null && i < items.length - 1 ? i + 1 : i))}
                      style={[s.lbArrow, !hasNext && s.lbArrowDisabled]}
                      disabled={!hasNext}
                    >
                      <LucideIcon name="chevron-right" size={28} color={hasNext ? "#fff" : "rgba(255,255,255,0.25)"} />
                    </Pressable>
                  </View>
                )}
                <View style={{ flexDirection: "row", justifyContent: "center", marginTop: 8, gap: 10 }}>
                  <Pressable
                    onPress={() => {
                      if (!lbItem) return;
                      setLightboxIdx(null);
                      toggleSelect(lbItem.id ?? "");
                      if (!selectMode) setSelectMode(true);
                    }}
                    style={[s.lbActionBtn, { backgroundColor: "#0F2742" }]}
                  >
                    <LucideIcon name="trash-2" size={15} color="#fff" />
                    <Text style={s.lbActionBtnText}>삭제</Text>
                  </Pressable>
                  <Pressable onPress={() => setLightboxIdx(null)} style={[s.lbActionBtn, { backgroundColor: "#64748B" }]}>
                    <LucideIcon name="x" size={15} color="#fff" />
                    <Text style={s.lbActionBtnText}>닫기</Text>
                  </Pressable>
                </View>
              </View>
            </Modal>
          );
        })()}
        {/* ── 영상 상세 시트 ── */}
        <Modal
          visible={!!videoActionItem}
          transparent
          animationType="slide"
          statusBarTranslucent
          onRequestClose={() => setVideoActionItem(null)}
        >
          <Pressable style={s.vdOverlay} onPress={() => setVideoActionItem(null)}>
            <Pressable style={[s.vdSheet, { paddingBottom: insets.bottom + 20 }]} onPress={e => e.stopPropagation()}>
              <View style={s.vdHandle} />
              {videoActionItem?.thumbnail_url ? (
                <Image
                  source={{ uri: videoActionItem.thumbnail_url }}
                  style={s.vdThumb}
                  contentFit="cover"
                  cachePolicy="memory"
                />
              ) : (
                <View style={[s.vdThumb, { backgroundColor: cfg.bg, borderRadius: 14, alignItems: "center", justifyContent: "center" }]}>
                  <LucideIcon name="video" size={40} color={cfg.color} />
                </View>
              )}
              <Text style={s.vdLabel} numberOfLines={2}>{safeLabel(videoActionItem ?? undefined as any) || "영상"}</Text>
              <Text style={s.vdMeta}>
                {fmtDate(videoActionItem?.created_at)}
                {videoActionItem?.file_size_bytes ? `  ·  ${fmtBytes(videoActionItem.file_size_bytes)}` : ""}
              </Text>
              <View style={s.vdBtnRow}>
                <Pressable
                  style={[s.vdBtn, { backgroundColor: "#D96C6C" }]}
                  onPress={() => {
                    if (videoActionItem?.id) {
                      deleteSingleVideo(videoActionItem.id);
                    }
                  }}
                  disabled={deleting}
                >
                  {deleting
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <><LucideIcon name="trash-2" size={16} color="#fff" /><Text style={s.vdBtnTxt}>삭제</Text></>}
                </Pressable>
                <Pressable
                  style={[s.vdBtn, { backgroundColor: cfg.color }]}
                  onPress={() => {
                    if (videoActionItem?.id) {
                      const id = videoActionItem.id;
                      setVideoActionItem(null);
                      setTimeout(() => {
                        setSelectMode(true);
                        setSelected(new Set([id]));
                      }, 100);
                    }
                  }}
                >
                  <LucideIcon name="check-square" size={16} color="#fff" />
                  <Text style={s.vdBtnTxt}>선택모드</Text>
                </Pressable>
                <Pressable style={[s.vdBtn, { backgroundColor: C.backgroundSoft }]} onPress={() => setVideoActionItem(null)}>
                  <Text style={[s.vdBtnTxt, { color: C.textPrimary }]}>닫기</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
        <ConfirmModal
          visible={confirmSave}
          title="내앨범에 추가"
          message={`선택한 사진 ${selected.size}장을 내 개인앨범에 추가합니다.\n(전체앨범에서 삭제되지 않습니다)`}
          confirmText="추가"
          cancelText="취소"
          onConfirm={saveToMyAlbum}
          onCancel={() => setConfirmSave(false)}
        />
        <ConfirmModal
          visible={confirmDel}
          title={`${selected.size > 0 ? selected.size : safeItems.length}개 삭제`}
          message={`선택한 ${mediaType === "photo" ? "사진" : "영상"} ${selected.size > 0 ? selected.size : safeItems.length}개를 삭제합니다.\n이 작업은 취소할 수 없습니다.`}
          confirmText="삭제"
          destructive
          onConfirm={deleteSelected}
          onCancel={() => setConfirmDel(false)}
        />
        <ConfirmModal
          visible={!!successMsg}
          title="완료"
          message={successMsg ?? ""}
          confirmText="확인"
          onConfirm={() => setSuccessMsg(null)}
        />
        <ConfirmModal
          visible={!!errorMsg}
          title="오류"
          message={errorMsg ?? ""}
          confirmText="확인"
          onConfirm={() => setErrorMsg(null)}
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
        <ConfirmModal
          visible={showStorageModal}
          title="저장공간 초과"
          message={`저장공간이 가득 찼습니다 (${planFeatures?.storage_used_pct ?? 100}% 사용 중).\n구독 관리에서 추가 저장공간을 확인해주세요.`}
          confirmText="구독 관리"
          cancelText="닫기"
          onConfirm={() => { setShowStorageModal(false); router.push("/(admin)/subscription" as any); }}
          onCancel={() => setShowStorageModal(false)}
        />
      </SafeAreaView>
    );
  }
  // ── 학생 선택 ─────────────────────────────────────────────────────────
  if (step === "student") {
    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <SubScreenHeader
          title={`${selGroup?.name ?? "반"} · 학생 선택`}
          subtitle={`개인 ${cfg.title} 앨범에 업로드할 학생을 선택하세요`}
          onBack={() => setStep("list")}
          homePath="/(teacher)/today-schedule"
        />
        <ScrollView contentContainerStyle={s.studentList} showsVerticalScrollIndicator={false}>
          {groupStudents.length === 0 ? (
            <View style={s.centerBox}>
              <LucideIcon name="users" size={32} color={C.textMuted} />
              <Text style={s.emptyTitle}>이 반에 배정된 학생이 없습니다</Text>
            </View>
          ) : groupStudents.map(st => (
            <Pressable
              key={st.id}
              style={[s.studentRow, { backgroundColor: C.card }]}
              onPress={() => selectStudent(st)}
            >
              <View style={[s.avatar, { backgroundColor: cfg.color + "20" }]}>
                <Text style={[s.avatarText, { color: cfg.color }]}>{(st.name ?? "?")[0]}</Text>
              </View>
              <Text style={s.studentName}>{st.name}</Text>
              <LucideIcon name="chevron-right" size={18} color={C.textMuted} />
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>
    );
  }
  // ── 업로드 뷰 ─────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader
        title={`${scope === "group" ? selGroup?.name ?? "반" : selStudent?.name ?? "학생"} · ${cfg.sub}`}
        subtitle={`${cfg.title} 업로드`}
        onBack={() => setStep("list")}
        homePath="/(teacher)/today-schedule"
      />
      <View style={s.uploadCenter}>
        <View style={[s.uploadIcon, { backgroundColor: cfg.bg }]}>
          <LucideIcon name={cfg.icon} size={48} color={cfg.color} />
        </View>
        <Text style={s.uploadTitle}>
          {scope === "group"
            ? `${selGroup?.name ?? "반"}에 ${cfg.title} 업로드`
            : `${selStudent?.name ?? "학생"}의 개인 ${cfg.title} 업로드`}
        </Text>
        <Text style={s.uploadSub}>
          {mediaType === "video"
            ? "영상 파일 1개를 선택하세요\n(mp4, mov 등)"
            : "사진 파일을 다중 선택할 수 있습니다"}
        </Text>
        <Pressable
          style={[s.uploadBtn, { backgroundColor: cfg.color, opacity: uploading ? 0.7 : 1 }]}
          onPress={() => pickAndUpload()}
          disabled={uploading}
        >
          {uploading
            ? (
              <>
                <ActivityIndicator color="#fff" size="small" />
                {compressTotal > 0 && (
                  <Text style={[s.uploadBtnText, { fontSize: 12 }]}>
                    압축 중 {compressProgress}/{compressTotal}
                  </Text>
                )}
              </>
            )
            : (
              <>
                <LucideIcon name="upload-cloud" size={20} color="#fff" />
                <Text style={s.uploadBtnText}>{cfg.title} 선택 및 업로드</Text>
              </>
            )
          }
        </Pressable>
      </View>
      <ConfirmModal
        visible={!!successMsg}
        title="업로드 완료"
        message={successMsg ?? ""}
        confirmText="확인"
        onConfirm={() => { setSuccessMsg(null); setStep("list"); }}
      />
      <ConfirmModal
        visible={!!errorMsg}
        title="오류"
        message={errorMsg ?? ""}
        confirmText="확인"
        onConfirm={() => setErrorMsg(null)}
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
      <ConfirmModal
        visible={showStorageModal}
        title="저장공간 초과"
        message={`저장공간이 가득 찼습니다 (${planFeatures?.storage_used_pct ?? 100}% 사용 중).\n구독 관리에서 추가 저장공간을 확인해주세요.`}
        confirmText="구독 관리"
        cancelText="닫기"
        onConfirm={() => { setShowStorageModal(false); router.push("/(admin)/subscription" as any); }}
        onCancel={() => setShowStorageModal(false)}
      />
    </SafeAreaView>
  );
}
// ── 스타일 ────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.surface },
  titleRow: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  title: { fontSize: 20, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 16, paddingVertical: 4, gap: 12 },
  gridBtn: { width: "47%", paddingVertical: 16, borderRadius: 18, borderWidth: 2, alignItems: "center", justifyContent: "center", gap: 6, position: "relative", overflow: "hidden" },
  gridIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  gridTitle: { fontSize: 14, fontFamily: "Pretendard-SemiBold", textAlign: "center" },
  gridSub: { fontSize: 10, fontFamily: "Pretendard-Regular", textAlign: "center", paddingHorizontal: 8, lineHeight: 14 },
  premierBadge: { position: "absolute", top: 6, right: 0, backgroundColor: "#7C3AED", paddingHorizontal: 7, paddingVertical: 2, borderTopLeftRadius: 7, borderBottomLeftRadius: 7 },
  premierBadgeText: { fontSize: 9, fontFamily: "Pretendard-Regular", color: "#fff" },
  limitCard: { marginHorizontal: 16, marginTop: 16, marginBottom: 4, backgroundColor: C.backgroundSoft, borderRadius: 16, borderWidth: 1, borderColor: C.border, overflow: "hidden" },
  limitCardHeader: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  limitCardTitle: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  limitCardBody: { paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  limitRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  limitText: { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 18 },
  usageCard: { marginHorizontal: 16, marginTop: 4, marginBottom: 8, backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.backgroundSoft, overflow: "hidden" },
  usageCardHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.backgroundSoft },
  usageCardTitle: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  usageCardBody: { padding: 12, gap: 2 },
  usageItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8, paddingVertical: 10, borderRadius: 10 },
  usageItemLabel: { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  usageItemBytes: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  usageDivider: { height: 1, backgroundColor: C.backgroundSoft, marginHorizontal: 8 },
  usageMonthText: { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary, textAlign: "center", paddingTop: 6 },
  listToolbar: { height: 36, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", paddingHorizontal: 14 },
  listSelectBtn: { flexDirection: "row", alignItems: "center", gap: 5 },
  listSelectBtnText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  selectBar: { flexDirection: "row", alignItems: "center", backgroundColor: C.backgroundSoft, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border, gap: 4 },
  selectBarLeft: { flexDirection: "row", alignItems: "center", gap: 5 },
  selectBarAllText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  selectBarCount: { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, textAlign: "center" },
  selectBarSave: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: C.primaryAction, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  selectBarSaveText: { color: "#fff", fontSize: 13, lineHeight: 18 },
  selectBarDel: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#D96C6C", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  selectBarDelText: { color: "#fff", fontSize: 13, lineHeight: 18 },
  selectBarCancel: { paddingHorizontal: 8, paddingVertical: 7 },
  selectBarCancelText: { fontSize: 13, lineHeight: 18, color: C.textSecondary },
  centerBox: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 28 },
  centerText: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary, textAlign: "center" },
  retryBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#4EA7D8", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
  retryBtnText: { color: "#fff", fontSize: 13, fontFamily: "Pretendard-Regular" },
  emptyTitle: { fontSize: 16, fontFamily: "Pretendard-Regular", color: C.textPrimary, textAlign: "center" },
  emptySubText: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, textAlign: "center" },
  photoCell: { overflow: "hidden", backgroundColor: C.surface, margin: 1 },
  photoPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center" },
  photoDateOverlay: { position: "absolute", top: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.28)", paddingHorizontal: 5, paddingVertical: 3 },
  photoDateText: { color: "#fff", fontSize: 9, fontFamily: "Pretendard-Regular" },
  photoLabelBar: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 5, paddingVertical: 4 },
  photoLabelText: { color: "#fff", fontSize: 9, fontFamily: "Pretendard-Regular" },
  checkCircle: { position: "absolute", top: 5, right: 5, width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#fff", backgroundColor: "rgba(255,255,255,0.3)", alignItems: "center", justifyContent: "center" },
  savedBadge: { position: "absolute", top: 5, left: 5, width: 22, height: 22, borderRadius: 11, backgroundColor: C.brandStrong, alignItems: "center", justifyContent: "center" },
  videoRow: { flexDirection: "row", alignItems: "center", borderRadius: 14, padding: 12, gap: 12 },
  videoThumb: { width: 52, height: 52, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  videoLabel: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  videoMeta: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  videoUploader: { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  fab: { position: "absolute", right: 20, width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 8 },
  lbBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.97)", justifyContent: "center", alignItems: "center" },
  lbTopBar: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10, paddingHorizontal: 16, paddingBottom: 12, flexDirection: "row", alignItems: "center" },
  lbClose: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  lbCounter: { flex: 1, textAlign: "center", color: "rgba(255,255,255,0.75)", fontSize: 14, fontFamily: "Pretendard-Regular" },
  lbImageWrap: { width: W, height: W * 1.1 },
  lbImage: { width: "100%", height: "100%" },
  lbImagePlaceholder: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center" },
  lbLabel: { color: C.brandSoft, fontSize: 13, fontFamily: "Pretendard-Regular", paddingHorizontal: 24, paddingTop: 14, textAlign: "center" },
  lbMeta: { color: "rgba(255,255,255,0.45)", fontSize: 12, fontFamily: "Pretendard-Regular", paddingTop: 4, textAlign: "center" },
  lbArrowRow: { position: "absolute", left: 0, right: 0, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 8, top: "35%", zIndex: 5 },
  lbArrow: { width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center" },
  lbArrowDisabled: { backgroundColor: "rgba(0,0,0,0.15)" },
  lbActionBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20 },
  lbActionBtnText: { color: "#fff", fontSize: 13, fontFamily: "Pretendard-Regular" },
  uploadCenter: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 40 },
  uploadIcon: { width: 100, height: 100, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  uploadTitle: { fontSize: 18, fontFamily: "Pretendard-Regular", color: C.textPrimary, textAlign: "center" },
  uploadSub: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, textAlign: "center", lineHeight: 20 },
  uploadBtn: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 28, paddingVertical: 16, borderRadius: 16 },
  uploadBtnText: { color: "#fff", fontSize: 15, fontFamily: "Pretendard-Regular" },
  studentList: { padding: 12, gap: 8, paddingBottom: 100 },
  studentRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14 },
  avatar: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  studentName: { flex: 1, fontSize: 15, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  // ── 영상 상세 시트 ──
  vdOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  vdSheet: { backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 14, gap: 14 },
  vdHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: "center", marginBottom: 4 },
  vdThumb: { width: "100%", height: 180, borderRadius: 14, overflow: "hidden", backgroundColor: "#E2E8F0" },
  vdLabel: { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: C.textPrimary, textAlign: "center" },
  vdMeta: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, textAlign: "center" },
  vdBtnRow: { flexDirection: "row", gap: 10 },
  vdBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 13, borderRadius: 14 },
  vdBtnTxt: { color: "#fff", fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 18 },
});
