import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View, RefreshControl, Switch,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

type Permissions = {
  canViewPools: boolean;
  canEditPools: boolean;
  canApprovePools: boolean;
  canManageSubscriptions: boolean;
  canManagePlatformAdmins: boolean;
};

interface PlatformUser {
  id: string;
  email: string;
  name: string;
  phone?: string;
  role: string;
  permissions?: Permissions;
  created_at: string;
}

const DEFAULT_PERMS: Permissions = {
  canViewPools: true,
  canEditPools: false,
  canApprovePools: false,
  canManageSubscriptions: false,
  canManagePlatformAdmins: false,
};

const PERM_LABELS: { key: keyof Permissions; label: string; desc: string; icon: string }[] = [
  { key: "canViewPools", label: "수영장 조회", desc: "수영장 목록 및 상세 열람", icon: "eye" },
  { key: "canEditPools", label: "수영장 편집", desc: "수영장 정보 수정", icon: "edit-2" },
  { key: "canApprovePools", label: "가입 승인/반려", desc: "수영장 신규 신청 처리", icon: "check-circle" },
  { key: "canManageSubscriptions", label: "구독 관리", desc: "구독 상태 및 플랜 변경", icon: "credit-card" },
  { key: "canManagePlatformAdmins", label: "관리자 계정관리", desc: "플랫폼 관리자 생성·수정", icon: "users" },
];

const ROLES: Record<string, { label: string; color: string; bg: string }> = {
  super_admin: { label: "슈퍼관리자", color: "#7C3AED", bg: "#F3E8FF" },
  platform_admin: { label: "플랫폼관리자", color: "#3B82F6", bg: "#DBEAFE" },
};

