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
  id: string;
  storage_key: string;
  caption?: string | null;
  uploader_name: string;
  created_at: string;
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
  const [lightbox, setLightbox] = useState<Photo | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);

  async function fetchPhotos() {
    try {
      const res = await apiRequest(token, `/students/${id}/photos`);
      if (res.ok) {
        const data = await res.json();
        // 최신순 정렬 (created_at 내림차순)
        const sorted = [...(Array.isArray(data) ? data : [])].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        setPhotos(sorted);
      }
    } finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { fetchPhotos(); }, [id]);

  function toggleSelect(photoId: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId); else next.add(photoId);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === photos.length) setSelected(new Set());
    else setSelected(new Set(photos.map(p => p.id)));
  }

  async function requestMediaPermission(): Promise<boolean> {
    if (Platform.OS === "web") return true;
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("권한 필요", "사진 저장을 위해 갤러리 접근 권한이 필요합니다.");
      return false;
    }
    return true;
  }

  async function downloadSingle(photo: Photo) {
    if (Platform.OS === "web") {
      const a = document.createElement("a");
      a.href = photoUrl(photo.storage_key);
      a.download = photo.storage_key.split("/").pop() || "photo.jpg";
      a.click();
      return;
    }
    if (!(await requestMediaPermission())) return;
    setDownloading(true);
    try {
      const filename = photo.storage_key.split("/").pop() || `photo_${Date.now()}.jpg`;
      const localUri = `${FileSystem.documentDirectory}${filename}`;
      await FileSystem.downloadAsync(photoUrl(photo.storage_key), localUri);
      await MediaLibrary.saveToLibraryAsync(localUri);
      Alert.alert("저장 완료", "사진이 갤러리에 저장되었습니다.");
    } catch { Alert.alert("오류", "다운로드 중 오류가 발생했습니다."); }
    finally { setDownloading(false); }
  }

  async function downloadSelected() {
    const targets = photos.filter(p => selected.has(p.id));
    if (targets.length === 0) return;
    if (Platform.OS === "web") {
      for (const p of targets) {
        const a = document.createElement("a");
        a.href = photoUrl(p.storage_key);
        a.download = p.storage_key.split("/").pop() || "photo.jpg";
        a.click();
        await new Promise(r => setTimeout(r, 300));
      }
      return;
    }
    if (!(await requestMediaPermission())) return;
    setDownloading(true);
    let saved = 0;
    try {
      for (const p of targets) {
        const filename = p.storage_key.split("/").pop() || `photo_${Date.now()}.jpg`;
        const localUri = `${FileSystem.documentDirectory}${filename}`;
        await FileSystem.downloadAsync(photoUrl(p.storage_key), localUri);
        await MediaLibrary.saveToLibraryAsync(localUri);
        saved++;
      }
      Alert.alert("저장 완료", `${saved}장의 사진이 갤러리에 저장되었습니다.`);
      setSelectMode(false);
      setSelected(new Set());
    } catch { Alert.alert("오류", `${saved}장 저장 후 오류가 발생했습니다.`); }
    finally { setDownloading(false); }
  }

  function handleCardPress(photo: Photo) {
    if (selectMode) {
      toggleSelect(photo.id);
    } else {
      setLightbox(photo);
    }
  }

  function handleCardLongPress(photo: Photo) {
    if (!selectMode) {
      setSelectMode(true);
      setSelected(new Set([photo.id]));
    }
  }

  const ITEM_SIZE = (Platform.OS === "web" ? 360 : 160);

  return (
    <View style={[styles.root, { backgroundColor: C.background }]}>
      {/* 헤더 */}
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <Pressable onPress={() => { router.back(); }} style={styles.backBtn}>
          <Feather name="chevron-left" size={24} color={C.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: C.text }]}>{name} 사진첩</Text>
        {selectMode ? (
          <Pressable onPress={() => { setSelectMode(false); setSelected(new Set()); }} style={styles.cancelBtn}>
            <Text style={[styles.cancelText, { color: C.tint }]}>취소</Text>
          </Pressable>
        ) : (
          photos.length > 0 ? (
            <Pressable onPress={() => setSelectMode(true)} style={styles.selectBtn}>
              <Feather name="check-square" size={20} color={C.tint} />
            </Pressable>
          ) : <View style={{ width: 40 }} />
        )}
      </View>

      {/* 선택 모드 툴바 */}
      {selectMode && (
        <View style={[styles.toolbar, { backgroundColor: C.card, borderBottomColor: C.border }]}>
          <Pressable onPress={toggleSelectAll} style={styles.toolbarBtn}>
            <Feather name={selected.size === photos.length ? "check-square" : "square"} size={18} color={C.tint} />
            <Text style={[styles.toolbarText, { color: C.tint }]}>
              {selected.size === photos.length ? "전체 해제" : "전체 선택"}
            </Text>
          </Pressable>
          <Text style={[styles.selectedCount, { color: C.textSecondary }]}>{selected.size}장 선택</Text>
          <Pressable
            onPress={downloadSelected}
            disabled={selected.size === 0 || downloading}
            style={[styles.downloadBtn, { backgroundColor: selected.size > 0 ? C.tint : C.border, opacity: downloading ? 0.6 : 1 }]}
          >
            {downloading
              ? <ActivityIndicator color="#fff" size="small" />
              : <><Feather name="download" size={16} color="#fff" /><Text style={styles.downloadBtnText}>저장 ({selected.size})</Text></>
            }
          </Pressable>
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={photos}
          keyExtractor={p => p.id}
          numColumns={2}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchPhotos(); }} />}
          contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: insets.bottom + 100 }}
          columnWrapperStyle={{ gap: 10 }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>📷</Text>
              <Text style={[styles.emptyTitle, { color: C.text }]}>사진이 없습니다</Text>
              <Text style={[styles.emptySub, { color: C.textSecondary }]}>선생님이 수업 사진을 올리면 여기에 표시됩니다</Text>
            </View>
          }
          renderItem={({ item: p }) => {
            const isSelected = selected.has(p.id);
            return (
              <Pressable
                style={[styles.photoCard, isSelected && { borderWidth: 3, borderColor: C.tint }]}
                onPress={() => handleCardPress(p)}
                onLongPress={() => handleCardLongPress(p)}
              >
                <Image source={{ uri: photoUrl(p.storage_key) }} style={styles.thumbnail} resizeMode="cover" />
                {selectMode && (
                  <View style={[styles.checkOverlay, isSelected && { backgroundColor: C.tint }]}>
                    {isSelected && <Feather name="check" size={14} color="#fff" />}
                  </View>
                )}
                <View style={styles.photoMeta}>
                  {p.caption ? <Text style={[styles.caption, { color: C.text }]} numberOfLines={1}>{p.caption}</Text> : null}
                  <Text style={[styles.metaDate, { color: C.textMuted }]}>
                    {new Date(p.created_at).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      {/* 라이트박스 */}
      <Modal visible={!!lightbox} transparent animationType="fade" onRequestClose={() => setLightbox(null)}>
        <View style={styles.lightbox}>
          <View style={[styles.lightboxHeader, { paddingTop: insets.top + 12 }]}>
            <Pressable onPress={() => setLightbox(null)} style={styles.lightboxClose}>
              <Feather name="x" size={26} color="#fff" />
            </Pressable>
            {lightbox && (
              <Pressable
                onPress={() => downloadSingle(lightbox)}
                disabled={downloading}
                style={[styles.lightboxDownload, { opacity: downloading ? 0.6 : 1 }]}
              >
                {downloading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <><Feather name="download" size={18} color="#fff" /><Text style={styles.lightboxDownloadText}>저장</Text></>
                }
              </Pressable>
            )}
          </View>
          {lightbox && (
            <Image source={{ uri: photoUrl(lightbox.storage_key) }} style={styles.fullImage} resizeMode="contain" />
          )}
          {lightbox?.caption ? (
            <Text style={styles.lightboxCaption}>{lightbox.caption}</Text>
          ) : null}
          <Text style={styles.lightboxDate}>
            {lightbox ? new Date(lightbox.created_at).toLocaleDateString("ko-KR") : ""}
          </Text>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 10,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  selectBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  cancelBtn: { paddingHorizontal: 12, height: 40, alignItems: "center", justifyContent: "center" },
  cancelText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },

  toolbar: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10,
    gap: 12, borderBottomWidth: 1,
  },
  toolbarBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  toolbarText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  selectedCount: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  downloadBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
  },
  downloadBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },

  photoCard: { flex: 1, borderRadius: 14, overflow: "hidden", backgroundColor: "#f0f0f0" },
  thumbnail: { width: "100%", aspectRatio: 1 },
  checkOverlay: {
    position: "absolute", top: 8, right: 8,
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 2, borderColor: "#fff",
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.3)",
  },
  photoMeta: { padding: 8, gap: 2 },
  caption: { fontSize: 12, fontFamily: "Inter_500Medium" },
  metaDate: { fontSize: 11, fontFamily: "Inter_400Regular" },

  empty: { alignItems: "center", justifyContent: "center", paddingTop: 100, gap: 12, paddingHorizontal: 20 },
  emptyEmoji: { fontSize: 52 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptySub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },

  lightbox: { flex: 1, backgroundColor: "rgba(0,0,0,0.96)", justifyContent: "center" },
  lightboxHeader: {
    position: "absolute", top: 0, left: 0, right: 0, zIndex: 10,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 20, paddingBottom: 12,
  },
  lightboxClose: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  lightboxDownload: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(255,255,255,0.18)", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
  },
  lightboxDownloadText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  fullImage: { width: "100%", height: "65%" },
  lightboxCaption: { color: "#fff", fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", paddingHorizontal: 24, paddingTop: 16 },
  lightboxDate: { color: "rgba(255,255,255,0.5)", fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", paddingTop: 6 },
});
