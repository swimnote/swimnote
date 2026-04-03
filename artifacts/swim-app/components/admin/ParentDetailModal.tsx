/**
 * ParentDetailModal — 학부모 상세 조회 (읽기 전용)
 * 승인은 ParentApproveModal에서 처리
 */
import { Info, MessageSquare, Phone, RefreshCw, UserX, X } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { callPhone, sendSms, formatPhone, isValidPhone, CALL_COLOR, SMS_COLOR } from "@/utils/phoneUtils";
import type { ParentJoinRequest, JoinStatus, MatchStatus } from "@/store/parentJoinStore";

const C = Colors.light;

const MATCH_CFG: Record<MatchStatus, { label: string; color: string; bg: string; icon: string }> = {
  full_match:  { label: "자동 일치",  color: "#2EC4B6", bg: "#E6FFFA", icon: "zap"         },
  phone_only:  { label: "번호만 일치", color: "#D97706", bg: "#FFF1BF", icon: "phone"       },
  no_match:    { label: "미일치",     color: "#64748B", bg: "#F8FAFC", icon: "alert-circle" },
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
    <View style={pd.infoRow}>
      <Text style={pd.infoLabel}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Pressable
          style={{ flexDirection: "row", alignItems: "center", gap: 5 }}
          onPress={() => callPhone(phone)}
          disabled={!valid}
          hitSlop={6}
        >
          <Phone size={13} color={valid ? CALL_COLOR : C.textMuted} />
          <Text style={[pd.infoValue, valid ? { color: CALL_COLOR } : {}]}>
            {phone ? formatPhone(phone) : "미입력"}
          </Text>
        </Pressable>
        {valid && (
          <Pressable onPress={() => sendSms(phone)} hitSlop={8}>
            <MessageSquare size={13} color={SMS_COLOR} />
          </Pressable>
        )}
      </View>
    </View>
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
  const isPending  = req.status === "pending" || req.status === "on_hold";
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
              <X size={20} color={C.textSecondary} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={[pd.matchBadge, { backgroundColor: mc.bg }]}>
              <LucideIcon name={mc.icon as any} size={13} color={mc.color} />
              <Text style={[pd.matchTxt, { color: mc.color }]}>{mc.label}</Text>
              {req.status === "auto_approved" && (
                <View style={pd.autoChip}><Text style={pd.autoChipTxt}>자동승인</Text></View>
              )}
            </View>

            <View style={pd.section}>
              <Text style={pd.sTitle}>학부모 정보</Text>
              <PDRow      label="이름"   value={req.parentName} />
              <PDPhoneRow label="연락처" phone={req.parentPhone} />
              <PDRow      label="신청일" value={new Date(req.createdAt).toLocaleDateString("ko-KR")} />
              {req.reviewedAt   && <PDRow label="처리일"   value={new Date(req.reviewedAt).toLocaleDateString("ko-KR")} />}
              {req.rejectReason && <PDRow label="거절 사유" value={req.rejectReason} />}
            </View>

            <View style={pd.section}>
              <Text style={pd.sTitle}>신청 자녀 정보 ({req.children.length}명)</Text>
              {req.children.map((c, i) => (
                <View key={i} style={pd.childRow}>
                  <View style={[pd.childNum, { backgroundColor: C.tintLight }]}>
                    <Text style={[pd.childNumTxt, { color: C.tint }]}>{i + 1}</Text>
                  </View>
                  <View>
                    <Text style={pd.childName}>{c.name || "이름 미입력"}</Text>
                    {!!c.birthDate && <Text style={pd.childBirth}>{c.birthDate}년생</Text>}
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>

          <View style={pd.actions}>
            {isPending && (
              <View style={pd.btnRow}>
                <Pressable style={[pd.btn, pd.btnReject]} onPress={onOpenReject}>
                  <X size={14} color={C.error} />
                  <Text style={[pd.btnTxt, { color: C.error }]}>거절</Text>
                </Pressable>
                <Pressable style={[pd.btn, pd.btnApprove]} onPress={onApprove}>
                  <Text style={[pd.btnTxt, { color: "#fff" }]}>승인하기</Text>
                </Pressable>
              </View>
            )}
            {isApproved && (
              <Pressable style={[pd.btn, pd.btnRevoke, { flex: 1 }]} onPress={onRevoke}>
                <UserX size={14} color="#D96C6C" />
                <Text style={[pd.btnTxt, { color: "#D96C6C" }]}>승인 해제</Text>
              </Pressable>
            )}
            {req.status === "rejected" && (
              <>
                <View style={pd.rejectInfo}>
                  <Info size={13} color="#D96C6C" />
                  <Text style={pd.rejectInfoTxt}>거절 상태입니다. 재승인하면 가입을 허용합니다.</Text>
                </View>
                <Pressable style={[pd.btn, pd.btnApprove, { flex: 1 }]} onPress={onReApprove}>
                  <RefreshCw size={14} color="#fff" />
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
  overlay:       { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  sheet:         { backgroundColor: C.card, borderTopLeftRadius: 26, borderTopRightRadius: 26,
                   padding: 22, gap: 14, maxHeight: "88%" },
  handle:        { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 4 },
  header:        { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  avatar:        { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  avatarTxt:     { fontSize: 18, fontFamily: "Pretendard-Regular" },
  name:          { fontSize: 17, fontFamily: "Pretendard-Regular", color: C.text },
  nameSub:       { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 },
  matchBadge:    { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 12, marginBottom: 8 },
  matchTxt:      { fontSize: 13, fontFamily: "Pretendard-Regular" },
  autoChip:      { backgroundColor: "#E6FAF8", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  autoChipTxt:   { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#2EC4B6" },
  section:       { gap: 8, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border, marginBottom: 12 },
  sTitle:        { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary,
                   textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
  infoRow:       { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  infoLabel:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  infoValue:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text, textAlign: "right", flex: 1 },
  childRow:      { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  childNum:      { width: 24, height: 24, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  childNumTxt:   { fontSize: 11, fontFamily: "Pretendard-Regular" },
  childName:     { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  childBirth:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  actions:       { gap: 8, paddingTop: 4 },
  btnRow:        { flexDirection: "row", gap: 8 },
  btn:           { height: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 14 },
  btnTxt:        { fontSize: 14, fontFamily: "Pretendard-Regular" },
  btnApprove:    { flex: 2, backgroundColor: C.success },
  btnReject:     { flex: 1, backgroundColor: "#F9DEDA", borderWidth: 1, borderColor: C.error },
  btnRevoke:     { backgroundColor: "#F9DEDA", borderWidth: 1, borderColor: "#D96C6C" },
  rejectInfo:    { flexDirection: "row", alignItems: "flex-start", gap: 8,
                   backgroundColor: "#FEF2F2", borderRadius: 10, padding: 12 },
  rejectInfoTxt: { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", color: "#D96C6C", lineHeight: 17 },
});
