/**
 * (teacher)/makeups.tsx — 결석자 리스트 / 배정된 보강 / 보강 현황
 *
 * 탭 1: 결석자 리스트 — GET /admin/makeups?status=waiting&teacher_id=<me>
 *   (관리자 결석자 리스트와 동일 원본, 담당선생님 필터만 추가)
 * 탭 2: 배정된 보강 — GET /teacher/makeups/assigned
 * 탭 3: 보강 현황 — GET /teacher/makeup-requests (이력)
 */
import { Feather } from "@expo/vector-icons";
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

// makeup_sessions 레코드 (관리자 결석자 리스트와 동일 원본)
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

// teacher makeup-requests 이력용 (보강 현황 탭)
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

type TabKey = "waiting" | "assigned" | "history";

const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  pending:   { bg: "#FFF1BF", text: "#D97706" },
  approved:  { bg: "#DDF2EF", text: "#1F8F86" },
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
  const col = diffDays <= 7 ? "#D96C6C" : diffDays <= 14 ? "#D97706" : "#6F6B68";
  const label = diffDays < 0 ? `만료됨(${ds})` : diffDays <= 14 ? `만료 D-${diffDays}(${ds})` : `만료일: ${ds}`;
  return { text: label, color: col };
}

export default function MakeupsScreen() {
  const { token, adminUser } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<TabKey>("waiting");

  // 결석자 리스트 (탭 1) — 관리자 원본과 동일, 담당선생님 필터
  const [waitingList,    setWaitingList]    = useState<MakeupSession[]>([]);
  const [waitingLoading, setWaitingLoading] = useState(true);
  const [waitingRefresh, setWaitingRefresh] = useState(false);

  // 보강반 배정 모달
  const [assignTarget,    setAssignTarget]    = useState<MakeupSession | null>(null);
  const [eligibleClasses, setEligibleClasses] = useState<any[]>([]);
  const [classLoading,    setClassLoading]    = useState(false);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [assigning,       setAssigning]       = useState(false);
  const [confirmMsg,      setConfirmMsg]      = useState<string | null>(null);

  // 배정된 보강 (탭 2)
  const [assignedList,    setAssignedList]    = useState<any[]>([]);
  const [assignedLoading, setAssignedLoading] = useState(false);
  const [completeTarget,  setCompleteTarget]  = useState<any | null>(null);

  // 보강 현황 (탭 3)
  const [historyList,    setHistoryList]    = useState<MakeupRequest[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ── 결석자 리스트 로드 (관리자 원본 + teacher_id 필터) ──────────────────
  const loadWaiting = useCallback(async () => {
    if (!adminUser?.id) return;
    try {
      const res = await apiRequest(token, `/admin/makeups?status=waiting&teacher_id=${adminUser.id}`);
      if (res.ok) setWaitingList(await res.json());
    } catch (e) { console.error(e); }
    finally { setWaitingLoading(false); setWaitingRefresh(false); }
  }, [token, adminUser?.id]);

  // ── 배정된 보강 로드 ────────────────────────────────────────────────────
  const loadAssigned = useCallback(async () => {
    setAssignedLoading(true);
    try {
      const res = await apiRequest(token, "/teacher/makeups/assigned");
      if (res.ok) setAssignedList(await res.json());
    } catch (e) { console.error(e); }
    finally { setAssignedLoading(false); }
  }, [token]);

  // ── 보강 현황 로드 ────────────────────────────────────────────────────────
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
      if (r.status === 409) {
        setConfirmMsg("이미 해당 날짜에 보강이 배정되어 있습니다.");
      }
      setAssignTarget(null);
      setSelectedClassId(null);
      loadWaiting();
    } catch { setConfirmMsg("네트워크 오류가 발생했습니다."); }
    setAssigning(false);
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
  const pendingHistory  = historyList.filter(r => r.status !== "pending");
  const thisMonthHist   = pendingHistory.filter(r => r.original_date.startsWith(thisMonth));
  const prevMonthHist   = pendingHistory.filter(r => r.original_date.startsWith(prevMonth));
  const olderHist       = pendingHistory.filter(r =>
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
          <Feather name="calendar" size={13} color={C.textSecondary} />
          <Text style={s.infoTxt}>결석일: {fmtDate(item.original_date)}</Text>
        </View>
        {item.makeup_date ? (
          <View style={s.infoRow}>
            <Feather name="check-circle" size={13} color="#1F8F86" />
            <Text style={[s.infoTxt, { color: "#1F8F86" }]}>
              보강일: {fmtDate(item.makeup_date)}
              {item.makeup_class_name ? ` · ${item.makeup_class_name}` : ""}
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
        contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 10, gap: 8, backgroundColor: C.background, borderBottomWidth: 1, borderBottomColor: C.border }}>
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
                <Feather name="check-circle" size={36} color={C.textMuted} />
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
                    <Feather name="calendar" size={13} color={C.textSecondary} />
                    <Text style={s.infoTxt}>결석일: {fmtDate(mk.absence_date)}</Text>
                  </View>
                  {expireInfo && (
                    <View style={s.infoRow}>
                      <Feather name="clock" size={13} color={expireInfo.color} />
                      <Text style={[s.infoTxt, { color: expireInfo.color, fontFamily: "Inter_600SemiBold" }]}>{expireInfo.text}</Text>
                    </View>
                  )}
                  {mk.assigned_class_group_name && (
                    <View style={s.infoRow}>
                      <Feather name="check-circle" size={13} color="#1F8F86" />
                      <Text style={[s.infoTxt, { color: "#1F8F86" }]}>배정반: {mk.assigned_class_group_name}</Text>
                    </View>
                  )}
                  <View style={s.btnRow}>
                    <Pressable
                      style={[s.actionBtn, { backgroundColor: themeColor }]}
                      onPress={() => openAssignModal(mk)}
                    >
                      <Feather name="calendar" size={14} color="#fff" />
                      <Text style={[s.actionTxt, { color: "#fff" }]}>보강반 배정</Text>
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
                <Feather name="user-check" size={36} color={C.textMuted} />
                <Text style={s.emptyTxt}>배정된 대리 보강이 없습니다</Text>
              </View>
            ) : (
              <>
                <View style={s.assignedInfo}>
                  <Feather name="info" size={13} color="#7C3AED" />
                  <Text style={s.assignedInfoTxt}>다른 선생님 수업의 학생이 나에게 보강 배정된 목록입니다. 수업 진행 후 완료 버튼을 눌러주세요.</Text>
                </View>
                {assignedList.map(mk => {
                  const expireInfo = formatExpireAt(mk.expire_at);
                  return (
                    <View key={mk.id} style={[s.card, { backgroundColor: C.card, borderLeftWidth: 3, borderLeftColor: "#7C3AED" }]}>
                      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                        <View style={{ flex: 1, gap: 3 }}>
                          <Text style={[s.studentName, { color: "#7C3AED" }]}>{mk.student_name}</Text>
                          <View style={s.infoRow}>
                            <Feather name="calendar" size={12} color={C.textSecondary} />
                            <Text style={s.infoTxt}>결석일: {mk.absence_date}</Text>
                          </View>
                          {mk.original_class_group_name && (
                            <View style={s.infoRow}>
                              <Feather name="users" size={12} color={C.textSecondary} />
                              <Text style={s.infoTxt}>원반: {mk.original_class_group_name}  담당: {mk.original_teacher_name || "미배정"}</Text>
                            </View>
                          )}
                          {mk.assigned_class_group_name && (
                            <View style={s.infoRow}>
                              <Feather name="check-circle" size={12} color="#1F8F86" />
                              <Text style={[s.infoTxt, { color: "#1F8F86" }]}>배정반: {mk.assigned_class_group_name}</Text>
                            </View>
                          )}
                          {expireInfo && (
                            <View style={s.infoRow}>
                              <Feather name="clock" size={12} color={expireInfo.color} />
                              <Text style={[s.infoTxt, { color: expireInfo.color, fontFamily: "Inter_600SemiBold" }]}>{expireInfo.text}</Text>
                            </View>
                          )}
                        </View>
                        <View style={{ backgroundColor: "#EEDDF5", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                          <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#7C3AED" }}>대리보강</Text>
                        </View>
                      </View>
                      <Pressable
                        style={[s.actionBtn, { backgroundColor: "#EEDDF5", marginTop: 10, flexDirection: "row", gap: 6, flex: undefined }]}
                        onPress={() => setCompleteTarget(mk)}
                      >
                        <Feather name="check-circle" size={15} color="#7C3AED" />
                        <Text style={[s.actionTxt, { color: "#7C3AED", fontFamily: "Inter_700Bold" }]}>보강 완료 확인</Text>
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
                <Feather name="calendar" size={36} color={C.textMuted} />
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
            <Pressable style={s.assignSheet} onPress={() => {}}>
              <View style={s.sheetHandle} />
              <View style={s.sheetHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={s.sheetTitle}>보강반 배정</Text>
                  <Text style={s.sheetSub}>{assignTarget.student_name} · 결석일: {fmtDate(assignTarget.absence_date)}</Text>
                </View>
                <Pressable onPress={() => { setAssignTarget(null); setSelectedClassId(null); }} style={{ padding: 4 }}>
                  <Feather name="x" size={20} color={C.textSecondary} />
                </Pressable>
              </View>
              <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false}>
                {classLoading ? (
                  <ActivityIndicator color={themeColor} style={{ marginVertical: 32 }} />
                ) : eligibleClasses.length === 0 ? (
                  <View style={s.empty}>
                    <Feather name="alert-circle" size={24} color={C.textMuted} />
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
                      <Feather name={isSelected ? "check-circle" : "circle"} size={16} color={isSelected ? themeColor : C.textMuted} />
                      <View style={{ flex: 1 }}>
                        <Text style={[s.className, { fontSize: 14, fontFamily: "Inter_600SemiBold", color: isSelected ? themeColor : C.text }]}>{cg.name}</Text>
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
                    style={[s.confirmBtn, { backgroundColor: themeColor, opacity: assigning ? 0.6 : 1 }]}
                    onPress={doAssign}
                    disabled={assigning}
                  >
                    {assigning
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={s.confirmTxt}>배정 확정</Text>
                    }
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
  safe:           { flex: 1, backgroundColor: "#F6F3F1" },
  tabBtn:         { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: C.border },
  tabTxt:         { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  tabBadge:       { width: 16, height: 16, borderRadius: 8, backgroundColor: "#D96C6C", alignItems: "center", justifyContent: "center" },
  tabBadgeTxt:    { fontSize: 9, fontFamily: "Inter_700Bold", color: "#fff" },
  list:           { padding: 14, gap: 10 },
  groupLabel:     { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textMuted, marginBottom: 6, marginTop: 4 },
  empty:          { alignItems: "center", gap: 12, paddingVertical: 60 },
  emptyTxt:       { fontSize: 14, fontFamily: "Inter_400Regular", color: C.textMuted, textAlign: "center" },
  card:           { borderRadius: 16, padding: 14, gap: 8, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  cardTop:        { flexDirection: "row", alignItems: "flex-start" },
  studentName:    { fontSize: 16, fontFamily: "Inter_700Bold", color: C.text },
  className:      { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary },
  statusBadge:    { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  statusTxt:      { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  infoRow:        { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  infoTxt:        { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, flex: 1 },
  btnRow:         { flexDirection: "row", gap: 8, marginTop: 4 },
  actionBtn:      { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 9, borderRadius: 10 },
  actionTxt:      { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  assignedInfo:   { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#EEDDF5", borderRadius: 10, padding: 10, marginBottom: 10 },
  assignedInfoTxt:{ flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#7C3AED", lineHeight: 18 },
  backdrop:       { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  assignSheet:    { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
                    borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "65%", paddingBottom: 32 },
  sheetHandle:    { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginTop: 10, marginBottom: 4 },
  sheetHeader:    { flexDirection: "row", alignItems: "flex-start", padding: 16, paddingTop: 8 },
  sheetTitle:     { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text },
  sheetSub:       { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted, marginTop: 2 },
  classRow:       { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12,
                    borderWidth: 1, borderColor: "transparent", marginHorizontal: 12, marginBottom: 4, borderRadius: 10 },
  confirmBtn:     { height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  confirmTxt:     { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
