/**
 * DiaryPhotoStrip — 일지 카드 안에 표시되는 사진 썸네일 가로 스트립
 * classGroupId + lessonDate 로 해당 수업 사진을 불러와 표시
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Image, Modal, Pressable,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { X, ImageIcon } from "lucide-react-native";
import { apiRequest, API_BASE } from "@/context/AuthContext";

const BASE_ORIGIN = API_BASE.replace(/\/api$/, "");

interface Photo {
  id: string;
  file_url: string;
  caption?: string;
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

  const load = useCallback(async () => {
    try {
      const res = await apiRequest(
        token,
        `/photos/group/${classGroupId}?date=${lessonDate}`
      );
      if (res.ok) {
        const data = await res.json();
        setPhotos(Array.isArray(data) ? data : []);
      }
    } catch {}
    finally { setLoading(false); }
  }, [token, classGroupId, lessonDate]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <View style={s.loadingRow}>
        <ActivityIndicator size="small" color="#94A3B8" />
        <Text style={s.loadingText}>사진 불러오는 중...</Text>
      </View>
    );
  }

  if (!photos.length) return null;

  const thumbUrl = (photo: Photo) =>
    `${BASE_ORIGIN}${photo.file_url}`;

  return (
    <View style={s.container}>
      <View style={s.labelRow}>
        <ImageIcon size={12} color="#64748B" />
        <Text style={s.label}>수업 사진 {photos.length}장</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.strip}
      >
        {photos.map((photo) => (
          <Pressable key={photo.id} onPress={() => setViewPhoto(photo)} style={s.thumb}>
            <Image
              source={{
                uri: thumbUrl(photo),
                headers: token ? { Authorization: `Bearer ${token}` } : undefined,
              }}
              style={s.thumbImg}
              resizeMode="cover"
            />
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
          <Pressable style={s.overlayCard} onPress={e => e.stopPropagation?.()}>
            <Pressable style={s.closeBtn} onPress={() => setViewPhoto(null)}>
              <X size={20} color="#fff" />
            </Pressable>
            {viewPhoto && (
              <Image
                source={{
                  uri: thumbUrl(viewPhoto),
                  headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                }}
                style={s.fullImg}
                resizeMode="contain"
              />
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { marginTop: 10, gap: 6 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, paddingLeft: 14 },
  loadingText: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#94A3B8" },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 5, paddingLeft: 14 },
  label: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  strip: { paddingLeft: 14, paddingRight: 8, gap: 8, paddingBottom: 2 },
  thumb: {
    width: 80, height: 80, borderRadius: 10,
    overflow: "hidden", backgroundColor: "#F1F5F9",
  },
  thumbImg: { width: "100%", height: "100%" },
  overlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.85)",
    alignItems: "center", justifyContent: "center",
  },
  overlayCard: {
    width: "90%", maxWidth: 400,
    aspectRatio: 1, borderRadius: 18,
    overflow: "hidden", backgroundColor: "#000",
    position: "relative",
  },
  closeBtn: {
    position: "absolute", top: 10, right: 10, zIndex: 10,
    backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 20,
    width: 34, height: 34, alignItems: "center", justifyContent: "center",
  },
  fullImg: { width: "100%", height: "100%" },
});
