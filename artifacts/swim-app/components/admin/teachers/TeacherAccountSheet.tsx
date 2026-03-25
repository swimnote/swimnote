import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import Colors from "@/constants/colors";
import { apiRequest } from "@/context/AuthContext";

const C = Colors.light;

interface Teacher {
  id: string; name: string; email: string; phone: string; position: string;
  is_activated: boolean; is_admin_self_teacher: boolean; created_at: string;
}

interface TeacherAccountSheetProps {
  visible: boolean;
  teachers: Teacher[];
  token: string | null;
  onClose: () => void;
  onRefresh: () => void;
}

export function TeacherAccountSheet({
  visible, teachers, token, onClose, onRefresh,
}: TeacherAccountSheetProps) {
  const [showAdd, setShowAdd]         = useState(false);
  const [saving, setSaving]           = useState(false);
  const [addError, setAddError]       = useState("");
  const [newTeacher, setNewTeacher]   = useState<{ teacher: Teacher; code: string } | null>(null);
  const [codeVisible, setCodeVisible] = useState<Record<string, string>>({});
  const [loadingCode, setLoadingCode] = useState<string | null>(null);
  const [form, setForm]               = useState({ name: "", email: "", phone: "", password: "", is_admin_self_teacher: false });
  const [selectedDetail, setSelectedDetail] = useState<Teacher | null>(null);
  const [editName, setEditName]       = useState("");
  const [editPhone, setEditPhone]     = useState("");
  const [editPosition, setEditPosition] = useState("");
  const [editSaving, setEditSaving]   = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Teacher | null>(null);

  function resetForm() { setForm({ name: "", email: "", phone: "", password: "", is_admin_self_teacher: false }); setAddError(""); }

  async function handleCreate() {
    if (!form.name.trim() || !form.email.trim() || !form.password || !form.phone.trim()) { setAddError("모든 필수 항목을 입력해주세요."); return; }
    if (form.password.length < 6) { setAddError("비밀번호는 6자 이상이어야 합니다."); return; }
    setSaving(true); setAddError("");
    try {
      const res = await apiRequest(token, "/teachers", { method: "POST", body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "생성 실패");
      setShowAdd(false); resetForm();
      setNewTeacher({ teacher: data.teacher, code: data.activation_code });
      onRefresh();
    } catch (err: any) { setAddError(err.message || "생성 중 오류"); }
    finally { setSaving(false); }
  }

  async function handleViewCode(id: string) {
    setLoadingCode(id);
    try {
      const res = await apiRequest(token, `/teachers/${id}/activation-code`);
      const data = await res.json();
      if (res.ok) setCodeVisible(prev => ({ ...prev, [id]: data.activation_code }));
    } finally { setLoadingCode(null); }
  }

  function openTeacherEdit(t: Teacher) {
    setSelectedDetail(t); setEditName(t.name); setEditPhone(t.phone || ""); setEditPosition(t.position || "");
  }

  async function handleSaveTeacher() {
    if (!selectedDetail) return;
    setEditSaving(true);
    try {
      const res = await apiRequest(token, `/teachers/${selectedDetail.id}`, {
        method: "PATCH", body: JSON.stringify({ name: editName, phone: editPhone, position: editPosition }),
      });
      if (res.ok) { onRefresh(); setSelectedDetail(null); }
    } finally { setEditSaving(false); }
  }

  async function confirmDeleteTeacher() {
    if (!deleteTarget) return;
    const res = await apiRequest(token, `/teachers/${deleteTarget.id}`, { method: "DELETE" });
    setDeleteTarget(null);
    if (res.ok) { onRefresh(); setSelectedDetail(null); }
  }

  return (
    <>
      {/* ── 계정 목록 모달 ── */}
      <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
        <View style={[ts.overlay, { justifyContent: "flex-end" }]}>
          <View style={[ts.sheet, { backgroundColor: C.card, height: "85%", borderTopLeftRadius: 24, borderTopRightRadius: 24 }]}>
            <View style={ts.sheetHandle} />
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 12 }}>
              <Text style={[ts.sheetTitle, { color: C.text }]}>선생님 계정 관리</Text>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable style={[ts.addBtn, { backgroundColor: C.tint }]} onPress={() => { resetForm(); setShowAdd(true); }}>
                  <Feather name="plus" size={16} color="#fff" />
                  <Text style={ts.addBtnText}>계정 추가</Text>
                </Pressable>
                <Pressable onPress={onClose}>
                  <Feather name="x" size={22} color={C.textSecondary} />
                </Pressable>
              </View>
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 100, gap: 10 }} showsVerticalScrollIndicator={false}>
              {teachers.length === 0 ? (
                <View style={ts.emptyBox}><Feather name="users" size={36} color={C.textMuted} /><Text style={[ts.emptyText, { color: C.textMuted }]}>등록된 선생님이 없습니다</Text></View>
              ) : teachers.map(t => (
                <View key={t.id} style={[ts.teacherCard, { backgroundColor: C.background }]}>
                  <Pressable style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }} onPress={() => openTeacherEdit(t)}>
                    <View style={[ts.avatar, { backgroundColor: C.tintLight }]}><Feather name="user" size={18} color={C.tint} /></View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={[ts.teacherName, { color: C.text }]}>{t.name}</Text>
                        {t.is_admin_self_teacher && (
                          <View style={[ts.selfBadge, { backgroundColor: "#7C3AED15" }]}>
                            <Text style={[ts.selfBadgeText, { color: "#7C3AED" }]}>내 계정</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[ts.teacherSub, { color: C.textMuted }]}>{t.email}</Text>
                      {t.position && <Text style={[ts.teacherSub, { color: C.tint }]}>{t.position}</Text>}
                    </View>
                    <View style={[ts.statusBadge, { backgroundColor: t.is_activated ? "#DDF2EF" : "#FFF1BF" }]}>
                      <Text style={[ts.statusText, { color: t.is_activated ? "#1F8F86" : "#D97706" }]}>{t.is_activated ? "활성" : "인증 대기"}</Text>
                    </View>
                    <Feather name="edit-2" size={14} color={C.textMuted} />
                  </Pressable>
                  {!t.is_activated && (
                    <Pressable style={[ts.codeBtn, { borderTopColor: C.border }]} onPress={() => handleViewCode(t.id)} disabled={loadingCode === t.id}>
                      {loadingCode === t.id ? <ActivityIndicator size={14} color={C.tint} />
                        : codeVisible[t.id] ? <Text style={[ts.codeBtnText, { color: C.tint }]}>인증코드: {codeVisible[t.id]}</Text>
                        : <><Feather name="eye" size={13} color={C.tint} /><Text style={[ts.codeBtnText, { color: C.tint }]}>인증코드 보기</Text></>}
                    </Pressable>
                  )}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── 계정 추가 모달 ── */}
      <Modal visible={showAdd} animationType="slide" transparent presentationStyle="overFullScreen">
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={[ts.overlay, { justifyContent: "flex-end" }]}>
            <View style={[ts.sheet, { backgroundColor: C.card, paddingBottom: 40 }]}>
              <View style={ts.sheetHandle} />
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={[ts.sheetTitle, { color: C.text }]}>선생님 계정 추가</Text>
                <Pressable onPress={() => { setShowAdd(false); resetForm(); }}><Feather name="x" size={22} color={C.textSecondary} /></Pressable>
              </View>
              {addError ? <View style={[ts.errBox, { backgroundColor: "#F9DEDA" }]}><Text style={[ts.errText, { color: "#D96C6C" }]}>{addError}</Text></View> : null}
              <View style={ts.field}><Text style={[ts.label, { color: C.textSecondary }]}>이름 *</Text>
                <TextInput style={[ts.input, { borderColor: C.border, color: C.text }]} value={form.name} onChangeText={v => setForm(f => ({ ...f, name: v }))} placeholder="선생님 이름" placeholderTextColor={C.textMuted} /></View>
              <View style={ts.field}><Text style={[ts.label, { color: C.textSecondary }]}>이메일 *</Text>
                <TextInput style={[ts.input, { borderColor: C.border, color: C.text }]} value={form.email} onChangeText={v => setForm(f => ({ ...f, email: v }))} placeholder="이메일" placeholderTextColor={C.textMuted} keyboardType="email-address" autoCapitalize="none" /></View>
              <View style={ts.field}><Text style={[ts.label, { color: C.textSecondary }]}>연락처 *</Text>
                <TextInput style={[ts.input, { borderColor: C.border, color: C.text }]} value={form.phone} onChangeText={v => setForm(f => ({ ...f, phone: v }))} placeholder="010-0000-0000" placeholderTextColor={C.textMuted} keyboardType="phone-pad" /></View>
              <View style={ts.field}><Text style={[ts.label, { color: C.textSecondary }]}>비밀번호 *</Text>
                <TextInput style={[ts.input, { borderColor: C.border, color: C.text }]} value={form.password} onChangeText={v => setForm(f => ({ ...f, password: v }))} placeholder="6자 이상" placeholderTextColor={C.textMuted} secureTextEntry /></View>
              <View style={[ts.switchRow, { borderTopColor: C.border }]}>
                <Text style={[ts.switchLabel, { color: C.text }]}>관리자 본인용 선생님 계정</Text>
                <Switch value={form.is_admin_self_teacher} onValueChange={v => setForm(f => ({ ...f, is_admin_self_teacher: v }))} trackColor={{ true: C.tint }} />
              </View>
              <View style={ts.modalActions}>
                <Pressable style={[ts.cancelBtn, { borderColor: C.border }]} onPress={() => { setShowAdd(false); resetForm(); }}>
                  <Text style={[ts.cancelText, { color: C.textSecondary }]}>취소</Text>
                </Pressable>
                <Pressable style={[ts.submitBtn, { backgroundColor: saving ? C.textMuted : C.tint }]} onPress={handleCreate} disabled={saving}>
                  <Text style={ts.submitText}>{saving ? "생성 중…" : "계정 생성"}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── 생성 성공 모달 ── */}
      <Modal visible={!!newTeacher} animationType="fade" transparent presentationStyle="overFullScreen">
        <View style={[ts.overlay, { justifyContent: "center" }]}>
          <View style={[ts.successCard, { backgroundColor: C.card }]}>
            <View style={[ts.successIcon, { backgroundColor: "#DDF2EF" }]}><Feather name="check-circle" size={36} color="#1F8F86" /></View>
            <Text style={[ts.sheetTitle, { color: C.text, textAlign: "center" }]}>계정 생성 완료</Text>
            <Text style={[ts.label, { color: C.textSecondary, textAlign: "center" }]}>
              {newTeacher?.teacher.name} 선생님 계정이 생성되었습니다.{"\n"}아래 인증코드를 전달해 주세요.
            </Text>
            <View style={[ts.codeBox, { backgroundColor: C.tintLight, borderRadius: 12 }]}>
              <Text style={[ts.codeText, { color: C.tint }]}>{newTeacher?.code}</Text>
            </View>
            <Pressable style={[ts.submitBtn, { backgroundColor: C.tint, width: "100%" }]} onPress={() => setNewTeacher(null)}>
              <Text style={ts.submitText}>확인</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── 선생님 정보 수정 모달 ── */}
      <Modal visible={!!selectedDetail} animationType="slide" transparent presentationStyle="overFullScreen">
        <View style={[ts.overlay, { justifyContent: "flex-end" }]}>
          <View style={[ts.sheet, { backgroundColor: C.card, paddingBottom: 40 }]}>
            <View style={ts.sheetHandle} />
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={[ts.sheetTitle, { color: C.text }]}>선생님 정보 수정</Text>
              <Pressable onPress={() => setSelectedDetail(null)}><Feather name="x" size={22} color={C.textSecondary} /></Pressable>
            </View>
            <View style={ts.field}><Text style={[ts.label, { color: C.textSecondary }]}>이름</Text>
              <TextInput style={[ts.input, { borderColor: C.border, color: C.text }]} value={editName} onChangeText={setEditName} placeholderTextColor={C.textMuted} /></View>
            <View style={ts.field}><Text style={[ts.label, { color: C.textSecondary }]}>연락처</Text>
              <TextInput style={[ts.input, { borderColor: C.border, color: C.text }]} value={editPhone} onChangeText={setEditPhone} keyboardType="phone-pad" placeholderTextColor={C.textMuted} /></View>
            <View style={ts.field}><Text style={[ts.label, { color: C.textSecondary }]}>직급</Text>
              <TextInput style={[ts.input, { borderColor: C.border, color: C.text }]} value={editPosition} onChangeText={setEditPosition} placeholder="예: 수석코치" placeholderTextColor={C.textMuted} /></View>
            <View style={[ts.field, { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 }]}>
              <Text style={[ts.label, { color: C.textMuted }]}>이메일: {selectedDetail?.email}</Text>
            </View>
            <View style={ts.modalActions}>
              <Pressable style={[ts.cancelBtn, { borderColor: "#D96C6C" }]} onPress={() => { const t = selectedDetail; setSelectedDetail(null); setDeleteTarget(t); }}>
                <Text style={[ts.cancelText, { color: "#D96C6C" }]}>삭제</Text>
              </Pressable>
              <Pressable style={[ts.submitBtn, { backgroundColor: editSaving ? C.textMuted : C.tint }]} onPress={handleSaveTeacher} disabled={editSaving}>
                <Text style={ts.submitText}>{editSaving ? "저장 중…" : "저장"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── 삭제 확인 모달 ── */}
      <Modal visible={!!deleteTarget} animationType="fade" transparent presentationStyle="overFullScreen">
        <View style={[ts.overlay, { justifyContent: "center" }]}>
          <View style={[ts.successCard, { backgroundColor: C.card, gap: 16 }]}>
            <Text style={[ts.sheetTitle, { color: C.text, textAlign: "center" }]}>선생님 삭제</Text>
            <Text style={[ts.label, { color: C.textSecondary, textAlign: "center" }]}>
              {deleteTarget?.name} 계정을 삭제하시겠습니까?{"\n"}이 작업은 되돌릴 수 없습니다.
            </Text>
            <View style={ts.modalActions}>
              <Pressable style={[ts.cancelBtn, { borderColor: C.border }]} onPress={() => setDeleteTarget(null)}>
                <Text style={[ts.cancelText, { color: C.textSecondary }]}>취소</Text>
              </Pressable>
              <Pressable style={[ts.submitBtn, { backgroundColor: "#D96C6C" }]} onPress={confirmDeleteTeacher}>
                <Text style={ts.submitText}>삭제</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const ts = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 14 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  successCard: { marginHorizontal: 24, borderRadius: 20, padding: 24, alignItems: "center", gap: 12 },
  successIcon: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  addBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
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
  teacherCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, padding: 14, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  teacherName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  teacherSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  selfBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  selfBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  codeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderTopWidth: 1 },
  codeBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  codeBox: { padding: 16, alignItems: "center" },
  codeText: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: 6 },
  emptyBox: { alignItems: "center", paddingVertical: 48, gap: 10 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
});
