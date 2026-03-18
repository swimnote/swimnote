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

const C = Colors.light;

// ── 타입 ───────────────────────────────────────────────────────
interface JoinRequest {
  id: string; swimming_pool_id: string; parent_name: string; phone: string;
  request_status: "pending" | "approved" | "rejected";
  requested_at: string; processed_at?: string | null;
  rejection_reason?: string | null; parent_account_id?: string | null;
  child_name?: string | null; child_birth_year?: number | null;
  children_requested?: Array<{ childName: string; childBirthYear: number | null }> | null;
}

interface TeacherInvite {
  id: string; name: string; phone: string; position: string | null;
  invite_token: string | null; invite_status: string;
  created_at: string; requested_at: string | null;
  approved_at: string | null; user_email: string | null;
}

interface StudentOption {
  id: string;
  name: string;
  birth_year?: string | null;
  parent_phone?: string | null;
  schedule_labels?: string | null;
  assigned_class_ids?: string[];
}

type MainTab   = "parents" | "teachers";
type StatusFilter = "pending" | "approved" | "rejected";

// ── 필터칩 정의 (고정) ──────────────────────────────────────────
const FILTER_CHIPS: FilterChipItem<StatusFilter>[] = [
  { key: "pending",  label: "대기",   icon: "clock",        activeColor: STATUS_COLORS.pending.color,  activeBg: STATUS_COLORS.pending.bg  },
  { key: "approved", label: "승인",   icon: "check-circle", activeColor: STATUS_COLORS.approved.color, activeBg: STATUS_COLORS.approved.bg },
  { key: "rejected", label: "거절됨", icon: "x-circle",     activeColor: STATUS_COLORS.rejected.color, activeBg: STATUS_COLORS.rejected.bg },
];

