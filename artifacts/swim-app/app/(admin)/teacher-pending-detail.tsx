/**
 * 선생님 승인관리 상세페이지
 * 경로: /(admin)/teacher-pending-detail?inviteId=...
 *
 * - pending(joinedPendingApproval): 승인 / 거절
 * - rejected: 거절 사유 보기 / 다시 승인
 * - approved: teacher-hub로 자동 리다이렉트
 */
import { CircleAlert, CircleCheck, CircleX, FileText, RefreshCw } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
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
  id: string;
  user_id?: string;
  name: string;
  phone?: string;
  position?: string;
  invite_status: string;
  approved_role?: string;
  approved_at?: string;
  approved_by?: string;
  rejected_at?: string;
  rejected_by?: string;
  rejection_reason?: string;
  created_at?: string;
  requested_at?: string;
  user_email?: string;
  is_activated?: boolean;
  class_count?: number;
  member_count?: number;
}

const REJECT_PRESETS = [
  "가입 자격 미달",
  "정보 불일치 (이름/연락처 오류)",
  "중복 계정 의심",
  "소속 수영장 불일치",
  "직접 입력",
];

const STATUS_META: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  joinedPendingApproval: { label: "승인 대기",  color: "#D97706", bg: "#FFF1BF", icon: "clock"       },
  approved:              { label: "승인됨",     color: "#2EC4B6", bg: "#E6FFFA", icon: "check-circle" },
  rejected:              { label: "거절됨",     color: "#D96C6C", bg: "#F9DEDA", icon: "x-circle"     },
  inactive:              { label: "비활성",     color: "#64748B", bg: "#FFFFFF", icon: "slash"        },
  invited:               { label: "초대됨",     color: "#2EC4B6", bg: "#ECFEFF", icon: "mail"         },
};

