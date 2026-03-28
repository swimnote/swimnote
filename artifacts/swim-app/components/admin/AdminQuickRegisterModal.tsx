import { CircleAlert, CircleCheck, Info, X } from "lucide-react-native";
import React, { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import Colors from "@/constants/colors";
import { apiRequest } from "@/context/AuthContext";
import {
  WeeklyCount, WEEKLY_BADGE, normalizePhone, isValidPhone, isValidBirthYear,
} from "@/utils/studentUtils";

const C = Colors.light;

interface AdminQuickRegisterModalProps {
  visible: boolean;
  token: string | null;
  poolName: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function AdminQuickRegisterModal({
  visible, token, poolName, onClose, onSuccess,
}: AdminQuickRegisterModalProps) {
  const [name,        setName]        = useState("");
  const [birthYear,   setBirthYear]   = useState("");
  const [parentName,  setParentName]  = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [weekly,      setWeekly]      = useState<WeeklyCount>(1);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState("");
  const [done,        setDone]        = useState(false);
  const [doneName,    setDoneName]    = useState("");

  function handleClose() {
    setName(""); setBirthYear(""); setParentName(""); setParentPhone("");
    setWeekly(1); setError(""); setDone(false); setDoneName("");
    onClose();
  }

  function validate(): string | null {
    if (!name.trim()) return "학생 이름을 입력해주세요.";
    if (birthYear && !isValidBirthYear(birthYear)) return "출생년도가 올바르지 않습니다. (예: 2015)";
    if (parentPhone && !isValidPhone(parentPhone)) return "보호자 전화번호 형식이 올바르지 않습니다.";
    return null;
  }

  async function submit() {
    const e = validate();
    if (e) { setError(e); return; }
    setSaving(true); setError("");
    try {
      const res = await apiRequest(token, "/students", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          birth_year: birthYear || undefined,
          parent_name: parentName || undefined,
          parent_phone: parentPhone ? normalizePhone(parentPhone) : undefined,
          weekly_count: weekly,
          registration_path: "admin_created",
          force_create: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || data.error || "오류가 발생했습니다."); return; }
      setDoneName(data.name || name.trim());
      setDone(true);
      onSuccess();
    } catch { setError("네트워크 오류가 발생했습니다."); }
    finally { setSaving(false); }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <KeyboardAvoidingView style={qr.overlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={qr.sheet}>
          <View style={qr.handle} />
          {done ? (
            <View style={qr.doneWrap}>
              <View style={[qr.doneIcon, { backgroundColor: "#2EC4B6" + "18" }]}>
                <CircleCheck size={36} color="#2EC4B6" />
              </View>
              <Text style={qr.doneTitle}>등록 완료</Text>
              <Text style={qr.doneSub}>{doneName} 학생이{"\n"}정식 회원으로 등록됐습니다.</Text>
              <Text style={[qr.doneSub, { fontSize: 12, color: C.textMuted }]}>회원 관리에서 초대코드를 확인할 수 있습니다.</Text>
              <Pressable style={[qr.saveBtn, { backgroundColor: "#2EC4B6" }]} onPress={handleClose}>
                <Text style={qr.saveBtnTxt}>확인</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={qr.header}>
                <Text style={qr.title}>어린이 직접 등록</Text>
                <Pressable onPress={handleClose}><X size={22} color={C.textSecondary} /></Pressable>
              </View>
              {error ? (
                <View style={qr.errorRow}>
                  <CircleAlert size={14} color={C.error} />
                  <Text style={qr.errorTxt}>{error}</Text>
                </View>
              ) : null}
              <ScrollView showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>
                <View style={qr.field}>
                  <Text style={qr.label}>학생 이름 *</Text>
                  <TextInput style={qr.input} value={name} onChangeText={setName} placeholder="홍길동" placeholderTextColor={C.textMuted} />
                </View>
                <View style={qr.field}>
                  <Text style={qr.label}>출생년도 (중복 체크에 사용)</Text>
                  <TextInput style={qr.input} value={birthYear} onChangeText={setBirthYear} placeholder="예: 2015" placeholderTextColor={C.textMuted} keyboardType="number-pad" maxLength={4} />
                </View>
                <View style={qr.field}>
                  <Text style={qr.label}>보호자 이름</Text>
                  <TextInput style={qr.input} value={parentName} onChangeText={setParentName} placeholder="김보호 (선택)" placeholderTextColor={C.textMuted} />
                </View>
                <View style={qr.field}>
                  <Text style={qr.label}>보호자 전화번호</Text>
                  <TextInput style={qr.input} value={parentPhone} onChangeText={setParentPhone} placeholder="010-1234-5678" placeholderTextColor={C.textMuted} keyboardType="phone-pad" />
                </View>
                <View style={qr.field}>
                  <Text style={qr.label}>주 수업 횟수</Text>
                  <View style={qr.weekRow}>
                    {([1, 2, 3] as WeeklyCount[]).map(w => {
                      const badge = WEEKLY_BADGE[w];
                      return (
                        <Pressable key={w}
                          style={[qr.weekBtn, { backgroundColor: weekly === w ? badge.bg : C.background, borderColor: weekly === w ? badge.color : C.border }]}
                          onPress={() => setWeekly(w)}
                        >
                          <Text style={[qr.weekBtnTxt, { color: weekly === w ? badge.color : C.textSecondary }]}>{badge.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              </ScrollView>
              <View style={qr.notice}>
                <Info size={13} color={C.textMuted} />
                <Text style={qr.noticeTxt}>등록 후 초대코드가 생성됩니다. 보호자에게 전달하여 앱 연결을 유도할 수 있습니다.</Text>
              </View>
              <Pressable style={[qr.saveBtn, { backgroundColor: "#2EC4B6", opacity: saving ? 0.7 : 1 }]} onPress={submit} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={qr.saveBtnTxt}>등록하기</Text>}
              </Pressable>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const qr = StyleSheet.create({
  overlay:  { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  sheet:    { backgroundColor: C.card, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 24, gap: 14, maxHeight: "92%" },
  handle:   { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 4 },
  header:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title:    { fontSize: 20, fontFamily: "Pretendard-SemiBold", color: C.text },
  errorRow: { flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: "#F9DEDA", padding: 10, borderRadius: 10 },
  errorTxt: { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: C.error },
  field:    { gap: 6, marginBottom: 12 },
  label:    { fontSize: 13, fontFamily: "Pretendard-Medium", color: C.textSecondary },
  input:    { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, height: 46, fontSize: 15, fontFamily: "Pretendard-Regular", color: C.text, borderColor: C.border, backgroundColor: C.background },
  weekRow:  { flexDirection: "row", gap: 10 },
  weekBtn:  { flex: 1, paddingVertical: 11, borderRadius: 12, borderWidth: 1.5, alignItems: "center" },
  weekBtnTxt:{ fontSize: 14, fontFamily: "Pretendard-Medium" },
  notice:   { flexDirection: "row", gap: 6, alignItems: "flex-start", backgroundColor: C.tintLight, padding: 12, borderRadius: 12 },
  noticeTxt:{ flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 18 },
  saveBtn:  { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", alignSelf: "stretch" },
  saveBtnTxt:{ color: "#fff", fontSize: 16, fontFamily: "Pretendard-Medium" },
  doneWrap: { alignItems: "center", gap: 14, paddingVertical: 20 },
  doneIcon: { width: 80, height: 80, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  doneTitle:{ fontSize: 20, fontFamily: "Pretendard-SemiBold", color: C.text },
  doneSub:  { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary, textAlign: "center", lineHeight: 20 },
});
