import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView,
  Modal, Platform, Pressable, RefreshControl, ScrollView,
  Share, StyleSheet, Text, TextInput, View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { ScreenLayout }  from "@/components/common/ScreenLayout";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { FilterChips, FilterChipItem } from "@/components/common/FilterChips";
import { EmptyState }    from "@/components/common/EmptyState";
import {
  StudentMember, StudentFilterKey, WeeklyCount,
  WEEKLY_BADGE, getStudentAssignmentStatus, getStudentConnectionStatus,
  applyStudentFilter, searchStudents, buildInviteMessage,
  isValidPhone, isValidBirthYear, normalizePhone,
} from "@/utils/studentUtils";
import { useSelectionMode } from "@/hooks/useSelectionMode";
import { SelectionActionBar } from "@/components/admin/SelectionActionBar";

const C = Colors.light;

const FILTER_CHIPS: FilterChipItem<StudentFilterKey>[] = [
  { key: "all",          label: "전체",      icon: "list" },
  { key: "unassigned",   label: "미배정",    icon: "alert-circle",  activeColor: "#DC2626", activeBg: "#FEE2E2" },
  { key: "mismatch",     label: "배정불일치", icon: "alert-triangle", activeColor: "#D97706", activeBg: "#FEF3C7" },
  { key: "pending_link", label: "연결대기",  icon: "clock",          activeColor: "#EA580C", activeBg: "#FFF7ED" },
  { key: "weekly_1",     label: "주1회",     icon: "sun",            activeColor: WEEKLY_BADGE[1].color, activeBg: WEEKLY_BADGE[1].bg },
  { key: "weekly_2",     label: "주2회",     icon: "wind",           activeColor: WEEKLY_BADGE[2].color, activeBg: WEEKLY_BADGE[2].bg },
  { key: "weekly_3",     label: "주3회",     icon: "zap",            activeColor: WEEKLY_BADGE[3].color, activeBg: WEEKLY_BADGE[3].bg },
  { key: "linked",       label: "연결완료",  icon: "check-circle",   activeColor: "#059669", activeBg: "#D1FAE5" },
];

// ── 초대문구 보기 모달 ───────────────────────────────────────────
function InviteModal({ student, poolName, onClose }: { student: StudentMember; poolName: string; onClose: () => void }) {
  const appUrl = `https://swimnote.kr`;
  const msg = buildInviteMessage({
    poolName,
    studentName: student.name,
    inviteCode: student.invite_code || "------",
    appUrl,
  });
  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <View style={inv.overlay}>
        <View style={inv.sheet}>
          <View style={inv.header}>
            <Text style={inv.title}>📱 학부모 초대 문자</Text>
            <Pressable onPress={onClose}><Feather name="x" size={20} color={C.textSecondary} /></Pressable>
          </View>
          <View style={inv.codeRow}>
            <Text style={inv.codeLabel}>초대코드</Text>
            <Text style={inv.code}>{student.invite_code || "없음"}</Text>
          </View>
          <View style={inv.msgBox}>
            <Text style={inv.msgText}>{msg}</Text>
          </View>
          <View style={inv.btnRow}>
            <Pressable style={[inv.btn, { backgroundColor: C.tintLight }]} onPress={async () => {
              await Clipboard.setStringAsync(msg);
              Alert.alert("복사 완료", "초대 문자가 클립보드에 복사되었습니다.");
            }}>
              <Feather name="copy" size={14} color={C.tint} />
              <Text style={[inv.btnText, { color: C.tint }]}>복사하기</Text>
            </Pressable>
            <Pressable style={[inv.btn, { backgroundColor: "#D1FAE5" }]} onPress={async () => {
              await Share.share({ message: msg });
            }}>
              <Feather name="share-2" size={14} color="#059669" />
              <Text style={[inv.btnText, { color: "#059669" }]}>공유하기</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
const inv = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 20 },
  sheet: { backgroundColor: C.card, borderRadius: 20, padding: 20, gap: 14 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 16, fontFamily: "Inter_700Bold", color: C.text },
  codeRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.tintLight, padding: 12, borderRadius: 12 },
  codeLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: C.textSecondary },
  code: { fontSize: 18, fontFamily: "Inter_700Bold", color: C.tint, letterSpacing: 3 },
  msgBox: { backgroundColor: C.background, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border },
  msgText: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.text, lineHeight: 20 },
  btnRow: { flexDirection: "row", gap: 10 },
  btn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11, borderRadius: 12 },
  btnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});