function fmtDate(dt?: string | null) {
  if (!dt) return null;
  try {
    return new Date(dt).toLocaleString("ko-KR", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return dt; }
}

export default function TeacherPendingDetailScreen() {
  const { token }      = useAuth();
  const { themeColor } = useBrand();
  const insets         = useSafeAreaInsets();
  const { inviteId, teacherName } = useLocalSearchParams<{ inviteId: string; teacherName?: string }>();

  const [data,         setData]         = useState<TeacherDetail | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [notFound,     setNotFound]     = useState(false);

  const [approving,    setApproving]    = useState(false);
  const [approveError, setApproveError] = useState("");

  const [showRejectModal,    setShowRejectModal]    = useState(false);
  const [showRejectReasonModal, setShowRejectReasonModal] = useState(false);
  const [rejectPreset,       setRejectPreset]       = useState("");
  const [rejectCustom,       setRejectCustom]       = useState("");
  const [rejectError,        setRejectError]        = useState("");
  const [rejecting,          setRejecting]          = useState(false);

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
        router.replace({
          pathname: "/(admin)/teacher-hub",
          params: { id: detail.user_id, name: detail.name },
        } as any);
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
        body: JSON.stringify({ action: "approve" }),
      });
      const json = await res.json();
      if (!res.ok) { setApproveError(json.message || "승인에 실패했습니다."); return; }
      router.back();
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

  // ── 로딩 ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <SubScreenHeader title="선생님 승인 처리" onBack={() => router.back()} />
        <ActivityIndicator style={{ flex: 1 }} color={themeColor} />
      </View>
    );
  }

  // ── 404 ───────────────────────────────────────────────────────────────
  if (notFound || !data) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <SubScreenHeader title="선생님 승인 처리" onBack={() => router.back()} />
        <View style={s.errorState}>
          <CircleAlert size={48} color={C.textMuted} />
          <Text style={s.errorTitle}>존재하지 않는 선생님입니다</Text>
          <Text style={s.errorDesc}>이미 처리됐거나 존재하지 않는 요청입니다.</Text>
          <Pressable
            style={({ pressed }) => [s.backBtn, { backgroundColor: C.button, opacity: pressed ? 0.85 : 1 }]}
            onPress={() => router.back()}
          >
            <Text style={s.backBtnTxt}>목록으로 돌아가기</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const statusInfo = STATUS_META[data.invite_status] ?? STATUS_META.invited;
  const isPending  = data.invite_status === "joinedPendingApproval";
  const isRejected = data.invite_status === "rejected";
  const joinedDate   = fmtDate(data.created_at)   || "알 수 없음";
  const requestedDate = fmtDate(data.requested_at) || joinedDate;
  const rejectedDate = fmtDate(data.rejected_at);
  const approvedDate = fmtDate(data.approved_at);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <SubScreenHeader title="선생님 승인 처리" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── 상태 배너 ── */}
        <View style={[s.statusBanner, { backgroundColor: statusInfo.bg }]}>
          <LucideIcon name={statusInfo.icon as any} size={20} color={statusInfo.color} />
          <Text style={[s.statusBannerTxt, { color: statusInfo.color }]}>{statusInfo.label}</Text>
          {isPending && (
            <Text style={[s.statusBannerSub, { color: statusInfo.color }]}>
              승인 또는 거절 처리가 필요합니다
            </Text>
          )}
          {isRejected && (
            <Text style={[s.statusBannerSub, { color: statusInfo.color }]}>
              거절된 계정입니다. 재승인하거나 이력을 확인하세요.
            </Text>
          )}
        </View>

        {/* ── 기본 정보 ── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>선생님 기본정보</Text>
          <InfoRow icon="user"       label="이름"     value={data.name} />
          {!!data.phone       && <InfoRow icon="phone"    label="전화번호"  value={data.phone} />}
          {!!data.user_email  && <InfoRow icon="mail"     label="이메일"   value={data.user_email} />}
          {!!data.position    && <InfoRow icon="briefcase" label="직책"    value={data.position} />}
          <InfoRow icon="calendar"   label="가입일시"   value={joinedDate} />
          <InfoRow icon="send"       label="요청일시"   value={requestedDate} />
          <InfoRow icon="info"       label="현재 상태"  value={statusInfo.label} />
        </View>

        {/* ── 소속 통계 ── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>소속 통계</Text>
          <View style={s.statsGrid}>
            <StatBox label="담당반"   value={data.class_count  ?? 0} icon="layers" color="#2EC4B6" />
            <StatBox label="담당 회원" value={data.member_count ?? 0} icon="users"  color="#2E9B6F" />
          </View>
        </View>

        {/* 선생님 권한으로 승인 (관리자 권한은 "관리자 추가/승계" 화면에서 별도 부여 가능) */}

        {/* ── 승인 오류 메시지 ── */}
        {!!approveError && (
          <View style={[s.warnBox, { backgroundColor: "#F9DEDA" }]}>
            <CircleAlert size={14} color="#D96C6C" />
            <Text style={[s.warnTxt, { color: "#991B1B" }]}>{approveError}</Text>
          </View>
        )}

        {/* ── 버튼: pending 상태 ── */}
        {isPending && (
          <View style={s.actionRow}>
            <Pressable
              style={({ pressed }) => [s.rejectBtn, { opacity: pressed ? 0.85 : 1 }]}
              onPress={() => {
                setRejectPreset("");
                setRejectCustom("");
                setRejectError("");
                setShowRejectModal(true);
              }}
              disabled={approving}
            >
              <CircleX size={16} color="#D96C6C" />
              <Text style={s.rejectBtnTxt}>거절</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [s.approveBtn, { backgroundColor: C.button, opacity: pressed || approving ? 0.85 : 1, flex: 1 }]}
              onPress={handleApprove}
              disabled={approving}
            >
              {approving
                ? <ActivityIndicator color="#fff" size="small" />
                : (
                  <>
                    <CircleCheck size={16} color="#fff" />
                    <Text style={s.approveBtnTxt}>선생님으로 승인</Text>
                  </>
                )
              }
            </Pressable>
          </View>
        )}

        {/* ── 버튼: rejected 상태 ── */}
        {isRejected && (
          <View style={s.actionRow}>
            <Pressable
              style={({ pressed }) => [s.rejectReasonBtn, { opacity: pressed ? 0.85 : 1 }]}
              onPress={() => setShowRejectReasonModal(true)}
              disabled={approving}
            >
              <FileText size={16} color="#64748B" />
              <Text style={s.rejectReasonBtnTxt}>거절 사유 보기</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [s.approveBtn, { backgroundColor: C.button, opacity: pressed || approving ? 0.85 : 1, flex: 1 }]}
              onPress={handleApprove}
              disabled={approving}
            >
              {approving
                ? <ActivityIndicator color="#fff" size="small" />
                : (
                  <>
                    <RefreshCw size={16} color="#fff" />
                    <Text style={s.approveBtnTxt}>선생님으로 재승인</Text>
                  </>
                )
              }
            </Pressable>
          </View>
        )}

        {/* ── 처리 이력 ── */}
        {(rejectedDate || approvedDate) && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>처리 이력</Text>
            <View style={s.historyList}>
              {approvedDate && (
                <View style={s.historyItem}>
                  <View style={[s.historyDot, { backgroundColor: "#2EC4B6" }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.historyDate}>{approvedDate}</Text>
                    <Text style={s.historyDesc}>승인: 선생님 권한 부여</Text>
                  </View>
                </View>
              )}
              {rejectedDate && (
                <View style={s.historyItem}>
                  <View style={[s.historyDot, { backgroundColor: "#D96C6C" }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.historyDate}>{rejectedDate}</Text>
                    <Text style={s.historyDesc}>
                      거절{data.rejection_reason ? `: ${data.rejection_reason}` : ""}
                    </Text>
                  </View>
                </View>
              )}
              <View style={s.historyItem}>
                <View style={[s.historyDot, { backgroundColor: "#64748B" }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.historyDate}>{requestedDate}</Text>
                  <Text style={s.historyDesc}>가입 요청</Text>
                </View>
              </View>
            </View>
          </View>
        )}

      </ScrollView>

      {/* ── 거절 모달 ── */}
      <Modal visible={showRejectModal} transparent animationType="slide" onRequestClose={() => setShowRejectModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <Pressable style={s.modalOverlay} onPress={() => setShowRejectModal(false)}>
            <Pressable style={[s.modalSheet, { paddingBottom: insets.bottom + 24 }]} onPress={e => e.stopPropagation()}>
              <View style={s.modalHandle} />
              <Text style={s.modalTitle}>거절 사유 선택</Text>
              <Text style={s.modalDesc}>{data.name} 선생님의 가입 요청을 거절합니다.</Text>

              <View style={s.presetList}>
                {REJECT_PRESETS.map(p => (
                  <Pressable
                    key={p}
                    style={[s.presetItem, rejectPreset === p && { backgroundColor: "#F9DEDA", borderColor: "#D96C6C" }]}
                    onPress={() => { setRejectPreset(p); setRejectError(""); }}
                  >
                    <View style={[s.presetRadio, rejectPreset === p && { borderColor: "#D96C6C" }]}>
                      {rejectPreset === p && <View style={[s.presetRadioInner, { backgroundColor: "#D96C6C" }]} />}
                    </View>
                    <Text style={[s.presetTxt, rejectPreset === p && { color: "#D96C6C", fontWeight: "700" }]}>{p}</Text>
                  </Pressable>
                ))}
              </View>

              {rejectPreset === "직접 입력" && (
                <TextInput
                  style={[s.customInput, { borderColor: rejectError ? "#D96C6C" : C.border }]}
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
                  <CircleAlert size={13} color="#D96C6C" />
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

      {/* ── 거절 사유 보기 모달 ── */}
      <Modal visible={showRejectReasonModal} transparent animationType="fade" onRequestClose={() => setShowRejectReasonModal(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setShowRejectReasonModal(false)}>
          <Pressable style={[s.reasonSheet, { paddingBottom: insets.bottom + 24 }]} onPress={e => e.stopPropagation()}>
            <View style={[s.reasonIconWrap, { backgroundColor: "#F9DEDA" }]}>
              <CircleX size={28} color="#D96C6C" />
            </View>
            <Text style={s.reasonTitle}>거절 사유</Text>
            {rejectedDate && (
              <Text style={s.reasonDate}>{rejectedDate}</Text>
            )}
            <View style={[s.reasonBox, { backgroundColor: "#FEF2F2", borderColor: "#FECACA" }]}>
              <Text style={s.reasonTxt}>
                {data.rejection_reason || "사유가 기록되지 않았습니다."}
              </Text>
            </View>
            <Pressable
              style={({ pressed }) => [s.reasonCloseBtn, { backgroundColor: C.border, opacity: pressed ? 0.7 : 1 }]}
              onPress={() => setShowRejectReasonModal(false)}
            >
              <Text style={[s.reasonCloseTxt, { color: C.text }]}>닫기</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ── 서브 컴포넌트 ──────────────────────────────────────────────────────

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={s.infoRow}>
      <LucideIcon name={icon as any} size={13} color={C.textMuted} style={{ marginTop: 1 }} />
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue}>{value}</Text>
    </View>
  );
}

function StatBox({ label, value, icon, color }: { label: string; value: number; icon: string; color: string }) {
  return (
    <View style={[s.statBox, { backgroundColor: C.card }]}>
      <View style={[s.statIconBox, { backgroundColor: color + "18" }]}>
        <LucideIcon name={icon as any} size={18} color={color} />
      </View>
      <Text style={[s.statValue, { color }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root:              { flex: 1, backgroundColor: C.background },
  scroll:            { padding: 16, gap: 16, paddingBottom: 48 },

  statusBanner:      { borderRadius: 14, padding: 14, gap: 4 },
  statusBannerTxt:   { fontSize: 16, fontFamily: "Pretendard-SemiBold" },
  statusBannerSub:   { fontSize: 12, fontFamily: "Pretendard-Regular", opacity: 0.85 },

  section:           { backgroundColor: C.card, borderRadius: 16, padding: 16, gap: 10 },
  sectionTitle:      { fontSize: 13, fontFamily: "Pretendard-Medium", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  sectionDesc:       { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted },
  required:          { color: "#D96C6C", fontFamily: "Pretendard-Medium" },

  infoRow:           { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  infoLabel:         { fontSize: 13, fontFamily: "Pretendard-Medium", color: C.textSecondary, width: 72 },
  infoValue:         { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text, flex: 1 },

  statsGrid:         { flexDirection: "row", gap: 10 },
  statBox:           { flex: 1, borderRadius: 12, padding: 14, alignItems: "center", gap: 6, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  statIconBox:       { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  statValue:         { fontSize: 24, fontFamily: "Pretendard-SemiBold" },
  statLabel:         { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },

  roleCard:          { flexDirection: "row", alignItems: "flex-start", gap: 12, backgroundColor: "#F1F5F9", borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: C.border },
  roleIconBox:       { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  roleLabel:         { fontSize: 14, fontFamily: "Pretendard-Medium", color: C.text, marginBottom: 2 },
  roleDesc:          { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, lineHeight: 16 },
  radioOuter:        { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: C.border, alignItems: "center", justifyContent: "center", marginTop: 2 },
  radioInner:        { width: 10, height: 10, borderRadius: 5 },

  warnBox:           { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: 10, padding: 10 },
  warnTxt:           { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#92400E", flex: 1, lineHeight: 18 },

  actionRow:         { flexDirection: "row", gap: 10, marginTop: 4 },
  rejectBtn:         { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: "#D96C6C", backgroundColor: "#FFF5F5" },
  rejectBtnTxt:      { fontSize: 14, fontFamily: "Pretendard-Medium", color: "#D96C6C" },
  rejectReasonBtn:   { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: C.border, backgroundColor: "#F1F5F9" },
  rejectReasonBtnTxt:{ fontSize: 13, fontFamily: "Pretendard-Medium", color: "#64748B" },
  approveBtn:        { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14 },
  approveBtnTxt:     { fontSize: 14, fontFamily: "Pretendard-Medium", color: "#fff" },

  historyList:       { gap: 12 },
  historyItem:       { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  historyDot:        { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  historyDate:       { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, marginBottom: 2 },
  historyDesc:       { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text },

  errorState:        { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  errorTitle:        { fontSize: 17, fontFamily: "Pretendard-Medium", color: C.text },
  errorDesc:         { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, textAlign: "center" },
  backBtn:           { paddingHorizontal: 28, paddingVertical: 12, borderRadius: 12, marginTop: 8 },
  backBtnTxt:        { fontSize: 14, fontFamily: "Pretendard-Medium", color: "#fff" },

  modalOverlay:      { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  modalSheet:        { backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 12 },
  modalHandle:       { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: "center", marginBottom: 4 },
  modalTitle:        { fontSize: 17, fontFamily: "Pretendard-SemiBold", color: C.text },
  modalDesc:         { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  presetList:        { gap: 8 },
  presetItem:        { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.background },
  presetRadio:       { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: C.border, alignItems: "center", justifyContent: "center" },
  presetRadioInner:  { width: 8, height: 8, borderRadius: 4 },
  presetTxt:         { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text, flex: 1 },
  customInput:       { borderWidth: 1.5, borderRadius: 12, padding: 12, fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text, minHeight: 80, textAlignVertical: "top" },
  errorRow:          { flexDirection: "row", alignItems: "center", gap: 6 },
  errorTxt:          { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#D96C6C", flex: 1 },
  modalActions:      { flexDirection: "row", gap: 10, marginTop: 4 },
  modalCancelBtn:    { flex: 1, height: 50, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  modalCancelTxt:    { fontSize: 14, fontFamily: "Pretendard-Medium" },
  modalRejectBtn:    { flex: 1, height: 50, borderRadius: 12, backgroundColor: "#D96C6C", alignItems: "center", justifyContent: "center" },
  modalRejectTxt:    { fontSize: 14, fontFamily: "Pretendard-Medium", color: "#fff" },

  reasonSheet:       { backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 14, alignItems: "center" },
  reasonIconWrap:    { width: 60, height: 60, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  reasonTitle:       { fontSize: 18, fontFamily: "Pretendard-SemiBold", color: C.text },
  reasonDate:        { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted },
  reasonBox:         { width: "100%", borderRadius: 12, borderWidth: 1, padding: 16 },
  reasonTxt:         { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#991B1B", lineHeight: 22 },
  reasonCloseBtn:    { width: "100%", height: 50, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 4 },
  reasonCloseTxt:    { fontSize: 15, fontFamily: "Pretendard-Medium" },
});
