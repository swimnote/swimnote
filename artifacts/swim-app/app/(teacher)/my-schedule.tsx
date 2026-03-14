/**
 * (teacher)/my-schedule.tsx — 내반 탭
 *
 * 구조: WeeklySchedule → 클릭 → 학생 목록 서브뷰
 * 데이터 소스: /class-groups, /students (assigned_class_ids 기반)
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { PoolHeader } from "@/components/PoolHeader";
import ClassCreateFlow from "@/components/classes/ClassCreateFlow";
import { WeeklySchedule, TeacherClassGroup, SlotStatus } from "@/components/teacher/WeeklySchedule";

const C = Colors.light;
const DAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface StudentItem {
  id: string;
  name: string;
  birth_year?: string | null;
  assigned_class_ids?: string[];
  class_group_id?: string | null;
  weekly_count?: number;
  schedule_labels?: string | null;
  status?: string;
  parent_user_id?: string | null;
}

export default function MyScheduleScreen() {
  const { token, adminUser } = useAuth();
  const { themeColor } = useBrand();
  const selfTeacher = adminUser ? { id: adminUser.id, name: adminUser.name || "나" } : undefined;

  const [groups,      setGroups]      = useState<TeacherClassGroup[]>([]);
  const [students,    setStudents]    = useState<StudentItem[]>([]);
  const [attMap,      setAttMap]      = useState<Record<string, number>>({});  // classId → checked count
  const [diarySet,    setDiarySet]    = useState<Set<string>>(new Set());
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [showCreate,  setShowCreate]  = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<TeacherClassGroup | null>(null);

  const load = useCallback(async () => {
    const today = todayDateStr();
    try {
      const [cgRes, stRes, attRes, dRes] = await Promise.all([
        apiRequest(token, "/class-groups"),
        apiRequest(token, "/students"),
        apiRequest(token, `/attendance?date=${today}`),
        apiRequest(token, `/diary?date=${today}`),
      ]);
      if (cgRes.ok)  setGroups(await cgRes.json());
      if (stRes.ok)  setStudents(await stRes.json());
      if (attRes.ok) {
        const arr: any[] = await attRes.json();
        const map: Record<string, number> = {};
        arr.forEach(a => {
          const cid = a.class_group_id || a.class_id;
          if (cid) map[cid] = (map[cid] || 0) + 1;
        });
        setAttMap(map);
      }
      if (dRes.ok) {
        const arr: any[] = await dRes.json();
        setDiarySet(new Set(arr.map((d: any) => d.class_group_id).filter(Boolean)));
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // statusMap 계산
  const statusMap: Record<string, SlotStatus> = {};
  groups.forEach(g => {
    const total   = g.student_count;
    const checked = attMap[g.id] || 0;
    statusMap[g.id] = {
      attChecked: checked,
      diaryDone:  diarySet.has(g.id),
      hasPhotos:  false,
    };
  });

  // 선택된 반의 학생 목록 (assigned_class_ids 기반, 하위호환 class_group_id 포함)
  const groupStudents = selectedGroup
    ? students.filter(st =>
        (Array.isArray(st.assigned_class_ids) && st.assigned_class_ids.includes(selectedGroup.id))
        || st.class_group_id === selectedGroup.id
      ).sort((a, b) => a.name.localeCompare(b.name))
    : [];

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <PoolHeader />
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  // ── 학생 목록 서브뷰 ─────────────────────────────────────────
  if (selectedGroup) {
    const group = selectedGroup;
    const attDone = (attMap[group.id] || 0) >= group.student_count && group.student_count > 0;
    const diaryDone = diarySet.has(group.id);

    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <PoolHeader />
        {/* 서브뷰 헤더 */}
        <View style={s.subHeader}>
          <Pressable style={s.backBtn} onPress={() => setSelectedGroup(null)}>
            <Feather name="arrow-left" size={20} color={C.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={s.subTitle}>{group.name}</Text>
            <Text style={s.subSub}>{group.schedule_days} · {group.schedule_time}</Text>
          </View>
          {/* 출결/일지 바로가기 */}
          <Pressable
            style={[s.subActionBtn, { backgroundColor: attDone ? "#D1FAE5" : "#FEE2E2" }]}
            onPress={() => router.push({ pathname: "/(teacher)/attendance", params: { classGroupId: group.id } } as any)}
          >
            <Feather name="check-square" size={14} color={attDone ? "#059669" : "#DC2626"} />
            <Text style={[s.subActionText, { color: attDone ? "#059669" : "#DC2626" }]}>출결</Text>
          </Pressable>
          <Pressable
            style={[s.subActionBtn, { backgroundColor: diaryDone ? "#D1FAE5" : "#FEF3C7" }]}
            onPress={() => router.push({ pathname: "/(teacher)/diary", params: { classGroupId: group.id, className: group.name } } as any)}
          >
            <Feather name="edit-3" size={14} color={diaryDone ? "#059669" : "#D97706"} />
            <Text style={[s.subActionText, { color: diaryDone ? "#059669" : "#D97706" }]}>일지</Text>
          </Pressable>
        </View>

        <FlatList
          data={groupStudents}
          keyExtractor={i => i.id}
          contentContainerStyle={s.studentList}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={s.emptyBox}>
              <Feather name="users" size={32} color={C.textMuted} />
              <Text style={s.emptyText}>이 반에 배정된 학생이 없습니다</Text>
            </View>
          }
          ListHeaderComponent={
            <Text style={s.listHeader}>
              학생 {groupStudents.length}명
            </Text>
          }
          renderItem={({ item, index }) => (
            <View style={[s.studentRow, { backgroundColor: C.card }]}>
              <View style={[s.avatar, { backgroundColor: themeColor + "18" }]}>
                <Text style={[s.avatarText, { color: themeColor }]}>{item.name[0]}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.studentName}>{item.name}</Text>
                {item.birth_year && (
                  <Text style={s.studentSub}>{item.birth_year}년생 · {item.schedule_labels || ""}</Text>
                )}
              </View>
              {/* 연결 상태 */}
              {item.parent_user_id ? (
                <View style={[s.connBadge, { backgroundColor: "#D1FAE5" }]}>
                  <Feather name="check-circle" size={10} color="#059669" />
                  <Text style={[s.connText, { color: "#059669" }]}>연결</Text>
                </View>
              ) : item.status === "pending_parent_link" ? (
                <View style={[s.connBadge, { backgroundColor: "#FFF7ED" }]}>
                  <Feather name="clock" size={10} color="#EA580C" />
                  <Text style={[s.connText, { color: "#EA580C" }]}>대기</Text>
                </View>
              ) : null}
            </View>
          )}
        />
      </SafeAreaView>
    );
  }

  // ── 메인 시간표 뷰 ──────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <PoolHeader />
      {/* 타이틀 */}
      <View style={s.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>내 반</Text>
          <Text style={s.titleSub}>
            {new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" })}
          </Text>
        </View>
        <Pressable style={[s.createBtn, { backgroundColor: themeColor }]} onPress={() => setShowCreate(true)}>
          <Feather name="plus" size={14} color="#fff" />
          <Text style={s.createBtnText}>반 등록</Text>
        </Pressable>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        <WeeklySchedule
          classGroups={groups}
          statusMap={statusMap}
          onSelectClass={setSelectedGroup}
          themeColor={themeColor}
        />
        <View style={{ height: 120 }} />
      </ScrollView>

      {/* 반 등록 Flow */}
      {showCreate && (
        <ClassCreateFlow
          token={token}
          role="teacher"
          selfTeacher={selfTeacher}
          onSuccess={(newGroup) => {
            setGroups(prev => [...prev, newGroup as TeacherClassGroup]);
            setShowCreate(false);
          }}
          onClose={() => setShowCreate(false)}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: "#F3F4F6" },
  titleRow:    { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  title:       { fontSize: 20, fontFamily: "Inter_700Bold", color: "#111827" },
  titleSub:    { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  createBtn:   { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  createBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },

  subHeader:    { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn:      { width: 36, height: 36, borderRadius: 10, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  subTitle:     { fontSize: 16, fontFamily: "Inter_700Bold", color: C.text },
  subSub:       { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textMuted, marginTop: 1 },
  subActionBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  subActionText:{ fontSize: 12, fontFamily: "Inter_600SemiBold" },

  studentList:  { padding: 12, gap: 8, paddingBottom: 120 },
  listHeader:   { fontSize: 12, fontFamily: "Inter_500Medium", color: C.textMuted, marginBottom: 4 },
  studentRow:   { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14 },
  avatar:       { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  avatarText:   { fontSize: 15, fontFamily: "Inter_700Bold" },
  studentName:  { fontSize: 15, fontFamily: "Inter_600SemiBold", color: C.text },
  studentSub:   { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  connBadge:    { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  connText:     { fontSize: 10, fontFamily: "Inter_600SemiBold" },

  emptyBox:     { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyText:    { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textMuted },
});
