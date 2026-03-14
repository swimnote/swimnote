/**
 * (parent)/photos.tsx — 학부모: 사진첩
 *
 * 두 섹션:
 *  1) 반 전체 앨범 — 담당 선생님이 반 전체에 올린 사진
 *  2) 개인 앨범   — 내 아이에게만 올린 사진
 *
 * 백엔드가 권한을 강제: 다른 반/아이 사진 API 요청 시 403 반환.
 */
import { Feather } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Dimensions, FlatList, Image, Modal,
  Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, safeJson, useAuth } from "@/context/AuthContext";

type Tab = "group" | "private";

interface Photo {
  id: string;
  file_url: string;
  album_type?: string;
  caption?: string | null;
  uploader_name?: string | null;
  created_at?: string | null;
  student_name?: string | null;
}

interface ChildAlbum {
  student: { id: string; name: string; class_id?: string | null; class_name?: string | null };
  group_photos: Photo[];
  private_photos: Photo[];
}

const C = Colors.light;
const API_BASE = process.env.EXPO_PUBLIC_API_URL || "/api";
const { width: W } = Dimensions.get("window");
const PHOTO_SIZE = (W - 48) / 3;

function photoUri(fileUrl: string) {
  if (fileUrl.startsWith("http")) return fileUrl;
  const base = API_BASE.replace(/\/api$/, "");
  return `${base}${fileUrl}`;
}

function fmtDate(d?: string | null) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

