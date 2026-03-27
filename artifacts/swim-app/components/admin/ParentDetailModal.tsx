import { Feather } from "@expo/vector-icons";
import React from "react";
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import Colors from "@/constants/colors";
import { callPhone, formatPhone, isValidPhone, CALL_COLOR } from "@/utils/phoneUtils";
import type { ParentJoinRequest, JoinStatus, MatchStatus } from "@/store/parentJoinStore";

const C = Colors.light;

const MATCH_CFG: Record<MatchStatus, { label: string; color: string; bg: string; icon: string }> = {
  full_match:  { label: "자동 일치",  color: "#2EC4B6", bg: "#E6FFFA", icon: "zap"          },
  phone_only:  { label: "번호만 일치", color: "#D97706", bg: "#FFF1BF", icon: "phone"        },
  no_match:    { label: "미일치",     color: "#6B7280", bg: "#F8FAFC", icon: "alert-circle"  },
};

const JOIN_STATUS_CFG: Record<JoinStatus, { label: string }> = {
  auto_approved: { label: "자동 승인" },
  approved:      { label: "승인됨"   },
  pending:       { label: "대기 중"  },
  on_hold:       { label: "보류"     },
  rejected:      { label: "거절됨"   },
};

function PDRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={pd.infoRow}>
      <Text style={pd.infoLabel}>{label}</Text>
      <Text style={pd.infoValue}>{value}</Text>
    </View>
  );
}

function PDPhoneRow({ label, phone }: { label: string; phone: string | null | undefined }) {
  const valid = isValidPhone(phone);
  return (
    <Pressable
      style={pd.infoRow}
      onPress={() => callPhone(phone)}
      disabled={!valid}
      hitSlop={6}
    >
      <Text style={pd.infoLabel}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <Feather name="phone" size={13} color={valid ? CALL_COLOR : C.textMuted} />
        <Text style={[pd.infoValue, valid ? { color: CALL_COLOR } : {}]}>
          {phone ? formatPhone(phone) : "미입력"}
        </Text>
      </View>
    </Pressable>
  );
}

interface ParentDetailModalProps {
  req: ParentJoinRequest;
  onClose: () => void;
  onApprove: () => void;
  onHold: () => void;
  onOpenReject: () => void;
  onRevoke: () => void;
  onReApprove: () => void;
}

