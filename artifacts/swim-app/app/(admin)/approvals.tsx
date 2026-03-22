import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Modal, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { ScreenLayout }  from "@/components/common/ScreenLayout";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { MainTabs }      from "@/components/common/MainTabs";
import { FilterChips, FilterChipItem } from "@/components/common/FilterChips";
import { EmptyState }    from "@/components/common/EmptyState";
import { ApprovalCard, ApprovalCardMeta } from "@/components/approval/ApprovalCard";
import { RejectModal }   from "@/components/common/RejectModal";
import { STATUS_COLORS } from "@/components/common/constants";
import {
  useParentJoinStore, type ParentJoinRequest, type JoinStatus, type MatchStatus,
} from "@/store/parentJoinStore";

const C = Colors.light;

// ── 타입 ───────────────────────────────────────────────────────
interface JoinRequest {
  id: string; swimming_pool_id: string; parent_name: string; phone: string;
  request_status: "pending" | "approved" | "rejected" | "revoked";
  requested_at: string; processed_at?: string | null;
  rejection_reason?: string | null; parent_account_id?: string | null;
  child_name?: string | null; child_birth_year?: number | null;
  children_requested?: Array<{ childName: string; childBirthYear: number | null }> | null;
  login_id?: string | null;
}

// 매칭 상태 설정
const MATCH_CFG: Record<MatchStatus, { label: string; color: string; bg: string; icon: string }> = {
  full_match:  { label: "자동 일치", color: "#059669", bg: "#D1FAE5", icon: "zap"         },
  phone_only:  { label: "번호만 일치", color: "#D97706", bg: "#FEF3C7", icon: "phone"     },
  no_match:    { label: "미일치",    color: "#6B7280", bg: "#F3F4F6", icon: "alert-circle" },
};

const JOIN_STATUS_CFG: Record<JoinStatus, { label: string }> = {
  auto_approved: { label: "자동 승인" },
  approved:      { label: "승인됨"   },
  pending:       { label: "대기 중"  },
  on_hold:       { label: "보류"     },
  rejected:      { label: "거절됨"   },
};

interface TeacherInvite {
  id: string; name: string; phone: string; position: string | null;
  invite_token: string | null; invite_status: string;
  created_at: string; requested_at: string | null;
  approved_at: string | null; user_email: string | null;
  user_id: string | null;
  user_roles?: string[] | null;
}

interface TeacherDetail {
  id: string; name: string; phone: string; position: string | null;
  invite_status: string; approved_at: string | null;
  user_email: string | null; user_id: string | null;
  user_roles: string[]; is_activated: boolean;
  class_count: number; member_count: number;
}

interface StudentOption {
  id: string; name: string;
  birth_year?: string | null; parent_phone?: string | null;
  schedule_labels?: string | null; assigned_class_ids?: string[];
}

type MainTab   = "parents" | "teachers";
type StatusFilter = "pending" | "approved" | "rejected";

function parseRoles(roles: any): string[] {
  if (Array.isArray(roles)) return roles;
  if (typeof roles === "string" && roles.startsWith("{")) {
    return roles.slice(1, -1).split(",").map(r => r.replace(/^"|"$/g, "").trim()).filter(Boolean);
  }
  return [];
}

const FILTER_CHIPS: FilterChipItem<StatusFilter>[] = [
  { key: "pending",  label: "대기",   icon: "clock",        activeColor: STATUS_COLORS.pending.color,  activeBg: STATUS_COLORS.pending.bg  },
  { key: "approved", label: "승인",   icon: "check-circle", activeColor: STATUS_COLORS.approved.color, activeBg: STATUS_COLORS.approved.bg },
  { key: "rejected", label: "거절됨", icon: "x-circle",     activeColor: STATUS_COLORS.rejected.color, activeBg: STATUS_COLORS.rejected.bg },
];

