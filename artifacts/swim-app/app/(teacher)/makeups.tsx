/**
 * (teacher)/makeups.tsx — 결석자 리스트 / 배정된 보강 / 보강 현황
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Modal, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import Colors from "@/constants/colors";
import { apiRequest, clearApiCache, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { ConfirmModal } from "@/components/common/ConfirmModal";

const C = Colors.light;

/** eligible-occurrences API 응답 단일 회차 */
interface MakeupOccurrence {
  class_group_id: string;
  class_name: string;
  occurrence_date: string;   // YYYY-MM-DD (서버 계약 필드명 고정)
  schedule_time: string;
  teacher_id?: string | null;
  teacher_name?: string | null;
  is_mine: boolean;
  available_slots: number;
  is_full: boolean;
  is_past: boolean;
  is_today: boolean;
  is_future: boolean;
}

interface MakeupSession {
  id: string;
  student_id: string;
  student_name: string | null;
  original_class_group_id: string | null;
  original_class_group_name: string | null;
  original_teacher_id: string | null;
  original_teacher_name: string | null;
  absence_date: string | null;
  status: string;
  expire_at: string | null;
  /** 서버가 계산한 기간 초과 여부 (status=expired 또는 expire_at < KST now) */
  is_expired?: boolean;
  assigned_class_group_name: string | null;
  note: string | null;
  handed_to_teacher_id: string | null;
  handed_to_teacher_name: string | null;
}
interface MakeupRequest {
  id: string;
  student_name: string;
  class_name: string;
  original_date: string;
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "completed";
  requested_at: string;
  makeup_date: string | null;
  makeup_class_name: string | null;
}
interface Teacher {
  id: string;
  name: string;
  email: string;
}
type TabKey = "waiting" | "assigned" | "history";
type HandoverStep = "menu" | "teacher_select" | "done";
const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  pending:   { bg: "#FFF1BF", text: "#D97706" },
  approved:  { bg: "#E6FFFA", text: "#2EC4B6" },
  rejected:  { bg: "#F9DEDA", text: "#D96C6C" },
  completed: { bg: "#EEDDF5", text: "#7C3AED" },
};
const STATUS_LABEL: Record<string, string> = {
  pending: "대기", approved: "승인", rejected: "거절", completed: "완료",
};
function fmtDate(dateStr: string | null) {
  if (!dateStr) return "-";
  const d = new Date(dateStr + "T00:00:00");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getMonth() + 1}/${d.getDate()} (${days[d.getDay()]})`;
}
function fmtMonthLabel(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
}
function formatExpireAt(expire_at: string | null) {
  if (!expire_at) return null;
  const d = new Date(expire_at);
  const diffDays = Math.ceil((d.getTime() - Date.now()) / 86400000);
  const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const col = diffDays <= 7 ? "#D96C6C" : diffDays <= 14 ? "#D97706" : "#64748B";
  const label = diffDays < 0 ? `만료됨(${ds})` : diffDays <= 14 ? `만료 D-${diffDays}(${ds})` : `만료일: ${ds}`;
  return { text: label, color: col };
}
function getNextDates(scheduleDays: string): { date: string; label: string }[] {
  const dayMap: Record<string, number> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
  const labels = ["일", "월", "화", "수", "목", "금", "토"];
  const parts = scheduleDays.includes(",") ? scheduleDays.split(",") : scheduleDays.split("");
  const targetDays = parts.map(p => dayMap[p.trim()]).filter(d => d !== undefined) as number[];
  if (targetDays.length === 0) return [];
  const results: { date: string; label: string }[] = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let i = 1; i <= 28; i++) {
    const d = new Date(today); d.setDate(d.getDate() + i);
    if (targetDays.includes(d.getDay())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      results.push({ date: `${yyyy}-${mm}-${dd}`, label: `${d.getMonth()+1}/${d.getDate()} (${labels[d.getDay()]})` });
    }
  }
  return results;
}
export default function MakeupsScreen() {
  const { token, adminUser } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<TabKey>("waiting");
  const [waitingList,    setWaitingList]    = useState<MakeupSession[]>([]);
  const [waitingLoading, setWaitingLoading] = useState(true);
  const [waitingRefresh, setWaitingRefresh] = useState(false);
  const [assignTarget,    setAssignTarget]    = useState<MakeupSession | null>(null);
  const [eligibleClasses, setEligibleClasses] = useState<any[]>([]);
  const [classLoading,    setClassLoading]    = useState(false);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [selectedDate,    setSelectedDate]    = useState<string | null>(null);
  const [assigning,       setAssigning]       = useState(false);
  const [handoverTarget,  setHandoverTarget]  = useState<MakeupSession | null>(null);
  const [handoverStep,    setHandoverStep]    = useState<HandoverStep>("menu");
  const [teachers,        setTeachers]        = useState<Teacher[]>([]);
  const [teachersLoading, setTeachersLoading] = useState(false);
  const [selectedTeacher, setSelectedTeacher] = useState<Teacher | null>(null);
  const [handoverSubmitting, setHandoverSubmitting] = useState(false);
  const [handoverDoneMsg,    setHandoverDoneMsg]    = useState("");
  const [selfExtTarget,    setSelfExtTarget]    = useState<MakeupSession | null>(null);
  const [selfExtSubmitting,setSelfExtSubmitting]= useState(false);
  const [assignedList,    setAssignedList]    = useState<MakeupSession[]>([]);
  const [assignedLoading, setAssignedLoading] = useState(false);
  const [completeTarget,  setCompleteTarget]  = useState<any | null>(null);
  const [revertingId,     setRevertingId]     = useState<string | null>(null);
  const [historyList,    setHistoryList]    = useState<MakeupRequest[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [directCompleteTarget, setDirectCompleteTarget] = useState<MakeupSession | null>(null);
  const [directCompleting,     setDirectCompleting]     = useState(false);
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);
  // eligible-occurrences 기반 날짜 선택
  const [occurrences,    setOccurrences]    = useState<MakeupOccurrence[]>([]);
  const [occLoading,     setOccLoading]     = useState(false);
  const [occError,       setOccError]       = useState(false);
  const [selectedOccurrence, setSelectedOccurrence] = useState<MakeupOccurrence | null>(null);
  // sequence ID — 늦게 도착한 이전 반 응답이 현재 반을 덮어쓰지 않도록
  const occSeqRef = useRef(0);
  const loadWaiting = useCallback(async () => {
    try {
      const res = await apiRequest(token, `/teacher/makeups?status=waiting`);
      if (res.ok) setWaitingList(await res.json());
    } catch (e) { console.error(e); }
    finally { setWaitingLoading(false); setWaitingRefresh(false); }
  }, [token]);
  const loadAssigned = useCallback(async () => {
    setAssignedLoading(true);
    try {
      const res = await apiRequest(token, "/teacher/makeups/assigned");
      if (res.ok) setAssignedList(await res.json());
    } catch (e) { console.error(e); }
    finally { setAssignedLoading(false); }
  }, [token]);
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await apiRequest(token, "/teacher/makeup-requests");
      if (res.ok) setHistoryList(await res.json());
    } catch (e) { console.error(e); }
    finally { setHistoryLoading(false); }
  }, [token]);
  async function handleRevert(mk: MakeupSession) {
    Alert.alert(
      "배정 취소",
      `${mk.student_name}의 보강 배정을 취소하고 보강 대기로 되돌리시겠습니까?\n\n결석 기록과 보강 권리는 유지됩니다.`,
      [
        { text: "닫기", style: "cancel" },
        {
          text: "배정 취소",
          style: "destructive",
          onPress: async () => {
            setRevertingId(mk.id);
            try {
              const res = await apiRequest(token, `/teacher/makeups/${mk.id}/revert`, { method: "PATCH" });
              const contentType = res.headers?.get?.("content-type") ?? "";
              const isJson = contentType.includes("application/json");
              const resBody = isJson ? await res.json().catch(() => ({})) : {};
              console.log(`[revert] id=${mk.id} http=${res.status} isJson=${isJson}`, JSON.stringify(resBody));
              if (res.ok && isJson && resBody?.success === true) {
                clearApiCache();
                setAssignedList(prev => prev.filter(m => m.id !== mk.id));
                setTimeout(() => loadAssigned(), 300);
              } else if (!res.ok && isJson) {
                Alert.alert("오류", resBody?.error || "배정 취소에 실패했습니다.");
              } else {
                Alert.alert("오류", "서버 응답이 올바르지 않습니다. 잠시 후 다시 시도해주세요.");
              }
            } catch {
              Alert.alert("오류", "네트워크 오류가 발생했습니다.");
            } finally {
              setRevertingId(null);
            }
          },
        },
      ]
    );
  }
  useEffect(() => { loadWaiting(); }, [loadWaiting]);
  useEffect(() => { if (tab === "assigned") loadAssigned(); }, [tab, loadAssigned]);
  useEffect(() => { if (tab === "history") loadHistory(); }, [tab, loadHistory]);
  useFocusEffect(useCallback(() => {
    loadWaiting();
    if (tab === "assigned") loadAssigned();
  }, [loadWaiting, loadAssigned, tab]));
  /** occurrence 관련 공유 상태 초기화 헬퍼
   *  occSeqRef를 올려 진행 중인 모든 eligible-occurrences 요청을 무효화한다. */
  const resetOccState = () => {
    occSeqRef.current += 1;       // in-flight 요청 무효화
    setSelectedClassId(null);
    setSelectedDate(null);
    setSelectedOccurrence(null);
    setOccurrences([]);
    setOccLoading(false);
    setOccError(false);
  };

  const openAssignModal = async (mk: MakeupSession) => {
    setAssignTarget(mk);
    resetOccState();
    setClassLoading(true);
    try {
      const r = await apiRequest(token, `/teacher/makeups/eligible-classes?all=true`);
      if (r.ok) setEligibleClasses(await r.json());
    } catch {}
    setClassLoading(false);
  };

  /** 지난 보강 직접 완료 모달 열기 */
  const openDirectCompleteModal = async (mk: MakeupSession) => {
    setDirectCompleteTarget(mk);
    resetOccState();
    setClassLoading(true);
    try {
      const r = await apiRequest(token, `/teacher/makeups/eligible-classes?all=true`);
      if (r.ok) setEligibleClasses(await r.json());
    } catch {}
    setClassLoading(false);
  };

  /** 지난 보강 직접 완료 모달 닫기 */
  const closeDirectCompleteModal = () => {
    setDirectCompleteTarget(null);
    resetOccState();
  };
  const selectClass = async (classId: string) => {
    // 배정 모달(assignTarget) 또는 직접 완료 모달(directCompleteTarget) 어느 쪽이든 처리
    const activeTarget = assignTarget ?? directCompleteTarget;
    if (!activeTarget) return;
    occSeqRef.current += 1;
    const mySeq = occSeqRef.current;
    setSelectedClassId(classId);
    setSelectedDate(null);
    setSelectedOccurrence(null);
    setOccurrences([]);
    setOccError(false);
    setOccLoading(true);
    try {
      const r = await apiRequest(token, `/teacher/makeups/${activeTarget.id}/eligible-occurrences?class_group_id=${classId}`);
      if (occSeqRef.current !== mySeq) return; // 늦게 도착한 이전 반 응답 무시
      if (r.ok) {
        const data = await r.json();
        setOccurrences((data.occurrences || []) as MakeupOccurrence[]);
      } else {
        setOccError(true);
      }
    } catch {
      if (occSeqRef.current === mySeq) setOccError(true);
    } finally {
      if (occSeqRef.current === mySeq) setOccLoading(false);
    }
  };
  const doAssign = async (allowExpired = false) => {
    if (!assignTarget || !selectedClassId || !selectedOccurrence) return;
    // 기간 지난 보강: 최초 시도 시 확인 Alert
    if (assignTarget.is_expired && !allowExpired) {
      Alert.alert(
        "기간 지난 보강",
        "보강 가능 기간이 지난 항목입니다.\n그래도 처리하시겠습니까?",
        [
          { text: "취소", style: "cancel" },
          { text: "처리하기", onPress: () => doAssign(true) },
        ]
      );
      return;
    }
    // occurrence_date를 신뢰 (selectedDate는 동기화 보조값)
    const occDate = selectedOccurrence.occurrence_date;
    setAssigning(true);
    try {
      // 서버 응답 occ 기준 class_group_id 사용 (selectedClassId는 화면 표시용)
      const occClassId = selectedOccurrence.class_group_id;
      if (selectedOccurrence.is_future) {
        const r = await apiRequest(token, `/teacher/makeups/${assignTarget.id}/assign`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ class_group_id: occClassId, assigned_date: occDate, allow_expired: allowExpired }),
        });
        const ct = r.headers?.get?.("content-type") ?? "";
        const isJson = ct.includes("application/json");
        const body = isJson ? await r.json().catch(() => ({})) : {};
        if (r.ok && isJson) {
          resetOccState(); setAssignTarget(null);
          loadWaiting(); loadAssigned(); setTab("assigned");
          setConfirmMsg(`보강이 ${occDate}에 배정되었습니다.`);
        } else if (r.status === 409) {
          setConfirmMsg(body?.message || "이미 처리된 보강입니다.");
        } else {
          setConfirmMsg(body?.message || body?.error || "배정에 실패했습니다.");
        }
      } else {
        // 당일 또는 과거 — complete-direct
        const r = await apiRequest(token, `/teacher/makeups/${assignTarget.id}/complete-direct`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: occDate, class_group_id: occClassId, allow_expired: allowExpired }),
        });
        const ct = r.headers?.get?.("content-type") ?? "";
        const isJson = ct.includes("application/json");
        const body = isJson ? await r.json().catch(() => ({})) : {};
        if (r.ok) {
          resetOccState(); setAssignTarget(null);
          loadWaiting(); loadAssigned();
          setConfirmMsg(`${occDate} 보강 완료 처리되었습니다.`);
        } else {
          setConfirmMsg(body?.message || body?.error || "처리에 실패했습니다.");
        }
      }
    } catch { setConfirmMsg("네트워크 오류가 발생했습니다."); }
    setAssigning(false);
  };
  const openHandoverDirect = async (mk: MakeupSession) => {
    setHandoverTarget(mk);
    setHandoverStep("teacher_select");
    setSelectedTeacher(null);
    setHandoverDoneMsg("");
    setTeachersLoading(true);
    try {
      const r = await apiRequest(token, "/admin/pool-teachers");
      if (r.ok) setTeachers(await r.json());
    } catch { setConfirmMsg("선생님 목록을 불러오지 못했습니다."); }
    setTeachersLoading(false);
  };
  const doHandover = async () => {
    if (!handoverTarget || !selectedTeacher) return;
    const removedId = handoverTarget.id;
    setWaitingList(prev => prev.filter(m => m.id !== removedId));
    setHandoverStep("done");
    setHandoverDoneMsg(`${selectedTeacher.name} 선생님에게 인계되었습니다.\n${selectedTeacher.name} 선생님 보강 대기 목록에 추가됩니다.`);
    setHandoverSubmitting(true);
    try {
      const r = await apiRequest(token, `/teacher/makeups/${removedId}/handover`, {
        method: "POST",
        body: JSON.stringify({ receiver_teacher_id: selectedTeacher.id }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setHandoverStep("teacher_select");
        setWaitingList(prev => {
          if (prev.some(m => m.id === removedId)) return prev;
          return [{ ...handoverTarget, handed_to_teacher_id: null, handed_to_teacher_name: null }, ...prev];
        });
        setConfirmMsg(d.error || "처리에 실패했습니다.");
      }
    } catch {
      setHandoverStep("teacher_select");
      setWaitingList(prev => {
        if (prev.some(m => m.id === removedId)) return prev;
        return [{ ...handoverTarget, handed_to_teacher_id: null, handed_to_teacher_name: null }, ...prev];
      });
      setConfirmMsg("네트워크 오류가 발생했습니다.");
    }
    setHandoverSubmitting(false);
  };
  const doSelfExtinguish = async () => {
    if (!selfExtTarget) return;
    setSelfExtSubmitting(true);
    try {
      const r = await apiRequest(token, `/admin/makeups/${selfExtTarget.id}/self-extinguish`, {
        method: "PATCH",
      });
      if (r.ok) {
        setWaitingList(prev => prev.filter(m => m.id !== selfExtTarget.id));
        setSelfExtTarget(null);
        setHandoverTarget(null);
        setConfirmMsg("보강이 소멸 처리되었습니다.\n내 정산에 기타 1시수가 반영됩니다.");
      } else {
        setSelfExtTarget(null);
      }
    } catch { setSelfExtTarget(null); }
    setSelfExtSubmitting(false);
  };
  const closeHandover = () => {
    setHandoverTarget(null);
    setHandoverStep("menu");
  };
  /** 지난 보강 직접 완료 실행 (occ = 서버 응답 회차 기준) */
  async function doDirectComplete(occ: MakeupOccurrence, allowExpired = false) {
    if (!directCompleteTarget) return;
    // 기간 지난 보강: 최초 시도 시 확인 Alert
    if (directCompleteTarget.is_expired && !allowExpired) {
      Alert.alert(
        "기간 지난 보강",
        "보강 가능 기간이 지난 항목입니다.\n그래도 완료 처리하시겠습니까?",
        [
          { text: "취소", style: "cancel" },
          { text: "처리하기", onPress: () => doDirectComplete(occ, true) },
        ]
      );
      return;
    }
    const snapshot = { ...directCompleteTarget }; // 모달 닫기 전 캡처
    const targetId = snapshot.id;
    // 모달 즉시 닫고 목록에서 낙관적 제거
    closeDirectCompleteModal();
    setWaitingList(prev => prev.filter(m => m.id !== targetId));
    setDirectCompleting(true);
    try {
      const r = await apiRequest(token, `/teacher/makeups/${targetId}/complete-direct`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: occ.occurrence_date, class_group_id: occ.class_group_id, allow_expired: allowExpired }),
      });
      const ct = r.headers?.get?.("content-type") ?? "";
      const isJson = ct.includes("application/json");
      const body = isJson ? await r.json().catch(() => ({})) : {};
      if (r.ok) {
        setConfirmMsg(`${occ.occurrence_date} 보강 완료 처리되었습니다.`);
      } else {
        setConfirmMsg(body?.message || body?.error || "처리에 실패했습니다.");
        // 실패 시 목록 복원
        setWaitingList(prev => {
          if (prev.some(m => m.id === targetId)) return prev;
          return [{ ...snapshot }, ...prev];
        });
      }
      loadWaiting();
    } catch { setConfirmMsg("네트워크 오류가 발생했습니다."); }
    setDirectCompleting(false);
  }
  async function handleTeacherComplete(id: string) {
    try {
      const res = await apiRequest(token, `/teacher/makeups/${id}/complete`, { method: "PATCH" });
      const contentType = res.headers?.get?.("content-type") ?? "";
      const isJson = contentType.includes("application/json");
      const resBody = isJson ? await res.json().catch(() => ({})) : {};
      console.log(`[complete] id=${id} http=${res.status} isJson=${isJson}`, JSON.stringify(resBody));
      if (res.ok && isJson) {
        setAssignedList(prev => prev.filter(m => m.id !== id));
      } else if (!res.ok && isJson) {
        setConfirmMsg(resBody.error || "처리에 실패했습니다.");
      } else if (!res.ok) {
        setConfirmMsg("처리에 실패했습니다.");
      }
    } catch {}
    setCompleteTarget(null);
  }
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prevMonth = (() => {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();
  const pendingHistory = historyList.filter(r => r.status !== "pending");
  const thisMonthHist  = pendingHistory.filter(r => r.original_date.startsWith(thisMonth));
  const prevMonthHist  = pendingHistory.filter(r => r.original_date.startsWith(prevMonth));
  const olderHist      = pendingHistory.filter(r =>
    !r.original_date.startsWith(thisMonth) && !r.original_date.startsWith(prevMonth)
  );
  function renderHistoryCard(item: MakeupRequest) {
    const sc = STATUS_COLOR[item.status] ?? STATUS_COLOR.pending;
    return (
      <View key={item.id} style={[s.card, { backgroundColor: C.card }]}>
        <View style={s.cardTop}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.studentName}>{item.student_name}</Text>
            <Text style={s.className}>{item.class_name}</Text>
          </View>
          <View style={[s.statusBadge, { backgroundColor: sc.bg }]}>
            <Text style={[s.statusTxt, { color: sc.text }]}>{STATUS_LABEL[item.status]}</Text>
          </View>
        </View>
        <View style={s.infoRow}>
          <LucideIcon name="calendar" size={13} color={C.textSecondary} />
          <Text style={s.infoTxt}>결석일: {fmtDate(item.original_date)}</Text>
        </View>
        {item.makeup_date ? (
          <View style={s.infoRow}>
            <LucideIcon name="check-circle" size={13} color="#2EC4B6" />
            <Text style={[s.infoTxt, { color: "#2EC4B6" }]}>
              보강일: {fmtDate(item.makeup_date)}{item.makeup_class_name ? ` · ${item.makeup_class_name}` : ""}
            </Text>
          </View>
        ) : null}
      </View>
    );
  }
  function renderHistoryGroup(label: string, items: MakeupRequest[]) {
    if (items.length === 0) return null;
    return (
      <View key={label}>
        <Text style={s.groupLabel}>{label}</Text>
        {items.map(renderHistoryCard)}
      </View>
    );
  }
  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="보강 대기" homePath="/(teacher)/today-schedule" />
      {/* 탭 */}
      <View style={{ flexDirection: "row", paddingHorizontal: 10, paddingVertical: 10, gap: 6, backgroundColor: C.background, borderBottomWidth: 1, borderBottomColor: C.border }}>
        <Pressable
          style={[s.tabBtn, { flex: 1, justifyContent: "center" }, tab === "waiting" && { backgroundColor: themeColor, borderColor: themeColor }]}
          onPress={() => setTab("waiting")}
        >
          {waitingList.length > 0 && tab !== "waiting" && (
            <View style={s.tabBadge}><Text style={s.tabBadgeTxt}>{waitingList.length}</Text></View>
          )}
          <Text style={[s.tabTxt, tab === "waiting" && { color: "#fff" }]}>보강 대기</Text>
        </Pressable>
        <Pressable
          style={[s.tabBtn, { flex: 1, justifyContent: "center" }, tab === "assigned" && { backgroundColor: "#7C3AED", borderColor: "#7C3AED" }]}
          onPress={() => setTab("assigned")}
        >
          {assignedList.length > 0 && tab !== "assigned" && (
            <View style={s.tabBadge}><Text style={s.tabBadgeTxt}>{assignedList.length}</Text></View>
          )}
          <Text style={[s.tabTxt, tab === "assigned" && { color: "#fff" }]}>배정된 보강</Text>
        </Pressable>
        <Pressable
          style={[s.tabBtn, { flex: 1, justifyContent: "center" }, tab === "history" && { backgroundColor: themeColor, borderColor: themeColor }]}
          onPress={() => setTab("history")}
        >
          <Text style={[s.tabTxt, tab === "history" && { color: "#fff" }]}>보강 현황</Text>
        </Pressable>
      </View>
      {/* ── 탭 1: 결석자 리스트 ─────────────────────────────────────────── */}
      {tab === "waiting" && (
        waitingLoading ? (
          <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 60 }]}
            refreshControl={
              <RefreshControl
                refreshing={waitingRefresh}
                onRefresh={() => { setWaitingRefresh(true); loadWaiting(); }}
                tintColor={themeColor}
              />
            }
          >
            {waitingList.length === 0 ? (
              <View style={s.empty}>
                <LucideIcon name="check-circle" size={36} color={C.textMuted} />
                <Text style={s.emptyTxt}>처리할 결석자가 없습니다</Text>
              </View>
            ) : [...waitingList]
                .sort((a, b) => {
                  // 기간 지난 보강을 뒤로 정렬
                  if (!!a.is_expired !== !!b.is_expired) return a.is_expired ? 1 : -1;
                  return 0;
                })
                .map(mk => {
              const expireInfo = formatExpireAt(mk.expire_at);
              return (
                <View
                  key={mk.id}
                  style={[
                    s.card,
                    { backgroundColor: C.card },
                    mk.is_expired && { borderLeftWidth: 3, borderLeftColor: "#94A3B8" },
                  ]}
                >
                  <View style={s.cardTop}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={s.studentName}>{mk.student_name || "-"}</Text>
                      <Text style={s.className}>{mk.original_class_group_name || "미배정"}</Text>
                      {mk.handed_to_teacher_id === adminUser?.id && mk.original_teacher_name && (
                        <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: "#4F46E5" }}>
                          인계 from {mk.original_teacher_name}
                        </Text>
                      )}
                    </View>
                    {mk.is_expired ? (
                      <View style={[s.statusBadge, { backgroundColor: "#F1F5F9" }]}>
                        <Text style={[s.statusTxt, { color: "#64748B" }]}>기간 지난 보강</Text>
                      </View>
                    ) : mk.handed_to_teacher_id === adminUser?.id ? (
                      <View style={[s.statusBadge, { backgroundColor: "#EEF2FF" }]}>
                        <Text style={[s.statusTxt, { color: "#4F46E5" }]}>이관받음</Text>
                      </View>
                    ) : (
                      <View style={[s.statusBadge, { backgroundColor: "#FFF1BF" }]}>
                        <Text style={[s.statusTxt, { color: "#D97706" }]}>대기</Text>
                      </View>
                    )}
                  </View>
                  <View style={s.infoRow}>
                    <LucideIcon name="calendar" size={13} color={C.textSecondary} />
                    <Text style={s.infoTxt}>결석일: {fmtDate(mk.absence_date)}</Text>
                  </View>
                  {expireInfo && (
                    <View style={s.infoRow}>
                      <LucideIcon name="clock" size={13} color={expireInfo.color} />
                      <Text style={[s.infoTxt, { color: expireInfo.color, fontFamily: "Pretendard-Regular" }]}>{expireInfo.text}</Text>
                    </View>
                  )}
                  {mk.assigned_class_group_name && (
                    <View style={s.infoRow}>
                      <LucideIcon name="check-circle" size={13} color="#2EC4B6" />
                      <Text style={[s.infoTxt, { color: "#2EC4B6" }]}>배정반: {mk.assigned_class_group_name}</Text>
                    </View>
                  )}
                  <View style={s.btnRow}>
                    <Pressable
                      style={[s.actionBtn, { backgroundColor: C.button }]}
                      onPress={() => openAssignModal(mk)}
                    >
                      <LucideIcon name="calendar" size={14} color="#fff" />
                      <Text style={[s.actionTxt, { color: "#fff" }]}>보강반 배정</Text>
                    </Pressable>
                    <Pressable
                      style={[s.actionBtn, { backgroundColor: "#EEF2FF", flex: undefined, paddingHorizontal: 12 }]}
                      onPress={() => openHandoverDirect(mk)}
                    >
                      <LucideIcon name="user-plus" size={14} color="#4F46E5" />
                      <Text style={[s.actionTxt, { color: "#4F46E5" }]}>인계</Text>
                    </Pressable>
                    <Pressable
                      style={[s.actionBtn, { backgroundColor: "#FEF2F2", flex: undefined, paddingHorizontal: 12 }]}
                      onPress={() => setSelfExtTarget(mk)}
                    >
                      <LucideIcon name="x-circle" size={14} color="#DC2626" />
                      <Text style={[s.actionTxt, { color: "#DC2626" }]}>소멸</Text>
                    </Pressable>
                  </View>
                  <Pressable
                    style={[s.actionBtn, { backgroundColor: "#ECFDF5", marginTop: 2 }]}
                    onPress={() => openDirectCompleteModal(mk)}
                  >
                    <LucideIcon name="check-circle" size={14} color="#059669" />
                    <Text style={[s.actionTxt, { color: "#059669" }]}>지난 보강 직접 완료</Text>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
        )
      )}
      {/* ── 탭 2: 배정된 보강 ──────────────────────────────────────────────── */}
      {tab === "assigned" && (
        assignedLoading ? (
          <ActivityIndicator color="#7C3AED" style={{ marginTop: 80 }} />
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 60 }]}
            refreshControl={<RefreshControl refreshing={assignedLoading} onRefresh={loadAssigned} tintColor="#7C3AED" />}
          >
            {assignedList.length === 0 ? (
              <View style={s.empty}>
                <LucideIcon name="user-check" size={36} color={C.textMuted} />
                <Text style={s.emptyTxt}>배정된 대리 보강이 없습니다</Text>
              </View>
            ) : (
              <>
                {assignedList.map(mk => {
                  const expireInfo = formatExpireAt(mk.expire_at);
                  return (
                    <View key={mk.id} style={[s.card, { backgroundColor: C.card, borderLeftWidth: 3, borderLeftColor: "#7C3AED" }]}>
                      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                        <View style={{ flex: 1, gap: 3 }}>
                          <Text style={[s.studentName, { color: "#7C3AED" }]}>{mk.student_name}</Text>
                          <View style={s.infoRow}>
                            <LucideIcon name="calendar" size={12} color={C.textSecondary} />
                            <Text style={s.infoTxt}>결석일: {mk.absence_date}</Text>
                          </View>
                          {mk.original_class_group_name && (
                            <View style={s.infoRow}>
                              <LucideIcon name="users" size={12} color={C.textSecondary} />
                              <Text style={s.infoTxt}>원반: {mk.original_class_group_name}  담당: {mk.original_teacher_name || "미배정"}</Text>
                            </View>
                          )}
                          {mk.assigned_class_group_name && (
                            <View style={s.infoRow}>
                              <LucideIcon name="check-circle" size={12} color="#2EC4B6" />
                              <Text style={[s.infoTxt, { color: "#2EC4B6" }]}>배정반: {mk.assigned_class_group_name}</Text>
                            </View>
                          )}
                          {expireInfo && (
                            <View style={s.infoRow}>
                              <LucideIcon name="clock" size={12} color={expireInfo.color} />
                              <Text style={[s.infoTxt, { color: expireInfo.color, fontFamily: "Pretendard-Regular" }]}>{expireInfo.text}</Text>
                            </View>
                          )}
                        </View>
                        <View style={{ backgroundColor: "#EEDDF5", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                          <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: "#7C3AED" }}>대리보강</Text>
                        </View>
                      </View>
                      <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                        <Pressable
                          style={[s.actionBtn, { backgroundColor: "#EEDDF5", flex: 1, paddingHorizontal: 12 }]}
                          onPress={() => setCompleteTarget(mk)}
                        >
                          <LucideIcon name="check-circle" size={15} color="#7C3AED" />
                          <Text style={[s.actionTxt, { color: "#7C3AED", fontFamily: "Pretendard-Regular" }]}>완료 확인</Text>
                        </Pressable>
                        <Pressable
                          style={[s.actionBtn, { backgroundColor: "#FFF8EE", borderWidth: 1.5, borderColor: "#D97706", flex: 1, paddingHorizontal: 12, opacity: revertingId === mk.id ? 0.5 : 1 }]}
                          onPress={() => handleRevert(mk)}
                          disabled={revertingId === mk.id}
                        >
                          {revertingId === mk.id
                            ? <ActivityIndicator size="small" color="#D97706" />
                            : <>
                                <LucideIcon name="rotate-ccw" size={14} color="#D97706" />
                                <Text style={[s.actionTxt, { color: "#D97706", fontFamily: "Pretendard-Regular" }]}>배정 취소</Text>
                              </>}
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </>
            )}
          </ScrollView>
        )
      )}
      {/* ── 탭 3: 보강 현황 ──────────────────────────────────────────────── */}
      {tab === "history" && (
        historyLoading ? (
          <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 60 }]}
            refreshControl={<RefreshControl refreshing={historyLoading} onRefresh={loadHistory} tintColor={themeColor} />}
          >
            {pendingHistory.length === 0 ? (
              <View style={s.empty}>
                <LucideIcon name="calendar" size={36} color={C.textMuted} />
                <Text style={s.emptyTxt}>보강 현황 내역이 없습니다</Text>
              </View>
            ) : (
              <>
                {renderHistoryGroup(`이번 달 (${fmtMonthLabel(thisMonth + "-01")})`, thisMonthHist)}
                {renderHistoryGroup(`전월 이월 (${fmtMonthLabel(prevMonth + "-01")})`, prevMonthHist)}
                {renderHistoryGroup("이전 내역", olderHist)}
              </>
            )}
          </ScrollView>
        )
      )}
      {/* ── 보강반 배정 모달 ──────────────────────────────────────────────── */}
      {assignTarget && (
        <Modal visible animationType="slide" transparent onRequestClose={() => { resetOccState(); setAssignTarget(null); }} statusBarTranslucent>
          <Pressable style={s.backdrop} onPress={() => { resetOccState(); setAssignTarget(null); }}>
            <Pressable style={s.sheet} onPress={() => {}}>
              <View style={s.sheetHandle} />
              <View style={s.sheetHeader}>
                <View style={{ flex: 1 }}>
                  {selectedClassId && !selectedDate ? (
                    <>
                      <Text style={s.sheetTitle}>보강 날짜 선택</Text>
                      <Text style={s.sheetSub}>
                        {eligibleClasses.find(c => c.id === selectedClassId)?.name} · 날짜를 선택하세요
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text style={s.sheetTitle}>보강반 배정</Text>
                      <Text style={s.sheetSub}>{assignTarget.student_name} · 결석일: {fmtDate(assignTarget.absence_date)}</Text>
                    </>
                  )}
                </View>
                {selectedClassId && !selectedDate ? (
                  <Pressable onPress={resetOccState} style={{ padding: 4 }}>
                    <LucideIcon name="arrow-left" size={20} color={C.textSecondary} />
                  </Pressable>
                ) : (
                  <Pressable onPress={() => { resetOccState(); setAssignTarget(null); }} style={{ padding: 4 }}>
                    <LucideIcon name="x" size={20} color={C.textSecondary} />
                  </Pressable>
                )}
              </View>
              {/* 단계 1: 반 선택 */}
              {!selectedClassId && (
                <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false}>
                  {classLoading ? (
                    <ActivityIndicator color={themeColor} style={{ marginVertical: 32 }} />
                  ) : eligibleClasses.length === 0 ? (
                    <View style={s.empty}>
                      <LucideIcon name="alert-circle" size={24} color={C.textMuted} />
                      <Text style={s.emptyTxt}>배정 가능한 반이 없습니다</Text>
                    </View>
                  ) : (() => {
                    const myClasses = eligibleClasses.filter((cg: any) => cg.is_mine);
                    const otherClasses = eligibleClasses.filter((cg: any) => !cg.is_mine);
                    const renderClassRow = (cg: any) => (
                      <Pressable
                        key={cg.id}
                        style={s.classRow}
                        onPress={() => selectClass(cg.id)}
                      >
                        <LucideIcon name="calendar" size={16} color={cg.is_mine ? themeColor : "#9CA3AF"} />
                        <View style={{ flex: 1 }}>
                          <Text style={[s.className, { fontSize: 14, color: C.text }]}>{cg.name}</Text>
                          <Text style={s.infoTxt}>{cg.schedule_days?.split(",").join("·")} · {cg.schedule_time}</Text>
                        </View>
                        <Text style={[s.infoTxt, { color: C.textMuted }]}>잔여 {cg.available_slots ?? "?"}석</Text>
                      </Pressable>
                    );
                    return (
                      <>
                        {myClasses.length > 0 && (
                          <>
                            <Text style={[s.groupLabel, { paddingHorizontal: 16, paddingTop: 12 }]}>내 반</Text>
                            {myClasses.map(renderClassRow)}
                          </>
                        )}
                        {otherClasses.length > 0 && (
                          <>
                            <Text style={[s.groupLabel, { paddingHorizontal: 16, paddingTop: 12, color: "#9CA3AF" }]}>
                              다른 선생님 반 (인계 처리)
                            </Text>
                            {otherClasses.map(renderClassRow)}
                          </>
                        )}
                      </>
                    );
                  })()}
                  <View style={{ height: 16 }} />
                </ScrollView>
              )}
              {/* 단계 2: 날짜 선택 (eligible-occurrences 기반) */}
              {selectedClassId && !selectedDate && (() => {
                if (occLoading) return (
                  <ActivityIndicator color="#7C3AED" style={{ marginVertical: 40 }} />
                );
                if (occError) return (
                  <View style={s.empty}>
                    <LucideIcon name="alert-circle" size={24} color={C.textMuted} />
                    <Text style={s.emptyTxt}>수업 회차를 불러오지 못했습니다</Text>
                    <Pressable onPress={() => selectClass(selectedClassId)} style={{ marginTop: 8 }}>
                      <Text style={{ color: C.textSecondary, fontSize: 13, fontFamily: "Pretendard-Regular" }}>재시도</Text>
                    </Pressable>
                  </View>
                );
                if (occurrences.length === 0) return (
                  <View style={s.empty}>
                    <LucideIcon name="alert-circle" size={24} color={C.textMuted} />
                    <Text style={s.emptyTxt}>배정 가능한 날짜가 없습니다</Text>
                  </View>
                );
                const past   = occurrences.filter((o: MakeupOccurrence) => o.is_past);
                const today  = occurrences.filter((o: MakeupOccurrence) => o.is_today);
                const future = occurrences.filter((o: MakeupOccurrence) => o.is_future);
                const days = ["일","월","화","수","목","금","토"];
                function fmtOcc(dateStr: string) {
                  const d = new Date(dateStr + "T00:00:00");
                  return `${d.getMonth()+1}/${d.getDate()} (${days[d.getDay()]})`;
                }
                function renderOccRow(occ: MakeupOccurrence) {
                  return (
                    <Pressable
                      key={occ.occurrence_date}
                      style={[s.classRow, (occ.is_full && occ.is_future) && { opacity: 0.4 }]}
                      onPress={() => {
                        if (occ.is_full && occ.is_future) return;
                        setSelectedDate(occ.occurrence_date);
                        setSelectedOccurrence(occ);
                      }}
                      disabled={occ.is_full && occ.is_future}
                    >
                      <LucideIcon name="check-circle" size={16} color="#7C3AED" />
                      <View style={{ flex: 1 }}>
                        <Text style={[s.className, { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.text }]}>{fmtOcc(occ.occurrence_date)}</Text>
                      </View>
                      {occ.is_full && (
                        <View style={{ backgroundColor: occ.is_future ? "#F9DEDA" : "#FFF1BF", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginRight: 4 }}>
                          <Text style={{ fontSize: 10, fontFamily: "Pretendard-Regular", color: occ.is_future ? "#D96C6C" : "#D97706" }}>
                            {occ.is_future ? "정원마감" : "정원초과"}
                          </Text>
                        </View>
                      )}
                      <LucideIcon name="chevron-right" size={16} color={C.textMuted} />
                    </Pressable>
                  );
                }
                return (
                  <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false}>
                    {past.length > 0 && (
                      <>
                        <Text style={[s.groupLabel, { paddingHorizontal: 16, paddingTop: 12 }]}>지난 수업</Text>
                        {past.map(renderOccRow)}
                      </>
                    )}
                    {today.length > 0 && (
                      <>
                        <Text style={[s.groupLabel, { paddingHorizontal: 16, paddingTop: 12, color: "#2EC4B6" }]}>오늘</Text>
                        {today.map(renderOccRow)}
                      </>
                    )}
                    {future.length > 0 && (
                      <>
                        <Text style={[s.groupLabel, { paddingHorizontal: 16, paddingTop: 12 }]}>예정 수업</Text>
                        {future.map(renderOccRow)}
                      </>
                    )}
                    <View style={{ height: 16 }} />
                  </ScrollView>
                );
              })()}
              {/* 단계 3: 확인 및 배정 확정 */}
              {selectedClassId && selectedDate && (
                <>
                  <View style={{ padding: 16, gap: 10 }}>
                    <View style={s.assignedInfo}>
                      <LucideIcon name="check-circle" size={18} color="#7C3AED" />
                      <Text style={s.assignedInfoTxt}>
                        {`${eligibleClasses.find(c => c.id === selectedClassId)?.name}\n${fmtDate(selectedDate)} 보강 수업`}
                      </Text>
                    </View>
                  </View>
                  <View style={{ paddingHorizontal: 16, paddingBottom: 16, paddingTop: 4, gap: 8 }}>
                    <Pressable
                      style={[s.confirmBtn, { backgroundColor: C.button, opacity: assigning ? 0.6 : 1 }]}
                      onPress={doAssign}
                      disabled={assigning}
                    >
                      {assigning ? <ActivityIndicator color="#fff" /> : <Text style={s.confirmTxt}>배정 확정</Text>}
                    </Pressable>
                    <Pressable
                      style={[s.confirmBtn, { backgroundColor: C.card, borderWidth: 1, borderColor: C.border }]}
                      onPress={() => setSelectedDate(null)}
                    >
                      <Text style={[s.confirmTxt, { color: C.textSecondary }]}>날짜 다시 선택</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </Pressable>
          </Pressable>
        </Modal>
      )}
      {/* ── 지난 보강 직접 완료 모달 (새 3단계 흐름) ─────────────────────── */}
      {directCompleteTarget && (
        <Modal visible animationType="slide" transparent onRequestClose={closeDirectCompleteModal} statusBarTranslucent>
          <Pressable style={s.backdrop} onPress={closeDirectCompleteModal}>
            <Pressable style={[s.sheet, { maxHeight: "70%" }]} onPress={() => {}}>
              <View style={s.sheetHandle} />
              <View style={s.sheetHeader}>
                <View style={{ flex: 1 }}>
                  {selectedClassId ? (
                    <>
                      <Text style={s.sheetTitle}>보강 날짜 선택</Text>
                      <Text style={s.sheetSub}>
                        {eligibleClasses.find((c: any) => c.id === selectedClassId)?.name} · 지난 수업 / 오늘
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text style={s.sheetTitle}>지난 보강 직접 완료</Text>
                      <Text style={s.sheetSub}>{directCompleteTarget.student_name} · 결석일: {fmtDate(directCompleteTarget.absence_date)}</Text>
                    </>
                  )}
                </View>
                {selectedClassId ? (
                  <Pressable
                    onPress={resetOccState}
                    style={{ padding: 4 }}
                  >
                    <LucideIcon name="arrow-left" size={20} color={C.textSecondary} />
                  </Pressable>
                ) : (
                  <Pressable onPress={closeDirectCompleteModal} style={{ padding: 4 }}>
                    <LucideIcon name="x" size={20} color={C.textSecondary} />
                  </Pressable>
                )}
              </View>

              {/* 단계 1: 반 선택 */}
              {!selectedClassId && (
                <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false}>
                  {classLoading ? (
                    <ActivityIndicator color="#059669" style={{ marginVertical: 32 }} />
                  ) : eligibleClasses.length === 0 ? (
                    <View style={s.empty}>
                      <LucideIcon name="alert-circle" size={24} color={C.textMuted} />
                      <Text style={s.emptyTxt}>배정 가능한 반이 없습니다</Text>
                    </View>
                  ) : (() => {
                    const myClasses    = eligibleClasses.filter((cg: any) => cg.is_mine);
                    const otherClasses = eligibleClasses.filter((cg: any) => !cg.is_mine);
                    const renderDcClassRow = (cg: any) => (
                      <Pressable key={cg.id} style={s.classRow} onPress={() => selectClass(cg.id)}>
                        <LucideIcon name="calendar" size={16} color={cg.is_mine ? "#059669" : "#9CA3AF"} />
                        <View style={{ flex: 1 }}>
                          <Text style={[s.className, { fontSize: 14, color: C.text }]}>{cg.name}</Text>
                          <Text style={s.infoTxt}>{cg.schedule_days?.split(",").join("·")} · {cg.schedule_time}</Text>
                        </View>
                        <LucideIcon name="chevron-right" size={16} color={C.textMuted} />
                      </Pressable>
                    );
                    return (
                      <>
                        {myClasses.length > 0 && (
                          <>
                            <Text style={[s.groupLabel, { paddingHorizontal: 16, paddingTop: 12 }]}>내 반</Text>
                            {myClasses.map(renderDcClassRow)}
                          </>
                        )}
                        {otherClasses.length > 0 && (
                          <>
                            <Text style={[s.groupLabel, { paddingHorizontal: 16, paddingTop: 12, color: "#9CA3AF" }]}>
                              다른 선생님 반 (인계 처리)
                            </Text>
                            {otherClasses.map(renderDcClassRow)}
                          </>
                        )}
                      </>
                    );
                  })()}
                  <View style={{ height: 16 }} />
                </ScrollView>
              )}

              {/* 단계 2: 회차 선택 (과거·오늘만 표시, 미래 제외) */}
              {selectedClassId && (() => {
                if (occLoading) return (
                  <ActivityIndicator color="#059669" style={{ marginVertical: 40 }} />
                );
                if (occError) return (
                  <View style={s.empty}>
                    <LucideIcon name="alert-circle" size={24} color={C.textMuted} />
                    <Text style={s.emptyTxt}>수업 회차를 불러오지 못했습니다</Text>
                    <Pressable onPress={() => selectClass(selectedClassId)} style={{ marginTop: 8 }}>
                      <Text style={{ color: C.textSecondary, fontSize: 13, fontFamily: "Pretendard-Regular" }}>재시도</Text>
                    </Pressable>
                  </View>
                );
                const pastAndToday = occurrences.filter(o => o.is_past || o.is_today);
                if (pastAndToday.length === 0) return (
                  <View style={s.empty}>
                    <LucideIcon name="alert-circle" size={24} color={C.textMuted} />
                    <Text style={s.emptyTxt}>완료 처리 가능한 날짜가 없습니다</Text>
                  </View>
                );
                const days = ["일","월","화","수","목","금","토"];
                function fmtOcc(dateStr: string) {
                  const d = new Date(dateStr + "T00:00:00");
                  return `${d.getMonth()+1}/${d.getDate()} (${days[d.getDay()]})`;
                }
                const todayOccs = pastAndToday.filter(o => o.is_today);
                const pastOccs  = pastAndToday.filter(o => o.is_past);
                function renderDcOccRow(occ: MakeupOccurrence) {
                  const onConfirm = () => doDirectComplete(occ);
                  const onPress = () => {
                    if (occ.is_full) {
                      Alert.alert(
                        "정원 초과",
                        "정원을 초과한 반입니다.\n실제로 보강 수업에 참여한 경우에만 처리해 주세요.",
                        [{ text: "취소", style: "cancel" }, { text: "그래도 처리", onPress: onConfirm }],
                      );
                      return;
                    }
                    onConfirm();
                  };
                  return (
                    <Pressable
                      key={occ.occurrence_date}
                      style={[s.classRow, directCompleting && { opacity: 0.5 }]}
                      onPress={onPress}
                      disabled={directCompleting}
                    >
                      <LucideIcon name="check-circle" size={16} color="#059669" />
                      <View style={{ flex: 1 }}>
                        <Text style={[s.className, { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.text }]}>
                          {fmtOcc(occ.occurrence_date)}{occ.is_today ? " · 오늘" : ""}
                        </Text>
                      </View>
                      {occ.is_full && (
                        <View style={{ backgroundColor: "#FFF1BF", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginRight: 4 }}>
                          <Text style={{ fontSize: 10, fontFamily: "Pretendard-Regular", color: "#D97706" }}>정원초과</Text>
                        </View>
                      )}
                      <LucideIcon name="chevron-right" size={16} color={C.textMuted} />
                    </Pressable>
                  );
                }
                return (
                  <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false}>
                    {todayOccs.length > 0 && (
                      <>
                        <Text style={[s.groupLabel, { paddingHorizontal: 16, paddingTop: 12, color: "#2EC4B6" }]}>오늘</Text>
                        {todayOccs.map(renderDcOccRow)}
                      </>
                    )}
                    {pastOccs.length > 0 && (
                      <>
                        <Text style={[s.groupLabel, { paddingHorizontal: 16, paddingTop: 12 }]}>지난 수업</Text>
                        {pastOccs.map(renderDcOccRow)}
                      </>
                    )}
                    <View style={{ height: 16 }} />
                  </ScrollView>
                );
              })()}
            </Pressable>
          </Pressable>
        </Modal>
      )}
      {/* ── 기타 보강 모달 ──────────────────────────────────────────────── */}
      {handoverTarget && (
        <Modal visible animationType="slide" transparent onRequestClose={closeHandover} statusBarTranslucent>
          <Pressable style={s.backdrop} onPress={closeHandover}>
            <Pressable style={s.sheet} onPress={() => {}}>
              <View style={s.sheetHandle} />
              {/* ── 선생님 선택 단계 ── */}
              {handoverStep === "teacher_select" && (
                <>
                  <View style={s.sheetHeader}>
                    <Pressable onPress={closeHandover} style={{ padding: 4, marginRight: 8 }}>
                      <LucideIcon name="arrow-left" size={20} color={C.text} />
                    </Pressable>
                    <View style={{ flex: 1 }}>
                      <Text style={s.sheetTitle}>담당선생님 인계</Text>
                      <Text style={s.sheetSub}>선택한 선생님의 보강 대기 목록으로 이관됩니다.</Text>
                    </View>
                    <Pressable onPress={closeHandover} style={{ padding: 4 }}>
                      <LucideIcon name="x" size={20} color={C.textSecondary} />
                    </Pressable>
                  </View>
                  <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false}>
                    {teachersLoading ? (
                      <ActivityIndicator color={themeColor} style={{ marginVertical: 32 }} />
                    ) : teachers.length === 0 ? (
                      <View style={s.empty}>
                        <Text style={s.emptyTxt}>등록된 선생님이 없습니다</Text>
                      </View>
                    ) : teachers.map(t => {
                      const isSelected = selectedTeacher?.id === t.id;
                      const isMe = t.id === adminUser?.id;
                      return (
                        <Pressable
                          key={t.id}
                          style={[s.classRow, isSelected && { backgroundColor: "#4F46E5" + "12", borderColor: "#4F46E5" }]}
                          onPress={() => setSelectedTeacher(t)}
                        >
                          <LucideIcon name={isSelected ? "check-circle" : "circle"} size={16} color={isSelected ? "#4F46E5" : C.textMuted} />
                          <View style={{ flex: 1 }}>
                            <Text style={[s.className, { fontSize: 14, fontFamily: "Pretendard-Regular", color: isSelected ? "#4F46E5" : C.text }]}>
                              {t.name}{isMe ? " (나)" : ""}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                  {selectedTeacher && (
                    <View style={{ paddingHorizontal: 16, paddingBottom: 24, paddingTop: 8 }}>
                      <Pressable
                        style={[s.confirmBtn, { backgroundColor: "#4F46E5", opacity: handoverSubmitting ? 0.6 : 1 }]}
                        onPress={doHandover}
                        disabled={handoverSubmitting}
                      >
                        {handoverSubmitting
                          ? <ActivityIndicator color="#fff" />
                          : <Text style={s.confirmTxt}>{selectedTeacher.name} 선생님에게 인계</Text>
                        }
                      </Pressable>
                    </View>
                  )}
                </>
              )}
              {/* ── 완료 단계 ── */}
              {handoverStep === "done" && (
                <View style={{ alignItems: "center", padding: 32, gap: 16 }}>
                  <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: "#E6FFFA", alignItems: "center", justifyContent: "center" }}>
                    <LucideIcon name="check" size={28} color="#2EC4B6" />
                  </View>
                  <Text style={{ fontSize: 16, fontFamily: "Pretendard-Regular", color: C.text }}>인계 완료</Text>
                  <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, textAlign: "center", lineHeight: 20 }}>
                    {handoverDoneMsg}
                  </Text>
                  <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted, textAlign: "center" }}>
                    메신저 대화방에 자동 알림이 전송되었습니다.
                  </Text>
                  <Pressable style={[s.confirmBtn, { backgroundColor: "#2EC4B6", alignSelf: "stretch" }]} onPress={closeHandover}>
                    <Text style={s.confirmTxt}>확인</Text>
                  </Pressable>
                </View>
              )}
            </Pressable>
          </Pressable>
        </Modal>
      )}
      {/* 보강 완료 확인 모달 */}
      <ConfirmModal
        visible={!!completeTarget}
        title="보강 완료 확인"
        message={completeTarget ? `${completeTarget.student_name} 학생의 대리 보강 수업을 완료 처리합니까?\n완료 후 관리자 화면에서도 완료로 표시됩니다.` : ""}
        confirmText="완료 처리"
        onConfirm={() => completeTarget && handleTeacherComplete(completeTarget.id)}
        onCancel={() => setCompleteTarget(null)}
      />
      {/* 보강 소멸 확인 */}
      <ConfirmModal
        visible={!!selfExtTarget}
        title="보강 소멸"
        message={
          selfExtTarget
            ? `${selfExtTarget.student_name} 학생의 보강을 소멸 처리합니까?\n\n내 정산에 기타 1시수가 반영됩니다.`
            : ""
        }
        confirmText={selfExtSubmitting ? "처리 중..." : "소멸 처리"}
        onConfirm={doSelfExtinguish}
        onCancel={() => setSelfExtTarget(null)}
      />
      <ConfirmModal
        visible={!!confirmMsg}
        title="알림"
        message={confirmMsg ?? ""}
        confirmText="확인"
        onConfirm={() => setConfirmMsg(null)}
        onCancel={() => setConfirmMsg(null)}
      />
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: "#FFFFFF" },
  tabBtn:          { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: C.border },
  tabTxt:          { fontSize: 13, lineHeight: 18, color: C.textSecondary },
  tabBadge:        { width: 16, height: 16, borderRadius: 8, backgroundColor: "#D96C6C", alignItems: "center", justifyContent: "center" },
  tabBadgeTxt:     { fontSize: 9, lineHeight: 13, color: "#fff" },
  list:            { padding: 14, gap: 10 },
  groupLabel:      { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted, marginBottom: 6, marginTop: 4 },
  empty:           { alignItems: "center", gap: 12, paddingVertical: 60 },
  emptyTxt:        { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textMuted, textAlign: "center" },
  card:            { borderRadius: 16, padding: 14, gap: 8, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  cardTop:         { flexDirection: "row", alignItems: "flex-start" },
  studentName:     { fontSize: 16, fontFamily: "Pretendard-Regular", color: C.text },
  className:       { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  statusBadge:     { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  statusTxt:       { fontSize: 12, fontFamily: "Pretendard-Regular" },
  infoRow:         { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  infoTxt:         { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, flex: 1 },
  btnRow:          { flexDirection: "row", gap: 8, marginTop: 4 },
  actionBtn:       { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 9, borderRadius: 10 },
  actionTxt:       { fontSize: 13, fontFamily: "Pretendard-Regular" },
  assignedInfo:    { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#EEDDF5", borderRadius: 10, padding: 10, marginBottom: 10 },
  assignedInfoTxt: { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", color: "#7C3AED", lineHeight: 18 },
  backdrop:        { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet:           { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "65%", paddingBottom: 32 },
  sheetHandle:     { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginTop: 10, marginBottom: 4 },
  sheetHeader:     { flexDirection: "row", alignItems: "flex-start", padding: 16, paddingTop: 8 },
  sheetTitle:      { fontSize: 17, fontFamily: "Pretendard-Regular", color: C.text },
  sheetSub:        { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 2 },
  classRow:        { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderColor: "transparent", marginHorizontal: 12, marginBottom: 4, borderRadius: 10 },
  confirmBtn:      { height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  confirmTxt:      { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" },
  menuOption:      { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.card, borderRadius: 14, padding: 16 },
  menuIcon:        { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  menuTitle:       { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.text, marginBottom: 3 },
  menuDesc:        { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 17 },
});
