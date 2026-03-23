/**
 * class-assign.tsx — 반배정 변경 화면 (Admin + Teacher 공유)
 * 진입: ?classId=xxx
 *
 * 배정 대상: 현재 반에 없는 학생 중 assigned_class_ids.length < weekly_count (또는 미설정)
 * 주횟수 미설정 학생 → 주횟수 선택 팝업 먼저 표시
 * 배정 후 남은 횟수 있으면 리스트 유지, 다 채우면 제거
 */
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Modal, Platform,
  Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { UnifiedMemberCard } from "@/components/common/MemberCard";
import type { StudentMember } from "@/utils/studentUtils";
const C = Colors.light;

interface ClassGroup {
  id: string;
  name: string;
  schedule_days: string;
  schedule_time: string;
  instructor: string | null;
  capacity: number | null;
  level: string | null;
}

interface Student {
  id: string;
  name: string;
  birth_year?: number | null;
  parent_phone?: string | null;
  parent_name?: string | null;
  class_group_id?: string | null;
  assigned_class_ids?: string[];
  schedule_labels?: string | null;
  status?: string;
  weekly_count?: number | null;
  parent_user_id?: string | null;
  // 예약 상태 (다음달 이동 예약)
  pending_status_change?: "suspended" | "withdrawn" | null;
  pending_effective_mode?: "next_month" | null;
  pending_effective_month?: string | null;
}

// ── Student → StudentMember 변환 (class-assign 전용) ─────────────
function toStudentMember(s: Student): StudentMember {
  return {
    id: s.id,
    swimming_pool_id: "",
    name: s.name,
    birth_year: s.birth_year != null ? String(s.birth_year) : null,
    parent_phone: s.parent_phone,
    parent_name: s.parent_name,
    parent_user_id: s.parent_user_id,
    registration_path: "admin_created",
    status: s.status || "active",
    weekly_count: s.weekly_count,
    assigned_class_ids: s.assigned_class_ids,
    schedule_labels: s.schedule_labels,
    class_group_id: s.class_group_id,
    pending_status_change: s.pending_status_change,
    pending_effective_mode: s.pending_effective_mode,
    pending_effective_month: s.pending_effective_month,
    created_at: "",
    updated_at: "",
    assignedClasses: [],
  };
}