// ── 학생 연결 모달 ────────────────────────────────────────────────
function StudentLinkModal({
  request, token, onConfirm, onCancel,
}: {
  request: JoinRequest; token: string | null;
  onConfirm: (opts: { link_student_id?: string; create_student?: boolean; child_name?: string; child_birth_year?: string }) => void;
  onCancel: () => void;
}) {
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode]         = useState<"select" | "create" | null>(null);

  const children: Array<{ childName: string; childBirthYear: number | null }> =
    Array.isArray(request.children_requested) && request.children_requested.length > 0
      ? request.children_requested
      : request.child_name ? [{ childName: request.child_name, childBirthYear: request.child_birth_year ?? null }] : [];
  const firstChild = children[0];
  const [childName, setChildName]           = useState(firstChild?.childName || "");
  const [childBirthYear, setChildBirthYear] = useState(firstChild?.childBirthYear ? String(firstChild.childBirthYear) : "");

  useEffect(() => {
    async function loadStudents() {
      try {
        const res = await apiRequest(token, "/students");
        if (res.ok) { const data = await res.json(); setStudents(Array.isArray(data) ? data : []); }
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    }
    loadStudents();
  }, [token]);

  const filtered = students.filter(s => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return s.name.toLowerCase().includes(q) || (s.birth_year || "").includes(q) || (s.parent_phone || "").includes(q);
  });

  function handleConfirm() {
    if (mode === "select") {
      if (!selected) { Alert.alert("알림", "연결할 학생을 선택해주세요."); return; }
      onConfirm({ link_student_id: selected });
    } else if (mode === "create") {
      if (!childName.trim()) { Alert.alert("알림", "학생 이름을 입력해주세요."); return; }
      onConfirm({ create_student: true, child_name: childName.trim(), child_birth_year: childBirthYear || undefined });
    } else {
      onConfirm({});
    }
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onCancel}>
      <View style={lm.overlay}>
        <View style={lm.sheet}>
          <View style={lm.handle} />
          <View style={lm.header}>
            <Text style={lm.title}>학부모 승인 — 학생 연결</Text>
            <Pressable onPress={onCancel}><Feather name="x" size={22} color={C.textSecondary} /></Pressable>
          </View>
          <View style={lm.reqCard}>
            <Feather name="user" size={14} color={C.tint} />
            <View style={{ flex: 1 }}>
              <Text style={lm.reqName}>{request.parent_name} ({request.phone})</Text>
              {children.length > 0 && (
                <Text style={lm.reqChild}>
                  자녀: {children.map(c => `${c.childName}${c.childBirthYear ? ` (${c.childBirthYear}년생)` : ""}`).join(", ")}
                </Text>
              )}
            </View>
          </View>
          <Text style={lm.sectionLabel}>연결 방식 선택</Text>
          <View style={lm.modeRow}>
            <Pressable style={[lm.modeBtn, mode === "select" && { borderColor: C.tint, backgroundColor: C.tintLight }]} onPress={() => setMode("select")}>
              <Feather name="link" size={16} color={mode === "select" ? C.tint : C.textSecondary} />
              <Text style={[lm.modeBtnText, mode === "select" && { color: C.tint }]}>기존 학생 연결</Text>
            </Pressable>
            <Pressable style={[lm.modeBtn, mode === "create" && { borderColor: "#7C3AED", backgroundColor: "#EDE9FE" }]} onPress={() => setMode("create")}>
              <Feather name="user-plus" size={16} color={mode === "create" ? "#7C3AED" : C.textSecondary} />
              <Text style={[lm.modeBtnText, mode === "create" && { color: "#7C3AED" }]}>신규 학생 생성</Text>
            </Pressable>
          </View>
          {mode === "select" && (
            <View style={lm.studentList}>
              <View style={[lm.searchRow, { borderColor: C.border }]}>
                <Feather name="search" size={14} color={C.textMuted} />
                <TextInput style={[lm.searchInput, { color: C.text }]} value={search} onChangeText={setSearch} placeholder="학생 이름·전화번호 검색" placeholderTextColor={C.textMuted} />
              </View>
              {loading ? <ActivityIndicator color={C.tint} style={{ marginTop: 16 }} /> : (
                <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
                  {filtered.length === 0 ? <Text style={lm.emptyText}>검색 결과가 없습니다</Text> : filtered.map(s => (
                    <Pressable key={s.id} style={[lm.studentRow, selected === s.id && { borderColor: C.tint, backgroundColor: C.tintLight }]} onPress={() => setSelected(s.id)}>
                      <View style={[lm.sAvatar, { backgroundColor: C.tintLight }]}>
                        <Text style={[lm.sAvatarText, { color: C.tint }]}>{s.name[0]}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={lm.sName}>{s.name}</Text>
                        <Text style={lm.sSub}>{s.birth_year ? `${s.birth_year}년생` : ""}{s.parent_phone ? ` · ${s.parent_phone}` : ""}{s.schedule_labels ? ` · ${s.schedule_labels}` : ""}</Text>
                      </View>
                      {selected === s.id && <Feather name="check-circle" size={20} color={C.tint} />}
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </View>
          )}
          {mode === "create" && (
            <View style={lm.createForm}>
              <Text style={lm.fieldLabel}>학생 이름 *</Text>
              <TextInput style={[lm.fieldInput, { borderColor: C.border, color: C.text }]} value={childName} onChangeText={setChildName} placeholder="학생 이름" placeholderTextColor={C.textMuted} />
              <Text style={[lm.fieldLabel, { marginTop: 10 }]}>출생년도</Text>
              <TextInput style={[lm.fieldInput, { borderColor: C.border, color: C.text }]} value={childBirthYear} onChangeText={setChildBirthYear} placeholder="예: 2015" placeholderTextColor={C.textMuted} keyboardType="number-pad" maxLength={4} />
              <View style={lm.createNote}>
                <Feather name="info" size={12} color={C.textMuted} />
                <Text style={lm.createNoteText}>보호자 정보(이름·전화번호)는 요청에서 자동 입력됩니다.</Text>
              </View>
            </View>
          )}
          {mode === null && (
            <View style={lm.skipNote}>
              <Feather name="info" size={13} color="#6B7280" />
              <Text style={lm.skipNoteText}>연결 방식을 선택하지 않으면 학부모 계정만 생성되고 학생 연결은 나중에 회원관리에서 진행할 수 있습니다.</Text>
            </View>
          )}
          <View style={lm.btnRow}>
            <Pressable style={[lm.btn, { backgroundColor: C.background, borderWidth: 1, borderColor: C.border }]} onPress={onCancel}>
              <Text style={[lm.btnText, { color: C.textSecondary }]}>취소</Text>
            </Pressable>
            <Pressable style={[lm.btn, { backgroundColor: mode === "create" ? "#7C3AED" : C.tint }]} onPress={handleConfirm}>
              <Text style={[lm.btnText, { color: "#fff" }]}>{mode === "select" ? "연결 후 승인" : mode === "create" ? "생성 후 승인" : "그냥 승인"}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const lm = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 24, gap: 14, maxHeight: "85%" },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 4 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 18, fontFamily: "Inter_700Bold", color: C.text },
  reqCard: { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: C.tintLight, padding: 12, borderRadius: 12 },
  reqName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  reqChild: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  sectionLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  modeRow: { flexDirection: "row", gap: 10 },
  modeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.background },
  modeBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  studentList: { gap: 8 },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 10, height: 40 },
  searchInput: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  emptyText: { textAlign: "center", color: C.textMuted, fontSize: 13, fontFamily: "Inter_400Regular", paddingVertical: 16 },
  studentRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 12, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.background, marginBottom: 6 },
  sAvatar: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  sAvatarText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  sName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  sSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 1 },
  createForm: { gap: 4 },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: C.textSecondary },
  fieldInput: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, height: 42, fontSize: 14, fontFamily: "Inter_400Regular", backgroundColor: C.background },
  createNote: { flexDirection: "row", gap: 6, alignItems: "flex-start", marginTop: 8, backgroundColor: C.tintLight, padding: 10, borderRadius: 10 },
  createNoteText: { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, lineHeight: 16 },
  skipNote: { flexDirection: "row", gap: 8, alignItems: "flex-start", backgroundColor: "#F3F4F6", padding: 12, borderRadius: 12 },
  skipNoteText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", lineHeight: 18 },
  btnRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  btn: { flex: 1, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  btnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});

