import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useSelectionMode } from "@/hooks/useSelectionMode";
import { SelectionActionBar } from "@/components/admin/SelectionActionBar";

interface Notice {
  id: string;
  title: string;
  content: string;
  author_name: string;
  is_pinned: boolean;
  created_at: string;
  notice_type?: string;
  student_name?: string | null;
  image_urls?: string[];
}

interface ReadStats { read_count: number; unread_count: number; total: number; }

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "";
const MAX_IMAGES = 5;

export default function NoticesScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const C = Colors.light;
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ title: "", content: "", is_pinned: false });
  const [pickedImages, setPickedImages] = useState<{ uri: string; key?: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [readStats, setReadStats] = useState<Record<string, ReadStats>>({});
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const sel = useSelectionMode();

  async function fetchNotices() {
    try {
      const res = await apiRequest(token, "/notices");
      const data = await res.json();
      setNotices(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }

  useEffect(() => { fetchNotices(); }, []);

  async function fetchReadStats(id: string) {
    if (readStats[id]) return;
    try {
      const res = await apiRequest(token, `/notices/${id}/read-stats`);
      if (res.ok) {
        const data = await res.json();
        setReadStats(prev => ({ ...prev, [id]: data }));
      }
    } catch { }
  }

  function handleExpand(id: string) {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    fetchReadStats(id);
  }

  async function pickImages() {
    if (pickedImages.length >= MAX_IMAGES) {
      Alert.alert("사진 제한", `최대 ${MAX_IMAGES}장까지 첨부 가능합니다.`); return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.8,
      selectionLimit: MAX_IMAGES - pickedImages.length,
    });
    if (!result.canceled) {
      const added = result.assets.slice(0, MAX_IMAGES - pickedImages.length);
      setPickedImages(prev => [...prev, ...added.map(a => ({ uri: a.uri }))]);
    }
  }

  function removeImage(index: number) {
    setPickedImages(prev => prev.filter((_, i) => i !== index));
  }

  async function uploadImages(): Promise<string[]> {
    if (pickedImages.length === 0) return [];
    setUploading(true);
    try {
      const formData = new FormData();
      for (const img of pickedImages) {
        const filename = img.uri.split("/").pop() || "photo.jpg";
        const ext = filename.split(".").pop()?.toLowerCase() || "jpg";
        const mimeType = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : "image/jpeg";
        formData.append("images", { uri: img.uri, name: filename, type: mimeType } as any);
      }
      const res = await fetch(`${API_BASE}/api/uploads`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "이미지 업로드에 실패했습니다.");
      if (!Array.isArray(data.urls) || data.urls.length === 0) throw new Error("이미지 업로드 결과를 받지 못했습니다.");
      return data.urls as string[];
    } finally { setUploading(false); }
  }

  async function handleCreate() {
    if (!form.title || !form.content) { setError("제목과 내용을 입력해주세요."); return; }
    setSaving(true); setError("");
    try {
      // 이미지 첨부가 있으면 먼저 업로드 — 실패 시 예외 발생으로 발송 차단
      let image_urls: string[] = [];
      if (pickedImages.length > 0) {
        image_urls = await uploadImages();
      }
      const res = await apiRequest(token, "/notices", {
        method: "POST",
        body: JSON.stringify({ ...form, image_urls }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "공지 저장에 실패했습니다.");
      setNotices(prev => [data, ...prev]);
      setShowModal(false);
      setForm({ title: "", content: "", is_pinned: false });
      setPickedImages([]);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : "오류가 발생했습니다."); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    Alert.alert("공지 삭제", "이 공지사항을 삭제하시겠습니까?", [
      { text: "취소", style: "cancel" },
      { text: "삭제", style: "destructive", onPress: async () => {
        await apiRequest(token, `/notices/${id}`, { method: "DELETE" });
        setNotices(prev => prev.filter(n => n.id !== id));
        setExpanded(null);
      }},
    ]);
  }

  function handleBulkDelete() {
    const ids = Array.from(sel.selectedIds);
    if (ids.length === 0) return;
    const count = ids.length;
    Alert.alert(
      "선택 공지 삭제",
      `선택한 공지 ${count}건을 삭제하시겠습니까?`,
      [
        { text: "취소", style: "cancel" },
        {
          text: `${count}건 삭제`, style: "destructive", onPress: async () => {
            setBulkDeleting(true);
            try {
              const results = await Promise.allSettled(
                ids.map(id => apiRequest(token, `/notices/${id}`, { method: "DELETE" })
                  .then(r => ({ id, ok: r.ok }))
                )
              );
              const succeeded = results
                .filter((r): r is PromiseFulfilledResult<{ id: string; ok: boolean }> => r.status === "fulfilled" && r.value.ok)
                .map(r => r.value.id);
              const failed = ids.length - succeeded.length;
              setNotices(prev => prev.filter(n => !succeeded.includes(n.id)));
              if (expanded && succeeded.includes(expanded)) setExpanded(null);
              sel.exitSelectionMode();
              if (failed > 0) Alert.alert("일부 실패", `${failed}건 삭제에 실패했습니다.`);
            } catch (e) {
              console.error(e);
              Alert.alert("오류", "삭제 중 오류가 발생했습니다.");
            } finally {
              setBulkDeleting(false);
            }
          },
        },
      ]
    );
  }

  function closeModal() {
    setShowModal(false);
    setForm({ title: "", content: "", is_pinned: false });
    setPickedImages([]);
    setError("");
  }

  const pinned = notices.filter(n => n.is_pinned);
  const regular = notices.filter(n => !n.is_pinned);
  const allNoticeIds = notices.map(n => n.id);

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <Text style={[styles.title, { color: C.text }]}>공지사항</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable
            style={[styles.selBtn, sel.selectionMode && { backgroundColor: C.tintLight }]}
            onPress={sel.toggleSelectionMode}
          >
            <Feather name="check-square" size={16} color={sel.selectionMode ? C.tint : C.textSecondary} />
            <Text style={[styles.selBtnText, sel.selectionMode && { color: C.tint }]}>
              {sel.selectionMode ? "취소" : "선택"}
            </Text>
          </Pressable>
          {!sel.selectionMode && (
            <Pressable style={[styles.addBtn, { backgroundColor: C.tint }]} onPress={() => setShowModal(true)}>
              <Feather name="edit-3" size={16} color="#fff" />
              <Text style={styles.addBtnText}>공지 작성</Text>
            </Pressable>
          )}
        </View>
      </View>

      {loading ? <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} /> : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: sel.selectionMode ? insets.bottom + 90 : insets.bottom + 100, paddingTop: 8, gap: 10 }}
          showsVerticalScrollIndicator={false}
        >
          {pinned.length > 0 && (
            <>
              <View style={styles.sectionLabel}>
                <Feather name="pin" size={13} color={C.tint} />
                <Text style={[styles.sectionText, { color: C.tint }]}>고정 공지</Text>
              </View>
              {pinned.map(n => (
                <NoticeCard key={n.id} n={n} expanded={sel.selectionMode ? null : expanded} onExpand={sel.selectionMode ? () => sel.toggleItem(n.id) : handleExpand} handleDelete={handleDelete} readStats={readStats[n.id]} C={C}
                  selectionMode={sel.selectionMode} isSelected={sel.isSelected(n.id)} onToggle={() => sel.toggleItem(n.id)}
                />
              ))}
              {regular.length > 0 && (
                <View style={styles.sectionLabel}>
                  <Text style={[styles.sectionText, { color: C.textSecondary }]}>일반 공지</Text>
                </View>
              )}
            </>
          )}
          {regular.map(n => (
            <NoticeCard key={n.id} n={n} expanded={sel.selectionMode ? null : expanded} onExpand={sel.selectionMode ? () => sel.toggleItem(n.id) : handleExpand} handleDelete={handleDelete} readStats={readStats[n.id]} C={C}
              selectionMode={sel.selectionMode} isSelected={sel.isSelected(n.id)} onToggle={() => sel.toggleItem(n.id)}
            />
          ))}
          {notices.length === 0 && (
            <View style={styles.empty}>
              <Feather name="bell-off" size={40} color={C.textMuted} />
              <Text style={[styles.emptyText, { color: C.textMuted }]}>등록된 공지사항이 없습니다</Text>
            </View>
          )}
        </ScrollView>
      )}

      <SelectionActionBar
        visible={sel.selectionMode}
        selectedCount={sel.selectedCount}
        totalCount={notices.length}
        isAllSelected={sel.isAllSelected(allNoticeIds)}
        deleting={bulkDeleting}
        onSelectAll={() => sel.selectAll(allNoticeIds)}
        onClearSelection={sel.clearSelection}
        onDeleteSelected={handleBulkDelete}
        onExit={sel.exitSelectionMode}
      />

      <Modal visible={showModal} animationType="slide" transparent onRequestClose={closeModal}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={[styles.modalSheet, { backgroundColor: C.card, paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHandle} />
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: C.text }]}>공지 작성</Text>
                <Pressable onPress={closeModal}><Feather name="x" size={22} color={C.textSecondary} /></Pressable>
              </View>
              {error ? <Text style={[styles.errorText, { color: C.error }]}>{error}</Text> : null}

              <View style={[styles.field, { marginTop: 8 }]}>
                <Text style={[styles.label, { color: C.textSecondary }]}>제목 *</Text>
                <TextInput
                  style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.background }]}
                  value={form.title} onChangeText={v => setForm(f => ({ ...f, title: v }))}
                  placeholder="공지 제목" placeholderTextColor={C.textMuted}
                />
              </View>

              <View style={styles.field}>
                <Text style={[styles.label, { color: C.textSecondary }]}>내용 *</Text>
                <TextInput
                  style={[styles.textarea, { borderColor: C.border, color: C.text, backgroundColor: C.background }]}
                  value={form.content} onChangeText={v => setForm(f => ({ ...f, content: v }))}
                  placeholder="공지 내용을 입력하세요" placeholderTextColor={C.textMuted}
                  multiline numberOfLines={4} textAlignVertical="top"
                />
              </View>

              <View style={styles.field}>
                <View style={styles.imageHeader}>
                  <Text style={[styles.label, { color: C.textSecondary }]}>사진 첨부 ({pickedImages.length}/{MAX_IMAGES})</Text>
                  {pickedImages.length < MAX_IMAGES && (
                    <Pressable style={[styles.addImageBtn, { borderColor: C.border }]} onPress={pickImages}>
                      <Feather name="camera" size={16} color={C.tint} />
                      <Text style={[styles.addImageText, { color: C.tint }]}>사진 추가</Text>
                    </Pressable>
                  )}
                </View>
                {pickedImages.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
                    {pickedImages.map((img, i) => (
                      <View key={i} style={styles.previewWrap}>
                        <Image source={{ uri: img.uri }} style={styles.previewImage} resizeMode="cover" />
                        <Pressable style={[styles.removeImageBtn, { backgroundColor: C.error }]} onPress={() => removeImage(i)}>
                          <Feather name="x" size={12} color="#fff" />
                        </Pressable>
                      </View>
                    ))}
                  </ScrollView>
                )}
              </View>

              <Pressable
                style={[styles.pinToggle, { backgroundColor: form.is_pinned ? C.tintLight : C.background, borderColor: form.is_pinned ? C.tint : C.border }]}
                onPress={() => setForm(f => ({ ...f, is_pinned: !f.is_pinned }))}
              >
                <Feather name="pin" size={16} color={form.is_pinned ? C.tint : C.textMuted} />
                <Text style={[styles.pinText, { color: form.is_pinned ? C.tint : C.textSecondary }]}>상단 고정</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.saveBtn, { backgroundColor: C.tint, opacity: pressed || saving || uploading ? 0.75 : 1, marginTop: 4 }]}
                onPress={handleCreate}
                disabled={saving || uploading}
              >
                {saving || uploading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.saveBtnText}>게시하기</Text>}
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function NoticeCard({ n, expanded, onExpand, handleDelete, readStats, C, selectionMode, isSelected, onToggle }: {
  n: Notice;
  expanded: string | null;
  onExpand: (id: string) => void;
  handleDelete: (id: string) => void;
  readStats?: ReadStats;
  C: typeof Colors.light;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggle?: () => void;
}) {
  const isOpen = expanded === n.id;
  const images: string[] = Array.isArray(n.image_urls) ? n.image_urls : [];

  return (
    <Pressable
      style={[
        styles.card,
        { backgroundColor: C.card, shadowColor: C.shadow, borderLeftWidth: n.is_pinned ? 3 : 0, borderLeftColor: C.tint },
        isSelected && { borderWidth: 2, borderColor: C.tint, borderLeftWidth: 2 },
      ]}
      onPress={() => onExpand(n.id)}
    >
      <View style={styles.cardHeader}>
        {selectionMode && (
          <Pressable onPress={onToggle} style={[styles.deleteBtn, { marginRight: 4 }]}>
            <View style={[styles.selCheckbox, isSelected && { backgroundColor: C.tint, borderColor: C.tint }]}>
              {isSelected && <Feather name="check" size={11} color="#fff" />}
            </View>
          </Pressable>
        )}
        <View style={styles.cardTop}>
          {n.is_pinned ? <Feather name="pin" size={12} color={C.tint} /> : null}
          <Text style={[styles.noticeTitle, { color: C.text }]} numberOfLines={isOpen ? undefined : 1}>{n.title}</Text>
          {images.length > 0 && <Feather name="image" size={13} color={C.textMuted} />}
        </View>
        {!selectionMode && (
          <Pressable onPress={() => handleDelete(n.id)} style={styles.deleteBtn}>
            <Feather name="trash-2" size={16} color={C.error} />
          </Pressable>
        )}
      </View>

      {isOpen && (
        <View style={{ gap: 10 }}>
          <Text style={[styles.noticeContent, { color: C.textSecondary }]}>{n.content}</Text>
          {images.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {images.map((key, i) => (
                <Image
                  key={i}
                  source={{ uri: `${API_BASE}/api/uploads/${encodeURIComponent(key)}` }}
                  style={styles.thumbImage}
                  resizeMode="cover"
                />
              ))}
            </ScrollView>
          )}
          {readStats && (
            <View style={[styles.statsRow, { backgroundColor: C.background, borderRadius: 10, padding: 10 }]}>
              <View style={styles.statItem}>
                <Feather name="check-circle" size={14} color={C.success} />
                <Text style={[styles.statText, { color: C.success }]}>읽음 {readStats.read_count}명</Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: C.border }]} />
              <View style={styles.statItem}>
                <Feather name="circle" size={14} color={C.textMuted} />
                <Text style={[styles.statText, { color: C.textMuted }]}>미읽음 {readStats.unread_count}명</Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: C.border }]} />
              <View style={styles.statItem}>
                <Feather name="users" size={14} color={C.textSecondary} />
                <Text style={[styles.statText, { color: C.textSecondary }]}>전체 {readStats.total}명</Text>
              </View>
            </View>
          )}
        </View>
      )}

      <View style={styles.cardMeta}>
        <Text style={[styles.metaText, { color: C.textMuted }]}>{n.author_name}</Text>
        <Text style={[styles.metaText, { color: C.textMuted }]}>{new Date(n.created_at).toLocaleDateString("ko-KR")}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  selBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10 },
  selBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.textSecondary },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  addBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  sectionLabel: { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  card: { borderRadius: 14, padding: 14, gap: 8, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8, elevation: 2 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  noticeTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", flex: 1 },
  noticeContent: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },
  thumbImage: { width: 130, height: 130, borderRadius: 10 },
  statsRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  statItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  statText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  statDivider: { width: 1, height: 14 },
  deleteBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  selCheckbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 2, borderColor: "#D1D5DB", backgroundColor: "#F9FAFB", alignItems: "center", justifyContent: "center" },
  cardMeta: { flexDirection: "row", justifyContent: "space-between" },
  metaText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  empty: { alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  emptyText: { fontSize: 15, fontFamily: "Inter_400Regular" },
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 14, maxHeight: "90%" },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 8 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  modalTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  errorText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  field: { gap: 8, marginBottom: 14 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, height: 46, fontSize: 15, fontFamily: "Inter_400Regular" },
  textarea: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingTop: 12, height: 100, fontSize: 15, fontFamily: "Inter_400Regular" },
  imageHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  addImageBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  addImageText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  previewWrap: { position: "relative" },
  previewImage: { width: 90, height: 90, borderRadius: 10 },
  removeImageBtn: { position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  pinToggle: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1.5, marginBottom: 14 },
  pinText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  saveBtn: { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  saveBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
