/**
 * (teacher)/student-detail.tsx
 * 선생님 모드 — 공통 회원 프로필 화면
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Modal, Pressable,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Colors from "@/constants/colors";
import { callPhone, sendSms, formatPhone, CALL_COLOR, SMS_COLOR } from "@/utils/phoneUtils";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { MemberStatusChangeModal } from "@/components/common/MemberStatusChangeModal";
import { LevelBadge, type LevelDef } from "@/components/common/LevelBadge";
import {
  getPrimaryStatus, PRIMARY_STATUS_BADGE, getMemberPendingBadge,
  getEffectiveWeekly, WEEKLY_BADGE,
  type StudentMember,
} from "@/utils/studentUtils";

const C = Colors.light;
const KO_DAYS = ["일", "월", "화", "수", "목", "금", "토"];

interface ParentLink {
  id: string;
  name: string;
  phone: string;
  link_status: string;
}
interface StudentDetail extends StudentMember {
  phone?: string | null;
  address?: string | null;
  gender?: string | null;
  parent_phone2?: string | null;
  parents?: ParentLink[];
  assignedClasses?: {
    id: string; name: string; schedule_days: string; schedule_time: string;
    student_count?: number; level?: string | null;
  }[];
}
interface AttendanceStat {
  total: number; present: number; absent: number; late: number;
}
interface LevelInfo {
  current_level_order: number | null;
  current_level: LevelDef | null;
  all_levels: LevelDef[];
}

function getBirthAge(birthYear?: string | null): string {
  if (!birthYear) return "";
  const y = parseInt(birthYear);
  if (isNaN(y)) return birthYear;
  const age = new Date().getFullYear() - y + 1;
  return `${birthYear}년생 (${age}세)`;
}
function colorFromId(id: string, fallback: string): string {
  const COLORS = ["#4EA7D8", "#2E9B6F", "#E4A93A", "#D96C6C", "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16"];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
  return COLORS[Math.abs(h) % COLORS.length];
}
function normalizePhone(p: string): string {
  return p.replace(/[^0-9]/g, "");
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

export default function StudentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const [student, setStudent] = useState<StudentDetail | null>(null);
  const [attStat, setAttStat] = useState<AttendanceStat | null>(null);
  const [levelInfo, setLevelInfo] = useState<LevelInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showWeeklyPicker, setShowWeeklyPicker] = useState(false);
  const [showLevelPicker,   setShowLevelPicker]   = useState(false);
  const [levelNote,         setLevelNote]         = useState("");
  const [pendingLevelOrder, setPendingLevelOrder] = useState<number | null>(null);
  const [levelResult, setLevelResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // 보호자 전화번호 편집 상태
  const [phoneEditModal, setPhoneEditModal] = useState<{
    visible: boolean; slot: 1 | 2; value: string;
  }>({ visible: false, slot: 1, value: "" });
  const [phoneEditSaving, setPhoneEditSaving] = useState(false);
  const [phoneDeleteModal, setPhoneDeleteModal] = useState<{
    visible: boolean; slot: 1 | 2; phone: string; isLinked: boolean;
  }>({ visible: false, slot: 1, phone: "", isLinked: false });

  const load = useCallback(async (silent = false) => {
    if (!id) return;
    if (!silent) setLoading(true);
    try {
      const [stRes, attRes, lvRes] = await Promise.all([
        apiRequest(token, `/students/${id}`),
        apiRequest(token, `/students/${id}/attendance`),
        apiRequest(token, `/teacher/students/${id}/level`),
      ]);
      if (stRes.ok) setStudent(await stRes.json());
      if (attRes.ok) {
        const arr: any[] = await attRes.json();
        const total = arr.length;
        const present = arr.filter(a => a.status === "present").length;
        const absent = arr.filter(a => a.status === "absent").length;
        const late = arr.filter(a => a.status === "late").length;
        setAttStat({ total, present, absent, late });
      }
      if (lvRes.ok) setLevelInfo(await lvRes.json());
    } catch (e) { console.error(e); }
    finally { if (!silent) setLoading(false); }
  }, [id, token]);

  useEffect(() => { load(); }, [load]);

  async function handleWeeklyChange(newCount: number) {
    if (!id || !student) return;
    const prevCount = student.weekly_count;
    setStudent(prev => prev ? { ...prev, weekly_count: newCount } : prev);
    setShowWeeklyPicker(false);
    apiRequest(token, `/students/${id}/weekly-count`, {
      method: "PATCH",
      body: JSON.stringify({ weekly_count: newCount }),
    }).then(r => {
      if (!r.ok) setStudent(prev => prev ? { ...prev, weekly_count: prevCount } : prev);
    }).catch(() => {
      setStudent(prev => prev ? { ...prev, weekly_count: prevCount } : prev);
    });
  }

  async function handleLevelChange() {
    if (!id || pendingLevelOrder == null) return;
    const levelOrder = pendingLevelOrder;
    const prevLevelInfo = levelInfo;
    const newLevel = levelInfo?.all_levels.find(l => l.level_order === levelOrder) ?? null;
    setShowLevelPicker(false);
    setPendingLevelOrder(null);
    setLevelNote("");
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
    } catch (e) {
      console.error(e);
      setLevelInfo(prevLevelInfo);
      setLevelResult({ ok: false, msg: "레벨 변경 중 오류가 발생했습니다." });
    }
  }

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
    if (status >= 500) return "서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
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
          parent_phone:  slot1 ? slot1.phone  : prev.parent_phone,
          parent_phone2: slot2 ? slot2.phone  : prev.parent_phone2,
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
        Alert.alert("오류", "서버 응답 오류가 발생했습니다.\n잠시 후 다시 시도해주세요.");
      } else {
        Alert.alert("저장 실패", getApiError(res.status, body));
      }
    } catch (e: any) {
      setStudent(prevStudent);
      const msg = typeof e?.message === "string" && e.message.includes("초과")
        ? e.message
        : "네트워크 연결을 확인해주세요.";
      Alert.alert("네트워크 오류", msg);
    } finally {
      setPhoneEditSaving(false);
    }
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
        Alert.alert("오류", "서버 응답 오류가 발생했습니다.\n잠시 후 다시 시도해주세요.");
      } else {
        Alert.alert("삭제 실패", getApiError(res.status, body));
      }
    } catch (e: any) {
      setStudent(prevStudent);
      Alert.alert("네트워크 오류", "네트워크 연결을 확인해주세요.");
    } finally {
      setPhoneEditSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={s.safe}>
        <SubScreenHeader title="회원 정보" homePath="/(teacher)/today-schedule" />
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
      </View>
    );
  }
  if (!student) {
    return (
      <View style={s.safe}>
        <SubScreenHeader title="회원 정보" homePath="/(teacher)/today-schedule" />
        <View style={s.emptyBox}>
          <LucideIcon name="user-x" size={40} color={C.textMuted} />
          <Text style={s.emptyText}>회원 정보를 불러올 수 없습니다</Text>
        </View>
      </View>
    );
  }

  const ps = getPrimaryStatus(student as any);
  const primaryBadge = PRIMARY_STATUS_BADGE[ps];
  const pendingBadge = getMemberPendingBadge(student as any);
  const wc = student.weekly_count ? getEffectiveWeekly(student as any) : null;
  const weeklyBadge = wc ? WEEKLY_BADGE[wc] : null;

  const phones: (string | null | undefined)[] = [student.parent_phone, student.parent_phone2];
  const hasSlot1 = !!student.parent_phone;

  return (
    <View style={s.safe}>
      <SubScreenHeader title={student.name} homePath="/(teacher)/today-schedule" />
      <KeyboardAwareScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
        contentContainerStyle={s.content}>

        {/* ── 프로필 헤더 카드 ────────────────────────────────── */}
        <View style={s.profileCard}>
          <View style={{ alignItems: "center", gap: 6 }}>
            <View style={[s.avatarWrap, { backgroundColor: themeColor + "18" }]}>
              <Text style={[s.avatarText, { color: themeColor }]}>{student.name[0]}</Text>
            </View>
            <LevelBadge level={levelInfo?.current_level ?? null} size="sm" showName />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.studentName}>{student.name}</Text>
            {student.birth_year && (
              <Text style={s.studentSub}>{getBirthAge(student.birth_year)}</Text>
            )}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              <View style={[s.statusBadge, { backgroundColor: primaryBadge.bg }]}>
                <Text style={[s.statusText, { color: primaryBadge.color }]}>{primaryBadge.label}</Text>
              </View>
              {weeklyBadge ? (
                <Pressable
                  style={[s.statusBadge, s.weeklyBadgeBtn, { backgroundColor: weeklyBadge.bg }]}
                  onPress={() => setShowWeeklyPicker(true)}
                >
                  <Text style={[s.statusText, { color: weeklyBadge.color }]}>{weeklyBadge.label}</Text>
                  <LucideIcon name="edit-2" size={9} color={weeklyBadge.color} style={{ marginLeft: 3 }} />
                </Pressable>
              ) : (
                <Pressable
                  style={[s.statusBadge, s.weeklyBadgeBtn, { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#D1D5DB", borderStyle: "dashed" }]}
                  onPress={() => setShowWeeklyPicker(true)}
                >
                  <LucideIcon name="plus" size={10} color="#64748B" />
                  <Text style={[s.statusText, { color: "#64748B", marginLeft: 3 }]}>주 횟수</Text>
                </Pressable>
              )}
              {pendingBadge && (
                <View style={[s.statusBadge, { backgroundColor: pendingBadge.bg }]}>
                  <Text style={[s.statusText, { color: pendingBadge.color }]}>{pendingBadge.label}</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* ── 레벨 관리 카드 ────────────────────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>수영 레벨</Text>
          <View style={s.card}>
            <View style={s.statusRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <LevelBadge level={levelInfo?.current_level ?? null} size="md" />
                <View>
                  <Text style={{ fontSize: 12, color: C.textSecondary, fontFamily: "Pretendard-Regular" }}>현재 레벨</Text>
                  <Text style={{ fontSize: 16, fontFamily: "Pretendard-Regular", color: C.text, marginTop: 2 }}>
                    {levelInfo?.current_level?.level_name ?? "미지정"}
                  </Text>
                  {levelInfo?.current_level?.is_active === false && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 }}>
                      <LucideIcon name="eye-off" size={11} color="#D97706" />
                      <Text style={{ fontSize: 11, color: "#D97706", fontFamily: "Pretendard-Regular" }}>사용 안 함 레벨</Text>
                    </View>
                  )}
                  {levelInfo?.current_level?.level_description && levelInfo.current_level.is_active !== false ? (
                    <Text style={{ fontSize: 11, color: C.textSecondary, fontFamily: "Pretendard-Regular", marginTop: 2 }} numberOfLines={1}>
                      {levelInfo.current_level.level_description}
                    </Text>
                  ) : null}
                </View>
              </View>
              <Pressable
                style={[s.changeBtn, { borderColor: themeColor }]}
                onPress={() => { setPendingLevelOrder(null); setShowLevelPicker(true); }}
              >
                <LucideIcon name="edit-2" size={14} color={themeColor} />
                <Text style={[s.changeBtnText, { color: themeColor }]}>레벨 변경</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {/* ── 상태 관리 카드 ─────────────────────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>상태 관리</Text>
          <View style={s.card}>
            <View style={s.statusRow}>
              <View style={{ gap: 4 }}>
                <Text style={s.statusRowLabel}>현재 상태</Text>
                <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                  <View style={[s.statusBadgeLg, { backgroundColor: primaryBadge.bg }]}>
                    <Text style={[s.statusBadgeLgText, { color: primaryBadge.color }]}>{primaryBadge.label}</Text>
                  </View>
                  {pendingBadge && (
                    <View style={[s.statusBadgeLg, { backgroundColor: pendingBadge.bg }]}>
                      <Text style={[s.statusBadgeLgText, { color: pendingBadge.color }]}>{pendingBadge.label}</Text>
                    </View>
                  )}
                </View>
              </View>
              <Pressable style={[s.changeBtn, { borderColor: themeColor }]}
                onPress={() => setShowStatusModal(true)}>
                <Text style={[s.changeBtnText, { color: themeColor }]}>상태 변경</Text>
              </Pressable>
            </View>
            <View style={s.divider} />
            <InfoRow icon="calendar" label="등록일"
              value={student.created_at ? new Date(student.created_at).toLocaleDateString("ko-KR") : "-"} />
            <InfoRow icon="map-pin" label="등록 경로"
              value={student.registration_path === "admin_created" ? "관리자 직접" : "학부모 요청"} />
          </View>
        </View>

        {/* ── 기본 정보 ──────────────────────────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>기본 정보</Text>
          <View style={s.card}>
            <InfoRow icon="user" label="이름" value={student.name} />
            {student.birth_year && (
              <InfoRow icon="calendar" label="생년" value={getBirthAge(student.birth_year)} />
            )}
            {student.gender && (
              <InfoRow icon="users" label="성별"
                value={student.gender === "male" ? "남" : student.gender === "female" ? "여" : student.gender} />
            )}
            {student.parent_name && (
              <InfoRow icon="user" label="학부모" value={student.parent_name} />
            )}
          </View>
        </View>

        {/* ── 학부모 연락처 ─────────────────────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>학부모 연락처</Text>
          <View style={s.card}>
            {phones.map((ph, idx) => {
              const slot = (idx + 1) as 1 | 2;
              const isSlot2 = idx === 1;
              // 슬롯 2는 슬롯 1이 있을 때만 표시
              if (isSlot2 && !hasSlot1) return null;

              if (!ph) {
                return (
                  <View key={slot}>
                    {isSlot2 && <View style={s.divider} />}
                    <Pressable
                      style={s.addPhoneRow}
                      onPress={() => setPhoneEditModal({ visible: true, slot, value: "" })}
                    >
                      <LucideIcon name="plus-circle" size={15} color={themeColor} />
                      <Text style={[s.addPhoneText, { color: themeColor }]}>보호자 {slot} 추가</Text>
                    </Pressable>
                  </View>
                );
              }

              const connStatus = getPhoneConnStatus(ph, student.parents);
              return (
                <View key={slot}>
                  {isSlot2 && <View style={s.divider} />}
                  <View style={s.guardianRow}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={s.guardianSlotLabel}>보호자 {slot}</Text>
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
                      <View style={[
                        s.connBadge,
                        { backgroundColor: connStatus === "linked" ? "#E6FFFA" : "#FFF7ED" }
                      ]}>
                        <LucideIcon
                          name={connStatus === "linked" ? "check-circle" : "clock"}
                          size={11}
                          color={connStatus === "linked" ? "#2EC4B6" : "#EA580C"}
                        />
                        <Text style={[
                          s.connBadgeText,
                          { color: connStatus === "linked" ? "#2EC4B6" : "#EA580C" }
                        ]}>
                          {connStatus === "linked" ? "연결됨" : "가입 대기"}
                        </Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: "row", gap: 6 }}>
                      <Pressable
                        style={s.phoneIconBtn}
                        onPress={() => setPhoneEditModal({ visible: true, slot, value: formatPhone(ph) })}
                        hitSlop={8}
                      >
                        <LucideIcon name="edit-2" size={14} color={themeColor} />
                      </Pressable>
                      <Pressable
                        style={s.phoneIconBtn}
                        onPress={() => setPhoneDeleteModal({
                          visible: true, slot, phone: ph,
                          isLinked: connStatus === "linked",
                        })}
                        hitSlop={8}
                      >
                        <LucideIcon name="trash-2" size={14} color="#D96C6C" />
                      </Pressable>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        {/* ── 수강 반 ──────────────────────────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>수강 반</Text>
          {(!student.assignedClasses || student.assignedClasses.length === 0) ? (
            <View style={[s.card, s.emptyCard]}>
              <LucideIcon name="layers" size={24} color={C.textMuted} />
              <Text style={s.emptyCardText}>배정된 반이 없습니다</Text>
            </View>
          ) : (
            <View style={s.card}>
              {student.assignedClasses.map((cls, i) => {
                const days = cls.schedule_days.split(",").map(d => {
                  const n = parseInt(d.trim());
                  return isNaN(n) ? d.trim() : (KO_DAYS[n] ?? d.trim());
                }).join("·");
                return (
                  <View key={cls.id}>
                    {i > 0 && <View style={s.divider} />}
                    <View style={s.classRow}>
                      <View style={[s.colorBar, { backgroundColor: colorFromId(cls.id, themeColor) }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.className}>{cls.name}</Text>
                        <Text style={s.classMeta}>
                          {days} · {cls.schedule_time}{cls.level ? ` · ${cls.level}` : ""}
                        </Text>
                      </View>
                      <Pressable
                        style={[s.goBtn, { borderColor: themeColor + "40" }]}
                        onPress={() => router.push({
                          pathname: "/(teacher)/attendance",
                          params: { classGroupId: cls.id, backTo: "student-detail" },
                        } as any)}>
                        <Text style={[s.goBtnText, { color: themeColor }]}>출결</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* ── 출결 현황 ─────────────────────────────────────── */}
        {attStat && attStat.total > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>출결 현황</Text>
            <View style={[s.card, s.attRow]}>
              <AttBox label="전체" value={attStat.total} color={themeColor} />
              <View style={s.attDivider} />
              <AttBox label="출석" value={attStat.present} color="#2EC4B6" />
              <AttBox label="결석" value={attStat.absent} color="#D96C6C" />
              <AttBox label="지각" value={attStat.late} color="#D97706" />
              <AttBox
                label="출석률"
                value={attStat.total > 0 ? `${Math.round((attStat.present / attStat.total) * 100)}%` : "-"}
                color={attStat.total > 0 && (attStat.present / attStat.total) >= 0.8 ? "#2EC4B6" : "#D97706"}
              />
            </View>
          </View>
        )}
        <View style={{ height: 100 }} />
      </KeyboardAwareScrollView>

      {/* ── 상태 변경 모달 ──────────────────────────────────── */}
      <MemberStatusChangeModal
        visible={showStatusModal}
        studentId={id!}
        studentName={student.name}
        currentStatus={student.status}
        pendingStatusChange={student.pending_status_change}
        pendingEffectiveMode={student.pending_effective_mode}
        onClose={() => setShowStatusModal(false)}
        onChanged={({ status: newStatus }) => {
          setStudent(prev => {
            if (!prev) return prev;
            if (newStatus === "unassigned") {
              return { ...prev, assigned_class_ids: [], class_group_id: null, schedule_labels: null };
            } else if (newStatus === "suspended" || newStatus === "withdrawn") {
              return { ...prev, status: newStatus as any, assigned_class_ids: [], class_group_id: null };
            } else if (newStatus === "active") {
              return { ...prev, status: "active" };
            }
            return prev;
          });
          load();
        }}
      />

      {/* ── 주 횟수 선택 모달 ──────────────────────────────── */}
      <Modal visible={showWeeklyPicker} transparent animationType="fade" onRequestClose={() => setShowWeeklyPicker(false)}>
        <Pressable style={s.pickerOverlay} onPress={() => setShowWeeklyPicker(false)}>
          <View style={[s.pickerSheet, { backgroundColor: C.card }]}>
            <Text style={s.pickerTitle}>주 수업 횟수 변경</Text>
            <Text style={s.pickerSub}>{student.name} 회원의 주 수업 횟수</Text>
            <View style={s.pickerOptions}>
              {[1, 2, 3].map(count => {
                const badge = WEEKLY_BADGE[count as 1 | 2 | 3];
                const isCurrent = (student.weekly_count || 1) === count;
                return (
                  <Pressable
                    key={count}
                    style={[s.pickerOption, { borderColor: isCurrent ? badge.color : C.border, backgroundColor: isCurrent ? badge.bg : C.background }]}
                    onPress={() => handleWeeklyChange(count)}
                  >
                    <Text style={[s.pickerOptionText, { color: isCurrent ? badge.color : C.text }]}>
                      주 {count}회
                    </Text>
                    {isCurrent && <LucideIcon name="check" size={16} color={badge.color} />}
                  </Pressable>
                );
              })}
            </View>
            <Pressable style={s.pickerCancel} onPress={() => setShowWeeklyPicker(false)}>
              <Text style={s.pickerCancelText}>취소</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* ── 레벨 선택 모달 ──────────────────────────────────── */}
      <Modal
        visible={showLevelPicker} transparent animationType="slide"
        onRequestClose={() => { setShowLevelPicker(false); setPendingLevelOrder(null); }}
      >
        <Pressable style={s.pickerOverlay} onPress={() => { setShowLevelPicker(false); setPendingLevelOrder(null); }}>
          <View style={[s.pickerSheet, { backgroundColor: C.card, maxHeight: 560 }]}
            onStartShouldSetResponder={() => true}>
            <Text style={s.pickerTitle}>레벨 변경</Text>
            <Text style={s.pickerSub}>{student.name} 학생의 새 레벨을 선택하세요</Text>
            <View style={{ maxHeight: 260, overflow: "hidden" }}>
              <KeyboardAwareScrollView showsVerticalScrollIndicator={false}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 4 }}>
                  {(levelInfo?.all_levels ?? []).filter(lv => lv.is_active !== false).map(lv => {
                    const isCurrent = lv.level_order === levelInfo?.current_level_order;
                    const isPending = lv.level_order === pendingLevelOrder;
                    return (
                      <Pressable
                        key={lv.level_order}
                        style={[
                          s.levelPickerItem,
                          isCurrent && !isPending && { borderColor: "#94A3B8", backgroundColor: "#F8FAFC" },
                          isPending && { borderColor: themeColor, borderWidth: 2, backgroundColor: themeColor + "12" },
                        ]}
                        onPress={() => setPendingLevelOrder(lv.level_order)}
                      >
                        <LevelBadge level={lv} size="sm" />
                        <Text style={[s.levelPickerLabel, isPending && { color: themeColor, fontFamily: "Pretendard-SemiBold" }]}>
                          {lv.level_name}
                        </Text>
                        {isCurrent && !isPending && <Text style={{ fontSize: 9, color: "#94A3B8" }}>현재</Text>}
                        {isPending && <LucideIcon name="check" size={12} color={themeColor} />}
                      </Pressable>
                    );
                  })}
                </View>
              </KeyboardAwareScrollView>
            </View>
            <View style={{ gap: 8, marginTop: 8 }}>
              <Text style={s.pickerSub}>변경 메모 (선택)</Text>
              <TextInput
                style={s.noteInput}
                value={levelNote}
                onChangeText={setLevelNote}
                placeholder="예: 자유형 25m 완주 달성"
                placeholderTextColor={C.textMuted}
              />
            </View>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
              <Pressable style={[s.pickerCancel, { flex: 1 }]} onPress={() => { setShowLevelPicker(false); setPendingLevelOrder(null); }}>
                <Text style={s.pickerCancelText}>취소</Text>
              </Pressable>
              <Pressable
                style={[s.levelConfirmBtn, { backgroundColor: pendingLevelOrder != null ? themeColor : "#CBD5E1", flex: 1.5 }]}
                onPress={handleLevelChange}
                disabled={pendingLevelOrder == null}
              >
                <Text style={s.levelConfirmBtnText}>변경 완료</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* ── 레벨 변경 결과 모달 ── */}
      <Modal visible={!!levelResult} transparent animationType="fade" onRequestClose={() => setLevelResult(null)}>
        <Pressable style={s.pickerOverlay} onPress={() => setLevelResult(null)}>
          <View style={[s.pickerSheet, { backgroundColor: C.card, gap: 12 }]} onStartShouldSetResponder={() => true}>
            <Text style={[s.pickerTitle, { fontSize: 16 }]}>{levelResult?.ok ? "✅ 완료" : "❌ 실패"}</Text>
            <Text style={[s.pickerSub, { textAlign: "center", lineHeight: 22 }]}>{levelResult?.msg}</Text>
            <Pressable style={[s.levelConfirmBtn, { backgroundColor: levelResult?.ok ? themeColor : "#EF4444" }]} onPress={() => setLevelResult(null)}>
              <Text style={s.levelConfirmBtnText}>확인</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* ── 전화번호 추가/수정 모달 ─────────────────────────── */}
      <Modal
        visible={phoneEditModal.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setPhoneEditModal(m => ({ ...m, visible: false }))}
      >
        <Pressable
          style={s.pickerOverlay}
          onPress={() => setPhoneEditModal(m => ({ ...m, visible: false }))}
        >
          <View
            style={[s.pickerSheet, { backgroundColor: C.card }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={s.pickerTitle}>
              보호자 {phoneEditModal.slot} {phoneEditModal.value ? "수정" : "추가"}
            </Text>
            <Text style={s.pickerSub}>
              전화번호를 입력하세요 (010-0000-0000 형식)
            </Text>
            <TextInput
              style={s.phoneInput}
              value={phoneEditModal.value}
              onChangeText={v => setPhoneEditModal(m => ({ ...m, value: v }))}
              placeholder="010-0000-0000"
              placeholderTextColor={C.textMuted}
              keyboardType="phone-pad"
              autoFocus
            />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                style={[s.pickerCancel, { flex: 1 }]}
                onPress={() => setPhoneEditModal(m => ({ ...m, visible: false }))}
              >
                <Text style={s.pickerCancelText}>취소</Text>
              </Pressable>
              <Pressable
                style={[s.levelConfirmBtn, {
                  flex: 1.5,
                  backgroundColor: phoneEditModal.value.trim() ? themeColor : "#CBD5E1",
                }]}
                onPress={savePhoneEdit}
                disabled={phoneEditSaving || !phoneEditModal.value.trim()}
              >
                <Text style={s.levelConfirmBtnText}>
                  {phoneEditSaving ? "저장 중..." : "저장"}
                </Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* ── 전화번호 삭제 확인 모달 ─────────────────────────── */}
      <Modal
        visible={phoneDeleteModal.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setPhoneDeleteModal(m => ({ ...m, visible: false }))}
      >
        <Pressable
          style={s.pickerOverlay}
          onPress={() => setPhoneDeleteModal(m => ({ ...m, visible: false }))}
        >
          <View
            style={[s.pickerSheet, { backgroundColor: C.card, gap: 12 }]}
            onStartShouldSetResponder={() => true}
          >
            <LucideIcon name="trash-2" size={28} color="#D96C6C" style={{ alignSelf: "center" }} />
            <Text style={[s.pickerTitle, { fontSize: 16 }]}>보호자 연락처 삭제</Text>
            <Text style={[s.pickerSub, { textAlign: "center", lineHeight: 20 }]}>
              {formatPhone(phoneDeleteModal.phone)} 연락처를 삭제하시겠습니까?
            </Text>
            {phoneDeleteModal.isLinked && (
              <View style={s.warnBox}>
                <LucideIcon name="alert-triangle" size={14} color="#D97706" />
                <Text style={s.warnText}>
                  연결된 보호자가 있습니다. 삭제하면 해당 보호자의 학생 연결도 해제됩니다.
                </Text>
              </View>
            )}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                style={[s.pickerCancel, { flex: 1 }]}
                onPress={() => setPhoneDeleteModal(m => ({ ...m, visible: false }))}
              >
                <Text style={s.pickerCancelText}>취소</Text>
              </Pressable>
              <Pressable
                style={[s.levelConfirmBtn, { flex: 1.5, backgroundColor: "#D96C6C" }]}
                onPress={confirmPhoneDelete}
                disabled={phoneEditSaving}
              >
                <Text style={s.levelConfirmBtnText}>
                  {phoneEditSaving ? "삭제 중..." : "삭제"}
                </Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

// ── 서브 컴포넌트 ──────────────────────────────────────────────────────
function InfoRow({
  icon, label, value, valueColor,
}: {
  icon: any; label: string; value: string; valueColor?: string;
}) {
  return (
    <View style={s.infoRow}>
      <LucideIcon name={icon} size={14} color={C.textMuted} style={{ marginTop: 1 }} />
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={[s.infoValue, valueColor ? { color: valueColor } : undefined]}>{value}</Text>
    </View>
  );
}
function AttBox({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <View style={s.attBox}>
      <Text style={[s.attValue, { color }]}>{value}</Text>
      <Text style={s.attLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: C.background },
  content:        { padding: 16, gap: 16 },
  profileCard:    { backgroundColor: C.card, borderRadius: 16, padding: 16,
                    flexDirection: "row", alignItems: "flex-start", gap: 14,
                    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  avatarWrap:     { width: 60, height: 60, borderRadius: 18, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  avatarText:     { fontSize: 24, fontFamily: "Pretendard-Regular" },
  studentName:    { fontSize: 20, fontFamily: "Pretendard-Regular", color: C.text },
  studentSub:     { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 2 },
  statusBadge:    { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  statusText:     { fontSize: 11, fontFamily: "Pretendard-Regular" },
  weeklyBadgeBtn: { flexDirection: "row", alignItems: "center" },
  pickerOverlay:  { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: 32 },
  pickerSheet:    { width: "100%", borderRadius: 20, padding: 24, gap: 16 },
  pickerTitle:    { fontSize: 17, fontFamily: "Pretendard-Regular", color: "#0F172A", textAlign: "center" },
  pickerSub:      { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B", textAlign: "center", marginTop: -8 },
  pickerOptions:  { flexDirection: "row", gap: 10 },
  pickerOption:   { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
                    paddingVertical: 14, borderRadius: 14, borderWidth: 2 },
  pickerOptionText: { fontSize: 16, fontFamily: "Pretendard-Regular" },
  pickerCancel:   { alignItems: "center", paddingVertical: 12, borderRadius: 12,
                    borderWidth: 1.5, borderColor: "#E5E7EB" },
  pickerCancelText: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#64748B" },
  levelPickerItem: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1.5, borderColor: C.border, backgroundColor: C.background,
  },
  levelPickerLabel: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text },
  noteInput: {
    borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
    fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text,
  },
  levelConfirmBtn: {
    alignItems: "center", paddingVertical: 13, borderRadius: 12,
  },
  levelConfirmBtnText: {
    fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#fff",
  },
  section:        { gap: 8 },
  sectionTitle:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, paddingLeft: 4 },
  card:           { backgroundColor: C.card, borderRadius: 16, overflow: "hidden" },
  statusRow:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                    paddingHorizontal: 16, paddingVertical: 14 },
  statusRowLabel: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginBottom: 4 },
  statusBadgeLg:  { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  statusBadgeLgText:{ fontSize: 13, fontFamily: "Pretendard-Regular" },
  changeBtn:      { flexDirection: "row", alignItems: "center", gap: 5,
                    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5 },
  changeBtnText:  { fontSize: 13, fontFamily: "Pretendard-Regular" },
  infoRow:        { flexDirection: "row", alignItems: "center", gap: 8,
                    paddingHorizontal: 16, paddingVertical: 12,
                    borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  infoLabel:      { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, width: 80 },
  infoValue:      { flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text, textAlign: "right" },
  divider:        { height: 1, backgroundColor: "#F1F5F9", marginHorizontal: 14 },
  classRow:       { flexDirection: "row", alignItems: "center", gap: 10, padding: 14 },
  colorBar:       { width: 4, height: 40, borderRadius: 2 },
  className:      { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  classMeta:      { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 },
  goBtn:          { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1.5 },
  goBtnText:      { fontSize: 12, fontFamily: "Pretendard-Regular" },
  attRow:         { flexDirection: "row", padding: 16 },
  attBox:         { flex: 1, alignItems: "center", gap: 4 },
  attValue:       { fontSize: 18, fontFamily: "Pretendard-Regular" },
  attLabel:       { fontSize: 10, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  attDivider:     { width: 1, backgroundColor: C.border, marginVertical: 4 },
  emptyCard:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
  emptyCardText:  { fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Regular" },
  emptyBox:       { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyText:      { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted },
  // 학부모 연락처 섹션
  guardianRow:    { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, gap: 10 },
  guardianSlotLabel: { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  connBadge:      { flexDirection: "row", alignItems: "center", gap: 4,
                    alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  connBadgeText:  { fontSize: 11, fontFamily: "Pretendard-Regular" },
  phoneIconBtn:   { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center",
                    backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#E5E7EB" },
  addPhoneRow:    { flexDirection: "row", alignItems: "center", gap: 8,
                    paddingHorizontal: 16, paddingVertical: 14 },
  addPhoneText:   { fontSize: 14, fontFamily: "Pretendard-Regular" },
  phoneInput:     { borderWidth: 1.5, borderColor: C.border, borderRadius: 12,
                    paddingHorizontal: 14, paddingVertical: 12,
                    fontSize: 15, fontFamily: "Pretendard-Regular", color: C.text,
                    letterSpacing: 1 },
  warnBox:        { flexDirection: "row", alignItems: "flex-start", gap: 8,
                    backgroundColor: "#FFFBEB", borderRadius: 10, padding: 12 },
  warnText:       { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", color: "#92400E", lineHeight: 18 },
});
