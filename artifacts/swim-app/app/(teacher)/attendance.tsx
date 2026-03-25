/**
 * (teacher)/attendance.tsx — 출결 관리 탭
 *
 * [선생님 모드 출결 규칙]
 * - 기본 상태: 출석 (present)
 * - 수업 종료 후: 미입력 학생 자동 출석 처리 + 이름 줄 표시
 * - 결석 토글: attendance=absent + makeup_session 자동 생성 + 빨간 점
 * - 출석 복귀: makeup_session 자동 삭제 + 빨간 점 제거
 * - 저장 버튼 없음 (즉시 저장)
 * - 지각/결석사유 없음
 * - 정렬: 결석 → 출석
 */
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { WeeklySchedule, TeacherClassGroup, SlotStatus } from "@/components/teacher/WeeklySchedule";

const C = Colors.light;

type SubTab = "attendance" | "makeup";
type AttStatus = "present" | "absent";

interface Student {
  id: string;
  name: string;
  weekly_count?: number | null;
  assigned_class_ids?: string[];
  class_group_id?: string | null;
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

/** 수업 시간이 지났는지 판단 (schedule_time: "10:00~11:00" 형식) */
function isClassOver(group: TeacherClassGroup, dateStr: string): boolean {
  const today = todayDateStr();
  if (dateStr < today) return true;
  if (dateStr > today) return false;
  const match = (group.schedule_time || "").match(/(\d{1,2}:\d{2})(?:[~\-](\d{1,2}:\d{2}))?/);
  if (!match) return false;
  const endTime = match[2] || match[1];
  const [hour, min] = endTime.split(":").map(Number);
  const now = new Date();
  return now.getHours() > hour || (now.getHours() === hour && now.getMinutes() >= min);
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
  const params = useLocalSearchParams<{ classGroupId?: string; defaultTab?: string }>();

  const [subTab,         setSubTab]         = useState<SubTab>((params.defaultTab as SubTab) || "attendance");
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
  const [savingId,       setSavingId]       = useState<string | null>(null);
  const [autoSaving,     setAutoSaving]     = useState(false);
  const [classOver,      setClassOver]      = useState(false);

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
    setSavingId(null);

    const over = isClassOver(group, d);
    setClassOver(over);

    setAutoSaving(over);
    try {
      const r = await apiRequest(token, `/attendance?class_group_id=${group.id}&date=${d}`);
      const map: Record<string, AttStatus> = {};
      if (r.ok) {
        const arr: any[] = await r.json();
        arr.forEach(a => { map[a.student_id ?? a.member_id] = a.status; });
      }

      // 수업 종료 후 → 기록 없는 학생 자동 출석 처리
      if (over) {
        const groupStuds = students.filter(st =>
          (Array.isArray(st.assigned_class_ids) && st.assigned_class_ids.includes(group.id))
          || st.class_group_id === group.id
        );
        const withoutRecord = groupStuds.filter(st => !map[st.id]);
        if (withoutRecord.length > 0) {
          await Promise.all(withoutRecord.map(st =>
            apiRequest(token, `/attendance`, {
              method: "POST",
              body: JSON.stringify({ date: d, status: "present", class_group_id: group.id, student_id: st.id }),
            })
          ));
          withoutRecord.forEach(st => { map[st.id] = "present"; });
          // 출결 카운트 갱신
          setAttTodayMap(prev => ({ ...prev, [group.id]: groupStuds.length }));
        }
      }
      setAttState(map);
    } catch (e) { console.error(e); }
    finally { setAutoSaving(false); }
  }

  /* 즉시 저장 (개별) */
  async function saveOne(studentId: string, status: AttStatus) {
    if (savingId === studentId) return;
    const prevStatus = attState[studentId];
    if (prevStatus === status) return; // 같은 상태면 스킵

    setSavingId(studentId);
    try {
      await apiRequest(token, `/attendance`, {
        method: "POST",
        body: JSON.stringify({ date, status, class_group_id: selectedGroup?.id, student_id: studentId }),
      });
      setAttState(prev => ({ ...prev, [studentId]: status }));

      // 출결 카운트 갱신
      setAttTodayMap(prev => {
        const cgId = selectedGroup?.id;
        if (!cgId) return prev;
        const groupStuds = students.filter(st =>
          (Array.isArray(st.assigned_class_ids) && st.assigned_class_ids.includes(cgId))
          || st.class_group_id === cgId
        );
        const checkedCount = Object.values({ ...attState, [studentId]: status })
          .filter((_, i) => groupStuds[i]).length;
        return { ...prev, [cgId]: checkedCount };
      });

      // 결석 시 보강 목록 갱신
      if (status === "absent" && prevStatus !== "absent") {
        setTimeout(() => loadMakeups(), 800);
      }
      // 출석 전환 시 보강 즉시 제거
      if (status === "present" && prevStatus === "absent") {
        setMakeupList(prev => prev.filter(m => !(m.student_id === studentId && m.absence_date === date)));
      }
    } catch (e) { console.error(e); }
    finally { setSavingId(null); }
  }