// ── 학부모 상세 팝업 ────────────────────────────────────────────
function ParentDetailModal({
  request, processing, onClose, onApprove, onReject, onRevoke,
}: {
  request: JoinRequest; processing: boolean; onClose: () => void;
  onApprove?: () => void; onReject?: () => void; onRevoke?: () => void;
}) {
  const isPending  = request.request_status === "pending";
  const isApproved = request.request_status === "approved";
  const children: Array<{ childName: string; childBirthYear: number | null }> =
    Array.isArray(request.children_requested) && request.children_requested.length > 0
      ? request.children_requested
      : request.child_name ? [{ childName: request.child_name, childBirthYear: request.child_birth_year ?? null }] : [];

  const statusLabel: Record<string, string> = {
    pending: "승인 대기", approved: "승인됨", rejected: "거절됨", revoked: "승인 해제됨",
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={pm.overlay}>
        <View style={pm.sheet}>
          <View style={pm.handle} />
          <View style={pm.header}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={[pm.headerAvatar, { backgroundColor: C.tintLight }]}>
                <Text style={[pm.headerAvatarText, { color: C.tint }]}>{request.parent_name[0]}</Text>
              </View>
              <View>
                <Text style={pm.headerName}>{request.parent_name}</Text>
                <Text style={pm.headerSub}>{statusLabel[request.request_status] ?? request.request_status}</Text>
              </View>
            </View>
            <Pressable onPress={onClose} style={pm.closeBtn}>
              <Feather name="x" size={20} color={C.textSecondary} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>
            {/* 기본 정보 */}
            <View style={pm.section}>
              <Text style={pm.sectionTitle}>기본 정보</Text>
              <InfoRow label="이름" value={request.parent_name} />
              <InfoRow label="연락처" value={request.phone} />
              {request.login_id ? <InfoRow label="아이디" value={request.login_id} /> : null}
              <InfoRow label="가입 요청일" value={new Date(request.requested_at).toLocaleDateString("ko-KR")} />
              {request.processed_at ? <InfoRow label="처리일" value={new Date(request.processed_at).toLocaleDateString("ko-KR")} /> : null}
            </View>

            {/* 자녀 정보 */}
            {children.length > 0 && (
              <View style={pm.section}>
                <Text style={pm.sectionTitle}>자녀 정보</Text>
                {children.map((c, i) => (
                  <View key={i} style={pm.childRow}>
                    <Feather name="user" size={13} color={C.tint} />
                    <Text style={pm.childText}>
                      {c.childName}{c.childBirthYear ? ` (${c.childBirthYear}년생)` : ""}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* 상태 */}
            <View style={pm.section}>
              <Text style={pm.sectionTitle}>상태</Text>
              <View style={pm.statusChip}>
                <Text style={pm.statusChipText}>{statusLabel[request.request_status] ?? request.request_status}</Text>
              </View>
            </View>
          </ScrollView>

          {/* 액션 버튼 */}
          <View style={pm.actionArea}>
            {isPending && (
              <>
                {onReject && (
                  <Pressable
                    style={[pm.actionBtn, { borderWidth: 1.5, borderColor: C.error, backgroundColor: "#fff" }]}
                    onPress={onReject} disabled={processing}
                  >
                    {processing ? <ActivityIndicator color={C.error} size="small" /> : (
                      <>
                        <Feather name="x" size={15} color={C.error} />
                        <Text style={[pm.actionBtnText, { color: C.error }]}>거절</Text>
                      </>
                    )}
                  </Pressable>
                )}
                {onApprove && (
                  <Pressable
                    style={[pm.actionBtn, { backgroundColor: C.success }]}
                    onPress={onApprove} disabled={processing}
                  >
                    {processing ? <ActivityIndicator color="#fff" size="small" /> : (
                      <>
                        <Feather name="check" size={15} color="#fff" />
                        <Text style={[pm.actionBtnText, { color: "#fff" }]}>승인</Text>
                      </>
                    )}
                  </Pressable>
                )}
              </>
            )}
            {isApproved && onRevoke && (
              <Pressable
                style={[pm.actionBtn, { flex: 1, borderWidth: 1.5, borderColor: "#DC2626", backgroundColor: "#FEF2F2" }]}
                onPress={onRevoke} disabled={processing}
              >
                {processing ? <ActivityIndicator color="#DC2626" size="small" /> : (
                  <>
                    <Feather name="user-x" size={15} color="#DC2626" />
                    <Text style={[pm.actionBtnText, { color: "#DC2626" }]}>승인 해제</Text>
                  </>
                )}
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={pm.infoRow}>
      <Text style={pm.infoLabel}>{label}</Text>
      <Text style={pm.infoValue}>{value}</Text>
    </View>
  );
}

const pm = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 24, gap: 16, maxHeight: "85%" },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 4 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerAvatar: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  headerAvatarText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  headerName: { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text },
  headerSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  closeBtn: { padding: 4 },
  section: { gap: 8, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border, marginBottom: 14 },
  sectionTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  infoLabel: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, flexShrink: 0 },
  infoValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.text, flex: 1, textAlign: "right" },
  childRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  childText: { fontSize: 14, fontFamily: "Inter_500Medium", color: C.text },
  statusChip: { alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: C.tintLight },
  statusChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.tint },
  actionArea: { flexDirection: "row", gap: 10, paddingTop: 8 },
  actionBtn: { flex: 1, height: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14 },
  actionBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});

