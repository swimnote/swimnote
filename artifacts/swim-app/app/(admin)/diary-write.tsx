import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const C = Colors.light;
const API_BASE = process.env.EXPO_PUBLIC_API_URL || "";
const MAX_IMAGES = 5;

interface ClassGroup {
  id: string; name: string;
  schedule_days: string; schedule_time: string;
  student_count?: number;
}

function TemplateField({ label, color, emoji, value, onChange, placeholder }: {
  label: string; color: string; emoji: string;
  value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldLabel}>
        <Text style={styles.fieldEmoji}>{emoji}</Text>
        <Text style={[styles.fieldLabelText, { color }]}>{label}</Text>
      </View>
      <TextInput
        style={[styles.fieldInput, { borderColor: value.trim() ? color + "55" : C.border, color: C.text, backgroundColor: C.background }]}
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

  const [groups, setGroups] = useState<ClassGroup[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({ title: "", lesson_content: "", practice_goals: "", good_points: "", next_focus: "" });
  const [images, setImages] = useState<{ uri: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<"groups" | "content">("groups");

  useEffect(() => {
    (async () => {
      try {
        const res = await apiRequest(token, "/diary/class-groups");
        if (res.ok) setGroups(await res.json());
      } finally { setLoadingGroups(false); }
    })();
  }, []);

  function toggleGroup(id: string) {
    setSelectedGroups(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function setField(key: keyof typeof form) {
    return (v: string) => setForm(f => ({ ...f, [key]: v }));
  }

  async function pickImages() {
    if (images.length >= MAX_IMAGES) { Alert.alert("사진 제한", `최대 ${MAX_IMAGES}장까지 첨부 가능합니다.`); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true, quality: 0.85,
      selectionLimit: MAX_IMAGES - images.length,
    });
    if (!result.canceled) setImages(prev => [...prev, ...result.assets.slice(0, MAX_IMAGES - prev.length).map(a => ({ uri: a.uri }))]);
  }

  async function handleSave() {
    if (!form.lesson_content.trim()) { setError("수업 내용을 입력해주세요."); return; }
    if (!selectedGroups.size) { setError("스케줄 그룹을 선택해주세요."); return; }
    setSaving(true); setError("");
    try {
      const groupIds = [...selectedGroups];
      let success = 0;
      const errors: string[] = [];
      for (const groupId of groupIds) {
        const r = await apiRequest(token, "/diaries", {
          method: "POST",
          body: JSON.stringify({
            class_group_id: groupId,
            common_content: [
              form.lesson_content.trim(),
              form.practice_goals.trim() ? `[연습 동작] ${form.practice_goals.trim()}` : "",
              form.good_points.trim() ? `[잘한 점] ${form.good_points.trim()}` : "",
              form.next_focus.trim() ? `[다음 포인트] ${form.next_focus.trim()}` : "",
            ].filter(Boolean).join("\n\n"),
          }),
        });
        if (r.ok) { success++; }
        else {
          const d = await r.json();
          errors.push(d.error || "저장 실패");
        }
      }
      if (success > 0) {
        Alert.alert("완료", `${success}개 반에 수업 일지가 등록되었습니다.\n학부모에게 알림이 발송됩니다.`, [{ text: "확인", onPress: () => router.back() }]);
      } else {
        setError(errors[0] || "저장에 실패했습니다.");
      }
    } catch (err: any) { setError(err.message || "오류가 발생했습니다."); }
    finally { setSaving(false); }
  }

  if (step === "groups") {
    return (
      <View style={[styles.root, { backgroundColor: C.background }]}>
        <SubScreenHeader
          title="수영 일지 작성"
          subtitle="적용할 스케줄 그룹 선택"
          rightSlot={
            <Pressable
              style={[styles.nextBtn, { backgroundColor: selectedGroups.size > 0 ? C.tint : C.border }]}
              onPress={() => { if (selectedGroups.size > 0) setStep("content"); }}
              disabled={selectedGroups.size === 0}
            >
              <Text style={styles.nextBtnText}>다음</Text>
            </Pressable>
          }
        />

        {loadingGroups ? <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} /> : (
          <ScrollView contentContainerStyle={{ padding: 20, gap: 10, paddingBottom: insets.bottom + 40 }}>
            {/* 전체 선택 */}
            <Pressable
              style={[styles.groupCard, { borderColor: selectedGroups.size === groups.length && groups.length > 0 ? C.tint : C.border, backgroundColor: C.card }]}
              onPress={() => {
                if (selectedGroups.size === groups.length) setSelectedGroups(new Set());
                else setSelectedGroups(new Set(groups.map(g => g.id)));
              }}
            >
              <View style={[styles.checkbox, { borderColor: selectedGroups.size === groups.length && groups.length > 0 ? C.tint : C.border, backgroundColor: selectedGroups.size === groups.length && groups.length > 0 ? C.tint : "transparent" }]}>
                {selectedGroups.size === groups.length && groups.length > 0 && <Feather name="check" size={12} color="#fff" />}
              </View>
              <Text style={[styles.groupName, { color: C.text }]}>전체 선택</Text>
              <Text style={[styles.groupCount, { color: C.textMuted }]}>{groups.length}개 그룹</Text>
            </Pressable>

            <View style={[styles.divider, { backgroundColor: C.border }]} />

            {groups.length === 0 && (
              <View style={styles.empty}>
                <Text style={[styles.emptyText, { color: C.textMuted }]}>등록된 스케줄 그룹이 없습니다{"\n"}반 관리에서 먼저 그룹을 생성해주세요</Text>
              </View>
            )}

            {groups.map(g => {
              const sel = selectedGroups.has(g.id);
              return (
                <Pressable
                  key={g.id}
                  style={[styles.groupCard, { borderColor: sel ? C.tint : C.border, backgroundColor: sel ? C.tint + "0D" : C.card }]}
                  onPress={() => toggleGroup(g.id)}
                >
                  <View style={[styles.checkbox, { borderColor: sel ? C.tint : C.border, backgroundColor: sel ? C.tint : "transparent" }]}>
                    {sel && <Feather name="check" size={12} color="#fff" />}
                  </View>
                  <View style={styles.groupInfo}>
                    <Text style={[styles.groupName, { color: C.text }]}>{g.name}</Text>
                    <Text style={[styles.groupSchedule, { color: C.textSecondary }]}>
                      {g.schedule_days} · {g.schedule_time}
                    </Text>
                  </View>
                  <View style={[styles.countBadge, { backgroundColor: C.tintLight }]}>
                    <Text style={[styles.groupCount, { color: C.tint }]}>{g.student_count ?? 0}명</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {selectedGroups.size > 0 && (
          <View style={[styles.selectionBar, { bottom: insets.bottom + 12, backgroundColor: C.tint }]}>
            <Text style={styles.selectionText}>{selectedGroups.size}개 그룹 선택됨</Text>
            <Pressable onPress={() => setStep("content")} style={styles.selectionBtn}>
              <Text style={styles.selectionBtnText}>내용 작성 →</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  // Step 2: 내용 작성
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={[styles.root, { backgroundColor: C.background }]}>
        <SubScreenHeader
          title="수영 일지 작성"
          subtitle={`${selectedGroups.size}개 그룹 적용`}
          onBack={() => setStep("groups")}
          rightSlot={
            <Pressable
              style={[styles.nextBtn, { backgroundColor: C.tint, opacity: saving ? 0.6 : 1 }]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.nextBtnText}>게시</Text>}
            </Pressable>
          }
        />

        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 60, paddingTop: 4, gap: 2 }}>

          {/* 선택된 그룹 칩 */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
            {[...selectedGroups].map(id => {
              const g = groups.find(g => g.id === id);
              return g ? (
                <View key={id} style={[styles.chip, { backgroundColor: C.tintLight }]}>
                  <Text style={[styles.chipText, { color: C.tint }]}>{g.name}</Text>
                </View>
              ) : null;
            })}
          </ScrollView>

          {error ? (
            <View style={[styles.errorBox, { backgroundColor: C.error + "18" }]}>
              <Feather name="alert-circle" size={14} color={C.error} />
              <Text style={[styles.errorText, { color: C.error }]}>{error}</Text>
            </View>
          ) : null}

          <View style={[styles.titleField, { borderBottomColor: C.border }]}>
            <TextInput
              style={[styles.titleInput, { color: C.text }]}
              value={form.title} onChangeText={setField("title")}
              placeholder="일지 제목을 입력하세요 *" placeholderTextColor={C.textMuted}
            />
          </View>

          <TemplateField label="오늘의 수업 내용" color="#1A5CFF" emoji="📘" value={form.lesson_content} onChange={setField("lesson_content")} placeholder="오늘 진행한 수업 내용을 기록해주세요" />
          <TemplateField label="연습한 동작 / 목표" color="#059669" emoji="🎯" value={form.practice_goals} onChange={setField("practice_goals")} placeholder="오늘 연습한 영법이나 목표를 적어주세요" />
          <TemplateField label="잘한 점" color="#F59E0B" emoji="👍" value={form.good_points} onChange={setField("good_points")} placeholder="오늘 학생들이 잘한 점을 칭찬해주세요" />
          <TemplateField label="다음 수업 포인트" color="#7C3AED" emoji="➡️" value={form.next_focus} onChange={setField("next_focus")} placeholder="다음 수업에서 집중할 포인트를 알려주세요" />

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
                    <Pressable style={[styles.removeBtn, { backgroundColor: C.error }]} onPress={() => setImages(prev => prev.filter((_, idx) => idx !== i))}>
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
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1, alignItems: "center", gap: 2 },
  headerTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  nextBtn: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 20, minWidth: 52, alignItems: "center" },
  nextBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  groupCard: { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1.5, padding: 14, gap: 12 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  groupInfo: { flex: 1, gap: 3 },
  groupName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  groupSchedule: { fontSize: 12, fontFamily: "Inter_400Regular" },
  countBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  groupCount: { fontSize: 12, fontFamily: "Inter_500Medium" },
  divider: { height: 1, marginVertical: 4 },
  empty: { paddingTop: 40, alignItems: "center" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
  selectionBar: {
    position: "absolute", left: 20, right: 20, borderRadius: 16,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 14,
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 12, elevation: 8, shadowColor: "#1A5CFF40",
  },
  selectionText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  selectionBtn: { paddingHorizontal: 14, paddingVertical: 6, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 10 },
  selectionBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_700Bold" },
  chip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8 },
  chipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 6, padding: 12, borderRadius: 10, marginBottom: 8 },
  errorText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  titleField: { borderBottomWidth: 1.5, paddingBottom: 12, marginBottom: 12 },
  titleInput: { fontSize: 20, fontFamily: "Inter_700Bold", minHeight: 40 },
  field: { gap: 10, paddingVertical: 10 },
  fieldLabel: { flexDirection: "row", alignItems: "center", gap: 7 },
  fieldEmoji: { fontSize: 16 },
  fieldLabelText: { fontSize: 13, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4 },
  fieldInput: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, fontSize: 14, fontFamily: "Inter_400Regular", minHeight: 80, lineHeight: 22 },
  previewWrap: { position: "relative" },
  previewImg: { width: 90, height: 90, borderRadius: 10 },
  removeBtn: { position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  addPhotoBtn: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderStyle: "dashed", borderRadius: 12, paddingVertical: 14, justifyContent: "center" },
  addPhotoText: { fontSize: 14, fontFamily: "Inter_500Medium" },
});