  /* [반이동] 버튼: 해당 학생의 보강세션을 찾아 배정 모달 오픈 */
  async function handleMove(student: Student) {
    if (attState[student.id] !== "absent") return;
    // 현재 makeupList에서 먼저 탐색
    let mk = makeupList.find(m => m.student_id === student.id && m.absence_date === date);
    if (!mk) {
      // 없으면 API 다시 조회 (방금 결석 처리해서 생성됐을 수 있음)
      try {
        const res = await apiRequest(token, "/teacher/makeups?status=pending");
        if (res.ok) {
          const list: MakeupSession[] = await res.json();
          setMakeupList(list);
          mk = list.find(m => m.student_id === student.id && m.absence_date === date);
        }
      } catch { }
    }
    if (mk) {
      openAssign(mk);
    }
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

  /* ════════════════════ 학생 리스트 (정렬) ════════════════════ */
  const groupStudents: Student[] = selectedGroup
    ? students.filter(st =>
        (Array.isArray(st.assigned_class_ids) && st.assigned_class_ids.includes(selectedGroup.id))
        || st.class_group_id === selectedGroup.id
      )
    : [];

  // 결석 우선 → 이름순
  const sortedStudents = [...groupStudents].sort((a, b) => {
    const aAbsent = attState[a.id] === "absent" ? 0 : 1;
    const bAbsent = attState[b.id] === "absent" ? 0 : 1;
    return aAbsent - bAbsent || a.name.localeCompare(b.name, "ko");
  });

  /* ════════════════════ statusMap ════════════════════ */
  const statusMap: Record<string, SlotStatus> = {};
  groups.forEach(g => {
    statusMap[g.id] = { attChecked: attTodayMap[g.id] || 0, diaryDone: diarySet.has(g.id), hasPhotos: false };
  });

  /* ════════════════════ 로딩 ════════════════════ */
  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <SubScreenHeader title="출결 관리" homePath="/(teacher)/today-schedule" />
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  /* ════════════════════ 출결 서브뷰 ════════════════════ */
  if (selectedGroup) {
    const group = selectedGroup;
    const presentCnt = sortedStudents.filter(st => attState[st.id] === "present").length;
    const absentCnt  = sortedStudents.filter(st => attState[st.id] === "absent").length;

    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <SubScreenHeader
          title={`${group.name} 출결`}
          subtitle={`${date} · ${group.schedule_time}`}
          onBack={() => {
            if (params.classGroupId) router.back();
            else setSelectedGroup(null);
          }}
          homePath="/(teacher)/today-schedule"
        />

        {/* 출결 요약 배너 */}
        <View style={[s.attSummary, { borderColor: themeColor + "30", backgroundColor: themeColor + "08" }]}>
          {autoSaving ? (
            <>
              <ActivityIndicator size="small" color={themeColor} />
              <Text style={[s.attSummaryText, { color: themeColor }]}>출석 자동 처리 중...</Text>
            </>
          ) : (
            <>
              <Text style={[s.attSummaryText, { color: themeColor }]}>
                전체 {sortedStudents.length}명
              </Text>
              <View style={s.summaryDot} />
              <Text style={s.attSummaryPresent}>출석 {presentCnt}명</Text>
              {absentCnt > 0 && (
                <>
                  <View style={s.summaryDot} />
                  <Text style={s.attSummaryAbsent}>결석 {absentCnt}명</Text>
                </>
              )}
              {classOver && (
                <>
                  <View style={s.summaryDot} />
                  <Text style={[s.attSummaryText, { color: "#999", fontSize: 12 }]}>수업 완료</Text>
                </>
              )}
            </>
          )}
        </View>

        <FlatList
          data={sortedStudents}
          keyExtractor={i => i.id}
          contentContainerStyle={[s.studentList, { paddingBottom: insets.bottom + 20 }]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={s.emptyBox}>
              <Feather name="users" size={32} color={C.textMuted} />
              <Text style={s.emptyText}>이 반에 배정된 학생이 없습니다</Text>
            </View>
          }
          renderItem={({ item }) => {
            const cur = attState[item.id];
            const isAbsent  = cur === "absent";
            const isPresent = cur === "present";
            const isSaving  = savingId === item.id;

            return (
              <View style={[s.attRow, { backgroundColor: C.card, opacity: isSaving ? 0.6 : 1 }]}>
                {/* 결석 빨간 점 / 출석 여백 */}
                <View style={s.dotArea}>
                  {isAbsent && <View style={s.absentDot} />}
                </View>

                {/* 이름 + 주횟수 */}
                <Pressable
                  style={{ flex: 1 }}
                  onPress={() => router.push({ pathname: "/(teacher)/student-detail", params: { id: item.id } } as any)}
                >
                  <Text style={[
                    s.attName,
                    classOver && s.strikethrough,
                    isAbsent && { color: "#D96C6C" },
                  ]}>
                    {item.name}
                  </Text>
                  {item.weekly_count ? (
                    <Text style={[s.attSub, isAbsent && { color: "#D96C6C" }]}>
                      주 {item.weekly_count}회
                    </Text>
                  ) : null}
                </Pressable>

                {/* 출결 버튼 */}
                <View style={s.attBtns}>
                  {isSaving ? (
                    <ActivityIndicator size="small" color={themeColor} style={{ marginRight: 8 }} />
                  ) : (
                    <>
                      <Pressable
                        style={[s.attBtn, isPresent && { backgroundColor: "#1F8F86", borderColor: "#1F8F86" }]}
                        onPress={() => saveOne(item.id, "present")}
                      >
                        <Text style={[s.attBtnText, isPresent && { color: "#fff" }]}>출석</Text>
                      </Pressable>
                      <Pressable
                        style={[s.attBtn, isAbsent && { backgroundColor: "#D96C6C", borderColor: "#D96C6C" }]}
                        onPress={() => saveOne(item.id, "absent")}
                      >
                        <Text style={[s.attBtnText, isAbsent && { color: "#fff" }]}>결석</Text>
                      </Pressable>
                      <Pressable
                        style={[s.attBtn, s.moveBtn, !isAbsent && { opacity: 0.3 }]}
                        onPress={() => handleMove(item)}
                        disabled={!isAbsent}
                      >
                        <Feather name="repeat" size={13} color={isAbsent ? themeColor : C.textMuted} />
                        <Text style={[s.attBtnText, isAbsent && { color: themeColor }]}>반이동</Text>
                      </Pressable>
                    </>
                  )}
                </View>

                {/* 상세 화살표 */}
                <Pressable
                  style={s.arrowBtn}
                  onPress={() => router.push({ pathname: "/(teacher)/student-detail", params: { id: item.id } } as any)}
                >
                  <Feather name="chevron-right" size={18} color={C.textMuted} />
                </Pressable>
              </View>
            );
          }}
        />

        {/* 보강 지정/소멸 모달은 아래 공통 영역에서 렌더링 */}
        {renderAssignModal()}
        {renderExtinguishModal()}
      </SafeAreaView>
    );
  }

