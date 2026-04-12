/**
 * 학부모 프로필 수정
 * - 이름, 전화번호, 비밀번호 변경
 * - ParentScreenHeader (홈 버튼 → 학부모 홈)
 */
import { CircleAlert, Trash2 } from "lucide-react-native";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { ParentScreenHeader } from "@/components/parent/ParentScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { validateName, validatePhone, normalizePhone } from "@/utils/validation";

const C = Colors.light;

function Field({ label, value, onChangeText, placeholder, secureEntry = false, keyboardType = "default" as any, note }: any) {
  return (
    <View style={f.wrap}>
      <Text style={[f.label, { color: C.textSecondary }]}>{label}</Text>
      <TextInput
        style={[f.input, { backgroundColor: "#FFFFFF", color: C.text }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={C.textMuted}
        secureTextEntry={secureEntry}
        keyboardType={keyboardType}
        autoCapitalize="none"
      />
      {note && <Text style={[f.note, { color: C.textMuted }]}>{note}</Text>}
    </View>
  );
}

export default function ParentProfileScreen() {
  const { token, parentAccount, updateParentProfile, logout } = useAuth();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState(parentAccount?.name ?? "");
  const [phone, setPhone] = useState("");
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveDone, setSaveDone] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({ name: "", phone: "", newPw: "", newPw2: "", currentPw: "" });

  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await apiRequest(token, "/parent/me");
        if (r.ok) { const d = await r.json(); setName(d.name ?? ""); setPhone(d.phone ?? ""); }
      } catch {}
    })();
  }, []);

  async function deleteAccount() {
    if (deleteConfirmText !== "탈퇴") { setDeleteMsg("'탈퇴'를 정확히 입력해주세요."); return; }
    setDeleteLoading(true); setDeleteMsg("");
    try {
      const res = await apiRequest(token, "/auth/account", { method: "DELETE" });
      if (res.ok) {
        setDeleteVisible(false);
        Alert.alert("계정 탈퇴 완료", "계정이 삭제되었습니다. 이용해 주셔서 감사합니다.", [
          { text: "확인", onPress: () => { logout(); router.replace("/"); } },
        ]);
      } else {
        const d = await res.json().catch(() => ({}));
        setDeleteMsg(d.message || d.error || "탈퇴 처리에 실패했습니다.");
      }
    } catch { setDeleteMsg("오류가 발생했습니다. 다시 시도해주세요."); }
    finally { setDeleteLoading(false); }
  }

  async function handleSave() {
    setError("");
    const errs = { name: "", phone: "", newPw: "", newPw2: "", currentPw: "" };

    if (!validateName(name)) {
      errs.name = "이름을 입력해주세요";
    }
    if (phone && !validatePhone(phone)) {
      errs.phone = "전화번호 형식이 올바르지 않습니다";
    }
    if (newPw && newPw.length < 6) {
      errs.newPw = "비밀번호는 6자 이상이어야 합니다";
    }
    if (newPw && !errs.newPw && newPw !== newPw2) {
      errs.newPw2 = "비밀번호가 일치하지 않습니다";
    }
    if (newPw && !currentPw) {
      errs.currentPw = "현재 비밀번호를 입력해주세요";
    }

    setFieldErrors(errs);
    if (errs.name || errs.phone || errs.newPw || errs.newPw2 || errs.currentPw) return;

    // UI 표시값(phone)과 서버 전송값(normalizedPhone) 분리
    const normalizedPhone = phone ? normalizePhone(phone) : null;

    setSaving(true);
    try {
      const body: any = { name: name.trim(), phone: normalizedPhone };
      if (newPw) { body.current_password = currentPw; body.new_password = newPw; }

      const r = await apiRequest(token, "/parent/me", {
        method: "PUT", body: JSON.stringify(body),
      });
      if (r.ok) {
        updateParentProfile({ name: name.trim(), phone: phone.trim() || undefined });
        setSaveDone(true);
        setCurrentPw(""); setNewPw(""); setNewPw2("");
        setFieldErrors({ name: "", phone: "", newPw: "", newPw2: "", currentPw: "" });
      } else {
        const d = await r.json().catch(() => ({}));
        setError(d.error || "저장에 실패했습니다");
      }
    } catch { setError("저장 중 오류가 발생했습니다"); }
    finally { setSaving(false); }
  }

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <ParentScreenHeader title="내 정보 수정" />

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40, gap: 20 }}
        >
          {/* 기본 정보 */}
          <View style={[s.section, { backgroundColor: C.card }]}>
            <Text style={[s.sectionTitle, { color: C.text }]}>기본 정보</Text>
            <Field
              label="이름"
              value={name}
              onChangeText={(v: string) => { setName(v); setFieldErrors(e => ({ ...e, name: "" })); }}
              placeholder="이름 입력"
            />
            {fieldErrors.name ? <Text style={s.fieldErr}>{fieldErrors.name}</Text> : null}
            <Field
              label="전화번호"
              value={phone}
              onChangeText={(v: string) => { setPhone(v); setFieldErrors(e => ({ ...e, phone: "" })); }}
              placeholder="010-0000-0000"
              keyboardType="phone-pad"
            />
            {fieldErrors.phone ? <Text style={s.fieldErr}>{fieldErrors.phone}</Text> : null}
          </View>

          {/* 비밀번호 변경 */}
          <View style={[s.section, { backgroundColor: C.card }]}>
            <Text style={[s.sectionTitle, { color: C.text }]}>비밀번호 변경</Text>
            <Text style={[s.sectionSub, { color: C.textMuted }]}>변경하지 않으려면 비워두세요</Text>
            <Field
              label="현재 비밀번호"
              value={currentPw}
              onChangeText={(v: string) => { setCurrentPw(v); setFieldErrors(e => ({ ...e, currentPw: "" })); }}
              placeholder="현재 비밀번호"
              secureEntry
            />
            {fieldErrors.currentPw ? <Text style={s.fieldErr}>{fieldErrors.currentPw}</Text> : null}
            <Field
              label="새 비밀번호"
              value={newPw}
              onChangeText={(v: string) => { setNewPw(v); setFieldErrors(e => ({ ...e, newPw: "" })); }}
              placeholder="새 비밀번호 (6자 이상)"
              secureEntry
            />
            {fieldErrors.newPw ? <Text style={s.fieldErr}>{fieldErrors.newPw}</Text> : null}
            <Field
              label="새 비밀번호 확인"
              value={newPw2}
              onChangeText={(v: string) => { setNewPw2(v); setFieldErrors(e => ({ ...e, newPw2: "" })); }}
              placeholder="새 비밀번호 재입력"
              secureEntry
            />
            {fieldErrors.newPw2 ? <Text style={s.fieldErr}>{fieldErrors.newPw2}</Text> : null}
          </View>

          {error ? (
            <View style={[s.errorBox, { backgroundColor: "#F9DEDA" }]}>
              <CircleAlert size={14} color="#D96C6C" />
              <Text style={s.errorTxt}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            style={[s.saveBtn, { backgroundColor: C.button, opacity: saving ? 0.7 : 1 }]}
            disabled={saving}
            onPress={handleSave}
          >
            {saving
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.saveBtnTxt}>저장</Text>
            }
          </Pressable>

          <Pressable
            style={s.inquiryBtn}
            onPress={() => router.push("/support-ticket-list" as any)}
          >
            <Text style={s.inquiryBtnTxt}>스윔노트에 문의하기</Text>
          </Pressable>

          {/* ── 계정 탈퇴 ── */}
          <View style={[s.section, { backgroundColor: C.card, gap: 10 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Trash2 size={14} color="#D96C6C" />
              <Text style={[s.sectionTitle, { color: "#D96C6C" }]}>계정 탈퇴</Text>
            </View>
            <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted, lineHeight: 18 }}>
              탈퇴 시 계정 및 모든 개인정보가 영구적으로 삭제되며 복구할 수 없습니다.
            </Text>
            <Pressable
              style={({ pressed }) => [s.deleteBtn, { opacity: pressed ? 0.7 : 1 }]}
              onPress={() => { setDeleteConfirmText(""); setDeleteMsg(""); setDeleteVisible(true); }}
            >
              <Text style={s.deleteBtnTxt}>계정 탈퇴하기</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ═══ 계정 탈퇴 확인 모달 ═══ */}
      <Modal visible={deleteVisible} animationType="slide" transparent presentationStyle="overFullScreen">
        <View style={s.deleteOverlay}>
          <View style={[s.deleteModal, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={s.deleteModalTitle}>계정 탈퇴</Text>
            <View style={[s.deleteWarnBox]}>
              <Text style={s.deleteWarnTxt}>⚠️ 탈퇴 시 모든 계정 정보가 즉시 삭제되며{"\n"}복구가 불가능합니다.</Text>
            </View>
            <Text style={s.deleteInputLabel}>확인을 위해 아래에 <Text style={{ color: "#D96C6C" }}>'탈퇴'</Text>를 입력하세요</Text>
            <TextInput
              style={[s.deleteInput, { color: C.text }]}
              value={deleteConfirmText}
              onChangeText={(t) => { setDeleteConfirmText(t); setDeleteMsg(""); }}
              placeholder="탈퇴"
              placeholderTextColor={C.textMuted}
            />
            {deleteMsg ? (
              <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: "#D96C6C" }}>{deleteMsg}</Text>
            ) : null}
            <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
              <Pressable style={[s.deleteCancelBtn]} onPress={() => setDeleteVisible(false)}>
                <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary }}>취소</Text>
              </Pressable>
              <Pressable
                style={[s.deleteConfirmBtn, { opacity: (deleteLoading || deleteConfirmText !== "탈퇴") ? 0.5 : 1 }]}
                onPress={deleteAccount}
                disabled={deleteLoading || deleteConfirmText !== "탈퇴"}
              >
                {deleteLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" }}>계정 영구 삭제</Text>
                }
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <ConfirmModal
        visible={saveDone}
        title="저장 완료"
        message="정보가 저장되었습니다."
        confirmText="확인"
        onConfirm={() => { setSaveDone(false); router.back(); }}
        onCancel={() => setSaveDone(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  section: { borderRadius: 16, padding: 16, gap: 12 },
  sectionTitle: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  sectionSub: { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: -6 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, padding: 12 },
  errorTxt: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#D96C6C", flex: 1 },
  saveBtn: { borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  saveBtnTxt: { fontSize: 16, fontFamily: "Pretendard-Regular", color: "#fff" },
  inquiryBtn: { borderRadius: 14, paddingVertical: 14, alignItems: "center",
                borderWidth: 1.5, borderColor: "#C4B5FD", backgroundColor: "#EEDDF5" },
  inquiryBtnTxt: { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#7C3AED" },
  deleteBtn: { borderWidth: 1.5, borderColor: "#D96C6C", borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  deleteBtnTxt: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#D96C6C" },
  deleteOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  deleteModal: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 12 },
  deleteModalTitle: { fontSize: 18, fontFamily: "Pretendard-Regular", color: "#D96C6C" },
  deleteWarnBox: { backgroundColor: "#FEF2F2", borderRadius: 10, padding: 12 },
  deleteWarnTxt: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#D96C6C", lineHeight: 20 },
  deleteInputLabel: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B" },
  deleteInput: { borderWidth: 1.5, borderColor: "#D96C6C", borderRadius: 12, paddingHorizontal: 14, height: 46, fontSize: 15, fontFamily: "Pretendard-Regular" },
  deleteCancelBtn: { flex: 1, borderWidth: 1.5, borderColor: "#CBD5E1", borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  deleteConfirmBtn: { flex: 2, backgroundColor: "#D96C6C", borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  fieldErr: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#D96C6C", marginTop: -4 },
});

const f = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  input: {
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11,
    fontSize: 14, fontFamily: "Pretendard-Regular",
  },
  note: { fontSize: 11, fontFamily: "Pretendard-Regular" },
});
