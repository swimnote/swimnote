import { Copy, MessageCircle, Share2, X } from "lucide-react-native";
import * as Clipboard from "expo-clipboard";
import React from "react";
import {
  Alert, Linking, Modal, Platform, Pressable, Share, StyleSheet, Text, View,
} from "react-native";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { buildInviteMessage, type StudentMember } from "@/utils/studentUtils";
import { useInviteRecordStore } from "@/store/inviteRecordStore";

const C = Colors.light;

interface InviteModalProps {
  student: StudentMember;
  poolName: string;
  onClose: () => void;
}

export function InviteModal({ student, poolName, onClose }: InviteModalProps) {
  const { adminUser, pool } = useAuth();
  const addRecord = useInviteRecordStore(s => s.addRecord);

  const appUrl = "https://swimnote.kr";
  const msg = buildInviteMessage({ poolName, studentName: student.name, inviteCode: student.invite_code || "------", appUrl });

  function makeRecordBase() {
    const role = adminUser?.role === "teacher" ? "teacher" : "operator";
    return {
      operatorId:   pool?.id ?? "op-unknown",
      operatorName: pool?.name ?? "수영장",
      senderName:   adminUser?.name ?? "관리자",
      senderRole:   role as "operator" | "teacher",
      targetType:   "guardian" as const,
      targetName:   student.parent_name ?? "학부모",
      targetPhone:  student.parent_phone ?? "",
      studentName:  student.name,
      messageBody:  msg,
    };
  }

  async function openSms() {
    addRecord({ ...makeRecordBase() });
    const phone = student.parent_phone ?? "";
    const smsUrl = Platform.OS === "ios"
      ? `sms:${phone}&body=${encodeURIComponent(msg)}`
      : `sms:${phone}?body=${encodeURIComponent(msg)}`;
    const can = await Linking.canOpenURL(smsUrl);
    if (can) { await Linking.openURL(smsUrl); } else { await Share.share({ message: msg }); }
  }

  async function copyMessage() {
    addRecord({ ...makeRecordBase() });
    await Clipboard.setStringAsync(msg);
    Alert.alert("복사 완료", "초대 문자가 클립보드에 복사되었습니다.");
  }

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <View style={inv.overlay}>
        <View style={inv.sheet}>
          <View style={inv.header}>
            <Text style={inv.title}>학부모 초대 문자</Text>
            <Pressable onPress={onClose}><X size={20} color={C.textSecondary} /></Pressable>
          </View>
          <View style={inv.codeRow}>
            <Text style={inv.codeLabel}>초대코드</Text>
            <Text style={inv.code}>{student.invite_code || "없음"}</Text>
          </View>
          <View style={inv.msgBox}>
            <Text style={inv.msgText}>{msg}</Text>
          </View>
          <Pressable style={[inv.smsBtn, { backgroundColor: C.tint }]} onPress={openSms}>
            <MessageCircle size={15} color="#fff" />
            <Text style={inv.smsBtnTxt}>문자 앱으로 발송</Text>
          </Pressable>
          <View style={inv.btnRow}>
            <Pressable style={[inv.btn, { backgroundColor: C.tintLight }]} onPress={copyMessage}>
              <Copy size={14} color={C.tint} />
              <Text style={[inv.btnText, { color: C.tint }]}>복사하기</Text>
            </Pressable>
            <Pressable style={[inv.btn, { backgroundColor: "#E6FFFA" }]} onPress={() => Share.share({ message: msg })}>
              <Share2 size={14} color="#2EC4B6" />
              <Text style={[inv.btnText, { color: "#2EC4B6" }]}>공유하기</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const inv = StyleSheet.create({
  overlay:  { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 20 },
  sheet:    { backgroundColor: C.card, borderRadius: 20, padding: 20, gap: 14 },
  header:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title:    { fontSize: 16, fontFamily: "Pretendard-Bold", color: C.text },
  codeRow:  { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.tintLight, padding: 12, borderRadius: 12 },
  codeLabel:{ fontSize: 12, fontFamily: "Pretendard-Medium", color: C.textSecondary },
  code:     { fontSize: 18, fontFamily: "Pretendard-Bold", color: C.tint, letterSpacing: 3 },
  msgBox:   { backgroundColor: C.background, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border },
  msgText:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text, lineHeight: 20 },
  smsBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 13, borderRadius: 12 },
  smsBtnTxt: { fontSize: 14, fontFamily: "Pretendard-Bold", color: "#fff" },
  btnRow:  { flexDirection: "row", gap: 10 },
  btn:     { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11, borderRadius: 12 },
  btnText: { fontSize: 13, fontFamily: "Pretendard-SemiBold" },
});
