/**
 * ParentApproveModal
 * 학부모 승인 시 학생 정보 확인 팝업
 * - 학부모가 입력한 자녀 이름/생년 자동 기입
 * - 관리자가 수정 가능
 * - 확인 후 승인 → 일치 학생 있으면 연결, 없으면 신규 생성
 */
import { Check, X, User, Calendar } from "lucide-react-native";
import React, { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform,
  Pressable, StyleSheet, Text, TextInput, View,
} from "react-native";
import Colors from "@/constants/colors";
import type { ParentJoinRequest } from "@/store/parentJoinStore";

const C = Colors.light;

interface ParentApproveModalProps {
  req: ParentJoinRequest;
  loading: boolean;
  onClose: () => void;
  onConfirm: (childName: string, birthYear: string) => void;
}

export function ParentApproveModal({ req, loading, onClose, onConfirm }: ParentApproveModalProps) {
  const firstChild = req.children[0];
  const [childName,  setChildName]  = useState(firstChild?.name      ?? "");
  const [birthYear,  setBirthYear]  = useState(firstChild?.birthDate  ?? "");
  const [nameError,  setNameError]  = useState("");

  function handleConfirm() {
    if (!childName.trim()) { setNameError("학생 이름을 입력해주세요."); return; }
    setNameError("");
    onConfirm(childName.trim(), birthYear.trim());
  }

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={m.overlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={m.card}>
          {/* 헤더 */}
          <View style={m.header}>
            <View>
              <Text style={m.title}>학생 정보 확인</Text>
              <Text style={m.subtitle}>{req.parentName} 학부모 가입 승인</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} disabled={loading}>
              <X size={20} color={C.textSecondary} />
            </Pressable>
          </View>

          {/* 안내 */}
          <View style={m.infoBox}>
            <Text style={m.infoTxt}>
              학생 명부에 이름이 일치하는 학생이 있으면 자동 연결됩니다.{"\n"}
              명부에 없으면 신규 학생으로 등록됩니다.
            </Text>
          </View>

          {/* 학생 이름 */}
          <View style={m.field}>
            <Text style={m.label}>학생 이름 *</Text>
            <View style={[m.inputBox, !!nameError && { borderColor: C.error }]}>
              <User size={15} color={C.textMuted} />
              <TextInput
                style={m.input}
                value={childName}
                onChangeText={v => { setChildName(v); setNameError(""); }}
                placeholder="학생 이름 입력"
                placeholderTextColor={C.textMuted}
                autoCapitalize="none"
                autoFocus
              />
            </View>
            {!!nameError && <Text style={m.errorTxt}>{nameError}</Text>}
          </View>

          {/* 생년 */}
          <View style={m.field}>
            <Text style={m.label}>출생년도 (선택)</Text>
            <View style={m.inputBox}>
              <Calendar size={15} color={C.textMuted} />
              <TextInput
                style={m.input}
                value={birthYear}
                onChangeText={setBirthYear}
                placeholder="예: 2016"
                placeholderTextColor={C.textMuted}
                keyboardType="number-pad"
                maxLength={4}
              />
            </View>
          </View>

          {/* 버튼 */}
          <View style={m.btnRow}>
            <Pressable style={m.btnCancel} onPress={onClose} disabled={loading}>
              <Text style={m.btnCancelTxt}>취소</Text>
            </Pressable>
            <Pressable
              style={[m.btnConfirm, loading && { opacity: 0.6 }]}
              onPress={handleConfirm}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator size="small" color="#fff" />
                : <><Check size={15} color="#fff" /><Text style={m.btnConfirmTxt}>승인 완료</Text></>
              }
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const m = StyleSheet.create({
  overlay:       { flex: 1, justifyContent: "center", alignItems: "center",
                   backgroundColor: "rgba(0,0,0,0.45)", paddingHorizontal: 24 },
  card:          { width: "100%", backgroundColor: C.card, borderRadius: 22,
                   padding: 22, gap: 16, maxWidth: 400 },
  header:        { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  title:         { fontSize: 17, fontFamily: "Pretendard-Regular", color: C.text },
  subtitle:      { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 },
  infoBox:       { backgroundColor: "#EFF6FF", borderRadius: 12, padding: 12 },
  infoTxt:       { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#1D4ED8", lineHeight: 18 },
  field:         { gap: 6 },
  label:         { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  inputBox:      { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5,
                   borderColor: C.border, borderRadius: 12, paddingHorizontal: 12, height: 46,
                   backgroundColor: C.background },
  input:         { flex: 1, fontSize: 15, fontFamily: "Pretendard-Regular", color: C.text },
  errorTxt:      { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.error },
  btnRow:        { flexDirection: "row", gap: 10, marginTop: 4 },
  btnCancel:     { flex: 1, height: 48, borderRadius: 13, borderWidth: 1.5, borderColor: C.border,
                   alignItems: "center", justifyContent: "center" },
  btnCancelTxt:  { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  btnConfirm:    { flex: 2, height: 48, borderRadius: 13, backgroundColor: C.success,
                   flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  btnConfirmTxt: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
});