export default function UsersScreen() {
  const { token, user: me } = useAuth();
  const insets = useSafeAreaInsets();
  const C = Colors.light;
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // 생성 모달
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", name: "", phone: "" });
  const [formPerms, setFormPerms] = useState<Permissions>({ ...DEFAULT_PERMS });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // 권한 편집 모달
  const [editTarget, setEditTarget] = useState<PlatformUser | null>(null);
  const [editPerms, setEditPerms] = useState<Permissions>({ ...DEFAULT_PERMS });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  const isSuperAdmin = (me as any)?.role === "super_admin";

  async function fetchAll() {
    try {
      const res = await apiRequest(token, "/admin/users");
      const json = await res.json();
      const data = json.data ?? json;
      setUsers(Array.isArray(data) ? data : []);
    } catch (e) {
      setUsers([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { fetchAll(); }, []);

  async function handleCreate() {
    if (!form.email || !form.password || !form.name) { setError("필수 항목을 모두 입력해주세요."); return; }
    setSaving(true); setError("");
    try {
      const res = await apiRequest(token, "/admin/users", {
        method: "POST",
        body: JSON.stringify({ ...form, permissions: formPerms }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || json.error || "생성 실패");
      const newUser = json.data ?? json;
      setUsers(prev => [newUser, ...prev]);
      setShowCreate(false);
      setForm({ email: "", password: "", name: "", phone: "" });
      setFormPerms({ ...DEFAULT_PERMS });
    } catch (err: unknown) { setError(err instanceof Error ? err.message : "오류가 발생했습니다."); }
    finally { setSaving(false); }
  }

  function openEdit(u: PlatformUser) {
    setEditTarget(u);
    setEditPerms({ ...DEFAULT_PERMS, ...(u.permissions || {}) });
    setEditError("");
  }

  async function handleSavePermissions() {
    if (!editTarget) return;
    setEditSaving(true); setEditError("");
    try {
      const res = await apiRequest(token, `/admin/users/${editTarget.id}/permissions`, {
        method: "PATCH",
        body: JSON.stringify({ permissions: editPerms }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || json.error || "저장 실패");
      const updated = json.data ?? json;
      setUsers(prev => prev.map(u => u.id === editTarget.id ? { ...u, permissions: updated.permissions } : u));
      setEditTarget(null);
    } catch (err: unknown) { setEditError(err instanceof Error ? err.message : "오류가 발생했습니다."); }
    finally { setEditSaving(false); }
  }

  function PermToggle({ perms, setPerms, disabled }: {
    perms: Permissions;
    setPerms: (p: Permissions) => void;
    disabled?: boolean;
  }) {
    return (
      <View style={{ gap: 8 }}>
        {PERM_LABELS.map(({ key, label, desc, icon }) => (
          <View key={key} style={[permStyles.row, { opacity: disabled ? 0.5 : 1 }]}>
            <View style={[permStyles.icon, { backgroundColor: perms[key] ? "#EFF6FF" : "#F3F4F6" }]}>
              <Feather name={icon as any} size={15} color={perms[key] ? "#3B82F6" : "#9CA3AF"} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[permStyles.permLabel, { color: C.text }]}>{label}</Text>
              <Text style={[permStyles.permDesc, { color: C.textMuted }]}>{desc}</Text>
            </View>
            <Switch
              value={perms[key]}
              onValueChange={(v) => !disabled && setPerms({ ...perms, [key]: v })}
              trackColor={{ false: "#D1D5DB", true: "#3B82F6" }}
              thumbColor="#fff"
              disabled={disabled}
            />
          </View>
        ))}
      </View>
    );
  }

  function renderPermBadges(perms?: Permissions) {
    if (!perms) return null;
    const active = PERM_LABELS.filter(p => perms[p.key]);
    if (active.length === 0) return (
      <Text style={[permStyles.noPerm, { color: C.textMuted }]}>권한 없음</Text>
    );
    return (
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
        {active.map(p => (
          <View key={p.key} style={permStyles.badge}>
            <Text style={permStyles.badgeText}>{p.label}</Text>
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <View>
          <Text style={[styles.badge, { color: "#7C3AED" }]}>슈퍼관리자</Text>
          <Text style={[styles.title, { color: C.text }]}>플랫폼 관리자</Text>
          <Text style={[styles.subtitle, { color: C.textSecondary }]}>계정 및 권한 관리</Text>
        </View>
        {isSuperAdmin && (
          <Pressable style={[styles.addBtn, { backgroundColor: "#7C3AED" }]} onPress={() => { setShowCreate(true); setError(""); }}>
            <Feather name="user-plus" size={16} color="#fff" />
            <Text style={styles.addBtnText}>추가</Text>
          </Pressable>
        )}
      </View>

      {loading ? <ActivityIndicator color="#7C3AED" style={{ marginTop: 40 }} /> : (
        <FlatList
          data={users}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, gap: 12 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAll(); }} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="users" size={40} color={C.textMuted} />
              <Text style={[styles.emptyText, { color: C.textMuted }]}>등록된 관리자가 없습니다</Text>
            </View>
          }
          renderItem={({ item }) => {
            const rc = ROLES[item.role] || { label: item.role, color: "#666", bg: "#EEE" };
            const isSelf = item.role === "super_admin";
            return (
              <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.shadow }]}>
                <View style={styles.cardTop}>
                  <View style={[styles.avatar, { backgroundColor: rc.bg }]}>
                    <Text style={[styles.avatarText, { color: rc.color }]}>{item.name[0]}</Text>
                  </View>
                  <View style={styles.userInfo}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={[styles.userName, { color: C.text }]}>{item.name}</Text>
                      <View style={[styles.roleBadge, { backgroundColor: rc.bg }]}>
                        <Text style={[styles.roleText, { color: rc.color }]}>{rc.label}</Text>
                      </View>
                    </View>
                    <Text style={[styles.userEmail, { color: C.textSecondary }]}>{item.email}</Text>
                  </View>
                  {isSuperAdmin && !isSelf && (
                    <Pressable
                      style={({ pressed }) => [styles.editBtn, { opacity: pressed ? 0.6 : 1 }]}
                      onPress={() => openEdit(item)}
                    >
                      <Feather name="sliders" size={16} color="#3B82F6" />
                    </Pressable>
                  )}
                </View>
                {isSelf ? (
                  <View style={permStyles.superTag}>
                    <Feather name="shield" size={12} color="#7C3AED" />
                    <Text style={[permStyles.superTagText, { color: "#7C3AED" }]}>모든 권한 보유</Text>
                  </View>
                ) : (
                  renderPermBadges(item.permissions)
                )}
              </View>
            );
          }}
        />
      )}

      {/* 생성 모달 */}
      <Modal visible={showCreate} animationType="slide" transparent onRequestClose={() => setShowCreate(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={[styles.modalSheet, { backgroundColor: C.card, paddingBottom: insets.bottom + 20 }]}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.modalHandle} />
              <Text style={[styles.modalTitle, { color: C.text }]}>플랫폼 관리자 계정 생성</Text>
              <Text style={[styles.modalSubtitle, { color: C.textSecondary }]}>역할: 플랫폼관리자 · 초기 권한을 설정해주세요</Text>
              {error ? <Text style={[styles.errorText, { color: C.error }]}>{error}</Text> : null}

              {[
                { key: "name", label: "이름 *", placeholder: "이름" },
                { key: "email", label: "이메일 *", placeholder: "이메일" },
                { key: "password", label: "비밀번호 *", placeholder: "6자 이상", secure: true },
                { key: "phone", label: "연락처", placeholder: "010-0000-0000" },
              ].map(({ key, label, placeholder, secure }) => (
                <View key={key} style={[styles.field, { marginTop: 10 }]}>
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

              <View style={[styles.permSection, { borderColor: C.border }]}>
                <Text style={[styles.permSectionTitle, { color: C.text }]}>초기 권한 설정</Text>
                <PermToggle perms={formPerms} setPerms={setFormPerms} />
              </View>

              <Pressable style={({ pressed }) => [styles.saveBtn, { backgroundColor: "#7C3AED", opacity: pressed ? 0.85 : 1, marginTop: 16 }]} onPress={handleCreate} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>계정 생성하기</Text>}
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 권한 편집 모달 */}
      <Modal visible={!!editTarget} animationType="slide" transparent onRequestClose={() => setEditTarget(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: C.card, paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHandle} />
            <Text style={[styles.modalTitle, { color: C.text }]}>권한 편집</Text>
            {editTarget && (
              <Text style={[styles.modalSubtitle, { color: C.textSecondary }]}>{editTarget.name} ({editTarget.email})</Text>
            )}
            {editError ? <Text style={[styles.errorText, { color: C.error }]}>{editError}</Text> : null}

            <View style={{ marginTop: 12 }}>
              <PermToggle perms={editPerms} setPerms={setEditPerms} />
            </View>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 20 }}>
              <Pressable style={({ pressed }) => [styles.cancelBtn, { borderColor: C.border, opacity: pressed ? 0.7 : 1 }]} onPress={() => setEditTarget(null)}>
                <Text style={[styles.cancelBtnText, { color: C.textSecondary }]}>취소</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [styles.saveBtn, { flex: 1, backgroundColor: "#3B82F6", opacity: pressed ? 0.85 : 1 }]} onPress={handleSavePermissions} disabled={editSaving}>
                {editSaving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>저장</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const permStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 },
  icon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  permLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  permDesc: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  badge: { backgroundColor: "#DBEAFE", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 10, fontFamily: "Inter_500Medium", color: "#1E40AF" },
  noPerm: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 6, fontStyle: "italic" },
  superTag: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  superTagText: { fontSize: 11, fontFamily: "Inter_500Medium" },
});

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingHorizontal: 20, paddingBottom: 12 },
  badge: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  addBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  card: { borderRadius: 16, padding: 16, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8, elevation: 2 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  userInfo: { flex: 1, gap: 2 },
  userName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  userEmail: { fontSize: 12, fontFamily: "Inter_400Regular" },
  roleBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7 },
  roleText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  editBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#EFF6FF", alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  emptyText: { fontSize: 15, fontFamily: "Inter_400Regular" },
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: "92%" },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 12 },
  modalTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  modalSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
  errorText: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 8 },
  field: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, height: 46, fontSize: 15, fontFamily: "Inter_400Regular" },
  permSection: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 8, marginTop: 16 },
  permSectionTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  saveBtn: { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  saveBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  cancelBtn: { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1.5, paddingHorizontal: 20 },
  cancelBtnText: { fontSize: 16, fontFamily: "Inter_500Medium" },
});
