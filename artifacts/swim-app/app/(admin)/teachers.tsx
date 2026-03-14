import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal,
  Platform, Pressable, RefreshControl, ScrollView,
  StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;

interface Teacher {
  id: string; name: string; email: string; phone: string;
  is_activated: boolean; is_admin_self_teacher: boolean; created_at: string;
}

export default function TeachersScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState("");
  const [newTeacher, setNewTeacher] = useState<{ teacher: Teacher; code: string } | null>(null);
  const [codeVisible, setCodeVisible] = useState<Record<string, string>>({});
  const [loadingCode, setLoadingCode] = useState<string | null>(null);
  const [form, setForm] = useState<{ name: string; email: string; phone: string; password: string; is_admin_self_teacher: boolean }>({ name: "", email: "", phone: "", password: "", is_admin_self_teacher: false });

  const hasAdminSelf = teachers.some(t => t.is_admin_self_teacher);

  const fetchAll = useCallback(async () => {
    try {
      const tRes = await apiRequest(token, "/teachers");
      if (tRes.ok) setTeachers(await tRes.json());
    } finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  function resetForm() { setForm({ name: "", email: "", phone: "", password: "", is_admin_self_teacher: false }); setAddError(""); }

  async function handleCreate() {
    if (!form.name.trim() || !form.email.trim() || !form.password || !form.phone.trim()) { setAddError("모든 필수 항목을 입력해주세요."); return; }
    if (form.password.length < 6) { setAddError("비밀번호는 6자 이상이어야 합니다."); return; }
    if (form.is_admin_self_teacher && hasAdminSelf) { setAddError("관리자 본인용 선생님 계정은 이미 등록되어 있습니다."); return; }
    setSaving(true); setAddError("");
    try {
      const res = await apiRequest(token, "/teachers", { method: "POST", body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "생성 실패");
      setShowAdd(false); resetForm();
      setNewTeacher({ teacher: data.teacher, code: data.activation_code });
      fetchAll();
    } catch (err: any) { setAddError(err.message || "생성 중 오류"); }
    finally { setSaving(false); }
  }

  async function handleViewCode(id: string) {
    setLoadingCode(id);
    try {
      const res = await apiRequest(token, `/teachers/${id}/activation-code`);
      const data = await res.json();
      if (res.ok) setCodeVisible(prev => ({ ...prev, [id]: data.activation_code }));
      else Alert.alert("오류", data.error || "코드 조회 실패");
    } finally { setLoadingCode(null); }
  }

  async function handleDeleteTeacher(id: string, name: string) {
    Alert.alert("선생님 삭제", `${name} 계정을 삭제하시겠습니까?`, [
      { text: "취소", style: "cancel" },
      { text: "삭제", style: "destructive", onPress: async () => {
        const res = await apiRequest(token, `/teachers/${id}`, { method: "DELETE" });
        if (res.ok) fetchAll();
        else Alert.alert("오류", "삭제에 실패했습니다.");
      }},
    ]);
  }

  return (
    <View style={[styles.root, { backgroundColor: C.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <View>
          <Text style={[styles.headerTitle, { color: C.text }]}>선생님 관리</Text>
          <Text style={[styles.headerSub, { color: C.textMuted }]}>승인 완료된 선생님만 표시됩니다</Text>
        </View>
        <Pressable
          style={[styles.addBtn, { backgroundColor: C.tint }]}
          onPress={() => { resetForm(); setShowAdd(true); }}
        >
          <Feather name="plus" size={18} color="#fff" />
          <Text style={styles.addBtnText}>계정 추가</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 120, gap: 10, paddingTop: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAll(); }} />}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.infoBox, { backgroundColor: C.tintLight }]}>
            <Feather name="info" size={14} color={C.tint} />
            <Text style={[styles.infoText, { color: C.tint }]}>
              계정 생성 후 인증코드를 선생님에게 전달하세요.{"\n"}선생님이 앱 로그인 후 코드를 입력하면 활성화됩니다.
            </Text>
          </View>
          {teachers.length === 0 ? (
            <View style={styles.empty}>
              <Feather name="users" size={40} color={C.textMuted} />
              <Text style={[styles.emptyText, { color: C.textMuted }]}>등록된 선생님이 없습니다</Text>
              <Text style={[styles.emptySub, { color: C.textMuted }]}>승인 메뉴에서 선생님을 승인한 후 여기에 표시됩니다</Text>
            </View>
          ) : teachers.map(t => (
            <View key={t.id} style={[styles.card, { backgroundColor: C.card, shadowColor: C.shadow }]}>
              <View style={styles.cardTop}>
                <View style={[styles.avatar, { backgroundColor: t.is_admin_self_teacher ? "#7C3AED15" : C.tintLight }]}>
                  <Feather name="user" size={20} color={t.is_admin_self_teacher ? "#7C3AED" : C.tint} />
                </View>
                <View style={styles.cardInfo}>
                  <View style={styles.nameRow}>
                    <Text style={[styles.teacherName, { color: C.text }]}>{t.name}</Text>
                    {t.is_admin_self_teacher && (
                      <View style={[styles.selfBadge, { backgroundColor: "#7C3AED15" }]}>
                        <Text style={[styles.selfBadgeText, { color: "#7C3AED" }]}>내 계정</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.teacherEmail, { color: C.textSecondary }]}>{t.email}</Text>
                  {t.phone && <Text style={[styles.teacherPhone, { color: C.textMuted }]}>{t.phone}</Text>}
                </View>
                <View style={[styles.statusBadge, { backgroundColor: t.is_activated ? "#D1FAE5" : "#FEF3C7" }]}>
                  <Text style={[styles.statusText, { color: t.is_activated ? "#059669" : "#D97706" }]}>
                    {t.is_activated ? "활성" : "인증 대기"}
                  </Text>
                </View>
              </View>
              {!t.is_activated && (
                <View style={[styles.codeSection, { borderTopColor: C.border }]}>
                  {codeVisible[t.id] ? (
                    <View style={[styles.codeBox, { backgroundColor: "#FEF3C7", borderRadius: 10, padding: 12 }]}>
                      <Text style={[styles.codeLabel, { color: "#92400E" }]}>인증코드 (선생님에게 전달해주세요)</Text>
                      <Text style={[styles.codeValue, { color: "#92400E" }]}>{codeVisible[t.id]}</Text>
                    </View>
                  ) : (
                    <Pressable style={[styles.viewCodeBtn, { borderColor: C.warning }]} onPress={() => handleViewCode(t.id)} disabled={loadingCode === t.id}>
                      {loadingCode === t.id ? <ActivityIndicator color={C.warning} size="small" /> : (
                        <><Feather name="key" size={14} color={C.warning} />
                        <Text style={[styles.viewCodeText, { color: C.warning }]}>인증코드 보기</Text></>
                      )}
                    </Pressable>
                  )}
                </View>
              )}
              <View style={[styles.cardActions, { borderTopColor: C.border }]}>
                <Pressable style={styles.actionBtn} onPress={() => handleDeleteTeacher(t.id, t.name)}>
                  <Feather name="trash-2" size={14} color={C.error} />
                  <Text style={[styles.actionText, { color: C.error }]}>삭제</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      <Modal visible={showAdd} animationType="slide" transparent presentationStyle="overFullScreen">
        <KeyboardAvoidingView
          style={styles.overlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={[styles.sheet, { backgroundColor: C.card, paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.sheetHandle} />
            <Text style={[styles.sheetTitle, { color: C.text }]}>선생님 계정 추가</Text>
            {!!addError && <View style={[styles.errBox, { backgroundColor: "#FEE2E2" }]}>
              <Text style={[styles.errText, { color: C.error }]}>{addError}</Text>
            </View>}
            <View style={styles.field}>
              <Text style={[styles.label, { color: C.textSecondary }]}>이름 *</Text>
              <TextInput
                style={[styles.input, { borderColor: C.border, color: C.text }]}
                value={form.name} onChangeText={v => setForm({ ...form, name: v })}
                placeholder="김선생" placeholderTextColor={C.textMuted}
              />
            </View>
            <View style={styles.field}>
              <Text style={[styles.label, { color: C.textSecondary }]}>이메일 *</Text>
              <TextInput
                style={[styles.input, { borderColor: C.border, color: C.text }]}
                value={form.email} onChangeText={v => setForm({ ...form, email: v })}
                placeholder="teacher@example.com" placeholderTextColor={C.textMuted}
                keyboardType="email-address"
              />
            </View>
            <View style={styles.field}>
              <Text style={[styles.label, { color: C.textSecondary }]}>전화번호 *</Text>
              <TextInput
                style={[styles.input, { borderColor: C.border, color: C.text }]}
                value={form.phone} onChangeText={v => setForm({ ...form, phone: v })}
                placeholder="010-0000-0000" placeholderTextColor={C.textMuted}
                keyboardType="phone-pad"
              />
            </View>
            <View style={styles.field}>
              <Text style={[styles.label, { color: C.textSecondary }]}>비밀번호 (6자 이상) *</Text>
              <TextInput
                style={[styles.input, { borderColor: C.border, color: C.text }]}
                value={form.password} onChangeText={v => setForm({ ...form, password: v })}
                placeholder="••••••" placeholderTextColor={C.textMuted}
                secureTextEntry
              />
            </View>
            <View style={[styles.switchRow, { borderColor: C.border }]}>
              <Text style={[styles.switchLabel, { color: C.text }]}>관리자 본인용 계정</Text>
              <Switch
                value={form.is_admin_self_teacher} onValueChange={v => setForm({ ...form, is_admin_self_teacher: v })}
                trackColor={{ false: C.border, true: C.tintLight }}
                thumbColor={form.is_admin_self_teacher ? C.tint : C.textMuted}
              />
            </View>
            <View style={styles.modalActions}>
              <Pressable style={[styles.cancelBtn, { borderColor: C.border }]} onPress={() => { setShowAdd(false); resetForm(); }}>
                <Text style={[styles.cancelText, { color: C.textSecondary }]}>취소</Text>
              </Pressable>
              <Pressable style={[styles.submitBtn, { backgroundColor: C.tint }]} onPress={handleCreate} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.submitText}>추가</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!newTeacher} animationType="fade" transparent>
        <View style={styles.overlay}>
          <View style={[styles.modalContent, { backgroundColor: C.card }]}>
            <View style={[styles.successIcon, { backgroundColor: "#D1FAE5" }]}>
              <Feather name="check-circle" size={48} color={C.success} />
            </View>
            <Text style={[styles.modalTitle, { color: C.text }]}>계정 생성 완료</Text>
            <Text style={[styles.modalSub, { color: C.textSecondary }]}>선생님에게 아래 인증코드를 전달하세요</Text>
            <View style={[styles.codeBox, { backgroundColor: C.background, borderColor: C.tint }]}>
              <Text style={[styles.codeValue, { color: C.text }]}>{newTeacher?.code}</Text>
            </View>
            <Pressable style={[styles.modalBtn, { backgroundColor: C.tint }]} onPress={() => setNewTeacher(null)}>
              <Text style={styles.modalBtnText}>확인</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 16, gap: 12 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, alignSelf: "flex-start" },
  addBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  infoBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 10 },
  infoText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  card: { borderRadius: 14, overflow: "hidden", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  avatar: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardInfo: { flex: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  teacherName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  selfBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  selfBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  teacherEmail: { fontSize: 13, fontFamily: "Inter_400Regular" },
  teacherPhone: { fontSize: 12, fontFamily: "Inter_400Regular" },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  codeSection: { borderTopWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  codeBox: { padding: 12, borderRadius: 10, borderWidth: 1 },
  codeLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 6 },
  codeValue: { fontSize: 16, fontFamily: "Inter_700Bold", letterSpacing: 1 },
  viewCodeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderWidth: 1.5, borderRadius: 10 },
  viewCodeText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  cardActions: { borderTopWidth: 1, paddingHorizontal: 14, paddingVertical: 10 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  actionText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  empty: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  emptySub: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 14 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  errBox: { padding: 10, borderRadius: 10 },
  errText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  field: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, height: 48, fontSize: 15, fontFamily: "Inter_400Regular" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, borderTopWidth: 1 },
  switchLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  cancelBtn: { flex: 1, height: 48, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  cancelText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  submitBtn: { flex: 1, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  submitText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  modalContent: { marginHorizontal: 20, marginBottom: 60, padding: 20, borderRadius: 20, alignItems: "center", gap: 16 },
  successIcon: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", marginTop: 20 },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  modalSub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  modalBtn: { width: "100%", height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 8 },
  modalBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
