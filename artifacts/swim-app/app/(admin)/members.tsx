import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform,
  Pressable, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

interface Member {
  id: string; name: string; phone: string; birth_date?: string | null;
  memo?: string | null; class_id?: string | null; class_name?: string | null; created_at: string;
}

export default function MembersScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const C = Colors.light;
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", birth_date: "", memo: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  async function fetchMembers() {
    try {
      const res = await apiRequest(token, "/members");
      const data = await res.json();
      setMembers(Array.isArray(data) ? data : []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  useEffect(() => { fetchMembers(); }, []);

  async function handleCreate() {
    if (!form.name || !form.phone) { setError("이름과 전화번호를 입력해주세요."); return; }
    setSaving(true); setError("");
    try {
      const res = await apiRequest(token, "/members", { method: "POST", body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMembers(prev => [data, ...prev]);
      setShowModal(false);
      setForm({ name: "", phone: "", birth_date: "", memo: "" });
    } catch (err: unknown) { setError(err instanceof Error ? err.message : "오류가 발생했습니다."); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string, name: string) {
    Alert.alert("회원 삭제", `${name} 회원을 삭제하시겠습니까?`, [
      { text: "취소", style: "cancel" },
      { text: "삭제", style: "destructive", onPress: async () => {
        await apiRequest(token, `/members/${id}`, { method: "DELETE" });
        setMembers(prev => prev.filter(m => m.id !== id));
      }},
    ]);
  }

  const filtered = members.filter(m => m.name.includes(search) || m.phone.includes(search));

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <Text style={[styles.title, { color: C.text }]}>회원 관리</Text>
        <Pressable style={[styles.addBtn, { backgroundColor: C.tint }]} onPress={() => setShowModal(true)}>
          <Feather name="user-plus" size={16} color="#fff" />
          <Text style={styles.addBtnText}>회원 등록</Text>
        </Pressable>
      </View>

      <View style={[styles.searchBox, { borderColor: C.border, backgroundColor: C.card, marginHorizontal: 20 }]}>
        <Feather name="search" size={16} color={C.textMuted} />
        <TextInput
          style={[styles.searchInput, { color: C.text }]}
          value={search}
          onChangeText={setSearch}
          placeholder="이름 또는 전화번호 검색"
          placeholderTextColor={C.textMuted}
        />
      </View>

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, paddingTop: 12, gap: 10 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="users" size={40} color={C.textMuted} />
              <Text style={[styles.emptyText, { color: C.textMuted }]}>등록된 회원이 없습니다</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.shadow }]}>
              <View style={[styles.avatar, { backgroundColor: C.tintLight }]}>
                <Text style={[styles.avatarText, { color: C.tint }]}>{item.name[0]}</Text>
              </View>
              <View style={styles.cardInfo}>
                <Text style={[styles.memberName, { color: C.text }]}>{item.name}</Text>
                <Text style={[styles.memberPhone, { color: C.textSecondary }]}>{item.phone}</Text>
                {item.class_name ? (
                  <View style={[styles.classBadge, { backgroundColor: C.tintLight }]}>
                    <Text style={[styles.classBadgeText, { color: C.tint }]}>{item.class_name}</Text>
                  </View>
                ) : null}
                <Pressable
                  style={[styles.diaryBtn, { backgroundColor: "#059669" + "1A" }]}
                  onPress={() => router.push({ pathname: "/(admin)/diary-write", params: { studentId: item.id, studentName: item.name } } as any)}
                >
                  <Feather name="book-open" size={12} color="#059669" />
                  <Text style={[styles.diaryBtnText, { color: "#059669" }]}>수영 일지 작성</Text>
                </Pressable>
              </View>
              <Pressable onPress={() => handleDelete(item.id, item.name)} style={styles.deleteBtn}>
                <Feather name="trash-2" size={18} color={C.error} />
              </Pressable>
            </View>
          )}
        />
      )}

      <Modal visible={showModal} animationType="slide" transparent onRequestClose={() => setShowModal(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={[styles.modalSheet, { backgroundColor: C.card, paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: C.text }]}>회원 등록</Text>
              <Pressable onPress={() => setShowModal(false)}>
                <Feather name="x" size={22} color={C.textSecondary} />
              </Pressable>
            </View>

            {error ? <Text style={[styles.errorText, { color: C.error }]}>{error}</Text> : null}

            {[
              { key: "name", label: "이름 *", placeholder: "회원 이름" },
              { key: "phone", label: "전화번호 *", placeholder: "010-0000-0000" },
              { key: "birth_date", label: "생년월일", placeholder: "2000-01-01" },
              { key: "memo", label: "메모", placeholder: "특이사항 등" },
            ].map(({ key, label, placeholder }) => (
              <View key={key} style={styles.field}>
                <Text style={[styles.label, { color: C.textSecondary }]}>{label}</Text>
                <TextInput
                  style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.background }]}
                  value={form[key as keyof typeof form]}
                  onChangeText={(v) => setForm(f => ({ ...f, [key]: v }))}
                  placeholder={placeholder}
                  placeholderTextColor={C.textMuted}
                />
              </View>
            ))}

            <Pressable
              style={({ pressed }) => [styles.saveBtn, { backgroundColor: C.tint, opacity: pressed ? 0.85 : 1 }]}
              onPress={handleCreate}
              disabled={saving}
            >
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>등록하기</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  addBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, height: 44, marginBottom: 4 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  card: { flexDirection: "row", alignItems: "center", borderRadius: 14, padding: 14, gap: 12, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8, elevation: 2 },
  avatar: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 20, fontFamily: "Inter_700Bold" },
  cardInfo: { flex: 1, gap: 3 },
  memberName: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  memberPhone: { fontSize: 13, fontFamily: "Inter_400Regular" },
  classBadge: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, marginTop: 2 },
  classBadgeText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  deleteBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  diaryBtn: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginTop: 4 },
  diaryBtnText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
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
  saveBtn: { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 4 },
  saveBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
