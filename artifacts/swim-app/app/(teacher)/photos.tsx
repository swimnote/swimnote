/**
 * (teacher)/photos.tsx — 선생님: 학생 사진 업로드
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
interface Photo { id: string; file_url: string; caption?: string | null; taken_at?: string | null; }

const _DOM = process.env.EXPO_PUBLIC_DOMAIN;
const API_BASE = process.env.EXPO_PUBLIC_API_URL || (_DOM ? `https://${_DOM}/api` : "/api");

export default function TeacherPhotosScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const [classes, setClasses]   = useState<ClassGroup[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [selected, setSelected] = useState<string | null>(null);    // class id
  const [selSt, setSelSt]       = useState<string | null>(null);    // student id
  const [photos, setPhotos]     = useState<Photo[]>([]);
  const [loading, setLoading]   = useState(true);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    (async () => {
      const [cr, sr] = await Promise.all([apiRequest(token, "/class-groups"), apiRequest(token, "/students")]);
      const [cls, sts] = await Promise.all([safeJson(cr), safeJson(sr)]);
      const list = Array.isArray(cls) ? cls : [];
      setClasses(list); setStudents(Array.isArray(sts) ? sts : []);
      setLoading(false);
    })();
  }, []);

  async function fetchPhotos(studentId: string) {
    const r = await apiRequest(token, `/photos?student_id=${studentId}`);
    const data = await safeJson(r);
    setPhotos(Array.isArray(data) ? data : []);
  }

  async function pickAndUpload(studentId: string) {
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
      for (const asset of result.assets) {
        const form = new FormData();
        form.append("student_id", studentId);
        form.append("photo", {
          uri: asset.uri, name: asset.fileName || "photo.jpg",
          type: asset.mimeType || "image/jpeg",
        } as any);
        await fetch(`${API_BASE}/photos`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
      }
      fetchPhotos(studentId);
      Alert.alert("완료", `${result.assets.length}장 업로드 완료`);
    } catch { Alert.alert("오류", "업로드 실패"); }
    finally { setUploading(false); }
  }

  const visibleStudents = selected ? students.filter(st => st.class_group_id === selected) : [];

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={themeColor} />;

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <View style={s.header}><Text style={s.title}>사진 업로드</Text></View>

      {/* 반 탭 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.tabBar} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
        {classes.map(c => (
          <Pressable key={c.id} onPress={() => { setSelected(c.id); setSelSt(null); setPhotos([]); }}
            style={[s.tab, selected === c.id && { backgroundColor: themeColor, borderColor: themeColor }]}>
            <Text style={[s.tabText, selected === c.id && { color: "#fff" }]}>{c.name}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* 학생 선택 */}
      {selected && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          style={[s.tabBar, { borderTopWidth: 0 }]} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
          {visibleStudents.map(st => (
            <Pressable key={st.id} onPress={() => { setSelSt(st.id); fetchPhotos(st.id); }}
              style={[s.tab, selSt === st.id && { backgroundColor: "#6B7280", borderColor: "#6B7280" }]}>
              <Text style={[s.tabText, selSt === st.id && { color: "#fff" }]}>{st.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* 사진 그리드 */}
      {selSt ? (
        <View style={{ flex: 1 }}>
          <Pressable onPress={() => pickAndUpload(selSt)} disabled={uploading}
            style={[s.uploadBtn, { backgroundColor: themeColor }]}>
            <Feather name="upload" size={16} color="#fff" />
            <Text style={s.uploadBtnText}>{uploading ? "업로드 중..." : "사진 선택 · 업로드"}</Text>
          </Pressable>
          <FlatList
            data={photos}
            numColumns={3}
            keyExtractor={i => i.id}
            contentContainerStyle={{ padding: 8, gap: 2 }}
            columnWrapperStyle={{ gap: 2 }}
            ListEmptyComponent={<Text style={s.empty}>업로드된 사진이 없습니다.</Text>}
            renderItem={({ item }) => (
              <Image source={{ uri: item.file_url }} style={s.photo} resizeMode="cover" />
            )}
          />
        </View>
      ) : (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <Feather name="camera" size={48} color="#D1D5DB" />
          <Text style={[s.empty, { marginTop: 12 }]}>
            {selected ? "학생을 선택하세요" : "반을 먼저 선택하세요"}
          </Text>
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
  uploadBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, margin: 12, height: 44, borderRadius: 10 },
  uploadBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 },
  photo:         { width: "33%" as any, aspectRatio: 1, borderRadius: 4 },
  empty:         { textAlign: "center", color: "#9CA3AF", fontFamily: "Inter_400Regular", marginTop: 40 },
});