  /* ════════════════════ 메인 뷰 ════════════════════ */
  function renderAssignModal() {
    return (
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
                      <View style={[s.slotBadge, { backgroundColor: ec.available_slots > 0 ? "#DDF2EF" : "#F9DEDA" }]}>
                        <Text style={[s.slotText, { color: ec.available_slots > 0 ? "#1F8F86" : "#D96C6C" }]}>
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
    );
  }

  function renderExtinguishModal() {
    return (
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
                style={[s.reasonRow, extReason === r && { backgroundColor: "#FFF1BF" }]}
                onPress={() => setExtReason(r)}
              >
                <View style={[s.radioCircle, extReason === r && { borderColor: "#E4A93A", backgroundColor: "#E4A93A" }]} />
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
              style={[s.confirmBtn, { backgroundColor: "#D96C6C", opacity: extLoading ? 0.7 : 1, marginTop: 16 }]}
              onPress={confirmExtinguish}
              disabled={extLoading}
            >
              {extLoading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={s.confirmBtnText}>소멸 처리</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="출결 관리" homePath="/(teacher)/today-schedule" />

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
                  <Feather name="check-circle" size={40} color="#DDF2EF" />
                  <Text style={[s.emptyText, { marginTop: 8 }]}>보강 대기 중인 학생이 없습니다</Text>
                </View>
              }
              renderItem={({ item: mk }) => {
                const diff = daysDiff(mk.absence_date);
                const isOld = diff >= 14;
                return (
                  <View style={[s.mkCard, { backgroundColor: C.card }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.mkName, { color: isOld ? "#D96C6C" : C.text }]}>
                        {mk.student_name}
                        {isOld && <Text style={{ fontSize: 11, color: "#D96C6C" }}>  ({diff}일 경과)</Text>}
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
                        style={[s.mkActionBtn, { backgroundColor: "#F6F3F1" }]}
                        onPress={() => openExtinguish(mk)}
                      >
                        <Text style={[s.mkActionBtnText, { color: "#6F6B68" }]}>소멸</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              }}
            />
          )}
        </>
      )}

      {renderAssignModal()}
      {renderExtinguishModal()}
    </SafeAreaView>
  );
}

