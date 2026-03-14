/**
 * 회원 상세 및 반 배정 화면
 * 관리자 전용 — 회원 이름 클릭 시 진입
 */
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Modal, Pressable,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import {
  StudentMember, AssignedClassInfo, WeeklyCount,
  WEEKLY_BADGE, getStudentAssignmentStatus, getStudentConnectionStatus,
  buildInviteMessage,
} from "@/utils/studentUtils";
import * as Clipboard from "expo-clipboard";

const C = Colors.light;

interface ClassGroup {
  id: string;
  name: string;
  schedule_days: string;
  schedule_time: string;
  instructor: string | null;
  student_count: number;
}

// ── 반 선택 모달 ─────────────────────────────────────────────────
function ClassPickerModal({
  groups, selectedIds, maxSelect, onSelect, onClose,
}: {
  groups: ClassGroup[];
  selectedIds: string[];
  maxSelect: number;
  onSelect: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(selectedIds);

  function toggle(id: string) {
    if (picked.includes(id)) {
      setPicked(prev => prev.filter(x => x !== id));
    } else {
      if (picked.length >= maxSelect) {
        Alert.alert("선택 초과", `최대 ${maxSelect}개까지 선택할 수 있습니다.`);
        return;
      }
      setPicked(prev => [...prev, id]);
    }
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
              <View style={cp.empty}>
                <Feather name="layers" size={32} color={C.textMuted} />
                <Text style={[cp.emptyText, { color: C.textMuted }]}>개설된 반이 없습니다</Text>
              </View>
            ) : groups.map(g => {
              const sel = picked.includes(g.id);
              const days = g.schedule_days.split(",").map(d => d.trim()).join("·");
              return (
                <Pressable
                  key={g.id}
                  style={[cp.row, { borderColor: sel ? C.tint : C.border, backgroundColor: sel ? C.tintLight : C.background }]}
                  onPress={() => toggle(g.id)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[cp.name, { color: C.text }]}>{g.name}</Text>
                    <Text style={cp.info}>{days}요일 · {g.schedule_time}{g.instructor ? ` · ${g.instructor}` : ""}</Text>
                    <Text style={[cp.count, { color: C.textMuted }]}>재학 {g.student_count}명</Text>
                  </View>
                  {sel ? (
                    <Feather name="check-circle" size={22} color={C.tint} />
                  ) : (
                    <Feather name="circle" size={22} color={C.textMuted} />
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable style={[cp.confirmBtn, { backgroundColor: C.tint }]} onPress={() => { onSelect(picked); onClose(); }}>
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
  empty: { alignItems: "center", paddingVertical: 40, gap: 10 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
});

// ── 정보 행 컴포넌트 ───────────────────────────────────────────
function InfoRow({ icon, label, value, valueColor }: { icon: any; label: string; value: string; valueColor?: string }) {
  return (
    <View style={ir.row}>
      <Feather name={icon} size={14} color={C.textMuted} />
      <Text style={ir.label}>{label}</Text>
      <Text style={[ir.value, valueColor ? { color: valueColor } : {}]}>{value}</Text>
    </View>
  );
}
const ir = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  label: { width: 80, fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary },
  value: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", color: C.text },
});

// ── 메인 화면 ─────────────────────────────────────────────────
export default function MemberDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, pool } = useAuth();
  const { themeColor } = useBrand();

  const [student,     setStudent]     = useState<StudentMember | null>(null);
  const [groups,      setGroups]      = useState<ClassGroup[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [showPicker,  setShowPicker]  = useState(false);

  // 편집 상태
  const [weeklyCount,      setWeeklyCount]      = useState<WeeklyCount>(1);
  const [assignedIds,      setAssignedIds]       = useState<string[]>([]);
  const [isDirty,          setIsDirty]           = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [sRes, cgRes] = await Promise.all([
        apiRequest(token, `/students/${id}`),
        apiRequest(token, "/class-groups"),
      ]);
      if (sRes.ok) {
        const s: StudentMember = await sRes.json();
        setStudent(s);
        setWeeklyCount((s.weekly_count || 1) as WeeklyCount);
        setAssignedIds(s.assigned_class_ids || []);
      }
      if (cgRes.ok) setGroups(await cgRes.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [id, token]);

  useEffect(() => { load(); }, [load]);

  async function handleSaveAssignment() {
    if (!student) return;
    if (assignedIds.length > 0 && assignedIds.length !== weeklyCount) {
      Alert.alert(
        "배정 개수 불일치",
        `주${weeklyCount}회인데 ${assignedIds.length}개 반이 선택됐습니다. 계속 저장할까요?`,
        [
          { text: "취소", style: "cancel" },
          { text: "저장", onPress: () => doSave() },
        ]
      );
      return;
    }
    doSave();
  }

  async function doSave() {
    if (!student) return;
    setSaving(true);
    try {
      const res = await apiRequest(token, `/students/${student.id}/assign`, {
        method: "PATCH",
        body: JSON.stringify({ assigned_class_ids: assignedIds, weekly_count: weeklyCount }),
      });
      const data = await res.json();
      if (!res.ok) { Alert.alert("오류", data.message || "저장에 실패했습니다."); return; }
      setStudent({ ...student, ...data });
      setAssignedIds(data.assigned_class_ids || []);
      setIsDirty(false);
      Alert.alert("저장 완료", "반 배정이 업데이트되었습니다.");
    } catch { Alert.alert("오류", "네트워크 오류가 발생했습니다."); }
    finally { setSaving(false); }
  }

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <ActivityIndicator color={themeColor} style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  if (!student) {
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: C.textMuted }}>회원을 찾을 수 없습니다</Text>
        </View>
      </SafeAreaView>
    );
  }

  const assignStatus = getStudentAssignmentStatus({ ...student, assigned_class_ids: assignedIds, weekly_count: weeklyCount });
  const connStatus   = getStudentConnectionStatus(student);
  const assignedClasses = groups.filter(g => assignedIds.includes(g.id));
  const wc = weeklyCount;
  const badge = WEEKLY_BADGE[wc] || WEEKLY_BADGE[1];
  const poolName = (pool as any)?.name || "수영장";

  const regLabel = student.registration_path === "admin_created" ? "관리자 직접 등록" : "학부모 요청";
  const connLabel = connStatus === "linked" ? "연결 완료" : connStatus === "pending" ? "연결 대기 중" : "미연결";
  const connColor = connStatus === "linked" ? "#059669" : connStatus === "pending" ? "#EA580C" : C.textMuted;

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      {/* 헤더 */}
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <Text style={s.headerTitle}>회원 상세</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* 프로필 카드 */}
        <View style={[s.profileCard, { backgroundColor: C.card }]}>
          <View style={[s.profileAvatar, { backgroundColor: themeColor + "20" }]}>
            <Text style={[s.profileInitial, { color: themeColor }]}>{student.name[0]}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.profileName}>{student.name}</Text>
            {student.birth_year && <Text style={s.profileSub}>{student.birth_year}년생</Text>}
          </View>
          {/* 주N회 배지 */}
          <View style={[s.profileBadge, { backgroundColor: badge.bg }]}>
            <Text style={[s.profileBadgeText, { color: badge.color }]}>{badge.label}</Text>
          </View>
        </View>

        {/* 기본 정보 */}
        <View style={[s.section, { backgroundColor: C.card }]}>
          <Text style={s.sectionTitle}>기본 정보</Text>
          <InfoRow icon="user" label="학생 이름" value={student.name} />
          {student.birth_year && <InfoRow icon="calendar" label="출생년도" value={`${student.birth_year}년`} />}
          <InfoRow icon="users" label="보호자" value={student.parent_name || "미입력"} />
          <InfoRow icon="phone" label="보호자 연락처" value={student.parent_phone || "미입력"} />
          <InfoRow icon="map-pin" label="등록 경로" value={regLabel} />
          <InfoRow icon="link" label="앱 연결" value={connLabel} valueColor={connColor} />
          {student.invite_code && connStatus !== "linked" && (
            <View style={s.inviteRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.inviteLabel}>초대코드</Text>
                <Text style={[s.inviteCode, { color: C.tint }]}>{student.invite_code}</Text>
              </View>
              <Pressable
                style={[s.inviteBtn, { backgroundColor: C.tintLight }]}
                onPress={async () => {
                  const msg = buildInviteMessage({ poolName, studentName: student.name, inviteCode: student.invite_code!, appUrl: "https://swimnote.kr" });
                  await Clipboard.setStringAsync(msg);
                  Alert.alert("복사 완료", "초대 문자가 클립보드에 복사되었습니다.");
                }}
              >
                <Feather name="copy" size={14} color={C.tint} />
                <Text style={[s.inviteBtnText, { color: C.tint }]}>초대 복사</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* 반 배정 */}
        <View style={[s.section, { backgroundColor: C.card }]}>
          <View style={s.assignHeader}>
            <Text style={s.sectionTitle}>반 배정</Text>
            {isDirty && (
              <View style={[s.dirtyBadge]}>
                <Text style={s.dirtyText}>변경됨</Text>
              </View>
            )}
          </View>

          {/* 주 N회 선택 */}
          <Text style={s.fieldLabel}>주 수업 횟수</Text>
          <View style={s.weekRow}>
            {([1, 2, 3] as WeeklyCount[]).map(w => {
              const b = WEEKLY_BADGE[w];
              const active = wc === w;
              return (
                <Pressable
                  key={w}
                  style={[s.weekBtn, { backgroundColor: active ? b.bg : C.background, borderColor: active ? b.color : C.border }]}
                  onPress={() => { setWeeklyCount(w); setIsDirty(true); }}
                >
                  <Text style={[s.weekBtnText, { color: active ? b.color : C.textSecondary }]}>{b.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* 배정된 반 목록 */}
          <Text style={[s.fieldLabel, { marginTop: 12 }]}>배정된 반 ({assignedIds.length}/{wc})</Text>
          {assignedClasses.length === 0 ? (
            <View style={s.unassignedHint}>
              <Feather name="alert-circle" size={14} color="#DC2626" />
              <Text style={s.unassignedText}>아직 배정된 반이 없습니다</Text>
            </View>
          ) : (
            <View style={s.classList}>
              {assignedClasses.map(g => {
                const days = g.schedule_days.split(",").map(d => d.trim()).join("·");
                const hour = g.schedule_time.split(":")[0];
                const label = g.schedule_days.split(",").map(d => `${d.trim()}${hour}`).join("·");
                return (
                  <View key={g.id} style={[s.classChip, { borderColor: themeColor + "40", backgroundColor: themeColor + "0D" }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.className, { color: C.text }]}>{g.name}</Text>
                      <Text style={[s.classLabel, { color: themeColor }]}>{label} · {g.schedule_time}</Text>
                    </View>
                    <Pressable
                      onPress={() => { setAssignedIds(prev => prev.filter(x => x !== g.id)); setIsDirty(true); }}
                    >
                      <Feather name="x-circle" size={18} color={C.error} />
                    </Pressable>
                  </View>
                );
              })}
            </View>
          )}

          {/* 불일치 경고 */}
          {assignStatus === "mismatch" && assignedIds.length > 0 && (
            <View style={s.mismatchWarn}>
              <Feather name="alert-triangle" size={13} color="#D97706" />
              <Text style={s.mismatchText}>주{wc}회인데 {assignedIds.length}개 반이 배정되어 있습니다.</Text>
            </View>
          )}

          {/* 반 선택 버튼 */}
          <Pressable
            style={[s.pickBtn, { borderColor: themeColor, backgroundColor: themeColor + "10" }]}
            onPress={() => setShowPicker(true)}
          >
            <Feather name="plus-circle" size={16} color={themeColor} />
            <Text style={[s.pickBtnText, { color: themeColor }]}>반 선택하기</Text>
          </Pressable>

          {/* 저장 버튼 */}
          <Pressable
            style={[s.saveBtn, { backgroundColor: isDirty ? themeColor : "#9CA3AF" }]}
            onPress={handleSaveAssignment}
            disabled={saving || !isDirty}
          >
            {saving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Feather name="save" size={16} color="#fff" />
                <Text style={s.saveBtnText}>배정 저장</Text>
              </>
            )}
          </Pressable>
        </View>

        {/* 수업 라벨 미리보기 */}
        {student.schedule_labels && (
          <View style={[s.section, { backgroundColor: C.card }]}>
            <Text style={s.sectionTitle}>수업 일정 요약</Text>
            <View style={s.labelRow}>
              <Feather name="calendar" size={14} color={C.textMuted} />
              <Text style={[s.labelText, { color: themeColor }]}>{student.schedule_labels}</Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* 반 선택 모달 */}
      {showPicker && (
        <ClassPickerModal
          groups={groups}
          selectedIds={assignedIds}
          maxSelect={wc}
          onSelect={(ids) => { setAssignedIds(ids); setIsDirty(true); }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F3F4F6" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, gap: 8 },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.card, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 18, fontFamily: "Inter_700Bold", color: C.text },

  scroll: { paddingHorizontal: 16, paddingBottom: 100, gap: 12 },

  profileCard: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: 18 },
  profileAvatar: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  profileInitial: { fontSize: 22, fontFamily: "Inter_700Bold" },
  profileName: { fontSize: 20, fontFamily: "Inter_700Bold", color: C.text },
  profileSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  profileBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  profileBadgeText: { fontSize: 13, fontFamily: "Inter_700Bold" },

  section: { borderRadius: 18, padding: 16, gap: 2 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: C.text, marginBottom: 8 },

  inviteRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 12 },
  inviteLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary },
  inviteCode: { fontSize: 18, fontFamily: "Inter_700Bold", letterSpacing: 3, marginTop: 2 },
  inviteBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  inviteBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  assignHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  dirtyBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: "#FEF3C7" },
  dirtyText: { fontSize: 11, fontFamily: "Inter_500Medium", color: "#92400E" },

  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary, marginBottom: 8 },
  weekRow: { flexDirection: "row", gap: 8 },
  weekBtn: { flex: 1, paddingVertical: 11, borderRadius: 12, borderWidth: 1.5, alignItems: "center" },
  weekBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  unassignedHint: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#FEE2E2", padding: 12, borderRadius: 12 },
  unassignedText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#DC2626" },

  classList: { gap: 8, marginBottom: 4 },
  classChip: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 12, borderWidth: 1.5, gap: 10 },
  className: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  classLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },

  mismatchWarn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#FEF3C7", padding: 10, borderRadius: 10 },
  mismatchText: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#D97706" },

  pickBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 46, borderRadius: 12, borderWidth: 1.5, marginTop: 10 },
  pickBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  saveBtn: { height: 50, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 10 },
  saveBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },

  labelRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 },
  labelText: { fontSize: 16, fontFamily: "Inter_700Bold", letterSpacing: 1 },
});
