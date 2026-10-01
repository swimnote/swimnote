import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { LucideIcon } from "@/components/common/LucideIcon";
import { MemberSectionCard } from "@/components/admin/member/MemberSectionCard";
import { parentApprovalCandidates, phoneMatches } from "@/lib/parentApprovalUtils";
import type { ParentApprovalInfo } from "@/lib/parentApprovalUtils";

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
  onConfirm: (studentId: string) => void;
}

export function ParentApprovalInfoModal({
  visible, info, loading, error, processing, onClose, onRetry, onOpenMembers, onConfirm,
}: Props) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={m.overlay}>
        <View style={[m.sheet, { backgroundColor: C.background, paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={m.header}>
            <View style={{ flex: 1 }}>
              <Text style={m.title}>학부모 연결 확인</Text>
              {info?.child_name_raw ? <Text style={m.subtitle}>요청 자녀: {info.child_name_raw}</Text> : null}
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
          ) : info ? (
            <ParentApprovalSelectionForm
              info={info}
              processing={processing}
              onClose={onClose}
              onOpenMembers={onOpenMembers}
              onConfirm={onConfirm}
            />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function ParentApprovalSelectionForm({
  info, processing, onClose, onOpenMembers, onConfirm,
}: {
  info: ParentApprovalInfo;
  processing: boolean;
  onClose: () => void;
  onOpenMembers: () => void;
  onConfirm: (studentId: string) => void;
}) {
  const candidates = parentApprovalCandidates(info);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const selectedStudent = candidates.find(candidate => candidate.id === selectedStudentId) ?? null;

  useEffect(() => {
    setSelectedStudentId(null);
  }, [info.pending_id]);

  const selectedPhoneSlots = selectedStudent ? [
    { label: "보호자 연락처 1", value: selectedStudent.parent_phone },
    { label: "보호자 연락처 2", value: selectedStudent.parent_phone2 },
    { label: "보호자 연락처 3", value: selectedStudent.parent_phone3 },
    { label: "보호자 연락처 4", value: selectedStudent.parent_phone4 },
  ] : [];

  return (
    <View style={m.form}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={m.formContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={[
          m.requestInfo,
          { backgroundColor: info.phone_verified ? C.brandMist : C.iconOrangeBg, borderColor: info.phone_verified ? C.brandSoft : C.warning },
        ]}>
          <View style={m.requestInfoHeader}>
            <Text style={m.sectionTitle}>학부모 요청 정보</Text>
            {info.phone_verified ? (
              <View style={[m.verificationBadge, { backgroundColor: C.brandSoft }]}>
                <LucideIcon name="check-circle" size={12} color={C.brandStrong} />
                <Text style={[m.verificationText, { color: C.brandStrong }]}>SMS 인증 근거 확인</Text>
              </View>
            ) : (
              <View style={[m.verificationBadge, { backgroundColor: C.iconOrangeBg }]}>
                <LucideIcon name="alert-circle" size={12} color={C.iconOrange} />
                <Text style={[m.verificationText, { color: C.iconOrange }]}>소유권 미확인</Text>
              </View>
            )}
          </View>
          <View style={m.requestInfoRow}>
            <Text style={m.requestInfoLabel}>요청 자녀명</Text>
            <Text style={m.requestInfoValue}>{info.child_name_raw || "미입력"}</Text>
          </View>
          <View style={m.requestInfoRow}>
            <Text style={m.requestInfoLabel}>학부모 계정명</Text>
            <Text style={m.requestInfoValue}>{info.parent_name || "미입력"}</Text>
          </View>
          <Text style={m.requestNumber}>
            {info.phone_verified ? "인증 전화번호" : "요청 전화번호"}: {info.parent_phone || "전화번호 없음"}
          </Text>
          {!info.phone_verified && (
            <Text style={m.unverifiedHint}>이 번호의 SMS 인증 근거가 확인되지 않았습니다.</Text>
          )}
        </View>

        <MemberSectionCard title="연결할 학생 선택">
          <Text style={m.matchHelp}>현재 수영장에 등록된 학생입니다. 연결할 학생을 직접 선택해 주세요.</Text>
          {candidates.length === 0 ? (
            <View style={m.emptyCandidates}>
              <Text style={m.emptyCandidatesText}>선택 가능한 학생이 없습니다.</Text>
              {info.reason ? <Text style={m.emptyCandidatesText}>{info.reason}</Text> : null}
              <Pressable testID="parent-approval-open-members" onPress={onOpenMembers} style={m.secondaryButton}>
                <Text style={m.secondaryButtonText}>회원 관리로 이동</Text>
              </Pressable>
            </View>
          ) : candidates.map(candidate => {
            const isSelected = selectedStudentId === candidate.id;
            return (
              <Pressable
                key={candidate.id}
                testID={`parent-approval-student-${candidate.id}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                onPress={() => setSelectedStudentId(candidate.id)}
                disabled={processing}
                style={[
                  m.studentOption,
                  {
                    borderColor: isSelected ? C.brandStrong : C.border,
                    backgroundColor: isSelected ? C.brandMist : C.card,
                  },
                ]}
              >
                <LucideIcon
                  name={isSelected ? "check-circle" : "circle"}
                  size={20}
                  color={isSelected ? C.brandStrong : C.textMuted}
                />
                <View style={m.studentOptionText}>
                  <Text style={m.studentOptionName}>{candidate.name || "이름 미입력"}</Text>
                  <Text style={m.studentOptionGuardian}>
                    {candidate.parent_name ? `보호자 ${candidate.parent_name}` : "보호자 이름 미입력"}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </MemberSectionCard>

        {selectedStudent ? (
          <MemberSectionCard title="선택한 학생 등록 정보">
            <View style={m.detailRow}>
              <Text style={m.detailLabel}>학생 이름</Text>
              <Text style={m.detailValue}>{selectedStudent.name || "미입력"}</Text>
            </View>
            <View style={m.detailRow}>
              <Text style={m.detailLabel}>보호자 이름</Text>
              <Text style={m.detailValue}>{selectedStudent.parent_name || "미입력"}</Text>
            </View>
            <Text style={m.matchHelp}>
              등록 전화번호와 학부모 요청 전화번호의 비교 결과입니다. 참고 정보이며 승인 가능 여부를 차단하지 않습니다.
            </Text>
            {selectedPhoneSlots.map(slot => {
              const value = slot.value ?? "";
              const hasPhone = !!value.trim();
              const matches = hasPhone && phoneMatches(info.parent_phone, value);
              return (
                <View key={slot.label} style={m.phoneSlot}>
                  <View style={m.detailRow}>
                    <Text style={m.detailLabel}>{slot.label}</Text>
                    <Text style={m.detailValue}>{value || "등록된 번호 없음"}</Text>
                  </View>
                  {hasPhone ? (
                    <View style={m.matchIndicator}>
                      <LucideIcon
                        name={matches ? "check-circle" : "x-circle"}
                        size={13}
                        color={matches ? C.success : C.error}
                      />
                      <Text style={[m.matchText, { color: matches ? C.success : C.error }]}>
                        {matches ? "요청 번호와 일치" : "요청 번호와 불일치"}
                      </Text>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </MemberSectionCard>
        ) : (
          <View style={m.selectionHint}>
            <LucideIcon name="info" size={14} color={C.textMuted} />
            <Text style={m.selectionHintText}>학생을 선택하면 등록된 보호자 정보와 전화번호 비교를 확인할 수 있습니다.</Text>
          </View>
        )}
      </ScrollView>

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
            onPress={() => selectedStudent && onConfirm(selectedStudent.id)}
            disabled={processing || !selectedStudent}
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
  form: { flex: 1, minHeight: 0 },
  formContent: { paddingHorizontal: 16, paddingTop: 2, paddingBottom: 14, gap: 12 },
  requestInfo: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 8 },
  requestInfoHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  requestInfoRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  requestInfoLabel: { color: C.textSecondary, fontSize: 12, fontFamily: "Pretendard-Regular" },
  requestInfoValue: { color: C.text, fontSize: 13, fontFamily: "Pretendard-SemiBold" },
  sectionTitle: { color: C.text, fontSize: 13, fontFamily: "Pretendard-SemiBold", flex: 1 },
  verificationBadge: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  verificationText: { fontSize: 11, fontFamily: "Pretendard-SemiBold" },
  requestNumber: { color: C.text, fontSize: 15, fontFamily: "Pretendard-SemiBold", letterSpacing: 0.2 },
  unverifiedHint: { color: C.iconOrange, fontSize: 12, fontFamily: "Pretendard-Regular" },
  matchHelp: { color: C.textMuted, fontSize: 11, lineHeight: 17, fontFamily: "Pretendard-Regular" },
  emptyCandidates: { alignItems: "center", gap: 10, paddingVertical: 16 },
  emptyCandidatesText: { color: C.textSecondary, fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center" },
  studentOption: { minHeight: 58, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  studentOptionText: { flex: 1, gap: 3 },
  studentOptionName: { color: C.text, fontSize: 14, fontFamily: "Pretendard-SemiBold" },
  studentOptionGuardian: { color: C.textSecondary, fontSize: 12, fontFamily: "Pretendard-Regular" },
  detailRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  detailLabel: { color: C.textSecondary, fontSize: 12, fontFamily: "Pretendard-Regular" },
  detailValue: { flex: 1, textAlign: "right", color: C.text, fontSize: 13, fontFamily: "Pretendard-SemiBold" },
  phoneSlot: { gap: 4 },
  matchIndicator: { flexDirection: "row", alignItems: "center", gap: 5, paddingLeft: 2 },
  matchText: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  selectionHint: { flexDirection: "row", alignItems: "flex-start", gap: 7, paddingHorizontal: 4, paddingBottom: 4 },
  selectionHintText: { flex: 1, color: C.textMuted, fontSize: 11, lineHeight: 17, fontFamily: "Pretendard-Regular" },
  footer: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, backgroundColor: C.background, borderTopWidth: 1, borderTopColor: C.border },
  footerButtons: { flexDirection: "row", gap: 10 },
  primaryButton: { flex: 1, minHeight: 48, borderRadius: 12, backgroundColor: C.primaryAction, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  primaryButtonText: { color: "#fff", fontSize: 15, fontFamily: "Pretendard-SemiBold" },
  cancelButton: { flex: 1, minHeight: 48, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  cancelButtonText: { color: C.textSecondary, fontSize: 15, fontFamily: "Pretendard-SemiBold" },
  secondaryButton: { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 11 },
  secondaryButtonText: { color: C.brandStrong, fontFamily: "Pretendard-SemiBold", fontSize: 13 },
});