// ── 중복 경고 모달 ───────────────────────────────────────────────
function DuplicateModal({
  candidates, onLinkExisting, onForceCreate, onCancel,
}: {
  candidates: any[];
  onLinkExisting: (id: string) => void;
  onForceCreate: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible animationType="fade" transparent onRequestClose={onCancel}>
      <View style={dup.overlay}>
        <View style={dup.sheet}>
          <View style={[dup.icon]}>
            <Feather name="alert-triangle" size={28} color="#D97706" />
          </View>
          <Text style={dup.title}>유사한 회원이 있습니다</Text>
          <Text style={dup.sub}>아래 회원과 동일한 학생일 수 있습니다.</Text>
          <View style={dup.list}>
            {candidates.slice(0, 3).map((c: any) => (
              <Pressable key={c.id} style={dup.row} onPress={() => onLinkExisting(c.id)}>
                <View style={[dup.avatar, { backgroundColor: C.tintLight }]}>
                  <Text style={[dup.avatarText, { color: C.tint }]}>{c.name[0]}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={dup.name}>{c.name}</Text>
                  <Text style={dup.info}>{c.birth_year ? `${c.birth_year}년생` : ""}{c.parent_phone ? ` · ${c.parent_phone}` : ""}</Text>
                </View>
                <Text style={[dup.linkBtn, { color: C.tint }]}>연결 →</Text>
              </Pressable>
            ))}
          </View>
          <View style={dup.btnRow}>
            <Pressable style={[dup.btn, { backgroundColor: "#FEF3C7" }]} onPress={onForceCreate}>
              <Text style={[dup.btnText, { color: "#92400E" }]}>새 회원으로 등록</Text>
            </Pressable>
            <Pressable style={[dup.btn, { backgroundColor: C.background, borderWidth: 1, borderColor: C.border }]} onPress={onCancel}>
              <Text style={[dup.btnText, { color: C.textSecondary }]}>취소</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
const dup = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 24 },
  sheet: { backgroundColor: C.card, borderRadius: 20, padding: 24, gap: 14, alignItems: "center" },
  icon: { width: 60, height: 60, borderRadius: 20, backgroundColor: "#FEF3C7", alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontFamily: "Inter_700Bold", color: C.text },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, textAlign: "center" },
  list: { width: "100%", gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, backgroundColor: C.background, borderWidth: 1, borderColor: C.border },
  avatar: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  name: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  info: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary },
  linkBtn: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  btnRow: { flexDirection: "row", gap: 10, width: "100%" },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center" },
  btnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});

