/**
 * (super)/users.tsx — 플랫폼 관리자 계정 관리
 * 실 API 연결: GET/POST/PATCH /super/platform-users
 */
import { Shield, SlidersHorizontal, UserPlus, Users } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useState, useEffect, useCallback } from "react";
import {
  ActivityIndicator, Alert, FlatList, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth, apiRequest } from "@/context/AuthContext";
import { ModalSheet } from "@/components/common/ModalSheet";
import { useAuditLogStore } from "@/store/auditLogStore";

type Permissions = {
  canViewPools:            boolean;
  canEditPools:            boolean;
  canApprovePools:         boolean;
  canManageSubscriptions:  boolean;
  canManagePlatformAdmins: boolean;
};

interface PlatformUser {
  id:          string;
  email:       string;
  name:        string;
  phone?:      string;
  role:        string;
  permissions?: Permissions;
  created_at:  string;
}

const DEFAULT_PERMS: Permissions = {
  canViewPools:            true,
  canEditPools:            false,
  canApprovePools:         false,
  canManageSubscriptions:  false,
  canManagePlatformAdmins: false,
};

const PERM_LABELS: { key: keyof Permissions; label: string; desc: string; icon: string }[] = [
  { key: "canViewPools",            label: "수영장 조회",    desc: "수영장 목록 및 상세 열람",   icon: "eye" },
  { key: "canEditPools",            label: "수영장 편집",    desc: "수영장 정보 수정",          icon: "edit-2" },
  { key: "canApprovePools",         label: "가입 승인/반려", desc: "수영장 신규 신청 처리",      icon: "check-circle" },
  { key: "canManageSubscriptions",  label: "구독 관리",      desc: "구독 상태 및 플랜 변경",     icon: "credit-card" },
  { key: "canManagePlatformAdmins", label: "관리자 계정관리",desc: "플랫폼 관리자 생성·수정",    icon: "users" },
];

const ROLES: Record<string, { label: string; color: string; bg: string }> = {
  super_admin:    { label: "슈퍼관리자",  color: "#7C3AED", bg: "#E6FAF8" },
  platform_admin: { label: "플랫폼관리자",color: "#4EA7D8", bg: "#E6FFFA" },
};


