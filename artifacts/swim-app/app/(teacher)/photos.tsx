/**
 * (teacher)/photos.tsx — 사진 & 영상 앨범
 *
 * 크래시 방어:
 *  - lightbox가 null일 때 Modal 자식 렌더링 → safeLabel(null) → crash 방지
 *  - API 응답이 예상 형식 아닐 때 → normalizeItem() 으로 정규화
 *  - items가 undefined/null → 빈 배열로 초기화 + Array.isArray 체크
 *  - item.file_url 이 없을 때 → photoUri("") → "" 처리
 *  - Mock 데이터로 UI 테스트 가능
 */
import { router } from "expo-router";
import { Check, ChevronRight, CircleAlert, CloudUpload, Database, HardDrive, Image as ImageIcon, Info, Plus, RefreshCw, SquareCheck, Trash2, Users, Video, X } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import * as ImagePicker from "expo-image-picker";
import * as VideoThumbnails from "expo-video-thumbnails";
import { compressImageIfNeeded } from "../../utils/compressImage";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Dimensions, FlatList,
  Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import Colors from "@/constants/colors";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { WeeklySchedule } from "@/components/teacher/WeeklySchedule";
import { TeacherClassGroup, SlotStatus } from "@/components/teacher/types";
import { apiRequest, safeJson, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { FullAlbumPickerModal } from "@/components/teacher/album/FullAlbumPickerModal";

const C = Colors.light;
const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? "/api");
const { width: W } = Dimensions.get("window");
const PHOTO_SIZE = Math.floor((W - 6) / 3);

// ── 타입 ──────────────────────────────────────────────────────────────────
type MediaType = "photo" | "video";
type AlbumScope = "group" | "private";
type Step = "home" | "list" | "schedule" | "student" | "upload";

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
  // PostgreSQL timestamptz가 "2026-06-18 07:00:44+00" (T 없음) 형식으로 올 때
  // Hermes JS 엔진은 이 형식을 파싱하지 못함 → ISO 8601 형식으로 정규화
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

/** null/undefined 항목도 안전하게 라벨 반환 */
function safeLabel(item: MediaItem | null | undefined): string {
  if (!item) return "";
  if (item.caption) return item.caption;
  if (item.album_type === "group") {
    return item.class_name || "전체앨범";
  }
  if (item.album_type === "private") {
    return `${item.student_name || "학생"} 개별`;
  }
  return "기타";
}

/** API raw 응답을 MediaItem으로 안전하게 정규화 */
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

/** 파일 URL을 절대 URI로 변환. tok 전달 시 ?token= 쿼리 첨부 (Expo Go headers 미지원 대응) */
function photoUri(url: string | null | undefined, tok?: string | null): string {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  const base = `${API_BASE.replace(/\/api$/, "")}${url}`;
  return tok ? `${base}?token=${tok}` : base;
}


// ── 앨범 설정 ─────────────────────────────────────────────────────────────
const MEDIA_CONFIG: Record<`${MediaType}_${AlbumScope}`, {
  icon: string;
  title: string; sub: string; color: string; bg: string;
}> = {
  photo_group:   { icon: "image",  title: "사진", sub: "전체앨범",  color: "#E4A93A", bg: "#FFF1BF" },
  photo_private: { icon: "user",   title: "사진", sub: "개인앨범",  color: "#2EC4B6", bg: "#E6FFFA" },
  video_group:   { icon: "video",  title: "영상", sub: "전체앨범",  color: "#2EC4B6", bg: "#E6FFFA" },
  video_private: { icon: "film",   title: "영상", sub: "개인앨범",  color: "#7C3AED", bg: "#EEDDF5" },
};

