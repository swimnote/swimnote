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
const KAKAO_YELLOW = "#FEE500";
const KAKAO_TEXT   = "#191919";

interface InviteModalProps {
  student: StudentMember;
  poolName: string;
  onClose: () => void;
}

export function InviteModal({ student, poolName, onClose }: InviteModalProps) {
  const { adminUser, pool } = useAuth();
  const addRecord = useInviteRecordStore(s => s.addRecord);

  const appUrl = "https://swimnote.kr";
  const msg = buildInviteMessage({ poolName, studentName: student.name, appUrl });

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

  async function openKakao() {
    addRecord({ ...makeRecordBase() });
    await Clipboard.setStringAsync(msg);
    const kakaoScheme = "kakaotalk://";
    const canOpen = await Linking.canOpenURL(kakaoScheme);
    if (canOpen) {
      Alert.alert(
        "카카오톡 열기",
        "메시지가 복사되었습니다.\n카카오톡 채팅창에서 붙여넣기 해주세요.",
        [
          { text: "취소", style: "cancel" },
          { text: "카카오톡 열기", onPress: () => Linking.openURL(kakaoScheme) },
        ]
      );
    } else {
      await Share.share({ message: msg });
    }
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
    Alert.alert("복사 완료", "초대 메시지가 클립보드에 복사되었습니다.");
  }

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <View style={inv.overlay}>
        <View style={inv.sheet}>
          <View style={inv.header}>
            <Text style={inv.title}>학부모 앱 초대</Text>
            <Pressable onPress={onClose}><X size={20} color={C.textSecondary} /></Pressable>
          </View>

          {/* 학생 정보 */}
          <View style={inv.studentRow}>
            <Text style={inv.studentLabel}>학생</Text>
            <Text style={inv.studentName}>{student.name}</Text>
            {student.parent_phone ? (
              <>
                <Text style={[inv.studentLabel, { marginLeft: 12 }]}>연락처</Text>
                <Text style={inv.studentName}>{student.parent_phone}</Text>
              </>
            ) : null}
          </View>

          {/* 초대 메시지 미리보기 */}
          <View style={inv.msgBox}>
            <Text style={inv.msgText}>{msg}</Text>
          </View>

          {/* 카카오톡 초대 버튼 (주 버튼) */}
          <Pressable style={[inv.kakaoBtn]} onPress={openKakao}>
            <Text style={inv.kakaoBtnIcon}>💬</Text>
            <Text style={inv.kakaoBtnTxt}>카카오톡으로 초대하기</Text>
          </Pressable>

          {/* 문자 / 복사 / 공유 */}
          <View style={inv.btnRow}>
            <Pressable style={[inv.btn, { backgroundColor: C.tintLight }]} onPress={openSms}>
              <MessageCircle size={14} color={C.tint} />
              <Text style={[inv.btnText, { color: C.tint }]}>문자</Text>
            </Pressable>
            <Pressable style={[inv.btn, { backgroundColor: "#F3F4F6" }]} onPress={copyMessage}>
              <Copy size={14} color={C.textSecondary} />
              <Text style={[inv.btnText, { color: C.textSecondary }]}>복사</Text>
            </Pressable>
            <Pressable style={[inv.btn, { backgroundColor: "#F3F4F6" }]} onPress={() => { addRecord({ ...makeRecordBase() }); Share.share({ message: msg }); }}>
              <Share2 size={14} color={C.textSecondary} />
              <Text style={[inv.btnText, { color: C.textSecondary }]}>공유</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const inv = StyleSheet.create({
  overlay:     { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 20 },
  sheet:       { backgroundColor: C.card, borderRadius: 20, padding: 20, gap: 14 },
  header:      { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title:       { fontSize: 16, fontFamily: "Pretendard-Regular", color: C.text },
  studentRow:  { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.tintLight, padding: 12, borderRadius: 12, flexWrap: "wrap" },
  studentLabel:{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  studentName: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  msgBox:      { backgroundColor: C.background, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border },
  msgText:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text, lineHeight: 20 },
  kakaoBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 12, backgroundColor: KAKAO_YELLOW },
  kakaoBtnIcon:{ fontSize: 16 },
  kakaoBtnTxt: { fontSize: 15, fontFamily: "Pretendard-Regular", color: KAKAO_TEXT },
  btnRow:      { flexDirection: "row", gap: 8 },
  btn:         { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 11, borderRadius: 12 },
  btnText:     { fontSize: 13, fontFamily: "Pretendard-Regular" },
});
