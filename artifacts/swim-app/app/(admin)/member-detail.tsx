/**
 * 회원 상세 6탭 허브
 * 기본정보 / 수업정보 / 레벨평가 / 학부모공유 / 결제이용 / 활동로그
 * 모든 탭: 실 DB 연결, 수정/삭제/복구 활동로그 자동 기록
 */
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Modal, Pressable, ScrollView,
  Share, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import {
  StudentMember, WeeklyCount, WEEKLY_BADGE,
  getStudentConnectionStatus, buildInviteMessage,
} from "@/utils/studentUtils";

const C = Colors.light;

const TABS = ["기본정보", "수업정보", "보강", "레벨/평가", "학부모공유", "학부모 요청", "결제/이용", "활동로그"] as const;
type Tab = typeof TABS[number];

interface ClassGroup {
  id: string; name: string; schedule_days: string; schedule_time: string;
  instructor: string | null; student_count: number;
}

interface DetailData extends StudentMember {
  class_name: string | null; teacher_name: string | null;
  parent_account_name: string | null; parent_link_status: string | null;
  recent_attendance: { date: string; status: string }[];
  recent_diaries: { id: string; lesson_date: string; common_content: string; teacher_name: string; student_note: string | null }[];
  notes: string | null; memo: string | null;
}

interface ActivityLog {
  id: string; target_name: string; action_type: string; target_type: string;
  before_value: string | null; after_value: string | null;
  actor_name: string; actor_role: string; note: string | null; created_at: string;
}

// ── 상태 설정 ──────────────────────────────────────────────────────────────
const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  active:    { label: "재원",   color: "#059669", bg: "#D1FAE5" },
  inactive:  { label: "휴원",   color: "#D97706", bg: "#FEF3C7" },
  suspended: { label: "정지",   color: "#DC2626", bg: "#FEE2E2" },
  withdrawn: { label: "탈퇴",   color: "#6B7280", bg: "#F3F4F6" },
  deleted:   { label: "삭제됨", color: "#9CA3AF", bg: "#F9FAFB" },
};

// ── 반 선택 모달 ──────────────────────────────────────────────────────────
function ClassPickerModal({
  groups, selectedIds, maxSelect, onSelect, onClose,
}: {
  groups: ClassGroup[]; selectedIds: string[]; maxSelect: number;
  onSelect: (ids: string[]) => void; onClose: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(selectedIds);
  const { themeColor } = useBrand();

  function toggle(id: string) {
    if (picked.includes(id)) { setPicked(p => p.filter(x => x !== id)); return; }
    if (picked.length >= maxSelect) { Alert.alert("선택 초과", `최대 ${maxSelect}개`); return; }
    setPicked(p => [...p, id]);
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={cp.overlay}>
        <View style={cp.sheet}>
          <View style={cp.header}>
            <Text style={cp.title}>반 선택 (최대 {maxSelect}개)</Text>
            <Pressable onPress={onClose}><Feather name="x" size={22} color={C.textSecondary} /></Pressable>
          </View>
          <Text style={cp.sub}>{picked.length}/{maxSelect}개 선택됨</Text>
          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 380 }}>
            {groups.length === 0 ? (
              <View style={cp.empty}><Feather name="layers" size={32} color={C.textMuted} /><Text style={{ color: C.textMuted, marginTop: 8 }}>개설된 반이 없습니다</Text></View>
            ) : groups.map(g => {
              const sel = picked.includes(g.id);
              const days = g.schedule_days.split(",").map(d => d.trim()).join("·");
              return (
                <Pressable key={g.id} style={[cp.row, { borderColor: sel ? themeColor : C.border, backgroundColor: sel ? themeColor + "10" : C.background }]} onPress={() => toggle(g.id)}>
                  <View style={{ flex: 1 }}>
                    <Text style={[cp.name, { color: C.text }]}>{g.name}</Text>
                    <Text style={cp.info}>{days}요일 · {g.schedule_time}{g.instructor ? ` · ${g.instructor}` : ""}</Text>
                    <Text style={[cp.count, { color: C.textMuted }]}>재학 {g.student_count}명</Text>
                  </View>
                  <Feather name={sel ? "check-circle" : "circle"} size={22} color={sel ? themeColor : C.textMuted} />
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable style={[cp.confirmBtn, { backgroundColor: themeColor }]} onPress={() => { onSelect(picked); onClose(); }}>
            <Text style={cp.confirmText}>{picked.length}개 반 선택 완료</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const cp = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 24, gap: 14 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 18, fontFamily: "Inter_700Bold", color: C.text },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary },
  row: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 14, borderWidth: 1.5, marginBottom: 8, gap: 12 },
  name: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  info: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  count: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  confirmBtn: { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  confirmText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  empty: { alignItems: "center", paddingVertical: 40 },
});

// ── 편집 필드 컴포넌트 ────────────────────────────────────────────────────
function EditField({ label, value, onChangeText, placeholder, keyboardType, multiline }: {
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder?: string; keyboardType?: any; multiline?: boolean;
}) {
  return (
    <View style={ef.wrap}>
      <Text style={ef.label}>{label}</Text>
      <TextInput
        style={[ef.input, multiline && ef.multiline]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder || label}
        placeholderTextColor={C.textMuted}
        keyboardType={keyboardType || "default"}
        multiline={multiline}
        returnKeyType="done"
      />
    </View>
  );
}

const ef = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary },
  input: { backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: "Inter_400Regular", color: C.text },
  multiline: { minHeight: 80, textAlignVertical: "top" },
});

