import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

interface Notice {
  id: string; title: string; content: string; author_name: string; is_pinned: boolean; created_at: string;
}

export default function NoticesScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const C = Colors.light;
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ title: "", content: "", is_pinned: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  async function fetchNotices() {
    try {
      const res = await apiRequest(token, "/notices");
      const data = await res.json();
      setNotices(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }

  useEffect(() => { fetchNotices(); }, []);

  async function handleCreate() {
    if (!form.title || !form.content) { setError("제목과 내용을 입력해주세요."); return; }
    setSaving(true); setError("");
    try {
      const res = await apiRequest(token, "/notices", { method: "POST", body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setNotices(prev => [data, ...prev]);
      setShowModal(false);
      setForm({ title: "", content: "", is_pinned: false });
    } catch (err: unknown) { setError(err instanceof Error ? err.message : "오류가 발생했습니다."); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    Alert.alert("공지 삭제", "이 공지사항을 삭제하시겠습니까?", [
      { text: "취소", style: "cancel" },
      { text: "삭제", style: "destructive", onPress: async () => {
        await apiRequest(token, `/notices/${id}`, { method: "DELETE" });
        setNotices(prev => prev.filter(n => n.id !== id));
      }},
    ]);
  }

  const pinned = notices.filter(n => n.is_pinned);
  const regular = notices.filter(n => !n.is_pinned);

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <Text style={[styles.title, { color: C.text }]}>공지사항</Text>
        <Pressable style={[styles.addBtn, { backgroundColor: C.tint }]} onPress={() => setShowModal(true)}>
          <Feather name="edit-3" size={16} color="#fff" />
          <Text style={styles.addBtnText}>공지 작성</Text>
        </Pressable>
      </View>

      {loading ? <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} /> : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, paddingTop: 8, gap: 10 }}
          showsVerticalScrollIndicator={false}
        >
          {pinned.length > 0 && (
            <>
              <View style={styles.sectionLabel}>
                <Feather name="pin" size={13} color={C.tint} />
                <Text style={[styles.sectionText, { color: C.tint }]}>고정 공지</Text>
              </View>
              {pinned.map((n) => <NoticeCard key={n.id} n={n} expanded={expanded} setExpanded={setExpanded} handleDelete={handleDelete} C={C} />)}
              {regular.length > 0 && (
                <View style={styles.sectionLabel}>
                  <Text style={[styles.sectionText, { color: C.textSecondary }]}>일반 공지</Text>
                </View>
              )}
            </>
          )}
          {regular.map((n) => <NoticeCard key={n.id} n={n} expanded={expanded} setExpanded={setExpanded} handleDelete={handleDelete} C={C} />)}
          {notices.length === 0 && (
            <View style={styles.empty}>
              <Feather name="bell-off" size={40} color={C.textMuted} />
              <Text style={[styles.emptyText, { color: C.textMuted }]}>등록된 공지사항이 없습니다</Text>
            </View>
          )}
        </ScrollView>
      )}

      <Modal visible={showModal} animationType="slide" transparent onRequestClose={() => setShowModal(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={[styles.modalSheet, { backgroundColor: C.card, paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: C.text }]}>공지 작성</Text>
              <Pressable onPress={() => setShowModal(false)}>
                <Feather name="x" size={22} color={C.textSecondary} />
              </Pressable>
            </View>
            {error ? <Text style={[styles.errorText, { color: C.error }]}>{error}</Text> : null}
            <View style={styles.field}>
              <Text style={[styles.label, { color: C.textSecondary }]}>제목 *</Text>
              <TextInput
                style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.background }]}
                value={form.title}
                onChangeText={(v) => setForm(f => ({ ...f, title: v }))}
                placeholder="공지 제목"
                placeholderTextColor={C.textMuted}
              />
            </View>
            <View style={styles.field}>
              <Text style={[styles.label, { color: C.textSecondary }]}>내용 *</Text>
              <TextInput
                style={[styles.textarea, { borderColor: C.border, color: C.text, backgroundColor: C.background }]}
                value={form.content}
                onChangeText={(v) => setForm(f => ({ ...f, content: v }))}
                placeholder="공지 내용을 입력하세요"
                placeholderTextColor={C.textMuted}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>
            <Pressable
              style={[styles.pinToggle, { backgroundColor: form.is_pinned ? C.tintLight : C.background, borderColor: form.is_pinned ? C.tint : C.border }]}
              onPress={() => setForm(f => ({ ...f, is_pinned: !f.is_pinned }))}
            >
              <Feather name="pin" size={16} color={form.is_pinned ? C.tint : C.textMuted} />
              <Text style={[styles.pinText, { color: form.is_pinned ? C.tint : C.textSecondary }]}>상단 고정</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.saveBtn, { backgroundColor: C.tint, opacity: pressed ? 0.85 : 1 }]} onPress={handleCreate} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>게시하기</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function NoticeCard({ n, expanded, setExpanded, handleDelete, C }: { n: Notice; expanded: string | null; setExpanded: (id: string | null) => void; handleDelete: (id: string) => void; C: typeof Colors.light }) {
  const isOpen = expanded === n.id;
  return (
    <Pressable
      style={[styles.card, { backgroundColor: C.card, shadowColor: C.shadow, borderLeftWidth: n.is_pinned ? 3 : 0, borderLeftColor: C.tint }]}
      onPress={() => setExpanded(isOpen ? null : n.id)}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardTop}>
          {n.is_pinned ? <Feather name="pin" size={12} color={C.tint} /> : null}
          <Text style={[styles.noticeTitle, { color: C.text }]} numberOfLines={isOpen ? undefined : 1}>{n.title}</Text>
        </View>
        <Pressable onPress={() => handleDelete(n.id)} style={styles.deleteBtn}>
          <Feather name="trash-2" size={16} color={C.error} />
        </Pressable>
      </View>
      {isOpen && <Text style={[styles.noticeContent, { color: C.textSecondary }]}>{n.content}</Text>}
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
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  addBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  sectionLabel: { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  card: { borderRadius: 14, padding: 14, gap: 8, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8, elevation: 2 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  noticeTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", flex: 1 },
  noticeContent: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },
  deleteBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  cardMeta: { flexDirection: "row", justifyContent: "space-between" },
  metaText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  empty: { alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  emptyText: { fontSize: 15, fontFamily: "Inter_400Regular" },
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 14 },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 8 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  modalTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  errorText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  field: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, height: 46, fontSize: 15, fontFamily: "Inter_400Regular" },
  textarea: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingTop: 12, height: 100, fontSize: 15, fontFamily: "Inter_400Regular" },
  pinToggle: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1.5 },
  pinText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  saveBtn: { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 4 },
  saveBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