/* ══════════════════════════════════════════════════════
   스타일
══════════════════════════════════════════════════════ */
const s = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: C.background },
  subTabBar:      { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.border },
  subTabBtn:      { flex: 1, alignItems: "center", paddingVertical: 12 },
  subTabLabel:    { fontSize: 14, fontFamily: "Inter_500Medium" },
  titleRow:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10 },
  title:          { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text },
  dateBadge:      { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textMuted, backgroundColor: C.card, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },

  // 출결 요약
  attSummary:     { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginVertical: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  attSummaryText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  attSummaryPresent: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#1F8F86" },
  attSummaryAbsent:  { fontSize: 13, fontFamily: "Inter_500Medium", color: "#D96C6C" },
  summaryDot:     { width: 3, height: 3, borderRadius: 2, backgroundColor: C.border },

  // 학생 리스트
  studentList:    { paddingHorizontal: 12, gap: 8, paddingTop: 4 },
  attRow:         { flexDirection: "row", alignItems: "center", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 10, gap: 6 },

  // 빨간 점
  dotArea:        { width: 16, alignItems: "center" },
  absentDot:      { width: 8, height: 8, borderRadius: 4, backgroundColor: "#D96C6C" },

  // 이름
  attName:        { fontSize: 15, fontFamily: "Inter_600SemiBold", color: C.text },
  attSub:         { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted, marginTop: 1 },
  strikethrough:  { textDecorationLine: "line-through", color: C.textSecondary },

  // 버튼
  attBtns:        { flexDirection: "row", gap: 5 },
  attBtn:         { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, alignItems: "center", minWidth: 44 },
  moveBtn:        { flexDirection: "row", alignItems: "center", gap: 3, minWidth: 60 },
  attBtnText:     { fontSize: 12, fontFamily: "Inter_500Medium", color: C.text },
  arrowBtn:       { paddingLeft: 4 },

  // 빈 상태
  emptyBox:       { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyText:      { fontSize: 14, fontFamily: "Inter_400Regular", color: C.textMuted, textAlign: "center" },

  // 보강 카드
  mkCard:         { flexDirection: "row", alignItems: "center", borderRadius: 12, padding: 14, gap: 12 },
  mkName:         { fontSize: 15, fontFamily: "Inter_600SemiBold", color: C.text },
  mkSub:          { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted, marginTop: 2 },
  mkActionBtn:    { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, alignItems: "center", minWidth: 64 },
  mkActionBtnText:{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },

  // 모달
  modalOverlay:   { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  modalBox:       { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "85%" },
  modalHeader:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  modalTitle:     { fontSize: 18, fontFamily: "Inter_700Bold", color: C.text },
  modalSub:       { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textMuted },
  sectionLabel:   { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textSecondary, marginBottom: 6 },
  eligRow:        { flexDirection: "row", alignItems: "center", borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 12, marginBottom: 8 },
  eligName:       { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  eligSub:        { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted, marginTop: 2 },
  sameTeacherBadge: { backgroundColor: "#DDF2EF", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  sameTeacherText:  { fontSize: 11, fontFamily: "Inter_500Medium", color: "#1F8F86" },
  slotBadge:      { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, minWidth: 44, alignItems: "center" },
  slotText:       { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  confirmBtn:     { paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  confirmBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  errText:        { color: "#D96C6C", fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 6 },
  warnBox:        { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#FFFBEB", borderRadius: 8, padding: 10 },
  warnText:       { fontSize: 13, fontFamily: "Inter_400Regular", color: "#92400E", flex: 1 },
  reasonRow:      { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 10, marginBottom: 6 },
  radioCircle:    { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: C.border },
  reasonText:     { fontSize: 14, fontFamily: "Inter_500Medium" },
  customInput:    { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 4 },
});
