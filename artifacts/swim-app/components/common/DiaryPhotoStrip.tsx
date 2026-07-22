/**
 * DiaryPhotoStrip — 일지 카드 안에 표시되는 사진+영상 썸네일 가로 스트립
 * - classGroupId + lessonDate 로 반 사진 로드
 * - diaryId 로 일지에 직접 첨부된 사진(앨범 선택) + 영상도 함께 표시
 * - 중복 제거 후 시간순 정렬
 * - 사진 뷰어: 좌우 스와이프 / 이전·다음 버튼 / 이 사진만 다운 / 전체 다운
 */
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import { Image } from "expo-image";
import React, { useCallback, useRef, useState } from "react";
import { LucideIcon } from "@/components/common/LucideIcon";
import {
  ActivityIndicator, Alert, Dimensions, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, ToastAndroid, View,
} from "react-native";
import { apiRequest, API_BASE } from "@/context/AuthContext";
import { useQuery } from "@tanstack/react-query";

const SCREEN_W = Dimensions.get("window").width;
const BASE_ORIGIN = API_BASE.replace(/\/api$/, "");

interface Photo {
  id: string;
  file_url: string;
  presigned_url?: string;
  lesson_date?: string;
}

interface VideoItem {
  id: string;
  file_url: string;
  thumbnail_key?: string;
  thumbnail_presigned_url?: string;
  presigned_url?: string;
  caption?: string;
}

interface Props {
  token: string | null;
  classGroupId: string;
  lessonDate: string;
  diaryId?: string;
  studentId?: string;
  parentMode?: boolean;
}

