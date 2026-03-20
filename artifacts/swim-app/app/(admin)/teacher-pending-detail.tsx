/**
 * 선생님 승인 상세페이지
 * 경로: /(admin)/teacher-pending-detail?inviteId=...
 *
 * - pending 상태 선생님 정보 표시 + 권한 선택 + 승인/거절
 * - 이미 approved → teacher-hub로 리다이렉트
 * - 404 → 오류 안내 후 목록 복귀
 */
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const C = Colors.light;

interface TeacherDetail {
  id: string;                     // teacher_invites.id
  user_id?: string;
  name: string;
  phone?: string;
  position?: string;
  invite_status: string;
  approved_role?: string;
  approved_at?: string;
  rejected_at?: string;
  rejection_reason?: string;
  created_at?: string;
  user_email?: string;
  is_activated?: boolean;
  class_count?: number;
  member_count?: number;
}

type SelectedRole = "teacher" | "sub_admin";

const ROLE_OPTIONS: { key: SelectedRole; label: string; desc: string; icon: string; color: string; bg: string }[] = [
  {
    key: "teacher",
    label: "일반선생님",
    desc: "출결·일지·담당회원 조회·보강관리 기본 기능",
    icon: "user",
    color: "#1A5CFF",
    bg: "#EFF4FF",
  },
  {
    key: "sub_admin",
    label: "부관리자",
    desc: "일반선생님 + 회원관리 일부 + 반배정 + 운영보조\n※ 결제/정산/킬스위치/최고관리자 권한 없음",
    icon: "shield",
    color: "#7C3AED",
    bg: "#F5F3FF",
  },
];

const REJECT_PRESETS = [
  "가입 자격 미달",
  "정보 불일치 (이름/연락처 오류)",
  "중복 계정 의심",
  "소속 수영장 불일치",
  "직접 입력",
];

const STATUS_LABEL: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  joinedPendingApproval: { label: "승인 대기",  color: "#D97706", bg: "#FEF3C7", icon: "clock"         },
  approved:             { label: "승인됨",     color: "#059669", bg: "#D1FAE5", icon: "check-circle"   },
  rejected:             { label: "거절됨",     color: "#DC2626", bg: "#FEE2E2", icon: "x-circle"       },
  inactive:             { label: "비활성",     color: "#6B7280", bg: "#F3F4F6", icon: "slash"          },
  invited:              { label: "초대됨",     color: "#0891B2", bg: "#ECFEFF", icon: "mail"           },
};