export default function UsersScreen() {
  const { adminUser, token } = useAuth();
  const actorName = adminUser?.name ?? '슈퍼관리자';
  const createLog = useAuditLogStore(s => s.createLog);
  const insets = useSafeAreaInsets();
  const C = Colors.light;

  const [users,      setUsers]      = useState<PlatformUser[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [form,       setForm]       = useState({ email: "", name: "", phone: "" });
  const [formPerms,  setFormPerms]  = useState<Permissions>({ ...DEFAULT_PERMS });
  const [error,      setError]      = useState("");
  const [creating,   setCreating]   = useState(false);

  const [editTarget,  setEditTarget]  = useState<PlatformUser | null>(null);
  const [editPerms,   setEditPerms]   = useState<Permissions>({ ...DEFAULT_PERMS });
  const [savingPerms, setSavingPerms] = useState(false);

  const isSuperAdmin = adminUser?.role === "super_admin";

  const fetchUsers = useCallback(async () => {
    try {
      const res = await apiRequest(token, '/super/platform-users');
      const data = await res.json();
      if (Array.isArray(data)) {
        setUsers(data.map((u: any) => ({
          id:          u.id,
          email:       u.email,
          name:        u.name,
          phone:       u.phone ?? undefined,
          role:        u.role,
          permissions: u.permissions ? (typeof u.permissions === 'string' ? JSON.parse(u.permissions) : u.permissions) : undefined,
          created_at:  u.created_at,
        })));
      }
    } catch (e) {
      console.error('fetchUsers error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  async function handleCreate() {
    if (!form.email || !form.name) { setError("이름과 이메일은 필수입니다."); return; }
    setCreating(true);
    setError("");
    try {
      const createRes = await apiRequest(token, '/super/platform-users', {
        method: 'POST',
        body: JSON.stringify({ name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim() || undefined, permissions: formPerms }),
      });
      const result = await createRes.json();
      if (!createRes.ok) throw new Error(result?.message ?? `HTTP ${createRes.status}`);
      createLog({ category: '권한', title: `관리자 계정 생성: ${form.name}`, detail: form.email, actorName, impact: 'high' });
      if (result?.temp_password) {
        Alert.alert('계정 생성 완료', `임시 비밀번호: ${result.temp_password}\n\n해당 비밀번호를 안전하게 전달해 주세요.`);
      }
      setShowCreate(false);
      setForm({ email: "", name: "", phone: "" });
      setFormPerms({ ...DEFAULT_PERMS });
      fetchUsers();
    } catch (e: any) {
      setError(e?.message ?? "계정 생성 중 오류가 발생했습니다.");
    } finally {
      setCreating(false);
    }
  }

  function openEdit(u: PlatformUser) {
    setEditTarget(u);
    setEditPerms({ ...DEFAULT_PERMS, ...(u.permissions || {}) });
  }

  async function handleSavePermissions() {
    if (!editTarget) return;
    setSavingPerms(true);
    try {
      const permRes = await apiRequest(token, `/super/platform-users/${editTarget.id}/permissions`, {
        method: 'PATCH',
        body: JSON.stringify({ permissions: editPerms }),
      });
      if (!permRes.ok) { const d = await permRes.json().catch(() => ({})); throw new Error(d?.message ?? `HTTP ${permRes.status}`); }
      setUsers(prev => prev.map(u =>
        u.id === editTarget.id ? { ...u, permissions: { ...editPerms } } : u
      ));
      createLog({ category: '권한', title: `관리자 권한 수정: ${editTarget.name}`, detail: '권한 업데이트', actorName, impact: 'medium' });
      setEditTarget(null);
    } catch (e: any) {
      Alert.alert('오류', e?.message ?? '권한 저장 중 오류가 발생했습니다.');
    } finally {
      setSavingPerms(false);
    }
  }

  function PermToggle({ perms, setPerms, disabled }: {
    perms: Permissions;
    setPerms: (p: Permissions) => void;
    disabled?: boolean;
  }) {
    return (
      <View style={{ gap: 8 }}>
        {PERM_LABELS.map(({ key, label, desc, icon }) => (
          <View key={key} style={[ps.row, { opacity: disabled ? 0.5 : 1 }]}>
            <View style={[ps.icon, { backgroundColor: perms[key] ? "#E6FFFA" : "#FFFFFF" }]}>
              <LucideIcon name={icon as any} size={15} color={perms[key] ? "#4EA7D8" : "#64748B"} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[ps.permLabel, { color: C.text }]}>{label}</Text>
              <Text style={[ps.permDesc, { color: C.textMuted }]}>{desc}</Text>
            </View>
            <Switch
              value={perms[key]}
              onValueChange={(v) => { if (!disabled) setPerms({ ...perms, [key]: v }); }}
              trackColor={{ false: "#D1D5DB", true: "#4EA7D8" }}
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
    if (active.length === 0) return <Text style={[ps.noPerm, { color: C.textMuted }]}>권한 없음</Text>;
    return (
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
        {active.map(p => (
          <View key={p.key} style={ps.badge}>
            <Text style={ps.badgeText}>{p.label}</Text>
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
          <Pressable style={[styles.addBtn, { backgroundColor: C.button }]}
            onPress={() => { setShowCreate(true); setError(""); }}>
            <UserPlus size={16} color="#fff" />
            <Text style={styles.addBtnText}>추가</Text>
          </Pressable>
        )}
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color="#7C3AED" />
        </View>
      ) : (
      <FlatList
        data={users}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, gap: 12 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); fetchUsers(); }}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Users size={40} color={C.textMuted} />
            <Text style={[styles.emptyText, { color: C.textMuted }]}>등록된 관리자가 없습니다</Text>
          </View>
        }
        renderItem={({ item }) => {
          const rc = ROLES[item.role] || { label: item.role, color: "#666", bg: "#EEE" };
          const isSelf = item.email === adminUser?.email;
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
                    onPress={() => openEdit(item)}>
                    <SlidersHorizontal size={16} color="#4EA7D8" />
                  </Pressable>
                )}
              </View>
              {isSelf ? (
                <View style={ps.superTag}>
                  <Shield size={12} color="#7C3AED" />
                  <Text style={[ps.superTagText, { color: "#7C3AED" }]}>모든 권한 보유</Text>
                </View>
              ) : (
                renderPermBadges(item.permissions)
              )}
            </View>
          );
        }}
      />
      )}

      <ModalSheet visible={showCreate} onClose={() => setShowCreate(false)} title="플랫폼 관리자 계정 생성">
        <Text style={[styles.modalSubtitle, { color: C.textSecondary }]}>역할: 플랫폼관리자 · 초기 권한을 설정해주세요</Text>
        {error ? <Text style={[styles.errorText, { color: C.error }]}>{error}</Text> : null}
        {[
          { key: "name",  label: "이름 *",   placeholder: "이름" },
          { key: "email", label: "이메일 *",  placeholder: "이메일" },
          { key: "phone", label: "연락처",    placeholder: "010-0000-0000" },
        ].map(({ key, label, placeholder }) => (
          <View key={key} style={styles.field}>
            <Text style={[styles.label, { color: C.textSecondary }]}>{label}</Text>
            <TextInput
              style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.background }]}
              value={form[key as keyof typeof form]}
              onChangeText={(v) => setForm(f => ({ ...f, [key]: v }))}
              placeholder={placeholder}
              placeholderTextColor={C.textMuted}
              autoCapitalize="none"
            />
          </View>
        ))}
        <View style={[styles.permSection, { borderColor: C.border }]}>
          <Text style={[styles.permSectionTitle, { color: C.text }]}>초기 권한 설정</Text>
          <PermToggle perms={formPerms} setPerms={setFormPerms} />
        </View>
        <Pressable style={[styles.saveBtn, { backgroundColor: C.button, opacity: creating ? 0.6 : 0.85 }]}
          onPress={handleCreate} disabled={creating}>
          {creating
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={styles.saveBtnText}>계정 생성하기</Text>}
        </Pressable>
      </ModalSheet>

      <ModalSheet visible={!!editTarget} onClose={() => setEditTarget(null)} title="권한 편집">
        {editTarget && (
          <Text style={[styles.modalSubtitle, { color: C.textSecondary }]}>{editTarget.name} ({editTarget.email})</Text>
        )}
        <PermToggle perms={editPerms} setPerms={setEditPerms} />
        <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
          <Pressable style={({ pressed }) => [styles.cancelBtn, { borderColor: C.border, opacity: pressed ? 0.7 : 1 }]}
            onPress={() => setEditTarget(null)}>
            <Text style={[styles.cancelBtnText, { color: C.textSecondary }]}>취소</Text>
          </Pressable>
          <Pressable style={[styles.saveBtn, { flex: 1, backgroundColor: "#4EA7D8", opacity: savingPerms ? 0.6 : 1 }]}
            onPress={handleSavePermissions} disabled={savingPerms}>
            {savingPerms
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.saveBtnText}>저장</Text>}
          </Pressable>
        </View>
      </ModalSheet>
    </View>
  );
}

