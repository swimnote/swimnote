/**
 * (teacher)/attendance.tsx — 출결 탭
 *
 * 구조: WeeklySchedule → 반 선택 → 출결 체크 서브뷰
 * - "모두출석" 상단 버튼
 * - 완료 버튼 하단 고정
 * - 미체크 학생 있을 때 경고
 */
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { PoolHeader } from "@/components/PoolHeader";
import { WeeklySchedule, TeacherClassGroup, SlotStatus } from "@/components/teacher/WeeklySchedule";

const C = Colors.light;

type AttStatus = "present" | "absent";
interface Student { id: string; name: string; assigned_class_ids?: string[]; class_group_id?: string | null; }

function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function TeacherAttendanceScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const params = useLocalSearchParams<{ classGroupId?: string }>();

  const [groups,         setGroups]         = useState<TeacherClassGroup[]>([]);
  const [students,       setStudents]       = useState<Student[]>([]);
  const [attTodayMap,    setAttTodayMap]    = useState<Record<string, number>>({});  // classId → checked count
  const [diarySet,       setDiarySet]       = useState<Set<string>>(new Set());
  const [loading,        setLoading]        = useState(true);
  const [refreshing,     setRefreshing]     = useState(false);

  const [selectedGroup,  setSelectedGroup]  = useState<TeacherClassGroup | null>(null);
  const [date,           setDate]           = useState(todayDateStr);
  const [attState,       setAttState]       = useState<Record<string, AttStatus>>({});
  const [saving,         setSaving]         = useState(false);

  const load = useCallback(async () => {
    const today = todayDateStr();
    try {
      const [cgRes, stRes, attRes, dRes] = await Promise.all([
        apiRequest(token, "/class-groups"),
        apiRequest(token, "/students"),
        apiRequest(token, `/attendance?date=${today}`),
        apiRequest(token, `/diary?date=${today}`),
      ]);
      let groupsList: TeacherClassGroup[] = [];
      if (cgRes.ok)  { groupsList = await cgRes.json(); setGroups(groupsList); }
      if (stRes.ok)  setStudents(await stRes.json());
      if (attRes.ok) {
        const arr: any[] = await attRes.json();
        const map: Record<string, number> = {};
        arr.forEach(a => { const cid = a.class_group_id || a.class_id; if (cid) map[cid] = (map[cid] || 0) + 1; });
        setAttTodayMap(map);
      }
      if (dRes.ok) {
        const arr: any[] = await dRes.json();
        setDiarySet(new Set(arr.map((d: any) => d.class_group_id).filter(Boolean)));
      }
      // params로 직접 진입 시 해당 반 자동 선택
      if (params.classGroupId) {
        const found = groupsList.find(g => g.id === params.classGroupId);
        if (found) await openGroup(found, today);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function openGroup(group: TeacherClassGroup, dateStr?: string) {
    const d = dateStr || date;
    setSelectedGroup(group);
    setSaving(false);
    // 해당 반 출결 조회
    try {
      const r = await apiRequest(token, `/attendance?class_id=${group.id}&date=${d}`);
      if (r.ok) {
        const arr: any[] = await r.json();
        const map: Record<string, AttStatus> = {};
        arr.forEach(a => { map[a.student_id ?? a.member_id] = a.status; });
        setAttState(map);
      }
    } catch (e) { console.error(e); }
  }

  const groupStudents = selectedGroup
    ? students.filter(st =>
        (Array.isArray(st.assigned_class_ids) && st.assigned_class_ids.includes(selectedGroup.id))
        || st.class_group_id === selectedGroup.id
      ).sort((a, b) => a.name.localeCompare(b.name))
    : [];

  function markAll() {
    const map: Record<string, AttStatus> = {};
    groupStudents.forEach(st => { map[st.id] = "present"; });
    setAttState(map);
  }

  async function saveOne(studentId: string, status: AttStatus) {
    setSaving(true);
    try {
      await apiRequest(token, `/students/${studentId}/attendance`, {
        method: "POST",
        body: JSON.stringify({ date, status }),
      });
      setAttState(prev => ({ ...prev, [studentId]: status }));
      setAttTodayMap(prev => ({ ...prev, [selectedGroup!.id]: Object.values({ ...prev, [studentId]: status }).filter(v => v).length }));
    } catch { Alert.alert("오류", "출결 저장에 실패했습니다."); }
    finally { setSaving(false); }
  }

  async function saveAll() {
    const unchecked = groupStudents.filter(st => !attState[st.id]);
    if (unchecked.length > 0) {
      Alert.alert(
        "미체크 학생 있음",
        `${unchecked.map(s => s.name).join(", ")} (${unchecked.length}명)의 출결이 미체크 상태입니다. 저장하시겠습니까?`,
        [
          { text: "취소", style: "cancel" },
          { text: "저장", onPress: () => doSaveAll() },
        ]
      );
      return;
    }
    doSaveAll();
  }

  async function doSaveAll() {
    setSaving(true);
    try {
      await Promise.all(
        groupStudents
          .filter(st => attState[st.id])
          .map(st =>
            apiRequest(token, `/students/${st.id}/attendance`, {
              method: "POST",
              body: JSON.stringify({ date, status: attState[st.id] }),
            })
          )
      );
      // attTodayMap 업데이트
      const checkedCount = groupStudents.filter(st => attState[st.id]).length;
      setAttTodayMap(prev => ({ ...prev, [selectedGroup!.id]: checkedCount }));
      Alert.alert("완료", "출결이 저장되었습니다.");
      setSelectedGroup(null);
    } catch { Alert.alert("오류", "저장에 실패했습니다."); }
    finally { setSaving(false); }
  }

  // statusMap
  const statusMap: Record<string, SlotStatus> = {};
  groups.forEach(g => {
    statusMap[g.id] = { attChecked: attTodayMap[g.id] || 0, diaryDone: diarySet.has(g.id), hasPhotos: false };
  });

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <PoolHeader />
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  // ── 출결 서브뷰 ──────────────────────────────────────────────
  if (selectedGroup) {
    const group = selectedGroup;
    const checkedCnt = groupStudents.filter(st => attState[st.id]).length;
    const total      = groupStudents.length;

    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <PoolHeader />
        {/* 헤더 */}
        <View style={s.subHeader}>
          <Pressable style={s.backBtn} onPress={() => setSelectedGroup(null)}>
            <Feather name="arrow-left" size={20} color={C.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={s.subTitle}>{group.name} 출결</Text>
            <Text style={s.subSub}>{date} · {group.schedule_time}</Text>
          </View>
          {/* 모두출석 버튼 */}
          <Pressable style={[s.allPresentBtn, { backgroundColor: "#D1FAE5" }]} onPress={markAll}>
            <Feather name="check-circle" size={14} color="#059669" />
            <Text style={[s.allPresentText, { color: "#059669" }]}>모두출석</Text>
          </Pressable>
        </View>

        {/* 출결 현황 */}
        <View style={[s.attSummary, { borderColor: themeColor + "30", backgroundColor: themeColor + "08" }]}>
          <Text style={[s.attSummaryText, { color: themeColor }]}>
            체크 {checkedCnt}/{total}명
          </Text>
          <Text style={s.attSummaryPresent}>
            출석 {groupStudents.filter(st => attState[st.id] === "present").length}명
          </Text>
          <Text style={s.attSummaryAbsent}>
            결석 {groupStudents.filter(st => attState[st.id] === "absent").length}명
          </Text>
          <Text style={s.attSummaryUnchecked}>
            미체크 {total - checkedCnt}명
          </Text>
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
          renderItem={({ item }) => {
            const cur = attState[item.id];
            return (
              <View style={[s.attRow, { backgroundColor: C.card }]}>
                {/* 아바타 */}
                <View style={[s.attAvatar, {
                  backgroundColor: cur === "present" ? "#D1FAE5"
                    : cur === "absent" ? "#FEE2E2"
                    : themeColor + "15"
                }]}>
                  <Text style={[s.attAvatarText, {
                    color: cur === "present" ? "#059669"
                      : cur === "absent" ? "#DC2626"
                      : themeColor
                  }]}>{item.name[0]}</Text>
                </View>
                <Text style={s.attName}>{item.name}</Text>
                {/* 출석/결석 2버튼 */}
                <View style={s.attBtns}>
                  <Pressable
                    style={[s.attBtn, { backgroundColor: cur === "present" ? "#059669" : "#F3F4F6", borderColor: cur === "present" ? "#059669" : "#E5E7EB" }]}
                    onPress={() => saveOne(item.id, "present")}
                  >
                    <Text style={[s.attBtnText, { color: cur === "present" ? "#fff" : "#374151" }]}>출석</Text>
                  </Pressable>
                  <Pressable
                    style={[s.attBtn, { backgroundColor: cur === "absent" ? "#DC2626" : "#F3F4F6", borderColor: cur === "absent" ? "#DC2626" : "#E5E7EB" }]}
                    onPress={() => saveOne(item.id, "absent")}
                  >
                    <Text style={[s.attBtnText, { color: cur === "absent" ? "#fff" : "#374151" }]}>결석</Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
        />

        {/* 하단 완료 버튼 */}
        <View style={s.footer}>
          <Pressable
            style={[s.doneBtn, { backgroundColor: themeColor, opacity: saving ? 0.7 : 1 }]}
            onPress={saveAll}
            disabled={saving}
          >
            {saving ? <ActivityIndicator color="#fff" size="small" />
              : <><Feather name="check" size={16} color="#fff" /><Text style={s.doneBtnText}>출결 완료</Text></>}
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ── 메인 시간표 뷰 ──────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <PoolHeader />
      <View style={s.titleRow}>
        <Text style={s.title}>출결 체크</Text>
        <Text style={s.dateBadge}>{date}</Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        <WeeklySchedule
          classGroups={groups}
          statusMap={statusMap}
          onSelectClass={g => openGroup(g)}
          themeColor={themeColor}
        />
        <View style={{ height: 120 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: "#F3F4F6" },
  titleRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10 },
  title:      { fontSize: 20, fontFamily: "Inter_700Bold", color: "#111827" },
  dateBadge:  { fontSize: 13, fontFamily: "Inter_500Medium", color: "#6B7280" },

  subHeader:  { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  backBtn:    { width: 36, height: 36, borderRadius: 10, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  subTitle:   { fontSize: 16, fontFamily: "Inter_700Bold", color: "#111827" },
  subSub:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 1 },

  allPresentBtn:  { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
  allPresentText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  attSummary: { flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1 },
  attSummaryText:     { flex: 1, fontSize: 13, fontFamily: "Inter_700Bold" },
  attSummaryPresent:  { fontSize: 12, fontFamily: "Inter_500Medium", color: "#059669" },
  attSummaryAbsent:   { fontSize: 12, fontFamily: "Inter_500Medium", color: "#DC2626" },
  attSummaryUnchecked:{ fontSize: 12, fontFamily: "Inter_500Medium", color: "#9CA3AF" },

  studentList: { padding: 12, gap: 8, paddingBottom: 100 },
  attRow:     { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14 },
  attAvatar:  { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  attAvatarText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  attName:    { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#111827" },
  attBtns:    { flexDirection: "row", gap: 6 },
  attBtn:     { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, borderWidth: 1.5 },
  attBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  emptyBox:   { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyText:  { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF" },

  footer:     { padding: 12, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  doneBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 50, borderRadius: 14 },
  doneBtnText:{ color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },
});