// ── 학생 연결 모달 ────────────────────────────────────────────────
function StudentLinkModal({
  request,
  token,
  onConfirm,
  onCancel,
}: {
  request: JoinRequest;
  token: string | null;
  onConfirm: (opts: { link_student_id?: string; create_student?: boolean; child_name?: string; child_birth_year?: string }) => void;
  onCancel: () => void;
}) {
  const [students, setStudents]     = useState<StudentOption[]>([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState("");
  const [selected, setSelected]     = useState<string | null>(null);
  const [mode, setMode]             = useState<"select" | "create" | null>(null);

  // 자녀 이름/출생년도 추출
  const children: Array<{ childName: string; childBirthYear: number | null }> =
    Array.isArray(request.children_requested) && request.children_requested.length > 0
      ? request.children_requested
      : request.child_name ? [{ childName: request.child_name, childBirthYear: request.child_birth_year ?? null }] : [];
  const firstChild = children[0];

  const [childName, setChildName] = useState(firstChild?.childName || "");
  const [childBirthYear, setChildBirthYear] = useState(firstChild?.childBirthYear ? String(firstChild.childBirthYear) : "");

  useEffect(() => {
    async function loadStudents() {
      try {
        const res = await apiRequest(token, "/students");
        if (res.ok) {
          const data = await res.json();
          setStudents(Array.isArray(data) ? data : []);
        }
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    }
    loadStudents();
  }, [token]);

  const filtered = students.filter(s => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return s.name.toLowerCase().includes(q) ||
      (s.birth_year || "").includes(q) ||
      (s.parent_phone || "").includes(q);
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

          {/* 요청 정보 요약 */}
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

          {/* 연결 방식 선택 */}
          <Text style={lm.sectionLabel}>연결 방식 선택</Text>
          <View style={lm.modeRow}>
            <Pressable
              style={[lm.modeBtn, mode === "select" && { borderColor: C.tint, backgroundColor: C.tintLight }]}
              onPress={() => setMode("select")}
            >
              <Feather name="link" size={16} color={mode === "select" ? C.tint : C.textSecondary} />
              <Text style={[lm.modeBtnText, mode === "select" && { color: C.tint }]}>기존 학생 연결</Text>
            </Pressable>
            <Pressable
              style={[lm.modeBtn, mode === "create" && { borderColor: "#7C3AED", backgroundColor: "#EDE9FE" }]}
              onPress={() => setMode("create")}
            >
              <Feather name="user-plus" size={16} color={mode === "create" ? "#7C3AED" : C.textSecondary} />
              <Text style={[lm.modeBtnText, mode === "create" && { color: "#7C3AED" }]}>신규 학생 생성</Text>
            </Pressable>
          </View>

          {/* 기존 학생 선택 */}
          {mode === "select" && (
            <View style={lm.studentList}>
              <View style={[lm.searchRow, { borderColor: C.border }]}>
                <Feather name="search" size={14} color={C.textMuted} />
                <TextInput
                  style={[lm.searchInput, { color: C.text }]}
                  value={search}
                  onChangeText={setSearch}
                  placeholder="학생 이름·전화번호 검색"
                  placeholderTextColor={C.textMuted}
                />
              </View>
              {loading ? (
                <ActivityIndicator color={C.tint} style={{ marginTop: 16 }} />
              ) : (
                <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
                  {filtered.length === 0 ? (
                    <Text style={lm.emptyText}>검색 결과가 없습니다</Text>
                  ) : filtered.map(s => (
                    <Pressable
                      key={s.id}
                      style={[lm.studentRow, selected === s.id && { borderColor: C.tint, backgroundColor: C.tintLight }]}
                      onPress={() => setSelected(s.id)}
                    >
                      <View style={[lm.sAvatar, { backgroundColor: C.tintLight }]}>
                        <Text style={[lm.sAvatarText, { color: C.tint }]}>{s.name[0]}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={lm.sName}>{s.name}</Text>
                        <Text style={lm.sSub}>
                          {s.birth_year ? `${s.birth_year}년생` : ""}
                          {s.parent_phone ? ` · ${s.parent_phone}` : ""}
                          {s.schedule_labels ? ` · ${s.schedule_labels}` : ""}
                        </Text>
                      </View>
                      {selected === s.id && <Feather name="check-circle" size={20} color={C.tint} />}
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </View>
          )}

          {/* 신규 학생 생성 */}
          {mode === "create" && (
            <View style={lm.createForm}>
              <Text style={lm.fieldLabel}>학생 이름 *</Text>
              <TextInput
                style={[lm.fieldInput, { borderColor: C.border, color: C.text }]}
                value={childName}
                onChangeText={setChildName}
                placeholder="학생 이름"
                placeholderTextColor={C.textMuted}
              />
              <Text style={[lm.fieldLabel, { marginTop: 10 }]}>출생년도</Text>
              <TextInput
                style={[lm.fieldInput, { borderColor: C.border, color: C.text }]}
                value={childBirthYear}
                onChangeText={setChildBirthYear}
                placeholder="예: 2015"
                placeholderTextColor={C.textMuted}
                keyboardType="number-pad"
                maxLength={4}
              />
              <View style={lm.createNote}>
                <Feather name="info" size={12} color={C.textMuted} />
                <Text style={lm.createNoteText}>보호자 정보(이름·전화번호)는 요청에서 자동 입력됩니다.</Text>
              </View>
            </View>
          )}

          {/* 안내: 연결 없이 승인 */}
          {mode === null && (
            <View style={lm.skipNote}>
              <Feather name="info" size={13} color="#6B7280" />
              <Text style={lm.skipNoteText}>연결 방식을 선택하지 않으면 학부모 계정만 생성되고 학생 연결은 나중에 회원관리에서 진행할 수 있습니다.</Text>
            </View>
          )}

          {/* 버튼 */}
          <View style={lm.btnRow}>
            <Pressable style={[lm.btn, { backgroundColor: C.background, borderWidth: 1, borderColor: C.border }]} onPress={onCancel}>
              <Text style={[lm.btnText, { color: C.textSecondary }]}>취소</Text>
            </Pressable>
            <Pressable style={[lm.btn, { backgroundColor: mode === "create" ? "#7C3AED" : C.tint }]} onPress={handleConfirm}>
              <Text style={[lm.btnText, { color: "#fff" }]}>
                {mode === "select" ? "연결 후 승인" : mode === "create" ? "생성 후 승인" : "그냥 승인"}
              </Text>
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

// ── 선생님 승인 역할 선택 모달 ──────────────────────────────────
interface TeacherRoleSelectModalProps {
  visible: boolean;
  teacherName: string;
  selectedRoles: string[];
  onToggle: (role: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}
function TeacherRoleSelectModal({ visible, teacherName, selectedRoles, onToggle, onConfirm, onCancel, loading }: TeacherRoleSelectModalProps) {
  const ROLE_OPTIONS = [
    { key: "teacher",   label: "선생님",  desc: "수업·출결·일지 관리",        color: "#0891B2" },
    { key: "sub_admin", label: "부관리자", desc: "수영장 운영 보조 관리",       color: "#6366F1" },
  ];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={rm.overlay} onPress={onCancel}>
        <Pressable style={rm.sheet} onPress={e => e.stopPropagation()}>
          <View style={rm.header}>
            <Feather name="user-check" size={20} color="#059669" />
            <Text style={rm.title}>승인 및 권한 설정</Text>
          </View>
          <Text style={rm.sub}>
            <Text style={{ fontFamily: "Inter_600SemiBold", color: C.text }}>{teacherName}</Text>
            {"님에게 부여할 권한을 선택하세요"}
          </Text>
          <View style={rm.optionList}>
            {ROLE_OPTIONS.map(opt => {
              const checked = selectedRoles.includes(opt.key);
              return (
                <Pressable
                  key={opt.key}
                  style={[rm.optionRow, checked && { borderColor: opt.color, backgroundColor: opt.color + "0A" }]}
                  onPress={() => onToggle(opt.key)}
                >
                  <View style={[rm.checkbox, checked && { backgroundColor: opt.color, borderColor: opt.color }]}>
                    {checked && <Feather name="check" size={12} color="#fff" />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[rm.optLabel, { color: checked ? opt.color : C.text }]}>{opt.label}</Text>
                    <Text style={rm.optDesc}>{opt.desc}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <View style={rm.btnRow}>
            <Pressable style={[rm.btn, rm.cancelBtn]} onPress={onCancel}>
              <Text style={rm.cancelText}>취소</Text>
            </Pressable>
            <Pressable
              style={[rm.btn, rm.confirmBtn, (loading || selectedRoles.length === 0) && { opacity: 0.5 }]}
              onPress={onConfirm}
              disabled={loading || selectedRoles.length === 0}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={rm.confirmText}>승인 완료</Text>
              }
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const rm = StyleSheet.create({
  overlay:     { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", padding: 24 },
  sheet:       { backgroundColor: "#fff", borderRadius: 24, padding: 24, width: "100%", gap: 16 },
  header:      { flexDirection: "row", alignItems: "center", gap: 8 },
  title:       { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text },
  sub:         { fontSize: 14, fontFamily: "Inter_400Regular", color: C.textSecondary, lineHeight: 20 },
  optionList:  { gap: 10 },
  optionRow:   { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1.5, borderColor: C.border, borderRadius: 14, padding: 14 },
  checkbox:    { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: C.border, alignItems: "center", justifyContent: "center" },
  optLabel:    { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  optDesc:     { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  btnRow:      { flexDirection: "row", gap: 10, marginTop: 4 },
  btn:         { flex: 1, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  cancelBtn:   { backgroundColor: "#F3F4F6" },
  cancelText:  { fontSize: 15, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  confirmBtn:  { backgroundColor: "#059669" },
  confirmText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});

// ── 메인 컴포넌트 ───────────────────────────────────────────────
export default function ApprovalsScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();

  const [mainTab,  setMainTab]  = useState<MainTab>("parents");
  const [filter,   setFilter]   = useState<StatusFilter>("pending");
  const [joinReqs, setJoinReqs] = useState<JoinRequest[]>([]);
  const [invites,  setInvites]  = useState<TeacherInvite[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  // 학생 연결 모달
  const [linkTarget, setLinkTarget] = useState<JoinRequest | null>(null);
  // 선생님 승인 역할 선택 모달
  const [roleSelectTarget, setRoleSelectTarget] = useState<TeacherInvite | null>(null);
  const [approveRoles, setApproveRoles] = useState<string[]>(["teacher"]);

  // ── 데이터 로드 ───────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const [jrRes, iRes] = await Promise.all([
        apiRequest(token, "/admin/parent-requests"),
        apiRequest(token, "/admin/teacher-invites"),
      ]);
      if (jrRes.ok) { const d = await jrRes.json(); setJoinReqs(d.data ?? []); }
      if (iRes.ok)  { const d = await iRes.json();  setInvites(d.data  ?? []); }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // ── 학부모 승인 (학생 연결 포함) ──────────────────────────────
  async function handleJoinApprove(reqId: string, opts: {
    link_student_id?: string;
    create_student?: boolean;
    child_name?: string;
    child_birth_year?: string;
  }) {
    setLinkTarget(null);
    setProcessingId(reqId);
    try {
      const body: any = { action: "approve", ...opts };
      const res = await apiRequest(token, `/admin/parent-requests/${reqId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) { Alert.alert("오류", d.message || "처리 중 오류가 발생했습니다."); return; }

      let msg = "학부모 계정이 생성되었습니다.";
      if (d.default_pin) msg += `\n초기 PIN: ${d.default_pin} (학부모에게 전달해 주세요)`;
      if (d.linked_student_id) msg += "\n학생과 연결이 완료되었습니다.";
      Alert.alert("승인 완료", msg);
      await load();
    } finally { setProcessingId(null); }
  }

  // ── 학부모 거절 ───────────────────────────────────────────────
  async function handleJoinReject(reqId: string, reason?: string) {
    setProcessingId(reqId);
    try {
      const res = await apiRequest(token, `/admin/parent-requests/${reqId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "reject", rejection_reason: reason }),
      });
      const d = await res.json();
      if (!res.ok) { Alert.alert("오류", d.message || "처리 중 오류가 발생했습니다."); return; }
      setRejectTargetId(null);
      await load();
    } finally { setProcessingId(null); }
  }

  // ── 선생님 승인/거절 ──────────────────────────────────────────
  async function handleInviteAction(inviteId: string, action: "approve" | "reject", reason?: string, roles?: string[]) {
    setProcessingId(inviteId);
    try {
      const body: any = { action, rejection_reason: reason };
      if (action === "approve" && roles) body.roles = roles;
      const res = await apiRequest(token, `/admin/teacher-invites/${inviteId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) Alert.alert("오류", d.message || "처리 중 오류 발생");
      else {
        setRoleSelectTarget(null);
        await load();
      }
      setRejectTargetId(null);
    } finally { setProcessingId(null); }
  }

  // ── 역할 선택 모달 토글 ──────────────────────────────────────
  function toggleApproveRole(role: string) {
    setApproveRoles(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
    );
  }

  function openRoleSelect(inv: TeacherInvite) {
    setApproveRoles(["teacher"]);
    setRoleSelectTarget(inv);
  }

  // ── 필터링 ───────────────────────────────────────────────────
  const filteredParents = joinReqs.filter(r => r.request_status === filter);
  const filteredTeachers = invites.filter(i => {
    if (filter === "pending")  return i.invite_status === "joinedPendingApproval";
    if (filter === "approved") return i.invite_status === "approved";
    if (filter === "rejected") return i.invite_status === "rejected";
    return false;
  });

  const pendingParentsCnt  = joinReqs.filter(r => r.request_status === "pending").length;
  const pendingTeachersCnt = invites.filter(i => i.invite_status === "joinedPendingApproval").length;

  // ── 필터칩에 카운트 주입 ────────────────────────────────────────
  function chipsWithCount(): FilterChipItem<StatusFilter>[] {
    return FILTER_CHIPS.map(chip => {
      let cnt = 0;
      if (mainTab === "parents") {
        cnt = joinReqs.filter(r => r.request_status === chip.key).length;
      } else {
        cnt = invites.filter(i => {
          if (chip.key === "pending")  return i.invite_status === "joinedPendingApproval";
          if (chip.key === "approved") return i.invite_status === "approved";
          if (chip.key === "rejected") return i.invite_status === "rejected";
          return false;
        }).length;
      }
      return { ...chip, count: cnt };
    });
  }

  // ── 학부모 카드 빌더 ──────────────────────────────────────────
  function buildParentMeta(req: JoinRequest): ApprovalCardMeta {
    const isPending = req.request_status === "pending";
    return {
      id:              req.id,
      name:            req.parent_name,
      sub1:            req.phone,
      requestedAt:     req.requested_at,
      statusKey:       req.request_status,
      avatarInitial:   req.parent_name[0],
      rejectionReason: req.rejection_reason ?? undefined,
      showActions:     isPending,
      processing:      processingId === req.id,
    };
  }

  function buildParentExtra(req: JoinRequest) {
    const list = req.children_requested && req.children_requested.length > 0
      ? req.children_requested
      : (req.child_name ? [{ childName: req.child_name, childBirthYear: req.child_birth_year }] : []);
    if (!list.length) return null;
    return (
      <View style={x.childBox}>
        <Text style={x.childTitle}>자녀 정보</Text>
        {list.map((c, i) => (
          <View key={i} style={x.childRow}>
            <Text style={x.childName}>{c.childName}</Text>
            {c.childBirthYear ? <Text style={x.childYear}>{c.childBirthYear}년생</Text> : null}
          </View>
        ))}
      </View>
    );
  }

  // ── 선생님 카드 빌더 ──────────────────────────────────────────
  function buildTeacherMeta(inv: TeacherInvite): ApprovalCardMeta {
    const isPending = inv.invite_status === "joinedPendingApproval";
    const statusMap: Record<string, ApprovalCardMeta["statusKey"]> = {
      joinedPendingApproval: "waitingApproval",
      approved:              "approved",
      rejected:              "rejected",
      invited:               "invited",
    };
    return {
      id:          inv.id,
      name:        inv.name,
      sub1:        inv.phone,
      sub2:        [inv.position, inv.user_email].filter(Boolean).join(" · ") || undefined,
      requestedAt: inv.requested_at ?? inv.created_at,
      statusKey:   statusMap[inv.invite_status] ?? "inactive",
      avatarIcon:  "user",
      showActions: isPending,
      processing:  processingId === inv.id,
    };
  }

  // ── 거절 모달 핸들러 ──────────────────────────────────────────
  const isParentTarget = rejectTargetId ? joinReqs.some(r => r.id === rejectTargetId) : false;
  function handleRejectConfirm(reason: string) {
    if (!rejectTargetId) return;
    if (isParentTarget) handleJoinReject(rejectTargetId, reason);
    else                handleInviteAction(rejectTargetId, "reject", reason);
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

  // ── 렌더 ─────────────────────────────────────────────────────
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
          contentContainerStyle={[
            s.list,
            { paddingBottom: insets.bottom + 100 },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={
            <EmptyState
              icon={isParentTab ? "users" : "send"}
              title={
                filter === "pending"  ? "대기 중인 요청이 없습니다" :
                filter === "approved" ? "승인된 내역이 없습니다"   :
                                        "거절된 내역이 없습니다"
              }
              subtitle="상단 필터에서 다른 상태를 선택해보세요"
            />
          }
          renderItem={({ item }) => {
            if (isParentTab) {
              const req = item as JoinRequest;
              return (
                <ApprovalCard
                  meta={buildParentMeta(req)}
                  extra={buildParentExtra(req)}
                  onApprove={() => setLinkTarget(req)}
                  onReject={() => setRejectTargetId(req.id)}
                />
              );
            } else {
              const inv = item as TeacherInvite;
              return (
                <ApprovalCard
                  meta={buildTeacherMeta(inv)}
                  onApprove={() => openRoleSelect(inv)}
                  onReject={() => setRejectTargetId(inv.id)}
                />
              );
            }
          }}
        />
      </ScreenLayout>

      {/* 학생 연결 모달 */}
      {linkTarget && (
        <StudentLinkModal
          request={linkTarget}
          token={token}
          onConfirm={(opts) => handleJoinApprove(linkTarget.id, opts)}
          onCancel={() => setLinkTarget(null)}
        />
      )}

      {/* 거절 사유 모달 */}
      <RejectModal
        visible={!!rejectTargetId}
        onClose={() => setRejectTargetId(null)}
        onConfirm={handleRejectConfirm}
        loading={!!processingId}
      />

      {/* 선생님 승인 역할 선택 모달 */}
      <TeacherRoleSelectModal
        visible={!!roleSelectTarget}
        teacherName={roleSelectTarget?.name ?? ""}
        selectedRoles={approveRoles}
        onToggle={toggleApproveRole}
        onConfirm={() => {
          if (roleSelectTarget) {
            handleInviteAction(roleSelectTarget.id, "approve", undefined, approveRoles);
          }
        }}
        onCancel={() => setRoleSelectTarget(null)}
        loading={!!processingId}
      />
    </>
  );
}

// 자녀 정보 extra 스타일
const x = StyleSheet.create({
  childBox:  { gap: 6 },
  childTitle:{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: C.textSecondary, marginBottom: 2 },
  childRow:  { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  childName: { fontSize: 13, fontFamily: "Inter_500Medium", color: C.text },
  childYear: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted },
});

const s = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
});
