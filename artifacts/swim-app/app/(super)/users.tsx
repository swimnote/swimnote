/**
 * (super)/users.tsx — 플랫폼 관리자 계정 관리
 * 로컬 시드 데이터 — API 호출 없음
 */
import { Shield, SlidersHorizontal, UserPlus, Users } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useState } from "react";
import {
  FlatList, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
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

const SEED_USERS: PlatformUser[] = [
  {
    id:          "adm-001",
    email:       "super@swimnote.io",
    name:        "슈퍼관리자",
    phone:       "010-0000-0001",
    role:        "super_admin",
    created_at:  "2024-01-01T09:00:00.000Z",
  },
  {
    id:          "adm-002",
    email:       "ops@swimnote.io",
    name:        "운영팀장",
    phone:       "010-1234-5678",
    role:        "platform_admin",
    permissions: { canViewPools: true, canEditPools: true, canApprovePools: true, canManageSubscriptions: false, canManagePlatformAdmins: false },
    created_at:  "2024-03-15T09:00:00.000Z",
  },
  {
    id:          "adm-003",
    email:       "support@swimnote.io",
    name:        "고객지원 담당",
    phone:       "010-9876-5432",
    role:        "platform_admin",
    permissions: { canViewPools: true, canEditPools: false, canApprovePools: false, canManageSubscriptions: true, canManagePlatformAdmins: false },
    created_at:  "2024-06-01T09:00:00.000Z",
  },
  {
    id:          "adm-004",
    email:       "dev@swimnote.io",
    name:        "개발자 최민준",
    phone:       "010-5555-6666",
    role:        "platform_admin",
    permissions: { ...DEFAULT_PERMS, canViewPools: true },
    created_at:  "2025-01-10T09:00:00.000Z",
  },
];

export default function UsersScreen() {
  const { adminUser } = useAuth();
  const actorName = adminUser?.name ?? '슈퍼관리자';
  const createLog = useAuditLogStore(s => s.createLog);
  const insets = useSafeAreaInsets();
  const C = Colors.light;

  const [users,      setUsers]      = useState<PlatformUser[]>(SEED_USERS);
  const [refreshing, setRefreshing] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [form,       setForm]       = useState({ email: "", name: "", phone: "" });
  const [formPerms,  setFormPerms]  = useState<Permissions>({ ...DEFAULT_PERMS });
  const [error,      setError]      = useState("");

  const [editTarget, setEditTarget] = useState<PlatformUser | null>(null);
  const [editPerms,  setEditPerms]  = useState<Permissions>({ ...DEFAULT_PERMS });

  const isSuperAdmin = adminUser?.role === "super_admin" || true;

  function handleCreate() {
    if (!form.email || !form.name) { setError("이름과 이메일은 필수입니다."); return; }
    const newUser: PlatformUser = {
      id:          `adm-${Date.now()}`,
      email:       form.email.trim(),
      name:        form.name.trim(),
      phone:       form.phone.trim() || undefined,
      role:        "platform_admin",
      permissions: { ...formPerms },
      created_at:  new Date().toISOString(),
    };
    setUsers(prev => [newUser, ...prev]);
    createLog({ category: '권한', title: `관리자 계정 생성: ${form.name}`, detail: form.email, actorName, impact: 'high' });
    setShowCreate(false);
    setForm({ email: "", name: "", phone: "" });
    setFormPerms({ ...DEFAULT_PERMS });
    setError("");
  }

  function openEdit(u: PlatformUser) {
    setEditTarget(u);
    setEditPerms({ ...DEFAULT_PERMS, ...(u.permissions || {}) });
  }

  function handleSavePermissions() {
    if (!editTarget) return;
    setUsers(prev => prev.map(u =>
      u.id === editTarget.id ? { ...u, permissions: { ...editPerms } } : u
    ));
    createLog({ category: '권한', title: `관리자 권한 수정: ${editTarget.name}`, detail: '권한 업데이트', actorName, impact: 'medium' });
    setEditTarget(null);
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

      <FlatList
        data={users}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, gap: 12 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); setTimeout(() => setRefreshing(false), 400); }} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Users size={40} color={C.textMuted} />
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
        <Pressable style={({ pressed }) => [styles.saveBtn, { backgroundColor: C.button, opacity: pressed ? 0.85 : 1 }]}
          onPress={handleCreate}>
          <Text style={styles.saveBtnText}>계정 생성하기</Text>
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
          <Pressable style={({ pressed }) => [styles.saveBtn, { flex: 1, backgroundColor: "#4EA7D8", opacity: pressed ? 0.85 : 1 }]}
            onPress={handleSavePermissions}>
            <Text style={styles.saveBtnText}>저장</Text>
          </Pressable>
        </View>
      </ModalSheet>
    </View>
  );
}

