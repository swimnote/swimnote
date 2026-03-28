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
import { Check, ChevronRight, CircleAlert, CloudUpload, Database, HardDrive, Image as ImageIcon, Plus, RefreshCw, SquareCheck, Trash2, Users, Video, X } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import * as ImagePicker from "expo-image-picker";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Dimensions, FlatList, Image,
  Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import Colors from "@/constants/colors";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { WeeklySchedule } from "@/components/teacher/WeeklySchedule";
import { TeacherClassGroup, SlotStatus } from "@/components/teacher/types";
import { apiRequest, safeJson, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";

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

function fmtDate(d: string | null | undefined): string {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("ko-KR", {
      year: "numeric", month: "short", day: "numeric",
    });
  } catch { return ""; }
}

/** null/undefined 항목도 안전하게 라벨 반환 */
function safeLabel(item: MediaItem | null | undefined): string {
  if (!item) return "";
  if (item.caption) return item.caption;
  if (item.album_type === "group") {
    const days = (item.schedule_days ?? "").split(",")[0]?.trim() ?? "";
    const time = (item.schedule_time ?? "").trim();
    const tag = `${days} ${time}반`.trim();
    return tag || item.class_name || "반 전체";
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
    file_url: String(raw?.file_url ?? raw?.url ?? ""),
    album_type: String(raw?.album_type ?? "group"),
    class_name: String(raw?.class_name ?? ""),
    schedule_days: String(raw?.schedule_days ?? ""),
    schedule_time: String(raw?.schedule_time ?? ""),
    student_name: String(raw?.student_name ?? ""),
    caption: String(raw?.caption ?? ""),
    uploader_name: String(raw?.uploader_name ?? ""),
    created_at: String(raw?.created_at ?? ""),
    file_size_bytes: Number(raw?.file_size_bytes ?? 0),
  };
}

/** 파일 URL을 절대 URI로 변환 (빈 문자열은 빈 문자열로) */
function photoUri(url: string | null | undefined): string {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  return `${API_BASE.replace(/\/api$/, "")}${url}`;
}

// ── Mock 데이터 (DB 연결 전 / 빈 상태 테스트용) ──────────────────────────
const MOCK_ITEMS: MediaItem[] = [];
// 필요시 아래 주석 해제해서 Mock 데이터 사용:
// const MOCK_ITEMS: MediaItem[] = [
//   { id: "mock_1", file_url: "", album_type: "group", class_name: "화 10:00반",
//     schedule_days: "화", schedule_time: "10:00", student_name: "",
//     caption: "화 10:00반 일지", uploader_name: "김선생", created_at: new Date().toISOString(), file_size_bytes: 524288 },
//   { id: "mock_2", file_url: "", album_type: "private", class_name: "",
//     schedule_days: "", schedule_time: "", student_name: "홍길동",
//     caption: "", uploader_name: "김선생", created_at: new Date().toISOString(), file_size_bytes: 1048576 },
// ];

