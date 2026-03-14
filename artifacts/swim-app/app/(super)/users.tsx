import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform,
  Pressable, StyleSheet, Text, TextInput, View, RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

interface User { id: string; email: string; name: string; phone?: string; role: string; created_at: string; }

const PLATFORM_ROLES: Record<string, { label: string; color: string; bg: string }> = {
  super_admin: { label: "슈퍼관리자", color: "#7C3AED", bg: "#F3E8FF" },
  platform_operator: { label: "플랫폼운영자", color: "#3B82F6", bg: "#DBEAFE" },
  billing_admin: { label: "정산담당", color: "#059669", bg: "#D1FAE5" },
};

export default function UsersScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const C = Colors.light;
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", name: "", phone: "", role: "super_admin" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function fetchAll() {
    try {
      const ur = await apiRequest(token, "/admin/users");
      const us = await ur.json();
      setUsers(Array.isArray(us) ? us : []);
    } finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { fetchAll(); }, []);

  async function handleCreate() {
    if (!form.email || !form.password || !form.name) { setError("필수 항목을 모두 입력해주세요."); return; }
    setSaving(true); setError("");
    try {
      const res = await apiRequest(token, "/admin/users", { method: "POST", body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || "생성 실패");
      setUsers(prev => [data, ...prev]);
      setShowModal(false);
      setForm({ email: "", password: "", name: "", phone: "", role: "super_admin" });
    } catch (err: unknown) { setError(err instanceof Error ? err.message : "오류가 발생했습니다."); }
    finally { setSaving(false); }
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <View>
          <Text style={[styles.badge, { color: "#7C3AED" }]}>슈퍼관리자</Text>
          <Text style={[styles.title, { color: C.text }]}>플랫폼 관리자</Text>
          <Text style={[styles.subtitle, { color: C.textSecondary }]}>플랫폼 운영 계정만 표시</Text>
        </View>
        <Pressable style={[styles.addBtn, { backgroundColor: "#7C3AED" }]} onPress={() => setShowModal(true)}>
          <Feather name="user-plus" size={16} color="#fff" />
          <Text style={styles.addBtnText}>추가</Text>
        </Pressable>
      </View>

      {loading ? <ActivityIndicator color="#7C3AED" style={{ marginTop: 40 }} /> : (
        <FlatList
          data={users}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, gap: 10 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAll(); }} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="users" size={40} color={C.textMuted} />
              <Text style={[styles.emptyText, { color: C.textMuted }]}>등록된 관리자가 없습니다</Text>
            </View>
          }
          renderItem={({ item }) => {
            const rc = PLATFORM_ROLES[item.role] || { label: item.role, color: "#666", bg: "#EEE" };
            return (
              <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.shadow }]}>
                <View style={[styles.avatar, { backgroundColor: rc.bg }]}>
                  <Text style={[styles.avatarText, { color: rc.color }]}>{item.name[0]}</Text>
                </View>
                <View style={styles.userInfo}>
                  <Text style={[styles.userName, { color: C.text }]}>{item.name}</Text>
                  <Text style={[styles.userEmail, { color: C.textSecondary }]}>{item.email}</Text>
                </View>
                <View style={[styles.roleBadge, { backgroundColor: rc.bg }]}>
                  <Text style={[styles.roleText, { color: rc.color }]}>{rc.label}</Text>
                </View>
              </View>
            );
          }}
        />
      )}

      <Modal visible={showModal} animationType="slide" transparent onRequestClose={() => setShowModal(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={[styles.modalSheet, { backgroundColor: C.card, paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHandle} />
            <Text style={[styles.modalTitle, { color: C.text }]}>플랫폼 관리자 계정 생성</Text>
            <Text style={[styles.modalSubtitle, { color: C.textSecondary }]}>플랫폼 운영자만 관리할 수 있습니다</Text>
            {error ? <Text style={[styles.errorText, { color: C.error }]}>{error}</Text> : null}
            {[
              { key: "name", label: "이름 *", placeholder: "이름" },
              { key: "email", label: "이메일 *", placeholder: "이메일" },
              { key: "password", label: "비밀번호 *", placeholder: "6자 이상", secure: true },
              { key: "phone", label: "연락처", placeholder: "010-0000-0000" },
            ].map(({ key, label, placeholder, secure }) => (
              <View key={key} style={styles.field}>
                <Text style={[styles.label, { color: C.textSecondary }]}>{label}</Text>
                <TextInput
                  style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.background }]}
                  value={form[key as keyof typeof form]}
                  onChangeText={(v) => setForm(f => ({ ...f, [key]: v }))}
                  placeholder={placeholder}
                  placeholderTextColor={C.textMuted}
                  secureTextEntry={!!secure}
                  autoCapitalize="none"
                />
              </View>
            ))}
            <View style={styles.field}>
              <Text style={[styles.label, { color: C.textSecondary }]}>역할 *</Text>
              <View style={styles.roleRow}>
                {["super_admin", "platform_operator", "billing_admin"].map((r) => (
                  <Pressable
                    key={r}
                    style={[styles.roleOption, { backgroundColor: form.role === r ? PLATFORM_ROLES[r].bg : C.background, borderColor: form.role === r ? PLATFORM_ROLES[r].color : C.border }]}
                    onPress={() => setForm(f => ({ ...f, role: r }))}
                  >
                    <Text style={[styles.roleOptionText, { color: form.role === r ? PLATFORM_ROLES[r].color : C.textSecondary }]}>{PLATFORM_ROLES[r].label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <Pressable style={({ pressed }) => [styles.saveBtn, { backgroundColor: "#7C3AED", opacity: pressed ? 0.85 : 1 }]} onPress={handleCreate} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>계정 생성하기</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingHorizontal: 20, paddingBottom: 12 },
  badge: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  addBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  card: { flexDirection: "row", alignItems: "center", borderRadius: 14, padding: 14, gap: 12, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8, elevation: 2 },
  avatar: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  userInfo: { flex: 1, gap: 2 },
  userName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  userEmail: { fontSize: 12, fontFamily: "Inter_400Regular" },
  roleBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  roleText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  empty: { alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  emptyText: { fontSize: 15, fontFamily: "Inter_400Regular" },
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 12, maxHeight: "90%" },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 8 },
  modalTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  modalSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular" },
  errorText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  field: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, height: 46, fontSize: 15, fontFamily: "Inter_400Regular" },
  roleRow: { flexDirection: "row", gap: 8 },
  roleOption: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, alignItems: "center" },
  roleOptionText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  saveBtn: { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 4 },
  saveBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
