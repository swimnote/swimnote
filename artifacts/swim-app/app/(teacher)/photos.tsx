/**
 * (teacher)/photos.tsx — 사진 & 영상 앨범
 *
 * 흐름:
 *  home → list (파일 목록) → [lightbox | video preview]
 *  list → upload버튼 → schedule → (private이면 student) → upload 완료 → list 새로고침
 *
 * 기능:
 *  - 파일 목록: 사진은 3열 그리드, 영상은 카드 리스트
 *  - 롱프레스 또는 선택버튼 → 선택 모드 → 대량 삭제
 *  - 탭 → 사진 라이트박스 / 영상 직접 링크
 *  - 홈 화면: 사용량 카드
 */
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Dimensions, FlatList, Image, Modal,
  Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import Colors from "@/constants/colors";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { WeeklySchedule, TeacherClassGroup, SlotStatus } from "@/components/teacher/WeeklySchedule";
import { apiRequest, safeJson, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";

const C = Colors.light;
const API_BASE = process.env.EXPO_PUBLIC_API_URL || "/api";
const { width: W } = Dimensions.get("window");
const PHOTO_SIZE = (W - 6) / 3;

type MediaType = "photo" | "video";
type AlbumScope = "group" | "private";
type Step = "home" | "list" | "schedule" | "student" | "upload";

interface MediaItem {
  id: string;
  file_url: string;
  album_type?: string;
  class_name?: string | null;
  schedule_days?: string | null;
  schedule_time?: string | null;
  student_name?: string | null;
  caption?: string | null;
  uploader_name?: string | null;
  created_at?: string | null;
  file_size_bytes?: number | null;
}

interface Student { id: string; name: string; assigned_class_ids?: string[]; class_group_id?: string | null; }
interface MediaUsage {
  photo_bytes: number; photo_count: number;
  video_bytes: number; video_count: number;
  total_bytes: number; month_bytes: number;
}

function fmtBytes(b: number): string {
  if (!b || b === 0) return "0 B";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmtDate(d?: string | null) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" });
}

function itemLabel(item: MediaItem): string {
  if (item.caption) return item.caption;
  if (item.album_type === "group" && (item.schedule_days || item.class_name)) {
    const days = item.schedule_days?.split(",")[0] || "";
    const time = item.schedule_time || "";
    return `${days} ${time}반`.trim() || item.class_name || "";
  }
  if (item.album_type === "private" && item.student_name) return `${item.student_name} 개별`;
  return "";
}

function photoUri(url: string) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  return `${API_BASE.replace(/\/api$/, "")}${url}`;
}

const MEDIA_CONFIG: Record<`${MediaType}_${AlbumScope}`, {
  icon: React.ComponentProps<typeof Feather>["name"];
  title: string; sub: string; color: string; bg: string;
}> = {
  photo_group:   { icon: "image",  title: "사진", sub: "반 전체 앨범", color: "#F59E0B", bg: "#FEF3C7" },
  photo_private: { icon: "user",   title: "사진", sub: "개인 앨범",   color: "#1A5CFF", bg: "#EFF6FF" },
  video_group:   { icon: "video",  title: "영상", sub: "반 전체 앨범", color: "#059669", bg: "#D1FAE5" },
  video_private: { icon: "film",   title: "영상", sub: "개인 앨범",   color: "#7C3AED", bg: "#EDE9FE" },
};

