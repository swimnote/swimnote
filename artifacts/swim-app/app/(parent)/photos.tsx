/**
 * (parent)/photos.tsx — 학부모: 통합 앨범 (사진 + 영상)
 *
 * - 자녀 일지에 첨부된 사진 + 영상 통합 표시
 * - 전체 / 사진 / 영상 탭 필터
 * - 월별 그룹핑, created_at 최신순, 3열 격자
 * - 사진: 확대 라이트박스 + 좌우 스와이프/버튼으로 이전·다음 사진 이동
 * - 영상: 썸네일 + 재생 아이콘, 해당 일지 보기
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Dimensions, FlatList, Modal,
  PanResponder, Platform, Pressable, RefreshControl, StyleSheet, Text, View,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import Colors from "@/constants/colors";
import { ParentScreenHeader } from "@/components/parent/ParentScreenHeader";
import { useMode } from "@/context/ModeContext";
import { X as XT, isXMode } from "@/constants/xTheme";
import { API_BASE, apiRequest, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";


const C = Colors.light;
const { width: W } = Dimensions.get("window");
const CELL = Math.floor((W - 6) / 3);

type TabType = "all" | "photo" | "video";

interface MediaItem {
  id: string;
  _type: "photo" | "video";
  file_url: string;
  thumbnail_presigned_url?: string | null;
  journal_id?: string | null;
  created_at?: string | null;
  source_label?: string | null;
  uploaded_by_name?: string | null;
  caption?: string | null;
}

type FlatRow =
  | { kind: "header"; label: string; rowKey: string }
  | { kind: "row"; items: (MediaItem | null)[]; rowKey: string };

function monthKey(d?: string | null) {
  if (!d) return "unknown";
  return d.slice(0, 7);
}
function monthLabel(d?: string | null) {
  if (!d) return "";
  const dt = new Date(d.replace(" ", "T"));
  if (isNaN(dt.getTime())) return "";
  return `${dt.getFullYear()}년 ${dt.getMonth() + 1}월`;
}

function buildRows(items: MediaItem[]): FlatRow[] {
  const result: FlatRow[] = [];
  let curMonth = "";
  let buf: MediaItem[] = [];
  let rowIdx = 0;

  function flush() {
    if (!buf.length) return;
    const padded: (MediaItem | null)[] = [...buf];
    while (padded.length < 3) padded.push(null);
    result.push({ kind: "row", items: padded, rowKey: `r${rowIdx++}` });
    buf = [];
  }

  for (const item of items) {
    const mk = monthKey(item.created_at);
    if (mk !== curMonth) {
      flush();
      curMonth = mk;
      result.push({ kind: "header", label: monthLabel(item.created_at), rowKey: `h-${mk}` });
    }
    buf.push(item);
    if (buf.length === 3) flush();
  }
  flush();
  return result;
}

function photoFileUri(fileUrl: string) {
  if (!fileUrl) return "";
  if (fileUrl.startsWith("http")) return fileUrl;
  return `${API_BASE.replace(/\/api$/, "")}${fileUrl}`;
}

export default function ParentAlbumScreen() {
  const { token } = useAuth();
  const { selectedStudent, students } = useParent();
  const params = useLocalSearchParams<{ studentId?: string }>();
  const insets = useSafeAreaInsets();
  const { mode } = useMode();
  const isX = isXMode(mode);

  // param이 있으면 그 학생, 없으면 selectedStudent (multi-child context leak 방지)
  const activeStudent = params.studentId
    ? (students?.find(s => s.id === params.studentId) ?? selectedStudent)
    : selectedStudent;

  const [photos, setPhotos]   = useState<MediaItem[]>([]);
  const [videos, setVideos]   = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab]         = useState<TabType>("all");

  // 라이트박스: 인덱스 기반 (photoOnlyItems 배열 인덱스)
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [lbSaving, setLbSaving]       = useState(false);

  const [videoDetail, setVideoDetail] = useState<MediaItem | null>(null);
  const [vdSaving, setVdSaving]       = useState(false);

  const load = useCallback(async () => {
    try {
      const sid = activeStudent?.id;
      const q = sid ? `?student_id=${sid}` : "";
      const [pr, vr] = await Promise.all([
        apiRequest(token, `/photos/parent-view${q}`),
        apiRequest(token, `/videos/parent-view${q}`),
      ]);
      const pd = pr.ok ? await pr.json() : {};
      const vd = vr.ok ? await vr.json() : {};

      const rawPhotos: MediaItem[] = (Array.isArray(pd.photos) ? pd.photos : [])
        .map((p: any) => ({ ...p, _type: "photo" as const }));
      const rawVideos: MediaItem[] = (Array.isArray(vd.videos) ? vd.videos : [])
        .map((v: any) => ({ ...v, _type: "video" as const }));

      setPhotos(rawPhotos);
      setVideos(rawVideos);
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, [token, activeStudent?.id]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo<MediaItem[]>(() => {
    const src = tab === "photo" ? photos : tab === "video" ? videos : [...photos, ...videos];
    return src.slice().sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  }, [photos, videos, tab]);

  // 사진만 추출 (스와이프 이동 대상)
  const photoOnlyItems = useMemo<MediaItem[]>(
    () => filtered.filter(i => i._type === "photo"),
    [filtered]
  );

  const rows = useMemo(() => buildRows(filtered), [filtered]);

  // 현재 라이트박스 아이템
  const lightboxItem = lightboxIdx !== null ? photoOnlyItems[lightboxIdx] ?? null : null;

  function openLightbox(item: MediaItem) {
    const idx = photoOnlyItems.findIndex(p => p.id === item.id);
    if (idx >= 0) setLightboxIdx(idx);
  }

  function closeLightbox() { setLightboxIdx(null); }

  function goPrev() {
    setLightboxIdx(prev => (prev !== null && prev > 0 ? prev - 1 : prev));
  }
  function goNext() {
    setLightboxIdx(prev => (prev !== null && prev < photoOnlyItems.length - 1 ? prev + 1 : prev));
  }

  // 스와이프 감지
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 10 && Math.abs(gs.dx) > Math.abs(gs.dy),
      onPanResponderRelease: (_, gs) => {
        if (gs.dx < -50) goNext();
        else if (gs.dx > 50) goPrev();
      },
    })
  ).current;

  // goPrev/goNext가 클로저 캡처 문제가 있으므로 ref로 최신 인덱스 추적
  const lightboxIdxRef = useRef<number | null>(null);
  const photoOnlyItemsRef = useRef<MediaItem[]>([]);
  useEffect(() => { lightboxIdxRef.current = lightboxIdx; }, [lightboxIdx]);
  useEffect(() => { photoOnlyItemsRef.current = photoOnlyItems; }, [photoOnlyItems]);

  const panResponderFixed = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 10 && Math.abs(gs.dx) > Math.abs(gs.dy),
      onPanResponderRelease: (_, gs) => {
        const cur = lightboxIdxRef.current;
        const arr = photoOnlyItemsRef.current;
        if (cur === null) return;
        if (gs.dx < -50 && cur < arr.length - 1) setLightboxIdx(cur + 1);
        else if (gs.dx > 50 && cur > 0) setLightboxIdx(cur - 1);
      },
    })
  ).current;

  async function downloadPhoto(item: MediaItem) {
    if (Platform.OS === "web") {
      const a = document.createElement("a");
      a.href = photoFileUri(item.file_url);
      a.download = `swim_${item.id}.jpg`;
      a.click();
      return;
    }
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== "granted") { Alert.alert("권한 필요", "갤러리 접근 권한이 필요합니다."); return; }
    setLbSaving(true);
    let localUri: string | null = null;
    try {
      localUri = `${FileSystem.documentDirectory}swim_${item.id}.jpg`;
      await FileSystem.downloadAsync(photoFileUri(item.file_url), localUri, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await MediaLibrary.saveToLibraryAsync(localUri);
      Alert.alert("저장 완료", "갤러리에 저장됐습니다.");
    } catch { Alert.alert("오류", "저장 중 오류가 발생했습니다."); }
    finally {
      if (localUri) {
        FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => {});
      }
      setLbSaving(false);
    }
  }

  async function downloadVideo(item: MediaItem) {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== "granted") { Alert.alert("권한 필요", "갤러리 접근 권한이 필요합니다."); return; }
    setVdSaving(true);
    let localUri: string | null = null;
    try {
      const BASE_ORIGIN = API_BASE.replace(/\/api$/, "");
      const presigned = (item as any).presigned_url as string | undefined;
      const finalUrl = presigned
        ?? (() => {
          const raw = item.file_url ?? "";
          return raw.startsWith("http") ? raw : `${BASE_ORIGIN}${raw}`;
        })();
      if (!finalUrl) throw new Error("URL 확인 실패");

      const pathPart = finalUrl.split("?")[0];
      const lastSeg = pathPart.split("/").pop() ?? "";
      const extCandidate = lastSeg.includes(".") ? lastSeg.split(".").pop()?.toLowerCase() : undefined;
      const ext = (extCandidate && extCandidate.length <= 4) ? extCandidate : "mp4";
      localUri = `${FileSystem.documentDirectory}swim_video_${item.id}.${ext}`;
      const headers: Record<string, string> = presigned ? {} : { Authorization: `Bearer ${token}` };
      const dl = await FileSystem.downloadAsync(finalUrl, localUri, { headers });
      if (dl.status !== 200) throw new Error(`다운로드 실패 (${dl.status})`);
      await MediaLibrary.saveToLibraryAsync(dl.uri);
      Alert.alert("저장 완료", "영상이 갤러리에 저장됐습니다.");
    } catch (e: any) {
      console.warn("[ParentAlbum] video download error:", e);
      Alert.alert("오류", "저장 중 오류가 발생했습니다.");
    }
    finally {
      if (localUri) {
        FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => {});
      }
      setVdSaving(false);
    }
  }

  function goToDiary(journalId?: string | null) {
    closeLightbox();
    setVideoDetail(null);
    router.push({
      pathname: "/(parent)/diary" as any,
      params: journalId ? { diary_id: journalId } : {},
    });
  }

  function renderCell(item: MediaItem | null, colIdx: number) {
    if (!item) return <View key={`empty-${colIdx}`} style={[st.cell, { width: CELL, height: CELL }]} />;

    if (item._type === "photo") {
      const uri = photoFileUri(item.file_url);
      return (
        <Pressable key={item.id} onPress={() => openLightbox(item)} style={[st.cell, { width: CELL, height: CELL }]}>
          <ExpoImage
            source={{ uri, headers: { Authorization: `Bearer ${token}` } }}
            style={st.cellImg}
            contentFit="cover"
            cachePolicy="memory"
          />
        </Pressable>
      );
    }

    const thumbUri = item.thumbnail_presigned_url ?? null;
    return (
      <Pressable key={item.id} onPress={() => setVideoDetail(item)} style={[st.cell, { width: CELL, height: CELL }]}>
        {thumbUri ? (
          <ExpoImage source={{ uri: thumbUri }} style={st.cellImg} contentFit="cover" cachePolicy="memory" />
        ) : (
          <View style={[st.cellImg, st.videoPlaceholder]} />
        )}
        <View style={st.playBadge}>
          <LucideIcon name="play" size={14} color="#fff" fill="#fff" />
        </View>
      </Pressable>
    );
  }

  function renderRow({ item }: { item: FlatRow }) {
    if (item.kind === "header") {
      return (
        <View style={st.monthHeader}>
          <Text style={st.monthLabel}>{item.label}</Text>
        </View>
      );
    }
    return (
      <View style={st.row}>
        {item.items.map((m, i) => renderCell(m, i))}
      </View>
    );
  }

  const TABS: { key: TabType; label: string }[] = [
    { key: "all",   label: "전체" },
    { key: "photo", label: "사진" },
    { key: "video", label: "영상" },
  ];

  const hasPrev = lightboxIdx !== null && lightboxIdx > 0;
  const hasNext = lightboxIdx !== null && lightboxIdx < photoOnlyItems.length - 1;

  return (
    <View style={[st.root, { backgroundColor: isX ? XT.background : C.background }]}>
      <ParentScreenHeader title="앨범" />

      {/* 탭 */}
      <View style={st.tabRow}>
        {TABS.map(t => (
          <Pressable
            key={t.key}
            style={[
              st.tabBtn,
              tab === t.key && st.tabBtnActive,
              tab === t.key && isX && { borderColor: XT.accent, backgroundColor: XT.accentSoft },
            ]}
            onPress={() => setTab(t.key)}
          >
            <Text style={[st.tabTxt, tab === t.key && st.tabTxtActive, tab === t.key && isX && { color: XT.accent }]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={isX ? XT.accent : C.brandStrong} style={{ marginTop: 60 }} />
      ) : rows.length === 0 ? (
        <View style={st.empty}>
          <LucideIcon name="image" size={44} color={C.textMuted} />
          <Text style={[st.emptyTitle, { color: C.text }]}>
            {tab === "video" ? "영상이 없습니다" : tab === "photo" ? "사진이 없습니다" : "사진/영상이 없습니다"}
          </Text>
          <Text style={[st.emptySub, { color: C.textSecondary }]}>
            선생님이 수업 일지에 사진/영상을 올리면{"\n"}여기에 표시됩니다
          </Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={r => r.rowKey}
          renderItem={renderRow}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* 사진 라이트박스 (스와이프 이동 가능) */}
      <Modal
        visible={lightboxIdx !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeLightbox}
      >
        <View style={st.lbBg}>
          {/* 닫기 — panHandlers 밖에 배치해야 터치 정상 작동 */}
          <View style={[st.lbTop, { paddingTop: insets.top + 14 }]}>
            <Pressable onPress={closeLightbox} style={st.lbClose} hitSlop={10}>
              <LucideIcon name="x" size={26} color="#fff" />
            </Pressable>
            {/* 인덱스 표시 */}
            {photoOnlyItems.length > 1 && lightboxIdx !== null && (
              <Text style={st.lbCounter}>
                {lightboxIdx + 1} / {photoOnlyItems.length}
              </Text>
            )}
          </View>

          {/* 이미지 영역에만 panHandlers 적용 */}
          <View style={st.lbImageWrap} {...panResponderFixed.panHandlers}>
            {lightboxItem ? (
              <ExpoImage
                source={{ uri: photoFileUri(lightboxItem.file_url), headers: { Authorization: `Bearer ${token}` } }}
                style={st.lbImage}
                contentFit="contain"
              />
            ) : null}
          </View>

          {lightboxItem?.source_label ? (
            <Text style={st.lbSource}>{lightboxItem.source_label}</Text>
          ) : null}

          {/* 이전/다음 화살표 */}
          {photoOnlyItems.length > 1 && (
            <View style={st.lbArrowRow}>
              <Pressable
                onPress={goPrev}
                style={[st.lbArrow, !hasPrev && st.lbArrowDisabled]}
                hitSlop={16}
                disabled={!hasPrev}
              >
                <LucideIcon name="chevron-left" size={28} color={hasPrev ? "#fff" : "rgba(255,255,255,0.25)"} />
              </Pressable>
              <Pressable
                onPress={goNext}
                style={[st.lbArrow, !hasNext && st.lbArrowDisabled]}
                hitSlop={16}
                disabled={!hasNext}
              >
                <LucideIcon name="chevron-right" size={28} color={hasNext ? "#fff" : "rgba(255,255,255,0.25)"} />
              </Pressable>
            </View>
          )}

          {/* 다운로드 / 일지보기 버튼 */}
          <View style={st.lbBtnRow}>
            <Pressable
              style={[st.lbBtn, { backgroundColor: C.primaryAction }]}
              onPress={() => lightboxItem && downloadPhoto(lightboxItem)}
              disabled={lbSaving}
            >
              {lbSaving
                ? <ActivityIndicator color="#fff" size="small" />
                : <><LucideIcon name="download" size={16} color="#fff" /><Text style={st.lbBtnTxt}>다운로드</Text></>}
            </Pressable>
            {lightboxItem?.journal_id && (
              <Pressable
                style={[st.lbBtn, { backgroundColor: XT.primary }]}
                onPress={() => goToDiary(lightboxItem?.journal_id)}
              >
                <LucideIcon name="book-open" size={16} color="#fff" />
                <Text style={st.lbBtnTxt}>해당 일지 보기</Text>
              </Pressable>
            )}
          </View>
        </View>
      </Modal>

      {/* 영상 상세 모달 */}
      <Modal visible={!!videoDetail} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setVideoDetail(null)}>
        <Pressable style={st.vdOverlay} onPress={() => setVideoDetail(null)}>
          <Pressable style={[st.vdSheet, { paddingBottom: insets.bottom + 20 }]} onPress={e => e.stopPropagation()}>
            <View style={st.vdHandle} />

            {videoDetail?.thumbnail_presigned_url ? (
              <View style={st.vdThumbWrap}>
                <ExpoImage
                  source={{ uri: videoDetail.thumbnail_presigned_url }}
                  style={st.vdThumb}
                  contentFit="cover"
                />
                <View style={st.vdPlayOverlay}>
                  <LucideIcon name="play" size={36} color="#fff" fill="#fff" />
                </View>
              </View>
            ) : (
              <View style={[st.vdThumbWrap, st.vdThumbEmpty]}>
                <LucideIcon name="video" size={40} color={C.textSecondary} />
                <Text style={st.vdThumbEmptyTxt}>썸네일 없음</Text>
              </View>
            )}

            {videoDetail?.source_label ? (
              <Text style={st.vdLabel}>{videoDetail.source_label}</Text>
            ) : null}

            <View style={st.vdBtnCol}>
              <Pressable
                style={[st.vdBtn, { backgroundColor: C.primaryAction }]}
                onPress={() => videoDetail && downloadVideo(videoDetail)}
                disabled={vdSaving}
              >
                {vdSaving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <><LucideIcon name="download" size={16} color="#fff" /><Text style={st.vdBtnTxt}>영상 다운로드</Text></>}
              </Pressable>
              {videoDetail?.journal_id && (
                <Pressable
                  style={[st.vdBtn, { backgroundColor: "#0F2742" }]}
                  onPress={() => goToDiary(videoDetail?.journal_id)}
                >
                  <LucideIcon name="book-open" size={16} color="#fff" />
                  <Text style={st.vdBtnTxt}>해당 일지 보기</Text>
                </Pressable>
              )}
              <Pressable style={[st.vdBtn, { backgroundColor: C.backgroundSoft }]} onPress={() => setVideoDetail(null)}>
                <Text style={[st.vdBtnTxt, { color: C.textPrimary }]}>닫기</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1 },

  tabRow: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderBottomColor: C.backgroundSoft },
  tabBtn: { paddingHorizontal: 18, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.backgroundSoft },
  tabBtnActive: { borderColor: C.brandStrong, backgroundColor: C.brandMist },
  tabTxt: { fontSize: 13, lineHeight: 18, color: C.textSecondary },
  tabTxtActive: { color: C.brandStrong },

  monthHeader: { paddingHorizontal: 14, paddingTop: 18, paddingBottom: 8 },
  monthLabel: { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.textPrimary },

  row: { flexDirection: "row", gap: 2, paddingHorizontal: 2 },
  cell: { borderRadius: 2, overflow: "hidden", backgroundColor: "#E2E8F0", marginBottom: 2 },
  cellImg: { width: "100%", height: "100%" },
  videoPlaceholder: { backgroundColor: "#1E293B", alignItems: "center", justifyContent: "center" },
  playBadge: {
    position: "absolute", bottom: 5, left: 5,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center", justifyContent: "center",
  },

  empty: { alignItems: "center", paddingTop: 80, gap: 10, paddingHorizontal: 28 },
  emptyTitle: { fontSize: 17, fontFamily: "Pretendard-Regular" },
  emptySub: { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 20, color: C.textSecondary },

  lbBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.96)", justifyContent: "center" },
  lbTop: {
    position: "absolute", top: 0, left: 0, right: 0, zIndex: 10,
    paddingHorizontal: 16, paddingBottom: 12,
    flexDirection: "row", alignItems: "center",
  },
  lbClose: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  lbCounter: {
    flex: 1, textAlign: "center",
    color: "rgba(255,255,255,0.75)", fontSize: 14, fontFamily: "Pretendard-Regular",
    marginRight: 44,
  },
  lbImageWrap: { width: "100%", height: "60%" },
  lbImage: { width: "100%", height: "100%" },
  lbSource: { color: C.brandSoft, fontSize: 13, textAlign: "center", paddingHorizontal: 24, paddingTop: 16, fontFamily: "Pretendard-Regular" },

  lbArrowRow: {
    position: "absolute", left: 0, right: 0,
    flexDirection: "row", justifyContent: "space-between",
    paddingHorizontal: 8, top: "35%",
    zIndex: 5,
  },
  lbArrow: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center", justifyContent: "center",
  },
  lbArrowDisabled: { backgroundColor: "rgba(0,0,0,0.15)" },

  lbBtnRow: { flexDirection: "row", gap: 10, paddingHorizontal: 20, paddingTop: 20, justifyContent: "center" },
  lbBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14 },
  lbBtnTxt: { color: "#fff", fontSize: 14, fontFamily: "Pretendard-Regular" },

  vdOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  vdSheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 14, gap: 16 },
  vdHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: "center", marginBottom: 4 },
  vdThumbWrap: { width: "100%", height: 200, borderRadius: 14, overflow: "hidden", backgroundColor: "#E2E8F0" },
  vdThumb: { width: "100%", height: "100%" },
  vdThumbEmpty: { alignItems: "center", justifyContent: "center", gap: 8 },
  vdThumbEmptyTxt: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  vdPlayOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.3)" },
  vdLabel: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textPrimary, textAlign: "center" },
  vdBtnCol: { gap: 10 },
  vdBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14 },
  vdBtnTxt: { color: "#fff", fontSize: 14, fontFamily: "Pretendard-Regular" },
});