export default function DiaryPhotoStrip({ token, classGroupId, lessonDate, diaryId, studentId, parentMode }: Props) {
  // 사진 뷰어: null = 닫힘, 숫자 = 현재 인덱스
  const [viewIdx, setViewIdx] = useState<number | null>(null);
  const [viewVideo, setViewVideo] = useState<VideoItem | null>(null);

  const [downloading, setDownloading] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadingVideo, setDownloadingVideo] = useState(false);

  const photoScrollRef = useRef<ScrollView>(null);

  // ── React Query: 사진 + 영상 통합 조회 ──────────────────────────────────
  const fetchMedia = useCallback(async () => {
    // 학부모 모드: diaryId 기준 /parent/diary/:diaryId/photos 사용
    if (parentMode && diaryId) {
      const [photoRes, videoData] = await Promise.all([
        apiRequest(token, `/parent/diary/${diaryId}/photos`),
        fetch(`${API_BASE}/videos/diary/${diaryId}`, { headers: { Authorization: `Bearer ${token}` } })
          .then(r => r.ok ? r.json() : { videos: [] })
          .catch(() => ({ videos: [] })),
      ]);
      let photos: Photo[] = [];
      if (photoRes?.ok) {
        const data = await photoRes.json();
        const allPhotos: Photo[] = [...(data.common ?? []), ...(data.individual ?? [])];
        photos = allPhotos.map(p => ({
          ...p,
          file_url: p.file_url?.startsWith("/photos/") ? `/api${p.file_url}` : (p.file_url ?? ""),
        }));
      }
      return { photos, videos: Array.isArray(videoData?.videos) ? videoData.videos : [] };
    }

    // 선생님 모드: classGroupId + lessonDate 기반
    const groupPhotoReq = apiRequest(token, `/photos/group/${classGroupId}?date=${lessonDate}`);
    const privatePhotoReq = studentId
      ? apiRequest(token, `/photos/private/${studentId}?date=${lessonDate}`)
      : Promise.resolve(null);
    const videoReq = diaryId
      ? fetch(`${API_BASE}/videos/diary/${diaryId}`, { headers: { Authorization: `Bearer ${token}` } })
          .then(r => r.ok ? r.json() : { videos: [] })
          .catch(() => ({ videos: [] }))
      : Promise.resolve({ videos: [] });

    const [groupRes, privateRes, videoData] = await Promise.all([groupPhotoReq, privatePhotoReq, videoReq]);

    const groupPhotos: Photo[] = groupRes?.ok ? (await groupRes.json()) : [];
    const privatePhotos: Photo[] = privateRes?.ok ? (await privateRes.json()) : [];

    const seen = new Set<string>();
    const merged: Photo[] = [];
    for (const p of [...(Array.isArray(groupPhotos) ? groupPhotos : []), ...(Array.isArray(privatePhotos) ? privatePhotos : [])]) {
      if (!seen.has(p.id)) { seen.add(p.id); merged.push(p); }
    }
    return { photos: merged, videos: Array.isArray(videoData?.videos) ? videoData.videos : [] };
  }, [token, classGroupId, lessonDate, diaryId, studentId, parentMode]);

  const { data, isLoading } = useQuery({
    queryKey: ["diary-media", diaryId ?? `${classGroupId}_${lessonDate}`, studentId, parentMode],
    queryFn: fetchMedia,
    enabled: !!(token && (classGroupId || (parentMode && diaryId))),
    staleTime: 30_000,
  });

  const photos = data?.photos ?? [];
  const videos = data?.videos ?? [];
  const loading = isLoading;

  // ── URL 헬퍼 ──────────────────────────────────────────────────────────
  const photoUrl = (photo: Photo) => {
    const url = photo.presigned_url ?? photo.file_url ?? "";
    if (url.startsWith("http")) return url;
    return token ? `${BASE_ORIGIN}${url}?token=${token}` : `${BASE_ORIGIN}${url}`;
  };

  const videoThumbUrl = (video: VideoItem): string | null => {
    if (video.thumbnail_presigned_url) return video.thumbnail_presigned_url;
    if (video.thumbnail_key) return `${BASE_ORIGIN}/api/videos/${video.id}/thumbnail?token=${token}`;
    return null;
  };

  // ── 사진 1장 다운로드 ──────────────────────────────────────────────────
  async function downloadPhoto(photo: Photo) {
    if (downloading) return;
    setDownloading(true);
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("권한 필요", "사진 저장을 위해 갤러리 접근 권한이 필요합니다.");
        return;
      }
      const url = photoUrl(photo);
      const localPath = (FileSystem.documentDirectory ?? "") + `diary_${photo.id}.jpg`;
      const dl = await FileSystem.downloadAsync(url, localPath);
      if (dl.status !== 200) throw new Error("다운로드 실패");
      await MediaLibrary.saveToLibraryAsync(dl.uri);
      if (Platform.OS === "android") {
        ToastAndroid.show("갤러리에 저장되었습니다 📸", ToastAndroid.SHORT);
      } else {
        Alert.alert("저장 완료", "사진이 갤러리에 저장되었습니다.");
      }
    } catch {
      Alert.alert("오류", "사진 저장에 실패했습니다.");
    } finally {
      setDownloading(false);
    }
  }

  // ── 전체 사진 다운로드 ────────────────────────────────────────────────
  async function downloadAllPhotos() {
    if (downloadingAll || photos.length === 0) return;
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("권한 필요", "갤러리 접근 권한이 필요합니다.");
      return;
    }
    setDownloadingAll(true);
    setDownloadProgress(0);
    let success = 0;
    for (let i = 0; i < photos.length; i++) {
      try {
        const photo = photos[i];
        const url = photoUrl(photo);
        const localPath = (FileSystem.documentDirectory ?? "") + `diary_all_${photo.id}.jpg`;
        const dl = await FileSystem.downloadAsync(url, localPath);
        if (dl.status === 200) {
          await MediaLibrary.saveToLibraryAsync(dl.uri);
          success++;
        }
      } catch {}
      setDownloadProgress(i + 1);
    }
    setDownloadingAll(false);
    if (Platform.OS === "android") {
      ToastAndroid.show(`${success}장 저장 완료 📸`, ToastAndroid.SHORT);
    } else {
      Alert.alert("저장 완료", `${success}장이 갤러리에 저장되었습니다.`);
    }
  }

  // ── 영상 다운로드 ────────────────────────────────────────────────────
  async function downloadVideo(video: VideoItem) {
    if (downloadingVideo) return;
    setDownloadingVideo(true);
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("권한 필요", "영상 저장을 위해 갤러리 접근 권한이 필요합니다.");
        return;
      }
      const finalUrl = video.presigned_url
        ?? (() => {
          const raw = video.file_url ?? "";
          return raw.startsWith("http") ? raw : `${BASE_ORIGIN}${raw}`;
        })();
      if (!finalUrl) throw new Error("URL 확인 실패");

      const ext = finalUrl.split("?")[0].split(".").pop()?.toLowerCase() ?? "mp4";
      const localPath = (FileSystem.documentDirectory ?? "") + `diary_video_${video.id}.${ext}`;

      const headers: Record<string, string> = video.presigned_url
        ? {}
        : { Authorization: `Bearer ${token}` };
      const dl = await FileSystem.downloadAsync(finalUrl, localPath, { headers });
      if (dl.status !== 200) throw new Error(`다운로드 실패 (${dl.status})`);

      await MediaLibrary.saveToLibraryAsync(dl.uri);

      if (Platform.OS === "android") {
        ToastAndroid.show("영상이 갤러리에 저장되었습니다 🎥", ToastAndroid.SHORT);
      } else {
        Alert.alert("저장 완료", "영상이 갤러리에 저장되었습니다.");
      }
    } catch (e: any) {
      console.warn("[DiaryPhotoStrip] video download error:", e);
      Alert.alert("오류", "영상 저장에 실패했습니다.");
    } finally {
      setDownloadingVideo(false);
    }
  }

  // ── 뷰어 네비게이션 ───────────────────────────────────────────────────
  function openViewer(idx: number) {
    setViewIdx(idx);
    setTimeout(() => {
      photoScrollRef.current?.scrollTo({ x: idx * SCREEN_W, animated: false });
    }, 50);
  }

  function goPrev() {
    if (viewIdx === null || viewIdx <= 0) return;
    const next = viewIdx - 1;
    setViewIdx(next);
    photoScrollRef.current?.scrollTo({ x: next * SCREEN_W, animated: true });
  }

  function goNext() {
    if (viewIdx === null || viewIdx >= photos.length - 1) return;
    const next = viewIdx + 1;
    setViewIdx(next);
    photoScrollRef.current?.scrollTo({ x: next * SCREEN_W, animated: true });
  }

  const totalCount = photos.length + videos.length;

  if (loading) {
    return (
      <View style={s.loadingRow}>
        <ActivityIndicator size="small" color="#94A3B8" />
        <Text style={s.loadingText}>사진/영상 불러오는 중...</Text>
      </View>
    );
  }

  if (totalCount === 0) return (
    <View style={s.emptyRow}>
      <LucideIcon name="image" size={12} color="#CBD5E1" />
      <Text style={s.emptyText}>등록된 수업 사진이 없습니다</Text>
    </View>
  );

  return (
    <View style={s.container}>
      <View style={s.labelRow}>
        <LucideIcon name="image" size={12} color="#2EC4B6" />
        <Text style={s.label}>
          수업 미디어{photos.length > 0 ? ` 사진 ${photos.length}장` : ""}{videos.length > 0 ? ` 영상 ${videos.length}개` : ""}
        </Text>
        <Text style={s.labelHint}>· 탭하면 크게 볼 수 있어요</Text>
        {photos.length > 1 && (
          <Pressable
            style={s.allDlBtn}
            onPress={downloadAllPhotos}
            disabled={downloadingAll}
            hitSlop={6}
          >
            {downloadingAll ? (
              <Text style={s.allDlBtnTxt}>저장 {downloadProgress}/{photos.length}</Text>
            ) : (
              <>
                <LucideIcon name="upload-cloud" size={10} color="#2EC4B6" />
                <Text style={s.allDlBtnTxt}>전체 저장</Text>
              </>
            )}
          </Pressable>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.strip}
      >
        {/* 사진 썸네일 */}
        {photos.map((photo, idx) => (
          <Pressable
            key={photo.id}
            onPress={() => openViewer(idx)}
            style={({ pressed }) => [s.thumb, pressed && { opacity: 0.85 }]}
          >
            <Image
              source={{ uri: photoUrl(photo) }}
              style={s.thumbImg}
              contentFit="cover"
            />
            <Pressable
              style={s.downloadOverlay}
              onPress={() => downloadPhoto(photo)}
              hitSlop={4}
            >
              <LucideIcon name="upload-cloud" size={14} color="#fff" />
            </Pressable>
          </Pressable>
        ))}

        {/* 영상 썸네일 */}
        {videos.map((video) => {
          const tn = videoThumbUrl(video);
          return (
            <Pressable
              key={video.id}
              style={({ pressed }) => [s.thumb, s.videoThumb, pressed && { opacity: 0.85 }]}
              onPress={() => setViewVideo(video)}
            >
              {tn ? (
                <Image source={{ uri: tn }} style={s.thumbImg} contentFit="cover" />
              ) : (
                <View style={s.videoPlaceholder} />
              )}
              <View style={s.videoPlayOverlay}>
                <LucideIcon name="play" size={22} color="#fff" fill="#fff" />
              </View>
              <View style={s.downloadOverlay}>
                <LucideIcon name="upload-cloud" size={14} color="#fff" />
              </View>
              <View style={s.videoBadge}>
                <LucideIcon name="play" size={8} color="#fff" />
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* ── 사진 전체화면 뷰어 (스와이프 가능) ── */}
      <Modal
        visible={viewIdx !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setViewIdx(null)}
        statusBarTranslucent
      >
        <View style={s.viewerBg}>
          {/* 헤더: 닫기 + 카운터 */}
          <View style={s.viewerHeader}>
            <Pressable style={s.viewerCloseBtn} onPress={() => setViewIdx(null)} hitSlop={8}>
              <LucideIcon name="x" size={22} color="#fff" />
            </Pressable>
            <Text style={s.viewerCounter}>
              {viewIdx !== null ? `${viewIdx + 1} / ${photos.length}` : ""}
            </Text>
          </View>

          {/* 사진 스와이프 영역 */}
          <ScrollView
            ref={photoScrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onMomentumScrollEnd={e => {
              setViewIdx(prev => {
                if (prev === null) return null; // 닫히는 중이면 재오픈 방지
                const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
                return Math.max(0, Math.min(idx, photos.length - 1));
              });
            }}
            style={{ flex: 1 }}
            contentContainerStyle={{ alignItems: "center" }}
          >
            {photos.map((photo) => (
              <View key={photo.id} style={s.viewerPage}>
                <Image
                  source={{ uri: photoUrl(photo) }}
                  style={s.viewerImg}
                  contentFit="contain"
                />
              </View>
            ))}
          </ScrollView>

          {/* 이전/다음 화살표 버튼 */}
          {viewIdx !== null && viewIdx > 0 && (
            <Pressable style={[s.navBtn, s.navBtnLeft]} onPress={goPrev} hitSlop={8}>
              <LucideIcon name="chevron-left" size={28} color="#fff" />
            </Pressable>
          )}
          {viewIdx !== null && viewIdx < photos.length - 1 && (
            <Pressable style={[s.navBtn, s.navBtnRight]} onPress={goNext} hitSlop={8}>
              <LucideIcon name="chevron-right" size={28} color="#fff" />
            </Pressable>
          )}

          {/* 하단 다운로드 버튼 */}
          {viewIdx !== null && (
            <View style={s.viewerFooter}>
              <Pressable
                style={[s.dlBtn, downloading && { opacity: 0.6 }]}
                onPress={() => downloadPhoto(photos[viewIdx])}
                disabled={downloading || downloadingAll}
              >
                {downloading
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <LucideIcon name="upload-cloud" size={15} color="#fff" />}
                <Text style={s.dlBtnText}>{downloading ? "저장 중..." : "이 사진만 저장"}</Text>
              </Pressable>

              {photos.length > 1 && (
                <Pressable
                  style={[s.dlBtnAll, (downloadingAll || downloading) && { opacity: 0.6 }]}
                  onPress={downloadAllPhotos}
                  disabled={downloading || downloadingAll}
                >
                  {downloadingAll ? (
                    <>
                      <ActivityIndicator size="small" color="#fff" />
                      <Text style={s.dlBtnText}>{downloadProgress}/{photos.length} 저장 중...</Text>
                    </>
                  ) : (
                    <>
                      <LucideIcon name="upload-cloud" size={15} color="#fff" />
                      <Text style={s.dlBtnText}>전체 {photos.length}장 저장</Text>
                    </>
                  )}
                </Pressable>
              )}
            </View>
          )}
        </View>
      </Modal>

      {/* ── 영상 전체화면 모달 ── */}
      <Modal
        visible={!!viewVideo}
        transparent
        animationType="fade"
        onRequestClose={() => setViewVideo(null)}
        statusBarTranslucent
      >
        <Pressable style={s.overlay} onPress={() => setViewVideo(null)}>
          <View style={s.overlayCard}>
            <Pressable style={s.closeBtn} onPress={() => setViewVideo(null)}>
              <LucideIcon name="x" size={20} color="#fff" />
            </Pressable>
            {viewVideo && (
              <>
                {videoThumbUrl(viewVideo) ? (
                  <Image
                    source={{ uri: videoThumbUrl(viewVideo)! }}
                    style={s.fullImg}
                    contentFit="contain"
                  />
                ) : (
                  <View style={[s.fullImg, { backgroundColor: "#0F172A", alignItems: "center", justifyContent: "center" }]}>
                    <LucideIcon name="play" size={52} color="rgba(255,255,255,0.5)" fill="rgba(255,255,255,0.5)" />
                  </View>
                )}
                <View style={s.videoModalPlayIcon} pointerEvents="none">
                  <LucideIcon name="play" size={42} color="#fff" fill="#fff" />
                </View>
                <Pressable
                  style={[s.dlBtn, { bottom: 16 }, downloadingVideo && { opacity: 0.6 }]}
                  onPress={(e) => { e.stopPropagation?.(); downloadVideo(viewVideo); }}
                  disabled={downloadingVideo}
                >
                  {downloadingVideo
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <LucideIcon name="upload-cloud" size={16} color="#fff" />}
                  <Text style={s.dlBtnText}>
                    {downloadingVideo ? "저장 중..." : "영상 다운로드"}
                  </Text>
                </Pressable>
                {viewVideo.caption ? (
                  <Text style={s.videoCaption}>{viewVideo.caption}</Text>
                ) : null}
              </>
            )}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { marginTop: 10, gap: 6 },
  loadingRow: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: 8, paddingLeft: 14,
  },
  loadingText: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#94A3B8" },
  emptyRow: {
    flexDirection: "row", alignItems: "center", gap: 5,
    marginTop: 8, paddingLeft: 14,
  },
  emptyText: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#CBD5E1" },
  labelRow: {
    flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 14,
  },
  label: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#2EC4B6" },
  labelHint: { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#94A3B8" },
  allDlBtn: {
    flexDirection: "row", alignItems: "center", gap: 3,
    marginLeft: 6, paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: 8, borderWidth: 1, borderColor: "#2EC4B6",
  },
  allDlBtnTxt: { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#2EC4B6" },
  strip: { paddingLeft: 14, paddingRight: 8, gap: 8, paddingBottom: 4 },
  thumb: {
    width: 88, height: 88, borderRadius: 12,
    overflow: "hidden", backgroundColor: "#F1F5F9",
    position: "relative",
  },
  thumbImg: { width: "100%", height: "100%" },
  downloadOverlay: {
    position: "absolute", bottom: 5, right: 5,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 8, padding: 5,
  },
  videoThumb: { backgroundColor: "#1E293B" },
  videoPlaceholder: { width: "100%", height: "100%", backgroundColor: "#1E293B" },
  videoPlayOverlay: {
    position: "absolute", inset: 0,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  videoBadge: {
    position: "absolute", bottom: 5, left: 5,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center", justifyContent: "center",
  },

  // ── 사진 뷰어 ──
  viewerBg: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
  },
  viewerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: Platform.OS === "ios" ? 56 : 36,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  viewerCloseBtn: {
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 20,
    width: 40, height: 40,
    alignItems: "center", justifyContent: "center",
  },
  viewerCounter: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 15,
    fontFamily: "Pretendard-Regular",
  },
  viewerPage: {
    width: SCREEN_W,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  viewerImg: {
    width: SCREEN_W,
    height: SCREEN_W,
  },
  navBtn: {
    position: "absolute",
    top: "50%",
    marginTop: -28,
    width: 44, height: 56,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
    borderRadius: 12,
  },
  navBtnLeft: { left: 8 },
  navBtnRight: { right: 8 },
  viewerFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingBottom: Platform.OS === "ios" ? 40 : 24,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  dlBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 16, paddingVertical: 12,
    borderRadius: 30,
  },
  dlBtnAll: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#2EC4B6",
    paddingHorizontal: 16, paddingVertical: 12,
    borderRadius: 30,
  },
  dlBtnText: { color: "#fff", fontSize: 14, fontFamily: "Pretendard-Regular" },

  // ── 영상 뷰어 ──
  overlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.9)",
    alignItems: "center", justifyContent: "center",
  },
  overlayCard: {
    width: "92%", maxWidth: 420,
    borderRadius: 20, overflow: "hidden",
    backgroundColor: "#111",
    aspectRatio: 1,
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtn: {
    position: "absolute", top: 12, right: 12, zIndex: 10,
    backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 20,
    width: 36, height: 36, alignItems: "center", justifyContent: "center",
  },
  fullImg: { width: "100%", height: "100%" },
  videoModalPlayIcon: {
    position: "absolute", inset: 0,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  videoCaption: {
    position: "absolute", bottom: 64,
    color: "rgba(255,255,255,0.7)", fontSize: 12,
    fontFamily: "Pretendard-Regular", textAlign: "center",
    paddingHorizontal: 20,
  },
});
