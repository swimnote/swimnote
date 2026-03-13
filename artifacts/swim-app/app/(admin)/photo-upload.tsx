import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Image, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;
const API_BASE = process.env.EXPO_PUBLIC_API_URL || "";

interface Student { id: string; name: string; phone: string; class_name?: string | null; }

export default function PhotoUploadScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();

  const [students, setStudents] = useState<Student[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [images, setImages] = useState<{ uri: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [step, setStep] = useState<"students" | "photos">("students");

  useEffect(() => {
    (async () => {
      try {
        const res = await apiRequest(token, "/members");
        if (res.ok) setStudents(await res.json());
      } finally { setLoadingStudents(false); }
    })();
  }, []);

  function toggleStudent(id: string) {
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  function toggleAll(list: Student[]) {
    if (list.every(s => selected.has(s.id))) setSelected(prev => { const n = new Set(prev); list.forEach(s => n.delete(s.id)); return n; });
    else setSelected(prev => { const n = new Set(prev); list.forEach(s => n.add(s.id)); return n; });
  }

  async function pickImages() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true, quality: 0.85, selectionLimit: 20,
    });
    if (!result.canceled) setImages(result.assets.map(a => ({ uri: a.uri })));
  }

  async function handleUpload() {
    if (!selected.size) { Alert.alert("알림", "학생을 선택해주세요."); return; }
    if (!images.length) { Alert.alert("알림", "사진을 선택해주세요."); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("student_ids", JSON.stringify([...selected]));
      for (const img of images) {
        const filename = img.uri.split("/").pop() || "photo.jpg";
        const ext = filename.split(".").pop()?.toLowerCase() || "jpg";
        fd.append("photos", { uri: img.uri, name: filename, type: ext === "png" ? "image/png" : "image/jpeg" } as any);
      }
      const res = await fetch(`${API_BASE}/api/photos/batch`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "업로드 실패");
      Alert.alert("완료", `${selected.size}명의 사진첩에 ${images.length}장이 업로드되었습니다.`, [{ text: "확인", onPress: () => router.back() }]);
    } catch (err: any) { Alert.alert("오류", err.message || "업로드 중 오류가 발생했습니다."); }
    finally { setUploading(false); }
  }

  const filtered = students.filter(s => s.name.includes(search) || s.phone.includes(search));

  if (step === "students") {
    const allFiltered = filtered.every(s => selected.has(s.id));
    return (
      <View style={[styles.root, { backgroundColor: C.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="chevron-left" size={24} color={C.text} />
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={[styles.headerTitle, { color: C.text }]}>사진 업로드</Text>
            <Text style={[styles.headerSub, { color: C.textMuted }]}>사진을 받을 학생 선택</Text>
          </View>
          <Pressable
            style={[styles.nextBtn, { backgroundColor: selected.size > 0 ? C.tint : C.border }]}
            onPress={() => { if (selected.size > 0) setStep("photos"); }}
            disabled={selected.size === 0}
          >
            <Text style={styles.nextBtnText}>다음</Text>
          </Pressable>
        </View>

        <View style={[styles.searchBox, { borderColor: C.border, backgroundColor: C.card, marginHorizontal: 20, marginBottom: 8 }]}>
          <Feather name="search" size={16} color={C.textMuted} />
          <TextInput style={[styles.searchInput, { color: C.text }]} value={search} onChangeText={setSearch} placeholder="이름 또는 전화번호 검색" placeholderTextColor={C.textMuted} />
        </View>

        {/* 전체 선택 */}
        {filtered.length > 0 && (
          <Pressable style={[styles.selectAllRow, { borderColor: C.border }]} onPress={() => toggleAll(filtered)}>
            <View style={[styles.checkbox, { borderColor: allFiltered ? C.tint : C.border, backgroundColor: allFiltered ? C.tint : "transparent" }]}>
              {allFiltered && <Feather name="check" size={12} color="#fff" />}
            </View>
            <Text style={[styles.selectAllText, { color: C.textSecondary }]}>전체 선택 ({filtered.length}명)</Text>
          </Pressable>
        )}

        {loadingStudents ? <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} /> : (
          <FlatList
            data={filtered}
            keyExtractor={s => s.id}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 120, gap: 8, paddingTop: 8 }}
            renderItem={({ item: s }) => {
              const sel = selected.has(s.id);
              return (
                <Pressable
                  style={[styles.studentCard, { borderColor: sel ? C.tint : C.border, backgroundColor: sel ? C.tint + "0D" : C.card }]}
                  onPress={() => toggleStudent(s.id)}
                >
                  <View style={[styles.checkbox, { borderColor: sel ? C.tint : C.border, backgroundColor: sel ? C.tint : "transparent" }]}>
                    {sel && <Feather name="check" size={12} color="#fff" />}
                  </View>
                  <View style={[styles.avatar, { backgroundColor: C.tintLight }]}>
                    <Text style={[styles.avatarText, { color: C.tint }]}>{s.name[0]}</Text>
                  </View>
                  <View style={styles.studentInfo}>
                    <Text style={[styles.studentName, { color: C.text }]}>{s.name}</Text>
                    {s.class_name && <Text style={[styles.studentClass, { color: C.textSecondary }]}>{s.class_name}</Text>}
                  </View>
                </Pressable>
              );
            }}
            ListEmptyComponent={<Text style={[styles.emptyText, { color: C.textMuted }]}>학생이 없습니다</Text>}
          />
        )}

        {selected.size > 0 && (
          <View style={[styles.selectionBar, { bottom: insets.bottom + 12, backgroundColor: C.tint }]}>
            <Text style={styles.selectionText}>{selected.size}명 선택됨</Text>
            <Pressable onPress={() => setStep("photos")} style={styles.selectionBtn}>
              <Text style={styles.selectionBtnText}>사진 선택 →</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  // Step 2: 사진 선택 + 업로드
  return (
    <View style={[styles.root, { backgroundColor: C.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <Pressable onPress={() => setStep("students")} style={styles.backBtn}>
          <Feather name="chevron-left" size={24} color={C.text} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: C.text }]}>사진 업로드</Text>
          <Text style={[styles.headerSub, { color: C.tint }]}>{selected.size}명에게 업로드</Text>
        </View>
        <Pressable style={[styles.nextBtn, { backgroundColor: images.length > 0 ? "#059669" : C.border, opacity: uploading ? 0.6 : 1 }]} onPress={handleUpload} disabled={uploading || images.length === 0}>
          {uploading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.nextBtnText}>업로드</Text>}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: insets.bottom + 40 }}>
        {/* 선택된 학생 칩 */}
        <View>
          <Text style={[styles.sectionTitle, { color: C.textSecondary }]}>선택된 학생</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 8 }}>
            {[...selected].map(id => {
              const s = students.find(s => s.id === id);
              return s ? (
                <View key={id} style={[styles.chip, { backgroundColor: C.tintLight }]}>
                  <Text style={[styles.chipText, { color: C.tint }]}>{s.name}</Text>
                </View>
              ) : null;
            })}
          </ScrollView>
        </View>

        {/* 사진 선택 */}
        <View>
          <Text style={[styles.sectionTitle, { color: C.textSecondary }]}>업로드할 사진 ({images.length}장)</Text>
          {images.length > 0 ? (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingTop: 12 }}>
                {images.map((img, i) => (
                  <View key={i} style={styles.previewWrap}>
                    <Image source={{ uri: img.uri }} style={styles.previewImg} resizeMode="cover" />
                    <Pressable style={[styles.removeBtn, { backgroundColor: C.error }]} onPress={() => setImages(prev => prev.filter((_, j) => j !== i))}>
                      <Feather name="x" size={12} color="#fff" />
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
              <Pressable style={[styles.addMoreBtn, { borderColor: C.border, marginTop: 12 }]} onPress={pickImages}>
                <Feather name="plus" size={16} color={C.textSecondary} />
                <Text style={[styles.addMoreText, { color: C.textSecondary }]}>사진 추가</Text>
              </Pressable>
            </>
          ) : (
            <Pressable style={[styles.pickBtn, { borderColor: C.border, backgroundColor: C.card, marginTop: 12 }]} onPress={pickImages}>
              <Feather name="camera" size={28} color={C.tint} />
              <Text style={[styles.pickText, { color: C.text }]}>사진 선택하기</Text>
              <Text style={[styles.pickSub, { color: C.textMuted }]}>갤러리에서 여러 장 선택 가능</Text>
            </Pressable>
          )}
        </View>

        {images.length > 0 && (
          <View style={[styles.infoBox, { backgroundColor: C.tintLight, borderRadius: 12, padding: 14 }]}>
            <Feather name="info" size={14} color={C.tint} />
            <Text style={[styles.infoText, { color: C.tint }]}>
              {selected.size}명의 사진첩에 {images.length}장씩{"\n"}총 {selected.size * images.length}장이 업로드됩니다
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1, alignItems: "center", gap: 2 },
  headerTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  nextBtn: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 20, minWidth: 60, alignItems: "center" },
  nextBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, height: 44, marginBottom: 4 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  selectAllRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1 },
  selectAllText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  studentCard: { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1.5, padding: 12, gap: 12 },
  avatar: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  studentInfo: { flex: 1, gap: 2 },
  studentName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  studentClass: { fontSize: 12, fontFamily: "Inter_400Regular" },
  emptyText: { textAlign: "center", paddingTop: 40, fontSize: 14, fontFamily: "Inter_400Regular" },
  selectionBar: {
    position: "absolute", left: 20, right: 20, borderRadius: 16,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 14,
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 12, elevation: 8, shadowColor: "#1A5CFF40",
  },
  selectionText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  selectionBtn: { paddingHorizontal: 14, paddingVertical: 6, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 10 },
  selectionBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_700Bold" },
  sectionTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.3 },
  chip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8 },
  chipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  pickBtn: { borderWidth: 2, borderStyle: "dashed", borderRadius: 16, paddingVertical: 36, alignItems: "center", gap: 10 },
  pickText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  pickSub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  previewWrap: { position: "relative" },
  previewImg: { width: 100, height: 100, borderRadius: 12 },
  removeBtn: { position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  addMoreBtn: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderRadius: 12, paddingVertical: 12, justifyContent: "center" },
  addMoreText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  infoBox: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  infoText: { fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 20, flex: 1 },
});
