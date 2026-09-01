/**
 * WP-M4 → STUDENT DETAIL SINGLE MANAGEMENT HUB
 * Teacher Student Detail — 학생 1명 관리 허브
 *
 * - Section A: 기본 정보 (조회)
 * - Section B: 수강 정보 — 주당횟수 변경 + 반/시간표 변경 + 회원상태변경
 * - Section C: 레벨 변경 (기존 API 재사용)
 * - Section D: 개인 출결 요약 (student-scoped API)
 * - Section E: 보호자 연락처 편집 (phone1/2, teacher 권한)
 * - Section F: 일지/사진 shortcut
 * - Section G: WP-M5 전 미노출
 * - Section H: 회원 상태 (회원상태변경 버튼 포함)
 *
 * 기존 API 재사용:
 * - PATCH /students/:id/weekly-count     { weekly_count }
 * - POST  /students/:id/move-class       { from_class_id, to_class_id }
 * - POST  /students/:id/change-status    (MemberStatusChangeModal)
 * - PATCH /teacher/students/:id/level    (SectionC_Level)
 * - PATCH /students/:id/parent-phones    { slot, phone }
 *
 * 금지: 새 DB migration, 새 enrollment 모델, 새 status enum, 새 weekly count 로직
 * Back: 항상 previous screen (homePath 없음)
 * mode gate 추가 없음 (Shared Core)
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Modal,
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import Colors from "@/constants/colors";
import { callPhone, sendSms, formatPhone, CALL_COLOR, SMS_COLOR } from "@/utils/phoneUtils";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { type LevelDef } from "@/components/common/LevelBadge";
import {
  getPrimaryStatus, PRIMARY_STATUS_BADGE, getMemberPendingBadge,
  getEffectiveWeekly, WEEKLY_BADGE,
  type StudentMember,
} from "@/utils/studentUtils";
// WP-M3 공통 컴포넌트 재사용
import { MemberSectionCard, InfoRow } from "@/components/admin/member/MemberSectionCard";
// WP-M3 Level Section 공통 재사용 (callback injection으로 endpoint 분리)
import { SectionC_Level } from "@/components/admin/member/SectionC_Level";
// 회원상태변경 — 기존 공통 컴포넌트 재사용
import { MemberStatusChangeModal } from "@/components/common/MemberStatusChangeModal";

const C = Colors.light;
const KO_DAYS = ["일", "월", "화", "수", "목", "금", "토"];

// ── 타입 ─────────────────────────────────────────────────────────────────
interface ParentLink {
  id: string;
  name: string;
  phone: string;
  link_status: string;
}
interface AssignedClass {
  id: string;
  name: string;
  schedule_days: string;
  schedule_time: string;
  student_count?: number;
  level?: string | null;
}
interface StudentDetail extends StudentMember {
  phone?: string | null;
  address?: string | null;
  gender?: string | null;
  parent_phone2?: string | null;
  parents?: ParentLink[];
  assignedClasses?: AssignedClass[];
}
interface AttendanceStat {
  present: number; absent: number; late: number;
}
interface LevelInfo {
  current_level_order: number | null;
  current_level: LevelDef | null;
  all_levels: LevelDef[];
}
interface TeacherClassGroup {
  id: string;
  name: string;
  schedule_days: string;
  schedule_time: string;
  student_count?: number;
}

// ── 유틸 ────────────────────────────────────────────────────────────────
function getBirthAge(birthYear?: string | null): string {
  if (!birthYear) return "";
  const y = parseInt(birthYear);
  if (isNaN(y)) return birthYear;
  return `${birthYear}년생 (${new Date().getFullYear() - y + 1}세)`;
}
function normalizePhone(p: string): string {
  return (p || "").replace(/[^0-9]/g, "");
}
function getPhoneConnStatus(
  phone: string | null | undefined,
  parents: ParentLink[] | undefined
): "linked" | "waiting" {
  if (!phone) return "waiting";
  const norm = normalizePhone(phone);
  const linked = parents?.find(
    p => normalizePhone(p.phone) === norm && p.link_status === "approved"
  );
  return linked ? "linked" : "waiting";
}
function colorFromId(id: string): string {
  const COLORS = ["#4EA7D8", "#2E9B6F", "#E4A93A", "#D96C6C", "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16"];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
  return COLORS[Math.abs(h) % COLORS.length];
}
function clsDayTime(cls: { schedule_days: string; schedule_time: string }): string {
  const days = cls.schedule_days.split(",").map(d => {
    const n = parseInt(d.trim());
    return isNaN(n) ? d.trim() : (KO_DAYS[n] ?? d.trim());
  }).join("·");
  return `${days} ${cls.schedule_time}`;
}

// ── 메인 화면 ────────────────────────────────────────────────────────────
export default function StudentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useAuth();
  const { themeColor } = useBrand();

  // ── 데이터 ─────────────────────────────────────────────────────────────
  const [student, setStudent]     = useState<StudentDetail | null>(null);
  const [attStat, setAttStat]     = useState<AttendanceStat | null>(null);
  const [levelInfo, setLevelInfo] = useState<LevelInfo | null>(null);
  const [loading, setLoading]     = useState(true);

  // ── 레벨 변경 상태 ──────────────────────────────────────────────────────
  const [showLevelPicker, setShowLevelPicker]     = useState(false);
  const [levelChanging, setLevelChanging]         = useState(false);
  const [levelNote, setLevelNote]                 = useState("");
  const [pendingLevelOrder, setPendingLevelOrder] = useState<number | null>(null);
  const [showLevelNoteModal, setShowLevelNoteModal] = useState(false);
  const [levelResult, setLevelResult]             = useState<{ ok: boolean; msg: string } | null>(null);

  // ── 보호자 연락처 편집 (phone1/2만) ────────────────────────────────────
  const [phoneEditModal, setPhoneEditModal] = useState<{
    visible: boolean; slot: 1 | 2; value: string;
  }>({ visible: false, slot: 1, value: "" });
  const [phoneEditSaving, setPhoneEditSaving] = useState(false);
  const [phoneDeleteModal, setPhoneDeleteModal] = useState<{
    visible: boolean; slot: 1 | 2; phone: string; isLinked: boolean;
  }>({ visible: false, slot: 1, phone: "", isLinked: false });

  // ── 주당 횟수 변경 ─────────────────────────────────────────────────────
  const [weeklyChanging, setWeeklyChanging] = useState(false);

  // ── 회원상태변경 ───────────────────────────────────────────────────────
  const [showStatusModal, setShowStatusModal] = useState(false);

  // ── 반/시간표 이동 ─────────────────────────────────────────────────────
  const [showMoveSheet, setShowMoveSheet]       = useState(false);
  const [teacherClasses, setTeacherClasses]     = useState<TeacherClassGroup[]>([]);
  const [classesLoading, setClassesLoading]     = useState(false);
  const [moveFromId, setMoveFromId]             = useState<string | null>(null);
  const [moveToId, setMoveToId]                 = useState<string | null>(null);
  const [moveStep, setMoveStep]                 = useState<"pick-from" | "pick-to" | "confirm">("pick-to");
  const [moving, setMoving]                     = useState(false);

  // ── 로드 ──────────────────────────────────────────────────────────────
  const load = useCallback(async (silent = false) => {
    if (!id) return;
    if (!silent) setLoading(true);
    try {
      const [stRes, attRes, lvRes] = await Promise.all([
        apiRequest(token, `/students/${id}`),
        apiRequest(token, `/students/${id}/attendance`),
        apiRequest(token, `/teacher/students/${id}/level`, { _noCache: true } as any),
      ]);
      if (stRes.ok) setStudent(await stRes.json());
      if (attRes.ok) {
        const arr: any[] = await attRes.json();
        setAttStat({
          present: arr.filter(a => a.status === "present").length,
          absent:  arr.filter(a => a.status === "absent").length,
          late:    arr.filter(a => a.status === "late").length,
        });
      }
      if (lvRes.ok) setLevelInfo(await lvRes.json());
    } catch (e) { console.error(e); }
    finally { if (!silent) setLoading(false); }
  }, [id, token]);

  useEffect(() => { load(); }, [load]);

  // ── API: 주당 횟수 변경 — 기존 PATCH /students/:id/weekly-count 재사용 ─
  async function handleWeeklyChange(wc: 1 | 2 | 3) {
    if (!id || !student) return;
    if (student.weekly_count === wc) return;
    const prev = student.weekly_count;
    setWeeklyChanging(true);
    setStudent(s => s ? { ...s, weekly_count: wc } : s);
    try {
      const res = await apiRequest(token, `/students/${id}/weekly-count`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekly_count: wc }),
      });
      if (res.ok) {
        load(true);
      } else {
        setStudent(s => s ? { ...s, weekly_count: prev } : s);
        Alert.alert("변경 실패", "주당 횟수 변경에 실패했습니다.");
      }
    } catch {
      setStudent(s => s ? { ...s, weekly_count: prev } : s);
      Alert.alert("오류", "연결을 확인해주세요.");
    } finally { setWeeklyChanging(false); }
  }

  // ── 반/시간표 변경 시트 열기 — /class-groups 조회 ──────────────────────
  async function openMoveSheet() {
    setMoveStep("pick-to");
    setMoveFromId(null);
    setMoveToId(null);
    setShowMoveSheet(true);
    setClassesLoading(true);
    try {
      const res = await apiRequest(token, "/class-groups");
      if (res.ok) {
        const all: TeacherClassGroup[] = await res.json();
        setTeacherClasses(all);
      }
    } catch { /* ignore */ }
    finally { setClassesLoading(false); }
  }

  // ── API: 반 이동 — 기존 POST /students/:id/move-class 재사용 ──────────
  async function doMove() {
    if (!id || !moveFromId || !moveToId) return;
    setMoving(true);
    try {
      const res = await apiRequest(token, `/students/${id}/move-class`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from_class_id: moveFromId, to_class_id: moveToId }),
      });
      if (res.ok) {
        setShowMoveSheet(false);
        load(true);
      } else {
        const body = await res.json().catch(() => ({}));
        Alert.alert("이동 실패", body?.message || body?.error || "반 이동에 실패했습니다.");
      }
    } catch {
      Alert.alert("오류", "연결을 확인해주세요.");
    } finally { setMoving(false); }
  }

  // ── API: 레벨 변경 (note 포함) ─────────────────────────────────────────
  async function handleLevelChange(levelOrder: number) {
    setPendingLevelOrder(levelOrder);
    setShowLevelPicker(false);
    setLevelNote("");
    setShowLevelNoteModal(true);
  }

  async function confirmLevelChange() {
    if (!id || pendingLevelOrder == null) return;
    const levelOrder = pendingLevelOrder;
    const prevLevelInfo = levelInfo;
    const newLevel = levelInfo?.all_levels.find(l => l.level_order === levelOrder) ?? null;
    setShowLevelNoteModal(false);
    setPendingLevelOrder(null);
    setLevelChanging(true);
    setLevelInfo(prev => prev ? { ...prev, current_level_order: levelOrder, current_level: newLevel } : prev);
    try {
      const res = await apiRequest(token, `/teacher/students/${id}/level`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level_order: levelOrder, note: levelNote || null }),
      });
      if (res.ok) {
        setLevelResult({ ok: true, msg: `레벨이 "${newLevel?.level_name ?? levelOrder}"로 변경됐습니다.\n학부모 앱에 즉시 반영됩니다.` });
      } else {
        setLevelInfo(prevLevelInfo);
        setLevelResult({ ok: false, msg: "레벨 변경에 실패했습니다. 다시 시도해주세요." });
      }
    } catch {
      setLevelInfo(prevLevelInfo);
      setLevelResult({ ok: false, msg: "레벨 변경 중 오류가 발생했습니다." });
    } finally { setLevelChanging(false); setLevelNote(""); }
  }

  // ── API: 보호자 연락처 저장/삭제 ──────────────────────────────────────
  function parseApiBody(res: Response) {
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) return Promise.resolve(null);
    return res.json().catch(() => null);
  }
  function getApiError(status: number, body: any): string {
    const msg = body?.error || body?.message;
    if (status === 400) return msg || "입력값을 확인해주세요.";
    if (status === 401 || status === 403) return "권한이 없습니다.";
    if (status === 404) return "학생 정보를 찾을 수 없습니다.";
    if (status === 409) return msg || "이미 등록된 전화번호입니다.";
    if (status >= 500) return "서버 오류가 발생했습니다.";
    return msg || "요청에 실패했습니다.";
  }
  function applyPhoneResponse(body: any) {
    setStudent(prev => {
      if (!prev) return prev;
      if (body.parentPhones && Array.isArray(body.parentPhones)) {
        const slot1 = body.parentPhones.find((p: any) => p.slot === 1);
        const slot2 = body.parentPhones.find((p: any) => p.slot === 2);
        return {
          ...prev,
          parent_phone:  slot1 ? slot1.phone : prev.parent_phone,
          parent_phone2: slot2 ? slot2.phone : prev.parent_phone2,
          parents:       body.parents ?? prev.parents,
        };
      }
      return {
        ...prev,
        parent_phone:  "parent_phone"  in body ? body.parent_phone  : prev.parent_phone,
        parent_phone2: "parent_phone2" in body ? body.parent_phone2 : prev.parent_phone2,
        parents:       body.parents ?? prev.parents,
      };
    });
  }

  async function savePhoneEdit() {
    if (!id || !student) return;
    const prevStudent = student;
    setPhoneEditSaving(true);
    try {
      const normPhone = phoneEditModal.value.trim().replace(/[^0-9]/g, "") || null;
      const res = await apiRequest(token, `/students/${id}/parent-phones`, {
        method: "PATCH",
        body: JSON.stringify({ slot: phoneEditModal.slot, phone: normPhone }),
      });
      const body = await parseApiBody(res);
      if (res.ok && body) {
        applyPhoneResponse(body);
        setPhoneEditModal(m => ({ ...m, visible: false }));
        load(true);
      } else if (res.ok && !body) {
        setStudent(prevStudent);
        Alert.alert("오류", "서버 응답 오류가 발생했습니다.");
      } else {
        Alert.alert("저장 실패", getApiError(res.status, body));
      }
    } catch {
      setStudent(prevStudent);
      Alert.alert("네트워크 오류", "연결을 확인해주세요.");
    } finally { setPhoneEditSaving(false); }
  }

  async function confirmPhoneDelete() {
    if (!id || !student) return;
    const prevStudent = student;
    setPhoneEditSaving(true);
    try {
      const res = await apiRequest(token, `/students/${id}/parent-phones`, {
        method: "PATCH",
        body: JSON.stringify({ slot: phoneDeleteModal.slot, phone: null }),
      });
      const body = await parseApiBody(res);
      if (res.ok && body) {
        applyPhoneResponse(body);
        setPhoneDeleteModal(m => ({ ...m, visible: false }));
        load(true);
      } else if (res.ok && !body) {
        setStudent(prevStudent);
        Alert.alert("오류", "서버 응답 오류가 발생했습니다.");
      } else {
        Alert.alert("삭제 실패", getApiError(res.status, body));
      }
    } catch {
      setStudent(prevStudent);
      Alert.alert("네트워크 오류", "연결을 확인해주세요.");
    } finally { setPhoneEditSaving(false); }
  }

  // ── 로딩/오류 ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: C.background }}>
        <SubScreenHeader title="학생 정보" />
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
      </View>
    );
  }
  if (!student) {
    return (
      <View style={{ flex: 1, backgroundColor: C.background }}>
        <SubScreenHeader title="학생 정보" />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10 }}>
          <LucideIcon name="user-x" size={36} color={C.textMuted} />
          <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted }}>
            회원 정보를 불러올 수 없습니다
          </Text>
        </View>
      </View>
    );
  }

  // ── 파생값 ───────────────────────────────────────────────────────────
  const ps = getPrimaryStatus(student as any);
  const primaryBadge = PRIMARY_STATUS_BADGE[ps];
  const pendingBadge = getMemberPendingBadge(student as any);
  const wc = student.weekly_count ? getEffectiveWeekly(student as any) : null;
  const weeklyBadge = wc ? WEEKLY_BADGE[wc] : null;
  const phones: (string | null | undefined)[] = [student.parent_phone, student.parent_phone2];
  const hasSlot1 = !!student.parent_phone;
  const currentClassIds = new Set((student.assignedClasses ?? []).map(c => c.id));

  // SectionC_Level 호환 LevelInfo 변환
  const levelInfoCompat = levelInfo ? {
    current_level_order: levelInfo.current_level_order,
    current_level: levelInfo.current_level,
    all_levels: levelInfo.all_levels,
  } : null;
  const dataForLevel = {
    current_level_order: levelInfo?.current_level_order,
    current_level_name:  levelInfo?.current_level?.level_name,
    current_level_color: levelInfo?.current_level?.badge_color,
  } as any;

  // 반 이동 — 이동 가능한 반 (현재 배정된 반 제외)
  const availableTargetClasses = teacherClasses.filter(g => !currentClassIds.has(g.id));
  const currentAssigned = student.assignedClasses ?? [];
  const moveToClass = teacherClasses.find(g => g.id === moveToId);
  const moveFromClass = currentAssigned.find(c => c.id === moveFromId);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* ── 헤더 (homePath 없음 → Back = previous screen) ── */}
      <SubScreenHeader
        title={student.name}
        subtitle={primaryBadge?.label}
      />

      {/* ── Long-scroll ── */}
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* HEADER CARD: 이름·상태·반·레벨 */}
        <View style={{
          backgroundColor: themeColor + "10", borderRadius: 18,
          padding: 16, gap: 8,
          borderWidth: 1, borderColor: themeColor + "25",
        }}>
          <Text style={{ fontSize: 22, fontFamily: "Pretendard-Regular", color: C.text }}>
            {student.name}
          </Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <View style={{
              paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
              backgroundColor: primaryBadge?.bg ?? C.backgroundSoft,
            }}>
              <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: primaryBadge?.color ?? C.textMuted }}>
                {primaryBadge?.label ?? ps}
              </Text>
            </View>
            {student.assignedClasses?.map(cls => (
              <View key={cls.id} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: themeColor + "20" }}>
                <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: themeColor }}>{cls.name}</Text>
              </View>
            ))}
            {levelInfo?.current_level && (
              <View style={{
                paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
                backgroundColor: (levelInfo.current_level.badge_color ?? themeColor) + "20",
              }}>
                <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: levelInfo.current_level.badge_color ?? themeColor }}>
                  {levelInfo.current_level.level_name}
                </Text>
              </View>
            )}
            {weeklyBadge && (
              <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: weeklyBadge.bg }}>
                <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: weeklyBadge.color }}>{weeklyBadge.label}</Text>
              </View>
            )}
          </View>
        </View>

        {/* ── Section A: 기본 정보 ── */}
        <MemberSectionCard title="기본 정보">
          <View>
            <InfoRow icon="user" label="이름" value={student.name} />
            {student.birth_year && (
              <InfoRow icon="calendar" label="생년" value={getBirthAge(student.birth_year)} />
            )}
            {student.gender && (
              <InfoRow
                icon="users"
                label="성별"
                value={student.gender === "male" ? "남" : student.gender === "female" ? "여" : student.gender}
              />
            )}
            {student.parent_name && (
              <InfoRow icon="user" label="보호자" value={student.parent_name} />
            )}
            <InfoRow
              icon="calendar"
              label="등록일"
              value={student.created_at ? new Date(student.created_at).toLocaleDateString("ko-KR") : undefined}
            />
          </View>
        </MemberSectionCard>

        {/* ── Section B: 수강 정보 — 주당횟수 변경 + 반변경 + 상태변경 ── */}
        <MemberSectionCard title="수강 정보">
          <View style={{ gap: 12 }}>

            {/* 배정된 반 목록 (class-scoped 출결 버튼 제거 → student-scoped 연결만) */}
            {(!currentAssigned || currentAssigned.length === 0) ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4, justifyContent: "center" }}>
                <LucideIcon name="layers" size={20} color={C.textMuted} />
                <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted }}>배정된 반이 없습니다</Text>
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                {currentAssigned.map(cls => (
                  <View key={cls.id} style={{
                    flexDirection: "row", alignItems: "center", gap: 10,
                    padding: 12, borderRadius: 12,
                    backgroundColor: themeColor + "0D",
                    borderWidth: 1, borderColor: themeColor + "30",
                  }}>
                    <View style={{ width: 4, height: 36, borderRadius: 2, backgroundColor: colorFromId(cls.id) }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text }}>{cls.name}</Text>
                      <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: themeColor, marginTop: 2 }}>
                        {clsDayTime(cls)}{cls.level ? ` · ${cls.level}` : ""}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* 구분선 */}
            <View style={{ height: 1, backgroundColor: C.border }} />

            {/* 주당 횟수 — 기존 PATCH /students/:id/weekly-count 재사용 */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <LucideIcon name="repeat" size={14} color={C.textMuted} />
              <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, flex: 1 }}>
                주당 횟수
              </Text>
              {weeklyChanging ? (
                <ActivityIndicator size="small" color={themeColor} />
              ) : (
                <View style={{ flexDirection: "row", gap: 6 }}>
                  {([1, 2, 3] as const).map(n => {
                    const isCurrent = (student.weekly_count ?? 1) === n;
                    return (
                      <Pressable
                        key={n}
                        style={{
                          width: 40, height: 32, borderRadius: 8,
                          alignItems: "center", justifyContent: "center",
                          backgroundColor: isCurrent ? themeColor : C.backgroundSoft,
                          borderWidth: 1.5,
                          borderColor: isCurrent ? themeColor : C.border,
                        }}
                        onPress={() => handleWeeklyChange(n)}
                        disabled={weeklyChanging}
                      >
                        <Text style={{
                          fontSize: 13, fontFamily: "Pretendard-Regular",
                          color: isCurrent ? "#fff" : C.textSecondary,
                        }}>주{n}회</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>

            {/* 반/시간표 변경 — 기존 POST /students/:id/move-class 재사용 */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <LucideIcon name="layers" size={14} color={C.textMuted} />
              <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, flex: 1 }}>
                반/시간표 변경
              </Text>
              <Pressable
                style={{
                  paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
                  borderWidth: 1.5, borderColor: themeColor + "60",
                  backgroundColor: themeColor + "08",
                }}
                onPress={openMoveSheet}
              >
                <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: themeColor }}>변경</Text>
              </Pressable>
            </View>

            {/* 회원상태 + 변경 — 기존 MemberStatusChangeModal (POST /students/:id/change-status) 재사용 */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <LucideIcon name="user-check" size={14} color={C.textMuted} />
              <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary }}>상태</Text>
                <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: primaryBadge?.bg ?? C.backgroundSoft }}>
                  <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: primaryBadge?.color ?? C.textMuted }}>
                    {primaryBadge?.label ?? ps}
                  </Text>
                </View>
                {pendingBadge && (
                  <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: C.backgroundSoft }}>
                    <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary }}>→ {pendingBadge.label}</Text>
                  </View>
                )}
              </View>
              <Pressable
                style={{
                  paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
                  borderWidth: 1.5, borderColor: "#D97706" + "60",
                  backgroundColor: "#D97706" + "08",
                }}
                onPress={() => setShowStatusModal(true)}
              >
                <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: "#D97706" }}>상태변경</Text>
              </Pressable>
            </View>

          </View>
        </MemberSectionCard>

        {/* ── Section C: 레벨 변경 (WP-M3 SectionC_Level 공통 재사용) ── */}
        <SectionC_Level
          data={dataForLevel}
          themeColor={themeColor}
          levelInfo={levelInfoCompat as any}
          levelChanging={levelChanging}
          showLevelPicker={showLevelPicker}
          onOpenLevelPicker={() => setShowLevelPicker(true)}
          onCloseLevelPicker={() => setShowLevelPicker(false)}
          onLevelChange={handleLevelChange}
        />

        {/* ── Section D: 개인 출결 요약 (student-scoped: GET /students/:id/attendance) ── */}
        <MemberSectionCard title="출결 현황">
          {attStat ? (
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {[
                  { label: "출석", value: attStat.present, color: C.present ?? "#22C55E" },
                  { label: "결석", value: attStat.absent,  color: "#D96C6C" },
                  { label: "지각", value: attStat.late,    color: "#D97706" },
                ].map(({ label, value, color }) => (
                  <View key={label} style={{
                    flex: 1, alignItems: "center",
                    backgroundColor: color + "15", borderRadius: 10, paddingVertical: 10,
                  }}>
                    <Text style={{ fontSize: 20, fontFamily: "Pretendard-Regular", color }}>{value}</Text>
                    <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 }}>{label}</Text>
                  </View>
                ))}
                {(() => {
                  const total = attStat.present + attStat.absent + attStat.late;
                  const rate  = total > 0 ? Math.round((attStat.present / total) * 100) : null;
                  return rate !== null ? (
                    <View style={{
                      flex: 1, alignItems: "center",
                      backgroundColor: (rate >= 80 ? "#22C55E" : "#D97706") + "15",
                      borderRadius: 10, paddingVertical: 10,
                    }}>
                      <Text style={{ fontSize: 20, fontFamily: "Pretendard-Regular", color: rate >= 80 ? "#22C55E" : "#D97706" }}>{rate}%</Text>
                      <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 }}>출석률</Text>
                    </View>
                  ) : null;
                })()}
              </View>
              {/* 출결 상세: 학생 개인 출결 화면 없음 (반 전체 화면 연결 금지) → 요약만 표시 */}
            </View>
          ) : (
            <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted }}>출결 데이터가 없습니다</Text>
          )}
        </MemberSectionCard>

        {/* ── Section E: 보호자 연락처 (phone1/2만, teacher 권한) ── */}
        <MemberSectionCard title="보호자 연락처">
          <View>
            {phones.map((ph, idx) => {
              const slot = (idx + 1) as 1 | 2;
              const isSlot2 = idx === 1;
              if (isSlot2 && !hasSlot1) return null;

              if (!ph) {
                return (
                  <Pressable
                    key={slot}
                    style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12 }}
                    onPress={() => setPhoneEditModal({ visible: true, slot, value: "" })}
                  >
                    <LucideIcon name="plus-circle" size={15} color={themeColor} />
                    <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: themeColor }}>
                      {slot === 1 ? "보호자 1 추가" : "보호자 2 추가"}
                    </Text>
                  </Pressable>
                );
              }

              const connStatus = getPhoneConnStatus(ph, student.parents);
              return (
                <View key={slot} style={{
                  flexDirection: "row", alignItems: "center", gap: 10,
                  paddingVertical: 12,
                  borderBottomWidth: isSlot2 ? 0 : 1,
                  borderBottomColor: C.border,
                }}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary }}>
                      {slot === 1 ? "보호자 1" : "보호자 2"}
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <Pressable onPress={() => callPhone(ph)} hitSlop={8}>
                        <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: CALL_COLOR }}>
                          {formatPhone(ph)}
                        </Text>
                      </Pressable>
                      <Pressable onPress={() => sendSms(ph)} hitSlop={8}>
                        <LucideIcon name="message-square" size={14} color={SMS_COLOR} />
                      </Pressable>
                    </View>
                    <View style={{
                      flexDirection: "row", alignItems: "center", gap: 4,
                      alignSelf: "flex-start",
                      paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20,
                      backgroundColor: connStatus === "linked" ? C.brandMist : "#FFF7ED",
                    }}>
                      <LucideIcon
                        name={connStatus === "linked" ? "check-circle" : "clock"}
                        size={11}
                        color={connStatus === "linked" ? C.brandStrong : "#EA580C"}
                      />
                      <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: connStatus === "linked" ? C.brandStrong : "#EA580C" }}>
                        {connStatus === "linked" ? "연결됨" : "가입 대기"}
                      </Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    <Pressable
                      style={{ width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: C.backgroundSoft, borderWidth: 1, borderColor: C.border }}
                      onPress={() => setPhoneEditModal({ visible: true, slot, value: formatPhone(ph) })}
                      hitSlop={8}
                    >
                      <LucideIcon name="edit-2" size={14} color={themeColor} />
                    </Pressable>
                    <Pressable
                      style={{ width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: C.backgroundSoft, borderWidth: 1, borderColor: C.border }}
                      onPress={() => setPhoneDeleteModal({ visible: true, slot, phone: ph, isLinked: connStatus === "linked" })}
                      hitSlop={8}
                    >
                      <LucideIcon name="trash-2" size={14} color="#D96C6C" />
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
          {/* phone3/4: HIDDEN — teacher API 미지원 (의도적 제한) */}
        </MemberSectionCard>

        {/* ── Section F: 개인 일지 / 사진 — student-scoped ── */}
        {/* Diary: student_id filter via class_diary_student_notes (ID 기반 관계) */}
        {/* Media: GET /photos/private/:studentId 기존 backend 재사용 */}
        <MemberSectionCard title="일지 / 사진">
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: themeColor + "60", backgroundColor: themeColor + "0A" }}
              onPress={() => router.push({ pathname: "/(teacher)/diary-index", params: { studentId: student.id, studentName: student.name, backTo: "student-detail" } } as any)}
            >
              <LucideIcon name="book-open" size={14} color={themeColor} />
              <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: themeColor }}>일지 보기</Text>
            </Pressable>
            <Pressable
              style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.backgroundSoft }}
              onPress={() => router.push({ pathname: "/(teacher)/photos", params: { studentId: student.id, studentName: student.name } } as any)}
            >
              <LucideIcon name="image" size={14} color={C.textSecondary} />
              <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary }}>사진/영상</Text>
            </Pressable>
          </View>
        </MemberSectionCard>

        {/* Section G: WP-M5 전까지 미노출 (공개 추가정보) */}

        {/* Section H: Teacher에서는 Danger Zone 없음 — 관리자 전용 (admin-only scope) */}
        {/* 상태변경은 Section B에서만 제공 */}
      </ScrollView>

      {/* ══════════════════════════════════════════════════════════════
          회원상태변경 모달 — 기존 MemberStatusChangeModal 재사용
          POST /students/:id/change-status
         ══════════════════════════════════════════════════════════════ */}
      <MemberStatusChangeModal
        visible={showStatusModal}
        studentId={student.id}
        studentName={student.name}
        currentStatus={student.status}
        pendingStatusChange={(student as any).pending_status_change}
        pendingEffectiveMode={(student as any).pending_effective_mode}
        onClose={() => setShowStatusModal(false)}
        onChanged={() => {
          setShowStatusModal(false);
          load(true);
        }}
      />

      {/* ══════════════════════════════════════════════════════════════
          반/시간표 변경 시트 — POST /students/:id/move-class 재사용
         ══════════════════════════════════════════════════════════════ */}
      <Modal
        visible={showMoveSheet}
        transparent
        animationType="slide"
        onRequestClose={() => { setShowMoveSheet(false); setMoveStep("pick-to"); setMoveToId(null); setMoveFromId(null); }}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }}
          onPress={() => { setShowMoveSheet(false); setMoveStep("pick-to"); setMoveToId(null); setMoveFromId(null); }}
        />
        <View style={st.moveSheet}>
          <View style={st.handle} />

          {/* 1단계: 이동할 반 선택 */}
          {moveStep === "pick-to" && (
            <>
              <View style={st.sheetHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={st.sheetTitle}>반/시간표 변경</Text>
                  <Text style={st.sheetSub}>{student.name} · 이동할 반을 선택하세요</Text>
                </View>
                <Pressable onPress={() => setShowMoveSheet(false)} style={{ padding: 4 }}>
                  <LucideIcon name="x" size={20} color={C.textSecondary} />
                </Pressable>
              </View>
              {classesLoading ? (
                <View style={{ padding: 32, alignItems: "center" }}>
                  <ActivityIndicator color={themeColor} />
                </View>
              ) : availableTargetClasses.length === 0 ? (
                <View style={{ padding: 32, alignItems: "center", gap: 8 }}>
                  <LucideIcon name="layers" size={32} color={C.textMuted} />
                  <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted }}>이동 가능한 반이 없습니다</Text>
                </View>
              ) : (
                <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false}>
                  {availableTargetClasses.map(cls => (
                    <Pressable
                      key={cls.id}
                      style={st.classRow}
                      onPress={() => {
                        setMoveToId(cls.id);
                        if (currentAssigned.length === 1) {
                          setMoveFromId(currentAssigned[0].id);
                          setMoveStep("confirm");
                        } else if (currentAssigned.length === 0) {
                          // 현재 반 없음 → 이동 불가 (from_class_id 필요)
                          Alert.alert("알림", "현재 배정된 반이 없어 이동할 수 없습니다.");
                        } else {
                          setMoveStep("pick-from");
                        }
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={st.className}>{cls.name}</Text>
                        <Text style={st.classTime}>{clsDayTime(cls)}</Text>
                      </View>
                      <LucideIcon name="chevron-right" size={16} color={C.textMuted} />
                    </Pressable>
                  ))}
                  <View style={{ height: 32 }} />
                </ScrollView>
              )}
            </>
          )}

          {/* 2단계: 기존 반 선택 (다중 배정 시) */}
          {moveStep === "pick-from" && moveToClass && (
            <>
              <View style={st.sheetHeader}>
                <Pressable onPress={() => { setMoveStep("pick-to"); setMoveFromId(null); }} style={{ padding: 4, marginRight: 8 }}>
                  <LucideIcon name="arrow-left" size={20} color={C.textSecondary} />
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text style={st.sheetTitle}>어떤 반에서 이동할까요?</Text>
                  <Text style={st.sheetSub}>→ {moveToClass.name}</Text>
                </View>
              </View>
              <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false}>
                {currentAssigned.map(cls => (
                  <Pressable
                    key={cls.id}
                    style={st.classRow}
                    onPress={() => { setMoveFromId(cls.id); setMoveStep("confirm"); }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={st.className}>{cls.name}</Text>
                      <Text style={st.classTime}>{clsDayTime(cls)}</Text>
                    </View>
                    <LucideIcon name="chevron-right" size={16} color={C.textMuted} />
                  </Pressable>
                ))}
                <View style={{ height: 32 }} />
              </ScrollView>
            </>
          )}

          {/* 3단계: 확인 */}
          {moveStep === "confirm" && moveFromClass && moveToClass && (
            <View style={{ padding: 24, gap: 16 }}>
              <Text style={{ fontSize: 17, fontFamily: "Pretendard-Regular", color: C.text, textAlign: "center" }}>
                반 이동 확인
              </Text>
              <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary, textAlign: "center", lineHeight: 22 }}>
                {student.name} 회원을{"\n"}
                <Text style={{ color: "#D96C6C" }}>{moveFromClass.name}</Text>
                {" "}에서{"\n"}
                <Text style={{ color: themeColor }}>{moveToClass.name}</Text>
                {" "}({clsDayTime(moveToClass)})으로{"\n"}이동하시겠습니까?
              </Text>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <Pressable
                  style={{ flex: 1, height: 46, borderRadius: 12, borderWidth: 1.5, borderColor: C.border, alignItems: "center", justifyContent: "center" }}
                  onPress={() => {
                    if (currentAssigned.length > 1) setMoveStep("pick-from");
                    else { setMoveStep("pick-to"); setMoveFromId(null); setMoveToId(null); }
                  }}
                >
                  <Text style={{ fontSize: 15, fontFamily: "Pretendard-Regular", color: C.textSecondary }}>취소</Text>
                </Pressable>
                <Pressable
                  style={{ flex: 1, height: 46, borderRadius: 12, backgroundColor: themeColor, alignItems: "center", justifyContent: "center" }}
                  onPress={doMove}
                  disabled={moving}
                >
                  {moving
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={{ fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" }}>이동</Text>
                  }
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* ── 레벨 노트 입력 모달 ── */}
      <Modal
        visible={showLevelNoteModal}
        transparent
        animationType="slide"
        onRequestClose={() => { setShowLevelNoteModal(false); setPendingLevelOrder(null); }}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" }}>
          <Pressable style={StyleSheet.absoluteFill} onPress={Keyboard.dismiss} accessible={false} />
          <View style={{ backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 14 }}>
            <Text style={{ fontSize: 16, fontFamily: "Pretendard-Regular", color: C.text }}>레벨 변경 노트</Text>
            {pendingLevelOrder != null && (() => {
              const lv = levelInfo?.all_levels.find(l => l.level_order === pendingLevelOrder);
              return lv ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary }}>변경 레벨:</Text>
                  <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: (lv.badge_color ?? themeColor) + "20" }}>
                    <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: lv.badge_color ?? themeColor }}>{lv.level_name}</Text>
                  </View>
                </View>
              ) : null;
            })()}
            <TextInput
              style={{ borderWidth: 1.5, borderColor: C.border, borderRadius: 12, padding: 12, fontSize: 14, fontFamily: "Pretendard-Regular", minHeight: 80, textAlignVertical: "top" }}
              placeholder="변경 사유나 메모를 입력하세요 (선택)"
              placeholderTextColor={C.textMuted}
              value={levelNote}
              onChangeText={setLevelNote}
              multiline
            />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                style={{ flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: C.backgroundSoft, alignItems: "center" }}
                onPress={() => { setShowLevelNoteModal(false); setPendingLevelOrder(null); setLevelNote(""); }}
              >
                <Text style={{ fontSize: 15, fontFamily: "Pretendard-Regular", color: C.textSecondary }}>취소</Text>
              </Pressable>
              <Pressable
                style={{ flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: themeColor, alignItems: "center" }}
                onPress={confirmLevelChange}
              >
                <Text style={{ fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" }}>변경</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── 레벨 변경 결과 알림 ── */}
      <ConfirmModal
        visible={!!levelResult}
        title={levelResult?.ok ? "레벨 변경 완료" : "오류"}
        message={levelResult?.msg ?? ""}
        confirmText="확인"
        onConfirm={() => setLevelResult(null)}
      />

      {/* ── 보호자 연락처 편집 모달 ── */}
      <Modal
        visible={phoneEditModal.visible}
        transparent
        animationType="slide"
        onRequestClose={() => setPhoneEditModal(m => ({ ...m, visible: false }))}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" }}>
          <Pressable style={StyleSheet.absoluteFill} onPress={Keyboard.dismiss} accessible={false} />
          <View style={{ backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 14 }}>
            <Text style={{ fontSize: 16, fontFamily: "Pretendard-Regular", color: C.text }}>
              보호자 {phoneEditModal.slot} 연락처
            </Text>
            <TextInput
              style={{ borderWidth: 1.5, borderColor: C.border, borderRadius: 12, padding: 14, fontSize: 16, fontFamily: "Pretendard-Regular", letterSpacing: 1 }}
              placeholder="010-0000-0000"
              placeholderTextColor={C.textMuted}
              value={phoneEditModal.value}
              onChangeText={v => setPhoneEditModal(m => ({ ...m, value: v }))}
              keyboardType="phone-pad"
              autoFocus
            />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                style={{ flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: C.backgroundSoft, alignItems: "center" }}
                onPress={() => setPhoneEditModal(m => ({ ...m, visible: false }))}
              >
                <Text style={{ fontSize: 15, fontFamily: "Pretendard-Regular", color: C.textSecondary }}>취소</Text>
              </Pressable>
              <Pressable
                style={{ flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: themeColor, alignItems: "center" }}
                onPress={savePhoneEdit}
                disabled={phoneEditSaving}
              >
                {phoneEditSaving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={{ fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" }}>저장</Text>
                }
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── 보호자 연락처 삭제 확인 ── */}
      <ConfirmModal
        visible={phoneDeleteModal.visible}
        title="연락처 삭제"
        message={`보호자 ${phoneDeleteModal.slot} 연락처를 삭제하시겠습니까?${
          phoneDeleteModal.isLinked ? "\n\n⚠️ 이 번호로 학부모 앱이 연결되어 있습니다." : ""
        }`}
        confirmText="삭제"
        cancelText="취소"
        onConfirm={confirmPhoneDelete}
        onCancel={() => setPhoneDeleteModal(m => ({ ...m, visible: false }))}
      />

      {/* ── 레벨 선택 오버레이 ── */}
      {showLevelPicker && levelInfoCompat && (
        <SectionC_Level
          data={dataForLevel}
          themeColor={themeColor}
          levelInfo={levelInfoCompat as any}
          levelChanging={levelChanging}
          showLevelPicker={showLevelPicker}
          onOpenLevelPicker={() => setShowLevelPicker(true)}
          onCloseLevelPicker={() => setShowLevelPicker(false)}
          onLevelChange={handleLevelChange}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  moveSheet: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: "#fff",
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: "75%", paddingBottom: 32,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: "#D1D5DB",
    alignSelf: "center", marginTop: 10, marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: "row", alignItems: "flex-start",
    padding: 16, paddingTop: 8,
  },
  sheetTitle: { fontSize: 17, fontFamily: "Pretendard-Regular", color: Colors.light.text },
  sheetSub:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: Colors.light.textMuted, marginTop: 2 },
  classRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: "#F8FAFC",
  },
  className: { fontSize: 15, fontFamily: "Pretendard-Regular", color: Colors.light.text },
  classTime:  { fontSize: 12, fontFamily: "Pretendard-Regular", color: Colors.light.textMuted, marginTop: 2 },
});