export default function TeacherPhotosScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const [groups,   setGroups]   = useState<TeacherClassGroup[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [usage,    setUsage]    = useState<MediaUsage | null>(null);

  const [mediaType, setMediaType] = useState<MediaType>("photo");
  const [scope,     setScope]     = useState<AlbumScope>("group");
  const [step,      setStep]      = useState<Step>("home");
  const [selGroup,  setSelGroup]  = useState<TeacherClassGroup | null>(null);
  const [selStudent,setSelStudent]= useState<Student | null>(null);

  // 리스트
  const [items,       setItems]       = useState<MediaItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [selectMode,  setSelectMode]  = useState(false);
  const [selected,    setSelected]    = useState<Set<string>>(new Set());
  const [deleting,    setDeleting]    = useState(false);
  const [confirmDel,  setConfirmDel]  = useState(false);

  // 라이트박스
  const [lightbox,   setLightbox]   = useState<MediaItem | null>(null);

  // 업로드
  const [uploading,  setUploading]  = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg,   setErrorMsg]   = useState<string | null>(null);

  const cfg = MEDIA_CONFIG[`${mediaType}_${scope}`];

  // 초기 로드
  useEffect(() => {
    (async () => {
      const [cgRes, stRes, usageRes] = await Promise.all([
        apiRequest(token, "/class-groups"),
        apiRequest(token, "/students"),
        apiRequest(token, "/teacher/me/media-usage"),
      ]);
      const [cls, sts] = await Promise.all([safeJson(cgRes), safeJson(stRes)]);
      setGroups(Array.isArray(cls) ? cls : []);
      setStudents(Array.isArray(sts) ? sts : []);
      if (usageRes.ok) setUsage(await usageRes.json());
      setLoading(false);
    })();
  }, []);

  // 리스트 로드
  const loadList = useCallback(async () => {
    setListLoading(true);
    setItems([]);
    try {
      const isPhoto = mediaType === "photo";
      const endpoint = isPhoto
        ? `/photos/teacher-all?scope=${scope}`
        : `/videos/teacher-all?scope=${scope}`;
      const res = await apiRequest(token, endpoint);
      const data = await safeJson(res);
      if (isPhoto) {
        setItems(Array.isArray(data?.photos) ? data.photos : []);
      } else {
        setItems(Array.isArray(data?.videos) ? data.videos : []);
      }
    } catch { setItems([]); }
    finally { setListLoading(false); }
  }, [token, mediaType, scope]);

  function openList(mt: MediaType, sc: AlbumScope) {
    setMediaType(mt);
    setScope(sc);
    setSelectMode(false);
    setSelected(new Set());
    setStep("list");
  }

  useEffect(() => {
    if (step === "list") loadList();
  }, [step, loadList]);

  // 선택 모드
  function exitSelect() { setSelectMode(false); setSelected(new Set()); }
  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map(i => i.id)));
  }

  // 선택 삭제
  async function deleteSelected() {
    if (selected.size === 0) return;
    setDeleting(true);
    try {
      const ids = Array.from(selected);
      const isPhoto = mediaType === "photo";
      const res = await fetch(`${API_BASE}${isPhoto ? "/photos/bulk" : "/videos/bulk"}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any).error || "삭제 실패");
      exitSelect();
      setSuccessMsg(`${(data as any).deleted || ids.length}개가 삭제됐습니다.`);
      // 리스트 새로고침
      setItems(prev => prev.filter(i => !ids.includes(i.id)));
    } catch (e: any) {
      setErrorMsg(e.message || "삭제 중 오류");
    } finally {
      setDeleting(false);
      setConfirmDel(false);
    }
  }

  // 업로드
  const groupStudents = selGroup
    ? students.filter(st =>
        (Array.isArray(st.assigned_class_ids) && st.assigned_class_ids.includes(selGroup.id))
        || st.class_group_id === selGroup.id
      ).sort((a, b) => a.name.localeCompare(b.name))
    : [];

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
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("권한 필요", "미디어 접근 권한이 필요합니다."); return; }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: isVideo ? ["videos"] : ["images"],
      allowsMultipleSelection: !isVideo,
      quality: isVideo ? 1 : 0.85,
    });
    if (result.canceled || !result.assets?.length) return;

    setUploading(true);
    try {
      const form = new FormData();
      for (const asset of result.assets) {
        const fieldName = isVideo ? "video" : "photos";
        form.append(fieldName, {
          uri: asset.uri,
          name: asset.fileName || (isVideo ? "video.mp4" : "photo.jpg"),
          type: asset.mimeType || (isVideo ? "video/mp4" : "image/jpeg"),
        } as any);
      }
      form.append("class_id", selGroup!.id);
      if (scope === "private") form.append("student_id", selStudent!.id);

      const endpoint = isVideo
        ? (scope === "group" ? "/videos/group" : "/videos/private")
        : (scope === "group" ? "/photos/group" : "/photos/private");

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((resData as any).error || "업로드 실패");

      setSuccessMsg(
        scope === "group"
          ? `${isVideo ? "영상" : `${result.assets.length}장`}이 ${selGroup!.name} ${isVideo ? "영상" : "사진"} 앨범에 추가됐습니다.`
          : `${isVideo ? "영상" : `${result.assets.length}장`}이 ${selStudent!.name} 개인 ${isVideo ? "영상" : "사진"} 앨범에 추가됐습니다.`
      );
    } catch (e: any) { setErrorMsg(e.message || "업로드 실패"); }
    finally { setUploading(false); }
  }

  const statusMap: Record<string, SlotStatus> = {};
  groups.forEach(g => { statusMap[g.id] = { attChecked: 0, diaryDone: true, hasPhotos: false }; });

  // ─────────────────────────────────────────────────────────────────
  // 로딩
  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <SubScreenHeader title="사진 & 영상" homePath="/(teacher)/today-schedule" />
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // 홈: 4버튼 그리드 + 사용량
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
                >
                  <View style={[s.gridIcon, { backgroundColor: c.color + "25" }]}>
                    <Feather name={c.icon} size={28} color={c.color} />
                  </View>
                  <Text style={[s.gridTitle, { color: c.color }]}>{c.title}</Text>
                  <Text style={[s.gridSub, { color: c.color + "CC" }]}>{c.sub}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* 사용량 카드 */}
          <View style={s.usageCard}>
            <View style={s.usageCardHeader}>
              <Feather name="hard-drive" size={15} color={themeColor} />
              <Text style={[s.usageCardTitle, { color: themeColor }]}>내 업로드 사용량</Text>
            </View>
            <View style={s.usageCardBody}>
              {[
                { icon: "image" as const, color: "#F59E0B", label: `사진 ${usage?.photo_count ?? 0}개`, bytes: usage?.photo_bytes ?? 0 },
                { icon: "video" as const, color: "#7C3AED", label: `영상 ${usage?.video_count ?? 0}개`, bytes: usage?.video_bytes ?? 0 },
              ].map(row => (
                <View key={row.label} style={s.usageItem}>
                  <Feather name={row.icon} size={14} color={row.color} />
                  <Text style={s.usageItemLabel}>{row.label}</Text>
                  <Text style={s.usageItemBytes}>{fmtBytes(row.bytes)}</Text>
                </View>
              ))}
              <View style={s.usageDivider} />
              <View style={[s.usageItem, { backgroundColor: themeColor + "08" }]}>
                <Feather name="database" size={14} color={themeColor} />
                <Text style={[s.usageItemLabel, { color: themeColor, fontFamily: "Inter_700Bold" }]}>총 사용량</Text>
                <Text style={[s.usageItemBytes, { color: themeColor, fontFamily: "Inter_700Bold" }]}>{fmtBytes(usage?.total_bytes ?? 0)}</Text>
              </View>
              <Text style={s.usageMonthText}>이번 달: {fmtBytes(usage?.month_bytes ?? 0)}</Text>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // 리스트 뷰
  if (step === "list") {
    const isPhoto = mediaType === "photo";

    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <SubScreenHeader
          title={`${cfg.title} ${cfg.sub}`}
          subtitle={`${items.length}개`}
          onBack={() => { exitSelect(); setStep("home"); }}
          homePath="/(teacher)/today-schedule"
        />

        {/* 선택 모드 툴바 */}
        {selectMode ? (
          <View style={s.selectBar}>
            <Pressable onPress={toggleAll} style={s.selectBarLeft}>
              <Feather name={selected.size === items.length ? "check-square" : "square"} size={18} color={cfg.color} />
              <Text style={[s.selectBarAllText, { color: cfg.color }]}>
                {selected.size === items.length ? "전체 해제" : "전체 선택"}
              </Text>
            </Pressable>
            <Text style={s.selectBarCount}>{selected.size}개 선택</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                onPress={() => { if (selected.size > 0) setConfirmDel(true); }}
                disabled={selected.size === 0 || deleting}
                style={[s.selectBarDel, { opacity: selected.size === 0 ? 0.4 : 1 }]}
              >
                {deleting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <><Feather name="trash-2" size={14} color="#fff" /><Text style={s.selectBarDelText}>삭제</Text></>
                }
              </Pressable>
              <Pressable onPress={exitSelect} style={s.selectBarCancel}>
                <Text style={s.selectBarCancelText}>취소</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={s.listToolbar}>
            {items.length > 0 && (
              <Pressable onPress={() => setSelectMode(true)} style={s.listSelectBtn}>
                <Feather name="check-square" size={15} color={cfg.color} />
                <Text style={[s.listSelectBtnText, { color: cfg.color }]}>선택</Text>
              </Pressable>
            )}
          </View>
        )}

        {listLoading ? (
          <ActivityIndicator color={cfg.color} style={{ marginTop: 60 }} />
        ) : items.length === 0 ? (
          <View style={s.emptyBox}>
            <Feather name={cfg.icon} size={44} color="#D1D5DB" />
            <Text style={s.emptyTitle}>아직 업로드된 {cfg.title}이 없습니다</Text>
            <Text style={s.emptySubText}>아래 + 버튼으로 {cfg.title}을 업로드하세요</Text>
          </View>
        ) : isPhoto ? (
          // 사진 — 3열 그리드
          <FlatList
            data={items}
            keyExtractor={item => item.id}
            numColumns={3}
            contentContainerStyle={{ padding: 2, paddingBottom: insets.bottom + 100 }}
            columnWrapperStyle={{ gap: 2 }}
            renderItem={({ item }) => {
              const isSel = selected.has(item.id);
              const label = itemLabel(item);
              return (
                <Pressable
                  onPress={() => selectMode ? toggleSelect(item.id) : setLightbox(item)}
                  onLongPress={() => { if (!selectMode) { setSelectMode(true); setSelected(new Set([item.id])); } }}
                  style={[s.photoCell, isSel && { borderWidth: 3, borderColor: cfg.color }, { width: PHOTO_SIZE, height: PHOTO_SIZE }]}
                >
                  <Image
                    source={{ uri: photoUri(item.file_url), headers: { Authorization: `Bearer ${token}` } }}
                    style={{ width: "100%", height: "100%" }}
                    resizeMode="cover"
                  />
                  {item.created_at && (
                    <View style={s.photoDateOverlay}>
                      <Text style={s.photoDateText}>{fmtDate(item.created_at).replace("년 ", "/").replace("월 ", "/").replace("일", "")}</Text>
                    </View>
                  )}
                  {label ? (
                    <View style={s.photoLabelBar}>
                      <Text style={s.photoLabelText} numberOfLines={1}>{label}</Text>
                    </View>
                  ) : null}
                  {selectMode && (
                    <View style={[s.checkCircle, isSel && { backgroundColor: cfg.color, borderColor: cfg.color }]}>
                      {isSel && <Feather name="check" size={12} color="#fff" />}
                    </View>
                  )}
                </Pressable>
              );
            }}
          />
        ) : (
          // 영상 — 카드 리스트
          <FlatList
            data={items}
            keyExtractor={item => item.id}
            contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: insets.bottom + 100 }}
            renderItem={({ item }) => {
              const isSel = selected.has(item.id);
              const label = itemLabel(item);
              return (
                <Pressable
                  onPress={() => selectMode ? toggleSelect(item.id) : Alert.alert("영상 재생", "영상은 다운로드 후 재생할 수 있습니다.")}
                  onLongPress={() => { if (!selectMode) { setSelectMode(true); setSelected(new Set([item.id])); } }}
                  style={[s.videoRow, { backgroundColor: C.card, borderColor: isSel ? cfg.color : "transparent", borderWidth: 2 }]}
                >
                  <View style={[s.videoThumb, { backgroundColor: cfg.bg }]}>
                    <Feather name="video" size={22} color={cfg.color} />
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={s.videoLabel} numberOfLines={1}>{label || "영상"}</Text>
                    <Text style={s.videoMeta} numberOfLines={1}>
                      {fmtDate(item.created_at)}
                      {item.file_size_bytes ? ` · ${fmtBytes(item.file_size_bytes)}` : ""}
                    </Text>
                    {item.uploader_name && (
                      <Text style={s.videoUploader} numberOfLines={1}>{item.uploader_name}</Text>
                    )}
                  </View>
                  {selectMode
                    ? <View style={[s.checkCircle, isSel && { backgroundColor: cfg.color, borderColor: cfg.color }]}>
                        {isSel && <Feather name="check" size={12} color="#fff" />}
                      </View>
                    : <Feather name="chevron-right" size={18} color="#9CA3AF" />
                  }
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
          >
            <Feather name="plus" size={26} color="#fff" />
          </Pressable>
        )}

        {/* 사진 라이트박스 */}
        <Modal visible={!!lightbox} transparent animationType="fade" onRequestClose={() => setLightbox(null)}>
          <View style={s.lbBg}>
            <Pressable onPress={() => setLightbox(null)} style={[s.lbClose, { top: insets.top + 12 }]}>
              <Feather name="x" size={26} color="#fff" />
            </Pressable>
            {lightbox && (
              <Image
                source={{ uri: photoUri(lightbox.file_url), headers: { Authorization: `Bearer ${token}` } }}
                style={s.lbImage}
                resizeMode="contain"
              />
            )}
            {itemLabel(lightbox!) ? (
              <Text style={s.lbLabel}>{itemLabel(lightbox!)}</Text>
            ) : null}
            <Text style={s.lbMeta}>
              {lightbox?.uploader_name ? `${lightbox.uploader_name}  ` : ""}
              {fmtDate(lightbox?.created_at)}
              {lightbox?.file_size_bytes ? `  ·  ${fmtBytes(lightbox.file_size_bytes)}` : ""}
            </Text>
          </View>
        </Modal>

        {/* 삭제 확인 */}
        <ConfirmModal
          visible={confirmDel}
          title={`${selected.size}개 삭제`}
          message={`선택한 ${mediaType === "photo" ? "사진" : "영상"} ${selected.size}개를 영구 삭제합니다. 이 작업은 취소할 수 없습니다.`}
          confirmText="삭제"
          cancelText="취소"
          destructive
          onConfirm={deleteSelected}
          onCancel={() => setConfirmDel(false)}
        />
        <ConfirmModal visible={!!successMsg} title="완료" message={successMsg ?? ""} confirmText="확인"
          onConfirm={() => setSuccessMsg(null)} />
        <ConfirmModal visible={!!errorMsg} title="오류" message={errorMsg ?? ""} confirmText="확인"
          onConfirm={() => setErrorMsg(null)} />
      </SafeAreaView>
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // 시간표 단계 (업로드를 위한 반 선택)
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

  // ─────────────────────────────────────────────────────────────────
  // 학생 선택 단계 (개인 앨범)
  if (step === "student") {
    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <SubScreenHeader
          title={`${selGroup?.name} · 학생 선택`}
          subtitle={`개인 ${cfg.title} 앨범에 업로드할 학생을 선택하세요`}
          onBack={() => setStep("schedule")}
          homePath="/(teacher)/today-schedule"
        />
        <ScrollView contentContainerStyle={s.studentList} showsVerticalScrollIndicator={false}>
          {groupStudents.length === 0 ? (
            <View style={s.emptyBox}>
              <Feather name="users" size={32} color={C.textMuted} />
              <Text style={s.emptyTitle}>이 반에 배정된 학생이 없습니다</Text>
            </View>
          ) : groupStudents.map(st => (
            <Pressable key={st.id} style={[s.studentRow, { backgroundColor: C.card }]} onPress={() => selectStudent(st)}>
              <View style={[s.avatar, { backgroundColor: cfg.color + "20" }]}>
                <Text style={[s.avatarText, { color: cfg.color }]}>{st.name[0]}</Text>
              </View>
              <Text style={s.studentName}>{st.name}</Text>
              <Feather name="chevron-right" size={18} color={C.textMuted} />
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // 업로드 단계
  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader
        title={`${scope === "group" ? selGroup?.name : selStudent?.name} · ${cfg.sub}`}
        subtitle={`${cfg.title} 업로드`}
        onBack={() => setStep(scope === "private" ? "student" : "schedule")}
        homePath="/(teacher)/today-schedule"
      />
      <View style={s.uploadCenter}>
        <View style={[s.uploadIcon, { backgroundColor: cfg.bg }]}>
          <Feather name={cfg.icon} size={48} color={cfg.color} />
        </View>
        <Text style={s.uploadTitle}>
          {scope === "group"
            ? `${selGroup?.name}에 ${cfg.title} 업로드`
            : `${selStudent?.name}의 개인 ${cfg.title} 업로드`}
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
            : <><Feather name="upload-cloud" size={20} color="#fff" />
                <Text style={s.uploadBtnText}>{cfg.title} 선택 및 업로드</Text></>
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

// ── 스타일 ──────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F3F4F6" },
  titleRow: { paddingHorizontal: 16, paddingVertical: 10 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#111827" },

  // 홈 그리드
  grid: { flexDirection: "row", flexWrap: "wrap", padding: 12, gap: 12 },
  gridBtn: { width: "47%", aspectRatio: 1, borderRadius: 20, borderWidth: 1.5, alignItems: "center", justifyContent: "center", gap: 10 },
  gridIcon: { width: 60, height: 60, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  gridTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  gridSub: { fontSize: 13, fontFamily: "Inter_500Medium" },

  // 사용량
  usageCard: { marginHorizontal: 12, marginTop: 4, backgroundColor: "#fff", borderRadius: 16, overflow: "hidden" },
  usageCardHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  usageCardTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  usageCardBody: { padding: 12, gap: 2 },
  usageItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8, paddingVertical: 10, borderRadius: 10 },
  usageItemLabel: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#374151" },
  usageItemBytes: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#374151" },
  usageDivider: { height: 1, backgroundColor: "#F3F4F6", marginHorizontal: 8 },
  usageMonthText: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", textAlign: "center", paddingTop: 6 },

  // 리스트 툴바
  listToolbar: { height: 36, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", paddingHorizontal: 14 },
  listSelectBtn: { flexDirection: "row", alignItems: "center", gap: 5 },
  listSelectBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },

  // 선택 모드 바
  selectBar: { flexDirection: "row", alignItems: "center", backgroundColor: "#F9FAFB", paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#E5E7EB", gap: 4 },
  selectBarLeft: { flexDirection: "row", alignItems: "center", gap: 5 },
  selectBarAllText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  selectBarCount: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", textAlign: "center" },
  selectBarDel: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#EF4444", paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  selectBarDelText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  selectBarCancel: { paddingHorizontal: 8, paddingVertical: 7 },
  selectBarCancelText: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#6B7280" },

  // 사진 그리드
  photoCell: { overflow: "hidden", backgroundColor: "#F3F4F6", margin: 1 },
  photoDateOverlay: { position: "absolute", top: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.28)", paddingHorizontal: 5, paddingVertical: 3 },
  photoDateText: { color: "#fff", fontSize: 9, fontFamily: "Inter_400Regular" },
  photoLabelBar: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 5, paddingVertical: 4 },
  photoLabelText: { color: "#fff", fontSize: 9, fontFamily: "Inter_500Medium" },
  checkCircle: { position: "absolute", top: 5, right: 5, width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#fff", backgroundColor: "rgba(255,255,255,0.3)", alignItems: "center", justifyContent: "center" },

  // 영상 리스트
  videoRow: { flexDirection: "row", alignItems: "center", borderRadius: 14, padding: 12, gap: 12 },
  videoThumb: { width: 52, height: 52, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  videoLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#111827" },
  videoMeta: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280" },
  videoUploader: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },

  // FAB
  fab: { position: "absolute", right: 20, width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 8 },

  // 라이트박스
  lbBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.97)", justifyContent: "center", alignItems: "center" },
  lbClose: { position: "absolute", left: 16, width: 44, height: 44, alignItems: "center", justifyContent: "center", zIndex: 10 },
  lbImage: { width: W, height: W * 1.2 },
  lbLabel: { color: "#D1FAE5", fontSize: 13, fontFamily: "Inter_600SemiBold", paddingHorizontal: 24, paddingTop: 14, textAlign: "center" },
  lbMeta: { color: "rgba(255,255,255,0.45)", fontSize: 12, fontFamily: "Inter_400Regular", paddingTop: 4, textAlign: "center" },

  // 빈 상태
  emptyBox: { alignItems: "center", paddingTop: 80, gap: 10, paddingHorizontal: 28 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#374151", textAlign: "center" },
  emptySubText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF", textAlign: "center" },

  // 업로드
  uploadCenter: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 40 },
  uploadIcon: { width: 100, height: 100, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  uploadTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#111827", textAlign: "center" },
  uploadSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6B7280", textAlign: "center", lineHeight: 20 },
  uploadBtn: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 28, paddingVertical: 16, borderRadius: 16 },
  uploadBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },

  // 학생 선택
  studentList: { padding: 12, gap: 8, paddingBottom: 100 },
  studentRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14 },
  avatar: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  studentName: { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#111827" },
});