const ps = StyleSheet.create({
  row:          { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 },
  icon:         { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  permLabel:    { fontSize: 13, fontFamily: "Pretendard-SemiBold" },
  permDesc:     { fontSize: 11, fontFamily: "Pretendard-Regular", marginTop: 1 },
  badge:        { backgroundColor: "#E6FFFA", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText:    { fontSize: 10, fontFamily: "Pretendard-Medium", color: "#0F172A" },
  noPerm:       { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 6, fontStyle: "italic" },
  superTag:     { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  superTagText: { fontSize: 11, fontFamily: "Pretendard-Medium" },
});

const styles = StyleSheet.create({
  header:          { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start",
                     paddingHorizontal: 20, paddingBottom: 12 },
  badge:           { fontSize: 12, fontFamily: "Pretendard-SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  title:           { fontSize: 22, fontFamily: "Pretendard-Bold" },
  subtitle:        { fontSize: 13, fontFamily: "Pretendard-Regular" },
  addBtn:          { flexDirection: "row", alignItems: "center", gap: 6,
                     paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  addBtnText:      { color: "#fff", fontSize: 14, fontFamily: "Pretendard-SemiBold" },
  card:            { borderRadius: 16, padding: 16,
                     shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8, elevation: 2 },
  cardTop:         { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar:          { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  avatarText:      { fontSize: 18, fontFamily: "Pretendard-Bold" },
  userInfo:        { flex: 1, gap: 2 },
  userName:        { fontSize: 15, fontFamily: "Pretendard-SemiBold" },
  userEmail:       { fontSize: 12, fontFamily: "Pretendard-Regular" },
  roleBadge:       { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7 },
  roleText:        { fontSize: 10, fontFamily: "Pretendard-SemiBold" },
  editBtn:         { width: 36, height: 36, borderRadius: 10, backgroundColor: "#E6FFFA",
                     alignItems: "center", justifyContent: "center" },
  empty:           { alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  emptyText:       { fontSize: 15, fontFamily: "Pretendard-Regular" },
  modalSubtitle:   { fontSize: 13, fontFamily: "Pretendard-Regular", marginTop: 4 },
  errorText:       { fontSize: 13, fontFamily: "Pretendard-Regular", marginTop: 8 },
  field:           { gap: 6 },
  label:           { fontSize: 13, fontFamily: "Pretendard-Medium" },
  input:           { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, height: 46,
                     fontSize: 15, fontFamily: "Pretendard-Regular" },
  permSection:     { borderWidth: 1, borderRadius: 14, padding: 14, gap: 8, marginTop: 16 },
  permSectionTitle:{ fontSize: 14, fontFamily: "Pretendard-SemiBold", marginBottom: 4 },
  saveBtn:         { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  saveBtnText:     { color: "#fff", fontSize: 16, fontFamily: "Pretendard-SemiBold" },
  cancelBtn:       { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center",
                     borderWidth: 1.5, paddingHorizontal: 20 },
  cancelBtnText:   { fontSize: 16, fontFamily: "Pretendard-Medium" },
});