export default function ClassAssignScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const { classId } = useLocalSearchParams<{ classId: string }>();

  const [classInfo, setClassInfo] = useState<ClassGroup | null>(null);
  const [assigned, setAssigned] = useState<Student[]>([]);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // 주횟수 선택 팝업
  const [weeklyPicker, setWeeklyPicker] = useState<Student | null>(null);
  // 상태 선택 팝업 (해제 시 대기/연기/휴원/퇴원)
  const [statusSelectTarget, setStatusSelectTarget] = useState<Student | null>(null);
  // 이동 시점 선택 팝업 (휴원/퇴원 선택 후)
  const [timingTarget, setTimingTarget] = useState<{ student: Student; status: "suspended" | "withdrawn" } | null>(null);
  // 변경 여부 (배정완료 버튼 강조용)
  const [hasChanges, setHasChanges] = useState(false);

  const load = useCallback(async () => {
    if (!classId) return;
    try {
      // pool_all=true: 선생님도 pool 전체 학생을 조회 (반배정 목적)
      const [cgRes, stuRes] = await Promise.all([
        apiRequest(token, `/class-groups/${classId}`),
        apiRequest(token, "/students?pool_all=true"),
      ]);
      if (cgRes.ok) setClassInfo(await cgRes.json());
      if (stuRes.ok) {
        const allStu: Student[] = await stuRes.json();
        // active 상태만 (정상회원)
        const active = allStu.filter(s => s.status === "active");
        setAllStudents(active);
        const inClass = active.filter(s => {
          const ids: string[] = Array.isArray(s.assigned_class_ids) ? s.assigned_class_ids : [];
          return s.class_group_id === classId || ids.includes(classId);
        });
        setAssigned(inClass);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token, classId]);

  useEffect(() => { load(); }, [load]);

  // ── 배정 가능 학생 필터 ─────────────────────────────────────────
  // 조건: 현재 반에 없음 AND (weekly_count 미설정 OR assigned < weekly_count)
  const assignable = allStudents.filter(s => {
    const ids: string[] = Array.isArray(s.assigned_class_ids) ? s.assigned_class_ids : [];
    // 현재 반에 이미 있으면 제외 (중복 방지)
    if (ids.includes(classId!) || s.class_group_id === classId) return false;
    // weekly_count가 설정된 경우: 아직 다 채우지 않은 학생만
    if (s.weekly_count && s.weekly_count > 0) {
      return ids.length < s.weekly_count;
    }
    // weekly_count 미설정이면 배정 대상 포함
    return true;
  }).filter(s => {
    if (!search.trim()) return true;
    const q = search.trim();
    return s.name.includes(q) || (s.parent_phone || "").includes(q);
  });

  // ── 추가 버튼 클릭 ──────────────────────────────────────────────
  function handlePressAdd(student: Student) {
    if (!classId) return;
    const ids: string[] = Array.isArray(student.assigned_class_ids) ? student.assigned_class_ids : [];
    if (ids.includes(classId)) return; // 중복 방지

    // 주횟수 미설정이면 먼저 선택
    if (!student.weekly_count || student.weekly_count < 1) {
      setWeeklyPicker(student);
    } else {
      // 주횟수 이미 설정 → 바로 배정
      doAssign(student, student.weekly_count);
    }
  }

  // 주횟수 선택 후 → 바로 배정
  function handleWeeklySelected(weekly: number) {
    if (!weeklyPicker) return;
    const student = weeklyPicker;
    setWeeklyPicker(null);
    doAssign(student, weekly);
  }

  // 실제 배정 처리
  async function doAssign(student: Student, weeklyCount: number) {
    if (!classId) return;
    const capacityOver = classInfo?.capacity != null && assigned.length >= classInfo.capacity;
    if (capacityOver) return;

    setSaving(student.id);
    try {
      const currentIds: string[] = Array.isArray(student.assigned_class_ids)
        ? student.assigned_class_ids : [];
      const newIds = [...currentIds, classId];
      const res = await apiRequest(token, `/students/${student.id}/assign`, {
        method: "PATCH",
        body: JSON.stringify({ assigned_class_ids: newIds, weekly_count: weeklyCount }),
      });
      if (!res.ok) return;
      const updated: Student = await res.json();
      setAllStudents(prev => prev.map(s => s.id === student.id ? { ...s, ...updated } : s));
      setAssigned(prev => [...prev, { ...student, ...updated }]);
      setHasChanges(true);
    } catch (e) { console.error(e); }
    finally { setSaving(null); }
  }

  // 해제 처리
  // effective_mode: "immediate"(기본) → 즉시 상태변경+반해제
  //                "next_month" → pending 예약만 저장, 반배정/상태 유지
  async function doRemove(
    student: Student,
    new_status?: "pending" | "suspended" | "withdrawn",
    effective_mode: "immediate" | "next_month" = "immediate",
  ) {
    if (!classId) return;
    setSaving(student.id);
    try {
      const body: any = { class_group_id: classId };
      if (new_status) body.new_status = new_status;
      if (new_status && effective_mode === "next_month") body.effective_mode = "next_month";

      const res = await apiRequest(token, `/students/${student.id}/remove-from-class`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) return;

      if (effective_mode === "next_month" && new_status) {
        // 다음달 예약: 반배정 유지, pending 배지만 업데이트
        setAssigned(prev => prev.map(s => s.id === student.id
          ? { ...s, pending_status_change: new_status as "suspended" | "withdrawn", pending_effective_mode: "next_month" }
          : s
        ));
        setAllStudents(prev => prev.map(s => s.id === student.id
          ? { ...s, pending_status_change: new_status as "suspended" | "withdrawn", pending_effective_mode: "next_month" }
          : s
        ));
      } else {
        // 즉시 이동 또는 단순 반 해제
        setAssigned(prev => prev.filter(s => s.id !== student.id));
        setAllStudents(prev => new_status
          ? prev.filter(s => s.id !== student.id)
          : prev.map(s => s.id === student.id ? { ...s, assigned_class_ids: (s.assigned_class_ids || []).filter(id => id !== classId) } : s)
        );
      }
      setHasChanges(true);
    } catch (e) { console.error(e); }
    finally { setSaving(null); }
  }

  const days = classInfo?.schedule_days.split(",").map(d => d.trim()).join("·") || "";
  const capacityLabel = classInfo?.capacity != null
    ? `${assigned.length} / ${classInfo.capacity}명`
    : `${assigned.length}명`;
  const capacityOver = classInfo?.capacity != null && assigned.length >= classInfo.capacity;

  function goBack() {
    router.back();
  }

  if (loading) {
    return (
      <View style={[s.root, { backgroundColor: C.background }]}>
        <View style={[s.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20) }]}>
          <Pressable onPress={goBack} style={s.backBtn}>
            <Feather name="arrow-left" size={20} color={C.text} />
          </Pressable>
          <Text style={[s.title, { color: C.text }]}>반배정 변경</Text>
          <View style={{ width: 40 }} />
        </View>
        <ActivityIndicator color={C.tint} style={{ marginTop: 80 }} />
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      {/* 헤더 */}
      <View style={[s.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20) }]}>
        <Pressable onPress={goBack} style={s.backBtn}>
          <Feather name="arrow-left" size={20} color={C.text} />
        </Pressable>
        <Text style={[s.title, { color: C.text }]}>반배정 변경</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        showsVerticalScrollIndicator={false}
      >
        {/* 반 정보 카드 */}
        {classInfo && (
          <View style={[s.classCard, { backgroundColor: C.card }]}>
            <View style={[s.classIcon, { backgroundColor: "#F3E8FF" }]}>
              <Feather name="layers" size={20} color="#7C3AED" />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[s.className, { color: C.text }]}>{classInfo.name}</Text>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={s.metaRow}>
                  <Feather name="calendar" size={12} color={C.textMuted} />
                  <Text style={[s.meta, { color: C.textSecondary }]}>{days}요일</Text>
                </View>
                <View style={s.metaRow}>
                  <Feather name="clock" size={12} color={C.textMuted} />
                  <Text style={[s.meta, { color: C.textSecondary }]}>{classInfo.schedule_time}</Text>
                </View>
              </View>
              {classInfo.instructor && (
                <View style={s.metaRow}>
                  <Feather name="user" size={12} color={C.textMuted} />
                  <Text style={[s.meta, { color: C.textSecondary }]}>{classInfo.instructor}</Text>
                </View>
              )}
            </View>
            <View style={[s.countBadge, { backgroundColor: capacityOver ? "#F9DEDA" : C.tintLight }]}>
              <Text style={[s.countText, { color: capacityOver ? C.error : C.tint }]}>{capacityLabel}</Text>
            </View>
          </View>
        )}

        {/* 섹션 1: 현재 소속 회원 */}
        <View style={s.sectionHeader}>
          <Text style={[s.sectionTitle, { color: C.text }]}>현재 소속 회원</Text>
          <Text style={[s.sectionCount, { color: C.textMuted }]}>{assigned.length}명</Text>
        </View>

        {assigned.length === 0 ? (
          <View style={s.emptyRow}>
            <Text style={[s.emptyText, { color: C.textMuted }]}>이 반에 배정된 회원이 없습니다</Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            {assigned.map(item => (
              <UnifiedMemberCard
                key={item.id}
                student={toStudentMember(item)}
                showTeacher={false}
                onPress={() => router.push({ pathname: "/(teacher)/student-detail", params: { id: item.id } } as any)}
                actions={[
                  {
                    label: "해제",
                    icon: "minus-circle",
                    color: C.error,
                    bg: "#F9DEDA",
                    loading: saving === item.id,
                    onPress: () => setStatusSelectTarget(item),
                  },
                ]}
              />
            ))}
          </View>
        )}

        {/* 구분선 */}
        <View style={[s.divider, { borderTopColor: C.border }]} />

        {/* 섹션 2: 회원 추가 */}
        <View style={s.sectionHeader}>
          <Text style={[s.sectionTitle, { color: C.text }]}>배정 가능 회원</Text>
          <Text style={[s.sectionCount, { color: C.textMuted }]}>{assignable.length}명</Text>
        </View>

        {/* 검색창 */}
        <View style={[s.searchWrap, { backgroundColor: C.card, borderColor: C.border }]}>
          <Feather name="search" size={16} color={C.textMuted} />
          <TextInput
            style={[s.searchInput, { color: C.text }]}
            value={search}
            onChangeText={setSearch}
            placeholder="이름 또는 전화번호 검색..."
            placeholderTextColor={C.textMuted}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")}>
              <Feather name="x-circle" size={16} color={C.textMuted} />
            </Pressable>
          )}
        </View>

        {assignable.length === 0 ? (
          <View style={s.emptyRow}>
            <Text style={[s.emptyText, { color: C.textMuted }]}>
              {search.trim()
                ? `"${search}"에 해당하는 배정 가능한 회원이 없습니다`
                : "배정 가능한 회원이 없습니다"}
            </Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            {assignable.map(item => (
              <StudentRow
                key={item.id}
                student={item}
                classId={classId!}
                action="add"
                loading={saving === item.id}
                onPress={() => handlePressAdd(item)}
                disabled={capacityOver}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {/* ── 배정완료 고정 버튼 ── */}
      <View style={[s.doneWrap, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          style={[s.doneBtn, { backgroundColor: hasChanges ? C.tint : C.border }]}
          onPress={goBack}
        >
          <Feather name="check" size={18} color={hasChanges ? "#fff" : C.textMuted} />
          <Text style={[s.doneTxt, { color: hasChanges ? "#fff" : C.textMuted }]}>
            {hasChanges ? `배정 완료 — ${assigned.length}명 확정` : "변경 없음 · 돌아가기"}
          </Text>
        </Pressable>
      </View>

      {/* ── 주횟수 선택 팝업 ── */}
      {weeklyPicker && (
        <WeeklyPickerModal
          studentName={weeklyPicker.name}
          onSelect={handleWeeklySelected}
          onCancel={() => setWeeklyPicker(null)}
        />
      )}

      {/* ── 상태 선택 팝업 (반 제거 시) ── */}
      {statusSelectTarget && (
        <RemoveStatusModal
          studentName={statusSelectTarget.name}
          onSelect={(st) => {
            const target = statusSelectTarget;
            setStatusSelectTarget(null);
            if (st === "suspended" || st === "withdrawn") {
              // 휴원/퇴원 → 이동 시점 선택 팝업
              setTimingTarget({ student: target, status: st });
            } else {
              // 대기/연기 → 즉시 적용
              doRemove(target, st, "immediate");
            }
          }}
          onCancel={() => setStatusSelectTarget(null)}
        />
      )}

      {/* ── 이동 시점 선택 팝업 (휴원/퇴원 선택 후) ── */}
      {timingTarget && (
        <TimingPickerModal
          status={timingTarget.status}
          onSelect={(mode) => {
            const { student, status } = timingTarget;
            setTimingTarget(null);
            doRemove(student, status, mode);
          }}
          onCancel={() => setTimingTarget(null)}
        />
      )}
    </View>
  );
}

// ── 반 제거 시 상태 선택 모달 ────────────────────────────────────
// 대기/연기 → 즉시 적용 / 휴원/퇴원 → 이동 시점 팝업으로 연결
function RemoveStatusModal({
  studentName, onSelect, onCancel,
}: {
  studentName: string;
  onSelect: (status: "pending" | "suspended" | "withdrawn") => void;
  onCancel: () => void;
}) {
  const C = Colors.light;
  const options: { key: "pending" | "suspended" | "withdrawn"; label: string; sub: string; color: string; bg: string; emoji: string; needsTiming: boolean }[] = [
    { key: "pending",   label: "대기",  sub: "재등록 대기, 즉시 적용",           color: "#1F8F86", bg: "#DDF2EF", emoji: "⏳", needsTiming: false },
    { key: "suspended", label: "연기",  sub: "일시적 중단, 즉시 적용",           color: "#92400E", bg: "#FFFBEB", emoji: "⏸️", needsTiming: false },
    { key: "suspended", label: "연기",  sub: "연기 처리, 이동 시점 선택 가능",   color: "#B45309", bg: "#FFF1BF", emoji: "🏖️", needsTiming: true  },
    { key: "withdrawn", label: "퇴원",  sub: "수강 종료, 이동 시점 선택 가능",   color: "#991B1B", bg: "#FEF2F2", emoji: "🚪", needsTiming: true  },
  ];
  return (
    <Modal visible animationType="fade" transparent onRequestClose={onCancel}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)" }} onPress={onCancel} />
      <View style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        backgroundColor: C.background, borderTopLeftRadius: 20, borderTopRightRadius: 20,
        padding: 24, paddingBottom: 36,
      }}>
        <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: C.text, marginBottom: 4 }}>
          반 배정 해제 — 상태 선택
        </Text>
        <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: C.textMuted, marginBottom: 20 }}>
          {`"${studentName}" 회원의 이동할 상태를 선택하세요.`}
        </Text>
        <View style={{ gap: 10 }}>
          {options.map((opt, i) => (
            <Pressable
              key={`${opt.key}-${i}`}
              onPress={() => onSelect(opt.key)}
              style={{
                flexDirection: "row", alignItems: "center", gap: 14,
                backgroundColor: opt.bg, borderRadius: 14, padding: 14, borderWidth: 1.5,
                borderColor: opt.color + "40",
              }}
            >
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: opt.color + "18", alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontSize: 18 }}>{opt.emoji}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: opt.color }}>{opt.label}</Text>
                <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 1 }}>{opt.sub}</Text>
              </View>
              {opt.needsTiming
                ? <Feather name="clock" size={14} color={opt.color} />
                : <Feather name="zap" size={14} color={opt.color} />
              }
            </Pressable>
          ))}
        </View>
        <Pressable onPress={onCancel} style={{ alignItems: "center", marginTop: 18 }}>
          <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: C.textMuted }}>취소</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

