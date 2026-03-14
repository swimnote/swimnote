/**
 * (teacher)/diary.tsx — 수영일지 탭
 *
 * 구조: WeeklySchedule → 반 선택 → 일지 작성/보기
 * 수업내용 + 사진/영상 업로드 + 저장 시 학부모 알림 자동발송
 */
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView,
  Modal, Platform, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { PoolHeader } from "@/components/PoolHeader";
import { WeeklySchedule, TeacherClassGroup, SlotStatus } from "@/components/teacher/WeeklySchedule";

const C = Colors.light;

interface MediaItem {
  key?: string;
  type: "image" | "video";
  localUri?: string;
  uploading?: boolean;
}

interface DiaryEntry {
  id: string;
  class_group_id: string;
  title: string;
  lesson_content?: string | null;
  next_focus?: string | null;
  author_name?: string | null;
  created_at?: string | null;
  media_items?: MediaItem[] | null;
}

type SubView = "write" | "history";

function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "";
function mediaUrl(key: string) {
  return `${API_BASE}/api/uploads/${encodeURIComponent(key)}`;
}

export default function TeacherDiaryScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const params = useLocalSearchParams<{ classGroupId?: string; className?: string }>();

  const [groups,     setGroups]     = useState<TeacherClassGroup[]>([]);
  const [diarySet,   setDiarySet]   = useState<Set<string>>(new Set());
  const [attMap,     setAttMap]     = useState<Record<string, number>>({});
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [selectedGroup, setSelectedGroup] = useState<TeacherClassGroup | null>(null);
  const [subView,       setSubView]       = useState<SubView>("write");

  // 일지 작성 폼
  const [lessonContent, setLessonContent] = useState("");
  const [mediaItems,    setMediaItems]    = useState<MediaItem[]>([]);
  const [saving,        setSaving]        = useState(false);

  // 과거 일지 목록
  const [diaries,      setDiaries]      = useState<DiaryEntry[]>([]);
  const [diaryLoading, setDiaryLoading] = useState(false);

  const load = useCallback(async () => {
    const today = todayDateStr();
    try {
      const [cgRes, attRes, dRes] = await Promise.all([
        apiRequest(token, "/class-groups"),
        apiRequest(token, `/attendance?date=${today}`),
        apiRequest(token, `/diary?date=${today}`),
      ]);
      let groupsList: TeacherClassGroup[] = [];
      if (cgRes.ok)  { groupsList = await cgRes.json(); setGroups(groupsList); }
      if (attRes.ok) {
        const arr: any[] = await attRes.json();
        const map: Record<string, number> = {};
        arr.forEach(a => { const cid = a.class_group_id || a.class_id; if (cid) map[cid] = (map[cid] || 0) + 1; });
        setAttMap(map);
      }
      if (dRes.ok) {
        const arr: any[] = await dRes.json();
        setDiarySet(new Set(arr.map((d: any) => d.class_group_id).filter(Boolean)));
      }
      if (params.classGroupId) {
        const found = groupsList.find(g => g.id === params.classGroupId);
        if (found) openGroup(found);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function openGroup(group: TeacherClassGroup) {
    setSelectedGroup(group);
    setSubView("write");
    setLessonContent("");
    setMediaItems([]);
    loadDiaries(group.id);
  }

  async function loadDiaries(classId: string) {
    setDiaryLoading(true);
    try {
      const r = await apiRequest(token, `/diary?class_group_id=${classId}`);
      if (r.ok) {
        const data = await r.json();
        setDiaries(Array.isArray(data) ? data : []);
      }
    } catch (e) { console.error(e); }
    finally { setDiaryLoading(false); }
  }

  // ── 미디어 선택 ──
  async function pickMedia(mediaType: "images" | "videos") {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("권한 필요", "사진/영상에 접근하려면 갤러리 권한이 필요합니다.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: mediaType === "images"
        ? ImagePicker.MediaTypeOptions.Images
        : ImagePicker.MediaTypeOptions.Videos,
      allowsMultipleSelection: true,
      quality: 0.8,
      videoMaxDuration: 60,
    });
    if (result.canceled) return;

    for (const asset of result.assets) {
      const item: MediaItem = {
        type: asset.type === "video" ? "video" : "image",
        localUri: asset.uri,
        uploading: true,
      };
      setMediaItems(prev => [...prev, item]);

      // 업로드
      try {
        const formData = new FormData();
        const filename = asset.fileName || (asset.type === "video" ? "video.mp4" : "photo.jpg");
        const mimeType = asset.mimeType || (asset.type === "video" ? "video/mp4" : "image/jpeg");
        formData.append("file", { uri: asset.uri, name: filename, type: mimeType } as any);

        const r = await fetch(`${API_BASE}/api/diary/upload`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        if (!r.ok) throw new Error("업로드 실패");
        const { key, type } = await r.json();
        setMediaItems(prev => prev.map(m =>
          m.localUri === asset.uri ? { ...m, key, type, uploading: false } : m
        ));
      } catch (e) {
        Alert.alert("업로드 오류", "파일 업로드 중 오류가 발생했습니다.");
        setMediaItems(prev => prev.filter(m => m.localUri !== asset.uri));
      }
    }
  }

  function removeLocalMedia(uri: string) {
    setMediaItems(prev => prev.filter(m => m.localUri !== uri));
  }

  async function handleSave() {
    if (!selectedGroup) return;

    const uploading = mediaItems.some(m => m.uploading);
    if (uploading) {
      Alert.alert("잠깐만요", "사진/영상 업로드 중입니다. 잠시 후 다시 시도해주세요.");
      return;
    }

    setSaving(true);
    try {
      const readyItems = mediaItems.filter(m => m.key).map(m => ({ key: m.key!, type: m.type }));
      const r = await apiRequest(token, "/diary", {
        method: "POST",
        body: JSON.stringify({
          lesson_content: lessonContent || null,
          media_items: readyItems,
          class_group_ids: [selectedGroup.id],
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "저장 실패");
      setDiarySet(prev => new Set([...prev, selectedGroup.id]));
      Alert.alert("저장 완료", "수영일지가 작성되었습니다.\n학부모에게 알림이 발송되었습니다.");
      setSelectedGroup(null);
    } catch (e: any) { Alert.alert("오류", e.message); }
    finally { setSaving(false); }
  }

  // ── 과거 일지 미디어 삭제 ──
  async function deleteHistoryMedia(diaryId: string, key: string) {
    try {
      const r = await apiRequest(token, `/diary/${diaryId}/media`, {
        method: "DELETE",
        body: JSON.stringify({ key }),
      });
      if (!r.ok) throw new Error("삭제 실패");
      // 로컬 상태 업데이트
      setDiaries(prev => prev.map(d => {
        if (d.id !== diaryId) return d;
        return { ...d, media_items: (d.media_items || []).filter(m => m.key !== key) };
      }));
    } catch (e) {
      Alert.alert("오류", "미디어 삭제 중 오류가 발생했습니다.");
    }
  }

  // statusMap
  const statusMap: Record<string, SlotStatus> = {};
  groups.forEach(g => {
    statusMap[g.id] = { attChecked: attMap[g.id] || 0, diaryDone: diarySet.has(g.id), hasPhotos: false };
  });

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <PoolHeader />
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  // ── 일지 작성/보기 서브뷰 ──────────────────────────────────────────────
  if (selectedGroup) {
    const group = selectedGroup;

    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <PoolHeader />

        {/* 헤더 */}
        <View style={s.subHeader}>
          <Pressable style={s.backBtn} onPress={() => setSelectedGroup(null)}>
            <Feather name="arrow-left" size={20} color={C.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={s.subTitle}>{group.name} 수영일지</Text>
            <Text style={s.subSub}>{todayDateStr()} · {group.schedule_time}</Text>
          </View>
          <Pressable
            style={[s.historyBtn, { backgroundColor: subView === "history" ? themeColor : C.background, borderColor: themeColor }]}
            onPress={() => setSubView(prev => prev === "history" ? "write" : "history")}
          >
            <Feather name="clock" size={13} color={subView === "history" ? "#fff" : themeColor} />
            <Text style={[s.historyBtnText, { color: subView === "history" ? "#fff" : themeColor }]}>지난 일지</Text>
          </Pressable>
        </View>

        {subView === "write" ? (
          // ── 새 일지 작성 ──
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
            <ScrollView contentContainerStyle={s.writeForm} showsVerticalScrollIndicator={false}>

              {/* 오늘 수업 내용 */}
              <View style={s.formField}>
                <Text style={s.formLabel}>오늘 수업 내용</Text>
                <TextInput
                  style={[s.formInput, { height: 140, textAlignVertical: "top" }]}
                  value={lessonContent}
                  onChangeText={setLessonContent}
                  placeholder="오늘 진행한 수업 내용을 입력하세요."
                  placeholderTextColor={C.textMuted}
                  multiline
                  numberOfLines={6}
                />
              </View>

              {/* 사진/영상 업로드 */}
              <View style={s.formField}>
                <Text style={s.formLabel}>사진 · 영상</Text>

                {/* 미디어 목록 */}
                {mediaItems.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.mediaRow}>
                    {mediaItems.map((item, idx) => (
                      <View key={idx} style={s.mediaThumbnail}>
                        {item.type === "image" && item.localUri ? (
                          <Image source={{ uri: item.localUri }} style={s.mediaImg} resizeMode="cover" />
                        ) : (
                          <View style={[s.mediaImg, s.videoPlaceholder]}>
                            <Feather name="film" size={28} color="#fff" />
                          </View>
                        )}
                        {item.uploading && (
                          <View style={s.mediaOverlay}>
                            <ActivityIndicator color="#fff" size="small" />
                          </View>
                        )}
                        {!item.uploading && (
                          <Pressable
                            style={s.mediaDeleteBtn}
                            onPress={() => removeLocalMedia(item.localUri!)}
                          >
                            <Feather name="x" size={12} color="#fff" />
                          </Pressable>
                        )}
                      </View>
                    ))}
                  </ScrollView>
                )}

                {/* 추가 버튼 */}
                <View style={s.mediaButtons}>
                  <Pressable style={[s.mediaAddBtn, { borderColor: themeColor }]} onPress={() => pickMedia("images")}>
                    <Feather name="image" size={16} color={themeColor} />
                    <Text style={[s.mediaAddText, { color: themeColor }]}>사진 추가</Text>
                  </Pressable>
                  <Pressable style={[s.mediaAddBtn, { borderColor: themeColor }]} onPress={() => pickMedia("videos")}>
                    <Feather name="video" size={16} color={themeColor} />
                    <Text style={[s.mediaAddText, { color: themeColor }]}>영상 추가</Text>
                  </Pressable>
                </View>
              </View>

              <View style={{ height: 120 }} />
            </ScrollView>

            {/* 저장 버튼 */}
            <View style={s.footer}>
              <Pressable style={[s.cancelBtn, { borderColor: C.border }]} onPress={() => setSelectedGroup(null)}>
                <Text style={[s.cancelBtnText, { color: C.textSecondary }]}>나가기</Text>
              </Pressable>
              <Pressable
                style={[s.saveBtn, { backgroundColor: themeColor, opacity: saving ? 0.7 : 1, flex: 2 }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <><Feather name="save" size={16} color="#fff" /><Text style={s.saveBtnText}>저장</Text></>}
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        ) : (
          // ── 지난 일지 목록 ──
          <>
            {diaryLoading ? (
              <ActivityIndicator color={themeColor} style={{ marginTop: 40 }} />
            ) : (
              <FlatList
                data={diaries}
                keyExtractor={i => i.id}
                contentContainerStyle={s.diaryList}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                  <View style={s.emptyBox}>
                    <Feather name="book-open" size={32} color={C.textMuted} />
                    <Text style={s.emptyText}>작성된 일지가 없습니다</Text>
                  </View>
                }
                renderItem={({ item }) => {
                  const medias: MediaItem[] = Array.isArray(item.media_items) ? item.media_items : [];
                  return (
                    <View style={[s.diaryCard, { backgroundColor: C.card }]}>
                      <View style={s.diaryCardHeader}>
                        <Text style={s.diaryCardTitle}>{item.title || "수업 일지"}</Text>
                        <Text style={s.diaryCardDate}>{item.created_at?.slice(0, 10)}</Text>
                      </View>
                      {item.lesson_content && (
                        <Text style={s.diaryCardContent} numberOfLines={3}>{item.lesson_content}</Text>
                      )}

                      {/* 미디어 썸네일 */}
                      {medias.length > 0 && (
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.mediaRow}>
                          {medias.map((m, i) => (
                            <View key={i} style={s.mediaThumbnail}>
                              {m.type === "image" && m.key ? (
                                <Image source={{ uri: mediaUrl(m.key) }} style={s.mediaImg} resizeMode="cover" />
                              ) : (
                                <View style={[s.mediaImg, s.videoPlaceholder]}>
                                  <Feather name="film" size={24} color="#fff" />
                                </View>
                              )}
                              <Pressable
                                style={s.mediaDeleteBtn}
                                onPress={() => {
                                  if (m.key) deleteHistoryMedia(item.id, m.key);
                                }}
                              >
                                <Feather name="x" size={12} color="#fff" />
                              </Pressable>
                            </View>
                          ))}
                        </ScrollView>
                      )}
                    </View>
                  );
                }}
              />
            )}
          </>
        )}
      </SafeAreaView>
    );
  }

  // ── 메인 시간표 뷰 ─────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <PoolHeader />
      <View style={s.titleRow}>
        <Text style={s.title}>수영일지</Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        <WeeklySchedule
          classGroups={groups}
          statusMap={statusMap}
          onSelectClass={openGroup}
          themeColor={themeColor}
        />
        <View style={{ height: 120 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#F3F4F6" },
  titleRow:     { paddingHorizontal: 16, paddingVertical: 10 },
  title:        { fontSize: 20, fontFamily: "Inter_700Bold", color: "#111827" },

  subHeader:    { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  backBtn:      { width: 36, height: 36, borderRadius: 10, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  subTitle:     { fontSize: 16, fontFamily: "Inter_700Bold", color: "#111827" },
  subSub:       { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 1 },

  historyBtn:   { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1.5 },
  historyBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  writeForm:    { padding: 16, gap: 16, paddingBottom: 80 },
  formField:    { gap: 8 },
  formLabel:    { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#374151" },
  formInput:    { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827", backgroundColor: "#fff" },

  mediaRow:     { gap: 10, paddingVertical: 4 },
  mediaThumbnail: { width: 90, height: 90, borderRadius: 10, overflow: "hidden", position: "relative" },
  mediaImg:     { width: 90, height: 90 },
  videoPlaceholder: { backgroundColor: "#374151", alignItems: "center", justifyContent: "center" },
  mediaOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
  mediaDeleteBtn: { position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center" },

  mediaButtons: { flexDirection: "row", gap: 10 },
  mediaAddBtn:  { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1.5, borderRadius: 12, paddingVertical: 10, backgroundColor: "#fff" },
  mediaAddText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  footer:       { flexDirection: "row", gap: 10, padding: 12, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  cancelBtn:    { flex: 1, height: 50, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  cancelBtnText:{ fontSize: 14, fontFamily: "Inter_600SemiBold" },
  saveBtn:      { flexDirection: "row", height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", gap: 8 },
  saveBtnText:  { color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },

  diaryList:    { padding: 12, gap: 10, paddingBottom: 120 },
  diaryCard:    { borderRadius: 14, padding: 14, gap: 8 },
  diaryCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  diaryCardTitle:  { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#111827" },
  diaryCardDate:   { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  diaryCardContent:{ fontSize: 13, fontFamily: "Inter_400Regular", color: "#4B5563" },

  emptyBox:     { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyText:    { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
});
