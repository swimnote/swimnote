/**
 * 학부모 프로필 수정
 * - 이름, 전화번호, 비밀번호 변경
 * - ParentScreenHeader (홈 버튼 → 학부모 홈)
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { ParentScreenHeader } from "@/components/parent/ParentScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;

export default function ParentProfileScreen() {
  const { token, parentAccount } = useAuth();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState(parentAccount?.name ?? "");
  const [phone, setPhone] = useState("");
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveDone, setSaveDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await apiRequest(token, "/parent/me");
        if (r.ok) { const d = await r.json(); setName(d.name ?? ""); setPhone(d.phone ?? ""); }
      } catch {}
    })();
  }, []);

  async function handleSave() {
    setError("");
    if (!name.trim()) { setError("이름을 입력해주세요"); return; }
    if (newPw && newPw !== newPw2) { setError("새 비밀번호가 일치하지 않습니다"); return; }
    if (newPw && !currentPw) { setError("현재 비밀번호를 입력해주세요"); return; }

    setSaving(true);
    try {
      const body: any = { name: name.trim(), phone: phone.trim() || null };
      if (newPw) { body.current_password = currentPw; body.new_password = newPw; }

      const r = await apiRequest(token, "/parent/me", {
        method: "PUT", body: JSON.stringify(body),
      });
      if (r.ok) {
        setSaveDone(true);
        setCurrentPw(""); setNewPw(""); setNewPw2("");
      } else {
        const d = await r.json().catch(() => ({}));
        setError(d.error || "저장에 실패했습니다");
      }
    } catch { setError("저장 중 오류가 발생했습니다"); }
    finally { setSaving(false); }
  }

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
            <Field label="이름" value={name} onChangeText={setName} placeholder="이름 입력" />
            <Field label="전화번호" value={phone} onChangeText={setPhone} placeholder="010-0000-0000" keyboardType="phone-pad" />
          </View>

          {/* 비밀번호 변경 */}
          <View style={[s.section, { backgroundColor: C.card }]}>
            <Text style={[s.sectionTitle, { color: C.text }]}>비밀번호 변경</Text>
            <Text style={[s.sectionSub, { color: C.textMuted }]}>변경하지 않으려면 비워두세요</Text>
            <Field label="현재 비밀번호" value={currentPw} onChangeText={setCurrentPw} placeholder="현재 비밀번호" secureEntry />
            <Field label="새 비밀번호" value={newPw} onChangeText={setNewPw} placeholder="새 비밀번호 (4자 이상)" secureEntry />
            <Field label="새 비밀번호 확인" value={newPw2} onChangeText={setNewPw2} placeholder="새 비밀번호 재입력" secureEntry />
          </View>

          {error ? (
            <View style={[s.errorBox, { backgroundColor: "#F9DEDA" }]}>
              <Feather name="alert-circle" size={14} color="#D96C6C" />
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
        </ScrollView>
      </KeyboardAvoidingView>

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
  sectionTitle: { fontSize: 15, fontFamily: "Pretendard-Bold" },
  sectionSub: { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: -6 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, padding: 12 },
  errorTxt: { fontSize: 13, fontFamily: "Pretendard-Medium", color: "#D96C6C", flex: 1 },
  saveBtn: { borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  saveBtnTxt: { fontSize: 16, fontFamily: "Pretendard-SemiBold", color: "#fff" },
});

const f = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Pretendard-Medium" },
  input: {
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11,
    fontSize: 14, fontFamily: "Pretendard-Regular",
  },
  note: { fontSize: 11, fontFamily: "Pretendard-Regular" },
});