export default function TeacherPendingDetailScreen() {
  const { token }       = useAuth();
  const { themeColor }  = useBrand();
  const insets          = useSafeAreaInsets();
  const { inviteId, teacherName } = useLocalSearchParams<{ inviteId: string; teacherName?: string }>();

  const [data,          setData]          = useState<TeacherDetail | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [notFound,      setNotFound]      = useState(false);
  const [selectedRole,  setSelectedRole]  = useState<SelectedRole>("teacher");
  const [approving,     setApproving]     = useState(false);
  const [approveError,  setApproveError]  = useState("");
  const [rejecting,     setRejecting]     = useState(false);

  // 거절 모달
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectPreset,    setRejectPreset]    = useState<string>("");
  const [rejectCustom,    setRejectCustom]    = useState("");
  const [rejectError,     setRejectError]     = useState("");

  const finalRejectReason = rejectPreset === "직접 입력" ? rejectCustom.trim() : rejectPreset;

  useEffect(() => { if (inviteId) load(); }, [inviteId]);

  async function load() {
    setLoading(true);
    try {
      const res = await apiRequest(token, `/admin/teacher-invites/${inviteId}/detail`);
      if (res.status === 404) { setNotFound(true); return; }
      const json = await res.json();
      const detail: TeacherDetail = json.data ?? json;
      // 이미 approved → teacher-hub로 리다이렉트
      if (detail.invite_status === "approved" && detail.user_id) {
        router.replace({ pathname: "/(admin)/teacher-hub", params: { id: detail.user_id, name: detail.name } } as any);
        return;
      }
      setData(detail);
    } catch { setNotFound(true); }
    finally { setLoading(false); }
  }

  async function handleApprove() {
    if (!data) return;
    setApproving(true);
    setApproveError("");
    try {
      const res = await apiRequest(token, `/admin/teacher-invites/${inviteId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "approve", selected_role: selectedRole }),
      });
      const json = await res.json();
      if (!res.ok) { setApproveError(json.message || "승인에 실패했습니다."); return; }
      if (data.user_id) {
        router.replace({ pathname: "/(admin)/teacher-hub", params: { id: data.user_id, name: data.name } } as any);
      } else {
        router.back();
      }
    } catch { setApproveError("네트워크 오류가 발생했습니다."); }
    finally { setApproving(false); }
  }

  async function handleReject() {
    if (!finalRejectReason) { setRejectError("거절 사유를 입력해주세요."); return; }
    setRejecting(true);
    try {
      const res = await apiRequest(token, `/admin/teacher-invites/${inviteId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "reject", rejection_reason: finalRejectReason }),
      });
      const json = await res.json();
      if (!res.ok) { setRejectError(json.message || "거절에 실패했습니다."); return; }
      setShowRejectModal(false);
      router.back();
    } catch { setRejectError("네트워크 오류가 발생했습니다."); }
    finally { setRejecting(false); }
  }

  // ── 로딩 ──
  if (loading) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <SubScreenHeader title="선생님 승인 처리" onBack={() => router.back()} />
        <ActivityIndicator style={{ flex: 1 }} color={themeColor} />
      </View>
    );
  }

  // ── 404 ──
  if (notFound || !data) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <SubScreenHeader title="선생님 승인 처리" onBack={() => router.back()} />
        <View style={s.errorState}>
          <Feather name="alert-circle" size={48} color={C.textMuted} />
          <Text style={s.errorTitle}>선생님 정보를 찾을 수 없습니다</Text>
          <Text style={s.errorDesc}>이미 처리됐거나 존재하지 않는 요청입니다.</Text>
          <Pressable
            style={({ pressed }) => [s.backBtn, { backgroundColor: themeColor, opacity: pressed ? 0.85 : 1 }]}
            onPress={() => router.back()}
          >
            <Text style={s.backBtnTxt}>목록으로 돌아가기</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const statusInfo = STATUS_LABEL[data.invite_status] ?? STATUS_LABEL.invited;
  const isPending  = data.invite_status === "joinedPendingApproval";
  const isRejected = data.invite_status === "rejected";

  const joinedDate = data.created_at
    ? new Date(data.created_at).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "알 수 없음";

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <SubScreenHeader title="선생님 승인 처리" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── 상태 배너 ── */}
        <View style={[s.statusBanner, { backgroundColor: statusInfo.bg }]}>
          <Feather name={statusInfo.icon as any} size={20} color={statusInfo.color} />
          <Text style={[s.statusBannerTxt, { color: statusInfo.color }]}>{statusInfo.label}</Text>
          {isPending && <Text style={[s.statusBannerSub, { color: statusInfo.color }]}>승인 또는 거절 처리가 필요합니다</Text>}
          {isRejected && !!data.rejection_reason && (
            <Text style={[s.statusBannerSub, { color: statusInfo.color }]}>사유: {data.rejection_reason}</Text>
          )}
        </View>

        {/* ── 기본 정보 ── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>선생님 기본정보</Text>
          <InfoRow icon="user"       label="이름"   value={data.name} />
          {!!data.phone && <InfoRow icon="phone"      label="전화번호" value={data.phone} />}
          {!!data.user_email && <InfoRow icon="mail"  label="이메일"  value={data.user_email} />}
          {!!data.position && <InfoRow icon="briefcase" label="직책"  value={data.position} />}
          <InfoRow icon="calendar"   label="가입일시" value={joinedDate} />
          {!!data.approved_at && data.invite_status === "approved" && (
            <InfoRow icon="check-circle" label="승인일시" value={new Date(data.approved_at).toLocaleDateString("ko-KR")} />
          )}
        </View>

        {/* ── 소속 정보 ── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>소속 통계</Text>
          <View style={s.statsGrid}>
            <StatBox label="담당반" value={data.class_count ?? 0} icon="layers" color="#1A5CFF" />
            <StatBox label="담당 회원" value={data.member_count ?? 0} icon="users" color="#10B981" />
          </View>
        </View>

        {/* ── 권한 선택 (pending 상태에서만) ── */}
        {isPending && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>권한 선택 <Text style={s.required}>*필수</Text></Text>
            <Text style={s.sectionDesc}>승인 시 부여할 권한을 선택해주세요.</Text>
            {ROLE_OPTIONS.map(opt => (
              <Pressable
                key={opt.key}
                style={[
                  s.roleCard,
                  selectedRole === opt.key && { borderColor: opt.color, borderWidth: 2 },
                ]}
                onPress={() => setSelectedRole(opt.key)}
              >
                <View style={[s.roleIconBox, { backgroundColor: opt.bg }]}>
                  <Feather name={opt.icon as any} size={20} color={opt.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.roleLabel, selectedRole === opt.key && { color: opt.color }]}>{opt.label}</Text>
                  <Text style={s.roleDesc}>{opt.desc}</Text>
                </View>
                <View style={[
                  s.radioOuter,
                  selectedRole === opt.key && { borderColor: opt.color },
                ]}>
                  {selectedRole === opt.key && (
                    <View style={[s.radioInner, { backgroundColor: opt.color }]} />
                  )}
                </View>
              </Pressable>
            ))}
            {selectedRole === "sub_admin" && (
              <View style={[s.warnBox, { backgroundColor: "#FEF3C7" }]}>
                <Feather name="alert-triangle" size={14} color="#D97706" />
                <Text style={s.warnTxt}>
                  부관리자는 결제·정산·킬스위치·최고관리자 설정 변경 권한이 없습니다.
                </Text>
              </View>
            )}
          </View>
        )}

        {/* ── 이미 승인된 경우 권한 표시 ── */}
        {!isPending && data.invite_status === "approved" && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>부여된 권한</Text>
            <View style={[s.approvedRoleBadge, {
              backgroundColor: data.approved_role === "sub_admin" ? "#EDE9FE" : "#EFF4FF"
            }]}>
              <Feather
                name={data.approved_role === "sub_admin" ? "shield" : "user"}
                size={14}
                color={data.approved_role === "sub_admin" ? "#7C3AED" : "#1A5CFF"}
              />
              <Text style={[s.approvedRoleTxt, {
                color: data.approved_role === "sub_admin" ? "#7C3AED" : "#1A5CFF"
              }]}>
                {data.approved_role === "sub_admin" ? "부관리자" : "일반선생님"}
              </Text>
            </View>
          </View>
        )}

        {/* ── 승인 오류 메시지 ── */}
        {!!approveError && (
          <View style={[s.warnBox, { backgroundColor: "#FEE2E2" }]}>
            <Feather name="alert-circle" size={14} color="#DC2626" />
            <Text style={[s.warnTxt, { color: "#991B1B" }]}>{approveError}</Text>
          </View>
        )}

        {/* ── 액션 버튼 ── */}
        {isPending && (
          <View style={s.actionRow}>
            <Pressable
              style={({ pressed }) => [s.rejectBtn, { opacity: pressed ? 0.85 : 1 }]}
              onPress={() => { setRejectPreset(""); setRejectCustom(""); setRejectError(""); setShowRejectModal(true); }}
              disabled={approving}
            >
              <Feather name="x-circle" size={16} color="#DC2626" />
              <Text style={s.rejectBtnTxt}>거절</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [s.approveBtn, { backgroundColor: themeColor, opacity: pressed || approving ? 0.85 : 1, flex: 1 }]}
              onPress={handleApprove}
              disabled={approving}
            >
              {approving
                ? <ActivityIndicator color="#fff" size="small" />
                : (
                  <>
                    <Feather name="check-circle" size={16} color="#fff" />
                    <Text style={s.approveBtnTxt}>
                      {selectedRole === "sub_admin" ? "부관리자로 승인" : "일반선생님으로 승인"}
                    </Text>
                  </>
                )
              }
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/* ── 거절 모달 ── */}
      <Modal
        visible={showRejectModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowRejectModal(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <Pressable style={s.modalOverlay} onPress={() => setShowRejectModal(false)}>
            <Pressable style={[s.modalSheet, { paddingBottom: insets.bottom + 24 }]} onPress={e => e.stopPropagation()}>
              <View style={s.modalHandle} />
              <Text style={s.modalTitle}>거절 사유 선택</Text>
              <Text style={s.modalDesc}>{data.name} 선생님의 가입 요청을 거절합니다.</Text>

              <View style={s.presetList}>
                {REJECT_PRESETS.map(p => (
                  <Pressable
                    key={p}
                    style={[s.presetItem, rejectPreset === p && { backgroundColor: "#FEE2E2", borderColor: "#DC2626" }]}
                    onPress={() => { setRejectPreset(p); setRejectError(""); }}
                  >
                    <View style={[s.presetRadio, rejectPreset === p && { borderColor: "#DC2626" }]}>
                      {rejectPreset === p && <View style={[s.presetRadioInner, { backgroundColor: "#DC2626" }]} />}
                    </View>
                    <Text style={[s.presetTxt, rejectPreset === p && { color: "#DC2626", fontWeight: "700" }]}>{p}</Text>
                  </Pressable>
                ))}
              </View>

              {rejectPreset === "직접 입력" && (
                <TextInput
                  style={[s.customInput, { borderColor: rejectError ? "#DC2626" : C.border }]}
                  value={rejectCustom}
                  onChangeText={v => { setRejectCustom(v); setRejectError(""); }}
                  placeholder="거절 사유를 입력해주세요"
                  placeholderTextColor={C.textMuted}
                  multiline
                  numberOfLines={3}
                  autoFocus
                />
              )}

              {!!rejectError && (
                <View style={s.errorRow}>
                  <Feather name="alert-circle" size={13} color="#DC2626" />
                  <Text style={s.errorTxt}>{rejectError}</Text>
                </View>
              )}

              <View style={s.modalActions}>
                <Pressable
                  style={({ pressed }) => [s.modalCancelBtn, { borderColor: C.border, opacity: pressed ? 0.7 : 1 }]}
                  onPress={() => setShowRejectModal(false)}
                  disabled={rejecting}
                >
                  <Text style={[s.modalCancelTxt, { color: C.textSecondary }]}>취소</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [s.modalRejectBtn, { opacity: pressed || rejecting ? 0.85 : 1 }]}
                  onPress={handleReject}
                  disabled={rejecting}
                >
                  {rejecting
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={s.modalRejectTxt}>거절 확정</Text>
                  }
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ── 서브 컴포넌트 ──────────────────────────────────────────────────────

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={s.infoRow}>
      <Feather name={icon as any} size={13} color={C.textMuted} style={{ marginTop: 1 }} />
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue}>{value}</Text>
    </View>
  );
}

