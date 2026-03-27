/**
 * (parent)/photos.tsx — 학부모: 사진첩
 *
 * - 반 전체 사진 + 개별 사진 통합 (탭 없음)
 * - 각 사진마다 출처 표시 (어느 일지/경로에서 왔는지)
 * - 최신순 정렬
 * - 사진 탭 → 라이트박스 (이 사진 다운로드 / 전체 다운로드)
 * - 롱프레스 → 선택 모드 다중 다운로드
 */
import { Feather } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Dimensions, FlatList, Image, Modal,
  Platform, Pressable, RefreshControl, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { ParentScreenHeader } from "@/components/parent/ParentScreenHeader";
import { apiRequest, safeJson, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";

interface Photo {
  id: string;
  file_url: string;
  album_type?: string;
  source_label?: string | null;
  caption?: string | null;
  uploader_name?: string | null;
  created_at?: string | null;
  student_name?: string | null;
}

const C = Colors.light;
const API_BASE = process.env.EXPO_PUBLIC_API_URL || "/api";
const { width: W } = Dimensions.get("window");
const PHOTO_SIZE = (W - 12) / 3;

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
  const { id: paramId, name: paramName } = useLocalSearchParams<{ id: string; name: string }>();
  const { selectedStudent } = useParent();

  const [photos, setPhotos]         = useState<Photo[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lightbox, setLightbox]     = useState<Photo | null>(null);
  const [lbSaving, setLbSaving]     = useState(false);
  const [allSaving, setAllSaving]   = useState(false);

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected]     = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [saveErrorMsg,   setSaveErrorMsg]   = useState<string | null>(null);

  async function load() {
    try {
      const r = await apiRequest(token, "/photos/parent-view");
      const data = await safeJson(r);
      let photoList: Photo[] = [];
      if (data && Array.isArray(data.photos)) {
        photoList = data.photos;
      } else if (Array.isArray(data)) {
        // legacy format: ChildAlbum[]
        photoList = (data as any[]).flatMap(a => [
          ...(a.group_photos || []),
          ...(a.private_photos || []),
        ]);
      }
      // Filter by selected student if provided
      const studentId = paramId || selectedStudent?.id;
      if (studentId) {
        // For group photos: keep all (they belong to the class)
        // For private photos: keep only this student's
        photoList = photoList.filter(p =>
          p.album_type === "group" || p.student_name === (paramName || selectedStudent?.name) || (p as any).student_id === studentId
        );
      }
      setPhotos(photoList);
    } finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { load(); }, [paramId, selectedStudent?.id]);

  function exitSelect() { setSelectMode(false); setSelected(new Set()); }
  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    if (selected.size === photos.length) setSelected(new Set());
    else setSelected(new Set(photos.map(p => p.id)));
  }

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
      setSaveSuccessMsg("갤러리에 저장했습니다.");
    } catch { setSaveErrorMsg("저장 중 오류가 발생했습니다."); }
    finally { setLbSaving(false); }
  }

  async function saveAll() {
    if (Platform.OS === "web") {
      for (const p of photos) {
        const a = document.createElement("a");
        a.href = photoUri(p.file_url);
        a.download = `swim_${p.id}.jpg`;
        a.click();
        await new Promise(r => setTimeout(r, 200));
      }
      return;
    }
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== "granted") { Alert.alert("권한 필요", "갤러리 접근 권한이 필요합니다."); return; }
    setAllSaving(true);
    let saved = 0;
    try {
      for (const p of photos) {
        const lp = `${FileSystem.documentDirectory}swim_${p.id}.jpg`;
        await FileSystem.downloadAsync(photoUri(p.file_url), lp, { headers: { Authorization: `Bearer ${token}` } });
        await MediaLibrary.saveToLibraryAsync(lp);
        saved++;
      }
      setSaveSuccessMsg(`${saved}장 전체 저장됐습니다.`);
    } catch { setSaveErrorMsg(`${saved}장 저장 후 오류가 발생했습니다.`); }
    finally { setAllSaving(false); setLightbox(null); }
  }

  async function bulkDownload() {
    const targets = photos.filter(p => selected.has(p.id));
    if (!targets.length) return;
    if (Platform.OS === "web") {
      for (const p of targets) {
        const a = document.createElement("a");
        a.href = photoUri(p.file_url);
        a.download = `swim_${p.id}.jpg`;
        a.click();
        await new Promise(r => setTimeout(r, 200));
      }
      exitSelect(); return;
    }
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== "granted") { Alert.alert("권한 필요", "갤러리 접근 권한이 필요합니다."); return; }
    setBulkSaving(true);
    let saved = 0;
    try {
      for (const p of targets) {
        const lp = `${FileSystem.documentDirectory}swim_${p.id}.jpg`;
        await FileSystem.downloadAsync(photoUri(p.file_url), lp, { headers: { Authorization: `Bearer ${token}` } });
        await MediaLibrary.saveToLibraryAsync(lp);
        saved++;
      }
      setSaveSuccessMsg(`${saved}장이 갤러리에 저장됐습니다.`);
      exitSelect();
    } catch { setSaveErrorMsg(`${saved}장 저장 후 오류가 발생했습니다.`); }
    finally { setBulkSaving(false); }
  }

  const studentName = paramName || selectedStudent?.name;

  return (
    <View style={[st.root, { backgroundColor: C.background }]}>
      <ParentScreenHeader title={studentName ? `${studentName} 사진첩` : "사진첩"} />

      {/* 선택 모드 툴바 */}
      {selectMode && (
        <View style={st.toolbar}>
          <Pressable onPress={toggleAll} style={st.toolbarLeft}>
            <Feather name={selected.size === photos.length ? "check-square" : "square"} size={18} color={C.tint} />
            <Text style={[st.toolbarToggleText, { color: C.tint }]}>
              {selected.size === photos.length ? "전체 해제" : "전체 선택"}
            </Text>
          </Pressable>
          <Text style={st.toolbarCount}>{selected.size}장 선택</Text>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Pressable onPress={bulkDownload} disabled={selected.size === 0 || bulkSaving}
              style={[st.toolbarAction, { backgroundColor: C.button, opacity: selected.size === 0 ? 0.4 : 1 }]}>
              {bulkSaving
                ? <ActivityIndicator color="#fff" size="small" />
                : <><Feather name="download" size={14} color="#fff" /><Text style={st.toolbarActionText}>받기</Text></>}
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
          data={photos}
          keyExtractor={p => p.id}
          numColumns={3}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          contentContainerStyle={{ padding: 6, gap: 3, paddingBottom: insets.bottom + 100 }}
          columnWrapperStyle={{ gap: 3 }}
          ListHeaderComponent={
            photos.length > 0 && !selectMode ? (
              <Pressable onPress={() => setSelectMode(true)} style={st.selectBtn}>
                <Feather name="check-square" size={15} color={C.tint} />
                <Text style={[st.selectBtnText, { color: C.tint }]}>선택</Text>
              </Pressable>
            ) : null
          }
          ListEmptyComponent={
            <View style={st.empty}>
              <Text style={st.emptyEmoji}>📸</Text>
              <Text style={[st.emptyTitle, { color: C.text }]}>사진이 없습니다</Text>
              <Text style={[st.emptySub, { color: C.textSecondary }]}>
                선생님이 수업 사진을 올리면 여기에 표시됩니다.
              </Text>
            </View>
          }
          renderItem={({ item: p }) => {
            const isSelected = selected.has(p.id);
            const label = p.source_label || p.caption || "";
            return (
              <Pressable
                onPress={() => selectMode ? toggleSelect(p.id) : setLightbox(p)}
                onLongPress={() => { if (!selectMode) { setSelectMode(true); setSelected(new Set([p.id])); } }}
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
                {/* 출처 라벨 */}
                {label ? (
                  <View style={st.sourceBar}>
                    <Text style={st.sourceText} numberOfLines={1}>{label}</Text>
                  </View>
                ) : null}
                {/* 선택 체크 */}
                {selectMode && (
                  <View style={[st.checkCircle, isSelected && { backgroundColor: C.tint, borderColor: C.tint }]}>
                    {isSelected && <Feather name="check" size={12} color="#fff" />}
                  </View>
                )}
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
          </View>
          {lightbox && (
            <Image
              source={{ uri: photoUri(lightbox.file_url), headers: { Authorization: `Bearer ${token}` } }}
              style={st.fullImage}
              resizeMode="contain"
            />
          )}
          {/* 출처 & 메타 */}
          {(lightbox?.source_label || lightbox?.caption) && (
            <Text style={st.lbSource}>{lightbox.source_label || lightbox.caption}</Text>
          )}
          <Text style={st.lbMeta}>
            {lightbox?.uploader_name ? `선생님: ${lightbox.uploader_name}  ` : ""}
            {fmtDate(lightbox?.created_at)}
          </Text>
          {/* 다운로드 버튼 */}
          <View style={st.lbBtnRow}>
            <Pressable
              onPress={() => lightbox && saveSingle(lightbox)}
              disabled={lbSaving}
              style={[st.lbBtn, { backgroundColor: C.button }]}
            >
              {lbSaving
                ? <ActivityIndicator color="#fff" size="small" />
                : <><Feather name="download" size={16} color="#fff" /><Text style={st.lbBtnText}>이 사진 다운로드</Text></>}
            </Pressable>
            <Pressable
              onPress={saveAll}
              disabled={allSaving}
              style={[st.lbBtn, { backgroundColor: "#111827" }]}
            >
              {allSaving
                ? <ActivityIndicator color="#fff" size="small" />
                : <><Feather name="download-cloud" size={16} color="#fff" /><Text style={st.lbBtnText}>전체 다운로드 ({photos.length})</Text></>}
            </Pressable>
          </View>
        </View>
      </Modal>

      <ConfirmModal visible={!!saveSuccessMsg} title="저장 완료" message={saveSuccessMsg ?? ""}
        confirmText="확인" onConfirm={() => setSaveSuccessMsg(null)} />
      <ConfirmModal visible={!!saveErrorMsg} title="오류" message={saveErrorMsg ?? ""}
        confirmText="확인" onConfirm={() => setSaveErrorMsg(null)} />
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1 },

  toolbar: { flexDirection: "row", alignItems: "center", backgroundColor: "#F1F5F9", paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#E5E7EB", gap: 4 },
  toolbarLeft: { flexDirection: "row", alignItems: "center", gap: 5 },
  toolbarToggleText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  toolbarCount: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", textAlign: "center" },
  toolbarAction: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  toolbarActionText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  toolbarCancel: { paddingHorizontal: 8, paddingVertical: 7 },
  toolbarCancelText: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#6B7280" },

  selectBtn: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-end", paddingHorizontal: 12, paddingVertical: 6, marginBottom: 4 },
  selectBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },

  photoCell: { borderRadius: 4, overflow: "hidden", backgroundColor: "#F8FAFC" },
  photoCellSelected: { borderWidth: 3, borderColor: "#2EC4B6" },
  thumbnail: { width: "100%", height: "100%" },
  dateOverlay: { position: "absolute", top: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.28)", paddingHorizontal: 5, paddingVertical: 2 },
  dateText: { color: "#fff", fontSize: 9, fontFamily: "Inter_400Regular" },
  sourceBar: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.52)", paddingHorizontal: 5, paddingVertical: 3 },
  sourceText: { color: "#fff", fontSize: 9, fontFamily: "Inter_500Medium" },
  checkCircle: { position: "absolute", top: 5, right: 5, width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#fff", backgroundColor: "rgba(255,255,255,0.3)", alignItems: "center", justifyContent: "center" },

  empty: { alignItems: "center", paddingTop: 80, gap: 10, paddingHorizontal: 28 },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  emptySub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },

  lightbox: { flex: 1, backgroundColor: "rgba(0,0,0,0.96)", justifyContent: "center" },
  lbHeader: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10, flexDirection: "row", justifyContent: "flex-start", alignItems: "center", paddingHorizontal: 20, paddingBottom: 12 },
  lbClose: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  fullImage: { width: "100%", height: "55%" },
  lbSource: { color: "#E6FFFA", fontSize: 13, textAlign: "center", paddingHorizontal: 24, paddingTop: 14, fontFamily: "Inter_600SemiBold" },
  lbMeta: { color: "rgba(255,255,255,0.5)", fontSize: 12, textAlign: "center", paddingTop: 4, fontFamily: "Inter_400Regular" },
  lbBtnRow: { flexDirection: "row", gap: 10, paddingHorizontal: 20, paddingTop: 18, justifyContent: "center" },
  lbBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 13, borderRadius: 14 },
  lbBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