export function ParentDetailModal({
  req, onClose, onApprove, onHold, onOpenReject, onRevoke, onReApprove,
}: ParentDetailModalProps) {
  const isPending  = req.status === "pending";
  const isOnHold   = req.status === "on_hold";
  const isApproved = req.status === "approved" || req.status === "auto_approved";
  const mc = MATCH_CFG[req.matchStatus];

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={pd.overlay}>
        <View style={pd.sheet}>
          <View style={pd.handle} />
          <View style={pd.header}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={[pd.avatar, { backgroundColor: C.tintLight }]}>
                <Text style={[pd.avatarTxt, { color: C.tint }]}>{req.parentName[0]}</Text>
              </View>
              <View>
                <Text style={pd.name}>{req.parentName}</Text>
                <Text style={pd.nameSub}>{JOIN_STATUS_CFG[req.status].label}</Text>
              </View>
            </View>
            <Pressable onPress={onClose} style={{ padding: 4 }}>
              <Feather name="x" size={20} color={C.textSecondary} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={[pd.matchBadge, { backgroundColor: mc.bg }]}>
              <Feather name={mc.icon as any} size={13} color={mc.color} />
              <Text style={[pd.matchTxt, { color: mc.color }]}>{mc.label}</Text>
              {req.matchedStudentIds.length > 0 && (
                <Text style={[pd.matchSub, { color: mc.color }]}>· {req.matchedStudentIds.length}명 연결</Text>
              )}
            </View>

            <View style={pd.section}>
              <Text style={pd.sTitle}>보호자 정보</Text>
              <PDRow label="이름"   value={req.parentName} />
              <PDPhoneRow label="연락처" phone={req.parentPhone} />
              <PDRow label="관계"   value={req.relation} />
              <PDRow label="호칭"   value={req.displayName} />
              <PDRow label="수영장" value={req.operatorName} />
              <PDRow label="신청일" value={new Date(req.createdAt).toLocaleDateString("ko-KR")} />
              {req.reviewedAt  && <PDRow label="처리일" value={new Date(req.reviewedAt).toLocaleDateString("ko-KR")} />}
              {req.reviewedBy  && <PDRow label="처리자" value={req.reviewedBy} />}
              {req.rejectReason && <PDRow label="거절 사유" value={req.rejectReason} />}
            </View>

            <View style={pd.section}>
              <Text style={pd.sTitle}>자녀 정보 ({req.children.length}명)</Text>
              {req.children.map((c, i) => (
                <View key={i} style={pd.childRow}>
                  <View style={[pd.childNum, { backgroundColor: C.tintLight }]}>
                    <Text style={[pd.childNumTxt, { color: C.tint }]}>{i + 1}</Text>
                  </View>
                  <View>
                    <Text style={pd.childName}>{c.name}</Text>
                    <Text style={pd.childBirth}>{c.birthDate}</Text>
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>

          <View style={pd.actions}>
            {(isPending || isOnHold) && (
              <>
                <Pressable style={[pd.btn, { backgroundColor: "#FFF1BF", borderColor: "#D97706", borderWidth: 1 }]} onPress={onHold}>
                  <Feather name="pause" size={14} color="#D97706" />
                  <Text style={[pd.btnTxt, { color: "#D97706" }]}>보류</Text>
                </Pressable>
                <Pressable style={[pd.btn, { backgroundColor: "#F9DEDA", borderColor: C.error, borderWidth: 1 }]} onPress={onOpenReject}>
                  <Feather name="x" size={14} color={C.error} />
                  <Text style={[pd.btnTxt, { color: C.error }]}>거절</Text>
                </Pressable>
                <Pressable style={[pd.btn, { backgroundColor: C.success }]} onPress={onApprove}>
                  <Feather name="check" size={14} color="#fff" />
                  <Text style={[pd.btnTxt, { color: "#fff" }]}>승인</Text>
                </Pressable>
              </>
            )}
            {isApproved && (
              <Pressable style={[pd.btn, { flex: 1, backgroundColor: "#F9DEDA", borderColor: "#D96C6C", borderWidth: 1 }]} onPress={onRevoke}>
                <Feather name="user-x" size={14} color="#D96C6C" />
                <Text style={[pd.btnTxt, { color: "#D96C6C" }]}>승인 해제</Text>
              </Pressable>
            )}
            {req.status === "rejected" && (
              <>
                <View style={pd.rejectInfo}>
                  <Feather name="info" size={13} color="#D96C6C" />
                  <Text style={pd.rejectInfoTxt}>거절 상태입니다. 재승인하면 가입을 허용합니다.</Text>
                </View>
                <Pressable style={[pd.btn, { flex: 1, backgroundColor: C.success }]} onPress={onReApprove}>
                  <Feather name="refresh-cw" size={14} color="#fff" />
                  <Text style={[pd.btnTxt, { color: "#fff" }]}>재승인</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const pd = StyleSheet.create({
  overlay:    { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  sheet:      { backgroundColor: C.card, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 22, gap: 14, maxHeight: "88%" },
  handle:     { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 4 },
  header:     { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  avatar:     { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  avatarTxt:  { fontSize: 18, fontFamily: "Pretendard-Bold" },
  name:       { fontSize: 17, fontFamily: "Pretendard-Bold", color: C.text },
  nameSub:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 },
  matchBadge: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 12 },
  matchTxt:   { fontSize: 13, fontFamily: "Pretendard-SemiBold" },
  matchSub:   { fontSize: 12, fontFamily: "Pretendard-Regular" },
  section:    { gap: 8, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border, marginBottom: 12 },
  sTitle:     { fontSize: 11, fontFamily: "Pretendard-SemiBold", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
  infoRow:    { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  infoLabel:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  infoValue:  { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: C.text, textAlign: "right", flex: 1 },
  childRow:   { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  childNum:   { width: 24, height: 24, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  childNumTxt:{ fontSize: 11, fontFamily: "Pretendard-Bold" },
  childName:  { fontSize: 14, fontFamily: "Pretendard-Medium", color: C.text },
  childBirth: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  actions:       { gap: 10, paddingTop: 8 },
  btn:           { flex: 1, height: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 12 },
  btnTxt:        { fontSize: 14, fontFamily: "Pretendard-SemiBold" },
  rejectInfo:    { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#FEF2F2", borderRadius: 10, padding: 12 },
  rejectInfoTxt: { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", color: "#D96C6C", lineHeight: 17 },
});
