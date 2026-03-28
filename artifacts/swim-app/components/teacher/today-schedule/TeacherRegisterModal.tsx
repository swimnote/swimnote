import { CircleAlert, CircleCheck, Info, X } from "lucide-react-native";
import React, { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import Colors from "@/constants/colors";
import { apiRequest } from "@/context/AuthContext";
import { WEEKLY_BADGE, WeeklyCount, isValidBirthYear, isValidPhone, normalizePhone } from "@/utils/studentUtils";

const C = Colors.light;

export default function TeacherRegisterModal({
  visible, token, themeColor, onClose, onSuccess,
}: {
  visible: boolean; token: string | null; themeColor: string;
  onClose: () => void; onSuccess: () => void;
}) {
  const [name, setName]             = useState("");
  const [birthYear, setBirthYear]   = useState("");
  const [parentName, setParentName] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [weekly, setWeekly]         = useState<WeeklyCount>(1);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState("");
  const [done, setDone]             = useState(false);
  const [doneMsg, setDoneMsg]       = useState("");

  function reset() {
    setName(""); setBirthYear(""); setParentName(""); setParentPhone("");
    setWeekly(1); setSaving(false); setError(""); setDone(false); setDoneMsg("");
  }
  function handleClose() { reset(); onClose(); }
  function validate(): string | null {
    if (!name.trim()) return "학생 이름을 입력해주세요.";
    if (birthYear && !isValidBirthYear(birthYear)) return "출생년도 형식이 올바르지 않습니다. (예: 2015)";
    if (parentPhone && !isValidPhone(parentPhone)) return "보호자 전화번호 형식이 올바르지 않습니다.";
    return null;
  }
  async function handleSubmit() {
    const e = validate();
    if (e) { setError(e); return; }
    setSaving(true); setError("");
    try {
      const res = await apiRequest(token, "/students/teacher-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          birth_year: birthYear || undefined,
          parent_name: parentName || undefined,
          parent_phone: parentPhone ? normalizePhone(parentPhone) : undefined,
          weekly_count: weekly,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || data.error || "오류가 발생했습니다."); return; }
      setDoneMsg(`${name.trim()} 학생 등록 요청이 접수됐습니다.`);
      setDone(true);
      onSuccess();
    } catch { setError("네트워크 오류가 발생했습니다."); }
    finally { setSaving(false); }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <KeyboardAvoidingView style={treg.overlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={treg.sheet}>
          <View style={treg.handle} />
          {done ? (
            <View style={treg.doneWrap}>
              <View style={[treg.doneIcon, { backgroundColor: themeColor + "20" }]}>
                <CircleCheck size={36} color={themeColor} />
              </View>
              <Text style={[treg.doneTitle, { color: C.text }]}>등록요청 완료</Text>
              <Text style={[treg.doneSub, { color: C.textSecondary }]}>{doneMsg}</Text>
              <Text style={[treg.doneSub, { color: C.textMuted, fontSize: 12 }]}>
                관리자 승인 후 정식 회원으로 반영됩니다.
              </Text>
              <Pressable style={[treg.saveBtn, { backgroundColor: themeColor }]} onPress={handleClose}>
                <Text style={treg.saveBtnText}>확인</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={treg.header}>
                <Text style={treg.title}>회원 등록 요청</Text>
                <Pressable onPress={handleClose}><X size={22} color={C.textSecondary} /></Pressable>
              </View>
              {error ? (
                <View style={treg.errorRow}>
                  <CircleAlert size={14} color={C.error} />
                  <Text style={treg.errorText}>{error}</Text>
                </View>
              ) : null}
              <ScrollView showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>
                <View style={treg.field}>
                  <Text style={treg.label}>학생 이름 *</Text>
                  <TextInput style={treg.input} value={name} onChangeText={setName} placeholder="홍길동" placeholderTextColor={C.textMuted} />
                </View>
                <View style={treg.field}>
                  <Text style={treg.label}>출생년도 (중복 체크에 사용)</Text>
                  <TextInput style={treg.input} value={birthYear} onChangeText={setBirthYear} placeholder="예: 2015" placeholderTextColor={C.textMuted} keyboardType="number-pad" maxLength={4} />
                </View>
                <View style={treg.field}>
                  <Text style={treg.label}>보호자 이름</Text>
                  <TextInput style={treg.input} value={parentName} onChangeText={setParentName} placeholder="김보호 (선택)" placeholderTextColor={C.textMuted} />
                </View>
                <View style={treg.field}>
                  <Text style={treg.label}>보호자 전화번호</Text>
                  <TextInput style={treg.input} value={parentPhone} onChangeText={setParentPhone} placeholder="010-1234-5678" placeholderTextColor={C.textMuted} keyboardType="phone-pad" />
                </View>
                <View style={treg.field}>
                  <Text style={treg.label}>주 수업 횟수</Text>
                  <View style={treg.weekRow}>
                    {([1, 2, 3] as WeeklyCount[]).map(w => {
                      const badge = WEEKLY_BADGE[w];
                      return (
                        <Pressable key={w}
                          style={[treg.weekBtn, { backgroundColor: weekly === w ? badge.bg : C.background, borderColor: weekly === w ? badge.color : C.border }]}
                          onPress={() => setWeekly(w)}>
                          <Text style={[treg.weekBtnText, { color: weekly === w ? badge.color : C.textSecondary }]}>{badge.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              </ScrollView>
              <View style={treg.notice}>
                <Info size={13} color={themeColor} />
                <Text style={[treg.noticeText, { color: C.textSecondary }]}>관리자 승인 후 정식 회원으로 반영됩니다.</Text>
              </View>
              <Pressable style={[treg.saveBtn, { backgroundColor: themeColor, opacity: saving ? 0.7 : 1 }]}
                onPress={handleSubmit} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={treg.saveBtnText}>등록요청</Text>}
              </Pressable>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const treg = StyleSheet.create({
  overlay:     { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  sheet:       { backgroundColor: C.card, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 24, gap: 14, maxHeight: "90%" },
  handle:      { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 4 },
  header:      { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title:       { fontSize: 20, fontFamily: "Pretendard-Regular", color: C.text },
  errorRow:    { flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: "#F9DEDA", padding: 10, borderRadius: 10 },
  errorText:   { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: C.error },
  field:       { gap: 6, marginBottom: 12 },
  label:       { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  input:       { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, height: 46, fontSize: 15, fontFamily: "Pretendard-Regular", color: C.text, borderColor: C.border, backgroundColor: C.background },
  weekRow:     { flexDirection: "row", gap: 10 },
  weekBtn:     { flex: 1, paddingVertical: 11, borderRadius: 12, borderWidth: 1.5, alignItems: "center" },
  weekBtnText: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  notice:      { flexDirection: "row", gap: 6, alignItems: "flex-start", backgroundColor: C.tintLight, padding: 12, borderRadius: 12 },
  noticeText:  { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", lineHeight: 18 },
  saveBtn:     { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", alignSelf: "stretch" },
  saveBtnText: { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" },
  doneWrap:    { alignItems: "center", gap: 14, paddingVertical: 20 },
  doneIcon:    { width: 80, height: 80, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  doneTitle:   { fontSize: 20, fontFamily: "Pretendard-Regular" },
  doneSub:     { fontSize: 14, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 20 },
});
