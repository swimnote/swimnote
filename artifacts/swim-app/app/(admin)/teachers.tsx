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
  id: string;
  name: string;
  email: string;
  phone: string;
  is_activated: boolean;
  is_admin_self_teacher: boolean;
  created_at: string;
}

interface CreateForm {
  name: string;
  email: string;
  phone: string;
  password: string;
  is_admin_self_teacher: boolean;
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
  const [form, setForm] = useState<CreateForm>({
    name: "", email: "", phone: "", password: "", is_admin_self_teacher: false,
  });

  const hasAdminSelf = teachers.some(t => t.is_admin_self_teacher);

  const fetchTeachers = useCallback(async () => {
    try {
      const res = await apiRequest(token, "/teachers");
      if (res.ok) setTeachers(await res.json());
    } finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { fetchTeachers(); }, [fetchTeachers]);

  function resetForm() {
    setForm({ name: "", email: "", phone: "", password: "", is_admin_self_teacher: false });
    setAddError("");
  }

  async function handleCreate() {
    if (!form.name.trim() || !form.email.trim() || !form.password || !form.phone.trim()) {
      setAddError("모든 필수 항목을 입력해주세요."); return;
    }
    if (form.password.length < 6) { setAddError("비밀번호는 6자 이상이어야 합니다."); return; }
    if (form.is_admin_self_teacher && hasAdminSelf) {
      setAddError("관리자 본인용 선생님 계정은 이미 등록되어 있습니다."); return;
    }
    setSaving(true); setAddError("");
    try {
      const res = await apiRequest(token, "/teachers", {
        method: "POST",
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "생성 실패");
      setShowAdd(false);
      resetForm();
      setNewTeacher({ teacher: data.teacher, code: data.activation_code });
      fetchTeachers();
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

  async function handleDelete(id: string, name: string) {
    Alert.alert("선생님 삭제", `${name} 계정을 삭제하시겠습니까?\n관련 데이터는 유지됩니다.`, [
      { text: "취소", style: "cancel" },
      {
        text: "삭제", style: "destructive",
        onPress: async () => {
          const res = await apiRequest(token, `/teachers/${id}`, { method: "DELETE" });
          if (res.ok) fetchTeachers();
          else Alert.alert("오류", "삭제에 실패했습니다.");
        },
      },
    ]);
  }

  return (
    <View style={[styles.root, { backgroundColor: C.background }]}>
      {/* 헤더 */}
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <View>
          <Text style={[styles.headerTitle, { color: C.text }]}>선생님 관리</Text>
          <Text style={[styles.headerSub, { color: C.textMuted }]}>선생님 계정을 추가하고 관리합니다</Text>
        </View>
        <Pressable
          style={[styles.addBtn, { backgroundColor: C.tint }]}
          onPress={() => { resetForm(); setShowAdd(true); }}
        >
          <Feather name="plus" size={18} color="#fff" />
          <Text style={styles.addBtnText}>추가</Text>
        </Pressable>
      </View>

      {/* 안내 */}
      <View style={[styles.infoBox, { backgroundColor: C.tintLight, marginHorizontal: 20, marginBottom: 12 }]}>
        <Feather name="info" size={14} color={C.tint} />
        <Text style={[styles.infoText, { color: C.tint }]}>
          선생님 계정은 생성 후 인증코드 입력으로 활성화됩니다.{"\n"}
          관리자는 본인용 계정을 최대 1개 추가할 수 있습니다.
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 120, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchTeachers(); }} />}
          showsVerticalScrollIndicator={false}
        >
          {teachers.length === 0 && (
            <View style={styles.empty}>
              <Feather name="users" size={40} color={C.textMuted} />
              <Text style={[styles.emptyText, { color: C.textMuted }]}>등록된 선생님이 없습니다</Text>
              <Text style={[styles.emptySub, { color: C.textMuted }]}>상단 [추가] 버튼으로 선생님을 등록해주세요</Text>
            </View>
          )}

          {teachers.map(t => (
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
                <View style={[styles.statusBadge, {
                  backgroundColor: t.is_activated ? "#D1FAE5" : "#FEF3C7",
                }]}>
                  <Text style={[styles.statusText, { color: t.is_activated ? "#059669" : "#D97706" }]}>
                    {t.is_activated ? "활성" : "인증 대기"}
                  </Text>
                </View>
              </View>

              {/* 미활성 계정: 인증코드 보기 */}
              {!t.is_activated && (
                <View style={[styles.codeSection, { borderTopColor: C.border }]}>
                  {codeVisible[t.id] ? (
                    <View style={[styles.codeBox, { backgroundColor: "#FEF3C7", borderRadius: 10, padding: 12 }]}>
                      <Text style={[styles.codeLabel, { color: "#92400E" }]}>인증코드 (선생님에게 전달해주세요)</Text>
                      <Text style={[styles.codeValue, { color: "#92400E" }]}>{codeVisible[t.id]}</Text>
                      <Text style={[styles.codeHint, { color: "#B45309" }]}>선생님이 앱 로그인 후 이 코드를 입력하면 계정이 활성화됩니다</Text>
                    </View>
                  ) : (
                    <Pressable
                      style={[styles.viewCodeBtn, { borderColor: C.warning }]}
                      onPress={() => handleViewCode(t.id)}
                      disabled={loadingCode === t.id}
                    >
                      {loadingCode === t.id ? (
                        <ActivityIndicator color={C.warning} size="small" />
                      ) : (
                        <>
                          <Feather name="key" size={14} color={C.warning} />
                          <Text style={[styles.viewCodeText, { color: C.warning }]}>인증코드 보기</Text>
                        </>
                      )}
                    </Pressable>
                  )}
                </View>
              )}

              <View style={[styles.cardActions, { borderTopColor: C.border }]}>
                <Pressable
                  style={styles.actionBtn}
                  onPress={() => handleDelete(t.id, t.name)}
                >
                  <Feather name="trash-2" size={14} color={C.error} />
                  <Text style={[styles.actionText, { color: C.error }]}>삭제</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {/* 선생님 추가 모달 */}
      <Modal visible={showAdd} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={[styles.modal, { backgroundColor: C.background }]}>
            <View style={[styles.modalHeader, { borderBottomColor: C.border }]}>
              <Pressable onPress={() => { setShowAdd(false); resetForm(); }}>
                <Feather name="x" size={22} color={C.text} />
              </Pressable>
              <Text style={[styles.modalTitle, { color: C.text }]}>선생님 추가</Text>
              <Pressable
                style={[styles.saveBtn, { backgroundColor: C.tint, opacity: saving ? 0.6 : 1 }]}
                onPress={handleCreate} disabled={saving}
              >
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>추가</Text>}
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
              {addError ? (
                <View style={[styles.errBox, { backgroundColor: "#FEE2E2" }]}>
                  <Feather name="alert-circle" size={14} color={C.error} />
                  <Text style={[styles.errText, { color: C.error }]}>{addError}</Text>
                </View>
              ) : null}

              {[
                { key: "name", label: "이름 *", placeholder: "선생님 이름", icon: "user" },
                { key: "phone", label: "연락처 *", placeholder: "010-0000-0000", icon: "phone", keyboard: "phone-pad" },
                { key: "email", label: "이메일 *", placeholder: "로그인에 사용할 이메일", icon: "mail", keyboard: "email-address" },
                { key: "password", label: "임시 비밀번호 *", placeholder: "6자 이상", icon: "lock", secure: true },
              ].map(({ key, label, placeholder, icon, keyboard, secure }) => (
                <View key={key} style={{ gap: 4 }}>
                  <Text style={[styles.label, { color: C.textSecondary }]}>{label}</Text>
                  <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.card }]}>
                    <Feather name={icon as any} size={16} color={C.textMuted} />
                    <TextInput
                      style={[styles.input, { color: C.text }]}
                      value={form[key as keyof CreateForm] as string}
                      onChangeText={v => setForm(f => ({ ...f, [key]: v }))}
                      placeholder={placeholder} placeholderTextColor={C.textMuted}
                      keyboardType={(keyboard as any) || "default"}
                      secureTextEntry={!!secure} autoCapitalize="none"
                    />
                  </View>
                </View>
              ))}

              {/* 관리자 본인 계정 여부 */}
              <View style={[styles.selfToggleCard, { backgroundColor: C.card, borderColor: form.is_admin_self_teacher ? "#7C3AED" : C.border }]}>
                <View style={styles.selfToggleLeft}>
                  <View style={[styles.selfToggleIcon, { backgroundColor: "#7C3AED15" }]}>
                    <Feather name="shield" size={18} color="#7C3AED" />
                  </View>
                  <View>
                    <Text style={[styles.selfToggleTitle, { color: C.text }]}>관리자 본인용 계정</Text>
                    <Text style={[styles.selfToggleSub, { color: C.textMuted }]}>
                      {hasAdminSelf ? "이미 등록됨 (최대 1개)" : "최대 1개까지 가능"}
                    </Text>
                  </View>
                </View>
                <Switch
                  value={form.is_admin_self_teacher}
                  onValueChange={v => setForm(f => ({ ...f, is_admin_self_teacher: v }))}
                  trackColor={{ false: C.border, true: "#7C3AED" }}
                  thumbColor="#fff"
                  disabled={hasAdminSelf}
                />
              </View>

              <View style={[styles.infoBox, { backgroundColor: "#FEF3C7", borderRadius: 12, padding: 14 }]}>
                <Feather name="alert-circle" size={14} color="#D97706" />
                <Text style={[styles.infoText, { color: "#92400E" }]}>
                  계정 생성 후 인증코드가 발급됩니다.{"\n"}
                  선생님에게 인증코드를 전달하면{"\n"}
                  앱 로그인 후 계정을 활성화할 수 있습니다.
                </Text>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 새 선생님 생성 결과 모달 */}
      <Modal visible={!!newTeacher} animationType="fade" transparent>
        <View style={styles.overlay}>
          <View style={[styles.resultModal, { backgroundColor: C.card }]}>
            <View style={[styles.resultIcon, { backgroundColor: "#D1FAE5" }]}>
              <Feather name="check-circle" size={32} color="#059669" />
            </View>
            <Text style={[styles.resultTitle, { color: C.text }]}>선생님 계정이 생성됐어요</Text>
            <Text style={[styles.resultName, { color: C.tint }]}>{newTeacher?.teacher.name}</Text>
            <Text style={[styles.resultLabel, { color: C.textSecondary }]}>인증코드</Text>
            <View style={[styles.codeDisplay, { backgroundColor: "#FEF3C7" }]}>
              <Text style={[styles.codeDisplayValue, { color: "#92400E" }]}>{newTeacher?.code}</Text>
            </View>
            <Text style={[styles.resultHint, { color: C.textMuted }]}>
              위 인증코드를 선생님에게 전달해주세요.{"\n"}
              선생님이 앱에 로그인하면 인증 화면이 나타납니다.{"\n"}
              코드 유효시간: 24시간
            </Text>
            <Pressable
              style={[styles.resultBtn, { backgroundColor: C.tint }]}
              onPress={() => setNewTeacher(null)}
            >
              <Text style={styles.resultBtnText}>확인</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 16 },
  headerTitle: { fontSize: 24, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  addBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  infoBox: { flexDirection: "row", gap: 8, padding: 12, borderRadius: 10, alignItems: "flex-start" },
  infoText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 18 },
  empty: { alignItems: "center", gap: 10, paddingTop: 80 },
  emptyText: { fontSize: 16, fontFamily: "Inter_500Medium" },
  emptySub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  card: { borderRadius: 16, overflow: "hidden", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 12, elevation: 3 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  avatar: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  cardInfo: { flex: 1, gap: 2 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  teacherName: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  selfBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  selfBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  teacherEmail: { fontSize: 12, fontFamily: "Inter_400Regular" },
  teacherPhone: { fontSize: 12, fontFamily: "Inter_400Regular" },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  codeSection: { borderTopWidth: 1, padding: 12 },
  codeBox: {},
  codeLabel: { fontSize: 11, fontFamily: "Inter_500Medium", marginBottom: 4 },
  codeValue: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: 4, textAlign: "center", paddingVertical: 6 },
  codeHint: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 4, textAlign: "center" },
  viewCodeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1.5, borderRadius: 10, paddingVertical: 10 },
  viewCodeText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  cardActions: { flexDirection: "row", justifyContent: "flex-end", borderTopWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6 },
  actionText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  modal: { flex: 1 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1 },
  modalTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  saveBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, minWidth: 60, alignItems: "center" },
  saveBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  errBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10 },
  errText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, height: 48 },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  selfToggleCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1.5, borderRadius: 14, padding: 14 },
  selfToggleLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  selfToggleIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  selfToggleTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  selfToggleSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 24 },
  resultModal: { width: "100%", borderRadius: 24, padding: 28, gap: 12, alignItems: "center" },
  resultIcon: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  resultTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  resultName: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  resultLabel: { fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 8 },
  codeDisplay: { width: "100%", borderRadius: 14, paddingVertical: 16, paddingHorizontal: 20, alignItems: "center" },
  codeDisplayValue: { fontSize: 32, fontFamily: "Inter_700Bold", letterSpacing: 6 },
  resultHint: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  resultBtn: { width: "100%", height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 8 },
  resultBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
