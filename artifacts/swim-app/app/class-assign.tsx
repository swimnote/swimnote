/**
 * class-assign.tsx — 반배정 변경 화면 (Admin + Teacher 공유)
 * 진입: ?classId=xxx
 *
 * 배정 대상: 현재 반에 없는 학생 중 assigned_class_ids.length < weekly_count (또는 미설정)
 * 주횟수 미설정 학생 → 주횟수 선택 팝업 먼저 표시
 * 배정 후 남은 횟수 있으면 리스트 유지, 다 채우면 제거
 */
import { ArrowLeft, Calendar, Check, CircleX, Clock, Layers, Minus, Plus, RefreshCw, Search, TriangleAlert, User, X } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform,
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
  updated_at?: string | null;
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
  // 제외 시점 선택 팝업
  const [timingTarget, setTimingTarget] = useState<Student | null>(null);
  // 변경 여부 (배정완료 버튼 강조용)
  const [hasChanges, setHasChanges] = useState(false);
  // 동시성 충돌 팝업
  const [conflictVisible, setConflictVisible] = useState(false);

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
        // active + pending_parent_link 상태 (관리자 등록 후 학부모 미연결 포함)
        const active = allStu.filter(s => s.status === "active" || s.status === "pending_parent_link");
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

  // 동시성 충돌 발생 시 목록 새로 고침
  async function handleConflict() {
    setConflictVisible(false);
    await load();
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
        body: JSON.stringify({
          assigned_class_ids: newIds,
          weekly_count: weeklyCount,
          expected_updated_at: student.updated_at ?? undefined,
        }),
      });
      if (res.status === 409) {
        setConflictVisible(true);
        return;
      }
      if (!res.ok) return;
      const updated: Student = await res.json();
      setAllStudents(prev => prev.map(s => s.id === student.id ? { ...s, ...updated } : s));
      setAssigned(prev => [...prev, { ...student, ...updated }]);
      setHasChanges(true);
    } catch (e) { console.error(e); }
    finally { setSaving(null); }
  }

  // 반 제외-미배정 이동 처리 (단순 반 해제, 학생 status 변경 없음)
  async function doRemove(student: Student, timing: "now" | "next_week" | "week_after" = "now") {
    if (!classId) return;
    setSaving(student.id);
    try {
      const res = await apiRequest(token, `/students/${student.id}/remove-from-class`, {
        method: "POST",
        body: JSON.stringify({
          class_group_id: classId,
          effective_timing: timing,
          expected_updated_at: timing === "now" ? (student.updated_at ?? undefined) : undefined,
        }),
      });
      if (res.status === 409) {
        setConflictVisible(true);
        return;
      }
      if (!res.ok) return;
      // 즉시 UI 반영: assigned 목록에서 제거, allStudents에서 해당 반 ID 제거
      setAssigned(prev => prev.filter(s => s.id !== student.id));
      setAllStudents(prev => prev.map(s => s.id === student.id
        ? { ...s, assigned_class_ids: (s.assigned_class_ids || []).filter(id => id !== classId), class_group_id: (s.class_group_id === classId ? null : s.class_group_id) }
        : s
      ));
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
            <ArrowLeft size={20} color={C.text} />
          </Pressable>
          <Text style={[s.title, { color: C.text }]}>반배정 변경</Text>
          <View style={{ width: 40 }} />
        </View>
        <ActivityIndicator color={C.tint} style={{ marginTop: 80 }} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[s.root, { backgroundColor: C.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      <Text style={{ backgroundColor: "red", color: "white", fontWeight: "bold", fontSize: 14, padding: 6, textAlign: "center" }}>
      </Text>
      {/* 헤더 */}
      <View style={[s.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20) }]}>
        <Pressable onPress={goBack} style={s.backBtn}>
          <ArrowLeft size={20} color={C.text} />
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
            <View style={[s.classIcon, { backgroundColor: "#E6FAF8" }]}>
              <Layers size={20} color="#7C3AED" />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[s.className, { color: C.text }]}>{classInfo.name}</Text>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={s.metaRow}>
                  <Calendar size={12} color={C.textMuted} />
                  <Text style={[s.meta, { color: C.textSecondary }]}>{days}요일</Text>
                </View>
                <View style={s.metaRow}>
                  <Clock size={12} color={C.textMuted} />
                  <Text style={[s.meta, { color: C.textSecondary }]}>{classInfo.schedule_time}</Text>
                </View>
              </View>
              {classInfo.instructor && (
                <View style={s.metaRow}>
                  <User size={12} color={C.textMuted} />
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
                    label: "반 제외-미배정 이동",
                    icon: "user-minus",
                    color: C.error,
                    bg: "#F9DEDA",
                    loading: saving === item.id,
                    onPress: () => setTimingTarget(item),
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
          <Search size={16} color={C.textMuted} />
          <TextInput
            style={[s.searchInput, { color: C.text }]}
            value={search}
            onChangeText={setSearch}
            placeholder="이름 또는 전화번호 검색..."
            placeholderTextColor={C.textMuted}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")}>
              <CircleX size={16} color={C.textMuted} />
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
          <Check size={18} color={hasChanges ? "#fff" : C.textMuted} />
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

      {/* ── 반 제외 시점 선택 팝업 ── */}
      {timingTarget && (
        <RemoveTimingModal
          studentName={timingTarget.name}
          onSelect={(timing) => {
            const target = timingTarget;
            setTimingTarget(null);
            doRemove(target, timing);
          }}
          onCancel={() => setTimingTarget(null)}
        />
      )}

      {/* ── 동시성 충돌 팝업 ── */}
      {conflictVisible && (
        <Modal visible animationType="fade" transparent onRequestClose={handleConflict}>
          <Pressable style={[s.backdrop, { backgroundColor: "rgba(0,0,0,0.45)" }]} onPress={handleConflict} />
          <View style={{ position: "absolute", left: 24, right: 24, top: "35%", backgroundColor: "#fff", borderRadius: 14, padding: 24, alignItems: "center", shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 12, elevation: 10 }}>
            {/* X 닫기 버튼 */}
            <Pressable
              onPress={handleConflict}
              style={{ position: "absolute", top: 12, right: 12, padding: 4 }}
              hitSlop={8}
            >
              <X size={20} color="#999" />
            </Pressable>
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: "#FFF3CD", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
              <TriangleAlert size={24} color="#E8A000" />
            </View>
            <Text style={{ fontSize: 17, fontWeight: "700", color: "#222", marginBottom: 8 }}>배정 상태가 변경되었습니다</Text>
            <Text style={{ fontSize: 14, color: "#555", textAlign: "center", marginBottom: 20 }}>다른 선생님이 먼저 배정을 완료했습니다.{"\n"}목록을 새로고침하여 최신 상태를 확인하세요.</Text>
            <Pressable
              onPress={handleConflict}
              style={{ backgroundColor: C.button, paddingHorizontal: 32, paddingVertical: 12, borderRadius: 8, flexDirection: "row", alignItems: "center", gap: 6 }}
            >
              <RefreshCw size={15} color="#fff" />
              <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }}>목록 새로고침</Text>
            </Pressable>
          </View>
        </Modal>
      )}
    </KeyboardAvoidingView>
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

// ── 반 제외 시점 선택 모달 ───────────────────────────────────────
function RemoveTimingModal({
  studentName, onSelect, onCancel,
}: { studentName: string; onSelect: (t: "now" | "next_week" | "week_after") => void; onCancel: () => void }) {
  const opts: { key: "now" | "next_week" | "week_after"; label: string; sub: string }[] = [
    { key: "now",        label: "오늘부터",    sub: "지금 즉시 반 배정 해제" },
    { key: "next_week",  label: "다음 주부터",  sub: "이번 주까지는 기존 반 유지" },
    { key: "week_after", label: "다다음 주부터", sub: "이번 주/다음 주까지 기존 반 유지" },
  ];
  return (
    <Modal visible animationType="fade" transparent onRequestClose={onCancel}>
      <Pressable style={rt.backdrop} onPress={onCancel} />
      <View style={rt.card}>
        <Text style={rt.title}>반 제외 시점 선택</Text>
        <Text style={rt.sub}>{studentName} 회원을 이 반에서 제외합니다</Text>
        <View style={rt.optList}>
          {opts.map(o => (
            <Pressable key={o.key} style={rt.optBtn} onPress={() => onSelect(o.key)}>
              <Text style={rt.optLabel}>{o.label}</Text>
              <Text style={rt.optSub}>{o.sub}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable style={rt.cancelBtn} onPress={onCancel}>
          <Text style={rt.cancelTxt}>취소</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
const C_rt = Colors.light;
const rt = StyleSheet.create({
  backdrop:  { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  card:      { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: C_rt.card,
               borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 36, gap: 8 },
  title:     { fontSize: 17, fontFamily: "Pretendard-Regular", color: C_rt.text, textAlign: "center" },
  sub:       { fontSize: 13, fontFamily: "Pretendard-Regular", color: C_rt.textMuted, textAlign: "center", marginBottom: 8 },
  optList:   { gap: 8 },
  optBtn:    { backgroundColor: "#FFF1F2", borderRadius: 12, padding: 14, gap: 3 },
  optLabel:  { fontSize: 15, fontFamily: "Pretendard-Regular", color: C_rt.error },
  optSub:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: C_rt.textMuted },
  cancelBtn: { marginTop: 4, paddingVertical: 14, alignItems: "center" },
  cancelTxt: { fontSize: 15, fontFamily: "Pretendard-Regular", color: C_rt.textMuted },
});

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
    ? assignedCount > 0
      ? `${assignedCount} / ${weekly}반 배정`
      : `주 ${weekly}회 · 미배정`
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
            ? <Plus size={14} color="#fff" />
            : <Minus size={14} color={C.error} />
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
  title: { fontSize: 18, fontFamily: "Pretendard-Regular" },
  classCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 12,
    marginHorizontal: 16, marginBottom: 16,
    borderRadius: 14, padding: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  classIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  className: { fontSize: 16, fontFamily: "Pretendard-Regular" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  meta: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  countBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, alignSelf: "flex-start", marginTop: 2 },
  countText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  sectionHeader: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 16, paddingBottom: 8,
  },
  sectionTitle: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  sectionCount: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  emptyRow: { paddingHorizontal: 16, paddingVertical: 14, alignItems: "center" },
  emptyText: { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center" },
  divider: { borderTopWidth: 1, marginHorizontal: 16, marginVertical: 16 },
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginBottom: 12,
    borderWidth: 1.5, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: Platform.OS === "ios" ? 12 : 8,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular" },
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
  doneTxt: { fontSize: 16, fontFamily: "Pretendard-Regular" },
});

const r = StyleSheet.create({
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 12, padding: 12, borderWidth: 1,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  avatar: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 16, fontFamily: "Pretendard-Regular" },
  name: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  sub: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  progress: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  btn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
  },
  btnText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
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
  title: { fontSize: 18, fontFamily: "Pretendard-Regular", color: C.text, textAlign: "center" },
  sub: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted, textAlign: "center", marginTop: -8 },
  btnRow: { flexDirection: "row", gap: 10 },
  optBtn: {
    flex: 1, borderRadius: 14, borderWidth: 1.5, borderColor: C.tint,
    paddingVertical: 14, alignItems: "center", gap: 4,
  },
  optNum: { fontSize: 16, fontFamily: "Pretendard-Regular", color: C.tint },
  optSub: { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },
  cancelBtn: { alignItems: "center", paddingVertical: 8 },
  cancelTxt: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textMuted },
});
