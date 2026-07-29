import React, { useRef, useState } from "react";
import { LucideIcon } from "@/components/common/LucideIcon";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import Colors from "@/constants/colors";
import { apiRequest } from "@/context/AuthContext";
import {
  WEEKLY_BADGE, WeeklyCount, StudentMember,
  isValidBirthYear, isValidPhone, normalizePhone,
} from "@/utils/studentUtils";
import { InviteModal } from "./InviteModal";
import { DuplicateModal } from "./DuplicateModal";

const C = Colors.light;

interface RegisterModalProps {
  token: string | null;
  poolName: string;
  onSuccess: (student: StudentMember) => void;
  onClose: () => void;
  initialParentPhone?: string;
  initialParentName?: string;
}

export function RegisterModal({ token, poolName, onSuccess, onClose, initialParentPhone, initialParentName }: RegisterModalProps) {
  const [names,       setNames]       = useState(["", "", ""]);
  const [birthYear,   setBirthYear]   = useState("");
  const [parentName,  setParentName]  = useState(initialParentName || "");
  const [parentPhone, setParentPhone] = useState(initialParentPhone || "");
  const [weekly,      setWeekly]      = useState<WeeklyCount>(1);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState("");
  const [dupCandidates, setDupCandidates] = useState<any[] | null>(null);
  const [showInvite,  setShowInvite]  = useState<StudentMember | null>(null);
  const pendingBody = useRef<any>(null);

  function updateName(i: number, v: string) {
    setNames(prev => { const n = [...prev]; n[i] = v; return n; });
  }

  function validate(): string | null {
    const validNames = names.map(n => n.trim()).filter(Boolean);
    if (validNames.length === 0) return "학생 이름을 한 명 이상 입력해주세요.";
    if (birthYear && !isValidBirthYear(birthYear)) return "출생년도가 올바르지 않습니다. (예: 2015)";
    if (parentPhone && !isValidPhone(parentPhone)) return "학부모 전화번호 형식이 올바르지 않습니다.";
    return null;
  }

  async function submit(forceCreate = false) {
    const e = validate();
    if (e) { setError(e); return; }
    setSaving(true); setError("");

    const validNames = names.map(n => n.trim()).filter(Boolean);
    const commonFields = {
      birth_year: birthYear || undefined,
      parent_name: parentName || undefined,
      parent_phone: parentPhone ? normalizePhone(parentPhone) : undefined,
      weekly_count: weekly,
      registration_path: "admin_created",
      force_create: forceCreate,
    };

    let firstSuccess: StudentMember | null = null;
    let dupFound: any[] | null = null;

    try {
      for (const name of validNames) {
        const body = { name, ...commonFields };
        pendingBody.current = body;
        const res = await apiRequest(token, "/students", { method: "POST", body: JSON.stringify(body) });
        const data = await res.json();

        if (res.status === 409 && data.duplicate) {
          dupFound = [data.existing];
          break;
        }
        if (res.status === 200 && data.possible_duplicate) {
          dupFound = data.candidates;
          break;
        }
        if (!res.ok) {
          setError(data.message || "오류가 발생했습니다.");
          setSaving(false);
          return;
        }
        if (!firstSuccess) firstSuccess = data;
      }
    } catch {
      setError("네트워크 오류가 발생했습니다.");
      setSaving(false);
      return;
    }

    setSaving(false);

    if (dupFound) {
      setDupCandidates(dupFound);
      return;
    }
    if (firstSuccess) {
      setShowInvite(firstSuccess);
      onSuccess(firstSuccess);
    }
  }

  if (showInvite) {
    return <InviteModal student={showInvite} poolName={poolName} onClose={() => { setShowInvite(null); onClose(); }} />;
  }
  if (dupCandidates) {
    return (
      <DuplicateModal
        candidates={dupCandidates}
        onLinkExisting={() => { setDupCandidates(null); Alert.alert("알림", "기존 회원 연결 기능은 곧 제공됩니다."); }}
        onForceCreate={() => { setDupCandidates(null); submit(true); }}
        onCancel={() => setDupCandidates(null)}
      />
    );
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={reg.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={reg.sheet}>
            <View style={reg.handle} />
            <View style={reg.header}>
              <Text style={reg.title}>어린이 직접 등록</Text>
              <Pressable onPress={onClose}><LucideIcon name="x" size={22} color={C.textSecondary} /></Pressable>
            </View>
            {error ? (
              <View style={reg.errorRow}>
                <LucideIcon name="alert-circle" size={14} color={C.error} />
                <Text style={reg.errorText}>{error}</Text>
              </View>
            ) : null}
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              bounces={false}
            >
              {/* 자녀 이름 슬롯 3개 */}
              {names.map((name, i) => (
                <View key={i} style={reg.field}>
                  <Text style={reg.label}>
                    학생 이름 {i + 1}{i === 0 ? " *" : " (선택)"}
                  </Text>
                  <TextInput
                    style={reg.input}
                    value={name}
                    onChangeText={v => updateName(i, v)}
                    placeholder={i === 0 ? "홍길동" : "형제 이름 입력 (선택)"}
                    placeholderTextColor={C.textMuted}
                    returnKeyType={i < 2 ? "next" : "done"}
                  />
                </View>
              ))}

              <View style={reg.field}>
                <Text style={reg.label}>출생년도 (중복 체크에 사용)</Text>
                <TextInput
                  style={reg.input}
                  value={birthYear}
                  onChangeText={setBirthYear}
                  placeholder="예: 2015"
                  placeholderTextColor={C.textMuted}
                  keyboardType="number-pad"
                  maxLength={4}
                  returnKeyType="next"
                />
              </View>
              <View style={reg.field}>
                <Text style={reg.label}>학부모 이름</Text>
                <TextInput
                  style={reg.input}
                  value={parentName}
                  onChangeText={setParentName}
                  placeholder="김보호 (선택)"
                  placeholderTextColor={C.textMuted}
                  returnKeyType="next"
                />
              </View>
              <View style={reg.field}>
                <Text style={reg.label}>학부모 전화번호 (초대 문자 발송용)</Text>
                <TextInput
                  style={reg.input}
                  value={parentPhone}
                  onChangeText={setParentPhone}
                  placeholder="010-1234-5678"
                  placeholderTextColor={C.textMuted}
                  keyboardType="phone-pad"
                  returnKeyType="done"
                />
              </View>
              <View style={reg.field}>
                <Text style={reg.label}>주 수업 횟수</Text>
                <View style={reg.weekRow}>
                  {([1, 2, 3] as WeeklyCount[]).map(w => {
                    const badge = WEEKLY_BADGE[w];
                    return (
                      <Pressable
                        key={w}
                        style={[reg.weekBtn, { backgroundColor: weekly === w ? badge.bg : C.background, borderColor: weekly === w ? badge.color : C.border }]}
                        onPress={() => setWeekly(w)}
                      >
                        <Text style={[reg.weekBtnText, { color: weekly === w ? badge.color : C.textSecondary }]}>{badge.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <View style={reg.notice}>
                <LucideIcon name="info" size={13} color={C.textMuted} />
                <Text style={reg.noticeText}>등록 후 초대코드가 생성됩니다. 학부모에게 전달하여 앱 연결을 유도할 수 있습니다.</Text>
              </View>
              <Pressable style={[reg.saveBtn, { backgroundColor: C.tint }]} onPress={() => submit(false)} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={reg.saveBtnText}>등록하기</Text>}
              </Pressable>
              <View style={{ height: 16 }} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const reg = StyleSheet.create({
  backdrop:    { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet:       { backgroundColor: C.card, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 24, paddingBottom: 32, maxHeight: "85%" },
  handle:      { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 4 },
  header:      { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  title:       { fontSize: 20, fontFamily: "Pretendard-Regular", color: C.text },
  errorRow:    { flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: "#F9DEDA", padding: 10, borderRadius: 10, marginBottom: 10 },
  errorText:   { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: C.error },
  field:       { gap: 6, marginBottom: 12 },
  label:       { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  input:       { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, height: 46, fontSize: 15, fontFamily: "Pretendard-Regular", color: C.text, borderColor: C.border, backgroundColor: C.background },
  weekRow:     { flexDirection: "row", gap: 10 },
  weekBtn:     { flex: 1, paddingVertical: 11, borderRadius: 12, borderWidth: 1.5, alignItems: "center" },
  weekBtnText: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  notice:      { flexDirection: "row", gap: 6, alignItems: "flex-start", backgroundColor: C.tintLight, padding: 12, borderRadius: 12, marginBottom: 14 },
  noticeText:  { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 18 },
  saveBtn:     { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  saveBtnText: { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" },
});
