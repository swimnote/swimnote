/**
 * DiaryPhotoStrip — 일지 카드 안에 표시되는 사진+영상 썸네일 가로 스트립
 * - classGroupId + lessonDate 로 반 사진 로드
 * - diaryId 로 일지에 직접 첨부된 사진(앨범 선택) + 영상도 함께 표시
 * - 중복 제거 후 시간순 정렬
 */
import * as FileSystem from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import { Image } from "expo-image";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Modal, Pressable,
  ScrollView, StyleSheet, Text, ToastAndroid, View, Platform,
} from "react-native";
import { Download, ImageIcon, Play, X } from "lucide-react-native";
import { apiRequest, API_BASE } from "@/context/AuthContext";

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
}

export default function DiaryPhotoStrip({ token, classGroupId, lessonDate, diaryId }: Props) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewPhoto, setViewPhoto] = useState<Photo | null>(null);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const photoReq = apiRequest(token, `/photos/group/${classGroupId}?date=${lessonDate}`);
      const videoReq = diaryId
        ? fetch(`${API_BASE}/videos/diary/${diaryId}`, { headers: { Authorization: `Bearer ${token}` } })
            .then(r => r.ok ? r.json() : { videos: [] })
            .catch(() => ({ videos: [] }))
        : Promise.resolve({ videos: [] });

      const [photoRes, videoData] = await Promise.all([photoReq, videoReq]);

      if (photoRes.ok) {
        const data = await photoRes.json();
        setPhotos(Array.isArray(data) ? data : []);
      }
      setVideos(Array.isArray(videoData?.videos) ? videoData.videos : []);
    } catch (e) {
      console.error(`[DiaryPhotoStrip] catch:`, e);
    } finally {
      setLoading(false);
    }
  }, [token, classGroupId, lessonDate, diaryId]);

  useEffect(() => { load(); }, [load]);

  async function downloadPhoto(photo: Photo) {
    if (downloading) return;
    setDownloading(true);
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("권한 필요", "사진 저장을 위해 갤러리 접근 권한이 필요합니다.");
        return;
      }
      const rawUrl = photo.presigned_url ?? photo.file_url ?? "";
      const url = rawUrl.startsWith("http") ? rawUrl : (token ? `${BASE_ORIGIN}${rawUrl}?token=${token}` : `${BASE_ORIGIN}${rawUrl}`);
      const localPath = FileSystem.cacheDirectory + `diary_${photo.id}.jpg`;
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

  const thumbUrl = (photo: Photo) => {
    const url = photo.presigned_url ?? photo.file_url ?? "";
    if (url.startsWith("http")) return url;
    return token ? `${BASE_ORIGIN}${url}?token=${token}` : `${BASE_ORIGIN}${url}`;
  };

  const videoThumbUrl = (video: VideoItem): string | null => {
    if (video.thumbnail_presigned_url) return video.thumbnail_presigned_url;
    if (video.thumbnail_key) return `${BASE_ORIGIN}/api/videos/${video.id}/thumbnail?token=${token}`;
    return null;
  };

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
      <ImageIcon size={12} color="#CBD5E1" />
      <Text style={s.emptyText}>등록된 수업 사진이 없습니다</Text>
    </View>
  );

  return (
    <View style={s.container}>
      <View style={s.labelRow}>
        <ImageIcon size={12} color="#2EC4B6" />
        <Text style={s.label}>
          수업 미디어{photos.length > 0 ? ` 사진 ${photos.length}장` : ""}{videos.length > 0 ? ` 영상 ${videos.length}개` : ""}
        </Text>
        <Text style={s.labelHint}>· 탭하면 크게 볼 수 있어요</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.strip}
      >
        {/* 사진 썸네일 */}
        {photos.map((photo) => (
          <Pressable
            key={photo.id}
            onPress={() => setViewPhoto(photo)}
            style={({ pressed }) => [s.thumb, pressed && { opacity: 0.85 }]}
          >
            <Image
              source={{ uri: thumbUrl(photo) }}
              style={s.thumbImg}
              contentFit="cover"
            />
            <Pressable
              style={s.downloadOverlay}
              onPress={() => downloadPhoto(photo)}
              hitSlop={4}
            >
              <Download size={14} color="#fff" />
            </Pressable>
          </Pressable>
        ))}

        {/* 영상 썸네일 */}
        {videos.map((video) => {
          const tn = videoThumbUrl(video);
          return (
            <View key={video.id} style={[s.thumb, s.videoThumb]}>
              {tn ? (
                <Image source={{ uri: tn }} style={s.thumbImg} contentFit="cover" />
              ) : (
                <View style={s.videoPlaceholder} />
              )}
              <View style={s.videoPlayOverlay}>
                <Play size={22} color="#fff" fill="#fff" />
              </View>
              <View style={s.videoBadge}>
                <Play size={8} color="#fff" />
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* 사진 전체화면 모달 */}
      <Modal
        visible={!!viewPhoto}
        transparent
        animationType="fade"
        onRequestClose={() => setViewPhoto(null)}
      >
        <Pressable style={s.overlay} onPress={() => setViewPhoto(null)}>
          <View style={s.overlayCard}>
            <Pressable style={s.closeBtn} onPress={() => setViewPhoto(null)}>
              <X size={20} color="#fff" />
            </Pressable>
            {viewPhoto && (
              <>
                <Image
                  source={{ uri: thumbUrl(viewPhoto) }}
                  style={s.fullImg}
                  contentFit="contain"
                />
                <Pressable
                  style={[s.dlBtn, downloading && { opacity: 0.6 }]}
                  onPress={() => downloadPhoto(viewPhoto)}
                  disabled={downloading}
                >
                  {downloading
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Download size={16} color="#fff" />}
                  <Text style={s.dlBtnText}>
                    {downloading ? "저장 중..." : "갤러리에 저장"}
                  </Text>
                </Pressable>
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
  dlBtn: {
    position: "absolute", bottom: 16,
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: 20, paddingVertical: 12,
    borderRadius: 30, zIndex: 10,
  },
  dlBtnText: { color: "#fff", fontSize: 14, fontFamily: "Pretendard-Regular" },
});