export default function ParentPhotosScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const { id: studentId, name: studentName } = useLocalSearchParams<{ id: string; name: string }>();

  const [tab, setTab]             = useState<Tab>("group");
  const [albums, setAlbums]       = useState<ChildAlbum[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lightbox, setLightbox]   = useState<Photo | null>(null);
  const [saving, setSaving]       = useState(false);

  async function load() {
    try {
      const r = await apiRequest(token, "/photos/parent-view");
      const data = await safeJson(r);
      if (Array.isArray(data)) {
        // 특정 학생이 지정된 경우 해당 학생만 필터
        const filtered = studentId
          ? (data as ChildAlbum[]).filter(a => a.student.id === studentId)
          : (data as ChildAlbum[]);
        setAlbums(filtered);
      }
    } finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { load(); }, [studentId]);

  // 현재 탭에 표시할 사진 (모든 자녀 합산)
  const currentPhotos: Photo[] = albums.flatMap(a =>
    tab === "group" ? a.group_photos : a.private_photos
  ).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

  async function saveSingle(photo: Photo) {
    if (Platform.OS === "web") {
      const a = document.createElement("a");
      a.href = photoUri(photo.file_url);
      a.download = "photo.jpg";
      a.click();
      return;
    }
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== "granted") { Alert.alert("권한 필요", "갤러리 접근 권한이 필요합니다."); return; }
    setSaving(true);
    try {
      const filename = `swim_${photo.id}.jpg`;
      const localUri = `${FileSystem.documentDirectory}${filename}`;
      await FileSystem.downloadAsync(
        photoUri(photo.file_url),
        localUri,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      await MediaLibrary.saveToLibraryAsync(localUri);
      Alert.alert("저장 완료", "갤러리에 저장했습니다.");
    } catch { Alert.alert("오류", "저장 중 오류가 발생했습니다."); }
    finally { setSaving(false); }
  }

  // 통계 뱃지
  const groupCount   = albums.reduce((n, a) => n + a.group_photos.length, 0);
  const privateCount = albums.reduce((n, a) => n + a.private_photos.length, 0);

  return (
    <View style={[styles.root, { backgroundColor: C.background }]}>
      {/* 헤더 */}
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="chevron-left" size={24} color={C.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: C.text }]}>
          {studentName ? `${studentName} 사진첩` : "사진첩"}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {/* 탭 */}
      <View style={[styles.tabBar, { borderBottomColor: C.border }]}>
        <Pressable onPress={() => setTab("group")} style={[styles.tabItem, tab === "group" && styles.tabItemActive]}>
          <Feather name="users" size={15} color={tab === "group" ? C.tint : C.textSecondary} />
          <Text style={[styles.tabText, { color: tab === "group" ? C.tint : C.textSecondary }]}>
            반 전체 앨범
          </Text>
          {groupCount > 0 && (
            <View style={[styles.badge, { backgroundColor: tab === "group" ? C.tint : "#9CA3AF" }]}>
              <Text style={styles.badgeText}>{groupCount}</Text>
            </View>
          )}
        </Pressable>
        <Pressable onPress={() => setTab("private")} style={[styles.tabItem, tab === "private" && styles.tabItemActive]}>
          <Feather name="lock" size={15} color={tab === "private" ? C.tint : C.textSecondary} />
          <Text style={[styles.tabText, { color: tab === "private" ? C.tint : C.textSecondary }]}>
            개인 앨범
          </Text>
          {privateCount > 0 && (
            <View style={[styles.badge, { backgroundColor: tab === "private" ? C.tint : "#9CA3AF" }]}>
              <Text style={styles.badgeText}>{privateCount}</Text>
            </View>
          )}
        </Pressable>
      </View>

      {/* 설명 배너 */}
      <View style={[styles.banner, { backgroundColor: tab === "group" ? "#FFF7ED" : "#EFF6FF" }]}>
        <Feather
          name={tab === "group" ? "info" : "shield"}
          size={13}
          color={tab === "group" ? "#D97706" : "#2563EB"}
        />
        <Text style={[styles.bannerText, { color: tab === "group" ? "#92400E" : "#1E40AF" }]}>
          {tab === "group"
            ? "선생님이 반 전체에 공유한 수업 사진입니다."
            : "선생님이 우리 아이에게만 올린 개인 사진입니다."}
        </Text>
      </View>

      {/* 사진 그리드 */}
      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={currentPhotos}
          keyExtractor={p => p.id}
          numColumns={3}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
          }
          contentContainerStyle={{ padding: 6, gap: 3, paddingBottom: insets.bottom + 100 }}
          columnWrapperStyle={{ gap: 3 }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>{tab === "group" ? "📸" : "🔒"}</Text>
              <Text style={[styles.emptyTitle, { color: C.text }]}>
                {tab === "group" ? "반 전체 사진이 없습니다" : "개인 사진이 없습니다"}
              </Text>
              <Text style={[styles.emptySub, { color: C.textSecondary }]}>
                {tab === "group"
                  ? "선생님이 수업 사진을 올리면 여기에 표시됩니다."
                  : "선생님이 개인 사진을 올리면 여기에 표시됩니다."}
              </Text>
            </View>
          }
          renderItem={({ item: p }) => (
            <Pressable onPress={() => setLightbox(p)} style={styles.photoCell}>
              <Image
                source={{ uri: photoUri(p.file_url), headers: { Authorization: `Bearer ${token}` } }}
                style={[styles.thumbnail, { width: PHOTO_SIZE, height: PHOTO_SIZE }]}
                resizeMode="cover"
              />
              {p.caption ? (
                <View style={styles.captionBar}>
                  <Text style={styles.captionText} numberOfLines={1}>{p.caption}</Text>
                </View>
              ) : null}
            </Pressable>
          )}
        />
      )}

      {/* 라이트박스 */}
      <Modal visible={!!lightbox} transparent animationType="fade" onRequestClose={() => setLightbox(null)}>
        <View style={styles.lightbox}>
          <View style={[styles.lbHeader, { paddingTop: insets.top + 12 }]}>
            <Pressable onPress={() => setLightbox(null)} style={styles.lbClose}>
              <Feather name="x" size={26} color="#fff" />
            </Pressable>
            <Pressable
              onPress={() => lightbox && saveSingle(lightbox)}
              disabled={saving}
              style={[styles.lbSave, { opacity: saving ? 0.6 : 1 }]}
            >
              {saving
                ? <ActivityIndicator color="#fff" size="small" />
                : <><Feather name="download" size={18} color="#fff" /><Text style={styles.lbSaveText}>저장</Text></>
              }
            </Pressable>
          </View>
          {lightbox && (
            <Image
              source={{ uri: photoUri(lightbox.file_url), headers: { Authorization: `Bearer ${token}` } }}
              style={styles.fullImage}
              resizeMode="contain"
            />
          )}
          {lightbox?.caption ? (
            <Text style={styles.lbCaption}>{lightbox.caption}</Text>
          ) : null}
          <Text style={styles.lbMeta}>
            {lightbox?.uploader_name ? `선생님: ${lightbox.uploader_name}  ` : ""}
            {fmtDate(lightbox?.created_at)}
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
    paddingHorizontal: 16, paddingBottom: 10, backgroundColor: "#fff",
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },

  tabBar: { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1 },
  tabItem: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 12,
  },
  tabItemActive: { borderBottomWidth: 2, borderBottomColor: "#1A5CFF" },
  tabText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  badge: {
    minWidth: 20, height: 20, borderRadius: 10,
    alignItems: "center", justifyContent: "center", paddingHorizontal: 5,
  },
  badgeText: { color: "#fff", fontSize: 11, fontFamily: "Inter_700Bold" },

  banner: {
    flexDirection: "row", alignItems: "center", gap: 7,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  bannerText: { fontSize: 12, fontFamily: "Inter_400Regular" },

  photoCell: { flex: 1 / 3, borderRadius: 4, overflow: "hidden", backgroundColor: "#F3F4F6" },
  thumbnail:  {},
  captionBar: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.45)", paddingHorizontal: 5, paddingVertical: 3 },
  captionText: { color: "#fff", fontSize: 10, fontFamily: "Inter_400Regular" },

  empty: { alignItems: "center", paddingTop: 80, gap: 10, paddingHorizontal: 28 },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  emptySub:   { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },

  lightbox:  { flex: 1, backgroundColor: "rgba(0,0,0,0.96)", justifyContent: "center" },
  lbHeader:  {
    position: "absolute", top: 0, left: 0, right: 0, zIndex: 10,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 20, paddingBottom: 12,
  },
  lbClose:   { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  lbSave:    {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(255,255,255,0.18)", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
  },
  lbSaveText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  fullImage:  { width: "100%", height: "65%" },
  lbCaption:  { color: "#fff", fontSize: 14, textAlign: "center", paddingHorizontal: 24, paddingTop: 16, fontFamily: "Inter_400Regular" },
  lbMeta:     { color: "rgba(255,255,255,0.5)", fontSize: 12, textAlign: "center", paddingTop: 6, fontFamily: "Inter_400Regular" },
});
