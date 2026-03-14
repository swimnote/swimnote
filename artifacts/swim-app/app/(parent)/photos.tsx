/**
 * (parent)/photos.tsx — 학부모: 사진첩
 *
 * 두 섹션:
 *  1) 반 전체 앨범 — 담당 선생님이 반 전체에 올린 사진
 *  2) 개인 앨범   — 내 아이에게만 올린 사진
 *
 * 그리드 기능:
 *  - 탭 → 라이트박스 미리보기
 *  - 롱프레스 → 선택 모드
 *  - 선택 모드: 다중 선택, 전체 선택, 일괄 다운로드
 */
import { Feather } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Dimensions, FlatList, Image, Modal,
  Platform, Pressable, RefreshControl, StyleSheet, Text, View,
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
const PHOTO_SIZE = (W - 12) / 3;   // 양쪽 padding 6, gap 3×2

function photoUri(fileUrl: string) {
  if (!fileUrl) return "";
  if (fileUrl.startsWith("http")) return fileUrl;
  return `${API_BASE.replace(/\/api$/, "")}${fileUrl}`;
}

function fmtDate(d?: string | null) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

export default function ParentPhotosScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const { id: studentId, name: studentName } = useLocalSearchParams<{ id: string; name: string }>();

  const [tab, setTab]           = useState<Tab>("group");
  const [albums, setAlbums]     = useState<ChildAlbum[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lightbox, setLightbox] = useState<Photo | null>(null);
  const [lbSaving, setLbSaving] = useState(false);

  // 선택 모드
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected]     = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);

  async function load() {
    try {
      const r = await apiRequest(token, "/photos/parent-view");
      const data = await safeJson(r);
      if (Array.isArray(data)) {
        const filtered = studentId
          ? (data as ChildAlbum[]).filter(a => a.student.id === studentId)
          : (data as ChildAlbum[]);
        setAlbums(filtered);
      }
    } finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { load(); }, [studentId]);

  // 탭/선택 모드 변경 시 선택 해제
  useEffect(() => { exitSelect(); }, [tab]);

  // 현재 탭 사진 (날짜순 정렬)
  const currentPhotos: Photo[] = albums.flatMap(a =>
    tab === "group" ? a.group_photos : a.private_photos
  ).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

  const groupCount   = albums.reduce((n, a) => n + a.group_photos.length, 0);
  const privateCount = albums.reduce((n, a) => n + a.private_photos.length, 0);

  // ── 선택 모드 ─────────────────────────────────────────────────────
  function exitSelect() { setSelectMode(false); setSelected(new Set()); }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === currentPhotos.length) setSelected(new Set());
    else setSelected(new Set(currentPhotos.map(p => p.id)));
  }

  function enterSelectWith(photo: Photo) {
    setSelectMode(true);
    setSelected(new Set([photo.id]));
  }

  // ── 단일 다운로드 (라이트박스) ───────────────────────────────────
  async function saveSingle(photo: Photo) {
    if (Platform.OS === "web") {
      const a = document.createElement("a");
      a.href = photoUri(photo.file_url);
      a.download = `swim_${photo.id}.jpg`;
      a.click();
      return;
    }
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== "granted") { Alert.alert("권한 필요", "갤러리 접근 권한이 필요합니다."); return; }
    setLbSaving(true);
    try {
      const localUri = `${FileSystem.documentDirectory}swim_${photo.id}.jpg`;
      await FileSystem.downloadAsync(photoUri(photo.file_url), localUri, { headers: { Authorization: `Bearer ${token}` } });
      await MediaLibrary.saveToLibraryAsync(localUri);
      Alert.alert("저장 완료", "갤러리에 저장했습니다.");
    } catch { Alert.alert("오류", "저장 중 오류가 발생했습니다."); }
    finally { setLbSaving(false); }
  }

  // ── 일괄 다운로드 ───────────────────────────────────────────────
  async function bulkDownload() {
    const targets = currentPhotos.filter(p => selected.has(p.id));
    if (!targets.length) return;

    if (Platform.OS === "web") {
      for (const p of targets) {
        const a = document.createElement("a");
        a.href = photoUri(p.file_url);
        a.download = `swim_${p.id}.jpg`;
        a.click();
        await new Promise(r => setTimeout(r, 200));
      }
      exitSelect();
      return;
    }

    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== "granted") { Alert.alert("권한 필요", "갤러리 접근 권한이 필요합니다."); return; }

    setBulkSaving(true);
    let saved = 0;
    try {
      for (const p of targets) {
        const localPath = `${FileSystem.documentDirectory}swim_${p.id}.jpg`;
        await FileSystem.downloadAsync(photoUri(p.file_url), localPath, { headers: { Authorization: `Bearer ${token}` } });
        await MediaLibrary.saveToLibraryAsync(localPath);
        saved++;
      }
      Alert.alert("저장 완료", `${saved}장이 갤러리에 저장됐습니다.`);
      exitSelect();
    } catch { Alert.alert("오류", `${saved}장 저장 후 오류가 발생했습니다.`); }
    finally { setBulkSaving(false); }
  }

  // ── 렌더 ────────────────────────────────────────────────────────
  return (
    <View style={[st.root, { backgroundColor: C.background }]}>
      {/* 헤더 */}
      <View style={[st.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <Pressable onPress={() => router.back()} style={st.backBtn}>
          <Feather name="chevron-left" size={24} color={C.text} />
        </Pressable>
        <Text style={[st.headerTitle, { color: C.text }]}>
          {studentName ? `${studentName} 사진첩` : "사진첩"}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {/* 탭 */}
      <View style={[st.tabBar, { borderBottomColor: C.border }]}>
        {(["group", "private"] as Tab[]).map(t => {
          const isActive = tab === t;
          const count = t === "group" ? groupCount : privateCount;
          return (
            <Pressable key={t} onPress={() => setTab(t)} style={[st.tabItem, isActive && st.tabItemActive]}>
              <Feather name={t === "group" ? "users" : "lock"} size={15} color={isActive ? C.tint : C.textSecondary} />
              <Text style={[st.tabText, { color: isActive ? C.tint : C.textSecondary }]}>
                {t === "group" ? "반 전체 앨범" : "개인 앨범"}
              </Text>
              {count > 0 && (
                <View style={[st.badge, { backgroundColor: isActive ? C.tint : "#9CA3AF" }]}>
                  <Text style={st.badgeText}>{count}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      {/* 설명 배너 */}
      <View style={[st.banner, { backgroundColor: tab === "group" ? "#FFF7ED" : "#EFF6FF" }]}>
        <Feather name={tab === "group" ? "info" : "shield"} size={13} color={tab === "group" ? "#D97706" : "#2563EB"} />
        <Text style={[st.bannerText, { color: tab === "group" ? "#92400E" : "#1E40AF" }]}>
          {tab === "group" ? "선생님이 반 전체에 공유한 수업 사진입니다." : "선생님이 우리 아이에게만 올린 개인 사진입니다."}
        </Text>
      </View>

      {/* 선택 모드 툴바 */}
      {selectMode && (
        <View style={st.toolbar}>
          <Pressable onPress={toggleAll} style={st.toolbarLeft}>
            <Feather
              name={selected.size === currentPhotos.length ? "check-square" : "square"}
              size={18} color={C.tint}
            />
            <Text style={[st.toolbarToggleText, { color: C.tint }]}>
              {selected.size === currentPhotos.length ? "전체 해제" : "전체 선택"}
            </Text>
          </Pressable>
          <Text style={st.toolbarCount}>{selected.size}장 선택</Text>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Pressable
              onPress={bulkDownload}
              disabled={selected.size === 0 || bulkSaving}
              style={[st.toolbarAction, { backgroundColor: C.tint, opacity: selected.size === 0 ? 0.4 : 1 }]}
            >
              {bulkSaving
                ? <ActivityIndicator color="#fff" size="small" />
                : <><Feather name="download" size={14} color="#fff" /><Text style={st.toolbarActionText}>받기</Text></>
              }
            </Pressable>
            <Pressable onPress={exitSelect} style={st.toolbarCancel}>
              <Text style={st.toolbarCancelText}>취소</Text>
            </Pressable>
          </View>
        </View>
      )}

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
          ListHeaderComponent={
            currentPhotos.length > 0 && !selectMode ? (
              <Pressable onPress={() => setSelectMode(true)} style={st.selectBtn}>
                <Feather name="check-square" size={15} color={C.tint} />
                <Text style={[st.selectBtnText, { color: C.tint }]}>선택</Text>
              </Pressable>
            ) : null
          }
          ListEmptyComponent={
            <View style={st.empty}>
              <Text style={st.emptyEmoji}>{tab === "group" ? "📸" : "🔒"}</Text>
              <Text style={[st.emptyTitle, { color: C.text }]}>
                {tab === "group" ? "반 전체 사진이 없습니다" : "개인 사진이 없습니다"}
              </Text>
              <Text style={[st.emptySub, { color: C.textSecondary }]}>
                {tab === "group"
                  ? "선생님이 수업 사진을 올리면 여기에 표시됩니다."
                  : "선생님이 개인 사진을 올리면 여기에 표시됩니다."}
              </Text>
            </View>
          }
          renderItem={({ item: p }) => {
            const isSelected = selected.has(p.id);
            return (
              <Pressable
                onPress={() => selectMode ? toggleSelect(p.id) : setLightbox(p)}
                onLongPress={() => { if (!selectMode) enterSelectWith(p); }}
                style={[st.photoCell, isSelected && st.photoCellSelected, { width: PHOTO_SIZE, height: PHOTO_SIZE }]}
              >
                <Image
                  source={{ uri: photoUri(p.file_url), headers: { Authorization: `Bearer ${token}` } }}
                  style={st.thumbnail}
                  resizeMode="cover"
                />
                {/* 날짜 오버레이 */}
                {p.created_at && (
                  <View style={st.dateOverlay}>
                    <Text style={st.dateText}>{fmtDate(p.created_at)}</Text>
                  </View>
                )}
                {/* 선택 체크 */}
                {selectMode && (
                  <View style={[st.checkCircle, isSelected && { backgroundColor: C.tint, borderColor: C.tint }]}>
                    {isSelected && <Feather name="check" size={12} color="#fff" />}
                  </View>
                )}
                {/* 캡션 */}
                {p.caption && !selectMode ? (
                  <View style={st.captionBar}>
                    <Text style={st.captionText} numberOfLines={1}>{p.caption}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          }}
        />
      )}

      {/* 라이트박스 */}
      <Modal visible={!!lightbox} transparent animationType="fade" onRequestClose={() => setLightbox(null)}>
        <View style={st.lightbox}>
          <View style={[st.lbHeader, { paddingTop: insets.top + 12 }]}>
            <Pressable onPress={() => setLightbox(null)} style={st.lbClose}>
              <Feather name="x" size={26} color="#fff" />
            </Pressable>
            <Pressable
              onPress={() => lightbox && saveSingle(lightbox)}
              disabled={lbSaving}
              style={[st.lbSave, { opacity: lbSaving ? 0.6 : 1 }]}
            >
              {lbSaving
                ? <ActivityIndicator color="#fff" size="small" />
                : <><Feather name="download" size={18} color="#fff" /><Text style={st.lbSaveText}>저장</Text></>
              }
            </Pressable>
          </View>
          {lightbox && (
            <Image
              source={{ uri: photoUri(lightbox.file_url), headers: { Authorization: `Bearer ${token}` } }}
              style={st.fullImage}
              resizeMode="contain"
            />
          )}
          {lightbox?.caption ? <Text style={st.lbCaption}>{lightbox.caption}</Text> : null}
          <Text style={st.lbMeta}>
            {lightbox?.uploader_name ? `선생님: ${lightbox.uploader_name}  ` : ""}
            {fmtDate(lightbox?.created_at)}
          </Text>
        </View>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 10, backgroundColor: "#fff",
  },
  backBtn:     { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },

  tabBar:     { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1 },
  tabItem:    { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12 },
  tabItemActive: { borderBottomWidth: 2, borderBottomColor: "#1A5CFF" },
  tabText:    { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  badge:      { minWidth: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  badgeText:  { color: "#fff", fontSize: 11, fontFamily: "Inter_700Bold" },

  banner:     { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 14, paddingVertical: 8 },
  bannerText: { fontSize: 12, fontFamily: "Inter_400Regular" },

  // 선택 모드 툴바
  toolbar:           { flexDirection: "row", alignItems: "center", backgroundColor: "#F9FAFB", paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#E5E7EB", gap: 4 },
  toolbarLeft:       { flexDirection: "row", alignItems: "center", gap: 5 },
  toolbarToggleText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  toolbarCount:      { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", textAlign: "center" },
  toolbarAction:     { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  toolbarActionText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  toolbarCancel:     { paddingHorizontal: 8, paddingVertical: 7 },
  toolbarCancelText: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#6B7280" },

  // 그리드 상단 선택 버튼
  selectBtn:     { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-end", paddingHorizontal: 12, paddingVertical: 6, marginBottom: 4 },
  selectBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },

  // 사진 셀
  photoCell:         { borderRadius: 4, overflow: "hidden", backgroundColor: "#F3F4F6", margin: 0 },
  photoCellSelected: { borderWidth: 3, borderColor: "#1A5CFF" },
  thumbnail:         { width: "100%", height: "100%" },
  dateOverlay:       { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.38)", paddingHorizontal: 5, paddingVertical: 3 },
  dateText:          { color: "#fff", fontSize: 10, fontFamily: "Inter_400Regular" },
  checkCircle:       { position: "absolute", top: 5, right: 5, width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#fff", backgroundColor: "rgba(255,255,255,0.3)", alignItems: "center", justifyContent: "center" },
  captionBar:        { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.45)", paddingHorizontal: 5, paddingVertical: 3 },
  captionText:       { color: "#fff", fontSize: 10, fontFamily: "Inter_400Regular" },

  // 빈 화면
  empty:      { alignItems: "center", paddingTop: 80, gap: 10, paddingHorizontal: 28 },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  emptySub:   { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },

  // 라이트박스
  lightbox: { flex: 1, backgroundColor: "rgba(0,0,0,0.96)", justifyContent: "center" },
  lbHeader: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingBottom: 12 },
  lbClose:  { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  lbSave:   { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.18)", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  lbSaveText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  fullImage:  { width: "100%", height: "65%" },
  lbCaption:  { color: "#fff", fontSize: 14, textAlign: "center", paddingHorizontal: 24, paddingTop: 16, fontFamily: "Inter_400Regular" },
  lbMeta:     { color: "rgba(255,255,255,0.5)", fontSize: 12, textAlign: "center", paddingTop: 6, fontFamily: "Inter_400Regular" },
});
