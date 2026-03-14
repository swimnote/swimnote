/**
 * (teacher)/photos.tsx — 선생님 사진 업로드
 *
 * 단계별 흐름:
 *  1) 앨범 종류 선택 → 반 전체 앨범 | 개인 앨범
 *  2) 반 선택
 *  3) (개인 앨범) 학생 선택
 *  4) 사진 그리드 + 업로드 버튼
 */
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Image, Pressable,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiRequest, safeJson, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";

type AlbumType = "group" | "private";

interface ClassGroup { id: string; name: string; }
interface Student { id: string; name: string; class_group_id?: string | null; }
interface Photo {
  id: string; file_url: string; caption?: string | null;
  uploader_name?: string | null; created_at?: string | null; album_type?: string;
}

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "/api";
const TINT = "#1A5CFF";
const GROUP_COLOR = "#F59E0B";

export default function TeacherPhotosScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();

  const [albumType, setAlbumType]   = useState<AlbumType | null>(null);
  const [classes, setClasses]       = useState<ClassGroup[]>([]);
  const [students, setStudents]     = useState<Student[]>([]);
  const [selClass, setSelClass]     = useState<ClassGroup | null>(null);
  const [selStudent, setSelStudent] = useState<Student | null>(null);
  const [photos, setPhotos]         = useState<Photo[]>([]);
  const [loading, setLoading]       = useState(true);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [uploading, setUploading]   = useState(false);

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

  // 반이나 학생이 바뀌면 사진 다시 로드
  useEffect(() => {
    if (!albumType || !selClass) { setPhotos([]); return; }
    if (albumType === "group") {
      loadGroupPhotos(selClass.id);
    } else if (albumType === "private" && selStudent) {
      loadPrivatePhotos(selStudent.id);
    } else {
      setPhotos([]);
    }
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

  function selectAlbumType(type: AlbumType) {
    setAlbumType(type);
    setSelClass(null);
    setSelStudent(null);
    setPhotos([]);
  }

  function selectClass(cls: ClassGroup) {
    setSelClass(cls);
    setSelStudent(null);
    setPhotos([]);
  }

  const classStudents = selClass
    ? students.filter(s => s.class_group_id === selClass.id)
    : [];

  async function pickAndUpload() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("권한 필요", "사진 접근 권한이 필요합니다."); return; }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.length) return;

    setUploading(true);
    try {
      const form = new FormData();
      for (const asset of result.assets) {
        form.append("photos", {
          uri: asset.uri,
          name: asset.fileName || "photo.jpg",
          type: asset.mimeType || "image/jpeg",
        } as any);
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

      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((resData as any).error || "업로드 실패");

      const cnt = result.assets.length;
      if (albumType === "group") {
        Alert.alert("업로드 완료", `${cnt}장이 ${selClass!.name} 전체 앨범에 추가됐습니다.`);
        loadGroupPhotos(selClass!.id);
      } else {
        Alert.alert("업로드 완료", `${cnt}장이 ${selStudent!.name}의 개인 앨범에 추가됐습니다.`);
        loadPrivatePhotos(selStudent!.id);
      }
    } catch (e: any) { Alert.alert("오류", e.message || "업로드 실패"); }
    finally { setUploading(false); }
  }

  const photoUri = (item: Photo) =>
    item.file_url?.startsWith("http") ? item.file_url : `${API_BASE.replace("/api", "")}${item.file_url}`;

  const canUpload =
    albumType === "group" ? !!selClass :
    albumType === "private" ? !!selClass && !!selStudent : false;

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={themeColor} />;

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      {/* 헤더 */}
      <View style={s.header}>
        <Text style={s.title}>사진 업로드</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 100 }}>

        {/* STEP 1: 앨범 종류 선택 */}
        <View style={s.section}>
          <Text style={s.stepLabel}>1단계 — 앨범 종류</Text>
          <View style={s.typeRow}>
            <Pressable
              onPress={() => selectAlbumType("group")}
              style={[s.typeBtn, albumType === "group" && { backgroundColor: GROUP_COLOR, borderColor: GROUP_COLOR }]}
            >
              <Feather name="users" size={28} color={albumType === "group" ? "#fff" : "#374151"} />
              <Text style={[s.typeBtnTitle, albumType === "group" && { color: "#fff" }]}>반 전체 앨범</Text>
              <Text style={[s.typeBtnSub, albumType === "group" && { color: "rgba(255,255,255,0.85)" }]}>
                반 모든 학부모에게{"\n"}공유됩니다
              </Text>
            </Pressable>
            <Pressable
              onPress={() => selectAlbumType("private")}
              style={[s.typeBtn, albumType === "private" && { backgroundColor: TINT, borderColor: TINT }]}
            >
              <Feather name="lock" size={28} color={albumType === "private" ? "#fff" : "#374151"} />
              <Text style={[s.typeBtnTitle, albumType === "private" && { color: "#fff" }]}>개인 앨범</Text>
              <Text style={[s.typeBtnSub, albumType === "private" && { color: "rgba(255,255,255,0.85)" }]}>
                해당 학생 학부모에게{"\n"}만 공개됩니다
              </Text>
            </Pressable>
          </View>
        </View>

        {/* STEP 2: 반 선택 */}
        {albumType && (
          <View style={s.section}>
            <Text style={s.stepLabel}>2단계 — 반 선택</Text>
            <View style={s.chipRow}>
              {classes.length === 0 && (
                <Text style={s.emptyNote}>담당 반이 없습니다</Text>
              )}
              {classes.map(cls => {
                const active = selClass?.id === cls.id;
                const color = albumType === "group" ? GROUP_COLOR : TINT;
                return (
                  <Pressable
                    key={cls.id}
                    onPress={() => selectClass(cls)}
                    style={[s.chip, active && { backgroundColor: color, borderColor: color }]}
                  >
                    <Text style={[s.chipText, active && { color: "#fff" }]}>{cls.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {/* STEP 3: 학생 선택 (개인 앨범만) */}
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
                    <Pressable
                      key={st.id}
                      onPress={() => setSelStudent(st)}
                      style={[s.chip, active && { backgroundColor: TINT, borderColor: TINT }]}
                    >
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
          <Pressable
            onPress={pickAndUpload}
            disabled={uploading}
            style={[s.uploadBtn, { backgroundColor: albumType === "group" ? GROUP_COLOR : TINT, opacity: uploading ? 0.7 : 1 }]}
          >
            {uploading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Feather name="upload-cloud" size={20} color="#fff" />
                <Text style={s.uploadBtnText}>
                  {albumType === "group"
                    ? `${selClass!.name} 사진 업로드`
                    : `${selStudent!.name} 개인 사진 업로드`}
                </Text>
              </>
            )}
          </Pressable>
        )}

        {/* 사진 그리드 */}
        {canUpload && (
          <View>
            <Text style={s.stepLabel}>
              {albumType === "group"
                ? `${selClass!.name} 앨범 (${photos.length}장)`
                : `${selStudent?.name ?? ""} 개인 앨범 (${photos.length}장)`}
            </Text>
            {photosLoading ? (
              <ActivityIndicator color={themeColor} style={{ marginTop: 24 }} />
            ) : photos.length === 0 ? (
              <View style={s.emptyBox}>
                <Feather name="image" size={40} color="#D1D5DB" />
                <Text style={s.emptyNote}>사진이 없습니다</Text>
              </View>
            ) : (
              <View style={s.grid}>
                {photos.map(item => (
                  <Image
                    key={item.id}
                    source={{ uri: photoUri(item), headers: { Authorization: `Bearer ${token}` } }}
                    style={s.gridPhoto}
                    resizeMode="cover"
                  />
                ))}
              </View>
            )}
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: "#F8FAFF" },
  header: { paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  title:  { fontSize: 17, fontFamily: "Inter_700Bold", color: "#111827" },

  section:   { gap: 10 },
  stepLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.5 },

  typeRow: { flexDirection: "row", gap: 12 },
  typeBtn: {
    flex: 1, borderWidth: 2, borderColor: "#E5E7EB", borderRadius: 14,
    padding: 18, gap: 8, alignItems: "center", backgroundColor: "#fff",
  },
  typeBtnTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#111827", textAlign: "center" },
  typeBtnSub:   { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", textAlign: "center", lineHeight: 17 },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip:    { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 24, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#fff" },
  chipText: { fontSize: 14, fontFamily: "Inter_500Medium", color: "#374151" },

  uploadBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, paddingVertical: 16, borderRadius: 14,
  },
  uploadBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },

  emptyBox:  { alignItems: "center", gap: 10, paddingVertical: 32 },
  emptyNote: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF", textAlign: "center" },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 3 },
  gridPhoto: { width: "32.5%", aspectRatio: 1, borderRadius: 6 },
});
