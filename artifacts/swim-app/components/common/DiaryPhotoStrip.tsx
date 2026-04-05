/**
 * DiaryPhotoStrip — 일지 카드 안에 표시되는 사진 썸네일 가로 스트립
 * - classGroupId + lessonDate 로 해당 수업 사진을 불러와 표시
 * - 썸네일 탭 → 전체화면 모달 + 갤러리 저장 버튼
 */
import * as FileSystem from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Image, Modal, Pressable,
  ScrollView, StyleSheet, Text, ToastAndroid, View, Platform,
} from "react-native";
import { Download, ImageIcon, X } from "lucide-react-native";
import { apiRequest, API_BASE } from "@/context/AuthContext";

const BASE_ORIGIN = API_BASE.replace(/\/api$/, "");

interface Photo {
  id: string;
  file_url: string;
  lesson_date?: string;
}

interface Props {
  token: string | null;
  classGroupId: string;
  lessonDate: string;
}

export default function DiaryPhotoStrip({ token, classGroupId, lessonDate }: Props) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewPhoto, setViewPhoto] = useState<Photo | null>(null);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest(
        token,
        `/photos/group/${classGroupId}?date=${lessonDate}`
      );
      console.log(`[DiaryPhotoStrip] class=${classGroupId?.substr(0,12)} date=${lessonDate} status=${res.status}`);
      if (res.ok) {
        const data = await res.json();
        console.log(`[DiaryPhotoStrip] photos=${Array.isArray(data) ? data.length : 'not-array'}`);
        setPhotos(Array.isArray(data) ? data : []);
      } else {
        const err = await res.text().catch(() => '');
        console.error(`[DiaryPhotoStrip] error: ${err}`);
      }
    } catch (e) {
      console.error(`[DiaryPhotoStrip] catch:`, e);
    }
    finally { setLoading(false); }
  }, [token, classGroupId, lessonDate]);

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
      const url = `${BASE_ORIGIN}${photo.file_url}`;
      const ext = "jpg";
      const localPath = FileSystem.cacheDirectory + `diary_${photo.id}.${ext}`;
      const dl = await FileSystem.downloadAsync(url, localPath, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (dl.status !== 200) throw new Error("다운로드 실패");
      await MediaLibrary.saveToLibraryAsync(dl.uri);
      if (Platform.OS === "android") {
        ToastAndroid.show("갤러리에 저장되었습니다 📸", ToastAndroid.SHORT);
      } else {
        Alert.alert("저장 완료", "사진이 갤러리에 저장되었습니다.");
      }
    } catch (e) {
      Alert.alert("오류", "사진 저장에 실패했습니다.");
    } finally {
      setDownloading(false);
    }
  }

  const thumbUrl = (photo: Photo) => `${BASE_ORIGIN}${photo.file_url}`;

  if (loading) {
    return (
      <View style={s.loadingRow}>
        <ActivityIndicator size="small" color="#94A3B8" />
        <Text style={s.loadingText}>사진 불러오는 중...</Text>
      </View>
    );
  }

  if (!photos.length) return null;

  return (
    <View style={s.container}>
      <View style={s.labelRow}>
        <ImageIcon size={12} color="#2EC4B6" />
        <Text style={s.label}>수업 사진 {photos.length}장</Text>
        <Text style={s.labelHint}>· 탭하면 크게 볼 수 있어요</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.strip}
      >
        {photos.map((photo) => (
          <Pressable
            key={photo.id}
            onPress={() => setViewPhoto(photo)}
            style={({ pressed }) => [s.thumb, pressed && { opacity: 0.85 }]}
          >
            <Image
              source={{
                uri: thumbUrl(photo),
                headers: token ? { Authorization: `Bearer ${token}` } : undefined,
              }}
              style={s.thumbImg}
              resizeMode="cover"
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
      </ScrollView>

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
                  source={{
                    uri: thumbUrl(viewPhoto),
                    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                  }}
                  style={s.fullImg}
                  resizeMode="contain"
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
  dlBtnText: {
    color: "#fff", fontSize: 14,
    fontFamily: "Pretendard-Regular",
  },
});