// ── 이동 시점 선택 모달 ───────────────────────────────────────────
function TimingPickerModal({
  status, onSelect, onCancel,
}: {
  status: "suspended" | "withdrawn";
  onSelect: (mode: "immediate" | "next_month") => void;
  onCancel: () => void;
}) {
  const C = Colors.light;
  const label = status === "suspended" ? "연기" : "퇴원";
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextLabel = `${next.getFullYear()}년 ${next.getMonth() + 1}월`;

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onCancel}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)" }} onPress={onCancel} />
      <View style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        backgroundColor: C.background, borderTopLeftRadius: 20, borderTopRightRadius: 20,
        padding: 24, paddingBottom: 36,
      }}>
        <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: C.text, marginBottom: 4 }}>
          이동 시점을 선택하세요
        </Text>
        <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: C.textMuted, marginBottom: 20 }}>
          {label} 처리 시점을 선택합니다.
        </Text>
        <View style={{ gap: 10 }}>
          {/* 즉시 이동 */}
          <Pressable
            onPress={() => onSelect("immediate")}
            style={{ flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "#FEF2F2", borderRadius: 14, padding: 16, borderWidth: 1.5, borderColor: "#991B1B40" }}
          >
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: "#F9DEDA", alignItems: "center", justifyContent: "center" }}>
              <Feather name="zap" size={20} color="#991B1B" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: "#991B1B" }}>즉시 이동</Text>
              <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 }}>
                지금 바로 {label} 처리하고 현재 반에서 제외합니다.
              </Text>
            </View>
          </Pressable>
          {/* 다음 달 이동 */}
          <Pressable
            onPress={() => onSelect("next_month")}
            style={{ flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "#FFFBEB", borderRadius: 14, padding: 16, borderWidth: 1.5, borderColor: "#B4530940" }}
          >
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: "#FFF1BF", alignItems: "center", justifyContent: "center" }}>
              <Feather name="calendar" size={20} color="#B45309" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: "#B45309" }}>다음 달 이동</Text>
              <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 }}>
                {nextLabel}부터 {label} 처리. 이번 달은 현재 상태 유지 + [{label}예정] 배지 표시.
              </Text>
            </View>
          </Pressable>
        </View>
        <Pressable onPress={onCancel} style={{ alignItems: "center", marginTop: 18 }}>
          <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: C.textMuted }}>취소</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

