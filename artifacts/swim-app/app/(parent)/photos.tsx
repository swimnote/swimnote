/**
 * (parent)/photos.tsx — 학부모: 통합 앨범 (사진 + 영상)
 *
 * - 자녀 일지에 첨부된 사진 + 영상 통합 표시
 * - 전체 / 사진 / 영상 탭 필터
 * - 월별 그룹핑, created_at 최신순, 3열 격자
 * - 사진: 확대 라이트박스, 다운로드, 해당 일지 보기
 * - 영상: 썸네일 + 재생 아이콘, 해당 일지 보기
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, Dimensions, FlatList, Modal,
  Platform, Pressable, RefreshControl, StyleSheet, Text, View,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { BookOpen, Download, ImageIcon, Play, Video, X } from "lucide-react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import Colors from "@/constants/colors";
import { ParentScreenHeader } from "@/components/parent/ParentScreenHeader";
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
  const { selectedStudent } = useParent();
  const insets = useSafeAreaInsets();

  const [photos, setPhotos]   = useState<MediaItem[]>([]);
  const [videos, setVideos]   = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab]         = useState<TabType>("all");

  const [lightbox, setLightbox]   = useState<MediaItem | null>(null);
  const [lbSaving, setLbSaving]   = useState(false);
  const [videoDetail, setVideoDetail] = useState<MediaItem | null>(null);
  const [vdSaving, setVdSaving]   = useState(false);

  const load = useCallback(async () => {
    try {
      const sid = selectedStudent?.id;
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
  }, [token, selectedStudent?.id]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo<MediaItem[]>(() => {
    const src = tab === "photo" ? photos : tab === "video" ? videos : [...photos, ...videos];
    return src.slice().sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  }, [photos, videos, tab]);

  const rows = useMemo(() => buildRows(filtered), [filtered]);

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
    try {
      const localUri = `${FileSystem.documentDirectory}swim_${item.id}.jpg`;
      await FileSystem.downloadAsync(photoFileUri(item.file_url), localUri, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await MediaLibrary.saveToLibraryAsync(localUri);
      Alert.alert("저장 완료", "갤러리에 저장됐습니다.");
    } catch { Alert.alert("오류", "저장 중 오류가 발생했습니다."); }
    finally { setLbSaving(false); }
  }

  async function downloadVideo(item: MediaItem) {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== "granted") { Alert.alert("권한 필요", "갤러리 접근 권한이 필요합니다."); return; }
    setVdSaving(true);
    try {
      const BASE_ORIGIN = API_BASE.replace(/\/api$/, "");
      // 서버 batchVideoPresign이 presigned_url을 함께 내려줌 → 직접 다운로드
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
      const localUri = `${FileSystem.documentDirectory}swim_video_${item.id}.${ext}`;
      const headers: Record<string, string> = presigned ? {} : { Authorization: `Bearer ${token}` };
      const dl = await FileSystem.downloadAsync(finalUrl, localUri, { headers });
      if (dl.status !== 200) throw new Error(`다운로드 실패 (${dl.status})`);
      await MediaLibrary.saveToLibraryAsync(dl.uri);
      Alert.alert("저장 완료", "영상이 갤러리에 저장됐습니다.");
    } catch (e: any) {
      console.warn("[ParentAlbum] video download error:", e);
      Alert.alert("오류", "저장 중 오류가 발생했습니다.");
    }
    finally { setVdSaving(false); }
  }

  function goToDiary(journalId?: string | null) {
    setLightbox(null);
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
        <Pressable key={item.id} onPress={() => setLightbox(item)} style={[st.cell, { width: CELL, height: CELL }]}>
          <ExpoImage
            source={{ uri, headers: { Authorization: `Bearer ${token}` } }}
            style={st.cellImg}
            contentFit="cover"
          />
        </Pressable>
      );
    }

    const thumbUri = item.thumbnail_presigned_url ?? null;
    return (
      <Pressable key={item.id} onPress={() => setVideoDetail(item)} style={[st.cell, { width: CELL, height: CELL }]}>
        {thumbUri ? (
          <ExpoImage source={{ uri: thumbUri }} style={st.cellImg} contentFit="cover" />
        ) : (
          <View style={[st.cellImg, st.videoPlaceholder]} />
        )}
        <View style={st.playBadge}>
          <Play size={14} color="#fff" fill="#fff" />
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

  return (
    <View style={[st.root, { backgroundColor: C.background }]}>
      <ParentScreenHeader title="앨범" />

      {/* 탭 */}
      <View style={st.tabRow}>
        {TABS.map(t => (
          <Pressable
            key={t.key}
            style={[st.tabBtn, tab === t.key && st.tabBtnActive]}
            onPress={() => setTab(t.key)}
          >
            <Text style={[st.tabTxt, tab === t.key && st.tabTxtActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      ) : rows.length === 0 ? (
        <View style={st.empty}>
          <ImageIcon size={44} color={C.textMuted} />
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

      {/* 사진 라이트박스 */}
      <Modal visible={!!lightbox} transparent animationType="fade" onRequestClose={() => setLightbox(null)}>
        <View style={st.lbBg}>
          <View style={[st.lbTop, { paddingTop: insets.top + 14 }]}>
            <Pressable onPress={() => setLightbox(null)} style={st.lbClose} hitSlop={10}>
              <X size={26} color="#fff" />
            </Pressable>
          </View>

          {lightbox && (
            <ExpoImage
              source={{ uri: photoFileUri(lightbox.file_url), headers: { Authorization: `Bearer ${token}` } }}
              style={st.lbImage}
              contentFit="contain"
            />
          )}

          {lightbox?.source_label ? (
            <Text style={st.lbSource}>{lightbox.source_label}</Text>
          ) : null}

          <View style={st.lbBtnRow}>
            <Pressable
              style={[st.lbBtn, { backgroundColor: C.tint }]}
              onPress={() => lightbox && downloadPhoto(lightbox)}
              disabled={lbSaving}
            >
              {lbSaving
                ? <ActivityIndicator color="#fff" size="small" />
                : <><Download size={16} color="#fff" /><Text style={st.lbBtnTxt}>다운로드</Text></>}
            </Pressable>
            {lightbox?.journal_id && (
              <Pressable
                style={[st.lbBtn, { backgroundColor: "#0F172A" }]}
                onPress={() => goToDiary(lightbox?.journal_id)}
              >
                <BookOpen size={16} color="#fff" />
                <Text style={st.lbBtnTxt}>해당 일지 보기</Text>
              </Pressable>
            )}
          </View>
        </View>
      </Modal>

      {/* 영상 상세 모달 */}
      <Modal visible={!!videoDetail} transparent animationType="slide" onRequestClose={() => setVideoDetail(null)}>
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
                  <Play size={36} color="#fff" fill="#fff" />
                </View>
              </View>
            ) : (
              <View style={[st.vdThumbWrap, st.vdThumbEmpty]}>
                <Video size={40} color="#64748B" />
                <Text style={st.vdThumbEmptyTxt}>썸네일 없음</Text>
              </View>
            )}

            {videoDetail?.source_label ? (
              <Text style={st.vdLabel}>{videoDetail.source_label}</Text>
            ) : null}

            <View style={st.vdBtnCol}>
              <Pressable
                style={[st.vdBtn, { backgroundColor: C.tint }]}
                onPress={() => videoDetail && downloadVideo(videoDetail)}
                disabled={vdSaving}
              >
                {vdSaving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <><Download size={16} color="#fff" /><Text style={st.vdBtnTxt}>영상 다운로드</Text></>}
              </Pressable>
              {videoDetail?.journal_id && (
                <Pressable
                  style={[st.vdBtn, { backgroundColor: "#0F172A" }]}
                  onPress={() => goToDiary(videoDetail?.journal_id)}
                >
                  <BookOpen size={16} color="#fff" />
                  <Text style={st.vdBtnTxt}>해당 일지 보기</Text>
                </Pressable>
              )}
              <Pressable style={[st.vdBtn, { backgroundColor: "#F1F5F9" }]} onPress={() => setVideoDetail(null)}>
                <Text style={[st.vdBtnTxt, { color: "#374151" }]}>닫기</Text>
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

  tabRow: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  tabBtn: { paddingHorizontal: 18, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#F8FAFC" },
  tabBtnActive: { borderColor: "#2EC4B6", backgroundColor: "#E6FFFA" },
  tabTxt: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B" },
  tabTxtActive: { color: "#2EC4B6" },

  monthHeader: { paddingHorizontal: 14, paddingTop: 18, paddingBottom: 8 },
  monthLabel: { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#0F172A" },

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
  emptySub: { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 20, color: "#64748B" },

  lbBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.96)", justifyContent: "center" },
  lbTop: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10, paddingHorizontal: 16, paddingBottom: 12 },
  lbClose: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  lbImage: { width: "100%", height: "60%" },
  lbSource: { color: "#E6FFFA", fontSize: 13, textAlign: "center", paddingHorizontal: 24, paddingTop: 16, fontFamily: "Pretendard-Regular" },
  lbBtnRow: { flexDirection: "row", gap: 10, paddingHorizontal: 20, paddingTop: 20, justifyContent: "center" },
  lbBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14 },
  lbBtnTxt: { color: "#fff", fontSize: 14, fontFamily: "Pretendard-Regular" },

  vdOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  vdSheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 14, gap: 16 },
  vdHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 4 },
  vdThumbWrap: { width: "100%", height: 200, borderRadius: 14, overflow: "hidden", backgroundColor: "#E2E8F0" },
  vdThumb: { width: "100%", height: "100%" },
  vdThumbEmpty: { alignItems: "center", justifyContent: "center", gap: 8 },
  vdThumbEmptyTxt: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B" },
  vdPlayOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.3)" },
  vdLabel: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#374151", textAlign: "center" },
  vdBtnCol: { gap: 10 },
  vdBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14 },
  vdBtnTxt: { color: "#fff", fontSize: 14, fontFamily: "Pretendard-Regular" },
});
