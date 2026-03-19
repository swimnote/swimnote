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
import { ConfirmModal } from "@/components/common/ConfirmModal";

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
  // 해제 확인 팝업
  const [confirmRemove, setConfirmRemove] = useState<Student | null>(null);

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
      // 상태 갱신
      setAllStudents(prev => prev.map(s => s.id === student.id ? { ...s, ...updated } : s));
      setAssigned(prev => [...prev, { ...student, ...updated }]);
    } catch (e) { console.error(e); }
    finally { setSaving(null); }
  }

  // 해제 처리
  async function doRemove(student: Student) {
    if (!classId) return;
    setSaving(student.id);
    try {
      const currentIds: string[] = Array.isArray(student.assigned_class_ids)
        ? student.assigned_class_ids : [];
      const newIds = currentIds.filter(id => id !== classId);
      const res = await apiRequest(token, `/students/${student.id}/assign`, {
        method: "PATCH",
        body: JSON.stringify({ assigned_class_ids: newIds }),
      });
      if (!res.ok) return;
      const updated: Student = await res.json();
      setAllStudents(prev => prev.map(s => s.id === student.id ? { ...s, ...updated } : s));
      setAssigned(prev => prev.filter(s => s.id !== student.id));
    } catch (e) { console.error(e); }
    finally { setSaving(null); }
  }

  const days = classInfo?.schedule_days.split(",").map(d => d.trim()).join("·") || "";
  const capacityLabel = classInfo?.capacity != null
    ? `${assigned.length} / ${classInfo.capacity}명`
    : `${assigned.length}명`;
  const capacityOver = classInfo?.capacity != null && assigned.length >= classInfo.capacity;

  if (loading) {
    return (
      <View style={[s.root, { backgroundColor: C.background }]}>
        <View style={[s.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20) }]}>
          <Pressable onPress={() => router.back()} style={s.backBtn}>
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
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Feather name="arrow-left" size={20} color={C.text} />
        </Pressable>
        <Text style={[s.title, { color: C.text }]}>반배정 변경</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
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
            <View style={[s.countBadge, { backgroundColor: capacityOver ? "#FEE2E2" : C.tintLight }]}>
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
              <StudentRow
                key={item.id}
                student={item}
                classId={classId!}
                action="remove"
                loading={saving === item.id}
                onPress={() => setConfirmRemove(item)}
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

      {/* ── 주횟수 선택 팝업 ── */}
      {weeklyPicker && (
        <WeeklyPickerModal
          studentName={weeklyPicker.name}
          onSelect={handleWeeklySelected}
          onCancel={() => setWeeklyPicker(null)}
        />
      )}

      {/* ── 해제 확인 팝업 ── */}
      <ConfirmModal
        visible={!!confirmRemove}
        title="배정 해제"
        message={confirmRemove ? `"${confirmRemove.name}"을(를) 이 반에서 해제하시겠습니까?\n학생 정보와 출결 기록은 보존됩니다.` : ""}
        confirmText="해제"
        cancelText="취소"
        destructive
        onConfirm={() => { const s = confirmRemove!; setConfirmRemove(null); doRemove(s); }}
        onCancel={() => setConfirmRemove(null)}
      />
    </View>
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
            : { backgroundColor: "#FEE2E2" },
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