// ─────────────────────────────────────────────────────────────────────────
export default function TeacherPhotosScreen() {
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
  const [step,      setStep]      = useState<Step>("home");
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

  // 라이트박스 (null 안전 처리 필수)
  const [lightbox, setLightbox] = useState<MediaItem | null>(null);

  // 업로드
  const [uploading,           setUploading]           = useState(false);
  const [successMsg,          setSuccessMsg]          = useState<string | null>(null);
  const [errorMsg,            setErrorMsg]            = useState<string | null>(null);
  const [pendingUploadAssets, setPendingUploadAssets] = useState<any[]>([]);

  type PlanFeatures = { video_enabled: boolean; storage_quota_gb: number; storage_used_gb: number; storage_used_pct: number; upload_blocked: boolean; tier: string };
  const [planFeatures, setPlanFeatures] = useState<PlanFeatures>({ video_enabled: false, storage_quota_gb: 0, storage_used_gb: 0, storage_used_pct: 0, upload_blocked: false, tier: "free" });
  const [showVideoGateModal,    setShowVideoGateModal]    = useState(false);
  const [showStorageModal,      setShowStorageModal]      = useState(false);
  const [showClassPickerModal,  setShowClassPickerModal]  = useState(false);
  const [showFullAlbumPicker,   setShowFullAlbumPicker]   = useState(false);

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
        if (canceled) return;
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
  const loadList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const isPhoto = mediaType === "photo";
      const endpoint = isPhoto
        ? `/photos/teacher-all?scope=${scope}`
        : `/videos/teacher-all?scope=${scope}`;

      const res = await apiRequest(token, endpoint);
      const data = await safeJson(res);

      // null/undefined/error 방어
      let raw: any[] = [];
      if (Array.isArray(data)) {
        raw = data;
      } else if (data && typeof data === "object") {
        const key = isPhoto ? "photos" : "videos";
        raw = Array.isArray(data[key]) ? data[key] : [];
      }

      const normalized = raw.map((r, i) => normalizeItem(r, i));
      if (mountedRef.current) setItems(normalized);
    } catch (e) {
      console.warn("[photos] loadList error:", e);
      if (mountedRef.current) {
        setListError("목록을 불러오는 중 오류가 발생했습니다.");
      }
    } finally {
      if (mountedRef.current) setListLoading(false);
    }
  }, [token, mediaType, scope]);

  function openList(mt: MediaType, sc: AlbumScope) {
    setMediaType(mt);
    setScope(sc);
    setSelectMode(false);
    setSelected(new Set());
    setItems([]);
    setListError(null);
    setStep("list");
  }

  useEffect(() => {
    if (step === "list") loadList();
  }, [step, loadList]);

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

  // ── 선택 삭제 ─────────────────────────────────────────────────────────
  async function deleteSelected() {
    const ids = Array.from(selected).filter(Boolean);
    if (ids.length === 0) { setConfirmDel(false); return; }
    setDeleting(true);
    try {
      setItems(prev => prev.filter(i => !ids.includes(i.id)));
      exitSelect();

      const isPhoto = mediaType === "photo";
      // 개인앨범(saved) = 참조 제거만 / 전체앨범 = R2 + DB 삭제
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

  // ── 업로드 ────────────────────────────────────────────────────────────
  const groupStudents = (selGroup
    ? students.filter(st =>
        (Array.isArray(st.assigned_class_ids) && st.assigned_class_ids.includes(selGroup.id))
        || st.class_group_id === selGroup.id
      )
    : []
  ).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  function selectGroup(g: TeacherClassGroup) {
    setSelGroup(g);
    if (scope === "private") setStep("student");
    else setStep("upload");
  }

  function selectStudent(st: Student) {
    setSelStudent(st);
    setStep("upload");
  }

  /** 홈 타일에서 직접 업로드 */
  async function handleTileUpload(mt: MediaType, sc: AlbumScope) {
    setMediaType(mt);
    setScope(sc);
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
      });
      if (result.canceled || !result.assets?.length) return;
      const assets = result.assets;
      if (groups.length === 0) {
        await doUpload(assets, null, null, mt, sc);
      } else {
        setPendingUploadAssets(assets);
        setShowClassPickerModal(true);
      }
    } catch (e: any) {
      setErrorMsg(e?.message ?? "업로드 중 오류가 발생했습니다.");
    }
  }

  /** 실제 파일 업로드 — 파일 피커 이후에 실행 */
  async function doUpload(assets: any[], group: TeacherClassGroup | null | undefined, student: Student | null | undefined, overrideMt?: MediaType, overrideSc?: AlbumScope) {
    const isVideo = (overrideMt ?? mediaType) === "video";
    const sc = overrideSc ?? scope;
    setUploading(true);
    try {
      const form = new FormData();
      for (const asset of assets) {
        const uri = !isVideo ? await compressImageIfNeeded(asset.uri, asset.fileSize ?? undefined) : asset.uri;
        form.append(isVideo ? "video" : "photos", {
          uri,
          name: asset.fileName || (isVideo ? "video.mp4" : "photo.jpg"),
          type: asset.mimeType || (isVideo ? "video/mp4" : "image/jpeg"),
        } as any);

        // 영상 업로드 시 썸네일 자동 생성 — 실패해도 업로드는 계속 진행
        if (isVideo) {
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
      }
      form.append("class_id", group?.id ?? "");
      if (sc === "private" && student?.id) form.append("student_id", student.id);

      const endpoint = isVideo
        ? (sc === "group" ? "/videos/group" : "/videos/private")
        : (sc === "group" ? "/photos/group" : "/photos/private");

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token ?? ""}` },
        body: form,
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((resData as any)?.error ?? "업로드 실패");

      const cnt = assets.length;
      setSuccessMsg(
        scope === "group"
          ? `${isVideo ? "영상" : `${cnt}장`}이 ${group?.name ? `${group.name} ` : ""}전체앨범에 추가됐습니다.`
          : `${isVideo ? "영상" : `${cnt}장`}이 ${student?.name ?? "학생"} 개인 ${cfg.title} 앨범에 추가됐습니다.`
      );
      await loadList();
    } catch (e: any) {
      console.warn("[photos] upload error:", e);
      setErrorMsg(e?.message ?? "업로드 중 오류가 발생했습니다.");
    } finally {
      setUploading(false);
      setPendingUploadAssets([]);
    }
  }

  /**
   * 파일 피커 실행 → 파일 선택 후 반 결정 → 업로드
   * group 파라미터가 있으면 그 반으로 바로 업로드 (클래스 피커 이후 재진입 경로)
   */
  async function pickAndUpload(group?: TeacherClassGroup, student?: Student) {
    const isVideo = mediaType === "video";
    if (isVideo && !planFeatures.video_enabled) { setShowVideoGateModal(true); return; }
    if (planFeatures.storage_used_pct >= 100) { setShowStorageModal(true); return; }

    // ── 반이 이미 결정된 경우: 대기 파일로 바로 업로드 ──────────────
    if (group) {
      const assets = pendingUploadAssets.length > 0 ? pendingUploadAssets : null;
      if (assets) { await doUpload(assets, group, student ?? selStudent); return; }
    }

    // ── 파일 피커 먼저 실행 ─────────────────────────────────────────
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert("권한 필요", "미디어 접근 권한이 필요합니다."); return; }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: isVideo ? ["videos"] : ["images"],
        allowsMultipleSelection: !isVideo,
        quality: isVideo ? 1 : 0.85,
      });
      if (result.canceled || !result.assets?.length) return;

      const assets = result.assets;

      // ── 반 결정 ─────────────────────────────────────────────────
      if (scope === "group") {
        if (groups.length === 0) {
          // 반이 없어도 pool 공용으로 바로 업로드 (class_id = null)
          await doUpload(assets, null, null);
        } else {
          // 반이 1개 이상: 반 선택 모달 표시 (공용 업로드 선택지 포함)
          setPendingUploadAssets(assets);
          setShowClassPickerModal(true);
        }
      } else {
        // private: selGroup/selStudent 사용 (schedule → student 흐름)
        await doUpload(assets, selGroup, selStudent);
      }
    } catch (e: any) {
      console.warn("[photos] upload error:", e);
      setErrorMsg(e?.message ?? "업로드 중 오류가 발생했습니다.");
    }
  }

  const statusMap: Record<string, SlotStatus> = {};
  (groups ?? []).forEach(g => {
    statusMap[g.id] = { attChecked: 0, diaryDone: true, hasPhotos: false };
  });

  // ── 로딩 ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <SubScreenHeader title="사진 & 영상" homePath="/(teacher)/today-schedule" />
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  // ── 홈: 새 레이아웃 (업로드 / 앨범 구분) ────────────────────────────
  if (step === "home") {
    const HOME_TILES: {
      key: string; mt: MediaType; sc: AlbumScope;
      icon: string; title: string; sub: string;
      color: string; bg: string; isPremier: boolean; isUpload: boolean;
    }[] = [
      { key: "photo_upload",   mt: "photo", sc: "group",   icon: "cloud-upload", title: "전체사진 업로드", sub: "전체 학생에게 공유",    color: "#E4A93A", bg: "#FFF8E6", isPremier: false, isUpload: true },
      { key: "video_upload",   mt: "video", sc: "group",   icon: "cloud-upload", title: "전체영상 업로드", sub: "전체 학생에게 공유",    color: "#2EC4B6", bg: "#E6FFFA", isPremier: true,  isUpload: true },
      { key: "photo_album",    mt: "photo", sc: "private", icon: "image",        title: "내사진앨범",     sub: "내가 올린 개인 사진",   color: "#F97316", bg: "#FFF4EE", isPremier: false, isUpload: false },
      { key: "video_album",    mt: "video", sc: "private", icon: "video",        title: "내영상앨범",     sub: "내가 올린 개인 영상",   color: "#7C3AED", bg: "#F3EEFF", isPremier: true,  isUpload: false },
    ];

    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <SubScreenHeader title="사진 & 영상" homePath="/(teacher)/today-schedule" />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
          <View style={s.titleRow}><Text style={s.title}>사진 & 영상</Text></View>

          {/* ── 2×2 타일 그리드 ── */}
          <View style={s.grid}>
            {HOME_TILES.map(tile => (
              <Pressable
                key={tile.key}
                style={[s.gridBtn, { backgroundColor: tile.bg, borderColor: tile.color + "40" }]}
                onPress={() => tile.isUpload ? handleTileUpload(tile.mt, tile.sc) : openList(tile.mt, tile.sc)}
                accessibilityRole="button"
                accessibilityLabel={tile.title}
              >
                {tile.isPremier && (
                  <View style={s.premierBadge}>
                    <Text style={s.premierBadgeText}>프리미어 이상</Text>
                  </View>
                )}
                <View style={[s.gridIcon, { backgroundColor: tile.color + "22" }]}>
                  <LucideIcon name={tile.icon} size={26} color={tile.color} />
                </View>
                <Text style={[s.gridTitle, { color: tile.color }]}>{tile.title}</Text>
                <Text style={[s.gridSub, { color: tile.color + "BB" }]}>{tile.sub}</Text>
              </Pressable>
            ))}
          </View>

          {/* ── 업로드 제한사항 안내 ── */}
          <View style={s.limitCard}>
            <View style={s.limitCardHeader}>
              <Info size={14} color="#64748B" />
              <Text style={s.limitCardTitle}>업로드 제한사항</Text>
            </View>
            <View style={s.limitCardBody}>
              <View style={s.limitRow}>
                <LucideIcon name="image" size={13} color="#E4A93A" />
                <Text style={s.limitText}>사진: 1장 최대 <Text style={{ color: "#0F172A" }}>8MB</Text> · 최대 <Text style={{ color: "#0F172A" }}>20장</Text> 동시 업로드</Text>
              </View>
              <View style={s.limitRow}>
                <LucideIcon name="video" size={13} color="#2EC4B6" />
                <Text style={s.limitText}>영상: 1개 최대 <Text style={{ color: "#0F172A" }}>100MB</Text> · <Text style={{ color: "#7C3AED" }}>프리미어 플랜</Text> 이상만 사용 가능</Text>
              </View>
              <View style={s.limitRow}>
                <LucideIcon name="users" size={13} color="#94A3B8" />
                <Text style={s.limitText}>업로드한 사진·영상은 학부모 앱에서 즉시 확인 가능합니다</Text>
              </View>
              <View style={s.limitRow}>
                <LucideIcon name="hard-drive" size={13} color="#94A3B8" />
                <Text style={s.limitText}>저장공간 초과 시 업로드가 제한됩니다 (현재 {planFeatures.storage_used_pct.toFixed(0)}% 사용 중)</Text>
              </View>
            </View>
          </View>

          {/* ── 내 업로드 사용량 ── */}
          <View style={s.usageCard}>
            <View style={s.usageCardHeader}>
              <HardDrive size={15} color={themeColor} />
              <Text style={[s.usageCardTitle, { color: themeColor }]}>내 업로드 사용량</Text>
            </View>
            <View style={s.usageCardBody}>
              {([
                { icon: "image" as const, color: "#E4A93A", label: `사진 ${usage?.photo_count ?? 0}개`, bytes: usage?.photo_bytes ?? 0 },
                { icon: "video" as const, color: "#7C3AED", label: `영상 ${usage?.video_count ?? 0}개`, bytes: usage?.video_bytes ?? 0 },
              ]).map(row => (
                <View key={row.label} style={s.usageItem}>
                  <LucideIcon name={row.icon} size={14} color={row.color} />
                  <Text style={s.usageItemLabel}>{row.label}</Text>
                  <Text style={s.usageItemBytes}>{fmtBytes(row.bytes)}</Text>
                </View>
              ))}
              <View style={s.usageDivider} />
              <View style={[s.usageItem, { backgroundColor: themeColor + "08" }]}>
                <Database size={14} color={themeColor} />
                <Text style={[s.usageItemLabel, { color: themeColor, fontFamily: "Pretendard-Regular" }]}>총 사용량</Text>
                <Text style={[s.usageItemBytes, { color: themeColor, fontFamily: "Pretendard-Regular" }]}>{fmtBytes(usage?.total_bytes ?? 0)}</Text>
              </View>
              <Text style={s.usageMonthText}>이번 달: {fmtBytes(usage?.month_bytes ?? 0)}</Text>
            </View>
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
          title={`${cfg.title} ${cfg.sub}`}
          subtitle={listLoading ? "불러오는 중…" : `${safeItems.length}개`}
          onBack={() => { exitSelect(); setStep("home"); }}
          homePath="/(teacher)/today-schedule"
        />

        {/* ── 선택 모드 툴바 / 일반 툴바 ── */}
        {selectMode ? (
          <View style={s.selectBar}>
            <Pressable onPress={toggleAll} style={s.selectBarLeft}>
              <LucideIcon
                name={selected.size === safeItems.length && safeItems.length > 0 ? "check-square" : "square"}
                size={18} color={cfg.color}
              />
              <Text style={[s.selectBarAllText, { color: cfg.color }]}>
                {selected.size === safeItems.length && safeItems.length > 0 ? "전체 해제" : "전체 선택"}
              </Text>
            </Pressable>
            <Text style={s.selectBarCount}>{selected.size}개 선택</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                onPress={() => selected.size > 0 && setConfirmDel(true)}
                disabled={selected.size === 0 || deleting}
                style={[s.selectBarDel, { opacity: selected.size === 0 ? 0.4 : 1 }]}
              >
                {deleting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : (
                    <>
                      <Trash2 size={14} color="#fff" />
                      <Text style={s.selectBarDelText}>삭제</Text>
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
                <SquareCheck size={15} color={cfg.color} />
                <Text style={[s.listSelectBtnText, { color: cfg.color }]}>선택</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* ── 로딩 ── */}
        {listLoading ? (
          <View style={s.centerBox}>
            <ActivityIndicator color={cfg.color} size="large" />
            <Text style={s.centerText}>목록을 불러오는 중…</Text>
          </View>
        ) : listError ? (
          <View style={s.centerBox}>
            <CircleAlert size={36} color="#D96C6C" />
            <Text style={[s.centerText, { color: "#D96C6C" }]}>{listError}</Text>
            <Pressable onPress={loadList} style={s.retryBtn}>
              <RefreshCw size={14} color="#fff" />
              <Text style={s.retryBtnText}>다시 시도</Text>
            </Pressable>
          </View>
        ) : safeItems.length === 0 ? (
          <View style={s.centerBox}>
            <LucideIcon name={cfg.icon} size={44} color="#D1D5DB" />
            <Text style={s.emptyTitle}>아직 업로드된 {cfg.title}이 없습니다</Text>
            <Text style={s.emptySubText}>아래 + 버튼으로 {cfg.title}을 업로드하세요</Text>
          </View>
        ) : isPhoto ? (
          /* ── 사진: 3열 그리드 ── */
          <FlatList
            data={safeItems}
            keyExtractor={(item, idx) => item?.id ?? String(idx)}
            numColumns={3}
            contentContainerStyle={{ padding: 2, paddingBottom: insets.bottom + 100 }}
            columnWrapperStyle={{ gap: 2 }}
            removeClippedSubviews
            renderItem={({ item, index }) => {
              if (!item) return null;
              const isSel = selected.has(item.id);
              const label = safeLabel(item);
              const uri = photoUri(item.file_url, token);
              return (
                <Pressable
                  onPress={() => selectMode ? toggleSelect(item.id) : setLightbox(item)}
                  onLongPress={() => {
                    if (!selectMode) {
                      setSelectMode(true);
                      setSelected(new Set([item.id]));
                    }
                  }}
                  style={[
                    s.photoCell,
                    { width: PHOTO_SIZE, height: PHOTO_SIZE },
                    isSel && { borderWidth: 3, borderColor: cfg.color },
                  ]}
                >
                  {uri ? (
                    <Image
                      source={{ uri }}
                      style={{ width: "100%", height: "100%" }}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={s.photoPlaceholder}>
                      <ImageIcon size={22} color="#D1D5DB" />
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
                  {selectMode && (
                    <View style={[
                      s.checkCircle,
                      isSel && { backgroundColor: cfg.color, borderColor: cfg.color },
                    ]}>
                      {isSel && <Check size={12} color="#fff" />}
                    </View>
                  )}
                </Pressable>
              );
            }}
          />
        ) : (
          /* ── 영상: 카드 리스트 ── */
          <FlatList
            data={safeItems}
            keyExtractor={(item, idx) => item?.id ?? String(idx)}
            contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: insets.bottom + 100 }}
            renderItem={({ item }) => {
              if (!item) return null;
              const isSel = selected.has(item.id);
              const label = safeLabel(item);
              return (
                <Pressable
                  onPress={() => {
                    if (selectMode) { toggleSelect(item.id); return; }
                    Alert.alert(
                      "영상 안내",
                      "영상 파일은 앱 내 직접 재생이 지원되지 않습니다.\n삭제가 필요하면 선택 후 삭제하세요.",
                      [{ text: "확인" }]
                    );
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
                    />
                  ) : (
                    <View style={[s.videoThumb, { backgroundColor: cfg.bg }]}>
                      <Video size={22} color={cfg.color} />
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
                    <View style={[
                      s.checkCircle,
                      isSel && { backgroundColor: cfg.color, borderColor: cfg.color },
                    ]}>
                      {isSel && <Check size={12} color="#fff" />}
                    </View>
                  ) : (
                    <ChevronRight size={18} color="#64748B" />
                  )}
                </Pressable>
              );
            }}
          />
        )}

        {/* + FAB: 전체앨범 = 파일 피커, 개인앨범 = 전체앨범 피커 */}
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
            {uploading ? <ActivityIndicator color="#fff" /> : <Plus size={26} color="#fff" />}
          </Pressable>
        )}

        {/* 반 선택 바텀시트 (group 업로드) */}
        <Modal
          visible={showClassPickerModal}
          transparent
          animationType="slide"
          onRequestClose={() => setShowClassPickerModal(false)}
        >
          <Pressable style={s.cpOverlay} onPress={() => setShowClassPickerModal(false)}>
            <View style={s.cpSheet}>
              <View style={s.cpHandle} />
              <Text style={s.cpTitle}>어디에 업로드할까요?</Text>

              {/* 공용 업로드 (반 없이 pool 전체) */}
              <Pressable
                style={[s.cpItem, s.cpItemPool]}
                onPress={() => {
                  setShowClassPickerModal(false);
                  doUpload(pendingUploadAssets, null, null);
                }}
              >
                <View style={s.cpItemPoolIcon}>
                  <LucideIcon name="layers" size={16} color="#E4A93A" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.cpItemText, { color: "#E4A93A" }]}>전체앨범 (공용)</Text>
                  <Text style={s.cpItemSub}>반 구분 없이 수영장 공용 앨범에 저장</Text>
                </View>
                <ChevronRight size={16} color="#E4A93A" />
              </Pressable>

              {/* 반별 업로드 */}
              {groups.length > 0 && (
                <Text style={s.cpSectionLabel}>반별 업로드</Text>
              )}
              {groups.map(g => (
                <Pressable
                  key={g.id}
                  style={s.cpItem}
                  onPress={() => {
                    setShowClassPickerModal(false);
                    doUpload(pendingUploadAssets, g, null);
                  }}
                >
                  <Text style={s.cpItemText}>{g.name}</Text>
                  <ChevronRight size={16} color="#64748B" />
                </Pressable>
              ))}
              <Pressable style={s.cpCancel} onPress={() => setShowClassPickerModal(false)}>
                <Text style={s.cpCancelText}>취소</Text>
              </Pressable>
            </View>
          </Pressable>
        </Modal>

        {/* FullAlbumPickerModal — 개인앨범 + 버튼 → 전체앨범에서 선택 */}
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

        {/* ── 사진 라이트박스 ── */}
        {/* ★ lightbox !== null 조건을 Modal 안에 반드시 감싸야 크래시 방지 */}
        <Modal
          visible={!!lightbox}
          transparent
          animationType="fade"
          onRequestClose={() => setLightbox(null)}
        >
          {lightbox != null ? (
            <View style={s.lbBg}>
              <Pressable
                onPress={() => setLightbox(null)}
                style={[s.lbClose, { top: insets.top + 12 }]}
                accessibilityRole="button"
                accessibilityLabel="닫기"
              >
                <X size={26} color="#fff" />
              </Pressable>

              {!!lightbox.file_url ? (
                <Image
                  source={{ uri: photoUri(lightbox.file_url, token) }}
                  style={s.lbImage}
                  contentFit="contain"
                />
              ) : (
                <View style={s.lbImagePlaceholder}>
                  <ImageIcon size={60} color="rgba(255,255,255,0.3)" />
                  <Text style={{ color: "rgba(255,255,255,0.4)", marginTop: 12 }}>이미지를 불러올 수 없습니다</Text>
                </View>
              )}

              {!!safeLabel(lightbox) && (
                <Text style={s.lbLabel}>{safeLabel(lightbox)}</Text>
              )}
              <Text style={s.lbMeta}>
                {lightbox.uploader_name ? `${lightbox.uploader_name}  ` : ""}
                {fmtDate(lightbox.created_at)}
                {lightbox.file_size_bytes ? `  ·  ${fmtBytes(lightbox.file_size_bytes)}` : ""}
              </Text>

              <View style={{ flexDirection: "row", justifyContent: "center", marginTop: 8, gap: 10 }}>
                <Pressable
                  onPress={() => { setLightbox(null); toggleSelect(lightbox?.id ?? ""); if (!selectMode) setSelectMode(true); }}
                  style={[s.lbActionBtn, { backgroundColor: "#0F172A" }]}
                >
                  <Trash2 size={15} color="#fff" />
                  <Text style={s.lbActionBtnText}>삭제</Text>
                </Pressable>
                <Pressable onPress={() => setLightbox(null)} style={[s.lbActionBtn, { backgroundColor: "#64748B" }]}>
                  <X size={15} color="#fff" />
                  <Text style={s.lbActionBtnText}>닫기</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={s.lbBg} />
          )}
        </Modal>

        {/* 삭제 확인 */}
        <ConfirmModal
          visible={confirmDel}
          title={`${selected.size}개 삭제`}
          message={`선택한 ${mediaType === "photo" ? "사진" : "영상"} ${selected.size}개를 삭제합니다.\n이 작업은 취소할 수 없습니다.`}
          confirmText="삭제"
          cancelText="취소"
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
          message="동영상 업로드는 프리미어 플랜부터 사용할 수 있습니다."
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

  // ── 시간표 (반 선택) ──────────────────────────────────────────────────
  if (step === "schedule") {
    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <SubScreenHeader
          title={`${cfg.title} 업로드`}
          subtitle="수업 반을 선택하세요"
          onBack={() => setStep("list")}
          homePath="/(teacher)/today-schedule"
        />
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
          <WeeklySchedule
            classGroups={groups}
            statusMap={statusMap}
            onSelectClass={selectGroup}
            themeColor={cfg.color}
          />
          <View style={{ height: 100 }} />
        </ScrollView>
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
          onBack={() => setStep("schedule")}
          homePath="/(teacher)/today-schedule"
        />
        <ScrollView contentContainerStyle={s.studentList} showsVerticalScrollIndicator={false}>
          {groupStudents.length === 0 ? (
            <View style={s.centerBox}>
              <Users size={32} color={C.textMuted} />
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
              <ChevronRight size={18} color={C.textMuted} />
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── 업로드 ────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader
        title={`${scope === "group" ? selGroup?.name ?? "반" : selStudent?.name ?? "학생"} · ${cfg.sub}`}
        subtitle={`${cfg.title} 업로드`}
        onBack={() => setStep(scope === "private" ? "student" : "schedule")}
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
          onPress={pickAndUpload}
          disabled={uploading}
        >
          {uploading
            ? <ActivityIndicator color="#fff" />
            : (
              <>
                <CloudUpload size={20} color="#fff" />
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
        message="동영상 업로드는 프리미어 플랜부터 사용할 수 있습니다."
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

// ── 스타일 ────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#FFFFFF" },
  titleRow: { paddingHorizontal: 16, paddingVertical: 10 },
  title: { fontSize: 20, fontFamily: "Pretendard-Regular", color: "#0F172A" },

  grid: { flexDirection: "row", flexWrap: "wrap", padding: 12, gap: 12 },
  gridBtn: { width: "47%", aspectRatio: 1, borderRadius: 20, borderWidth: 1.5, alignItems: "center", justifyContent: "center", gap: 8, position: "relative", overflow: "hidden" },
  gridIcon: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  gridTitle: { fontSize: 15, fontFamily: "Pretendard-Regular", textAlign: "center" },
  gridSub: { fontSize: 11, fontFamily: "Pretendard-Regular", textAlign: "center", paddingHorizontal: 6 },

  premierBadge: { position: "absolute", top: 8, right: 0, backgroundColor: "#7C3AED", paddingHorizontal: 8, paddingVertical: 3, borderTopLeftRadius: 8, borderBottomLeftRadius: 8 },
  premierBadgeText: { fontSize: 9, fontFamily: "Pretendard-Regular", color: "#fff" },

  limitCard: { marginHorizontal: 12, marginTop: 4, marginBottom: 4, backgroundColor: "#F8FAFC", borderRadius: 16, borderWidth: 1, borderColor: "#E5E7EB", overflow: "hidden" },
  limitCardHeader: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  limitCardTitle: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B" },
  limitCardBody: { paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  limitRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  limitText: { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B", lineHeight: 18 },

  usageCard: { marginHorizontal: 12, marginTop: 4, backgroundColor: "#fff", borderRadius: 16, overflow: "hidden" },
  usageCardHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#FFFFFF" },
  usageCardTitle: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  usageCardBody: { padding: 12, gap: 2 },
  usageItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8, paddingVertical: 10, borderRadius: 10 },
  usageItemLabel: { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  usageItemBytes: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  usageDivider: { height: 1, backgroundColor: "#FFFFFF", marginHorizontal: 8 },
  usageMonthText: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", textAlign: "center", paddingTop: 6 },

  listToolbar: { height: 36, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", paddingHorizontal: 14 },
  listSelectBtn: { flexDirection: "row", alignItems: "center", gap: 5 },
  listSelectBtnText: { fontSize: 13, fontFamily: "Pretendard-Regular" },

  selectBar: { flexDirection: "row", alignItems: "center", backgroundColor: "#F1F5F9", paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#E5E7EB", gap: 4 },
  selectBarLeft: { flexDirection: "row", alignItems: "center", gap: 5 },
  selectBarAllText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  selectBarCount: { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B", textAlign: "center" },
  selectBarDel: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#D96C6C", paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  selectBarDelText: { color: "#fff", fontSize: 13, fontFamily: "Pretendard-Regular" },
  selectBarCancel: { paddingHorizontal: 8, paddingVertical: 7 },
  selectBarCancelText: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B" },

  centerBox: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 28 },
  centerText: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#64748B", textAlign: "center" },
  retryBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#4EA7D8", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
  retryBtnText: { color: "#fff", fontSize: 13, fontFamily: "Pretendard-Regular" },
  emptyTitle: { fontSize: 16, fontFamily: "Pretendard-Regular", color: "#0F172A", textAlign: "center" },
  emptySubText: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B", textAlign: "center" },

  photoCell: { overflow: "hidden", backgroundColor: "#FFFFFF", margin: 1 },
  photoPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center" },
  photoDateOverlay: { position: "absolute", top: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.28)", paddingHorizontal: 5, paddingVertical: 3 },
  photoDateText: { color: "#fff", fontSize: 9, fontFamily: "Pretendard-Regular" },
  photoLabelBar: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 5, paddingVertical: 4 },
  photoLabelText: { color: "#fff", fontSize: 9, fontFamily: "Pretendard-Regular" },
  checkCircle: { position: "absolute", top: 5, right: 5, width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#fff", backgroundColor: "rgba(255,255,255,0.3)", alignItems: "center", justifyContent: "center" },

  videoRow: { flexDirection: "row", alignItems: "center", borderRadius: 14, padding: 12, gap: 12 },
  videoThumb: { width: 52, height: 52, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  videoLabel: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  videoMeta: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B" },
  videoUploader: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },

  fab: { position: "absolute", right: 20, width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 8 },

  lbBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.97)", justifyContent: "center", alignItems: "center" },
  lbClose: { position: "absolute", left: 16, width: 44, height: 44, alignItems: "center", justifyContent: "center", zIndex: 10 },
  lbImage: { width: W, height: W * 1.1 },
  lbImagePlaceholder: { width: W, height: W * 0.8, alignItems: "center", justifyContent: "center" },
  lbLabel: { color: "#E6FFFA", fontSize: 13, fontFamily: "Pretendard-Regular", paddingHorizontal: 24, paddingTop: 14, textAlign: "center" },
  lbMeta: { color: "rgba(255,255,255,0.45)", fontSize: 12, fontFamily: "Pretendard-Regular", paddingTop: 4, textAlign: "center" },
  lbActionBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20 },
  lbActionBtnText: { color: "#fff", fontSize: 13, fontFamily: "Pretendard-Regular" },

  uploadCenter: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 40 },
  uploadIcon: { width: 100, height: 100, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  uploadTitle: { fontSize: 18, fontFamily: "Pretendard-Regular", color: "#0F172A", textAlign: "center" },
  uploadSub: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B", textAlign: "center", lineHeight: 20 },
  uploadBtn: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 28, paddingVertical: 16, borderRadius: 16 },
  uploadBtnText: { color: "#fff", fontSize: 15, fontFamily: "Pretendard-Regular" },

  studentList: { padding: 12, gap: 8, paddingBottom: 100 },
  studentRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14 },
  avatar: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  studentName: { flex: 1, fontSize: 15, fontFamily: "Pretendard-Regular", color: "#0F172A" },

  cpOverlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  cpSheet:      { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingBottom: 36, paddingTop: 12, gap: 6 },
  cpHandle:     { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", marginBottom: 8 },
  cpTitle:      { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#374151", textAlign: "center", paddingVertical: 8 },
  cpItem:          { flexDirection: "row", alignItems: "center", paddingVertical: 14, paddingHorizontal: 14, backgroundColor: "#F8FAFC", borderRadius: 14, gap: 8 },
  cpItemPool:      { backgroundColor: "#FFF8E6", borderWidth: 1, borderColor: "#E4A93A33" },
  cpItemPoolIcon:  { width: 32, height: 32, borderRadius: 8, backgroundColor: "#E4A93A1A", alignItems: "center", justifyContent: "center" },
  cpItemText:      { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  cpItemSub:       { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#9CA3AF", marginTop: 2 },
  cpSectionLabel:  { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#9CA3AF", paddingHorizontal: 4, paddingTop: 6 },
  cpCancel:        { alignItems: "center", paddingVertical: 14, marginTop: 4 },
  cpCancelText:    { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#64748B" },
});
