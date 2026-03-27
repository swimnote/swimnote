import { Check, Phone, Repeat, UserMinus, X } from "lucide-react-native";
import React from "react";
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import Colors from "@/constants/colors";
import { callPhone, formatPhone, isValidPhone, CALL_COLOR } from "@/utils/phoneUtils";

const C = Colors.light;

interface TeacherDetail {
  id: string;
  name: string;
  phone: string;
  position: string | null;
  invite_status: string;
  approved_at: string | null;
  user_email: string | null;
  user_id: string | null;
  user_roles: string[];
  is_activated: boolean;
  class_count: number;
  member_count: number;
}

interface TeacherDetailModalProps {
  detail: TeacherDetail | null;
  processing: boolean;
  onClose: () => void;
  onApprove?: () => void;
  onRejectOpen?: () => void;
  onRevoke?: () => void;
  onTransfer?: () => void;
}

function parseRoles(roles: any): string[] {
  if (Array.isArray(roles)) return roles;
  if (typeof roles === "string" && roles.startsWith("{")) {
    return roles.slice(1, -1).split(",").map(r => r.replace(/^"|"$/g, "").trim()).filter(Boolean);
  }
  return [];
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={dm.infoRow}>
      <Text style={dm.infoLabel}>{label}</Text>
      <Text style={dm.infoValue}>{value}</Text>
    </View>
  );
}

function PhoneRow({ label, phone }: { label: string; phone: string | null | undefined }) {
  const valid = isValidPhone(phone);
  return (
    <Pressable
      style={dm.infoRow}
      onPress={() => callPhone(phone)}
      disabled={!valid}
      hitSlop={6}
    >
      <Text style={dm.infoLabel}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <Phone size={13} color={valid ? CALL_COLOR : C.textMuted} />
        <Text style={[dm.infoValue, valid ? { color: CALL_COLOR } : { color: C.textSecondary }]}>
          {phone ? formatPhone(phone) : "미입력"}
        </Text>
      </View>
    </Pressable>
  );
}

export function TeacherDetailModal({
  detail, processing, onClose, onApprove, onRejectOpen, onRevoke, onTransfer,
}: TeacherDetailModalProps) {
  if (!detail) return null;

  const isPending  = detail.invite_status === "joinedPendingApproval";
  const isApproved = detail.invite_status === "approved";
  const roles: string[] = parseRoles(detail.user_roles);
  const isAdminGranted = roles.includes("pool_admin");

  const roleLabel = isAdminGranted ? "선생님 + 관리자권한" : "선생님";

  const statusLabel: Record<string, string> = {
    joinedPendingApproval: "승인 대기",
    approved:  "승인됨",
    rejected:  "거절됨",
    inactive:  "비활성",
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={dm.overlay}>
        <View style={dm.sheet}>
          <View style={dm.handle} />
          <View style={dm.header}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={[dm.headerAvatar, { backgroundColor: "#E6FFFA" }]}>
                <Text style={[dm.headerAvatarText, { color: "#2EC4B6" }]}>{detail.name[0]}</Text>
              </View>
              <View>
                <Text style={dm.headerName}>{detail.name}</Text>
                <Text style={dm.headerSub}>{statusLabel[detail.invite_status] ?? detail.invite_status}</Text>
              </View>
            </View>
            <Pressable onPress={onClose} style={{ padding: 4 }}>
              <X size={20} color={C.textSecondary} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>
            <View style={dm.section}>
              <Text style={dm.sectionTitle}>기본 정보</Text>
              <InfoRow label="이름"   value={detail.name} />
              <PhoneRow label="연락처" phone={detail.phone} />
              {detail.user_email  ? <InfoRow label="이메일" value={detail.user_email} />  : null}
              {detail.position    ? <InfoRow label="직위"   value={detail.position} />    : null}
              {detail.approved_at ? <InfoRow label="승인일" value={new Date(detail.approved_at).toLocaleDateString("ko-KR")} /> : null}
            </View>

            <View style={dm.section}>
              <Text style={dm.sectionTitle}>역할 및 담당</Text>
              <InfoRow label="현재 역할" value={roleLabel} />
              <InfoRow label="담당 반"   value={`${detail.class_count ?? 0}개`} />
              <InfoRow label="담당 회원" value={`${detail.member_count ?? 0}명`} />
            </View>
          </ScrollView>

          <View style={dm.actionArea}>
            {isPending && (
              <>
                {onRejectOpen && (
                  <Pressable style={[dm.actionBtn, { borderWidth: 1.5, borderColor: C.error, backgroundColor: "#fff" }]} onPress={onRejectOpen} disabled={processing}>
                    {processing ? <ActivityIndicator color={C.error} size="small" /> : (
                      <>
                        <X size={14} color={C.error} />
                        <Text style={[dm.actionBtnText, { color: C.error }]}>거절</Text>
                      </>
                    )}
                  </Pressable>
                )}
                {onApprove && (
                  <Pressable style={[dm.actionBtn, { backgroundColor: C.success }]} onPress={onApprove} disabled={processing}>
                    {processing ? <ActivityIndicator color="#fff" size="small" /> : (
                      <>
                        <Check size={14} color="#fff" />
                        <Text style={[dm.actionBtnText, { color: "#fff" }]}>승인</Text>
                      </>
                    )}
                  </Pressable>
                )}
              </>
            )}

            {isApproved && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={dm.approvedActions}>
                {onRevoke && (
                  <Pressable style={[dm.smBtn, { borderWidth: 1.5, borderColor: "#D96C6C", backgroundColor: "#FEF2F2" }]} onPress={onRevoke} disabled={processing}>
                    {processing ? <ActivityIndicator color="#D96C6C" size="small" /> : (
                      <>
                        <UserMinus size={13} color="#D96C6C" />
                        <Text style={[dm.smBtnText, { color: "#D96C6C" }]}>승인 해제</Text>
                      </>
                    )}
                  </Pressable>
                )}
                {onTransfer && (
                  <Pressable style={[dm.smBtn, { backgroundColor: C.tint }]} onPress={onTransfer} disabled={processing}>
                    <Repeat size={13} color="#fff" />
                    <Text style={[dm.smBtnText, { color: "#fff" }]}>수업 인수</Text>
                  </Pressable>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const dm = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 24, gap: 16, maxHeight: "85%" },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 4 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerAvatar: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  headerAvatarText: { fontSize: 18, fontFamily: "Pretendard-Bold" },
  headerName: { fontSize: 17, fontFamily: "Pretendard-Bold", color: C.text },
  headerSub: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 4 },
  infoLabel: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  infoValue: { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: C.text, textAlign: "right", flex: 1 },
  section: { gap: 8, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border, marginBottom: 14 },
  sectionTitle: { fontSize: 12, fontFamily: "Pretendard-SemiBold", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
  actionArea: { paddingTop: 8 },
  actionBtn: { flex: 1, height: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14 },
  actionBtnText: { fontSize: 15, fontFamily: "Pretendard-SemiBold" },
  approvedActions: { flexDirection: "row", gap: 10, paddingBottom: 4 },
  smBtn: { height: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 12, paddingHorizontal: 16 },
  smBtnText: { fontSize: 13, fontFamily: "Pretendard-SemiBold" },
});
