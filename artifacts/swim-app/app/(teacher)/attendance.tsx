/**
 * (teacher)/attendance.tsx — 출결 관리 탭
 *
 * 탭 구조:
 *  [출결 체크]  WeeklySchedule → 반 선택 → 출결 체크 서브뷰
 *  [보강 관리]  보강 대기 목록 → 보강 지정 모달 / 결석소멸 모달
 */
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { PoolHeader } from "@/components/PoolHeader";
import { WeeklySchedule, TeacherClassGroup, SlotStatus } from "@/components/teacher/WeeklySchedule";

const C = Colors.light;

type SubTab = "attendance" | "makeup";
type AttStatus = "present" | "absent";

interface Student {
  id: string; name: string;
  assigned_class_ids?: string[]; class_group_id?: string | null;
}
interface MakeupSession {
  id: string; student_id: string; student_name: string;
  original_class_group_id: string | null; original_class_group_name: string;
  original_teacher_id: string | null; original_teacher_name: string;
  absence_date: string; absence_time?: string | null; status: string;
}
interface EligibleClass {
  id: string; name: string; schedule_days: string; schedule_time: string;
  capacity: number; current_members: number; available_slots: number;
  instructor: string; teacher_user_id: string;
}

function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysDiff(dateStr: string) {
  return Math.floor((Date.now() - new Date(dateStr + "T00:00:00").getTime()) / 86400000);
}

/* ──────────────────────────────────────────────────
   날짜 선택 전용 인라인 컴포넌트
   ────────────────────────────────────────────────── */