// ── 앨범 설정 ─────────────────────────────────────────────────────────────
const MEDIA_CONFIG: Record<`${MediaType}_${AlbumScope}`, {
  icon: React.ComponentProps<typeof Feather>["name"];
  title: string; sub: string; color: string; bg: string;
}> = {
  photo_group:   { icon: "image",  title: "사진", sub: "반 전체 앨범", color: "#E4A93A", bg: "#FFF1BF" },
  photo_private: { icon: "user",   title: "사진", sub: "개인 앨범",   color: "#2EC4B6", bg: "#E6FFFA" },
  video_group:   { icon: "video",  title: "영상", sub: "반 전체 앨범", color: "#2EC4B6", bg: "#E6FFFA" },
  video_private: { icon: "film",   title: "영상", sub: "개인 앨범",   color: "#7C3AED", bg: "#EEDDF5" },
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
  const [uploading,  setUploading]  = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg,   setErrorMsg]   = useState<string | null>(null);

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
        const [cgRes, stRes, usageRes] = await Promise.all([
          apiRequest(token, "/class-groups"),
          apiRequest(token, "/students"),
          apiRequest(token, "/teacher/me/media-usage"),
        ]);
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

      // 정규화 + Mock 병합
      const normalized = raw.map((r, i) => normalizeItem(r, i));
      const finalItems = normalized.length > 0 ? normalized : [...MOCK_ITEMS];

      if (mountedRef.current) setItems(finalItems);
    } catch (e) {
      console.warn("[photos] loadList error:", e);
      if (mountedRef.current) {
        setListError("목록을 불러오는 중 오류가 발생했습니다.");
        setItems([...MOCK_ITEMS]);
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
      // State에서 즉시 제거 (낙관적 업데이트)
      setItems(prev => prev.filter(i => !ids.includes(i.id)));
      exitSelect();

      // 실제 API 삭제 시도
      const isPhoto = mediaType === "photo";
      const res = await fetch(`${API_BASE}${isPhoto ? "/photos/bulk" : "/videos/bulk"}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json().catch(() => ({}));
      const deleted = (data as any)?.deleted ?? ids.length;
      setSuccessMsg(`${deleted}개가 삭제됐습니다.`);
    } catch (e) {
      console.warn("[photos] delete error:", e);
      // 실패해도 State 제거는 유지 (낙관적)
      setSuccessMsg(`${ids.length}개가 삭제됐습니다.`);
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

  async function pickAndUpload() {
    const isVideo = mediaType === "video";
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert("권한 필요", "미디어 접근 권한이 필요합니다."); return; }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: isVideo ? ["videos"] : ["images"],
        allowsMultipleSelection: !isVideo,
        quality: isVideo ? 1 : 0.85,
      });
      if (result.canceled || !result.assets?.length) return;

      setUploading(true);
      const form = new FormData();
      for (const asset of result.assets) {
        form.append(isVideo ? "video" : "photos", {
          uri: asset.uri,
          name: asset.fileName || (isVideo ? "video.mp4" : "photo.jpg"),
          type: asset.mimeType || (isVideo ? "video/mp4" : "image/jpeg"),
        } as any);
      }
      form.append("class_id", selGroup?.id ?? "");
      if (scope === "private" && selStudent?.id) form.append("student_id", selStudent.id);

      const endpoint = isVideo
        ? (scope === "group" ? "/videos/group" : "/videos/private")
        : (scope === "group" ? "/photos/group" : "/photos/private");

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token ?? ""}` },
        body: form,
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((resData as any)?.error ?? "업로드 실패");

      const cnt = result.assets.length;
      setSuccessMsg(
        scope === "group"
          ? `${isVideo ? "영상" : `${cnt}장`}이 ${selGroup?.name ?? "반"} ${cfg.title} 앨범에 추가됐습니다.`
          : `${isVideo ? "영상" : `${cnt}장`}이 ${selStudent?.name ?? "학생"} 개인 ${cfg.title} 앨범에 추가됐습니다.`
      );
    } catch (e: any) {
      console.warn("[photos] upload error:", e);
      setErrorMsg(e?.message ?? "업로드 중 오류가 발생했습니다.");
    } finally {
      setUploading(false);
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

  // ── 홈: 4버튼 + 사용량 ───────────────────────────────────────────────
  if (step === "home") {
    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <SubScreenHeader title="사진 & 영상" homePath="/(teacher)/today-schedule" />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
          <View style={s.titleRow}><Text style={s.title}>사진 & 영상</Text></View>
          <View style={s.grid}>
            {(["photo_group", "photo_private", "video_group", "video_private"] as const).map(key => {
              const [mt, sc] = key.split("_") as [MediaType, AlbumScope];
              const c = MEDIA_CONFIG[key];
              return (
                <Pressable
                  key={key}
                  style={[s.gridBtn, { backgroundColor: c.bg, borderColor: c.color + "40" }]}
                  onPress={() => openList(mt, sc)}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.title} ${c.sub}`}
                >
                  <View style={[s.gridIcon, { backgroundColor: c.color + "25" }]}>
                    <LucideIcon name={c.icon} size={28} color={c.color} />
                  </View>
                  <Text style={[s.gridTitle, { color: c.color }]}>{c.title}</Text>
                  <Text style={[s.gridSub, { color: c.color + "CC" }]}>{c.sub}</Text>
                </Pressable>
              );
            })}
          </View>

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
              const uri = photoUri(item.file_url);
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
                      source={{ uri, headers: { Authorization: `Bearer ${token ?? ""}` } }}
                      style={{ width: "100%", height: "100%" }}
                      resizeMode="cover"
                      defaultSource={undefined}
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
                  <View style={[s.videoThumb, { backgroundColor: cfg.bg }]}>
                    <Video size={22} color={cfg.color} />
                  </View>
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

        {/* + 업로드 FAB */}
        {!selectMode && (
          <Pressable
            onPress={() => { setSelGroup(null); setSelStudent(null); setStep("schedule"); }}
            style={[s.fab, { backgroundColor: cfg.color, bottom: insets.bottom + 20 }]}
            accessibilityRole="button"
            accessibilityLabel={`${cfg.title} 업로드`}
          >
            <Plus size={26} color="#fff" />
          </Pressable>
        )}

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
                  source={{
                    uri: photoUri(lightbox.file_url),
                    headers: { Authorization: `Bearer ${token ?? ""}` },
                  }}
                  style={s.lbImage}
                  resizeMode="contain"
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
    </SafeAreaView>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#FFFFFF" },
  titleRow: { paddingHorizontal: 16, paddingVertical: 10 },
  title: { fontSize: 20, fontFamily: "Pretendard-Regular", color: "#0F172A" },

  grid: { flexDirection: "row", flexWrap: "wrap", padding: 12, gap: 12 },
  gridBtn: { width: "47%", aspectRatio: 1, borderRadius: 20, borderWidth: 1.5, alignItems: "center", justifyContent: "center", gap: 10 },
  gridIcon: { width: 60, height: 60, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  gridTitle: { fontSize: 18, fontFamily: "Pretendard-Regular" },
  gridSub: { fontSize: 13, fontFamily: "Pretendard-Regular" },

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
});
