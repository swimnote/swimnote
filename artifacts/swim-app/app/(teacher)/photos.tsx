/**
 * (teacher)/photos.tsx — 선생님 사진 업로드
 *
 * 단계별 흐름:
 *  1) 앨범 종류 선택 → 반 전체 앨범 | 개인 앨범
 *  2) 반 선택
 *  3) (개인 앨범) 학생 선택
 *  4) 사진 그리드 + 업로드 버튼
 *
 * 그리드 기능:
 *  - 탭 → 라이트박스 미리보기 (이전/다음)
 *  - 롱프레스 → 선택 모드 진입
 *  - 선택 모드: 다중 선택, 전체 선택, 일괄 삭제, 일괄 다운로드
 */
import { Feather } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Dimensions, Image, Modal,
  Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { apiRequest, safeJson, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";

const { width: W } = Dimensions.get("window");

type AlbumType = "group" | "private";

interface ClassGroup { id: string; name: string; }
interface Student   { id: string; name: string; class_group_id?: string | null; }
interface Photo {
  id: string; file_url: string; caption?: string | null;
  uploader_name?: string | null; created_at?: string | null; album_type?: string;
}

const API_BASE   = process.env.EXPO_PUBLIC_API_URL || "/api";
const TINT       = "#1A5CFF";
const GROUP_COLOR = "#F59E0B";
const DANGER     = "#EF4444";
const CELL       = (W - 32 - 6) / 3;   // padding 16×2, gap 3×2

function fullUri(fileUrl: string) {
  if (!fileUrl) return "";
  if (fileUrl.startsWith("http")) return fileUrl;
  return `${API_BASE.replace(/\/api$/, "")}${fileUrl}`;
}

export default function TeacherPhotosScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const [albumType, setAlbumType]   = useState<AlbumType | null>(null);
  const [classes, setClasses]       = useState<ClassGroup[]>([]);
  const [students, setStudents]     = useState<Student[]>([]);
  const [selClass, setSelClass]     = useState<ClassGroup | null>(null);
  const [selStudent, setSelStudent] = useState<Student | null>(null);
  const [photos, setPhotos]         = useState<Photo[]>([]);
  const [loading, setLoading]       = useState(true);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [uploading, setUploading]   = useState(false);

  // 라이트박스
  const [lightbox, setLightbox] = useState<{ photo: Photo; index: number } | null>(null);
  const [lbDeleting, setLbDeleting] = useState(false);

  // 선택 모드
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected]     = useState<Set<string>>(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);

  useEffect(() => {
    (async () => {
      const [cr, sr] = await Promise.all([
        apiRequest(token, "/class-groups"),
        apiRequest(token, "/students"),
      ]);
      const [cls, sts] = await Promise.all([safeJson(cr), safeJson(sr)]);
      setClasses(Array.isArray(cls) ? cls : []);
      setStudents(Array.isArray(sts) ? sts : []);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    exitSelect();
    if (!albumType || !selClass) { setPhotos([]); return; }
    if (albumType === "group") loadGroupPhotos(selClass.id);
    else if (albumType === "private" && selStudent) loadPrivatePhotos(selStudent.id);
    else setPhotos([]);
  }, [albumType, selClass?.id, selStudent?.id]);

  async function loadGroupPhotos(classId: string) {
    setPhotosLoading(true);
    try {
      const r = await apiRequest(token, `/photos/group/${classId}`);
      const data = await safeJson(r);
      setPhotos(Array.isArray(data) ? data : []);
    } finally { setPhotosLoading(false); }
  }

  async function loadPrivatePhotos(studentId: string) {
    setPhotosLoading(true);
    try {
      const r = await apiRequest(token, `/photos/private/${studentId}`);
      const data = await safeJson(r);
      setPhotos(Array.isArray(data) ? data : []);
    } finally { setPhotosLoading(false); }
  }

  function exitSelect() { setSelectMode(false); setSelected(new Set()); }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === photos.length) setSelected(new Set());
    else setSelected(new Set(photos.map(p => p.id)));
  }

  function enterSelectWith(photo: Photo) {
    setSelectMode(true);
    setSelected(new Set([photo.id]));
  }

  function selectAlbumType(type: AlbumType) {
    setAlbumType(type); setSelClass(null); setSelStudent(null); setPhotos([]);
  }
  function selectClass(cls: ClassGroup) {
    setSelClass(cls); setSelStudent(null); setPhotos([]);
  }

  const classStudents = selClass ? students.filter(s => s.class_group_id === selClass.id) : [];

  // ── 업로드 ──────────────────────────────────────────────────────────
  async function pickAndUpload() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("권한 필요", "사진 접근 권한이 필요합니다."); return; }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"], allowsMultipleSelection: true, quality: 0.85,
    });
    if (result.canceled || !result.assets?.length) return;

    setUploading(true);
    try {
      const form = new FormData();
      for (const asset of result.assets) {
        form.append("photos", { uri: asset.uri, name: asset.fileName || "photo.jpg", type: asset.mimeType || "image/jpeg" } as any);
      }
      let url: string;
      if (albumType === "group") {
        form.append("class_id", selClass!.id);
        url = `${API_BASE}/photos/group`;
      } else {
        form.append("class_id", selClass!.id);
        form.append("student_id", selStudent!.id);
        url = `${API_BASE}/photos/private`;
      }
      const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((resData as any).error || "업로드 실패");

      Alert.alert("업로드 완료", albumType === "group"
        ? `${result.assets.length}장이 ${selClass!.name} 전체 앨범에 추가됐습니다.`
        : `${result.assets.length}장이 ${selStudent!.name}의 개인 앨범에 추가됐습니다.`);
      albumType === "group" ? loadGroupPhotos(selClass!.id) : loadPrivatePhotos(selStudent!.id);
    } catch (e: any) { Alert.alert("오류", e.message || "업로드 실패"); }
    finally { setUploading(false); }
  }

  // ── 단일 삭제 (라이트박스) ─────────────────────────────────────────
  async function deleteSingle(photoId: string) {
    Alert.alert("삭제 확인", "이 사진을 삭제하시겠습니까?", [
      { text: "취소", style: "cancel" },
      { text: "삭제", style: "destructive", onPress: async () => {
        setLbDeleting(true);
        try {
          const r = await apiRequest(token, `/photos/${photoId}`, { method: "DELETE" });
          if (!r.ok) throw new Error("삭제 실패");
          setLightbox(null);
          setPhotos(prev => prev.filter(p => p.id !== photoId));
        } catch { Alert.alert("오류", "삭제 중 오류가 발생했습니다."); }
        finally { setLbDeleting(false); }
      }},
    ]);
  }

  // ── 일괄 삭제 ──────────────────────────────────────────────────────
  async function bulkDelete() {
    const ids = [...selected];
    Alert.alert("삭제 확인", `선택한 ${ids.length}장을 삭제하시겠습니까?`, [
      { text: "취소", style: "cancel" },
      { text: "삭제", style: "destructive", onPress: async () => {
        setBulkWorking(true);
        try {
          await Promise.all(ids.map(id => apiRequest(token, `/photos/${id}`, { method: "DELETE" })));
          setPhotos(prev => prev.filter(p => !ids.includes(p.id)));
          exitSelect();
        } catch { Alert.alert("오류", "일부 사진 삭제 중 오류가 발생했습니다."); }
        finally { setBulkWorking(false); }
      }},
    ]);
  }

  // ── 일괄 다운로드 ──────────────────────────────────────────────────
  async function bulkDownload() {
    const targets = photos.filter(p => selected.has(p.id));
    if (!targets.length) return;

    if (Platform.OS === "web") {
      for (const p of targets) {
        const a = document.createElement("a");
        a.href = fullUri(p.file_url);
        a.download = `swim_${p.id}.jpg`;
        a.click();
        await new Promise(r => setTimeout(r, 200));
      }
      return;
    }

    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== "granted") { Alert.alert("권한 필요", "갤러리 접근 권한이 필요합니다."); return; }

    setBulkWorking(true);
    let saved = 0;
    try {
      for (const p of targets) {
        const uri = fullUri(p.file_url);
        const localPath = `${FileSystem.documentDirectory}swim_${p.id}.jpg`;
        await FileSystem.downloadAsync(uri, localPath, { headers: { Authorization: `Bearer ${token}` } });
        await MediaLibrary.saveToLibraryAsync(localPath);
        saved++;
      }
      Alert.alert("저장 완료", `${saved}장이 갤러리에 저장됐습니다.`);
      exitSelect();
    } catch { Alert.alert("오류", `${saved}장 저장 후 오류가 발생했습니다.`); }
    finally { setBulkWorking(false); }
  }

  // ── 라이트박스 이전/다음 ──────────────────────────────────────────
  function lbNav(dir: 1 | -1) {
    if (!lightbox) return;
    const next = lightbox.index + dir;
    if (next >= 0 && next < photos.length) setLightbox({ photo: photos[next], index: next });
  }

  const canUpload =
    albumType === "group" ? !!selClass :
    albumType === "private" ? !!selClass && !!selStudent : false;

  const accentColor = albumType === "group" ? GROUP_COLOR : TINT;

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={themeColor} />;

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      {/* 헤더 */}
      <View style={s.header}>
        <Text style={s.title}>사진 업로드</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 100 }}>

        {/* STEP 1 */}
        <View style={s.section}>
          <Text style={s.stepLabel}>1단계 — 앨범 종류</Text>
          <View style={s.typeRow}>
            {([["group", "users", "반 전체 앨범", "반 모든 학부모에게\n공유됩니다", GROUP_COLOR],
               ["private", "lock", "개인 앨범", "해당 학생 학부모에게\n만 공개됩니다", TINT]] as const).map(
              ([type, icon, title, sub, color]) => {
                const active = albumType === type;
                return (
                  <Pressable key={type} onPress={() => selectAlbumType(type)}
                    style={[s.typeBtn, active && { backgroundColor: color, borderColor: color }]}>
                    <Feather name={icon} size={28} color={active ? "#fff" : "#374151"} />
                    <Text style={[s.typeBtnTitle, active && { color: "#fff" }]}>{title}</Text>
                    <Text style={[s.typeBtnSub, active && { color: "rgba(255,255,255,0.85)" }]}>{sub}</Text>
                  </Pressable>
                );
              }
            )}
          </View>
        </View>

        {/* STEP 2 */}
        {albumType && (
          <View style={s.section}>
            <Text style={s.stepLabel}>2단계 — 반 선택</Text>
            <View style={s.chipRow}>
              {classes.length === 0 && <Text style={s.emptyNote}>담당 반이 없습니다</Text>}
              {classes.map(cls => {
                const active = selClass?.id === cls.id;
                return (
                  <Pressable key={cls.id} onPress={() => selectClass(cls)}
                    style={[s.chip, active && { backgroundColor: accentColor, borderColor: accentColor }]}>
                    <Text style={[s.chipText, active && { color: "#fff" }]}>{cls.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {/* STEP 3 */}
        {albumType === "private" && selClass && (
          <View style={s.section}>
            <Text style={s.stepLabel}>3단계 — 학생 선택</Text>
            {classStudents.length === 0 ? (
              <Text style={s.emptyNote}>이 반에 학생이 없습니다</Text>
            ) : (
              <View style={s.chipRow}>
                {classStudents.map(st => {
                  const active = selStudent?.id === st.id;
                  return (
                    <Pressable key={st.id} onPress={() => setSelStudent(st)}
                      style={[s.chip, active && { backgroundColor: TINT, borderColor: TINT }]}>
                      <Text style={[s.chipText, active && { color: "#fff" }]}>{st.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* 업로드 버튼 */}
        {canUpload && (
          <Pressable onPress={pickAndUpload} disabled={uploading}
            style={[s.uploadBtn, { backgroundColor: accentColor, opacity: uploading ? 0.7 : 1 }]}>
            {uploading
              ? <ActivityIndicator color="#fff" />
              : <><Feather name="upload-cloud" size={20} color="#fff" />
                  <Text style={s.uploadBtnText}>
                    {albumType === "group" ? `${selClass!.name} 사진 업로드` : `${selStudent!.name} 개인 사진 업로드`}
                  </Text></>
            }
          </Pressable>
        )}

        {/* 사진 그리드 */}
        {canUpload && (
          <View style={s.section}>
            {/* 그리드 헤더: 제목 + 선택 모드 진입 버튼 */}
            <View style={s.gridHeader}>
              <Text style={s.stepLabel}>
                {albumType === "group"
                  ? `${selClass!.name} 앨범 (${photos.length}장)`
                  : `${selStudent?.name ?? ""} 개인 앨범 (${photos.length}장)`}
              </Text>
              {photos.length > 0 && !selectMode && (
                <Pressable onPress={() => setSelectMode(true)} style={s.selectModeBtn}>
                  <Feather name="check-square" size={16} color={accentColor} />
                  <Text style={[s.selectModeBtnText, { color: accentColor }]}>선택</Text>
                </Pressable>
              )}
            </View>

            {/* 선택 모드 툴바 */}
            {selectMode && (
              <View style={s.toolbar}>
                <Pressable onPress={toggleAll} style={s.toolbarBtn}>
                  <Feather name={selected.size === photos.length ? "check-square" : "square"} size={18} color={TINT} />
                  <Text style={[s.toolbarBtnText, { color: TINT }]}>
                    {selected.size === photos.length ? "전체 해제" : "전체 선택"}
                  </Text>
                </Pressable>
                <Text style={s.toolbarCount}>{selected.size}장 선택</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable
                    onPress={bulkDownload}
                    disabled={selected.size === 0 || bulkWorking}
                    style={[s.toolbarAction, { backgroundColor: TINT, opacity: selected.size === 0 ? 0.4 : 1 }]}
                  >
                    {bulkWorking
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <><Feather name="download" size={14} color="#fff" /><Text style={s.toolbarActionText}>받기</Text></>
                    }
                  </Pressable>
                  <Pressable
                    onPress={bulkDelete}
                    disabled={selected.size === 0 || bulkWorking}
                    style={[s.toolbarAction, { backgroundColor: DANGER, opacity: selected.size === 0 ? 0.4 : 1 }]}
                  >
                    <Feather name="trash-2" size={14} color="#fff" />
                    <Text style={s.toolbarActionText}>삭제</Text>
                  </Pressable>
                  <Pressable onPress={exitSelect} style={s.toolbarCancel}>
                    <Text style={s.toolbarCancelText}>취소</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {photosLoading ? (
              <ActivityIndicator color={themeColor} style={{ marginTop: 24 }} />
            ) : photos.length === 0 ? (
              <View style={s.emptyBox}>
                <Feather name="image" size={40} color="#D1D5DB" />
                <Text style={s.emptyNote}>사진이 없습니다{"\n"}업로드 버튼을 눌러 추가하세요</Text>
              </View>
            ) : (
              <View style={s.grid}>
                {photos.map((item, idx) => {
                  const isSelected = selected.has(item.id);
                  return (
                    <Pressable
                      key={item.id}
                      onPress={() => selectMode ? toggleSelect(item.id) : setLightbox({ photo: item, index: idx })}
                      onLongPress={() => { if (!selectMode) enterSelectWith(item); }}
                      style={[s.gridCell, isSelected && s.gridCellSelected]}
                    >
                      <Image
                        source={{ uri: fullUri(item.file_url), headers: { Authorization: `Bearer ${token}` } }}
                        style={s.gridPhoto}
                        resizeMode="cover"
                      />
                      {/* 날짜 */}
                      {item.created_at && (
                        <View style={s.dateOverlay}>
                          <Text style={s.dateText}>
                            {new Date(item.created_at).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}
                          </Text>
                        </View>
                      )}
                      {/* 선택 체크 */}
                      {selectMode && (
                        <View style={[s.checkCircle, isSelected && { backgroundColor: TINT, borderColor: TINT }]}>
                          {isSelected && <Feather name="check" size={12} color="#fff" />}
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        )}

      </ScrollView>

      {/* ── 라이트박스 모달 ── */}
      <Modal visible={!!lightbox} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setLightbox(null)}>
        <View style={s.lb}>
          <View style={[s.lbTop, { paddingTop: insets.top + (Platform.OS === "web" ? 12 : 8) }]}>
            <Pressable onPress={() => setLightbox(null)} style={s.lbIconBtn}>
              <Feather name="x" size={24} color="#fff" />
            </Pressable>
            <Text style={s.lbCounter}>{lightbox ? `${lightbox.index + 1} / ${photos.length}` : ""}</Text>
            <Pressable
              onPress={() => lightbox && deleteSingle(lightbox.photo.id)}
              disabled={lbDeleting}
              style={[s.lbIconBtn, { opacity: lbDeleting ? 0.5 : 1 }]}
            >
              {lbDeleting ? <ActivityIndicator color="#fff" size="small" /> : <Feather name="trash-2" size={20} color="#FF6B6B" />}
            </Pressable>
          </View>

          {lightbox && (
            <Image
              source={{ uri: fullUri(lightbox.photo.file_url), headers: { Authorization: `Bearer ${token}` } }}
              style={s.lbImage}
              resizeMode="contain"
            />
          )}
          {lightbox?.photo.caption ? <Text style={s.lbCaption}>{lightbox.photo.caption}</Text> : null}
          {lightbox?.photo.created_at ? (
            <Text style={s.lbDate}>
              {new Date(lightbox.photo.created_at).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })}
            </Text>
          ) : null}

          <View style={[s.lbNavRow, { paddingBottom: insets.bottom + 16 }]}>
            <Pressable onPress={() => lbNav(-1)} disabled={!lightbox || lightbox.index === 0}
              style={[s.lbNavBtn, (!lightbox || lightbox.index === 0) && { opacity: 0.3 }]}>
              <Feather name="chevron-left" size={22} color="#fff" />
              <Text style={s.lbNavText}>이전</Text>
            </Pressable>
            <Pressable onPress={() => lbNav(1)} disabled={!lightbox || lightbox.index === photos.length - 1}
              style={[s.lbNavBtn, (!lightbox || lightbox.index === photos.length - 1) && { opacity: 0.3 }]}>
              <Text style={s.lbNavText}>다음</Text>
              <Feather name="chevron-right" size={22} color="#fff" />
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: "#F8FAFF" },
  header: { paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  title:  { fontSize: 17, fontFamily: "Inter_700Bold", color: "#111827" },

  section:   { gap: 10 },
  stepLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.5 },

  typeRow:      { flexDirection: "row", gap: 12 },
  typeBtn:      { flex: 1, borderWidth: 2, borderColor: "#E5E7EB", borderRadius: 14, padding: 18, gap: 8, alignItems: "center", backgroundColor: "#fff" },
  typeBtnTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#111827", textAlign: "center" },
  typeBtnSub:   { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", textAlign: "center", lineHeight: 17 },

  chipRow:  { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip:     { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 24, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#fff" },
  chipText: { fontSize: 14, fontFamily: "Inter_500Medium", color: "#374151" },

  uploadBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 16, borderRadius: 14 },
  uploadBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },

  // 그리드 헤더
  gridHeader:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  selectModeBtn:    { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4, paddingHorizontal: 8 },
  selectModeBtnText:{ fontSize: 13, fontFamily: "Inter_500Medium" },

  // 선택 모드 툴바
  toolbar:          { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, paddingVertical: 8, paddingHorizontal: 4 },
  toolbarBtn:       { flexDirection: "row", alignItems: "center", gap: 5 },
  toolbarBtnText:   { fontSize: 13, fontFamily: "Inter_500Medium" },
  toolbarCount:     { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", textAlign: "center" },
  toolbarAction:    { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  toolbarActionText:{ color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  toolbarCancel:    { paddingHorizontal: 10, paddingVertical: 7 },
  toolbarCancelText:{ fontSize: 13, fontFamily: "Inter_500Medium", color: "#6B7280" },

  emptyBox:  { alignItems: "center", gap: 10, paddingVertical: 32 },
  emptyNote: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF", textAlign: "center", lineHeight: 19 },

  grid:            { flexDirection: "row", flexWrap: "wrap", gap: 3 },
  gridCell:        { width: CELL, height: CELL, borderRadius: 6, overflow: "hidden", backgroundColor: "#E5E7EB" },
  gridCellSelected:{ borderWidth: 3, borderColor: TINT, borderRadius: 6 },
  gridPhoto:       { width: "100%", height: "100%" },
  dateOverlay:     { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.38)", paddingVertical: 3, paddingHorizontal: 5 },
  dateText:        { color: "#fff", fontSize: 10, fontFamily: "Inter_400Regular" },
  checkCircle:     { position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#fff", backgroundColor: "rgba(255,255,255,0.3)", alignItems: "center", justifyContent: "center" },

  // 라이트박스
  lb:       { flex: 1, backgroundColor: "rgba(0,0,0,0.97)", justifyContent: "center" },
  lbTop:    { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 10 },
  lbIconBtn:{ width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  lbCounter:{ color: "rgba(255,255,255,0.7)", fontSize: 14, fontFamily: "Inter_500Medium" },
  lbImage:  { width: "100%", height: "62%" },
  lbCaption:{ color: "#fff", fontSize: 14, textAlign: "center", paddingHorizontal: 24, paddingTop: 14, fontFamily: "Inter_400Regular" },
  lbDate:   { color: "rgba(255,255,255,0.45)", fontSize: 12, textAlign: "center", marginTop: 6, fontFamily: "Inter_400Regular" },
  lbNavRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 24, marginTop: 20 },
  lbNavBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 10, paddingHorizontal: 16 },
  lbNavText:{ color: "#fff", fontSize: 14, fontFamily: "Inter_500Medium" },
});
