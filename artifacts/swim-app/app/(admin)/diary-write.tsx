import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";

const C = Colors.light;
const API_BASE = process.env.EXPO_PUBLIC_API_URL || "";
const MAX_IMAGES = 5;

interface FieldProps {
  label: string; color: string; emoji: string;
  value: string; onChange: (v: string) => void;
  placeholder: string; required?: boolean;
}

function TemplateField({ label, color, emoji, value, onChange, placeholder, required }: FieldProps) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldLabel}>
        <Text style={styles.fieldEmoji}>{emoji}</Text>
        <Text style={[styles.fieldLabelText, { color }]}>{label}{required ? " *" : ""}</Text>
      </View>
      <TextInput
        style={[styles.fieldInput, { borderColor: value.trim() ? color + "60" : C.border, color: C.text, backgroundColor: C.background }]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={C.textMuted}
        multiline
        textAlignVertical="top"
      />
    </View>
  );
}

export default function DiaryWriteScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const { studentId, studentName } = useLocalSearchParams<{ studentId: string; studentName: string }>();

  const [form, setForm] = useState({
    title: "",
    lesson_content: "",
    practice_goals: "",
    good_points: "",
    improve_points: "",
    next_focus: "",
  });
  const [images, setImages] = useState<{ uri: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function setField(key: keyof typeof form) {
    return (v: string) => setForm(f => ({ ...f, [key]: v }));
  }

  async function pickImages() {
    if (images.length >= MAX_IMAGES) {
      Alert.alert("사진 제한", `최대 ${MAX_IMAGES}장까지 첨부 가능합니다.`); return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.85,
      selectionLimit: MAX_IMAGES - images.length,
    });
    if (!result.canceled) {
      setImages(prev => [...prev, ...result.assets.slice(0, MAX_IMAGES - prev.length).map(a => ({ uri: a.uri }))]);
    }
  }

  async function handleSave() {
    if (!form.title.trim()) { setError("제목을 입력해주세요."); return; }
    setSaving(true); setError("");
    try {
      const formData = new FormData();
      formData.append("title", form.title.trim());
      if (form.lesson_content.trim()) formData.append("lesson_content", form.lesson_content.trim());
      if (form.practice_goals.trim()) formData.append("practice_goals", form.practice_goals.trim());
      if (form.good_points.trim()) formData.append("good_points", form.good_points.trim());
      if (form.improve_points.trim()) formData.append("improve_points", form.improve_points.trim());
      if (form.next_focus.trim()) formData.append("next_focus", form.next_focus.trim());

      for (const img of images) {
        const filename = img.uri.split("/").pop() || "photo.jpg";
        const ext = filename.split(".").pop()?.toLowerCase() || "jpg";
        const mimeType = ext === "png" ? "image/png" : "image/jpeg";
        formData.append("images", { uri: img.uri, name: filename, type: mimeType } as any);
      }

      const res = await fetch(`${API_BASE}/api/students/${studentId}/diary`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "저장 실패");
      Alert.alert("완료", "수영 일지가 저장되었습니다.", [{ text: "확인", onPress: () => router.back() }]);
    } catch (err: any) { setError(err.message || "오류가 발생했습니다."); }
    finally { setSaving(false); }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={[styles.root, { backgroundColor: C.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="chevron-left" size={24} color={C.text} />
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={[styles.headerTitle, { color: C.text }]}>수영 일지 작성</Text>
            {studentName ? <Text style={[styles.headerSub, { color: C.textMuted }]}>{studentName}</Text> : null}
          </View>
          <Pressable
            style={[styles.saveBtn, { backgroundColor: C.tint, opacity: saving ? 0.6 : 1 }]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.saveBtnText}>게시</Text>}
          </Pressable>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 60, paddingTop: 8, gap: 4 }}
          keyboardShouldPersistTaps="handled"
        >
          {error ? (
            <View style={[styles.errorBox, { backgroundColor: C.error + "18" }]}>
              <Feather name="alert-circle" size={14} color={C.error} />
              <Text style={[styles.errorText, { color: C.error }]}>{error}</Text>
            </View>
          ) : null}

          {/* 제목 */}
          <View style={[styles.titleField, { borderBottomColor: C.border }]}>
            <TextInput
              style={[styles.titleInput, { color: C.text }]}
              value={form.title}
              onChangeText={setField("title")}
              placeholder="일지 제목을 입력하세요 *"
              placeholderTextColor={C.textMuted}
            />
          </View>

          <TemplateField
            label="오늘의 수업 내용" color="#1A5CFF" emoji="📘"
            value={form.lesson_content} onChange={setField("lesson_content")}
            placeholder="오늘 진행한 수업 내용을 기록해주세요"
          />
          <TemplateField
            label="연습한 동작 / 목표" color="#059669" emoji="🎯"
            value={form.practice_goals} onChange={setField("practice_goals")}
            placeholder="오늘 연습한 영법이나 목표를 적어주세요"
          />
          <TemplateField
            label="잘한 점" color="#F59E0B" emoji="👍"
            value={form.good_points} onChange={setField("good_points")}
            placeholder="오늘 학생이 잘한 점을 칭찬해주세요"
          />
          <TemplateField
            label="보완할 점" color="#EF4444" emoji="✏️"
            value={form.improve_points} onChange={setField("improve_points")}
            placeholder="다음 수업까지 보완이 필요한 부분을 적어주세요"
          />
          <TemplateField
            label="다음 수업 포인트" color="#7C3AED" emoji="➡️"
            value={form.next_focus} onChange={setField("next_focus")}
            placeholder="다음 수업에서 집중할 포인트를 미리 알려주세요"
          />

          {/* 사진 첨부 */}
          <View style={styles.field}>
            <View style={styles.fieldLabel}>
              <Text style={styles.fieldEmoji}>📷</Text>
              <Text style={[styles.fieldLabelText, { color: C.textSecondary }]}>수업 사진 ({images.length}/{MAX_IMAGES})</Text>
            </View>
            {images.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 4 }}>
                {images.map((img, i) => (
                  <View key={i} style={styles.previewWrap}>
                    <Image source={{ uri: img.uri }} style={styles.previewImg} resizeMode="cover" />
                    <Pressable
                      style={[styles.removeBtn, { backgroundColor: C.error }]}
                      onPress={() => setImages(prev => prev.filter((_, idx) => idx !== i))}
                    >
                      <Feather name="x" size={12} color="#fff" />
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            )}
            {images.length < MAX_IMAGES && (
              <Pressable style={[styles.addPhotoBtn, { borderColor: C.border }]} onPress={pickImages}>
                <Feather name="camera" size={18} color={C.textSecondary} />
                <Text style={[styles.addPhotoText, { color: C.textSecondary }]}>사진 추가</Text>
              </Pressable>
            )}
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingBottom: 12, gap: 8,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1, alignItems: "center", gap: 2 },
  headerTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  saveBtn: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 20, minWidth: 52, alignItems: "center" },
  saveBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 6, padding: 12, borderRadius: 10, marginBottom: 8 },
  errorText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  titleField: { borderBottomWidth: 1.5, paddingBottom: 12, marginBottom: 16 },
  titleInput: { fontSize: 20, fontFamily: "Inter_700Bold", minHeight: 40 },
  field: { gap: 10, paddingVertical: 12, borderBottomWidth: 0 },
  fieldLabel: { flexDirection: "row", alignItems: "center", gap: 7 },
  fieldEmoji: { fontSize: 16 },
  fieldLabelText: { fontSize: 13, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4 },
  fieldInput: {
    borderWidth: 1.5, borderRadius: 12,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12,
    fontSize: 14, fontFamily: "Inter_400Regular",
    minHeight: 80, lineHeight: 22,
  },
  previewWrap: { position: "relative" },
  previewImg: { width: 90, height: 90, borderRadius: 10 },
  removeBtn: {
    position: "absolute", top: 4, right: 4,
    width: 20, height: 20, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },
  addPhotoBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 1.5, borderStyle: "dashed", borderRadius: 12,
    paddingVertical: 14, justifyContent: "center",
  },
  addPhotoText: { fontSize: 14, fontFamily: "Inter_500Medium" },
});