// ── 수업 인수 모달 ────────────────────────────────────────────────
function ClassTransferModal({
  sourceName, availableTeachers, processing, onConfirm, onClose,
}: {
  sourceName: string;
  availableTeachers: Array<{ inviteId: string; userId: string; name: string; phone: string }>;
  processing: boolean;
  onConfirm: (targetUserId: string, targetName: string) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const selectedTeacher = availableTeachers.find(t => t.userId === selected);

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={tm.overlay}>
        <View style={tm.sheet}>
          <View style={tm.handle} />
          <View style={tm.header}>
            <View>
              <Text style={tm.title}>수업 인수</Text>
              <Text style={tm.sub}>{sourceName} 선생님의 담당 반·회원을 인수할 선생님을 선택하세요</Text>
            </View>
            <Pressable onPress={onClose} style={{ padding: 4 }}>
              <Feather name="x" size={20} color={C.textSecondary} />
            </Pressable>
          </View>

          {availableTeachers.length === 0 ? (
            <View style={tm.emptyBox}>
              <Feather name="users" size={32} color={C.textMuted} />
              <Text style={tm.emptyText}>인수 가능한 선생님이 없습니다</Text>
            </View>
          ) : (
            <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={false}>
              {availableTeachers.map(t => (
                <Pressable
                  key={t.userId}
                  style={[tm.teacherRow, selected === t.userId && { borderColor: C.tint, backgroundColor: C.tintLight }]}
                  onPress={() => setSelected(t.userId)}
                >
                  <View style={[tm.avatar, { backgroundColor: selected === t.userId ? C.tint : "#E5E7EB" }]}>
                    <Text style={[tm.avatarText, { color: selected === t.userId ? "#fff" : C.textSecondary }]}>
                      {t.name[0]}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[tm.teacherName, selected === t.userId && { color: C.tint }]}>{t.name}</Text>
                    <Text style={tm.teacherPhone}>{t.phone}</Text>
                  </View>
                  {selected === t.userId && <Feather name="check-circle" size={20} color={C.tint} />}
                </Pressable>
              ))}
            </ScrollView>
          )}

          <View style={tm.btnRow}>
            <Pressable style={[tm.btn, { backgroundColor: "#F3F4F6" }]} onPress={onClose}>
              <Text style={[tm.btnText, { color: C.textSecondary }]}>취소</Text>
            </Pressable>
            <Pressable
              style={[tm.btn, { backgroundColor: C.tint, opacity: (!selected || processing) ? 0.5 : 1 }]}
              onPress={() => { if (selected && selectedTeacher) onConfirm(selected, selectedTeacher.name); }}
              disabled={!selected || processing}
            >
              {processing ? <ActivityIndicator color="#fff" size="small" /> : (
                <Text style={[tm.btnText, { color: "#fff" }]}>인수 완료</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const tm = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 24, gap: 16, maxHeight: "80%" },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 4 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  title: { fontSize: 18, fontFamily: "Inter_700Bold", color: C.text },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 4, maxWidth: "90%", lineHeight: 18 },
  emptyBox: { alignItems: "center", paddingVertical: 32, gap: 10 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", color: C.textMuted },
  teacherRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: C.border, marginBottom: 8 },
  avatar: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  teacherName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  teacherPhone: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  btnRow: { flexDirection: "row", gap: 10, paddingTop: 8 },
  btn: { flex: 1, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  btnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});