// ── 주횟수 선택 모달 ─────────────────────────────────────────────
function WeeklyPickerModal({
  studentName, onSelect, onCancel,
}: { studentName: string; onSelect: (n: number) => void; onCancel: () => void }) {
  return (
    <Modal visible animationType="fade" transparent onRequestClose={onCancel}>
      <Pressable style={wp.backdrop} onPress={onCancel} />
      <View style={wp.card}>
        <Text style={wp.title}>주 몇 회 수업인가요?</Text>
        <Text style={wp.sub}>{studentName} 회원의 주 수업 횟수를 선택하세요</Text>
        <View style={wp.btnRow}>
          {[1, 2, 3].map(n => (
            <Pressable key={n} style={wp.optBtn} onPress={() => onSelect(n)}>
              <Text style={wp.optNum}>주 {n}회</Text>
              <Text style={wp.optSub}>{n}개 반 배정</Text>
            </Pressable>
          ))}
        </View>
        <Pressable style={wp.cancelBtn} onPress={onCancel}>
          <Text style={wp.cancelTxt}>취소</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

// ── 학생 카드 ────────────────────────────────────────────────────
function StudentRow({
  student, classId, action, loading, onPress, disabled,
}: {
  student: Student;
  classId: string;
  action: "add" | "remove";
  loading: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const isAdd = action === "add";
  const ids: string[] = Array.isArray(student.assigned_class_ids) ? student.assigned_class_ids : [];
  const assignedCount = ids.length;
  const weekly = student.weekly_count;

  const progressLabel = weekly
    ? `${assignedCount} / ${weekly}반 배정`
    : assignedCount > 0
      ? `${assignedCount}개 반 배정 중 · 주횟수 미설정`
      : "미배정 · 주횟수 미설정";

  return (
    <View style={[r.row, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={[r.avatar, { backgroundColor: C.tintLight }]}>
        <Text style={[r.avatarText, { color: C.tint }]}>{student.name[0]}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[r.name, { color: C.text }]}>{student.name}</Text>
        {student.parent_phone && (
          <Text style={[r.sub, { color: C.textMuted }]}>{student.parent_phone}</Text>
        )}
        <Text style={[r.progress, {
          color: weekly && assignedCount >= weekly ? C.tint : C.textMuted,
        }]}>
          {progressLabel}
        </Text>
      </View>
      <Pressable
        style={[
          r.btn,
          isAdd
            ? { backgroundColor: disabled ? C.border : C.tint }
            : { backgroundColor: "#F9DEDA" },
        ]}
        onPress={!loading && !disabled ? onPress : undefined}
        disabled={loading || disabled}
      >
        {loading
          ? <ActivityIndicator size={14} color={isAdd ? "#fff" : C.error} />
          : isAdd
            ? <Feather name="plus" size={14} color="#fff" />
            : <Feather name="minus" size={14} color={C.error} />
        }
        <Text style={[r.btnText, { color: isAdd ? (disabled ? C.textMuted : "#fff") : C.error }]}>
          {isAdd ? "추가" : "해제"}
        </Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  classCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 12,
    marginHorizontal: 16, marginBottom: 16,
    borderRadius: 14, padding: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  classIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  className: { fontSize: 16, fontFamily: "Inter_700Bold" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  countBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, alignSelf: "flex-start", marginTop: 2 },
  countText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  sectionHeader: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 16, paddingBottom: 8,
  },
  sectionTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  sectionCount: { fontSize: 12, fontFamily: "Inter_400Regular" },
  emptyRow: { paddingHorizontal: 16, paddingVertical: 14, alignItems: "center" },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  divider: { borderTopWidth: 1, marginHorizontal: 16, marginVertical: 16 },
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginBottom: 12,
    borderWidth: 1.5, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: Platform.OS === "ios" ? 12 : 8,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  doneWrap: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: C.background,
    borderTopWidth: 1, borderTopColor: C.border,
  },
  doneBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderRadius: 14, paddingVertical: 15,
  },
  doneTxt: { fontSize: 16, fontFamily: "Inter_700Bold" },
});

const r = StyleSheet.create({
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 12, padding: 12, borderWidth: 1,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  avatar: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  name: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  sub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  progress: { fontSize: 11, fontFamily: "Inter_500Medium" },
  btn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
  },
  btnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});

const wp = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  card: {
    position: "absolute", left: 24, right: 24,
    top: "35%",
    backgroundColor: "#fff", borderRadius: 20,
    padding: 24, gap: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 12,
  },
  title: { fontSize: 18, fontFamily: "Inter_700Bold", color: C.text, textAlign: "center" },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textMuted, textAlign: "center", marginTop: -8 },
  btnRow: { flexDirection: "row", gap: 10 },
  optBtn: {
    flex: 1, borderRadius: 14, borderWidth: 1.5, borderColor: C.tint,
    paddingVertical: 14, alignItems: "center", gap: 4,
  },
  optNum: { fontSize: 16, fontFamily: "Inter_700Bold", color: C.tint },
  optSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textMuted },
  cancelBtn: { alignItems: "center", paddingVertical: 8 },
  cancelTxt: { fontSize: 14, fontFamily: "Inter_500Medium", color: C.textMuted },
});