// ── 학생 등록 모달 ───────────────────────────────────────────────
function RegisterModal({
  token, poolName, onSuccess, onClose,
}: {
  token: string | null;
  poolName: string;
  onSuccess: (student: StudentMember) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [parentName, setParentName] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [weekly, setWeekly] = useState<WeeklyCount>(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dupCandidates, setDupCandidates] = useState<any[] | null>(null);
  const [showInvite, setShowInvite] = useState<StudentMember | null>(null);
  const pendingBody = useRef<any>(null);

  function validate(): string | null {
    if (!name.trim()) return "학생 이름을 입력해주세요.";
    if (birthYear && !isValidBirthYear(birthYear)) return "출생년도가 올바르지 않습니다. (예: 2015)";
    if (parentPhone && !isValidPhone(parentPhone)) return "보호자 전화번호 형식이 올바르지 않습니다.";
    return null;
  }

  async function submit(forceCreate = false) {
    const e = validate();
    if (e) { setError(e); return; }
    setSaving(true); setError("");
    const body = {
      name: name.trim(),
      birth_year: birthYear || undefined,
      parent_name: parentName || undefined,
      parent_phone: parentPhone ? normalizePhone(parentPhone) : undefined,
      weekly_count: weekly,
      registration_path: "admin_created",
      force_create: forceCreate,
    };
    pendingBody.current = body;
    try {
      const res = await apiRequest(token, "/students", { method: "POST", body: JSON.stringify(body) });
      const data = await res.json();
      if (res.status === 409 && data.duplicate) {
        setDupCandidates([data.existing]);
        setSaving(false); return;
      }
      if (res.status === 200 && data.possible_duplicate) {
        setDupCandidates(data.candidates);
        setSaving(false); return;
      }
      if (!res.ok) { setError(data.message || "오류가 발생했습니다."); return; }
      setShowInvite(data);
      onSuccess(data);
    } catch { setError("네트워크 오류가 발생했습니다."); }
    finally { setSaving(false); }
  }

  if (showInvite) {
    return <InviteModal student={showInvite} poolName={poolName} onClose={() => { setShowInvite(null); onClose(); }} />;
  }
  if (dupCandidates) {
    return (
      <DuplicateModal
        candidates={dupCandidates}
        onLinkExisting={(id) => { setDupCandidates(null); Alert.alert("알림", "기존 회원 연결 기능은 곧 제공됩니다."); }}
        onForceCreate={() => { setDupCandidates(null); submit(true); }}
        onCancel={() => setDupCandidates(null)}
      />
    );
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={reg.overlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={[reg.sheet, { paddingBottom: 32 }]}>
          <View style={reg.handle} />
          <View style={reg.header}>
            <Text style={reg.title}>어린이 직접 등록</Text>
            <Pressable onPress={onClose}><Feather name="x" size={22} color={C.textSecondary} /></Pressable>
          </View>
          {error ? (
            <View style={reg.errorRow}>
              <Feather name="alert-circle" size={14} color={C.error} />
              <Text style={reg.errorText}>{error}</Text>
            </View>
          ) : null}
          <ScrollView showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>
            {/* 학생 이름 */}
            <View style={reg.field}>
              <Text style={reg.label}>학생 이름 *</Text>
              <TextInput style={reg.input} value={name} onChangeText={setName} placeholder="홍길동" placeholderTextColor={C.textMuted} />
            </View>
            {/* 출생년도 */}
            <View style={reg.field}>
              <Text style={reg.label}>출생년도 (중복 체크에 사용)</Text>
              <TextInput style={reg.input} value={birthYear} onChangeText={setBirthYear} placeholder="예: 2015" placeholderTextColor={C.textMuted} keyboardType="number-pad" maxLength={4} />
            </View>
            {/* 보호자 이름 */}
            <View style={reg.field}>
              <Text style={reg.label}>보호자 이름</Text>
              <TextInput style={reg.input} value={parentName} onChangeText={setParentName} placeholder="김보호 (선택)" placeholderTextColor={C.textMuted} />
            </View>
            {/* 보호자 전화 */}
            <View style={reg.field}>
              <Text style={reg.label}>보호자 전화번호 (초대 문자 발송용)</Text>
              <TextInput style={reg.input} value={parentPhone} onChangeText={setParentPhone} placeholder="010-1234-5678" placeholderTextColor={C.textMuted} keyboardType="phone-pad" />
            </View>
            {/* 주 수업 횟수 */}
            <View style={reg.field}>
              <Text style={reg.label}>주 수업 횟수</Text>
              <View style={reg.weekRow}>
                {([1, 2, 3] as WeeklyCount[]).map(w => {
                  const badge = WEEKLY_BADGE[w];
                  return (
                    <Pressable
                      key={w}
                      style={[reg.weekBtn, { backgroundColor: weekly === w ? badge.bg : C.background, borderColor: weekly === w ? badge.color : C.border }]}
                      onPress={() => setWeekly(w)}
                    >
                      <Text style={[reg.weekBtnText, { color: weekly === w ? badge.color : C.textSecondary }]}>{badge.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </ScrollView>
          <View style={reg.notice}>
            <Feather name="info" size={13} color={C.textMuted} />
            <Text style={reg.noticeText}>등록 후 초대코드가 생성됩니다. 보호자에게 전달하여 앱 연결을 유도할 수 있습니다.</Text>
          </View>
          <Pressable style={[reg.saveBtn, { backgroundColor: C.tint }]} onPress={() => submit(false)} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={reg.saveBtnText}>등록하기</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
const reg = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 24, gap: 14 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 4 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 20, fontFamily: "Inter_700Bold", color: C.text },
  errorRow: { flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: "#FEE2E2", padding: 10, borderRadius: 10 },
  errorText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: C.error },
  field: { gap: 6, marginBottom: 12 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, height: 46, fontSize: 15, fontFamily: "Inter_400Regular", color: C.text, borderColor: C.border, backgroundColor: C.background },
  weekRow: { flexDirection: "row", gap: 10 },
  weekBtn: { flex: 1, paddingVertical: 11, borderRadius: 12, borderWidth: 1.5, alignItems: "center" },
  weekBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  notice: { flexDirection: "row", gap: 6, alignItems: "flex-start", backgroundColor: C.tintLight, padding: 12, borderRadius: 12 },
  noticeText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, lineHeight: 18 },
  saveBtn: { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  saveBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
});

// ── 회원 카드 ────────────────────────────────────────────────────
function StudentCard({ student, themeColor, onPressInvite, onPressDelete, isDeleting, selectionMode, isSelected, onToggle }: {
  student: StudentMember;
  themeColor: string;
  onPressInvite: () => void;
  onPressDelete: () => void;
  isDeleting?: boolean;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggle?: () => void;
}) {
  const assignStatus = getStudentAssignmentStatus(student);
  const connStatus   = getStudentConnectionStatus(student);
  const wc = (student.weekly_count || 1) as WeeklyCount;
  const badge = WEEKLY_BADGE[wc] || WEEKLY_BADGE[1];

  // 담당 선생님 이름 (assignedClasses 에서 추출)
  const instructors = (student.assignedClasses || [])
    .map((c: any) => c.instructor)
    .filter((v: any): v is string => !!v);
  const instructorLabel = [...new Set(instructors)].join(", ");

  // 등록 경로
  const isParentRequested = student.registration_path === "parent_requested";

  return (
    <Pressable
      style={[sc.card, { backgroundColor: C.card }, isSelected && { borderWidth: 2, borderColor: themeColor }]}
      onPress={selectionMode ? onToggle : () => router.push({ pathname: "/(admin)/member-detail", params: { id: student.id } } as any)}
    >
      {/* 상단: 아바타 + 이름 + 배지들 */}
      <View style={sc.top}>
        {selectionMode && (
          <Pressable onPress={onToggle} style={sc.checkWrap}>
            <View style={[sc.checkbox, isSelected && { backgroundColor: themeColor, borderColor: themeColor }]}>
              {isSelected && <Feather name="check" size={12} color="#fff" />}
            </View>
          </Pressable>
        )}
        <View style={[sc.avatar, { backgroundColor: themeColor + "20" }]}>
          <Text style={[sc.avatarText, { color: themeColor }]}>{student.name[0]}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={sc.nameRow}>
            <Text style={sc.name}>{student.name}</Text>
            {/* 주N회 배지 */}
            <View style={[sc.badge, { backgroundColor: badge.bg }]}>
              <Text style={[sc.badgeText, { color: badge.color }]}>{badge.label}</Text>
            </View>
            {/* 등록경로 배지 */}
            {isParentRequested && (
              <View style={[sc.badge, { backgroundColor: "#EDE9FE" }]}>
                <Text style={[sc.badgeText, { color: "#7C3AED" }]}>학부모 요청</Text>
              </View>
            )}
          </View>
          {/* 수업 라벨 */}
          {student.schedule_labels ? (
            <Text style={sc.label}>{student.schedule_labels}</Text>
          ) : (
            <Text style={[sc.label, { color: C.textMuted }]}>수업 미배정</Text>
          )}
          {/* 담당 선생님 */}
          {instructorLabel ? (
            <Text style={sc.teacherInfo}>선생님: {instructorLabel}</Text>
          ) : null}
          {/* 보호자 정보 */}
          {(student.parent_name || student.parent_phone) ? (
            <Text style={sc.parentInfo}>
              보호자: {student.parent_name || ""}{student.parent_phone ? ` · ${student.parent_phone}` : ""}
            </Text>
          ) : null}
        </View>
        {/* 우측 상태 배지 */}
        <View style={sc.badges}>
          {assignStatus === "unassigned" && (
            <View style={[sc.statusBadge, { backgroundColor: "#FEE2E2" }]}>
              <Text style={[sc.statusText, { color: "#DC2626" }]}>미배정</Text>
            </View>
          )}
          {assignStatus === "mismatch" && (
            <View style={[sc.statusBadge, { backgroundColor: "#FEF3C7" }]}>
              <Text style={[sc.statusText, { color: "#D97706" }]}>불일치</Text>
            </View>
          )}
          {connStatus === "linked" && (
            <View style={[sc.statusBadge, { backgroundColor: "#D1FAE5" }]}>
              <Feather name="check-circle" size={10} color="#059669" />
              <Text style={[sc.statusText, { color: "#059669" }]}>연결</Text>
            </View>
          )}
          {connStatus === "pending" && (
            <View style={[sc.statusBadge, { backgroundColor: "#FFF7ED" }]}>
              <Feather name="clock" size={10} color="#EA580C" />
              <Text style={[sc.statusText, { color: "#EA580C" }]}>대기</Text>
            </View>
          )}
        </View>
      </View>

      {/* 하단 버튼 (선택모드 아닐 때만) */}
      {!selectionMode && (
        <View style={sc.bottom}>
          <Pressable
            style={[sc.actionBtn, { backgroundColor: themeColor + "15" }]}
            onPress={() => router.push({ pathname: "/(admin)/member-detail", params: { id: student.id } } as any)}
          >
            <Feather name="user" size={13} color={themeColor} />
            <Text style={[sc.actionText, { color: themeColor }]}>회원 상세</Text>
          </Pressable>
          {student.invite_code && connStatus !== "linked" && (
            <Pressable style={[sc.actionBtn, { backgroundColor: "#EDE9FE" }]} onPress={onPressInvite}>
              <Feather name="send" size={13} color="#7C3AED" />
              <Text style={[sc.actionText, { color: "#7C3AED" }]}>초대 문자</Text>
            </Pressable>
          )}
          <Pressable
            style={[sc.actionBtn, { backgroundColor: "#FEE2E2", marginLeft: "auto" }, isDeleting && { opacity: 0.5 }]}
            onPress={() => !isDeleting && onPressDelete()}
            disabled={isDeleting}
          >
            {isDeleting
              ? <ActivityIndicator size={13} color={C.error} />
              : <Feather name="trash-2" size={13} color={C.error} />
            }
          </Pressable>
        </View>
      )}
    </Pressable>
  );
}
const sc = StyleSheet.create({
  card: { borderRadius: 16, padding: 14, gap: 12, marginHorizontal: 16, borderWidth: 1.5, borderColor: "transparent" },
  top: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  checkWrap: { justifyContent: "center", paddingRight: 2, paddingTop: 2 },
  checkbox: { width: 22, height: 22, borderRadius: 7, borderWidth: 2, borderColor: C.border, backgroundColor: C.background, alignItems: "center", justifyContent: "center" },
  avatar: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  name: { fontSize: 16, fontFamily: "Inter_700Bold", color: C.text },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  label: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#374151", marginTop: 2 },
  teacherInfo: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  parentInfo: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  badges: { gap: 4, alignItems: "flex-end" },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  bottom: { flexDirection: "row", gap: 8 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 10 },
  actionText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});

// ── 메인 화면 ────────────────────────────────────────────────────
export default function MembersScreen() {
  const { token, pool } = useAuth();
  const { themeColor }  = useBrand();
  const insets          = useSafeAreaInsets();

  const [students,       setStudents]       = useState<StudentMember[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [refreshing,     setRefreshing]     = useState(false);
  const [filter,         setFilter]         = useState<StudentFilterKey>("all");
  const [search,         setSearch]         = useState("");
  const [showRegister,   setShowRegister]   = useState(false);
  const [inviteTarget,   setInviteTarget]   = useState<StudentMember | null>(null);
  const [deletingId,     setDeletingId]     = useState<string | null>(null);
  const [bulkDeleting,   setBulkDeleting]   = useState(false);
  const sel = useSelectionMode();

  const load = useCallback(async () => {
    try {
      const res = await apiRequest(token, "/students");
      if (res.ok) {
        const data = await res.json();
        setStudents(Array.isArray(data) ? data : []);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(id: string, name: string) {
    Alert.alert(
      "회원 삭제",
      `"${name}" 회원은 운영 목록에서 제거되고 삭제회원으로 보관됩니다.\n학부모 계정은 유지되며 기존 수업 정보는 보존됩니다.\n\n진행하시겠습니까?`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "삭제", style: "destructive", onPress: async () => {
            setDeletingId(id);
            try {
              const res = await apiRequest(token, `/students/${id}`, { method: "DELETE" });
              if (res.ok) {
                setStudents(prev => prev.filter(s => s.id !== id));
              } else {
                Alert.alert("오류", "삭제에 실패했습니다.");
              }
            } catch {
              Alert.alert("오류", "네트워크 오류가 발생했습니다.");
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  }

  function handleBulkDelete() {
    const ids = Array.from(sel.selectedIds);
    if (ids.length === 0) return;
    const count = ids.length;
    Alert.alert(
      "선택 회원 삭제",
      `선택한 ${count}명을 삭제 처리합니다.\n삭제된 회원은 운영 목록에서 제거되고 보관 목록에서 확인할 수 있습니다.\n학부모 계정은 유지됩니다.\n\n진행하시겠습니까?`,
      [
        { text: "취소", style: "cancel" },
        {
          text: `${count}명 삭제`, style: "destructive", onPress: async () => {
            setBulkDeleting(true);
            try {
              console.log(`[admin][deleteStudent] selectedCount=${count}`, ids);
              const results = await Promise.allSettled(
                ids.map(id => apiRequest(token, `/students/${id}`, { method: "DELETE" })
                  .then(r => ({ id, ok: r.ok }))
                )
              );
              const succeeded = results
                .filter((r): r is PromiseFulfilledResult<{ id: string; ok: boolean }> => r.status === "fulfilled" && r.value.ok)
                .map(r => r.value.id);
              const failed = ids.length - succeeded.length;
              setStudents(prev => prev.filter(s => !succeeded.includes(s.id)));
              sel.exitSelectionMode();
              console.log(`[admin][deleteStudent] student soft deleted: ${succeeded.join(", ")}`);
              if (failed > 0) Alert.alert("일부 실패", `${failed}명 삭제에 실패했습니다.`);
            } catch (e) {
              console.error(e);
              Alert.alert("오류", "삭제 중 오류가 발생했습니다.");
            } finally {
              setBulkDeleting(false);
            }
          },
        },
      ]
    );
  }

  // 필터 + 검색 적용
  const filtered = searchStudents(applyStudentFilter(students, filter), search);

  // 칩 카운트 계산
  const chipsWithCount: FilterChipItem<StudentFilterKey>[] = FILTER_CHIPS.map(chip => ({
    ...chip,
    count: applyStudentFilter(students, chip.key).length,
    activeColor: chip.activeColor || themeColor,
    activeBg: chip.activeBg || (themeColor + "18"),
  }));

  const poolName = (pool as any)?.name || "수영장";

  const filteredIds = filtered.map(s => s.id);

  const header = (
    <>
      <SubScreenHeader title="회원 관리" />
      {/* 상단 버튼 */}
      <View style={ms.actionRow}>
        {!sel.selectionMode ? (
          <>
            <Pressable style={[ms.actionBtn, { backgroundColor: themeColor }]} onPress={() => setShowRegister(true)}>
              <Feather name="user-plus" size={14} color="#fff" />
              <Text style={ms.actionBtnText}>어린이 직접 등록</Text>
            </Pressable>
            <Pressable
              style={[ms.actionBtn, { backgroundColor: "#6B7280" }]}
              onPress={() => router.push("/(admin)/approvals" as any)}
            >
              <Feather name="check-circle" size={14} color="#fff" />
              <Text style={ms.actionBtnText}>학부모 요청 승인</Text>
            </Pressable>
            <Pressable style={[ms.selBtn]} onPress={sel.enterSelectionMode}>
              <Feather name="check-square" size={16} color={C.textSecondary} />
            </Pressable>
          </>
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 4 }}>
            <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.textSecondary }}>
              선택 모드 — {sel.selectedCount}명 선택됨
            </Text>
          </View>
        )}
      </View>
      {/* 검색 */}
      <View style={[ms.searchRow, { borderColor: C.border, backgroundColor: C.card }]}>
        <Feather name="search" size={16} color={C.textMuted} />
        <TextInput
          style={[ms.searchInput, { color: C.text }]}
          value={search} onChangeText={setSearch}
          placeholder="이름·보호자·전화번호 검색"
          placeholderTextColor={C.textMuted}
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch("")}>
            <Feather name="x-circle" size={16} color={C.textMuted} />
          </Pressable>
        )}
      </View>
      <FilterChips<StudentFilterKey> chips={chipsWithCount} active={filter} onChange={setFilter} />
    </>
  );

  if (loading) {
    return (
      <ScreenLayout header={header}>
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} size="large" />
      </ScreenLayout>
    );
  }

  return (
    <>
      <ScreenLayout header={header}>
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          contentContainerStyle={[ms.list, { paddingBottom: sel.selectionMode ? insets.bottom + 90 : insets.bottom + 120 }]}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={
            <EmptyState
              icon="users"
              title="해당하는 회원이 없습니다"
              subtitle={search ? `"${search}" 검색 결과가 없습니다` : filter !== "all" ? "필터를 변경해보세요" : "어린이 직접 등록 버튼으로 첫 회원을 추가해보세요"}
            />
          }
          renderItem={({ item }) => (
            <StudentCard
              student={item}
              themeColor={themeColor}
              onPressInvite={() => setInviteTarget(item)}
              onPressDelete={() => handleDelete(item.id, item.name)}
              isDeleting={deletingId === item.id}
              selectionMode={sel.selectionMode}
              isSelected={sel.isSelected(item.id)}
              onToggle={() => sel.toggleItem(item.id)}
            />
          )}
        />
        <SelectionActionBar
          visible={sel.selectionMode}
          selectedCount={sel.selectedCount}
          totalCount={filtered.length}
          isAllSelected={sel.isAllSelected(filteredIds)}
          deleting={bulkDeleting}
          onSelectAll={() => sel.selectAll(filteredIds)}
          onClearSelection={sel.clearSelection}
          onDeleteSelected={handleBulkDelete}
          onExit={sel.exitSelectionMode}
        />
      </ScreenLayout>

      {showRegister && (
        <RegisterModal
          token={token}
          poolName={poolName}
          onSuccess={(s) => {
            setStudents(prev => [s, ...prev]);
            setShowRegister(false);
          }}
          onClose={() => setShowRegister(false)}
        />
      )}
      {inviteTarget && (
        <InviteModal
          student={inviteTarget}
          poolName={poolName}
          onClose={() => setInviteTarget(null)}
        />
      )}
    </>
  );
}

const ms = StyleSheet.create({
  actionRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 12 },
  actionBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  selBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, height: 44, marginHorizontal: 16, marginBottom: 4 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  list: { paddingTop: 10 },
});