// ── 선생님 상세 팝업 ────────────────────────────────────────────
function TeacherDetailModal({
  detail, processing, onClose,
  onApprove, onRejectOpen,
  onRevoke, onTransfer,
}: {
  detail: TeacherDetail | null;
  processing: boolean;
  onClose: () => void;
  onApprove?: () => void;
  onRejectOpen?: () => void;
  onRevoke?: () => void;
  onTransfer?: () => void;
}) {
  if (!detail) return null;

  const isPending   = detail.invite_status === "joinedPendingApproval";
  const isApproved  = detail.invite_status === "approved";
  const roles: string[] = parseRoles(detail.user_roles);
  const isAdminGranted = roles.includes("pool_admin");

  const roleLabel = () => {
    if (isAdminGranted) return "선생님 + 관리자권한";
    return "선생님";
  };

  const statusLabel: Record<string, string> = {
    joinedPendingApproval: "승인 대기", approved: "승인됨", rejected: "거절됨", inactive: "비활성",
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={dm.overlay}>
        <View style={dm.sheet}>
          <View style={dm.handle} />
          <View style={dm.header}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={[dm.headerAvatar, { backgroundColor: "#DBEAFE" }]}>
                <Text style={[dm.headerAvatarText, { color: "#2563EB" }]}>{detail.name[0]}</Text>
              </View>
              <View>
                <Text style={dm.headerName}>{detail.name}</Text>
                <Text style={dm.headerSub}>{statusLabel[detail.invite_status] ?? detail.invite_status}</Text>
              </View>
            </View>
            <Pressable onPress={onClose} style={{ padding: 4 }}>
              <Feather name="x" size={20} color={C.textSecondary} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>
            {/* 기본 정보 */}
            <View style={dm.section}>
              <Text style={dm.sectionTitle}>기본 정보</Text>
              <InfoRow label="이름" value={detail.name} />
              <InfoRow label="연락처" value={detail.phone} />
              {detail.user_email ? <InfoRow label="이메일" value={detail.user_email} /> : null}
              {detail.position ? <InfoRow label="직위" value={detail.position} /> : null}
              {detail.approved_at ? <InfoRow label="승인일" value={new Date(detail.approved_at).toLocaleDateString("ko-KR")} /> : null}
            </View>

            {/* 역할 및 현황 */}
            <View style={dm.section}>
              <Text style={dm.sectionTitle}>역할 및 담당</Text>
              <InfoRow label="현재 역할" value={roleLabel()} />
              <InfoRow label="담당 반" value={`${detail.class_count ?? 0}개`} />
              <InfoRow label="담당 회원" value={`${detail.member_count ?? 0}명`} />
            </View>
          </ScrollView>

          {/* 액션 버튼 */}
          <View style={dm.actionArea}>
            {isPending && (
              <>
                {onRejectOpen && (
                  <Pressable style={[dm.actionBtn, { borderWidth: 1.5, borderColor: C.error, backgroundColor: "#fff" }]} onPress={onRejectOpen} disabled={processing}>
                    {processing ? <ActivityIndicator color={C.error} size="small" /> : (
                      <>
                        <Feather name="x" size={14} color={C.error} />
                        <Text style={[dm.actionBtnText, { color: C.error }]}>거절</Text>
                      </>
                    )}
                  </Pressable>
                )}
                {onApprove && (
                  <Pressable style={[dm.actionBtn, { backgroundColor: C.success }]} onPress={onApprove} disabled={processing}>
                    {processing ? <ActivityIndicator color="#fff" size="small" /> : (
                      <>
                        <Feather name="check" size={14} color="#fff" />
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
                  <Pressable style={[dm.smBtn, { borderWidth: 1.5, borderColor: "#DC2626", backgroundColor: "#FEF2F2" }]} onPress={onRevoke} disabled={processing}>
                    {processing ? <ActivityIndicator color="#DC2626" size="small" /> : (
                      <>
                        <Feather name="user-minus" size={13} color="#DC2626" />
                        <Text style={[dm.smBtnText, { color: "#DC2626" }]}>승인 해제</Text>
                      </>
                    )}
                  </Pressable>
                )}
                {onTransfer && (
                  <Pressable style={[dm.smBtn, { backgroundColor: C.tint }]} onPress={onTransfer} disabled={processing}>
                    <Feather name="repeat" size={13} color="#fff" />
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
  headerAvatarText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  headerName: { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text },
  headerSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  section: { gap: 8, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border, marginBottom: 14 },
  sectionTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
  actionArea: { paddingTop: 8 },
  actionBtn: { flex: 1, height: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14 },
  actionBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  approvedActions: { flexDirection: "row", gap: 10, paddingBottom: 4 },
  smBtn: { height: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 12, paddingHorizontal: 16 },
  smBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});

// ── 메인 컴포넌트 ───────────────────────────────────────────────
export default function ApprovalsScreen() {
  const { token, adminUser } = useAuth();
  const insets = useSafeAreaInsets();
  const actorName = adminUser?.name ?? "관리자";

  // parentJoinStore — 학부모 탭 (로컬 스토어)
  const storeRequests    = useParentJoinStore(s => s.requests);
  const storeApprove     = useParentJoinStore(s => s.approveRequest);
  const storeReject      = useParentJoinStore(s => s.rejectRequest);
  const storeHold        = useParentJoinStore(s => s.holdRequest);

  const [mainTab,  setMainTab]  = useState<MainTab>("parents");
  const [filter,   setFilter]   = useState<StatusFilter>("pending");
  const [invites,  setInvites]  = useState<TeacherInvite[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // 거절 모달 (선생님용)
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);

  // 학부모 상세 팝업 — parentJoinStore 기반
  const [storeParentDetail, setStoreParentDetail] = useState<ParentJoinRequest | null>(null);
  // 학부모 거절 사유 모달
  const [storeRejectTargetId, setStoreRejectTargetId] = useState<string | null>(null);
  // 선생님 상세 팝업
  const [teacherDetailInvite, setTeacherDetailInvite] = useState<TeacherInvite | null>(null);
  const [teacherDetail, setTeacherDetail] = useState<TeacherDetail | null>(null);
  const [teacherDetailLoading, setTeacherDetailLoading] = useState(false);
  // 수업 인수 팝업
  const [transferSource, setTransferSource] = useState<TeacherInvite | null>(null);
  const [actionProcessing, setActionProcessing] = useState(false);

  // ── 데이터 로드 (선생님만 API) ─────────────────────────────────
  const load = useCallback(async () => {
    try {
      const iRes = await apiRequest(token, "/admin/teacher-invites");
      if (iRes.ok) { const d = await iRes.json(); setInvites(d.data ?? []); }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // ── 학부모 승인 (스토어) ──────────────────────────────────────
  function handleStoreApprove(reqId: string) {
    storeApprove(reqId, actorName);
    setStoreParentDetail(null);
    Alert.alert("승인 완료", "학부모 가입 요청이 승인되었습니다.");
  }

  // ── 학부모 거절 (스토어) ──────────────────────────────────────
  function handleStoreReject(reqId: string, reason: string) {
    storeReject(reqId, reason, actorName);
    setStoreRejectTargetId(null);
    setStoreParentDetail(null);
  }

  // ── 학부모 보류 (스토어) ──────────────────────────────────────
  function handleStoreHold(reqId: string) {
    storeHold(reqId, actorName);
    setStoreParentDetail(null);
  }

  // ── 선생님 승인/거절 ──────────────────────────────────────────
  async function handleInviteAction(inviteId: string, action: string, reason?: string) {
    setProcessingId(inviteId);
    try {
      const body: any = { action, rejection_reason: reason };
      const res = await apiRequest(token, `/admin/teacher-invites/${inviteId}`, {
        method: "PATCH", body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) Alert.alert("오류", d.message || "처리 중 오류 발생");
      else {
        setRejectTargetId(null);
        setTeacherDetailInvite(null);
        setTeacherDetail(null);
        await load();
      }
    } finally { setProcessingId(null); }
  }

  // ── 선생님 상세 보기 ──────────────────────────────────────────
  async function handleViewTeacher(inv: TeacherInvite) {
    setTeacherDetailInvite(inv);
    setTeacherDetailLoading(true);
    try {
      const res = await apiRequest(token, `/admin/teacher-invites/${inv.id}/detail`);
      if (res.ok) {
        const d = await res.json();
        setTeacherDetail(d.data);
      }
    } catch (e) { console.error(e); }
    finally { setTeacherDetailLoading(false); }
  }

  // ── 선생님 승인 해제 ──────────────────────────────────────────
  async function handleRevokeTeacher(inviteId: string) {
    setActionProcessing(true);
    try {
      const res = await apiRequest(token, `/admin/teacher-invites/${inviteId}`, {
        method: "PATCH", body: JSON.stringify({ action: "revoke" }),
      });
      const d = await res.json();
      if (!res.ok) { Alert.alert("오류", d.message || "처리 중 오류"); return; }
      setTeacherDetailInvite(null);
      setTeacherDetail(null);
      await load();
    } finally { setActionProcessing(false); }
  }

  // ── 수업 인수 ─────────────────────────────────────────────────
  async function handleTransfer(inviteId: string, targetUserId: string, targetName: string) {
    setActionProcessing(true);
    try {
      const res = await apiRequest(token, `/admin/teacher-invites/${inviteId}/transfer`, {
        method: "POST",
        body: JSON.stringify({ target_user_id: targetUserId, target_teacher_name: targetName }),
      });
      const d = await res.json();
      if (!res.ok) { Alert.alert("오류", d.message || "처리 중 오류"); return; }
      Alert.alert("완료", d.message || "수업 인수가 완료되었습니다.");
      setTransferSource(null);
      setTeacherDetailInvite(null);
      setTeacherDetail(null);
      await load();
    } finally { setActionProcessing(false); }
  }

  // ── 거절 모달 핸들러 (선생님용) ──────────────────────────────
  function handleRejectConfirm(reason: string) {
    if (!rejectTargetId) return;
    handleInviteAction(rejectTargetId, "reject", reason);
  }

  // ── 필터링 ────────────────────────────────────────────────────
  const filteredParents = storeRequests.filter(r => {
    if (filter === "pending")  return r.status === "pending" || r.status === "on_hold";
    if (filter === "approved") return r.status === "approved" || r.status === "auto_approved";
    if (filter === "rejected") return r.status === "rejected";
    return false;
  });
  const filteredTeachers = invites.filter(i => {
    if (filter === "pending")  return i.invite_status === "joinedPendingApproval";
    if (filter === "approved") return i.invite_status === "approved";
    if (filter === "rejected") return i.invite_status === "rejected" || i.invite_status === "inactive";
    return false;
  });

  const pendingParentsCnt  = storeRequests.filter(r => r.status === "pending" || r.status === "on_hold").length;
  const pendingTeachersCnt = invites.filter(i => i.invite_status === "joinedPendingApproval").length;

  function chipsWithCount(): FilterChipItem<StatusFilter>[] {
    return FILTER_CHIPS.map(chip => {
      let cnt = 0;
      if (mainTab === "parents") {
        if (chip.key === "pending")  cnt = storeRequests.filter(r => r.status === "pending" || r.status === "on_hold").length;
        if (chip.key === "approved") cnt = storeRequests.filter(r => r.status === "approved" || r.status === "auto_approved").length;
        if (chip.key === "rejected") cnt = storeRequests.filter(r => r.status === "rejected").length;
      } else {
        if (chip.key === "pending")  cnt = invites.filter(i => i.invite_status === "joinedPendingApproval").length;
        if (chip.key === "approved") cnt = invites.filter(i => i.invite_status === "approved").length;
        if (chip.key === "rejected") cnt = invites.filter(i => i.invite_status === "rejected" || i.invite_status === "inactive").length;
      }
      return { ...chip, count: cnt };
    });
  }

  // ── 학부모 카드 빌더 (parentJoinStore) ───────────────────────
  function buildStoreMeta(req: ParentJoinRequest): ApprovalCardMeta {
    const isPending = req.status === "pending" || req.status === "on_hold";
    const statusMap: Record<JoinStatus, ApprovalCardMeta["statusKey"]> = {
      pending:      "pending",
      auto_approved:"approved",
      approved:     "approved",
      on_hold:      "pending",
      rejected:     "rejected",
    };
    return {
      id:              req.id,
      name:            req.parentName,
      sub1:            `${req.parentPhone} · ${req.relation} · ${req.displayName}`,
      requestedAt:     req.createdAt,
      statusKey:       statusMap[req.status],
      avatarInitial:   req.parentName[0],
      rejectionReason: req.rejectReason,
      showActions:     isPending,
      processing:      processingId === req.id,
    };
  }

  function buildStoreExtra(req: ParentJoinRequest) {
    const mc = MATCH_CFG[req.matchStatus];
    return (
      <View style={x.childBox}>
        <View style={x.matchRow}>
          <Feather name={mc.icon as any} size={11} color={mc.color} />
          <Text style={[x.matchTxt, { color: mc.color }]}>{mc.label}</Text>
          {req.status === "auto_approved" && (
            <View style={x.autoChip}>
              <Text style={x.autoChipTxt}>자동승인</Text>
            </View>
          )}
          {req.status === "on_hold" && (
            <View style={[x.autoChip, { backgroundColor: "#FEF3C7" }]}>
              <Text style={[x.autoChipTxt, { color: "#D97706" }]}>보류</Text>
            </View>
          )}
        </View>
        <Text style={x.childTitle}>자녀 정보 ({req.children.length}명)</Text>
        {req.children.map((c, i) => (
          <View key={i} style={x.childRow}>
            <Text style={x.childName}>{c.name}</Text>
            <Text style={x.childYear}>{c.birthDate}</Text>
          </View>
        ))}
      </View>
    );
  }

  // ── 선생님 카드 빌더 ─────────────────────────────────────────
  function buildTeacherMeta(inv: TeacherInvite): ApprovalCardMeta {
    const isPending = inv.invite_status === "joinedPendingApproval";
    const statusMap: Record<string, ApprovalCardMeta["statusKey"]> = {
      joinedPendingApproval: "waitingApproval",
      approved:              "approved",
      rejected:              "rejected",
      invited:               "invited",
      inactive:              "inactive",
    };
    const roles: string[] = parseRoles(inv.user_roles);
    const isAdminGranted = roles.includes("pool_admin");
    const roleText = isAdminGranted ? "선생님+관리자권한" : "선생님";
    const positionText = [inv.position, roleText].filter(Boolean).join(" · ");

    return {
      id:          inv.id,
      name:        inv.name,
      sub1:        inv.phone,
      sub2:        [positionText, inv.user_email].filter(Boolean).join(" · ") || undefined,
      requestedAt: inv.requested_at ?? inv.created_at,
      statusKey:   statusMap[inv.invite_status] ?? "inactive",
      avatarIcon:  "user",
      showActions: isPending,
      processing:  processingId === inv.id,
    };
  }

  // ── 수업 인수 가능한 선생님 목록 ─────────────────────────────
  function getAvailableTeachersForTransfer(sourceInvite: TeacherInvite) {
    return invites
      .filter(i =>
        i.invite_status === "approved" &&
        i.user_id !== null &&
        i.user_id !== sourceInvite.user_id &&
        i.id !== sourceInvite.id
      )
      .map(i => ({ inviteId: i.id, userId: i.user_id!, name: i.name, phone: i.phone }));
  }

  // ── 공통 헤더 ─────────────────────────────────────────────────
  const header = (
    <>
      <SubScreenHeader title="승인 관리" />
      <MainTabs<MainTab>
        tabs={[
          { key: "parents",  label: "학부모 승인", badge: pendingParentsCnt  },
          { key: "teachers", label: "선생님 승인", badge: pendingTeachersCnt },
        ]}
        active={mainTab}
        onChange={key => { setMainTab(key); setFilter("pending"); }}
      />
      <FilterChips<StatusFilter>
        chips={chipsWithCount()}
        active={filter}
        onChange={setFilter}
      />
    </>
  );

  if (loading) {
    return (
      <ScreenLayout header={header}>
        <ActivityIndicator color={C.tint} style={{ marginTop: 80 }} />
      </ScreenLayout>
    );
  }

  const isParentTab = mainTab === "parents";
  const data        = isParentTab ? filteredParents : filteredTeachers;

  return (
    <>
      <ScreenLayout header={header}>
        <FlatList
          data={data}
          keyExtractor={item => item.id}
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={
            <EmptyState
              icon={isParentTab ? "users" : "send"}
              title={filter === "pending" ? "대기 중인 요청이 없습니다" : filter === "approved" ? "승인된 내역이 없습니다" : "거절된 내역이 없습니다"}
              subtitle="상단 필터에서 다른 상태를 선택해보세요"
            />
          }
          renderItem={({ item }) => {
            if (isParentTab) {
              const req = item as ParentJoinRequest;
              const isPending = req.status === "pending" || req.status === "on_hold";
              return (
                <ApprovalCard
                  meta={buildStoreMeta(req)}
                  extra={buildStoreExtra(req)}
                  onApprove={isPending ? () => handleStoreApprove(req.id) : undefined}
                  onView={() => setStoreParentDetail(req)}
                />
              );
            } else {
              const inv = item as TeacherInvite;
              return (
                <ApprovalCard
                  meta={buildTeacherMeta(inv)}
                  onApprove={() => handleInviteAction(inv.id, "approve")}
                  onView={() => handleViewTeacher(inv)}
                />
              );
            }
          }}
        />
      </ScreenLayout>

      {/* 학부모 거절 사유 모달 (스토어) */}
      <RejectModal
        visible={!!storeRejectTargetId}
        onClose={() => setStoreRejectTargetId(null)}
        onConfirm={(reason) => storeRejectTargetId && handleStoreReject(storeRejectTargetId, reason)}
        loading={false}
      />

      {/* 선생님 거절 사유 모달 */}
      <RejectModal
        visible={!!rejectTargetId}
        onClose={() => setRejectTargetId(null)}
        onConfirm={handleRejectConfirm}
        loading={!!processingId}
      />

      {/* 학부모 상세 팝업 (스토어 기반) */}
      {storeParentDetail && (() => {
        const req = storeParentDetail;
        const isPending  = req.status === "pending";
        const isOnHold   = req.status === "on_hold";
        const isApproved = req.status === "approved" || req.status === "auto_approved";
        const mc = MATCH_CFG[req.matchStatus];
        return (
          <Modal visible animationType="slide" transparent onRequestClose={() => setStoreParentDetail(null)}>
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
                  <Pressable onPress={() => setStoreParentDetail(null)} style={{ padding: 4 }}>
                    <Feather name="x" size={20} color={C.textSecondary} />
                  </Pressable>
                </View>

                <ScrollView showsVerticalScrollIndicator={false}>
                  {/* 매칭 배지 */}
                  <View style={[pd.matchBadge, { backgroundColor: mc.bg }]}>
                    <Feather name={mc.icon as any} size={13} color={mc.color} />
                    <Text style={[pd.matchTxt, { color: mc.color }]}>{mc.label}</Text>
                    {req.matchedStudentIds.length > 0 && (
                      <Text style={[pd.matchSub, { color: mc.color }]}>· {req.matchedStudentIds.length}명 연결</Text>
                    )}
                  </View>

                  {/* 보호자 정보 */}
                  <View style={pd.section}>
                    <Text style={pd.sTitle}>보호자 정보</Text>
                    <PDRow label="이름"   value={req.parentName} />
                    <PDRow label="연락처" value={req.parentPhone} />
                    <PDRow label="관계"   value={req.relation} />
                    <PDRow label="호칭"   value={req.displayName} />
                    <PDRow label="수영장" value={req.operatorName} />
                    <PDRow label="신청일" value={new Date(req.createdAt).toLocaleDateString("ko-KR")} />
                    {req.reviewedAt && <PDRow label="처리일" value={new Date(req.reviewedAt).toLocaleDateString("ko-KR")} />}
                    {req.reviewedBy && <PDRow label="처리자" value={req.reviewedBy} />}
                    {req.rejectReason && <PDRow label="거절 사유" value={req.rejectReason} />}
                  </View>

                  {/* 자녀 정보 */}
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

                {/* 액션 버튼 */}
                <View style={pd.actions}>
                  {(isPending || isOnHold) && (
                    <>
                      <Pressable style={[pd.btn, { backgroundColor: "#FEF3C7", borderColor: "#D97706", borderWidth: 1 }]}
                        onPress={() => handleStoreHold(req.id)}>
                        <Feather name="pause" size={14} color="#D97706" />
                        <Text style={[pd.btnTxt, { color: "#D97706" }]}>보류</Text>
                      </Pressable>
                      <Pressable style={[pd.btn, { backgroundColor: "#FEE2E2", borderColor: C.error, borderWidth: 1 }]}
                        onPress={() => { setStoreParentDetail(null); setStoreRejectTargetId(req.id); }}>
                        <Feather name="x" size={14} color={C.error} />
                        <Text style={[pd.btnTxt, { color: C.error }]}>거절</Text>
                      </Pressable>
                      <Pressable style={[pd.btn, { backgroundColor: C.success }]}
                        onPress={() => handleStoreApprove(req.id)}>
                        <Feather name="check" size={14} color="#fff" />
                        <Text style={[pd.btnTxt, { color: "#fff" }]}>승인</Text>
                      </Pressable>
                    </>
                  )}
                  {isApproved && (
                    <Pressable style={[pd.btn, { flex: 1, backgroundColor: "#FEE2E2", borderColor: "#DC2626", borderWidth: 1 }]}
                      onPress={() => { storeReject(req.id, "승인 해제", actorName); setStoreParentDetail(null); }}>
                      <Feather name="user-x" size={14} color="#DC2626" />
                      <Text style={[pd.btnTxt, { color: "#DC2626" }]}>승인 해제</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            </View>
          </Modal>
        );
      })()}

      {/* 선생님 상세 팝업 */}
      {teacherDetailInvite && (
        teacherDetailLoading ? (
          <Modal visible transparent animationType="fade">
            <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "rgba(0,0,0,0.3)" }}>
              <ActivityIndicator color={C.tint} size="large" />
            </View>
          </Modal>
        ) : (
          <TeacherDetailModal
            detail={teacherDetail}
            processing={actionProcessing || processingId === teacherDetailInvite.id}
            onClose={() => { setTeacherDetailInvite(null); setTeacherDetail(null); }}
            onApprove={teacherDetailInvite.invite_status === "joinedPendingApproval"
              ? () => handleInviteAction(teacherDetailInvite.id, "approve")
              : undefined}
            onRejectOpen={teacherDetailInvite.invite_status === "joinedPendingApproval"
              ? () => setRejectTargetId(teacherDetailInvite.id)
              : undefined}
            onRevoke={teacherDetailInvite.invite_status === "approved"
              ? () => handleRevokeTeacher(teacherDetailInvite.id)
              : undefined}
            onTransfer={teacherDetailInvite.invite_status === "approved"
              ? () => setTransferSource(teacherDetailInvite)
              : undefined}
          />
        )
      )}

      {/* 수업 인수 팝업 */}
      {transferSource && (
        <ClassTransferModal
          sourceName={transferSource.name}
          availableTeachers={getAvailableTeachersForTransfer(transferSource)}
          processing={actionProcessing}
          onConfirm={(targetUserId, targetName) => handleTransfer(transferSource.id, targetUserId, targetName)}
          onClose={() => setTransferSource(null)}
        />
      )}
    </>
  );
}

// 자녀 정보 extra 스타일
const x = StyleSheet.create({
  childBox:    { gap: 6 },
  matchRow:    { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 4 },
  matchTxt:    { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  autoChip:    { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, backgroundColor: "#D1FAE5" },
  autoChipTxt: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#059669" },
  childTitle:  { fontSize: 11, fontFamily: "Inter_600SemiBold", color: C.textSecondary, marginBottom: 2 },
  childRow:    { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  childName:   { fontSize: 13, fontFamily: "Inter_500Medium", color: C.text },
  childYear:   { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted },
});

// 학부모 상세 모달 스타일
const pd = StyleSheet.create({
  overlay:    { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  sheet:      { backgroundColor: C.card, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 22, gap: 14, maxHeight: "88%" },
  handle:     { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 4 },
  header:     { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  avatar:     { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  avatarTxt:  { fontSize: 18, fontFamily: "Inter_700Bold" },
  name:       { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text },
  nameSub:    { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  matchBadge: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 12 },
  matchTxt:   { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  matchSub:   { fontSize: 12, fontFamily: "Inter_400Regular" },
  section:    { gap: 8, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border, marginBottom: 12 },
  sTitle:     { fontSize: 11, fontFamily: "Inter_600SemiBold", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
  infoRow:    { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  infoLabel:  { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary },
  infoValue:  { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.text, textAlign: "right", flex: 1 },
  childRow:   { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  childNum:   { width: 24, height: 24, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  childNumTxt:{ fontSize: 11, fontFamily: "Inter_700Bold" },
  childName:  { fontSize: 14, fontFamily: "Inter_500Medium", color: C.text },
  childBirth: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary },
  actions:    { flexDirection: "row", gap: 10, paddingTop: 8 },
  btn:        { flex: 1, height: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 12 },
  btnTxt:     { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});

function PDRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={pd.infoRow}>
      <Text style={pd.infoLabel}>{label}</Text>
      <Text style={pd.infoValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
});
