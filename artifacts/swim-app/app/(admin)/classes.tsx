import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform,
  Pressable, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

interface Class {
  id: string; name: string; instructor: string; schedule: string; capacity?: number | null; member_count?: number | null; created_at: string;
}
interface Member { id: string; name: string; phone: string; class_id?: string | null; }

export default function ClassesScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const C = Colors.light;
  const [classes, setClasses] = useState<Class[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showAddMember, setShowAddMember] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", instructor: "", schedule: "", capacity: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function fetchAll() {
    try {
      const [cr, mr] = await Promise.all([apiRequest(token, "/classes"), apiRequest(token, "/members")]);
      const [cls, mbs] = await Promise.all([cr.json(), mr.json()]);
      setClasses(Array.isArray(cls) ? cls : []);
      setMembers(Array.isArray(mbs) ? mbs : []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  useEffect(() => { fetchAll(); }, []);

  async function handleCreate() {
    if (!form.name || !form.instructor || !form.schedule) { setError("필수 항목을 입력해주세요."); return; }
    setSaving(true); setError("");
    try {
      const res = await apiRequest(token, "/classes", { method: "POST", body: JSON.stringify({ ...form, capacity: form.capacity ? parseInt(form.capacity) : undefined }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setClasses(prev => [...prev, data]);
      setShowModal(false);
      setForm({ name: "", instructor: "", schedule: "", capacity: "" });
    } catch (err: unknown) { setError(err instanceof Error ? err.message : "오류가 발생했습니다."); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string, name: string) {
    Alert.alert("반 삭제", `${name} 반을 삭제하시겠습니까?`, [
      { text: "취소", style: "cancel" },
      { text: "삭제", style: "destructive", onPress: async () => {
        await apiRequest(token, `/classes/${id}`, { method: "DELETE" });
        setClasses(prev => prev.filter(c => c.id !== id));
      }},
    ]);
  }

  async function handleAddMember(classId: string, memberId: string) {
    await apiRequest(token, `/classes/${classId}/members`, { method: "POST", body: JSON.stringify({ member_id: memberId }) });
    await fetchAll();
    setShowAddMember(null);
  }

  const unassignedMembers = members.filter(m => !m.class_id);

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <Text style={[styles.title, { color: C.text }]}>반 관리</Text>
        <Pressable style={[styles.addBtn, { backgroundColor: C.tint }]} onPress={() => setShowModal(true)}>
          <Feather name="plus" size={16} color="#fff" />
          <Text style={styles.addBtnText}>반 등록</Text>
        </Pressable>
      </View>

      {loading ? <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} /> : (
        <FlatList
          data={classes}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, paddingTop: 8, gap: 12 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="layers" size={40} color={C.textMuted} />
              <Text style={[styles.emptyText, { color: C.textMuted }]}>등록된 반이 없습니다</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.shadow }]}>
              <View style={styles.cardTop}>
                <View style={[styles.classIcon, { backgroundColor: "#F3E8FF" }]}>
                  <Feather name="layers" size={20} color="#7C3AED" />
                </View>
                <View style={styles.cardInfo}>
                  <Text style={[styles.className, { color: C.text }]}>{item.name}</Text>
                  <Text style={[styles.classDetail, { color: C.textSecondary }]}>강사: {item.instructor}</Text>
                  <Text style={[styles.classDetail, { color: C.textSecondary }]}>{item.schedule}</Text>
                </View>
                <View style={styles.cardActions}>
                  <View style={[styles.countBadge, { backgroundColor: C.tintLight }]}>
                    <Text style={[styles.countText, { color: C.tint }]}>{item.member_count || 0}명</Text>
                  </View>
                </View>
              </View>
              <View style={styles.cardBottom}>
                <Pressable
                  style={[styles.actionBtn, { backgroundColor: "#F3E8FF" }]}
                  onPress={() => setShowAddMember(item.id)}
                >
                  <Feather name="user-plus" size={14} color="#7C3AED" />
                  <Text style={[styles.actionBtnText, { color: "#7C3AED" }]}>회원 배정</Text>
                </Pressable>
                <Pressable
                  style={[styles.actionBtn, { backgroundColor: "#FEE2E2" }]}
                  onPress={() => handleDelete(item.id, item.name)}
                >
                  <Feather name="trash-2" size={14} color={C.error} />
                  <Text style={[styles.actionBtnText, { color: C.error }]}>삭제</Text>
                </Pressable>
              </View>
            </View>
          )}
        />
      )}

      <Modal visible={showModal} animationType="slide" transparent onRequestClose={() => setShowModal(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={[styles.modalSheet, { backgroundColor: C.card, paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: C.text }]}>반 등록</Text>
              <Pressable onPress={() => setShowModal(false)}>
                <Feather name="x" size={22} color={C.textSecondary} />
              </Pressable>
            </View>
            {error ? <Text style={[styles.errorText, { color: C.error }]}>{error}</Text> : null}
            {[
              { key: "name", label: "반 이름 *", placeholder: "예: 초급반 A" },
              { key: "instructor", label: "담당 강사 *", placeholder: "강사 이름" },
              { key: "schedule", label: "수업 일정 *", placeholder: "예: 월·수·금 09:00-10:00" },
              { key: "capacity", label: "정원", placeholder: "최대 인원 수" },
            ].map(({ key, label, placeholder }) => (
              <View key={key} style={styles.field}>
                <Text style={[styles.label, { color: C.textSecondary }]}>{label}</Text>
                <TextInput
                  style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.background }]}
                  value={form[key as keyof typeof form]}
                  onChangeText={(v) => setForm(f => ({ ...f, [key]: v }))}
                  placeholder={placeholder}
                  placeholderTextColor={C.textMuted}
                  keyboardType={key === "capacity" ? "number-pad" : "default"}
                />
              </View>
            ))}
            <Pressable style={({ pressed }) => [styles.saveBtn, { backgroundColor: C.tint, opacity: pressed ? 0.85 : 1 }]} onPress={handleCreate} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>등록하기</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!showAddMember} animationType="slide" transparent onRequestClose={() => setShowAddMember(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: C.card, paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: C.text }]}>회원 배정</Text>
              <Pressable onPress={() => setShowAddMember(null)}>
                <Feather name="x" size={22} color={C.textSecondary} />
              </Pressable>
            </View>
            {unassignedMembers.length === 0 ? (
              <Text style={[styles.emptyText, { color: C.textMuted, textAlign: "center", paddingVertical: 20 }]}>배정 가능한 회원이 없습니다</Text>
            ) : (
              <FlatList
                data={unassignedMembers}
                keyExtractor={(item) => item.id}
                style={{ maxHeight: 300 }}
                renderItem={({ item }) => (
                  <Pressable
                    style={[styles.memberSelectItem, { borderColor: C.border }]}
                    onPress={() => showAddMember && handleAddMember(showAddMember, item.id)}
                  >
                    <View style={[styles.avatar, { backgroundColor: C.tintLight }]}>
                      <Text style={[styles.avatarText, { color: C.tint }]}>{item.name[0]}</Text>
                    </View>
                    <View>
                      <Text style={[styles.memberName, { color: C.text }]}>{item.name}</Text>
                      <Text style={[styles.classDetail, { color: C.textSecondary }]}>{item.phone}</Text>
                    </View>
                    <Feather name="plus-circle" size={20} color={C.tint} style={{ marginLeft: "auto" }} />
                  </Pressable>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  addBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  card: { borderRadius: 16, padding: 16, gap: 14, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 10, elevation: 3 },
  cardTop: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  classIcon: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  cardInfo: { flex: 1, gap: 3 },
  className: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  classDetail: { fontSize: 13, fontFamily: "Inter_400Regular" },
  cardActions: { alignItems: "flex-end" },
  countBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  countText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  cardBottom: { flexDirection: "row", gap: 8 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8, borderRadius: 10 },
  actionBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
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
  memberSelectItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1 },
  avatar: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  memberName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