const ps = StyleSheet.create({
  row:          { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 },
  icon:         { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  permLabel:    { fontSize: 13, fontFamily: "Pretendard-Regular" },
  permDesc:     { fontSize: 11, fontFamily: "Pretendard-Regular", marginTop: 1 },
  badge:        { backgroundColor: "#E6FFFA", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText:    { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  noPerm:       { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 6, fontStyle: "italic" },
  superTag:     { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  superTagText: { fontSize: 11, fontFamily: "Pretendard-Regular" },
});

const styles = StyleSheet.create({
  header:          { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start",
                     paddingHorizontal: 20, paddingBottom: 12 },
  badge:           { fontSize: 12, fontFamily: "Pretendard-Regular", textTransform: "uppercase", letterSpacing: 0.5 },
  title:           { fontSize: 22, fontFamily: "Pretendard-Regular" },
  subtitle:        { fontSize: 13, fontFamily: "Pretendard-Regular" },
  addBtn:          { flexDirection: "row", alignItems: "center", gap: 6,
                     paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  addBtnText:      { color: "#fff", fontSize: 14, fontFamily: "Pretendard-Regular" },
  card:            { borderRadius: 16, padding: 16,
                     shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8, elevation: 2 },
  cardTop:         { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar:          { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  avatarText:      { fontSize: 18, fontFamily: "Pretendard-Regular" },
  userInfo:        { flex: 1, gap: 2 },
  userName:        { fontSize: 15, fontFamily: "Pretendard-Regular" },
  userEmail:       { fontSize: 12, fontFamily: "Pretendard-Regular" },
  roleBadge:       { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7 },
  roleText:        { fontSize: 10, fontFamily: "Pretendard-Regular" },
  editBtn:         { width: 36, height: 36, borderRadius: 10, backgroundColor: "#E6FFFA",
                     alignItems: "center", justifyContent: "center" },
  empty:           { alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  emptyText:       { fontSize: 15, fontFamily: "Pretendard-Regular" },
  modalSubtitle:   { fontSize: 13, fontFamily: "Pretendard-Regular", marginTop: 4 },
  errorText:       { fontSize: 13, fontFamily: "Pretendard-Regular", marginTop: 8 },
  field:           { gap: 6 },
  label:           { fontSize: 13, fontFamily: "Pretendard-Regular" },
  input:           { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, height: 46,
                     fontSize: 15, fontFamily: "Pretendard-Regular" },
  permSection:     { borderWidth: 1, borderRadius: 14, padding: 14, gap: 8, marginTop: 16 },
  permSectionTitle:{ fontSize: 14, fontFamily: "Pretendard-Regular", marginBottom: 4 },
  saveBtn:         { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  saveBtnText:     { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" },
  cancelBtn:       { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center",
                     borderWidth: 1.5, paddingHorizontal: 20 },
  cancelBtnText:   { fontSize: 16, fontFamily: "Pretendard-Regular" },
});
