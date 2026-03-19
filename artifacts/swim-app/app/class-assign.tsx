/**
 * class-assign.tsx — 반배정 변경 화면 (Admin + Teacher 공유)
 * 진입: ?classId=xxx
 * - 현재 소속 회원 목록 표시 + 해제
 * - 미배정 회원 기본 목록 표시 + 이름 검색 필터
 * - 추가/해제 즉시 저장
 */
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Platform,
  Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

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
  class_group_id?: string | null;
  assigned_class_ids?: string[];
  schedule_labels?: string | null;
  status?: string;
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

  const load = useCallback(async () => {
    if (!classId) return;
    try {
      const [cgRes, stuRes] = await Promise.all([
        apiRequest(token, `/class-groups/${classId}`),
        apiRequest(token, "/students"),
      ]);
      if (cgRes.ok) setClassInfo(await cgRes.json());
      if (stuRes.ok) {
        const allStu: Student[] = await stuRes.json();
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

  // 배정 가능: 이 반에 없는 학생 전체 → 검색어 있으면 필터
  const assignable = allStudents.filter(s => {
    const ids: string[] = Array.isArray(s.assigned_class_ids) ? s.assigned_class_ids : [];
    const inThisClass = s.class_group_id === classId || ids.includes(classId);
    if (inThisClass) return false;
    if (search.trim()) return s.name.includes(search.trim());
    return true;
  });

  async function handleAssign(student: Student) {
    if (!classId) return;
    const currentIds: string[] = Array.isArray(student.assigned_class_ids)
      ? student.assigned_class_ids : [];
    if (currentIds.includes(classId)) return;

    if (classInfo?.capacity != null && assigned.length >= classInfo.capacity) {
      Alert.alert("정원 초과", `이 반의 정원(${classInfo.capacity}명)이 꽉 찼습니다.`);
      return;
    }

    setSaving(student.id);
    try {
      const newIds = [...currentIds, classId];
      const res = await apiRequest(token, `/students/${student.id}/assign`, {
        method: "PATCH",
        body: JSON.stringify({ assigned_class_ids: newIds }),
      });
      if (!res.ok) {
        const d = await res.json();
        Alert.alert("오류", d.message || d.error || "배정 중 오류가 발생했습니다.");
        return;
      }
      const updated: Student = await res.json();
      setAllStudents(prev => prev.map(s => s.id === student.id ? { ...s, ...updated } : s));
      setAssigned(prev => [...prev, { ...student, ...updated }]);
    } catch {
      Alert.alert("오류", "네트워크 오류가 발생했습니다.");
    } finally { setSaving(null); }
  }

  async function handleRemove(student: Student) {
    if (!classId) return;
    Alert.alert(
      "배정 해제",
      `"${student.name}"을(를) 이 반에서 해제하시겠습니까?\n학생 정보와 출결 기록은 보존됩니다.`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "해제", style: "destructive",
          onPress: async () => {
            setSaving(student.id);
            try {
              const currentIds: string[] = Array.isArray(student.assigned_class_ids)
                ? student.assigned_class_ids : [];
              const newIds = currentIds.filter(id => id !== classId);
              const res = await apiRequest(token, `/students/${student.id}/assign`, {
                method: "PATCH",
                body: JSON.stringify({ assigned_class_ids: newIds }),
              });
              if (!res.ok) {
                const d = await res.json();
                Alert.alert("오류", d.message || d.error || "해제 중 오류가 발생했습니다.");
                return;
              }
              const updated: Student = await res.json();
              setAllStudents(prev => prev.map(s => s.id === student.id ? { ...s, ...updated } : s));
              setAssigned(prev => prev.filter(s => s.id !== student.id));
            } catch {
              Alert.alert("오류", "네트워크 오류가 발생했습니다.");
            } finally { setSaving(null); }
          },
        },
      ]
    );
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
                action="remove"
                loading={saving === item.id}
                onPress={() => handleRemove(item)}
              />
            ))}
          </View>
        )}

        {/* 구분선 */}
        <View style={[s.divider, { borderTopColor: C.border }]} />

        {/* 섹션 2: 회원 추가 */}
        <View style={s.sectionHeader}>
          <Text style={[s.sectionTitle, { color: C.text }]}>회원 추가</Text>
          <Text style={[s.sectionCount, { color: C.textMuted }]}>{assignable.length}명</Text>
        </View>

        {/* 검색창 */}
        <View style={[s.searchWrap, { backgroundColor: C.card, borderColor: C.border }]}>
          <Feather name="search" size={16} color={C.textMuted} />
          <TextInput
            style={[s.searchInput, { color: C.text }]}
            value={search}
            onChangeText={setSearch}
            placeholder="이름 검색..."
            placeholderTextColor={C.textMuted}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")}>
              <Feather name="x-circle" size={16} color={C.textMuted} />
            </Pressable>
          )}
        </View>

        {/* 미배정 목록 */}
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
                action="add"
                loading={saving === item.id}
                onPress={() => handleAssign(item)}
                disabled={capacityOver}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function StudentRow({
  student, action, loading, onPress, disabled,
}: {
  student: Student;
  action: "add" | "remove";
  loading: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const isAdd = action === "add";
  const currentClass = student.schedule_labels || null;
  return (
    <View style={[r.row, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={[r.avatar, { backgroundColor: C.tintLight }]}>
        <Text style={[r.avatarText, { color: C.tint }]}>{student.name[0]}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[r.name, { color: C.text }]}>{student.name}</Text>
        {student.birth_year && (
          <Text style={[r.sub, { color: C.textMuted }]}>{student.birth_year}년생</Text>
        )}
        {currentClass ? (
          <Text style={[r.sub, { color: C.textMuted }]}>현재 반: {currentClass}</Text>
        ) : !student.class_group_id ? (
          <Text style={[r.sub, { color: C.textMuted }]}>미배정</Text>
        ) : null}
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
    borderRadius: 12, padding: 12,
    borderWidth: 1,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  avatar: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  name: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  sub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  btn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
  },
  btnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
