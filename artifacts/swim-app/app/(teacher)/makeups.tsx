/**
 * (teacher)/makeups.tsx — 결석자 리스트 / 배정된 보강 / 보강 현황
 */
import { ArrowLeft, Calendar, Check, CircleAlert, CircleCheck, CircleX, Clock, UserCheck, UserPlus, Users, X } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { ConfirmModal } from "@/components/common/ConfirmModal";

const C = Colors.light;

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
  assigned_class_group_name: string | null;
  note: string | null;
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

// 기타 보강 바텀시트 단계
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

function fmtDate(s: string | null) {
  if (!s) return "-";
  const d = new Date(s + "T00:00:00");
  const days = ["일","월","화","수","목","금","토"];
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

export default function MakeupsScreen() {
  const { token, adminUser } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<TabKey>("waiting");

  // 결석자 리스트 (탭 1)
  const [waitingList,    setWaitingList]    = useState<MakeupSession[]>([]);
  const [waitingLoading, setWaitingLoading] = useState(true);
  const [waitingRefresh, setWaitingRefresh] = useState(false);

  // 보강반 배정 모달
  const [assignTarget,    setAssignTarget]    = useState<MakeupSession | null>(null);
  const [eligibleClasses, setEligibleClasses] = useState<any[]>([]);
  const [classLoading,    setClassLoading]    = useState(false);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [assigning,       setAssigning]       = useState(false);

  // 기타 보강 모달
  const [handoverTarget,  setHandoverTarget]  = useState<MakeupSession | null>(null);
  const [handoverStep,    setHandoverStep]    = useState<HandoverStep>("menu");
  const [teachers,        setTeachers]        = useState<Teacher[]>([]);
  const [teachersLoading, setTeachersLoading] = useState(false);
  const [selectedTeacher, setSelectedTeacher] = useState<Teacher | null>(null);
  const [handoverSubmitting, setHandoverSubmitting] = useState(false);
  const [handoverDoneMsg, setHandoverDoneMsg] = useState<string>("");

  // 보강 소멸 확인
  const [selfExtTarget,     setSelfExtTarget]     = useState<MakeupSession | null>(null);
  const [selfExtSubmitting, setSelfExtSubmitting] = useState(false);

  // 배정된 보강 (탭 2)
  const [assignedList,    setAssignedList]    = useState<any[]>([]);
  const [assignedLoading, setAssignedLoading] = useState(false);
  const [completeTarget,  setCompleteTarget]  = useState<any | null>(null);

  // 보강 현황 (탭 3)
  const [historyList,    setHistoryList]    = useState<MakeupRequest[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // 공통 알림
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);

  // ── 결석자 리스트 로드 ──────────────────────────────────────────────────
  const loadWaiting = useCallback(async () => {
    if (!adminUser?.id) return;
    try {
      const res = await apiRequest(token, `/admin/makeups?status=waiting&teacher_id=${adminUser.id}`);
      if (res.ok) setWaitingList(await res.json());
    } catch (e) { console.error(e); }
    finally { setWaitingLoading(false); setWaitingRefresh(false); }
  }, [token, adminUser?.id]);

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

  useEffect(() => { loadWaiting(); }, [loadWaiting]);
  useEffect(() => { if (tab === "assigned") loadAssigned(); }, [tab, loadAssigned]);
  useEffect(() => { if (tab === "history") loadHistory(); }, [tab, loadHistory]);

  // ── 보강반 배정 ─────────────────────────────────────────────────────────
  const openAssignModal = async (mk: MakeupSession) => {
    setAssignTarget(mk);
    setSelectedClassId(null);
    setClassLoading(true);
    try {
      const r = await apiRequest(token, `/admin/makeups/eligible-classes?teacher_id=${mk.original_teacher_id || ""}`);
      if (r.ok) setEligibleClasses(await r.json());
    } catch {}
    setClassLoading(false);
  };

  const doAssign = async () => {
    if (!assignTarget || !selectedClassId) return;
    setAssigning(true);
    try {
      const r = await apiRequest(token, `/admin/makeups/${assignTarget.id}/assign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class_group_id: selectedClassId }),
      });
      if (r.status === 409) setConfirmMsg("이미 해당 날짜에 보강이 배정되어 있습니다.");
      setAssignTarget(null);
      setSelectedClassId(null);
      loadWaiting();
    } catch { setConfirmMsg("네트워크 오류가 발생했습니다."); }
    setAssigning(false);
  };

  // ── 기타 보강: 인계 직접 진입 (메뉴 단계 생략) ──────────────────────────
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

  // A. 다른 선생님에게 인계 확인
  const doHandover = async () => {
    if (!handoverTarget || !selectedTeacher) return;
    setHandoverSubmitting(true);
    try {
      const r = await apiRequest(token, `/admin/makeups/${handoverTarget.id}/handover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiver_teacher_id: selectedTeacher.id }),
      });
      if (r.ok) {
        setHandoverDoneMsg(`${selectedTeacher.name} 선생님 정산에\n기타 1시수가 반영되었습니다.`);
        setHandoverStep("done");
        loadWaiting();
      } else {
        const d = await r.json().catch(() => ({}));
        setConfirmMsg(d.error || "처리에 실패했습니다.");
      }
    } catch { setConfirmMsg("네트워크 오류가 발생했습니다."); }
    setHandoverSubmitting(false);
  };

  // B. 보강 소멸 처리
  const doSelfExtinguish = async () => {
    if (!selfExtTarget) return;
    setSelfExtSubmitting(true);
    try {
      const r = await apiRequest(token, `/admin/makeups/${selfExtTarget.id}/self-extinguish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (r.ok) {
        setSelfExtTarget(null);
        setHandoverTarget(null);
        loadWaiting();
        setConfirmMsg("보강이 소멸 처리되었습니다.\n내 정산에 기타 1시수가 반영됩니다.");
      } else {
        const d = await r.json().catch(() => ({}));
        setConfirmMsg(d.error || "처리에 실패했습니다.");
        setSelfExtTarget(null);
      }
    } catch {
      setConfirmMsg("네트워크 오류가 발생했습니다.");
      setSelfExtTarget(null);
    }
    setSelfExtSubmitting(false);
  };

  const closeHandover = () => {
    setHandoverTarget(null);
    setHandoverStep("menu");
    setSelectedTeacher(null);
  };

  // ── 배정된 보강 완료 ─────────────────────────────────────────────────────
  async function handleTeacherComplete(id: string) {
    try {
      const res = await apiRequest(token, `/teacher/makeups/${id}/complete`, { method: "PATCH" });
      if (res.ok) {
        setAssignedList(prev => prev.filter(m => m.id !== id));
      } else {
        const d = await res.json().catch(() => ({}));
        setConfirmMsg(d.error || "처리에 실패했습니다.");
      }
    } catch { setConfirmMsg("네트워크 오류가 발생했습니다."); }
    setCompleteTarget(null);
  }

  // ── 보강 현황 그룹화 ─────────────────────────────────────────────────────
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
          <Calendar size={13} color={C.textSecondary} />
          <Text style={s.infoTxt}>결석일: {fmtDate(item.original_date)}</Text>
        </View>
        {item.makeup_date ? (
          <View style={s.infoRow}>
            <CircleCheck size={13} color="#2EC4B6" />
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
      <SubScreenHeader title="결석자 리스트" homePath="/(teacher)/today-schedule" />

      {/* 탭 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ flexDirection: "row", paddingHorizontal: 14, paddingVertical: 10, gap: 8, backgroundColor: C.background, borderBottomWidth: 1, borderBottomColor: C.border }}>
        <Pressable
          style={[s.tabBtn, tab === "waiting" && { backgroundColor: themeColor, borderColor: themeColor }]}
          onPress={() => setTab("waiting")}
        >
          {waitingList.length > 0 && tab !== "waiting" && (
            <View style={s.tabBadge}><Text style={s.tabBadgeTxt}>{waitingList.length}</Text></View>
          )}
          <Text style={[s.tabTxt, tab === "waiting" && { color: "#fff" }]}>결석자 리스트</Text>
        </Pressable>
        <Pressable
          style={[s.tabBtn, tab === "assigned" && { backgroundColor: "#7C3AED", borderColor: "#7C3AED" }]}
          onPress={() => setTab("assigned")}
        >
          {assignedList.length > 0 && tab !== "assigned" && (
            <View style={s.tabBadge}><Text style={s.tabBadgeTxt}>{assignedList.length}</Text></View>
          )}
          <Text style={[s.tabTxt, tab === "assigned" && { color: "#fff" }]}>배정된 보강</Text>
        </Pressable>
        <Pressable
          style={[s.tabBtn, tab === "history" && { backgroundColor: themeColor, borderColor: themeColor }]}
          onPress={() => setTab("history")}
        >
          <Text style={[s.tabTxt, tab === "history" && { color: "#fff" }]}>보강 현황</Text>
        </Pressable>
      </ScrollView>

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
                <CircleCheck size={36} color={C.textMuted} />
                <Text style={s.emptyTxt}>처리할 결석자가 없습니다</Text>
              </View>
            ) : waitingList.map(mk => {
              const expireInfo = formatExpireAt(mk.expire_at);
              return (
                <View key={mk.id} style={[s.card, { backgroundColor: C.card }]}>
                  <View style={s.cardTop}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={s.studentName}>{mk.student_name || "-"}</Text>
                      <Text style={s.className}>{mk.original_class_group_name || "미배정"}</Text>
                    </View>
                    <View style={[s.statusBadge, { backgroundColor: "#FFF1BF" }]}>
                      <Text style={[s.statusTxt, { color: "#D97706" }]}>대기</Text>
                    </View>
                  </View>
                  <View style={s.infoRow}>
                    <Calendar size={13} color={C.textSecondary} />
                    <Text style={s.infoTxt}>결석일: {fmtDate(mk.absence_date)}</Text>
                  </View>
                  {expireInfo && (
                    <View style={s.infoRow}>
                      <Clock size={13} color={expireInfo.color} />
                      <Text style={[s.infoTxt, { color: expireInfo.color, fontFamily: "Pretendard-Regular" }]}>{expireInfo.text}</Text>
                    </View>
                  )}
                  {mk.assigned_class_group_name && (
                    <View style={s.infoRow}>
                      <CircleCheck size={13} color="#2EC4B6" />
                      <Text style={[s.infoTxt, { color: "#2EC4B6" }]}>배정반: {mk.assigned_class_group_name}</Text>
                    </View>
                  )}
                  <View style={s.btnRow}>
                    <Pressable
                      style={[s.actionBtn, { backgroundColor: C.button }]}
                      onPress={() => openAssignModal(mk)}
                    >
                      <Calendar size={14} color="#fff" />
                      <Text style={[s.actionTxt, { color: "#fff" }]}>보강반 배정</Text>
                    </Pressable>
                    <Pressable
                      style={[s.actionBtn, { backgroundColor: "#EEF2FF", flex: undefined, paddingHorizontal: 12 }]}
                      onPress={() => openHandoverDirect(mk)}
                    >
                      <UserPlus size={14} color="#4F46E5" />
                      <Text style={[s.actionTxt, { color: "#4F46E5" }]}>인계</Text>
                    </Pressable>
                    <Pressable
                      style={[s.actionBtn, { backgroundColor: "#FEF2F2", flex: undefined, paddingHorizontal: 12 }]}
                      onPress={() => setSelfExtTarget(mk)}
                    >
                      <CircleX size={14} color="#DC2626" />
                      <Text style={[s.actionTxt, { color: "#DC2626" }]}>소멸</Text>
                    </Pressable>
                  </View>
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
                <UserCheck size={36} color={C.textMuted} />
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
                            <Calendar size={12} color={C.textSecondary} />
                            <Text style={s.infoTxt}>결석일: {mk.absence_date}</Text>
                          </View>
                          {mk.original_class_group_name && (
                            <View style={s.infoRow}>
                              <Users size={12} color={C.textSecondary} />
                              <Text style={s.infoTxt}>원반: {mk.original_class_group_name}  담당: {mk.original_teacher_name || "미배정"}</Text>
                            </View>
                          )}
                          {mk.assigned_class_group_name && (
                            <View style={s.infoRow}>
                              <CircleCheck size={12} color="#2EC4B6" />
                              <Text style={[s.infoTxt, { color: "#2EC4B6" }]}>배정반: {mk.assigned_class_group_name}</Text>
                            </View>
                          )}
                          {expireInfo && (
                            <View style={s.infoRow}>
                              <Clock size={12} color={expireInfo.color} />
                              <Text style={[s.infoTxt, { color: expireInfo.color, fontFamily: "Pretendard-Regular" }]}>{expireInfo.text}</Text>
                            </View>
                          )}
                        </View>
                        <View style={{ backgroundColor: "#EEDDF5", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                          <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: "#7C3AED" }}>대리보강</Text>
                        </View>
                      </View>
                      <Pressable
                        style={[s.actionBtn, { backgroundColor: "#EEDDF5", marginTop: 10, flex: undefined, paddingHorizontal: 16 }]}
                        onPress={() => setCompleteTarget(mk)}
                      >
                        <CircleCheck size={15} color="#7C3AED" />
                        <Text style={[s.actionTxt, { color: "#7C3AED", fontFamily: "Pretendard-Regular" }]}>보강 완료 확인</Text>
                      </Pressable>
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
                <Calendar size={36} color={C.textMuted} />
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
        <Modal visible animationType="slide" transparent onRequestClose={() => setAssignTarget(null)} statusBarTranslucent>
          <Pressable style={s.backdrop} onPress={() => setAssignTarget(null)}>
            <Pressable style={s.sheet} onPress={() => {}}>
              <View style={s.sheetHandle} />
              <View style={s.sheetHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={s.sheetTitle}>보강반 배정</Text>
                  <Text style={s.sheetSub}>{assignTarget.student_name} · 결석일: {fmtDate(assignTarget.absence_date)}</Text>
                </View>
                <Pressable onPress={() => { setAssignTarget(null); setSelectedClassId(null); }} style={{ padding: 4 }}>
                  <X size={20} color={C.textSecondary} />
                </Pressable>
              </View>
              <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false}>
                {classLoading ? (
                  <ActivityIndicator color={themeColor} style={{ marginVertical: 32 }} />
                ) : eligibleClasses.length === 0 ? (
                  <View style={s.empty}>
                    <CircleAlert size={24} color={C.textMuted} />
                    <Text style={s.emptyTxt}>배정 가능한 반이 없습니다</Text>
                  </View>
                ) : eligibleClasses.map(cg => {
                  const isSelected = selectedClassId === cg.id;
                  return (
                    <Pressable
                      key={cg.id}
                      style={[s.classRow, isSelected && { backgroundColor: themeColor + "15", borderColor: themeColor }]}
                      onPress={() => setSelectedClassId(cg.id)}
                    >
                      <LucideIcon name={isSelected ? "check-circle" : "circle"} size={16} color={isSelected ? themeColor : C.textMuted} />
                      <View style={{ flex: 1 }}>
                        <Text style={[s.className, { fontSize: 14, fontFamily: "Pretendard-Regular", color: isSelected ? themeColor : C.text }]}>{cg.name}</Text>
                        <Text style={s.infoTxt}>{cg.schedule_days?.split(",").join("·")} · {cg.schedule_time}</Text>
                      </View>
                      <Text style={[s.infoTxt, { color: C.textMuted }]}>잔여 {cg.available_slots ?? "?"}석</Text>
                    </Pressable>
                  );
                })}
                <View style={{ height: 16 }} />
              </ScrollView>
              {selectedClassId && (
                <View style={{ paddingHorizontal: 16, paddingBottom: 16, paddingTop: 8 }}>
                  <Pressable
                    style={[s.confirmBtn, { backgroundColor: C.button, opacity: assigning ? 0.6 : 1 }]}
                    onPress={doAssign}
                    disabled={assigning}
                  >
                    {assigning ? <ActivityIndicator color="#fff" /> : <Text style={s.confirmTxt}>배정 확정</Text>}
                  </Pressable>
                </View>
              )}
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* ── 기타 보강 모달 ──────────────────────────────────────────────── */}
      {handoverTarget && (
        <Modal visible animationType="slide" transparent onRequestClose={closeHandover} statusBarTranslucent>
          <Pressable style={s.backdrop} onPress={closeHandover}>
            <Pressable style={[s.sheet, { maxHeight: "70%" }]} onPress={() => {}}>
              <View style={s.sheetHandle} />

              {/* ── 선생님 선택 단계 ── */}
              {handoverStep === "teacher_select" && (
                <>
                  <View style={s.sheetHeader}>
                    <Pressable onPress={closeHandover} style={{ padding: 4, marginRight: 8 }}>
                      <ArrowLeft size={20} color={C.text} />
                    </Pressable>
                    <View style={{ flex: 1 }}>
                      <Text style={s.sheetTitle}>다른 선생님한테 보내기</Text>
                      <Text style={s.sheetSub}>선택한 선생님 정산에 기타 1시수가 반영됩니다.</Text>
                    </View>
                    <Pressable onPress={closeHandover} style={{ padding: 4 }}>
                      <X size={20} color={C.textSecondary} />
                    </Pressable>
                  </View>
                  <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false}>
                    {teachersLoading ? (
                      <ActivityIndicator color={themeColor} style={{ marginVertical: 32 }} />
                    ) : teachers.length === 0 ? (
                      <View style={s.empty}>
                        <CircleAlert size={24} color={C.textMuted} />
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
                    <View style={{ height: 16 }} />
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
                    <Check size={28} color="#2EC4B6" />
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
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: "#FFFFFF" },
  tabBtn:          { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: C.border },
  tabTxt:          { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  tabBadge:        { width: 16, height: 16, borderRadius: 8, backgroundColor: "#D96C6C", alignItems: "center", justifyContent: "center" },
  tabBadgeTxt:     { fontSize: 9, fontFamily: "Pretendard-Regular", color: "#fff" },
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