function DatePicker({ value, onChange }: { value: string; onChange: (d: string) => void }) {
  const [y, m, d] = value.split("-").map(Number);
  function add(days: number) {
    const dt = new Date(value + "T00:00:00");
    dt.setDate(dt.getDate() + days);
    onChange(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`);
  }
  const DOW = ["일","월","화","수","목","금","토"][new Date(value + "T00:00:00").getDay()];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, marginVertical: 8 }}>
      <TouchableOpacity onPress={() => add(-1)} style={{ padding: 8 }}>
        <Feather name="chevron-left" size={22} color={C.text} />
      </TouchableOpacity>
      <Text style={{ fontSize: 16, fontFamily: "Inter_600SemiBold", color: C.text }}>
        {y}년 {m}월 {d}일 ({DOW})
      </Text>
      <TouchableOpacity onPress={() => add(1)} style={{ padding: 8 }}>
        <Feather name="chevron-right" size={22} color={C.text} />
      </TouchableOpacity>
    </View>
  );
}

export default function TeacherAttendanceScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ classGroupId?: string }>();

  /* ─ 공통 ─ */
  const [subTab,         setSubTab]         = useState<SubTab>("attendance");
  const [groups,         setGroups]         = useState<TeacherClassGroup[]>([]);
  const [students,       setStudents]       = useState<Student[]>([]);
  const [attTodayMap,    setAttTodayMap]    = useState<Record<string, number>>({});
  const [diarySet,       setDiarySet]       = useState<Set<string>>(new Set());
  const [loading,        setLoading]        = useState(true);
  const [refreshing,     setRefreshing]     = useState(false);

  /* ─ 출결 체크 ─ */
  const [selectedGroup,  setSelectedGroup]  = useState<TeacherClassGroup | null>(null);
  const [date,           setDate]           = useState(todayDateStr);
  const [attState,       setAttState]       = useState<Record<string, AttStatus>>({});
  const [saving,         setSaving]         = useState(false);
  const [saveMsg,        setSaveMsg]        = useState("");

  /* ─ 보강 관리 ─ */
  const [makeupList,     setMakeupList]     = useState<MakeupSession[]>([]);
  const [makeupLoading,  setMakeupLoading]  = useState(false);
  const [makeupRefresh,  setMakeupRefresh]  = useState(false);

  /* ─ 보강 지정 모달 ─ */
  const [assignTarget,   setAssignTarget]   = useState<MakeupSession | null>(null);
  const [eligibleClasses,setEligibleClasses]= useState<EligibleClass[]>([]);
  const [eligLoading,    setEligLoading]    = useState(false);
  const [assignClassId,  setAssignClassId]  = useState<string>("");
  const [assignDate,     setAssignDate]     = useState(todayDateStr);
  const [assigning,      setAssigning]      = useState(false);
  const [assignError,    setAssignError]    = useState("");

  /* ─ 결석소멸 모달 ─ */
  const [extTarget,      setExtTarget]      = useState<MakeupSession | null>(null);
  const [extReason,      setExtReason]      = useState("보강원하지않음");
  const [extCustom,      setExtCustom]      = useState("");
  const [extLoading,     setExtLoading]     = useState(false);
  const [extError,       setExtError]       = useState("");

  /* ════════════════════ 로드 ════════════════════ */
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
      if (params.classGroupId) {
        const found = groupsList.find(g => g.id === params.classGroupId);
        if (found) await openGroup(found, today);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  const loadMakeups = useCallback(async () => {
    setMakeupLoading(true);
    try {
      const res = await apiRequest(token, "/teacher/makeups?status=pending");
      if (res.ok) setMakeupList(await res.json());
    } catch (e) { console.error(e); }
    finally { setMakeupLoading(false); setMakeupRefresh(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (subTab === "makeup") loadMakeups(); }, [subTab, loadMakeups]);

  /* ════════════════════ 출결 체크 함수 ════════════════════ */
  async function openGroup(group: TeacherClassGroup, dateStr?: string) {
    const d = dateStr || date;
    setSelectedGroup(group);
    setSaving(false); setSaveMsg("");
    try {
      const r = await apiRequest(token, `/attendance?class_group_id=${group.id}&date=${d}`);
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
    const prevStatus = attState[studentId];
    try {
      await apiRequest(token, `/students/${studentId}/attendance`, {
        method: "POST",
        body: JSON.stringify({ date, status, class_group_id: selectedGroup?.id }),
      });
      setAttState(prev => ({ ...prev, [studentId]: status }));
      // 출결 완료 카운트 업데이트 (체크 여부 기준, present+absent 모두)
      setAttTodayMap(prev => {
        const cgId = selectedGroup?.id;
        if (!cgId) return prev;
        let cnt = prev[cgId] || 0;
        if (!prevStatus) cnt = Math.min(cnt + 1, groupStudents.length); // 신규 체크
        return { ...prev, [cgId]: cnt };
      });
      // 결석 시 보강 목록 갱신
      if (status === "absent" && prevStatus !== "absent") {
        setTimeout(() => loadMakeups(), 600);
      }
      // 출석 전환 시 보강 대기 즉시 제거
      if (status === "present" && prevStatus === "absent") {
        setMakeupList(prev => prev.filter(m => !(m.student_id === studentId && m.absence_date === date)));
      }
    } catch { }
  }

  async function doSaveAll(goBack = false) {
    setSaving(true); setSaveMsg("");
    try {
      const checkedStudents = groupStudents.filter(st => attState[st.id]);
      await Promise.all(
        checkedStudents.map(st =>
          apiRequest(token, `/students/${st.id}/attendance`, {
            method: "POST",
            body: JSON.stringify({ date, status: attState[st.id], class_group_id: selectedGroup?.id }),
          })
        )
      );
      const checkedCnt = checkedStudents.length;
      const hasAbsent = checkedStudents.some(st => attState[st.id] === "absent");
      setAttTodayMap(prev => ({ ...prev, [selectedGroup!.id]: checkedCnt }));
      if (hasAbsent) setTimeout(() => loadMakeups(), 400);
      if (goBack) {
        // 적용 버튼: 저장 즉시 이전 화면으로
        setSaveMsg("저장되었습니다.");
        setTimeout(() => { setSaveMsg(""); setSelectedGroup(null); }, 600);
      } else {
        setSaveMsg("출결이 저장되었습니다.");
        setTimeout(() => { setSaveMsg(""); setSelectedGroup(null); }, 1200);
      }
    } catch { setSaveMsg("저장에 실패했습니다."); }
    finally { setSaving(false); }
  }

  function handleSaveAll() {
    const unchecked = groupStudents.filter(st => !attState[st.id]);
    if (unchecked.length > 0) {
      setSaveMsg(`미체크 ${unchecked.length}명 있음 — 다시 한번 누르면 저장`);
      return;
    }
    doSaveAll(false);
  }

  function handleApply() {
    doSaveAll(true);
  }

  /* ════════════════════ 보강 지정 함수 ════════════════════ */
  async function openAssign(mk: MakeupSession) {
    setAssignTarget(mk);
    setAssignClassId(""); setAssignDate(todayDateStr()); setAssignError("");
    setEligLoading(true);
    try {
      const res = await apiRequest(token, `/teacher/makeups/eligible-classes`);
      if (res.ok) {
        const list: EligibleClass[] = await res.json();
        list.sort((a, b) => {
          const aM = a.teacher_user_id === mk.original_teacher_id ? 0 : 1;
          const bM = b.teacher_user_id === mk.original_teacher_id ? 0 : 1;
          return aM - bM || a.schedule_days.localeCompare(b.schedule_days);
        });
        setEligibleClasses(list);
      }
    } finally { setEligLoading(false); }
  }

  async function confirmAssign() {
    if (!assignClassId) { setAssignError("반을 선택해주세요."); return; }
    if (!assignDate)    { setAssignError("날짜를 선택해주세요."); return; }
    setAssigning(true); setAssignError("");
    try {
      const res = await apiRequest(token, `/teacher/makeups/${assignTarget!.id}/assign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class_group_id: assignClassId, assigned_date: assignDate }),
      });
      if (res.ok) {
        setMakeupList(prev => prev.filter(m => m.id !== assignTarget!.id));
        setAssignTarget(null);
      } else {
        const d = await res.json();
        setAssignError(d.error || "지정 실패");
      }
    } finally { setAssigning(false); }
  }

  /* ════════════════════ 결석소멸 함수 ════════════════════ */
  function openExtinguish(mk: MakeupSession) {
    setExtTarget(mk);
    setExtReason("보강원하지않음"); setExtCustom(""); setExtError("");
  }

  async function confirmExtinguish() {
    setExtLoading(true); setExtError("");
    try {
      const res = await apiRequest(token, `/teacher/makeups/${extTarget!.id}/extinguish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cancelled_reason: extReason,
          cancelled_custom: extReason === "기타" ? extCustom : undefined,
        }),
      });
      if (res.ok) {
        setMakeupList(prev => prev.filter(m => m.id !== extTarget!.id));
        setExtTarget(null);
      } else {
        const d = await res.json();
        setExtError(d.error || "소멸 실패");
      }
    } finally { setExtLoading(false); }
  }

  /* ════════════════════ statusMap ════════════════════ */
  const statusMap: Record<string, SlotStatus> = {};
  groups.forEach(g => {
    statusMap[g.id] = { attChecked: attTodayMap[g.id] || 0, diaryDone: diarySet.has(g.id), hasPhotos: false };
  });

  /* ════════════════════ 로딩 ════════════════════ */
  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <PoolHeader />
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  /* ════════════════════ 출결 서브뷰 ════════════════════ */
  if (selectedGroup) {
    const group = selectedGroup;
    const checkedCnt = groupStudents.filter(st => attState[st.id]).length;
    const total = groupStudents.length;

    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <PoolHeader />
        <View style={s.subHeader}>
          <Pressable style={s.backBtn} onPress={() => { setSelectedGroup(null); setSaveMsg(""); }}>
            <Feather name="arrow-left" size={20} color={C.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={s.subTitle}>{group.name} 출결</Text>
            <Text style={s.subSub}>{date} · {group.schedule_time}</Text>
          </View>
          <Pressable style={[s.allPresentBtn, { backgroundColor: "#D1FAE5" }]} onPress={markAll}>
            <Feather name="check-circle" size={14} color="#059669" />
            <Text style={[s.allPresentText, { color: "#059669" }]}>모두출석</Text>
          </Pressable>
          <Pressable
            style={[s.applyBtn, { backgroundColor: themeColor, opacity: saving ? 0.6 : 1 }]}
            onPress={handleApply}
            disabled={saving}
          >
            {saving
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.applyBtnText}>적용</Text>}
          </Pressable>
        </View>

        <View style={[s.attSummary, { borderColor: themeColor + "30", backgroundColor: themeColor + "08" }]}>
          <Text style={[s.attSummaryText, { color: themeColor }]}>체크 {checkedCnt}/{total}명</Text>
          <Text style={s.attSummaryPresent}>출석 {groupStudents.filter(st => attState[st.id] === "present").length}명</Text>
          <Text style={s.attSummaryAbsent}>결석 {groupStudents.filter(st => attState[st.id] === "absent").length}명</Text>
          <Text style={s.attSummaryUnchecked}>미체크 {total - checkedCnt}명</Text>
        </View>

        {saveMsg ? (
          <View style={[s.saveMsg, { backgroundColor: saveMsg.includes("저장") ? "#D1FAE5" : "#FEF3C7" }]}>
            <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: saveMsg.includes("저장") ? "#059669" : "#92400E" }}>{saveMsg}</Text>
          </View>
        ) : null}

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
                <View style={[s.attAvatar, {
                  backgroundColor: cur === "present" ? "#D1FAE5" : cur === "absent" ? "#FEE2E2" : themeColor + "15"
                }]}>
                  <Text style={[s.attAvatarText, {
                    color: cur === "present" ? "#059669" : cur === "absent" ? "#DC2626" : themeColor
                  }]}>{item.name[0]}</Text>
                </View>
                <Text style={s.attName}>{item.name}</Text>
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

        <View style={s.footer}>
          <Pressable
            style={[s.doneBtn, { backgroundColor: themeColor, opacity: saving ? 0.7 : 1 }]}
            onPress={handleSaveAll}
            disabled={saving}
          >
            {saving
              ? <ActivityIndicator color="#fff" size="small" />
              : <><Feather name="check" size={16} color="#fff" /><Text style={s.doneBtnText}>출결 완료</Text></>}
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  /* ════════════════════ 메인 뷰 ════════════════════ */
  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <PoolHeader />

      {/* 탭 스위처 */}
      <View style={s.subTabBar}>
        {(["attendance", "makeup"] as SubTab[]).map(t => (
          <Pressable
            key={t}
            style={[s.subTabBtn, subTab === t && { borderBottomColor: themeColor, borderBottomWidth: 2 }]}
            onPress={() => setSubTab(t)}
          >
            <Text style={[s.subTabLabel, { color: subTab === t ? themeColor : C.textSecondary }]}>
              {t === "attendance" ? "출결 체크" : makeupList.length > 0 ? `보강 관리 (${makeupList.length})` : "보강 관리"}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* ── 출결 체크 탭 ── */}
      {subTab === "attendance" && (
        <>
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
        </>
      )}

      {/* ── 보강 관리 탭 ── */}
      {subTab === "makeup" && (
        <>
          {makeupLoading ? (
            <ActivityIndicator color={themeColor} style={{ marginTop: 60 }} />
          ) : (
            <FlatList
              data={makeupList}
              keyExtractor={m => m.id}
              contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 80, gap: 10 }}
              showsVerticalScrollIndicator={false}
              refreshControl={<RefreshControl refreshing={makeupRefresh} onRefresh={() => { setMakeupRefresh(true); loadMakeups(); }} />}
              ListEmptyComponent={
                <View style={s.emptyBox}>
                  <Feather name="check-circle" size={40} color="#D1FAE5" />
                  <Text style={[s.emptyText, { marginTop: 8 }]}>보강 대기 중인 학생이 없습니다</Text>
                </View>
              }
              renderItem={({ item: mk }) => {
                const diff = daysDiff(mk.absence_date);
                const isOld = diff >= 14;
                return (
                  <View style={[s.mkCard, { backgroundColor: C.card }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.mkName, { color: isOld ? "#DC2626" : C.text }]}>
                        {mk.student_name}
                        {isOld && <Text style={{ fontSize: 11, color: "#DC2626" }}>  ({diff}일 경과)</Text>}
                      </Text>
                      <Text style={s.mkSub}>{mk.original_class_group_name}</Text>
                      <Text style={s.mkSub}>결석일: {mk.absence_date}{mk.absence_time ? ` ${mk.absence_time}` : ""}</Text>
                    </View>
                    <View style={{ gap: 6 }}>
                      <TouchableOpacity
                        style={[s.mkActionBtn, { backgroundColor: themeColor }]}
                        onPress={() => openAssign(mk)}
                      >
                        <Text style={s.mkActionBtnText}>보강 지정</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[s.mkActionBtn, { backgroundColor: "#F3F4F6" }]}
                        onPress={() => openExtinguish(mk)}
                      >
                        <Text style={[s.mkActionBtnText, { color: "#6B7280" }]}>소멸</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              }}
            />
          )}
        </>
      )}

      {/* ════════════ 보강 지정 모달 ════════════ */}
      <Modal visible={!!assignTarget} animationType="slide" transparent presentationStyle="overFullScreen">
        <View style={s.modalOverlay}>
          <View style={[s.modalBox, { paddingBottom: insets.bottom + 16 }]}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>보강 지정</Text>
              <Pressable onPress={() => setAssignTarget(null)} hitSlop={8}>
                <Feather name="x" size={22} color={C.text} />
              </Pressable>
            </View>
            {assignTarget && (
              <Text style={s.modalSub}>{assignTarget.student_name} · 결석 {assignTarget.absence_date}</Text>
            )}

            <Text style={[s.sectionLabel, { marginTop: 14 }]}>보강 날짜</Text>
            <DatePicker value={assignDate} onChange={setAssignDate} />

            <Text style={s.sectionLabel}>반 선택</Text>
            {eligLoading ? (
              <ActivityIndicator color={themeColor} style={{ marginTop: 16 }} />
            ) : eligibleClasses.length === 0 ? (
              <Text style={{ textAlign: "center", color: C.textMuted, marginTop: 16, fontFamily: "Inter_400Regular" }}>
                보강 가능한 반이 없습니다
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: 260 }} showsVerticalScrollIndicator={false}>
                {eligibleClasses.map(ec => {
                  const isSame = assignTarget && ec.teacher_user_id === assignTarget.original_teacher_id;
                  const sel = assignClassId === ec.id;
                  return (
                    <TouchableOpacity
                      key={ec.id}
                      style={[s.eligRow, sel && { backgroundColor: themeColor + "15", borderColor: themeColor }]}
                      onPress={() => setAssignClassId(ec.id)}
                    >
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={[s.eligName, { color: sel ? themeColor : C.text }]}>{ec.name}</Text>
                          {isSame && <View style={s.sameTeacherBadge}><Text style={s.sameTeacherText}>같은 선생님</Text></View>}
                        </View>
                        <Text style={s.eligSub}>{ec.schedule_days} {ec.schedule_time} · {ec.instructor}</Text>
                      </View>
                      <View style={[s.slotBadge, { backgroundColor: ec.available_slots > 0 ? "#D1FAE5" : "#FEE2E2" }]}>
                        <Text style={[s.slotText, { color: ec.available_slots > 0 ? "#059669" : "#DC2626" }]}>
                          {ec.current_members}/{ec.capacity}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            {assignError ? <Text style={s.errText}>{assignError}</Text> : null}

            <Pressable
              style={[s.confirmBtn, { backgroundColor: themeColor, opacity: assigning ? 0.7 : 1, marginTop: 16 }]}
              onPress={confirmAssign}
              disabled={assigning}
            >
              {assigning
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={s.confirmBtnText}>보강 지정 완료</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ════════════ 결석소멸 모달 ════════════ */}
      <Modal visible={!!extTarget} animationType="slide" transparent presentationStyle="overFullScreen">
        <View style={s.modalOverlay}>
          <View style={[s.modalBox, { paddingBottom: insets.bottom + 16 }]}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>결석소멸</Text>
              <Pressable onPress={() => setExtTarget(null)} hitSlop={8}>
                <Feather name="x" size={22} color={C.text} />
              </Pressable>
            </View>
            {extTarget && (
              <Text style={s.modalSub}>{extTarget.student_name} · 결석 {extTarget.absence_date}</Text>
            )}

            <View style={[s.warnBox, { marginTop: 12 }]}>
              <Feather name="alert-triangle" size={14} color="#92400E" />
              <Text style={s.warnText}>결석소멸 처리 시 보강 권리가 사라집니다.</Text>
            </View>

            <Text style={[s.sectionLabel, { marginTop: 14 }]}>소멸 사유</Text>
            {(["보강원하지않음", "무단결석", "기타"] as const).map(r => (
              <TouchableOpacity
                key={r}
                style={[s.reasonRow, extReason === r && { backgroundColor: "#FEF3C7" }]}
                onPress={() => setExtReason(r)}
              >
                <View style={[s.radioCircle, extReason === r && { borderColor: "#F59E0B", backgroundColor: "#F59E0B" }]} />
                <Text style={[s.reasonText, { color: C.text }]}>{r}</Text>
              </TouchableOpacity>
            ))}
            {extReason === "기타" && (
              <TextInput
                style={[s.customInput, { borderColor: C.border, color: C.text }]}
                value={extCustom}
                onChangeText={setExtCustom}
                placeholder="직접 입력..."
                placeholderTextColor={C.textMuted}
              />
            )}

            {extError ? <Text style={s.errText}>{extError}</Text> : null}

            <Pressable
              style={[s.confirmBtn, { backgroundColor: "#EF4444", opacity: extLoading ? 0.7 : 1, marginTop: 16 }]}
              onPress={confirmExtinguish}
              disabled={extLoading}
            >
              {extLoading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={s.confirmBtnText}>결석소멸 확인</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: "#F3F4F6" },

  subTabBar:   { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  subTabBtn:   { flex: 1, alignItems: "center", paddingVertical: 12 },
  subTabLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  titleRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10 },
  title:       { fontSize: 20, fontFamily: "Inter_700Bold", color: "#111827" },
  dateBadge:   { fontSize: 13, fontFamily: "Inter_500Medium", color: "#6B7280" },

  subHeader:   { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  backBtn:     { width: 36, height: 36, borderRadius: 10, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  subTitle:    { fontSize: 16, fontFamily: "Inter_700Bold", color: "#111827" },
  subSub:      { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 1 },

  allPresentBtn:  { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  allPresentText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  applyBtn:       { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, alignItems: "center", justifyContent: "center", minWidth: 52 },
  applyBtnText:   { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },

  attSummary:         { flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1 },
  attSummaryText:     { flex: 1, fontSize: 13, fontFamily: "Inter_700Bold" },
  attSummaryPresent:  { fontSize: 12, fontFamily: "Inter_500Medium", color: "#059669" },
  attSummaryAbsent:   { fontSize: 12, fontFamily: "Inter_500Medium", color: "#DC2626" },
  attSummaryUnchecked:{ fontSize: 12, fontFamily: "Inter_500Medium", color: "#9CA3AF" },

  saveMsg:     { marginHorizontal: 12, marginTop: 6, padding: 10, borderRadius: 10, alignItems: "center" },
  studentList: { padding: 12, gap: 8, paddingBottom: 100 },
  attRow:      { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14 },
  attAvatar:   { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  attAvatarText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  attName:     { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#111827" },
  attBtns:     { flexDirection: "row", gap: 6 },
  attBtn:      { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, borderWidth: 1.5 },
  attBtnText:  { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  emptyBox:    { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyText:   { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF" },

  footer:      { padding: 12, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  doneBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 50, borderRadius: 14 },
  doneBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },

  mkCard:      { borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  mkName:      { fontSize: 15, fontFamily: "Inter_700Bold" },
  mkSub:       { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },
  mkActionBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, alignItems: "center" },
  mkActionBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },

  modalOverlay:{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  modalBox:    { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  modalTitle:  { fontSize: 18, fontFamily: "Inter_700Bold", color: "#111827" },
  modalSub:    { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6B7280" },

  sectionLabel:{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#6B7280", marginBottom: 6 },
  eligRow:     { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 12, borderWidth: 1.5, borderColor: "#E5E7EB", marginBottom: 8 },
  eligName:    { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  eligSub:     { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2 },
  slotBadge:   { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  slotText:    { fontSize: 13, fontFamily: "Inter_700Bold" },
  sameTeacherBadge: { backgroundColor: "#EFF6FF", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  sameTeacherText:  { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#3B82F6" },

  warnBox:     { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FEF3C7", padding: 10, borderRadius: 10 },
  warnText:    { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: "#92400E" },
  reasonRow:   { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, marginBottom: 6 },
  radioCircle: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: "#D1D5DB" },
  reasonText:  { fontSize: 14, fontFamily: "Inter_500Medium" },
  customInput: { borderWidth: 1.5, borderRadius: 10, padding: 10, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4, minHeight: 44 },

  errText:     { color: "#EF4444", fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 6 },
  confirmBtn:  { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  confirmBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },
});
