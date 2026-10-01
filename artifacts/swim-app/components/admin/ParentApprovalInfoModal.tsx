import React, { useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { LucideIcon } from "@/components/common/LucideIcon";
import { EditField } from "@/components/admin/member/EditField";
import { MemberSectionCard } from "@/components/admin/member/MemberSectionCard";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { phoneMatches } from "@/lib/parentApprovalUtils";
import type { ParentApprovalConfirmFields, ParentApprovalInfo } from "@/lib/parentApprovalUtils";

const C = Colors.light;

interface Props {
  visible: boolean;
  info: ParentApprovalInfo | null;
  loading: boolean;
  error: string | null;
  processing: boolean;
  onClose: () => void;
  onRetry: () => void;
  onOpenMembers: () => void;
  onConfirm: (fields: ParentApprovalConfirmFields) => void;
}

export function ParentApprovalInfoModal({
  visible, info, loading, error, processing, onClose, onRetry, onOpenMembers, onConfirm,
}: Props) {
  const insets = useSafeAreaInsets();
  const student = info?.student ?? null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={m.overlay}>
        <View style={[m.sheet, { backgroundColor: C.background, paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={m.header}>
            <View style={{ flex: 1 }}>
              <Text style={m.title}>학부모 연결 확인</Text>
              {student ? <Text style={m.subtitle}>{student.name} 학생 정보</Text> : null}
            </View>
            <Pressable testID="parent-approval-close" onPress={onClose} disabled={processing} hitSlop={10}>
              <LucideIcon name="x" size={20} color={C.textMuted} />
            </Pressable>
          </View>

          {loading ? (
            <View style={m.centerState}>
              <ActivityIndicator color={C.brandStrong} />
              <Text style={m.stateText}>학생 정보를 확인하고 있습니다.</Text>
            </View>
          ) : error ? (
            <View style={m.centerState}>
              <LucideIcon name="alert-circle" size={28} color={C.error} />
              <Text style={m.stateText}>{error}</Text>
              <Pressable testID="parent-approval-retry" onPress={onRetry} style={m.secondaryButton}>
                <Text style={m.secondaryButtonText}>다시 불러오기</Text>
              </Pressable>
            </View>
          ) : info && !student ? (
            <View style={m.unresolved}>
              <View style={m.unresolvedIcon}>
                <LucideIcon name="user-x" size={24} color={C.warning} />
              </View>
              <Text style={m.unresolvedTitle}>등록된 학생 정보를 확인할 수 없습니다.</Text>
              <Text style={m.unresolvedText}>
                신규 회원 등록 또는 회원정보 확인이 필요합니다.{info.reason ? `\n${info.reason}` : ""}
              </Text>
              <Pressable testID="parent-approval-open-members" onPress={onOpenMembers} style={m.primaryButton}>
                <Text style={m.primaryButtonText}>회원 관리로 이동</Text>
              </Pressable>
            </View>
          ) : info && student ? (
            <ResolvedApprovalForm
              info={info}
              processing={processing}
              onClose={onClose}
              onConfirm={onConfirm}
            />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function ResolvedApprovalForm({
  info, processing, onClose, onConfirm,
}: {
  info: ParentApprovalInfo;
  processing: boolean;
  onClose: () => void;
  onConfirm: (fields: ParentApprovalConfirmFields) => void;
}) {
  const student = info.student!;
  const [name, setName] = useState(student.name ?? "");
  const [parentName, setParentName] = useState(student.parent_name ?? "");
  const [parentPhone, setParentPhone] = useState(student.parent_phone ?? "");
  const [parentPhone2, setParentPhone2] = useState(student.parent_phone2 ?? "");
  const [parentPhone3, setParentPhone3] = useState(student.parent_phone3 ?? "");
  const [parentPhone4, setParentPhone4] = useState(student.parent_phone4 ?? "");
  const phoneSlots = [
    { label: "보호자 연락처 1", value: parentPhone },
    { label: "보호자 연락처 2", value: parentPhone2 },
    { label: "보호자 연락처 3", value: parentPhone3 },
    { label: "보호자 연락처 4", value: parentPhone4 },
  ];

  return (
    <View style={m.form}>
      <KeyboardAwareScrollViewCompat
        style={{ flex: 1 }}
        contentContainerStyle={m.formContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        bottomOffset={76}
        showsVerticalScrollIndicator={false}
      >
        <View style={[
          m.requestPhone,
          { backgroundColor: info.phone_verified ? C.brandMist : C.iconOrangeBg, borderColor: info.phone_verified ? C.brandSoft : C.warning },
        ]}>
          <View style={m.requestPhoneHeader}>
            <Text style={m.sectionTitle}>
              {info.phone_verified ? "학부모 인증 전화번호" : "학부모 요청 전화번호"}
            </Text>
            {info.phone_verified ? (
              <View style={[m.verificationBadge, { backgroundColor: C.brandSoft }]}>
                <LucideIcon name="check-circle" size={12} color={C.brandStrong} />
                <Text style={[m.verificationText, { color: C.brandStrong }]}>소유 확인됨</Text>
              </View>
            ) : (
              <View style={[m.verificationBadge, { backgroundColor: C.iconOrangeBg }]}>
                <LucideIcon name="alert-circle" size={12} color={C.iconOrange} />
                <Text style={[m.verificationText, { color: C.iconOrange }]}>소유권 미확인</Text>
              </View>
            )}
          </View>
          <View style={m.requestNameRow}>
            <Text style={m.requestNameLabel}>학부모 계정명</Text>
            <Text style={m.requestName}>{info.parent_name || "미입력"}</Text>
          </View>
          <Text style={m.requestNumber}>{info.parent_phone || "전화번호 없음"}</Text>
          {!info.phone_verified && (
            <Text style={m.unverifiedHint}>이 번호의 소유 여부가 확인되지 않았습니다.</Text>
          )}
        </View>

        <MemberSectionCard title="기본 정보">
          <EditField label="학생 이름" value={name} onChangeText={setName} placeholder="학생 이름" />
        </MemberSectionCard>

        <MemberSectionCard title="보호자 / 연락처">
          <EditField label="보호자 이름" value={parentName} onChangeText={setParentName} placeholder="보호자 이름" />
          <Text style={m.matchHelp}>각 등록 전화번호와 위 학부모 요청 번호의 일치 여부입니다.</Text>
          {phoneSlots.map((slot, index) => {
            const hasPhone = !!slot.value.trim();
            const matches = hasPhone && phoneMatches(info.parent_phone, slot.value);
            return (
              <View key={slot.label} style={m.phoneSlot}>
                <EditField
                  label={slot.label}
                  value={slot.value}
                  onChangeText={value => {
                    if (index === 0) setParentPhone(value);
                    else if (index === 1) setParentPhone2(value);
                    else if (index === 2) setParentPhone3(value);
                    else setParentPhone4(value);
                  }}
                  placeholder="010-0000-0000"
                  keyboardType="phone-pad"
                />
                <View style={m.matchIndicator}>
                  <LucideIcon
                    name={matches ? "check-circle" : hasPhone ? "x-circle" : "minus"}
                    size={13}
                    color={matches ? C.success : hasPhone ? C.error : C.textMuted}
                  />
                  <Text style={[
                    m.matchText,
                    { color: matches ? C.success : hasPhone ? C.error : C.textMuted },
                  ]}>
                    {!hasPhone ? "등록된 번호 없음" : matches ? "요청 번호와 일치" : "요청 번호와 불일치"}
                  </Text>
                </View>
              </View>
            );
          })}
        </MemberSectionCard>
      </KeyboardAwareScrollViewCompat>

      <View style={m.footer}>
        <View style={m.footerButtons}>
          <Pressable
            testID="parent-approval-cancel"
            onPress={onClose}
            disabled={processing}
            style={m.cancelButton}
          >
            <Text style={m.cancelButtonText}>취소</Text>
          </Pressable>
          <Pressable
            testID="parent-approval-confirm"
            onPress={() => onConfirm({
              name, parent_name: parentName, parent_phone: parentPhone,
              parent_phone2: parentPhone2, parent_phone3: parentPhone3, parent_phone4: parentPhone4,
            })}
            disabled={processing}
            style={[m.primaryButton, processing && { opacity: 0.7 }]}
          >
            {processing
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={m.primaryButtonText}>확인</Text>
            }
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const m = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.42)", justifyContent: "flex-end" },
  sheet: { height: "90%", borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 18, overflow: "hidden" },
  header: { minHeight: 58, flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 18, fontFamily: "Pretendard-Bold", color: C.text },
  subtitle: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 3 },
  centerState: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  stateText: { textAlign: "center", color: C.textSecondary, fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 21 },
  unresolved: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, gap: 14 },
  unresolvedIcon: { width: 58, height: 58, borderRadius: 18, backgroundColor: C.iconOrangeBg, alignItems: "center", justifyContent: "center" },
  unresolvedTitle: { color: C.text, fontSize: 16, fontFamily: "Pretendard-SemiBold", textAlign: "center" },
  unresolvedText: { color: C.textSecondary, fontSize: 14, lineHeight: 22, fontFamily: "Pretendard-Regular", textAlign: "center" },
  form: { flex: 1, minHeight: 0 },
  formContent: { paddingHorizontal: 16, paddingTop: 2, paddingBottom: 14, gap: 12 },
  requestPhone: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 8 },
  requestPhoneHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  sectionTitle: { color: C.text, fontSize: 13, fontFamily: "Pretendard-SemiBold", flex: 1 },
  verificationBadge: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  verificationText: { fontSize: 11, fontFamily: "Pretendard-SemiBold" },
  requestNumber: { color: C.text, fontSize: 18, fontFamily: "Pretendard-SemiBold", letterSpacing: 0.2 },
  unverifiedHint: { color: C.iconOrange, fontSize: 12, fontFamily: "Pretendard-Regular" },
  matchHelp: { color: C.textMuted, fontSize: 11, lineHeight: 17, fontFamily: "Pretendard-Regular" },
  requestNameRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  requestNameLabel: { color: C.textSecondary, fontSize: 12, fontFamily: "Pretendard-Regular" },
  requestName: { color: C.text, fontSize: 13, fontFamily: "Pretendard-SemiBold" },
  phoneSlot: { gap: 4 },
  matchIndicator: { flexDirection: "row", alignItems: "center", gap: 5, paddingLeft: 2 },
  matchText: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  footer: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, backgroundColor: C.background, borderTopWidth: 1, borderTopColor: C.border },
  footerButtons: { flexDirection: "row", gap: 10 },
  primaryButton: { flex: 1, minHeight: 48, borderRadius: 12, backgroundColor: C.primaryAction, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  primaryButtonText: { color: "#fff", fontSize: 15, fontFamily: "Pretendard-SemiBold" },
  cancelButton: { flex: 1, minHeight: 48, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  cancelButtonText: { color: C.textSecondary, fontSize: 15, fontFamily: "Pretendard-SemiBold" },
  secondaryButton: { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 11 },
  secondaryButtonText: { color: C.brandStrong, fontFamily: "Pretendard-SemiBold", fontSize: 13 },
});