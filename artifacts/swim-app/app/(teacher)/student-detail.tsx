/**
 * (teacher)/student-detail.tsx
 * 선생님 모드 — 공통 회원 프로필 화면
 *
 * 모든 진입 경로에서 동일한 화면 사용:
 * 회원관리 탭 / 반배정 / 출결 / 수업관리 / 보강관리 등
 *
 * 기능:
 * - 기본정보 / 수업정보 / 출결 현황 섹션
 * - 상태 배지 (대표 상태 + 예약 상태)
 * - 상태 변경 버튼 → MemberStatusChangeModal 공통 팝업
 * - 레벨 뱃지 + 레벨 변경 기능
 */
import { Check, EyeOff, Layers, PenLine, Phone, Plus, UserX } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import Colors from "@/constants/colors";
import { callPhone, formatPhone, CALL_COLOR } from "@/utils/phoneUtils";
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

interface StudentDetail extends StudentMember {
  phone?: string | null;
  address?: string | null;
  gender?: string | null;
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
  const [weeklyChanging, setWeeklyChanging] = useState(false);
  const [showLevelPicker, setShowLevelPicker] = useState(false);
  const [levelChanging, setLevelChanging] = useState(false);
  const [levelNote, setLevelNote] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
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
    finally { setLoading(false); }
  }, [id, token]);

  useEffect(() => { load(); }, [load]);

  async function handleWeeklyChange(newCount: number) {
    if (!id || !student) return;
    setWeeklyChanging(true);
    setShowWeeklyPicker(false);
    try {
      const r = await apiRequest(token, `/students/${id}/weekly-count`, {
        method: "PATCH",
        body: JSON.stringify({ weekly_count: newCount }),
      });
      if (r.ok) {
        setStudent(prev => prev ? { ...prev, weekly_count: newCount } : prev);
      }
    } catch (e) { console.error(e); }
    finally { setWeeklyChanging(false); }
  }

  async function handleLevelChange(levelOrder: number) {
    if (!id) return;
    setLevelChanging(true);
    setShowLevelPicker(false);
    try {
      const res = await apiRequest(token, `/teacher/students/${id}/level`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level_order: levelOrder, note: levelNote || null }),
      });
      if (res.ok) {
        setLevelNote("");
        await load();
      }
    } catch (e) { console.error(e); }
    finally { setLevelChanging(false); }
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
          <UserX size={40} color={C.textMuted} />
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

  return (
    <View style={s.safe}>
      <SubScreenHeader title={student.name} homePath="/(teacher)/today-schedule" />

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
        contentContainerStyle={s.content}>

        {/* ── 프로필 헤더 카드 ────────────────────────────────── */}
        <View style={s.profileCard}>
          <View style={{ alignItems: "center", gap: 6 }}>
            <View style={[s.avatarWrap, { backgroundColor: themeColor + "18" }]}>
              <Text style={[s.avatarText, { color: themeColor }]}>{student.name[0]}</Text>
            </View>
            {/* 레벨 뱃지 */}
            {levelChanging
              ? <ActivityIndicator size="small" color={themeColor} />
              : <LevelBadge level={levelInfo?.current_level ?? null} size="sm" showName />
            }
          </View>

          <View style={{ flex: 1 }}>
            <Text style={s.studentName}>{student.name}</Text>
            {student.birth_year && (
              <Text style={s.studentSub}>{getBirthAge(student.birth_year)}</Text>
            )}

            {/* 상태 배지들 */}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              <View style={[s.statusBadge, { backgroundColor: primaryBadge.bg }]}>
                <Text style={[s.statusText, { color: primaryBadge.color }]}>{primaryBadge.label}</Text>
              </View>
              {weeklyChanging ? (
                <View style={[s.statusBadge, s.weeklyBadgeBtn, { backgroundColor: "#FFFFFF" }]}>
                  <ActivityIndicator size={10} color="#64748B" />
                </View>
              ) : weeklyBadge ? (
                <Pressable
                  style={[s.statusBadge, s.weeklyBadgeBtn, { backgroundColor: weeklyBadge.bg }]}
                  onPress={() => setShowWeeklyPicker(true)}
                >
                  <Text style={[s.statusText, { color: weeklyBadge.color }]}>{weeklyBadge.label}</Text>
                  <PenLine size={9} color={weeklyBadge.color} style={{ marginLeft: 3 }} />
                </Pressable>
              ) : (
                <Pressable
                  style={[s.statusBadge, s.weeklyBadgeBtn, { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#D1D5DB", borderStyle: "dashed" }]}
                  onPress={() => setShowWeeklyPicker(true)}
                >
                  <Plus size={10} color="#64748B" />
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
                  <Text style={{ fontSize: 16, fontFamily: "Pretendard-Bold", color: C.text, marginTop: 2 }}>
                    {levelInfo?.current_level?.level_name ?? "미지정"}
                  </Text>
                  {levelInfo?.current_level?.is_active === false && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 }}>
                      <EyeOff size={11} color="#D97706" />
                      <Text style={{ fontSize: 11, color: "#D97706", fontFamily: "Pretendard-SemiBold" }}>사용 안 함 레벨</Text>
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
                onPress={() => setShowLevelPicker(true)}
              >
                <PenLine size={14} color={themeColor} />
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
                <PenLine size={14} color={themeColor} />
                <Text style={[s.changeBtnText, { color: themeColor }]}>상태 변경</Text>
              </Pressable>
            </View>

            <View style={s.divider} />

            <InfoRow icon="calendar" label="등록일"
              value={student.created_at ? new Date(student.created_at).toLocaleDateString("ko-KR") : "-"} />
            <InfoRow icon="map-pin" label="등록 경로"
              value={student.registration_path === "admin_created" ? "관리자 직접" : "학부모 요청"} />
            <InfoRow icon="link" label="학부모 연결"
              value={student.parent_user_id ? "연결됨" : student.status === "pending_parent_link" ? "대기 중" : "학부모미연결"}
              valueColor={student.parent_user_id ? "#2EC4B6" : student.status === "pending_parent_link" ? "#EA580C" : "#64748B"} />
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
              <InfoRow icon="user" label="보호자" value={student.parent_name} />
            )}
            {student.parent_phone && (
              <Pressable
                style={s.infoRow}
                onPress={() => callPhone(student.parent_phone)}
              >
                <Phone size={14} color={CALL_COLOR} style={{ marginTop: 1 }} />
                <Text style={s.infoLabel}>연락처</Text>
                <Text style={[s.infoValue, { color: CALL_COLOR }]}>{formatPhone(student.parent_phone)}</Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* ── 수강 반 ──────────────────────────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>수강 반</Text>
          {(!student.assignedClasses || student.assignedClasses.length === 0) ? (
            <View style={[s.card, s.emptyCard]}>
              <Layers size={24} color={C.textMuted} />
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
                          params: { classGroupId: cls.id },
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
              <View style={s.attDivider} />
              <AttBox label="결석" value={attStat.absent} color="#D96C6C" />
              <View style={s.attDivider} />
              <AttBox label="지각" value={attStat.late} color="#D97706" />
              <View style={s.attDivider} />
              <AttBox
                label="출석률"
                value={attStat.total > 0 ? `${Math.round((attStat.present / attStat.total) * 100)}%` : "-"}
                color={attStat.total > 0 && (attStat.present / attStat.total) >= 0.8 ? "#2EC4B6" : "#D97706"}
              />
            </View>
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* ── 상태 변경 모달 ──────────────────────────────────── */}
      <MemberStatusChangeModal
        visible={showStatusModal}
        studentId={id!}
        studentName={student.name}
        currentStatus={student.status}
        pendingStatusChange={student.pending_status_change}
        pendingEffectiveMode={student.pending_effective_mode}
        onClose={() => setShowStatusModal(false)}
        onChanged={() => load()}
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
                    {isCurrent && <Check size={16} color={badge.color} />}
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
      <Modal visible={showLevelPicker} transparent animationType="slide" onRequestClose={() => setShowLevelPicker(false)}>
        <Pressable style={s.pickerOverlay} onPress={() => setShowLevelPicker(false)}>
          <View style={[s.pickerSheet, { backgroundColor: C.card, maxHeight: 520 }]}
            onStartShouldSetResponder={() => true}>
            <Text style={s.pickerTitle}>레벨 변경</Text>
            <Text style={s.pickerSub}>{student.name} 학생의 현재 레벨을 선택하세요</Text>
            <View style={{ maxHeight: 260, overflow: "hidden" }}>
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 4 }}>
                  {(levelInfo?.all_levels ?? []).filter(lv => lv.is_active !== false).map(lv => {
                    const isCurrent = lv.level_order === levelInfo?.current_level_order;
                    return (
                      <Pressable
                        key={lv.level_order}
                        style={[
                          s.levelPickerItem,
                          isCurrent && { borderColor: themeColor, backgroundColor: themeColor + "10" }
                        ]}
                        onPress={() => handleLevelChange(lv.level_order)}
                      >
                        <LevelBadge level={lv} size="sm" />
                        <Text style={[s.levelPickerLabel, isCurrent && { color: themeColor }]}>
                          {lv.level_name}
                        </Text>
                        {isCurrent && <Check size={12} color={themeColor} />}
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
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
            <Pressable style={s.pickerCancel} onPress={() => setShowLevelPicker(false)}>
              <Text style={s.pickerCancelText}>취소</Text>
            </Pressable>
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
  avatarText:     { fontSize: 24, fontFamily: "Pretendard-Bold" },
  studentName:    { fontSize: 20, fontFamily: "Pretendard-Bold", color: C.text },
  studentSub:     { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 2 },
  statusBadge:    { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  statusText:     { fontSize: 11, fontFamily: "Pretendard-SemiBold" },
  weeklyBadgeBtn: { flexDirection: "row", alignItems: "center" },

  pickerOverlay:  { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: 32 },
  pickerSheet:    { width: "100%", borderRadius: 20, padding: 24, gap: 16 },
  pickerTitle:    { fontSize: 17, fontFamily: "Pretendard-Bold", color: "#0F172A", textAlign: "center" },
  pickerSub:      { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B", textAlign: "center", marginTop: -8 },
  pickerOptions:  { flexDirection: "row", gap: 10 },
  pickerOption:   { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
                    paddingVertical: 14, borderRadius: 14, borderWidth: 2 },
  pickerOptionText: { fontSize: 16, fontFamily: "Pretendard-Bold" },
  pickerCancel:   { alignItems: "center", paddingVertical: 12, borderRadius: 12,
                    borderWidth: 1.5, borderColor: "#E5E7EB" },
  pickerCancelText: { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#64748B" },

  levelPickerItem: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1.5, borderColor: C.border, backgroundColor: C.background,
  },
  levelPickerLabel: { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: C.text },

  noteInput: {
    borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
    fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text,
  },

  section:        { gap: 8 },
  sectionTitle:   { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: C.textSecondary, paddingLeft: 4 },
  card:           { backgroundColor: C.card, borderRadius: 16, overflow: "hidden",
                    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },

  statusRow:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                    paddingHorizontal: 16, paddingVertical: 14 },
  statusRowLabel: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginBottom: 4 },
  statusBadgeLg:  { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  statusBadgeLgText:{ fontSize: 13, fontFamily: "Pretendard-SemiBold" },
  changeBtn:      { flexDirection: "row", alignItems: "center", gap: 5,
                    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5 },
  changeBtnText:  { fontSize: 13, fontFamily: "Pretendard-SemiBold" },

  infoRow:        { flexDirection: "row", alignItems: "center", gap: 8,
                    paddingHorizontal: 16, paddingVertical: 12,
                    borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  infoLabel:      { fontSize: 13, fontFamily: "Pretendard-Medium", color: C.textSecondary, width: 80 },
  infoValue:      { flex: 1, fontSize: 14, fontFamily: "Pretendard-Medium", color: C.text, textAlign: "right" },

  divider:        { height: 1, backgroundColor: "#FFFFFF", marginHorizontal: 14 },

  classRow:       { flexDirection: "row", alignItems: "center", gap: 10, padding: 14 },
  colorBar:       { width: 4, height: 40, borderRadius: 2 },
  className:      { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: C.text },
  classMeta:      { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 },
  goBtn:          { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1.5 },
  goBtnText:      { fontSize: 12, fontFamily: "Pretendard-SemiBold" },

  attRow:         { flexDirection: "row", padding: 16 },
  attBox:         { flex: 1, alignItems: "center", gap: 4 },
  attValue:       { fontSize: 18, fontFamily: "Pretendard-Bold" },
  attLabel:       { fontSize: 10, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  attDivider:     { width: 1, backgroundColor: C.border, marginVertical: 4 },

  emptyCard:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
  emptyCardText:  { fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Regular" },
  emptyBox:       { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyText:      { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted },
});