// ── 출결 달력 미니 ────────────────────────────────────────────────────────
function AttendanceMini({ records }: { records: { date: string; status: string }[] }) {
  const COLORS: Record<string, string> = { present: "#059669", absent: "#DC2626", late: "#D97706", excused: "#7C3AED" };
  const LABELS: Record<string, string> = { present: "출", absent: "결", late: "지", excused: "공" };
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {records.slice(0, 30).map((r, i) => {
        const c = COLORS[r.status] || "#D1D5DB";
        const l = LABELS[r.status] || "?";
        const dt = new Date(r.date);
        return (
          <View key={i} style={{ alignItems: "center", gap: 2 }}>
            <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: c + "20", alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: c }}>{l}</Text>
            </View>
            <Text style={{ fontSize: 9, fontFamily: "Inter_400Regular", color: C.textMuted }}>{dt.getMonth() + 1}/{dt.getDate()}</Text>
          </View>
        );
      })}
      {records.length === 0 && <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: C.textMuted }}>출결 기록이 없습니다</Text>}
    </View>
  );
}

// ── 메인 화면 ──────────────────────────────────────────────────────────────
export default function MemberDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, pool } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const [data, setData] = useState<DetailData | null>(null);
  const [groups, setGroups] = useState<ClassGroup[]>([]);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [makeups, setMakeups] = useState<any[]>([]);
  const [parentRequests, setParentRequests] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("기본정보");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<{ value: string; label: string } | null>(null);

  // 편집 상태
  const [editName, setEditName] = useState("");
  const [editBirth, setEditBirth] = useState("");
  const [editParentName, setEditParentName] = useState("");
  const [editParentPhone, setEditParentPhone] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editMemo, setEditMemo] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [infoChanged, setInfoChanged] = useState(false);

  // 수업 편집
  const [weeklyCount, setWeeklyCount] = useState<WeeklyCount>(1);
  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [classChanged, setClassChanged] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [detailRes, cgRes] = await Promise.all([
        apiRequest(token, `/admin/students/${id}/detail`),
        apiRequest(token, "/class-groups"),
      ]);
      if (detailRes.ok) {
        const d: DetailData = await detailRes.json();
        setData(d);
        setEditName(d.name || "");
        setEditBirth(d.birth_year || "");
        setEditParentName(d.parent_name || "");
        setEditParentPhone(d.parent_phone || "");
        setEditPhone(d.phone || "");
        setEditMemo(d.memo || "");
        setEditNotes(d.notes || "");
        setWeeklyCount((d.weekly_count || 1) as WeeklyCount);
        setAssignedIds(d.assigned_class_ids || []);
      }
      if (cgRes.ok) setGroups(await cgRes.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [id, token]);

  const loadLogs = useCallback(async () => {
    if (!id) return;
    try {
      const res = await apiRequest(token, `/admin/member-logs/${id}`);
      if (res.ok) setLogs(await res.json());
    } catch (e) { console.error(e); }
  }, [id, token]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (activeTab === "활동로그") loadLogs(); }, [activeTab, loadLogs]);
  useEffect(() => {
    if (activeTab === "보강" && id) {
      apiRequest(token, `/admin/makeups/student/${id}`).then(r => r.ok ? r.json() : []).then(setMakeups);
    }
    if (activeTab === "학부모 요청" && id) {
      apiRequest(token, `/parent-requests?student_id=${id}`).then(r => r.ok ? r.json() : []).then(d => setParentRequests(Array.isArray(d) ? d : d.items || []));
    }
  }, [activeTab, id, token]);

  // ── 기본정보 저장 ─────────────────────────────────────────────────────
  async function saveInfo() {
    if (!data) return;
    setSaving(true);
    try {
      const res = await apiRequest(token, `/admin/students/${id}/info`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editName, birth_year: editBirth, parent_name: editParentName,
          parent_phone: editParentPhone, phone: editPhone,
          memo: editMemo, notes: editNotes,
        }),
      });
      if (res.ok) {
        setData(d => d ? { ...d, name: editName, birth_year: editBirth, parent_name: editParentName, parent_phone: editParentPhone, phone: editPhone, memo: editMemo, notes: editNotes } : d);
        setInfoChanged(false);
        Alert.alert("저장 완료", "기본 정보가 업데이트되었습니다.");
      } else {
        const e = await res.json();
        Alert.alert("오류", e.error || "저장에 실패했습니다.");
      }
    } catch { Alert.alert("오류", "네트워크 오류가 발생했습니다."); }
    finally { setSaving(false); }
  }

  // ── 상태 변경 ────────────────────────────────────────────────────────
  function showStatusPicker() {
    setShowStatusModal(true);
  }

  async function confirmStatusChange(status: string, label: string) {
    setPendingStatus({ value: status, label });
  }

  async function doStatusChange(status: string) {
    setSaving(true);
    try {
      const res = await apiRequest(token, `/admin/students/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setData(d => d ? { ...d, status } : d);
        Alert.alert("완료", "상태가 변경되었습니다.");
      } else {
        const e = await res.json();
        Alert.alert("오류", e.error || "변경에 실패했습니다.");
      }
    } catch { Alert.alert("오류", "네트워크 오류"); }
    finally { setSaving(false); }
  }

  // ── 회원 복구 ────────────────────────────────────────────────────────
  async function restoreMember() {
    Alert.alert("회원 복구", `${data?.name}님을 재원 상태로 복구하시겠습니까?`, [
      { text: "취소", style: "cancel" },
      { text: "복구", onPress: async () => {
        setSaving(true);
        try {
          const res = await apiRequest(token, `/admin/students/${id}/restore`, { method: "POST" });
          if (res.ok) { setData(d => d ? { ...d, status: "active" } : d); Alert.alert("복구 완료", "회원이 복구되었습니다."); }
          else { const e = await res.json(); Alert.alert("오류", e.error || "복구에 실패했습니다."); }
        } catch { Alert.alert("오류", "네트워크 오류"); }
        finally { setSaving(false); }
      }},
    ]);
  }

  // ── 반 배정 저장 ──────────────────────────────────────────────────────
  async function saveAssignment() {
    if (!data) return;
    setSaving(true);
    try {
      const res = await apiRequest(token, `/students/${id}/assign`, {
        method: "PATCH",
        body: JSON.stringify({ assigned_class_ids: assignedIds, weekly_count: weeklyCount }),
      });
      const d = await res.json();
      if (!res.ok) { Alert.alert("오류", d.message || "저장에 실패했습니다."); return; }
      setData(prev => prev ? { ...prev, ...d } : prev);
      setAssignedIds(d.assigned_class_ids || []);
      setClassChanged(false);
      Alert.alert("저장 완료", "반 배정이 업데이트되었습니다.");
    } catch { Alert.alert("오류", "네트워크 오류"); }
    finally { setSaving(false); }
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.background }} edges={["top"]}>
        <ActivityIndicator color={themeColor} size="large" style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  if (!data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.background }} edges={["top"]}>
        <Pressable style={s.backBtn} onPress={() => router.back()}><Feather name="arrow-left" size={22} color={C.text} /></Pressable>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: C.textMuted }}>회원을 찾을 수 없습니다</Text>
        </View>
      </SafeAreaView>
    );
  }

  const connStatus = getStudentConnectionStatus(data);
  const statusMeta = STATUS_META[data.status] || STATUS_META.active;
  const badge = WEEKLY_BADGE[weeklyCount] || WEEKLY_BADGE[1];
  const assignedClasses = groups.filter(g => assignedIds.includes(g.id));
  const poolName = (pool as any)?.name || "수영장";
  const isArchived = ["withdrawn", "deleted"].includes(data.status);

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      {/* 헤더 */}
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle} numberOfLines={1}>{data.name}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={[s.statusDot, { backgroundColor: statusMeta.bg }]}>
              <Text style={[s.statusText, { color: statusMeta.color }]}>{statusMeta.label}</Text>
            </View>
            <View style={[s.badge, { backgroundColor: badge.bg }]}>
              <Text style={[s.badgeText, { color: badge.color }]}>{badge.label}</Text>
            </View>
          </View>
        </View>
        {saving && <ActivityIndicator color={themeColor} size="small" />}
      </View>

      {/* 탭 스크롤 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabScroll} contentContainerStyle={{ paddingHorizontal: 12 }}>
        {TABS.map(t => (
          <Pressable key={t} style={[s.tabBtn, activeTab === t && { borderBottomColor: themeColor, borderBottomWidth: 2 }]} onPress={() => setActiveTab(t)}>
            <Text style={[s.tabText, { color: activeTab === t ? themeColor : C.textSecondary }]}>{t}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* ═══ 기본정보 ═══ */}
      {activeTab === "기본정보" && (
        <ScrollView contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false}>
          {/* 복구 배너 */}
          {isArchived && (
            <Pressable style={s.restoreBanner} onPress={restoreMember}>
              <Feather name="rotate-ccw" size={16} color="#7C3AED" />
              <Text style={s.restoreText}>이 회원은 {statusMeta.label} 상태입니다. 탭하여 복구하기</Text>
            </Pressable>
          )}

          <View style={[s.section]}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>기본 정보 편집</Text>
              {infoChanged && (
                <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: "#FEF3C7" }}>
                  <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: "#92400E" }}>변경됨</Text>
                </View>
              )}
            </View>
            <EditField label="이름" value={editName} onChangeText={v => { setEditName(v); setInfoChanged(true); }} />
            <EditField label="출생년도" value={editBirth} onChangeText={v => { setEditBirth(v); setInfoChanged(true); }} keyboardType="numeric" placeholder="예: 2015" />
            <EditField label="연락처" value={editPhone} onChangeText={v => { setEditPhone(v); setInfoChanged(true); }} keyboardType="phone-pad" />
            <EditField label="보호자 이름" value={editParentName} onChangeText={v => { setEditParentName(v); setInfoChanged(true); }} />
            <EditField label="보호자 연락처" value={editParentPhone} onChangeText={v => { setEditParentPhone(v); setInfoChanged(true); }} keyboardType="phone-pad" />

            <Pressable
              style={[s.saveBtn, { backgroundColor: infoChanged ? themeColor : "#9CA3AF" }]}
              onPress={saveInfo}
              disabled={saving || !infoChanged}
            >
              {saving ? <ActivityIndicator color="#fff" size="small" /> : (
                <><Feather name="save" size={16} color="#fff" /><Text style={s.saveBtnText}>정보 저장</Text></>
              )}
            </Pressable>
          </View>

          {/* 상태 관리 */}
          <View style={[s.section]}>
            <Text style={s.sectionTitle}>상태 관리</Text>
            <View style={s.statusRow}>
              <View style={[s.statusBadgeLg, { backgroundColor: statusMeta.bg }]}>
                <Text style={[s.statusBadgeLgText, { color: statusMeta.color }]}>현재: {statusMeta.label}</Text>
              </View>
              {!isArchived ? (
                <Pressable style={s.changeStatusBtn} onPress={showStatusPicker} disabled={saving}>
                  <Feather name="edit-2" size={14} color={themeColor} />
                  <Text style={[s.changeStatusText, { color: themeColor }]}>상태 변경</Text>
                </Pressable>
              ) : (
                <Pressable style={[s.changeStatusBtn, { borderColor: "#7C3AED" }]} onPress={restoreMember} disabled={saving}>
                  <Feather name="rotate-ccw" size={14} color="#7C3AED" />
                  <Text style={[s.changeStatusText, { color: "#7C3AED" }]}>복구</Text>
                </Pressable>
              )}
            </View>

            {/* 기본 정보 미리보기 */}
            {[
              { icon: "calendar" as const, label: "등록일", value: data.created_at ? new Date(data.created_at).toLocaleDateString("ko-KR") : "-" },
              { icon: "map-pin" as const, label: "등록 경로", value: data.registration_path === "admin_created" ? "관리자 직접" : "학부모 요청" },
            ].map(({ icon, label, value }) => (
              <View key={label} style={s.infoRow}>
                <Feather name={icon} size={13} color={C.textMuted} />
                <Text style={s.infoLabel}>{label}</Text>
                <Text style={s.infoValue}>{value}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}

      {/* ═══ 수업정보 ═══ */}
      {activeTab === "수업정보" && (
        <ScrollView contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false}>
          {/* 반 배정 */}
          <View style={[s.section]}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>반 배정</Text>
              {classChanged && (
                <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: "#FEF3C7" }}>
                  <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: "#92400E" }}>변경됨</Text>
                </View>
              )}
            </View>

            {/* 주 N회 */}
            <Text style={s.fieldLabel}>주 수업 횟수</Text>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
              {([1, 2, 3] as WeeklyCount[]).map(w => {
                const b = WEEKLY_BADGE[w];
                const active = weeklyCount === w;
                return (
                  <Pressable key={w} style={[s.weekBtn, { backgroundColor: active ? b.bg : C.background, borderColor: active ? b.color : C.border }]}
                    onPress={() => { setWeeklyCount(w); setClassChanged(true); }}>
                    <Text style={[s.weekBtnText, { color: active ? b.color : C.textSecondary }]}>{b.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* 배정된 반 */}
            <Text style={s.fieldLabel}>배정된 반 ({assignedIds.length}/{weeklyCount})</Text>
            {assignedClasses.length === 0 ? (
              <View style={s.warnBox}>
                <Feather name="alert-circle" size={14} color="#DC2626" />
                <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: "#DC2626" }}>아직 배정된 반이 없습니다</Text>
              </View>
            ) : (
              <View style={{ gap: 8, marginBottom: 8 }}>
                {assignedClasses.map(g => {
                  const days = g.schedule_days.split(",").map(d => d.trim()).join("·");
                  return (
                    <View key={g.id} style={[s.classChip, { borderColor: themeColor + "40", backgroundColor: themeColor + "0D" }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.className, { color: C.text }]}>{g.name}</Text>
                        <Text style={[{ fontSize: 12, fontFamily: "Inter_400Regular", color: themeColor, marginTop: 2 }]}>{days}요일 · {g.schedule_time}</Text>
                        {g.instructor && <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 1 }}>선생님: {g.instructor}</Text>}
                      </View>
                      <Pressable onPress={() => { setAssignedIds(p => p.filter(x => x !== g.id)); setClassChanged(true); }}>
                        <Feather name="x-circle" size={18} color={C.error} />
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}

            <Pressable style={[s.outlineBtn, { borderColor: themeColor }]} onPress={() => setShowPicker(true)}>
              <Feather name="plus-circle" size={15} color={themeColor} />
              <Text style={[s.outlineBtnText, { color: themeColor }]}>반 선택하기</Text>
            </Pressable>

            <Pressable
              style={[s.saveBtn, { backgroundColor: classChanged ? themeColor : "#9CA3AF", marginTop: 12 }]}
              onPress={saveAssignment}
              disabled={saving || !classChanged}
            >
              {saving ? <ActivityIndicator color="#fff" size="small" /> : (
                <><Feather name="save" size={16} color="#fff" /><Text style={s.saveBtnText}>배정 저장</Text></>
              )}
            </Pressable>
          </View>

          {/* 최근 출결 */}
          <View style={[s.section]}>
            <Text style={s.sectionTitle}>최근 출결 현황</Text>
            <View style={{ flexDirection: "row", gap: 12, marginBottom: 12 }}>
              {[
                { label: "출석", color: "#059669", key: "present" },
                { label: "결석", color: "#DC2626", key: "absent" },
                { label: "지각", color: "#D97706", key: "late" },
                { label: "공결", color: "#7C3AED", key: "excused" },
              ].map(({ label, color, key }) => {
                const cnt = (data.recent_attendance || []).filter(r => r.status === key).length;
                return (
                  <View key={key} style={{ alignItems: "center", flex: 1, backgroundColor: color + "15", borderRadius: 10, paddingVertical: 10 }}>
                    <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color }}>{cnt}</Text>
                    <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 }}>{label}</Text>
                  </View>
                );
              })}
            </View>
            <AttendanceMini records={data.recent_attendance || []} />
          </View>

          {/* 최근 일지 */}
          <View style={[s.section]}>
            <Text style={s.sectionTitle}>최근 수업 일지</Text>
            {(data.recent_diaries || []).length === 0 ? (
              <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: C.textMuted }}>등록된 일지가 없습니다</Text>
            ) : (
              <View style={{ gap: 10 }}>
                {(data.recent_diaries || []).map(d => (
                  <View key={d.id} style={{ backgroundColor: "#F9FAFB", borderRadius: 12, padding: 12, gap: 6 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.text }}>{d.lesson_date}</Text>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted }}>{d.teacher_name}</Text>
                    </View>
                    {d.common_content && <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, lineHeight: 18 }} numberOfLines={2}>{d.common_content}</Text>}
                    {d.student_note && (
                      <View style={{ backgroundColor: themeColor + "15", padding: 8, borderRadius: 8 }}>
                        <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: themeColor }}>📝 {d.student_note}</Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      )}

      {/* ═══ 레벨/평가 ═══ */}
      {activeTab === "레벨/평가" && (
        <ScrollView contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false}>
          <View style={[s.section]}>
            <Text style={s.sectionTitle}>수영 레벨 및 특이사항</Text>

            {/* 빠른 레벨 선택 */}
            <Text style={s.fieldLabel}>현재 레벨</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              {["초급", "중급", "상급", "자유형", "배영", "평영", "접영", "4영법"].map(level => {
                const active = editMemo?.includes(level);
                return (
                  <Pressable key={level}
                    style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: active ? themeColor : C.border, backgroundColor: active ? themeColor + "15" : C.background }}
                    onPress={() => {
                      if (active) {
                        setEditMemo(editMemo.replace(level, "").trim());
                      } else {
                        setEditMemo((editMemo ? editMemo + " " : "") + level);
                      }
                      setInfoChanged(true);
                    }}>
                    <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: active ? themeColor : C.textSecondary }}>{level}</Text>
                  </Pressable>
                );
              })}
            </View>

            <EditField label="레벨 메모 (직접 입력)" value={editMemo} onChangeText={v => { setEditMemo(v); setInfoChanged(true); }} placeholder="예: 자유형 50m 완주, 접영 연습 중" multiline />
            <EditField label="특이사항 / 관리자 메모" value={editNotes} onChangeText={v => { setEditNotes(v); setInfoChanged(true); }} placeholder="내부 메모 (학부모에게 노출되지 않음)" multiline />

            <Pressable
              style={[s.saveBtn, { backgroundColor: infoChanged ? themeColor : "#9CA3AF", marginTop: 12 }]}
              onPress={saveInfo}
              disabled={saving || !infoChanged}
            >
              {saving ? <ActivityIndicator color="#fff" size="small" /> : (
                <><Feather name="save" size={16} color="#fff" /><Text style={s.saveBtnText}>평가 저장</Text></>
              )}
            </Pressable>
          </View>

          {/* 현재 저장된 내용 미리보기 */}
          {(data.memo || data.notes) && (
            <View style={[s.section]}>
              <Text style={s.sectionTitle}>저장된 내용</Text>
              {data.memo && (
                <View style={{ backgroundColor: themeColor + "10", padding: 12, borderRadius: 12, marginBottom: 8 }}>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: themeColor, marginBottom: 4 }}>레벨 메모</Text>
                  <Text style={{ fontSize: 14, fontFamily: "Inter_400Regular", color: C.text }}>{data.memo}</Text>
                </View>
              )}
              {data.notes && (
                <View style={{ backgroundColor: "#FEF3C7", padding: 12, borderRadius: 12 }}>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: "#D97706", marginBottom: 4 }}>특이사항</Text>
                  <Text style={{ fontSize: 14, fontFamily: "Inter_400Regular", color: C.text }}>{data.notes}</Text>
                </View>
              )}
            </View>
          )}
        </ScrollView>
      )}

      {/* ═══ 학부모공유 ═══ */}
      {activeTab === "학부모공유" && (
        <ScrollView contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false}>
          {/* 연결 상태 */}
          <View style={[s.section]}>
            <Text style={s.sectionTitle}>학부모 앱 연결</Text>
            <View style={[s.connCard, {
              backgroundColor: connStatus === "linked" ? "#D1FAE5" : connStatus === "pending" ? "#FEF3C7" : "#F3F4F6",
            }]}>
              <Feather
                name={connStatus === "linked" ? "check-circle" : connStatus === "pending" ? "clock" : "x-circle"}
                size={24}
                color={connStatus === "linked" ? "#059669" : connStatus === "pending" ? "#D97706" : C.textMuted}
              />
              <View style={{ flex: 1 }}>
                <Text style={[s.connStatus, { color: connStatus === "linked" ? "#059669" : connStatus === "pending" ? "#D97706" : C.textMuted }]}>
                  {connStatus === "linked" ? "학부모 앱 연결 완료" : connStatus === "pending" ? "연결 요청 대기 중" : "학부모 앱 미연결"}
                </Text>
                {data.parent_account_name && (
                  <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 }}>
                    연결 계정: {data.parent_account_name}
                  </Text>
                )}
              </View>
            </View>

            {/* 초대 코드 */}
            {data.invite_code && connStatus !== "linked" && (
              <View style={s.inviteBox}>
                <Text style={s.fieldLabel}>초대 코드</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Text style={[s.inviteCode, { color: themeColor }]}>{data.invite_code}</Text>
                  <Pressable
                    style={[s.outlineBtn, { borderColor: themeColor, paddingHorizontal: 12 }]}
                    onPress={async () => {
                      const msg = buildInviteMessage({ poolName, studentName: data.name, inviteCode: data.invite_code!, appUrl: "https://swimnote.kr" });
                      await Clipboard.setStringAsync(msg);
                      Alert.alert("복사 완료", "초대 문자가 클립보드에 복사되었습니다.");
                    }}
                  >
                    <Feather name="copy" size={14} color={themeColor} />
                    <Text style={[s.outlineBtnText, { color: themeColor }]}>복사</Text>
                  </Pressable>
                  <Pressable
                    style={[s.outlineBtn, { borderColor: "#059669", paddingHorizontal: 12 }]}
                    onPress={async () => {
                      const msg = buildInviteMessage({ poolName, studentName: data.name, inviteCode: data.invite_code!, appUrl: "https://swimnote.kr" });
                      await Share.share({ message: msg });
                    }}
                  >
                    <Feather name="share-2" size={14} color="#059669" />
                    <Text style={[s.outlineBtnText, { color: "#059669" }]}>공유</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>

          {/* 보호자 정보 */}
          <View style={[s.section]}>
            <Text style={s.sectionTitle}>보호자 정보</Text>
            {[
              { icon: "user" as const, label: "보호자 이름", value: data.parent_name || "미입력" },
              { icon: "phone" as const, label: "연락처", value: data.parent_phone || "미입력" },
            ].map(({ icon, label, value }) => (
              <View key={label} style={s.infoRow}>
                <Feather name={icon} size={13} color={C.textMuted} />
                <Text style={s.infoLabel}>{label}</Text>
                <Text style={s.infoValue}>{value}</Text>
              </View>
            ))}
            <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted, marginTop: 8 }}>
              * 보호자 정보 수정은 기본정보 탭에서 할 수 있습니다.
            </Text>
          </View>
        </ScrollView>
      )}

      {/* ═══ 결제/이용 ═══ */}
      {activeTab === "결제/이용" && (
        <ScrollView contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false}>
          <View style={[s.section]}>
            <Text style={s.sectionTitle}>이용 정보</Text>
            {[
              { icon: "calendar" as const, label: "등록일", value: data.created_at ? new Date(data.created_at).toLocaleDateString("ko-KR") : "-" },
              { icon: "edit" as const, label: "최근 수정일", value: data.updated_at ? new Date(data.updated_at).toLocaleDateString("ko-KR") : "-" },
              { icon: "refresh-cw" as const, label: "주 수업 횟수", value: `주 ${weeklyCount}회` },
              { icon: "layers" as const, label: "배정된 반", value: assignedClasses.length > 0 ? assignedClasses.map(c => c.name).join(", ") : "미배정" },
            ].map(({ icon, label, value }) => (
              <View key={label} style={s.infoRow}>
                <Feather name={icon} size={13} color={C.textMuted} />
                <Text style={s.infoLabel}>{label}</Text>
                <Text style={s.infoValue}>{value}</Text>
              </View>
            ))}
          </View>

          <View style={[s.section, { backgroundColor: "#FEF3C7" }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Feather name="info" size={16} color="#D97706" />
              <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#D97706" }}>개인 결제 내역</Text>
            </View>
            <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: "#92400E", marginTop: 4, lineHeight: 18 }}>
              개인별 결제 내역은 수영장 전체 결제 관리 탭에서 확인할 수 있습니다.{"\n"}
              더보기 → 결제 관리에서 전체 현황을 확인하세요.
            </Text>
            <Pressable style={[s.outlineBtn, { borderColor: "#D97706", marginTop: 8 }]} onPress={() => router.push("/(admin)/billing" as any)}>
              <Feather name="credit-card" size={14} color="#D97706" />
              <Text style={[s.outlineBtnText, { color: "#D97706" }]}>결제 관리 바로가기</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}

      {/* ═══ 활동로그 ═══ */}
      {activeTab === "활동로그" && (
        <ScrollView contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false}>
          {logs.length === 0 ? (
            <View style={s.section}>
              <View style={{ alignItems: "center", paddingVertical: 30, gap: 10 }}>
                <Feather name="activity" size={36} color={C.textMuted} />
                <Text style={{ fontSize: 14, fontFamily: "Inter_400Regular", color: C.textMuted }}>활동 기록이 없습니다</Text>
              </View>
            </View>
          ) : (
            <View style={[s.section]}>
              <Text style={s.sectionTitle}>변경 이력 ({logs.length}건)</Text>
              {logs.map((log, i) => {
                const ACTION_META: Record<string, { label: string; color: string }> = {
                  update: { label: "수정", color: "#2563EB" }, create: { label: "등록", color: "#059669" },
                  delete: { label: "삭제", color: "#DC2626" }, restore: { label: "복구", color: "#7C3AED" },
                  assign: { label: "반배정", color: "#D97706" },
                };
                const TYPE_LABEL: Record<string, string> = {
                  status: "상태", info: "기본정보", class: "반", diary: "일지", attendance: "출결",
                };
                const meta = ACTION_META[log.action_type] || { label: log.action_type, color: C.textSecondary };
                const typeLabel = TYPE_LABEL[log.target_type] || log.target_type;
                const dt = new Date(log.created_at);
                return (
                  <View key={log.id || i} style={[s.logRow, i > 0 && { borderTopWidth: 1, borderTopColor: C.border }]}>
                    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                      <View style={[s.logDot, { backgroundColor: meta.color + "20" }]}>
                        <View style={[s.logDotInner, { backgroundColor: meta.color }]} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: meta.color + "15" }}>
                            <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: meta.color }}>{typeLabel} {meta.label}</Text>
                          </View>
                          <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: C.textMuted }}>
                            {`${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`}
                          </Text>
                        </View>
                        {(log.before_value || log.after_value) && (
                          <View style={{ marginTop: 6, gap: 3 }}>
                            {log.before_value && <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: "#DC2626" }}>이전: {log.before_value}</Text>}
                            {log.after_value && <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: "#059669" }}>변경: {log.after_value}</Text>}
                          </View>
                        )}
                        {log.note && <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 4, fontStyle: "italic" }}>메모: {log.note}</Text>}
                        <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: C.textMuted, marginTop: 4 }}>
                          {log.actor_name} ({log.actor_role === "pool_admin" ? "관리자" : "선생님"})
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}

      {/* ═══ 보강 ═══ */}
      {activeTab === "보강" && (
        <ScrollView contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false}>
          <View style={s.section}>
            <Text style={s.sectionTitle}>보강 이력 ({makeups.length}건)</Text>
            {makeups.length === 0 ? (
              <View style={{ alignItems: "center", paddingVertical: 30 }}>
                <Feather name="rotate-ccw" size={36} color={C.textMuted} />
                <Text style={{ fontSize: 14, color: C.textMuted, marginTop: 10 }}>보강 기록이 없습니다</Text>
              </View>
            ) : makeups.map((mk: any) => {
              const ST: Record<string, { label: string; color: string; bg: string }> = {
                waiting:     { label: "대기",   color: "#D97706", bg: "#FEF3C7" },
                assigned:    { label: "배정",   color: "#2563EB", bg: "#DBEAFE" },
                transferred: { label: "이동",   color: "#7C3AED", bg: "#EDE9FE" },
                completed:   { label: "완료",   color: "#059669", bg: "#D1FAE5" },
                cancelled:   { label: "취소",   color: "#6B7280", bg: "#F3F4F6" },
              };
              const st = ST[mk.status] || { label: mk.status, color: "#6B7280", bg: "#F3F4F6" };
              return (
                <View key={mk.id} style={{ flexDirection: "row", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border, gap: 12 }}>
                  <View style={[{ borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, alignSelf: "flex-start" }, { backgroundColor: st.bg }]}>
                    <Text style={{ fontSize: 11, fontWeight: "600", color: st.color }}>{st.label}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: C.text }}>결석일: {mk.absence_date}</Text>
                    <Text style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>원반: {mk.original_class_group_name || "미배정"}  담당: {mk.original_teacher_name || "미배정"}</Text>
                    {mk.assigned_class_group_name && <Text style={{ fontSize: 12, color: C.textSecondary, marginTop: 1 }}>배정반: {mk.assigned_class_group_name}</Text>}
                    {mk.is_substitute && mk.substitute_teacher_name && (
                      <Text style={{ fontSize: 12, color: "#059669", marginTop: 2, fontWeight: "600" }}>대리보강: {mk.substitute_teacher_name}</Text>
                    )}
                    {mk.transferred_to_teacher_name && (
                      <Text style={{ fontSize: 12, color: "#7C3AED", marginTop: 1 }}>이동→ {mk.transferred_to_teacher_name}</Text>
                    )}
                    {mk.completed_at && (
                      <Text style={{ fontSize: 11, color: C.textMuted, marginTop: 1 }}>완료: {new Date(mk.completed_at).toLocaleDateString("ko-KR")}</Text>
                    )}
                  </View>
                </View>
              );
            })}
            <Pressable style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, justifyContent: "center" }}
              onPress={() => router.push("/(admin)/makeups")}>
              <Feather name="external-link" size={14} color={themeColor} />
              <Text style={{ fontSize: 13, color: themeColor, fontWeight: "600" }}>보강 관리 화면으로 이동</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}

      {/* ═══ 학부모 요청 ═══ */}
      {activeTab === "학부모 요청" && (
        <ScrollView contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false}>
          <View style={s.section}>
            <Text style={s.sectionTitle}>학부모 요청 ({parentRequests.length}건)</Text>
            {parentRequests.length === 0 ? (
              <View style={{ alignItems: "center", paddingVertical: 30 }}>
                <Feather name="inbox" size={36} color={C.textMuted} />
                <Text style={{ fontSize: 14, color: C.textMuted, marginTop: 10 }}>요청 기록이 없습니다</Text>
              </View>
            ) : parentRequests.map((req: any, i: number) => {
              const REQ_TYPE: Record<string, string> = {
                absence:    "결석 요청",
                makeup:     "보강 요청",
                counseling: "상담 요청",
                inquiry:    "문의",
              };
              return (
                <View key={req.id || i} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: C.text }}>{REQ_TYPE[req.type] || req.type || "요청"}</Text>
                    <Text style={{ fontSize: 11, color: C.textMuted }}>{new Date(req.created_at).toLocaleDateString("ko-KR")}</Text>
                  </View>
                  {req.content && <Text style={{ fontSize: 12, color: C.textSecondary, marginTop: 4 }}>{req.content}</Text>}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
                    <View style={[{ borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 }, { backgroundColor: req.status === "pending" ? "#FEF3C7" : "#D1FAE5" }]}>
                      <Text style={{ fontSize: 11, fontWeight: "600", color: req.status === "pending" ? "#D97706" : "#059669" }}>{req.status === "pending" ? "처리 대기" : "처리 완료"}</Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}

      {/* ═══ 상태 변경 모달 ═══ */}
      <Modal visible={showStatusModal} transparent animationType="fade">
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}
          onPress={() => { setShowStatusModal(false); setPendingStatus(null); }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36 }}>
            <Text style={{ fontSize: 17, fontWeight: "700", color: C.text, marginBottom: 16, textAlign: "center" }}>상태 변경</Text>
            {pendingStatus ? (
              <View style={{ gap: 12 }}>
                <Text style={{ textAlign: "center", color: C.textSecondary, fontSize: 14 }}>
                  {data?.name}님을 "{pendingStatus.label}"(으)로 변경하시겠습니까?
                </Text>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Pressable style={{ flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: "#F3F4F6", alignItems: "center" }}
                    onPress={() => setPendingStatus(null)}>
                    <Text style={{ fontWeight: "600", color: C.textSecondary }}>취소</Text>
                  </Pressable>
                  <Pressable style={{ flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: pendingStatus.value === "withdrawn" ? "#DC2626" : themeColor, alignItems: "center" }}
                    onPress={() => { doStatusChange(pendingStatus.value); setShowStatusModal(false); setPendingStatus(null); }}>
                    <Text style={{ fontWeight: "700", color: "#fff" }}>확인</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                {[{ label: "재원", value: "active", color: "#059669", bg: "#D1FAE5" },
                  { label: "휴원", value: "inactive", color: "#D97706", bg: "#FEF3C7" },
                  { label: "정지", value: "suspended", color: "#DC2626", bg: "#FEE2E2" },
                  { label: "탈퇴 처리", value: "withdrawn", color: "#7C3AED", bg: "#F3E8FF" }
                ].map(opt => (
                  <Pressable key={opt.value} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 12, backgroundColor: opt.bg }}
                    onPress={() => setPendingStatus(opt)}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: opt.color }} />
                    <Text style={{ fontSize: 15, fontWeight: "600", color: opt.color }}>{opt.label}</Text>
                  </Pressable>
                ))}
                <Pressable style={{ paddingVertical: 14, alignItems: "center" }}
                  onPress={() => { setShowStatusModal(false); setPendingStatus(null); }}>
                  <Text style={{ fontWeight: "600", color: C.textSecondary }}>취소</Text>
                </Pressable>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* 반 선택 모달 */}
      {showPicker && (
        <ClassPickerModal
          groups={groups}
          selectedIds={assignedIds}
          maxSelect={weeklyCount}
          onSelect={ids => { setAssignedIds(ids); setClassChanged(true); }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F3F4F6" },

  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 10, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: C.text },
  statusDot: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeText: { fontSize: 12, fontFamily: "Inter_700Bold" },

  tabScroll: { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.border, flexGrow: 0 },
  tabBtn: { paddingHorizontal: 14, paddingVertical: 13 },
  tabText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  tabContent: { padding: 16, gap: 12, paddingBottom: 100 },
  section: { backgroundColor: "#fff", borderRadius: 18, padding: 16, gap: 12, shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: C.text },

  restoreBanner: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#F3E8FF", padding: 14, borderRadius: 14 },
  restoreText: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#7C3AED", flex: 1 },

  saveBtn: { height: 50, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  saveBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  outlineBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5 },
  outlineBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  statusRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  statusBadgeLg: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  statusBadgeLgText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  changeStatusBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, borderColor: C.tint },
  changeStatusText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  infoRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  infoLabel: { width: 90, fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary },
  infoValue: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", color: C.text },

  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary, marginBottom: 4 },
  weekBtn: { flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, alignItems: "center" },
  weekBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  warnBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FEE2E2", padding: 12, borderRadius: 12 },
  classChip: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 12, borderWidth: 1.5, gap: 10 },
  className: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  connCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14 },
  connStatus: { fontSize: 15, fontFamily: "Inter_700Bold" },
  inviteBox: { marginTop: 12, gap: 8 },
  inviteCode: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: 3 },

  logRow: { paddingVertical: 12 },
  logDot: { width: 28, height: 28, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 2 },
  logDotInner: { width: 10, height: 10, borderRadius: 5 },
});