function StatBox({ label, value, icon, color }: { label: string; value: number; icon: string; color: string }) {
  return (
    <View style={[s.statBox, { backgroundColor: C.card }]}>
      <View style={[s.statIconBox, { backgroundColor: color + "18" }]}>
        <Feather name={icon as any} size={18} color={color} />
      </View>
      <Text style={[s.statValue, { color }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root:            { flex: 1, backgroundColor: C.background },
  scroll:          { padding: 16, gap: 16, paddingBottom: 48 },

  statusBanner:    { borderRadius: 14, padding: 14, gap: 4 },
  statusBannerTxt: { fontSize: 16, fontFamily: "Inter_700Bold" },
  statusBannerSub: { fontSize: 12, fontFamily: "Inter_400Regular", opacity: 0.85 },

  section:         { backgroundColor: C.card, borderRadius: 16, padding: 16, gap: 10 },
  sectionTitle:    { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  sectionDesc:     { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted },
  required:        { color: "#DC2626", fontFamily: "Inter_500Medium" },

  infoRow:         { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  infoLabel:       { fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary, width: 72 },
  infoValue:       { fontSize: 13, fontFamily: "Inter_400Regular", color: C.text, flex: 1 },

  statsGrid:       { flexDirection: "row", gap: 10 },
  statBox:         { flex: 1, borderRadius: 12, padding: 14, alignItems: "center", gap: 6, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  statIconBox:     { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  statValue:       { fontSize: 24, fontFamily: "Inter_700Bold" },
  statLabel:       { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary },

  roleCard:        { flexDirection: "row", alignItems: "flex-start", gap: 12, backgroundColor: "#F9FAFB", borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: C.border },
  roleIconBox:     { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  roleLabel:       { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text, marginBottom: 2 },
  roleDesc:        { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textMuted, lineHeight: 16 },
  radioOuter:      { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: C.border, alignItems: "center", justifyContent: "center", marginTop: 2 },
  radioInner:      { width: 10, height: 10, borderRadius: 5 },

  warnBox:         { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: 10, padding: 10 },
  warnTxt:         { fontSize: 12, fontFamily: "Inter_400Regular", color: "#92400E", flex: 1, lineHeight: 18 },

  approvedRoleBadge: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  approvedRoleTxt:   { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  actionRow:       { flexDirection: "row", gap: 10, marginTop: 4 },
  rejectBtn:       { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: "#DC2626", backgroundColor: "#FFF5F5" },
  rejectBtnTxt:    { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#DC2626" },
  approveBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14 },
  approveBtnTxt:   { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },

  errorState:      { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  errorTitle:      { fontSize: 17, fontFamily: "Inter_600SemiBold", color: C.text },
  errorDesc:       { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, textAlign: "center" },
  backBtn:         { paddingHorizontal: 28, paddingVertical: 12, borderRadius: 12, marginTop: 8 },
  backBtnTxt:      { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },

  modalOverlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  modalSheet:      { backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 12 },
  modalHandle:     { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: "center", marginBottom: 4 },
  modalTitle:      { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text },
  modalDesc:       { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary },
  presetList:      { gap: 8 },
  presetItem:      { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.background },
  presetRadio:     { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: C.border, alignItems: "center", justifyContent: "center" },
  presetRadioInner:{ width: 8, height: 8, borderRadius: 4 },
  presetTxt:       { fontSize: 14, fontFamily: "Inter_400Regular", color: C.text, flex: 1 },
  customInput:     { borderWidth: 1.5, borderRadius: 12, padding: 12, fontSize: 14, fontFamily: "Inter_400Regular", color: C.text, minHeight: 80, textAlignVertical: "top" },
  errorRow:        { flexDirection: "row", alignItems: "center", gap: 6 },
  errorTxt:        { fontSize: 12, fontFamily: "Inter_400Regular", color: "#DC2626" },
  modalActions:    { flexDirection: "row", gap: 10, marginTop: 4 },
  modalCancelBtn:  { flex: 1, height: 48, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  modalCancelTxt:  { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  modalRejectBtn:  { flex: 2, height: 48, borderRadius: 12, backgroundColor: "#DC2626", alignItems: "center", justifyContent: "center" },
  modalRejectTxt:  { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
