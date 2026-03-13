import { Feather } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Image, Modal,
  Platform, Pressable, RefreshControl, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

interface Photo {
  id: string; storage_key: string; caption?: string | null;
  uploader_name: string; created_at: string;
}

const C = Colors.light;
const API_BASE = process.env.EXPO_PUBLIC_API_URL || "";

function photoUrl(key: string) {
  return `${API_BASE}/api/uploads/${encodeURIComponent(key)}`;
}

export default function PhotosScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();

  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Photo | null>(null);
  const [downloading, setDownloading] = useState(false);

  async function fetchPhotos() {
    try {
      const res = await apiRequest(token, `/students/${id}/photos`);
      if (res.ok) setPhotos(await res.json());
    } finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { fetchPhotos(); }, [id]);

  async function handleDownload(photo: Photo) {
    if (Platform.OS === "web") {
      const a = document.createElement("a");
      a.href = photoUrl(photo.storage_key);
      a.download = photo.storage_key.split("/").pop() || "photo.jpg";
      a.click();
      return;
    }
    setDownloading(true);
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== "granted") { Alert.alert("권한 필요", "사진 저장을 위해 갤러리 접근 권한이 필요합니다."); return; }
      const filename = photo.storage_key.split("/").pop() || `photo_${Date.now()}.jpg`;
      const localUri = FileSystem.documentDirectory + filename;
      await FileSystem.downloadAsync(photoUrl(photo.storage_key), localUri);
      await MediaLibrary.saveToLibraryAsync(localUri);
      Alert.alert("저장 완료", "사진이 갤러리에 저장되었습니다.");
    } catch { Alert.alert("오류", "다운로드 중 오류가 발생했습니다."); }
    finally { setDownloading(false); }
  }

  const numCols = 2;

  return (
    <View style={[styles.root, { backgroundColor: C.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="chevron-left" size={24} color={C.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: C.text }]}>{name} 사진첩</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} /> : (
        <FlatList
          data={photos}
          keyExtractor={p => p.id}
          numColumns={numCols}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchPhotos(); }} />}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 100, gap: 12, paddingTop: 8 }}
          columnWrapperStyle={{ gap: 12 }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="image" size={52} color={C.textMuted} />
              <Text style={[styles.emptyTitle, { color: C.text }]}>사진이 없습니다</Text>
              <Text style={[styles.emptySub, { color: C.textSecondary }]}>선생님이 수업 사진을 업로드하면 여기에 표시됩니다</Text>
            </View>
          }
          renderItem={({ item: p }) => (
            <Pressable
              style={[styles.photoCard, { backgroundColor: C.card }]}
              onPress={() => setSelected(p)}
            >
              <Image source={{ uri: photoUrl(p.storage_key) }} style={styles.thumbnail} resizeMode="cover" />
              {p.caption ? (
                <Text style={[styles.caption, { color: C.textSecondary }]} numberOfLines={1}>{p.caption}</Text>
              ) : null}
              <Text style={[styles.uploadMeta, { color: C.textMuted }]}>
                {new Date(p.created_at).toLocaleDateString("ko-KR")}
              </Text>
            </Pressable>
          )}
        />
      )}

      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <View style={styles.lightbox}>
          <View style={[styles.lightboxHeader, { paddingTop: insets.top + 12 }]}>
            <Pressable onPress={() => setSelected(null)} style={styles.lightboxClose}>
              <Feather name="x" size={24} color="#fff" />
            </Pressable>
            {selected && (
              <Pressable
                style={[styles.downloadBtn, { opacity: downloading ? 0.6 : 1 }]}
                onPress={() => handleDownload(selected)}
                disabled={downloading}
              >
                {downloading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <><Feather name="download" size={18} color="#fff" /><Text style={styles.downloadText}>저장</Text></>}
              </Pressable>
            )}
          </View>
          {selected && (
            <Image
              source={{ uri: photoUrl(selected.storage_key) }}
              style={styles.fullImage}
              resizeMode="contain"
            />
          )}
          {selected?.caption ? (
            <Text style={styles.lightboxCaption}>{selected.caption}</Text>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  photoCard: { flex: 1, borderRadius: 14, overflow: "hidden", gap: 6, paddingBottom: 10 },
  thumbnail: { width: "100%", aspectRatio: 1, borderRadius: 14 },
  caption: { fontSize: 12, fontFamily: "Inter_400Regular", paddingHorizontal: 8 },
  uploadMeta: { fontSize: 11, fontFamily: "Inter_400Regular", paddingHorizontal: 8 },
  empty: { alignItems: "center", justifyContent: "center", paddingTop: 100, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptySub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20, paddingHorizontal: 20 },
  lightbox: { flex: 1, backgroundColor: "rgba(0,0,0,0.95)", justifyContent: "center" },
  lightboxHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingBottom: 16, position: "absolute", top: 0, left: 0, right: 0, zIndex: 10 },
  lightboxClose: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  downloadBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.2)", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  downloadText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  fullImage: { width: "100%", height: "70%" },
  lightboxCaption: { color: "#fff", fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", paddingHorizontal: 20, paddingTop: 16 },
});
