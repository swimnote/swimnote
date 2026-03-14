/**
 * (teacher)/photos.tsx — 선생님: 학생 사진 업로드
 * - 반 전체 업로드: 해당 반 모든 학생에게 동시 배포 → 각 학부모가 확인 가능
 * - 개인 업로드: 특정 학생에게만 사진 등록
 */
import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Image, Pressable,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { apiRequest, safeJson, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";

interface ClassGroup { id: string; name: string; }
interface Student { id: string; name: string; class_group_id?: string | null; }
interface Photo {
  id: string; file_url: string;
  student_id?: string; uploader_name?: string | null; created_at?: string | null;
}

const _DOM = process.env.EXPO_PUBLIC_DOMAIN;
const API_BASE = process.env.EXPO_PUBLIC_API_URL || (_DOM ? `https://${_DOM}/api` : "/api");

const CLASS_TAB = "__class__";   // "반 전체" 가상 탭 ID

export default function TeacherPhotosScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const [classes, setClasses]     = useState<ClassGroup[]>([]);
  const [students, setStudents]   = useState<Student[]>([]);
  const [selClass, setSelClass]   = useState<string | null>(null);
  const [selTab, setSelTab]       = useState<string>(CLASS_TAB);   // CLASS_TAB or student id
  const [photos, setPhotos]       = useState<Photo[]>([]);
  const [loading, setLoading]     = useState(true);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    (async () => {
      const [cr, sr] = await Promise.all([
        apiRequest(token, "/class-groups"),
        apiRequest(token, "/students"),
      ]);
      const [cls, sts] = await Promise.all([safeJson(cr), safeJson(sr)]);
      const list: ClassGroup[] = Array.isArray(cls) ? cls : [];
      setClasses(list);
      setStudents(Array.isArray(sts) ? sts : []);
      if (list.length) {
        setSelClass(list[0].id);
        fetchClassPhotos(list[0].id, Array.isArray(sts) ? sts : []);
      }
      setLoading(false);
    })();
  }, []);

  // 반 전체 사진 = 반 소속 모든 학생의 사진을 합쳐서 날짜순 정렬
  async function fetchClassPhotos(classId: string, sts: Student[]) {
    const classStudents = sts.filter(s => s.class_group_id === classId);
    if (!classStudents.length) { setPhotos([]); return; }
    const results = await Promise.all(
      classStudents.map(async st => {
        const r = await apiRequest(token, `/students/${st.id}/photos`);
        const data = await safeJson(r);
        return Array.isArray(data) ? data : [];
      })
    );
    const all: Photo[] = results.flat();
    all.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    setPhotos(all);
  }

  async function fetchStudentPhotos(studentId: string) {
    const r = await apiRequest(token, `/students/${studentId}/photos`);
    const data = await safeJson(r);
    setPhotos(Array.isArray(data) ? data : []);
  }

  function handleTabChange(classId: string, tab: string, sts: Student[]) {
    setSelTab(tab);
    setPhotos([]);
    if (tab === CLASS_TAB) {
      fetchClassPhotos(classId, sts);
    } else {
      fetchStudentPhotos(tab);
    }
  }

  // 반 전체 업로드 — /photos/batch API 사용
  async function batchUpload(classId: string) {
    const classStudents = students.filter(s => s.class_group_id === classId);
    if (!classStudents.length) {
      Alert.alert("알림", "이 반에 소속된 학생이 없습니다."); return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("권한 필요", "사진 접근 권한이 필요합니다."); return; }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return;

    setUploading(true);
    try {
      const form = new FormData();
      for (const asset of result.assets) {
        form.append("photos", {
          uri: asset.uri, name: asset.fileName || "photo.jpg",
          type: asset.mimeType || "image/jpeg",
        } as any);
      }
      form.append("student_ids", JSON.stringify(classStudents.map(s => s.id)));

      const res = await fetch(`${API_BASE}/photos/batch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((resData as any).error || "업로드 실패");

      const { count } = resData as any;
      Alert.alert(
        "업로드 완료",
        `${result.assets.length}장의 사진이 ${classStudents.length}명 학부모에게 공유됐습니다.`
      );
      fetchClassPhotos(classId, students);
    } catch (e: any) { Alert.alert("오류", e.message || "업로드 실패"); }
    finally { setUploading(false); }
  }

  // 개인 업로드
  async function singleUpload(studentId: string) {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("권한 필요", "사진 접근 권한이 필요합니다."); return; }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return;

    setUploading(true);
    try {
      const form = new FormData();
      for (const asset of result.assets) {
        form.append("photos", {
          uri: asset.uri, name: asset.fileName || "photo.jpg",
          type: asset.mimeType || "image/jpeg",
        } as any);
      }
      const res = await fetch(`${API_BASE}/students/${studentId}/photos`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || "업로드 실패");
      }
      fetchStudentPhotos(studentId);
      Alert.alert("완료", `${result.assets.length}장 업로드 완료`);
    } catch (e: any) { Alert.alert("오류", e.message || "업로드 실패"); }
    finally { setUploading(false); }
  }

  const classStudents = selClass ? students.filter(s => s.class_group_id === selClass) : [];
  const isClassTab = selTab === CLASS_TAB;
  const photoUri = (item: Photo) =>
    item.file_url?.startsWith("http") ? item.file_url : `${API_BASE}${item.file_url}`;

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={themeColor} />;

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <View style={s.header}><Text style={s.title}>사진 업로드</Text></View>

      {/* 반 탭 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.tabBar} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
        {classes.map(c => (
          <Pressable key={c.id}
            onPress={() => {
              setSelClass(c.id);
              setSelTab(CLASS_TAB);
              fetchClassPhotos(c.id, students);
            }}
            style={[s.tab, selClass === c.id && { backgroundColor: themeColor, borderColor: themeColor }]}>
            <Text style={[s.tabText, selClass === c.id && { color: "#fff" }]}>{c.name}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* 반 전체 / 학생 선택 탭 */}
      {selClass && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          style={[s.tabBar, { borderTopWidth: 0 }]}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>

          {/* 반 전체 탭 */}
          <Pressable
            onPress={() => handleTabChange(selClass, CLASS_TAB, students)}
            style={[s.tab, isClassTab && { backgroundColor: "#F59E0B", borderColor: "#F59E0B" }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Feather name="users" size={12} color={isClassTab ? "#fff" : "#374151"} />
              <Text style={[s.tabText, isClassTab && { color: "#fff" }]}>반 전체</Text>
            </View>
          </Pressable>

          {/* 개별 학생 탭 */}
          {classStudents.map(st => (
            <Pressable key={st.id}
              onPress={() => handleTabChange(selClass, st.id, students)}
              style={[s.tab, selTab === st.id && { backgroundColor: "#6B7280", borderColor: "#6B7280" }]}>
              <Text style={[s.tabText, selTab === st.id && { color: "#fff" }]}>{st.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* 업로드 버튼 */}
      {selClass && (
        <View style={s.actionRow}>
          {isClassTab ? (
            <>
              <View>
                <Text style={s.actionLabel}>반 전체 공유</Text>
                <Text style={s.actionSub}>모든 학부모에게 동시 전달됩니다</Text>
              </View>
              <Pressable
                onPress={() => batchUpload(selClass)} disabled={uploading}
                style={[s.uploadBtn, { backgroundColor: "#F59E0B" }]}>
                <Feather name="upload-cloud" size={15} color="#fff" />
                <Text style={s.uploadBtnText}>{uploading ? "업로드 중..." : "반 전체 업로드"}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={s.actionLabel}>
                {classStudents.find(s => s.id === selTab)?.name} 개인 사진
              </Text>
              <Pressable
                onPress={() => singleUpload(selTab)} disabled={uploading}
                style={[s.uploadBtn, { backgroundColor: themeColor }]}>
                <Feather name="upload" size={15} color="#fff" />
                <Text style={s.uploadBtnText}>{uploading ? "업로드 중..." : "사진 업로드"}</Text>
              </Pressable>
            </>
          )}
        </View>
      )}

      {/* 사진 그리드 */}
      {selClass ? (
        <FlatList
          data={photos}
          numColumns={3}
          keyExtractor={i => i.id}
          contentContainerStyle={{ padding: 4, gap: 2 }}
          columnWrapperStyle={{ gap: 2 }}
          ListEmptyComponent={
            <View style={{ alignItems: "center", marginTop: 60, gap: 12 }}>
              <Feather name="image" size={48} color="#D1D5DB" />
              <Text style={s.empty}>
                {isClassTab ? "반 전체 사진이 없습니다" : "업로드된 사진이 없습니다"}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Image
              source={{ uri: photoUri(item), headers: { Authorization: `Bearer ${token}` } }}
              style={s.photo} resizeMode="cover" />
          )}
        />
      ) : (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <Feather name="camera" size={48} color="#D1D5DB" />
          <Text style={[s.empty, { marginTop: 12 }]}>반을 먼저 선택하세요</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: "#F8FAFF" },
  header:        { padding: 16, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  title:         { fontSize: 17, fontFamily: "Inter_700Bold", color: "#111827" },
  tabBar:        { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  tab:           { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#fff" },
  tabText:       { fontSize: 13, fontFamily: "Inter_500Medium", color: "#374151" },
  actionRow:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  actionLabel:   { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#111827" },
  actionSub:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },
  uploadBtn:     { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  uploadBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 13 },
  photo:         { width: "33%" as any, aspectRatio: 1, borderRadius: 2 },
  empty:         { textAlign: "center", color: "#9CA3AF", fontFamily: "Inter_400Regular" },
});
